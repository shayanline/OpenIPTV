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

/**
 * The cache, in memory, standing in for IndexedDB.
 *
 * jsdom has no IndexedDB, and these tests are about the store's policy rather than about
 * the database: whether a fresh copy is trusted, whether an old one is refreshed behind the
 * picture, whether switching playlist calls that refresh off. A Map answers all of those
 * questions and the real store answers none of them any faster.
 *
 * The plumbing is covered elsewhere and by something better than a fake. `npm run tv:engines`
 * loads the built app in a real Chromium 69 and a real Chromium 120 and fails on any
 * exception, so a database this application cannot open is caught there, on the engines that
 * would actually have the problem.
 */
const disk = new Map<string, Blob | string>();

const load = async () => {
  vi.resetModules();
  disk.clear();
  vi.doMock("../src/services/disk", () => ({
    BUDGET_BYTES: 5 * 1024 * 1024,
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: Blob | string) => { disk.set(key, value); return true; },
    forget: async (doomed: (key: string) => boolean) => {
      let gone = 0;
      for (const key of [...disk.keys()]) if (doomed(key)) { disk.delete(key); gone += 1; }
      return gone;
    },
    forgetAll: async () => { disk.clear(); },
    usage: async () => ({ bytes: 0, count: disk.size }),
    entries: async () => [...disk.keys()].map((key) => ({ key, bytes: 0, at: 0 })),
    evictionPlan: () => ({ evict: [], refused: false }),
  }));
  const settings = await import("../src/stores/settings");
  const channels = await import("../src/stores/channels");
  return { ...settings, ...channels };
};

const configure = (s: Awaited<ReturnType<typeof load>>, url = "http://list.invalid/a.m3u") => {
  s.useSettings.getState().addPlaylist("Test", url);
};

/**
 * Let the background refresh happen.
 *
 * A cached playlist answers the launch and the network is asked afterwards, in idle time,
 * so a test about what the refresh does has to wait for it. jsdom has no
 * requestIdleCallback, so the store falls back to a timeout and this outlasts it.
 */
const afterIdle = () => new Promise((r) => setTimeout(r, 600));

/**
 * Cache a playlist as though it were saved `ageMs` ago.
 *
 * Keyed by the address, which is the fix this replaced: the key used to be the playlist's id,
 * so editing a URL left the previous playlist's channels cached under the new one and being
 * served as though current.
 */
const seedCache = (s: Awaited<ReturnType<typeof load>>, text: string, ageMs: number) => {
  const url = s.useSettings.getState().playlists[0].url;
  disk.set(`playlist:${url}`, text);
  localStorage.setItem(`openiptv.at.${url}`, String(Date.now() - ageMs));
  return url;
};

const HOUR = 60 * 60 * 1000;

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
  const url = s.useSettings.getState().playlists[0].url;
  disk.set(`playlist:${url}`, PLAYLIST);

  // A fetch that never settles, so the only thing on screen can be the cached copy.
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  void s.useChannels.getState().load();
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(s.useChannels.getState().channels.length, 2);
});

test("a failed refresh keeps the saved copy rather than emptying the screen", async () => {
  const s = await load();
  configure(s);
  seedCache(s, PLAYLIST, 12 * HOUR);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

  // The launch is answered by the cache and does not wait for the network, so the failure
  // arrives afterwards rather than in the result.
  const result = await s.useChannels.getState().load();
  assert.equal(result.error, "");
  assert.equal(result.count, 2);

  await afterIdle();
  assert.match(s.useChannels.getState().error, /Showing the last saved copy/);
  assert.equal(s.useChannels.getState().channels.length, 2, "the cached channels went away");
});

test("a cache younger than its life is not refreshed at all", async () => {
  const s = await load();
  configure(s);
  seedCache(s, PLAYLIST, 1 * HOUR);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => OTHER });
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().load();
  assert.equal(result.count, 2);

  // Nothing is downloaded, nothing is parsed a second time, and nothing is written back to
  // flash. This is the ordinary launch, and it is the whole point of the timestamp.
  await afterIdle();
  assert.equal(fetchMock.mock.calls.length, 0, "went to the network for a fresh cache");
  assert.equal(s.useChannels.getState().channels.length, 2);
});

test("an old cache is refreshed, but behind the picture rather than in front of it", async () => {
  const s = await load();
  configure(s);
  seedCache(s, PLAYLIST, 12 * HOUR);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => OTHER });
  vi.stubGlobal("fetch", fetchMock);

  await s.useChannels.getState().load();
  assert.equal(fetchMock.mock.calls.length, 0, "the launch waited on the network");
  assert.equal(s.useChannels.getState().channels[0].name, "Alpha");

  await afterIdle();
  assert.equal(fetchMock.mock.calls.length, 1);
  assert.equal(s.useChannels.getState().channels[0].name, "Gamma", "the refresh did not land");
});

