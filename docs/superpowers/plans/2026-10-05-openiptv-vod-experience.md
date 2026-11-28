# OpenIPTV VOD Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan one task at a time. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current list based Xtream Movies and Series path with the approved full screen VOD experience, including resilient provider normalization, bounded catalogue and artwork caches, scoped search, progress, favourites, poster browsing, Movie details, Series details, seasons, and episodes.

**Architecture:** `services/xtream.ts` remains the only provider boundary, while `stores/library.ts` owns six hour catalogue state and `stores/personal.ts` owns synchronous progress and favourite snapshots. `screens/VodScreen.tsx` owns the opaque Movies and Series surface, `useVodNavigation.ts` owns its remote and pointer cursors, and focused VOD components render one region each. The application shell from subsystem 1 remains the top level mode and screen stack owner, while the playback controller from subsystem 2 remains the only path to the decoder.

**Tech Stack:** React 19, TypeScript, zustand, native Fetch, URL, AbortController, ReadableStream and IndexedDB APIs, existing canvas and ImageBitmap artwork handling, Vitest, Testing Library, Biome, Vite, AVPlay, hls.js, and the existing television harness.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`, subsystem 3 only.

## Global Constraints

- Implement delivery subsystem 3 only. Treat the application shell and navigation contracts from subsystem 1 and the playback controller, finite playback, seeking, deck, and recovery contracts from subsystem 2 as present.
- Add no hosted service, analytics, runtime dependency, provider administration, bundled content, external metadata lookup, external trailer playback, autoplay preview, recommendation system, or model year branch.
- Preserve one production artifact targeting ES2019 and Chromium 69. Do not use unsupported runtime methods, CSS `aspect-ratio`, CSS `inset` shorthand, or unguarded flex gap.
- Keep `App.tsx` as the screen stack owner, tuner owner, and top level mode owner. It delegates VOD rendering and input rather than rebuilding VOD frame logic.
- Entering Movies or Series stops playback, releases the decoder, and remembers the Live channel. Returning to Live retunes that remembered channel through the ordinary playback controller path.
- Keep Movies and Series positions independent. Each mode remembers its category, focused item, complete row window, search origin, details focus, selected season, and focused episode.
- Preserve provider order and provider content. Trim provider strings, render them as text with `dir="auto"`, use translated Untitled and Uncategorised labels only when a trimmed value is empty, and never truncate provider text in JavaScript for display.
- Keep all important content outside the existing 48 pixel horizontal and 40 pixel vertical safe area. Keep visible text at or above the existing 20 pixel caption floor at 1920 by 1080.
- Use a 424 pixel category rail and a six column poster grid at the default scale. Poster artwork decodes to 192 by 288 pixels at that scale.
- Category focus moves immediately. Category catalogue work and grid replacement settle after 150 milliseconds. Poster fetching begins 120 milliseconds after the grid settles.
- Each accepted vertical wheel gesture moves exactly one movie, series, or episode in linear order. Reject further wheel gestures for 120 milliseconds.
- Input and query text update immediately. Search results settle after 150 milliseconds, rank names that begin with the query before names that contain it, retain at most 300 results, and report the complete count.
- A regional load that lasts longer than 100 milliseconds shows stable skeleton geometry and one accurate loading message. Never show one spinner per tile.
- Keep every Xtream API request under a 30 second timeout with an abort owner. Limit category list responses to 1 MiB, category content responses to 8 MiB, detail responses to 4 MiB, and complete Movies or Series index responses to 12 MiB.
- Use a six hour freshness policy for category lists, category contents, complete search indexes, Movie details, and Series details. A stale value, including an empty value, answers immediately and revalidates once through idle work.
- Keep the IndexedDB cache at 24 MiB, split into 12 MiB for playlists and catalogue data, 8 MiB for JPEG poster derivatives, and 4 MiB for channel logo derivatives. Artwork churn cannot evict catalogue data.
- Keep the poster bitmap cache under 12 MiB and 48 entries, whichever limit arrives first. Close every evicted bitmap.
- Give artwork requests a 15 second timeout and an 8 MiB compressed byte limit even when `Content-Length` is absent. Oversized, timed out, aborted, or undecodable images use the same stable placeholder.
- Decode the active details backdrop to at most 1280 by 720 pixels. Do not add it to the poster memory cache or disk cache, and close it when details close or the selected details item changes.
- Keep progress in synchronous local storage, bounded to 100 finite items. Persist after 15 seconds of advancement and at pause, Stop, application hiding, and target change boundaries.
- Keep favourites on movies and parent series only. Episodes never enter favourites.
- Perform no IndexedDB work and no layout read in direct response to a direction, OK, Back, pointer click, or wheel gesture.
- Use the existing two artwork decode lanes, on screen reference counting, queue cancellation, and idle disk writes.
- Preserve white focus, One UI blue selected state, separate disabled state, the existing 8 pixel rhythm, and the existing reduced motion rule. Reduced motion stops skeleton pulse, title movement, and episode panel translation.
- Translate every new application label in English, Persian, Arabic, Bengali, Chinese, Dutch, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese, Russian, Spanish, and Turkish.
- Do not run automated tests, lint, type checks, builds, television gates, or WebAssembly checks while Tasks 1 through 9 are implemented. Write every test in the owning task, inspect each diff manually, and defer execution to Task 7 of the master plan immediately before push.
- Do not change WebAssembly sources or artifacts. This subsystem does not require `npm run wasm:check`.
- Local task commits are part of the approved implementation. Every commit uses the required Devin generation and coauthor trailers. Do not push until Shayan explicitly asks.
- Task 10 records the VOD command manifest consumed by master plan Task 7. Do not execute it after this subsystem because all automated commands run once after every subsystem review passes.

## Assumed Subsystem Interfaces

Subsystem 1 and subsystem 2 supply these final shell and playback contracts before this plan begins:

```ts
export type SurfaceKeyHandler = (code: number, event: KeyboardEvent) => void;
export type PictureSurface = "picture";
export type PrimarySurface = "panel" | "playback-deck" | "vod";
export type DrawerSurface = "guide" | "audio" | "subtitles" | "more";

export interface PlaybackReturnRoute {
  surface: "live-browser" | "movie-details" | "series-details" | "episode" | "guide";
  itemKey: string;
}

