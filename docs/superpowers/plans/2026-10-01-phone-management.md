# Phone Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a viewer pair remembered phones on the local network, complete first setup, and manage OpenIPTV playlists and ordinary settings through a responsive phone interface.

**Architecture:** A dedicated WebAssembly worker owns a private network HTTP socket and forwards bounded API requests to typed TypeScript services on the TV main thread. The TV remains the source of truth, while a small static phone application served by that socket sends authenticated commands against revisioned state. The existing compatibility socket remains separate and loopback only.

**Tech Stack:** React 19, TypeScript, zustand, Vite, Vitest, Samsung Tizen WebAssembly sockets, vanilla HTML and JavaScript for the phone application, and `uqr` for local QR generation.

**Spec:** `docs/superpowers/specs/2026-10-01-phone-management-design.md`

## Global Constraints

- The production artifact must remain one build targeting ES2019 and Chromium 69 on the television.
- Manual first setup must remain fully functional when phone setup is unavailable.
- The management server must never expose repaired manifests, cached playlists, logos, arbitrary widget files, or filesystem paths.
- The management socket must remain separate from the loopback compatibility socket.
- Pairing works only on a private IPv4 address while OpenIPTV is running, using TCP port 8976.
- HTTP headers are limited to 8 KiB, request bodies are limited to 64 KiB, and the completed request cache holds the latest 64 identifiers.
- Every phone receives an independent remembered credential and can be revoked separately.
- Full application reset remains available only on the television.
- Playlist names, groups, languages, and content must remain uninterpreted.
- The phone application must use native controls and must not add a frontend framework.
- The QR implementation must have no transitive runtime dependencies, a compatible licence, and an entry in `public/THIRD-PARTY-NOTICES.md`.
- No analytics, hosted backend, cloud relay, account system, or external QR service may be introduced.
- Text added to the TV interface must be translated for every supported locale.

## Review Focus

- A request with a valid credential but stale revision must return conflict state without applying its command. Task 2 pins this behavior.
- A partial, oversized, or path traversal HTTP request must be rejected without keeping the client socket open. Task 3 pins this behavior.
- A duplicate request identifier after a lost response must return the first result without adding or removing a playlist twice. Task 2 pins this behavior.
- A television with no private address or unavailable socket bindings must preserve the complete manual onboarding flow. Task 5 pins this behavior.
- A revoked phone must lose access on its next request while other paired phones continue to work. Task 1 pins this behavior.

---

### Task 1: Pairing records and expiring sessions

**Files:**
- Create: `src/services/phoneAccess.ts`
- Test: `tests/phoneAccess.test.ts`

**Interfaces:**
- Produces: `PairedPhone`, `PairingSessionView`, `createPairingSession(now?: number): PairingSessionView`, `pairPhone(input: PairRequest, now?: number): Promise<PairResult>`, `authenticatePhone(id: string, credential: string, now?: number): Promise<boolean>`, `listPairedPhones(): PairedPhone[]`, `renamePairedPhone(id: string, name: string): boolean`, `revokePairedPhone(id: string): boolean`, `hasPairedPhones(): boolean`, and `clearPhoneAccess(): void`.
- Persists: Paired phone records under a dedicated `openiptv.phones` local storage key. Raw credentials are returned once to the phone and only SHA 256 verifiers are stored on the TV.

- [ ] **Step 1: Write failing pairing tests**

Add tests that assert a session exposes a six digit code and a high entropy secret, expires after five minutes, invalidates after successful use, rejects repeated bad code attempts, stores only a credential verifier, remembers multiple named phones, renames one record, revokes one phone without affecting another, rejects the revoked credential, and rejects malformed persisted records.

- [ ] **Step 2: Run the pairing tests and verify failure**

Run: `npm test -- tests/phoneAccess.test.ts`

Expected: FAIL because `src/services/phoneAccess.ts` does not exist.

- [ ] **Step 3: Implement the pairing store and session**

Use `crypto.getRandomValues` for the QR secret, phone identifier, and credential. Use `crypto.subtle.digest("SHA-256", ...)` for stored verifiers. Keep one active session in memory with a five minute expiry and five failed code attempts. Compare fixed length digest bytes without an early return.

- [ ] **Step 4: Run the pairing tests**

Run: `npm test -- tests/phoneAccess.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the pairing domain**

Commit: `feat(phone): add local pairing records`

### Task 2: Revisioned phone commands and snapshots

**Files:**
- Create: `src/services/phoneProtocol.ts`
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/channels.ts`
- Test: `tests/phoneProtocol.test.ts`
- Test: `tests/settings.test.ts`
- Test: `tests/channels.test.ts`

