import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { channelRef, type ProviderLineup } from "../src/services/lineup";
import type { Playlist } from "../src/stores/settings";

const disk = vi.hoisted(() => ({
  read: vi.fn<(playlistId: string) => Promise<unknown | null>>(),
  write: vi.fn<(playlistId: string, value: unknown) => Promise<void>>(),
  ifAbsent: vi.fn<(playlistId: string, value: unknown) => Promise<boolean>>(),
  remove: vi.fn<(playlistId: string) => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
}));

vi.mock("../src/services/personalDisk", () => ({
  readLineup: disk.read,
  writeLineup: disk.write,
  writeLineupIfAbsent: disk.ifAbsent,
  removeLineup: disk.remove,
  clearLineups: disk.clear,
}));

const playlistA: Playlist = {
  id: "pl-a",
  name: "A",
  source: { kind: "m3u", url: "http://example.invalid/a.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};
const playlistB: Playlist = {
  id: "pl-b",
  name: "B",
  source: { kind: "m3u", url: "http://example.invalid/b.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};

const alpha = {
  id: "a",
  name: "Alpha",
  number: 1,
  group: "News",
  categoryKey: "News",
  logo: "",
  quality: "",
  url: "http://example.invalid/a",
  sourceFingerprint: "0123456789abcdef",
};
const beta = {
  ...alpha,
  id: "b",
  name: "Beta",
  number: 2,
  url: "http://example.invalid/b",
  sourceFingerprint: "abcdef0123456789",
};
const alphaRef = channelRef(alpha);
const catalogue: ProviderLineup = {
  channels: [alpha],
  categories: [{ key: "News", name: "News", kind: "live", channels: [alpha] }],
};
const cataloguePair: ProviderLineup = {
  channels: [alpha, beta],
  categories: [{ key: "News", name: "News", kind: "live", channels: [alpha, beta] }],
};

async function adopt(store: typeof import("../src/stores/lineup"), playlist: Playlist) {
  disk.read.mockResolvedValueOnce(null);
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, catalogue, prepared);
}

async function adoptController(
  controller: import("../src/stores/lineup").LineupController,
  playlist: Playlist,
) {
  disk.read.mockResolvedValueOnce(null);
  const prepared = controller.prepareLineup(playlist);
  await controller.adoptCatalogue(playlist, catalogue, prepared);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  disk.read.mockReset();
  disk.write.mockReset();
  disk.ifAbsent.mockReset();
  disk.remove.mockReset();
  disk.clear.mockReset();
  disk.write.mockResolvedValue();
  disk.ifAbsent.mockResolvedValue(true);
  disk.remove.mockResolvedValue();
  disk.clear.mockResolvedValue();
});

test("an inactive controller edits independently of the active facade", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const lease = await store.acquireLineup(playlistB, "tv");
  await adoptController(lease.controller, playlistB);
  const before = store.useLineup.getState();
  const mutation = lease.controller.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Managed name",
  });
  await vi.runAllTimersAsync();
  assert.equal((await mutation).ok, true);
  assert.equal(lease.controller.store.getState().channels[0]?.name, "Managed name");
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  assert.equal(store.useLineup.getState().revision, before.revision);
  assert.equal(store.useLineup.getState().channels[0]?.name, "Alpha");
  assert.deepEqual(disk.write.mock.calls.at(-1)?.[0], "pl-b");
  await lease.release();
});

test("playback and TV share one engine for the same owner", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const lease = await store.acquireLineup(playlistA, "tv");
  const mutation = lease.controller.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Shared",
  });
  await vi.runAllTimersAsync();
  assert.equal((await mutation).ok, true);
  assert.equal(store.useLineup.getState().channels[0]?.name, "Shared");
  await lease.release();
});

test("a playback switch without management cancels the old owner's pending write", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const pending = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Do not keep",
  });
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  assert.equal((await pending).ok, false);
  assert.equal(disk.write.mock.calls.length, 0);
});

test("a management lease keeps the old engine valid after playback switches", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const lease = await store.acquireLineup(playlistA, "tv");
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  assert.equal(lease.isCurrent(), true);
  const result = lease.controller.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Still managed",
  });
  await vi.runAllTimersAsync();
  assert.equal((await result).ok, true);
  assert.deepEqual(disk.write.mock.calls.at(-1)?.[0], "pl-a");
  await lease.release();
});