export interface LiveScreenPlaybackActions {
  openDeck(focus?: PlaybackDeckFocus): void;
  openGuide(channel: Channel, origin: "live-browser" | "deck"): void;
  play(target: PlaybackTarget, route: PlaybackReturnRoute): void;
}
```

```ts
export interface PlaybackController {
  snapshot: PlaybackSnapshot;
  preview: PlaybackTarget | null;
  shown: PlaybackTarget | null;
  capabilities: PlaybackCapabilities;
  quickSeek: QuickSeekState | null;
  subtitleCue: string;
  recovery: RecoveryState;
  start(item: Channel | PlaybackTarget, options?: { restart?: boolean }): void;
  retune(): void;
  stop(): void;
  step(delta: -1 | 1, list: readonly (Channel | PlaybackTarget)[]): void;
  setPlaying(play: boolean): boolean;
  togglePlaying(): boolean;
  seekTo(seconds: number, source: "quick" | "deck" | "go-live"): void;
  seekBy(seconds: number, source: "quick" | "deck"): void;
  goLive(): void;
  selectTrack(kind: "audio" | "subtitle", engineIndex: number | null): boolean;
  setMuted(muted: boolean): void;
  adjustVolume(delta: number): void;
  getStats(): PlaybackStats | null;
}
```

Subsystem 2 also supplies `PlaybackProgressSeed`, `ResolvedPlaybackProgress`, `LegacyPlaybackProgress`, `PlaybackProgress`, `PlaybackTarget.progress`, `progressFor`, `rememberProgress`, `resolveLegacyProgress`, `removeAbsentLegacyProgress`, and `completeProgress`. This plan consumes those names and extends only the VOD selectors and normalized seed construction they need.

## Review Focus

- A provider can omit identifiers, season numbers, episode numbers, container extensions, and metadata while still supplying a playable direct source. Task 1 tests that readable content remains visible, only playable content exposes Play, and generated addresses never gain an invented extension.
- A stale category, stale empty category, details request, complete index request, or artwork request can finish after the viewer changes mode, category, query, details item, or playlist. Tasks 2, 3, 4, and 8 test that every old result is ignored and every abandoned request is aborted.
- A provider can return malformed base64, joined emoji, combining marks, credential bearing artwork addresses, oversized bodies, or response streams without `Content-Length`. Tasks 1 and 3 test that text remains intact, unsafe addresses disappear, and byte limits remain effective.
- Poster browsing can churn thousands of images while the active launch catalogue occupies most of its reserved cache class. Task 3 tests class isolation, bitmap closure, queue cancellation, and the 48 entry and 12 MiB memory limits.
- A viewer can enter details from search, switch seasons, open the inline episode panel, start an episode manually, return from playback, and then press Back. Tasks 4, 7, and 8 test exact origin restoration, zero second manual starts, and Back leaving details even while the inline panel is open.

## File Map

### Provider and data boundaries

- Modify `src/services/xtream.ts:5-82,94-182,269-540` to normalize all VOD summaries, metadata, seasons, episodes, response limits, direct sources, and generated addresses.
- Modify `src/stores/library.ts:30-75,77-225,266-620,710-752` to own six hour category, index, detail, stale refresh, abort, synthetic category, and progress resolution state.
- Modify `src/stores/personal.ts:6-58,60-177,211-334` to add Continue watching and Series continuation selectors over the rich finite progress records supplied by subsystem 2.
- Modify `src/services/search.ts:28-103` to expose the existing ranked and capped name search for VOD items without weakening Live search.

### Artwork and cache boundaries

- Create `src/services/artwork.ts` for the shared two lane decode queue, bounded reads, poster memory, backdrop lifetime, reference counting, queue cancellation, tone extraction, and idle derivative writes.
- Modify `src/services/logos.ts:20-536` into the channel logo adapter over `services/artwork.ts`, preserving its existing public channel functions.
- Create `src/components/Artwork.tsx` for the shared canvas renderer and stable content type placeholder.
- Modify `src/components/Logo.tsx:1-110` into the channel specific wrapper over `Artwork` without changing channel call sites.
- Modify `src/components/ChannelList.tsx:1-240` only where the extracted logo queue changes imports.
- Modify `src/services/metrics.ts:1-23` only where the logo metric import changes.
- Modify `src/services/disk.ts:33-115,222-388` to account for cache classes and enforce the 12 MiB, 8 MiB, and 4 MiB partitions.
- Modify `src/stores/channels.ts:238,330-332,499-553` to tag playlist, Live catalogue, and cache clearing operations with the catalogue class.
- Modify `src/components/settings/Diagnostics.tsx:90-125` to report total and per class cache usage against the fixed budgets.
- Modify the assumed `src/hooks/usePlaybackController.ts` visibility cleanup to release all artwork bitmaps when the application hides.

### VOD navigation and presentation

- Create `src/hooks/useVodNavigation.ts` for Movies and Series position memory, focus zones, category and query settle timers, wheel guarding, Back depth, search origin, details origin, season preview, and episode panel state.
- Modify the subsystem 1 `src/services/surfaceStack.ts` contract so `AppMode = "live" | "movie" | "series"` keeps Live on picture or `"panel"` and selects the `"vod"` primary surface for Movies or Series without changing drawer, modal or popup precedence.
- Modify `src/hooks/useWindowed.ts:43-125` to add complete poster row window arithmetic while preserving list row behavior.
- Create `src/screens/VodScreen.tsx` for the full screen opaque Movies and Series surface and its regional loading, empty, failed, and retry states.
- Create `src/components/vod/VodCategoryRail.tsx` for Continue watching, Favourites, All, and provider category rows.
- Create `src/components/vod/PosterGrid.tsx` for the six column complete row window and poster cards.
- Create `src/components/vod/VodSearch.tsx` for mode scoped search and Samsung keyboard ownership.
- Create `src/components/vod/VodTitleRow.tsx` for Back, one line provider title, and the compact Favourite toggle.
- Create `src/components/vod/VodDetails.tsx` for Movie details and the shared hero, backdrop, metadata, synopsis, and information drawer.
- Create `src/components/vod/SeriesDetails.tsx` for the stable Series hero, Continue actions, and inline episode panel.
- Create `src/components/vod/EpisodeList.tsx` for the windowed episode list, season preview, episode metadata region, Retry, and empty state.
- Modify `src/components/Text.tsx:12-65` to support active one line teleprompters outside the old list row selector.
- Modify `src/components/SearchField.tsx:18-115` to expose explicit keyboard dismissal while retaining the existing field and result movement contract.
- Modify `src/components/Icon.tsx:1-224` to add the episode placeholder glyph while the existing star supplies outline and filled favourite states through CSS.
- Modify the subsystem 1 `src/components/PanelHeader.tsx` implementation to expose Movies and Series mode activation to `VodScreen` without creating a second header model.
- Modify `src/App.tsx:208-338,455-689,691-917,1484-1949,1951-2583,2820-3109` to delegate VOD state, stop and restore playback, retain Live, and remove the current list based VOD implementation.
- Delete `src/components/MediaList.tsx` after `PosterGrid`, `VodSearch`, and `EpisodeList` own every former caller.
- Delete `src/components/MediaDetails.tsx` after `VodDetails` and `SeriesDetails` own every former caller.
- Delete `src/hooks/useBrowseStack.ts` after `useVodNavigation` owns every former caller.
- Delete `src/components/ContentSelector.tsx` after the subsystem 1 shared header owns Live, Movies, and Series controls and repository search shows no caller.

### Styles and translations

- Modify `src/styles/tokens.css:31-234` to publish VOD geometry and ensure reduced motion disables every new animation.
- Modify `src/styles/app.css:240-889,1043-1131,1173-1269,3930-4429` to replace old media list styles with the opaque shell, poster grid, details, episode panel, right to left placement, and flex gap fallbacks.
- Modify `src/services/locale.ts:43-57,472-488,906-1055` for all English and Persian VOD messages and typed message keys.
- Modify `src/locales/ar.ts` for Arabic VOD messages.
- Modify `src/locales/bn.ts` for Bengali VOD messages.
- Modify `src/locales/de.ts` for German VOD messages.
- Modify `src/locales/es.ts` for Spanish VOD messages.
- Modify `src/locales/fr.ts` for French VOD messages.
- Modify `src/locales/hi.ts` for Hindi VOD messages.
- Modify `src/locales/id.ts` for Indonesian VOD messages.
- Modify `src/locales/it.ts` for Italian VOD messages.
- Modify `src/locales/ja.ts` for Japanese VOD messages.
- Modify `src/locales/ko.ts` for Korean VOD messages.
- Modify `src/locales/nl.ts` for Dutch VOD messages.
- Modify `src/locales/pt.ts` for Portuguese VOD messages.
- Modify `src/locales/ru.ts` for Russian VOD messages.
- Modify `src/locales/tr.ts` for Turkish VOD messages.
- Modify `src/locales/zh-CN.ts` for Chinese VOD messages.

### Tests, fixtures, harness, and documentation

- Modify `tests/xtream.test.ts:204-510` for provider normalization, request timeout, response bounds, season union, episode identity, and generated address coverage.
- Modify `tests/library.test.ts:85-475` for synthetic categories, explicit complete indexes, stale refresh, cancellation, authoritative resolution, and local failures.
- Modify `tests/personal.test.ts:156-440` for rich progress, migration, Continue watching, restart sessions, resolution, completion, and cleanup.
- Modify `tests/disk.test.ts:16-110` for cache class isolation and per class refusal and eviction.
- Create `tests/artwork.test.ts` for artwork queue, byte, timeout, memory, derivative, tone, and backdrop behavior.
- Modify `tests/logos.test.ts:1-142` only for the channel adapter behavior retained after extraction.
- Modify `tests/windowed.test.ts:1-144` for complete six column poster row windows.
- Create `tests/vodNavigation.test.ts` for the pure VOD transition matrix and wheel guard.
- Replace the obsolete expectations in `tests/library-ui.test.tsx:119-448` with full shell, poster, search, details, Series, episode, and pointer behavior.
- Modify `tests/keyLaws.test.tsx:18-305` for VOD root, search, Movie details, Series details, and episode panel Back and direction contracts.
- Modify `tests/rtl-controls.test.tsx:1-38` for mirrored VOD zones and inline movement.
- Modify `tests/locale.test.ts` for complete VOD translations.
- Modify `tests/support/app.tsx` for subsystem 1 shell and subsystem 2 playback controller fixtures used by VOD integration tests.
- Modify `tests/harness.test.ts:80-313` for expanded provider stress fixtures and required television journeys.
- Modify `scripts/present.mjs:67-281` for deterministic VOD posters, backdrops, malformed provider cases, empty and failed regions, complete indexes, and episode metadata.
- Modify `scripts/tv/harness.mjs:20-59,152-172,260-282,292-556` for full screen VOD parity journeys and structural captures.
- Modify `scripts/tv/engine-parity.mjs:45-74` to include VOD shell, grid, details, title row, season row, and episode panel structural selectors.
- Modify `scripts/tv/sim.mjs:1557-1715` for cold and warm poster grid, held direction, category restore, search return, details, season, episode, favourite, wheel, and heap journeys.
- Modify `AGENTS.md:58-116,123-152` to describe the final VOD files, cache partitions, artwork queue, windowing, and mode specific key invariants.
- Modify `docs/design.md:10-56,126-190,223-253` to replace the old panel VOD design with the approved full screen shell, navigation, progress, search, details, and cache design.
- Modify `docs/testing.md:16-45,100-171,237-245` to document the VOD test ownership, simulator journeys, and real television acceptance checks.

---

### Task 1: Resilient Xtream VOD Normalization

**Files:**
- Modify: `src/services/xtream.ts:5-82,94-182,269-540`
- Modify: `src/stores/library.ts:199-206`
- Modify: `tests/xtream.test.ts:204-510`
- Modify: `tests/library.test.ts:421-475`

**Interfaces:**
- Consumes: `XtreamSession`, `XtreamSource`, native Fetch, URL, AbortController, ReadableStream, and TextDecoder.
- Produces: `VodMetadata`, `EpisodeMetadata`, `XtreamMovie`, `XtreamSeries`, `XtreamEpisode`, `XtreamMovieDetail`, `XtreamSeriesDetail`, and `XtreamSeasonKey` with the exact signatures below.
- Produces: `loadXtreamMovies`, `loadXtreamSeries`, `loadXtreamMovieDetail`, and `loadXtreamSeriesDetail` through one bounded JSON request path.
- Produces: `buildXtreamMovieUrl` and `buildXtreamEpisodeUrl` with optional normalized extensions and no final dot when an extension does not survive. `libraryPlaybackUrl` returns a valid `direct_source` before calling either builder.

```ts
export type XtreamSeasonKey = number | "unassigned";

export type VodMetadata = {
  backdrops: string[];
  rating: string;
  cast: string[];
  director: string;
  genre: string;
  releaseDate: string;
  country: string;
  ageRating: string;
  episodeRuntimeSeconds?: number;
};

export type EpisodeMetadata = {
  rating: string;
  plot: string;
  releaseDate: string;
  image: string;
  durationSeconds?: number;
};

export interface XtreamMovie {
  key: string;
  streamId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension?: string;
  year: string;
  rating: string;
  directSource: string;
}

export interface XtreamSeries {
  key: string;
  seriesId: string;
  categoryKey: string;
  name: string;
  logo: string;
  year: string;
  rating: string;
}

export interface XtreamEpisode {
  key: string;
  episodeIdentity: string;
  episodeId?: string;
  directSource: string;
  directSourceFingerprint?: string;
  seriesKey: string;
  seasonKey: XtreamSeasonKey;
  season?: number;
  number?: number;
  name: string;
  extension?: string;
  durationSeconds?: number;
  providerOrder: number;
  metadata: EpisodeMetadata;
}

export interface XtreamMovieDetail extends XtreamMovie {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  durationSeconds?: number;
  metadata: VodMetadata;
}

