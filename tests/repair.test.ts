import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";

vi.mock("hls.js", () => ({ default: { isSupported: () => true } }));

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

/**
 * A worker that answers as the television does, or refuses in the way a set without it would.
 *
 * `built` records every instance, because how many were made is the thing several of these tests are
 * about: one per channel change was the fault a viewer noticed.
 */
function fakeWorker(behaviour: "listens" | "refuses" | "silent" | "deaf") {
  const sent: unknown[] = [];
  const built: Fake[] = [];
  vi.stubGlobal("webapis", { avplay: {} });
  class Fake {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    terminated = false;
    constructor() { built.push(this); }
    postMessage(message: unknown) {
      sent.push(message);
      const type = (message as { type?: string })?.type;
      if (type === "stop") {
        // As the real worker does: close the socket, then say so, which is what allows the main
        // thread to terminate this without leaking the descriptor. A deaf one binds normally and
        // then never answers, which is the case the acknowledgement timeout exists for.
        if (behaviour !== "deaf") {
          setTimeout(() => this.onmessage?.({ data: { type: "stopped" } }), 0);
        }
        return;
      }
      if (type !== "start") return;
      if (behaviour === "listens" || behaviour === "deaf") {
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
  return { sent, built };
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
  const { sent } = fakeWorker("listens");
  const { repair, repairState } = await load();

  assert.equal(await repair("https://host.example/healthy/index.m3u8"), null);
  assert.equal(sent.length, 0, "a worker was started for a channel that did not need one");
  assert.equal(repairState().state, "idle");
});

test("preflight keeps a healthy master on its source and measures its child segments", async () => {
  const { sent } = fakeWorker("listens");
  const master = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=1",
    "high.m3u8",
    "",
  ].join("\n");
  const child = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-MEDIA-SEQUENCE:42",
    "#EXTINF:10.0,",
    "segment.ts",
    "",
  ].join("\n");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
    ok: true,
    url,
    text: async () => url.endsWith("high.m3u8") ? child : master,
  })));

  const { prepare } = await load();
  const target = await prepare(UPSTREAM);

  assert.equal(target?.url, UPSTREAM);
  assert.equal(target?.repaired, false);
  assert.equal(target?.bufferSeconds, 11);
  assert.equal(sent.length, 0, "a healthy master opened the repair socket");
});

test("a healthy diagnosis survives a relaunch and skips the next preflight fetch", async () => {
  const { prepare } = await load();
  const first = await prepare("https://host.example/healthy/index.m3u8");
  assert.equal(first?.repaired, false);
  assert.equal(fetch.mock.calls.length, 1);

  const next = await load();
  const second = await next.prepare("https://host.example/healthy/index.m3u8");

  assert.equal(second?.url, "https://host.example/healthy/index.m3u8");
  assert.equal(second?.repaired, false);
  assert.equal(fetch.mock.calls.length, 1);
});

test("revalidation uses HTTP validators and rediagnoses changed playlists", async () => {
  let version = 1;
  const fetchMock = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
    const validators = init?.headers ?? {};
    if (version === 1 && validators["If-None-Match"] === '"v1"') {
      return {
        ok: false,
        status: 304,
        url: UPSTREAM,
        headers: { get: () => '"v1"' },
        text: async () => "",
      };
    }
    return {
      ok: true,
      status: 200,
      url: UPSTREAM,
      headers: { get: (name: string) => name === "etag" ? `"v${version}"` : "" },
      text: async () => version === 1 ? HEALTHY : BROKEN,
    };
  });
  vi.stubGlobal("fetch", fetchMock);

  const { prepare, revalidate, knownToNeedRepair } = await load();
  await prepare(UPSTREAM);
  assert.equal(await revalidate(UPSTREAM), false);
  assert.equal(fetchMock.mock.calls[1][1]?.headers?.["If-None-Match"], '"v1"');

  version = 2;
  assert.equal(await revalidate(UPSTREAM), true);
  assert.equal(knownToNeedRepair(UPSTREAM), true);
});

test("a failure forces a fresh diagnosis when a cached healthy playlist changes", async () => {
  let playlist = HEALTHY;
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    text: async () => playlist,
  })));

  const { prepare, repair } = await load();
  await prepare("https://host.example/healthy/index.m3u8");
  playlist = BROKEN;
  fakeWorker("listens");

  const repaired = await repair("https://host.example/healthy/index.m3u8");

  assert.ok(repaired, "the changed playlist was not repaired");
  assert.equal(fetch.mock.calls.length, 2);
});

