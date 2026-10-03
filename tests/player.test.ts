import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { Player, onTizen, type PlayerEvent } from "../src/services/player";

interface FakeHlsInstance {
  source: string;
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
    };
    static ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
    currentLevel = 2;
    bandwidthEstimate = 6_200_000;
    levels = [
      { width: 640, height: 360, bitrate: 800_000 },
      { width: 1280, height: 720, bitrate: 2_500_000 },
      {
        width: 1920,
        height: 1080,
        bitrate: 4_500_000,
        frameRate: 50,
        videoCodec: "avc1.640028",
        audioCodec: "mp4a.40.2",
      },
    ];
    handlers = new Map<string, HlsHandler>();
    source = "";
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
    startLoad() {}
    recoverMediaError() {}
    destroy() {}
  }
  return { default: FakeHls };
});

/**
 * The player, which is the riskiest thing in the application and had no tests at all.
 *
 * It drives two engines that agree about nothing, and almost all of its interesting
 * behaviour is about time: how long a channel may take to start, how long a still picture is
 * allowed before it counts as frozen, and whether the timers that decide both are called off
 * when they should be. None of that can be reached by looking at the code, and all of it is
 * what the viewer actually experiences when a relay misbehaves.
 *
 * The AVPlay path is the one covered here, because it is the one that runs on a television
 * and the one whose call ordering is load bearing: several of its calls are legal in only
 * one state, so getting the sequence wrong means the channel silently never starts.
 */

/** A stand in for webapis.avplay that records what it was asked to do, and in what order. */
function fakeAVPlay() {
  const calls: string[] = [];
  let state = "NONE";
  let currentTime = 0;
  let duration = 120_000;
  const av = {
    listener: null as null | Record<string, (arg?: unknown) => void>,
    prepared: null as null | { ok: () => void; fail: (e: unknown) => void },
    calls,
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
        }),
      },
      {
        index: 1,
        type: "AUDIO",
        extra_info: JSON.stringify({ FourCC: "AAC", Bit_rate: 192_000 }),
      },
    ],
    getStreamingProperty: (key: string) =>
      (
        ({
          CURRENT_BANDWIDTH: "6200000",
          AVAILABLE_BITRATE: "1500000|3000000|4500000",
          CURRENT_LEVEL: "3",
          BUFFER_AHEAD: "5.5",
          FRAME_RATE: "49.9",
          TOTAL_FRAMES: "100",
          DROPPED_FRAMES: "2",
        }) as Record<string, string>
      )[key] ?? "",
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
    setListener: (l: Record<string, (arg?: unknown) => void>) => {
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
  };
  return av;
}

let av: ReturnType<typeof fakeAVPlay>;
let events: PlayerEvent[];
let player: Player;
let tvMuted = false;

const codes = () => events.filter((e) => e.type === "error").map((e) => e.code);

beforeEach(() => {
  vi.useFakeTimers();
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
  document.getElementById("avplay-surface")?.remove();
});

test("the TV path is taken when AVPlay is present", () => {
  assert.equal(onTizen(), true);
});

test("starting a channel calls AVPlay in the order its states require", () => {
  player.play("http://example.invalid/a.m3u8");

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
  player.play("http://example.invalid/a.m3u8");
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
  player.play("http://example.invalid/a.m3u8");
  av.listener?.onerrormsg?.("PLAYER_ERROR_NOT_SUPPORTED_FILE", "codec not supported");
  // The same failure arriving twice is one failure: onerror and onerrormsg describe one event,
  // and the first explanation is the one that survives.
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  const faults = events.filter((e) => e.type === "error");
  assert.equal(faults.length, 1, "reported twice");
  assert.match(faults[0].code, /codec not supported/);
});

test("buffering progress is passed on, and is absent when the engine says nothing", () => {
  player.play("http://example.invalid/a.m3u8");
  av.listener?.onbufferingstart?.();
  av.listener?.onbufferingprogress?.(42);

  const buffering = events.filter((e) => e.type === "buffering");
  /*
   * Found rather than indexed. play() reports buffering itself before the engine is even asked,
   * so the progress report is the third of three here, and an index would be asserting the
   * order of events that have no reason to keep one.
   */
  assert.equal(buffering.find((e) => e.percent !== undefined)?.percent, 42);
  // A start that said nothing about progress must not read as nought per cent.
  assert.ok(
    buffering.some((e) => e.percent === undefined),
    "the start invented a figure",
  );
});

