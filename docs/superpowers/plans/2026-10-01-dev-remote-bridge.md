# Development Device Bridge Implementation Plan

**Goal:** Run the complete TV device onboarding flow between a laptop browser and physical device through the existing Vite development process.

**Architecture:** A development only Vite plugin relays the existing device HTTP API to one simulated television browser through Server Sent Events. The browser executes the existing authenticated device router and posts each response back to Vite. Production remote access remains Tizen only.

**Tech Stack:** Vite middleware, Node HTTP, Server Sent Events, React, TypeScript and Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-dev-remote-bridge-design.md`

## Constraints

- Do not add a runtime dependency.
- Do not alter production or GitHub Pages desktop behaviour.
- Activate only with `?tv-onboarding` in Vite development.
- Use the actual Vite port and a private laptop address.
- Reuse `routeDeviceRequest` for every device API decision.
- Keep changes uncommitted until Shayan completes manual testing.

### Task 1: Vite relay

**Files:**
- Create: `scripts/dev-remote-bridge.mjs`
- Modify: `vite.config.ts`
- Test: `tests/devDeviceBridge.test.ts`

- [ ] Write failing tests for private address selection, bridge information, one active desktop event stream, API allowlisting, 64 KiB input, unavailable desktop, response relay and 30 second timeout.
- [ ] Run `npm test -- tests/devDeviceBridge.test.ts` and confirm the expected failures.
- [ ] Implement `devDeviceBridge()` as a Vite plugin with development middleware only.
- [ ] Run the bridge tests until they pass.

### Task 2: Browser bridge lifecycle

**Files:**
- Modify: `src/services/remoteServer.ts`
- Modify: `src/hooks/useRemoteAccess.ts`
- Test: `tests/remoteServer.test.ts`

- [ ] Write failing tests for bridge information startup, `/remote/index.html` state, EventSource request handling, response posting, unavailable errors and clean shutdown.
- [ ] Run `npm test -- tests/remoteServer.test.ts` and confirm the expected failures.
- [ ] Add development lifecycle functions that reuse `routeDeviceRequest` and keep the Tizen worker path unchanged.
- [ ] Run the device server tests until they pass.

### Task 3: Simulated TV activation

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/RemoteSetup.tsx`
- Create: `src/stores/setup.ts`
- Modify: `src/services/remoteProtocol.ts`
- Modify: `public/remote/index.html`
- Modify: `public/remote/remote.js`
- Modify: `public/remote/remote.css`
- Modify: `public/wasm/management-socket.worker.js`
- Test: `tests/onboarding-language.test.tsx`
- Test: `tests/deviceSetup.test.tsx`
- Test: `tests/remoteProtocol.test.ts`
- Test: `tests/deviceWeb.test.ts`
- Test: `tests/managementWorker.test.ts`

- [ ] Write failing tests that ordinary desktop onboarding remains manual, `?tv-onboarding` enables the split TV layout and a development state builds a QR for `/remote/index.html`.
- [ ] Run the component tests and confirm the expected failures.
- [ ] Activate development remote access only for the query parameter and add `remotePath` to management state.
- [ ] Add an in memory setup store and an authenticated preview command so device typing and language mirror onto the player before persistence.
- [ ] Serialize management commands, exempt draft previews from revision churn and make paired device changes reactive.
- [ ] End pairing on success, cancellation, expiry, failed attempts or server stop, and wait for a pending stop before restart.
- [ ] Implement starting, ready, pairing, connected and unavailable states in TV Settings with grouped codes, expiry, cancel and correct focus.
- [ ] Return both interfaces to setup when the final playlist is removed, while keeping the remembered device connected.
- [ ] Align field, DOM and menu order, serve the real application icon and add visible progress, success and error states to every device action.
- [ ] Replace prompt editing with inline forms, restore focus after renders, correct live region semantics and localise all visible copy.
- [ ] Run the component, protocol, device interface and worker tests until they pass.

### Task 4: Verification and manual test server

- [ ] Run changed file lint, targeted tests, `npm run check` and `npm run build`.
- [ ] Confirm the production bundle contains no development bridge server code.
- [ ] Find an unused port and start Vite on all interfaces with strict port binding.
- [ ] Open the simulated TV URL on the laptop and confirm a QR, local address and six digit code appear.
- [ ] Give Shayan the laptop URL and complete device test steps while leaving the changes uncommitted.
