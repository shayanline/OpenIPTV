# Working on OpenIPTV

An IPTV player for Samsung Tizen TVs, and the same build runs in a desktop browser. It ships
with no channels: the viewer adds an extended M3U address and the app plays what that playlist
contains, without interpreting or rewriting any name, group or country.

React 19, TypeScript, zustand, Vite, Biome, Vitest. hls.js only on the browser path. No other
runtime dependencies, and adding one is a decision rather than a detail: it is compiled and run
by a 2020 television every time somebody switches the set on.

Node 22.18 or newer, pinned in `.nvmrc`.

## README audience

`README.md` serves repository visitors and people deciding whether to install and use OpenIPTV. Lead with product value, screenshots, supported playlist sources, the easiest installation path, and concise guidance that helps someone start watching.

Keep implementation decisions, internal architecture, cache and retry timing, socket lifecycle, and engineering rationale in [the design notes](docs/design.md), [the testing notes](docs/testing.md), source code, or contributor documentation. Include technical detail in the README only when a user needs it to try, install, configure, or recover the application. Use GitHub links, alerts, tables, keycaps, and collapsed details when they make the user path faster to scan.

## Changelog

Keep each release entry as a short, flat list of the major user facing changes. Use complete sentences, and omit minor interface details and implementation mechanics.

Cover the full change since the previous released version by checking its release reference, subsequent commits and pending work. Preserve existing release history.

## Verification

Verification is a separate final phase that starts only after the task author approves the finished implementation. Do not run verification commands during implementation, including lint, type checks, tests, builds, TV gates, WebAssembly checks, XML validation, or `git diff --check`. Reading files and reviewing the diff while editing do not replace final verification.

1. When implementation is ready, describe the changes as unverified and awaiting approval. Ask the task author, "Is the task finished and approved for final verification?", then wait for explicit confirmation before running checks. Do not infer approval from the original task request or your own assessment that implementation is complete.
2. After approval, select and run the final checks justified by the changed files and behavior, using the rules below.
3. Fix issues introduced by the task during final verification, then rerun failed checks and any passing checks invalidated by the fixes. If remediation changes the approved behavior or adds scope, obtain the author's approval again before resuming verification.
4. Do not commit, push, open a pull request, or report the task as verified and complete until all required checks pass. Approval to begin verification does not grant permission to commit or push.

### Final Check Selection

Choose checks from the changed files and behavior. Start with the smallest check that can detect a regression, then widen only when the impact cannot be mapped safely or a relevant failure indicates a broader problem. Do not run a check only because it exists. Select the checks and apply the deduplication rules from the selection table in [testing and measurement](docs/testing.md), which is the single source for what each kind of change requires. All checks in that table belong to the approved final verification phase.

Do not repeat a passing check unless later edits could invalidate it. Do not expand the task to fix an unrelated existing failure. Confirm the failure against the unchanged baseline when practical, then report it as a blocker rather than claiming verification passed. Inspect the complete diff and run `git diff --check` during final verification. Before reporting verified completion, state which checks ran and which checks were skipped, with a short reason.

The three `tv:` gates are the checks that speak for hardware nobody here has. Details of what each measures and how to read it are in [testing and measurement](docs/testing.md).

## Running it

`npm run dev` serves the app on port 5173, where the arrow keys and Enter share key codes with
the remote, so the whole interface is usable from a keyboard. `?remote` in development summons a
floating Smart Remote with the D-pad, the transport keys, the coloured keys and the number pad. It
dispatches the same key events the TV sends rather than calling handlers directly, and the bundler
drops it from a production build, so it cannot be conjured onto a television.

`npm run tv` runs the built app with the estimated Everyday TV performance profile and Tizen APIs shimmed. `npm run tv:floor` retains the original floor as a separate performance comparison. Both CPU workloads are calibrated on the current host. `npm run tv:engines` verifies browser compatibility independently. Hardware assumptions and measurement limits are documented in [testing and measurement](docs/testing.md).

`npm run tv:quick` gives a short sample of Live navigation, VOD grid and cached startup against the same UX goals. Its verdict covers only that sample. It runs only inside the approved final verification phase, and `npm run tv:budget` remains the complete functional and performance gate.