test("AVPlay statistics normalize current engine values without using playlist labels", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
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
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  expect(player.getStats()).toEqual({
    engine: "AVPlay",
    width: 1920,
    height: 1080,
    videoCodec: "H264",
    audioCodec: "AAC",
    bitrate: 4_500_000,
    frameRate: 50,
    switches: 0,
  });
});

test("AVPlay counts actual adaptive bitrate changes rather than the initial selection", () => {
  player.play("http://example.invalid/a.m3u8");
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
  browser.play("http://example.invalid/a.m3u8");
  await vi.advanceTimersByTimeAsync(0);

  const hls = hlsMock.instance;
  assert.ok(hls, "hls.js was not created");
  hls.emit("levelSwitch", { level: 0 });
  hls.emit("levelSwitch", { level: 2 });

  expect(browser.getStats()).toMatchObject({
    engine: "hls.js",
    width: 1920,
    height: 1080,
    videoCodec: "avc1.640028",
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

test("the adaptive request starts low and asks the set to skip nothing", () => {
  player.play("http://example.invalid/a.m3u8");
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
  player.play("http://example.invalid/a.m3u8");
  expect(events.map((e) => e.type)).toEqual(["buffering"]);

  av.prepared?.ok();
  expect(events.map((e) => e.type)).toContain("playing");
  assert.ok(av.calls.includes("play"));
});

test("the hardware surface is created once and never replaced", () => {
  player.play("http://example.invalid/a.m3u8");
  player.play("http://example.invalid/b.m3u8");
  // webapis.avplay is a singleton with nothing tying it to an element, so a second object
  // element would send the video to the wrong one.
  assert.equal(document.querySelectorAll("#avplay-surface").length, 1);
});

test("a channel that never starts is given up on after thirty seconds", () => {
  player.play("http://example.invalid/a.m3u8");
  vi.advanceTimersByTime(29_000);
  assert.deepEqual(codes(), [], "gave up early on a channel that was still coming");

  vi.advanceTimersByTime(2_000);
  assert.deepEqual(codes(), ["TIMEOUT"]);
});

test("a channel that starts calls off the watchdog", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  // The programme keeps running, so the only thing that could still fire is the start
  // timeout, and it must not: the channel plainly started.
  for (let i = 0; i < 20; i++) {
    av.advance(3000);
    vi.advanceTimersByTime(3_000);
  }
  assert.deepEqual(codes(), [], "the start timeout fired after the picture had arrived");
});

test("a picture that stops moving is reported as stalled", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();

  // A frozen relay looks exactly like a playing one: no error, no buffering, no end of
  // stream. The only evidence is a playhead that has stopped.
  vi.advanceTimersByTime(11_000);
  assert.deepEqual(codes(), [], "twelve seconds is the limit, not eleven");

  vi.advanceTimersByTime(3_000);
  assert.deepEqual(codes(), ["STALLED"]);
});

test("a picture that keeps moving is never called stalled", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  for (let i = 0; i < 20; i++) {
    av.advance(3000); // three seconds of programme per tick
    vi.advanceTimersByTime(3_000);
  }
  assert.deepEqual(codes(), []);
});

test("a picture held on purpose is not a fault", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.pause();

  // The viewer stopped it, so the frame is still because they asked. Reporting that as a
  // frozen channel is the app arguing with the person using it.
  vi.advanceTimersByTime(60_000);
  assert.deepEqual(codes(), []);
});

test("only the first explanation of a failure is kept", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.fail({ name: "PLAYER_ERROR_CONNECTION_FAILED" });
  av.listener?.onerror?.("PLAYER_ERROR_NOT_SUPPORTED_FILE");

  // One broken stream produces several errors and the later ones are consequences. The
  // cause is worth more to the viewer than the symptom.
  assert.deepEqual(codes(), ["PLAYER_ERROR_CONNECTION_FAILED"]);
});

