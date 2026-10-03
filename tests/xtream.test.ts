import { afterEach, describe, expect, test, vi } from "vitest";
import { UNCATEGORISED } from "../src/services/m3u";
import type { XtreamSource } from "../src/services/playlistUrl";
import {
  authenticateXtream,
  buildXtreamCatchupUrl,
  buildXtreamEpisodeUrl,
  buildXtreamLiveUrl,
  buildXtreamMovieUrl,
  loadXtreamCategories,
  loadXtreamGuide,
  loadXtreamLive,
  loadXtreamMovieDetail,
  loadXtreamMovies,
  loadXtreamSeries,
  loadXtreamSeriesDetail,
} from "../src/services/xtream";

const source: XtreamSource = {
  kind: "xtream",
  server: "http://api.example:8080/portal",
  username: "viewer name",
  password: "p&ss/word",
  output: "m3u8",
};

const response = (value: unknown, status = 200) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const authentication = (overrides: Record<string, unknown> = {}) => ({
  user_info: {
    auth: 1,
    status: "Active",
    exp_date: "2000000000",
    is_trial: "1",
    active_cons: "2",
    created_at: "1000000000",
    max_connections: "4",
  },
  server_info: {
    url: "media.example",
    server_protocol: "http",
    port: "8081",
    https_port: "8443",
  },
  ...overrides,
});

const authenticate = async (payload = authentication()) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response(payload));
  return authenticateXtream(source);
};

const request = (mock: ReturnType<typeof vi.spyOn>, index = 0) =>
  new URL(String(mock.mock.calls[index][0]));

const payloadByAction = (payloads: Record<string, unknown>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    return response(payloads[url.searchParams.get("action") ?? "authenticate"] ?? []);
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authentication and transport", () => {
  test("authenticates with encoded credentials and normalises account state", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response(authentication()));

    const session = await authenticateXtream(source);

    const url = request(fetch);
    expect(url.pathname).toBe("/portal/player_api.php");
    expect(url.searchParams.get("username")).toBe("viewer name");
    expect(url.searchParams.get("password")).toBe("p&ss/word");
    expect(url.searchParams.has("action")).toBe(false);
    expect(fetch).toHaveBeenCalledWith(url.toString(), {
      cache: "no-cache",
      signal: undefined,
    });
    expect(session.streamOrigin).toBe("http://media.example:8081");
    expect(session.account).toEqual({
      status: "Active",
      expiresAt: 2_000_000_000,
      isTrial: true,
      activeConnections: 2,
      createdAt: 1_000_000_000,
      maxConnections: 4,
    });
  });

  test("accepts a full URL server_info host", async () => {
    const session = await authenticate({
      ...authentication(),
      server_info: { url: "https://media.example:9443/path" },
    });

    expect(session.streamOrigin).toBe("https://media.example:9443");
  });

  test.each([
    ["bare hostname", "media.example", "http://media.example:8081"],
    ["hostname and port", "media.example:9090", "http://media.example:8081"],
    ["missing host", "", "http://api.example:8081"],
  ])("accepts a %s server_info host", async (_label, host, expected) => {
    const session = await authenticate({
      ...authentication(),
      server_info: { ...authentication().server_info, url: host },
    });

    expect(session.streamOrigin).toBe(expected);
  });

  test("falls back to the configured port when provider ports are malformed", async () => {
    const session = await authenticate({
      ...authentication(),
      server_info: {
        url: "media.example",
        server_protocol: "http",
        port: "not-a-port",
      },
    });

    expect(session.streamOrigin).toBe("http://media.example:8080");
  });

  test("upgrades API, stream, direct source and artwork addresses on an HTTPS page", async () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_live_streams: [
        {
          stream_id: 7,
          category_id: 3,
          name: "News",
          stream_icon: "http://images.example/news.png",
          direct_source: "http://direct.example/news.m3u8",
        },
      ],
    });

    const session = await authenticateXtream(source);
    const channels = await loadXtreamLive(session, "playlist-1");

    expect(request(fetch).protocol).toBe("https:");
    expect(session.streamOrigin).toBe("https://media.example:8443");
    expect(channels[0].logo).toBe("https://images.example/news.png");
    expect(channels[0].url).toBe("https://direct.example/news.m3u8");
    expect(buildXtreamLiveUrl(session, "8")).toBe(
      "https://media.example:8443/live/viewer%20name/p%26ss%2Fword/8.m3u8",
    );
  });

  test.each([
    [authentication({ user_info: { auth: 0, status: "Active" } }), "Xtream login was rejected"],
    [[], "Xtream authentication returned an invalid response"],
  ])("distinguishes authentication failures", async (payload, message) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(payload));

    await expect(authenticateXtream(source)).rejects.toThrow(message);
  });

  test.each([
    { auth: 1, status: "Disabled", exp_date: "1", is_trial: "0" },
    { auth: 1, status: "Expired", exp_date: "1", is_trial: "1" },
  ])("keeps authenticated account status informational", async (userInfo) => {
    const session = await authenticate({
      ...authentication(),
      user_info: userInfo,
    });

    expect(session.account).toMatchObject({
      status: userInfo.status,
      expiresAt: 1,
      isTrial: Number(userInfo.is_trial) === 1,
    });
  });

  test("reports malformed JSON without exposing credentials", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response("<html>failure</html>"));

    const error = await authenticateXtream(source).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Xtream returned malformed JSON");
    expect((error as Error).message).not.toContain(source.username);
    expect((error as Error).message).not.toContain(source.password);
  });

  test("rejects provider origins with unsupported schemes or user information", async () => {
    for (const url of ["ftp://media.example", "http://user@media.example"]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        response({ ...authentication(), server_info: { url } }),
      );
      await expect(authenticateXtream(source)).rejects.toThrow("invalid Xtream stream origin");
    }
  });
});

