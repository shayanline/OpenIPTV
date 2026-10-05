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

const KEY = "openiptv.settings";
const m3u = (url: string) => ({ kind: "m3u" as const, url });

const load = () => {
  vi.resetModules();
  return import("../src/stores/settings");
};

beforeEach(() => {
  localStorage.clear();
});

test("a file written by an older version keeps working, and gains the new defaults", async () => {
  // No aspectId, no panelTimeout: a release before either existed.
  localStorage.setItem(KEY, JSON.stringify({ showClock: false, resumeLast: false }));
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.showClock, false, "what was saved is kept");
  assert.equal(s.resumeLast, false);
  assert.equal(s.aspectId, "fill", "what is new arrives at its default");
  assert.equal(s.showPlaybackStats, false, "playback information stays opt in");
  assert.equal("panelTimeout" in s, false, "the removed setting does not return");
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
          hiddenCategoryMode: "unexpected",
        },
      ],
      activePlaylistId: "pl-1",
    }),
  );

  const { useSettings } = await load();
  assert.equal(useSettings.getState().playlists.length, 1);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
  assert.equal(useSettings.getState().playlists[0].hiddenCategoryMode, "exclude");
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
    "setHiddenCategories",
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

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, []);
  assert.equal(useSettings.getState().playlists[0].hiddenCategoryMode, "exclude");

  useSettings.getState().addPlaylist("New", m3u("http://new.invalid/list.m3u"));
  assert.deepEqual(useSettings.getState().playlists[1].hiddenCategories, []);
  assert.equal(useSettings.getState().playlists[1].hiddenCategoryMode, "exclude");
});

test("category visibility stays with its playlist and survives a reload", async () => {
  const { useSettings } = await load();
  const settings = useSettings.getState();
  settings.addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  settings.addPlaylist("Second", m3u("http://b.invalid/y.m3u"));
  const [first, second] = useSettings.getState().playlists;

  useSettings.getState().setCategoryHidden(first.id, "News", true);
  useSettings.getState().setHiddenCategoryMode(first.id, "search");

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
  assert.equal(useSettings.getState().playlists[0].hiddenCategoryMode, "search");
  assert.deepEqual(useSettings.getState().playlists[1].hiddenCategories, []);
  assert.equal(useSettings.getState().playlists[1].hiddenCategoryMode, "exclude");

  const reloaded = await load();
  assert.deepEqual(reloaded.useSettings.getState().playlists[0].hiddenCategories, ["News"]);
  assert.equal(reloaded.useSettings.getState().playlists[0].hiddenCategoryMode, "search");
  assert.deepEqual(reloaded.useSettings.getState().playlists[1].hiddenCategories, []);
  assert.equal(second.name, "Second");
});

test("a playlist can replace its hidden category set in one write", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  useSettings.getState().addPlaylist("Second", m3u("http://b.invalid/y.m3u"));
  const [first] = useSettings.getState().playlists;

  useSettings.getState().setHiddenCategories(first.id, ["News", "Sport"]);

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News", "Sport"]);
  assert.deepEqual(useSettings.getState().playlists[1].hiddenCategories, []);
  const reloaded = await load();
  assert.deepEqual(reloaded.useSettings.getState().playlists[0].hiddenCategories, [
    "News",
    "Sport",
  ]);
});

test("showing a category removes only that exact playlist category", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  const id = useSettings.getState().playlists[0].id;

  useSettings.getState().setCategoryHidden(id, "News", true);
  useSettings.getState().setCategoryHidden(id, "NEWS", true);
  useSettings.getState().setCategoryHidden(id, "News", false);

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["NEWS"]);
});

test("removing the active playlist promotes another rather than leaving nothing active", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("First", m3u("http://a.invalid/x.m3u"));
  s().addPlaylist("Second", m3u("http://b.invalid/y.m3u"));
  const [first, second] = s().playlists;

  s().removePlaylist(first.id);
  assert.equal(s().activePlaylistId, second.id);
});

test("removing the last playlist leaves the app in its first run state", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("Only", m3u("http://a.invalid/x.m3u"));
  s().removePlaylist(s().playlists[0].id);
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

test("reset clears the playlists and writes the cleared state out", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("One", m3u("http://a.invalid/x.m3u"));
  useSettings.getState().reset();

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
  s().removePlaylist(s().playlists[0].id);
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
    hiddenCategoryMode: "exclude" as const,
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
          hiddenCategoryMode: "search",
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
      hiddenCategoryMode: "search",
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

  useSettings.getState().updatePlaylist(original.id, "Renamed", { ...original.source });
  let playlist = useSettings.getState().playlists[0];
  assert.equal(playlist.sourceVersion, 1);
  assert.equal(playlist.categoryCount, 12);

  useSettings
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
  useSettings.getState().setHiddenCategories(original.id, ["live:1", "movie:2"]);

  useSettings.getState().updatePlaylist(original.id, "Provider", {
    ...original.source,
    username: "replacement",
  });

  const replaced = useSettings.getState().playlists[0];
  expect(replaced.sourceVersion).toBe(2);
  expect(replaced.hiddenCategories).toEqual([]);
});
