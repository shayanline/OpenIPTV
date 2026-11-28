import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import {
  Player,
  onTizen,
  type PlayerEvent,
  type PlayerOpenRequest,
} from "../src/services/player";

interface FakeHlsInstance {
  source: string;
  startPositions: number[];
  mediaRecoveries: number;
  audioTrack: number;
  audioTracks: Array<{ name: string; lang: string; default: boolean }>;
  subtitleTrack: number;
  currentLevel: number;
  levels: Array<{
    videoRange?: string;
    attrs?: Record<string, string>;
  }>;
  emit(event: string, data: unknown): void;
}

type HlsHandler = (event: string, data: unknown) => void;

const hlsMock = vi.hoisted(() => ({
  supported: false,
  instance: null as FakeHlsInstance | null,
}));

vi.mock("hls.js", () => {
  class FakeHls {
    static isSupported = () => hlsMock.supported;
    static Events = {
      ERROR: "error",
      LEVEL_SWITCHED: "levelSwitch",
      MANIFEST_PARSED: "manifestParsed",
      LEVEL_LOADED: "levelLoaded",
      AUDIO_TRACKS_UPDATED: "audioTracksUpdated",
      SUBTITLE_TRACKS_UPDATED: "subtitleTracksUpdated",
    };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    currentLevel = 2;
    bandwidthEstimate = 6_200_000;
    audioTrack = 0;
    subtitleTrack = -1;
    audioTracks = [{ name: "English", lang: "en", default: true }];
    subtitleTracks = [{ name: "English SDH", lang: "en", default: false }];
    levels = [
      { width: 640, height: 360, bitrate: 800_000 },
      { width: 1280, height: 720, bitrate: 2_500_000 },
      {
        width: 1920,
        height: 1080,
        bitrate: 4_500_000,
        frameRate: 50,
        videoRange: "PQ",
        videoCodec: "hvc1.2.4.L150.B0",
        audioCodec: "mp4a.40.2",
        attrs: {
          CODECS: "hvc1.2.4.L150.B0,mp4a.40.2",
          "SUPPLEMENTAL-CODECS": "hvc1.2.4.L150.B0/cdm4",
        },
      },
    ];
    handlers = new Map<string, HlsHandler>();
    source = "";
    startPositions: number[] = [];
    mediaRecoveries = 0;
    constructor() {
      hlsMock.instance = this;
    }
    on(event: string, handler: HlsHandler) {
      this.handlers.set(event, handler);
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(event, data);
    }
    loadSource(url: string) {
      this.source = url;
    }
    attachMedia() {}
    startLoad(position: number) {
      this.startPositions.push(position);
    }
    recoverMediaError() {
      this.mediaRecoveries += 1;
    }
    destroy() {}
  }
  return { default: FakeHls };
});

/**
 * The player, which is the riskiest thing in the application and had no tests at all.
 *
 * It drives two engines that agree about nothing, and almost all of its interesting
 * behaviour is about call ordering and engine state: which AVPlay calls are legal in which
 * state, which failures are worth reporting, and which ones the app caused itself. How long
 * a channel may take to start and how long a still picture is allowed are the recovery
 * coordinator's questions, covered in playbackRecovery.test.ts.
 *
 * The AVPlay path is the one covered here, because it is the one that runs on a television
 * and the one whose call ordering is load bearing: several of its calls are legal in only
 * one state, so getting the sequence wrong means the channel silently never starts.
 */

/** A stand in for webapis.avplay that records what it was asked to do, and in what order. */
function fakeAVPlay() {
  const calls: string[] = [];
  const streamingReads: string[] = [];
  let state = "NONE";
  let currentTime = 0;
  let duration = 120_000;
  const av = {
    listener: null as null | Record<string, (...args: unknown[]) => void>,
    prepared: null as null | { ok: () => void; fail: (e: unknown) => void },
    calls,
    streamingReads,
    open: (url: string) => {
      calls.push(`open:${url}`);
      state = "IDLE";
    },
    close: () => {
      calls.push("close");
      state = "NONE";
    },
    stop: () => {
      calls.push("stop");
      state = "IDLE";
    },
    play: () => {
      calls.push("play");
      state = "PLAYING";
    },
    pause: () => {
      calls.push("pause");
      state = "PAUSED";
    },
    getState: () => state,
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    seekTo: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`seekTo:${ms}`);
      currentTime = ms;
      ok();
    },
    jumpForward: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`jumpForward:${ms}`);
      currentTime = Math.min(duration, currentTime + ms);
      ok();
    },
    jumpBackward: (ms: number, ok: () => void, _fail: (e: unknown) => void) => {
      calls.push(`jumpBackward:${ms}`);
      currentTime = Math.max(0, currentTime - ms);
      ok();
    },
    getCurrentStreamInfo: () => [
      {
        index: 0,
        type: "VIDEO",
        extra_info: JSON.stringify({
          Width: 1920,
          Height: 1080,
          FourCC: "H264",
          Bit_rate: 4_500_000,
          Frame_rate: 50,
          Transfer_characteristics: 16,
        }),
      },
      {
        index: 1,
        type: "AUDIO",
        extra_info: JSON.stringify({ FourCC: "AAC", Bit_rate: 192_000 }),
      },
    ],
    getTotalTrackInfo: () => [
      {
        index: 1,
        type: "AUDIO" as const,
        extra_info: JSON.stringify({ language: "en", label: "English", selected: true }),
      },
      {
        index: 3,
        type: "TEXT" as const,
        extra_info: JSON.stringify({ language: "en", label: "English SDH" }),
      },
    ],
    setSelectTrack: (type: string, index: number) =>
      calls.push(`setSelectTrack:${type}:${index}`),
    setSilentSubtitle: (silent: boolean) => calls.push(`setSilentSubtitle:${silent}`),
    getStreamingProperty: (key: string) => {
      streamingReads.push(key);
      return (
        (
          {
            GET_LIVE_DURATION: "10000|70000",
            CURRENT_BANDWIDTH: "6200000",
            AVAILABLE_BITRATE: "1500000|3000000|4500000",
            CURRENT_LEVEL: "3",
            BUFFER_AHEAD: "5.5",
            FRAME_RATE: "49.9",
            TOTAL_FRAMES: "100",
            DROPPED_FRAMES: "2",
          } as Record<string, string>
        )[key] ?? ""
      );
    },
    getVideoSeamlessInfo: () => ({ scan_type: 1, rotation_degree: 0 }),
    setDisplayRect: () => calls.push("setDisplayRect"),
    setDisplayMethod: (m: string) => calls.push(`setDisplayMethod:${m}`),
    // The value as well as the key, since what is asked for matters as much as when.
    setStreamingProperty: (k: string, v: string) =>
      calls.push(`setStreamingProperty:${k}=${v}`),
    setTimeoutForBuffering: (s: number) => calls.push(`setTimeoutForBuffering:${s}`),
    setBufferingParam: (option: string, unit: string, amount: number) =>
      calls.push(`setBufferingParam:${option},${unit},${amount}`),
    suspend: () => calls.push("suspend"),
    restore: () => calls.push("restore"),
    setListener: (l: Record<string, (...args: unknown[]) => void>) => {
      av.listener = l;
    },
    prepareAsync: (ok: () => void, fail: (e: unknown) => void) => {
      calls.push("prepareAsync");
      av.prepared = {
        ok: () => {
          state = "READY";
          ok();
        },
        fail,
      };
    },
    advance: (by: number) => {
      currentTime += by;
    },
    setTime: (t: number) => {
      currentTime = t;
    },
    setDuration: (ms: number) => {
      duration = ms;
    },
    setState: (next: string) => {
      state = next;
    },
  };
  return av;
}

