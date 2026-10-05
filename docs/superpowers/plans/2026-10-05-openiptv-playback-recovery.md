# OpenIPTV Playback and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one engine independent playback controller with finite seeking, Live DVR, deck and drawer controls, audio and subtitle selection, coordinated recovery, continuous Live reconnect, resolved progress records, and mode specific remote behavior.

**Architecture:** `services/player.ts` remains the only AVPlay, hls.js, and native media boundary, while pure range, track, and recovery services translate engine behavior into one `PlaybackSnapshot`. `usePlaybackController` owns the active target and exposes commands to the shell, while focused playback components render the deck, seek bar, drawers, Guide, quick seek feedback, subtitles, and recovery status without calling an engine. The application stack supplied by subsystem 1 decides which surface owns input and renders only that surface.

**Tech Stack:** React 19, TypeScript, zustand, native media APIs, Samsung AVPlay, hls.js 1.7.3, localStorage through `services/store`, Vitest, Testing Library, Biome, Vite, and the existing television simulator.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`

## Global Constraints

- This plan implements subsystem 2 only. It assumes the subsystem 1 application shell, screen ownership, and key delegation interfaces already exist.
- Add no hosted service, analytics, runtime dependency, provider administration, bundled content, user agent branch, engine version branch, or model year branch.
- Target ES2019 and Chromium 69. Do not use unsupported runtime methods, CSS `aspect-ratio`, CSS `inset`, or unguarded flex gap.
- Keep `services/player.ts` as the only AVPlay, hls.js, and native media boundary. React code must never call those engines directly.
- Preserve one application artifact. Runtime behavior may branch on measured pause, seek range, track, or subtitle capability only.
- Use the exact `PlaybackPhase`, `SeekRange`, `PlaybackSnapshot`, `MediaTrack`, `ResolvedPlaybackProgress`, `LegacyPlaybackProgress`, and `PlaybackProgress` shapes from the approved spec.
- Finite picture Left and Right move in ten second steps, settle for 350 milliseconds, fail after five seconds, clamp to duration, and preserve play or pause state.
- Refresh a visible Live range every two seconds. Use three seconds when segment duration is unknown, clamp the Live safety margin between two and ten seconds, enter Live within the greater of six seconds or twice segment duration, and leave Live only after four additional seconds of drift.
- Close the deck five seconds after the latest direction, OK, pointer, or transport action. Drawers have no close timer.
- Keep the Live title banner at its existing eight second reading interval. Finite playback never uses that banner.
- Hide rebuffering shorter than 1.5 seconds. Allow reported buffering for the greater of twenty seconds or twice segment duration, capped at forty five seconds.
- Keep default application retry delays at four, eight, and fifteen seconds. Continuous reconnect is off by default and uses thirty, forty five, then sixty seconds for all later Live attempts.
- Reset recovery attempt state after thirty uninterrupted seconds of playing.
- Every target change, Stop, VOD entry, and application exit invalidates recovery work. Hiding clears timers and prevents new provider connections without resetting the attempt count.
- Keep compatibility diagnosis and HTTP fallback sequential. Key both attempts to the original target so an address rewrite cannot repeat either step.
- Do not change AVPlay buffer values without separate measurement on a real set.
- Keep progress bounded to 100 finite items and persist after fifteen seconds of advancement, pause, Stop, hiding, and target change.
- Render provider names, labels, programme data, and subtitle cues as text. Never inject subtitle markup.
- Keep all important content outside the 48 pixel horizontal and 40 pixel vertical safe area. Keep text at or above the existing 20 pixel caption floor at 1920 by 1080.
- Use `--over-video`, a 28 pixel surface radius, the existing elevation, and a white hairline for floating playback surfaces. Do not add backdrop blur.
- Preserve semantic previous, next, back, and forward behavior in right to left layouts while mirroring physical placement and direction movement.
- External subtitle downloads remain outside scope.
- Never log credentials, stream addresses, provider content, subtitle text, or raw playback targets. Diagnostics may record only internal recovery causes and attempt numbers.
- Never assert a DOM node against null with `node:assert`. Assert on a boolean or `textContent`.
- Write every automated test before its production change, but do not run tests, lint, type checks, builds, television gates, or WebAssembly checks during Tasks 1 through 11. Every automated command is deferred to Task 12, the final gate before push.
- Local task commits are part of the approved implementation. Every commit uses the required Devin generation and coauthor trailers. Do not push until Shayan explicitly asks.
- Task 12 is a command manifest for master plan Task 7. Do not execute it after this subsystem because all automated commands run once after every subsystem review passes.

## Review Focus

- AVPlay may return an empty, malformed, reversed, or zero length `GET_LIVE_DURATION` value, and the player must omit DVR without reading the property in IDLE or while connecting.
- A seek callback may reject, throw, arrive after a target change, or never arrive, and the controller must restore the actual position after five seconds without restarting playback or leaving stall detection suspended.
- Recovery work may complete after channel change, Stop, VOD entry, hiding, or exit, and no stale diagnosis, fallback, retry, or restore may open a provider connection for the abandoned target.
- Providers may expose duplicate, incomplete, or reordered track metadata and subtitle payloads containing markup, and normalized identity must remain stable while cue output remains plain text.
- Continuous reconnect may be waiting when the app hides or the provider returns a terminal refusal, and hiding must preserve the attempt count without connecting while terminal faults must remain visible without another retry.

## Assumed Subsystem 1 Interfaces

Subsystem 1 owns these contracts before this plan starts. Subsystem 2 extends the surface unions in place rather than creating a second stack model.

```ts
export type PictureSurface = "picture";
export type PrimarySurface = "panel";
export type DrawerSurface = "guide";
export type ModalSurface = "settings" | "onboarding" | "exit";
export type PopupSurface = "confirmation";
export type LiveSurface = PictureSurface | PrimarySurface;
export type SurfaceId = LiveSurface | DrawerSurface | ModalSurface | PopupSurface;

export interface SurfaceStack {
  picture: PictureSurface;
  primary: PrimarySurface | null;
  drawer: DrawerSurface | null;
  modal: ModalSurface | null;
  popup: PopupSurface | null;
}

export function activeSurface(stack: SurfaceStack): SurfaceId;
```

```ts
export interface LiveScreenProps {
  surface: SurfaceId;
  liveSurface: LiveSurface;
  onLiveSurfaceChange: (surface: LiveSurface) => void;
  guideChannelId: string;
  onGuideChannelChange: (channelId: string) => void;
  tuner: Tuner;
  chrome: Chrome;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  onRequestExit: () => void;
}

export type TuneItem = Channel | PlaybackTarget;

