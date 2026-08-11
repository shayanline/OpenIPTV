import { useEffect, useRef, useState } from "react";

/**
 * Position indicator for a scrollable list.
 *
 * Samsung's UX checklist makes this a requirement rather than a nicety: item 1.2 says a
 * scroll indicator must be provided when a list exceeds one page. Their guidance is that
 * the bar's length reflects how much of the list is visible, and that it appears when the
 * viewer arrives or moves and withdraws about two seconds later.
 */
export function ScrollIndicator({ target, deps }: {
  target: React.RefObject<HTMLElement | null>;
  deps: unknown[];
}) {
  const [state, setState] = useState({ ratio: 0, offset: 0, needed: false });
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = target.current;
    if (!el) return;

    const measure = () => {
      const { scrollHeight, clientHeight, scrollTop } = el;
      const needed = scrollHeight > clientHeight + 4;
      setState({
        needed,
        ratio: needed ? clientHeight / scrollHeight : 0,
        offset: needed ? scrollTop / scrollHeight : 0,
      });
      if (needed) {
        setShow(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setShow(false), 2000);
      }
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      el.removeEventListener("scroll", measure);
      window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (!state.needed) return null;

  return (
    <div className={`scrollbar ${show ? "show" : ""}`} aria-hidden="true">
      <div
        className="scrollbar-thumb"
        style={{ height: `${state.ratio * 100}%`, transform: `translateY(${state.offset * 100 / state.ratio}%)` }}
      />
    </div>
  );
}
