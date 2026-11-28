import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assessSample,
  diagnosticOptions,
  vodCategoryReady,
} from "../scripts/tv/diagnostics.mjs";
import { LAUNCH_MARKS } from "../scripts/tv/launch-marks.mjs";

const probe = readFileSync(join(process.cwd(), "scripts/tv/bench.js"), "utf8");
const shim = readFileSync(join(process.cwd(), "scripts/tv/shim.js"), "utf8");
const posterFixture = (position: number, title = "Film") =>
  `<section class="poster-grid-region focused"><div role="grid" aria-colcount="6"><div role="row" aria-rowindex="${Math.ceil(position / 6)}"><div role="gridcell" aria-colindex="${((position - 1) % 6) + 1}"><button class="poster-card cursor">${title}</button></div></div></div></section>`;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__openiptvNativeTiming");
  Reflect.deleteProperty(window, "__openiptvTvFaults");
  Reflect.deleteProperty(window, "Hls");
  Reflect.deleteProperty(window, "webapis");
  Reflect.deleteProperty(window, "tizen");
});

describe("desktop diagnostic options", () => {
  const options = (values: Record<string, string> = {}, flags: string[] = []) =>
    diagnosticOptions({
      has: (name: string) => flags.includes(name),
      arg: (name: string) => values[name],
    });

  it("uses the host CPU unless an explicit desktop stress setting is requested", () => {
    expect(options()).toEqual({ cpu: 1 });
    expect(options({ cpu: "4" })).toEqual({ cpu: 4 });
  });

  it.each(["0", "-1", "NaN", "Infinity", ""])("rejects invalid CPU rate %s", (cpu) => {
    expect(() => options({ cpu })).toThrow("--cpu must be");
  });

  it("rejects missing CPU values and incompatible diagnostic journeys", () => {
    expect(() => options({}, ["cpu"])).toThrow("--cpu must be");
    expect(() => options({}, ["quick", "profile"])).toThrow("different diagnostic");
  });

  it.each(["floor", "reference", "budget", "cpu-score", "harsh"])(
    "rejects the retired %s option, including value syntax",
    (name) => {
      expect(() => options({}, [name])).toThrow("has been retired");
      expect(() => options({ [name]: "1" })).toThrow("has been retired");
    },
  );

  it("forwards an explicit browser executable to the profiler's simulator", () => {
    const source = readFileSync(join(process.cwd(), "scripts/tv/profile.mjs"), "utf8");
    const declaration = source.match(/const forwarded = [\s\S]*?;/)?.[0];
    expect(declaration).toBeDefined();
    const chrome = "/tmp/Chrome for Testing.app/Contents/MacOS/Chrome";
    const values: Record<string, string> = { chrome, url: "http://127.0.0.1:4183/" };
    const forwarded = runInNewContext(`${declaration}\nforwarded`, {
      arg: (name: string) => values[name],
    });
    expect(forwarded).toEqual(["--url=http://127.0.0.1:4183/", `--chrome=${chrome}`]);
  });

  it.each(["sim.mjs", "profile.mjs"])(
    "rejects a retired budget before %s starts a browser or acquires fixtures",
    (script) => {
      const result = spawnSync(process.execPath, [`scripts/tv/${script}`, "--budget"], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--budget has been retired");
    },
  );
});

type Sample = ReturnType<typeof passingSample>;
function passingSample() {
  return {
    label: "navigation",
    of: 120,
    hidden: false,
    rafHz: 40,
    elapsed: 3000,
    p95: 40,
    worst: 150,
    stallTimePercent: 5,
    hadCursor: true,
    presses: 12,
    answered: 12,
    lag: 20,
    inputP95: 80,
    worstLag: 130,
    stalls: 2,
    distance: 72,
  };
}

describe("diagnostic sample integrity", () => {
  it("does not turn slow desktop timings into a TV performance failure", () => {
    expect(
      assessSample(
        {
          ...passingSample(),
          rafHz: 1,
          p95: 1000,
          worst: 5000,
          stallTimePercent: 99,
          inputP95: 3000,
          worstLag: 5000,
          readyMs: 20000,
        },
        { focus: true, kind: "cold-category" },
      ),
    ).toEqual([]);
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects a cold category with an invalid readiness time of %s",
    (readyMs) => {
      expect(
        assessSample({ ...passingSample(), readyMs }, { kind: "cold-category" }).join(" "),
      ).toContain("invalid readyMs");
    },
  );

  it.each([
    { rafHz: Number.NaN },
    { p95: -1 },
    { worst: Number.POSITIVE_INFINITY },
    { stallTimePercent: Number.NaN },
    { elapsed: 0 },
    { of: 0 },
    { hidden: true },
  ])("rejects missing, hidden or malformed callback samples for %j", (metric) => {
    expect(
      assessSample({ ...passingSample(), readyMs: 750, ...metric }, { kind: "cold-category" })
        .length,
    ).toBeGreaterThan(0);
  });

  it("retains functional checks for unanswered input", () => {
    expect(
      assessSample({ ...passingSample(), answered: 11 }, { focus: true }).join(" "),
    ).toContain("11 of 12");
  });

  it("rejects invalid response measurements and incompatible event clocks", () => {
    expect(
      assessSample({ ...passingSample(), inputP95: -1 }, { focus: true }).join(" "),
    ).toContain("no input");
    expect(
      assessSample({ ...passingSample(), inputClockErrors: 1 }, { focus: true }).join(" "),
    ).toContain("timestamps");
  });

  it("requires the complete grid walk even when coalesced responses answer every press", () => {
    expect(
      assessSample(
        { ...passingSample(), distance: 6 },
        { focus: true, presses: 12, distance: 72 },
      ).join(" "),
    ).toContain("6 items traversed, 72 required");
    expect(assessSample(passingSample(), { focus: true, presses: 12, distance: 72 })).toEqual(
      [],
    );
  });
});

function recorder(html: string) {
  document.body.innerHTML = html;
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  let now = 1000;
  let next = 0;
  const frames = new Map<number, () => void>();
  const events = document.createElement("div");
  const sandboxWindow = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    __bench: undefined as unknown as {
      start: (options?: { capture: boolean }) => void;
      markReady: () => number | null;
      stop: () => Sample & { inputClockErrors: number; readyMs: number | null };
    },
  };
  runInNewContext(probe, {
    window: sandboxWindow,
    document,
    performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) => {
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  return {
    start: (options?: { capture: boolean }) => sandboxWindow.__bench.start(options),
    markReady: () => sandboxWindow.__bench.markReady(),
    stop: () => sandboxWindow.__bench.stop(),
    advance: (duration: number) => {
      now += duration;
    },
    frame: (duration = 16) => {
      now += duration;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
    down: (queued = 0) => {
      const event = new KeyboardEvent("keydown", { keyCode: 40 });
      Object.defineProperty(event, "timeStamp", { value: now - queued });
      events.dispatchEvent(event);
    },
    scheduled: () => frames.size,
  };
}

describe("frame and focus recorder", () => {
  it("records readiness on the phase browser clock after the driver's barrier", () => {
    const recording = recorder(posterFixture(1));
    recording.start();
    recording.frame(750);
    expect(recording.markReady()).toBe(750);
    recording.frame(50);
    expect(recording.markReady()).toBe(750);
    expect(recording.stop().readyMs).toBe(750);
    recording.start();
    recording.frame(100);
    expect(recording.stop().readyMs).toBeNull();
    expect(recording.markReady()).toBeNull();
  });

  it("uses callback entry time and elapsed wall time, including the unsampled tail", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    r.frame(20);
    r.frame(40);
    r.frame(300);
    r.frame(20);
    r.advance(10);
    expect(r.stop()).toMatchObject({
      of: 4,
      elapsed: 390,
      rafHz: (4 * 1000) / 390,
      p95: 300,
      worst: 300,
      stalls: 1,
      stallTimePercent: (300 * 100) / 390,
    });
  });

  it("reports callback frequency without a 60 Hz cap or a displayed FPS claim", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    r.frame(5);
    r.frame(5);
    const result = r.stop();
    expect(result).toMatchObject({ rafHz: 200, of: 2, p95: 5 });
    expect(result).not.toHaveProperty("fps");
  });

  it("uses nearest rank p95 and keeps diagnostic precision", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    for (let index = 0; index < 19; index++) r.frame(50.01);
    r.frame(240);
    const result = r.stop();
    expect(result.p95).toBeCloseTo(50.01);
    expect(result.worst).toBeCloseTo(240);
    expect(assessSample({ ...result, label: "precision" })).toEqual([]);
  });

  it("rejects a phase that was hidden even if it becomes visible before stop", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    r.frame();
    expect(r.stop().hidden).toBe(true);
  });

  it("includes queued input and a second callback in the DOM response observation", () => {
    const r = recorder(
      '<div class="panel"><div class="pane rail focused"><button class="row cursor" style="top:0px;height:50px">One</button></div></div>',
    );
    r.start();
    r.advance(50);
    r.down(40);
    const row = document.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("Missing fixture cursor");
    row.style.top = "50px";
    r.frame();
    r.frame();
    const result = r.stop();
    expect(result.inputP95).toBe(72);
    expect(result.distance).toBe(1);
    expect(result.answered).toBe(1);
    expect(r.scheduled()).toBe(0);
  });

  it("counts a wrapping category step once instead of counting its absolute index jump", () => {
    const r = recorder(
      '<div class="panel"><div class="pane rail focused"><div class="pane-head"><span class="count">3</span></div><button class="row cursor" style="top:100px;height:50px">Last</button></div></div>',
    );
    r.start();
    r.down();
    const row = document.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("Missing fixture cursor");
    row.style.top = "0px";
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ answered: 1, distance: 1 });
  });

  it.each(["3", "3 / 5"])(
    "records the complete category cycle through Search with a count of %s",
    (count) => {
      const r = recorder(
        `<div class="panel"><button class="section-search">Search</button><div class="pane rail focused"><div class="pane-head"><span class="count">${count}</span></div><button class="row cursor" style="top:100px;height:50px">Last</button></div></div>`,
      );
      const search = document.querySelector(".section-search");
      const row = document.querySelector<HTMLElement>(".row");
      if (!search || !row) throw new Error("Missing fixture controls");
      r.start();
      r.down();
      row.classList.remove("cursor");
      search.classList.add("cursor");
      r.frame();
      r.frame();
      for (const top of [0, 50, 100]) {
        r.down();
        search.classList.remove("cursor");
        row.classList.add("cursor");
        row.style.top = `${top}px`;
        r.frame();
        r.frame();
      }
      expect(r.stop()).toMatchObject({
        presses: 4,
        answered: 4,
        moves: 4,
        distance: 4,
        hadCursor: true,
      });
    },
  );

  it("retains the oldest coalesced input and exposes movement lost between frames", () => {
    const r = recorder(
      '<div class="panel"><div class="pane focused"><button class="row cursor" style="top:0px;height:50px">One</button></div></div>',
    );
    r.start();
    r.down(150);
    r.down(20);
    const row = document.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("Missing fixture cursor");
    row.style.top = "50px";
    r.frame();
    r.frame();
    const result = r.stop();
    expect(result).toMatchObject({ presses: 2, answered: 2, distance: 1, worstLag: 182 });
    expect(
      assessSample(
        { ...result, label: "lost move" },
        { focus: true, presses: 2, distance: 2 },
      ).join(" "),
    ).toContain("1 items traversed, 2 required");
  });

  it("does not silently substitute delivery time for incompatible event clocks", () => {
    const r = recorder(
      '<div class="panel"><div class="pane focused"><button class="row cursor" style="top:0px;height:50px">One</button></div></div>',
    );
    r.start();
    r.down(-1000000);
    const row = document.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("Missing fixture cursor");
    row.style.top = "50px";
    r.frame();
    r.frame();
    const result = r.stop();
    expect(result.inputClockErrors).toBe(1);
    expect(
      assessSample({ ...result, label: "bad clock" }, { focus: true }).join(" "),
    ).toContain("recorder clock");
  });

  it("records poster movement instead of silently omitting VOD input latency", () => {
    const r = recorder(`<div class="vod-host">${posterFixture(1)}</div>`);
    r.start();
    r.down();
    document.querySelector('[role="row"]')?.setAttribute("aria-rowindex", "2");
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ inputP95: 32, answered: 1, distance: 6 });
  });

  it("reads horizontal poster movement from its accessible column", () => {
    const r = recorder(`<div class="vod-host">${posterFixture(8)}</div>`);
    r.start();
    r.down();
    document.querySelector('[role="gridcell"]')?.setAttribute("aria-colindex", "3");
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ answered: 1, distance: 1 });
  });

  it("does not invent poster positions when accessible grid metadata is missing", () => {
    const r = recorder(`<div class="vod-host">${posterFixture(1)}</div>`);
    document.querySelector('[role="grid"]')?.removeAttribute("aria-colcount");
    r.start();
    r.down();
    document.querySelector('[role="row"]')?.setAttribute("aria-rowindex", "2");
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ presses: 1, answered: 0, distance: 0 });
  });

  it("does not let a retained hidden VOD screen steal Live focus measurements", () => {
    const r = recorder(
      `<div class="vod-host"><div class="hidden">${posterFixture(1, "Old film")}</div></div><div class="panel"><div class="pane rail focused"><button class="row cursor" style="top:0px;height:50px">Live</button></div></div>`,
    );
    r.start();
    r.down();
    const row = document.querySelector<HTMLElement>(".row");
    if (!row) throw new Error("Missing active Live cursor");
    row.style.top = "50px";
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ answered: 1, distance: 1 });
  });

  it("finds the visible poster cursor when an earlier screen remains mounted", () => {
    const r = recorder(
      `<div class="vod-host"><div class="hidden">${posterFixture(1, "Old film")}</div>${posterFixture(7, "Episode")}</div>`,
    );
    r.start();
    r.down();
    document
      .querySelector('.vod-host > .poster-grid-region [role="row"]')
      ?.setAttribute("aria-rowindex", "3");
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ answered: 1, distance: 6 });
  });

  it("records VOD category focus without relying on Live inline row geometry", () => {
    const r = recorder(
      '<div class="vod-host"><nav class="vod-rail focused"><button class="vod-category cursor"><span class="vod-category-name">Alpha</span></button><button class="vod-category"><span class="vod-category-name">Beta</span></button></nav></div>',
    );
    r.start();
    r.down();
    const rows = document.querySelectorAll(".vod-category");
    rows[0].classList.remove("cursor");
    rows[1].classList.add("cursor");
    r.frame();
    r.frame();
    expect(r.stop()).toMatchObject({ answered: 1, inputP95: 32 });
  });

  it("keeps a terminal main thread stall and the first measured frame", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    r.frame(80);
    r.advance(200);
    const result = r.stop();
    expect(result.worst).toBe(200);
    expect(result.p95).toBe(200);
    expect(result.rafHz).toBeLessThan(4);
    expect(result.hidden).toBe(false);
    expect(result.elapsed).toBe(280);
  });
});

