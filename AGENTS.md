# Working on SimpleIPTV

## Verification

```bash
npm run check       # lint, typecheck, unit and component tests
npm run build       # required before any of the gates below
npm run tv:gap      # spacing parity for the sets without flex gap
npm run tv:engines  # the app in a real Chromium 69 and 120
npm run tv:budget   # frame times and the launch, on the floor profile, as a pass or fail
```

`npm run check` and `npm run build` for anything. The three `tv:` gates need a build first and
are the ones that speak for hardware nobody here has.

## Measuring performance

**Always headless, and never compare a headless figure with a headful one.** `--bench` is
headless by default and that is a correctness matter, not a convenience:
`requestAnimationFrame` stops for a window the compositor thinks is occluded, and a window
launched from a terminal is occluded the moment anybody touches the keyboard. A benchmark that
depends on the machine being left alone for the duration is a benchmark whose results depend on
who was using the machine. Headless has no window to be behind anything.

It also means the numbers are not vsync limited, so `resting` sits near 9ms rather than 16.7ms.
That is fine and slightly better for detecting work, but a before and after must both be
measured the same way. `--headful` exists for when the question is visual.

**The playlist is the harness's own and needs no arranging.** It fetches iptv-org's index
(12,732 channels, 175 categories, 2.7MB), keeps a copy in the temp directory for a day, serves
it from localhost and writes it into the simulator's settings every run. Nothing to pass,
nothing to reseed, and CI gets the same thing a laptop does.

It used to be an argument, and the argument was advisory: the seed only wrote settings when
there were none, so a profile seeded once with 200 channels went on being measured against 200
channels whatever any later run asked for, and the run printed a tidy table for a playlist
nobody had chosen. Small playlists flatter this interface badly, because the expensive things
here are rows, artwork and categories, and 200 channels can hide a 0.7 second parse.

`--playlist=` still overrides it. The header prints the shape it counted, so a run says what it
measured rather than which URL it was pointed at.

**The artwork is served locally when measuring, and this is why the scroll numbers look worse
than they used to.** Most of the playlist's 10,602 logo hosts are dead, so they failed in
milliseconds and the interface phases were measuring a list with hardly any artwork in it. Every
logo is now a locally served PNG, one per channel, stable between runs, 400 to 1200px so the
decode and the resample into the 76x48 box are real, in twelve colourways. Twelve to twenty four
stalls in a scroll is what this app actually costs when the artwork arrives. `--real-logos` goes
back to the playlist's own hosts.

**Never substituted in `npm run tv`.** It was, briefly, and every channel showed the same tile,
which looks exactly like a broken logo pipeline. A headful simulator is for believing what you
see, so measurement fixtures do not belong in it. If a question about the fixture ever comes up
again, the header prints the address it is served at: a stale server can hold 4174 and the
fallback to another port is silent, which cost me twenty minutes of disbelieving a correct run.

**The launch is measured last, on a relaunch, and it is the only part of the run that is not
frame times.** The journeys all begin three seconds after the app is up, so nothing in them
can see the launch getting slower. It is five marks in milliseconds from the navigation, and
it goes last because by then the journeys have played a channel, so there is one to resume
and artwork in the cache, which is the state a set is in every launch after the first. It
navigates to `about:blank` first on purpose: otherwise the new page compiles its bundle while
the old page's twelve thousand channels are being torn down on the same thread, which put
2585ms on a mark that reads 1192ms once the old page has gone.

**Every run starts from the same place, and that is what made the numbers repeatable.** The
seed forgets the last channel once per run (a `sessionStorage` sentinel, so it survives the
relaunch), so every run begins on the first category, first row, nothing playing. Before that,
runs inherited whichever channel the last one left playing, and a phase named after scrolling a
list was sometimes demuxing a 1080p stream: the same build measured between 2 and 18 stalls.
Nothing plays until a phase starts one, which is why only the last two phases are noisy.

**Read the lag column, not just the frames.** Press to highlight is the only number a viewer
can feel, and it is measured in the page because both timestamps have to be on one clock. 20 to
40ms median on the floor with this playlist. `slow` beside it counts the presses over 100ms and
is what the budget spends: the worst single press is printed but not gated, because the maximum
of eighteen samples failed a quiet run at 178ms after six runs between 57 and 116. `keys` is
moves against presses: 40/40 means the phase walked the journey it is named after, and it fails
the run when it does not.

**Interleave a before and after, do not batch them.** This machine runs Palo Alto endpoint
protection, which scans on file changes and pushes the load average to five or six for minutes
at a time, `npm ci` and `npm run build` being reliable triggers. Three runs of one side followed
by three of the other puts any drift entirely on one side. Alternate them and take medians, and
use at least three rounds: single runs of a phase have varied by a factor of two here.

To measure a change against the code before it, without disturbing the working tree:

```bash
git worktree add /tmp/iptv-before HEAD     # or whichever commit
cd /tmp/iptv-before && npm ci && npm run build && rm -rf node_modules
# serve that dist on another port, then point the current simulator at it, so the
# harness is identical and only the application differs:
node scripts/tv/sim.mjs --floor --bench --url=http://localhost:4180/ --playlist=...
```

