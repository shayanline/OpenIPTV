# Phone Management Design

## Purpose

OpenIPTV will let a viewer use a phone on the same local network to complete first setup and manage playlists and ordinary settings. The TV remains the source of truth, playlist credentials remain inside the home, and the feature requires no account or hosted service.

Success means a viewer can scan a QR code, pair a phone, add a working first playlist, and reach the channel screen without typing a long address with the remote. The existing manual setup must remain fully usable when phone setup is unavailable.

## Scope

The first release supports local network access while OpenIPTV is running. It supports multiple remembered phones, first setup, playlist management, ordinary settings, cache clearing, and revocation of individual phones.

The first release does not support management away from home, cloud storage, user accounts, favourites, diagnostics, playback control, or remote reset of all application data. Reset remains on the TV because it removes the pairing records that authorise the phone.

## Welcome Screen

The welcome screen keeps the existing visual language and uses the approved vertical split layout. The left side contains the standard manual playlist address, optional name, language control, and add action. The right side contains a large QR code, a concise phone setup explanation, the current local address, a six digit pairing code, and connection status.

The manual side remains operable regardless of management server state. If local phone setup cannot start, the right side names the problem and directs the viewer to the manual form without blocking remote navigation.

The QR side reports waiting, phone connected, validating playlist, loading channels, completion, and recoverable failure states. These updates do not replace the manual form or move its focus.

## Architecture

OpenIPTV remains the source of truth. The phone reads a typed snapshot and sends typed commands. The TV validates each command, applies it through the existing settings and playlist stores, persists the result, and returns the resulting revision and state.

A new management server runs in a dedicated WebAssembly worker and binds to the TV's current private network address. It has a separate socket, protocol, lifecycle, and build artifact from the loopback compatibility server. The compatibility server remains bound to loopback and continues to serve only repaired manifests.

The management server starts during first setup. After a phone has paired, it starts on application launch and closes when OpenIPTV exits. A lightweight idle loop must be measured against the weakest supported TV budget.

The phone interface ships inside the widget as a small HTML, CSS, and JavaScript application. The management server serves these static assets and the same origin JSON API. The phone interface uses native browser controls and introduces no frontend framework.

The TV obtains its local address from the Samsung network API. The server binds to that address on a fixed application port so a remembered browser location can reconnect after an ordinary application restart. If the address changes, the viewer scans the current QR code and pairs the new browser origin again.

The QR code is generated locally from a bundled implementation. No pairing information is sent to an external QR service. The selected QR implementation must have no transitive runtime dependencies, a compatible licence, a published version older than seven days, acceptable packaged size, and an entry in the shipped third party notices.

## First Setup Flow

When no playlist exists, OpenIPTV starts the management server and creates an expiring pairing session. The QR code opens the local phone interface with the high entropy pairing secret in the URL fragment. A viewer who cannot scan can type the displayed local address and then enter the six digit code.

The phone flow starts with a welcome page and language selection. The selected language updates the phone and TV welcome screens. The next page collects the first playlist address and optional name. The TV validates the address, fetches the playlist, and confirms that it contains channels before setup is committed.

A successful final request stores the language and playlist together, makes the first playlist active, loads its channels, and closes onboarding. A failed or empty playlist keeps both devices in onboarding and returns a specific correction. No partially completed settings are persisted before the final request succeeds.

Other settings retain their existing defaults during onboarding. After setup, the phone opens the complete management interface where the viewer can change ordinary preferences.

## Pairing and Remembered Phones

A QR pairing session uses a high entropy secret that expires after five minutes or immediately after successful use. The URL fragment prevents the browser from including the secret in the initial HTTP request. The phone proves possession to the TV, supplies an editable device name, and receives a separate permanent device credential.

The six digit fallback works only while the pairing panel is visible. Failed attempts are rate limited, and repeated failures invalidate the current code. The TV never logs pairing secrets, codes, credentials, playlist addresses, or request bodies.

Each phone has an independent identifier, name, credential verifier, creation time, and last used time. The TV presents paired phones in settings and lets the viewer rename or revoke them separately. Revocation invalidates subsequent requests from that phone.

A remembered phone can reconnect while OpenIPTV is running on the same local address. The phone stores its credential in browser storage for the TV origin. If the TV address changes, browser origin isolation requires a new pairing. The previous phone record remains available for revocation.

## Management Interface

The phone management interface contains Playlists, Appearance, Playback, General, and Paired phones sections. It uses the TV's selected language and responsive native controls.

