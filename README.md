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
| A failed channel before trying again | 4s, 8s, 15s | Then it stops, rather than retrying all night |
| A frozen picture before it counts as broken | 12s | A bad connection can stall for ten and recover |

Layer 1.1 is why a broken channel does not interrupt anything: it takes no focus and blocks
no keys, so pressing down to try the next one works exactly as it does when the picture is
fine. In a playlist where some channels are off the air, that is the difference between
hopping and being nagged.

### The panel

The picture is the home of the app, and the panel is the one place you go from it. It takes
1064 of 1920 so the picture it is chosen against stays visible, and it holds two panes with
only ever one cursor between them:

- **The rail**: Favourites, always first and present even when empty, then the playlist's
  own categories. Rows are two lines tall, because a group title written in two scripts
  cannot be truncated: an ellipsis removes the logical end of the string, which is the visual
  beginning of the right to left half, and what survives is the middle of a word.
- **The channels** in the category the rail is showing, headed by that category's name.

Focus and selection are drawn differently, because the guidelines treat them as different
states: the row the cursor is on inverts to a solid light fill only in the pane that holds
the remote, and the category being shown is marked with a bar instead.

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

## Tests

```bash
npm test         # the unit and component suite, no browser, no TV
npm run lint     # Biome
npm run check    # lint, typecheck and tests together, which is what CI runs
npm run tv:gap   # spacing parity for the sets without flex gap, needs a build first
```

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
- the **stores**, including the cache-then-refresh path and the request race
- the **four laws** of the key model, which the source argues for at length and which now
  have something holding them to it

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

## Testing against the TV, without the TV

Samsung's emulator is x86 and needs HAXM, which does not exist on Apple silicon, and their
simulator is a plain WebKit shell that says nothing about performance. So instead the app
runs in ordinary Chrome held down to measurements taken off the actual set over `sdb`:

```bash
npm run tv                  # the app under the TV's constraints, left running
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
the main thread. `--bench` walks a fixed journey once and reports the median and the 95th
percentile *frame time* within each phase, along with how many frames ran past 100ms.
`--profile` is an alias of `--bench`; there is no separate profiler.

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
  tv/gap-parity.mjs        spacing is the same with and without flex gap
```

## Keys

| Key | Watching | In the channel panel |
|:--|:--|:--|
| Up / Down | Previous and next channel | Move through the list |
| Left | Open the channel panel | Step out to the rail, then to the picture |
| Right | Open the info panel | Step into the channel list |
| OK | Pause and resume | Play the highlighted channel |
| Return | Open the channel panel | Step back, then offer to close the app |
| Ch+ / Ch- | Previous and next channel | Previous and next channel |
| Play, Pause, Stop, Track prev/next | Control playback | Control playback |
| 0-9 | Jump to a channel number | Jump to a channel number |
| Green | Favourite | Favourite |
| Yellow | Settings | Settings |

## Not there yet

EPG, recordings, and a search box. Playlists carry `tvg-id`, so an XMLTV guide is the
natural next addition.

## Licence

MIT. See [LICENSE](LICENSE).
