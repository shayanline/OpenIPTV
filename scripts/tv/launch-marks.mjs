/**
 * What a viewer waits for between pressing the button and watching television, in five marks.
 *
 * Here rather than in sim.mjs because two harnesses need the same definitions: the simulator,
 * which measures them against the floor profile and holds a budget over them, and on-set.mjs,
 * which measures them on a real television where the budget does not apply. A mark defined
 * twice is a mark that drifts, and then the two harnesses disagree about what "the rows
 * arrived" means while both print a number.
 *
 * Five rather than one, because "it took five seconds" does not say what to fix and these do.
 * First paint is the engine getting anything at all onto the screen. The interface is React
 * having rendered. The rows are the playlist having been read off storage and parsed. The name
 * is the resumed channel being announced.
 */

/**
 * Label to the expression that answers it, in the page.
 *
 * A test answers with a number to be timed at that number, and with anything else truthy to be
 * timed now. Everything asked of the document is a "now": the row either exists this frame or
 * it does not. Anything the browser timed itself has to be read from the browser, or the mark
 * reports when the watching loop looked rather than when the thing happened.
 */
export const LAUNCH_MARKS = {
  /*
   * The engine having fetched, compiled and run the bundle, before the app has done anything.
   *
   * Here to make the rest attributable. Without it, a first paint that moves from 700ms to
   * 2400ms could be the bundle getting bigger, the engine being busy, or the application doing
   * something before it draws, and those have nothing in common except the symptom. With a
   * module script, DOMContentLoaded is the point the module finished executing, so this is the
   * engine's share and everything after it is ours.
   */
  "the bundle ran":
    "(performance.getEntriesByType('navigation')[0] || {}).domContentLoadedEventEnd",
  /*
   * The browser's own answer rather than ours, since it is the only one that knows when it
   * actually put ink on the screen.
   *
   * It returns the entry's own timestamp, which is the whole reason a test may return a number
   * at all. Timed like the others, by noting when the loop first saw it, first paint came out
   * *after* the interface it must precede: the entry only appears in the timeline once the
   * frame has been presented, and the loop then needs a frame of its own to look, so a 600ms
   * paint was reported as 1100ms. Two marks in the wrong order is the kind of result that gets
   * a measurement disbelieved as a whole, quite rightly.
   */
  "first paint":
    "(performance.getEntriesByType('paint')"
    + ".filter(function (e) { return e.name === 'first-contentful-paint'; })[0] || {})"
    + ".startTime",
  "the interface": "!!document.querySelector('#root *')",
  // `.window .row` is a real channel, not the eight skeletons: those are drawn straight into
  // the viewport, so a mark on `.row` alone would report the placeholder as the list and hide
  // the whole of the wait it is standing in for.
  "the channel rows": "!!document.querySelector('.window .row')",
  "the channel named": "!!(document.querySelector('.pb-title') || {}).textContent",
};

/**
 * Long enough that a slow launch is reported as slow rather than as absent.
 *
 * A mark that never arrives is a failure, so this only decides how long to wait before calling
 * it one. Thirty seconds against a measured two is deliberately far out: the interesting
 * failure is a mark that cannot happen at all, and giving a merely slow launch room to finish
 * is what keeps those two apart.
 */
export const LAUNCH_DEADLINE_MS = 30000;

/**
 * The watcher, to be installed on the new document before it navigates.
 *
 * Before the navigation rather than after it, which is the whole reason this is a script on the
 * new document and not a poll from the harness: by the time a command could arrive, first paint
 * has already happened and the answer would be however long the round trip took.
 *
 * Written in ES5 because it is inlined into a page that may be pretending to be Chromium 69,
 * and on a television it really is an old engine. No try/catch either: a selector that has been
 * renamed out of the app should stop the loop dead and report "never", not quietly retry until
 * the deadline and read as a slow launch.
 */
export function launchWatcher() {
  return `(function () {
    var tests = [${Object.entries(LAUNCH_MARKS)
      .map(([label, find]) => `[${JSON.stringify(label)}, function () { return ${find}; }]`)
      .join(",\n      ")}];
    var marks = {};
    window.__launch = { marks: marks, done: false };
    function tick() {
      for (var i = tests.length - 1; i >= 0; i--) {
        var answer = tests[i][1]();
        if (answer) {
          marks[tests[i][0]] = Math.round(
            typeof answer === "number" ? answer : performance.now(),
          );
          tests.splice(i, 1);
        }
      }
      if (tests.length) requestAnimationFrame(tick);
      else window.__launch.done = true;
    }
    requestAnimationFrame(tick);
  })();`;
}
