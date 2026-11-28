import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { XtreamSource } from "../src/services/playlistUrl";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

const disk = new Map<string, string | Blob>();

const source: XtreamSource = {
  kind: "xtream",
  server: "http://provider.example",
  username: "viewer",
  password: "secret",
  output: "m3u8",
};

const playlist = (id = "pl-1", sourceVersion = 1): Playlist => ({
  id,
  name: "Provider",
  source,
  sourceVersion,
  hiddenCategories: [],
});

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const provider = (overrides: Record<string, unknown> = {}) =>
  vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const defaults: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [],
      get_vod_categories: [{ category_id: "10", category_name: "Provider Movies" }],
      get_series_categories: [{ category_id: "20", category_name: "Provider Series" }],
      get_vod_streams: [
        {
          stream_id: "100",
          category_id: "10",
          name: "Provider Movie Name",
          container_extension: "mp4",
        },
      ],
      get_series: [{ series_id: "200", category_id: "20", name: "Provider Series Name" }],
      get_vod_info: {
        info: { name: "Provider Movie Name", plot: "Movie plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
      get_series_info: {
        info: { name: "Provider Series Name", category_id: "20" },
        episodes: {
          "2": [
            { id: "202", episode_num: 1, title: "Second season", container_extension: "mkv" },
          ],
          "1": [{ id: "201", episode_num: 1, title: "Pilot", container_extension: "mp4" }],
        },
      },
    };
    return response(action in overrides ? overrides[action] : defaults[action]);
  });

async function loadStore() {
  vi.resetModules();
  vi.doMock("../src/services/disk", () => ({
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: string | Blob) => {
      disk.set(key, value);
      return true;
    },
  }));
  return import("../src/stores/library");
}

beforeEach(() => {
  localStorage.clear();
  disk.clear();
  vi.unstubAllGlobals();
});

afterEach(() => vi.useRealTimers());

test("movie and series categories authenticate lazily and preserve provider names", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();

  useLibrary.getState().selectPlaylist(playlist());
  expect(fetch).not.toHaveBeenCalled();

  await useLibrary.getState().loadCategories("movie");
  expect(useLibrary.getState().categories.movie).toMatchObject({
    state: "loaded",
    items: [{ key: "movie:10", name: "Provider Movies" }],
  });

  await useLibrary.getState().loadCategories("series");
  expect(useLibrary.getState().categories.series).toMatchObject({
    state: "loaded",
    items: [{ key: "series:20", name: "Provider Series" }],
  });
  expect(
    fetch.mock.calls.filter(([input]) => !new URL(String(input)).searchParams.get("action")),
  ).toHaveLength(1);
});

test("cached category metadata hydrates Movie and Series together", async () => {
  const key = "xtream:pl-1:v1:categories";
  disk.set(
    key,
    JSON.stringify([
      { key: "movie:10", id: "10", kind: "movie", name: "Movies" },
      { key: "series:20", id: "20", kind: "series", name: "Series" },
    ]),
  );
  localStorage.setItem(`openiptv.at.${key}`, String(Date.now()));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategories("movie");

  expect(useLibrary.getState().categories.movie.state).toBe("loaded");
  expect(useLibrary.getState().categories.series.state).toBe("loaded");
  expect(fetch).not.toHaveBeenCalled();
});

