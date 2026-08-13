#!/usr/bin/env node
/**
 * Run the app under the TV's constraints, on a laptop.
 *
 * Samsung ships an x86 emulator that needs HAXM, which does not exist on Apple silicon,
 * and their simulator is a plain WebKit shell that tells you nothing about performance.
 * Neither is usable here. This is the alternative: ordinary Chrome, held down to the
 * measurements taken off the actual set over sdb.
 *
 * What it reproduces, and does not:
 *
 *   CPU        throttled by a factor measured against the real TV, see calibrate.mjs
 *   memory     V8's old space capped to the set's real JS heap limit
 *   screen     1920x1080 at a device pixel ratio of 1
 *   engine     the TV's user agent, and ideally its Chromium version, see --chrome
 *   platform   webapis.avplay and tizen shimmed, so the Tizen code paths actually run
 *
 *   GPU        not reproduced. A laptop GPU is far quicker than a TV's, so anything
 *              compositing bound will look better here than it really is.
 *   decoder    not reproduced. There is no hardware video plane, so the simulator draws
 *              a placeholder where the picture would be.
 *
 * Usage:
 *   node scripts/tv/sim.mjs                     app under TV constraints
 *   node scripts/tv/sim.mjs --cpu=1             same layout and engine, full speed
 *   node scripts/tv/sim.mjs --net=3g            add a slow network
 *   node scripts/tv/sim.mjs --bench             measure frame times and exit
 *   node scripts/tv/sim.mjs --url=http://...    somewhere other than the preview server
 *   node scripts/tv/sim.mjs --playlist=http://... start with a playlist already added
 *   node scripts/tv/sim.mjs --harsh            half the TV's hardware, on every axis
 *   node scripts/tv/sim.mjs --floor           the weakest set Samsung sells, not yours
 *   node scripts/tv/sim.mjs --harsh=4          a quarter of it
 *   node scripts/tv/sim.mjs --harsh --software no GPU either, so paint cost shows up
 *   node scripts/tv/sim.mjs --video           real playback, at the cost of the Tizen paths
 *   node scripts/tv/sim.mjs --net=off         no network throttling, even in harsh mode
 */
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, arch } from "node:os";
import { connect, findChrome, arg, has, factor } from "./cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, name), "utf8"));
const reference = read("profile.json");
const shim = readFileSync(join(here, "shim.js"), "utf8");

/**
 * Which television to be.
 *
 * The reference is the set in the room, read off it over sdb. The floor is the weakest
 * thing Samsung has sold since 2020, built from the minimum hardware they publish in their
 * own security filings, and it is the one worth developing against: a flagship has enough
 * headroom to hide almost any mistake.
 *
 * The floor's speed is expressed as a multiple of the reference rather than as its own
 * number, so calibrating against the real set moves both.
 */
/**
 * The app's own hls.js, lent to the shim.
 *
 * The shim carries out AVPlay's calls for real, and it needs a player to do it with. Taken
 * from node_modules rather than a CDN so it works offline and is the same version the app
 * ships, which matters when a stream misbehaves and the question is whether the app or the
 * engine is at fault.
 */
const enginePath = join(here, "..", "..", "node_modules", "hls.js", "dist", "hls.min.js");
const engine = existsSync(enginePath) ? readFileSync(enginePath, "utf8") : null;

const floor = has("floor");
const profile = floor
  ? { ...read("floor.json"), cpuThrottle: reference.cpuThrottle * read("floor.json").slowerThanReference }
  : reference;

/**
 * Find the app.
 *
 * The dev server is the right answer while working and the wrong one while measuring: a
 * development build of React validates every element it creates, and that alone came to
 * half the main thread in a profile, drowning out anything the app itself was doing. So
 * measurement prefers the preview server, and says so loudly if it cannot find one.
 */
const DEV = "http://localhost:5173/";
const PREVIEW = "http://localhost:4173/";
const measuring = has("bench") || has("profile");

const alive = async (candidate) => {
  try {
    return (await fetch(candidate, { signal: AbortSignal.timeout(700) })).ok;
  } catch {
    return false;
  }
};

