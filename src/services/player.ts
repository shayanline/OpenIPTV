import type HlsType from "hls.js";
import type { MediaTrack } from "../types";
import { createRepairingPlaylistLoader } from "./browserRepair";
import {
  normalizeAvPlayTracks,
  normalizeBrowserTracks,
  type AVPlayStreamInfo,
} from "./playbackTracks";
import { parseAvPlayLiveRange, SEEK_TIMEOUT_MS } from "./playbackRange";

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
  onsubtitlechange?: (duration: number, text: string) => void;
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
  getDuration?(): number;
  seekTo?(milliseconds: number, success?: () => void, failure?: (error: unknown) => void): void;
  jumpForward?(
    milliseconds: number,
    success?: () => void,
    failure?: (error: unknown) => void,
  ): void;
  jumpBackward?(
    milliseconds: number,
    success?: () => void,
    failure?: (error: unknown) => void,
  ): void;
  getCurrentStreamInfo?(): AVPlayStreamInfo[];
  getTotalTrackInfo?(): AVPlayStreamInfo[];
  setSelectTrack?(type: "AUDIO" | "TEXT", index: number): void;
  setSilentSubtitle?(silent: boolean): void;
  getStreamingProperty?(key: string): string;
  getVideoSeamlessInfo?(): { scan_type: number; rotation_degree: number };
  setStreamingProperty?(key: string, value: string): void;
  /** IDLE only, like setStreamingProperty. Optional because the older sets may not have it. */
  setBufferingParam?(option: string, unit: string, amount: number): void;
  suspend?(): void;
  restore?(): void;
  setTimeoutForBuffering?(seconds: number): void;
}

interface TVAudioControl {
  setMute(mute: boolean): void;
  isMute(): boolean;
  setVolumeUp?(): void;
  setVolumeDown?(): void;
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
    webapis?: { avplay?: AVPlay; network?: { getIp?: () => string } };
    tizen?: { tvaudiocontrol?: TVAudioControl };
  }
}

export interface PlayerOpenRequest {
  url: string;
  browserRepair: boolean;
  bufferSeconds: number;
  segmentSeconds: number;
  mode: "live" | "finite";
  startSeconds: number;
}

export interface PlaybackClock {
  position: number | null;
  duration: number | null;
  seekableStart: number | null;
  seekableEnd: number | null;
  engineLiveEdge: number | null;
  segmentSeconds: number | null;
}

export type PlayerEvent =
  | { type: "buffering-start" }
  | { type: "buffering-progress"; percent: number }
  | { type: "buffering-complete" }
  | { type: "playing" }
  | { type: "paused" }
  | { type: "ended" }
  | { type: "error"; code: string; warmKind: "network" | "media" | null }
  | { type: "tracks"; tracks: MediaTrack[] }
  | { type: "subtitle"; text: string; durationMs: number };

export type PlaybackDynamicRange =
  | "SDR"
  | "HDR"
  | "PQ"
  | "HLG"
  | "HDR10"
  | "HDR10+"
  | "Dolby Vision";

export interface PlaybackStats {
  engine: "AVPlay" | "hls.js" | "Native HLS";
  width?: number;
  height?: number;
  dynamicRange?: PlaybackDynamicRange;
  scan?: "progressive" | "interlaced";
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  bandwidth?: number;
  bufferSeconds?: number;
  frameRate?: number;
  droppedFrames?: number;
  totalFrames?: number;
  level?: number;
  levels?: number;
  switches: number;
}

/*
 * Timeouts and frozen picture detection used to live here. They moved to
 * services/playbackRecovery, which is the one place recovery policy and its timers exist:
 * a startup limit, a rebuffer limit, frozen playhead sampling and the retry schedule. The
 * player reports what the engine does and leaves deciding what it means to the coordinator.
 */
export const onTizen = (): boolean => typeof window !== "undefined" && !!window.webapis?.avplay;

/** AVPlay throws objects carrying its own error name, hls.js and the DOM throw Errors. */
const codeOf = (e: unknown): string => {
  const o = e as { name?: string; message?: string } | null;
  return o?.name || o?.message || String(e);
};

const extensionOf = (address: string): string => {
  try {
    const name = new URL(address, window.location.href).pathname;
    return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  } catch {
    return "";
  }
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

const finite = (value: unknown): number | undefined => {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

const nonNegative = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const streamInfo = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(parsed)) {
      normalized[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = item;
    }
    return normalized;
  } catch {
    return {};
  }
};

const dynamicRange = (...values: unknown[]): PlaybackDynamicRange | undefined => {
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    const code = Number(raw);
    if (code === 16) return "PQ";
    if (code === 18) return "HLG";
    if ([1, 6, 13, 14, 15].includes(code)) return "SDR";
    const name = raw
      .toLowerCase()
      .replace(/\+/g, "plus")
      .replace(/[^a-z0-9]/g, "");
    if (name.includes("hdr10plus") || name.includes("smpte209440")) return "HDR10+";
    if (name.includes("dolbyvision") || /^(dvh1|dvhe|dav1)/.test(name)) return "Dolby Vision";
    if (name.includes("hlg") || name.includes("aribstdb67")) return "HLG";
    if (name.includes("hdr10")) return "HDR10";
    if (name === "pq" || name.includes("smpte2084") || name.includes("st2084")) return "PQ";
    if (name === "hdr") return "HDR";
    if (name === "sdr" || name.includes("bt709")) return "SDR";
  }
  return undefined;
};

