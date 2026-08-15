#!/usr/bin/env node
/**
 * Measure the application on the television, rather than on a simulation of one.
 *
 *   npm run tv:on-set
 *   npm run tv:on-set -- --stream=https://example.com/channel.m3u8
 *   npm run tv:on-set -- --tv=192.168.1.100 --seconds=20
 *
 * Everything else in scripts/tv/ measures a laptop pretending to be a set. This attaches to
 * the real one over sdb, drives it through the web inspector, and reports what the app costs
 * there: the launch marks, the interface at rest, and, if given a stream, what the player
 * costs while a picture is on screen.
 *
 * It exists because the simulator cannot answer three questions and never will. Its picture is
 * always hls.js, so every playback number it prints is from the wrong engine. Its CPU is a
 * clock divider on one thread, not silicon. And its AVPlay is a shim that agrees with whatever
 * the app asks of it, where the real one has opinions: it refuses blob: and data: URLs, it
 * cannot read a local playlist, and it keeps EXT-X-MEDIA-SEQUENCE in a signed 32 bit integer,
 * which is a firmware bug this harness found in an evening after months of not looking.
 *
 * Nothing here is a gate. It needs a television on the network in developer mode, so it cannot
 * run in CI and must not block anything. Read it before a release, and after any change to the
 * player or the launch path.
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { connect, arg } from "./cdp.mjs";
import { LAUNCH_MARKS, LAUNCH_DEADLINE_MS, launchWatcher } from "./launch-marks.mjs";

const APP = "5mzc7dQsGK.OpenIPTV";
const SECONDS = Number(arg("seconds") ?? 10);
const STREAM = arg("stream");
/** Where a sideloaded widget lives, which is the URL a relaunch navigates to. */
const APP_URL = "file:///index.html";
/** The ceiling AVPlay's media sequence parser overflows at, for the manifest report below. */
const SIGNED_32_BIT = 2_147_483_647;

const sdbPath = () => arg("sdb") ?? [
  join(process.env.HOME, "tizen-studio/tools/sdb"),
  join(process.env.HOME, ".tizen-extension-platform/server/sdktools/data/tools/sdb"),
].find(existsSync);

const SDB = sdbPath();
if (!SDB) {
  console.error("No sdb found. Install Tizen Studio, or pass --sdb=/path/to/sdb.");
  process.exit(1);
}

/*
 * stderr is swallowed on purpose. `forward --remove` complains when there is nothing to remove,
 * which is the ordinary case on a first run, and a harness that opens with an error nobody
 * needs to read teaches people to ignore its output.
 */
