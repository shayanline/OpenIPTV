/**
 * The recorder half of the benchmark: it watches frames and nothing else.
 *
 * The driving deliberately happens from outside, in sim.mjs, using the browser's real input
 * pipeline. The previous version did both from in here, synthesising key events and
 * dispatching them straight at window from inside its own animation frame callback, and it
 * was worse than useless: it reported not a single missed frame on a build that was
 * visibly stuttering at around twelve frames a second. Events made in the page skip the
 * work the browser does to deliver a real one, and a press timed to land inside the frame
 * that measures it hides the cost it causes.
 *
 * So this only counts. Whatever moves the app has to come through the front door.
 */
/**
 * The second half of it is what the viewer actually feels, and it was missing.
 *
 * Frame times say how evenly the interface draws. They do not say whether it answered the
 * remote, and on a television that is the whole question: a viewer holding the down key is
 * watching one thing, which is whether the highlight is keeping up with their thumb. An
 * interface can hold a tidy 40ms frame while running four presses behind, and that is a worse
 * experience than an honest stutter that stays level with the finger.
 *
 * So every press is timed to the frame the highlight moves in. Both timestamps are taken in
 * here, on one clock, which is the reason this is measured in the page rather than over the
 * debugging protocol: the harness's timestamps are on the other side of a socket, and aligning
 * two clocks to measure a 60ms answer is how you end up measuring the socket.
 *
 * The count of moves against the count of presses is the other half of the value, and it is
 * the strongest assertion in the harness. Forty presses that produce forty moves walked forty
 * rows. Forty that produce three did not, whatever the frame times looked like, and no
 * arithmetic over wrapped indices is needed to know it.
 */