test("a browser repair keeps the source URL for hls.js", async () => {
  const { repair } = await load();

  const repaired = await repair(UPSTREAM);

  assert.deepEqual(repaired, { url: UPSTREAM, upstream: UPSTREAM, browser: true });
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
  const { sent } = fakeWorker("listens");
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

  const { sent: fakes } = fakeWorker("listens");
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

test("the socket is closed before the worker is killed", async () => {
  /*
   * The fault a viewer found by changing channel quickly. This used to post "stop" and call
   * terminate() on the next line, and postMessage is delivered asynchronously while terminate is
   * immediate, so the worker died before it ever saw the message.
   *
   * That matters because the descriptor belongs to the application and not to the worker: the
   * platform's bindings run outside the worker's memory, so killing it leaks a listening socket for
   * the life of the app, and enough of them exhausts what the platform will hand out.
   */
  const { sent, built } = fakeWorker("listens");
  const { repair, stopRepair } = await load();

  await repair(UPSTREAM);
  stopRepair();

  assert.equal(built[0].terminated, false, "it was killed before the socket could be closed");
  assert.ok(sent.some((m) => (m as { type: string }).type === "stop"), "it was never asked to stop");

  await new Promise((r) => setTimeout(r, 5));          // the worker's acknowledgement
  assert.equal(built[0].terminated, true, "it was not killed once the socket was closed");
});

test("a worker that stops answering is killed anyway, rather than left running", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { built } = fakeWorker("deaf");
  const { repair, stopRepair } = await load();

  await repair(UPSTREAM);
  stopRepair();
  assert.equal(built[0].terminated, false);

  await vi.advanceTimersByTimeAsync(1600);            // past the acknowledgement timeout
  assert.equal(built[0].terminated, true, "a silent worker was left running for ever");
});

test("a channel needing no repair leaves the socket listening rather than closing it", async () => {
  /*
   * The other half of the same fault. Tearing down on every switch away from a repaired channel
   * meant closing a socket and discarding a compiled WebAssembly module, then building both again
   * on the way back, and walking a channel list crosses that boundary once per press.
   */
  const { built } = fakeWorker("listens");
  const { repair, idleRepair, repairState } = await load();

  await repair(UPSTREAM);
  idleRepair();

  const idled = repairState();
  assert.equal(idled.state, "listening");
  assert.equal(idled.port, 45678, "the port was given up");
  assert.equal(idled.upstream, "", "it still claims to be serving something");
  assert.equal(built.length, 1);
  assert.equal(built[0].terminated, false, "the worker was killed for a channel that just did not need it");

  // And coming back is free: the same worker, the same port, no second module compiled.
  const again = await repair(UPSTREAM);
  assert.equal(again?.url, "http://127.0.0.1:45678/live.m3u8");
  assert.equal(built.length, 1, "a second worker was created for a socket that was already open");
});

test("walking up and down a list of channels creates one worker, not one per press", async () => {
  const { built } = fakeWorker("listens");
  const { repair, idleRepair } = await load();

  for (let press = 0; press < 6; press += 1) {
    await repair(UPSTREAM);                            // a channel that needs the repair
    idleRepair();                                      // and one that does not
  }
  assert.equal(built.length, 1, `${built.length} workers for six round trips`);
});

test("a slow answer for a channel nobody is watching cannot take over the socket", async () => {
  /*
   * Two channels from the same source in quick succession. Both fetches are in flight at once, and
   * whichever finished last used to decide what the socket served, which could be the channel the
   * viewer had already left while the player was asking for the new one.
   */
  fakeWorker("listens");
  const second = "https://host.example/live/second.m3u8";
  const slow = new Map([[UPSTREAM, 40], [second, 5]]);  // the first channel answers late
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    await new Promise((r) => setTimeout(r, slow.get(String(url)) ?? 0));
    return { ok: true, text: async () => BROKEN };
  }));

  const { repair, repairState } = await load();
  const first = repair(UPSTREAM);
  const latest = repair(second);

  assert.equal(await latest !== null, true, "the channel actually being watched was not repaired");
  assert.equal(await first, null, "the abandoned channel was still allowed to publish");
  assert.equal(repairState().upstream, second, "the socket is serving the wrong channel");
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
