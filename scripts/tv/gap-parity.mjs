#!/usr/bin/env node
/**
 * Prove that the interface is spaced the same with flex gap and without it.
 *
 * `gap` on a flex container is Chromium 84 and the televisions this app is built for run 76,
 * with the simulator's floor profile at 69. So the stylesheet carries a second, margin based
 * set of spacing rules under `.no-flex-gap`, chosen at startup by a measured probe. See the
 * "old engine gaps" section at the foot of styles/app.css.
 *
 * Nothing anybody here can open exercises that second set. Every browser on this machine has
 * flex gap, so the rules that only old sets use are the rules nobody ever sees, which is
 * precisely how they rot: a gap added to a new flex container is invisible on a desktop and
 * silently missing on the hardware.
 *
 * This closes that. It loads the built app twice, measures the position and size of every
 * child of every gap using container, and compares:
 *
 *   1. as it is, with gap doing the spacing
 *   2. with gap neutralised on those same containers and .no-flex-gap turned on, which is
 *      what a Chromium 76 set sees
 *
 * The two must agree. Where they do not, the margin rule for that container is wrong, and
 * the output says which container and by how much.
 *
 *   npm run build && npm run tv:gap
 *
 * Chrome is driven over CDP through the same tiny client the simulator uses, so this adds no
 * dependency and no browser automation framework.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { connect, findChrome } from "./cdp.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");
const PORT = 4319;
const CDP_PORT = 9335;

/** Containers that space themselves with flex gap, and so need a fallback. */
const FLEX_GAP = [
  ".btn", ".chip", ".gear", ".row", ".splash", ".hints", ".hints.sheet-hints", ".field",
  ".field-control", ".switch", ".pl", ".pl-main", ".form", ".actions", ".about", ".pad",
  ".pad-trio", ".picture-state", ".picture-state.failed", ".picture-state-doing",
  ".pb-stack", ".pb", ".pb-meta", ".dialog-actions",
];

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml" };

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News" tvg-quality="FHD",Channel Alpha News
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Channel Beta With A Longer Name
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma Sport
http://example.invalid/c.m3u8
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/playlist.m3u") {
      res.writeHead(200, { "content-type": "audio/x-mpegurl" });
      return res.end(PLAYLIST);
    }
    const file = join(DIST, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

/** Every child box of every gap using container, keyed so the two runs can be lined up. */
const MEASURE = (sels) => `(() => {
  const out = {};
  for (const sel of ${JSON.stringify(sels)}) {
    document.querySelectorAll(sel).forEach((el, i) => {
      Array.from(el.children).forEach((c, j) => {
        const r = c.getBoundingClientRect();
        if (!r.width && !r.height) return;
        out[sel + "[" + i + "]>" + j] =
          [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
      });
    });
  }
  return JSON.stringify(out);
})()`;

/** What a set without flex gap sees: the gaps do nothing, and the fallback rules apply. */
const SIMULATE_OLD = `(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(FLEX_GAP)}
    .map((s) => s + "{row-gap:0 !important;column-gap:0 !important}").join("\\n");
  document.head.appendChild(style);
  document.documentElement.classList.add("no-flex-gap");
  return "ok";
})()`;

const SEED = `(() => {
  localStorage.setItem("simpleiptv.settings", JSON.stringify({
    playlists: [{ id: "pl-1", name: "Parity", url: "/playlist.m3u" }],
    activePlaylistId: "pl-1", resumeLast: false,
  }));
  return "ok";
})()`;

async function run(cdp, { old }) {
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? "evaluate failed");
    return result.value;
  };
  const press = async (key, code) => {
    for (const type of ["keyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent",
        { type, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    }
    await sleep(140);
  };
  const clickText = (text) => evaluate(
    `(() => { const b = [...document.querySelectorAll("button")]
        .find((e) => e.textContent.trim() === ${JSON.stringify(text)});
      if (b) b.click(); return !!b; })()`);

  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(1200);
  await evaluate(SEED);
  await cdp.send("Page.reload");
  await sleep(1500);
  if (old) await evaluate(SIMULATE_OLD);

  const shots = {};
  const capture = async (name) => { await sleep(320); shots[name] = JSON.parse(await evaluate(MEASURE(FLEX_GAP))); };

  await capture("panel");
  await evaluate(`document.querySelector(".gear").click()`);
  await capture("settings.appearance");
  await clickText("Playlists");        await capture("settings.playlists");
  await clickText("Add a playlist");   await capture("settings.playlistForm");
  await clickText("Cancel");           await sleep(200);
  await clickText("Remove");           await capture("settings.confirm");
  await clickText("Keep it");          await sleep(200);
  await clickText("Watching");         await capture("settings.behaviour");
  await clickText("About");            await capture("settings.about");
  await press("Escape", 27);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 500 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 905, y: 505 });
  await capture("pointerPad");
  return shots;
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("No build to measure. Run `npm run build` first.");
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("No Chrome, Chromium or Edge found in the usual places.");
    process.exit(2);
  }

  const server = await serve();
  const browser = spawn(chrome, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(tmpdir(), "simpleiptv-gap-parity")}`,
    "--headless=new", "--window-size=1920,1080", "--no-first-run", "--no-default-browser-check",
  ], { stdio: "ignore" });

  let failures = 0;
  try {
    const cdp = await connect(CDP_PORT);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    const withGap = await run(cdp, { old: false });
    const without = await run(cdp, { old: true });
    cdp.close();

    let boxes = 0;
    for (const screen of Object.keys(withGap)) {
      for (const [key, a] of Object.entries(withGap[screen])) {
        const b = without[screen]?.[key];
        boxes += 1;
        if (!b) {
          console.error(`missing  ${screen} ${key}`);
          failures += 1;
          continue;
        }
        if (a.some((v, i) => Math.abs(v - b[i]) > 0.6)) {
          console.error(`differs  ${screen} ${key}\n           gap      ${a.join(", ")}` +
                        `\n           fallback ${b.join(", ")}`);
          failures += 1;
        }
      }
    }
    console.log(`\n${boxes} child boxes across ${Object.keys(withGap).length} screens, ` +
                `${failures} differing`);
    if (failures) {
      console.error("\nThe margin fallback does not reproduce the gap spacing. The rules are " +
                    "at the foot of src/styles/app.css.");
    }
  } finally {
    browser.kill();
    server.close();
  }
  process.exit(failures ? 1 : 0);
}

main();
