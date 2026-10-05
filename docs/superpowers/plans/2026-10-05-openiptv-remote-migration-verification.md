# OpenIPTV Remote Management, Migration and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete subsystem 5 by exposing revision bound paged lineup management on the paired phone, routing television and phone changes through one lineup store, completing durable migrations, extending the television harness, documenting the finished product and running one final automated gate before push.

**Architecture:** `useLineup` remains the only owner of effective lineup state, lineup revisions and committed personalisation mutations. A focused protocol service validates page and mutation envelopes before the existing private network server delegates to that store, while the static phone application keeps only one bounded page and opaque cursors. Migration cleanup occurs only after durable IndexedDB commits, and deterministic simulator controls drive the completed playback, VOD and management journeys without adding a runtime dependency or hosted service.

**Tech Stack:** React 19, TypeScript, zustand, native IndexedDB, native Fetch and URL APIs, dependency free browser JavaScript, Vitest, Biome, Vite, Samsung AVPlay, hls.js and the existing CDP television harness.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`

## Global Constraints

- Implement subsystem 5 only, and assume the approved subsystem 1 through subsystem 4 interfaces described below exist before this plan begins.
- Add no runtime dependency, hosted service, analytics, cloud copy, external proxy, provider write operation or model year branch.
- Target ES2019 and Chromium 69 with one production artifact for every supported television.
- Keep provider credentials, stream addresses and embedded secrets out of identifiers, logs, diagnostics, remote snapshots, lineup pages and personalisation records.
- Preserve provider supplied names as text with `dir="auto"`, and never truncate provider strings in JavaScript.
- Keep remote state snapshots bounded. A snapshot may expose lineup readiness and revision values, but it must never contain a complete channel or category catalogue.
- Use a default lineup page size of 50 and a maximum page size of 100.
- Bind every page cursor to its playlist, revision, scope, category, query and hidden inclusion value.
- Increment the lineup revision after each committed personalisation mutation and after authoritative catalogue adoption changes management identifiers or availability. Preserve the revision for an identical refresh.
- Reject stale queries, stale cursors and stale mutations before returning a page or applying any part of a mutation.
- Keep the existing remote snapshot revision separate from each lineup revision.
- Keep custom channel numbers as positive safe integers, reject duplicates before persistence and use the subsystem 4 number index for dialling.
- Keep the personal category cap at 128.
- Keep lineup personalisation in the separate `openiptv-personal` IndexedDB database without least recently used eviction. Cache clearing must leave it intact.
- Perform no IndexedDB read, IndexedDB write, catalogue materialisation, provider request or layout read directly on a direction key path.
- Route phone mutations through subsystem 4 `useLineup.getState().applyLineupMutation`, which already owns the same validation, revision, rollback and durable record used by television management.
- Validate remote command type, length, identifier ownership and revision at the protocol boundary, then repeat ownership and invariant validation in the shared store.
- Write every test named in this plan during implementation, but do not run tests, lint, type checks, builds or television gates until Task 7.
- Record focused verification commands during Tasks 1 through 6 without executing them.
- Do not modify the committed WebAssembly binaries, socket C source, management worker, widget manifest or third party notices in this subsystem.
- Local task commits are part of the approved implementation. Every commit uses the required Devin generation and coauthor trailers. Do not push until Shayan explicitly asks after reviewing the final verification report.
- Do not push until Shayan explicitly asks after reviewing the final verification report.
- Task 7 is the only automated execution point in the full redesign and corresponds to master plan Task 7.

## Review Focus

- A television edit or authoritative refresh may occur while a phone holds page two, and the next phone query must return a conflict without combining old and new items. Task 1 adds this test.
- A phone may retry the same request after losing its response, and the protocol must return the first result without applying the shared store mutation or incrementing the revision twice. Task 2 adds this test.
- A malformed cursor, oversized search, unknown identifier, duplicate number or placement with two anchors must fail without changing in memory or durable state. Tasks 1 and 2 add these tests.
- An interrupted legacy migration or durable write failure must preserve legacy settings and the previous durable revision so the next launch can retry without losing viewer work. Task 4 adds this test.
- A large lineup with long bidirectional names, hidden items and unavailable references must remain paged, preserve exact text and expose the same effective result on television and phone. Tasks 1, 3 and 4 add these tests.

## Exact File Map

### Create

- `src/services/lineupProtocol.ts` will own strict remote lineup envelope parsing, bounded input validation and delegation to `useLineup`.
- `tests/lineupManagement.test.ts` will cover page projections, cursor binding and revision conflicts.
- `tests/lineupProtocol.test.ts` will cover protocol parsing, request idempotency, store delegation, sanitisation, response shapes and revision separation.
- `tests/lineupParity.test.ts` will apply the same operation sequence through the television path and phone path, then compare durable personalisation and paged results.
- `tests/migrations.test.ts` will seed every supported previous settings and personal state shape, malformed partial values and interrupted lineup migrations.

### Modify

- `src/stores/lineup.ts` will add revision bound page queries over the subsystem 4 management arrays without changing overlay, migration or persistence ownership.
- `src/services/remoteProtocol.ts` will publish the active bounded lineup summary beside the existing playlist and settings state.
- `src/services/remoteServer.ts` will add authenticated lineup query and mutation routes without changing socket ownership.
- `public/remote/remote.js` will add active playlist lineup navigation, bounded page state, editing flows, conflict recovery and anchor selection.
- `public/remote/remote.css` will add responsive lineup controls, item state styling and right to left layout rules.
- `src/services/locale.ts` will add English, Persian and shared message keys for phone lineup management.
- `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts` and `src/locales/zh-CN.ts` will translate the same new application labels.
- `tests/remoteProtocol.test.ts` will assert bounded lineup summaries and remote mutation delegation.
- `tests/remoteServer.test.ts` will assert authentication, strict route envelopes and HTTP status mapping for lineup requests.
- `tests/remoteWeb.test.ts` will cover phone paging, edits, conflict recovery, accessibility, long text and right to left behavior.
- `tests/settings.test.ts`, `tests/personal.test.ts`, `tests/lineupStore.test.ts`, `tests/channels.test.ts` and `tests/deviceAccess.test.ts` will extend the complete migration matrix across synchronous settings, compact personal state, durable lineups, concurrent adoption and authorised device migration.
- `src/components/PlaybackInfo.tsx` will expose the existing sanitised `RecoveryState.cause` as a stable diagnostics data attribute for the television harness.
- `scripts/tv/shim.js` will add deterministic AVPlay, seek, fault, Live window and document visibility controls for the harness.
- `scripts/tv/harness.mjs` will add completed redesign layout, parity and recovery journeys.
- `scripts/tv/sim.mjs` will add measured poster, playback and management journeys and verify every required journey ran.
- `scripts/present.mjs` will extend the local Xtream fixture with deterministic playback and provider resilience cases required by the completed journeys.
- `tests/playbackDeck.test.tsx` will assert the stable sanitised recovery cause diagnostic.
- `tests/harness.test.ts` will test the new fault control contract, fixture responses and authoritative journey registration.
- `README.md` will document completed viewer features and phone lineup management at product level.
- `AGENTS.md` will update the project map and final invariants for shared lineup state, revisions, migrations and fault fixtures.
- `docs/design.md` will document final screen ownership, phone paging, shared mutations, durable personalisation and migration behavior.
- `docs/testing.md` will document the fault controls, completed journeys, phone parity checks and real television acceptance procedure.

### Read and preserve

- `CONTRIBUTING.md` remains the authority for the final local gate.
- `public/wasm/management-socket.worker.js`, `wasm/checksums.txt` and `public/config.xml` remain unchanged, so this plan adds no conditional WebAssembly or XML command to the final gate.
- `docs/superpowers/plans/2026-10-05-openiptv-redesign-master.md` remains the authority for plan order and the single final automated gate.

## Assumed Subsystem Interfaces

Subsystem 4 exports the approved domain types from `src/services/lineup.ts` and the active lineup store from `src/stores/lineup.ts`. This plan consumes those exact names and does not duplicate materialisation, reconciliation, migration, idle persistence or rollback.

```ts
export interface ManagedChannel {
  ref: ChannelRef;
  providerName: string;
  providerNumber: number;
  effective: Channel;
  hidden: boolean;
  categoryKeys: string[];
}

