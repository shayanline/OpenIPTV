# Reporting a security problem

Please report it privately through
[GitHub's private vulnerability reporting](https://github.com/shayanline/OpenIPTV/security/advisories/new)
rather than opening an issue, and I will reply as soon as I can. This is one person working on a
television app in his spare time, so there is no bounty and no service level agreement, only an
honest attempt to fix what you find.

## What is worth reporting

The following boundaries matter across the shared app and its TV targets.

The playlist parser in `src/services/m3u.ts` reads text fetched from an address the viewer supplies. Xtream responses, programme information and channel artwork also come from provider controlled addresses. Report a way for any of that content to execute code, expose stored credentials, write outside the intended application data or bypass an authorisation boundary.

Samsung's compatibility service in `src/services/repair.ts` and `wasm/manifest-socket.c` opens a loopback socket only when the opt in repair path needs it. A way to reach that socket from another device or exceed its bounded request handling is worth reporting. The new TV candidates omit the Samsung socket modules.

Samsung's remote access server in `src/services/remoteServer.ts` is a separate private network service. Its pairing and device credentials are managed through `src/services/deviceAccess.ts`. Report authentication bypasses, unauthorised pairing, credential disclosure or requests that allow one device to exceed its granted access. Only use the server on a trusted local network.

Hosted app delivery adds the app's hosting origin as a trust boundary. The host controls the code that can read the app's browser storage. Each hosted TV target should have a dedicated origin, and provider credentials must not appear in launch URLs, hosting configuration or public logs. Report a way for playlist or provider content to replace the application code or escape its intended origin boundary.

The Vega integration kit requires an official SDK project before it becomes an installable package. Review that project's privileges, dependencies and update process before distribution. The kit does not establish that a generated VPKG is secure or compatible with every device.

## What is not a vulnerability here

A playlist containing content that the viewer has no right to access is not itself a vulnerability in the player. OpenIPTV ships no channels and sends no analytics. Expected network requests include application assets from the hosting origin, the configured playlist or provider API, programme information, streams and artwork. Samsung remote access can also serve an authorised device on the local network. Report unexpected destinations or disclosure of private data through any of those paths.

Provider CORS restrictions, mixed content blocking and unsupported codecs are compatibility issues unless the app exposes data or bypasses a security boundary. Do not work around them by disabling TLS certificate checks, exposing the TV's management service to the internet or entering provider credentials into an untrusted proxy.

## Which versions

The latest published release and `master` receive fixes. Older releases are not maintained. Experimental targets remain candidates until their device acceptance requirements are met, so a downloadable candidate is not a claim of general platform support.

Include the app version, platform, installation route and artifact checksum when available. Remove provider credentials, pairing codes, device keys, serial numbers and private addresses from the initial report. Share sensitive evidence only through the private reporting channel when needed.
