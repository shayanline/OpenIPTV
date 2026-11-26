import type { PlaybackTarget } from "../types";
import { faultPolicy } from "./errors";
import type { PlaybackClock, PlayerOpenRequest } from "./player";
import { DEFAULT_SEGMENT_SECONDS } from "./playbackRange";

/**
 * The one place that decides what happens after a stream misbehaves.
 *
 * Recovery used to live in three places at once: the player ran a startup watchdog and a
 * frozen picture sampler, the hook ran compatibility diagnosis, the HTTP fallback and the
 * retry countdown as separate effects, and each owned its own timers. A channel change had
 * to cancel work in four places and routinely missed one, which is how a repair belonging
 * to a channel nobody was watching any more could still open a connection.
 *
 * Here one token invalidates every pending step, one stage describes where recovery is,
 * and the timers are named fields rather than whatever an effect happened to leave behind.
 * The engine itself is reached only through the injected actions, so this file never
 * touches AVPlay, hls.js, the network or the DOM, and the only thing it ever says about a
 * target is a cause and an attempt number.
 */

export type RecoveryCause =
  | "startup-timeout"
  | "reported-buffer"
  | "frozen-playhead"
  | "engine-network"
  | "engine-media"
  | "stream-ended"
  | "visibility-restore";

export type RecoveryStage =
  | "idle"
  | "buffering"
  | "warm"
  | "compatibility"
  | "http-fallback"
  | "reopen"
  | "waiting"
  | "terminal";

export interface RecoverySession {
  /**
   * Identity of the original target: the target id plus a fingerprint of its original
   * address. Corrective steps are marked against this, so an HTTP fallback that rewrites
   * the address cannot earn a second compatibility diagnosis. The address itself is never
   * kept beyond the session's own request.
   */
  key: string;
  target: PlaybackTarget;
  /** The address the viewer asked for, before any repair or fallback rewrite. */
  originalUrl: string;
  /** The open request an ordinary reopen uses. */
  request: PlayerOpenRequest;
  segmentSeconds: number;
  /** Whether compatibility diagnosis is enabled for this session. */
  compatibility: boolean;
  /** Whether the viewer has asked live channels to keep reconnecting. */
  continuousReconnect: boolean;
}

export interface RecoveryState {
  stage: RecoveryStage;
  cause: RecoveryCause | null;
  /** Application delayed retries already fired for the selected session. */
  attempt: number;
  /** Seconds until the next delayed retry, or zero when none is pending. */
  retryIn: number;
  /** Whether compact recovery feedback may be shown over the picture. */
  statusVisible: boolean;
  /** Whether this target has produced a picture at least once. */
  hasPlayed: boolean;
  /** Whether the session retries without a bound, so the attempt number has no total. */
  continuous: boolean;
  /** The engine code behind the current episode, for classification rather than display. */
  fault: string | null;
}

export interface RecoveryActions {
  /** The engine's current clock, sampled for frozen picture detection. */
  clock(): PlaybackClock;
  /** Let the engine fix itself without a teardown. True means an attempt was started. */
  warmRecover(kind: "network" | "media" | null): boolean;
  /** Compatibility diagnosis of the original address, or null when nothing was repaired. */
  diagnose(session: RecoverySession): Promise<PlayerOpenRequest | null>;
  /** The HTTP fallback request for the original address, or null when none applies. */
  fallback(session: RecoverySession): PlayerOpenRequest | null;
  /** Open a request through the ordinary playback pipeline. */
  reopen(request: PlayerOpenRequest): void;
  /** Give the engine and decoder back while the app is off screen. */
  suspend(): void;
  /** Take the engine back on return. False means a coordinated recovery is needed. */
  restore(): boolean;
  /** Publish the whole recovery state after any change. */
  emit(state: RecoveryState): void;
}

/**
 * How long a new target may sit without a picture before it counts as failed. Thirty
 * seconds, matching the limit the player used to run itself: public relays can genuinely
 * take twenty to produce a first segment.
 */
const STARTUP_LIMIT_MS = 30000;

