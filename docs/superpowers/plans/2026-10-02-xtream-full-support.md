# Full Xtream Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement first class Xtream live television, movies, series, episodes, programme information and catchup without regressing M3U behavior or Samsung television compatibility.

**Architecture:** Saved playlists use typed M3U or Xtream sources. A pure Xtream service normalises the provider API, the channel store owns the eager live catalogue, a focused library store owns lazy on demand content, and the existing panel gains content and frame navigation without adding a top level screen. The player receives explicit live or finite targets so each playback mode preserves correct transport behavior.

**Tech Stack:** React 19, TypeScript, zustand, native Fetch and URL APIs, IndexedDB through the existing disk service, Vitest, Biome, Vite, AVPlay and hls.js.

**Spec:** `docs/superpowers/specs/2026-10-02-xtream-full-support-design.md`

## Global Constraints

- Add no runtime dependency or hosted service.
- Preserve the player, banner, panel and settings layer order.
- Preserve the four remote key laws and immediate cursor response.
- Keep M3U launch, navigation, search, favourites and playback behavior unchanged.
- Preserve provider supplied names exactly and translate application labels separately.
- Use opaque category keys and playlist scoped item keys for identity.
- Keep credentials out of cache keys, item identifiers, diagnostics, visible errors and logs.
- Load all live summaries eagerly and load movie, series, detail, episode and guide data only after explicit use.
- Perform no IndexedDB work in direct response to a key press.
- Target ES2019 and Chromium 69 without a model year branch.
- Start every behavior change with a failing test and run the smallest relevant test after each implementation step.
- Do not commit or push until Shayan explicitly approves those actions.

## Review Focus

- Provider `server_info` may contain a full URL, bare host, host with port or missing port, and every valid shape must retain the configured fallback without producing a malformed stream origin.
- An abort during authentication, catalogue loading, category loading, details loading or guide loading must leave state owned by the newer request untouched.
- Two playlists may contain the same provider stream identifiers, and favourites, resume, hidden categories and playing markers must stay scoped to the correct playlist.
- A provider may return very large movie and series categories, and opening one category must not preload adjacent categories or build an unwindowed DOM.
- A hosted HTTPS browser may encounter an HTTP only or Cross Origin Resource Sharing blocked provider, and setup must explain that limitation while the packaged television continues using the configured transport.

## File Structure

- `src/services/playlistUrl.ts` owns typed source construction, legacy migration, validation and safe display values.
- `src/stores/settings.ts` owns persisted typed playlists and invalidation when an Xtream account changes.
- `src/services/xtream.ts` owns every Xtream endpoint, parser and stream address.
- `src/stores/channels.ts` owns M3U and Xtream live catalogue loading and cache policy.
- `src/stores/personal.ts` owns favourites, last played state and bounded finite playback progress.
- `src/stores/library.ts` owns movie, series, detail, episode and guide request state.
- `src/hooks/useBrowseStack.ts` owns panel frame navigation and cursor restoration.
- `src/services/player.ts` and `src/hooks/useTuner.ts` own live and finite playback behavior.
- Existing components remain the visual language. New content components stay focused on one list or detail responsibility.

---

### Task 1: Typed Playlist Sources and Migration

**Files:**
- Modify: `src/services/playlistUrl.ts`
- Modify: `src/services/xtream.ts`
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/setup.ts`
- Modify: `src/stores/channels.ts`
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/components/settings/Playlists.tsx`
- Modify: `src/services/remoteProtocol.ts`
- Modify: `src/App.tsx`
- Modify: `public/remote/remote.js`
- Test: `tests/playlistUrl.test.ts`
- Test: `tests/settings.test.ts`
- Test: `tests/onboarding-language.test.tsx`
- Test: `tests/settings-ui.test.tsx`
- Test: `tests/remoteProtocol.test.ts`
- Test: `tests/remoteWeb.test.ts`

