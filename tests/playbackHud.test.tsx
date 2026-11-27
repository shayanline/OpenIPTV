import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PictureState } from "../src/components/PictureState";
import { PlaybackInfo } from "../src/components/PlaybackInfo";
import {
  isRecoveryStatusVisible,
  RecoveryStatus,
} from "../src/components/playback/RecoveryStatus";
import { KEY } from "../src/hooks/useRemote";
import type { RecoveryState } from "../src/services/playbackRecovery";
import type { MediaTrack } from "../src/types";
import {
  emitPlayback,
  finishPlayback,
  mountApp,
  pauseCalls,
  playCalls,
  played,
  press,
  seekChanges,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fullSpinnerVisible = () => !!document.querySelector(".picture-state .spinner");
const compactVisible = () => !!document.querySelector(".recovery-status");
const deckSpinnerVisible = () => !!document.querySelector(".playback-deck .spinner");
const spinnerCount = () =>
  document.querySelectorAll(
    ".picture-state .spinner, .recovery-status .spinner, .playback-deck .spinner",
  ).length;

test("picture loading has priority over a requested pause", () => {
  render(
    <PictureState
      channel="Channel"
      busy
      paused
      filling={null}
      waited={0}
      fault=""
      finite={false}
    />,
  );
  expect(fullSpinnerVisible()).toBe(true);
  expect(document.querySelector(".picture-state.paused")).toBeNull();
});

test("a terminal error keeps long names readable without exposing engine diagnostics", () => {
  const channel = "Channel ".repeat(300);
  const fault = `manifestLoadError\n${"unbrokenDiagnostic".repeat(500)}`;
  render(
    <PictureState
      channel={channel}
      busy={false}
      filling={null}
      waited={0}
      fault={fault}
      finite={false}
    />,
  );
  act(() => vi.advanceTimersByTime(500));
  const alert = screen.getByRole("alert");
  const reading = screen.getByRole("region");
  expect(screen.getByRole("heading", { name: "Playback is unavailable." })).toBeTruthy();
  expect(reading.querySelector(".picture-state-channel")?.textContent).toBe(channel);
  expect(reading.querySelector(".picture-state-code")).toBeNull();
  expect(reading.textContent).not.toMatch(
    /manifestLoadError|unbrokenDiagnostic|Tried|off the air/,
  );
  expect(reading.getAttribute("tabindex")).toBe("0");
  expect(alert.querySelector(".picture-state-mark.error .icon-warn")).toBeTruthy();
  const actions = alert.querySelector(".picture-state-keys")!;
  expect(reading.contains(actions)).toBe(false);
  expect(actions.textContent).toContain("All channels");
});

test.each([false, true])(
  "a denied stream reports access failure without format advice when finite is %s",
  (finite) => {
    render(
      <PictureState
        channel="Content"
        busy={false}
        filling={null}
        waited={0}
        fault="PLAYER_ERROR_NOT_SUPPORTED_FILE (http 401)"
        finite={finite}
      />,
    );
    act(() => vi.advanceTimersByTime(500));

    const alert = screen.getByRole("alert");
    expect(
      screen.getByRole("heading", { name: "Access to this stream was denied." }),
    ).toBeTruthy();
    expect(alert.textContent).not.toMatch(/format|decode|401|network|try another|come back/i);
    expect(alert.querySelector(".picture-state-note")).toBeNull();
    expect(alert.querySelector(".picture-state-doing")).toBeNull();
  },
);

test("playback information distinguishes zero dropped frames from a growing total", () => {
  let totalFrames = 759;
  render(
    <PlaybackInfo
      read={() => ({
        engine: "Native HLS",
        switches: 0,
        droppedFrames: 0,
        totalFrames,
      })}
    />,
  );
  act(() => vi.advanceTimersByTime(34));
  expect(screen.getByText("0 dropped / 759 total")).toBeTruthy();
  totalFrames = 783;
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByText("0 dropped / 783 total")).toBeTruthy();
});

test("information paints stable rows before sampling native diagnostics after its entrance", () => {
  const root = document.documentElement.style;
  const previous = root.getPropertyValue("--t-med");
  root.setProperty("--t-med", "250ms");
  try {
    const read = vi.fn(() => ({ engine: "AVPlay" as const, switches: 0 }));
    const view = render(<PlaybackInfo read={read} />);
    const box = document.querySelector(".playback-info")!;
    const rows = box.querySelectorAll("dl > div").length;
    expect(rows).toBeGreaterThan(1);
    expect(read).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(read).not.toHaveBeenCalled();

    const entered = new Event("animationend", { bubbles: true });
    Object.defineProperty(entered, "animationName", { value: "pb-in" });
    fireEvent(box, entered);
    act(() => vi.advanceTimersByTime(34));
    expect(read).toHaveBeenCalledTimes(1);
    expect(box.querySelectorAll("dl > div")).toHaveLength(rows);

    view.rerender(<PlaybackInfo read={read} visible={false} />);
    expect(box.classList.contains("playback-closing")).toBe(true);
    expect(box.getAttribute("aria-hidden")).toBe("true");
    act(() => vi.advanceTimersByTime(1500));
    expect(read).toHaveBeenCalledTimes(1);
    expect(box.classList.contains("visible")).toBe(false);
  } finally {
    if (previous) root.setProperty("--t-med", previous);
    else root.removeProperty("--t-med");
  }
});

