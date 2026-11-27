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
| 3 | Drawer | Guide, Audio, Subtitles or Details |
| 4 | Modal | Settings, first run or exit |
| 5 | Popup | A confirmation above its modal |

`App.tsx` owns this stack, the tuner and the application mode. It resolves the highest open focus owning surface before rendering the screen. `LiveScreen.tsx` owns the Live picture, Guide and current panel, and it delegates each key to exactly one of those surfaces. Settings, first run, exit and confirmation own their keys in their components. The playback banner and picture state belong to the picture presentation, so neither creates another focus surface.

Choosing a channel closes the panel, the banner appears with the name and holds while the channel tunes, and five seconds after the picture arrives it goes too. A higher surface keeps ownership until it closes, including Guide during its closing transition.

An ordinary channel press commits after two animation frames, which let feedback paint before AVPlay's synchronous calls. Held repeats coalesce until release, with a 450ms fallback for missing release events. A newer selection cancels an older queued commit. Compatibility mode starts its playlist check while stopping the old stream without releasing the decoder. Opening the checked stream still waits for the provider's response because AVPlay must not receive a manifest known to trigger its sequence overflow defect.

Playback controls use the banner's opacity and vertical translation entrance through one shared animation rule, including its duration and easing. Live, Movies and Series use that same rule whether or not the banner was visible. Opening controls never measures or scales individual banner parts.

The navigation menu's painted background and border move through a fixed width pseudo element using the channel panel's transform duration and easing during ordinary channel browsing. Section changes between Live, Movies, Series and Search fade only the content area beside the application menu. The fade boundary follows the menu's collapsed or expanded width and mirrors in RTL. Full screen pages such as Settings, Change Playlist and VOD details fade the whole screen, including the menu. Rail geometry changes without animation during page navigation. Search waits until the fade is idle before focusing its input.

Playback information and the banner share opacity and vertical translation animations for their entrance and exit. Dismissal releases accessibility immediately while the report finishes its exit. Information reserves its diagnostic rows before its first native read and samples after the entrance has painted, so synchronous AVPlay queries do not interrupt that animation. It never waits behind a full screen transition mask. Programme Guide uses the same right drawer as audio and subtitles, and opening it from the Live browser leaves that browser stationary underneath. Track selection records the viewer's intent before entering the player, updates accepted native selection flags in the cached track list and prevents synchronous track events from recursively selecting again.

Loading preserves the initial decision to resume a picture or show the browser. It does not reveal navigation or change the Live panel's motion owner while the remembered channel's playlist arrives.

Settings sections and their nested content tabs switch immediately when the surrounding page remains in place. Entering or leaving a full screen Settings detail uses the shared page fade, while Back restores the control and scroll position that opened that detail.

The playlist switcher pauses the current picture and silences its output while it owns the screen. Closing it resumes the same item only if it was playing before the switcher opened. A playlist change stops the old player and defers tuning until Live is entered with the new lineup ready. Each playlist resumes its own saved Live channel, with its first channel as the fallback when no valid remembered channel remains.

Movie and Series details activate buttons through OK or a pointer click. Horizontal arrows retain focus navigation without activating the focused action, including when the episode panel is open.

The management dashboard follows the app language's text direction. Its Smart Remote is an explicit exception because physical key positions, including volume, channel, transport and number buttons, stay fixed in LTR order.

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

**Seeking shares one settling delay.** Direction presses and pointer scrubbing update the pending target immediately for Movies, Series episodes and seekable Live TV. Each updated target restarts a 0.75 second idle period, after which the controller sends only the latest position to the engine. Changing direction keeps the same pending seek session. A rejected or timed out seek restores the actual position, while playback that was already paused stays paused.

Held seeking accelerates by elapsed time rather than remote repeat counts. Its steps grow through 10, 20, 40, 60 and 120 seconds before reaching 5 and 10 minutes, with progressively longer periods at each level. Repeat bursts are bounded, while a release or reversal restores the smallest step. AVPlay completes a saved resume seek before track reads or Play, retries a transient seek rejection once inside the existing deadline, and keeps finite seek targets below the exclusive duration boundary.

