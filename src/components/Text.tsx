import { type CSSProperties, memo, useLayoutEffect, useRef, useState } from "react";

/**
 * Playlist text inherits the app language's direction, including its marquee.
 * Provider spelling stays unchanged and cannot change alignment or layout direction.
 */
export const DEFAULT_MARQUEE_SPEED = 36;
export const DEFAULT_MARQUEE_DWELL_MS = 1200;

type TextMeasurement = () => () => void;
const measurements = new Set<TextMeasurement>();
let measurementFrame: number | null = null;
// A language change can reverse a marquee without changing its measured width.
const directionSchedules = new Set<() => void>();
let directionObserver: MutationObserver | undefined;

const observeDirection = (schedule: () => void) => {
  directionSchedules.add(schedule);
  if (!directionObserver) {
    directionObserver = new MutationObserver(() => {
      for (const update of directionSchedules) update();
    });
    directionObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["dir"],
    });
  }
  return () => {
    directionSchedules.delete(schedule);
    if (!directionSchedules.size) {
      directionObserver?.disconnect();
      directionObserver = undefined;
    }
  };
};

const scheduleMeasurement = (measure: TextMeasurement) => {
  measurements.add(measure);
  if (measurementFrame !== null) return;
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = null;
    const pending = Array.from(measurements);
    measurements.clear();
    // Read every row before changing overflow classes or animation styles.
    const updates = pending.map((read) => read());
    for (const update of updates) update();
  });
};

