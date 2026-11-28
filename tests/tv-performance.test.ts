import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calibrateCpu, cpuControl, CPU_TOLERANCE } from "../scripts/tv/cpu-model.mjs";
import { LAUNCH_MARKS } from "../scripts/tv/launch-marks.mjs";
import {
  assessPhase,
  COLD_CATEGORY_GOALS,
  UI_GOALS,
  vodCategoryReady,
} from "../scripts/tv/performance-goals.mjs";
import { selectPerformanceProfile } from "../scripts/tv/performance-profile.mjs";

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

describe("separate performance references", () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(join(process.cwd(), "scripts/tv", name), "utf8"));

  it("defines hardware assumptions independently of the compatibility engine", () => {
    const floor = read("floor.json");
    const device = read("profile.json");
    expect(selectPerformanceProfile(read, { floor: true })).toEqual(floor);
    const faster = selectPerformanceProfile(read, { reference: true });
    expect(faster.cpuBenchmarkIndex).toBe(528);
    expect(floor.cpuBenchmarkIndex).toBe(132);
    expect(floor.platform).toBe("Tizen 5.5");
    expect(faster.deviceMemoryGB).toBe(1.5);
    expect(faster.jsHeapLimitMB).toBe(160);
    expect(floor.deviceMemoryGB).toBe(1);
    expect(floor.jsHeapLimitMB).toBe(120);
    for (const key of ["cores", "width", "height", "deviceScaleFactor"]) {
      expect(faster[key]).toBe(floor[key]);
    }
    for (const key of ["platform", "chromium", "userAgent"]) {
      expect(faster[key]).toBeUndefined();
    }
    expect(faster.sources.memory).toContain("engineering assumption");
    expect(faster.sources.heap).toContain("independent project");
    expect(faster.cpuApproximation).toContain("not a measured Samsung CPU score");
    expect(selectPerformanceProfile(read)).toEqual(device);
  });

  it("uses the primary performance target by default while keeping a separate floor budget", () => {
    const { scripts } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    for (const name of ["tv", "tv:bench", "tv:quick", "tv:budget"]) {
      expect(scripts[name]).toContain("--reference");
      expect(scripts[name]).not.toContain("--floor");
    }
    expect(scripts["tv:budget:floor"]).toContain("--floor --bench --budget");
    expect(scripts["tv:engines"]).not.toContain("--reference");
  });

  it("rejects ambiguous profile selection", () => {
    expect(() => selectPerformanceProfile(read, { floor: true, reference: true })).toThrow(
      "cannot be combined",
    );
  });

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

  it.each(["--floor", "--reference"])(
    "keeps diagnostic overrides outside the complete %s budget",
    (profile) => {
      for (const override of [
        "--cpu=1",
        "--cpu-score=500",
        "--net=off",
        "--video",
        "--real-logos",
        "--quick",
      ]) {
        const result = spawnSync(
          process.execPath,
          ["scripts/tv/sim.mjs", profile, "--budget", override],
          { encoding: "utf8" },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("--budget requires");
      }
    },
  );
});

describe("host CPU calibration", () => {
  it("matches a target on hosts with different nonlinear slowdown curves", async () => {
    for (const exponent of [0.85, 1.1]) {
      const result = await calibrateCpu(async (rate: number) => 5000 / rate ** exponent, 132);
      expect(result.achievedScore).toBeGreaterThanOrEqual(132 * (1 - CPU_TOLERANCE));
      expect(result.achievedScore).toBeLessThanOrEqual(132 * (1 + CPU_TOLERANCE));
      expect(result.rate).toBeGreaterThan(1);
      expect(result.baselineScore).toBe(5000);
    }
  });

  it("cannot certify a target faster than the host can reach", async () => {
    await expect(calibrateCpu(async () => 100, 264)).rejects.toThrow("cannot make it faster");
  });

  it("rejects a rate that no longer matches the target during verification", async () => {
    const seen = new Map<number, number>();
    await expect(
      calibrateCpu(async (rate: number) => {
        const count = (seen.get(rate) ?? 0) + 1;
        seen.set(rate, count);
        return (5000 / rate) * (rate > 1 && count % 2 === 0 ? 0.5 : 1);
      }, 132),
    ).rejects.toThrow("outside");
  });

  it("does not choose a falsely fast rate from an isolated candidate outlier", async () => {
    const seen = new Set<number>();
    const result = await calibrateCpu(async (rate: number) => {
      const first = rate > 1 && !seen.has(rate);
      seen.add(rate);
      return (5000 / rate) * (first ? 0.6 : 1);
    }, 132);
    expect(result.achievedScore).toBeGreaterThanOrEqual(132 * (1 - CPU_TOLERANCE));
    expect(result.achievedScore).toBeLessThanOrEqual(132 * (1 + CPU_TOLERANCE));
  });

  it("does not accept missing or nonfinite benchmark results", async () => {
    await expect(calibrateCpu(async () => Number.NaN, 132)).rejects.toThrow("Invalid CPU");
    await expect(calibrateCpu(async () => 1000, 0)).rejects.toThrow("positive");
  });

  it("detects a later speed change that could make a simulated TV falsely pass", () => {
    expect(cpuControl([130, 132, 134], 132).matches).toBe(true);
    expect(cpuControl([200, 205, 210], 132).matches).toBe(false);
    expect(cpuControl([80, 85, 90], 132).matches).toBe(false);
    expect(cpuControl([143, 143.5, 144], 132).matches).toBe(false);
    expect(cpuControl([136, 137, 138], 132).matches).toBe(true);
    expect(cpuControl([139, 140, 141], 132).matches).toBe(false);
    expect(cpuControl([174, 175, 176], 178.2).matches).toBe(true);
  });

  it("keeps the achieved CPU separation close to the configured hardware targets", async () => {
    const floor = await calibrateCpu(async (rate: number) => 5000 / rate ** 1.1, 132);
    const reference = await calibrateCpu(async (rate: number) => 5000 / rate ** 1.1, 178.2);
    expect(reference.achievedScore / floor.achievedScore).toBeGreaterThan(1.3);
    expect(reference.achievedScore / floor.achievedScore).toBeLessThan(1.4);
  });
});