export interface Tuner {
  step(delta: number, list: readonly TuneItem[]): void;
}
```

- `App.tsx` owns `SurfaceStack`, the playback controller lifetime, modal order, transient shell overlays, and later top level modes.
- `src/screens/LiveScreen.tsx` owns the Live picture, panel, legacy Movies and Series panel, Guide presentation, and the private picture, panel, and drawer key handlers.
- Subsystem 2 changes `PrimarySurface` to `"panel" | "playback-deck"` and changes `DrawerSurface` to `"guide" | "audio" | "subtitles" | "more"`, then keeps `activeSurface` as the only precedence resolver.
- Only `activeSurface(stack)` receives a key. A drawer keeps ownership through closure and replaces its caller in the rendered tree.
- Subsystem 2 produces `PlaybackReturnRoute`, `LiveScreenPlaybackActions`, and the final `PlaybackController` contract that subsystem 3 consumes.

## File Map

### Create

- `src/services/playbackRange.ts`, which owns pure finite range, Live DVR safety, clamping, and hysteresis arithmetic.
- `src/services/playbackTracks.ts`, which owns normalized track identity, labels, and Automatic resolution.
- `src/services/playbackRecovery.ts`, which owns recovery tokens, timers, attempt state, sequential recovery stages, hiding, and visibility restore.
- `src/hooks/usePlaybackController.ts`, which owns the `Player`, current target, normalized snapshot, clock sampling, channel settle, seeking, tracks, subtitles, and recovery integration.
- `src/components/playback/PlaybackDeck.tsx`, which owns deck metadata, control geometry, focus movement, action activation, and the five second interval.
- `src/components/playback/PlaybackDrawer.tsx`, which owns the fixed drawer header, Back behavior, origin restoration, and drawer focus containment.
- `src/components/playback/SeekBar.tsx`, which owns finite and Live timeline rendering, target time, Go live focus, and pointer seeking.
- `src/components/playback/QuickSeek.tsx`, which owns compact finite seek feedback.
- `src/components/playback/TrackPicker.tsx`, which owns audio and subtitle options and selected state.
- `src/components/playback/SubtitleLayer.tsx`, which owns safe application subtitle rendering.
- `src/components/playback/RecoveryStatus.tsx`, which owns compact rebuffering, recovery, and reconnect status beside the clock.
- `tests/playbackRange.test.ts`, which covers finite and Live range arithmetic.
- `tests/playbackTracks.test.ts`, which covers track identity, labels, and Automatic selection.
- `tests/playbackRecovery.test.ts`, which covers recovery order, timing, cancellation, hiding, and terminal faults.
- `tests/playbackController.test.tsx`, which replaces the old tuner tests with snapshot and controller coverage.
- `tests/playbackDeck.test.tsx`, which covers deck, seek bar, timer, pointer, focus, and drawer behavior.
- `tests/subtitles.test.tsx`, which covers cue lifetime, plain text rendering, Off, and target changes.

### Modify

- `src/types.ts`, which gains the approved playback, track, and progress seed contracts.
- `src/services/player.ts`, which translates both engines into normalized events, clocks, capabilities, seek operations, tracks, subtitles, and warm recovery.
- `src/services/manifest.ts`, which exposes measured segment duration to playback policy.
- `src/services/repair.ts`, which carries segment duration through cached and fresh diagnosis.
- `src/services/errors.ts`, which separates terminal faults from recovery eligible faults without changing viewer explanations.
- `src/stores/personal.ts`, which migrates compact progress into resolved and legacy records.
- `src/stores/library.ts`, which creates progress seeds for movies, episodes, and catchup, then resolves legacy records from authoritative loads.
- `src/stores/settings.ts`, which adds `continuousReconnect: boolean` with a false default and removes the old persistent playback information overlay setting.
- `src/services/remoteProtocol.ts`, which exposes and validates Continuous reconnect while removing the old overlay setting.
- `public/remote/remote.js`, which renders the Continuous reconnect setting and stops rendering the removed overlay setting.
- `src/App.tsx`, which owns the playback controller, playback surface stack, return routes, drawer origins, and revised transient visibility.
- `src/screens/LiveScreen.tsx`, which delegates Live picture and browser actions through the revised mode contract.
- `src/services/surfaceStack.ts`, which extends the subsystem 1 primary and drawer unions for playback while preserving the same precedence resolver.
- `src/services/lineup.ts`, which stops focus at list boundaries while retaining channel change wrapping.
- `src/components/PanelHeader.tsx`, which exposes Guide from the Live browser when the focused channel supports programme data.
- `src/components/GuideList.tsx`, which becomes drawer content with current, future, archived, loading, empty, failed, and Retry states.
- `src/components/PictureState.tsx`, which renders only connecting, paused, and terminal failed full picture states from `PlaybackSnapshot`.
- `src/components/PlaybackBanner.tsx`, which becomes Live only and reports the revised Live picture actions.
- `src/components/PlaybackInfo.tsx`, which becomes More drawer content and reports internal recovery cause without addresses.
- `src/components/Icon.tsx`, which gains stable deck, audio, subtitle, details, and Live glyphs where an existing glyph cannot serve the action.
- `src/components/settings/Behaviour.tsx`, which renders Continuous reconnect and removes the persistent playback information toggle.
- `src/styles/tokens.css`, which adds named playback stack roles only where existing roles cannot express the approved order.
- `src/styles/app.css`, which styles the deck, seek bar, drawers, quick seek, compact recovery, subtitles, focus, right to left placement, and flex gap fallback.
- `src/services/locale.ts`, which adds English and Persian playback, track, Guide, recovery, and setting messages.
- `src/locales/ar.ts`
- `src/locales/bn.ts`
- `src/locales/de.ts`
- `src/locales/es.ts`
- `src/locales/fr.ts`
- `src/locales/hi.ts`
- `src/locales/id.ts`
- `src/locales/it.ts`
- `src/locales/ja.ts`
- `src/locales/ko.ts`
- `src/locales/nl.ts`
- `src/locales/pt.ts`
- `src/locales/ru.ts`
- `src/locales/tr.ts`
- `src/locales/zh-CN.ts`
- `tests/player.test.ts`
- `tests/surfaceStack.test.ts`
- `tests/manifest.test.ts`
- `tests/repair.test.ts`
- `tests/personal.test.ts`
- `tests/library.test.ts`
- `tests/guide.test.ts`
- `tests/guide-ui.test.tsx`
- `tests/keyLaws.test.tsx`
- `tests/panelNav.test.tsx`
- `tests/banner.test.tsx`
- `tests/settings.test.ts`
- `tests/settings-ui.test.tsx`
- `tests/remoteProtocol.test.ts`
- `tests/remoteWeb.test.ts`
- `tests/rtl-controls.test.tsx`
- `tests/support/app.tsx`
- `AGENTS.md`
- `docs/design.md`
- `docs/testing.md`

### Delete after all imports move

- `src/hooks/useTuner.ts`
- `tests/tuner.test.tsx`

---

### Task 1: Playback State and Range Arithmetic

**Files:**
- Create: `src/services/playbackRange.ts`
- Create: `tests/playbackRange.test.ts`
- Modify: `src/types.ts`

**Interfaces:**
- Produces: the approved `PlaybackPhase`, `SeekRange`, `PlaybackSnapshot`, `MediaTrack`, and `PlaybackProgressSeed` types from `src/types.ts`.
- Moves: `TuneItem = Channel | PlaybackTarget` from `src/hooks/useTuner.ts` to `src/types.ts` before Task 4 deletes the old tuner module.
- Produces: `finiteSeekRange(durationSeconds: number | null, engineStart?: number, engineEnd?: number): SeekRange | null`.
- Produces: `parseAvPlayLiveRange(value: string): { startSeconds: number; endSeconds: number } | null`.
- Produces: `usefulLiveRange(range: { startSeconds: number; endSeconds: number } | null): boolean`.
- Produces: `safeLiveTarget(range: { startSeconds: number; endSeconds: number }, segmentSeconds: number, engineLiveEdge?: number | null): number`.
- Produces: `isAtLiveEdge(position: number, safeTarget: number, segmentSeconds: number, wasLive: boolean): boolean`.
- Produces: `clampSeekTarget(target: number, range: { startSeconds: number; endSeconds: number }): number`.
- Produces: `DEFAULT_SEGMENT_SECONDS = 3`, `SEEK_STEP_SECONDS = 10`, `SEEK_SETTLE_MS = 350`, and `SEEK_TIMEOUT_MS = 5000`.
- Consumes later: the player reports raw clock values, while the controller uses only these functions to create `snapshot.seekRange`.

- [ ] **Step 1: Add the approved public types to `src/types.ts`**

```ts
export type PlaybackPhase =
  | "idle"
  | "connecting"
  | "playing"
  | "rebuffering"
  | "recovering"
  | "paused"
  | "seeking"
  | "ended"
  | "failed";

export interface SeekRange {
  startSeconds: number;
  endSeconds: number;
  liveEdge: boolean;
}

export interface PlaybackSnapshot {
  phase: PlaybackPhase;
  target: PlaybackTarget | null;
  position: number | null;
  duration: number | null;
  seekRange: SeekRange | null;
  bufferedPercent: number | null;
  recoveryAttempt: number;
  recoveryIn: number;
  fault: string | null;
}

export interface MediaTrack {
  id: string;
  identity: string;
  engineIndex: number;
  kind: "audio" | "subtitle";
  label: string;
  language: string;
  selected: boolean;
  accessibility?: "sdh" | "descriptions";
}

export interface PlaybackProgressSeed {
  itemKey: string;
  playlistId: string;
  kind: "movie" | "episode" | "catchup";
  providerId?: string;
  episodeIdentity?: string;
  directSourceFingerprint?: string;
  categoryKey: string;
  extension?: string;
  name: string;
  logo: string;
  parentKey?: string;
  parentProviderId?: string;
  parentName?: string;
  season?: number;
  episode?: number;
}
```

- [ ] **Step 2: Write the range tests before `playbackRange.ts`**

```ts
test("finite range uses the narrower engine range", () => {
  expect(finiteSeekRange(120, 10, 90)).toEqual({ startSeconds: 10, endSeconds: 90, liveEdge: false });
});

test("Live safety and hysteresis use exact approved thresholds", () => {
  const range = { startSeconds: 100, endSeconds: 200 };
  expect(safeLiveTarget(range, 4)).toBe(196);
  expect(isAtLiveEdge(190, 196, 4, false)).toBe(true);
  expect(isAtLiveEdge(183.9, 196, 4, true)).toBe(false);
});
```

Add cases for two and ten second margin clamps, a ten second useful window, a shorter rejected window, an expired target clamped to the new start, `NaN`, infinity, an empty string, one number, reversed AVPlay pairs, negative values, and a browser edge that is earlier than the reported end.

- [ ] **Step 3: Implement the pure range functions**

Use arithmetic only. `parseAvPlayLiveRange` accepts the AVPlay millisecond pair and returns seconds only when both values are finite, nonnegative, and strictly increasing. `finiteSeekRange` returns zero to duration unless a valid engine range narrows it. `safeLiveTarget` subtracts `Math.min(10, Math.max(2, segmentSeconds))` and never leaves the range.

- [ ] **Step 4: Record deferred verification**

Do not run `npm test -- tests/playbackRange.test.ts`, lint, type checks, or a build in this task. Task 12 runs the complete gate once all interfaces exist.

- [ ] **Step 5: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/types.ts src/services/playbackRange.ts tests/playbackRange.test.ts
git commit -m "feat: define playback state and range math"
```

