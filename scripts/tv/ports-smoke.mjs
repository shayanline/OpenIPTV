#!/usr/bin/env node
/**
 * Exercise the actual release ZIPs without Samsung shims or a development proxy.
 * This gate covers packaging and navigation. It cannot certify a TV decoder or SDK wrapper.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { TV_TARGETS } from "../../src/services/tvTargets.ts";
import { run } from "../tv-ports.mjs";
import { withBrowser } from "./browser.mjs";
import { findChrome } from "./cdp.mjs";
import { driver } from "./harness.mjs";

const root = resolve(import.meta.dirname, "../..");
const output = join(root, "build/ports");
const manifest = JSON.parse(readFileSync(join(output, "OpenIPTV-ports.json"), "utf8"));
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(manifest.version, version, "Port artifacts do not match the application version.");
const chrome = findChrome();
if (!chrome) throw new Error("Chrome or Chromium is required for the port artifact smoke gate.");

const temporary = mkdtempSync(join(tmpdir(), "openiptv-ports-smoke-"));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const playlist =
  "#EXTM3U\n#EXTINF:-1 group-title=\"Fixture\",Port Alpha\n" +
  "https://example.invalid/alpha.m3u8\n" +
  "#EXTINF:-1 group-title=\"Fixture\",Port Beta\nhttps://example.invalid/beta.m3u8\n";

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/fixture.m3u") {
      response.writeHead(200, { "content-type": "audio/x-mpegurl" }).end(playlist);
      return;
    }
    const file = resolve(temporary, `.${pathname}`);
    const local = relative(temporary, file);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    if (!(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" })
      .end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});

try {
  for (const [target, profile] of Object.entries(TV_TARGETS)) {
    const artifact = manifest.artifacts.find(
      (entry) => entry.target === target && entry.name.endsWith(".zip"),
    );
    assert.ok(artifact, `Missing release ZIP for ${target}.`);
    assert.equal(
      createHash("sha256").update(readFileSync(join(output, artifact.name))).digest("hex"),
      artifact.sha256,
      `Checksum mismatch for ${target}.`,
    );
    run("unzip", ["-q", join(output, artifact.name), "-d", join(temporary, target)]);
    const identity = JSON.parse(
      readFileSync(join(temporary, target, "platform-release.json"), "utf8"),
    );
    assert.equal(identity.target, target);
    assert.equal(identity.version, version);
    assert.equal(identity.hardwareVerified, false);
    assert.equal(identity.storePublished, false);
    for (const excluded of ["config.xml", "wasm", "remote", "demo"]) {
      await assert.rejects(stat(join(temporary, target, excluded)), { code: "ENOENT" });
    }
    if (target === "webos") {
      const appinfo = JSON.parse(
        readFileSync(join(temporary, target, "appinfo.json"), "utf8"),
      );
      assert.equal(appinfo.version, version);
      assert.equal(appinfo.disableBackHistoryAPI, true);
      for (const size of [80, 130, 400]) {
        const png = readFileSync(join(temporary, target, `icon-${size}.png`));
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
      }
    }
    console.log(`${profile.name}: artifact identity, contents and checksum match.`);
  }

  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const { port } = server.address();

  for (const target of Object.keys(TV_TARGETS)) {
    await withBrowser(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
      ],
      `openiptv-${target}-`,
      async (cdp) => {
        const errors = [];
        cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
          errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
        });
        cdp.on("Network.responseReceived", ({ response }) => {
          if (response.status >= 400) errors.push(`HTTP ${response.status}: ${response.url}`);
        });
        await cdp.send("Runtime.enable");
        await cdp.send("Network.enable");
        await cdp.send("Page.enable");
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `localStorage.setItem("openiptv.settings", JSON.stringify({
            playlists: [{ id: "port-fixture", name: "Fixture", url: "/fixture.m3u" }],
            activePlaylistId: "port-fixture", resumeLast: false, panelTimeout: 0, locale: "en"
          }));`,
        });
        const d = driver(cdp, port);
        await cdp.send("Page.navigate", {
          url: `http://127.0.0.1:${port}/${target}/index.html`,
        });
        await d.waitFor(
          `!!document.querySelector(".panel:not(.away)") && document.body.textContent.includes("Port Alpha")`,
        );
        assert.equal(
          await d.evaluate(
            `document.querySelector('meta[name="openiptv-platform"]').content`,
          ),
          target,
        );
        assert.equal(
          await d.evaluate(`!!window.webapis || !!window.tizen`),
          false,
          "The new port must run without Samsung shims.",
        );
        await d.evaluate("document.fonts.ready.then(() => true)");

        // Partner key maps remain a device acceptance gate. Named Back covers their shared UI.
        const back =
          target === "webos"
            ? [461, "GoBack"]
            : target === "titan"
              ? [8, "Backspace"]
              : target === "vega"
                ? [27, "Escape"]
                : [166, "BrowserBack"];
        const pressBack = () =>
          d.evaluate(`(() => {
            for (const type of ["keydown", "keyup"]) {
              const event = new KeyboardEvent(type, {
                key: ${JSON.stringify(back[1])}, bubbles: true, cancelable: true
              });
              Object.defineProperty(event, "keyCode", { value: ${back[0]} });
              window.dispatchEvent(event);
            }
            return true;
          })()`);
        await pressBack();
        await d.waitFor("!!document.querySelector('.panel.away')");
        await d.press("Enter", 13, "!!document.querySelector('.panel:not(.away)')");
        await pressBack();
        await d.waitFor("!!document.querySelector('.panel.away')");
        await pressBack();
        await d.waitFor("!!document.querySelector('[role=\"dialog\"]')");
        await pressBack();
        await d.waitFor("!document.querySelector('[role=\"dialog\"]')");
        assert.deepEqual(errors, [], `${target} had runtime or resource failures.`);
      },
    );
    console.log(`${target}: production app loads and Back/OK navigation works without TV shims.`);
  }
  console.log(
    "Port artifact smoke gate passed. Native playback, TV installation and store approval remain unverified.",
  );
} finally {
  await new Promise((done) => server.close(done));
  rmSync(temporary, { recursive: true, force: true });
}
