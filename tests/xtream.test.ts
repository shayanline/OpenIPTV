import { afterEach, describe, expect, test, vi } from "vitest";
import type { XtreamSource } from "../src/services/playlistUrl";
import {
  authenticateXtream,
  formatEpisodePlaybackName,
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
  searchXtreamCatalogue,
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

test("formats episode playback names with show and episode context", () => {
  expect(formatEpisodePlaybackName("Brothers", "Pilot", 1, 2)).toBe(
    "Brothers · S01 E02 · Pilot",
  );
  expect(formatEpisodePlaybackName("Brothers", "Pilot")).toBe("Brothers · Pilot");
  expect(formatEpisodePlaybackName(undefined, "Pilot", 1, 2)).toBe("S01 E02 · Pilot");
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
    const signal = fetch.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(fetch).toHaveBeenCalledWith(url.toString(), {
      cache: "no-cache",
      signal,
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
    expect((error as Error).message).toBe("The provider returned malformed JSON");
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
  test("loads all category endpoints, trims names and preserves empty provider values", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_live_categories: [
        { category_id: 1, category_name: " News  " },
        "invalid",
        { category_id: 1, category_name: "Duplicate" },
        { category_id: 2, category_name: "" },
        { category_id: 3, category_name: "Uncategorised" },
        { category_name: "Missing identifier" },
      ],
      get_vod_categories: [{ category_id: 1, category_name: " News  " }],
      get_series_categories: [{ category_id: "4", category_name: "Drama" }],
    });
    const session = await authenticateXtream(source);

    const categories = await loadXtreamCategories(session);

    expect(categories).toEqual([
      { key: "live:1", id: "1", kind: "live", name: "News" },
      { key: "live:2", id: "2", kind: "live", name: "" },
      { key: "live:3", id: "3", kind: "live", name: "Uncategorised" },
      { key: "movie:1", id: "1", kind: "movie", name: "News" },
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

  test("preserves live provider numbers, duplicates and order with positional fallback", async () => {
    payloadByAction({
      authenticate: authentication(),
      get_live_streams: [
        { stream_id: 1, num: 88 },
        { stream_id: 2, num: " 0002 " },
        { stream_id: 2, num: 700 },
        { num: 800 },
        { stream_id: 3, num: "2" },
        { stream_id: 4 },
        { stream_id: 5, num: 10001 },
        { stream_id: 6, num: "10002" },
        { stream_id: 7, num: 9007199254740991 },
        { stream_id: 8, num: "9007199254740991" },
        { stream_id: 9 },
      ],
    });
    const session = await authenticateXtream(source);

    const channels = await loadXtreamLive(session, "playlist-1");

    expect(channels.map((channel) => [channel.xtream?.streamId, channel.number])).toEqual([
      ["1", 88],
      ["2", 2],
      ["3", 2],
      ["4", 4],
      ["5", 10001],
      ["6", 10002],
      ["7", 9007199254740991],
      ["8", 9007199254740991],
      ["9", 9],
    ]);
  });

  test.each([
    ["missing", undefined],
    ["null", null],
    ["blank", " "],
    ["zero", 0],
    ["zero string", "0"],
    ["negative", -1],
    ["fraction", 41.9],
    ["fraction string", "41.9"],
    ["exponent string", "1e3"],
    ["hexadecimal string", "0x29"],
    ["unsafe integer", 9007199254740992],
    ["unsafe integer string", "9007199254740993"],
    ["boolean", true],
    ["array", [41]],
    ["object", {}],
    ["nonfinite string", "Infinity"],
  ])(
    "a %s live number falls back to position without affecting later entries",
    async (_label, num) => {
      payloadByAction({
        authenticate: authentication(),
        get_live_streams: [{ stream_id: 1, num: 88 }, { stream_id: 2, num }, { stream_id: 3 }],
      });
      const session = await authenticateXtream(source);

      const channels = await loadXtreamLive(session, "playlist-1");

      expect(channels.map((channel) => channel.number)).toEqual([88, 2, 3]);
    },
  );

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
        directSource: "",
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
      directSource: "",
      metadata: {
        backdrops: [],
        rating: "7.2",
        cast: ["Cast"],
        director: "Director",
        genre: "Drama",
        releaseDate: "2024-03-02",
        country: "",
        ageRating: "",
      },
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
        key: "xtream:playlist-1:episode:1:300",
        episodeIdentity: "300",
        episodeId: "300",
        directSource: "",
        seriesKey: "xtream:playlist-1:series:30",
        seasonKey: 1,
        season: 1,
        number: 1,
        name: "First",
        extension: "mkv",
        providerOrder: 0,
        metadata: { rating: "", plot: "", releaseDate: "", image: "" },
      },
      {
        key: "xtream:playlist-1:episode:2:301",
        episodeIdentity: "301",
        episodeId: "301",
        directSource: "",
        seriesKey: "xtream:playlist-1:series:30",
        seasonKey: 2,
        season: 2,
        number: 3,
        name: "Third",
        extension: "mp4",
        durationSeconds: 1800,
        providerOrder: 1,
        metadata: {
          rating: "",
          plot: "",
          releaseDate: "",
          image: "",
          durationSeconds: 1800,
        },
      },
      {
        key: "xtream:playlist-1:episode:2:s2:e:Missing identifier:2",
        episodeIdentity: "s2:e:Missing identifier:2",
        directSource: "",
        seriesKey: "xtream:playlist-1:series:30",
        seasonKey: 2,
        season: 2,
        name: "Missing identifier",
        providerOrder: 2,
        metadata: { rating: "", plot: "", releaseDate: "", image: "" },
      },
      {
        key: "xtream:playlist-1:episode:u:302",
        episodeIdentity: "302",
        episodeId: "302",
        directSource: "",
        seriesKey: "xtream:playlist-1:series:30",
        seasonKey: "unassigned",
        name: "Invalid season",
        providerOrder: 3,
        metadata: { rating: "", plot: "", releaseDate: "", image: "" },
      },
    ]);
    expect(detail.seasons).toEqual([1, 2, "unassigned"]);
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
    expect(buildXtreamMovieUrl(session, "movie/id")).toBe(
      "http://media.example:8081/movie/viewer%20name/p%26ss%2Fword/movie%2Fid",
    );
    expect(buildXtreamEpisodeUrl(session, "episode/id")).toBe(
      "http://media.example:8081/series/viewer%20name/p%26ss%2Fword/episode%2Fid",
    );
    expect(buildXtreamCatchupUrl(session, "live/id", 90, "2026-10-02 08:05:00")).toBe(
      "http://media.example:8081/timeshift/viewer%20name/p%26ss%2Fword/90/2026-10-02:08-05/live%2Fid.ts",
    );
  });
});

