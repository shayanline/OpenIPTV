import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { channelRef, emptyPersonalisation, type ProviderLineup } from "../src/services/lineup";
import type { Playlist } from "../src/stores/settings";
import type { LineupCategoryItem, LineupChannelItem } from "../src/stores/lineup";
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

const alpha: Channel = {
  id: "alpha",
  name: "Alpha",
  number: 1,
  group: "News",
  categoryKey: "News",
  logo: "",
  quality: "",
  url: "http://viewer:secret@example.invalid/alpha",
  sourceFingerprint: "0123456789abcdef",
};
const beta: Channel = {
  ...alpha,
  id: "beta",
  name: "Beta",
  number: 2,
  url: "http://viewer:secret@example.invalid/beta",
  sourceFingerprint: "fedcba9876543210",
};
const provider: ProviderLineup = {
  channels: [alpha, beta],
  categories: [{ key: "News", name: "News", kind: "live", channels: [alpha, beta] }],
};

const playlistTwo: Playlist = {
  id: "playlist-two",
  name: "Two",
  source: { kind: "m3u", url: "http://viewer:secret@example.invalid/two.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};

const gamma: Channel = {
  ...alpha,
  id: "gamma",
  name: "Gamma",
  number: 1,
  group: "Managed",
  categoryKey: "Managed",
  url: "http://viewer:secret@example.invalid/gamma",
  sourceFingerprint: "0011223344556677",
};

const providerTwo: ProviderLineup = {
  channels: [gamma],
  categories: [{ key: "Managed", name: "Managed", kind: "live", channels: [gamma] }],
};

async function loaded(saved: unknown = null) {
  disk.read.mockResolvedValueOnce(saved);
  const lineup = await import("../src/stores/lineup");
  const settings = await import("../src/stores/settings");
  settings.useSettings.setState({
    playlists: [playlist],
    activePlaylistId: playlist.id,
  });
  await lineup.adoptCatalogue(playlist, provider, lineup.prepareLineup(playlist));
  const protocol = await import("../src/services/lineupProtocol");
  return { ...lineup, ...settings, ...protocol };
}

const xtreamPlaylist: Playlist = {
  id: "playlist-vod",
  name: "VOD",
  source: {
    kind: "xtream",
    server: "http://provider.example",
    username: "viewer",
    password: "secret",
    output: "m3u8",
  },
  sourceVersion: 1,
  hiddenCategories: [],
};

const xtreamProvider: ProviderLineup = {
  channels: [],
  categories: [
    { key: "movie:10", name: "Provider Movies", kind: "movie", channels: [] },
    { key: "series:20", name: "Provider Series", kind: "series", channels: [] },
  ],
};

const vodRequest = (mutation: Record<string, unknown>, id = "request-one", revision = 0) => ({
  id,
  playlistId: xtreamPlaylist.id,
  revision,
  mutation,
});

async function vodLoaded(saved: unknown = null) {
  disk.read.mockResolvedValueOnce(saved);
  const lineup = await import("../src/stores/lineup");
  const settings = await import("../src/stores/settings");
  const library = await import("../src/stores/library");
  settings.useSettings.setState({
    playlists: [xtreamPlaylist],
    activePlaylistId: xtreamPlaylist.id,
  });
  await lineup.adoptCatalogue(
    xtreamPlaylist,
    xtreamProvider,
    lineup.prepareLineup(xtreamPlaylist),
  );
  library.useLibrary.getState().selectPlaylist(xtreamPlaylist);
  const protocol = await import("../src/services/lineupProtocol");
  return { ...lineup, ...settings, ...library, ...protocol };
}

const vodResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const vodFetch = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const defaults: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [],
      get_vod_categories: [{ category_id: "10", category_name: "Provider Movies" }],
      get_series_categories: [{ category_id: "20", category_name: "Provider Series" }],
      get_vod_streams: [
        { stream_id: "100", category_id: "10", name: "Zulu", container_extension: "mp4" },
        { stream_id: "101", category_id: "10", name: "Alpha", container_extension: "mp4" },
      ],
      get_series: [{ series_id: "200", category_id: "20", name: "Provider Series Name" }],
    };
    return vodResponse(action in overrides ? overrides[action] : defaults[action]);
  });

const request = (mutation: Record<string, unknown>, id = "request-one", revision = 0) => ({
  id,
  playlistId: playlist.id,
  revision,
  mutation,
});

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

test("parses every lineup scope with exact bounded fields", async () => {
  const { parseLineupQuery } = await loaded();
  for (const scope of ["channels", "categories", "items"] as const) {
    const query = {
      playlistId: playlist.id,
      revision: 0,
      scope,
      query: "خبر",
      includeHidden: true,
      limit: 100,
    };
    assert.deepEqual(parseLineupQuery(query), query);
  }
  assert.equal(
    parseLineupQuery({
      playlistId: playlist.id,
      revision: 0,
      scope: "items",
      categoryKey: "News",
      contentKind: "movie",
    })?.contentKind,
    "movie",
  );
  assert.equal(
    parseLineupQuery({ playlistId: playlist.id, revision: 0, scope: "personal-categories" }),
    null,
  );
  assert.equal(
    parseLineupQuery({ playlistId: playlist.id, revision: 0, scope: "channels", extra: true }),
    null,
  );
  assert.equal(
    parseLineupQuery({ playlistId: playlist.id, revision: 0.5, scope: "channels" }),
    null,
  );
  assert.equal(
    parseLineupQuery({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      query: "x".repeat(201),
    }),
    null,
  );
  assert.equal(
    parseLineupQuery({
      playlistId: playlist.id,
      revision: 0,
      scope: "channels",
      cursor: "x".repeat(2049),
    }),
    null,
  );
  assert.equal(
    parseLineupQuery({ playlistId: playlist.id, revision: 0, scope: "channels", limit: 0 }),
    null,
  );
  assert.equal(
    parseLineupQuery({ playlistId: playlist.id, revision: 0, scope: "channels", limit: 101 }),
    null,
  );
});

test("parses lineup query offsets with exact bounds", async () => {
  const { parseLineupQuery } = await loaded();
  const base = { playlistId: playlist.id, revision: 0, scope: "channels" as const };
  assert.deepEqual(parseLineupQuery({ ...base, offset: 0 }), { ...base, offset: 0 });
  assert.deepEqual(parseLineupQuery({ ...base, offset: 50 }), { ...base, offset: 50 });
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "2", null, true]) {
    assert.equal(parseLineupQuery({ ...base, offset }), null, `offset ${offset}`);
  }
  assert.equal(parseLineupQuery({ ...base, cursor: "abc", offset: 2 }), null);
});

