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

const KEY = "simpleiptv.settings";

const load = () => {
  vi.resetModules();
  return import("../src/stores/settings");
};

beforeEach(() => {
  localStorage.clear();
});

test("a file written by an older version keeps working, and gains the new defaults", async () => {
  // No aspectId, no panelTimeout: a release before either existed.
  localStorage.setItem(KEY, JSON.stringify({ fontId: "serif", showClock: false }));
  const { useSettings } = await load();
  const s = useSettings.getState();

  assert.equal(s.fontId, "serif", "what was saved is kept");
  assert.equal(s.showClock, false);
  assert.equal(s.aspectId, "fit", "what is new arrives at its default");
  assert.equal(s.panelTimeout, 15);
});

test("nonsense in the store falls back to defaults rather than throwing", async () => {
  localStorage.setItem(KEY, "{not json");
  const { useSettings } = await load();
  assert.equal(useSettings.getState().fontId, "system");
});

test("what is written back is data, never the actions", async () => {
  const { useSettings } = await load();
  useSettings.getState().set("showClock", false);

  const saved = JSON.parse(localStorage.getItem(KEY) as string);
  assert.equal(saved.showClock, false);
  for (const action of ["set", "addPlaylist", "removePlaylist", "updatePlaylist",
                        "reset", "font", "scale", "activePlaylist"]) {
    assert.ok(!(action in saved), `${action} was persisted`);
  }
});

test("the first playlist added becomes the active one", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", "http://a.invalid/x.m3u");
  const s = useSettings.getState();
  assert.equal(s.playlists.length, 1);
  assert.equal(s.activePlaylistId, s.playlists[0].id);
});

test("adding a second playlist does not steal the active one", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("First", "http://a.invalid/x.m3u");
  const first = useSettings.getState().activePlaylistId;
  useSettings.getState().addPlaylist("Second", "http://b.invalid/y.m3u");
  assert.equal(useSettings.getState().activePlaylistId, first);
});

test("removing the active playlist promotes another rather than leaving nothing active", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("First", "http://a.invalid/x.m3u");
  s().addPlaylist("Second", "http://b.invalid/y.m3u");
  const [first, second] = s().playlists;

  s().removePlaylist(first.id);
  assert.equal(s().activePlaylistId, second.id);
});

test("removing the last playlist leaves the app in its first run state", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("Only", "http://a.invalid/x.m3u");
  s().removePlaylist(s().playlists[0].id);
  assert.equal(s().playlists.length, 0);
  assert.equal(s().activePlaylistId, "");
  assert.equal(s().activePlaylist(), undefined);
});

test("a playlist whose name is blank is still saved with its url trimmed", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("  Spaced  ", "  http://a.invalid/x.m3u  ");
  const p = useSettings.getState().playlists[0];
  assert.equal(p.name, "Spaced");
  assert.equal(p.url, "http://a.invalid/x.m3u");
});

test("reset clears the playlists and writes the cleared state out", async () => {
  const { useSettings } = await load();
  useSettings.getState().addPlaylist("One", "http://a.invalid/x.m3u");
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
  localStorage.setItem(KEY, JSON.stringify({
    playlists: [{ id: "pl-1", name: "One", url: "http://a.invalid/x.m3u" }],
    activePlaylistId: "pl-gone",
  }));
  const { useSettings } = await load();
  assert.equal(useSettings.getState().activePlaylist()?.id, "pl-1");
});

test("two playlists added in the same millisecond still get an id each", async () => {
  const { useSettings } = await load();
  // Not a race that has to be provoked: any code adding two in a row hits the same
  // millisecond, and identical ids meant removing one removed both.
  useSettings.getState().addPlaylist("One", "http://a.invalid/x.m3u");
  useSettings.getState().addPlaylist("Two", "http://b.invalid/y.m3u");
  const ids = useSettings.getState().playlists.map((p) => p.id);
  assert.equal(new Set(ids).size, 2);
});

test("removing one of two playlists added together leaves exactly the other", async () => {
  const { useSettings } = await load();
  const s = () => useSettings.getState();
  s().addPlaylist("One", "http://a.invalid/x.m3u");
  s().addPlaylist("Two", "http://b.invalid/y.m3u");
  s().removePlaylist(s().playlists[0].id);
  assert.equal(s().playlists.length, 1);
  assert.equal(s().playlists[0].name, "Two");
});
