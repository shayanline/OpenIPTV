import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  DEFAULT_SEGMENT_SECONDS,
  SEEK_SETTLE_MS,
  safeLiveTarget,
} from "../src/services/playbackRange";
import type { PlaybackClock, PlayerEvent } from "../src/services/player";
import {
  clearPlaybackTrackChoices,
  playbackTrackChoices,
  rememberPlaybackTrackChoice,
} from "../src/services/playbackTrackChoices";
import type { MediaTrack, PlaybackTarget } from "../src/types";

const playerMock = vi.hoisted(() => ({
  instances: [] as Array<{
    emit: (event: PlayerEvent) => void;
    play: ReturnType<typeof vi.fn>;
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resumePlayback: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    seekTo: ReturnType<typeof vi.fn>;
    warmRecover: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    getTracks: ReturnType<typeof vi.fn>;
    selectTrack: ReturnType<typeof vi.fn>;
    clock: PlaybackClock;
  }>,
}));

const repairMock = vi.hoisted(() => ({
  idleRepair: vi.fn(),
  prepare: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("../src/services/player", () => ({
  onTizen: () => false,
  Player: class {
    play = vi.fn();
    attach = vi.fn();
    detach = vi.fn();
    pause = vi.fn(() => true);
    resumePlayback = vi.fn(() => true);
    stop = vi.fn();
    seekTo = vi.fn().mockResolvedValue(true);
    warmRecover = vi.fn(() => false);
    hide = vi.fn();
    show = vi.fn();
    clock: PlaybackClock = {
      position: 0,
      duration: 100,
      seekableStart: null,
      seekableEnd: null,
      engineLiveEdge: null,
      segmentSeconds: null,
    };
    constructor(public emit: (event: PlayerEvent) => void) {
      playerMock.instances.push(this);
    }
    setFit() {}
    setMuted() {}
    adjustVolume() {}
    canPause() {
      return true;
    }
    getTracks = vi.fn(() => [] as MediaTrack[]);
    selectTrack = vi.fn(() => false);
    getStats() {
      return { engine: "AVPlay", switches: 0 };
    }
    getClock() {
      return this.clock;
    }
    getPosition() {
      return this.clock.position;
    }
    getDuration() {
      return this.clock.duration;
    }
  },
}));

vi.mock("../src/services/repair", () => ({
  idleRepair: repairMock.idleRepair,
  pauseRepair: vi.fn(),
  prepare: repairMock.prepare,
  repair: vi.fn(),
  rememberNeedsRepair: vi.fn(),
  revalidate: repairMock.revalidate,
  resumeRepair: vi.fn(),
  stopRepair: vi.fn(),
}));

import { httpFallback, usePlaybackController } from "../src/hooks/usePlaybackController";

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

function mount(compatibility = false, continuousReconnect = false) {
  const video = { current: document.createElement("video") };
  const options = {
    fit: "fit" as const,
    video,
    compatibility,
    continuousReconnect,
    onNamed: vi.fn(),
    onPicture: vi.fn(),
    onMessage: vi.fn(),
    onEnded: vi.fn(),
    onStopped: vi.fn(),
    rememberLast: vi.fn(),
  };
  return {
    ...renderHook((props: typeof options) => usePlaybackController(props), {
      initialProps: options,
    }),
    options,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  clearPlaybackTrackChoices();
  playerMock.instances.length = 0;
  repairMock.idleRepair.mockReset();
  repairMock.prepare.mockReset().mockResolvedValue(null);
  repairMock.revalidate.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("channel stepping names the landing channel now and tunes once the pressing stops", async () => {
  const { result } = mount();
  const first = { ...live, id: "live-1", url: "http://example.invalid/1.m3u8" };
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  const third = { ...live, id: "live-3", url: "http://example.invalid/3.m3u8" };

  act(() => result.current.start(first));
  act(() => result.current.step(1, [first, second, third]));
  expect(result.current.preview?.id).toBe("live-2");
  act(() => result.current.step(1, [first, second, third]));
  expect(result.current.preview?.id).toBe("live-3");
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(result.current.preview).toBeNull();
  const calls = playerMock.instances[0].play.mock.calls;
  expect(calls[calls.length - 1][0].url).toBe(third.url);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("a normal channel press tunes after feedback paints without waiting for release", async () => {
  const { result } = mount();
  const next = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  act(() => result.current.start(live));
  act(() => result.current.step(1, [live, next]));
  expect(result.current.preview?.id).toBe(next.id);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(48));
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: next.url }),
  );
  expect(result.current.snapshot.target?.id).toBe(next.id);
});

test("held channel repeats coalesce until release instead of opening every preview", async () => {
  const { result } = mount();
  const next = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  act(() => {
    result.current.start(live);
    result.current.step(1, [live, next], true);
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
  act(() => result.current.commitStep());
  await act(async () => vi.advanceTimersByTimeAsync(48));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("compatibility checks stop the old stream immediately without releasing its decoder", async () => {
  const { result } = mount(true);
  await act(async () => result.current.start(live));
  const next = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  let finish!: (value: null) => void;
  repairMock.prepare.mockReturnValueOnce(
    new Promise<null>((resolve) => {
      finish = resolve;
    }),
  );
  act(() => result.current.step(1, [live, next]));
  await act(async () => vi.advanceTimersByTimeAsync(48));
  expect(repairMock.prepare).toHaveBeenLastCalledWith(next.url, next.playlistId);
  expect(playerMock.instances[0].stop).toHaveBeenLastCalledWith(false);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
  expect(result.current.snapshot.target?.id).toBe(next.id);
  expect(result.current.snapshot.phase).toBe("connecting");
  await act(async () => finish(null));
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: next.url }),
  );
});

test("stale synchronous track events cannot recursively reapply an audio choice", () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const instance = playerMock.instances[0];
  const tracks: MediaTrack[] = [
    {
      id: "a",
      identity: "a",
      engineIndex: 1,
      kind: "audio",
      label: "A",
      language: "en",
      selected: true,
    },
    {
      id: "b",
      identity: "b",
      engineIndex: 2,
      kind: "audio",
      label: "B",
      language: "fa",
      selected: false,
    },
  ];
  instance.getTracks.mockReturnValue(tracks);
  act(() => instance.emit({ type: "playing" }));
  let calls = 0;
  instance.selectTrack.mockImplementation(() => {
    if (++calls < 4) instance.emit({ type: "tracks", tracks });
    return true;
  });
  act(() => result.current.selectTrack("audio", 2, { identity: "b" }));
  expect(calls).toBe(1);
  act(() => instance.emit({ type: "tracks", tracks }));
  expect(calls).toBe(2);
});

test("track choices return with their item after stop without changing a different item", () => {
  const { result } = mount();
  const first = { ...live, id: "first" };
  const other = { ...live, id: "other", url: "http://example.invalid/other.m3u8" };
  act(() => result.current.start(first));
  const instance = playerMock.instances[0];
  instance.selectTrack.mockReturnValue(true);
  const tracks: MediaTrack[] = [
    { id: "en", identity: "en", engineIndex: 1, kind: "audio", language: "en", label: "English", selected: true },
    { id: "fa", identity: "fa", engineIndex: 2, kind: "audio", language: "fa", label: "Farsi", selected: false },
    { id: "de", identity: "de", engineIndex: 3, kind: "subtitle", language: "de", label: "German", selected: true },
  ];
  instance.getTracks.mockReturnValue(tracks);
  act(() => {
    instance.emit({ type: "playing" });
    result.current.selectTrack("audio", 2, { identity: "fa" });
    result.current.selectTrack("subtitle", null, { identity: null });
    result.current.stop();
    result.current.start(other);
  });
  instance.selectTrack.mockClear();
  act(() => {
    instance.emit({ type: "tracks", tracks });
    instance.emit({ type: "playing" });
  });
  expect(instance.selectTrack).not.toHaveBeenCalled();

  act(() => {
    result.current.stop();
    result.current.start(first);
  });
  instance.selectTrack.mockClear();
  act(() => instance.emit({ type: "tracks", tracks }));
  expect(instance.selectTrack).not.toHaveBeenCalled();
  act(() => instance.emit({ type: "playing" }));
  expect(instance.selectTrack).toHaveBeenCalledWith("audio", 2);
  expect(instance.selectTrack).toHaveBeenCalledWith("subtitle", null);
});

test.each([live, movie, episode])(
  "$kind restores saved tracks after reopening in a new controller, after Play resets defaults",
  (target) => {
    const tracks: MediaTrack[] = (["audio", "subtitle"] as const).flatMap((kind, group) =>
      ["en", "fa"].map((language, index) => ({
        id: `${kind}-${language}`,
        identity: `${kind}-${language}`,
        engineIndex: group * 2 + index,
        kind,
        language,
        label: language,
        selected: index === 0,
      })),
    );
    const first = mount();
    act(() => first.result.current.start(target));
    const original = playerMock.instances[0];
    original.getTracks.mockReturnValue(tracks);
    original.selectTrack.mockReturnValue(true);
    act(() => {
      original.emit({ type: "playing" });
      first.result.current.selectTrack("audio", 1, { identity: "audio-fa" });
      first.result.current.selectTrack("subtitle", 3, { identity: "subtitle-fa" });
      first.result.current.stop();
    });
    first.unmount();

    const reopened = mount();
    act(() =>
      reopened.result.current.start({
        ...target,
        resumeAt: target.mode === "finite" ? 64 : undefined,
      }),
    );
    const engine = playerMock.instances[1];
    // Metadata can still claim the desired tracks are selected while Play resets output.
    engine.getTracks.mockReturnValue(
      tracks.map((track) => ({ ...track, selected: track.language === "fa" })),
    );
    let playing = false;
    const output: { audio: number | null; subtitle: number | null } = {
      audio: 0,
      subtitle: 2,
    };
    engine.selectTrack.mockImplementation(
      (kind: "audio" | "subtitle", index: number | null) => {
        if (!playing) return false;
        output[kind] = index;
        return true;
      },
    );
    act(() => engine.emit({ type: "tracks", tracks: engine.getTracks() }));
    expect(engine.selectTrack).not.toHaveBeenCalled();

    playing = true;
    act(() => engine.emit({ type: "playing" }));
    expect(output).toEqual({ audio: 1, subtitle: 3 });
    engine.selectTrack.mockClear();
    act(() => engine.emit({ type: "playing" }));
    expect(engine.selectTrack).not.toHaveBeenCalled();
  },
);

test("saved subtitle Off silences output even when AVPlay reports no selection flags", () => {
  rememberPlaybackTrackChoice(movie, "subtitle", { identity: null });
  const { result } = mount();
  act(() => result.current.start(movie));
  const engine = playerMock.instances[0];
  const tracks: MediaTrack[] = [
    {
      id: "subtitle-en",
      identity: "subtitle-en",
      engineIndex: 2,
      kind: "subtitle",
      language: "en",
      label: "English",
      selected: false,
    },
  ];
  engine.getTracks.mockReturnValue(tracks);
  engine.selectTrack.mockReturnValue(true);
  act(() => engine.emit({ type: "tracks", tracks }));
  expect(engine.selectTrack).not.toHaveBeenCalled();
  act(() => engine.emit({ type: "playing" }));
  expect(engine.selectTrack).toHaveBeenCalledWith("subtitle", null);
});

test("a rejected track selection cannot replace the saved choice", () => {
  const { result } = mount();
  act(() => result.current.start(live));
  playerMock.instances[0].selectTrack.mockReturnValue(true);
  act(() => result.current.selectTrack("audio", 1, { identity: "accepted" }));
  playerMock.instances[0].selectTrack.mockReturnValue(false);
  act(() => result.current.selectTrack("audio", 2, { identity: "rejected" }));
  expect(playbackTrackChoices(live).audio).toEqual({ identity: "accepted" });
});

test("a direct start cancels a pending channel preview", async () => {
  const { result } = mount();
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  const direct = { ...live, id: "live-3", url: "http://example.invalid/3.m3u8" };

  act(() => result.current.start(live));
  act(() => result.current.step(1, [live, second, direct]));
  act(() => result.current.start(direct));
  await act(async () => vi.advanceTimersByTimeAsync(450));

  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: direct.url }),
  );
});

