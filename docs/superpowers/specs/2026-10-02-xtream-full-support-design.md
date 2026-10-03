# Full Xtream Support Design

## Purpose

OpenIPTV will treat an Xtream account as a first class source rather than as an M3U address with an API fallback. A viewer will be able to use live television, movies, series, episodes, programme information and provider catchup while the application remains simple enough for a 2020 Samsung television.

Success means Xtream content behaves consistently across launches, playlists and devices. Favourites, hidden categories, search, number entry and resume must resolve the same item regardless of provider availability. The user interface must preserve the existing screen stack, remote key laws, One UI focus language and immediate key response.

The implementation introduces no runtime dependency, hosted service, analytics request or provider management capability.

## Supported Xtream Surface

The application supports authentication through `player_api.php`, account status, live categories and streams, movie categories and streams, movie details, series categories, series summaries, seasons, episodes, short programme data and catchup playback advertised by programme data.

Account status includes activation state, expiry, trial status and active connection information when the provider returns those fields. The information appears under the saved playlist in Settings and never blocks playback after a successful authentication.

Live playback supports the configured HLS or MPEG TS output. Movies and episodes use their provider supplied container extension. A nonempty `direct_source` may be used only as the item's stream address and never has account credentials appended to it.

Recording management, reseller actions, `panel_api.php`, provider administration, account purchasing and cloud synchronisation remain outside the player. External subtitle downloads and provider specific extensions remain outside this delivery unless they are required for a valid standard response encountered during implementation.

## Saved Source Model

A saved playlist gains a discriminated source. M3U sources hold one address. Xtream sources hold server, username, password and preferred live output as separate fields.

```ts
type PlaylistSource =
  | { kind: "m3u"; url: string }
  | {
      kind: "xtream";
      server: string;
      username: string;
      password: string;
      output: "m3u8" | "ts";
    };
```

`Playlist.url` is replaced by `Playlist.source`. Code that needs an M3U request address reads the M3U source directly. Code that needs an Xtream endpoint receives typed credentials and constructs only the endpoint required for that request. Each playlist also carries a positive integer `sourceVersion`, initially 1, which increments whenever any source field changes.

Existing `get.php` entries carrying username and password are migrated when settings load. Missing `type` is treated as `m3u_plus` and missing `output` is treated as `ts`. An explicit unsupported type or output keeps the address as M3U. `parseXtreamPlaylistUrl` produces the typed Xtream source and other addresses become M3U sources unchanged. Persisting the migrated settings removes the encoded credential URL from future state.

Playlist identifiers remain stable. Changing the Xtream server or username is an account replacement, so favourites, last played state and playback progress belonging to that playlist are cleared after the new account is accepted. Changing password or output preserves item identity. Every source change increments `sourceVersion`, so cached network data from older credentials becomes unreachable immediately and is removed by the next sweep.

Credentials remain local to the television because Xtream requires them for every API and stream request. Cache keys, item identifiers, diagnostics and visible errors never include credentials. The application never logs a playlist source or generated stream address. Persisted settings using `source` are intentionally unreadable by older application versions, so downgrading requires re-adding the playlist.

## Identity Model

Every provider object has an opaque application key and a separate display name. Display names always preserve provider text exactly. Content type, source and selection state are presented by translated interface labels rather than by rewriting provider names.

Live, movie, series and episode keys include the saved playlist identifier and provider identifier.

```text
xtream:<playlistId>:live:<streamId>
xtream:<playlistId>:movie:<streamId>
xtream:<playlistId>:series:<seriesId>
xtream:<playlistId>:episode:<episodeId>
```

Category keys use `<kind>:<categoryId>` within the playlist. Category names are display values and are never used for lookup, persistence or request routing. Empty category names use the shared `UNCATEGORISED` sentinel so every locale receives the existing translation.

Provider responses with missing object identifiers skip those objects. Duplicate identifiers keep the first object returned for that content kind and playlist, which prevents favourites, playback markers and next item movement from becoming ambiguous.

## Catalogue Types

`Channel` remains the live television record consumed by the existing lineup, search and tuner paths. An Xtream channel carries optional provider metadata containing `playlistId`, `streamId`, `categoryKey`, `archiveDays` and `directSource`, so Guide never parses an application identifier. On demand content uses explicit records because live and finite media have different navigation and playback semantics.