const sdb = (...args) =>
  execFileSync(SDB, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * Which television, as sdb names it.
 *
 * The serial is not optional on the calls below, and this is the first thing that cost an
 * evening: `sdb shell 0 debug <app>` answers "closed" when it has to guess the device, even
 * with exactly one paired, and says nothing about why.
 */
const wanted = arg("tv");
const devices = sdb("devices").split("\n").slice(1)
  .map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
const serial = wanted ? devices.find((d) => d.startsWith(wanted)) : devices[0];
if (!serial) {
  console.error(devices.length
    ? `No device matching --tv=${wanted}. Paired: ${devices.join(", ")}`
    : "No television paired. Enable developer mode, enter this machine's IP, restart the set,\n"
      + "then: sdb connect <tv-ip>:26101");
  process.exit(1);
}

/**
 * Restart the app with the inspector on, and take the port it prints.
 *
 * Two things here are not obvious and both wasted time. The app has to be killed first or the
 * debug request is refused. And the command does not exit: it holds the debug session open for
 * as long as it runs, so waiting for it to finish waits for ever. It is spawned, and the port
 * is read off its output.
 */
async function attach() {
  try { sdb("-s", serial, "shell", "0", "was_kill", APP); } catch { /* not running */ }
  await new Promise((r) => setTimeout(r, 2000));

  const session = spawn(SDB, ["-s", serial, "shell", "0", "debug", APP]);
  process.on("exit", () => { try { session.kill(); } catch { /* gone */ } });

  const port = await new Promise((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(
      () => reject(new Error(`No inspector port. The set said: ${seen.trim() || "nothing"}`)),
      20000,
    );
    session.stdout.on("data", (chunk) => {
      seen += chunk;
      const hit = seen.match(/port:\s*(\d+)/);
      if (!hit) return;
      clearTimeout(timer);
      resolve(hit[1]);
    });
  });

  try { sdb("-s", serial, "forward", "--remove", `tcp:${port}`); } catch { /* none yet */ }
  sdb("-s", serial, "forward", `tcp:${port}`, `tcp:${port}`);
  await new Promise((r) => setTimeout(r, 3000));

  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page");
  if (!page) throw new Error(`Inspector on ${port} has no page: ${JSON.stringify(pages)}`);
  return { cdp: await connect(page.webSocketDebuggerUrl), port, session };
}

/**
 * Put the set back the way it was found.
 *
 * A debug launch is not how anybody watches television: it leaves the inspector listening and
 * the app running under it. Every path out of here goes through this.
 */
function restore(session) {
  try { session?.kill(); } catch { /* gone */ }
  try { sdb("-s", serial, "shell", "0", "was_kill", APP); } catch { /* not running */ }
  try { sdb("-s", serial, "shell", "0", "was_execute", APP); } catch { /* say nothing */ }
}

const { cdp, session } = await attach();
await cdp.send("Runtime.enable");
await cdp.send("Performance.enable");

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (exceptionDetails) return `threw: ${exceptionDetails.text}`;
  return result.value;
};

const metrics = async () => {
  const { metrics: all } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(all.map((m) => [m.name, m.value]));
};

// ---- what the set is ------------------------------------------------------------------
const facts = JSON.parse(await evaluate(`JSON.stringify({
  ua: navigator.userAgent,
  cores: navigator.hardwareConcurrency,
  memoryGB: navigator.deviceMemory || null,
  heapMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
  screen: screen.width + "x" + screen.height,
  avplay: !!(window.webapis && window.webapis.avplay),
})`));
const tizen = /Tizen (\d+\.\d+)/.exec(facts.ua)?.[1] ?? "?";
const chromium = /Chrome\/(\d+)/.exec(facts.ua)?.[1] ?? /\) (\d+)\./.exec(facts.ua)?.[1] ?? "?";
console.log(`  ${serial}   Tizen ${tizen}, Chromium ${chromium}, ${facts.cores} cores, `
  + `${facts.memoryGB ?? "?"}GB, ${facts.heapMB ?? "?"}MB heap, ${facts.screen}`
  + `${facts.avplay ? "" : ", NO AVPLAY"}`);
console.log("  Not comparable with the simulator's numbers: different engine, different silicon.");

/**
 * Frame times, counted in the page, because a busy main thread is what a viewer feels.
 *
 * Reading them from here would measure the round trip instead. Sixty of these a second is what
 * a healthy set looks like, so `median 17` is the answer, not a suspiciously round number.
 */
const WATCH = `(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (now) => { window.__frames.push(now - last); last = now; window.__raf = requestAnimationFrame(tick); };
  window.__raf = requestAnimationFrame(tick);
  return "watching";
})()`;

const READ_FRAMES = `(() => {
  cancelAnimationFrame(window.__raf);
  const f = window.__frames.slice(1);
  if (!f.length) return JSON.stringify({ frames: 0 });
  const sorted = [...f].sort((a, b) => a - b);
  return JSON.stringify({
    frames: f.length,
    median: Math.round(sorted[Math.floor(sorted.length / 2)]),
    worst: Math.round(sorted[sorted.length - 1]),
    over100: f.filter((x) => x > 100).length,
  });
})()`;

