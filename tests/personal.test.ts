import assert from "node:assert/strict";
import { beforeEach, expect, test, vi } from "vitest";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

vi.mock("../src/services/personalDisk", () => ({
  readLineup: vi.fn().mockResolvedValue(null),
  writeLineup: vi.fn().mockResolvedValue(undefined),
  removeLineup: vi.fn().mockResolvedValue(undefined),
  clearLineups: vi.fn().mockResolvedValue(undefined),
}));

const m3uPlaylist = (id: string): Playlist => ({
  id,
  name: id,
  source: { kind: "m3u", url: `http://${id}.invalid/list.m3u` },
  sourceVersion: 1,
  hiddenCategories: [],
});

const xtreamPlaylist = (id: string): Playlist => ({
  id,
  name: id,
  source: {
    kind: "xtream",
    server: `http://${id}.invalid`,
    username: "viewer",
    password: "secret",
    output: "m3u8",
  },
  sourceVersion: 1,
  hiddenCategories: [],
});

const channel = (id: string, group = "News", playlistId?: string): Channel => ({
  id,
  name: `Channel ${id}`,
  logo: `http://images.invalid/${id}.png`,
  group,
  url: `http://streams.invalid/${id}.m3u8`,
  quality: "",
  number: 1,
  ...(playlistId
    ? {
        xtream: {
          playlistId,
          streamId: id.split(":").pop() ?? id,
          categoryKey: `live:${group.toLowerCase()}`,
          archiveDays: 0,
          directSource: "",
        },
      }
    : {}),
});

async function personal() {
  return import("../src/stores/personal");
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

test("ordinary legacy favourites and last channel adopt against the loaded playlist", async () => {
  localStorage.setItem("openiptv.favourites", '["alpha","missing"]');
  localStorage.setItem("openiptv.last", "alpha");
  const { usePersonal } = await personal();
  const playlist = m3uPlaylist("first");

  usePersonal.getState().adoptLegacyPersonal([playlist], playlist.id, [channel("alpha")]);

  assert.deepEqual(usePersonal.getState().favourites, [
    {
      itemKey: "alpha",
      playlistId: "first",
      kind: "live",
      providerId: "alpha",
      categoryKey: "News",
      name: "Channel alpha",
      logo: "http://images.invalid/alpha.png",
    },
  ]);
  assert.deepEqual(usePersonal.getState().lastPlayed, {
    playlistId: "first",
    kind: "live",
    itemKey: "alpha",
    categoryKey: "News",
  });
  assert.equal(localStorage.getItem("openiptv.favourites"), null);
  assert.equal(localStorage.getItem("openiptv.last"), null);
});

test("unscoped Xtream values map only when one Xtream playlist is configured", async () => {
  localStorage.setItem("openiptv.favourites", '["xtream:live:7"]');
  localStorage.setItem("openiptv.last", "xtream:live:7");
  const { usePersonal } = await personal();
  const playlist = xtreamPlaylist("only");
  const live = channel("xtream:only:live:7", "News", "only");

  usePersonal.getState().adoptLegacyPersonal([playlist], playlist.id, [live]);

  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.itemKey),
    [live.id],
  );
  assert.equal(usePersonal.getState().lastPlayed?.itemKey, live.id);
});

test("ambiguous and unresolved legacy values are dropped after every playlist loads", async () => {
  localStorage.setItem("openiptv.favourites", '["xtream:live:7","missing"]');
  localStorage.setItem("openiptv.last", "missing");
  const { usePersonal } = await personal();
  const first = xtreamPlaylist("first");
  const second = xtreamPlaylist("second");

  usePersonal
    .getState()
    .adoptLegacyPersonal([first, second], first.id, [
      channel("xtream:first:live:7", "News", first.id),
    ]);
  assert.notEqual(localStorage.getItem("openiptv.favourites"), null);
  assert.notEqual(localStorage.getItem("openiptv.last"), null);

  usePersonal
    .getState()
    .adoptLegacyPersonal([first, second], second.id, [
      channel("xtream:second:live:7", "News", second.id),
    ]);

  assert.deepEqual(usePersonal.getState().favourites, []);
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.equal(localStorage.getItem("openiptv.favourites"), null);
  assert.equal(localStorage.getItem("openiptv.last"), null);
});

