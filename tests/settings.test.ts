import { beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";

/**
 * The settings store, which is the only thing in the app that survives being switched off.
 *
 * What is worth pinning down is not that a toggle toggles, it is the three places where
 * getting it wrong loses somebody's configuration: the merge that lets an older saved file
 * keep working, the stripping that decides what is written, and what becomes active when the
 * active playlist is removed.
 */

const personalDisk = vi.hoisted(() => ({
  lineups: new Map<string, unknown>(),
  remove: vi.fn<(playlistId: string) => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
}));

vi.mock("../src/services/personalDisk", () => ({
  readLineup: vi.fn().mockResolvedValue(null),
  writeLineup: vi.fn().mockResolvedValue(undefined),
  removeLineup: personalDisk.remove,
  clearLineups: personalDisk.clear,
  writeLineupIfAbsent: vi.fn().mockResolvedValue(true),
}));

const KEY = "openiptv.settings";
const m3u = (url: string) => ({ kind: "m3u" as const, url });
const xtreamPlaylist = {
  id: "pl-x",
  name: "Provider",
  source: {
    kind: "xtream" as const,
    server: "https://provider.example",
    username: "viewer",
    password: "secret",
    output: "m3u8" as const,
  },
  sourceVersion: 1,
};

const load = () => {
  vi.resetModules();
  return import("../src/stores/settings");
};

beforeEach(() => {
  localStorage.clear();
  personalDisk.lineups.clear();
  personalDisk.remove.mockReset().mockImplementation(async (playlistId) => {
    personalDisk.lineups.delete(playlistId);
  });
  personalDisk.clear.mockReset().mockResolvedValue();
});

test("a file written by an older version keeps working, and gains the new defaults", async () => {
  // No aspectId, no panelTimeout: a release before either existed.
  localStorage.setItem(KEY, JSON.stringify({ showClock: false, resumeLast: false }));
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.showClock, false, "what was saved is kept");
  assert.equal(s.resumeLast, false);
  assert.equal(s.aspectId, "fit", "new preferences preserve the whole picture");
  assert.equal(s.continuousReconnect, false, "continuous reconnect stays opt in");
  assert.equal(s.showPlaybackStats, false, "the restored setting arrives at its default");
  assert.equal(s.hideEmptyCategories, true, "empty categories stay hidden by default");
  assert.equal(s.playlistShortcut, true, "playlist switching is available by default");
  assert.equal(s.showLive, true, "every section starts on");
  assert.equal(s.showMovies, true);
  assert.equal(s.showSeries, true);
  assert.equal("panelTimeout" in s, false, "the removed setting does not return");
});

test("appearance preferences hydrate booleans and keep saved values", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [xtreamPlaylist],
      activePlaylistId: "pl-x",
      hideEmptyCategories: "yes",
      playlistShortcut: "yes",
      showLive: "no",
      showMovies: false,
      showSeries: 0,
    }),
  );
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.hideEmptyCategories, true, "malformed falls back to the default");
  assert.equal(s.playlistShortcut, true, "malformed falls back to the default");
  assert.equal(s.showLive, true, "malformed falls back to the default");
  assert.equal(s.showMovies, false, "a saved false survives");
  assert.equal(s.showSeries, true, "malformed falls back to the default");
  const written = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(written.hideEmptyCategories, true);
  assert.equal(written.playlistShortcut, true);
  assert.equal(written.showLive, true);
  assert.equal(written.showMovies, false);
  assert.equal(written.showSeries, true);
});

test("the playlist shortcut remains disabled after settings are reloaded", async () => {
  const first = await load();
  first.useSettings.getState().set("playlistShortcut", false);
  const second = await load();
  assert.equal(second.useSettings.getState().playlistShortcut, false);
});

test("a saved state with every section disabled normalizes to one supported section before persisting", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [xtreamPlaylist],
      activePlaylistId: "pl-x",
      showLive: false,
      showMovies: false,
      showSeries: false,
    }),
  );
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.showLive, true, "at least one supported section must stay on");
  assert.equal(s.showMovies, false);
  assert.equal(s.showSeries, false);
  const written = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(written.showLive, true);
  assert.equal(written.showMovies, false);
  assert.equal(written.showSeries, false);
});