test("a complete index supplies missing provider category counts without category requests", async () => {
  const fetch = provider({
    get_vod_categories: [
      { category_id: "10", category_name: "Provider Movies" },
      { category_id: "11", category_name: "Empty Movies" },
    ],
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategories("movie");
  expect(
    useLibrary
      .getState()
      .categoriesFor("movie")
      .find((row) => row.key === "movie:10")?.count,
  ).toBeUndefined();

  await useLibrary.getState().loadIndex("movie", "all");

  const rows = useLibrary.getState().categoriesFor("movie");
  expect(rows.find((row) => row.key === "movie:10")?.count).toBe(1);
  expect(rows.find((row) => row.key === "movie:11")?.count).toBe(0);
  expect(useLibrary.getState().itemsFor("movie", "movie:10").value).toMatchObject([
    { name: "Provider Movie Name" },
  ]);
  await useLibrary.getState().loadCategory("movie:10");
  const categoryRequests = fetch.mock.calls.filter(([input]) =>
    new URL(String(input)).searchParams.has("category_id"),
  );
  expect(categoryRequests).toHaveLength(0);
});

test("a loaded category frame supplies its own badge count without requests", async () => {
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategories("movie");
  const badge = () =>
    useLibrary
      .getState()
      .categoriesFor("movie")
      .find((row) => row.key === "movie:10")?.count;
  expect(badge()).toBeUndefined();

  await useLibrary.getState().loadCategory("movie:10");

  expect(badge()).toBe(1);
  const calls = fetch.mock.calls.length;
  expect(badge()).toBe(1);
  expect(fetch.mock.calls.length).toBe(calls);
});

test("a failed complete index falls back to category loading", async () => {
  const fallback = provider();
  const fetch = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (
      url.searchParams.get("action") === "get_vod_streams" &&
      !url.searchParams.has("category_id")
    ) {
      return new Response("unavailable", { status: 503 });
    }
    return fallback(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadIndex("movie", "all");
  await useLibrary.getState().loadCategory("movie:10");

  expect(useLibrary.getState().itemsFor("movie", "movie:10")).toMatchObject({
    state: "loaded",
    value: [{ name: "Provider Movie Name" }],
  });
  expect(
    fetch.mock.calls.some(([input]) => new URL(String(input)).searchParams.has("category_id")),
  ).toBe(true);
});

test("duplicate requests share one category load and remember an empty category", async () => {
  const fetch = provider({ get_vod_streams: [] });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await Promise.all([
    useLibrary.getState().loadCategories("movie"),
    useLibrary.getState().loadCategories("movie"),
  ]);
  await Promise.all([
    useLibrary.getState().loadCategory("movie:10"),
    useLibrary.getState().loadCategory("movie:10"),
  ]);
  await useLibrary.getState().loadCategory("movie:10");

  expect(
    fetch.mock.calls.filter(
      ([input]) => new URL(String(input)).searchParams.get("action") === "get_vod_streams",
    ),
  ).toHaveLength(1);
  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "empty",
    items: [],
  });
});

test("switching playlists cancels older writes", async () => {
  let settleMovies: ((value: ReturnType<typeof response>) => void) | undefined;
  const fetch = provider();
  fetch.mockImplementation(async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams") {
      return new Promise<ReturnType<typeof response>>((resolve) => {
        settleMovies = resolve;
      });
    }
    return provider()(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist("old"));
  await useLibrary.getState().loadCategories("movie");
  const pending = useLibrary.getState().loadCategory("movie:10");

  useLibrary.getState().selectPlaylist(playlist("new"));
  settleMovies?.(response([{ stream_id: "100", category_id: "10", name: "Old Movie" }]));
  await pending;

  expect(useLibrary.getState().playlistId).toBe("new");
  expect(useLibrary.getState().categoryItems["movie:10"]).toBeUndefined();
});

test("canceling a guide during authentication does not fail a concurrent category load", async () => {
  let authenticationRequests = 0;
  let authenticationSignal: AbortSignal | null = null;
  let settleAuthentication: ((value: ReturnType<typeof response>) => void) | undefined;
  const live = (streamId: string): Channel => ({
    id: `xtream:pl-1:live:${streamId}`,
    name: `Live ${streamId}`,
    logo: "",
    group: "live:1",
    url: `http://provider.example/live/${streamId}.m3u8`,
    quality: "",
    number: Number(streamId),
    xtream: {
      playlistId: "pl-1",
      streamId,
      categoryKey: "live:1",
      archiveDays: 0,
      directSource: "",
    },
  });
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "authenticate") {
      authenticationRequests += 1;
      if (authenticationRequests === 1) {
        authenticationSignal = init?.signal ?? null;
        return new Promise<ReturnType<typeof response>>((resolve, reject) => {
          settleAuthentication = resolve;
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort);
        });
      }
      return response({
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      });
    }
    if (action === "get_vod_streams") {
      return response([
        {
          stream_id: "100",
          category_id: "10",
          name: "Provider Movie Name",
          container_extension: "mp4",
        },
      ]);
    }
    if (action === "get_short_epg") return response({ epg_listings: [] });
    return response([]);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  const abandonedGuide = useLibrary.getState().loadGuide(live("1"));
  await Promise.resolve();
  const category = useLibrary.getState().loadCategory("movie:10");
  await Promise.resolve();
  await Promise.resolve();
  expect(authenticationRequests).toBe(1);

  const currentGuide = useLibrary.getState().loadGuide(live("2"));
  expect(authenticationSignal?.aborted).toBe(false);
  settleAuthentication?.(
    response({
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    }),
  );
  await Promise.all([abandonedGuide, category, currentGuide]);

  expect(authenticationRequests).toBe(1);
  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "loaded",
    items: [{ name: "Provider Movie Name" }],
  });
});