export interface ManagedCategory {
  key: string;
  kind: "live" | "movie" | "series";
  providerName: string;
  name: string;
  hidden: boolean;
  personal: boolean;
  count: number;
}

export type UnavailableRecord =
  | { key: string; kind: "channel-override"; itemId: string; label: string; sourceFingerprint?: string }
  | { key: string; kind: "category-override"; itemId: string; label: string }
  | { key: string; kind: "personal-membership"; itemId: string; label: string; sourceFingerprint?: string; personalCategoryId: string }
  | { key: string; kind: "channel-placement" | "category-placement"; itemId: string; label: string; anchorId?: string };

export type LineupMutation =
  | { type: "order.mode"; mode: LineupOrderMode }
  | { type: "channel.rename"; channel: ChannelRef; name: string | null }
  | { type: "channel.number"; channel: ChannelRef; number: number | null }
  | { type: "channel.visibility"; channel: ChannelRef; hidden: boolean }
  | { type: "category.rename"; categoryKey: string; name: string | null }
  | { type: "category.visibility"; categoryKey: string; hidden: boolean }
  | { type: "categories.visibility"; categoryKeys: string[]; hidden: boolean }
  | { type: "category.place"; placement: OrderPlacement }
  | { type: "channel.place"; categoryKey: string; placement: OrderPlacement }
  | { type: "personal-category.create"; name: string }
  | { type: "personal-category.rename"; categoryId: string; name: string }
  | { type: "personal-category.delete"; categoryId: string }
  | { type: "personal-category.memberships"; channel: ChannelRef; categoryIds: string[] }
  | { type: "personal-category.place-channel"; categoryId: string; placement: OrderPlacement }
  | { type: "unavailable.remove"; key: string };

export type LineupMutationResult =
  | { ok: true; revision: number; affectedIds: string[] }
  | {
      ok: false;
      revision: number;
      reason: "conflict" | "invalid" | "duplicate-number" | "limit" | "unavailable" | "persistence";
    };
```

`useLineup` already exposes `playlistId`, `revision`, `durableRevision`, `orderMode`, `managedChannels`, `managedCategories`, `unavailable`, `applyLineupMutation(expectedRevision: number, mutation: LineupMutation): Promise<LineupMutationResult>`, `removePlaylistLineup(playlistId: string): Promise<void>` and `resetLineups(): Promise<void>`. It increments revision after a committed personalisation mutation or an authoritative identifier or availability change, and it preserves revision after an identical refresh.

`personalDisk` already exposes `readLineup(playlistId: string): Promise<unknown | null>`, `writeLineup(playlistId: string, value: unknown): Promise<void>`, `removeLineup(playlistId: string): Promise<void>`, `clearLineups(): Promise<void>` and `PersonalDiskError`. `src/services/lineup.ts` already exposes `StoredLineupV1 = { version: 1; revision: number; personalisation: LineupPersonalisation }` and `parseStoredLineup(value: unknown): StoredLineupV1`.

Subsystem 4 already owns `Playlist.hiddenCategories` and `sortAlphabetically` migration, `completeHiddenCategoryMigration(playlistId: string): void`, `completeOrderModeMigration(): void`, destructive cleanup and cache clearing separation. Task 4 verifies the complete migration matrix across subsystem 2 through subsystem 4 without creating another migration owner.

Subsystem 2 exposes `RecoveryState = { stage: RecoveryStage; cause: RecoveryCause | null; attempt: number; retryIn: number; statusVisible: boolean; fault: string | null }` through `PlaybackController.recovery`. `PlaybackInfo` already renders cause and attempt in the More drawer, and Task 5 adds only a stable credential free data attribute for deterministic harness assertions.

---

### Task 1: Revision Bound Lineup Pages

**Files:**
- Modify: `src/stores/lineup.ts`
- Create: `tests/lineupManagement.test.ts`

**Interfaces:**
- Consumes: subsystem 4 `managedChannels`, `managedCategories`, `unavailable`, `playlistId` and `revision` from `useLineup`.
- Produces: `LineupQuery`, `LineupPage<T>`, `LineupQueryResult<T>`, transport safe page item types and `LineupSummary` from `src/stores/lineup.ts`.
- Produces: `useLineup.getState().queryLineup(query: LineupQuery): LineupQueryResult` and `useLineup.getState().lineupSummary(): LineupSummary | null`.
- Preserves: subsystem 4 remains the only owner of revision changes, mutation validation, durable writes, rollback, reconciliation and effective materialisation.

Add these exact public contracts.

```ts
export type LineupScope = "channels" | "categories" | "personal-categories";