test("a stale prepared value cannot adopt into a recreated controller", async () => {
  const store = await import("../src/stores/lineup");
  const stale = store.prepareLineup(playlistA);
  disk.read.mockResolvedValue(null);
  const preparedB = store.prepareLineup(playlistB);
  await store.adoptCatalogue(playlistB, catalogue, preparedB);
  assert.equal(store.useLineup.getState().playlistId, "pl-b");
  await store.adoptCatalogue(playlistA, catalogue, stale);
  assert.equal(store.useLineup.getState().playlistId, "pl-b");
});

test("an evicted controller recreates above the remembered revision floor", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const renamed = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Floor",
  });
  await vi.runAllTimersAsync();
  assert.equal((await renamed).ok, true);
  const first = store.useLineup.getState().revision;
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  const prepared = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  const second = store.useLineup.getState().revision;
  assert.ok(second > first, `expected ${second} > ${first}`);
});

test("a source version change retires the old lease and rejects it", async () => {
  const store = await import("../src/stores/lineup");
  const leaseV1 = await store.acquireLineup(playlistA, "tv");
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  const leaseV2 = await store.acquireLineup(v2, "tv");
  assert.equal(leaseV1.isCurrent(), false);
  assert.equal(leaseV2.isCurrent(), true);
  assert.notEqual(leaseV1.controller.controllerId, leaseV2.controller.controllerId);
  await leaseV2.release();
});

test("remote retirement flushes accepted writes", async () => {
  const store = await import("../src/stores/lineup");
  const lease = await store.acquireLineup(playlistA, "remote");
  await adoptController(lease.controller, playlistA);
  const mutation = lease.controller.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Drained",
  });
  await lease.release();
  assert.equal((await mutation).ok, true);
  assert.deepEqual(disk.write.mock.calls.at(-1)?.[0], "pl-a");
});

test("a failed removal restores the fence so the same version can reload", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  disk.remove.mockRejectedValueOnce(new Error("quota"));
  await assert.rejects(store.removePlaylistLineup(playlistA));
  disk.read.mockResolvedValue(null);
  const prepared = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
});

test("legacy migration never overwrites a concurrent personal record", async () => {
  const store = await import("../src/stores/lineup");
  const racing = { version: 1, revision: 7 };
  const records = new Map<string, unknown>();
  disk.read.mockImplementation(async (id: string) => records.get(id) ?? null);
  disk.ifAbsent.mockImplementation(async (id: string, _value: unknown) => {
    if (records.has(id)) return false;
    records.set(id, racing);
    return false;
  });
  await store.migrateLegacyOrder(playlistA, "alphabetical");
  assert.equal(records.get("pl-a"), racing);
  assert.equal(disk.ifAbsent.mock.calls.length, 1);
  assert.equal(disk.write.mock.calls.length, 0);
});

test("a transient preparation failure clears the cached promise for retry", async () => {
  const store = await import("../src/stores/lineup");
  disk.read.mockRejectedValueOnce(new Error("quota"));
  await assert.rejects(store.prepareLineup(playlistA));
  disk.read.mockResolvedValueOnce(null);
  const prepared = await store.prepareLineup(playlistA);
  assert.equal(prepared.playlistId, "pl-a");
  assert.equal(prepared.hasStored, false);
});

test("a migration finishing during preparation refreshes the personal snapshot", async () => {
  const store = await import("../src/stores/lineup");
  let releaseRead: (value: unknown) => void = () => {};
  let readStarted = false;
  disk.read.mockImplementationOnce(() => {
    readStarted = true;
    return new Promise((resolve) => {
      releaseRead = resolve;
    });
  });
  const prepared = store.prepareLineup(playlistA);
  while (!readStarted) await Promise.resolve();
  let migrated: unknown = null;
  disk.ifAbsent.mockImplementationOnce(async (_id: string, value: unknown) => {
    migrated = value;
    return true;
  });
  disk.read.mockResolvedValueOnce(null);
  const migration = store.migrateLegacyOrder(playlistA, "alphabetical");
  releaseRead(null);
  await migration;
  disk.read.mockResolvedValueOnce(migrated);
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  assert.equal(store.useLineup.getState().categoryOrderModes.live, "alphabetical");
  assert.equal(disk.read.mock.calls.length, 3);
});

test("a revision-zero owner is fenced after eviction and its cursor conflicts", async () => {
  const store = await import("../src/stores/lineup");
  disk.read.mockResolvedValueOnce(null);
  const preparedPair = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, cataloguePair, preparedPair);
  const first = store.useLineup.getState().revision;
  assert.equal(first, 0);
  const page = store.queryLineup({
    playlistId: "pl-a",
    revision: first,
    scope: "channels",
    limit: 1,
  });
  assert.equal(page.ok, true);
  if (!page.ok) return;
  assert.ok(page.page.nextCursor, "expected a next cursor for the second channel");
  const cursor = page.page.nextCursor;
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  const prepared = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  const second = store.useLineup.getState().revision;
  assert.ok(second > first, `expected ${second} > ${first}`);
  const stale = store.queryLineup({
    playlistId: "pl-a",
    revision: second,
    scope: "channels",
    limit: 1,
    cursor: cursor ?? undefined,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.reason, "conflict");
});