test("a movie category failure is isolated and Retry reloads only that frame", async () => {
  let fail = true;
  const fetch = provider();
  fetch.mockImplementation(async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams" && fail) {
      fail = false;
      throw new Error("Movies unavailable");
    }
    return provider()(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("movie");
  await useLibrary.getState().loadCategories("series");
  await useLibrary.getState().loadCategory("movie:10");

  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({ state: "failed" });
  expect(useLibrary.getState().categories.series.state).toBe("loaded");

  await useLibrary.getState().retry("movie:10");
  expect(useLibrary.getState().categoryItems["movie:10"].state).toBe("loaded");
});

test("versioned category cache is reused without a list request", async () => {
  disk.set(
    "xtream:pl-1:v1:movie-category:10",
    JSON.stringify([
      {
        key: "xtream:pl-1:movie:100",
        streamId: "100",
        categoryKey: "movie:10",
        name: "Cached Provider Name",
        logo: "",
        extension: "mp4",
        year: "",
        rating: "",
      },
    ]),
  );
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategory("movie:10");

  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "loaded",
    items: [{ name: "Cached Provider Name" }],
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("fresh category and detail cache entries avoid network work", async () => {
  const prefix = "xtream:pl-1:v1";
  const categoryKey = `${prefix}:movie-category:10`;
  const detailKey = `${prefix}:movie:100`;
  disk.set(
    categoryKey,
    JSON.stringify([
      {
        key: "xtream:pl-1:movie:100",
        streamId: "100",
        categoryKey: "movie:10",
        name: "Cached Provider Name",
        logo: "",
        extension: "mp4",
        year: "",
        rating: "",
      },
    ]),
  );
  disk.set(
    detailKey,
    JSON.stringify({
      key: "xtream:pl-1:movie:100",
      streamId: "100",
      categoryKey: "movie:10",
      name: "Cached Provider Name",
      logo: "",
      extension: "mp4",
      year: "",
      rating: "",
      plot: "Cached plot",
      cast: "",
      director: "",
      genre: "",
      releaseDate: "",
    }),
  );
  localStorage.setItem(`openiptv.at.${categoryKey}`, String(Date.now()));
  localStorage.setItem(`openiptv.at.${detailKey}`, String(Date.now()));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");

  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"].value?.plot).toBe(
    "Cached plot",
  );
  expect(fetch).not.toHaveBeenCalled();
});

test("stale category and detail cache entries render first and refresh once while idle", async () => {
  vi.useFakeTimers();
  const prefix = "xtream:pl-1:v1";
  const categoryKey = `${prefix}:movie-category:10`;
  const detailKey = `${prefix}:movie:100`;
  disk.set(
    categoryKey,
    JSON.stringify([
      {
        key: "xtream:pl-1:movie:100",
        streamId: "100",
        categoryKey: "movie:10",
        name: "Stale movie",
        logo: "",
        extension: "mp4",
        year: "",
        rating: "",
      },
    ]),
  );
  disk.set(
    detailKey,
    JSON.stringify({
      key: "xtream:pl-1:movie:100",
      streamId: "100",
      categoryKey: "movie:10",
      name: "Stale movie",
      logo: "",
      extension: "mp4",
      year: "",
      rating: "",
      plot: "Stale plot",
      cast: "",
      director: "",
      genre: "",
      releaseDate: "",
    }),
  );
  const old = Date.now() - 7 * 60 * 60 * 1000;
  localStorage.setItem(`openiptv.at.${categoryKey}`, String(old));
  localStorage.setItem(`openiptv.at.${detailKey}`, String(old));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");
  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");

  expect(useLibrary.getState().categoryItems["movie:10"].items[0].name).toBe("Stale movie");
  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"].value?.plot).toBe(
    "Stale plot",
  );
  expect(fetch).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(500);

  expect(useLibrary.getState().categoryItems["movie:10"].items[0].name).toBe(
    "Provider Movie Name",
  );
  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"].value?.plot).toBe(
    "Movie plot",
  );
  const actions = fetch.mock.calls.map(([input]) =>
    new URL(String(input)).searchParams.get("action"),
  );
  expect(actions.filter((action) => action === "get_vod_streams")).toHaveLength(1);
  expect(actions.filter((action) => action === "get_vod_info")).toHaveLength(1);
});