export type LineupQuery = {
  playlistId: string;
  revision: number;
  scope: LineupScope;
  categoryKey?: string;
  query?: string;
  includeHidden?: boolean;
  cursor?: string;
  limit?: number;
};

export type LineupChannelItem = {
  kind: "channel";
  id: string;
  name: string;
  providerName: string;
  number: number;
  providerNumber: number;
  hidden: boolean;
  categoryKeys: string[];
  personalCategoryIds: string[];
};

export type LineupCategoryItem = {
  kind: "category" | "personal-category";
  id: string;
  contentKind?: "live" | "movie" | "series";
  name: string;
  providerName: string;
  hidden: boolean;
  count: number;
  unavailableCount: number;
};

export type LineupUnavailableItem = {
  kind: "unavailable";
  key: string;
  recordKind: UnavailableRecord["kind"];
  itemId: string;
  label: string;
  personalCategoryId?: string;
};

export type LineupPageItem = LineupChannelItem | LineupCategoryItem | LineupUnavailableItem;

export type LineupPage<T> = {
  revision: number;
  items: T[];
  nextCursor: string | null;
  total: number;
};

export type LineupQueryResult<T extends LineupPageItem = LineupPageItem> =
  | { ok: true; page: LineupPage<T> }
  | { ok: false; reason: "conflict" | "invalid" | "notFound"; revision: number };

export type LineupSummary = {
  playlistId: string;
  revision: number;
  ready: boolean;
};
```

- [ ] **Step 1: Write the failing page projection tests**

Add tests named `returns fifty items by default and never more than one hundred`, `projects effective channels without source fingerprints or addresses`, `separates provider and personal category scopes`, `filters a channel page by provider or personal category`, `filters hidden items unless includeHidden is true`, `searches effective names while preserving exact returned text` and `pages unavailable personalised references honestly`.

The first page test must seed 151 channels, assert 50 returned identifiers, assert `total === 151`, follow both cursors, and assert the three pages contain each identifier exactly once. Requesting 101 must return `invalid` rather than silently coercing the limit.

- [ ] **Step 2: Write the failing revision and cursor tests**

Add tests named `binds the cursor to the complete query and revision`, `rejects a stale revision before returning page one`, `rejects a stale cursor before returning a later page`, `rejects a cursor from another scope or search`, `rejects a malformed cursor without throwing`, `conflicts after a television mutation`, `conflicts after authoritative availability changes` and `keeps a cursor valid after an identical authoritative refresh`.

- [ ] **Step 3: Implement transport safe page projections**

Map `ManagedChannel.ref.id` and effective display values into `LineupChannelItem`, derive personal category ids from the current personalisation, and exclude every source fingerprint and playback address. Map provider and personal `ManagedCategory` records into their separate item kinds. Add unavailable records to the scope that owns them with only their opaque key, type, label and identifiers.

For channel scope, a provider category key or personal category id limits results to that category membership, while an absent category returns the complete effective channel management list. Normalise an absent search to an empty string, use the existing locale aware comparison, apply hidden inclusion and slice only the requested page.

- [ ] **Step 4: Implement opaque revision bound cursors**

Encode the revision, next index and a query identity containing playlist id, scope, category key, query and hidden inclusion. Treat the cursor as opaque outside `src/stores/lineup.ts`. Reject a decode failure, mismatched identity, invalid index or stale revision before reading page items.

Return `notFound` when the requested playlist is not the active adopted lineup. `lineupSummary()` returns null until adoption and one small active playlist record afterwards, which lets the phone activate another playlist through the existing command before querying it.

- [ ] **Step 5: Review the Task 1 diff manually**

Trace provider categories, personal categories, current channels and each unavailable record class into a page. Confirm that no page contains a source fingerprint, playback address, provider credential or unbounded catalogue array, and confirm that no query changes store state.

- [ ] **Step 6: Record the deferred focused command without running it**

Deferred command: `npm test -- tests/lineupManagement.test.ts`

Expected during Task 7: all page projection, limit, cursor and revision tests pass.

- [ ] **Step 7: Commit Task 1 after manual review**

```bash
git add src/stores/lineup.ts tests/lineupManagement.test.ts
git commit -m "feat: add revisioned lineup pages"
```

### Task 2: Authenticated Lineup Protocol and Shared Store Mutations

**Files:**
- Create: `src/services/lineupProtocol.ts`
- Modify: `src/services/remoteProtocol.ts`
- Modify: `src/services/remoteServer.ts`
- Create: `tests/lineupProtocol.test.ts`
- Create: `tests/lineupParity.test.ts`
- Modify: `tests/remoteProtocol.test.ts`
- Modify: `tests/remoteServer.test.ts`

**Interfaces:**
- Consumes: Task 1 query types and subsystem 4 `LineupMutation`, `LineupMutationResult` and `applyLineupMutation`.
- Produces: `RemoteLineupMutation`, `LineupMutationRequest`, `parseLineupQuery(value: unknown): LineupQuery | null`, `parseLineupMutationRequest(value: unknown): LineupMutationRequest | null`, `queryRemoteLineup(value: unknown): LineupQueryResult` and `mutateRemoteLineup(value: unknown): Promise<LineupMutationResult>`.
- Produces: authenticated `POST /api/v1/lineup/query` and `POST /api/v1/lineup/mutation` routes.
- Updates: `RemoteSnapshot.lineup: LineupSummary | null` without placing page items in the snapshot.
- Preserves: `RemoteSnapshot.revision` continues to serialise ordinary settings commands only, while lineup queries and mutations use `useLineup.revision`.

Add this remote envelope around the existing domain mutations.

```ts
export type RemoteLineupMutation =
  | { type: "order.mode"; mode: LineupOrderMode }
  | { type: "channel.rename"; channelId: string; name: string | null }
  | { type: "channel.number"; channelId: string; number: number | null }
  | { type: "channel.visibility"; channelId: string; hidden: boolean }
  | { type: "category.rename"; categoryKey: string; name: string | null }
  | { type: "category.visibility"; categoryKey: string; hidden: boolean }
  | { type: "categories.visibility"; contentKind: "live" | "movie" | "series"; hidden: boolean }
  | { type: "category.place"; placement: OrderPlacement }
  | { type: "channel.place"; categoryKey: string; placement: OrderPlacement }
  | { type: "personal-category.create"; name: string }
  | { type: "personal-category.rename"; categoryId: string; name: string }
  | { type: "personal-category.delete"; categoryId: string }
  | { type: "personal-category.memberships"; channelId: string; categoryIds: string[] }
  | { type: "personal-category.place-channel"; categoryId: string; placement: OrderPlacement }
  | { type: "unavailable.remove"; key: string };

