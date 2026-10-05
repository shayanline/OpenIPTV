# Changelog

Notable changes, newest first, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.10.0

### Added

- **The on screen pad stays where it is put.** A pad dragged clear of whatever it covered comes back in the same place next time the application opens, moved inside the window if the window has since become smaller.

### Changed

- **Language leads the welcome screen.** The first screen opens with the title and the language picker side by side under a rule, with a globe beside the label, so choosing a language comes before filling in the playlist form rather than in the middle of it. Up and down follow what is on screen from top to bottom.
- **Dropdown navigation.** Opening a list puts the cursor on the current choice. Up and down move between the options and stop at the ends, left or right closes the list, and Return still closes it, so the directional buttons never walk out of a list that is still showing. This covers the language and the stream format lists alike.

### Fixed

- **Xtream addresses that were refused.** A `get.php` address is recognised when the username and password are left blank, which is how a provider hands one out to be filled in, and when it carries a watermark in front of the host, which the address parser reads as a login of its own. An address asking for `type=m3u` counts as an Xtream login too. Playlists saved by an older version are untouched by that last part, because nothing converts them without being asked.
- **Pasting over a server address.** An address pasted into the server field no longer takes the username and password already typed with it, and it leaves the chosen stream format alone when the address names none.

## 1.9.3

### Changed

- **Localized typography.** Each writing system now uses a font designed for it: Google Sans for the Latin, Cyrillic, Bengali and Devanagari interfaces, Vazirmatn for Arabic and Persian, and the regional Noto Sans faces for Simplified Chinese, Japanese and Korean. The family follows the interface language, so changing language changes the font without reloading.
- **Complete Chinese, Japanese and Korean coverage.** Those three families carry their full Han, Kana and Hangul ranges rather than only the characters the translations use, so a channel or category name written in one of them renders in the same font as the interface around it. The bundled faces total 15 MB and ship inside the widget, so nothing is fetched while the application runs.
- **Remote interface typography.** A paired device uses the same family for its language as the television does, where before it used Vazirmatn for every language.

### Fixed

- **Fonts served to paired devices.** The management server read each font file as text and reencoded it, which corrupted every file it sent and left the remote interface on whatever font the device already had.
- **Headings and controls.** Section titles, labels, strong text and native controls take the selected family instead of the browser default.

## 1.9.2

### Fixed

- **Category position.** Returning from the category rail to the displayed category preserves the selected channel and scroll position, while changing category still starts at its first item.
- **Programme Guide navigation.** Every programme keeps a visible cursor, refreshed lists clamp the cursor to a valid row, focus reaches the viewport edge before scrolling, mouse wheel navigation moves the selection, and pointer hover leaves it unchanged.

## 1.9.1

### Changed

- **Xtream conversion.** Complete `get.php` addresses can switch setup into credential fields, interactive conversion defaults to HLS, and `mpegts` is accepted as MPEG TS.

### Security

- **HTTP relay resolution.** The development relay pins the validated public address for each upstream request, so DNS cannot change the destination after validation.

### Fixed

- **Browser transport guidance.** Hosted HTTPS failures explain that the provider must support HTTPS and Cross Origin Resource Sharing instead of showing only a generic fetch error.
- **Local HTTP relay.** Vite Preview installs the same relay as the development server, while relayed HLS references and finite media preserve their correct loading paths.
- **Finite playback fallback.** Local HTTP movies can retry once through the relay without changing direct HTTP playback on a packaged television.
- **Playback selection.** Selecting the current channel, movie or series episode again returns to the picture without restarting its stream.

## 1.9.0

### Added

- **Complete Xtream catalogues.** Live channels, movies, series, seasons and episodes use the Xtream API with provider wide search, category visibility and cached counts.
- **Programme Guide.** Live playback includes a channel specific Guide drawer with current programme highlighting, catchup actions and cached schedule data.
- **Finite playback.** Movies and episodes support play, pause, seeking, resume progress and finite completion without live stream retries.

### Changed