test("an M3U state with Live disabled normalizes Live back on", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [{ id: "pl-m", name: "M3U", url: "http://a.invalid/x.m3u" }],
      activePlaylistId: "pl-m",
      showLive: false,
      showMovies: true,
      showSeries: true,
    }),
  );
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.showLive, true, "M3U only supports Live, so it cannot stay off");
  assert.equal(s.showMovies, true, "the stored movie preference is preserved");
  assert.equal(s.showSeries, true);
  const written = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(written.showLive, true);
  assert.equal(written.showMovies, true);
});

test("the last supported section cannot be switched off, and Live returns with an M3U source", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({ playlists: [xtreamPlaylist], activePlaylistId: "pl-x" }),
  );
  const { useSettings } = await load();
  const s = () => useSettings.getState();

  s().set("showLive", false);
  s().set("showSeries", false);
  assert.deepEqual([s().showLive, s().showMovies, s().showSeries], [false, true, false]);

  s().set("showMovies", false);
  assert.equal(s().showMovies, true, "the final supported section stays on");
  assert.equal(JSON.parse(localStorage.getItem(KEY) as string).showMovies, true);

  s().replacePlaylists(
    [{ id: "pl-m", name: "M3U", source: m3u("http://a.invalid/x.m3u"), sourceVersion: 1 }],
    "pl-m",
  );
  assert.equal(s().showLive, true, "Live returns when the source can no longer hide it");
  assert.equal(s().showMovies, true, "the movie preference itself is preserved");
  const written = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(written.showLive, true);
  assert.equal(written.showMovies, true);
  assert.equal(written.playlists[0].source.kind, "m3u");
});

test("keeps legacy order until every playlist record commits in settings", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      sortAlphabetically: true,
      playlists: [
        { id: "one", name: "One", url: "http://one.invalid/list.m3u" },
        { id: "two", name: "Two", url: "http://two.invalid/list.m3u" },
      ],
      activePlaylistId: "one",
    }),
  );
  const { completeOrderModeMigration, useSettings } = await load();
  completeOrderModeMigration("one");
  useSettings.getState().set("showClock", false);
  assert.equal(JSON.parse(localStorage.getItem(KEY) ?? "{}").sortAlphabetically, true);
  completeOrderModeMigration("one");
  assert.equal(JSON.parse(localStorage.getItem(KEY) ?? "{}").sortAlphabetically, true);
  completeOrderModeMigration("two");
  assert.equal("sortAlphabetically" in JSON.parse(localStorage.getItem(KEY) ?? "{}"), false);
});

test("full reset clears pending legacy order migration state", async () => {
  localStorage.setItem(KEY, JSON.stringify({ sortAlphabetically: true, playlists: [] }));
  const { legacyLineupOrderMode, useSettings } = await load();
  assert.equal(legacyLineupOrderMode(), "alphabetical");
  assert.equal(await useSettings.getState().reset(), true);
  assert.equal(legacyLineupOrderMode(), null);
  useSettings.getState().addPlaylist("Fresh", m3u("http://fresh.invalid/list.m3u"));
  assert.equal("sortAlphabetically" in JSON.parse(localStorage.getItem(KEY) ?? "{}"), false);
});

test("continuous reconnect is false for new, old, malformed, and partial settings", async () => {
  for (const saved of [{}, { showClock: false }, { continuousReconnect: "yes" }]) {
    localStorage.setItem(KEY, JSON.stringify(saved));
    const { useSettings } = await load();
    assert.equal(useSettings.getState().continuousReconnect, false);
  }

  localStorage.setItem(KEY, JSON.stringify({ continuousReconnect: true }));
  const { useSettings } = await load();
  assert.equal(useSettings.getState().continuousReconnect, true);
});

test("the restored playback information setting survives the canonical write", async () => {
  localStorage.setItem(KEY, JSON.stringify({ showPlaybackStats: true, showClock: false }));
  const { useSettings } = await load();

  assert.equal(useSettings.getState().showPlaybackStats, true);
  const written = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  assert.equal(written.showPlaybackStats, true);
});

test("a setting that no longer exists is dropped rather than carried for ever", async () => {
  /*
   * `fontId` was real until the type face setting was removed, and it did nothing on a television
   * even while it existed. An install that had chosen one would otherwise keep the key in its
   * settings file indefinitely, written back on every change, meaning nothing.
   */
  localStorage.setItem(KEY, JSON.stringify({ fontId: "serif", showClock: false }));
  const { useSettings } = await load();

  assert.equal("fontId" in useSettings.getState(), false, "a dead setting came back to life");
  assert.equal(
    useSettings.getState().showClock,
    false,
    "the rest of the file was thrown away with it",
  );

  useSettings.getState().set("showClock", true);
  const written = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  assert.equal("fontId" in written, false, "it was written back out again");
});

