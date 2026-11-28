import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TransitionEvent,
} from "react";
import { cssMs } from "../services/metrics";

export type PageTransitionPhase = "idle" | "leaving" | "settling" | "entering";
export type PageMotion = "fade" | "rail";
export interface PageMotionPair {
  leaving: PageMotion;
  entering: PageMotion;
}

export interface PageTransition<T> {
  phase: PageTransitionPhase;
  requestedTarget: T | null;
  motion: PageMotionPair;
  settlingRevision: number;
  request: (target: T, motion: PageMotionPair) => void;
  cancel: () => void;
  ready: (revision: number) => void;
  onTransitionEnd: (event: TransitionEvent) => void;
}

const FADE_MOTION: PageMotionPair = { leaving: "fade", entering: "fade" };

/*
 * The swap between two targets, owned in one place. `leaving` covers the request until the
 * outgoing leg finishes, `settling` holds the committed target hidden until it reports
 * `ready`, and `entering` reveals it. Each leg is a shade fade or the Live rail slide,
 * chosen per request, and a timer stands in for engines where transitionend never arrives.
 * Everything the machine needs lives in refs so callbacks keep their identity and a stale
 * render can never commit a target the viewer already replaced. `ownerKey` names the data
 * the transition belongs to: when it changes, whatever was pending is obsolete.
 */