export type LineupMutationRequest = {
  id: string;
  playlistId: string;
  revision: number;
  mutation: RemoteLineupMutation;
};
```

- [ ] **Step 1: Write failing strict parser tests**

Add table driven tests for every `LineupScope` and every `RemoteLineupMutation` variant. Assert acceptance of exact valid envelopes, then assert rejection for extra keys, missing keys, a request id over 128 Unicode code points, an identifier over 512 Unicode code points, a search query over 200 Unicode code points, a cursor over 2,048 ASCII characters, a limit below 1 or above 100, a noninteger revision, a zero or unsafe channel number, an empty custom name, more than 128 personal category ids and a placement containing both anchors.

Use Unicode code point counts for viewer entered names and queries. Validation rejects oversized values instead of cutting them.

- [ ] **Step 2: Write failing idempotency, delegation and parity tests**

Add tests named `returns the first result for a repeated request id`, `does not claim an id for a malformed request`, `maps a current channel id to its complete ChannelRef`, `rejects an identifier outside the active lineup`, `delegates duplicate number and limit results unchanged`, `keeps global and lineup revisions independent`, and `returns persistence failure without a success snapshot`.

In `tests/lineupParity.test.ts`, seed the same authoritative lineup twice. Apply rename, number, hide, order mode, channel placement, category placement, personal category creation, membership replacement, member placement and unavailable removal once through subsystem 4 `applyLineupMutation` as the television path and once through `mutateRemoteLineup` as the phone path. Assert identical `StoredLineupV1`, revision, effective channels, effective categories, number index and Task 1 page results.

- [ ] **Step 3: Write failing boundary and route tests**

Add tests named `keeps complete catalogues out of remote snapshots`, `publishes the active lineup readiness and revision`, `requires authentication for both lineup routes`, `rejects non JSON and unknown envelope fields`, `maps conflict to HTTP 409`, `maps unavailable to HTTP 404`, `maps invalid duplicate number and limit to HTTP 400`, `maps persistence to HTTP 500`, and `returns no provider credentials, addresses or fingerprints`.

Fetch page one, commit a television mutation directly through `applyLineupMutation`, then request page two with the old cursor. Assert HTTP 409 and the current lineup revision with no `items` property.

- [ ] **Step 4: Implement `lineupProtocol.ts` as the trust boundary**

Keep record, exact key, text and code point helpers local to this file. Parse each union variant explicitly, require `playlistId` to equal the active adopted `useLineup.playlistId`, resolve each current channel id to the complete matching `ManagedChannel.ref`, and map bulk content kind visibility to the current provider category keys. Delegate the resulting domain value to `queryLineup` or `applyLineupMutation`. The store performs current ownership, fingerprint reseating, number uniqueness, placement, category cap, persistence and rollback validation.

Keep at most 64 completed mutation results by request identifier, matching the bounded ordinary remote command behavior. Return the stored first result before revision evaluation on a retry, and never cache a result for an envelope that failed shape validation.

- [ ] **Step 5: Add the bounded active lineup summary to ordinary state**

Add `lineup` to `RemoteSnapshot` from `useLineup.getState().lineupSummary()`. Confirm that serialising a snapshot after a 12,000 channel adoption changes snapshot size only by one summary and that activating another playlist replaces this summary after adoption.

- [ ] **Step 6: Add authenticated server routes**

Handle the two exact paths before the existing 404 result. Require JSON POST and paired device authentication, parse the body once, and map result reasons to the statuses above. Keep the 64 KiB request body limit and existing worker lifecycle unchanged.

- [ ] **Step 7: Review the Task 2 diff manually**

Trace an unauthorised query, malformed mutation, repeated request, successful mutation, stale mutation, duplicate number and durable failure. Confirm that the protocol contains no second overlay implementation and every accepted mutation ends in subsystem 4 `applyLineupMutation`.

- [ ] **Step 8: Record the deferred focused command without running it**

Deferred command: `npm test -- tests/lineupProtocol.test.ts tests/lineupParity.test.ts tests/remoteProtocol.test.ts tests/remoteServer.test.ts`

Expected during Task 7: all parsing, idempotency, parity, security, routing and revision separation tests pass.

- [ ] **Step 9: Commit Task 2 after manual review**

```bash
git add src/services/lineupProtocol.ts src/services/remoteProtocol.ts src/services/remoteServer.ts tests/lineupProtocol.test.ts tests/lineupParity.test.ts tests/remoteProtocol.test.ts tests/remoteServer.test.ts
git commit -m "feat: expose paged lineup management"
```

### Task 3: Paired Phone Lineup Management

**Files:**
- Modify: `public/remote/remote.js`
- Modify: `public/remote/remote.css`
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
- Modify: `tests/remoteWeb.test.ts`

**Interfaces:**
- Consumes: Task 2 state summaries, query route and mutation route.
- Produces in `public/remote/remote.js`: `renderLineup()`, `bindLineup()`, `loadLineupPage(append: boolean)`, `sendLineupMutation(mutation: object, source: HTMLElement | null)` and `openLineupAnchorPicker(itemId: string, placement: "before" | "after")`.
- Produces: one active playlist Lineup tab with Channels, Categories and Personal categories scopes, page search, hidden inclusion, bounded load more and regional loading, empty, failure and conflict states.
- Preserves: the static phone application remains dependency free and keeps one current page plus an explicitly appended bounded page list in memory.

- [ ] **Step 1: Write failing phone page and conflict tests**

Extend the remote web snapshot fixture with `lineup`. Add tests named `migrates the previous phone credential key`, `loads only the first fifty lineup items`, `appends a second page through the opaque cursor`, `changes scope without carrying the old cursor`, `debounces search and resets to page one`, `includes hidden items only after the reveal control changes`, `refetches page one after a stale page conflict`, `refetches the current query after a successful mutation`, and `never renders a complete catalogue from the state snapshot`.

Assert the exact `/api/v1/lineup/query` request bodies and verify that one page response cannot be appended when its revision differs from the held page.

- [ ] **Step 2: Write failing operation coverage tests**

Add phone tests for restoring and setting a channel name, restoring and setting a channel number, hiding and showing a channel, renaming and hiding a provider category, hiding and showing all categories in one content kind, choosing each order mode, moving a channel or category before and after a selected anchor, creating, renaming and removing a personal category, adding and removing membership, arranging personal membership and removing each unavailable reference type.

Each test must assert the exact `LineupMutationRequest`, including current lineup revision and a fresh request identifier. Repeat one response with the same identifier and assert the phone does not duplicate the optimistic message or item.

- [ ] **Step 3: Write failing accessibility, text and right to left tests**

Render long Arabic, Persian, emoji, combining mark and bidirectional channel and category names. Assert `dir="auto"` on provider and viewer entered names, exact uncut `textContent`, visible labels for hidden and unavailable state, accessible names for icon actions, logical placement controls under `dir="rtl"`, focus restoration after save, and form values retained after a failed mutation.

- [ ] **Step 4: Add bounded lineup page state**

Add one `lineup` state object beside the existing phone state with active playlist id, revision, scope, category key, query, hidden inclusion, items, next cursor, total, loading, error, editor and anchor picker. Keep at most 100 rendered items after append, because the phone never needs more than two default pages in memory. Loading a later page replaces the oldest loaded page when the bound would be exceeded.

Use the active playlist from `RemoteSnapshot.activePlaylistId`. When the viewer chooses another playlist, reuse the existing activation command, wait for its ordinary load to complete, then start the lineup query at the revision in the returned summary. Show a regional unavailable message when the active lineup summary is not ready.

- [ ] **Step 5: Render the Lineup tab and scope navigation**

Place Lineup after Playlists in the phone navigation. Render a playlist selector, order mode control, search input, reveal hidden switch, scope controls, one bulk show or hide action per content kind, result count, one semantic list, one regional status and a Load more button only when `nextCursor` exists.

Channels show effective name, effective number, hidden state and unavailable state. Provider categories show effective name, count, hidden state and unavailable state. Personal categories show name, member count and unavailable count. Keep provider values available inside the editor so a Restore provider value action can send null.

- [ ] **Step 6: Implement editors and anchor selection**

Use the existing item menu and sheet patterns for compact row actions. Keep rename and number forms open on a failed response. Use one paged anchor picker backed by the current scope query, which lets a viewer move an item before or after any searchable surviving anchor without loading the full catalogue.

Opening a personal category shows its current members through a channel query scoped to that category. Add channels opens the global channel search with the target personal category retained, and each result uses `personalCategoryIds` to expose Add or Remove. Send the complete next category id list through `personal-category.memberships`. Membership ordering uses the same anchor picker within that personal category.

- [ ] **Step 7: Implement mutation conflict recovery**

Send lineup mutations to `/api/v1/lineup/mutation` without the global snapshot revision. On success, replace the held lineup revision, discard loaded cursors and refetch the current query. On HTTP 409, show the translated conflict message, update to the returned revision and refetch page one without resubmitting the mutation. On failure, retain form input and return focus to the action that opened it.

- [ ] **Step 8: Add translated labels and responsive styling**

Reuse subsystem 4 `lineup.*` message keys wherever the television and phone action is identical. Add only missing `remote.lineup*` keys for phone navigation, bounded page reporting, activation, conflict and unavailable state, then translate those keys in every locale file listed above.

Add `.lineup-toolbar`, `.lineup-scopes`, `.lineup-list`, `.lineup-row`, `.lineup-state`, `.lineup-editor`, `.lineup-anchor-picker` and `.lineup-pagination` rules. Preserve 44 pixel minimum touch targets, phone safe area insets, visible focus, hidden and unavailable indicators that do not rely on colour, reduced motion behavior and logical inline alignment under right to left direction.

- [ ] **Step 9: Review the Task 3 diff manually**

Walk every phone operation from the active playlist summary through a query or mutation and back to a bounded page. Confirm that every provider value uses escaped text, every form has a label, every icon action has an accessible name and no response or DOM text contains credentials or stream addresses.

- [ ] **Step 10: Record the deferred focused command without running it**

Deferred command: `npm test -- tests/remoteWeb.test.ts tests/locale.test.ts`

Expected during Task 7: all phone behavior, accessibility, translation, paging and conflict tests pass.

- [ ] **Step 11: Commit Task 3 after manual review**

```bash
git add public/remote/remote.js public/remote/remote.css src/services/locale.ts src/locales/ar.ts src/locales/bn.ts src/locales/de.ts src/locales/es.ts src/locales/fr.ts src/locales/hi.ts src/locales/id.ts src/locales/it.ts src/locales/ja.ts src/locales/ko.ts src/locales/nl.ts src/locales/pt.ts src/locales/ru.ts src/locales/tr.ts src/locales/zh-CN.ts tests/remoteWeb.test.ts
git commit -m "feat: add phone lineup management"
```

### Task 4: Complete Migration Matrix and Lifecycle Acceptance

**Files:**
- Create: `tests/migrations.test.ts`
- Modify: `tests/settings.test.ts`
- Modify: `tests/personal.test.ts`
- Modify: `tests/lineupStore.test.ts`
- Modify: `tests/channels.test.ts`
- Modify: `tests/deviceAccess.test.ts`

**Interfaces:**
- Consumes: subsystem 2 `LegacyPlaybackProgress` migration, subsystem 3 resolved progress migration and subsystem 4 `parseStoredLineup`, completion markers, concurrent adoption and destructive cleanup.
- Produces: one integration matrix that proves every supported previous local storage and IndexedDB shape reaches the final schema exactly once.
- Preserves: subsystem 3 and subsystem 4 remain the migration owners. This task adds no second migration service, saved format or cleanup path.

- [ ] **Step 1: Write the complete previous state matrix**

In `tests/migrations.test.ts`, seed a new install, removed `fontId` and `panelTimeout` values, legacy playlist `url`, typed M3U and Xtream sources, top level `sortAlphabetically` true and false, absent order input, valid and malformed `hiddenCategories`, both hidden content modes, ordinary legacy favourites and last channel, unscoped Xtream identifiers, legacy finite progress order, resolved progress, the previous authorised phone key, a valid `StoredLineupV1`, a partial version 1 record, unknown saved fields, malformed personalisation and every interrupted completion marker combination.

Assert the final typed playlist source, compact personal record, bounded progress, lineup order mode, hidden category overlays, retained unavailable records and known fields only. Assert that no migrated record contains credentials or stream addresses.

- [ ] **Step 2: Write interrupted and idempotent migration tests**

Add tests named `keeps legacy order until every playlist record commits`, `keeps hidden categories until their playlist record commits`, `retries a failed lineup write without duplicate work`, `does not replace newer version one personalisation with legacy values`, `preserves legacy progress order under one captured base time`, `resolves movies from the complete index`, `resolves episodes only from their authoritative series detail`, and `makes no durable change on a second completed launch`.

Use controllable personal disk promises to cover catalogue first, personal record first, write rejection, successful retry and a stale migration result after active playlist change.

- [ ] **Step 3: Write final lifecycle and first paint tests**

Add tests named `publishes the first effective lineup only after cache and personal data resolve`, `removes only the deleted playlist personal state`, `clears server username and source kind replacements`, `preserves password output and M3U address refreshes`, `clears every personal store on reset`, and `keeps every personal store on cache clear`.

Assert that television and existing remote playlist callers retain their confirmation or edit draft after cleanup failure, and assert that no provider order frame appears before saved custom order.

- [ ] **Step 4: Cross check the migration readers against their owning plans**

Map each matrix row to `settings.load`, compact personal state validation, progress resolution, `parseStoredLineup`, `prepareLineup`, `adoptCatalogue`, `completeHiddenCategoryMigration` or `completeOrderModeMigration`. Remove any duplicate fixture already covered in an owning test only when the integration matrix still crosses the store boundary.

- [ ] **Step 5: Review the Task 4 diff manually**

Trace each previous shape through one successful launch, one interrupted launch and a repeated launch. Confirm that this task changes tests only, exercises the production migration owners from earlier subsystems and leaves cache clearing separate from personal data clearing.

- [ ] **Step 6: Record the deferred focused command without running it**

Deferred command: `npm test -- tests/migrations.test.ts tests/settings.test.ts tests/personal.test.ts tests/lineupStore.test.ts tests/channels.test.ts tests/deviceAccess.test.ts`

Expected during Task 7: every previous shape, malformed value, interrupted migration, concurrent launch and lifecycle acceptance test passes.

- [ ] **Step 7: Commit Task 4 after manual review**

```bash
git add tests/migrations.test.ts tests/settings.test.ts tests/personal.test.ts tests/lineupStore.test.ts tests/channels.test.ts tests/deviceAccess.test.ts
git commit -m "test: cover completed state migrations"
```

### Task 5: Deterministic Fault Fixtures and Completed Television Journeys

**Files:**
- Modify: `src/components/PlaybackInfo.tsx`
- Modify: `scripts/tv/shim.js`
- Modify: `scripts/tv/harness.mjs`
- Modify: `scripts/tv/sim.mjs`
- Modify: `scripts/present.mjs`
- Modify: `tests/playbackDeck.test.tsx`
- Modify: `tests/harness.test.ts`

**Interfaces:**
- Consumes: subsystem 2 `PlaybackController.recovery`, subsystem 3 VOD surfaces, subsystem 4 television management and the completed application selectors.
- Produces: `window.__openiptvTvFaults` in the simulator document.
- Produces from `scripts/tv/harness.mjs`: `REDESIGN_JOURNEYS` and `createJourneyTracker(required: readonly string[])`.
- Preserves: the ordinary shim continues to drive real hls.js or native media behavior until a harness explicitly enables controlled playback.

Add this exact simulator control surface.

```ts
type SeekOutcome = "complete" | "omit-callback" | "reject";

