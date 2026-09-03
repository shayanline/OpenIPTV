import { act, render } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { LocalePreference } from "../../src/services/locale";

afterEach(() => vi.useRealTimers());

/**
 * Mount the whole application against a playlist, with the player replaced.
 *
 * Shared because more than one thing worth asserting is only true of the app as a whole:
 * which key does what, and where the highlight is left after the lists underneath it change
 * shape. Both need a real render, a real store and a playlist that has actually arrived.
 *
 * The player is the one thing that cannot be real. It reaches for AVPlay or hls.js and a
 * decoder, none of which exist here, so it is replaced by a stand in that records what it
 * was asked to play and reports a picture at once. Every test using this is about what the
 * interface does with a channel, not about whether the channel plays.
 */

/** What the player was asked to play, in order, so a channel change can be observed. */
export let played: string[] = [];
export let muted = false;
export let volumeChanges: number[] = [];

/** Presses a key the way the remote does, by keyCode, which is what the app listens for. */
export function press(code: number) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => code });
  Object.defineProperty(event, "which", { get: () => code });
  act(() => {
    window.dispatchEvent(event);
  });
}

/** Whether the channel panel is open, which the app expresses by removing the away class. */
export const panelOpen = () => !document.querySelector(".panel")?.classList.contains("away");

/**
 * Let a debounce land.
 *
 * The interface deliberately answers some keys in two stages, so that holding one down is
 * not thirty times the work of pressing it once: the rail cursor moves on the press and the
 * channel column follows once the pressing stops. A test that asserts on the column has to
 * wait for the second stage, and one that asserts on the cursor must not.
 */
export async function settle(ms = 260) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export interface MountOptions {
  /** Resume the last watched channel, with the id to remember as having been on. */
  resume?: string;
  /**
   * Whether to wait for the playlist to land before returning.
   *
   * Almost everything wants to, and asserts on a running application. The exception is
   * anything about what the very first render looks like, where waiting is the difference
   * between "the panel is never open" and "the panel ends up closed", and the second of
   * those was the old behaviour.
   */
  awaitPlaylist?: boolean;
  /**
   * How long the stand in player takes to report a picture, in milliseconds.
   *
   * Zero, and synchronous, for almost everything: those tests are about which key does what and
   * waiting would only make them slow. But a channel that arrives in the same tick as the request
   * never leaves the app visibly busy, and some behaviour only exists while it is: the banner is
   * held without a countdown for exactly that period, which is where it was found staying up for
   * ever. Anything asserting on that has to let the channel take a moment, as a real one does.
   */
  slowPicture?: number;
  locale?: LocalePreference;
}

export async function mountApp(
  playlist: string,
  { resume, awaitPlaylist = true, slowPicture = 0, locale }: MountOptions = {},
) {
  if (!vi.isFakeTimers()) vi.useFakeTimers();
  vi.resetModules();
  played = [];
  muted = false;
  volumeChanges = [];

  vi.doMock("../../src/services/player", () => ({
    onTizen: () => false,
    Player: class {
      constructor(public emit: (e: unknown) => void) {}
      attach() {}
      detach() {}
      stop() {}
      hide() {}
      show() {}
      pause() {}
      setMuted(value: boolean) {
        muted = value;
      }
      adjustVolume(delta: number) {
        volumeChanges.push(delta);
      }
      setFit() {}
      play(url: string) {
        played.push(url);
        // A picture arrives at once, so the tests are about the interface rather than about
        // waiting, unless a test has asked for a channel that takes a moment to join.
        if (slowPicture) setTimeout(() => this.emit({ type: "playing" }), slowPicture);
        else this.emit({ type: "playing" });
      }
      resume(url: string) {
        this.play(url);
      }
    },
  }));

  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      playlists: [{ id: "pl-1", name: "Test", url: "http://list.invalid/a.m3u" }],
      activePlaylistId: "pl-1",
      resumeLast: !!resume,
      ...(locale ? { locale } : {}),
    }),
  );
  // Written before the app mounts, because App decides which view to open on during its very
  // first render by reading this. That is the whole point of it: deciding later meant the
  // panel opened and was then closed again, in front of the viewer.
  if (resume) localStorage.setItem("openiptv.last", resume);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => playlist }));

  const { default: App } = await import("../../src/App");
  const view = render(<App />);
  if (!awaitPlaylist) return view;
  // Let the playlist land.
  await act(async () => {
    await Promise.resolve();
  });
  await settle(0);
  return view;
}
