# OpenIPTV Lineup Personalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, recoverable lineup personalisation for channel and category names, numbers, visibility, ordering and personal categories, with complete television management and no provider data mutation.

**Architecture:** `services/personalDisk.ts` owns a separate transactional IndexedDB database for personal lineup records, while `stores/lineup.ts` validates records, reconciles stable identities, applies sparse overlays and publishes one effective lineup. The channel loader starts the personal record read beside the catalogue read, then adopts both together so provider order never flashes before personal order. Television presentation consumes effective values and a prebuilt number index, while management mutations update zustand immediately and use one idle transaction that can restore the last durable revision after failure.

**Tech Stack:** React 19, TypeScript, zustand, native IndexedDB, native `Intl.Collator`, native `TextEncoder`, the existing idle queue, Vitest, Biome, Vite, the television simulator, AVPlay and hls.js.

**Spec:** `docs/superpowers/specs/2026-10-05-openiptv-product-redesign-design.md`, subsystem 4 in `Lineup Personalisation`, `Lineup Reconciliation`, the television portion of `Management Experience`, and `Persistence`.

## Global Constraints

- Implement subsystem 4 only. Full paged phone lineup queries, phone channel and category editors, remote mutation request identifiers, and completion work remain in subsystem 5.
- Replace the existing phone `sortAlphabetically` setting with the active playlist order mode because the approved spec requires both clients to use the new mode in the same release. Do not add the subsystem 5 phone management pages here.
- Add no hosted service, analytics, runtime dependency, provider administration, bundled content or model year branch.
- Keep provider channel and category data immutable. Persist only sparse personal overlays keyed by playlist and stable provider identity.
- Use `openiptv-personal`, database version `1`, with one `lineups` object store keyed by playlist id.
- Do not apply least recently used eviction to personal lineup data, and do not clear it when the viewer clears refetchable cache data.
- Read the cached catalogue and personalisation concurrently, then publish one effective lineup.
- Perform no IndexedDB work from a direction key handler or another direct interaction path. Use the existing idle queue for committed writes.
- Keep custom numbers as positive integers, reject every effective number collision before changing state, and use an indexed map for number dialling.
- Keep Favourites synthetic. It cannot be renamed, deleted, persisted as a personal category or used as a placement anchor.
- Personal categories use keys that cannot collide with provider category keys, retain their explicit membership order, and are capped at `128` per playlist.
- Reject a new override or membership unless it targets a current item or an unavailable reference already retained by that playlist. A playlist cannot accumulate arbitrary foreign identifiers.
- Preserve `hiddenCategoryMode` on each playlist. Both hidden provider categories and individually hidden channels follow its `exclude` or `search` behavior.
- Retain unavailable overlays, memberships and placements until explicit removal, playlist deletion, Xtream account replacement or full application reset.
- Delete lineup personalisation when a playlist is removed or an Xtream server or username changes. Preserve it for password and output changes.
- Persist only hexadecimal M3U source fingerprints. Never persist raw stream addresses, embedded credentials or provider account values in a personalisation record.
- Target ES2019 and Chromium 69. Do not use unsupported runtime methods, CSS `aspect-ratio`, CSS `inset` shorthand or unguarded flex gap.
- Keep all important management content inside the existing 48 pixel horizontal and 40 pixel vertical safe area, and keep visible text at or above the existing 20 pixel television caption floor at 1920 by 1080.
- Write each task's tests before its production changes, but do not run automated tests, lint, type checks, builds or television gates during implementation. Execute every automated command only in Task 9, the final pre push gate.
- Inspect each task diff and run `git diff --check` before its commit step because that command is not an automated behavior or compilation gate.
- Local task commits are part of the approved implementation. Every commit uses the required Devin generation and coauthor trailers. Do not push until Shayan explicitly asks.
- Task 9 is a command manifest for master plan Task 7. Do not execute it after this subsystem because all automated commands run once after every subsystem review passes.

## Review Focus

- Two M3U entries may have identical tvg id, name, group and address values. Each current entry must receive a deterministic hexadecimal collision suffix, and reconciliation must never attach one saved override to both entries.
- A personal database write may fail while newer optimistic edits are queued. Every promise from the failed batch must report persistence failure, stale completions must be ignored, and state must return to the latest successfully durable revision.
- A requested custom number may collide with another custom number or an unchanged provider number. Both cases must be rejected before the overlay, number index or durable record changes.
- A custom placement anchor may disappear and later return. The moved item must use provider order while the anchor is absent, management must report the unresolved placement, and the placement must apply again when the unique anchor returns.
- Migration may stop after a new record write fails but before legacy settings are removed. The legacy `sortAlphabetically` and `hiddenCategories` values must remain, and a later retry must produce one idempotent overlay without duplicate placements or categories.

## File Structure

### Create

- `src/services/personalDisk.ts` owns `openiptv-personal`, its version 1 schema, explicit transaction success, failure reporting, playlist deletion and full reset.
- `src/stores/lineup.ts` owns validated personalisation, durable revisions, catalogue adoption, reconciliation, effective lineup state, mutation validation, idle persistence and rollback.
- `src/components/settings/LineupManager.tsx` owns the television Channels and Categories management detail, local form drafts, search, reveal hidden, Sort mode, personal category membership and unavailable record removal.
- `tests/personalDisk.test.ts` covers the personal database contract without adding an IndexedDB package.
- `tests/lineupPersonalisation.test.ts` covers fingerprints, overlays, placements, ordering, reconciliation and number indexing as pure behavior.
- `tests/lineupStore.test.ts` covers store migration, revision conflicts, optimistic persistence, rollback and lifecycle cleanup with a mocked personal disk.

