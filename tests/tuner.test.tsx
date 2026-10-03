import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlayerEvent } from "../src/services/player";
import type { PlaybackTarget } from "../src/types";

const playerMock = vi.hoisted(() => ({
  instances: [] as Array<{
    emit: (event: PlayerEvent) => void;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resumePlayback: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    seekBy: ReturnType<typeof vi.fn>;
    position: number;
    duration: number;
  }>,
}));

const repairMock = vi.hoisted(() => ({
  idleRepair: vi.fn(),
  prepare: vi.fn(),
  repair: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("../src/services/player", () => ({
  onTizen: () => false,
  Player: class {
    play = vi.fn();
    pause = vi.fn();
    resumePlayback = vi.fn();
    stop = vi.fn();
    seekBy = vi.fn().mockResolvedValue(true);
    position = 0;
    duration = 100;
    constructor(public emit: (event: PlayerEvent) => void) {
      playerMock.instances.push(this);
    }
    attach() {}
    detach() {}
    hide() {}
    show() {}
    setFit() {}
    setMuted() {}
    adjustVolume() {}
    getStats() {
      return { engine: "AVPlay", switches: 0 };
    }
    getPosition() {
      return this.position;
    }
    getDuration() {
      return this.duration;
    }
    resumeLive(url: string) {
      this.play(url);
    }
  },
}));

vi.mock("../src/services/repair", () => ({
  idleRepair: repairMock.idleRepair,
  pauseRepair: vi.fn(),
  prepare: repairMock.prepare,
  repair: repairMock.repair,
  rememberNeedsRepair: vi.fn(),
  revalidate: repairMock.revalidate,
  resumeRepair: vi.fn(),
  stopRepair: vi.fn(),
}));

import { httpFallback, useTuner } from "../src/hooks/useTuner";

const live: PlaybackTarget = {
  id: "live-1",
  playlistId: "playlist-1",
  mode: "live",
  kind: "live",
  name: "Live",
  group: "News",
  logo: "",
  url: "http://example.invalid/live.m3u8",
};

const movie: PlaybackTarget = {
  id: "movie-1",
  playlistId: "playlist-1",
  mode: "finite",
  kind: "movie",
  name: "Movie",
  group: "Cinema",
  logo: "",
  url: "http://example.invalid/movie.mp4",
  resumeAt: 25,
};

const episode: PlaybackTarget = {
  ...movie,
  id: "episode-1",
  kind: "episode",
  name: "Episode",
  url: "http://example.invalid/episode.mp4",
};

function mount(compatibility = true) {
  const video = { current: document.createElement("video") };
  return renderHook(() =>
    useTuner({
      list: [live],
      fit: "fit",
      video,
      rememberLast: vi.fn(),
      onNamed: vi.fn(),
      onPicture: vi.fn(),
      onFault: vi.fn(),
      compatibility,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  playerMock.instances.length = 0;
  repairMock.idleRepair.mockReset();
  repairMock.prepare.mockReset();
  repairMock.repair.mockReset();
  repairMock.revalidate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test.each([
  ["live channel", live],
  ["movie", movie],
  ["series episode", episode],
])("reselecting the current %s does not restart playback", (_label, target) => {
  const { result } = mount(false);

  act(() => result.current.start(target));
  act(() => result.current.start(target));

  expect(playerMock.instances[0].play).toHaveBeenCalledOnce();
});

test("finite targets bypass compatibility preparation and start at their resume position", () => {
  const { result } = mount();
  act(() => result.current.start(movie));

  expect(repairMock.prepare).not.toHaveBeenCalled();
  expect(repairMock.idleRepair).toHaveBeenCalledOnce();
  expect(playerMock.instances[0].play).toHaveBeenCalledWith(
    movie.url,
    false,
    undefined,
    "finite",
    25,
  );
});

test("HTTP pages retry failed HTTPS media once over HTTP", () => {
  const secureMovie = { ...movie, url: "https://example.invalid/movie.mp4" };
  const { result } = mount();
  act(() => result.current.start(secureMovie));
  act(() => playerMock.instances[0].emit({ type: "error", code: "manifestLoadError" }));

  const relayed = new URL("/__openiptv_http_relay__", window.location.origin);
  relayed.searchParams.set("url", "http://example.invalid/movie.mp4");
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    relayed.toString(),
    false,
    undefined,
    "finite",
    25,
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);

  act(() => playerMock.instances[0].emit({ type: "error", code: "manifestLoadError" }));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("HTTP pages retry failed HTTP finite media once through the local relay", () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  act(() =>
    playerMock.instances[0].emit({ type: "error", code: "PLAYER_ERROR_NOT_SUPPORTED_FILE" }),
  );

  const relayed = new URL("/__openiptv_http_relay__", window.location.origin);
  relayed.searchParams.set("url", movie.url);
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    relayed.toString(),
    false,
    undefined,
    "finite",
    25,
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);

  act(() =>
    playerMock.instances[0].emit({ type: "error", code: "PLAYER_ERROR_NOT_SUPPORTED_FILE" }),
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("packaged TV fallback stays direct because no local relay exists", () => {
  expect(httpFallback("https://provider.example/movie.mp4", "file:", "null")).toBe(
    "http://provider.example/movie.mp4",
  );
  expect(httpFallback("http://provider.example/movie.mp4", "file:", "null")).toBe("");
});

test("finite pause resumes in place and seek delegates to the player", async () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  act(() => playerMock.instances[0].emit({ type: "playing" }));
  act(() => result.current.setPlaying(false));
  expect(playerMock.instances[0].pause).toHaveBeenCalledOnce();

  act(() => result.current.setPlaying(true));
  expect(playerMock.instances[0].resumePlayback).toHaveBeenCalledOnce();
  await act(async () => {
    expect(await result.current.seek(10)).toBe(true);
  });
  expect(playerMock.instances[0].seekBy).toHaveBeenCalledWith(10);
});

test("finite timing is exposed and completion does not retry", () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  playerMock.instances[0].position = 40;
  playerMock.instances[0].duration = 120;
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.position).toBe(40);
  expect(result.current.duration).toBe(120);

  act(() => playerMock.instances[0].emit({ type: "ended" }));
  expect(result.current.completed).toBe(true);
  expect(result.current.fault).toBe("");
  act(() => vi.advanceTimersByTime(60_000));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
});

test("live completion remains an error and retains automatic retry", () => {
  const { result } = mount(false);
  act(() => result.current.start(live));
  act(() => playerMock.instances[0].emit({ type: "ended" }));
  expect(result.current.fault).toBe("STREAM_ENDED");

  act(() => vi.advanceTimersByTime(4_000));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});