### Task 2: Track Normalization and Engine Adapter Contracts

**Files:**
- Create: `src/services/playbackTracks.ts`
- Create: `tests/playbackTracks.test.ts`
- Modify: `src/services/player.ts`
- Modify: `src/services/manifest.ts`
- Modify: `src/services/repair.ts`
- Modify: `src/hooks/useTuner.ts`
- Modify: `tests/player.test.ts`
- Modify: `tests/tuner.test.tsx`
- Modify: `tests/manifest.test.ts`
- Modify: `tests/repair.test.ts`

**Interfaces:**
- Consumes: `MediaTrack`, `PlaybackTarget`, and range types from Task 1.
- Produces: `trackIdentity(track: Pick<MediaTrack, "kind" | "language" | "label" | "accessibility">): string`.
- Produces: `normalizeAvPlayTracks(items: readonly AVPlayStreamInfo[]): MediaTrack[]` and `automaticTrack(tracks: readonly MediaTrack[], deviceLanguage: string): MediaTrack | null`.
- Produces: `PlayerOpenRequest = { url: string; browserRepair: boolean; bufferSeconds: number; segmentSeconds: number; mode: "live" | "finite"; startSeconds: number }`.
- Produces: `PlaybackClock = { position: number | null; duration: number | null; seekableStart: number | null; seekableEnd: number | null; engineLiveEdge: number | null; segmentSeconds: number | null }`.
- Produces: `PlayerEvent = { type: "buffering-start" } | { type: "buffering-progress"; percent: number } | { type: "buffering-complete" } | { type: "playing" } | { type: "ended" } | { type: "error"; code: string; warmKind: "network" | "media" | null } | { type: "tracks"; tracks: MediaTrack[] } | { type: "subtitle"; text: string; durationMs: number }`.
- Produces: `Player.play(request: PlayerOpenRequest): void`, `Player.getClock(): PlaybackClock`, `Player.canPause(): boolean`, `Player.pause(): boolean`, `Player.resumePlayback(): boolean`, `Player.seekTo(seconds: number): Promise<boolean>`, `Player.warmRecover(kind: "network" | "media" | null): boolean`, `Player.getTracks(): MediaTrack[]`, and `Player.selectTrack(kind: "audio" | "subtitle", engineIndex: number | null): boolean`.
- Changes: `repair.PlaybackTarget` gains `segmentSeconds: number`, and persisted diagnosis validates and stores that value.
- Changes: the transitional `useTuner` calls `Player.play(request)` and converts its delta seek into an absolute `Player.seekTo(targetSeconds)` so Task 2 remains complete before Task 4 replaces the hook.

- [ ] **Step 1: Write track normalization tests**

```ts
test("track identity excludes the target local engine index", () => {
  const first = trackIdentity({ kind: "audio", language: "EN", label: " Main  ", accessibility: undefined });
  const second = trackIdentity({ kind: "audio", language: "en", label: "main", accessibility: undefined });
  expect(first).toBe(second);
});

test("Automatic exists only for one unambiguous device language match", () => {
  expect(automaticTrack([english, french], "en-GB")?.id).toBe(english.id);
  expect(automaticTrack([english, anotherEnglish], "en-GB")).toBeNull();
});
```

Cover blank labels, lowercase language, normalized provider whitespace, SDH and descriptions identity, numbered label fallback, duplicate metadata, malformed `extra_info`, selected flags, and a language with script or region subtags. Build `identity` from kind, lowercase language, normalized provider label, and accessibility. Build current target row `id` from identity plus its zero based duplicate occurrence, while keeping `engineIndex` only for the active target.

- [ ] **Step 2: Extend the AVPlay and browser fakes before the adapter**

Add `getTotalTrackInfo`, `setSelectTrack`, `setSilentSubtitle`, `onsubtitlechange`, legal state recording, browser `seekable`, hls.js level detail plus audio and subtitle tracks, native text tracks, delayed seek success, delayed seek failure, and a seek with no callback to `tests/player.test.ts`.

- [ ] **Step 3: Write adapter contract tests**

```ts
test("AVPlay applies a saved finite position only after READY and before play", () => {
  player.play(finiteRequest({ startSeconds: 25 }));
  expect(av.calls).not.toContain("seekTo:25000");
  av.prepared?.ok();
  expect(av.calls.indexOf("seekTo:25000")).toBeLessThan(av.calls.indexOf("play"));
});

test("AVPlay never reads the Live range while IDLE or connecting", () => {
  player.play(liveRequest());
  player.getClock();
  expect(av.streamingReads).not.toContain("GET_LIVE_DURATION");
});
```

Add tests for READY, PLAYING, and PAUSED Live range reads, browser finite and HLS ranges, hls.js Live edge and manifest segment duration, pause support, pause rejection without teardown, absolute seek callbacks, warm network recovery, warm media recovery, AVPlay warm play only from READY or PAUSED, track selection state restrictions, subtitle Off, cue duration, empty cue clearing, target cleanup, and old asynchronous events ignored after teardown.

- [ ] **Step 4: Carry manifest segment duration through repair diagnosis**

Use the longest resolved media segment when available, including a selected variant playlist. Persist `segmentSeconds` beside `bufferSeconds`, default old diagnosis records to `DEFAULT_SEGMENT_SECONDS`, and include segment duration when deciding whether background revalidation changed a diagnosis.

- [ ] **Step 5: Implement `playbackTracks.ts` and the normalized player surface**

Call AVPlay `getTotalTrackInfo()` and `setSelectTrack()` only in READY, PLAYING, or PAUSED. Keep all optional AVPlay calls inside state checks and `try` blocks at the player boundary. Browser text tracks use `hidden` mode while the player emits `activeCues` text to the controller. Use optional native audio and text track interfaces only when the browser exposes them. hls.js track arrays and indices map to the same `MediaTrack` shape, and level detail events expose manifest segment duration through `PlaybackClock`. `selectTrack("subtitle", null)` disables custom cue output and clears the current cue. Adapt every `useTuner` call and fake to the request and absolute seek signatures in the same task.

- [ ] **Step 6: Record deferred verification**

Do not run the player, tuner, manifest, repair, or track tests in this task. Task 12 runs them through the complete suite.

- [ ] **Step 7: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/services/player.ts src/services/playbackTracks.ts src/services/manifest.ts src/services/repair.ts src/hooks/useTuner.ts tests/player.test.ts tests/tuner.test.tsx tests/playbackTracks.test.ts tests/manifest.test.ts tests/repair.test.ts
git commit -m "feat: normalize playback engine capabilities"
```

### Task 3: Recovery Coordinator

**Files:**
- Create: `src/services/playbackRecovery.ts`
- Create: `tests/playbackRecovery.test.ts`
- Modify: `src/services/errors.ts`
- Modify: `tests/errors.test.ts`

**Interfaces:**
- Consumes: player warm recovery, compatibility `prepare`, HTTP fallback, ordinary reopen, and visibility suspend functions through injected actions.
- Produces: `RecoveryCause = "startup-timeout" | "reported-buffer" | "frozen-playhead" | "engine-network" | "engine-media" | "stream-ended" | "visibility-restore"`.
- Produces: `RecoveryStage = "idle" | "buffering" | "warm" | "compatibility" | "http-fallback" | "reopen" | "waiting" | "terminal"`.
- Produces: `RecoverySession = { key: string; target: PlaybackTarget; originalUrl: string; request: PlayerOpenRequest; segmentSeconds: number; compatibility: boolean; continuousReconnect: boolean }`.
- Produces: `RecoveryState = { stage: RecoveryStage; cause: RecoveryCause | null; attempt: number; retryIn: number; statusVisible: boolean; fault: string | null }`.
- Produces: `RecoveryActions = { clock(): PlaybackClock; warmRecover(kind: "network" | "media" | null): boolean; diagnose(session: RecoverySession): Promise<PlayerOpenRequest | null>; fallback(session: RecoverySession): PlayerOpenRequest | null; reopen(request: PlayerOpenRequest): void; suspend(): void; restore(): boolean; emit(state: RecoveryState): void }`.
- Produces: `PlaybackRecoveryCoordinator.select(session: RecoverySession): void`, `bufferingStarted(): void`, `bufferingProgress(percent?: number): void`, `bufferingEnded(): void`, `fault(code: string, warmKind: "network" | "media" | null, cause: RecoveryCause): void`, `playing(): void`, `seeking(active: boolean): void`, `paused(active: boolean): void`, `hidden(): void`, `visible(): void`, `stop(): void`, and `dispose(): void`.
- Produces: `faultPolicy(code: string): { terminal: boolean; compatibility: boolean; httpFallback: boolean }` from `services/errors.ts`.

- [ ] **Step 1: Write coordinator tests with fake timers and injected actions**

```ts
test("recovery runs warm, compatibility, HTTP fallback, reopen, then application delay in order", async () => {
  coordinator.select(session);
  coordinator.fault("NETWORK_ERROR", "network", "engine-network");
  await flushRecovery();
  expect(calls).toEqual(["warm", "compatibility", "http-fallback", "reopen"]);
});