test("releasing a channel step paints a preview then tunes without the fallback delay", async () => {
  const { result } = mount();
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  act(() => {
    result.current.start(live);
    result.current.step(1, [live, second]);
    result.current.commitStep();
  });
  expect(result.current.preview?.id).toBe(second.id);
  await act(async () => vi.advanceTimersByTimeAsync(16));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);

  await act(async () => vi.advanceTimersByTimeAsync(32));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
  expect(result.current.snapshot.target?.id).toBe(second.id);
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("a direct selection cancels a channel release waiting to paint", async () => {
  const { result } = mount();
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  const direct = { ...live, id: "live-3", url: "http://example.invalid/3.m3u8" };
  act(() => {
    result.current.start(live);
    result.current.step(1, [live, second, direct]);
    result.current.commitStep();
    result.current.start(direct);
  });
  await act(async () => vi.advanceTimersByTimeAsync(500));

  expect(result.current.snapshot.target?.id).toBe(direct.id);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("channel presses arriving before a render advance every preview without retuning", async () => {
  const { result, options } = mount();
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  const third = { ...live, id: "live-3", url: "http://example.invalid/3.m3u8" };
  const list = [live, second, third];
  act(() => result.current.start(live));
  options.onNamed.mockClear();

  act(() => {
    const step = result.current.step;
    step(1, list);
    step(1, list);
  });

  expect(result.current.preview?.id).toBe(third.id);
  expect(options.onNamed.mock.calls.map(([target]) => target.id)).toEqual([
    second.id,
    third.id,
  ]);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: third.url }),
  );
});

