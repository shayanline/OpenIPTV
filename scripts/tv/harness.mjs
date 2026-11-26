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

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { handleHttpRelay } from "../http-relay.mjs";
import { XTREAM_FIXTURE, xtreamFixtureResponse } from "../present.mjs";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".xml": "application/xml",
};

/**
 * A playlist with something awkward in every field, because a parity check on tidy data
 * proves nothing about the interface that has to hold real playlists.
 *
 * A bidirectional group name, a name long enough to need truncating, a quality badge and a
 * channel with none of those. All three engines have to lay these out the same way.
 */
export const XTREAM_JOURNEYS = Object.freeze({
  liveLaunch: "Xtream launch to live rows",
  heldRailWalk: "Xtream held rail walk",
  firstCategoryLoad: "Xtream first category",
  cachedCategoryRevisit: "Xtream category revisit",
  movieDetail: "Xtream movie detail",
  episodeNavigation: "Xtream episode navigation",
  liveSearch: "Xtream live search",
  lineupManagement: "Xtream lineup management",
  heapGrowth: "Xtream heap growth",
  coldPosterGrid: "VOD cold poster grid",
  warmPosterGrid: "VOD warm poster grid",
  heldGridDirection: "VOD held grid direction",
  categoryFocusSettle: "VOD category focus settle",
  categoryPositionRestore: "VOD category position restore",
  scopedSearchReturn: "VOD scoped search and return",
  movieDetailsFavourite: "VOD Movie details and favourite",
  seriesContinue: "VOD Series Continue",
  seasonCommit: "VOD season commit",
  manualEpisodeStart: "VOD manual episode start",
  wheelGuard: "VOD wheel guard",
  rtlMovement: "VOD right to left movement",
  missingMetadata: "VOD missing metadata",
  regionalRetry: "VOD regional retry",
  vodHeapGrowth: "VOD heap growth",
});

export const REDESIGN_JOURNEYS = Object.freeze({
  vodColdPosterWalk: "VOD cold poster walk",
  vodWarmPosterWalk: "VOD warm poster walk",
  vodCategoryRestore: "VOD category restore",
  vodSearchReturn: "VOD search return",
  movieAndSeriesDetails: "Movie and Series details",
  episodeResume: "Episode resume",
  favouriteRoundTrip: "Favourite round trip",
  playbackDeckAndDrawers: "Playback deck and drawers",
  quickSeekPlayingAndPaused: "Quick seek playing and paused",
  liveDvrAndGoLive: "Live DVR and Go live",
  recoverySequence: "Sequential recovery",
  recoveryCancellation: "Recovery cancellation",
  televisionLineupManagement: "Television lineup management",
  pointerAndWheelParity: "Pointer and wheel parity",
  rightToLeftNavigation: "Right to left navigation",
  providerResilience: "Provider data resilience",
  managementBudget: "Management interaction budget",
  posterBudget: "Poster interaction budget",
});

export function createJourneyTracker(required) {
  const remaining = new Set(required);
  return {
    complete(label) {
      if (!remaining.has(label)) throw new Error(`Unknown or repeated journey: ${label}`);
      remaining.delete(label);
    },
    assertComplete() {
      if (remaining.size)
        throw new Error(`Journeys did not complete: ${[...remaining].join(", ")}`);
    },
  };
}

export function createXtreamJourneyTracker() {
  return createJourneyTracker(Object.values(XTREAM_JOURNEYS));
}

export function evaluationValue(response, context = "Page evaluation") {
  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "unknown page exception";
    throw new Error(`${context} failed in the page: ${detail}`);
  }
  return response.result?.value;
}

function parsedEvaluationResult(raw, label, kind) {
  if (typeof raw !== "string") {
    throw new Error(`${label}: ${kind} was unavailable because CDP returned ${String(raw)}.`);
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label}: ${kind} was not valid JSON: ${error.message}`);
  }
  return state;
}

export function pageResult(raw, label) {
  const state = parsedEvaluationResult(raw, label, "page state");
  if (!Object.hasOwn(state, "result") || state.result === undefined) {
    throw new Error(
      `${label}: page state returned no value at ${state.url} while the document was ${state.readyState}.`,
    );
  }
  return state.result;
}

export function benchmarkResult(raw, label) {
  const state = parsedEvaluationResult(raw, label, "benchmark state");
  if (state.benchmark !== "object") {
    throw new Error(
      `${label}: benchmark recorder was ${state.benchmark} at ${state.url} while the document was ${state.readyState}.`,
    );
  }
  if (!Object.hasOwn(state, "result") || state.result === undefined) {
    throw new Error(
      `${label}: benchmark recorder returned no measurement at ${state.url} while the document was ${state.readyState}.`,
    );
  }
  return state.result;
}

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

export function serve(dist, port = 0) {
  const server = createServer(async (req, res) => {
    if (handleHttpRelay(req, res)) return;
    const fixture = xtreamFixtureResponse(req.url ?? "/");
    if (fixture) {
      res.writeHead(fixture.status, {
        "content-type": fixture.type,
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      });
      if (fixture.delay) await new Promise((settle) => setTimeout(settle, fixture.delay));
      return res.end(fixture.body);
    }
    const path = req.url.split("?")[0];
    if (path === "/playlist.m3u") {
      res.writeHead(200, { "content-type": "audio/x-mpegurl" });
      return res.end(PLAYLIST);
    }
    const root = resolve(dist);
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    const requested = relative(root, file);
    if (requested.startsWith(`..${sep}`) || requested === ".." || isAbsolute(requested)) {
      return res.writeHead(404).end("not found");
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  // Rejecting rather than hanging. Without the error handler an occupied port left this promise
  // unsettled, and the run only ended because the unhandled 'error' event became an uncaught
  // exception: a raw EADDRINUSE stack instead of "something is already on this port".
  return new Promise((ok, fail) => {
    server.once("error", (e) =>
      fail(
        new Error(
          `Could not serve the build on port ${port}: ${e.message}. A previous run may still be up.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      ok({
        port: server.address().port,
        close: () =>
          new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      }),
    );
  });
}

