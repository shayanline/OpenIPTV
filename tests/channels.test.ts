import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { parseXtreamPlaylistUrl, type XtreamSource } from "../src/services/playlistUrl";

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
    write: async (key: string, value: Blob | string) => {
      disk.set(key, value);
      return true;
    },
    forget: async (doomed: (key: string) => boolean) => {
      let gone = 0;
      for (const key of [...disk.keys()])
        if (doomed(key)) {
          disk.delete(key);
          gone += 1;
        }
      return gone;
    },
    forgetAll: async () => {
      disk.clear();
    },
    usage: async () => ({ bytes: 0, count: disk.size }),
    entries: async () => [...disk.keys()].map((key) => ({ key, bytes: 0, at: 0 })),
    evictionPlan: () => ({ evict: [], refused: false }),
  }));
  const settings = await import("../src/stores/settings");
  const channels = await import("../src/stores/channels");
  const personal = await import("../src/stores/personal");
  return { ...settings, ...channels, ...personal };
};

const configure = (s: Awaited<ReturnType<typeof load>>, url = "http://list.invalid/a.m3u") => {
  s.useSettings
    .getState()
    .addPlaylist("Test", parseXtreamPlaylistUrl(url) ?? { kind: "m3u", url });
};

const XTREAM_SOURCE: XtreamSource = {
  kind: "xtream",
  server: "http://provider.example",
  username: "viewer",
  password: "secret",
  output: "m3u8",
};

const configureXtream = (s: Awaited<ReturnType<typeof load>>, source = XTREAM_SOURCE) => {
  s.useSettings.getState().addPlaylist("Provider", source);
  return s.useSettings.getState().playlists[0];
};

const xtreamResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const xtreamFetch = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    assert.notEqual(url.pathname.endsWith("/get.php"), true, "Xtream requested get.php");
    const action = url.searchParams.get("action") ?? "authenticate";
    const defaults: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [
        { category_id: "empty", category_name: "Empty" },
        { category_id: "news-a", category_name: "News" },
        { category_id: "news-b", category_name: "News" },
      ],
      get_vod_categories: [],
      get_series_categories: [],
      get_live_streams: [
        { stream_id: 1, name: "Alpha", category_id: "news-a", num: 11 },
        { stream_id: 2, name: "Beta", category_id: "news-b", num: 22 },
      ],
    };
    return xtreamResponse(action in overrides ? overrides[action] : defaults[action]);
  });

/**
 * Let the background refresh happen.
 *
 * A cached playlist answers the launch and the network is asked afterwards, in idle time,
 * so a test about what the refresh does has to wait for it. jsdom has no
 * requestIdleCallback, so the store falls back to a timeout and this outlasts it.
 */
const afterIdle = () => vi.advanceTimersByTimeAsync(600);

/**
 * Cache a playlist as though it were saved `ageMs` ago.
 *
 * Keyed by the address, which is the fix this replaced: the key used to be the playlist's id,
 * so editing a URL left the previous playlist's channels cached under the new one and being
 * served as though current.
 */
const seedCache = (s: Awaited<ReturnType<typeof load>>, text: string, ageMs: number) => {
  const source = s.useSettings.getState().playlists[0].source;
  assert.equal(source.kind, "m3u");
  const url = source.url;
  disk.set(`playlist:${url}`, text);
  localStorage.setItem(`openiptv.at.${url}`, String(Date.now() - ageMs));
  return url;
};

