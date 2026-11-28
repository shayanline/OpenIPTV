import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { channelRef, type ProviderLineup, type StoredLineupV1 } from "../src/services/lineup";
import type { LineupMutation } from "../src/stores/lineup";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

const disk = vi.hoisted(() => ({
  saved: null as StoredLineupV1 | null,
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

vi.mock("../src/services/lineupCapabilities", () => ({
  CUSTOM_CATEGORIES_ENABLED: true,
}));

const playlist: Playlist = {
  id: "playlist-one",
  name: "One",
  source: { kind: "m3u", url: "http://example.invalid/list.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};

const makeChannel = (id: string, number: number, categoryKey: string): Channel => ({
  id,
  name: id.toUpperCase(),
  number,
  group: categoryKey,
  categoryKey,
  logo: "",
  quality: "",
  url: `http://example.invalid/${id}`,
  sourceFingerprint: id.padEnd(16, "0"),
});
const alpha = makeChannel("alpha", 1, "News");
const beta = makeChannel("beta", 2, "News");
const sport = makeChannel("sport", 3, "Sport");
const provider: ProviderLineup = {
  channels: [alpha, beta, sport],
  categories: [
    { key: "News", name: "News", kind: "live", channels: [alpha, beta] },
    { key: "Sport", name: "Sport", kind: "live", channels: [sport] },
  ],
};
const initial = {
  version: 1,
  revision: 0,
  personalisation: {
    channels: { missing: { name: "Unavailable" } },
    categories: {},
    categoryOrder: [],
    personalCategories: [],
    orderMode: "provider",
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  vi.resetModules();
  disk.saved = null;
  disk.read.mockReset();
  disk.write.mockReset();
  disk.remove.mockReset();
  disk.clear.mockReset();
  disk.ifAbsent.mockReset();
  disk.ifAbsent.mockResolvedValue(true);
  disk.write.mockImplementation(async (_playlistId, value) => {
    disk.saved = value as StoredLineupV1;
  });
  disk.remove.mockResolvedValue();
  disk.clear.mockResolvedValue();
});

async function run(path: "television" | "phone") {
  disk.read.mockResolvedValueOnce(initial);
  const { useSettings } = await import("../src/stores/settings");
  useSettings.setState({ playlists: [playlist], activePlaylistId: playlist.id });
  const lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(playlist, provider, lineup.prepareLineup(playlist));
  const protocol = await import("../src/services/lineupProtocol");
  let requestId = 0;
  const apply = async (domain: LineupMutation, remote: Record<string, unknown>) => {
    const revision = lineup.useLineup.getState().revision;
    requestId += 1;
    const pending =
      path === "television"
        ? lineup.applyLineupMutation(revision, domain)
        : protocol.mutateRemoteLineup({
            id: `request-${requestId}`,
            playlistId: playlist.id,
            sourceVersion: playlist.sourceVersion,
            revision,
            mutation: remote,
          });
    await vi.runAllTimersAsync();
    const result = await pending;
    assert.equal(result.ok, true);
  };
  await apply(
    { type: "channel.rename", channel: channelRef(alpha), name: "My Alpha" },
    { type: "channel.rename", channelId: channelRef(alpha).id, name: "My Alpha" },
  );
  await apply(
    { type: "channel.number", channel: channelRef(alpha), number: 101 },
    { type: "channel.number", channelId: channelRef(alpha).id, number: 101 },
  );
  await apply(
    { type: "channel.visibility", channel: channelRef(sport), hidden: true },
    { type: "channel.visibility", channelId: channelRef(sport).id, hidden: true },
  );
  await apply(
    { type: "item-order.mode", categoryKey: "News", mode: "number" },
    { type: "item-order.mode", categoryKey: "News", mode: "number" },
  );
  await apply(
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
  );
  await apply(
    { type: "category.place", placement: { itemId: "Sport", beforeId: "News" } },
    { type: "category.place", placement: { itemId: "Sport", beforeId: "News" } },
  );
  await apply(
    { type: "personal-category.create", name: "Mine" },
    { type: "personal-category.create", name: "Mine" },
  );
  const personalKey =
    lineup.useLineup.getState().managedCategories.find((item) => item.personal)?.key ?? "";
  const personalId = personalKey.slice("personal:".length);
  await apply(
    {
      type: "personal-category.memberships",
      channel: channelRef(alpha),
      categoryIds: [personalId],
    },
    {
      type: "personal-category.memberships",
      channelId: channelRef(alpha).id,
      categoryIds: [personalId],
    },
  );
  await apply(
    {
      type: "personal-category.memberships",
      channel: channelRef(beta),
      categoryIds: [personalId],
    },
    {
      type: "personal-category.memberships",
      channelId: channelRef(beta).id,
      categoryIds: [personalId],
    },
  );
  await apply(
    {
      type: "personal-category.place-channel",
      categoryId: personalId,
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
    {
      type: "personal-category.place-channel",
      categoryId: personalId,
      placement: { itemId: channelRef(beta).id, beforeId: channelRef(alpha).id },
    },
  );
  const unavailable = lineup.useLineup.getState().unavailable[0];
  await apply(
    { type: "unavailable.remove", key: unavailable.key },
    { type: "unavailable.remove", key: unavailable.key },
  );
  const state = lineup.useLineup.getState();
  return {
    stored: disk.saved,
    revision: state.revision,
    channels: state.channels,
    categories: state.categories,
    numberIndex: Array.from(state.numberIndex.entries()),
    channelsPage: state.queryLineup({
      playlistId: playlist.id,
      revision: state.revision,
      scope: "channels",
      includeHidden: true,
    }),
    categoriesPage: state.queryLineup({
      playlistId: playlist.id,
      revision: state.revision,
      scope: "categories",
      includeHidden: true,
    }),
    personalPage: state.queryLineup({
      playlistId: playlist.id,
      revision: state.revision,
      scope: "personal-categories",
      includeHidden: true,
    }),
  };
}

test("television and phone mutations produce identical durable and paged lineups", async () => {
  const television = await run("television");
  vi.resetModules();
  disk.saved = null;
  const phone = await run("phone");
  const normalize = (result: Awaited<ReturnType<typeof run>>) => {
    const id = result.stored?.personalisation.personalCategories[0]?.id ?? "";
    return id
      ? JSON.parse(JSON.stringify(result).split(id).join("<personal-category>"))
      : result;
  };
  assert.deepEqual(normalize(phone), normalize(television));
});