describe("readiness measurement boundaries", () => {
  it("does not report category rows or channel skeletons as ready channels", () => {
    document.body.innerHTML =
      '<div class="rail"><div class="window"><div class="row">News</div></div></div><div class="list"><div class="skeleton"></div></div>';
    const ready = () => runInNewContext(LAUNCH_MARKS["the channel rows"], { document });
    expect(ready()).toBe(false);
    document
      .querySelector(".list")
      ?.insertAdjacentHTML(
        "beforeend",
        '<div class="window"><div class="row">Live Channel 0001</div></div>',
      );
    expect(ready()).toBe(true);
  });

  it("waits for the committed category instead of retained posters", () => {
    document.body.innerHTML =
      '<div class="vod-host"><div class="vod-screen" data-mode="movie"><div class="vod-rail focused"><div class="vod-category cursor"></div></div><div class="vod-pane" aria-busy="true"><div class="poster-grid"><div class="poster-card"></div></div></div></div></div>';
    const ready = () => runInNewContext(vodCategoryReady("movie"), { document });
    expect(ready()).toBe(false);
    document.querySelector(".vod-pane")?.setAttribute("aria-busy", "false");
    expect(ready()).toBe(true);
  });
});

it("uses native timing without hls.js while preserving controlled prepare and cancellation", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const hls = vi.fn();
  Object.assign(window, { __openiptvNativeTiming: true, Hls: hls });
  runInNewContext(shim, {
    window,
    document,
    performance,
    console,
    setTimeout,
    URL,
    Event: window.Event,
  });
  const av = window.webapis?.avplay;
  const faults = (
    window as unknown as {
      __openiptvTvFaults: {
        reset: () => void;
        useControlledPlayback: () => void;
        completePrepare: () => void;
      };
    }
  ).__openiptvTvFaults;
  if (!av) throw new Error("Missing native timing shim");
  const ready = vi.fn();
  av.open("http://media.example/live.m3u8");
  av.prepareAsync(ready, vi.fn());
  await vi.advanceTimersByTimeAsync(100);
  expect(ready).toHaveBeenCalledTimes(1);
  av.play();
  now = 500;
  expect(av.getCurrentTime()).toBe(500);
  expect(hls).not.toHaveBeenCalled();
  expect(document.querySelector("#tv-video-el[src]")).toBeNull();

  faults.reset();
  faults.useControlledPlayback();
  av.open("http://media.example/controlled.m3u8");
  const manual = vi.fn();
  av.prepareAsync(manual, vi.fn());
  await vi.advanceTimersByTimeAsync(1000);
  expect(manual).not.toHaveBeenCalled();
  faults.completePrepare();
  expect(manual).toHaveBeenCalledTimes(1);

  faults.reset();
  av.open("http://media.example/cancelled.m3u8");
  const cancelled = vi.fn();
  const aborted = vi.fn();
  av.prepareAsync(cancelled, aborted);
  av.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(cancelled).not.toHaveBeenCalled();
  expect(aborted).toHaveBeenCalledWith("PLAYER_ERROR_OPERATION_ABORTED");
});
