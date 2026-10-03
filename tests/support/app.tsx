import { act, render } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import type { LocalePreference } from "../../src/services/locale";
import type { PlaylistSource } from "../../src/services/playlistUrl";

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
export let playCalls: unknown[][] = [];
export let seekChanges: number[] = [];
export let muted = false;
export let volumeChanges: number[] = [];
let playbackPosition = 0;
let playbackDuration = 120;
let playbackEvent: ((event: unknown) => void) | null = null;

export function setPlaybackTime(position: number, duration = 120) {
  playbackPosition = position;
  playbackDuration = duration;
}

export function finishPlayback() {
  act(() => playbackEvent?.({ type: "ended" }));
}

export const XTREAM_SOURCE: PlaylistSource = {
  kind: "xtream",
  server: "http://provider.example",
  username: "viewer",
  password: "secret",
  output: "m3u8",
};

export const xtreamFetch =
  (
    categories: Array<{ category_id: string; category_name: string }>,
    streams: Array<Record<string, unknown>>,
  ) =>
  async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action");
    const body =
      action === "get_live_categories"
        ? categories
        : action === "get_live_streams"
          ? streams
          : action === "get_vod_categories" || action === "get_series_categories"
            ? []
            : {
                user_info: { auth: 1, status: "Active" },
                server_info: { server_protocol: "http", url: "provider.example" },
              };
    return { ok: true, status: 200, json: async () => body };
  };

/** Presses a key the way the remote does, by keyCode, which is what the app listens for. */
function keyEvent(type: "keydown" | "keyup", code: number) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => code });
  Object.defineProperty(event, "which", { get: () => code });
  window.dispatchEvent(event);
}

export function pressDown(code: number, repeat = false) {
  act(() => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, repeat });
    Object.defineProperty(event, "keyCode", { get: () => code });
    Object.defineProperty(event, "which", { get: () => code });
    window.dispatchEvent(event);
  });
}

export function release(code: number) {
  act(() => keyEvent("keyup", code));
}

export function press(code: number) {
  act(() => {
    keyEvent("keydown", code);
    keyEvent("keyup", code);
  });
}

export async function hold(code: number, ms = 600) {
  pressDown(code);
  await settle(ms);
  release(code);
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
  playbackStats?: boolean;
  faultPicture?: boolean;
  seekFails?: boolean;
  locale?: LocalePreference;
  hiddenCategories?: string[];
  hiddenCategoryMode?: "exclude" | "search";
  source?: PlaylistSource;
  fetchImplementation?: (input: string | URL, init?: RequestInit) => Promise<unknown>;
}

export async function mountApp(
  playlist: string,
  {
    resume,
    awaitPlaylist = true,
    slowPicture = 0,
    playbackStats = false,
    faultPicture = false,
    seekFails = false,
    locale,
    hiddenCategories = [],
    hiddenCategoryMode = "exclude",
    source,
    fetchImplementation,
  }: MountOptions = {},
) {
  if (!vi.isFakeTimers()) vi.useFakeTimers();
  vi.resetModules();
  played = [];
  playCalls = [];
  seekChanges = [];
  muted = false;
  volumeChanges = [];
  playbackPosition = 0;
  playbackDuration = 120;
  playbackEvent = null;

  vi.doMock("../../src/services/player", () => ({
    onTizen: () => false,
    Player: class {
      constructor(public emit: (e: unknown) => void) {
        playbackEvent = emit;
      }
      attach() {}
      detach() {}
      stop() {}
      hide() {}
      show() {}
      pause() {}
      resumePlayback() {}
      getPosition() {
        return playbackPosition;
      }
      getDuration() {
        return playbackDuration;
      }
      seekBy(delta: number) {
        seekChanges.push(delta);
        if (seekFails) return Promise.resolve(false);
        playbackPosition = Math.max(0, Math.min(playbackDuration, playbackPosition + delta));
        return Promise.resolve(true);
      }
      setMuted(value: boolean) {
        muted = value;
      }
      adjustVolume(delta: number) {
        volumeChanges.push(delta);
      }
      setFit() {}
      getStats() {
        return {
          engine: "hls.js",
          width: 1920,
          height: 1080,
          scan: "progressive",
          videoCodec: "avc1.640028",
          audioCodec: "mp4a.40.2",
          bitrate: 4_500_000,
          bandwidth: 6_200_000,
          bufferSeconds: 12.4,
          frameRate: 50,
          droppedFrames: 2,
          totalFrames: 1000,
          level: 3,
          levels: 5,
          switches: 2,
        };
      }
      play(url: string, ...options: unknown[]) {
        played.push(url);
        playCalls.push([url, ...options]);
        // A picture arrives at once, so the tests are about the interface rather than about
        // waiting, unless a test has asked for a channel that takes a moment to join.
        if (faultPicture) this.emit({ type: "error", code: "TEST_FAILURE" });
        else if (slowPicture) setTimeout(() => this.emit({ type: "playing" }), slowPicture);
        else this.emit({ type: "playing" });
      }
      resumeLive(url: string) {
        this.play(url);
      }
      resume(url: string) {
        this.resumeLive(url);
      }
    },
  }));

  localStorage.setItem(
    "openiptv.settings",
    JSON.stringify({
      playlists: [
        {
          id: "pl-1",
          name: "Test",
          ...(source ? { source, sourceVersion: 1 } : { url: "http://list.invalid/a.m3u" }),
          hiddenCategories,
          hiddenCategoryMode,
        },
      ],
      activePlaylistId: "pl-1",
      resumeLast: !!resume,
      showPlaybackStats: playbackStats,
      ...(locale ? { locale } : {}),
    }),
  );
  // Written before the app mounts, because App decides which view to open on during its very
  // first render by reading this. That is the whole point of it: deciding later meant the
  // panel opened and was then closed again, in front of the viewer.
  if (resume) localStorage.setItem("openiptv.last", resume);
  vi.stubGlobal(
    "fetch",
    fetchImplementation
      ? vi.fn(fetchImplementation)
      : vi.fn().mockResolvedValue({ ok: true, text: async () => playlist }),
  );

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