test("changing target invalidates an older asynchronous diagnosis", async () => {
  coordinator.select(firstSession);
  coordinator.fault("STALLED", null, "frozen-playhead");
  coordinator.select(secondSession);
  firstDiagnosis.resolve(repairedRequest);
  await flushRecovery();
  expect(calls).not.toContain("reopen:first");
});
```

Cover the Review Focus cases, the thirty second startup limit, 1.5 second compact status delay, twenty second direct stream rebuffer limit, twice segment duration, forty five second cap, sequential compatibility and fallback, original target attempt keys after rewrite, four, eight, and fifteen second retries, continuous thirty, forty five, and repeated sixty second retries, terminal 401, 403, 451, stale address, and unsupported format faults, thirty playing seconds reset, seek and pause stall suppression, reported buffering stall suppression, hide while waiting, no connection while hidden, one coordinated restore, Stop, disposal, and no stale timer emission.

- [ ] **Step 2: Write fault classification tests**

Ensure authentication, permission, provider refusal, and unsupported format are terminal. Ensure network, timeout, server failure, stream end, and frozen playhead faults are recovery eligible. Preserve the existing viewer explanation keys.

- [ ] **Step 3: Implement the coordinator as the only recovery timer owner**

Keep one monotonically increasing token, one selected session, one stage, and named timer handles for the thirty second startup limit, status delay, buffer limit, retry countdown, frozen sampling, and stable playback reset. Mark compatibility and fallback attempts against `session.key`, which is based on the original target identity and original address fingerprint without retaining the address in diagnostics.

- [ ] **Step 4: Keep diagnostics private and credential free**

Expose only `RecoveryCause`, stage, and attempt through `RecoveryState`. Do not call `console` with a target, request, address, track, cue, or provider response.

- [ ] **Step 5: Record deferred verification**

Do not run recovery or error tests in this task. Task 12 runs them after controller integration.

- [ ] **Step 6: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/services/playbackRecovery.ts src/services/errors.ts tests/playbackRecovery.test.ts tests/errors.test.ts
git commit -m "feat: coordinate playback recovery"
```

### Task 4: Playback Controller and Snapshot Translation

**Files:**
- Create: `src/hooks/usePlaybackController.ts`
- Create: `tests/playbackController.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/screens/LiveScreen.tsx`
- Modify: `src/services/player.ts`
- Modify: `tests/player.test.ts`
- Modify: `tests/support/app.tsx`
- Delete: `src/hooks/useTuner.ts`
- Delete: `tests/tuner.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 through 3 and the subsystem 1 shell interfaces.
- Produces: `TuneItem = Channel | PlaybackTarget` from `usePlaybackController.ts`, replacing the transitional export deleted with `useTuner`.
- Produces: `PlaybackControllerOptions = { fit: Fit; video: React.RefObject<HTMLVideoElement | null>; compatibility: boolean; continuousReconnect: boolean; onNamed(target: PlaybackTarget): void; onPicture(target: PlaybackTarget): void; onMessage(message: MessageKey): void; onEnded(target: PlaybackTarget): void }`.
- Produces: `QuickSeekState = { deltaSeconds: number; targetSeconds: number }`.
- Produces: `PlaybackCapabilities = { canPause: boolean; audioTracks: MediaTrack[]; subtitleTracks: MediaTrack[] }`.
- Produces: `PlaybackController = { snapshot: PlaybackSnapshot; preview: PlaybackTarget | null; shown: PlaybackTarget | null; capabilities: PlaybackCapabilities; quickSeek: QuickSeekState | null; subtitleCue: string; recovery: RecoveryState; start(item: TuneItem, options?: { restart?: boolean }): void; retune(): void; stop(): void; step(delta: -1 | 1, list: readonly TuneItem[]): void; setPlaying(play: boolean): boolean; togglePlaying(): boolean; seekTo(seconds: number, source: "quick" | "deck" | "go-live"): void; seekBy(seconds: number, source: "quick" | "deck"): void; goLive(): void; selectTrack(kind: "audio" | "subtitle", engineIndex: number | null): boolean; setMuted(muted: boolean): void; adjustVolume(delta: number): void; getStats(): PlaybackStats | null }`.
- Changes: `LiveScreenProps.tuner: Tuner` becomes `LiveScreenProps.playback: PlaybackController`, while every existing `step` call keeps passing the screen owned visible list.
- Keeps: the existing 450 millisecond channel settle and channel change wrapping.
- Removes: every `busy`, `paused`, `fault`, `filling`, `waited`, `retryIn`, `attempt`, `position`, `duration`, and `completed` boolean combination from React consumers.

- [ ] **Step 1: Port old tuner tests into snapshot tests before creating the hook**

Rename the test file and update the player fake to the Task 2 interface. Preserve coverage for live, movie, episode, compatibility preparation, HTTP fallback, pause, completion, channel settle, visibility, fit, mute, volume, and reselect behavior.

- [ ] **Step 2: Add phase transition tests**

```ts
test("startup, playback, reported buffering, recovery, pause, seek, end, and failure use one snapshot phase", () => {
  start(movie);
  expect(result.current.snapshot.phase).toBe("connecting");
  player.emit({ type: "playing" });
  expect(result.current.snapshot.phase).toBe("playing");
  player.emit({ type: "buffering-start" });
  expect(result.current.snapshot.phase).toBe("rebuffering");
});
```

Add tests proving startup does not become playing before decoded evidence, `bufferedPercent` clamps from zero to 100, reported buffering differs from initial connection, deliberate pause and seek suppress frozen detection, completed finite playback emits `ended` without retry, Live stream end enters recovery, and a stale player event cannot mutate a newer target.

- [ ] **Step 3: Add controller seek tests**

Cover immediate target updates, ten second accumulation, one seek after 350 milliseconds, five second timeout, actual position restoration, clamping, state preservation while paused, Live expired start clamping, post seek range refresh, Go live safe target, and Go live retune after rejection.

- [ ] **Step 4: Implement `usePlaybackController`**

Construct one `Player` and one `PlaybackRecoveryCoordinator`. Remove the startup watchdog, frozen playhead timer, and three attempt hls.js retry budget from `Player` because the coordinator now owns those policies. Use refs for callbacks and selected target so neither engine lifetime nor recovery timers depend on render identity. Sample finite clocks once per second, visible Live clocks every two seconds, and stop Live polling while hidden. The recovery suspend action calls both `Player.hide()` and `pauseRepair()`, while restore resumes repair before `Player.show()` or one coordinated reopen. Translate every event into one complete `PlaybackSnapshot` update.

- [ ] **Step 5: Move application consumers to the controller**

Update `App.tsx` and `LiveScreen.tsx` to read `controller.snapshot`. Pass `continuousReconnect: false` until Task 10 adds the persisted setting. Keep current visible surfaces until later tasks replace them. Remove the old tuner hook only after no import remains.

- [ ] **Step 6: Record deferred verification**

Do not run controller, App, or old tuner tests in this task. The deleted test name must not appear in Task 12 commands because its coverage now lives in `tests/playbackController.test.tsx`.

- [ ] **Step 7: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/hooks/usePlaybackController.ts src/App.tsx src/screens/LiveScreen.tsx src/services/player.ts tests/player.test.ts tests/playbackController.test.tsx tests/support/app.tsx
git rm src/hooks/useTuner.ts tests/tuner.test.tsx
git commit -m "refactor: replace tuner with playback controller"
```

### Task 5: Progress Records and Migration

**Files:**
- Modify: `src/stores/personal.ts`
- Modify: `src/stores/library.ts`
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `tests/personal.test.ts`
- Modify: `tests/library.test.ts`
- Modify: `tests/resume.test.tsx`
- Modify: `tests/support/app.tsx`

