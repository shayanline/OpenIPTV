# Testing and measurement

Nobody here owns a 2020 Samsung television, and that is the problem every gate in this
repository exists to work around.

```bash
npm run check       # lint, typecheck, unit and component tests
npm run build       # required before any of the three gates below
npm run tv:gap      # spacing parity for the sets without flex gap
npm run tv:engines  # the app in a real Chromium 69 and a real Chromium 120
npm run tv:budget   # frame times and the launch on the floor profile, pass or fail
```

CI runs all of them. The budget is `continue-on-error`, for the reason in the last section.

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

What they cannot cover is video decode, GPU behaviour and real hardware timing.

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

Samsung's emulator is x86 and needs HAXM, which does not exist on Apple silicon, and their
simulator is a plain WebKit shell that says nothing about performance. So instead the app runs in
ordinary Chrome held down to measurements taken off the actual set over `sdb`:

```bash
npm run tv                  # the app under the TV's constraints, left running
npm run tv -- --fit         # lay out for this screen instead of the set's 1080p
npm run tv:floor            # the weakest Samsung sold since 2020, not your set
npm run tv:video            # the browser path instead, so channels play through hls.js
npm run tv:bench            # frame timings, then exit
npm run tv:bench:floor      # the same, against that floor
npm run tv:calibrate        # measure the real TV, write the throttle factor
```

`--floor` is the one to develop against. A flagship has enough headroom to hide almost any
mistake, so `scripts/tv/floor.json` describes the weakest thing Samsung has sold since 2020
instead: the T4300 and TU7000 class, Tizen 5.5, Chromium 69, quad Cortex-A53 and a gigabyte.
Samsung publishes no RAM or CPU figures in the developer documentation, but it does state minimum
hardware per Tizen version in its Common Criteria security filings, and the file cites where each
number comes from and how confident it is.

Its speed is held as a multiple of the reference set rather than as its own figure, so calibrating
against the real TV moves both. `--harsh=N` divides any profile further, and `--software` turns
the GPU off so anything bound by painting has nowhere to hide.

What the throttle does is worth knowing before trusting a number from it. It is a clock divider on
the renderer's main thread, measured linear out to 60x, so it models cores that are slow rather
than cores that are few. It reaches nothing else: workers, rasterising, compositing and the GPU
all run at full laptop speed, which is what `--software` exists to blunt. The network is
deliberately not scaled either, because the set is on household wifi and starving bandwidth
alongside the processor conflates a stall waiting for a segment with a dropped frame. Ask for it
with `--net=3g` when that is the question.

`scripts/tv/profile.json` holds what the set reports about itself: cores, memory, the JS heap
ceiling, the Chromium version and the panel. The figures are not repeated in prose, because
`npm run tv:calibrate` rewrites that file. The simulator throttles the CPU, caps V8's old space to
the set's real heap limit, sends the TV's user agent, and shims `webapis.avplay` and `tizen` so
the Tizen code paths actually run, with AVPlay's state machine enforced exactly as the real one
enforces it. It does not reproduce the GPU, so anything compositing bound will look better here
than it really is.

Leave `npm run tv` running and work in the window. It watches `dist/`, so it needs
`vite build --watch` alongside it, and it reloads the page rather than hot patching a module: the
production build is the only one worth judging speed on. There is a choice to make about the
player, because the two things worth testing are not compatible:

| | Tizen paths | Picture |
|:--|:--|:--|
| `npm run tv` | transparency, hole punch, remote keys, AVPlay state machine | placeholder |
| `npm run tv:video` | skipped, the app takes its browser path | real, via hls.js |

Both ignore the same origin policy, because the set's player fetches streams itself and has never
heard of it. A browser refusing a playlist on CORS grounds is the simulator being unfaithful
rather than the app being wrong. `--cors` puts it back.

`--fit` is for working on a screen smaller than the television's. Everything else still applies,
the slow cores, the heap ceiling, the user agent and the shimmed AVPlay: only the 1920x1080 goes.
Be clear about what it costs. A window 1512 wide is a screen no Samsung sells: the panel keeps its
1064 pixels and so takes a larger share of the width, the columns hold fewer rows, and anything
that would only crowd at the set's proportions looks fine here. It is a flag for working
comfortably, not for judging a layout, and `--bench`, `--profile` and `--budget` all refuse to run
with it.

Run `npm run tv:calibrate` once, with nobody watching, to replace the estimated throttle factor
with a measured one. It runs the same arithmetic on the TV and on the laptop and divides, and
refreshes the device facts while it has the set on the line. The number is a ratio between two
particular machines, so it stops being true if either changes: a different laptop, a firmware
upgrade that moves the set to a newer Chromium, or a Chrome release here that shifts the baseline.
The profile records what it measured against and `npm run tv` says so when that no longer matches.

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
    the bundle ran            70ms
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
a telewebion channel fails with `[STALLED]`; toggle on, the same channel plays and Diagnostics reads
`serving on port N`.

## The playlist and artwork it all runs against

