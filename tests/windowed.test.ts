import { act, renderHook } from "@testing-library/react";
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  normalizeWheelDelta,
  POSTER_COLUMNS,
  posterColumnsForViewport,
  posterWindowOf,
  RAIL_ROW_BASE,
  useNavigableWindow,
  wheelStep,
  windowOf,
} from "../src/hooks/useWindowed";
import { usePointerAwake } from "../src/hooks/usePointerAwake";

/**
 * The windowing arithmetic, which decides which rows exist at all. Getting it wrong shows
 * up as a list that drifts, or blank space at the end, so it is worth pinning exactly.
 *
 * A row is 76px, and the viewport in these cases is 912px, which is twelve rows.
 */
const VIEW = 912;
const ROW = 76;

test.each(["remote", "pointer"])(
  "an unmeasured %s rail retains its saved window until measurement",
  (inputMode) => {
    document.documentElement.dataset.inputMode = inputMode;
    const restored = renderHook(
      ({ height }) => useNavigableWindow(100, 35, height, 1, RAIL_ROW_BASE, 2, 30),
      { initialProps: { height: 0 } },
    );
    try {
      assert.equal(restored.result.current.first, 30);
      assert.equal(restored.result.current.scrollOffset, 30 * RAIL_ROW_BASE);
      restored.rerender({ height: 840 });
      assert.equal(restored.result.current.first, 30);
      assert.equal(restored.result.current.scrollOffset, 30 * RAIL_ROW_BASE);
    } finally {
      restored.unmount();
      delete document.documentElement.dataset.inputMode;
    }
  },
);

test("fractional poster scrolling renders the full viewport and keeps unique row slots", () => {
  document.documentElement.dataset.inputMode = "remote";
  const { result, unmount } = renderHook(() => useNavigableWindow(10, 0, 500, 1, 376, 1));
  try {
    act(() => result.current.onWheel(300));
    assert.equal(result.current.pointerMode, true);
    assert.equal(result.current.scrollOffset, 300);
    assert.equal(result.current.end, 4);
    assert.ok(result.current.slots >= result.current.end - result.current.start);
  } finally {
    unmount();
    delete document.documentElement.dataset.inputMode;
  }
});
const win = (count: number, cursor: number, previousFirst = 0) =>
  windowOf(count, cursor, VIEW, 1, previousFirst);

/** Walk the cursor through a series of positions, carrying the list position along. */
const walk = (count: number, cursors: number[]) => {
  let first = 0;
  return cursors.map((c) => {
    const w = windowOf(count, c, VIEW, 1, first);
    first = w.first;
    return w;
  });
};

test("a list shorter than the view renders whole and never moves", () => {
  const w = win(5, 4);
  assert.equal(w.start, 0);
  assert.equal(w.end, 5);
  assert.equal(w.offset, 0);
});

test("only a window of a long list is rendered", () => {
  const w = win(200, 0);
  assert.equal(w.visible, 12);
  assert.equal(w.start, 0);
  // Twelve on screen plus the overscan below, and nothing like two hundred.
  assert.equal(w.end, 15);
});

test("the list holds still while the cursor is inside it", () => {
  // Samsung's moving focus: the highlight travels, the list does not. Getting this wrong
  // pins the highlight to the top row and slides the list under it on every press.
  const steps = walk(200, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const [i, w] of steps.entries()) {
    assert.equal(w.offset, 0, `cursor ${i} should not have moved the list`);
  }
});

test("pointer windows follow a new stored row without replaying their own scroll update", () => {
  document.documentElement.dataset.inputMode = "remote";
  const { result, rerender, unmount } = renderHook(
    ({ first, cursor }) => useNavigableWindow(10, cursor, 752, 1, 376, 1, first),
    { initialProps: { first: 0, cursor: 0 } },
  );
  try {
    act(() => result.current.onWheel(752));
    assert.equal(result.current.scrollOffset, 752);
    rerender({ first: 2, cursor: 0 });
    assert.equal(result.current.scrollOffset, 752);
    rerender({ first: 5, cursor: 5 });
    assert.equal(result.current.scrollOffset, 1880);
    assert.equal(result.current.first, 5);
  } finally {
    unmount();
    delete document.documentElement.dataset.inputMode;
  }
});