### Modify

- `src/types.ts:13-30` adds optional stable M3U source identity and an explicit provider category key without changing playback addresses.
- `src/services/m3u.ts:18-141` computes source fingerprints, collision suffixes and provider category keys while preserving exact provider text.
- `src/services/lineup.ts:13-128` keeps focus arithmetic and synthetic Favourites, then adds pure placement, reconciliation and materialisation functions used by the lineup store.
- `src/stores/channels.ts:32-73,138-350,384-526` stops sorting provider objects, starts personal reads beside cache reads, and sends authoritative live channels plus all category summaries to the lineup store.
- `src/stores/settings.ts:49-102,193-375` removes active personalisation ownership, preserves only migration inputs and hidden content mode, and coordinates destructive playlist lifecycle changes.
- `src/stores/library.ts:56-75,266-341` publishes refreshed Xtream category summaries through the lineup store so renamed, hidden and reordered Movie and Series categories use the same overlay.
- `src/stores/personal.ts:179-209,256-334` uses explicit provider category keys for existing favourites and last played state without moving those compact records out of local storage.
- `src/App.tsx:208-456,930-1379,2770-3122` consumes effective lineup state, uses the number index, delegates visibility mutations and preserves current panel, search, favourite and tuning behavior.
- `src/components/settings/Appearance.tsx:1-94` removes the global alphabetical toggle and rematerializes alphabetical order after locale changes without refetching a catalogue.
- `src/components/settings/Playlists.tsx:74-443,445-635,781-920` replaces the embedded category manager with the focused lineup manager and awaits destructive personal data cleanup.
- `src/components/settings/General.tsx:1-102` clears personal lineups during full reset while leaving cache clearing independent.
- `src/components/Settings.tsx:15-18,195-230,308-347,439-457` keeps nested detail focus and Back ownership correct for lineup forms and Sort mode.
- `src/services/locale.ts:43-413` adds English management, order, validation, unavailable item and persistence error messages.
- `src/locales/ar.ts`, `src/locales/bn.ts`, `src/locales/de.ts`, `src/locales/es.ts`, `src/locales/fr.ts`, `src/locales/hi.ts`, `src/locales/id.ts`, `src/locales/it.ts`, `src/locales/ja.ts`, `src/locales/ko.ts`, `src/locales/nl.ts`, `src/locales/pt.ts`, `src/locales/ru.ts`, `src/locales/tr.ts` and `src/locales/zh-CN.ts` translate every new application label.
- `src/styles/app.css:2133-2390,2654-2712,4029-4140` extends existing settings primitives for lineup scope controls, edit forms, sort state, unavailable rows and flex gap fallbacks.
- `src/services/remoteProtocol.ts:36-119,350-465` replaces the old boolean alphabetical setting with the active playlist `LineupOrderMode` choice only.
- `public/remote/remote.js:42-155,695-716,793-802,1346-1352` renders and submits the four order modes without adding phone lineup pages.
- `tests/m3u.test.ts` adds deterministic source fingerprint and collision coverage.
- `tests/lineup.test.ts` updates synthetic list visibility to consume effective hidden state.
- `tests/channels.test.ts` asserts concurrent adoption and immutable provider catalogues through `useLineup`.
- `tests/settings.test.ts` covers idempotent legacy migration inputs and destructive cleanup boundaries.
- `tests/library.test.ts` covers effective Movie and Series category presentation after refresh.
- `tests/settings-ui.test.tsx` covers television channel and category management.
- `tests/search.test.tsx`, `tests/favourites.test.tsx`, `tests/resume.test.tsx` and `tests/keyLaws.test.tsx` cover effective names, hidden content, personal categories, number tuning and Back ownership.
- `tests/remoteProtocol.test.ts` and `tests/remoteWeb.test.ts` replace the old alphabetical boolean contract with the order mode choice.
- `tests/support/app.tsx:120-286` supplies deterministic personal records and a personal disk mock to full application tests.
- `scripts/tv/harness.mjs:36-59,136-170,391-550` adds the real television management journey.
- `scripts/tv/sim.mjs:1628-1733,1828-1841` runs and budgets the same lineup journey.
- `tests/harness.test.ts:261-314` requires the simulator and parity walk to complete the authoritative lineup journey.
- `AGENTS.md:58-116,129-150` records the new store boundaries and personal data invariants.
- `docs/design.md:192-269` documents concurrent launch adoption, sparse overlays, reconciliation and the third storage role.

---

### Task 1: Durable Personal Lineup Database

**Files:**
- Create: `src/services/personalDisk.ts`
- Create: `tests/personalDisk.test.ts`

**Interfaces:**
- Produces: `PERSONAL_DB_NAME = "openiptv-personal"`, `PERSONAL_DB_VERSION = 1` and `LINEUPS_STORE = "lineups"`.
- Produces: `readLineup(playlistId: string): Promise<unknown | null>`.
- Produces: `writeLineup(playlistId: string, value: unknown): Promise<void>`.
- Produces: `removeLineup(playlistId: string): Promise<void>` and `clearLineups(): Promise<void>`.
- Produces: `PersonalDiskError extends Error` with `readonly operation: "open" | "read" | "write" | "remove" | "clear"` and `constructor(operation: PersonalDiskError["operation"], cause?: unknown)`.
- Guarantees: a write resolves only from `transaction.oncomplete`. Open, request, abort, quota and blocked failures reject rather than masquerading as an empty cache.
- Guarantees: `clearLineups()` clears only the `lineups` store. Nothing in `services/disk.ts` calls it.

- [ ] **Step 1: Write the personal database contract tests without running them**