**Interfaces:**
- Produces: the exact approved `ResolvedPlaybackProgress`, `LegacyPlaybackProgress`, and `PlaybackProgress` union.
- Produces: persisted `progressMigrationBaseTime?: number`, which remains only while a legacy progress record exists.
- Changes: `PlaybackTarget.progress?: PlaybackProgressSeed`.
- Produces: `ProgressSnapshot = PlaybackProgressSeed` and `ProgressBoundary = "tick" | "pause" | "stop" | "hidden" | "target-change"`.
- Changes: `progressFor(itemKey: string): PlaybackProgress | undefined`.
- Produces: `beginProgressSession(itemKey: string, startSeconds: number): void`.
- Changes: `rememberProgress(snapshot: ProgressSnapshot, seconds: number, duration?: number, boundary?: ProgressBoundary, now?: number): void`.
- Produces: `resolveLegacyProgress(seeds: readonly ProgressSnapshot[]): void`.
- Produces: `removeAbsentLegacyProgress(playlistId: string, kind: "movie", authoritativeItemKeys: ReadonlySet<string>): void`.
- Keeps: `completeProgress(itemKey: string): void`, `clearPlaylistPersonal(playlistId: string): void`, the 100 item bound, and fifteen second ordinary persistence threshold.

```ts
export interface ResolvedPlaybackProgress {
  itemKey: string;
  playlistId: string;
  kind: "movie" | "episode" | "catchup";
  providerId?: string;
  episodeIdentity?: string;
  directSourceFingerprint?: string;
  categoryKey: string;
  extension?: string;
  seconds: number;
  duration?: number;
  updatedAt: number;
  name: string;
  logo: string;
  parentKey?: string;
  parentProviderId?: string;
  parentName?: string;
  season?: number;
  episode?: number;
}

export interface LegacyPlaybackProgress {
  itemKey: string;
  seconds: number;
  duration?: number;
  legacyOrder: number;
}

export type PlaybackProgress = ResolvedPlaybackProgress | LegacyPlaybackProgress;
export type ProgressSnapshot = PlaybackProgressSeed;
export type ProgressBoundary = "tick" | "pause" | "stop" | "hidden" | "target-change";
```

- [ ] **Step 1: Replace the compact progress test fixtures with approved shapes**

```ts
test("old compact progress becomes ordered legacy progress with one stable base time", async () => {
  seedProgress([{ itemKey: "oldest", seconds: 20 }, { itemKey: "newest", seconds: 40 }]);
  const state = await loadPersonalAt(1_000_000);
  expect(state.progress).toEqual([
    { itemKey: "oldest", seconds: 20, legacyOrder: 0 },
    { itemKey: "newest", seconds: 40, legacyOrder: 1 },
  ]);
  expect(saved().progressMigrationBaseTime).toBe(1_000_000);
});
```

Add malformed, previous version, partially migrated, mixed resolved and legacy, duplicate, over 100, restart, interrupted migration, playlist removal, account replacement, reset, and completion cases.

- [ ] **Step 2: Test the exact legacy time formula**

Resolve two records after later activity and assert `updatedAt = baseTime - (legacyCount - legacyOrder) * 1000`. Assert that a later restart cannot make either legacy record newer than activity saved after migration.

- [ ] **Step 3: Test resolved movie, episode, and catchup persistence**

Assert movie resolution requires provider id and category key. Assert episode resolution requires category key and either provider id or direct source fingerprint, carries parent series fields and `episodeIdentity`, and never persists an idless episode. Assert catchup remains available to Guide but is excluded from any movie or episode Continue watching query.

- [ ] **Step 4: Implement migration and resolution in `personal.ts`**

Validate unknown data, preserve the original persisted array index as `legacyOrder`, capture one base time, and remove the base time after the final legacy record resolves or is deleted. Update existing resolved activity by item key and `updatedAt`, then retain the newest 100 records.

- [ ] **Step 5: Attach progress seeds at playback target construction**

Movies carry provider id, category key, extension, name, and logo. Episodes also carry episode identity, parent keys and names, season, episode, and optional direct source fingerprint. Catchup carries its programme item key and channel category. Do not put raw media addresses into progress.

- [ ] **Step 6: Resolve old records from authoritative library loads**

After the complete movie index loads, resolve matching movie records and remove legacy movie records that the authoritative index proves absent. After a series detail loads, resolve every matching episode record from that detail without deleting unmatched global episode records, because one series response cannot prove another series item absent.

- [ ] **Step 7: Persist at every approved boundary**

Call `beginProgressSession` when a finite target starts, then use the controller snapshot to persist ordinary fifteen second advances with boundary `tick`. Persist immediately with `pause`, `stop`, `hidden`, or `target-change`. Completion removes progress. Restart from zero keeps prior progress until the new session advances fifteen seconds, then the new session replaces it.

- [ ] **Step 8: Record deferred verification**

Do not run personal, library, resume, or component tests in this task. Task 12 runs the migration against the complete suite.

- [ ] **Step 9: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/types.ts src/stores/personal.ts src/stores/library.ts src/App.tsx tests/personal.test.ts tests/library.test.ts tests/resume.test.tsx tests/support/app.tsx
git commit -m "feat: migrate playback progress snapshots"
```

### Task 6: Deck, Seek Bar, and Finite Quick Seek Components

**Files:**
- Create: `src/components/playback/PlaybackDeck.tsx`
- Create: `src/components/playback/PlaybackDrawer.tsx`
- Create: `src/components/playback/SeekBar.tsx`
- Create: `src/components/playback/QuickSeek.tsx`
- Create: `tests/playbackDeck.test.tsx`
- Modify: `src/components/Icon.tsx`
- Modify: `src/components/PlaybackInfo.tsx`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts`, and `src/locales/zh-CN.ts`
- Modify: `src/styles/app.css`
- Modify: `src/styles/tokens.css`
- Modify: `tests/rtl-controls.test.tsx`

**Interfaces:**
- Produces: `PlaybackDeckFocus = "seek" | "go-live" | "guide" | "details" | "previous" | "play-pause" | "next" | "audio" | "subtitles" | "more"`.
- Produces: `PlaybackDeckAction = Exclude<PlaybackDeckFocus, "seek">`.
- Produces: `PlaybackDeckMetadata = { kind: PlaybackTarget["kind"]; title: string; year?: string; quality?: string; currentProgramme?: string; currentStart?: number; currentEnd?: number; nextProgramme?: string }`.
- Produces: `PlaybackDeckProps = { snapshot: PlaybackSnapshot; metadata: PlaybackDeckMetadata; focus: PlaybackDeckFocus; canPause: boolean; hasAudio: boolean; hasSubtitles: boolean; previousEnabled: boolean; nextEnabled: boolean; quickSeekPending: boolean; onFocus(focus: PlaybackDeckFocus): void; onSeek(targetSeconds: number): void; onAction(action: PlaybackDeckAction): void; onClose(): void; onInteraction(): void }`.
- Produces: `SeekBarProps = { range: SeekRange; position: number; target: number; focused: boolean; live: boolean; showGoLive: boolean; goLiveFocused: boolean; onTarget(target: number): void; onGoLive(): void; onFocus(focus: "seek" | "go-live"): void }`.
- Produces: `PlaybackDrawerProps = { title: string; origin: PlaybackDeckFocus | "live-browser"; children: React.ReactNode; onBack(origin: PlaybackDeckFocus | "live-browser"): void }`.
- Produces: `QuickSeekProps = { state: QuickSeekState }`.

- [ ] **Step 1: Write component tests before component code**

```tsx
test("finite deck opens on Play or Pause and opens on seek after quick seeking", () => {
  const { rerender } = renderDeck({ quickSeekPending: false });
  expect(selectedControl()).toBe("play-pause");
  rerender(renderDeckProps({ quickSeekPending: true }));
  expect(selectedControl()).toBe("seek");
});

test("drawer Back restores its exact deck origin and starts a fresh deck interval", () => {
  openDrawer("audio");
  press(KEY.BACK);
  expect(deckFocus()).toBe("audio");
  advance(4_999);
  expect(deckVisible()).toBe(true);
});
```

Cover five second closure, timer restart for direction, OK, pointer, and transport, no timer while a drawer is open, paused deck closure, finite metadata, full width hairline, Previous and Next disabled geometry, omitted unsupported controls, seek focus thickness, thumb and target time, pointer seek, right to left placement, reduced motion, accessible names, and no text below the caption floor.

- [ ] **Step 2: Implement the deck focus model**

The finite control row is Details, Previous, Play or Pause, Next, Audio when available, Subtitles when available, and More. Omit unsupported context and track actions. Keep Previous and Next present but disabled when their adjacent item is absent. Open on Play or Pause unless quick seeking was active, which opens on Seek. Up from controls enters Seek, Down from Seek returns to Play or Pause, and button movement stops at both row boundaries. Left and Right adjust the focused seek target. For delayed Live, one additional Right at the clamped safe target moves focus to Go live, while Left from Go live returns to Seek.