`npm run tv:on-set` measures the app on a real television over sdb: the launch marks, the CPU at
rest, and, given `--stream=<url>`, what a picture costs and whether the playhead actually moves.
It is the only thing here that reports the real AVPlay rather than a shim, so it is what to reach
for when a stream plays on a laptop and not on a set. It needs a paired TV in developer mode, so
it is not a gate and never runs in CI.

## Layout

```
src/
  App.tsx                  the surface stack, tuner and application mode ownership
  screens/LiveScreen.tsx   the Live picture, Guide and current panel ownership
  screens/VodScreen.tsx    the opaque Movies and Series shell, search and details ownership
  components/vod/          category rail, poster grid, title row, details and episode panel
  types.ts                 Channel, and the shapes the parser produces
  meta.ts                  the repository URL, and the version Vite injects from package.json
  services/m3u.ts          playlist parser, tolerant of the ways M3U is abused
  services/lineup.ts       which lists exist, and where channel up and down land
  services/lineupProtocol.ts strict revision bound phone lineup queries and mutations
  services/search.ts       ranked matching over the whole playlist, capped per rank
  services/player.ts       one interface over AVPlay and hls.js
  services/errors.ts       engine error codes to something a viewer can act on
  services/playlistUrl.ts  what cannot possibly be a playlist address, checked offline
  services/deviceAccess.ts pairing sessions and authorised device credentials
  services/remoteProtocol.ts the state and commands exposed through remote access
  services/remoteServer.ts the private network server lifecycle and API boundary
  services/manifest.ts     reading and repairing a playlist, as pure functions
  services/repair.ts       serving a repaired playlist to AVPlay over a loopback socket
  services/artwork.ts      bounded poster and logo queues, bitmap limits and backdrop leases
  services/workload.ts     device hints, adaptive artwork limits and owned frame sampling
  services/logos.ts        the channel logo adapter over the shared artwork service
  services/capabilities.ts what the engine can actually do, measured rather than assumed
  services/metrics.ts      the measurements the stylesheet shares with the code
  services/store.ts        localStorage, for the short strings needed before first paint
  services/disk.ts         IndexedDB, for playlists, Xtream catalogues and logos, on a 24 MB budget
  services/personalDisk.ts durable personal lineup records without cache eviction
  services/idle.ts         work that must never be why a key press waits
  stores/channels.ts       provider loading, cache and account ownership
  stores/lineup.ts         overlays, reconciliation, effective views, revisions and rollback
  stores/library.ts        VOD resources, synthetic categories, stale refresh and progress resolution
  stores/settings.ts       everything the viewer can change, persisted
  hooks/usePlaybackController.ts the player's life, channel changing, seeking, automatic retry
  hooks/useChrome.ts       the banner, messages and dialled digits, and their timers
  hooks/useRemote.ts       remote key codes, and registering them with Tizen
  hooks/useSpatialNav.ts   four directional focus movement over arbitrary controls
  hooks/useWindowed.ts     renders list rows and complete six column poster row windows
  hooks/useVodNavigation.ts VOD cursors, origins, settle timers and wheel input guard
  hooks/useViewport.ts     the measured height a windowed list is laid out against
  hooks/usePointerAwake.ts whether a pointer is in use, for the on screen pad
  hooks/useRemoteAccess.ts the local remote access server state for React
  components/              panels, dialogs, and the debug Smart Remote
wasm/manifest-socket.c     the loopback HTTP server, built with Samsung's Emscripten fork
wasm/management-socket.c   the private network HTTP server for authorised devices
public/wasm/               the built modules and the workers that own their sockets
public/remote/             the static remote access and management interface
  components/settings/     one file per section of the settings sheet
  styles/                  the whole stylesheet, tokens then app, since no component has one
scripts/
  package.sh               build and sign
  deploy.sh                build, install over sdb and launch
  icon.mjs                 redraw public/icon.png from public/icon.svg
  wasm-check.mjs           the committed WebAssembly still holds together, without the toolchain
  present.mjs              the invented playlist, and the server, that both picture scripts share
  store-assets.mjs         the six pictures Samsung's store form asks for, from the real build
  screenshots.mjs          the six pictures in the README, from the real build
  stamp-version.mjs        write package.json's version into config.xml at package time
  tv/                      run the app under documented TV approximations
  tv/platforms.json        Samsung's engine matrix, the only copy of it
  tv/floor.json            base TV facts, estimated CPU target and resource stress limits
  tv/profile.json          what the reference set reports about itself, rewritten by calibrate
  tv/harness.mjs           serve the build, walk every screen, measure the boxes
  tv/gap-parity.mjs        spacing is the same with and without flex gap
  tv/engine-parity.mjs     behaviour is the same on Chromium 69 and 120
public/config.xml          the Tizen widget manifest, privileges and CSP
```

