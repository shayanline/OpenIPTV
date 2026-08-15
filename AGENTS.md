# Working on SimpleIPTV

An IPTV player for Samsung Tizen TVs, and the same build runs in a desktop browser. It ships
with no channels: the viewer adds an extended M3U address and the app plays what that playlist
contains, without interpreting or rewriting any name, group or country.

React 19, TypeScript, zustand, Vite, Biome, Vitest. hls.js only on the browser path. No other
runtime dependencies, and adding one is a decision rather than a detail: it is compiled and run
by a 2020 television every time somebody switches the set on.

Node 22.18 or newer, pinned in `.nvmrc`.

## Verification

```bash
npm run check       # lint, typecheck, unit and component tests
npm run build       # required before any of the gates below
npm run tv:gap      # spacing parity for the sets without flex gap
npm run tv:engines  # the app in a real Chromium 69 and 120
npm run tv:budget   # frame times and the launch, on the floor profile, as a pass or fail
```

`npm run check` and `npm run build` for anything. The three `tv:` gates need a build first and
are the ones that speak for hardware nobody here has. Details of what each measures and how to
read it: [testing and measurement](docs/testing.md).

## Running it

`npm run dev` serves the app on port 5173, where the arrow keys and Enter share key codes with
the remote, so the whole interface is usable from a keyboard. `?remote` in development summons a
floating Smart Remote with the D-pad, the transport keys, the coloured keys and the number pad. It
dispatches the same key events the TV sends rather than calling handlers directly, and the bundler
drops it from a production build, so it cannot be conjured onto a television.

`npm run tv` runs the built app under the reference set's measured constraints, with `webapis.avplay`
and `tizen` shimmed so the Tizen paths actually run, and `npm run tv:floor` does it on the weakest
supported set. Judge speed there and nowhere else.

`npm run tv:on-set` measures the app on a real television over sdb: the launch marks, the CPU at
rest, and, given `--stream=<url>`, what a picture costs and whether the playhead actually moves.
It is the only thing here that reports the real AVPlay rather than a shim, so it is what to reach
for when a stream plays on a laptop and not on a set. It needs a paired TV in developer mode, so
it is not a gate and never runs in CI.

## Layout

```
src/
  App.tsx                  the screen stack and the key routing, and nothing else
  types.ts                 Channel, and the shapes the parser produces
  meta.ts                  version and repository URL, injected at build time
  services/m3u.ts          playlist parser, tolerant of the ways M3U is abused
  services/lineup.ts       which lists exist, and where channel up and down land
  services/search.ts       ranked matching over the whole playlist, capped per rank
  services/player.ts       one interface over AVPlay and hls.js
  services/errors.ts       engine error codes to something a viewer can act on
  services/playlistUrl.ts  what cannot possibly be a playlist address, checked offline
  services/manifest.ts     reading and repairing a playlist, as pure functions
  services/repair.ts       serving a repaired playlist to AVPlay over a loopback socket
  services/logos.ts        decode logos once, at the size they are drawn, and queue the work
  services/capabilities.ts what the engine can actually do, measured rather than assumed
  services/metrics.ts      the measurements the stylesheet shares with the code
  services/store.ts        localStorage, for the short strings needed before first paint
  services/disk.ts         IndexedDB, for the playlist and the logos, on a 5MB budget
  services/idle.ts         work that must never be why a key press waits
  stores/channels.ts       channels, categories, favourites, last watched
  stores/settings.ts       everything the viewer can change, persisted
  hooks/useTuner.ts        the player's life, channel changing, pausing, automatic retry
  hooks/useChrome.ts       the banner, messages and dialled digits, and their timers
  hooks/useRemote.ts       remote key codes, and registering them with Tizen
  hooks/useSpatialNav.ts   four directional focus movement over arbitrary controls
  hooks/useWindowed.ts     renders a slice of a long list instead of all of it
  hooks/useViewport.ts     the measured height a windowed list is laid out against
  hooks/usePointerAwake.ts whether a pointer is in use, for the on screen pad
  components/              panels, dialogs, and the debug Smart Remote
wasm/manifest-socket.c     the loopback HTTP server, built with Samsung's Emscripten fork
public/wasm/               the built module and the worker that owns its socket
  components/settings/     one file per section of the settings sheet
  styles/                  the whole stylesheet, tokens then app, since no component has one
scripts/
  package.sh               build and sign
  deploy.sh                build, install over sdb and launch
  icon.mjs                 redraw public/icon.png from public/icon.svg
  stamp-version.mjs        write package.json's version into config.xml at package time
  tv/                      run the app under the TV's measured constraints
  tv/platforms.json        Samsung's engine matrix, the only copy of it
  tv/floor.json            the weakest supported set, with a source for every figure
  tv/profile.json          what the reference set reports about itself, rewritten by calibrate
  tv/harness.mjs           serve the build, walk every screen, measure the boxes
  tv/gap-parity.mjs        spacing is the same with and without flex gap
  tv/engine-parity.mjs     behaviour is the same on Chromium 69 and 120
public/config.xml          the Tizen widget manifest, privileges and CSP
```