**Interfaces:**
- Produces: `M3USource`, `XtreamSource` and `PlaylistSource` exported from `src/services/playlistUrl.ts`.
- Produces: `m3uSource(raw: string): M3USource | null`, `xtreamSource(server: string, username: string, password: string, output: XtreamOutput): XtreamSource | null`, `parseXtreamPlaylistUrl(raw: string): XtreamSource | null`, `sourceDisplay(source: PlaylistSource): string` and transitional `sourceRequestAddress(source: PlaylistSource): string`.
- Produces: `Playlist.source: PlaylistSource`, `Playlist.sourceVersion: number`, `addPlaylist(name: string, source: PlaylistSource)` and `updatePlaylist(id: string, name: string, source: PlaylistSource)`. Any source field change increments `sourceVersion`.
- Produces: `Onboarding.onAdd(name: string, source: PlaylistSource)` and `validatePlaylist(name: string, source: PlaylistSource)`.
- Renames: the existing `XtreamSource = "live" | "vod"` alias in `services/xtream.ts` to `XtreamContentKind` so credential and content types cannot be confused.
- Consumes later: every load, cache and remote command reads `Playlist.source` and never reconstructs source identity from `Playlist.url`. `sourceRequestAddress` keeps the current request path compiling only until Task 3 replaces Xtream validation and loading with Player API calls.

- [ ] **Step 1: Write failing source and migration tests**

Add tests proving `get.php` settings with username and password migrate to `{ kind: "xtream", server, username, password, output }`, missing type defaults to `m3u_plus`, missing output defaults to `ts`, explicit unsupported values remain M3U, arbitrary M3U addresses migrate unchanged, malformed Xtream input is rejected, provider credentials round trip special characters, `sourceVersion` starts at 1 and increments on any source change, and persisted playlists no longer contain a top level `url` field.

- [ ] **Step 2: Run source tests and verify the expected failures**

Run: `npm test -- tests/playlistUrl.test.ts tests/settings.test.ts`

Expected: FAIL because `Playlist.source` and typed builders do not exist.

- [ ] **Step 3: Implement typed source helpers and settings migration**

Add the exact interfaces above, migrate settings during `load()`, update playlist mutation signatures, clear `categoryCount` when the source changes, rename the old Xtream content alias, and adapt App plus the channel store to typed sources through `sourceRequestAddress`. Preserve playlist identifiers and existing M3U strings so the branch remains compilable before Task 3 removes transitional Xtream URL loading.

- [ ] **Step 4: Run source tests until they pass**