- [ ] **Step 3: Implement finite and Live seek rendering in `SeekBar.tsx`**

Use semantic percentages derived from the range. The seek track has no enclosing border. White focus enlarges the thumb and track, while blue remains played progress. Pointer input clamps through `clampSeekTarget` and calls the same controller action as remote input.

- [ ] **Step 4: Implement compact quick seek feedback**

Show accumulated signed seconds and the target clock. The component takes no focus and has no pointer behavior. It must not mount while a deck or drawer is visible.

- [ ] **Step 5: Move playback information into More drawer content**

Keep the existing engine statistics, add recovery cause and attempt from normalized diagnostics, and remove the instruction about holding OK. Do not include stream or artwork addresses.

- [ ] **Step 6: Add translated playback labels**

Add complete deck, action, seek, target time, Live, Go live, audio, subtitles, Automatic, Off, More, and unavailable messages in English, Persian, and every exact locale file listed above.

- [ ] **Step 7: Add flex gap fallback and right to left styles**

Mirror leading and trailing context actions, drawer entry, seek direction, and target label placement. Preserve semantic rewind and forward meaning. Add margin fallback selectors for every new flex gap container.

- [ ] **Step 8: Record deferred verification**

Do not run component, locale, spacing, engine, or build checks in this task. Task 12 owns the first execution.

- [ ] **Step 9: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/components/playback/PlaybackDeck.tsx src/components/playback/PlaybackDrawer.tsx src/components/playback/SeekBar.tsx src/components/playback/QuickSeek.tsx src/components/Icon.tsx src/components/PlaybackInfo.tsx src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts src/styles/app.css src/styles/tokens.css tests/playbackDeck.test.tsx tests/rtl-controls.test.tsx
git commit -m "feat: add playback deck and seek surfaces"
```

### Task 7: Mode Specific Input, Finite Seeking, and Live DVR

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/screens/LiveScreen.tsx`
- Modify: `src/services/surfaceStack.ts`
- Modify: `src/types.ts`
- Modify: `src/hooks/usePlaybackController.ts`
- Modify: `src/components/playback/PlaybackDeck.tsx`
- Modify: `src/components/playback/SeekBar.tsx`
- Modify: `src/components/playback/QuickSeek.tsx`
- Modify: `src/components/PictureState.tsx`
- Modify: `src/components/PlaybackBanner.tsx`
- Modify: `src/services/lineup.ts`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts`, and `src/locales/zh-CN.ts`
- Modify: `src/styles/app.css`
- Modify: `tests/playbackController.test.tsx`
- Modify: `tests/playbackDeck.test.tsx`
- Modify: `tests/surfaceStack.test.ts`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/panelNav.test.tsx`
- Modify: `tests/banner.test.tsx`
- Modify: `tests/lineup.test.ts`
- Modify: `tests/support/app.tsx`
- Modify: `AGENTS.md`
- Modify: `docs/design.md`

**Interfaces:**
- Consumes: the subsystem 1 `SurfaceStack`, `activeSurface`, `LiveScreen` key delegation, deck components, and controller commands from Tasks 4 and 6.
- Changes: `PrimarySurface = "panel" | "playback-deck"` and `DrawerSurface = "guide" | "audio" | "subtitles" | "more"` in `services/surfaceStack.ts`.
- Produces: `PlaybackReturnRoute = { surface: "live-browser" | "movie-details" | "series-details" | "episode" | "guide"; itemKey: string }` in `src/types.ts`.
- Produces: `LiveScreenPlaybackActions = { openDeck(focus?: PlaybackDeckFocus): void; openGuide(channel: Channel, origin: "live-browser" | "deck"): void; play(target: PlaybackTarget, route: PlaybackReturnRoute): void }` in `src/screens/LiveScreen.tsx`.
- Produces privately: one `SurfaceKeyHandler = (code: number, event: KeyboardEvent) => void` for uncovered Live picture, uncovered finite picture, deck, and each drawer.
- Changes: focus movement clamps at list boundaries. `nextChannel` and physical channel changes still wrap.

- [ ] **Step 1: Extend surface precedence and replace the old absolute key law tests**

Add direct `activeSurface` cases for `playback-deck`, every playback drawer, a modal above each, and a confirmation above the complete stack. Then add the mode specific application contracts.

```ts
test("uncovered Live picture opens browser on Left and OK, deck on Right, and changes channels on Up and Down", async () => {
  startLive();
  press(KEY.RIGHT);
  expect(deckVisible()).toBe(true);
});

test("uncovered finite picture quick seeks on Left and Right and ignores Up and Down", async () => {
  startFinite();
  press(KEY.RIGHT);
  expect(quickSeekTarget()).toBe(10);
  expect(deckVisible()).toBe(false);
});
```

Add physical Play, Pause, Play or Pause, Stop, Previous, Next, Rewind, and Fast Forward cases with and without the deck. Add immediate OK without the old long press playback information action, digits only in Live, text field ownership, yellow Settings, green favourite, red Live category visibility, channel keys, pointer actions, development remote, paired remote command, Back transient order, and terminal failure behavior.

- [ ] **Step 2: Test finite quick seeking through the whole application**

Repeated and held direction presses must accumulate immediately, perform one engine seek 350 milliseconds after settlement, preserve pause, clamp at zero and duration, restore actual position on rejection or timeout, show Seeking unavailable, and open the deck on seek focus only after OK.

- [ ] **Step 3: Test Live DVR through the whole application**

Cover Right opening the deck whether a range exists, no picture level Live seek, no timeline for a short or invalid range, ordinary Live badge, DVR timeline with the oldest available programme time on the left, Go live only while delayed, two second range refresh, moving windows, expired target clamping, hysteresis, ordinary Live pause retune, DVR pause resume in place, pause unavailable, Go live safe target, and retune after a rejected edge seek.

- [ ] **Step 4: Wire the surface stack and input owners**

Set `SurfaceStack.primary` to `playback-deck` instead of `panel` when the deck opens, and set `SurfaceStack.drawer` for Guide, Audio, Subtitles, or More. Render `PlaybackInfo` inside More and remove the old persistent side overlay render. Remove the picture OK `useLongPress` instance so OK dispatches its mode action immediately, while Red keeps the subsystem 1 long press hook. Keep `activeSurface` as the only precedence decision and render a drawer instead of its caller. Any direction, OK, pointer, or transport action restarts the deck interval. Back closes exactly one focus owning playback surface. Clear quick seek, banner, and compact recovery feedback before opening a focus owning surface. Target change, Stop, entry into a VOD mode, and application exit call the controller cancellation boundary before the shell changes surface.

- [ ] **Step 5: Implement finite picture actions**

Left and Right call `controller.seekBy` with `source = "quick"`. OK opens the deck. Play or Pause changes state and opens the deck on Play or Pause. Up and Down return deliberate no action. Stop persists, releases playback, and returns through `PlaybackReturnRoute`.

- [ ] **Step 6: Implement Live picture and DVR actions**

Left and OK open the Live browser. Right always opens the deck. Play or Pause changes state and opens the deck. Stop releases playback and opens the Live browser on the stopped channel. The ordinary Live deck contains Live metadata, Guide, Play or Pause only when legal, available Audio, available Subtitles, and More, with no timeline, Previous, or Next. Live DVR adds the timeline and Go live without moving the remaining actions. Derive the oldest available programme label from the current wall clock and the measured Live window span. At ordinary Live, Play retunes to the current edge. At Live DVR, Play resumes in place. A missing legal pause operation omits Pause and reports Pause unavailable for a physical request.

- [ ] **Step 7: Narrow full picture and banner rendering**

`PictureState` renders full connecting, paused, and terminal failure states only. `PlaybackBanner` renders Live targets only, hides beneath deck, drawer, browser, VOD, or modal, and keeps the existing eight second interval. Update its key guide to the revised Live picture meanings.

- [ ] **Step 8: Stop all focus lists at boundaries**

Replace `stepColumn` wrapping with clamping for panel, search, Guide, deck, and drawer focus. Keep `wrap` only for channel changes. Update category and title bar transitions so focus never loops.

- [ ] **Step 9: Update contract documentation in the same change**

Replace the old absolute four law wording in `AGENTS.md` and `docs/design.md` with the approved mode specific Live picture, finite picture, deck, drawer, browser, and Back contract. Update the `AGENTS.md` project map from `useTuner` to `usePlaybackController`. Replace the old no seek bar rationale with finite seek and capability based Live DVR rationale.

- [ ] **Step 10: Record deferred verification**

Do not run key law, controller, panel, banner, lineup, style, build, or television checks in this task. Task 12 runs the first complete verification.

