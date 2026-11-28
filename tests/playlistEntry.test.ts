import { describe, expect, it } from "vitest";
import {
  assertPlaylistContent,
  PLAYLIST_ENTRY_MESSAGE,
  PlaylistEntryError,
  playlistEntryProblem,
} from "../src/services/playlistEntry";
import { XtreamRequestError } from "../src/services/xtream";

const M3U = '#EXTM3U\n#EXTINF:-1 tvg-id="a" x,First\nhttp://example.com/a.ts\n';
const EMPTY_M3U = "#EXTM3U\n# a comment only\n";

describe("playlistEntryProblem", () => {
  it("returns the problem carried by a PlaylistEntryError", () => {
    expect(playlistEntryProblem(new PlaylistEntryError("expired"))).toBe("expired");
  });

  it("classifies XtreamRequestError by reason, status and size", () => {
    expect(playlistEntryProblem(new XtreamRequestError("timeout"))).toBe("timeout");
    expect(playlistEntryProblem(new XtreamRequestError("too-large"))).toBe("too-large");
    expect(playlistEntryProblem(new XtreamRequestError("malformed"))).toBe("parsing");
    expect(playlistEntryProblem(new XtreamRequestError("http", 401))).toBe("authentication");
    expect(playlistEntryProblem(new XtreamRequestError("http", 403))).toBe("permission");
    expect(playlistEntryProblem(new XtreamRequestError("http", 503))).toBe("server");
    expect(playlistEntryProblem(new XtreamRequestError("http", 404))).toBe("network");
  });

  it("classifies raw HTTP status messages", () => {
    expect(playlistEntryProblem(new Error("HTTP 401"))).toBe("authentication");
    expect(playlistEntryProblem(new Error("HTTP 403"))).toBe("permission");
    expect(playlistEntryProblem(new Error("HTTP 500"))).toBe("server");
    expect(playlistEntryProblem(new Error("HTTP 404"))).toBe("network");
  });

  it("recognises provider authentication wording without echoing it", () => {
    expect(playlistEntryProblem(new Error("login was rejected for user secret-password"))).toBe(
      "authentication",
    );
    expect(playlistEntryProblem(new SyntaxError("Unexpected token"))).toBe("parsing");
    expect(playlistEntryProblem(new TypeError("Failed to fetch http://u:p@host"))).toBe(
      "network",
    );
    expect(playlistEntryProblem("weird")).toBe("network");
  });

  it("maps every problem to a message key", () => {
    for (const problem of Object.keys(
      PLAYLIST_ENTRY_MESSAGE,
    ) as (keyof typeof PLAYLIST_ENTRY_MESSAGE)[]) {
      expect(typeof PLAYLIST_ENTRY_MESSAGE[problem]).toBe("string");
    }
  });
});

describe("assertPlaylistContent", () => {
  it("accepts any nonempty playlist without inspecting the header", () => {
    expect(() =>
      assertPlaylistContent("#EXTINF:-1 x,No header\nhttp://a/b.ts\n", 1),
    ).not.toThrow();
    expect(() => assertPlaylistContent(M3U, 1)).not.toThrow();
  });

  it("accepts a real empty extended M3U document", () => {
    expect(() => assertPlaylistContent(EMPTY_M3U, 0)).not.toThrow();
    expect(() => assertPlaylistContent("\uFEFF#EXTM3U\r\n# comment\r\n", 0)).not.toThrow();
  });

  it("rejects content that is not an extended M3U playlist", () => {
    expect(() => assertPlaylistContent("<html>nope</html>", 0)).toThrow(PlaylistEntryError);
    expect(() => assertPlaylistContent("", 0)).toThrow(PlaylistEntryError);
    try {
      assertPlaylistContent("garbage", 0);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PlaylistEntryError);
      expect((error as PlaylistEntryError).problem).toBe("content");
    }
  });

  it("rejects malformed zero-channel entries but keeps comments", () => {
    expect(() => assertPlaylistContent("#EXTM3U\nnot-a-tag\n", 0)).toThrow(PlaylistEntryError);
    try {
      assertPlaylistContent("#EXTM3U\n#EXTINF:-1 broken\n", 0);
      expect.unreachable();
    } catch (error) {
      expect((error as PlaylistEntryError).problem).toBe("parsing");
    }
  });
});
