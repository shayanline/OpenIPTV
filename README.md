# <img src="public/icon.svg" alt="OpenIPTV icon" width="48" align="absmiddle"> OpenIPTV

[![CI](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml/badge.svg)](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/shayanline/OpenIPTV?label=release)](https://github.com/shayanline/OpenIPTV/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/shayanline/OpenIPTV/total)](https://github.com/shayanline/OpenIPTV/releases)
[![Licence](https://img.shields.io/github/license/shayanline/OpenIPTV)](LICENSE)
[![Tizen](https://img.shields.io/badge/Tizen-5.5%2B-00a4ef)](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups.html)
[![Node](https://img.shields.io/badge/Node-22.18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

OpenIPTV is an open source IPTV player for Samsung TVs from 2020 onwards. Add your own playlist, then browse and play its channels.

OpenIPTV has no accounts, analytics, or project operated backend. Playlist details, preferences, and favourites remain on your device. Playback requests go directly to the playlist, stream, and logo hosts selected by your playlist.

**[Try OpenIPTV in your browser](https://shayanline.github.io/OpenIPTV)** using the same application build that runs on the television. Use the arrow keys and Enter as the directional pad and OK button.

Go directly to [television installation](#install-on-a-samsung-tv), [building from source](#build-and-sign-it-yourself), [playlist sources](#playlist-sources), [Remote access](#remote-access), [remote controls](#remote-control-reference), or [troubleshooting](#troubleshooting).

OpenIPTV supplies no channels or other content and is not affiliated with any broadcaster, channel, streaming service, or playlist provider. Make sure you have the right to access what you add.

## Screenshots

### On the television

|  |  |
|:--|:--|
| [<img src="docs/screenshots/01-first-run.png" alt="OpenIPTV setup on a television with playlist entry and setup from another device">](docs/screenshots/01-first-run.png) | [<img src="docs/screenshots/02-channels.png" alt="The Channels panel on a television with Categories and channel rows">](docs/screenshots/02-channels.png) |
| **Set up OpenIPTV** | **Browse channels** |
| [<img src="docs/screenshots/04-search.png" alt="Search on a television with the query news and matching channels">](docs/screenshots/04-search.png) | [<img src="docs/screenshots/06-settings.png" alt="Settings on a television with the Playback section open">](docs/screenshots/06-settings.png) |
| **Search channels** | **Change Playback settings** |

<details>
<summary>More television screenshots</summary>

|  |  |
|:--|:--|
| [<img src="docs/screenshots/03-categories.png" alt="The Categories list on a television with Sport selected">](docs/screenshots/03-categories.png) | [<img src="docs/screenshots/05-favourites.png" alt="A channel added to Favourites on a television">](docs/screenshots/05-favourites.png) |
| **Browse Categories** | **Add channels to Favourites** |
| [<img src="docs/screenshots/07-category-management.png" alt="Settings on a television with Categories for a playlist open">](docs/screenshots/07-category-management.png) | [<img src="docs/screenshots/08-playback-information.png" alt="Playback information over a channel on a television">](docs/screenshots/08-playback-information.png) |
| **Manage Categories for a playlist** | **View Playback information** |

</details>

### Remote access on a phone

|  |  |
|:--:|:--:|
| [<img src="docs/screenshots/09-remote-access.png" alt="Remote access on a phone showing Playlists, Devices, and About" width="300">](docs/screenshots/09-remote-access.png) | [<img src="docs/screenshots/10-smart-remote.png" alt="Remote access on a phone with Smart Remote open" width="300">](docs/screenshots/10-smart-remote.png) |
| **Manage Playlists and Devices with Remote access** | **Control the television with Smart Remote** |

## Features

### Playback

- Changes channel with Up and Down from the picture in every playback state, including loading and failure states.
- Shows the playback engine, resolution, codecs, bitrate, network estimate, buffer, frame rate, dropped frames, and adaptive level information.

### Browsing and organisation

- Displays channel names and languages exactly as supplied by the playlist.
- Keeps favourites, searches the whole playlist, and tunes to a channel number you enter.
- Supports 17 translated interfaces, system language detection, and complete right to left layouts for Arabic and Persian.

No programme guide or recording features are included.

## Requirements

Use either of these supported environments:

- A Samsung TV from 2020 or later, which runs Tizen 5.5 or later.
- A current desktop browser.

## Install on a Samsung TV

[TizenBrew Installer Desktop](#tizenbrew-installer-desktop) is the easiest installation route. On Tizen 7 or later, it resigns the released widget for the connected television. Earlier versions use the existing release signature, so televisions not covered by it must follow [Build and sign it yourself](#build-and-sign-it-yourself).

### Prepare the television

Before installing:

1. Open Apps and press `12345` on the remote.
2. Turn Developer mode on and enter the IP address of the computer you will install from.
3. Restart the television. Port 26101 remains closed until the restart finishes.

### TizenBrew Installer Desktop

[TizenBrew Installer Desktop](https://github.com/reisxd/TizenBrewInstaller/releases/latest) fetches `OpenIPTV.wgt` from the latest GitHub release and installs it on the television.

1. Connect the television to the installer.
2. Enter `shayanline/OpenIPTV` as the GitHub repository.
3. Let the installer create or select Samsung certificates when it asks.
4. Install OpenIPTV and launch it from the television application list.

### Build and sign it yourself

Install Node 22.18 or later and Tizen Studio. The command line tools are sufficient.

In Certificate Manager, create an author certificate and a Samsung distributor certificate for your television. Call the profile `OpenIPTV`, or set `SIGNING_PROFILE` to the name you choose.

The certificate setup has three requirements:

- Install the Samsung Certificate Extension through Tizen Studio Package Manager. The generic Tizen certificate type signs the widget but is refused by a retail Samsung television.
- Sign in with a Samsung account while creating the distributor certificate.
- Keep the television on and connected as prepared above so Certificate Manager can add its identifier to the certificate.

```bash
git clone https://github.com/shayanline/OpenIPTV.git
cd OpenIPTV
npm ci
TV_IP=192.168.0.10 npm run deploy    # builds, signs, installs, and launches
```

`npm run package` stops after writing `build/OpenIPTV.wgt` for manual installation.

On its first television launch, OpenIPTV offers manual playlist entry and Remote access setup. Scan the QR code to continue on another device, or enter the playlist with the television remote.

## Watch in a browser

The [browser version](https://shayanline.github.io/OpenIPTV) runs the latest release without installing anything.

You can also run the browser version from source:

```bash
npm ci
npm run dev      # then open the address it prints
```

Browser playback uses hls.js instead of the television AVPlay engine. A stream host that refuses cross origin browser requests can therefore fail in the browser while playing correctly on the television.

The hosted page uses HTTPS. Browsers block a playlist or stream served over plain HTTP as mixed content. Local development and television playback do not have that restriction.

The [demo playlist](https://shayanline.github.io/OpenIPTV/demo/nasa.m3u) contains the Creative Commons film *Tears of Steel*. It is an example for the browser demo and is never bundled with the widget or loaded by default.

## Playlist sources

### Extended M3U

OpenIPTV accepts an extended M3U playlist over HTTP or HTTPS. It reads `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, and `tvg-quality`. Categories follow the order in which the playlist introduces them, and channels without a group appear under Uncategorised.

### Xtream login

Choose Xtream login and enter the server address, username, password, and stream format. OpenIPTV builds the standard M3U Plus address locally. HLS and MPEG TS formats are supported.

Password fields remain masked, and playlist summaries conceal passwords. The television and Remote access interface provide the same creation and editing flow.

### Playlist behaviour

Category visibility belongs to each playlist. Hidden categories can stay out of the channel panel while remaining available in Search and Favourites, or they can be excluded everywhere. Red changes the focused category, while holding Red temporarily reveals or conceals hidden categories.

OpenIPTV caches each playlist on the television for six hours so startup does not wait for another download. Settings, then Playlists, then Refresh ignores that cached copy and downloads the playlist again.

## Remote access

OpenIPTV serves its Remote access interface directly from the television. Keep the application open and connect a phone or tablet to the same trusted local network.

Scan the QR code or use the displayed address and pairing code. A paired device can add, edit, remove, refresh, and activate playlists. It can also change ordinary settings, clear downloaded cache, manage authorised devices, and control playback.

Each paired device receives its own credential. Pairing codes expire, QR secrets work once, and the credential verifier remains on the television. Remove access under Settings, then Remote access.

The interface includes a touch optimised Smart Remote for navigation, playback, channels, volume, numbers, colours, and transport controls. Horizontal gestures move between its two control pages.

## Remote control reference

| Key | Watching | In the channel panel | Searching |
|:--|:--|:--|:--|
| Up, Down | Previous and next channel | Move through the list | Between the field and the results |
| Left | Open the channel panel | Move toward the category rail, then leave the panel | Move the caret |
| Right | Hide the title badge | Move toward channels and play at the final stop | Move the caret |
| OK | Open the channel panel | Play the highlighted channel | Show matches, then play one |
| Hold OK | Toggle Playback information | No action | No action |
| Return | Hide what is visible, then offer to close | Step back, then return to the picture | Clear, then leave Search |
| Ch+, Ch- | Previous and next channel | Previous and next channel | Previous and next channel |
| 0-9 | Tune to a channel number | Tune to a channel number | Type a digit |
| Green | Favourite the current channel | Favourite the highlighted channel | Favourite the highlighted channel |
| Red | No action | Hide or restore the highlighted category | No action |
| Hold Red | No action | Reveal or conceal hidden categories temporarily | No action |
| Yellow | Open Settings | Open Settings | Open Settings |

Search and Settings sit in the panel title bar, one press above the first category.

Play, Pause, Stop, and the track keys work from every screen. Resuming from a pause rejoins the live broadcast. When enabled, the clock remains visible everywhere except Settings.

## Settings

Press the yellow key from any screen.

- **Appearance** controls language, text size, channel numbers, logos, clock, and alphabetical sorting.
- **Playback** controls screen fit, resume last channel, compatibility mode, and persistent Playback information.
- **Playlists** adds, edits, removes, activates, and refreshes playlists, with category search.
- **Remote access** pairs, renames, and removes authorised devices.
- **About** contains version, privacy, source, diagnostics, cache clearing, and complete reset controls.

## Troubleshooting

- **A device cannot open Remote access.** Guest networks often prevent devices from reaching each other. Follow the connection requirements under [Remote access](#remote-access).
- **An authorised device stopped connecting.** The television may have received a different local address. Open Settings, then Remote access, and pair the device again.
- **A channel will not play.** OpenIPTV retries after 4, 8, and 15 seconds before stopping. Press Down to move to the next channel while the fault remains visible.
- **Installation fails with certificate error 118 or -12.** Follow [Build and sign it yourself](#build-and-sign-it-yourself).
- **A remote key does nothing.** Open Settings, About, Support, Diagnostics, then Remote buttons. A key missing from that screen never reached the application because the television kept it.
- **A channel shows one frame and stops.** Turn on Compatibility mode under Settings, then Playback. Leave it disabled for healthy streams because repair requires OpenIPTV to fetch the stream playlist itself.
- **Logos are slow to appear.** Turn Show channel logos off under Settings, then Appearance.

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening one. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, [the design notes](docs/design.md) for the interface decisions, and [the testing notes](docs/testing.md) for the television compatibility checks.

## Licence

OpenIPTV uses the MIT licence in [LICENSE](LICENSE). Runtime projects included in the built application are listed in [THIRD-PARTY-NOTICES.md](public/THIRD-PARTY-NOTICES.md), with their licence texts beside it.