test("stopping clears the preview anchor before the next channel step", async () => {
  const { result } = mount();
  const second = { ...live, id: "live-2", url: "http://example.invalid/2.m3u8" };
  const list = [live, second];
  act(() => {
    result.current.start(live);
    result.current.step(1, list);
    result.current.stop();
    result.current.step(1, list);
  });

  expect(result.current.preview?.id).toBe(live.id);
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(result.current.snapshot.target?.id).toBe(live.id);
});

test.each([
  ["live channel", live],
  ["movie", movie],
  ["series episode", episode],
])("reselecting the current %s does not restart playback", (_label, target) => {
  const { result } = mount();

  act(() => result.current.start(target));
  act(() => result.current.start(target));

  expect(playerMock.instances[0].play).toHaveBeenCalledOnce();
});

test("a replacement target accepts Play/Pause while its track capabilities load", () => {
  const { result } = mount();
  act(() => result.current.start(live));
  act(() => playerMock.instances[0].emit({ type: "playing" }));
  expect(result.current.capabilities.canPause).toBe(true);

  act(() => result.current.start(movie));

  expect(result.current.snapshot.phase).toBe("connecting");
  expect(result.current.capabilities.canPause).toBe(true);
  expect(result.current.capabilities.audioTracks).toEqual([]);
  expect(result.current.capabilities.subtitleTracks).toEqual([]);
});

test.each(["failed", "ended"] as const)(
  "playback controls reject operations while the current phase is %s",
  (phase) => {
    const { result } = mount();
    act(() => result.current.start(movie));
    const engine = playerMock.instances[0];
    act(() => {
      if (phase === "failed") {
        engine.emit({
          type: "error",
          code: "PLAYER_ERROR_NOT_SUPPORTED_FILE",
          warmKind: null,
        });
      } else if (phase === "ended") {
        engine.emit({ type: "ended" });
      }
    });

    expect(result.current.setPlaying(true)).toBe(false);
    expect(result.current.setPlaying(false)).toBe(false);
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.resumePlayback).not.toHaveBeenCalled();
  },
);

test.each([live, movie, episode])(
  "$kind loads its first picture after Pause is requested",
  (target) => {
    const { result, options } = mount(false);
    act(() => result.current.start(target));
    const engine = playerMock.instances[0];
    expect(result.current.capabilities.canPause).toBe(true);
    act(() => {
      expect(result.current.setPlaying(false)).toBe(true);
    });
    expect(result.current.snapshot).toMatchObject({ phase: "connecting", paused: true });
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.stop).not.toHaveBeenCalled();
    act(() => engine.emit({ type: "buffering-complete" }));
    expect(result.current.snapshot).toMatchObject({ phase: "connecting", paused: true });
    act(() => engine.emit({ type: "playing" }));
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(result.current.snapshot).toMatchObject({ phase: "paused", paused: true });
    expect(options.onPicture).toHaveBeenCalledWith(target);
  },
);

test.each([live, movie, episode])(
  "$kind applies the latest Play/Pause choice when loading finishes",
  (target) => {
    const { result } = mount(false);
    act(() => result.current.start(target));
    const engine = playerMock.instances[0];
    act(() => {
      result.current.togglePlaying();
      result.current.togglePlaying();
    });
    expect(result.current.snapshot).toMatchObject({ phase: "connecting", paused: false });
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.resumePlayback).not.toHaveBeenCalled();
    act(() => engine.emit({ type: "playing" }));
    expect(result.current.snapshot).toMatchObject({ phase: "playing", paused: false });
    expect(engine.pause).not.toHaveBeenCalled();
  },
);

test.each([live, movie, episode])(
  "$kind defers a pause during buffering without suppressing recovery",
  (target) => {
    const { result } = mount(false);
    const engine = playerMock.instances[0];
    act(() => result.current.start(target));
    act(() => engine.emit({ type: "playing" }));
    act(() => engine.emit({ type: "buffering-start" }));
    act(() => result.current.setPlaying(false));
    expect(result.current.snapshot).toMatchObject({ phase: "rebuffering", paused: true });
    expect(engine.pause).not.toHaveBeenCalled();
    act(() => engine.emit({ type: "paused" }));
    expect(result.current.snapshot).toMatchObject({ phase: "rebuffering", paused: true });
    act(() => engine.emit({ type: "buffering-complete" }));
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(result.current.snapshot).toMatchObject({ phase: "paused", paused: true });
  },
);

