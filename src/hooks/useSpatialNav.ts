import { useCallback, useEffect } from "react";
import { KEY } from "./useRemote";

/**
 * Four directional focus movement over arbitrary controls.
 *
 * Samsung's checklist is explicit that every selectable object must be reachable with the
 * four directional buttons (2.2) and that every on screen button must be selectable with
 * them (3.2). A browser gives none of that: arrow keys scroll, they do not move focus, and
 * Tab order is meaningless with a remote in your hand.
 *
 * So focus is chosen geometrically. From the focused element, look for candidates whose
 * centre lies in the pressed direction, and take the nearest, weighting movement along the
 * pressed axis far more heavily than drift across it. That is what makes a row of pills
 * behave like a row and a column of settings behave like a column, without either having
 * to declare its shape.
 *
 * Focus deliberately does not wrap. The guidelines state that focus stops at the first or
 * last item in a list rather than looping round.
 */

/*
 * Every element the directional buttons may land on.
 *
 * tabindex="-1" is excluded from all three arms, not just the last. Written as
 * `button, input, [tabindex]:not([tabindex='-1'])` the exclusion only covered things that
 * were reachable *because* of a tabindex, so a button opting out with tabindex="-1" was
 * matched by the first arm anyway and stayed reachable. The pointer pad's seven buttons all
 * opt out that way, and only stay out of reach because the pad happens to sit outside every
 * area this hook is pointed at.
 */
const FOCUSABLE = [
  "button:not([hidden]):not([tabindex='-1'])",
  "input:not([hidden]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

interface Box { el: HTMLElement; x: number; y: number; left: number; right: number; top: number; bottom: number }

function boxes(root: HTMLElement): Box[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => {
      // A control that is off screen or hidden is not reachable. Note that `disabled` is
      // not filtered: the guidelines say an unavailable function should still take focus,
      // appearing translucent, so the viewer can find it and learn why it is unavailable.
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: r.left + r.width / 2, y: r.top + r.height / 2,
               left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
}

function pick(from: Box, all: Box[], code: number): HTMLElement | null {
  const horizontal = code === KEY.LEFT || code === KEY.RIGHT;
  const forward = code === KEY.RIGHT || code === KEY.DOWN;

  let best: { el: HTMLElement; cost: number } | null = null;
  for (const b of all) {
    if (b.el === from.el) continue;

    // Distance along the axis being pressed, measured edge to edge so that adjacent
    // controls of different sizes still feel equidistant.
    const along = horizontal
      ? (forward ? b.left - from.right : from.left - b.right)
      : (forward ? b.top - from.bottom : from.top - b.bottom);
    if (along < -1) continue;                       // behind us, or overlapping

    // Drift across the axis. Overlapping controls score zero, which is what keeps a long
    // row from stealing focus off a neighbouring column.
    const across = horizontal
      ? Math.max(0, Math.max(from.top - b.bottom, b.top - from.bottom))
      : Math.max(0, Math.max(from.left - b.right, b.left - from.right));

    // Sideways movement may never change row. Samsung's Figure 1-3 is precisely this
    // case: a press that lands somewhere diagonal leaves the viewer guessing where the
    // next one will go. Left and right walk along a row, up and down move between rows,
    // and if a row has nothing further along, focus simply stops.
    if (horizontal && across > 0) continue;

    // Vertical movement still needs the ragged escape, because a settings row's controls
    // are right aligned and rarely line up with the row above. The pressed axis dominates,
    // and among equals the nearest centre wins, which is how the guidance describes it.
    const drift = horizontal
      ? 0
      : Math.abs((from.left + from.right) / 2 - (b.left + b.right) / 2);
    const cost = Math.max(0, along) * 4 + across * 2 + drift * 0.2;
    if (!best || cost < best.cost) best = { el: b.el, cost };
  }
  return best?.el ?? null;
}

export function useSpatialNav(root: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const rootRef = root;

  const move = useCallback((code: number): boolean => {
    const container = rootRef.current;
    if (!container) return false;
    const all = boxes(container);
    if (!all.length) return false;

    const active = document.activeElement as HTMLElement | null;
    const current = all.find((b) => b.el === active);
    if (!current) {
      all[0].el.focus();
      return true;
    }
    const next = pick(current, all, code);
    if (!next) return false;                        // at the edge, so stop, do not wrap
    next.focus();
    next.scrollIntoView({ block: "nearest" });
    return true;
  }, [rootRef]);

  // Give focus to something the moment the area becomes active, so the remote is never
  // pointing at nothing.
  const focusFirst = useCallback(() => {
    const container = rootRef.current;
    if (!container) return;
    const all = boxes(container);
    if (all.length && !container.contains(document.activeElement)) all[0].el.focus();
  }, [rootRef]);

  useEffect(() => {
    if (enabled) focusFirst();
  }, [enabled, focusFirst]);

  /** Whether this area holds anything the directional buttons could land on. */
  const hasTargets = useCallback(
    () => !!rootRef.current && boxes(rootRef.current).length > 0,
    [rootRef],
  );

  return { move, focusFirst, hasTargets };
}