let av: ReturnType<typeof fakeAVPlay>;
let events: PlayerEvent[];
let player: Player;
let tvMuted = false;

const codes = () => events.filter((e) => e.type === "error").map((e) => e.code);
const videoTrack = (info: Record<string, unknown>, index = 0) => ({
  index,
  type: "VIDEO" as const,
  extra_info: JSON.stringify(info),
});
const liveRequest = (
  url = "http://example.invalid/a.m3u8",
  overrides: Partial<PlayerOpenRequest> = {},
): PlayerOpenRequest => ({
  url,
  browserRepair: false,
  bufferSeconds: 6,
  segmentSeconds: 3,
  mode: "live",
  startSeconds: 0,
  ...overrides,
});
const finiteRequest = (
  url = "http://example.invalid/movie/1.mp4",
  overrides: Partial<PlayerOpenRequest> = {},
): PlayerOpenRequest => ({ ...liveRequest(url), mode: "finite", ...overrides });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
  hlsMock.supported = false;
  hlsMock.instance = null;
  av = fakeAVPlay();
  (window as unknown as { webapis: unknown }).webapis = { avplay: av };
  tvMuted = false;
  (window as unknown as { tizen: unknown }).tizen = {
    tvaudiocontrol: {
      isMute: () => tvMuted,
      setMute: (mute: boolean) => {
        tvMuted = mute;
      },
    },
  };
  events = [];
  player = new Player((e) => events.push(e));
});

afterEach(() => {
  player.stop();
  vi.useRealTimers();
  delete (window as unknown as { webapis?: unknown }).webapis;
  delete (window as unknown as { tizen?: unknown }).tizen;
  vi.unstubAllGlobals();
  document.getElementById("avplay-surface")?.remove();
});

test("the TV path is taken when AVPlay is present", () => {
  assert.equal(onTizen(), true);
});

test("starting a channel calls AVPlay in the order its states require", () => {
  player.play(liveRequest());

  // setStreamingProperty is legal in IDLE only, which is after open and before prepare.
  // Called any later it throws and the channel never starts, so the order is the behaviour.
  const order = av.calls;
  const at = (needle: string) => order.findIndex((c) => c.startsWith(needle));
  assert.ok(at("open:") >= 0, "never opened");
  assert.ok(at("setStreamingProperty") > at("open:"), "configured before open");
  assert.ok(at("prepareAsync") > at("setStreamingProperty"), "configured after prepare");
  assert.equal(order.filter((c) => c === "play").length, 0, "played before it was ready");
});

test("the status the server sent reaches the explanation, not just the engine's own name", () => {
  player.play(liveRequest());
  // Two facts, in the order the TV sends them: the status through onevent, the failure through
  // onerror. Joined, because CONNECTION_FAILED alone cannot tell a refusal from a dead host.
  av.listener?.onevent?.("PLAYER_MSG_HTTP_ERROR_CODE", "403");
  av.listener?.onerror?.("PLAYER_ERROR_CONNECTION_FAILED");

  const fault = events.find((e) => e.type === "error");
  assert.equal(fault?.type, "error");
  assert.match(fault.code, /PLAYER_ERROR_CONNECTION_FAILED/, "the engine's name is kept");
  assert.match(fault.code, /http 403/, "and the status is carried with it");
});

test("a failure with a message keeps both, and only reports once", () => {
  player.play(liveRequest());
  av.listener?.onerrormsg?.("PLAYER_ERROR_NOT_SUPPORTED_FILE", "codec not supported");
  // The same failure arriving twice is one failure: onerror and onerrormsg describe one event,
  // and the first explanation is the one that survives.
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  const faults = events.filter((e) => e.type === "error");
  assert.equal(faults.length, 1, "reported twice");
  assert.match(faults[0].code, /codec not supported/);
});

test("buffering progress is passed on without inventing progress for a start", () => {
  player.play(liveRequest());
  av.listener?.onbufferingstart?.();
  av.listener?.onbufferingprogress?.(42);

  expect(events).toContainEqual({ type: "buffering-progress", percent: 42 });
  expect(events.filter((event) => event.type === "buffering-start")).not.toHaveLength(0);
});

test("AVPlay statistics normalize current engine values without using playlist labels", () => {
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
    dynamicRange: "PQ",
    dynamicRangeSource: "engine",
    scan: "progressive",
    videoCodec: "H264",
    audioCodec: "AAC",
    bitrate: 4_500_000,
    bandwidth: 6_200_000,
    bufferSeconds: 5.5,
    frameRate: 49.9,
    droppedFrames: 2,
    totalFrames: 100,
    level: 3,
    levels: 3,
    switches: 0,
  });
});

test("AVPlay statistics stay available when newer optional firmware APIs are absent", () => {
  delete (av as Partial<typeof av>).getVideoSeamlessInfo;
  delete (av as Partial<typeof av>).getStreamingProperty;
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
    dynamicRange: "PQ",
    dynamicRangeSource: "engine",
    videoCodec: "H264",
    audioCodec: "AAC",
    bitrate: 4_500_000,
    frameRate: 50,
    switches: 0,
  });
});

test("AVPlay preserves an explicit HDR format reported by the firmware", () => {
  av.getCurrentStreamInfo = () => [
    {
      index: 0,
      type: "VIDEO",
      extra_info: JSON.stringify({ Hdr_type: "HDR10+" }),
    },
  ];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("HDR10+");
});

test("AVPlay uses richer total track HDR metadata when current info omits it", () => {
  av.getCurrentStreamInfo = () => [
    {
      index: 0,
      type: "VIDEO",
      extra_info: JSON.stringify({ Width: 1920, Height: 1080 }),
    },
  ];
  av.getTotalTrackInfo = () => [
    {
      index: 0,
      type: "VIDEO" as const,
      extra_info: JSON.stringify({ Hdr_type: "Dolby Vision" }),
    },
  ];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("Dolby Vision");
  expect(player.getStats().dynamicRange).toBe("Dolby Vision");
});

test("AVPlay does not treat undocumented streaming properties as HDR evidence", () => {
  av.getCurrentStreamInfo = () => [];
  av.getTotalTrackInfo = () => [];
  av.getStreamingProperty = (key: string) => {
    av.streamingReads.push(key);
    return key === "GET_STREAM_INFO" ? JSON.stringify({ hdrType: "HLG" }) : "";
  };
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBeUndefined();
  expect(av.streamingReads).not.toContain("GET_STREAM_INFO");
  expect(av.streamingReads).not.toContain("PROPERTY_STREAMING_STATUS");
  expect(av.streamingReads).not.toContain("PROPERTY_STREAMING_TYPE");
  expect(av.streamingReads).not.toContain("PROPERTY_VR360_INFO");
});

