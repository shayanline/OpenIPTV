import { useCallback, useEffect, useRef } from "react";
import { KEY } from "./useRemote";

export const MAX_LIST_STEP = 20;

export interface ListHold {
  code: number;
  scope: string;
  startedAt: number;
  steppedAt: number;
}

export const createListHold = (): ListHold => ({
  code: 0,
  scope: "",
  startedAt: 0,
  steppedAt: 0,
});

export function listStepFromKey(
  hold: ListHold,
  code: number,
  repeated: boolean,
  scope: string,
  now = performance.now(),
): number {
  if (!repeated || hold.code !== code || hold.scope !== scope || now - hold.steppedAt > 900) {
    hold.code = code;
    hold.scope = scope;
    hold.startedAt = hold.steppedAt = now;
    return 1;
  }
  // Bound unusually fast repeat streams without delaying a fresh press.
  if (now - hold.steppedAt < 70) return 0;
  hold.steppedAt = now;
  const elapsed = now - hold.startedAt;
  return elapsed >= 10000 ? MAX_LIST_STEP : elapsed >= 5000 ? 10 : elapsed >= 2000 ? 5 : 1;
}

export function useListAcceleration(enabled: boolean) {
  const hold = useRef(createListHold());
  useEffect(() => {
    const reset = () => {
      hold.current = createListHold();
    };
    reset();
    if (!enabled) return;
    const release = (event: KeyboardEvent) => {
      if (event.keyCode === hold.current.code) reset();
    };
    const interrupt = (event: KeyboardEvent) => {
      if (event.keyCode !== KEY.UP && event.keyCode !== KEY.DOWN) reset();
    };
    window.addEventListener("keyup", release, true);
    window.addEventListener("keydown", interrupt, true);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("keydown", interrupt, true);
      window.removeEventListener("blur", reset);
    };
  }, [enabled]);
  return useCallback(
    (code: number, repeated: boolean, scope: string) =>
      listStepFromKey(hold.current, code, repeated, scope),
    [],
  );
}
