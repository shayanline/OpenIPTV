import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import * as browserTools from "../scripts/tv/browser.mjs";

const profiles: string[] = [];

function profile() {
  const path = mkdtempSync(join(tmpdir(), "openiptv-browser-test-"));
  profiles.push(path);
  return path;
}

afterEach(() => {
  vi.useRealTimers();
  for (const path of profiles.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("profile cleanup cannot override completed browser work", () => {
  assert.equal(typeof browserTools.removeProfile, "function");
  const warnings: string[] = [];
  const removed = browserTools.removeProfile(
    "/tmp/busy-profile",
    () => { throw Object.assign(new Error("directory busy"), { code: "ENOTEMPTY" }); },
    (message: string) => warnings.push(message),
  );
  assert.equal(removed, false);
  assert.match(warnings[0], /Could not remove Chrome profile.*ENOTEMPTY/);
});

test("closes Chrome through CDP before ending the process", async () => {
  assert.equal(typeof browserTools.closeBrowser, "function");
  const calls: string[] = [];
  const process = { exitCode: null, pid: 1 };
  const cdp = {
    async send(method: string) {
      calls.push(method);
      process.exitCode = 0;
    },
    close() { calls.push("socket"); },
  };
  await browserTools.closeBrowser(cdp, process);
  assert.deepEqual(calls, ["Browser.close", "socket"]);
});

test("reads the debugging port assigned by Chrome", async () => {
  const path = profile();
  writeFileSync(join(path, "DevToolsActivePort"), "42173\n/devtools/browser/id\n");
  assert.equal(typeof browserTools.devToolsPort, "function");
  assert.equal(await browserTools.devToolsPort(path, { exitCode: null }, () => ""), 42173);
});

test("waits for Chrome to publish its debugging port", async () => {
  const path = profile();
  setTimeout(() => writeFileSync(join(path, "DevToolsActivePort"), "42174\n"), 10);
  assert.equal(await browserTools.devToolsPort(path, { exitCode: null }, () => "", 2), 42174);
});

test("reports Chrome output when the browser exits before it is ready", async () => {
  const path = profile();
  await assert.rejects(
    browserTools.devToolsPort(path, { exitCode: 21 }, () => "profile error"),
    /Chrome exited with code 21 before opening DevTools:\nprofile error/,
  );
});

test("reports Chrome output when browser startup times out", async () => {
  const path = profile();
  await assert.rejects(
    browserTools.devToolsPort(path, { exitCode: null }, () => "startup stalled", 1),
    /Chrome did not open DevTools:\nstartup stalled/,
  );
});

test("waits for Chrome to exit after asking it to stop", async () => {
  const browser = new EventEmitter();
  Object.assign(browser, {
    exitCode: null,
    pid: 1,
    kill() {
      setTimeout(() => {
        browser.exitCode = 0;
        browser.emit("exit", 0, null);
      }, 10);
    },
  });
  assert.equal(typeof browserTools.stopBrowser, "function");
  let stopped = false;
  const stopping = browserTools.stopBrowser(browser).then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  await stopping;
  assert.equal(stopped, true);
});

test("clears the shutdown deadline after Chrome exits", async () => {
  vi.useFakeTimers();
  const browser = new EventEmitter();
  Object.assign(browser, {
    exitCode: null,
    pid: 1,
    kill() {
      browser.exitCode = 0;
      browser.emit("exit", 0, null);
    },
  });
  await browserTools.stopBrowser(browser);
  assert.equal(vi.getTimerCount(), 0);
});

test("does not wait for a browser process that never started", async () => {
  const browser = new EventEmitter();
  Object.assign(browser, {
    exitCode: null,
    pid: undefined,
    kill() { assert.fail("an unstarted process cannot be killed"); },
  });
  await browserTools.stopBrowser(browser);
});

test("forces Chrome to stop after graceful shutdown stalls", async () => {
  const browser = new EventEmitter();
  const signals: (string | undefined)[] = [];
  Object.assign(browser, {
    exitCode: null,
    pid: 1,
    kill(signal?: string) {
      signals.push(signal);
      if (signal === "SIGKILL") {
        browser.exitCode = 137;
        browser.emit("exit", 137, signal);
      } else {
        setTimeout(() => {
          if (browser.exitCode !== null) return;
          browser.exitCode = 0;
          browser.emit("exit", 0, null);
        }, 20);
      }
    },
  });
  await browserTools.stopBrowser(browser, 5);
  assert.deepEqual(signals, [undefined, "SIGKILL"]);
});