test.each([live, movie, episode])(
  "$kind preserves Pause while a failed connection is reopened",
  async (target) => {
    const { result } = mount(false);
    const engine = playerMock.instances[0];
    act(() => result.current.start(target));
    act(() => engine.emit({ type: "playing" }));
    await act(async () => {
      engine.emit({ type: "error", code: "NETWORK_ERROR", warmKind: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => result.current.setPlaying(false));
    expect(result.current.snapshot.paused).toBe(true);
    expect(["connecting", "recovering"]).toContain(result.current.snapshot.phase);
    expect(engine.pause).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(engine.play.mock.calls.length).toBeGreaterThan(1);
    expect(result.current.snapshot.paused).toBe(true);
    act(() => engine.emit({ type: "playing" }));
    expect(result.current.snapshot).toMatchObject({ phase: "paused", paused: true });
    expect(engine.pause).toHaveBeenCalledOnce();
  },
);

test("a new target clears a queued pause while retuning preserves it", () => {
  const { result } = mount(false);
  act(() => result.current.start(movie));
  act(() => result.current.setPlaying(false));
  act(() => result.current.retune());
  expect(result.current.snapshot).toMatchObject({ phase: "connecting", paused: true });
  act(() => result.current.start(episode));
  expect(result.current.snapshot).toMatchObject({ phase: "connecting", paused: false });
  act(() => result.current.stop());
  expect(result.current.snapshot).toMatchObject({ phase: "idle", paused: false });
});

test.each([live, movie, episode])(
  "$kind retains picture history when the same target is retuned",
  (target) => {
    const { result } = mount(false);
    const engine = playerMock.instances[0];
    act(() => result.current.start(target));
    act(() => engine.emit({ type: "playing" }));
    act(() => result.current.retune());
    expect(result.current.snapshot.phase).toBe("connecting");
    expect(result.current.recovery).toMatchObject({ hasPlayed: true, statusVisible: true });
    act(() => result.current.stop());
    act(() => result.current.start(target));
    expect(result.current.recovery.hasPlayed).toBe(false);
  },
);

test("an engine that rejects a deferred pause reports the existing pause availability message", () => {
  const { result, options } = mount(false);
  const engine = playerMock.instances[0];
  act(() => result.current.start(movie));
  act(() => result.current.setPlaying(false));
  engine.pause.mockReturnValue(false);
  act(() => engine.emit({ type: "playing" }));
  expect(result.current.snapshot).toMatchObject({ phase: "playing", paused: false });
  expect(options.onMessage).toHaveBeenCalledWith("deck.pauseUnavailable");
});

test("target equality includes playlist and URL and clears a pending preview", async () => {
  const { result } = mount();
  const preview = { ...live, id: "live-2", url: "http://example.invalid/preview.m3u8" };
  act(() => result.current.start(live));
  act(() => result.current.step(1, [live, preview]));
  act(() => result.current.start(live));
  expect(result.current.preview).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);

  act(() => result.current.start({ ...live, playlistId: "playlist-2" }));
  act(() =>
    result.current.start({
      ...live,
      playlistId: "playlist-2",
      url: "http://example.invalid/replaced.m3u8",
    }),
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(3);
});

test("the browser player follows the visible video element after a screen remount", () => {
  const { options, rerender } = mount();
  const engine = playerMock.instances[0];
  const first = options.video.current;
  const replacement = document.createElement("video");

  expect(engine.attach).toHaveBeenCalledWith(first);
  options.video.current = replacement;
  rerender(options);

  expect(engine.detach).toHaveBeenCalledOnce();
  expect(engine.attach).toHaveBeenLastCalledWith(replacement);
});

test("stopping reports the final engine clock before teardown", () => {
  const { result, options } = mount();
  act(() => result.current.start(movie));
  playerMock.instances[0].clock = {
    ...playerMock.instances[0].clock,
    position: 47,
    duration: 120,
  };

  act(() => result.current.stop());

  expect(options.onStopped).toHaveBeenCalledWith(
    expect.objectContaining({ id: movie.id }),
    expect.objectContaining({ position: 47, duration: 120 }),
  );
});

test("finite targets bypass compatibility preparation and start at their resume position", () => {
  const { result } = mount(true);
  act(() => result.current.start(movie));

  expect(repairMock.prepare).not.toHaveBeenCalled();
  expect(repairMock.idleRepair).toHaveBeenCalledOnce();
  expect(playerMock.instances[0].play).toHaveBeenCalledWith({
    url: movie.url,
    browserRepair: false,
    bufferSeconds: 6,
    segmentSeconds: 3,
    mode: "finite",
    startSeconds: 25,
  });
});

test("a diagnosed playlist address reaches the open request when compatibility is on", async () => {
  repairMock.prepare.mockResolvedValue({
    url: "http://127.0.0.1:8123/live.m3u8",
    repaired: true,
    browser: false,
    bufferSeconds: 11,
    segmentSeconds: 7,
  });
  const { result } = mount(true);
  act(() => result.current.start(live));
  await act(async () => vi.advanceTimersByTimeAsync(0));

  expect(playerMock.instances[0].play).toHaveBeenCalledWith({
    url: "http://127.0.0.1:8123/live.m3u8",
    browserRepair: false,
    bufferSeconds: 11,
    segmentSeconds: 7,
    mode: "live",
    startSeconds: 0,
  });
});

test("a warm engine fault is fixed in place before anything is torn down", () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  engine.warmRecover.mockReturnValue(true);
  act(() => engine.emit({ type: "error", code: "network unreachable", warmKind: "network" }));

  expect(engine.warmRecover).toHaveBeenCalledWith("network");
  expect(engine.play).toHaveBeenCalledTimes(1);
  expect(result.current.recovery.stage).toBe("warm");

  act(() => engine.emit({ type: "playing" }));
  expect(result.current.snapshot.phase).toBe("playing");
});

test("a fault compatibility mode can explain reopens through the repaired address", async () => {
  repairMock.prepare.mockResolvedValue({
    url: "http://127.0.0.1:8123/live.m3u8",
    repaired: true,
    browser: false,
    bufferSeconds: 11,
    segmentSeconds: 7,
  });
  const { result } = mount(true);
  act(() => result.current.start(live));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  const engine = playerMock.instances[0];
  expect(engine.play).toHaveBeenCalledTimes(1);

  act(() => engine.emit({ type: "error", code: "manifestLoadError", warmKind: null }));
  await act(async () => vi.advanceTimersByTimeAsync(0));

  expect(repairMock.prepare).toHaveBeenCalledWith(live.url, live.playlistId, true);
  expect(engine.play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: "http://127.0.0.1:8123/live.m3u8" }),
  );
});

test("HTTP pages retry failed HTTPS media once over HTTP, and only once per session", async () => {
  const secureMovie = { ...movie, url: "https://example.invalid/movie.mp4" };
  const { result } = mount();
  act(() => result.current.start(secureMovie));
  act(() =>
    playerMock.instances[0].emit({ type: "error", code: "manifestLoadError", warmKind: null }),
  );

  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: "http://example.invalid/movie.mp4" }),
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);

  // The second fault in the same session must not try the fallback again.
  act(() =>
    playerMock.instances[0].emit({ type: "error", code: "manifestLoadError", warmKind: null }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
  expect(result.current.recovery.stage).toBe("waiting");
});

test("HTTP finite media retries once through the local relay at the current clock", async () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  playerMock.instances[0].clock = { ...playerMock.instances[0].clock, position: 42 };
  act(() =>
    playerMock.instances[0].emit({ type: "error", code: "manifestLoadError", warmKind: null }),
  );

  const relayed = new URL("/__openiptv_http_relay__", window.location.origin);
  relayed.searchParams.set("url", movie.url);
  expect(playerMock.instances[0].play).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: relayed.toString(), startSeconds: 42 }),
  );
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("packaged TV fallback stays direct because no local relay exists", () => {
  expect(httpFallback("https://provider.example/movie.mp4", "file:", "null")).toBe(
    "http://provider.example/movie.mp4",
  );
  expect(httpFallback("http://provider.example/movie.mp4", "file:", "null")).toBe("");
});

test("an undecodable format is terminal and is never retried", async () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  act(() =>
    playerMock.instances[0].emit({
      type: "error",
      code: "PLAYER_ERROR_NOT_SUPPORTED_FILE",
      warmKind: null,
    }),
  );

  expect(result.current.snapshot.phase).toBe("failed");
  expect(result.current.snapshot.fault).toBe("PLAYER_ERROR_NOT_SUPPORTED_FILE");
  act(() => vi.advanceTimersByTime(120_000));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
});

test("finite pause resumes in place and seek pauses once before one final commit", async () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  act(() => playerMock.instances[0].emit({ type: "playing" }));
  act(() => result.current.setPlaying(false));
  expect(playerMock.instances[0].pause).toHaveBeenCalledOnce();
  expect(result.current.snapshot.phase).toBe("paused");

  act(() => result.current.setPlaying(true));
  expect(playerMock.instances[0].resumePlayback).toHaveBeenCalledOnce();

  act(() => {
    result.current.seekBy(10);
    result.current.seekBy(10);
  });
  expect(playerMock.instances[0].pause).toHaveBeenCalledTimes(2);
  expect(result.current.quickSeek?.deltaSeconds).toBe(20);
  expect(playerMock.instances[0].seekTo).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS - 1));
  expect(playerMock.instances[0].seekTo).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(playerMock.instances[0].seekTo).toHaveBeenCalledWith(20);
  expect(playerMock.instances[0].resumePlayback).toHaveBeenCalledTimes(2);
  expect(result.current.quickSeek).toBeNull();
});