## Invariants

Break one of these and the app fails on hardware no test here owns. The reasoning is in
[the design notes](docs/design.md) and at length in the source.

- **The screen is a stack and a layer only shows when nothing above it is open.** `App.tsx`
  names the five layers. A new overlay belongs in that stack or nowhere.
- **The four laws of the key model.** At the picture, up and down always change channel. OK does
  the obvious thing where it is pressed. Left and right move within whatever is showing. RETURN
  always goes back, and closes the app only when there is nothing left to close.
  `tests/keyLaws.test.tsx` enforces them.
- **`services/store` is localStorage, `services/disk` is IndexedDB.** Settings, favourites and
  the last channel are short strings needed before the first paint, so they need a synchronous
  API. The playlist text and the logos are megabytes and Blobs, which localStorage caps at 5MB
  and cannot hold. The disk cache keeps its own 5MB budget deliberately.
- **No IndexedDB work on an interaction path.** Writing each logo as it was decoded cost a
  measurable regression, and reading the whole metadata store on every write cost an 840ms frame
  while the interface was idle. Both are queued through `services/idle`.
- **The cursor answers the press, the expensive work follows.** The rail waits 150ms before the
  channel column rebuilds, the search waits 150ms before it queries, the tuner waits 450ms
  before it retunes. Anything expensive added to a held key needs the same treatment.
- **Cached playlists are keyed by address**, not by playlist id, or editing a URL serves the
  previous playlist from a cache that believes itself current.
- **One artifact, no branching by model year.** The build targets es2019 and the stylesheet uses
  nothing newer than Chromium 69, so every later set runs a strict superset. There is exactly
  one runtime capability branch, the flex gap probe, and `tv:gap` covers it. Every branch added
  costs an engine in the matrix, because the years in between stop being unreachable the moment
  code can tell them apart.
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
  that true: nothing is probed before a channel has actually failed, `needsRepair` answers yes
  for that one defect only, and a verdict is remembered per host so nobody pays the diagnosis
  twice. Anything that would make a working channel pay for this is a bug.
- **The socket is opened by `services/repair` and nothing else, on an ephemeral port, and closed
  when it is not needed.** A fixed port plus a worker terminated without closing leaves the
  socket held, and the next attempt cannot bind: the symptom is AVPlay reporting
  `CONNECTION_FAILED` against a server that looks perfectly healthy.
- **`public/config.xml` must stay well formed XML**, or the Tizen CLI will not package it and
  nothing else parses the file. CI runs `xmllint` on it. `object-src 'self'` in the CSP is load
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
- **A quarter of the machine being busy moves the benchmark numbers by a third.** If a run
  fails, read the load in the header before reading the failure.
