import type { SeekRange } from "../types";

export const DEFAULT_SEGMENT_SECONDS = 3;
export const SEEK_STEP_SECONDS = 10;
export const SEEK_SETTLE_MS = 750;
export const SEEK_TIMEOUT_MS = 5000;

export const seekStepForRepeat = (repeatCount: number): number => {
  if (repeatCount >= 12) return 60;
  if (repeatCount >= 8) return 40;
  if (repeatCount >= 4) return 20;
  return SEEK_STEP_SECONDS;
};

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
