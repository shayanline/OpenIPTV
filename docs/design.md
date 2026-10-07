# Design notes

Why the interface is shaped the way it is. The source carries the detail, this is the part
worth reading before changing anything.

The interface follows Samsung's
[Smart TV design guidelines](https://developer.samsung.com/smarttv/design/design-principles.html)
and takes its look from [One UI](https://developer.samsung.com/one-ui/index.html).

## The screen is a stack

| Level | Slot | Current surface |
|:--|:--|:--|
| 1 | Picture | The Live player, always present |
| 2 | Primary | The Live panel or the playback deck |
| 3 | Drawer | Guide, Audio, Subtitles or More |
| 4 | Modal | Settings, first run or exit |
| 5 | Popup | A confirmation above its modal |

`App.tsx` owns this stack, the tuner and the application mode. It resolves the highest open focus owning surface before rendering the screen. `LiveScreen.tsx` owns the Live picture, Guide and current panel, and it delegates each key to exactly one of those surfaces. Settings, first run, exit and confirmation own their keys in their components. The playback banner and picture state belong to the picture presentation, so neither creates another focus surface.

Choosing a channel closes the panel, the banner appears with the name and holds while the channel tunes, and five seconds after the picture arrives it goes too. A higher surface keeps ownership until it closes, including Guide during its closing transition.

## Live key laws

A live TV app has two jobs competing for the same four keys: changing channel, which every television gives to up and down, and controlling playback, which [Samsung's media player guidance](https://developer.samsung.com/smarttv/design/media-player.html) gives to the same directions. Answering both at once is how a key ends up meaning two things, and this app used to print both meanings in one line of on screen help.

1. **At the Live picture, up and down always change channel.** This applies while the Live picture is the active surface, including when the channel has failed. In the Live panel they move the highlight because the panel owns those keys. At the finite picture they deliberately do nothing, because there is no next channel.
2. **OK does the obvious thing where it is pressed.** At the Live picture that is the channel list. At the finite picture it opens the playback deck. On a focused button it is that button.
3. **Left and right move within the active surface.** At the Live picture, left goes to the channel list and right opens the playback deck. At the finite picture they quick seek ten seconds at a time. In the panel, either direction switches between the category and channel lists while preserving each list's cursor, and the title bar cycles Search and Settings.
4. **RETURN always goes back within the active surface.** It clears the Live picture if anything is on it, closes a drawer back to the surface that opened it, closes the deck or panel if open, and closes the application only when there is nothing left to close.
5. **Physical transport keys keep their semantic meaning on every surface.** Play, Pause, Play or Pause, Stop, Rewind, Fast Forward, Previous and Next do the same thing whether or not the deck is showing.

| Surface | Up, Down | Left | Right | OK | Return |
|:--|:--|:--|:--|:--|:--|
| Live picture | Channel | Channel list | Playback deck | Channel list | Clear, then close the app |
| Live picture, failed channel | Channel | Channel list | Playback deck | Channel list | Close the app |
| Finite picture | Nothing | Seek back | Seek forward | Playback deck | Back to the content's own screen |
| Playback deck | Seek bar | Move focus | Move focus | Activate | Close the deck |
| Panel channel list | The highlight | Categories | Watch | Watch | Back to the picture |

The first law prevents a failed Live channel from trapping the viewer because channel up still moves on while the picture owns input. The panel, Guide, deck, Settings and confirmation receive their own directional events when they are above the picture.

`tests/keyLaws.test.tsx` holds the Live and finite picture contracts, while the surface ownership tests pin the delegation boundary.

## Seeking where it can be honest

The old design had a seek bar drawn from a live window measured off the stream, and it was the least honest thing on the screen. Half of these servers report a window they do not have, so a channel that had just started announced "8 minutes behind" over a picture that was live, and a channel with no window at all showed a bar that could not move. It also spent two of the four directions and a second focus level on skip back and skip forward, which do nothing on most playlists.

What replaced it is seeking where the medium actually supports it.

**Finite content seeks at the picture.** Left and Right accumulate ten second steps and show a compact indicator with the direction and target time, without opening the deck and without taking focus. One engine seek lands 350 milliseconds after the presses settle, a rejected or timed out seek restores the actual position, and a stream that cannot seek says Seeking unavailable instead of pretending. Pause survives a seek, because pausing is the viewer's state, not the engine's.

**Live television seeks only inside the deck.** The deck opens on Right whether or not the channel has a DVR range, so the key never changes meaning because of a range the viewer cannot see. When a real window exists the deck carries a timeline with the oldest available programme time on the left, and while playback is behind, a focusable Go live action sits one step past the safe edge. Ordinary Live has no timeline: pausing it shows the persistent paused state, and Play retunes to the current edge rather than resuming from a position the broadcast has left behind. On a DVR window pause holds position and Play resumes in place.

**Pause that does not exist is not faked.** When an engine exposes no legal pause, the deck omits the action and a physical Pause request answers with a compact Pause unavailable notice, rather than tearing down the decoder to simulate one.

**Reload** is still nobody's button. It existed for the commonest fault these relays have, a picture that freezes while the connection stays open and the engine reports nothing wrong. That is a machine's job, not a viewer's: the player watches the playhead and, if it has not moved in twelve seconds and nobody pressed pause, reports it as an ordinary failure, which the automatic retry picks up like any other.

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

A broken channel stays inside the Live picture presentation. It takes no focus and blocks no keys, so pressing down to try the next one works exactly as it does when the picture is fine.

## The panel

The Live picture is the home of the current screen, and the panel is the primary surface opened from it. `LiveScreen.tsx` owns both surfaces and gives the panel every focus key while it is active. The panel takes 1064 of 1920 so the picture it is chosen against stays visible. It has three bands and one cursor among them:

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

The cursor answers the key and the column follows it, rather than the two moving together. Up and
down walk each list and use the title bar as its boundary: reaching Search from the top returns to
the top with down, and reaching it from the bottom returns to the bottom with up. Left and right
switch columns without changing their remembered rows. Search and Settings themselves are a
two control horizontal ring. Vertical movement leaves the ring for the list edge that matches the
pressed direction.
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

## Phone setup on the local network

Typing a playlist address with a television remote is the hardest part of first use, so the TV welcome screen offers the same task on a phone without removing the original path. A vertical divider keeps the manual form on the left and gives the QR code and pairing instructions the right side. The manual form remains complete and usable when local networking is unavailable. Desktop browsers show only the centred manual form because a browser cannot listen for connections from another device.

The television serves the remote interface itself on its private address. `services/remoteServer` owns a dedicated WebAssembly socket, while `services/deviceAccess` creates expiring pairing sessions and stores one credential verifier per authorised device. The remote device sends typed commands through `services/remoteProtocol`, and the existing stores remain the only source of playlist and settings state.

This is local HTTP on a trusted home network. There is no account, hosted relay, analytics request or cloud copy of playlist addresses. OpenIPTV must be running and both devices must be able to reach each other. Browser storage belongs to the television address, so a changed address requires pairing again.

The management socket and compatibility socket are separate artifacts with separate owners. The management worker binds only to the reported private address and serves three fixed phone assets plus versioned API routes. The compatibility worker remains loopback only and cannot serve management data.

### Paired phone lineup management

An ordinary remote snapshot contains only the active lineup identifier, readiness and lineup revision. It never contains a category or channel catalogue. The phone requests one page with 50 items by default, while the protocol rejects a limit above 100 and the interface retains at most 100 rows after explicit page loading.

Every page cursor binds its playlist, lineup revision, scope, category, search text and hidden inclusion. A television edit or authoritative refresh makes an older cursor conflict before any rows return. The server returns the current lineup revision with a fresh bounded snapshot, then the phone discards its held rows and loads page one without replaying a mutation.

Phone mutations carry a request identifier and the current lineup revision. `services/lineupProtocol` validates exact shapes, Unicode length, active identifier ownership and placement anchors, then resolves opaque channel identifiers to complete `ChannelRef` values. Every accepted television and phone mutation ends at `useLineup.getState().applyLineupMutation`, so protocol, server and static web code contain no sibling overlay implementation.

The protocol remembers 64 completed mutation results and shares an active promise for simultaneous retries. A repeated request identifier receives its first result without another write or revision increment. Ordinary remote snapshot revision remains independent because it owns settings and playlist commands, while lineup revision owns catalogue and personalisation consistency.

The phone exposes provider and personal categories, category membership, unavailable records, provider, alphabetical, number and custom order, visibility, retry and paged anchor search. Provider text is escaped and rendered with `dir="auto"`. Lineup responses omit source fingerprints, provider credentials and playback addresses.

## Xtream VOD experience

An Xtream source stores the server, username, password, and preferred live output as typed fields. `services/xtream` is the only boundary that constructs Player API and media addresses. Credentials remain in local settings because the protocol requires them for every request, while cache keys, item identities, diagnostics, errors, remote state snapshots, and fixture responses exclude them. A valid provider `direct_source` is used before a generated media address.

Movies and Series are opaque full screen modes beside Live. Entering either mode stops playback and releases the decoder, while returning to Live retunes the remembered channel through the ordinary playback controller. App owns the mode and screen stack, `VodScreen` owns the VOD surface, and `useVodNavigation` owns independent Movie and Series positions.

The category rail contains Continue watching when it has resolved progress, Favourites when it has saved parent items, All, then provider categories in provider order. Focus selects a category immediately, catalogue replacement settles after 150 milliseconds, and poster requests begin 120 milliseconds later. A vertical wheel gesture advances one item in linear order and ignores another gesture for 120 milliseconds.

Movie and Series search loads the complete index only after Search or All is selected. Input changes immediately, ranked results settle after 150 milliseconds, names that begin with the query precede names that contain it, and the grid retains at most 300 matches while reporting the complete count. Back restores the exact category or search result origin.

Movie details contain the shared Back, title, and Favourite row, provider artwork, supplied metadata, synopsis, and playback actions. Series details keep the same title and hero geometry while Episodes replaces the poster region with a season selector and windowed episode list. Series Continue is the only episode resume path, while a manually selected episode always starts from zero.

Progress remains synchronous because the playback controller needs it at pause, Stop, hiding, completion, and target changes. Continue watching includes resolved movies and one parent card for the latest resumable Series episode. Completion removes progress, while a restart keeps the previous record until the new session advances for 15 seconds.

Guide remains the Live drawer owned by `LiveScreen.tsx`. It reads short programme data for the focused or playing Live channel, and missing or invalid archive data remains readable without exposing an unsupported action.

## Storage and cache partitions

| Service | Holds | Reason |
|:--|:--|:--|
| `services/store` | Settings, favourites, the last channel, and finite progress | These short values must be available synchronously before the first paint or playback restore. |
| `services/disk` | Playlists, catalogue data, poster derivatives, and logo derivatives | These payloads are larger, refetchable, and suitable for idle IndexedDB work. |
| `services/personalDisk` | Sparse channel and category overlays, placements, personal categories, and unavailable references | These viewer records cannot be refetched, so `openiptv-personal` has no eviction and cache clearing never opens it. |

Provider catalogues remain immutable. `stores/lineup` validates personal records, reconciles stable provider identities, applies sparse overlays, and materialises the effective channels, categories, browse view, search view and number index that every Live consumer reads. M3U records persist only hexadecimal fingerprints, so stream addresses and embedded credentials never enter the personal database.

Launch starts the personal record read beside the catalogue cache read and publishes only after both are ready, which prevents provider order or names from appearing before personal values. Direction input reads the materialised arrays and maps without opening IndexedDB. A committed mutation updates memory immediately, then one idle transaction advances the durable revision. A failed transaction restores the latest durable revision, preserves unavailable records, and leaves the initiating management surface available for Retry.

Durable state changes only after a personal record read or a completed write transaction. Category refreshes reconcile against the current live overlay, so they cannot replay the launch record over later edits. Playlist changes, removal and reset cancel queued work, drain mutation promises, wait for an active write, then perform destructive cleanup. A stale completion cannot publish under a newer playlist owner or recreate a deleted record.

Migration ownership remains with each final state reader. Settings converts legacy playlist addresses, records old alphabetical intent and retains hidden category fields until the matching personal lineup record commits. Compact personal state validates favourites, last playback and bounded progress, while durable lineup parsing keeps known version 1 fields and retained unavailable references. A failed or interrupted write leaves legacy input available for the next launch. A repeated completed launch makes no durable change.

M3U overlay references use hexadecimal fingerprint identities rather than provider ids that may contain stream addresses. Reconciliation checks a complete fingerprint before considering a unique base fingerprint, while occurrence suffixes never fall back to another occurrence. Ambiguous overrides and memberships remain unavailable for explicit viewer action.

The IndexedDB cache has a fixed 24 MiB budget split into 12 MiB for playlists and catalogue data, 8 MiB for JPEG poster derivatives, and 4 MiB for PNG logo derivatives. Each class evicts its own least recently used entries, so poster browsing cannot evict the catalogue needed at launch. Diagnostics reports total usage and each class.

`services/artwork` owns two shared decode lanes, visible reference counts, queue cancellation, compressed byte limits, idle disk writes, and independent bitmap limits. Posters decode to their published card size, while the active details backdrop decodes to at most 1280 by 720 pixels and lives only for that details selection.

- Cached playlists use their address in the key because editing an address must never serve the previous playlist.
- A launch sweep removes catalogue entries for playlists that are no longer configured.
- Artwork derivatives are saved at display size, and every evicted bitmap is closed.

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

In a desktop browser, the same functions in `services/manifest` run through hls.js's playlist
loader instead. The loader keeps hls.js responsible for network requests and live refreshes, then
passes only damaged media playlists through the existing window and sequence logic. This path
needs the source to allow CORS, and it applies to browsers where hls.js has a media source. A
browser using native HLS still receives the original playlist because it has no equivalent loader
hook.

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
defect, and the majority of channels never meet it. When enabled, the selected playlist is checked
before tuning so a channel that needs repair does not show one frame and stall:

- a working channel uses its original address after the check, while a damaged channel uses the
  repaired address before AVPlay starts
- the check measures the longest segment, including a master playlist's variants, so AVPlay gets
  one second beyond that duration before starting
- a healthy verdict is remembered per playlist address in a bounded cache, so later launches do not
  block on the same preflight fetch. The cache is revalidated with HTTP validators when available,
  or with a fresh manifest comparison, and a changed diagnosis starts the normal repair path again
- the test answers yes for that one defect only, so a channel that is off the air or sending an
  undecodable codec is played directly and reported honestly
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

**What is done about it.** The channel list and the banner ask for the blur anyway, behind an
`@supports` query, together with a lighter surface: `--over-video-glass` at 0.78 rather than the 0.92
those panels used to carry. That pairing is what One UI's guidance actually prescribes, and each half
earns its place differently.

The lighter surface is the half a viewer sees on a television. More of the programme comes through the
panel, which is the look those newer sets have, and it is the only part of the effect that does not
need pixels the browser has never been given.

The blur is the half that pays off in a desktop browser, where the picture is a `<video>` element in
the page and there is something to sample. On a set it is a no-op, so the question is whether a no-op
costs anything, and it was worth measuring rather than assuming. Opening and closing the panel five
times on a 2025 set, with the blur and then with the same surface and no blur:

| | With the blur | Blur off |
|:--|--:|--:|
| Process CPU | 70% | 75% |
| Median frame | 17ms | 17ms |
| Worst frame | 67ms | 83ms |
| Frames over 50ms | 2 | 2 |

Both runs are the same within noise, and the 70% belongs to the panel sliding and its logos rather
than to the blur. So the blur is free here, which is the opposite of what the fear was, and the
earlier worry about stacked compositing layers stays valid only for stacking them: these two surfaces
never overlap, since the banner belongs to the picture and the panel covers it.

The sets from 2020 and 2021 run Chromium 69, which does not have the property, so they never enter
the block and keep the heavier surface they need to stay readable. That is why this costs no
capability branch to reason about: it is a feature query rather than a decision the code makes.

The rest of the language is adopted where it always applied: one surface over the picture rather than
two, a soft shadow marking its edge rather than a gradient that fades out with no edge at all, and a
hairline dividing what is inside it. That last one is why the channel name and the keys that act on it
are one box in two parts.

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

External XMLTV guides for M3U sources and recording management. Xtream short programme information and provider catchup are supported through the Player API.