- **Complete translations.** Xtream setup, browsing, Guide, playback and stream format labels are represented across every supported locale catalog.
- **Television navigation.** The title bar, content switcher, category rail, media hierarchy and Settings use separate focus levels with consistent remote cycles and visible return paths.
- **Large catalogue loading.** Movie and series summary indexes load once per content type, provide unopened category counts and remain cached for six hours.
- **Guide presentation.** Programme information uses an animated One UI drawer over the player, while Up, Down and mouse wheel movement follow each programme.
- **Lucide icons.** The television and remote web interfaces use one consistent Lucide SVG icon set with packaged attribution.
- **HTTP stream fallback.** Tizen retries eligible HTTPS connection failures once through the provider HTTP endpoint. Local browser and TV simulator sessions use a same origin relay that preserves MP4 byte ranges and rewrites HTTP HLS references, while hosted HTTPS browsers never downgrade.
- **Playback information.** TV simulation reports resolution, rendition bitrate, network estimate, buffer, frame rate, dropped frames and adaptive levels through the AVPlay diagnostics card.

### Security

- **HTTP relay boundaries.** The development relay accepts only public HTTP targets, rejects literal and DNS resolved private addresses, then pins the validated public address for the upstream request.
- **HTTP fallback scope.** Automatic HTTP retry is limited to packaged Samsung playback and pages already served over HTTP, so an HTTPS browser session cannot expose stream credentials through mixed content.

### Fixed

- **Category navigation.** Focus can traverse every category, wrap through the content switcher and preserve the blue displayed category marker until a new category is committed.
- **Windowed lists.** Final rows remain reachable, scroll indicators stay inside their measured viewport and mouse wheel movement works across virtual lists.
- **Search navigation.** Space and number input remain text, while Up and Down leave the Search field for the title bar or first result.
- **Welcome navigation.** Physical arrow keys and Samsung remote keys move through every source, input, picker and action without duplicate focus movement.
- **Focused metadata.** Channel numbers, episode numbers, durations, years and rating badges retain readable contrast on the focus surface.
- **Playback banner.** Live title cards show the category name without list position text, while movie and episode cards retain finite playback time.

## 1.8.0

### Added

- **Xtream playlist setup.** Viewers can enter a server address, username, password and stream format while OpenIPTV builds the standard M3U Plus address locally.
- **Xtream remote setup.** Paired devices offer the same Xtream creation and editing flow as the television interface.

### Changed

- **Playlist source selection.** M3U remains the default, while compatible Xtream addresses reopen as credential fields and public or nonstandard addresses remain in the M3U editor.
- **Stream format selection.** Xtream setup supports HLS and MPEG TS with a consistent, inset format control across left to right and right to left interfaces.
- **Complete translations.** Xtream setup and stream format labels are represented across every supported locale catalog.

### Security

- **Credential presentation.** Password fields stay masked and saved playlist summaries conceal Xtream password values.

### Fixed

- **Failed playlist isolation.** A failed authentication or playlist switch leaves the new playlist empty instead of presenting channels and categories from the previously active playlist.

## 1.7.0

### Added

- **Remote access controls.** Authorised devices can control navigation, playback, channels and volume through a touch optimised two page Smart Remote.
- **Development remote bridge.** Vite can simulate the complete television onboarding and remote access flow between a laptop and another device without a television or emulator.
- **Guided setup results.** The remote interface shows dedicated success and error pages with channel counts, correction guidance and an explicit path into Settings.
- **Device management.** Remote access lists authorised devices, identifies the current device and provides compact action sheets for renaming or removing access.

### Changed

- **Device neutral terminology.** Phone access is now Remote access throughout the interface, services, protocol, storage, development bridge, documentation and tests.
- **Responsive remote interface.** Mobile onboarding, settings, playlists, devices, navigation and result screens now use safe areas, consistent touch targets, grouped One UI lists and compact actions.
- **Playlist management.** Playlist rows use single line addresses, overflow action sheets, expandable collections and a heading level Add action instead of permanent forms and button clusters.
- **Remote feedback.** Saving, loading and failure messages now use One UI toast feedback above every overlay without replacing the page or losing focus.
- **Pairing panel.** Settings uses an aligned two column pairing card with the QR code, manual address, grouped code, expiry guidance and cancellation in one surface.
- **Complete translations.** Remote access, device management, setup results, self removal warnings and Smart Remote controls are represented across every supported locale catalog.

