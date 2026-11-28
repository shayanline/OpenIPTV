import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PlaybackClock, PlayerOpenRequest } from "../src/services/player";
import {
  PlaybackRecoveryCoordinator,
  type RecoveryActions,
  type RecoverySession,
  type RecoveryState,
} from "../src/services/playbackRecovery";
import type { PlaybackTarget } from "../src/types";

const target = (id = "one"): PlaybackTarget => ({
  id,
  playlistId: "p",
  mode: "live",
  kind: "live",
  name: `Channel ${id}`,
  group: "g",
  logo: "",
  url: `https://stream.invalid/${id}`,
});

const openRequest = (url: string): PlayerOpenRequest => ({
  url,
  browserRepair: false,
  bufferSeconds: 6,
  segmentSeconds: 3,
  mode: "live",
  startSeconds: 0,
});

const session = (id = "one", extra: Partial<RecoverySession> = {}): RecoverySession => ({
  key: `key-${id}`,
  target: target(id),
  originalUrl: `https://stream.invalid/${id}`,
  request: openRequest(`https://stream.invalid/${id}`),
  segmentSeconds: 3,
  compatibility: true,
  continuousReconnect: false,
  ...extra,
});

interface Harness {
  coordinator: PlaybackRecoveryCoordinator;
  calls: string[];
  upstreams: string[];
  states: RecoveryState[];
  clockPosition: () => number | null;
  diagnoseDeferred: { resolve: (r: PlayerOpenRequest | null) => void } | null;
  options: {
    warm: boolean;
    diagnoseResult: PlayerOpenRequest | null;
    holdDiagnose: boolean;
    fallbackResult: PlayerOpenRequest | null;
    streamFallbackResult: PlayerOpenRequest | null;
    restore: boolean;
  };
}

const makeHarness = (extra?: Partial<Harness["options"]>): Harness => {
  const harness: Harness = {
    coordinator: null as unknown as PlaybackRecoveryCoordinator,
    calls: [],
    upstreams: [],
    states: [],
    clockPosition: () => null,
    diagnoseDeferred: null,
    options: {
      warm: false,
      diagnoseResult: null,
      holdDiagnose: false,
      fallbackResult: null,
      streamFallbackResult: null,
      restore: true,
      ...extra,
    },
  };
  const clock = (): PlaybackClock => ({
    position: harness.clockPosition(),
    duration: null,
    seekableStart: null,
    seekableEnd: null,
    engineLiveEdge: null,
    segmentSeconds: null,
  });
  const actions: RecoveryActions = {
    clock,
    warmRecover: () => {
      harness.calls.push("warm");
      return harness.options.warm;
    },
    diagnose: (session) => {
      harness.calls.push("compatibility");
      harness.upstreams.push(session.originalUrl);
      if (harness.options.holdDiagnose) {
        return new Promise<PlayerOpenRequest | null>((resolve) => {
          harness.diagnoseDeferred = { resolve };
        });
      }
      return Promise.resolve(harness.options.diagnoseResult);
    },
    streamFallback: () => {
      if (harness.options.streamFallbackResult) harness.calls.push("stream-fallback");
      return harness.options.streamFallbackResult;
    },
    fallback: (session) => {
      harness.calls.push("http-fallback");
      harness.upstreams.push(session.originalUrl);
      return harness.options.fallbackResult;
    },
    reopen: (request) => {
      harness.calls.push(`reopen:${request.url}`);
      return request;
    },
    suspend: () => {
      harness.calls.push("suspend");
    },
    restore: () => {
      harness.calls.push("restore");
      return harness.options.restore;
    },
    emit: (state) => {
      harness.states.push({ ...state });
    },
  };
  harness.coordinator = new PlaybackRecoveryCoordinator(actions);
  return harness;
};

const flushRecovery = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const lastState = (h: Harness): RecoveryState => h.states[h.states.length - 1];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("target lifetime", () => {
  test("retuning retains picture history until the target changes", () => {
    const h = makeHarness();
    h.coordinator.select(session());
    h.coordinator.playing();
    h.coordinator.select(session());
    expect(lastState(h)).toMatchObject({ hasPlayed: true, statusVisible: true });
    h.coordinator.select(session("two"));
    expect(lastState(h)).toMatchObject({ hasPlayed: false, statusVisible: false });
    h.coordinator.dispose();
  });

  test("silent owner cleanup allows effect replay without publishing during teardown", () => {
    const h = makeHarness();
    h.coordinator.select(session());
    h.coordinator.playing();
    const beforeCleanup = h.states.length;
    h.coordinator.stop(false);
    expect(h.states).toHaveLength(beforeCleanup);
    h.coordinator.select(session());
    h.coordinator.playing();
    expect(lastState(h)).toMatchObject({ stage: "idle", hasPlayed: true });
    h.coordinator.dispose();
  });

  test("compact feedback remains visible when a scheduled retry opens the engine", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false }));
    h.coordinator.playing();
    h.coordinator.fault("socket dropped", null, "engine-network");
    await flushRecovery();
    expect(lastState(h)).toMatchObject({ stage: "waiting", statusVisible: true });
    vi.advanceTimersByTime(4000);
    expect(lastState(h)).toMatchObject({
      stage: "reopen",
      statusVisible: true,
      hasPlayed: true,
    });
    expect(h.calls.some((call) => call.startsWith("reopen:"))).toBe(true);
    h.coordinator.dispose();
  });
});