/**
 * Rebuffering shorter than this produces no overlay at all, since a one second refill is
 * ordinary adaptive playback and not worth telling anybody about.
 */
const STATUS_DELAY_MS = 1500;

/**
 * How long a reported buffer refill may continue before it is treated as a fault. Twenty
 * seconds for a direct stream, or twice the known segment duration where one is measured,
 * capped so a pathological manifest cannot stall recovery for ever.
 */
const BUFFER_LIMIT_MS = 20000;
const BUFFER_LIMIT_CAP_MS = 45000;

/**
 * A frozen picture is the fault neither engine reports, so it is found by sampling the
 * playhead: no advance in twelve seconds means no programme, whatever the engine claims.
 */
const STALL_TICK_MS = 3000;
const STALL_LIMIT_MS = 12000;

/**
 * Playing uninterrupted for this long proves the fault is over, so the attempt count and
 * any continuous reconnect delay return to their start.
 */
const STABLE_PLAYING_MS = 30000;

/** Application retry delays for a fault nothing else fixed: four, eight, fifteen. */
export const RETRY_DELAYS_MS = [4000, 8000, 15000];

/**
 * Continuous reconnect delays for live targets: thirty, forty five, then sixty for every
 * remaining attempt while the same channel stays selected.
 */
const CONTINUOUS_FIRST_MS = 30000;
const CONTINUOUS_SECOND_MS = 45000;
const CONTINUOUS_DELAY_MS = 60000;

export class PlaybackRecoveryCoordinator {
  private session: RecoverySession | null = null;
  /**
   * One number that invalidates every pending step. A diagnosis in flight for a target the
   * viewer has already left compares against it and quietly does nothing.
   */
  private token = 0;
  private stage: RecoveryStage = "idle";
  private cause: RecoveryCause | null = null;
  private attempt = 0;
  private retryIn = 0;
  private statusVisible = false;
  private faultCode: string | null = null;
  private seenPicture = false;
  private hasPlayed = false;
  private offscreen = false;
  private disposed = false;
  private seekingActive = false;
  private pausedActive = false;
  /** Whether this episode has already offered the engine a warm fix. */
  private warmTried = false;
  /** The request the next reopen uses, rewritten by diagnosis or fallback. */
  private currentRequest: PlayerOpenRequest | null = null;
  /** Corrective steps already spent, keyed by the original target identity. */
  private compatibilityTried = new Set<string>();
  private fallbackTried = new Set<string>();

  private startupTimer: number | undefined;
  private statusTimer: number | undefined;
  private bufferTimer: number | undefined;
  private retryTimer: number | undefined;
  private retryTick: number | undefined;
  private stallTimer: number | undefined;
  private stableTimer: number | undefined;
  private lastPosition = -1;
  private stalledFor = 0;

  constructor(private readonly actions: RecoveryActions) {}

  private emit() {
    this.actions.emit({
      stage: this.stage,
      cause: this.cause,
      attempt: this.attempt,
      retryIn: this.retryIn,
      statusVisible: this.statusVisible,
      hasPlayed: this.hasPlayed,
      continuous:
        this.session?.continuousReconnect === true && this.session.request.mode === "live",
      fault: this.faultCode,
    });
  }

  private clearDetection() {
    window.clearTimeout(this.startupTimer);
    window.clearTimeout(this.statusTimer);
    window.clearTimeout(this.bufferTimer);
    window.clearInterval(this.stallTimer);
    window.clearTimeout(this.stableTimer);
    this.startupTimer = undefined;
    this.statusTimer = undefined;
    this.bufferTimer = undefined;
    this.stallTimer = undefined;
    this.stableTimer = undefined;
  }

