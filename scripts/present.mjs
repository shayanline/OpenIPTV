/**
 * The application as it should be photographed, and the server that serves it that way.
 *
 * Two scripts take pictures of this application and they must show the same one. `store-assets.mjs`
 * produces the four screenshots Samsung's form accepts, and `screenshots.mjs` produces the ten in
 * the README. When the playlist lived in the first of those, the second either duplicated it or
 * photographed something else, and a reader comparing the store listing with the repository would
 * have been looking at two different applications.
 */
import { createServer } from "node:http";
import { readFile as read } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { handleHttpRelay } from "./http-relay.mjs";

/**
 * A playlist made to be photographed, which is not the one the gates use.
 *
 * The parity harness deliberately carries hostile text: a name far longer than fits, mixed right to
 * left script, a missing quality tag. That is exactly right for testing truncation and exactly wrong
 * for a picture, where the first version of this produced a screenshot reading "Channel Beta With A
 * Much Longer Name Than Fits".
 *
 * Every name here is invented. Samsung checks intellectual property in store artwork, a player that
 * ships no content has no business showing real broadcasters' names, and the README is read by
 * people deciding whether this application is what they think it is.
 */
export const PRESENTATION = `#EXTM3U
#EXTINF:-1 group-title="News" tvg-logo="/icon.png" tvg-quality="FHD",News One
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News" tvg-logo="/icon.png" tvg-quality="HD",World Report
http://example.invalid/2.m3u8
#EXTINF:-1 group-title="News" tvg-logo="/icon.png",Capital News
http://example.invalid/3.m3u8
#EXTINF:-1 group-title="Sport" tvg-logo="/icon.png" tvg-quality="FHD",Sport One
http://example.invalid/4.m3u8
#EXTINF:-1 group-title="Sport" tvg-logo="/icon.png",Match Day
http://example.invalid/5.m3u8
#EXTINF:-1 group-title="Sport" tvg-logo="/icon.png",Motor Sport
http://example.invalid/6.m3u8
#EXTINF:-1 group-title="Film" tvg-logo="/icon.png" tvg-quality="FHD",Film One
http://example.invalid/7.m3u8
#EXTINF:-1 group-title="Film" tvg-logo="/icon.png",Classics
http://example.invalid/8.m3u8
#EXTINF:-1 group-title="Music" tvg-logo="/icon.png",Music Box
http://example.invalid/9.m3u8
#EXTINF:-1 group-title="Music" tvg-logo="/icon.png",Live Sessions
http://example.invalid/10.m3u8
#EXTINF:-1 group-title="Documentary" tvg-logo="/icon.png",Nature
http://example.invalid/11.m3u8
#EXTINF:-1 group-title="Documentary" tvg-logo="/icon.png",History Today
http://example.invalid/12.m3u8
#EXTINF:-1 group-title="Children" tvg-logo="/icon.png",Cartoon Time
http://example.invalid/13.m3u8
#EXTINF:-1 group-title="Children" tvg-logo="/icon.png",Learn And Play
http://example.invalid/14.m3u8
`;

/** The same shape the harness seeds, with the panel left open long enough to photograph. */
export const SEED = `(() => {
  localStorage.setItem("openiptv.settings", JSON.stringify({
    playlists: [{ id: "pl-1", name: "Example", url: "/store-playlist.m3u" }],
    activePlaylistId: "pl-1", resumeLast: false, panelTimeout: 0, showClock: true,
  }));
  return "ok";
})()`;

export const XTREAM_FIXTURE = Object.freeze({
  username: "fixture-viewer",
  password: "fixture-password",
  liveCount: 3200,
  movieCount: 840,
  seriesCount: 560,
});