```ts
type ContentKind = "live" | "movie" | "series" | "episode" | "catchup";

type XtreamCategory = {
  key: string;
  id: string;
  kind: "live" | "movie" | "series";
  name: string;
  count?: number;
};

type Movie = {
  key: string;
  streamId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension: string;
  year: string;
  rating: string;
};

type Series = {
  key: string;
  seriesId: string;
  categoryKey: string;
  name: string;
  logo: string;
  year: string;
  rating: string;
};

type Episode = {
  key: string;
  episodeId: string;
  seriesKey: string;
  season: number;
  number: number;
  name: string;
  extension: string;
  durationSeconds?: number;
};
```

Provider metadata stays optional because panels return different shapes. Normalisation accepts strings or numbers for identifiers and numeric fields, rejects arrays where records are expected, and tolerates missing optional values without fabricating provider content.

## Xtream Service Boundary

`services/xtream.ts` owns endpoint construction, authentication, response validation, normalisation and stream URL construction. The store never carries a session object or credentials inside category records.

The service exposes focused functions for authentication, categories, all live streams, one movie category, one series category, movie details, series details, short EPG and catchup URL construction. Functions receive typed credentials and an `AbortSignal` where they perform network work. The channel and library stores authenticate independently and retain one in memory session per playlist identifier and `sourceVersion`, so cancellation ownership never crosses stores.

The Player API contract uses `/player_api.php` with username and password on every call. Authentication omits `action`. Categories use `get_live_categories`, `get_vod_categories` and `get_series_categories`. Lists use `get_live_streams`, `get_vod_streams&category_id=<id>` and `get_series&category_id=<id>`. Details use `get_vod_info&vod_id=<id>` and `get_series_info&series_id=<id>`. Programme data uses `get_short_epg&stream_id=<id>&limit=20`. Series episodes are read from the response `episodes` object keyed by season number.

Live streams use `/live/<username>/<password>/<streamId>.<output>`, movies use `/movie/<username>/<password>/<streamId>.<extension>` and episodes use `/series/<username>/<password>/<episodeId>.<extension>`. Catchup uses `/timeshift/<username>/<password>/<durationMinutes>/<YYYY-MM-DD:HH-MM>/<streamId>.ts`. All path values are encoded independently.

Endpoint construction begins from the configured server URL. Provider `server_info` may supply protocol, hostname and port, but every field is parsed independently and falls back to the configured value. A full URL, bare hostname, hostname with port or missing field must all produce a valid result. Browser HTTPS policy is applied to API, direct source, artwork and generated stream addresses consistently.

A provider supplied stream host may differ from the API host because legitimate providers use media domains. Credentials may be embedded only in the standard Xtream path constructed from a validated HTTP or HTTPS origin. Arbitrary schemes, user information in provider hosts and malformed ports are rejected.

Each operation treats an aborted request as abandoned. An abandoned request never writes state, reports an error or changes loading status. The newest catalogue request owns catalogue state and the newest request for a category or details record owns that record.

## Loading Strategy

An Xtream launch authenticates, loads all category lists and loads all live stream summaries. Live streams are eager because resume, favourites, global live search, number entry and channel changing require a complete live lineup. This work replaces the current M3U request for an Xtream source, so one account never alternates between M3U and API identities.

Movie and series entries load by category after explicit navigation. Movie details load when a movie is opened. Series details, seasons and episodes load when a series is opened. Programme data loads for the playing live channel and for a focused channel only after focus settles.

The rail still answers a key immediately. Category fetching begins after the existing 150 ms rail settle interval. Focused programme fetching uses a cancellable settle interval and never blocks focus movement.

An empty category remains a successfully loaded empty category and is not fetched on every visit. Loading, loaded, empty and failed states are recorded separately for each category and details record.

## Cache and Refresh

The existing IndexedDB cache owns Xtream catalogue data. Entries use playlist and content identifiers rather than addresses or credentials.

```text
xtream:<playlistId>:v<sourceVersion>:account
xtream:<playlistId>:v<sourceVersion>:categories
xtream:<playlistId>:v<sourceVersion>:live
xtream:<playlistId>:v<sourceVersion>:movie-category:<categoryId>
xtream:<playlistId>:v<sourceVersion>:series-category:<categoryId>
xtream:<playlistId>:v<sourceVersion>:movie:<streamId>
xtream:<playlistId>:v<sourceVersion>:series:<seriesId>
```

The existing cache budget and least recently used eviction remain authoritative. Catalogue entries are refetchable and may be refused when one entry exceeds the budget. The launch sweep keeps only M3U entries for configured addresses and Xtream entries whose playlist identifier and source version are current. Removing a playlist, replacing an account or changing credentials therefore makes stale entries removable without putting credentials in a key.

Freshness stamps use `openiptv.at.xtream:<playlistId>:v<sourceVersion>:<scope>`. Cache clearing removes both `playlist:` and `xtream:` disk entries plus M3U and Xtream stamp keys. The launch sweep removes stamps whose playlist identifier, source version or scope no longer has a configured cache owner.

