/**
 * Serve the built app to a browser, walk it through its screens, and measure what it drew.
 *
 * Shared by the two parity gates, which ask the same question of different things:
 *
 *   gap-parity      one engine, twice, with flex gap and with the margin fallback
 *   engine-parity   the same build, in the oldest engine a supported TV runs and the newest
 *
 * Both need a real build in a real browser driven to the same places in the same order, and
 * both are worthless if the two runs are not identical in every other respect. Keeping the
 * walk in one file is what makes them comparable, and what stops a screen being added to
 * one gate and quietly missed by the other.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml",
};

/**
 * A playlist with something awkward in every field, because a parity check on tidy data
 * proves nothing about the interface that has to hold real playlists.
 *
 * A bidirectional group name, a name long enough to need truncating, a quality badge and a
 * channel with none of those. All three engines have to lay these out the same way.
 */
export const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News | \u0627\u062e\u0628\u0627\u0631" tvg-quality="FHD",Channel Alpha News
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News | \u0627\u062e\u0628\u0627\u0631",Channel Beta With A Much Longer Name Than Fits
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma Sport
http://example.invalid/c.m3u8
#EXTINF:-1 tvg-id="d" group-title="Sport",\u0642\u0646\u0627\u0629 \u0627\u0644\u0631\u064a\u0627\u0636\u0629
http://example.invalid/d.m3u8
`;

export function serve(dist, port) {
  const server = createServer(async (req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/playlist.m3u") {
      res.writeHead(200, { "content-type": "audio/x-mpegurl" });
      return res.end(PLAYLIST);
    }
    const file = join(dist, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  // Rejecting rather than hanging. Without the error handler an occupied port left this promise
  // unsettled, and the run only ended because the unhandled 'error' event became an uncaught
  // exception: a raw EADDRINUSE stack instead of "something is already on this port".
  return new Promise((ok, fail) => {
    server.once("error", (e) => fail(new Error(
      `Could not serve the build on port ${port}: ${e.message}. A previous run may still be up.`,
    )));
    server.listen(port, () => ok(server));
  });
}

/**
 * A playlist already configured, so the walk starts at the interface rather than first run.
 *
 * The clock is turned off, and that is not tidying. It is the one element on screen whose
 * content depends on when it was drawn, so two runs a minute apart legitimately disagree
 * about how wide it is, and a comparison meant to find layout differences reported the time
 * of day as three of them. Nothing else here is non deterministic.
 */
export const SEED = `(() => {
  localStorage.setItem("simpleiptv.settings", JSON.stringify({
    playlists: [{ id: "pl-1", name: "Parity", url: "/playlist.m3u" }],
    activePlaylistId: "pl-1", resumeLast: false, panelTimeout: 0, showClock: false,
  }));
  return "ok";
})()`;

/** Every child box of every named container, keyed so two runs can be lined up. */
export const MEASURE = (selectors) => `(() => {
  const out = {};
  for (const sel of ${JSON.stringify(selectors)}) {
    document.querySelectorAll(sel).forEach((el, i) => {
      Array.from(el.children).forEach((c, j) => {
        const r = c.getBoundingClientRect();
        if (!r.width && !r.height) return;
        out[sel + "[" + i + "]>" + j] =
          [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100);
      });
    });
  }
  return JSON.stringify(out);
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The little bit of CDP each gate needs, bound to one connection. */
export function driver(cdp, port) {
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text ?? "evaluate failed");
    return result.value;
  };
  return {
    evaluate,
    press: async (key, code) => {
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent",
          { type, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      }
      await sleep(140);
    },
    clickText: (text) => evaluate(
      `(() => { const b = [...document.querySelectorAll("button")]
          .find((e) => e.textContent.trim() === ${JSON.stringify(text)});
        if (b) b.click(); return !!b; })()`),
    open: async () => {
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      await sleep(1400);
      await evaluate(SEED);
      await cdp.send("Page.reload");
      await sleep(1800);
    },
  };
}

/**
 * Every screen the application has, visited in one order.
 *
 * `before` runs once the app is up and before anything is measured, which is where
 * gap-parity neutralises flex gap. Everything else is identical between runs by
 * construction, because there is only one copy of it.
 */