describe("hostile provider data", () => {
  test("movies preserve empty and genuine provider titles, drop bad ratings, and keep direct sources", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_vod_streams: [
        { stream_id: "40", category_id: "8", name: "  " },
        {
          stream_id: "41",
          category_id: "8",
          name: "Rated",
          rating: 3.6,
          year: "100",
          container_extension: ".MKV ",
        },
        {
          stream_id: "42",
          category_id: "8",
          name: "Direct",
          rating: 11,
          container_extension: "mp4?",
          direct_source: "http://files.example/direct.mp4",
        },
        {
          stream_id: "43",
          category_id: "8",
          name: "Credentialed art",
          stream_icon: "https://viewer:secret@images.example/p.jpg",
        },
        { stream_id: "44", category_id: "8", name: "Untitled" },
      ],
    });
    const session = await authenticateXtream(source);

    const movies = await loadXtreamMovies(session, "playlist-1", "8");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(movies).toEqual([
      {
        key: "xtream:playlist-1:movie:40",
        streamId: "40",
        categoryKey: "movie:8",
        name: "",
        logo: "",
        directSource: "",
        year: "",
        rating: "",
      },
      {
        key: "xtream:playlist-1:movie:41",
        streamId: "41",
        categoryKey: "movie:8",
        name: "Rated",
        logo: "",
        extension: "mkv",
        directSource: "",
        year: "",
        rating: "3.6",
      },
      {
        key: "xtream:playlist-1:movie:42",
        streamId: "42",
        categoryKey: "movie:8",
        name: "Direct",
        logo: "",
        directSource: "http://files.example/direct.mp4",
        year: "",
        rating: "",
      },
      {
        key: "xtream:playlist-1:movie:43",
        streamId: "43",
        categoryKey: "movie:8",
        name: "Credentialed art",
        logo: "",
        directSource: "",
        year: "",
        rating: "",
      },
      {
        key: "xtream:playlist-1:movie:44",
        streamId: "44",
        categoryKey: "movie:8",
        name: "Untitled",
        logo: "",
        directSource: "",
        year: "",
        rating: "",
      },
    ]);
  });

  test("movie details normalise backdrops, cast arrays, and missing fields", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_vod_info: {
        info: {
          backdrop_path:
            '["http://images.example/b1.jpg","javascript:alert(1)","https://u:p@x/y.jpg","http://images.example/b2.jpg","http://images.example/b3.jpg","http://images.example/b4.jpg"]',
          rating: "impossible",
          rating_5based: "4.1",
          cast: [" First Actor ", "", "Second Actor", 5],
          director: ["Director One", "Director Two"],
          releasedate: "1850",
          releaseDate: "2022-11-30",
          genre: "Drama, History",
          mpaa_rating: "PG-13",
          country: "FR",
          duration: "1:42:07",
        },
        movie_data: { stream_id: 20, category_id: 8 },
      },
    });
    const session = await authenticateXtream(source);

    const detail = await loadXtreamMovieDetail(session, "playlist-1", "20");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(detail.metadata.backdrops).toEqual([
      "http://images.example/b1.jpg",
      "http://images.example/b2.jpg",
      "http://images.example/b3.jpg",
    ]);
    expect(detail.metadata.rating).toBe("8.2");
    expect(detail.metadata.cast).toEqual(["First Actor", "Second Actor"]);
    expect(detail.metadata.director).toBe("Director One, Director Two");
    expect(detail.metadata.releaseDate).toBe("2022-11-30");
    expect(detail.metadata.country).toBe("FR");
    expect(detail.metadata.ageRating).toBe("PG-13");
    expect(detail.durationSeconds).toBe(6127);
    expect(detail.year).toBe("2022");
    expect(detail.name).toBe("");
  });

  test("series details order seasons, keep idless episodes, and never invent zeroes", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_series_info: {
        info: { name: "Series", category_id: 9, episode_run_time: "45" },
        seasons: [{ season_number: 3 }, { season_number: 0 }],
        episodes: {
          "2": [
            { id: "e1", episode_num: 2, title: "Later" },
            { episode_num: 1, title: "Idless but numbered" },
            { title: "Nothing at all" },
          ],
          notes: [{ title: "Bonus material" }],
        },
      },
    });
    const session = await authenticateXtream(source);

    const detail = await loadXtreamSeriesDetail(session, "playlist-1", "30");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(detail.seasons).toEqual([2, 3, 0, "unassigned"]);
    expect(
      detail.episodes.map((episode) => [
        episode.seasonKey,
        episode.number ?? null,
        episode.name,
      ]),
    ).toEqual([
      [2, 1, "Idless but numbered"],
      [2, 2, "Later"],
      [2, null, "Nothing at all"],
      ["unassigned", null, "Bonus material"],
    ]);
    const idless = detail.episodes[0];
    expect(idless.episodeId).toBeUndefined();
    expect(idless.episodeIdentity).toBe("s2:e1:Idless but numbered:1");
    expect(idless.key).toBe("xtream:playlist-1:episode:2:s2:e1:Idless but numbered:1");
    expect(detail.metadata.episodeRuntimeSeconds).toBe(2700);
  });

  test("an episode keeps a direct source fingerprint as its identity", async () => {
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_series_info: {
        info: { name: "Series", category_id: 9 },
        episodes: {
          "1": [
            {
              episode_num: 1,
              title: "Direct",
              direct_source: "http://files.example/ep1.mkv",
            },
            {
              episode_num: 1,
              title: "Same source again",
              direct_source: "http://files.example/ep1.mkv",
            },
          ],
        },
      },
    });
    const session = await authenticateXtream(source);

    const detail = await loadXtreamSeriesDetail(session, "playlist-1", "30");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(detail.episodes).toHaveLength(1);
    const episode = detail.episodes[0];
    expect(episode.episodeId).toBeUndefined();
    expect(episode.directSource).toBe("http://files.example/ep1.mkv");
    expect(episode.directSourceFingerprint).toBe(episode.episodeIdentity);
    expect(episode.key).toBe(`xtream:playlist-1:episode:1:${episode.directSourceFingerprint}`);
  });

  test("guide titles survive emoji through the base64 path", async () => {
    const emoji = "News 📺";
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(emoji)));
    const fetch = payloadByAction({
      authenticate: authentication(),
      get_short_epg: {
        epg_listings: [{ id: 1, title: encoded, description: "====" }],
      },
    });
    const session = await authenticateXtream(source);

    const programmes = await loadXtreamGuide(session, "10");

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(programmes[0].title).toBe(emoji);
    expect(programmes[0].description).toBe("====");
  });
});