test("AVPlay uses an unambiguous PQ rendition declaration without claiming engine support", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR,CODECS="hvc1.2.4.L120.B0,mp4a.40.2"
sdr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4700000,AVERAGE-BANDWIDTH=4400000,RESOLUTION=1920x1080,VIDEO-RANGE=PQ,CODECS="hvc1.2.4.L150.B0,mp4a.40.2",SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"
hdr.m3u8`),
  );
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("PQ");
  await vi.advanceTimersByTimeAsync(0);
  expect(player.getStats().dynamicRange).toBe("HDR10+");
  expect(player.getStats().dynamicRangeSource).toBe("manifest");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  [{ Hdr_type: "HDR10" }, "HDR10"],
  [{ Hdr_format: "HDR10+" }, "HDR10+"],
  [{ Dynamic_range: "Dolby Vision" }, "Dolby Vision"],
  [{ Transfer_characteristics: "16" }, "PQ"],
  [{ Transfer_characteristics: 18 }, "HLG"],
  [{ Transfer_function: "smpte2084" }, "PQ"],
  [{ Color_transfer: "arib-std-b67" }, "HLG"],
  [{ Transfer_characteristics: 1 }, "SDR"],
  [{ Colour_primaries: "bt2020", FourCC: "HEVC" }, undefined],
  [{ Hdr_type: 16 }, undefined],
  [{ Hdr_type: "not HDR10" }, undefined],
  [{ Hdr_type: { hdrFormat: "HDR10+" } }, undefined],
] as const)(
  "AVPlay interprets only explicit format and transfer metadata: %j",
  (info, expected) => {
    av.getCurrentStreamInfo = () => [videoTrack(info)];
    player.play(liveRequest());
    av.prepared?.ok();

    expect(player.getStats().dynamicRange).toBe(expected);
  },
);

test("AVPlay matches total video information to the active index rather than the first track", () => {
  av.getCurrentStreamInfo = () => [videoTrack({ Width: 1920, Height: 1080 }, 2)];
  av.getTotalTrackInfo = () => [
    videoTrack({ Hdr_type: "HDR10+" }, 0),
    videoTrack({ Hdr_type: "HLG" }, 2),
  ];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("HLG");
});

test("AVPlay rejects total video metadata that contradicts the current dimensions", () => {
  av.getCurrentStreamInfo = () => [videoTrack({ Width: 1280, Height: 720 })];
  av.getTotalTrackInfo = () => [videoTrack({ Width: 1920, Height: 1080, Hdr_type: "HDR10+" })];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBeUndefined();
});

test("AVPlay rejects an enhancement whose total track transfer function contradicts PQ", () => {
  av.getTotalTrackInfo = () => [
    videoTrack({ Hdr_type: "HDR10+", Transfer_characteristics: 18 }),
  ];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("PQ");
});

test("AVPlay does not retain a previous range when active metadata changes or disappears", () => {
  let info: Record<string, unknown> = { Hdr_type: "HDR10+" };
  av.getCurrentStreamInfo = () => [videoTrack(info)];
  player.play(liveRequest());
  av.prepared?.ok();

  expect(player.getStats().dynamicRange).toBe("HDR10+");
  info = { Transfer_characteristics: 16 };
  expect(player.getStats().dynamicRange).toBe("PQ");
  info = { Transfer_characteristics: 1 };
  expect(player.getStats().dynamicRange).toBe("SDR");
  info = {};
  expect(player.getStats().dynamicRange).toBeUndefined();
});

test.each([
  ["HLG", 'CODECS="hvc1.2.4.L150.B0",VIDEO-RANGE=HLG', "HLG"],
  ["PQ", 'CODECS="hvc1.2.4.L150.B0",VIDEO-RANGE=PQ', "PQ"],
  ["SDR", 'CODECS="hvc1.2.4.L150.B0",VIDEO-RANGE=SDR', "SDR"],
  ["Main 10 alone", 'CODECS="hvc1.2.20000000.H150.B0"', undefined],
  ["an invalid video range", "VIDEO-RANGE=HDR10", undefined],
  ["unsupported CODECS brand", 'CODECS="av01.0.05M.10.0.112/cdm4"', undefined],
  ["HDR10+", 'VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="av01.0.05M.10.0.112/cdm4/other"', "HDR10+"],
  ["Dolby Vision", 'VIDEO-RANGE=PQ,CODECS="dvh1.05.06,ec-3"', "Dolby Vision"],
  ["Dolby Vision AV1", 'VIDEO-RANGE=PQ,CODECS="dva1.10.09"', "Dolby Vision"],
  [
    "Dolby Vision with an HDR10+ compatible layer",
    'VIDEO-RANGE=PQ,CODECS="dvh1.08.06",SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"',
    "Dolby Vision",
  ],
  [
    "Dolby Vision HLG compatibility",
    'VIDEO-RANGE=HLG,CODECS="hvc1.2.4.L153.B0",SUPPLEMENTAL-CODECS="dvh1.08.07/db4h"',
    "Dolby Vision",
  ],
] as const)(
  "AVPlay can show a manifest declaration for %s without firmware HDR metadata",
  async (_name, attributes, expected) => {
    av.getCurrentStreamInfo = () => [videoTrack({ Width: 1920, Height: 1080 })];
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,${attributes}\nvideo.m3u8`,
      ),
    );
    player.play(liveRequest());
    av.prepared?.ok();

    expect(player.getStats().dynamicRange).toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getStats().dynamicRange).toBe(expected);
    expect(player.getStats().dynamicRangeSource).toBe(expected ? "manifest" : undefined);
  },
);