A cached account and live catalogue may answer launch immediately. Fresh entries avoid network work. Stale entries remain visible while one idle refresh checks the provider. A failed refresh keeps the cached view and reports the existing saved copy message.

Opened movie and series categories use the same six hour freshness policy initially. Programme information stays in memory with a short lifetime because its value is time dependent and small enough to refetch when requested.

## Personal State

Favourites use provider scoped item keys. Live channels, movies and series may be favourited. Episodes are not favourited because the parent series is the stable object a viewer returns to.

A compact favourite snapshot stores the item key, playlist identifier, content kind, provider identifier, category key, name, logo and extension where needed. This lets an on demand favourite render before its category cache is read. The provider remains authoritative when the category is next loaded.

Last played state becomes a typed record containing playlist identifier, content kind, item key and category key. Live resume resolves against the eager live catalogue. Movie, episode and catchup resume also stores a bounded playback position.

Playback progress is retained for at most 100 finite items. Progress writes occur when playback pauses, stops, becomes hidden or advances by at least 15 seconds since the previous persisted position. Completing an item removes its saved position. Reset app data clears favourites, last played state and progress.

Legacy string favourites and last played values are adopted when a loaded playlist contains the matching channel. An unscoped `xtream:<kind>:<id>` value maps only when exactly one migrated Xtream playlist is configured, otherwise it is discarded. Unresolved legacy values are removed after every configured playlist has completed one catalogue load. Legacy Xtream hidden category labels are mapped to an opaque key only when one returned category has the same content kind and display name, while ambiguous or missing matches become visible and the stale label is removed.

## Panel Navigation

The existing player, banner, panel and settings layers remain unchanged. Full Xtream support adds no new top level screen layer.

For an active Xtream source, the panel header contains a content selector for Live, Movies and Series. Search, Guide and Settings remain application controls on the same header row. The selected content kind and the focused control use different visual states. For an M3U source, the selector and Guide are absent, preserving the existing header.

The category rail shows categories for the selected content kind and preserves provider names. Switching content kind remembers the rail and item cursor for each kind. Hidden categories remain scoped by playlist and opaque category key.

The item column uses a navigation frame stack. Live and movie categories have one item frame. Series navigation pushes series, season and episode frames. Movie selection pushes a detail frame. RETURN removes one frame, then leaves search, then closes the panel according to the existing key law.

OK plays a live channel. OK on a movie opens its details, where Play or Resume starts playback. OK on a series opens its seasons. OK on a season opens its episodes. OK on an episode starts or resumes playback.

Left and right continue to move within the visible interface. They do not become hidden shortcuts for details or catchup. Every action remains reachable through focus, OK and RETURN.

Search is global for Live because all live summaries are loaded. Movie and Series search covers loaded categories in this delivery and states that scope in the result heading. The application does not download an entire large on demand catalogue merely because one character was typed. A future explicit account search requires separate floor measurements.

Each frame has visible loading, empty and failed states. A failed frame offers Retry as a focusable action and RETURN always restores the previous frame. No failure leaves an empty unlabelled column.

## Guide and Catchup

The banner shows current and next programme information for the playing live channel when the provider supplies it. Missing programme data leaves the current banner unchanged.

Guide in the panel header opens a guide frame for the focused live channel, or the playing channel when focus is outside the live list. The frame lists provider programme entries in chronological order. Programme titles and descriptions are decoded when the provider returns valid base64 and are otherwise shown as supplied.

A programme marked as archived and within the channel archive duration exposes Play from start. Catchup uses the provider start time and duration to construct a timeshift address. Future programmes and archived programmes without a valid timeshift address remain readable and do not present a play action.

Catchup playback uses finite media behavior. RETURN from guide restores the channel list and its cursor.

## Playback Modes

The player accepts a playback mode of live or finite. Existing live behavior remains unchanged, including channel changing, delayed tuning, pause returning to the live edge, automatic retry and compatibility repair.

Finite playback covers movies, episodes and catchup. Pause and resume retain position. Rewind and fast forward move by ten seconds. Previous and Next move within the current movie or episode list only when another item exists. STOP returns to the frame that launched playback. Finite targets bypass compatibility manifest probing, repair and revalidation because they are media files or provider timeshift streams rather than live manifests.

The player exposes duration, current position and seek operations through one interface over AVPlay and browser media. `Player.play` receives the playback mode and optional start position. Browser HLS targets use hls.js, while finite nonplaylist targets use the native video element directly. AVPlay applies an initial positive seek in IDLE before prepare and uses `seekTo`, `jumpForward` or `jumpBackward` only in documented valid states. Unsupported seek calls fail without changing position and produce an actionable playback message.