Audio and Subtitles always keep their places in playback controls and become disabled when no tracks are available. Accepted choices, including subtitle Off and Automatic, belong to the playlist and playback item and are restored by normalized track identity. The bounded choice cache writes during idle time and flushes when playback stops or the page hides. Removing a playlist or resetting personal data clears its choices. Open controls own the subtitle layer and CSS anchors its bottom above the complete panel, including its hints, without a fixed height estimate or animation frame measurements. Closing controls restores the normal safe area position. Compact recovery feedback beside the clock contains only a spinner with an accessible label.

Track restoration waits until playback begins because AVPlay may reject a choice in READY or reset it on Play. Each engine opening forces the saved choices once after that boundary, including when metadata claims they are already selected. Later track reports restore choices that become available after startup. Subtitle Off explicitly silences output because Samsung may omit selection flags from its track metadata.

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
Fresh Live category presses update the channel column on keydown without waiting for release. Held repeats move the cursor on every command, while the channel column refreshes at most once every 150ms. The next deadline is measured from the last applied category rather than the last repeated command, so the column keeps following while the button remains held. Category and channel cursor changes commit together, and category browsing never tunes a channel.

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

Live search waits 150ms after the last keystroke to avoid running a catalogue query for each character. Results are capped at 300 per rank, so an exact or prefix match cannot be crowded out by matches elsewhere in a channel name.

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

The entry page loads Samsung's product API library before the application module. Samsung resolves `$WEBAPIS` to its system library, while desktop browsers receive an empty local fallback at that address. A missing or throwing Network API becomes an unavailable server state with an error notification. The device action stays mounted during restart, so focus remains on it until the viewer moves elsewhere. Restart completion never moves focus back.

This is local HTTP on a trusted home network. There is no account, hosted relay, analytics request or cloud copy of playlist addresses. OpenIPTV must be running and both devices must be able to reach each other. Browser storage belongs to the television address, so a changed address requires pairing again.

The management socket and compatibility socket are separate artifacts with separate owners. The management worker binds only to the reported private address and serves three fixed phone assets plus versioned API routes. The compatibility worker remains loopback only and cannot serve management data.

### Paired phone lineup management

An ordinary remote snapshot contains only the active lineup identifier, readiness and lineup revision. It never contains a category or channel catalogue. The phone requests one page with 50 items by default, while the protocol rejects a limit above 100 and the interface retains at most 100 rows after explicit page loading.

Every page cursor binds its playlist, lineup revision, scope, category, search text and hidden inclusion. A television edit or authoritative refresh makes an older cursor conflict before any rows return. The server returns the current lineup revision with a fresh bounded snapshot, then the phone discards its held rows and loads page one without replaying a mutation.

Phone mutations carry a request identifier and the current lineup revision. `services/lineupProtocol` validates exact shapes, Unicode length, playlist identifier ownership and placement anchors, then resolves opaque channel identifiers to complete `ChannelRef` values. Every accepted television and phone mutation ends at the owning playlist controller's `applyLineupMutation`, so protocol, server and static web code contain no sibling overlay implementation.

The protocol remembers 64 completed mutation results and shares an active promise for simultaneous retries. A repeated request identifier receives its first result without another write or revision increment. Ordinary remote snapshot revision remains independent because it owns settings and playlist commands, while lineup revision owns catalogue and personalisation consistency.

The phone exposes provider categories, unavailable records, provider, alphabetical, number and custom order, visibility, retry and paged anchor search. Custom categories and membership editing remain hidden until channel membership management is complete. Provider text is escaped and inherits the app language's direction. Lineup responses omit source fingerprints, provider credentials and playback addresses.

Playlists no longer need to be the active one before the phone manages them. `stores/lineup` keeps one controller per playlist and source version behind three role leases for playback, television settings and the paired phone. A management lease shares the playback engine when the playlist is active and prepares its own when it is not, so an inactive playlist edits against its own catalogue, personalisation and revision while the active lineup stays untouched. `services/lineupManagement` acquires and releases those leases, fences every bound operation by playlist id and source version, and shares one cold provider read between concurrent views. The remote protocol resolves each query and mutation against the requesting playlist inside a serial queue, deduplicates finished request identifiers before queueing, and reports only the active playlist summary in ordinary snapshots. The phone keeps a separate owner, source version and query signature for its content view, so an unrelated snapshot cannot move its revision, editor or page state, and its first revision conflict performs the existing single reload.