test("a later legacy load cannot overwrite newer typed last played state", async () => {
  localStorage.setItem("openiptv.last", "stale");
  const { usePersonal } = await personal();
  const first = m3uPlaylist("first");
  const second = m3uPlaylist("second");

  usePersonal.getState().adoptLegacyPersonal([first, second], first.id, [channel("current")]);
  usePersonal.getState().rememberLast({
    playlistId: first.id,
    kind: "live",
    itemKey: "current",
    categoryKey: "News",
  });
  usePersonal.getState().adoptLegacyPersonal([first, second], second.id, [channel("stale")]);

  assert.deepEqual(usePersonal.getState().lastPlayed, {
    playlistId: first.id,
    kind: "live",
    itemKey: "current",
    categoryKey: "News",
  });
  assert.equal(localStorage.getItem("openiptv.last"), null);
});

test("favourite snapshots stay playlist scoped and support movies and series", async () => {
  const { usePersonal } = await personal();
  const first = {
    itemKey: "xtream:first:movie:1",
    playlistId: "first",
    kind: "movie" as const,
    providerId: "1",
    categoryKey: "movie:films",
    name: "Film",
    logo: "film.png",
    extension: "mp4",
  };
  const second = { ...first, itemKey: "xtream:second:movie:1", playlistId: "second" };
  const series = {
    itemKey: "xtream:first:series:2",
    playlistId: "first",
    kind: "series" as const,
    providerId: "2",
    categoryKey: "series:drama",
    name: "Drama",
    logo: "drama.png",
  };

  usePersonal.getState().toggleFavourite(first);
  usePersonal.getState().toggleFavourite(second);
  usePersonal.getState().toggleFavourite(series);

  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.itemKey),
    [first.itemKey, second.itemKey, series.itemKey],
  );
  assert.equal(
    JSON.stringify(usePersonal.getState().favourites).includes("http://streams"),
    false,
  );
});

test("loading favourites deduplicates by playlist and item identity", async () => {
  const shared = {
    itemKey: "m3u:0123456789abcdef",
    kind: "live",
    providerId: "m3u:0123456789abcdef",
    categoryKey: "News",
    name: "News",
    logo: "",
  };
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [
        { ...shared, playlistId: "first" },
        { ...shared, playlistId: "second" },
        { ...shared, playlistId: "first", name: "Duplicate" },
      ],
      lastPlayed: null,
      progress: [],
    }),
  );

  const { usePersonal } = await personal();

  expect(usePersonal.getState().favourites.map((item) => item.playlistId)).toEqual([
    "first",
    "second",
  ]);
});

test("the same M3U favourite stays isolated between playlists", async () => {
  const { usePersonal } = await personal();
  const first = {
    itemKey: "m3u:0123456789abcdef",
    playlistId: "first",
    kind: "live" as const,
    providerId: "m3u:0123456789abcdef",
    categoryKey: "News",
    name: "News",
    logo: "",
  };
  const second = { ...first, playlistId: "second" };

  usePersonal.getState().toggleFavourite(first);
  usePersonal.getState().toggleFavourite(second);
  expect(usePersonal.getState().favourites).toHaveLength(2);
  usePersonal.getState().toggleFavourite(second);
  expect(usePersonal.getState().favourites).toEqual([first]);
});

test("episodes cannot be added to favourites", async () => {
  const { usePersonal } = await personal();

  usePersonal.getState().toggleFavourite({
    itemKey: "xtream:first:episode:9",
    playlistId: "first",
    kind: "episode",
    providerId: "9",
    categoryKey: "series:2",
    name: "Episode",
    logo: "",
    extension: "mp4",
  } as never);

  assert.deepEqual(usePersonal.getState().favourites, []);
});

const movieSeed = (itemKey: string, playlistId = "pl-1") =>
  ({
    itemKey,
    playlistId,
    kind: "movie" as const,
    providerId: itemKey.split(":").pop() ?? itemKey,
    categoryKey: "movie:films",
    name: `Film ${itemKey}`,
    logo: "",
  }) as const;

const episodeSeed = (itemKey: string, playlistId = "pl-1") =>
  ({
    itemKey,
    playlistId,
    kind: "episode" as const,
    providerId: itemKey.split(":").pop() ?? itemKey,
    episodeIdentity: itemKey.split(":").pop() ?? itemKey,
    categoryKey: "series:drama",
    name: `Episode ${itemKey}`,
    logo: "",
    parentKey: `xtream:${playlistId}:series:9`,
    parentProviderId: "9",
    parentName: "Drama",
    season: 1,
    episode: 2,
  }) as const;