export async function walk(cdp, port, selectors, { before } = {}) {
  const d = driver(cdp, port);
  await d.open();
  if (before) await d.evaluate(before);

  const shots = {};
  /**
   * Measure a screen, and refuse to record an empty one.
   *
   * An empty screen used to be indistinguishable from a matching one. `compare` walks the
   * boxes it finds, so a screen that rendered nothing contributes no boxes and no differences,
   * and the summary still counted it: a build that threw on load could print "0 child boxes
   * across 10 screens, 0 differing" and exit zero. A gate that passes hardest when the app is
   * most broken is worse than no gate.
   */
  const capture = async (name) => {
    await new Promise((r) => setTimeout(r, 320));
    const boxes = JSON.parse(await d.evaluate(MEASURE(selectors)));
    if (!Object.keys(boxes).length) {
      throw new Error(`${name} drew none of the containers being measured, so there is `
        + "nothing to compare. The app probably failed to render.");
    }
    shots[name] = boxes;
  };

  /**
   * Click something by its label, and stop if the label has moved.
   *
   * The result was computed and thrown away at every call site. Renaming a settings section
   * turned its click into a no op, the walk carried on, and the next capture recorded whatever
   * screen was still open under the previous name. Both legs of a comparison do exactly the
   * same wrong thing, so they agree perfectly and the gate reports success for several screens
   * it never visited.
   */
  const click = async (label) => {
    if (!(await d.clickText(label))) {
      throw new Error(`No button labelled "${label}". The walk cannot reach the screen behind `
        + "it, and a renamed label must not quietly shorten the journey.");
    }
  };

  /**
   * Press one of the panel's title bar keys, by what it is for rather than by what it is called.
   *
   * Through the accessible label, because that is the name that has to stay true anyway: a
   * selector on the class broke the moment the class was renamed from `.gear` to `.panel-key`,
   * which is how a second key came to exist beside it. It threw rather than walking the wrong
   * screen, which is the only reason it was noticed at once.
   */
  const keyed = async (label) => {
    const hit = await d.evaluate(`(() => {
      const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!hit) throw new Error(`No key labelled "${label}" in the panel's title bar.`);
  };

  await capture("panel");
  // Into the rail and down a category, which is the walk the rail debounce governs. Given
  // 320ms to land, so what is measured is where the interface settles rather than a frame
  // of it in transit.
  await d.press("ArrowLeft", 37);
  await d.press("ArrowDown", 40);
  await capture("panel.secondCategory");

  /*
   * The search, which is the channel column showing an answer instead of a category.
   *
   * Walked because it is a screen, and a screen no gate has ever loaded is a screen nobody knows
   * lays out. It brings the only text input on the panel and a header that changes shape, both of
   * which are exactly the sort of thing the older engines get wrong.
   *
   * The query goes in through the browser's own input pipeline rather than by assigning to the
   * field's value: React tracks the value it last wrote, so an assignment leaves its tracker
   * thinking nothing has changed and the results never appear.
   *
   * A `char` key event per character rather than `Input.insertText`, which is the tidier call and
   * does not exist on Chromium 69: the floor engine answered "'Input.insertText' wasn't found" and
   * the gate refused to let a newer engine stand in for it, quite rightly. Character events have
   * been in the protocol since long before any television this app supports.
   */
  await keyed("Search");
  await capture("panel.search");
  for (const ch of "channel") await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
  await sleep(400);                      // the search's own debounce, plus a frame to draw
  await capture("panel.searchResults");
  await d.press("Escape", 27);           // clears the query
  await d.press("Escape", 27);           // and leaves the search
  await sleep(200);

  await keyed("Settings");
  await capture("settings.appearance");
  await click("Playlists");              await capture("settings.playlists");
  await click("Add a playlist");         await capture("settings.playlistForm");
  await click("Cancel");                 await sleep(200);
  await click("Remove");                 await capture("settings.confirm");
  await click("Keep it");                await sleep(200);
  await click("Watching");               await capture("settings.behaviour");
  // Diagnostics reports what the set is, so it is the one screen whose content genuinely
  // differs between engines. It is walked anyway: what is measured here is the frame it
  // draws into, and a screen left out of the walk is a screen no gate has ever loaded.
  await click("Diagnostics");            await capture("settings.diagnostics");
  await click("About");                  await capture("settings.about");
  await d.press("Escape", 27);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 500 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 905, y: 505 });
  await capture("pointerPad");
  return shots;
}

/**
 * Compare two sets of measurements, reporting where they disagree.
 *
 * Returns the number of boxes that differ, and prints each with both figures, because "the
 * layout is wrong" is not actionable and "this container's third child is 8 pixels further
 * down" is.
 */
export function compare(a, b, { tolerance, labels, skip = new Set() }) {
  let differing = 0;
  let boxes = 0;
  let screens = 0;
  /*
   * The union of both sides, not just the reference's keys.
   *
   * Walking only `a` meant anything present in `b` and missing from `a` was never looked at,
   * and `a` is the leg most likely to be short: in the engine gate it is Chromium 69, the
   * oldest and slowest engine, driven by fixed waits. A box it failed to draw was invisible to
   * the comparison rather than a difference, so the gate was blindest exactly where the app is
   * most likely to be wrong.
   */
  for (const screen of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (skip.has(screen)) continue;
    screens += 1;
    const keys = new Set([...Object.keys(a[screen] ?? {}), ...Object.keys(b[screen] ?? {})]);
    for (const key of keys) {
      const left = a[screen]?.[key];
      if (!left) {
        console.error(`missing  ${screen} ${key}  (absent in ${labels[0]})`);
        differing += 1;
        boxes += 1;
        continue;
      }
      const right = b[screen]?.[key];
      boxes += 1;
      if (!right) {
        console.error(`missing  ${screen} ${key}  (absent in ${labels[1]})`);
        differing += 1;
        continue;
      }
      if (left.some((v, i) => Math.abs(v - right[i]) > tolerance)) {
        console.error(`differs  ${screen} ${key}`
          + `\n           ${labels[0].padEnd(10)} ${left.join(", ")}`
          + `\n           ${labels[1].padEnd(10)} ${right.join(", ")}`);
        differing += 1;
      }
    }
  }
  // The screens actually compared, not every screen either side happened to record. It used to
  // report the latter, so a summary said "across ten screens" when one had been skipped.
  return { boxes, differing, screens };
}