type Sample = ReturnType<typeof passingSample>;
function passingSample() {
  return {
    label: "navigation",
    of: 120,
    hidden: false,
    fps: 40,
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

describe("viewer experience goals", () => {
  it("keeps every existing interaction goal unchanged", () => {
    expect(UI_GOALS).toEqual({
      minFps: 30,
      frameP95Ms: 50,
      longestFrameMs: 250,
      stallTimePercent: 10,
      inputP95Ms: 100,
      longestInputMs: 250,
    });
    expect(COLD_CATEGORY_GOALS.readyMs).toBe(2000);
  });

  it("gates only explicit cold category loading on its readiness deadline", () => {
    const sample = { ...passingSample(), stallTimePercent: 11.7, readyMs: 750 };
    expect(assessPhase(sample, { kind: "cold-category" })).toEqual([]);
    expect(assessPhase(sample).join(" ")).toContain("11.7% of time");
    expect(assessPhase({ ...sample, label: "Xtream first category" }).join(" ")).toContain(
      "11.7% of time",
    );
    expect(assessPhase({ ...sample, readyMs: 2000 }, { kind: "cold-category" })).toEqual([]);
    expect(
      assessPhase({ ...sample, readyMs: 2000.01 }, { kind: "cold-category" }).join(" "),
    ).toContain("2000.01ms to committed category readiness");
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "rejects a cold category with an invalid readiness time of %s",
    (readyMs) => {
      expect(
        assessPhase({ ...passingSample(), readyMs }, { kind: "cold-category" }).join(" "),
      ).toContain("invalid readyMs");
    },
  );

  it.each([
    { fps: 29.99 },
    { p95: 50.01 },
    { worst: 250.01 },
    { stallTimePercent: Number.NaN },
    { elapsed: 0 },
    { of: 0 },
    { hidden: true },
  ])("retains cold category frame and sample checks for %j", (metric) => {
    expect(
      assessPhase({ ...passingSample(), readyMs: 750, ...metric }, { kind: "cold-category" })
        .length,
    ).toBeGreaterThan(0);
  });

  it("accepts responsive browsing without requiring desktop frame rates", () => {
    expect(assessPhase(passingSample(), { focus: true })).toEqual([]);
  });

  it("does not let an acceptable average frame rate hide poor frame tails", () => {
    const failures = assessPhase({ ...passingSample(), p95: 90 });
    expect(failures.join(" ")).toContain("frame p95");
  });

  it("uses input p95 rather than allowing a fast median to hide delayed presses", () => {
    const failures = assessPhase(
      { ...passingSample(), lag: 10, inputP95: 180, worstLag: 200 },
      { focus: true },
    );
    expect(failures.join(" ")).toContain("input p95");
  });

  it("compares time spent stalled rather than a count dependent on sample duration", () => {
    expect(assessPhase({ ...passingSample(), stalls: 20, of: 1200 })).toEqual([]);
    expect(assessPhase({ ...passingSample(), stallTimePercent: 30 }).join(" ")).toContain(
      "30% of time",
    );
  });

  it("fails missing frames, invalid metrics and unanswered inputs", () => {
    expect(assessPhase({ ...passingSample(), of: 0 }).length).toBeGreaterThan(0);
    expect(assessPhase({ ...passingSample(), fps: Number.NaN }).length).toBeGreaterThan(0);
    expect(
      assessPhase({ ...passingSample(), answered: 11 }, { focus: true }).join(" "),
    ).toContain("11 of 12");
  });

  it("does not round a failed goal into a pass", () => {
    expect(assessPhase({ ...passingSample(), p95: 50.01 }).join(" ")).toContain("frame p95");
    expect(
      assessPhase({ ...passingSample(), inputP95: -1 }, { focus: true }).join(" "),
    ).toContain("no input");
  });

  it("requires the complete grid walk even when coalesced responses answer every press", () => {
    expect(
      assessPhase(
        { ...passingSample(), distance: 6 },
        { focus: true, presses: 12, distance: 72 },
      ).join(" "),
    ).toContain("6 items traversed, 72 required");
    expect(assessPhase(passingSample(), { focus: true, presses: 12, distance: 72 })).toEqual(
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
      fps: (4 * 1000) / 390,
      p95: 300,
      worst: 300,
      stalls: 1,
      stallTimePercent: (300 * 100) / 390,
    });
  });

  it("caps fast cadence without counting elapsed milliseconds as GPU frames", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    r.frame(5);
    r.frame(5);
    expect(r.stop()).toMatchObject({ fps: 60, of: 2, p95: 5 });
  });

  it("uses nearest rank p95 and keeps precision for gate comparisons", () => {
    const r = recorder("<main>Static view</main>");
    r.start();
    for (let index = 0; index < 19; index++) r.frame(50.01);
    r.frame(240);
    const result = r.stop();
    expect(result.p95).toBeCloseTo(50.01);
    expect(result.worst).toBeCloseTo(240);
    expect(assessPhase({ ...result, label: "precision" }).join(" ")).toContain("frame p95");
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

  it("includes queued input and a presentation boundary in the response estimate", () => {
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
      assessPhase(
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
    expect(assessPhase({ ...result, label: "bad clock" }, { focus: true }).join(" ")).toContain(
      "recorder clock",
    );
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
    expect(result.fps).toBeLessThan(4);
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
