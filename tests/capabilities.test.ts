import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { markCapabilities, supportsFlexGap } from "../src/services/capabilities";

/**
 * The flex gap probe, which decides how the whole interface is spaced.
 *
 * Worth a test because the failure is silent in both directions. Answer yes on a set that
 * cannot do it and every row in the app collapses to no spacing. Answer no on one that can
 * and every row gets margins on top of gaps it already has.
 *
 * jsdom does no layout, so scrollWidth is always zero and the probe reads as unsupported.
 * That is convenient: it is exactly the branch that never runs in a browser anybody here can
 * open, so it is the branch worth pinning down.
 */

afterEach(() => {
  document.documentElement.className = "";
  vi.restoreAllMocks();
});

test("an engine that does not apply the gap is detected as not having it", () => {
  // jsdom reports zero, which is what a Chromium 76 television reports for a flex gap.
  assert.equal(supportsFlexGap(), false);
});

test("an engine that does apply the gap is detected as having it", () => {
  // The probe's two children have no width, so a scroll width of one is the gap itself.
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1);
  assert.equal(supportsFlexGap(), true);
});

test("the probe leaves nothing behind in the document", () => {
  const before = document.body.childNodes.length;
  supportsFlexGap();
  assert.equal(document.body.childNodes.length, before);
});

test("a set without flex gap is marked, so the fallback spacing applies", () => {
  markCapabilities();
  assert.ok(document.documentElement.classList.contains("no-flex-gap"));
});

test("a set with flex gap is left unmarked, so nothing extra applies", () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1);
  markCapabilities();
  assert.ok(!document.documentElement.classList.contains("no-flex-gap"));
});