export const Text = memo(function Text({
  value,
  className = "",
  marquee = false,
  active,
  marqueeSpeed,
  part,
  partValue,
}: {
  value: string;
  className?: string;
  marquee?: boolean;
  /** Explicit activation prepares geometry after the initial dwell. Omit for CSS activation. */
  active?: boolean;
  marqueeSpeed?: number;
  /** Banner/deck expansion mapping: which shared part this run is, and its canonical value. */
  part?: string;
  partValue?: string;
}) {
  const frame = useRef<HTMLSpanElement>(null);
  const run = useRef<HTMLSpanElement>(null);
  const activatedAt = useRef(0);
  const [measurement, setMeasurement] = useState({ value, shift: 0 });
  const shift = active === undefined || measurement.value === value ? measurement.shift : 0;
  const vertical = marquee && className.split(" ").includes("two-line");
  const measureMarquee = marquee && active !== false;
  const speed =
    marqueeSpeed !== undefined && Number.isFinite(marqueeSpeed) && marqueeSpeed > 0
      ? marqueeSpeed
      : DEFAULT_MARQUEE_SPEED;

  useLayoutEffect(() => {
    setMeasurement((previous) =>
      previous.shift !== 0 &&
      (!measureMarquee || (active !== undefined && previous.value !== value))
        ? { value, shift: 0 }
        : previous,
    );
    if (!measureMarquee) return;
    const outer = frame.current;
    const inner = run.current;
    if (!outer || !inner) return;
    let live = true;
    let ready = active !== true;
    activatedAt.current = performance.now();
    const measure = () => {
      const distance = vertical
        ? Math.max(0, inner.scrollHeight - outer.clientHeight)
        : Math.max(0, inner.scrollWidth - outer.clientWidth);
      const rtl = distance > 0 && !vertical && getComputedStyle(outer).direction === "rtl";
      return () => {
        if (!live) return;
        const next = distance === 0 ? 0 : vertical || !rtl ? -distance : distance;
        setMeasurement((previous) =>
          previous.value === value && previous.shift === next
            ? previous
            : { value, shift: next },
        );
      };
    };
    const schedule = () => {
      if (live && ready) scheduleMeasurement(measure);
    };
    let observer: ResizeObserver | undefined;
    let stopObservingDirection: (() => void) | undefined;
    const start = () => {
      if (!live) return;
      ready = true;
      observer = new ResizeObserver(schedule);
      observer.observe(outer);
      observer.observe(inner);
      stopObservingDirection = observeDirection(schedule);
      schedule();
    };
    const timer =
      active === true ? window.setTimeout(start, DEFAULT_MARQUEE_DWELL_MS) : undefined;
    if (ready) start();
    return () => {
      live = false;
      window.clearTimeout(timer);
      observer?.disconnect();
      stopObservingDirection?.();
      measurements.delete(measure);
      if (!measurements.size && measurementFrame !== null) {
        cancelAnimationFrame(measurementFrame);
        measurementFrame = null;
      }
    };
  }, [active, measureMarquee, value, vertical]);

  useLayoutEffect(() => {
    if (!marquee || !shift || active === false) return;
    const outer = frame.current;
    const inner = run.current;
    if (!outer || !inner) return;

    const forward = vertical ? "teleprompter-y" : "teleprompter-x";
    const backward = `${forward}-back`;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const phase = () => inner.style.getPropertyValue("--teleprompter-animation") || forward;
    const resetInactivePhase = () => {
      if (phase() === forward) return;
      const name = getComputedStyle(inner).animationName;
      if (!name || name === "none") {
        inner.style.setProperty("--teleprompter-animation", forward);
      }
    };

    let resetFrame = 0;
    const restart = (dwell = DEFAULT_MARQUEE_DWELL_MS) => {
      inner.style.setProperty("--teleprompter-animation", forward);
      inner.style.animationName = "none";
      inner.style.animationDelay = active === true ? `${dwell}ms` : "";
      if (resetFrame) cancelAnimationFrame(resetFrame);
      resetFrame = requestAnimationFrame(() => {
        resetFrame = 0;
        inner.style.animationName = "";
      });
    };

    const onEnd = (event: AnimationEvent) => {
      if (event.target !== inner) return;
      const name = event.animationName;
      if (name !== forward && name !== backward) return;
      if (name !== phase()) return;
      if (motion.matches) return;
      if (getComputedStyle(inner).animationName !== name) return;
      inner.style.animationDelay = "";
      inner.style.setProperty(
        "--teleprompter-animation",
        name === forward ? backward : forward,
      );
    };
    inner.addEventListener("animationend", onEnd);

    const classObserver = new MutationObserver(resetInactivePhase);
    let ancestor: HTMLElement | null = outer;
    while (ancestor) {
      classObserver.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class", "data-input-mode"],
      });
      ancestor = ancestor.parentElement;
    }

    const owner =
      outer.closest<HTMLElement>(".row, .vod-category, .guide-row, .poster-card") ?? outer;
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && owner.contains(next)) return;
      resetInactivePhase();
    };
    owner.addEventListener("pointerleave", resetInactivePhase);
    owner.addEventListener("focusout", onFocusOut);

    const onMotion = () => restart();
    motion.addListener(onMotion);

    restart(
      active === true
        ? Math.max(0, DEFAULT_MARQUEE_DWELL_MS - (performance.now() - activatedAt.current))
        : DEFAULT_MARQUEE_DWELL_MS,
    );

    return () => {
      inner.removeEventListener("animationend", onEnd);
      classObserver.disconnect();
      owner.removeEventListener("pointerleave", resetInactivePhase);
      owner.removeEventListener("focusout", onFocusOut);
      motion.removeListener(onMotion);
      if (resetFrame) cancelAnimationFrame(resetFrame);
      inner.style.removeProperty("--teleprompter-animation");
      inner.style.animationName = "";
      inner.style.animationDelay = "";
    };
  }, [marquee, value, shift, speed, vertical, active]);

  const data = part
    ? { "data-playback-part": part, "data-playback-value": partValue ?? value }
    : {};

  if (!marquee) {
    return (
      <span className={className} {...data}>
        {value}
      </span>
    );
  }

  return (
    <span
      ref={frame}
      className={`${className} teleprompter ${vertical ? "vertical" : ""} ${measureMarquee && shift ? "overflowing" : ""} ${active === false ? "inactive" : active ? "active" : ""}`}
      {...data}
      style={
        measureMarquee
          ? ({
              "--teleprompter-shift": `${shift}px`,
              "--teleprompter-duration": `${Math.abs(shift) / speed}s`,
              "--teleprompter-dwell": `${DEFAULT_MARQUEE_DWELL_MS}ms`,
            } as CSSProperties)
          : undefined
      }
    >
      <span ref={run} className="teleprompter-run">
        {value}
      </span>
    </span>
  );
});