async function findApp() {
  const explicit = arg("url");
  if (explicit) return explicit;
  for (const candidate of measuring ? [PREVIEW, DEV] : [DEV, PREVIEW]) {
    if (await alive(candidate)) return candidate;
  }
  return null;
}

const root = join(here, "..", "..");
const dist = join(root, "dist");
const children = [];

/** Anything started here dies with this process, however it ends. */
const spawnChild = (command, args) => {
  const proc = spawn(command, args, { cwd: root, stdio: "ignore", shell: false });
  children.push(proc);
  return proc;
};
const killChildren = () => children.forEach((c) => { try { c.kill(); } catch { /* gone */ } });
process.on("exit", killChildren);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));

let url = await findApp();

/**
 * Serve the app if nothing already is.
 *
 * Always the built output, never the dev server, even when working rather than measuring.
 * A development build of React validates every element it creates, which came to half the
 * main thread in a profile, and on a profile as slow as the floor that noise is most of what
 * you would be looking at.
 */
if (!url && existsSync(join(dist, "index.html"))) {
  spawnChild("npx", ["vite", "preview", "--port", "4173", "--strictPort"]);
  for (let i = 0; i < 40 && !url; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await alive(PREVIEW)) url = PREVIEW;
  }
}

if (!url) {
  console.error(
    "Nothing is serving the app, and there is no build to serve.\n\n" +
    "  npm run build     then try again\n",
  );
  process.exit(1);
}
if (measuring && url === DEV) {
  console.error(
    "\nRefusing to measure the dev server.\n\n" +
    "React validates every element in a development build, which came to half the main\n" +
    "thread last time and tells you nothing about the app. Build first:\n\n" +
    "  npm run build && npm run preview\n",
  );
  process.exit(1);
}
/**
 * Harsh mode: divide the set's hardware by a factor and see whether the app still holds up.
 *
 * The point is headroom. If it stays fluid on half a TV then the real one is not close to
 * its limits, and the reading stops being hostage to a CPU throttle that is still only an
 * estimate. Every axis is squeezed together, because starving one while leaving the others
 * alone just moves the bottleneck somewhere unrealistic.
 */
const harsh = factor("harsh", 2);
const cpu = Number(arg("cpu") ?? profile.cpuThrottle) * harsh;
const heapMB = Math.max(32, Math.round(profile.jsHeapLimitMB / harsh));
const cores = Math.max(1, Math.round(profile.cores / harsh));
const memoryGB = Math.max(0.25, profile.deviceMemoryGB / harsh);
const netArg = arg("net");

/**
 * Whether to shim the TV's player.
 *
 * With the shim, every Tizen path runs: the transparent page, the hole punch surface, the
 * remote key registration and AVPlay's state machine. That is the code that actually ships
 * and it is worth exercising, but AVPlay is imitated rather than implemented, so nothing
 * decodes and the picture is a placeholder.
 *
 * Without it the app takes its browser path and hls.js drives a real video element, so
 * channels genuinely play. Useful for working on anything downstream of a picture being
 * there, and dishonest about everything Tizen specific. Hence a choice rather than a
 * default.
 */
const video = has("video");
const port = 9333;

const NETWORKS = {
  "3g": { mbps: 1.6, latency: 150 },
  slow: { mbps: 4, latency: 60 },
};

const link = ({ mbps, latency }) => ({
  offline: false,
  downloadThroughput: (mbps * 1e6) / 8,
  uploadThroughput: (mbps * 1e6) / 16,
  latency,
});

/**
 * The connection, left alone unless asked for.
 *
 * Deliberately not scaled with the rest. The set is on household wifi, which is not much
 * worse than this laptop's, and starving the bandwidth alongside the processor conflates
 * two different problems: a stall waiting for a segment looks nothing like a dropped frame
 * and is not fixed by the same work. Ask for it explicitly with --net=3g or --net=slow when
 * that is the question.
 */
const netProfile = netArg && NETWORKS[netArg] ? NETWORKS[netArg] : null;

const chrome = arg("chrome") ?? findChrome();
if (!chrome) {
  console.error("No Chrome found. Pass --chrome=/path/to/binary.");
  process.exit(1);
}