describe("recovery order", () => {
  test("an alternate upstream is tried once before diagnosis and remains the retry source", async () => {
    const alternate = openRequest("https://alternate.invalid/one.m3u8");
    const h = makeHarness({ streamFallbackResult: alternate });
    h.coordinator.select(session());
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(h.calls).toEqual([
      "warm",
      "stream-fallback",
      `reopen:${alternate.url}`,
    ]);

    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(h.upstreams).toEqual([alternate.url, alternate.url]);
    expect(h.calls.filter((call) => call === "stream-fallback")).toHaveLength(1);
    expect(lastState(h).stage).toBe("waiting");
    vi.advanceTimersByTime(4000);
    expect(h.calls[h.calls.length - 1]).toBe(`reopen:${alternate.url}`);

    h.coordinator.select(session("two"));
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(h.calls.filter((call) => call === "stream-fallback")).toHaveLength(2);
    h.coordinator.dispose();
  });

  test("an alternate upstream cannot bypass a terminal provider refusal", () => {
    const h = makeHarness({
      streamFallbackResult: openRequest("https://alternate.invalid/one.m3u8"),
    });
    h.coordinator.select(session());
    h.coordinator.fault("HTTP 403", "network", "engine-network");
    expect(lastState(h).stage).toBe("terminal");
    expect(h.calls).toEqual([]);
    h.coordinator.dispose();
  });

  test("recovery runs warm, compatibility, HTTP fallback, reopen, then application delay in order", async () => {
    const h = makeHarness({ fallbackResult: openRequest("http://fallback/one") });
    h.coordinator.select(session());
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(h.calls).toEqual([
      "warm",
      "compatibility",
      "http-fallback",
      "reopen:http://fallback/one",
    ]);
  });

  test("a repaired diagnosis is reopened instead of reaching the fallback", async () => {
    const repaired = openRequest("http://127.0.0.1:9/repaired.m3u8");
    const h = makeHarness({
      diagnoseResult: repaired,
      fallbackResult: openRequest("http://fb"),
    });
    h.coordinator.select(session());
    h.coordinator.fault("STALLED", null, "frozen-playhead");
    await flushRecovery();
    expect(h.calls).toEqual([
      "warm",
      "compatibility",
      "reopen:http://127.0.0.1:9/repaired.m3u8",
    ]);
  });

  test("compatibility and fallback run once per session key even after a rewrite", async () => {
    const h = makeHarness({ fallbackResult: openRequest("http://fallback/one") });
    h.coordinator.select(session());
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    // The fallback rewrite selects a new session carrying the same key, so neither
    // corrective step may run again for it.
    h.coordinator.select({ ...session(), request: openRequest("http://fallback/one") });
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    const second = h.calls.slice(4);
    expect(second).not.toContain("compatibility");
    expect(second).not.toContain("http-fallback");
    expect(lastState(h).stage).toBe("waiting");
    expect(lastState(h).retryIn).toBe(4);
  });

  test("changing target invalidates an older asynchronous diagnosis", async () => {
    const h = makeHarness({ holdDiagnose: true });
    h.coordinator.select(session("first"));
    h.coordinator.fault("STALLED", null, "frozen-playhead");
    h.coordinator.select(session("second"));
    h.diagnoseDeferred?.resolve(openRequest("http://127.0.0.1:9/repaired.m3u8"));
    await flushRecovery();
    expect(h.calls).not.toContain("reopen:http://127.0.0.1:9/repaired.m3u8");
  });

  test("a warm attempt that the engine accepts bounds itself and continues the chain", async () => {
    const h = makeHarness({ warm: true });
    h.coordinator.select(session());
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(h.calls).toEqual(["warm"]);
    expect(lastState(h).stage).toBe("warm");
    // Warm recovery gets the same twenty second bound as a reported refill.
    vi.advanceTimersByTime(20000);
    await flushRecovery();
    expect(h.calls.slice(1)).toEqual(["compatibility", "http-fallback"]);
    expect(lastState(h).stage).toBe("waiting");
  });
});