Run: `npm test -- tests/playlistUrl.test.ts tests/settings.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing component and remote source tests**

Add tests proving onboarding and Settings persist typed sources, local editing preserves an existing password until replaced, remote snapshots omit the password, remote Xtream edits use blank password as unchanged, and M3U device setup remains unchanged.

- [ ] **Step 6: Run component and remote tests and verify the expected failures**

Run: `npm test -- tests/onboarding-language.test.tsx tests/settings-ui.test.tsx tests/remoteProtocol.test.ts tests/remoteWeb.test.ts`

Expected: FAIL because forms and commands still send URL strings.

- [ ] **Step 7: Update forms, setup state and remote protocol to typed sources**

Use `PlaylistSource` in TV forms and typed command payloads. Remote state returns Xtream server, username, output and `hasPassword`, never password. Update the static device interface without adding a second source model.

- [ ] **Step 8: Run all Task 1 tests and typecheck**

Run: `npm test -- tests/playlistUrl.test.ts tests/settings.test.ts tests/onboarding-language.test.tsx tests/settings-ui.test.tsx tests/remoteProtocol.test.ts tests/remoteWeb.test.ts && npm run typecheck`

Expected: PASS with no unresolved `Playlist.url`, string source or old content alias reference.

### Task 2: Pure Xtream Client and Normalised Types

**Files:**
- Modify: `src/services/xtream.ts`
- Modify: `src/types.ts`
- Test: `tests/xtream.test.ts`

**Interfaces:**
- Consumes: `XtreamSource` from Task 1.
- Produces: `XtreamSession`, `XtreamAccount`, `XtreamCategory`, `XtreamMovie`, `XtreamSeries`, `XtreamEpisode`, `XtreamMovieDetail`, `XtreamSeriesDetail` and `XtreamProgramme`.
- Produces: optional `Channel.xtream = { playlistId: string; streamId: string; categoryKey: string; archiveDays: number; directSource: string }` for live provider behavior.
- Produces: `authenticateXtream(source: XtreamSource, signal?: AbortSignal): Promise<XtreamSession>`.
- Produces: `loadXtreamCategories(session: XtreamSession, signal?: AbortSignal): Promise<XtreamCategory[]>` through `get_live_categories`, `get_vod_categories` and `get_series_categories`.
- Produces: `loadXtreamLive(session: XtreamSession, playlistId: string, signal?: AbortSignal): Promise<Channel[]>` through `get_live_streams`.
- Produces: `loadXtreamMovies(session: XtreamSession, playlistId: string, categoryId: string, signal?: AbortSignal): Promise<XtreamMovie[]>` through `get_vod_streams&category_id=<id>`.
- Produces: `loadXtreamSeries(session: XtreamSession, playlistId: string, categoryId: string, signal?: AbortSignal): Promise<XtreamSeries[]>` through `get_series&category_id=<id>`.
- Produces: `loadXtreamMovieDetail(session: XtreamSession, playlistId: string, streamId: string, signal?: AbortSignal): Promise<XtreamMovieDetail>` through `get_vod_info&vod_id=<id>`.
- Produces: `loadXtreamSeriesDetail(session: XtreamSession, playlistId: string, seriesId: string, signal?: AbortSignal): Promise<XtreamSeriesDetail>` through `get_series_info&series_id=<id>`, reading `episodes` by season key.
- Produces: `loadXtreamGuide(session: XtreamSession, streamId: string, signal?: AbortSignal): Promise<XtreamProgramme[]>` through `get_short_epg&stream_id=<id>&limit=20`.
- Produces: live `/live/<user>/<pass>/<id>.<output>`, movie `/movie/<user>/<pass>/<id>.<extension>`, episode `/series/<user>/<pass>/<id>.<extension>` and catchup `/timeshift/<user>/<pass>/<duration>/<YYYY-MM-DD:HH-MM>/<id>.ts` builders.
- Retains temporarily: `loadXtreamCatalog` and `loadXtreamCategory` adapters with the old signatures so Task 2 remains type safe. Task 3 removes both adapters and their channel store imports.

- [ ] **Step 1: Replace existing Xtream tests with failing protocol contract tests**

Cover authentication states, full URL and bare host `server_info`, configured port fallback, browser HTTPS consistency for API, generated stream, direct source and artwork URLs, malformed JSON, arrays containing invalid values, exact category names, shared uncategorised sentinel, duplicate item identifiers, special credentials, every endpoint and parameter named above, series episodes keyed by season, direct source, EPG base64 fallback and the exact catchup path format.

- [ ] **Step 2: Run the Xtream tests and verify the expected failures**

Run: `npm test -- tests/xtream.test.ts`

Expected: FAIL because the complete client functions and normalised types do not exist.

- [ ] **Step 3: Implement the pure client**

Keep native Fetch, URL and AbortSignal. Parse provider host fields defensively, reject non HTTP origins, preserve provider names, filter missing identifiers, deduplicate by content kind and provider identifier, and never put credentials in errors.

- [ ] **Step 4: Run the Xtream tests and typecheck until they pass**

Run: `npm test -- tests/xtream.test.ts && npm run typecheck`

Expected: PASS while the temporary adapters keep existing channel store consumers compilable.

### Task 3: API First Live Catalogue, Cache and Cancellation

**Files:**
- Modify: `src/stores/channels.ts`
- Modify: `src/services/lineup.ts`
- Modify: `src/App.tsx`
- Test: `tests/channels.test.ts`
- Test: `tests/resume.test.tsx`
- Test: `tests/search.test.tsx`
- Test: `tests/favourites.test.tsx`

**Interfaces:**
- Consumes: typed sources from Task 1 and the Task 2 authentication, category and live functions.
- Produces: Xtream live `Channel.id` values in `xtream:<playlistId>:live:<streamId>` form.
- Produces: complete live categories derived by opaque category key while preserving category display names.
- Produces: cache keys `xtream:<playlistId>:v<sourceVersion>:account`, `xtream:<playlistId>:v<sourceVersion>:categories` and `xtream:<playlistId>:v<sourceVersion>:live`, with stamps `openiptv.at.xtream:<playlistId>:v<sourceVersion>:<scope>`.
- Produces: `validatePlaylist(name: string, source: PlaylistSource)` that fetches an M3U source or authenticates an Xtream source, and never downloads `get.php` for Xtream validation.
- Removes: M3U first Xtream fallback, lazy live `loadCategory(name)` behavior, transitional `sourceRequestAddress` use for Xtream, and Task 2 compatibility adapters.

- [ ] **Step 1: Write failing API first live tests**

Add tests proving an Xtream source never requests `get.php` during validation or loading, all live streams load before success, categories use exact names and opaque identifiers, empty first categories do not block later content, duplicate names remain independently usable, two playlists with stream ID 1 have different channel IDs, browser HTTPS requests and generated URLs follow one transport policy, and a 404 Player API response explains that a working `get.php` address can be added as M3U.

- [ ] **Step 2: Write failing cancellation and cache tests**

Add tests proving abort during authentication and live loading cannot write an error or clear newer loading state, cached live data answers launch, stale refresh keeps cached data on failure, a source version change cannot read old cache data, the sweep removes obsolete source versions and removed playlists, clear cache removes Xtream values and stamps, and a fresh cache avoids network work.

- [ ] **Step 3: Run live store tests and verify the expected failures**

Run: `npm test -- tests/channels.test.ts`

Expected: FAIL because the store still fetches M3U and loads one category through fallback.

- [ ] **Step 4: Implement API first live loading and cache policy**

Branch on `Playlist.source.kind`, keep the existing M3U refresh path intact, authenticate Xtream validation directly, add one catalogue controller whose token guards every state write, populate the complete live lineup, and store serialised account, category and live data through `services/disk` outside interaction handlers. Extend sweep and clear cache to own both cache prefixes and both stamp families, then delete the temporary Task 2 adapters, transitional `sourceRequestAddress` and canonical URL builder when no caller remains.

- [ ] **Step 5: Run channel tests until they pass**

Run: `npm test -- tests/channels.test.ts`

Expected: PASS.

- [ ] **Step 6: Write failing live behavior integration tests**

Add tests proving Xtream last channel resumes outside the first provider category, live global search finds every category, number entry finds every live channel, scoped favourites do not cross playlists, hidden duplicate category names remain independent, one unique legacy hidden label maps to its opaque category key, and ambiguous or missing legacy hidden labels are removed and shown.

- [ ] **Step 7: Run integration tests and verify the expected failures**

Run: `npm test -- tests/resume.test.tsx tests/search.test.tsx tests/favourites.test.tsx`

Expected: FAIL until App and lineup consume opaque category identities.

- [ ] **Step 8: Update lineup and App live integration**

Carry category keys separately from names, keep M3U category keys equal to exact group names, and preserve existing list timing and key behavior.

- [ ] **Step 9: Run all Task 3 tests**

Run: `npm test -- tests/channels.test.ts tests/resume.test.tsx tests/search.test.tsx tests/favourites.test.tsx`

Expected: PASS.

### Task 4: Personal State for Live and Finite Content

**Files:**
- Create: `src/stores/personal.ts`
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/channels.ts`
- Modify: `src/services/lineup.ts`
- Modify: `src/App.tsx`
- Create: `tests/personal.test.ts`
- Test: `tests/favourites.test.tsx`
- Test: `tests/resume.test.tsx`