### Security

- **Deterministic command processing.** Remote commands are serialized, draft previews avoid revision churn and rejected requests always receive a bounded response instead of stalling the management socket.
- **Single use pairing.** Concurrent pairing claims, cancellation during credential hashing, expiry and attempt exhaustion cannot authorise an additional device.

### Fixed

- **Pairing lifecycle.** Expired, cancelled and failed sessions no longer leave stale QR codes, misleading connection states or reusable secrets.
- **Remote access recovery.** Development streams recover their listening state after reconnecting, while stop and restart transitions cannot strand the service in a starting state.
- **Final playlist removal.** Removing the final playlist returns both interfaces to setup immediately while preserving authorised access.
- **Touch interactions.** List rows yield correctly to page scrolling, Remote access sheets can be dismissed from their backdrop or a downward drag and carousel pages follow horizontal touch gestures.

## 1.6.0

### Added

- **Playlist category visibility.** Each playlist can hide individual categories or every category, while optionally keeping hidden channels available in Search and Favourites.
- **Category remote shortcuts.** Red hides or restores the focused category, while holding Red temporarily reveals or conceals hidden categories without losing category focus.
- **Category management.** Settings includes category search, category counts, immediate persistence, compact bulk actions and safe handling for empty or fully hidden playlists.
- **Playback information shortcut.** Holding OK at the clear picture toggles Playback information without opening the channel panel.

### Changed

- **Settings design.** Settings uses consistent page headers, list headers, detail navigation, contextual OK guides, action popups, icons, spacing and focus restoration designed for Samsung television remotes.
- **Settings organisation.** Resume and Playback information are under Playback, while Diagnostics and application data are grouped under About.
- **Diagnostics.** Device facts and compatibility information use grouped information surfaces, with an isolated remote button tester that does not move Settings focus.
- **Playlist actions.** Playlist rows show known category counts and retain the active state clearly while focused.
- **About.** About uses the application icon, concise privacy and source information, a visible repository address and separated Support and Application data sections.
- **Complete translations.** Category controls, Settings guidance, counts, shortcuts and updated About content are represented across all 17 supported locale catalogs.

### Fixed

- **Category focus.** Revealing, concealing and hiding categories preserve category identity, then move to the nearest visible category only when required.
- **Favourites identity.** Provider categories named Favourites remain distinct from the generated Favourites list.
- **Settings navigation.** RETURN follows the screen hierarchy, directional keys remain spatial, playlist actions are remote reachable and focus returns to the control that opened a detail or popup.
- **Focused control contrast.** Hidden categories, inactive switches, destructive actions and active playlist badges remain readable on the white focus surface.

## 1.5.0

### Added

- **Phone setup on Samsung TVs.** The first run screen shows a local QR code and six digit fallback code, so a viewer can add the first playlist from a phone instead of typing its address with the remote.
- **Local phone management.** Authorised phones on the same trusted network can add, edit, remove, refresh and activate playlists, change ordinary settings, clear downloaded cache and manage paired phones while OpenIPTV is running.
- **Remembered phones.** Several phones can be paired independently, renamed and revoked from the television.
- **Responsive phone interface.** The locally served management page supports first setup, right to left languages, native controls, conflict recovery and clear offline guidance.
- **Dedicated management socket.** A separate WebAssembly worker serves the phone interface and its versioned API on the TV private address without exposing the loopback compatibility server.

### Changed

- **First run layout on television.** The manual playlist form remains on the left of a vertical divider, while the QR code and phone setup guidance occupy the right side.
- **Desktop first run.** Desktop browsers retain the centred manual form and hide TV phone access because browsers cannot accept local network connections.
- **Complete translations.** Phone setup, pairing status, management actions and access controls are translated across all 17 supported locale catalogs.

### Security

- **Expiring pairing.** QR secrets expire after five minutes or first use, fallback codes are attempt limited and each remembered phone receives a separate credential whose verifier stays on the television.
- **Bounded local API.** The management server binds only to a private IPv4 address, accepts allowlisted routes and commands, rejects stale revisions and oversized input, and never serves playlist cache contents or arbitrary widget files.

### Fixed

