import type HlsType from "hls.js";
import { createRepairingPlaylistLoader } from "./browserRepair";
import { DEFAULT_INITIAL_BUFFER_SECONDS } from "./manifest";

/**
 * hls.js is fetched only when something is actually going to use it.
 *
 * It is around half a megabyte and it is the *browser* engine. On a television the picture
 * comes from webapis.avplay driving the hardware decoder, and this library is never called
 * at all, so a static import spent the parse and the heap of a software player on a set that
 * has a hardware one and 120 MB to live in.
 *
 * Loading it lazily is safe precisely because of that split: the import only happens inside
 * playBrowser, which the TV path never reaches, so if a packaged widget could not fetch a
 * second chunk it would never be asked to.
 */
let hlsModule: Promise<typeof HlsType> | null = null;
const loadHls = () => {
  hlsModule ??= import("hls.js").then((m) => m.default);
  return hlsModule;
};

/**
 * One play/stop interface over two very different engines.
 *
 * On the TV, webapis.avplay drives the hardware decoder directly. That matters beyond
 * performance: it is markedly more tolerant of awkward manifests than the browser engine
 * in the same firmware, and live playlists in the wild are full of long sliding windows,
 * unusual sequence numbering and discontinuities that a software player gives up on.
 *
 * In a desktop browser there is no AVPlay, so hls.js drives a plain <video>. Safari plays
 * HLS natively and needs neither.
 */

interface AVPlayListener {
  onbufferingstart?: () => void;
  /** How full the buffer is, 0 to 100, which is the only honest thing to show while waiting. */
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  onerror?: (code: string) => void;
  /** The same failure with the engine's own sentence attached, where the firmware sends one. */
  onerrormsg?: (code: string, message: string) => void;
  /**
   * Everything else the player wants to say, of which one matters here.
   *
   * PLAYER_MSG_HTTP_ERROR_CODE carries the status the server actually returned. Without it a
   * refusal and a dead host are both PLAYER_ERROR_CONNECTION_FAILED, and the viewer is told
   * "the TV could not reach this channel's server" when the truth was a 403 and no amount of
   * waiting will help. The other events are resolution and bitrate changes during adaptive
   * playback, which are worth having later for a badge that reports what is playing rather
   * than what the playlist claims.
   */
  onevent?: (id: string, data: string) => void;
}

/** The states AVPlay moves through. Most calls are legal in only some of them. */
type AVPlayState = "NONE" | "IDLE" | "READY" | "PLAYING" | "PAUSED";

interface AVPlay {
  open(url: string): void;
  close(): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod?(mode: string): void;
  setListener(l: AVPlayListener): void;
  prepareAsync(ok: () => void, fail: (e: unknown) => void): void;
  play(): void;
  pause?(): void;
  stop(): void;
  getState(): AVPlayState;
  /** Only ever read, and only to tell a playing picture from a frozen one. */
  getCurrentTime?(): number;
  setStreamingProperty?(key: string, value: string): void;
  /** IDLE only, like setStreamingProperty. Optional because the older sets may not have it. */
  setBufferingParam?(option: string, unit: string, amount: number): void;
  suspend?(): void;
  restore?(): void;
  setTimeoutForBuffering?(seconds: number): void;
}

/**
 * How to fit a picture that is not the shape of the screen.
 *
 * Named after what the viewer sees rather than after either engine's vocabulary, since the
 * two disagree: the TV calls them display methods and a browser calls them object fits.
 */
export type Fit = "fit" | "fill" | "stretch";

const AVPLAY_MODE: Record<Fit, string> = {
  fit: "PLAYER_DISPLAY_MODE_LETTER_BOX",
  fill: "PLAYER_DISPLAY_MODE_FULL_SCREEN",
  // Nothing in AVPlay distorts on purpose, so the closest it offers is to fill the rect and
  // let the aspect information decide, which for a stream that misreports its shape is the
  // behaviour someone reaching for Stretch is after.
  stretch: "PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO",
};

const OBJECT_FIT: Record<Fit, string> = { fit: "contain", fill: "cover", stretch: "fill" };

