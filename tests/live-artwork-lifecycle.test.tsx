import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountApp, settle, XTREAM_SOURCE, xtreamFetch } from "./support/app";

const logoUrls = Array.from({ length: 6 }, (_, index) => `http://images.example/${index}.png`);
const responses: Array<() => void> = [];
const signals: AbortSignal[] = [];
let releaseAll: (() => void) | undefined;

beforeEach(() => {
  responses.length = 0;
  signals.length = 0;
  releaseAll = undefined;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // No displayed rows claim logos. Only the neighbouring category warmer can request them.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 76, height: 48, close: vi.fn() })),
  );
  vi.doMock("../src/services/workload", () => ({
    artworkWorkload: () => ({ loads: 4, decodes: 2, prefetch: 2 }),
    observeArtworkWorkload: () => () => {},
    recordArtworkDecode: () => {},
    recordArtworkLoad: () => {},
    trackArtworkWork: () => () => {},
  }));
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const respond of responses.splice(0)) respond();
    await Promise.resolve();
  });
  releaseAll?.();
  localStorage.clear();
  vi.doUnmock("../src/services/workload");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountLive() {
  const provider = xtreamFetch(
    [
      { category_id: "10", category_name: "News" },
      { category_id: "20", category_name: "Sports" },
    ],
    [
      { stream_id: "1", name: "News One", category_id: "10", stream_type: "live" },
      ...logoUrls.map((stream_icon, index) => ({
        stream_id: String(index + 2),
        name: `Sports ${index}`,
        category_id: "20",
        stream_type: "live",
        stream_icon,
      })),
    ],
  );
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input, init) => {
      if (!logoUrls.includes(String(input))) return provider(input);
      signals.push(init!.signal!);
      return new Promise<Response>((resolve) =>
        responses.push(() => resolve(new Response(new Blob(["logo"])))),
      );
    },
  });
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  return service;
}

async function chooseMode(mode: "live" | "movie" | "series") {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-navigation-action="${mode}"]`,
  );
  expect(button).toBeTruthy();
  fireEvent.click(button!);
  // The readiness barrier spans animation frames, so let each phase settle separately.
  for (const ms of [300, 10, 60, 300]) await settle(ms);
  expect(document.querySelector(".live-host")?.classList.contains("hidden")).toBe(
    mode !== "live",
  );
}

test.each(["movie", "series"] as const)(
  "%s cancels delayed Live neighbour warming and returning to Live resumes it",
  async (mode) => {
    await mountLive();
    await chooseMode(mode);
    await settle(3000);
    expect(signals).toHaveLength(0);

    // Changing settings behind an opaque VOD page must not restart Live's chain.
    const { useSettings } = await import("../src/stores/settings");
    act(() => useSettings.getState().set("showLogos", false));
    act(() => useSettings.getState().set("showLogos", true));
    await settle(3000);
    expect(signals).toHaveLength(0);

    await chooseMode("live");
    await settle(1800);
    expect(signals).toHaveLength(2);
  },
);

test("VOD stops later Live warming batches without cancelling a shared displayed logo", async () => {
  const service = await mountLive();
  await settle(1250);
  expect(signals).toHaveLength(2);
  const request = { url: logoUrls[0], kind: "logo" as const, width: 76, height: 48 };
  // A displayed owner joins work that the Live warmer already started.
  service.claimArtwork(request);
  const displayed = service.loadArtwork(request);
  await chooseMode("movie");
  expect(signals[0].aborted).toBe(false);
  await act(async () => {
    for (const respond of responses.splice(0)) respond();
    await displayed;
  });
  await settle(3000);
  expect(signals).toHaveLength(2);
  expect(service.artworkOf(request)).not.toBeNull();
  service.releaseArtwork(request);

  await chooseMode("live");
  await settle(1800);
  expect(signals).toHaveLength(4);
});