- **Complete application reset.** Reset now revokes remembered phone credentials alongside playlists, preferences, favourites and cached data.
- **Remote cache clearing.** Clearing cache from a phone also removes compatibility diagnoses, matching the television action.
- **Management socket recovery.** Worker failures close the socket and allow phone management to start again rather than leaving a dead worker in place.

## 1.4.0

### Added

- **Playback information overlay.** Diagnostics can show the active playback engine, resolution, scan type, video and audio codecs, rendition bitrate, network estimate, buffer ahead, frame rate, dropped frames, adaptive level, and level switches over the picture.
- **Cross engine reporting.** The overlay reads current values from Samsung AVPlay, hls.js, or native browser HLS when each engine makes them available, and clearly marks values the engine does not report.
- **Persistent diagnostics control.** Settings, then Diagnostics contains an opt in toggle which keeps the overlay enabled across channel changes, failures, menus, and app restarts until it is turned off.

### Changed

- **Directional overlay placement.** Playback information sits on the right in left to right interfaces and on the left in right to left interfaces, while the channel panel remains above it where they overlap.
- **Complete translations.** Playback information labels and guidance are included in all 17 supported locale catalogs.

### Fixed

- **Focused toggle contrast.** An off toggle retains a visible track and knob on the light focus surface without using an unnecessarily heavy black treatment.

## 1.3.0

### Added

- **Internationalisation.** The application now includes Arabic, Bengali, Chinese (Simplified), Dutch, English, French, German, Hindi, Indonesian, Italian, Japanese, Korean, Persian, Portuguese, Russian, Spanish, and Turkish catalogs.
- **System language detection.** The default System preference follows the TV browser language through `navigator.language`, with English as the fallback for unsupported languages.
- **Language picker.** Settings and the first run screen now use a scrollable picker with native language names, which keeps the selection usable as more locales are added.
- **Right to left interface support.** Arabic and Persian mirror the channel panel, Settings sheet, overlays, controls, pointer pad, and debug Smart Remote.
- **Translated runtime messages.** Playlist validation, loading states, playback errors, diagnostics, key guides, accessible names, and confirmation dialogs now use locale catalogs.
- **Locale regression coverage.** Tests cover System detection, catalog completeness, translated runtime messages, language picker selection, RTL navigation, guide spacing, and RTL control placement.

### Changed

- **Language ordering.** System remains first, while the language options are sorted by their English names.
- **Locale aware formatting.** Generated numbers, clocks, counts, channel positions, and alphabetical sorting now use the selected locale.
- **Playlist content handling.** Playlist names and groups remain unchanged, while generated fallback labels and technical values receive the correct language and text direction.
- **Playback and playlist errors.** Stores and services now carry stable message keys and error details, so the UI can translate them without storing English prose in application state.

### Fixed

- **Playback banner numbers.** Channel numbers in the banner now use the same locale formatting as channel list numbers.
- **RTL guide spacing.** Paired direction badges keep their spacing in right to left layouts, including the margin before their labels.
- **RTL control placement.** The pointer pad and debug Smart Remote start on the left in right to left layouts, while dragged controls keep their chosen positions.

## 1.2.0

### Added

- **Cache clearing.** General settings can remove cached playlist data, channel logos, playlist freshness markers, legacy cache entries, and compatibility diagnoses without removing playlists or personal settings.
- **General settings.** Startup behaviour and app data management now have their own section.

### Changed

- **Settings organisation.** Appearance, Playback, General, Playlists, Diagnostics, and About now follow a clearer order with consistent labels, spacing, control sizes, and accessible names.
- **Playlist status messages.** Loading, failure, saved, and channel count messages now describe the active playlist accurately and use correct singular and plural forms.
- **TV parity walks.** The TV harness now measures Playback and General with the current settings labels.

### Fixed

- **Right to left titles.** Category and playback titles now keep the same alignment as the rest of the interface when playlist text uses a right to left script.
- **Settings persistence migration.** Removed preferences and malformed saved values no longer remain in the settings store or prevent startup.

## 1.1.0

### Added

- **Full screen browser playback.** Double clicking the browser video now puts the whole
  application into full screen, so the channel menu, Search and Settings remain available.
