#!/usr/bin/env node
/**
 * Run the app under the TV's constraints, on a laptop.
 *
 * Samsung ships an x86 emulator that needs HAXM, which does not exist on Apple silicon,
 * and their simulator is a plain WebKit shell that tells you nothing about performance.
 * Neither is needed here. This uses ordinary Chrome with a host calibrated CPU proxy,
 * conservative resource settings and a native playback state shim.
 *
 * What it reproduces, and does not:
 *
 *   CPU        floor workload calibrated on this host, with an explicitly estimated TV score
 *   memory     a V8 old space stress cap, not emulated physical RAM or total process memory
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
 *   node scripts/tv/sim.mjs --floor --bench --quick  shorter local sample of every journey
 *   node scripts/tv/sim.mjs --url=http://...    somewhere other than the preview server
 *   node scripts/tv/sim.mjs --port=9433         a separate Chrome debugging port
 *   node scripts/tv/sim.mjs --playlist=http://... measure against that instead of the default
 *   node scripts/tv/sim.mjs --harsh            half the TV's hardware, on every axis
 *   node scripts/tv/sim.mjs --floor           calibrate to the estimated base TV workload
 *   node scripts/tv/sim.mjs --floor --quick   short Live, VOD and startup quality sample
 *   node scripts/tv/sim.mjs --fit             lay out for this screen, not the set's 1080p
 *   node scripts/tv/sim.mjs --harsh=4          a quarter of it
 *   node scripts/tv/sim.mjs --harsh --software no GPU either, so paint cost shows up
 *   node scripts/tv/sim.mjs --video           real playback, at the cost of the Tizen paths
 *   node scripts/tv/sim.mjs --net=off         no network throttling, even in harsh mode
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { arch, cpus, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { XTREAM_FIXTURE, xtreamFixtureResponse } from "../present.mjs";
import { computeBenchmarkIndex } from "./benchmark-index.mjs";
import { arg, connect, factor, findChrome, has } from "./cdp.mjs";
import { calibrateCpu, cpuControl, CPU_TOLERANCE } from "./cpu-model.mjs";
import {
  benchmarkResult,
  createJourneyTracker,
  createXtreamJourneyTracker,
  evaluationValue,
  pageResult,
  REDESIGN_JOURNEYS,
  XTREAM_JOURNEYS,
} from "./harness.mjs";
import { LAUNCH_DEADLINE_MS, LAUNCH_MARKS, launchWatcher } from "./launch-marks.mjs";
import {
  initializeMeasurementProfile,
  measurementOrigins,
  startMeasurementNetwork,
} from "./measurement-network.mjs";
import { selectPerformanceProfile } from "./performance-profile.mjs";
import {
  assessPhase,
  STARTUP_GOALS,
  UI_GOALS,
  vodCategoryReady,
} from "./performance-goals.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(here, name), "utf8"));
const shim = readFileSync(join(here, "shim.js"), "utf8");

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
const fasterReference = has("reference");
const calibratedProfile = floor || fasterReference;
const profile = selectPerformanceProfile(read, { floor, reference: fasterReference });
const profileLabel = floor ? "Original floor" : fasterReference ? "Everyday TV" : "Device";
const profileIdentity = createHash("sha256").update(JSON.stringify(profile)).digest("hex");
// Hardware comparisons share one API fixture. Engine compatibility has its own gate.
const fixtureUserAgent = calibratedProfile ? read("floor.json").userAgent : profile.userAgent;

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
const measuring = has("bench") || has("profile") || has("budget") || has("quick");
const isolatedNetwork = measuring && !has("video") && !has("real-logos");
const quick = has("quick");
if (quick && (!calibratedProfile || has("profile"))) {
  throw new Error(
    "--quick requires --floor or --reference and cannot be combined with --profile.",
  );
}
if (
  has("budget") &&
  (quick ||
    !calibratedProfile ||
    has("video") ||
    has("profile") ||
    has("real-logos") ||
    arg("net") != null ||
    arg("cpu") != null ||
    arg("cpu-score") != null)
) {
  throw new Error(
    "--budget requires a complete --floor or --reference run with automatic CPU calibration and native " +
      "playback timing with isolated local fixtures. Use --bench for CPU, video or network diagnostics.",
  );
}

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

/**
 * The playlist every measurement is taken against, unless somebody says otherwise.
 *
 * iptv-org's index, which is 12,732 channels in 175 categories, 2.7MB of text, a logo on
 * every channel and names in a dozen scripts. It is the largest playlist anybody is likely
 * to point this application at, and that is the whole reason it is the default rather than
 * something comfortable.
 *
 * What it replaces was 200 channels in 14 categories, and the gap between those two is where
 * this application's costs actually live. Nothing in the interface is expensive per pixel: it
 * is expensive per row, per logo and per category, and a playlist that fits in a rounding
 * error of the heap cannot say anything about a set with 120MB. Two hundred channels also
 * parse in 0.3ms here against 11.7ms for twelve thousand, which is about 0.7 seconds of
 * frozen main thread on the floor, on the launch path, that nothing had ever measured.
 *
 * A number written down twice is a number that drifts, so `--playlist` overrides this and
 * the header says which one was used.
 */
const BENCHMARK_PLAYLIST = "https://iptv-org.github.io/iptv/index.m3u";

/**
 * Where the harness keeps its copy, beside the Chrome profile it already keeps.
 *
 * Downloaded once and then served from here, which is not a convenience. Fetched from the
 * CDN on every run, the launch measurement would be timing github.io: 2.7MB arrives in
 * whatever time the network feels like, and the mark that is supposed to say how long
 * the application takes to read a playlist would move by a second between runs for reasons
 * that have nothing to do with the application. Served from localhost the bytes are
 * identical, constant, and there whether or not this machine is online.
 *
 * A day old is stale enough to refresh. The playlist gains and loses channels daily, so a
 * copy that never expired would quietly become a different benchmark from the one the URL
 * names, and one that expired every run would put the CDN back in the measurement.
 */
const PLAYLIST_CACHE = join(tmpdir(), "openiptv-tv-sim-playlist.m3u");
const PLAYLIST_TTL_MS = 24 * 60 * 60 * 1000;

/** Anything started here dies with this process, however it ends. */
const spawnChild = (command, args) => {
  const proc = spawn(command, args, { cwd: root, stdio: "ignore", shell: false });
  children.push(proc);
  return proc;
};
const killChildren = () =>
  children.forEach((c) => {
    try {
      c.kill();
    } catch {
      /* gone */
    }
  });
process.on("exit", killChildren);
/* Interrupted is not passed. Exiting zero here meant Ctrl+C, or a cancelled CI job, reported a
   clean benchmark; 130 is the conventional code for terminated by SIGINT. */
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

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
if (isolatedNetwork) measurementOrigins(url, url);
const servedHtml = measuring ? await (await fetch(url)).text() : "";
const buildIdentity = createHash("sha256").update(servedHtml).digest("hex");
if (measuring && (url === DEV || /\/@vite\/client|\/src\/main\.[jt]sx?/.test(servedHtml))) {
  console.error(
    "\nRefusing to measure the dev server.\n\n" +
      "React validates every element in a development build, which came to half the main\n" +
      "thread last time and tells you nothing about the app. Build first:\n\n" +
      "  npm run build && npm run preview\n",
  );
  process.exit(1);
}
if (measuring && !/src="[^"]*\/assets\/[^"]+\.js"/.test(servedHtml)) {
  throw new Error("The measurement URL does not serve a production application entry.");
}
if (has("budget") && servedHtml !== readFileSync(join(dist, "index.html"), "utf8")) {
  throw new Error("The budget URL does not serve this worktree's production build.");
}
/**
 * The playlist, fetched once and then served from here.
 *
 * A refusal is fatal on a cold machine and survivable on a warm one, which is the honest
 * ordering: a benchmark with no playlist has nothing to measure and should say so rather than
 * report the onboarding screen, and a benchmark with yesterday's copy is a benchmark.
 */
const wantedPlaylist = arg("playlist") ?? BENCHMARK_PLAYLIST;
const cachedFrom = `${PLAYLIST_CACHE}.from`;
const held =
  existsSync(PLAYLIST_CACHE) &&
  existsSync(cachedFrom) &&
  readFileSync(cachedFrom, "utf8") === wantedPlaylist;
const stale = !held || Date.now() - statSync(PLAYLIST_CACHE).mtimeMs > PLAYLIST_TTL_MS;

