# SimpleIPTV

An IPTV player for Samsung Tizen TVs, and the same code runs in a desktop browser.

It ships with no channels. Point it at any extended M3U playlist and it plays what that
playlist contains, in whatever language the playlist is written in. Nothing about a name,
a group or a country is interpreted or rewritten: what the file says is what appears on
screen.

## Design

The interface follows Samsung's
[Smart TV design guidelines](https://developer.samsung.com/smarttv/design/design-principles.html)
and takes its look from [One UI](https://developer.samsung.com/one-ui/index.html).

The screen is a stack, and only the top of it shows:

| Layer | What |
|:--|:--|
| 1 | The player, always present |
| 1.1 | A failed channel, drawn inside the player |
| 2 | The playback banner and its key guide, transient |
| 3 | The channel panel |
| 4 | Settings, the close confirmation, first run |

A layer only appears when nothing above it is open, which is what stops the interface
piling up on itself. Choosing a channel closes the panel, the banner appears with the name
and holds while the channel tunes, and five seconds after the picture arrives it goes too.

### Four laws, no exceptions

A live TV app has two jobs competing for the same four keys: changing channel, which every
television gives to up and down, and controlling playback, which
[Samsung's media player guidance](https://developer.samsung.com/smarttv/design/media-player.html)
gives to the same directions. Answering both at once is how a key ends up meaning two things,
and this app used to print both meanings in one line of on-screen help.

1. **At the picture, up and down always change channel.** In every state, whatever is on
   screen, whatever holds the focus. In the channel list they move the highlight, because
   there is visibly a list with a highlight in it.
2. **OK does the obvious thing where it is pressed.** At the picture that is always the
   channel list. On a focused button it is that button.
3. **Left and right move within whatever is showing.** At the picture, left goes to the channel
   list, because that is what is off the left of the screen. Nothing is off the right, so right
   is not claimed: like any unrecognised key it just shows the banner, which is a press that
   answers rather than a press that does nothing.
4. **RETURN always goes back.** It clears the screen if anything is on it, closes the panel if
   the panel is open, and closes the application only when there is nothing left to close.

Law 1 is the one worth defending, and it is the reason nothing here can trap anybody: there is
no state at the picture, including a channel that has failed, where channel up leaves the viewer
where they were. Whatever has gone wrong, one press
moves on. What it costs is that the buttons cannot be reached with down, so they are reached
with right instead. What it buys is that there is nothing to learn.

| State | Up, Down | Left | Right | OK | Return |
|:--|:--|:--|:--|:--|:--|
| Picture | Channel | Channel list | Shows the banner | Channel list | Clear, then close the app |
| A failed channel | Channel | Channel list | Shows the banner | Channel list | Close the app |
| Channel list | The highlight | Categories, then out | Channels, then out | Watch | Back to the picture |

### No seek bar, deliberately

There was one, drawn from a live window measured off the stream, and it was the least honest
thing on the screen. Half of these servers report a window they do not have, so a channel that
had just started announced "8 minutes behind" over a picture that was live, and a channel with
no window at all showed a bar that could not move. It also spent two of the four directions and
a second focus level on skip back and skip forward, which do nothing at all on most of this
playlist.

Nothing replaced it. There are no on-screen playback buttons at all, and each one was removed
for the same reason: it was a permanent piece of the screen earning less than its keep.

**Pause** already has a key on the Smart Remote, a key on every keyboard (Space) and a button on
the on-screen pad, so a fourth way to reach it bought nothing. It still works from all three, and
resuming **rejoins the broadcast** rather than continuing from where it stopped: live television
has moved on and there is no bar to catch up with, so continuing would leave the viewer
permanently behind with nothing explaining why.

**Reload** was the last one to go. It existed for the commonest fault these relays have, a
picture that freezes while the connection stays open and the engine reports nothing wrong, which
neither engine will tell you about. That is a machine's job, not a viewer's: the player now
watches the playhead and, if it has not moved in twelve seconds and nobody pressed pause, reports
it as an ordinary failure, which the automatic retry picks up like any other. Nobody has to
notice, and nobody has to know what a button called Reload was for.

Choosing the channel that is already playing does nothing except put the list away. It used to
tear the stream down and rebuild it, which is a second of black and a re-buffer as the answer to
a viewer who opened the list, looked, and decided they were happy where they were.

### The picture reports on the picture, the banner reports on the channel

One line divides the two overlays, and it is worth stating because they used to overlap:

- **The middle of the picture** says what is happening to the picture: connecting, still
  connecting on a slow link, paused, or failed. It sits where the picture is missing, in words
  rather than in a spinner alone, because a slow connection and a dead channel look identical
  for the first half minute and the viewer is the one deciding whether to keep waiting.
- **The banner along the bottom** says which channel this is: the number, the name, where it
  sits in the list. Nothing else. Underneath it, in a box of its own, what the keys do.

Both were doing both. A spinner turned in the middle of the screen while the banner carried a
second status line saying the same thing in words, which is two answers to one question.

All four states share **one surface**, and that is the point rather than a tidy-up. Connecting
and failed used to be separate elements that took turns, and since a failed channel is retried
automatically they swapped places every few seconds: one card unmounted, a different card
mounted somewhere else, and the screen flashed on every cycle. They are the same statement at
different moments, so they are now the same box and only the words inside it change. Measured
across two retry cycles: zero mounts, zero unmounts. A fault also has to last half a second
before it is worth saying anything about, so the recoverable ones that come and go within a
frame never appear at all.

### Nothing has to be waited out, and nothing waits for you

Every transient thing on screen is cleared by one press of RETURN, all of it at once rather
than one layer per press. The timers only decide what happens if nobody asks:

| | Waits | Why |
|:--|:--|:--|
| The banner announcing a channel | 8s | Read, not operated, by somebody who may read slowly |
| The banner's buttons | 5s | What the media player guidance fixes for controls |
| A message | 4s | The popup guidance says three, and this is a sentence |
| A dialled number | 2s | Long enough to find three digits on a remote. OK ends it, RETURN abandons it |
| The channel list | 15s | A menu that closes while somebody is deciding reads as an interruption |
| Channel up and down before tuning | 0.45s | So holding the key changes channel once, not thirty times |
| The rail before the channel column follows it | 0.15s | So walking past a category never builds it |
| A failed channel before trying again | 4s, 8s, 15s | Then it stops, rather than retrying all night |
| A frozen picture before it counts as broken | 12s | A bad connection can stall for ten and recover |

Layer 1.1 is why a broken channel does not interrupt anything: it takes no focus and blocks
no keys, so pressing down to try the next one works exactly as it does when the picture is
fine. In a playlist where some channels are off the air, that is the difference between
hopping and being nagged.

### The panel

The picture is the home of the app, and the panel is the one place you go from it. It takes
1064 of 1920 so the picture it is chosen against stays visible. Three bands, and only ever one
cursor among them:

- **A title bar** across the top: the app's mark and name, and the Search and Settings keys on
  the trailing edge. The mark is an `<img>` at `public/icon.svg`, the same vector the set's
  launcher icon is rendered from, rather than the glyph copied into a component where the two
  would drift apart. They are the application's own controls rather than either column's, which is
  where they now say so: Settings used to sit inside the rail's header, and there was nowhere to
  put a second key that would not read as belonging to the channel list. The pair is one cursor
  position, reached by pressing up from the first category, with left and right choosing between
  them exactly as they move within anything else that is showing.
- **The rail**: Favourites first while there is something in it, then the playlist's own
  categories, under a subheader saying how many there are. The row appears with the first
  favourite and goes with the last, and the green key corrects the highlight as it does, so
  adding a favourite never moves the viewer out of the category they are reading. Rows are two
  lines tall, because a group title in two scripts cannot be truncated: an ellipsis removes the
  logical end of the string, which is the visual beginning of the right to left half, and what
  survives is the middle of a word.
- **The channels** in the category the rail is showing, headed by that category's name and its
  count, with a hairline divider between the two columns. Channel numbers are left aligned in a
  column as wide as the playlist's largest number, so the names line up whether there are nine
  channels or twelve thousand. They were right aligned in a fixed 58 pixels, which marched the
  digits away from the names and clipped the fifth figure outright.

### Searching

The Search key turns the channel column's heading into a field and its rows into matches from
the whole playlist, ranked so that names beginning with the query come first. The field is a
row of that column rather than a mode: down leaves it for the results, up from the first result
comes back to it, and the keyboard follows the cursor, so there is nothing to learn and no way
to be stuck somewhere with no way out.

It is the set's own on-screen keyboard, raised by focusing the field, which is what the playlist
address in Settings already relies on. While it has the field, left and right are a caret and
the digits are text: a viewer correcting the third letter of a name must not be thrown into the
category rail, and 0-9 cannot be dialling channels while somebody is typing.

Two things about it are performance decisions rather than design ones. The query is answered
150ms after the last keystroke, the same debounce the rail uses, because twelve thousand name
comparisons is 60 to 120ms on a 2020 set and typing "sport" would otherwise search five times.
And the results are capped at 300 with the header owning up to it, because one letter matches
thousands and nobody walks to row four hundred. The cap is per rank rather than per result, so a
channel actually called "BBC One" cannot be crowded out by three hundred channels with "bbc"
buried in the middle of their names.

Choosing a result takes the rail to that channel's category, exactly as dialling a number does.
Otherwise channel up and down would walk a category the playing channel is not in, and leaving
the search would land the viewer somewhere unrelated to what they are watching.

The cursor answers the key and the column follows it, rather than the two moving together.
Arriving at a category is the most expensive thing this app does, because every row is
thrown away and rebuilt from channel objects no memo has seen, and doing that on each press
of a held key measured at six frames a second on a 2020 set. So the highlight moves at once
and the column catches up 150ms after the pressing stops: walking past eight categories
builds one list instead of eight. It is the same idea as the tuner waiting before it changes
channel, which has been there from the start for the same reason.

Focus and selection are drawn differently, because the guidelines treat them as different
states: the row the cursor is on inverts to a solid light fill only in the pane that holds
the remote, and the category being shown is marked with a bar instead.

### Launching

Switch the television on and it comes back to the channel you were watching, with nothing
over it. The panel used to open on every launch and close again once the remembered channel
had been found, so the viewer watched a menu appear, wait out the playlist, and slide away
from a channel they had not chosen. The decision is now made on the first render, from what
localStorage already knows, which is the only way for it not to be visible. A remembered
channel that has since gone from the playlist is the one case that opens the list, because
the alternative is a black screen that has silently given up.

A launch shows the cached playlist and stops there. It used to show the cache and then go to
the network regardless, so every launch paid for the playlist twice before the first
picture: a download, a second parse of text that was almost always identical, and a
synchronous write of the whole file back to the set's flash, all on the main thread and all
between the button being pressed and the channel starting.

A playlist is a file somebody edits occasionally, not a feed, so the copy is stamped and
trusted for six hours. Past that it is still shown first and refreshed behind the picture, in
idle time, and if the bytes come back identical, which is the ordinary case, nothing is parsed
and nothing is written. Settings has a Refresh that ignores all of it.

### Two stores, for two different jobs

| | Holds | Why |
|:--|:--|:--|
| `services/store` | localStorage | Settings, favourites, the last channel. Short strings that have to be readable before the first paint, which is what a synchronous API is for. |
| `services/disk` | IndexedDB | The playlist text and the logos. |

The split is not tidiness. Samsung documents localStorage as holding "up to 5 MB of data for
your application", and a twelve thousand channel playlist is around 2.3MB of text, so one
large playlist plus the settings was already most of the allowance and a larger one did not
fit at all. The failure is a thrown `QuotaExceededError`, which the store quite correctly
swallows, so the effect was a cache that silently stopped working on exactly the playlists
that most needed one. `setItem` is also synchronous, so it wrote those megabytes to flash on
the main thread during launch. And it cannot hold a Blob, which a logo is.

IndexedDB has been on these televisions since Tizen 2.4, five years before the oldest set
this supports, so none of it is a new dependency on a new engine.

The budget stays at **5MB**, deliberately. Moving to a store with a far larger quota is not a
reason to use one: everything in there is refetchable, so a bigger number buys fewer refetches
and costs somebody else their space. Over budget, the least recently used entry goes first,
and something larger than the whole budget is refused outright rather than emptying the cache
in a doomed attempt to fit it. Diagnostics reports what is held.

Three things kept it from growing without bound, none of which existed before:

- **Cached playlists are keyed by address, not by playlist id.** The id survives the address
  being edited, so a viewer who corrected a typo in a URL was served the previous playlist's
  channels from a cache that believed itself current.
- **A sweep at launch** drops cached playlists nothing is configured to watch. Removing a
  playlist used to leave its copy behind for good, and no code could have removed it
  afterwards: the key was derived from an id that no longer existed, so nothing knew the
  entry's name.
- **Logos are saved at the size they are drawn**, a few kilobytes each, not as the original.
  The expensive part of a logo was never the download, it is the decode: broadcasters host
  artwork at whatever size suits them, two thousand pixels square being real, and fifteen of
  those at once froze the interface for three and a half seconds. Saving the original would
  have spared the network and left that cost exactly where it was, on every launch. Saving the
  reduced one needs a canvas read, which tainting forbids, so it works on a television, where
  a packaged app declares the origins it may reach, and quietly does not in a desktop browser,
  where most hosts refuse the fetch. Same trade the resizing itself already makes.

## Why a web app

A Tizen web app is a packaged web app, so a TV player can be written with ordinary web
tooling. The part worth owning is playback. On the TV this uses `webapis.avplay`, the
hardware pipeline, which is considerably more forgiving of awkward manifests than the
browser engine in the same firmware: long sliding windows, unusual sequence numbering and
mid-stream discontinuities are all common in live playlists and all defeat a software
player sooner or later.

On a desktop there is no AVPlay, so hls.js drives a plain `<video>`. Same UI, same
playlist, instant reload, real dev tools.

## Running it

Node 22.18 or newer, which `.nvmrc` pins. The test runner and the type stripping both
depend on it.

```bash
nvm use            # or any Node >= 22.18
npm install
npm run dev        # http://localhost:5173
```

The arrow keys and Enter share key codes with the remote, so the whole interface is usable
from a keyboard. A **floating Smart Remote** appears in development, with the D-pad, the
transport keys, the coloured keys and the number pad. It dispatches the same key events the
TV sends rather than calling handlers directly, so what you test is what the set will do.
Add `?remote` in development to summon it. It is not in a production build at all: the
bundler drops it, so it cannot be conjured onto a television.

## Which televisions, and what that costs

Every Samsung set from 2020, which is Tizen 5.5 and newer. That is seven browser engines:

| Model year | Tizen | Chromium |
|:--|:--|:--|
| 2020 | 5.5 | **69**, the floor |
| 2021 | 6.0 | 76 |
| 2022 | 6.5 | 85 |
| 2023 | 7.0 | 94 |
| 2024 | 8.0 | 108 |
| 2025 | 9.0 | **120**, the ceiling tested against |
| 2026 | 10.0 | 130 |

Samsung's own table, quoted in `scripts/tv/platforms.json`, which is the only place it is
written down. It used to be repeated in prose in three files and two of them said the 2020
sets run Chromium 76, a year and an engine wrong.

**One artifact, built for the floor, with no branching by model year.** Consistency does not
come from testing seven televisions, it comes from having nothing that can differ between
them. The build targets es2019 and the stylesheet uses nothing newer than Chromium 69 can
do, so every set above the floor runs a strict superset of what the app asks for and a
middle year cannot fail in a way both ends pass. That is why the matrix below is two engines
rather than seven.

There is exactly one runtime branch on what the engine can do, the flex gap probe, and it
has a gate of its own. The rule that follows is worth stating: **every capability branch
added costs an engine in the matrix**, because the years in between stop being unreachable
the moment code can tell them apart.

Not every difference is testable in a browser, and the three that are not are all on the
Diagnostics screen in Settings instead: what the set says it is, whether flex gap survived,
and every key the remote actually sends. "The yellow button does nothing on my TV" is not
answerable by reading the source and takes about four seconds from that screen.

## Tests

```bash
npm test           # the unit and component suite, no browser, no TV
npm run lint       # Biome
npm run check      # lint, typecheck and tests together
npm run tv:gap     # spacing parity for the sets without flex gap, needs a build first
npm run tv:engines # the app in a real Chromium 69 and a real Chromium 120
npm run tv:budget  # frame times on the floor, as a pass or fail
```

CI runs all six.

Vitest runs them, through Vite, so a test resolves imports exactly as the application does.
That matters more than it sounds: the previous runner resolved through Node, which refuses
extensionless imports, so only modules whose every relative import was a type import could
be loaded at all and the player, the stores and the logo cache were untestable by accident
rather than by choice.

They cover the parts where a mistake is quiet rather than obvious:

- the **M3U parser**, the one component fed by strangers
- the **windowing arithmetic** that decides which rows exist at all
- the **error mapping** from an engine's code to something a viewer can act on
- the **player**, both watchdogs and the AVPlay call ordering, which is legal in one state
  only and silently plays nothing when it is wrong
- the **logo queue**, where a cancelled job that is dropped rather than resolved wedges an
  address for the rest of the session
- the **stores**, including the cache-then-refresh path, the request race, the refresh that is
  deliberately not waited for, the sweep that is the only thing able to delete a cached
  playlist, and that editing an address does not serve the old playlist from cache
- the **cache's eviction arithmetic**, which is a pure function for the same reason the
  windowing is: getting it wrong means quietly throwing away the entry it was about to read
- **resuming**, and specifically that the panel is shut on the first render rather than shut
  afterwards, since ending up closed is what the old behaviour did too
- the **four laws** of the key model, which the source argues for at length and which now
  have something holding them to it
- the **rail's two stages**, that the cursor answers the press and the column does not,
  because nothing on screen says that has regressed except that it feels slow

What they cannot cover is video decode, GPU behaviour and real hardware timing. For those
there is the simulator below, and ultimately the set.

### Spacing on the old sets

`gap` on a flex container arrived in Chromium 84 and these televisions run 76, with the
floor profile at 69. The stylesheet therefore carries a second, margin based set of spacing
rules under `.no-flex-gap`, chosen at startup by a measured probe, because CSS cannot detect
this: `@supports (gap: 1px)` is true on those engines, since gap is perfectly valid there
for grid.

No browser on any developer's machine ever uses those rules, which is exactly how they rot.
`npm run tv:gap` loads the built app twice, once normally and once with flex gap neutralised
and the fallback on, and compares the position and size of every child of every gap using
container. They must match. CI runs it.

### The engines themselves

Spoofing a user agent proves nothing about an engine. `npm run tv:engines` runs the built
app in a real Chromium 69 and a real Chromium 120, pinned to the versions Samsung ships and
downloaded once from the snapshot archive into `~/.cache`. It walks both through every
screen and asserts two things:

1. **Nothing throws.** This is the half that matters. esbuild lowers *syntax*, so `?.`
   becomes safe on an old engine, and leaves *methods* exactly where they are, so an
   `Array.at` would ship and throw on a 2020 set with nothing in the build or the type
   checker to notice. React 19 turns out to be clean here: it feature detects
   `queueMicrotask`, which is Chromium 71, and falls back to a Promise.
2. **The layout lands in the same place**, within four pixels, on the structural boxes.
   Four because the differences fall into two groups with nothing between them: a handful at
   three or four pixels, all of them text shaping, which genuinely did change between M69
   and M120 and which no CSS will reconcile, and the rest above thirty two, all of them a
   box in the wrong place.

It found a real fault on its first run. An absolutely positioned box with `left: 0;
right: 0; width: auto` is supposed to stretch to its containing block, and does, unless it
is also a flex container on Chromium 69, where it shrink wraps instead. Every channel row
and every category row is one. On every set sold in 2020 the rows were as wide as their own
text: badges and stars against the channel name rather than at the right edge, and the focus
highlight, which is a background on the row, a short bar around the words instead of the
full width fill the whole interface is built on. The one thing that has to be legible from
across a room was the thing that broke, and it had been shipping.

Two engines and not seven, for the reason set out above. `--all` runs the lot when a
capability branch has made the middle years reachable.

On Linux both engines are the pinned builds. On a current macOS the M120 snapshot segfaults
on startup, arm64 and x64 alike, signed or not, so the ceiling falls back to the installed
Chrome and says so. The floor never falls back: substituting a modern engine there would
compare two modern engines, find them alike, and report a test that did not run.

Which build is which commit is recorded in `scripts/tv/engines.lock.json`, so CI and a
laptop fetch the same bytes. Snapshots are per commit and not every commit was built, so the
position a release maps to is often missing and the search walks outwards to the nearest one
either side, which in practice is within about twenty. `node scripts/tv/engines.mjs`
resolves every engine for every platform and rewrites the lock, without downloading
anything. It is a one off unless a row is added to `platforms.json`.

## Testing against the TV, without the TV

Samsung's emulator is x86 and needs HAXM, which does not exist on Apple silicon, and their
simulator is a plain WebKit shell that says nothing about performance. So instead the app
runs in ordinary Chrome held down to measurements taken off the actual set over `sdb`:

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
mistake, so the profile in `scripts/tv/floor.json` describes the weakest thing Samsung has
sold since 2020 instead: the T4300 and TU7000 class, Tizen 5.5, Chromium 69, quad
Cortex-A53 and a gigabyte. Those are not invented. Samsung publishes no RAM or CPU anywhere
in the developer documentation, but it does state minimum hardware per Tizen version in its
Common Criteria security filings, and the file cites where each number comes from and how
confident it is.

Its speed is held as a multiple of the reference set rather than as its own figure, so
calibrating against the real TV moves both. `--harsh=N` divides any profile further, and
`--software` turns the GPU off so anything bound by painting has nowhere to hide.

`--fit` is for working on a screen smaller than the television's. Everything else about the
simulator still applies, the slow cores, the heap ceiling, the user agent and the shimmed AVPlay:
only the 1920x1080 goes, so the interface lays out for the window it is in and a laptop shows all
of it. The simulated video plane is scaled into that window too, since the app passes its rect as
constants in the set's own 1920x1080 space.

Be clear about what it costs, because it is not nothing. A window 1512 wide is a screen no
Samsung sells: the panel keeps its 1064 pixels and so takes a larger share of the width, the
columns hold fewer rows, and anything that would only crowd at the set's proportions looks fine
here. It is a flag for working comfortably, not for judging a layout.

It cannot touch any of the gates. `--bench`, `--profile` and `--budget` all refuse to run with it,
because fewer pixels per frame and fewer rows per column would make the journeys cost and cover
something a television does not. `tv:gap` and `tv:engines` have their own launchers, both fixed at
1920x1080, and neither reads this file's arguments, so the only way to scale a gate is to change
the gate. Nothing about a run without the flag changed either: the resolution override is sent
with exactly the fields it always was, and the simulated video plane's arithmetic works out to
precisely 1 at 1920x1080.

What the throttle actually does is worth knowing before trusting a number from it. It is a
clock divider on the renderer's main thread, measured linear out to 60x, so it models cores
that are slow rather than cores that are few. It reaches nothing else: workers, rasterising,
compositing and the GPU all run at full laptop speed, which is what `--software` exists to
blunt. Reducing the core count is the lesser axis anyway, since almost nothing here leaves
the main thread.

The network is deliberately not scaled with the rest: the set is on household wifi, and
starving bandwidth alongside the processor conflates a stall waiting for a segment with a
dropped frame. Ask for it with `--net=3g` when that is the question.

Measuring needs a production build and the tool refuses to run against the dev server,
because React validates every element it creates in development and that alone came to half
the main thread. `--bench` walks a fixed journey once and reports, per phase, the median and
95th percentile *frame time*, the frames past 100ms, and how long the highlight took to answer
a press. `--profile` is an alias of `--bench`; there is no separate profiler. `--gap=120`
paces the presses at a rate a real remote could manage, for anyone who wants to check that the
default of 33ms is deliberately faster than a finger rather than a claim about hardware.

### The playlist it all runs against

12,732 channels in 175 categories, 2.7MB of text, a logo on nearly every channel and names in
a dozen scripts: [iptv-org's index](https://iptv-org.github.io/iptv/index.m3u). The harness
fetches it, keeps a copy for a day, serves it from localhost and asserts it into the
simulator's settings on every run, so there is nothing to pass and nothing to remember.
`--playlist=` overrides it and the header says which one was used, with its shape counted
rather than assumed.

It is deliberately the largest playlist anybody is likely to point this app at, because that
is where the costs are. Nothing in the interface is expensive per pixel: it is expensive per
row, per logo and per category. Two hundred channels parse in 0.3ms and twelve thousand in
11.7ms, which is about 0.7 seconds of frozen main thread on the floor, on the launch path,
and the old benchmark playlist could not see it. Neither could it see that a 2.7MB playlist
was too big to cache at all, so every launch downloaded it again.

Served locally rather than from the CDN because a launch measurement that includes 2.7MB
over somebody's wifi is a measurement of somebody's wifi. Refreshed daily rather than never,
because a playlist that never expired would quietly stop being the one the URL names.

The artwork is served locally too, and that one changed the numbers most. The playlist points
at 10,602 logos on a few hundred hosts and most of them are dead: eight runs of the walk cached
280 of them. So the interface phases were measuring a list with almost no artwork in it, plus a
few hundred requests failing at whatever rate DNS felt like that minute, which is how one phase
reported 1 stall in three consecutive rounds and 21 in the fourth with no code between them.
Every logo address is now rewritten to a locally served PNG, one per channel and stable between
runs, deliberately 400 to 1200px so the decode and the resample into a 76x48 box are real work,
in twelve colourways so that a screenful of them cannot be mistaken for a placeholder that
everything fell back to. `--real-logos` puts the playlist's own addresses back for the day the
question is what the internet does to a launch.

**Only when measuring.** `npm run tv` shows the playlist's real artwork, dead hosts and all,
because the entire point of the headful simulator is that somebody looks at it and believes what
they see. The header of every run says which of the two it did, and at what address it served
them.

### One budget, on the floor

`npm run tv:budget` is the same walk with a pass or a fail on the end. One budget rather than
seven, because the floor is the weakest set in the supported range and everything newer is
faster, so a budget met there is met everywhere.

Two things are spent per phase, and neither is a maximum. **Stalls** counts frames past 100ms,
because the median was always fine: the interface was never uniformly slow, it froze for a
third of a second at a time, and 100ms is where Samsung's guidance says the viewer has to be
told something is happening. **Lag** is the median milliseconds from a press to the frame the
highlight moved in, and **slow** counts the presses that took longer than 100ms. Together they
are the half that is actually about the viewer: somebody holding the down key is watching
whether the highlight keeps up with their thumb, and an interface can hold a tidy 40ms frame
while running four presses behind. Frame times alone call that a pass.

| journey | stalls | allowed | lag | worst | slow | allowed |
|:--|--:|--:|--:|--:|--:|--:|
| resting | 0 | 1 | | | | |
| racing the categories | 0 to 3 | 4 | 24 to 39 | 57 to 178 | 0 | 60 / 2 |
| and back up again | 0 to 1 | 4 | 18 to 25 | 42 to 81 | 0 | 60 / 2 |
| holding down a category | 0 to 11 | 16 | 27 to 54 | 57 to 104 | 0 | 75 / 3 |
| the same rows again | 1 to 24 | 30 | 21 to 63 | 69 to 149 | 0 to 1 | 85 / 5 |
| surfing channels | 5 to 23 | 24 | | | | |
| open, browse, choose | 14 to 29 | 34 | 39 to 64 | 65 to 92 | 0 | 90 / 5 |

The worst single press is printed and not gated, and that distinction was learned. Gated, it
failed a quiet run at 178ms having passed six runs between 57 and 116: the maximum of eighteen
samples is the least stable number available and one scheduling accident owns it. Counted over
a threshold instead, the same phases report 0 across every run.

So the application answers a press in 20 to 60ms depending on what the press causes, on the
weakest set Samsung sells, with twelve thousand channels loaded. Which had never been
measured, and is the number worth defending: a viewer holding a key feels that and nothing
else. The scrolling phases are the ones to be unhappy about, and the reason is in the next
paragraph. The two phases with no lag figure have no highlight on screen to answer with, and
they are also the two that start streams, which in this simulator means hls.js demuxing on the
main thread in place of AVPlay: the picture is a simulator artefact rather than the app, so
they are the loosest numbers here and the least meaningful.

Two of those allowances went *up*, and it is worth being clear about why, because the numbers
they replace were flattering. The old benchmark playlist pointed at logos on hosts that are
mostly gone: they failed in milliseconds, so the scroll phases were measuring a list with
almost no artwork in it and reporting 0 or 1 stalls. Serving the artwork locally means every
row's logo actually arrives, so a 400 to 1200px PNG is decoded, resampled into a 76x48 box,
drawn to a canvas and written to flash for every row the highlight crosses. Twelve to twenty
four stalls in a scroll is the honest cost of that, and it is the next thing to fix rather than
the next thing to accept.

The other half of the repeatability came from pinning the starting state. The interface phases
used to measure anywhere between 2 and 18 stalls run to run on the same build, because each run
inherited whichever channel the previous one had left playing, so a phase named after scrolling
a list was sometimes also demuxing a 1080p stream. The seed forgets the last channel once per
run, and nothing plays until a phase starts one.

Three other things fail it. A phase that measured *nothing*, because
`requestAnimationFrame` stops for a window the compositor thinks is hidden and a run where
three of six journeys silently recorded no frames used to print a cheerful summary anyway. A
walk whose presses did not move the highlight the same number of times, which is the
strongest statement in the harness: eighteen presses either moved it eighteen times or the
phase is not the journey it is named after. And a heap that grew more than 8MB across one
walk, since a peak says nothing about a leak and a television is left on the same app for
hours.

### And the launch, which nothing measured at all

Every journey above begins three seconds after the application is already up, so a second
added between the viewer pressing the button and the channel list appearing would not have
moved one number in this file. It is the most visible second in the application and it was
the only one with no budget on it.

The same run now relaunches the app at the end and times five marks, in milliseconds from
the navigation. Five rather than one, because "five seconds" does not say what to fix:

| mark | what it is waiting for | floor | allowed |
|:--|:--|--:|--:|
| the bundle ran | the engine compiling and running 258KB | 853 to 1123 | 1500 |
| first paint | the app drawing anything at all | 936 to 1200 | 1600 |
| the interface | React having rendered something | 1187 to 1473 | 2000 |
| the channel rows | the playlist read off flash and parsed | 3969 to 4347 | 5800 |
| the channel named | the resumed channel announced | 4271 to 4641 | 6200 |

Those allowances are a ceiling on today's behaviour and emphatically not a target. Nearly
five seconds to a channel list is a bad launch. Writing it down is how it stops getting worse
while it is being worked on, which is a different job from making it good, and the split is
where the work has to aim: a second before the application exists at all, and two and a half
more between the interface appearing and the rows arriving.

A relaunch and not the first load of the run, because they are different questions. A first
launch with nothing cached takes 5.2 seconds to reach a rail and is reported rather than
budgeted, since it depends on the network. The relaunch goes via `about:blank` first, which
matters more than it sounds: navigating from the app straight back to the app compiles the new
page on the same thread that is tearing down the old one, and the old one is holding twelve
thousand channels. Measured that way "the bundle ran" came out at 2585ms against 1192ms for a
bundle that is byte for byte identical. A television starts the app in a fresh runtime with
nothing else in it, so the harness does too. What it cannot measure either way is the set's own
runtime starting, which is the platform's second and not ours.

A mark that never arrives is a failure and not a footnote, for the same reason a phase that
measures no frames is: it is what a renamed selector looks like, and it is indistinguishable
from an application that never finished starting. Both were checked by breaking them.

The run also asks, from outside, whether the playlist survived to the next launch at all, and
fails if it did not. That is not a frame time and it belongs there: a cached playlist means a
launch reads off flash, an uncached one means it downloads 2.7MB over the air every time the
television is switched on, and no frame time anywhere would say so. It is silent in the
interface by design, because a cache that will not take is not worth interrupting a viewer
over. It caught exactly that, the first time it ran.

These marks are pessimistic by roughly a quarter of a second, and it is the simulator's fault
rather than the app's: hls.js is in every document here to carry out AVPlay's calls, and that
is half a megabyte of script a television never compiles, because its decoder is native. It
stays in, because taking it out for this one navigation leaves the shim on a plain `<video>`
that cannot play HLS, so the resumed channel fails and the launch being measured is one that
draws a fault card and starts a retry. A known overstatement beats measuring a different
application.

CI runs it but does not block on it. The throttle is a ratio between two particular machines
and a hosted runner is not the one it was calibrated against, so it is a regression alarm to
read rather than a tick to merge on.

`scripts/tv/profile.json` holds what the set reports about itself: cores, memory, the JS
heap ceiling, the Chromium version and the panel. The figures are not repeated here, because
`npm run tv:calibrate` rewrites that file, and a copy in prose is a copy that goes stale the
first time anybody runs the command this page recommends. None of it is in Samsung's
published specifications, which give no RAM, CPU or clock at all.

The simulator throttles the CPU, caps V8's old space to the set's real heap limit, sends the
TV's user agent, and shims `webapis.avplay` and `tizen` so the Tizen code paths actually
run, with AVPlay's state machine enforced exactly as the real one enforces it. It does not
reproduce the GPU, so anything compositing bound will look better here than it really is.

Leave `npm run tv` running and work in the window. It watches `dist/`, so it needs
`vite build --watch` alongside it, and it reloads the page rather than hot patching a module:
the production build is the only one worth judging speed on, and a cold start is the more
honest reset on a television anyway. There is a choice to make about the player, because the
two things worth testing are not compatible:

| | Tizen paths | Picture |
|:--|:--|:--|
| `npm run tv` | transparency, hole punch, remote keys, AVPlay state machine | placeholder |
| `npm run tv:video` | skipped, the app takes its browser path | real, via hls.js |

Both ignore the same origin policy, because the set's player fetches streams itself and has
never heard of it. A browser refusing a playlist on CORS grounds is the simulator being
unfaithful rather than the app being wrong. `--cors` puts it back.

Run `npm run tv:calibrate` once, with nobody watching, to replace the estimated throttle
factor with a measured one. It runs the same arithmetic on the TV and on the laptop and
divides, and refreshes the device facts while it has the set on the line.

It is a one-off in practice, but the number is a ratio between two particular machines, so
it stops being true if either changes: a different laptop, a firmware upgrade that moves
the set to a newer Chromium, or a Chrome release here that shifts the baseline. The profile
records what it measured against and `npm run tv` says so when that no longer matches, so
there is nothing to remember. It also reports the spread of its samples and tells you to
run again if the machine was busy at the time.

## Building for the TV

```bash
npm run package    # builds, then signs dist/ into build/SimpleIPTV.wgt
npm run deploy     # installs over sdb and launches, TV_IP optional if already paired
```

Packaging needs the Tizen CLI. `dist/` is already a complete widget root, since Vite copies
`public/config.xml` and `public/icon.png` next to `index.html`, so signing is the only step
the CLI performs. `npm run deploy` always rebuilds first, so what lands on the set is what
is in the working tree.

The icon is generated rather than kept by hand: `public/icon.svg` is the master and
`npm run icon` redraws `public/icon.png` from it at 512 square, using the same headless
Chrome the simulator already needs. Every size the set and the store ask for is a downscale
from that one file, so the vector and the bitmap cannot drift apart.

Three environment variables, all optional, all for when the toolchain is somewhere unusual:

| | |
|:--|:--|
| `SIGNING_PROFILE` | the Certificate Manager profile to sign with, `SimpleIPTV` by default |
| `TIZEN_CLI` | path to the `tizen` binary, when it is not in one of the usual places |
| `SDB` | path to `sdb`, likewise |
| `TV_IP` | which set to install to, when more than one is paired |

Two certificates are involved:

- an **author** certificate, which you generate yourself in Certificate Manager
- a **distributor** certificate, which for a retail TV must be issued by Samsung against
  that TV's DUID. The generic Tizen distributor certificate signs happily and is then
  refused by the set with a certificate error at install

The DUID comes from the TV over `sdb`, so developer mode has to be working first: enable it
on the TV, enter this machine's IP, and restart the set before port 26101 opens.

## Layout

```
src/
  App.tsx                  the screen stack and the key routing, and nothing else
  services/m3u.ts          playlist parser, tolerant of the ways M3U is abused
  services/player.ts       one interface over AVPlay and hls.js
  services/logos.ts        decode logos once, at the size they are drawn, and queue the work
  services/capabilities.ts what the engine can actually do, measured rather than assumed
  services/metrics.ts      the measurements the stylesheet shares with the code
  services/store.ts        localStorage, for the short strings needed before first paint
  services/disk.ts         IndexedDB, for the playlist and the logos, on a 5MB budget
  services/idle.ts         work that must never be why a key press waits
  stores/channels.ts       channels, categories, favourites, last watched
  hooks/useTuner.ts        the player's life, channel changing, pausing, automatic retry
  hooks/useChrome.ts       the banner, messages and dialled digits, and their timers
  hooks/useRemote.ts       remote key codes, and registering them with Tizen
  hooks/useSpatialNav.ts   four directional focus movement over arbitrary controls
  hooks/useWindowed.ts     renders a slice of a long list instead of all of it
  components/              panels, dialogs, and the debug Smart Remote
  components/settings/     one file per section of the settings sheet
scripts/
  package.sh               build and sign
  deploy.sh                build, install over sdb and launch
  icon.mjs                 redraw public/icon.png from public/icon.svg
  tv/                      run the app under the TV's measured constraints
  tv/platforms.json        Samsung's engine matrix, the only copy of it
  tv/engines.mjs           fetch the real Chromium a given TV runs
  tv/harness.mjs           serve the build, walk every screen, measure the boxes
  tv/gap-parity.mjs        spacing is the same with and without flex gap
  tv/engine-parity.mjs     behaviour is the same on Chromium 69 and 120
```

## Keys

| Key | Watching | In the channel panel | Searching |
|:--|:--|:--|:--|
| Up / Down | Previous and next channel | Move through the list | Between the field and the results |
| Left | Open the channel panel | Out to the rail, then out of the panel from a category | Move the caret |
| Right | Hide the banner | Further in at every stop, and plays the channel at the last one | Move the caret |
| OK | Pause and resume | Play the highlighted channel | Show the matches, then play one |
| Return | Open the channel panel | Step back, then offer to close the app | Clear, then leave the search |
| Ch+ / Ch- | Previous and next channel | Previous and next channel | Previous and next channel |
| Play, Pause, Stop, Track prev/next | Control playback | Control playback | Control playback |
| 0-9 | Jump to a channel number | Jump to a channel number | Type a digit |
| Green | Favourite | Favourite | Favourite |
| Yellow | Settings | Settings | Settings |

In the title bar, left and right choose between Search and Settings before they leave it, which
is the same rule as everywhere else: those two keys move within whatever is showing first. Both
edges of the pair then lead to the categories rather than out of the panel, so a walk rightwards
crosses everything in order, Search, Settings, categories, channels, and leaving the bar leftwards
lands on the categories a few pixels below rather than closing the whole thing. RETURN is the key
that closes the panel, as it is everywhere else.

Right keeps going further in at every stop, and at the last column the only thing further in is
the programme, so it plays the highlighted channel exactly as OK does. That is not a new door:
choosing a channel closes the panel too, which is what right used to do there on its own.

At the picture, right has nothing to travel to and puts away whatever is on the screen instead. It
is the pair of the press that raised the banner, since any key the app does not otherwise own
brings it up. RETURN still does it too and goes on to offer to close the application once the
screen is clear, so the two are not the same key with the same job.

## Not there yet

EPG, recordings, and a search box. Playlists carry `tvg-id`, so an XMLTV guide is the
natural next addition.

Two things about the testing are known to be weaker than they read. The throttle factor is
still an estimate stacked on an estimate, because `npm run tv:calibrate` has not been run
against the set, so every number in this file is correctly ordered and only roughly scaled.
And the middle five engines are never exercised: that is sound while nothing branches on
what the engine can do, and it stops being sound the first time something does.

Nothing here substitutes for a 2020 television. The three things no browser can answer are
which font the set resolves `system-ui` to, whether it overscans, and which keys its remote
actually sends, which is why the Diagnostics screen reports all three from the set itself.

## Licence

MIT. See [LICENSE](LICENSE).