test.each([
  { target: movie, route: "seekBy" },
  { target: movie, route: "seekTo" },
  { target: episode, route: "seekBy" },
  { target: episode, route: "seekTo" },
  { target: live, route: "seekBy" },
  { target: live, route: "seekTo" },
] as const)(
  "$target.kind $route waits for idle after spaced presses and a direction reversal",
  async ({ target, route }) => {
    const { result } = mount();
    const engine = playerMock.instances[0];
    engine.clock = {
      ...engine.clock,
      position: 60,
      duration: target.mode === "live" ? null : 1200,
      seekableStart: 0,
      seekableEnd: 1200,
      engineLiveEdge: 1200,
    };
    act(() => result.current.start(target));
    act(() => engine.emit({ type: "playing" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.snapshot.position).toBe(60);
    expect(result.current.snapshot.seekRange).toEqual(
      expect.objectContaining({ startSeconds: 0, endSeconds: 1200 }),
    );
    engine.seekTo.mockClear();
    engine.pause.mockClear();
    engine.resumePlayback.mockClear();

    act(() => result.current[route](route === "seekBy" ? 10 : 70));
    if (route === "seekBy") {
      expect(result.current.quickSeek).toEqual({ deltaSeconds: 10, targetSeconds: 70 });
    }
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(engine.seekTo).not.toHaveBeenCalled();

    act(() => result.current[route](route === "seekBy" ? 10 : 80));
    if (route === "seekBy") {
      expect(result.current.quickSeek).toEqual({ deltaSeconds: 20, targetSeconds: 80 });
    }
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(engine.seekTo).not.toHaveBeenCalled();

    act(() => result.current[route](route === "seekBy" ? -10 : 70));
    if (route === "seekBy") {
      expect(result.current.quickSeek).toEqual({ deltaSeconds: 10, targetSeconds: 70 });
    }
    expect(engine.seekTo).not.toHaveBeenCalled();
    expect(result.current.snapshot.phase).toBe("paused");
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(engine.resumePlayback).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS - 1));
    expect(engine.seekTo).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);
    expect(engine.pause).toHaveBeenCalledOnce();
    expect(engine.resumePlayback).toHaveBeenCalledOnce();
    expect(result.current.snapshot.phase).toBe("playing");
    expect(result.current.quickSeek).toBeNull();
  },
);

test("an originally paused seek updates its preview and stays paused after settling", async () => {
  const { result } = mount();
  const engine = playerMock.instances[0];
  engine.clock = { ...engine.clock, position: 60, duration: 1200 };
  act(() => result.current.start(movie));
  act(() => engine.emit({ type: "playing" }));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.snapshot.seekRange).toEqual({
    startSeconds: 0,
    endSeconds: 1200,
    liveEdge: false,
  });
  act(() => result.current.setPlaying(false));
  expect(result.current.snapshot.phase).toBe("paused");
  engine.pause.mockClear();
  engine.resumePlayback.mockClear();
  engine.seekTo.mockClear();

  act(() => result.current.seekBy(10));
  expect(result.current.quickSeek?.targetSeconds).toBe(70);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(engine.seekTo).not.toHaveBeenCalled();
  act(() => result.current.seekBy(-10));
  expect(result.current.quickSeek?.targetSeconds).toBe(60);
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS - 1));
  expect(engine.seekTo).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));

  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(60);
  expect(engine.pause).toHaveBeenCalledOnce();
  expect(engine.resumePlayback).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("paused");
  expect(result.current.quickSeek).toBeNull();
});

test.each(["stop", "replacement", "unmount"] as const)(
  "%s cancels a seek that has not settled",
  async (action) => {
    const { result, unmount } = mount();
    const engine = playerMock.instances[0];
    engine.clock = { ...engine.clock, position: 60, duration: 1200 };
    act(() => result.current.start(movie));
    act(() => engine.emit({ type: "playing" }));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.snapshot.seekRange).not.toBeNull();
    engine.seekTo.mockClear();
    engine.resumePlayback.mockClear();

    act(() => result.current.seekBy(10));
    expect(result.current.quickSeek?.targetSeconds).toBe(70);
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(engine.seekTo).not.toHaveBeenCalled();
    if (action === "stop") act(() => result.current.stop());
    else if (action === "replacement") act(() => result.current.start(episode));
    else unmount();
    await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS + 1));

    expect(engine.seekTo).not.toHaveBeenCalled();
    expect(engine.resumePlayback).not.toHaveBeenCalled();
    if (action !== "unmount") {
      expect(result.current.quickSeek).toBeNull();
      expect(result.current.snapshot.target?.id ?? null).toBe(
        action === "replacement" ? episode.id : null,
      );
    }
  },
);

test("a pause before the first picture stays in the connecting phase", () => {
  const { result } = mount();
  act(() => result.current.start(movie));

  act(() => playerMock.instances[0].emit({ type: "paused" }));

  expect(result.current.snapshot.phase).toBe("connecting");
});

test("an engine initiated pause publishes the paused phase", () => {
  const { result } = mount();
  act(() => result.current.start(movie));
  act(() => playerMock.instances[0].emit({ type: "playing" }));

  act(() => playerMock.instances[0].emit({ type: "paused" }));

  expect(result.current.snapshot.phase).toBe("paused");
});

test("a stale seek completion cannot mutate a newer target", async () => {
  const { result, options } = mount();
  const engine = playerMock.instances[0];
  engine.clock = { ...engine.clock, position: 60, duration: 1200 };
  act(() => result.current.start(movie));
  act(() => engine.emit({ type: "playing" }));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.snapshot.seekRange).not.toBeNull();
  let finish: ((moved: boolean) => void) | undefined;
  engine.seekTo.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => result.current.seekTo(50));
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS));
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(50);
  expect(finish).toBeTypeOf("function");
  expect(engine.resumePlayback).not.toHaveBeenCalled();
  act(() => result.current.start(episode));
  const replacement = result.current.snapshot;
  await act(async () => finish?.(false));

  expect(result.current.snapshot).toEqual(replacement);
  expect(result.current.snapshot.target?.id).toBe(episode.id);
  expect(result.current.snapshot.phase).toBe("connecting");
  expect(options.onMessage).not.toHaveBeenCalled();
  expect(engine.resumePlayback).not.toHaveBeenCalled();
});

test("a stale Go live completion cannot retune a newer target", async () => {
  const { result } = mount();
  const next = { ...live, id: "live-2", url: "http://example.invalid/next.m3u8" };
  act(() => result.current.start(live));
  playerMock.instances[0].clock = {
    ...playerMock.instances[0].clock,
    position: 20,
    seekableStart: 0,
    /* The window has to clear the usefulness floor for Go live to queue at all. */
    seekableEnd: 1000,
    engineLiveEdge: 1000,
  };
  act(() => vi.advanceTimersByTime(2_000));
  let finish: ((moved: boolean) => void) | undefined;
  playerMock.instances[0].seekTo.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      finish = resolve;
    }),
  );
  act(() => result.current.goLive());
  expect(playerMock.instances[0].seekTo).toHaveBeenCalledOnce();
  act(() => result.current.start(next));
  await act(async () => finish?.(false));

  expect(result.current.snapshot.target?.id).toBe(next.id);
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(2);
});