test("a removed setting is ignored rather than persisted", async () => {
  localStorage.setItem(KEY, JSON.stringify({ panelTimeout: 30, showClock: false }));
  const { useSettings } = await load();

  assert.equal("panelTimeout" in useSettings.getState(), false);
  assert.equal(useSettings.getState().showClock, false);
  const writtenOnLoad = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  assert.equal("panelTimeout" in writtenOnLoad, false);

  useSettings.getState().set("showClock", true);
  const written = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  assert.equal("panelTimeout" in written, false);
});

test("nonsense in the store falls back to defaults rather than throwing", async () => {
  localStorage.setItem(KEY, "{not json");
  const { useSettings } = await load();
  assert.equal(useSettings.getState().showClock, true);
});

test("a primitive saved value falls back to defaults rather than throwing", async () => {
  localStorage.setItem(KEY, "null");
  const { useSettings } = await load();
  assert.equal(useSettings.getState().showClock, true);
});

test("malformed playlist visibility falls back without breaking settings", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [
        null,
        {
          id: "pl-1",
          name: "One",
          url: "http://a.invalid/x.m3u",
          hiddenCategories: ["News", 4],
        },
      ],
      activePlaylistId: "pl-1",
    }),
  );

  const { useSettings } = await load();
  assert.equal(useSettings.getState().playlists.length, 1);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
});

test("what is written back is data, never the actions", async () => {
  const { useSettings } = await load();
  useSettings.getState().set("showClock", false);

  const saved = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(saved.showClock, false);
  for (const action of [
    "set",
    "addPlaylist",
    "removePlaylist",
    "updatePlaylist",
    "reset",
    "font",
    "scale",
    "activePlaylist",
  ]) {
    assert.ok(!(action in saved), `${action} was persisted`);
  }
});

test("the first playlist added becomes the active one", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  const s = useSettings.getState();
  assert.equal(s.playlists.length, 1);
  assert.equal(s.activePlaylistId, s.playlists[0].id);
});

test("adding a second playlist does not steal the active one", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  const first = useSettings.getState().activePlaylistId;
  useSettings.getState().addPlaylist("Second", m3u("http://b.invalid/y.m3u"));
  assert.equal(useSettings.getState().activePlaylistId, first);
});

test("new and existing playlists gain private category visibility defaults", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [{ id: "pl-old", name: "Old", url: "http://old.invalid/list.m3u" }],
      activePlaylistId: "pl-old",
    }),
  );
  const { useSettings } = await load();

  assert.equal(useSettings.getState().playlists[0].hiddenCategories, undefined);

  useSettings.getState().addPlaylist("New", m3u("http://new.invalid/list.m3u"));
  assert.equal(useSettings.getState().playlists[1].hiddenCategories, undefined);
});

test("keeps hidden categories until their playlist record commits in settings", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [
        {
          id: "first",
          name: "First",
          url: "http://a.invalid/x.m3u",
          hiddenCategories: ["News", "Sport"],
        },
      ],
      activePlaylistId: "first",
    }),
  );
  const { completeHiddenCategoryMigration, useSettings } = await load();
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News", "Sport"]);
  completeHiddenCategoryMigration("first");
  assert.equal(useSettings.getState().playlists[0].hiddenCategories, undefined);
});

test("removing the active playlist promotes another rather than leaving nothing active", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  s().addPlaylist("Second", m3u("http://b.invalid/y.m3u"));
  const [first, second] = s().playlists;

  await s().removePlaylist(first.id);
  assert.equal(s().activePlaylistId, second.id);
});

test("removing the last playlist leaves the app in its first run state", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("Only", m3u("http://a.invalid/x.m3u"));
  await s().removePlaylist(s().playlists[0].id);
  assert.equal(s().playlists.length, 0);
  assert.equal(s().activePlaylistId, "");
  assert.equal(s().activePlaylist(), undefined);
});

test("a new install follows the system language by default", async () => {
  const { useSettings } = await load();
  assert.equal(useSettings.getState().locale, "system");
});

test("an unsupported saved language falls back to the system option", async () => {
  localStorage.setItem(KEY, JSON.stringify({ locale: "sv" }));
  const { useSettings } = await load();
  assert.equal(useSettings.getState().locale, "system");
});

