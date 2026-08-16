# Changelog

Notable changes, newest first, in the format of [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