/**
 * One phase: settle, then measure a window of wall clock.
 *
 * ProcessTime is the renderer's CPU and ThreadTime is its main thread. Both are the
 * application's own cost and neither includes AVPlay, which decodes in silicon in another
 * process. That asymmetry is the measurement: a hardware picture is nearly free to this
 * process and a software one is not.
 */
async function phase(label, seconds) {
  await evaluate(WATCH);
  const before = await metrics();
  const at = Date.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const after = await metrics();
  const wall = (Date.now() - at) / 1000;
  const frames = JSON.parse(await evaluate(READ_FRAMES));

  const share = (key) => ((after[key] - before[key]) / wall) * 100;
  console.log(`\n  ${label}`);
  console.log(`    process CPU   ${share("ProcessTime").toFixed(0)}% of one core`);
  console.log(`    main thread   ${share("ThreadTime").toFixed(0)}%, `
    + `script ${share("ScriptDuration").toFixed(0)}%, layout ${share("LayoutDuration").toFixed(0)}%`);
  console.log(frames.frames
    ? `    frames        ${frames.frames} in ${wall.toFixed(0)}s, median ${frames.median}ms, `
      + `worst ${frames.worst}ms, ${frames.over100} over 100ms`
    : "    frames        none, so nothing was drawn and nothing here is measurable");
  console.log(`    heap          ${Math.round((after.JSHeapUsedSize ?? 0) / 1048576)}MB`);
}

// ---- the launch, on the real thing ----------------------------------------------------
console.log("\n  launch, on a relaunch with the playlist already cached");
await cdp.send("Page.enable");
await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: launchWatcher() });
/*
 * Via about:blank, which the simulator learned the hard way: navigating from the app straight
 * back to the app compiles the new page on the thread that is tearing down the old one, and the
 * old one is holding a playlist. It put 2585ms on a mark that reads 1192ms once it has gone.
 */
await cdp.send("Page.navigate", { url: "about:blank" });
await new Promise((r) => setTimeout(r, 1500));
await cdp.send("Page.navigate", { url: APP_URL });

const deadline = Date.now() + LAUNCH_DEADLINE_MS;
let marks = {};
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 250));
  const state = await evaluate("JSON.stringify(window.__launch || null)");
  if (typeof state !== "string" || state === "null") continue;   // still navigating
  const parsed = JSON.parse(state);
  marks = parsed.marks;
  if (parsed.done) break;
}
for (const label of Object.keys(LAUNCH_MARKS)) {
  const at = marks[label];
  console.log(`    ${label.padEnd(20)}${String(at ?? "never").padStart(7)}${at ? "ms" : ""}`);
}
/*
 * Two caveats, printed rather than left in a comment nobody reads.
 *
 * Marks sharing a number are not a broken harness: the watcher looks once per frame, so
 * anything that happens inside one frame lands on one timestamp, and on a set this fast with a
 * small cached playlist most of the interface does. And a relaunch keeps V8's code cache, so
 * "the bundle ran" is the compile cost of a warm start rather than of switching the set on,
 * which nothing here can measure: the inspector only exists once the app is already up.
 */
const shared = Object.values(marks).filter((v, i, all) => all.indexOf(v) !== i).length;
if (shared) console.log("    (marks sharing a value happened within one frame of each other)");
console.log("    (a relaunch, so the bundle was compiled from a warm code cache)");

// ---- the interface, with nothing playing ----------------------------------------------
/*
 * Stop whatever resumed, or "at rest" is a lie.
 *
 * The app comes back on the last channel, so the first measurement of an idle interface was
 * quietly measuring a stream starting, and on a channel this set cannot play it was measuring
 * the retry loop: 32% of a core against the 8% an idle app actually costs. STOP is the key that
 * clears the tuner, and it is sent as a key event rather than called, so the app takes the same
 * path a viewer would.
 */
await evaluate(`(() => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "keyCode", { get: () => 413 });
  window.dispatchEvent(e);
  return "stopped";
})()`);
await new Promise((r) => setTimeout(r, 2000));
await phase("at rest, nothing playing", SECONDS);

