import { useLayoutEffect, useRef } from "react";
import { cssMs } from "../services/metrics";

/*
 * The measured half of the banner to deck expansion.
 *
 * The old entrance scaled the whole deck by guessed factors, which stretched every letter
 * and landed the metadata nowhere near where the banner had it. This hook does the honest
 * version: the screen captures the banner's real rectangles just before it unmounts, the
 * deck reads its own real rectangles before paint, and only the parts that genuinely
 * exist in both places move from one to the other. Everything else fades in.
 *
 * Deliberately kept to APIs the minimum engine floor guarantees: Element.animate with
 * keyframes and onfinish/cancel. No View Transitions, no Animation.finished, no
 * getAnimations, no DOMMatrix. The teleprompter offset is read by parsing the computed
 * transform string, which is all the information needed.
 */

export interface PlaybackExpansionRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export type PlaybackExpansionPartName =
  | "number"
  | "logo"
  | "title"
  | "quality"
  | "category"
  | "now";

export interface PlaybackExpansionPart {
  rect: PlaybackExpansionRect;
  /** Computed font size in pixels, so text scales uniformly rather than stretching. */
  fontSize: number;
  /** The canonical value both surfaces must agree on before the part may travel. */
  value: string;
  /** A marquee already in motion carries its translation across, divided by the scale. */
  offset?: number;
}

export interface PlaybackExpansionOrigin {
  targetKey: string;
  bounds: PlaybackExpansionRect;
  radius: number;
  parts: Partial<Record<PlaybackExpansionPartName, PlaybackExpansionPart>>;
}

interface ExpansionRun {
  origin: PlaybackExpansionOrigin;
  targetKey: string;
  contentKey: string;
  state: "running" | "released" | "finished";
}

const EXPAND_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const rectOf = (rect: DOMRect): PlaybackExpansionRect => ({
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
  width: rect.width,
  height: rect.height,
});

/*
 * A computed transform reads back as "matrix(a, b, c, d, tx, ty)" or "none". Parsing the
 * string is enough: the only use is the marquee run's horizontal offset, and no DOMMatrix
 * exists at the floor this has to run on.
 */
const matrixOffset = (transform: string): number => {
  const match = /^matrix\(\s*([^)]+)\)$/.exec(transform);
  if (!match) return 0;
  const parts = match[1].split(",").map((value) => Number.parseFloat(value));
  const tx = parts[4];
  return Number.isFinite(tx) ? tx : 0;
};

/**
 * Read a visible banner that is still mounted, for the deck that is about to replace it.
 *
 * Returns null for anything that cannot produce an honest expansion: no banner, a banner
 * that is not rendered, or a banner for a different target than the one about to play.
 * Those cases take the ordinary entrance instead of a morph from the wrong geometry.
 */
export function capturePlaybackExpansion(
  root: HTMLElement,
  expectedTargetKey: string,
): PlaybackExpansionOrigin | null {
  const banner = root.querySelector<HTMLElement>(".pb-stack[data-playback-target]");
  if (!banner || banner.dataset.playbackTarget !== expectedTargetKey) return null;
  const bounds = banner.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const parts: PlaybackExpansionOrigin["parts"] = {};
  banner.querySelectorAll<HTMLElement>("[data-playback-part]").forEach((node) => {
    const name = node.dataset.playbackPart as PlaybackExpansionPartName;
    const value = node.dataset.playbackValue ?? "";
    const rect = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const style = getComputedStyle(node);
    const part: PlaybackExpansionPart = {
      rect: rectOf(rect),
      fontSize: Number.parseFloat(style.fontSize) || 0,
      value,
    };
    const run = node.querySelector<HTMLElement>(".teleprompter-run");
    if (run) {
      const offset = matrixOffset(getComputedStyle(run).transform);
      if (offset) part.offset = offset;
    }
    parts[name] = part;
  });
  const radius = Number.parseFloat(getComputedStyle(banner).borderRadius) || 0;
  return { targetKey: expectedTargetKey, bounds: rectOf(bounds), radius, parts };
}

/**
 * Before paint, move the deck's surface and every shared part from the captured banner
 * geometry to where layout just put them, then let the animations run to identity.
 *
 * Only parts whose canonical value survives the trip are animated: a title that changed
 * under the banner must not fly. Focus and input are never gated on the motion; the
 * animations are decoration over a surface that already works.
 */
