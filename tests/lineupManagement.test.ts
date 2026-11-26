import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { channelRef, type ProviderLineup } from "../src/services/lineup";
import type { LineupQueryResult } from "../src/stores/lineup";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

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
  id: "playlist-one",
  name: "One",
  source: { kind: "m3u", url: "http://viewer:secret@example.invalid/list.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};

function channel(index: number, group = index % 2 ? "News" : "Sport"): Channel {
  const id = `channel-${index}`;
  return {
    id,
    name: `Provider ${index}`,
    number: index + 1,
    group,
    categoryKey: group,
    logo: "",
    quality: "",
    url: `http://viewer:secret@example.invalid/${id}`,
    sourceFingerprint: index.toString(16).padStart(16, "0"),
  };
}

function catalogue(count: number): ProviderLineup {
  const channels = Array.from({ length: count }, (_, index) => channel(index));
  return {
    channels,
    categories: ["News", "Sport"].map((name) => ({
      key: name,
      name,
      kind: "live" as const,
      channels: channels.filter((item) => item.categoryKey === name),
    })),
  };
}

async function loaded(count = 4, saved: unknown = null) {
  disk.read.mockResolvedValueOnce(saved);
  const store = await import("../src/stores/lineup");
  const provider = catalogue(count);
  await store.adoptCatalogue(playlist, provider, store.prepareLineup(playlist));
  return { store, provider };
}

function pageIds(result: LineupQueryResult) {
  assert.equal(result.ok, true);
  return result.ok
    ? result.page.items.map((item) => (item.kind === "unavailable" ? item.key : item.id))
    : [];
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

test("returns fifty items by default and never more than one hundred", async () => {
  const { store } = await loaded(151);
  const first = store.queryLineup({ playlistId: playlist.id, revision: 0, scope: "channels" });
  assert.equal(first.ok && first.page.items.length, 50);
  assert.equal(first.ok && first.page.total, 151);
  assert.ok(first.ok && first.page.nextCursor);
  const second = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    cursor: first.ok ? (first.page.nextCursor ?? undefined) : undefined,
  });
  const third = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    cursor: second.ok ? (second.page.nextCursor ?? undefined) : undefined,
  });
  const fourth = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    cursor: third.ok ? (third.page.nextCursor ?? undefined) : undefined,
  });
  const ids = [...pageIds(first), ...pageIds(second), ...pageIds(third), ...pageIds(fourth)];
  assert.equal(ids.length, 151);
  assert.equal(new Set(ids).size, 151);
  assert.deepEqual(
    store.queryLineup({ playlistId: playlist.id, revision: 0, scope: "channels", limit: 101 }),
    {
      ok: false,
      reason: "invalid",
      revision: 0,
    },
  );
});

test("projects effective channels without source fingerprints or addresses", async () => {
  const saved = {
    version: 1,
    revision: 2,
    personalisation: {
      channels: {
        [channelRef(channel(0)).id]: {
          name: "Viewer name",
          number: 900,
          sourceFingerprint: channel(0).sourceFingerprint,
        },
      },
    },
  };
  const { store } = await loaded(1, saved);
  const result = store.queryLineup({ playlistId: playlist.id, revision: 2, scope: "channels" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.page.items[0], {
    kind: "channel",
    id: channelRef(channel(0)).id,
    name: "Viewer name",
    providerName: "Provider 0",
    number: 900,
    providerNumber: 1,
    hidden: false,
    categoryKeys: ["Sport"],
    personalCategoryIds: [],
  });
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(JSON.stringify(result).includes("sourceFingerprint"), false);
  assert.equal(JSON.stringify(result).includes("http://"), false);
});

test("separates provider and personal category scopes", async () => {
  const saved = {
    version: 1,
    revision: 1,
    personalisation: {
      personalCategories: [{ id: "mine", name: "Mine", channels: [channelRef(channel(0))] }],
    },
  };
  const { store } = await loaded(2, saved);
  const provider = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "categories",
  });
  const personal = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "personal-categories",
  });
  assert.deepEqual(pageIds(provider), ["News", "Sport"]);
  assert.deepEqual(personal, { ok: false, reason: "invalid", revision: 1 });
  assert.equal(
    store.useLineup.getState().managedCategories.some((item) => item.personal),
    true,
  );
});

