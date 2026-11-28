import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  clearPlaybackTrackChoices,
  flushPlaybackTrackChoices,
  playbackTrackChoices,
  rememberPlaybackTrackChoice,
} from "../src/services/playbackTrackChoices";
import type { PlaybackTarget } from "../src/types";

const target = (id: string, playlistId = "one"): PlaybackTarget => ({
  id,
  playlistId,
  kind: "movie",
  mode: "finite",
  name: id,
  group: "",
  logo: "",
  url: "http://example.invalid/movie/test-user/test-password/1.mp4",
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  clearPlaybackTrackChoices();
});

afterEach(() => {
  clearPlaybackTrackChoices();
  vi.useRealTimers();
});

test("track choices belong to the item, playlist and content kind", () => {
  const movie = target("film");
  rememberPlaybackTrackChoice(movie, "audio", { identity: "audio|fa|main|" });
  rememberPlaybackTrackChoice(movie, "subtitle", { identity: null });
  expect(playbackTrackChoices(movie)).toEqual({
    audio: { identity: "audio|fa|main|" },
    subtitle: { identity: null },
  });
  for (const other of [
    target("another"),
    target("film", "two"),
    { ...movie, kind: "episode" as const },
    { ...movie, kind: "live" as const, mode: "live" as const },
  ]) {
    expect(playbackTrackChoices(other)).toEqual({ audio: null, subtitle: null });
  }
});

test("accepted choices survive a reload without storing media credentials", async () => {
  const episode = { ...target("episode"), kind: "episode" as const };
  rememberPlaybackTrackChoice(episode, "subtitle", { identity: null, automatic: true });
  expect(localStorage.getItem("openiptv.playback-tracks")).toBeNull();
  flushPlaybackTrackChoices();
  const stored = localStorage.getItem("openiptv.playback-tracks") ?? "";
  expect(stored).not.toContain("test-user");
  expect(stored).not.toContain("test-password");
  vi.resetModules();
  const reloaded = await import("../src/services/playbackTrackChoices");
  expect(reloaded.playbackTrackChoices(episode).subtitle).toEqual({
    identity: null,
    automatic: true,
  });
});

test("removing a playlist keeps other choices and reset cancels pending writes", async () => {
  rememberPlaybackTrackChoice(target("film", "one"), "audio", { identity: "one" });
  rememberPlaybackTrackChoice(target("film", "two"), "audio", { identity: "two" });
  clearPlaybackTrackChoices("one");
  expect(playbackTrackChoices(target("film", "one")).audio).toBeNull();
  expect(playbackTrackChoices(target("film", "two")).audio?.identity).toBe("two");
  clearPlaybackTrackChoices();
  await vi.advanceTimersByTimeAsync(2000);
  expect(localStorage.getItem("openiptv.playback-tracks")).toBeNull();
});

test("remembered choices remain bounded while recent items stay available", () => {
  for (let index = 0; index <= 200; index += 1) {
    rememberPlaybackTrackChoice(target(String(index)), "audio", { identity: "main" });
  }
  flushPlaybackTrackChoices();
  expect(JSON.parse(localStorage.getItem("openiptv.playback-tracks") ?? "[]")).toHaveLength(
    200,
  );
  expect(playbackTrackChoices(target("0")).audio).toBeNull();
  expect(playbackTrackChoices(target("200")).audio?.identity).toBe("main");
});