test.each([
  ["a different PQ enhancement", "1920x1080", "VIDEO-RANGE=PQ", "PQ"],
  ["a missing declaration", "1920x1080", 'CODECS="hvc1.2.4.L150.B0"', "PQ"],
  ["a missing resolution", "", "VIDEO-RANGE=PQ", "PQ"],
  ["no matching resolution", "3840x2160", "VIDEO-RANGE=PQ", "PQ"],
] as const)(
  "AVPlay leaves ambiguous manifest information unknown with %s",
  async (_name, resolution, attributes, expected) => {
    const size = resolution ? `RESOLUTION=${resolution},` : "";
    const firstSize = resolution === "3840x2160" ? resolution : "1920x1080";
    vi.mocked(fetch).mockResolvedValue(
      new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=${firstSize},VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"
plus.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,${size}${attributes}
other.m3u8`),
    );
    player.play(liveRequest());
    av.prepared?.ok();

    player.getStats();
    await vi.advanceTimersByTimeAsync(0);
    expect(player.getStats().dynamicRange).toBe(expected);
    expect(player.getStats().dynamicRangeSource).toBe("engine");
  },
);

test("AVPlay reevaluates retained manifest declarations after a rendition change", async () => {
  let width = 1920;
  av.getCurrentStreamInfo = () => [
    videoTrack({ Width: width, Height: width === 1920 ? 1080 : 2160 }),
  ];
  vi.mocked(fetch).mockResolvedValue(
    new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR
sdr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2160,VIDEO-RANGE=HLG
hlg.m3u8`),
  );
  player.play(liveRequest());
  av.prepared?.ok();

  player.getStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(player.getStats().dynamicRange).toBe("SDR");
  width = 3840;
  expect(player.getStats().dynamicRange).toBe("HLG");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("AVPlay cannot select an advertised HDR alternative when firmware gives no range", async () => {
  av.getCurrentStreamInfo = () => [videoTrack({ Width: 1920, Height: 1080 })];
  vi.mocked(fetch).mockResolvedValue(
    new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,VIDEO-RANGE=SDR
sdr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=1920x1080,VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"
plus.m3u8`),
  );
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  await vi.advanceTimersByTimeAsync(0);

  expect(player.getStats().dynamicRange).toBeUndefined();
  expect(player.getStats().dynamicRangeSource).toBeUndefined();
});

test.each([
  ["an invalid header", "not an HLS manifest"],
  ["a media playlist", "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nsegment.ts"],
  ["a missing variant URI", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=4500000,VIDEO-RANGE=HLG"],
  ["an oversized body", `#EXTM3U\n${"x".repeat(512 * 1024)}`],
])("manifest metadata with %s cannot replace the engine report", async (_name, text) => {
  vi.mocked(fetch).mockResolvedValue(new Response(text));
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  await vi.advanceTimersByTimeAsync(0);

  expect(player.getStats().dynamicRange).toBe("PQ");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a failed HDR manifest request leaves playback and the engine report intact", async () => {
  vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  await vi.advanceTimersByTimeAsync(0);

  expect(player.getStats().dynamicRange).toBe("PQ");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(codes()).toEqual([]);
});

test("AVPlay prioritises explicit firmware metadata over the manifest", async () => {
  vi.mocked(fetch).mockResolvedValue(
    new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4500000,VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"
plus.m3u8`),
  );
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  await vi.advanceTimersByTimeAsync(0);
  expect(player.getStats().dynamicRange).toBe("HDR10+");

  av.getCurrentStreamInfo = () => [videoTrack({ Hdr_type: "SDR" })];
  expect(player.getStats()).toMatchObject({
    dynamicRange: "SDR",
    dynamicRangeSource: "engine",
  });
});

test("HDR manifest inspection waits for diagnostics and does not run while AVPlay is idle", () => {
  player.play(liveRequest());
  expect(fetch).not.toHaveBeenCalled();
  expect(player.getStats().dynamicRange).toBeUndefined();
  expect(fetch).not.toHaveBeenCalled();

  av.prepared?.ok();
  expect(fetch).not.toHaveBeenCalled();
  player.getStats();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("HDR manifest inspection stops on timeout without retrying every sample", async () => {
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  const options = vi.mocked(fetch).mock.calls[0][1];
  expect(options?.signal?.aborted).toBe(false);

  await vi.advanceTimersByTimeAsync(5000);
  expect(options?.signal?.aborted).toBe(true);
  expect(player.getStats().dynamicRange).toBe("PQ");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("HDR manifest results cannot cross playback ownership after a stop", async () => {
  let finish: ((response: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  player.play(liveRequest());
  av.prepared?.ok();
  player.getStats();
  const options = vi.mocked(fetch).mock.calls[0][1];
  player.stop();
  expect(options?.signal?.aborted).toBe(true);
  player.play(liveRequest("http://example.invalid/b.m3u8"));
  av.prepared?.ok();
  finish?.(
    new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4500000,VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="hvc1.2.4.L150.B0/cdm4"
old.m3u8`),
  );
  await vi.advanceTimersByTimeAsync(0);

  expect(player.getStats().dynamicRange).toBe("PQ");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("AVPlay counts actual adaptive bitrate changes rather than the initial selection", () => {
  player.play(liveRequest());
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "1500000");
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "1500000");
  av.listener?.onevent?.("PLAYER_MSG_BITRATE_CHANGE", "4500000");

  assert.equal(player.getStats().switches, 1);
});

test("browser statistics use the media element and tolerate older frame counters", () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  let total = 0;
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: 1280 },
    videoHeight: { configurable: true, value: 720 },
    currentTime: { configurable: true, value: 10 },
    buffered: {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 15.5 },
    },
    getVideoPlaybackQuality: {
      configurable: true,
      value: () => ({ totalVideoFrames: total, droppedVideoFrames: 0 }),
    },
  });
  browser.attach(video);

  expect(browser.getStats()).toMatchObject({
    engine: "Native HLS",
    width: 1280,
    height: 720,
    bufferSeconds: 5.5,
    droppedFrames: 0,
    totalFrames: 0,
  });

  vi.advanceTimersByTime(1000);
  total = 50;
  assert.equal(browser.getStats().frameRate, 50);
  browser.stop();
});

test("hls.js statistics report the rendition in use and count level changes", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  browser.attach(video);
  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);

  const hls = hlsMock.instance;
  assert.ok(hls, "hls.js was not created");
  hls.emit("manifestParsed", {});
  expect(browser.getTracks().map((track) => track.kind)).toEqual(["audio", "subtitle"]);
  expect(browser.selectTrack("subtitle", 0)).toBe(true);
  expect(hls.subtitleTrack).toBe(0);
  hls.emit("levelSwitch", { level: 0 });
  hls.emit("levelSwitch", { level: 2 });

  expect(browser.getStats()).toMatchObject({
    engine: "hls.js",
    width: 1920,
    height: 1080,
    dynamicRange: "HDR10+",
    dynamicRangeSource: "manifest",
    videoCodec: "hvc1.2.4.L150.B0",
    audioCodec: "mp4a.40.2",
    bitrate: 4_500_000,
    bandwidth: 6_200_000,
    frameRate: 50,
    level: 3,
    levels: 3,
    switches: 1,
  });
  browser.stop();
});

test.each([
  ["PQ", { CODECS: "hvc1.2.20000000.H150.B0" }, "PQ"],
  ["HLG", { CODECS: "hvc1.2.4.L150.B0" }, "HLG"],
  ["SDR", { CODECS: "hvc1.2.4.L150.B0" }, "SDR"],
  ["PQ", { CODECS: "dvh1.05.06" }, "Dolby Vision"],
  ["PQ", { CODECS: "dva1.10.09" }, "Dolby Vision"],
] as const)(
  "hls.js exposes the selected level declaration for %s",
  async (range, attrs, expected) => {
    delete (window as unknown as { webapis?: unknown }).webapis;
    hlsMock.supported = true;
    const browser = new Player(() => {});
    browser.attach(document.createElement("video"));
    browser.play(liveRequest());
    await vi.advanceTimersByTimeAsync(0);
    const hls = hlsMock.instance;
    assert.ok(hls);
    hls.levels[2].videoRange = range;
    hls.levels[2].attrs = attrs;

    expect(browser.getStats()).toMatchObject({
      dynamicRange: expected,
      dynamicRangeSource: "manifest",
    });
    hls.currentLevel = 0;
    expect(browser.getStats().dynamicRange).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    browser.stop();
  },
);