Add a focused in file `IDBFactory` test double which drives open, request and transaction events. Cover the exact database name, version, one store, playlist id key, missing read, successful read, completion based write, transaction abort, quota failure, blocked open, retry after failed open, one playlist removal and full clear. Assert that a request success followed by transaction abort rejects the write.

```ts
test("a write resolves only when its transaction completes", async () => {
  let settled = false;
  const pending = writeLineup("pl-1", { version: 1 }).then(() => {
    settled = true;
  });
  fakeWriteRequest.succeed();
  await Promise.resolve();
  expect(settled).toBe(false);
  fakeTransaction.complete();
  await expect(pending).resolves.toBeUndefined();
});

test("an aborted transaction reports a durable write failure", async () => {
  const pending = writeLineup("pl-1", { version: 1 });
  fakeWriteRequest.succeed();
  fakeTransaction.abortWith("QuotaExceededError");
  await expect(pending).rejects.toMatchObject({ operation: "write" });
});
```

- [ ] **Step 2: Implement the version 1 personal database boundary**

Implement the exact exports above with one cached open promise. Clear the cached promise after open failure so a later retry can succeed, close an old connection on `versionchange`, use an out of line playlist id key, and keep transaction helpers private to this file.

- [ ] **Step 3: Review the database diff without running automated gates**

Confirm that the module imports no cache budget or eviction helper, every write waits for transaction completion, every failure rejects with an operation, and no test, lint, type check, build or television command has run. Run only `git diff --check`.

- [ ] **Step 4: Commit after explicit approval**

```bash
git add src/services/personalDisk.ts tests/personalDisk.test.ts
git commit -m "feat: add durable lineup storage"
```

### Task 2: Fingerprints, Overlays, Placements and Effective Lineups

**Files:**
- Modify: `src/types.ts:13-30`
- Modify: `src/services/m3u.ts:18-141`
- Modify: `src/services/lineup.ts:13-128`
- Modify: `tests/m3u.test.ts`
- Modify: `tests/lineup.test.ts`
- Create: `tests/lineupPersonalisation.test.ts`

**Interfaces:**
- Produces the approved `ChannelRef`, `OrderPlacement`, `ChannelOverride`, `CategoryOverride`, `PersonalCategory`, `LineupOrderMode` and `LineupPersonalisation` types in `src/services/lineup.ts` without changing their specified fields.
- Produces: `StoredLineupV1 = { version: 1; revision: number; personalisation: LineupPersonalisation }`.
- Produces: optional `Channel.categoryKey?: string` and `Channel.sourceFingerprint?: string`. M3U parsing sets both, while Xtream continues using `channel.xtream.categoryKey` and provider stream identity.
- Produces: `sourceFingerprint(tvgId: string, name: string, group: string, url: string): string` in `src/services/m3u.ts`.
- Produces: `channelRef(channel: Channel): ChannelRef` and `personalCategoryKey(id: string): string`.
- Produces: `parseStoredLineup(value: unknown): StoredLineupV1` with validated defaults, known fields only, one placement per item and at most 128 valid personal categories.
- Produces: `applyPlacements<T>(items: readonly T[], placements: readonly OrderPlacement[], idOf: (item: T) => string): { items: T[]; unresolved: OrderPlacement[] }`.
- Produces: `reconcilePersonalisation(personalisation: LineupPersonalisation, catalogue: ProviderLineup): ReconciliationResult`.
- Produces: `materialiseLineup(catalogue: ProviderLineup, personalisation: LineupPersonalisation, locale: string, hiddenMode: HiddenCategoryMode): LineupMaterialisation`.

```ts
export interface ProviderCategory {
  key: string;
  name: string;
  kind: "live" | "movie" | "series";
  channels: readonly Channel[];
}

export interface ProviderLineup {
  channels: readonly Channel[];
  categories: readonly ProviderCategory[];
}

export interface EffectiveCategory extends ProviderCategory {
  hidden: boolean;
  personal: boolean;
}

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

export interface LineupMaterialisation {
  channels: Channel[];
  categories: EffectiveCategory[];
  managedChannels: ManagedChannel[];
  managedCategories: ManagedCategory[];
  browsableChannels: Channel[];
  searchableChannels: Channel[];
  numberIndex: ReadonlyMap<number, Channel>;
  unavailable: UnavailableRecord[];
}
```

- [ ] **Step 1: Write fingerprint and collision tests without running them**

Use fixed fixtures to assert a stable lowercase hexadecimal value. Hash UTF-8 bytes for `tvg-id`, exact name, exact group and exact stream address separated by `\0`, using FNV-1a seeds `0x811c9dc5` and `0x9e3779b9`, then concatenate both eight digit hashes. Assert that the first unique fingerprint is 16 hexadecimal characters, a collision appends an eight digit hexadecimal occurrence suffix, Unicode text changes the value deterministically, credentials never appear in the result, and a reordered M3U duplicate retains the same base fingerprint.

- [ ] **Step 2: Write placement, order and overlay tests without running them**

Cover before, after and end placements, replacement of an earlier placement, sequential moves, a missing item, a missing anchor, anchor return, provider, alphabetical, number and custom modes, locale numeric collation, category placement, category rename, channel rename, provider number fallback, effective number collisions as input rejection data, individual and category visibility, personal category membership order, Favourites key rejection and provider object immutability.

