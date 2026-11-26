import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { KEY } from "./useRemote";

/** How long the pointer's pad waits before withdrawing. */
const POINTER_IDLE_MS = 5000;
const REMOTE_KEY_CODES = new Set<number>(Object.values(KEY));

export const pointerInputActive = () =>
  document.documentElement.dataset.inputMode === "pointer";

const subscribeInputMode = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-input-mode"],
  });
  return () => observer.disconnect();
};

export const usePointerInput = () =>
  useSyncExternalStore(subscribeInputMode, pointerInputActive);

export const pointerOnly = (callback: () => void) => {
  if (pointerInputActive()) callback();
};

export const activatePointerInput = () => {
  const root = document.documentElement;
  if (root.dataset.inputMode !== "pointer") root.dataset.inputMode = "pointer";
};

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
    const root = document.documentElement;
    const wake = () => {
      activatePointerInput();
      setAwake(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setAwake(false), POINTER_IDLE_MS);
    };
    const movePointer = () => {
      wake();
    };
    const activateRemote = (event?: KeyboardEvent) => {
      if (event && !REMOTE_KEY_CODES.has(event.keyCode)) return;
      if (root.dataset.inputMode !== "remote") root.dataset.inputMode = "remote";
    };
    activateRemote();
    window.addEventListener("pointermove", movePointer, { passive: true });
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", activateRemote, true);
    return () => {
      window.clearTimeout(timer.current);
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", activateRemote, true);
      delete root.dataset.inputMode;
    };
  }, []);

  return awake;
}