const seedXtreamCache = (playlist: { id: string; sourceVersion: number }, ageMs: number) => {
  const prefix = `xtream:${playlist.id}:v${playlist.sourceVersion}`;
  disk.set(`${prefix}:account`, JSON.stringify({ status: "Active", isTrial: false }));
  disk.set(
    `${prefix}:categories`,
    JSON.stringify([
      { key: "live:news", id: "news", kind: "live", name: "News" },
      { key: "live:sport", id: "sport", kind: "live", name: "Sport" },
    ]),
  );
  disk.set(
    `${prefix}:live`,
    JSON.stringify([
      {
        id: `xtream:${playlist.id}:live:1`,
        name: "Cached News",
        logo: "",
        group: "News",
        url: "http://provider.example/live/viewer/secret/1.m3u8",
        quality: "",
        number: 1,
        xtream: {
          playlistId: playlist.id,
          streamId: "1",
          categoryKey: "live:news",
          archiveDays: 0,
          directSource: "",
        },
      },
    ]),
  );
  for (const scope of ["account", "categories", "live"]) {
    localStorage.setItem(`openiptv.at.${prefix}:${scope}`, String(Date.now() - ageMs));
  }
  return prefix;
};

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.unstubAllGlobals();
});

afterEach(() => vi.useRealTimers());

test("a good playlist is parsed, grouped and reported", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));

  const result = await s.useChannels.getState().load();
  assert.equal(result.error, "");
  assert.equal(result.count, 2);
  assert.equal(s.useChannels.getState().categories[0].name, "News");
});

test("an HTTPS browser upgrades an HTTP M3U playlist before fetching", async () => {
  const s = await load();
  configure(s, "http://provider.example:80/list.m3u");
  vi.stubGlobal("window", { location: { protocol: "https:" } });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST });
  vi.stubGlobal("fetch", fetchMock);

  await s.useChannels.getState().load();

  expect(fetchMock.mock.calls[0][0]).toBe("https://provider.example/list.m3u");
});

test("Xtream validation authenticates directly without requesting get.php", async () => {
  const s = await load();
  const fetchMock = xtreamFetch();
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().validatePlaylist("Provider", XTREAM_SOURCE);

  expect(result).toEqual({ count: 1, error: "" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain("/player_api.php?");
});

test("Xtream loading is API first and builds the complete live catalogue", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  const fetchMock = xtreamFetch({
    get_vod_categories: [{ category_id: "movies", category_name: "Movies" }],
    get_series_categories: [{ category_id: "series", category_name: "Series" }],
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().load(true);

  expect(result).toEqual({ count: 2, error: "" });
  expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/get.php"))).toBe(
    false,
  );
  expect(s.useChannels.getState().channels.map((channel) => channel.id)).toEqual([
    `xtream:${playlist.id}:live:1`,
    `xtream:${playlist.id}:live:2`,
  ]);
  expect(s.useChannels.getState().channels.map((channel) => channel.group)).toEqual([
    "News",
    "News",
  ]);
  expect(s.useChannels.getState().categories).toMatchObject([
    { key: "live:empty", name: "Empty", channels: [] },
    { key: "live:news-a", name: "News", channels: [{ name: "Alpha" }] },
    { key: "live:news-b", name: "News", channels: [{ name: "Beta" }] },
  ]);
  expect(s.useChannels.getState().managedCategories).toEqual([
    { key: "live:empty", name: "Empty" },
    { key: "live:news-a", name: "News" },
    { key: "live:news-b", name: "News" },
    { key: "movie:movies", name: "Movies" },
    { key: "series:series", name: "Series" },
  ]);
});

test("a VOD only Xtream account loads and caches its account status and categories", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  const fetchMock = xtreamFetch({
    get_live_categories: [],
    get_vod_categories: [{ category_id: "10", category_name: "Movies" }],
    get_live_streams: [],
  });
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().load(true);

  expect(result).toEqual({ count: 0, error: "" });
  expect(s.useChannels.getState().accounts[playlist.id]).toMatchObject({ status: "Active" });
  expect(disk.has(`xtream:${playlist.id}:v1:account`)).toBe(true);
  expect(disk.has(`xtream:${playlist.id}:v1:categories`)).toBe(true);
  expect(disk.get(`xtream:${playlist.id}:v1:live`)).toBe("[]");
});

test("an Xtream account fails only when every supported content kind is empty", async () => {
  const s = await load();
  configureXtream(s);
  vi.stubGlobal(
    "fetch",
    xtreamFetch({
      get_live_categories: [],
      get_vod_categories: [],
      get_series_categories: [],
      get_live_streams: [],
    }),
  );

  const result = await s.useChannels.getState().load(true);

  expect(result.error).toMatch(/no playable content/i);
});

test("a fresh cached VOD only account launches without network work", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  const prefix = `xtream:${playlist.id}:v${playlist.sourceVersion}`;
  disk.set(`${prefix}:account`, JSON.stringify({ status: "Active", isTrial: false }));
  disk.set(
    `${prefix}:categories`,
    JSON.stringify([{ key: "movie:10", id: "10", kind: "movie", name: "Movies" }]),
  );
  disk.set(`${prefix}:live`, "[]");
  for (const scope of ["account", "categories", "live"]) {
    localStorage.setItem(`openiptv.at.${prefix}:${scope}`, String(Date.now()));
  }
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().load();

  expect(result).toEqual({ count: 0, error: "" });
  expect(s.useChannels.getState().accounts[playlist.id]).toMatchObject({ status: "Active" });
  await afterIdle();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the same provider stream identifier remains scoped to its playlist", async () => {
  const first = await load();
  const firstPlaylist = configureXtream(first);
  vi.stubGlobal(
    "fetch",
    xtreamFetch({
      get_live_categories: [{ category_id: "one", category_name: "One" }],
      get_live_streams: [{ stream_id: 1, name: "One", category_id: "one" }],
    }),
  );
  await first.useChannels.getState().load(true);
  const firstId = first.useChannels.getState().channels[0].id;

  const secondSource = { ...XTREAM_SOURCE, username: "other" };
  first.useSettings.getState().addPlaylist("Other", secondSource);
  const secondPlaylist = first.useSettings.getState().playlists[1];
  first.useSettings.getState().set("activePlaylistId", secondPlaylist.id);
  await first.useChannels.getState().load(true);

  expect(firstId).toBe(`xtream:${firstPlaylist.id}:live:1`);
  expect(first.useChannels.getState().channels[0].id).toBe(
    `xtream:${secondPlaylist.id}:live:1`,
  );
});

