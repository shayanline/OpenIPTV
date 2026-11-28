import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import {
  channelRef,
  emptyPersonalisation,
  type LineupSection,
  type ProviderLineup,
  type StoredLineupV1,
} from "../src/services/lineup";
import type { Playlist } from "../src/stores/settings";
import type { LineupQuery, LineupState } from "../src/stores/lineup";

const disk = vi.hoisted(() => ({
  read: vi.fn<() => Promise<unknown | null>>(),
  write: vi.fn<(playlistId: string, value: unknown) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
  ifAbsent: vi.fn<(playlistId: string, value: unknown) => Promise<boolean>>(),
}));

vi.mock("../src/services/personalDisk", () => ({
  readLineup: disk.read,
  writeLineup: disk.write,
  removeLineup: disk.remove,
  clearLineups: disk.clear,
  writeLineupIfAbsent: disk.ifAbsent,
}));

const playlist: Playlist = {
  id: "pl-1",
  name: "One",
  source: { kind: "m3u", url: "http://example.invalid/list.m3u" },
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
  sourceFingerprint: "fedcba9876543210",
};
const alphaRef = channelRef(alpha);
const orphanOverrideKey = `channel-override:${
  channelRef({ ...alpha, sourceFingerprint: "ffffffffffffffff" }).id
}`;
const catalogue: ProviderLineup = {
  channels: [alpha, beta],
  categories: [{ key: "News", name: "News", kind: "live", channels: [alpha, beta] }],
};

const sports = {
  ...alpha,
  id: "c",
  name: "Sports One",
  number: 3,
  group: "Sports",
  categoryKey: "Sports",
  url: "http://example.invalid/c",
  sourceFingerprint: "0011223344556678",
};
const sectioned: ProviderLineup = {
  channels: [alpha, beta, sports],
  categories: [
    { key: "News", name: "News", kind: "live", channels: [alpha, beta] },
    { key: "Sports", name: "Sports", kind: "live", channels: [sports] },
    { key: "movie:10", name: "Films", kind: "movie", channels: [] },
    { key: "movie:11", name: "More Films", kind: "movie", channels: [] },
    { key: "series:20", name: "Shows", kind: "series", channels: [] },
    { key: "series:21", name: "More Shows", kind: "series", channels: [] },
  ],
};

async function loaded(saved: unknown = null, provider: ProviderLineup = catalogue) {
  disk.read.mockResolvedValueOnce(saved);
  const store = await import("../src/stores/lineup");
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, provider, prepared);
  return store;
}

function assertEffectiveReferences(actual: LineupState, expected: LineupState) {
  for (const key of [
    "provider",
    "channels",
    "categories",
    "managedChannels",
    "managedCategories",
    "browsableChannels",
    "searchableChannels",
    "numberIndex",
    "unavailable",
    "categoryOrderModes",
    "itemOrderModes",
  ] as const) {
    assert.equal(actual[key], expected[key], key);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  disk.read.mockReset();
  disk.write.mockReset();
  disk.remove.mockReset();
  disk.clear.mockReset();
  disk.ifAbsent.mockReset();
  disk.ifAbsent.mockResolvedValue(true);
  disk.write.mockResolvedValue();
  disk.remove.mockResolvedValue();
  disk.clear.mockResolvedValue();
});

test("adoption validates partial saved migrations and publishes one effective snapshot", async () => {
  const store = await loaded({
    version: 1,
    revision: 4,
    personalisation: {
      channels: {
        [alphaRef.id]: {
          name: "Mine",
          sourceFingerprint: alpha.sourceFingerprint,
          unknown: true,
        },
      },
      unknown: true,
    },
  });
  assert.equal(store.useLineup.getState().revision, 4);
  assert.equal(store.useLineup.getState().channels[0].name, "Mine");
  assert.equal(store.useLineup.getState().orderMode, "provider");
});

test("stale revisions and invalid mutations leave state unchanged", async () => {
  const store = await loaded();
  const before = store.useLineup.getState();
  assert.deepEqual(
    await store.applyLineupMutation(8, {
      type: "channel.rename",
      channel: alphaRef,
      name: "Mine",
    }),
    {
      ok: false,
      revision: 0,
      reason: "conflict",
    },
  );
  assert.deepEqual(
    await store.applyLineupMutation(0, {
      type: "channel.number",
      channel: alphaRef,
      number: 2,
    }),
    { ok: false, revision: 0, reason: "duplicate-number" },
  );
  assert.equal(store.useLineup.getState().revision, before.revision);
});

test("selecting the current order mode does not increment or write", async () => {
  const store = await loaded();
  assert.deepEqual(
    await store.applyLineupMutation(0, { type: "order.mode", mode: "provider" }),
    { ok: true, revision: 0, affectedIds: [] },
  );
  await vi.runAllTimersAsync();
  assert.equal(disk.write.mock.calls.length, 0);
});

test("a provider number refresh preserves personal shortcuts and reset restores the new provider number", async () => {
  const betaRef = channelRef(beta);
  const store = await loaded({
    version: 1,
    revision: 4,
    personalisation: {
      channels: {
        [betaRef.id]: { number: 801, sourceFingerprint: beta.sourceFingerprint },
      },
    },
  });
  const refreshedAlpha = { ...alpha, number: 801 };
  const refreshedBeta = { ...beta, number: 88 };
  await store.refreshCatalogue(playlist, {
    channels: [refreshedAlpha, refreshedBeta],
    categories: [
      { key: "News", name: "News", kind: "live", channels: [refreshedAlpha, refreshedBeta] },
    ],
  });
  const refreshed = store.useLineup.getState();
  assert.equal(refreshed.numberIndex.get(801)?.id, beta.id);
  assert.equal(
    refreshed.managedChannels.find((channel) => channel.ref.id === betaRef.id)?.providerNumber,
    88,
  );
  assert.deepEqual(
    await store.applyLineupMutation(refreshed.revision, {
      type: "channel.number",
      channel: betaRef,
      number: 801,
    }),
    { ok: true, revision: refreshed.revision, affectedIds: [] },
  );
  const reset = store.applyLineupMutation(refreshed.revision, {
    type: "channel.number",
    channel: betaRef,
    number: null,
  });
  await vi.runAllTimersAsync();
  assert.equal((await reset).ok, true);
  const state = store.useLineup.getState();
  assert.equal(state.numberIndex.get(88)?.id, beta.id);
  assert.equal(state.numberIndex.get(801)?.id, alpha.id);
  const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
  assert.equal(saved.personalisation.channels[betaRef.id], undefined);
});