test("filters a channel page by provider or personal category", async () => {
  const saved = {
    version: 1,
    revision: 1,
    personalisation: {
      personalCategories: [{ id: "mine", name: "Mine", channels: [channelRef(channel(0))] }],
    },
  };
  const { store } = await loaded(4, saved);
  const provider = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
    categoryKey: "News",
  });
  const personal = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
    categoryKey: "mine",
  });
  assert.equal(provider.ok && provider.page.total, 2);
  assert.deepEqual(personal, { ok: false, reason: "invalid", revision: 1 });
  assert.equal(
    store.useLineup
      .getState()
      .managedChannels.find((item) => item.ref.id === channelRef(channel(0)).id)
      ?.categoryKeys.includes("personal:mine"),
    true,
  );
});

test("filters hidden items unless includeHidden is true", async () => {
  const saved = {
    version: 1,
    revision: 1,
    personalisation: {
      channels: {
        [channelRef(channel(0)).id]: {
          hidden: true,
          sourceFingerprint: channel(0).sourceFingerprint,
        },
      },
      categories: { News: { hidden: true } },
    },
  };
  const { store } = await loaded(2, saved);
  const visible = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
  });
  const all = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
    includeHidden: true,
  });
  assert.equal(visible.ok && visible.page.total, 1);
  assert.equal(all.ok && all.page.total, 2);
  const categories = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "categories",
  });
  assert.deepEqual(pageIds(categories), ["Sport"]);
});

test("searches effective names while preserving exact returned text", async () => {
  const exact = "خبر فوری 👩‍👩‍👧‍👦 é";
  const saved = {
    version: 1,
    revision: 1,
    personalisation: {
      channels: {
        [channelRef(channel(0)).id]: {
          name: exact,
          sourceFingerprint: channel(0).sourceFingerprint,
        },
      },
    },
  };
  const { store } = await loaded(2, saved);
  const result = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
    query: "فوری",
  });
  assert.equal(
    result.ok && result.page.items[0]?.kind === "channel" && result.page.items[0].name,
    exact,
  );
});

test("pages unavailable personalised references honestly", async () => {
  const saved = {
    version: 1,
    revision: 4,
    personalisation: {
      channels: { missing: { name: "Unavailable channel" } },
      categories: { Missing: { name: "Unavailable category" } },
      categoryOrder: [{ itemId: "Missing", beforeId: "News" }],
      personalCategories: [{ id: "mine", name: "Mine", channels: [{ id: "gone" }] }],
    },
  };
  const { store } = await loaded(2, saved);
  const revision = store.useLineup.getState().revision;
  const channels = store.queryLineup({ playlistId: playlist.id, revision, scope: "channels" });
  const categories = store.queryLineup({
    playlistId: playlist.id,
    revision,
    scope: "categories",
  });
  const personal = store.queryLineup({
    playlistId: playlist.id,
    revision,
    scope: "personal-categories",
  });
  assert.equal(
    channels.ok && channels.page.items.some((item) => item.kind === "unavailable"),
    true,
  );
  assert.equal(
    categories.ok && categories.page.items.some((item) => item.kind === "unavailable"),
    true,
  );
  assert.deepEqual(personal, { ok: false, reason: "invalid", revision });
  const kinds = [channels, categories]
    .filter((result) => result.ok)
    .flatMap((result) =>
      result.ok ? result.page.items.filter((item) => item.kind === "unavailable") : [],
    )
    .map((item) => (item.kind === "unavailable" ? item.recordKind : ""));
  assert.equal(kinds.includes("personal-membership"), false);
  assert.equal(
    JSON.stringify([channels, categories, personal]).includes("sourceFingerprint"),
    false,
  );
});

test("binds the cursor to the complete query and revision", async () => {
  const { store } = await loaded(4);
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    includeHidden: true,
    query: "Provider",
    categoryKey: "News",
    limit: 1,
  });
  assert.ok(first.ok && first.page.nextCursor);
  const next = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    includeHidden: true,
    query: "Provider",
    categoryKey: "News",
    limit: 1,
    cursor: first.ok ? (first.page.nextCursor ?? undefined) : undefined,
  });
  assert.equal(next.ok, true);
});