test("pointer offsets retain partial rows through their own updates and external restoration", () => {
  document.documentElement.dataset.inputMode = "pointer";
  const initialOffset = 30 * RAIL_ROW_BASE + 37;
  const { result, rerender, unmount } = renderHook(
    ({ offset }) => useNavigableWindow(100, 5, 840, 1, RAIL_ROW_BASE, 2, 30, undefined, offset),
    { initialProps: { offset: initialOffset } },
  );
  try {
    assert.equal(result.current.first, 30);
    assert.equal(result.current.scrollOffset, initialOffset);
    act(() => result.current.onWheel(19.5));
    assert.equal(result.current.scrollOffset, initialOffset + 19.5);
    rerender({ offset: initialOffset + 19.5 });
    assert.equal(result.current.scrollOffset, initialOffset + 19.5);
    rerender({ offset: initialOffset + 1.25 });
    assert.equal(result.current.scrollOffset, initialOffset + 1.25);
  } finally {
    unmount();
    delete document.documentElement.dataset.inputMode;
  }
});

test("the list moves by one row once the cursor would leave the bottom", () => {
  const [, twelve, thirteen] = walk(200, [11, 12, 13]);
  assert.equal(twelve.first, 1);
  assert.equal(twelve.offset, ROW);
  assert.equal(thirteen.first, 2);
});

test("coming back up, the list holds still until the cursor leaves the top", () => {
  const [down, ...up] = walk(200, [20, 19, 15, 10, 9, 8]);
  assert.equal(down.first, 9);
  for (const w of up.slice(0, 4)) assert.equal(w.first, 9, "still while the cursor is inside");
  assert.equal(up[4].first, 8, "one row, once the cursor passes the top");
});

test("the end of the list does not scroll past into empty space", () => {
  const w = win(200, 199);
  assert.equal(w.first, 188); // 200 - 12
  assert.equal(w.end, 200);
  assert.equal(w.offset, 188 * ROW);
});

test("jumping far down brings the cursor to the bottom of the view", () => {
  const w = win(200, 100);
  assert.equal(w.first, 89);
  assert.ok(100 >= w.first && 100 < w.first + w.visible);
});

test("jumping far up brings the cursor to the top of the view", () => {
  const w = win(200, 20, 150);
  assert.equal(w.first, 20);
});

test("rows either side of the view are kept, so a press never waits on one being built", () => {
  const w = win(200, 50);
  assert.ok(w.start < w.first, "some rows above the fold");
  assert.ok(w.end > w.first + w.visible, "some rows below the fold");
  assert.ok(w.end - w.start <= 20, "but not many");
});

test("the window always contains the cursor, wherever the list happens to sit", () => {
  for (const count of [1, 13, 47, 200]) {
    for (let previous = 0; previous < count; previous += 7) {
      for (let cursor = 0; cursor < count; cursor++) {
        const w = win(count, cursor, previous);
        assert.ok(
          cursor >= w.start && cursor < w.end,
          `cursor ${cursor} of ${count} from ${previous} fell outside ${w.start}..${w.end}`,
        );
        assert.ok(
          cursor >= w.first && cursor < w.first + w.visible,
          `cursor ${cursor} of ${count} from ${previous} was off screen`,
        );
      }
    }
  }
});

test("a list that shrinks under the cursor does not leave the view stranded past the end", () => {
  // Switching to a shorter category while scrolled a long way down.
  const w = win(8, 0, 150);
  assert.equal(w.first, 0);
  assert.equal(w.end, 8);
});

test("a larger text size means taller rows and fewer of them on screen", () => {
  const big = windowOf(200, 0, VIEW, 1.3);
  assert.equal(big.row, ROW * 1.3);
  assert.ok(big.visible < win(200, 0).visible);
});

test("an empty list does not divide by zero or render anything", () => {
  const w = win(0, 0);
  assert.equal(w.start, 0);
  assert.equal(w.end, 0);
  // start and end being equal is the whole of "renders nothing". A row count still comes
  // back, because that is how many rows would fit, not how many there are to put in them.
  assert.ok(w.visible > 0);
});