test("restoring personal category order clears redundant placements but keeps Custom mode", async () => {
  const key = "personal:mine";
  const betaRef = channelRef(beta);
  const store = await loaded({
    version: 1,
    revision: 1,
    personalisation: {
      categories: { [key]: { name: "Chosen name", hidden: true } },
      personalCategories: [{ id: "mine", name: "Mine", channels: [alphaRef, betaRef] }],
    },
  });
  const move = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "personal-category.place-channel",
    categoryId: "mine",
    placement: { itemId: alphaRef.id, afterId: betaRef.id },
  });
  await vi.runAllTimersAsync();
  assert.equal((await move).ok, true);
  assert.equal(store.useLineup.getState().itemOrderModes[key], "custom");

  const restore = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "personal-category.place-channel",
    categoryId: "mine",
    placement: { itemId: alphaRef.id, beforeId: betaRef.id },
  });
  await vi.runAllTimersAsync();
  assert.equal((await restore).ok, true);
  assert.equal(store.useLineup.getState().itemOrderModes[key], "custom");
  const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
  assert.deepEqual(saved.personalisation.categories[key], {
    name: "Chosen name",
    hidden: true,
    itemOrderMode: "custom",
  });
  assert.deepEqual(
    store.useLineup
      .getState()
      .categories.find((category) => category.key === key)
      ?.channels.map((channel) => channel.id),
    [alpha.id, beta.id],
  );
});

test("restoring category provider order compacts placements but keeps Custom mode", async () => {
  const gamma = {
    ...alpha,
    id: "c",
    name: "Gamma",
    number: 3,
    group: "Sports",
    categoryKey: "Sports",
    url: "http://example.invalid/c",
    sourceFingerprint: "0123456789abcdee",
  };
  const twoCategories: ProviderLineup = {
    channels: [alpha, beta, gamma],
    categories: [
      { key: "News", name: "News", kind: "live", channels: [alpha, beta] },
      { key: "Sports", name: "Sports", kind: "live", channels: [gamma] },
    ],
  };
  disk.read.mockResolvedValueOnce({
    version: 1,
    revision: 3,
    personalisation: {
      channels: {
        [alphaRef.id]: { name: "Mine", sourceFingerprint: alpha.sourceFingerprint },
      },
      categoryOrderModes: { live: "provider", movie: "custom", series: "provider" },
      categoryOrders: {
        live: [],
        movie: [{ itemId: "missing-category", beforeId: "missing-anchor" }],
        series: [],
      },
    },
  });
  const store = await import("../src/stores/lineup");
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, twoCategories, prepared);

  const move = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "category.place",
    section: "live",
    placement: { itemId: "Sports", beforeId: "News" },
  });
  await vi.runAllTimersAsync();
  assert.equal((await move).ok, true);
  assert.equal(store.useLineup.getState().categoryOrderModes.live, "custom");

  const restore = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "category.place",
    section: "live",
    placement: { itemId: "Sports", afterId: "News" },
  });
  await vi.runAllTimersAsync();
  assert.equal((await restore).ok, true);
  assert.equal(store.useLineup.getState().revision, 5);
  assert.equal(store.useLineup.getState().categoryOrderModes.live, "custom");

  const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
  assert.deepEqual(saved.personalisation.categoryOrders.live, []);
  assert.equal(saved.personalisation.categoryOrderModes.live, "custom");
  assert.equal(saved.personalisation.categoryOrderModes.movie, "custom");
  assert.deepEqual(saved.personalisation.categoryOrders.movie, [
    { itemId: "missing-category", beforeId: "missing-anchor" },
  ]);
  assert.equal(saved.personalisation.channels[alphaRef.id]?.name, "Mine");
});

test("several optimistic edits coalesce into one idle transaction", async () => {
  const store = await loaded();
  const initial = store.useLineup.getState();
  const first = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Mine",
  });
  const second = store.applyLineupMutation(1, {
    type: "channel.visibility",
    channel: alphaRef,
    hidden: true,
  });
  assert.equal(store.useLineup.getState().revision, 2);
  assert.equal(store.useLineup.getState().channels[0].name, "Mine");
  const optimistic = store.useLineup.getState();
  assert.notEqual(optimistic.channels, initial.channels);
  assert.equal(optimistic.durableRevision, 0);
  assert.equal(optimistic.saving, true);
  await vi.runAllTimersAsync();
  assert.equal(disk.write.mock.calls.length, 1);
  const written = disk.write.mock.calls[0][1] as StoredLineupV1;
  assert.equal(written.revision, 2);
  assert.equal(written.personalisation.channels[alphaRef.id].hidden, true);
  assert.deepEqual(await first, { ok: true, revision: 1, affectedIds: [alphaRef.id] });
  assert.deepEqual(await second, { ok: true, revision: 2, affectedIds: [alphaRef.id] });
  const acknowledged = store.useLineup.getState();
  assert.equal(acknowledged.revision, 2);
  assert.equal(acknowledged.durableRevision, 2);
  assert.equal(acknowledged.saving, false);
  assert.equal(acknowledged.saveError, "");
  assertEffectiveReferences(acknowledged, optimistic);
});