const streamDynamicRange = (video: Record<string, unknown>): PlaybackDynamicRange | undefined =>
  dynamicRange(
    video.hdrtype,
    video.hdrformat,
    video.dynamicrange,
    video.videorange,
    video.transferfunction,
    video.transfercharacteristics,
    video.transfercharacteristic,
    video.colortransfer,
    video.colourtransfer,
  );

const hlsDynamicRange = (
  videoRange: unknown,
  codecs: unknown,
  supplementalCodecs: unknown,
): PlaybackDynamicRange | undefined => {
  const supplemental = String(supplementalCodecs ?? "");
  if (/\/cdm4(?:\s*,|\s*$)/i.test(supplemental)) return "HDR10+";
  if (/(?:^|[\s,"])(?:dvh1|dvhe|dav1)\./i.test(`${String(codecs ?? "")},${supplemental}`)) {
    return "Dolby Vision";
  }
  const range = dynamicRange(videoRange);
  return range === "PQ" ? "HDR10" : range;
};

interface HlsRange {
  range: PlaybackDynamicRange;
  width?: number;
  height?: number;
  bandwidth?: number;
  averageBandwidth?: number;
}

const HLS_ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;

const manifestDynamicRange = (
  text: string,
  width?: number,
  height?: number,
  bitrate?: number,
): PlaybackDynamicRange | undefined => {
  const variants: HlsRange[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes: Record<string, string> = {};
    HLS_ATTRIBUTE.lastIndex = 0;
    let match = HLS_ATTRIBUTE.exec(line);
    while (match) {
      attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
      match = HLS_ATTRIBUTE.exec(line);
    }
    const range = hlsDynamicRange(
      attributes["VIDEO-RANGE"],
      attributes.CODECS,
      attributes["SUPPLEMENTAL-CODECS"],
    );
    if (!range) continue;
    const resolution = attributes.RESOLUTION?.split(/[xX]/).map(Number) ?? [];
    variants.push({
      range,
      width: finite(resolution[0]),
      height: finite(resolution[1]),
      bandwidth: finite(attributes.BANDWIDTH),
      averageBandwidth: finite(attributes["AVERAGE-BANDWIDTH"]),
    });
  }
  if (!variants.length) return undefined;
  let candidates = variants;
  if (width && height) {
    const sameSize = candidates.filter(
      (item) => item.width === width && item.height === height,
    );
    if (sameSize.length) candidates = sameSize;
  }
  if (bitrate && candidates.length > 1) {
    candidates = [...candidates].sort((left, right) => {
      const leftRate = left.averageBandwidth ?? left.bandwidth ?? 0;
      const rightRate = right.averageBandwidth ?? right.bandwidth ?? 0;
      return Math.abs(leftRate - bitrate) - Math.abs(rightRate - bitrate);
    });
    return candidates[0].range;
  }
  return candidates.every((item) => item.range === candidates[0].range)
    ? candidates[0].range
    : undefined;
};

export class Player {
  private hls: InstanceType<typeof HlsType> | null = null;
  private video: HTMLVideoElement | null = null;
  private gesture: (() => void) | null = null;
  /** Whether this attempt has already reported why it failed. */
  private failed = false;
  private fit: Fit = "fit";
  private sink: (e: PlayerEvent) => void;
  /** Whether the pause in force when the app went off screen was the viewer's own. */
  private pausedByViewer = false;
  /** Whether the viewer is holding the picture. */
  private held = false;
  private mode: "live" | "finite" = "live";
  private resumeLimitation = "";
  private muted = false;
  private muteBeforeSettings: boolean | null = null;
  private switches = 0;
  private lastBitrate = "";
  private lastLevel = -1;
  private frameSample: { total: number; at: number } | null = null;
  private generation = 0;
  private tracks: MediaTrack[] = [];
  private segmentSeconds: number | null = null;
  private engineLiveEdge: number | null = null;
  private subtitlesEnabled = true;
  private textTrackCleanup: (() => void) | null = null;
  private metadataCleanup: (() => void) | null = null;
  private sourceUrl = "";
  private avPlayDynamicRange?: PlaybackDynamicRange;
  private avPlayMetadataProbed = false;
  private manifestRange?: PlaybackDynamicRange;
  private manifestProbe: AbortController | null = null;
  private manifestProbed = false;

  constructor(emit: (e: PlayerEvent) => void) {
    this.sink = emit;
  }

  private emit(e: PlayerEvent) {
    this.sink(e);
  }

  /** Where the playhead is, in seconds, or null when neither engine will say. */
  getPosition(): number | null {
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        const state = av?.getState();
        if (!av || (state !== "READY" && state !== "PLAYING" && state !== "PAUSED"))
          return null;
        const ms = av.getCurrentTime?.();
        return typeof ms === "number" && Number.isFinite(ms) ? ms / 1000 : null;
      } catch {
        return null;
      }
    }
    const value = this.video?.currentTime;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  getResumeLimitation(): string | null {
    return this.resumeLimitation || null;
  }

  getDuration(): number | null {
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        const state = av?.getState();
        if (!av || (state !== "READY" && state !== "PLAYING" && state !== "PAUSED"))
          return null;
        const value = av.getDuration?.();
        return typeof value === "number" && Number.isFinite(value) ? value / 1000 : null;
      } catch {
        return null;
      }
    }
    const value = this.video?.duration;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  getClock(): PlaybackClock {
    const position = this.getPosition();
    const duration = this.getDuration();
    let seekableStart: number | null = null;
    let seekableEnd: number | null = null;
    if (onTizen()) {
      try {
        const av = window.webapis?.avplay;
        const state = av?.getState();
        if (av && (state === "READY" || state === "PLAYING" || state === "PAUSED")) {
          if (this.mode === "live") {
            const range = parseAvPlayLiveRange(
              av.getStreamingProperty?.("GET_LIVE_DURATION") ?? "",
            );
            seekableStart = range?.startSeconds ?? null;
            seekableEnd = range?.endSeconds ?? null;
          } else if (duration !== null) {
            seekableStart = 0;
            seekableEnd = duration;
          }
        }
      } catch {}
    } else if (this.video?.seekable.length) {
      const last = this.video.seekable.length - 1;
      seekableStart = this.video.seekable.start(0);
      seekableEnd = this.video.seekable.end(last);
    }
    return {
      position,
      duration,
      seekableStart,
      seekableEnd,
      engineLiveEdge: this.engineLiveEdge,
      segmentSeconds: this.segmentSeconds,
    };
  }

  canPause(): boolean {
    if (!onTizen()) return !!this.video;
    try {
      const state = window.webapis?.avplay?.getState();
      return state === "PLAYING" || state === "PAUSED";
    } catch {
      return false;
    }
  }

  /**
   * Report a failure, keeping the first explanation.
   *
   * One broken stream produces several errors in a row, and the later ones are the
   * consequences rather than the cause: a manifest that 404s leaves the element with no
   * source, and the NotSupportedError that follows would otherwise overwrite "could not
   * reach the server" with the far less useful "cannot decode this format".
   */
  private fail(code: string, warmKind: "network" | "media" | null = null) {
    if (this.failed) return;
    this.failed = true;
    this.emit({ type: "error", code, warmKind });
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
    video.muted = this.muted;
    video.addEventListener("playing", this.onPlaying);
    video.addEventListener("pause", this.onPaused);
    video.addEventListener("waiting", this.onWaiting);
    video.addEventListener("ended", this.onEnded);
    video.addEventListener("error", this.onMediaError);
  }

  detach() {
    if (!this.video) return;
    this.video.removeEventListener("playing", this.onPlaying);
    this.video.removeEventListener("pause", this.onPaused);
    this.video.removeEventListener("waiting", this.onWaiting);
    this.video.removeEventListener("ended", this.onEnded);
    this.video.removeEventListener("error", this.onMediaError);
    this.video = null;
  }

  private onPlaying = () => this.emit({ type: "playing" });
  private onPaused = () => this.emit({ type: "paused" });
  private onWaiting = () => this.emit({ type: "buffering-start" });
  private onEnded = () => this.emit({ type: "ended" });
  // Native media errors cannot establish whether access failed or the format is unsupported.
  private onMediaError = () =>
    this.fail(this.mode === "finite" ? "FINITE_SOURCE_UNAVAILABLE" : "NOT_SUPPORTED");

  play(request: PlayerOpenRequest): void {
    const { url, browserRepair, bufferSeconds, segmentSeconds, mode, startSeconds } = request;
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
    const generation = this.generation;
    this.failed = false;
    this.held = false;
    this.mode = mode;
    this.resumeLimitation = "";
    this.segmentSeconds = segmentSeconds;
    this.engineLiveEdge = null;
    this.subtitlesEnabled = true;
    this.switches = 0;
    this.lastBitrate = "";
    this.lastLevel = -1;
    this.frameSample = null;
    this.sourceUrl = url;

    // A hard bound on how long a channel may sit there doing nothing.
    /*
     * Neither engine can be relied on to give up. hls.js retries a failed manifest on its
     * own schedule and only reports a fatal error once its internal budget runs out, which
     * can take longer than anyone will wait, and Samsung's player is documented to hang
     * thirty seconds on a connection failure. Deciding when silence counts as failure is
     * the coordinator's job, so this method only starts the attempt.
     */
    if (onTizen()) this.playAVPlay(url, bufferSeconds, startSeconds, generation);
    else void this.playBrowser(url, browserRepair, startSeconds, generation);
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
  private tryPlay(video: HTMLVideoElement, generation = this.generation) {
    Promise.resolve(video.play()).catch((e: unknown) => {
      if (generation !== this.generation) return;
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
      this.emit({ type: "buffering-start" });
      const retry = () => {
        this.ungate();
        if (generation !== this.generation) return;
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
  private playAVPlay(
    url: string,
    bufferSeconds: number,
    startSeconds: number,
    generation: number,
  ) {
    const av = window.webapis!.avplay!;
    const current = () => generation === this.generation;
    try {
      ensureSurface();

      const state = av.getState();
      if (state !== "NONE" && state !== "IDLE") av.stop(); // any state -> IDLE

      av.open(url); // NONE|IDLE -> IDLE

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
      } catch {
        /* older firmware may not have it, and the default is only slower */
      }

      // How long to wait for a channel that is not coming. This only shortens the wait: the
      // player is documented to hang thirty seconds on a connection failure, and cutting that
      // to fifteen means AVPlay names the fault before the app's own watchdog gives up and
      // reports a bare timeout instead.
      try {
        av.setTimeoutForBuffering?.(15);
      } catch {
        /* older firmware may not have it */
      }

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
        onbufferingstart: () => current() && this.emit({ type: "buffering-start" }),
        onbufferingprogress: (percent) =>
          current() && this.emit({ type: "buffering-progress", percent }),
        onbufferingcomplete: () => current() && this.emit({ type: "buffering-complete" }),
        onstreamcompleted: () => current() && this.emit({ type: "ended" }),
        onsubtitlechange: (durationMs, text) => {
          if (!current() || !this.subtitlesEnabled) return;
          this.emit({
            type: "subtitle",
            text: String(text),
            durationMs: Number(durationMs) || 0,
          });
        },
        onevent: (id, data) => {
          if (!current()) return;
          const event = String(id);
          const value = String(data).trim();
          if (event === "PLAYER_MSG_HTTP_ERROR_CODE") status = value;
          if (/PLAYER_MSG_AVPLAY_PAUSED?$/.test(event)) this.emit({ type: "paused" });
          if (event === "PLAYER_MSG_BITRATE_CHANGE") {
            if (this.lastBitrate && this.lastBitrate !== value) this.switches += 1;
            this.lastBitrate = value;
          }
        },
        /*
         * onerrormsg where the firmware sends one, onerror otherwise, and never both: they
         * describe one failure, and `fail` keeps the first explanation on purpose, so whichever
         * arrives first is the one the viewer sees. The message is appended rather than
         * substituted because services/errors.ts matches on the code.
         */
        onerror: (code) => current() && this.fail(withStatus(String(code), status)),
        onerrormsg: (code, message) =>
          current() &&
          this.fail(withStatus(`${String(code)} ${String(message)}`.trim(), status)),
      });

      this.emit({ type: "buffering-start" });
      av.prepareAsync(
        // IDLE -> READY
        () => {
          if (!current()) return;
          const startPlayback = () => {
            if (!current()) return;
            try {
              this.readAvPlayTracks(av);
              this.applySubtitleSilence(av);
              av.play(); // READY -> PLAYING
              this.emit({ type: "playing" });
            } catch (error) {
              this.fail(codeOf(error));
            }
          };
          if (this.mode === "finite" && startSeconds > 0) {
            if (av.seekTo) {
              void this.seekTo(startSeconds).then((moved) => {
                if (!current()) return;
                if (!moved) this.resumeLimitation = "SEEK_FAILED";
                startPlayback();
              });
              return;
            } else {
              this.resumeLimitation = "SEEK_UNSUPPORTED";
            }
          }
          startPlayback();
        },
        (e) => current() && this.fail(codeOf(e)),
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
      try {
        window.webapis?.avplay?.setDisplayMethod?.(AVPLAY_MODE[fit]);
      } catch {
        /* older firmware, or not playing yet: the next open applies it */
      }
      return;
    }
    if (this.video) this.video.style.objectFit = OBJECT_FIT[fit];
  }

  /** Temporarily silence the audio without changing the live playback clock. */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (!onTizen()) {
      if (this.video) this.video.muted = muted;
      return;
    }

    const audio = window.tizen?.tvaudiocontrol;
    if (!audio) return;
    try {
      if (muted) {
        if (this.muteBeforeSettings === null) this.muteBeforeSettings = audio.isMute();
        audio.setMute(true);
      } else if (this.muteBeforeSettings !== null) {
        audio.setMute(this.muteBeforeSettings);
        this.muteBeforeSettings = null;
      }
    } catch {
      // The TV audio privilege is optional on older firmware, so playback must continue.
    }
  }

  /** Change audio level without touching the live playback pipeline. */
  adjustVolume(delta: number) {
    if (onTizen()) {
      const audio = window.tizen?.tvaudiocontrol;
      try {
        if (delta > 0) audio?.setVolumeUp?.();
        else if (delta < 0) audio?.setVolumeDown?.();
      } catch {
        // Volume belongs to the TV, so an unavailable audio API must not affect playback.
      }
      return;
    }

    if (this.video) {
      this.video.volume = Math.max(0, Math.min(1, this.video.volume + delta));
      if (delta > 0) this.video.muted = false;
    }
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
    } catch {
      /* nothing to suspend */
    }
  }

  show() {
    if (!onTizen()) {
      if (!this.pausedByViewer && this.video) this.tryPlay(this.video);
      return;
    }
    const av = window.webapis!.avplay!;
    try {
      if (av.getState() !== "NONE") av.restore?.();
    } catch {
      /* nothing to restore */
    }
  }

  private async playBrowser(
    url: string,
    browserRepair: boolean,
    startSeconds: number,
    generation: number,
  ) {
    const video = this.video;
    if (!video) return;
    video.muted = this.muted;
    this.emit({ type: "buffering-start" });

    const extension = extensionOf(url);
    if (this.mode === "finite" && extension !== "m3u8") {
      video.src = url;
      if (startSeconds > 0) video.currentTime = startSeconds;
      this.watchLoadedMetadata(video, generation, () => this.readNativeTracks(video));
      this.tryPlay(video, generation);
      return;
    }

    const Hls = await loadHls();
    // The viewer may have moved on while the engine was being fetched, and this attempt is
    // then for a channel nobody is watching.
    if (generation !== this.generation || this.video !== video || this.failed) return;

    // hls.js first, native second, and not the other way round. Chrome answers "maybe" to
    // canPlayType for HLS and then cannot play it, so asking the browser what it supports
    // sends every desktop down a path that fails. Where hls.js works it is the right
    // engine; native is for Safari, which genuinely does play HLS and where hls.js does
    // not run.
    if (!Hls.isSupported()) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        this.watchLoadedMetadata(video, generation, () => this.readNativeTracks(video));
        this.tryPlay(video, generation);
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

    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (generation !== this.generation || !data.fatal) return;
      const warmKind =
        data.type === Hls.ErrorTypes.NETWORK_ERROR
          ? "network"
          : data.type === Hls.ErrorTypes.MEDIA_ERROR
            ? "media"
            : null;
      const status = data.response?.code;
      const code =
        status != null && Number.isInteger(status) && status >= 400 && status <= 599
          ? `${data.details} (http ${status})`
          : data.details;
      this.fail(code, warmKind);
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      if (generation !== this.generation) return;
      if (this.lastLevel >= 0 && this.lastLevel !== data.level) this.switches += 1;
      this.lastLevel = data.level;
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
      if (generation !== this.generation) return;
      const details = data.details;
      this.engineLiveEdge = Number.isFinite(details.edge) ? details.edge : null;
      const durations = details.fragments.map((fragment) => fragment.duration);
      const longest = durations.length ? Math.max(...durations) : 0;
      if (longest > 0) this.segmentSeconds = longest;
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (generation !== this.generation) return;
      this.readHlsTracks(hls);
      /*
       * TextTrack objects are created asynchronously, when a subtitle track is actually
       * enabled, so the element's own loadedmetadata is the earliest point the cue
       * listeners can attach, and SUBTITLE_TRACKS_UPDATED the point they may need to again.
       */
      this.watchLoadedMetadata(video, generation, () => this.watchTextTracks(video));
      if (this.mode === "finite" && startSeconds > 0) video.currentTime = startSeconds;
      this.tryPlay(video, generation);
    });
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
      if (generation !== this.generation) return;
      this.readHlsTracks(hls);
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      if (generation !== this.generation) return;
      this.readHlsTracks(hls);
      this.watchTextTracks(video);
    });
    hls.loadSource(url);
    hls.attachMedia(video);
  }

  /**
   * Track lists are empty until the browser has read the metadata, so every native path
   * reads them from loadedmetadata rather than the tick the address is set. The listener is
   * generation guarded like the rest, and removed by teardown so a stale load says nothing.
   */
  private watchLoadedMetadata(
    video: HTMLVideoElement,
    generation: number,
    onReady: () => void,
  ): void {
    this.metadataCleanup?.();
    const handler = () => {
      if (generation !== this.generation) return;
      onReady();
    };
    video.addEventListener("loadedmetadata", handler);
    this.metadataCleanup = () => video.removeEventListener("loadedmetadata", handler);
  }

  private setTracks(tracks: MediaTrack[]): void {
    this.tracks = tracks;
    this.emit({ type: "tracks", tracks: [...tracks] });
  }

  private readAvPlayTracks(av: AVPlay): void {
    try {
      const state = av.getState();
      if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") return;
      this.setTracks(normalizeAvPlayTracks(av.getTotalTrackInfo?.() ?? []));
    } catch {}
  }

  /**
   * The one place AVPlay subtitle silence is decided, so it is a function of
   * `subtitlesEnabled` and nothing else: selecting a track of any kind re-applies the
   * viewer's choice, and every open applies it again once READY makes the call legal, so a
   * channel change can never inherit a silenced engine the viewer did not ask for.
   */
  private applySubtitleSilence(av: AVPlay): void {
    try {
      const state = av.getState();
      if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") return;
      av.setSilentSubtitle?.(!this.subtitlesEnabled);
    } catch {
      /* firmware without it draws what it was always going to draw */
    }
  }

  private readHlsTracks(hls: InstanceType<typeof HlsType>): void {
    const source = hls as InstanceType<typeof HlsType> & {
      audioTracks: Array<{ name?: string; lang?: string; default?: boolean }>;
      subtitleTracks: Array<{ name?: string; lang?: string; default?: boolean }>;
      audioTrack: number;
      subtitleTrack: number;
    };
    const audio = (source.audioTracks ?? []).map((track, index) => ({
      kind: "audio" as const,
      label: track.name ?? "",
      language: track.lang ?? "",
      selected: source.audioTrack === index || (source.audioTrack < 0 && !!track.default),
      engineIndex: index,
    }));
    const subtitles = (source.subtitleTracks ?? []).map((track, index) => ({
      kind: "subtitle" as const,
      label: track.name ?? "",
      language: track.lang ?? "",
      selected: source.subtitleTrack === index || (source.subtitleTrack < 0 && !!track.default),
      engineIndex: index,
    }));
    this.setTracks(normalizeBrowserTracks([...audio, ...subtitles]));
  }

  /**
   * Cue listeners attach to every TextTrack the element knows, including any the engine adds
   * after this runs: hls.js creates them when a subtitle track is enabled, which can be well
   * past loadedmetadata. The list's own addtrack covers those, and teardown removes both.
   */
  private watchTextTracks(video: HTMLVideoElement): void {
    this.textTrackCleanup?.();
    this.textTrackCleanup = null;
    const onCue = () => {
      if (!this.subtitlesEnabled) return;
      const cues: TextTrackCue[] = [];
      for (const track of Array.from(video.textTracks)) {
        for (const cue of Array.from(track.activeCues ?? [])) {
          cues.push(cue as TextTrackCue);
        }
      }
      const text = cues.map((cue) => (cue as VTTCue).text ?? "").join("\n");
      const durationMs = cues.length
        ? Math.max(...cues.map((cue) => Math.max(0, cue.endTime - cue.startTime) * 1000))
        : 0;
      this.emit({ type: "subtitle", text, durationMs });
    };
    const watched = new Set<TextTrack>();
    const attach = () => {
      for (const track of Array.from(video.textTracks)) {
        if (watched.has(track)) continue;
        watched.add(track);
        if (!this.subtitlesEnabled) track.mode = "disabled";
        else if (track.mode !== "disabled") track.mode = "hidden";
        track.addEventListener("cuechange", onCue);
      }
    };
    attach();
    const list = video.textTracks;
    list.addEventListener?.("addtrack", attach);
    this.textTrackCleanup = () => {
      list.removeEventListener?.("addtrack", attach);
      for (const track of Array.from(video.textTracks)) {
        track.removeEventListener("cuechange", onCue);
      }
    };
  }

  private readNativeTracks(video: HTMLVideoElement): void {
    const media = video as HTMLVideoElement & {
      audioTracks?: ArrayLike<{ label?: string; language?: string; enabled?: boolean }>;
    };
    const audio = Array.from(media.audioTracks ?? []).map((track, engineIndex) => ({
      kind: "audio" as const,
      label: track.label ?? "",
      language: track.language ?? "",
      selected: !!track.enabled,
      engineIndex,
    }));
    const text = Array.from(video.textTracks).map((track, engineIndex) => ({
      kind: "subtitle" as const,
      label: track.label,
      language: track.language,
      selected: track.mode !== "disabled",
      engineIndex,
    }));
    this.watchTextTracks(video);
    this.setTracks(normalizeBrowserTracks([...audio, ...text]));
  }

  getTracks(): MediaTrack[] {
    return [...this.tracks];
  }

  selectTrack(kind: "audio" | "subtitle", engineIndex: number | null): boolean {
    if (kind === "audio" && engineIndex === null) return false;
    if (
      engineIndex !== null &&
      !this.tracks.some((track) => track.kind === kind && track.engineIndex === engineIndex)
    )
      return false;
    const updateSubtitleOutput = () => {
      if (kind !== "subtitle") return;
      this.subtitlesEnabled = engineIndex !== null;
      if (engineIndex === null) this.emit({ type: "subtitle", text: "", durationMs: 0 });
    };

    if (onTizen()) {
      const av = window.webapis?.avplay;
      try {
        const state = av?.getState();
        if (!av || (state !== "READY" && state !== "PLAYING" && state !== "PAUSED"))
          return false;
        if (kind === "subtitle" && engineIndex === null) {
          if (!av.setSilentSubtitle) return false;
        } else {
          if (!av.setSelectTrack) return false;
          av.setSelectTrack(kind === "audio" ? "AUDIO" : "TEXT", engineIndex!);
        }
        updateSubtitleOutput();
        /*
         * Silence follows the viewer's subtitle choice and nothing else, so selecting an
         * audio track can never unsilence what the viewer turned off.
         */
        this.applySubtitleSilence(av);
        // The total track list can retain stale selection flags after setSelectTrack.
        this.setTracks(
          this.tracks.map((track) =>
            track.kind === kind
              ? { ...track, selected: track.engineIndex === engineIndex }
              : track,
          ),
        );
        return true;
      } catch {
        return false;
      }
    }

    if (this.hls) {
      const hls = this.hls as InstanceType<typeof HlsType> & {
        audioTrack: number;
        subtitleTrack: number;
      };
      if (kind === "audio") hls.audioTrack = engineIndex!;
      else hls.subtitleTrack = engineIndex ?? -1;
      updateSubtitleOutput();
      // Selecting a subtitle is what makes hls.js create its TextTrack, so the cue
      // listeners have to be offered the new list again.
      if (this.video) this.watchTextTracks(this.video);
      this.readHlsTracks(this.hls);
      return true;
    }

    const video = this.video as
      | (HTMLVideoElement & {
          audioTracks?: ArrayLike<{ enabled: boolean }>;
        })
      | null;
    if (!video) return false;
    if (kind === "audio") {
      if (!video.audioTracks || engineIndex! >= video.audioTracks.length) return false;
      for (let index = 0; index < video.audioTracks.length; index += 1) {
        video.audioTracks[index].enabled = index === engineIndex;
      }
    } else {
      for (let index = 0; index < video.textTracks.length; index += 1) {
        video.textTracks[index].mode = index === engineIndex ? "hidden" : "disabled";
      }
    }
    updateSubtitleOutput();
    this.readNativeTracks(video);
    return true;
  }

  warmRecover(kind: "network" | "media" | null): boolean {
    if (this.hls && kind) {
      this.failed = false;
      this.emit({ type: "buffering-start" });
      if (kind === "network") this.hls.startLoad(this.video?.currentTime || -1);
      else this.hls.recoverMediaError();
      return true;
    }
    if (!onTizen()) return false;
    try {
      const av = window.webapis?.avplay;
      const state = av?.getState();
      if (!av || (state !== "READY" && state !== "PAUSED")) return false;
      this.failed = false;
      this.emit({ type: "buffering-start" });
      av.play();
      return true;
    } catch {
      return false;
    }
  }

  private probeAVPlayDynamicRange(av: AVPlay): void {
    if (this.avPlayMetadataProbed) return;
    try {
      const state = av.getState();
      if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") return;
    } catch {
      return;
    }
    this.avPlayMetadataProbed = true;
    const apply = (range?: PlaybackDynamicRange) => {
      if (!range) return false;
      if (
        this.avPlayDynamicRange === "PQ" &&
        range !== "HDR10" &&
        range !== "HDR10+" &&
        range !== "Dolby Vision"
      ) {
        return false;
      }
      this.avPlayDynamicRange = range;
      return true;
    };
    try {
      for (const track of av.getTotalTrackInfo?.() ?? []) {
        if (track.type !== "VIDEO") continue;
        if (apply(streamDynamicRange(streamInfo(track.extra_info)))) return;
      }
    } catch {}
    for (const key of [
      "GET_STREAM_INFO",
      "PROPERTY_STREAMING_STATUS",
      "PROPERTY_STREAMING_TYPE",
      "PROPERTY_VR360_INFO",
    ]) {
      try {
        if (apply(dynamicRange(av.getStreamingProperty?.(key)))) return;
      } catch {}
    }
  }

  private probeManifestDynamicRange(width?: number, height?: number, bitrate?: number): void {
    if (
      this.manifestProbed ||
      !onTizen() ||
      extensionOf(this.sourceUrl) !== "m3u8" ||
      typeof fetch !== "function"
    ) {
      return;
    }
    this.manifestProbed = true;
    const controller = new AbortController();
    const generation = this.generation;
    this.manifestProbe = controller;
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void fetch(this.sourceUrl, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then((text) => {
        if (generation === this.generation) {
          this.manifestRange = manifestDynamicRange(text, width, height, bitrate);
        }
      })
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(timeout);
        if (this.manifestProbe === controller) this.manifestProbe = null;
      });
  }

  getStats(): PlaybackStats {
    if (onTizen()) {
      const stats: PlaybackStats = { engine: "AVPlay", switches: this.switches };
      const av = window.webapis!.avplay!;
      let video: Record<string, unknown> = {};
      let audio: Record<string, unknown> = {};
      try {
        for (const track of av.getCurrentStreamInfo?.() ?? []) {
          if (track.type === "VIDEO") video = streamInfo(track.extra_info);
          if (track.type === "AUDIO") audio = streamInfo(track.extra_info);
        }
      } catch {}

      stats.width = finite(video.width);
      stats.height = finite(video.height);
      stats.videoCodec =
        String(video.fourcc ?? video.codec ?? video.codectype ?? "") || undefined;
      stats.audioCodec =
        String(audio.fourcc ?? audio.codec ?? audio.codectype ?? "") || undefined;
      stats.frameRate = finite(video.framerate);
      stats.bitrate = finite(video.bitrate);
      const reportedRange = streamDynamicRange(video);
      if (reportedRange && (reportedRange !== "PQ" || !this.avPlayDynamicRange)) {
        this.avPlayDynamicRange = reportedRange;
      }
      if (!reportedRange || reportedRange === "PQ") this.probeAVPlayDynamicRange(av);
      const engineRange = this.avPlayDynamicRange;
      stats.dynamicRange =
        engineRange === "PQ" ? (this.manifestRange ?? engineRange) : engineRange;
      if (!stats.dynamicRange || stats.dynamicRange === "PQ") {
        this.probeManifestDynamicRange(
          stats.width,
          stats.height,
          finite(this.lastBitrate) ?? stats.bitrate,
        );
      }

      try {
        stats.bandwidth = finite(av.getStreamingProperty?.("CURRENT_BANDWIDTH"));
        const available = av.getStreamingProperty?.("AVAILABLE_BITRATE") ?? "";
        const levels = available
          .split(/[|,]/)
          .filter((value) => finite(value) !== undefined).length;
        if (levels) stats.levels = levels;
        stats.level = finite(av.getStreamingProperty?.("CURRENT_LEVEL"));
        stats.bufferSeconds = finite(av.getStreamingProperty?.("BUFFER_AHEAD"));
        stats.frameRate = finite(av.getStreamingProperty?.("FRAME_RATE")) ?? stats.frameRate;
        const totalFrames = av.getStreamingProperty?.("TOTAL_FRAMES");
        const droppedFrames = av.getStreamingProperty?.("DROPPED_FRAMES");
        if (totalFrames) stats.totalFrames = nonNegative(totalFrames);
        if (droppedFrames) stats.droppedFrames = nonNegative(droppedFrames);
      } catch {}
      try {
        const scan = av.getVideoSeamlessInfo?.().scan_type;
        if (scan === 0) stats.scan = "interlaced";
        if (scan === 1) stats.scan = "progressive";
      } catch {}
      return stats;
    }

    const stats: PlaybackStats = {
      engine: this.hls ? "hls.js" : "Native HLS",
      switches: this.switches,
    };
    const video = this.video;
    const hls = this.hls;
    const levelIndex = hls?.currentLevel ?? -1;
    const level = levelIndex >= 0 ? hls?.levels[levelIndex] : undefined;
    if (levelIndex >= 0) stats.level = levelIndex + 1;
    if (hls?.levels.length) stats.levels = hls.levels.length;
    stats.width = finite(video?.videoWidth) ?? finite(level?.width);
    stats.height = finite(video?.videoHeight) ?? finite(level?.height);
    stats.videoCodec = level?.videoCodec || undefined;
    stats.audioCodec = level?.audioCodec || undefined;
    stats.dynamicRange = hlsDynamicRange(
      level?.videoRange,
      level?.attrs?.CODECS,
      level?.attrs?.["SUPPLEMENTAL-CODECS"],
    );
    stats.bitrate = finite(level?.bitrate);
    stats.bandwidth = finite(hls?.bandwidthEstimate);
    stats.frameRate = finite(level?.frameRate);

    if (video) {
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (
          video.buffered.start(index) <= video.currentTime &&
          video.buffered.end(index) >= video.currentTime
        ) {
          stats.bufferSeconds = Math.max(0, video.buffered.end(index) - video.currentTime);
          break;
        }
      }

      const legacy = video as HTMLVideoElement & {
        webkitDecodedFrameCount?: number;
        webkitDroppedFrameCount?: number;
      };
      const quality =
        typeof video.getVideoPlaybackQuality === "function"
          ? video.getVideoPlaybackQuality()
          : {
              totalVideoFrames: legacy.webkitDecodedFrameCount,
              droppedVideoFrames: legacy.webkitDroppedFrameCount,
            };
      const total = nonNegative(quality.totalVideoFrames);
      const dropped = nonNegative(quality.droppedVideoFrames);
      if (total !== undefined) {
        stats.totalFrames = total;
        const now = Date.now();
        if (this.frameSample && now > this.frameSample.at && total >= this.frameSample.total) {
          stats.frameRate =
            Math.round(
              ((total - this.frameSample.total) * 10000) / (now - this.frameSample.at),
            ) / 10;
        }
        this.frameSample = { total, at: now };
      }
      if (dropped !== undefined) stats.droppedFrames = dropped;
    }
    return stats;
  }

  async seekTo(seconds: number): Promise<boolean> {
    if (!Number.isFinite(seconds) || seconds < 0) return false;
    const target = seconds;
    const generation = this.generation;
    const finish = (success: boolean) => success && generation === this.generation;

    if (!onTizen()) {
      if (!this.video) return finish(false);
      try {
        this.video.currentTime = target;
        return finish(true);
      } catch {
        return finish(false);
      }
    }

    const av = window.webapis!.avplay!;
    if (!av.seekTo) return finish(false);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let retried = false;
      let retryTimer = 0;
      let attemptId = 0;
      const done = (success: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.clearTimeout(retryTimer);
        resolve(finish(success));
      };
      const retry = (error: unknown) => {
        if (settled) return;
        if (
          retried ||
          generation !== this.generation ||
          /not.?supported|unsupported/i.test(
            `${codeOf(error)} ${error instanceof Error ? error.message : ""}`,
          )
        ) {
          done(false);
          return;
        }
        // AVPlay can reject the first seek while its pause or prepare state settles.
        retried = true;
        retryTimer = window.setTimeout(attempt, 200);
      };
      const attempt = () => {
        if (settled) return;
        if (generation !== this.generation) {
          done(false);
          return;
        }
        const id = ++attemptId;
        try {
          const state = av.getState();
          if (state !== "READY" && state !== "PLAYING" && state !== "PAUSED") {
            retry("InvalidStateError");
            return;
          }
          const duration = this.mode === "finite" ? (av.getDuration?.() ?? 0) : 0;
          const milliseconds = Math.round(target * 1000);
          av.seekTo?.(
            duration > 0 ? Math.min(milliseconds, Math.max(0, duration - 1)) : milliseconds,
            () => {
              if (id === attemptId) done(true);
            },
            (error) => {
              if (id === attemptId) retry(error);
            },
          );
        } catch (error) {
          retry(error);
        }
      };
      const timeout = window.setTimeout(() => done(false), SEEK_TIMEOUT_MS);
      attempt();
    });
  }

  pause(): boolean {
    if (!this.canPause()) return false;
    this.held = true;
    // A viewer who has paused is not waiting for permission to start, so the gesture the
    // browser was holding out for is no longer wanted.
    this.ungate();
    if (onTizen()) {
      try {
        const av = window.webapis!.avplay!;
        if (av.getState() === "PAUSED") return true;
        if (!av.pause) {
          this.held = false;
          return false;
        }
        av.pause();
      } catch {
        this.held = false;
        return false;
      }
    } else {
      this.video?.pause();
    }
    return true;
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
  resumePlayback(): boolean {
    this.held = false;
    if (onTizen()) {
      try {
        const av = window.webapis!.avplay!;
        const state = av.getState();
        if (state !== "READY" && state !== "PAUSED") return false;
        av.play();
        return true;
      } catch {
        return false;
      }
    }
    if (!this.video) return false;
    this.tryPlay(this.video);
    return true;
  }

  /** Stop playback, retaining the decoder only while another target is being prepared. */
  stop(release = true) {
    this.setMuted(false);
    this.teardown(release);
  }

  /**
   * Put everything back to a state a new channel can start from.
   *
   * `release` is the difference between changing channel and finishing with the player.
   * Both reach a state open() is legal in, but close() destroys the AVPlay instance, so
   * only a real stop asks for it. Zapping stays one stop away from the next channel.
   */
  private teardown(release: boolean) {
    this.generation += 1;
    this.pausedByViewer = false;
    this.held = false;
    this.ungate();
    this.textTrackCleanup?.();
    this.textTrackCleanup = null;
    this.metadataCleanup?.();
    this.metadataCleanup = null;
    this.manifestProbe?.abort();
    this.manifestProbe = null;
    this.sourceUrl = "";
    this.avPlayDynamicRange = undefined;
    this.avPlayMetadataProbed = false;
    this.manifestRange = undefined;
    this.manifestProbed = false;
    this.tracks = [];
    this.segmentSeconds = null;
    this.engineLiveEdge = null;
    this.sink({ type: "tracks", tracks: [] });
    this.sink({ type: "subtitle", text: "", durationMs: 0 });
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