if (stale) {
  try {
    const response = await fetch(wantedPlaylist, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    writeFileSync(PLAYLIST_CACHE, await response.text());
    writeFileSync(cachedFrom, wantedPlaylist);
  } catch (e) {
    if (!held) {
      console.error(`\nCould not fetch the playlist to measure against: ${e.message}\n`);
      console.error(`  ${wantedPlaylist}\n`);
      console.error("There is no copy in the temp directory either, so there is nothing to");
      console.error("measure. Pass --playlist=... for one that is reachable from here.\n");
      process.exit(1);
    }
    console.log(`  playlist   could not be refreshed (${e.message}), using the copy on disk`);
  }
}

const playlistText = readFileSync(PLAYLIST_CACHE, "utf8");
/**
 * What the playlist actually is, counted rather than believed.
 *
 * Printed in the header so a run says what it measured against. A playlist is somebody else's
 * file: it can double in size or lose half its categories between two runs, and every number
 * below would move with it while the URL in the header stayed the same. Two hundred channels
 * and twelve thousand are not the same benchmark and should not look like one.
 */
const shape = {
  channels: (playlistText.match(/^#EXTINF/gm) ?? []).length,
  categories: new Set(
    (playlistText.match(/group-title="[^"]*"/g) ?? []).map((g) => g.slice(13, -1)),
  ).size,
  logos: (playlistText.match(/tvg-logo="[^"]/g) ?? []).length,
};

/**
 * Artwork, served from here as well, because otherwise this benchmark measures other people's
 * CDNs.
 *
 * The playlist points at 10,602 logos on a few hundred hosts, and most of them are dead, slow or
 * refuse a cross origin fetch: eight runs of the walk below cached 280 of them. What the rest
 * contributed was a few hundred requests failing at whatever rate DNS and the office connection
 * felt like that minute, on the main thread's critical path, in the middle of the phases meant to
 * be measuring the interface. It showed: the same build measured 1 stall in a phase in three
 * consecutive rounds and 21 in the next, with no code between them.
 *
 * So every logo address is rewritten to point here, and every one of them resolves. That keeps
 * the cost this benchmark is about, which is the decode, the resample to a 76x48 box, the canvas
 * draw and the write to flash, and removes the cost it can say nothing useful about. The images
 * are deliberately far larger than the box they end up in, because that is the case the logo
 * cache exists for and the one that used to freeze the list for three and a half seconds.
 *
 * `--real-logos` puts the playlist's own addresses back, for the day the question is what the
 * internet does to a launch rather than what the interface costs.
 */
const LOGO_SIZES = [400, 800, 1200];
/**
 * How many colourways, which is a legibility matter rather than a measurement one.
 *
 * The first version served three images, one per size, so every channel in the interface carried
 * an identical tile. That reads as a logo pipeline that has failed and substituted a placeholder,
 * which is exactly the thing anybody looking at this screen would be checking for. The addresses
 * are per channel either way, so this changes nothing about what is measured and quite a lot
 * about whether a person can believe what they are looking at.
 *
 * Twelve of them, cycling with the channel number, so no two rows next to each other match and
 * the repeat is a screenful apart. Not one per channel: twelve thousand distinct images would be
 * twelve thousand deflates to save somebody noticing a pattern down a long list.
 */
const LOGO_HUES = 12;

/** A valid PNG of flat bands, which is what a logo is: few colours, hard edges, large. */
function png(size, hue) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  // Three flat bands in a colour of its own, plus a corner block, so twelve of these are
  // obviously twelve different pictures at a glance and none of them is a grey placeholder.
  const wheel = [
    [230, 60, 60],
    [230, 140, 40],
    [220, 200, 50],
    [140, 200, 60],
    [60, 190, 110],
    [50, 190, 200],
    [60, 130, 220],
    [90, 90, 230],
    [160, 80, 220],
    [220, 70, 180],
    [120, 120, 130],
    [40, 60, 80],
  ][hue % LOGO_HUES];
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0; // no filter, so the encoder stays this short
    const band = Math.floor((y / size) * 3);
    for (let x = 0; x < size; x++) {
      const at = row + 1 + x * 3;
      const shade = band === 0 ? 1 : band === 1 ? 0.7 : 0.45;
      const corner = x < size / 3 && y < size / 3;
      raw[at] = Math.round(wheel[0] * shade) + (corner ? 25 : 0);
      raw[at + 1] = Math.round(wheel[1] * shade) + (corner ? 25 : 0);
      raw[at + 2] = Math.round(wheel[2] * shade) + (corner ? 25 : 0);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Encoded on first request for interactive runs, or before calibration when measuring.
 *
 * Thirty six large images is a couple of seconds of deflate, and a run that walks eighteen
 * categories asks for a handful of them. Building them on demand keeps that off the start of
 * interactive runs. Measurements prepare every variant before starting Chrome instead.
 */
const logos = new Map();
const logoFor = (size, hue) => {
  const key = `${size}/${hue}`;
  if (!logos.has(key)) logos.set(key, png(size, hue));
  return logos.get(key);
};

/**
 * Served on a fixed port, so the address a playlist is cached under is the same next run.
 *
 * The app keys its cache on the playlist's URL, quite rightly, since two playlists at one
 * address are one file. An ephemeral port would therefore hand every run a playlist it had
 * never seen, which is a different measurement from the one worth taking: a television has the
 * playlist on flash from the last time it was switched on. An ephemeral port is the fallback
 * rather than the rule, for the case where something else holds 4174.
 */
let benchText = playlistText;
const fixture = createServer(async (request, response) => {
  const xtream = xtreamFixtureResponse(request.url ?? "/");
  if (xtream) {
    response.writeHead(xtream.status, {
      "content-type": xtream.type,
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    if (xtream.delay) await new Promise((settle) => setTimeout(settle, xtream.delay));
    response.end(xtream.body);
    return;
  }
  // The set's own fetch is granted its origins in config.xml rather than asked for them, so a
  // browser refusing either of these would be the simulator being unfaithful. --cors leaves the
  // browser's rules in force, and then the header is what keeps the fixture reachable.
  const logo = /^\/logo\/(\d+)\/(\d+)\.png$/.exec(request.url ?? "");
  if (logo && LOGO_SIZES.includes(Number(logo[2]))) {
    response.writeHead(200, {
      "content-type": "image/png",
      "access-control-allow-origin": "*",
      "cache-control": "max-age=3600",
    });
    response.end(logoFor(Number(logo[2]), Number(logo[1]) % LOGO_HUES));
    return;
  }
  response.writeHead(200, {
    "content-type": "application/vnd.apple.mpegurl",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(benchText);
});
await new Promise((settle) => {
  fixture.once("error", () => fixture.listen(0, "127.0.0.1", settle));
  fixture.listen(4174, "127.0.0.1", settle);
});
const fixtureOrigin = `http://127.0.0.1:${fixture.address().port}`;
if (isolatedNetwork) {
  // Fixture encoding must finish before calibration or any measured loading journey.
  for (const size of LOGO_SIZES) {
    for (let hue = 0; hue < LOGO_HUES; hue++) logoFor(size, hue);
  }
}
const playlist = `${fixtureOrigin}/playlist.m3u`;
process.on("exit", () => fixture.close());

/*
 * Only when measuring, and this is the more important half of the rule.
 *
 * Substituted artwork is right for a benchmark and wrong for the window somebody is working in.
 * The first version rewrote unconditionally, so `npm run tv` showed the fixture: every channel
 * carrying the same tile, which is indistinguishable from the logo pipeline being broken. The
 * whole point of the headful simulator is that a person looks at it and believes what they see.
 *
 * One address per channel, because the logo cache is keyed by address: a shared URL would mean
 * one decode for twelve thousand channels, which is the cost this walk exists to measure
 * disappearing into a cache hit. Stable across runs, because that is what a television has, so
 * the second visit to a row is warm there and warm here.
 */
if (measuring && !has("real-logos")) {
  let nth = 0;
  benchText = playlistText.replace(/tvg-logo="[^"]*"/g, () => {
    const size = LOGO_SIZES[nth % LOGO_SIZES.length];
    return `tvg-logo="${fixtureOrigin}/logo/${nth++}/${size}.png"`;
  });
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
const autoCpu = calibratedProfile && arg("cpu") == null;
let cpu = Number(arg("cpu") ?? (autoCpu ? 1 : profile.cpuThrottle)) * harsh;
let cpuCalibration = null;
if (!Number.isFinite(cpu) || cpu < 1) {
  throw new Error("--cpu must be a finite slowdown of at least 1.");
}
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
const port = Number(arg("port") || (measuring ? 9433 : 9333));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("--port must be an integer between 1 and 65535");
}
if (measuring && port === 9333) {
  throw new Error(
    "Measurements must use a separate debugging port, not the development port 9333.",
  );
}
if (measuring) {
  await new Promise((resolve, reject) => {
    const probe = createPortProbe();
    probe.once("error", () => reject(new Error(`Measurement port ${port} is already in use.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

/**
 * Whether to run without a window, which measuring does and working does not.
 *
 * Measuring is headless by default, and that is about the result rather than about tidiness.
 * requestAnimationFrame stops for a window the compositor thinks is occluded, and a window
 * launched from a terminal is occluded by that terminal the moment anybody touches the
 * keyboard. So a four minute benchmark was silently hostage to whether the machine was left
 * alone for four minutes, and when it was not, every phase reported no frames, which reads
 * identically to an application that failed to draw. Both happened in one afternoon.
 *
 * Headless has no window to be behind anything, so a run means the same thing whatever else
 * is going on. It rasterises in software, which matters less here than it sounds: turning the
 * GPU off with --software moved nothing except the cost of opening the panel, so this is not
 * where the app's time goes. What it does mean is that a headless figure and a headful one
 * are not comparable, so a before and after have to be measured the same way. They are, by
 * default, which is the point.
 *
 * `npm run tv` stays headful, because the whole idea of it is a window to work in.
 * `--headful` puts the window back for a measurement, for when the question is visual.
 */
const headless = measuring ? !has("headful") : has("headless");

/**
 * Work at the size of the screen in front of you, and stop pretending about the resolution.
 *
 * Everything else about the simulator still applies: the slow cores, the heap ceiling, the user
 * agent, the shimmed AVPlay. Only the 1920x1080 goes, so the interface lays out for the window it
 * is actually in and a laptop shows all of it without a scrollbar or a shrunken page.
 *
 * What that costs is worth being clear about, because it is not nothing. Every Samsung set runs
 * this application at 1920x1080 whatever its panel is, so a window 1512 wide is a screen no
 * television has: the panel keeps its 1064 pixels and takes a larger share of the width, the
 * columns hold fewer rows, and anything that would only crowd at the set's proportions will look
 * fine here. It is a flag for working comfortably, not for judging a layout.
 *
 * Refused by every measurement. Fewer pixels is less to rasterise per frame, and a shorter
 * viewport windows fewer rows, so the journeys would neither cost nor cover what they cost and
 * cover on a television.
 */
const fit = has("fit") || arg("fit") !== undefined;
/*
 * Refused by anything that measures, and the test is deliberately wider than `measuring`.
 *
 * `measuring` is --bench and --profile. --budget is checked as well because it is a separate flag
 * that happens to be useless without --bench: somebody typing `--fit --budget` should be told they
 * cannot have both rather than get an interactive window and no budget, silently.
 *
 * The two parity gates cannot reach this at all. gap-parity and engine-parity have their own
 * launchers, both fixed at 1920x1080, and neither reads this file's arguments, so the only way to
 * scale a gate is to change the gate.
 */
if (fit && (measuring || has("budget"))) {
  console.error(
    "\n--fit lays the app out for this screen rather than the set's 1920x1080, which",
  );
  console.error(
    "changes both the pixels per frame and how many rows a column holds, so it cannot",
  );
  console.error("be combined with a measurement. Drop one of them.\n");
  process.exit(2);
}
/* It used to take a factor, when it scaled the page instead of resizing the layout, and a value
   now means nothing. Said out loud rather than ignored, or `--fit=0.8` looks like it did something
   and the header is the only thing that would have disagreed. */
if (arg("fit") !== undefined) {
  console.log(
    `  note       --fit takes no value any more; ${arg("fit")} ignored, the window is ` +
      "whatever this display allows",
  );
}

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
 * Optional network shaping for diagnostics.
 *
 * Regular measurements use only the owned loopback app and fixtures. --net=3g and
 * --net=slow deliberately add latency and bandwidth constraints, so the budget rejects them.
 */
const netProfile = netArg && NETWORKS[netArg] ? NETWORKS[netArg] : null;

const chrome = arg("chrome") ?? findChrome();
if (!chrome) {
  console.error("No Chrome found. Pass --chrome=/path/to/binary.");
  process.exit(1);
}

const measurementNetwork = isolatedNetwork
  ? await startMeasurementNetwork({ appUrl: url, fixtureOrigin })
  : null;
let networkAuditReported = false;
const reportNetworkAudit = () => {
  const network = measurementNetwork?.snapshot();
  console.log(`  network audit: ${JSON.stringify(network ?? { isolated: false })}`);
  networkAuditReported = true;
  return network;
};
process.on("exit", () => {
  if (measurementNetwork && !networkAuditReported) reportNetworkAudit();
  void measurementNetwork?.close();
});
// A stable profile, so a playlist added once stays added, the way it would on the set.
const userDir = measuring
  ? mkdtempSync(join(tmpdir(), "openiptv-tv-measure-"))
  : join(tmpdir(), "openiptv-tv-sim");
mkdirSync(userDir, { recursive: true });
if (measurementNetwork) initializeMeasurementProfile(userDir);
const child = spawn(
  chrome,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    ...(measurementNetwork?.chromeArgs ?? []),
    /* Sized to the set when the set's resolution is being simulated, and left to fill the display
     when it is not: a 1920 wide window on a 1512 wide screen is exactly what --fit is for
     getting rid of. */
    ...(fit ? ["--start-maximized"] : [`--window-size=${profile.width},${profile.height}`]),
    // A conservative project stress cap, not an emulation of total TV memory.
    `--js-flags=--max-old-space-size=${heapMB}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--hide-scrollbars",
    // Linux runners have no unprivileged user namespaces, so the sandbox refuses to start and
    // the budget job cannot run at all. Safe here: a local fixture, for ninety seconds.
    "--no-sandbox",
    // No window at all when measuring, so nothing on the desktop can decide the result. See
    // `headless` above for why that is a correctness matter rather than a convenience.
    ...(headless ? ["--headless=new"] : []),
    /*
     * And keep animating even with a window, for the headful case.
     *
     * requestAnimationFrame stops dead for a window the compositor believes is occluded, and
     * it believes that whenever this window is behind the terminal that launched it. These
     * three do not flatter anything: the work still happens on the same throttled main thread
     * and the frames are still real, they are simply still produced when the window is not on
     * top. Kept alongside headless rather than instead of it, because --headful is still a
     * supported way to measure and it has the same problem.
     */
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    ...(measurementNetwork ? [] : ["--disable-features=CalculateNativeWinOcclusion"]),
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
  ],
  { stdio: "ignore", detached: false },
);

process.on("exit", () => {
  try {
    child.kill();
  } catch {
    /* already gone */
  }
});

const cdp = await connect(port);
const browserVersion = await cdp.send("Browser.getVersion");

/*
 * Make sure the browser being driven is the one that was just started.
 *
 * The profile directory is fixed on purpose, so a playlist added once stays added the way it
 * would on a television. The cost is that a Chrome already holding that profile makes this one
 * detect the singleton lock, hand over its command line and exit immediately, leaving the
 * debugger attached to the browser that was already there. Every flag above is then void: not
 * the CPU throttle, not the heap cap, not the user agent, not headless. The run would report
 * frame times for an unthrottled desktop Chrome and call them a television.
 *
 * A handed-off launcher exits within moments of starting, so it having exited by the time the
 * debugger is up is the tell.
 */
if (child.exitCode !== null) {
  console.error(
    "\nAnother Chrome is already using the simulator's profile, so this one exited and\n" +
      "handed over to it. None of the TV constraints are in force on that browser.\n\n" +
      "  Close any other `npm run tv` first, or wait for it to finish.\n",
  );
  process.exit(2);
}

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Network.enable");
if (measurementNetwork) {
  await cdp.send("Runtime.addBinding", { name: "__tvMeasurementNetworkSnapshot" });
  cdp.on("Runtime.bindingCalled", (event) => {
    if (event.name !== "__tvMeasurementNetworkSnapshot") return;
    void cdp
      .send("Runtime.evaluate", {
        contextId: event.executionContextId,
        expression: `window.__tvNetworkDone?.(${JSON.stringify(measurementNetwork.snapshot())})`,
      })
      .catch(() => console.error("The network audit snapshot could not be returned."));
  });
}
if (autoCpu) {
  console.log(
    `Calibrating the laptop to the estimated ${profileLabel.toLowerCase()} CPU workload...`,
  );
  await cdp.send("Runtime.evaluate", {
    expression: `window.__tvCpuIndex = ${computeBenchmarkIndex.toString()}`,
  });
  const targetScore = Number(arg("cpu-score") ?? profile.cpuBenchmarkIndex) / harsh;
  cpuCalibration = await calibrateCpu(async (rate) => {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    const response = await cdp.send("Runtime.evaluate", {
      expression: "window.__tvCpuIndex(250)",
      returnByValue: true,
    });
    return evaluationValue(response, "CPU calibration");
  }, targetScore);
  cpu = cpuCalibration.rate;
}

/*
 * The set's resolution, unless --fit has asked for this display's, in which case nothing is
 * overridden at all and the page uses the window it is in at this machine's own pixel ratio.
 */
if (!fit) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.deviceScaleFactor,
    mobile: false,
  });
}
await cdp.send("Emulation.setUserAgentOverride", { userAgent: fixtureUserAgent });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
if (measuring) {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__tvSimulation = ${JSON.stringify({
      cpu,
      cpuCalibration,
      browser: browserVersion,
      buildIdentity,
      profileLabel,
      profileIdentity,
      cpuApproximation: profile.cpuApproximation,
      hardware: {
        cores,
        memoryGB,
        heapMB,
        width: profile.width,
        height: profile.height,
        deviceScaleFactor: profile.deviceScaleFactor,
      },
      fixtureUserAgent,
      fixtureOrigin,
      nativeTiming: !video,
      networkIsolated: Boolean(measurementNetwork),
      playlistIdentity: createHash("sha256").update(playlistText).digest("hex"),
      width: profile.width,
      height: profile.height,
    })};`,
  });
}
await cdp.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: cores });
// navigator.deviceMemory has no CDP override, so it is redefined in the page instead.
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Object.defineProperty(navigator, "deviceMemory", { get: () => ${memoryGB} });`,
});
if (netProfile) await cdp.send("Network.emulateNetworkConditions", link(netProfile));
if (!video) {
  if (measuring) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__openiptvNativeTiming = true;",
    });
  } else if (engine) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: engine });
  }
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: shim });
}

/*
 * The playlist, in the profile, every time, and the same one this run is serving.
 *
 * This used to write the settings only when there were none at all, which quietly made the
 * `--playlist` argument advisory. A profile seeded once with two hundred channels went on
 * being measured against two hundred channels no matter what any later run asked for, and
 * the run said nothing: it printed a tidy table for a playlist nobody had chosen. Since the
 * whole point of the Chrome profile is that it persists, the seed has to assert what it wants
 * rather than fill in a blank.
 *
 * Preserved rather than overwritten wholesale, because a person's `npm run tv` profile carries
 * their font, their text size and their favourites, and there is no reason a measurement should
 * reset those. Only what a measurement depends on is imposed.
 *
 * And imposed only when measuring. Asserting it in every mode meant `npm run tv` replaced
 * whatever playlist somebody had configured with the benchmark's, every launch, so the window
 * they work in stopped showing the playlist they were working on. A benchmark is entitled to
 * demand its own conditions. The window a person is looking at is theirs, and it keeps its
 * playlist unless there is none at all, which is the one case where the fixture beats the first
 * run screen.
 */
await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
  /*
   * `showClock` defaults on and re-renders every second, which is work arriving during `resting`,
   * whose whole job is to be the number everything else is read against. It is overridden only
   * when measuring. Someone working in `npm run tv` wants the application's real defaults, clock
   * included. `panelTimeout` remains in the seed for settings compatibility, but the channel panel
   * does not use it to close itself.
   *
   * The last channel is forgotten once per run, and once is what `sessionStorage` buys: it
   * survives the navigations within a run and is empty in the next browser. Every phase below
   * therefore starts from the first category, the first row and nothing playing, instead of
   * wherever the previous run happened to leave the cursor and whichever stream it left
   * running. That was not a small effect. Which channel the last run stopped on decided
   * whether a 1080p or a 576p stream was being demuxed on the main thread during phases named
   * after scrolling a list, and the two scroll phases came out anywhere between 2 and 9 stalls
   * against an allowance of 5 depending on it.
   */
  source: `(function () { try {
    /*
     * Nothing to seed on a document that cannot hold an application.
     *
     * This script runs on every new document, and the launch measurement goes via about:blank
     * on purpose, where the origin is opaque and every storage access throws SecurityError.
     * Caught by the handler at the foot of this script, that printed "could not seed a
     * playlist" on every single run: a harness crying wolf about the one thing it has to be
     * trusted on, from a page with no app in it. Two of them, in fact, since sessionStorage
     * and localStorage each throw in turn as the guards are added one at a time.
     */
    if (location.protocol === "about:" || location.protocol === "data:") return;
    var KEY = "openiptv.settings";
    var settings = {};
    try { settings = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { settings = {}; }
    var url = ${JSON.stringify(playlist)};
    var active = (settings.playlists || []).filter(function (p) {
      return p.id === settings.activePlaylistId;
    })[0];
    var fixtureServer = ${JSON.stringify(fixtureOrigin)};
    var xtreamJourney = false;
    try { xtreamJourney = sessionStorage.getItem("sim.xtreamJourney") === "1"; } catch (e) {}
    var benchmarkSource = active && (active.url === url ||
      (xtreamJourney && active.source && active.source.kind === "xtream" &&
        active.source.server === fixtureServer));
    if (!active || (${measuring} && !benchmarkSource)) {
      settings.playlists = [{ id: "sim", name: "Simulator", url: url }];
      settings.activePlaylistId = "sim";
    }
    if (${measuring}) {
      settings.panelTimeout = 0;
      settings.showClock = false;
      /* Its own try, because this script runs on every new document and about:blank has an
         opaque origin where sessionStorage throws SecurityError. Inside the outer try that
         threw before the playlist was written, and every run opened with "could not seed a
         playlist" from a document that has no application in it, which is a harness crying
         wolf about the one thing it must be trusted on. */
      try {
        if (!sessionStorage.getItem("sim.startedClean")) {
          sessionStorage.setItem("sim.startedClean", "1");
          localStorage.removeItem("openiptv.last");
        }
      } catch (e) { /* no storage here, so there is no last channel to forget either */ }
    }
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) { console.log("[tv] could not seed a playlist", e); } })();`,
});

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
const trust =
  arg("cpu") != null
    ? "explicit diagnostic override"
    : cpuCalibration
      ? `host calibrated to an estimated TV proxy, not a measured TV`
      : !profile.calibrated
        ? "estimated, run npm run tv:calibrate"
        : profile.calibratedMachine && profile.calibratedMachine !== machine
          ? `calibrated on a different machine, ${profile.calibratedMachine}`
          : `calibrated ${profile.calibratedOn}`;