**Interfaces:**
- Produces: `FavouriteSnapshot`, `LastPlayed`, `PlaybackProgress` and `usePersonal`.
- Produces: `toggleFavourite(snapshot: FavouriteSnapshot)`, `rememberLast(last: LastPlayed)`, `progressFor(itemKey: string)`, `rememberProgress(itemKey: string, seconds: number, duration?: number)`, `completeProgress(itemKey: string)` and `clearPlaylistPersonal(playlistId: string)`.
- Produces: `adoptLegacyPersonal(playlists: Playlist[], loadedPlaylistId: string, channels: Channel[])`, which resolves ordinary legacy IDs against the loaded playlist, maps unscoped Xtream IDs only when exactly one migrated Xtream playlist exists, and drops unresolved values after every configured playlist has completed one load.
- Produces: at most 100 finite progress entries, with writes required only after 15 seconds of advancement or lifecycle boundaries.
- Updates: `settings.updatePlaylist` clears personal state only when server or username changes, after incrementing `sourceVersion`. Password and output changes retain personal state.
- Consumes later: library rows resolve favourite snapshots before category data and finite playback reads resume position.

- [ ] **Step 1: Write failing personal state tests**

Cover ordinary string favourites and last channel resolving against the loaded playlist, unscoped Xtream IDs mapping only with one migrated Xtream playlist, ambiguous and unresolved values being dropped at the defined boundary, playlist scoped identities, movie and series snapshots, episode exclusion, 100 entry progress eviction, 15 second persistence threshold, completion removal, server or username account replacement clearing, password or output preservation, playlist clearing and full reset.

- [ ] **Step 2: Run personal tests and verify the expected failures**

Run: `npm test -- tests/personal.test.ts`

Expected: FAIL because the personal store does not exist.

- [ ] **Step 3: Implement the personal store**

Persist only compact records in `services/store`, keep source credentials and stream URLs out, and expose the exact functions above.

- [ ] **Step 4: Run personal tests until they pass**

