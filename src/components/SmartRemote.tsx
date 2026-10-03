import { useCallback, useEffect, useRef, useState } from "react";
import { KEY, sendKey, sendKeyDown, sendKeyUp } from "../hooks/useRemote";
import { Icon } from "./Icon";

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
 * Buttons the television handles rather than the application, power, the microphone and home,
 * are drawn but inert. Volume is wired in the browser through the media player and on Tizen
 * through the TV audio API, while channel up and down send the same codes as the physical remote.
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
  [KEY.LEFT]: "Left",
  [KEY.UP]: "Up",
  [KEY.RIGHT]: "Right",
  [KEY.DOWN]: "Down",
  [KEY.ENTER]: "Select",
  [KEY.BACK]: "Return",
  [KEY.CH_UP]: "Channel up",
  [KEY.CH_DOWN]: "Channel down",
  [KEY.VOL_UP]: "Volume up",
  [KEY.VOL_DOWN]: "Volume down",
  [KEY.RED]: "Red",
  [KEY.GREEN]: "Green",
  [KEY.YELLOW]: "Yellow",
  [KEY.BLUE]: "Blue",
  [KEY.PLAY_PAUSE]: "Play/Pause",
  [KEY.PLAY]: "Play",
  [KEY.PAUSE]: "Pause",
  [KEY.STOP]: "Stop",
  [KEY.REWIND]: "Rewind",
  [KEY.FORWARD]: "Fast forward",
  [KEY.PREV]: "Track previous",
  [KEY.NEXT]: "Track next",
};