test("finite timing is exposed and completion does not retry", async () => {
  const { result, options } = mount();
  act(() => result.current.start(movie));
  playerMock.instances[0].clock = {
    ...playerMock.instances[0].clock,
    position: 40,
    duration: 120,
  };
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.snapshot.position).toBe(40);
  expect(result.current.snapshot.duration).toBe(120);

  act(() => playerMock.instances[0].emit({ type: "ended" }));
  expect(options.onEnded).toHaveBeenCalledWith(expect.objectContaining({ id: movie.id }));
  expect(options.onStopped).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("idle");
  expect(result.current.snapshot.target).toBeNull();
  expect(result.current.shown).toBeNull();
  expect(playerMock.instances[0].stop).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(60_000));
  expect(playerMock.instances[0].play).toHaveBeenCalledTimes(1);
});

test("live completion remains an error and retains automatic retry", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  act(() => engine.emit({ type: "ended" }));
  // The relay fallback takes the first corrective step, the schedule the rest.
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  await act(async () => vi.advanceTimersByTimeAsync(4_000));
  expect(engine.play.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(result.current.snapshot.phase).not.toBe("ended");
});

test("a frozen playhead becomes a fault through the coordinator", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  engine.clock = { ...engine.clock, position: 12 };
  act(() => engine.emit({ type: "playing" }));
  expect(result.current.snapshot.phase).toBe("playing");

  // Nothing moves for twelve seconds of sampling: one tick to learn the position, then
  // four silent ticks before the limit is reached.
  act(() => vi.advanceTimersByTime(16_000));
  expect(result.current.recovery.cause).toBe("frozen-playhead");
  expect(result.current.snapshot.phase).toBe("recovering");
});

test("going off screen suspends the engine and returning coordinates one restore", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];

  const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  try {
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(engine.hide).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(60_000));
    expect(engine.play).toHaveBeenCalledTimes(1);
  } finally {
    if (hidden) Object.defineProperty(document, "hidden", hidden);
    else Reflect.deleteProperty(document, "hidden");
  }
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(engine.show).toHaveBeenCalledOnce();
});

test("returning visible before the first picture rearms the startup watchdog", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  try {
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => vi.advanceTimersByTime(60_000));
    expect(engine.play).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.snapshot.phase).toBe("connecting");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(result.current.recovery.cause).toBe("startup-timeout");
  } finally {
    if (hidden) Object.defineProperty(document, "hidden", hidden);
    else Reflect.deleteProperty(document, "hidden");
  }
});

test("a rebuffer under the status delay stays quiet, a real one announces itself", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  act(() => engine.emit({ type: "playing" }));

  act(() => engine.emit({ type: "buffering-start" }));
  await act(async () => vi.advanceTimersByTimeAsync(1_400));
  expect(result.current.recovery.statusVisible).toBe(false);

  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(result.current.recovery.statusVisible).toBe(true);
  expect(result.current.recovery.stage).toBe("buffering");

  act(() => engine.emit({ type: "buffering-complete" }));
  act(() => engine.emit({ type: "playing" }));
  expect(result.current.recovery.statusVisible).toBe(false);
});

test("a delayed retry counts down in the same compact state", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];
  act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
  await act(async () => vi.advanceTimersByTimeAsync(0));

  expect(result.current.recovery.stage).toBe("waiting");
  expect(result.current.recovery.statusVisible).toBe(true);
  expect(result.current.recovery.retryIn).toBeGreaterThan(0);
  await act(async () => vi.advanceTimersByTimeAsync(1_000));
  expect(result.current.recovery.retryIn).toBeLessThan(4);
});

test("continuous reconnect keeps a live channel retrying past the bounded schedule", async () => {
  const { result } = mount(false, true);
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];

  // Every bounded attempt and then some: a live session with the setting on never lands
  // on terminal while the same channel stays selected.
  for (let round = 0; round < 5; round++) {
    act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
    await act(async () => vi.advanceTimersByTimeAsync(70_000));
  }

  expect(result.current.recovery.stage).not.toBe("terminal");
  expect(result.current.snapshot.phase).not.toBe("failed");
});

test("without the setting the same failures end at the bounded result", async () => {
  const { result } = mount();
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];

  for (let round = 0; round < 5; round++) {
    act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
  }

  expect(result.current.recovery.stage).toBe("terminal");
  expect(result.current.snapshot.phase).toBe("failed");
});

test("finite targets keep the bounded retry policy even with continuous reconnect", async () => {
  const { result } = mount(false, true);
  act(() => result.current.start(movie));
  const engine = playerMock.instances[0];

  for (let round = 0; round < 5; round++) {
    act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
  }

  expect(result.current.recovery.stage).toBe("terminal");
});

test("turning continuous reconnect off during an extended wait ends it", async () => {
  const options = {
    compatibility: false,
    continuousReconnect: true,
  };
  const video = { current: document.createElement("video") };
  const base = {
    fit: "fit" as const,
    video,
    onNamed: vi.fn(),
    onPicture: vi.fn(),
    onMessage: vi.fn(),
    onEnded: vi.fn(),
    onStopped: vi.fn(),
    rememberLast: vi.fn(),
  };
  const { result, rerender } = renderHook(
    (props: typeof base & typeof options) => usePlaybackController(props),
    { initialProps: { ...base, ...options } },
  );
  act(() => result.current.start(live));
  const engine = playerMock.instances[0];

  // Push past the bounded schedule into a continuous wait.
  for (let round = 0; round < 4; round++) {
    act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
    await act(async () => vi.advanceTimersByTimeAsync(70_000));
  }
  act(() => engine.emit({ type: "error", code: "socket dropped", warmKind: null }));
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(result.current.recovery.stage).toBe("waiting");

  rerender({ ...base, compatibility: false, continuousReconnect: false });
  expect(result.current.recovery.stage).toBe("terminal");
  expect(result.current.snapshot.phase).toBe("failed");
});

const mountSeekable = () => {
  const mounted = mount();
  const engine = playerMock.instances[0];
  engine.clock = {
    ...engine.clock,
    position: 60,
    duration: 1200,
    seekableStart: 0,
    seekableEnd: 1200,
    engineLiveEdge: 1200,
  };
  act(() => mounted.result.current.start(movie));
  act(() => engine.emit({ type: "playing" }));
  act(() => vi.advanceTimersByTime(1000));
  engine.seekTo.mockClear();
  engine.pause.mockClear();
  engine.resumePlayback.mockClear();
  return { ...mounted, engine };
};