// A stable profile, so a playlist added once stays added, the way it would on the set.
const userDir = join(tmpdir(), "simpleiptv-tv-sim");
mkdirSync(userDir, { recursive: true });
const child = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDir}`,
  `--window-size=${profile.width},${profile.height}`,
  // The set's own JS heap ceiling. Overrun it here and it would overrun there.
  `--js-flags=--max-old-space-size=${heapMB}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  "--hide-scrollbars",
  // The set's player fetches streams itself and knows nothing about the same origin
  // policy, so a browser refusing a playlist on CORS grounds is the simulator being
  // unfaithful rather than the app being wrong. Safe enough with a profile of its own,
  // and --cors puts it back for anyone who wants to see what a real browser would do.
  ...(has("cors") ? [] : ["--disable-web-security"]),
  // Software rasterising, for when the question is how expensive the painting is. A TV
  // GPU is far weaker than a laptop's, and this is the bluntest way to stop the laptop
  // flattering shadows, large repaints and anything else that is fill rate bound.
  ...(has("software") ? ["--disable-gpu", "--disable-gpu-compositing"] : []),
  "about:blank",
], { stdio: "ignore", detached: false });

process.on("exit", () => { try { child.kill(); } catch { /* already gone */ } });

const cdp = await connect(port);

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: profile.width,
  height: profile.height,
  deviceScaleFactor: profile.deviceScaleFactor,
  mobile: false,
});
await cdp.send("Emulation.setUserAgentOverride", { userAgent: profile.userAgent });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
await cdp.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: cores });
// navigator.deviceMemory has no CDP override, so it is redefined in the page instead.
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Object.defineProperty(navigator, "deviceMemory", { get: () => ${memoryGB} });`,
});
if (netProfile) await cdp.send("Network.emulateNetworkConditions", link(netProfile));
if (!video) {
  if (engine) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: engine });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: shim });
}

// A fresh set has no playlist and shows the onboarding screen, which is the right first
// run but useless to measure against. Seeding one puts the simulator straight into the
// state worth profiling.
const playlist = arg("playlist");
if (playlist) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try {
      if (!localStorage.getItem("simpleiptv.settings")) {
        localStorage.setItem("simpleiptv.settings", JSON.stringify({
          playlists: [{ id: "sim", name: "Simulator", url: ${JSON.stringify(playlist)} }],
          activePlaylistId: "sim",
        }));
      }
    } catch (e) { console.log("[tv] could not seed a playlist", e); }`,
  });
}

cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
  const text = args.map((a) => a.value ?? a.description ?? "").join(" ");
  if (text.startsWith("[tv]") || type === "error" || type === "warning") {
    console.log(`  ${type === "error" ? "!" : " "} ${text}`);
  }
});

/**
 * How much to trust the throttle.
 *
 * The factor is a ratio between two particular machines, so it expires when either of them
 * changes. Saying so beats reporting confident numbers measured against a laptop nobody is
 * using any more.
 */
const machine = `${cpus()[0]?.model ?? "unknown"} (${arch()})`;
const trust = !profile.calibrated
  ? "estimated, run npm run tv:calibrate"
  : profile.calibratedMachine && profile.calibratedMachine !== machine
    ? `calibrated on a different machine, ${profile.calibratedMachine}`
    : `calibrated ${profile.calibratedOn}`;

console.log(`TV simulator  ${profile.model}`
  + `${harsh > 1 ? `, divided by a further ${harsh}` : ""}`);
console.log(`  engine     ${profile.platform}, Chromium ${profile.chromium}`
  + `${floor ? " (spoofed, the engine here is whatever Chrome is installed)" : ""}`);

// Spelled out against what the set actually reports, because a bare throttle figure reads
// like a multiple of the TV when it is a multiple of this laptop.
console.log(`  cpu        ${cpu}x slower per core than this machine`
  + `${floor ? `, ie ${profile.slowerThanReference}x slower than your S90D` : ""} (${trust})`);
console.log(`  heap       ${heapMB}MB${harsh > 1 ? ` of ${profile.jsHeapLimitMB}MB` : ""}`);
console.log(`  cores      ${cores}${harsh > 1 ? ` of ${profile.cores}` : ""}`
  + `, though only the main thread is slowed`);