type TvFaultSnapshot = {
  controlled: boolean;
  connections: number;
  seeks: number[];
  buffering: boolean;
  frozen: boolean;
  liveWindow: [number, number] | null;
  lastFault: string;
  hidden: boolean;
};

type TvFaultControls = {
  reset(): void;
  useControlledPlayback(): void;
  completePrepare(): void;
  startBuffering(): void;
  endBuffering(): void;
  freezePlayhead(): void;
  resumePlayhead(): void;
  nextSeek(outcome: SeekOutcome): void;
  emitNetworkFault(): void;
  emitMediaFault(): void;
  setLiveWindow(startMilliseconds: number, endMilliseconds: number): void;
  setHidden(hidden: boolean): void;
  snapshot(): TvFaultSnapshot;
};
```

Use these exact authoritative journey keys.

```js
export const REDESIGN_JOURNEYS = Object.freeze({
  vodColdPosterWalk: "VOD cold poster walk",
  vodWarmPosterWalk: "VOD warm poster walk",
  vodCategoryRestore: "VOD category restore",
  vodSearchReturn: "VOD search return",
  movieAndSeriesDetails: "Movie and Series details",
  episodeResume: "Episode resume",
  favouriteRoundTrip: "Favourite round trip",
  playbackDeckAndDrawers: "Playback deck and drawers",
  quickSeekPlayingAndPaused: "Quick seek playing and paused",
  liveDvrAndGoLive: "Live DVR and Go live",
  recoverySequence: "Sequential recovery",
  recoveryCancellation: "Recovery cancellation",
  televisionLineupManagement: "Television lineup management",
  pointerAndWheelParity: "Pointer and wheel parity",
  rightToLeftNavigation: "Right to left navigation",
  providerResilience: "Provider data resilience",
  managementBudget: "Management interaction budget",
  posterBudget: "Poster interaction budget",
});
```

- [ ] **Step 1: Write failing controlled shim tests**

Extend `tests/harness.test.ts` to execute the shim with controlled playback and assert each method above. Verify prepare completion, buffering start and end callbacks, a frozen playhead, resumed advancement, completed seek callback, omitted seek callback, rejected seek callback, network and media error names, Live window property output, visibility change dispatch and exact connection counts.

Assert `reset()` removes every injected state and returns ordinary shim behavior for the next journey.

- [ ] **Step 2: Write failing fixture and journey registration tests**

Extend the Xtream fixture tests with finite duration media, Live with DVR, Live without DVR, multiple audio tracks, embedded subtitle cues, malformed ratings, missing art, long bidirectional names, emoji names, empty categories and deterministic network failure routes. Keep fixture responses free of the fixture username and password.

Replace the Xtream only tracker assertion with a test that every `REDESIGN_JOURNEYS` key is wired into `walk`, `sim` or both as assigned. Fail when a journey label is renamed, skipped or reported without reaching its asserted screen.

- [ ] **Step 3: Implement opt in fault controls in the AVPlay shim**

Count a provider connection when controlled `open` begins a new target. In controlled mode, hold `prepareAsync` until `completePrepare`, make `getCurrentTime` advance from a monotonic harness clock unless frozen, make `GET_LIVE_DURATION` return the injected pair, and apply the configured result to the next `seekTo(milliseconds, success, failure)` call.

Dispatch the same AVPlay listener callbacks the production player receives. Network faults use the connection failure code expected by subsystem 2. Media faults use the terminal unsupported media code. `setHidden` overrides the test document visibility values and dispatches `visibilitychange` without changing ordinary browser behavior after reset.

- [ ] **Step 4: Expose and test the existing recovery cause for the harness**

Add `data-recovery-cause={recovery.cause ?? ""}` to the recovery diagnostics container in `PlaybackInfo`. Extend `tests/playbackDeck.test.tsx` to assert the exact internal value, visible translated explanation and absence of target addresses or provider content.

- [ ] **Step 5: Add recovery fault journeys with exact assertions**

Add journeys that keep reported buffering within its limit with cause `reported-buffer` and one provider connection, freeze a playhead until cause `frozen-playhead` and one reopen, omit a seek callback and assert no recovery cause or reopen, reject a seek and assert no recovery cause or reopen, emit a recoverable network fault and assert cause `engine-network` plus one sequential reopen, emit a terminal media fault and assert cause `engine-media` with no retry, move the Live window across a pending target, and hide then restore the document around a scheduled reconnect to assert `visibility-restore` and no connection while hidden.

Every fault journey must open More, read `[data-recovery-cause]`, assert `window.__openiptvTvFaults.snapshot().connections`, close the drawer to its exact origin and reset the controls before the next journey.

- [ ] **Step 6: Expand the parity walk across completed surfaces**

Update `walk` to visit the shared header, Live browser, Movies root, Series root, VOD search, movie details, series details, open episode panel, playback deck, Guide, Audio, Subtitles, More, television Channels management, television Categories management, personal category management, confirmation popup, right to left layout and provider resilience fixture states.

Each transition must wait on a selector or state assertion rather than a fixed sleep. Each captured screen must contain measured boxes, and each Back action must assert its exact origin surface before proceeding.

- [ ] **Step 7: Add measured VOD and management journeys**

Update `sim.mjs` to measure cold and warm held poster movement, mode and category restoration, search return, details and episode navigation, television lineup management and the final bounded heap. Keep direct cursor arithmetic and input delivery assertions. Add budget labels only after the journey reaches its asserted state, and retain the existing machine load warning as part of verdict interpretation.

- [ ] **Step 8: Add pointer, wheel and right to left parity**

Drive pointer click and accepted wheel gestures across poster grid, details, seasons and episodes. Assert one item per accepted gesture and the 120 millisecond guard. Repeat header, rail, grid, details, season and episode movement under right to left direction, then assert logical previous, next, back and forward meaning.

- [ ] **Step 9: Review the Task 5 diff manually**

Trace every control from the harness call through the shim callback and production response. Confirm that controls are absent from the packaged runtime unless the simulator shim is injected, every journey proves its start and end state, and no fixture response or diagnostic contains credentials or stream addresses.

- [ ] **Step 10: Record the deferred focused command without running it**

Deferred command: `npm test -- tests/playbackDeck.test.tsx tests/harness.test.ts`

Deferred television commands: `npm run build`, `npm run tv:gap`, `npm run tv:engines` and `npm run tv:budget`.

Expected during Task 7: the harness contract tests pass, every parity journey completes on supported engines, and the performance gate reports a valid quiet machine result within budget.

- [ ] **Step 11: Commit Task 5 after manual review**

```bash
git add src/components/PlaybackInfo.tsx scripts/tv/shim.js scripts/tv/harness.mjs scripts/tv/sim.mjs scripts/present.mjs tests/playbackDeck.test.tsx tests/harness.test.ts
git commit -m "test: expand television acceptance journeys"
```

### Task 6: Complete Product, Design and Verification Documentation

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/design.md`
- Modify: `docs/testing.md`