const catchupSeed = (itemKey: string, playlistId = "pl-1") =>
  ({
    itemKey,
    playlistId,
    kind: "catchup" as const,
    categoryKey: "live:news",
    name: `Programme ${itemKey}`,
    logo: "",
  }) as const;

const seedProgress = (entries: unknown[]) =>
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({ favourites: [], lastPlayed: null, progress: entries }),
  );

const savedPersonal = () =>
  JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}") as Record<string, unknown>;

async function loadPersonalAt(now: number) {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    vi.resetModules();
    const { usePersonal } = await personal();
    return usePersonal;
  } finally {
    vi.useRealTimers();
  }
}

test("old compact progress becomes ordered legacy progress with one stable base time", async () => {
  seedProgress([
    { itemKey: "oldest", seconds: 20 },
    { itemKey: "newest", seconds: 40 },
  ]);
  const usePersonal = await loadPersonalAt(1_000_000);

  expect(usePersonal.getState().progress).toEqual([
    { itemKey: "oldest", seconds: 20, legacyOrder: 0 },
    { itemKey: "newest", seconds: 40, legacyOrder: 1 },
  ]);
  expect(savedPersonal().progressMigrationBaseTime).toBe(1_000_000);
});

test("resolved legacy entries are dated backwards from the base time in their saved order", async () => {
  seedProgress([
    { itemKey: "xtream:pl-1:movie:1", seconds: 20 },
    { itemKey: "xtream:pl-1:movie:2", seconds: 40 },
  ]);
  const usePersonal = await loadPersonalAt(1_000_000);

  // Activity saved after the migration must always be newer than anything legacy.
  usePersonal
    .getState()
    .rememberProgress(movieSeed("xtream:pl-1:movie:3"), 15, 100, "tick", 2_000_000);

  usePersonal
    .getState()
    .resolveLegacyProgress([
      movieSeed("xtream:pl-1:movie:1"),
      movieSeed("xtream:pl-1:movie:2"),
    ]);

  const first = usePersonal.getState().progressFor("xtream:pl-1:movie:1");
  const second = usePersonal.getState().progressFor("xtream:pl-1:movie:2");
  expect(first).toMatchObject({
    kind: "movie",
    playlistId: "pl-1",
    seconds: 20,
    updatedAt: 1_000_000 - 2 * 1000,
  });
  expect(second).toMatchObject({ seconds: 40, updatedAt: 1_000_000 - 1000 });
  const activity = usePersonal.getState().progressFor("xtream:pl-1:movie:3");
  expect("updatedAt" in (activity ?? {}) && (activity as { updatedAt: number }).updatedAt).toBe(
    2_000_000,
  );
  expect(
    (first as { updatedAt: number }).updatedAt < (activity as { updatedAt: number }).updatedAt,
  ).toBe(true);
  // The last legacy record resolved, so the base time goes with it.
  expect(usePersonal.getState().progressMigrationBaseTime).toBeUndefined();
});

test("an interrupted migration keeps the base time rather than picking a new one", async () => {
  seedProgress([{ itemKey: "xtream:pl-1:movie:1", seconds: 20 }]);
  const first = await loadPersonalAt(1_000_000);
  expect(first.getState().progressMigrationBaseTime).toBe(1_000_000);

  const second = await loadPersonalAt(5_000_000);
  expect(second.getState().progressMigrationBaseTime).toBe(1_000_000);
});

test("malformed progress entries are dropped, resolved and legacy records coexist", async () => {
  seedProgress([
    null,
    { itemKey: 42, seconds: 10 },
    { itemKey: "bad", seconds: "many" },
    { itemKey: "xtream:pl-1:movie:old", seconds: 30 },
    {
      itemKey: "xtream:pl-1:movie:new",
      playlistId: "pl-1",
      kind: "movie",
      providerId: "77",
      categoryKey: "movie:films",
      name: "New Film",
      logo: "",
      seconds: 50,
      updatedAt: 9_999,
    },
  ]);
  const usePersonal = await loadPersonalAt(1_000_000);

  expect(usePersonal.getState().progress).toEqual([
    { itemKey: "xtream:pl-1:movie:old", seconds: 30, legacyOrder: 3 },
    expect.objectContaining({
      itemKey: "xtream:pl-1:movie:new",
      kind: "movie",
      seconds: 50,
      updatedAt: 9_999,
    }),
  ]);
});

