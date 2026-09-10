import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import * as cdp from "../scripts/tv/cdp.mjs";

const profiles: string[] = [];

function profile() {
  const path = mkdtempSync(join(tmpdir(), "openiptv-cdp-test-"));
  profiles.push(path);
  return path;
}

afterEach(() => {
  for (const path of profiles.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("reads the debugging port assigned by Chrome", async () => {
  const path = profile();
  writeFileSync(join(path, "DevToolsActivePort"), "42173\n/devtools/browser/id\n");
  assert.equal(typeof cdp.devToolsPort, "function");
  assert.equal(await cdp.devToolsPort(path, { exitCode: null }, () => ""), 42173);
});

test("waits for Chrome to publish its debugging port", async () => {
  const path = profile();
  setTimeout(() => writeFileSync(join(path, "DevToolsActivePort"), "42174\n"), 10);
  assert.equal(await cdp.devToolsPort(path, { exitCode: null }, () => "", 2), 42174);
});

test("reports Chrome output when the browser exits before it is ready", async () => {
  const path = profile();
  await assert.rejects(
    cdp.devToolsPort(path, { exitCode: 21 }, () => "profile error"),
    /Chrome exited with code 21 before opening DevTools:\nprofile error/,
  );
});

test("reports Chrome output when browser startup times out", async () => {
  const path = profile();
  await assert.rejects(
    cdp.devToolsPort(path, { exitCode: null }, () => "startup stalled", 1),
    /Chrome did not open DevTools:\nstartup stalled/,
  );
});

test("waits for Chrome to exit after asking it to stop", async () => {
  const browser = new EventEmitter();
  Object.assign(browser, {
    exitCode: null,
    kill() {
      setTimeout(() => {
        browser.exitCode = 0;
        browser.emit("exit", 0, null);
      }, 10);
    },
  });
  assert.equal(typeof cdp.stopBrowser, "function");
  let stopped = false;
  const stopping = cdp.stopBrowser(browser).then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await stopping;
  assert.equal(stopped, true);
});
