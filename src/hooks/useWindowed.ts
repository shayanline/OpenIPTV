import { useRef } from "react";

/**
 * Windowing for a long list: keep a handful of rows in the DOM instead of all of them.
 *
 * Samsung's memory guidance is blunt about this. Every node carries a node object, a
 * computed style and layout information whether or not it is on screen, and any list past
 * roughly a hundred items should be windowed. A playlist of two hundred channels was
 * building two hundred rows and two hundred logos, and then rebuilding the lot on every
 * press of the down key. That is the stutter.
 *
 * There is no scroll container and no scroll event. The offset is derived from the cursor,
 * which makes movement exact and costs nothing: a scroll listener would fire far more
 * often than the viewer actually moves, and on a TV the only thing that moves a list is a
 * key press we already know about.
 *
 * The rule it implements is Samsung's "moving focus": the list holds still and the
 * highlight travels, and the list only moves once the highlight would otherwise leave the
 * view. That is also the cheaper of the two patterns they describe, since most presses
 * repaint two rows rather than scrolling the whole column.
 */

/**
 * The height of a channel row before the viewer's text size is applied.
 *
 * This is the one place the number lives. The stylesheet used to carry its own copy and the
 * two were kept level by a comment asking that they be, which is not a mechanism: the
 * arithmetic that decides which rows exist and the rule that decides how tall they are drawn
 * could disagree, and nothing would have said so. services/metrics publishes these to CSS.
 */
export const ROW_BASE = 76;

/**
 * The category rail's taller row.
 *
 * Only the rail. A group title may be written in two scripts at once and has to wrap to two
 * lines, because truncating a bidirectional string cuts it in the middle of a word, but a
 * channel name fits on one line and making every row in the app tall enough for two would
 * cost three channels off the bottom of the list to solve a problem the list does not have.
 */
export const RAIL_ROW_BASE = 96;

/** Rows kept either side of the view, so a press never waits on a row being created. */
const OVERSCAN = 3;

export interface Window {
  /** First row to render. */
  start: number;
  /** One past the last row to render. */
  end: number;
  /** Pixels to shift the block up by, so the first visible row sits at the top. */
  offset: number;
  /** How many rows fit in the view. */
  visible: number;
  /** Index of the topmost row on screen. */
  first: number;
  /** Height of one row, so callers never restate it. */
  row: number;
  /** How many row elements exist at most, so they can be recycled rather than rebuilt. */
  slots: number;
}

/**
 * The window, as a plain function of where the cursor is and where the list already sat.
 *
 * That second input is what makes it moving focus rather than fixed focus, and it cannot
 * be derived from the cursor alone: whether the list should move depends on where it
 * currently is. Given only the cursor, the honest answers are "always move" or "never
 * move", and the first of those is what this did before, sliding the list under a
 * highlight pinned to the top row on every single press.
 *
 * Separate from the hook so it can be tested without a renderer, which is where most of
 * the mistakes in this sort of arithmetic live.
 */
export function windowOf(
  count: number,
  cursor: number,
  viewportHeight: number,
  scale: number,
  previousFirst = 0,
  rowBase = ROW_BASE,
): Window {
  const row = rowBase * scale;
  const visible = Math.max(1, Math.floor(viewportHeight / row));
  const maxFirst = Math.max(0, count - visible);

  // Move by the smallest amount that brings the cursor back into view, and otherwise not
  // at all. Off the top, the cursor becomes the top row; off the bottom, the bottom one.
  let first = previousFirst;
  if (cursor < first) first = cursor;
  else if (cursor > first + visible - 1) first = cursor - visible + 1;
  first = Math.max(0, Math.min(first, maxFirst));

  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(count, first + visible + OVERSCAN);

  return { start, end, offset: first * row, visible, first, row,
           slots: visible + OVERSCAN * 2 };
}

export function useWindowed(
  count: number,
  cursor: number,
  viewportHeight: number,
  scale: number,
  rowBase?: number,
): Window {
  // Where the list sits is carried between renders rather than recomputed, because that
  // is the whole difference between the list holding still and the list chasing the
  // cursor. A ref rather than state: it is derived during render and never on its own
  // causes one.
  const first = useRef(0);
  const win = windowOf(count, cursor, viewportHeight, scale, first.current, rowBase);
  first.current = win.first;
  return win;
}