test("a duplicated key keeps the later record and its own order", async () => {
  seedProgress([
    { itemKey: "xtream:pl-1:movie:1", seconds: 10 },
    { itemKey: "xtream:pl-1:movie:2", seconds: 20 },
    { itemKey: "xtream:pl-1:movie:1", seconds: 60 },
  ]);
  const usePersonal = await loadPersonalAt(1_000_000);

  expect(usePersonal.getState().progress).toEqual([
    { itemKey: "xtream:pl-1:movie:2", seconds: 20, legacyOrder: 1 },
    { itemKey: "xtream:pl-1:movie:1", seconds: 60, legacyOrder: 2 },
  ]);
});

test("progress persists after fifteen seconds and keeps only the newest one hundred items", async () => {
  const { usePersonal } = await personal();

  usePersonal.getState().rememberProgress(movieSeed("xtream:pl-1:movie:quiet"), 14, 100);
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:movie:quiet"), undefined);

  usePersonal.getState().rememberProgress(movieSeed("xtream:pl-1:movie:quiet"), 15, 100);
  expect(usePersonal.getState().progressFor("xtream:pl-1:movie:quiet")).toEqual({
    ...movieSeed("xtream:pl-1:movie:quiet"),
    seconds: 15,
    duration: 100,
    updatedAt: expect.any(Number),
  });

  for (let index = 0; index < 101; index += 1) {
    usePersonal.getState().rememberProgress(movieSeed(`xtream:pl-1:movie:${index}`), 15, 120);
  }

  assert.equal(usePersonal.getState().progress.length, 100);
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:movie:quiet"), undefined);
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:movie:0"), undefined);
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:movie:100")?.seconds, 15);
});

test("progress ignores advancement below the threshold and completion removes it", async () => {
  const { usePersonal } = await personal();
  const seed = movieSeed("xtream:pl-1:movie:1");

  usePersonal.getState().rememberProgress(seed, 15, 100);
  usePersonal.getState().rememberProgress(seed, 29, 100);
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 15);
  usePersonal.getState().rememberProgress(seed, 30, 100);
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 30);
  usePersonal.getState().rememberProgress(seed, 36, 100, "pause");
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 36);

  usePersonal.getState().completeProgress(seed.itemKey);
  assert.equal(usePersonal.getState().progressFor(seed.itemKey), undefined);
});

test("a restart from zero keeps prior progress until it passes the saved point", async () => {
  const { usePersonal } = await personal();
  const seed = movieSeed("xtream:pl-1:movie:9");
  usePersonal.getState().rememberProgress(seed, 100, 200, "pause");

  usePersonal.getState().beginProgressSession(seed.itemKey, 0);
  usePersonal.getState().rememberProgress(seed, 10, 200, "tick");
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 100);

  usePersonal.getState().rememberProgress(seed, 16, 200, "tick");
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 100);
  usePersonal.getState().rememberProgress(seed, 101, 200, "tick");
  assert.equal(usePersonal.getState().progressFor(seed.itemKey)?.seconds, 101);
});

test("a movie without a provider id and an idless episode never persist", async () => {
  const { usePersonal } = await personal();

  usePersonal
    .getState()
    .rememberProgress(
      { ...movieSeed("xtream:pl-1:movie:4"), providerId: undefined },
      30,
      100,
      "pause",
    );
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:movie:4"), undefined);

  usePersonal
    .getState()
    .rememberProgress(
      { ...episodeSeed("xtream:pl-1:episode:5"), episodeIdentity: undefined },
      30,
      100,
      "pause",
    );
  assert.equal(usePersonal.getState().progressFor("xtream:pl-1:episode:5"), undefined);
});

test("a movie with a direct source fingerprint and no provider id persists", async () => {
  const { usePersonal } = await personal();
  const seed = {
    ...movieSeed("xtream:pl-1:movie:direct"),
    providerId: undefined,
    directSourceFingerprint: "movie123",
  };

  usePersonal.getState().rememberProgress(seed, 30, 100, "pause");

  expect(usePersonal.getState().progressFor(seed.itemKey)).toMatchObject({
    kind: "movie",
    directSourceFingerprint: "movie123",
    seconds: 30,
  });
});

