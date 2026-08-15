# Reporting a security problem

Please report it privately through
[GitHub's private vulnerability reporting](https://github.com/shayanline/OpenIPTV/security/advisories/new)
rather than opening an issue, and I will reply as soon as I can. This is one person working on a
television app in his spare time, so there is no bounty and no service level agreement, only an
honest attempt to fix what you find.

## What is worth reporting

Three parts of this application take input from strangers, and they are where a real problem is most
likely to be.

**The playlist parser**, `src/services/m3u.ts`, reads text fetched over the network from an address
the viewer supplies, and it is deliberately tolerant of malformed files because public playlists are
routinely broken. Anything that turns a hostile playlist into something worse than a wrong channel
name matters.

**The compatibility repair**, `src/services/repair.ts` with `wasm/manifest-socket.c`, opens a
listening TCP socket on the television's loopback address while it is serving a corrected playlist
to the set's own player. It binds to `127.0.0.1` only and never to a routable address, it holds one
manifest in a fixed 64KB buffer, and it refuses anything larger rather than truncating it. A way to
reach that socket from off the device, or to get more than 64KB into it, would be serious. It is off
by default and only runs when the viewer turns compatibility mode on.

**Channel artwork**, `src/services/logos.ts`, fetches and decodes images from addresses a playlist
supplies.

## What is not a vulnerability here

A playlist that points at something illegal is not a fault in the player, which is a question of
what you feed it rather than of how it behaves. The application ships no channels, contacts no
service of its own, and sends no analytics anywhere: if you find it talking to a host that is not the
playlist, a stream or a logo from that playlist, that **is** worth reporting, because it should not
be possible.

## Which versions

The most recent release, and `master`. Anything older than the current release is not maintained.