```ts
test("a missing placement anchor leaves provider order and reports the record", () => {
  const result = applyPlacements(provider, [{ itemId: "b", beforeId: "gone" }], item => item.id);
  expect(result.items.map(item => item.id)).toEqual(["a", "b", "c"]);
  expect(result.unresolved).toEqual([{ itemId: "b", beforeId: "gone" }]);
});

test("materialisation never mutates provider values", () => {
  const provider = frozenProviderLineup();
  const effective = materialiseLineup(provider, renamedOverlay, "en", "exclude");
  expect(effective.channels[0].name).toBe("My News");
  expect(provider.channels[0].name).toBe("Provider News");
  expect(Object.isFrozen(provider.channels[0])).toBe(true);
});
```

- [ ] **Step 3: Write reconciliation and number index tests without running them**

Cover a unique Xtream id, an M3U id whose fingerprint moved to a new suffix, two current fingerprint matches, an unavailable override, unavailable personal membership, a renamed Xtream category key, an exact unique M3U category display match, an ambiguous M3U category display match, and persisted reseating of item ids and placement anchors. Assert that the number index is built once from browsable effective channels, excludes hidden browse content, has one entry per effective number, and keeps the first provider item when the source already contains duplicate provider numbers.

- [ ] **Step 4: Implement fingerprints and pure lineup functions**

Keep fingerprint collision accounting local to one `parseM3U` call. Apply a category rename only to effective display values, retain stable provider category keys, sort copies with one locale `Intl.Collator({ numeric: true })`, apply category placements after adding personal categories, and make custom channel placements category specific through `CategoryOverride.channelOrder`.

- [ ] **Step 5: Review the pure domain diff without running automated gates**

Trace each approved type against the spec, confirm that a placement with no anchor moves to the end, confirm that a missing anchor does not move its item, and inspect every persisted field for addresses or credentials. Run only `git diff --check`.

- [ ] **Step 6: Commit after explicit approval**

```bash
git add src/types.ts src/services/m3u.ts src/services/lineup.ts tests/m3u.test.ts tests/lineup.test.ts tests/lineupPersonalisation.test.ts
git commit -m "feat: materialise personalised lineups"
```

### Task 3: Lineup Store, Revisions and Persistence Rollback

**Files:**
- Create: `src/stores/lineup.ts`
- Create: `tests/lineupStore.test.ts`

**Interfaces:**
- Consumes: every pure type and function from Task 2 plus the Task 1 personal disk boundary.
- Produces: `useLineup`, whose state includes `playlistId`, `revision`, `durableRevision`, `orderMode`, the complete `LineupMaterialisation`, `saving`, `saveError` and the last authoritative `ProviderLineup`.
- Produces: `prepareLineup(playlist: Playlist): Promise<PreparedLineup>` which begins the personal database read immediately and carries legacy migration inputs without waiting for the catalogue.
- Produces: `adoptCatalogue(playlist: Playlist, catalogue: ProviderLineup, prepared: Promise<PreparedLineup>): Promise<void>` which waits for both inputs, reconciles once and publishes one effective snapshot.
- Produces: `adoptCategorySummaries(playlist: Playlist, categories: readonly ProviderCategory[]): Promise<void>` for a later authoritative Xtream category refresh.
- Produces: `applyLineupMutation(expectedRevision: number, mutation: LineupMutation): Promise<LineupMutationResult>`.
- Produces: `rematerialise(locale: string): void`, `removePlaylistLineup(playlistId: string): Promise<void>`, `resetLineups(): Promise<void>` and `clearLineupError(): void`.

```ts
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
  | { ok: false; revision: number; reason: "conflict" | "invalid" | "duplicate-number" | "limit" | "unavailable" | "persistence" };
```

- [ ] **Step 1: Write saved value and revision tests without running them**

Mock `services/personalDisk` with controllable promises. Cover empty, malformed, version 1 and partially migrated records, known default merging, unknown field removal, 128 valid personal categories, rejection of category 129, stale revision conflict, exact affected identifiers and no state change after invalid, duplicate or unavailable mutations.

- [ ] **Step 2: Write idle persistence and rollback tests without running them**

Use fake timers only to release the existing idle callback fallback. Assert immediate optimistic state, one coalesced transaction for several edits before idle, durable revision advancement on completion, serial handling of an edit that arrives during a write, rollback to the latest durable snapshot after abort, failure resolution for every promise in the failed batch, ignored stale completion and a successful resubmission of the retained form draft.

```ts
test("a failed batch restores the latest durable revision", async () => {
  const first = applyLineupMutation(4, renameAlpha);
  const second = applyLineupMutation(5, hideAlpha);
  expect(useLineup.getState().revision).toBe(6);
  rejectPendingWrite(new PersonalDiskError("write"));
  await expect(first).resolves.toMatchObject({ ok: false, reason: "persistence", revision: 4 });
  await expect(second).resolves.toMatchObject({ ok: false, reason: "persistence", revision: 4 });
  expect(useLineup.getState()).toMatchObject({ revision: 4, durableRevision: 4 });
});
```

- [ ] **Step 3: Write adoption and reconciliation tests without running them**

Prove that catalogue and personal promises may settle in either order without an intermediate provider snapshot, identical authoritative adoption does not increment revision, changed identifiers or availability do increment it, unique fingerprint reseating schedules persistence, unresolved records remain, and an old asynchronous adoption cannot replace a newer playlist.

- [ ] **Step 4: Implement the lineup store**

Keep the authoritative catalogue and durable overlay in module private state. Use one generation token for catalogue ownership, one serial write loop, one cancellable idle callback and one durable snapshot per playlist. A mutation must validate its expected revision and complete input before setting optimistic state, while persistence failure restores the durable snapshot and leaves a localized management error key for the UI.

- [ ] **Step 5: Review the store diff without running automated gates**