test("flushSeek commits a pending seek immediately and clears the overlay", async () => {
  const { result, engine } = mountSeekable();
  act(() => result.current.seekBy(10));
  expect(result.current.quickSeek?.targetSeconds).toBe(70);
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);
  expect(result.current.quickSeek).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS));
  expect(engine.seekTo).toHaveBeenCalledOnce();
  expect(result.current.snapshot.phase).toBe("playing");
});

test("flushSeek does nothing without a pending seek", () => {
  const { result, engine } = mountSeekable();
  act(() => result.current.flushSeek());
  expect(engine.seekTo).not.toHaveBeenCalled();
  expect(result.current.seeking).toBe(false);
  act(() => result.current.flushSeek());
  expect(engine.seekTo).not.toHaveBeenCalled();
});

test("an already paused playback stays paused after a flushed seek", async () => {
  const { result, engine } = mountSeekable();
  act(() => result.current.setPlaying(false));
  engine.pause.mockClear();
  engine.resumePlayback.mockClear();
  act(() => result.current.seekBy(10));
  expect(engine.pause).not.toHaveBeenCalled();
  act(() => result.current.flushSeek());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);
  expect(engine.resumePlayback).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("paused");
});

test("pausing during a pending seek suppresses the resume when it lands", async () => {
  const { result, engine } = mountSeekable();
  act(() => result.current.seekBy(10));
  act(() => result.current.setPlaying(false));
  expect(result.current.snapshot.paused).toBe(true);
  act(() => result.current.flushSeek());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(engine.seekTo).toHaveBeenCalledOnce();
  expect(engine.resumePlayback).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("paused");
  expect(result.current.snapshot.paused).toBe(true);
});

test("stopping cancels a pending seek and drops the flag", async () => {
  const { result, engine } = mountSeekable();
  act(() => result.current.seekBy(10));
  expect(result.current.seeking).toBe(true);
  act(() => result.current.stop());
  expect(result.current.seeking).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS));
  expect(engine.seekTo).not.toHaveBeenCalled();
});

test("a seek queued while one is in flight serializes and delivers only the latest target", async () => {
  const { result, engine } = mountSeekable();
  let resolveFirst!: (moved: boolean) => void;
  engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveFirst = resolve)),
  );
  act(() => result.current.seekBy(10));
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);

  act(() => result.current.seekBy(20));
  expect(result.current.quickSeek?.targetSeconds).toBe(90);
  /* The new intent is queued behind the running seek, so no parallel engine call. */
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledOnce();

  await act(async () => {
    resolveFirst(true);
    await Promise.resolve();
  });
  expect(engine.seekTo).toHaveBeenCalledTimes(2);
  expect(engine.seekTo).toHaveBeenLastCalledWith(90);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(result.current.seeking).toBe(false);
  expect(result.current.snapshot.phase).toBe("playing");
});

test("seeking stays true until the last operation settles", async () => {
  const { result, engine } = mountSeekable();
  let resolveSeek!: (moved: boolean) => void;
  engine.seekTo.mockImplementation(
    () => new Promise<boolean>((resolve) => (resolveSeek = resolve)),
  );
  act(() => result.current.seekBy(10));
  expect(result.current.seeking).toBe(true);
  act(() => result.current.flushSeek());
  expect(result.current.seeking).toBe(true);
  await act(async () => {
    resolveSeek(true);
    await Promise.resolve();
  });
  expect(result.current.seeking).toBe(false);
});

test("a seek whose range disappears before commit restores the pause instead of sticking", async () => {
  const { result, engine } = mountSeekable();
  /*
   * The finite clock ticks every 1000ms and mountSeekable just spent one, so this
   * advance leaves the next tick 500ms away. The seek debounce is 750ms, which puts the
   * tick 250ms before the commit would have run: the window can be observed gone while
   * the seek is still only pending.
   */
  await act(async () => vi.advanceTimersByTimeAsync(500));
  act(() => result.current.seekBy(10));
  expect(result.current.seeking).toBe(true);

  engine.clock = {
    ...engine.clock,
    duration: null,
    seekableStart: null,
    seekableEnd: null,
    engineLiveEdge: null,
  };
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(result.current.snapshot.seekRange).toBeNull();

  act(() => result.current.flushSeek());
  await act(async () => vi.advanceTimersByTimeAsync(0));
  /* No engine call is owed: the seek released its flags and gave the temporary pause
     back rather than leaving the coordinator seeking for ever. */
  expect(engine.seekTo).not.toHaveBeenCalled();
  expect(engine.resumePlayback).toHaveBeenCalledOnce();
  expect(result.current.seeking).toBe(false);
  expect(result.current.snapshot.phase).toBe("playing");

  /* The spent debounce stays dead: nothing arrives when its window would have ended. */
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS));
  expect(engine.seekTo).not.toHaveBeenCalled();
});

/*
 * One seek running natively with a newer one already queued behind it: the pair is the
 * state every teardown path has to survive, because the queued session's debounce is
 * already spent while the engine's answer is still owed.
 */
const mountSeekablePair = () => {
  const mounted = mountSeekable();
  let resolveFirst!: (moved: boolean) => void;
  mounted.engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveFirst = resolve)),
  );
  act(() => mounted.result.current.seekBy(10));
  act(() => mounted.result.current.flushSeek());
  expect(mounted.engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);
  act(() => mounted.result.current.seekBy(20));
  act(() => mounted.result.current.flushSeek());
  expect(mounted.engine.seekTo).toHaveBeenCalledOnce();
  return { ...mounted, resolveFirst };
};

test.each(
  (["stop", "replacement", "unmount"] as const).flatMap((action) =>
    [true, false].map((moved) => ({ action, moved })),
  ),
)(
  "$action invalidates a queued seek behind one still running (moved=$moved)",
  async ({ action, moved }) => {
    const { result, options, engine, unmount, resolveFirst } = mountSeekablePair();
    if (action === "stop") act(() => result.current.stop());
    else if (action === "replacement") act(() => result.current.start(episode));
    else unmount();

    /* Whether the dead engine call reports success or failure, the answer belongs to a
       session that no longer exists and must not resume, complain or retarget. */
    await act(async () => {
      resolveFirst(moved);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS + 1));

    /* The late answer belongs to a dead session: no resume, no failure message, no
       second engine call, and a replacement target is left exactly where it was. */
    expect(engine.seekTo).toHaveBeenCalledOnce();
    expect(engine.resumePlayback).not.toHaveBeenCalled();
    expect(options.onMessage).not.toHaveBeenCalledWith("error.seekUnavailable");
    if (action === "stop") {
      expect(result.current.snapshot.target).toBeNull();
      expect(result.current.snapshot.phase).toBe("idle");
    } else if (action === "replacement") {
      expect(result.current.snapshot.target?.id).toBe(episode.id);
      expect(result.current.snapshot.phase).toBe("connecting");
    }
  },
);