console.log(`  memory     ${memoryGB}GB${harsh > 1 ? ` of ${profile.deviceMemoryGB}GB` : ""}`);
console.log(`  network    ${netProfile ? `${netProfile.mbps.toFixed(1)}Mbps, ${netProfile.latency}ms` : "unthrottled, as the set's wifi effectively is"}`);
console.log(`  screen     ${profile.width}x${profile.height}`
  + `${has("software") ? ", software rendering" : ""}`);
console.log(`  player     ${video
  ? "the app's own browser path, Tizen paths skipped"
  : `AVPlay carried out by hls.js, Tizen paths live${engine ? "" : ", no engine found so no decode"}`}`);
console.log(`  ${url}`);

await cdp.send("Page.navigate", { url });

if (has("bench") || has("profile")) {
  await new Promise((r) => setTimeout(r, 8000));
  const ev = async (expression) => (await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  })).result.value;
  await ev(readFileSync(join(here, "bench.js"), "utf8"));

  /**
   * Real key events, through the browser's own input pipeline.
   *
   * This is the whole difference between a benchmark and a comforting number. Events made
   * inside the page skip the delivery work a real press causes, and the earlier version of
   * this reported a clean run on a build that was stuttering visibly.
   */
  const KEYS = {
    down: [40, "ArrowDown"], up: [38, "ArrowUp"], left: [37, "ArrowLeft"],
    right: [39, "ArrowRight"], enter: [13, "Enter"],
  };
  const press = async (name) => {
    const [code, key] = KEYS[name];
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", {
        type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key,
      });
    }
  };

  // Roughly the rate a held remote key repeats. Anything that starts a stream is paced
  // slower, because nobody changes channel thirty times a second and pretending they do
  // measures a queue rather than an experience.
  const GAP = 33;
  const drive = async (sequence, times, gap) => {
    for (let i = 0; i < times; i++) {
      for (const name of sequence) {
        await press(name);
        await new Promise((r) => setTimeout(r, gap));
      }
    }
  };

  /**
   * Let the app finish before timing the next thing.
   *
   * Without this each journey inherited the previous one's unfinished work, which is how a
   * scroll that was perfectly smooth on its own came out with fifteen stalls: it was paying
   * for the category walk before it. A phase should measure itself.
   */
  const settle = (ms = 3000) => new Promise((r) => setTimeout(r, ms));

  const phase = async (label, sequence, times, gap = GAP) => {
    await settle();
    await ev("window.__bench.start()");
    // An empty sequence is the resting case: watch without touching anything, so there is
    // something to read the rest against.
    if (sequence.length) await drive(sequence, times, gap);
    else await new Promise((r) => setTimeout(r, 40 * GAP));
    const r = await ev("JSON.stringify(window.__bench.stop())").then(JSON.parse);
    if (!r || !r.of || r.hidden) {
      console.log(`  ${label.padEnd(22)}   window was hidden, nothing measurable here`);
      return r;
    }
    console.log(`  ${label.padEnd(22)}${String(r.median).padStart(8)}${String(r.p95).padStart(8)}`
      + `${String(r.worst).padStart(8)}${String(r.stalls).padStart(8)}`);
    return r;
  };

  // Frames are only produced for a window the compositor thinks is visible.
  await cdp.send("Page.bringToFront");
  await press("left");                                  // into the channel panel
  await new Promise((r) => setTimeout(r, 2000));
  await press("right");                                 // and into the channel list
  await new Promise((r) => setTimeout(r, 1200));

  /**
   * Things a viewer actually does, in the order they would do them.
   *
   * Worth saying what an earlier version of this did instead, because it looked reasonable
   * and measured almost nothing: it pressed down forty times in the first category, then
   * did it again, then alternated left and right which merely moves focus between the two
   * columns without ever changing category. So it walked the same twenty three channels
   * three times over with every logo already cached, and called the result navigation.
   *
   * The expensive action it never touched is moving between categories, which throws away
   * the whole channel list and builds another one with fifteen logos nobody has fetched.
   */
  const where = async () => (await ev(
    `JSON.stringify({category:(document.querySelector('.rail .row.showing .row-label')||{}).textContent})`,
  ));

  console.log(`\n  ${"journey".padEnd(22)}${"frame".padStart(8)}${"p95".padStart(8)}`
    + `${"worst".padStart(8)}${"stalls".padStart(8)}`);

  await phase("resting", [], 1);

  /*
   * Racing down the category rail, which is the hardest thing anyone can ask of this app:
   * every press replaces the entire channel list and asks for fifteen logos nobody has seen.
   *
   * The cursor stays in the rail for the whole run. An earlier version pressed left, down,
   * right on a loop, which walked back into the channel list between every category and so
   * changed category at a third of the rate while looking like it was doing more.
   */
  await press("left");
  await settle(1500);
  await phase("racing the categories", ["down"], 18);
  await phase("and back up again", ["up"], 18);
  const landed = await where();

  // Back into the channels, and hold the key down, which is how people cross a long list.
  await press("right");
  await settle(1500);
  await phase("holding down a category", ["down"], 40);
  await phase("the same rows again", ["down"], 40);

  await press("enter");
  await settle(4000);

  // Surfing, at about the rate someone flicks through channels looking for something.
  await phase("surfing channels", ["up"], 10, 900);

  /*
   * One whole visit to the list, five times over: open it, look at a few rows, choose one.
   * The earlier version of this opened and shut the panel eight times in a row with nothing
   * in between, which measured a thing nobody does.
   */
  await phase("open, browse, choose", ["left", "down", "down", "down", "enter"], 5, 450);

  console.log(`\n  walked to: ${landed}`);
  const state = await ev("JSON.stringify(window.__bench.state())").then(JSON.parse);
  console.log(`\n  ${state.nodes} nodes, ${state.rows} rows, ${state.heapMB}MB heap`);
  console.log("  stalls counts frames past 100ms, the point the guidance says a viewer");
  console.log("  must be told something is happening.");
  child.kill();
  process.exit(0);
}