test("a playlist whose name is blank is still saved with its url trimmed", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("  Spaced  ", m3u("http://a.invalid/x.m3u"));
  const p = useSettings.getState().playlists[0];
  assert.equal(p.name, "Spaced");
  assert.deepEqual(p.source, m3u("http://a.invalid/x.m3u"));
  assert.equal(p.sourceVersion, 1);
});

test("failed durable cleanup leaves playlist settings and compact personal state intact", async () => {
  const { useSettings } = await load();
  const { usePersonal } = await import("../src/stores/personal");
  useSettings.getState().addPlaylist("One", m3u("http://a.invalid/x.m3u"));
  const original = useSettings.getState().playlists[0];
  usePersonal.getState().toggleFavourite({
    itemKey: "alpha",
    playlistId: original.id,
    kind: "live",
    providerId: "alpha",
    categoryKey: "News",
    name: "Alpha",
    logo: "",
  });
  const compactBefore = localStorage.getItem("openiptv.personal");
  const lineupRecord = { version: 1, revision: 3, personalisation: { orderMode: "custom" } };
  personalDisk.lineups.set(original.id, lineupRecord);
  personalDisk.remove.mockRejectedValueOnce(new Error("blocked"));
  assert.equal(await useSettings.getState().removePlaylist(original.id), false);
  assert.equal(useSettings.getState().playlists[0].id, original.id);
  assert.equal(localStorage.getItem("openiptv.personal"), compactBefore);
  assert.equal(personalDisk.lineups.get(original.id), lineupRecord);
  assert.deepEqual(
    usePersonal.getState().favourites.map((item) => item.itemKey),
    ["alpha"],
  );
});

test("reset clears the playlists and writes the cleared state out", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("One", m3u("http://a.invalid/x.m3u"));
  await useSettings.getState().reset();

  assert.equal(useSettings.getState().playlists.length, 0);
  assert.equal(JSON.parse(localStorage.getItem(KEY) as string).playlists.length, 0);
});

test("a store that refuses to save does not take the app down with it", async () => {
  const { useSettings } = await load();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  // A setting that did not save is a smaller problem than a channel that stopped playing
  // to say so, which is the whole reason services/store swallows this.
  assert.doesNotThrow(() => useSettings.getState().set("showClock", false));
  expect(useSettings.getState().showClock).toBe(false);
});

test("the active playlist falls back to the first when the saved id is stale", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [{ id: "pl-1", name: "One", url: "http://a.invalid/x.m3u" }],
      activePlaylistId: "pl-gone",
    }),
  );
  const { useSettings } = await load();
  assert.equal(useSettings.getState().activePlaylist()?.id, "pl-1");
});

test("two playlists added in the same millisecond still get an id each", async () => {
  const { useSettings } = await load();
  // Not a race that has to be provoked: any code adding two in a row hits the same
  // millisecond, and identical ids meant removing one removed both.
  useSettings.getState().addPlaylist("One", m3u("http://a.invalid/x.m3u"));
  useSettings.getState().addPlaylist("Two", m3u("http://b.invalid/y.m3u"));
  const ids = useSettings.getState().playlists.map((p) => p.id);
  assert.equal(new Set(ids).size, 2);
});

test("removing one of two playlists added together leaves exactly the other", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("One", m3u("http://a.invalid/x.m3u"));
  s().addPlaylist("Two", m3u("http://b.invalid/y.m3u"));
  await s().removePlaylist(s().playlists[0].id);
  assert.equal(s().playlists.length, 1);
  assert.equal(s().playlists[0].name, "Two");
});

test("replacing playlists persists one complete first setup state", async () => {
  const { useSettings } = await load();
  const playlist = {
    id: "pl-phone",
    name: "News",
    source: m3u("http://a.invalid/news.m3u"),
    sourceVersion: 1,
    hiddenCategories: [],
  };

  useSettings.getState().replacePlaylists([playlist], playlist.id, "fr");

  assert.deepEqual(useSettings.getState().playlists, [playlist]);
  assert.equal(useSettings.getState().activePlaylistId, playlist.id);
  assert.equal(useSettings.getState().locale, "fr");
  const saved = JSON.parse(localStorage.getItem(KEY) as string);
  assert.deepEqual(saved.playlists, [playlist]);
  assert.equal(saved.locale, "fr");
});