test("HTTPS browser transport applies to API requests and generated streams", async () => {
  const s = await load();
  configureXtream(s);
  vi.stubGlobal("window", { location: { protocol: "https:" } });
  const fetchMock = xtreamFetch();
  vi.stubGlobal("fetch", fetchMock);

  await s.useChannels.getState().load(true);

  expect(fetchMock.mock.calls.every(([input]) => String(input).startsWith("https://"))).toBe(
    true,
  );
  expect(s.useChannels.getState().channels[0].url).toBe(
    "https://provider.example/live/viewer/secret/1.m3u8",
  );
});

test("an HTTPS browser explains an HTTP Xtream transport failure", async () => {
  const s = await load();
  vi.stubGlobal("window", { location: { protocol: "https:" } });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  const result = await s.useChannels.getState().validatePlaylist("Provider", XTREAM_SOURCE);

  expect(result.errorDetail).toMatch(/HTTPS/i);
  expect(result.errorDetail).toMatch(/CORS|Cross Origin/i);
  expect(result.errorDetail).not.toContain("Failed to fetch");
});

test("an HTTPS browser explains an HTTP M3U transport failure", async () => {
  const s = await load();
  vi.stubGlobal("window", { location: { protocol: "https:" } });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

  const result = await s.useChannels
    .getState()
    .validatePlaylist("Provider", { kind: "m3u", url: "http://provider.example/list.m3u" });

  expect(result.errorDetail).toMatch(/HTTPS/i);
  expect(result.errorDetail).toMatch(/CORS|Cross Origin/i);
  expect(result.errorDetail).not.toContain("Failed to fetch");
});

test("a missing Player API explains the M3U alternative", async () => {
  const s = await load();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(xtreamResponse({}, 404)));

  const result = await s.useChannels.getState().validatePlaylist("Provider", XTREAM_SOURCE);

  expect(result.error).toMatch(/get\.php.*M3U/i);
});

