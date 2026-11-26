import { XtreamRequestError } from "./xtream";
import type { MessageKey } from "./locale";

export type PlaylistEntryProblem =
  | "authentication"
  | "permission"
  | "expired"
  | "content"
  | "parsing"
  | "network"
  | "timeout"
  | "server"
  | "too-large";

export const PLAYLIST_ENTRY_MESSAGE: Record<PlaylistEntryProblem, MessageKey> = {
  authentication: "playlist.entryAuthentication",
  permission: "playlist.entryPermission",
  expired: "playlist.entryExpired",
  content: "playlist.entryContent",
  parsing: "playlist.entryParsing",
  network: "playlist.entryNetwork",
  timeout: "playlist.entryTimeout",
  server: "playlist.entryServer",
  "too-large": "playlist.entryTooLarge",
};

export class PlaylistEntryError extends Error {
  constructor(readonly problem: PlaylistEntryProblem) {
    super(problem);
    this.name = "PlaylistEntryError";
  }
}

/**
 * The safe failure the entry form is allowed to show: a message key, never provider text.
 */
export class PlaylistEntryFeedbackError extends Error {
  constructor(readonly messageKey: MessageKey) {
    super(messageKey);
    this.name = "PlaylistEntryFeedbackError";
  }
}

export function playlistEntryProblem(error: unknown): PlaylistEntryProblem {
  if (error instanceof PlaylistEntryError) return error.problem;
  if (error instanceof XtreamRequestError) {
    if (error.reason === "timeout") return "timeout";
    if (error.reason === "too-large") return "too-large";
    if (error.reason === "malformed") return "parsing";
    if (error.status === 401) return "authentication";
    if (error.status === 403) return "permission";
    if (error.status !== undefined && error.status >= 500) return "server";
  }
  const detail = error instanceof Error ? error.message : "";
  if (/login was rejected|authentication returned an invalid response/i.test(detail)) {
    return "authentication";
  }
  if (/^HTTP 401$/.test(detail)) return "authentication";
  if (/^HTTP 403$/.test(detail)) return "permission";
  if (/^HTTP 5\d\d$/.test(detail)) return "server";
  if (error instanceof SyntaxError) return "parsing";
  return "network";
}

export function assertPlaylistContent(text: string, channelCount: number): void {
  if (channelCount > 0) return;
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!/^#EXTM3U(?:[ \t][^\r\n]*)?(?:\r?\n|$)/i.test(clean)) {
    throw new PlaylistEntryError("content");
  }
  const lines = clean
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim());
  if (lines.some((line) => line && (!line.startsWith("#") || /^#EXTINF\b/i.test(line)))) {
    throw new PlaylistEntryError("parsing");
  }
}