test("channel bulk visibility covers every member once and rolls back whole", async () => {
  const extraNews = Array.from({ length: 49 }, (_, index) => {
    const serial = index + 3;
    return {
      ...alpha,
      id: `n${serial}`,
      name: `News ${serial}`,
      number: serial,
      url: `http://example.invalid/n${serial}`,
      sourceFingerprint: serial.toString(16).padStart(16, "0"),
    };
  });
  const gamma = {
    ...alpha,
    id: "c",
    name: "Gamma",
    number: 60,
    group: "Sport",
    categoryKey: "Sport",
    url: "http://example.invalid/c",
    sourceFingerprint: "0011223344556677",
  };
  const wide: ProviderLineup = {
    channels: [...catalogue.channels, ...extraNews, gamma],
    categories: [
      {
        key: "News",
        name: "News",
        kind: "live",
        channels: [alpha, beta, ...extraNews],
      },
      { key: "Sport", name: "Sport", kind: "live", channels: [gamma] },
      { key: "Empty", name: "Empty", kind: "live", channels: [] },
    ],
  };
  disk.read.mockResolvedValueOnce(null);
  const store = await import("../src/stores/lineup");
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, wide, prepared);
  const gammaRef = channelRef(gamma);
  const newsRefs = [alpha, beta, ...extraNews].map((channel) => channelRef(channel));
  assert.equal(newsRefs.length, 51);
  const revision = store.useLineup.getState().revision;

  for (const bad of ["Missing", "favourites", "Empty"]) {
    assert.deepEqual(
      await store.applyLineupMutation(revision, {
        type: "channels.visibility",
        categoryKey: bad,
        hidden: true,
      }),
      { ok: false, revision, reason: "unavailable" },
    );
  }
  assert.equal(store.useLineup.getState().revision, revision);

  // Name and number overrides on a member must survive the bulk write.
  const rename = store.applyLineupMutation(revision, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Mine",
  });
  const numberEdit = store.applyLineupMutation(revision + 1, {
    type: "channel.number",
    channel: alphaRef,
    number: 99,
  });
  await vi.runAllTimersAsync();
  assert.equal((await rename).ok, true);
  assert.equal((await numberEdit).ok, true);
  const base = store.useLineup.getState().revision;
  const writesBeforeBulk = disk.write.mock.calls.length;

  const hide = store.applyLineupMutation(base, {
    type: "channels.visibility",
    categoryKey: "News",
    hidden: true,
  });
  await vi.runAllTimersAsync();
  assert.deepEqual(await hide, {
    ok: true,
    revision: base + 1,
    affectedIds: ["News"],
  });
  assert.equal(disk.write.mock.calls.length, writesBeforeBulk + 1);
  const hiddenState = store.useLineup.getState();
  assert.equal(hiddenState.revision, base + 1);
  const byId = new Map(hiddenState.managedChannels.map((item) => [item.ref.id, item]));
  for (const ref of newsRefs) {
    assert.equal(byId.get(ref.id)?.hidden, true, ref.id);
  }
  assert.notEqual(byId.get(gammaRef.id)?.hidden, true);
  assert.equal(byId.get(alphaRef.id)?.effective.name, "Mine");
  assert.equal(byId.get(alphaRef.id)?.effective.number, 99);
  const hiddenWrite = disk.write.mock.calls[
    disk.write.mock.calls.length - 1
  ][1] as StoredLineupV1;
  assert.equal(hiddenWrite.personalisation.channels[alphaRef.id].name, "Mine");
  assert.equal(hiddenWrite.personalisation.channels[alphaRef.id].number, 99);
  assert.equal(
    hiddenWrite.personalisation.channels[alphaRef.id].sourceFingerprint,
    alpha.sourceFingerprint,
  );
  assert.equal(hiddenWrite.personalisation.channels[alphaRef.id].hidden, true);
  for (const ref of newsRefs.slice(1)) {
    assert.equal(hiddenWrite.personalisation.channels[ref.id].hidden, true, ref.id);
  }
  assert.equal(hiddenWrite.personalisation.channels[gammaRef.id], undefined);

  const show = store.applyLineupMutation(base + 1, {
    type: "channels.visibility",
    categoryKey: "News",
    hidden: false,
  });
  await vi.runAllTimersAsync();
  assert.deepEqual(await show, {
    ok: true,
    revision: base + 2,
    affectedIds: ["News"],
  });
  assert.equal(disk.write.mock.calls.length, writesBeforeBulk + 2);
  const shownWrite = disk.write.mock.calls[
    disk.write.mock.calls.length - 1
  ][1] as StoredLineupV1;
  assert.equal("hidden" in shownWrite.personalisation.channels[alphaRef.id], false);
  assert.equal(shownWrite.personalisation.channels[alphaRef.id].name, "Mine");
  assert.equal(shownWrite.personalisation.channels[alphaRef.id].number, 99);
  assert.equal(
    shownWrite.personalisation.channels[alphaRef.id].sourceFingerprint,
    alpha.sourceFingerprint,
  );
  assert.equal(shownWrite.personalisation.channels[channelRef(beta).id], undefined);
  const shownState = store.useLineup.getState();
  const shownById = new Map(shownState.managedChannels.map((item) => [item.ref.id, item]));
  for (const ref of newsRefs) {
    assert.notEqual(shownById.get(ref.id)?.hidden, true, ref.id);
  }
  assert.notEqual(shownById.get(gammaRef.id)?.hidden, true);
});

test("a failed channel bulk write restores every member override", async () => {
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const store = await loaded({
    version: 1,
    revision: 4,
    personalisation: {
      channels: {
        [alphaRef.id]: {
          name: "Durable",
          number: 7,
          sourceFingerprint: alpha.sourceFingerprint,
        },
      },
    },
  });
  const mutation = store.applyLineupMutation(4, {
    type: "channels.visibility",
    categoryKey: "News",
    hidden: true,
  });
  await vi.runAllTimersAsync();
  assert.deepEqual(await mutation, { ok: false, reason: "persistence", revision: 4 });
  const state = store.useLineup.getState();
  assert.equal(state.revision, 4);
  for (const channel of state.managedChannels) {
    assert.notEqual(channel.hidden, true);
  }
  const restored = state.managedChannels.find((channel) => channel.ref.id === alphaRef.id);
  assert.equal(restored?.effective.name, "Durable");
  assert.equal(restored?.effective.number, 7);
});

test("a failed batch restores the latest durable revision and effective lineup", async () => {
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const store = await loaded({
    version: 1,
    revision: 4,
    personalisation: {
      channels: {
        [alphaRef.id]: { name: "Durable", sourceFingerprint: alpha.sourceFingerprint },
      },
    },
  });
  const first = store.applyLineupMutation(4, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Optimistic",
  });
  const second = store.applyLineupMutation(5, {
    type: "channel.visibility",
    channel: alphaRef,
    hidden: true,
  });
  const optimistic = store.useLineup.getState();
  assert.equal(optimistic.channels[0].name, "Optimistic");
  assert.equal(
    optimistic.browsableChannels.some((channel) => channel.id === "a"),
    false,
  );
  await vi.runAllTimersAsync();
  assert.deepEqual(await first, { ok: false, reason: "persistence", revision: 4 });
  assert.deepEqual(await second, { ok: false, reason: "persistence", revision: 4 });
  assert.equal(store.useLineup.getState().channels[0].name, "Durable");
  assert.equal(store.useLineup.getState().revision, 4);
  assert.equal(store.useLineup.getState().durableRevision, 4);
  assert.equal(store.useLineup.getState().saveError, "lineup.persistenceFailed");
  const rolledBack = store.useLineup.getState();
  assert.equal(rolledBack.saving, false);
  assert.notEqual(rolledBack.channels, optimistic.channels);
  assert.notEqual(rolledBack.categories, optimistic.categories);
  assert.notEqual(rolledBack.managedChannels, optimistic.managedChannels);
  assert.notEqual(rolledBack.managedCategories, optimistic.managedCategories);
  assert.equal(
    rolledBack.browsableChannels.some((channel) => channel.id === "a"),
    true,
  );
  assert.equal(rolledBack.numberIndex.get(1)?.name, "Durable");
});