test("the saved copy is shown before the network answers", async () => {
  const s = await load();
  configure(s);
  const source = s.useSettings.getState().playlists[0].source;
  assert.equal(source.kind, "m3u");
  disk.set(`playlist:${source.url}`, PLAYLIST);

  // A fetch that never settles, so the only thing on screen can be the cached copy.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  void s.useChannels.getState().load();
  await vi.advanceTimersByTimeAsync(0);

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
  assert.equal(s.useChannels.getState().errorKey, "playlist.refreshFailed");
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

  await s.useChannels.getState().load(); // queues a refresh for the old playlist
  s.useSettings
    .getState()
    .addPlaylist("Second", { kind: "m3u", url: "http://list.invalid/b.m3u" });
  s.useSettings.getState().set("activePlaylistId", s.useSettings.getState().playlists[1].id);
  await s.useChannels.getState().load(true); // which this must cancel

  await afterIdle();
  assert.equal(fetchMock.mock.calls.length, 1, "the abandoned playlist came back anyway");
  assert.equal(fetchMock.mock.calls[0][0], "http://list.invalid/b.m3u");
});

test("a failed playlist switch cannot inherit channels or categories from the previous playlist", async () => {
  const s = await load();
  configure(s);
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, text: async () => PLAYLIST })
    .mockRejectedValueOnce(new Error("unauthorised"));
  vi.stubGlobal("fetch", fetchMock);
  await s.useChannels.getState().load();

  s.useSettings
    .getState()
    .addPlaylist("Wrong credentials", { kind: "m3u", url: "http://list.invalid/wrong.m3u" });
  const next = s.useSettings.getState().playlists[1];
  s.useSettings.getState().set("activePlaylistId", next.id);
  const result = await s.useChannels.getState().load(true);

  assert.equal(result.errorKey, "playlist.loadFailed");
  assert.equal(result.count, 0);
  assert.deepEqual(s.useChannels.getState().channels, []);
  assert.deepEqual(s.useChannels.getState().categories, []);
  assert.equal(s.useSettings.getState().playlists[1].categoryCount, undefined);
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
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => "" }),
  );
  assert.match((await s.useChannels.getState().load()).error, /HTTP 404/);
});

test("a playlist that parses to nothing is reported rather than shown as empty", async () => {
  const s = await load();
  configure(s);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: async () => "not a playlist" }),
  );
  assert.match((await s.useChannels.getState().load()).error, /no channels/);
});

test("validating first setup does not change the channel store", async () => {
  const s = await load();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));

  const result = await s.useChannels
    .getState()
    .validatePlaylist("News", { kind: "m3u", url: "http://list.invalid/setup.m3u" });

  assert.deepEqual(result, { count: 2, error: "" });
  assert.equal(s.useChannels.getState().channels.length, 0);
  assert.equal(s.useSettings.getState().playlists.length, 0);
});

test("the slower of two overlapping loads does not overwrite the newer one", async () => {
  const s = await load();
  configure(s);

  // The first request is slow and the second is quick, which is the order that used to lose:
  // whichever answered last won, so switching playlist twice landed on the first one asked for.
  let releaseSlow: (v: unknown) => void = () => {};
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
          releaseSlow = () => resolve({ ok: true, text: async () => PLAYLIST });
        }),
    )
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

test("an aborted Xtream authentication cannot change state owned by a newer load", async () => {
  const s = await load();
  configureXtream(s);
  let releaseNewer: (value: unknown) => void = () => {};
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      (_input: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("old authentication")));
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseNewer = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetchMock);

  const abandoned = s.useChannels.getState().load(true);
  s.useSettings.getState().addPlaylist("New", { kind: "m3u", url: "http://new.invalid/list" });
  s.useSettings.getState().set("activePlaylistId", s.useSettings.getState().playlists[1].id);
  const newer = s.useChannels.getState().load(true);
  await abandoned;

  expect(s.useChannels.getState().loading).toBe(true);
  expect(s.useChannels.getState().error).toBe("");
  releaseNewer({ ok: true, text: async () => OTHER });
  await newer;
});