## Xtream VOD experience

An Xtream source stores the server, username, password, and preferred live output as typed fields. `services/xtream` is the only boundary that constructs Player API and media addresses. Credentials remain in local settings because the protocol requires them for every request, while cache keys, item identities, diagnostics, errors, remote state snapshots, and fixture responses exclude them. A valid provider `direct_source` is used before a generated media address.

Movies and Series are opaque full screen modes beside Live. Entering either mode stops playback and releases the decoder, while returning to Live retunes the remembered channel through the ordinary playback controller. App owns the mode and screen stack, `VodScreen` owns the VOD surface, and `useVodNavigation` owns independent Movie and Series positions.

The category rail contains Continue watching when it has resolved progress, Favourites when it has saved parent items, All, then provider categories in provider order. Focus selects a category immediately, catalogue replacement settles after 150 milliseconds, and poster requests begin 120 milliseconds later. The poster window owns wheel scrolling, including partially visible rows, while remote input moves the selected item. Focusing a poster never adds native scrolling to the window transform. Sorted catalogue snapshots change with provider data, personal overlays, locale or the selected sort rather than rebuilding during cursor movement.

Category badges count provider titles in their exact normalized category rather than episodes, without applying hidden or personal view filters. A successful category frame is preferred, followed by a valid provider total and then an explicitly loaded complete index. Counts are reused only within the same playlist and source version. An initial empty index does not qualify as loaded, so unknown counts remain blank. Badge rendering does not start catalogue requests, read additional disk data or persist count records because those operations would delay navigation solely to populate badges.

Movie and Series search submits when Search is activated or Enter is pressed in its input. Typing edits the draft without applying it or starting a search request. Previous results remain tied to their submitted query until the next submission, with a notice when the draft differs. The field and button share one height. Search has distinct prompt, loading, empty and error responses, while result counts stay hidden until a completed search. Down reaches Retry from either search control, and Up returns to the control that led there. Retrying preserves the query and focuses Search without reopening the keyboard. Ranked names that begin with the query precede names that contain it, and the grid retains at most 300 matches. Back restores the exact category or search result origin, including the submitted query and any unsent draft.

Complete Movie and Series indexes normalize each provider record as the response arrives, rather than retaining the whole raw payload. The raw response is limited to 128 MiB, while retained normalized records share a 12 MiB budget. A single record is also bounded. Parsing yields between short work slices, and complete index requests have a bounded two minute timeout. Category and detail request limits remain unchanged. An index that exceeds these limits fails without publishing partial results.

Browser native playback requests anonymous CORS access because cross origin media otherwise hides embedded text tracks. A startup access failure retries once without CORS so providers that permit ordinary video playback can still play. Native track discovery refreshes at metadata, data readiness, canplay and playing events, rebinding listeners if the browser replaces its track lists. Browsers may still omit embedded tracks for unsupported containers or codecs. Playback information identifies native file playback separately from native HLS.

Movie and Series details use the cinematic layout with a bounded synopsis, compact genre lines and aligned director and cast rows. Resume labels use the playback timestamp format, which preserves seconds and displays hours when needed. Series continuation shows the episode reference and resume position. Information opens the same full metadata surface as playback controls, where the complete description, credits, poster and backdrop remain available. This surface owns the details drawer level in the application stack and restores the originating action on dismissal. Loading skeletons share the preview and action geometry and retain the poster radius. Favourites remain the final action. Series details keep the same hero geometry while Episodes replaces the poster region with the episode list.

The synthetic Continue watching category uses a clock icon, while Favourites uses a star in Live, Movies and Series. Icons follow the current focus colour and reading direction. Provider categories retain their original labels without inheriting icons from names that happen to match a synthetic category.

Loading action placeholders use the same action lists as the loaded detail page, based on the available progress and metadata. Large detail posters request a 360 by 540 pixel base rather than stretching the grid thumbnail. Detail posters, episode previews and information artwork account for up to two device pixels per CSS pixel, with a ceiling of 2,073,600 pixels per display request. Size remains part of the cache key, so a large view cannot reuse a smaller derivative. Grid thumbnail sizes and the existing cache and concurrency limits remain unchanged. Artwork can still be limited by the resolution supplied by the provider.

