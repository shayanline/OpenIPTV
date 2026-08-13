#!/usr/bin/env node
/**
 * Redraw public/icon.png from public/icon.svg.
 *
 * The widget carries one bitmap: config.xml names a single <icon>, and the set draws it at
 * whatever size its launcher wants. So the vector is the master and the bitmap is output,
 * which is the only way the two cannot drift.
 *
 * Chrome does the rasterising, because it is already the tool this project measures against
 * and it is the only renderer here that is certain to exist. The alternatives all mean
 * installing something: librsvg, ImageMagick, or a native npm dependency that has to build.
 *
 * 512 rather than the 117 Tizen Studio scaffolds. 117 is what Samsung's own template ships
 * and what the set uses for a sideloaded widget, but every launcher and every store size is
 * a downscale from here, and downscaling a larger master stays sharp where upscaling a
 * smaller one does not. It costs under 100kB, against the 300kB Samsung allows for a store
 * icon, and nothing but the installer ever reads it.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, findChrome } from "./tv/cdp.mjs";

const SIZE = 512;
const PORT = 9333;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "public", "icon.svg");
const out = join(root, "public", "icon.png");

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome, Chromium or Edge found, and one of them has to draw the icon.");
  process.exit(1);
}

const userDir = join(tmpdir(), "simpleiptv-icon");
mkdirSync(userDir, { recursive: true });
const child = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`,
  "--force-device-scale-factor=1",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "about:blank",
], { stdio: "ignore" });

const cdp = await connect(PORT);
await cdp.send("Page.enable");
/*
 * The viewport is the canvas, since an SVG with only a viewBox fills whatever box it is
 * given. It is set here rather than with the window size flag, which headless treats as a
 * request and not a promise: asked for 512 square on the command line, the first render
 * came back 512x391, fitted to what the host would allow.
 */
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false,
});
// Nothing behind the page, so the corners the squircle clips away stay transparent.
await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
  color: { r: 0, g: 0, b: 0, a: 0 },
});

const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
await cdp.send("Page.navigate", { url: pathToFileURL(source).href });
await loaded;

/*
 * An SVG is XML, and Chrome answers a malformed one with a rendered error page rather than
 * a failure. Screenshot that and the app ships an icon of the error message, which is how
 * this was found out.
 */
const { result } = await cdp.send("Runtime.evaluate", {
  expression: "document.documentElement.tagName",
});
if (result.value !== "svg") {
  console.error(`${source} is not well formed XML: Chrome parsed it as <${result.value}>.`);
  cdp.close();
  child.kill();
  process.exit(1);
}

const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
const png = Buffer.from(data, "base64");
writeFileSync(out, png);
cdp.close();
child.kill();

console.log(`public/icon.png  ${SIZE}x${SIZE}, ${Math.round(png.length / 1024)}kB`);