describe("catalogue normalisation", () => {
  test("loads all category endpoints, preserves names and shares the uncategorised sentinel", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_live_categories: [
        { category_id: 1, category_name: " News  " },
        "invalid",
        { category_id: 1, category_name: "Duplicate" },
        { category_id: 2, category_name: "" },
        { category_name: "Missing identifier" },
      ],
      get_vod_categories: [{ category_id: 1, category_name: " News  " }],
      get_series_categories: [{ category_id: "4", category_name: "Drama" }],
    });
    const session = await authenticateXtream(source);

    const categories = await loadXtreamCategories(session);

    expect(categories).toEqual([
      { key: "live:1", id: "1", kind: "live", name: " News  " },
      { key: "live:2", id: "2", kind: "live", name: UNCATEGORISED },
      { key: "movie:1", id: "1", kind: "movie", name: " News  " },
      { key: "series:4", id: "4", kind: "series", name: "Drama" },
    ]);
    expect(
      fetch.mock.calls
        .slice(1)
        .map((call) =>
          request(fetch, fetch.mock.calls.indexOf(call)).searchParams.get("action"),
        ),
    ).toEqual(["get_live_categories", "get_vod_categories", "get_series_categories"]);
  });

  test("loads and deduplicates live streams with provider metadata", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_live_streams: [
        {
          stream_id: 10,
          category_id: 2,
          name: "Provider Name",
          stream_icon: "http://images.example/live.png",
          num: "41",
          tv_archive_duration: "7",
          direct_source: "http://direct.example/live.ts",
        },
        { stream_id: 10, name: "Duplicate" },
        { name: "Missing identifier" },
        null,
      ],
    });
    const session = await authenticateXtream(source);

    const channels = await loadXtreamLive(session, "playlist-1");

    const url = request(fetch, 1);
    expect(url.searchParams.get("action")).toBe("get_live_streams");
    expect(channels).toEqual([
      {
        id: "xtream:playlist-1:live:10",
        name: "Provider Name",
        logo: "http://images.example/live.png",
        group: "live:2",
        url: "http://direct.example/live.ts",
        quality: "",
        number: 41,
        xtream: {
          playlistId: "playlist-1",
          streamId: "10",
          categoryKey: "live:2",
          archiveDays: 7,
          directSource: "http://direct.example/live.ts",
        },
      },
    ]);
  });

  test("loads movie and series categories through their exact endpoint parameters", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_vod_streams: [
        {
          stream_id: "20",
          category_id: "8",
          name: "Film",
          stream_icon: "http://images.example/film.jpg",
          container_extension: "mkv",
          year: 2024,
          rating: 7.5,
        },
        { stream_id: "20", name: "Duplicate" },
        [],
      ],
      get_series: [
        {
          series_id: 30,
          category_id: 9,
          name: "Series",
          cover: "http://images.example/series.jpg",
          releaseDate: "2023-01-01",
          rating: "8.1",
        },
        { name: "Missing identifier" },
      ],
    });
    const session = await authenticateXtream(source);

    const movies = await loadXtreamMovies(session, "playlist-1", "8");
    const series = await loadXtreamSeries(session, "playlist-1", "9");

    expect(request(fetch, 1).searchParams.get("category_id")).toBe("8");
    expect(request(fetch, 2).searchParams.get("category_id")).toBe("9");
    expect(movies).toEqual([
      {
        key: "xtream:playlist-1:movie:20",
        streamId: "20",
        categoryKey: "movie:8",
        name: "Film",
        logo: "http://images.example/film.jpg",
        extension: "mkv",
        year: "2024",
        rating: "7.5",
      },
    ]);
    expect(series).toEqual([
      {
        key: "xtream:playlist-1:series:30",
        seriesId: "30",
        categoryKey: "series:9",
        name: "Series",
        logo: "http://images.example/series.jpg",
        year: "2023",
        rating: "8.1",
      },
    ]);
  });
});