**Interfaces:**
- Consumes: the completed behavior and exact final commands from Tasks 1 through 5.
- Produces: viewer guidance in `README.md`, implementation invariants in `AGENTS.md` and `docs/design.md`, and reproducible verification guidance in `docs/testing.md`.
- Preserves: `README.md` stays focused on repository visitors and viewers, while implementation timing, revision, persistence and harness details stay in engineering documentation.

- [ ] **Step 1: Update the README viewer path**

Describe Live, Movies and Series, seeking, deck and drawers, audio and subtitles, Continue watching, favourites, full phone lineup management and the trusted local network boundary. Explain that paired phone lineup management operates on bounded pages and can rename, number, hide, order and group channels without changing provider playlists.

Update the remote button reference to the approved mode specific meanings, including finite Left and Right quick seeking, Live Right opening the deck, mode specific Up and Down, semantic transport keys and Back removing one visible depth. Remove old wording that claims Up and Down always change a channel outside the Live picture.

- [ ] **Step 2: Update repository invariants and the project map**

Add `src/stores/lineup.ts` and `src/services/personalDisk.ts` to the map. Record that effective values are materialised once, the number index serves dialling, phone snapshots never contain complete catalogues, page cursors are revision bound, both management surfaces use one mutation entry point, personalisation survives cache clearing and legacy fields disappear only after a durable commit.