console.log(
  `TV simulator  ${profile.model}` +
    `${harsh > 1 ? `, divided by a further ${harsh}` : ""}` +
    `${quick ? ", quick sample" : ""}`,
);
console.log(
  calibratedProfile
    ? "  APIs       shared Tizen fixture, engine compatibility checked separately by tv:engines"
    : `  engine     ${profile.platform}, Chromium ${profile.chromium} (spoofed)`,
);
console.log(`  browser    ${browserVersion.product}, V8 ${browserVersion.jsVersion}`);
if (measuring) console.log(`  build      index.html SHA256 ${buildIdentity}`);
if (measuring) {
  console.log(`  profile    ${profileLabel}, SHA256 ${profileIdentity}`);
}
if (calibratedProfile) console.log(`  estimate   ${profile.cpuApproximation}`);

// Spelled out against what the set actually reports, because a bare throttle figure reads
// like a multiple of the TV when it is a multiple of this laptop.
console.log(`  cpu        ${cpu}x renderer main thread slowdown (${trust})`);
if (cpuCalibration) {
  console.log(
    `  CPU index  host ${cpuCalibration.baselineScore}, target ${cpuCalibration.targetScore}, ` +
      `achieved ${cpuCalibration.achievedScore}, sample spread ` +
      `${Math.round(cpuCalibration.spread * 100)}%`,
  );
  console.log(
    `  CPU match  within ${CPU_TOLERANCE * 100}% required before and after measurement`,
  );
}
console.log(
  `  heap       ${heapMB}MB old space stress cap${harsh > 1 ? ` of ${profile.jsHeapLimitMB}MB` : ""}`,
);
console.log(
  `  cores      ${cores}${harsh > 1 ? ` of ${profile.cores}` : ""}` +
    ` as a navigator hint, only the renderer main thread is slowed`,
);
console.log(
  `  memory     ${memoryGB}GB navigator hint${harsh > 1 ? ` of ${profile.deviceMemoryGB}GB` : ""}`,
);
console.log(
  `  network    ${measurementNetwork ? "isolated loopback app and fixtures" : "unrestricted diagnostic"}${
    netProfile ? `, ${netProfile.mbps.toFixed(1)}Mbps, ${netProfile.latency}ms` : ""
  }`,
);
console.log(
  `  screen     ${
    fit
      ? "this display, not the set's 1920x1080, so the layout is not the set's either"
      : `${profile.width}x${profile.height}`
  }` + `${headless ? ", headless" : ""}${has("software") ? ", software rendering" : ""}`,
);
console.log(
  `  player     ${
    video
      ? "the app's own browser path, Tizen paths skipped"
      : measuring
        ? "AVPlay state and clock shim, native decoder cost excluded"
        : `AVPlay carried out by hls.js or video, Tizen paths live${engine ? "" : ", no engine found so no decode"}`
  }`,
);
console.log(
  `  playlist   ${shape.channels} channels, ${shape.categories} categories, ` +
    `${shape.logos} logos, ${Math.round(playlistText.length / 1024)}KB`,
);
console.log(`             ${wantedPlaylist}`);
console.log(
  `             ${
    measuring && !has("real-logos")
      ? "artwork served locally at 400 to 1200px, since most of the real hosts are gone"
      : "artwork from the playlist's own hosts, so the network is in every figure below"
  }`,
);
// The address it is actually served at, because 4174 may already be held and the fallback is
// silent. Without this line there is no way to tell which server answered a question about it.
console.log(`             served to the app at ${playlist}`);
if (measuring) {
  console.log(`  machine    load average ${loadavg()[0].toFixed(1)} of ${cpus().length} cores`);
}
console.log(`  ${url}`);

let mainNavigation = { count: 0, url: "not observed", at: 0 };
cdp.on("Page.frameNavigated", ({ frame }) => {
  if (!frame.parentId) {
    mainNavigation = { count: mainNavigation.count + 1, url: frame.url, at: Date.now() };
  }
});
measurementNetwork?.beginAudit();
await cdp.send("Page.navigate", { url });

