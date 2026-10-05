import { useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, sendKey } from "../hooks/useRemote";
import { readJSON, write } from "../services/store";
import { Icon } from "./Icon";

/**
 * The Smart Remote's navigation area, on screen, for anyone driving with a mouse.
 *
 * Laid out as the remote in the viewer's other hand is laid out, because the point of an
 * on-screen control is that it needs no learning. The TM2360E has a smooth navigation wheel
 * with the select in its middle, and directly beneath it a row of three: Return on the left,
 * Home in the middle, Play and pause on the right. This is that, minus Home, which belongs
 * to the television rather than to any application.
 *
 * It replaces four separate controls that were scattered around the edges of the screen,
 * each overlapping whatever happened to be beneath it and none of them movable. One thing in
 * one place, and it can be dragged off anything it covers.
 *
 * Every button sends the key a remote would send rather than calling into the app, so there
 * is one set of behaviour rather than two. Left opens the channels because left opens the
 * channels, not because this knows anything about panels.
 *
 * There is no Exit, since Return at the picture already asks whether to close, and a button
 * whose whole job is ending the session should not sit permanently under the cursor.
 */

/** Kept inside the safe area, since a control cropped by overscan is worse than none. */
const EDGE = 56;
const WIDTH = 208;
const HEIGHT = 284;

const limit = (value: number, span: number, max: number) =>
  Math.max(EDGE, Math.min(value, max - span - EDGE));

/**
 * Where the pad was left last time, from localStorage rather than settings: a remembered
 * position is not a choice the viewer made. It is clamped against the window as it is now,
 * since it can be smaller than when the position was written, and a pad parked off screen
 * is worse than one back at its default edge.
 */
function restored(): { x: number; y: number } | null {
  const at = readJSON<{ x?: unknown; y?: unknown } | null>("openiptv.pad", null);
  if (typeof at?.x !== "number" || typeof at?.y !== "number") return null;
  return {
    x: limit(at.x, WIDTH, window.innerWidth),
    y: limit(at.y, HEIGHT, window.innerHeight),
  };
}

export function PointerPad({ shown }: { shown: boolean }) {
  const { t } = useLocale();
  const [at, setAt] = useState<{ x: number; y: number } | null>(restored);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const shell = useRef<HTMLDivElement>(null);

  const start = (e: React.PointerEvent) => {
    // Only the pad itself drags. A press that begins on a button is a press of that button.
    if ((e.target as HTMLElement).closest("button")) return;
    const box = shell.current?.getBoundingClientRect();
    if (!box) return;
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    shell.current?.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setAt({
      x: limit(e.clientX - drag.current.dx, WIDTH, window.innerWidth),
      y: limit(e.clientY - drag.current.dy, HEIGHT, window.innerHeight),
    });
  };

  const end = (e: React.PointerEvent) => {
    // A pointerup that was never a drag, such as a button press on the pad, is not worth
    // a write.
    if (!drag.current) return;
    drag.current = null;
    shell.current?.releasePointerCapture(e.pointerId);
    if (at) write("openiptv.pad", JSON.stringify(at));
  };

  if (!shown) return null;

  return (
    <div
      ref={shell}
      className="pad"
      /* Once dragged it is placed outright, so the centring transform that positions it at
         rest has to come off or it would sit half its height above the cursor. */
      style={at ? { left: at.x, top: at.y, right: "auto", transform: "none" } : undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {/* The wheel. The physical one carries no printed arrows, so these are the same faint
          chevrons the remote's own outline uses rather than four drawn arrows. */}
      <div className="pad-wheel">
        <button
          type="button"
          tabIndex={-1}
          className="pad-dir pad-up"
          onClick={() => sendKey(KEY.UP)}
          aria-label={t("common.up")}
        >
          <Icon name="chevronUp" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="pad-dir pad-right"
          onClick={() => sendKey(KEY.RIGHT)}
          aria-label={t("common.right")}
        >
          <Icon name="chevronRight" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="pad-dir pad-down"
          onClick={() => sendKey(KEY.DOWN)}
          aria-label={t("common.down")}
        >
          <Icon name="chevronDown" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="pad-dir pad-left"
          onClick={() => sendKey(KEY.LEFT)}
          aria-label={t("common.left")}
        >
          <Icon name="chevronLeft" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="pad-ok"
          onClick={() => sendKey(KEY.ENTER)}
          aria-label={t("common.select")}
        >
          {t("common.ok")}
        </button>
      </div>

      {/* Return and Play, in the places and the order the remote puts them. Home sits between
          them on the hardware and is left out here: the television answers it, and an
          application drawing a button that does nothing would only mislead. */}
      <div className="pad-trio">
        <button
          type="button"
          tabIndex={-1}
          className="pad-round"
          onClick={() => sendKey(KEY.BACK)}
          aria-label={t("common.returnKey")}
        >
          <Icon name="return" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="pad-round"
          onClick={() => sendKey(KEY.PLAY_PAUSE)}
          aria-label={t("common.playPause")}
        >
          <Icon name="play" />
        </button>
      </div>
    </div>
  );
}