test("dismissing information during its entrance cancels its pending native sample", () => {
  const root = document.documentElement.style;
  const previous = root.getPropertyValue("--t-med");
  root.setProperty("--t-med", "250ms");
  try {
    const read = vi.fn(() => ({ engine: "AVPlay" as const, switches: 0 }));
    const view = render(<PlaybackInfo read={read} />);
    act(() => vi.advanceTimersByTime(100));
    view.rerender(<PlaybackInfo read={read} visible={false} />);
    act(() => vi.advanceTimersByTime(1500));
    expect(read).not.toHaveBeenCalled();
  } finally {
    if (previous) root.setProperty("--t-med", previous);
    else root.removeProperty("--t-med");
  }
});

test("initial selection shows the banner and full picture spinner before controls open", async () => {
  await mountApp(PLAYLIST, { slowPicture: 5000 });
  press(KEY.ENTER);
  await settle(0);

  expect(!!document.querySelector(".pb-stack")).toBe(true);
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  press(KEY.RIGHT);
  expect(!!document.querySelector(".playback-deck")).toBe(true);
  expect(deckSpinnerVisible()).toBe(true);
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);
});

test("a played Live channel's reconnect stays compact with no central spinner", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);
  await settle(0);
  expect(spinnerCount()).toBe(0);

  emitPlayback({ type: "buffering-start" });
  await settle(0);
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);

  await settle(1499);
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);

  await settle(1);
  expect(compactVisible()).toBe(true);
  expect(fullSpinnerVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  emitPlayback({ type: "buffering-complete" });
  emitPlayback({ type: "playing" });
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);
});