Confirm that direction movement reads only arrays, sets and maps already held in memory. Confirm that a save failure cannot clear unavailable records, that account credentials never enter a state snapshot, and that cache clearing has no import path to `clearLineups`. Run only `git diff --check`.

- [ ] **Step 6: Commit after explicit approval**

```bash
git add src/stores/lineup.ts tests/lineupStore.test.ts
git commit -m "feat: persist lineup revisions safely"
```

### Task 4: Catalogue Adoption, Migration and Destructive Lifecycle

**Files:**
- Modify: `src/stores/channels.ts:32-73,138-350,384-526`
- Modify: `src/stores/settings.ts:49-102,193-375`
- Modify: `src/stores/library.ts:56-75,266-341`
- Modify: `src/stores/personal.ts:179-209,256-334`
- Modify: `src/components/settings/Playlists.tsx:545-571,897-915`
- Modify: `src/components/settings/General.tsx:1-102`
- Modify: `src/services/remoteProtocol.ts:528-556`
- Modify: `tests/channels.test.ts`
- Modify: `tests/settings.test.ts`
- Modify: `tests/library.test.ts`
- Modify: `tests/personal.test.ts`
- Modify: `tests/settings-ui.test.tsx`
- Modify: `tests/remoteProtocol.test.ts`

**Interfaces:**
- Consumes: `prepareLineup` before the first awaited cache or network operation and `adoptCatalogue` after raw parsing.
- Changes: `useChannels` retains load, error, cache and account responsibility, while `useLineup` becomes the source of effective channels and categories.
- Changes: `Playlist.hiddenCategories?: string[]` is migration input only. `Playlist.hiddenCategoryMode` remains durable local storage state.
- Changes: the old global `sortAlphabetically` becomes migration input only when the saved settings object actually owns that key. Fresh settings have no legacy order value.
- Produces: `completeHiddenCategoryMigration(playlistId: string): void` and `completeOrderModeMigration(): void`, each called only after the corresponding new record transaction completes.
- Changes: `removePlaylist(id: string): Promise<boolean>` and `updatePlaylist(id: string, name: string, source: PlaylistSource): Promise<boolean>` wait for required personal data deletion before changing settings when the action is destructive.
- Guarantees: cache clearing calls only `services/disk.forgetAll()`. Full reset awaits `resetLineups()` as well as clearing compact personal state, cache, repair diagnoses, devices and settings.

- [ ] **Step 1: Write migration tests without running them**

Seed `sortAlphabetically` true and false, valid and malformed `hiddenCategories`, existing version 1 records, duplicate Xtream category names, interrupted writes and partially migrated settings. Assert alphabetical or provider mode, exact unique key and name migration, ambiguous values retained as unavailable, no duplicate work on retry, and removal of each legacy value only after a successful new database transaction.

- [ ] **Step 2: Write concurrent launch adoption tests without running them**

In `tests/channels.test.ts`, make cache and personal disk promises independently controllable. Assert that both reads start before either settles, no raw catalogue reaches presentation while personal data is pending, the first published state already has personal names and order, force refresh uses the same adoption path, and stale refresh failure leaves the last effective lineup visible.

- [ ] **Step 3: Write lifecycle tests without running them**

Cover playlist removal, source kind change, Xtream server change, username change, password change, output change, M3U address change, full reset and cache clear. Assert deletion for playlist, server, username and source kind replacement, preservation for password, output and M3U refresh, complete personal reset, and no personal disk call from cache clear. Assert that television and remote callers await destructive cleanup, retain their draft after failure, and do not refresh a source which settings did not update.

- [ ] **Step 4: Write category refresh tests without running them**

Prove that Movie and Series category refreshes publish effective names, hidden state and category order, preserve duplicate provider names under distinct keys, retain unavailable category overrides, and ignore a refresh owned by an older playlist generation.

- [ ] **Step 5: Integrate the stores and migration**

Remove provider sorting from `useChannels`. Build one immutable `ProviderLineup` for M3U and Xtream, include empty provider categories and all Xtream content kinds, start `prepareLineup` beside disk cache reads, and adopt after either cached or refreshed parsing. Run inactive legacy order record creation from the existing idle sweep, then remove the old global setting only after every configured playlist record commits.

- [ ] **Step 6: Integrate destructive cleanup and reset**

Await lineup deletion before playlist removal or account replacement in the television and remote callers. If deletion fails, leave the playlist and edit draft intact, skip catalogue reload, and return `false`. During full reset, clear the personal database before showing reset completion. Keep `clearCache()` unchanged with respect to personal data.

- [ ] **Step 7: Review the integration diff without running automated gates**

Trace cached M3U, refreshed M3U, cached Xtream and refreshed Xtream into the same adoption call. Confirm that provider failure never writes an empty authoritative catalogue, every migration is idempotent, and a destructive failure leaves both old settings and old personal data usable. Run only `git diff --check`.

- [ ] **Step 8: Commit after explicit approval**

```bash
git add src/stores/channels.ts src/stores/settings.ts src/stores/library.ts src/stores/personal.ts src/components/settings/Playlists.tsx src/components/settings/General.tsx src/services/remoteProtocol.ts tests/channels.test.ts tests/settings.test.ts tests/library.test.ts tests/personal.test.ts tests/settings-ui.test.tsx tests/remoteProtocol.test.ts
git commit -m "feat: adopt personal lineups with catalogues"
```

### Task 5: Effective Live Consumers, Number Dialling and Order Mode Contract