export interface XtreamSeriesDetail extends XtreamSeries {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  metadata: VodMetadata;
  seasons: XtreamSeasonKey[];
  episodes: XtreamEpisode[];
}
```

- [ ] **Step 1: Write the provider normalization tests without running them**

Add named tests for preferred `rating`, fallback `rating_5based`, invalid and out of range ratings, one decimal output, all accepted `backdrop_path` shapes, the three backdrop cap, credential bearing and invalid scheme rejection, Movie poster precedence, Series poster precedence, episode artwork, cast and director string and array shapes, ten person cast bounds, 120 code point cast bounds, 2,000 code point plot bounds, safe whitespace trimming, and omission when no safe boundary exists.

Add named tests for valid base64 UTF-8 round trips on names, plots, cast, and genre, malformed padding, invalid UTF-8, replacement characters, ordinary text that resembles base64, emoji, joined glyphs, combining marks, `dir="auto"` ready unmodified output, release date field precedence, accepted date separators, 1888 lower year bound, current year plus three upper bound, duration field precedence, `H:MM:SS`, `MM:SS`, digits only seconds, and episode run time minutes.

Add named tests for provider category order, duplicate identifier first item retention, duplicate name retention, season records united with numeric episode keys, Specials season zero, numeric season sort, episode identity fallback order, season scoped deduplication, known episode number sort, provider order for missing or equal episode numbers, missing number preservation, direct source fingerprinting, and readable idless episodes with no generated Play address.

- [ ] **Step 2: Implement the normalization types and pure helpers**

Add these exact exported signatures and keep their bodies pure so every provider shape is tested without a store:

```ts
export function normalizeXtreamRating(rating: unknown, rating5Based?: unknown): string;
export function normalizeBackdrops(value: unknown, base: string): string[];
export function normalizeExtension(value: unknown): string | undefined;
export function normalizeProviderText(value: unknown, maxCodePoints?: number): string;
export function normalizeReleaseDate(values: unknown[], currentYear?: number): string;
export function normalizeDurationSeconds(value: Record<string, unknown>): number | undefined;
export function directSourceFingerprint(value: string): string | undefined;
```

Use Unicode code point counting for storage limits, but only cut at an existing preceding whitespace boundary. Keep provider text unchanged after trim and validated base64 decoding. Retain `formatXtreamRating(value)` as a compatibility wrapper over `normalizeXtreamRating(value)` until Task 8 removes the old list based callers.

- [ ] **Step 3: Write bounded request and address tests without running them**

Add fake timer and streamed body tests that assert a 30 second timeout aborts the owned request, caller abort cancels before timeout, `Content-Length` over the limit rejects before reading, a streamed body without `Content-Length` stops as soon as the byte limit is crossed, a response at the exact limit succeeds, malformed JSON remains distinct, and no error contains the server address, username, password, direct source, or generated media address.

Assert category lists use 1 MiB, category contents use 8 MiB, details use 4 MiB, and complete indexes use 12 MiB. Assert only the complete index limit maps to the translated Catalogue too large, browse categories instead state at the library boundary.

Assert a valid direct source wins, extensions normalize to one through eight lowercase ASCII letters or digits, invalid or absent extensions produce `/movie/user/pass/id` and `/series/user/pass/id` without a final dot, and credentials remain correctly encoded only in the media path.

- [ ] **Step 4: Implement bounded Xtream request ownership and media addresses**

Add one internal request function with this signature and route every Player API call through it:

```ts
interface XtreamRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes: number;
}

async function requestXtreamJson(url: string, options: XtreamRequestOptions): Promise<unknown>;
```

Remove the unbounded `response.json()` path. Read bytes incrementally, detach caller abort listeners in every completion path, and map timeout, abort, HTTP, malformed JSON, and response size into safe typed errors. Update `libraryPlaybackUrl` to use a valid direct source before a generated address and to reject an idless episode that has neither playable form.

- [ ] **Step 5: Inspect the Task 1 diff manually**

Confirm the implementation has one provider normalization path, no external metadata request, no invented `mp4`, no raw provider address in an error, no JavaScript display truncation, and no unsupported Chromium 69 method. Do not run tests, lint, type checks, builds, or television gates.

- [ ] **Step 6: Commit the provider boundary**

```bash
git add src/services/xtream.ts src/stores/library.ts tests/xtream.test.ts tests/library.test.ts
git commit -m "feat(vod): harden Xtream catalogue normalisation"
```

### Task 2: Catalogue Cache, Progress, and Synthetic Categories

**Files:**
- Modify: `src/stores/library.ts:30-75,77-225,266-620,710-752`
- Modify: `src/stores/personal.ts:6-58,60-177,211-334`
- Modify: `src/services/search.ts:28-103`
- Modify: `tests/library.test.ts:85-475`
- Modify: `tests/personal.test.ts:156-440`
- Modify: `tests/search.test.ts:1-103`

**Interfaces:**
- Consumes: normalized Task 1 summaries and details, `services/disk`, `services/store`, `services/idle`, typed playlists, favourite snapshots, and the subsystem 2 `PlaybackProgressSeed`, `ResolvedPlaybackProgress`, `PlaybackProgress`, `progressFor`, `resolveLegacyProgress`, and `removeAbsentLegacyProgress` contracts.
- Produces: `SeriesContinueTarget`, `VodCategoryRow`, `LibraryResource<T>`, `searchVodItems`, VOD progress selectors, and the store operations below.
- Produces: stale cache data immediately, one idle refresh for each stale key, local regional failures, and request generation guards.
- Produces: Continue watching, Favourites, All, then provider categories in provider order. Empty personal categories are omitted.

```ts
export interface SeriesContinueTarget {
  episode: XtreamEpisode;
  resumeAt: number;
  remainingSeconds?: number;
  reason: "resume" | "next" | "first" | "restart-series";
}

export type LibraryResource<T> = {
  state: "idle" | "loading" | "loaded" | "empty" | "failed";
  value: T;
  stale: boolean;
  error?: "authentication" | "permission" | "malformed" | "too-large" | "network";
};

export type VodCategoryRow = {
  key: string;
  source: "continue" | "favourites" | "all" | "provider";
  name: string;
  count: number;
};
```

- Produces these exact store operations while retaining the subsystem 2 progress methods unchanged:

```ts
selectPlaylist(playlist: Playlist | undefined): void;
loadCategories(kind: LibraryKind): Promise<void>;
loadCategory(kind: LibraryKind, categoryKey: string): Promise<void>;
loadIndex(kind: LibraryKind, reason: "all" | "search"): Promise<void>;
loadMovie(movieKey: string): Promise<void>;
loadSeries(seriesKey: string): Promise<void>;
retry(resourceKey: string): Promise<void>;
categoriesFor(kind: LibraryKind): VodCategoryRow[];
itemsFor(kind: LibraryKind, categoryKey: string): LibraryResource<LibraryItem[]>;
progressSeedFor(item: XtreamMovie | XtreamEpisode, parent?: XtreamSeries): PlaybackProgressSeed | null;
continueWatchingFor(playlistId: string, kind: LibraryKind): ResolvedPlaybackProgress[];
seriesContinueFor(detail: XtreamSeriesDetail, lastPlayed: LastPlayed | null): SeriesContinueTarget | null;
clear(): void;
```

- [ ] **Step 1: Write VOD progress selector and normalized seed tests without running them**

Assert Continue watching orders resolved activity by `updatedAt`, excludes unresolved and catchup records, removes completed records, renders a movie directly, and presents one parent Series for the latest resumable episode.

Assert `progressSeedFor` carries Task 1 provider id, episode identity, category, extension, name, parent fields, season, episode, and direct source fingerprint into the subsystem 2 seed shape. Assert an idless episode without provider id or valid direct source returns null and no raw address enters a seed.

Assert the complete movie index still calls the subsystem 2 `resolveLegacyProgress` and `removeAbsentLegacyProgress` boundaries. Assert a loaded Series detail resolves matching episode seeds without deleting unmatched records from another Series.

Assert `seriesContinueFor` resumes the latest progress, advances from a completed last watched episode to the next provider episode, uses the first playable provider episode when no history exists or the final episode completed, and ignores unreadable episodes with no provider id or valid direct source.

- [ ] **Step 2: Implement VOD progress selectors over subsystem 2 records**

Do not redefine, migrate, persist, or widen the approved progress union. Add pure selectors and normalized seed builders, then route authoritative Task 1 loads through the existing subsystem 2 resolution functions.

For an episode record, keep the parent Series poster and identity in the seed so Continue watching can render one parent card before a provider category loads. Store only the opaque direct source fingerprint, never the raw address.

- [ ] **Step 3: Write catalogue cache and synthetic category tests without running them**

Assert category lists, provider categories, empty categories, full indexes, Movie details, and Series details share a six hour policy. Assert fresh cache prevents network work, stale cache renders before refresh, stale empty cache refreshes once during idle time, a failed stale refresh keeps the shown cache, and an unchanged repeated read schedules no duplicate refresh. Assert authentication, permission, malformed response, oversize response, and ordinary network faults remain distinct resource errors with safe viewer copy.

Assert `selectPlaylist`, mode change, category change, query closure, and newer detail selection abort work they own. Resolve old promises after each change and assert they cannot replace newer state, clear a newer loading state, write a stale error, or write stale cache bytes.

Assert `loadIndex` is never called by ordinary category browsing. Assert explicit All and Search use the full endpoint without `category_id`, enforce the 12 MiB limit, map the limit to Catalogue too large, browse categories instead, and leave provider category browsing available.

Assert category order is Continue watching when nonempty, Favourites when nonempty, All, then provider order. Assert provider counts appear before load, normalized fetched counts replace them after load, duplicate names remain separate by key, and empty personal categories disappear immediately after their last item leaves.

- [ ] **Step 4: Generalize ranked search without changing Live results**

Add this signature and keep `searchChannels` as a typed wrapper over the same two rank loop:

```ts
export interface SearchResults<T> {
  matches: T[];
  total: number;
}