describe("timers", () => {
  test("a target that never produces a picture fails at the thirty second startup limit", () => {
    const h = makeHarness();
    h.coordinator.select(session());
    vi.advanceTimersByTime(29999);
    expect(h.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(lastState(h).cause).toBe("startup-timeout");
  });

  test("rebuffering shorter than 1.5 seconds stays invisible", () => {
    const h = makeHarness();
    h.coordinator.select(session());
    h.coordinator.playing();
    h.coordinator.bufferingStarted();
    vi.advanceTimersByTime(1499);
    expect(lastState(h).statusVisible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(lastState(h).statusVisible).toBe(true);
  });

  test("reported buffering gets the greater of twenty seconds or twice the segment duration, capped at forty five", async () => {
    const direct = makeHarness();
    direct.coordinator.select(session("one", { segmentSeconds: 3 }));
    direct.coordinator.playing();
    direct.coordinator.bufferingStarted();
    vi.advanceTimersByTime(20000);
    await flushRecovery();
    expect(direct.calls).toContain("warm");
    expect(lastState(direct).cause).toBe("reported-buffer");

    const segmented = makeHarness();
    segmented.coordinator.select(session("two", { segmentSeconds: 15 }));
    segmented.coordinator.playing();
    segmented.coordinator.bufferingStarted();
    vi.advanceTimersByTime(29999);
    expect(lastState(segmented).cause).not.toBe("reported-buffer");
    vi.advanceTimersByTime(1);
    await flushRecovery();
    expect(lastState(segmented).cause).toBe("reported-buffer");

    const capped = makeHarness();
    capped.coordinator.select(session("three", { segmentSeconds: 30 }));
    capped.coordinator.playing();
    capped.coordinator.bufferingStarted();
    vi.advanceTimersByTime(45000);
    await flushRecovery();
    expect(lastState(capped).cause).toBe("reported-buffer");
  });

  test("a frozen playhead enters recovery after twelve seconds of no movement", () => {
    let position = 10;
    const h = makeHarness();
    h.clockPosition = () => position;
    h.coordinator.select(session());
    h.coordinator.playing();
    vi.advanceTimersByTime(3000);
    position = 11;
    vi.advanceTimersByTime(3000);
    expect(h.calls).toEqual([]);
    vi.advanceTimersByTime(12000);
    expect(lastState(h).cause).toBe("frozen-playhead");
  });

  test("deliberate pause and pending seek suppress frozen detection", () => {
    const h = makeHarness();
    h.clockPosition = () => 42;
    h.coordinator.select(session());
    h.coordinator.playing();
    h.coordinator.paused(true);
    vi.advanceTimersByTime(30000);
    expect(lastState(h).cause).not.toBe("frozen-playhead");
    h.coordinator.paused(false);
    h.coordinator.seeking(true);
    vi.advanceTimersByTime(30000);
    expect(lastState(h).cause).not.toBe("frozen-playhead");
  });

  test("reported buffering suppresses frozen detection while it is allowed to refill", () => {
    const h = makeHarness();
    h.clockPosition = () => 42;
    h.coordinator.select(session());
    h.coordinator.playing();
    h.coordinator.bufferingStarted();
    vi.advanceTimersByTime(15000);
    expect(lastState(h).cause).not.toBe("frozen-playhead");
  });

  test("thirty uninterrupted seconds of playing resets the attempt count", async () => {
    const h = makeHarness();
    h.coordinator.select(session());
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    vi.advanceTimersByTime(4000);
    await flushRecovery();
    expect(h.calls).toContain("reopen:https://stream.invalid/one");
    h.coordinator.playing();
    vi.advanceTimersByTime(30000);
    expect(lastState(h).attempt).toBe(0);
  });
});

describe("retry policy", () => {
  test("default retries wait four, eight and fifteen seconds then stop", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false }));
    for (const delay of [4000, 8000, 15000]) {
      h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
      await flushRecovery();
      expect(lastState(h).stage).toBe("waiting");
      expect(lastState(h).retryIn).toBe(delay / 1000);
      vi.advanceTimersByTime(delay);
      await flushRecovery();
    }
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(lastState(h).stage).toBe("terminal");
  });

  test("continuous reconnect waits thirty, forty five, then sixty seconds repeatedly", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false, continuousReconnect: true }));
    const delays = [30000, 45000, 60000, 60000];
    for (const delay of delays) {
      h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
      await flushRecovery();
      expect(lastState(h).stage).toBe("waiting");
      expect(lastState(h).retryIn).toBe(delay / 1000);
      vi.advanceTimersByTime(delay);
      await flushRecovery();
      h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
      await flushRecovery();
      if (delay === delays[delays.length - 1]) break;
    }
    expect(lastState(h).stage).not.toBe("terminal");
  });

  test("continuous reconnect never applies to a finite target", async () => {
    const h = makeHarness();
    const finiteSession = session("movie", {
      compatibility: false,
      continuousReconnect: true,
    });
    finiteSession.request = { ...finiteSession.request, mode: "finite" };
    finiteSession.target = { ...finiteSession.target, mode: "finite", kind: "movie" };
    h.coordinator.select(finiteSession);
    for (const delay of [4000, 8000, 15000]) {
      h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
      await flushRecovery();
      expect(lastState(h).retryIn).toBe(delay / 1000);
      vi.advanceTimersByTime(delay);
      await flushRecovery();
    }
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(lastState(h).stage).toBe("terminal");
  });
});