declare global {
  interface Window {
    webapis?: { avplay?: AVPlay };
    tizen?: unknown;
  }
}

export type PlayerEvent =
  /** `percent` is how full the buffer is, where the engine will say, and absent otherwise. */
  | { type: "buffering"; percent?: number }
  | { type: "playing" }
  | { type: "ended" }
  /** `code` is the engine's own name for the fault, which the UI turns into a cause and
      a remedy. Checklist 4.6 asks for both, not for the raw code. */
  | { type: "error"; code: string };

/**
 * How long a channel may take to produce a picture before it counts as broken.
 *
 * Thirty seconds, not the fifteen or twenty a desktop would allow. These are public IPTV
 * relays reached over whatever connection the television has, and a first segment can
 * genuinely take twenty seconds to arrive on a slow link. Giving up early on a channel that
 * was about to start is worse than waiting, because the viewer has no way to tell the
 * difference and will conclude the channel is dead. The wait is not silent: the banner names
 * the channel throughout and says how it is getting on.
 */
const START_TIMEOUT_MS = 30000;

/**
 * How a picture that has stopped moving is noticed, and how long it is given first.
 *
 * A public relay does not usually fail cleanly. It freezes: the connection stays open, the
 * engine reports nothing wrong, and the last frame sits there indefinitely. Nothing in either
 * engine reports that, so it is found by watching the clock: if the playhead has not advanced
 * in twelve seconds and nobody pressed pause, there is no programme, whatever the engine says.
 *
 * Twelve, because a bad connection can genuinely stall for ten and recover, and a viewer who
 * has waited twelve seconds for a frozen picture would have given up on it anyway. It is
 * reported as an ordinary failure, so the automatic retry picks it up like any other.
 */
const STALL_TICK_MS = 3000;
const STALL_LIMIT_MS = 12000;

export const onTizen = (): boolean =>
  typeof window !== "undefined" && !!window.webapis?.avplay;

/** AVPlay throws objects carrying its own error name, hls.js and the DOM throw Errors. */
const codeOf = (e: unknown): string => {
  const o = e as { name?: string; message?: string } | null;
  return o?.name || o?.message || String(e);
};

/**
 * The engine's fault with the server's status alongside it, where there is one.
 *
 * "http 403" rather than a bare number, so that a status can never be mistaken for part of the
 * engine's own name, and so the mapping in services/errors.ts can look for one without matching
 * any three digits that happen to appear in a message.
 */
const withStatus = (code: string, status: string): string =>
  status && !code.includes(status) ? `${code} (http ${status})` : code;

/**
 * The surface AVPlay draws into.
 *
 * A Samsung TV does not decode into the page. The picture goes onto a hardware plane
 * *underneath* the browser, and the page is punched through with a transparent hole so it
 * can be seen. Two things follow, and both were wrong here.
 *
 * The page must actually be transparent over the video, which is what the `tizen` class on
 * <html> arranges. An opaque background anywhere in the chain, and the set plays the
 * channel perfectly into a hole nobody can see through: sound, no picture.
 *
 * And the guide requires an <object type="application/avplayer"> for the plane to bind to.
 * It is created once, outside React, as the first child of the body so nothing in the app
 * paints beneath it, and it is never recreated: webapis.avplay is a singleton with no
 * handle tying it to an element, so a second object element sends the video to the wrong
 * one. Its size must be non-zero and must track setDisplayRect.
 */
const SURFACE_ID = "avplay-surface";

function ensureSurface(): void {
  if (document.getElementById(SURFACE_ID)) return;
  const el = document.createElement("object");
  el.id = SURFACE_ID;
  el.setAttribute("type", "application/avplayer");
  el.setAttribute(
    "style",
    "position:absolute;top:0;left:0;width:1920px;height:1080px;background:transparent;pointer-events:none;",
  );
  document.body.insertBefore(el, document.body.firstChild);
}