test("a unique reconciled fingerprint increments and persists the reseated revision", async () => {
  const saved = {
    version: 1,
    revision: 2,
    personalisation: {
      channels: { old: { name: "Mine", sourceFingerprint: alpha.sourceFingerprint } },
    },
  };
  disk.read.mockResolvedValueOnce(saved);
  const store = await import("../src/stores/lineup");
  const moved = { ...alpha, sourceFingerprint: `${alpha.sourceFingerprint}00000002` };
  const movedCatalogue: ProviderLineup = {
    channels: [moved, beta],
    categories: [{ key: "News", name: "News", kind: "live", channels: [moved, beta] }],
  };
  await store.adoptCatalogue(playlist, movedCatalogue, store.prepareLineup(playlist));
  assert.equal(store.useLineup.getState().revision, 3);
  assert.equal(store.useLineup.getState().channels[0].name, "Mine");
  await vi.runAllTimersAsync();
  const written = disk.write.mock.calls[0][1] as StoredLineupV1;
  assert.equal(written.revision, 3);
  assert.equal(written.personalisation.channels[channelRef(moved).id].name, "Mine");
});

test("an older prepared playlist cannot replace a newer owner", async () => {
  let settleFirst: (value: unknown) => void = () => {};
  disk.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
  );
  disk.read.mockResolvedValueOnce(null);
  const store = await import("../src/stores/lineup");
  const first = store.prepareLineup(playlist);
  const secondPlaylist = { ...playlist, id: "pl-2", name: "Two" };
  const second = store.prepareLineup(secondPlaylist);
  await store.adoptCatalogue(secondPlaylist, catalogue, second);
  settleFirst(null);
  await store.adoptCatalogue(playlist, catalogue, first);
  assert.equal(store.useLineup.getState().playlistId, "pl-2");
});

test("personal category limits and memberships preserve provider categories", async () => {
  const store = await loaded();
  for (let index = 0; index < 128; index += 1) {
    void store.applyLineupMutation(store.useLineup.getState().revision, {
      type: "personal-category.create",
      name: `Personal ${index}`,
    });
  }
  assert.equal(
    store.useLineup.getState().categories.filter((category) => category.personal).length,
    128,
  );
  assert.deepEqual(
    await store.applyLineupMutation(store.useLineup.getState().revision, {
      type: "personal-category.create",
      name: "Too many",
    }),
    { ok: false, revision: 128, reason: "limit" },
  );
  const personal = store.useLineup.getState().categories.find((category) => category.personal);
  const id = personal?.key.slice("personal:".length) ?? "";
  void store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "personal-category.memberships",
    channel: alphaRef,
    categoryIds: [id],
  });
  const state = store.useLineup.getState();
  assert.equal(
    state.categories.find((category) => category.key === personal?.key)?.channels[0].id,
    "a",
  );
  assert.equal(
    state.categories.find((category) => category.key === "News")?.channels[0].id,
    "a",
  );
});

test("an edit arriving during an in flight write persists in the next serial batch", async () => {
  let completeFirst: () => void = () => {};
  disk.write
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeFirst = resolve;
        }),
    )
    .mockResolvedValueOnce();
  const store = await loaded();
  const first = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "First",
  });
  await vi.runAllTimersAsync();
  const second = store.applyLineupMutation(1, {
    type: "channel.visibility",
    channel: alphaRef,
    hidden: true,
  });
  const optimistic = store.useLineup.getState();
  assert.equal(optimistic.durableRevision, 0);
  completeFirst();
  assert.equal((await first).ok, true);
  const firstAcknowledged = store.useLineup.getState();
  assert.equal(firstAcknowledged.revision, 2);
  assert.equal(firstAcknowledged.durableRevision, 1);
  assert.equal(firstAcknowledged.saving, true);
  assert.equal(firstAcknowledged.saveError, "");
  assert.equal(
    firstAcknowledged.browsableChannels.some((channel) => channel.id === "a"),
    false,
  );
  assertEffectiveReferences(firstAcknowledged, optimistic);
  assert.equal(disk.write.mock.calls.length, 1);
  await vi.runAllTimersAsync();
  assert.equal((await second).ok, true);
  assert.equal(disk.write.mock.calls.length, 2);
  const secondAcknowledged = store.useLineup.getState();
  assert.equal(secondAcknowledged.revision, 2);
  assert.equal(secondAcknowledged.durableRevision, 2);
  assert.equal(secondAcknowledged.saving, false);
  assert.equal(secondAcknowledged.saveError, "");
  assertEffectiveReferences(secondAcknowledged, optimistic);
});

test("a stale write completion cannot publish over a newer playlist owner", async () => {
  let completeWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeWrite = resolve;
      }),
  );
  const store = await loaded();
  const mutation = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Old owner",
  });
  await vi.runAllTimersAsync();
  disk.read.mockResolvedValueOnce(null);
  const secondPlaylist = { ...playlist, id: "pl-2", name: "Two" };
  const prepared = store.prepareLineup(secondPlaylist);
  await store.adoptCatalogue(secondPlaylist, catalogue, prepared);
  assert.deepEqual(await mutation, { ok: false, reason: "persistence", revision: 0 });
  const currentOwner = store.useLineup.getState();
  completeWrite();
  await Promise.resolve();
  assert.equal(store.useLineup.getState(), currentOwner);
  assert.equal(store.useLineup.getState().playlistId, "pl-2");
  assert.equal(store.useLineup.getState().channels[0].name, "Alpha");
});

test("a failed draft can be submitted again without duplicate state", async () => {
  disk.write.mockRejectedValueOnce(new Error("quota")).mockResolvedValueOnce();
  const store = await loaded();
  const failed = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Retained draft",
  });
  await vi.runAllTimersAsync();
  assert.equal((await failed).ok, false);
  const retry = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Retained draft",
  });
  await vi.runAllTimersAsync();
  assert.equal((await retry).ok, true);
  const saved = disk.write.mock.calls[1][1] as StoredLineupV1;
  assert.equal(saved.personalisation.channels[alphaRef.id].name, "Retained draft");
});