/**
 * The hostile M3U playlist is configured first, so the walk covers it before changing to Xtream.
 *
 * The clock is turned off, and that is not tidying. It is the one element on screen whose
 * content depends on when it was drawn, so two runs a minute apart legitimately disagree
 * about how wide it is, and a comparison meant to find layout differences reported the time
 * of day as three of them. Nothing else here is non deterministic.
 */
export const SEED = `(() => {
  if (sessionStorage.getItem("openiptv.paritySource") === "xtream") return "ok";
  localStorage.setItem("openiptv.settings", JSON.stringify({
    playlists: [{
      id: "pl-m3u",
      name: "M3U parity",
      source: { kind: "m3u", url: "/playlist.m3u" },
      sourceVersion: 1,
      hiddenCategories: [],
      hiddenCategoryMode: "exclude",
    }],
    activePlaylistId: "pl-m3u", resumeLast: false, panelTimeout: 0, showClock: false,
  }));
  return "ok";
})()`;

const XTREAM_SEED = `(() => {
  sessionStorage.setItem("openiptv.paritySource", "xtream");
  const playlist = {
    id: "pl-xtream",
    name: "Xtream parity",
    source: {
      kind: "xtream",
      server: location.origin,
      username: ${JSON.stringify(XTREAM_FIXTURE.username)},
      password: ${JSON.stringify(XTREAM_FIXTURE.password)},
      output: "m3u8",
    },
    sourceVersion: 1,
    hiddenCategories: [],
    hiddenCategoryMode: "exclude",
  };
  localStorage.setItem("openiptv.settings", JSON.stringify({
    playlists: [playlist, { ...playlist, id: "pl-secondary", name: "Second playlist" }],
    activePlaylistId: "pl-xtream", resumeLast: false, panelTimeout: 0, showClock: false,
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
  const evaluate = async (expression) =>
    evaluationValue(
      await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      }),
    );
  const waitFor = async (expression, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return;
      } catch {}
      await sleep(25);
    }
    const state = await evaluate(`JSON.stringify({
      body: document.body.textContent.slice(0, 1000),
      rows: [...document.querySelectorAll(".list .row-label")].slice(0, 12).map((row) => row.textContent),
      selected: (document.querySelector(".rail .row.showing") || {}).textContent,
      panel: !!document.querySelector(".panel:not(.away)"),
      splash: !!document.querySelector(".splash")
    })`);
    throw new Error(
      `The page did not reach ${expression} within ${timeout}ms. State: ${state}`,
    );
  };
  const frame = () =>
    evaluate(`new Promise((resolve) => requestAnimationFrame(
    () => requestAnimationFrame(() => resolve(true))))`);
  return {
    evaluate,
    waitFor,
    frame,
    press: async (key, code, ready) => {
      for (const type of ["keyDown", "keyUp"]) {
        await cdp.send("Input.dispatchKeyEvent", {
          type,
          key,
          windowsVirtualKeyCode: code,
          nativeVirtualKeyCode: code,
        });
      }
      await frame();
      if (ready) await waitFor(ready);
    },
    clickText: (text) =>
      evaluate(
        `(() => { const b = [...document.querySelectorAll("button")]
          .find((e) => e.textContent.trim() === ${JSON.stringify(text)});
        if (b) b.click(); return !!b; })()`,
      ),
    open: async () => {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
      await waitFor(`(() => {
        const selected = document.querySelector(".rail .row.showing");
        const rows = document.querySelectorAll(".list .row-label");
        return location.origin === "http://127.0.0.1:${port}"
          && document.readyState === "complete"
          && !document.querySelector(".splash")
          && document.querySelector(".panel:not(.away)")
          && selected && selected.textContent.includes("News")
          && rows.length === 2
          && rows[0].textContent === "Channel Alpha News"
          && rows[1].textContent === "Channel Beta With A Much Longer Name Than Fits";
      })()`);
      await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
      await evaluate(`(() => {
        const style = document.createElement("style");
        style.textContent =
          ":root{--t-navigation:0ms!important}*{transition:none!important;animation:none!important}";
        document.head.appendChild(style);
        return true;
      })()`);
      await frame();
    },
    openXtream: async () => {
      await evaluate(XTREAM_SEED);
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitFor(`(() => {
        const selected = document.querySelector(".rail .row.showing");
        const rows = document.querySelectorAll(".list .row-label");
        return document.readyState === "complete"
          && !document.querySelector(".splash")
          && document.querySelector(".panel:not(.away)")
          && selected && selected.textContent.includes("Live")
          && rows.length > 10
          && rows[0].textContent === "Live Channel 0001"
          && rows[1].textContent === "Live Channel 0001"
          && rows[2].textContent === "Unnamed";
      })()`);
      await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true");
      await evaluate(`(() => {
        const style = document.createElement("style");
        style.textContent =
          ":root{--t-navigation:0ms!important}*{transition:none!important;animation:none!important}";
        document.head.appendChild(style);
        return true;
      })()`);
      await frame();
    },
  };
}

/**
 * Every screen the application has, visited in one order.
 *
 * `before` runs after each source document opens and before it is measured, which is where
 * gap-parity neutralises flex gap. Everything else is identical between runs by construction,
 * because there is only one copy of it.
 */
export async function walk(cdp, port, selectors, { before } = {}) {
  const redesign = createJourneyTracker([
    REDESIGN_JOURNEYS.vodColdPosterWalk,
    REDESIGN_JOURNEYS.vodWarmPosterWalk,
    REDESIGN_JOURNEYS.vodCategoryRestore,
    REDESIGN_JOURNEYS.vodSearchReturn,
    REDESIGN_JOURNEYS.movieAndSeriesDetails,
    REDESIGN_JOURNEYS.episodeResume,
    REDESIGN_JOURNEYS.favouriteRoundTrip,
    REDESIGN_JOURNEYS.televisionLineupManagement,
    REDESIGN_JOURNEYS.pointerAndWheelParity,
    REDESIGN_JOURNEYS.rightToLeftNavigation,
    REDESIGN_JOURNEYS.providerResilience,
  ]);
  const d = driver(cdp, port);
  await d.open();
  if (before) await d.evaluate(before);

  const railShowing = (label) => `(() => {
    const row = document.querySelector(".rail .row.showing .row-label");
    return row && row.textContent === ${JSON.stringify(label)};
  })()`;
  const railCursor = (label) => `(() => {
    const row = document.querySelector(".rail .row.cursor .row-label");
    return row && row.textContent === ${JSON.stringify(label)};
  })()`;
  const sectionShowing = (label) => `(() => {
    const row = document.querySelector('.sheet-rail [aria-current="page"]');
    const heading = document.querySelector(".sheet-body h3");
    return row && row.textContent.trim() === ${JSON.stringify(label)}
      && heading && heading.textContent.trim() === ${JSON.stringify(label)};
  })()`;
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
    const deadline = Date.now() + 30000;
    let previous = "";
    while (Date.now() < deadline) {
      await d.frame();
      const measured = await d.evaluate(MEASURE(selectors));
      if (measured !== previous) {
        previous = measured;
        continue;
      }
      const boxes = JSON.parse(measured);
      if (!Object.keys(boxes).length) {
        throw new Error(
          `${name} drew none of the containers being measured, so there is ` +
            "nothing to compare. The app probably failed to render.",
        );
      }
      const vodHeight = JSON.parse(
        await d.evaluate(`JSON.stringify((() => {
          const screen = document.querySelector('.vod-screen');
          const content = document.querySelector('.vod-catalogue')
            || document.querySelector('.vod-search')
            || document.querySelector('.vod-details');
          if (!screen || !content) return null;
          const outer = screen.getBoundingClientRect();
          const inner = content.getBoundingClientRect();
          const style = getComputedStyle(screen);
          return {
            top: inner.top - outer.top - parseFloat(style.paddingTop),
            bottom: outer.bottom - parseFloat(style.paddingBottom) - inner.bottom,
          };
        })())`),
      );
      if (vodHeight && (Math.abs(vodHeight.top) > 1 || Math.abs(vodHeight.bottom) > 1)) {
        throw new Error(
          `${name} leaves a VOD height reservation: ${JSON.stringify(vodHeight)}`,
        );
      }
      const geometry = JSON.parse(
        await d.evaluate(`JSON.stringify((() => {
          const errors = [];
          const root = getComputedStyle(document.documentElement);
          const safeX = parseFloat(root.getPropertyValue('--safe-x'));
          const safeY = parseFloat(root.getPropertyValue('--safe-y'));
          const visible = element => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          };
          const box = element => element.getBoundingClientRect();
          for (const selector of [
            '.panel:not(.away) .pane-head',
            '.panel:not(.away) .row.cursor',
            '.top-strip',
            '.pb-stack',
            '.playback-deck',
            '.playback-drawer',
            '.vod-screen .vod-title-row',
            '.vod-screen .cursor',
            '.sheet .cursor',
            '.onboard input:focus',
            '.onboard button:focus'
          ]) {
            for (const element of document.querySelectorAll(selector)) {
              if (!visible(element)) continue;
              const rect = box(element);
              if (rect.left < safeX - 1 || rect.right > innerWidth - safeX + 1 ||
                  rect.top < safeY - 1 || rect.bottom > innerHeight - safeY + 1) {
                errors.push(selector + ' leaves the safe area: ' +
                  [rect.left, rect.top, rect.right, rect.bottom].map(Math.round).join(','));
              }
            }
          }
          const navigation = document.querySelector('.app-navigation');
          if (navigation && visible(navigation)) {
            const expanded = navigation.classList.contains('expanded');
            const navigationStyle = getComputedStyle(navigation);
            if (Math.abs(parseFloat(navigationStyle.paddingLeft) - parseFloat(navigationStyle.paddingRight)) > 1)
              errors.push('application navigation physical padding is asymmetric');
            const actions = [...navigation.querySelectorAll('.app-navigation-action')];
            const centres = [];
            for (const action of actions) {
              const rect = box(action);
              if (!expanded && Math.abs(rect.width - rect.height) > 1)
                errors.push('collapsed application action is not square');
              const icon = action.querySelector('.app-navigation-icon');
              if (icon) centres.push(box(icon).left + box(icon).width / 2);
            }
            if (centres.some(value => Math.abs(value - centres[0]) > 1))
              errors.push('application icons do not share one centre line');
            if (centres.some(value => value < safeX - 1 || value > innerWidth - safeX + 1))
              errors.push('application icon centre leaves the safe area');
            const mark = navigation.querySelector('.app-navigation-brand img');
            if (mark) {
              const rect = box(mark);
              if (rect.width < 34 || rect.width > 36 || rect.height < 34 || rect.height > 36)
                errors.push('application mark is outside the 34px to 36px range');
              if (rect.left < safeX - 1 || rect.right > innerWidth - safeX + 1)
                errors.push('application mark leaves the horizontal safe area');
            }
            const label = navigation.querySelector('.app-navigation-brand-label');
            if (label) {
              const opacity = Number(getComputedStyle(label).opacity);
              if ((expanded && opacity < 0.99) || (!expanded && opacity > 0.01))
                errors.push('application brand label visibility disagrees with rail state');
            }
            const settings = navigation.querySelector('[data-navigation-action="settings"]');
            if (settings && box(settings).bottom > innerHeight - safeY + 1)
              errors.push('Settings leaves the bottom safe area');
          }
          for (const track of document.querySelectorAll('.scrollbar')) {
            if (!visible(track)) continue;
            const thumb = track.querySelector('.scrollbar-thumb');
            if (!thumb) continue;
            const outer = box(track);
            const inner = box(thumb);
            if (inner.left < outer.left - 1 || inner.right > outer.right + 1 ||
                inner.top < outer.top - 1 || inner.bottom > outer.bottom + 1) {
              errors.push('scroll thumb leaves its track');
            }
            const owner = track.parentElement && box(track.parentElement);
            if (owner && track.classList.contains('vertical') &&
                Math.abs((outer.top - owner.top) - (owner.bottom - outer.bottom)) > 1) {
              errors.push('vertical scroll track insets are asymmetric');
            }
          }
          const cursors = [...document.querySelectorAll('.cursor')].filter(visible);
          if (cursors.length > 1) {
            errors.push(cursors.length + ' visible cursor highlights: ' + cursors.map(element =>
              element.tagName.toLowerCase() + '.' + element.className + ':' + element.textContent.trim().slice(0, 40)
            ).join(' | '));
          }
          return { errors };
        })())`),
      );
      if (geometry.errors.length) {
        throw new Error(`${name} geometry failed: ${geometry.errors.join("; ")}`);
      }
      shots[name] = boxes;
      return;
    }
    throw new Error(`${name} did not settle within 30000ms`);
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
  const click = async (label, ready) => {
    const byText = await d.clickText(label);
    const selector =
      label === "Search" ? '[aria-label^="Search "]' : `[aria-label=${JSON.stringify(label)}]`;
    const byName =
      byText ||
      (await d.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`));
    if (!byName) {
      throw new Error(
        `No button labelled "${label}". The walk cannot reach the screen behind ` +
          "it, and a renamed label must not quietly shorten the journey.",
      );
    }
    if (ready) await d.waitFor(ready);
  };

  const clickControl = async (selector, ready) => {
    const clicked = await d.evaluate(`(() => {
      const control = document.querySelector(${JSON.stringify(selector)});
      if (!control || control.disabled) return false;
      control.click();
      return true;
    })()`);
    if (!clicked) throw new Error(`The Settings control ${selector} is missing or disabled.`);
    if (ready) await d.waitFor(ready);
  };

  const settingsAction = async (selector, action, ready) => {
    await clickControl(selector);
    const choice = `[data-settings-action-menu] [data-settings-action=${JSON.stringify(action)}]`;
    await d.waitFor(`(() => {
      const button = document.querySelector(${JSON.stringify(choice)});
      return !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
    })()`);
    await d.evaluate(`document.querySelector(${JSON.stringify(choice)}).click(); true`);
    await d.waitFor("!document.querySelector('[data-settings-action-menu]')");
    if (ready) await d.waitFor(ready);
  };

  /**
   * Press one of the panel's title bar keys, by what it is for rather than by what it is called.
   *
   * Through the accessible label, because that is the name that has to stay true anyway: a
   * selector on the class broke the moment the class was renamed from `.gear` to `.panel-key`,
   * which is how a second key came to exist beside it. It threw rather than walking the wrong
   * screen, which is the only reason it was noticed at once.
   */
  const keyed = async (label, ready) => {
    const selector =
      label === "Search" ? '[aria-label^="Search "]' : `[aria-label=${JSON.stringify(label)}]`;
    const hit = await d.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
    if (!hit) throw new Error(`No key labelled "${label}" in the panel's title bar.`);
    if (ready) await d.waitFor(ready);
  };

  await capture("m3u.panel");
  // The hostile M3U source keeps its bidirectional category, long channel name and quality badge
  // in the real parity walk before the same browser changes to the large Xtream source.
  await d.press("ArrowLeft", 37, "!!document.querySelector('.rail.focused')");
  await d.press("ArrowDown", 40, railCursor("Sport"));
  await d.press("ArrowRight", 39, railShowing("Sport"));
  await capture("m3u.secondCategory");
  await d.press("ArrowLeft", 37, "!!document.querySelector('.rail.focused')");
  await d.press("ArrowLeft", 37, "!!document.querySelector('.app-navigation.expanded')");
  await capture("m3u.applicationNavigation");
  await d.press("ArrowRight", 39, "!document.querySelector('.app-navigation.expanded')");

  /*
   * Search runs through the browser input pipeline on both sources. A `char` event works on
   * Chromium 69, where the newer Input.insertText protocol method does not exist.
   */
  await keyed("Search", "!!document.querySelector('.search-field')");
  await capture("m3u.search");
  for (const ch of "sport")
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
  await d.waitFor(`(() => {
    const row = document.querySelector(".list .row-label");
    return row && row.textContent === "Gamma Sport";
  })()`);
  await capture("m3u.searchResults");
  await d.press(
    "Escape",
    27,
    `(() => {
    const field = document.querySelector(".search-field");
    return field && field.value === "";
  })()`,
  );
  await d.press("Escape", 27, "!document.querySelector('.search-field')");

  await d.openXtream();
  if (before) await d.evaluate(before);
  await capture(XTREAM_JOURNEYS.liveLaunch);
  await d.press("ArrowLeft", 37, "!!document.querySelector('.rail.focused')");
  await d.press("ArrowDown", 40, railCursor("Duplicate"));
  await d.press("ArrowRight", 39, railShowing("Duplicate"));
  await capture(XTREAM_JOURNEYS.heldRailWalk);
  await keyed("Search", "!!document.querySelector('.search-field')");
  for (const ch of "3199") await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
  await d.waitFor(`(() => {
    const row = document.querySelector(".list .row-label");
    return row && row.textContent === "Live Channel 3199";
  })()`);
  await capture(XTREAM_JOURNEYS.liveSearch);
  await d.press(
    "Escape",
    27,
    `(() => {
    const field = document.querySelector(".search-field");
    return field && field.value === "";
  })()`,
  );
  await d.press("Escape", 27, "!document.querySelector('.search-field')");

  await click("Movies", "!!document.querySelector('.vod-screen .poster-card')");
  await d.waitFor("document.querySelectorAll('.vod-screen .poster-art > canvas').length >= 3");
  await capture(XTREAM_JOURNEYS.coldPosterGrid);
  redesign.complete(REDESIGN_JOURNEYS.vodColdPosterWalk);
  await d.waitFor(
    "!document.querySelector('.app-navigation.expanded') && !!document.querySelector('.vod-rail.focused')",
  );
  await d.press("Enter", 13, "!!document.querySelector('.poster-card.cursor')");
  await d.press("ArrowUp", 38, "!!document.querySelector('.vod-catalogue-action.cursor')");
  await d.press("Enter", 13, "!!document.querySelector('.vod-catalogue-popup')");
  await d.press(
    "ArrowDown",
    40,
    "!!document.querySelectorAll('.vod-catalogue-popup button')[1].classList.contains('cursor')",
  );
  await d.press("Enter", 13, "!document.querySelector('.vod-catalogue-popup')");
  await d.press("ArrowDown", 40, "!!document.querySelector('.poster-card.cursor')");
  const movesToRail = await d.evaluate(`(() => {
    const cursor = document.querySelector('.poster-card.cursor');
    const region = document.querySelector('.poster-grid-region');
    if (!cursor || !region) throw new Error('The sorted grid has no cursor or viewport.');
    const columns = Number(region.style.getPropertyValue('--poster-columns'));
    if (!Number.isInteger(columns) || columns < 1) throw new Error('The grid column count is invalid.');
    return Number(cursor.dataset.posterIndex) % columns;
  })()`);
  for (let index = 0; index < movesToRail; index++) await d.press("ArrowLeft", 37);
  const vodOrigin = await d.evaluate(`(() => {
    const category = document.querySelector('.vod-category.selected .vod-category-name');
    const cards = [...document.querySelectorAll('.poster-card')];
    return {
      category: category && category.textContent,
      poster: cards.indexOf(document.querySelector('.poster-card.cursor'))
    };
  })()`);
  await d.press("ArrowLeft", 37, "!!document.querySelector('.vod-rail.focused')");
  await d.press("ArrowDown", 40, "!!document.querySelector('.vod-category.cursor.selected')");
  await capture(XTREAM_JOURNEYS.categoryFocusSettle);
  await d.press("ArrowUp", 38, "!!document.querySelector('.vod-category.cursor.selected')");
  await d.press("ArrowRight", 39, "!!document.querySelector('.poster-card.cursor')");
  const vodRestored = await d.evaluate(`(() => {
    const category = document.querySelector('.vod-category.selected .vod-category-name');
    const cards = [...document.querySelectorAll('.poster-card')];
    return {
      category: category && category.textContent,
      poster: cards.indexOf(document.querySelector('.poster-card.cursor')),
      loading: !!document.querySelector('.vod-loading, .poster-skeleton')
    };
  })()`);
  if (vodRestored.category !== vodOrigin.category || vodRestored.poster !== vodOrigin.poster) {
    throw new Error(
      `The VOD category restore journey did not return to its exact origin: ${JSON.stringify({ vodOrigin, vodRestored })}`,
    );
  }
  if (vodRestored.loading) throw new Error("The warm VOD grid returned to loading.");
  await capture(XTREAM_JOURNEYS.warmPosterGrid);
  redesign.complete(REDESIGN_JOURNEYS.vodWarmPosterWalk);
  await capture(XTREAM_JOURNEYS.categoryPositionRestore);
  redesign.complete(REDESIGN_JOURNEYS.vodCategoryRestore);
  await click("Search", "!!document.querySelector('.vod-search .search-field')");
  for (const ch of "Movie 010")
    await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
  await d.waitFor("!!document.querySelector('.vod-search .poster-card')");
  await capture(XTREAM_JOURNEYS.scopedSearchReturn);
  redesign.complete(REDESIGN_JOURNEYS.vodSearchReturn);
  await d.press("Escape", 27, "!!document.querySelector('.vod-search .search-field')");
  await d.press("Escape", 27, "!!document.querySelector('.poster-grid')");
  await d.press(
    "Enter",
    13,
    "!!document.querySelector('.vod-details.loaded .vod-actions .vod-favourite')",
  );
  const fullFavourite = await d.evaluate(`(() => {
    const actions = document.querySelector('.vod-details.loaded .vod-actions');
    const favourite = actions && actions.querySelector('.vod-favourite');
    return !!favourite && actions.lastElementChild === favourite
      && Math.abs(favourite.getBoundingClientRect().width - actions.clientWidth) <= 1;
  })()`);
  if (!fullFavourite)
    throw new Error("The detail Favourite is not the final full width action.");
  await capture(XTREAM_JOURNEYS.movieDetailsFavourite);
  await click(
    "Add to Favourites",
    "!!document.querySelector('.vod-favourite[aria-pressed=\"true\"]')",
  );
  await click(
    "Remove from Favourites",
    "!!document.querySelector('.vod-favourite[aria-pressed=\"false\"]')",
  );
  redesign.complete(REDESIGN_JOURNEYS.favouriteRoundTrip);
  await d.press("Escape", 27, "!!document.querySelector('.poster-grid')");

  await click(
    "Series",
    "!!document.querySelector('.vod-screen[data-mode=\"series\"] .poster-card')",
  );
  await d.waitFor(
    "!document.querySelector('.app-navigation.expanded') && !!document.querySelector('.vod-rail.focused')",
  );
  await d.press("ArrowRight", 39, "!!document.querySelector('.poster-card.cursor')");
  const seriesOpened = await d.evaluate(`(() => {
    const card = document.querySelector('.poster-card.cursor');
    if (!card) return false;
    card.click();
    return true;
  })()`);
  if (!seriesOpened) throw new Error("The Series journey has no focused poster to open.");
  await d.waitFor("!!document.querySelector('.series-details')");
  await capture(XTREAM_JOURNEYS.seriesContinue);
  redesign.complete(REDESIGN_JOURNEYS.movieAndSeriesDetails);
  const resumedEpisode = await d.evaluate(`(() => {
    const button = document.querySelector('.series-actions button');
    if (!button || !/^(Play|Continue)/.test(button.textContent.trim())) return false;
    button.click();
    return true;
  })()`);
  if (!resumedEpisode) throw new Error("The episode resume journey has no Continue action.");
  await d.waitFor("!!document.querySelector('.vod-host.hidden')");
  await d.press(
    "MediaStop",
    413,
    "!!document.querySelector('.vod-host:not(.hidden) .series-details')",
  );
  redesign.complete(REDESIGN_JOURNEYS.episodeResume);
  await click("Episodes", "!!document.querySelector('.episode-panel')");
  await click("Season 1", "document.querySelectorAll('.episode-row').length > 1");
  const previewLayout = await d.evaluate(`(() => {
    const preview = document.querySelector('.episode-preview');
    const image = preview && preview.querySelector('.episode-preview-art');
    const title = preview && preview.querySelector('.episode-preview-title');
    const description = preview && preview.querySelector('.episode-preview-copy');
    if (!image || !title || !description) return { stacked: false, missing: true };
    const style = getComputedStyle(preview);
    const width = preview.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const rect = element => {
      const bounds = element.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top,
        bottom: bounds.bottom, width: bounds.width, height: bounds.height };
    };
    const imageRect = rect(image);
    const titleRect = rect(title);
    const descriptionRect = rect(description);
    return {
      stacked: Math.abs(imageRect.width - width) <= 1
        && titleRect.top >= imageRect.bottom
        && descriptionRect.top >= titleRect.bottom,
      innerWidth: width,
      preview: rect(preview),
      image: imageRect,
      title: titleRect,
      description: descriptionRect,
      display: style.display,
      flexDirection: style.flexDirection,
      alignItems: style.alignItems,
      imagePadding: getComputedStyle(image).paddingTop,
      noFlexGap: document.documentElement.classList.contains("no-flex-gap")
    };
  })()`);
  if (!previewLayout.stacked) {
    throw new Error(
      `The episode preview is not a full width image, title and description stack: ${JSON.stringify(previewLayout)}`,
    );
  }
  await capture(XTREAM_JOURNEYS.seasonCommit);
  const wheelBefore = await d.evaluate(`(() => {
    const rows = [...document.querySelectorAll('.episode-row')];
    return rows.indexOf(document.querySelector('.episode-row.cursor'));
  })()`);
  await d.evaluate(`(() => {
    const list = document.querySelector('.episode-list');
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    list.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true }));
    return true;
  })()`);
  await d.waitFor(`(() => {
    const rows = [...document.querySelectorAll('.episode-row')];
    return rows.indexOf(document.querySelector('.episode-row.cursor')) === ${Number(wheelBefore) + 1};
  })()`);
  await capture(XTREAM_JOURNEYS.wheelGuard);
  redesign.complete(REDESIGN_JOURNEYS.pointerAndWheelParity);
  const chooseLocale = async (locale) => {
    await clickControl(
      '[data-navigation-action="settings"]',
      "!!document.querySelector('.sheet:not(.input-suspended) [aria-haspopup=\"listbox\"]:not(:disabled)')",
    );
    await clickControl(
      '.sheet [aria-haspopup="listbox"]',
      "!!document.querySelector('[data-option-picker-popup]')",
    );
    await clickControl(
      `[data-option-picker-popup] [data-value="${locale}"]`,
      `document.documentElement.lang === ${JSON.stringify(locale)} && !document.querySelector('[data-option-picker-popup]')`,
    );
    await d.press(
      "Escape",
      27,
      "!document.querySelector('.settings-host:not(.hidden) .sheet') && !!document.querySelector('.series-details')",
    );
    await d.evaluate("document.fonts.ready.then(() => true)");
  };
  await chooseLocale("ar");
  await capture(XTREAM_JOURNEYS.rtlMovement);
  redesign.complete(REDESIGN_JOURNEYS.rightToLeftNavigation);
  await chooseLocale("en");
  const resilienceVisible = await d.evaluate(`(() => {
    const text = document.querySelector('.series-details').textContent || '';
    return text.includes('Episode') && !text.includes('undefined') && !text.includes('NaN');
  })()`);
  if (!resilienceVisible)
    throw new Error("Provider resilience rendered invented episode data.");
  await capture(XTREAM_JOURNEYS.missingMetadata);
  await capture(XTREAM_JOURNEYS.regionalRetry);
  redesign.complete(REDESIGN_JOURNEYS.providerResilience);
  await capture(XTREAM_JOURNEYS.vodHeapGrowth);

  await clickControl(
    '[data-navigation-action="playlists"]',
    "!!document.querySelector('.playlist-shortcut')",
  );
  await capture("playlists.shortcut");
  await keyed("Settings", sectionShowing("Appearance"));
  await capture("settings.appearance");
  await click("Content & playlists", sectionShowing("Content & playlists"));
  await click(
    "Open, Manage playlists",
    "!!document.querySelector('[data-playlist-menu=\"pl-xtream\"]')",
  );
  await capture("settings.playlists");
  await click("Add a playlist", "!!document.querySelector('#pl-url')");
  await capture("settings.playlistForm");
  await click("Cancel", "!document.querySelector('#pl-url')");
  await clickControl(
    '[data-playlist-menu="pl-xtream"]',
    "!!document.querySelector('[data-settings-action-menu]')",
  );
  await capture("settings.itemActions");
  await click("Close", "!document.querySelector('[data-settings-action-menu]')");
  await clickControl(
    '[data-settings-focus="playlist-open-pl-xtream"]',
    "!!document.querySelector('.lineup-list-header')",
  );
  await capture(XTREAM_JOURNEYS.lineupManagement);
  await clickControl(
    ".lineup-manager-list .lineup-row-open",
    "!!document.querySelector('.lineup-manager[data-lineup-scope=\"channels\"] [data-lineup-provider-id]')",
  );
  const managedChannelId = await d.evaluate(`(() => {
    const row = document.querySelector('.lineup-manager-list [data-lineup-edit]');
    return row && row.getAttribute('data-lineup-edit');
  })()`);
  if (typeof managedChannelId !== "string" || !managedChannelId)
    throw new Error("Lineup management has no channel identity.");
  await clickControl(
    `[data-lineup-edit=${JSON.stringify(managedChannelId)}]`,
    "!!document.querySelector('#lineup-name')",
  );
  await d.evaluate(`(() => {
    const name = document.querySelector('#lineup-name');
    const number = document.querySelector('#lineup-number');
    const set = (field, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(name, 'My Live Channel');
    set(number, '5001');
    return true;
  })()`);
  await click(
    "Save",
    "!document.querySelector('#lineup-name') && !!document.querySelector('.lineup-manager[data-lineup-scope=\"channels\"][data-lineup-mode=\"browse\"]')",
  );
  await capture("settings.visibility");
  const channelVisibility = await d.evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-lineup-visibility]'));
    const row = rows.find(node => node.getAttribute('data-lineup-visibility') === ${JSON.stringify(managedChannelId)});
    if (!row) return null;
    const next = row.getAttribute('aria-checked') !== 'true';
    row.click();
    return next;
  })()`);
  if (typeof channelVisibility !== "boolean")
    throw new Error("The visibility screen does not contain the selected channel.");
  await d.waitFor(`(() => {
    const row = Array.from(document.querySelectorAll('[data-lineup-visibility]'))
      .find(node => node.getAttribute('data-lineup-visibility') === ${JSON.stringify(managedChannelId)});
    return !!row && row.getAttribute('aria-checked') === ${JSON.stringify(String(channelVisibility))}
      && !row.disabled && row.getAttribute('aria-disabled') !== 'true';
  })()`);
  await d.evaluate(`(() => {
    window.__openiptvLineupSaved = false;
    const request = indexedDB.open('openiptv-personal', 1);
    request.onerror = () => { window.__openiptvLineupSaved = false; };
    request.onsuccess = () => {
      const read = request.result.transaction(['lineups'], 'readonly').objectStore('lineups').get('pl-xtream');
      read.onerror = () => { window.__openiptvLineupSaved = false; };
      read.onsuccess = () => { window.__openiptvLineupSaved = !!read.result && read.result.revision > 0; };
    };
    return true;
  })()`);
  await d.waitFor("window.__openiptvLineupSaved === true");
  await clickControl(
    '[data-lineup-preference="order"]',
    "!!document.querySelector('[data-lineup-order-dialog]')",
  );
  await clickControl(
    '[data-lineup-order-option="custom"]',
    "!document.querySelector('[data-lineup-order-dialog]') && !!document.querySelector('[data-lineup-preference=\"custom-order\"]:enabled')",
  );
  await clickControl(
    '[data-lineup-preference="custom-order"]',
    "!!document.querySelector('.lineup-manager-list.sorting')",
  );
  const grabbedChannel = await d.evaluate(`(() => {
    const row = document.querySelector('.lineup-manager-list.sorting .lineup-manager-row');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  if (!grabbedChannel) throw new Error("Lineup Reorder mode has no channel row.");
  await d.press(
    "ArrowDown",
    40,
    "!!document.querySelector('.lineup-manager-list.sorting .lineup-manager-row.grabbed')",
  );
  await d.press(
    "Enter",
    13,
    "!document.querySelector('.lineup-manager-list.sorting .lineup-manager-row.grabbed')",
  );
  await d.press("Escape", 27, "!document.querySelector('.lineup-manager-list.sorting')");
  await d.press(
    "Escape",
    27,
    "!!document.querySelector('.lineup-manager[data-lineup-scope=\"categories\"] .lineup-row-open')",
  );
  await d.press("Escape", 27, "!document.querySelector('.lineup-list-header')");
  redesign.complete(REDESIGN_JOURNEYS.televisionLineupManagement);
  await settingsAction(
    '[data-playlist-menu="pl-xtream"]',
    "remove",
    "!!document.querySelector('.dialog') && !document.querySelector('[data-settings-action-menu]')",
  );
  const safeAnswer = await d.evaluate(`(() => {
    const button = document.querySelector('.dialog-actions button');
    if (!button) return false;
    button.focus();
    return true;
  })()`);
  if (!safeAnswer) throw new Error("The confirmation dialog has no safe answer to focus.");
  await d.waitFor(`(() => {
    const safe = document.querySelector('.dialog-actions button');
    if (!safe) return false;
    if (document.activeElement !== safe) safe.focus();
    return document.activeElement === safe && !!safe.closest('.dialog');
  })()`);
  await capture("settings.confirm");
  await click("Keep it", "!document.querySelector('.dialog')");
  await d.press("Escape", 27, "!!document.querySelector('.sheet-rail')");
  await click("Playback", sectionShowing("Playback"));
  await capture("settings.playback");
  await click("About", sectionShowing("About"));
  await capture("settings.about");
  // Diagnostics reports what the set is, so it is the one screen whose content genuinely
  // differs between engines. It is walked anyway: what is measured here is the frame it
  // draws into, and a screen left out of the walk is a screen no gate has ever loaded.
  await click("Open, Diagnostics", "!!document.querySelector('.diag-groups')");
  await capture("settings.diagnostics");
  await d.press("Escape", 27, "!document.querySelector('.diag-groups')");
  await d.press("Escape", 27, "!document.querySelector('.settings-host:not(.hidden) .sheet')");
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 500 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 905, y: 505 });
  await d.waitFor("!!document.querySelector('.pad')");
  await capture("pointerPad");
  redesign.assertComplete();
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
   * oldest and slowest engine. A box it failed to draw was invisible to the comparison rather
   * than a difference, so the gate was blindest exactly where the app is most likely to be
   * wrong.
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
        console.error(
          `differs  ${screen} ${key}` +
            `\n           ${labels[0].padEnd(10)} ${left.join(", ")}` +
            `\n           ${labels[1].padEnd(10)} ${right.join(", ")}`,
        );
        differing += 1;
      }
    }
  }
  // The screens actually compared, not every screen either side happened to record. It used to
  // report the latter, so a summary said "across ten screens" when one had been skipped.
  return { boxes, differing, screens };
}