**Interfaces:**
- Consumes: Pairing operations from Task 1.
- Produces: `PhoneSnapshot`, `PhoneCommand`, `phoneSnapshot(): PhoneSnapshot`, `parsePhoneCommand(value: unknown): PhoneCommand | null`, and `applyPhoneCommand(request: CommandRequest): Promise<CommandResult>`.
- Adds store operations: `replacePlaylists(playlists: Playlist[], activePlaylistId: string): void` for atomic first setup and `validatePlaylist(name: string, url: string): Promise<LoadResult>` for validating before persistence.

- [ ] **Step 1: Write failing command tests**

Test every allowlisted preference and playlist command. Assert that unknown fields and commands are rejected, stale revisions return the current snapshot, duplicate request identifiers return the first result, active playlist removal selects the first remaining playlist, first setup persists only after a nonempty playlist validates, failed validation leaves settings unchanged, compatibility shutdown and alphabetical reload side effects run, and cache clearing requires its explicit command.

- [ ] **Step 2: Run the command and affected store tests**

Run: `npm test -- tests/phoneProtocol.test.ts tests/settings.test.ts tests/channels.test.ts`

Expected: FAIL on missing protocol interfaces.

- [ ] **Step 3: Implement typed snapshots and commands**

Keep the revision and bounded completed request map in memory for the application session. Expose only ordinary settings, playlist metadata, paired phone metadata, translated phone labels, and operation status. Route each command through existing store operations or the new atomic operations so TV and phone changes share side effects.

- [ ] **Step 4: Run the command and affected store tests**