TMDB width thumbnail URLs select a larger supported source when their advertised width is smaller than the requested bitmap. The resolved source also forms the cache key, so an old thumbnail derivative is not reused for the sharper request. An already adequate image and an arbitrary provider URL are preserved. Response, decode, cache and concurrency limits still apply.

Detail actions use one primary button with episode and resume information on a separate line. Secondary actions share compact rows with short visible labels and descriptive accessible names. Restart episode resets only the continuation target, while the Movie action is labelled Restart. Four actions fit one row of three secondary buttons, while five actions use two rows of two. Directional focus follows this geometry in both reading directions. Buttons and loading placeholders share the category radius token, columns and primary size.

Submitted searches reuse an available complete index or stream the provider response while retaining no more than 300 entries in each ranking group. Only the final 300 results enter the interface. Unrelated records are discarded immediately, so search does not inherit the full catalogue retention or response byte limit. Record size, retained result bytes, work slices and the request deadline remain bounded. Identity tracking has both a character budget and a count ceiling, after which the total becomes a lower bound. Six recent query results are cached in memory and participate in metadata lookup. Owner changes and cache resets cancel outstanding queries.

Notifications use a minimum bottom inset of 2.5 times the vertical safe margin. Playback overlays can increase this clearance. Dialog and page fades share the navigation duration, including the transition fallback, while reduced motion still disables them. Seekbar direction presses update a preview without pausing playback. Release starts the 375ms settle period, while a one second fallback covers remotes that do not send release events.

Playback aspect choices place Fit before Fill and Stretch. Fit is the default for new or reset preferences, while an existing saved choice remains unchanged.

Playlist loading failures retain the selected content section and keep the application menu available. Selecting Live, Movies, Series or Search retries loading for that context. The recovery page shows the playlist and context above its error, offers Retry and Manage playlists, and places the key guide at the bottom safe edge. The leading arrow moves from Manage playlists to Retry, then from Retry into the menu. Up and Down provide the same action order without wrapping. Exit leaves the underlying menu visibility unchanged while its modal owns input.

Movie, Series and finite Details country flags use only structured provider country metadata. A private table matches normalized ISO2 codes, ISO3 codes, canonical English names and reviewed aliases exactly. The whole field is matched before splitting on `;`, `/`, `|`, `&` or `+`. Each resulting chunk is matched as a whole name before splitting on commas or the word `and` surrounded by whitespace. Unsupported or ambiguous segments are omitted, while recognized list entries retain provider order after deduplication. At most 6 flags appear, and inputs longer than 512 characters are rejected. No country is inferred from a title, group or language, and provider data is never rewritten.

