import { useRef, useState } from "react";
import { KEY, sendKey } from "../hooks/useRemote";

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

export function PointerPad({ shown }: { shown: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
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
    const limit = (value: number, span: number, max: number) =>
      Math.max(EDGE, Math.min(value, max - span - EDGE));
    setAt({
      x: limit(e.clientX - drag.current.dx, WIDTH, window.innerWidth),
      y: limit(e.clientY - drag.current.dy, HEIGHT, window.innerHeight),
    });
  };

  const end = (e: React.PointerEvent) => {
    drag.current = null;
    shell.current?.releasePointerCapture(e.pointerId);
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
        <button type="button" tabIndex={-1} className="pad-dir pad-up"
                onClick={() => sendKey(KEY.UP)} aria-label="Up"><i className="chev" /></button>
        <button type="button" tabIndex={-1} className="pad-dir pad-right"
                onClick={() => sendKey(KEY.RIGHT)} aria-label="Right"><i className="chev" /></button>
        <button type="button" tabIndex={-1} className="pad-dir pad-down"
                onClick={() => sendKey(KEY.DOWN)} aria-label="Down"><i className="chev" /></button>
        <button type="button" tabIndex={-1} className="pad-dir pad-left"
                onClick={() => sendKey(KEY.LEFT)} aria-label="Left"><i className="chev" /></button>
        <button type="button" tabIndex={-1} className="pad-ok"
                onClick={() => sendKey(KEY.ENTER)} aria-label="Select">OK</button>
      </div>

      {/* Return and Play, in the places and the order the remote puts them. Home sits between
          them on the hardware and is left out here: the television answers it, and an
          application drawing a button that does nothing would only mislead. */}
      <div className="pad-trio">
        <button type="button" tabIndex={-1} className="pad-round" onClick={() => sendKey(KEY.BACK)}
                aria-label="Return">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
               strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6.5L4.5 11 9 15.5" /><path d="M4.5 11h9a6 6 0 0 1 0 12h-2" />
          </svg>
        </button>
        <button type="button" tabIndex={-1} className="pad-round"
                onClick={() => sendKey(KEY.PLAY_PAUSE)} aria-label="Play or pause">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M4 4.5l9 7.5-9 7.5z" />
            <rect x="15" y="4.5" width="2.4" height="15" rx="1" />
            <rect x="19.2" y="4.5" width="2.4" height="15" rx="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