export function SmartRemote() {
  const [open, setOpen] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [last, setLast] = useState("");
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const activeKey = useRef<number | null>(null);
  const repeatDelay = useRef<number | undefined>(undefined);
  const repeatTimer = useRef<number | undefined>(undefined);

  const send = useCallback((code: number, label?: string) => {
    setLast(label ?? NAMES[code] ?? String(code));
    sendKey(code);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const releaseKey = useCallback((code?: number) => {
    window.clearTimeout(repeatDelay.current);
    window.clearInterval(repeatTimer.current);
    repeatDelay.current = undefined;
    repeatTimer.current = undefined;
    const releasing = code ?? activeKey.current;
    if (releasing !== null) sendKeyUp(releasing);
    activeKey.current = null;
  }, []);

  useEffect(() => () => releaseKey(), [releaseKey]);

  // A press must not move the browser's focus, or the app loses the element the remote is
  // meant to be steering. Pointer capture keeps a held key alive when the pointer drifts.
  const key = (code: number, label?: string) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      releaseKey();
      setLast(label ?? NAMES[code] ?? String(code));
      activeKey.current = code;
      sendKeyDown(code);
      repeatDelay.current = window.setTimeout(() => {
        repeatTimer.current = window.setInterval(() => sendKeyDown(code), 120);
      }, 400);
    },
    onPointerUp: () => releaseKey(code),
    onPointerCancel: () => releaseKey(code),
    onClick: (event: React.MouseEvent) => {
      if (event.detail === 0) send(code, label);
    },
  });
  const redKey = key(KEY.RED, "Red");
  const okKey = key(KEY.ENTER, "Select");

  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };

  if (!open) {
    return (
      <button
        type="button"
        className="remote-open"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen(true)}
        aria-label="Show Smart Remote"
      >
        Smart Remote
      </button>
    );
  }

  return (
    <div className="remote-stage" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
      <div className="remote-hud">
        <span className="remote-last">{last || "No key yet"}</span>
        <button
          type="button"
          className="remote-hide"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(false)}
          aria-label="Hide the remote"
        >
          &times;
        </button>
      </div>

      {/* The keypad the 123 button raises on a real set, holding everything the hardware
          dropped when it went minimal. */}
      {keypad && (
        <div className="keypad">
          <p className="keypad-title">On-screen keypad</p>
          <div className="keypad-colours">
            <button type="button" className="ck red" {...redKey} aria-label="Red" />
            <button type="button" className="ck green" {...key(KEY.GREEN)} aria-label="Green" />
            <button
              type="button"
              className="ck yellow"
              {...key(KEY.YELLOW)}
              aria-label="Yellow"
            />
            <button type="button" className="ck blue" {...key(KEY.BLUE)} aria-label="Blue" />
          </div>
          <div className="keypad-digits">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button type="button" key={n} className="dk" {...key(48 + n, `Digit ${n}`)}>
                {n}
              </button>
            ))}
            <span />
            <button type="button" className="dk" {...key(48, "Digit 0")}>
              0
            </button>
            <span />
          </div>
          <div className="keypad-transport">
            <button type="button" className="dk" {...key(KEY.REWIND)} aria-label="Rewind">
              <Icon name="rewind" />
            </button>
            <button type="button" className="dk" {...key(KEY.STOP)} aria-label="Stop">
              <Icon name="stop" />
            </button>
            <button
              type="button"
              className="dk"
              {...key(KEY.FORWARD)}
              aria-label="Fast forward"
            >
              <Icon name="forward" />
            </button>
            <button type="button" className="dk" {...key(KEY.PREV)} aria-label="Track previous">
              <Icon name="previous" />
            </button>
            <button type="button" className="dk" {...key(KEY.PLAY)} aria-label="Play">
              <Icon name="play" />
            </button>
            <button type="button" className="dk" {...key(KEY.NEXT)} aria-label="Track next">
              <Icon name="next" />
            </button>
          </div>
        </div>
      )}

      <div className="remote" onPointerDown={startDrag}>
        {/* Power. The set owns it, so it is drawn and does nothing. */}
        <div className="remote-top">
          <span className="rk-power" aria-hidden="true">
            <Icon name="power" />
          </span>
        </div>

        <div className="remote-assist">
          <button
            type="button"
            className="rk-123"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setKeypad((k) => !k)}
            aria-pressed={keypad}
            title="Raise the on-screen keypad"
          >
            <span className="rk-123-dots">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="rk-123-label">123</span>
          </button>
          <span className="rk-mic-hole" aria-hidden="true">
            MIC
          </span>
          <span className="rk-mic" aria-hidden="true">
            <Icon name="mic" />
          </span>
        </div>

        {/* The navigation ring. The physical one is a smooth wheel with no printed arrows,
            so the chevrons here stay faint until the pointer finds them. */}
        <div className="dpad">
          <button type="button" className="dp up" {...key(KEY.UP)} aria-label="Up">
            <Icon name="chevronUp" />
          </button>
          <button type="button" className="dp right" {...key(KEY.RIGHT)} aria-label="Right">
            <Icon name="chevronRight" />
          </button>
          <button type="button" className="dp down" {...key(KEY.DOWN)} aria-label="Down">
            <Icon name="chevronDown" />
          </button>
          <button type="button" className="dp left" {...key(KEY.LEFT)} aria-label="Left">
            <Icon name="chevronLeft" />
          </button>
          <button type="button" className="dp ok" {...okKey} aria-label="Select" />
        </div>

        <div className="remote-trio">
          <button type="button" className="rk-round" {...key(KEY.BACK)} aria-label="Return">
            <Icon name="return" />
          </button>
          {/* Home returns to the Smart Hub. The television does that itself, and an app
              that put a confirmation in the way of it would be wrong. */}
          <span className="rk-round inert" aria-hidden="true">
            <Icon name="home" />
          </span>
          <button
            type="button"
            className="rk-round"
            {...key(KEY.PLAY_PAUSE)}
            aria-label="Play or pause"
          >
            <Icon name="play" />
          </button>
        </div>

        <div className="remote-rockers">
          <span className="rocker">
            <button type="button" className="rock" {...key(KEY.VOL_UP)} aria-label="Volume up">
              +
            </button>
            <i />
            <button
              type="button"
              className="rock"
              {...key(KEY.VOL_DOWN)}
              aria-label="Volume down"
            >
              &minus;
            </button>
          </span>
          <span className="rocker-label" aria-hidden="true">
            CC/AD
          </span>
          <span className="rocker">
            <button type="button" className="rock" {...key(KEY.CH_UP)} aria-label="Channel up">
              &#8963;
            </button>
            <i />
            <button
              type="button"
              className="rock"
              {...key(KEY.CH_DOWN)}
              aria-label="Channel down"
            >
              &#8964;
            </button>
          </span>
        </div>

        {/* The partner app shortcuts. Left blank rather than carrying other people's
            trademarks into an open source repository, and inert either way. */}
        <div className="remote-apps" aria-hidden="true">
          <span className="rk-app" />
          <span className="rk-app" />
          <span className="rk-app" />
        </div>
        <div className="remote-apps one" aria-hidden="true">
          <span className="rk-app" />
        </div>

        <p className="remote-brand" aria-hidden="true">
          SAMSUNG
        </p>
      </div>
    </div>
  );
}
