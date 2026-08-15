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
 *   node scripts/tv/sim.mjs --playlist=http://... measure against that instead of the default
 *   node scripts/tv/sim.mjs --harsh            half the TV's hardware, on every axis
 *   node scripts/tv/sim.mjs --floor           the weakest set Samsung sells, not yours
 *   node scripts/tv/sim.mjs --fit             lay out for this screen, not the set's 1080p
 *   node scripts/tv/sim.mjs --harsh=4          a quarter of it
 *   node scripts/tv/sim.mjs --harsh --software no GPU either, so paint cost shows up
 *   node scripts/tv/sim.mjs --video           real playback, at the cost of the Tizen paths
 *   node scripts/tv/sim.mjs --net=off         no network throttling, even in harsh mode
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, arch, loadavg } from "node:os";
import { connect, findChrome, arg, has, factor } from "./cdp.mjs";
import { LAUNCH_MARKS, LAUNCH_DEADLINE_MS, launchWatcher } from "./launch-marks.mjs";

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
const PLAYLIST_CACHE = join(tmpdir(), "simpleiptv-tv-sim-playlist.m3u");
const PLAYLIST_TTL_MS = 24 * 60 * 60 * 1000;

/** Anything started here dies with this process, however it ends. */
const spawnChild = (command, args) => {
  const proc = spawn(command, args, { cwd: root, stdio: "ignore", shell: false });
  children.push(proc);
  return proc;
};
const killChildren = () => children.forEach((c) => { try { c.kill(); } catch { /* gone */ } });
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
 * The playlist, fetched once and then served from here.
 *
 * A refusal is fatal on a cold machine and survivable on a warm one, which is the honest
 * ordering: a benchmark with no playlist has nothing to measure and should say so rather than
 * report the onboarding screen, and a benchmark with yesterday's copy is a benchmark.
 */