test("items scope honours offsets through the remote query seam", async () => {
  const s = await vodLoaded();
  vi.stubGlobal("fetch", vodFetch());
  const revision = s.useLineup.getState().revision;
  const base = {
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "items" as const,
    categoryKey: "movie:10",
    contentKind: "movie" as const,
    limit: 1,
  };
  const first = await s.queryRemoteLineup({ ...base, offset: 0 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.page.total, 2);
  assert.ok(first.page.nextCursor);
  const second = await s.queryRemoteLineup({ ...base, offset: 1 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.page.nextCursor, null);
  const names = [first.page.items[0], second.page.items[0]]
    .map((item) => (item.kind === "item" ? item.name : ""))
    .sort();
  assert.deepEqual(names, ["Alpha", "Zulu"]);
  assert.deepEqual(await s.queryRemoteLineup({ ...base, offset: 2 }), {
    ok: false,
    reason: "invalid",
    revision,
  });
  assert.deepEqual(
    await s.queryRemoteLineup({ ...base, offset: 1, cursor: first.page.nextCursor }),
    { ok: false, reason: "invalid", revision },
  );
  assert.deepEqual(await s.queryRemoteLineup({ ...base, offset: -1 }), {
    ok: false,
    reason: "invalid",
    revision,
  });
});

test("parses every remote lineup mutation variant", async () => {
  const { parseLineupMutationRequest } = await loaded();
  const mutations = [
    { type: "category-order.mode", section: "live", mode: "provider" },
    { type: "category-order.mode", section: "movie", mode: "alphabetical" },
    { type: "item-order.mode", categoryKey: "News", mode: "number" },
    {
      type: "item.place",
      categoryKey: "News",
      placement: { itemId: "title-1", beforeId: "title-2" },
    },
    { type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" },
    { type: "channel.number", channelId: channelRef(alpha).id, number: 10 },
    { type: "channel.visibility", channelId: channelRef(alpha).id, hidden: true },
    { type: "category.rename", categoryKey: "News", name: "Headlines" },
    { type: "category.visibility", categoryKey: "News", hidden: true },
    { type: "categories.visibility", contentKind: "live", hidden: true },
    { type: "channels.visibility", categoryKey: "News", hidden: true },
    { type: "category.place", placement: { itemId: "News" } },
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(alpha).id, beforeId: channelRef(beta).id },
    },
    { type: "unavailable.remove", key: "channel-override:missing" },
    { type: "playlist.reset" },
    { type: "category-order.reset", section: "live" },
    { type: "category-order.reset", section: "movie" },
    { type: "category-order.reset", section: "series" },
    { type: "item-order.reset", categoryKey: "News" },
  ];
  for (let index = 0; index < mutations.length; index += 1) {
    const input = request(mutations[index], `request-${index}`);
    assert.deepEqual(parseLineupMutationRequest(input), input);
  }
  for (const disabled of [
    { type: "personal-category.create", name: "Mine" },
    { type: "personal-category.rename", categoryId: "mine", name: "Ours" },
    { type: "personal-category.delete", categoryId: "mine" },
    {
      type: "personal-category.memberships",
      channelId: channelRef(alpha).id,
      categoryIds: ["mine"],
    },
    {
      type: "personal-category.place-channel",
      categoryId: "mine",
      placement: { itemId: channelRef(alpha).id },
    },
    { type: "order.mode", mode: "provider" },
    { type: "playlist.reset", extra: true },
    { type: "category-order.reset", section: "live", extra: 1 },
    { type: "category-order.reset", section: "episodes" },
    { type: "category-order.reset" },
    { type: "item-order.reset" },
    { type: "item-order.reset", categoryKey: "" },
    { type: "item-order.reset", categoryKey: "News", extra: true },
  ]) {
    assert.equal(parseLineupMutationRequest(request(disabled)), null);
  }
});

test("rejects malformed lineup mutation envelopes", async () => {
  const { parseLineupMutationRequest } = await loaded();
  const id = channelRef(alpha).id;
  const invalid = [
    { ...request({ type: "order.mode", mode: "provider" }), extra: true },
    {
      playlistId: playlist.id,
      revision: 0,
      mutation: { type: "order.mode", mode: "provider" },
    },
    request({ type: "channel.rename", channelId: id, name: "" }),
    request({ type: "channel.number", channelId: id, number: 0 }),
    request({ type: "channel.number", channelId: id, number: Number.MAX_SAFE_INTEGER + 1 }),
    request({
      type: "category.place",
      placement: { itemId: "News", beforeId: "A", afterId: "B" },
    }),
    request({
      type: "personal-category.memberships",
      channelId: id,
      categoryIds: Array.from({ length: 129 }, (_, index) => `id-${index}`),
    }),
    request({ type: "channel.visibility", channelId: "x".repeat(513), hidden: true }),
    request({ type: "channels.visibility", categoryKey: "News", hidden: "yes" }),
    request({ type: "channels.visibility", categoryKey: "News", hidden: true, extra: 1 }),
    request({ type: "channels.visibility", categoryKey: "", hidden: true }),
    request({ type: "order.mode", mode: "provider" }, "😀".repeat(129)),
    { ...request({ type: "playlist.reset" }), sourceVersion: "1" },
    { ...request({ type: "item-order.reset", categoryKey: "News" }), sourceVersion: -1 },
    {
      ...request({ type: "category-order.reset", section: "live" }),
      sourceVersion: 1.5,
    },
    {
      ...request({ type: "playlist.reset" }),
      sourceVersion: Number.MAX_SAFE_INTEGER + 1,
    },
  ];
  for (const input of invalid) assert.equal(parseLineupMutationRequest(input), null);
});

test("returns the first result for a repeated request id", async () => {
  const s = await loaded();
  const input = request({
    type: "channel.rename",
    channelId: channelRef(alpha).id,
    name: "Mine",
  });
  const first = s.mutateRemoteLineup(input);
  await vi.runAllTimersAsync();
  const result = await first;
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
  assert.deepEqual(await s.mutateRemoteLineup({ ...input, revision: result.revision }), result);
  assert.equal(disk.write.mock.calls.length, 1);
});

test("returns the same in flight promise for a duplicate request", async () => {
  let release: () => void = () => {};
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const s = await loaded();
  const input = request({
    type: "channel.rename",
    channelId: channelRef(alpha).id,
    name: "Mine",
  });
  const first = s.mutateRemoteLineup(input, "device-one");
  const duplicate = s.mutateRemoteLineup(input, "device-one");
  assert.equal(duplicate, first);
  await vi.runAllTimersAsync();
  release();
  await Promise.resolve();
  assert.equal((await first).ok, true);
  assert.equal(disk.write.mock.calls.length, 1);
  assert.equal(s.useLineup.getState().revision, 1);
});

test("channel bulk visibility covers the whole category beyond one page", async () => {
  const extraNews = Array.from({ length: 49 }, (_, index) => {
    const serial = index + 3;
    return {
      ...alpha,
      id: `n${serial}`,
      name: `News ${serial}`,
      number: serial,
      url: `http://viewer:secret@example.invalid/n${serial}`,
      sourceFingerprint: serial.toString(16).padStart(16, "0"),
    };
  });
  const gamma: Channel = {
    ...alpha,
    id: "gamma",
    name: "Gamma",
    number: 60,
    group: "Sport",
    categoryKey: "Sport",
    url: "http://viewer:secret@example.invalid/gamma",
    sourceFingerprint: "0011223344556677",
  };
  const wide: ProviderLineup = {
    channels: [alpha, beta, ...extraNews, gamma],
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
  const s = await loaded();
  await s.adoptCatalogue(playlist, wide, s.prepareLineup(playlist));
  const revision = s.useLineup.getState().revision;
  const writesBefore = disk.write.mock.calls.length;

  for (const [index, categoryKey] of [
    "Missing",
    "favourites",
    "Empty",
    "personal:mine",
  ].entries()) {
    const rejected = await s.mutateRemoteLineup(
      request(
        { type: "channels.visibility", categoryKey, hidden: true },
        `reject-${index}`,
        revision,
      ),
    );
    assert.deepEqual(
      rejected,
      { ok: false, revision, reason: categoryKey === "Empty" ? "unavailable" : "invalid" },
      categoryKey,
    );
  }
  assert.equal(s.useLineup.getState().revision, revision);
  assert.equal(disk.write.mock.calls.length, writesBefore);

  const hide = s.mutateRemoteLineup(
    request(
      { type: "channels.visibility", categoryKey: "News", hidden: true },
      "bulk-hide",
      revision,
    ),
  );
  await vi.runAllTimersAsync();
  const hidden = await hide;
  assert.deepEqual(hidden, {
    ok: true,
    revision: revision + 1,
    affectedIds: ["News"],
  });
  const state = s.useLineup.getState();
  const byId = new Map(state.managedChannels.map((item) => [item.ref.id, item]));
  for (const channel of [alpha, beta, ...extraNews]) {
    assert.equal(byId.get(channelRef(channel).id)?.hidden, true, channel.id);
  }
  assert.notEqual(byId.get(channelRef(gamma).id)?.hidden, true);
  assert.equal(disk.write.mock.calls.length, writesBefore + 1);

  const repeat = await s.mutateRemoteLineup(
    request(
      { type: "channels.visibility", categoryKey: "News", hidden: true },
      "bulk-hide",
      revision,
    ),
  );
  assert.deepEqual(repeat, hidden);
  assert.equal(disk.write.mock.calls.length, writesBefore + 1);

  const stale = await s.mutateRemoteLineup(
    request(
      { type: "channels.visibility", categoryKey: "News", hidden: false },
      "bulk-stale",
      revision,
    ),
  );
  assert.deepEqual(stale, {
    ok: false,
    revision: revision + 1,
    reason: "conflict",
  });
  assert.equal(disk.write.mock.calls.length, writesBefore + 1);
});

test("channel bulk visibility rejects movie and series scopes without writes", async () => {
  const vod = await vodLoaded();
  const vodRevision = vod.useLineup.getState().revision;
  const writesBefore = disk.write.mock.calls.length;
  for (const categoryKey of ["movie:10", "series:20"]) {
    const rejected = await vod.mutateRemoteLineup(
      vodRequest(
        { type: "channels.visibility", categoryKey, hidden: true },
        `vod-${categoryKey}`,
        vodRevision,
      ),
    );
    assert.deepEqual(
      rejected,
      { ok: false, revision: vodRevision, reason: "invalid" },
      categoryKey,
    );
  }
  assert.equal(vod.useLineup.getState().revision, vodRevision);
  assert.equal(disk.write.mock.calls.length, writesBefore);
});

test("scopes idempotency by playlist and authenticated device", async () => {
  const s = await loaded();
  const first = s.mutateRemoteLineup(
    request(
      { type: "channel.rename", channelId: channelRef(alpha).id, name: "First" },
      "same-id",
    ),
    "device-one",
  );
  await vi.runAllTimersAsync();
  assert.equal((await first).ok, true);
  const second = s.mutateRemoteLineup(
    request(
      { type: "channel.visibility", channelId: channelRef(alpha).id, hidden: true },
      "same-id",
      1,
    ),
    "device-two",
  );
  await vi.runAllTimersAsync();
  assert.equal((await second).ok, true);
  assert.equal(s.useLineup.getState().managedChannels[0].hidden, true);

  const nextPlaylist = { ...playlist, id: "playlist-two", name: "Two" };
  s.useSettings.setState({
    playlists: [playlist, nextPlaylist],
    activePlaylistId: nextPlaylist.id,
  });
  disk.read.mockResolvedValueOnce(null);
  await s.adoptCatalogue(nextPlaylist, provider, s.prepareLineup(nextPlaylist));
  const third = s.mutateRemoteLineup(
    {
      id: "same-id",
      playlistId: nextPlaylist.id,
      revision: 0,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(alpha).id,
        name: "Second playlist",
      },
    },
    "device-one",
  );
  await vi.runAllTimersAsync();
  assert.equal((await third).ok, true);
  assert.equal(s.useLineup.getState().managedChannels[0].effective.name, "Second playlist");
});

test("does not claim an id for a malformed request", async () => {
  const s = await loaded();
  assert.equal(
    (
      await s.mutateRemoteLineup({
        ...request({ type: "order.mode", mode: "provider" }),
        extra: true,
      })
    ).ok,
    false,
  );
  const valid = s.mutateRemoteLineup(
    request({ type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" }),
  );
  await vi.runAllTimersAsync();
  assert.equal((await valid).ok, true);
});

test("maps a current channel id to its complete ChannelRef", async () => {
  const s = await loaded();
  const result = s.mutateRemoteLineup(
    request({ type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" }),
  );
  assert.equal(
    s.useLineup.getState().managedChannels[0].ref.sourceFingerprint,
    alpha.sourceFingerprint,
  );
  await vi.runAllTimersAsync();
  assert.equal((await result).ok, true);
  assert.equal(
    JSON.stringify(disk.write.mock.calls[0][1]).includes(alpha.sourceFingerprint ?? ""),
    true,
  );
});

test("rejects an identifier outside the active lineup", async () => {
  const s = await loaded();
  assert.deepEqual(
    await s.mutateRemoteLineup(
      request({ type: "channel.rename", channelId: "missing", name: "Mine" }),
    ),
    {
      ok: false,
      revision: 0,
      reason: "invalid",
    },
  );
  assert.equal(disk.write.mock.calls.length, 0);
});

test("delegates duplicate number and limit results unchanged", async () => {
  const s = await loaded();
  assert.deepEqual(
    await s.mutateRemoteLineup(
      request({ type: "channel.number", channelId: channelRef(alpha).id, number: 2 }),
    ),
    {
      ok: false,
      revision: 0,
      reason: "duplicate-number",
    },
  );
  assert.equal(
    s.parseLineupMutationRequest(
      request({
        type: "personal-category.memberships",
        channelId: channelRef(alpha).id,
        categoryIds: Array.from({ length: 129 }, (_, index) => `category-${index}`),
      }),
    ),
    null,
  );
});

test("keeps global and lineup revisions independent", async () => {
  const s = await loaded();
  const before = (await import("../src/services/remoteProtocol")).remoteSnapshot();
  const mutation = s.mutateRemoteLineup(
    request({ type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" }),
  );
  await vi.runAllTimersAsync();
  await mutation;
  const after = (await import("../src/services/remoteProtocol")).remoteSnapshot();
  assert.equal(after.revision, before.revision);
  assert.equal(after.lineup?.revision, 1);
});

test("returns persistence failure without a success snapshot", async () => {
  disk.write.mockRejectedValueOnce(new Error("quota"));
  const s = await loaded();
  const mutation = s.mutateRemoteLineup(
    request({ type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" }),
  );
  await vi.runAllTimersAsync();
  const result = await mutation;
  assert.deepEqual(result, { ok: false, reason: "persistence", revision: 0 });
  assert.equal("snapshot" in result, false);
});

test("returns no provider credentials, addresses or fingerprints", async () => {
  const s = await loaded();
  const result = await s.queryRemoteLineup({
    playlistId: playlist.id,
    revision: 0,
    scope: "channels",
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.page.items.length > 0, true);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("secret"), false);
  assert.equal(serialised.includes("http://"), false);
  assert.equal(serialised.includes("sourceFingerprint"), false);
});

test("items paging uses the effective order while item.place keeps provider order", async () => {
  const saved = {
    version: 1,
    revision: 0,
    personalisation: {
      categories: { "movie:10": { itemOrderMode: "alphabetical" } },
    },
  };
  const s = await vodLoaded(saved);
  vi.stubGlobal("fetch", vodFetch());
  const lease = await s.acquireLineup(xtreamPlaylist, "tv");
  const apply = vi.spyOn(lease.controller, "applyLineupMutation");
  const revision = s.useLineup.getState().revision;
  const query = await s.queryRemoteLineup({
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "items",
    categoryKey: "movie:10",
    contentKind: "movie",
  });
  assert.equal(query.ok, true);
  if (!query.ok) return;
  assert.deepEqual(
    query.page.items.map((item) => (item.kind === "item" ? item.name : item.kind)),
    ["Alpha", "Zulu"],
  );
  const serialised = JSON.stringify(query);
  for (const leak of [
    "secret",
    "http://",
    "password",
    "stream_id",
    "directSource",
    "sourceFingerprint",
  ]) {
    assert.equal(serialised.includes(leak), false, leak);
  }
  const placed = s.mutateRemoteLineup(
    vodRequest(
      {
        type: "item.place",
        categoryKey: "movie:10",
        placement: {
          itemId: "xtream:playlist-vod:movie:100",
          afterId: "xtream:playlist-vod:movie:101",
        },
      },
      "place-one",
      revision,
    ),
    "device-one",
  );
  await vi.runAllTimersAsync();
  const result = await placed;
  assert.equal(result.ok, true);
  const placements = apply.mock.calls
    .map((call) => call[1])
    .filter((mutation) => mutation.type === "item.place");
  assert.equal(placements.length, 1);
  assert.deepEqual(placements[0]?.type === "item.place" ? placements[0].providerOrder : null, [
    "xtream:playlist-vod:movie:100",
    "xtream:playlist-vod:movie:101",
  ]);
});

test("item cursors conflict when the provider array changes and reject foreign identity", async () => {
  const s = await vodLoaded();
  vi.stubGlobal("fetch", vodFetch());
  const revision = s.useLineup.getState().revision;
  const base = {
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "items" as const,
    categoryKey: "movie:10",
    contentKind: "movie" as const,
    limit: 1,
  };
  const first = await s.queryRemoteLineup(base);
  assert.equal(first.ok, true);
  if (!first.ok || !first.page.nextCursor) return;
  const cursor = first.page.nextCursor;
  const second = await s.queryRemoteLineup({ ...base, cursor });
  assert.equal(second.ok, true);

  const lease = await s.acquireLineup(xtreamPlaylist, "tv");
  vi.stubGlobal(
    "fetch",
    vodFetch({
      get_vod_streams: [
        { stream_id: "101", category_id: "10", name: "Alpha", container_extension: "mp4" },
        { stream_id: "100", category_id: "10", name: "Zulu", container_extension: "mp4" },
      ],
    }),
  );
  await lease.controller.refreshCatalogue(xtreamPlaylist, {
    ...xtreamProvider,
    categories: xtreamProvider.categories.map((category) => ({ ...category })),
  });
  await vi.runAllTimersAsync();
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
  await lease.release();
  assert.deepEqual(await s.queryRemoteLineup({ ...base, cursor }), {
    ok: false,
    reason: "conflict",
    revision,
  });
  assert.deepEqual(
    await s.queryRemoteLineup({
      playlistId: xtreamPlaylist.id,
      revision,
      scope: "items",
      categoryKey: "series:20",
      contentKind: "series",
      cursor,
    }),
    { ok: false, reason: "invalid", revision },
  );
});

test("duplicate in-flight ids share one apply and stale ownership writes nothing", async () => {
  const s = await vodLoaded();
  const pending = new Map<string, (value: Response) => void>();
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const categoryId = url.searchParams.get("category_id");
    if (categoryId) {
      return new Promise<Response>((resolve) => {
        pending.set(`${action}:${categoryId}`, resolve);
      });
    }
    const defaults: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [],
      get_vod_categories: [{ category_id: "10", category_name: "Provider Movies" }],
      get_series_categories: [{ category_id: "20", category_name: "Provider Series" }],
    };
    return vodResponse(defaults[action] ?? []);
  });
  vi.stubGlobal("fetch", fetchMock);
  const lease = await s.acquireLineup(xtreamPlaylist, "tv");
  const apply = vi.spyOn(lease.controller, "applyLineupMutation");

  const revision = s.useLineup.getState().revision;
  const input = vodRequest(
    {
      type: "item.place",
      categoryKey: "movie:10",
      placement: {
        itemId: "xtream:playlist-vod:movie:100",
        afterId: "xtream:playlist-vod:movie:101",
      },
    },
    "shared-id",
    revision,
  );
  const first = s.mutateRemoteLineup(input, "device-one");
  const duplicate = s.mutateRemoteLineup(input, "device-one");
  assert.equal(duplicate, first);
  for (let index = 0; index < 200 && !pending.has("get_vod_streams:10"); index += 1) {
    await Promise.resolve();
  }
  assert.ok(pending.has("get_vod_streams:10"));
  pending.get("get_vod_streams:10")?.(
    vodResponse([
      { stream_id: "100", category_id: "10", name: "Zulu", container_extension: "mp4" },
      { stream_id: "101", category_id: "10", name: "Alpha", container_extension: "mp4" },
    ]),
  );
  await vi.runAllTimersAsync();
  const [one, two] = await Promise.all([first, duplicate]);
  assert.deepEqual(one, two);
  assert.equal(one.ok, true);
  assert.equal(apply.mock.calls.filter((call) => call[1].type === "item.place").length, 1);
  assert.equal(disk.write.mock.calls.length, 1);

  const nextRevision = s.useLineup.getState().revision;
  const seriesMutation = s.mutateRemoteLineup(
    vodRequest(
      {
        type: "item.place",
        categoryKey: "series:20",
        placement: { itemId: "xtream:playlist-vod:series:200" },
      },
      "series-id",
      nextRevision,
    ),
    "device-one",
  );
  const seriesQuery = s.queryRemoteLineup({
    playlistId: xtreamPlaylist.id,
    revision: nextRevision,
    scope: "items",
    categoryKey: "series:20",
    contentKind: "series",
  });
  for (let index = 0; index < 200 && !pending.has("get_series:20"); index += 1) {
    await Promise.resolve();
  }
  assert.ok(pending.has("get_series:20"));
  s.useSettings.setState({
    playlists: [{ ...xtreamPlaylist, sourceVersion: 2 }],
    activePlaylistId: xtreamPlaylist.id,
  });
  pending.get("get_series:20")?.(
    vodResponse([{ series_id: "200", category_id: "20", name: "Provider Series Name" }]),
  );
  const [mutationResult, queryResult] = await Promise.all([seriesMutation, seriesQuery]);
  for (const result of [mutationResult, queryResult]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unavailable");
  }
  await vi.runAllTimersAsync();
  assert.equal(apply.mock.calls.filter((call) => call[1].type === "item.place").length, 1);
  assert.equal(disk.write.mock.calls.length, 1);
});

test("false capabilities reject personal keys and synthetic vod categories without provider loads", async () => {
  const saved = {
    version: 1,
    revision: 0,
    personalisation: {
      channels: { missing: { name: "Unavailable" } },
      personalCategories: [{ id: "mine", name: "Mine", channels: [{ id: "gone" }] }],
    },
  };
  const s = await loaded(saved);
  const revision = s.useLineup.getState().revision;
  for (const scope of [
    { scope: "personal-categories" },
    { scope: "channels", categoryKey: "mine" },
    { scope: "channels", categoryKey: "personal:mine" },
  ] as const) {
    assert.deepEqual(
      await s.queryRemoteLineup({ playlistId: playlist.id, revision, ...scope }),
      { ok: false, reason: "invalid", revision },
    );
  }
  const rejected: Array<Record<string, unknown>> = [
    { type: "item-order.mode", categoryKey: "mine", mode: "alphabetical" },
    { type: "item-order.mode", categoryKey: "personal:mine", mode: "alphabetical" },
    {
      type: "channel.place",
      categoryKey: "mine",
      placement: { itemId: channelRef(alpha).id },
    },
    {
      type: "channel.place",
      categoryKey: "personal:mine",
      placement: { itemId: channelRef(alpha).id },
    },
    { type: "category.place", placement: { itemId: "personal:mine" } },
    { type: "category.place", placement: { itemId: "News", afterId: "personal:mine" } },
    { type: "item.place", categoryKey: "mine", placement: { itemId: "title-1" } },
    { type: "personal-category.create", name: "Nope" },
    { type: "personal-category.rename", categoryId: "mine", name: "Other" },
  ];
  for (const [index, mutation] of rejected.entries()) {
    const result = await s.mutateRemoteLineup(
      request(mutation, `reject-${index}`, s.useLineup.getState().revision),
      "device-one",
    );
    assert.equal(result.ok, false, JSON.stringify(mutation));
  }
  const unavailable = s.useLineup.getState().unavailable;
  const custom = unavailable.find((record) => record.kind === "personal-membership");
  const providerRecord = unavailable.find((record) => record.kind === "channel-override");
  assert.ok(custom);
  assert.ok(providerRecord);
  assert.equal(
    (
      await s.mutateRemoteLineup(
        request(
          { type: "unavailable.remove", key: custom.key },
          "remove-custom",
          s.useLineup.getState().revision,
        ),
        "device-one",
      )
    ).ok,
    false,
  );
  const removed = s.mutateRemoteLineup(
    request(
      { type: "unavailable.remove", key: providerRecord.key },
      "remove-provider",
      s.useLineup.getState().revision,
    ),
    "device-one",
  );
  await vi.runAllTimersAsync();
  assert.equal((await removed).ok, true);

  vi.resetModules();
  const vod = await vodLoaded();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const vodRevision = vod.useLineup.getState().revision;
  for (const [contentKind, keys] of [
    ["movie", ["movie:all", "movie:continue", "movie:favourites"]],
    ["series", ["series:all", "series:continue", "series:favourites"]],
  ] as const) {
    for (const categoryKey of keys) {
      assert.deepEqual(
        await vod.queryRemoteLineup({
          playlistId: xtreamPlaylist.id,
          revision: vodRevision,
          scope: "items",
          categoryKey,
          contentKind,
        }),
        { ok: false, reason: "invalid", revision: vodRevision },
      );
    }
  }
  assert.equal(fetchMock.mock.calls.length, 0);
});

test("a provider category literally named personal:News stays usable when custom categories are off", async () => {
  const gamma: Channel = {
    ...alpha,
    id: "gamma",
    name: "Gamma",
    number: 3,
    group: "personal:News",
    categoryKey: "personal:News",
    url: "http://viewer:secret@example.invalid/gamma",
    sourceFingerprint: "0011223344556677",
  };
  const prefixed: ProviderLineup = {
    channels: [gamma],
    categories: [
      { key: "personal:News", name: "personal:News", kind: "live", channels: [gamma] },
    ],
  };
  disk.read.mockResolvedValueOnce(null);
  const lineup = await import("../src/stores/lineup");
  const settings = await import("../src/stores/settings");
  settings.useSettings.setState({
    playlists: [playlist],
    activePlaylistId: playlist.id,
  });
  await lineup.adoptCatalogue(playlist, prefixed, lineup.prepareLineup(playlist));
  const protocol = await import("../src/services/lineupProtocol");
  const revision = lineup.useLineup.getState().revision;

  const page = await protocol.queryRemoteLineup({
    playlistId: playlist.id,
    revision,
    scope: "channels",
    categoryKey: "personal:News",
  });
  assert.equal(page.ok, true);
  if (!page.ok) return;
  assert.deepEqual(
    page.page.items.map((item) => (item.kind === "channel" ? item.name : item.kind)),
    ["Gamma"],
  );

  const ordered = protocol.mutateRemoteLineup(
    request(
      { type: "item-order.mode", categoryKey: "personal:News", mode: "alphabetical" },
      "prefixed-order",
      revision,
    ),
  );
  await vi.runAllTimersAsync();
  assert.equal((await ordered).ok, true);
});

test("an inactive playlist manages its own record without touching the active facade", async () => {
  const s = await loaded();
  const library = await import("../src/stores/library");
  s.useSettings.setState({
    playlists: [playlist, playlistTwo],
    activePlaylistId: playlist.id,
  });
  const secondLease = await s.acquireLineup(playlistTwo, "tv");
  await secondLease.controller.adoptCatalogue(
    playlistTwo,
    providerTwo,
    secondLease.controller.prepareLineup(playlistTwo),
    () => true,
  );
  await vi.runAllTimersAsync();
  const revisionTwo = secondLease.controller.store.getState().revision;

  const facadeBefore = s.useLineup.getState();
  const facadeRevision = facadeBefore.revision;
  const facadeNames = facadeBefore.managedChannels.map((channel) => channel.effective.name);
  const facadeNumbers = facadeBefore.numberIndex;
  const libraryBefore = library.useLibrary.getState();

  const query = await s.queryRemoteLineup({
    playlistId: playlistTwo.id,
    revision: revisionTwo,
    scope: "categories",
  });
  assert.equal(query.ok, true);
  if (!query.ok) return;
  const serialised = JSON.stringify(query);
  assert.equal(serialised.includes("Managed"), true);
  assert.equal(serialised.includes("News"), false);

  const renamed = s.mutateRemoteLineup(
    {
      id: "two-rename",
      playlistId: playlistTwo.id,
      revision: revisionTwo,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(gamma).id,
        name: "Gamma Two",
      },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  assert.equal((await renamed).ok, true);
  await vi.runAllTimersAsync();

  const managed = secondLease.controller.store.getState();
  assert.equal(managed.revision > revisionTwo, true);
  assert.equal(
    managed.managedChannels.some((channel) => channel.effective.name === "Gamma Two"),
    true,
  );

  const foreignRevision = managed.revision;
  const foreign = s.mutateRemoteLineup(
    {
      id: "two-foreign",
      playlistId: playlistTwo.id,
      revision: foreignRevision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(alpha).id,
        name: "Taken",
      },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  assert.deepEqual(await foreign, {
    ok: false,
    reason: "invalid",
    revision: foreignRevision,
  });

  const facadeAfter = s.useLineup.getState();
  assert.equal(facadeAfter.revision, facadeRevision);
  assert.deepEqual(
    facadeAfter.managedChannels.map((channel) => channel.effective.name),
    facadeNames,
  );
  assert.equal(facadeAfter.numberIndex, facadeNumbers);
  assert.equal(library.useLibrary.getState().playlistId, libraryBefore.playlistId);
  assert.equal(library.useLibrary.getState().categoryItems, libraryBefore.categoryItems);
  assert.equal(
    disk.write.mock.calls.some((call) => call[0] === playlistTwo.id),
    true,
  );
  assert.equal(
    disk.write.mock.calls.some((call) => call[0] === playlist.id),
    false,
  );
  await secondLease.release();
});

test("an inactive Xtream owner orders its movies while Live keeps its own lineup", async () => {
  const s = await loaded();
  const library = await import("../src/stores/library");
  s.useSettings.setState({
    playlists: [playlist, xtreamPlaylist],
    activePlaylistId: playlist.id,
  });
  library.useLibrary.getState().selectPlaylist(playlist);
  const lease = await s.acquireLineup(xtreamPlaylist, "tv");
  await lease.controller.adoptCatalogue(
    xtreamPlaylist,
    xtreamProvider,
    lease.controller.prepareLineup(xtreamPlaylist),
    () => true,
  );
  vi.stubGlobal("fetch", vodFetch());
  const before = s.useLineup.getState();
  const libraryBefore = library.useLibrary.getState();
  const revision = lease.controller.store.getState().revision;
  const categoriesQuery = {
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "categories",
    contentKind: "movie",
    includeHidden: true,
  };
  const categoriesBefore = await s.queryRemoteLineup(categoriesQuery);
  assert.equal(categoriesBefore.ok, true);
  if (!categoriesBefore.ok) return;
  const unknownFilms = categoriesBefore.page.items.find(
    (item): item is LineupCategoryItem => item.kind === "category" && item.id === "movie:10",
  );
  assert.ok(unknownFilms);
  assert.equal(unknownFilms.count, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(unknownFilms, "count"), false);
  const query = {
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "items",
    categoryKey: "movie:10",
    contentKind: "movie",
  };
  const first = await s.queryRemoteLineup(query);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(
    first.page.items.map((item) => (item.kind === "item" ? item.name : "")),
    ["Zulu", "Alpha"],
  );
  const categoriesAfter = await s.queryRemoteLineup(categoriesQuery);
  assert.equal(categoriesAfter.ok, true);
  if (!categoriesAfter.ok) return;
  assert.equal(
    categoriesAfter.page.items.find(
      (item): item is LineupCategoryItem => item.kind === "category" && item.id === "movie:10",
    )?.count,
    2,
  );
  assert.equal(categoriesAfter.page.total, categoriesBefore.page.total);
  const allCategories = await s.queryRemoteLineup({
    playlistId: xtreamPlaylist.id,
    revision,
    scope: "categories",
    includeHidden: true,
  });
  assert.equal(allCategories.ok, true);
  if (!allCategories.ok) return;
  assert.equal(
    allCategories.page.items.find(
      (item): item is LineupCategoryItem => item.kind === "category" && item.id === "movie:10",
    )?.count,
    2,
  );

  const saving = s.mutateRemoteLineup(
    vodRequest(
      { type: "item-order.mode", categoryKey: "movie:10", mode: "alphabetical" },
      "inactive-movies",
      revision,
    ),
    "device-vod",
  );
  await vi.runAllTimersAsync();
  const saved = await saving;
  assert.equal(saved.ok, true);
  const sorted = await s.queryRemoteLineup({
    ...query,
    revision: saved.revision,
  });
  assert.equal(sorted.ok, true);
  if (!sorted.ok) return;
  assert.deepEqual(
    sorted.page.items.map((item) => (item.kind === "item" ? item.name : "")),
    ["Alpha", "Zulu"],
  );
  assert.equal(
    disk.write.mock.calls.some((call) => call[0] === xtreamPlaylist.id),
    true,
  );
  assert.equal(
    disk.write.mock.calls.some((call) => call[0] === playlist.id),
    false,
  );

  const vodSend = async (mutation: Record<string, unknown>, id: string) => {
    const pending = s.mutateRemoteLineup(
      {
        ...vodRequest(mutation, id, lease.controller.store.getState().revision),
        sourceVersion: 1,
      },
      "device-vod",
    );
    await vi.runAllTimersAsync();
    return pending;
  };
  const vodQuery = (extra: Record<string, unknown>) =>
    s.queryRemoteLineup({
      playlistId: xtreamPlaylist.id,
      sourceVersion: 1,
      revision: lease.controller.store.getState().revision,
      ...extra,
    });

  assert.equal(
    (
      await vodSend(
        { type: "category.rename", categoryKey: "movie:10", name: "Custom Films" },
        "vod-rename",
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await vodSend(
        { type: "category.visibility", categoryKey: "movie:10", hidden: true },
        "vod-hide",
      )
    ).ok,
    true,
  );
  assert.equal((await vodSend({ type: "playlist.reset" }, "vod-reset")).ok, true);

  const restored = await vodQuery({
    scope: "items",
    categoryKey: "movie:10",
    contentKind: "movie",
  });
  assert.equal(restored.ok, true);
  if (restored.ok) {
    assert.deepEqual(
      restored.page.items.map((item) => (item.kind === "item" ? item.name : "")),
      ["Zulu", "Alpha"],
    );
  }
  const vodCategories = await vodQuery({
    scope: "categories",
    contentKind: "movie",
    includeHidden: true,
  });
  assert.equal(vodCategories.ok, true);
  if (vodCategories.ok) {
    const films = vodCategories.page.items.find(
      (item): item is LineupCategoryItem => item.kind === "category" && item.id === "movie:10",
    );
    assert.equal(films?.name, "Provider Movies");
    assert.equal(films?.hidden, false);
    assert.equal(films?.count, 2);
  }

  const after = s.useLineup.getState();
  assert.equal(s.useSettings.getState().activePlaylistId, playlist.id);
  assert.equal(after.revision, before.revision);
  assert.equal(after.managedChannels, before.managedChannels);
  assert.equal(after.numberIndex, before.numberIndex);
  assert.equal(library.useLibrary.getState(), libraryBefore);
  await lease.release();
});

test("duplicate mutation ids deduplicate before a blocked management queue", async () => {
  const s = await loaded();
  s.useSettings.setState({
    playlists: [playlist, playlistTwo],
    activePlaylistId: playlist.id,
  });
  const secondLease = await s.acquireLineup(playlistTwo, "tv");
  await secondLease.controller.adoptCatalogue(
    playlistTwo,
    providerTwo,
    secondLease.controller.prepareLineup(playlistTwo),
    () => true,
  );
  await vi.runAllTimersAsync();
  const revisionTwo = secondLease.controller.store.getState().revision;
  const activeRevision = s.useLineup.getState().revision;
  const apply = vi.spyOn(secondLease.controller, "applyLineupMutation");

  let releaseWrite: (() => void) | null = null;
  disk.write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const blocker = s.mutateRemoteLineup(
    {
      id: "blocker",
      playlistId: playlist.id,
      revision: activeRevision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(alpha).id,
        name: "Blocked",
      },
    },
    "device-block",
  );
  await vi.runAllTimersAsync();
  for (let index = 0; index < 80 && releaseWrite === null; index += 1) {
    await Promise.resolve();
  }
  assert.equal(releaseWrite !== null, true);

  const duplicate = {
    id: "dup-id",
    playlistId: playlistTwo.id,
    revision: revisionTwo,
    mutation: {
      type: "channel.visibility",
      channelId: channelRef(gamma).id,
      hidden: true,
    },
  };
  const first = s.mutateRemoteLineup(duplicate, "device-two");
  const second = s.mutateRemoteLineup(duplicate, "device-two");
  assert.equal(first, second);
  releaseWrite?.();
  await vi.runAllTimersAsync();
  await vi.runAllTimersAsync();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.ok, true);
  assert.deepEqual(secondResult, firstResult);
  assert.equal((await blocker).ok, true);

  const replay = await s.mutateRemoteLineup(duplicate, "device-two");
  assert.deepEqual(replay, firstResult);
  const visibilityWrites = apply.mock.calls.filter(
    (call) => call[1]?.type === "channel.visibility",
  );
  assert.equal(visibilityWrites.length, 1);
  assert.equal(disk.write.mock.calls.filter((call) => call[0] === playlistTwo.id).length, 1);
  await secondLease.release();
});

test("malformed mutation requests return invalid without a revision claim", async () => {
  const s = await loaded();
  assert.deepEqual(await s.mutateRemoteLineup({ unexpected: true }), {
    ok: false,
    reason: "invalid",
    revision: 0,
  });
  assert.deepEqual(
    await s.mutateRemoteLineup(
      request({ type: "channel.rename" }, "missing-fields"),
      "missing-fields",
    ),
    { ok: false, reason: "invalid", revision: 0 },
  );
  assert.deepEqual(
    await s.mutateRemoteLineup(
      request({ type: "not.a.mutation" }, "unknown-type"),
      "unknown-type",
    ),
    { ok: false, reason: "invalid", revision: 0 },
  );
  assert.equal(disk.write.mock.calls.length, 0);
});

test("a TV revision advance during deferred VOD preparation returns conflict", async () => {
  const s = await vodLoaded();
  const baseFetch = vodFetch();
  let releaseStreams: ((response: Response) => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if ((url.searchParams.get("action") ?? "") === "get_vod_streams") {
        return new Promise<Response>((resolve) => {
          releaseStreams = resolve;
        });
      }
      return baseFetch(input);
    }),
  );
  const revision = s.useLineup.getState().revision;
  const tvLease = await s.acquireLineup(xtreamPlaylist, "tv");
  const pending = s.mutateRemoteLineup(
    vodRequest(
      {
        type: "item.place",
        categoryKey: "movie:10",
        placement: {
          itemId: "xtream:playlist-vod:movie:100",
          afterId: "xtream:playlist-vod:movie:101",
        },
      },
      "vod-place",
      revision,
    ),
    "device-one",
  );
  for (let index = 0; index < 80 && releaseStreams === null; index += 1) {
    await Promise.resolve();
  }
  assert.equal(releaseStreams !== null, true);

  const tvRevision = tvLease.controller.store.getState().revision;
  const advanced = tvLease.controller.applyLineupMutation(tvRevision, {
    type: "category-order.mode",
    section: "movie",
    mode: "alphabetical",
  });
  await vi.runAllTimersAsync();
  assert.equal((await advanced).ok, true);
  const currentRevision = tvLease.controller.store.getState().revision;
  assert.equal(currentRevision > tvRevision, true);

  releaseStreams?.(
    vodResponse([
      { stream_id: "100", category_id: "10", name: "Zulu", container_extension: "mp4" },
      { stream_id: "101", category_id: "10", name: "Alpha", container_extension: "mp4" },
    ]),
  );
  await vi.runAllTimersAsync();
  assert.deepEqual(await pending, {
    ok: false,
    reason: "conflict",
    revision: currentRevision,
  });
  await tvLease.release();
});

const combinedLive: ProviderLineup = {
  channels: [alpha, beta, gamma],
  categories: [...provider.categories, ...providerTwo.categories],
};

async function inactiveLiveOwner() {
  const s = await loaded();
  const library = await import("../src/stores/library");
  s.useSettings.setState({
    playlists: [playlist, playlistTwo],
    activePlaylistId: playlist.id,
  });
  library.useLibrary.getState().selectPlaylist(playlist);
  const lease = await s.acquireLineup(playlistTwo, "tv");
  await lease.controller.adoptCatalogue(
    playlistTwo,
    combinedLive,
    lease.controller.prepareLineup(playlistTwo),
    () => true,
  );
  await vi.runAllTimersAsync();
  const state = { revision: lease.controller.store.getState().revision };
  const send = async (mutation: Record<string, unknown>, id: string) => {
    const pending = s.mutateRemoteLineup(
      {
        id,
        playlistId: playlistTwo.id,
        sourceVersion: 1,
        revision: state.revision,
        mutation,
      },
      "device-two",
    );
    await vi.runAllTimersAsync();
    const result = await pending;
    assert.equal(result.ok, true);
    state.revision = result.revision;
    return result;
  };
  const query = (extra: Record<string, unknown>) =>
    s.queryRemoteLineup({
      playlistId: playlistTwo.id,
      sourceVersion: 1,
      revision: state.revision,
      ...extra,
    });
  return { s, lease, library, send, query, state };
}

const channelNames = (result: { page?: { items: { kind: string; name?: string }[] } }) =>
  (result.page?.items ?? []).filter((item) => item.kind === "channel").map((item) => item.name);

test("an inactive Live owner playlist reset restores provider state and keeps personal data", async () => {
  const { s, lease, library, send, query } = await inactiveLiveOwner();
  const { usePersonal } = await import("../src/stores/personal");
  usePersonal.setState({
    favourites: [
      {
        itemKey: "keep-me",
        playlistId: playlistTwo.id,
        kind: "live",
        providerId: "a",
        categoryKey: "News",
        name: "Alpha",
        logo: "",
      },
    ],
    progress: [{ itemKey: "keep-progress", seconds: 12, duration: 120, legacyOrder: 0 }],
    lastPlayed: {
      playlistId: playlistTwo.id,
      kind: "live",
      itemKey: "keep-me",
      categoryKey: "News",
    },
  });
  const personalBefore = usePersonal.getState();

  const activeRename = s.mutateRemoteLineup(
    {
      id: "active-alpha",
      playlistId: playlist.id,
      sourceVersion: 1,
      revision: s.useLineup.getState().revision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(alpha).id,
        name: "Active Alpha",
      },
    },
    "device-one",
  );
  await vi.runAllTimersAsync();
  assert.equal((await activeRename).ok, true);
  await vi.runAllTimersAsync();

  await send({ type: "category.rename", categoryKey: "News", name: "Headlines" }, "r-cat-name");
  await send({ type: "category.visibility", categoryKey: "News", hidden: true }, "r-cat-hide");
  await send(
    { type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" },
    "r-chan-name",
  );
  await send(
    { type: "channel.number", channelId: channelRef(beta).id, number: 42 },
    "r-chan-number",
  );
  await send(
    { type: "channel.visibility", channelId: channelRef(gamma).id, hidden: true },
    "r-chan-hide",
  );
  await send(
    { type: "category.place", placement: { itemId: "Managed", beforeId: "News" } },
    "r-cat-order",
  );
  await send(
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
    "r-item-order",
  );

  const facadeBefore = s.useLineup.getState();
  const facadeRevision = facadeBefore.revision;
  const facadeNames = facadeBefore.managedChannels.map((channel) => channel.effective.name);
  const facadeNumbers = facadeBefore.numberIndex;
  const libraryBefore = library.useLibrary.getState();

  const writesBeforeReset = disk.write.mock.calls.length;
  const clearsBeforeReset = disk.clear.mock.calls.length;
  const removesBeforeReset = disk.remove.mock.calls.length;
  await send({ type: "playlist.reset" }, "r-reset");
  await vi.runAllTimersAsync();
  const resetWrites = disk.write.mock.calls.slice(writesBeforeReset);
  assert.equal(resetWrites.length > 0, true);
  assert.equal(
    resetWrites.every((call) => call[0] === playlistTwo.id),
    true,
  );
  assert.equal(disk.clear.mock.calls.length, clearsBeforeReset);
  assert.equal(disk.remove.mock.calls.length, removesBeforeReset);

  const categories = await query({
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  assert.equal(categories.ok, true);
  if (categories.ok) {
    const live = categories.page.items.filter(
      (item): item is LineupCategoryItem =>
        item.kind === "category" && item.contentKind === "live",
    );
    assert.deepEqual(
      live.map((item) => item.id),
      ["News", "Managed"],
    );
    const news = live.find((item) => item.id === "News");
    assert.equal(news?.name, "News");
    assert.equal(news?.hidden, false);
  }

  const newsChannels = await query({
    scope: "channels",
    categoryKey: "News",
    includeHidden: true,
  });
  assert.equal(newsChannels.ok, true);
  if (newsChannels.ok) {
    const items = newsChannels.page.items.filter(
      (item): item is LineupChannelItem => item.kind === "channel",
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["Alpha", "Beta"],
    );
    assert.deepEqual(
      items.map((item) => item.number),
      [1, 2],
    );
  }

  const managedChannels = await query({
    scope: "channels",
    categoryKey: "Managed",
    includeHidden: true,
  });
  assert.equal(managedChannels.ok, true);
  if (managedChannels.ok) {
    const gammaItem = managedChannels.page.items.find(
      (item): item is LineupChannelItem => item.kind === "channel" && item.name === "Gamma",
    );
    assert.equal(gammaItem?.hidden, false);
  }

  const writes = disk.write.mock.calls.filter((call) => call[0] === playlistTwo.id);
  const record = writes[writes.length - 1]?.[1] as {
    personalisation?: unknown;
  };
  assert.deepEqual(record?.personalisation, emptyPersonalisation());

  const personalAfter = usePersonal.getState();
  assert.deepEqual(personalAfter.favourites, personalBefore.favourites);
  assert.deepEqual(personalAfter.progress, personalBefore.progress);
  assert.deepEqual(personalAfter.lastPlayed, personalBefore.lastPlayed);

  const facadeAfter = s.useLineup.getState();
  assert.equal(s.useSettings.getState().activePlaylistId, playlist.id);
  assert.equal(facadeAfter.revision, facadeRevision);
  assert.deepEqual(
    facadeAfter.managedChannels.map((channel) => channel.effective.name),
    facadeNames,
  );
  assert.equal(facadeAfter.numberIndex, facadeNumbers);
  assert.equal(library.useLibrary.getState(), libraryBefore);
  await lease.release();
});

test("an inactive Live owner category order reset keeps names hidden flags and item order", async () => {
  const { lease, send, query } = await inactiveLiveOwner();

  await send(
    { type: "category.place", placement: { itemId: "Managed", beforeId: "News" } },
    "co-place",
  );
  await send({ type: "category.rename", categoryKey: "News", name: "Headlines" }, "co-name");
  await send({ type: "category.visibility", categoryKey: "News", hidden: true }, "co-hide");
  await send(
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
    "co-items",
  );

  const before = await query({
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  assert.equal(before.ok, true);
  if (before.ok) {
    const live = before.page.items.filter(
      (item): item is LineupCategoryItem =>
        item.kind === "category" && item.contentKind === "live",
    );
    assert.deepEqual(
      live.map((item) => item.id),
      ["Managed", "News"],
    );
  }

  await send({ type: "category-order.reset", section: "live" }, "co-reset");

  const after = await query({
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  assert.equal(after.ok, true);
  if (after.ok) {
    const live = after.page.items.filter(
      (item): item is LineupCategoryItem =>
        item.kind === "category" && item.contentKind === "live",
    );
    assert.deepEqual(
      live.map((item) => item.id),
      ["News", "Managed"],
    );
    const news = live.find((item) => item.id === "News");
    assert.equal(news?.name, "Headlines");
    assert.equal(news?.hidden, true);
  }

  const newsChannels = await query({
    scope: "channels",
    categoryKey: "News",
    includeHidden: true,
  });
  assert.equal(newsChannels.ok, true);
  if (newsChannels.ok) {
    assert.deepEqual(channelNames(newsChannels), ["Beta", "Alpha"]);
  }
  await lease.release();
});

test("an inactive Live owner item order reset keeps category order and channel values", async () => {
  const { lease, send, query } = await inactiveLiveOwner();

  await send(
    { type: "category.place", placement: { itemId: "Managed", beforeId: "News" } },
    "io-cat-order",
  );
  await send(
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
    "io-items",
  );
  await send(
    { type: "channel.rename", channelId: channelRef(alpha).id, name: "Mine" },
    "io-name",
  );
  await send(
    { type: "channel.number", channelId: channelRef(alpha).id, number: 42 },
    "io-number",
  );
  await send(
    { type: "channel.visibility", channelId: channelRef(alpha).id, hidden: true },
    "io-hide",
  );

  const before = await query({
    scope: "channels",
    categoryKey: "News",
    includeHidden: true,
  });
  assert.equal(before.ok, true);
  if (before.ok) {
    assert.equal(before.page.orderMode, "custom");
    const items = before.page.items.filter(
      (item): item is LineupChannelItem => item.kind === "channel",
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["Beta", "Mine"],
    );
  }

  await send({ type: "item-order.reset", categoryKey: "News" }, "io-reset");

  const newsChannels = await query({
    scope: "channels",
    categoryKey: "News",
    includeHidden: true,
  });
  assert.equal(newsChannels.ok, true);
  if (newsChannels.ok) {
    assert.equal(newsChannels.page.orderMode, "provider");
    const items = newsChannels.page.items.filter(
      (item): item is LineupChannelItem => item.kind === "channel",
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["Mine", "Beta"],
    );
    assert.deepEqual(
      items.map((item) => item.number),
      [42, 2],
    );
    const alphaItem = items.find((item) => item.name === "Mine");
    assert.equal(alphaItem?.hidden, true);
  }

  const categories = await query({
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  assert.equal(categories.ok, true);
  if (categories.ok) {
    const live = categories.page.items.filter(
      (item): item is LineupCategoryItem =>
        item.kind === "category" && item.contentKind === "live",
    );
    assert.deepEqual(
      live.map((item) => item.id),
      ["Managed", "News"],
    );
  }
  await lease.release();
});

test("an unknown reset category is rejected at the mutation boundary without a write", async () => {
  const { s, lease, query, state } = await inactiveLiveOwner();
  const writesBefore = disk.write.mock.calls.length;
  const pending = s.mutateRemoteLineup(
    {
      id: "unknown-reset",
      playlistId: playlistTwo.id,
      sourceVersion: 1,
      revision: state.revision,
      mutation: { type: "item-order.reset", categoryKey: "Missing" },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(disk.write.mock.calls.length, writesBefore);
  const current = await query({ scope: "categories", contentKind: "live" });
  assert.equal(current.ok, true);
  await lease.release();
});

test("a replaced source version fences old requests and separates dedupe identities", async () => {
  const s = await loaded();
  s.useSettings.setState({
    playlists: [playlist, playlistTwo],
    activePlaylistId: playlist.id,
  });
  const lease = await s.acquireLineup(playlistTwo, "tv");
  await lease.controller.adoptCatalogue(
    playlistTwo,
    providerTwo,
    lease.controller.prepareLineup(playlistTwo),
    () => true,
  );
  await vi.runAllTimersAsync();
  let revision = lease.controller.store.getState().revision;

  const first = s.mutateRemoteLineup(
    {
      id: "epoch-rename",
      playlistId: playlistTwo.id,
      sourceVersion: 1,
      revision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(gamma).id,
        name: "Gamma One",
      },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
  revision = firstResult.revision;

  const writes = disk.write.mock.calls.filter((call) => call[0] === playlistTwo.id);
  const record = writes[writes.length - 1]?.[1] as { revision?: number };
  assert.equal(typeof record?.revision, "number");
  const persistedRevision = record.revision as number;
  assert.equal(persistedRevision, revision);

  await lease.release();
  const replacement = { ...playlistTwo, sourceVersion: 2 };
  s.useSettings.setState({
    playlists: [playlist, replacement],
    activePlaylistId: playlist.id,
  });
  disk.read.mockResolvedValue(record);
  const nextLease = await s.acquireLineup(replacement, "tv");
  await nextLease.controller.adoptCatalogue(
    replacement,
    providerTwo,
    nextLease.controller.prepareLineup(replacement),
    () => true,
  );
  await vi.runAllTimersAsync();
  const nextRevision = nextLease.controller.store.getState().revision;
  assert.equal(nextRevision > persistedRevision, true);

  const writesBefore = disk.write.mock.calls.length;
  const staleQuery = await s.queryRemoteLineup({
    playlistId: playlistTwo.id,
    sourceVersion: 1,
    revision: nextRevision,
    scope: "categories",
  });
  assert.deepEqual(staleQuery, {
    ok: false,
    reason: "unavailable",
    revision: nextRevision,
  });
  const staleMutation = s.mutateRemoteLineup(
    {
      id: "epoch-stale",
      playlistId: playlistTwo.id,
      sourceVersion: 1,
      revision: nextRevision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(gamma).id,
        name: "Gamma Stale",
      },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  const staleResult = await staleMutation;
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.reason, "unavailable");
  assert.equal(disk.write.mock.calls.length, writesBefore);

  const writesBeforeFresh = disk.write.mock.calls.length;
  const fresh = s.mutateRemoteLineup(
    {
      id: "epoch-rename",
      playlistId: playlistTwo.id,
      sourceVersion: 2,
      revision: nextRevision,
      mutation: {
        type: "channel.rename",
        channelId: channelRef(gamma).id,
        name: "Gamma Two",
      },
    },
    "device-two",
  );
  await vi.runAllTimersAsync();
  const freshResult = await fresh;
  assert.equal(freshResult.ok, true);
  assert.equal(disk.write.mock.calls.length > writesBeforeFresh, true);
  const managed = nextLease.controller.store.getState();
  assert.equal(
    managed.managedChannels.some((channel) => channel.effective.name === "Gamma Two"),
    true,
  );
  await nextLease.release();
});

test("an obsolete personal preparation publishes no write after a source replacement", async () => {
  const s = await loaded();
  s.useSettings.setState({
    playlists: [playlist, playlistTwo],
    activePlaylistId: playlist.id,
  });
  const raw = await s.acquireLineup(playlistTwo, "tv");
  const adopt = vi.spyOn(raw.controller, "adoptCatalogue");
  const cache = await import("../src/services/disk");
  const readSpy = vi
    .spyOn(cache, "read")
    .mockResolvedValue(
      '#EXTM3U\n#EXTINF:-1 group-title="Managed",Gamma\nhttp://example.invalid/gamma\n',
    );
  const writesBefore = disk.write.mock.calls.length;
  const absentBefore = disk.ifAbsent.mock.calls.length;
  const facadeBefore = s.useLineup.getState();
  let releasePersonal: ((value: unknown) => void) | undefined;
  try {
    disk.read.mockResolvedValue(null).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePersonal = resolve;
        }),
    );
    const pendingQuery = s.queryRemoteLineup({
      playlistId: playlistTwo.id,
      sourceVersion: 1,
      revision: 0,
      scope: "categories",
    });
    const pendingMutation = s.mutateRemoteLineup(
      {
        id: "obsolete-preparation",
        playlistId: playlistTwo.id,
        sourceVersion: 1,
        revision: 0,
        mutation: { type: "category.rename", categoryKey: "Managed", name: "Mine" },
      },
      "device-one",
    );
    for (let index = 0; index < 80 && !releasePersonal; index += 1) {
      await Promise.resolve();
    }
    assert.ok(releasePersonal);
    assert.equal(adopt.mock.calls.length, 0);

    const replacement = { ...playlistTwo, sourceVersion: 2 };
    s.useSettings.setState({
      playlists: [playlist, replacement],
      activePlaylistId: playlist.id,
    });
    const savedReplacement = JSON.parse(JSON.stringify(replacement));
    releasePersonal(null);
    await vi.runAllTimersAsync();

    const queryResult = await pendingQuery;
    const mutationResult = await pendingMutation;
    assert.equal(queryResult.ok, false);
    assert.equal(queryResult.reason, "unavailable");
    assert.equal(mutationResult.ok, false);
    assert.equal(mutationResult.reason, "unavailable");
    assert.equal(adopt.mock.calls.length, 0);
    assert.equal(raw.controller.store.getState().playlistId, "");
    assert.equal(raw.controller.store.getState().lineupSummary(), null);
    assert.equal(disk.write.mock.calls.length, writesBefore);
    assert.equal(disk.ifAbsent.mock.calls.length, absentBefore);
    const facadeAfter = s.useLineup.getState();
    assert.equal(facadeAfter.revision, facadeBefore.revision);
    assert.equal(facadeAfter.managedChannels, facadeBefore.managedChannels);
    assert.deepEqual(
      s.useSettings.getState().playlists.find((item) => item.id === playlistTwo.id),
      savedReplacement,
    );
  } finally {
    releasePersonal?.(null);
    await vi.runAllTimersAsync();
    readSpy.mockRestore();
    await raw.release();
  }
});