  private clearRetry() {
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.retryTick);
    this.retryTimer = undefined;
    this.retryTick = undefined;
  }

  private clearAll() {
    this.clearDetection();
    this.clearRetry();
  }

  private bufferLimitMs(): number {
    const segment = this.session?.segmentSeconds || DEFAULT_SEGMENT_SECONDS;
    return Math.min(BUFFER_LIMIT_CAP_MS, Math.max(BUFFER_LIMIT_MS, segment * 2000));
  }

  /** The buffer limit doubles as the bound on a warm attempt that never answers. */
  private armBufferLimit() {
    window.clearTimeout(this.bufferTimer);
    this.bufferTimer = window.setTimeout(() => {
      if (this.stage === "warm") {
        void this.continueRecovery();
        return;
      }
      this.cause = "reported-buffer";
      this.runRecovery(null);
    }, this.bufferLimitMs());
  }

  private armStatusDelay() {
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.statusVisible = true;
      this.emit();
    }, STATUS_DELAY_MS);
  }

  private armStartup() {
    window.clearTimeout(this.startupTimer);
    this.startupTimer = window.setTimeout(() => {
      this.faultCode = "TIMEOUT";
      this.cause = "startup-timeout";
      this.runRecovery(null);
    }, STARTUP_LIMIT_MS);
  }

  /**
   * Watch the playhead while a picture claims to be playing.
   *
   * Deliberate pause, a pending seek, reported buffering and being off screen are all
   * legitimate stillness, so none of them count. Everything else gets twelve seconds.
   */
  private armStallSampling() {
    window.clearInterval(this.stallTimer);
    this.lastPosition = -1;
    this.stalledFor = 0;
    this.stallTimer = window.setInterval(() => {
      if (
        this.stage !== "idle" ||
        this.offscreen ||
        this.seekingActive ||
        this.pausedActive ||
        !this.session
      )
        return;
      const now = this.actions.clock().position;
      if (now === null) return;
      if (now > this.lastPosition + 0.1) {
        this.lastPosition = now;
        this.stalledFor = 0;
        return;
      }
      if (this.lastPosition < 0) {
        this.lastPosition = now;
        return;
      }
      this.stalledFor += STALL_TICK_MS;
      if (this.stalledFor < STALL_LIMIT_MS) return;
      this.faultCode = "STALLED";
      this.cause = "frozen-playhead";
      this.runRecovery(null);
    }, STALL_TICK_MS);
  }

  private armStableReset() {
    window.clearTimeout(this.stableTimer);
    this.stableTimer = window.setTimeout(() => {
      this.attempt = 0;
      this.emit();
    }, STABLE_PLAYING_MS);
  }

  /**
   * Run the corrective chain once per fault: warm recovery, one compatibility diagnosis,
   * one HTTP fallback, a reopen, then application delays. Everything after warm runs inside
   * continueRecovery so a warm attempt that fails mid flight lands in the same place.
   */
  private runRecovery(kind: "network" | "media" | null) {
    this.clearDetection();
    if (!this.session || this.offscreen || this.disposed) return;
    if (!this.warmTried) {
      this.warmTried = true;
      if (this.actions.warmRecover(kind)) {
        this.stage = "warm";
        this.statusVisible = true;
        this.emit();
        this.armBufferLimit();
        return;
      }
    }
    void this.continueRecovery();
  }

  private async continueRecovery() {
    const session = this.session;
    const token = this.token;
    if (!session || this.offscreen || this.disposed) return;

    const policy = faultPolicy(this.faultCode ?? "");
    if (
      session.compatibility &&
      policy.compatibility &&
      !this.compatibilityTried.has(session.key)
    ) {
      this.compatibilityTried.add(session.key);
      this.stage = "compatibility";
      this.statusVisible = true;
      this.emit();
      const diagnosed = await this.actions.diagnose(session);
      // A stale diagnosis belongs to a target nobody is watching. Opening it would be a
      // provider connection for the abandoned channel, so it goes nowhere.
      if (token !== this.token || !this.session || this.offscreen || this.disposed) return;
      if (diagnosed) {
        this.currentRequest = diagnosed;
        this.stage = "reopen";
        this.emit();
        this.actions.reopen(diagnosed);
        this.seenPicture = false;
        this.armStartup();
        return;
      }
    }

    if (policy.httpFallback && !this.fallbackTried.has(session.key)) {
      this.fallbackTried.add(session.key);
      const request = this.actions.fallback(session);
      if (request) {
        this.stage = "http-fallback";
        this.statusVisible = true;
        this.emit();
        this.currentRequest = request;
        this.stage = "reopen";
        this.emit();
        this.actions.reopen(request);
        this.seenPicture = false;
        this.armStartup();
        return;
      }
    }

    this.scheduleRetry(session);
  }

  /**
   * What is left once the corrective steps are spent: try the channel again after a delay.
   *
   * The default budget is three attempts at four, eight and fifteen seconds, and then it
   * stops rather than holding a dead channel open all night. Continuous reconnect, when the
   * viewer has asked for it on a live target, waits thirty then forty five then sixty
   * seconds for as long as the same channel stays selected. Finite targets always use the
   * bounded policy.
   */
  private scheduleRetry(session: RecoverySession) {
    const continuous = session.continuousReconnect && session.request.mode === "live";
    if (!continuous && this.attempt >= RETRY_DELAYS_MS.length) {
      this.stage = "terminal";
      this.statusVisible = true;
      this.emit();
      return;
    }
    const delay = !continuous
      ? RETRY_DELAYS_MS[this.attempt]
      : this.attempt === 0
        ? CONTINUOUS_FIRST_MS
        : this.attempt === 1
          ? CONTINUOUS_SECOND_MS
          : CONTINUOUS_DELAY_MS;

    this.stage = "waiting";
    this.statusVisible = true;
    const due = Date.now() + delay;
    this.retryIn = Math.ceil(delay / 1000);
    this.emit();

    this.clearRetry();
    this.retryTick = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((due - Date.now()) / 1000));
      if (next === this.retryIn) return;
      this.retryIn = next;
      this.emit();
    }, 500);
    this.retryTimer = window.setTimeout(() => {
      this.clearRetry();
      if (!this.session || this.offscreen || this.disposed) return;
      this.attempt += 1;
      this.retryIn = 0;
      this.stage = "reopen";
      this.statusVisible = this.hasPlayed;
      this.emit();
      this.actions.reopen(this.currentRequest ?? session.request);
      // The reopened attempt is a fresh connection that may itself stall or freeze.
      this.seenPicture = false;
      this.armStartup();
    }, delay);
  }

  /** Select a target or retune it, abandoning the previous attempt. */
  select(session: RecoverySession): void {
    const hasPlayed = this.session?.key === session.key && this.hasPlayed;
    this.clearAll();
    this.token += 1;
    this.session = session;
    this.stage = "buffering";
    this.cause = null;
    this.faultCode = null;
    this.attempt = 0;
    this.retryIn = 0;
    this.statusVisible = hasPlayed;
    this.seenPicture = false;
    this.hasPlayed = hasPlayed;
    this.warmTried = false;
    this.seekingActive = false;
    this.pausedActive = false;
    this.currentRequest = session.request;
    this.armStartup();
    if (!hasPlayed) this.armStatusDelay();
    this.emit();
  }

  /**
   * The viewer's continuous reconnect choice, re read when the setting changes or a new
   * failure begins. Turning it off ends a wait that only exists because of it; turning it
   * on is picked up the next time a retry is scheduled.
   */
  setContinuousReconnect(continuous: boolean): void {
    const session = this.session;
    if (!session) return;
    session.continuousReconnect = continuous;
    if (!continuous && this.stage === "waiting" && session.request.mode === "live") {
      this.clearRetry();
      if (this.attempt >= RETRY_DELAYS_MS.length) {
        this.retryIn = 0;
        this.stage = "terminal";
        this.emit();
      } else {
        /*
         * The pending delay only exists because continuous reconnect was on: the bounded
         * schedule would have chosen a shorter one, so the wait is priced again rather
         * than letting the long timer run to term.
         */
        this.scheduleRetry(session);
      }
    }
  }

  /** The engine says it is filling its buffer, which is only news after a picture. */
  bufferingStarted(): void {
    if (!this.session || this.offscreen || this.disposed || this.stage === "terminal") return;
    if (this.stage === "buffering") return;
    this.stage = "buffering";
    this.armStatusDelay();
    // Before the first picture the startup limit still governs. The rebuffer limit exists
    // for a picture that was there and stopped refilling.
    if (this.seenPicture) this.armBufferLimit();
    this.emit();
  }

  bufferingProgress(_percent?: number): void {
    if (!this.session || this.disposed) return;
    this.emit();
  }

  bufferingEnded(): void {
    if (this.stage !== "buffering" || !this.seenPicture) return;
    window.clearTimeout(this.bufferTimer);
    window.clearTimeout(this.statusTimer);
    this.bufferTimer = undefined;
    this.statusTimer = undefined;
    this.stage = "idle";
    this.statusVisible = false;
    this.emit();
    // Thirty uninterrupted seconds still proves the fault is over, so the reset clock
    // starts again from this refill rather than measuring across it.
    this.armStableReset();
  }

  /**
   * The engine or a detector reports a fault. Terminal codes stay on screen as they are:
   * a refusal or an undecodable format is not congestion and is never retried into looking
   * like one.
   */
  fault(code: string, warmKind: "network" | "media" | null, cause: RecoveryCause): void {
    if (!this.session || this.disposed) return;
    this.clearAll();
    this.faultCode = code;
    this.cause = cause;
    if (faultPolicy(code).terminal) {
      this.stage = "terminal";
      this.statusVisible = true;
      this.emit();
      return;
    }
    this.runRecovery(warmKind);
  }

  /** Decoded picture evidence: connecting becomes playing, and detection starts. */
  playing(): void {
    if (!this.session || this.disposed) return;
    this.clearDetection();
    this.clearRetry();
    this.stage = "idle";
    this.cause = null;
    this.faultCode = null;
    this.retryIn = 0;
    this.statusVisible = false;
    this.seenPicture = true;
    this.hasPlayed = true;
    this.warmTried = false;
    this.emit();
    this.armStallSampling();
    this.armStableReset();
  }

  /** A seek in progress is legitimate stillness and suspends frozen detection. */
  seeking(active: boolean): void {
    this.seekingActive = active;
  }

  /** A deliberate pause is legitimate stillness and suspends frozen detection. */
  paused(active: boolean): void {
    this.pausedActive = active;
  }

  /**
   * Off screen: every timer clears and the engine suspends, but the attempt count stays.
   * Nothing below may open a provider connection until visible() says so.
   */
  hidden(): void {
    if (this.offscreen || this.disposed) return;
    this.offscreen = true;
    this.clearAll();
    this.actions.suspend();
    this.retryIn = 0;
    this.statusVisible = false;
    this.emit();
  }

  /**
   * Back on screen: restore the suspended engine, or begin one coordinated recovery from
   * the retained attempt state when the engine cannot simply resume.
   */
  visible(): void {
    if (!this.offscreen) return;
    this.offscreen = false;
    if (!this.session) {
      this.emit();
      return;
    }
    if (this.actions.restore()) {
      if (this.stage === "terminal") {
        this.emit();
      } else if (!this.seenPicture) {
        this.stage = "buffering";
        this.statusVisible = false;
        this.emit();
        this.armStartup();
        this.armStatusDelay();
      } else {
        this.stage = "idle";
        this.statusVisible = false;
        this.emit();
        this.armStallSampling();
        this.armStableReset();
      }
      return;
    }
    this.cause = "visibility-restore";
    this.warmTried = false;
    this.runRecovery(null);
  }

  /** Release the target, optionally without notifying an owner during cleanup. */
  stop(notify = true): void {
    this.clearAll();
    this.token += 1;
    this.session = null;
    this.stage = "idle";
    this.cause = null;
    this.faultCode = null;
    this.attempt = 0;
    this.retryIn = 0;
    this.statusVisible = false;
    this.seenPicture = false;
    this.hasPlayed = false;
    this.offscreen = false;
    this.seekingActive = false;
    this.pausedActive = false;
    this.currentRequest = null;
    if (notify) this.emit();
  }

  /** The coordinator is finished: no further emission, and every timer is dead. */
  dispose(): void {
    this.clearAll();
    this.token += 1;
    this.session = null;
    this.disposed = true;
  }
}
