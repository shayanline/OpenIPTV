# Contributing

Pull requests are welcome. OpenIPTV shares its React application across the Samsung build, the desktop browser and experimental TV candidates. The supported Samsung engine range is owned by [the platform matrix](scripts/tv/platforms.json). Changes to the shared code must preserve that range and remain usable with a directional remote.

Read [the design notes](docs/design.md) for the architecture and [AGENTS.md](AGENTS.md) for the invariants. The [TV platform guide](docs/tv-platforms.md) owns candidate status, installation routes and the evidence required before claiming support.

## Before opening a pull request

Choose the checks the change justifies from the selection table in [testing and measurement](docs/testing.md), under the approval rules in [AGENTS.md](AGENTS.md). What each gate measures and how to read its output is in the same document.

Preparing a pull request does not invalidate results from checks that already passed on the same inputs, so nothing needs to rerun just because a pull request is being opened.

CI runs the full set on code changes and skips documentation only paths, so a run that is red there is not ready, with one exception: the performance budget is allowed to fail, because it compares against numbers measured on a particular machine and a shared runner is not that machine.

## Things that will be asked of a change

Keep one shared application, with one artifact per platform and no branching by model year. Select a target through the package metadata and the existing platform adapter. Do not create a second set of screens or infer privileged platform behaviour from the browser user agent. Additional runtime capability probes need a justification and appropriate engine coverage.

**Do not interpret playlist content.** Names, groups and languages appear exactly as the file writes
them. This app does not know what a country is, and it should not learn.

**Say why in the code.** The comments here explain decisions rather than mechanics, and a measured
number beats an adjective. If you found something out by testing it on a television, write down what
you measured, because the next person cannot repeat it without your set.

**Nothing new on an interaction path.** A key press has to be answered before anything expensive
happens. If your change adds work while a key is held, it needs the same treatment the rail and the
search already have.

## Reporting a problem instead

An issue is just as useful as a patch, especially from a television this has never run on. The one
thing that makes a report actionable is Settings, then Diagnostics: it lists what the set reports
about itself and every key its remote sends, and the bug report template asks for it.

Security problems go through [SECURITY.md](SECURITY.md) rather than the issue tracker.

## Working on a TV port

Keep target identities and delivery types in [tvTargets.ts](src/services/tvTargets.ts). Runtime identity and exit handling belong in [tvPlatform.ts](src/services/tvPlatform.ts), while remote key translation belongs in [useRemote.ts](src/hooks/useRemote.ts). Playback continues through the existing player interface. A native wrapper should host the shared application and supply platform integration without duplicating its UI.

The LG manifest template in [platforms/webos/appinfo.json](platforms/webos/appinfo.json) owns the app ID. The packager replaces its placeholder version from `package.json`. Keep a published app ID stable. The [Vega wrapper](platforms/vega/App.tsx) is an integration kit for an official SDK project, which owns its dependency versions and VPKG configuration.

For local packaging prerequisites and commands, follow the [LG build guide](docs/tv-platforms.md#build-the-lg-package-locally) and the [Vega integration guide](docs/tv-platforms.md#amazon-vega-integration-kit). Run builds, packaging and smoke checks only in the approved final verification phase described above. The [testing selection table](docs/testing.md#choosing-local-checks) owns which checks a change requires.

The release workflow packages the candidates from the shared build. `npm run ports:smoke` checks the resulting web archives without Samsung shims or a development proxy. A passing result does not establish TV decoding, installation or SDK wrapper compatibility. Before promoting a candidate, provide the [required device evidence](docs/tv-platforms.md#required-device-acceptance-evidence) for the exact artifact and device range.

Do not guess private VIDAA or VIZIO APIs. Obtain partner documentation and device access before completing those integrations. Keep candidate labels until that work and device validation are complete. Do not commit signing keys, device credentials, provider logins or SDK account material.

## Keeping guidance current

Update the README when installation routes or viewer features change. Update the TV platform guide when a target's status, prerequisites or distribution route changes. Record user facing changes under Unreleased in the changelog until a release is explicitly prepared.

The design and testing notes serve contributors. Dated plans and proposals under `docs/superpowers/` record design history and do not replace the current installation or support guidance.
