import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { XTREAM_FIXTURE } from "../present.mjs";
import { arg, connect, has } from "./cdp.mjs";
import { diagnosticOptions, vodCategoryReady } from "./diagnostics.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
diagnosticOptions({ has, arg });
const output = mkdtempSync(join(resolve(arg("output") ?? tmpdir()), "openiptv-vod-profile-"));
const logPath = join(output, "environment.log");
const log = openSync(logPath, "wx");
const port = Number(arg("port") ?? 9433);
const moves = Number(arg("moves") ?? 12);
const categories = [
  "toplevel",
  "devtools.timeline",
  "blink.user_timing",
  "v8",
  ...(arg("invalidations") === "true"
    ? ["disabled-by-default-devtools.timeline.invalidationTracking"]
    : []),
].join(",");
const capture = arg("capture") !== "false";
if (!Number.isInteger(moves) || moves < 1) {
  throw new Error("--moves must be a positive integer.");
}
const forwarded = ["url", "cpu", "chrome"]
  .filter((name) => arg(name) !== undefined)
  .map((name) => `--${name}=${arg(name)}`);
const child = spawn(
  process.execPath,
  [join(here, "sim.mjs"), "--profile", "--headless", `--port=${port}`, ...forwarded],
  { cwd: root, stdio: ["ignore", log, log] },
);
closeSync(log);
const exited = once(child, "exit");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let cdp;
const cleanup = () => {
  cdp?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGINT");
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  let fixtureOrigin;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && child.exitCode === null) {
    const match = readFileSync(logPath, "utf8").match(/served to the app at (http\S+)/);
    if (match) {
      fixtureOrigin = new URL(match[1]).origin;
      break;
    }
    await sleep(100);
  }
  if (!fixtureOrigin) throw new Error(`The profile environment did not start. See ${logPath}`);
  cdp = await connect(port);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  if (capture) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  }
  const evaluate = async (expression) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result?.value;
  };
  const waitFor = async (expression) => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        if (!/context|navigat/i.test(error.message)) throw error;
      }
      await sleep(100);
    }
    throw new Error(`The profiling surface did not arrive: ${expression}`);
  };
  await waitFor("location.protocol === 'http:' && !!window.__openiptvTvFaults");
  await evaluate('sessionStorage.setItem("sim.xtreamJourney", "1")');
  const settings = {
    playlists: [
      {
        id: "sim-xtream",
        name: "Xtream fixture",
        source: {
          kind: "xtream",
          server: fixtureOrigin,
          username: XTREAM_FIXTURE.username,
          password: XTREAM_FIXTURE.password,
          output: "m3u8",
        },
        sourceVersion: 2,
        hiddenCategories: [],
        hiddenCategoryMode: "exclude",
      },
    ],
    activePlaylistId: "sim-xtream",
    resumeLast: true,
    panelTimeout: 0,
    showClock: false,
  };
  const personal = {
    favourites: [],
    lastPlayed: {
      playlistId: "sim-xtream",
      kind: "live",
      itemKey: "xtream:sim-xtream:live:live-1",
      categoryKey: "live:live-large",
    },
    progress: [],
  };
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (location.protocol === "http:") {
      localStorage.setItem("openiptv.settings", ${JSON.stringify(JSON.stringify(settings))});
      localStorage.setItem("openiptv.personal", ${JSON.stringify(JSON.stringify(personal))});
      localStorage.removeItem("openiptv.last");
      localStorage.removeItem("app:last-mode:sim-xtream");
    }`,
  });
  if (arg("commits") === "true") {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__vodCommits = [];
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          supportsFiber: true,
          inject: () => 1,
          onCommitFiberRoot: (_, root) => {
            const app = root.current.child?.child;
            if (!app) return;
            const changes = [];
            let current = app.memoizedState;
            let previous = app.alternate?.memoizedState;
            let index = 0;
            while (current && previous) {
              if (current.queue && !Object.is(current.memoizedState, previous.memoizedState)) {
                const value = current.memoizedState;
                changes.push({
                  index,
                  value: value && typeof value === "object"
                    ? Object.keys(value).slice(0, 8)
                    : typeof value === "string" ? { length: value.length } : value,
                });
              }
              current = current.next;
              previous = previous.next;
              index += 1;
            }
            const components = [];
            const pending = [root.current];
            while (pending.length) {
              const fiber = pending.pop();
              if (fiber.sibling) pending.push(fiber.sibling);
              if (fiber.child) pending.push(fiber.child);
              if (fiber.tag !== 0 && fiber.tag !== 11 && fiber.tag !== 15) continue;
              const className = fiber.child?.memoizedProps?.className;
              if (typeof className !== "string" ||
                !(className.startsWith("vod-screen") ||
                  className.startsWith("poster-grid-region") ||
                  className === "poster-grid-cell")) continue;
              const stateChanges = [];
              let hook = fiber.memoizedState;
              let oldHook = fiber.alternate?.memoizedState;
              let hookIndex = 0;
              while (hook && oldHook) {
                if (hook.queue && !Object.is(hook.memoizedState, oldHook.memoizedState)) {
                  const value = hook.memoizedState;
                  stateChanges.push({
                    index: hookIndex,
                    value: value && typeof value === "object"
                      ? "selectedItemIndex" in value
                        ? { zone: value.zone, cursor: value.selectedItemIndex,
                            firstRow: value.memories[value.mode].firstRow }
                        : Object.keys(value).slice(0, 8)
                      : typeof value === "string" ? { length: value.length } : value,
                  });
                }
                hook = hook.next;
                oldHook = oldHook.next;
                hookIndex += 1;
              }
              components.push({
                name: className.split(" ")[0],
                rendered: !!(fiber.flags & 1),
                stateChanges,
                props: Object.keys(fiber.memoizedProps).filter(key =>
                  !Object.is(fiber.memoizedProps[key], fiber.alternate?.memoizedProps[key])),
              });
            }
            window.__vodCommits.push({
              at: performance.now(),
              appRendered: !!(app.flags & 1),
              changes,
              components,
              cursor: document.querySelector(".poster-card.cursor")?.dataset.posterIndex,
            });
          },
        };
      })()`,
    });
  }
  if (arg("native") === "true") {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__vodNativeCalls = [];
        window.__vodProbeBitmaps = [];
        const wrap = (owner, name) => {
          const original = owner[name];
          owner[name] = function(...args) {
            const began = performance.now();
            try {
              const result = Reflect.apply(original, this, args);
              if (name === "createImageBitmap") {
                result.then(bitmap => {
                  if (bitmap.width !== 192 || bitmap.height !== 288) return;
                  window.__vodProbeBitmaps.push(bitmap);
                  if (window.__vodProbeBitmaps.length > 8) window.__vodProbeBitmaps.shift();
                }, () => {});
              }
              return result;
            } finally {
              window.__vodNativeCalls.push({
                name, began, ended: performance.now(),
                source: args[0]?.constructor?.name,
                width: args[0]?.width, height: args[0]?.height,
                bytes: args[0]?.size, args: args.slice(1),
                canvasWidth: this.canvas?.width ?? this.width,
                canvasHeight: this.canvas?.height ?? this.height,
              });
            }
          };
        };
        wrap(window, "createImageBitmap");
        wrap(HTMLCanvasElement.prototype, "getContext");
        wrap(CanvasRenderingContext2D.prototype, "drawImage");
        wrap(CanvasRenderingContext2D.prototype, "getImageData");
      })()`,
    });
  }
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(
    "document.querySelector('.list .row-label')?.textContent === 'Live Channel 0001'",
  );
  await sleep(3000);
  await evaluate(
    `${readFileSync(join(here, "bench.js"), "utf8")}\n//# sourceURL=openiptv-tv-recorder.js`,
  );
  const environment = await evaluate(`({
    simulation: window.__tvSimulation,
    url: location.href,
    scripts: Array.from(document.scripts, script => script.src).filter(Boolean),
    nativeTiming: window.__openiptvNativeTiming === true,
    browserHlsLoaded: typeof window.Hls !== "undefined",
    hostHints: { cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory },
    viewport: { width: innerWidth, height: innerHeight }
  })`);
  if (
    !environment.nativeTiming ||
    environment.browserHlsLoaded ||
    environment.viewport.width !== 1920 ||
    environment.viewport.height !== 1080 ||
    environment.simulation?.environment !== "desktop-diagnostic"
  ) {
    throw new Error("The profiler did not reach the intended desktop API fixture.");
  }
  const events = [];
  cdp.on("Tracing.dataCollected", ({ value }) => events.push(...value));
  let traceCompletion;
  const tracingComplete = new Promise((done) =>
    cdp.on("Tracing.tracingComplete", (result) => {
      traceCompletion = result;
      done();
    }),
  );
  if (capture)
    await Promise.all([cdp.send("Profiler.start"), cdp.send("Tracing.start", { categories })]);
  const key = async (code, name) => {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
        key: name,
        code: name,
      });
    }
  };
  const finishPhase = async (name) => {
    await sleep(600);
    await evaluate(`new Promise(done => {
      const timer = setTimeout(done, 1000);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        done();
      }));
    })`);
    return evaluate(`(() => {
      const result = window.__bench.stop();
      performance.mark(${JSON.stringify(`vod-${name}-end`)});
      return result;
    })()`);
  };
  const phases = {};
  let failure;
  try {
    await evaluate(`window.__bench.start({ capture: true });
    performance.mark("vod-category-start");
    const movies = document.querySelector('[data-navigation-action="movie"]');
    if (!movies) throw new Error('Movies navigation was not found');
    movies.click(); true`);
    await waitFor(vodCategoryReady("movie"));
    await evaluate("window.__bench.markReady()");
    phases.category = await finishPhase("category");
    await key(39, "ArrowRight");
    await waitFor("!!document.querySelector('.poster-grid-region.focused')");
    await sleep(3000);
    await evaluate(
      'window.__bench.start({ capture: true }); performance.mark("vod-grid-start"); true',
    );
    for (let index = 0; index < moves; index++) {
      await key(40, "ArrowDown");
      await sleep(100);
    }
    phases.grid = await finishPhase("grid");
    if (arg("details") === "true") {
      await evaluate(
        'window.__bench.start({ capture: true }); performance.mark("vod-details-start"); true',
      );
      await key(13, "Enter");
      await waitFor("!!document.querySelector('.vod-details .vod-title-row')");
      phases.details = await finishPhase("details");
    }
  } catch (error) {
    failure = error;
  }
  let profile;
  if (capture) {
    [{ profile }] = await Promise.all([cdp.send("Profiler.stop"), cdp.send("Tracing.end")]);
    let timer;
    try {
      await Promise.race([
        tracingComplete,
        new Promise((_, fail) => {
          timer = setTimeout(
            () => fail(new Error("The rendering trace did not finish.")),
            10000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    writeFileSync(join(output, "cpu.cpuprofile"), JSON.stringify(profile), { flag: "wx" });
    writeFileSync(
      join(output, "rendering.trace.json"),
      JSON.stringify({ traceEvents: events }),
      {
        flag: "wx",
      },
    );
  }
  const marker = events.find((event) => event.name === "vod-category-start");
  if (arg("commits") === "true") {
    writeFileSync(
      join(output, "commits.json"),
      JSON.stringify(
        await evaluate(`({
          commits: window.__vodCommits,
          marks: performance.getEntriesByType("mark").map(({ name, startTime }) => ({
            name, at: startTime
          }))
        })`),
      ),
      { flag: "wx" },
    );
  }
  if (arg("native") === "true") {
    await evaluate(`(async () => {
      const bitmap = window.__vodProbeBitmaps.find(bitmap => bitmap.width);
      if (bitmap) (await createImageBitmap(bitmap)).close();
      return true;
    })()`);
    writeFileSync(
      join(output, "native-calls.json"),
      JSON.stringify(await evaluate("window.__vodNativeCalls")),
      { flag: "wx" },
    );
  }
  if (arg("screenshot") === "true") {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, "grid.png"), Buffer.from(data, "base64"), { flag: "wx" });
  }
  const network = await evaluate(`new Promise(resolve => {
    window.__tvNetworkDone = resolve;
    window.__tvMeasurementNetworkSnapshot("");
  })`);
  writeFileSync(
    join(output, "measurements.json"),
    JSON.stringify({
      environment,
      moves,
      gapMs: 100,
      settlingTailMs: 600,
      samplingIntervalUs: 1000,
      capture,
      categories,
      network,
      backwardCpuDeltas: profile?.timeDeltas.filter((delta) => delta < 0).length ?? 0,
      renderer: marker ? { pid: marker.pid, tid: marker.tid } : null,
      traceCompletion,
      phases,
      error: failure?.message,
    }),
    { flag: "wx" },
  );
  console.log(
    capture
      ? "These desktop timings include profiler overhead and give no TV performance verdict."
      : "These desktop timings give no TV performance verdict.",
  );
  console.table(
    Object.entries(phases).map(([phase, result]) => ({
      phase,
      rafHz: +result.rafHz.toFixed(1),
      callbackGapP95Ms: +result.p95.toFixed(1),
      maxCallbackGapMs: +result.worst.toFixed(1),
      domResponseP95Ms: result.inputP95 === null ? null : +result.inputP95.toFixed(1),
      maxDomResponseMs: result.worstLag === null ? null : +result.worstLag.toFixed(1),
      answered: `${result.answered}/${result.presses}`,
      distance: result.distance,
    })),
  );
  console.log(`Artifacts: ${output}`);
  console.log("rAF callbacks and DOM observations do not prove paint or frame presentation.");
  if (capture) {
    console.log("Use the marked renderer thread and phase boundaries for trace attribution.");
    console.log(
      "CPU samples are stack observations, not CPU utilization. (program) is not application JavaScript.",
    );
    console.log(
      "Trace durations are wall time under throttling. Do not add nested inclusive durations.",
    );
    if (profile.timeDeltas.some((delta) => delta < 0)) {
      console.log(
        "CPU deltas include backward timestamps. Reconstruct absolute sample times and sort " +
          "before attribution. Do not sum raw deltas as function costs.",
      );
    }
  }
  if (failure) throw failure;
  if (!network?.isolated || !network.active || network.violations.length) {
    throw new Error(`Network isolation failed. See ${output}/measurements.json`);
  }
  if (
    (capture &&
      (!marker ||
        traceCompletion?.dataLossOccurred ||
        !profile.samples?.length ||
        profile.samples.length !== profile.timeDeltas?.length ||
        !events.some((event) => event.name === "vod-category-end") ||
        !events.some((event) => event.name === "vod-grid-start") ||
        !events.some((event) => event.name === "vod-grid-end"))) ||
    Object.values(phases).some((result) => !result.of || result.hidden) ||
    phases.grid?.presses !== moves ||
    phases.grid?.answered !== moves ||
    phases.grid?.distance !== moves * 6 ||
    phases.grid?.inputClockErrors
  ) {
    throw new Error(
      `The profile is incomplete or did not walk ${moves} grid rows. See ${output}`,
    );
  }
} finally {
  cleanup();
  await exited;
}