test("category refreshes around a pending write retain the latest effective views", async () => {
  let completeWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeWrite = resolve;
      }),
  );
  const store = await loaded();
  const mutation = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Pending",
  });
  await store.adoptCategorySummaries(playlist, [
    { key: "movie:1", name: "Movies", kind: "movie", channels: [] },
  ]);
  assert.equal(store.useLineup.getState().revision, 2);
  assert.equal(store.useLineup.getState().channels[0].name, "Pending");
  await vi.runAllTimersAsync();
  assert.equal(disk.write.mock.calls.length, 1);
  await store.adoptCategorySummaries(playlist, [
    { key: "movie:1", name: "Latest Movies", kind: "movie", channels: [] },
  ]);
  assert.equal(store.useLineup.getState().channels[0].name, "Pending");
  assert.equal(store.useLineup.getState().durableRevision, 0);
  const refreshed = store.useLineup.getState();
  assert.equal(refreshed.revision, 3);
  assert.equal(
    refreshed.categories.find((category) => category.key === "movie:1")?.name,
    "Latest Movies",
  );
  completeWrite();
  await vi.runAllTimersAsync();
  assert.equal((await mutation).ok, true);
  const acknowledged = store.useLineup.getState();
  assert.equal(acknowledged.channels[0].name, "Pending");
  assert.equal(acknowledged.revision, 3);
  assert.equal(acknowledged.durableRevision, 1);
  assert.equal(acknowledged.saving, false);
  assertEffectiveReferences(acknowledged, refreshed);
});

test("pending and in flight writes are drained before remove and reset", async () => {
  const store = await loaded();
  const pending = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Pending removal",
  });
  await store.removePlaylistLineup(playlist);
  assert.equal((await pending).ok, false);
  assert.equal(disk.write.mock.calls.length, 0);

  disk.read.mockResolvedValueOnce(null);
  const replayed = { ...playlist, sourceVersion: 2 };
  const prepared = store.prepareLineup(replayed);
  await store.adoptCatalogue(replayed, catalogue, prepared);
  let completeWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeWrite = resolve;
      }),
  );
  const inFlight = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Pending reset",
  });
  await vi.runAllTimersAsync();
  const reset = store.resetLineups([playlist]);
  assert.equal((await inFlight).ok, false);
  assert.equal(disk.clear.mock.calls.length, 0);
  completeWrite();
  await reset;
  assert.equal(disk.clear.mock.calls.length, 1);
  assert.equal(store.useLineup.getState().playlistId, "");
});

test("removal detaches the owner before an active write completes", async () => {
  let completeWrite: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeWrite = resolve;
      }),
  );
  const store = await loaded();
  void store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Pending",
  });
  await vi.runAllTimersAsync();
  const removal = store.removePlaylistLineup(playlist);
  assert.equal(store.useLineup.getState().playlistId, "");
  assert.deepEqual(await store.applyLineupMutation(1, { type: "order.mode", mode: "number" }), {
    ok: false,
    revision: 1,
    reason: "unavailable",
  });
  completeWrite();
  await removal;
  assert.equal(disk.write.mock.calls.length, 1);
  assert.equal(disk.remove.mock.calls.length, 1);
});

test("a prepared read cannot adopt after its playlist is removed", async () => {
  let completeRead: (value: unknown) => void = () => {};
  disk.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        completeRead = resolve;
      }),
  );
  const store = await import("../src/stores/lineup");
  const prepared = store.prepareLineup(playlist);
  const removal = store.removePlaylistLineup(playlist);
  completeRead(null);
  await removal;
  await store.adoptCatalogue(playlist, catalogue, prepared);
  assert.equal(store.useLineup.getState().playlistId, "");
  assert.equal(disk.write.mock.calls.length, 0);
});

test("pageLineupItems applies bounded offsets and keeps cursor identity", async () => {
  const store = await loaded();
  const items = [1, 2, 3, 4, 5].map((index) => ({
    kind: "category" as const,
    id: `c${index}`,
    name: `Cat ${index}`,
    providerName: `Cat ${index}`,
    hidden: false,
    count: 1,
    unavailableCount: 0,
  }));
  const base = { playlistId: playlist.id, revision: 0, scope: "categories" as const };
  const page = (extra: Partial<LineupQuery>) =>
    store.pageLineupItems({ ...base, ...extra }, items);
  const ids = (result: ReturnType<typeof page>) =>
    result.ok ? result.page.items.map((item) => item.id) : [];

  const first = page({ offset: 0, limit: 2 });
  assert.equal(first.ok, true);
  assert.deepEqual(ids(first), ["c1", "c2"]);
  assert.ok(first.ok && first.page.nextCursor);
  const second = page({ offset: 2, limit: 2 });
  assert.equal(second.ok, true);
  assert.deepEqual(ids(second), ["c3", "c4"]);
  assert.ok(second.ok && second.page.nextCursor);
  const last = page({ offset: 4, limit: 2 });
  assert.equal(last.ok, true);
  assert.deepEqual(ids(last), ["c5"]);
  assert.ok(last.ok && last.page.nextCursor === null);
  const unpaged = page({ offset: 0 });
  assert.equal(unpaged.ok, true);
  assert.equal(unpaged.ok && unpaged.page.items.length, 5);
  assert.equal(unpaged.ok && unpaged.page.nextCursor, null);

  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, 5, 6]) {
    assert.deepEqual(page({ offset }), { ok: false, reason: "invalid", revision: 0 });
  }
  const firstCursor = first.ok ? (first.page.nextCursor ?? "") : "";
  assert.deepEqual(page({ cursor: firstCursor, offset: 2 }), {
    ok: false,
    reason: "invalid",
    revision: 0,
  });
  const viaCursor = page({ cursor: firstCursor, limit: 2 });
  assert.equal(viaCursor.ok, true);
  assert.deepEqual(ids(viaCursor), ["c3", "c4"]);
  assert.deepEqual(store.pageLineupItems({ ...base, revision: 1, offset: 0 }, items), {
    ok: false,
    reason: "conflict",
    revision: 0,
  });
  const empty = store.pageLineupItems({ ...base, offset: 0 }, []);
  assert.equal(empty.ok, true);
  assert.equal(empty.ok && empty.page.items.length, 0);
  assert.equal(empty.ok && empty.page.total, 0);
  assert.deepEqual(store.pageLineupItems({ ...base, offset: 1 }, []), {
    ok: false,
    reason: "invalid",
    revision: 0,
  });
});

test("playlist removal and full reset use the personal database boundaries", async () => {
  const store = await loaded();
  await store.removePlaylistLineup(playlist);
  assert.deepEqual(disk.remove.mock.calls[0], ["pl-1"]);
  await store.resetLineups([playlist]);
  assert.equal(disk.clear.mock.calls.length, 1);
});