## Invariants

The app language owns text and layout direction across the television and remote interface. Provider names, categories, descriptions, subtitles and viewer entered names inherit that direction without `dir="auto"` or content based direction detection. Preserve their spelling. Fixed protocol values such as URLs and pairing codes may retain an explicit LTR direction, but they must never set the direction of a surrounding layout.

Break one of these and the app fails on hardware no test here owns. The reasoning is in
[the design notes](docs/design.md) and at length in the source.

- **The screen is a stack and a surface only shows when nothing above it is open.** `App.tsx` names the five levels and resolves the active surface. A new focus owning surface belongs in that stack or nowhere. The highest open focus owning surface receives input, and `LiveScreen.tsx` delegates Live keys to exactly one of Guide, panel or picture.
- **The key model is mode specific.** At the uncovered Live picture, up and down always change channel, Left and OK open the Live browser, and Right opens the playback deck. At the uncovered finite picture, Left and Right quick seek, OK opens the deck, and up and down deliberately do nothing. Physical transport keys keep their semantic meaning on every surface. RETURN always goes back, and closes the app only when there is nothing left to close. `tests/keyLaws.test.tsx` enforces the Live contract.
- **The three storage roles are distinct.** `services/store` keeps short launch values in synchronous localStorage. `services/disk` keeps refetchable catalogues and artwork in the budgeted `openiptv` IndexedDB cache. `services/personalDisk` keeps durable lineup overlays in `openiptv-personal`, which has no cache eviction and is never cleared by cache clearing.
- **Provider catalogues remain immutable.** `stores/lineup` reconciles sparse personal overlays, then publishes the only Live category, channel, search, channel change and number index views that presentation may consume. Launch reads the cached catalogue and personal record together, so provider order never appears before personal order. Television management and paired phone management both call `applyLineupMutation`, while the effective number index owns dialling.
- **No IndexedDB work occurs on a direction input path.** Interaction handlers read materialised arrays, sets and maps. Committed personal writes and cache work use `services/idle`, while a failed personal transaction restores the latest durable lineup revision and retains a recoverable management error. Playlist owner changes, removal and reset invalidate queued work, drain its promises and wait for an active write before destructive cleanup. Legacy settings disappear only after the replacement personal record commits.
- **The cursor answers the press, the expensive work follows.** The rail waits 150ms before the channel column rebuilds, and search waits 150ms before it queries. An ordinary channel press commits after feedback can paint without waiting for release. Held repeats coalesce until release, with a 450ms fallback when no release arrives. Anything expensive added to a held key needs the same treatment.
- **VOD category focus is immediate.** Catalogue replacement settles after 150ms, while normal poster requests wait for the usual 120ms poster permission. Only bounded preparation of the first 18 nearby posters in the committed grid window can begin before that permission. Each accepted vertical wheel gesture moves one item in linear order before the 120ms wheel guard begins.
- **VOD never keeps a hidden provider connection.** Entering Movies or Series stops playback and releases the decoder, while returning to Live retunes the remembered channel through the playback controller.
- **The 24 MiB disk cache has isolated classes.** Playlist and catalogue data use 12 MiB, poster derivatives use 8 MiB, and logo derivatives use 4 MiB. One class cannot evict another. Cache clearing never clears `openiptv-personal`.
- **Phone lineup state stays bounded and revision bound.** Ordinary remote snapshots contain only active lineup readiness and revision. Queries default to 50 items and reject limits above 100. Every cursor binds playlist, revision, scope, category, search and hidden inclusion. A stale page or mutation returns the current revision and a fresh bounded snapshot, while repeated mutation request identifiers return their first result.
- **Television fault controls exist only in the simulator shim.** `window.__openiptvTvFaults` can control prepare completion, buffering, playhead progress, seeks, faults, Live windows and visibility after a harness opts in. Production code does not create this interface.
- **Cached playlists are keyed by address**, not by playlist id, or editing a URL serves the
  previous playlist from a cache that believes itself current.