export class Player {
  private hls: InstanceType<typeof HlsType> | null = null;
  private video: HTMLVideoElement | null = null;
  private gesture: (() => void) | null = null;
  /** Whether this attempt has already reported why it failed. */
  private failed = false;
  private fit: Fit = "fit";
  private watchdog: number | undefined;
  private sink: (e: PlayerEvent) => void;
  /** Whether the pause in force when the app went off screen was the viewer's own. */
  private pausedByViewer = false;
  /** Whether the viewer is holding the picture, so a still frame is not read as a fault. */
  private held = false;
  private progress: number | undefined;
  private lastPosition = -1;
  private stalledFor = 0;

  constructor(emit: (e: PlayerEvent) => void) {
    this.sink = emit;
  }

  /** Anything conclusive, good or bad, calls off the watchdog. */
  private emit(e: PlayerEvent) {
    if (e.type === "playing" || e.type === "error") {
      window.clearTimeout(this.watchdog);
      this.watchdog = undefined;
    }
    // A picture has arrived, so from here the question stops being whether it will start and
    // becomes whether it is still moving.
    if (e.type === "playing") this.watchProgress();
    this.sink(e);
  }

  /** Where the playhead is, in seconds, or null when neither engine will say. */
  private position(): number | null {
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        if (!av || av.getState() !== "PLAYING") return null;
        const ms = av.getCurrentTime?.();
        return typeof ms === "number" ? ms / 1000 : null;
      } catch {
        return null;
      }
    }
    return this.video ? this.video.currentTime : null;
  }

  /**
   * Watch the picture keep moving, and say so when it stops.
   *
   * This is the one fault neither engine reports. A frozen relay looks exactly like a playing
   * one from the outside: no error, no buffering event, no end of stream, just a picture that
   * has stopped. Leaving the viewer to notice and press a Reload button would mean a
   * permanent control on screen for something that happens rarely, and no help at all to
   * anybody who did not know what the button was for.
   */
  private watchProgress() {
    window.clearInterval(this.progress);
    this.stalledFor = 0;
    this.lastPosition = this.position() ?? -1;

    this.progress = window.setInterval(() => {
      if (this.held) return;                       // paused on purpose is not a stall
      const now = this.position();
      if (now === null) return;
      // A tenth of a second, so a clock that only ticks per frame still counts as moving.
      if (now > this.lastPosition + 0.1) {
        this.lastPosition = now;
        this.stalledFor = 0;
        return;
      }
      this.stalledFor += STALL_TICK_MS;
      if (this.stalledFor < STALL_LIMIT_MS) return;
      window.clearInterval(this.progress);
      this.progress = undefined;
      this.fail("STALLED");
    }, STALL_TICK_MS);
  }

  /**
   * Report a failure, keeping the first explanation.
   *
   * One broken stream produces several errors in a row, and the later ones are the
   * consequences rather than the cause: a manifest that 404s leaves the element with no
   * source, and the NotSupportedError that follows would otherwise overwrite "could not
   * reach the server" with the far less useful "cannot decode this format".
   */
  private fail(code: string) {
    if (this.failed) return;
    this.failed = true;
    window.clearInterval(this.progress);
    this.progress = undefined;
    this.emit({ type: "error", code });
  }

  /**
   * The element's own events are the truth about whether anything is on screen. The
   * promise returned by play() is not: it reports whether the call was permitted, which
   * is a different question and the source of a long standing false alarm.
   *
   * The listeners are remembered so they can be taken off again. Without that, a Player that
   * has been thrown away goes on reporting into a dead sink, and React's development mode
   * mounts everything twice, so every event arrived twice from the first frame onwards.
   */
  attach(video: HTMLVideoElement) {
    this.detach();
    this.video = video;
    video.addEventListener("playing", this.onPlaying);
    video.addEventListener("waiting", this.onWaiting);
  }

  detach() {
    if (!this.video) return;
    this.video.removeEventListener("playing", this.onPlaying);
    this.video.removeEventListener("waiting", this.onWaiting);
    this.video = null;
  }

  private onPlaying = () => this.emit({ type: "playing" });
  private onWaiting = () => this.emit({ type: "buffering" });

  play(
    url: string,
    browserRepair = false,
    bufferSeconds = DEFAULT_INITIAL_BUFFER_SECONDS,
  ) {
    /*
     * Wound down, not destroyed.
     *
     * playAVPlay below is careful to reach a new channel through stop rather than close,
     * because close throws the instance away and the whole pipeline has to be rebuilt, which
     * is the last thing a television needs while somebody holds the channel key down. That
     * care was undone one line up: this called the public stop(), which closes, so every
     * channel change rebuilt the pipeline anyway and the comment describing the intent was
     * the only place the intent survived.
     */
    this.teardown(false);
    this.failed = false;
    this.held = false;

    // A hard bound on how long a channel may sit there doing nothing.
    //
    // Neither engine can be relied on to give up. hls.js retries a failed manifest on its
    // own schedule and only reports a fatal error once its internal budget runs out, which
    // can take longer than anyone will wait, and Samsung's player is documented to hang
    // thirty seconds on a connection failure. Whatever the engine is doing, silence past
    // this point is a failure as far as the viewer is concerned.
    window.clearTimeout(this.watchdog);
    this.watchdog = window.setTimeout(() => this.fail("TIMEOUT"), START_TIMEOUT_MS);
    if (onTizen()) this.playAVPlay(url, bufferSeconds);
    else void this.playBrowser(url, browserRepair);
  }

  /**
   * Ask the element to play, and interpret a refusal correctly.
   *
   * A browser blocks playback that no one asked for, and rejects with NotAllowedError.
   * That is not a broken stream: the media is loaded and will run the moment the viewer
   * touches anything. Reporting it as a failure put a dialog over a channel that was
   * about to start on its own. So the refusal arms a one shot retry on the next input
   * instead, and the viewer sees the ordinary loading state until then.
   */
  private tryPlay(video: HTMLVideoElement) {
    video.play().catch((e: unknown) => {
      const name = (e as { name?: string })?.name;
      /*
       * An abort is this application's own doing and never news.
       *
       * The promise rejects with AbortError when the request is interrupted by a later load
       * or a pause, which is what tuning away, retrying and pausing all do. Reported as a
       * fault it was worse than noise: play() clears `failed` for the new attempt, so the
       * abort from the attempt just torn down arrived first and won the rule that keeps the
       * first explanation. A channel on a host that never answers timed out, was retried,
       * and ended up telling the viewer "the stream stopped unexpectedly" with AbortError
       * underneath, having buried "the TV could not reach this channel's server".
       */
      if (name === "AbortError") return;
      if (name !== "NotAllowedError") {
        this.fail(codeOf(e));
        return;
      }
      this.emit({ type: "buffering" });
      const retry = () => {
        this.ungate();
        /*
         * Unless the key that woke us was the viewer pausing.
         *
         * This waits for any input at all, and "pause" is an input. So a browser that had
         * blocked autoplay would arm this, the viewer would press Space, the app would pause
         * the video and this would start it again in the same tick: the picture carried on and
         * the interface said Paused over the top of it. Anything that has been deliberately
         * held stays held.
         */
        if (this.held) return;
        void video.play();
      };
      this.gesture = retry;
      window.addEventListener("keydown", retry, { once: true });
      window.addEventListener("pointerdown", retry, { once: true });
    });
  }

  private ungate() {
    if (!this.gesture) return;
    window.removeEventListener("keydown", this.gesture);
    window.removeEventListener("pointerdown", this.gesture);
    this.gesture = null;
  }

  /**
   * Start a channel on the TV.
   *
   * The order is not a matter of taste. Every AVPlay call is legal in only some states,
   * and the awkward one is setStreamingProperty, which is IDLE only: after open, before
   * prepare. Called any later it throws and the channel never starts.
   *
   * Changing channel goes through stop rather than close. Both leave a state open can be
   * called from, but close destroys the instance and the pipeline has to be rebuilt, which
   * is exactly the wrong thing to do when someone is holding the channel key down.
   */
  private playAVPlay(url: string, bufferSeconds: number) {
    const av = window.webapis!.avplay!;
    try {
      ensureSurface();

      const state = av.getState();
      if (state !== "NONE" && state !== "IDLE") av.stop();   // any state -> IDLE

      av.open(url);                                          // NONE|IDLE -> IDLE

      // The rect is always in a 1920x1080 space whatever the panel or the app resolution,
      // and letterbox keeps a channel of any aspect from being stretched to fill it.
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setDisplayMethod?.(AVPLAY_MODE[this.fit]);

      /*
       * IDLE only. Joining on the lowest rendition puts a picture up quickly and the
       * adaptive logic climbs from there, which is what makes zapping feel immediate.
       *
       * `SKIPBITRATE=LOWEST` used to be here beside it and was costing quality. Samsung
       * documents that parameter twice and the two disagree: the adaptive streaming guide
       * calls it "bit rate to ignore during streaming", the AVPlay reference calls it "the
       * bandwidth to use after a skip operation". Under the first reading the pair asked the
       * set to start on the lowest rendition and to ignore the lowest rendition, in one
       * string, which is either contradictory or a way of skipping the rendition we had just
       * chosen. Neither is what anyone wanted, and nothing here skips: there is no timeline
       * to skip along.
       *
       * Worth knowing that this does nothing for a good many channels: plenty of playlists
       * point straight at a single rendition rather than at a master, and with no ladder to
       * choose from there is no choice to influence. It costs nothing where it does not
       * apply, and helps on the ones that do offer variants.
       */
      av.setStreamingProperty?.("ADAPTIVE_INFO", "STARTBITRATE=LOWEST");

      /*
       * How much to have in hand before starting, which is not how much to keep afterwards.
       *
       * Samsung ships ten seconds here and advises against changing the defaults, which was
       * worth measuring rather than believing. On the set, one property changed at a time and
       * the same channel each time:
       *
       *   default, 10s   the picture started moving 2875ms after play()
       *   4 seconds       873ms
       *   6 seconds       one complete five second segment, with room for its boundary
       *   2 seconds       842ms
       *
       * Two thirds of a zap spent waiting, and the reason is worth stating because it explains
       * why it never looked this way on every channel. A live playlist hands the player a
       * window ending at the live edge, so the last few seconds of a ten second buffer can only
       * arrive as fast as real time produces them, and a viewer watches the percentage climb to
       * the high eighties and stop with the first frame already decoded underneath it. Channels
       * repaired by services/repair never showed it, because that manifest declares a twenty
       * second target duration and the player therefore starts a minute inside content it
       * already holds.
       *
       * The obvious worry is that a smaller buffer stutters later. It does not, because this
       * governs the initial fill and not what is kept in hand. Four seconds is too short for a
       * channel whose segments last five seconds, so six gives AVPlay one complete segment and
       * a little room at the boundary. The preflight can raise this for a channel with longer
       * segments, while the resume buffer is left alone.
       */
      try {
        av.setBufferingParam?.(
          "PLAYER_BUFFER_FOR_PLAY",
          "PLAYER_BUFFER_SIZE_IN_SECOND",
          bufferSeconds,
        );
      } catch { /* older firmware may not have it, and the default is only slower */ }

      // How long to wait for a channel that is not coming. This only shortens the wait: the
      // player is documented to hang thirty seconds on a connection failure, and cutting that
      // to fifteen means AVPlay names the fault before the app's own watchdog gives up and
      // reports a bare timeout instead.
      try { av.setTimeoutForBuffering?.(15); } catch { /* older firmware may not have it */ }

      /**
       * What the server said, kept until something fails and then spent on the explanation.
       *
       * AVPlay reports the HTTP status through onevent and the failure through onerror, in that
       * order and as two separate facts. Neither is much use alone: 403 with no failure is a
       * segment that will be retried, and PLAYER_ERROR_CONNECTION_FAILED with no status cannot
       * tell a refusal from a dead host. Joined, the viewer gets told the truth.
       */
      let status = "";

      av.setListener({
        onbufferingstart: () => this.emit({ type: "buffering" }),
        onbufferingprogress: (percent) => this.emit({ type: "buffering", percent }),
        onbufferingcomplete: () => this.emit({ type: "playing" }),
        onstreamcompleted: () => this.emit({ type: "ended" }),
        onevent: (id, data) => {
          if (String(id) === "PLAYER_MSG_HTTP_ERROR_CODE") status = String(data).trim();
        },
        /*
         * onerrormsg where the firmware sends one, onerror otherwise, and never both: they
         * describe one failure, and `fail` keeps the first explanation on purpose, so whichever
         * arrives first is the one the viewer sees. The message is appended rather than
         * substituted because services/errors.ts matches on the code.
         */
        onerror: (code) => this.fail(withStatus(String(code), status)),
        onerrormsg: (code, message) =>
          this.fail(withStatus(`${String(code)} ${String(message)}`.trim(), status)),
      });

      this.emit({ type: "buffering" });
      av.prepareAsync(                                       // IDLE -> READY
        () => {
          av.play();                                         // READY -> PLAYING
          this.emit({ type: "playing" });
        },
        (e) => this.fail(codeOf(e)),
      );
    } catch (e) {
      this.fail(codeOf(e));
    }
  }

  /**
   * Change how the picture is fitted, now, without interrupting it.
   *
   * Both engines accept this mid playback, which is what makes it worth having as a setting
   * rather than something that only takes effect on the next channel.
   */
  setFit(fit: Fit) {
    this.fit = fit;
    if (onTizen()) {
      try { window.webapis?.avplay?.setDisplayMethod?.(AVPLAY_MODE[fit]); }
      catch { /* older firmware, or not playing yet: the next open applies it */ }
      return;
    }
    if (this.video) this.video.style.objectFit = OBJECT_FIT[fit];
  }

  /**
   * Hand the decoder back while the app is off screen, and take it again on return.
   *
   * The guidance is explicit that a hidden app must suspend rather than pause: a TV short
   * of memory kills background apps, and the one holding a decoder goes first.
   *
   * Whether the viewer had paused is remembered, because these two have to be symmetrical.
   * hide() paused the element and show() returned early off the TV, so in a browser a
   * channel that was interrupted by switching tab never came back: the picture stayed frozen,
   * the interface went on claiming it was playing, and it took two presses of Play to sort
   * out, the first of which appeared to do nothing.
   */
  hide() {
    if (!onTizen()) {
      this.pausedByViewer = !!this.video?.paused;
      this.video?.pause();
      return;
    }
    const av = window.webapis!.avplay!;
    try {
      const state = av.getState();
      if (state === "READY" || state === "PLAYING" || state === "PAUSED") av.suspend?.();
    } catch { /* nothing to suspend */ }
  }

  show() {
    if (!onTizen()) {
      if (!this.pausedByViewer) void this.video?.play();
      return;
    }
    const av = window.webapis!.avplay!;
    try {
      if (av.getState() !== "NONE") av.restore?.();
    } catch { /* nothing to restore */ }
  }

  private async playBrowser(url: string, browserRepair: boolean) {
    const video = this.video;
    if (!video) return;
    this.emit({ type: "buffering" });

    const Hls = await loadHls();
    // The viewer may have moved on while the engine was being fetched, and this attempt is
    // then for a channel nobody is watching.
    if (this.video !== video || this.failed) return;

    // hls.js first, native second, and not the other way round. Chrome answers "maybe" to
    // canPlayType for HLS and then cannot play it, so asking the browser what it supports
    // sends every desktop down a path that fails. Where hls.js works it is the right
    // engine; native is for Safari, which genuinely does play HLS and where hls.js does
    // not run.
    if (!Hls.isSupported()) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        this.tryPlay(video);
      } else {
        this.fail("NOT_SUPPORTED");
      }
      return;
    }
    /**
     * Tuned for live television, and specifically for what these playlists actually send.
     *
     * A measured example: 1800 segments of two seconds each, a full hour of rewind in a
     * 325 KB manifest, reloaded every couple of seconds because that is the target
     * duration. The hour is a DVR window for players that offer one, and this one does not,
     * so every frame behind the playhead is memory spent on something nobody can ask for.
     */
    const hls = new Hls({
      pLoader: browserRepair ? createRepairingPlaylistLoader(Hls) : undefined,
      // Nothing here touches how far behind live to sit. That is the standard's business,
      // and the default already follows it.
      //
      // What is overridden is memory, which is this application's business rather than the
      // specification's: the library assumes a desktop and will happily keep everything it
      // has ever downloaded, and an hour long window on a set with two gigabytes is not
      // the place for that.

      // Nothing can rewind, so nothing behind the playhead is worth keeping.
      backBufferLength: 0,

      // Join on the lowest rendition, as the TV path is told to. On a slow connection that
      // is the difference between a picture in three seconds and a picture in fifteen, and a
      // viewer who cannot tell a slow channel from a dead one will give up long before the
      // best rendition arrives. The adaptive logic climbs from there within a few segments.
      startLevel: 0,

      // A ceiling in front of the playhead, in time and in bytes. The library's own
      // starting point of thirty seconds is left alone, this only stops it growing.
      maxMaxBufferLength: 30,
      maxBufferSize: 24 * 1000 * 1000,

      // No part of these playlists is low latency HLS, so the machinery for it is cost
      // without benefit.
      lowLatencyMode: false,
    });
    this.hls = hls;

    // Recovery gets a budget. A brief network stumble is worth retrying quietly, but a
    // channel that is simply off the air must not retry for ever behind a black screen:
    // checklist 4.6 says the viewer is told what went wrong and what to do about it.
    let left = 3;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      const recoverable = data.type === Hls.ErrorTypes.NETWORK_ERROR
        || data.type === Hls.ErrorTypes.MEDIA_ERROR;
      if (!recoverable || left-- <= 0) {
        this.fail(data.details);
        return;
      }
      this.emit({ type: "buffering" });
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        // Resume where the viewer was, not at the live edge. Called bare, startLoad picks
        // the default start position, so a stumble while watching something twenty minutes
        // back silently threw them forward to live with no way to tell what happened.
        hls.startLoad(video.currentTime || -1);
      } else {
        hls.recoverMediaError();
      }
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => this.tryPlay(video));
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  pause() {
    this.held = true;
    // A viewer who has paused is not waiting for permission to start, so the gesture the
    // browser was holding out for is no longer wanted.
    this.ungate();
    if (onTizen()) {
      try { window.webapis!.avplay!.pause?.(); } catch { /* nothing to pause */ }
    } else {
      this.video?.pause();
    }
  }

  /**
   * Come back from a pause, at the live edge.
   *
   * A pause on live television is a hole, not a bookmark. Resuming where it stopped leaves
   * the viewer permanently behind the broadcast with no way back, which was a genuine trap
   * once the seek bar went: five minutes on the telephone and every channel is five minutes
   * late for the rest of the evening, with nothing on screen explaining why.
   *
   * So resuming rejoins the channel. One code path, both engines, and it repairs the case
   * these servers make common anyway: a relay that dropped the connection while nobody was
   * watching. It costs the couple of seconds any channel change costs, which is exactly what
   * a viewer pressing Play after a pause expects to see.
   */
  resume(url: string) {
    this.play(url);
  }

  /** Give the decoder back and let go of the television's video plane entirely. */
  stop() {
    this.teardown(true);
  }

  /**
   * Put everything back to a state a new channel can start from.
   *
   * `release` is the difference between changing channel and finishing with the player.
   * Both reach a state open() is legal in, but close() destroys the AVPlay instance, so
   * only a real stop asks for it. Zapping stays one stop away from the next channel.
   */
  private teardown(release: boolean) {
    window.clearTimeout(this.watchdog);
    this.watchdog = undefined;
    window.clearInterval(this.progress);
    this.progress = undefined;
    this.pausedByViewer = false;
    this.held = false;
    this.ungate();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.video) {
      this.video.removeAttribute("src");
      this.video.load();
    }
    if (onTizen()) {
      const av = window.webapis!.avplay!;
      try {
        if (av.getState() !== "NONE") {
          av.stop();
          if (release) av.close();
        }
      } catch {
        // Closing an already closed player throws, which is not worth reporting.
      }
    }
  }
}
