# OpenIPTV Product Redesign

## Purpose

OpenIPTV will provide two experiences inside one application. Live television will remain a fast channel based television interface. Movies and Series will become a full screen on demand library with poster browsing, search, progress, favourites, details, seasons and episodes. Both experiences will use one playback system, one visual language and one predictable remote model.

The redesign covers the open enhancement requests for playback seeking, recovery behavior, custom channel organisation, audio tracks and subtitles. It also addresses the current causes of excessive visible reconnecting, the absence of controls on recent minimal Samsung remotes and the mismatch between a channel list interface and a visual on demand catalogue.

Success means a viewer can discover every primary action using directions, OK, Back and Play or Pause without reading a guide. Focus never disappears, Back always removes exactly one visible depth, provider content remains unchanged, interaction work stays within the measured television budget and every supported Samsung engine receives the same artifact.

The implementation adds no hosted service, analytics, runtime dependency, provider administration, bundled content or model year branch.

## Design Authority

The interface follows [Samsung Smart TV design principles](https://developer.samsung.com/smarttv/design/design-principles.html), [Samsung media player guidance](https://developer.samsung.com/smarttv/design/media-player.html), [Samsung input guidance](https://developer.samsung.com/smarttv/design/input-methods.html), [Samsung application screen guidance](https://developer.samsung.com/smarttv/design/apps-screen.html) and the existing OpenIPTV One UI tokens.

Samsung guidance is authoritative for remote reachability, focus visibility, predictable direction movement, loading feedback, Back behavior, safe areas and television legibility. The approved OpenIPTV designs are authoritative for product structure, visual hierarchy, playback depths, VOD layout and personalisation.

The design makes two deliberate media player variations. Left and Right perform compact quick seeking on finite content without opening the full deck, while Samsung's reference player reveals its controls. When the deck opens immediately after quick seeking, the seek bar receives focus instead of Play or Pause. These decisions preserve a clean picture and place focus on the action the viewer was already performing. OK and Play or Pause remain predictable ways to reveal complete controls.

## Delivery Structure

The redesign is delivered through five plans whose commits and pull requests remain independently testable.

1. Application shell and navigation extracts screen ownership and key delegation while preserving the currently visible interface and behavior. Movies and Series continue using the existing panel until plan 3, so no empty interim mode ships.
2. Playback and recovery adds the player state model, revised key laws, playback deck, seeking, Live DVR, track drawers, guide integration and recovery policy.
3. VOD experience exposes the Live, Movies and Series modes, releases the decoder when VOD opens and adds the full screen Movies and Series shell, poster grid, search, details, seasons, episodes, progress and favourites.
4. Lineup personalisation adds custom channel and category data, ordering, naming, visibility and personal categories.
5. Remote management and completion adds phone management, migrations, documentation, broad television journeys and final acceptance verification.

A plan may split into smaller pull requests when one reviewable result can ship safely before the next. No pull request combines unrelated subsystems merely to reduce the number of reviews.

## Shared Application Modes

The shared header exposes Live, Movies, Series, Search and Settings for Xtream sources. M3U sources expose Live, Search and Settings because they contain no on demand catalogue.

Live preserves the channel based television experience. Movies and Series replace the Live panel with a full screen opaque VOD screen. The content mode is a product mode rather than a filter inside one channel panel.

Entering Movies or Series stops finite or live playback, releases the decoder and remembers the Live channel. Returning to Live retunes the remembered channel through the ordinary tuner path. A hidden live stream never continues consuming a provider connection behind VOD browsing.

Each mode remembers its selected category, focused item, scroll window and nested details position. Switching modes and returning with Back restores the exact previous position where the item still exists. A missing item falls back to the nearest valid position.

Search is scoped to the active mode. Live searches live channels. Movies searches movies. Series searches series. The heading names the scope and result count.

## Screen Stack

Only the highest open surface owns input. A context drawer always opens above its caller and visually replaces that caller, whether the caller is the playback deck or the Live browser.

| Order | Surface | Input ownership |
|:--|:--|:--|
| 0 | Playing picture | Live or finite playback keys |
| 1 | Playback deck, Live browser or VOD screen | One active primary surface |
| 2 | Guide, Audio, Subtitles, More or management drawer | Drawer options only |
| 3 | Settings, onboarding and exit confirmation | Modal owner only |
| 4 | Confirmation popup | Popup owner only |

A drawer opened from the deck closes back to the deck and returns focus to its originating action. A drawer opened from the Live browser closes back to the browser and restores the focused channel or control. The hidden caller never receives input and is not rendered behind the drawer.

A toast, Live title banner, compact recovery status or quick seek indicator does not own focus. Back clears the highest focus owning surface before it affects playback or navigation.

## Remote Input Contract

Focus movement stops at list boundaries and never loops. This deliberately revises the current wrapping rail and category focus behavior to follow Samsung guidance. Channel up and down may wrap because they change channels rather than focus. The implementation updates `AGENTS.md`, `docs/design.md` and the key law tests so the old absolute wording cannot conflict with the new mode specific contract.

### Live picture

Up and Down change channels. Left opens the Live panel. OK opens the Live panel. Right always opens the minimal Live playback deck, whether or not the stream has a DVR range. Play or Pause changes playback state and opens the deck. Back clears transient feedback, then offers exit when no other surface is open.

Live DVR seeking occurs only after the deck is open and the seek bar has focus. Left and Right never change meaning at an uncovered Live picture based on an invisible range.

Pausing ordinary Live removes the Live badge and shows the persistent paused state. Play retunes to the current Live edge. Pausing Live DVR preserves the current position, and Play resumes in place. Go live remains the explicit action for leaving a delayed DVR position.

When an engine does not expose a legal pause operation, the deck omits Pause and a physical Pause or Play or Pause request shows a compact Pause unavailable message without stopping the stream. The application does not emulate pause by tearing down the decoder.

### Finite playback picture

Left seeks backward ten seconds. Right seeks forward ten seconds. This behavior is identical while playing or paused. Quick seeking preserves the current play or pause state.

Repeated presses accumulate the target in ten second steps. A held direction accumulates repeated steps. The interface updates the target immediately and performs one engine seek 350 milliseconds after direction input settles. The target is clamped to the media duration. A pending engine seek fails after five seconds and restores stall monitoring.

Quick seeking shows a compact transient containing the accumulated direction and target time. It does not open the playback deck and does not take focus. A rejected or timed out seek restores the actual position and shows a compact Seeking unavailable message without changing play or pause state.

OK opens the playback deck. Play or Pause changes playback state and opens the deck with Play or Pause focused. Up and Down have no picture level action in finite playback. Back returns to the content details screen when no playback surface is open.

The former law that Up and Down always change a channel is narrowed to the Live picture. Finite playback, VOD browsing and management use mode specific keys that are visible from their focused surface.

Stop on finite playback persists progress, releases playback and returns to the originating details or episode. Stop on Live releases playback and opens the Live panel on the stopped channel. Physical transport keys perform their semantic action whether or not the deck is visible.

Digits tune channels only in Live mode and enter text while a search or form field owns input. Green remains an optional favourite shortcut. Yellow keeps opening Settings. Red retains Live category visibility where that shortcut is supported. Channel keys, transport keys, pointer controls, the development remote and paired remote commands preserve their current semantic actions through the same surface owners.

### Playback deck

The deck contains metadata, a seek bar when the content is seekable, centred transport controls, one context action on the leading side and Audio, Subtitles and More on the trailing side.

Up and Down move between the seek bar and control row. Left and Right move the seek target while the seek bar is focused. Left and Right move among buttons while the control row is focused. OK activates the focused control.

The deck opens with Play or Pause focused unless it follows quick seeking, in which case the seek bar receives focus. The deck closes five seconds after the latest interaction. Any direction, OK, pointer action or transport action restarts the timer. Back closes the deck immediately.

The deck may close while playback is paused. The persistent paused picture state remains visible after the controls disappear.

The Live title banner remains a report only surface for channel changes and keeps its existing eight second reading interval. Opening the deck, a drawer, the Live browser, VOD or a modal hides the banner. Finite playback does not use the Live title banner. The compact recovery status and quick seek indicator never appear over a deck or drawer.

### Playback drawer

Guide, Audio, Subtitles and More drawers keep all direction input inside the drawer. Each drawer title is vertically centred inside one fixed header region above its options. Drawers do not close on a timer because viewers need time to read and choose options. Opening a drawer cancels the deck timer. Back closes one drawer, restores the originating deck action and starts a fresh five second deck interval.

### VOD browsing

The VOD header, category rail and poster grid each own one cursor. Left from the first poster enters the category rail. Right from the category rail enters the remembered grid position. Up from the first grid row enters the shared header. Down returns from the header to the selected category.

OK on a category selects it and enters its grid when that category contains posters. An empty category keeps focus on its rail row and presents a nonfocus empty message in the catalogue region. A failed category keeps focus on the rail and exposes Retry as the only focusable item in the failed region. OK on a poster opens details. Back from details restores the exact poster. Back from search restores the previous category and poster. Back from the VOD root returns to the Live picture.

### Live browsing

The established Live panel rules remain authoritative. The title bar, category rail, channel column and guide retain one cursor and predictable direction movement. Channel selection and category browsing do not inherit VOD poster behavior.

## Visual System

Large surfaces use near neutral dark colours. Saturated colour appears only in compact status and selection roles. White identifies focus. One UI blue identifies active mode, selected category, playback progress, selected tracks, favourite badges and the Live edge.

The core roles remain:

```css
--over-video: rgba(13, 13, 15, 0.92);
--sheet: #0a0a0b;
--text: rgba(255, 255, 255, 0.96);
--text-2: rgba(255, 255, 255, 0.62);
--text-3: rgba(255, 255, 255, 0.46);
--on-focus: #101013;
--accent: #3e91ff;
--accent-dim: rgba(62, 145, 255, 0.18);
--focus: #ffffff;
--warn: #ffc453;
--danger: #ff6b6b;
--tonal: rgba(255, 255, 255, 0.11);
--line: rgba(255, 255, 255, 0.09);
```

Focus uses a solid white surface or white outline and a visible halo appropriate to the control. Selected state never substitutes for focus. A selected category uses accent tint and a blue marker while the focused poster uses a white outline.

No text appears below the existing twenty pixel television caption floor at 1920 by 1080. The implementation uses the existing font scale and available 400 and 600 weights. Text line spacing stays between 1.2 and 1.4 times the font size.

Floating video surfaces use `--over-video`, a 28 pixel corner radius, the existing elevation and a white hairline. They never use backdrop blur because AVPlay uses a hardware plane and older engines cannot composite that effect reliably.

All important content stays outside the existing 48 pixel horizontal and 40 pixel vertical safe area. Right to left layouts mirror spatial placement and direction movement while preserving semantic previous, next, back and forward meaning.

## Playback State Model

The controller exposes one engine independent state.

```ts
type PlaybackPhase =
  | "idle"
  | "connecting"
  | "playing"
  | "rebuffering"
  | "recovering"
  | "paused"
  | "seeking"
  | "ended"
  | "failed";

type SeekRange = {
  startSeconds: number;
  endSeconds: number;
  liveEdge: boolean;
};

type PlaybackSnapshot = {
  phase: PlaybackPhase;
  target: PlaybackTarget | null;
  position: number | null;
  duration: number | null;
  seekRange: SeekRange | null;
  bufferedPercent: number | null;
  recoveryAttempt: number;
  recoveryIn: number;
  fault: string | null;
};
```

AVPlay and browser engines translate their callbacks into this vocabulary. React components never infer engine state from several booleans.

Connecting means no picture has arrived for a new target. Rebuffering means a picture was playing and the engine reported buffering. Recovering means the controller is taking corrective action. These states have different timers, visuals and recovery behavior.

A deliberate pause or pending seek never contributes to stall detection. Reported buffering suspends the frozen playhead detector. Startup does not enter playing until the engine reports completed initial buffering or equivalent decoded playback evidence.

## Seeking and Live DVR

Finite content exposes a range from zero to duration. Browser engines use the media element seekable range where it is narrower than duration. AVPlay applies a saved finite position only after `prepareAsync` succeeds and the player is READY, before playback begins. No seek call occurs in IDLE.

AVPlay Live content reads `GET_LIVE_DURATION` only in READY, PLAYING or PAUSED and accepts only a valid start and end pair. It never reads the property while AVPlay is connecting or in IDLE. Browser HLS reads the media element seekable range and hls.js Live edge. A range whose useful span is too short for one ten second step is not shown as a seekable DVR range.

The controller derives `segmentSeconds` from the manifest where available and uses three seconds otherwise. The safe Live target is `endSeconds` minus a margin clamped between two and ten seconds from `segmentSeconds`. A Go live seek targets that safe value rather than the reported end itself.

Playback enters the Live state when position is within the greater of six seconds or twice `segmentSeconds` from the safe target. It leaves the Live state only after drifting four additional seconds beyond that threshold. This hysteresis prevents the badge and Go live action from flickering as the window advances.

A Live DVR timeline labels its oldest available programme time on the left. While playback is behind, a focusable Go live action appears at the right end and the Live badge is absent. Go live seeks to the latest safe target or retunes the channel when an edge seek is rejected.

At the Live edge, the thumb reaches the end, Go live disappears and the Live badge appears beside the channel identity. Ordinary Live content without a useful range shows the same Live badge and no seek bar. The badge always means current Live playback rather than merely a live source.

A visible Live target refreshes its range every two seconds and after each seek, restore or manifest change. Polling stops while the application is hidden or the target is not Live. A changing Live window updates without moving focus unexpectedly. A seek target that expires before commit clamps to the newest valid start.

## Playback Deck

On demand and catchup metadata contains content kind, title, year, duration, quality and position. Live metadata contains channel identity, current programme, programme times and next programme where available.

The minimal ordinary Live deck contains Live metadata, centred Play or Pause when pause is supported, Guide on the leading side and available Audio, Subtitles and More actions on the trailing side. It has no timeline, Previous or Next controls. Live DVR adds the timeline and Go live behavior without moving the remaining actions.

Previous and Next retain their positions in the centred finite transport group. Each control is enabled when an adjacent item exists and visibly disabled when the sibling list has no item in that direction.

The leading context action is Details for finite content and Guide for Live content. Audio, Subtitles and More retain stable trailing positions across content kinds. Controls that have no supported action are omitted rather than displayed as inactive decoration, except Previous and Next whose disabled position preserves transport geometry.

A subtle `--line` hairline separates metadata from every displayed seek bar. The seek bar has no enclosing border. Focus increases track thickness, enlarges the white thumb, adds a restrained halo and displays a floating target time. Blue remains the playback state rather than the focus colour.

## Audio and Subtitle Tracks

The player exposes a normalized track model.

```ts
type MediaTrack = {
  id: string;
  identity: string;
  engineIndex: number;
  kind: "audio" | "subtitle";
  label: string;
  language: string;
  selected: boolean;
  accessibility?: "sdh" | "descriptions";
};
```

AVPlay enumerates tracks with `getTotalTrackInfo()` only in READY, PLAYING or PAUSED and selects tracks with `setSelectTrack()` only in a documented valid state. hls.js uses its audio and subtitle track lists. Native media uses available audio and text track interfaces where the engine exposes them.

Track identity is the normalized tuple of kind, lowercase language, normalized provider label and accessibility role. Engine index is valid only for the current target and never participates in cross target matching.

Audio and Subtitle actions appear only when a meaningful choice exists. Subtitle options always begin with Off and may include Automatic when a device language match can be resolved without guessing. Audio labels prefer provider labels, then language, then a translated numbered fallback.

AVPlay subtitle text from `onsubtitlechange` renders in an application subtitle layer inside the safe area. An empty payload clears the cue immediately. A nonempty payload clears at the supplied duration, on the next cue, on track change and on target change. The layer treats provider text as text and never injects markup.

Browser text tracks use `hidden` mode while the application renders `activeCues`, which prevents native and custom captions from appearing twice. Turning subtitles Off disables application cue output and clears active text. Native rendering remains available only on a path where the application does not render the same cues.

Closing a drawer does not change selection. Selecting an item applies it immediately and returns focus to that row. Track selection resets when a new playback target lacks the previous normalized identity. A later preference feature may choose a matching language, but this delivery does not silently override provider defaults beyond an explicit Automatic selection.

External subtitle downloads remain outside scope.

## Programme Guide

Guide is a playback drawer for Live content and a context action in the Live browser. It lists programme entries for the current or focused channel using one windowed vertical list.

Current and future entries are readable. An archived entry with a valid catchup target exposes Play from start. Selecting catchup closes the drawer and starts finite playback. Back restores the deck or Live browser that opened Guide.

Guide loading, empty and failed states occupy the drawer and keep Back available. A failed guide provides Retry as a focusable action.

## Playback Recovery

Buffering shorter than 1.5 seconds produces no overlay. Longer rebuffering appears as a compact status beside the clock while the last frame remains visible. The full picture state is reserved for initial connection, paused playback and terminal failure.

Reported buffering suspends frozen playhead counting for a direct stream for twenty seconds. A stream with known segment duration receives the greater of twenty seconds or twice that duration, capped at forty five seconds. Expiry advances into recovery rather than leaving buffering unbounded.

One recovery coordinator performs steps sequentially and owns every token and timer:

1. Let the engine continue a reported buffer refill within the rebuffer limit.
2. Attempt warm browser recovery through hls.js load continuation or media error recovery. AVPlay calls `play()` only from READY or PAUSED and skips warm play from every other state.
3. Run compatibility diagnosis once against the original HLS address when compatibility is enabled and the fault is eligible. A repaired target is consumed before any address rewrite.
4. Try the existing HTTP fallback once against the original address when the fault is eligible and repair did not resolve it.
5. Reopen the resulting current target through the ordinary playback pipeline.
6. Apply application retry delays.

Compatibility and HTTP fallback never run as parallel effects. Attempt keys belong to the original playback target and survive a fallback URL rewrite. Every recovery records an internal cause for diagnostics without logging credentials, stream addresses or provider content.

The default retry policy remains bounded at four, eight and fifteen seconds. A new Continuous reconnect setting is off by default. When enabled for Live content, later retries wait thirty seconds, forty five seconds and then sixty seconds for every remaining attempt while the same channel remains selected.

Changing target, pressing Stop, entering VOD or exiting clears recovery timers and invalidates pending work. Hiding the application clears timers without resetting the attempt count, suspends the engine and prevents new provider connections. Returning visible restores the engine or begins one coordinated recovery from the retained attempt state.

Thirty uninterrupted seconds of playing resets the continuous delay and attempt count. Terminal authentication, unsupported format and explicit provider refusal faults remain visible and do not masquerade as ordinary congestion.

Buffer size changes require on set measurement. The redesign does not raise or lower buffering parameters merely to resemble another player. The on set harness must identify reconnect causes and distinguish reported buffering from a frozen engine before tuning values.

## VOD Shell

Movies and Series use a full screen opaque shell with a shared header, a 424 pixel category rail and a six column poster grid at the default scale.

The category rail contains Continue watching when nonempty, Favourites when nonempty, All, then provider categories in provider order. Empty personal categories do not create apology rows.

Continue watching orders items by the latest progress activity. It includes finite movies and episodes with retained progress. A completed item leaves Continue watching. Series progress resolves to the latest resumable episode and presents the parent series once.

The grid windows complete poster rows. Direct cursor arithmetic moves by one column or six columns and never reads layout boxes on a key press. `useViewport` may measure the region when layout changes, while a direction press performs no layout read. The visible window includes bounded overscan rows. Poster images decode to a published 192 by 288 pixel tile metric at the default scale through the existing two lane image queue.

A focused poster uses a white outline and halo. A favourite receives a compact blue star badge. Progress appears as a thin blue line on the poster. Title and one metadata line appear below artwork and obey the television text floor.

The rail and grid have transient scroll indicators that appear on entry and while moving. Indicators do not remain permanently over idle content.

## VOD Search

Search opens a full screen search surface inside the active Movies or Series mode. The Samsung search keyboard owns text entry. The search field remains visible above the keyboard.

Input updates immediately. Results follow after the existing 150 millisecond settle delay. Matching ranks names that begin with the query before names that contain it and caps results at 300 while reporting the complete count.

Results use the same windowed poster grid and favourite and progress badges. Down from the search field enters results. Up from the first result returns to the field. While the Samsung keyboard is open, Back first dismisses the keyboard and keeps focus in the field. A later Back closes search and restores the previous category and poster.

No result state names the query and leaves the search field focused. Loading and provider failure states show one regional indicator or Retry action rather than one indicator per tile.

## Movie Details

Movie details use a full screen hero with metadata, synopsis, poster art, watched progress and a vertical action stack.

A movie with progress shows Resume from the saved time first, Start from beginning second and Add to Favourites or Remove from Favourites third. A new movie shows Play first and the favourite action second.

Selecting Resume passes the saved position. Selecting Start from beginning passes zero and replaces saved progress once playback advances. Returning from playback restores the details action and poster origin.

Adding a favourite updates the details action, poster badge, Favourites count and category visibility immediately. The green key may remain an optional shortcut but is never the only path.

## Series Details

Series details keep the hero, metadata, synopsis and favourite action on one screen. A season selector and episode list occupy the same screen instead of creating one screen per season.

The season selector is an ordered horizontal row reached from the episode list. The episode list is windowed vertically and shows episode number, title, duration and progress. Changing season restores the remembered episode for that season where it remains valid.

A series with resumable progress shows Resume next episode or Resume episode as the primary action. Episode selection opens actions for Resume or Play and Start from beginning where progress exists. Favouriting applies to the parent series rather than an individual episode.

Back from an episode action returns to the episode. Back from series details returns to the exact series poster.

## VOD Loading and Performance

Any regional load over 100 milliseconds shows stable poster skeleton geometry and one accurate loading message. Loading never displays one spinner per poster.

Category movement answers immediately. A 150 millisecond settle interval delays category fetching and grid replacement while the viewer holds a direction. Poster fetching begins after the grid settles for 120 milliseconds.

The image pipeline gains a poster size parameter while preserving two decode lanes, on screen reference counting, queue cancellation and idle disk writes. Poster bitmaps use a separate twelve megabyte memory budget and a maximum of forty eight entries, whichever limit is reached first. Eviction closes each bitmap.

The existing twenty four megabyte disk cache reserves at least twelve megabytes for playlists and catalogue data, at most eight megabytes for JPEG poster derivatives and at most four megabytes for channel logos. An item larger than its class budget is refused. Cache accounting and eviction tests prove that poster churn cannot evict the active launch catalogue merely because artwork was viewed.

No VOD grid uses generic geometric focus measurement. No screen mounts an entire provider catalogue. No poster fetch continues for a category the viewer has left.

## Personal State

Playback progress gains the latest activity time and enough snapshot data to render and resume Continue watching before a category load.

```ts
type ResolvedPlaybackProgress = {
  itemKey: string;
  playlistId: string;
  kind: "movie" | "episode" | "catchup";
  providerId: string;
  categoryKey: string;
  extension?: string;
  seconds: number;
  duration?: number;
  updatedAt: number;
  name: string;
  logo: string;
  parentKey?: string;
  parentProviderId?: string;
  parentName?: string;
  season?: number;
  episode?: number;
};

type LegacyPlaybackProgress = {
  itemKey: string;
  seconds: number;
  duration?: number;
  legacyOrder: number;
};

type PlaybackProgress = ResolvedPlaybackProgress | LegacyPlaybackProgress;
```

Progress remains bounded to 100 finite items. Continue watching renders only resolved movie or episode records. A movie or episode is resolved only when provider id, category key and container extension are available. Episode records present the parent series once and carry the provider id and extension needed to resume the latest episode directly. Catchup progress remains available from Guide while the archive target is valid and does not appear in Continue watching.

Existing records become legacy entries with their persisted index as `legacyOrder`. Migration captures one base time and a resolved legacy entry receives `updatedAt = baseTime - (legacyCount - legacyOrder) * 1000`, which preserves prior order without making an old item newer than subsequent activity. Movie entries resolve when the whole movie index loads. Episode entries resolve when a loaded series detail contains the episode because the provider has no episode lookup endpoint. Unresolved entries do not render, remain bounded and are removed when their playlist is deleted, their account is replaced, application data is reset or a loaded authoritative catalogue proves the item absent.

Progress persists after a fifteen second advance, pause, Stop, application hiding and target change. Completion removes progress. Start from beginning does not remove progress until the new session advances far enough to persist.

Favourites continue to store movies and parent series, never episodes. Existing favourite snapshots remain compatible.

## Lineup Personalisation

Provider data remains immutable. Personalisation is a sparse overlay keyed by playlist and stable provider identity.

```ts
type ChannelRef = {
  id: string;
  sourceFingerprint?: string;
};

type OrderPlacement = {
  itemId: string;
  beforeId?: string;
  afterId?: string;
};

type ChannelOverride = {
  name?: string;
  number?: number;
  hidden?: boolean;
  sourceFingerprint?: string;
};

type CategoryOverride = {
  name?: string;
  hidden?: boolean;
  channelOrder?: OrderPlacement[];
};

type PersonalCategory = {
  id: string;
  name: string;
  channels: ChannelRef[];
};

type LineupOrderMode = "provider" | "alphabetical" | "number" | "custom";

type LineupPersonalisation = {
  channels: Record<string, ChannelOverride>;
  categories: Record<string, CategoryOverride>;
  categoryOrder: OrderPlacement[];
  personalCategories: PersonalCategory[];
  orderMode: LineupOrderMode;
};
```

Effective channels and categories are materialized once when a catalogue is adopted. Search, dialling, favourites, display and channel changing consume the effective values without learning overlay logic.

Custom channel numbers are positive integers. Duplicate custom numbers are rejected before persistence. Provider numbers remain when no override exists. Number dialling uses an indexed map rather than scanning the lineup.

Custom ordering stores one relative placement for each moved item. Applying placements removes the item from provider order and inserts it before or after its surviving anchor, which represents a move to any position without storing every unmoved identifier. A later move replaces the earlier placement for that item. A placement with no anchor means move to the end. When recorded anchors disappear, the item stays at its provider position and management reports the unresolved placement.

Alphabetical sorting becomes an explicit order option beside Provider order, Channel number and Custom order. The existing `sortAlphabetically` setting migrates to `alphabetical` when true and `provider` when false, then is removed. A locale change rematerializes alphabetical order with the existing locale collator. The television and phone protocol update to the new order mode in the same release.

A viewer may rename and hide channels, rename and hide provider categories, reorder categories, create personal categories and arrange membership. Personal categories do not remove a channel from provider categories. Hidden category behavior preserves the existing Hide everywhere and Keep in Search and Favourites choices. An individually hidden channel follows the playlist's selected hidden content mode unless management explicitly reveals hidden items.

Favourites remains a synthetic category and is not renamed or deleted. Personal categories and provider categories have distinct stable keys.

## Lineup Reconciliation

Xtream identities remain stable through provider stream and category identifiers. M3U duplicate identifiers may carry positional suffixes, so channel overrides and personal category membership also remember an opaque deterministic source fingerprint. The fingerprint concatenates two 32 bit FNV-1a passes with different fixed seeds over tvg id, exact name, exact group and exact stream address separated by null characters. The parser collision checks fingerprints within the current catalogue and adds a deterministic collision suffix. Only the resulting hexadecimal fingerprint persists, so raw stream addresses and embedded credentials never enter personalisation.

Refresh retains unavailable overrides and memberships until the viewer removes them, the playlist is deleted, the account is replaced or application data is reset. Provider outages therefore never erase viewer work. Management reports unavailable personalised items and offers explicit removal. A reference reseats automatically only when one current item matches its stable identity or source fingerprint, then persists the new current identifier.

Provider category renaming does not break Xtream overrides because category keys use provider identifiers. M3U category names are keys, so reconciliation may migrate one exact unique display name match and otherwise keeps the override unavailable for explicit repair.

Existing `hiddenCategories` migrate into `CategoryOverride.hidden` through the current unique key and name rules. Existing `hiddenCategoryMode` remains on the playlist and keeps its Hide everywhere or Keep in Search and Favourites meaning. Migration is idempotent and removes legacy values only after the new record commits successfully.

Removing a playlist deletes its personalisation after the existing confirmation. Replacing an Xtream account deletes personalisation with the other account scoped state. Password and output changes preserve it.

## Management Experience

Television management extends the existing playlist category manager into Channels and Categories details. It supports search, reveal hidden, rename, number entry, ordering, personal category creation and membership.

Ordering enters an explicit Sort mode. OK grabs the focused item. Up and Down move the grabbed item through a tentative local order. OK commits one relative placement and releases the item. Back while grabbed restores the order from before the grab. Back with nothing grabbed leaves Sort mode. Ordinary browsing never changes order.

The paired phone interface provides the same operations with paging and search. State snapshots never include a complete large catalogue. A lineup query contains playlist id, channel or category scope, optional category key, optional search query, hidden inclusion, cursor and limit. The default page size is fifty and the maximum is one hundred.

```ts
type LineupQuery = {
  playlistId: string;
  revision: number;
  scope: "channels" | "categories" | "personal-categories";
  categoryKey?: string;
  query?: string;
  includeHidden?: boolean;
  cursor?: string;
  limit?: number;
};

type LineupPage<T> = {
  revision: number;
  items: T[];
  nextCursor: string | null;
  total: number;
};
```

The lineup revision increments after every committed personalisation mutation and whenever authoritative catalogue adoption changes the identifiers or availability visible to management. An identical refresh leaves it unchanged. A page cursor is stable only within the query revision and encodes that revision with its next position. A stale revision or cursor returns a conflict before any page or mutation result, so a phone never combines pages from different lineup states.

Rename, number, visibility, placement, personal category and membership mutations carry the existing revision and request identifier. A successful mutation returns the new revision and affected identifiers, then the phone refetches its current page. A conflict returns the current revision without applying a partial mutation.

No management action rewrites the provider playlist or sends provider data to a hosted service.

## Persistence

Settings, favourites and bounded progress remain in synchronous local storage because launch needs them before first paint. Large refetchable catalogue and artwork data remain in the existing cache IndexedDB.

Lineup personalisation uses a separate `openiptv-personal` IndexedDB database at version 1 with one `lineups` object store keyed by playlist id. Complete ordering and personal category membership can exceed the local storage budget and cannot be refetched after eviction. This database has no least recently used eviction and is not cleared by cache clearing. Launch reads the cached catalogue and its personalisation concurrently, then materializes one effective lineup so provider order never flashes before personal order. No direction key reads IndexedDB.

Bulk ordering and membership changes update React state immediately, then write one transaction after commit through the idle queue. A quota or transaction failure restores the previous durable revision and shows a management error instead of silently losing viewer work. One playlist cannot hold more overrides or memberships than its current and explicitly retained unavailable references, and personal category count is capped at 128.

All new state readers validate unknown saved values, merge known defaults and remove fields this version no longer owns. Migrations are idempotent and have tests for empty, malformed, previous version and partially migrated values.

Reset clears all personal state, lineup overlays, caches, authorised devices and settings through the existing confirmation boundary. Cache clearing never clears personal state.

## Component Boundaries

`App.tsx` remains the screen stack owner, tuner owner and top level mode owner. It delegates input and rendering rather than containing VOD frame parsing and every key branch.

The target boundaries are:

```text
src/screens/LiveScreen.tsx
src/screens/VodScreen.tsx
src/components/playback/PlaybackDeck.tsx
src/components/playback/PlaybackDrawer.tsx
src/components/playback/TrackPicker.tsx
src/components/playback/QuickSeek.tsx
src/components/vod/PosterGrid.tsx
src/components/vod/VodSearch.tsx
src/components/vod/VodDetails.tsx
src/components/vod/SeriesDetails.tsx
src/components/vod/EpisodeList.tsx
src/hooks/usePlaybackController.ts
src/hooks/useVodNavigation.ts
src/services/playbackRange.ts
src/services/personalDisk.ts
src/stores/lineup.ts
```

Names may change only when the implementation plan demonstrates that an existing focused file already owns the responsibility. No new abstraction exists with one speculative consumer.

`services/player.ts` remains the engine boundary. The playback controller owns policy, retries and normalized state. React presentation never calls AVPlay or hls.js directly.

`stores/library.ts` remains the VOD data and cache boundary. VOD components request typed categories, catalogues and details without constructing API calls.

`stores/lineup.ts` owns personalisation and catalogue materialization. `services/personalDisk.ts` owns durable transactional storage without cache eviction. Live presentation consumes effective channels and categories.

## Error Behavior

Errors stay inside the region that failed. A category failure leaves the VOD shell and rail available. A drawer failure leaves playback available. A track selection failure restores the previous selection and reports one compact message. A management failure retains edits in the form and does not mutate persisted state.

Every failed region names the failure in plain language and offers Retry where repeating can help. Authentication, permissions, unsupported formats and malformed provider data use distinct explanations.

An old asynchronous result never replaces state belonging to a newer mode, category, target, query or management revision.

## Accessibility and Internationalisation

Every focusable control has an accessible name that matches its visible action. Focus remains visible at three metres through shape and contrast rather than colour alone. Disabled state differs from focused and selected state.

Motion is short, functional and disabled by the existing reduced motion rule. No information relies on motion.

Provider text preserves its language and direction. Application labels are translated through the existing locale service. Poster titles, track languages, categories, programme data, management forms and subtitle text receive right to left review.

Subtitle placement avoids controls and television safe areas. Text size, edge treatment and line count remain readable over bright and dark pictures.

## Security and Privacy

No log, diagnostic row, cache key, favourite, progress record or personalisation record exposes provider credentials. Stream and artwork addresses remain local and are never sent to analytics.

Subtitle text is rendered as text. Provider names and descriptions are rendered through React text nodes. Remote commands validate type, length, identifier ownership and revision before mutation.

The redesign introduces no external proxy, account, cloud synchronization or cross device content copy.

## Compatibility

Production code targets ES2019 and Chromium 69. It does not use unsupported runtime methods, CSS `aspect-ratio`, CSS `inset` shorthand or unguarded flex gap.

One artifact runs on every supported model. Runtime branches are based only on measured media capability such as seek range or track availability, not model year, user agent or engine version.

AVPlay state restrictions are enforced inside the player boundary. Optional calls fail without preventing playback on older firmware.

The shell plan updates the project map, key laws and changed invariants in `AGENTS.md` and `docs/design.md` in the same commit that changes those contracts. Tests and documentation never leave the old absolute Live wording in force for finite playback.

## Verification Strategy

Every behavior change begins with a failing focused test where the project test environment can represent it. Pure navigation, range, ordering, migration and state functions receive direct unit coverage. Components receive direction, focus, Back and empty state coverage. Player adapters receive AVPlay and browser contract coverage.

The key law suite expands into separate Live picture, finite picture, playback deck, playback drawer, VOD root, details, search and management contracts. A generated transition matrix verifies that every relevant key from every focus state leads to one valid focus owner or deliberate no action.

The television harness gains controllable AVPlay and network fault fixtures before recovery journeys are added. Fixtures can start and end buffering, freeze the playhead, omit a seek callback, reject a seek, emit network or media faults, change the Live window and hide or restore the document. Every fault journey asserts the recovery cause and provider connection count.

The television harness gains journeys for:

- Holding directions across a cold and warm VOD poster grid.
- Switching VOD categories and returning to remembered positions.
- Searching and returning to the previous poster.
- Opening movie and series details, changing season and resuming an episode.
- Adding and removing favourites.
- Opening and closing the playback deck and every drawer.
- Quick seeking while playing and paused.
- Live DVR seeking, Go live and Live badge transitions.
- Rebuffering, warm recovery, full recovery and continuous reconnect cancellation.
- Channel and category sorting, naming, hiding and personal category assignment.

Migration tests seed every previous local storage shape, malformed partial values and interrupted migrations. Reconciliation tests cover moved M3U duplicates, unavailable references, category rename and explicit removal. Protocol tests apply each management mutation through television state and phone commands, then compare durable personalisation and the affected paged query.

Layout changes run the spacing parity gate. Runtime and media API changes run the engine parity gate. Poster grids, playback interaction and management paths run the television performance budget on a quiet machine. WebAssembly checks run only if repair or committed WebAssembly artifacts change.

The complete local gate before each pull request follows `CONTRIBUTING.md`. Real television acceptance covers HLS Live with and without DVR, MPEG TS Live, one movie, one episode, one catchup item, multiple audio tracks, embedded subtitles, rebuffer recovery and a large poster catalogue.

## Acceptance Criteria

The redesign is complete only when all of the following are true:

1. Every primary feature is reachable with directions, OK, Back and Play or Pause.
2. Live, Movies and Series preserve independent navigation positions.
3. Finite quick seeking works while playing and paused without opening the deck.
4. The deck, drawers and Back order follow the documented timer and focus contracts.
5. Live DVR range, Go live and Live badge state reflect actual playback position.
6. Audio and subtitle choices work on AVPlay and supported browser paths.
7. Rebuffering does not trigger the frozen stream detector while the engine reports buffering.
8. Recovery cancels and resets exactly as documented.
9. VOD search, Continue watching, favourites, movie details, series details, seasons and episodes work with loading, empty, failure and retry states.
10. Poster navigation responds immediately on the floor profile without unbounded nodes, decodes or cache writes.
11. Provider names, numbers, categories and ordering remain recoverable after personalisation.
12. Personal changes survive refresh and report unresolved items honestly.
13. Television and phone management produce the same persisted result.
14. Focus, selected, active, disabled, warning and destructive states remain visually distinct.
15. English and right to left layouts pass direction and clipping tests.
16. Relevant lint, type, unit, component, build, spacing, engine and performance checks pass.
17. Independent architecture, correctness, Samsung UX and performance reviews report no unresolved blocking or high confidence defects.

## Completeness and Change Control

Implementation agents may add a missing behavior without a separate product decision only when it is required to satisfy an acceptance criterion, prevent a bug, preserve accessibility, complete an error state or maintain consistency with an approved adjacent state.

An implementation agent must report any newly discovered product feature, new dependency, new remote meaning, destructive migration, external service, provider write operation or substantial visual structure before implementing it. The master specification and affected plan are updated before that work begins.

This rule allows natural completion while preventing unreviewed scope from changing the product during implementation.

## Review Loop

Each implementation task is assigned to one write enabled subagent with the exact spec section, interfaces, tests and files it owns. No two write agents edit the same files concurrently.

After a task passes its focused checks, independent read only subagents review correctness, project rules, Samsung UX, navigation, accessibility and television performance. Review findings require file and line evidence and are filtered for confidence.

Validated findings return to the implementation owner or to a fresh focused fix agent. The affected checks rerun, then independent review repeats. A task is complete only when no blocking or high confidence finding remains and its acceptance tests pass.

After all tasks in one subsystem pass, a whole subsystem review checks interface integration and complete diffs. After all subsystems pass, a whole branch review and complete local gate run before any pull request is proposed.

## Excluded Work

The redesign does not add recording management, provider administration, reseller actions, account purchasing, external subtitle downloads, cloud synchronization, recommendations based on inferred taste, autoplay previews, analytics, advertising or bundled media.

A provider may expose a category called Recently added. OpenIPTV does not invent recency where the provider supplies no timestamp.

The implementation does not promise recovery from a stream whose server removed the requested Live segment, a codec unsupported by the television or credentials rejected by the provider. It reports those conditions accurately and preserves navigation.