export function searchVodItems<T extends { name: string }>(items: readonly T[], query: string): SearchResults<T>;
```

Cache folded names by the items array identity, rank prefixes before contained matches, cap retained results at 300, report the complete total, and return no matches for an empty query.

- [ ] **Step 5: Implement the library resource and cache policy**

Keep the current versioned key prefix `xtream:<playlistId>:v<sourceVersion>`. Add explicit keys for category lists, provider categories, complete indexes, Movie details, and Series details. Keep every disk read and write outside direct input handlers, and schedule stale revalidation through `whenIdle` once per key.

Resolve legacy progress after authoritative index or detail adoption. Do not make VOD cache failure clear Live, the sibling VOD mode, another category, or a shown stale value.

- [ ] **Step 6: Inspect the Task 2 diff manually**

Trace one movie, one provider id episode, one direct source episode, one unresolved legacy record, one stale empty category, one oversized full index, and one aborted old detail request from service result through store state and persistence. Do not run automated checks.

- [ ] **Step 7: Commit catalogue and personal state**

```bash
git add src/stores/library.ts src/stores/personal.ts src/services/search.ts tests/library.test.ts tests/personal.test.ts tests/search.test.ts
git commit -m "feat(vod): add bounded catalogue and progress state"
```

### Task 3: Artwork Pipeline and Cache Partitions

**Files:**
- Create: `src/services/artwork.ts`
- Create: `src/components/Artwork.tsx`
- Modify: `src/services/logos.ts:20-536`
- Modify: `src/components/Logo.tsx:1-110`
- Modify: `src/components/Icon.tsx:1-224`
- Modify: `src/components/ChannelList.tsx:1-240`
- Modify: `src/services/metrics.ts:1-23`
- Modify: `src/services/disk.ts:33-115,222-388`
- Modify: `src/stores/channels.ts:238,330-332,499-553`
- Modify: `src/stores/library.ts:141-149,306-330,369-416,432-480,502-618`
- Modify: `src/components/settings/Diagnostics.tsx:90-125`
- Modify: assumed `src/hooks/usePlaybackController.ts` visibility cleanup
- Create: `tests/artwork.test.ts`
- Modify: `tests/logos.test.ts:1-142`
- Modify: `tests/disk.test.ts:16-110`

**Interfaces:**
- Consumes: `services/disk`, `services/idle`, native Fetch, AbortController, ImageBitmap, canvas, and the existing `LOGO_BOX` metric.
- Produces: `CacheClass`, class budgets, class aware entries, class aware writes, generic artwork requests, poster and logo memory entries, active backdrop leases, and channel logo adapters.

```ts
export type CacheClass = "catalogue" | "poster" | "logo";

export const CACHE_BUDGET_BYTES: Readonly<Record<CacheClass, number>> = {
  catalogue: 12 * 1024 * 1024,
  poster: 8 * 1024 * 1024,
  logo: 4 * 1024 * 1024,
};

export interface Entry {
  key: string;
  class: CacheClass;
  bytes: number;
  at: number;
}

export function evictionPlan(entries: Entry[], incoming: Omit<Entry, "at">): { evict: string[]; refused: boolean };
export function write(key: string, value: Blob | string, cacheClass: CacheClass): Promise<boolean>;
export function usageByClass(): Promise<Record<CacheClass, { bytes: number; count: number }>>;
```

```ts
export type ArtworkKind = "logo" | "poster";

export interface ArtworkRequest {
  url: string;
  kind: ArtworkKind;
  width: number;
  height: number;
  eager?: boolean;
  signal?: AbortSignal;
}

export interface ArtworkEntry {
  bitmap: ImageBitmap;
  bytes: number;
  tone: string;
}

export interface BackdropLease {
  bitmap: ImageBitmap;
  tone: string;
  release: () => void;
}

export interface WarmOptions {
  delay?: number;
  timeout?: number;
}

export const POSTER_BOX = { width: 192, height: 288 } as const;
export function artworkOf(request: Omit<ArtworkRequest, "eager" | "signal">): ArtworkEntry | null;
export function claimArtwork(request: Omit<ArtworkRequest, "eager" | "signal">): void;
export function releaseArtwork(request: Omit<ArtworkRequest, "eager" | "signal">): void;
export function loadArtwork(request: ArtworkRequest): Promise<ArtworkEntry | null>;
export function dropQueuedArtwork(kind?: ArtworkKind): void;
export function warmArtworkChain(requests: ArtworkRequest[], options?: WarmOptions): () => void;
export function loadBackdrop(url: string, signal?: AbortSignal): Promise<BackdropLease | null>;
export function releaseAllArtwork(): void;

export interface ArtworkProps {
  src?: string;
  alt: string;
  kind: ArtworkKind;
  width: number;
  height: number;
  placeholderIcon: "tv" | "movie" | "series" | "episode";
  className?: string;
  fetchable?: boolean;
}
```

- [ ] **Step 1: Write cache partition tests without running them**

Assert each class accepts values within its own allowance, refuses one item larger than its class, evicts only least recently used entries from the same class, replaces its own key without double counting, and never evicts catalogue entries to admit poster or logo data. Assert total budgets sum to 24 MiB and legacy metadata without a class is inferred by `poster:`, `logo:`, and catalogue key prefixes.

Assert cache clearing removes all three classes, playlist removal removes matching catalogue entries without clearing shared artwork, and diagnostics reports total plus each class without reading payloads.

- [ ] **Step 2: Implement class aware disk accounting**

Add class to metadata records without changing the IndexedDB store shape. Infer a class when loading legacy metadata, write the inferred value back only during later idle metadata work, and keep all existing no database and failed transaction behavior.

Update every `disk.write` caller to pass `catalogue`, `poster`, or `logo` explicitly. Encode poster derivatives as JPEG and channel logo derivatives as PNG.

- [ ] **Step 3: Write artwork request, queue, memory, and lifetime tests without running them**

Assert two decodes run at once across logos and posters, urgent visible work precedes warming work, queued work settles when cancelled, leaving a category prevents its poster requests from starting, and an aborted active fetch returns the placeholder result without entering the failed address set.

Assert artwork times out after 15 seconds, rejects `Content-Length` over 8 MiB, enforces 8 MiB while streaming without a length, closes partial bitmaps on decode replacement, uses a stable placeholder after timeout, and never performs a second network request for fallback colour.

Assert poster memory evicts and closes the oldest unclaimed bitmap at 48 entries or 12 MiB, whichever arrives first. Assert claimed visible entries survive until release, logo limits remain independent, `releaseAllArtwork` closes every bitmap, and background hiding calls it through the subsystem 2 controller.

Assert poster derivatives are 192 by 288 at default scale, backdrop decode is at most 1280 by 720, a backdrop never writes to disk or enters memory maps, changing details aborts and releases it, and the poster tone is reused for a failed backdrop fallback.

- [ ] **Step 4: Extract the shared artwork pipeline and keep the logo API stable**

Move queue lanes, claims, cancellation, bounded network reads, decode sizing, bitmap closure, idle write scheduling, and tone extraction into `services/artwork.ts`. Keep `services/logos.ts` as a small adapter that exports the existing `LOGO_BOX`, `logoOf`, `claimLogo`, `releaseLogo`, `shrink`, `dropQueuedWarming`, `releaseLogos`, `warmLogo`, and `warmChain` signatures.

Make `Artwork.tsx` render the cached bitmap to canvas and accept `placeholderIcon: "tv" | "movie" | "series" | "episode"`. Add the episode glyph to `Icon.tsx`, then keep `Logo.tsx` as the channel wrapper so existing Live call sites do not learn VOD artwork types.

- [ ] **Step 5: Inspect the Task 3 diff manually**

Trace one channel logo, one poster, one cancelled off screen poster, one stale disk derivative, one oversized image, one failed backdrop, and one application hide. Confirm each bitmap has one owner and one close path. Do not run automated checks.

- [ ] **Step 6: Commit the artwork and disk boundaries**

```bash
git add src/services/artwork.ts src/components/Artwork.tsx src/services/logos.ts src/components/Logo.tsx src/components/Icon.tsx src/components/ChannelList.tsx src/services/metrics.ts src/services/disk.ts src/stores/channels.ts src/stores/library.ts src/components/settings/Diagnostics.tsx src/hooks/usePlaybackController.ts tests/artwork.test.ts tests/logos.test.ts tests/disk.test.ts
git commit -m "feat(vod): bound poster and catalogue caches"
```

### Task 4: VOD Navigation and Poster Row Windowing

**Files:**
- Create: `src/hooks/useVodNavigation.ts`
- Modify: subsystem 1 `src/services/surfaceStack.ts`
- Modify: `src/hooks/useWindowed.ts:43-125`
- Modify: `tests/windowed.test.ts:1-144`
- Create: `tests/vodNavigation.test.ts`

**Interfaces:**
- Consumes: subsystem 1 surface types, `KEY`, locale direction, Task 2 category and item keys, and direct item counts.
- Produces: `AppMode`, `VodZone`, `VodOrigin`, `VodModeMemory`, `VodNavigationState`, `VodNavigationContext`, `VodAction`, `reduceVodNavigation`, `useVodNavigation`, and complete poster row window arithmetic.

```ts
export type AppMode = "live" | "movie" | "series";

export type VodZone =
  | "header"
  | "rail"
  | "grid"
  | "search-field"
  | "search-grid"
  | "detail-title"
  | "detail-actions"
  | "season-row"
  | "episode-list"
  | "retry";

export type VodOrigin = {
  mode: "movie" | "series";
  surface: "category" | "search";
  categoryKey: string;
  itemKey: string;
  itemIndex: number;
  firstRow: number;
  query?: string;
};

export interface VodModeMemory {
  categoryKey: string;
  railIndex: number;
  itemKey: string;
  itemIndex: number;
  firstRow: number;
  itemByCategory: Record<string, string>;
  indexByCategory: Record<string, number>;
  firstRowByCategory: Record<string, number>;
  seasonBySeries: Record<string, XtreamSeasonKey>;
  episodeBySeason: Record<string, string>;
}

export interface VodNavigationState {
  mode: "movie" | "series";
  zone: VodZone;
  selectedCategoryKey: string;
  displayedCategoryKey: string;
  selectedItemKey: string;
  selectedItemIndex: number;
  search: null | { query: string; applied: string; keyboardOpen: boolean; origin: VodOrigin };
  details: null | { itemKey: string; origin: VodOrigin; titleControl: "back" | "favourite"; actionIndex: number };
  episodes: null | { open: boolean; seasonCursor: XtreamSeasonKey; selectedSeason: XtreamSeasonKey; episodeKey: string; heroActionIndex: number };
  memories: Record<"movie" | "series", VodModeMemory>;
}