test("an aborted Xtream live request cannot change state owned by a newer load", async () => {
  const s = await load();
  configureXtream(s);
  let rejectLive: ((reason: Error) => void) | undefined;
  let markLiveStarted: () => void = () => {};
  const liveStarted = new Promise<void>((resolve) => {
    markLiveStarted = resolve;
  });
  const fetchMock = xtreamFetch();
  fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.searchParams.get("action") === "get_live_streams") {
      markLiveStarted();
      return new Promise((_resolve, reject) => {
        rejectLive = reject;
        init?.signal?.addEventListener("abort", () => reject(new Error("old live")));
      });
    }
    const action = url.searchParams.get("action") ?? "authenticate";
    return xtreamResponse(
      action === "authenticate"
        ? {
            user_info: { auth: 1, status: "Active" },
            server_info: { server_protocol: "http", url: "provider.example" },
          }
        : [],
    );
  });
  vi.stubGlobal("fetch", fetchMock);

  const abandoned = s.useChannels.getState().load(true);
  await liveStarted;
  s.useSettings.getState().addPlaylist("New", { kind: "m3u", url: "http://new.invalid/list" });
  s.useSettings.getState().set("activePlaylistId", s.useSettings.getState().playlists[1].id);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  void s.useChannels.getState().load(true);
  await abandoned;

  expect(rejectLive).toBeDefined();
  expect(s.useChannels.getState().loading).toBe(true);
  expect(s.useChannels.getState().error).toBe("");
});

test("a fresh Xtream cache answers launch without network work", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  seedXtreamCache(playlist, HOUR);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const result = await s.useChannels.getState().load();

  expect(result).toEqual({ count: 1, error: "" });
  expect(s.useChannels.getState().channels[0].name).toBe("Cached News");
  await afterIdle();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a stale Xtream cache stays visible when its refresh fails", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  seedXtreamCache(playlist, 12 * HOUR);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

  expect(await s.useChannels.getState().load()).toEqual({ count: 1, error: "" });
  await afterIdle();

  expect(s.useChannels.getState().channels[0].name).toBe("Cached News");
  expect(s.useChannels.getState().error).toMatch(/Showing the last saved copy/);
});

test("a source version change cannot read an older Xtream cache", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  seedXtreamCache(playlist, HOUR);
  s.useSettings.getState().updatePlaylist(playlist.id, playlist.name, {
    ...XTREAM_SOURCE,
    password: "new-secret",
  });
  vi.stubGlobal("fetch", xtreamFetch());

  await s.useChannels.getState().load();

  expect(s.useChannels.getState().channels.map((channel) => channel.name)).toEqual([
    "Alpha",
    "Beta",
  ]);
});

test("nothing configured is not an error, it is the first run", async () => {
  const s = await load();
  const result = await s.useChannels.getState().load();
  assert.deepEqual(result, { count: 0, error: "" });
  assert.equal(s.useChannels.getState().loading, false);
});

test("favourites survive a reload and clear on request", async () => {
  const s = await load();
  const favourite = (itemKey: string) => ({
    itemKey,
    playlistId: "playlist",
    kind: "live" as const,
    providerId: itemKey,
    categoryKey: "News",
    name: itemKey,
    logo: "",
  });
  s.usePersonal.getState().toggleFavourite(favourite("alpha"));
  s.usePersonal.getState().toggleFavourite(favourite("beta"));
  assert.deepEqual(
    s.usePersonal.getState().favourites.map((item) => item.itemKey),
    ["alpha", "beta"],
  );

  s.usePersonal.getState().toggleFavourite(favourite("alpha"));
  assert.deepEqual(
    s.usePersonal.getState().favourites.map((item) => item.itemKey),
    ["beta"],
  );

  const reloaded = await load();
  assert.deepEqual(
    reloaded.usePersonal.getState().favourites.map((item) => item.itemKey),
    ["beta"],
    "not written through",
  );

  reloaded.usePersonal.getState().clearPersonal();
  assert.deepEqual(reloaded.usePersonal.getState().favourites, []);
});