/**
 * Rebuild on change and reload the window.
 *
 * Not the dev server's hot replacement, and deliberately so: this keeps the production build,
 * which is the only one worth judging speed on, and pays for it with a full reload instead of
 * a patched module. On a television that is the more honest reset anyway, since the app is
 * launched cold far more often than it is edited.
 *
 * Vite rebuilds into dist, the preview server reads from disk, so watching the output
 * directory is enough to know when there is something new to show.
 */
if (!measuring) {
  spawnChild("npx", ["vite", "build", "--watch"]);

  /**
   * Reload only once the build is genuinely finished and consistent.
   *
   * Reloading on the first file to change is not safe: a build writes its assets and its
   * index.html at different moments, so the page can pick up an index that still points at a
   * bundle from the previous build, or a bundle the index no longer mentions. That is not a
   * theoretical risk. It happened, and cost an hour of testing a stale build while wondering
   * why perfectly good changes had no effect.
   *
   * So the flurry has to stop, and the bundle index.html names has to actually be on disk,
   * before anything is reloaded. The name is printed so a stale page is visible rather than
   * something to be deduced.
   */
  const currentBundle = () => {
    try {
      const html = readFileSync(join(dist, "index.html"), "utf8");
      const named = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map((m) => m[1]);
      return named.every((f) => existsSync(join(dist, f))) ? named.join(" ") : null;
    } catch {
      return null;
    }
  };

  let pending;
  let last = currentBundle();
  watch(dist, { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      const bundle = currentBundle();
      if (!bundle || bundle === last) return;   // half written, or nothing actually changed
      last = bundle;
      try {
        await cdp.send("Page.reload", { ignoreCache: true });
        console.log(`  reloaded  ${new Date().toLocaleTimeString()}  ${bundle.split("/").pop()}`);
      } catch { /* the window has gone */ }
    }, 900);
  });
}

console.log(`
Leave this running and work in the window. Saving a file rebuilds and reloads it.

  --video       take the app's browser path instead of the Tizen one
  --floor       the weakest Samsung since 2020, rather than the set in your room
  --harsh=N     divide the processor, heap, cores and memory by N
  --net=3g      throttle the connection, which is otherwise left alone
  --cors        restore the same origin policy the TV does not have

Ctrl+C to stop.`);

// Chrome closing is the other way this ends, and leaving a dead terminal open helps nobody.
cdp.on("Inspector.detached", () => process.exit(0));
child.on("exit", () => process.exit(0));
