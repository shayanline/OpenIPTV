import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";

/**
 * The service that decides whether to repair a stream, and remembers the answer.
 *
 * Reloaded per test, because it holds one socket and one verdict for the whole session on purpose:
 * a television without the socket bindings must be asked once and never again, and a test that
 * inherited that verdict from the test before would prove nothing.
 */

const UPSTREAM = "https://host.example/live/index.m3u8";
const BROKEN = [
  "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2",
  "#EXT-X-MEDIA-SEQUENCE:1786136377905810", "#EXTINF:2.0,", "a.ts", "",
].join("\n");
const HEALTHY = BROKEN.replace("1786136377905810", "42");

/** A worker that answers as the television does, or refuses in the way a set without it would. */
function fakeWorker(behaviour: "listens" | "refuses" | "silent") {
  const sent: unknown[] = [];
  class Fake {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminated = false;
    postMessage(message: unknown) {
      sent.push(message);
      const type = (message as { type?: string })?.type;
      if (type !== "start") return;
      if (behaviour === "listens") {
        setTimeout(() => this.onmessage?.({ data: { type: "listening", port: 45678 } }), 0);
      } else if (behaviour === "refuses") {
        setTimeout(() => this.onmessage?.({
          data: { type: "error", reason: "no socket bindings on this television" },
        }), 0);
      }
    }
    terminate() { this.terminated = true; }
  }
  vi.stubGlobal("Worker", Fake as unknown as typeof Worker);
  return sent;
}

/**
 * A fresh copy of the module, which is what a launch is.
 *
 * resetModules rather than a query string on the import: a query defeats Vite's TypeScript
 * transform, and the failure reads as a parse error inside the module under test.
 */
const load = async () => {
  vi.resetModules();
  return await import("../src/services/repair");
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    text: async () => (String(url).includes("healthy") ? HEALTHY : BROKEN),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("a playlist the set can read is not repaired, and no socket is opened", async () => {
  const sent = fakeWorker("listens");
  const { repair, repairState } = await load();

  assert.equal(await repair("https://host.example/healthy/index.m3u8"), null);
  assert.equal(sent.length, 0, "a worker was started for a channel that did not need one");
  assert.equal(repairState().state, "idle");
});

test("a playlist the set cannot read is served from a loopback address", async () => {
  fakeWorker("listens");
  const { repair, repairState } = await load();

  const repaired = await repair(UPSTREAM);
  assert.ok(repaired, "nothing was repaired");
  assert.match(repaired.url, /^http:\/\/127\.0\.0\.1:45678\//);
  assert.equal(repairState().state, "serving");
  assert.equal(repairState().upstream, UPSTREAM);
});

test("the same stream asked for twice does not start a second server", async () => {
  const sent = fakeWorker("listens");
  const { repair } = await load();

  const first = await repair(UPSTREAM);
  const starts = sent.filter((m) => (m as { type: string }).type === "start").length;
  const again = await repair(UPSTREAM);

  assert.equal(again?.url, first?.url);
  assert.equal(sent.filter((m) => (m as { type: string }).type === "start").length, starts);
  // And the second answer costs nothing: no second fetch of a 650KB playlist.
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("as the window slides, the number served advances by the segments that dropped off", async () => {
  /*
   * The counting the television forced on us. These streams number segments from a microsecond
   * clock, so the upstream field jumps by millions between refreshes, and anything derived from it
   * arithmetically made the player reset to the live edge every few seconds. What is served has to
   * advance by exactly one per segment, so the service counts instead: it looks for the new
   * window's first segment in the window it served last time.
   */
  const clock = 1786136377905810;
  const window = (from: number, at: number) => {
    const lines = ["#EXTM3U", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${at}`];
    for (let i = from; i < from + 5; i += 1) lines.push("#EXTINF:2.0,", `s-${i}.ts`);
    return `${lines.join("\n")}\n`;
  };

  let slid = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    // Each fetch has moved on by two segments, and the clock by four million.
    text: async () => window(slid, clock + slid * 2_000_000),
  })));

  const fakes: unknown[] = fakeWorker("listens");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { repair } = await load();

  await repair(UPSTREAM);
  slid = 2;
  await vi.advanceTimersByTimeAsync(6000);                 // one refresh
  slid = 4;
  await vi.advanceTimersByTimeAsync(6000);                 // and another

  const served = fakes
    .filter((m) => (m as { type: string }).type === "manifest")
    .map((m) => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec((m as { text: string }).text)?.[1]));

  assert.deepEqual(served, [0, 2, 4], `served ${JSON.stringify(served)}`);
});

test("a television without the bindings is asked once and then left alone", async () => {
  fakeWorker("refuses");
  const { repair, repairState } = await load();

  assert.equal(await repair(UPSTREAM), null, "it claimed to have repaired something");
  assert.equal(repairState().state, "unavailable");
  assert.match(repairState().why, /no socket bindings/);

  // The second attempt must not construct another worker or fetch again: a set that cannot do
  // this must not pay for the discovery on every channel.
  const calls = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
  assert.equal(await repair("https://other.example/live/index.m3u8"), null);
  assert.equal((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length, calls);
});

test("stopping lets go of the socket, and a later channel can start a new one", async () => {
  fakeWorker("listens");
  const { repair, repairState, stopRepair } = await load();

  await repair(UPSTREAM);
  stopRepair();
  assert.equal(repairState().state, "idle");
  assert.equal(repairState().port, 0);

  const again = await repair(UPSTREAM);
  assert.ok(again, "it could not serve again after being stopped");
});

test("a verdict about a host survives a relaunch", async () => {
  fakeWorker("listens");
  const first = await load();
  first.rememberNeedsRepair(UPSTREAM);
  assert.equal(first.knownToNeedRepair("https://host.example/other/stream.m3u8"), true);

  // A fresh module, as a launch is, reading what the last one wrote.
  const next = await load();
  assert.equal(next.knownToNeedRepair(UPSTREAM), true);
  assert.equal(next.knownToNeedRepair("https://elsewhere.example/x.m3u8"), false);
});

test("resetting everything forgets which hosts were diagnosed", async () => {
  fakeWorker("listens");
  const { rememberNeedsRepair, knownToNeedRepair, forgetRepairHosts } = await load();

  rememberNeedsRepair(UPSTREAM);
  forgetRepairHosts();
  assert.equal(knownToNeedRepair(UPSTREAM), false);
});

test("an unreachable playlist is not treated as a repairable one", async () => {
  fakeWorker("listens");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  const { repair } = await load();

  assert.equal(await repair(UPSTREAM), null);
});