- [ ] **Step 11: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/App.tsx src/screens/LiveScreen.tsx src/services/surfaceStack.ts src/types.ts src/hooks/usePlaybackController.ts src/components/playback/PlaybackDeck.tsx src/components/playback/SeekBar.tsx src/components/playback/QuickSeek.tsx src/components/PictureState.tsx src/components/PlaybackBanner.tsx src/services/lineup.ts src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts src/styles/app.css tests/playbackController.test.tsx tests/playbackDeck.test.tsx tests/surfaceStack.test.ts tests/keyLaws.test.tsx tests/panelNav.test.tsx tests/banner.test.tsx tests/lineup.test.ts tests/support/app.tsx AGENTS.md docs/design.md
git commit -m "feat: apply mode specific playback controls"
```

### Task 8: Audio, Subtitle, and More Drawers

**Files:**
- Create: `src/components/playback/TrackPicker.tsx`
- Create: `src/components/playback/SubtitleLayer.tsx`
- Create: `tests/subtitles.test.tsx`
- Modify: `src/components/playback/PlaybackDrawer.tsx`
- Modify: `src/components/playback/PlaybackDeck.tsx`
- Modify: `src/hooks/usePlaybackController.ts`
- Modify: `src/App.tsx`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts`, and `src/locales/zh-CN.ts`
- Modify: `src/styles/app.css`
- Modify: `tests/playbackTracks.test.ts`
- Modify: `tests/playbackDeck.test.tsx`
- Modify: `tests/rtl-controls.test.tsx`

**Interfaces:**
- Produces: `TrackPickerOption = { id: string; label: string; selected: boolean; engineIndex: number | null; automatic?: boolean }`.
- Produces: `TrackPickerProps = { kind: "audio" | "subtitle"; tracks: readonly MediaTrack[]; selectedIdentity: string | null; deviceLanguage: string; onSelect(engineIndex: number | null, identity: string | null): boolean }`.
- Produces: `SubtitleLayerProps = { cue: string; hidden: boolean }`.
- Changes: controller remembers explicit audio and subtitle identities, reapplies an exact normalized match on a new target, and accepts provider default when that identity is absent.

- [ ] **Step 1: Write drawer and selection tests**

Assert Audio appears only with more than one meaningful audio choice. Assert Subtitles appears when at least one subtitle track exists. Assert subtitle options begin with Off and add Automatic only for one unambiguous device language match. Assert labels prefer provider label, then language, then translated numbered fallback.

- [ ] **Step 2: Write subtitle lifecycle tests**

```tsx
test("AVPlay subtitle markup is rendered as text and clears at its duration", () => {
  emitSubtitle("<b>Provider words</b>", 2_000);
  expect(screen.getByText("<b>Provider words</b>")).toBeTruthy();
  advance(2_000);
  expect(subtitleText()).toBe("");
});
```

Cover an empty payload, next cue, track change, target change, Off, native cue change, hidden browser text track mode, no duplicate native caption, deck avoidance, safe area, bright and dark edge treatment, right to left cue text, and reduced motion.

- [ ] **Step 3: Implement fixed drawer behavior**

Vertically center one translated title in the fixed header. Keep every direction inside the option list and stop at boundaries. Do not start a timer. Back restores the exact Audio, Subtitles, or More deck action and starts a fresh five second deck interval.

- [ ] **Step 4: Implement immediate selection with rollback**

Apply a selected engine index immediately and keep focus on that row. When `Player.selectTrack` returns false, restore the previous selected identity and show one compact Track unavailable message. Closing without selecting leaves the current track unchanged.

- [ ] **Step 5: Implement application subtitle output**

Use one text node with `dir="auto"` inside the safe area. Clear the cue through controller owned target and duration state. The layer moves above the lower safe edge while the deck is visible and remains hidden when subtitles are Off.

- [ ] **Step 6: Preserve More beside the new track drawers**

Keep More on the same `PlaybackDrawer` path introduced in Task 7, keep the drawer untimed, and restore focus to More on Back after adding Audio and Subtitles.

- [ ] **Step 7: Record deferred verification**

Do not run track, subtitle, component, right to left, spacing, engine, or build checks in this task.

- [ ] **Step 8: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/components/playback/TrackPicker.tsx src/components/playback/SubtitleLayer.tsx src/components/playback/PlaybackDrawer.tsx src/components/playback/PlaybackDeck.tsx src/hooks/usePlaybackController.ts src/App.tsx src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts src/styles/app.css tests/subtitles.test.tsx tests/playbackTracks.test.ts tests/playbackDeck.test.tsx tests/rtl-controls.test.tsx
git commit -m "feat: add playback track drawers"
```

### Task 9: Programme Guide as a Playback Drawer

**Files:**
- Modify: `src/components/GuideList.tsx`
- Modify: `src/components/PanelHeader.tsx`
- Modify: `src/components/playback/PlaybackDrawer.tsx`
- Modify: `src/components/playback/PlaybackDeck.tsx`
- Modify: `src/stores/library.ts`
- Modify: `src/App.tsx`
- Modify: `src/screens/LiveScreen.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts`, and `src/locales/zh-CN.ts`
- Modify: `tests/guide.test.ts`
- Modify: `tests/guide-ui.test.tsx`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/support/app.tsx`

**Interfaces:**
- Consumes: `PlaybackDrawer`, `PlaybackReturnRoute`, `ChannelGuide`, and `PlaybackController.start`.
- Produces: `GuideListProps = { channel: Channel; guide: ChannelGuide; index: number; focused: boolean; scale: number; onMove(index: number): void; onPlay(index: number): void; onRetry(): void; onWheel(direction: -1 | 1): void }`.
- Produces: Guide origins `"deck"` and `"live-browser"`, each with its own exact focus restoration.
- Changes: `PanelHeader` shows Guide as a Live browser context action only when the focused channel has Xtream programme data.

- [ ] **Step 1: Update Guide component tests before changing rendering**

Assert the generic drawer owns the fixed header, the programme list remains windowed, current and future entries are readable, only valid archived entries show Play from start, and loading, empty, and failed states occupy the drawer. Retry is the only focusable failed state action and Back remains available in every state.

- [ ] **Step 2: Test both origins and exact Back restoration**

Open Guide from the deck, move, press Back, and assert the deck returns with Guide focused and a fresh five second interval. Open Guide from the Live browser, move, press Back, and assert the same channel row or context control returns without rendering the browser behind the drawer.

- [ ] **Step 3: Test archived playback return behavior**

Selecting Play from start closes the drawer and starts finite playback with a Guide `PlaybackReturnRoute`. Stop and natural completion return to Guide while the archive target remains valid. An expired archive target remains readable but exposes no Play action.

- [ ] **Step 4: Refactor `GuideList` into drawer content**

Remove its private outer drawer and header animation. Let `PlaybackDrawer` own title, surface, and Back. Keep current programme marking distinct from white focus and blue selection.

- [ ] **Step 5: Add Guide to both callers**

The Live deck leading action opens Guide for the playing channel. The Live browser context action opens Guide for the focused channel. Opening cancels the deck interval, clears transient overlays, and does not leave either caller rendered behind the drawer.

- [ ] **Step 6: Record deferred verification**

Do not run Guide, key law, component, spacing, engine, or build checks in this task.

- [ ] **Step 7: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/components/GuideList.tsx src/components/PanelHeader.tsx src/components/playback/PlaybackDrawer.tsx src/components/playback/PlaybackDeck.tsx src/stores/library.ts src/App.tsx src/screens/LiveScreen.tsx src/styles/app.css src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts tests/guide.test.ts tests/guide-ui.test.tsx tests/keyLaws.test.tsx tests/support/app.tsx
git commit -m "feat: integrate the playback Guide drawer"
```

### Task 10: Recovery Presentation and Continuous Reconnect Setting

**Files:**
- Create: `src/components/playback/RecoveryStatus.tsx`
- Modify: `src/components/PictureState.tsx`
- Modify: `src/components/PlaybackInfo.tsx`
- Modify: `src/hooks/usePlaybackController.ts`
- Modify: `src/stores/settings.ts`
- Modify: `src/services/remoteProtocol.ts`
- Modify: `public/remote/remote.js`
- Modify: `src/components/settings/Behaviour.tsx`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts`, and `src/locales/zh-CN.ts`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/playbackController.test.tsx`
- Modify: `tests/settings.test.ts`
- Modify: `tests/settings-ui.test.tsx`
- Modify: `tests/remoteProtocol.test.ts`
- Modify: `tests/remoteWeb.test.ts`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/support/app.tsx`

**Interfaces:**
- Produces: `RecoveryStatusProps = { state: RecoveryState; hidden: boolean }`.
- Changes: `Settings.continuousReconnect: boolean` defaults to false, validates unknown saved input, persists locally, and appears in television and paired phone Playback settings.
- Removes: `Settings.showPlaybackStats`, its remote field, its phone toggle, and long OK handling. More remains the reachable playback information path.