test("a failed write rolls back to the revision floor while durable stays old", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const first = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Lost",
  });
  await vi.runAllTimersAsync();
  assert.equal((await first).ok, false);
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  const prepared = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  const adopted = store.useLineup.getState();
  assert.equal(adopted.revision, 2);
  assert.equal(adopted.durableRevision, 0);
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const retry = store.applyLineupMutation(adopted.revision, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Again",
  });
  await vi.runAllTimersAsync();
  const result = await retry;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "persistence");
    assert.equal(result.revision, adopted.revision);
  }
  assert.equal(store.useLineup.getState().revision, adopted.revision);
  assert.equal(store.useLineup.getState().durableRevision, 0);
});

test("returning to a retained owner resubscribes the facade for live mutations", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const lease = await store.acquireLineup(playlistA, "tv");
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  const preparedA = store.prepareLineup(playlistA);
  await store.adoptCatalogue(playlistA, catalogue, preparedA);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  const mutation = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Back",
  });
  await vi.runAllTimersAsync();
  assert.equal((await mutation).ok, true);
  assert.equal(store.useLineup.getState().channels[0]?.name, "Back");
  await lease.release();
});

test("a source upgrade drains every role's accepted write before v2", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const tv = await store.acquireLineup(playlistA, "tv");
  const remote = await store.acquireLineup(playlistA, "remote");
  let releaseWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const mutation = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Pending",
  });
  await vi.runAllTimersAsync();
  disk.read.mockResolvedValue(null);
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  let upgradeSettled = false;
  const upgrade = store.prepareLineup(v2).then((value) => {
    upgradeSettled = true;
    return value;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(upgradeSettled, false);
  releaseWrite();
  const prepared = await upgrade;
  await store.adoptCatalogue(v2, catalogue, prepared);
  assert.equal((await mutation).ok, true);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  assert.equal(tv.isCurrent(), false);
  assert.equal(remote.isCurrent(), false);
  assert.deepEqual(disk.write.mock.calls.at(-1)?.[0], "pl-a");
  await tv.release();
  await remote.release();
});

test("a stale v1 release and acquisition cannot disturb the v2 replacement", async () => {
  const store = await import("../src/stores/lineup");
  const tv1 = await store.acquireLineup(playlistA, "tv");
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  const tv2 = await store.acquireLineup(v2, "tv");
  await tv1.release();
  assert.equal(tv2.isCurrent(), true);
  await assert.rejects(store.acquireLineup(playlistA, "remote"), /sourceBlocked/);
  await assert.rejects(store.prepareLineup(playlistA), /sourceBlocked/);
  disk.read.mockResolvedValue(null);
  const prepared = await store.prepareLineup(v2);
  await store.adoptCatalogue(v2, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  await tv2.release();
});

test("an adoption parked on the migration wait cannot publish after disposal", async () => {
  const store = await import("../src/stores/lineup");
  disk.read.mockResolvedValue(null);
  const prepared = store.prepareLineup(playlistA);
  await prepared;
  const lease = await store.acquireLineup(playlistA, "tv");
  let releaseMigrationRead: (value: unknown) => void = () => {};
  disk.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseMigrationRead = resolve;
      }),
  );
  const migration = store.migrateLegacyOrder(playlistA, "alphabetical");
  const adopting = store.adoptCatalogue(playlistA, catalogue, prepared);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const removing = store.removePlaylistLineup(playlistA);
  releaseMigrationRead(null);
  await migration;
  await removing;
  await adopting;
  assert.equal(lease.controller.store.getState().playlistId, "");
  assert.equal(store.useLineup.getState().playlistId, "");
  await lease.release();
});

test("a slow personal read does not block an unrelated acquisition", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  let releaseRead: (value: unknown) => void = () => {};
  disk.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  const slow = store.prepareLineup(playlistB);
  const lease = await store.acquireLineup(playlistA, "remote");
  assert.equal(lease.isCurrent(), true);
  releaseRead(null);
  await slow;
  await lease.release();
});

