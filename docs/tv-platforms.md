# TV platform candidates

OpenIPTV keeps its React interface and application logic in one codebase. The new TV targets are experimental candidates until the release checklist in this guide has evidence from real televisions. A downloadable artifact does not establish that a TV model is supported.

| Platform | Release artifact | How to try it | Remaining distribution gate |
|:--|:--|:--|:--|
| LG webOS | `OpenIPTV-webos.ipk` and `OpenIPTV-webos.zip`. | Install the IPK through Developer Mode using the steps below. | Validate on real LG TVs, then submit through LG Seller Lounge. |
| Titan OS | `OpenIPTV-titan.zip`. | Host the extracted files and register the entry URL in Titan DevView. | Obtain portal access, validate on a paired TV and pass Titan QA. |
| VIDAA | `OpenIPTV-vidaa-candidate.zip`. | Use the hosted candidate through the partner testing process. | Obtain partner documentation, implement any required device integration and pass certification. |
| VIZIO | `OpenIPTV-vizio-candidate.zip`. | Use the hosted candidate on a device authorised by VIZIO. | Obtain partner documentation, implement any required device integration and pass certification. |
| Amazon Vega | `OpenIPTV-vega-kit.zip`. | Integrate the shared web bundle and wrapper into an official Vega WebView template. | Build a VPKG with the Vega SDK, validate on hardware and complete Amazon submission. |

Every candidate includes `platform-release.json`, which identifies its target and version. It records hardware validation and store publication as false. The release index, `OpenIPTV-ports.json`, lists the artifacts and their checksums. GitHub release assets are independent of official TV stores.

## Choose the right download

Use the assets attached to a release that includes the TV port workflow. Earlier releases may contain only the Samsung widget. GitHub's automatic source archives are source checkouts and are not TV installation packages.

The LG IPK is the only new artifact that this workflow prepares for direct installation through a vendor's developer tools. Its companion ZIP contains web app sources. Titan, VIDAA and VIZIO ZIPs need hosting and vendor access, while the Vega ZIP needs an SDK build. Renaming a file extension does not convert an artifact into a different platform's package.

A manual Actions run provides an `OpenIPTV-TV-ports` artifact instead of publishing a release. Download and extract that outer artifact archive before selecting the platform file inside it. Check the platform file against its accompanying `.sha256` file. Do not compare the checksum of the outer Actions archive with the checksum of an IPK inside it.

## Install on LG webOS

The initial candidate targets webOS TV 6.0 and later. Earlier versions are outside this port's intended scope. This is an engineering starting point that still requires device validation.

