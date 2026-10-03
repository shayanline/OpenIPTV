import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * A run of text from the playlist, laid out in whichever direction it is written in.
 *
 * Playlists come from everywhere, so a channel name may be Latin, Arabic, Hebrew, Thai,
 * Cyrillic or a mix. `dir="auto"` hands the decision to the browser, which picks the base
 * direction from the first strong character, so a right to left name is not left aligned
 * with its punctuation flung to the wrong end. The app makes no assumption about which
 * language a playlist is in and never tries to split a name into parts.
 */
export function Text({
  value,
  className = "",
  marquee = false,
}: {
  value: string;
  className?: string;
  marquee?: boolean;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const run = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  const vertical = className.split(" ").includes("two-line");

  useLayoutEffect(() => {
    if (!marquee) return;
    const outer = frame.current;
    const inner = run.current;
    if (!outer || !inner) return;
    const measure = () => {
      const distance = vertical
        ? Math.max(0, inner.scrollHeight - outer.clientHeight)
        : Math.max(0, inner.scrollWidth - outer.clientWidth);
      const rtl = getComputedStyle(outer).direction === "rtl";
      setShift(vertical || !rtl ? -distance : distance);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [marquee, value, vertical]);

  if (!marquee) {
    return (
      <span className={className} dir="auto">
        {value}
      </span>
    );
  }

  return (
    <span
      ref={frame}
      className={`${className} teleprompter ${vertical ? "vertical" : ""} ${shift ? "overflowing" : ""}`}
      dir="auto"
      style={{ "--teleprompter-shift": `${shift}px` } as CSSProperties}
    >
      <span ref={run} className="teleprompter-run">
        {value}
      </span>
    </span>
  );
}