- **Playback audio control while Settings is open.** Settings mutes the active channel without
  pausing or retuning it, then restores the previous audio state when Settings closes.
- **Vazirmatn application font.** The supplied variable font is bundled with Persian and broad
  script coverage, so the browser and TV builds use one consistent typeface without a network
  request.

### Changed

- **Faster access to Search and Settings.** Moving up from the top of either list reaches the
  header controls, and the header cycles between Search and Settings in both directions.
- **Channel list navigation.** Right on a channel now performs the same action as OK, while Left
  on the category list stays in that list.
- **Channel menu browsing.** The existing hide preference remains available, but it no longer
  closes the channel selection menu while the viewer is browsing it.
- **Debug Smart Remote.** The remote starts closed, its volume and channel controls send working
  input, and its keypad uses centered vector icons for transport actions.

### Fixed

- **Playback banner dismissal.** A paused channel no longer keeps an expired banner visible after
  its timer has elapsed.
- **Button presentation.** Hover states retain light text and icon colors, and icon bearing
  controls are centered consistently across the application.
- **TV engine layout parity.** Pane headers now keep stable geometry between the oldest supported
  Chromium 69 sets and modern browsers, even when font metrics differ.

## 1.0.2

### Fixed

- **First playback of affected live playlists on Samsung TVs.** Compatibility mode now diagnoses
  oversized HLS media sequences before AVPlay starts and serves a repaired loopback playlist when
  required. This covers master playlists and variant playlists, while healthy streams continue using
  their original addresses.
- **Startup buffering for long segments.** AVPlay receives a measured initial buffer based on the
  longest diagnosed segment, which prevents first playback stalls on channels with longer segments.
- **Compatibility socket lifecycle.** Repaired playlist serving keeps the socket and WebAssembly
  worker reusable while idle, closes it safely when stopped, and avoids truncated manifest responses.

### Performance

- **Persistent diagnosis cache.** Healthy and repaired diagnoses are remembered per playlist address
  in a bounded cache. Cached healthy channels start without waiting for a preflight fetch, then
  revalidate in the background with HTTP validators or a fresh manifest comparison. A changed
  playlist starts diagnosis and repair again.

## 1.0.1

### Added

- **Compatibility repair in desktop browsers.** Compatibility mode now repairs affected live
  playlists through hls.js as well as through the Tizen player. Browser playback still requires
  the playlist host to allow cross origin requests.

### Fixed

- **Restored channel focus when opening the menu.** The currently playing channel remains selected,
  including after a playlist refresh and for channels outside the first visible screen.

## 1.0.0

The first release. Everything below is what the application does rather than what changed, since
nothing preceded it.

### Added

- **Plays any extended M3U playlist.** Channel names, groups and languages appear exactly as the
  file writes them. Nothing is interpreted, renamed, reordered or filtered, and no channel, playlist
  or stream address is bundled.
- **Channel changing that cannot strand you.** Up and down change channel at the picture in every
  state, including on a channel that has failed, so a dead stream is never a dead end.
- **Favourites, search and direct tuning.** Search ranks matches across the whole playlist, and a
  number dialled on the remote tunes to it.
- **Several playlists at once**, switched between at will, each cached against its own address.
- **Resumes the last channel** when the television is switched on.
- **Three automatic retries** on a broken channel, then it stops trying.
- **A settings screen** for everything the viewer can change, kept in the order the remote reaches
  it.
- **Compatibility mode, off by default.** One Samsung firmware defect holds a playlist's media
  sequence in a signed 32 bit integer, so a packager numbering segments from a microsecond clock
  overflows it and the channel shows a single frame and stops. When it is switched on, and only
  after a channel has actually failed, a corrected playlist is served to the television's own player
  over a loopback socket. A working channel never pays for this.

### Supported

- Samsung Tizen televisions from 2020 onwards, which is Tizen 5.5 and Chromium 69 upwards. One
  artifact covers every model year, with no branching by set.
- Any current desktop browser, through hls.js, from the same build.

### Not included, deliberately

- No analytics, no telemetry, no accounts and no network calls beyond the playlist you supply, the
  streams it names and the logos it points at.
- No electronic programme guide and no recording.