export function usePageTransition<T>({
  ownerKey,
  onCommit,
  onFinish,
}: {
  ownerKey: string;
  onCommit: (target: T) => void;
  onFinish?: () => void;
}): PageTransition<T> {
  const [phase, setPhase] = useState<PageTransitionPhase>("idle");
  const [requestedTarget, setRequestedTarget] = useState<T | null>(null);
  const [motion, setMotion] = useState<PageMotionPair>(FADE_MOTION);
  const [settlingRevision, setSettlingRevision] = useState(0);
  const phaseRef = useRef<PageTransitionPhase>("idle");
  const motionRef = useRef<PageMotionPair>(FADE_MOTION);
  const leavingMotionRef = useRef<PageMotion>("fade");
  const revisionRef = useRef(0);
  const pendingRef = useRef<{ value: T } | null>(null);
  const committedRef = useRef(false);
  const settleAwaitingRef = useRef(false);
  const generationRef = useRef(0);
  const phaseTimer = useRef<number | undefined>(undefined);
  const rafIds = useRef<number[]>([]);
  const ownerRef = useRef(ownerKey);
  const callbacks = useRef({ onCommit, onFinish });
  callbacks.current = { onCommit, onFinish };

  const goPhase = useCallback((next: PageTransitionPhase) => {
    phaseRef.current = next;
    setPhase(next);
    if (next === "idle") setRequestedTarget(null);
  }, []);

  const clearAsync = useCallback(() => {
    window.clearTimeout(phaseTimer.current);
    phaseTimer.current = undefined;
    for (const id of rafIds.current) cancelAnimationFrame(id);
    rafIds.current = [];
    settleAwaitingRef.current = false;
  }, []);

  const commitTarget = useCallback((target: T) => {
    revisionRef.current += 1;
    setSettlingRevision(revisionRef.current);
    callbacks.current.onCommit(target);
  }, []);

  const settleLeaving = useCallback(() => {
    if (phaseRef.current !== "leaving" || committedRef.current) return;
    const pending = pendingRef.current;
    if (!pending) return;
    committedRef.current = true;
    pendingRef.current = null;
    commitTarget(pending.value);
    goPhase("settling");
  }, [commitTarget, goPhase]);

  const settleEntering = useCallback(() => {
    if (phaseRef.current !== "entering") return;
    clearAsync();
    goPhase("idle");
    callbacks.current.onFinish?.();
  }, [clearAsync, goPhase]);

  const armFallback = useCallback(
    (generation: number) => {
      window.clearTimeout(phaseTimer.current);
      phaseTimer.current = window.setTimeout(() => {
        if (generationRef.current !== generation) return;
        if (phaseRef.current === "leaving") settleLeaving();
        else if (phaseRef.current === "entering") settleEntering();
      }, cssMs("--t-navigation"));
    },
    [settleEntering, settleLeaving],
  );

  const applyMotion = useCallback((next: PageMotionPair) => {
    motionRef.current = next;
    setMotion(next);
  }, []);

  const request = useCallback(
    (target: T, nextMotion: PageMotionPair) => {
      if (cssMs("--t-navigation") === 0) {
        setRequestedTarget(null);
        generationRef.current += 1;
        clearAsync();
        pendingRef.current = null;
        committedRef.current = false;
        leavingMotionRef.current = nextMotion.leaving;
        applyMotion(nextMotion);
        if (phaseRef.current !== "idle") goPhase("idle");
        commitTarget(target);
        callbacks.current.onFinish?.();
        return;
      }
      setRequestedTarget(() => target);
      const current = phaseRef.current;
      if (current === "idle" || current === "entering") {
        pendingRef.current = { value: target };
        committedRef.current = false;
        leavingMotionRef.current = nextMotion.leaving;
        applyMotion(nextMotion);
        generationRef.current += 1;
        goPhase("leaving");
        armFallback(generationRef.current);
        return;
      }
      if (current === "leaving") {
        pendingRef.current = { value: target };
        applyMotion({ ...motionRef.current, entering: nextMotion.entering });
        return;
      }
      applyMotion({ ...motionRef.current, entering: nextMotion.entering });
      pendingRef.current = null;
      settleAwaitingRef.current = false;
      for (const id of rafIds.current) cancelAnimationFrame(id);
      rafIds.current = [];
      generationRef.current += 1;
      commitTarget(target);
    },
    [applyMotion, armFallback, clearAsync, commitTarget, goPhase],
  );

  const cancel = useCallback(() => {
    if (phaseRef.current === "idle") return;
    generationRef.current += 1;
    clearAsync();
    pendingRef.current = null;
    committedRef.current = false;
    goPhase("idle");
    callbacks.current.onFinish?.();
  }, [clearAsync, goPhase]);

  const ready = useCallback(
    (revision: number) => {
      if (phaseRef.current !== "settling" || settleAwaitingRef.current) return;
      if (revision !== revisionRef.current) return;
      settleAwaitingRef.current = true;
      const generation = generationRef.current;
      const first = requestAnimationFrame(() => {
        rafIds.current = rafIds.current.filter((id) => id !== first);
        const second = requestAnimationFrame(() => {
          rafIds.current = rafIds.current.filter((id) => id !== second);
          if (
            generationRef.current !== generation ||
            phaseRef.current !== "settling" ||
            revisionRef.current !== revision
          )
            return;
          settleAwaitingRef.current = false;
          goPhase("entering");
          armFallback(generation);
        });
        rafIds.current.push(second);
      });
      rafIds.current.push(first);
    },
    [armFallback, goPhase],
  );

  const onTransitionEnd = useCallback(
    (event: TransitionEvent) => {
      if (event.target !== event.currentTarget) return;
      const current = phaseRef.current;
      if (current === "leaving") {
        if (leavingMotionRef.current === "fade") {
          if (event.propertyName !== "opacity") return;
          const opacity = Number.parseFloat(getComputedStyle(event.currentTarget).opacity);
          if (opacity >= 0.999) settleLeaving();
        } else {
          if (event.propertyName !== "transform") return;
          if (railFinishedLeaving(event.currentTarget)) settleLeaving();
        }
        return;
      }
      if (current === "entering") {
        if (motionRef.current.entering === "fade") {
          if (event.propertyName !== "opacity") return;
          const opacity = Number.parseFloat(getComputedStyle(event.currentTarget).opacity);
          if (opacity <= 0.001) settleEntering();
        } else {
          if (event.propertyName !== "transform") return;
          if (railFinishedEntering(event.currentTarget)) settleEntering();
        }
      }
    },
    [settleEntering, settleLeaving],
  );

  useLayoutEffect(() => {
    if (ownerRef.current === ownerKey) return;
    ownerRef.current = ownerKey;
    if (phaseRef.current !== "idle") cancel();
  }, [cancel, ownerKey]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      clearAsync();
    },
    [clearAsync],
  );

  return {
    phase,
    requestedTarget,
    motion,
    settlingRevision,
    request,
    cancel,
    ready,
    onTransitionEnd,
  };
}

/*
 * A rail leg is done leaving only once the host's box is entirely past the viewport edge,
 * which a late event from a reversed leg cannot fake: mid-flight the box still overlaps.
 */
function railFinishedLeaving(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (getComputedStyle(element).direction === "rtl") {
    return rect.left >= window.innerWidth - 0.25;
  }
  return rect.right <= 0.25;
}

/*
 * A rail leg is done entering only at zero translation. The computed transform is read as
 * a string because matrix() is the only shape a translate produces here.
 */
function railFinishedEntering(element: Element): boolean {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return true;
  const match = /matrix(?:3d)?\(([^)]*)\)/.exec(transform);
  if (!match) return false;
  const values = match[1].split(",").map((part) => Number.parseFloat(part));
  if (values.some(Number.isNaN)) return false;
  const tx = values.length === 6 ? values[4] : values[12];
  const ty = values.length === 6 ? values[5] : values[13];
  return Math.abs(tx) <= 0.01 && Math.abs(ty) <= 0.01;
}