1. Download `OpenIPTV-webos.ipk` and its `.sha256` file from the same [GitHub release](https://github.com/shayanline/OpenIPTV/releases). Check the checksum with `shasum -a 256 -c OpenIPTV-webos.ipk.sha256` in the download directory.
2. Follow LG's [Developer Mode setup](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app). Install the Developer Mode app on the TV, sign in locally, enable Developer Mode and restart the TV when instructed.
3. Install the [official webOS CLI](https://www.npmjs.com/package/@webos-tools/cli) on your computer, then register the TV on the same private network.

```sh
npm install --global @webos-tools/cli@3.2.6
ares-config --profile tv
ares-setup-device
```

Choose a device name such as `living-room`. Use the TV address, port `9922` and user `prisoner` as described by LG. Enable Key Server in the TV's Developer Mode app, then retrieve the key locally. Never share the passphrase or the private key.

```sh
ares-novacom --device living-room --getkey
ares-install --device living-room /path/to/OpenIPTV-webos.ipk
ares-launch --device living-room io.github.shayanline.openiptv
```

From a source checkout, the following helper installs and launches the same package.

```sh
npm run deploy:webos -- --device=living-room --package=/path/to/OpenIPTV-webos.ipk
```

Developer Mode is a development installation route. Its session expires unless extended through LG's supported process, and development apps can be removed when it expires. It is unsuitable as the permanent installation route for ordinary viewers. The eventual consumer route is the LG app store, subject to approval.

### Build the LG package locally

Install the webOS CLI as described above. Use the Node version in `.nvmrc`, install dependencies with `npm ci`, then run the following command only during an approved verification or release phase.

```sh
npm run package:webos
```

The command builds the shared app, generates LG's launcher and submission icons from the existing SVG, then runs `ares-package`. Chrome or Chromium is required for icon generation. The package and checksums appear under `build/ports/`. The app ID is owned by `platforms/webos/appinfo.json`, and the release version comes from `package.json`. Keep the app ID stable after publishing because changing it creates a different app and loses access to the previous app's local data.

The ZIP contains the packaged web app sources and generated icons. It is useful for inspection and submission preparation. Install the IPK on the TV.

## Try Titan OS

1. Obtain a [Titan Partner Portal account](https://www.titanos.tv/partner-portal) and request DevView access.
2. Extract `OpenIPTV-titan.zip` onto a static HTTPS host that you control. Preserve all relative paths and serve `.js` files as JavaScript, `.css` files as CSS and `.wasm` files as WebAssembly if you add any later.
3. Use a dedicated origin for this application. Add its complete `index.html` URL in the portal's DevView sandbox, pair the TV and launch the app through DevView. Follow the [official device testing guide](https://docs.titanos.tv/devviewinstall).
4. Run the device acceptance checklist below before submitting the URL for [Titan QA](https://docs.titanos.tv/publishing).

The adapter maps Titan's Back, channel and play/pause keys into the existing navigation model. It also honours the platform's legacy Back constants. The existing confirmation dialog calls `window.close()` when the viewer chooses to exit, as required by [Titan's navigation guide](https://docs.titanos.tv/navigation).

There is no universal USB installer for Titan's hosted applications. DevView and official distribution are the supported routes used here. Older devices must be scoped against Titan's current [device specifications](https://docs.titanos.tv/platform-versions) and tested before inclusion. The Samsung engine gates do not establish support for every Titan model.

## VIDAA and VIZIO candidates

Contact the [VIDAA partner programme](https://www.vidaa.com/partners/) or [VIZIO content partner team](https://www.vizio.com/en/content-partners) before committing to a launch date. Both candidates contain the shared web app with explicit platform identity, a native HLS preference when available and diagnostics. They do not claim to implement private vendor APIs, certification requirements or a supported sideload installer.

Obtain the current partner documentation and development device access first. Confirm the remote key map, text input, exit API, networking permissions, media support and update process with the vendor. Complete the adapter in this repository when those contracts are available, then run the same device checklist. The current numeric Back mapping for these two targets is deliberately left unimplemented rather than guessed. Standard named `GoBack` and `BrowserBack` events are recognised when the device supplies them.

Use a dedicated origin for each hosted target. Publishing several apps under different paths of one origin shares browser storage and can mix playlists, credentials and preferences.

## Amazon Vega integration kit

The Vega ZIP is an integration kit and is not an installable Fire TV package. It covers Vega OS only. It does not cover Android derived Fire OS devices.

1. Install Amazon's current [Vega developer tools](https://developer.amazon.com/docs/vega/2.0/vega-get-started) and create the official WebView project template. Retain the SDK's dependency versions, project registration and build configuration.
2. Add the WebView dependency supported by that SDK. Copy `vega-wrapper/App.tsx` into the generated project's app entry point.
3. Copy the extracted web app into that project's `assets/openiptv/` directory. Exclude the `vega-wrapper/` directory itself. Keep `index.html`, `assets/`, `fonts/` and licence files together.
4. Merge the services in `vega-wrapper/services.toml` into the generated manifest without duplicating existing tables or removing template declarations. Confirm the services against the [current WebView setup guide](https://developer.amazon.com/docs/vega/0.24/overview-of-webview.html).
5. Build, install and launch through Vega Studio using the generated project's documented workflow. This repository does not generate or publish a VPKG without the official SDK project.

The wrapper enables storage, remote system key delivery and playback after the viewer selects a channel. It removes the WebView before exiting when the shared app calls `window.close()`. See the [WebView API reference](https://developer.amazon.com/docs/vega-api/0.24/webview-component-reference). The kit bundles no Amazon runtime dependencies. Before distributing a VPKG, include the dependency notices and licence texts required by the generated SDK project and any additional libraries.

Amazon disables HTTP communications by default in recent WebView releases. The kit retains that default. Plain HTTP playlists and streams require an explicit networking decision in the SDK project and device testing using Amazon's [HTTP configuration guidance](https://developer.amazon.com/docs/vega/0.24/develop-your-app-with-webview.html). Do not describe this kit as having arbitrary playlist compatibility until that work is complete.

## Update a candidate

For LG, download the next IPK and verify its checksum before installing it through the same Developer Mode route and app ID. Confirm that playlists, favourites and settings survive the update on a test TV before distributing it to other viewers. Developer Mode expiry can remove development apps and their data, so extending the session is part of keeping a development installation available.

For hosted targets, keep the app's origin stable because browser storage belongs to that origin. Stage a new version at a separate path on the same dedicated origin, complete the device checklist, then change the launch URL through the vendor's supported process. Moving to a different hostname or protocol gives the app a different storage context, which can make the previous playlists and settings unavailable.

For Vega, retain the generated project's package identity and follow the SDK's supported update procedure after building the new shared assets into a VPKG. Verify persistence and playback again on the target device.

Keep the preceding artifact and hosting directory for recovery. An older installed package can be refused as a downgrade, so establish the vendor's supported recovery route before promoting a release. Uninstalling or resetting an app can delete its local data. Do not use either operation as a routine update step, and do not promise that a future store installation will automatically inherit a development installation's data.

## Troubleshooting a candidate

| Symptom | What to do |
|:--|:--|
| The release has no file for the TV. | Choose a release that includes the target artifact, or wait for one. The Samsung WGT and GitHub source ZIP cannot replace it. |
| LG installation cannot connect. | Confirm that the TV and computer share a private network, Developer Mode is active and the device is registered with the official CLI. Retrieve a fresh developer key locally if needed. |
| The LG development app disappears. | Check the Developer Mode session. Follow LG's supported session process, then reinstall if necessary. Data from a removed app may no longer be available. |
| A hosted ZIP or Vega kit cannot be installed from USB. | Follow that platform's entry in this guide. These files require hosting or an SDK build and do not provide a USB installation route. |
| Titan DevView cannot load the page. | Confirm portal access and device pairing. Check that the registered URL points to the extracted app's `index.html`, all relative files are present and the host serves JavaScript and CSS with the correct content types. |
| The UI loads but the playlist or stream fails. | Check provider CORS, HTTPS, certificate and codec requirements using the playback limits below. Native playback does not remove restrictions on playlist downloads or provider API calls. |
| A remote key does nothing. | Record its raw code using Settings, About, Support, Diagnostics, then Remote buttons. Include the platform, model, firmware and installation route in the bug report. VIDAA and VIZIO numeric key integration is still pending. |
| Settings appear to reset after a hosted update. | Check whether the origin changed. Restore the previous origin and use the same dedicated origin for future versions. |
| Phone pairing is missing. | Use the physical TV remote and on screen source setup. The local remote access service currently ships only for Samsung Tizen. |

When reporting a candidate issue, include its app version, release filename or source commit, checksum if available and the TV model with OS and firmware. Do not post provider URLs containing credentials, private hosting URLs, pairing codes or device identifiers. Use the [bug report form](https://github.com/shayanline/OpenIPTV/issues/new?template=bug_report.yml) for ordinary problems and the [private security reporting channel](https://github.com/shayanline/OpenIPTV/security/advisories/new) for vulnerabilities.

## Playback and feature limits

The LG and hosted TV profiles prefer the native HLS player when the video element reports support. The desktop browser and Vega retain the existing hls.js preference. Both paths use the existing player lifecycle, buffering timeout, stall detection and transport controls. Native codec and HLS support varies by device and firmware.

The playlist download is still a web request. A provider must allow the app's origin through CORS where the platform enforces it. Native stream playback does not remove CORS restrictions from M3U downloads, Xtream API calls, programme guide downloads or hls.js requests. An HTTPS host can also block plain HTTP resources as mixed content. Validate these cases on the actual target and explain unsupported providers instead of adding a public proxy or disabling TLS checks.

Samsung's local manifest socket and local remote access server remain Samsung features. The new candidates do not ship those socket modules or advertise local remote access. Compatibility mode can use the existing hls.js repairing loader where MSE and CORS permit it. Native playback alone does not provide Samsung's manifest repair service.

Hosted TV candidates do not use Vite's development HTTP relay. Static production hosting does not supply that endpoint. Hosting the app also introduces a network request to the host at launch, so disclose that hosting arrangement in store privacy information.

## Release and official distribution

CI and the release workflow build the shared app once, package the candidates and run the artifact smoke gate. LG packaging uses the pinned official CLI. Tags attach the individual artifacts and checksums alongside the existing Samsung widget. A manual dry run uploads build artifacts without publishing a release or deploying the browser demo.

Before cutting a version, rehearse the workflow with its default `dry-run` setting. Download the Actions artifact, identify the platform file inside it and complete the device checklist against that exact file or hosted bundle. An Actions run does not publish the candidates to a TV store. The current automated smoke gate also does not establish decoder compatibility or validate the Vega SDK wrapper.

The hosted ZIP files are release artifacts. The workflow does not automatically redeploy their production URLs. GitHub Pages remains the browser demonstration, which has its own demo playlist. Do not submit that demo URL as a TV application.

For a hosted release, upload the candidate into a new immutable version directory on its dedicated origin. Run the device checklist against that exact URL. Change the partner launch URL or the hosting route only after approval. Keep the previous directory available so that you can restore the previous launch URL if the new version fails. Ask the vendor whether URL changes or code updates need another certification pass.

### Required device acceptance evidence

Record the release version, artifact checksum, TV model, OS and firmware, installation route and outcome for each check in the release approval or vendor submission. Do not put provider credentials, playlist URLs containing credentials, serial numbers or device keys into public issues or logs.

| Check | Evidence required before claiming support |
|:--|:--|
| Installation and updates | Install the release artifact or launch URL, launch from the TV home screen, then update an earlier version while preserving playlists and favourites. |
| First use | Add an authorised M3U address and Xtream source using the TV keyboard, then restart the app and confirm that settings persist. |
| Navigation | Exercise every screen using arrows, OK and Back. Check option pickers, input deletion, colour keys where present, channel keys and the final exit confirmation. |
| Live playback | Confirm moving video and audible sound on authorised HLS streams, including variants, representative codecs, HTTP and HTTPS cases, a failed channel and a channel change. |
| Movies and episodes | Check finite playback, pause, seek, resume position and completion for the formats included in the support claim. |
| Lifecycle | Press Home during playback, return, suspend the TV, wake it and relaunch. Confirm that playback releases resources and recovers correctly. |
| Failure and privacy | Check a disconnected network, an unavailable server, a denied CORS request and an expired TLS certificate. Confirm a useful error and no credential disclosure. |
| Device limits | Check long playlists, prolonged playback, rapid channel changes and storage exhaustion on the weakest device included in the support claim. |

Before a store submission, obtain approval of the final app identity, listing text, screenshots and privacy statement. Confirm acceptance of a player where viewers supply their own content. The maintainer then submits the platform's own package or URL to [LG Seller Lounge](https://seller.lgappstv.com/), [Titan's publishing process](https://docs.titanos.tv/publishing), the VIDAA or VIZIO partner team, or [Amazon's developer console](https://developer.amazon.com/). Store accounts, contracts and approval are outside the automated release workflow.

No new target should be described as generally supported until its required device evidence exists and its installation route is usable by the intended audience. Change candidate status only as part of an explicitly reviewed promotion.
