import type { TransitionEvent } from "react";
import type { PageTransition } from "../hooks/usePageTransition";

/* The mask a content transition draws over its own surface. A sibling of the scrolling
   container so it cannot scroll away, stopping at the surface edge so higher layers
   always paint above it. */
export function ContentTransitionShade({
  phase,
  onTransitionEnd,
  className,
}: Pick<PageTransition<() => void>, "phase" | "onTransitionEnd"> & {
  className?: string;
}) {
  return (
    <div
      className={
        className ? `content-transition-shade ${className}` : "content-transition-shade"
      }
      data-phase={phase}
      aria-hidden="true"
      onTransitionEnd={(event: TransitionEvent) => {
        event.stopPropagation();
        onTransitionEnd(event);
      }}
    />
  );
}
