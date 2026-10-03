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
  hiddenCategoryMode: "exclude",
});

const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

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
