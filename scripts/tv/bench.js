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
window.__bench = {
  frames: [],
  running: false,

  start() {
    this.frames.length = 0;
    this.running = true;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      this.frames.push(now - last);
      last = now;
      if (this.running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  stop() {
    this.running = false;
    // No frames at all means the browser never animated: an occluded or minimised window
    // stops requestAnimationFrame entirely, and silently reporting zeros for that would be
    // a benchmark that passes because nothing was measured.
    const frames = this.frames.slice(1);   // the first gap is the handshake, not a frame
    if (!frames.length) return { median: 0, p95: 0, worst: 0, stalls: 0, of: 0 };
    // A gap this long is not the app being slow, it is the browser having stopped animating
    // because the window went behind something. Reporting it as a frame time would be a lie
    // in whichever direction happened to suit.
    const hidden = frames.some((f) => f > 5000);
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (q) => +sorted[Math.floor(sorted.length * q)].toFixed(1);
    return {
      median: at(0.5),
      p95: at(0.95),
      worst: +Math.max(...frames).toFixed(1),
      // A frame past 100ms is the threshold the design guidance treats as needing to tell
      // the viewer something is happening, so it is the one worth counting as a stall.
      stalls: frames.filter((f) => f > 100).length,
      of: frames.length,
      hidden,
    };
  },

  state() {
    return {
      nodes: document.querySelectorAll("*").length,
      rows: document.querySelectorAll(".row").length,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    };
  },
};
"installed"