Remove `node_modules` once built, or the scanner will be chewing through 185MB of new files
during the measurement. Note the two builds are on different ports and therefore different
origins, so each has its own localStorage and IndexedDB and each needs `--playlist`; discard
the first round on each side, which is the only one that fetches the playlist over the network.

## Things that have wasted time here

- **A phase reporting "window was hidden, nothing measurable here" usually means no playlist**,
  not an occluded window. No frames looks the same either way. The bench now checks for a
  playlist up front and says so, and is headless so occlusion cannot happen.
- **The bench used to assume the app launches with the channel panel open.** It resumes the last
  channel with the panel shut now, so the presses that used to enter the rail left it, and
  "racing the categories" spent a while measuring the channel list instead and reporting a
  healthy number for a journey it was not walking. It asserts the rail cursor moved. Assert on
  the cursor and not on the category, because the category deliberately follows 150ms later.
- **Piping a long run through `grep` into a file block-buffers it**, so a hanging run looks the
  same as a quiet one. Write the full output per run and extract afterwards.
- **A benchmark that reads its state from a persistent profile has to assert that state, not
  fill in blanks.** `--playlist` was ignored whenever the profile already had one, so runs
  measured a playlist nobody had asked for and said nothing about it. The same shape of bug is
  worth looking for anywhere the harness reads something it did not just write.
- **A throttled renderer queues key presses for seconds, so a phase can measure the previous
  phase's input.** The presses that walk the harness into the channel list turned up during
  `resting`, which presses nothing: it reported 9 presses and 8 moves, and every number in that
  run belonged to a journey the label had finished describing. `settle()` cannot fix it, because
  it waits here and the queue is over there. `phase()` now asks the page when it last saw a key
  and waits for the queue to drain. The moves-against-presses column is what made it visible at
  all, after who knows how long.
- **A quarter of this machine being busy moves these numbers by a third.** Measured today: at a
  load of 2.1 the app reached its channel rows in 3969ms and compiled its bundle in 853ms, and at
  3.5 to 4.3 the same build took 5226ms and 1683ms. The busy warning triggers above `cores / 4`
  for that reason. If a run fails, read the load in the header before reading the failure.
- **Anything the browser timed itself has to be read from the browser, not noticed.** The
  launch watcher timed first paint by polling for the paint entry in `requestAnimationFrame`,
  so it recorded when the loop looked rather than when the frame went out: a 630ms paint was
  reported as 1100ms, which put it *after* the interface it has to precede. Two marks in an
  impossible order gets the whole measurement disbelieved, quite rightly. A test in that table
  may now answer with a timestamp instead of a boolean.
- **Never assert a DOM node against null with `node:assert`.** `assert.equal(queryByText(x), null)`
  sends assert off to serialise a jsdom element for its diff, which exhausts the worker's memory
  and kills it with exit 137, no stack trace and no failing test name. Assert on `textContent`,
  or on a boolean. Half an hour.

## Gates must be able to fail

Every gate here has, at some point, reported success without testing anything. When touching one,
ask what it does when the thing it measures is absent rather than wrong:

- A screen that renders nothing produces no boxes, and no boxes compares equal to no boxes.
  `harness.mjs` throws on an empty capture for this reason.
- A click by label that misses is a no-op, and both legs of a comparison miss identically, so
  they agree perfectly on screens neither of them visited. `harness.mjs` throws if a label is gone.
- Comparing only the reference's keys hides everything the reference failed to draw, and the
  reference is the oldest and slowest engine. `compare()` walks the union.
- A budget keyed on phase labels stops applying when a label is renamed. `sim.mjs` asserts the
  allowances and the measured phases are the same set.
- A benchmark that only rejects zero frames accepts a handful of frames from a window that went
  quiet. `bench.js` requires the frames to account for 80% of the phase's wall clock.
- `npm run tv:budget` needs `--playlist` on a fresh machine or CI, and refuses `--budget` without
  `--floor`. It silently exited 2 on every CI run for a while, under `continue-on-error`.
- Ask the browser its version rather than trusting the path it came from. `engine-parity.mjs`
  does, because a stale lock entry otherwise tests the wrong engine and passes.

## Engine support

Tizen 5.5 and newer, which is Chromium 69 through 130. `scripts/tv/platforms.json` is the only
place that table is written down; do not restate it in prose, it has been wrong in three files
before. The build targets es2019 for Chromium 69 and the stylesheet uses nothing newer, so every
later engine runs a strict superset and two engines cover the range.

**Every runtime branch on engine capability costs an engine in the matrix**, because the years
in between stop being unreachable the moment code can tell them apart. There is one such branch
today, the flex gap probe, and `tv:gap` covers it.

esbuild lowers syntax and not methods, so `?.` is safe on an old engine and `Array.at` would
ship and throw. `tv:engines` is what catches that.

## Storage

`services/store` is localStorage and is for settings, favourites and the last channel: short
strings needed before the first paint. `services/disk` is IndexedDB and is for the playlist text
and the logos. Samsung caps localStorage at 5MB per application, `setItem` is synchronous, and it
cannot hold a Blob. The disk cache keeps its own 5MB budget deliberately.

Do not do IndexedDB work on an interaction path. Writing each logo as it was decoded cost a
measurable regression, and reading the whole metadata store on every write cost an 840ms frame
while the interface was otherwise idle. Both are queued into idle time now.
