export function diagnosticOptions({ has, arg }) {
  for (const name of ["floor", "reference", "budget", "cpu-score", "harsh"]) {
    if (has(name) || arg(name) !== undefined) {
      throw new Error(
        `--${name} has been retired. Desktop diagnostics do not model TV hardware or ` +
          "provide a performance verdict. Use --bench, or tv:on-set for hardware evidence.",
      );
    }
  }
  if (has("quick") && has("profile")) {
    throw new Error("--quick and --profile select different diagnostic journeys.");
  }
  const cpu = Number(arg("cpu") ?? 1);
  if (!Number.isFinite(cpu) || cpu < 1 || (has("cpu") && arg("cpu") === undefined)) {
    throw new Error("--cpu must be a finite slowdown of at least 1.");
  }
  return { cpu };
}

// Both drivers wait for the committed category, not posters retained from the previous one.
export const vodCategoryReady = (kind, focus = "rail") => `(() => {
  const host = document.querySelector('.vod-host:not(.hidden) .vod-screen[data-mode="${kind}"]');
  return !!host
    && !!host.querySelector(${JSON.stringify(focus === "grid" ? ".poster-card.cursor" : ".vod-rail.focused .vod-category.cursor")})
    && !!host.querySelector('.vod-pane[aria-busy="false"] .poster-grid .poster-card');
})()`;

// Validate recording and journey coverage only. Durations never establish a TV pass.
export function assessSample(
  result,
  { kind = "interaction", focus = false, presses, distance } = {},
) {
  const failures = [];
  const fail = (message) => failures.push(`${result.label}: ${message}`);
  if (!Number.isInteger(result.of) || result.of < 1 || result.hidden) {
    fail("no visible callback sample");
    return failures;
  }
  for (const field of ["rafHz", "p95", "worst", "stallTimePercent", "elapsed"]) {
    if (!Number.isFinite(result[field]) || result[field] < 0) {
      fail(`invalid ${field} measurement`);
    }
  }
  if (result.elapsed === 0) fail("empty measurement window");
  if (failures.length) return failures;
  if (kind === "cold-category") {
    if (!Number.isFinite(result.readyMs) || result.readyMs < 0) {
      fail("invalid readyMs measurement");
    }
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
      fail("no input to DOM focus sample");
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
    }
  }
  return failures;
}