test("duplicate migrations share one task that removal waits for", async () => {
  const store = await import("../src/stores/lineup");
  let releaseRead: (value: unknown) => void = () => {};
  disk.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  const first = store.migrateLegacyOrder(playlistA, "alphabetical");
  const second = store.migrateLegacyOrder(playlistA, "alphabetical");
  assert.equal(first, second);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const removing = store.removePlaylistLineup(playlistA);
  let removeDone = false;
  void removing.then(() => {
    removeDone = true;
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(removeDone, false);
  releaseRead(null);
  await first;
  await removing;
  assert.equal(removeDone, true);
});

test("removal blocks every source version until the physical delete finishes", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  let releaseRemove: () => void = () => {};
  disk.remove.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseRemove = resolve;
      }),
  );
  const removing = store.removePlaylistLineup(playlistA);
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  await assert.rejects(store.prepareLineup(v2), /sourceBlocked/);
  await assert.rejects(store.acquireLineup(v2, "tv"), /sourceBlocked/);
  releaseRemove();
  await removing;
  disk.read.mockResolvedValue(null);
  const prepared = await store.prepareLineup(v2);
  await store.adoptCatalogue(v2, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
});

test("a failed removal cannot weaken a newer committed fence", async () => {
  const store = await import("../src/stores/lineup");
  const v3: Playlist = { ...playlistA, sourceVersion: 3 };
  const v4: Playlist = { ...playlistA, sourceVersion: 4 };
  const lease = await store.acquireLineup(v4, "tv");
  let failRemove: () => void = () => {};
  disk.remove.mockImplementationOnce(
    () =>
      new Promise<void>((_resolve, reject) => {
        failRemove = () => reject(new Error("quota"));
      }),
  );
  const removing = store.removePlaylistLineup(v3);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  failRemove();
  await assert.rejects(removing);
  await assert.rejects(store.acquireLineup(v3, "remote"), /sourceBlocked/);
  const lease2 = await store.acquireLineup(v4, "tv");
  assert.equal(lease2.isCurrent(), true);
  await lease.release();
  await lease2.release();
});

test("duplicate resets share one clear boundary", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  let releaseClear: () => void = () => {};
  disk.clear.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseClear = resolve;
      }),
  );
  const first = store.resetLineups([playlistA]);
  const second = store.resetLineups([playlistB]);
  assert.equal(first, second);
  await assert.rejects(store.acquireLineup(playlistA, "tv"), /sourceBlocked/);
  releaseClear();
  await first;
  await second;
  disk.read.mockResolvedValue(null);
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  const prepared = await store.prepareLineup(v2);
  await store.adoptCatalogue(v2, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
});

test("a newer source fence makes the old controller unavailable before retirement", async () => {
  const store = await import("../src/stores/lineup");
  await adopt(store, playlistA);
  const lease = await store.acquireLineup(playlistA, "tv");
  const controller = lease.controller;
  const v2: Playlist = { ...playlistA, sourceVersion: 2 };
  const upgrade = store.prepareLineup(v2);
  assert.equal(controller.disposed, false);
  const queried = controller.queryLineup({
    playlistId: "pl-a",
    revision: 0,
    scope: "channels",
  });
  assert.equal(queried.ok, false);
  if (!queried.ok) assert.equal(queried.reason, "unavailable");
  const mutation = await controller.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Fenced",
  });
  assert.equal(mutation.ok, false);
  if (!mutation.ok) assert.equal(mutation.reason, "unavailable");
  await assert.rejects(controller.prepareLineup(playlistA), /unavailable|disposed/);
  disk.read.mockResolvedValue(null);
  await upgrade;
  await lease.release();
});

test("reopening a playlist waits for its previous drain before recreating", async () => {
  const store = await import("../src/stores/lineup");
  const lease = await store.acquireLineup(playlistA, "remote");
  await adoptController(lease.controller, playlistA);
  let releaseWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const mutation = lease.controller.applyLineupMutation(
    lease.controller.store.getState().revision,
    {
      type: "channel.rename",
      channel: alphaRef,
      name: "Draining",
    },
  );
  await vi.runAllTimersAsync();
  await lease.release();
  disk.read.mockResolvedValue(null);
  await store.prepareLineup(playlistB);
  const readsBefore = disk.read.mock.calls.filter(([id]) => id === "pl-a").length;
  const reopen = store.prepareLineup(playlistA);
  let settled = false;
  void reopen.then(() => {
    settled = true;
  });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(disk.read.mock.calls.filter(([id]) => id === "pl-a").length, readsBefore);
  releaseWrite();
  const prepared = await reopen;
  await store.adoptCatalogue(playlistA, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "pl-a");
  assert.equal((await mutation).ok, true);
});