test("the adaptive request starts low and asks the set to skip nothing", () => {
  player.play(liveRequest());
  const asked = av.calls.find((c) => c.startsWith("setStreamingProperty:ADAPTIVE_INFO"));

  // Starting on the lowest rendition is what makes zapping feel immediate, and the adaptive
  // logic climbs from there.
  assert.ok(asked?.includes("STARTBITRATE=LOWEST"), `asked for ${asked}`);
  /*
   * SKIPBITRATE is not to come back. Samsung documents it as both "the bit rate to ignore
   * during streaming" and "the bandwidth to use after a skip operation", and under the first
   * reading `SKIPBITRATE=LOWEST` forbids the very rendition STARTBITRATE has just asked for.
   * Nothing in this app skips anywhere, so there is no reading of it that we want.
   */
  assert.ok(!asked?.includes("SKIPBITRATE"), `asked for ${asked}`);
});

test("the picture is only reported once the engine says it is ready", () => {
  player.play(liveRequest());
  expect(events.map((e) => e.type)).toContain("buffering-start");

  av.prepared?.ok();
  expect(events.map((e) => e.type)).toContain("playing");
  assert.ok(av.calls.includes("play"));
});

test("the hardware surface is created once and never replaced", () => {
  player.play(liveRequest());
  player.play(liveRequest("http://example.invalid/b.m3u8"));
  // webapis.avplay is a singleton with nothing tying it to an element, so a second object
  // element would send the video to the wrong one.
  assert.equal(document.querySelectorAll("#avplay-surface").length, 1);
});

test("only the first explanation of a failure is kept", () => {
  player.play(liveRequest());
  av.prepared?.fail({ name: "PLAYER_ERROR_CONNECTION_FAILED" });
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  // One broken stream produces several errors and the later ones are consequences. The
  // cause is worth more to the viewer than the symptom.
  assert.deepEqual(codes(), ["PLAYER_ERROR_CONNECTION_FAILED"]);
});

test("stopping clears the timers, so nothing is reported afterwards", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  player.stop();
  vi.advanceTimersByTime(120_000);
  assert.deepEqual(codes(), []);
});

test("changing channel goes through stop rather than close", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  av.calls.length = 0;

  player.play(liveRequest("http://example.invalid/b.m3u8"));
  // close destroys the instance and the whole pipeline has to be rebuilt, which is the
  // wrong thing to do to a television while somebody is holding the channel key down.
  assert.ok(av.calls.includes("stop"));
  assert.ok(!av.calls.includes("close"));
});

test("the aspect setting reaches the engine and survives a channel change", () => {
  player.setFit("fill");
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));

  av.calls.length = 0;
  player.play(liveRequest());
  // A fresh AVPlay instance starts on its own default, so the choice has to be reapplied.
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));
});

test("muting audio leaves AVPlay running and restores the prior TV mute state", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  av.calls.length = 0;

  player.setMuted(true);
  assert.equal(tvMuted, true);
  assert.equal(av.getState(), "PLAYING");
  assert.ok(!av.calls.includes("stop"), "muting restarted or stopped playback");

  player.setMuted(false);
  assert.equal(tvMuted, false);
  assert.equal(av.getState(), "PLAYING");
});

test("going off screen suspends the decoder rather than pausing it", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  player.hide();
  // A set short of memory kills the background app holding a decoder first.
  assert.ok(av.calls.includes("suspend"));
  player.show();
  assert.ok(av.calls.includes("restore"));
});

test("resuming rejoins the broadcast instead of continuing from the hole", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;

  player.play(liveRequest());
  // Live television has moved on and there is no seek bar to catch up with, so a pause is a
  // hole rather than a bookmark.
  assert.ok(av.calls.some((c) => c.startsWith("open:")));
});

test("a stream that ends is reported, and only once", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  av.listener?.onstreamcompleted?.();
  expect(events.filter((e) => e.type === "ended")).toHaveLength(1);
});

test("an abort the app caused itself is not reported as a fault", async () => {
  /*
   * The browser path, because that is where play() returns a promise at all.
   *
   * Tuning away, retrying and pausing all interrupt the element's pending play(), which then
   * rejects with AbortError. That rejection is this application's own doing and never news:
   * reporting it replaces a real explanation, or invents a fault where there was none.
   */
  delete (window as unknown as { webapis?: unknown }).webapis;
  const seen: PlayerEvent[] = [];
  const browser = new Player((e) => seen.push(e));

  const video = document.createElement("video");
  // Safari's route, so the test is about play() rather than about hls.js.
  video.canPlayType = () => "probably";
  let refuse: (e: unknown) => void = () => {};
  let asked = 0;
  video.play = () =>
    new Promise<void>((_, reject) => {
      asked += 1;
      refuse = reject;
    });
  browser.attach(video);

  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(asked, 1, "the element was never asked to play, so nothing is being tested");
  const aborted = refuse;

  browser.play(liveRequest()); // the retune, which tears the first attempt down
  aborted(new DOMException("interrupted by a new load request", "AbortError"));
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(
    seen.filter((e) => e.type === "error").map((e) => e.code),
    [],
  );
  browser.stop();
});

test("how much to buffer before starting is asked for while the player will still accept it", () => {
  /*
   * Both of these are IDLE only, so after open and before prepareAsync or they throw and the
   * channel never starts. Six seconds leaves room for a five second segment while staying below
   * the ten seconds Samsung ships.
   */
  player.play(liveRequest());
  av.prepared?.ok();

  const asked = av.calls.indexOf(
    "setBufferingParam:PLAYER_BUFFER_FOR_PLAY,PLAYER_BUFFER_SIZE_IN_SECOND,6",
  );
  assert.ok(asked !== -1, `never asked: ${av.calls.join(" ")}`);
  assert.ok(
    av.calls.findIndex((c) => c.startsWith("open")) < asked,
    "asked before the stream was open",
  );
  assert.ok(
    asked < av.calls.indexOf("prepareAsync"),
    "asked once it was too late to be accepted",
  );
});

test("a longer diagnosed segment can raise the initial buffer", () => {
  player.play(liveRequest(undefined, { bufferSeconds: 11 }));
  av.prepared?.ok();

  assert.ok(
    av.calls.includes(
      "setBufferingParam:PLAYER_BUFFER_FOR_PLAY,PLAYER_BUFFER_SIZE_IN_SECOND,11",
    ),
    "the diagnosed buffer was not passed to AVPlay",
  );
});

test("firmware without the optional calls does not stop a channel starting", () => {
  // Older sets lack setTimeoutForBuffering, setBufferingParam and setDisplayMethod. An app that
  // assumes them throws on open and plays nothing at all.
  const bare = fakeAVPlay() as Partial<ReturnType<typeof fakeAVPlay>>;
  delete bare.setTimeoutForBuffering;
  delete bare.setBufferingParam;
  delete bare.setDisplayMethod;
  delete bare.suspend;
  (window as unknown as { webapis: unknown }).webapis = { avplay: bare };

  const events2: PlayerEvent[] = [];
  const p = new Player((e) => events2.push(e));
  assert.doesNotThrow(() => p.play(liveRequest()));
  assert.deepEqual(
    events2.filter((e) => e.type === "error"),
    [],
  );
  p.stop();
});

test("finite AVPlay reports position and duration in seconds", () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  av.setTime(12_500);
  av.setDuration(90_000);

  assert.equal(player.getPosition(), 12.5);
  assert.equal(player.getDuration(), 90);
});

