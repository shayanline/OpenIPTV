import { useCallback, useEffect, useRef } from "react";

export interface LongPressOptions {
  code: number;
  enabled: boolean;
  delayMs?: number;
  capture?: boolean;
  onShortPress: () => void;
  onLongPress: () => void;
}

export function useLongPress({
  code,
  enabled,
  delayMs = 500,
  capture = false,
  onShortPress,
  onLongPress,
}: LongPressOptions): void {
  const enabledRef = useRef(enabled);
  const shortPressRef = useRef(onShortPress);
  const longPressRef = useRef(onLongPress);
  const timerRef = useRef<number | undefined>(undefined);
  const pressedRef = useRef(false);
  const longRef = useRef(false);

  enabledRef.current = enabled;
  shortPressRef.current = onShortPress;
  longPressRef.current = onLongPress;

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    pressedRef.current = false;
    longRef.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, [enabled]);

  useEffect(() => {
    const activateLong = () => {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      if (!pressedRef.current || longRef.current || !enabledRef.current) return;
      longRef.current = true;
      longPressRef.current();
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.keyCode !== code || (!pressedRef.current && !enabledRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pressedRef.current = true;
      // Keep ownership until release when a long press changes the active surface.
      if (!enabledRef.current) return;
      if (event.repeat) {
        activateLong();
        return;
      }
      if (timerRef.current === undefined && !longRef.current) {
        timerRef.current = window.setTimeout(activateLong, delayMs);
      }
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.keyCode !== code || !pressedRef.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const short = timerRef.current !== undefined && !longRef.current && enabledRef.current;
      cancel();
      if (short) shortPressRef.current();
    };
    window.addEventListener("keydown", onDown, capture);
    window.addEventListener("keyup", onUp, capture);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("keydown", onDown, capture);
      window.removeEventListener("keyup", onUp, capture);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel, capture, code, delayMs]);
}
