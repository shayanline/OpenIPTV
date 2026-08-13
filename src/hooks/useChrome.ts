import { useCallback, useEffect, useRef, useState } from "react";

/*
 * Everything transient on the picture, and the timers that take it away again.
 *
 * The banner naming the channel, a passing message, and a channel number being dialled. They
 * are one thing rather than three because RETURN treats them as one thing, and because each
 * of them was a piece of state and a timer kept beside it in a component that had twenty
 * other pairs.
 *
 * Every duration is on the generous side of the guidance rather than the tight side. Somebody
 * who reads a channel name in two seconds and somebody who reads it in six are both watching
 * this, and the cost of a caption outstaying its welcome is that it is on screen a moment
 * longer, while the cost of it leaving early is that the viewer never found out what they
 * were looking at. Nothing here has to be waited out either: RETURN clears the screen at
 * once, so the timeout only decides when it goes if nobody asks.
 */

/** A message with no question in it. The guidance says three seconds. */
const TOAST_MS = 4000;

/**
 * How long the banner stays up announcing a channel with nothing pressed.
 *
 * The media player guidance fixes five seconds for on-screen *controls*. There are none:
 * this is a caption naming the channel, which is read rather than operated, and five seconds
 * is not long for somebody who has just changed channel and looked up.
 */
const NOTICE_MS = 8000;

/**
 * How long a dialled number waits for another digit.
 *
 * Two seconds rather than one, because typing 1 0 2 on a remote takes longer than that if
 * you are looking at the keypad between presses, and a number cut in half tunes to a channel
 * nobody asked for. OK ends it early, RETURN abandons it.
 */
const DIGIT_WAIT_MS = 2000;

export interface Chrome {
  banner: boolean;
  toast: string;
  digits: string;
  /** Whether anything transient is on screen, which is what decides what RETURN means. */
  showing: boolean;
  /** Raise the banner, and start its welcome over. */
  raiseBanner: () => void;
  /** Hold the banner up with no countdown, for as long as something is still happening. */
  holdBanner: () => void;
  lowerBanner: () => void;
  say: (message: string) => void;
  /** Add a digit to the number being dialled, and return the number so far. */
  dial: (digit: number, onSettled: (channel: number) => void) => void;
  /** Finish dialling now, which is what OK means on a half typed number. */
  commitDigits: () => string;
  /**
   * Clear everything transient, in one press, now.
   *
   * Everything, rather than the topmost thing. A viewer who wants the screen clean does not
   * know or care which of the overlays is on top, and pressing RETURN four times to remove
   * four things they think of as one thing reads as the button being broken.
   */
  clear: () => void;
}

export function useChrome(): Chrome {
  const [banner, setBanner] = useState(false);
  const [toast, setToast] = useState("");
  const [digits, setDigits] = useState("");

  const noticeTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const digitTimer = useRef<number | undefined>(undefined);
  /** The digits as they are now, for presses arriving faster than React re-renders. */
  const dialled = useRef("");

  useEffect(() => () => {
    window.clearTimeout(noticeTimer.current);
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(digitTimer.current);
  }, []);

  const raiseBanner = useCallback(() => {
    setBanner(true);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setBanner(false), NOTICE_MS);
  }, []);

  const holdBanner = useCallback(() => {
    window.clearTimeout(noticeTimer.current);
    setBanner(true);
  }, []);

  const lowerBanner = useCallback(() => {
    window.clearTimeout(noticeTimer.current);
    setBanner(false);
  }, []);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), TOAST_MS);
  }, []);

  const dial = useCallback((digit: number, onSettled: (channel: number) => void) => {
    const next = (dialled.current + String(digit)).slice(-4);
    dialled.current = next;
    setDigits(next);
    window.clearTimeout(digitTimer.current);
    digitTimer.current = window.setTimeout(() => {
      dialled.current = "";
      setDigits("");
      onSettled(Number(next));
    }, DIGIT_WAIT_MS);
  }, []);

  const commitDigits = useCallback(() => {
    const typed = dialled.current;
    window.clearTimeout(digitTimer.current);
    dialled.current = "";
    setDigits("");
    return typed;
  }, []);

  const clear = useCallback(() => {
    window.clearTimeout(noticeTimer.current);
    window.clearTimeout(toastTimer.current);
    window.clearTimeout(digitTimer.current);
    dialled.current = "";
    setBanner(false);
    setToast("");
    setDigits("");
  }, []);

  return {
    banner, toast, digits,
    showing: banner || !!toast || !!digits,
    raiseBanner, holdBanner, lowerBanner, say, dial, commitDigits, clear,
  };
}
