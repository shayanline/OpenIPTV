import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import { parseStoredLineup, type ProviderLineup } from "../src/services/lineup";
import type { Playlist } from "../src/stores/settings";
import type { PlaybackProgressSeed } from "../src/types";

const personalDisk = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  writes: [] as Array<[string, unknown]>,
  fail: false,
}));

vi.mock("../src/services/personalDisk", () => ({
  readLineup: async (playlistId: string) => personalDisk.values.get(playlistId) ?? null,
  writeLineup: async (playlistId: string, value: unknown) => {
    if (personalDisk.fail) throw new Error("quota");
    personalDisk.values.set(playlistId, value);
    personalDisk.writes.push([playlistId, value]);
  },
  removeLineup: async (playlistId: string) => {
    personalDisk.values.delete(playlistId);
  },
  clearLineups: async () => {
    personalDisk.values.clear();
  },
  writeLineupIfAbsent: async (playlistId: string, value: unknown) => {
    if (personalDisk.fail) throw new Error("quota");
    if (personalDisk.values.has(playlistId)) return false;
    personalDisk.values.set(playlistId, value);
    personalDisk.writes.push([playlistId, value]);
    return true;
  },
}));

const playlist = (id: string, hiddenCategories: string[] = []): Playlist => ({
  id,
  name: id,
  source: { kind: "m3u", url: `http://example.invalid/${id}.m3u` },
  sourceVersion: 1,
  ...(hiddenCategories.length ? { hiddenCategories } : {}),
});
const provider: ProviderLineup = {
  channels: [
    {
      id: "alpha",
      name: "Alpha",
      number: 1,
      group: "News",
      categoryKey: "News",
      logo: "",
      quality: "",
      url: "http://example.invalid/alpha",
      sourceFingerprint: "0123456789abcdef",
    },
  ],
  categories: [{ key: "News", name: "News", kind: "live", channels: [] }],
};
const movieSeed = (itemKey: string): PlaybackProgressSeed => ({
  itemKey,
  playlistId: "one",
  kind: "movie",
  providerId: itemKey.split(":").pop(),
  categoryKey: "movie:films",
  name: itemKey,
  logo: "",
});
const episodeSeed = (itemKey: string): PlaybackProgressSeed => ({
  itemKey,
  playlistId: "one",
  kind: "episode",
  providerId: itemKey.split(":").pop(),
  episodeIdentity: itemKey,
  categoryKey: "series:drama",
  name: itemKey,
  logo: "",
  parentKey: "series-one",
  parentProviderId: "series-one",
  parentName: "Series One",
});

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  vi.resetModules();
  personalDisk.values.clear();
  personalDisk.writes = [];
  personalDisk.fail = false;
});