const wantedPlaylist = arg("playlist") ?? BENCHMARK_PLAYLIST;
const cachedFrom = `${PLAYLIST_CACHE}.from`;
const held = existsSync(PLAYLIST_CACHE) && existsSync(cachedFrom)
  && readFileSync(cachedFrom, "utf8") === wantedPlaylist;
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
  ihdr[8] = 8;            // bit depth
  ihdr[9] = 2;            // truecolour
  // Three flat bands in a colour of its own, plus a corner block, so twelve of these are
  // obviously twelve different pictures at a glance and none of them is a grey placeholder.
  const wheel = [
    [230, 60, 60], [230, 140, 40], [220, 200, 50], [140, 200, 60],
    [60, 190, 110], [50, 190, 200], [60, 130, 220], [90, 90, 230],
    [160, 80, 220], [220, 70, 180], [120, 120, 130], [40, 60, 80],
  ][hue % LOGO_HUES];
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    raw[row] = 0;         // no filter, so the encoder stays this short
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
 * Encoded on first request and then kept, rather than all of them up front.
 *
 * Thirty six large images is a couple of seconds of deflate, and a run that walks eighteen
 * categories asks for a handful of them. Building them on demand keeps that off the start of
 * every run, including the runs that are not measuring anything.
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
const fixture = createServer((request, response) => {
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
const playlist = `http://localhost:${fixture.address().port}/playlist.m3u`;
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
    return `tvg-logo="http://localhost:${fixture.address().port}/logo/${nth++}/${size}.png"`;
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
  console.error("\n--fit lays the app out for this screen rather than the set's 1920x1080, which");
  console.error("changes both the pixels per frame and how many rows a column holds, so it cannot");
  console.error("be combined with a measurement. Drop one of them.\n");
  process.exit(2);
}
/* It used to take a factor, when it scaled the page instead of resizing the layout, and a value
   now means nothing. Said out loud rather than ignored, or `--fit=0.8` looks like it did something
   and the header is the only thing that would have disagreed. */
if (arg("fit") !== undefined) {
  console.log(`  note       --fit takes no value any more; ${arg("fit")} ignored, the window is `
    + "whatever this display allows");
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

/**
 * Wait for the machine to be quiet, because a measurement is not entitled to assume it is.
 *
 * The gate's own documented sequence is `npm run build && npm run tv:budget`, and on this laptop
 * a build leaves the endpoint protection scanning changed files with a load average of five or
 * six for minutes afterwards. That is not a footnote: of five runs of the same build, the four
 * on a quiet machine measured 0 or 1 stalls in every interface phase and the one taken straight
 * after a build measured eleven. A gate that fails because a virus scanner was busy is a gate
 * people learn to rerun until it passes, which is worse than not having one.
 *
 * So it waits, rather than compensating. There is no honest way to subtract someone else's CPU
 * time from a frame time, and a benchmark that waits ninety seconds and then measures something
 * true is worth more than one that answers immediately and sometimes lies.
 *
 * Checked before Chrome starts, because afterwards our own renderer is part of the load and the
 * threshold would have to guess at how much. Reported either way, so a run always records the
 * conditions it was taken under.
 */
/** Set when a measurement had to go ahead on a busy machine, so the verdict can say so. */
let busyWarning = null;
if (measuring) {
  /*
   * Waiting for the load to stop falling, rather than for it to reach a number.
   *
   * An absolute threshold cannot be written down here, because it would have to be right for
   * this laptop, a colleague's, and a two core CI runner. The first version asked for a load
   * average under 2 and this machine idles at 2.3, so every run waited the full two minutes and
   * then warned: a check that can never pass is worse than no check, since the only thing it
   * teaches is to ignore it.
   *
   * What is portable is the shape. A build's aftermath is a load average on its way down, and
   * the one minute average takes about a minute to drain, so a sample that is no longer falling
   * means whatever was happening has finished. On an already quiet machine the first pair of
   * samples agree and this costs three seconds.
   */
  const started = Date.now();
  let load = loadavg()[0];
  let dots = false;
  while (Date.now() - started < 120000) {
    await new Promise((r) => setTimeout(r, 3000));
    const now = loadavg()[0];
    const falling = load - now > 0.1;
    load = now;
    if (!falling) break;
    if (!dots) process.stdout.write("  waiting for the machine to settle");
    dots = true;
    process.stdout.write(".");
  }
  if (dots) process.stdout.write("\n");

  /*
   * Settled and still busy is a different thing, and worth saying rather than waiting out.
   *
   * A quarter of the cores, not half, and the number was moved by being measured. Half was chosen
   * by feel and let three runs through that were plainly noise: at a load of 2.1 this app reached
   * its channel rows in 3969ms and compiled its bundle in 853ms, and at 3.5 to 4.3 on the same
   * eleven core machine the same build took 5226ms and 1683ms. A third slower, on a measurement
   * whose allowances are set a third above the worst quiet run, is the difference between a gate
   * that means something and a gate that fails on a Tuesday afternoon.
   *
   * A warning rather than a refusal, because the numbers are still worth printing and the person
   * reading them can judge. Said in the verdict as well as the header, since by then the header
   * has scrolled away.
   */
  busyWarning = load > cpus().length / 4
    ? `the machine was busy throughout (load ${load.toFixed(1)} of ${cpus().length} cores), `
      + "so read these as noise rather than as a regression"
    : null;
}

// A stable profile, so a playlist added once stays added, the way it would on the set.
const userDir = join(tmpdir(), "simpleiptv-tv-sim");
mkdirSync(userDir, { recursive: true });
const child = spawn(chrome, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDir}`,
  /* Sized to the set when the set's resolution is being simulated, and left to fill the display
     when it is not: a 1920 wide window on a 1512 wide screen is exactly what --fit is for
     getting rid of. */
  ...(fit ? ["--start-maximized"] : [`--window-size=${profile.width},${profile.height}`]),
  // The set's own JS heap ceiling. Overrun it here and it would overrun there.
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
  "--disable-features=CalculateNativeWinOcclusion",
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
   * Two settings a measurement must not be at the mercy of.
   *
   * `panelTimeout` defaults to four seconds, and once a channel is playing the app arms a
   * timer to put the panel away. The channel list phases settle for three seconds and then
   * press forty times, twice, so they cross that comfortably: the panel could close halfway
   * through a phase named after scrolling it, and nothing rechecked. `showClock` defaults on
   * and re-renders every second, which is work arriving during `resting`, whose whole job is
   * to be the number everything else is read against.
   *
   * Both only when measuring. Someone working in `npm run tv` wants the application's real
   * defaults, clock included.
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
    var KEY = "simpleiptv.settings";
    var settings = {};
    try { settings = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { settings = {}; }
    var url = ${JSON.stringify(playlist)};
    var active = (settings.playlists || []).filter(function (p) {
      return p.id === settings.activePlaylistId;
    })[0];
    if (!active || (${measuring} && active.url !== url)) {
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
          localStorage.removeItem("simpleiptv.last");
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
  + `${floor ? `, ie ${profile.slowerThanReference}x slower than the reference set` : ""} (${trust})`);
console.log(`  heap       ${heapMB}MB${harsh > 1 ? ` of ${profile.jsHeapLimitMB}MB` : ""}`);
console.log(`  cores      ${cores}${harsh > 1 ? ` of ${profile.cores}` : ""}`
  + `, though only the main thread is slowed`);
console.log(`  memory     ${memoryGB}GB${harsh > 1 ? ` of ${profile.deviceMemoryGB}GB` : ""}`);
console.log(`  network    ${netProfile ? `${netProfile.mbps.toFixed(1)}Mbps, ${netProfile.latency}ms` : "unthrottled, as the set's wifi effectively is"}`);
console.log(`  screen     ${fit
  ? "this display, not the set's 1920x1080, so the layout is not the set's either"
  : `${profile.width}x${profile.height}`}`
  + `${headless ? ", headless" : ""}${has("software") ? ", software rendering" : ""}`);
console.log(`  player     ${video
  ? "the app's own browser path, Tizen paths skipped"
  : `AVPlay carried out by hls.js, Tizen paths live${engine ? "" : ", no engine found so no decode"}`}`);
console.log(`  playlist   ${shape.channels} channels, ${shape.categories} categories, `
  + `${shape.logos} logos, ${Math.round(playlistText.length / 1024)}KB`);
console.log(`             ${wantedPlaylist}`);
console.log(`             ${measuring && !has("real-logos")
  ? "artwork served locally at 400 to 1200px, since most of the real hosts are gone"
  : "artwork from the playlist's own hosts, so the network is in every figure below"}`);
// The address it is actually served at, because 4174 may already be held and the fallback is
// silent. Without this line there is no way to tell which server answered a question about it.
console.log(`             served to the app at ${playlist}`);
if (measuring) {
  console.log(`  machine    load average ${loadavg()[0].toFixed(1)} of ${cpus().length} cores`);
}
console.log(`  ${url}`);

await cdp.send("Page.navigate", { url });

if (has("bench") || has("profile")) {
  const ev = async (expression) => {
    try {
      return (await cdp.send("Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: true,
      })).result.value;
    } catch {
      return null;   // navigating, so there is no context to ask yet
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
  const isReady = async () => await ev(
    `document.querySelectorAll(".rail .row").length > 0 && !document.querySelector(".onboard")`,
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
  console.log(`\n  first launch, nothing cached: ${(firstLaunchMs / 1000).toFixed(1)}s to a rail`);

  await ev(readFileSync(join(here, "bench.js"), "utf8"));

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
  await cdp.send("HeapProfiler.enable").catch(() => { /* older protocol, no forced GC */ });
  const heapState = async () => {
    await cdp.send("HeapProfiler.collectGarbage").catch(() => { /* report what V8 says */ });
    return JSON.parse(await ev("JSON.stringify(window.__bench.state())"));
  };
  const settled = await heapState();

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

  /**
   * How fast the presses come, which is a claim about a remote and was never checked.
   *
   * 33ms is thirty presses a second. No Samsung remote repeats at anything like that: Samsung
   * publishes no figure, and every set anyone has held waits about half a second and then
   * repeats somewhere around ten a second. So this is between three and four times faster than
   * the fastest thing a viewer can do with a finger.
   *
   * Kept anyway, at a rate now labelled for what it is, because the honest reading of it
   * changed rather than the number. It is not "a held key", it is "presses arriving faster than
   * the interface can possibly draw them", and that is worth measuring: it is what a viewer
   * holding a key on a slower set than this one looks like, and the app's answer to it must be
   * to stay level rather than to fall behind. The press to move latency this now records is
   * what says whether it does.
   *
   * A realistic rate would not say much. One press every 120ms against a 95th percentile frame
   * of around 100ms leaves the interface a frame per press, so the backlog these two phases are
   * named after never forms and there is nothing to see. `--gap=120` is there for the day
   * somebody wants to check that rather than take it on trust.
   */
  const GAP = Number(arg("gap") ?? 33);
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

  /**
   * Resting is watched for long enough to see something.
   *
   * It was forty press intervals, which is 1.3 seconds and about twenty frames on the floor: a
   * sample too short to distinguish an interface that is doing nothing from one doing a little
   * every second. Five seconds is still nothing next to how long a television actually sits
   * with nobody touching it, and it is enough for a repeating timer to show up twice.
   */
  const RESTING_MS = 5000;

  /**
   * Wait for the input queue to drain, which is not the same as waiting.
   *
   * `settle` gives the application time to finish its work. It cannot give the *browser* time to
   * deliver keys it is still holding: a renderer throttled sixty times over queues input, and on
   * a busy machine it queues it for seconds. The presses that walk the harness into the channel
   * list were arriving inside the first timed phase, which then reported nine presses in a phase
   * that presses nothing and eighteen moves against nineteen presses in the phase after it.
   *
   * Three seconds of settling was not enough because settling is measured here and the queue is
   * over there. Asking the page when it last saw a key is the only reliable answer.
   */
  const inputDrained = async () => {
    for (let i = 0; i < 40; i++) {
      if ((await ev("window.__bench.quietFor()")) > 400) return true;
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
    const r = await ev("JSON.stringify(window.__bench.stop())").then(JSON.parse);
    if (!r || !r.of || r.hidden) {
      /*
       * Nothing was measured, and that is a failure rather than a footnote.
       *
       * requestAnimationFrame stops entirely for a window the compositor thinks is hidden,
       * so a Chrome that went behind the terminal reports no frames at all. This used to
       * print a line saying so and carry on to a cheerful summary, which is how three of
       * six journeys once vanished from a run nobody noticed was empty. A measurement that
       * did not happen has to be louder than a measurement that came out badly.
       */
      console.log(`  ${label.padEnd(22)}   window was hidden, nothing measurable here`);
      unmeasured.push(label);
      return r;
    }
    results.push({ label, ...r });
    const dash = (v) => (v === null ? "-" : String(v));
    console.log(`  ${label.padEnd(22)}${String(r.median).padStart(7)}${String(r.p95).padStart(7)}`
      + `${String(r.stalls).padStart(7)}${dash(r.lag).padStart(7)}${dash(r.worstLag).padStart(7)}`
      + `${(r.lag === null ? "-" : String(r.slow)).padStart(6)}`
      + `${(r.presses && r.hadCursor ? `${r.moves}/${r.presses}` : "-").padStart(8)}`);
    return r;
  };

  /**
   * The launch, which is the one journey every viewer takes and the only one nothing measured.
   *
   * Everything above starts three seconds after the application is already up, so a second
   * added to the time between the viewer pressing the button and the channel list appearing
   * would not have moved a single number in this file. That is the most visible second in the
   * application. Measured on the floor with the playlist cached it is around two of them.
   *
   * Four marks rather than one, because "it took two seconds" does not say what to fix and
   * these do. First paint is the engine getting anything at all onto the screen, which is
   * mostly the cost of compiling and running the bundle. The interface is React having
   * rendered. The rows are the playlist having been read off flash and parsed. The name is
   * the resumed channel being announced, which is the point the set stops looking broken.
   *
   * The selector and the allowance sit together on purpose. The journey budget keeps its
   * labels in two places, the phase calls and the STALLS table, which is why it needs three
   * assertions to catch a label drifting out of one of them. There is nothing to drift here:
   * this table is what the page watches for and what the budget spends against.
   *
   * The allowances are the floor's, like the journey table's, and about a third above the worst
   * of three rounds: the bundle ran at 853 to 1123ms, the rows arrived at 3969 to 4347.
   *
   * They are a ceiling on what the application does today and emphatically not a target. Five
   * seconds to a channel list is a bad launch, and writing it into a budget is how it stops
   * getting worse while it is being worked on, which is a different job from making it good. The
   * marks are split five ways so that the work has somewhere to aim: a second of it is the
   * bundle being compiled before the app exists, and two and a half more are between the
   * interface appearing and the rows arriving, which is the playlist being read off flash and
   * parsed. Neither of those is a mystery and neither is measured anywhere else.
   */
  /*
   * What each mark is allowed to cost on the floor. The marks themselves are defined in
   * launch-marks.mjs, because on-set.mjs measures the same five on a real television, where
   * these allowances mean nothing: they are this profile's, about a third above the worst of
   * three quiet rounds.
   */
  const LAUNCH_ALLOWED = {
    "the bundle ran": 1500,
    "first paint": 1600,
    "the interface": 2000,
    "the channel rows": 5800,
    "the channel named": 6200,
  };

  /*
   * An allowance for every mark and a mark for every allowance, or this table quietly stops
   * applying the day a mark is renamed. The same rule the journey allowances are held to
   * below, and the reason both exist is that a gate which cannot fail is not a gate.
   */
  const marksWithoutAllowance = Object.keys(LAUNCH_MARKS)
    .filter((label) => LAUNCH_ALLOWED[label] === undefined);
  const allowancesWithoutMark = Object.keys(LAUNCH_ALLOWED)
    .filter((label) => LAUNCH_MARKS[label] === undefined);
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
   * One known overstatement, left in deliberately and worth knowing the size of. The simulator
   * puts hls.js into every document to carry out AVPlay's calls, which is half a megabyte of
   * script the television never compiles, since its decoder is native. Measured without it in
   * the page, the rows arrive at 1197ms against 1462 to 1656 with it, so these marks are
   * pessimistic by something like a quarter of a second.
   *
   * Taking it out only for this navigation was tried on paper and is worse. Without an engine
   * the shim falls back to a plain <video>, Chrome cannot play HLS, and the resumed channel
   * fails: the launch being measured would then draw a fault card and start a retry, which is
   * not the launch anybody gets. A uniform overstatement that can be stated in a comment beats
   * a different application being measured, which is the same trade the GPU and the demuxer
   * are already on the wrong side of.
   */
  const launch = async () => {
    const quiet = async (expression) => {
      try { return await ev(expression); } catch { return null; }   // navigating
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
    await new Promise((r) => setTimeout(r, 3000));

    await cdp.send("Page.navigate", { url });

    const deadline = Date.now() + LAUNCH_DEADLINE_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      if (await quiet("!!(window.__launch && window.__launch.done)")) break;
    }
    return JSON.parse(await quiet("JSON.stringify((window.__launch || {}).marks || {})") ?? "{}");
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
  const where = async () => (await ev(`JSON.stringify({
    cursor: (document.querySelector('.rail .row.selected .row-label')||{}).textContent,
    showing: (document.querySelector('.rail .row.showing .row-label')||{}).textContent,
  })`));

  /*
   * Frame times first, then the two columns that say whether the remote was answered.
   *
   * `lag` is the median milliseconds from a press to the frame the highlight moved in, and
   * `worst` beside it is the slowest one of the phase. `keys` is moves against presses: forty
   * out of forty walked forty rows, and anything less did not walk the journey it is named
   * after. The frame worst has gone, because between the 95th percentile and the stall count it
   * was never the number anybody read, and these two are worth the width.
   */
  console.log(`\n  ${"journey".padEnd(22)}${"frame".padStart(7)}${"p95".padStart(7)}`
    + `${"stalls".padStart(7)}${"lag".padStart(7)}${"worst".padStart(7)}${"slow".padStart(6)}`
    + `${"keys".padStart(8)}`);

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
  await settle(1500);
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
    if (!r || r.moves === r.presses) return;
    console.error(`\n${label}: ${r.presses} presses moved the highlight ${r.moves} times, so`);
    console.error("this phase did not walk the journey it is named after. Either the keys went");
    console.error("somewhere else, or the interface dropped them.");
    child.kill();
    process.exit(2);
  };

  mustWalk("racing the categories", await phase("racing the categories", ["down"], 18));
  mustWalk("and back up again", await phase("and back up again", ["up"], 18));
  const landed = JSON.parse(await where());

  // Back into the channels, and hold the key down, which is how people cross a long list.
  if (!(await ensurePane("list"))) {
    console.error("\nCould not get back into the channel list; the phases below would measure");
    console.error("the category rail instead.");
    child.kill();
    process.exit(2);
  }
  await settle(1500);
  /*
   * Forty rows down and then the same forty back up, which is what the second label always
   * claimed and stopped being true the moment the playlist got real.
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
  mustWalk("holding down a category", await phase("holding down a category", ["down"], 40));
  mustWalk("the same rows again", await phase("the same rows again", ["up"], 40));

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

  /*
   * Where the rail ended up, read from the highlight rather than from the column.
   *
   * It used to report `showing`, the category the channel column had caught up to, and printed
   * "undefined" as soon as the playlist was large: that class arrives 150ms after the last
   * press by design, and this line is read at once. The highlight is what the presses drove and
   * it is never behind, which is the same reason the assertions above use it.
   */
  console.log(`\n  walked to: ${landed.cursor ?? "nowhere the rail can name"}`);
  const state = await heapState();
  // Against the set's ceiling rather than V8's, which reports the old space cap plus the
  // other spaces and so says 216MB when it has been given 120.
  console.log(`\n  ${state.nodes} nodes, ${state.rows} rows, `
    + `${state.heapMB}MB heap of the set's ${heapMB}MB`
    + `, ${state.heapMB - settled.heapMB >= 0 ? "+" : ""}${state.heapMB - settled.heapMB}MB `
    + "over the run");
  console.log("  stalls counts frames past 100ms, the point the guidance says a viewer");
  console.log("  must be told something is happening.");

  const marks = await launch();
  console.log(`\n  ${"launch".padEnd(22)}${"ms".padStart(8)}`);
  for (const label of Object.keys(LAUNCH_MARKS)) {
    console.log(`  ${label.padEnd(22)}${String(marks[label] ?? "never").padStart(8)}`);
  }
  console.log("  a relaunch, with the last channel known, which is what a launch is");
  console.log("  every time after the first.");

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
        var q = indexedDB.open("simpleiptv", 1);
        q.onsuccess = function () { ok(q.result); };
        q.onerror = function () { no(new Error("no database")); };
      });
      var keys = await new Promise(function (ok) {
        var q = db.transaction(["values"], "readonly").objectStore("values").getAllKeys();
        q.onsuccess = function () { ok(q.result); };
        q.onerror = function () { ok([]); };
      });
      return keys.filter(function (k) { return String(k).indexOf("playlist:") === 0; }).length > 0;
    } catch (e) { return false; }
  })()`);
  console.log(`\n  playlist cached for the next launch: ${cached ? "yes" : "no"}`);

  if (!has("budget")) {
    child.kill();
    process.exit(0);
  }

  /*
   * The budget, which applies to the floor only, and now spends on two things per phase.
   *
   * One profile, because the floor is the weakest set in the supported range and every newer
   * one is faster, so a budget met there is met everywhere and seven budgets would be six ways
   * to argue about the wrong thing.
   *
   * `stalls` counts frames past 100ms, because the median was always fine: the interface was
   * never uniformly slow, it froze for a third of a second at a time, and 100ms is the point
   * Samsung's own guidance says the viewer has to be told something is happening.
   *
   * `lag` and `slow` are the new half and the half that is actually about the viewer. The first
   * is the median milliseconds from a press to the frame the highlight moved in, the second
   * counts the presses that took longer than 100ms, and between them they answer the only
   * question somebody holding a remote is asking. A phase can hold a tidy frame time while
   * running four presses behind the finger, and frame times alone call that a pass.
   *
   * Every number below is measured rather than chosen: three rounds on this laptop, then about a
   * third above the worst of them. The three rounds agreed closely once the starting state was
   * pinned, which is why these are tighter than the ones they replace.
   */
  const ALLOWED = {
    resting: { stalls: 1 },
    /*
     * Higher than they were, and the numbers went up because the benchmark stopped being wrong.
     *
     * Two things moved them. Pinning the starting state took a stream off the main thread during
     * these phases, which made them repeatable, and serving the artwork locally made every logo
     * actually arrive. Under the old arrangement most of the playlist's logos were dead links
     * that failed in milliseconds, so the phases were measuring an interface with almost no
     * artwork in it and reporting 0 or 1 stalls. With every row's logo resolving, a 1200px PNG
     * is decoded, resampled into a 76x48 box, drawn to a canvas and written to flash for every
     * row the highlight crosses, and that is the real cost of scrolling this list.
     *
     * So these are honest and they are not good: twelve to twenty four stalls in a scroll, and a
     * press occasionally waiting over 100ms. That is the next thing to fix rather than the next
     * thing to allow for, and the allowances are set where they are so the fix can be measured
     * rather than argued about.
     */
    "racing the categories": { stalls: 4, lag: 60, slow: 2 },
    "and back up again": { stalls: 4, lag: 60, slow: 2 },
    "holding down a category": { stalls: 16, lag: 75, slow: 3 },
    "the same rows again": { stalls: 30, lag: 85, slow: 5 },
    /*
     * These two start streams, and in this simulator that is hls.js doing on the main thread
     * what AVPlay does natively on the set. The picture is a simulator artefact rather than the
     * app, and much the noisiest thing here, so they stay the loosest numbers and the least
     * meaningful. Everything above them is the app.
     */
    "surfing channels": { stalls: 24 },
    "open, browse, choose": { stalls: 34, lag: 90, slow: 5 },
  };
  /** Of the set's own ceiling. Well clear, because a playlist can be far larger than this one. */
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

  /*
   * The budget belongs to the floor, and now says so rather than assuming it.
   *
   * These allowances were measured on the weakest set Samsung has sold since 2020. Applied to
   * the reference profile, which is six times faster and has three times the heap, they are so
   * loose that the gate essentially cannot fail. `npm run tv:budget` passes --floor, so this
   * only ever catches somebody running it by hand, which is exactly who would not notice.
   */
  if (!floor) {
    console.error("\n--budget is the floor profile's budget. Add --floor, or the allowances");
    console.error("below are being applied to a set six times faster than they were set for.");
    child.kill();
    process.exit(2);
  }

  const failures = [];
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
    if (!measured.has(label)) failures.push(`${label}: an allowance for a phase that never ran`);
  }
  for (const result of results) {
    const allowed = ALLOWED[result.label];
    if (!allowed) continue;
    if (result.stalls > allowed.stalls) {
      failures.push(`${result.label}: ${result.stalls} stalls, ${allowed.stalls} allowed`);
    }
    /*
     * A latency allowance with no latency to check is a failure, not a pass.
     *
     * The only phases with nothing to report are the ones with no highlight on screen, and they
     * have no allowance either. So an allowance that finds nothing means the highlight stopped
     * being findable, which is how this whole column would quietly stop measuring anything.
     */
    if (allowed.lag !== undefined && result.lag === null) {
      failures.push(`${result.label}: nothing answered a press, so no latency was measured`);
    } else if (allowed.lag !== undefined && result.lag > allowed.lag) {
      failures.push(`${result.label}: ${result.lag}ms from press to highlight, `
        + `${allowed.lag}ms allowed`);
    }
    /*
     * Slow presses counted, not the slowest one measured.
     *
     * The worst single press was the first version of this and it failed a quiet run at 178ms
     * having passed six earlier runs between 57 and 116. The maximum of eighteen samples is the
     * least stable statistic in the file and one scheduling accident owns it, which is the same
     * reason the frames are gated on a count past 100ms rather than on their worst. The worst is
     * still printed, because it is the number a person wants to see.
     */
    if (allowed.slow !== undefined && result.slow > allowed.slow) {
      failures.push(`${result.label}: ${result.slow} of ${result.presses} presses waited longer `
        + `than 100ms, ${allowed.slow} allowed`);
    }
  }
  /*
   * A playlist that cannot be cached is a launch that never gets better.
   *
   * Not a frame time and it belongs here anyway, because it is the difference between a
   * television that comes on in two seconds and one that downloads a few megabytes first, every
   * time, forever. The app is right not to shout about it, so this is where it gets said.
   */
  if (!cached) {
    failures.push("the playlist was not cached, so every launch fetches it over the network "
      + `again (${Math.round(playlistText.length / 1024)}KB)`);
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
    if (at === undefined) {
      failures.push(`${label}: never happened within ${LAUNCH_DEADLINE_MS / 1000}s, `
        + "so the launch was not measured");
    } else if (at > allowed) {
      failures.push(`${label}: ${at}ms into the launch, ${allowed}ms allowed`);
    }
  }
  /*
   * Against the set's documented ceiling, not against what V8 reports here.
   *
   * They are not the same number and the difference matters. --max-old-space-size caps one
   * space, so V8 answers 216MB when it has been given 120, and budgeting against its answer
   * would quietly allow nearly twice what Samsung permits. 120MB is the only hard figure
   * they publish, it covers the whole application rather than the script heap alone, and it
   * is already in the profile.
   */
  if (state.heapMB) {
    const allowed = Math.round(heapMB * HEAP_SHARE);
    if (state.heapMB > allowed) {
      failures.push(`heap: ${state.heapMB}MB against the set's ${heapMB}MB ceiling, `
        + `${allowed}MB allowed`);
    }
    const grew = state.heapMB - settled.heapMB;
    if (grew > HEAP_GROWTH_MB) {
      failures.push(`heap: grew ${grew}MB over one walk of the interface, `
        + `${HEAP_GROWTH_MB}MB allowed`);
    }
  }

  console.log();
  if (failures.length) {
    console.error("Over budget on the floor profile:\n");
    for (const line of failures) console.error(`  ${line}`);
    console.error("\nThe floor is the weakest set Samsung has sold since 2020. Everything");
    console.error("newer is faster, so this is the only budget there needs to be.");
    // Said here rather than only in the header, where it would have scrolled past by now.
    if (busyWarning) console.error(`\nBut ${busyWarning}. Run it again on a quiet machine.`);
  } else {
    console.log("Within budget on the floor profile.");
    if (busyWarning) console.log(`Although ${busyWarning}.`);
  }
  child.kill();
  process.exit(failures.length ? 1 : 0);
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
