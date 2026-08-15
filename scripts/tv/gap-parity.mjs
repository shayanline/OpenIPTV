#!/usr/bin/env node
/**
 * Prove that the interface is spaced the same with flex gap and without it.
 *
 * `gap` on a flex container is Chromium 84, and the 2020 and 2021 televisions this app is
 * built for run 69 and 76. So the stylesheet carries a second, margin based set of spacing
 * rules under `.no-flex-gap`, chosen at startup by a measured probe. See the "old engine
 * gaps" section at the foot of styles/app.css, and scripts/tv/platforms.json for the matrix.
 *
 * Nothing anybody here can open exercises that second set. Every browser on this machine has
 * flex gap, so the rules that only old sets use are the rules nobody ever sees, which is
 * precisely how they rot: a gap added to a new flex container is invisible on a desktop and
 * silently missing on the hardware.
 *
 * This closes that. It loads the built app twice, measures the position and size of every
 * child of every gap using container, and compares:
 *
 *   1. as it is, with gap doing the spacing
 *   2. with gap neutralised on those same containers and .no-flex-gap turned on, which is
 *      what a Chromium 76 set sees
 *
 * The two must agree. Where they do not, the margin rule for that container is wrong, and
 * the output says which container and by how much.
 *
 *   npm run build && npm run tv:gap
 *
 * Chrome is driven over CDP through the same tiny client the simulator uses, so this adds no
 * dependency and no browser automation framework.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { connect, findChrome } from "./cdp.mjs";
import { serve, walk, compare } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");
const PORT = 4319;
const CDP_PORT = 9335;

/**
 * The dev-only debug remote, which is excluded and is the only thing that is.
 *
 * It is a development tool, the bundler drops it from a production build, and it never runs on
 * a television, so it is the one part of the interface that may use flex gap without a
 * fallback. Its stylesheet is not tree shaken, so it is still in the built CSS and has to be
 * named to be skipped.
 */
const DEV_ONLY = /^\.(remote|rk-|keypad|rocker|dp\b)/;

/**
 * Every container that spaces itself with flex gap, read out of the built stylesheet.
 *
 * This was a hand written list of twenty four selectors, and the trouble with a hand written
 * list is the thing it leaves out. `.pane-head` is a flex container with a gap, has been since
 * it was written, and was not on the list, so on every 2020 and 2021 set the panel header drew
 * with no spacing and the gate that exists to catch precisely that reported success. A gate
 * whose coverage is a constant is a gate that silently narrows every time somebody adds a
 * flex container.
 *
 * So it is derived. Any rule that declares a gap and is not `display: grid` needs the margin
 * fallback, because grid gap has worked since Chromium 66 and flex gap did not arrive until
 * 84. Comments are stripped first, or the prose at the foot of the stylesheet explaining all
 * of this would itself be parsed as a rule.
 */
function gapContainers(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Set();
  for (const [, selector, body] of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(^|[;\s])(row-|column-)?gap\s*:/.test(body)) continue;
    if (/display\s*:\s*grid/.test(body)) continue;
    for (const one of selector.split(",")) {
      const trimmed = one.trim();
      // Simple class selectors only. A descendant or pseudo selector is not something the
      // simulation below can neutralise cleanly, and none of them carry a gap today.
      if (!/^\.[a-zA-Z0-9_.-]+$/.test(trimmed)) continue;
      if (DEV_ONLY.test(trimmed)) continue;
      found.add(trimmed);
    }
  }
  return [...found].sort();
}

const stylesheet = readdirSync(join(DIST, "assets")).find((f) => f.endsWith(".css"));
if (!stylesheet) {
  console.error("No stylesheet in dist/assets. Run `npm run build` first.");
  process.exit(2);
}
const FLEX_GAP = gapContainers(readFileSync(join(DIST, "assets", stylesheet), "utf8"));

/** What a set without flex gap sees: the gaps do nothing, and the fallback rules apply. */
const SIMULATE_OLD = `(() => {
  const style = document.createElement("style");
  style.textContent = ${JSON.stringify(FLEX_GAP)}
    .map((s) => s + "{row-gap:0 !important;column-gap:0 !important}").join("\\n");
  document.head.appendChild(style);
  document.documentElement.classList.add("no-flex-gap");
  return "ok";
})()`;

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("No build to measure. Run `npm run build` first.");
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("No Chrome, Chromium or Edge found in the usual places.");
    process.exit(2);
  }

  const server = await serve(DIST, PORT);
  const browser = spawn(chrome, [
    `--remote-debugging-port=${CDP_PORT}`,
    /*
     * A profile per run, and it matters more than it looks.
     *
     * With a fixed directory, a Chrome already holding it makes the one spawned here detect the
     * singleton lock, hand over its command line and exit immediately. None of the flags below
     * would apply, and the debugger would attach to the browser that was already there: a
     * different engine, a different window, and in the simulator's case none of the throttling
     * or the heap cap. It also means the two walks no longer share a warm cache between runs,
     * so a cold profile and a warm one cannot disagree about the layout.
     */
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "openiptv-gap-"))}`,
    "--headless=new", "--window-size=1920,1080", "--no-first-run", "--no-default-browser-check",
    // Linux runners have no unprivileged user namespaces, so the sandbox refuses to start and
    // this gate is a blocking step. See the longer note in engine-parity.
    "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  ], { stdio: "ignore" });

  let failures = 0;
  try {
    const cdp = await connect(CDP_PORT);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    // The same walk both times, and the same walk engine-parity uses, so a screen added to
    // one gate is never quietly missing from the other.
    const withGap = await walk(cdp, PORT, FLEX_GAP);
    const without = await walk(cdp, PORT, FLEX_GAP, { before: SIMULATE_OLD });
    cdp.close();

    const { boxes, differing, screens } = compare(withGap, without, {
      tolerance: 0.6,
      labels: ["gap", "fallback"],
    });
    failures = differing;
    console.log(`\n${boxes} child boxes across ${screens} screens, ${failures} differing`);
    if (failures) {
      console.error("\nThe margin fallback does not reproduce the gap spacing. The rules are " +
                    "at the foot of src/styles/app.css.");
    }
  } finally {
    browser.kill();
    server.close();
  }
  process.exit(failures ? 1 : 0);
}

main();
