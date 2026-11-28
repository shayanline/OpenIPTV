import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlayerEvent } from "../src/services/player";

const library = class Hls {};

function pendingScript(): HTMLScriptElement {
  const script = document.querySelector<HTMLScriptElement>('script[src*="hls.min.js"]');
  if (!script) throw new Error("The HLS script was not requested");
  return script;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv("DEV", false);
  vi.stubEnv("MODE", "production");
  vi.stubGlobal("Hls", undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  document.querySelectorAll('script[src*="hls.min.js"]').forEach((script) => {
    script.remove();
  });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("concurrent browser requests share one classic script and retain the loaded library", async () => {
  const { loadHlsLibrary } = await import("../src/services/hlsLoader");
  const first = loadHlsLibrary();
  const second = loadHlsLibrary();
  expect(second).toBe(first);
  expect(document.querySelectorAll('script[src*="hls.min.js"]')).toHaveLength(1);

  vi.stubGlobal("Hls", library);
  pendingScript().dispatchEvent(new Event("load"));

  await expect(first).resolves.toBe(library);
  await expect(loadHlsLibrary()).resolves.toBe(library);
  expect(document.querySelectorAll('script[src*="hls.min.js"]')).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["error", "unregistered", "timeout"])(
  "a %s failure cleans up and permits a fresh browser request",
  async (failure) => {
    const { loadHlsLibrary } = await import("../src/services/hlsLoader");
    const first = loadHlsLibrary();
    const rejected = expect(first).rejects.toThrow(
      failure === "error"
        ? "could not be loaded"
        : failure === "timeout"
          ? "timed out"
          : "did not register",
    );
    const script = pendingScript();
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(15_000);
    else script.dispatchEvent(new Event(failure === "error" ? "error" : "load"));
    await rejected;
    expect(script.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const retry = loadHlsLibrary();
    expect(pendingScript()).not.toBe(script);
    vi.stubGlobal("Hls", library);
    pendingScript().dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBe(library);
  },
);

test("an existing library does not request another script", async () => {
  vi.stubGlobal("Hls", library);
  const { loadHlsLibrary } = await import("../src/services/hlsLoader");
  await expect(loadHlsLibrary()).resolves.toBe(library);
  expect(document.querySelectorAll('script[src*="hls.min.js"]')).toHaveLength(0);
});

test.each([false, true])(
  "a library load failure respects playback ownership when stopped is %s",
  async (stopped) => {
    const { Player } = await import("../src/services/player");
    const events: PlayerEvent[] = [];
    const player = new Player((event) => events.push(event));
    player.attach(document.createElement("video"));
    player.play({
      url: "https://stream.invalid/live.m3u8",
      mode: "live",
      browserRepair: false,
      bufferSeconds: 6,
      segmentSeconds: 3,
      startSeconds: 0,
    });
    if (stopped) player.stop();
    pendingScript().dispatchEvent(new Event("error"));
    await Promise.resolve();
    await Promise.resolve();
    expect(events.filter((event) => event.type === "error")).toEqual(
      stopped ? [] : [{ type: "error", code: "HLS_LIBRARY_NETWORK_ERROR", warmKind: "network" }],
    );
    player.detach();
  },
);
