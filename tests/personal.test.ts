import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vitest";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

const m3uPlaylist = (id: string): Playlist => ({
  id,
  name: id,
  source: { kind: "m3u", url: `http://${id}.invalid/list.m3u` },
  sourceVersion: 1,
  hiddenCategories: [],
  hiddenCategoryMode: "exclude",
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
  hiddenCategoryMode: "exclude",
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

test("progress persists after fifteen seconds and keeps only the newest one hundred items", async () => {
  const { usePersonal } = await personal();

  usePersonal.getState().rememberProgress("movie:quiet", 14, 100);
  assert.equal(usePersonal.getState().progressFor("movie:quiet"), undefined);
  assert.equal(localStorage.getItem("openiptv.personal"), null);

  usePersonal.getState().rememberProgress("movie:quiet", 15, 100);
  assert.deepEqual(usePersonal.getState().progressFor("movie:quiet"), {
    itemKey: "movie:quiet",
    seconds: 15,
    duration: 100,
  });

  for (let index = 0; index < 101; index += 1) {
    usePersonal.getState().rememberProgress(`movie:${index}`, 15, 120);
  }

  assert.equal(usePersonal.getState().progress.length, 100);
  assert.equal(usePersonal.getState().progressFor("movie:quiet"), undefined);
  assert.equal(usePersonal.getState().progressFor("movie:0"), undefined);
  assert.equal(usePersonal.getState().progressFor("movie:100")?.seconds, 15);
});

test("progress ignores advancement below the threshold and completion removes it", async () => {
  const { usePersonal } = await personal();

  usePersonal.getState().rememberProgress("movie:1", 15, 100);
  usePersonal.getState().rememberProgress("movie:1", 29, 100);
  assert.equal(usePersonal.getState().progressFor("movie:1")?.seconds, 15);
  usePersonal.getState().rememberProgress("movie:1", 30, 100);
  assert.equal(usePersonal.getState().progressFor("movie:1")?.seconds, 30);
  usePersonal.getState().rememberProgress("movie:1", 36, 100, true);
  assert.equal(usePersonal.getState().progressFor("movie:1")?.seconds, 36);

  usePersonal.getState().completeProgress("movie:1");
  assert.equal(usePersonal.getState().progressFor("movie:1"), undefined);
});

test("clearing one playlist leaves another playlist unchanged", async () => {
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
  usePersonal.getState().rememberProgress("xtream:first:movie:3", 15, 100);
  usePersonal.getState().rememberProgress("xtream:second:movie:4", 15, 100);

  usePersonal.getState().clearPlaylistPersonal("first");

  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.playlistId),
    ["second"],
  );
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.equal(usePersonal.getState().progressFor("xtream:first:movie:3"), undefined);
  assert.equal(usePersonal.getState().progressFor("xtream:second:movie:4")?.seconds, 15);
});

test("server or username replacement clears only that playlist after the version increments", async () => {
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

  useSettings.getState().updatePlaylist(saved.id, saved.name, {
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
    usePersonal.getState().rememberProgress(`xtream:${playlistId}:movie:2`, 15, 100);
  }
  usePersonal.getState().rememberLast({
    playlistId: "first",
    kind: "live",
    itemKey: "first-live",
    categoryKey: "News",
  });

  const first = useSettings.getState().playlists[0];
  useSettings.getState().updatePlaylist(first.id, first.name, xtreamPlaylist("first").source);

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
  useSettings.getState().updatePlaylist(second.id, second.name, m3uPlaylist("second").source);

  assert.equal(useSettings.getState().playlists[1].sourceVersion, 2);
  assert.deepEqual(usePersonal.getState().favourites, []);
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.deepEqual(usePersonal.getState().progress, []);
});

test("password and output changes preserve personal state", async () => {
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

  useSettings.getState().updatePlaylist(saved.id, saved.name, {
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

test("full reset clears favourites, last played and progress", async () => {
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
  usePersonal.getState().rememberProgress("movie:1", 15, 100);
  const { useSettings } = await import("../src/stores/settings");

  useSettings.getState().reset();

  assert.deepEqual(usePersonal.getState().favourites, []);
  assert.equal(usePersonal.getState().lastPlayed, null);
  assert.deepEqual(usePersonal.getState().progress, []);
  assert.equal(localStorage.getItem("openiptv.personal"), null);
});
