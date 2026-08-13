import { useCallback, useEffect, useRef, useState } from "react";
import { KEY, sendKey } from "../hooks/useRemote";

/**
 * A Samsung Smart Remote on screen, for developing without a TV in front of you.
 *
 * Modelled on the TM2360E, the remote that ships with current sets, because testing
 * against the real hardware layout is the point: it has no number keys, no coloured keys
 * and no scan keys, so an app that needs them has to earn them through the 123 button,
 * exactly as a viewer would. Pressing 123 here raises the same on-screen keypad the TV
 * does, and that is where the digits, the coloured keys and the rest of the transport set
 * live.
 *
 * Buttons the television handles rather than the application, power, the microphone, home
 * and the volume rocker, are drawn but inert. They are here so the silhouette is right and
 * so it is obvious at a glance which keys an app can never see.
 *
 * Debug only, and now genuinely absent rather than merely hidden.
 *
 * The gate used to allow `?remote` in a production build, so the component and its two
 * hundred lines of markup were bundled into the signed widget and could be summoned on a
 * television by anyone who put the word in the address. It was also looser than it read:
 * `search.includes("remote")` matches ?remotely=1 and any other parameter containing the
 * word. Testing import.meta.env.DEV first means the bundler replaces this with `false` for
 * a production build and drops the whole component, which on a set with a 120 MB heap is
 * worth more than the convenience of a query string nobody uses on hardware.
 */

export const remoteVisible = (): boolean => {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).has("remote")) return true;
  return !("webapis" in window);
};

const NAMES: Record<number, string> = {
  [KEY.LEFT]: "Left", [KEY.UP]: "Up", [KEY.RIGHT]: "Right", [KEY.DOWN]: "Down",
  [KEY.ENTER]: "Select", [KEY.BACK]: "Return",
  [KEY.CH_UP]: "Channel up", [KEY.CH_DOWN]: "Channel down",
  [KEY.RED]: "Red", [KEY.GREEN]: "Green", [KEY.YELLOW]: "Yellow", [KEY.BLUE]: "Blue",
  [KEY.PLAY_PAUSE]: "Play/Pause", [KEY.PLAY]: "Play", [KEY.PAUSE]: "Pause",
  [KEY.STOP]: "Stop", [KEY.REWIND]: "Rewind", [KEY.FORWARD]: "Fast forward",
  [KEY.PREV]: "Track previous", [KEY.NEXT]: "Track next",
};