export interface VodNavigationContext {
  direction: Direction;
  categoryKeys: readonly string[];
  itemKeys: readonly string[];
  searchItemKeys: readonly string[];
  seasons: readonly XtreamSeasonKey[];
  episodeKeys: readonly string[];
  detailActionCount: number;
  regionState: "loaded" | "empty" | "failed";
}

export type VodAction =
  | { type: "key"; code: number }
  | { type: "mode"; mode: "movie" | "series" }
  | { type: "category-focus"; index: number }
  | { type: "category-display"; categoryKey: string }
  | { type: "item-focus"; index: number }
  | { type: "search-open" }
  | { type: "search-close" }
  | { type: "query"; value: string }
  | { type: "query-apply"; value: string }
  | { type: "keyboard"; open: boolean }
  | { type: "details-open"; itemKey: string; origin: VodOrigin }
  | { type: "details-close" }
  | { type: "episodes-toggle" }
  | { type: "season-preview"; season: XtreamSeasonKey }
  | { type: "season-commit"; season: XtreamSeasonKey }
  | { type: "restore"; origin: VodOrigin };

export interface VodNavigationOptions extends VodNavigationContext {
  mode: "movie" | "series";
  onCategorySettled: (categoryKey: string) => void;
  onQuerySettled: (query: string) => void;
  onPosterSettled: () => void;
  onActivate: (state: VodNavigationState) => void;
  onRetry: (state: VodNavigationState) => void;
  onReturnLive: () => void;
}

export interface VodNavigation {
  state: VodNavigationState;
  posterFetchReady: boolean;
  handleKey: (code: number, event: KeyboardEvent) => void;
  handleWheel: (deltaY: number, now?: number) => boolean;
  selectCategory: (index: number) => void;
  selectItem: (index: number) => void;
  setQuery: (value: string) => void;
  openSearch: () => void;
  openDetails: (itemKey: string) => void;
  closeDetails: () => void;
  toggleEpisodes: () => void;
  commitSeason: (season: XtreamSeasonKey) => void;
  restoreOrigin: (origin: VodOrigin) => void;
}

export function reduceVodNavigation(state: VodNavigationState, action: VodAction, context: VodNavigationContext): VodNavigationState;
export function useVodNavigation(options: VodNavigationOptions): VodNavigation;
```

```ts
export const POSTER_COLUMNS = 6;
export const POSTER_OVERSCAN_ROWS = 1;
export const POSTER_CARD_ROW_BASE = 376;

export interface PosterWindow extends Window {
  itemStart: number;
  itemEnd: number;
}

export function posterWindowOf(count: number, cursor: number, viewportHeight: number, scale: number, previousFirst?: number): PosterWindow;
export function wheelStep(cursor: number, count: number, deltaY: number, now: number, lastAcceptedAt: number): { cursor: number; lastAcceptedAt: number; accepted: boolean };
```

- [ ] **Step 1: Write complete poster row window tests without running them**

Assert zero through five items render one complete row, six items render one row, seven items render two rows, each window starts and ends on a six item boundary except the final partial row, one bounded overscan row appears above and below, the focused item always exists, a shrinking result set clamps to the nearest valid item, and larger text changes row height without changing six columns.

- [ ] **Step 2: Implement `posterWindowOf` over the existing row arithmetic**

Convert the item count and cursor to row count and row cursor, call the existing pure `windowOf`, then convert row bounds back to item bounds. Do not read DOM geometry inside this function or any direction action.

- [ ] **Step 3: Write the VOD transition matrix without running it**

Generate table cases for every direction, OK, and Back from header, rail, grid, search field, search grid, Movie title, Movie actions, Series title, Series actions, season row, episode list, and regional Retry.

Assert focus stops at list boundaries and never loops. Assert physical inline directions mirror in right to left layouts while previous, next, Back, and forward semantics remain unchanged.

Assert category Up and Down update `selectedCategoryKey` on the action, while `displayedCategoryKey` changes only after the 150 millisecond settle callback. Assert entering the rail from the first poster uses inline start, inline end and OK return to the remembered grid item, empty categories retain rail focus, and failed categories expose only Retry in the content region.

Assert grid Left and Right move by one, Up and Down move by six, the final item of one row reaches the first item of the next through linear wheel movement, Up from the first row reaches the header, and Down from the header returns to the selected category.

Assert wheel input at 0 milliseconds accepts, 119 milliseconds rejects, 120 milliseconds accepts, and every accepted gesture changes the cursor by one item regardless of row position. Assert pointer movement changes nothing and pointer click updates the same cursor and zone used by remote input.

Assert Movies and Series restore independent category, item, row, details, season, and episode positions. Assert removal of a remembered item chooses the nearest valid index and removal of a remembered category chooses the nearest valid rail row.

Assert search saves its category and poster origin, Back first dismisses an open Samsung keyboard, later Back closes search, details Back returns to the exact search result, and search Back returns to the exact category item.

- [ ] **Step 4: Implement the pure reducer and timed hook**

Keep all cursor arithmetic in `reduceVodNavigation`. Let `useVodNavigation` own only the 150 millisecond category timer, 150 millisecond query timer, 120 millisecond poster fetch timer, 120 millisecond wheel guard, state refs needed between rapid key events, and cleanup.

Expose these exact operations:

```ts
handleKey(code: number, event: KeyboardEvent): void;
handleWheel(deltaY: number, now?: number): boolean;
selectCategory(index: number): void;
selectItem(index: number): void;
setQuery(value: string): void;
openSearch(): void;
openDetails(itemKey: string): void;
closeDetails(): void;
toggleEpisodes(): void;
commitSeason(season: XtreamSeasonKey): void;
restoreOrigin(origin: VodOrigin): void;
```

- [ ] **Step 5: Inspect the Task 4 diff manually**

Walk every transition table row against the spec, then inspect for wrap arithmetic, layout reads, stale captured cursors, and timers without cleanup. Do not run automated checks.

- [ ] **Step 6: Commit the navigation model**

```bash
git add src/hooks/useVodNavigation.ts src/services/surfaceStack.ts src/hooks/useWindowed.ts tests/windowed.test.ts tests/vodNavigation.test.ts
git commit -m "feat(vod): define poster navigation state"
```

### Task 5: Full Screen VOD Shell, Poster Grid, and Scoped Search

**Files:**
- Create: `src/screens/VodScreen.tsx`
- Create: `src/components/vod/VodCategoryRail.tsx`
- Create: `src/components/vod/PosterGrid.tsx`
- Create: `src/components/vod/VodSearch.tsx`
- Modify: `src/components/Text.tsx:12-65`
- Modify: `src/components/SearchField.tsx:18-115`
- Modify: subsystem 1 `src/components/PanelHeader.tsx`
- Modify: `src/styles/tokens.css:31-234`
- Modify: `src/styles/app.css:240-889,1043-1131,1173-1269,3930-4429`
- Modify: `src/services/locale.ts:43-57,472-488,906-1055`
- Modify: `src/locales/ar.ts`
- Modify: `src/locales/bn.ts`
- Modify: `src/locales/de.ts`
- Modify: `src/locales/es.ts`
- Modify: `src/locales/fr.ts`
- Modify: `src/locales/hi.ts`
- Modify: `src/locales/id.ts`
- Modify: `src/locales/it.ts`
- Modify: `src/locales/ja.ts`
- Modify: `src/locales/ko.ts`
- Modify: `src/locales/nl.ts`
- Modify: `src/locales/pt.ts`
- Modify: `src/locales/ru.ts`
- Modify: `src/locales/tr.ts`
- Modify: `src/locales/zh-CN.ts`
- Modify: `tests/library-ui.test.tsx:119-301`
- Modify: `tests/locale.test.ts`
- Modify: `tests/rtl-controls.test.tsx:1-38`

**Interfaces:**
- Consumes: Tasks 2 through 4 stores, artwork, row window, navigation, search, the subsystem 1 shared header, locale services, and pointer events.
- Produces: `VodScreenHandle`, `VodScreenProps`, `VodCategoryRail`, `PosterGrid`, `PosterCard`, and `VodSearch`.

```ts
export interface VodScreenHandle {
  handleKey: SurfaceKeyHandler;
  restoreOrigin: (origin: VodOrigin) => void;
}

export interface VodPlaybackRequest {
  kind: "movie" | "episode";
  itemKey: string;
  name: string;
  categoryName: string;
  poster: string;
  directSource: string;
  extension?: string;
  providerId?: string;
  resumeAt: number;
  restart: boolean;
  progress: PlaybackProgressSeed;
  origin: VodOrigin;
  siblingKeys: string[];
}

export type HeaderControlId = AppMode | "search" | "guide" | "settings";

export interface PanelHeaderProps {
  sourceKind: "m3u" | "xtream";
  activeMode: AppMode;
  focusedControl: HeaderControlId;
  guideAvailable: boolean;
  onModeChange: (mode: AppMode) => void;
  onSearch: () => void;
  onGuide: () => void;
  onSettings: () => void;
}

export interface VodScreenProps {
  mode: "movie" | "series";
  playlist: Playlist;
  scale: number;
  onModeChange: (mode: AppMode) => void;
  onSettings: () => void;
  onReturnLive: () => void;
  onPlay: (request: VodPlaybackRequest) => void;
}

export interface PosterItem {
  key: string;
  kind: "movie" | "series";
  title: string;
  poster: string;
  metadata: string;
  rating: string;
  favourite: boolean;
  progressPercent?: number;
}

export interface VodCategoryRailProps {
  items: readonly VodCategoryRow[];
  cursor: number;
  selectedKey: string;
  focused: boolean;
  scale: number;
  onFocus: (index: number) => void;
  onActivate: (index: number) => void;
}

export interface PosterGridProps {
  items: readonly PosterItem[];
  resourceState: LibraryResource<LibraryItem[]>["state"];
  cursor: number;
  firstRow: number;
  focused: boolean;
  fetchReady: boolean;
  scale: number;
  onFocus: (index: number) => void;
  onActivate: (index: number) => void;
  onRetry: () => void;
  onWheel: (deltaY: number) => void;
}

