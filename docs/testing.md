# Testing and measurement

Automated checks cover application behavior, browser compatibility and layout. TV performance requires measurements on physical hardware. Desktop diagnostics do not provide a TV performance verdict.

The engine compatibility gate first opens the built widget through a `file:` address and requires the interactive welcome form to render without a module entry script. Its HTTP fixture journeys then cover the configured application. This filesystem smoke check guards against widget MIME failures that an HTTP server masks, but it does not replace installation on a real set.

## Choosing local checks

Builds and packaging do not require approval, including native compilation, generated build artifacts and type checks invoked by a build. Run other verification commands only after explicit final approval under the verification rules in [AGENTS.md](../AGENTS.md). When approval is given, run the union of the checks the changed files justify rather than every row in this table.

| What changed | What to run |
|:--|:--|
| Documentation, comments, badges, links or prose | Inspect the diff, the rendering, the links, the spelling and every command and example it gives. No application checks are needed. |
| TypeScript or TSX | `npm run lint -- <changed files>`. Add `npm run typecheck` for production TypeScript or shared test types. Run the related test files only when behavior or test code changed. |
| Entry points, application wiring, imports that alter packaging, compiler or bundler configuration, dependencies, generated assets, public contracts, or several connected areas | `npm run build`. The build is also the prerequisite whenever any selected `tv:` gate needs a `dist/`. |
| Spacing, layout, flex gap fallbacks, or rendered component structure | `npm run tv:gap`, after the build. |
| Runtime APIs, browser compatibility, the build target, application wiring, or behavior that could differ across engines, including layout and CSS changes that may render differently between them | `npm run tv:engines`, after the build. |
| Launch work, interaction paths, rendering volume, windowing, caching, or other performance behavior | Run related behavior tests. Select `npm run tv:bench` or targeted profiling only when desktop diagnostics can answer a specific question. Validate performance claims on a real set. There is no simulated TV performance gate. |
| `wasm/`, `public/wasm/`, its worker, the checksums, or the repair integration | `npm run wasm:check`. It needs no application build unless runtime assets or wiring also require one. |
| `public/config.xml` | `python3 -c "from xml.dom.minidom import parse; parse('public/config.xml')"`. No application build is needed unless something else justifies one. |
| Test files only | Lint the changed test files and run the related tests. No production typecheck or build is needed unless shared types, configuration, fixtures or contracts require it. |
| A broad change, an impact that cannot be mapped safely, or an explicit request for everything | Run `npm run check` when no build is needed. When a build is justified, run `npm run lint`, `npm test` and `npm run build` once each. Add only the TV gates justified by the rows above. |
| Benchmark or test harness code | The check or checks that exercise the changed harness, not the whole suite by default. |

### Reusing results

`npm run check` is lint, typecheck and the entire Vitest suite in one command, so do not also run those parts separately over the same unchanged inputs. `npm run build` includes the typecheck, so when a build is justified choose it instead of a standalone `npm run typecheck`. When the change justifies broad verification and a build, run `npm run lint`, `npm test` and `npm run build` once each rather than `npm run check` on top of a build. When it justifies broad verification and no build, run `npm run check` once.

An isolated parser change, for example a fix inside `src/services/m3u.ts` alone:

```bash
npm run lint -- src/services/m3u.ts
npm run typecheck
npm test -- tests/m3u.test.ts
```

No build and no `tv:` gates are needed unless other changes in the same diff warrant them. When the edited module feeds other tested consumers, select the test files for those consumers as well.

Reuse one `dist/` for every selected `tv:` gate and rebuild only when build inputs change. Do not reinstall dependencies between checks: `npm ci` belongs to the initial setup, to missing or stale dependencies, and to lockfile changes. A passing result stays valid until a relevant input changes, which covers code, tests, configuration, dependencies, the environment, and generated artifacts.

After a fix, rerun the checks that failed and the checks the fix could have invalidated, and do not restart the whole sequence. Routine remediation inside the approved scope does not need approval again, because the numbered approval steps in AGENTS.md already cover changes to scope or behavior. Record each check, its result and the input state it ran against briefly in the final handoff. No separate ledger or tooling is needed.

### Selecting benchmarks

`npm run tv:bench` walks the complete desktop diagnostic and functional journeys. `npm run tv:quick` samples Live navigation, a VOD grid and cached startup with fewer repetitions. Neither applies timing or heap acceptance thresholds. Select them after approval when investigating their covered behavior or changing the harness. They are not routine prerequisites for every application change.

`npm run tv:engines -- --all` is not routine. `npm run tv:on-set` remains a hardware diagnostic that desktop tools cannot replace and CI does not require. The estimated hardware profiles, CPU calibration and `tv:budget` commands have been removed.

Historical implementation plans may still name the retired budget commands. Those verification steps are superseded by this document.

Default diagnostics route browser HTTP requests through a local proxy that only forwards to the owned application and fixture origins. It refuses other destinations, HTTPS tunnels and the preview server's HTTP relay before any upstream connection, including requests from workers. Fonts and built assets remain on the local application origin. Playlist data, artwork and Xtream responses come from local fixtures, while AVPlay uses a state and clock shim. Generated PNG variants and the public playlist snapshot are prepared before measurement. The snapshot SHA256 is recorded with the build identity. Local request handling, response parsing and image decoding remain included. None reproduces a provider connection, TV storage or a native decoder.

Both diagnostic drivers record allowed origins, request counts and blocked destinations. The browser must demonstrably use the proxy for both owned origins. Blocked Chrome startup requests are retained separately before application navigation. Any unexpected destination after that navigation invalidates isolated results. Explicit `--real-logos` or `--video` options disable isolation and are labelled as unrestricted diagnostics. Do not compare them with isolated fixture runs.