test("migrates the complete previous state matrix into final owned schemas", async () => {
  const settingsCases = [
    {},
    { fontId: "serif", panelTimeout: 30 },
    { sortAlphabetically: true },
    { sortAlphabetically: false },
    {
      playlists: [
        {
          id: "legacy",
          name: "Legacy",
          url: "http://example.invalid/list.m3u",
          hiddenCategories: ["News", 4],
        },
      ],
      activePlaylistId: "legacy",
    },
    {
      playlists: [
        {
          id: "m3u",
          name: "M3U",
          source: { kind: "m3u", url: "http://example.invalid/list.m3u" },
          sourceVersion: 1,
        },
      ],
    },
    {
      playlists: [
        {
          id: "xtream",
          name: "Xtream",
          source: {
            kind: "xtream",
            server: "https://provider.invalid",
            username: "viewer",
            password: "secret",
            output: "ts",
          },
          sourceVersion: 1,
        },
      ],
    },
  ];
  for (const saved of settingsCases) {
    localStorage.setItem("openiptv.settings", JSON.stringify(saved));
    vi.resetModules();
    const { useSettings } = await import("../src/stores/settings");
    const state = useSettings.getState();
    assert.equal("fontId" in state, false);
    assert.equal("panelTimeout" in state, false);
    assert.equal("sortAlphabetically" in state, false);
    assert.equal(
      state.playlists.every(
        (item) => item.source.kind === "m3u" || item.source.kind === "xtream",
      ),
      true,
    );
    if (Object.keys(saved).length === 0) {
      assert.deepEqual(state.playlists, []);
      assert.equal(state.activePlaylistId, "");
      assert.equal(state.locale, "system");
      assert.equal(state.showClock, true);
    }
    if ("sortAlphabetically" in saved) {
      assert.equal(
        (await import("../src/stores/settings")).legacyLineupOrderMode(),
        saved.sortAlphabetically ? "alphabetical" : "provider",
      );
    }
  }

  const lineupCases = [
    null,
    {
      version: 1,
      revision: 4,
      personalisation: {
        channels: {},
        categories: {},
        categoryOrder: [],
        personalCategories: [],
        orderMode: "custom",
      },
    },
    {
      version: 1,
      revision: "bad",
      personalisation: {
        channels: { unsafe: { name: "Mine", address: "http://secret.invalid" } },
        unknown: true,
      },
      unknown: true,
    },
    { version: 1, personalisation: null },
  ];
  for (const saved of lineupCases) {
    const parsed = parseStoredLineup(saved);
    assert.equal(parsed.version, 1);
    assert.equal(JSON.stringify(parsed).includes("http://"), false);
    assert.equal(JSON.stringify(parsed).includes("address"), false);
    assert.deepEqual(Object.keys(parsed).sort(), ["personalisation", "revision", "version"]);
  }

  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [
        {
          itemKey: "movie",
          playlistId: "one",
          kind: "movie",
          providerId: "1",
          categoryKey: "films",
          name: "Movie",
          logo: "",
          unknown: true,
        },
      ],
      lastPlayed: {
        playlistId: "one",
        kind: "live",
        itemKey: "alpha",
        categoryKey: "News",
        address: "http://secret.invalid",
      },
      progress: Array.from({ length: 110 }, (_, index) => ({
        itemKey: `item-${index}`,
        seconds: index,
      })),
      unknown: true,
    }),
  );
  vi.resetModules();
  const { usePersonal } = await import("../src/stores/personal");
  assert.equal(usePersonal.getState().progress.length, 100);
  assert.equal(JSON.stringify(usePersonal.getState()).includes("secret"), false);
});

test("keeps legacy order until every playlist record commits", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      sortAlphabetically: true,
      playlists: [
        { id: "one", name: "One", url: "http://example.invalid/one.m3u" },
        { id: "two", name: "Two", url: "http://example.invalid/two.m3u" },
      ],
    }),
  );
  const settings = await import("../src/stores/settings");
  settings.completeOrderModeMigration("one");
  assert.equal(
    JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}").sortAlphabetically,
    true,
  );
  settings.completeOrderModeMigration("two");
  assert.equal(
    "sortAlphabetically" in JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}"),
    false,
  );
});

test("keeps hidden categories until their playlist record commits", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      playlists: [
        {
          id: "one",
          name: "One",
          url: "http://example.invalid/one.m3u",
          hiddenCategories: ["News"],
        },
      ],
    }),
  );
  const settings = await import("../src/stores/settings");
  assert.deepEqual(settings.useSettings.getState().playlists[0].hiddenCategories, ["News"]);
  settings.completeHiddenCategoryMigration("one");
  assert.equal(settings.useSettings.getState().playlists[0].hiddenCategories, undefined);
});

test("keeps combined order and hidden migration markers until each owner commits", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      sortAlphabetically: false,
      playlists: [
        {
          id: "one",
          name: "One",
          url: "http://example.invalid/one.m3u",
          hiddenCategories: ["News"],
        },
        {
          id: "two",
          name: "Two",
          url: "http://example.invalid/two.m3u",
          hiddenCategories: ["Sport"],
        },
      ],
    }),
  );
  const settings = await import("../src/stores/settings");
  assert.equal(settings.legacyLineupOrderMode(), "provider");
  settings.completeHiddenCategoryMigration("one");
  settings.completeOrderModeMigration("two");
  let saved = JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}");
  assert.equal(saved.sortAlphabetically, false);
  assert.equal(saved.playlists[0].hiddenCategories, undefined);
  assert.deepEqual(saved.playlists[1].hiddenCategories, ["Sport"]);
  settings.completeOrderModeMigration("one");
  settings.completeHiddenCategoryMigration("two");
  saved = JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}");
  assert.equal("sortAlphabetically" in saved, false);
  assert.equal("hiddenCategories" in saved.playlists[1], false);
});

