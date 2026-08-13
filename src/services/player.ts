import type HlsType from "hls.js";

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
  onbufferingcomplete?: () => void;
  onstreamcompleted?: () => void;
  onerror?: (code: string) => void;
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
  | { type: "buffering" }
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

  play(url: string) {
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
    if (onTizen()) this.playAVPlay(url);
    else void this.playBrowser(url);
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
      if ((e as { name?: string })?.name !== "NotAllowedError") {
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
  private playAVPlay(url: string) {
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

      // IDLE only. Joining on the lowest rendition puts a picture up quickly and the
      // adaptive logic climbs from there, which is what makes zapping feel immediate.
      //
      // Worth knowing that this does nothing for a good many channels: plenty of playlists
      // point straight at a single rendition rather than at a master, and with no ladder
      // to choose from there is no choice to influence. It costs nothing where it does not
      // apply, and helps on the ones that do offer variants.
      av.setStreamingProperty?.("ADAPTIVE_INFO", "STARTBITRATE=LOWEST|SKIPBITRATE=LOWEST");

      // How long to wait for a channel that is not coming, which is a different setting
      // from how much to buffer. The buffer itself is left at the ten seconds Samsung
      // ships, on their own advice that the defaults are not to be modified. This only
      // shortens the wait: the player is documented to hang thirty seconds on a connection
      // failure, and cutting that to fifteen means AVPlay names the fault before the app's
      // own watchdog gives up and reports a bare timeout instead.
      try { av.setTimeoutForBuffering?.(15); } catch { /* older firmware may not have it */ }

      av.setListener({
        onbufferingstart: () => this.emit({ type: "buffering" }),
        onbufferingcomplete: () => this.emit({ type: "playing" }),
        onstreamcompleted: () => this.emit({ type: "ended" }),
        onerror: (code) => this.fail(String(code)),
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

  private async playBrowser(url: string) {
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