test("legacy playlist addresses migrate atomically to typed sources", async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [
        {
          id: "xtream-defaults",
          name: "Provider",
          url: "https://provider.example/get.php?username=user%2Bname&password=p%26ss",
        },
        {
          id: "unsupported-type",
          name: "Old API",
          url: "https://provider.example/get.php?username=user&password=pass&type=m3u&output=ts",
        },
        {
          id: "foreign-type",
          name: "Other API",
          url: "https://provider.example/get.php?username=user&password=pass&type=enigma22&output=ts",
        },
        {
          id: "unsupported-output",
          name: "Odd output",
          url: "https://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=rtmp",
        },
        { id: "plain", name: "Plain", url: "https://example.com/custom?token=a%2Bb" },
      ],
      activePlaylistId: "xtream-defaults",
    }),
  );

  const { useSettings } = await load();
  const playlists = useSettings.getState().playlists;
  assert.deepEqual(playlists[0].source, {
    kind: "xtream",
    server: "https://provider.example",
    username: "user+name",
    password: "p&ss",
    output: "ts",
  });
  assert.deepEqual(
    playlists.slice(1).map((playlist) => playlist.source),
    [
      m3u("https://provider.example/get.php?username=user&password=pass&type=m3u&output=ts"),
      m3u(
        "https://provider.example/get.php?username=user&password=pass&type=enigma22&output=ts",
      ),
      m3u(
        "https://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=rtmp",
      ),
      m3u("https://example.com/custom?token=a%2Bb"),
    ],
  );
  assert.deepEqual(
    playlists.map((playlist) => playlist.sourceVersion),
    [1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    playlists.map((playlist) => playlist.id),
    ["xtream-defaults", "unsupported-type", "foreign-type", "unsupported-output", "plain"],
  );
  const persisted = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(
    persisted.playlists.some((playlist: object) => "url" in playlist),
    false,
  );
});

test("a malformed legacy address remains editable after migration", async () => {
  const malformed = "  provider.example/list with spaces.m3u  ";
  localStorage.setItem(
    KEY,
    JSON.stringify({
      playlists: [
        {
          id: "legacy-malformed",
          name: "Needs fixing",
          url: malformed,
          hiddenCategories: ["News"],
          categoryCount: 7,
        },
      ],
      activePlaylistId: "legacy-malformed",
    }),
  );

  const { useSettings } = await load();
  assert.deepEqual(useSettings.getState().playlists, [
    {
      id: "legacy-malformed",
      name: "Needs fixing",
      source: { kind: "m3u", url: malformed },
      sourceVersion: 1,
      hiddenCategories: ["News"],
      categoryCount: 7,
    },
  ]);
  assert.equal(useSettings.getState().activePlaylist()?.id, "legacy-malformed");
  const persisted = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal("url" in persisted.playlists[0], false);
  assert.deepEqual(persisted.playlists[0].source, { kind: "m3u", url: malformed });

  const reloaded = await load();
  assert.deepEqual(reloaded.useSettings.getState().playlists[0].source, {
    kind: "m3u",
    url: malformed,
  });
});

test("every source change increments its version and clears the category count", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("Provider", {
    kind: "xtream",
    server: "https://provider.example",
    username: "viewer",
    password: "secret",
    output: "ts",
  });
  const original = useSettings.getState().playlists[0];
  useSettings.getState().setPlaylistCategoryCount(original.id, 12);

  await useSettings.getState().updatePlaylist(original.id, "Renamed", { ...original.source });
  let playlist = useSettings.getState().playlists[0];
  assert.equal(playlist.sourceVersion, 1);
  assert.equal(playlist.categoryCount, 12);

  await useSettings
    .getState()
    .updatePlaylist(original.id, "Renamed", { ...original.source, password: "replacement" });
  playlist = useSettings.getState().playlists[0];
  assert.equal(playlist.sourceVersion, 2);
  assert.equal(playlist.categoryCount, undefined);
});

test("account replacement clears hidden categories after the source version changes", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("Provider", {
    kind: "xtream",
    server: "https://provider.example",
    username: "viewer",
    password: "secret",
    output: "ts",
  });
  const original = useSettings.getState().playlists[0];
  useSettings.setState({
    playlists: [{ ...original, hiddenCategories: ["live:1", "movie:2"] }],
  });

  await useSettings.getState().updatePlaylist(original.id, "Provider", {
    ...original.source,
    username: "replacement",
  });

  const replaced = useSettings.getState().playlists[0];
  expect(replaced.sourceVersion).toBe(2);
  expect(replaced.hiddenCategories).toBeUndefined();
});
