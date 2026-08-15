#!/usr/bin/env node
/**
 * The pictures Samsung's store asks for, made from the application rather than by hand.
 *
 * Submitting to the TV Seller Office is a web form, and no part of the upload can be automated
 * because there is no API for it, so the useful thing a script can do is make the manual step short:
 * run this, then drag six files into the form.
 *
 * What it produces, and why each is the shape it is:
 *
 *   screenshot-1.jpg .. screenshot-4.jpg   exactly four, 1920x1080 JPEG, which is what the form
 *                                          accepts. Captured from the real build walking the real
 *                                          screens, so they cannot drift from the application the
 *                                          way a hand made mockup does.
 *   icon-logo.png                          1920x1080 with transparency, the logo layer. The mark
 *                                          sits inside the middle 512x423, which is the region
 *                                          Samsung composes the smaller sizes from.
 *   icon-background.png                    1920x1080 opaque, the background layer.
 *
 * Everything is written to build/store/, which is ignored by git: these are outputs, and the
 * repository already holds the vector and the code they come from.
 *
 * The screenshots deliberately show a playlist of invented channels. Samsung's checks look at
 * intellectual property in store artwork, and a screen full of real broadcaster names and logos in a
 * player that ships no content is an argument nobody needs to have.
 *
 *   npm run store:assets
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile as read } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { connect, findChrome } from "./tv/cdp.mjs";
import { driver } from "./tv/harness.mjs";

/**
 * A playlist made to be photographed, which is not the one the gates use.
 *
 * The parity harness deliberately carries hostile text: a name far longer than fits, mixed right to
 * left script, a missing quality tag. That is exactly right for testing truncation and exactly wrong
 * for a store listing, where the first version of this script produced a screenshot reading "Channel
 * Beta With A Much Longer Name Than Fits".
 *
 * Every name here is invented. Samsung checks intellectual property in store artwork, and a player
 * that ships no content has no business showing real broadcasters' names in its screenshots.
 */
const PRESENTATION = `#EXTM3U
#EXTINF:-1 group-title="News" tvg-quality="FHD",News One
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News" tvg-quality="HD",World Report
http://example.invalid/2.m3u8
#EXTINF:-1 group-title="News",Capital News
http://example.invalid/3.m3u8
#EXTINF:-1 group-title="Sport" tvg-quality="FHD",Sport One
http://example.invalid/4.m3u8
#EXTINF:-1 group-title="Sport",Match Day
http://example.invalid/5.m3u8
#EXTINF:-1 group-title="Sport",Motor Sport
http://example.invalid/6.m3u8
#EXTINF:-1 group-title="Film" tvg-quality="FHD",Film One
http://example.invalid/7.m3u8
#EXTINF:-1 group-title="Film",Classics
http://example.invalid/8.m3u8
#EXTINF:-1 group-title="Music",Music Box
http://example.invalid/9.m3u8
#EXTINF:-1 group-title="Music",Live Sessions
http://example.invalid/10.m3u8
#EXTINF:-1 group-title="Documentary",Nature
http://example.invalid/11.m3u8
#EXTINF:-1 group-title="Documentary",History Today
http://example.invalid/12.m3u8
#EXTINF:-1 group-title="Children",Cartoon Time
http://example.invalid/13.m3u8
#EXTINF:-1 group-title="Children",Learn And Play
http://example.invalid/14.m3u8
`;

/** The same shape the harness seeds, with the panel left open long enough to photograph. */
const SEED = `(() => {
  localStorage.setItem("openiptv.settings", JSON.stringify({
    playlists: [{ id: "pl-1", name: "Example", url: "/store-playlist.m3u" }],
    activePlaylistId: "pl-1", resumeLast: false, panelTimeout: 0, showClock: true,
  }));
  return "ok";
})()`;

