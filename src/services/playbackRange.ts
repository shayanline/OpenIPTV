import type { SeekRange } from "../types";

export const DEFAULT_SEGMENT_SECONDS = 3;
export const SEEK_STEP_SECONDS = 10;
export const SEEK_SETTLE_MS = 750;
export const SEEK_TIMEOUT_MS = 5000;

export const seekStepForHold = (heldMs: number): number => {
  if (heldMs >= 13500) return 600;
  if (heldMs >= 10000) return 300;
  if (heldMs >= 7000) return 120;
  if (heldMs >= 4500) return 60;
  if (heldMs >= 2500) return 40;
  if (heldMs >= 1000) return 20;
  return SEEK_STEP_SECONDS;
};

export interface SeekHold {
  direction: -1 | 0 | 1;
  startedAt: number;
  steppedAt: number;
}

export function seekStepFromKey(
  hold: SeekHold,
  direction: -1 | 1,
  repeated: boolean,
  now = performance.now(),
): number {
  if (!repeated || hold.direction !== direction) {
    hold.direction = direction;
    hold.startedAt = hold.steppedAt = now;
    return SEEK_STEP_SECONDS;
  }
  // Time drives acceleration and caps unusually fast remote repeat streams.
  if (now - hold.steppedAt < 200) return 0;
  hold.steppedAt = now;
  return seekStepForHold(now - hold.startedAt);
}

export const finiteSeekRange = (
  durationSeconds: number | null,
  engineStart?: number,
  engineEnd?: number,
): SeekRange | null => {
  if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return null;

  const fullRange = { startSeconds: 0, endSeconds: durationSeconds, liveEdge: false };
  if (
    engineStart === undefined ||
    engineEnd === undefined ||
    !Number.isFinite(engineStart) ||
    !Number.isFinite(engineEnd) ||
    engineStart < 0 ||
    engineEnd <= engineStart
  )
    return fullRange;

  const startSeconds = Math.max(0, engineStart);
  const endSeconds = Math.min(durationSeconds, engineEnd);
  return startSeconds < endSeconds ? { startSeconds, endSeconds, liveEdge: false } : fullRange;
};

export const parseAvPlayLiveRange = (
  value: string,
): { startSeconds: number; endSeconds: number } | null => {
  const parts = value.split("|");
  if (parts.length !== 2 || parts[0].trim() === "" || parts[1].trim() === "") return null;

  const startMilliseconds = Number(parts[0]);
  const endMilliseconds = Number(parts[1]);
  if (
    !Number.isFinite(startMilliseconds) ||
    !Number.isFinite(endMilliseconds) ||
    startMilliseconds < 0 ||
    endMilliseconds <= startMilliseconds
  )
    return null;

  return {
    startSeconds: startMilliseconds / 1000,
    endSeconds: endMilliseconds / 1000,
  };
};

export const usefulLiveRange = (
  range: { startSeconds: number; endSeconds: number } | null,
): boolean => range !== null && range.endSeconds - range.startSeconds >= 600;

export const safeLiveTarget = (
  range: { startSeconds: number; endSeconds: number },
  segmentSeconds: number,
  engineLiveEdge?: number | null,
): number => {
  const endSeconds =
    engineLiveEdge === undefined || engineLiveEdge === null
      ? range.endSeconds
      : Math.min(range.endSeconds, engineLiveEdge);
  const margin = Math.min(10, Math.max(2, segmentSeconds));
  return clampSeekTarget(endSeconds - margin, range);
};

export const isAtLiveEdge = (
  position: number,
  safeTarget: number,
  segmentSeconds: number,
  wasLive: boolean,
): boolean => {
  const threshold = Math.max(6, segmentSeconds * 2) + (wasLive ? 4 : 0);
  return position >= safeTarget - threshold;
};

export const clampSeekTarget = (
  target: number,
  range: { startSeconds: number; endSeconds: number },
): number => Math.min(range.endSeconds, Math.max(range.startSeconds, target));