export interface VodSearchProps {
  kind: "movie" | "series";
  query: string;
  fieldFocused: boolean;
  results: LibraryResource<LibraryItem[]>;
  total: number;
  grid: Omit<PosterGridProps, "items" | "resourceState">;
  onQuery: (value: string) => void;
  onDismissKeyboard: () => void;
}
```

- [ ] **Step 1: Write shell and category rail component tests without running them**

Assert Movies and Series render as an opaque full screen surface with the shared header, 424 pixel rail role, six column grid role, safe area classes, and no mounted Live panel or video surface behind them.

Assert Continue watching and Favourites appear only when nonempty, All always appears before provider categories, provider order remains unchanged, duplicate category names have independent keys, provider counts appear before load, normalized counts appear after load, and a two line category name keeps its fixed count pill.

Use fake timers to assert category focus changes on every Up or Down press, no category request or grid replacement occurs before 150 milliseconds, one request and one replacement occur where a held direction stops, and poster fetch remains disabled until another 120 milliseconds passes.

Assert an empty category keeps rail focus and shows one nonfocus empty message. Assert a failed category keeps the rail available, exposes Retry as the only content focus target, and Retry reloads only that category. Assert a regional load over 100 milliseconds shows poster skeleton geometry and one loading message, while a faster load never flashes the loading region.

- [ ] **Step 2: Write poster card, wheel, and accessibility tests without running them**

Assert at most the visible complete rows plus bounded overscan mount for a catalogue of 10,000 items. Assert cards expose `aria-posinset` and `aria-setsize`, an accessible name composed from title, metadata, rating, and favourite state, a white focused outline, a blue favourite badge, a thin blue progress line, and a stable Movie or Series placeholder.

Assert a valid provider rating renders one neutral pill and translated Rating 8.4 out of 10 semantics, while invalid ratings render no pill. Assert poster title and metadata remain at the caption floor.

Assert a focused long title receives a one line teleprompter after 1.2 seconds, unfocused titles do not move, right to left text moves toward its measured logical end, emoji and joined glyph text remains intact, and reduced motion leaves the first clipped portion stationary.

Assert each accepted wheel gesture moves one item across row boundaries, the 120 millisecond guard rejects repeats, windowing follows the same cursor, pointer hover does not move remote focus, and pointer click selects and opens the clicked card. Assert rail and grid scroll indicators appear on entry and movement, then disappear after the existing transient interval without taking focus.

- [ ] **Step 3: Write scoped search component tests without running them**

Assert opening Search in Movies requests only the complete Movie index and opening Search in Series requests only the complete Series index. Assert ordinary browsing never requests either complete index.

Assert input updates immediately, results remain from the previous applied query before 150 milliseconds, prefix matches precede contained matches, at most 300 cards render through the same windowed grid, and the heading names Movies or Series plus the complete result count.

Assert Down from the field enters the first result, Up from the first result returns to the field, Back first blurs and dismisses the Samsung keyboard, later Back restores the previous category and poster, and details Back restores the exact result and row window.

Assert no results names the query and leaves field focus. Assert loading has one regional message, oversize complete index shows Catalogue too large, browse categories instead, provider failure shows one Retry, and retry does not clear the typed query.

- [ ] **Step 4: Implement the shell regions and exact visual metrics**

Use `forwardRef` for `VodScreenHandle`. Keep category, grid, and search cursor state in `useVodNavigation`, not component local state. Use `useViewport` only in effects triggered by region geometry changes, then pass numeric height into `posterWindowOf`.

Publish these tokens from CSS or the existing metrics service so code and layout share the same values:

```css
--vod-rail-w: 424px;
--poster-w: 192px;
--poster-h: 288px;
--poster-columns: 6;
--poster-row-h: 376px;
```

Use CSS Grid because grid gap is available on Chromium 69. Add margin fallbacks for every new flex gap container and mirror inline placement under `html[dir="rtl"]`.

- [ ] **Step 5: Extend `Text` and `SearchField` only where the approved surfaces need it**

Add `active?: boolean` to `Text` so detail titles can start the existing measured teleprompter without pretending to be a selected list row. Keep all title strings in the DOM as complete text.

Add `onDismissKeyboard?: () => void` to `SearchField`. Blurring on the first Back leaves the navigation cursor on the field, while the later Back belongs to `VodScreen` and closes search.

- [ ] **Step 6: Add complete VOD translations**

Add translated labels for Continue watching, Favourites, All, Untitled, Uncategorised, loading, Retry, empty category, provider failure classes, Catalogue too large, no results with query, rating semantics, add and remove favourite, progress, Movie actions, Series actions, season and episode references, no episodes, More information, and image placeholders.

Keep episode references parameterized and locale formatted. Do not hardcode a Latin `E` in components.

- [ ] **Step 7: Inspect the Task 5 diff manually**

Inspect the component tree for unbounded cards, per tile spinners, duplicate focus, pointer hover state changes, JavaScript title slicing, untranslated labels, missing `dir="auto"`, missing accessible names, flex gap without fallback, and VOD content inside the old translucent Live panel. Do not run automated checks.

- [ ] **Step 8: Commit the VOD shell**

```bash
git add src/screens/VodScreen.tsx src/components/vod/VodCategoryRail.tsx src/components/vod/PosterGrid.tsx src/components/vod/VodSearch.tsx src/components/Text.tsx src/components/SearchField.tsx src/components/PanelHeader.tsx src/styles/tokens.css src/styles/app.css src/services/locale.ts src/locales tests/library-ui.test.tsx tests/locale.test.ts tests/rtl-controls.test.tsx
git commit -m "feat(vod): add full screen poster browsing"
```

### Task 6: Movie Details and Shared VOD Title Row

**Files:**
- Create: `src/components/vod/VodTitleRow.tsx`
- Create: `src/components/vod/VodDetails.tsx`
- Modify: `src/screens/VodScreen.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/library-ui.test.tsx:119-162,303-434`
- Modify: `tests/keyLaws.test.tsx:264-305`

**Interfaces:**
- Consumes: Task 1 Movie metadata, Task 2 progress and favourite operations, Task 3 poster and backdrop artwork, Task 4 details origin and title focus, and Task 5 shell.
- Produces: `VodTitleRow`, `VodDetails`, `MovieAction`, `MoviePlaybackChoice`, and the shared hero sections reused by Task 7.

```ts
export type MovieAction = "play" | "resume" | "restart" | "more";

export interface MoviePlaybackChoice {
  resumeAt: number;
  restart: boolean;
}

export interface VodTitleRowProps {
  title: string;
  favourite: boolean;
  focused: "back" | "favourite" | null;
  onBack: () => void;
  onToggleFavourite: () => void;
}

export interface VodDetailsProps {
  resource: LibraryResource<XtreamMovieDetail | undefined>;
  origin: VodOrigin;
  progress?: ResolvedPlaybackProgress;
  favourite: boolean;
  focus: { zone: "title" | "actions" | "drawer"; index: number };
  onBack: () => void;
  onToggleFavourite: () => void;
  onPlay: (choice: MoviePlaybackChoice) => void;
  onRetry: () => void;
}
```

- [ ] **Step 1: Write Movie details content and resilience tests without running them**

Assert the first valid backdrop fills the details background at a maximum 1280 by 720 decode, the poster remains a separate 192 by 288 portrait image, closing or changing details releases the backdrop, and backdrop absence or failure uses the poster tone without another request.

Assert the title row contains Back, the complete one line provider title teleprompter, and one compact Favourite toggle. Assert details do not repeat a Movie label under the title.

Assert rating sits with valid year, duration, and genre. Assert cast, director, country, age rating, and empty metadata rows disappear rather than show Unknown. Assert synopsis uses a fixed line count and More information opens only when measured overflow exists.

Assert provider content renders through text nodes with `dir="auto"`, an empty title uses Untitled, invalid dates and ratings disappear, missing artwork keeps geometry, and long bidirectional and emoji titles remain complete in the DOM.

- [ ] **Step 2: Write Movie action and focus tests without running them**

Assert a new movie shows one Play action. Assert a movie with progress shows Resume from the saved time followed by Start from beginning. Assert Favourite never appears in the action stack.

Assert Up from the top action enters the title row at Back, inline directions move between Back and Favourite, Down returns to the top action, and focus never loops. Assert the focused Favourite shows a short state label without changing row geometry and uses Add or Remove wording in its accessible name.

Assert Resume emits `{ resumeAt: savedSeconds, restart: false }`. Assert Start from beginning emits `{ resumeAt: 0, restart: true }` and leaves the old progress visible until 15 seconds of the new session have advanced. Assert returning from Stop or completion restores the same details action and the same poster or search origin.

Assert Favourite toggling immediately updates the title toggle, origin poster badge, Favourites count, category visibility, and accessible name without closing details.

- [ ] **Step 3: Implement shared title, hero, and information drawer regions**

Keep the title row height fixed whether its state label is hidden or visible. Render favourite state through an outline star when absent and accent state when present, while white focus remains distinct.

Keep the information drawer above details in the existing screen stack. Back closes the drawer first and restores the More information action. A later Back leaves details for `origin`.

- [ ] **Step 4: Connect Movie details to `VodScreen`**

Open details only after OK or pointer click on a poster. Keep the origin in navigation state before requesting details. Show regional skeleton, failed Retry, and successful hero without replacing the rail or shared header.

Map each Movie action to one `VodPlaybackRequest`, preserving sibling keys from the category or search result list for subsystem 2 Previous and Next behavior.

- [ ] **Step 5: Inspect the Task 6 diff manually**

Inspect absent metadata, no progress, saved progress, failed details, failed backdrop, favourite addition and removal, information drawer Back, right to left title focus, and reduced motion. Do not run automated checks.

- [ ] **Step 6: Commit Movie details**

```bash
git add src/components/vod/VodTitleRow.tsx src/components/vod/VodDetails.tsx src/screens/VodScreen.tsx src/styles/app.css tests/library-ui.test.tsx tests/keyLaws.test.tsx
git commit -m "feat(vod): add Movie details and actions"
```

### Task 7: Series Details and Inline Episodes

**Files:**
- Create: `src/components/vod/SeriesDetails.tsx`
- Create: `src/components/vod/EpisodeList.tsx`
- Modify: `src/components/vod/VodDetails.tsx`
- Modify: `src/screens/VodScreen.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/library-ui.test.tsx:164-202,436-448`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/personal.test.ts`