test("controls own the spinner while a played Live channel recovers from an error", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);
  await settle(0);

  emitPlayback({ type: "error", code: "socket dropped", warmKind: null });
  await settle(0);
  expect(compactVisible()).toBe(true);
  expect(fullSpinnerVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  press(KEY.RIGHT);
  expect(deckSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  expect(fullSpinnerVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  emitPlayback({ type: "playing" });
  expect(deckSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(fullSpinnerVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);
});

const recoveryState: RecoveryState = {
  stage: "buffering",
  cause: "reported-buffer",
  attempt: 0,
  retryIn: 0,
  statusVisible: true,
  hasPlayed: true,
  continuous: false,
  fault: null,
};

const visibilityCases: Array<{
  stage: RecoveryState["stage"];
  hidden: boolean;
  statusVisible: boolean;
  visible: boolean;
}> = [
  { stage: "buffering", hidden: true, statusVisible: true, visible: false },
  { stage: "buffering", hidden: false, statusVisible: false, visible: false },
  { stage: "idle", hidden: false, statusVisible: true, visible: false },
  { stage: "terminal", hidden: false, statusVisible: true, visible: false },
  { stage: "buffering", hidden: false, statusVisible: true, visible: true },
  { stage: "warm", hidden: false, statusVisible: true, visible: true },
  { stage: "compatibility", hidden: false, statusVisible: true, visible: true },
  { stage: "http-fallback", hidden: false, statusVisible: true, visible: true },
  { stage: "reopen", hidden: false, statusVisible: true, visible: true },
  { stage: "waiting", hidden: false, statusVisible: true, visible: true },
];

test.each(visibilityCases)(
  "compact rendering matches its predicate when stage is $stage, hidden is $hidden and statusVisible is $statusVisible",
  ({ stage, hidden, statusVisible, visible }) => {
    const state = { ...recoveryState, stage, statusVisible };
    expect(isRecoveryStatusVisible(state, hidden)).toBe(visible);
    render(<RecoveryStatus state={state} hidden={hidden} />);
    expect(compactVisible()).toBe(visible);
  },
);

test("compact recovery shows only an accessible spinner while waiting to retry", () => {
  render(
    <RecoveryStatus
      state={{ ...recoveryState, stage: "waiting", attempt: 1, retryIn: 4 }}
      hidden={false}
    />,
  );

  const status = document.querySelector(".recovery-status");
  expect(status?.textContent).toBe("");
  expect(status?.getAttribute("aria-label")).toBeTruthy();
  expect(status?.querySelector(".spinner")).toBeTruthy();
});

/*
 * The same recovery contract on finite content, which reaches the picture through the VOD
 * screens rather than the channel list. The fixture is the smallest Xtream catalogue that
 * can play one film and one series.
 */
const VOD_FETCH = async (input: string | URL) => {
  const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
  const body: Record<string, unknown> = {
    authenticate: {
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    },
    get_live_categories: [{ category_id: "1", category_name: "Live" }],
    get_vod_categories: [{ category_id: "10", category_name: "Cinema" }],
    get_series_categories: [{ category_id: "20", category_name: "Drama" }],
    get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
    get_vod_streams: [
      { stream_id: "100", category_id: "10", name: "Film", container_extension: "mp4" },
    ],
    get_vod_info: {
      info: { name: "Film", plot: "Plot" },
      movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
    },
    get_series: [{ series_id: "200", category_id: "20", name: "Show" }],
    get_series_info: {
      info: { name: "Show", category_id: "20" },
      episodes: {
        "1": [
          {
            id: "201",
            episode_num: 1,
            title: "Pilot",
            container_extension: "mp4",
            info: { duration_secs: 1800 },
          },
        ],
      },
    },
  };
  return new Response(JSON.stringify(body[action]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const mountVod = (options: Parameters<typeof mountApp>[1] = {}) =>
  mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH, ...options });

async function chooseMode(name: "Movies" | "Series") {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
  await act(async () => Promise.resolve());
  await settle(300);
  if (document.querySelector(".app-navigation.expanded")) press(KEY.RIGHT);
  await settle(0);
}

async function chooseButton(name: string | RegExp) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
  await act(async () => Promise.resolve());
  await settle(0);
}

const playMovie = async () => {
  await chooseMode("Movies");
  await chooseButton(/Film/);
  await chooseButton(/^(Play|Resume)\b/);
  await settle(0);
  await settle(0);
};

const playSeries = async () => {
  await chooseMode("Series");
  await chooseButton(/^Show$/);
  await settle(0);
  press(KEY.ENTER);
  await settle(0);
  await settle(0);
};

test.each(["Movies", "Series"] as const)(
  "the clock follows the setting only while %s playback controls are open",
  async (mode) => {
    await mountVod();
    if (mode === "Movies") await playMovie();
    else await playSeries();
    const { useSettings } = await import("../src/stores/settings");
    const clock = () => document.querySelector(".top-strip .clock");
    press(KEY.ENTER);
    expect(document.querySelector(".playback-deck")).toBeTruthy();
    expect(clock()).toBeTruthy();
    act(() => useSettings.getState().set("showClock", false));
    expect(clock()).toBeNull();
    act(() => useSettings.getState().set("showClock", true));
    expect(clock()).toBeTruthy();
    press(KEY.BACK);
    expect(document.querySelector(".playback-deck")).toBeNull();
    expect(clock()).toBeNull();
  },
);

test.each(["Movies", "Series"] as const)(
  "Right on %s details cannot activate the focused playback action",
  async (mode) => {
    await mountVod();
    await chooseMode(mode);
    await chooseButton(mode === "Movies" ? /Film/ : /^Show$/);
    const before = played.length;
    press(KEY.RIGHT);
    await settle(0);
    expect(document.querySelector(".vod-details.loaded")).toBeTruthy();
    expect(played).toHaveLength(before);
    press(KEY.ENTER);
    await settle(0);
    await settle(0);
    expect(played.length).toBeGreaterThan(before);
  },
);

test("the playlist switcher pauses a playing movie without starting another title", async () => {
  await mountVod();
  await playMovie();
  const { useSettings } = await import("../src/stores/settings");
  act(() => useSettings.getState().addPlaylist("Second", XTREAM_SOURCE));
  const before = played.length;
  press(KEY.YELLOW);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await settle(0);
  expect(screen.getByRole("menu", { name: "Saved playlists" })).toBeTruthy();
  expect(pauseCalls).toBeGreaterThan(0);
  expect(played).toHaveLength(before);
});

const playbackModes = [
  {
    label: "Live TV",
    mount: (delay = 0) => mountApp(PLAYLIST, { slowPicture: delay, strict: true }),
    play: async () => {
      press(KEY.ENTER);
      await settle(0);
    },
    controlsKey: KEY.RIGHT,
  },
  {
    label: "Movie",
    mount: (delay = 0) => mountVod({ slowPicture: delay, strict: true }),
    play: playMovie,
    controlsKey: KEY.ENTER,
  },
  {
    label: "Episode",
    mount: (delay = 0) => mountVod({ slowPicture: delay, strict: true }),
    play: playSeries,
    controlsKey: KEY.ENTER,
  },
] as const;

test.each(playbackModes)(
  "$label keeps Play/Pause enabled while its first picture loads",
  async (mode) => {
    await mode.mount(5000);
    await mode.play();
    press(mode.controlsKey);
    const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;
    expect(control.disabled).toBe(false);
    expect(document.activeElement).toBe(control);
    expect(document.querySelector(".seekbar.disabled")).toBeTruthy();
    expect(control.querySelector(".icon-pause")).toBeTruthy();
    expect(deckSpinnerVisible()).toBe(true);
    press(KEY.PAUSE);
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(deckSpinnerVisible()).toBe(true);
    press(KEY.PLAY);
    expect(control.getAttribute("aria-pressed")).toBe("false");
    expect(deckSpinnerVisible()).toBe(true);
    fireEvent.click(control);
    expect(control.getAttribute("aria-pressed")).toBe("true");
    expect(control.querySelector(".icon-play")).toBeTruthy();
    expect(deckSpinnerVisible()).toBe(true);
    press(KEY.BACK);
    expect(fullSpinnerVisible()).toBe(true);
    expect(document.querySelector(".picture-state.paused")).toBeNull();
    await settle(5000);
    expect(spinnerCount()).toBe(0);
    expect(document.querySelector(".picture-state.paused")).toBeTruthy();
  },
);

test.each(playbackModes)(
  "$label keeps repeated reconnects compact under Strict Mode",
  async (mode) => {
    await mode.mount();
    await mode.play();
    for (const failure of [
      { type: "buffering-start" },
      { type: "error", code: "socket dropped", warmKind: null },
      { type: "error", code: "socket dropped", warmKind: null },
    ] as const) {
      emitPlayback(failure);
      expect(fullSpinnerVisible()).toBe(false);
      if (failure.type === "buffering-start") await settle(1500);
      expect(document.querySelector(".top-strip .recovery-status")).toBeTruthy();
      expect(spinnerCount()).toBe(1);
      expect(fullSpinnerVisible()).toBe(false);
      emitPlayback({ type: "playing" });
      await settle(0);
      expect(compactVisible()).toBe(false);
      expect(fullSpinnerVisible()).toBe(false);
      await settle(500);
    }
  },
);

test.each(playbackModes)("$label keeps reconnecting while Pause is requested", async (mode) => {
  await mode.mount();
  await mode.play();
  emitPlayback({ type: "buffering-start" });
  await settle(1500);
  expect(compactVisible()).toBe(true);
  expect(fullSpinnerVisible()).toBe(false);
  press(mode.controlsKey);
  const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;
  expect(control.disabled).toBe(false);
  expect(deckSpinnerVisible()).toBe(true);
  fireEvent.click(control);
  expect(control.getAttribute("aria-pressed")).toBe("true");
  expect(deckSpinnerVisible()).toBe(true);
  press(KEY.BACK);
  expect(compactVisible()).toBe(true);
  expect(document.querySelector(".picture-state.paused")).toBeNull();
  emitPlayback({ type: "buffering-complete" });
  expect(compactVisible()).toBe(false);
  expect(document.querySelector(".picture-state.paused")).toBeTruthy();
});

test("Live DVR keeps seek focus and Play/Pause available while its buffer refills", async () => {
  await mountApp(PLAYLIST, { liveDvr: true });
  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  press(KEY.UP);
  const slider = screen.getByRole("slider");
  emitPlayback({ type: "buffering-start" });
  expect(slider.getAttribute("aria-disabled")).toBe("true");
  expect(slider.getAttribute("data-selected")).toBe("true");
  expect(document.activeElement).toBe(slider);
  expect(
    document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')?.disabled,
  ).toBe(false);
  press(KEY.PLAY_PAUSE);
  expect(
    document.querySelector('[data-control="play-pause"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(slider.getAttribute("data-selected")).toBe("true");
  expect(document.activeElement).toBe(slider);
  emitPlayback({ type: "buffering-complete" });
  expect(slider.getAttribute("aria-disabled")).not.toBe("true");
  expect(slider.getAttribute("data-selected")).toBe("true");
  expect(document.activeElement).toBe(slider);
});

test("clicking Play/Pause during a buffered seek keeps focus on the clicked control", async () => {
  await mountVod();
  await playMovie();
  press(KEY.ENTER);
  press(KEY.UP);
  press(KEY.RIGHT);
  emitPlayback({ type: "buffering-start" });
  const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;
  fireEvent.click(control);
  expect(control.getAttribute("aria-pressed")).toBe("true");
  expect(control.getAttribute("data-selected")).toBe("true");
  expect(document.activeElement).toBe(control);
  expect(screen.getByRole("slider").hasAttribute("data-selected")).toBe(false);
});

test.each([
  ["movie", playMovie],
  ["episode", playSeries],
] as const)(
  "%s arrow keys leave controls hidden until seeking is available",
  async (_kind, play) => {
    await mountVod({ slowPicture: 5000 });
    await play();
    for (const code of [KEY.LEFT, KEY.RIGHT]) {
      press(code);
      expect(document.querySelector(".playback-deck")).toBeNull();
      expect(document.querySelector(".quick-seek")).toBeNull();
    }
    expect(seekChanges).toEqual([]);
    await settle(5000);
    setPlaybackTime(30, 0);
    await settle(1000);
    press(KEY.LEFT);
    press(KEY.RIGHT);
    expect(document.querySelector(".playback-deck")).toBeNull();
    expect(seekChanges).toEqual([]);
    setPlaybackTime(30, 120);
    await settle(1000);
    press(KEY.RIGHT);
    expect(document.querySelector(".playback-deck .seekbar.focused")).toBeTruthy();
  },
);

test("paused playback returning from buffering keeps an already focused seek bar", async () => {
  await mountVod();
  await playMovie();
  press(KEY.ENTER);
  press(KEY.UP);
  const slider = screen.getByRole("slider");
  expect(slider.getAttribute("data-selected")).toBe("true");
  emitPlayback({ type: "buffering-start" });
  expect(screen.getByRole("slider")).toBe(slider);
  expect(slider.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(slider);
  emitPlayback({ type: "paused" });
  expect(screen.getByRole("slider")).toBe(slider);
  expect(slider.getAttribute("data-selected")).toBe("true");
  expect(document.activeElement).toBe(slider);
});

/*
 * The two halves of the reconnect contract on one mount: a first connection that has
 * never shown a picture owns the central spinner for as long as it takes, and a session
 * that has played hands recovery to the compact status after the shared delay with no
 * central spinner at any point.
 */
const expectPlayedRecovery = async () => {
  emitPlayback({ type: "buffering-start" });
  await settle(0);
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);

  await settle(1499);
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);

  await settle(1);
  expect(compactVisible()).toBe(true);
  expect(fullSpinnerVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  emitPlayback({ type: "buffering-complete" });
  emitPlayback({ type: "playing" });
  expect(fullSpinnerVisible()).toBe(false);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(0);
};

test("a played Movie keeps the compact recovery contract its channel counterpart has", async () => {
  await mountVod({ slowPicture: 5000 });
  await playMovie();

  /* The first connection still owns the whole spinner, and stays quiet about compact
     status even after the delay that would arm it for a played session. */
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  emitPlayback({ type: "buffering-start" });
  await settle(1600);
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  await settle(4500);
  await settle(0);
  expect(spinnerCount()).toBe(0);
  await expectPlayedRecovery();
});

test("a played episode keeps the compact recovery contract its channel counterpart has", async () => {
  await mountVod({ slowPicture: 5000 });
  await playSeries();

  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  emitPlayback({ type: "buffering-start" });
  await settle(1600);
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  await settle(4500);
  await settle(0);
  expect(spinnerCount()).toBe(0);
  await expectPlayedRecovery();
});

test("a first Live connection owns the central spinner through the recovery delay", async () => {
  await mountApp(PLAYLIST, { slowPicture: 5000 });
  press(KEY.ENTER);
  await settle(0);
  await settle(0);
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);

  /* A target that has never played keeps the whole spinner for as long as the join takes,
     and the compact status stays suppressed even after the delay that would arm it. */
  emitPlayback({ type: "buffering-start" });
  await settle(1600);
  expect(fullSpinnerVisible()).toBe(true);
  expect(compactVisible()).toBe(false);
  expect(spinnerCount()).toBe(1);

  await settle(4500);
  await settle(0);
  expect(spinnerCount()).toBe(0);
  await expectPlayedRecovery();
});

/*
 * Dismissing the controls is itself the flush: a seek still inside its settle period is
 * the viewer's latest word and is delivered to the engine the moment the deck closes,
 * once, at the newest target.
 */
test("closing the deck mid seek delivers the latest target once, without waiting", async () => {
  await mountVod();
  await playMovie();

  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  press(KEY.UP);
  await settle(0);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  await settle(0);
  press(KEY.BACK);
  await settle(0);

  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(seekChanges).toHaveLength(1);
  expect(seekChanges[0]).toBe(20);
  /* The settle timer was cancelled by the flush, so nothing arrives late. */
  await settle(1000);
  expect(seekChanges).toHaveLength(1);
});

test("opening a track drawer mid seek flushes it before the drawer takes the screen", async () => {
  const tracks: MediaTrack[] = [
    {
      id: "a0",
      identity: "a0",
      engineIndex: 0,
      kind: "audio",
      label: "English",
      language: "en",
      selected: true,
    },
    {
      id: "a1",
      identity: "a1",
      engineIndex: 1,
      kind: "audio",
      label: "French",
      language: "fr",
      selected: false,
    },
  ];
  await mountVod({ playerTracks: tracks });
  await playMovie();

  press(KEY.ENTER);
  await settle(0);
  press(KEY.UP);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
  await settle(0);

  expect(document.querySelector(".playback-drawer")).toBeTruthy();
  expect(seekChanges).toHaveLength(1);
  expect(seekChanges[0]).toBe(10);
});

/*
 * While the engine is still answering a flushed seek the phase reads paused, but that
 * pause belongs to the seek, not the viewer: the central paused card stays away until
 * the seek lands, and then appears only when the viewer actually asked for pause.
 */
test("a held seek shows no paused card, and a playing intent stays clean after it lands", async () => {
  const resolvers: Array<(moved: boolean) => void> = [];
  await mountVod({
    seekImplementation: () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
  });
  await playMovie();

  press(KEY.ENTER);
  await settle(0);
  press(KEY.UP);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);
  press(KEY.BACK);
  await settle(0);

  expect(seekChanges).toHaveLength(1);
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(document.querySelector(".picture-state.paused")).toBeNull();

  await act(async () => {
    resolvers[0](true);
    await Promise.resolve();
  });
  await settle(0);
  expect(document.querySelector(".picture-state.paused")).toBeNull();
});

test("an explicit pause during a held seek earns the paused card once it lands", async () => {
  const resolvers: Array<(moved: boolean) => void> = [];
  await mountVod({
    seekImplementation: () => new Promise<boolean>((resolve) => resolvers.push(resolve)),
  });
  await playMovie();

  press(KEY.ENTER);
  await settle(0);
  press(KEY.UP);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);
  press(KEY.BACK);
  await settle(0);

  /* The flushed seek is still being answered by the engine, so the temporary pause it
     stands for announces nothing while the deck is gone. */
  expect(seekChanges).toHaveLength(1);
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(document.querySelector(".picture-state.paused")).toBeNull();

  /* Pause pressed while the seek is held rewrites the running session's intent and
     reopens the controls, but the paused card still waits for the seek to land. */
  press(KEY.PAUSE);
  await settle(0);
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(document.querySelector(".picture-state.paused")).toBeNull();

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(seekChanges).toHaveLength(1);
  expect(document.querySelector(".picture-state.paused")).toBeNull();

  await act(async () => {
    resolvers[0](true);
    await Promise.resolve();
  });
  await settle(0);
  expect(document.querySelector(".picture-state.paused")).toBeTruthy();
});

/*
 * The details surface is a reading surface above whatever the session is doing, so the
 * deck's fault cleanup must not take it down with the controls: the dialog stays until it
 * is dismissed, its keys still belong to it, and the way out lands on the failed picture
 * the fault card reports rather than restarting playback.
 */
test("a terminal fault under Details keeps the dialog until it is dismissed", async () => {
  await mountVod();
  await playMovie();

  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  press(KEY.LEFT);
  await settle(0);
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".playback-details")).toBeTruthy();

  emitPlayback({ type: "error", code: "PLAYER_ERROR_NOT_SUPPORTED_FILE", warmKind: null });
  await settle(0);

  /* The fault closes the deck and suppresses the banner, but the reading surface keeps
     its place: it is the viewer's information, not part of the transport. */
  expect(document.querySelector(".playback-details")).toBeTruthy();
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(document.querySelector(".pb-stack")).toBeNull();
  expect(document.querySelector(".quick-seek")).toBeNull();

  /* Its keys still belong to it: a scroll press is claimed and nothing underneath moves. */
  const scroll = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(scroll, "keyCode", { get: () => KEY.DOWN });
  act(() => {
    window.dispatchEvent(scroll);
  });
  expect(scroll.defaultPrevented).toBe(true);
  expect(document.querySelector(".playback-details")).toBeTruthy();

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".playback-details")).toBeNull();

  /* Underneath is the failed picture, which is what Return reaches next: the way back
     the fault card itself teaches, not a restart of anything. */
  await settle(600);
  expect(document.querySelector(".picture-state.failed")).toBeTruthy();
  const plays = played.length;
  press(KEY.BACK);
  await settle(0);
  expect(played).toHaveLength(plays);
  expect(document.querySelector(".vod-screen")).toBeTruthy();
});