test("cached series details normalise legacy season order before publishing", async () => {
  const key = "xtream:pl-1:v1:series:200";
  disk.set(
    key,
    JSON.stringify({
      key: "xtream:pl-1:series:200",
      seriesId: "200",
      episodes: [],
      seasons: [0, 1, 2, "unassigned"],
    }),
  );
  localStorage.setItem(`openiptv.at.${key}`, String(Date.now()));
  const fetch = provider();
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");

  expect(useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value?.seasons).toEqual([
    1,
    2,
    0,
    "unassigned",
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

test("movie details and series seasons and episodes are cached independently", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("movie");
  await useLibrary.getState().loadCategory("movie:10");
  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");

  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"]).toMatchObject({
    state: "loaded",
    value: { name: "Provider Movie Name", plot: "Movie plot" },
  });

  await useLibrary.getState().loadCategories("series");
  await useLibrary.getState().loadCategory("series:20");
  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");
  const detail = useLibrary.getState().seriesDetails["xtream:pl-1:series:200"];
  expect(detail).toMatchObject({ state: "loaded", value: { name: "Provider Series Name" } });
  expect(detail.value?.episodes.map((episode) => [episode.season, episode.name])).toEqual([
    [1, "Pilot"],
    [2, "Second season"],
  ]);
  expect(disk.has("xtream:pl-1:v1:movie:100")).toBe(true);
  expect(disk.has("xtream:pl-1:v1:series:200")).toBe(true);
});

test("resolved Continue progress opens details before its category or favourites load", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [
        {
          itemKey: "xtream:pl-1:movie:100",
          playlistId: "pl-1",
          kind: "movie",
          providerId: "100",
          categoryKey: "movie:10",
          seconds: 30,
          updatedAt: 1,
          name: "Continued movie",
          logo: "",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");

  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"].state).toBe("loaded");
  expect(useLibrary.getState().categoryItems["movie:10"]).toBeUndefined();
});

test("a resolved Series episode locates its parent details before categories load", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [
        {
          itemKey: "xtream:pl-1:episode:201",
          playlistId: "pl-1",
          kind: "episode",
          providerId: "201",
          episodeIdentity: "201",
          categoryKey: "series:20",
          seconds: 30,
          updatedAt: 1,
          name: "Pilot",
          logo: "",
          parentKey: "xtream:pl-1:series:200",
          parentProviderId: "200",
          parentName: "Provider Series Name",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");

  expect(useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].state).toBe("loaded");
  expect(useLibrary.getState().categoryItems["series:20"]).toBeUndefined();
});

test("a favourite snapshot opens details before its category has loaded", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [
        {
          itemKey: "xtream:pl-1:movie:100",
          playlistId: "pl-1",
          kind: "movie",
          providerId: "100",
          categoryKey: "movie:10",
          name: "Saved Provider Name",
          logo: "",
          extension: "mp4",
        },
      ],
      lastPlayed: null,
      progress: [],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadMovie("xtream:pl-1:movie:100");

  expect(useLibrary.getState().movieDetails["xtream:pl-1:movie:100"].state).toBe("loaded");
  expect(useLibrary.getState().categoryItems["movie:10"]).toBeUndefined();
});

test("a complete movie index resolves legacy movie progress and drops absent entries", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [
        { itemKey: "xtream:pl-1:movie:100", seconds: 20 },
        { itemKey: "xtream:pl-1:movie:999", seconds: 30 },
        { itemKey: "xtream:pl-1:episode:201", seconds: 40 },
      ],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadSearch("movie");

  expect(usePersonal.getState().progressFor("xtream:pl-1:movie:100")).toMatchObject({
    kind: "movie",
    playlistId: "pl-1",
    providerId: "100",
    categoryKey: "movie:10",
    name: "Provider Movie Name",
    seconds: 20,
  });
  // The index is authoritative for movies: an entry it does not contain is gone.
  expect(usePersonal.getState().progressFor("xtream:pl-1:movie:999")).toBeUndefined();
  // An episode is not a movie, so a movie index cannot prove it absent.
  expect(usePersonal.getState().progressFor("xtream:pl-1:episode:201")).toMatchObject({
    seconds: 40,
    legacyOrder: 2,
  });
});

