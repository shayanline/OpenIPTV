#!/usr/bin/env node
/**
 * The ten pictures in the README, taken from the running application at 1920 by 1080.
 *
 * A README that describes an interface in prose asks the reader to imagine it. These ten let
 * somebody decide quickly whether this is the application they want. They cover first run, browsing,
 * search, favourites, Settings, category management and Playback information in the order a viewer
 * meets them.
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
const TV_REMOTE_SHIM = `(() => {
  window.webapis = { avplay: {}, network: { getIp: () => "192.168.1.42" } };
  let random = 1;
  crypto.getRandomValues = (values) => {
    for (let index = 0; index < values.length; index += 1) values[index] = random++;
    return values;
  };
  window.Worker = class {
    postMessage(message) {
      if (message.type !== "start") return;
      setTimeout(() => this.onmessage?.({
        data: { type: "listening", address: message.address, port: message.port },
      }), 0);
    }
    terminate() {}
  };
})()`;

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
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => {
    const RealDate = Date;
    const fixed = new RealDate("2026-10-02T10:00:00").valueOf();
    window.Date = class extends RealDate {
      constructor(...values) { super(...(values.length ? values : [fixed])); }
      static now() { return fixed; }
    };
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
      document.head.appendChild(style);
    });
  })()`,
});
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false,
});

const app = driver(cdp, PORT);

/**
 * Capture the screen, having first checked it is the screen that was asked for.
 *
 * The check is the point. A walk that misses a key press carries on and photographs whatever was
 * still open, and ten plausible pictures of the wrong screens are worse than a failure, because
 * nobody looks twice at a README image. `expect` is text that must be on screen.
 */
async function shoot(name, expect, width = WIDTH, height = HEIGHT) {
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
  console.log(`  ${name}.png  ${width}x${height}  ${Math.round(bytes.length / 1024)}KB`);
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

console.log(`\nTen screenshots, from the built application on port ${PORT}:`);

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

// 1. What a viewer sees on a television before the seed exists, including local Remote access.
const { identifier: onboardingShim } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: TV_REMOTE_SHIM,
});
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
await sleep(2000);
await shoot("01-first-run", "playlist");
await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: onboardingShim });

// From here on, a playlist exists.
await app.evaluate(SEED);
await cdp.send("Page.reload");
await sleep(5000);

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
//    actually shows, so the screenshot follows the same visible wording as the TV walk.
//
//    The wait is for the "Added to favourites" message from the shot above, which outlives the
//    screen that raised it and otherwise sits in the middle of this one looking like a caption to
//    a settings page it has nothing to do with.
await sleep(4000);
const { identifier: settingsShim } = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: TV_REMOTE_SHIM,
});
await cdp.send("Page.reload");
await sleep(2600);
await keyed("Settings");
await sleep(500);
if (!(await app.clickText("Playback"))) {
  throw new Error("No Playback section in Settings, so the section it moved to is unknown.");
}
await shoot("06-settings", "Compatibility mode");

// 7. Category management, where every playlist owns its own visibility and search controls.
if (!(await app.clickText("Playlists"))) {
  throw new Error("No Playlists section in Settings, so category management cannot be shown.");
}
await sleep(400);
const openedCategories = await app.evaluate(`(() => {
  const button = document.querySelector('[data-settings-focus^="playlist-categories-"]');
  if (!button) return false;
  button.click();
  return true;
})()`);
if (!openedCategories) throw new Error("No category management action was available in Settings.");
await app.evaluate(`(() => {
  const row = document.querySelector(".category-setting-row");
  row?.focus();
  row?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
})()`);
await shoot("07-category-management", "Categories");
await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: settingsShim });

// 8. Playback information, enabled before the reload so it appears as soon as a channel is chosen.
await app.evaluate(`(() => {
  const key = "openiptv.settings";
  const settings = JSON.parse(localStorage.getItem(key) || "{}");
  settings.showPlaybackStats = true;
  localStorage.setItem(key, JSON.stringify(settings));
})()`);
await cdp.send("Page.reload");
await sleep(2600);
await app.press("Enter", 13);
await sleep(1800);
await shoot("08-playback-information", "Playback information");

// 9 and 10. The phone sized Remote access page, with its management view and Smart Remote.
const remoteState = {
  revision: 4,
  locale: "en",
  direction: "ltr",
  labels: { aboutVersion: "Version 1.7.0" },
  localeOptions: [{ id: "en", label: "English" }],
  settings: {
    locale: "en",
    fontSizeId: "m",
    showNumbers: true,
    showLogos: true,
    aspectId: "fill",
    showClock: true,
    resumeLast: true,
    sortAlphabetically: false,
    compatibility: false,
    showPlaybackStats: false,
  },
  playlists: [
    { id: "example", name: "Example", url: "https://example.com/playlist.m3u" },
    { id: "family", name: "Family channels", url: "https://example.com/family.m3u" },
  ],
  activePlaylistId: "example",
  setup: { name: "", url: "" },
  devices: [{ id: "readme-device", name: "Living room phone", createdAt: 1, lastUsedAt: Date.now() }],
  about: { version: "1.7.0", repository: "https://github.com/shayanline/OpenIPTV" },
  operation: { loading: false, error: "", errorKey: "", errorDetail: "" },
};
cdp.on("Fetch.requestPaused", ({ requestId }) => {
  void cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify(remoteState)).toString("base64"),
  });
});
await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v1/state" }] });
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 430, height: 900, deviceScaleFactor: 1, mobile: true,
});
await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/remote/index.html` });
await sleep(800);
await app.evaluate(`localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "readme-device", credential: "readme" }))`);
await cdp.send("Page.reload");
await sleep(1200);
await app.evaluate(`(() => {
  document.documentElement.style.scrollBehavior = "auto";
  document.querySelector(".tabs").style.scrollBehavior = "auto";
  document.querySelector("#appearance").hidden = true;
  document.querySelector("#playback").hidden = true;
  document.querySelector('.tabs a[href="#playlists"]').click();
})()`);
await shoot("09-remote-access", "Family channels", 430, 900);
await app.evaluate(`document.querySelector(".remote-fab")?.click()`);
await sleep(400);
await shoot("10-smart-remote", "Smart Remote", 430, 900);

console.log(`\nAll ten are in ${OUT}/, and the README shows them.\n`);

} finally {
  cdp.close();
  browser.kill();
  server.close();
}