/*
 * The dialog may only quote the catalogue its target belongs to: the playlist identity
 * and the source version fence every selected value, so a library that has since moved
 * to another owner or version leaves the surface with the target's own identity and
 * nothing the foreign catalogue could have said. Each drift lands while playback is
 * already running and before the dialog opens, with a foreign detail parked under the
 * same item key and the loaders and playlist selector replaced by spies, so any reach
 * for the foreign frame would be recorded rather than answered.
 */
test.each(["foreign-playlist", "moved-version"] as const)(
  "Details metadata stays fenced when the library shows %s",
  async (drift) => {
    await mountVod();
    await playMovie();

    const { useLibrary } = await import("../src/stores/library");
    const { useSettings } = await import("../src/stores/settings");
    const loaded = useLibrary.getState().movieDetails;
    const detailKey = Object.keys(loaded).find((key) => loaded[key].value?.name === "Film");
    expect(detailKey).toBeTruthy();
    const own = loaded[detailKey!].value!;
    const foreign = {
      ...own,
      name: "Foreign movie",
      plot: "Foreign synopsis",
      genre: "Foreign genre",
      metadata: { ...own.metadata, country: "ZZ", ageRating: "XXX" },
    };
    const loadMovie = vi.fn().mockResolvedValue(undefined);
    const loadSeries = vi.fn().mockResolvedValue(undefined);
    const selectPlaylist = vi.fn();
    const activePlaylistId = useSettings.getState().activePlaylist()?.id;
    const library = useLibrary.getState();
    act(() => {
      useLibrary.setState({
        playlistId: drift === "foreign-playlist" ? "pl-other" : library.playlistId,
        sourceVersion:
          drift === "moved-version" ? library.sourceVersion + 1 : library.sourceVersion,
        movieDetails: {
          ...useLibrary.getState().movieDetails,
          [detailKey!]: { state: "loaded", value: foreign },
        },
        loadMovie,
        loadSeries,
        selectPlaylist,
      });
    });
    const patched = useLibrary.getState();
    /* New function identities wake the screens' own playlist effects once; let that
       settle so the spies below record only what the dialog itself reaches for. */
    await settle(0);
    loadMovie.mockClear();
    loadSeries.mockClear();
    selectPlaylist.mockClear();

    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);

    const details = document.querySelector(".playback-details");
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain("Film");
    expect(details?.textContent).not.toContain("Foreign movie");
    expect(details?.textContent).not.toContain("Foreign synopsis");
    expect(details?.textContent).not.toContain("Foreign genre");
    expect(document.querySelector(".playback-details-synopsis")).toBeNull();
    expect(document.querySelector(".vod-credit-row")).toBeNull();
    expect(document.querySelector(".playback-details-extra")).toBeNull();
    expect(loadMovie).not.toHaveBeenCalled();
    expect(loadSeries).not.toHaveBeenCalled();
    expect(selectPlaylist).not.toHaveBeenCalled();

    const held = useLibrary.getState();
    expect(held.playlistId).toBe(patched.playlistId);
    expect(held.sourceVersion).toBe(patched.sourceVersion);
    expect(held.movieDetails[detailKey!].value).toBe(foreign);
    expect(useSettings.getState().activePlaylist()?.id).toBe(activePlaylistId);
  },
);