- [ ] **Step 1: Write recovery presentation tests**

Assert buffering shorter than 1.5 seconds renders no overlay. Assert longer rebuffering appears beside the clock while the last frame remains unobscured. Assert recovering and reconnect countdown use the same compact region. Assert deck, drawer, browser, VOD, and modal hide compact status. Assert connecting, paused, and terminal failure remain the only full picture states.

- [ ] **Step 2: Write Continuous reconnect migration and UI tests**

```ts
test("Continuous reconnect is false for new, old, malformed, and partial settings", async () => {
  expect((await loadSettings({})).continuousReconnect).toBe(false);
  expect((await loadSettings({ continuousReconnect: "yes" })).continuousReconnect).toBe(false);
});
```

Assert television and phone toggles write the same setting, remote parsing rejects nonboolean values, remote snapshots include the field, the old `showPlaybackStats` field is removed during canonical write, and More remains reachable through directions and OK.

- [ ] **Step 3: Wire compact recovery state**

Position the compact surface beside the clock in both text directions. Use `role="status"`, plain translated messages, recovery attempt, and countdown. Do not show engine code, address, provider text, or credentials.

- [ ] **Step 4: Wire Continuous reconnect into session creation**

Read the current setting when a target starts and when a new failure begins. Turning it off during an extended wait cancels that wait and ends at the bounded default result. Turning it on affects later Live attempts for the same selected channel. It never extends finite retries.

- [ ] **Step 5: Remove the old playback information overlay route**

Confirm Task 7 removed the picture OK long press and delete any remaining persistent side overlay render. Remove the setting from television and phone state. Keep `PlaybackInfo` only as More drawer content.

- [ ] **Step 6: Record deferred verification**

Do not run settings, remote, controller, key law, style, build, or television checks in this task.

- [ ] **Step 7: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add src/components/playback/RecoveryStatus.tsx src/components/PictureState.tsx src/components/PlaybackInfo.tsx src/hooks/usePlaybackController.ts src/stores/settings.ts src/services/remoteProtocol.ts public/remote/remote.js src/components/settings/Behaviour.tsx src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts src/App.tsx src/styles/app.css tests/playbackController.test.tsx tests/settings.test.ts tests/settings-ui.test.tsx tests/remoteProtocol.test.ts tests/remoteWeb.test.ts tests/keyLaws.test.tsx tests/support/app.tsx
git commit -m "feat: add continuous playback recovery"
```

### Task 11: Transition Matrix and Playback Verification Documentation

**Files:**
- Modify: `tests/keyLaws.test.tsx`
- Modify: `docs/testing.md`

**Interfaces:**
- Produces: generated key transition cases for Live picture, finite picture, deck seek row, deck controls, each drawer, Live browser, and modal ownership.
- Produces for subsystem 5: the stable `PlaybackController.recovery: RecoveryState` contract that deterministic television fault fixtures may inspect without receiving a playback target or address.
- Defers to subsystem 5: controlled AVPlay faults, connection counting, complete redesign journey labels, broad parity walks, and recovery budget journeys, because the approved delivery structure assigns broad television journeys and final acceptance verification to completion work.

- [ ] **Step 1: Add a generated key transition matrix to `tests/keyLaws.test.tsx`**

Each row names surface, focus, key, next owner, next focus, and side effect. Iterate the matrix and assert one valid owner or deliberate no action. Include list boundary cases so no focus path loops.

```ts
test.each(TRANSITIONS)("$surface $focus handles $key", async ({ arrange, key, expected }) => {
  await arrange();
  press(key);
  expect(readFocusOwner()).toEqual(expected);
});
```

- [ ] **Step 2: Cover every subsystem 2 focus owner in the matrix**

Include uncovered Live and finite pictures, deck Seek, Go live, each finite and Live control, Guide loading and Retry, audio rows, subtitle Off and Automatic, More, each boundary direction, Back from every depth, physical transport keys, modal blocking, and deliberate no action results.

- [ ] **Step 3: Update `docs/testing.md`**

Document the focused range, player, controller, recovery, progress, deck, track, subtitle, Guide, and key law tests added by this subsystem. Document the exact real television acceptance list for Live with and without DVR, finite quick seek, tracks, subtitles, rebuffering, frozen playhead recovery, terminal refusal, hiding, restore, and continuous reconnect cancellation. State that subsystem 5 adds deterministic fault controls, provider connection assertions, and complete redesign journeys.

- [ ] **Step 4: Record deferred verification**

Do not run key law tests, builds, or television gates in this task. Task 12 is the first automated execution for the completed subsystem.

- [ ] **Step 5: Prepare the intended commit**

After explicit commit approval, run:

```bash
git add tests/keyLaws.test.tsx docs/testing.md
git commit -m "docs: record playback verification contracts"
```

### Task 12: Final Gate Before Push

**Files:**
- Review: every file in the File Map
- Review: complete branch diff against the subsystem 1 base
- Fix only: defects introduced by Tasks 1 through 11

**Interfaces:**
- Consumes: all subsystem 2 interfaces and tests.
- Produces: one verified branch with no unresolved blocking or high confidence playback defect.
- Produces no new feature, dependency, remote meaning, migration, provider write, or visual structure.

- [ ] **Step 1: Inspect the complete diff before running automation**

Confirm every spec section from Playback State Model through Playback Recovery, Personal State progress, relevant Remote Input Contract, Guide, track, accessibility, compatibility, and verification requirements maps to a task and a changed file. Search for old `useTuner`, `showPlaybackStats`, finite banner, picture level Live seek, wrapping focus, and old absolute key law wording.

- [ ] **Step 2: Check repository and Markdown integrity**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors, no unexpected files, and only planned changes.

- [ ] **Step 3: Install the locked dependency tree once**

Run:

```bash
npm ci
```

Expected: success with the committed lockfile and no dependency change.

- [ ] **Step 4: Run the complete local code gate once**

Run:

```bash
npm run check
```

Expected: Biome lint, TypeScript, every unit test, and every component test pass. This is the first test, lint, or type check execution in the plan.

- [ ] **Step 5: Build the production artifact once**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite complete with the player adapters, application wiring, dynamic hls.js chunk, and production asset graph intact.

- [ ] **Step 6: Run spacing and engine parity against that build**

Run:

```bash
npm run tv:gap
npm run tv:engines
```

Expected: every new deck, seek, drawer, subtitle, compact status, and right to left structural box keeps parity, and Chromium 69 reports no unsupported runtime method.

- [ ] **Step 7: Run the current television performance gate on a quiet machine**

Check the machine load first, then run:

```bash
npm run tv:budget
```

Expected: the existing launch, panel, catalogue, and interaction journeys remain measured and within budget after playback wiring and component changes. Deterministic playback fault and provider connection journeys remain assigned to subsystem 5. If load is high, report it before treating a timing failure as a product regression.

- [ ] **Step 8: Confirm WebAssembly scope**

Do not run `npm run wasm:check` unless implementation changed `wasm/`, `public/wasm/`, a worker, a checksum, or the repair integration artifact. Type only changes in `services/repair.ts` do not require the WebAssembly check.

- [ ] **Step 9: Perform real television acceptance when hardware is available**

Use authorised test sources for HLS Live without DVR, HLS Live with DVR, MPEG TS Live, one movie, one episode, one catchup programme, multiple audio tracks, embedded subtitles, rebuffer recovery, a frozen playhead, and continuous reconnect cancellation. Verify quick seek while playing and paused, ordinary Live pause behavior, Live DVR pause behavior, Go live, every drawer, Back restoration, terminal refusal, hide and restore, and no excess provider connection.

When measuring a permitted stream, use the existing command shape:

```bash
npm run tv:on-set -- --stream="$AUTHORISED_TEST_STREAM"
```

Record model, Tizen version, source kind, available capabilities, playback result, recovery cause, and connection behavior. Hardware unavailability does not become simulated evidence and must remain reported release risk.

- [ ] **Step 10: Fix only relevant failures and rerun invalidated checks**

Do not expand the task to unrelated existing failures. If a later edit invalidates one passing command, rerun that command and every later gate that consumes its artifact. Do not repeat checks that the edit cannot affect.

- [ ] **Step 11: Run final diff review**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Review the complete diff for credentials, addresses, provider content, stale timers, duplicate connection paths, unsupported methods, list loops, missing translated keys, manual Markdown line wraps, em dash or en dash characters, and prose semicolons.

- [ ] **Step 12: Prepare a gate fix commit only if explicit approval exists**

If Task 12 required source or test fixes, add their exact paths to this step before staging anything. After Shayan explicitly approves the commit, stage only those recorded paths and run:

```bash
git commit -m "fix: complete playback recovery gate"
```

Do not push until Shayan explicitly asks for a push.
