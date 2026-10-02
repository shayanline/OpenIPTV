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

/** dist/, plus the playlist above. Its own server rather than the harness's, which serves the other one. */
export const host = (dist, port) => new Promise((ok, fail) => {
  const server = createServer(async (request, response) => {
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
      const type = path.endsWith(".js") ? "text/javascript"
        : path.endsWith(".css") ? "text/css"
        : path.endsWith(".svg") ? "image/svg+xml"
        : path.endsWith(".png") ? "image/png"
        : path.endsWith(".html") || path === "/" ? "text/html"
        : "application/octet-stream";
      response.writeHead(200, { "content-type": type });
      response.end(body);
    } catch {
      response.writeHead(404).end("no");
    }
  });
  server.once("error", (e) => fail(new Error(`Could not serve dist on port ${port}: ${e.message}`)));
  server.listen(port, () => ok(server));
});
