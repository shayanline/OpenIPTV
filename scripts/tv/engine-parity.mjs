#!/usr/bin/env node
/**
 * Prove the app behaves the same on the oldest television it supports and the newest.
 *
 * Samsung ships seven engines across the years this supports, Chromium 69 on a 2020 set
 * through to 130 on a 2026 one. Testing seven is not necessary and saying why is the whole
 * design of this gate: the build targets the oldest, and the stylesheet uses nothing newer
 * than the oldest can do, so every engine above it runs a strict superset of what the app
 * asks for. A middle year cannot fail in a way both ends pass.
 *
 * That reasoning holds exactly as long as nobody branches on the engine. There is one such
 * branch today, the flex gap probe, and gap-parity.mjs covers it. The rule that follows is
 * worth writing down: every capability branch added costs an engine in this matrix, because
 * the middle years stop being unreachable the moment code can tell them apart.
 *
 * Two things are checked, and the first matters more than the second:
 *
 *   1. Nothing throws, anywhere, in either engine. This is what catches a builtin the old
 *      engine does not have, which the type checker cannot see and the bundler does not
 *      polyfill: esbuild lowers syntax, so `?.` becomes safe, and leaves `Array.at` alone.
 *      It is also the check that would have caught flex gap, since a missing method is
 *      loud and a missing layout feature is silent.
 *   2. The layout lands in the same place. Structural boxes only, and with a tolerance,
 *      because text shaping genuinely did change between M69 and M120 and demanding
 *      sub-pixel agreement on a paragraph would fail forever for no reason worth acting on.
 *
 *   npm run build && npm run tv:engines
 *   npm run tv:engines -- --all      every supported engine, not just the two ends
 *
 * The engines are real Chromium builds pinned to the versions Samsung ships, downloaded
 * once into ~/.cache. See engines.mjs.
 */
import { existsSync } from "node:fs";
import { release } from "node:os";
import { join, resolve } from "node:path";
import { findChrome } from "./cdp.mjs";
import { withBrowser } from "./browser.mjs";
import { ensureEngine } from "./engines.mjs";
import { supported, floorPlatform, ceilingPlatform, source } from "./platforms.mjs";
import { serve, walk, compare } from "./harness.mjs";

const ROOT = resolve(import.meta.dirname, "../..");
const DIST = join(ROOT, "dist");

/**
 * The containers whose geometry has to agree, which is not everything on the screen.
 *
 * Structure rather than prose. Where the panel ends, how tall a row is, where the two
 * columns sit, whether a dialog is centred: those are the things a missing CSS feature
 * moves, and they are the things a viewer would notice. A run of text being two tenths of a
 * pixel wider in a newer engine is a font shaping improvement, not a bug in this app.
 */
const LAYOUT = [
  ".app", ".panel", ".panel-cols", ".rail", ".list", ".pane-head", ".viewport",
  ".window", ".row", ".sheet", ".sheet-rail", ".sheet-body", ".dialog", ".splash",
  ".hints", ".actions", ".field", ".pl", ".pad", ".panel-hints",
];

/**
 * How far apart two engines may put the same box.
 *
 * Chosen from the measurements rather than picked. Across the whole walk the differences
 * fall into two groups with nothing in between: a handful at three or four pixels, all of
 * them the width of a run of text, and the rest above thirty two, all of them a box in the
 * wrong place. Four sits in that gap.
 *
 * The small group is real and not worth acting on. Text shaping genuinely changed between
 * Chromium 69 and 120, so the same sentence in the same font is a few pixels wider on a
 * newer set, and no amount of CSS will make a 2020 television agree with a 2025 one about
 * that. The large group is what this gate is for, and nothing that matters is subtle: the
 * fault it found on its first run moved boxes by two hundred and seventy pixels.
 */
const TOLERANCE = 4;

/**
 * Screens that are supposed to differ between engines, so their geometry says nothing.
 *
 * Only one, and it is the diagnostics screen, whose entire purpose is to report what this
 * particular television is. On Chromium 69 it says so, and it says flex gap is missing and
 * the margin fallback is in use; on 120 it says neither. Different words are different
 * heights, and comparing them found three boxes five pixels apart and called it a layout
 * difference.
 *
 * Skipped from the comparison and still walked, which is the part worth keeping. Loading it
 * on both engines proves it renders and throws nothing, and that check does not care where
 * the boxes landed. A screen no gate ever opens is a screen that breaks quietly.
 */
