import { type AnimationEvent, useEffect, useState } from "react";
import { cssMs } from "../services/metrics";

/** Keep a dismissed report mounted only while its shared exit animation runs. */
export function usePlaybackPresence(visible: boolean) {
  const [present, setPresent] = useState(visible);

  useEffect(() => {
    if (visible) {
      setPresent(true);
      return;
    }
    if (!present) return;
    const duration = cssMs("--t-med");
    if (!duration) {
      setPresent(false);
      return;
    }
    const timer = window.setTimeout(() => setPresent(false), duration + 100);
    return () => window.clearTimeout(timer);
  }, [present, visible]);

  const closing = !visible && present;
  const onAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (closing && event.target === event.currentTarget && event.animationName === "pb-out") {
      setPresent(false);
    }
  };
  return { present: visible || present, closing, onAnimationEnd };
}