const categories = {
  live: [
    { category_id: "live-large", category_name: "Live" },
    { category_id: "live-duplicate-a", category_name: "Duplicate" },
    { category_id: "live-duplicate-b", category_name: "Duplicate" },
    { category_id: "live-empty", category_name: "Empty" },
    { category_id: "live-blank", category_name: "" },
  ],
  movie: [
    { category_id: "movie-large", category_name: "Movies" },
    { category_id: "movie-duplicate-a", category_name: "Duplicate" },
    { category_id: "movie-duplicate-b", category_name: "Duplicate" },
    { category_id: "movie-empty", category_name: "Empty" },
    { category_id: "movie-blank", category_name: "" },
  ],
  series: [
    { category_id: "series-large", category_name: "Series" },
    { category_id: "series-duplicate-a", category_name: "Duplicate" },
    { category_id: "series-duplicate-b", category_name: "Duplicate" },
    { category_id: "series-empty", category_name: "Empty" },
    { category_id: "series-blank", category_name: "" },
  ],
};

const categoryFor = (kind, index) => {
  if (kind === "live") {
    if (index < 2400) return "live-large";
    if (index < 2800) return "live-duplicate-a";
    return "live-duplicate-b";
  }
  if (kind === "movie") {
    if (index < 600) return "movie-large";
    if (index < 720) return "movie-duplicate-a";
    return "movie-duplicate-b";
  }
  if (index < 400) return "series-large";
  if (index < 480) return "series-duplicate-a";
  return "series-duplicate-b";
};

const fixtureItems = (kind, count, categoryId) => {
  const items = [];
  for (let index = 0; index < count; index++) {
    const category = categoryFor(kind, index);
    if (categoryId && category !== categoryId) continue;
    const id = `${kind}-${index + 1}`;
    if (kind === "live") {
      items.push({
        stream_id: id,
        num: index + 1,
        name: `Live Channel ${String(index + 1).padStart(4, "0")}`,
        category_id: category,
        stream_icon: "/icon.png",
        stream_type: "live",
        tv_archive: index < 20 ? 1 : 0,
        tv_archive_duration: index < 20 ? 9999 : 0,
      });
    } else if (kind === "movie") {
      items.push({
        stream_id: id,
        name: `Movie ${String(index + 1).padStart(4, "0")}`,
        category_id: category,
        stream_icon: "/icon.png",
        container_extension: "mp4",
        year: "2026",
        rating: "8.0",
      });
    } else {
      items.push({
        series_id: id,
        name: `Series ${String(index + 1).padStart(4, "0")}`,
        category_id: category,
        cover: "/icon.png",
        releaseDate: "2026-01-01",
        rating: "8.0",
      });
    }
  }
  return items;
};

const episodes = Object.fromEntries(
  Array.from({ length: 3 }, (_, seasonIndex) => {
    const season = seasonIndex + 1;
    return [
      String(season),
      Array.from({ length: 12 }, (_, episodeIndex) => ({
        id: `episode-${season}-${episodeIndex + 1}`,
        episode_num: episodeIndex + 1,
        title: `Episode ${season}.${episodeIndex + 1}`,
        container_extension: episodeIndex % 2 ? "mkv" : "mp4",
        info: { duration_secs: 2700 },
      })),
    ];
  }),
);

const fixtureJson = (body, status = 200) => ({
  status,
  type: "application/json",
  body: JSON.stringify(body),
});