test("a viewport too short for even one row still claims one", () => {
  // Before the panel has been measured the height is zero, and a visible count of zero
  // would render nothing at all and never recover.
  assert.equal(windowOf(200, 0, 0, 1).visible, 1);
});

test("the rail's taller rows fit fewer of them in the same space", () => {
  // The rail wraps a bilingual group title onto two lines, so its rows are 96px against the
  // channel list's 76px, and the two panes are windowed with different arithmetic.
  const rail = windowOf(40, 0, VIEW, 1, 0, RAIL_ROW_BASE);
  const list = windowOf(40, 0, VIEW, 1, 0);
  assert.equal(rail.row, RAIL_ROW_BASE);
  assert.equal(list.row, ROW);
  assert.ok(rail.visible < list.visible);
  assert.equal(rail.visible, Math.floor(VIEW / RAIL_ROW_BASE));
});

test("poster windows always contain complete six item rows", () => {
  for (const count of [0, 1, 5, 6, 7, 53]) {
    const window = posterWindowOf(count, Math.max(0, count - 1), 752, 1);
    assert.equal(window.itemStart % POSTER_COLUMNS, 0);
    assert.ok(window.itemEnd === count || window.itemEnd % POSTER_COLUMNS === 0);
    if (count) assert.ok(count - 1 >= window.itemStart && count - 1 < window.itemEnd);
  }
});

test("desktop poster columns keep CSS and windowing on one shared value", () => {
  assert.equal(posterColumnsForViewport(1280), 3);
  assert.equal(posterColumnsForViewport(1920), 6);
  const window = posterWindowOf(30, 8, 752, 1, 0, posterColumnsForViewport(1280));
  assert.equal(window.itemStart % 3, 0);
  assert.ok(window.itemEnd === 30 || window.itemEnd % 3 === 0);
});

test("poster windows clamp a cursor after a result set shrinks", () => {
  const window = posterWindowOf(7, 80, 376, 1, 10);
  assert.equal(window.itemStart, 0);
  assert.equal(window.itemEnd, 7);
});

test("larger text changes poster row height without changing columns", () => {
  const regular = posterWindowOf(100, 0, 752, 1);
  const large = posterWindowOf(100, 0, 752, 1.3);
  assert.equal(regular.itemEnd % POSTER_COLUMNS, 0);
  assert.equal(large.itemEnd % POSTER_COLUMNS, 0);
  assert.ok(large.visible < regular.visible);
});

test("input mode changes only for physical pointer and remote input", () => {
  const { unmount } = renderHook(() => usePointerAwake());
  assert.equal(document.documentElement.dataset.inputMode, "remote");

  act(() => window.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
  assert.equal(document.documentElement.dataset.inputMode, "remote");

  const button = document.body.appendChild(document.createElement("button"));
  act(() => button.dispatchEvent(new MouseEvent("pointermove", { bubbles: true })));
  assert.equal(document.documentElement.dataset.inputMode, "pointer");
  assert.notEqual(document.activeElement, button);

  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", keyCode: 65 })));
  assert.equal(document.documentElement.dataset.inputMode, "pointer");

  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40 })),
  );
  assert.equal(document.documentElement.dataset.inputMode, "remote");

  act(() => window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  assert.equal(document.documentElement.dataset.inputMode, "pointer");
  unmount();
});

test("wheel deltas preserve pixels and normalize line and page modes", () => {
  assert.equal(normalizeWheelDelta(24, 0, 720), 24);
  assert.equal(normalizeWheelDelta(3, 1, 720), 120);
  assert.equal(normalizeWheelDelta(-1, 2, 720), -720);
});

test("wheel movement advances one linear item across row boundaries", () => {
  const first = wheelStep(5, 20, 1, 0, Number.NEGATIVE_INFINITY);
  const guarded = wheelStep(first.cursor, 20, 1, 119, first.lastAcceptedAt);
  const second = wheelStep(first.cursor, 20, 1, 120, first.lastAcceptedAt);
  assert.deepEqual(first, { cursor: 6, lastAcceptedAt: 0, accepted: true });
  assert.equal(guarded.accepted, false);
  assert.deepEqual(second, { cursor: 7, lastAcceptedAt: 120, accepted: true });
});