test("sorting A to Z is applied to what was fetched", async () => {
  const s = await load();
  configure(s);
  s.useSettings.getState().set("sortAlphabetically", true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,Zeta
http://example.invalid/z.m3u8
#EXTINF:-1,Alpha
http://example.invalid/a.m3u8`,
    }),
  );

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

test("the sweep removes obsolete Xtream source versions and removed playlists", async () => {
  const s = await load();
  const current = configureXtream(s);
  const currentPrefix = seedXtreamCache(current, HOUR);
  disk.set(`xtream:${current.id}:v0:live`, "old version");
  disk.set("xtream:removed:v1:live", "removed playlist");
  localStorage.setItem(`openiptv.at.${currentPrefix}:movie-category:10`, "1");
  localStorage.setItem(`openiptv.at.xtream:${current.id}:v0:movie:100`, "1");
  localStorage.setItem("openiptv.at.xtream:removed:v1:live", "1");

  await s.useChannels.getState().sweep();

  expect(disk.has(`${currentPrefix}:live`)).toBe(true);
  expect(disk.has(`xtream:${current.id}:v0:live`)).toBe(false);
  expect(disk.has("xtream:removed:v1:live")).toBe(false);
  expect(localStorage.getItem(`openiptv.at.${currentPrefix}:movie-category:10`)).toBe("1");
  expect(localStorage.getItem(`openiptv.at.xtream:${current.id}:v0:movie:100`)).toBeNull();
  expect(localStorage.getItem("openiptv.at.xtream:removed:v1:live")).toBeNull();
});

test("clearing cache removes Xtream values and freshness stamps", async () => {
  const s = await load();
  const playlist = configureXtream(s);
  const prefix = seedXtreamCache(playlist, HOUR);
  localStorage.setItem(`openiptv.at.${prefix}:series:200`, "1");

  await s.clearCache();

  expect([...disk.keys()].some((key) => key.startsWith("xtream:"))).toBe(false);
  expect(localStorage.getItem(`openiptv.at.${prefix}:live`)).toBeNull();
  expect(localStorage.getItem(`openiptv.at.${prefix}:series:200`)).toBeNull();
});

test("editing a playlist's address does not serve the old one from cache", async () => {
  const s = await load();
  configure(s, "http://list.invalid/before.m3u");
  seedCache(s, PLAYLIST, 1 * HOUR); // fresh, so it would be trusted outright
  const id = s.useSettings.getState().playlists[0].id;

  // The id is unchanged, which is exactly the case that used to go wrong: the cache was
  // keyed on it, so a corrected address was answered with the previous playlist's channels
  // and a timestamp saying they were current.
  s.useSettings
    .getState()
    .updatePlaylist(id, "After", { kind: "m3u", url: "http://list.invalid/after.m3u" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => OTHER }));

  await s.useChannels.getState().load();
  assert.equal(s.useChannels.getState().channels[0].name, "Gamma", "served the old playlist");
});

test("sorting A to Z counts numbers rather than spelling them", async () => {
  const s = await load();
  configure(s);
  s.useSettings.getState().set("sortAlphabetically", true);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `#EXTM3U
#EXTINF:-1,Sport 10
http://example.invalid/10.m3u8
#EXTINF:-1,Sport 2
http://example.invalid/2.m3u8
#EXTINF:-1,Sport 1
http://example.invalid/1.m3u8`,
    }),
  );

  // Plain string ordering puts "Sport 10" before "Sport 2", which is alphabetical at the
  // viewer rather than for them. These are channel names and they are full of numbers.
  await s.useChannels.getState().load();
  expect(s.useChannels.getState().channels.map((c) => c.name)).toEqual([
    "Sport 1",
    "Sport 2",
    "Sport 10",
  ]);
});
