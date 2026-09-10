import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { driver, serve } from "../scripts/tv/harness.mjs";

test("lets the operating system assign the fixture server port", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-harness-test-"));
  writeFileSync(join(root, "index.html"), "ready");
  const hosted = await serve(root);
  try {
    assert.ok(Number.isInteger(hosted.port) && hosted.port > 0);
    assert.equal(typeof hosted.close, "function");
    assert.equal(await fetch(`http://127.0.0.1:${hosted.port}/`).then((response) => response.text()), "ready");
  } finally {
    if (hosted.close) await hosted.close();
    else await new Promise((resolve) => hosted.server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("installs the fixture seed before navigating to the application", async () => {
  const calls: string[] = [];
  const cdp = {
    async send(method: string) {
      calls.push(method);
      return method === "Runtime.evaluate" ? { result: { value: true } } : {};
    },
  };
  await driver(cdp, 4321).open();
  const seeded = calls.indexOf("Page.addScriptToEvaluateOnNewDocument");
  assert.ok(seeded >= 0 && seeded < calls.indexOf("Page.navigate"));
});

test("waits for a requested key transition instead of sleeping", async () => {
  let ready = false;
  const cdp = {
    async send(method: string, params: { type?: string } = {}) {
      if (method === "Input.dispatchKeyEvent" && params.type === "keyUp") {
        setTimeout(() => { ready = true; }, 200);
      }
      if (method === "Runtime.evaluate") return { result: { value: ready } };
      return {};
    },
  };
  await driver(cdp, 4321).press("ArrowLeft", 37, "window.ready");
  assert.equal(ready, true);
});