window.__bench = {
  frames: [],
  running: false,
  frameId: 0,
  onKey: null,

  posterPosition(cursor) {
    const cell = cursor?.closest('[role="gridcell"]');
    const row = cell?.parentElement;
    const grid = row?.parentElement;
    const rowIndex = Number(row?.getAttribute("aria-rowindex"));
    const columnIndex = Number(cell?.getAttribute("aria-colindex"));
    const columns = Number(grid?.getAttribute("aria-colcount"));
    if (
      !Number.isInteger(rowIndex) ||
      rowIndex < 1 ||
      !Number.isInteger(columnIndex) ||
      columnIndex < 1 ||
      !Number.isInteger(columns) ||
      columnIndex > columns
    )
      return null;
    return (rowIndex - 1) * columns + columnIndex;
  },

  /**
   * When the last key arrived, whether or not a phase was running.
   *
   * Renderer input can queue for seconds before JavaScript receives it. Presses
   * dispatched to reach the channel list turned up
   * during `resting`, which presses nothing at all, and the phase reported nine presses and eight
   * moves. Every number in that run was measuring a journey the label had already finished
   * describing.
   *
   * Recorded here rather than in start(), so the harness can ask whether the queue has drained
   * before it begins timing anything. This listener is never removed: it is one assignment per
   * key press for the life of the page.
   */
  lastKeyAt: 0,
  delivered: 0,
  /** Milliseconds since the last key, or a large number when none has ever arrived. */
  quietFor() {
    return this.lastKeyAt ? performance.now() - this.lastKeyAt : 1e9;
  },

  /** When the phase began, so stop() can ask whether the frames account for it. */
  began: 0,

  /** Press to move, in milliseconds, one entry per press that moved something. */
  lags: [],
  presses: 0,
  moves: 0,
  /**
   * Whether there was a highlight to answer with at all.
   *
   * Without this, a phase spent at the picture with the panel shut reported "0 of 10 presses
   * moved anything", which reads as ten dropped keys and is really ten channel changes with no
   * list on screen to move. A phase with nowhere to put a cursor has to say nothing rather than
   * say zero.
   */
  hadCursor: false,

  start({ capture = false } = {}) {
    if (this.running) this.stop();
    this.frames.length = 0;
    this.lags.length = 0;
    this.presses = 0;
    this.moves = 0;
    this.answered = 0;
    this.distance = 0;
    this.steps = [];
    this.verticalDirection = 0;
    this.hadCursor = false;
    this.inputClockErrors = 0;
    this.wasHidden = document.hidden === true;
    this.onVisibility = () => {
      if (document.hidden) this.wasHidden = true;
    };
    document.addEventListener("visibilitychange", this.onVisibility);
    this.samples = capture ? { frames: [], inputs: [], responses: [], moves: [] } : null;
    this.running = true;
    this.began = performance.now();
    this.readyMs = null;
    this.lastFrameAt = this.began;

    // Read public DOM positions without adding instrumentation to the shipped application.
    const cursor = () => {
      const choices = [
        ["vod-rail", ".vod-host:not(.hidden) .vod-rail.focused .vod-category.cursor"],
        ["vod-grid", ".vod-host:not(.hidden) .poster-grid-region.focused .poster-card.cursor"],
        ["live", ".panel:not(.away) .pane.focused .row.cursor"],
      ];
      for (const [owner, selector] of choices) {
        const row = Array.from(document.querySelectorAll(selector)).find(
          (element) => !element.closest(".hidden, .away, [hidden]"),
        );
        if (!row) continue;
        const measuredPosition =
          owner === "vod-grid"
            ? this.posterPosition(row)
            : Number.parseFloat(row.style.top) / Number.parseFloat(row.style.height);
        const position = Number.isFinite(measuredPosition) ? measuredPosition : null;
        const pane = row.closest(".pane");
        const count =
          owner === "live" && pane?.classList.contains("rail")
            ? Number(
                pane.querySelector(".pane-head > .count")?.textContent.replace(/\D/g, "") ?? 0,
              )
            : 0;
        return {
          owner: `${owner}:${pane?.classList.contains("rail") ? "rail" : "list"}`,
          position,
          count,
          key: `${owner}:${pane?.className}:${
            position ?? row.querySelector(".vod-category-name")?.textContent ?? row.textContent
          }`,
        };
      }
      return null;
    };

    // Preserve every pending key so coalescing does not hide the oldest input delay.
    const pending = [];
    let presenting = [];
    const onKey = (event) => {
      if (event.keyCode < 37 || event.keyCode > 40) return;
      this.presses += 1;
      if (event.keyCode === 38) this.verticalDirection = -1;
      if (event.keyCode === 40) this.verticalDirection = 1;
      const now = performance.now();
      const timestamp = event.timeStamp;
      const valid = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now;
      if (!valid) this.inputClockErrors += 1;
      pending.push(valid ? timestamp : now);
      this.samples?.inputs.push({ at: now, timestamp, code: event.keyCode, valid });
    };
    this.onKey = onKey;
    window.addEventListener("keydown", onKey, true);
    let at = cursor();
    this.hadCursor = at !== null;
    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      this.frames.push(now - this.lastFrameAt);
      this.samples?.frames.push({ at: now, interval: now - this.lastFrameAt });
      this.lastFrameAt = now;
      for (const timestamp of presenting) {
        this.lags.push(now - timestamp);
        this.samples?.responses.push({ at: now, timestamp, lag: now - timestamp });
      }
      this.answered += presenting.length;
      presenting = [];

      const here = cursor();
      if (here !== null) this.hadCursor = true;
      if (here?.key !== at?.key) {
        if (here) {
          this.moves += 1;
          this.samples?.moves.push({ at: now, from: at, to: here, pending: pending.length });
          if (at?.owner === here.owner && at.position !== null && here.position !== null) {
            const change = here.position - at.position;
            this.distance +=
              here.count > 0 && here.count === at.count && this.verticalDirection
                ? (((change * this.verticalDirection) % here.count) + here.count) % here.count
                : Math.abs(change);
            if (this.steps.length < 100) {
              this.steps.push({
                from: at.position,
                to: here.position,
                presses: this.presses,
                at: Math.round(now - this.began),
              });
            }
          }
          presenting = pending.splice(0);
        }
        at = here;
      }

      this.frameId = requestAnimationFrame(tick);
    };
    this.frameId = requestAnimationFrame(tick);
  },

  // Called only after the driver's committed DOM barrier. Socket and polling overhead
  // remain included, using the same browser clock as start() rather than the Node clock.
  markReady() {
    if (this.running && this.readyMs === null) {
      this.readyMs = performance.now() - this.began;
    }
    return this.readyMs;
  },

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener("keydown", this.onKey, true);
    document.removeEventListener("visibilitychange", this.onVisibility);
    const now = performance.now();
    const elapsed = now - this.began;
    // No frames at all means the browser never animated: an occluded or minimised window
    // stops requestAnimationFrame entirely, and silently reporting zeros for that would be
    // a benchmark that passes because nothing was measured.
    const frames = [...this.frames];
    // Include a stall at the end instead of dropping it when stop wins the next frame.
    const tail = now - this.lastFrameAt;
    if (tail > 1000 / 60) frames.push(tail);
    if (!frames.length) return { median: 0, p95: 0, worst: 0, stalls: 0, of: 0 };
    // A visible main thread stall is poor performance, not evidence of an occluded window.
    const covered = frames.reduce((sum, f) => sum + f, 0);
    const hidden = this.wasHidden || document.hidden === true;
    const quantile = (values, q) => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
    };
    return {
      median: quantile(frames, 0.5),
      p95: quantile(frames, 0.95),
      worst: Math.max(...frames),
      // A frame past 100ms is the threshold the design guidance treats as needing to tell
      // the viewer something is happening, so it is the one worth counting as a stall.
      stalls: frames.filter((f) => f > 100).length,
      of: this.frames.length,
      hidden,
      elapsed,
      covered,
      began: this.began,
      readyMs: this.readyMs,
      ended: now,
      tail,
      samples: this.samples,
      fps: elapsed > 0 ? Math.min(60, (this.frames.length * 1000) / elapsed) : 0,
      stallTimePercent:
        elapsed > 0
          ? (frames.filter((frame) => frame > 100).reduce((sum, frame) => sum + frame, 0) *
              100) /
            elapsed
          : 0,
      // Null rather than zero where nothing moved, since a phase with the panel shut has no
      // highlight to answer with and "0ms" would read as instant.
      lag: this.lags.length ? quantile(this.lags, 0.5) : null,
      inputP95: this.lags.length ? quantile(this.lags, 0.95) : null,
      worstLag: this.lags.length ? Math.max(...this.lags) : null,
      inputClockErrors: this.inputClockErrors,
      // The raw slow press count remains diagnostic. The UX gate checks p95 and maximum.
      slow: this.lags.filter((l) => l > 100).length,
      presses: this.presses,
      moves: this.moves,
      answered: this.answered,
      distance: this.distance,
      steps: this.steps,
      hadCursor: this.hadCursor,
    };
  },

  state() {
    return {
      nodes: document.querySelectorAll("*").length,
      rows: document.querySelectorAll(".row").length,
      heapMB: performance.memory
        ? Math.round(performance.memory.usedJSHeapSize / 1048576)
        : null,
      // V8 reports all heap spaces. The old space stress cap is a separate project setting.
      heapLimitMB: performance.memory
        ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
        : null,
    };
  },
};
// The permanent one, which outlives each phase and is what quietFor reads.
window.addEventListener(
  "keydown",
  (event) => {
    if (event.keyCode === 189) return;
    window.__bench.lastKeyAt = performance.now();
    window.__bench.delivered += 1;
  },
  true,
);
("installed");