12,732 channels in 175 categories, 2.7MB of text, a logo on nearly every channel and names in a
dozen scripts: [iptv-org's index](https://iptv-org.github.io/iptv/index.m3u). The harness fetches
it, keeps a copy for a day, serves it from localhost and asserts it into the simulator's settings
on every run, so there is nothing to pass and nothing to remember. `--playlist=` overrides it and
the header says which one was used, with its shape counted rather than assumed.

It is deliberately the largest playlist anybody is likely to point this app at, because that is
where the costs are. Nothing in the interface is expensive per pixel: it is expensive per row, per
logo and per category. Two hundred channels parse in 0.3ms and twelve thousand in 11.7ms, which is
about 0.7 seconds of frozen main thread on the floor, on the launch path, and the old benchmark
playlist could not see it. Neither could it see that a 2.7MB playlist was too big to cache at all,
so every launch downloaded it again.

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

## The budget

`npm run tv:budget` is the same walk with a pass or a fail on the end. One budget rather than
seven, because the floor is the weakest set in the supported range and everything newer is faster,
so a budget met there is met everywhere.

Two things are spent per phase, and neither is a maximum. **Stalls** counts frames past 100ms,
because the median was always fine: the interface was never uniformly slow, it froze for a third of
a second at a time, and 100ms is where Samsung's guidance says the viewer has to be told something
is happening. **Lag** is the median milliseconds from a press to the frame the highlight moved in,
and **slow** counts the presses that took longer than 100ms. Together they are the half that is
actually about the viewer: somebody holding the down key is watching whether the highlight keeps up
with their thumb, and an interface can hold a tidy 40ms frame while running four presses behind.

| journey | stalls | allowed | lag | worst | slow | allowed |
|:--|--:|--:|--:|--:|--:|--:|
| resting | 0 | 1 | | | | |
| racing the categories | 0 to 3 | 4 | 24 to 39 | 57 to 178 | 0 | 60 / 2 |
| and back up again | 0 to 1 | 4 | 18 to 25 | 42 to 81 | 0 | 60 / 2 |
| holding down a category | 0 to 11 | 16 | 27 to 54 | 57 to 104 | 0 | 75 / 3 |
| the same rows again | 1 to 24 | 30 | 21 to 63 | 69 to 149 | 0 to 1 | 85 / 5 |
| surfing channels | 5 to 23 | 24 | | | | |
| open, browse, choose | 14 to 29 | 34 | 39 to 64 | 65 to 92 | 0 | 90 / 5 |

The worst single press is printed and not gated, and that distinction was learned. Gated, it failed
a quiet run at 178ms having passed six runs between 57 and 116: the maximum of eighteen samples is
the least stable number available and one scheduling accident owns it. Counted over a threshold
instead, the same phases report 0 across every run.

So the application answers a press in 20 to 60ms depending on what the press causes, on the weakest
set Samsung sells, with twelve thousand channels loaded. The scrolling phases are the ones to be
unhappy about: every row's logo now actually arrives, so a 400 to 1200px PNG is decoded, resampled
into a 76x48 box, drawn to a canvas and written to flash for every row the highlight crosses.
Twelve to twenty four stalls in a scroll is the honest cost of that, and it is the next thing to fix
rather than the next thing to accept. The two phases with no lag figure have no highlight on screen
to answer with, and they are also the two that start streams, which in this simulator means hls.js
demuxing on the main thread in place of AVPlay: those are the loosest numbers here and the least
meaningful.

Repeatability came from pinning the starting state. The interface phases used to measure anywhere
between 2 and 18 stalls run to run on the same build, because each run inherited whichever channel
the previous one had left playing, so a phase named after scrolling a list was sometimes also
demuxing a 1080p stream. The seed forgets the last channel once per run, and nothing plays until a
phase starts one.

Three other things fail a run. A phase that measured *nothing*, because `requestAnimationFrame`
stops for a window the compositor thinks is hidden and a run where three of six journeys silently
recorded no frames used to print a cheerful summary anyway. A walk whose presses did not move the
highlight the same number of times, which is the strongest statement in the harness: eighteen
presses either moved it eighteen times or the phase is not the journey it is named after. And a heap
that grew more than 8MB across one walk, since a peak says nothing about a leak and a television is
left on the same app for hours.

## The launch

Every journey above begins three seconds after the application is already up, so a second added
between the viewer pressing the button and the channel list appearing would not have moved one
number. It is the most visible second in the application and it was the only one with no budget on
it.

The same run relaunches the app at the end and times five marks, in milliseconds from the
navigation. Five rather than one, because "five seconds" does not say what to fix:

| mark | what it is waiting for | floor | allowed |
|:--|:--|--:|--:|
| the bundle ran | the engine compiling and running 258KB | 853 to 1123 | 1500 |
| first paint | the app drawing anything at all | 936 to 1200 | 1600 |
| the interface | React having rendered something | 1187 to 1473 | 2000 |
| the channel rows | the playlist read off flash and parsed | 3969 to 4347 | 5800 |
| the channel named | the resumed channel announced | 4271 to 4641 | 6200 |

Those allowances are a ceiling on today's behaviour and emphatically not a target. Nearly five
seconds to a channel list is a bad launch. Writing it down is how it stops getting worse while it is
being worked on, and the split is where the work has to aim: a second before the application exists
at all, and two and a half more between the interface appearing and the rows arriving.

A relaunch and not the first load of the run, because they are different questions. A first launch
with nothing cached takes 5.2 seconds to reach a rail and is reported rather than budgeted, since it
depends on the network. The relaunch goes via `about:blank` first, which matters more than it sounds:
navigating from the app straight back to the app compiles the new page on the same thread that is
tearing down the old one, and the old one is holding twelve thousand channels. Measured that way "the
bundle ran" came out at 2585ms against 1192ms for a bundle that is byte for byte identical.

The run also asks, from outside, whether the playlist survived to the next launch at all, and fails
if it did not. That is not a frame time and it belongs there: a cached playlist means a launch reads
off flash, an uncached one means it downloads 2.7MB over the air every time the television is
switched on, and no frame time anywhere would say so. It caught exactly that, the first time it ran.

These marks are pessimistic by roughly a quarter of a second, and it is the simulator's fault rather
than the app's: hls.js is in every document here to carry out AVPlay's calls, and that is half a
megabyte of script a television never compiles, because its decoder is native. It stays in, because
taking it out for this one navigation leaves the shim on a plain `<video>` that cannot play HLS, so
the resumed channel fails and the launch being measured is one that draws a fault card and starts a
retry.

CI runs it but does not block on it. The throttle is a ratio between two particular machines and a
hosted runner is not the one it was calibrated against, so it is a regression alarm to read rather
than a tick to merge on.

## Measuring a change

**Always headless, and never compare a headless figure with a headful one.** `--bench` is headless
by default and that is a correctness matter: `requestAnimationFrame` stops for a window the
compositor thinks is occluded, and a window launched from a terminal is occluded the moment anybody
touches the keyboard. Headless has no window to be behind anything. It also means the numbers are
not vsync limited, so `resting` sits near 9ms rather than 16.7ms. `--headful` exists for when the
question is visual.

**Interleave a before and after, do not batch them.** Endpoint protection that scans on file
changes, which `npm ci` and `npm run build` both trigger, pushes the load average to five or six for
minutes at a time, and three runs of one side followed by three of the other puts any drift entirely
on one side. Alternate them, take medians, and use at least three rounds: single runs of a phase
have varied by a factor of two. A quarter of the machine being busy moves these numbers by a third,
so read the load in the header before reading a failure.

To measure against the code before a change, without disturbing the working tree:

```bash
git worktree add /tmp/iptv-before HEAD     # or whichever commit
cd /tmp/iptv-before && npm ci && npm run build && rm -rf node_modules
# serve that dist on another port, then point the current simulator at it, so the
# harness is identical and only the application differs:
node scripts/tv/sim.mjs --floor --bench --url=http://localhost:4180/ --playlist=...
```

Remove `node_modules` once built, or the scanner will be chewing through 185MB of new files during
the measurement. The two builds are on different ports and therefore different origins, so each has
its own localStorage and IndexedDB and each needs `--playlist`. Discard the first round on each
side, which is the only one that fetches the playlist over the network.

## Gates must be able to fail

Every gate here has, at some point, reported success without testing anything. When touching one,
ask what it does when the thing it measures is absent rather than wrong:

- A screen that renders nothing produces no boxes, and no boxes compares equal to no boxes.
  `harness.mjs` throws on an empty capture for this reason.
- A click by label that misses is a no-op, and both legs of a comparison miss identically, so they
  agree perfectly on screens neither of them visited. `harness.mjs` throws if a label is gone.
- Comparing only the reference's keys hides everything the reference failed to draw, and the
  reference is the oldest and slowest engine. `compare()` walks the union.
- A budget keyed on phase labels stops applying when a label is renamed. `sim.mjs` asserts the
  allowances and the measured phases are the same set.
- A benchmark that only rejects zero frames accepts a handful of frames from a window that went
  quiet. `bench.js` requires the frames to account for 80% of the phase's wall clock.
- `npm run tv:budget` refuses `--budget` without `--floor`. It silently exited 2 on every CI run
  for a while, under `continue-on-error`.
- Ask the browser its version rather than trusting the path it came from. `engine-parity.mjs` does,
  because a stale lock entry otherwise tests the wrong engine and passes.

## Known weaknesses

The throttle factor is an estimate stacked on an estimate, because `npm run tv:calibrate` has not
been run against the set, so every number here is correctly ordered and only roughly scaled. The
middle five engines are never exercised, which is sound while nothing branches on what the engine
can do and stops being sound the first time something does.

Nothing substitutes for a 2020 television. The three things no browser can answer are which font
the set resolves `system-ui` to, whether it overscans, and which keys its remote actually sends,
which is why the Diagnostics screen reports all three from the set itself.
