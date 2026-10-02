# <img src="public/icon.svg" alt="OpenIPTV icon" width="48" align="absmiddle"> OpenIPTV

[![CI](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml/badge.svg)](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml)

An IPTV player for Samsung TVs. Give it the address of an M3U playlist and it plays what is in it.

It comes with no channels of its own and reports nothing to anybody. It talks to the playlist and the streams you point it at, and what you add stays on the television.

**[Try it in a browser](https://shayanline.github.io/OpenIPTV)**, the same build as the one on the television. Arrow keys and Enter stand in for the D-pad and OK.

The [demo playlist](https://shayanline.github.io/OpenIPTV/demo/nasa.m3u) contains one Creative Commons video, *Tears of Steel*. It is published as a simple example and is not bundled with the widget or loaded by the app by default.

## A look at it

|  |  |
|:--|:--|
| [<img src="docs/screenshots/01-first-run.png" alt="The television first run screen with manual playlist fields, a Remote access QR code, pairing address and code">](docs/screenshots/01-first-run.png) | [<img src="docs/screenshots/02-channels.png" alt="The channel panel with categories, channel rows and remote key guides">](docs/screenshots/02-channels.png) |
| **Add a playlist** | **Watch channels** |
| [<img src="docs/screenshots/03-categories.png" alt="The category rail with Sport highlighted and its channels listed">](docs/screenshots/03-categories.png) | [<img src="docs/screenshots/04-search.png" alt="Search with the query news and matching channels">](docs/screenshots/04-search.png) |
| **Browse categories** | **Search everything** |
| [<img src="docs/screenshots/05-favourites.png" alt="A favourite channel and the generated Favourites category">](docs/screenshots/05-favourites.png) | [<img src="docs/screenshots/06-settings.png" alt="Playback Settings with screen fit, resume, compatibility and Playback information controls">](docs/screenshots/06-settings.png) |
| **Keep favourites** | **Adjust playback** |
| [<img src="docs/screenshots/07-category-management.png" alt="Category management with visibility controls for one playlist">](docs/screenshots/07-category-management.png) | [<img src="docs/screenshots/08-playback-information.png" alt="Playback information centred on the right while a channel connects">](docs/screenshots/08-playback-information.png) |
| **Control categories** | **Inspect playback** |

### Remote access on another device

|  |  |
|:--:|:--:|
| [<img src="docs/screenshots/09-remote-access.png" alt="The Remote access interface with playlists, authorised devices and application data" width="300">](docs/screenshots/09-remote-access.png) | [<img src="docs/screenshots/10-smart-remote.png" alt="The touch optimised Smart Remote with navigation, playback, volume and channel controls" width="300">](docs/screenshots/10-smart-remote.png) |
| **Manage the television** | **Control playback** |

## Disclaimer

This is a player, and it ships with nothing to play. No channel list, no playlist and no stream address is bundled with it, and the project provides no content of any kind. What you see is whatever the playlist you supply happens to contain.

The project is not affiliated with, endorsed by or connected to any broadcaster, channel or streaming service. Please make sure you have the right to access whatever you add.

## What it does

- Plays extended M3U playlists without rewriting channel names, category names or languages.
- Browses playlist categories in their original order, with controls to hide individual categories or manage them per playlist.
- Keeps favourites, searches the whole playlist, optionally includes hidden categories in Search and Favourites, and tunes to a channel number you dial.
- Changes channel with Up and Down from the picture in every playback state, including loading and failure states.
- Resumes the last watched channel when requested and retries a broken channel three times before stopping.
- Holds multiple playlists with independent category visibility, refresh controls and active playlist selection.
- Shows live playback engine, resolution, codecs, bitrate, network estimate, buffer, frame rate, dropped frames and adaptive level information.
- Supports 17 translated interfaces, system language detection and complete right to left layout for Arabic and Persian.
- Lets authorised devices on the trusted local network manage playlists, settings and playback through Remote access without an account or cloud service.
- Keeps playlist addresses, preferences, favourites and authorised device credentials on the television.

No guide, no recordings, no accounts.

## What you need

A Samsung TV from 2020 or later, which is Tizen 5.5 upwards. Or any current desktop browser.

## Install on a Samsung TV

Samsung ties app signing to the individual television, so a widget signed for one set is refused by another with a certificate error. Each release attaches a built `OpenIPTV.wgt`, worth trying if you already have a signing profile that covers your TV. Otherwise sign it yourself.

The TV has to be in developer mode either way:

1. Open Apps and press `12345` on the remote.
2. Turn Developer mode on and enter the IP address of the computer you will install from.
3. Restart the television. Port 26101 stays shut until it has restarted.

Then, with Samsung's Tizen CLI on that computer:

```bash
cd <wherever you downloaded the widget>     # -n takes a name, resolved from where you are
sdb connect <tv-ip>:26101
sdb devices                                # the third column is the name to install to
tizen install -n OpenIPTV.wgt -t "<name>"
```

On a Samsung TV, the first launch keeps manual playlist entry beside Remote access setup. Scan the QR code to continue on another device, or add the playlist with the television remote. Desktop browsers keep the centred manual form because they cannot accept local network connections.

### Set up with Remote access

OpenIPTV serves the Remote access interface directly from the television. Keep the app open and connect a phone or tablet to the same trusted local network, then scan the QR code or use the displayed address and pairing code. The remote interface can add, edit, remove, refresh and activate playlists, change ordinary settings, clear downloaded cache and manage authorised devices.

The Remote access interface also includes a touch optimised Smart Remote for navigation, playback, channel, volume, number, colour and transport controls. Its two control pages switch through horizontal touch gestures without expanding the sheet.

Each device receives its own credential until access is removed under Settings, then Remote access. Pairing codes expire, QR secrets are single use and the credential verifier remains on the television. There is no OpenIPTV account, hosted service or cloud copy of playlist addresses. If the television receives a different local address, open Remote access in Settings and pair again.

### Build and sign it yourself

You need Node 22.18 or newer and Tizen Studio, where the CLI alone is enough. In Certificate Manager create an author certificate, then a Samsung distributor certificate for your own television. Call the profile `OpenIPTV`, or set `SIGNING_PROFILE` to whatever you called it.

Three things about that certificate stop the process rather than warning you:

- The **Samsung** certificate type appears only once the Samsung Certificate Extension is installed, through the Tizen Studio Package Manager. The generic Tizen type signs without complaint and is then refused by a retail set at install.
- Creating the distributor certificate signs you in with a **Samsung account**.
- Your **television must be on, in developer mode and connected** at that moment, because that is when its identifier is read into the certificate.

```bash
git clone https://github.com/shayanline/OpenIPTV.git
cd OpenIPTV
npm ci
TV_IP=192.168.0.10 npm run deploy    # builds, signs, installs, launches
```

`npm run package` stops after writing `build/OpenIPTV.wgt`, for installing by hand.

### Install through TizenBrew Installer Desktop

[TizenBrew Installer Desktop](https://github.com/reisxd/TizenBrewInstaller/releases/latest) can fetch the latest widget from this repository and install it on a television in developer mode.

1. Connect the television to the installer and enable developer mode.
2. Enter `shayanline/OpenIPTV` as the GitHub repository.
3. Let the installer create or select Samsung certificates when it asks. On Tizen 7 or later, it resigns the widget for the connected television before installing it.
4. Launch OpenIPTV from the television's app list.

The installer selects the first `.wgt` or `.tpk` file in the latest GitHub release. Every tagged release from this repository publishes `OpenIPTV.wgt`.

On TVs before Tizen 7, the installer uses the released signature without creating a new one. The released widget is signed for the television used to produce that release, so another television needs a local build and a Samsung distributor certificate. Follow the manual build instructions above when that applies.

## Watch in a browser

[shayanline.github.io/OpenIPTV](https://shayanline.github.io/OpenIPTV) is the latest release. Nothing is installed and nothing is sent anywhere: the playlist you add is held in your own browser.

Or run it from source, which is the same thing:

```bash
npm ci
npm run dev      # then open the address it prints
```

Playback in a browser goes through hls.js instead of the TV's own decoder, so a stream whose host refuses cross origin requests fails here and plays perfectly well on the set. The hosted page is also served over https, so a playlist or a stream at a plain `http` address is blocked as mixed content before it reaches the app. Neither `npm run dev` nor a television is subject to that.

## Your playlist

Any extended M3U over http or https. OpenIPTV reads `tvg-id`, `tvg-name`, `tvg-logo`, `group-title` and `tvg-quality`, groups channels by `group-title` in the order the file introduces them, and interprets nothing else. Channels with no group go to Uncategorised.

Category visibility belongs to each playlist. Hidden categories can stay out of the channel panel while remaining available in Search and Favourites, or they can be excluded everywhere. Red changes the focused category, while holding Red temporarily reveals or conceals hidden categories.

A copy is kept on the television for six hours, so switching on does not wait for a download. Settings, then Playlists, then Refresh ignores that copy and downloads the playlist again.

## The remote

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

Search and Settings sit in the panel title bar, one press up from the first category. Holding OK toggles Playback information whenever the panel is closed, including while a stream is loading or a title badge is visible.

Play, Pause, Stop and the track keys work wherever you are. Resuming from a pause rejoins the broadcast rather than continuing from where you stopped, because live television has moved on. When enabled, the clock remains visible everywhere except inside Settings.

## Settings

The yellow key, from anywhere.

- **Appearance**: language, text size, channel numbers, logos, clock and alphabetical sorting.
- **Playback**: screen fit, resume last channel, compatibility mode and persistent Playback information.
- **Playlists**: add, edit, remove, activate and refresh playlists, with category search and visibility controls for each playlist.
- **Remote access**: pair, rename and remove authorised devices that manage the television.
- **About**: version, privacy and source information, with Diagnostics under Support and cache clearing or complete reset under Application data.

## When something does not work

- **A device cannot open Remote access.** Keep OpenIPTV open and confirm that the device and television use the same trusted local network. Guest networks often prevent devices from reaching each other. Manual playlist entry remains available on the television.
- **An authorised device stopped connecting.** The television may have received a different local address. Open Settings, then Remote access and pair the device again.
- **A channel will not play.** It retries after 4, 8 and 15 seconds and then stops. Press Down for the next channel, which works while the fault remains visible.
- **The install fails with certificate error 118 or -12.** The distributor certificate was not issued for this television. Follow the signing guidance above.
- **A remote key does nothing.** Open Settings, About, Support, Diagnostics, then Remote buttons. A key missing from that screen never reached the app because the television kept it.
- **A channel shows one frame and stops.** Turn on Compatibility mode under Settings, then Playback. Leave it off for healthy streams because repair requires the app to fetch the stream playlist itself.
- **Logos are slow to appear.** Turn Show channel logos off under Settings, then Appearance.
- **A stream plays on the TV but not in a browser.** The host is refusing cross origin requests. There is nothing to fix in the app.

## Contributing

Issues and pull requests are welcome. Run `npm run check` before opening one. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest, [the design notes](docs/design.md) explain why the interface is shaped the way it is, and [the testing notes](docs/testing.md) cover what runs against the televisions nobody here owns.

## Licence

MIT, in [LICENSE](LICENSE). The projects that travel inside the built application are listed in [THIRD-PARTY-NOTICES.md](public/THIRD-PARTY-NOTICES.md), with their licence texts beside it.