describe("terminal faults", () => {
  for (const code of [
    "PLAYER_ERROR_CONNECTION_FAILED (http 401)",
    "PLAYER_ERROR_CONNECTION_FAILED (http 403)",
    "PLAYER_ERROR_CONNECTION_FAILED (http 451)",
    "PLAYER_ERROR_CONNECTION_FAILED (http 404)",
    "PLAYER_ERROR_INVALID_URI",
    "PLAYER_ERROR_NOT_SUPPORTED_FILE",
    "manifestParsingError",
    "FINITE_FORMAT_UNSUPPORTED",
  ]) {
    test(`${code} stays terminal and is never retried`, async () => {
      const h = makeHarness();
      h.coordinator.select(session());
      h.coordinator.fault(code, "network", "engine-network");
      await flushRecovery();
      expect(lastState(h).stage).toBe("terminal");
      expect(lastState(h).fault).toBe(code);
      expect(h.calls).toEqual([]);
    });
  }

  test("network, timeout, server failure, stream end and frozen playhead are recovery eligible", async () => {
    for (const code of [
      "PLAYER_ERROR_CONNECTION_FAILED",
      "TIMEOUT",
      "PLAYER_ERROR_CONNECTION_FAILED (http 502)",
      "STREAM_ENDED",
      "STALLED",
    ]) {
      const h = makeHarness();
      h.coordinator.select(session("one", { compatibility: false }));
      h.coordinator.fault(code, null, "engine-network");
      await flushRecovery();
      expect(lastState(h).stage).not.toBe("terminal");
    }
  });
});

describe("hiding and restoring", () => {
  test("hiding while waiting keeps the attempt count and opens no connection", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false }));
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    expect(lastState(h).stage).toBe("waiting");
    h.coordinator.hidden();
    const callsBefore = h.calls.length;
    vi.advanceTimersByTime(60000);
    await flushRecovery();
    expect(h.calls.length).toBe(callsBefore);
    expect(h.calls).toContain("suspend");
  });

  test("a healthy engine restores once with no recovery work", () => {
    const h = makeHarness({ restore: true });
    h.coordinator.select(session());
    h.coordinator.playing();
    h.coordinator.hidden();
    h.coordinator.visible();
    expect(h.calls.filter((c) => c === "restore")).toHaveLength(1);
    expect(lastState(h).stage).toBe("idle");
  });

  test("an engine that cannot restore begins one coordinated recovery with the retained attempt", async () => {
    const h = makeHarness({ restore: false });
    h.coordinator.select(session("one", { compatibility: false }));
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    vi.advanceTimersByTime(4000);
    await flushRecovery();
    expect(lastState(h).attempt).toBe(1);
    h.coordinator.hidden();
    h.coordinator.visible();
    await flushRecovery();
    expect(lastState(h).cause).toBe("visibility-restore");
    expect(lastState(h).attempt).toBe(1);
  });

  test("fault work cannot open a connection while hidden", async () => {
    const h = makeHarness({ holdDiagnose: true });
    h.coordinator.select(session());
    h.coordinator.fault("STALLED", null, "frozen-playhead");
    h.coordinator.hidden();
    h.diagnoseDeferred?.resolve(openRequest("http://127.0.0.1:9/repaired.m3u8"));
    await flushRecovery();
    expect(h.calls).not.toContain("reopen:http://127.0.0.1:9/repaired.m3u8");
  });
});

describe("cancellation", () => {
  test("stop clears every timer and returns to idle", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false }));
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    h.coordinator.stop();
    const callsBefore = h.calls.length;
    vi.advanceTimersByTime(120000);
    await flushRecovery();
    expect(h.calls.length).toBe(callsBefore);
    expect(lastState(h).stage).toBe("idle");
  });

  test("dispose emits nothing more and leaves no live timer", async () => {
    const h = makeHarness();
    h.coordinator.select(session("one", { compatibility: false }));
    h.coordinator.fault("NETWORK_ERROR", "network", "engine-network");
    await flushRecovery();
    h.coordinator.dispose();
    const statesBefore = h.states.length;
    vi.advanceTimersByTime(120000);
    await flushRecovery();
    expect(h.states.length).toBe(statesBefore);
  });
});