test("AVPlay applies a saved finite position only after READY and before play", async () => {
  player.play(finiteRequest(undefined, { startSeconds: 35 }));
  expect(av.calls).not.toContain("seekTo:35000");

  av.prepared?.ok();
  await vi.advanceTimersByTimeAsync(0);
  const seek = av.calls.indexOf("seekTo:35000");
  expect(seek).toBeGreaterThan(av.calls.indexOf("prepareAsync"));
  expect(seek).toBeLessThan(av.calls.indexOf("play"));
});

test("finite AVPlay continues from zero when initial seek is unavailable", () => {
  delete (av as Partial<typeof av>).seekTo;
  player.play(finiteRequest(undefined, { startSeconds: 35 }));

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  av.prepared?.ok();
  assert.equal(player.getResumeLimitation(), "SEEK_UNSUPPORTED");
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay continues from zero when initial seek is rejected", async () => {
  av.seekTo = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("seekTo:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play(finiteRequest(undefined, { startSeconds: 35 }));

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  av.prepared?.ok();
  await vi.advanceTimersByTimeAsync(200);
  assert.match(player.getResumeLimitation() ?? "", /SEEK_FAILED/);
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay seeks forward and backward by ten seconds with clamping", async () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  av.setTime(115_000);

  assert.equal(await player.seekTo(120), true);
  assert.equal(player.getPosition(), 119.999);
  assert.equal(await player.seekTo(110), true);
  assert.equal(player.getPosition(), 110);
});

test("unsupported finite AVPlay seeking is nonfatal and does not change position", async () => {
  delete (av as Partial<typeof av>).seekTo;
  player.play(finiteRequest());
  av.prepared?.ok();
  av.setTime(20_000);

  assert.equal(await player.seekTo(30), false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
});

test("rejected finite AVPlay seeking is nonfatal and playback can continue", async () => {
  av.seekTo = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("seekTo:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play(finiteRequest());
  av.prepared?.ok();
  av.setTime(20_000);

  const pending = player.seekTo(30);
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(await pending, false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
  assert.equal(av.getState(), "PLAYING");
});

test("finite pause resumes in place while live resume opens the live edge", () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;
  player.resumePlayback();
  assert.deepEqual(av.calls, ["play"]);

  player.play(liveRequest("http://example.invalid/live.m3u8"));
  assert.ok(av.calls.some((call) => call.startsWith("open:http://example.invalid/live.m3u8")));
});

test("browser finite MP4 uses native video and exposes media timing", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  Object.defineProperties(video, {
    currentTime: { configurable: true, writable: true, value: 0 },
    duration: { configurable: true, value: 95 },
  });
  browser.attach(video);
  browser.play(finiteRequest(undefined, { startSeconds: 15 }));
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(hlsMock.instance, null);
  assert.match(video.src, /movie\/1\.mp4$/);
  assert.equal(browser.getPosition(), 15);
  assert.equal(browser.getDuration(), 95);
  assert.equal(await browser.seekTo(95), true);
  assert.equal(browser.getPosition(), 95);
  browser.stop();
});

test("native subtitle cues emit their text, duration and empty clearing", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  let cueListener = () => {};
  const track = {
    label: "English",
    language: "en",
    mode: "showing",
    activeCues: [{ startTime: 2, endTime: 5, text: "Caption" }],
    addEventListener: (_type: string, listener: () => void) => {
      cueListener = listener;
    },
    removeEventListener: () => {},
  };
  Object.defineProperty(video, "textTracks", { configurable: true, value: [track] });
  browser.attach(video);
  browser.play(finiteRequest());
  // Track lists and cue listeners exist only once the browser has read the metadata.
  video.dispatchEvent(new Event("loadedmetadata"));
  cueListener();
  expect(browserEvents).toContainEqual({ type: "subtitle", text: "Caption", durationMs: 3000 });

  track.activeCues = [];
  cueListener();
  expect(browserEvents).toContainEqual({ type: "subtitle", text: "", durationMs: 0 });
  browser.stop();
});

test("browser finite HLS still uses hls.js", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  browser.attach(video);
  browser.play(finiteRequest("http://example.invalid/catchup/1.m3u8"));
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(hlsMock.instance?.source, "http://example.invalid/catchup/1.m3u8");
  browser.stop();
});

test.each(["live", "finite"] as const)(
  "HLS HTTP refusals preserve their status for %s playback",
  async (mode) => {
    delete (window as unknown as { webapis?: unknown }).webapis;
    hlsMock.supported = true;
    const browserEvents: PlayerEvent[] = [];
    const browser = new Player((event) => browserEvents.push(event));
    const video = document.createElement("video");
    browser.attach(video);
    browser.play(
      mode === "finite" ? finiteRequest("http://example.invalid/movie/1.m3u8") : liveRequest(),
    );
    await vi.advanceTimersByTimeAsync(0);
    const hls = hlsMock.instance;
    assert.ok(hls);
    hls.emit("error", {
      fatal: true,
      type: "networkError",
      details: "manifestLoadError",
      response: { code: 401 },
    });
    video.dispatchEvent(new Event("error"));

    expect(browserEvents.filter((event) => event.type === "error")).toEqual([
      { type: "error", code: "manifestLoadError (http 401)", warmKind: "network" },
    ]);
    browser.stop();
  },
);

test.each(["live", "finite"] as const)(
  "a native %s media error does not claim an unsupported format",
  (mode) => {
    delete (window as unknown as { webapis?: unknown }).webapis;
    const browserEvents: PlayerEvent[] = [];
    const browser = new Player((event) => browserEvents.push(event));
    const video = document.createElement("video");
    video.canPlayType = vi.fn().mockReturnValue("probably");
    video.play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, "error", { value: { code: 4 } });
    browser.attach(video);
    browser.play(mode === "finite" ? finiteRequest() : liveRequest());
    video.dispatchEvent(new Event("error"));
    if (mode === "finite") {
      expect(browserEvents.filter((event) => event.type === "error")).toEqual([]);
      expect(video.getAttribute("crossorigin")).toBeNull();
      video.dispatchEvent(new Event("error"));
    }

    expect(browserEvents.filter((event) => event.type === "error")).toEqual([
      {
        type: "error",
        code: mode === "finite" ? "FINITE_SOURCE_UNAVAILABLE" : "NOT_SUPPORTED",
        warmKind: null,
      },
    ]);
    browser.stop();
  },
);

test("native CORS fallback preserves playback and ignores the first attempt's late rejection", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const events: PlayerEvent[] = [];
  const browser = new Player((event) => events.push(event));
  const video = document.createElement("video");
  let rejectFirst!: (error: unknown) => void;
  video.play = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValue(undefined);
  Object.defineProperty(video, "error", { configurable: true, value: { code: 4 } });
  browser.attach(video);
  browser.play(finiteRequest());
  expect(video.crossOrigin).toBe("anonymous");
  video.dispatchEvent(new Event("error"));
  expect(video.getAttribute("crossorigin")).toBeNull();
  expect(video.play).toHaveBeenCalledTimes(2);
  rejectFirst({ name: "NotSupportedError" });
  await vi.advanceTimersByTimeAsync(0);
  expect(events.filter((event) => event.type === "error")).toEqual([]);
  browser.stop();
});

