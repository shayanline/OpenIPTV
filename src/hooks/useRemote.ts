import { useEffect } from "react";

/**
 * Samsung remote key codes. The arrows and Enter match a desktop keyboard, so the whole
 * app is navigable in Chrome with the arrow keys, which is what makes development on a
 * laptop practical.
 *
 * Return, 10009, is the physical back button. Tizen does not fire it at all unless the
 * app registers for it first, which registerKeys below does.
 */
export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 10009,
  PLAY_PAUSE: 10252,
  CH_UP: 427,
  CH_DOWN: 428,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  ESC: 27,
} as const;

interface TizenInputDevice {
  registerKey(name: string): void;
}

export function registerRemoteKeys() {
  const tizen = (window as unknown as {
    tizen?: { tvinputdevice?: TizenInputDevice };
  }).tizen;
  const device = tizen?.tvinputdevice;
  if (!device) return;
  // Only the keys actually handled. Registering the whole set steals volume and power
  // from the system, which is a good way to make a TV feel broken.
  for (const name of ["ChannelUp", "ChannelDown", "MediaPlayPause", "ColorF0Red", "ColorF1Green"]) {
    try {
      device.registerKey(name);
    } catch {
      // A key the model does not have is not an error worth surfacing.
    }
  }
}

export function useRemote(handler: (code: number, event: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handler(e.keyCode, e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler]);
}