test("a refresh that finds the same bytes does not parse or rewrite them", async () => {
  const s = await load();
  configure(s);
  const url = seedCache(s, PLAYLIST, 12 * HOUR);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));

  await s.useChannels.getState().load();
  const shown = s.useChannels.getState().channels;
  await afterIdle();

  // The same array, not an equal one. A second parse would produce new objects, and new
  // objects walk straight past every memo in the interface for no reason at all.
  assert.equal(s.useChannels.getState().channels, shown, "the playlist was parsed twice");
  // Stamped anyway, or the next launch would go back to the network immediately.
  assert.ok(Number(localStorage.getItem(`openiptv.at.${url}`)) > Date.now() - 5000);
});

test("switching playlist calls off a refresh queued for the old one", async () => {
  const s = await load();
  configure(s);
  seedCache(s, PLAYLIST, 12 * HOUR);
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => OTHER });
  vi.stubGlobal("fetch", fetchMock);

  await s.useChannels.getState().load();          // queues a refresh for the old playlist
  s.useSettings.getState().addPlaylist("Second", "http://list.invalid/b.m3u");
  s.useSettings.getState().set("activePlaylistId", s.useSettings.getState().playlists[1].id);
  await s.useChannels.getState().load(true);      // which this must cancel

  await afterIdle();
  assert.equal(fetchMock.mock.calls.length, 1, "the abandoned playlist came back anyway");
  assert.equal(fetchMock.mock.calls[0][0], "http://list.invalid/b.m3u");
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

/**
 * The sweep, which is the only thing that can ever delete a cached playlist.
 *
 * Removing a playlist used to leave its copy behind for good, and no code could have removed
 * it afterwards: the key was derived from an id that no longer existed anywhere, so nothing
 * knew the entry's name. Inside a bounded cache that is a leak with a hard stop at the end.
 */
test("the sweep drops cached playlists nothing is configured to watch", async () => {
  const s = await load();
  configure(s, "http://list.invalid/keep.m3u");
  disk.set("playlist:http://list.invalid/keep.m3u", PLAYLIST);
  disk.set("playlist:http://list.invalid/removed.m3u", OTHER);
  disk.set("logo:76x48|http://logos.invalid/a.png", "pretend-blob");

  await s.useChannels.getState().sweep();

  assert.ok(disk.has("playlist:http://list.invalid/keep.m3u"), "the active playlist went");
  assert.ok(!disk.has("playlist:http://list.invalid/removed.m3u"), "the orphan survived");
  // Logos are not swept with playlists. The same channels usually come back, artwork is the
  // slowest thing to reappear, and the budget already bounds it.
  assert.ok(disk.has("logo:76x48|http://logos.invalid/a.png"), "the logo was collected too");
});

test("the sweep clears the playlists older versions kept in localStorage", async () => {
  const s = await load();
  configure(s);
  localStorage.setItem("openiptv.cache.pl-old", PLAYLIST);
  localStorage.setItem("openiptv.cache.pl-old.at", "123");
  localStorage.setItem("openiptv.favourites", '["keep-me"]');

  await s.useChannels.getState().sweep();

  assert.equal(localStorage.getItem("openiptv.cache.pl-old"), null);
  assert.equal(localStorage.getItem("openiptv.cache.pl-old.at"), null);
  assert.equal(localStorage.getItem("openiptv.favourites"), '["keep-me"]', "took too much");
});

test("editing a playlist's address does not serve the old one from cache", async () => {
  const s = await load();
  configure(s, "http://list.invalid/before.m3u");
  seedCache(s, PLAYLIST, 1 * HOUR);          // fresh, so it would be trusted outright
  const id = s.useSettings.getState().playlists[0].id;

  // The id is unchanged, which is exactly the case that used to go wrong: the cache was
  // keyed on it, so a corrected address was answered with the previous playlist's channels
  // and a timestamp saying they were current.
  s.useSettings.getState().updatePlaylist(id, "After", "http://list.invalid/after.m3u");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => OTHER }));

  await s.useChannels.getState().load();
  assert.equal(s.useChannels.getState().channels[0].name, "Gamma", "served the old playlist");
});

test("sorting A to Z counts numbers rather than spelling them", async () => {
  const s = await load();
  configure(s);
  s.useSettings.getState().set("sortAlphabetically", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    text: async () => `#EXTM3U
#EXTINF:-1,Sport 10
http://example.invalid/10.m3u8
#EXTINF:-1,Sport 2
http://example.invalid/2.m3u8
#EXTINF:-1,Sport 1
http://example.invalid/1.m3u8`,
  }));

  // Plain string ordering puts "Sport 10" before "Sport 2", which is alphabetical at the
  // viewer rather than for them. These are channel names and they are full of numbers.
  await s.useChannels.getState().load();
  expect(s.useChannels.getState().channels.map((c) => c.name))
    .toEqual(["Sport 1", "Sport 2", "Sport 10"]);
});
