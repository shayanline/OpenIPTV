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
  CH_UP: 427,
  CH_DOWN: 428,
  VOL_UP: 448,
  VOL_DOWN: 449,
  ESC: 27,

  // The coloured keys. Only green and yellow are registered and acted on, but all four
  // are named because the debug remote offers the full set: a key the app deliberately
  // ignores is worth being able to press.
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,

  // Transport. Checklist 2.3 requires every playback button on the remote to control
  // playback correctly, so the whole set is handled, not just the Smart Remote's single
  // PLAY/PAUSE. The standard remote splits play and pause onto separate keys, and a long
  // press of rewind or fast forward arrives as the track keys.
  PLAY_PAUSE: 10252,
  PLAY: 415,
  PAUSE: 19,
  /**
   * Space, which is play and pause on every media player anybody has used in a browser.
   *
   * Only a keyboard sends it, and a keyboard is how this is developed and how it runs on a
   * desktop, so it is mapped to the same place the remote's own key goes. On the television it
   * simply never arrives.
   */
  SPACE: 32,
  STOP: 413,
  REWIND: 412,
  FORWARD: 417,
  PREV: 10232,
  NEXT: 10233,
} as const;

/**
 * The remote keys the app asks Tizen to deliver.
 *
 * Only keys the app actually handles are registered. Registering the whole set steals
 * volume and power from the system, which is a good way to make a TV feel broken.
 */
const REGISTERED = [
  "ChannelUp", "ChannelDown",
  "MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop",
  "MediaRewind", "MediaFastForward", "MediaTrackPrevious", "MediaTrackNext",
  "ColorF1Green", "ColorF2Yellow",
];

interface TizenInputDevice {
  registerKey(name: string): void;
  getSupportedKeys?: () => { name: string; code: number }[];
}

/**
 * Which of the keys asked for were actually granted, remembered for the diagnostics screen.
 *
 * A key a model does not have is not an error and must not interrupt anybody, so the
 * failure is swallowed. Swallowed and forgotten are different things, though: the set of
 * keys differs by model year and by which remote came in the box, and "the yellow button
 * does nothing on my television" is unanswerable from here without knowing whether the
 * platform ever handed it over. So the outcome is kept, and Settings can show it.
 */
export interface KeyGrant {
  name: string;
  granted: boolean;
}

let grants: KeyGrant[] = [];

/** What happened the last time keys were registered. Empty off a television. */
export const keyGrants = (): readonly KeyGrant[] => grants;

/** Every key the model claims to have, which is not the same as the ones this app wants. */
export function supportedKeys(): string[] {
  const device = (window as unknown as {
    tizen?: { tvinputdevice?: TizenInputDevice };
  }).tizen?.tvinputdevice;
  try {
    return device?.getSupportedKeys?.().map((k) => k.name) ?? [];
  } catch {
    return [];
  }
}

export function registerRemoteKeys() {
  const tizen = (window as unknown as {
    tizen?: { tvinputdevice?: TizenInputDevice };
  }).tizen;
  const device = tizen?.tvinputdevice;
  if (!device) return;
  grants = REGISTERED.map((name) => {
    try {
      device.registerKey(name);
      return { name, granted: true };
    } catch {
      return { name, granted: false };
    }
  });
}

/**
 * Send the key a remote would send.
 *
 * The on-screen pad and the development remote both press buttons on the viewer's behalf, and
 * both do it by dispatching a real key event rather than by calling into the app, so there is
 * one set of behaviour to reason about instead of two. Left opens the channel list because left
 * opens the channel list, not because a button knows anything about panels.
 *
 * One trick, and it is why this is worth a function rather than two copies: `keyCode` is a
 * legacy accessor and the KeyboardEvent constructor ignores it, so setting it in the init
 * dictionary silently produces a zero. Defining it on the instance is what works.
 */
export function sendKey(code: number) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => code });
  Object.defineProperty(event, "which", { get: () => code });
  window.dispatchEvent(event);
}

export function useRemote(handler: (code: number, event: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handler(e.keyCode, e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler]);
}