test("live category queries surface unavailable channel overrides only for live", async () => {
  const sections: ProviderLineup = {
    channels: [alpha, beta],
    categories: [
      { key: "News", name: "News", kind: "live", channels: [alpha, beta] },
      { key: "Films", name: "Films", kind: "movie", channels: [] },
      { key: "Shows", name: "Shows", kind: "series", channels: [] },
    ],
  };
  disk.read.mockResolvedValueOnce({
    version: 1,
    revision: 0,
    personalisation: {
      channels: {
        gone: { name: "Gone channel", sourceFingerprint: "ffffffffffffffff" },
      },
    },
  });
  const store = await import("../src/stores/lineup");
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, sections, prepared);
  const revision = store.useLineup.getState().revision;
  assert.equal(
    store.useLineup.getState().unavailable.some((record) => record.key === orphanOverrideKey),
    true,
  );

  const query = (extra: Partial<LineupQuery>) =>
    store.queryLineup({ playlistId: playlist.id, revision, scope: "categories", ...extra });
  const unavailableKeys = (result: ReturnType<typeof query>) =>
    result.ok
      ? result.page.items.flatMap((item) => (item.kind === "unavailable" ? [item.key] : []))
      : null;

  const live = query({ contentKind: "live" });
  assert.deepEqual(unavailableKeys(live), [orphanOverrideKey]);
  assert.ok(live.ok && live.page.items.some((item) => item.kind === "category"));

  for (const contentKind of ["movie", "series"] as const) {
    const result = query({ contentKind });
    assert.deepEqual(unavailableKeys(result), []);
    assert.ok(result.ok && result.page.items.some((item) => item.kind === "category"));
  }

  const scoped = store.queryLineup({
    playlistId: playlist.id,
    revision,
    scope: "channels",
    categoryKey: "News",
  });
  assert.deepEqual(unavailableKeys(scoped), []);
});

test.each(["live", "movie", "series"] as const)(
  "category order reset restores provider order for %s only",
  async (section) => {
    const betaRef = channelRef(beta);
    const store = await loaded(
      {
        version: 1,
        revision: 6,
        personalisation: {
          channels: {
            [alphaRef.id]: {
              name: "Mine",
              number: 40,
              hidden: true,
              sourceFingerprint: alpha.sourceFingerprint,
            },
          },
          categories: {
            News: {
              name: "Headlines",
              hidden: true,
              itemOrderMode: "custom",
              itemOrder: [{ itemId: betaRef.id, beforeId: alphaRef.id }],
            },
            "movie:10": {
              itemOrderMode: "custom",
              itemOrder: [{ itemId: "movie:b", beforeId: "movie:a" }],
            },
            "personal:mine": { name: "Chosen" },
          },
          categoryOrderModes: { live: "custom", movie: "custom", series: "custom" },
          categoryOrders: {
            live: [{ itemId: "Sports", beforeId: "News" }],
            movie: [{ itemId: "movie:11", beforeId: "movie:10" }],
            series: [
              { itemId: "series:21", beforeId: "series:20" },
              { itemId: "missing", beforeId: "anchor" },
            ],
          },
          personalCategories: [{ id: "mine", name: "Mine", channels: [alphaRef, betaRef] }],
        },
      },
      sectioned,
    );

    const providerKeys = () =>
      store.useLineup
        .getState()
        .categories.filter((category) => category.kind === section && !category.personal)
        .map((category) => category.key);
    const expectedProvider = {
      live: ["News", "Sports"],
      movie: ["movie:10", "movie:11"],
      series: ["series:20", "series:21"],
    }[section];
    const expectedCustom = {
      live: ["Sports", "News"],
      movie: ["movie:11", "movie:10"],
      series: ["series:21", "series:20"],
    }[section];
    assert.deepEqual(providerKeys(), expectedCustom);

    const reset = store.applyLineupMutation(6, {
      type: "category-order.reset",
      section,
    });
    await vi.runAllTimersAsync();
    assert.deepEqual(await reset, {
      ok: true,
      revision: 7,
      affectedIds: [`categoryOrderMode:${section}`],
    });
    assert.deepEqual(providerKeys(), expectedProvider);

    const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
    assert.equal(saved.revision, 7);
    assert.deepEqual(saved.personalisation.categoryOrderModes, {
      live: section === "live" ? "provider" : "custom",
      movie: section === "movie" ? "provider" : "custom",
      series: section === "series" ? "provider" : "custom",
    });
    assert.deepEqual(saved.personalisation.categoryOrders, {
      live: section === "live" ? [] : [{ itemId: "Sports", beforeId: "News" }],
      movie: section === "movie" ? [] : [{ itemId: "movie:11", beforeId: "movie:10" }],
      series:
        section === "series"
          ? []
          : [
              { itemId: "series:21", beforeId: "series:20" },
              { itemId: "missing", beforeId: "anchor" },
            ],
    });
    assert.deepEqual(saved.personalisation.channels[alphaRef.id], {
      name: "Mine",
      number: 40,
      hidden: true,
      sourceFingerprint: alpha.sourceFingerprint,
    });
    assert.deepEqual(saved.personalisation.categories.News, {
      name: "Headlines",
      hidden: true,
      itemOrderMode: "custom",
      itemOrder: [{ itemId: betaRef.id, beforeId: alphaRef.id }],
    });
    assert.deepEqual(saved.personalisation.categories["movie:10"], {
      itemOrderMode: "custom",
      itemOrder: [{ itemId: "movie:b", beforeId: "movie:a" }],
    });
    assert.deepEqual(saved.personalisation.categories["personal:mine"], {
      name: "Chosen",
    });
    assert.deepEqual(saved.personalisation.personalCategories, [
      { id: "mine", name: "Mine", channels: [alphaRef, betaRef] },
    ]);

    const again = store.applyLineupMutation(store.useLineup.getState().revision, {
      type: "category-order.mode",
      section,
      mode: "custom",
    });
    await vi.runAllTimersAsync();
    assert.equal((await again).ok, true);
    assert.deepEqual(providerKeys(), expectedProvider);
    const reseeded = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
    assert.deepEqual(reseeded.personalisation.categoryOrders[section], []);
  },
);

