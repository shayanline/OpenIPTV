import { afterEach, expect, test, vi } from "vitest";
import { createArtworkWorkload } from "../src/services/workload";

type Policy = ReturnType<typeof createArtworkWorkload>;

const healthyWindow = (policy: Policy, start: number, decodeTime = 8) => {
  for (let index = 0; index < 8; index += 1) policy.decoded(decodeTime, start + 50);
  for (let index = 0; index < 4; index += 1) policy.completed(start, start + 100);
  for (let index = 0; index < 8; index += 1) {
    policy.frame(16, start + 120 + index * 16);
  }
};

afterEach(() => vi.restoreAllMocks());

test("absent and invalid hardware hints start conservatively", () => {
  expect(createArtworkWorkload().limits()).toEqual({ loads: 4, decodes: 1, prefetch: 1 });
  expect(
    createArtworkWorkload({ cores: Number.POSITIVE_INFINITY, memoryGB: Number.NaN }).limits(),
  ).toEqual({ loads: 4, decodes: 1, prefetch: 1 });
});

test("available CPU capacity seeds downloads without assuming decode speed", () => {
  expect(createArtworkWorkload({ cores: 8, memoryGB: 8 }).limits()).toEqual({
    loads: 8,
    decodes: 1,
    prefetch: 1,
  });
});

test("the floor memory hint bounds downloads, decoding and prefetch after healthy work", () => {
  const floor = createArtworkWorkload({ cores: 4, memoryGB: 1 });
  for (let window = 0; window < 12; window += 1) healthyWindow(floor, window * 1500);
  expect(floor.limits()).toEqual({ loads: 6, decodes: 1, prefetch: 1 });
});

test("the intermediate memory hint preserves its own load and prefetch bounds", () => {
  const policy = createArtworkWorkload({ cores: 8, memoryGB: 2 });
  for (let window = 0; window < 12; window += 1) healthyWindow(policy, window * 1500);
  expect(policy.limits()).toEqual({ loads: 12, decodes: 2, prefetch: 2 });
});

test("sustained measured headroom unlocks concurrency while preserving existing hard ceilings", () => {
  const fast = createArtworkWorkload({ cores: 8, memoryGB: 8 });
  const floor = createArtworkWorkload({ cores: 4, memoryGB: 1 });
  for (let window = 0; window < 12; window += 1) {
    healthyWindow(fast, window * 1500);
    healthyWindow(floor, window * 1500);
  }
  expect(fast.limits()).toEqual({ loads: 18, decodes: 2, prefetch: 4 });
  expect(fast.limits().loads).toBeGreaterThan(floor.limits().loads);
  expect(fast.limits().decodes).toBeGreaterThan(floor.limits().decodes);
  expect(fast.limits().prefetch).toBeGreaterThan(floor.limits().prefetch);
});

test("devices without memory hints can earn capacity through normal work", () => {
  const policy = createArtworkWorkload({ cores: 4 });
  for (let window = 0; window < 12; window += 1) healthyWindow(policy, window * 1500);
  expect(policy.limits()).toEqual({ loads: 18, decodes: 2, prefetch: 4 });
});

test("frame pressure backs off immediately and recovery respects its cooldown", () => {
  const policy = createArtworkWorkload({ cores: 16, memoryGB: 8 });
  for (let window = 0; window < 12; window += 1) healthyWindow(policy, window * 1500);
  policy.frame(90, 20_000);
  expect(policy.limits()).toEqual({ loads: 9, decodes: 1, prefetch: 1 });
  healthyWindow(policy, 21_000);
  expect(policy.limits()).toEqual({ loads: 9, decodes: 1, prefetch: 1 });
  healthyWindow(policy, 24_000);
  expect(policy.limits().loads).toBeGreaterThan(9);
});

test("slow image decoding does not unlock extra decode or prefetch lanes", () => {
  const policy = createArtworkWorkload({ cores: 16, memoryGB: 8 });
  for (let window = 0; window < 8; window += 1) {
    healthyWindow(policy, window * 1500, 120);
  }
  expect(policy.limits().decodes).toBe(1);
  expect(policy.limits().prefetch).toBe(1);
});

test("lower delivered image throughput reduces downloads without labelling CPU work as slow", () => {
  const policy = createArtworkWorkload({ cores: 8, memoryGB: 8 });
  healthyWindow(policy, 0);
  healthyWindow(policy, 1500);
  const before = policy.limits();
  for (let index = 0; index < 8; index += 1) policy.decoded(8, 5050);
  for (let index = 0; index < 4; index += 1) policy.completed(1000, 5100);
  for (let index = 0; index < 8; index += 1) policy.frame(16, 5120 + index * 16);
  expect(policy.limits().loads).toBeLessThan(before.loads);
  expect(policy.limits().decodes).toBe(before.decodes);
  expect(policy.limits().prefetch).toBe(before.prefetch);
});

test("an isolated fast decode cannot increase capacity", () => {
  const policy = createArtworkWorkload();
  policy.frame(16, 16);
  policy.decoded(1, 20);
  policy.completed(10, 21);
  expect(policy.limits()).toEqual({ loads: 4, decodes: 1, prefetch: 1 });
});

test("growth waits through cooldown without counting that wait as reduced image throughput", () => {
  const policy = createArtworkWorkload({ cores: 8, memoryGB: 8 });
  healthyWindow(policy, 0);
  const before = policy.limits();
  healthyWindow(policy, 500);
  expect(policy.limits()).toEqual(before);
  healthyWindow(policy, 1500);
  expect(policy.limits().loads).toBeGreaterThan(before.loads);
});

test("frame sampling is shared and stops only after the last owned image attempt", async () => {
  vi.resetModules();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const { trackArtworkWork } = await import("../src/services/workload");
  const first = trackArtworkWork();
  const second = trackArtworkWork();
  expect(frames.size).toBe(1);
  first();
  first();
  expect(frames.size).toBe(1);
  const [id, callback] = [...frames][0];
  frames.delete(id);
  callback(16);
  expect(frames.size).toBe(1);
  second();
  expect(frames.size).toBe(0);
});

test("returning from a hidden page does not report suspended time as frame pressure", async () => {
  vi.resetModules();
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { artworkWorkload, trackArtworkWork } = await import("../src/services/workload");
  const before = artworkWorkload();
  const finish = trackArtworkWork();
  try {
    frames.shift()?.(16);
    frames.shift()?.(32);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    frames.shift()?.(10_000);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    frames.shift()?.(20_000);
    expect(artworkWorkload()).toEqual(before);
  } finally {
    finish();
  }
});
