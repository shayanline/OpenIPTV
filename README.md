# OpenIPTV

[![CI](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml/badge.svg)](https://github.com/shayanline/OpenIPTV/actions/workflows/ci.yml)

An IPTV player for Samsung TVs. Give it the address of an M3U playlist and it plays what is in it.

It comes with no channels of its own and reports nothing to anybody. It talks to the playlist and
the streams you point it at, and what you add stays on the television.

## Disclaimer

This is a player, and it ships with nothing to play. No channel list, no playlist and no stream
address is bundled with it or built into it, and the project provides no content of any kind. What
you see is whatever the playlist you supply happens to contain, which is a file this project cannot
see, host, index or influence.

The project is not affiliated with, endorsed by or connected to any broadcaster, channel or
streaming service. Whether you are entitled to watch what a playlist points at is between you, the
person who gave you the address and the people who own what is at the end of it, so please make sure
you have the right to access whatever you add.

## What it does

- Plays any extended M3U playlist, in any language. Channel names appear exactly as the playlist
  writes them.
- Up and down change channel at the picture, in every state, including a channel that has failed.
  Nothing can leave you stuck on a dead stream.
- Keeps favourites, searches the whole playlist, and tunes to a channel number you dial.
- Comes back to the channel you were watching when you switch the television on.
- Holds as many playlists as you like and switches between them.
- Retries a broken channel three times on its own, then leaves it alone.

No guide, no recordings, no accounts.

## What you need

A Samsung TV from 2020 or later, which is Tizen 5.5 upwards. Or any current desktop browser.

## Install on a Samsung TV

Samsung ties app signing to the individual television, so a widget signed for one set is refused
by another with a certificate error. Each release attaches a built `OpenIPTV.wgt`, worth trying
if you already have a signing profile that covers your TV. Otherwise sign it yourself, which is
the route below.

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

The first launch asks for a playlist address and nothing else.

### Build and sign it yourself

You need Node 22.18 or newer and Tizen Studio, where the CLI alone is enough. In Certificate
Manager create an author certificate, then a Samsung distributor certificate for your own
television. The generic Tizen distributor certificate signs without complaint and is then
refused by a retail set at install. Call the profile `OpenIPTV`, or set `SIGNING_PROFILE` to
whatever you called it.

Three things about that certificate catch people out, and each one stops the process rather than
warning you:

- Certificate Manager offers the **Samsung** certificate type only once the Samsung Certificate
  Extension is installed, through the Tizen Studio Package Manager. Without it the only choice is
  the Tizen type, which is the one a retail television refuses.
- Creating the distributor certificate signs you in with a **Samsung account**.
- Your **television must be on, in developer mode and connected** at that moment, because that is
  when its identifier is read into the certificate.

```bash
git clone https://github.com/shayanline/OpenIPTV.git
cd OpenIPTV
npm ci
TV_IP=192.168.0.10 npm run deploy    # builds, signs, installs, launches
```

`npm run package` stops after writing `build/OpenIPTV.wgt`, for installing by hand.

## Watch in a browser

The same app, no television involved:

```bash
npm ci
npm run dev      # then open the address it prints
```

Arrow keys and Enter do what the remote's D-pad and OK do. Playback here goes through hls.js
instead of the TV's own decoder, so a stream whose host refuses cross origin requests fails in a
browser and plays perfectly well on the set.

## Your playlist

Any extended M3U over http or https. OpenIPTV reads `tvg-id`, `tvg-name`, `tvg-logo`,
`group-title` and `tvg-quality`, groups channels by `group-title` in the order the file
introduces them, and interprets nothing else. Channels with no group go to Uncategorised.

A copy is kept on the television for six hours, so switching on does not wait for a download.
Settings, then Playlists, then Refresh now, ignores that and fetches again.

## The remote

| Key | Watching | In the channel panel | Searching |
|:--|:--|:--|:--|
| Up, Down | Previous and next channel | Move through the list | Between the field and the results |
| Left | Open the channel panel | Out to the rail, then out of the panel | Move the caret |
| Right | Hide the banner | Further in, and plays the channel at the last stop | Move the caret |
| OK | Pause and resume | Play the highlighted channel | Show the matches, then play one |
| Return | Open the channel panel | Step back, then offer to close the app | Clear, then leave the search |
| Ch+, Ch- | Previous and next channel | Previous and next channel | Previous and next channel |
| 0-9 | Tune to a channel number | Tune to a channel number | Type a digit |
| Green | Favourite | Favourite | Favourite |
| Yellow | Settings | Settings | Settings |

Search and Settings sit in the panel's title bar, one press up from the first category.

Play, Pause, Stop and the track keys work wherever you are. Resuming from a pause rejoins the
broadcast rather than continuing from where you stopped, because live television has moved on.

## Settings

The yellow key, from anywhere.

- **Appearance**: text size, channel numbers, logos, clock, sorting.
- **Playlists**: add, edit, remove, switch, refresh.
- **Watching**: picture size, resuming, sorting A to Z, compatibility mode, how long the channel
  list stays open.
- **Diagnostics**: what this television is, and every key its remote sends.
- **About**: version, and where to find the source.

## When something does not work

- **A channel will not play.** It retries after 4, 8 and 15 seconds and then stops. Press down
  for the next one, which works even while the fault is on screen. Public playlists are often
  half dead.
- **The install fails with a certificate error, 118 or -12.** The distributor certificate is not
  issued for this television. See the signing note above.
- **A coloured key does nothing.** Settings, then Diagnostics, lists every key press the app
  receives. A button missing from that list never reached the app, so the set is keeping it.
- **A channel shows a picture for a moment and then stops.** Turn on Compatibility mode in
  Watching. Some channels publish a playlist this television reads incorrectly, and the app can
  serve it a corrected copy. Leave it off otherwise: while it is on, the TV fetches those playlists
  itself, which uses a little more of your connection. Settings, then Diagnostics, says whether it
  is working.
- **Logos are slow to appear.** Turn Channel logos off in Appearance.
- **A stream plays on the TV but not in a browser.** The host is refusing cross origin requests.
  There is nothing to fix in the app.

## Contributing

Issues and pull requests are welcome. [The design notes](docs/design.md) explain why the
interface is shaped the way it is, [the testing notes](docs/testing.md) cover what runs against
the televisions nobody here owns, and [AGENTS.md](AGENTS.md) is the short version for anyone, or
anything, working in the repository.

Run `npm run check` before opening a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest,
and [publishing](docs/publishing.md) covers releases and what submitting to Samsung's store involves.

## Licence

MIT, in [LICENSE](LICENSE).

Four other projects travel inside the built application, and their notices are in
[THIRD-PARTY-NOTICES.md](public/THIRD-PARTY-NOTICES.md) with their licence texts beside it. That
file sits in `public/` so it is packaged into the widget itself, since the obligation is toward
whoever installs the application and not only toward whoever reads this page.
