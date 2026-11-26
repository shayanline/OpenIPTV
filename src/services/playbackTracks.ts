import type { MediaTrack } from "../types";

export interface AVPlayStreamInfo {
  index: number;
  type: "VIDEO" | "AUDIO" | "TEXT";
  extra_info: string;
}

const normalizedText = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const normalizedLanguage = (value: unknown): string => normalizedText(value).toLowerCase();

const infoOf = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const info: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(parsed)) {
      info[key.toLowerCase().replace(/[^a-z0-9]/g, "")] = item;
    }
    return info;
  } catch {
    return {};
  }
};

const first = (info: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) {
    if (info[key] !== undefined) return info[key];
  }
  return undefined;
};

const selectedOf = (value: unknown): boolean =>
  value === true || value === 1 || ["true", "1", "yes"].includes(String(value).toLowerCase());

const accessibilityOf = (
  kind: MediaTrack["kind"],
  info: Record<string, unknown>,
  label: string,
): MediaTrack["accessibility"] => {
  const value = normalizedText(
    first(info, ["accessibility", "role", "kind", "tracktype", "subtitletype"]),
  ).toLowerCase();
  const description = `${value} ${label.toLowerCase()}`.replace(/[_-]+/g, " ");
  if (/\b(sdh|hearing impaired|captions?)\b/.test(description)) return "sdh";
  if (
    kind === "audio" &&
    /\b(audio description|descriptions?|visually impaired)\b/.test(description)
  )
    return "descriptions";
  return undefined;
};

export const trackIdentity = (
  track: Pick<MediaTrack, "kind" | "language" | "label" | "accessibility">,
): string =>
  [
    track.kind,
    normalizedLanguage(track.language),
    normalizedText(track.label).toLowerCase(),
    track.accessibility ?? "",
  ].join("|");

export function normalizeAvPlayTracks(items: readonly AVPlayStreamInfo[]): MediaTrack[] {
  const occurrences = new Map<string, number>();
  let audioNumber = 0;
  let subtitleNumber = 0;

  const tracks: MediaTrack[] = [];
  for (const item of items) {
    if (item.type !== "AUDIO" && item.type !== "TEXT") continue;
    const kind = item.type === "AUDIO" ? "audio" : "subtitle";
    if (kind === "audio") audioNumber += 1;
    else subtitleNumber += 1;
    const number = kind === "audio" ? audioNumber : subtitleNumber;
    const info = infoOf(item.extra_info);
    const language = normalizedLanguage(
      first(info, ["language", "lang", "tracklang", "tracklanguage"]),
    );
    const providerLabel = normalizedText(
      first(info, ["label", "title", "name", "trackname", "tracktitle"]),
    );
    /* Labels prefer the provider's own text, then the language, then a numbered fallback. */
    const label =
      providerLabel || language || `${kind === "audio" ? "Audio" : "Subtitle"} ${number}`;
    const accessibility = accessibilityOf(kind, info, label);
    const identity = trackIdentity({ kind, language, label, accessibility });
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);

    tracks.push({
      id: `${identity}|${occurrence}`,
      identity,
      engineIndex: item.index,
      kind,
      label,
      language,
      selected: selectedOf(first(info, ["selected", "isselected", "active", "isactive"])),
      accessibility,
    });
  }
  return tracks;
}

export interface BrowserTrackSource {
  kind: "audio" | "subtitle";
  label: string;
  language: string;
  selected: boolean;
  engineIndex: number;
}

/**
 * The same normalization as the AVPlay path, applied to the shapes a media element and
 * hls.js report, so both engines produce identical MediaTrack lists. Accessibility is read
 * from the label, which is all a browser exposes.
 */
export function normalizeBrowserTracks(items: readonly BrowserTrackSource[]): MediaTrack[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    const language = normalizedLanguage(item.language);
    const label =
      normalizedText(item.label) ||
      language ||
      `${item.kind === "audio" ? "Audio" : "Subtitle"} ${item.engineIndex + 1}`;
    const accessibility = accessibilityOf(item.kind, {}, label);
    const identity = trackIdentity({ kind: item.kind, language, label, accessibility });
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      id: `${identity}|${occurrence}`,
      identity,
      engineIndex: item.engineIndex,
      kind: item.kind,
      label,
      language,
      selected: item.selected,
      accessibility,
    };
  });
}

export function automaticTrack(
  tracks: readonly MediaTrack[],
  deviceLanguage: string,
): MediaTrack | null {
  const wanted = normalizedLanguage(deviceLanguage).split("-")[0];
  if (!wanted) return null;
  const matches = tracks.filter(
    (track) => normalizedLanguage(track.language).split("-")[0] === wanted,
  );
  return matches.length === 1 ? matches[0] : null;
}