test("browser finite unsupported containers report the media element failure", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockRejectedValue({ name: "NotSupportedError" });
  browser.attach(video);
  browser.play(finiteRequest("http://example.invalid/movie/1.mkv"));
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(
    browserEvents.filter((event) => event.type === "error").map((event) => event.code),
    ["NotSupportedError"],
  );
  browser.stop();
});

test("AVPlay never reads the Live range while IDLE or connecting", () => {
  player.play(liveRequest());
  player.getClock();
  expect(av.streamingReads).not.toContain("GET_LIVE_DURATION");
});

test.each(["READY", "PLAYING", "PAUSED"])("AVPlay reads the Live range in %s", (state) => {
  player.play(liveRequest());
  av.setState(state);
  expect(player.getClock()).toMatchObject({ seekableStart: 10, seekableEnd: 70 });
  expect(av.streamingReads).toContain("GET_LIVE_DURATION");
});

test("browser clock exposes finite seekable ranges", () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  Object.defineProperties(video, {
    currentTime: { configurable: true, value: 25 },
    duration: { configurable: true, value: 90 },
    seekable: {
      configurable: true,
      value: {
        length: 2,
        start: (index: number) => (index ? 20 : 0),
        end: (index: number) => (index ? 80 : 10),
      },
    },
  });
  browser.attach(video);

  expect(browser.getClock()).toMatchObject({
    position: 25,
    duration: 90,
    seekableStart: 0,
    seekableEnd: 80,
  });
  browser.stop();
});

test("hls.js clock exposes its live edge and longest manifest segment", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  browser.attach(video);
  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);
  hlsMock.instance?.emit("levelLoaded", {
    details: { edge: 120, fragments: [{ duration: 4 }, { duration: 6 }] },
  });

  expect(browser.getClock()).toMatchObject({ engineLiveEdge: 120, segmentSeconds: 6 });
  browser.stop();
});

test("pause support follows legal AVPlay states and a rejection does not tear playback down", () => {
  player.play(liveRequest());
  expect(player.canPause()).toBe(false);
  av.prepared?.ok();
  av.pause = () => {
    throw new Error("rejected");
  };

  expect(player.pause()).toBe(false);
  expect(av.calls).not.toContain("stop");
});

test("reapplying paused intent leaves an already paused AVPlay decoder alone", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  expect(player.pause()).toBe(true);
  expect(player.pause()).toBe(true);
  expect(av.calls.filter((call) => call === "pause")).toHaveLength(1);
});

test("an absolute AVPlay seek resolves from delayed callbacks", async () => {
  let complete = () => {};
  av.seekTo = (milliseconds: number, ok: () => void) => {
    av.calls.push(`seekTo:${milliseconds}`);
    complete = ok;
  };
  player.play(finiteRequest());
  av.prepared?.ok();
  const pending = player.seekTo(45);
  complete();

  await expect(pending).resolves.toBe(true);
  expect(av.calls).toContain("seekTo:45000");
});

test("an absolute AVPlay seek resolves false when the engine never calls back", async () => {
  av.seekTo = () => {};
  player.play(finiteRequest());
  av.prepared?.ok();
  const pending = player.seekTo(45);
  await vi.advanceTimersByTimeAsync(5000);

  await expect(pending).resolves.toBe(false);
});

test("AVPlay waits for the resume seek callback before reading tracks or starting play", async () => {
  let complete = () => {};
  av.seekTo = (_milliseconds, ok) => {
    complete = ok;
  };
  const tracks = vi.spyOn(av, "getTotalTrackInfo");
  player.play(finiteRequest(undefined, { startSeconds: 35 }));
  av.prepared?.ok();
  expect(av.calls).not.toContain("play");
  expect(tracks).not.toHaveBeenCalled();
  complete();
  await vi.advanceTimersByTimeAsync(0);
  expect(tracks).toHaveBeenCalled();
  expect(av.calls).toContain("play");
});

test("a transient first AVPlay seek rejection retries without another viewer request", async () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  let attempts = 0;
  av.seekTo = (_milliseconds, ok, fail) => {
    if (++attempts === 1) fail({ name: "InvalidStateError" });
    else ok();
  };
  const pending = player.seekTo(45);
  expect(attempts).toBe(1);
  await vi.advanceTimersByTimeAsync(200);
  await expect(pending).resolves.toBe(true);
  expect(attempts).toBe(2);
});

test("an AVPlay seek retry never runs against a replacement target", async () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  let attempts = 0;
  av.seekTo = (_milliseconds, _ok, fail) => {
    attempts += 1;
    fail({ name: "InvalidStateError" });
  };
  const pending = player.seekTo(45);
  player.play(finiteRequest("http://example.invalid/another.mp4"));
  await vi.advanceTimersByTimeAsync(200);
  await expect(pending).resolves.toBe(false);
  expect(attempts).toBe(1);
});

test("AVPlay seeking clamps below the finite duration and never retries unsupported content", async () => {
  player.play(finiteRequest());
  av.prepared?.ok();
  await expect(player.seekTo(120)).resolves.toBe(true);
  expect(av.calls).toContain("seekTo:119999");
  const seek = vi.fn((_milliseconds, _ok, fail) => fail({ name: "NotSupportedError" }));
  av.seekTo = seek;
  await expect(player.seekTo(45)).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(seek).toHaveBeenCalledOnce();
});

test.each([
  ["network", "startPositions"],
  ["media", "mediaRecoveries"],
] as const)("hls.js supports warm %s recovery", async (kind, field) => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", { configurable: true, value: 30 });
  browser.attach(video);
  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);
  hlsMock.instance?.emit("error", {
    fatal: true,
    type: kind === "network" ? "networkError" : "mediaError",
    details: `${kind} failed`,
  });

  expect(browserEvents).toContainEqual({
    type: "error",
    code: `${kind} failed`,
    warmKind: kind,
  });
  expect(browser.warmRecover(kind)).toBe(true);
  if (field === "startPositions") expect(hlsMock.instance?.startPositions).toEqual([30]);
  else expect(hlsMock.instance?.mediaRecoveries).toBe(1);
  browser.stop();
});

test.each([
  ["READY", true],
  ["PAUSED", true],
  ["PLAYING", false],
  ["IDLE", false],
] as const)("AVPlay warm recovery from %s returns %s", (state, expected) => {
  player.play(liveRequest());
  av.setState(state);
  av.calls.length = 0;

  expect(player.warmRecover(null)).toBe(expected);
  expect(av.calls.includes("play")).toBe(expected);
});

test("AVPlay track selection obeys legal states and subtitle Off clears the cue", () => {
  player.play(liveRequest());
  expect(player.selectTrack("audio", 1)).toBe(false);
  av.prepared?.ok();
  expect(player.getTracks()).toHaveLength(2);
  expect(player.selectTrack("audio", 1)).toBe(true);
  expect(av.calls).toContain("setSelectTrack:AUDIO:1");

  av.listener?.onsubtitlechange?.(1500, "Caption");
  expect(events).toContainEqual({ type: "subtitle", text: "Caption", durationMs: 1500 });
  expect(player.selectTrack("subtitle", null)).toBe(true);
  expect(av.calls).toContain("setSilentSubtitle:true");
  expect(events).toContainEqual({ type: "subtitle", text: "", durationMs: 0 });
});

