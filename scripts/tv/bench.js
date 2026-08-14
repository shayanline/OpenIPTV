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

  /**
   * When the last key arrived, whether or not a phase was running.
   *
   * Because they arrive late. A renderer throttled sixty times over queues input, and on a busy
   * machine it queues it for seconds: presses dispatched to reach the channel list turned up
   * during `resting`, which presses nothing at all, and the phase reported nine presses and eight
   * moves. Every number in that run was measuring a journey the label had already finished
   * describing.
   *
   * Recorded here rather than in start(), so the harness can ask whether the queue has drained
   * before it begins timing anything. This listener is never removed: it is one assignment per
   * key press for the life of the page.
   */
  lastKeyAt: 0,
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

  start() {
    this.frames.length = 0;
    this.lags.length = 0;
    this.presses = 0;
    this.moves = 0;
    this.hadCursor = false;
    this.running = true;
    this.began = performance.now();

    /*
     * Where the highlight is, as one number, read from the row's own inline style.
     *
     * Both panes place their rows by index, so `top` divided by the row height *is* the index,
     * and no component had to be changed to publish it. `.pane.focused` picks whichever column
     * has the highlight, so the rail walk and the channel scroll need no different treatment,
     * and a phase with the panel shut reports nothing rather than something meaningless.
     */
    const cursor = () => {
      const row = document.querySelector(".pane.focused .row.selected");
      return row ? row.style.top : null;
    };

    /*
     * One press, one answer. A press with an answer still outstanding replaces it.
     *
     * Which is deliberate rather than lazy: if a second press arrives before the interface has
     * drawn the first, the first press's answer is no longer a thing the viewer can perceive
     * separately, and what they are waiting for is the newest one. Counting it against the
     * oldest outstanding press instead would report the backlog as latency and grow without
     * bound while a key is held, which flatters nothing but is not what anyone experiences.
     */
    let pending = 0;
    const onKey = () => {
      this.presses += 1;
      pending = performance.now();
    };
    window.addEventListener("keydown", onKey, true);
    // The permanent one, which outlives the phase and is what quietFor reads.
    if (!this.watchingKeys) {
      this.watchingKeys = true;
      window.addEventListener("keydown", () => { this.lastKeyAt = performance.now(); }, true);
    }

    let at = cursor();
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      this.frames.push(now - last);
      last = now;

      const here = cursor();
      if (here !== null) this.hadCursor = true;
      if (here !== at) {
        at = here;
        this.moves += 1;
        if (pending) {
          this.lags.push(now - pending);
          pending = 0;
        }
      }

      if (this.running) requestAnimationFrame(tick);
      else window.removeEventListener("keydown", onKey, true);
    };
    requestAnimationFrame(tick);
  },

  stop() {
    this.running = false;
    const elapsed = performance.now() - this.began;
    // No frames at all means the browser never animated: an occluded or minimised window
    // stops requestAnimationFrame entirely, and silently reporting zeros for that would be
    // a benchmark that passes because nothing was measured.
    const frames = this.frames.slice(1);   // the first gap is the handshake, not a frame
    if (!frames.length) return { median: 0, p95: 0, worst: 0, stalls: 0, of: 0 };
    /*
     * Did the frames account for the time the phase took?
     *
     * The old test for this was `frames.some(f => f > 5000)`, looking for one enormous gap
     * where the browser stopped animating. It cannot fire for most phases: resting runs for
     * about 1.3 seconds and the rail phases for under one, so a gap longer than five seconds is
     * arithmetically impossible. And the case it was meant to catch does not look like a gap at
     * all. A window that goes quiet and never comes back before stop() records no gap: it
     * records the handful of quick frames it managed first, and reports a tiny median with zero
     * stalls. Silence read as excellence.
     *
     * Summing them and comparing against the wall clock catches both shapes, because whatever
     * the browser did not spend on frames it did not report.
     */
    const covered = frames.reduce((sum, f) => sum + f, 0);
    const hidden = elapsed > 0 && covered / elapsed < 0.8;
    const quantile = (values, q) => {
      const sorted = [...values].sort((a, b) => a - b);
      return +sorted[Math.floor(sorted.length * q)].toFixed(1);
    };
    return {
      median: quantile(frames, 0.5),
      p95: quantile(frames, 0.95),
      worst: +Math.max(...frames).toFixed(1),
      // A frame past 100ms is the threshold the design guidance treats as needing to tell
      // the viewer something is happening, so it is the one worth counting as a stall.
      stalls: frames.filter((f) => f > 100).length,
      of: frames.length,
      hidden,
      // Null rather than zero where nothing moved, since a phase with the panel shut has no
      // highlight to answer with and "0ms" would read as instant.
      lag: this.lags.length ? quantile(this.lags, 0.5) : null,
      worstLag: this.lags.length ? +Math.max(...this.lags).toFixed(1) : null,
      /*
       * Presses that waited longer than a tenth of a second, counted rather than maximised.
       *
       * The same reasoning as `stalls`, and it was learned the same way. A budget set against
       * the worst single press failed a quiet run at 178ms having passed six others between 57
       * and 116, because the maximum of eighteen samples is the least stable number available
       * and one scheduling accident owns it. A count over a threshold is stable, and 100ms is
       * the threshold the guidance already uses for telling the viewer something is happening.
       */
      slow: this.lags.filter((l) => l > 100).length,
      presses: this.presses,
      moves: this.moves,
      hadCursor: this.hadCursor,
    };
  },

  state() {
    return {
      nodes: document.querySelectorAll("*").length,
      rows: document.querySelectorAll(".row").length,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      /*
       * What the set would allow, rather than what this laptop allows.
       *
       * Samsung publishes one hard figure for memory, 120MB for an application installed
       * through Tizen Studio, and it covers the whole application rather than the script
       * heap alone. The simulator caps V8's old space to it, so overrunning here is
       * overrunning there, but nothing was ever checking: the run could sit at 95% of the
       * ceiling and report a tidy table of frame times.
       */
      heapLimitMB: performance.memory
        ? Math.round(performance.memory.jsHeapSizeLimit / 1048576)
        : null,
    };
  },
};
"installed"