test.each([
  {
    key: "News",
    entries: [
      { id: alphaRef.id, name: "Alpha" },
      { id: channelRef(beta).id, name: "Beta" },
    ],
  },
  {
    key: "movie:10",
    entries: [
      { id: "movie:a", name: "Movie A" },
      { id: "movie:b", name: "Movie B" },
    ],
  },
  {
    key: "series:20",
    entries: [
      { id: "series:a", name: "Series A" },
      { id: "series:b", name: "Series B" },
    ],
  },
])("item order reset restores provider order for $key", async ({ key, entries }) => {
  const betaRef = channelRef(beta);
  const pairFor = (categoryKey: string): [string, string] =>
    categoryKey === "News"
      ? [alphaRef.id, betaRef.id]
      : categoryKey === "movie:10"
        ? ["movie:a", "movie:b"]
        : ["series:a", "series:b"];
  const itemSeed = (categoryKey: string) => {
    const [first, second] = pairFor(categoryKey);
    return {
      itemOrderMode: "custom" as const,
      itemOrder: [{ itemId: second, beforeId: first }],
      ...(categoryKey === key ? { name: "Renamed", hidden: true } : {}),
    };
  };
  const store = await loaded(
    {
      version: 1,
      revision: 5,
      personalisation: {
        channels: {
          [alphaRef.id]: {
            name: "Mine",
            number: 40,
            hidden: true,
            sourceFingerprint: alpha.sourceFingerprint,
          },
        },
        categories: {
          News: itemSeed("News"),
          "movie:10": itemSeed("movie:10"),
          "movie:11": {
            itemOrderMode: "custom",
            itemOrder: [{ itemId: "movie:c", beforeId: "movie:d" }],
          },
          "series:20": itemSeed("series:20"),
          "personal:mine": { name: "Chosen" },
        },
        categoryOrderModes: { live: "custom", movie: "provider", series: "provider" },
        categoryOrders: {
          live: [{ itemId: "Sports", beforeId: "News" }],
          movie: [],
          series: [],
        },
        personalCategories: [{ id: "mine", name: "Mine", channels: [alphaRef, betaRef] }],
      },
    },
    sectioned,
  );

  const frozen = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  const orderNames = () =>
    store
      .orderedCategoryItems(
        key,
        frozen,
        (item) => item.id,
        (item) => item.name,
      )
      .map((item) => item.name);
  assert.deepEqual(orderNames(), [entries[1].name, entries[0].name]);
  if (key === "News") {
    const news = store.useLineup
      .getState()
      .categories.find((category) => category.key === "News");
    assert.deepEqual(
      news?.channels.map((channel) => channel.id),
      ["b", "a"],
    );
  }

  const revision = store.useLineup.getState().revision;
  const reset = store.applyLineupMutation(revision, {
    type: "item-order.reset",
    categoryKey: key,
  });
  await vi.runAllTimersAsync();
  assert.deepEqual(await reset, {
    ok: true,
    revision: revision + 1,
    affectedIds: [key],
  });
  assert.deepEqual(orderNames(), [entries[0].name, entries[1].name]);
  if (key === "News") {
    const news = store.useLineup
      .getState()
      .categories.find((category) => category.key === "News");
    assert.deepEqual(
      news?.channels.map((channel) => channel.id),
      ["a", "b"],
    );
  }

  const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
  assert.deepEqual(saved.personalisation.categories[key], {
    name: "Renamed",
    hidden: true,
    itemOrderMode: "provider",
  });
  for (const other of ["News", "movie:10", "series:20"] as const) {
    if (other === key) continue;
    const [first, second] = pairFor(other);
    assert.deepEqual(saved.personalisation.categories[other], {
      itemOrderMode: "custom",
      itemOrder: [{ itemId: second, beforeId: first }],
    });
  }
  assert.deepEqual(saved.personalisation.categories["movie:11"], {
    itemOrderMode: "custom",
    itemOrder: [{ itemId: "movie:c", beforeId: "movie:d" }],
  });
  assert.deepEqual(saved.personalisation.categories["personal:mine"], {
    name: "Chosen",
  });
  assert.deepEqual(saved.personalisation.channels[alphaRef.id], {
    name: "Mine",
    number: 40,
    hidden: true,
    sourceFingerprint: alpha.sourceFingerprint,
  });
  assert.deepEqual(saved.personalisation.categoryOrders.live, [
    { itemId: "Sports", beforeId: "News" },
  ]);
  assert.deepEqual(saved.personalisation.personalCategories, [
    { id: "mine", name: "Mine", channels: [alphaRef, betaRef] },
  ]);

  const writesBefore = disk.write.mock.calls.length;
  const repeatRevision = store.useLineup.getState().revision;
  const repeat = store.applyLineupMutation(repeatRevision, {
    type: "item-order.reset",
    categoryKey: key,
  });
  await vi.runAllTimersAsync();
  assert.deepEqual(await repeat, {
    ok: true,
    revision: repeatRevision,
    affectedIds: [],
  });
  assert.equal(store.useLineup.getState().revision, repeatRevision);
  assert.equal(disk.write.mock.calls.length, writesBefore);

  const custom = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "item-order.mode",
    categoryKey: key,
    mode: "custom",
  });
  await vi.runAllTimersAsync();
  assert.equal((await custom).ok, true);
  assert.deepEqual(orderNames(), [entries[0].name, entries[1].name]);
});

test("order resets reject stale revisions, unknown categories and invalid sections", async () => {
  const store = await loaded(null, sectioned);
  const revision = store.useLineup.getState().revision;
  const writes = disk.write.mock.calls.length;
  assert.deepEqual(
    await store.applyLineupMutation(revision + 3, {
      type: "category-order.reset",
      section: "live",
    }),
    { ok: false, revision, reason: "conflict" },
  );
  assert.deepEqual(
    await store.applyLineupMutation(revision, {
      type: "item-order.reset",
      categoryKey: "missing",
    }),
    { ok: false, revision, reason: "unavailable" },
  );
  assert.deepEqual(
    await store.applyLineupMutation(revision, {
      type: "category-order.reset",
      section: "sideways" as LineupSection,
    }),
    { ok: false, revision, reason: "invalid" },
  );
  await vi.runAllTimersAsync();
  assert.equal(store.useLineup.getState().revision, revision);
  assert.equal(disk.write.mock.calls.length, writes);
});

function fullResetSeed(): StoredLineupV1["personalisation"] {
  const betaRef = channelRef(beta);
  return {
    channels: {
      [alphaRef.id]: {
        name: "Mine",
        number: 40,
        hidden: true,
        sourceFingerprint: alpha.sourceFingerprint,
      },
      gone: { name: "Gone", sourceFingerprint: "ffffffffffffffff" },
    },
    categories: {
      News: {
        name: "Headlines",
        hidden: true,
        itemOrderMode: "custom",
        itemOrder: [{ itemId: betaRef.id, beforeId: alphaRef.id }],
      },
      "movie:10": {
        name: "Films custom",
        hidden: true,
        itemOrderMode: "custom",
        itemOrder: [{ itemId: "movie:b", beforeId: "movie:a" }],
      },
      "series:20": {
        name: "Shows custom",
        hidden: true,
        itemOrderMode: "custom",
        itemOrder: [{ itemId: "series:b", beforeId: "series:a" }],
      },
      "personal:mine": { name: "Chosen" },
    },
    categoryOrderModes: { live: "custom", movie: "custom", series: "custom" },
    categoryOrders: {
      live: [{ itemId: "Sports", beforeId: "News" }],
      movie: [{ itemId: "movie:11", beforeId: "movie:10" }],
      series: [
        { itemId: "series:21", beforeId: "series:20" },
        { itemId: "missing", beforeId: "anchor" },
      ],
    },
    personalCategories: [{ id: "mine", name: "Mine", channels: [alphaRef, betaRef] }],
  };
}

