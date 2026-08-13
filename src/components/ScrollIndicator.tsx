import { useEffect, useRef, useState } from "react";

/**
 * Position indicator for a long list.
 *
 * Samsung's UX checklist makes this a requirement rather than a nicety: item 1.2 says a
 * scroll indicator must be provided when a list exceeds one page. Their guidance is that
 * the bar's length reflects how much of the list is visible, and that it appears when the
 * viewer arrives or moves and withdraws about two seconds later.
 *
 * It takes the window rather than a scrolling element, because the lists no longer scroll:
 * they render a slice and slide it. That also means no scroll listener, which on a TV is a
 * saving worth having, since the events fire far more often than the viewer moves.
 */
export function ScrollIndicator({ count, first, visible }: {
  count: number;
  first: number;
  visible: number;
}) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    // Put away rather than returned from, or a bar raised by a long category stays raised
    // when the viewer moves to a short one, with nothing left to hide it.
    if (count <= visible) {
      setShow(false);
      return;
    }
    setShow(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(false), 2000);
    return () => window.clearTimeout(timer.current);
  }, [count, first, visible]);

  if (count <= visible) return null;

  const ratio = visible / count;
  const travel = first / count;

  return (
    <div className={`scrollbar ${show ? "show" : ""}`} aria-hidden="true">
      <div
        className="scrollbar-thumb"
        style={{ height: `${ratio * 100}%`, transform: `translateY(${(travel * 100) / ratio}%)` }}
      />
    </div>
  );
}
