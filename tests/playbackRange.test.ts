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
  seekStepForRepeat,
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

test("held seek accelerates through deterministic accepted repeat tiers", () => {
  expect([0, 3, 4, 7, 8, 11, 12, 40].map(seekStepForRepeat)).toEqual([
    10, 10, 20, 20, 40, 40, 60, 60,
  ]);
});

test("an expired seek target clamps to the new range start", () => {
  expect(clampSeekTarget(90, { startSeconds: 100, endSeconds: 200 })).toBe(100);
});
