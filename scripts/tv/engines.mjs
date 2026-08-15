/**
 * Get hold of the actual browser engine a given Samsung TV runs.
 *
 * The simulator spoofs the user agent and holds the processor down, and it is honest about
 * what that does not do: "the code still runs on whatever Chrome is installed, so a feature
 * missing in 69 will work here and fail there". That caveat is the largest hole in the
 * whole testing story, because the CSS is the part with no build step to catch it. `gap` on
 * a flex container is the example the app already knows about, and it was found by reading
 * the specification rather than by anything failing.
 *
 * So this fetches real Chromium builds, pinned to the versions Samsung ships, from the
 * snapshot archive Google has kept since long before any of these televisions existed.
 *
 * Two wrinkles, both handled here rather than by the caller:
 *
 *   1. Snapshots are per commit and not every commit was built, so the position that a
 *      release maps to is frequently missing. The nearest one either side is the same
 *      engine for these purposes, so the search walks outwards until it finds a build.
 *   2. There are no arm64 Mac builds at all for the older engines, and none for M120
 *      either. The x64 ones exist for every version in the table and run under Rosetta, so
 *      macOS always takes those.
 *
 * What it finds is written to engines.lock.json, so a later run and a CI run download the
 * same bytes rather than whatever the search lands on that day.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { homedir, platform, arch } from "node:os";
import { join, dirname } from "node:path";
import { supported } from "./platforms.mjs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const LOCK = join(here, "engines.lock.json");
const CACHE = join(homedir(), ".cache", "openiptv-engines");
const BUCKET = "https://commondatastorage.googleapis.com/chromium-browser-snapshots";

const MAC = { zip: "chrome-mac.zip", bin: "chrome-mac/Chromium.app/Contents/MacOS/Chromium" };
const LINUX = { zip: "chrome-linux.zip", bin: "chrome-linux/chrome" };

/**
 * Which builds to try, best first.
 *
 * Apple silicon needs both, and neither on its own is enough. There are no arm64 Mac builds
 * for the older engines, because there were no arm64 Macs when they were current, so the
 * floor can only be had as x64 under Rosetta. And the x64 build of M120 segfaults on
 * startup under Rosetta on this machine, so the newer engines have to be native. Trying arm
 * and falling back to x64 gets every engine in the table on one laptop, which is the
 * difference between this being a CI-only gate and something anyone can run before pushing.
 */
const FLAVOURS = {
  "darwin-arm64": [{ dir: "Mac_Arm", ...MAC }, { dir: "Mac", ...MAC }],
  "darwin-x64": [{ dir: "Mac", ...MAC }],
  "linux-x64": [{ dir: "Linux_x64", ...LINUX }],
};

const flavours = () => {
  const found = FLAVOURS[`${platform()}-${arch()}`];
  if (!found) {
    throw new Error(`No Chromium snapshots for ${platform()}-${arch()}. Use Linux x64 or macOS.`);
  }
  return found;
};

const readLock = () => (existsSync(LOCK) ? JSON.parse(readFileSync(LOCK, "utf8")) : {});

/**
 * What a locked position is a position *for*, which has to include the engine version.
 *
 * The key was `dir/tizen`, so nothing about which Chromium was wanted was part of it. A
 * firmware refresh that moved Tizen 9.0 from Chromium 120 to 121, with `chromium` and
 * `snapshotNear` updated in platforms.json, would still find the old entry, download M120, and
 * store it in a directory named for M121. The gate would then announce it was testing Chromium
 * 121 while running 120, and nothing anywhere asked the browser which it was.
 *
 * The cache directory carries the position for the same reason: regenerating the lock has to
 * invalidate what was downloaded against the old one.
 */
const lockKey = (dir, tv) => `${dir}/${tv.tizen}/m${tv.chromium}`;
const cacheDir = (dir, tv, position) =>
  join(CACHE, `${dir}-${tv.tizen}-m${tv.chromium}-${position}`);

const exists = async (url) => {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
};

/**
 * The nearest position at or around the target that was actually built.
 *
 * Outwards from the target rather than forwards, because either neighbour is the same
 * engine to within a few commits and the nearest is the most faithful. In practice this
 * lands within about five: the M76 position in the table was missing and the build four
 * commits earlier was there.
 */
async function nearestSnapshot(dir, zip, target, reach = 80) {
  for (let step = 0; step <= reach; step++) {
    for (const at of step === 0 ? [target] : [target + step, target - step]) {
      if (await exists(`${BUCKET}/${dir}/${at}/${zip}`)) return at;
    }
  }
  return null;
}

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
});

