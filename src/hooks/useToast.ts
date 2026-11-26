import { useCallback, useLayoutEffect, useMemo } from "react";
import {
  clearToast,
  releaseToastOwner,
  resolveToast,
  retainToastOwner,
  showToast,
  useToasts,
  type ToastKind,
  type ToastOutcome,
} from "../services/toast";

export function useToast(scope: string, enabled = true) {
  const owner = useMemo(() => Symbol(scope), [scope]);
  useLayoutEffect(() => {
    if (!enabled) return;
    retainToastOwner(owner);
    return () => releaseToastOwner(owner);
  }, [owner, enabled]);
  const notice = useToasts((state) => (state.notice?.owner === owner ? state.notice : null));
  const show = useCallback(
    (message: string, kind: ToastKind = "neutral", operation?: symbol) =>
      showToast(owner, message, kind, operation),
    [owner],
  );
  const clear = useCallback((id?: number) => clearToast(owner, id), [owner]);
  const resolve = useCallback(
    (id: number | undefined, message: string, kind: ToastOutcome) =>
      resolveToast(owner, id, message, kind),
    [owner],
  );
  return { notice, show, clear, resolve };
}