test("an episode with a direct source fingerprint and no provider id persists", async () => {
  const { usePersonal } = await personal();
  const seed = {
    ...episodeSeed("xtream:pl-1:episode:6"),
    providerId: undefined,
    directSourceFingerprint: "abc123",
  };

  usePersonal.getState().rememberProgress(seed, 30, 100, "pause");

  expect(usePersonal.getState().progressFor("xtream:pl-1:episode:6")).toMatchObject({
    kind: "episode",
    directSourceFingerprint: "abc123",
    parentName: "Drama",
    season: 1,
    episode: 2,
  });
});

test("catchup progress persists with its programme identity and stays out of the catalogue", async () => {
  const { usePersonal } = await personal();
  const seed = catchupSeed("xtream:pl-1:catchup:7:55");

  usePersonal.getState().rememberProgress(seed, 30, 100, "pause");

  expect(usePersonal.getState().progressFor("xtream:pl-1:catchup:7:55")).toMatchObject({
    kind: "catchup",
    categoryKey: "live:news",
    seconds: 30,
  });
});

test("an authoritative movie index resolves what it has and removes what it disproves", async () => {
  seedProgress([
    { itemKey: "xtream:pl-1:movie:kept", seconds: 20 },
    { itemKey: "xtream:pl-1:movie:gone", seconds: 30 },
    { itemKey: "xtream:pl-1:episode:9", seconds: 40 },
  ]);
  const usePersonal = await loadPersonalAt(1_000_000);

  usePersonal.getState().resolveLegacyProgress([movieSeed("xtream:pl-1:movie:kept")]);
  usePersonal
    .getState()
    .removeAbsentLegacyProgress("pl-1", "movie", new Set(["xtream:pl-1:movie:kept"]));

  const kept = usePersonal.getState().progressFor("xtream:pl-1:movie:kept");
  expect(kept).toMatchObject({ kind: "movie", seconds: 20 });
  expect(usePersonal.getState().progressFor("xtream:pl-1:movie:gone")).toBeUndefined();
  // A movie index says nothing about episodes, so the episode record survives.
  expect(usePersonal.getState().progressFor("xtream:pl-1:episode:9")).toEqual({
    itemKey: "xtream:pl-1:episode:9",
    seconds: 40,
    legacyOrder: 2,
  });
});

test("resolution without the needed seed fields leaves the legacy record in place", async () => {
  seedProgress([{ itemKey: "xtream:pl-1:movie:1", seconds: 20 }]);
  const usePersonal = await loadPersonalAt(1_000_000);

  usePersonal
    .getState()
    .resolveLegacyProgress([{ ...movieSeed("xtream:pl-1:movie:1"), providerId: undefined }]);

  expect(usePersonal.getState().progressFor("xtream:pl-1:movie:1")).toEqual({
    itemKey: "xtream:pl-1:movie:1",
    seconds: 20,
    legacyOrder: 0,
  });
  expect(usePersonal.getState().progressMigrationBaseTime).toBe(1_000_000);
});

test("removes only the deleted playlist personal state", async () => {
  const { usePersonal } = await personal();
  usePersonal.getState().toggleFavourite({
    itemKey: "xtream:first:live:1",
    playlistId: "first",
    kind: "live",
    providerId: "1",
    categoryKey: "live:news",
    name: "First",
    logo: "",
  });
  usePersonal.getState().toggleFavourite({
    itemKey: "xtream:second:series:2",
    playlistId: "second",
    kind: "series",
    providerId: "2",
    categoryKey: "series:drama",
    name: "Second",
    logo: "",
  });
  usePersonal.getState().rememberLast({
    playlistId: "first",
    kind: "live",
    itemKey: "xtream:first:live:1",
    categoryKey: "live:news",
  });
  usePersonal.getState().rememberProgress(movieSeed("xtream:first:movie:3", "first"), 15, 100);
  usePersonal
    .getState()
    .rememberProgress(movieSeed("xtream:second:movie:4", "second"), 15, 100);

  usePersonal.getState().clearPlaylistPersonal("first");

  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.playlistId),
    ["second"],
  );
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.equal(usePersonal.getState().progressFor("xtream:first:movie:3"), undefined);
  assert.equal(usePersonal.getState().progressFor("xtream:second:movie:4")?.seconds, 15);
});