test("stopping clears the timers, so nothing is reported afterwards", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.stop();
  vi.advanceTimersByTime(120_000);
  assert.deepEqual(codes(), []);
});

test("changing channel goes through stop rather than close", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  av.calls.length = 0;

  player.play("http://example.invalid/b.m3u8");
  // close destroys the instance and the whole pipeline has to be rebuilt, which is the
  // wrong thing to do to a television while somebody is holding the channel key down.
  assert.ok(av.calls.includes("stop"));
  assert.ok(!av.calls.includes("close"));
});

test("the aspect setting reaches the engine and survives a channel change", () => {
  player.setFit("fill");
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));

  av.calls.length = 0;
  player.play("http://example.invalid/a.m3u8");
  // A fresh AVPlay instance starts on its own default, so the choice has to be reapplied.
  assert.ok(av.calls.some((c) => c === "setDisplayMethod:PLAYER_DISPLAY_MODE_FULL_SCREEN"));
});

test("muting audio leaves AVPlay running and restores the prior TV mute state", () => {
  player.play("http://example.invalid/a.m3u8");
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
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.hide();
  // A set short of memory kills the background app holding a decoder first.
  assert.ok(av.calls.includes("suspend"));
  player.show();
  assert.ok(av.calls.includes("restore"));
});

test("resuming rejoins the broadcast instead of continuing from the hole", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;

  player.resume("http://example.invalid/a.m3u8");
  // Live television has moved on and there is no seek bar to catch up with, so a pause is a
  // hole rather than a bookmark.
  assert.ok(av.calls.some((c) => c.startsWith("open:")));
});

test("a stream that ends is reported, and only once", () => {
  player.play("http://example.invalid/a.m3u8");
  av.prepared?.ok();
  av.listener?.onstreamcompleted?.();
  expect(events.filter((e) => e.type === "ended")).toHaveLength(1);
});

test("an abort the app caused itself is not reported as a fault", async () => {
  /*
   * The browser path, because that is where play() returns a promise at all.
   *
   * A channel on a host that never answers is given up on by the watchdog, retried, and the
   * retry tears the last attempt down: the pending play() then rejects with AbortError. That
   * arrives after the new attempt has cleared the failure, so it used to win the rule that
   * keeps the first explanation and replace "could not reach the server" with "the stream
   * stopped unexpectedly", which is neither true nor any help.
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

  browser.play("http://example.invalid/a.m3u8");
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(asked, 1, "the element was never asked to play, so nothing is being tested");
  const aborted = refuse;

  await vi.advanceTimersByTimeAsync(30_000); // the watchdog names the real reason
  browser.play("http://example.invalid/a.m3u8"); // the automatic retry, which tears it down
  aborted(new DOMException("interrupted by a new load request", "AbortError"));
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(
    seen.filter((e) => e.type === "error").map((e) => e.code),
    ["TIMEOUT"],
  );
  browser.stop();
});

test("how much to buffer before starting is asked for while the player will still accept it", () => {
  /*
   * Both of these are IDLE only, so after open and before prepareAsync or they throw and the
   * channel never starts. Six seconds leaves room for a five second segment while staying below
   * the ten seconds Samsung ships.
   */
  player.play("http://example.invalid/a.m3u8");
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
  player.play("http://example.invalid/a.m3u8", false, 11);
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
  assert.doesNotThrow(() => p.play("http://example.invalid/a.m3u8"));
  assert.deepEqual(
    events2.filter((e) => e.type === "error"),
    [],
  );
  p.stop();
});

test("finite AVPlay reports position and duration in seconds", () => {
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  av.setTime(12_500);
  av.setDuration(90_000);

  assert.equal(player.getPosition(), 12.5);
  assert.equal(player.getDuration(), 90);
});

test("finite AVPlay applies a positive initial seek in IDLE before prepare", () => {
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite", 35);

  const seek = av.calls.indexOf("seekTo:35000");
  assert.ok(seek > av.calls.findIndex((call) => call.startsWith("open:")));
  assert.ok(seek < av.calls.indexOf("prepareAsync"));
});

