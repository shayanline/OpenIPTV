import { beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";

/**
 * Loading a playlist, which is the one thing here that talks to the network.
 *
 * The interesting behaviour is all about what happens when it goes wrong or arrives out of
 * order: showing the saved copy first, keeping it when a refresh fails, and making sure that
 * switching playlist twice quickly ends on the one that was asked for last rather than the
 * one that happened to answer last.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 group-title="News",Beta
http://example.invalid/b.m3u8`;

const OTHER = `#EXTM3U
#EXTINF:-1 group-title="Sport",Gamma
http://example.invalid/c.m3u8`;

const load = async () => {
  vi.resetModules();
  const settings = await import("../src/stores/settings");
  const channels = await import("../src/stores/channels");
  return { ...settings, ...channels };
};

const configure = (s: Awaited<ReturnType<typeof load>>, url = "http://list.invalid/a.m3u") => {
  s.useSettings.getState().addPlaylist("Test", url);
};

beforeEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("a good playlist is parsed, grouped and reported", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));

  const result = await s.useChannels.getState().load();
  assert.equal(result.error, "");
  assert.equal(result.count, 2);
  assert.equal(s.useChannels.getState().categories[0].name, "News");
});

test("the saved copy is shown before the network answers", async () => {
  const s = await load();
  configure(s);
  const id = s.useSettings.getState().playlists[0].id;
  localStorage.setItem(`simpleiptv.cache.${id}`, PLAYLIST);

  // A fetch that never settles, so the only thing on screen can be the cached copy.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  void s.useChannels.getState().load();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(s.useChannels.getState().channels.length, 2);
});

test("a failed refresh keeps the saved copy rather than emptying the screen", async () => {
  const s = await load();
  configure(s);
  const id = s.useSettings.getState().playlists[0].id;
  localStorage.setItem(`simpleiptv.cache.${id}`, PLAYLIST);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

  const result = await s.useChannels.getState().load();
  assert.match(result.error, /Showing the last saved copy/);
  assert.equal(s.useChannels.getState().channels.length, 2, "the cached channels went away");
});

test("a failure with nothing cached says so plainly", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

  const result = await s.useChannels.getState().load();
  assert.match(result.error, /Could not load the playlist/);
  assert.equal(result.count, 0);
});

test("an HTTP error is a failure, not an empty playlist", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }));
  assert.match((await s.useChannels.getState().load()).error, /HTTP 404/);
});

test("a playlist that parses to nothing is reported rather than shown as empty", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "not a playlist" }));
  assert.match((await s.useChannels.getState().load()).error, /no channels/);
});

test("the slower of two overlapping loads does not overwrite the newer one", async () => {
  const s = await load();
  configure(s);

  // The first request is slow and the second is quick, which is the order that used to lose:
  // whichever answered last won, so switching playlist twice landed on the first one asked for.
  let releaseSlow: (v: unknown) => void = () => {};
  const fetchMock = vi.fn()
    .mockImplementationOnce((_url: string, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        releaseSlow = () => resolve({ ok: true, text: async () => PLAYLIST });
      }))
    .mockImplementationOnce(async () => ({ ok: true, text: async () => OTHER }));
  vi.stubGlobal("fetch", fetchMock);

  const slow = s.useChannels.getState().load(true);
  const quick = s.useChannels.getState().load(true);
  await quick;
  releaseSlow(null);
  await slow;

  assert.equal(s.useChannels.getState().channels.length, 1);
  assert.equal(s.useChannels.getState().channels[0].name, "Gamma");
  assert.equal(s.useChannels.getState().error, "", "the abandoned request reported a failure");
});

test("nothing configured is not an error, it is the first run", async () => {
  const s = await load();
  const result = await s.useChannels.getState().load();
  assert.deepEqual(result, { count: 0, error: "" });
  assert.equal(s.useChannels.getState().loading, false);
});

test("favourites survive a reload and clear on request", async () => {
  const s = await load();
  s.useChannels.getState().toggleFavourite("alpha");
  s.useChannels.getState().toggleFavourite("beta");
  assert.deepEqual(s.useChannels.getState().favourites, ["alpha", "beta"]);

  s.useChannels.getState().toggleFavourite("alpha");
  assert.deepEqual(s.useChannels.getState().favourites, ["beta"]);

  const reloaded = await load();
  assert.deepEqual(reloaded.useChannels.getState().favourites, ["beta"], "not written through");

  reloaded.useChannels.getState().clearPersonal();
  assert.deepEqual(reloaded.useChannels.getState().favourites, []);
});

test("sorting A to Z is applied to what was fetched", async () => {
  const s = await load();
  configure(s);
  s.useSettings.getState().set("sortAlphabetically", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => `#EXTM3U
#EXTINF:-1,Zeta
http://example.invalid/z.m3u8
#EXTINF:-1,Alpha
http://example.invalid/a.m3u8`,
  }));

  await s.useChannels.getState().load();
  expect(s.useChannels.getState().channels.map((c) => c.name)).toEqual(["Alpha", "Zeta"]);
});
