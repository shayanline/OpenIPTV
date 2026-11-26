import { afterEach, expect, test, vi } from "vitest";
import { applyMetrics, cssEnterEasing, cssMs } from "../src/services/metrics";

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
});

test("startup captures the immutable curve without a style read during screen mounting", () => {
  const curve = "cubic-bezier(0, 0, 0.2, 1)";
  document.documentElement.style.setProperty("--ease-enter", curve);
  applyMetrics();
  const style = vi.spyOn(window, "getComputedStyle");
  expect(cssEnterEasing()).toBe(curve);
  expect(cssEnterEasing()).toBe(curve);
  expect(style).not.toHaveBeenCalled();
});

test("metric initialization refreshes the curve while duration tokens remain live", () => {
  document.documentElement.style.setProperty("--ease-enter", "ease-in");
  applyMetrics();
  expect(cssEnterEasing()).toBe("ease-in");
  document.documentElement.style.setProperty("--ease-enter", "ease-out");
  applyMetrics();
  expect(cssEnterEasing()).toBe("ease-out");
  document.documentElement.style.setProperty("--t-panel", "240ms");
  expect(cssMs("--t-panel")).toBe(240);
  document.documentElement.style.setProperty("--t-panel", "0s");
  expect(cssMs("--t-panel")).toBe(0);
});

test("an unavailable curve can be resolved after the stylesheet arrives", () => {
  applyMetrics();
  expect(cssEnterEasing()).toBe("");
  document.documentElement.style.setProperty("--ease-enter", "ease-in-out");
  expect(cssEnterEasing()).toBe("ease-in-out");
});