const VARIES_BY_ENGINE = new Set(["settings.diagnostics"]);

/**
 * Run the whole walk in one engine, collecting geometry and anything it complained about.
 *
 * Console errors and uncaught exceptions are gathered from before the first navigation, so
 * a module that fails to parse on an old engine is caught rather than showing up as an
 * empty page with a confusing geometry diff.
 */
async function attempt(tv, binary, pinned, port) {
  return withBrowser(binary, [
    "--headless=new", "--window-size=1920,1080", "--force-device-scale-factor=1",
    "--lang=en-US", "--no-first-run", "--no-default-browser-check", "--disable-web-security",
    "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars",
    /*
     * The sandbox off, and it is the old engines that need it rather than a convenience.
     * A 2020 set's Chromium predates the current macOS sandbox, so on this machine every
     * renderer it starts dies at once with "Check failed: Seatbelt::IsSandboxed", leaving
     * a browser that answers the debugger and can never draw anything. Linux runners want
     * it too, for the ordinary reason that they have no user namespaces.
     *
     * Safe here in a way it would not be anywhere else: these engines are years old and
     * unpatched, they run for ninety seconds against a fixture on localhost, and they are
     * never pointed at anything a stranger wrote.
     */
    "--no-sandbox",
    // Software rendering, so the two engines are compared on layout rather than on a
    // decade of difference in how they talk to this particular GPU.
    "--disable-gpu",
    "about:blank",
  ], `openiptv-engine-${tv.tizen}-`, async (cdp) => {
    const complaints = [];
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Log.enable").catch(() => {});

    /*
     * Ask the browser which engine it is, rather than trusting the file it came from.
     *
     * Nothing did, and several things could quietly make it the wrong one: a stale lock entry,
     * a `snapshotNear` that points at the neighbouring milestone, a nearest-snapshot search
     * that crossed a branch point, or a cached download from a position that has since been
     * relocked. Every one of those ends the same way, with the gate announcing it tested
     * Chromium 69 having tested something else, and passing.
     */
    const { product } = await cdp.send("Browser.getVersion");
    const major = Number(/Chrom(?:e|ium)\/(\d+)/.exec(product ?? "")?.[1]);
    if (pinned && major !== tv.chromium) {
      throw new Error(
        `Expected Chromium ${tv.chromium} for Tizen ${tv.tizen} and got ${product}. `
        + "The lock, the snapshot hint or the cached download disagree with platforms.json.",
      );
    }
    if (!pinned) console.log(`    (standing in with ${product})`);
    // The set's user agent, so any code that sniffs it takes the path it would on the TV.
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: tv.userAgent });
    /*
     * The viewport, forced rather than asked for.
     *
     * --window-size is a request about a window, and what a headless browser then gives the
     * page has changed over the years: the two engines here disagreed by 177 pixels of
     * height, which is not a layout bug but was reported as three hundred of them. Every
     * Samsung TV runs the application at exactly 1920x1080 whatever the panel is, so it is
     * set to that on both sides and the comparison is about the stylesheet again.
     */
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
    });

    cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      complaints.push(`threw: ${exceptionDetails.exception?.description
        ?? exceptionDetails.text ?? "unknown"}`);
    });
    cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type !== "error") return;
      complaints.push(`console.error: ${args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    });
    cdp.on("Log.entryAdded", ({ entry }) => {
      // A 404 for a stream from example.invalid is the fixture, not the app.
      if (entry.level === "error" && !entry.text.includes("example.invalid")) {
        complaints.push(`${entry.source}: ${entry.text}`);
      }
    });

    const shots = await walk(cdp, port, LAYOUT);
    // The app has to have actually got somewhere. Every box agreeing because both engines
    // rendered nothing is the failure mode this gate would otherwise be blind to.
    const rows = await cdp.send("Runtime.evaluate", {
      expression: "document.querySelectorAll('.list .row').length", returnByValue: true,
    }).then((r) => r.result.value);
    return { shots, complaints, rows };
  });
}

/**
 * Run one leg, with a fallback that is allowed for the ceiling and never for the floor.
 *
 * A pinned build does not always start. The M120 snapshots segfault on macOS 26, on both
 * arm64 and x64 and whether or not they are ad hoc signed, which is what a five year old
 * browser meeting a current operating system looks like. On Linux they are fine, so CI gets
 * the exact engines and a laptop sometimes does not.
 *
 * What each leg is for decides whether that matters. The ceiling's job is to be a modern
 * engine, and the Chrome already installed is one, so substituting it costs nothing worth
 * having. The floor's job is to be Chromium 69 exactly: substituting anything there would
 * compare a modern engine against a modern engine and report that they agree, which is a
 * green light for a test that did not run. So that one fails instead.
 */
async function inEngine(tv, port) {
  const brokenMacSnapshot = tv.chromium === 120 && process.platform === "darwin"
    && Number.parseInt(release(), 10) >= 25;
  const pinned = brokenMacSnapshot ? null : await ensureEngine(tv);
  try {
    if (!pinned) {
      throw Object.assign(new Error("Chromium 120 snapshots crash on macOS 26 or newer"),
        { launch: true });
    }
    return { ...await attempt(tv, pinned, true, port), pinned: true };
  } catch (e) {
    if (tv.floor) {
      throw new Error(
        `The floor engine, Chromium ${tv.chromium}, would not start: ${e.message}\n` +
        "Nothing may stand in for it, because comparing two modern engines and finding " +
        "them alike is not a test. Run this leg on Linux.",
      );
    }
    // Only a launch failure. Anything else is the gate doing its job and must not be papered
    // over by running the same leg on a different engine.
    if (!e.launch) throw e;
    const local = findChrome();
    if (!local) throw e;
    console.log(`\n  ! Chromium ${tv.chromium} would not start here (${e.message}).`);
    console.log("    Falling back to the installed Chrome, which is a modern engine and so");
    console.log("    stands in for the ceiling. CI pins it properly.\n   ");
    return { ...await attempt(tv, local, false, port), pinned: false };
  }
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("No build to measure. Run `npm run build` first.");
    process.exit(2);
  }

  const wanted = process.argv.includes("--all")
    ? supported
    : [floorPlatform(), ceilingPlatform()];
  const [reference] = wanted;

  console.log("Engine parity");
  console.log(`  against  ${source}`);
  console.log(`  engines  ${wanted.map((p) => `Tizen ${p.tizen} / M${p.chromium}`).join(", ")}`);
  console.log(`  baseline Tizen ${reference.tizen}, Chromium ${reference.chromium}, `
    + "the oldest engine a supported set runs\n");

  const hosted = await serve(DIST);
  let failures = 0;
  try {
    const runs = [];
    for (const tv of wanted) {
      process.stdout.write(`  Tizen ${tv.tizen} (M${tv.chromium})  `);
      const result = await inEngine(tv, hosted.port);
      console.log(`${result.rows} rows drawn, ${result.complaints.length} complaints`
        + `${result.pinned ? "" : ", NOT the pinned engine"}`);
      runs.push({ tv, ...result });
    }

    for (const run of runs) {
      if (!run.rows) {
        console.error(`\nTizen ${run.tv.tizen} drew no channel rows at all. `
          + "The app did not reach a usable state on that engine.");
        failures += 1;
      }
      for (const complaint of run.complaints) {
        console.error(`\nTizen ${run.tv.tizen} (Chromium ${run.tv.chromium})  ${complaint}`);
        failures += 1;
      }
    }

    for (const run of runs.slice(1)) {
      console.log(`\n  Tizen ${reference.tizen} against Tizen ${run.tv.tizen}`);
      const { boxes, differing, screens } = compare(runs[0].shots, run.shots, {
        tolerance: TOLERANCE,
        labels: [`M${reference.chromium}`, `M${run.tv.chromium}`],
        skip: VARIES_BY_ENGINE,
      });
      console.log(`  ${boxes} boxes across ${screens} screens, ${differing} differing`
        + `${VARIES_BY_ENGINE.size ? `, ${[...VARIES_BY_ENGINE].join(", ")} not compared` : ""}`);
      failures += differing;
    }

    if (failures) {
      console.error("\nThe app does not behave the same across the engines Samsung ships.");
      console.error("A layout difference means a CSS feature the older engine lacks; the");
      console.error("engine that gained what is missing is listed in platforms.json.");
    } else {
      console.log("\nSame behaviour, same layout, no complaints.");
    }
  } finally {
    await hosted.close();
  }
  process.exit(failures ? 1 : 0);
}

main();