test("pausing during an active seek and across its queued replacement stays paused", async () => {
  const { result, engine } = mountSeekable();
  const pending: Array<(moved: boolean) => void> = [];
  engine.seekTo.mockImplementation(
    () => new Promise<boolean>((resolve) => pending.push(resolve)),
  );
  act(() => result.current.seekBy(10));
  act(() => result.current.flushSeek());
  act(() => result.current.seekBy(20));
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);

  /* The press updates the intent on both the running session and the queued one rather
     than toggling the engine underneath the seek. */
  act(() => result.current.setPlaying(false));
  await act(async () => {
    pending[0](true);
    await Promise.resolve();
  });
  expect(engine.seekTo).toHaveBeenCalledTimes(2);
  expect(engine.seekTo).toHaveBeenLastCalledWith(90);
  await act(async () => {
    pending[1](true);
    await Promise.resolve();
  });

  expect(engine.resumePlayback).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("paused");
  expect(result.current.seeking).toBe(false);
});

test("a seek finishing before a newer debounce waits without briefly resuming", async () => {
  const { result, engine } = mountSeekable();
  let resolveFirst!: (moved: boolean) => void;
  engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveFirst = resolve)),
  );
  act(() => result.current.seekBy(10));
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(70);

  /* The replacement is still inside its settle period, so its intent is queued but not
     ready: the finished seek must not restore playback for the gap. */
  act(() => result.current.seekBy(20));
  await act(async () => {
    resolveFirst(true);
    await Promise.resolve();
  });
  expect(engine.seekTo).toHaveBeenCalledOnce();
  expect(engine.resumePlayback).not.toHaveBeenCalled();
  expect(result.current.snapshot.phase).toBe("paused");
  expect(result.current.seeking).toBe(true);

  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS - 1));
  expect(engine.seekTo).toHaveBeenCalledOnce();
  expect(engine.resumePlayback).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(engine.seekTo).toHaveBeenCalledTimes(2);
  expect(engine.seekTo).toHaveBeenLastCalledWith(90);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(engine.resumePlayback).toHaveBeenCalledOnce();
  expect(result.current.snapshot.phase).toBe("playing");
  expect(result.current.seeking).toBe(false);
});

const mountLiveSeekable = () => {
  const mounted = mount();
  const engine = playerMock.instances[0];
  engine.clock = {
    ...engine.clock,
    position: 20,
    duration: null,
    seekableStart: 0,
    seekableEnd: 1000,
    engineLiveEdge: 1000,
  };
  act(() => mounted.result.current.start(live));
  act(() => engine.emit({ type: "playing" }));
  act(() => vi.advanceTimersByTime(2000));
  engine.seekTo.mockClear();
  engine.pause.mockClear();
  engine.resumePlayback.mockClear();
  engine.play.mockClear();
  return { ...mounted, engine };
};

test("Go live queues behind a running seek and delivers the safe target once", async () => {
  const { result, engine } = mountLiveSeekable();
  const pending: Array<(moved: boolean) => void> = [];
  engine.seekTo.mockImplementation(
    () => new Promise<boolean>((resolve) => pending.push(resolve)),
  );
  act(() => result.current.seekBy(10));
  act(() => result.current.flushSeek());
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(30);

  /* Go live rides the same queue: it waits for the running seek rather than calling the
     engine in parallel, then commits with the newest request's flag. */
  act(() => result.current.goLive());
  expect(engine.seekTo).toHaveBeenCalledOnce();
  const safe = safeLiveTarget(
    { startSeconds: 0, endSeconds: 1000 },
    DEFAULT_SEGMENT_SECONDS,
    1000,
  );

  await act(async () => {
    pending[0](true);
    await Promise.resolve();
  });
  expect(engine.seekTo).toHaveBeenCalledTimes(2);
  expect(engine.seekTo).toHaveBeenLastCalledWith(safe);
  await act(async () => {
    pending[1](true);
    await Promise.resolve();
  });
  expect(result.current.snapshot.phase).toBe("playing");
  expect(result.current.seeking).toBe(false);
});

test("an ordinary seek supersedes a queued Go live before it commits", async () => {
  const { result, engine } = mountLiveSeekable();
  let resolveFirst!: (moved: boolean) => void;
  engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveFirst = resolve)),
  );
  act(() => result.current.seekBy(10));
  act(() => result.current.flushSeek());
  act(() => result.current.goLive());
  act(() => result.current.seekTo(50));
  act(() => result.current.flushSeek());

  await act(async () => {
    resolveFirst(true);
    await Promise.resolve();
  });
  /* The newest word wins: the queued Go live was replaced by the ordinary target, so the
     second engine call is 50 and there is no third call back to the edge. */
  expect(engine.seekTo).toHaveBeenCalledTimes(2);
  expect(engine.seekTo).toHaveBeenLastCalledWith(50);
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(result.current.seeking).toBe(false);
});

test("Go live overrides a seek still inside its debounce before any native call", async () => {
  const { result, engine } = mountLiveSeekable();
  let resolveSeek!: (moved: boolean) => void;
  engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveSeek = resolve)),
  );

  /* The ordinary seek is only queued: its settle timer has not fired and the engine has
     heard nothing yet. */
  act(() => result.current.seekBy(10));
  expect(engine.seekTo).not.toHaveBeenCalled();
  expect(result.current.seeking).toBe(true);

  /* Go live replaces the pending target outright and commits at once, so exactly one
     native call goes out and it is the safe live target, never the obsolete seek. */
  act(() => result.current.goLive());
  const safe = safeLiveTarget(
    { startSeconds: 0, endSeconds: 1000 },
    DEFAULT_SEGMENT_SECONDS,
    1000,
  );
  expect(engine.seekTo).toHaveBeenCalledExactlyOnceWith(safe);

  /* The replaced debounce is dead: letting its full settle period pass delivers
     nothing more. */
  await act(async () => vi.advanceTimersByTimeAsync(SEEK_SETTLE_MS));
  expect(engine.seekTo).toHaveBeenCalledOnce();

  await act(async () => {
    resolveSeek(true);
    await Promise.resolve();
  });
  await act(async () => vi.advanceTimersByTimeAsync(0));
  expect(result.current.seeking).toBe(false);
  expect(result.current.snapshot.phase).toBe("playing");
});

test("a failed Go live retunes the same target and resets the seek state", async () => {
  const { result, engine } = mountLiveSeekable();
  let resolveSeek!: (moved: boolean) => void;
  engine.seekTo.mockImplementationOnce(
    () => new Promise<boolean>((resolve) => (resolveSeek = resolve)),
  );
  const url = result.current.snapshot.target?.url;
  act(() => result.current.goLive());
  await act(async () => {
    resolveSeek(false);
    await Promise.resolve();
  });

  expect(engine.play).toHaveBeenCalledTimes(1);
  expect(engine.play.mock.calls[0][0]).toMatchObject({ url });
  expect(result.current.seeking).toBe(false);
  expect(result.current.snapshot.phase).toBe("connecting");
  expect(result.current.snapshot.target?.id).toBe(live.id);
});
