export const UI_GOALS = Object.freeze({
  minFps: 30,
  frameP95Ms: 50,
  longestFrameMs: 250,
  stallTimePercent: 10,
  inputP95Ms: 100,
  longestInputMs: 250,
});

export const STARTUP_GOALS = Object.freeze({
  "the channel rows": 6000,
  "the channel named": 6500,
});

// Engineering UX budget for the controlled fixture, not a measured TV certification.
export const COLD_CATEGORY_GOALS = Object.freeze({ readyMs: 2000 });

// Both drivers wait for the committed category, not posters retained from the previous one.
export const vodCategoryReady = (kind, focus = "rail") => `(() => {
  const host = document.querySelector('.vod-host:not(.hidden) .vod-screen[data-mode="${kind}"]');
  return !!host
    && !!host.querySelector(${JSON.stringify(focus === "grid" ? ".poster-card.cursor" : ".vod-rail.focused .vod-category.cursor")})
    && !!host.querySelector('.vod-pane[aria-busy="false"] .poster-grid .poster-card');
})()`;

export function assessPhase(
  result,
  { kind = "interaction", focus = false, presses, distance } = {},
) {
  const failures = [];
  const fail = (message) => failures.push(`${result.label}: ${message}`);
  if (!Number.isInteger(result.of) || result.of < 1 || result.hidden) {
    fail("no visible frame sample");
    return failures;
  }
  for (const field of ["fps", "p95", "worst", "stallTimePercent", "elapsed"]) {
    if (!Number.isFinite(result[field]) || result[field] < 0) {
      fail(`invalid ${field} measurement`);
    }
  }
  if (result.elapsed === 0) fail("empty measurement window");
  if (failures.length) return failures;
  if (result.fps < UI_GOALS.minFps) {
    fail(`${result.fps} main thread FPS, at least ${UI_GOALS.minFps} required`);
  }
  if (result.p95 > UI_GOALS.frameP95Ms) {
    fail(`${result.p95}ms frame p95, ${UI_GOALS.frameP95Ms}ms allowed`);
  }
  if (result.worst > UI_GOALS.longestFrameMs) {
    fail(`${result.worst}ms longest frame gap, ${UI_GOALS.longestFrameMs}ms allowed`);
  }
  if (kind === "cold-category") {
    if (!Number.isFinite(result.readyMs) || result.readyMs < 0) {
      fail("invalid readyMs measurement");
    } else if (result.readyMs > COLD_CATEGORY_GOALS.readyMs) {
      fail(
        `${result.readyMs}ms to committed category readiness, ` +
          `${COLD_CATEGORY_GOALS.readyMs}ms allowed`,
      );
    }
  } else if (result.stallTimePercent > UI_GOALS.stallTimePercent) {
    fail(
      `${result.stallTimePercent}% of time in frame gaps over 100ms, ` +
        `${UI_GOALS.stallTimePercent}% allowed`,
    );
  }
  if (focus) {
    if (
      !result.hadCursor ||
      !Number.isInteger(result.presses) ||
      result.presses < 1 ||
      !Number.isFinite(result.inputP95) ||
      result.inputP95 < 0 ||
      !Number.isFinite(result.worstLag) ||
      result.worstLag < 0
    ) {
      fail("no input to visible focus sample");
    } else {
      if (result.inputClockErrors) fail("input timestamps do not share the recorder clock");
      if (presses !== undefined && result.presses !== presses) {
        fail(`${result.presses} direction presses measured, ${presses} required`);
      }
      if (distance !== undefined && result.distance !== distance) {
        fail(`${result.distance} items traversed, ${distance} required`);
      }
      if (result.answered !== result.presses) {
        fail(`${result.answered} of ${result.presses} direction presses answered`);
      }
      if (result.inputP95 > UI_GOALS.inputP95Ms) {
        fail(`${result.inputP95}ms input p95, ${UI_GOALS.inputP95Ms}ms allowed`);
      }
      if (result.worstLag > UI_GOALS.longestInputMs) {
        fail(
          `${result.worstLag}ms longest input response, ${UI_GOALS.longestInputMs}ms allowed`,
        );
      }
    }
  }
  return failures;
}
