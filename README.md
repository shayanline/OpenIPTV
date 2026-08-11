# SimpleIPTV

An IPTV player for Samsung Tizen TVs, and the same code runs in a desktop browser.

Built for the [iptv-iran](https://github.com/shayanline/iptv-iran) playlist, but any
extended M3U works: point it at a different URL in settings.

## Why it exists

A Tizen web app is a packaged web app, so a TV player can be written with ordinary web
tooling. The part worth owning is playback. On the TV this uses `webapis.avplay`, the
hardware pipeline, which is considerably more forgiving of awkward manifests than the
browser engine in the same firmware. Several Iranian broadcasters publish a sixteen digit
media sequence and an hour long window of two second segments, which the built in browser
player cannot follow.

On a desktop there is no AVPlay, so hls.js drives a plain `<video>`. Same UI, same
playlist, instant reload, real dev tools.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173, arrow keys navigate
```

The arrow keys and Enter share key codes with the remote, so the whole interface is
usable from a keyboard.

## Building for the TV

```bash
npm run package    # builds, then signs dist/ into build/SimpleIPTV.wgt
TV_IP=192.168.0.107 npm run deploy
```

Packaging needs the Tizen CLI. `dist/` is already a complete widget root, since Vite
copies `public/config.xml` and `public/icon.png` next to `index.html`, so signing is the
only step the CLI performs.

Two certificates are involved:

- an **author** certificate, which you generate yourself in Certificate Manager
- a **distributor** certificate, which for a retail TV must be issued by Samsung against
  that TV's DUID. The generic Tizen distributor certificate signs happily and is then
  refused by the set with error 118012

The DUID comes from the TV over `sdb`, so developer mode has to be working first: enable
it on the TV, enter this machine's IP, and restart the set before port 26101 opens.

## Layout

```
src/
  services/m3u.ts      playlist parser, tolerant of the ways M3U is abused
  services/player.ts   one interface over AVPlay and hls.js
  stores/channels.ts   channels, categories, favourites, last watched
  hooks/useRemote.ts   remote key codes, and registering them with Tizen
  components/          sidebar, channel list, settings
scripts/
  package.sh           build and sign
  deploy.sh            install over sdb and launch
```

## Keys

| Key | Does |
|:--|:--|
| Arrows | Move between categories and channels |
| OK | Play the highlighted channel |
| Ch+ / Ch- | Previous and next channel |
| 0-9 | Jump to a channel number |
| Green | Favourite, which adds a list at the top |
| Yellow | Settings |
| Back | Hide the panel, then show it again |

## Not there yet

EPG, recordings, and a search box. The playlist carries `tvg-id`, so an XMLTV guide is
the natural next addition.
