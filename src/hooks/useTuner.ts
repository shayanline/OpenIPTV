import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerEvent } from "../services/player";
import { releaseLogos } from "../services/logos";
import { nextChannel } from "../services/lineup";
import {
  idleRepair, knownToNeedRepair, pauseRepair, repair, rememberNeedsRepair, resumeRepair, stopRepair,
} from "../services/repair";
import type { Fit } from "../services/player";
import type { Channel } from "../types";

/*
 * Everything to do with getting a picture on the screen and keeping it there.
 *
 * The player's lifetime, which channel is on, which one the viewer has landed on but not yet
 * tuned, whether it is busy, paused or broken, and what to do about it when it breaks. All of
 * that used to sit in the component alongside the panel's cursor and the settings sheet, and
 * it is the part with the timers in it, which is the part that repays being on its own.
 */

/**
 * How long channel up and down wait before actually tuning.
 *
 * Holding the channel key sends thirty presses a second, and each one used to tear down the
 * decoder and rebuild it against a new server. That is the worst thing this app can do to a
 * television: the picture never appears, the sound stutters, and on the set it eventually
 * gives up entirely. So the name changes at once and the tuning waits for the viewer to stop.
 *
 * Just under half a second. Long enough that walking through ten channels tunes once, short
 * enough that a single deliberate press does not feel like a delay.
 */
const ZAP_SETTLE_MS = 450;

/**
 * How long to wait before trying a failed channel again, and how many times.
 *
 * These are public relays and the commonest fault by far is temporary: a stream that returns
 * on its own within half a minute. Expecting the viewer to sit there pressing a button to
 * find out is the wrong way round, so the app keeps trying while they watch it happen, and
 * stops rather than retrying for ever behind a black screen.
 */
export const RETRY_DELAYS_MS = [4000, 8000, 15000];

export interface TunerOptions {
  /** The list channel up and down walks, which is whatever the viewer is looking at. */
  list: Channel[];
  /** How the picture should be fitted, reapplied after every start. */
  fit: Fit;
  /** The element hls.js draws into off the television. */
  video: React.RefObject<HTMLVideoElement | null>;
  /** Remember what was on, so the app can come back to it. */
  rememberLast: (id: string) => void;
  /** A channel has been named. The banner wants to come up and stay up. */
  onNamed: () => void;
  /** A picture has arrived, and its name is worth reading now rather than before. */
  onPicture: () => void;
  /** The channel failed. The card over the picture says everything, so the banner goes. */
  onFault: () => void;
  /**
   * Whether the viewer has turned compatibility on, which is the only thing that allows a
   * channel to be played through a playlist this application has repaired.
   */
  compatibility: boolean;
}

export interface Tuner {
  /** The channel actually being played. */
  current: Channel | null;
  /** The channel landed on but not yet tuned, while the channel key is still going. */
  preview: Channel | null;
  /** What the banner should name: the one being walked to, or failing that the one on. */
  shown: Channel | null;
  busy: boolean;
  paused: boolean;
  /** How full the buffer is while connecting, where the engine reports it, and null otherwise. */
  filling: number | null;
  /** The engine's own name for the fault, or empty when there is none. */
  fault: string;
  /** Seconds the channel now tuning has been tuning, so a slow one can say so. */
  waited: number;
  /** Seconds until the next automatic attempt, or zero when none is pending. */
  retryIn: number;
  /** Automatic attempts already made at this channel. */
  attempt: number;
  start: (channel: Channel) => void;
  retune: () => void;
  /** Give up on the channel entirely, leaving nothing playing. */
  clear: () => void;
  /** Walk the list by one, naming at once and tuning when the pressing stops. */
  step: (delta: number) => void;
  setPlaying: (play: boolean) => void;
  togglePause: () => void;
}