test("a series detail resolves the legacy episode records it contains", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [
        { itemKey: "xtream:pl-1:episode:201", seconds: 45 },
        { itemKey: "xtream:pl-1:episode:999", seconds: 60 },
      ],
    }),
  );
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("series");
  await useLibrary.getState().loadCategory("series:20");

  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");

  expect(usePersonal.getState().progressFor("xtream:pl-1:episode:1:201")).toMatchObject({
    kind: "episode",
    providerId: "201",
    categoryKey: "series:20",
    parentProviderId: "200",
    parentName: "Provider Series Name",
    season: 1,
    episode: 1,
    seconds: 45,
  });
  // One series cannot prove another series' episode absent, so the record stays legacy.
  expect(usePersonal.getState().progressFor("xtream:pl-1:episode:999")).toMatchObject({
    seconds: 60,
    legacyOrder: 1,
  });
});

test("synthetic categories follow Continue and Favourites before provider order without All", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadCategories("movie");
  usePersonal.getState().toggleFavourite({
    itemKey: "xtream:pl-1:movie:100",
    playlistId: "pl-1",
    kind: "movie",
    providerId: "100",
    categoryKey: "movie:10",
    name: "Saved movie",
    logo: "",
  });
  usePersonal.getState().rememberProgress(
    {
      itemKey: "xtream:pl-1:movie:101",
      playlistId: "pl-1",
      kind: "movie",
      providerId: "101",
      categoryKey: "movie:10",
      name: "Continued movie",
      logo: "",
    },
    30,
    100,
    "pause",
    200,
  );

  expect(
    useLibrary
      .getState()
      .categoriesFor("movie")
      .map((row) => row.source),
  ).toEqual(["continue", "favourites", "provider"]);
  expect(useLibrary.getState().itemsFor("movie", "movie:continue").value[0]).toMatchObject({
    name: "Continued movie",
  });
});

test("a direct source only movie stays playable and creates credential free progress", async () => {
  vi.stubGlobal(
    "fetch",
    provider({
      get_vod_streams: [
        {
          category_id: "10",
          name: "Direct movie",
          direct_source: "http://files.example/direct.mkv",
        },
      ],
    }),
  );
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadIndex("movie", "all");
  const movie = useLibrary.getState().searchItems.movie.items[0];
  expect(movie).toMatchObject({
    streamId: "",
    directSource: "http://files.example/direct.mkv",
  });
  if (!("streamId" in movie)) throw new Error("Expected a Movie summary");

  const seed = useLibrary.getState().progressSeedFor(movie);
  expect(seed).toMatchObject({ kind: "movie", directSourceFingerprint: expect.any(String) });
  expect(seed?.providerId).toBeUndefined();
  expect(JSON.stringify(seed)).not.toContain("files.example");

  await useLibrary.getState().loadMovie(movie.key);
  expect(useLibrary.getState().movieDetails[movie.key]).toMatchObject({
    state: "loaded",
    value: { name: "Direct movie", directSource: "http://files.example/direct.mkv" },
  });
});

test("a relative episode source resolves against the provider stream origin", async () => {
  vi.stubGlobal(
    "fetch",
    provider({
      get_series_info: {
        info: { name: "Fixture Series", category_id: "20" },
        episodes: {
          "2": [
            {
              id: "episode-2-1",
              episode_num: 1,
              title: "Episode 2.1",
              container_extension: "mp4",
              direct_source: "/fixture/playback/episode-2-1.mp4",
            },
          ],
        },
      },
    }),
  );
  const { libraryPlaybackUrl, useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");
  const episode =
    useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value?.episodes[0];
  if (!episode) throw new Error("Fixture episode missing");

  expect(episode.directSource).toBe("http://provider.example/fixture/playback/episode-2-1.mp4");
  await expect(libraryPlaybackUrl(episode)).resolves.toBe(
    "http://provider.example/fixture/playback/episode-2-1.mp4",
  );
});

test("progress seeds retain episode identity without retaining a direct source", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");
  const detail = useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value;
  const episode = detail?.episodes[0];
  const seed =
    episode && detail ? useLibrary.getState().progressSeedFor(episode, detail) : null;

  expect(seed).toMatchObject({
    kind: "episode",
    providerId: "201",
    parentProviderId: "200",
    season: 1,
    episode: 1,
  });
  expect(JSON.stringify(seed)).not.toContain("directSource");
});

