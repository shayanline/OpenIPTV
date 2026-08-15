# Design notes

Why the interface is shaped the way it is. The source carries the detail, this is the part
worth reading before changing anything.

The interface follows Samsung's
[Smart TV design guidelines](https://developer.samsung.com/smarttv/design/design-principles.html)
and takes its look from [One UI](https://developer.samsung.com/one-ui/index.html).

## The screen is a stack

| Layer | What |
|:--|:--|
| 1 | The player, always present |
| 1.1 | A failed channel, drawn inside the player |
| 2 | The playback banner and its key guide, transient |
| 3 | The channel panel |
| 4 | Settings, the close confirmation, first run |

A layer only appears when nothing above it is open, which is what stops the interface piling
up on itself. Choosing a channel closes the panel, the banner appears with the name and holds
while the channel tunes, and five seconds after the picture arrives it goes too.

## Four laws, no exceptions

A live TV app has two jobs competing for the same four keys: changing channel, which every
television gives to up and down, and controlling playback, which
[Samsung's media player guidance](https://developer.samsung.com/smarttv/design/media-player.html)
gives to the same directions. Answering both at once is how a key ends up meaning two things,
and this app used to print both meanings in one line of on screen help.

1. **At the picture, up and down always change channel.** In every state, whatever is on
   screen, whatever holds the focus. In the channel list they move the highlight, because
   there is visibly a list with a highlight in it.
2. **OK does the obvious thing where it is pressed.** At the picture that is always the
   channel list. On a focused button it is that button.
3. **Left and right move within whatever is showing.** At the picture, left goes to the
   channel list, because that is what is off the left of the screen. Nothing is off the right,
   so right is not claimed: like any unrecognised key it just shows the banner, which is a
   press that answers rather than a press that does nothing.
4. **RETURN always goes back.** It clears the screen if anything is on it, closes the panel if
   the panel is open, and closes the application only when there is nothing left to close.

| State | Up, Down | Left | Right | OK | Return |
|:--|:--|:--|:--|:--|:--|
| Picture | Channel | Channel list | Shows the banner | Channel list | Clear, then close the app |
| A failed channel | Channel | Channel list | Shows the banner | Channel list | Close the app |
| Channel list | The highlight | Categories, then out | Channels, then out | Watch | Back to the picture |

Law 1 is the one worth defending, and it is the reason nothing here can trap anybody: there is
no state at the picture, including a channel that has failed, where channel up leaves the
viewer where they were. Whatever has gone wrong, one press moves on. What it costs is that the
buttons cannot be reached with down, so they are reached with right instead. What it buys is
that there is nothing to learn.

`tests/keyLaws.test.tsx` holds the four laws, so they cannot be changed by accident.

## No seek bar, deliberately

There was one, drawn from a live window measured off the stream, and it was the least honest
thing on the screen. Half of these servers report a window they do not have, so a channel that
had just started announced "8 minutes behind" over a picture that was live, and a channel with
no window at all showed a bar that could not move. It also spent two of the four directions and
a second focus level on skip back and skip forward, which do nothing on most playlists.

Nothing replaced it. There are no on screen playback buttons at all, and each was removed for
the same reason: it was a permanent piece of the screen earning less than its keep.

**Pause** already has a key on the Smart Remote, a key on every keyboard (Space) and a button
on the on screen pad, so a fourth way to reach it bought nothing. Resuming **rejoins the
broadcast** rather than continuing from where it stopped: live television has moved on and
there is no bar to catch up with, so continuing would leave the viewer permanently behind with
nothing explaining why.

**Reload** was the last to go. It existed for the commonest fault these relays have, a picture
that freezes while the connection stays open and the engine reports nothing wrong. That is a
machine's job, not a viewer's: the player watches the playhead and, if it has not moved in
twelve seconds and nobody pressed pause, reports it as an ordinary failure, which the automatic
retry picks up like any other.

Choosing the channel that is already playing does nothing except put the list away. It used to
tear the stream down and rebuild it, which is a second of black and a re-buffer as the answer to
a viewer who opened the list, looked, and decided they were happy where they were.

## The picture reports on the picture, the banner reports on the channel

One line divides the two overlays, and it is worth stating because they used to overlap:

- **The middle of the picture** says what is happening to the picture: connecting, still
  connecting on a slow link, paused, or failed. It sits where the picture is missing, in words
  rather than in a spinner alone, because a slow connection and a dead channel look identical
  for the first half minute and the viewer is the one deciding whether to keep waiting.
- **The banner along the bottom** says which channel this is: the number, the name, where it
  sits in the list. Nothing else. Underneath it, in a box of its own, what the keys do.

All four picture states share **one surface**, and that is the point rather than a tidy up.
Connecting and failed used to be separate elements that took turns, and since a failed channel
is retried automatically they swapped places every few seconds: one card unmounted, another
mounted somewhere else, and the screen flashed on every cycle. They are the same statement at
different moments, so they are now the same box and only the words inside it change. A fault
also has to last half a second before it is worth saying anything about, so the recoverable ones
that come and go within a frame never appear at all.

## Nothing has to be waited out, and nothing waits for you

One press of RETURN clears every transient thing on screen, all of it at once rather than one
layer per press. The timers only decide what happens if nobody asks.

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

Layer 1.1 is why a broken channel does not interrupt anything: it takes no focus and blocks no
keys, so pressing down to try the next one works exactly as it does when the picture is fine.
In a playlist where some channels are off the air, that is the difference between hopping and
being nagged.

## The panel

The picture is the home of the app, and the panel is the one place you go from it. It takes 1064
of 1920 so the picture it is chosen against stays visible. Three bands, and only ever one cursor
among them:

- **A title bar** across the top: the app's mark and name, and the Search and Settings keys on
  the trailing edge. The mark is an `<img>` at `public/icon.svg`, the same vector the set's
  launcher icon is rendered from, rather than a glyph copied into a component where the two would
  drift apart. They are the application's own controls rather than either column's, which is
  where they now say so: Settings used to sit inside the rail's header, and there was nowhere to
  put a second key that would not read as belonging to the channel list. The pair is one cursor
  position, reached by pressing up from the first category.
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
  channels or twelve thousand.

The cursor answers the key and the column follows it, rather than the two moving together.
Arriving at a category is the most expensive thing this app does, because every row is thrown
away and rebuilt from channel objects no memo has seen, and doing that on each press of a held
key measured at six frames a second on a 2020 set. So the highlight moves at once and the column
catches up 150ms after the pressing stops: walking past eight categories builds one list instead
of eight. It is the same idea as the tuner waiting before it changes channel.

Focus and selection are drawn differently, because the guidelines treat them as different
states: the row the cursor is on inverts to a solid light fill only in the pane that holds the
remote, and the category being shown is marked with a bar instead.

## Searching

The Search key turns the channel column's heading into a field and its rows into matches from
the whole playlist, ranked so that names beginning with the query come first. The field is a row
of that column rather than a mode: down leaves it for the results, up from the first result comes
back to it, and the keyboard follows the cursor, so there is nothing to learn and no way to be
stuck somewhere with no way out.

It is the set's own on screen keyboard, raised by focusing the field, which is what the playlist
address in Settings already relies on. While it has the field, left and right are a caret and the
digits are text: a viewer correcting the third letter of a name must not be thrown into the
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

## Launching

Switch the television on and it comes back to the channel you were watching, with nothing over
it. The panel used to open on every launch and close again once the remembered channel had been
found, so the viewer watched a menu appear, wait out the playlist, and slide away from a channel
they had not chosen. The decision is now made on the first render, from what localStorage already
knows, which is the only way for it not to be visible. A remembered channel that has since gone
from the playlist is the one case that opens the list, because the alternative is a black screen
that has silently given up.

A launch shows the cached playlist and stops there. It used to show the cache and then go to the
network regardless, so every launch paid for the playlist twice before the first picture: a
download, a second parse of text that was almost always identical, and a synchronous write of the
whole file back to the set's flash, all on the main thread and all between the button being
pressed and the channel starting.

A playlist is a file somebody edits occasionally, not a feed, so the copy is stamped and trusted
for six hours. Past that it is still shown first and refreshed behind the picture, in idle time,
and if the bytes come back identical, which is the ordinary case, nothing is parsed and nothing is
written. Settings has a Refresh that ignores all of it.

## Two stores, for two different jobs

| | Holds | Why |
|:--|:--|:--|
| `services/store` | localStorage | Settings, favourites, the last channel. Short strings that have to be readable before the first paint, which is what a synchronous API is for. |
| `services/disk` | IndexedDB | The playlist text and the logos. |

The split is not tidiness. Samsung documents localStorage as holding up to 5MB per application,
and a twelve thousand channel playlist is around 2.3MB of text, so one large playlist plus the
settings was already most of the allowance and a larger one did not fit at all. The failure is a
thrown `QuotaExceededError`, which the store quite correctly swallows, so the effect was a cache
that silently stopped working on exactly the playlists that most needed one. `setItem` is also
synchronous, so it wrote those megabytes to flash on the main thread during launch. And it cannot
hold a Blob, which a logo is.

IndexedDB has been on these televisions since Tizen 2.4, five years before the oldest set this
supports, so none of it is a new dependency on a new engine.

The budget stays at **5MB**, deliberately. Moving to a store with a far larger quota is not a
reason to use one: everything in there is refetchable, so a bigger number buys fewer refetches
and costs somebody else their space. Over budget, the least recently used entry goes first, and
something larger than the whole budget is refused outright rather than emptying the cache in a
doomed attempt to fit it. Diagnostics reports what is held.

Three things keep it from growing without bound:

- **Cached playlists are keyed by address, not by playlist id.** The id survives the address
  being edited, so a viewer who corrected a typo in a URL was served the previous playlist's
  channels from a cache that believed itself current.
- **A sweep at launch** drops cached playlists nothing is configured to watch. Removing a
  playlist used to leave its copy behind for good, and no code could have removed it afterwards:
  the key was derived from an id that no longer existed, so nothing knew the entry's name.
- **Logos are saved at the size they are drawn**, a few kilobytes each, not as the original. The
  expensive part of a logo was never the download, it is the decode: broadcasters host artwork at
  whatever size suits them, two thousand pixels square being real, and fifteen of those at once
  froze the interface for three and a half seconds. Saving the reduced one needs a canvas read,
  which tainting forbids, so it works on a television, where a packaged app declares the origins
  it may reach, and quietly does not in a desktop browser, where most hosts refuse the fetch.

## Compatibility mode, and why it is off

One firmware defect is worth a whole feature. AVPlay keeps `EXT-X-MEDIA-SEQUENCE` in a **signed**
32 bit integer, and some packagers derive that field from a microsecond clock, so it arrives with
sixteen digits. The set then plays one segment, reports the entire live stream as 2000ms, and
stops. Measured on a 2025 model by serving it manifests that differed in one property:

| Sequence in the manifest | What AVPlay did |
|--:|:--|
| 2,147,483,000, just under 2³¹ | played, and reported its window correctly |
| 2,147,484,000, just over 2³¹ | reported the whole stream as 2000ms |
| 4,294,966,000, just under 2³² | the same failure, so the field is signed |

The size of the playlist has nothing to do with it: 3600 segments and 813KB played perfectly well
with a small sequence. One number is the whole problem.

Repairing it means changing that number, and there is nowhere on the television to put the result.
AVPlay refuses `blob:` and `data:` URLs, refuses a `file://` playlist, and fetches over its own
native HTTP client, which nothing in the page can see: with the inspector's network domain open and
a channel playing, CDP recorded zero requests for it. What it does accept is `http://127.0.0.1`,
proven by pointing it at a live loopback port (`NOT_SUPPORTED_FORMAT`, so it connected and read the
bytes) against dead ones (`CONNECTION_FAILED`).

So the app serves it. Tizen provides real sockets to WebAssembly, needing only the internet
privilege we already declare, and `services/repair` fetches the playlist, renumbers the sequence,
and hands it to the set's own player from a socket inside the widget. Hardware decode is kept: 23%
of one core against 25% through a hosted rewriter and 64% through hls.js.

Two details in the rewrite only showed themselves on hardware, and both are in
`services/manifest.ts`. The sequence is produced by **counting segments** across refreshes rather
than by any arithmetic on the upstream's field, because that field is a microsecond clock advancing
about two million per segment, so a subtraction or a modulus still jumps by millions between one
refresh and the next: the set answered that by resetting to the live edge every few seconds. And
the declared target duration is **inflated to 20 seconds** rather than the true 2, because a player
starts about three target durations from the end of a live window. Declaring the truth started
AVPlay 6 seconds from the live edge, where it sat for twelve seconds with its buffer at 97% waiting
for data that only arrives at real time, long enough for the app's own watchdog to call the picture
frozen before it had begun. Declared at 20, it starts 90 seconds into the window and plays at once.

**And it is off by default**, which is the important half. Everything above is a workaround for one
defect, and the majority of channels never meet it, so:

- nothing is probed until a channel has actually failed, so a working channel pays nothing at all
- the test answers yes for that one defect only, so a channel that is off the air or sending an
  undecodable codec is reported honestly rather than "repaired" for another twelve seconds
- the verdict is remembered per host, across launches, so the failure is paid once rather than
  every evening
- the socket is closed the moment a channel that does not need it starts, and the refetching stops
  while the application is hidden

Diagnostics reports the state, because "the toggle appears to have done nothing" is otherwise
unanswerable: it distinguishes a television without the socket bindings from one that has simply
never needed them.

## Frosted glass, and why this app cannot have it over a picture

Samsung's recent sets draw their own on screen displays as blurred glass rather than as flat
translucent panels, and One UI's [visual depth guidance](https://developer.samsung.com/one-ui/structure/visual-depth.html)
describes the technique: blur applied evenly across a backdrop, always paired with a dim, since blur
alone weakens readability rather than helping it. The obvious question is why this app's panels are
dim without being blurred, and the answer is not taste.

**The browser has no picture to blur.** On a television the video is decoded to a hardware plane that
the display pipeline composites *underneath* the browser, and the page shows it through a transparent
hole. `backdrop-filter` samples what is behind an element within the page, and behind these panels
there is nothing: measured on a 2025 set, with AVPlay reporting `PLAYING` and its clock at 97
seconds, a capture of the page is pure black everywhere the picture is. The firmware supports the
property, `CSS.supports("backdrop-filter", "blur(20px)")` answers true, and it would blur an empty
region.

Two further reasons it stays off even where it would work, over the app's own content:

- The sets from 2020 and 2021 run Chromium 69 and the property arrived in 76, so a blurred panel
  would look like a different application depending on the year of the television.
- Each blurred surface is promoted to its own full screen compositing layer, and Samsung's memory
  guidance singles out stacked full screen layers as a thing not to do on a device with this little
  headroom.

So the parts of the language that carry the meaning are adopted and the part that cannot work is
skipped: a single translucent surface over the picture, a soft shadow marking its edge rather than a
gradient that fades out with no edge at all, and a hairline dividing what is inside it instead of a
second panel with a second shadow. That last one is why the channel name and the keys that act on it
are one box in two parts rather than two boxes.

If a blurred surface is ever wanted, the place it would be honest is a dialog over the settings
sheet, where what sits behind genuinely is page content, and it would need a `@supports` query and a
frame time measurement on the floor profile before it earned its place.

## Why a web app

A Tizen web app is a packaged web app, so a TV player can be written with ordinary web tooling.
The part worth owning is playback. On the TV this uses `webapis.avplay`, the hardware pipeline,
which is considerably more forgiving of awkward manifests than the browser engine in the same
firmware: long sliding windows, unusual sequence numbering and mid stream discontinuities are all
common in live playlists and all defeat a software player sooner or later.

On a desktop there is no AVPlay, so hls.js drives a plain `<video>`. Same UI, same playlist,
instant reload, real dev tools.

## One artifact, built for the floor

The supported range is Tizen 5.5 and newer, which is seven browser engines.
`scripts/tv/platforms.json` is the only place that table is written down, and prose restating it
has been wrong before.

Consistency does not come from testing seven televisions, it comes from having nothing that can
differ between them. The build targets es2019 and the stylesheet uses nothing newer than the
oldest engine can do, so every later set runs a strict superset of what the app asks for and a
middle year cannot fail in a way both ends pass. That is why the engine gate tests two engines
rather than seven.

There is exactly one runtime branch on what the engine can do, the flex gap probe, and it has a
gate of its own. **Every capability branch added costs an engine in the matrix**, because the
years in between stop being unreachable the moment code can tell them apart.

Not every difference is testable in a browser, and the three that are not are on the Diagnostics
screen in Settings instead: what the set says it is, whether flex gap survived, and every key the
remote actually sends. "The yellow button does nothing on my TV" is not answerable by reading the
source and takes about four seconds from that screen.

## Not there yet

EPG and recordings. Playlists carry `tvg-id`, so an XMLTV guide is the natural next addition.
