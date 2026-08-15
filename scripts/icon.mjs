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
import { crc32, deflateSync, inflateSync } from "node:zlib";
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

const userDir = join(tmpdir(), "openiptv-icon");
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
const shot = Buffer.from(data, "base64");
const png = smaller(shot);
writeFileSync(out, png);
cdp.close();
child.kill();

console.log(`public/icon.png  ${SIZE}x${SIZE}, ${Math.round(png.length / 1024)}kB`
  + ` (${Math.round(shot.length / 1024)}kB as Chrome wrote it)`);

/**
 * The same pixels, deflated properly.
 *
 * Chrome's PNG encoder is tuned for a screenshot, which is to say for speed, and a smooth
 * diagonal gradient is the worst case for that: 84kB of image data that zlib gets to 48kB at
 * level 9 without touching a single pixel. Worth having, because this bitmap is the largest
 * thing in the widget and a quarter of what lands on the television, and because the
 * alternative is a tool nobody here has: pngquant, oxipng and optipng are all absent on this
 * machine, and adding one would make the icon depend on how the laptop was set up.
 *
 * Lossless, and checked rather than assumed: the round trip is inflated again and compared,
 * because a silently corrupt icon is one nobody notices until a television draws it.
 */
function smaller(original) {
  const chunks = [];
  let at = 8;                                  // past the signature
  while (at < original.length) {
    const length = original.readUInt32BE(at);
    chunks.push({
      type: original.toString("ascii", at + 4, at + 8),
      data: original.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;                         // length, type, data, CRC
  }

  const image = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(image);
  const packed = deflateSync(raw, { level: 9, memLevel: 9 });
  if (packed.length >= image.length) return original;
  if (!inflateSync(packed).equals(raw)) {
    console.error("The recompressed image does not inflate to the same pixels. Not written.");
    process.exit(1);
  }

  const write = ({ type, data }) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, tail]);
  };

  // One IDAT in place of however many Chrome emitted, and every other chunk in the order it
  // arrived, so anything Chrome may add in a future version survives untouched.
  let done = false;
  const rebuilt = chunks.flatMap((chunk) => {
    if (chunk.type !== "IDAT") return [write(chunk)];
    if (done) return [];
    done = true;
    return [write({ type: "IDAT", data: packed })];
  });
  return Buffer.concat([original.subarray(0, 8), ...rebuilt]);
}