test("retries a failed lineup write without duplicate work", async () => {
  const source = playlist("one", ["News"]);
  personalDisk.fail = true;
  let lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  await vi.runAllTimersAsync();
  assert.equal(personalDisk.values.has("one"), false);
  personalDisk.fail = false;
  vi.resetModules();
  lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  await vi.runAllTimersAsync();
  assert.equal(personalDisk.values.has("one"), true);
  assert.equal(personalDisk.writes.length, 1);
});

test("does not replace newer version one personalisation with legacy values", async () => {
  const source = playlist("one", ["News"]);
  personalDisk.values.set("one", {
    version: 1,
    revision: 8,
    personalisation: {
      channels: {},
      categories: { News: { name: "My News" } },
      categoryOrder: [],
      personalCategories: [],
      orderMode: "number",
    },
  });
  const lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  assert.equal(lineup.useLineup.getState().orderMode, "number");
  assert.equal(lineup.useLineup.getState().managedCategories[0].name, "My News");
});

test("preserves legacy progress order under one captured base time", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [
        { itemKey: "xtream:one:movie:1", seconds: 20 },
        { itemKey: "xtream:one:movie:2", seconds: 40 },
      ],
    }),
  );
  const { usePersonal } = await import("../src/stores/personal");
  usePersonal
    .getState()
    .resolveLegacyProgress([movieSeed("xtream:one:movie:1"), movieSeed("xtream:one:movie:2")]);
  const first = usePersonal.getState().progressFor("xtream:one:movie:1");
  const second = usePersonal.getState().progressFor("xtream:one:movie:2");
  assert.equal(
    (first as { updatedAt: number }).updatedAt < (second as { updatedAt: number }).updatedAt,
    true,
  );
});

test("resolves movies from the complete index", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [{ itemKey: "xtream:one:movie:1", seconds: 20 }],
    }),
  );
  const { usePersonal } = await import("../src/stores/personal");
  usePersonal.getState().resolveLegacyProgress([movieSeed("xtream:one:movie:1")]);
  assert.equal(usePersonal.getState().progressFor("xtream:one:movie:1")?.kind, "movie");
});

test("resolves episodes only from their authoritative series detail", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [{ itemKey: "xtream:one:episode:1", seconds: 20 }],
    }),
  );
  const { usePersonal } = await import("../src/stores/personal");
  usePersonal.getState().resolveLegacyProgress([movieSeed("xtream:one:movie:1")]);
  assert.equal(
    "legacyOrder" in (usePersonal.getState().progressFor("xtream:one:episode:1") ?? {}),
    true,
  );
  usePersonal.getState().resolveLegacyProgress([episodeSeed("xtream:one:episode:1")]);
  assert.equal(usePersonal.getState().progressFor("xtream:one:episode:1")?.kind, "episode");
});

test("makes no durable change on a second completed launch", async () => {
  const source = playlist("one");
  personalDisk.values.set("one", {
    version: 1,
    revision: 2,
    personalisation: {
      channels: {},
      categories: {},
      categoryOrder: [],
      personalCategories: [],
      orderMode: "provider",
    },
  });
  let lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  await vi.runAllTimersAsync();
  vi.resetModules();
  lineup = await import("../src/stores/lineup");
  await lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  await vi.runAllTimersAsync();
  assert.equal(personalDisk.writes.length, 0);
});

test("publishes the first effective lineup only after cache and personal data resolve", async () => {
  let release!: (value: unknown) => void;
  vi.doMock("../src/services/personalDisk", () => ({
    readLineup: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    writeLineup: async () => {},
    removeLineup: async () => {},
    clearLineups: async () => {},
  }));
  vi.resetModules();
  const lineup = await import("../src/stores/lineup");
  const source = playlist("one");
  const adoption = lineup.adoptCatalogue(source, provider, lineup.prepareLineup(source));
  await vi.waitFor(() => assert.equal(typeof release, "function"));
  assert.equal(lineup.useLineup.getState().playlistId, "");
  release({
    version: 1,
    revision: 2,
    personalisation: {
      channels: {},
      categories: {},
      categoryOrder: [],
      personalCategories: [],
      orderMode: "custom",
    },
  });
  await adoption;
  assert.equal(lineup.useLineup.getState().playlistId, "one");
  assert.equal(lineup.useLineup.getState().orderMode, "custom");
  vi.doUnmock("../src/services/personalDisk");
});