Update the key model invariant to the final mode specific laws and document the simulator fault controls as test infrastructure rather than a production capability.

- [ ] **Step 3: Update design notes**

Document the final screen stack, mode ownership, shared playback deck, VOD navigation, lineup personalisation overlay, reconciliation, provider recovery, personal database and phone management flow. Include the default 50 and maximum 100 page sizes, separate snapshot and lineup revisions, stale conflict behavior, request idempotency and rollback after transaction failure.

Keep provider and viewer data examples free of addresses and credentials. Keep each Markdown paragraph and list item on one physical line.

- [ ] **Step 4: Update testing and hardware acceptance notes**

Document `window.__openiptvTvFaults`, each fault method, every redesign journey and the connection count assertion rule. Add phone parity steps for rename, number, hide, category order, personal category membership, conflict recovery and durable restart.

Replace the old real television acceptance subsection with the complete required set: HLS Live with DVR, HLS Live without DVR, MPEG TS Live, one movie, one episode, one catchup item, multiple audio tracks, embedded subtitles, reported rebuffer recovery, frozen playhead recovery, a large poster catalogue, television lineup management and the same phone mutations. Require model, Tizen version, source kind, output format, tested content and unavailable provider features in the report.

- [ ] **Step 5: Review documentation against the implemented product**