**Interfaces:**
- Consumes: Task 1 Series and episode metadata, Task 2 `seriesContinueFor`, progress and favourites, Task 3 artwork, Task 4 Series navigation, Task 5 shell, and Task 6 shared title and hero.
- Produces: `SeriesDetails`, `EpisodeList`, `SeriesAction`, `episodeReference`, and manual episode playback requests.

```ts
export type SeriesAction = "continue" | "restart" | "episodes";

export function episodeReference(
  episode: Pick<XtreamEpisode, "season" | "number">,
  translate: (key: MessageKey, values?: MessageValues) => string,
): string;

export interface SeriesDetailsProps {
  resource: LibraryResource<XtreamSeriesDetail | undefined>;
  origin: VodOrigin;
  continueTarget: SeriesContinueTarget | null;
  favourite: boolean;
  actionIndex: number;
  titleControl: "back" | "favourite";
  episodePanelOpen: boolean;
  onBack: () => void;
  onToggleFavourite: () => void;
  onContinue: (target: SeriesContinueTarget) => void;
  onRestart: (target: SeriesContinueTarget) => void;
  onToggleEpisodes: () => void;
  onRetry: () => void;
}

export interface EpisodeListProps {
  detail: XtreamSeriesDetail;
  seasonCursor: XtreamSeasonKey;
  selectedSeason: XtreamSeasonKey;
  episodeKey: string;
  state: "loaded" | "empty" | "failed";
  error?: string;
  continueEpisodeKey?: string;
  progress: readonly ResolvedPlaybackProgress[];
  onPreviewSeason: (season: XtreamSeasonKey) => void;
  onCommitSeason: (season: XtreamSeasonKey) => void;
  onSelectEpisode: (episode: XtreamEpisode) => void;
  onRetry: () => void;
  onWheel: (deltaY: number) => void;
}
```

- [ ] **Step 1: Write Series hero and action tests without running them**

Assert Series details uses the same title row and stable hero geometry as Movie details, omits a repeated Series label, shows only nonempty metadata, and toggles Favourite without moving or closing the episode panel.

Assert Continue labels the exact episode and remaining time when progress exists, advances to the next episode when the last watched episode completed, uses Play plus the first playable provider episode without progress, and returns to the first playable episode when the final episode completed.

Assert the restart action appears only when Continue points to saved progress, references the same episode, emits zero, and retains old progress until the new session advances 15 seconds. Assert Episodes changes to Hide episodes while the panel is open.

Assert a Series with no playable episodes shows No episodes available and exposes no Continue, Play, restart, or episode row Play action.

- [ ] **Step 2: Write inline episode panel and season tests without running them**

Assert selecting Episodes replaces the poster region with the season selector and windowed episode list while title row, hero copy, and action column keep their boxes. Assert the panel transition is at most 180 milliseconds, reduced motion removes translation, and episode focus moves to the Continue target before animation completion.

Assert inline end from the remembered hero action enters the remembered episode, inline start from an episode returns to that hero action without closing the panel, Episodes explicitly toggles the panel, and Back or title row Back leaves Series details for the exact origin whether the panel is open or closed.

Assert season Left and Right move white preview focus without changing the selected blue season or episode rows, OK commits the season and restores its remembered episode, season zero displays Specials, numeric seasons sort, and one unnumbered season hides the season row.

Assert an empty season keeps focus on its season pill and shows a nonfocus No episodes available message. Assert a failed season keeps the season row and title Back reachable, exposes Retry in the episode region, and Retry reloads only that Series detail.

- [ ] **Step 3: Write episode row, reference, and manual playback tests without running them**

Assert the Continue target carries a persistent blue Up next marker that remains distinct from white focus. Assert rows show translated episode reference, complete one line title teleprompter, valid duration, progress, and valid provider rating. Assert focused episode plot, release date, and image appear only when supplied.

Assert references are `S{season}:E{episode}` through translated messages when both exist, Episode 3 when only episode exists, Season 1 selected episode when only season exists, and selected episode when neither exists. Assert no path renders `S0:E0` for missing values, while Specials remains a valid season zero label.

Assert OK and pointer click on any playable episode emit `{ resumeAt: 0, restart: true }` even when saved progress exists. Assert manual episode selection never resumes, while the Series Continue action remains the only episode resume path.

Assert an episode with provider id plays directly, one with direct source fingerprint resolves current raw address after detail load, and one without provider id or valid direct source remains readable with no Play action and creates no progress record.

Assert episode wheel movement changes one linear item, crosses window boundaries, obeys the 120 millisecond guard, and cannot mount the full season.

- [ ] **Step 4: Implement Series details and episode panel**

Reuse the Task 6 title and hero components. Keep panel open state inside `useVodNavigation`, not in CSS animation completion callbacks. Use opacity and inline position only, and let reduced motion produce the final layout immediately.

Use `seriesContinueFor` for every Continue and restart label so display and playback cannot choose different episodes. Route manual episode selection through a separate callback that always sets zero. Style hero actions as rounded tonal buttons with white focused fill, shared halo, restrained pressed scale, and no ambient animation. Style the episode panel with `--over-video`, one hairline, one soft radius, the existing elevation, and no blur.

- [ ] **Step 5: Inspect the Task 7 diff manually**

Trace a new Series, a partially watched episode, a completed middle episode, a completed final episode, Specials, an unnumbered season, missing episode numbers, an empty season, a failed season, an idless readable episode, and a direct source episode. Do not run automated checks.

- [ ] **Step 6: Commit Series and episodes**

```bash
git add src/components/vod/SeriesDetails.tsx src/components/vod/EpisodeList.tsx src/components/vod/VodDetails.tsx src/screens/VodScreen.tsx src/styles/app.css tests/library-ui.test.tsx tests/keyLaws.test.tsx tests/personal.test.ts
git commit -m "feat(vod): add Series seasons and episodes"
```

### Task 8: Application, Playback, and Back Stack Integration

**Files:**
- Modify: `src/App.tsx:208-338,455-689,691-917,1484-1949,1951-2583,2820-3109`
- Modify: `src/screens/VodScreen.tsx`
- Modify: subsystem 1 `src/screens/LiveScreen.tsx`
- Modify: subsystem 1 `src/components/PanelHeader.tsx`
- Delete: `src/components/MediaList.tsx`
- Delete: `src/components/MediaDetails.tsx`
- Delete: `src/hooks/useBrowseStack.ts`
- Delete: `src/components/ContentSelector.tsx`
- Modify: `tests/support/app.tsx`
- Modify: `tests/library-ui.test.tsx`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/resume.test.tsx`
- Modify: `tests/favourites.test.tsx`

**Interfaces:**
- Consumes: subsystem 1 `SurfaceKeyHandler` and ordered stack, subsystem 2 `PlaybackController`, `PlaybackReturnRoute`, `PlaybackTarget.progress`, and `rememberProgress`, plus `VodScreenHandle`, `VodPlaybackRequest`, and library playback address resolution.
- Produces: one VOD key owner, one finite playback return route, decoder release on VOD entry, ordinary Live retune on VOD exit, and these App owned VOD actions.

```ts
export interface VodPlaybackActions {
  play(request: VodPlaybackRequest): void;
  returnToLive(): void;
}

