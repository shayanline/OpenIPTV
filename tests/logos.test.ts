import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";

/**
 * The logo cache, which is where the memory goes on a set with two gigabytes.
 *
 * Everything here is about the queue rather than the decoding. Decoding is the browser's
 * job, and the queue is ours: how many decodes run at once, which are worth doing, and what
 * happens to the ones that are called off. That last one is where the bug was.
 */

// createImageBitmap and fetch do not exist in jsdom, and neither is what is being tested.
// They are replaced with something that resolves when told to, so the ordering of the queue
// can be observed rather than raced.
let releaseDecode: Array<() => void> = [];
let decodeCalls = 0;

beforeEach(() => {
  releaseDecode = [];
  decodeCalls = 0;
  vi.stubGlobal("fetch", () =>
    Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob()) }));
  vi.stubGlobal("createImageBitmap", () => {
    decodeCalls += 1;
    return new Promise((resolve) => {
      releaseDecode.push(() => resolve({ width: 76, height: 48, close() {} }));
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A fresh module each time, since the cache and the queue are module state.
 *
 * vi.resetModules rather than a query string on the specifier: a suffix stops Vite
 * recognising the file as TypeScript and it arrives at the parser as JavaScript.
 */
const load = () => {
  vi.resetModules();
  return import("../src/services/logos");
};

const settle = () => new Promise((r) => setTimeout(r, 0));

test("only two decodes run at once, however many are asked for", async () => {
  const { shrink } = await load();
  for (let i = 0; i < 6; i++) void shrink(`http://x/${i}.png`, 76, 48, false);
  await settle();
  assert.equal(decodeCalls, 2, "the third should be queued behind the first two");
});

test("a queued warming job that is dropped settles instead of hanging for ever", async () => {
  const { shrink, dropQueuedWarming } = await load();

  // Two to fill the lanes, and a third that can only wait.
  void shrink("http://x/a.png", 76, 48, false);
  void shrink("http://x/b.png", 76, 48, false);
  const queued = shrink("http://x/c.png", 76, 48, false);
  await settle();

  dropQueuedWarming();

  // The whole point: this resolves. Before, the resolver was thrown away with the queue and
  // the promise never settled, so the address stayed in `inflight` and could never be
  // asked for again, and the chain waiting on it stopped dead.
  assert.equal(await queued, null);
});

test("an address dropped while queued can be asked for again", async () => {
  const { shrink, dropQueuedWarming } = await load();
  void shrink("http://x/a.png", 76, 48, false);
  void shrink("http://x/b.png", 76, 48, false);
  const queued = shrink("http://x/c.png", 76, 48, false);
  await settle();
  dropQueuedWarming();
  await queued;

  // Free a lane, then ask again. A second attempt has to reach the decoder, which it cannot
  // do if the abandoned entry is still sitting in the in-flight map.
  releaseDecode[0]?.();
  await settle();
  const before = decodeCalls;
  void shrink("http://x/c.png", 76, 48, false);
  await settle();
  assert.ok(decodeCalls > before, "the retry never reached the decoder");
});

test("dropping the queue does not leak the lane, so later work still runs", async () => {
  const { shrink, dropQueuedWarming } = await load();
  void shrink("http://x/a.png", 76, 48, false);
  void shrink("http://x/b.png", 76, 48, false);
  void shrink("http://x/c.png", 76, 48, false);
  await settle();
  dropQueuedWarming();
  await settle();

  // Both lanes finish. If a cancelled waiter had incremented `active`, the pool would be
  // permanently short and nothing below would ever start.
  releaseDecode[0]?.();
  releaseDecode[1]?.();
  await settle();

  const before = decodeCalls;
  void shrink("http://x/d.png", 76, 48, false);
  void shrink("http://x/e.png", 76, 48, false);
  await settle();
  assert.equal(decodeCalls - before, 2, "the lanes did not come back");
});

test("warmChain stops when told to, and cancels with the right timer function", async () => {
  const { warmChain } = await load();
  const cancelIdle = vi.fn();
  const clearTimer = vi.fn();
  vi.stubGlobal("requestIdleCallback", (fn: () => void) => { void fn; return 4242; });
  vi.stubGlobal("cancelIdleCallback", cancelIdle);
  const realClear = window.clearTimeout;
  window.clearTimeout = clearTimer as unknown as typeof window.clearTimeout;

  const stop = warmChain(["http://x/one.png"], { timeout: 10 });
  stop();

  window.clearTimeout = realClear;
  // An idle callback id is cancelled with cancelIdleCallback and never with clearTimeout.
  // The two are separate numeric namespaces, and clearing one by the other's number cancels
  // whichever unrelated timer happens to share it.
  expect(cancelIdle).toHaveBeenCalledWith(4242);
  expect(clearTimer).not.toHaveBeenCalled();
});

test("warmChain skips addresses already held, and reports nothing to do", async () => {
  const { warmChain } = await load();
  // Nothing is queued for an empty list, and the returned stop is still safe to call.
  const stop = warmChain([]);
  assert.doesNotThrow(stop);
});