Run: `npm test -- tests/phoneProtocol.test.ts tests/settings.test.ts tests/channels.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the phone protocol**

Commit: `feat(phone): add revisioned management commands`

### Task 3: Dedicated private network HTTP socket

**Files:**
- Create: `wasm/management-socket.c`
- Create: `public/wasm/management-socket.js`
- Create: `public/wasm/management-socket.wasm`
- Create: `public/wasm/management-socket.worker.js`
- Modify: `scripts/wasm-check.mjs`
- Modify: `wasm/checksums.txt`
- Modify: `docs/testing.md`
- Test: `tests/managementWorker.test.ts`

**Interfaces:**
- Produces WebAssembly exports: `_start_server`, `_receive_request`, `_request_text`, `_send_response`, and `_stop_server`.
- Worker messages in: `{ type: "start", address: string, port: number }`, `{ type: "response", id: number, status: number, contentType: string, body: string }`, and `{ type: "stop" }`.
- Worker messages out: `{ type: "listening", address: string, port: number }`, `{ type: "request", id: number, method: string, path: string, headers: Record<string, string>, body: string }`, `{ type: "stopped" }`, and `{ type: "error", reason: string }`.

- [ ] **Step 1: Write failing worker contract tests**

Load the worker in a test harness with fake WebAssembly exports and host bindings. Assert queued startup, request parsing, static route allowlisting, API forwarding, unsupported method rejection, traversal rejection, header and body limits, response delivery, and graceful socket closure.

- [ ] **Step 2: Run the worker test and verify failure**

Run: `npm test -- tests/managementWorker.test.ts`

Expected: FAIL because the management worker does not exist.

- [ ] **Step 3: Implement the C request state machine**

Bind only the supplied private IPv4 address and fixed management port. Accept one client at a time, accumulate at most 8 KiB of headers and 64 KiB of body, return a complete raw request to the worker, send one bounded response, close the client, and close every descriptor during stop or error.

- [ ] **Step 4: Implement the worker boundary**

Bind Samsung socket host functions exactly as the compatibility worker does. Serve only `/`, `/phone.css`, and `/phone.js` from bundled strings loaded from the widget. Forward only `/api/v1/*` requests to the main thread. Reject every other path before it reaches application logic.

- [ ] **Step 5: Build the Samsung WebAssembly artifact**

Use the documented Samsung Emscripten fork and record the exact management build command in `docs/testing.md`. Generate the committed glue and module, then update `wasm/checksums.txt` through `npm run wasm:sums` after extending the checksum script for both modules.

- [ ] **Step 6: Run worker and artifact checks**

Run: `npm test -- tests/managementWorker.test.ts && npm run wasm:check`

Expected: PASS with both WebAssembly modules valid, all required exports present, and all requested host bindings supplied.

- [ ] **Step 7: Commit the management socket**

Commit: `feat(phone): add private network management socket`

### Task 4: Management server lifecycle and API routing

**Files:**
- Create: `src/services/phoneServer.ts`
- Create: `src/hooks/usePhoneManagement.ts`
- Modify: `src/services/player.ts`
- Modify: `src/App.tsx`
- Modify: `public/config.xml`
- Test: `tests/phoneServer.test.ts`
- Test: `tests/launch.test.tsx`

**Interfaces:**
- Consumes: Pairing from Task 1, protocol from Task 2, and worker messages from Task 3.
- Produces: `PhoneManagementState` with `status`, `address`, `port`, `pairing`, `connectedPhone`, and `error`. Produces `startPhoneManagement()`, `stopPhoneManagement()`, `openPairing()`, and `subscribePhoneManagement(listener)`.
- Hook: `usePhoneManagement(enabled: boolean): PhoneManagementState & { openPairing(): void }`.

- [ ] **Step 1: Write failing lifecycle and routing tests**

Test private IPv4 validation, Samsung IP discovery, no startup on desktop after onboarding, startup during first setup, startup for remembered phones, worker failure state, pair endpoint authentication, authenticated state reads, authenticated command routing, missing or revoked credentials, stale revision response, and stop acknowledgment before termination.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `npm test -- tests/phoneServer.test.ts tests/launch.test.tsx`

Expected: FAIL on missing server interfaces.

- [ ] **Step 3: Implement network discovery and lifecycle**

Extend the `window.webapis` type with the Samsung network API, request the public network privilege in `public/config.xml`, validate the returned address as private IPv4, and start one worker for the application lifecycle only when onboarding or remembered access requires it.

- [ ] **Step 4: Implement the versioned API router**

Route pairing, state, command, and status requests. Enforce method, content type, body size, credential, pairing session, and revision rules before invoking Task 1 or Task 2. Return JSON without CORS headers and include `Cache-Control: no-store` on API and phone responses.

- [ ] **Step 5: Run lifecycle tests and XML validation**

Run: `npm test -- tests/phoneServer.test.ts tests/launch.test.tsx && python3 -c "from xml.dom.minidom import parse; parse('public/config.xml')"`

Expected: PASS.

- [ ] **Step 6: Commit the server integration**

Commit: `feat(phone): connect local management server`

### Task 5: TV welcome screen and paired phone settings

**Files:**
- Modify: `src/components/Onboarding.tsx`
- Create: `src/components/PhoneSetup.tsx`
- Create: `src/components/settings/Phones.tsx`
- Modify: `src/components/Settings.tsx`
- Modify: `src/components/Icon.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/services/locale.ts`
- Modify: `src/locales/ar.ts`
- Modify: `src/locales/bn.ts`
- Modify: `src/locales/de.ts`
- Modify: `src/locales/es.ts`
- Modify: `src/locales/fr.ts`
- Modify: `src/locales/hi.ts`
- Modify: `src/locales/id.ts`
- Modify: `src/locales/it.ts`
- Modify: `src/locales/ja.ts`
- Modify: `src/locales/ko.ts`
- Modify: `src/locales/nl.ts`
- Modify: `src/locales/pt.ts`
- Modify: `src/locales/ru.ts`
- Modify: `src/locales/tr.ts`
- Modify: `src/locales/zh-CN.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `public/THIRD-PARTY-NOTICES.md`
- Test: `tests/onboarding-language.test.tsx`
- Test: `tests/phoneSetup.test.tsx`
- Test: `tests/settings-ui.test.tsx`
- Test: `tests/locale.test.ts`

**Interfaces:**
- Consumes: `PhoneManagementState`, pairing actions, and paired phone operations from earlier tasks.
- Produces: `PhoneSetup` for the approved QR panel and a Settings section for opening pairing, renaming phones, and revoking phones.

- [ ] **Step 1: Add `uqr` through npm**

Run: `npm add uqr@0.1.3`

Record its MIT notice manually in `public/THIRD-PARTY-NOTICES.md`.

- [ ] **Step 2: Write failing component and locale tests**

Assert the approved vertical split, unchanged manual fields and submit behavior, QR SVG and readable local address, six digit code, waiting and connected states, unavailable server guidance, right to left layout, remote focus staying on the manual side, paired phone listing, rename and revoke confirmation, and complete translations for every supported locale.

- [ ] **Step 3: Run component and locale tests and verify failure**

Run: `npm test -- tests/onboarding-language.test.tsx tests/phoneSetup.test.tsx tests/settings-ui.test.tsx tests/locale.test.ts`

Expected: FAIL on missing components and messages.

- [ ] **Step 4: Implement the approved welcome layout**

Keep the existing manual form and key handling on the left. Add the vertical divider and `PhoneSetup` on the right. Render the QR locally with `uqr`, preserve the TV safe area, and ensure the phone panel contains no focusable TV controls.

- [ ] **Step 5: Implement paired phone settings**

Add a Phone access section to Settings with local address, pairing action, remembered phone names, last used state, rename, and destructive revoke confirmation. Follow the existing Settings rail, focus, popup, and key guide patterns.

- [ ] **Step 6: Add translations and styles**

Add concise phone setup and access messages to English, Persian, and all locale catalogs. Add layout rules with the existing spacing and flex gap fallback conventions. Add no model specific branches.

- [ ] **Step 7: Run component and locale tests**

Run: `npm test -- tests/onboarding-language.test.tsx tests/phoneSetup.test.tsx tests/settings-ui.test.tsx tests/locale.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the TV interface**

Commit: `feat(phone): add QR setup to welcome screen`

### Task 6: Responsive phone management application

**Files:**
- Create: `public/phone/index.html`
- Create: `public/phone/phone.css`
- Create: `public/phone/phone.js`
- Test: `tests/phoneWeb.test.ts`

**Interfaces:**
- Consumes: `/api/v1/pair`, `/api/v1/state`, `/api/v1/command`, and `/api/v1/status` from Task 4.
- Stores: `{ phoneId, credential }` in browser local storage for the TV origin.

- [ ] **Step 1: Write failing phone interface tests**

Load the static application under jsdom with a mocked fetch implementation. Assert QR secret extraction from the fragment, manual code pairing, remembered authentication, language and direction updates, first playlist validation, settings rendering, playlist add and removal confirmation, stale revision refresh, unavailable TV guidance, revoked credential clearing, and destructive cache confirmation.

- [ ] **Step 2: Run the phone interface test and verify failure**

Run: `npm test -- tests/phoneWeb.test.ts`

Expected: FAIL because the phone application does not exist.

- [ ] **Step 3: Implement the first setup flow**

Create a responsive, accessible welcome page using native forms. Pair from the URL fragment or six digit code, collect language and the first playlist, keep entered values after validation errors, and show TV supplied operation status until channels load.

- [ ] **Step 4: Implement management sections**

Render Playlists, Appearance, Playback, General, and Paired phones from the authenticated snapshot. Send one typed command per save, include revision and request identifier, update from the returned snapshot, and refresh after conflicts.

- [ ] **Step 5: Implement connection and revocation handling**

Show retry guidance when OpenIPTV is unavailable. Clear the local credential and return to pairing after an unauthorised response. Confirm playlist removal and cache clearing before sending commands.

- [ ] **Step 6: Run the phone interface tests**

Run: `npm test -- tests/phoneWeb.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the phone application**

Commit: `feat(phone): add responsive management interface`

### Task 7: Project invariants and release documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/design.md`
- Modify: `docs/testing.md`
- Modify: `README.md`

**Interfaces:**
- Documents: The management socket exception, local network security boundary, first setup flow, phone access behavior, and on set verification procedure.

- [ ] **Step 1: Update the socket invariant**

Clarify that `services/repair` exclusively owns the loopback manifest socket, while `phoneServer` exclusively owns the separately built private network management socket. Preserve the rule that neither may open or control the other's socket.

- [ ] **Step 2: Document user behavior and limits**

Add the local phone setup and management flow to the README and design notes. State that OpenIPTV must be running, both devices must share a trusted local network, address changes require pairing again, and no cloud service or account is used.

- [ ] **Step 3: Document on set checks**

Add exact checks for wired and wireless address discovery, QR and code pairing, remembered reconnection, revocation, shutdown, first playlist loading, and CPU at rest.

- [ ] **Step 4: Inspect documentation changes**

Check rendered Markdown, links, spelling, commands, and examples. Run `git diff --check`.

Expected: PASS.

- [ ] **Step 5: Commit the documentation**

Commit: `docs: explain local phone management`

### Task 8: Complete verification and pull request preparation

**Files:**
- Review: Every file changed by Tasks 1 through 7.

**Interfaces:**
- Produces: A verified branch ready for review.

- [ ] **Step 1: Run changed file lint**

Run `npm run lint --` with every changed TypeScript, TSX, JavaScript, and test file.

Expected: PASS.

- [ ] **Step 2: Run the complete local pull request gate**

Run: `npm run check && npm run build && npm run wasm:check && python3 -c "from xml.dom.minidom import parse; parse('public/config.xml')"`

Expected: PASS.

- [ ] **Step 3: Run TV compatibility gates**

Run: `npm run tv:gap && npm run tv:engines`

Expected: PASS on the changed layout and both browser engines.

- [ ] **Step 4: Run the TV performance budget**

Run: `npm run tv:budget`

Expected: PASS. If it fails, inspect the reported machine load and compare the persistent worker cost against the unchanged baseline before changing code.

- [ ] **Step 5: Review the complete branch diff**

Run: `git diff origin/master...HEAD`, `git diff --check`, and `git status --short`. Check for secrets, playlist addresses, generated scratch files, missing notices, and unrelated changes.

Expected: Only approved feature, tests, generated WebAssembly artifacts, dependency metadata, and documentation remain.

- [ ] **Step 6: Commit final verification fixes if any**

Commit any required fixes with the smallest matching conventional commit message. Do not create an empty commit.