if (has("bench") || has("budget") || quick) {
  let benchmarkNavigation = 0;
  const ev = async (expression, allowContextLoss = false) => {
    try {
      const response = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      return evaluationValue(response);
    } catch (error) {
      if (allowContextLoss) return null;
      throw new Error(`Page evaluation could not run: ${error.message}`);
    }
  };
  const evaluationFailure = async (error, label, expression) => {
    const state = await ev(`({ url: location.href, readyState: document.readyState })`, true);
    const url = state?.url ?? mainNavigation.url;
    const readyState = state?.readyState ?? "unavailable";
    const navigations = mainNavigation.count - benchmarkNavigation;
    return new Error(
      `${error.message} ${label} evaluated ${expression}. The document was ${readyState} at ${url}. The main frame navigated ${navigations} time${navigations === 1 ? "" : "s"} since the recorder was installed. The last navigation was to ${mainNavigation.url} at ${new Date(mainNavigation.at).toISOString()}.`,
    );
  };
  const readPage = async (label, expression) => {
    try {
      return pageResult(
        await ev(`JSON.stringify({
          url: location.href,
          readyState: document.readyState,
          result: (${expression})
        })`),
        label,
      );
    } catch (error) {
      throw await evaluationFailure(error, label, expression);
    }
  };
  const readBenchmark = async (label, expression) => {
    try {
      return benchmarkResult(
        await ev(`JSON.stringify({
          url: location.href,
          readyState: document.readyState,
          benchmark: typeof window.__bench,
          result: window.__bench && (${expression})
        })`),
        label,
      );
    } catch (error) {
      throw await evaluationFailure(error, label, expression);
    }
  };
  /*
   * Wait for the interface, and time how long it took, rather than assuming eight seconds.
   *
   * Eight was enough for two hundred channels and is not enough for twelve thousand on the
   * floor: the app has to fetch a playlist it has never seen, parse it and lay out a rail of a
   * hundred and seventy five categories, and a fixed wait that runs out mid-parse means the
   * check below declares there is no playlist and the run exits 2. Which is the correct answer
   * to a genuinely absent playlist and the wrong one to a slow one, and the two are worth
   * telling apart rather than picking a bigger constant and hoping.
   *
   * This is also the first launch, cold in every sense: nothing cached, nothing parsed, nothing
   * resumed. Reported rather than budgeted, because it depends on the fixture server and on
   * whatever the app decides to do about caching, and because the launch worth a budget is the
   * ordinary one, measured at the end.
   */
  const readyAt = Date.now();
  const isReady = async () =>
    await ev(
      `document.querySelectorAll(".rail .row").length > 0 && !document.querySelector(".onboard")`,
      true,
    );
  let ready = false;
  while (!ready && Date.now() - readyAt < 90000) {
    await new Promise((r) => setTimeout(r, 250));
    ready = await isReady();
  }
  const firstLaunchMs = Date.now() - readyAt;
  /*
   * There has to be a playlist, and saying so beats measuring the first run screen.
   *
   * The simulator keeps a Chrome profile between runs so a playlist added once stays added,
   * the way it would on a television. Which means the benchmark quietly depends on a
   * directory in /tmp, and when that directory goes the app comes up on its onboarding
   * screen: no rail, no channel list, nothing for any journey to walk. Every phase then
   * reported "window was hidden, nothing measurable here", because no frames is also what an
   * occluded window looks like, and that message sent me looking at window visibility for
   * half an hour.
   *
   * So the two causes are told apart here, before anything is measured, where the difference
   * is still obvious.
   */
  if (!ready) {
    console.error(
      "\nNothing to measure: the app never showed a channel rail.\n\n" +
        "Either the playlist could not be loaded, or ninety seconds was not enough to load\n" +
        "it, which for a playlist this size on this profile would itself be the finding.\n\n" +
        `  ${wantedPlaylist}\n  served at ${playlist}\n`,
    );
    child.kill();
    process.exit(2);
  }
  console.log(
    `\n  first launch, nothing cached: ${(firstLaunchMs / 1000).toFixed(1)}s to a rail`,
  );

  await ev(
    `${readFileSync(join(here, "bench.js"), "utf8")}\n//# sourceURL=openiptv-tv-recorder.js`,
  );
  benchmarkNavigation = mainNavigation.count;

  /**
   * The heap, after collecting, because otherwise it is a coin toss.
   *
   * `usedJSHeapSize` counts whatever V8 has not got round to freeing, so reading it once at the
   * end of a run reports the app's real cost plus however much garbage happened to be lying
   * about at that moment. Between two runs of the same build that difference was several
   * megabytes, which is enough to move a budget set against a 120MB ceiling. Collecting first
   * turns it into a number about the application.
   *
   * Two readings rather than one, because a peak says nothing about a leak. A television is
   * left on the same app for hours: what matters is whether walking the interface for two
   * minutes leaves anything behind, and only a before and an after can say.
   */
  await cdp.send("HeapProfiler.enable").catch(() => {
    /* older protocol, no forced GC */
  });
  const heapState = async () => {
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {
      /* report what V8 says */
    });
    return readBenchmark("heap measurement", "window.__bench.state()");
  };
  let settled = await heapState();

  /**
   * Real key events, through the browser's own input pipeline.
   *
   * This is the whole difference between a benchmark and a comforting number. Events made
   * inside the page skip the delivery work a real press causes, and the earlier version of
   * this reported a clean run on a build that was stuttering visibly.
   */
  const KEYS = {
    down: [40, "ArrowDown"],
    up: [38, "ArrowUp"],
    left: [37, "ArrowLeft"],
    right: [39, "ArrowRight"],
    enter: [13, "Enter"],
    back: [27, "Escape"],
    playPause: [10252, "MediaPlayPause"],
    stop: [413, "MediaStop"],
    0: [48, "0"],
    1: [49, "1"],
    5: [53, "5"],
    8: [56, "8"],
  };
  let sent = 0;
  const press = async (name) => {
    const [code, key] = KEYS[name];
    if (code === 413) {
      await ev(`(() => {
        for (var type of ["keydown", "keyup"]) {
          var event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "keyCode", { get: function () { return 413; } });
          Object.defineProperty(event, "which", { get: function () { return 413; } });
          window.dispatchEvent(event);
        }
        return true;
      })()`);
      sent += 1;
      return;
    }
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", {
        type,
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
        key,
        code: key,
      });
    }
    sent += 1;
  };
  const hold = async (name, milliseconds = 600) => {
    await waitUntil(
      "!document.querySelector('.playback-deck, .playback-drawer, .panel:not(.away), .vod-host:not(.hidden), .settings-host:not(.hidden), [role=\"dialog\"]')",
    );
    const [code, key] = KEYS[name];
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      key,
      code: key,
    });
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    await cdp.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      key,
      code: key,
      autoRepeat: true,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      key,
      code: key,
    });
    sent += 2;
  };

  // Pause 100ms after each dispatched press by default. --gap changes the input pressure.
  const GAP = Number(arg("gap") ?? 100);
  if (!Number.isFinite(GAP) || GAP < 1) throw new Error("--gap must be positive.");
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
  const settle = (ms = quick ? 750 : 3000) => new Promise((r) => setTimeout(r, ms));

  /**
   * The results, kept, because a table printed and forgotten is not a gate.
   *
   * `--budget` turns this from something a person reads into something CI can fail on, and
   * the two must be the same run: a benchmark that only anybody looks at when they suspect
   * a problem is a benchmark that tells you a regression happened some time in the last
   * three months.
   */
  const results = [];
  const unmeasured = [];
  const paintBoundary = () =>
    ev(`new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }));
    })`);
  const printResult = (label, result) => {
    const value = (number) => (number == null ? "-" : number.toFixed(1));
    console.log(
      `  ${label.padEnd(28)}${value(result.fps).padStart(8)}` +
        `${value(result.p95).padStart(9)}${value(result.worst).padStart(9)}` +
        `${value(result.inputP95).padStart(9)}${value(result.worstLag).padStart(9)}` +
        `${value(result.stallTimePercent).padStart(9)}`,
    );
    console.log(`  phase measurement: ${JSON.stringify({ label, ...result })}`);
  };

  /**
   * Resting is watched for long enough to see something.
   *
   * It was forty press intervals, which is 1.3 seconds and about twenty frames on the floor: a
   * sample too short to distinguish an interface that is doing nothing from one doing a little
   * every second. The full gate keeps five seconds, which is enough for a repeating timer to show
   * up twice. The quick local sample uses two seconds because it does not issue a budget verdict.
   */
  const RESTING_MS = quick ? 2000 : 5000;

  /**
   * Wait for the input queue to drain, which is not the same as waiting.
   *
   * A fixed delay cannot prove that the *browser* delivered keys it was holding. A renderer
   * under CPU throttling can queue input for seconds. The
   * presses that walk the harness into the channel list were arriving inside the first timed
   * phase, which then reported nine presses in a phase that presses nothing and eighteen moves
   * against nineteen presses in the phase after it.
   *
   * The page therefore counts delivered keys and reports when it last saw one. The next phase
   * starts only after every key the harness sent has arrived and the queue has stayed quiet.
   */
  const inputDrained = async () => {
    for (let i = 0; i < 40; i++) {
      const state = await readBenchmark(
        "input queue",
        `{
          delivered: window.__bench.delivered,
          quiet: window.__bench.quietFor()
        }`,
      );
      if (state && state.delivered >= sent && state.quiet > 400) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  const phase = async (label, sequence, times, gap = GAP) => {
    await settle();
    if (!(await inputDrained())) {
      console.error(`\n${label}: keys were still arriving ten seconds after the last one was`);
      console.error("sent, so nothing measured here would belong to this phase.");
      child.kill();
      process.exit(2);
    }
    await ev("window.__bench.start()");
    // An empty sequence is the resting case: watch without touching anything, so there is
    // something to read the rest against.
    if (sequence.length) await drive(sequence, times, gap);
    else await new Promise((r) => setTimeout(r, RESTING_MS));
    await paintBoundary();
    const r = await readBenchmark(label, "window.__bench.stop()");
    if (!r?.of || r.hidden) {
      /*
       * Nothing was measured, and that is a failure rather than a footnote.
       *
       * requestAnimationFrame stops entirely for a window the compositor thinks is hidden,
       * so a Chrome that went behind the terminal reports no frames at all. This used to
       * print a line saying so and carry on to a cheerful summary, which is how three of
       * six journeys once vanished from a run nobody noticed was empty. A measurement that
       * did not happen has to be louder than a measurement that came out badly.
       */
      console.log(`  ${label.padEnd(22)}   no visible animation frame sample`);
      unmeasured.push(label);
      return r;
    }
    results.push({ label, ...r });
    printResult(label, r);
    return r;
  };

  // Keep navigation diagnostics while gating the milestones that make startup useful.
  const LAUNCH_ALLOWED = {
    "DOM content loaded": null,
    "first paint": null,
    "the interface": null,
    ...STARTUP_GOALS,
  };

  /*
   * An allowance for every mark and a mark for every allowance, or this table quietly stops
   * applying the day a mark is renamed. The same rule the journey allowances are held to
   * below, and the reason both exist is that a gate which cannot fail is not a gate.
   */
  const marksWithoutAllowance = Object.keys(LAUNCH_MARKS).filter(
    (label) => LAUNCH_ALLOWED[label] === undefined,
  );
  const allowancesWithoutMark = Object.keys(LAUNCH_ALLOWED).filter(
    (label) => LAUNCH_MARKS[label] === undefined,
  );
  if (marksWithoutAllowance.length || allowancesWithoutMark.length) {
    console.error("The launch marks and their allowances have drifted apart:");
    if (marksWithoutAllowance.length) {
      console.error(`  no allowance for: ${marksWithoutAllowance.join(", ")}`);
    }
    if (allowancesWithoutMark.length) {
      console.error(`  no such mark: ${allowancesWithoutMark.join(", ")}`);
    }
    process.exit(2);
  }

  const watcher = launchWatcher();

  /**
   * Start the application again, and time what the viewer waits for.
   *
   * A relaunch rather than the first load of the run, and the difference is worth stating
   * because it is large. Measured on the floor, the first navigation after this Chrome starts
   * reaches the channel rows in 5.4 seconds and a relaunch reaches them in 1.9. Almost none of
   * that gap belongs to the application: a browser that has just started has an empty code
   * cache, an empty disk cache and no compiled stylesheet, and a fresh profile has no playlist
   * downloaded and no channel to resume either.
   *
   * So this measures from the navigation onwards, with the browser already running, which is
   * everything the application actually decides. What it therefore does not measure is the
   * set's own runtime starting up, and nothing here could: that is the platform's second and
   * not ours. The consequence to remember is that the compile cost of the bundle is
   * understated, because V8 still has it cached, and that a before and after must both be
   * relaunches or the comparison is between two different questions.
   *
   * Running last is what makes it a relaunch without pressing anything to arrange one. The
   * journeys above have already played channels, so there is a last channel to resume and
   * artwork in the cache, which is the state a television is in every time after the first.
   *
   * Native playback timing is used throughout, so neither this navigation nor the journeys
   * compile the hls.js engine that a Tizen application would leave to native AVPlay.
   */
  const launch = async () => {
    const quiet = async (expression) => {
      try {
        return await ev(expression);
      } catch {
        return null;
      } // navigating
    };
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: watcher });

    /*
     * Let the old page go first, which is worth more than it sounds.
     *
     * Navigating straight from the application to the application keeps one renderer, so the
     * new document compiles its bundle on the same thread that is tearing the old one down, and
     * the old one is holding twelve thousand channels. Measured that way, "the bundle ran" came
     * out at 2.6 seconds with this playlist against 0.7 with a small one, for a bundle that is
     * byte for byte identical: the difference was entirely the funeral of the previous page.
     *
     * A television does not do that. It starts the application in a fresh runtime with nothing
     * else in it, so about:blank first, and then the launch being measured is a launch.
     */
    await cdp.send("Page.navigate", { url: "about:blank" });
    for (
      let i = 0;
      i < 120 &&
      !(await quiet("location.href === 'about:blank' && document.readyState === 'complete'"));
      i++
    )
      await new Promise((r) => setTimeout(r, 25));

    await cdp.send("Page.navigate", { url });

    const deadline = Date.now() + LAUNCH_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      if (await quiet("!!(window.__launch && window.__launch.done)")) break;
    }
    return readPage("launch marks", "window.__launch && window.__launch.marks");
  };

  await cdp.send("Page.bringToFront");

  /**
   * Put the interface where the next phase needs it, rather than assuming.
   *
   * This used to be `press left, press right` with a comment saying "into the channel panel"
   * and "and into the channel list", and it was right for exactly as long as the application
   * launched with the panel open. When launching changed to resume the last channel with the
   * panel shut, the same two presses opened the panel and then closed it again, so every
   * phase afterwards ran somewhere other than where its label claimed. "Racing the
   * categories" was scrolling the channel list, and reported a healthy number for a journey
   * it was not walking.
   *
   * A benchmark that assumes a starting state measures whatever it happens to find. So each
   * of these presses keys until the document says it has arrived, and says so if it cannot.
   */
  const showing = (selector) => ev(`!!document.querySelector(${JSON.stringify(selector)})`);
  const step = async (key) => {
    await press(key);
    await new Promise((r) => setTimeout(r, 400));
  };

  const ensurePanel = async () => {
    for (let i = 0; i < 4; i++) {
      if (!(await showing(".panel.away"))) return true;
      await step("left");
    }
    return false;
  };
  /** Left off the rail leaves the panel altogether, so arriving may take putting it back. */
  const ensurePane = async (pane) => {
    const towards = pane === "rail" ? "left" : "right";
    for (let i = 0; i < 5; i++) {
      if (!(await ensurePanel())) return false;
      if (await showing(".app-navigation.expanded")) await step("right");
      if (await showing(`.${pane}.focused`)) return true;
      await step(towards);
    }
    return false;
  };

  if (!(await ensurePane("list"))) {
    console.error("\nCould not get into the channel list, so there is nothing to measure.");
    child.kill();
    process.exit(2);
  }
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
  /**
   * Where the rail is, as both of the things that can mean.
   *
   * They are deliberately not the same and the difference is the whole point of the rail's
   * debounce: `cursor` is the highlight, which answers the press, and `showing` is the
   * category the channel column has caught up to, which follows 150ms after the pressing
   * stops. Reading `showing` straight after a phase reads it before it has moved, which is
   * how the check below first came to accuse a correct run of not walking the rail.
   *
   * So the assertion uses the cursor, which is what the presses drive and what proves the
   * keys landed in the rail rather than in the channel list. `showing` is only reported.
   */
  const where = async () =>
    await readPage(
      "category landing state",
      `({
        cursor: (document.querySelector('.rail .row.cursor .row-label')||{}).textContent,
        showing: (document.querySelector('.rail .row.showing .row-label')||{}).textContent,
      })`,
    );

  // Frame cadence and input tails are independent requirements.
  console.log(
    `\n  ${"journey".padEnd(28)}${"mainFPS".padStart(8)}${"frame95".padStart(9)}` +
      `${"maxFrame".padStart(9)}${"input95".padStart(9)}${"maxInput".padStart(9)}` +
      `${"stall%".padStart(9)}`,
  );
  console.log(
    `  goals: ${UI_GOALS.minFps}+ main thread FPS, frame p95 <= ${UI_GOALS.frameP95Ms}ms, ` +
      `input p95 <= ${UI_GOALS.inputP95Ms}ms. Timing columns are milliseconds.`,
  );

  await phase("resting", [], 1);

  /*
   * Racing down the category rail, which is the hardest thing anyone can ask of this app:
   * every press replaces the entire channel list and asks for fifteen logos nobody has seen.
   *
   * The cursor stays in the rail for the whole run. An earlier version pressed left, down,
   * right on a loop, which walked back into the channel list between every category and so
   * changed category at a third of the rate while looking like it was doing more.
   */
  await ensurePane("rail");
  await settle(quick ? 400 : 1500);
  /*
   * Every press has to have moved the highlight, and now that can simply be counted.
   *
   * These two phases are the most expensive thing the application does and the reason the
   * rail waits before handing over a category at all, so a run where they quietly measured
   * something else is worse than a run that failed. That is not hypothetical: changing the
   * launch to resume the last channel with the panel shut meant the presses that used to
   * enter the rail now left it, and "racing the categories" spent a while scrolling the
   * channel list and reporting a healthy figure for a journey it was not walking.
   *
   * What used to stand here was a comparison of the selected category's name before and after,
   * which took two goes to get right: down eighteen and up eighteen returns to where it started
   * by design, so the first version failed on a correct run. It was also weak, since one press
   * landing out of eighteen would have satisfied it.
   *
   * Counting moves against presses in the page needs no comparison, no knowledge of where the
   * walk started and no arithmetic over a list that wraps. Eighteen presses either moved the
   * highlight eighteen times or the phase is not the journey it is named after.
   */
  const mustWalk = (label, r) => {
    if (r && r.presses > 0 && r.distance === r.presses && r.answered === r.presses) return;
    console.error(`\n${label}: ${r?.presses} presses advanced ${r?.distance} rows, so`);
    console.error(`  cursor transitions: ${JSON.stringify(r?.steps ?? [])}`);
    console.error(
      "this phase did not walk the journey it is named after. Either the keys went",
    );
    console.error("somewhere else, or the interface dropped them.");
    child.kill();
    process.exit(2);
  };

  mustWalk("racing the categories", await phase("racing the categories", ["down"], 18));
  mustWalk("and back up again", await phase("and back up again", ["up"], 18));
  const landed = await where();

  // Back into the channels, and hold the key down, which is how people cross a long list.
  if (!(await ensurePane("list"))) {
    console.error("\nCould not get back into the channel list; the phases below would measure");
    console.error("the category rail instead.");
    child.kill();
    process.exit(2);
  }
  await settle(quick ? 400 : 1500);
  /*
   * The full gate goes forty rows down and then the same forty back up. The quick local sample
   * uses fifteen, which is enough to cross a screen without issuing a budget verdict.
   *
   * The pair exists to separate two costs. Going down crosses rows nobody has seen, so it pays
   * for artwork: a fetch from whichever host the broadcaster uses and a decode. Coming back up
   * crosses rows whose logos are now in memory, so it is the interface on its own. One is what a
   * viewer meets exploring a category and the other is what they meet using it, and a gate wants
   * both, separately.
   *
   * With fourteen channels to a category, forty presses wrapped the list three times and the
   * second phase re-walked the same warm rows, exactly as intended. With hundreds to a category
   * it carried on into rows forty to eighty, which are as cold as the first forty were, so the
   * pair measured the same thing twice, the second one over the network, and it became the
   * noisiest phase in the run: 1 stall in three rounds and then 28 in the next, with a press
   * waiting 250ms. Nothing in the app had changed, and no allowance can be set against that.
   *
   * Pressing up rather than down puts it back to the rows just walked, whatever the category's
   * length, and takes the internet out of the phase that is meant to be about the interface.
   */
  mustWalk(
    "holding down a category",
    await phase("holding down a category", ["down"], quick ? 15 : 40),
  );
  mustWalk("the same rows again", await phase("the same rows again", ["up"], quick ? 15 : 40));

  await press("enter");
  await settle(quick ? 1500 : 4000);

  // Surfing, at about the rate someone flicks through channels looking for something.
  await phase("surfing channels", ["up"], quick ? 4 : 10, 900);

  /*
   * One whole visit to the list, repeated five times by the full gate and twice by the quick
   * sample: open it, look at a few rows, choose one. The earlier version opened and shut the
   * panel eight times in a row with nothing in between, which measured a thing nobody does.
   */
  await phase(
    "open, browse, choose",
    ["left", "down", "down", "down", "enter"],
    quick ? 2 : 5,
    450,
  );

  const tryUntil = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await ev(expression, true)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const journey = async (label, action, ready, { kind = "interaction" } = {}) => {
    await settle();
    if (!(await inputDrained())) {
      console.error(`\n${label}: input did not settle before the journey.`);
      child.kill();
      process.exit(2);
    }
    await ev("window.__bench.start()");
    await action();
    if (ready && !(await tryUntil(ready))) {
      console.error(`\n${label}: the expected screen did not appear.`);
      child.kill();
      process.exit(2);
    }
    if (kind === "cold-category") await ev("window.__bench.markReady()");
    await new Promise((r) => setTimeout(r, 600));
    await paintBoundary();
    const result = await readBenchmark(label, "window.__bench.stop()");
    if (!result?.of || result.hidden) {
      unmeasured.push(label);
      return result;
    }
    results.push({ label, kind, ...result });
    printResult(label, { kind, ...result });
    return result;
  };
  const clickNamed = async (name, rootSelector = "body") => {
    await waitForSettingsInput();
    const clicked = await tryUntil(`(() => {
    var matches = function (item) {
      return !item.disabled && item.getClientRects().length > 0
        && (item.getAttribute('aria-label') === ${JSON.stringify(name)}
        || item.textContent.trim() === ${JSON.stringify(name)});
    };
    var button = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(`${rootSelector} button`)})).filter(matches)[0];
    if (!button) return false;
    if (${JSON.stringify(name)} === 'Save') {
      var global = Array.prototype.slice.call(document.querySelectorAll('button')).filter(matches)[0];
      var editor = button.closest('[data-settings-dialog]');
      var globalEditor = global && global.closest('[data-settings-dialog]');
      window.__bench.lastSaveChoice = {
        sameAsGlobal: button === global,
        globalEditor: !!globalEditor && !!globalEditor.querySelector('.lineup-edit-form'),
        editor: !!editor && !!editor.querySelector('.lineup-edit-form'),
        dialog: !!button.closest('[role="dialog"]')
      };
    }
    button.click();
    return true;
  })()`);
    if (!clicked) {
      const controls =
        await ev(`Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(`${rootSelector} button`)}))
        .filter(function (item) { return item.getClientRects().length > 0; })
        .map(function (item) {
          return { label: item.getAttribute('aria-label'), text: item.textContent.trim().slice(0, 100), disabled: item.disabled };
        })`);
      throw new Error(
        `The ${name} button is missing. The visible controls are ${JSON.stringify(controls)}.`,
      );
    }
  };
  const requireScreen = async (expression, label = expression, timeout = 30000) => {
    if (!(await tryUntil(expression, timeout))) {
      const state = await ev(`({
        player: window.webapis.avplay.getState(),
        faults: window.__openiptvTvFaults.snapshot(),
        panel: document.querySelector('.panel')?.className,
        vod: document.querySelector('.vod-host')?.className,
        settings: document.querySelector('.settings-host')?.className,
        info: document.querySelector('.playback-info')?.className,
        infoCause: document.querySelector('.playback-info')?.getAttribute('data-recovery-cause'),
        categoryNames: Array.from(document.querySelectorAll('.vod-host:not(.hidden) .vod-category-name'))
          .map(node => node.textContent),
        management: {
          name: document.querySelector('#lineup-name')?.value,
          number: document.querySelector('#lineup-number')?.value,
          scope: document.querySelector('.lineup-manager') &&
            document.querySelector('.lineup-manager').getAttribute('data-lineup-scope'),
          lastSaveChoice: window.__bench.lastSaveChoice,
          buttons: Array.from(document.querySelectorAll('[data-settings-dialog] button'))
            .map(node => ({ text: node.textContent, disabled: node.disabled })),
          problems: Array.from(document.querySelectorAll('.settings-host:not(.hidden) .field-problem, .settings-host:not(.hidden) [role="alert"], [role="dialog"] .field-problem'))
            .map(node => node.textContent)
        }
      })`);
      throw new Error(
        `${label}: the expected screen did not appear. The current state is ${JSON.stringify(state)}.`,
      );
    }
    return true;
  };
  const waitUntil = (expression, timeout = 30000) =>
    requireScreen(expression, expression, timeout);
  const settingsReady =
    "!!document.querySelector('.settings-host:not(.hidden) .sheet:not(.input-suspended)')";
  const settingsClosed = "!document.querySelector('.settings-host:not(.hidden)')";
  const waitForSettingsInput = () =>
    requireScreen(
      "!document.querySelector('.settings-host:not(.hidden) .content-transition-shade:not([data-phase=\"idle\"])')",
      "Settings content input readiness",
    );
  const clickControl = async (selector) => {
    await waitForSettingsInput();
    const clicked = await ev(`(() => {
      var control = document.querySelector(${JSON.stringify(selector)});
      if (!control || control.disabled || control.getClientRects().length === 0
        || control.getAttribute('aria-disabled') === 'true') return false;
      control.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`The ${selector} control is missing or unavailable.`);
  };
  const openLineupEditor = async (id) => {
    await clickControl(`[data-lineup-edit=${JSON.stringify(id)}]`);
    await requireScreen("!!document.querySelector('#lineup-name')", "Lineup name editor");
  };
  const requireLineupBrowse = (scope) =>
    requireScreen(
      `!document.querySelector('#lineup-name')
        && !!document.querySelector('.lineup-manager[data-lineup-scope="${scope}"][data-lineup-mode="browse"]')`,
      "Saved lineup fields",
    );
  const setChannelVisibility = async (id, visible) => {
    await waitForSettingsInput();
    const changed = await ev(`(() => {
      var rows = Array.prototype.slice.call(document.querySelectorAll('[data-lineup-visibility]'));
      var row = rows.filter(function (node) {
        return node.getAttribute('data-lineup-visibility') === ${JSON.stringify(id)};
      })[0];
      if (!row || row.disabled || row.getAttribute('aria-disabled') === 'true'
        || row.getAttribute('aria-checked') === ${JSON.stringify(String(visible))}) return false;
      row.click();
      return true;
    })()`);
    if (!changed)
      throw new Error("The visibility row is missing or the fixture state is wrong.");
    await requireScreen(
      `(() => {
        var row = Array.prototype.slice.call(document.querySelectorAll('[data-lineup-visibility]'))
          .filter(function (node) {
            return node.getAttribute('data-lineup-visibility') === ${JSON.stringify(id)};
          })[0];
        return !!row && row.getAttribute('aria-checked') === ${JSON.stringify(String(visible))}
          && !row.disabled && row.getAttribute('aria-disabled') !== 'true';
      })()`,
      visible
        ? "Shown channel in visibility management"
        : "Hidden channel in visibility management",
    );
  };
  const openSearch = async () => {
    const clicked = await ev(`(() => {
      var button = document.querySelector('[data-navigation-action="search"]');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!clicked) throw new Error("The Search navigation action is missing.");
    const focused = await tryUntil(`(() => {
      var field = document.activeElement;
      return !!field && field.matches(".search-field") && field.getClientRects().length > 0;
    })()`);
    if (!focused) throw new Error("The Search field did not take focus.");
  };
  const setInputValue = (selector, value) =>
    requireScreen(`(() => {
    var input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const clickVodStart = () =>
    requireScreen(`(() => {
      var button = document.querySelector('.vod-host:not(.hidden) .vod-action');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
  const resetInputBaseline = async () => {
    await ev("window.__bench.delivered = 0; window.__bench.lastKeyAt = 0; true");
    sent = 0;
  };
  const setBenchmarkLocale = async (preference, direction) => {
    await clickControl('[data-navigation-action="settings"]');
    await requireScreen(settingsReady, "Locale settings");
    await clickControl(".settings-host:not(.hidden) .rail-scroll .row");
    await requireScreen(
      `(() => {
      var first = document.querySelector('.settings-host:not(.hidden) .rail-scroll .row');
      return first && first.getAttribute('aria-current') === 'page'
        && !!document.querySelector('.settings-host:not(.hidden) .sheet-body .option-picker-current');
    })()`,
      "Appearance language setting",
    );
    await clickControl(".settings-host:not(.hidden) .sheet-body .option-picker-current");
    const option = `[data-option-picker-popup] .option-picker-option[data-value=${JSON.stringify(preference)}]`;
    await requireScreen(
      `!!document.querySelector(${JSON.stringify(option)})`,
      "Language options",
    );
    await clickControl(option);
    await requireScreen(
      `JSON.parse(localStorage.getItem('openiptv.settings')).locale === ${JSON.stringify(preference)}
      && document.documentElement.dir === ${JSON.stringify(direction)}`,
      "Applied language preference",
    );
    await press("back");
    await requireScreen(settingsClosed, "Locale settings return");
    await requireScreen(
      "!!document.querySelector('.vod-host:not(.hidden) .episode-row.cursor')",
      "Episode focus after locale change",
    );
  };
  const moveFirstLineupRow = async () => {
    await clickControl('[data-lineup-preference="order"]');
    await requireScreen(
      "!!document.querySelector('[data-lineup-order-option=\"custom\"]')",
      "Lineup order settings",
    );
    await clickControl('[data-lineup-order-option="custom"]');
    await requireScreen(
      "!document.querySelector('[data-lineup-order-dialog]') && !!document.querySelector('[data-lineup-preference=\"custom-order\"]:enabled')",
      "Saved Custom Order preference",
    );
    await clickControl('[data-lineup-preference="custom-order"]');
    await requireScreen(
      "document.querySelectorAll('.lineup-manager-list.sorting .lineup-sort-row').length >= 2",
      "Lineup sort list",
    );
    const order = await ev(`Array.prototype.slice.call(
      document.querySelectorAll('.lineup-manager-list.sorting .lineup-sort-row'), 0, 2
    ).map(function (row) { return row.getAttribute('data-sort-id'); })`);
    if (!order[0] || !order[1]) throw new Error("The lineup sort rows have no identities.");
    await clickControl(".lineup-manager-list.sorting .lineup-sort-row");
    await requireScreen(
      "!!document.querySelector('.lineup-sort-row.grabbed')",
      "Grabbed lineup sort row",
    );
    await press("down");
    await press("enter");
    await requireScreen(
      `(() => {
      var rows = document.querySelectorAll('.lineup-manager-list.sorting .lineup-sort-row');
      return rows.length >= 2
        && !document.querySelector('.lineup-sort-row.grabbed')
        && rows[0].getAttribute('data-sort-id') === ${JSON.stringify(order[1])}
        && rows[1].getAttribute('data-sort-id') === ${JSON.stringify(order[0])};
    })()`,
      "Reordered lineup rows",
    );
    await press("back");
    await requireScreen(
      "!!document.querySelector('.lineup-list-header') && !document.querySelector('.lineup-manager-list.sorting')",
      "Lineup sort return",
    );
    return order;
  };

  const xtreamJourneys = createXtreamJourneyTracker();
  const redesignJourneys = createJourneyTracker([
    REDESIGN_JOURNEYS.playbackDeckAndDrawers,
    REDESIGN_JOURNEYS.quickSeekPlayingAndPaused,
    REDESIGN_JOURNEYS.liveDvrAndGoLive,
    REDESIGN_JOURNEYS.recoverySequence,
    REDESIGN_JOURNEYS.recoveryCancellation,
    REDESIGN_JOURNEYS.managementBudget,
    REDESIGN_JOURNEYS.posterBudget,
  ]);
  await ev(`(async function () {
    var db = await new Promise(function (resolve, reject) {
      var request = indexedDB.open('openiptv-personal', 1);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = reject;
    });
    if (!db.objectStoreNames.contains('lineups')) {
      db.close();
      throw new Error('The fixture personal lineup store is missing.');
    }
    await new Promise(function (resolve, reject) {
      var transaction = db.transaction(['lineups'], 'readwrite');
      transaction.objectStore('lineups').put({
        version: 1,
        revision: 0,
        personalisation: {
          channels: {},
          categories: {},
          categoryOrderModes: { live: 'provider', movie: 'provider', series: 'provider' },
          categoryOrders: { live: [], movie: [], series: [] },
          personalCategories: [{
            id: 'benchmark-existing',
            name: 'Measured channels',
            channels: []
          }]
        }
      }, 'sim-xtream');
      transaction.oncomplete = resolve;
      transaction.onerror = reject;
      transaction.onabort = reject;
    });
    db.close();
    return true;
  })()`);
  await ev('sessionStorage.setItem("sim.xtreamJourney", "1")');
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (location.protocol === "about:" || location.protocol === "data:") return;
      localStorage.setItem("openiptv.settings", JSON.stringify({
        playlists: [{
          id: "sim-xtream",
          name: "Xtream fixture",
          source: {
            kind: "xtream",
            server: ${JSON.stringify(fixtureOrigin)},
            username: ${JSON.stringify(XTREAM_FIXTURE.username)},
            password: ${JSON.stringify(XTREAM_FIXTURE.password)},
            output: "m3u8"
          },
          sourceVersion: 2,
          hiddenCategories: [],
          hiddenCategoryMode: "exclude"
        }],
        activePlaylistId: "sim-xtream",
        resumeLast: true,
        panelTimeout: 0,
        showClock: false
      }));
      localStorage.setItem("openiptv.personal", JSON.stringify({
        favourites: [],
        lastPlayed: {
          playlistId: "sim-xtream",
          kind: "live",
          itemKey: "xtream:sim-xtream:live:live-1",
          categoryKey: "live:live-large"
        },
        progress: []
      }));
      localStorage.removeItem("openiptv.last");
      localStorage.removeItem("app:last-mode:sim-xtream");
    })();`,
  });
  const xtreamLaunchAt = Date.now();
  await cdp.send("Page.reload", { ignoreCache: true });
  if (
    !(await tryUntil(
      `(() => {
    var row = document.querySelector(".list .row-label");
    return row && row.textContent === "Live Channel 0001";
  })()`,
      90000,
    ))
  ) {
    const diagnosis = await ev(`(() => {
      var settings = {};
      try { settings = JSON.parse(localStorage.getItem("openiptv.settings")) || {}; } catch (e) {}
      var active = (settings.playlists || []).filter(function (item) {
        return item.id === settings.activePlaylistId;
      })[0] || {};
      return JSON.stringify({
        sourceKind: active.source && active.source.kind,
        server: active.source && active.source.server,
        rows: document.querySelectorAll(".list .row-label").length,
        categories: document.querySelectorAll(".rail .row-label").length,
        screen: document.body.textContent.slice(0, 300)
      });
    })()`);
    console.error(
      "\nThe Xtream fixture did not reach its first live row within ninety seconds.",
    );
    console.error(`  ${diagnosis}`);
    child.kill();
    process.exit(2);
  }
  const xtreamLaunchMs = Date.now() - xtreamLaunchAt;
  console.log(`\n  ${XTREAM_JOURNEYS.liveLaunch}: ${xtreamLaunchMs}ms`);
  xtreamJourneys.complete(XTREAM_JOURNEYS.liveLaunch);
  await ev(
    `${readFileSync(join(here, "bench.js"), "utf8")}\n//# sourceURL=openiptv-tv-recorder.js`,
  );
  benchmarkNavigation = mainNavigation.count;
  sent = 0;
  settled = await heapState();
  await ensurePane("rail");
  mustWalk(
    XTREAM_JOURNEYS.heldRailWalk,
    await phase(XTREAM_JOURNEYS.heldRailWalk, ["down"], 18),
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.heldRailWalk);
  if (!quick) {
    await press("stop");
    await requireScreen(
      "window.webapis.avplay.getState() === 'NONE'",
      "Stopped startup Live session",
    );
    await ev(
      "window.__openiptvTvFaults.reset(); window.__openiptvTvFaults.useControlledPlayback(); window.__openiptvTvFaults.setLiveWindow(40000, 1000000); true",
    );
    await clickControl(".list .row");
    await waitUntil("window.__openiptvTvFaults.snapshot().connections >= 1");
    await ev("window.__openiptvTvFaults.completePrepare(); true");
    await waitUntil(
      "window.webapis.avplay.getState() === 'PLAYING' && !document.querySelector('.panel:not(.away)')",
    );
    await ev("window.webapis.avplay.seekTo(60000, function () {}, function () {}); true");
    await waitUntil("window.webapis.avplay.getCurrentTime() >= 60000");
    const liveSetupSeeks = await ev("window.__openiptvTvFaults.snapshot().seeks.length");
    await press("right");
    await waitUntil("!!document.querySelector('.playback-deck .seekbar [role=\"slider\"]')");
    await clickNamed("Go live");
    await requireScreen(
      `(() => {
    var seeks = window.__openiptvTvFaults.snapshot().seeks;
    return seeks.length === ${Number(liveSetupSeeks) + 1}
      && seeks[seeks.length - 1] >= 990000 && seeks[seeks.length - 1] <= 1000000;
  })()`,
      "Go live from the controlled delayed position",
    );
    await press("back");
    await waitUntil("!document.querySelector('.playback-deck')");
    await hold("enter");
    await waitUntil(`(() => {
    const info = document.querySelector('.playback-info.visible[data-recovery-cause]');
    return info && info.getAttribute('data-recovery-cause') === '';
  })()`);
    const liveConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
    if (liveConnections !== 1)
      throw new Error(`The Live DVR journey opened ${liveConnections} provider connections.`);
    if (await ev("!!document.querySelector('.playback-info.visible')")) {
      await hold("enter");
      await waitUntil("!document.querySelector('.playback-info.visible')");
    }
    await press("stop");
    await waitUntil("!!document.querySelector('.panel:not(.away)')");
    redesignJourneys.complete(REDESIGN_JOURNEYS.liveDvrAndGoLive);
    await ev("window.__openiptvTvFaults.reset(); true");
    await openSearch();
    await waitUntil("!!document.querySelector('.search-field')");
    for (const ch of "3199")
      await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
    await waitUntil(`(() => {
    var row = document.querySelector('.list .row-label');
    return row && row.textContent === 'Live Channel 3199';
  })()`);
    await press("back");
    await waitUntil(
      "document.querySelector('.search-field') && document.querySelector('.search-field').value === ''",
    );
    await press("back");
    await waitUntil("!document.querySelector('.search-field')");
    xtreamJourneys.complete(XTREAM_JOURNEYS.liveSearch);
  }
  await resetInputBaseline();
  await journey(
    XTREAM_JOURNEYS.firstCategoryLoad,
    async () => clickNamed("Movies"),
    vodCategoryReady("movie"),
    { kind: "cold-category" },
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.firstCategoryLoad);
  xtreamJourneys.complete(XTREAM_JOURNEYS.coldPosterGrid);
  await press("right");
  if (!(await tryUntil("!!document.querySelector('.poster-card.cursor')"))) {
    throw new Error("The first VOD poster did not take focus before the grid journey.");
  }
  await resetInputBaseline();
  await journey(
    XTREAM_JOURNEYS.heldGridDirection,
    async () => {
      for (let index = 0; index < 12; index += 1) {
        await press("down");
        await new Promise((resolve) => setTimeout(resolve, GAP));
      }
    },
    "!!document.querySelector('.poster-card.cursor')",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.heldGridDirection);
  redesignJourneys.complete(REDESIGN_JOURNEYS.posterBudget);
  if (quick) await finishBenchmark(true);
  const rememberedPosterPosition = await ev(`(() => {
    var cursor = document.querySelector('.poster-card.cursor');
    return window.__bench.posterPosition(cursor) ?? 0;
  })()`);
  const rememberedCategory = await ev(`(() => {
    var host = document.querySelector('.vod-host:not(.hidden)');
    var selected = host && host.querySelector('.vod-category.selected');
    if (!selected) return null;
    var name = selected.textContent;
    var matches = Array.from(host.querySelectorAll('.vod-category'))
      .filter(function (row) { return row.textContent === name; });
    return matches.length === 1 ? name : null;
  })()`);
  if (typeof rememberedCategory !== "string" || !rememberedCategory) {
    throw new Error("The VOD revisit journey needs one identifiable category origin.");
  }
  if (!Number.isInteger(rememberedPosterPosition) || rememberedPosterPosition <= 1) {
    throw new Error("The VOD restore journey needs a poster beyond the first item.");
  }
  await press("left");
  await requireScreen(vodCategoryReady("movie"), "Active category before restoring focus");
  await press("right");
  await requireScreen(
    `(() => {
      var cursor = document.querySelector('.vod-host:not(.hidden) .poster-card.cursor');
      return window.__bench.posterPosition(cursor) === ${rememberedPosterPosition};
    })()`,
    "Active category poster focus after returning from the rail",
  );
  await journey(
    XTREAM_JOURNEYS.categoryFocusSettle,
    async () => {
      await press("left");
      await press("down");
    },
    `${vodCategoryReady("movie")}
      && document.querySelector('.vod-host:not(.hidden) .vod-category.cursor').textContent
        !== ${JSON.stringify(rememberedCategory)}`,
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.categoryFocusSettle);
  await journey(
    XTREAM_JOURNEYS.cachedCategoryRevisit,
    async () => press("up"),
    `${vodCategoryReady("movie")}
      && document.querySelector('.vod-host:not(.hidden) .vod-category.cursor').textContent
        === ${JSON.stringify(rememberedCategory)}`,
  );
  await press("right");
  if (!(await tryUntil("!!document.querySelector('.poster-card.cursor')"))) {
    throw new Error("The revisited VOD category did not restore grid focus.");
  }
  await resetInputBaseline();
  const restoredPoster = await ev(`(() => {
    var cursor = document.querySelector('.poster-card.cursor');
    return {
      position: window.__bench.posterPosition(cursor) ?? 0,
      loading: !!document.querySelector('.vod-loading, .poster-skeleton')
    };
  })()`);
  if (restoredPoster.position !== 1) {
    throw new Error(
      `The VOD category revisit focused poster ${restoredPoster.position} instead of the first item.`,
    );
  }
  if (restoredPoster.loading)
    throw new Error("The warm poster grid returned to a loading state.");
  xtreamJourneys.complete(XTREAM_JOURNEYS.cachedCategoryRevisit);
  xtreamJourneys.complete(XTREAM_JOURNEYS.warmPosterGrid);
  xtreamJourneys.complete(XTREAM_JOURNEYS.categoryPositionRestore);
  await press("left");
  await requireScreen(
    "!!document.querySelector('.vod-host:not(.hidden) .vod-rail.focused .vod-category.cursor')",
    "Category rail focus before regional retry",
  );
  const failedCategoryVisible = `Array.prototype.some.call(
    document.querySelectorAll('.vod-host:not(.hidden) .vod-category-name'),
    function (item) { return item.textContent.trim() === 'Failed'; })`;
  for (let step = 0; step < 6 && !(await ev(failedCategoryVisible)); step += 1) {
    await press("down");
  }
  await requireScreen(
    `(() => {
      var labels = Array.prototype.slice.call(document.querySelectorAll('.vod-host:not(.hidden) .vod-category-name'));
      var label = labels.filter(function (item) { return item.textContent.trim() === 'Failed'; })[0];
      if (!label) return false;
      label.closest('button').click();
      return true;
    })()`,
    "Failed category before the bulk search index is loaded",
  );
  await waitUntil("!!document.querySelector('.vod-host:not(.hidden) .vod-retry')");
  const retryMessage = await ev("document.querySelector('.poster-grid-region').textContent");
  await clickNamed("Retry");
  await waitUntil(
    "!document.querySelector('.vod-retry') && !!document.querySelector('.poster-grid-region.loading')",
  );
  await waitUntil("!!document.querySelector('.vod-retry')");
  const retriedRegion = await ev(`(() => {
    var retry = document.querySelector('.vod-retry');
    return {
      message: document.querySelector('.poster-grid-region').textContent,
      labelled: retry && retry.textContent.trim() === 'Retry'
    };
  })()`);
  if (!retriedRegion.labelled || retriedRegion.message !== retryMessage) {
    throw new Error("The regional retry did not complete a second failed request in place.");
  }
  xtreamJourneys.complete(XTREAM_JOURNEYS.regionalRetry);
  await press("left");
  await requireScreen(
    "!!document.querySelector('.vod-host:not(.hidden) .vod-rail.focused .vod-category.cursor')",
    "Category rail focus after regional retry",
  );
  const rememberedCategoryVisible = `Array.prototype.some.call(
    document.querySelectorAll('.vod-host:not(.hidden) .vod-category'),
    function (item) { return item.textContent === ${JSON.stringify(rememberedCategory)}; })`;
  for (let step = 0; step < 6 && !(await ev(rememberedCategoryVisible)); step += 1) {
    await press("up");
  }
  await requireScreen(
    `(() => {
      var rows = Array.prototype.slice.call(document.querySelectorAll('.vod-host:not(.hidden) .vod-category'));
      var row = rows.filter(function (item) { return item.textContent === ${JSON.stringify(rememberedCategory)}; })[0];
      if (!row) return false;
      row.click();
      return true;
    })()`,
    "Restore the category after regional retry",
  );
  await requireScreen(
    vodCategoryReady("movie", "grid"),
    "Restored category after regional retry",
  );
  await requireScreen(
    `(() => {
      var cursor = document.querySelector('.vod-host:not(.hidden) .poster-card.cursor');
      return window.__bench.posterPosition(cursor) === 1;
    })()`,
    "First poster after regional retry",
  );
  await journey(
    XTREAM_JOURNEYS.scopedSearchReturn,
    async () => {
      await openSearch();
      for (const ch of "Movie 010")
        await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
    },
    "!!document.querySelector('.vod-search .poster-card')",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.scopedSearchReturn);
  await press("back");
  await press("back");
  await journey(
    XTREAM_JOURNEYS.movieDetail,
    async () => press("enter"),
    "!!document.querySelector('.vod-details .vod-title-row')",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.movieDetail);
  await clickNamed("Add to Favourites");
  await waitUntil(`(() => {
    var button = document.querySelector('.vod-favourite');
    return button && button.getAttribute('aria-pressed') === 'true';
  })()`);
  xtreamJourneys.complete(XTREAM_JOURNEYS.movieDetailsFavourite);

  await ev(
    "window.__openiptvTvFaults.reset(); window.__openiptvTvFaults.useControlledPlayback(); true",
  );
  await clickVodStart();
  await waitUntil("window.__openiptvTvFaults.snapshot().connections >= 1");
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await requireScreen(
    "window.webapis.avplay.getState() === 'PLAYING' && !!document.querySelector('.vod-host.hidden') && !!document.querySelector('.playback-info[data-seekable=\"true\"]')",
    "Interactive finite playback before the first quick seek",
  );
  const quickSeekConnectionsBefore = await ev(
    "window.__openiptvTvFaults.snapshot().connections",
  );
  await press("right");
  await waitUntil(
    "window.__openiptvTvFaults.snapshot().seeks.length === 1 && window.webapis.avplay.getState() === 'PLAYING'",
  );
  await requireScreen(
    "!!document.querySelector('.playback-deck [data-control=\"play-pause\"]:not(:disabled) .icon-pause')",
    "Published playable model after the first seek",
  );
  await press("playPause");
  await waitUntil("window.webapis.avplay.getState() === 'PAUSED'");
  await press("back");
  await waitUntil("!document.querySelector('.playback-deck')");
  await press("right");
  await waitUntil(
    "window.__openiptvTvFaults.snapshot().seeks.length === 2 && window.webapis.avplay.getState() === 'PAUSED'",
  );
  await press("enter");
  await waitUntil("!!document.querySelector('.playback-deck')");
  await press("back");
  await waitUntil("!document.querySelector('.playback-deck')");
  await hold("enter");
  await waitUntil("!!document.querySelector('.playback-info.visible[data-recovery-cause]')");
  const quickSeekConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  const quickSeekCause = await ev(
    "document.querySelector('.playback-info.visible').getAttribute('data-recovery-cause')",
  );
  if (quickSeekConnections !== quickSeekConnectionsBefore || quickSeekCause !== "") {
    throw new Error(
      `The quick seek journey changed connections from ${quickSeekConnectionsBefore} to ${quickSeekConnections} with recovery cause ${quickSeekCause}.`,
    );
  }
  await hold("enter");
  await waitUntil("!document.querySelector('.playback-info.visible')");
  await press("stop");
  await waitUntil("!!document.querySelector('.vod-details')");
  redesignJourneys.complete(REDESIGN_JOURNEYS.quickSeekPlayingAndPaused);
  await ev(
    "window.__openiptvTvFaults.reset(); window.__openiptvTvFaults.useControlledPlayback(); true",
  );

  await clickVodStart();
  await waitUntil("window.__openiptvTvFaults.snapshot().connections >= 1");
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await waitUntil("window.webapis.avplay.getState() === 'PLAYING'");
  const cleanStartConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  await press("enter");
  await waitUntil("!!document.querySelector('.playback-deck')");
  await clickNamed("Audio");
  await waitUntil("!!document.querySelector('.playback-drawer')");
  await press("back");
  await waitUntil(
    "!!document.querySelector('.playback-deck') && !document.querySelector('.playback-drawer')",
  );
  await clickNamed("Subtitles");
  await waitUntil("!!document.querySelector('.playback-drawer')");
  await press("back");
  await waitUntil(
    "!!document.querySelector('.playback-deck') && !document.querySelector('.playback-drawer')",
  );
  await press("back");
  await waitUntil("!document.querySelector('.playback-deck')");
  await hold("enter");
  await waitUntil("!!document.querySelector('.playback-info.visible[data-recovery-cause]')");
  const cleanDiagnosticsConnections = await ev(
    "window.__openiptvTvFaults.snapshot().connections",
  );
  const cleanDiagnosticsCause = await ev(
    "document.querySelector('.playback-info.visible').getAttribute('data-recovery-cause')",
  );
  if (cleanDiagnosticsConnections !== cleanStartConnections || cleanDiagnosticsCause !== "") {
    throw new Error(
      "The playback drawer journey did not preserve its clean controlled origin.",
    );
  }
  await hold("enter");
  await waitUntil("!document.querySelector('.playback-info.visible')");
  redesignJourneys.complete(REDESIGN_JOURNEYS.playbackDeckAndDrawers);
  await press("stop");
  await waitUntil("!!document.querySelector('.vod-details')");
  await ev("window.__openiptvTvFaults.reset(); true");

  await ev("window.__openiptvTvFaults.useControlledPlayback(); true");
  await clickVodStart();
  await waitUntil("window.__openiptvTvFaults.snapshot().connections >= 1");
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await waitUntil("window.webapis.avplay.getState() === 'PLAYING'");
  const recoveryStartConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  await hold("enter");
  await waitUntil("!!document.querySelector('.playback-info.visible')");
  await ev("window.__openiptvTvFaults.emitNetworkFault(); true");
  await waitUntil(
    `window.__openiptvTvFaults.snapshot().connections === ${Number(recoveryStartConnections) + 1}`,
  );
  await waitUntil(
    "(() => { var node = document.querySelector('.playback-info.visible[data-recovery-cause]'); return node && node.getAttribute('data-recovery-cause') === 'engine-network'; })()",
  );
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await waitUntil("window.webapis.avplay.getState() === 'PLAYING'");
  await requireScreen(
    "(() => { var node = document.querySelector('.playback-info.visible[data-recovery-cause]'); return node && node.getAttribute('data-recovery-cause') === ''; })()",
    "Cleared network recovery cause after playback resumes",
  );
  const recoveryConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  if (recoveryConnections !== recoveryStartConnections + 1)
    throw new Error("Sequential recovery opened an unexpected number of provider connections.");
  await hold("enter");
  await waitUntil("!document.querySelector('.playback-info.visible')");
  await press("stop");
  await waitUntil("!!document.querySelector('.vod-details')");
  redesignJourneys.complete(REDESIGN_JOURNEYS.recoverySequence);
  await ev("window.__openiptvTvFaults.reset(); true");

  await ev("window.__openiptvTvFaults.useControlledPlayback(); true");
  await clickVodStart();
  await waitUntil("window.__openiptvTvFaults.snapshot().connections >= 1");
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await waitUntil("window.webapis.avplay.getState() === 'PLAYING'");
  const cancellationStartConnections = await ev(
    "window.__openiptvTvFaults.snapshot().connections",
  );
  await hold("enter");
  await waitUntil("!!document.querySelector('.playback-info.visible')");
  const connectionsAtHide = await ev(
    "window.__openiptvTvFaults.emitNetworkFault(); window.__openiptvTvFaults.setHidden(true); window.__openiptvTvFaults.snapshot().connections",
  );
  if (
    connectionsAtHide < cancellationStartConnections ||
    connectionsAtHide > cancellationStartConnections + 1
  ) {
    throw new Error("The fault opened an unexpected provider connection before hiding.");
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const hiddenConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  if (hiddenConnections !== connectionsAtHide)
    throw new Error("Recovery connected while the application was hidden.");
  await ev("window.__openiptvTvFaults.setHidden(false); true");
  await requireScreen(
    `window.__openiptvTvFaults.snapshot().connections === ${Number(hiddenConnections) + 1}
      && window.webapis.avplay.getState() === 'IDLE'`,
    "Coordinated visible recovery prepare",
  );
  await waitUntil(
    "(() => { var node = document.querySelector('.playback-info.visible[data-recovery-cause]'); return node && node.getAttribute('data-recovery-cause') === 'visibility-restore'; })()",
  );
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await waitUntil("window.webapis.avplay.getState() === 'PLAYING'");
  await requireScreen(
    "(() => { var node = document.querySelector('.playback-info.visible[data-recovery-cause]'); return node && node.getAttribute('data-recovery-cause') === ''; })()",
    "Cleared visibility recovery cause after playback resumes",
  );
  const restoredConnections = await ev("window.__openiptvTvFaults.snapshot().connections");
  if (restoredConnections !== hiddenConnections + 1) {
    throw new Error("Visibility restore opened an unexpected provider connection.");
  }
  await hold("enter");
  await waitUntil("!document.querySelector('.playback-info.visible')");
  await press("stop");
  await waitUntil("!!document.querySelector('.vod-details')");
  redesignJourneys.complete(REDESIGN_JOURNEYS.recoveryCancellation);
  await ev("window.__openiptvTvFaults.reset(); true");

  await press("back");
  await openSearch();
  for (const ch of "Movie 0008")
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
  await waitUntil("!!document.querySelector('.vod-search .poster-card')");
  await requireScreen(
    `(() => {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.vod-search .poster-card'));
    var card = cards.filter(function (item) {
      return item.querySelector('.poster-title').textContent.trim() === 'Movie 0008';
    })[0];
    if (!card) return false;
    card.click();
    return true;
  })()`,
    "Missing metadata search result",
  );
  await requireScreen(
    `(() => {
    var title = document.querySelector('.vod-host:not(.hidden) .vod-details.loaded .vod-detail-title');
    return title && title.textContent.trim() === 'Movie 0008';
  })()`,
    "Loaded missing metadata detail",
  );
  const missingMetadataClean = await ev(`(() => {
    var detail = document.querySelector('.vod-host:not(.hidden) .vod-details.loaded');
    return !!detail && !detail.querySelector('.vod-detail-tags > span, .vod-synopsis, .vod-credit');
  })()`);
  if (!missingMetadataClean)
    throw new Error("Missing metadata journey rendered an invented row.");
  xtreamJourneys.complete(XTREAM_JOURNEYS.missingMetadata);
  await press("back");
  await press("back");
  await clickNamed("Series");
  await requireScreen(vodCategoryReady("series"), "Series first category");
  await press("right");
  if (!(await tryUntil("!!document.querySelector('.poster-card.cursor')"))) {
    throw new Error("The first Series poster did not take focus before details opened.");
  }
  await ev("document.querySelector('.poster-card.cursor').click(); true");
  await waitUntil("!!document.querySelector('.series-actions button')");
  const seriesAction = await ev("!!document.querySelector('.series-actions button')");
  if (!seriesAction) {
    const seriesDiagnosis = await ev(`JSON.stringify({
      text: document.querySelector('.series-details')?.textContent,
      classes: document.querySelector('.series-details')?.className,
      cards: document.querySelectorAll('.poster-card').length
    })`);
    throw new Error(`Series journey has no playable action. ${seriesDiagnosis}`);
  }
  xtreamJourneys.complete(XTREAM_JOURNEYS.seriesContinue);
  await clickNamed("Episodes");
  await requireScreen("!!document.querySelector('.episode-panel')", "Series episode list");
  xtreamJourneys.complete(XTREAM_JOURNEYS.episodeNavigation);
  await clickNamed("Season 2");
  await requireScreen(
    `(() => {
    var selected = document.querySelector('.season-pill[aria-selected="true"]');
    return selected && selected.textContent.trim() === 'Season 2';
  })()`,
    "Second season selection",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.seasonCommit);
  await ev(
    "window.__openiptvTvFaults.reset(); window.__openiptvTvFaults.useControlledPlayback(); true",
  );
  const episodeActivated = await ev(`(() => {
    var season = document.querySelector('.season-pill[aria-selected="true"]');
    var row = document.querySelector('.episode-list .episode-row');
    var reference = row && row.querySelector('.episode-reference');
    if (!season || season.textContent.trim() !== 'Season 2'
      || !reference || reference.textContent.trim() !== '1') return false;
    row.click();
    return true;
  })()`);
  if (!episodeActivated) throw new Error("Season 2 has no first episode to activate.");
  await requireScreen(
    "window.__openiptvTvFaults.snapshot().connections >= 1",
    "Manual episode connection",
  );
  await ev("window.__openiptvTvFaults.completePrepare(); true");
  await requireScreen(
    `(() => {
    var faults = window.__openiptvTvFaults.snapshot();
    return document.querySelector('.vod-host.hidden') &&
      window.webapis.avplay.getState() === 'PLAYING' && faults.seeks.length === 0;
  })()`,
    "Manual episode playback from the beginning",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.manualEpisodeStart);
  await press("stop");
  await requireScreen(
    "window.webapis.avplay.getState() === 'NONE' && !!document.querySelector('.vod-host:not(.hidden) .episode-panel .episode-row.cursor')",
    "Stopped episode and restored episode focus",
  );
  const wheelBefore = await ev(`(() => {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.episode-row'));
    return rows.indexOf(document.querySelector('.episode-row.cursor'));
  })()`);
  await ev(`(() => {
    var list = document.querySelector('.vod-host:not(.hidden) .episode-list');
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    return true;
  })()`);
  await waitUntil(`(() => {
    var rows = Array.prototype.slice.call(document.querySelectorAll('.episode-row'));
    return rows.indexOf(document.querySelector('.episode-row.cursor')) === ${Number(wheelBefore) + 1};
  })()`);
  xtreamJourneys.complete(XTREAM_JOURNEYS.wheelGuard);
  const rtlOrigin = await ev(`(() => {
    var tabs = document.querySelectorAll('.season-pill');
    var rows = document.querySelectorAll('.episode-row');
    return {
      preference: JSON.parse(localStorage.getItem('openiptv.settings')).locale || 'system',
      direction: document.documentElement.dir,
      season: Array.prototype.indexOf.call(tabs, document.querySelector('.season-pill[aria-selected="true"]')),
      episode: Array.prototype.indexOf.call(rows, document.querySelector('.episode-row.cursor'))
    };
  })()`);
  if (rtlOrigin.season <= 0 || rtlOrigin.episode < 0) {
    throw new Error("The RTL journey needs an active episode and a previous season.");
  }
  await setBenchmarkLocale("ar", "rtl");
  await press("right");
  await requireScreen(
    `Array.prototype.indexOf.call(document.querySelectorAll('.season-pill'),
      document.querySelector('.season-pill[aria-selected="true"]')) === ${rtlOrigin.season - 1}
      && !!document.querySelector('.episode-row.cursor')`,
    "RTL previous season",
  );
  await press("left");
  await requireScreen(
    `Array.prototype.indexOf.call(document.querySelectorAll('.season-pill'),
      document.querySelector('.season-pill[aria-selected="true"]')) === ${rtlOrigin.season}
      && Array.prototype.indexOf.call(document.querySelectorAll('.episode-row'),
        document.querySelector('.episode-row.cursor')) === 0`,
    "RTL season return to the first episode",
  );
  await setBenchmarkLocale(rtlOrigin.preference, rtlOrigin.direction);
  xtreamJourneys.complete(XTREAM_JOURNEYS.rtlMovement);
  await press("back");
  await clickNamed("Movies");
  await requireScreen(
    "!!document.querySelector('.vod-host:not(.hidden) .vod-screen[data-mode=\"movie\"] .vod-rail')",
    "Movies catalogue return",
  );
  await journey(
    XTREAM_JOURNEYS.lineupManagement,
    async () => {
      await clickNamed("Settings");
      await requireScreen(settingsReady, "Settings");
      await clickNamed("Content & playlists");
      await requireScreen(
        "!!document.querySelector('[data-settings-focus=\"manage-playlists\"]')",
        "Manage playlists entry",
      );
      await clickControl('[data-settings-focus="manage-playlists"]');
      await requireScreen(
        "!!document.querySelector('.settings-list-body')",
        "Playlist settings",
      );
      await clickControl('[data-settings-focus="playlist-open-sim-xtream"]');
    },
    "!!document.querySelector('.lineup-list-header')",
  );
  if (
    await ev("!!document.querySelector('[data-lineup-action=\"create\"], .lineup-create-dock')")
  ) {
    throw new Error("The lineup journey expects personal category creation to be unavailable.");
  }
  await clickControl('[data-settings-focus="lineup-open-live:live-large"]');
  await requireScreen(
    "!!document.querySelector('.lineup-manager[data-lineup-scope=\"channels\"]')",
    "Live category channels",
  );
  const measuredChannelId = await ev(`(() => {
    var row = document.querySelector('.lineup-manager-list [data-lineup-provider-id]');
    return row && row.getAttribute('data-lineup-provider-id');
  })()`);
  if (typeof measuredChannelId !== "string" || !measuredChannelId) {
    throw new Error("The live category has no identifiable channel to edit.");
  }
  const measuredChannelSelector = `[data-lineup-provider-id=${JSON.stringify(measuredChannelId)}]`;
  const channelContextReady =
    "!document.querySelector('#lineup-name') && !!document.querySelector('.lineup-manager[data-lineup-scope=\"channels\"][data-lineup-mode=\"browse\"]')";
  await openLineupEditor(measuredChannelId);
  await requireScreen("!!document.querySelector('#lineup-number')", "Channel editor");
  await setInputValue("#lineup-name", "Measured Live Channel");
  await setInputValue("#lineup-number", "5001");
  await clickNamed("Save", "[data-settings-dialog]");
  await requireLineupBrowse("channels");
  await requireScreen(channelContextReady, "Saved channel fields");
  await setChannelVisibility(measuredChannelId, false);
  await requireScreen(
    `(() => {
      var action = document.querySelector(${JSON.stringify(measuredChannelSelector)});
      return !!action && !!action.closest('.lineup-row.hidden');
    })()`,
    "Hidden channel row",
  );
  await openLineupEditor(measuredChannelId);
  await requireScreen("!!document.querySelector('#lineup-number')", "Hidden channel editor");
  await clickNamed("Save", "[data-settings-dialog]");
  await requireLineupBrowse("channels");
  await requireScreen(channelContextReady, "Saved hidden channel fields");
  await setChannelVisibility(measuredChannelId, true);
  await requireScreen(
    `(() => {
      var action = document.querySelector(${JSON.stringify(measuredChannelSelector)});
      return !!action && !action.closest('.lineup-row.hidden');
    })()`,
    "Visible channel row",
  );
  const measuredChannelOrder = await moveFirstLineupRow();
  await press("back");
  await requireScreen(
    '!!document.querySelector(\'.lineup-manager[data-lineup-scope="categories"][data-lineup-mode="browse"] .category-kind-selector\')',
    "Category list before editing",
  );
  await openLineupEditor("live:live-large");
  await requireScreen(
    "!!document.querySelector('#lineup-name') && !document.querySelector('#lineup-number')",
    "Category name editor",
  );
  await setInputValue("#lineup-name", "Measured Live Category");
  await clickNamed("Save", "[data-settings-dialog]");
  await requireScreen(
    `(() => {
      var action = document.querySelector('[data-lineup-edit="live:live-large"]');
      var row = action && action.closest('.lineup-row');
      return !document.querySelector('#lineup-name') && !!row
        && row.textContent.indexOf('Measured Live Category') >= 0;
    })()`,
    "Saved category name",
  );
  await requireLineupBrowse("categories");
  const measuredCategoryOrder = await moveFirstLineupRow();
  await clickControl('[data-settings-focus="lineup-open-live:live-large"]');
  await requireScreen(channelContextReady, "Renamed live category context");
  await openLineupEditor(measuredChannelId);
  if (await ev("!!document.querySelector('.lineup-memberships')")) {
    throw new Error("Channel membership editing must remain hidden.");
  }
  await clickNamed("Save", "[data-settings-dialog]");
  await requireLineupBrowse("channels");
  await requireScreen(channelContextReady, "Saved channel without changing memberships");
  const personalPersisted = await ev(`(async function () {
    try {
      var db = await new Promise(function (resolve, reject) {
        var request = indexedDB.open('openiptv-personal', 1);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = reject;
      });
      if (!db.objectStoreNames.contains('lineups')) return false;
      return await new Promise(function (resolve) {
        var request = db.transaction(['lineups'], 'readonly').objectStore('lineups').get('sim-xtream');
        request.onsuccess = function () {
          db.close();
          var record = request.result;
          if (!record || record.version !== 1 || record.revision <= 0) return resolve(false);
          var personal = record.personalisation;
          var channel = personal.channels[${JSON.stringify(measuredChannelId)}];
          var category = personal.categories['live:live-large'];
          var existing = personal.personalCategories.filter(function (item) {
            return item.id === 'benchmark-existing';
          })[0];
          resolve(!!channel && channel.name === 'Measured Live Channel'
            && channel.number === 5001 && channel.hidden !== true
            && !!category && category.name === 'Measured Live Category'
            && category.itemOrderMode === 'custom'
            && category.itemOrder.some(function (item) {
              return item.itemId === ${JSON.stringify(measuredChannelOrder[0])};
            })
            && personal.categoryOrderModes.live === 'custom'
            && personal.categoryOrders.live.some(function (item) {
              return item.itemId === ${JSON.stringify(measuredCategoryOrder[0])};
            })
            && !!existing && existing.name === 'Measured channels'
            && existing.channels.length === 0);
        };
        request.onerror = function () { db.close(); resolve(false); };
      });
    } catch (error) { return false; }
  })()`);
  if (!personalPersisted)
    throw new Error("The lineup journey did not persist its measured edits.");
  await press("back");
  await requireScreen(
    "!!document.querySelector('.category-kind-selector') && !document.querySelector('.lineup-category-context')",
    "Category list return",
  );
  await press("back");
  await requireScreen(
    "!document.querySelector('.lineup-list-header') && !!document.querySelector('.settings-list-body')",
    "Playlist settings return",
  );
  await press("back");
  await requireScreen(
    "!!document.querySelector('[data-settings-focus=\"manage-playlists\"]')",
    "Content and playlist settings return",
  );
  await press("back");
  await requireScreen(settingsClosed, "Closed settings");
  await clickControl('[data-navigation-action="live"]');
  await requireScreen("!!document.querySelector('.panel:not(.away)')", "Live channel list");
  await press("5");
  await press("0");
  await press("0");
  await press("1");
  await press("enter");
  await requireScreen(
    `(() => {
    var marker = document.querySelector('.list .row .playing-dot');
    var row = marker && marker.closest('.row');
    var label = row && row.querySelector('.row-label');
    var number = row && row.querySelector('.ch-number');
    return label && label.textContent === 'Measured Live Channel'
      && number && number.textContent === '5001';
  })()`,
    "Renumbered live channel",
  );
  await clickNamed("Settings");
  await requireScreen(settingsReady, "Reopened settings");
  await clickNamed("Content & playlists");
  await requireScreen(
    "!!document.querySelector('[data-settings-focus=\"manage-playlists\"]')",
    "Manage playlists entry",
  );
  await clickControl('[data-settings-focus="manage-playlists"]');
  await waitUntil("!!document.querySelector('.settings-list-body')");
  await clickControl('[data-settings-focus="playlist-open-sim-xtream"]');
  await requireScreen(
    `(() => {
    var text = document.querySelector('.sheet-body').textContent || '';
    var personalAction = document.querySelector('[data-settings-focus="lineup-open-personal:benchmark-existing"]');
    return text.indexOf('Measured Live Category') >= 0 &&
      !personalAction && text.indexOf('Measured channels') < 0 &&
      text.indexOf('Unavailable personalisation') < 0;
  })()`,
    "Reopened persisted categories",
  );
  await clickControl('[data-settings-focus="lineup-open-live:live-large"]');
  await requireScreen(
    `(() => {
      var action = document.querySelector(${JSON.stringify(measuredChannelSelector)});
      var row = action && action.closest('.lineup-row');
      return !!row && row.textContent.indexOf('Measured Live Channel') >= 0;
    })()`,
    "Reopened persisted channel",
  );
  xtreamJourneys.complete(XTREAM_JOURNEYS.lineupManagement);
  redesignJourneys.complete(REDESIGN_JOURNEYS.managementBudget);

  /*
   * Where the rail ended up, read from the highlight rather than from the column.
   *
   * It used to report `showing`, the category the channel column had caught up to, and printed
   * "undefined" as soon as the playlist was large: that class arrives 150ms after the last
   * press by design, and this line is read at once. The highlight is what the presses drove and
   * it is never behind, which is the same reason the assertions above use it.
   */
  async function finishBenchmark(partial = false) {
    console.log(`\n  walked to: ${landed.cursor ?? "nowhere the rail can name"}`);
    const state = await heapState();
    // Total V8 heap and the configured old space cap describe different allocations.
    console.log(
      `\n  ${XTREAM_JOURNEYS.heapGrowth}: ${state.nodes} nodes, ${state.rows} rows, ` +
        `${state.heapMB}MB heap, project old space cap ${heapMB}MB` +
        `, ${state.heapMB - settled.heapMB >= 0 ? "+" : ""}${state.heapMB - settled.heapMB}MB ` +
        "over the run",
    );
    xtreamJourneys.complete(XTREAM_JOURNEYS.heapGrowth);
    xtreamJourneys.complete(XTREAM_JOURNEYS.vodHeapGrowth);
    if (!partial) {
      xtreamJourneys.assertComplete();
      redesignJourneys.assertComplete();
    } else {
      console.log("  Quick sample covers Live navigation, VOD grid and cached startup.");
      console.log("  Playback fault, detail and management journeys require tv:budget.");
    }
    console.log("  mainFPS estimates main thread cadence, capped at 60, not GPU or video FPS.");
    console.log(
      "  stall% is time in frame gaps over 100ms, not a count dependent on run length.",
    );

    /*
     * Did the playlist survive to the next launch at all?
     *
     * Asked because it is the assumption every number above rests on. A cached playlist means a
     * launch reads 2.7MB off flash; an uncached one means it downloads 2.7MB over the air first,
     * every single time the television is switched on, and no frame time anywhere in this file
     * would say so. It is also silent in the interface by design: the app treats a cache that
     * would not take as nothing worth interrupting a viewer over, which is the right instinct and
     * the reason this needs asking from outside.
     */
    const cached = await ev(`(async function () {
    try {
      var db = await new Promise(function (ok, no) {
        var q = indexedDB.open("openiptv", 1);
        q.onsuccess = function () { ok(q.result); };
        q.onerror = function () { no(new Error("no database")); };
      });
      var settings = JSON.parse(localStorage.getItem("openiptv.settings") || "{}");
      var active = settings.playlists.filter(function (p) {
        return p.id === settings.activePlaylistId;
      })[0];
      if (!active || active.id !== "sim-xtream" || active.sourceVersion !== 2 ||
          active.source.server !== ${JSON.stringify(fixtureOrigin)}) {
        db.close();
        return false;
      }
      var records = await Promise.all(["account", "categories", "live"].map(function (scope) {
        return new Promise(function (ok, no) {
          var q = db.transaction(["values"], "readonly").objectStore("values")
            .get("xtream:sim-xtream:v2:" + scope);
          q.onsuccess = function () { ok(q.result); };
          q.onerror = no;
        });
      }));
      db.close();
      // The fixture deliberately repeats one stream identifier, which normalization removes.
      return records.every(function (record) { return typeof record === "string"; })
        && JSON.parse(records[2]).length === ${XTREAM_FIXTURE.liveCount - 1};
    } catch (e) { return false; }
  })()`);
    console.log(`\n  requested catalogue cached before launch: ${cached ? "yes" : "no"}`);
    const marks = await launch();
    const expectedLaunch = await ev(`(() => {
      const settings = JSON.parse(localStorage.getItem("openiptv.settings"));
      const active = settings.playlists.find(p => p.id === settings.activePlaylistId);
      return active?.id === "sim-xtream" && active.sourceVersion === 2
        && active.source?.server === ${JSON.stringify(fixtureOrigin)}
        && !!document.querySelector(".list .window .row");
    })()`);
    if (!expectedLaunch)
      throw new Error("Cached launch did not restore the requested fixture.");
    console.log(`\n  ${"launch".padEnd(22)}${"ms".padStart(8)}`);
    for (const label of Object.keys(LAUNCH_MARKS)) {
      console.log(
        `  ${label.padEnd(22)}${String(marks[label]?.toFixed(1) ?? "never").padStart(8)}`,
      );
    }
    console.log("  Cached relaunch from navigation, with the last channel known.");
    let control = null;
    if (cpuCalibration) {
      await cdp.send("Page.navigate", { url: "about:blank" });
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        if (
          await ev(
            "location.href === 'about:blank' && document.readyState === 'complete'",
            true,
          )
        ) {
          ready = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!ready) throw new Error("The final CPU control page did not become ready.");
      await cdp.send("Runtime.evaluate", {
        expression: `window.__tvCpuIndex = ${computeBenchmarkIndex.toString()}`,
      });
      const sample = async () =>
        evaluationValue(
          await cdp.send("Runtime.evaluate", {
            expression: "window.__tvCpuIndex(250)",
            returnByValue: true,
          }),
          "Final CPU control",
        );
      // Match the initial warmup so a fresh V8 context does not skew the final control.
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      for (let warmup = 0; warmup < 4; warmup++) await sample();
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await sample();
      const scores = [];
      for (let index = 0; index < 5; index++) scores.push(await sample());
      control = cpuControl(scores, cpuCalibration.targetScore);
      console.log(
        `  CPU control: ${control.achievedScore} against ${cpuCalibration.targetScore}, ` +
          `within ${CPU_TOLERANCE * 100}%: ${control.matches ? "yes" : "no"}`,
      );
    }

    const network = reportNetworkAudit();
    if (!has("budget") && !partial) {
      if (network && (!network.active || network.violations.length)) {
        throw new Error("Network isolation failed. The diagnostic measurements are invalid.");
      }
      child.kill();
      process.exit(0);
    }

    // Only cold category loading substitutes a readiness deadline for the stall share goal.
    // Focus requirements apply where direction keys move it.
    const ALLOWED = {
      resting: {},
      "racing the categories": { focus: true },
      "and back up again": { focus: true },
      "holding down a category": { focus: true },
      "the same rows again": { focus: true },
      "surfing channels": {},
      "open, browse, choose": { focus: true },
      [XTREAM_JOURNEYS.heldRailWalk]: { focus: true },
      [XTREAM_JOURNEYS.firstCategoryLoad]: { kind: "cold-category" },
      [XTREAM_JOURNEYS.heldGridDirection]: { focus: true, presses: 12, distance: 72 },
      [XTREAM_JOURNEYS.categoryFocusSettle]: { focus: true },
      [XTREAM_JOURNEYS.cachedCategoryRevisit]: { focus: true },
      [XTREAM_JOURNEYS.scopedSearchReturn]: {},
      [XTREAM_JOURNEYS.movieDetail]: {},
      [XTREAM_JOURNEYS.lineupManagement]: {},
    };
    const fullOnly = new Set([
      XTREAM_JOURNEYS.categoryFocusSettle,
      XTREAM_JOURNEYS.cachedCategoryRevisit,
      XTREAM_JOURNEYS.scopedSearchReturn,
      XTREAM_JOURNEYS.movieDetail,
      XTREAM_JOURNEYS.lineupManagement,
    ]);
    /** Leave headroom within the project memory stress target. */
    const HEAP_SHARE = 0.5;
    /**
     * How much the heap may grow across one walk of the interface.
     *
     * A peak says nothing about a leak, and a television is left on the same application for
     * hours. Two minutes of walking measures +2MB on this playlist, three rounds running, which is
     * the logo cache filling to its limit and then holding. Eight is loose enough not to argue
     * with a different cache order and tight enough that something genuinely accumulating, a row
     * of listeners or a bitmap per press, would trip it.
     */
    const HEAP_GROWTH_MB = 8;

    if (!calibratedProfile) {
      console.error(
        "\nThe UX gate requires automatic calibration. Add --floor or --reference.",
      );
      child.kill();
      process.exit(2);
    }

    const failures = [];
    if (!network?.isolated || !network.active || network.violations.length) {
      failures.push("network isolation failed or an uncontrolled endpoint was requested");
    }
    if (control && !control.matches) {
      failures.push(
        `the final CPU workload score did not match the estimated TV target within ${CPU_TOLERANCE * 100}%`,
      );
    }
    for (const phase of unmeasured) {
      failures.push(`${phase}: nothing was measured, so nothing was proved`);
    }
    /*
     * Every budget has to have been spent against something.
     *
     * `if (allowed === undefined) continue` quietly exempted any phase whose label had drifted
     * out of this table, and a budget that stops applying when somebody renames a journey is a
     * budget that stops applying. Checked both ways: a phase with no allowance, and an allowance
     * with no phase.
     */
    const measured = new Set([...results.map((r) => r.label), ...unmeasured]);
    for (const label of measured) {
      if (!(label in ALLOWED)) failures.push(`${label}: no allowance for this phase`);
    }
    for (const label of Object.keys(ALLOWED)) {
      if (partial && fullOnly.has(label)) continue;
      if (!measured.has(label))
        failures.push(`${label}: an allowance for a phase that never ran`);
    }
    for (const result of results) {
      const allowed = ALLOWED[result.label];
      if (allowed) failures.push(...assessPhase(result, allowed));
    }
    /*
     * A playlist that cannot be cached is a launch that never gets better.
     *
     * Not a frame time and it belongs here anyway, because it is the difference between a
     * television that comes on in two seconds and one that downloads a few megabytes first, every
     * time, forever. The app is right not to shout about it, so this is where it gets said.
     */
    if (!cached) {
      failures.push(
        "the active catalogue was not cached, so every launch fetches it over the network again",
      );
    }
    /*
     * The launch, mark by mark.
     *
     * A mark that never arrived is the failure worth being loudest about, because it is what a
     * renamed selector looks like and it is indistinguishable from an application that never
     * finished starting. Both mean the launch was not measured, and the whole reason this
     * section exists is that an unmeasured launch has been free to get a second slower.
     */
    for (const [label, allowed] of Object.entries(LAUNCH_ALLOWED)) {
      const at = marks[label];
      if (!Number.isFinite(at) || at <= 0) {
        failures.push(
          `${label}: never happened within ${LAUNCH_DEADLINE_MS / 1000}s, ` +
            "so the launch was not measured",
        );
      } else if (allowed !== null && at > allowed) {
        failures.push(`${label}: ${at}ms into the launch, ${allowed}ms allowed`);
      }
    }
    /*
     * This checks conservative project heap headroom. It cannot account for native browser
     * memory or GPU allocations, and is not a measurement of the TV's total app footprint.
     */
    if (Number.isFinite(state.heapMB) && Number.isFinite(settled.heapMB)) {
      const allowed = Math.round(heapMB * HEAP_SHARE);
      if (state.heapMB > allowed) {
        failures.push(
          `heap: ${state.heapMB}MB against project old space cap ${heapMB}MB, ` +
            `${allowed}MB allowed`,
        );
      }
    } else {
      failures.push("heap: the required memory sample is missing");
      const grew = state.heapMB - settled.heapMB;
      if (grew > HEAP_GROWTH_MB) {
        failures.push(
          `heap: grew ${grew}MB over one walk of the interface, ` +
            `${HEAP_GROWTH_MB}MB allowed`,
        );
      }
    }

    console.log();
    if (failures.length) {
      console.error(
        partial
          ? `${profileLabel} quick sample misses the UX goals:\n`
          : `${profileLabel} UX goals failed:\n`,
      );
      for (const line of failures) console.error(`  ${line}`);
      console.error(
        `\nThese are UX targets under the estimated ${profileLabel.toLowerCase()} profile.`,
      );
      console.error("They are not certification of real TV GPU or decoder performance.");
    } else {
      console.log(
        partial
          ? "Quick sample meets the UX goals. This is not the complete release gate."
          : `${profileLabel} UX goals passed under the estimated TV profile.`,
      );
    }
    child.kill();
    process.exit(failures.length ? 1 : 0);
  }
  await finishBenchmark();
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
      const named = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)].map(
        (m) => m[1],
      );
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
      if (!bundle || bundle === last) return; // half written, or nothing actually changed
      last = bundle;
      try {
        const fullscreenBeforeReload = await cdp
          .send("Runtime.evaluate", {
            expression: "document.fullscreenElement === document.documentElement",
            returnByValue: true,
          })
          .then((response) => response.result?.value === true)
          .catch(() => false);
        await cdp.send("Page.reload", { ignoreCache: true });
        if (fullscreenBeforeReload) {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            try {
              const restored = await cdp.send("Runtime.evaluate", {
                expression: `document.readyState === "complete" && document.documentElement.requestFullscreen
                  ? document.documentElement.requestFullscreen().then(() => true, () => false)
                  : false`,
                awaitPromise: true,
                returnByValue: true,
                userGesture: true,
              });
              if (restored.result?.value === true) break;
            } catch {
              /* the new document has not replaced the old execution context yet */
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        console.log(
          `  reloaded  ${new Date().toLocaleTimeString()}  ${bundle.split("/").pop()}`,
        );
      } catch {
        /* the window has gone */
      }
    }, 900);
  });
}

console.log(`
Leave this running and work in the window. Saving a file rebuilds and reloads it.

  --video       take the app's browser path instead of the Tizen one
  --floor       a host calibrated approximation of a base Samsung TV
  --reference   the estimated Everyday TV performance target, independent of compatibility
  --quick       sample Live, VOD grid and cached startup, then exit
  --profile     keep an isolated measurement environment open for an external profiler
  --cpu-score=N override the estimated workload target for diagnostics
  --harsh=N     divide the processor, heap, cores and memory by N
  --net=3g      throttle the connection, which is otherwise left alone
  --cors        restore the same origin policy the TV does not have

Ctrl+C to stop.`);

// Chrome closing is the other way this ends, and leaving a dead terminal open helps nobody.
cdp.on("Inspector.detached", () => process.exit(0));
child.on("exit", () => process.exit(0));
