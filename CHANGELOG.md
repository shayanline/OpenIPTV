# Changelog

Notable changes, newest first, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