export function useTuner(options: TunerOptions): Tuner {
  const { list, fit, video, rememberLast, onNamed, onPicture, onFault, compatibility } = options;

  const [current, setCurrent] = useState<Channel | null>(null);
  const [preview, setPreview] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [fault, setFault] = useState("");
  const [filling, setFilling] = useState<number | null>(null);
  const [waited, setWaited] = useState(0);
  const [retryIn, setRetryIn] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const player = useRef<Player | null>(null);
  /** The current channel as it is now, for callbacks that run between renders. */
  const currentRef = useRef<Channel | null>(null);
  currentRef.current = current;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  /**
   * The pending channel, as a ref as well as state.
   *
   * State because the banner has to redraw for it, and a ref because the next press has to
   * count from it before React has caught up. Counting from the playing channel instead
   * meant every press in a burst stepped from the same place, so the tenth press landed on
   * the second channel.
   */
  const previewRef = useRef<Channel | null>(null);
  const zapTimer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  /** The channel whose arrival has been announced, so it is announced only once. */
  const announced = useRef("");
  /** Attempts made, as a ref, so an automatic retry cannot reset its own budget. */
  const attempts = useRef(0);

  // The callbacks are held so the player's listener can be built once and still reach the
  // latest of them. Rebuilding the player when a parent re-renders would tear the picture
  // down for no reason at all.
  const hooks = useRef({ onNamed, onPicture, onFault });
  hooks.current = { onNamed, onPicture, onFault };

  /**
   * One player, made and attached together, and released together.
   *
   * One effect, because making the player and attaching it are the same event and so are
   * releasing it and detaching it. Split across two, the second has no cleanup and a player
   * that is thrown away keeps its listeners on the video element. React's development mode
   * makes that happen on every mount, and the consequence is not theoretical: the discarded
   * player goes on hearing "playing", starts its own stall watchdog, never learns that the
   * viewer paused, and reports the deliberately still picture as a frozen channel twelve
   * seconds later. A player that is finished with must let go of what it was watching.
   */
  useEffect(() => {
    const onEvent = (e: PlayerEvent) => {
      if (e.type === "buffering") {
        setBusy(true);
        /*
         * How full the buffer is, when the engine says so, and nothing when it does not.
         *
         * Only the television reports this, so a browser shows what it always showed. Kept as
         * null rather than 0 for the difference between "no progress reported" and "reported
         * nothing yet": a nought on screen reads as a channel that is getting nowhere.
         */
        if (e.percent !== undefined) setFilling(Math.min(100, Math.max(0, Math.round(e.percent))));
        return;
      }
      if (e.type === "playing") {
        setBusy(false);
        setFilling(null);
        setFault("");
        setPaused(false);
        /*
         * Announce the channel once, when its picture first arrives.
         *
         * A stream that recovers from a stall reports playing again, and that fires four
         * times in twenty quiet seconds on a live channel. Treating each one as an arrival
         * kept the banner rising from the dead, and since OK dismisses an arrival, OK could
         * never get past it to open the channel list.
         */
        const playing = currentRef.current?.id ?? "";
        if (announced.current !== playing) {
          announced.current = playing;
          hooks.current.onPicture();
        }
        return;
      }
      /*
       * A failure puts the banner away as well as raising the card.
       *
       * The card carries the name and everything else, so the banner is not drawn over a
       * fault, and leaving it up while it is invisible would quietly cost the viewer a press.
       */
      setBusy(false);
      hooks.current.onFault();
      setFault(e.type === "ended" ? "STREAM_ENDED" : e.code);
    };

    const made = new Player(onEvent);
    player.current = made;
    if (video.current) made.attach(video.current);
    return () => {
      made.stop();
      made.detach();
      player.current = null;
    };
  }, [video]);

  // Applied on every change and after every channel start, since a fresh AVPlay instance
  // begins on its own default.
  useEffect(() => {
    player.current?.setFit(fit);
  }, [fit, current?.id]);

  /**
   * Give back what the television needs while the app is off screen.
   *
   * The decoder first, because the guidance is explicit that a hidden app suspends rather
   * than pauses, and an app holding a decoder is the first one a set short of memory kills.
   * The logo cache with it: a few hundred small bitmaps nobody can see is exactly the memory
   * that decides whether this app is still running when the viewer comes back.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        player.current?.hide();
        releaseLogos();
        // The socket stays, the refetching stops: bandwidth is the expensive half and nobody is
        // watching. See services/repair.
        pauseRepair();
      } else {
        player.current?.show();
        resumeRepair();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => () => {
    window.clearTimeout(zapTimer.current);
    window.clearTimeout(retryTimer.current);
  }, []);

  /**
   * Count the seconds a channel has been tuning, so a slow one can say so.
   *
   * A slow connection and a channel that is off the air look exactly alike, and the viewer is
   * the one deciding whether to keep waiting, so the wait has to report on itself.
   */
  useEffect(() => {
    if (!busy) {
      setWaited(0);
      return;
    }
    const started = Date.now();
    const t = window.setInterval(
      () => setWaited(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [busy, current?.id]);

  /**
   * Try the channel that is already on again, from nothing.
   *
   * Deliberately not through start(): that resets the count of attempts already made, and an
   * automatic retry calling it would retry for ever.
   */
  /**
   * Where a channel is played from, which is the one place that decides it.
   *
   * Almost always the channel's own address, and that path costs nothing: no fetch, no worker,
   * no wait. A host already known to defeat this television's playlist parser is repaired first,
   * which means the application serves the corrected playlist to the set's own player. Both
   * `start` and `retune` go through here so the two cannot come to disagree, and `repair` is
   * idempotent: asked twice for the same stream it hands back the address it is already serving.
   *
   * The token is what makes it safe to be asynchronous. A viewer holding the channel key can
   * start three channels while one repair is in flight, and only the newest tune may reach the
   * player: without this, an old repair landing late would tune away from what they are watching.
   */
  /**
   * The toggle as it is now, read from a ref because `tuneTo` must not be rebuilt when it changes.
   *
   * Rebuilding it would rebuild `start` and `retune` with it, and those are handed to the key
   * handler and to the retry effect: a new identity means the effect that schedules retries tears
   * itself down and starts again, which resets the countdown a viewer is watching.
   */
  const wantsRepair = useRef(compatibility);
  wantsRepair.current = compatibility;

  const tuneToken = useRef(0);
  const tuneTo = useCallback((channel: Channel) => {
    tuneToken.current += 1;
    const token = tuneToken.current;
    const play = (url: string, browserRepair = false) => {
      if (tuneToken.current !== token) return;
      player.current?.play(url, browserRepair);
    };

    if (!wantsRepair.current || !knownToNeedRepair(channel.url)) {
      /*
       * Nothing here needs the repair, so it goes quiet rather than away.
       *
       * This used to tear the worker down, which closed a socket and threw away a compiled
       * WebAssembly module on every switch away from a repaired channel, and built both again on
       * every switch back. Walking a list of channels crosses that boundary once per press, and a
       * viewer doing it quickly found the consequence: the socket was leaking, because the platform
       * holds the descriptor for the application rather than for the worker.
       */
      idleRepair();
      play(channel.url);
      return;
    }
    void repair(channel.url).then((repaired) =>
      play(repaired?.url ?? channel.url, repaired?.browser ?? false));
  }, []);

  const retune = useCallback(() => {
    const channel = currentRef.current;
    if (!channel) return;
    setFault("");
    setPaused(false);
    setBusy(true);
    setWaited(0);
    setRetryIn(0);
    announced.current = "";
    tuneTo(channel);
  }, [tuneTo]);

  /**
   * Once per channel, ask whether this is the fault we can repair.
   *
   * Only after a failure, and only with compatibility on. Probing before playing would put a
   * playlist fetch in front of every channel change to help the few that need it, and the
   * ordinary case must stay untouched.
   *
   * The test is narrow on purpose. `repair` answers with an address only for a playlist whose
   * media sequence overflows the set's parser, so a channel that is off the air or sending an
   * undecodable codec falls straight through to the retries below and the viewer is told what
   * actually happened. Telling somebody a dead channel is being repaired would be a lie that
   * costs them another twelve seconds.
   *
   * Marked as attempted before the await, so a fault that repeats while the fetch is in flight
   * cannot start a second one.
   */
  const repairAsked = useRef("");
  useEffect(() => {
    if (!fault || !current || !compatibility) return;
    if (repairAsked.current === current.id) return;
    repairAsked.current = current.id;

    let live = true;
    void repair(current.url).then((repaired) => {
      if (!live || !repaired) return;
      // Remembered by host, so the next channel from the same source skips the failure entirely,
      // this launch and the next.
      rememberNeedsRepair(current.url);
      retune();
    });
    return () => { live = false; };
  }, [fault, current, compatibility, retune]);

  /**
   * Try a failed channel again, on its own, while the viewer watches.
   *
   * Three times, at four then eight then fifteen seconds, saying so while it does. Then it
   * stops, because retrying for ever behind a black screen is how an app ends up burning a
   * network connection all night for a channel that closed down.
   */
  useEffect(() => {
    if (!fault || !current) return;
    if (attempts.current >= RETRY_DELAYS_MS.length) return;

    const wait = RETRY_DELAYS_MS[attempts.current];
    const due = Date.now() + wait;
    setRetryIn(Math.ceil(wait / 1000));

    const tick = window.setInterval(
      () => setRetryIn(Math.max(0, Math.ceil((due - Date.now()) / 1000))),
      500,
    );
    retryTimer.current = window.setTimeout(() => {
      attempts.current += 1;
      setAttempt(attempts.current);
      retune();
    }, wait);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(retryTimer.current);
    };
  }, [fault, current, retune]);

  /**
   * Start a channel from nothing.
   *
   * Everything transient goes back to where it was before any channel was chosen: a pending
   * automatic retry belongs to a channel nobody is watching any more and is called off, a
   * tune that had not happened yet is abandoned, and the channel becomes unannounced so its
   * arrival is announced again.
   */
  const start = useCallback((channel: Channel) => {
    // Written here as well as during render, because anything that starts a channel and then
    // acts on it in the same tick, such as opening the panel onto whatever is playing, would
    // otherwise read the one before.
    currentRef.current = channel;
    setCurrent(channel);
    setFault("");
    setPaused(false);

    window.clearTimeout(retryTimer.current);
    window.clearTimeout(zapTimer.current);
    setRetryIn(0);
    attempts.current = 0;
    setAttempt(0);
    previewRef.current = null;
    setPreview(null);

    // Said immediately rather than waiting for the engine to report buffering, so the gap
    // between asking and the engine answering is not silent.
    setBusy(true);
    setWaited(0);
    announced.current = "";
    hooks.current.onNamed();

    rememberLast(channel.id);
    tuneTo(channel);
  }, [rememberLast, tuneTo]);

  const clear = useCallback(() => {
    player.current?.stop();
    // Nothing is playing, so nothing needs a socket listening on the set's loopback address.
    stopRepair();
    window.clearTimeout(retryTimer.current);
    window.clearTimeout(zapTimer.current);
    currentRef.current = null;
    previewRef.current = null;
    setCurrent(null);
    setPreview(null);
    setFault("");
    setBusy(false);
    setRetryIn(0);
    announced.current = "";
  }, []);

  /**
   * Channel up and down: name it now, tune it once the pressing stops.
   *
   * Holding the channel key sends about thirty presses a second and each one used to tear
   * down the decoder and open a new connection, so walking ten channels opened ten streams,
   * abandoned nine of them mid-handshake and left the set fighting itself. Now the name
   * changes on every press and the tuning happens once, when the viewer settles, which is
   * also how a television has always behaved.
   */
  const step = useCallback((delta: number) => {
    const from = previewRef.current ?? currentRef.current;
    const next = nextChannel(list, from?.id ?? "", delta);
    if (next === -1) return;
    const channel = list[next];

    previewRef.current = channel;
    setPreview(channel);
    hooks.current.onNamed();

    window.clearTimeout(zapTimer.current);
    zapTimer.current = window.setTimeout(() => start(channel), ZAP_SETTLE_MS);
    return next;
  }, [list, start]);

  /**
   * Pause, or come back from a pause and rejoin the broadcast.
   *
   * Coming back re-tunes rather than continuing from where it stopped, because live
   * television has moved on and there is no seek bar to catch up with. Without this a pause
   * left the viewer permanently behind, with nothing on screen to explain it.
   */
  const setPlaying = useCallback((play: boolean) => {
    const channel = currentRef.current;
    if (!channel) return;
    // Nothing to pause until there is a picture. Without this, pausing a channel that was
    // still connecting put "Paused" over a programme that had never started.
    if (!play && busyRef.current) return;
    if (play) {
      setPaused(false);
      setBusy(true);
      setWaited(0);
      player.current?.resume(channel.url);
    } else {
      setPaused(true);
      player.current?.pause();
    }
  }, []);

  const togglePause = useCallback(() => setPlaying(paused), [paused, setPlaying]);

  return {
    current, preview, shown: preview ?? current,
    busy, paused, filling, fault, waited, retryIn, attempt,
    start, retune, clear, step: step as (delta: number) => void, setPlaying, togglePause,
  };
}