Run: `npm test -- tests/personal.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing App migration tests**

Prove existing live favourites and resume behavior remain visible after migration, source replacement clears only its own personal state, and another playlist remains unchanged.

- [ ] **Step 6: Replace channel store personal state with `usePersonal`**

Update lineup and App consumers without changing live UI behavior.

- [ ] **Step 7: Run Task 4 tests**

Run: `npm test -- tests/personal.test.ts tests/favourites.test.tsx tests/resume.test.tsx`

Expected: PASS.

### Task 5: Picker Closure and Panel Browse Primitives

**Files:**
- Modify: `src/components/OptionPicker.tsx`
- Create: `src/hooks/useBrowseStack.ts`
- Create: `src/components/ContentSelector.tsx`
- Modify: `src/components/PanelHeader.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/*.ts`
- Modify: `src/App.tsx`
- Test: `tests/onboarding-language.test.tsx`
- Test: `tests/settings-ui.test.tsx`
- Test: `tests/panelNav.test.tsx`
- Test: `tests/keyLaws.test.tsx`

**Interfaces:**
- Produces: `BrowseFrame<T> = { key: string; title: string; items: T[]; cursor: number; state: "loading" | "loaded" | "empty" | "failed"; error?: string }`.
- Produces: `useBrowseStack<T>(root: BrowseFrame<T>)` with `current`, `push(frame)`, `replace(frame)`, `pop()`, `reset(root)` and `setCursor(index)`.
- Produces: `ContentSelector` with `value: "live" | "movie" | "series"`, available values, focus state and translated labels.
- Produces: `HeaderControlId = "content" | "search" | "guide" | "settings"` and an ordered available control list. Guide remains conditionally absent until Task 8, so later work adds availability without widening navigation state.
- Consumes later: library and guide frames use the same stack and RETURN behavior.

- [ ] **Step 1: Write failing picker focus departure tests**

Prove opening either stream format picker and moving focus to the password field closes the listbox and clears `aria-expanded`.

- [ ] **Step 2: Run picker tests and verify the expected failures**

Run: `npm test -- tests/onboarding-language.test.tsx tests/settings-ui.test.tsx`

Expected: FAIL because OptionPicker remains open.

- [ ] **Step 3: Close OptionPicker when focus leaves its root**

Use bubbling focus departure with `relatedTarget` and preserve focus when choosing an option.

- [ ] **Step 4: Run picker tests until they pass**

Run: `npm test -- tests/onboarding-language.test.tsx tests/settings-ui.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing browse stack and header tests**

Cover cursor restoration, one frame RETURN, content kind selection, separate selected and focused styles, M3U header unchanged, Xtream Live default, right to left order, and key law preservation.

- [ ] **Step 6: Run navigation tests and verify the expected failures**

Run: `npm test -- tests/panelNav.test.tsx tests/keyLaws.test.tsx`

Expected: FAIL because browse frames and content selection do not exist.

- [ ] **Step 7: Implement browse stack, selector and header integration**

Match existing One UI surfaces, spacing, focus fills and selected markers. Keep the selector hidden for M3U and keep all header actions reachable with direction keys, OK and RETURN.

- [ ] **Step 8: Run Task 5 tests**

Run: `npm test -- tests/onboarding-language.test.tsx tests/settings-ui.test.tsx tests/panelNav.test.tsx tests/keyLaws.test.tsx`

Expected: PASS.

### Task 6: Movies, Series, Seasons and Episodes

**Files:**
- Create: `src/stores/library.ts`
- Create: `src/components/MediaList.tsx`
- Create: `src/components/MediaDetails.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/*.ts`
- Create: `tests/library.test.ts`
- Create: `tests/library-ui.test.tsx`
- Test: `tests/keyLaws.test.tsx`

**Interfaces:**
- Consumes: Task 2 movie, series and detail functions, Task 4 personal state, and Task 5 browse frames.
- Produces: `useLibrary` with `selectPlaylist(playlist)`, `loadCategories(kind)`, `loadCategory(categoryKey)`, `loadMovie(movieKey)`, `loadSeries(seriesKey)`, `retry(frameKey)` and `clear()`.
- Produces: one library owned in memory `XtreamSession` per playlist identifier and source version. The library authenticates lazily on first movie, series or guide request rather than sharing the channel store controller.
- Produces: state maps keyed by opaque category, movie and series keys with explicit loading, loaded, empty and failed states.
- Produces: `MediaList` as a windowed single column list and `MediaDetails` as a focused Play or Resume detail frame.

- [ ] **Step 1: Write failing library store tests**

Cover lazy movie and series category loading, request deduplication, cancellation on playlist switch, empty category memory, local failure isolation, cache reuse, movie details, series seasons and episodes, exact provider names and favourite snapshots before category load.

- [ ] **Step 2: Run library store tests and verify the expected failures**

Run: `npm test -- tests/library.test.ts`

Expected: FAIL because the library store does not exist.

- [ ] **Step 3: Implement the library store and cache keys**

Keep credentials inside the Xtream session owned by the store, serialise only refetchable provider data, and never let a failed Movies request clear Live or Series.

- [ ] **Step 4: Run library store tests until they pass**

Run: `npm test -- tests/library.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing library UI tests**

Cover content selector switching, category loading row, empty row, failed Retry row, movie detail navigation, series to season to episode navigation, cursor restoration, RETURN order, windowed row count, provider name preservation and loaded category search scope copy.

- [ ] **Step 6: Run library UI tests and verify the expected failures**

Run: `npm test -- tests/library-ui.test.tsx tests/keyLaws.test.tsx`

Expected: FAIL because App has no on demand frames.

- [ ] **Step 7: Integrate library frames into App**

Reuse the panel and stack, keep live channel selection unchanged, and make OK descend or expose Play according to the current item kind.

- [ ] **Step 8: Run Task 6 tests**

Run: `npm test -- tests/library.test.ts tests/library-ui.test.tsx tests/keyLaws.test.tsx`

Expected: PASS.

### Task 7: Finite Playback, Seeking and Resume

**Files:**
- Modify: `src/types.ts`
- Modify: `src/services/player.ts`
- Modify: `src/services/errors.ts`
- Modify: `src/hooks/useTuner.ts`
- Modify: `src/components/PlaybackBanner.tsx`
- Modify: `src/App.tsx`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/*.ts`
- Test: `tests/player.test.ts`
- Create: `tests/tuner.test.tsx`
- Test: `tests/banner.test.tsx`
- Test: `tests/keyLaws.test.tsx`

**Interfaces:**
- Produces: `PlaybackTarget = { id: string; playlistId: string; mode: "live" | "finite"; kind: "live" | "movie" | "episode" | "catchup"; name: string; group: string; logo: string; url: string; resumeAt?: number }`.
- Produces from `Player`: `play(url: string, browserRepair?: boolean, bufferSeconds?: number, mode?: "live" | "finite", startSeconds?: number)`, `getPosition(): number | null`, `getDuration(): number | null`, `seekBy(seconds: number): Promise<boolean>`, `resumePlayback(): void` and retained `resumeLive(url: string)` behavior.
- Produces from `Tuner`: `position`, `duration`, `seek(deltaSeconds)` and finite completion state while preserving existing live methods. Finite targets skip compatibility `prepare`, repair and revalidation.
- Consumes: Task 4 progress and Task 6 movie and episode selections.

- [ ] **Step 1: Write failing player mode tests**

Cover browser and AVPlay duration, forward and backward ten second seek, clamping, positive initial resume seek, unsupported seek, finite pause and resume in place, live pause retuning to the live edge, finite completion, live ended error behavior, finite compatibility bypass, browser HLS through hls.js, finite MP4 through native video, unsupported finite containers using the format error, and the stall watchdog remaining suspended while a seek callback is pending.

- [ ] **Step 2: Run player tests and verify the expected failures**

Run: `npm test -- tests/player.test.ts tests/tuner.test.tsx`

Expected: FAIL because finite playback APIs do not exist.

- [ ] **Step 3: Implement player and tuner mode behavior**

Use native media `currentTime` in browsers and documented AVPlay `getDuration`, `seekTo`, `jumpForward` and `jumpBackward` methods where available. Route live HLS through hls.js and finite nonplaylist URLs directly to the video element. Apply initial AVPlay seek in IDLE before prepare, suspend watchdog measurement while a seek is pending, bypass compatibility repair for finite targets, map unsupported format and seek failures in `services/errors.ts`, keep the live retry path unchanged, and stop retrying a completed finite target.

- [ ] **Step 4: Run player tests until they pass**

Run: `npm test -- tests/player.test.ts tests/tuner.test.tsx`

Expected: PASS.

- [ ] **Step 5: Write failing finite banner and App tests**

Prove elapsed and duration text appears only for finite playback, transport keys seek finite targets, STOP restores the launching frame, resume begins at saved position, progress saves at the required boundaries, and all existing picture key laws remain true.

- [ ] **Step 6: Run UI playback tests and verify the expected failures**

Run: `npm test -- tests/banner.test.tsx tests/keyLaws.test.tsx tests/library-ui.test.tsx`

Expected: FAIL until App and the banner consume finite state.

- [ ] **Step 7: Integrate finite playback and progress**

Convert selected movie and episode records to `PlaybackTarget`, restore the launching frame on STOP or completion, and persist progress through Task 4 functions.

- [ ] **Step 8: Run Task 7 tests**

Run: `npm test -- tests/player.test.ts tests/tuner.test.tsx tests/banner.test.tsx tests/keyLaws.test.tsx tests/library-ui.test.tsx tests/personal.test.ts`

Expected: PASS.

### Task 8: Programme Guide and Catchup

**Files:**
- Modify: `src/stores/library.ts`
- Create: `src/components/GuideList.tsx`
- Modify: `src/components/PanelHeader.tsx`
- Modify: `src/components/PlaybackBanner.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/*.ts`
- Create: `tests/guide.test.ts`
- Create: `tests/guide-ui.test.tsx`
- Test: `tests/banner.test.tsx`
- Test: `tests/keyLaws.test.tsx`

**Interfaces:**
- Consumes: Task 2 guide and catchup builders, Task 5 browse frames, and Task 7 finite playback.
- Produces from `useLibrary`: `loadGuide(channel: Channel)`, `guideFor(channelId: string)` and short lived in memory guide state.
- Produces: `GuideList` with chronological programme rows and Play from start only for valid archived programmes.

- [ ] **Step 1: Write failing guide store tests**

Cover current and next selection, malformed base64 fallback, archive duration boundaries, future programme behavior, request cancellation on focus changes, short lived memory cache and catchup target construction.

- [ ] **Step 2: Run guide tests and verify the expected failures**

Run: `npm test -- tests/guide.test.ts`

Expected: FAIL because guide state does not exist.

- [ ] **Step 3: Implement guide state and catchup targets**

Fetch playing channel programme data immediately after live playback starts, fetch focused channel data only after focus settles, and create finite targets only when programme archive data is complete.

- [ ] **Step 4: Run guide store tests until they pass**

Run: `npm test -- tests/guide.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing guide UI tests**

Cover Guide header visibility for Xtream live, focus routing, chronological rows, readable nonplayable programmes, catchup Play from start, RETURN to the same live row, now and next banner text, loading, empty, failed and Retry states.

- [ ] **Step 6: Run guide UI tests and verify the expected failures**

Run: `npm test -- tests/guide-ui.test.tsx tests/banner.test.tsx tests/keyLaws.test.tsx`

Expected: FAIL because Guide is not rendered.

- [ ] **Step 7: Integrate Guide and catchup playback**

Keep Guide hidden for M3U and nonlive content, preserve title bar navigation order in both directions, and return catchup STOP or completion to the programme frame.

- [ ] **Step 8: Run Task 8 tests**

Run: `npm test -- tests/guide.test.ts tests/guide-ui.test.tsx tests/banner.test.tsx tests/keyLaws.test.tsx`

Expected: PASS.

### Task 9: Device Management, Account Status and Credential Cleanup

**Files:**
- Modify: `src/services/remoteProtocol.ts`
- Modify: `public/remote/remote.js`
- Modify: `public/remote/index.html`
- Modify: `public/remote/remote.css`
- Modify: `src/components/settings/Playlists.tsx`
- Modify: `src/services/repair.ts`
- Modify: `src/stores/channels.ts`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/*.ts`
- Test: `tests/remoteProtocol.test.ts`
- Test: `tests/remoteWeb.test.ts`
- Test: `tests/settings-ui.test.tsx`
- Test: `tests/repair.test.ts`

**Interfaces:**
- Consumes: Task 1 typed remote sources and Task 2 account status.
- Produces: safe account summary fields for Settings and device state without password or stream URLs.
- Produces: playlist removal and account replacement cleanup for Xtream cache entries, repair diagnoses, favourites, last played state and progress.

- [ ] **Step 1: Write failing credential boundary tests**

Prove snapshots, status payloads, diagnostics, errors, cache keys and repair diagnosis keys contain no password or generated Xtream stream URL. Prove blank remote password preserves the current password and a supplied password replaces it.

- [ ] **Step 2: Run credential tests and verify the expected failures**

Run: `npm test -- tests/remoteProtocol.test.ts tests/remoteWeb.test.ts tests/repair.test.ts`

Expected: FAIL where legacy URLs or repair keys still carry credentials.

- [ ] **Step 3: Implement safe remote and cleanup boundaries**

Use typed command data, source scoped cache and repair identifiers, remove duplicated Xtream URL parsing from the device page, and keep the trusted local network security statement accurate.

- [ ] **Step 4: Run credential tests until they pass**

Run: `npm test -- tests/remoteProtocol.test.ts tests/remoteWeb.test.ts tests/repair.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing account status UI tests**

Cover active, trial, expiry, unknown expiry, active connections, inactive and expired states with translated copy and no credential display.

- [ ] **Step 6: Add account status to saved playlist details**

Keep status secondary to activation and management actions. Do not block an already loaded cache solely because status fields are missing.

- [ ] **Step 7: Run Task 9 tests**

Run: `npm test -- tests/remoteProtocol.test.ts tests/remoteWeb.test.ts tests/settings-ui.test.tsx tests/repair.test.ts`

Expected: PASS.

### Task 10: Large Catalogue Fixture, Documentation and Final Verification

**Files:**
- Modify: `scripts/present.mjs`
- Modify: `scripts/tv/harness.mjs`
- Modify: `docs/design.md`
- Modify: `docs/testing.md`
- Modify: `README.md` only for user facing Xtream capabilities and browser limitations
- Modify: `AGENTS.md` only where the existing cache budget statement must match the implementation
- Test: `tests/harness.test.ts`
- Test: relevant existing suites selected below

**Interfaces:**
- Consumes: every preceding task.
- Produces: deterministic Xtream fixture routes and a TV journey covering live, movie, series and cached category revisit.
- Produces: authoritative user guidance for supported Xtream content and browser transport limitations.

- [ ] **Step 1: Write failing harness tests**

Cover a fixture with thousands of live summaries, large movie and series category responses, duplicate category names, empty categories, movie details, episodes, EPG and catchup. Assert fixture endpoints filter by category and never expose real credentials.

- [ ] **Step 2: Run harness tests and verify the expected failures**

Run: `npm test -- tests/harness.test.ts`

Expected: FAIL because the Xtream fixture and journeys do not exist.

- [ ] **Step 3: Implement fixture and TV journeys**

Measure launch to live rows, a held rail walk, first category load, loaded category revisit, movie detail, series episode navigation, live search and heap growth. Reuse existing budget thresholds unless measurement proves a dedicated threshold is necessary.

- [ ] **Step 4: Run harness tests until they pass**

Run: `npm test -- tests/harness.test.ts`

Expected: PASS.

- [ ] **Step 5: Update user and engineering documentation**

Document supported live, movie, series, EPG and catchup behavior, browser HTTPS and Cross Origin Resource Sharing limits, exact remote navigation, cache policy, finite playback semantics, source security boundary and on set verification. Correct the stale cache budget statement from 5 MB to the implementation value.

- [ ] **Step 6: Run changed file lint**

Run: `npm run lint -- <all changed TypeScript and TSX files>`

Expected: PASS.

- [ ] **Step 7: Run complete application checks**

Run: `npm run check`

Expected: PASS with every test file and no type or lint failure.

- [ ] **Step 8: Build and run television gates**

Run: `npm run build && npm run tv:gap && npm run tv:engines && npm run tv:budget`

Expected: build, gap and engine gates pass. Budget output must be read with its machine load and must show no relevant regression.

- [ ] **Step 9: Run repository integrity checks**

Run: `git diff --check` and inspect the complete diff, generated bundle composition, source credentials, dead code, duplicate logic and untracked files.

Expected: no whitespace errors, credentials, temporary artifacts, dead compatibility paths or unrelated changes.

- [ ] **Step 10: Perform real television verification when a paired set is available**

Verify live HLS, live MPEG TS, one movie, one episode, one catchup programme, ten second seeking, pause and resume, STOP return, browser limitation copy and an M3U regression journey. This procedure informs release confidence and does not block the pull request when hardware is unavailable.

## Final Review Loop

After Task 10, dispatch independent reviewers for repository rules, source migration, protocol correctness, request races, identity and personal state, One UI navigation, finite playback, credential boundaries, Chromium 69 compatibility and performance. Validate every finding against code and tests. Fix confirmed findings with a failing test first, rerun the scoped reviewer, and repeat until no validated merge blocker remains or five rounds have been adjudicated according to the subagent development breaker.