export function xtreamFixtureResponse(requestUrl) {
  const url = new URL(requestUrl, "http://fixture.invalid");
  if (url.pathname === "/player_api.php") {
    const authenticated =
      url.searchParams.get("username") === XTREAM_FIXTURE.username &&
      url.searchParams.get("password") === XTREAM_FIXTURE.password;
    if (!authenticated) return fixtureJson({ user_info: { auth: 0, status: "Disabled" } });
    const action = url.searchParams.get("action");
    if (!action)
      return fixtureJson({
        user_info: {
          auth: 1,
          status: "Active",
          exp_date: "1893456000",
          is_trial: "0",
          active_cons: "0",
          max_connections: "2",
        },
        server_info: {},
      });
    if (action === "get_live_categories") return fixtureJson(categories.live);
    if (action === "get_vod_categories") return fixtureJson(categories.movie);
    if (action === "get_series_categories") return fixtureJson(categories.series);
    const categoryId = url.searchParams.get("category_id") ?? "";
    if (action === "get_live_streams")
      return fixtureJson(fixtureItems("live", XTREAM_FIXTURE.liveCount, categoryId));
    if (action === "get_vod_streams")
      return fixtureJson(fixtureItems("movie", XTREAM_FIXTURE.movieCount, categoryId));
    if (action === "get_series")
      return fixtureJson(fixtureItems("series", XTREAM_FIXTURE.seriesCount, categoryId));
    if (action === "get_vod_info") {
      const id = url.searchParams.get("vod_id") ?? "";
      return fixtureJson({
        info: {
          name: `Movie details for ${id}`,
          movie_image: "/icon.png",
          plot: "A deterministic movie detail used by the television harness.",
          cast: "Fixture Performer",
          director: "Fixture Director",
          genre: "Drama",
          rating: "8.0",
          duration_secs: 5400,
        },
        movie_data: {
          stream_id: id,
          category_id: "movie-large",
          container_extension: "mp4",
        },
      });
    }
    if (action === "get_series_info") {
      const id = url.searchParams.get("series_id") ?? "";
      return fixtureJson({
        info: {
          name: `Series details for ${id}`,
          category_id: "series-large",
          cover: "/icon.png",
          plot: "A deterministic series detail used by the television harness.",
          genre: "Drama",
          rating: "8.0",
        },
        episodes,
      });
    }
    if (action === "get_short_epg")
      return fixtureJson({
        epg_listings: [
          {
            id: "programme-archive",
            title: Buffer.from("Archived programme").toString("base64"),
            description: Buffer.from("Available from catchup").toString("base64"),
            start: "2026-01-02 10:00:00",
            end: "2026-01-02 11:00:00",
            start_timestamp: 1767348000,
            stop_timestamp: 1767351600,
            has_archive: 1,
          },
          {
            id: "programme-later",
            title: Buffer.from("Later programme").toString("base64"),
            description: Buffer.from("Programme information").toString("base64"),
            start: "2026-01-02 11:00:00",
            end: "2026-01-02 12:00:00",
            start_timestamp: 1767351600,
            stop_timestamp: 1767355200,
            has_archive: 0,
          },
        ],
      });
    return fixtureJson([]);
  }

  const media = /^\/(live|movie|series|timeshift)\//.test(url.pathname);
  if (media && url.pathname.endsWith(".m3u8")) {
    return {
      status: 200,
      type: "application/vnd.apple.mpegurl",
      body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:10,\n/fixture-segment.ts\n",
    };
  }
  if (media || url.pathname === "/fixture-segment.ts") {
    return { status: 200, type: "video/mp2t", body: "fixture media" };
  }
  return null;
}

/** dist/, plus the playlist above. Its own server rather than the harness's, which serves the other one. */
export const host = (dist, port) =>
  new Promise((ok, fail) => {
    const server = createServer(async (request, response) => {
      if (handleHttpRelay(request, response)) return;
      const fixture = xtreamFixtureResponse(request.url ?? "/");
      if (fixture) {
        response.writeHead(fixture.status, {
          "content-type": fixture.type,
          "access-control-allow-origin": "*",
          "cache-control": "no-store",
        });
        return response.end(fixture.body);
      }
      const path = request.url.split("?")[0];
      // A different address from the one the parity harness serves, deliberately. Playlists are cached
      // by address for six hours, so reusing that path served the harness's stress fixture from disk
      // and no amount of changing the text here made any difference to what was photographed.
      if (path === "/store-playlist.m3u") {
        response.writeHead(200, { "content-type": "audio/x-mpegurl" });
        return response.end(PRESENTATION);
      }
      const root = resolve(dist);
      const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
      const requested = relative(root, file);
      if (requested.startsWith(`..${sep}`) || requested === ".." || isAbsolute(requested)) {
        return response.writeHead(404).end("no");
      }
      try {
        const body = await read(file);
        const type = path.endsWith(".js")
          ? "text/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : path.endsWith(".svg")
              ? "image/svg+xml"
              : path.endsWith(".png")
                ? "image/png"
                : path.endsWith(".html") || path === "/"
                  ? "text/html"
                  : "application/octet-stream";
        response.writeHead(200, { "content-type": type });
        response.end(body);
      } catch {
        response.writeHead(404).end("no");
      }
    });
    server.once("error", (e) =>
      fail(new Error(`Could not serve dist on port ${port}: ${e.message}`)),
    );
    server.listen(port, () => ok(server));
  });