describe("details and programme data", () => {
  test("loads movie details through vod_id", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_vod_info: {
        info: {
          name: "Film",
          movie_image: "http://images.example/film.jpg",
          plot: "Plot",
          cast: "Cast",
          director: "Director",
          genre: "Drama",
          releasedate: "2024-03-02",
          duration_secs: "5400",
          rating: "7.2",
        },
        movie_data: { stream_id: 20, category_id: 8, container_extension: "mkv", year: 2024 },
      },
    });
    const session = await authenticateXtream(source);

    const detail = await loadXtreamMovieDetail(session, "playlist-1", "20");

    expect(request(fetch, 1).searchParams.get("vod_id")).toBe("20");
    expect(detail).toEqual({
      key: "xtream:playlist-1:movie:20",
      streamId: "20",
      categoryKey: "movie:8",
      name: "Film",
      logo: "http://images.example/film.jpg",
      extension: "mkv",
      year: "2024",
      rating: "7.2",
      plot: "Plot",
      cast: "Cast",
      director: "Director",
      genre: "Drama",
      releaseDate: "2024-03-02",
      durationSeconds: 5400,
    });
  });

  test("reads series episodes by season key and keeps the first episode identifier", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_series_info: {
        info: {
          name: "Series",
          category_id: 9,
          cover: "http://images.example/series.jpg",
          plot: "Series plot",
          genre: "Drama",
          releaseDate: "2023-04-05",
          rating: "8.4",
        },
        episodes: {
          "2": [
            {
              id: 301,
              episode_num: 3,
              title: "Third",
              container_extension: "mp4",
              info: { duration_secs: "1800" },
            },
            { id: 301, episode_num: 4, title: "Duplicate" },
            { title: "Missing identifier" },
          ],
          invalid: [{ id: 302, title: "Invalid season" }],
          "1": [{ id: 300, episode_num: 1, title: "First", container_extension: "mkv" }],
        },
      },
    });
    const session = await authenticateXtream(source);

    const detail = await loadXtreamSeriesDetail(session, "playlist-1", "30");

    expect(request(fetch, 1).searchParams.get("series_id")).toBe("30");
    expect(detail.episodes).toEqual([
      {
        key: "xtream:playlist-1:episode:300",
        episodeId: "300",
        seriesKey: "xtream:playlist-1:series:30",
        season: 1,
        number: 1,
        name: "First",
        extension: "mkv",
      },
      {
        key: "xtream:playlist-1:episode:301",
        episodeId: "301",
        seriesKey: "xtream:playlist-1:series:30",
        season: 2,
        number: 3,
        name: "Third",
        extension: "mp4",
        durationSeconds: 1800,
      },
    ]);
    expect(detail.name).toBe("Series");
  });

  test("loads short EPG with limit 20 and decodes valid base64 with supplied text fallback", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_short_epg: {
        epg_listings: [
          {
            id: 1,
            title: btoa("Morning News"),
            description: btoa("Headlines"),
            start: "2026-10-02 08:00:00",
            end: "2026-10-02 09:00:00",
            start_timestamp: "1790928000",
            stop_timestamp: "1790931600",
            has_archive: 1,
          },
          {
            id: 2,
            title: "News",
            description: "Supplied description",
            start: "2026-10-02 09:00:00",
            end: "2026-10-02 10:00:00",
            has_archive: 0,
          },
          "invalid",
        ],
      },
    });
    const session = await authenticateXtream(source);

    const programmes = await loadXtreamGuide(session, "10");

    const url = request(fetch, 1);
    expect(url.searchParams.get("stream_id")).toBe("10");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(programmes[0]).toMatchObject({
      id: "1",
      title: "Morning News",
      description: "Headlines",
      startTimestamp: 1_790_928_000,
      stopTimestamp: 1_790_931_600,
      archived: true,
    });
    expect(programmes[1]).toMatchObject({
      title: "News",
      description: "Supplied description",
      archived: false,
    });
  });
});

describe("stream address builders", () => {
  test("encodes each path value and uses the exact provider paths", async () => {
    const session = await authenticate();

    expect(buildXtreamLiveUrl(session, "live/id")).toBe(
      "http://media.example:8081/live/viewer%20name/p%26ss%2Fword/live%2Fid.m3u8",
    );
    expect(buildXtreamMovieUrl(session, "movie/id", "m k/v")).toBe(
      "http://media.example:8081/movie/viewer%20name/p%26ss%2Fword/movie%2Fid.m%20k%2Fv",
    );
    expect(buildXtreamEpisodeUrl(session, "episode/id", "mp4")).toBe(
      "http://media.example:8081/series/viewer%20name/p%26ss%2Fword/episode%2Fid.mp4",
    );
    expect(buildXtreamCatchupUrl(session, "live/id", 90, "2026-10-02 08:05:00")).toBe(
      "http://media.example:8081/timeshift/viewer%20name/p%26ss%2Fword/90/2026-10-02:08-05/live%2Fid.ts",
    );
  });
});
