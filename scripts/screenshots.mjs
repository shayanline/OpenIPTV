#!/usr/bin/env node
/**
 * The six pictures in the README, taken from the running application at 1920 by 1080.
 *
 * A README that describes an interface in prose asks the reader to imagine it. These six let
 * somebody decide in about four seconds whether this is the application they want, which is the
 * whole job: first run, the channel list, the categories, search, favourites and settings, in the
 * order a viewer meets them.
 *
 * They are captured rather than drawn, from the built application walking its real screens, so they
 * cannot quietly stop matching the way a hand made mockup does. Rerun after any interface change:
 *
 *   npm run build && npm run screenshots
 *
 * The playlist is the invented one in present.mjs, shared with the store assets so the pictures in
 * the README and the pictures in Samsung's listing show the same application. No real broadcaster
 * appears in either.
 *
 * One honest limitation, the same one docs/publishing.md records for the store. On a television the
 * video is on a hardware plane underneath the page, and here in a headless browser there is no
 * stream at all, so there is no picture to photograph behind the interface. Every shot is the
 * interface, which is the part that is worth showing anyway.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { connect, findChrome } from "./tv/cdp.mjs";
import { driver } from "./tv/harness.mjs";
import { SEED, host } from "./present.mjs";

const OUT = "docs/screenshots";
const PORT = 4600;          // not store-assets' 4599, so both can run at once
const CHROME_PORT = 9334;
const WIDTH = 1920;
const HEIGHT = 1080;

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome or Chromium was found, and this needs one to draw with.");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const server = await host("dist", PORT);

const browser = spawn(chrome, [
  `--remote-debugging-port=${CHROME_PORT}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-sandbox",
  // A fresh profile every run, so nothing is photographed out of last run's disk cache and the
  // first shot really is a first run.
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "openiptv-shots-"))}`,
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
 * Capture the screen, having first checked it is the screen that was asked for.
 *
 * The check is the point. A walk that misses a key press carries on and photographs whatever was
 * still open, and six plausible pictures of the wrong screens are worse than a failure, because
 * nobody looks twice at a README image. `expect` is text that must be on screen.
 */
async function shoot(name, expect) {
  await sleep(600);
  const showing = await app.evaluate(
    `document.body.innerText.includes(${JSON.stringify(expect)})`);
  if (!showing) {
    throw new Error(`Expected "${expect}" on screen for ${name} and it is not there, so this `
      + "would have photographed whatever was open instead.");
  }
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const bytes = Buffer.from(data, "base64");
  writeFileSync(`${OUT}/${name}.png`, bytes);
  console.log(`  ${name}.png  ${WIDTH}x${HEIGHT}  ${Math.round(bytes.length / 1024)}KB`);
}

/** Press one of the panel's title bar keys by its accessible label, as the parity harness does. */
const keyed = async (label) => {
  const hit = await app.evaluate(`(() => {
    const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!hit) throw new Error(`No key labelled "${label}" in the panel's title bar.`);
};

console.log(`\nSix screenshots, from the built application on port ${PORT}:`);

/*
 * Everything below runs inside a try, and the reason is a failure that wasted a run rather than
 * reporting itself.
 *
 * A shot whose assertion fails throws, and when the cleanup sat at the end of the file the throw
 * skipped it, leaving Chrome alive and still holding the debugging port. The next run connected to
 * that survivor instead of starting a browser: it inherited the previous run's seeded localStorage
 * and whatever screen it had been left on, so the first shot failed claiming the first run screen
 * was missing, which was true and had nothing to do with the code that had just been changed.
 */
try {

// 1. What a viewer sees the very first time, before the seed exists. This is the only shot that
//    needs the unseeded profile, so it has to come before anything writes to localStorage.
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await sleep(2000);
await shoot("01-first-run", "playlist");

// From here on, a playlist exists.
await app.evaluate(SEED);
await cdp.send("Page.reload");
await sleep(2600);

// 2. The channel list, which is the screen the application opens on and the one used most.
await shoot("02-channels", "News One");

// 3. The categories the playlist declared, which is the rail rather than a claim in the README.
await app.press("ArrowLeft", 37);
await app.press("ArrowDown", 40);
await shoot("03-categories", "Sport");

/*
 * 4. Search, the feature least likely to be found on its own.
 *
 * The query goes in as character events rather than by setting the field's value, because React
 * tracks the value it last wrote and an assignment leaves its tracker thinking nothing changed, so
 * no results ever appear. The store script learnt this the same way.
 */
await app.press("ArrowRight", 39);
await keyed("Search");
for (const character of "news") {
  await cdp.send("Input.dispatchKeyEvent", { type: "char", text: character });
}
await sleep(600);
await shoot("04-search", "News");

// 5. Favourites, which only exists as a category once something is in it, so the green key has to
//    be pressed on a channel before there is anything to photograph.
await app.press("Escape", 27);
await app.press("Escape", 27);
await sleep(400);
await app.press("Green", 404);
await sleep(400);
await app.press("ArrowLeft", 37);
await sleep(400);
await shoot("05-favourites", "Favourites");

// 6. Settings, on the section carrying compatibility mode. Asserted on the label the interface
//    actually shows, which names the symptom rather than the jargon: Behaviour.tsx explains why,
//    and "Compatibility" appears nowhere on the screen.
//
//    The wait is for the "Added to favourites" message from the shot above, which outlives the
//    screen that raised it and otherwise sits in the middle of this one looking like a caption to
//    a settings page it has nothing to do with.
await sleep(4000);
await app.press("ArrowRight", 39);
await keyed("Settings");
await sleep(500);
if (!(await app.clickText("Watching"))) {
  throw new Error("No Watching section in Settings, so the section it moved to is unknown.");
}
await shoot("06-settings", "Fix channels that stop playing");

console.log(`\nAll six are in ${OUT}/, and the README shows them.\n`);

} finally {
  cdp.close();
  browser.kill();
  server.close();
}
