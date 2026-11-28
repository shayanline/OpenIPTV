import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageKey } from "../services/locale";
import { releaseAllArtwork } from "../services/artwork";
import { DEFAULT_INITIAL_BUFFER_SECONDS } from "../services/manifest";
import {
  clampSeekTarget,
  DEFAULT_SEGMENT_SECONDS,
  finiteSeekRange,
  isAtLiveEdge,
  safeLiveTarget,
  SEEK_SETTLE_MS,
  SEEK_HOLD_FALLBACK_MS,
  usefulLiveRange,
} from "../services/playbackRange";
import {
  type Fit,
  onTizen,
  Player,
  type PlaybackClock,
  type PlaybackStats,
  type PlayerEvent,
  type PlayerOpenRequest,
} from "../services/player";
import {
  PlaybackRecoveryCoordinator,
  type RecoverySession,
  type RecoveryState,
} from "../services/playbackRecovery";
import { automaticTrack } from "../services/playbackTracks";
import {
  flushPlaybackTrackChoices,
  playbackTrackChoices,
  rememberPlaybackTrackChoice,
  type TrackSelection,
} from "../services/playbackTrackChoices";
import {
  idleRepair,
  pauseRepair,
  prepare,
  resumeRepair,
  revalidate,
  stopRepair,
} from "../services/repair";
import type {
  MediaTrack,
  PlaybackSnapshot,
  PlaybackTarget,
  QuickSeekState,
  SeekRange,
  TuneItem,
} from "../types";

export interface PlaybackCapabilities {
  /** An active session accepts Play/Pause intent even while its engine is loading. */
  readonly canPause: boolean;
  readonly audioTracks: readonly MediaTrack[];
  readonly subtitleTracks: readonly MediaTrack[];
}

export type { TrackSelection } from "../services/playbackTrackChoices";

export interface PlaybackController {
  readonly snapshot: PlaybackSnapshot;
  readonly preview: PlaybackTarget | null;
  readonly capabilities: PlaybackCapabilities;
  readonly quickSeek: QuickSeekState | null;
  readonly subtitleCue: string;
  readonly recovery: RecoveryState;
  readonly shown: PlaybackTarget | null;
  start(item: TuneItem, options?: { restart?: boolean }): void;
  stop(): void;
  retune(): void;
  step(delta: 1 | -1, list: readonly TuneItem[], repeated?: boolean): void;
  commitStep(): void;
  setPlaying(play: boolean): boolean;
  togglePlaying(): boolean;
  seekBy(deltaSeconds: number): void;
  seekTo(seconds: number, waitForRelease?: boolean): void;
  settleSeek(): void;
  /**
   * Commit a debounced seek now rather than after its settle period, so dismissing the
   * controls never leaves a pending intent to fire behind whatever opened next.
   */
  flushSeek(): void;
  /** A seek is queued or in flight, so the engine's temporary pause is intentional. */
  readonly seeking: boolean;
  goLive(): void;
  selectTrack(
    kind: "audio" | "subtitle",
    engineIndex: number | null,
    selection?: TrackSelection,
  ): boolean;
  setMuted(mute: boolean): void;
  adjustVolume(dir: 1 | -1): void;
  getStats(): PlaybackStats | null;
}

export interface PlaybackControllerOptions {
  playlistId?: string;
  fit: Fit;
  video: React.RefObject<HTMLVideoElement | null>;
  compatibility: boolean;
  continuousReconnect: boolean;
  onNamed(target: PlaybackTarget): void;
  onPicture?(target: PlaybackTarget): void;
  onMessage(message: MessageKey): void;
  onEnded(target: PlaybackTarget): void;
  onStopped(target: PlaybackTarget, clock: PlaybackClock): void;
  /** Remember what was on, so the app can come back to it. */
  rememberLast(id: string): void;
}

/** The browser trick for an HTTP address, on a page that can proxy it. */
export const httpFallback = (url: string, protocol?: string, origin?: string): string => {
  const scheme = protocol ?? window.location.protocol;
  const host = origin ?? window.location.origin;
  if (url.startsWith("https://")) {
    // HTTPS media can be fetched by an HTTP or packaged page when nothing else intervenes.
    if (scheme === "https:") return "";
    return `http://${url.slice("https://".length)}`;
  }
  if (!url.startsWith("http://")) return "";
  // HTTP media on an HTTP page does not need a relay, unless the engine already
  // refused it and the page can proxy it through itself.
  if (scheme === "http:") {
    const relay = new URL("/__openiptv_http_relay__", host);
    relay.searchParams.set("url", url);
    return relay.toString();
  }
  // Packaged pages have no server to relay through, so nothing can help.
  return "";
};

export const canUseHttpFallback = (): boolean =>
  !onTizen() && new Set(["http:", "https:"]).has(window.location.protocol);

const IDLE_SNAPSHOT: PlaybackSnapshot = {
  phase: "idle",
  paused: false,
  target: null,
  position: null,
  duration: null,
  seekRange: null,
  bufferedPercent: null,
  recoveryAttempt: 0,
  recoveryIn: 0,
  fault: null,
};