Flags use local bundled URLs without changing the CSP or adding a runtime package. The selected 48 4x3 SVGs from [flag-icons v7.3.2](https://github.com/lipis/flag-icons/tree/v7.3.2) occupy 234266 raw bytes before packaging, excluding square variants, all other flags and library JavaScript or CSS. This acquisition byte metadata is not a measured compressed widget size. The MIT attribution and shipped licence are recorded in [third party notices](../public/THIRD-PARTY-NOTICES.md) and [the flag-icons licence](../public/licenses/flag-icons.txt). Extending support requires updating the private table together with its matching bundled asset.

Progress remains synchronous because the playback controller needs it at pause, Stop, hiding, completion, and target changes. Continue watching includes resolved movies and one parent card for the latest resumable Series episode. Completion removes progress, while a restart keeps the previous record until the new session advances for 15 seconds.

Guide remains the Live drawer owned by `LiveScreen.tsx`. It reads short programme data for the focused or playing Live channel, and missing or invalid archive data remains readable without exposing an unsupported action.

Finite playback Details shares that drawer context surface. It keeps playback running underneath, keeps Close and the key guidance outside the directional reading viewport, and fills the copy from provider artwork and metadata fenced to the playlist that owns the target, falling back to the target's own identity while details load. Closing it restores the deck action that opened it.

## Storage and cache partitions

| Service | Holds | Reason |
|:--|:--|:--|
| `services/store` | Settings, favourites, the last channel, and finite progress | These short values must be available synchronously before the first paint or playback restore. |
| `services/disk` | Playlists, catalogue data, poster derivatives, and logo derivatives | These payloads are larger, refetchable, and suitable for idle IndexedDB work. |
| `services/personalDisk` | Sparse channel and category overlays, placements, personal categories, and unavailable references | These viewer records cannot be refetched, so `openiptv-personal` has no eviction and cache clearing never opens it. |

Provider catalogues remain immutable. `stores/lineup` validates personal records, reconciles stable provider identities, applies sparse overlays, and materialises the effective channels, categories, browse view, search view and number index that every Live consumer reads. M3U records persist only hexadecimal fingerprints, so stream addresses and embedded credentials never enter the personal database.

Launch starts the personal record read beside the catalogue cache read and publishes only after both are ready, which prevents provider order or names from appearing before personal values. Direction input reads the materialised arrays and maps without opening IndexedDB. A committed mutation updates memory immediately, then one idle transaction advances the durable revision. A failed transaction restores the latest durable revision and preserves unavailable records. On the television, visibility and ordering writes apply optimistically, keep navigation interactive while the write is queued, and roll back to that durable state silently; explicit rename and number forms still report their own save failures. The paired phone keeps its existing Retry surface.

Reorder starts from the materialised category sequence. Picking up and releasing a row without movement leaves its order mode and revision unchanged. Placements that reproduce the provider sequence compact to no stored placements while the explicit Custom mode is retained, so Edit custom order stays available until another mode is chosen. VOD placement commits carry the provider item sequence because the lineup store does not own those catalogue rows. Live channel and category management share one row foundation on the television Settings and the paired phone. Playlist and category rows split into a primary open control and a separate menu control, while device, channel and unavailable rows are a single button that opens their actions. Playlist adds, renames and edits open as short overlays over the mounted list. Normal list headers keep only Search, while a scoped Playlist settings group holds the saved order and visibility preferences for the current playlist. The order setting opens a dialog whose options save on selection, Edit custom order appears only while Custom is the saved mode, and dedicated views such as Custom Order and visibility keep their own workflow, bulk category actions and Done control.

Provider detail editors and ordering views offer a tonal Reset button. In a detail editor Reset restores the draft fields to provider values until Save applies them, so Cancel keeps the persisted values. The read only channel context groups the original provider number badge with the provider name. Category context shows the original provider name.

Ordering Reset clears only the current section's or category's saved placements and returns that list to provider order through the optimistic queue. Choosing Custom again starts from provider order. Other names, numbers, visibility, memberships and sections remain unchanged.

All TV and laptop app pages share a 48px safe margin on every display edge, including the application menu, playback overlays, forms and dropdowns. Backgrounds can fill the display. The inner Return button has 48px between its outer edge and the display, with another 48px between the button and its divider. Internal content gutters remain separate from these screen margins. A Settings page reserves its safe margin outside the scrolling body so its contents cannot scroll through the protected display edges.

Movies and Series details share a two column layout with equal outer margins. Each side adds a 5% inset within the 48px TV safe area, matching the text's leading edge to the poster's trailing edge. Text occupies the leading column, while poster artwork aligns to the far edge of the trailing column. Loading artwork follows the same grid and uses the same corner radius as loaded artwork. Both detail pages keep a remote key guide below the content with matching horizontal insets, and poster sizes adjust for shorter viewports. Settings details, search pages and dialogs also show the shared navigation guide.

Each saved playlist remembers its own Live, Movies or Series section. Activating another playlist reads that destination's saved section without replacing it with the outgoing playlist's section. If the remembered section is unavailable, the app uses the first supported section. Switching playlists into Live restores the destination's remembered channel with the browser open and focused on that channel. Returning from Movies or Series to Live also keeps the browser open and focuses the remembered channel, including after its playback starts.

Movie and Series details use the shared page fade for entry and exit. Their layout changes under the fade without moving or collapsing the application menu. Metadata loads into the committed detail page without adding another navigation delay.

Movie and Series backdrops cover the full page behind the content, remote key guide and display safe margins. The programme guide action in playback controls highlights its whole information wrapper rather than the icon button inside it.

Browser fullscreen requests Escape locking where supported and permitted. A short Escape press follows the ordinary Back action, while holding Escape exits fullscreen without also navigating through pages. Browser shortcuts such as Cmd+R and Ctrl+R remain available, including in the remote key tester.

Modal key guides share the action footer with their buttons and show Select and Back without the full page movement badges. Movies and episodes start with playback controls open on Play/Pause. Their dismissal timer uses the same interval as the Live banner and restarts for each playback target.

Secondary playback controls share the Previous and Next geometry, while Play/Pause remains larger. The Live and loading indicators use the same visible circle size as secondary controls. Disabled controls use dimmed, hollow circles with a dashed edge and never acquire the active hover fill. Seek repeats accept a new step every 100ms, while the preview commits after 375ms without another step.

The hidden application menu retains its last visible expansion while a full screen inner page is open. Entering and returning from those pages updates menu and content geometry without a collapse, slide or label transition. Main section changes retain the menu's normal collapse animation, while the content fade boundary follows its moving edge and the Live rail stays stationary.

Native browser audio and subtitle lists are observed after metadata loading as well as when tracks are added, removed or changed. Tracks that arrive later update the playback controls without reopening the stream. The available choices still depend on the formats and track APIs that the browser exposes.

Settings and Change Playlist use the shared page fade for entry and exit, without a separate wait for the application menu to collapse. Their full screen inner pages use the same transition. Content and the controls on Saved Playlists, Movie details and Series details stay inside the shared TV safe margins, while backgrounds can fill the display. Every nested Settings detail carries one narrow Back rail beside the content. Directional input stays inside the page and restores the remembered body control when leaving Back. While a managed playlist's catalogue is being read, a centered spinner has an accessible label naming that playlist. Back remains reachable before the content arrives.

Settings dialogs and row action menus keep dismissal controls in a footer separated by a divider. Forms retain Cancel and Save, while the order dialog places Reset beside Close. The read only provider identity wrapper has a 64px minimum height matching the adjacent Reset control.

Appearance owns which content sections the television offers and when an empty category disappears. Show Live, Show Movies and Show Series gate the rail, remembered mode and search scope, and Hide empty categories removes a category only once its content is known to be empty, so an uncounted category stays and no per category request is added. The store enforces one supported section at all times: the last enabled switch refuses to turn off, a playlist change that would leave nothing available turns Live on in the stored settings rather than contradicting the switches, and every other saved value is preserved. Playlist management and the paired phone keep the unfiltered lists either way.

Durable state changes only after a personal record read or a completed write transaction. Category refreshes reconcile against the current live overlay, so they cannot replay the launch record over later edits. Playlist changes, removal and reset cancel queued work, drain mutation promises, wait for an active write, then perform destructive cleanup. A stale completion cannot publish under a newer playlist owner or recreate a deleted record.

Migration ownership remains with each final state reader. Settings converts legacy playlist addresses, records old alphabetical intent and retains hidden category fields until the matching personal lineup record commits. Compact personal state validates favourites, last playback and bounded progress, while durable lineup parsing keeps known version 1 fields and retained unavailable references. A failed or interrupted write leaves legacy input available for the next launch. A repeated completed launch makes no durable change.

Live channel selection updates memory immediately and keeps its short launch key synchronous. Serializing the full personal record waits for idle time, with later selections coalesced into one save. Any other personal save includes the latest selection and cancels the queued save, while reset cancels it before removing stored data. Paired device presence is also a memory snapshot between device mutations, so React's subscription reads do not repeatedly parse storage during channel feedback.

M3U overlay references use hexadecimal fingerprint identities rather than provider ids that may contain stream addresses. Reconciliation checks a complete fingerprint before considering a unique base fingerprint, while occurrence suffixes never fall back to another occurrence. Ambiguous overrides and memberships remain unavailable for explicit viewer action.

The IndexedDB cache has a fixed 24 MiB budget split into 12 MiB for playlists and catalogue data, 8 MiB for JPEG poster derivatives, and 4 MiB for PNG logo derivatives. Each class evicts its own least recently used entries, so poster browsing cannot evict the catalogue needed at launch. Diagnostics reports total usage and each class.

Small metadata payloads remain in a separate memory cache bounded to 4 MiB and 64 entries. Reads refresh their eviction order, while explicit cache removal invalidates pending memory fills. Unpersisted warm data remains usable when IndexedDB is unavailable without contributing to reported disk usage. Category and search arrays use UTF-8 JSON blobs on disk so a normalized index does not double its storage cost as a UTF-16 string. Readers also accept legacy string entries.

Playlist switching cancels obsolete artwork requests and warming without discarding finished bitmaps. Cache reads refresh bitmap eviction priority, while explicit artwork clearing still releases every bitmap. This preserves warm returns within the existing poster and logo limits without increasing download or decode concurrency.

`services/artwork` owns visible reference counts, queue cancellation, compressed byte limits, idle disk writes and independent bitmap limits. Its existing hard ceilings remain 18 load slots and 2 decode slots. A load slot remains held while decoding, which also bounds completed response buffers. Active jobs keep their slots when capacity shrinks until their native work actually finishes. Visible requests bypass the background quota, promote existing queued jobs and preempt unrelated unclaimed warming. Idle logo warming fills the available prefetch slots instead of processing every device through one serial chain.

`services/workload` selects the current load, decode and prefetch limits. A reported memory capacity of at most 1 GB caps them at 6, 1 and 1. A report above 1 GB and at most 2 GB caps them at 12, 2 and 2. Larger or unavailable memory hints retain the ceilings of 18, 2 and 4. Downloads start at 4 slots, or 8 when the browser reports at least 8 cores, subject to the memory cap. Decoding and prefetch start at 1 slot. Core count seeds the initial workload without being treated as a measurement of processor speed.

The policy learns from normal image work without a startup calibration loop, model year rules, additional requests or telemetry. Eight frame samples of at most 24ms provide responsiveness evidence. Successful image completion windows measure delivered throughput, while decode samples of at most 40ms permit additional decode and prefetch capacity. Growth decisions are separated by one second. A frame gap above 50ms immediately halves load capacity to a minimum of 2 and restores one decode and one prefetch slot. Growth then waits for three seconds of recovery. A throughput decrease reduces download demand without reducing the learned decode capacity solely because a provider responds slowly. The shared frame sampler exists only while owned image attempts are active, resets its clock across visibility changes and stops after the last attempt. Cache, bitmap and compressed byte ceilings remain unchanged.

Network, HTTP, timeout and decode failures receive up to 5 retries after the initial attempt, delayed 1, 2, 3, 4 and 5 seconds. Retrying jobs release their slots while waiting. Last claim release, abort and owner reset cancel queued retries and their timers. Up to 18 nearby posters enter bounded preparation when their committed grid window becomes available, while the 120ms gate remains for normal grid requests. The current prefetch limit controls how many preparation jobs can run together. Hidden and superseded grids release their preparation claims. `Artwork` observes actual intersection with the viewport, so clipped overscan rows and hidden screens do not retain foreground requests. Losing the last owner aborts obsolete network work and removes queued work immediately. A returning owner can create a fresh request in the same turn because completion only removes the job it owns. Native decodes already in progress finish before their discarded results close. Posters decode to their published card size, while the active details backdrop decodes to at most 1280 by 720 pixels and lives only for that details selection.

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

The flex gap probe remains the layout compatibility branch and has a gate of its own. Adaptive artwork capacity changes the amount of work admitted by the same scheduler on every engine, using optional hardware hints and observed responsiveness. It preserves one application path across model years. The simulator's base TV approximation and viewer experience goals are documented in [testing and measurement](testing.md). Additional engine specific behavior still needs coverage in the matrix.

Marquee geometry reads share one animation frame and complete before overflow state writes, so a column replacement does not interleave each label's measurement with another label's style update. Fitted and vertical text avoid computed direction reads. Number formatters are reused per locale, and the language option array is already in its tested English name order when the module loads.

Not every difference is testable in a browser, and the three that are not are on the Diagnostics
screen in Settings instead: what the set says it is, whether flex gap survived, and every key the
remote actually sends. "The yellow button does nothing on my TV" is not answerable by reading the
source and takes about four seconds from that screen.

## Not there yet

External XMLTV guides for M3U sources and recording management. Xtream short programme information and provider catchup are supported through the Player API.