function assertFullResetSeeded(state: LineupState) {
  const alphaChannel = state.channels.find((channel) => channel.id === "a")!;
  assert.equal(alphaChannel.name, "Mine");
  assert.equal(alphaChannel.number, 40);
  const managedAlpha = state.managedChannels.find((channel) => channel.ref.id === alphaRef.id)!;
  assert.equal(managedAlpha.hidden, true);
  const news = state.categories.find((category) => category.key === "News")!;
  assert.equal(news.name, "Headlines");
  assert.equal(news.hidden, true);
  assert.deepEqual(
    news.channels.map((channel) => channel.id),
    ["b", "a"],
  );
  const films = state.categories.find((category) => category.key === "movie:10")!;
  assert.equal(films.name, "Films custom");
  assert.equal(films.hidden, true);
  const shows = state.categories.find((category) => category.key === "series:20")!;
  assert.equal(shows.name, "Shows custom");
  assert.equal(shows.hidden, true);
  assert.equal(state.itemOrderModes["movie:10"], "custom");
  assert.equal(state.itemOrderModes["series:20"], "custom");
  const ordered = (kind: LineupSection) =>
    state.categories
      .filter((category) => category.kind === kind && !category.personal)
      .map((category) => category.key);
  assert.deepEqual(ordered("live"), ["Sports", "News"]);
  assert.deepEqual(ordered("movie"), ["movie:11", "movie:10"]);
  assert.deepEqual(ordered("series"), ["series:21", "series:20"]);
  const personal = state.categories.find((category) => category.key === "personal:mine")!;
  assert.equal(personal.name, "Chosen");
  assert.deepEqual(
    personal.channels.map((channel) => channel.id),
    ["a", "b"],
  );
  assert.ok(state.unavailable.some((record) => record.key === orphanOverrideKey));
  assert.ok(
    state.unavailable.some((record) => record.key === "category-placement:series:missing"),
  );
}

test("playlist reset clears every customisation family in one durable write", async () => {
  const store = await loaded(
    { version: 1, revision: 7, personalisation: fullResetSeed() },
    sectioned,
  );
  assertFullResetSeeded(store.useLineup.getState());

  const writes = disk.write.mock.calls.length;
  const pending = store.applyLineupMutation(store.useLineup.getState().revision, {
    type: "playlist.reset",
  });
  const optimistic = store.useLineup.getState();
  assert.equal(optimistic.channels.find((channel) => channel.id === "a")?.name, "Alpha");
  assert.equal(optimistic.channels.find((channel) => channel.id === "a")?.number, 1);
  assert.equal(optimistic.categories.find((category) => category.key === "News")?.name, "News");
  assert.equal(
    optimistic.categories.some((category) => category.personal),
    false,
  );
  assert.equal(optimistic.unavailable.length, 0);
  await vi.runAllTimersAsync();
  assert.deepEqual(await pending, {
    ok: true,
    revision: 8,
    affectedIds: ["playlist:pl-1"],
  });
  assert.equal(disk.write.mock.calls.length, writes + 1);
  const saved = disk.write.mock.calls.at(-1)?.[1] as StoredLineupV1;
  assert.equal(saved.revision, 8);
  assert.deepEqual(saved.personalisation, emptyPersonalisation());

  const after = store.useLineup.getState();
  assert.deepEqual(
    after.channels.map((channel) => channel.id),
    ["a", "b", "c"],
  );
  assert.equal(
    after.managedChannels.find((channel) => channel.ref.id === alphaRef.id)?.providerName,
    "Alpha",
  );
  assert.equal(after.categories.find((category) => category.key === "News")?.hidden, false);
  assert.deepEqual(after.categoryOrderModes, {
    live: "provider",
    movie: "provider",
    series: "provider",
  });
  assert.deepEqual(after.itemOrderModes, {});
  assert.deepEqual(
    after.categories
      .filter((category) => category.kind === "live" && !category.personal)
      .map((category) => category.key),
    ["News", "Sports"],
  );
});

test("playlist reset on an already default record is a no-op", async () => {
  const store = await loaded(null, sectioned);
  const revision = store.useLineup.getState().revision;
  const writes = disk.write.mock.calls.length;
  const pending = store.applyLineupMutation(revision, { type: "playlist.reset" });
  await vi.runAllTimersAsync();
  assert.deepEqual(await pending, { ok: true, revision, affectedIds: [] });
  assert.equal(store.useLineup.getState().revision, revision);
  assert.equal(disk.write.mock.calls.length, writes);
});

test("a failed playlist reset write restores every seeded family", async () => {
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const store = await loaded(
    { version: 1, revision: 4, personalisation: fullResetSeed() },
    sectioned,
  );
  const pending = store.applyLineupMutation(4, { type: "playlist.reset" });
  assert.equal(
    store.useLineup.getState().channels.find((channel) => channel.id === "a")?.name,
    "Alpha",
  );
  await vi.runAllTimersAsync();
  assert.deepEqual(await pending, { ok: false, reason: "persistence", revision: 4 });
  const state = store.useLineup.getState();
  assert.equal(state.revision, 4);
  assert.equal(state.durableRevision, 4);
  assert.equal(state.saveError, "lineup.persistenceFailed");
  assertFullResetSeeded(state);
});

test("queued rename and playlist reset coalesce into one empty durable write", async () => {
  const store = await loaded(null, sectioned);
  const rename = store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: alphaRef,
    name: "Queued",
  });
  const reset = store.applyLineupMutation(1, { type: "playlist.reset" });
  await vi.runAllTimersAsync();
  assert.equal((await rename).ok, true);
  assert.equal((await reset).ok, true);
  assert.equal(
    store.useLineup.getState().channels.find((channel) => channel.id === "a")?.name,
    "Alpha",
  );
  assert.equal(disk.write.mock.calls.length, 1);
  const saved = disk.write.mock.calls[0][1] as StoredLineupV1;
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.personalisation, emptyPersonalisation());
});