test("rejects a stale revision before returning page one", async () => {
  const { store } = await loaded();
  assert.deepEqual(
    store.queryLineup({ playlistId: playlist.id, revision: 8, scope: "channels" }),
    {
      ok: false,
      reason: "conflict",
      revision: 0,
    },
  );
});

test("rejects a stale cursor before returning a later page", async () => {
  const { store, provider } = await loaded(4);
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    limit: 1,
  });
  void store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: channelRef(provider.channels[0]),
    name: "Mine",
  });
  const result = store.queryLineup({
    playlistId: playlist.id,
    revision: 1,
    scope: "channels",
    limit: 1,
    cursor: first.ok ? (first.page.nextCursor ?? undefined) : undefined,
  });
  assert.deepEqual(result, { ok: false, reason: "conflict", revision: 1 });
});

test("rejects a cursor from another scope or search", async () => {
  const { store } = await loaded(4);
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    limit: 1,
  });
  const cursor = first.ok ? (first.page.nextCursor ?? undefined) : undefined;
  assert.equal(
    store.queryLineup({ playlistId: playlist.id, revision: 0, scope: "categories", cursor }).ok,
    false,
  );
  assert.equal(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      query: "new",
      cursor,
    }).ok,
    false,
  );
});

test("rejects a malformed cursor without throwing", async () => {
  const { store } = await loaded();
  assert.deepEqual(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      cursor: "not a cursor",
    }),
    { ok: false, reason: "invalid", revision: 0 },
  );
});

test("conflicts after a television mutation", async () => {
  const { store, provider } = await loaded();
  void store.applyLineupMutation(0, {
    type: "channel.rename",
    channel: channelRef(provider.channels[0]),
    name: "Mine",
  });
  assert.deepEqual(
    store.queryLineup({ playlistId: playlist.id, revision: 0, scope: "channels" }),
    {
      ok: false,
      reason: "conflict",
      revision: 1,
    },
  );
});

test("conflicts after authoritative availability changes", async () => {
  const { store } = await loaded();
  await store.adoptCategorySummaries(playlist, [
    { key: "movie:1", name: "Movies", kind: "movie", channels: [] },
  ]);
  assert.deepEqual(
    store.queryLineup({ playlistId: playlist.id, revision: 0, scope: "channels" }),
    {
      ok: false,
      reason: "conflict",
      revision: 1,
    },
  );
});

test("keeps a cursor valid after an identical authoritative refresh", async () => {
  const { store, provider } = await loaded();
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    limit: 1,
  });
  disk.read.mockResolvedValueOnce(null);
  const prepared = store.prepareLineup(playlist);
  await store.adoptCatalogue(playlist, provider, prepared);
  const result = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    limit: 1,
    cursor: first.ok ? (first.page.nextCursor ?? undefined) : undefined,
  });
  assert.equal(result.ok, true);
});

test("conflicts cursors after locale rematerialisation changes ordering inputs", async () => {
  const { store } = await loaded(4);
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    limit: 1,
  });
  store.rematerialise("fa");
  assert.deepEqual(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 1,
      scope: "channels",
      limit: 1,
      cursor: first.ok ? (first.page.nextCursor ?? undefined) : undefined,
    }),
    { ok: false, reason: "conflict", revision: 1 },
  );
});

test("rejects cursor identity changes and decoded offset tampering", async () => {
  const { store } = await loaded(4);
  const first = store.queryLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
    categoryKey: "News",
    includeHidden: true,
    limit: 1,
  });
  assert.equal(first.ok, true);
  if (!first.ok || !first.page.nextCursor) return;
  assert.equal(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      categoryKey: "Sport",
      includeHidden: true,
      cursor: first.page.nextCursor,
    }).ok,
    false,
  );
  assert.equal(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      categoryKey: "News",
      includeHidden: false,
      cursor: first.page.nextCursor,
    }).ok,
    false,
  );
  const decoded = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(first.page.nextCursor), (character) => character.charCodeAt(0)),
    ),
  );
  decoded.index = Number.MAX_SAFE_INTEGER;
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(decoded)))
    binary += String.fromCharCode(byte);
  const tampered = btoa(binary);
  assert.deepEqual(
    store.queryLineup({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      categoryKey: "News",
      includeHidden: true,
      cursor: tampered,
    }),
    { ok: false, reason: "invalid", revision: 0 },
  );
});
