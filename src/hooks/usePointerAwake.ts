import { useEffect, useRef, useState } from "react";

/** How long the pointer's pad waits before withdrawing. */
const POINTER_IDLE_MS = 5000;

/**
 * Whether a mouse is being used just now.
 *
 * The on-screen pad follows the pointer and answers to the pointer alone: it appears when a
 * mouse moves and withdraws when it stops. No key dismisses it, because a viewer holding a
 * remote never sees it and a viewer holding a mouse is using it.
 *
 * That is deliberately not treated as chrome. Making RETURN dismiss the pad trapped a mouse
 * user completely: the pad's own Return button made the pad disappear, moving the mouse
 * brought it straight back, and pressing Return again did the same thing, so there was no
 * way to reach the exit at all with a pointer.
 */
export function usePointerAwake(): boolean {
  const [awake, setAwake] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const wake = () => {
      setAwake(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setAwake(false), POINTER_IDLE_MS);
    };
    window.addEventListener("pointermove", wake, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("pointerdown", wake);
    };
  }, []);

  return awake;
}