describe("bounded requests", () => {
  test("query search streams a catalogue beyond the full index budget without retaining unrelated artwork", async () => {
    const session = await authenticate();
    const logo = `https://images.example/${"x".repeat(64 * 1024)}`;
    const payload = JSON.stringify([
      ...Array.from({ length: 220 }, (_, index) => ({
        stream_id: index + 1,
        name: `Other title ${index}`,
        stream_icon: logo,
      })),
      { stream_id: 1000, name: "A Needle story" },
      { stream_id: 1001, name: "Needle first" },
    ]);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(payload, {
        headers: { "Content-Length": String(256 * 1024 * 1024) },
      }),
    );
    const result = await searchXtreamCatalogue(session, "pl", "movie", "Needle");
    expect(result.matches.map((item) => item.name)).toEqual(["Needle first", "A Needle story"]);
    expect(result.total).toBe(2);
    expect(JSON.stringify(result).length).toBeLessThan(2048);
  }, 20_000);

  test.each([
    ["movie", loadXtreamMovies, "stream_id"],
    ["series", loadXtreamSeries, "series_id"],
  ] as const)(
    "the %s index discards verbose provider fields before applying its retained budget",
    async (_kind, load, identity) => {
      const session = await authenticate();
      const padding = "x".repeat(512 * 1024);
      const payload = JSON.stringify(
        Array.from({ length: 27 }, (_, index) => ({
          [identity]: index + 1,
          name: `Title ${index}`,
          plot: padding,
        })),
      );
      expect(payload.length).toBeGreaterThan(12 * 1024 * 1024);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(payload, { headers: { "Content-Length": String(payload.length) } }),
      );
      const items = await load(session, "pl", "");
      expect(items).toHaveLength(27);
      expect(items[0].name).toBe("Title 0");
      expect(JSON.stringify(items).length).toBeLessThan(16 * 1024);
    },
    20_000,
  );

  test("index records survive UTF-8 and escaped JSON boundaries between chunks", async () => {
    const session = await authenticate();
    const title = 'Film [one] } "quoted" 🎬';
    const bytes = new TextEncoder().encode(
      JSON.stringify([
        { stream_id: 1, name: title, metadata: { text: '\\"}]' } },
        { stream_id: 2, name: "Another film" },
      ]),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 3) {
          controller.enqueue(bytes.slice(index, index + 3));
        }
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(body));
    const items = await loadXtreamMovies(session, "pl", "");
    expect(items.map((item) => item.name)).toEqual([title, "Another film"]);
  });

  test.each(['[{"stream_id":1},]', '[{"stream_id":1} garbage]', '[{"stream_id":1}'])(
    "malformed streamed indexes fail without publishing partial results: %s",
    async (payload) => {
      const session = await authenticate();
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response(payload));
      await expect(loadXtreamMovies(session, "pl", "")).rejects.toMatchObject({
        reason: "malformed",
      });
    },
  );

  test("the normalized index still refuses data beyond its retained memory budget", async () => {
    const session = await authenticate();
    const logo = `https://images.example/${"p".repeat(300)}.jpg`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      response(
        Array.from({ length: 28_000 }, (_, index) => ({
          stream_id: index + 1,
          name: "n".repeat(120),
          stream_icon: logo,
        })),
      ),
    );
    await expect(loadXtreamMovies(session, "pl", "")).rejects.toMatchObject({
      reason: "too-large",
    });
  }, 20_000);

  test("a declared body over the limit rejects before reading, leaking no credentials", async () => {
    const session = await authenticate();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { headers: { "Content-Length": String(9 * 1024 * 1024) } }),
    );

    const failure = await loadXtreamMovies(session, "pl", "8").catch((e) => e);

    expect(failure).toMatchObject({ reason: "too-large" });
    for (const leak of ["api.example", "viewer", "p&ss", "media.example"]) {
      expect(String(failure?.message)).not.toContain(leak);
    }
  });

  test("a body at exactly the limit succeeds", async () => {
    const session = await authenticate();
    const payload = `[]${" ".repeat(8 * 1024 * 1024 - 2)}`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(payload));

    await expect(loadXtreamMovies(session, "pl", "8")).resolves.toEqual([]);
  });

  test("a streamed body without a declared length stops when the limit is crossed", async () => {
    const session = await authenticate();
    const chunk = new Uint8Array(5 * 1024 * 1024);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body));

    await expect(loadXtreamMovies(session, "pl", "8")).rejects.toMatchObject({
      reason: "too-large",
    });
  });

  test("malformed JSON stays distinct from transport failures", async () => {
    const session = await authenticate();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{not json"));

    await expect(loadXtreamMovies(session, "pl", "8")).rejects.toMatchObject({
      reason: "malformed",
    });
  });

  test("a hung request times out at thirty seconds", async () => {
    const session = await authenticate();
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
      const request = loadXtreamMovies(session, "pl", "8");
      const rejected = expect(request).rejects.toMatchObject({ reason: "timeout" });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  test("a caller abort cancels the request", async () => {
    const session = await authenticate();
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const request = loadXtreamMovies(session, "pl", "8", controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ reason: "aborted" });
  });

  test("the complete index and the detail endpoints use their own ceilings", async () => {
    const session = await authenticate();
    const over = (megabytes: number) =>
      new Response("", {
        headers: { "Content-Length": String(megabytes * 1024 * 1024) },
      });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(over(129))
      .mockResolvedValueOnce(over(5));

    await expect(loadXtreamMovies(session, "pl", "")).rejects.toMatchObject({
      reason: "too-large",
    });
    await expect(loadXtreamMovieDetail(session, "pl", "20")).rejects.toMatchObject({
      reason: "too-large",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
