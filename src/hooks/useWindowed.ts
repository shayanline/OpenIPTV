import { useCallback, useRef, useState } from "react";
import { activatePointerInput, pointerInputActive } from "./usePointerAwake";

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
export const RAIL_ROW_BASE = 84;
export const POSTER_COLUMNS = 6;
export const POSTER_OVERSCAN_ROWS = 1;
export const POSTER_CARD_ROW_BASE = 376;

export const posterColumnsForViewport = (width: number): number => {
  if (width >= 1800) return POSTER_COLUMNS;
  if (width >= 1600) return 5;
  if (width >= 1440) return 4;
  return 3;
};

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
  overscan = OVERSCAN,
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

  const start = Math.max(0, first - overscan);
  const end = Math.min(count, first + visible + overscan);

  return {
    start,
    end,
    offset: first * row,
    visible,
    first,
    row,
    slots: visible + overscan * 2,
  };
}

export interface PosterWindow extends Window {
  itemStart: number;
  itemEnd: number;
}

export function posterWindowOf(
  count: number,
  cursor: number,
  viewportHeight: number,
  scale: number,
  previousFirst = 0,
  columns = POSTER_COLUMNS,
): PosterWindow {
  const rows = Math.ceil(count / columns);
  const clamped = Math.max(0, Math.min(cursor, Math.max(0, count - 1)));
  const window = windowOf(
    rows,
    Math.floor(clamped / columns),
    viewportHeight,
    scale,
    previousFirst,
    POSTER_CARD_ROW_BASE,
    POSTER_OVERSCAN_ROWS,
  );
  return {
    ...window,
    itemStart: window.start * columns,
    itemEnd: Math.min(count, window.end * columns),
  };
}

export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pageSize: number,
): number {
  if (deltaMode === 1) return delta * 40;
  if (deltaMode === 2) return delta * pageSize;
  return delta;
}

export function wheelStep(
  cursor: number,
  count: number,
  deltaY: number,
  now: number,
  lastAcceptedAt: number,
): { cursor: number; lastAcceptedAt: number; accepted: boolean } {
  if (!deltaY || !count || now - lastAcceptedAt < 120) {
    return { cursor, lastAcceptedAt, accepted: false };
  }
  const next = Math.max(0, Math.min(count - 1, cursor + (deltaY > 0 ? 1 : -1)));
  return { cursor: next, lastAcceptedAt: now, accepted: next !== cursor };
}

export function useWindowed(
  count: number,
  cursor: number,
  viewportHeight: number,
  scale: number,
  rowBase?: number,
  followCursor = false,
  initialFirst = 0,
  overscan = OVERSCAN,
): Window {
  // Where the list sits is carried between renders rather than recomputed, because that
  // is the whole difference between the list holding still and the list chasing the
  // cursor. A ref rather than state: it is derived during render and never on its own
  // causes one.
  const first = useRef(initialFirst);
  const initial = useRef(initialFirst);
  if (initial.current !== initialFirst) {
    initial.current = initialFirst;
    first.current = initialFirst;
  }
  const previousFirst = followCursor ? cursor : first.current;
  // An unmeasured viewport must not move a saved window to the selected row.
  const win = windowOf(
    count,
    viewportHeight > 0 ? cursor : previousFirst,
    viewportHeight,
    scale,
    previousFirst,
    rowBase,
    overscan,
  );
  if (viewportHeight > 0) first.current = win.first;
  return win;
}

export interface NavigableWindow extends Window {
  pointerMode: boolean;
  scrollOffset: number;
  indicatorFirst: number;
  onWheel: (deltaY: number, deltaMode?: number) => boolean;
}

export function useNavigableWindow(
  count: number,
  cursor: number,
  viewportHeight: number,
  scale: number,
  rowBase = ROW_BASE,
  overscan = OVERSCAN,
  initialFirst = 0,
  windowKey?: string,
  initialScrollOffset?: number,
): NavigableWindow {
  const remoteWindow = useWindowed(
    count,
    cursor,
    viewportHeight,
    scale,
    rowBase,
    false,
    initialFirst,
    overscan,
  );
  const pointerOffset = useRef(initialScrollOffset ?? remoteWindow.offset);
  const storedFirst = useRef(initialFirst);
  const storedWindowKey = useRef(windowKey);
  const storedScrollOffset = useRef(initialScrollOffset);
  const lastPointerFirst = useRef(initialFirst);
  const [, redraw] = useState(0);
  const pointerMode = pointerInputActive();
  const row = rowBase * scale;
  const maxOffset = Math.max(0, count * row - viewportHeight);
  if (storedWindowKey.current !== windowKey) {
    storedWindowKey.current = windowKey;
    pointerOffset.current = initialScrollOffset ?? Math.max(0, initialFirst) * row;
    storedFirst.current = initialFirst;
  }
  if (storedFirst.current !== initialFirst) {
    storedFirst.current = initialFirst;
    if (pointerMode && lastPointerFirst.current !== initialFirst) {
      pointerOffset.current = remoteWindow.offset;
    }
  }
  if (storedScrollOffset.current !== initialScrollOffset) {
    storedScrollOffset.current = initialScrollOffset;
    if (pointerMode && initialScrollOffset !== undefined) {
      pointerOffset.current = initialScrollOffset;
    }
  }
  if (!pointerMode) pointerOffset.current = remoteWindow.offset;
  else pointerOffset.current = Math.max(0, Math.min(pointerOffset.current, maxOffset));
  const pointerFirst = Math.floor(pointerOffset.current / Math.max(1, row));
  const pointerWindow = windowOf(
    count,
    pointerFirst,
    viewportHeight,
    scale,
    pointerFirst,
    rowBase,
    overscan,
  );
  lastPointerFirst.current = pointerWindow.first;
  const onWheel = useCallback(
    (deltaY: number, deltaMode = 0) => {
      if (!deltaY) return false;
      activatePointerInput();
      const pixels = normalizeWheelDelta(deltaY, deltaMode, viewportHeight);
      const next = Math.max(0, Math.min(pointerOffset.current + pixels, maxOffset));
      if (next === pointerOffset.current) return true;
      pointerOffset.current = next;
      redraw((revision) => revision + 1);
      return true;
    },
    [maxOffset, viewportHeight],
  );
  if (!pointerMode) {
    return {
      ...remoteWindow,
      pointerMode: false,
      scrollOffset: remoteWindow.offset,
      indicatorFirst: remoteWindow.first,
      onWheel,
    };
  }
  return {
    ...pointerWindow,
    end: Math.min(count, Math.ceil((pointerOffset.current + viewportHeight) / row) + overscan),
    slots: Math.max(pointerWindow.slots, Math.ceil(viewportHeight / row) + overscan * 2 + 1),
    pointerMode: true,
    scrollOffset: pointerOffset.current,
    indicatorFirst:
      maxOffset > 0
        ? (pointerOffset.current / maxOffset) * Math.max(0, count - pointerWindow.visible)
        : 0,
    onWheel,
  };
}