export function playbackRouteFor(request: VodPlaybackRequest): PlaybackReturnRoute;
```

- [ ] **Step 1: Write mode and decoder lifecycle tests without running them**

Assert choosing Movies or Series through the shared header calls `controller.stop()`, clears recovery through the subsystem 2 target cancellation path, releases the decoder, remembers the current Live channel, selects the `"vod"` primary surface, and renders only the opaque VOD surface.

Assert switching Movies to Series does not retune or create a provider playback connection. Assert Back from the VOD root changes mode to Live and calls `controller.start(rememberedChannel)` through the ordinary Live path, while a missing remembered channel falls back through the ordinary nearest valid Live selection path.

Assert an M3U source exposes Live, Search, and Settings only. Assert an Xtream source exposes Live, Movies, Series, Search, and Settings, and each mode restores its exact valid position after switching.

- [ ] **Step 2: Write input owner and Back order tests without running them**

Assert `App.tsx` sends VOD input only to `VodScreenHandle.handleKey` while VOD owns the primary surface. Assert settings and confirmation surfaces remain above VOD, consume input first, and return to the same VOD focus.

Expand key law cases for VOD root, search field, search grid, Movie title, Movie actions, Series title, Series actions, season row, episode list, and Retry. Assert Back removes one visible depth, with the special approved rule that Back from an open Series episode panel leaves details for the origin rather than merely hiding the panel.

Assert digits never tune Live while VOD or VOD search owns input. Assert Yellow still opens Settings and Green remains an optional favourite shortcut without becoming the only favourite path.

- [ ] **Step 3: Write finite playback origin and progress boundary tests without running them**

Assert movie Resume starts at saved seconds, Movie Start from beginning starts at zero, Series Continue starts at saved seconds, Series restart starts at zero, and manual episode OK starts at zero even with saved progress.

Assert a valid direct source is used before a generated Movie or episode path. Assert generated addresses omit the dot when extension is absent. Assert unreadable episodes never call playback.

Assert target change persists the previous item, pause persists, Stop persists, hide persists, 15 second advancement persists, completion removes progress, and Start from beginning leaves the old progress until its new session crosses 15 seconds.

Assert Stop and completion restore details with the same action, title control, episode panel state, selected season, episode cursor, origin poster or result, and row window. Assert finite picture Back uses the subsystem 2 contract to return to the same details state.

- [ ] **Step 4: Replace App owned VOD frame logic with one delegated screen**

Remove `contentKind`, `mediaBrowse`, `FiniteSelection`, Movie key maps, VOD category assembly, VOD search filtering, detail loading, season frame construction, and VOD key branches from `App.tsx`. Keep only active mode, remembered Live channel, `VodScreen` ref, playback request mapping, and top level screen stack decisions.

Construct one `VodPlaybackRequest` to `PlaybackTarget` mapper. Resolve a direct source first, otherwise call the Task 1 generated address builder through the library session. Attach the subsystem 2 `PlaybackProgressSeed`, record `playbackRouteFor(request)` in App, then call `controller.start(target, { restart: request.restart })`. Keep the complete `VodOrigin` inside the mounted VOD navigation state, and never place provider credentials in a target, route, or progress seed.

- [ ] **Step 5: Remove obsolete list based VOD components**

Delete `MediaList.tsx`, `MediaDetails.tsx`, `useBrowseStack.ts`, and `ContentSelector.tsx` after repository search shows no caller because subsystem 1 now owns mode controls in the shared header. Remove matching old CSS selectors and old list based tests rather than preserving a second VOD implementation.

- [ ] **Step 6: Inspect the Task 8 diff manually**

Trace the screen stack from Live picture to Movies root, Movie search, Movie details, finite playback, restored details, Series root, episode panel, Settings, restored Series, and Back to Live. Confirm one input owner and one decoder owner at each point. Do not run automated checks.

- [ ] **Step 7: Commit application integration**

```bash
git add src/App.tsx src/screens/VodScreen.tsx src/screens/LiveScreen.tsx src/components/PanelHeader.tsx src/components/MediaList.tsx src/components/MediaDetails.tsx src/hooks/useBrowseStack.ts src/components/ContentSelector.tsx tests/support/app.tsx tests/library-ui.test.tsx tests/keyLaws.test.tsx tests/resume.test.tsx tests/favourites.test.tsx
git commit -m "feat(vod): connect VOD modes to playback"
```

### Task 9: Provider Stress Fixtures, Television Journeys, and Documentation

**Files:**
- Modify: `scripts/present.mjs:67-281`
- Modify: `scripts/tv/harness.mjs:20-59,152-172,260-282,292-556`
- Modify: `scripts/tv/engine-parity.mjs:45-74`
- Modify: `scripts/tv/sim.mjs:1557-1715`
- Modify: `tests/harness.test.ts:80-313`
- Modify: `AGENTS.md:58-116,123-152`
- Modify: `docs/design.md:10-56,126-190,223-253`
- Modify: `docs/testing.md:16-45,100-171,237-245`

**Interfaces:**
- Consumes: the final VOD DOM roles and accessible labels, existing deterministic Xtream fixture server, journey tracker, parity walk, simulator phase helper, and documentation structure.
- Produces: deterministic provider stress modes, required VOD journeys in parity and performance gates, and final architecture and acceptance documentation.

- [ ] **Step 1: Write provider fixture and journey tracker tests without running them**

Extend fixture tests to assert large Movies and Series categories, complete indexes, duplicate identifiers, duplicate names, empty titles, empty category names, malformed ratings, `rating_5based`, backdrop arrays, backdrop strings, encoded backdrop arrays, invalid backdrop schemes, long cast, long plot, base64 text, emoji, joined glyphs, missing episode numbers, missing episode ids, direct source episodes, Specials, empty seasons, failed categories, failed details, slow responses, streamed oversized responses, oversized artwork, missing artwork, and undecodable artwork.

Add required journey labels for cold poster grid, warm poster grid, held grid direction, category focus settle, category position restore, scoped search and return, Movie details and favourite, Series Continue, season commit, manual episode start, wheel guard, right to left movement, missing metadata, regional retry, and VOD heap growth. Keep `tests/harness.test.ts` asserting every required label appears in `sim.mjs`.

- [ ] **Step 2: Extend deterministic fixture routes**

Serve distinct 192 by 288 JPEG poster derivatives and 1280 by 720 backdrop fixtures locally. Include stable malformed and absent variants by item index so parity and budget runs do not depend on an external image host or random response.

Provide explicit route switches for empty, failed, slow, oversized, and malformed responses. Keep fixture responses free of configured username and password values except the authenticated request path itself.

- [ ] **Step 3: Replace old list journeys with full VOD journeys**

Update parity walking to locate regions by roles, accessible names, and stable VOD classes. Capture Movies root, second category, scoped search, Movie details, Series details, open episode panel, committed season, focused episode, Retry, missing artwork, and right to left structural layouts.

Update the engine parity selector list with `.vod-screen`, `.vod-header`, `.vod-rail`, `.poster-grid`, `.poster-card`, `.vod-title-row`, `.vod-hero`, `.series-actions`, `.episode-panel`, `.season-row`, and `.episode-list`.

Update simulator phases to hold directions across cold and warm grids, switch categories and restore positions, search and return, open Movie and Series details, change season, resume through Continue, start an episode manually, toggle Favourite, send guarded wheel gestures, and collect heap before and after repeated category and details churn.

Use the existing journey tracker to fail when any phase does not complete. Do not set budget allowances until the new journeys have been measured on a quiet machine during Task 10.

- [ ] **Step 4: Update architecture and project invariants**

Update `AGENTS.md` with the final VOD component map, generic artwork service, poster row windowing, library boundary, 24 MiB class partitions, immediate category focus with delayed work, one item wheel guard, and the rule that VOD never keeps a hidden provider connection.

Replace the old `docs/design.md` statements that Movies and Series are panel frames, that VOD search covers loaded categories only, and that all cache entries compete in one least recently used pool. Document the full screen shell, category order, search index policy, Movie and Series details, inline episode panel, progress resolution, artwork lifetime, and class budgets.

Update `docs/testing.md` with ownership of normalization, cache, progress, artwork, navigation, component, parity, and simulator checks. Add real television acceptance for a large poster catalogue, category settle, search return, Movie resume and restart, Series Continue, manual episode start from zero, favourite visibility, missing artwork, and right to left movement.

- [ ] **Step 5: Inspect Task 9 fixture and documentation changes manually**

Confirm every journey waits for the state it intends to measure, every parity capture contains structural boxes, fixture failures are deterministic, no credential enters a response body or diagnostic, Markdown links render, commands match `package.json`, and every Markdown paragraph or list item occupies one physical source line. Do not run automated checks.

- [ ] **Step 6: Commit fixtures, harness, and documentation**

```bash
git add scripts/present.mjs scripts/tv/harness.mjs scripts/tv/engine-parity.mjs scripts/tv/sim.mjs tests/harness.test.ts AGENTS.md docs/design.md docs/testing.md
git commit -m "test(vod): add provider and television journeys"
```

### Task 10: Final Pre Push Gate Command Manifest

Execute this task only from Task 7 of `docs/superpowers/plans/2026-10-05-openiptv-redesign-master.md`, after every subsystem review passes.

**Files:**
- Review: Every file changed by Tasks 1 through 9.
- Modify only when required by a relevant final gate failure.

**Interfaces:**
- Produces: A reviewed subsystem 3 branch whose tests, build, compatibility, layout, and measured performance are ready for independent review and a later push decision.

- [ ] **Step 1: Confirm implementation scope before any automated command**

Run `git status --short` and inspect `git diff origin/master...HEAD --stat`. Confirm the VOD commits contain subsystem 3 work only, while the complete branch contains only the approved five subsystem deliveries. Confirm there is no unapproved dependency change, WebAssembly artifact, provider credential, generated scratch file, or unrelated cleanup.

- [ ] **Step 2: Install the locked dependency tree and run the complete local code gate once**

Run: `npm ci`

Expected: PASS without a dependency manifest change.

Run: `npm run check`

Expected: PASS. This is the first automated test, lint, and type check execution for Tasks 1 through 9, as required by the user override.

If a relevant check fails, fix only the owning task, inspect that fix, and rerun only the failed focused command until it passes. Run `npm run check` again only when the fix can affect another check in the complete gate.

- [ ] **Step 3: Build the production artifact**

Run: `npm run build`

Expected: PASS with one production artifact and no unresolved import from `MediaList`, `MediaDetails`, `useBrowseStack`, or an unused `ContentSelector`.

- [ ] **Step 4: Run layout and engine compatibility gates**

Run: `npm run tv:gap`

Expected: PASS with equivalent spacing for every new flex container.

Run: `npm run tv:engines`

Expected: PASS in the pinned Chromium 69 floor engine and the ceiling engine, with every VOD structural journey completed and no unsupported runtime API.

- [ ] **Step 5: Run the television performance budget on a quiet machine**

Read the load reported in the harness header before interpreting a failure.

Run: `npm run tv:budget`

Expected: PASS after measured allowances are added for the new named journeys. Cold and warm poster grids, held directions, category switching, search, details, episodes, image churn, and heap growth must each report their own result.

If load is high, wait for a quiet machine and rerun once. Do not increase an allowance to hide machine load or an unowned journey.

- [ ] **Step 6: Review the complete diff and whitespace**

Run: `git diff origin/master...HEAD`

Run: `git diff --check`

Run: `git status --short`

Expected: The complete diff contains the approved five subsystem redesign, including the VOD experience, its tests, deterministic fixture work, and supporting documentation. It contains no secrets, raw provider addresses in diagnostics, dead list based VOD code, unsupported methods, prose em dash, prose en dash, prose semicolon, manual Markdown line wrapping, or unrelated cleanup.

- [ ] **Step 7: Perform manual browser and real television acceptance**

Use `npm run dev` for keyboard and pointer acceptance. Verify Live to Movies to Series mode switching, decoder release, six column poster navigation, category focus settle, guarded wheel movement, search keyboard Back order, Movie resume and restart, Series Continue, season preview and commit, inline episode panel, manual episode start from zero, favourites, all regional states, reduced motion, and right to left movement.

When authorised provider media and a paired television are available, use `npm run tv:on-set -- --stream=<authorised-stream-url>` for one Movie and one episode, then complete the VOD checks documented in `docs/testing.md`. Record unavailable hardware or provider features as release risk rather than simulated evidence.

- [ ] **Step 8: Commit only final gate fixes when needed**

Do not create an empty commit. When Task 10 required source or documentation fixes, stage only those fixes and use the smallest matching conventional commit message with the personal project identity.

```bash
git commit -m "fix(vod): address final gate findings"
```

- [ ] **Step 9: Stop before push**

Report every command run, every result, any skipped real television acceptance, the final commit list, and the complete diff summary. Wait for Shayan to approve any push or pull request action.
