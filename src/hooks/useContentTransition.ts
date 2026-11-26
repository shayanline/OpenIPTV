import { useCallback, useLayoutEffect } from "react";
import { usePageTransition } from "./usePageTransition";

/* Content swaps inside a surface that stays mounted reuse the page transition machine:
   the commit runs when the outgoing leg ends and the surface reports ready next layout. */
export function useContentTransition(ownerKey: string) {
  const transition = usePageTransition<() => void>({
    ownerKey,
    onCommit: (commit) => commit(),
  });
  useLayoutEffect(() => {
    if (transition.phase === "settling") {
      transition.ready(transition.settlingRevision);
    }
  }, [transition.phase, transition.ready, transition.settlingRevision]);
  const navigate = useCallback(
    (commit: () => void) => transition.request(commit, { leaving: "fade", entering: "fade" }),
    [transition.request],
  );
  const navigateNow = useCallback(
    (commit: () => void) => {
      transition.cancel();
      commit();
    },
    [transition.cancel],
  );
  return { ...transition, navigate, navigateNow };
}