export function usePlaybackExpansion(
  ref: React.RefObject<HTMLElement | null>,
  origin: PlaybackExpansionOrigin | null,
  targetKey: string,
  contentKey: string,
): void {
  /* A released run can replay only with the same origin, target, and content identity. */
  const consumed = useRef<ExpansionRun | null>(null);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const root = ref.current;
    /*
     * Interruption tears the whole group down at once. The handlers detach before the
     * cancel loop so an animation reporting its own cancellation cannot reenter this
     * bookkeeping mid sweep.
     */
    const cancel = () => {
      const group = animations.current;
      animations.current = [];
      root?.classList.remove("expanding");
      for (const animation of group) {
        animation.onfinish = null;
        animation.oncancel = null;
      }
      for (const animation of group) animation.cancel();
    };
    const previous = consumed.current;
    const sameOrigin = previous?.origin === origin;
    const replay =
      sameOrigin &&
      previous?.state === "released" &&
      previous.targetKey === targetKey &&
      previous.contentKey === contentKey;
    if (previous && !replay) previous.state = "finished";
    if (
      !root ||
      !origin ||
      origin.targetKey !== targetKey ||
      (sameOrigin && !replay) ||
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      return cancel;
    }

    /*
     * Motion belongs to the stylesheet: the token reads zero under reduced motion, and
     * a zero or negative duration settles immediately with no animation and no class.
     * The parts share the same proportion of the surface's duration as the 380 of 420
     * the handoff was designed around.
     */
    const surfaceMs = cssMs("--t-playback-expand");
    if (surfaceMs <= 0) return cancel;
    const partMs = (surfaceMs * 19) / 21;

    const destination = root.getBoundingClientRect();
    if (!destination.width || !destination.height) return cancel;
    const run: ExpansionRun = { origin, targetKey, contentKey, state: "running" };
    consumed.current = run;
    const scaleX = origin.bounds.width / destination.width;
    const scaleY = origin.bounds.height / destination.height;
    const translateX = origin.bounds.left - destination.left;
    const translateY = origin.bounds.bottom - destination.bottom;

    /*
     * The group completes only when every member finishes: a part settling early must
     * not strip the class while the surface underneath is still travelling. Each member
     * removes itself on finish, and the last one out clears the expanding state.
     */
    const finish = (animation: Animation) => {
      animations.current = animations.current.filter((candidate) => candidate !== animation);
      if (!animations.current.length) {
        run.state = "finished";
        root?.classList.remove("expanding");
      }
    };
    const interrupt = () => {
      run.state = "finished";
      cancel();
    };
    root.classList.add("expanding");
    const add = (animation: Animation) => {
      animation.onfinish = () => finish(animation);
      animation.oncancel = interrupt;
      animations.current.push(animation);
    };
    const surface = root.querySelector<HTMLElement>(".deck-surface");
    if (surface) {
      const targetRadius = Number.parseFloat(getComputedStyle(surface).borderRadius) || 0;
      const r = origin.radius;
      add(
        surface.animate(
          [
            {
              transformOrigin: "0 100%",
              transform: `translate(${translateX}px, ${translateY}px) scale(${scaleX}, ${scaleY})`,
              borderRadius: `${r / scaleX}px / ${r / scaleY}px`,
            },
            {
              transformOrigin: "0 100%",
              transform: "translate(0px, 0px) scale(1, 1)",
              borderRadius: `${targetRadius}px`,
            },
          ],
          { duration: surfaceMs, easing: EXPAND_EASING, fill: "backwards" },
        ),
      );
    }

    for (const name of Object.keys(origin.parts) as PlaybackExpansionPartName[]) {
      const part = origin.parts[name];
      if (!part) continue;
      /*
       * The selector names the part only. The value is a provider string that can hold
       * anything, including quotes and backslashes, so it is compared on the dataset
       * rather than embedded in the query.
       */
      const node = root.querySelector<HTMLElement>(`[data-playback-part="${name}"]`);
      if (!node || (node.dataset.playbackValue ?? "") !== part.value) continue;
      const to = node.getBoundingClientRect();
      /*
       * Text travels as one uniform font ratio, never independent axes. The logo box is
       * artwork rather than type, so it scales by the measured rectangles instead and
       * an unrelated font size cannot change its size.
       */
      let scale = 1;
      if (name === "logo") {
        if (to.width > 0 && to.height > 0 && part.rect.width > 0 && part.rect.height > 0) {
          scale = Math.min(part.rect.width / to.width, part.rect.height / to.height);
        }
      } else {
        const fontSize = Number.parseFloat(getComputedStyle(node).fontSize) || part.fontSize;
        scale = fontSize > 0 ? part.fontSize / fontSize : 1;
      }
      const dx = part.rect.left - to.left;
      const dy = part.rect.top - to.top;
      add(
        node.animate(
          [
            {
              transformOrigin: "0 0",
              transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            },
            { transformOrigin: "0 0", transform: "translate(0px, 0px) scale(1)" },
          ],
          { duration: partMs, easing: EXPAND_EASING, fill: "backwards" },
        ),
      );
      /* A marquee that was already travelling keeps its offset rather than visibly
         restarting: the run begins at the captured translation divided by the outer
         scale and lands at zero with its part. */
      if (part.offset) {
        const run = node.querySelector<HTMLElement>(".teleprompter-run");
        if (run) {
          add(
            run.animate(
              [
                { transform: `translateX(${part.offset / scale}px)` },
                { transform: "translateX(0px)" },
              ],
              { duration: partMs, easing: EXPAND_EASING, fill: "backwards" },
            ),
          );
        }
      }
    }

    window.addEventListener("resize", interrupt);
    return () => {
      window.removeEventListener("resize", interrupt);
      if (run.state === "running") run.state = "released";
      cancel();
    };
    /* Position and clock updates must not restart motion. Only a new origin, target, or
       content identity may. The dependency list is exactly that set. */
  }, [ref, origin, targetKey, contentKey]);
}
