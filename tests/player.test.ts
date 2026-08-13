import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { Player, onTizen, type PlayerEvent } from "../src/services/player";

// The browser path loads hls.js on demand. Half a megabyte off the disk is not worth waiting
// for here, and the one test that goes that way wants the native route anyway.
vi.mock("hls.js", () => ({ default: { isSupported: () => false } }));

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
  const av = {
    listener: null as null | Record<string, (arg?: unknown) => void>,
    prepared: null as null | { ok: () => void; fail: (e: unknown) => void },
    calls,
    open: (url: string) => { calls.push(`open:${url}`); state = "IDLE"; },
    close: () => { calls.push("close"); state = "NONE"; },
    stop: () => { calls.push("stop"); state = "IDLE"; },
    play: () => { calls.push("play"); state = "PLAYING"; },
    pause: () => { calls.push("pause"); state = "PAUSED"; },
    getState: () => state,
    getCurrentTime: () => currentTime,
    setDisplayRect: () => calls.push("setDisplayRect"),
    setDisplayMethod: (m: string) => calls.push(`setDisplayMethod:${m}`),
    setStreamingProperty: (k: string) => calls.push(`setStreamingProperty:${k}`),
    setTimeoutForBuffering: (s: number) => calls.push(`setTimeoutForBuffering:${s}`),
    suspend: () => calls.push("suspend"),
    restore: () => calls.push("restore"),
    setListener: (l: Record<string, (arg?: unknown) => void>) => { av.listener = l; },
    prepareAsync: (ok: () => void, fail: (e: unknown) => void) => {
      calls.push("prepareAsync");
      av.prepared = { ok: () => { state = "READY"; ok(); }, fail };
    },
    advance: (by: number) => { currentTime += by; },
    setTime: (t: number) => { currentTime = t; },
  };
  return av;
}

let av: ReturnType<typeof fakeAVPlay>;
let events: PlayerEvent[];
let player: Player;

const codes = () => events.filter((e) => e.type === "error").map((e) => e.code);

beforeEach(() => {
  vi.useFakeTimers();
  av = fakeAVPlay();
  (window as unknown as { webapis: unknown }).webapis = { avplay: av };
  events = [];
  player = new Player((e) => events.push(e));
});

afterEach(() => {
  player.stop();
  vi.useRealTimers();
  delete (window as unknown as { webapis?: unknown }).webapis;
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
    av.advance(3000);              // three seconds of programme per tick
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
  video.play = () => new Promise<void>((_, reject) => { asked += 1; refuse = reject; });
  browser.attach(video);

  browser.play("http://example.invalid/a.m3u8");
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(asked, 1, "the element was never asked to play, so nothing is being tested");
  const aborted = refuse;

  await vi.advanceTimersByTimeAsync(30_000);      // the watchdog names the real reason
  browser.play("http://example.invalid/a.m3u8");  // the automatic retry, which tears it down
  aborted(new DOMException("interrupted by a new load request", "AbortError"));
  await vi.advanceTimersByTimeAsync(0);

  assert.deepEqual(
    seen.filter((e) => e.type === "error").map((e) => e.code),
    ["TIMEOUT"],
  );
  browser.stop();
});

test("firmware without the optional calls does not stop a channel starting", () => {
  // Older sets lack setTimeoutForBuffering and setDisplayMethod. An app that assumes them
  // throws on open and plays nothing at all.
  const bare = fakeAVPlay() as Partial<ReturnType<typeof fakeAVPlay>>;
  delete bare.setTimeoutForBuffering;
  delete bare.setDisplayMethod;
  delete bare.suspend;
  (window as unknown as { webapis: unknown }).webapis = { avplay: bare };

  const events2: PlayerEvent[] = [];
  const p = new Player((e) => events2.push(e));
  assert.doesNotThrow(() => p.play("http://example.invalid/a.m3u8"));
  assert.deepEqual(events2.filter((e) => e.type === "error"), []);
  p.stop();
});