test("AVPlay selection updates the cached track flags instead of rereading stale flags", () => {
  av.getTotalTrackInfo = () => [
    { index: 1, type: "AUDIO", extra_info: '{"language":"en","selected":true}' },
    { index: 2, type: "AUDIO", extra_info: '{"language":"fa","selected":false}' },
  ];
  player.play(liveRequest());
  av.prepared?.ok();
  const reread = vi.spyOn(av, "getTotalTrackInfo");
  expect(player.selectTrack("audio", 2)).toBe(true);
  expect(
    player
      .getTracks()
      .filter((track) => track.selected)
      .map((track) => track.engineIndex),
  ).toEqual([2]);
  expect(reread).not.toHaveBeenCalled();
  expect(av.calls.filter((call) => call === "setSelectTrack:AUDIO:2")).toHaveLength(1);
});

test("a compatibility handover stops AVPlay without closing its decoder", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  av.calls.length = 0;
  player.stop(false);
  expect(av.calls).toContain("stop");
  expect(av.calls).not.toContain("close");
});

test("callbacks from a torn down target are ignored", () => {
  player.play(liveRequest("http://example.invalid/first.m3u8"));
  const oldPrepared = av.prepared;
  const oldListener = av.listener;
  player.play(liveRequest("http://example.invalid/second.m3u8"));
  events.length = 0;

  oldPrepared?.ok();
  oldListener?.onerror?.("OLD_ERROR");
  expect(events).toEqual([]);
});

test("native tracks are reported at loadedmetadata rather than the same tick", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  const track = {
    label: "English",
    language: "en",
    mode: "showing",
    activeCues: [],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const textTracks = Object.assign(new EventTarget(), { 0: track, length: 1 });
  const audioTracks = Object.assign(new EventTarget(), { length: 0 });
  Object.defineProperty(video, "textTracks", { configurable: true, value: textTracks });
  Object.defineProperty(video, "audioTracks", { configurable: true, value: audioTracks });
  browser.attach(video);

  browser.play(finiteRequest());
  // The list is only valid once the browser has read the metadata, so before that event
  // the only tracks reported are the empty set teardown publishes.
  assert.deepEqual(browser.getTracks(), []);
  expect(browser.getStats().engine).toBe("Native video");

  video.dispatchEvent(new Event("loadedmetadata"));
  assert.deepEqual(
    browser.getTracks().map((entry) => entry.kind),
    ["subtitle"],
  );
  Object.assign(audioTracks, {
    0: { label: "French", language: "fr", enabled: true },
    length: 1,
  });
  audioTracks.dispatchEvent(new Event("addtrack"));
  expect(browser.getTracks().map((entry) => entry.kind)).toEqual(["audio", "subtitle"]);
  const replacedAudio = Object.assign(new EventTarget(), {
    0: { label: "German", language: "de", enabled: true },
    length: 1,
  });
  Object.defineProperty(video, "audioTracks", { configurable: true, value: replacedAudio });
  video.dispatchEvent(new Event("loadeddata"));
  expect(browser.getTracks().find((entry) => entry.kind === "audio")?.language).toBe("de");
  replacedAudio[0].enabled = false;
  replacedAudio.dispatchEvent(new Event("change"));
  expect(browser.getTracks().find((entry) => entry.kind === "audio")?.selected).toBe(false);
  track.mode = "disabled";
  textTracks.dispatchEvent(new Event("change"));
  expect(browser.getTracks().find((entry) => entry.kind === "subtitle")?.selected).toBe(false);
  browser.stop();
  replacedAudio.dispatchEvent(new Event("addtrack"));
  video.dispatchEvent(new Event("canplay"));
  expect(browser.getTracks()).toEqual([]);
});

test("hls.js publishes audio tracks that become available after manifest parsing", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  browser.attach(video);
  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);
  const hls = hlsMock.instance!;
  hls.audioTracks = [];
  hls.emit("manifestParsed", {});
  expect(browser.getTracks().filter((track) => track.kind === "audio")).toEqual([]);

  hls.audioTracks.push({ name: "Deutsch", lang: "de", default: true });
  hls.emit("audioTracksUpdated", {});
  expect(
    browser
      .getTracks()
      .filter((track) => track.kind === "audio")
      .map((track) => track.label),
  ).toEqual(["Deutsch"]);
  expect(
    browserEvents.some(
      (event) =>
        event.type === "tracks" && event.tracks.some((track) => track.kind === "audio"),
    ),
  ).toBe(true);

  browser.stop();
  browserEvents.length = 0;
  hls.emit("audioTracksUpdated", {});
  expect(browserEvents).toEqual([]);
});

test("hls.js subtitle cues reach the app when the TextTrack appears after manifest parse", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  browser.attach(video);
  browser.play(liveRequest());
  await vi.advanceTimersByTimeAsync(0);
  hlsMock.instance?.emit("manifestParsed", {});

  // hls.js creates the TextTrack when the subtitle track is enabled, not at parse time.
  const track = new EventTarget() as EventTarget & {
    label: string;
    language: string;
    mode: string;
    activeCues: TextTrackCue[];
  };
  track.label = "English";
  track.language = "en";
  track.mode = "hidden";
  track.activeCues = [{ startTime: 1, endTime: 4, text: "Late caption" } as TextTrackCue];
  const list = new EventTarget() as EventTarget & { length: number; 0: unknown };
  list.length = 1;
  list[0] = track;
  Object.defineProperty(video, "textTracks", { configurable: true, value: list });
  hlsMock.instance?.emit("subtitleTracksUpdated", {});

  track.dispatchEvent(new Event("cuechange"));
  expect(browserEvents).toContainEqual({
    type: "subtitle",
    text: "Late caption",
    durationMs: 3000,
  });
  browser.stop();
});

test("subtitle silence follows the choice across an audio selection and a channel change", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  // Opening reapplies the choice: a fresh channel with subtitles on is never silent.
  expect(av.calls).toContain("setSilentSubtitle:false");

  player.selectTrack("subtitle", null);
  player.selectTrack("audio", 1);
  // Selecting an audio track must not unsilence the subtitles the viewer turned off.
  expect(av.calls.filter((c) => c === "setSilentSubtitle:true")).not.toHaveLength(0);
  assert.equal(
    av.calls.filter((c) => c.startsWith("setSilentSubtitle")).pop(),
    "setSilentSubtitle:true",
  );

  av.calls.length = 0;
  player.play(liveRequest("http://example.invalid/b.m3u8"));
  av.prepared?.ok();
  // The next channel starts with subtitles on, so the engine must be unsilenced again.
  assert.equal(
    av.calls.filter((c) => c.startsWith("setSilentSubtitle")).pop(),
    "setSilentSubtitle:false",
  );
});

test("a warm AVPlay recovery announces buffering like the hls.js path", () => {
  player.play(liveRequest());
  av.prepared?.ok();
  av.setState("PAUSED");
  events.length = 0;

  player.warmRecover("network");
  expect(events.map((event) => event.type)).toContain("buffering-start");
});