Playlist commands support adding, renaming, editing, removing, refreshing, and activating a playlist. Removing a playlist requires phone confirmation. Removing the active playlist follows the current TV rule by activating the first remaining playlist.

Settings commands support language, text size, channel numbers, channel logos, clock visibility, alphabetical sorting, screen fit, compatibility mode, and resume behavior. Changing a setting must trigger the same side effects as changing it on the TV, including channel list rebuilding and compatibility server shutdown.

Cache clearing is available after phone confirmation. Full application reset remains available only on the TV. Diagnostics, favourites, playback control, and cached playlist contents are not exposed by the management API.

## API and Concurrency

The server exposes a small versioned same origin API for pairing, reading state, applying commands, and checking operation status. Requests and responses use JSON with strict body limits and explicit content types. Unknown fields and commands are rejected.

Every state snapshot includes a monotonically increasing revision. A mutating command includes the revision it was based on. If another phone has already changed state, the TV returns a conflict response with the current snapshot, and the phone asks the viewer to retry rather than overwriting the newer change.

The phone polls only while a page needs changing status, such as pairing or playlist validation. Ordinary settings requests receive the updated snapshot in their response. The first release does not implement WebSockets.

## Security Boundaries

The management server binds only to the private address reported for the active TV network. It does not bind to loopback, public addresses, wildcard interfaces, or inactive adapters. Startup fails closed if no valid private address is available.

The server serves only its bundled phone assets and allowlisted API routes. It does not serve arbitrary widget files, cached playlists, logos, repaired manifests, or filesystem paths. Path traversal, oversized headers, oversized bodies, unsupported methods, invalid JSON, unknown commands, and missing credentials receive bounded error responses.

The API does not permit cross origin requests. Mutations require a valid phone credential and the expected state revision. Pairing endpoints are available only during an active pairing session. Credential comparison avoids timing dependent string comparison where the platform permits it.

Local HTTP cannot provide the guarantees of publicly trusted TLS on a hostile network. The feature protects against accidental household access and unauthorised requests on a normal trusted home network. The interface must describe pairing as local access and must not claim end to end transport security.

## Failure Handling

If the TV cannot read a private address, bind the management port, or start the worker, the welcome screen keeps manual setup active and displays a concise phone setup error. Playback and existing settings remain unaffected.

If the phone disconnects before setup completion, staged values are discarded. If it disconnects after a command, retrying the same request must not duplicate a playlist or repeat a destructive action. Mutating requests therefore carry a short request identifier whose completed result is retained for the current session.

If a playlist address is invalid, unreachable, not a playlist, or contains no channels, the phone displays the TV's specific error and keeps the entered values for correction. The TV welcome screen reports that setup needs attention on the phone.

If OpenIPTV closes, the worker and socket close. A phone shows that the TV is unavailable and offers retry guidance. A revoked phone clears its local credential after an unauthorised response and returns to pairing.

## Testing

Pure TypeScript tests cover command parsing, body limits, pairing expiry, attempt limits, credential verification, request idempotency, revision conflicts, private address validation, snapshot filtering, and every allowed settings and playlist command.

Component tests cover the vertical welcome layout, manual setup navigation, QR availability and failure states, pairing status, translated text, right to left direction, successful first setup, and failed first playlist validation. Existing key law tests must continue to pass.

Phone interface tests cover first setup, remembered reconnection, playlist management, settings changes, stale revision recovery, destructive confirmations, unavailable TV guidance, and revoked credentials.

The WebAssembly artifact check covers the new module and worker bindings. A production build, TV engine gate, TV layout gate, and TV performance budget gate cover packaging, old engine compatibility, the changed welcome structure, and the persistent worker cost.

An on set procedure verifies address discovery, LAN binding, QR pairing, manual code pairing, remembered reconnection, phone revocation, application shutdown, wired and wireless network paths, and playlist loading through the television's real network stack. This procedure is required for release confidence but cannot be an automated pull request gate.

## Delivery Constraints

The implementation must preserve the current manual first setup, remote key laws, local storage and IndexedDB ownership, compatibility mode opt in behavior, loopback server isolation, CSP requirements, and single artifact support across Samsung engine versions.

The implementation must avoid a hosted backend, account system, analytics, unrelated network requests, and speculative cloud relay interfaces. A future relay can translate to the same typed commands after a separate design, but the first release carries no relay code.
