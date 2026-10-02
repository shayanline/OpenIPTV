# Development Device Bridge Design

## Purpose

A developer must be able to exercise the complete Samsung TV device onboarding flow on a laptop and physical device without a television, emulator or separate companion command. The laptop browser remains the source of truth, while the existing Vite process accepts device requests and relays them into that browser.

The bridge is development only. Production builds, GitHub Pages and ordinary desktop use continue to hide device setup.

## Activation

The bridge activates only when Vite is running and the laptop page includes `?tv-onboarding`. An ordinary `npm run dev` page keeps the centred manual setup form and starts no bridge connection.

Vite already listens on all interfaces. The bridge reports a private LAN address and the actual selected Vite port, including an override passed through `--port`. The QR and manual address open `/remote/index.html` on that same origin.

## Data Flow

A Vite plugin exposes three development routes. `GET /__openiptv/remote/info` returns the selected private address, port and device page path. `GET /__openiptv/remote/events` opens one Server Sent Events connection from the laptop browser. `POST /__openiptv/remote/responses/:id` returns a relayed response from the laptop browser.

The existing device interface continues to call `/api/v1/pair`, `/api/v1/state` and `/api/v1/command`. In development, the Vite plugin accepts those requests, assigns an identifier, sends the request to the connected laptop through Server Sent Events and holds the device response until the laptop answers or a timeout expires.

The laptop uses the existing `routeRemoteRequest` function, so pairing expiry, credentials, revision checks, commands, settings side effects and playlist loading remain identical to the television path. A successful device command updates the zustand stores in the laptop browser, which updates the visible interface immediately.

An in memory setup store holds the playlist address and optional name while onboarding is open. The device sends a debounced authenticated preview command as the viewer types and sends language changes immediately. The player and device read the same draft, while successful setup remains the only action that persists a playlist. Removing the final playlist returns both interfaces to setup immediately and keeps an authorised device connected.

## Connection Ownership

Only one simulated television browser may be active. A new Server Sent Events connection replaces the previous one, preventing one device command from being applied to several browser tabs.

The browser reconnects through the native EventSource retry behaviour. Stopping simulated onboarding closes EventSource and returns device requests to an unavailable response.

## Pairing State Model

Remote access presents exactly five TV states: starting, ready, pairing, connected and unavailable. Only pairing shows credentials. Ready shows one pairing action, pairing shows QR, address, grouped code, expiry and cancel, connected confirms the new device, and unavailable offers retry without creating a session.

Opening Settings keeps the server active long enough to pair the first device. A pairing session exists only while the server listens and ends on success, cancellation, expiry, five failed attempts or server stop. Settings never renders a fragment only or expired QR.

Device commands execute serially. Revision checks and mutation form one ordered transaction. Setup draft previews update only the in memory draft and do not consume management revisions. Language changes remain ordinary revisioned settings commands.

Paired device storage publishes changes to subscribers. Pairing, revocation, rename and reset therefore update the server lifecycle and visible list without waiting for unrelated renders. A pending stop completes before a requested restart.

## TV Device Access UX

The Remote access section leads with the current state and primary action, followed by the paired device list. Starting and unavailable states do not offer pairing. Ready offers Pair a device. Pairing replaces that action with the credential card and Cancel pairing. Connected confirms success before returning to the ready state.

The six digit code is grouped visually as two groups of three while the underlying value remains six digits. Rename focuses its input immediately and returns focus to the originating row on save or cancel. Destructive revocation continues using the shared confirmation dialog.

## Device Interface UX

Every operation uses one busy, success and error boundary. Pairing and setup disable duplicate submission, management actions preserve focus, successes use polite status announcements, and errors use assertive alerts. Playback or playlist loading errors override generic saved feedback.

The DOM, visual and tab order all follow Appearance, Playback, General, Playlists and Remote access. Add and edit forms use explicit labels. Actions include the affected playlist or device in their accessible names and confirmations. URLs stay left to right in every locale.

The device page does not make the whole application a live region. Hardcoded copy moves into the server supplied translated label map. Inline edit forms replace prompt dialogs, and small secondary text meets normal text contrast.

## Security and Limits

The bridge exists only in Vite development middleware and is absent from production output. It accepts only the three existing versioned API paths, applies the same 64 KiB body limit and holds each request for at most 30 seconds.

No Cross Origin Resource Sharing headers are added. A device must load the management page from the same Vite origin, and the existing pairing credential remains mandatory after pairing.

The LAN address comes from active private IPv4 interfaces. Loopback, public addresses and inactive interfaces are excluded. If several private interfaces exist, the plugin prefers WiFi and Ethernet style interfaces, then returns the first private address.

## Interface

`RemoteAccessState` gains a `remotePath` field. Television state uses an empty path. Development state uses `/remote/index.html`, allowing `RemoteSetup` to build the correct QR and manual address without duplicating the component.

`useRemoteAccess` accepts a development mode flag. Television mode keeps the WebAssembly worker lifecycle unchanged. Development mode fetches bridge information, opens EventSource and relays each request through `routeRemoteRequest`.

`App` treats device access as supported when `onTizen()` is true or when Vite development mode includes the `tv-onboarding` query parameter. The simulated mode does not change playback, remote handling or any other Tizen capability.

The device welcome fields follow the player order: address, optional name, language and Add. Management follows the player order: Appearance, Playback, General, Playlists and Remote access. The device uses the shipped OpenIPTV icon.

Every device operation has a visible status boundary. Pairing and setup show progress and disable duplicate submission. Management commands show saving, then a translated success or actionable error. Failed setup keeps all entered values.

A real TV continues showing only its address and fixed port because its management server owns the root path. The development bridge uses `/remote/index.html` because Vite already serves the simulated player from its root.

## Failure Handling

If no private address exists, the laptop shows the existing unavailable guidance and retains manual entry. If the EventSource disconnects, pending device requests receive an unavailable response after the bounded timeout. Invalid event payloads are ignored.

If a device opens the page before the laptop bridge connects, the request receives a service unavailable response and the device shows its existing retry guidance.

## Testing

Unit tests cover private address selection, actual port reporting, single browser ownership, request allowlisting, body limits, timeout cleanup and request relay responses.

Browser service tests cover development startup, EventSource request handling, response posting, state updates and shutdown. Component tests cover the `/remote/index.html` QR and manual address.

The existing device access, protocol, device web and onboarding tests remain unchanged and must pass. Production build output is checked to confirm that the Vite middleware does not ship in the application bundle.
