import { expect, test } from "vitest";
import {
  clampSeekTarget,
  DEFAULT_SEGMENT_SECONDS,
  finiteSeekRange,
  isAtLiveEdge,
  parseAvPlayLiveRange,
  SEEK_SETTLE_MS,
  SEEK_STEP_SECONDS,
  SEEK_TIMEOUT_MS,
  safeLiveTarget,
  seekStepForHold,
  seekStepFromKey,
  usefulLiveRange,
} from "../src/services/playbackRange";

test("playback range constants use the approved values", () => {
  expect(DEFAULT_SEGMENT_SECONDS).toBe(3);
  expect(SEEK_STEP_SECONDS).toBe(10);
  expect(SEEK_SETTLE_MS).toBe(750);
  expect(SEEK_TIMEOUT_MS).toBe(5000);
});

test("finite range uses the narrower engine range", () => {
  expect(finiteSeekRange(120, 10, 90)).toEqual({
    startSeconds: 10,
    endSeconds: 90,
    liveEdge: false,
  });
});

test("finite range defaults to the duration and rejects nonfinite durations", () => {
  expect(finiteSeekRange(120)).toEqual({ startSeconds: 0, endSeconds: 120, liveEdge: false });
  expect(finiteSeekRange(0)).toBeNull();
  expect(finiteSeekRange(Number.NaN)).toBeNull();
  expect(finiteSeekRange(Number.POSITIVE_INFINITY)).toBeNull();
});

test("AVPlay Live ranges convert valid millisecond pairs to seconds", () => {
  expect(parseAvPlayLiveRange("100000|200000")).toEqual({
    startSeconds: 100,
    endSeconds: 200,
  });
});

test("AVPlay Live ranges reject malformed and invalid pairs", () => {
  expect(parseAvPlayLiveRange("")).toBeNull();
  expect(parseAvPlayLiveRange("1000")).toBeNull();
  expect(parseAvPlayLiveRange("NaN|2000")).toBeNull();
  expect(parseAvPlayLiveRange("0|Infinity")).toBeNull();
  expect(parseAvPlayLiveRange("2000|1000")).toBeNull();
  expect(parseAvPlayLiveRange("1000|1000")).toBeNull();
  expect(parseAvPlayLiveRange("-1|1000")).toBeNull();
  expect(parseAvPlayLiveRange("0|-1")).toBeNull();
});

test("a Live range needs a useful DVR window", () => {
  expect(usefulLiveRange({ startSeconds: 100, endSeconds: 700 })).toBe(true);
  expect(usefulLiveRange({ startSeconds: 100, endSeconds: 699.9 })).toBe(false);
  expect(usefulLiveRange(null)).toBe(false);
});

test("Live safety margin clamps between two and ten seconds", () => {
  const range = { startSeconds: 100, endSeconds: 200 };
  expect(safeLiveTarget(range, 1)).toBe(198);
  expect(safeLiveTarget(range, 12)).toBe(190);
});

test("Live safety respects an earlier browser edge", () => {
  expect(safeLiveTarget({ startSeconds: 100, endSeconds: 200 }, 4, 190)).toBe(186);
});

test("Live safety and hysteresis use exact approved thresholds", () => {
  const range = { startSeconds: 100, endSeconds: 200 };
  expect(safeLiveTarget(range, 4)).toBe(196);
  expect(isAtLiveEdge(190, 196, 4, false)).toBe(true);
  expect(isAtLiveEdge(183.9, 196, 4, true)).toBe(false);
});

test("held seek allows time at each tier before reaching five and ten minutes", () => {
  expect([0, 999, 1000, 2499, 2500, 4500, 7000, 10000, 13500].map(seekStepForHold)).toEqual([
    10, 10, 20, 20, 40, 60, 120, 300, 600,
  ]);
});

test("repeat bursts cannot accelerate seeking and release or reversal resets the hold", () => {
  const held = { direction: 0 as -1 | 0 | 1, startedAt: 0, steppedAt: 0 };
  expect(seekStepFromKey(held, 1, false, 1000)).toBe(10);
  for (let event = 1; event < 100; event += 1) {
    expect(seekStepFromKey(held, 1, true, 1000 + event)).toBe(0);
  }
  expect(seekStepFromKey(held, 1, true, 2600)).toBe(20);
  expect(seekStepFromKey(held, -1, true, 2601)).toBe(10);
  expect(seekStepFromKey(held, -1, false, 5000)).toBe(10);
});

test("an expired seek target clamps to the new range start", () => {
  expect(clampSeekTarget(90, { startSeconds: 100, endSeconds: 200 })).toBe(100);
});