// ---- the player, if there is something to play ----------------------------------------
if (!STREAM) {
  console.log("\n  No --stream given, so the player was not measured. Pass one to compare what");
  console.log("  a picture costs: --stream=https://example.com/channel.m3u8");
} else {
  /*
   * What the manifest is, before asking the player to read it.
   *
   * The page fetches it, not this process, because a widget is not subject to CORS and the
   * answer should be the one the app would get. The sequence number is the interesting field:
   * above 2^31 the set's parser overflows and reports the whole stream as one segment,
   * whatever else is right with it.
   */
  const report = JSON.parse(await evaluate(`(async () => {
    try {
      const text = await (await fetch(${JSON.stringify(STREAM)})).text();
      const line = text.split("\\n").find((l) => l.indexOf("#EXT-X-MEDIA-SEQUENCE:") === 0);
      return JSON.stringify({
        bytes: text.length,
        segments: (text.match(/#EXTINF/g) || []).length,
        variants: (text.match(/#EXT-X-STREAM-INF/g) || []).length,
        sequence: line ? Number(line.slice(22)) : null,
      });
    } catch (e) { return JSON.stringify({ error: e.name + ": " + e.message }); }
  })()`));

  console.log("\n  the manifest");
  if (report.error) console.log(`    could not be read: ${report.error}`);
  else {
    console.log(`    ${report.bytes} bytes, ${report.segments} segments, `
      + `${report.variants} variants listed`);
    console.log(`    media sequence ${report.sequence ?? "absent"}`
      + (report.sequence > SIGNED_32_BIT
        ? `  OVER 2^31, so AVPlay cannot play this: it will show one frame and stall`
        : ""));
  }

  const started = await evaluate(`(() => {
    const av = webapis.avplay;
    const t0 = performance.now();
    try { if (av.getState() !== "NONE" && av.getState() !== "IDLE") av.stop(); } catch (e) {}
    try {
      av.open(${JSON.stringify(STREAM)});
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setStreamingProperty("ADAPTIVE_INFO", "STARTBITRATE=LOWEST");
      av.setListener({ onerror: (code) => { window.__avError = String(code); } });
      return new Promise((res) => {
        av.prepareAsync(
          () => { av.play(); res("ready in " + Math.round(performance.now() - t0) + "ms"); },
          (e) => res("refused: " + ((e && e.name) || e)),
        );
        setTimeout(() => res("no answer in 25s"), 25000);
      });
    } catch (e) { return "threw on open: " + ((e && e.name) || e); }
  })()`);
  console.log(`\n  the player: ${started}`);

  await new Promise((r) => setTimeout(r, 4000));
  const before = await evaluate("webapis.avplay.getCurrentTime()");
  await phase(`playing, via AVPlay`, SECONDS);
  const after = await evaluate("webapis.avplay.getCurrentTime()");
  const window_ = await evaluate(
    `(() => { try { return String(webapis.avplay.getStreamingProperty("GET_LIVE_DURATION")); } catch (e) { return "-"; } })()`,
  );
  const moved = Number(after) - Number(before);
  /*
   * The playhead is the only honest answer to "is it playing". State says PLAYING for a stream
   * that has frozen, and the app's own stall watchdog is built on exactly this comparison.
   */
  console.log(`    playhead      moved ${moved}ms in ${SECONDS}s `
    + `-> ${moved > SECONDS * 800 ? "playing" : "STALLED, the picture is not moving"}`);
  console.log(`    live window   ${window_}`);
  const fault = await evaluate("window.__avError || ''");
  if (fault) console.log(`    engine said   ${fault}`);
  await evaluate(`(() => { try { webapis.avplay.stop(); } catch (e) {} return 1; })()`);
}

cdp.close();
restore(session);
console.log("\n  The set has been relaunched normally, without the inspector.");
process.exit(0);