**Files:**
- Modify: `src/App.tsx:208-456,930-1379,2770-3122`
- Modify: `src/components/settings/Appearance.tsx:1-94`
- Modify: `src/services/remoteProtocol.ts:36-119,350-465`
- Modify: `public/remote/remote.js:42-155,695-716,793-802,1346-1352`
- Modify: `tests/lineup.test.ts`
- Modify: `tests/search.test.tsx`
- Modify: `tests/favourites.test.tsx`
- Modify: `tests/resume.test.tsx`
- Modify: `tests/keyLaws.test.tsx`
- Modify: `tests/remoteProtocol.test.ts`
- Modify: `tests/remoteWeb.test.ts`
- Modify: `tests/support/app.tsx:120-286`

**Interfaces:**
- Consumes: effective channels, categories, searchable channels, browsable channels and `numberIndex` from `useLineup`.
- Removes: every presentation read of `Playlist.hiddenCategories` and every linear `find(channel.number)` dial lookup.
- Changes: number column width derives from the largest effective channel number rather than channel count.
- Changes: locale selection calls `useLineup.getState().rematerialise(resolveLocale(id))` only when the active order mode is alphabetical. It does not refetch or reparse a provider catalogue.
- Produces: remote snapshot field `settings.lineupOrderMode: LineupOrderMode` and setting command `{ type: "setting"; key: "lineupOrderMode"; value: LineupOrderMode }`.
- Removes: remote `settings.sortAlphabetically` and its boolean command.

- [ ] **Step 1: Write effective consumer tests without running them**

Cover renamed channel text in list, search, favourite row, playback banner and last channel resume. Cover renamed category text in Live, Movies and Series rails. Assert that provider identifiers, playback addresses, source fingerprints and favourite item keys remain unchanged.

- [ ] **Step 2: Write hidden behavior and number tests without running them**

Cover an individually hidden channel and a hidden provider category under both hidden content modes. Assert Browse and dial exclusion in both modes, Search and Favourites inclusion only in `search` mode, explicit Red reveal without persistence changes, direct unhide through the lineup mutation, custom number tuning through `numberIndex`, provider number fallback and a missing number message without an array scan.

```ts
test("number entry uses the effective indexed number", async () => {
  await mountApp(playlist, { personalLineup: customNumberForAlpha(801) });
  press(56);
  press(48);
  press(49);
  press(KEY.ENTER);
  expect(played[played.length - 1]).toBe("http://example.invalid/a.m3u8");
});
```

- [ ] **Step 3: Write order mode and locale tests without running them**

Assert all four modes on television and phone snapshots, removal of the old boolean, immediate rematerialisation after a mode change, locale dependent alphabetical rematerialisation without `fetch`, provider number ordering with stable provider ties, and Custom mode fallback when no placement exists.

- [ ] **Step 4: Rewire App and Appearance**

Subscribe presentation to `useLineup`, keep synthetic Favourites in `lineupOf`, and preserve current cursor correction when Favourites appears or disappears. Replace hidden sets with effective category and channel flags, replace dial search with `numberIndex.get(n)`, and keep Red reveal as transient presentation state.

- [ ] **Step 5: Replace the remote alphabetical setting**

Validate only `provider`, `alphabetical`, `number` and `custom`, apply the mutation against the loaded lineup revision, return `failed` when durable persistence rolls back, and render one phone select. Do not add channel pages, category pages, lineup cursors or mutation paging in this task.

- [ ] **Step 6: Review the consumer diff without running automated gates**

Search the repository for `sortAlphabetically`, linear channel number lookup and presentation reads of `hiddenCategories`. Only migration readers may remain. Confirm that Left, Right, Up, Down, OK, Back, Green, Red and digit ownership did not gain a new IndexedDB call. Run only `git diff --check`.

- [ ] **Step 7: Commit after explicit approval**

```bash
git add src/App.tsx src/components/settings/Appearance.tsx src/services/remoteProtocol.ts public/remote/remote.js tests/lineup.test.ts tests/search.test.tsx tests/favourites.test.tsx tests/resume.test.tsx tests/keyLaws.test.tsx tests/remoteProtocol.test.ts tests/remoteWeb.test.ts tests/support/app.tsx
git commit -m "feat: use effective lineup values"
```

### Task 6: Television Channel and Category Management

**Files:**
- Create: `src/components/settings/LineupManager.tsx`
- Modify: `src/components/settings/Playlists.tsx:74-443,445-635,781-920`
- Modify: `src/components/Settings.tsx:15-18,195-230,308-347,439-457`
- Modify: `src/styles/app.css:2133-2390,2654-2712,4029-4140`
- Modify: `src/services/locale.ts:43-413`
- Modify: every existing `src/locales/*.ts` file listed in File Structure
- Modify: `tests/settings-ui.test.tsx`
- Modify: `tests/keyLaws.test.tsx`

**Interfaces:**
- Produces: `LineupManager({ playlist, onAsking, navigation }: { playlist: Playlist; onAsking: (asking: boolean) => void; navigation: SettingsDetailNavigation }): React.ReactElement`.
- Consumes: `useLineup` management rows, revision, order mode, saving, save error and `applyLineupMutation`.
- Keeps: existing Settings detail stack and focus restoration. The playlist row opens one Lineup detail, which contains Channels and Categories scope controls.
- Channel scope provides category filter, search, reveal hidden, order mode, paging, edit and Sort mode.
- Channel edit keeps local drafts for provider or custom name, positive integer or blank number, visibility and personal category membership. Save closes only after durable success.
- Category scope keeps the existing Live, Movies and Series filter, then adds search, reveal hidden, rename, visibility, paging and Sort mode. Blank custom name restores provider text.
- Sort mode follows the exact grab contract. OK grabs, Up and Down move a tentative local row, OK persists one relative placement, Back while grabbed restores the pre grab order, and Back while released leaves Sort mode.