test("Series Continue resumes progress and manual episode choice remains separate", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");
  const detail = useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value;
  expect(detail).toBeDefined();
  const episode = detail?.episodes[0];
  const seed =
    episode && detail ? useLibrary.getState().progressSeedFor(episode, detail) : null;
  if (seed) usePersonal.getState().rememberProgress(seed, 45, 120, "pause", 300);

  expect(detail && useLibrary.getState().seriesContinueFor(detail, null)).toMatchObject({
    episode: { key: episode?.key },
    resumeAt: 45,
    remainingSeconds: 75,
    reason: "resume",
  });
});

test("a completed episode advances Continue to the next playable episode", async () => {
  vi.stubGlobal("fetch", provider());
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());
  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");
  const detail = useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value;
  const first = detail?.episodes[0];
  if (!detail || !first) throw new Error("Series fixture missing first episode");
  const second = {
    ...first,
    key: "xtream:pl-1:episode:1:202",
    episodeId: "202",
    episodeIdentity: "202",
    number: 2,
    name: "Next episode",
  };
  const expanded = { ...detail, episodes: [first, second] };
  usePersonal.getState().rememberLast({
    playlistId: "pl-1",
    kind: "episode",
    itemKey: first.key,
    categoryKey: detail.categoryKey,
  });
  usePersonal.getState().completeProgress(first.key);

  expect(
    useLibrary.getState().seriesContinueFor(expanded, usePersonal.getState().lastPlayed),
  ).toMatchObject({ episode: { key: second.key }, resumeAt: 0, reason: "next" });
});

test("an idless episode resolves progress through its direct source fingerprint", async () => {
  const { directSourceFingerprint } = await import("../src/services/xtream");
  const fingerprint = directSourceFingerprint("http://files.example/e1.mkv") ?? "";
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [{ itemKey: `xtream:pl-1:episode:${fingerprint}`, seconds: 45 }],
    }),
  );
  vi.stubGlobal(
    "fetch",
    provider({
      get_series_info: {
        info: { name: "Provider Series Name" },
        episodes: {
          "1": [
            {
              episode_num: 1,
              title: "Unnumbered",
              direct_source: "http://files.example/e1.mkv",
            },
          ],
        },
      },
    }),
  );
  const { useLibrary } = await loadStore();
  const { usePersonal } = await import("../src/stores/personal");
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadSeries("xtream:pl-1:series:200");

  const detail = useLibrary.getState().seriesDetails["xtream:pl-1:series:200"].value;
  const episode = detail?.episodes[0];
  expect(episode?.episodeId).toBeUndefined();
  expect(episode?.episodeIdentity).toBe(fingerprint);
  expect(usePersonal.getState().progressFor(episode?.key ?? "")).toMatchObject({
    kind: "episode",
    directSourceFingerprint: fingerprint,
    categoryKey: "series:__none__",
    seconds: 45,
  });
});

test("an oversized complete index lands in the terminal too large state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const action = new URL(String(input)).searchParams.get("action");
      if (action === "get_vod_streams") {
        return new Response("", {
          status: 200,
          headers: { "Content-Length": String(129 * 1024 * 1024) },
        });
      }
      return response({
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      });
    }),
  );
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  await useLibrary.getState().loadSearch("movie");

  expect(useLibrary.getState().searchItems.movie.state).toBe("too-large");
});

test("a second category load joins the in-flight frame instead of settling early", async () => {
  let settleMovies: ((value: Response) => void) | undefined;
  const fetch = provider();
  fetch.mockImplementation(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams" && url.searchParams.has("category_id")) {
      return new Promise<Response>((resolve) => {
        settleMovies = resolve;
      });
    }
    return provider()(input);
  });
  vi.stubGlobal("fetch", fetch);
  const { useLibrary } = await loadStore();
  useLibrary.getState().selectPlaylist(playlist());

  const first = useLibrary.getState().loadCategory("movie:10");
  expect(useLibrary.getState().categoryItems["movie:10"]?.state).toBe("loading");
  const second = useLibrary.getState().loadCategory("movie:10");

  let secondSettled = false;
  void second.then(() => {
    secondSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(secondSettled).toBe(false);

  await vi.waitFor(() => expect(typeof settleMovies).toBe("function"));
  settleMovies?.(
    response([
      {
        stream_id: "100",
        category_id: "10",
        name: "Joined Movie",
        container_extension: "mp4",
      },
    ]),
  );
  await Promise.all([first, second]);
  expect(secondSettled).toBe(true);
  expect(useLibrary.getState().categoryItems["movie:10"]).toMatchObject({
    state: "loaded",
    items: [{ name: "Joined Movie" }],
  });
});