test("clears server username and source kind replacements", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      playlists: [xtreamPlaylist("first"), xtreamPlaylist("second")],
      activePlaylistId: "first",
    }),
  );
  const { usePersonal } = await personal();
  const { useSettings } = await import("../src/stores/settings");
  for (const playlistId of ["first", "second"]) {
    usePersonal.getState().toggleFavourite({
      itemKey: `xtream:${playlistId}:live:1`,
      playlistId,
      kind: "live",
      providerId: "1",
      categoryKey: "live:news",
      name: playlistId,
      logo: "",
    });
  }
  const saved = useSettings.getState().playlists[0];

  await useSettings.getState().updatePlaylist(saved.id, saved.name, {
    ...saved.source,
    kind: "xtream",
    server: "http://replacement.invalid",
  });

  assert.equal(useSettings.getState().playlists[0].sourceVersion, 2);
  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.playlistId),
    ["second"],
  );
});

test("changing source kind clears personal state after each version increment", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      playlists: [m3uPlaylist("first"), xtreamPlaylist("second")],
      activePlaylistId: "first",
    }),
  );
  const { usePersonal } = await personal();
  const { useSettings } = await import("../src/stores/settings");
  for (const playlistId of ["first", "second"]) {
    usePersonal.getState().toggleFavourite({
      itemKey: `xtream:${playlistId}:live:1`,
      playlistId,
      kind: "live",
      providerId: "1",
      categoryKey: "live:news",
      name: playlistId,
      logo: "",
    });
    usePersonal
      .getState()
      .rememberProgress(movieSeed(`xtream:${playlistId}:movie:2`, playlistId), 15, 100);
  }
  usePersonal.getState().rememberLast({
    playlistId: "first",
    kind: "live",
    itemKey: "first-live",
    categoryKey: "News",
  });

  const first = useSettings.getState().playlists[0];
  await useSettings
    .getState()
    .updatePlaylist(first.id, first.name, xtreamPlaylist("first").source);

  assert.equal(useSettings.getState().playlists[0].sourceVersion, 2);
  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.playlistId),
    ["second"],
  );
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.equal(usePersonal.getState().progressFor("xtream:first:movie:2"), undefined);
  assert.equal(usePersonal.getState().progressFor("xtream:second:movie:2")?.seconds, 15);

  usePersonal.getState().rememberLast({
    playlistId: "second",
    kind: "live",
    itemKey: "xtream:second:live:1",
    categoryKey: "live:news",
  });
  const second = useSettings.getState().playlists[1];
  await useSettings
    .getState()
    .updatePlaylist(second.id, second.name, m3uPlaylist("second").source);

  assert.equal(useSettings.getState().playlists[1].sourceVersion, 2);
  assert.deepEqual(usePersonal.getState().favourites, []);
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.deepEqual(usePersonal.getState().progress, []);
});

test("preserves password output and M3U address refreshes", async () => {
  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({ playlists: [xtreamPlaylist("first")], activePlaylistId: "first" }),
  );
  const { usePersonal } = await personal();
  const { useSettings } = await import("../src/stores/settings");
  usePersonal.getState().toggleFavourite({
    itemKey: "xtream:first:live:1",
    playlistId: "first",
    kind: "live",
    providerId: "1",
    categoryKey: "live:news",
    name: "First",
    logo: "",
  });
  const saved = useSettings.getState().playlists[0];
  assert.equal(saved.source.kind, "xtream");
  if (saved.source.kind !== "xtream") return;

  await useSettings.getState().updatePlaylist(saved.id, saved.name, {
    ...saved.source,
    password: "new secret",
    output: "ts",
  });

  assert.equal(useSettings.getState().playlists[0].sourceVersion, 2);
  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.playlistId),
    ["first"],
  );
});

test("clears every personal store on reset", async () => {
  const { usePersonal } = await personal();
  usePersonal.getState().toggleFavourite({
    itemKey: "alpha",
    playlistId: "first",
    kind: "live",
    providerId: "alpha",
    categoryKey: "News",
    name: "Alpha",
    logo: "",
  });
  usePersonal.getState().rememberLast({
    playlistId: "first",
    kind: "live",
    itemKey: "alpha",
    categoryKey: "News",
  });
  usePersonal.getState().rememberProgress(movieSeed("xtream:first:movie:1", "first"), 15, 100);
  const { useSettings } = await import("../src/stores/settings");

  await useSettings.getState().reset();

  assert.deepEqual(usePersonal.getState().favourites, []);
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.deepEqual(usePersonal.getState().progress, []);
  assert.equal(localStorage.getItem("openiptv.personal"), null);
});