/**
 * The path to a runnable Chromium for one platform, downloading it if it is not already had.
 *
 * Around 150MB per engine, once, into ~/.cache. CI caches that directory, so the matrix
 * costs a download on the first run of a new engine and nothing afterwards.
 */
export async function ensureEngine(tv, { quiet = false } = {}) {
  const lock = readLock();

  // Already downloaded, under whichever flavour and position it was had as.
  for (const { dir, bin } of flavours()) {
    const position = lock[lockKey(dir, tv)];
    if (!position) continue;
    const binary = join(cacheDir(dir, tv, position), bin);
    if (existsSync(binary)) return binary;
  }

  if (!quiet) console.log(`  resolving Chromium M${tv.chromium} for Tizen ${tv.tizen}...`);
  let chosen = null;
  for (const flavour of flavours()) {
    const key = lockKey(flavour.dir, tv);
    const position = lock[key]
      ?? await nearestSnapshot(flavour.dir, flavour.zip, tv.snapshotNear);
    if (position) {
      chosen = { ...flavour, position, key };
      break;
    }
  }
  if (!chosen) {
    throw new Error(
      `No snapshot near ${tv.snapshotNear} for Chromium M${tv.chromium} on this machine.\n` +
      `Tried ${flavours().map((f) => f.dir).join(", ")}. Check snapshotNear for Tizen ` +
      `${tv.tizen} in platforms.json.`,
    );
  }

  const { dir, zip, bin, position } = chosen;
  const home = cacheDir(dir, tv, position);
  const binary = join(home, bin);

  const url = `${BUCKET}/${dir}/${position}/${zip}`;
  if (!quiet) console.log(`  downloading Chromium M${tv.chromium} (${dir} ${position})`);

  mkdirSync(home, { recursive: true });
  const archive = join(home, zip);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
  // unzip rather than a library: it is on every macOS and every Ubuntu runner, and adding a
  // dependency to this repository for one call would be the larger cost.
  await run("unzip", ["-q", "-o", archive, "-d", home]);
  rmSync(archive);

  if (!existsSync(binary)) throw new Error(`Downloaded ${url} but found no binary at ${bin}`);
  // The zip does not carry the executable bit on every platform.
  await run("chmod", ["+x", binary]);

  /*
   * Locked only now, once there is something runnable to lock.
   *
   * It used to be written before the download, so a 404, a missing `unzip` or a failed chmod
   * left the position recorded and a half extracted directory beside it. That self healed only
   * by accident, because the binary check fails and `unzip -o` overwrites. Recording a fact
   * about a download that did not happen is not something to rely on being harmless.
   */
  writeFileSync(LOCK, `${JSON.stringify({ ...readLock(), [chosen.key]: position }, null, 2)}\n`);
  return binary;
}

/**
 * Resolve and record every engine, without downloading any of them.
 *
 * Run directly: `node scripts/tv/engines.mjs`.
 *
 * The lock is only worth having if it is complete, and it fills itself lazily, which means
 * it only ever learns about the flavours the last person to run the gate happened to need.
 * A macOS laptop was writing a lock with one arm64 entry in it and CI, which is Linux and
 * wants all of them, learned nothing from it and resolved from scratch every time.
 *
 * Linux is always resolved because that is where CI runs and where reproducibility matters.
 * The local flavours are added too, so a laptop stops searching as well.
 */
export async function lockAll() {
  const lock = readLock();
  const wanted = [...new Set([{ dir: "Linux_x64", ...LINUX }, ...flavours()].map((f) => JSON.stringify(f)))]
    .map((f) => JSON.parse(f));

  for (const tv of supported) {
    for (const { dir, zip } of wanted) {
      const key = lockKey(dir, tv);
      if (lock[key]) continue;
      const position = await nearestSnapshot(dir, zip, tv.snapshotNear);
      if (position) {
        lock[key] = position;
        console.log(`  ${key.padEnd(18)} M${String(tv.chromium).padEnd(4)} ${position}`
          + `${position === tv.snapshotNear ? "" : ` (${position - tv.snapshotNear >= 0 ? "+" : ""}${position - tv.snapshotNear})`}`);
      } else {
        console.log(`  ${key.padEnd(18)} M${String(tv.chromium).padEnd(4)} no build, `
          + "which is expected for an arm64 Mac before they existed");
      }
    }
  }
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(`\nWritten to ${LOCK}. Commit it, so CI fetches the same bytes.`);
}

if (import.meta.filename === process.argv[1]) await lockAll();