Follow every README path in the built product design, compare every design interface name with source, compare every testing command with `package.json`, and confirm that `scripts/tv/platforms.json` remains the only engine matrix.

- [ ] **Step 6: Record documentation verification without running application commands**

Inspect rendered Markdown, internal links, headings, tables, spelling, command names and one line paragraph formatting. Defer application checks to Task 7.

- [ ] **Step 7: Commit Task 6 after manual review**

```bash
git add README.md AGENTS.md docs/design.md docs/testing.md
git commit -m "docs: document remote management and acceptance"
```

### Task 7: Whole Branch Review, Final Gate and Acceptance

**Files:**
- Review: every changed file in the complete branch diff.
- Review: `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`.
- Review: `docs/superpowers/plans/2026-10-05-openiptv-redesign-master.md` and all five subsystem plans.
- Review: `CONTRIBUTING.md`.
- Run: every test written by Tasks 1 through 5 through the repository check command.

**Interfaces:**
- Consumes: the complete reviewed implementation, every deferred command and the final documentation.
- Produces: one automated gate result, one manual acceptance report, one list of unavailable hardware checks and a request for explicit push approval.

- [ ] **Step 1: Run independent whole branch reviews before any automated command**

Assign fresh read only reviews for architecture, correctness, Samsung UX, remote navigation, accessibility, security, migration safety and television performance. Require file and line evidence. Resolve every blocking or high confidence finding, then repeat only the affected read only review.

- [ ] **Step 2: Inspect the complete diff and repository state manually**

Review `git diff origin/master...HEAD`, `git diff`, every commit, every new test and every documentation claim. Search the diff for provider credentials, fixture credentials outside approved local fixture setup, stream addresses in persistent records, stale `sortAlphabetically` use, direct lineup overlay writes outside `useLineup`, complete catalogues in remote snapshots and unsupported runtime APIs.

Confirm that `public/wasm/`, `wasm/` and `public/config.xml` remain unchanged. If any changed unexpectedly, stop and update the plan before running the gate.

- [ ] **Step 3: Run the one final automated pre push gate**

Run this chain once after all implementation and review changes are complete:

```bash
git diff --check origin/master...HEAD && \
git diff --check && \
npm run check && \
npm run build && \
npm run tv:gap && \
npm run tv:engines && \
npm run tv:budget
```

Expected: every command exits with status 0, every redesign journey reports completion, the engine and spacing comparisons pass, and the budget verdict comes from a quiet machine. Read the load reported by `tv:budget` before treating its result as valid.

If a command fails, fix only the relevant defect and rerun that command plus any later command invalidated by the fix. Do not rerun an earlier passing command when the fix cannot affect it.

- [ ] **Step 4: Perform browser and paired phone acceptance against the built artifact**

Pair a fresh browser, confirm that the state snapshot stays bounded, load three lineup pages, mutate the lineup from television between pages and confirm the phone recovers from conflict. Apply rename, restore, number, hide, category placement, personal category creation, membership placement and unavailable removal from the phone, then verify the television immediately shows the same effective result.

Restart the application and verify the same durable result. Clear the cache and verify personalisation remains. Remove a playlist and replace an Xtream account after confirmation, then verify only the owned personalisation disappears. Run the previous settings migration fixture twice and verify the second launch makes no additional change.

- [ ] **Step 5: Perform real television acceptance when hardware is available**

Follow the final `docs/testing.md` checklist for HLS Live with and without DVR, MPEG TS Live, movie, episode, catchup, tracks, subtitles, rebuffering, frozen playback, large VOD catalogue, television lineup management and paired phone parity. Record television model, Tizen version, source kind, output format, tested items and any provider capability that was unavailable.

If no paired television or suitable provider fixture is available, mark each hardware item skipped with the reason and carry it as release risk. Simulator evidence must not be reported as real AVPlay evidence.

- [ ] **Step 6: Produce the final verification report**

List the final gate command and result, focused tests covered by `npm run check`, build result, spacing result, engine result, performance load and verdict, manual phone result, real television result or explicit skips, complete diff review result and any remaining external limitation.

- [ ] **Step 7: Request explicit push approval**

Present the complete diff summary and verification report to Shayan. Wait for an explicit request before pushing. Do not create or update a pull request without separate confirmation.
