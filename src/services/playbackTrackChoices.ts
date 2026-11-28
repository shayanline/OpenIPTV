import type { PlaybackTarget } from "../types";
import { whenIdle } from "./idle";
import { sourceFingerprint } from "./m3u";
import { readJSON, remove, write } from "./store";

export interface TrackSelection {
  identity: string | null;
  automatic?: boolean;
}

export interface PlaybackTrackChoices {
  audio: TrackSelection | null;
  subtitle: TrackSelection | null;
}

interface SavedChoices extends PlaybackTrackChoices {
  key: string;
  playlistId: string;
}

const KEY = "openiptv.playback-tracks";
const MAX_CHOICES = 200;
let saved: SavedChoices[] | undefined;
let cancelSave: (() => void) | undefined;

const selectionFrom = (value: unknown): TrackSelection | null => {
  if (!value || typeof value !== "object") return null;
  const choice = value as Record<string, unknown>;
  if (
    choice.identity !== null &&
    (typeof choice.identity !== "string" || choice.identity.length > 2048)
  )
    return null;
  return {
    identity: choice.identity as string | null,
    ...(choice.automatic === true ? { automatic: true } : {}),
  };
};

function entries(): SavedChoices[] {
  if (saved) return saved;
  const stored = readJSON<unknown>(KEY, []);
  saved = [];
  if (!Array.isArray(stored)) return saved;
  for (const value of stored.slice(-MAX_CHOICES)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.key !== "string" ||
      !/^[a-f0-9]{16}$/.test(entry.key) ||
      typeof entry.playlistId !== "string" ||
      entry.playlistId.length > 512
    )
      continue;
    saved.push({
      key: entry.key,
      playlistId: entry.playlistId,
      audio: selectionFrom(entry.audio),
      subtitle: selectionFrom(entry.subtitle),
    });
  }
  return saved;
}

// Persist only an opaque item key and normalized track identities, never a media address.
const keyFor = (target: PlaybackTarget) =>
  sourceFingerprint(target.playlistId, target.kind, target.progress?.itemKey ?? target.id, "");

export function playbackTrackChoices(target: PlaybackTarget): PlaybackTrackChoices {
  const key = keyFor(target);
  const entry = entries().find((value) => value.key === key);
  return {
    audio: entry?.audio ? { ...entry.audio } : null,
    subtitle: entry?.subtitle ? { ...entry.subtitle } : null,
  };
}

export function flushPlaybackTrackChoices(): void {
  if (!cancelSave) return;
  cancelSave();
  cancelSave = undefined;
  write(KEY, JSON.stringify(entries()));
}

function saveLater(): void {
  cancelSave?.();
  cancelSave = whenIdle(flushPlaybackTrackChoices, 1000);
}

export function rememberPlaybackTrackChoice(
  target: PlaybackTarget,
  kind: "audio" | "subtitle",
  selection: TrackSelection,
): void {
  const choices = playbackTrackChoices(target);
  choices[kind] = { ...selection };
  const key = keyFor(target);
  saved = entries().filter((entry) => entry.key !== key);
  saved.push({ key, playlistId: target.playlistId, ...choices });
  if (saved.length > MAX_CHOICES) saved.shift();
  saveLater();
}

export function clearPlaybackTrackChoices(playlistId?: string): void {
  if (playlistId !== undefined) {
    const before = entries();
    const kept = before.filter((entry) => entry.playlistId !== playlistId);
    if (kept.length === before.length) return;
    saved = kept;
    saveLater();
    return;
  }
  cancelSave?.();
  cancelSave = undefined;
  saved = [];
  remove(KEY);
}
