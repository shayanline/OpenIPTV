import type { AppMode } from "./surfaceStack";

export interface ContentSectionVisibility {
  showLive: boolean;
  showMovies: boolean;
  showSeries: boolean;
}

export function availableContentModes(
  sourceKind: "m3u" | "xtream",
  visibility: ContentSectionVisibility,
): AppMode[] {
  const modes: AppMode[] = [];
  if (visibility.showLive) modes.push("live");
  if (sourceKind === "xtream") {
    if (visibility.showMovies) modes.push("movie");
    if (visibility.showSeries) modes.push("series");
  }
  return modes;
}