export function SmartRemote() {
  const [open, setOpen] = useState(true);
  const [keypad, setKeypad] = useState(false);
  const [last, setLast] = useState("");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);

  const send = useCallback((code: number, label?: string) => {
    setLast(label ?? NAMES[code] ?? String(code));
    sendKey(code);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // A press must not move the browser's focus, or the app loses the element the remote is
  // meant to be steering.
  const key = (code: number, label?: string) => ({
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => send(code, label),
  });

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  if (!open) {
    return (
      <button type="button" className="remote-open" onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOpen(true)}>
        Smart Remote
      </button>
    );
  }

  return (
    <div className="remote-stage" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <div className="remote-hud">
        <span className="remote-last">{last || "No key yet"}</span>
        <button type="button" className="remote-hide" onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(false)} aria-label="Hide the remote">&times;</button>
      </div>

      {/* The keypad the 123 button raises on a real set, holding everything the hardware
          dropped when it went minimal. */}
      {keypad && (
        <div className="keypad">
          <p className="keypad-title">On-screen keypad</p>
          <div className="keypad-colours">
            <button className="ck red" {...key(KEY.RED)} aria-label="Red" />
            <button className="ck green" {...key(KEY.GREEN)} aria-label="Green" />
            <button className="ck yellow" {...key(KEY.YELLOW)} aria-label="Yellow" />
            <button className="ck blue" {...key(KEY.BLUE)} aria-label="Blue" />
          </div>
          <div className="keypad-digits">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button key={n} className="dk" {...key(48 + n, `Digit ${n}`)}>{n}</button>
            ))}
            <span />
            <button className="dk" {...key(48, "Digit 0")}>0</button>
            <span />
          </div>
          <div className="keypad-transport">
            <button className="dk" {...key(KEY.REWIND)} aria-label="Rewind">{"\u23EA"}</button>
            <button className="dk" {...key(KEY.STOP)} aria-label="Stop">{"\u25A0"}</button>
            <button className="dk" {...key(KEY.FORWARD)} aria-label="Fast forward">{"\u23E9"}</button>
            <button className="dk" {...key(KEY.PREV)} aria-label="Track previous">{"\u23EE"}</button>
            <button className="dk" {...key(KEY.PLAY)} aria-label="Play">{"\u25B6"}</button>
            <button className="dk" {...key(KEY.NEXT)} aria-label="Track next">{"\u23ED"}</button>
          </div>
        </div>
      )}

      <div className="remote" onPointerDown={startDrag}>
        {/* Power. The set owns it, so it is drawn and does nothing. */}
        <div className="remote-top">
          <span className="rk-power" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round">
              <path d="M12 3.5v8" /><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" />
            </svg>
          </span>
        </div>

        <div className="remote-assist">
          <button type="button" className="rk-123" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setKeypad((k) => !k)} aria-pressed={keypad}
                  title="Raise the on-screen keypad">
            <span className="rk-123-dots"><i /><i /><i /><i /></span>
            <span className="rk-123-label">123</span>
          </button>
          <span className="rk-mic-hole" aria-hidden="true">MIC</span>
          <span className="rk-mic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11.5a6 6 0 0 0 12 0h1.6a7.6 7.6 0 0 1-6.8 7.55V22h-1.6v-2.95A7.6 7.6 0 0 1 4.4 11.5Z" />
            </svg>
          </span>
        </div>

        {/* The navigation ring. The physical one is a smooth wheel with no printed arrows,
            so the chevrons here stay faint until the pointer finds them. */}
        <div className="dpad">
          <button type="button" className="dp up" {...key(KEY.UP)} aria-label="Up">
            <i className="chev" />
          </button>
          <button type="button" className="dp right" {...key(KEY.RIGHT)} aria-label="Right">
            <i className="chev" />
          </button>
          <button type="button" className="dp down" {...key(KEY.DOWN)} aria-label="Down">
            <i className="chev" />
          </button>
          <button type="button" className="dp left" {...key(KEY.LEFT)} aria-label="Left">
            <i className="chev" />
          </button>
          <button type="button" className="dp ok" {...key(KEY.ENTER)} aria-label="Select" />
        </div>

        <div className="remote-trio">
          <button type="button" className="rk-round" {...key(KEY.BACK)} aria-label="Return">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6.5L4.5 11 9 15.5" /><path d="M4.5 11h9a6 6 0 0 1 0 12h-2" />
            </svg>
          </button>
          {/* Home returns to the Smart Hub. The television does that itself, and an app
              that put a confirmation in the way of it would be wrong. */}
          <span className="rk-round inert" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.5 10.5L12 3.5l8.5 7" /><path d="M5.5 9.6V20h13V9.6" />
            </svg>
          </span>
          <button type="button" className="rk-round" {...key(KEY.PLAY_PAUSE)}
                  aria-label="Play or pause">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 4.5l9 7.5-9 7.5z" />
              <rect x="15" y="4.5" width="2.4" height="15" rx="1" />
              <rect x="19.2" y="4.5" width="2.4" height="15" rx="1" />
            </svg>
          </button>
        </div>

        <div className="remote-rockers">
          {/* Volume belongs to the television, never to the application. */}
          <span className="rocker inert" aria-hidden="true">
            <b>+</b><i /><b>&minus;</b>
          </span>
          <span className="rocker-label" aria-hidden="true">CC/AD</span>
          <span className="rocker">
            <button type="button" className="rock" {...key(KEY.CH_UP)} aria-label="Channel up">
              &#8963;
            </button>
            <i />
            <button type="button" className="rock" {...key(KEY.CH_DOWN)} aria-label="Channel down">
              &#8964;
            </button>
          </span>
        </div>

        {/* The partner app shortcuts. Left blank rather than carrying other people's
            trademarks into an open source repository, and inert either way. */}
        <div className="remote-apps" aria-hidden="true">
          <span className="rk-app" /><span className="rk-app" /><span className="rk-app" />
        </div>
        <div className="remote-apps one" aria-hidden="true"><span className="rk-app" /></div>

        <p className="remote-brand" aria-hidden="true">SAMSUNG</p>
      </div>
    </div>
  );
}
