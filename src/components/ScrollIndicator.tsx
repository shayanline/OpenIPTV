import { useEffect, useRef, useState } from "react";

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function scrollIndicatorMetrics(
  count: number,
  first: number,
  visible: number,
): { ratio: number; progress: number } {
  const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
  const safeVisible = clamp(Number.isFinite(visible) ? visible : safeCount, 0, safeCount);
  const maximumFirst = Math.max(0, safeCount - safeVisible);
  const safeFirst = clamp(Number.isFinite(first) ? first : 0, 0, maximumFirst);
  return {
    ratio: safeCount ? clamp(safeVisible / safeCount, 0, 1) : 1,
    progress: maximumFirst ? clamp(safeFirst / maximumFirst, 0, 1) : 0,
  };
}

/**
 * Position indicator for a long list.
 *
 * Samsung's UX checklist makes this a requirement rather than a nicety: item 1.2 says a
 * scroll indicator must be provided when a list exceeds one page. Their guidance is that
 * bar's length reflects how much of the list is visible. Vertical tracks stay visible,
 * while movement briefly emphasizes their thumbs. Horizontal indicators withdraw when idle.
 *
 * It takes the window rather than a scrolling element, because the lists no longer scroll:
 * they render a slice and slide it. That also means no scroll listener, which on a TV is a
 * saving worth having, since the events fire far more often than the viewer moves.
 */
export function ScrollIndicator({
  count,
  first,
  visible,
  orientation = "vertical",
}: {
  count: number;
  first: number;
  visible: number;
  orientation?: "vertical" | "horizontal";
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const previousFirst = useRef(first);
  const mounted = useRef(false);
  const { ratio, progress } = scrollIndicatorMetrics(count, first, visible);

  useEffect(() => {
    const moved = mounted.current && first !== previousFirst.current;
    previousFirst.current = first;
    mounted.current = true;
    // Put away rather than returned from, or a bar raised by a long category stays raised
    // when the viewer moves to a short one, with nothing left to hide it.
    if (count <= visible || !Number.isFinite(count) || count <= 0) {
      window.clearTimeout(timer.current);
      setShow(false);
      return;
    }
    if (orientation === "horizontal" && !moved) return;
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(false), 2000);
    return () => window.clearTimeout(timer.current);
  }, [count, first, orientation, visible]);

  if (count <= visible || !Number.isFinite(count) || count <= 0) return null;

  const position = `${progress * 100}%`;
  const size = `${ratio * 100}%`;
  const rtl = document.documentElement.dir === "rtl";

  return (
    <div className={`scrollbar ${orientation} ${show ? "show" : ""}`} aria-hidden="true">
      <div
        className="scrollbar-thumb"
        style={
          orientation === "horizontal"
            ? {
                width: size,
                ...(rtl ? { right: position } : { left: position }),
                transform: `translateX(${(rtl ? 1 : -1) * progress * 100}%)`,
              }
            : { height: size, top: position, transform: `translateY(${-progress * 100}%)` }
        }
      />
    </div>
  );
}