test("finite AVPlay continues from zero when initial seek is unavailable", () => {
  delete (av as Partial<typeof av>).seekTo;
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite", 35);

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  assert.equal(player.getResumeLimitation(), "SEEK_UNSUPPORTED");
  av.prepared?.ok();
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay continues from zero when initial seek is rejected", () => {
  av.seekTo = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("seekTo:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite", 35);

  assert.ok(av.calls.includes("prepareAsync"));
  assert.deepEqual(codes(), []);
  assert.match(player.getResumeLimitation() ?? "", /SEEK_FAILED InvalidStateError/);
  av.prepared?.ok();
  assert.ok(av.calls.includes("play"));
});

test("finite AVPlay seeks forward and backward by ten seconds with clamping", async () => {
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  av.setTime(115_000);

  assert.equal(await player.seekBy(10), true);
  assert.equal(player.getPosition(), 120);
  assert.equal(await player.seekBy(-10), true);
  assert.equal(player.getPosition(), 110);
});

test("unsupported finite AVPlay seeking is nonfatal and does not change position", async () => {
  delete (av as Partial<typeof av>).seekTo;
  delete (av as Partial<typeof av>).jumpForward;
  delete (av as Partial<typeof av>).jumpBackward;
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  av.setTime(20_000);

  assert.equal(await player.seekBy(10), false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
});

test("rejected finite AVPlay seeking is nonfatal and playback can continue", async () => {
  av.jumpForward = (_ms: number, _ok: () => void, fail: (error: unknown) => void) => {
    av.calls.push("jumpForward:rejected");
    fail({ name: "InvalidStateError" });
  };
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  av.setTime(20_000);

  assert.equal(await player.seekBy(10), false);
  assert.equal(player.getPosition(), 20);
  assert.deepEqual(codes(), []);
  assert.equal(av.getState(), "PLAYING");
});

test("finite pause resumes in place while live resume opens the live edge", () => {
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  player.pause();
  av.calls.length = 0;
  player.resumePlayback();
  assert.deepEqual(av.calls, ["play"]);

  player.resumeLive("http://example.invalid/live.m3u8");
  assert.ok(av.calls.some((call) => call.startsWith("open:http://example.invalid/live.m3u8")));
});

test("a pending finite seek suspends the stall watchdog", async () => {
  let finish = () => {};
  av.jumpForward = (ms: number, ok: () => void) => {
    av.calls.push(`jumpForward:${ms}`);
    finish = ok;
  };
  player.play("http://example.invalid/movie/1.mp4", false, 6, "finite");
  av.prepared?.ok();
  const seeking = player.seekBy(10);

  vi.advanceTimersByTime(60_000);
  assert.deepEqual(codes(), []);
  finish();
  assert.equal(await seeking, true);
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
  browser.play("http://example.invalid/movie/1.mp4", false, 6, "finite", 15);
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(hlsMock.instance, null);
  assert.match(video.src, /movie\/1\.mp4$/);
  assert.equal(browser.getPosition(), 15);
  assert.equal(browser.getDuration(), 95);
  assert.equal(await browser.seekBy(100), true);
  assert.equal(browser.getPosition(), 95);
  browser.stop();
});

test("browser finite HLS still uses hls.js", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  hlsMock.supported = true;
  const browser = new Player(() => {});
  const video = document.createElement("video");
  browser.attach(video);
  browser.play("http://example.invalid/catchup/1.m3u8", false, 6, "finite");
  await vi.advanceTimersByTimeAsync(0);

  assert.equal(hlsMock.instance?.source, "http://example.invalid/catchup/1.m3u8");
  browser.stop();
});

test("browser finite unsupported containers report the media element failure", async () => {
  delete (window as unknown as { webapis?: unknown }).webapis;
  const browserEvents: PlayerEvent[] = [];
  const browser = new Player((event) => browserEvents.push(event));
  const video = document.createElement("video");
  video.play = vi.fn().mockRejectedValue({ name: "NotSupportedError" });
  browser.attach(video);
  browser.play("http://example.invalid/movie/1.mkv", false, 6, "finite");
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(
    browserEvents.filter((event) => event.type === "error").map((event) => event.code),
    ["NotSupportedError"],
  );
  browser.stop();
});