const EMPTY_CLOCK: PlaybackClock = {
  position: null,
  duration: null,
  seekableStart: null,
  seekableEnd: null,
  engineLiveEdge: null,
  segmentSeconds: null,
};

const IDLE_CAPABILITIES: PlaybackCapabilities = {
  canPause: false,
  audioTracks: [],
  subtitleTracks: [],
};

const RECOVERING_STAGES = new Set([
  "warm",
  "stream-fallback",
  "compatibility",
  "http-fallback",
  "reopen",
  "waiting",
]);

/*
 * What the session is keyed on: the target identity and a fingerprint of the address it was
 * first tuned with. A faulting session that has been redirected by a warm fix, a repair or an
 * HTTP fallback must still be recognised as the same session, so the address used by any given
 * attempt cannot be the key. The fingerprint keeps the key itself free of the full address.
 */
const fingerprint = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash.toString(36);
};

/**
 * One serialized seek intent. `ready` marks a session whose debounce is over, so a queued
 * session that is still accumulating waits rather than jumping an older engine call.
 * Playback intent belongs to the target and is read again when the seek finishes.
 * `goLive` marks a Go live request,
 * which rides the same queue so it serializes with ordinary seeks instead of calling the
 * engine in parallel.
 */
interface SeekSession {
  target: number;
  ready: boolean;
  goLive?: boolean;
}

const isLoading = (phase: PlaybackSnapshot["phase"]): boolean =>
  phase === "connecting" || phase === "rebuffering" || phase === "recovering";

const keyOf = (target: PlaybackTarget): string =>
  `${target.playlistId}:${target.id}:${fingerprint(target.url)}`;
const sameTarget = (left: PlaybackTarget | null, right: PlaybackTarget): boolean =>
  left?.id === right.id && left.playlistId === right.playlistId && left.url === right.url;

export const targetOf = (item: TuneItem, playlistId = ""): PlaybackTarget =>
  "mode" in item
    ? item
    : {
        id: item.id,
        playlistId: item.xtream?.playlistId ?? playlistId,
        mode: "live",
        kind: "live",
        name: item.name,
        group: item.group,
        logo: item.logo,
        url: item.url,
        ...(item.fallbackUrl ? { fallbackUrl: item.fallbackUrl } : {}),
      };

/**
 * The player's life.
 *
 * One engine-agnostic place that owns what it means to be watching something: the single
 * snapshot every surface reads, the preview channel a channel key settles on, the quick seek
 * that accumulates presses before asking the engine, and the recovery coordinator that
 * decides what a fault means. App.tsx renders the result; nothing else touches the player.
 */