- [ ] **Step 1: Write management reachability tests without running them**

Prove that a remote can reach the Lineup action from a playlist row, choose Channels or Categories, open search, reveal hidden, open one edit form, dismiss the television keyboard with the first Back, return one Settings depth with the next Back, and restore focus to the originating row. Add pointer click coverage for every visible action.

- [ ] **Step 2: Write channel edit tests without running them**

Cover provider text shown separately from the draft, rename, restore provider name, custom number, clear custom number, zero, negative, decimal, text input, collision with custom number, collision with provider number, hide, unhide, search, category filter and an edit on a channel whose M3U id changed after refresh. Assert that invalid input keeps the form and durable record unchanged.

- [ ] **Step 3: Write category edit and bulk visibility tests without running them**

Cover exact provider key ownership for duplicate names, rename, restore provider name, hide, unhide, hide all for only the selected content kind, show all, category order and a unique or ambiguous M3U category reconciliation result. Assert that Favourites never appears in management actions.

- [ ] **Step 4: Write Sort mode tests without running them**

Cover channel and category grab, each boundary, tentative movement, pointer selection, commit placement, later replacement of the same item placement, Back rollback while grabbed, Back exit while released, missing anchor warning and focus restoration after rematerialisation.

- [ ] **Step 5: Extract and implement the Lineup manager**

Move the current embedded `CategoryManager` responsibility out of `Playlists.tsx`, preserve the current account and playlist editor behavior, and reuse existing Settings headers, rows, detail navigation, confirmation and spatial focus helpers. Render provider strings with `Text` and `dir="auto"`, keep list paging at 20 rows on television, and use translated labels for every field and error.

- [ ] **Step 6: Implement local drafts and durable save behavior**

Apply optimistic store state immediately, keep the form mounted while its promise is pending, close only after success, and leave the draft plus localized error visible after persistence rollback. Disable only the duplicate submission action while saving, without hiding Back or another recovery path.

- [ ] **Step 7: Review the television management diff without running automated gates**

Walk every focus zone on paper in both text directions, confirm that ordinary browsing never changes order, inspect the 48 by 40 safe area and 20 pixel text floor, and confirm all new flex layouts have existing `no-flex-gap` fallbacks. Run only `git diff --check`.

- [ ] **Step 8: Commit after explicit approval**

```bash
git add src/components/settings/LineupManager.tsx src/components/settings/Playlists.tsx src/components/Settings.tsx src/styles/app.css src/services/locale.ts src/locales tests/settings-ui.test.tsx tests/keyLaws.test.tsx
git commit -m "feat: manage lineups on television"
```

### Task 7: Personal Categories, Unavailable Records and Failure Recovery

**Files:**
- Modify: `src/components/settings/LineupManager.tsx`
- Modify: `src/components/settings/Playlists.tsx:600-635,850-918`
- Modify: `src/components/settings/General.tsx:60-99`
- Modify: `src/styles/app.css:2133-2390,2654-2712,4029-4140`
- Modify: `src/services/locale.ts:43-413`
- Modify: every existing `src/locales/*.ts` file listed in File Structure
- Modify: `tests/settings-ui.test.tsx`
- Modify: `tests/favourites.test.tsx`
- Modify: `tests/search.test.tsx`
- Modify: `tests/lineupStore.test.ts`

**Interfaces:**
- Consumes: personal category mutations and unavailable records from Task 3.
- Produces: personal category create, rename, delete, membership replacement and member placement through the existing manager.
- Produces: an Unavailable section which states whether each record is an override, membership or placement, shows the custom label or stable opaque identifier, and offers explicit Remove behind the existing confirmation boundary.
- Guarantees: a personal category adds another view of a channel and never removes that channel from a provider category.
- Guarantees: removing an unavailable record removes only the named override, membership or placement. It never removes the current channel, provider category or whole personal category unless that category is the explicit delete target.

- [ ] **Step 1: Write personal category tests without running them**

Cover creation, distinct `personal:<id>` presentation keys, blank name rejection, exact provider text preservation, rename, deletion confirmation, category 128 success, category 129 rejection, one channel in several personal categories, removal from one category only, explicit member ordering and Favourites remaining independent.

- [ ] **Step 2: Write unavailable record tests without running them**

Cover unavailable channel override, category override, personal membership, moved item and missing anchor. Assert honest count and type labels, no raw stream address or credential text, explicit removal, cancellation, automatic reseating after a unique fingerprint returns, retained ambiguity, and placement application after its anchor returns.

- [ ] **Step 3: Write persistence failure component tests without running them**

Reject rename, number, hide, bulk visibility, sort and membership writes. For each action assert the previous durable effective lineup, previous durable revision, retained form or Sort mode draft, one localized error, available Retry and no false success announcement. Resolve a later retry and assert one durable record with no duplicate membership or placement.

- [ ] **Step 4: Complete personal category and unavailable management**

Use the Channel edit form for membership checkboxes, the Categories scope for category creation and deletion, and the selected personal category for member Sort mode. Keep unavailable records in their own final section so reveal hidden does not pretend they are current provider content.

- [ ] **Step 5: Complete destructive failure handling**

Await playlist lineup deletion before closing the remove confirmation. Await full personal reset before reporting reset completion. On either failure, keep the confirmation or management region available with a plain error and Retry, without clearing cache or compact personal state early.

- [ ] **Step 6: Review recovery behavior without running automated gates**

Inspect every error path for retained drafts, exact durable rollback and one retry owner. Confirm that unavailable records survive provider outage, cache clear and ordinary refresh, while playlist removal, account replacement and reset delete them. Run only `git diff --check`.