The existing banner gains a finite mode line containing elapsed and total time. It remains transient and adds no permanent seek bar or focus level. The Smart Remote transport keys and standard remote transport keys remain the primary controls.

The live stall watchdog retains its current logic. Finite playback treats a completed stream as completion, does not automatically retry a completed item and does not interpret a deliberate pause as a stall. A finite seek suspends the stall watchdog until the seek callback succeeds or fails, then restarts measurement from the resulting position.

## Browser and Television Behavior

The packaged television accepts provider HTTP or HTTPS according to the configured source. The hosted HTTPS browser may use only provider API, artwork and stream addresses that are available through HTTPS and permit browser access.

The browser tries the corresponding HTTPS origin only when an HTTP source is configured on an HTTPS page. If the provider lacks HTTPS or Cross Origin Resource Sharing support, setup returns a browser specific explanation. The application does not add a hosted proxy because that would expose credentials and add an external service.

Generated stream origins, direct sources and artwork apply the same browser transport rule as API endpoints. A catalogue cannot report success and then produce an avoidable mixed content stream address. The browser attempts finite files through its native video element, but provider containers or codecs the browser cannot decode report the existing actionable format error. Television AVPlay remains the authoritative playback path for those files.

## Device Management

The device interface supports typed M3U and Xtream source commands. State snapshots describe an Xtream source by server, username, output and whether a password exists. They do not return the password.

Editing an Xtream source from a paired device leaves a blank password unchanged. Supplying a password replaces it. First setup and adding a source require a password. Visible playlist rows show the server without query parameters or credentials.

The management API remains local HTTP under the existing trusted home network boundary. It never adds Xtream stream URLs, cached catalogue responses, playback progress or account credentials to diagnostics or state snapshots.

## Error Handling

Authentication distinguishes transport failure, HTTP status, malformed response, rejected credentials, inactive account and expired account. Account expiry returned as zero or missing remains unknown rather than expired. A missing Player API endpoint reports that the account can be added as an M3U source when its `get.php` address works, without silently returning to dual identity fallback behavior.

Catalogue errors identify the operation that failed without exposing its request URL. A successful authentication with no categories or no live streams is valid when movie or series content exists. A source with no playable content reports that fact after every supported content kind has been checked.

Category, details and guide errors stay local to their frame. An error in Movies does not clear Live. Switching playlists cancels every request owned by the previous playlist before state is replaced.

## Performance Constraints

M3U launch and interaction behavior must remain unchanged when the active source is M3U. Xtream code must remain inert on that path.

Only live summaries load eagerly. Movie categories, series categories, details, episodes and programme lists load after explicit use. No adjacent category prefetch, poster prefetch or account wide on demand search is added without floor measurements.

All long lists reuse the existing windowing and logo queue. Provider artwork is decoded at the size drawn. The main thread performs no IndexedDB work in response to a key press.

The TV budget harness gains an Xtream fixture with thousands of live streams and large on demand category lists. Launch, rail movement, loaded category revisit, search and heap growth must stay within the existing budget verdicts.

## Testing

Service tests cover endpoint construction, encoding, authentication states, full URL and bare host server information, configured port fallback, malformed payloads, duplicate identifiers, exact category names, empty categories, every content kind, short EPG decoding and catchup address construction.

Store tests cover settings migration, API first Xtream loading, stable identities, live cache launch, stale refresh, request cancellation, duplicate category names, empty first category, category loading states, playlist switching, cache sweep, favourites, typed last played state and bounded playback progress.

Component tests cover content selection, focus versus selection, frame navigation, RETURN order, translated uncategorised labels, movie details, seasons, episodes, guide states, retry actions, picker focus departure, right to left layout and unchanged M3U navigation.

Player tests cover live pause behavior, finite pause and resume, duration, seeking, completion, resume persistence and unsupported seek errors across AVPlay and browser media.

The existing key law suite remains authoritative and gains finite playback and nested frame cases. A production build, TV spacing gate, TV engine gate and TV budget gate are required. Real television verification covers live HLS, live MPEG TS, one movie, one episode, one catchup programme, finite seeking and returning to the live player.

## Delivery Sequence

The implementation first changes settings and identities, then builds the pure Xtream service, then integrates live catalogue and caching, then adds panel content navigation, then adds movies and series, then adds finite playback, then adds guide and catchup, and finally updates device management and measurement fixtures.

Every behavior change begins with a failing test. Each implementation task receives a focused specification review and code quality review. The final branch receives repeated independent whole branch reviews until no validated merge blocker remains.