/*
 * Details is a reading surface, not a transport: while it owns the frame every key
 * that is not its own is dead, the engine and the catalogue stay exactly where the
 * viewer left them, and the way out returns to the deck it covered rather than
 * restarting anything. Both finite kinds take the same path, so the case runs for
 * each of them.
 */
const finishContentMotion = async () => {
  await settle(400);
  await settle(64);
  await settle(400);
};

test.each([
  { kind: "movie", motion: 0 },
  { kind: "movie", motion: 180 },
  { kind: "series", motion: 0 },
  { kind: "series", motion: 180 },
] as const)(
  "Details over %s playback owns every key without touching playback",
  async ({ kind, motion }) => {
    await mountVod();
    if (kind === "movie") await playMovie();
    else await playSeries();

    if (motion) {
      document.documentElement.style.setProperty("--t-navigation", `${motion}ms`);
    }
    try {
      const { Player } = await import("../src/services/player");
      const { usePersonal } = await import("../src/stores/personal");
      const stop = vi.spyOn(Player.prototype, "stop");
      const detach = vi.spyOn(Player.prototype, "detach");
      const pause = vi.spyOn(Player.prototype, "pause");
      const resume = vi.spyOn(Player.prototype, "resumePlayback");
      const lifecycleCalls = () =>
        stop.mock.calls.length +
        detach.mock.calls.length +
        pause.mock.calls.length +
        resume.mock.calls.length;
      const lifecycle = lifecycleCalls();
      const plays = playCalls.length;
      const playedCount = played.length;
      const favourites = usePersonal.getState().favourites;

      press(KEY.ENTER);
      await settle(0);
      press(KEY.LEFT);
      await settle(0);
      press(KEY.ENTER);
      await settle(0);

      expect(document.querySelector(".playback-content-transition")).toBeNull();

      const details = document.querySelector(".playback-details");
      expect(details).toBeTruthy();
      expect(document.activeElement).toBe(document.querySelector(".playback-details-scroll"));
      expect(document.querySelector(".playback-deck")).toBeNull();
      expect(document.querySelector(".pb-stack")).toBeNull();
      expect(document.querySelector(".quick-seek")).toBeNull();
      expect(fullSpinnerVisible()).toBe(false);
      expect(compactVisible()).toBe(false);
      expect(lifecycleCalls()).toBe(lifecycle);
      expect(playCalls).toHaveLength(plays);
      expect(played).toHaveLength(playedCount);

      /* Colours, digits, channel keys and arrows all belong to surfaces underneath; none
         of them may reach the engine, the favourites or the settings sheet. */
      const navExpanded = !!document.querySelector(".app-navigation.expanded");
      for (const code of [
        KEY.GREEN,
        KEY.YELLOW,
        KEY.RED,
        53,
        KEY.CH_UP,
        KEY.CH_DOWN,
        KEY.LEFT,
        KEY.RIGHT,
        KEY.UP,
        KEY.DOWN,
      ]) {
        press(code);
      }
      await settle(0);
      expect(document.querySelector(".playback-details")).toBeTruthy();
      expect(document.querySelector(".settings-host:not(.hidden)")).toBeNull();
      expect(document.querySelector(".app.page-transition-active")).toBeNull();
      expect(!!document.querySelector(".app-navigation.expanded")).toBe(navExpanded);
      expect(usePersonal.getState().favourites).toEqual(favourites);
      expect(lifecycleCalls()).toBe(lifecycle);
      expect(playCalls).toHaveLength(plays);
      expect(played).toHaveLength(playedCount);

      /* A short stall and a long sit prove the dialog is chrome exclusive: no deck, no
         banner, no spinner and no recovery card may appear over or under it, and the
         progress ticks and retired deck timers change none of that. */
      emitPlayback({ type: "buffering-start" });
      await settle(100);
      expect(document.querySelector(".playback-details")).toBeTruthy();
      expect(compactVisible()).toBe(false);
      expect(fullSpinnerVisible()).toBe(false);
      emitPlayback({ type: "buffering-complete" });
      emitPlayback({ type: "playing" });
      setPlaybackTime(30);
      await settle(9000);
      expect(document.querySelector(".playback-details")).toBeTruthy();
      expect(document.querySelector(".playback-deck")).toBeNull();
      expect(document.querySelector(".pb-stack")).toBeNull();
      expect(document.querySelector(".quick-seek")).toBeNull();
      expect(fullSpinnerVisible()).toBe(false);
      expect(compactVisible()).toBe(false);
      expect(lifecycleCalls()).toBe(lifecycle);
      expect(playCalls).toHaveLength(plays);
      expect(played).toHaveLength(playedCount);

      /* Return restores the deck with Details focused without changing playback. */
      press(KEY.BACK);
      await settle(0);
      expect(document.querySelector(".playback-details")).toBeNull();
      const detailsAction = document.querySelector('[data-control="details"]');
      expect(detailsAction?.getAttribute("data-selected")).toBe("true");
      expect(document.activeElement).toBe(detailsAction);
      expect(document.querySelector(".vod-screen")).toBeTruthy();
      expect(lifecycleCalls()).toBe(lifecycle);
      expect(playCalls).toHaveLength(plays);
      expect(played).toHaveLength(playedCount);
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

/*
 * The transport keys are the exception the reading surface makes on purpose: they still
 * reach the engine because pausing and seeking are what the viewer pressed them for,
 * but they never surface the deck or the quick seek card over the dialog, and Stop
 * still lands on the content's own screen through the ordinary finite return.
 */
test("transport keys under Details drive the engine without opening the deck", async () => {
  await mountVod();
  await playMovie();
  setPlaybackTime(60, 300);
  /* The controller clock publishes position, duration and the seek range on its own
     tick, so let one land before the dialog opens. */
  await settle(1100);

  const { Player } = await import("../src/services/player");
  const pause = vi.spyOn(Player.prototype, "pause");
  const resume = vi.spyOn(Player.prototype, "resumePlayback");

  press(KEY.ENTER);
  await settle(0);
  press(KEY.LEFT);
  await settle(0);
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".playback-details")).toBeTruthy();

  press(KEY.PAUSE);
  await settle(0);
  expect(pause).toHaveBeenCalled();
  expect(document.querySelector(".playback-details")).toBeTruthy();
  expect(document.querySelector(".playback-deck")).toBeNull();

  press(KEY.PLAY);
  await settle(0);
  expect(resume).toHaveBeenCalled();
  expect(document.querySelector(".playback-details")).toBeTruthy();
  expect(document.querySelector(".playback-deck")).toBeNull();

  /* Each scan key queues one quick seek that commits after the shared settle window;
     the highlight never reaches the screen while the dialog owns it. */
  const seeks = seekChanges.length;
  press(KEY.REWIND);
  await settle(800);
  press(KEY.FORWARD);
  await settle(800);
  expect(seekChanges.slice(seeks)).toEqual([-10, 10]);
  expect(document.querySelector(".quick-seek")).toBeNull();
  expect(document.querySelector(".playback-details")).toBeTruthy();

  press(KEY.STOP);
  await settle(0);
  expect(document.querySelector(".playback-details")).toBeNull();
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(document.querySelector(".vod-screen")).toBeTruthy();
});

/* Transport keys keep working while the information entrance animates. */
test("transport keys work during the Details entrance and OK dismisses it immediately", async () => {
  await mountVod();
  await playMovie();
  setPlaybackTime(60, 300);
  await settle(1100);

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    const { Player } = await import("../src/services/player");
    const pause = vi.spyOn(Player.prototype, "pause");
    const resume = vi.spyOn(Player.prototype, "resumePlayback");

    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeTruthy();
    expect(document.querySelector(".playback-deck")).toBeNull();

    press(KEY.PAUSE);
    await settle(0);
    expect(pause).toHaveBeenCalled();
    press(KEY.PLAY);
    await settle(0);
    expect(resume).toHaveBeenCalled();

    press(KEY.LEFT);
    press(KEY.RIGHT);
    press(KEY.UP);
    press(KEY.DOWN);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeNull();
    expect(document.querySelector(".playback-deck")).toBeTruthy();

    await finishContentMotion();
    expect(document.querySelector(".playback-details")).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

/* Stop closes information and returns through the content's finite origin. */
test("Stop closes Details during its entrance and returns through the finite origin", async () => {
  await mountVod();
  await playMovie();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeTruthy();

    press(KEY.STOP);
    await settle(0);
    await finishContentMotion();
    expect(document.querySelector(".playback-details")).toBeNull();
    expect(document.querySelector(".playback-deck")).toBeNull();
    expect(document.querySelector(".vod-screen")).toBeTruthy();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

/* A natural end retires information along with its playback target. */
test("a natural end closes Details during its entrance", async () => {
  await mountVod();
  await playMovie();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeTruthy();

    finishPlayback();
    await settle(0);
    await finishContentMotion();
    expect(document.querySelector(".playback-details")).toBeNull();
    expect(document.querySelector(".vod-screen")).toBeTruthy();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

/* A replaced source cannot leave information for its former playback target. */
test("a source replacement closes Details without reopening it", async () => {
  await mountVod();
  await playMovie();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeTruthy();

    const { useSettings } = await import("../src/stores/settings");
    const playlist = useSettings.getState().activePlaylist()!;
    act(() => {
      useSettings.setState({
        playlists: useSettings
          .getState()
          .playlists.map((item) =>
            item.id === playlist.id ? { ...item, sourceVersion: item.sourceVersion + 1 } : item,
          ),
      });
    });
    await settle(0);
    await finishContentMotion();
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

/* A fault preserves the information already being read and leaves Return usable. */
test("a terminal fault keeps open Details readable and dismissible", async () => {
  await mountVod();
  await playMovie();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.ENTER);
    await settle(0);
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeTruthy();

    emitPlayback({
      type: "error",
      code: "PLAYER_ERROR_NOT_SUPPORTED_FILE",
      warmKind: null,
    });
    await settle(0);
    await finishContentMotion();
    expect(document.querySelector(".playback-details")).toBeTruthy();
    press(KEY.BACK);
    await settle(0);
    expect(document.querySelector(".playback-details")).toBeNull();
    expect(document.querySelector(".vod-screen")).toBeTruthy();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});