/** dist/, plus the playlist above. Its own server rather than the harness's, which serves the other one. */
const host = (dist, port) => new Promise((ok, fail) => {
  const server = createServer(async (request, response) => {
    const path = request.url.split("?")[0];
    // A different address from the one the parity harness serves, deliberately. Playlists are cached
    // by address for six hours, so reusing that path served the harness's stress fixture from disk
    // and no amount of changing the text here made any difference to what was photographed.
    if (path === "/store-playlist.m3u") {
      response.writeHead(200, { "content-type": "audio/x-mpegurl" });
      return response.end(PRESENTATION);
    }
    try {
      const body = await read(join(dist, path === "/" ? "index.html" : path));
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

const OUT = "build/store";
const PORT = 4599;
const CHROME_PORT = 9333;

/** 1920 by 1080, because both the screenshots and the two icon layers are that size. */
const WIDTH = 1920;
const HEIGHT = 1080;

/**
 * Where the mark has to sit inside the icon layers.
 *
 * Samsung generates the 16:9 and 1:1 icons from these two layers by cropping toward the middle, and
 * the region they crop to is 512 by 423. A logo drawn to the edges of the canvas loses its edges in
 * every derived size, so the mark is scaled to fit that box and centred in it.
 */
const SAFE = { width: 512, height: 423 };

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome or Chromium was found, and this needs one to draw with.");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
// Awaited, because the server resolves once the port is actually listening and rejects with a
// sentence rather than an EADDRINUSE stack when a previous run is still up.
const server = await host("dist", PORT);

const browser = spawn(chrome, [
  `--remote-debugging-port=${CHROME_PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-sandbox",
  // A fresh profile every run, so nothing is photographed out of the disk cache from last time.
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "openiptv-store-"))}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await sleep(1500);

const cdp = await connect(CHROME_PORT);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
});

const app = driver(cdp, PORT);

/**
 * Capture whatever is on screen as a JPEG.
 *
 * Quality 88 rather than 100: the form caps each screenshot at 500KB, and a flat television
 * interface of solid panels and text compresses far below that at 88 with nothing visible lost.
 */
async function shoot(name) {
  await sleep(500);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  const bytes = Buffer.from(data, "base64");
  writeFileSync(`${OUT}/${name}.jpg`, bytes);
  const kb = Math.round(bytes.length / 1024);
  console.log(`  ${name}.jpg  ${WIDTH}x${HEIGHT}  ${kb}KB${kb > 500 ? "  OVER THE 500KB LIMIT" : ""}`);
}

/*
 * Four screens that do not depend on a moving picture, which is a limitation worth being honest
 * about rather than working around.
 *
 * On a television the video is drawn on a hardware plane underneath the page, so it is absent from
 * any capture of the application: a screenshot of a channel playing is a screenshot of a black
 * rectangle with the banner over it. Here in a headless browser there is no stream at all. So these
 * four are the interface, and if a filled picture is wanted behind it, that is a still composited by
 * hand afterwards, which docs/publishing.md says plainly.
 */
console.log(`\nFour screenshots, from the built application on port ${PORT}:`);
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await sleep(1400);
await app.evaluate(SEED);
await cdp.send("Page.reload");
await sleep(2400);

/** Press one of the panel's title bar keys by its accessible label, as the parity harness does. */
const keyed = async (label) => {
  const hit = await app.evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!hit) throw new Error(`No key labelled "${label}" in the panel's title bar, so screen ${label} `
    + "cannot be reached and a screenshot of whatever was still open would be worse than none.");
};

// 1. Every channel, which is the screen the application opens on and the one a viewer uses most.
await shoot("screenshot-1");

// 2. The categories the playlist declared, which is the rail rather than a claim in the description.
await app.press("ArrowLeft", 37);
await app.press("ArrowDown", 40);
await shoot("screenshot-2");

/*
 * 3. Search, which is the feature a reviewer is least likely to find on their own.
 *
 * The query goes in as character events rather than by setting the field's value, because React
 * tracks the value it last wrote and an assignment leaves its tracker thinking nothing changed, so
 * no results ever appear. The harness learnt this the same way.
 */
await app.press("ArrowRight", 39);
await keyed("Search");
for (const character of "news") {
  await cdp.send("Input.dispatchKeyEvent", { type: "char", text: character });
}
await sleep(500);                          // the search's own debounce, and a frame to draw
await shoot("screenshot-3");

// 4. Settings, on the section carrying the compatibility switch, so the screenshot shows it off.
await app.press("Escape", 27);
await app.press("Escape", 27);
await sleep(300);
await keyed("Settings");
await sleep(400);
if (!(await app.clickText("Watching"))) {
  throw new Error("No Watching section in Settings, so the section it moved to is unknown.");
}
await sleep(400);
await shoot("screenshot-4");

/**
 * The two icon layers, drawn from the same vector the application's own icon comes from.
 *
 * Rendered in the page rather than by an image library, for the same reason scripts/icon.mjs does
 * it: the browser is already here, it is the thing that will draw this vector on a television, and
 * adding an SVG rasteriser as a dependency to produce two PNGs would be absurd.
 */
console.log("\nTwo icon layers, from public/icon.svg:");

/*
 * The page the two layers are drawn on, written to dist/ for the moment it takes to photograph it
 * and never shipped: dist/ is rebuilt by every build and ignored by git.
 */
writeFileSync("dist/store-icon.html", `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body { display: grid; place-items: center; }
  .safe { width: ${SAFE.width}px; height: ${SAFE.height}px; display: grid; place-items: center; }
  img { width: ${SAFE.height}px; height: ${SAFE.height}px; }
  /*
   * A vertical gradient rather than a radial one, and the reason is the 300KB cap on this layer.
   * A radial gradient over 1920 by 1080 gives every row a different pattern, which is close to the
   * worst case for PNG's row by row prediction: the first version of this measured 317KB. A
   * vertical gradient repeats each row exactly, so it compresses to a few kilobytes and looks the
   * same behind a centred mark.
   */
  body.background { background: linear-gradient(#1b2440, #0b0d14); }
  body.background .safe { visibility: hidden; }
</style>
<body class="${""}">
  <div class="safe"><img src="./icon.svg" alt=""></div>
  <script>
    if (new URLSearchParams(location.search).get("layer") === "background") {
      document.body.classList.add("background");
    }
  </script>
</body>
`);

for (const [name, transparent] of [["icon-logo", true], ["icon-background", false]]) {
  await cdp.send("Emulation.setDefaultBackgroundColorOverride",
    { color: transparent ? { r: 0, g: 0, b: 0, a: 0 } : { r: 11, g: 13, b: 20, a: 1 } });
  await cdp.send("Page.navigate",
    { url: `http://127.0.0.1:${PORT}/store-icon.html?layer=${transparent ? "logo" : "background"}` });
  await sleep(900);
  const { data } = await cdp.send("Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false, omitBackground: transparent });
  const bytes = Buffer.from(data, "base64");
  writeFileSync(`${OUT}/${name}.png`, bytes);
  const kb = Math.round(bytes.length / 1024);
  console.log(`  ${name}.png  ${WIDTH}x${HEIGHT}  ${kb}KB${kb > 300 ? "  OVER THE 300KB LIMIT" : ""}`);
}

cdp.close();
browser.kill();
server.close();

console.log(`\nAll six are in ${OUT}/. What to do with them, and everything the form asks for`);
console.log("beyond pictures, is in docs/publishing.md.\n");