Use a versioned [Chrome for Testing download](https://googlechromelabs.github.io/chrome-for-testing/) for isolated desktop diagnostics. Set `CHROME` to its absolute executable path, then run `npm run tv:bench -- --chrome="$CHROME"`. Record the version, revision, architecture and download source. Retain the browser for comparisons. The simulator creates a fresh temporary diagnostic profile. Branded Chrome can initiate delayed background requests despite networking controls. Browser selection does not replace the separate engine compatibility gate.

The isolated launcher disables Chrome's network time, search preconnections, AI Mode eligibility, cast discovery, autofill communication, translation and optimisation services, together with background extensions and default apps. It also enables the upstream fix that skips Google account discovery in a fresh profile without Gaia cookies. These are browser services outside the application workload. The reasons for the switches are documented in the [upstream browser networking investigation](https://github.com/microsoft/playwright/issues/42910) and the [Chrome automation flag reference](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md). The proxy remains the enforcement boundary even if a future Chrome version changes those switches.

Safe Browsing real time hash lookups are also disabled in the dedicated measurement profile. Their OHTTP key service otherwise retries a public key download every minute after the proxy refuses it. This temporary browser can only reach the owned local origins, and the setting does not affect the Development browser profile or the shipped application.

The fresh measurement profile also sets secure DNS mode to `off` before launch because automatic DNS over HTTPS probes can bypass the HTTP proxy. Initialization refuses to overwrite an existing `Local State` file. Everyday browser preferences and system DNS settings remain unchanged.

### Keeping the source identical across runs

The default public playlist cache refreshes after a day, which can change the workload between runs. For a controlled desktop comparison, retain one public snapshot outside the repository and use `--playlist`. A content hash in the source address gives different bytes a different cache ownership key. Do not replace the file during a comparison.

```bash
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openiptv-benchmark-source.XXXXXX")"
curl --fail --location --output "$FIXTURE_DIR/playlist.m3u" \
  "https://iptv-org.github.io/iptv/index.m3u"
SNAPSHOT_SHA="$(shasum -a 256 "$FIXTURE_DIR/playlist.m3u" | cut -d ' ' -f 1)"
mv "$FIXTURE_DIR/playlist.m3u" "$FIXTURE_DIR/$SNAPSHOT_SHA.m3u"
chmod 444 "$FIXTURE_DIR/$SNAPSHOT_SHA.m3u"
printf 'SNAPSHOT_URL=http://127.0.0.1:4195/%s.m3u\n' "$SNAPSHOT_SHA"
python3 -m http.server 4195 --bind 127.0.0.1 --directory "$FIXTURE_DIR"
```

After the server reports that it is ready, use the printed `SNAPSHOT_URL` assignment in another terminal and set `CHROME` to the retained Chrome for Testing executable. With the production app served, use the same snapshot for each comparison. Check its digest before and after the diagnostic, then retain the raw file with the results.

```bash
set -o pipefail
curl --fail --silent "$SNAPSHOT_URL" | shasum -a 256
npm run tv:bench -- --playlist="$SNAPSHOT_URL" --chrome="$CHROME"
curl --fail --silent "$SNAPSHOT_URL" | shasum -a 256
```

The simulator acquires this source before timing. It still seeds the application's owned fixture address, so the playlist names, groups, Live workload, substituted artwork and Xtream Movie, Series and management journeys remain unchanged. The extra source server does not add a browser network origin or relax the measurement proxy.

### Profiling VOD

`npm run tv:profile:vod -- --url=http://127.0.0.1:4183/ --port=9433 --moves=12 --chrome="$CHROME"` profiles initial VOD loading and the twelve move grid walk on the desktop host. Set `CHROME` to the retained Chrome for Testing executable. It uses a production build, the AVPlay state shim and the Xtream fixture without automatic CPU or memory constraints. Add `--cpu=4` only for an explicitly labelled desktop stress experiment. The committed category check, three second setup settling period, 100 ms dispatch pause and 600 ms tail match the complete diagnostic. Both drivers record category readiness on the browser clock after the DOM barrier, which includes polling and protocol overhead. Output goes to a unique temporary directory, or a unique child of the existing parent passed with `--output`.

The profiler captures JavaScript stack samples at a requested 1000 microsecond interval together with rendering events from `toplevel,devtools.timeline,blink.user_timing,v8`. Open `rendering.trace.json` in Chrome DevTools Performance and select the renderer thread identified in `measurements.json`. The `vod-category-start`, `vod-category-end`, `vod-grid-start` and `vod-grid-end` marks bound the measured phases. Add `--details=true` to profile opening the selected movie after the grid walk, with `vod-details-start` and `vod-details-end` marks. Its title row readiness check and 600 ms tail match the complete diagnostic. Setup between those marks is outside the phase metrics. Raw callback intervals, input timestamps, cursor movements and response boundaries in `measurements.json` correlate slow samples with the trace. The mark's trace timestamp and `args.data.startTime` map page milliseconds to trace microseconds. Add `--screenshot=true` to capture the final screen outside the measured phases.

Open `cpu.cpuprofile` in the JavaScript profiler for stack inspection. These samples are not CPU utilisation, and `(program)` cannot be assigned to application JavaScript. Some Chrome versions produce backward sample deltas. Reconstruct absolute timestamps and sort samples before aggregating costs instead of summing those deltas as durations. Trace durations are desktop wall time and include any explicitly requested throttling. Use exclusive intervals or their union when attributing nested rendering events. Browser native work and time without a usable stack must remain separately labelled.

Profiling and the optional `--commits=true` React diagnostic add overhead. Add `--invalidations=true` to attribute style and layout work to DOM changes, with additional tracing overhead. Add `--capture=false` to run without CPU sampling or tracing while retaining raw journey observations. The profiler rejects incomplete traces, network violations and incomplete grid walks. It never evaluates TV performance. Keep timed runs isolated from other tests, builds and rendering workloads.

### What CI does

CI runs the full set on code changes. One job installs dependencies and runs `npm run lint`, `npm test`, `npm run build`, the `public/config.xml` validation, the WebAssembly checks and `npm run tv:gap`. The build includes the typecheck. The engines job installs and builds independently. There is no performance budget job. Documentation pushes skip CI. Every pull request reports a `changes` check, which skips application jobs when all current and previous paths are Markdown, under `docs/`, or issue templates. `workflow_dispatch` still runs the jobs deliberately.

Dependabot patch and minor updates use native GitHub auto merge. A grouped update qualifies only when every dependency has an eligible update type. Only a single verified Dependabot commit is eligible because the pinned metadata action reads the first commit. Major updates, manually changed pull requests, and unavailable metadata remain available for manual review. Before setting the repository variable `DEPENDABOT_AUTO_MERGE_ENABLED` to `true`, protect `master` with required GitHub Actions checks `changes`, `check`, `engines`, `dependencies`, and `dependabot-auto-merge`. The automation uses the built in token without approving pull requests or checking out their code.

## The suite

Vitest runs through Vite, so a test resolves imports exactly as the application does. That
matters more than it sounds: the previous runner resolved through Node, which refuses
extensionless imports, so only modules whose every relative import was a type import could be
loaded at all, and the player, the stores and the logo cache were untestable by accident rather
than by choice.

The tests cover the parts where a mistake is quiet rather than obvious:

- the **M3U parser**, the one component fed by strangers
- the **windowing arithmetic** that decides which rows exist at all
- the **error mapping** from an engine's code to something a viewer can act on
- the **player**, both watchdogs and the AVPlay call ordering, which is legal in one state only
  and silently plays nothing when it is wrong
- the **logo queue**, where a cancelled job that is dropped rather than resolved wedges an
  address for the rest of the session
- the **stores**, including the cache then refresh path, the request race, the refresh that is
  deliberately not waited for, the sweep that is the only thing able to delete a cached playlist,
  and that editing an address does not serve the old playlist from cache
- the **cache's eviction arithmetic**, a pure function for the same reason the windowing is:
  getting it wrong means quietly throwing away the entry it was about to read
- **resuming**, and specifically that the panel is shut on the first render rather than shut
  afterwards, since ending up closed is what the old behaviour did too
- the **four laws** of the key model, which the source argues for at length and which now have
  something holding them to it
- the **rail's two stages**, that the cursor answers the press and the column does not, because
  nothing on screen says that has regressed except that it feels slow

### Playback and recovery

The playback subsystem is covered where its rules are easy to break quietly:

- **playbackRange** holds the seek arithmetic, finite clamping and the delayed Live window
  rules as pure functions.
- **playbackTracks** covers track normalisation, labels and the automatic identities the
  drawers present.
- **player** covers the engine boundary: emitted events, track reading after metadata
  arrives, subtitle silence following the viewer's choice, and the AVPlay call ordering.
- **playbackRecovery** covers the coordinator itself: startup and rebuffer limits, the frozen
  playhead sampler, warm recovery, the compatibility and HTTP fallback steps, the bounded
  retry schedule, continuous reconnect, terminal classification and what happens off screen.
- **playbackController** covers the state the screen reads: tuning, preview naming, finite
  resume, track memory, the 1.5 second status delay, countdowns and the continuous reconnect
  session rules.
- **playbackDeck** covers the deck's own rules: control order, focus clamping, the seek bar,
  Go live at the end of a delayed window and the withdrawal timer.
- **Track drawers, subtitles and the Guide** are covered through the key law suite, along
  with the progress records and migration that finite Stop and resume rest on.
- the **key transition matrix** at the foot of `keyLaws.test.tsx` states, as data, which
  surface owns the next key after each meaningful press, so a new surface has to name its
  rows rather than inherit accidents.

The recovery state the controller exposes is intentionally free of addresses, engine strings
and provider detail, so the deterministic fault fixtures of the completion work can inspect
`recovery` without ever receiving a playback target.

### VOD catalogue and interface

The VOD tests divide ownership by boundary, so a provider payload, cache result, navigation transition, rendered control, and television journey each have one direct place to fail.

- `xtream.test.ts` owns provider normalization, bounded responses, direct sources, generated addresses, season union, and episode identity.
- `library.test.ts`, `personal.test.ts`, and `search.test.ts` own six hour resources, stale refresh, cancellation, synthetic categories, progress resolution, Series Continue, and ranked scoped search.
- `disk.test.ts`, `artwork.test.ts`, `artwork-ui.test.tsx`, and `logos.test.ts` own cache partitions, bounded load and decode queues, byte limits, bitmap closure, backdrop leases and the Live logo adapter. Controlled visibility and delayed response fixtures verify same turn reacquisition, shared visible owners, queue promotion and cancellation before obsolete responses complete. Existing ownership races use fixed stress capacities independently of the adaptive policy. Additional cases cover capacity growth, backoff with active jobs, urgent promotion past a background quota, parallel idle warming and committed grid preparation under the actual floor and stronger policy limits.
- `workload.test.ts` owns conservative hint fallback, memory bounds, measured concurrency growth, delivered throughput feedback and recovery cooldown. It also covers shared frame sampler ownership and visibility clock resets without relying on machine speed. `text.test.tsx` verifies deferred geometry reads before overflow writes, unmount cancellation and the existing motion behavior. `locale.test.ts` verifies formatter reuse, fallback formatting and the static language option order.
- `windowed.test.ts` and `vodNavigation.test.ts` own complete poster rows, fractional pointer windows, independent mode memory, exact Back origins, season preview, and the wheel guard.
- `library-ui.test.tsx`, `keyLaws.test.tsx`, and `rtl-controls.test.tsx` own the opaque shell, poster cards, search, details, episodes, focus clamping, pointer behavior, and mirrored directions. The episode regression uses twelve episodes and an empty season. Remote navigation and resize notifications verify that returning restores the full viewport at the first episode while preserving the season strip scroll position.
- The parity walk captures every structural VOD region, while the simulator measures cold and warm grids, held input, category settle, origin restore, details, episodes, wheel input, and heap growth.

The sorted catalogue regression uses sixty titles in each content mode. After choosing a sort, three navigation presses must perform zero additional title comparisons, and returning from the rail must preserve the selected item. The detail tests also verify full Favourite actions and the stacked episode preview, while Settings tests keep channel and category row controls consistent.

### What still needs a television

The simulator's engine is hls.js agreeing with the test, so the acceptance list below belongs
to `npm run tv:on-set` on real hardware, and the completion work adds deterministic AVPlay
fault controls, provider connection assertions and the full redesign journeys on top of it:

- Live channel without DVR: tune, channel up and down, and a Reopen after a pulled network.
- Live channel with DVR: the deck's seek bar, clamping at the window edges, and Go live.
- Finite playback: quick seek with Left and Right, the settle into one engine seek, and Stop
  returning to the details that launched it.
- Audio and subtitle track selection, including Off and Automatic, with cues drawn over AVPlay.
- Rebuffering: nothing under 1.5 seconds, compact status beside the clock after it, and the
  last frame left untouched.
- Frozen playhead recovery: the sampler reports it and recovery reopens without a keypress.
- A terminal refusal shows the full picture state and stops retrying.
- Hiding the app suspends the engine and returning coordinates exactly one restore.
- Continuous reconnect retries a dead live channel indefinitely, and turning it off during a wait ends at the bounded result on the same channel.
- A large poster catalogue keeps six columns responsive while held directions move focus without mounting the full provider index.
- Category focus answers immediately, content settles once after movement stops, and Back restores the exact category and poster.
- Scoped Movie and Series search returns to the exact origin after details close.
- Movie Resume uses saved seconds, while Start from beginning uses zero and preserves old progress until the new session advances.
- Series Continue resumes the selected target, while restart and manual episode selection begin at zero.
- Favourite state updates the title toggle, poster badge, category count, and category visibility together.
- Missing and undecodable artwork preserves card geometry with a stable placeholder.
- Right to left layouts mirror rail, grid, title, season, and episode movement without changing Back semantics.

## Spacing on the old sets

`gap` on a flex container arrived in Chromium 84 and the oldest supported sets run 69. The
stylesheet therefore carries a second, margin based set of spacing rules under `.no-flex-gap`,
chosen at startup by a measured probe, because CSS cannot detect this: `@supports (gap: 1px)` is
true on those engines, since gap is perfectly valid there for grid.

No browser on any developer's machine ever uses those rules, which is exactly how they rot.
`npm run tv:gap` loads the built app twice, once normally and once with flex gap neutralised and
the fallback on, and compares the position and size of every child of every gap using container.
They must match.

## The engines themselves

Spoofing a user agent proves nothing about an engine. `npm run tv:engines` runs the built app in
a real Chromium 69 and a real Chromium 120, pinned to the versions Samsung ships and downloaded
once from the snapshot archive into `~/.cache`. It walks both through every screen and asserts
two things:

1. **Nothing throws.** This is the half that matters. esbuild lowers *syntax*, so `?.` becomes
   safe on an old engine, and leaves *methods* exactly where they are, so an `Array.at` would ship
   and throw on a 2020 set with nothing in the build or the type checker to notice. React 19 turns
   out to be clean here: it feature detects `queueMicrotask`, which is Chromium 71, and falls back
   to a Promise.
2. **The layout lands in the same place**, within four pixels, on the structural boxes. Four
   because the differences fall into two groups with nothing between them: a handful at three or
   four pixels, all of them text shaping, which genuinely did change between M69 and M120 and
   which no CSS will reconcile, and the rest above thirty two, all of them a box in the wrong
   place.

Both browsers use `--font-render-hinting=none` to keep Linux headless font metrics consistent across Skia versions. This prevents rounded glyph widths from accumulating across compact guide items without changing the layout tolerance or excluding any containers.

It found a real fault on its first run. An absolutely positioned box with `left: 0; right: 0;
width: auto` is supposed to stretch to its containing block, and does, unless it is also a flex
container on Chromium 69, where it shrink wraps instead. Every channel row and every category row
is one. On every set sold in 2020 the rows were as wide as their own text: badges and stars against
the channel name rather than at the right edge, and the focus highlight a short bar around the
words instead of the full width fill the whole interface is built on. The one thing that has to be
legible from across a room was the thing that broke, and it had been shipping.

Two engines and not seven, because nothing branches on engine capability except the flex gap
probe. `--all` runs the lot when that stops being true.

On Linux both engines are the pinned builds. On a current macOS the M120 snapshot segfaults on
startup, arm64 and x64 alike, signed or not, so the ceiling falls back to the installed Chrome and
says so. The floor never falls back: substituting a modern engine there would compare two modern
engines, find them alike, and report a test that did not run.

Which build is which commit is recorded in `scripts/tv/engines.lock.json`, so CI and a laptop
fetch the same bytes. Snapshots are per commit and not every commit was built, so the position a
release maps to is often missing and the search walks outwards to the nearest one either side,
which in practice is within about twenty. `node scripts/tv/engines.mjs` resolves every engine for
every platform and rewrites the lock, without downloading anything. It is a one off unless a row
is added to `platforms.json`.

## The simulator

The simulator exercises application paths in ordinary desktop Chrome. Its Tizen APIs and viewport are fixtures. It does not reproduce Samsung hardware or its browser engine.

```bash
npm run tv                  # desktop browser with Tizen APIs shimmed
npm run tv -- --fit         # lay out for this screen instead of the set's 1080p
npm run tv:video            # the browser path instead, so channels play through hls.js
npm run tv:bench            # desktop diagnostics and complete functional journeys
npm run tv:quick            # short Live, VOD grid and cached startup sample
npm run tv:bench -- --cpu=4  # optional desktop renderer stress, with no TV equivalence
```

`scripts/tv/profile.json` contains only the desktop API fixture's viewport and user agent. CPU throttling defaults to 1, while navigator memory and core hints remain the host's. No V8 heap cap is imposed. The actual Chrome version appears in every diagnostic header. Compatibility remains the responsibility of `tv:engines`.

The estimated floor and reference profiles and their passing cohorts have been withdrawn as performance evidence. The original floor was derived from a mobile benchmark without Samsung measurements. The reference target was then raised until the application passed. Matching that synthetic JavaScript workload did not reproduce TV rendering, decoding, storage or input behavior. The simulator rejects `--floor`, `--reference`, `--budget`, `--cpu-score` and `--harsh` so old automation cannot silently obtain a different verdict.

`--cpu=N` explicitly slows only the desktop renderer main thread. It has no Samsung equivalence and cannot make results comparable across different hosts. `--software` requests desktop software rendering, which is not a TV GPU model. Use `--net=3g` only when investigating a constrained connection.

Leave `npm run tv` running and work in the window. It starts a production build watcher and reloads when `dist/` changes. The two playback paths exercise different behavior.

| | Tizen paths | Picture |
|:--|:--|:--|
| `npm run tv` | transparency, hole punch, remote keys, AVPlay state machine | Shim playback through hls.js or browser video |
| `npm run tv:video` | skipped, the app takes its browser path | real, via hls.js |

### Deterministic television faults

The simulator injects `window.__openiptvTvFaults` through `scripts/tv/shim.js`. Production builds do not create this object. Interactive shim playback uses its real media path. Measurement mode uses a native clock and state approximation without hls.js, while `useControlledPlayback()` holds preparation until the journey completes it explicitly.

- `reset()` clears fault values and restores document visibility. Measurement mode returns to automatic native timing.
- `useControlledPlayback()` starts deterministic AVPlay behavior and connection counting.
- `completePrepare()` completes the held `prepareAsync` call through the ordinary buffering complete listener and success callback.
- `startBuffering()` and `endBuffering()` dispatch the AVPlay buffering callbacks consumed by the playback controller.
- `freezePlayhead()` holds the current time, while `resumePlayhead()` resumes advancement from the harness clock.
- `nextSeek("complete")`, `nextSeek("omit-callback")` and `nextSeek("reject")` control the next seek callback result.
- `emitNetworkFault()` dispatches `PLAYER_ERROR_CONNECTION_FAILED`, while `emitMediaFault()` dispatches `PLAYER_ERROR_NOT_SUPPORTED_FILE`.
- `setLiveWindow(startMilliseconds, endMilliseconds)` controls `GET_LIVE_DURATION`.
- `setHidden(hidden)` controls document visibility and dispatches `visibilitychange`.
- `snapshot()` returns controlled mode, connection count, seek targets, buffering, frozen state, Live window, latest fault and hidden state.

A provider connection is counted when controlled `open` begins a target. Each controlled application journey opens More, reads the sanitised enum or empty value from `[data-recovery-cause]`, checks `snapshot().connections`, closes the drawer to its deck origin and resets controls before the next journey. The sequential recovery journey asserts `engine-network` and one reopen. The cancellation journey hides the document during a pending recovery, proves the connection count does not change while hidden, restores visibility and asserts `visibility-restore`. Component and coordinator tests cover the remaining reported buffer, frozen playhead and terminal media causes without reading a target address.

The authoritative redesign journeys are VOD cold poster walk, VOD warm poster walk, VOD category restore, VOD search return, Movie and Series details, episode resume, favourite round trip, playback deck and drawers, quick seek while playing and paused, Live DVR and Go live, sequential recovery, recovery cancellation, television lineup management, pointer and wheel parity, right to left navigation, provider data resilience, management interaction budget and poster interaction budget. Playback journeys drive the application through remote keys and visible controls, while fault injection only controls AVPlay outcomes. `createJourneyTracker` rejects unknown or repeated labels and fails when any assigned journey does not reach its action and state assertion.

Both ignore the same origin policy, because the set's player fetches streams itself and has never
heard of it. A browser refusing a playlist on CORS grounds is the simulator being unfaithful
rather than the app being wrong. `--cors` puts it back.

`--fit` adapts the viewport for a smaller desktop display while retaining the API fixture. This changes layout proportions, so `--bench` and `--profile` refuse to run with it. Use the fixed application viewport for layout comparisons.

## On the set itself

Everything above measures a laptop pretending to be a television. `npm run tv:on-set` measures
the television, over sdb, through the web inspector:

```bash
npm run tv:on-set                                   # launch marks, then the interface at rest
npm run tv:on-set -- --stream=https://host/x.m3u8   # and what a picture costs
npm run tv:on-set -- --tv=192.168.1.100 --seconds=20
```

It exists because the simulator cannot answer three questions and never will. Its picture is
always hls.js, so every playback number it prints comes from the wrong engine. Its CPU is a clock
divider on one thread rather than silicon. And its AVPlay is a shim that agrees with whatever the
app asks, where the real one has opinions: it refuses `blob:` and `data:` URLs, it will not read a
local playlist at all, and it keeps `EXT-X-MEDIA-SEQUENCE` in a signed 32 bit integer.

What it reports, in one run against a 2025 set (Tizen 9.0, Chromium 120, four cores, 2GB):

```
  launch, on a relaunch with the playlist already cached
    DOM content loaded        70ms
    first paint              315ms
    the interface            200ms
    the channel rows         200ms
    the channel named        200ms

  at rest, nothing playing        9% of one core, median frame 17ms
  playing, via AVPlay            25% of one core, playhead moved 10081ms in 10s
```

Marks sharing a value happened inside one frame, which the run says out loud so three identical
numbers do not read as a broken harness. The launch is a relaunch, so V8's code cache is warm and
the bundle's compile cost is understated: a genuinely cold start cannot be instrumented this way,
because the inspector only exists once the app is already running.

The playback phase also reports the manifest before asking the player to read it, which turns a
stall into an explanation:

```
  the manifest
    651688 bytes, 3600 segments, 0 variants listed
    media sequence 1786136377908738  OVER 2^31, so AVPlay cannot play this
    playhead      moved 0ms in 8s -> STALLED, the picture is not moving
    live window   0|2000
```

Prediction first, then the measurement agreeing with it. That is the shape to keep: a harness that
only reports numbers cannot be wrong about anything.

Three things about attaching cost an evening each and are written into the script:

- **`sdb shell 0 debug <app>` needs `-s <serial>`.** Without it the set answers `closed` and says
  nothing about why, even with exactly one television paired.
- **That command never exits.** It holds the debug session open, so waiting for it to finish waits
  for ever. It is spawned and the port is read off its output.
- **AVPlay's requests are invisible to the inspector.** With `Network.enable` on and a channel
  playing, CDP saw zero requests for it while a page `fetch()` to the same URL was seen at once.
  Its HTTP client is native, which is also why it announces itself as `samsung-agent/1.1`. Nothing
  in the page can see, rewrite or proxy what the player fetches.

It is not a gate. It needs hardware on the network, so it cannot run in CI and must never block
anything. Read it before a release, and after any change to the player or the launch path.

### Navigation and spacing acceptance

1. Configure a Live only playlist and a playlist with Movies and Series. Select Movies on the full playlist, play a movie, then switch to the Live only playlist. Returning to the full playlist must restore Movies. Repeat with Series.
2. Return to Live from Movies and Series. Its browser must stay open with the remembered channel playing and focused, including after tuning completes. Switch to another playlist whose remembered section is Live and confirm that its browser also stays open and focuses that playlist's playing channel.
3. Open Saved Playlists and the other Settings management pages. Scroll through enough rows to reach the top, middle and bottom. Their scrolling viewport must stay 48px from the display's vertical edges while the Return control and key guide remain visible.
4. Open the main Saved Playlists shortcut and inspect its first and last pagination pages. Its header and footer must remain inside the same 48px safe margins.
5. Inspect Movie and Series details at 1920x1080 and 1280x720 in both layout directions. Text and artwork must have matching outer margins, including while loading. Each margin adds 5% of the detail content width beyond the 48px safe edge, which is about 139px on a 1920px viewport and 107px on a 1280px viewport. Check that loading artwork has the same corner radius as loaded artwork. Open the episode panel and confirm that it uses the same trailing column.
6. Check the remote key guide on VOD catalogues, search and detail pages. Repeat on Settings inner pages, form dialogs, confirmation dialogs and playback drawers.
7. Enter browser fullscreen and grant keyboard lock permission if prompted. Open Settings, tap Escape and confirm that it goes Back without leaving fullscreen. Reopen Settings and hold Escape until fullscreen closes, then keep holding briefly and confirm that Settings stays open. Refresh with Cmd+R or Ctrl+R while fullscreen, including from Settings and the remote key tester. Browsers without Escape locking support may still reserve that key for fullscreen exit.
8. Focus Programme Guide in playback controls. The highlight must surround the whole programme information wrapper, while the inner icon keeps its normal appearance. Inspect Movie and Series detail backdrops behind the footer and at the bottom display edge to confirm that no exposed background band remains.
9. Open Movie and Series details from both the catalogue and search results, then return with Back. Both directions must use the shared page fade without the main menu collapsing or the Live rail moving. Metadata loading must show the detail page's loading state once the page commits.
10. Open a confirmation modal and a Settings form. Their Select and Back guide must share the action footer without a separate row of movement arrows. Start a movie and an episode, confirm that controls open on Play/Pause, then leave them untouched and compare their dismissal interval with the Live banner. Starting another episode must restart that interval.
11. Test native browser playback with audio and text tracks that arrive after metadata loading. Confirm that the picker updates when tracks are added or changed, while unsupported embedded tracks are recorded as a browser limitation.
12. Compare Previous and Next with Info, Audio, Subtitles, Programme Guide and the loading indicator. Their visible circles must match while Play/Pause remains larger. Disabled controls must have a dimmed, hollow appearance with a dashed edge, and pointer hover must not highlight them. Hold a seek direction to check the 100ms repeat spacing, then release it to check the 375ms preview commit.
13. Open Settings, Change Playlist, Saved Playlists and Movie or Series details from both a collapsed and an expanded application menu. Entry and exit must use the same full screen fade while the hidden menu retains its presentation. Returning must reveal it without a collapse, slide or label flicker. Repeat in both layout directions. Switch between Movies or Series and Live in both directions, then repeat with Live search, and confirm that these section changes fade only the content area beside the menu without rail motion. The menu must stay visible outside the fade and retain its normal collapse animation. Opening and closing the ordinary Live channel browser must retain its normal slide.
14. In Movie and Series search, confirm that the input and Search button have equal heights. Typing must neither apply a query nor start a search request. Submit with Enter in the input, then repeat with a click or OK on Search. Check loading, successful results, no matches and provider failures. Counts must stay hidden during loading and failures. Down from either search control must reach Retry after a failed submission, while Up returns to the originating control in both layout directions. Retrying must retain the query without reopening the keyboard. Edit a successful query without submitting, open an existing result and return, then confirm that both the draft and the previously submitted results remain intact. A verbose provider index above the former raw size limit must load when its normalized data fits the retained budget. Oversized normalized data must still fail without partial results.

15. Start with a playlist loading failure and confirm that Manage playlists opens the failed playlist in Settings. Move from Retry to Manage playlists with the trailing arrow, then return to Retry with the leading arrow. Another leading press must reach the menu. Repeat in RTL and with Up and Down. Select Live, Movies, Series and Search from the menu and confirm a new load attempt preserves the selected context. The error page must keep its guide at the bottom safe edge.
16. Open Exit from a catalogue with the application menu visible, then dismiss it. The modal must retain menu visibility and own all input. Repeat from the Live picture where the menu is already hidden and confirm that Exit does not reveal it.
17. Open Movie and Series details with long genre lists, directors, casts and descriptions. Confirm that the title and actions stay visible while the labelled information panel scrolls. Up from the first action must reach overflowing information, while Down at the end returns to the actions. Confirm the Scroll guide and matching loading skeleton in both layout directions. New or reset preferences must select Fit first, followed by Fill and Stretch, without changing a saved aspect choice.

### Real television acceptance

Use content whose owner permits playback, then record the television model, Tizen version, source kind, selected output format and exact content types tested. Record every unavailable provider capability separately. Hardware unavailability does not block a pull request, but each skipped item remains release risk and simulator evidence must not be reported as AVPlay evidence.

1. Tune HLS Live without DVR, change channel in both directions and confirm Right opens the deck without a timeline.
2. Tune HLS Live with DVR, seek within the reported window, move the window across a pending target, use Go live and confirm the Live badge follows actual position.
3. Tune MPEG TS Live and confirm channel change, pause capability reporting and Stop behavior.
4. Open one movie, quick seek while playing and paused, use the deck timeline, then Stop and confirm the launching Movie detail and cursor return.
5. Open one Series episode, resume through Series Continue, start one selected episode from zero, then Stop and confirm the episode panel and cursor return.
6. Open one catchup item from Guide, seek in both directions and confirm Back returns through the documented drawer origin.
7. Select between multiple audio tracks and confirm the chosen track persists only while the target supports the same identity.
8. Select embedded subtitles, confirm cues render once inside the safe area, then choose Off and confirm the cue clears.
9. Hold reported buffering past the compact status threshold and confirm recovery cause `reported-buffer` without a duplicate provider connection during the allowed refill interval.
10. Freeze an advancing playhead and confirm recovery cause `frozen-playhead`, one sequential reopen and resumed movement.
11. Browse a large poster catalogue, hold every direction, revisit a warm category and confirm focus answers before catalogue and artwork work.
12. Rename, number, hide and order a channel on the television. Create a personal category, change membership and confirm number dialling uses the effective number.
13. Apply the same rename, number, visibility, category placement and personal membership changes from a paired phone. Confirm the television updates, then restart and confirm the same durable result.
14. Hold page two on the phone, make a television edit and request the next page. Confirm a conflict loads page one at the current revision without combining rows or replaying the mutation.
15. Clear the refetchable cache and confirm lineup personalisation remains. Remove one playlist and replace one provider account, then confirm only state owned by that source is removed.

### TV performance evidence

Record the model, firmware, installed build, provider catalogue size, cache state and stream format for each run. Repeat the same actions on baseline and changed builds using the same set and content. Keep cold launch, cached relaunch, first category entry and cached revisits separate. Report the number of observations, median, p95 and maximum only when enough observations support those statistics. Preserve failures and unavailable samples.

| Area | Evidence to collect on the set |
|:--|:--|
| Launch | Time from physical launch to usable Live rows, then separately to the first moving picture. A DOM milestone does not establish a usable picture. |
| Live navigation | Physical key to visible focus, channel selection to first moving picture, missed or queued presses during held input, and Back while loading. |
| Movies and Series | First and cached category readiness, poster visibility, grid traversal, search submission to usable results, detail entry and episode selection. |
| Playback | Start and resume delay, seek completion, buffering duration, recovery and continued playhead progress while overlays are used. |
| Sustained use | Repeated browse and playback cycles, renderer activity at rest and during playback, retained JavaScript heap, and total process memory when the platform exposes it. |

Use recorded screen and input evidence for visible response or presentation claims. Label inspector timestamps as instrumented observations. `tv:on-set` currently covers cached relaunch, renderer activity and playhead progress only. The remaining observations need manual capture or dedicated hardware instrumentation. Do not replace unavailable measurements with a desktop estimate or infer low tier results from a different model.

### Phone management on a set

Run these checks after changing the management socket, pairing, welcome screen or phone interface:

1. Connect the television by Ethernet, open a fresh installation and confirm that the QR address matches the wired address reported by the TV.
2. Scan the QR code from a phone on the same network, name the phone, add a valid playlist and confirm that the television leaves first setup only after channels load.
3. Reset the test installation, type the displayed local address on the phone, enter the six digit code and complete the same first setup path.
4. Close OpenIPTV and confirm that the phone loses its connection, then reopen it and confirm that the remembered phone reconnects without pairing again.
5. Revoke the phone under Settings, then Remote access and confirm that its next request returns to pairing while another remembered phone continues to work.
6. Move the television to WiFi, repeat address discovery and QR pairing, then confirm that a previous browser origin is asked to pair again when the address changes.
7. Close OpenIPTV after a phone request and reopen it immediately, then confirm that port 8976 binds again because the previous worker closed its socket before termination.
8. Run `npm run tv:on-set` before and after pairing, then compare CPU at rest. The management worker must not create a sustained increase large enough to move the existing rest result outside ordinary run variation.
9. Rename and restore one channel name, set and restore its number, then hide and show it. Confirm each television result matches the current phone page.
10. Move one provider category, create one personal category, add and remove membership, then move one member around a surviving anchor.
11. Keep a second phone page open, apply a television mutation and confirm the next phone request reports a conflict before loading a fresh page one.
12. Restart OpenIPTV and confirm every accepted phone mutation remains. Clear the cache and confirm the same personalisation remains.

## Rebuilding the loopback socket module

`wasm/manifest-socket.c` is compiled with **Samsung's own Emscripten fork**, not a current
Emscripten: the socket extension exists only there. The built `public/wasm/manifest-socket.js` and
`.wasm` are committed, so `npm ci && npm run build` needs none of this. Rebuild only when the C
changes.

```bash
# Samsung's fork, 1.39.4.7, December 2021. No login needed.
curl -sL -o emscripten-mac.zip \
  "https://developer.samsung.com/smarttv/file/5717993e-b16b-4402-a0a4-61617a607398"
unzip -q emscripten-mac.zip && xattr -dr com.apple.quarantine emscripten-release-bundle

# Two patches, both to their SDK rather than to us:
#   1. emcc 1.39 imports distutils, removed in Python 3.12. Point `python` at 3.11.
#   2. tools/system_libs.py builds their own C++17 sources with -std=c++14. sed it to c++17.
ln -sf /opt/homebrew/opt/python@3.11/bin/python3.11 /tmp/pybin/python
sed -i '' "s/'-std=c++14'/'-std=c++17'/g" .../fastcomp/emscripten/tools/system_libs.py

PATH=/tmp/pybin:$PATH EM_CONFIG=./.emscripten EMCC_WASM_BACKEND=1 \
  .../fastcomp/emscripten/emcc wasm/manifest-socket.c -o public/wasm/manifest-socket.js -Os \
  -s ENVIRONMENT=worker -s ENVIRONMENT_MAY_BE_TIZEN -s FORCE_FILESYSTEM=1 -s INVOKE_RUN=0 \
  -s "EXPORTED_FUNCTIONS=['_set_manifest','_start_server','_serve_once','_stop_server']" \
  -s "EXTRA_EXPORTED_RUNTIME_METHODS=['cwrap']"
```

The private network management module imports the same Samsung socket ABI directly, so it can be built with current Emscripten on Apple silicon without changing the compatibility module:

```bash
emcc wasm/management-socket.c -o public/wasm/management-socket.wasm -Os --no-entry \
  -s STANDALONE_WASM=1 -s FILESYSTEM=0 -s ALLOW_MEMORY_GROWTH=0 \
  -s INITIAL_MEMORY=1048576 -s STACK_SIZE=65536 \
  -s "EXPORTED_FUNCTIONS=['_start_server','_receive_request','_request_text','_send_response','_stop_server','_malloc','_free']"
```

Its hand written `management-socket.js` loader passes the platform functions directly as WebAssembly imports. It must not wrap or call them in JavaScript because the television refuses host binding calls made outside WebAssembly.

The imported signatures come from Samsung's `system/include/libc/socket_host.h`, rather than the POSIX declarations. In particular, `__wasm_accept` takes five arguments: descriptor, address, address capacity, output length pointer and flags. Passing a three argument POSIX import prevents the module from instantiating on the television. `wasm:check` links the management module against typed WebAssembly exports with Samsung's signatures, so a JavaScript mock cannot conceal that mismatch.

`.emscripten` points `LLVM_ROOT` at `fastcomp/bin` (clang 10, the upstream backend). The bundle's
nested `fastcomp/fastcomp/bin` is clang 6 with no `llc`, so fastcomp cannot be used on macOS at all.

**The part that cost a night.** The SDK maps every POSIX call onto the firmware in
`src/library_tizen_socket_host.js`:

```js
_wasm_accept__host: true,
_wasm_accept: 'tizentvwasm.SocketsHostBindings.accept',
```

but `src/modules.js` only links those libraries inside `if (FILESYSTEM)`, and even with the
filesystem forced on the generated glue still asked for bare `__wasm_*` globals that nothing
defined, so the module died with `ReferenceError: __wasm_accept is not defined`.
`public/wasm/manifest-socket.worker.js` supplies them from `tizentvwasm.SocketsHostBindings`. It
hands over the **function objects** and never calls them: calling one from JavaScript is refused
outright with `Cannot call host binding function from JS`, while passing it to a wasm module is not,
because the caller is then the engine. All nineteen bind.

Verifying it needs the television. `npm run tv:on-set -- --stream=<url>` reports whether a manifest
is repairable and whether the playhead moves, and the feature's own end to end path is: toggle off,
a telewebion channel fails with `[STALLED]`, then toggle on and the same channel plays and Diagnostics reads
`serving on port N`.

## The playlist and artwork it all runs against

12,732 channels in 175 categories, 2.7MB of text, a logo on nearly every channel and names in a
dozen scripts: [iptv-org's index](https://iptv-org.github.io/iptv/index.m3u). The harness fetches
it, keeps a copy for a day, serves it from localhost and asserts it into the simulator's settings
on every run, so there is nothing to pass and nothing to remember. `--playlist=` overrides it and
the header says which one was used, with its shape counted rather than assumed.

This fixture exercises large Live lists, category replacement, parsing and artwork queues. Its size and content can change, so use the counts and digest in the diagnostic header. It does not establish a worst case for every provider or represent real TV rendering cost.

The artwork is served locally too, and that changed the numbers most. The playlist points at
10,602 logos on a few hundred hosts and most of them are dead: eight runs of the walk cached 280 of
them. So the interface phases were measuring a list with almost no artwork in it, plus a few
hundred requests failing at whatever rate DNS felt like that minute, which is how one phase
reported 1 stall in three consecutive rounds and 21 in the fourth with no code between them. Every
logo address is now rewritten to a locally served PNG, one per channel and stable between runs,
deliberately 400 to 1200px so the decode and the resample into a 76x48 box are real work, in twelve
colourways so that a screenful of them cannot be mistaken for a placeholder everything fell back
to. `--real-logos` puts the playlist's own addresses back.

**Only when measuring.** `npm run tv` shows the playlist's real artwork, dead hosts and all,
because the entire point of the headful simulator is that somebody looks at it and believes what
they see.

## The Xtream fixture

`scripts/present.mjs` owns a synthetic Player API account used by the test server, parity walk and desktop diagnostics. It returns 3,200 live summaries, 840 movies, 560 series, duplicate and empty category names, fixed movie details, three seasons with twelve episodes each, short programme data, archived catchup and finite media routes. Every value is invented. Responses contain no username or password, while requests still exercise the credential transport required by Xtream.

The fixture filters live, movie, and series lists by opaque category identifier, so duplicate display names cannot route a request. Its empty categories return successful empty arrays. This distinction lets the harness detect a repeated request that mistakes empty for unloaded.

The shared parity walk starts from Xtream Live rows, performs Live search, opens a movie category twice, opens movie details and descends through a series, season and episode list. Desktop diagnostics retain the M3U walk before changing to the Xtream fixture. They record launch milestones, rail and grid walks, category visits, movie details, search and JavaScript heap observations without timing acceptance thresholds.

## Desktop diagnostics

There is no simulated TV performance budget. `tv:bench` and `tv:quick` retain raw desktop observations and functional journey assertions. Their successful exit means the requested journeys and recordings completed. Slow durations or heap growth do not produce a performance pass or failure.

| Observation | What it measures | What it cannot establish |
|:--|:--|:--|
| rAF Hz | Animation callback count divided by elapsed desktop wall time, without a 60 Hz cap. | Displayed UI FPS, GPU throughput or video frame rate. |
| Callback gap p95 and maximum | Time between callback entries, including the initial partial interval and a terminal interval longer than 16.67 ms. | Whether the compositor presented a changed frame. |
| Long gap time share | Whole duration of callback intervals over 100 ms divided by elapsed time. | An acceptance threshold or a count of missed TV frames. |
| DOM response p95 and maximum | Browser event timestamp to the callback after a DOM cursor change is observed. | Physical remote latency or time to visible pixels. |
| Category readiness | Phase start to the driver's committed category DOM barrier. | Poster decode completion or visual readiness of every card. |
| V8 heap and growth | Reported JavaScript heap after requested garbage collection. | Total application memory, native image allocations or GPU memory. |

Callback p95 uses nearest rank, selecting sorted interval `ceil(0.95 * count) - 1`. The elapsed denominator includes the unsampled tail. A hidden page or an absent callback sample invalidates the recording.

The input recorder rejects incompatible browser event clocks. Inputs pending at one observed cursor change share the next callback boundary, so response counts alone cannot prove every intermediate state was visible. The complete twelve press grid walk must also traverse 72 items. The default driver pauses 100 ms after each completed CDP dispatch, which is not a fixed 10 Hz input stream. An explicit `--gap` changes that pause.

Setup and a three second settling period precede each complete phase. A journey includes its action, asynchronous DOM readiness wait, a 600 ms tail and a final pair of callbacks. Ordinary Live phases omit the 600 ms tail. Work outside these windows is excluded. The fixed waits can dilute aggregate statistics, so use the targeted profiler's raw intervals and action boundaries when attributing a regression.

Diagnostics use a fresh browser profile and debugging port 9433, separate from the interactive profile on 9333. The native playback shim exercises application state transitions without measuring real decoding, stream startup, buffering behavior or decoder resource contention. Functional faults are controlled test outcomes.

## The launch

The same run relaunches the app through `about:blank` and records five milestones relative to navigation. This avoids overlapping teardown of the old app with startup of the new one. The browser runtime and disk cache are warm, so this is cached startup rather than a cold boot of a television.

The initial provider catalogue load is reported separately. It must reach the expected Live state. All launch durations are desktop diagnostics without acceptance thresholds. The harness deadline bounds how long it waits for missing milestones.

| Milestone | Meaning | Acceptance |
|:--|:--|:--|
| DOM content loaded | The navigation's DOMContentLoaded event ended | Diagnostic |
| First paint | Browser paint timing | Diagnostic |
| The interface | Interface DOM appeared | Diagnostic |
| The channel rows | Channel row DOM appeared | Diagnostic |
| The channel named | Resumed channel label appeared | Diagnostic |

DOMContentLoaded is not isolated bundle compilation or execution time. It may occur after first paint and includes work beyond parsing JavaScript. Intermediate milestones help attribute startup cost without adding unrelated pass ceilings. The exact active fixture account, category and Live catalogue records must already exist before relaunch. The harness checks the active playlist identifier, source revision, fixture server and Live catalogue length instead of accepting any Xtream cache key. The channel row milestone excludes category rows and channel skeletons.

## Measuring a change

**Always headless, and never compare a headless figure with a headful one.** `--bench` is headless by default because a headful window's occlusion and presentation scheduling can change its callback cadence. Headless avoids desktop occlusion, but does not guarantee a particular callback frequency or remove refresh scheduling. `--headful` exists for visual diagnosis.

Alternate baseline and changed builds on the same host and browser with identical fixtures and settings. Use at least three paired rounds, retaining raw observations and recording the conditions for each run. Load average is context, without a CPU utilisation measurement or proof of a cause. Desktop differences are leads for investigation and do not establish a change in TV performance.

Use isolated worktrees for baseline and changed builds. Run the same diagnostic harness against each worktree's own production build, since the driver checks the served build identity. Keep unrelated builds, tests and rendering workloads stopped while timing. Preserve identical fixture bytes through `--playlist` and compare matching phases.

## Gates must be able to fail

Every gate here has, at some point, reported success without testing anything. When touching one,
ask what it does when the thing it measures is absent rather than wrong:

- A screen that renders nothing produces no boxes, and no boxes compares equal to no boxes.
  `harness.mjs` throws on an empty capture for this reason.
- A click by label that misses is a no-op, and both legs of a comparison miss identically, so they
  agree perfectly on screens neither of them visited. `harness.mjs` throws if a label is gone.
- Comparing only the reference's keys hides everything the reference failed to draw, and the
  reference is the oldest and slowest engine. `compare()` walks the union.
- A recording can omit a renamed phase. `sim.mjs` checks expected and recorded phase labels in both directions.
- A benchmark that drops long frame gaps can flatter a window that went quiet. `bench.js` retains long gaps and terminal stalls, divides callback count by the whole phase duration, and rejects visibility loss.
- Retired hardware and budget flags must fail before a browser starts. Silently ignoring them would give old automation a misleading success.
- Ask the browser its version rather than trusting the path it came from. `engine-parity.mjs` does,
  because a stale lock entry otherwise tests the wrong engine and passes.

## Known weaknesses

Desktop CPU throttling suspends the renderer main thread without reproducing TV CPU architecture, workers, GPU, image decoding, memory bandwidth, flash or thermals. A synthetic JavaScript score cannot map those costs to Samsung models. No passing desktop cohort qualifies TV performance.

The API shim cannot expose native decoder resource contention, real buffering, firmware faults or the physical remote path. Callback cadence and DOM focus observations cannot prove frame presentation. V8 heap measurements omit native and GPU allocations. Compatibility and spacing gates cover different properties and cannot close these gaps.

The real TV tool measures cached relaunch, renderer activity at rest and AVPlay playhead progress. It does not automate every navigation journey or measure visible frame presentation. Inspector attachment also changes the runtime and excludes a true cold boot. Report unavailable measurements and untested hardware explicitly.