- **One artifact, no branching by model year.** The build targets es2019 and the stylesheet uses nothing newer than Chromium 69, so every later set runs a strict superset. The flex gap probe remains the layout compatibility branch covered by `tv:gap`. Artwork workload limits adapt through one shared scheduler using available hardware hints and observed responsiveness, while retaining the same hard resource ceilings. Additional engine specific behavior needs coverage in the engine matrix.
- **esbuild lowers syntax and not methods**, so `?.` is safe on an old engine and `Array.at`
  would ship and throw. `tv:engines` is what catches that.
- **`scripts/tv/platforms.json` is the only place the engine matrix is written down.** Do not
  restate it in prose. It was in three files and two of them were a year and an engine wrong.
- **Nothing interprets playlist content.** Names, groups and languages appear exactly as the
  file writes them. No bundled channels, no analytics, no network calls beyond the playlist,
  the streams and the logos.
- **Compatibility mode is off by default and must stay opt in.** It exists for one firmware
  defect: AVPlay holds a playlist's media sequence in a *signed* 32 bit integer, so a packager
  numbering segments from a microsecond clock overflows it and the channel shows one frame and
  stops. The repair means serving a corrected playlist to the set's own player over a loopback
  socket, which is real machinery, so the ordinary path must never touch it. Three rules keep
  that true: it stays opt in, `needsRepair` answers yes for that one defect only, and a broken-host
  verdict is remembered per host so nobody pays the same diagnosis twice. When enabled, the selected
  playlist is checked before tuning so a broken channel does not show one frame and stall. The same
  check measures segment duration, including variant playlists, and gives AVPlay enough initial
  buffer without changing the source URL for healthy streams. Healthy verdicts are remembered per
  playlist address in a bounded cache, then revalidated with HTTP validators or a fresh manifest
  comparison.
- **Each socket has one owner, and neither owner may control the other's socket.** `services/repair`
  exclusively owns the ephemeral loopback manifest socket and closes it when repair is not needed.
  `services/remoteServer` exclusively owns the fixed private network management socket and closes it
  before terminating its worker. A worker terminated without closing leaves its platform socket held
  for the life of the app.
- **A new runtime dependency has to be written into `public/THIRD-PARTY-NOTICES.md` by hand.** That
  file and the licence texts beside it are in `public/` rather than the repository root on purpose,
  because Vite copies that directory verbatim and the obligation is toward whoever installs the
  widget rather than whoever reads the source. hls.js is Apache-2.0 and its notice does not survive
  minification, so nothing else carries it.
- **`public/config.xml` must stay well formed XML**, or the Tizen CLI will not package it and
  nothing else parses the file. CI parses it and fails on anything malformed. `object-src 'self'`
  in the CSP is load
  bearing: the AVPlay picture is a hardware plane bound to an `<object>`, and `'none'` gives
  sound with no picture.

## Things that have wasted time here

- **Never assert a DOM node against null with `node:assert`.** `assert.equal(queryByText(x),
  null)` sends assert off to serialise a jsdom element for its diff, which exhausts the worker's
  memory and kills it with exit 137: no stack trace and no failing test name. Assert on
  `textContent`, or on a boolean.
- **A gate that reads state it did not write will fill in blanks instead of failing.**
  `--playlist` used to be ignored whenever the simulator's profile already had one, so runs
  measured a playlist nobody had asked for and said nothing about it. Look for that shape
  anywhere the harness reads something it did not just set.
- **A phase reporting "window was hidden, nothing measurable here" usually means no playlist.**
  No frames looks the same either way.
- **Piping a long run through `grep` into a file block buffers it**, so a hanging run looks the
  same as a quiet one. Write the full output per run and extract afterwards.
- Treat exceeded performance budgets as failures. Load average alone does not establish their cause or justify dismissing them as noise. Investigate with a controlled baseline comparison under identical simulator settings.