export function usePlaybackController(options: PlaybackControllerOptions): PlaybackController {
  const { fit, video, compatibility, continuousReconnect } = options;

  const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(IDLE_SNAPSHOT);
  const [preview, setPreview] = useState<PlaybackTarget | null>(null);
  const [capabilities, setCapabilities] = useState<PlaybackCapabilities>(IDLE_CAPABILITIES);
  const [quickSeek, setQuickSeek] = useState<QuickSeekState | null>(null);
  const [subtitleCue, setSubtitleCue] = useState("");
  const [recovery, setRecovery] = useState<RecoveryState>({
    stage: "idle",
    cause: null,
    attempt: 0,
    retryIn: 0,
    statusVisible: false,
    hasPlayed: false,
    continuous: false,
    fault: null,
  });

  const player = useRef<Player>(null as unknown as Player);
  const coordinator = useRef<PlaybackRecoveryCoordinator>(
    null as unknown as PlaybackRecoveryCoordinator,
  );
  const currentRef = useRef<PlaybackTarget | null>(null);
  const previewRef = useRef<PlaybackTarget | null>(null);
  const playingIntent = useRef(true);
  const zapTimer = useRef(0);
  const zapFrame = useRef(0);
  const pendingStep = useRef<TuneItem | null>(null);
  const quickSeekTimer = useRef(0);
  const quickSeekTarget = useRef<number | null>(null);
  const pendingDelta = useRef(0);
  const [seeking, setSeeking] = useState(false);
  /*
   * Seek intent is serialized: the newest request waits in seekSession while at most one
   * native seek runs as seekInFlight.
   */
  const seekSession = useRef<SeekSession | null>(null);
  const seekInFlight = useRef<SeekSession | null>(null);
  /** Choices belong to the current item and match tracks by normalized identity. */
  const chosenTracks = useRef<{
    audio: TrackSelection | null;
    subtitle: TrackSelection | null;
  }>({ audio: null, subtitle: null });
  const cueTimer = useRef(0);
  const tuneToken = useRef(0);
  /** The token of the session the engine events belong to, so a late event from a torn
     down engine cannot mutate the session that replaced it. */
  const eventToken = useRef(-1);
  const seenPicture = useRef(false);
  const announced = useRef("");
  const wasAtLiveEdge = useRef(true);
  const hooks = useRef(options);
  const recoveryRef = useRef(recovery);
  const compatRef = useRef(compatibility);
  const continuousRef = useRef(continuousReconnect);
  /*
   * The mutable half of the snapshot: the fields the events and the clock fill in, published
   * as one object so every surface reads the same frame. Recovery fields come from the
   * coordinator's own state at publish time.
   */
  const parts = useRef({
    phase: IDLE_SNAPSHOT.phase,
    position: null as number | null,
    duration: null as number | null,
    seekRange: null as SeekRange | null,
    bufferedPercent: null as number | null,
    fault: null as string | null,
  });

  const publish = useCallback(() => {
    const p = parts.current;
    const r = recoveryRef.current;
    setSnapshot({
      phase: p.phase,
      paused: !playingIntent.current,
      target: currentRef.current,
      position: p.position,
      duration: p.duration,
      seekRange: p.seekRange,
      bufferedPercent: p.bufferedPercent,
      recoveryAttempt: r.attempt,
      recoveryIn: r.retryIn,
      fault: p.fault,
    });
  }, []);

  const refreshCapabilities = useCallback(() => {
    const tracks = player.current?.getTracks() ?? [];
    setCapabilities({
      canPause: !!currentRef.current,
      audioTracks: tracks.filter((track) => track.kind === "audio"),
      subtitleTracks: tracks.filter((track) => track.kind === "subtitle"),
    });
  }, []);

  /*
   * Restore choices after playback starts, since AVPlay may reset READY selections on Play.
   * Later track reports also restore choices when stream metadata arrives late. An exact
   * normalized identity match wins, an automatic subtitle choice takes the one track in the
   * device language, and an explicit Off stays off. Anything absent falls back to the
   * provider's default rather than guessing.
   */
  const applyingTracks = useRef(false);
  const trackPlaybackReady = useRef(false);
  const reapplyTrackChoices = useCallback((force = false) => {
    if (!trackPlaybackReady.current || applyingTracks.current) return;
    applyingTracks.current = true;
    try {
      const tracks = player.current?.getTracks() ?? [];
      const deviceLanguage = typeof navigator !== "undefined" ? navigator.language : "";
      for (const kind of ["audio", "subtitle"] as const) {
        const choice = chosenTracks.current[kind];
        if (!choice) continue;
        const ofKind = tracks.filter((track) => track.kind === kind);
        if (choice.identity === null && !choice.automatic) {
          // AVPlay can omit selection flags even while subtitle output is enabled.
          player.current?.selectTrack(kind, null);
          continue;
        }
        const wanted = choice.automatic
          ? automaticTrack(ofKind, deviceLanguage)
          : ofKind.find((track) => track.identity === choice.identity);
        if (wanted && (force || !wanted.selected))
          player.current?.selectTrack(kind, wanted.engineIndex);
      }
    } finally {
      applyingTracks.current = false;
    }
  }, []);

  const refreshClock = useCallback(() => {
    const target = currentRef.current;
    if (!player.current || !target) return;
    const clock: PlaybackClock = player.current.getClock();
    parts.current.position = clock.position;
    parts.current.duration = clock.duration;
    if (clock.seekableStart !== null && clock.seekableEnd !== null) {
      const range: SeekRange = {
        startSeconds: clock.seekableStart,
        endSeconds: clock.seekableEnd,
        liveEdge: false,
      };
      const useful =
        target.mode === "finite"
          ? finiteSeekRange(
              clock.duration ?? null,
              clock.seekableStart ?? undefined,
              clock.seekableEnd ?? undefined,
            )
          : usefulLiveRange(range)
            ? range
            : null;
      if (useful && target.mode === "live") {
        const edge = clock.engineLiveEdge ?? clock.seekableEnd;
        const safe = safeLiveTarget(
          range,
          clock.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS,
          edge,
        );
        useful.liveEdge =
          clock.position !== null &&
          isAtLiveEdge(
            clock.position,
            safe,
            clock.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS,
            wasAtLiveEdge.current,
          );
        wasAtLiveEdge.current = useful.liveEdge;
      }
      parts.current.seekRange = useful;
    } else {
      parts.current.seekRange =
        target.mode === "finite" ? finiteSeekRange(clock.duration) : null;
    }
    publish();
  }, [publish]);

  const open = useCallback((request: PlayerOpenRequest) => {
    trackPlaybackReady.current = false;
    player.current?.play(request);
  }, []);

  const diagnose = useCallback(async (session: RecoverySession) => {
    const prepared = await prepare(session.originalUrl, session.target.playlistId, true);
    if (!prepared?.repaired) return null;
    return { ...session.request, url: prepared.url, browserRepair: prepared.browser };
  }, []);

  const fallback = useCallback((session: RecoverySession) => {
    if (!canUseHttpFallback()) return null;
    const url = httpFallback(session.originalUrl);
    if (!url) return null;
    return { ...session.request, url };
  }, []);

  const suspend = useCallback(() => {
    player.current?.hide();
    pauseRepair();
    releaseAllArtwork();
  }, []);

  const restore = useCallback(() => {
    resumeRepair();
    if (!currentRef.current) return true;
    player.current?.show();
    const stage = recoveryRef.current.stage;
    // True when the engine is expected to come back on its own: an untouched picture, a
    // terminal state, or a buffer that simply resumes. A fault episode already in flight
    // needs one coordinated reopen instead of whatever the engine was doing when hidden.
    return stage === "idle" || stage === "terminal" || stage === "buffering";
  }, []);

  if (!coordinator.current) {
    coordinator.current = new PlaybackRecoveryCoordinator({
      clock: () => player.current?.getClock() ?? EMPTY_CLOCK,
      warmRecover: (kind) => {
        trackPlaybackReady.current = false;
        return player.current?.warmRecover(kind) ?? false;
      },
      diagnose,
      streamFallback: (session) => {
        const url = session.target.fallbackUrl;
        if (!url || url === session.originalUrl) return null;
        return { ...session.request, url, browserRepair: false };
      },
      fallback,
      reopen: (request) => {
        const hadPicture = seenPicture.current;
        seenPicture.current = false;
        parts.current.phase = "connecting";
        const target = currentRef.current;
        const position = player.current?.getClock().position;
        const opened = {
          ...request,
          startSeconds:
            target?.mode === "finite" &&
            (hadPicture || (position ?? 0) > 0) &&
            position !== null &&
            position !== undefined
              ? position
              : request.startSeconds,
        };
        open(opened);
        return opened;
      },
      suspend,
      restore,
      emit: (state) => {
        recoveryRef.current = state;
        setRecovery(state);
        if (state.stage === "terminal") {
          parts.current.phase = "failed";
          parts.current.fault = state.fault;
        } else if (RECOVERING_STAGES.has(state.stage)) {
          parts.current.phase = "recovering";
          parts.current.fault = null;
        }
        publish();
      },
    });
  }

  const applyReadyIntent = useCallback(() => {
    parts.current.phase = playingIntent.current ? "playing" : "paused";
    if (
      !playingIntent.current &&
      !seekSession.current &&
      !seekInFlight.current &&
      !player.current.pause()
    ) {
      playingIntent.current = true;
      parts.current.phase = "playing";
      hooks.current.onMessage("deck.pauseUnavailable");
    }
    coordinator.current.paused(!playingIntent.current);
  }, []);

  const handleEvent = useCallback(
    (e: PlayerEvent) => {
      if (eventToken.current !== tuneToken.current) return;
      switch (e.type) {
        case "buffering-start":
          coordinator.current.bufferingStarted();
          parts.current.phase = seenPicture.current ? "rebuffering" : "connecting";
          break;
        case "buffering-progress":
          coordinator.current.bufferingProgress(e.percent);
          parts.current.bufferedPercent = Math.max(0, Math.min(100, Math.round(e.percent)));
          break;
        case "buffering-complete":
          coordinator.current.bufferingEnded();
          if (seenPicture.current && !RECOVERING_STAGES.has(recoveryRef.current.stage))
            applyReadyIntent();
          break;
        case "paused":
          if (seenPicture.current) {
            coordinator.current.paused(!playingIntent.current);
            if (!isLoading(parts.current.phase)) parts.current.phase = "paused";
          } else {
            parts.current.phase = "connecting";
          }
          break;
        case "playing": {
          const firstTrackRestore = !trackPlaybackReady.current;
          trackPlaybackReady.current = true;
          seenPicture.current = true;
          coordinator.current.playing();
          applyReadyIntent();
          reapplyTrackChoices(firstTrackRestore);
          parts.current.fault = null;
          refreshClock();
          const target = currentRef.current;
          if (target && announced.current !== target.id) {
            announced.current = target.id;
            hooks.current.onPicture?.(target);
          }
          refreshCapabilities();
          break;
        }
        case "ended": {
          const target = currentRef.current;
          if (!target) break;
          trackPlaybackReady.current = false;
          window.clearTimeout(cueTimer.current);
          setSubtitleCue("");
          if (target.mode === "live") {
            coordinator.current.fault("STREAM_ENDED", null, "stream-ended");
            break;
          }
          coordinator.current.stop();
          refreshClock();
          hooks.current.onEnded(target);
          tuneToken.current += 1;
          currentRef.current = null;
          playingIntent.current = true;
          announced.current = "";
          seenPicture.current = false;
          setPreview(null);
          setQuickSeek(null);
          setCapabilities(IDLE_CAPABILITIES);
          window.clearTimeout(quickSeekTimer.current);
          quickSeekTarget.current = null;
          pendingDelta.current = 0;
          seekSession.current = null;
          seekInFlight.current = null;
          setSeeking(false);
          player.current?.stop();
          stopRepair();
          parts.current.phase = "idle";
          parts.current.position = null;
          parts.current.duration = null;
          parts.current.seekRange = null;
          parts.current.bufferedPercent = null;
          parts.current.fault = null;
          break;
        }
        case "error":
          window.clearTimeout(cueTimer.current);
          setSubtitleCue("");
          coordinator.current.setContinuousReconnect(continuousRef.current);
          coordinator.current.fault(
            e.code,
            e.warmKind,
            e.warmKind === "media" ? "engine-media" : "engine-network",
          );
          break;
        case "tracks":
          refreshCapabilities();
          reapplyTrackChoices();
          break;
        case "subtitle": {
          window.clearTimeout(cueTimer.current);
          setSubtitleCue(e.text);
          if (e.text && e.durationMs > 0) {
            cueTimer.current = window.setTimeout(() => setSubtitleCue(""), e.durationMs);
          }
          break;
        }
      }
      publish();
    },
    [publish, refreshCapabilities, refreshClock, reapplyTrackChoices, applyReadyIntent],
  );

  if (!player.current) {
    player.current = new Player(handleEvent);
  }

  hooks.current = options;
  compatRef.current = compatibility;
  continuousRef.current = continuousReconnect;

  const tuneTo = useCallback(
    (target: PlaybackTarget) => {
      trackPlaybackReady.current = false;
      chosenTracks.current = playbackTrackChoices(target);
      tuneToken.current += 1;
      const token = tuneToken.current;
      eventToken.current = token;
      window.clearTimeout(quickSeekTimer.current);
      setQuickSeek(null);
      setCapabilities({ ...IDLE_CAPABILITIES, canPause: true });
      quickSeekTarget.current = null;
      pendingDelta.current = 0;
      seekSession.current = null;
      seekInFlight.current = null;
      setSeeking(false);
      seenPicture.current = false;
      parts.current.bufferedPercent = null;
      parts.current.fault = null;
      parts.current.phase = "connecting";
      parts.current.position = null;
      parts.current.duration = null;
      parts.current.seekRange = null;
      publish();

      const begin = (request: PlayerOpenRequest) => {
        if (tuneToken.current !== token) return;
        coordinator.current.select({
          key: keyOf(target),
          target,
          originalUrl: target.url,
          request,
          segmentSeconds: request.segmentSeconds,
          compatibility: compatRef.current,
          continuousReconnect: continuousRef.current,
        });
        coordinator.current.paused(!playingIntent.current);
        open(request);
      };

      if (target.mode === "finite" || !compatRef.current) {
        idleRepair();
        begin({
          url: target.url,
          browserRepair: false,
          bufferSeconds: DEFAULT_INITIAL_BUFFER_SECONDS,
          segmentSeconds: DEFAULT_SEGMENT_SECONDS,
          mode: target.mode,
          startSeconds: target.resumeAt ?? 0,
        });
        return;
      }
      /*
       * Compatibility mode asks the playlist about its own health before the engine sees it,
       * so a broken channel is repaired before it can show one frame and stall rather than
       * after. The result is an ordinary open request, so the player itself never knows.
       */
      const preparing = prepare(target.url, target.playlistId);
      coordinator.current.stop();
      // Stop the old picture while checking the new stream, but retain the decoder.
      player.current?.stop(false);
      void preparing.then((prepared) => {
        if (tuneToken.current !== token) return;
        if (!compatRef.current || !prepared) {
          idleRepair();
          begin({
            url: target.url,
            browserRepair: false,
            bufferSeconds: DEFAULT_INITIAL_BUFFER_SECONDS,
            segmentSeconds: DEFAULT_SEGMENT_SECONDS,
            mode: target.mode,
            startSeconds: 0,
          });
          return;
        }
        if (!prepared.repaired) idleRepair();
        begin({
          url: prepared.repaired ? prepared.url : target.url,
          browserRepair: prepared.browser,
          bufferSeconds: prepared.bufferSeconds,
          segmentSeconds: prepared.segmentSeconds,
          mode: target.mode,
          startSeconds: 0,
        });
        if (prepared.cached) {
          void revalidate(target.url, target.playlistId).then((changed) => {
            if (changed && sameTarget(currentRef.current, target)) tuneTo(target);
          });
        }
      });
    },
    [open, publish],
  );

  const start = useCallback(
    (item: TuneItem, opts?: { restart?: boolean }) => {
      const target = { ...targetOf(item, hooks.current.playlistId) };
      if (opts?.restart) target.resumeAt = 0;
      window.clearTimeout(zapTimer.current);
      cancelAnimationFrame(zapFrame.current);
      zapFrame.current = 0;
      pendingStep.current = null;
      previewRef.current = null;
      setPreview(null);
      if (sameTarget(currentRef.current, target) && !opts?.restart) return;
      currentRef.current = target;
      playingIntent.current = true;
      announced.current = "";
      wasAtLiveEdge.current = true;
      setQuickSeek(null);
      quickSeekTarget.current = null;
      pendingDelta.current = 0;
      seekSession.current = null;
      seekInFlight.current = null;
      setSeeking(false);
      window.clearTimeout(quickSeekTimer.current);
      window.clearTimeout(cueTimer.current);
      setSubtitleCue("");
      hooks.current.onNamed(target);
      hooks.current.rememberLast(target.id);
      tuneTo(target);
    },
    [tuneTo],
  );

  const stop = useCallback(() => {
    trackPlaybackReady.current = false;
    flushPlaybackTrackChoices();
    const target = currentRef.current;
    if (target) hooks.current.onStopped(target, player.current.getClock());
    tuneToken.current += 1;
    currentRef.current = null;
    playingIntent.current = true;
    announced.current = "";
    seenPicture.current = false;
    previewRef.current = null;
    setPreview(null);
    setQuickSeek(null);
    setCapabilities(IDLE_CAPABILITIES);
    quickSeekTarget.current = null;
    pendingDelta.current = 0;
    seekSession.current = null;
    seekInFlight.current = null;
    setSeeking(false);
    window.clearTimeout(zapTimer.current);
    cancelAnimationFrame(zapFrame.current);
    zapFrame.current = 0;
    pendingStep.current = null;
    window.clearTimeout(quickSeekTimer.current);
    window.clearTimeout(cueTimer.current);
    setSubtitleCue("");
    coordinator.current.stop();
    player.current?.stop();
    // Nothing is playing, so nothing needs a socket listening on the set's loopback address.
    stopRepair();
    parts.current.phase = "idle";
    parts.current.position = null;
    parts.current.duration = null;
    parts.current.seekRange = null;
    parts.current.bufferedPercent = null;
    parts.current.fault = null;
    publish();
  }, [publish]);

  const retune = useCallback(() => {
    const target = currentRef.current;
    if (!target) return;
    announced.current = "";
    tuneTo(target);
  }, [tuneTo]);

  const commitStep = useCallback(() => {
    if (!pendingStep.current || zapFrame.current) return;
    window.clearTimeout(zapTimer.current);
    cancelAnimationFrame(zapFrame.current);
    // Paint the latest preview before AVPlay's synchronous stop and open calls.
    zapFrame.current = requestAnimationFrame(() => {
      zapFrame.current = requestAnimationFrame(() => {
        zapFrame.current = 0;
        const item = pendingStep.current;
        if (item) start(item);
      });
    });
  }, [start]);

  const step = useCallback(
    (delta: 1 | -1, list: readonly TuneItem[], repeated = false) => {
      if (!list.length) return;
      const anchor = previewRef.current ?? currentRef.current;
      const fromIndex = list.findIndex((item) => item.id === anchor?.id);
      const origin = fromIndex === -1 ? (delta > 0 ? -1 : 0) : fromIndex;
      const item = list[(((origin + delta) % list.length) + list.length) % list.length];
      const target = targetOf(item, hooks.current.playlistId);
      previewRef.current = target;
      setPreview(target);
      hooks.current.onNamed(target);
      window.clearTimeout(zapTimer.current);
      cancelAnimationFrame(zapFrame.current);
      zapFrame.current = 0;
      pendingStep.current = item;
      zapTimer.current = window.setTimeout(() => start(item), 450);
      if (!repeated) commitStep();
    },
    [start, commitStep],
  );

  const setPlaying = useCallback(
    (play: boolean): boolean => {
      const target = currentRef.current;
      if (!target || !player.current) return false;
      const phase = parts.current.phase;
      if (phase === "idle" || phase === "failed" || phase === "ended") return false;
      const previous = playingIntent.current;
      playingIntent.current = play;
      coordinator.current.paused(!play);
      // Loading and serialized seeks finish before the latest choice reaches the engine.
      if (isLoading(phase) || seekSession.current || seekInFlight.current) {
        publish();
        return true;
      }
      if ((play && phase === "playing") || (!play && phase === "paused")) {
        publish();
        return previous !== play;
      }
      if (play) {
        /*
         * A live channel holding a seek window is a DVR channel, and resume means resume:
         * retuning would land back on the live edge and throw the paused position away.
         * Only an ordinary channel with no window earns a retune.
         */
        if (target.mode === "finite" || parts.current.seekRange) {
          if (!player.current.resumePlayback()) {
            playingIntent.current = previous;
            coordinator.current.paused(!previous);
            publish();
            return false;
          }
          parts.current.phase = "playing";
        } else {
          tuneTo(target);
        }
      } else {
        if (!player.current.pause()) {
          playingIntent.current = previous;
          coordinator.current.paused(!previous);
          publish();
          return false;
        }
        parts.current.phase = "paused";
      }
      publish();
      return true;
    },
    [publish, tuneTo],
  );

  const togglePlaying = useCallback((): boolean => {
    return setPlaying(!playingIntent.current);
  }, [setPlaying]);

  /*
   * One native seek at a time. The named inner function lets a finished seek hand straight
   * on to a queued session that is ready, without the callback depending on its own
   * identity.
   */
  const commitSeek = useCallback(
    function run(session: SeekSession) {
      const target = currentRef.current;
      const engine = player.current;
      if (!target || !engine) return;
      const range = parts.current.seekRange;
      if (!range) {
        /*
         * The window went away between queue and commit. Release the seek flags and
         * restore the intent the temporary pause stood in for, rather than leaving the
         * engine paused and the coordinator seeking for ever.
         */
        coordinator.current.seeking(false);
        setSeeking(false);
        if (playingIntent.current) {
          const resumed = engine.resumePlayback();
          if (resumed) {
            coordinator.current.paused(false);
            if (!isLoading(parts.current.phase)) parts.current.phase = "playing";
          }
        }
        publish();
        return;
      }
      seekInFlight.current = session;
      if (playingIntent.current && parts.current.phase === "playing") {
        engine.pause();
        coordinator.current.paused(true);
        parts.current.phase = "paused";
      }
      setSeeking(true);
      const clamped = clampSeekTarget(session.target, range);
      const token = tuneToken.current;
      coordinator.current.seeking(true);
      publish();
      void engine.seekTo(clamped).then((moved) => {
        if (tuneToken.current !== token || currentRef.current !== target) return;
        if (seekInFlight.current !== session) return;
        seekInFlight.current = null;
        /*
         * A newer request that arrived while the engine was moving wins. It is already the
         * viewer's latest word, so resuming this session's intent would be wrong: seeking
         * stays flagged and only its own completion restores playback.
         */
        const newer = seekSession.current;
        if (newer) {
          if (newer.ready) {
            seekSession.current = null;
            run(newer);
          }
          publish();
          return;
        }
        coordinator.current.seeking(false);
        setSeeking(false);
        if (moved) {
          if (target.mode === "live") wasAtLiveEdge.current = !!session.goLive;
          refreshClock();
        } else {
          /*
           * A Go live the engine refused falls back to a fresh tune, the same recovery
           * the old direct call used, and the retune resets the seek state itself.
           */
          if (session.goLive) {
            tuneTo(target);
            return;
          }
          hooks.current.onMessage("error.seekUnavailable");
          refreshClock();
        }
        if (!moved && isLoading(parts.current.phase)) {
          publish();
          return;
        }
        if (playingIntent.current) {
          const resumed = engine.resumePlayback();
          if (resumed) {
            coordinator.current.paused(false);
            parts.current.phase = "playing";
          }
        } else {
          engine.pause();
          coordinator.current.paused(true);
          parts.current.phase = "paused";
        }
        publish();
      });
    },
    [publish, refreshClock, tuneTo],
  );

  /*
   * End the debounce now. Dismissing the controls, opening a drawer, or the settle timer
   * itself all land here: the pending session becomes ready and commits at once unless an
   * older native seek is still running, in which case its callback picks this up. With no
   * pending session there is nothing to do.
   */
  const flushSeek = useCallback(() => {
    window.clearTimeout(quickSeekTimer.current);
    setQuickSeek(null);
    quickSeekTarget.current = null;
    pendingDelta.current = 0;
    const pending = seekSession.current;
    if (!pending) return;
    pending.ready = true;
    if (!seekInFlight.current) {
      seekSession.current = null;
      commitSeek(pending);
    }
  }, [commitSeek]);

  const queueSeek = useCallback(
    (seconds: number, deltaSeconds = 0, goLive = false, waitForRelease = false) => {
      const target = currentRef.current;
      if (!target) return;
      const range = parts.current.seekRange ?? finiteSeekRange(parts.current.duration);
      if (!range) return;
      const next = clampSeekTarget(seconds, range);
      let session = seekSession.current;
      if (!session) {
        session = { target: next, ready: false, goLive };
        seekSession.current = session;
      } else {
        /* The newest request always wins, including an ordinary seek superseding a
           queued Go live. */
        session.target = next;
        session.ready = false;
        session.goLive = goLive;
      }
      if (deltaSeconds) {
        pendingDelta.current += deltaSeconds;
        quickSeekTarget.current = next;
        setQuickSeek({ deltaSeconds: pendingDelta.current, targetSeconds: next });
      }
      window.clearTimeout(quickSeekTimer.current);
      quickSeekTimer.current = window.setTimeout(
        flushSeek,
        waitForRelease ? SEEK_HOLD_FALLBACK_MS : SEEK_SETTLE_MS,
      );
      publish();
    },
    [flushSeek, publish],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const target = currentRef.current;
      if (!target) return;
      /*
       * Quick seeks accumulate presses for one settle period, because a held Rewind key
       * sends a stream of them and the engine only needs to hear about the last. Deck
       * seeks commit through seekTo instead, where the highlight already is. The base is
       * the newest word on position: a queued target, then the seek already running, then
       * the clock.
       */
      const range = parts.current.seekRange ?? finiteSeekRange(parts.current.duration);
      if (!range) return;
      const base =
        seekSession.current?.target ??
        seekInFlight.current?.target ??
        quickSeekTarget.current ??
        parts.current.position ??
        target.resumeAt ??
        0;
      queueSeek(base + deltaSeconds, deltaSeconds);
    },
    [queueSeek],
  );

  const settleSeek = useCallback(() => {
    if (!seekSession.current || seekSession.current.ready) return;
    window.clearTimeout(quickSeekTimer.current);
    quickSeekTimer.current = window.setTimeout(flushSeek, SEEK_SETTLE_MS);
  }, [flushSeek]);

  const seekTo = useCallback(
    (seconds: number, waitForRelease = false) => {
      pendingDelta.current = 0;
      quickSeekTarget.current = null;
      setQuickSeek(null);
      queueSeek(seconds, 0, false, waitForRelease);
    },
    [queueSeek],
  );

  const goLive = useCallback(() => {
    const target = currentRef.current;
    const engine = player.current;
    const range = parts.current.seekRange;
    if (!target || !engine || !range || target.mode !== "live") return;
    const clock = engine.getClock();
    const segment = clock.segmentSeconds ?? DEFAULT_SEGMENT_SECONDS;
    const safe = safeLiveTarget(range, segment, clock.engineLiveEdge ?? range.endSeconds);
    /*
     * Go live is a seek like any other: it queues, commits at once, and serializes
     * behind a seek already in flight rather than calling the engine in parallel. A
     * newer request still supersedes it, exactly as an ordinary seek would.
     */
    queueSeek(safe, 0, true);
    flushSeek();
  }, [queueSeek, flushSeek]);

  const selectTrack = useCallback(
    (kind: "audio" | "subtitle", engineIndex: number | null, selection?: TrackSelection) => {
      const previous = chosenTracks.current[kind];
      const choice = selection ?? {
        identity:
          player.current
            ?.getTracks()
            .find((track) => track.kind === kind && track.engineIndex === engineIndex)
            ?.identity ?? null,
      };
      chosenTracks.current[kind] = choice;
      applyingTracks.current = true;
      let moved = false;
      try {
        moved = player.current?.selectTrack(kind, engineIndex) ?? false;
      } finally {
        applyingTracks.current = false;
        if (!moved) chosenTracks.current[kind] = previous;
      }
      if (moved) {
        const target = currentRef.current;
        if (target) rememberPlaybackTrackChoice(target, kind, choice);
        if (kind === "subtitle") {
          window.clearTimeout(cueTimer.current);
          setSubtitleCue("");
        }
        refreshCapabilities();
      }
      return moved;
    },
    [refreshCapabilities],
  );

  const setMuted = useCallback((mute: boolean) => player.current?.setMuted(mute), []);
  const adjustVolume = useCallback((dir: 1 | -1) => player.current?.adjustVolume(dir), []);
  const getStats = useCallback(() => player.current?.getStats() ?? null, []);

  /* The engine attaches to whichever video element the active screen currently renders. */
  const attachedVideo = useRef<HTMLVideoElement | null>(null);
  useLayoutEffect(() => {
    const element = video.current;
    if (attachedVideo.current === element) return;
    if (attachedVideo.current) player.current.detach();
    if (element) player.current.attach(element);
    attachedVideo.current = element;
  });
  useEffect(
    () => () => {
      player.current.detach();
      attachedVideo.current = null;
    },
    [],
  );

  useEffect(() => {
    player.current.setFit(fit);
  }, [fit]);

  /*
   * The clock: finite positions are sampled once a second, live ranges every two seconds so
   * the drift between the seekable window and the live edge stays honest, and nothing is
   * polled while the page is hidden.
   */
  const targetId = snapshot.target?.id;
  const targetMode = snapshot.target?.mode;
  useEffect(() => {
    if (!targetId) return;
    const live = targetMode === "live";
    const tick = () => {
      if (live && document.hidden) return;
      refreshClock();
    };
    refreshClock();
    const timer = window.setInterval(tick, live ? 2000 : 1000);
    return () => window.clearInterval(timer);
  }, [targetId, targetMode, refreshClock]);

  /* The setting is read live so toggling it mid wait takes effect on this session. */
  useEffect(() => {
    coordinator.current?.setContinuousReconnect(continuousReconnect);
  }, [continuousReconnect]);

  /* Hiding the page suspends whatever is playing; returning coordinates one restore. */
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        flushPlaybackTrackChoices();
        coordinator.current.hidden();
      } else coordinator.current.visible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(
    () => () => {
      flushPlaybackTrackChoices();
      const target = currentRef.current;
      if (target) hooks.current.onStopped(target, player.current.getClock());
      /*
       * Invalidate every callback still owed by the engine: a native seek or a late
       * event resolving after teardown must not resume playback, report through a dead
       * hook, or mutate whatever replaces this session. No state may be set here, the
       * component is already gone.
       */
      tuneToken.current += 1;
      currentRef.current = null;
      seekSession.current = null;
      seekInFlight.current = null;
      quickSeekTarget.current = null;
      pendingDelta.current = 0;
      window.clearTimeout(zapTimer.current);
      cancelAnimationFrame(zapFrame.current);
      zapFrame.current = 0;
      pendingStep.current = null;
      window.clearTimeout(quickSeekTimer.current);
      window.clearTimeout(cueTimer.current);
      // Effect replay reuses this coordinator, so release the session without disposing it.
      coordinator.current.stop(false);
      player.current.stop();
      idleRepair();
    },
    [],
  );

  const shown = preview ?? snapshot.target;

  return {
    snapshot,
    preview,
    capabilities,
    quickSeek,
    subtitleCue,
    recovery,
    shown,
    start,
    stop,
    retune,
    step,
    commitStep,
    setPlaying,
    togglePlaying,
    seekBy,
    seekTo,
    settleSeek,
    flushSeek,
    seeking,
    goLive,
    selectTrack,
    setMuted,
    adjustVolume,
    getStats,
  };
}
