#!/usr/bin/env node
/**
 * Work out how much slower the TV is than this laptop, and write it into the profile.
 *
 * A throttling factor picked by feel is worthless: it either flatters the app or makes it
 * look impossible. So run the same arithmetic in both engines and divide.
 *
 * Mostly a one-off, but the result is a ratio between two specific machines, so it stops
 * being true if either of them changes: a different laptop, a firmware upgrade that moves
 * the set to a newer Chromium, or a materially different Chrome here. It therefore records
 * what it measured against, and the simulator complains when that no longer matches rather
 * than quietly reporting numbers from someone else's hardware.
 *
 * It also refreshes the device facts in the profile while it has the TV on the line, so
 * this doubles as "go and ask the television about itself".
 *
 * The TV must be reachable over sdb and the app must be installed. This launches it in
 * debug mode, so do not run it while somebody is watching something.
 *
 *   node scripts/tv/calibrate.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findChrome, arg } from "./cdp.mjs";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir, cpus, arch } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const profilePath = join(here, "profile.json");
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const APP = "qQHcuw4fHz.SimpleIPTV";

/**
 * Deliberately plain work: integer maths, string building and array sorting, the things a
 * UI actually does. No allocation storms, nothing a JIT can delete, and no dependence on
 * the GPU, which is not what is being measured.
 */
const WORK = `(() => {
  const t0 = performance.now();
  let acc = 0;
  for (let r = 0; r < 40; r++) {
    const a = [];
    for (let i = 0; i < 20000; i++) { acc += (i * 2654435761) % 1000; a.push((i ^ acc) & 1023); }
    a.sort((x, y) => x - y);
    acc += a[0] + a[a.length - 1] + ("n" + acc).length;
  }
  return { ms: performance.now() - t0, acc };
})()`;

const sdb = () => [
  join(process.env.HOME, "tizen-studio/tools/sdb"),
  join(process.env.HOME, ".tizen-extension-platform/server/sdktools/data/tools/sdb"),
].find(existsSync);

async function measure(cdp, label) {
  const runs = [];
  for (let i = 0; i < 7; i++) {
    const { result } = await cdp.send("Runtime.evaluate", { expression: WORK, returnByValue: true });
    runs.push(result.value.ms);
  }
  runs.sort((a, b) => a - b);
  const median = runs[3];
  // Spread matters as much as the middle. A wide one means something else was competing
  // for the machine, or it was thermally throttling, and the ratio is not worth keeping.
  const spread = (runs[runs.length - 1] - runs[0]) / median;
  console.log(`  ${label.padEnd(8)} ${median.toFixed(0)} ms   spread ${(spread * 100).toFixed(0)}%`
    + `   (${runs.map((r) => r.toFixed(0)).join(", ")})`);
  return { median, spread };
}

/** What this ratio is only true for. */
const machine = `${cpus()[0]?.model ?? "unknown"} (${arch()})`;

// ---- the TV -----------------------------------------------------------------------
const SDB = arg("sdb") ?? sdb();
if (!SDB) { console.error("No sdb found. Pass --sdb=/path/to/sdb."); process.exit(1); }

console.log("Measuring the TV...");
const launched = execFileSync(SDB, ["shell", "0", "debug", APP], { encoding: "utf8" });
const port = launched.match(/port:\s*(\d+)/)?.[1];
if (!port) { console.error("Could not start the app in debug mode:\n" + launched); process.exit(1); }
try { execFileSync(SDB, ["forward", "--remove", `tcp:${port}`]); } catch { /* none yet */ }
execFileSync(SDB, ["forward", `tcp:${port}`, `tcp:${port}`]);
await new Promise((r) => setTimeout(r, 2500));

const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const tv = await connect(pages.find((p) => p.type === "page").webSocketDebuggerUrl);
await tv.send("Runtime.enable");

// While the set is on the line, ask it what it is. Cheaper and more honest than the
// published specifications, which give no RAM, CPU or clock at all.
const facts = await tv.send("Runtime.evaluate", {
  returnByValue: true,
  expression: `JSON.stringify({
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory,
    jsHeapLimitMB: performance.memory ? Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null,
    width: screen.width, height: screen.height, deviceScaleFactor: devicePixelRatio,
  })`,
});
const device = JSON.parse(facts.result.value);

const tvRun = await measure(tv, "tv");
tv.close();

// ---- this laptop, unthrottled -------------------------------------------------------
console.log("Measuring this machine...");
const chrome = findChrome();
const child = spawn(chrome, [
  "--remote-debugging-port=9334",
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "tv-cal-"))}`,
  "--no-first-run", "--no-default-browser-check", "--headless=new", "about:blank",
], { stdio: "ignore" });

const local = await connect(9334);
await local.send("Runtime.enable");
const localRun = await measure(local, "laptop");
local.close();
child.kill();

// ---- the answer ---------------------------------------------------------------------
const rate = Math.round((tvRun.median / localRun.median) * 10) / 10;
const shaky = Math.max(tvRun.spread, localRun.spread) > 0.25;

Object.assign(profile, device, {
  cpuThrottle: rate,
  calibrated: true,
  calibratedOn: new Date().toISOString().slice(0, 10),
  calibratedMachine: machine,
  chromium: device.userAgent.match(/(\d+\.[\d.]+)\/[\d.]+ TV/)?.[1] ?? profile.chromium,
});
writeFileSync(profilePath, JSON.stringify(profile, null, 2) + "\n");

console.log(`\nThe TV is ${rate}x slower than this machine on this work.`);
if (shaky) {
  console.log("Both readings varied by more than a quarter, so something else was using");
  console.log("one of the machines. Worth running again on a quiet system.");
}
console.log(`\nWritten to scripts/tv/profile.json, along with what the set says about`);
console.log(`itself: ${device.cores} cores, ${device.deviceMemoryGB}GB, ${device.jsHeapLimitMB}MB heap.`);
console.log(`Only true for ${machine}, and the simulator will say so if that changes.`);
