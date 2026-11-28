import { useEffect, useState, type RefObject } from "react";

/**
 * The measured height of an element, for the windowing maths.
 *
 * Measured rather than assumed, because the panel's height depends on the safe area and
 * the header, and a wrong number here shows up as a row of blank space at the bottom of
 * the list or as rows appearing a beat late.
 */
export function useViewport(ref: RefObject<HTMLElement | null>, contentBox = false): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (!contentBox) {
        setHeight(el.clientHeight);
        return;
      }
      const style = getComputedStyle(el);
      setHeight(
        Math.max(
          0,
          el.clientHeight -
            (Number.parseFloat(style.paddingTop) || 0) -
            (Number.parseFloat(style.paddingBottom) || 0),
        ),
      );
    };
    measure();
    // The panel is only measured when it changes shape, which on a TV is never after the
    // first layout, so this costs nothing at rest.
    const observer = new ResizeObserver((entries) => {
      if (!contentBox) {
        measure();
        return;
      }
      const entry = entries.find((entry) => entry.target === el);
      if (entry) setHeight(Math.max(0, entry.contentRect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentBox, ref]);

  return height;
}