- [ ] **Step 7: Commit after explicit approval**

```bash
git add src/components/settings/LineupManager.tsx src/components/settings/Playlists.tsx src/components/settings/General.tsx src/styles/app.css src/services/locale.ts src/locales tests/settings-ui.test.tsx tests/favourites.test.tsx tests/search.test.tsx tests/lineupStore.test.ts
git commit -m "feat: recover personal category changes"
```

### Task 8: Television Journey and Architecture Documentation

**Files:**
- Modify: `scripts/tv/harness.mjs:36-59,136-170,391-550`
- Modify: `scripts/tv/sim.mjs:1628-1733,1828-1841`
- Modify: `tests/harness.test.ts:261-314`
- Modify: `AGENTS.md:58-116,129-150`
- Modify: `docs/design.md:192-269`

**Interfaces:**
- Extends: `XTREAM_JOURNEYS` with `lineupManagement: "Xtream lineup management"` so parity and budget runs share one authoritative label.
- Extends: the parity walk to rename a channel, assign a custom number, hide and reveal it, move one channel, rename and move one category, create one personal category, assign the channel, leave Settings, dial the custom number, reopen management and verify persistence.
- Extends: the benchmark walk with the same state transitions and measured output for the management journey. Task 9 sets its allowance from the first quiet final measurement before the verdict run.
- Documents: `services/store`, `services/disk` and `services/personalDisk` as three distinct persistence roles.

- [ ] **Step 1: Write harness contract tests without running them**

Require both harness and simulator source to reference `XTREAM_JOURNEYS.lineupManagement`, require the tracker to fail when it is missing, and assert that the seeded settings still contain provider values while personal state enters `openiptv-personal` through the user journey rather than fixture shortcuts.

- [ ] **Step 2: Add the parity and budget journey**

Use transition predicates rather than sleeps. Capture the effective channel list after rename and ordering, the unavailable free management state after persistence, and the tuned custom number. Complete the journey label in both harness and simulator, emit its stalls, lag and slow frame measurements, and leave its allowance for Task 9 because the user has deferred every television run until the final gate.

- [ ] **Step 3: Update repository guidance and design notes**

Add `services/personalDisk.ts` and `stores/lineup.ts` to the project map. Record that personal lineups are durable, unbounded by cache eviction and excluded from cache clearing, that no direction key reads IndexedDB, that provider catalogues remain immutable, and that launch adopts cache plus overlay before presentation. Update the storage table in `docs/design.md` with the exact new database name and rollback behavior.

- [ ] **Step 4: Inspect documentation and journey diffs without running automated gates**

Check every command, path, invariant, Markdown paragraph, translated label reference and harness predicate. Confirm that README remains unchanged because this work is internal architecture and Settings behavior covered by product documentation. Run only `git diff --check`.

- [ ] **Step 5: Commit after explicit approval**

```bash
git add scripts/tv/harness.mjs scripts/tv/sim.mjs tests/harness.test.ts AGENTS.md docs/design.md
git commit -m "test: add lineup television journey"
```

### Task 9: Final Pre Push Gate

**Files:**
- Review: every file changed by Tasks 1 through 8

**Interfaces:**
- Consumes: all deferred tests and production changes.
- Produces: one verified subsystem diff with no relevant local failure and no uncommitted gate fix.

- [ ] **Step 1: Review the complete subsystem diff before automation**

Run `git status --short`, inspect `git diff` and `git diff --stat`, then map every approved subsystem 4 requirement to one task and one test. Check that subsystem 5 phone paging and management pages did not enter the diff.

- [ ] **Step 2: Run the repository whitespace gate**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 3: Install the locked dependency tree only at the final gate**

Run: `npm ci`

Expected: exit code 0 with no lock file change.

- [ ] **Step 4: Run lint, type checking and the complete unit and component suite once**

Run: `npm run check`

Expected: Biome, TypeScript, every existing test and every new personalisation test pass.

- [ ] **Step 5: Build the production artifact**

Run: `npm run build`

Expected: TypeScript and Vite complete with the same artifact for every supported television.

- [ ] **Step 6: Run television spacing parity**

Run: `npm run tv:gap`

Expected: management forms, scope controls, lists and Sort mode have matching geometry with and without flex gap.

- [ ] **Step 7: Run television engine parity**

Run: `npm run tv:engines`

Expected: Chromium 69 and Chromium 120 complete the lineup management journey with matching behavior, and the real IndexedDB path raises no compatibility exception.

- [ ] **Step 8: Measure and run the television performance budget on a quiet machine**

Run: `npm run tv:quick`

Expected: the output contains the new lineup management stalls, lag and slow frame measurements under a quiet load. Set its `PHASE_ALLOWED` entry in `scripts/tv/sim.mjs` from that measured result with the same tolerance policy as adjacent journeys, then run `npm run check` once because the simulator source and harness contract test changed.

Run: `npm run tv:budget`

Expected: launch adoption, channel browsing, search, number entry and the new management journey remain within budget. Read the machine load in the header before treating any failure as a regression.

- [ ] **Step 9: Fix only relevant failures, then repeat only invalidated commands**

A source or test edit invalidates `npm run check` and later affected gates. A style or rendered structure edit invalidates build, spacing, engine and budget gates. A simulator allowance edit invalidates its contract tests and the budget gate. Do not expand the task to unrelated existing failures.

- [ ] **Step 10: Review the final diff and commit gate fixes after explicit approval**

Run `git diff --check` and `git status --short` again. If gate fixes exist and Shayan approves a commit, stage only those fixes and use the personal project identity command from earlier tasks with a concrete commit message. Do not push.
