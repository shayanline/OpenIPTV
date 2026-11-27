import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PictureState } from "../src/components/PictureState";
import { KEY } from "../src/hooks/useRemote";
import { SEEK_SETTLE_MS } from "../src/services/playbackRange";
import type { MediaTrack } from "../src/types";
import {
  emitPlayback,
  hold,
  mountApp,
  muted,
  panelOpen,
  playCalls,
  played,
  press,
  pressDown,
  release,
  seekChanges,
  setPlaybackTime,
  settle,
  volumeChanges,
  XTREAM_SOURCE,
  xtreamFetch,
} from "./support/app";

/**
 * The four laws of the key model, asserted rather than described.
 *
 * LiveScreen.tsx sets these out at length for Live, and they are how that screen is driven:
 *
 *   1. At the Live picture, up and down always change channel. In every Live picture state,
 *      whatever is on screen.
 *   2. OK does the obvious thing where it is pressed. At the Live picture that is the channel list.
 *   3. Left and right move within whatever is showing.
 *   4. RETURN always goes back, and closes the application only when there is nothing left
 *      to close.
 *
 * Until now they existed only as prose, which meant the one part of the app that must not
 * change by accident was the part nothing checked. Law 1 in particular is defended in the
 * source as the thing that makes it impossible to get stuck, and "impossible" is a claim a
 * test can hold to.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="News",Gamma
http://example.invalid/c.m3u8`;

const mount = (options: Parameters<typeof mountApp>[1] = {}) => mountApp(PLAYLIST, options);

async function finishPageEntry() {
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("idle");
    },
    { interval: 10 },
  );
}

beforeEach(() => {
  localStorage.clear();
  const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!.get!;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
    return this.classList.contains("poster-grid-region") ? 400 : clientHeight.call(this);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
  vi.doUnmock("../src/stores/library");
});

test("finite terminal errors teach Back for both OK and Return", () => {
  vi.useFakeTimers();
  render(
    <PictureState
      channel="Brothers · S01 E02 · Pilot"
      busy={false}
      filling={null}
      waited={0}
      fault="FINITE_FORMAT_UNSUPPORTED"
      finite
    />,
  );
  act(() => vi.advanceTimersByTime(500));

  const guide = document.querySelector(".picture-state-keys");
  expect(guide).toBeTruthy();
  expect([...guide!.querySelectorAll("kbd")].map((item) => item.textContent)).toEqual([
    "OK",
    "Return",
  ]);
  expect(guide?.textContent).toContain("Back");
  expect(guide?.textContent).not.toContain("Close the app");
});

test("the playlist arrives and the panel opens on it", async () => {
  await mount();
  expect(document.querySelectorAll(".app")).toHaveLength(1);
  expect(document.querySelectorAll("video.video")).toHaveLength(1);
  expect(document.querySelectorAll(".panel")).toHaveLength(1);
  assert.ok(panelOpen(), "the app should open on the channel list");
  expect(screen.getByText("Alpha")).toBeTruthy();
});

test("the Live channel header shows the selected category total", async () => {
  await mount();
  expect(document.querySelector(".list .pane-head .count")?.textContent).toBe("3");
});

test("law 2: OK on a channel starts it and puts the list away", async () => {
  await mount();
  press(KEY.ENTER);
  assert.equal(played.length, 1);
  assert.ok(!panelOpen(), "the panel should withdraw once a channel is chosen");
});

test("law 2: Right on a channel chooses it like OK", async () => {
  await mount();
  press(KEY.RIGHT);
  assert.equal(played.length, 1);
  assert.ok(!panelOpen(), "the panel should withdraw once a channel is chosen");
});

test("the channel list stays open until it is dismissed", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.LEFT);
  await settle(5000);
  assert.ok(panelOpen(), "the channel list closed without being dismissed");
});

test("law 1: up and down change channel at the Live picture", async () => {
  await mount();
  press(KEY.ENTER); // watch the first channel
  const started = played.length;

  press(KEY.UP);
  // Release commits the selection, but feedback paints before native tuning starts.
  expect(document.querySelector(".pb-title")?.textContent).toBe("Beta");
  assert.equal(played.length, started, "tuned before the viewer had finished pressing");
  await settle(120);
  assert.equal(played.length, started + 1, "channel up did not tune anything");
});

test("Live channel feedback does not reread the launch preferences", async () => {
  await mount();
  press(KEY.ENTER);
  const reads = vi.spyOn(Storage.prototype, "getItem");
  reads.mockClear();

  press(KEY.UP);

  expect(document.querySelector(".pb-title")?.textContent).toBe("Beta");
  expect(reads.mock.calls.filter(([key]) => key.startsWith("app:last-"))).toEqual([]);
});

test("Live picture law 1 holds when the channel on screen has failed", async () => {
  const { container } = await mount();
  press(KEY.ENTER);
  await settle(600);

  // A channel that will not start must not trap anybody: one press has to move on.
  assert.ok(container);
  press(KEY.UP);
  await settle(600);
  assert.ok(played.length >= 2, "channel up did nothing on a failed channel");
});

test("a terminal playback error preserves browser navigation without opening controls", async () => {
  await mount({ strict: true });
  press(KEY.ENTER);
  await settle(0);
  press(KEY.LEFT);
  emitPlayback({ type: "error", code: "PLAYER_ERROR_NOT_SUPPORTED_FILE", warmKind: null });
  await settle(600);
  expect(panelOpen()).toBe(true);
  expect(document.querySelector(".playback-deck")).toBeNull();
  const started = played.length;
  press(KEY.DOWN);
  await settle(500);
  expect(played).toHaveLength(started);
  expect(panelOpen()).toBe(true);
  press(KEY.ENTER);
  await settle(0);
  expect(played[played.length - 1]).toContain("/b.m3u8");
  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".playback-deck")).toBeNull();
});

test("Right on a failed picture cannot strand navigation in an invisible deck", async () => {
  await mount({ strict: true });
  press(KEY.ENTER);
  await settle(0);
  emitPlayback({ type: "error", code: "PLAYER_ERROR_NOT_SUPPORTED_FILE", warmKind: null });
  await settle(600);
  press(KEY.RIGHT);
  expect(document.querySelector(".playback-deck")).toBeNull();
  press(KEY.ENTER);
  expect(panelOpen()).toBe(true);
  press(KEY.DOWN);
  await settle(500);
  expect(played).toHaveLength(1);
});

test("Play and Pause update playback without taking focus from the Live browser", async () => {
  await mount({ strict: true });
  press(KEY.ENTER);
  await settle(0);
  const { Player } = await import("../src/services/player");
  const pause = vi.spyOn(Player.prototype, "pause");
  const resume = vi.spyOn(Player.prototype, "resumePlayback");
  press(KEY.LEFT);
  press(KEY.PAUSE);
  await settle(0);
  expect(pause).toHaveBeenCalled();
  expect(panelOpen()).toBe(true);
  expect(document.querySelector(".playback-deck")).toBeNull();
  const beforeResume = played.length;
  press(KEY.PLAY);
  await settle(0);
  expect(resume).not.toHaveBeenCalled();
  expect(played).toHaveLength(beforeResume + 1);
  expect(panelOpen()).toBe(true);
  expect(document.querySelector(".playback-deck")).toBeNull();
  press(KEY.BACK);
  await settle(0);
  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".playback-deck")).toBeNull();
});

test("law 3: left at the Live picture opens the channel list", async () => {
  await mount();
  press(KEY.ENTER);
  assert.ok(!panelOpen());
  press(KEY.LEFT);
  assert.ok(panelOpen(), "left should reach the list that is off the left of the screen");
});

test("law 2: OK at the Live picture opens the channel list", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.ENTER);
  assert.ok(panelOpen());
});

test("right at the uncovered Live picture opens the deck, and Back closes it", async () => {
  await mount();
  press(KEY.ENTER);

  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
  press(KEY.RIGHT);
  assert.ok(document.querySelector(".playback-deck"), "Right did not open the deck");

  press(KEY.BACK);
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
  assert.equal(panelOpen(), false);
});

test("left at the leading playback control stays inside the deck", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.RIGHT);
  press(KEY.LEFT);
  press(KEY.LEFT);

  expect(document.querySelector('[data-control="previous"][data-selected]')).toBeTruthy();
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
});

test("up dismisses a Live playback deck with no seek action", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.RIGHT);
  expect(document.querySelector(".playback-deck")).toBeTruthy();

  press(KEY.UP);

  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(panelOpen()).toBe(false);
});

test("holding OK at the Live picture toggles compact playback diagnostics", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);

  await hold(KEY.ENTER);

  assert.ok(document.querySelector(".playback-info.visible"));
  assert.equal(panelOpen(), false);
});

test("application navigation hides playback diagnostics", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);
  await hold(KEY.ENTER);
  assert.ok(document.querySelector(".playback-info.visible"));

  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.LEFT);

  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.querySelector(".playback-info")).toBeNull();
});

test("OK at the Live picture opens the browser while a stream is joining", async () => {
  await mount({ slowPicture: 2_000 });
  press(KEY.ENTER);
  await settle();

  press(KEY.ENTER);

  assert.ok(panelOpen(), "OK while connecting did not open the browser");
});

test("Play or Pause at the Live picture pauses and opens the deck", async () => {
  await mount();
  press(KEY.ENTER);

  press(KEY.PLAY_PAUSE);
  assert.ok(document.querySelector(".playback-deck"), "Play or Pause did not open the deck");
});

test("Back dismisses a paused Live deck to a quiet paused picture card", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.PAUSE);
  await settle(5_000);

  expect(document.querySelector(".playback-deck")).toBeTruthy();
  press(KEY.BACK);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.querySelector(".playback-deck")).toBeNull();
  expect(screen.getByRole("status", { name: "Play or pause" }).textContent).toContain("Play");
});

test("the channel keys still change channel with the deck open", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.RIGHT);
  assert.ok(document.querySelector(".playback-deck"));

  const started = played.length;
  press(KEY.CH_UP);
  await settle(600);
  assert.ok(played.length > started, "channel up did not tune with the deck open");
});

test("the clock remains visible everywhere except Settings", async () => {
  await mount();
  expect(document.querySelector(".clock")).toBeTruthy();

  press(KEY.ENTER);
  await settle();
  expect(document.querySelector(".clock")).toBeTruthy();

  press(KEY.YELLOW);
  expect(document.querySelector(".clock")).toBeNull();

  press(KEY.BACK);
  expect(document.querySelector(".clock")).toBeTruthy();
});

test("law 4: RETURN clears the screen before it offers to close the app", async () => {
  await mount();
  press(KEY.ENTER); // watching, banner up
  assert.ok(!panelOpen());

  press(KEY.BACK); // clears the banner
  assert.equal(document.querySelector(".dialog"), null, "offered to exit on the first press");

  press(KEY.BACK); // nothing left, so now it asks
  assert.ok(document.querySelector(".dialog"), "never offered to close the app");
});

test("law 4: RETURN in the panel goes back to the picture rather than closing", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.LEFT);
  assert.ok(panelOpen());
  press(KEY.BACK);
  assert.ok(!panelOpen());
  assert.equal(document.querySelector(".dialog"), null);
});

test("law 4 returns from the Xtream Guide to the same live row", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });

  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  press(KEY.BACK);
  expect(document.querySelector(".guide-drawer.closing")).toBeTruthy();
  expect(panelOpen()).toBe(false);
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
  /* The drawer came from the deck, so Back lands back on the deck with Guide focused. */
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(
    document
      .querySelector(".deck-programme-panel [data-selected]")
      ?.getAttribute("data-control"),
  ).toBe("guide");
  expect(panelOpen()).toBe(false);

  press(KEY.BACK);
  press(KEY.LEFT);
  expect(document.querySelector(".list .row.cursor .row-label")?.textContent).toBe(
    "Provider One",
  );
  expect(panelOpen()).toBe(true);
});

test("the Guide drawer consumes Right without acting and closes on Left", async () => {
  await guideDrawer();
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(
    [...document.querySelectorAll(".guide-drawer-hints kbd")].map((key) => key.textContent),
  ).toContain("\u2190");

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(document.querySelector(".guide-drawer.closing")).toBeNull();

  press(KEY.LEFT);
  expect(document.querySelector(".guide-drawer.closing")).toBeTruthy();
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
});

test("the Guide drawer closes on physical Left in RTL as well", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    locale: "ar",
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });
  press(KEY.ENTER);
  await settle(200);
  press(KEY.LEFT);
  await settle(0);
  const guideControl = document.querySelector<HTMLElement>(
    '.deck-programme-panel [data-control="guide"]',
  );
  expect(guideControl).toBeTruthy();
  expect(guideControl?.getAttribute("aria-disabled")).not.toBe("true");
  fireEvent.click(guideControl!);
  await settle(0);
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelector(".guide-drawer")).toBeTruthy();

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();

  press(KEY.LEFT);
  expect(document.querySelector(".guide-drawer.closing")).toBeTruthy();
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
});

test("Catchup Details shows the programme without restarting playback", async () => {
  const baseFetch = xtreamFetch(
    [{ category_id: "10", category_name: "News" }],
    [
      {
        stream_id: "1",
        name: "Provider One",
        category_id: "10",
        stream_type: "live",
        tv_archive: 1,
        tv_archive_duration: 7,
      },
    ],
  );
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      if (new URL(String(input)).searchParams.get("action") === "get_short_epg") {
        const now = Math.floor(Date.now() / 1000);
        return new Response(
          JSON.stringify({
            epg_listings: [
              {
                id: "past",
                title: "Morning News",
                start: new Date((now - 1800) * 1000)
                  .toISOString()
                  .slice(0, 19)
                  .replace("T", " "),
                end: new Date((now - 900) * 1000).toISOString().slice(0, 19).replace("T", " "),
                start_timestamp: String(now - 1800),
                stop_timestamp: String(now - 900),
                has_archive: 1,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return baseFetch(input);
    },
  });

  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Play from start" }));
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(playCalls.filter((call) => call[3] === "finite")).toHaveLength(1);
    },
    { interval: 10 },
  );
  press(KEY.BACK);
  await settle(180);
  press(KEY.ENTER);
  const starts = playCalls.length;
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".playback-details")).toBeTruthy();
    },
    { interval: 10 },
  );
  expect(document.querySelector(".playback-details")?.textContent).toContain("Morning News");
  expect(document.querySelector(".guide-drawer")).toBeNull();
  expect(panelOpen()).toBe(false);
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".playback-details")).toBeNull();
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(playCalls).toHaveLength(starts);
});

test.each(["Movies", "Series"] as const)(
  "law 4 offers Exit from the %s root and restores the same mode on Cancel",
  async (mode) => {
    await mountApp("", {
      source: XTREAM_SOURCE,
      fetchImplementation: xtreamFetch(
        [{ category_id: "10", category_name: "News" }],
        [
          {
            stream_id: "1",
            name: "Provider One",
            category_id: "10",
            stream_type: "live",
          },
        ],
      ),
    });

    const selectedMode = screen.getByRole("button", { name: mode });
    selectedMode.focus();
    fireEvent.click(selectedMode);
    expect(selectedMode.getAttribute("aria-current")).toBe("page");
    press(KEY.RIGHT);

    press(KEY.BACK);
    expect(document.querySelector(".dialog")).toBeTruthy();
    expect(selectedMode.getAttribute("aria-current")).toBe("page");
    expect(panelOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Keep app open" }));
    expect(document.querySelector(".dialog")).toBeNull();
    expect(screen.getByRole("button", { name: mode }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
    expect(panelOpen()).toBe(false);
  },
);

test("law 4 removes Movie details before it leaves the VOD root", async () => {
  const fetchImplementation = async (input: string | URL) => {
    const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
    const body: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: [{ category_id: "10", category_name: "Cinema" }],
      get_series_categories: [],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: [
        { stream_id: "100", category_id: "10", name: "Film", container_extension: "mp4" },
      ],
      get_vod_info: {
        info: { name: "Film", plot: "Plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
    };
    return new Response(JSON.stringify(body[action]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  press(KEY.RIGHT);
  const film = screen.getByRole("button", { name: /Film/ });
  film.focus();
  fireEvent.click(film);
  await settle(0);

  press(KEY.BACK);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
  expect(screen.getByText("Film")).toBeTruthy();

  press(KEY.BACK);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".dialog")).toBeTruthy();
});

test.each(["Enter", "Return", "pointer"] as const)(
  "dismissing Live Exit with %s preserves the hidden panel and its motion frame",
  async (input) => {
    await livePictureCalm();
    expect(panelOpen()).toBe(false);
    expect(document.querySelector(".app.live-panel-motion")).toBeTruthy();
    press(KEY.BACK);
    expect(document.querySelector(".dialog")).toBeTruthy();
    expect(document.querySelector(".app.live-panel-motion")).toBeTruthy();
    if (input === "pointer") {
      const cancel = screen.getByRole("button", { name: "Keep app open" });
      fireEvent.pointerDown(cancel);
      fireEvent.click(cancel);
    } else {
      press(input === "Enter" ? KEY.ENTER : KEY.BACK);
    }
    expect(document.querySelector(".dialog")).toBeNull();
    expect(document.querySelector(".app.live-panel-motion")).toBeTruthy();
    expect(document.querySelector(".app.app-navigation-visible")).toBeNull();
    expect(panelOpen()).toBe(false);
    await settle(400);
    expect(panelOpen()).toBe(false);
    expect(document.querySelector(".app.app-navigation-visible")).toBeNull();
  },
);

test("RETURN closes the channel panel before offering to exit when nothing is playing", async () => {
  await mount();
  assert.ok(panelOpen());

  press(KEY.BACK);
  assert.equal(panelOpen(), false);
  assert.equal(Boolean(document.querySelector(".dialog")), false);

  press(KEY.BACK);
  assert.ok(document.querySelector(".dialog"));
});

test("a dialled number tunes the channel carrying it", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;
  press(51); // "3"
  await settle(2200);
  assert.equal(played.length, started + 1);
  assert.match(played[played.length - 1], /c\.m3u8$/);
});

test("a dialled custom number uses the effective number index", async () => {
  await mountApp(PLAYLIST, {
    personalLineup: {
      version: 1,
      revision: 2,
      personalisation: { channels: { a: { number: 801 } } },
    },
  });
  press(56);
  press(48);
  press(49);
  press(KEY.ENTER);
  assert.match(played[played.length - 1], /a\.m3u8$/);
});

test("a dialled number cannot tune a hidden category", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  press(51);
  await settle(2200);
  assert.deepEqual(played, []);
});

test("OK finishes a dialled number rather than waiting it out", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;
  press(50); // "2"
  press(KEY.ENTER);
  assert.equal(played.length, started + 1, "OK did not commit the number");
  assert.match(played[played.length - 1], /b\.m3u8$/);
});

test("the yellow key opens settings without a page transition", async () => {
  await mount();
  press(KEY.YELLOW);
  assert.ok(
    document.querySelector(".settings-host:not(.hidden) .sheet"),
    "the settings sheet did not open",
  );
  expect(document.querySelector(".app.page-transition-entering")).toBeNull();
});

test("closing Settings does not start a page transition", async () => {
  await mount();
  press(KEY.YELLOW);
  expect(document.querySelector(".app.page-transition-entering")).toBeNull();

  press(KEY.BACK);

  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
  expect(document.querySelector(".app.page-transition-entering")).toBeNull();
});

test("opening Settings cancels a pending numeric dial", async () => {
  await mount();
  const started = played.length;
  press(50);
  expect(document.querySelector(".digits")?.textContent).toBe("2");

  press(KEY.YELLOW);
  await settle(2_100);

  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".digits")).toBeNull();
  expect(played).toHaveLength(started);
});

test("the Live picture receives directions again after Settings closes", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;

  press(KEY.YELLOW);
  press(KEY.UP);
  await settle(600);
  expect(played).toHaveLength(started);

  press(KEY.BACK);
  press(KEY.UP);
  await settle(600);
  expect(played).toHaveLength(started + 1);
});

test("settings mutes audio without restarting playback", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;

  press(KEY.YELLOW);
  assert.equal(muted, true, "settings did not mute the playing channel");
  assert.equal(played.length, started, "opening settings restarted playback");

  press(KEY.BACK);
  assert.equal(muted, false, "closing settings did not restore audio");
  assert.equal(played.length, started, "closing settings restarted playback");
});

test("the debug Smart Remote starts closed and wires volume controls", async () => {
  await mount();
  press(KEY.ENTER);
  assert.ok(screen.getByRole("button", { name: "Show Smart Remote" }));
  assert.equal(document.querySelector(".remote"), null, "the debug remote opened by default");

  await act(async () => {
    screen.getByRole("button", { name: "Show Smart Remote" }).click();
  });
  screen.getByRole("button", { name: "Volume up" }).click();
  screen.getByRole("button", { name: "Volume down" }).click();

  assert.deepEqual(volumeChanges, [1, -1]);
});

test("the debug Smart Remote's Select opens the browser like the remote's OK", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);
  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  const ok = screen.getByRole("button", { name: "Select" });

  fireEvent.pointerDown(ok, { pointerId: 1 });
  await settle(100);
  fireEvent.pointerUp(ok, { pointerId: 1 });

  assert.ok(panelOpen(), "the remote's Select did not reach the browser");
});

test("double clicking anywhere in the app toggles browser fullscreen", async () => {
  await mount();
  const video = document.querySelector("video");
  const app = document.querySelector(".app");
  const panel = document.querySelector(".panel");
  assert.ok(video, "the browser video was not rendered");
  assert.ok(app, "the application root was not rendered");
  assert.ok(panel, "the channel panel was not rendered");

  let fullscreen: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  document.documentElement.requestFullscreen = vi.fn(async () => {
    fullscreen = document.documentElement;
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreen = null;
  });

  act(() => panel.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(document.documentElement.requestFullscreen.mock.calls.length, 1);
  assert.equal(fullscreen, document.documentElement);
  assert.equal(document.exitFullscreen.mock.calls.length, 0);

  act(() => document.dispatchEvent(new Event("fullscreenchange")));
  press(KEY.ESC);
  assert.equal(document.exitFullscreen.mock.calls.length, 0);

  pressDown(KEY.ESC);
  await settle(500);
  assert.equal(document.exitFullscreen.mock.calls.length, 1);
  pressDown(KEY.ESC, true);
  release(KEY.ESC);

  act(() => panel.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(document.exitFullscreen.mock.calls.length, 1);
});

test("the green key favourites the highlighted channel and says so", async () => {
  await mount();
  press(KEY.GREEN);
  expect(screen.getByText("Added to favourites")).toBeTruthy();
});

test("playback diagnostics remain available without a More drawer", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);

  press(KEY.RIGHT);
  assert.ok(document.querySelector(".playback-deck"), "the deck did not open");
  expect(screen.queryByRole("button", { name: "More" })).toBeNull();
  expect(document.querySelector(".playback-drawer")).toBeNull();
  press(KEY.BACK);
  await hold(KEY.ENTER);

  const info = screen.getByRole("complementary", { name: "Playback information" });
  expect(info.textContent).toContain("hls.js");
  expect(info.textContent).toMatch(/1920.*1080/);
  expect(info.textContent).toContain("50 fps");
});

test("Back from an Audio drawer lands on the deck, then Back closes it", async () => {
  await mount({ playerTracks: MATRIX_TRACKS });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
  expect(document.querySelector(".playback-drawer")).toBeTruthy();

  press(KEY.BACK);
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".playback-drawer")).toBeNull();
    },
    { interval: 10 },
  );
  assert.ok(document.querySelector(".playback-deck"), "Back closed the deck under the drawer");
  expect(document.querySelector('[data-control="audio"][data-selected]')).toBeTruthy();

  press(KEY.BACK);
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
});

test("Back above a playback drawer closes one modal surface", async () => {
  await mount({ playerTracks: MATRIX_TRACKS });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
  expect(document.querySelector(".playback-drawer")).toBeTruthy();

  press(KEY.YELLOW);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(document.querySelector(".playback-drawer")).toBeNull();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeNull();
  expect(document.querySelector(".playback-drawer")).toBeTruthy();
});

test("the blue key does not open playback surfaces", async () => {
  await mount();
  press(KEY.BLUE);
  press(KEY.ENTER);

  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
  assert.equal(Boolean(document.querySelector(".playback-drawer")), false);
});

test("a terminal failure closes the deck and keeps Play or Pause inert", async () => {
  await mount({ faultPicture: true });
  press(KEY.ENTER);
  await settle(600);

  assert.equal(Boolean(document.querySelector(".pb-stack")), false);
  assert.ok(document.querySelector(".picture-state"), "no failure card showed");
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
  press(KEY.PLAY_PAUSE);
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
});

test("no key that leaves you at the picture can strand you there", async () => {
  await mount();
  press(KEY.ENTER);

  /*
   * The claim the source makes is that there is no state *at the picture* where channel up
   * leaves the viewer where they were, which is what makes it impossible to get stuck.
   *
   * Keys that deliberately go somewhere else are not part of it and are covered above: OK
   * and Left open the panel, Right and the pause keys open the deck, Stop returns to the
   * panel, RETURN offers the exit. What is swept here is every key that answers and leaves
   * you watching, and each of the ones that open the deck is sent home before the next.
   */
  const staysAtThePicture = [
    KEY.GREEN, // favourites, and raises a message
    KEY.RIGHT, // opens the deck, closed below
    KEY.PLAY,
    KEY.PAUSE,
    KEY.FORWARD, // reloads the channel
    KEY.YELLOW - 1, // a key the app does not handle at all
  ];

  for (const code of staysAtThePicture) {
    press(code);
    assert.ok(!panelOpen(), `key ${code} was expected to leave the viewer watching`);
    if (code === KEY.PAUSE) press(KEY.PLAY);
    if (document.querySelector(".playback-deck")) press(KEY.BACK);
    const before = played.length;
    press(KEY.UP);
    await settle(600);
    assert.ok(played.length > before, `channel up did nothing after key ${code}`);
  }
});

// ---- the finite picture has its own meanings ------------------------------------------

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

async function startMovie(slowPicture = 0, faultPicture = false) {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: VOD_FETCH,
    slowPicture,
    faultPicture,
  });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  press(KEY.RIGHT);
  const film = screen.getByRole("button", { name: /Film/ });
  film.focus();
  fireEvent.click(film);
  await settle(0);
  const play = screen.getByRole("button", { name: /^(Play|Resume)\b/ });
  play.focus();
  fireEvent.click(play);
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(playCalls.filter((call) => call[3] === "finite")).toHaveLength(1);
    },
    { interval: 10 },
  );
}

async function startPendingMovie() {
  let resolveUrl: ((url: string) => void) | undefined;
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: VOD_FETCH,
    playbackUrl: () =>
      new Promise<string>((resolve) => {
        resolveUrl = resolve;
      }),
  });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  press(KEY.RIGHT);
  const film = screen.getByRole("button", { name: /Film/ });
  film.focus();
  fireEvent.click(film);
  await settle(0);
  const play = screen.getByRole("button", { name: /^(Play|Resume)\b/ });
  play.focus();
  fireEvent.click(play);
  await settle(0);
  return (url = "http://provider.example/movie/100.mp4") => resolveUrl?.(url);
}

test.each([
  ["Movies", "Film", "en", KEY.LEFT, KEY.RIGHT],
  ["Series", "Show", "en", KEY.LEFT, KEY.RIGHT],
  ["Movies", "Film", "ar", KEY.RIGHT, KEY.LEFT],
] as const)(
  "%s details give %s a Back rail in %s",
  async (mode, title, locale, inlineStart, inlineEnd) => {
    await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH, locale });
    const { translate } = await import("../src/services/locale");
    const navigationButton = screen.getByRole("button", {
      name: translate(locale, mode === "Movies" ? "content.movies" : "content.series"),
    });
    navigationButton.focus();
    fireEvent.click(navigationButton);
    await settle(300);
    expect(document.querySelector(".vod-detail-back")).toBeNull();
    const poster = screen.getByRole("button", { name: title, exact: true });
    poster.focus();
    fireEvent.click(poster);
    await settle(0);

    const back = screen.getByRole("button", {
      name: translate(locale, "common.back"),
      exact: true,
    });
    expect(back.classList.contains("vod-detail-back")).toBe(true);
    expect(back.textContent).toBe("");
    expect(document.querySelectorAll(".vod-detail-back")).toHaveLength(1);
    const firstAction = document.querySelector<HTMLButtonElement>(".vod-action")!;
    firstAction.focus();
    const callsBeforeBack = playCalls.length;
    press(inlineStart);
    expect(back.hasAttribute("data-selected")).toBe(true);
    expect(document.querySelector(".app-navigation.expanded")).toBeNull();
    press(KEY.DOWN);
    expect(back.hasAttribute("data-selected")).toBe(true);
    press(inlineEnd);
    expect(firstAction.classList.contains("cursor")).toBe(true);
    press(inlineStart);
    press(KEY.ENTER);
    await settle(0);

    expect(document.querySelector(".vod-details")).toBeNull();
    expect(document.querySelector(".vod-detail-back")).toBeNull();
    expect(document.querySelector(".poster-card.cursor")?.textContent).toContain(title);
    expect(playCalls).toHaveLength(callsBeforeBack);
    const { usePersonal } = await import("../src/stores/personal");
    expect(usePersonal.getState().favourites).toHaveLength(0);
  },
);

test("pointer Back restores the movie catalogue selection and its rendered window", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      if (new URL(String(input)).searchParams.get("action") === "get_vod_streams") {
        return new Response(
          JSON.stringify(
            Array.from({ length: 40 }, (_, index) => ({
              stream_id: String(100 + index),
              category_id: "10",
              name: `Film ${index}`,
              container_extension: "mp4",
            })),
          ),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      return VOD_FETCH(input);
    },
  });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  await finishPageEntry();
  const first = screen.getByRole("button", { name: /^Film 0$/ });
  first.focus();
  press(KEY.RIGHT);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  await settle(32);
  const selected = document.querySelector<HTMLButtonElement>(".poster-card.cursor")!;
  const index = selected.dataset.posterIndex;
  expect(Number(index)).toBeGreaterThan(0);
  const windowTransform = document.querySelector<HTMLElement>(".poster-grid")!.style.transform;
  const renderedIndices = Array.from(document.querySelectorAll(".poster-card")).map((card) =>
    card.getAttribute("data-poster-index"),
  );
  fireEvent.click(selected);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Back", exact: true }));
  await settle(0);
  expect(document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index")).toBe(
    index,
  );
  expect(document.querySelector<HTMLElement>(".poster-grid")!.style.transform).toBe(
    windowTransform,
  );
  expect(
    Array.from(document.querySelectorAll(".poster-card")).map((card) =>
      card.getAttribute("data-poster-index"),
    ),
  ).toEqual(renderedIndices);
});

test("pointer Back restores the movie search query, selection and rendered window", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  expect(document.querySelector(".vod-detail-back")).toBeNull();
  const input = screen.getByRole("textbox", { name: "Search Movies" });
  fireEvent.change(input, { target: { value: "Film" } });
  await settle(300);
  const film = screen.getByRole("button", { name: /^Film$/ });
  film.focus();
  const index = film.getAttribute("data-poster-index");
  const windowTransform = document.querySelector<HTMLElement>(".poster-grid")!.style.transform;
  fireEvent.click(film);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Back", exact: true }));
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Search Movies" })).toHaveProperty(
    "value",
    "Film",
  );
  expect(document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index")).toBe(
    index,
  );
  expect(document.querySelector<HTMLElement>(".poster-grid")!.style.transform).toBe(
    windowTransform,
  );
  expect(document.querySelector(".vod-detail-back")).toBeNull();
});

test("Series pointer Back collapses episodes before restoring the catalogue", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH });
  const series = screen.getByRole("button", { name: "Series" });
  series.focus();
  fireEvent.click(series);
  await settle(300);
  const show = screen.getByRole("button", { name: "Show", exact: true });
  show.focus();
  fireEvent.click(show);
  await settle(0);
  const episodes = screen.getByRole("button", { name: /Episodes/ });
  episodes.focus();
  fireEvent.click(episodes);
  expect(document.querySelector(".series-details.panel-open")).toBeTruthy();
  const back = screen.getByRole("button", { name: "Back", exact: true });
  fireEvent.click(back);
  expect(document.querySelector(".series-details.panel-open")).toBeNull();
  expect(document.querySelector(".vod-details")).toBeTruthy();
  expect(back.hasAttribute("data-selected")).toBe(true);
  fireEvent.click(back);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Show");

  fireEvent.click(screen.getByRole("button", { name: "Show", exact: true }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /Episodes/ }));
  press(KEY.BACK);
  expect(document.querySelector(".series-details.panel-open")).toBeNull();
  expect(document.querySelector(".vod-details")).toBeTruthy();
  press(KEY.BACK);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Show");
});

test.each([
  ["Movies", "Film", "get_vod_info"],
  ["Series", "Show", "get_series_info"],
] as const)(
  "%s keeps Back available during loading and failure without activating Retry",
  async (mode, title, detailAction) => {
    let finishDetail: ((response: Response) => void) | undefined;
    let detailRequests = 0;
    await mountApp("", {
      source: XTREAM_SOURCE,
      fetchImplementation: (input) => {
        if (new URL(String(input)).searchParams.get("action") === detailAction) {
          detailRequests += 1;
          return new Promise<Response>((resolve) => {
            finishDetail = resolve;
          });
        }
        return VOD_FETCH(input);
      },
    });
    const route = screen.getByRole("button", { name: mode });
    route.focus();
    fireEvent.click(route);
    await settle(300);
    const poster = screen.getByRole("button", { name: title, exact: true });
    poster.focus();
    fireEvent.click(poster);
    await settle(0);
    const back = screen.getByRole("button", { name: "Back", exact: true });
    expect(document.querySelector(".vod-details.loading")).toBeTruthy();
    press(KEY.LEFT);
    expect(back.hasAttribute("data-selected")).toBe(true);
    press(KEY.RIGHT);
    expect(back.hasAttribute("data-selected")).toBe(true);
    finishDetail!(new Response("{}", { status: 503 }));
    await settle(0);
    expect(document.querySelector(".vod-details.failed")).toBeTruthy();
    expect(back.hasAttribute("data-selected")).toBe(true);
    press(KEY.RIGHT);
    expect(document.querySelector(".vod-retry")?.hasAttribute("data-selected")).toBe(true);
    press(KEY.LEFT);
    const beforeBack = detailRequests;
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".vod-details")).toBeNull();
    expect(detailRequests).toBe(beforeBack);
    expect(playCalls).toHaveLength(0);
  },
);

test("pointer Back cancels pending VOD resolution before returning to its poster", async () => {
  const resolveUrl = await startPendingMovie();
  const back = screen.getByRole("button", { name: "Back", exact: true });
  expect(back.hasAttribute("disabled")).toBe(false);
  fireEvent.click(back);
  resolveUrl();
  await settle(0);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(playCalls).toHaveLength(0);
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Film");
});

test.each(["empty", "too-large"] as const)(
  "Back returns to Retry when the raw movie detail resource is %s without a value",
  async (state) => {
    await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH });
    const movies = screen.getByRole("button", { name: "Movies" });
    movies.focus();
    fireEvent.click(movies);
    await settle(300);
    const film = screen.getByRole("button", { name: /Film/ });
    film.focus();
    fireEvent.click(film);
    await settle(0);
    const { useLibrary } = await import("../src/stores/library");
    const itemKey = Object.keys(useLibrary.getState().movieDetails)[0];
    act(() =>
      useLibrary.setState({
        movieDetails: { ...useLibrary.getState().movieDetails, [itemKey]: { state } },
      }),
    );
    const back = screen.getByRole("button", { name: "Back", exact: true });
    fireEvent.focus(back);
    press(KEY.RIGHT);
    expect(document.querySelector(".vod-retry")?.hasAttribute("data-selected")).toBe(true);
    press(KEY.LEFT);
    press(KEY.ENTER);
    expect(document.querySelector(".vod-details")).toBeNull();
    expect(playCalls).toHaveLength(0);
  },
);

test("Stop invalidates a pending asynchronous VOD start", async () => {
  const resolveUrl = await startPendingMovie();

  press(KEY.STOP);
  resolveUrl();
  await settle(0);

  expect(playCalls).toEqual([]);
  expect(document.querySelector(".vod-details")).toBeTruthy();
});

test("Back cancels pending VOD resolution and returns to its poster", async () => {
  const resolveUrl = await startPendingMovie();

  press(KEY.BACK);
  resolveUrl();
  await settle(0);

  expect(playCalls).toEqual([]);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Film");
  expect(document.querySelector(".dialog")).toBeNull();
});

test("pending VOD resolution owns arrows, channel keys and digits", async () => {
  const resolveUrl = await startPendingMovie();

  press(KEY.UP);
  press(KEY.DOWN);
  press(KEY.CH_UP);
  press(KEY.CH_DOWN);
  press(1 + 48);
  await settle(2_100);

  expect(playCalls).toEqual([]);
  expect(document.querySelector(".digits")).toBeNull();
  expect(document.querySelector(".vod-details")).toBeTruthy();

  resolveUrl();
  await settle(0);
  expect(playCalls).toHaveLength(1);
  expect(played[0]).toContain("movie/100.mp4");
});

test.each([
  ["Live", [KEY.UP], ".vod-host:not(.hidden) .vod-screen", false],
  ["Series", [KEY.DOWN], ".vod-host:not(.hidden) .vod-screen[data-mode='series']", true],
  ["Search", [KEY.DOWN, KEY.DOWN], ".search-field", true],
  ["Settings", [KEY.DOWN, KEY.DOWN, KEY.DOWN], ".settings-host:not(.hidden) .sheet", true],
] as const)(
  "remote %s activation cancels pending VOD resolution",
  async (_name, directions, selector, expected) => {
    const resolveUrl = await startPendingMovie();

    press(KEY.UP);
    for (const direction of directions) press(direction);
    const action = screen.queryByRole("button", {
      name: _name === "Search" ? /^Search/ : _name,
    });
    if (action) {
      expect(action.classList.contains("cursor")).toBe(true);
      press(KEY.ENTER);
    } else {
      expect(_name).toBe("Settings");
    }
    resolveUrl();
    await settle(0);

    expect(played.some((url) => url.includes("movie/100.mp4"))).toBe(false);
    expect(Boolean(document.querySelector(selector))).toBe(expected);
    expect(document.querySelector(".vod-action:disabled")).toBeNull();
  },
);

test("finite picture seek opens the deck on its target and Up and Down remain inert after it closes", async () => {
  await startMovie();
  expect(playCalls).toHaveLength(1);
  expect(document.querySelector(".vod-host")?.classList.contains("hidden")).toBe(true);

  press(KEY.RIGHT);
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(document.querySelector('[data-control="seek"][data-selected]')).toBeTruthy();
  await settle(SEEK_SETTLE_MS - 1);
  expect(seekChanges).toEqual([]);
  await settle(1);
  expect(seekChanges).toEqual([10]);
  press(KEY.BACK);

  const started = played.length;
  press(KEY.UP);
  press(KEY.DOWN);
  press(KEY.CH_UP);
  press(KEY.CH_DOWN);
  await settle(600);
  assert.equal(
    played.length,
    started,
    "a direction or channel key changed the channel on a film",
  );
  assert.equal(
    Boolean(document.querySelector(".playback-deck")),
    false,
    "up or down opened the deck",
  );
});

test("the finite seek deck previews reversals immediately and sends only the settled target", async () => {
  await startMovie();
  press(KEY.RIGHT);
  await settle(SEEK_SETTLE_MS);
  expect(seekChanges).toEqual([10]);
  const seekbar = screen.getByRole("slider");
  expect(seekbar.getAttribute("aria-valuenow")).toBe("10");
  expect(seekbar.hasAttribute("data-selected")).toBe(true);

  press(KEY.RIGHT);
  expect(seekbar.getAttribute("aria-valuenow")).toBe("20");
  await settle(600);
  expect(seekChanges).toEqual([10]);
  press(KEY.RIGHT);
  expect(seekbar.getAttribute("aria-valuenow")).toBe("30");
  await settle(600);
  expect(seekChanges).toEqual([10]);
  press(KEY.LEFT);
  expect(seekbar.getAttribute("aria-valuenow")).toBe("20");
  expect(seekbar.hasAttribute("data-selected")).toBe(true);
  expect(seekChanges).toEqual([10]);

  await settle(SEEK_SETTLE_MS - 1);
  expect(seekChanges).toEqual([10]);
  expect(seekbar.getAttribute("aria-valuenow")).toBe("20");
  expect(seekbar.hasAttribute("data-selected")).toBe(true);
  await settle(1);
  expect(seekChanges).toEqual([10, 10]);
  expect(seekbar.hasAttribute("data-selected")).toBe(true);
});

test("Play or Pause at the finite picture opens the deck", async () => {
  await startMovie();

  press(KEY.PLAY_PAUSE);
  assert.ok(document.querySelector(".playback-deck"), "Play or Pause did not open the deck");
});

test("Play or Pause remains available while a finite movie loads", async () => {
  await startMovie(2_000);

  press(KEY.PLAY_PAUSE);

  const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]');
  expect(control).toBeTruthy();
  expect(control?.disabled).toBe(false);
  expect(control?.hasAttribute("data-selected")).toBe(true);
});

test("Stop at the finite picture returns to the details it came from", async () => {
  await startMovie();

  press(KEY.STOP);
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeTruthy();
  expect(screen.getByText("Film")).toBeTruthy();
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
});

test("natural VOD completion releases playback and returns to its details", async () => {
  await startMovie();

  emitPlayback({ type: "ended" });
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeTruthy();
  expect(document.querySelector('.live-panel-host[aria-hidden="false"] .panel')).toBeNull();
  press(KEY.YELLOW);
  expect(document.querySelector(".settings-host:not(.hidden) .sheet")).toBeTruthy();
  expect(muted).toBe(false);
});

test("a rebuffer under the delay stays quiet and a real one shows compact status", async () => {
  await mount();
  press(KEY.ENTER); // start the focused channel and uncover the picture
  await settle(0);

  emitPlayback({ type: "buffering-start" });
  await settle(1_400);
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "a brief stall announced itself",
  );

  await settle(300);
  const status = document.querySelector(".recovery-status");
  assert.ok(status, "a real rebuffer showed no status");
  assert.equal(status?.getAttribute("role"), "status");
  assert.ok(document.querySelector(".top-strip"), "the status does not sit beside the clock");

  emitPlayback({ type: "buffering-complete" });
  emitPlayback({ type: "playing" });
  await settle(0);
  assert.equal(Boolean(document.querySelector(".recovery-status")), false);
});

test("the deck, a drawer, the browser and a modal hide the compact status", async () => {
  await mount({ playerTracks: MATRIX_TRACKS });
  press(KEY.ENTER); // start the focused channel
  await settle(0);

  // The channel list is itself a covering surface.
  press(KEY.ENTER);
  emitPlayback({ type: "buffering-start" });
  await settle(1_600);
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "status showed under the channel list",
  );

  press(KEY.BACK); // back to the picture, where it appears
  await settle(0);
  assert.ok(document.querySelector(".recovery-status"), "status never appeared");

  press(KEY.RIGHT); // the deck
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "status showed under the deck",
  );

  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
  assert.ok(document.querySelector(".playback-drawer"), "the Audio drawer did not open");
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "status showed under the drawer",
  );

  press(KEY.BACK); // drawer to deck
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".playback-drawer")).toBeNull();
    },
    { interval: 10 },
  );
  press(KEY.BACK); // deck to picture, status returns
  assert.ok(document.querySelector(".recovery-status"), "status did not come back");

  press(KEY.BACK); // nothing left, so the exit dialog asks
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "status showed under the exit dialog",
  );
});

// ---- the generated transition matrix ---------------------------------------------------

/*
 * Every surface's answer to every key worth asking about, written as data so a new surface
 * has to find its row rather than hope its handler is consistent. A row names the surface,
 * the focus inside it, the key, and the focus owner after the press, and the check is that
 * the press lands where the row says or deliberately does nothing.
 */

const MATRIX_TRACKS: MediaTrack[] = [
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
  {
    id: "s0",
    identity: "s0",
    engineIndex: 0,
    kind: "subtitle",
    label: "English",
    language: "en",
    selected: false,
  },
];

/** Which surface owns the next keypress, and which control inside it. */
function readFocusOwner(): string {
  if (
    document.querySelector(".dialog") ||
    document.querySelector(".settings-host:not(.hidden) .sheet")
  )
    return "modal";
  if (document.querySelector(".playback-drawer")) return "drawer";
  const deck = document.querySelector(".playback-deck");
  if (deck) {
    const selected = deck.querySelector("[data-selected]");
    return `deck:${selected?.getAttribute("data-control") ?? "none"}`;
  }
  if (panelOpen()) return "panel";
  return "picture";
}

const livePicture = async () => {
  await mount();
  press(KEY.ENTER); // watch the first channel, banner up
};
const livePictureCalm = async () => {
  await livePicture();
  press(KEY.BACK); // banner down, still at the picture
};
const liveBrowser = async () => {
  await mount();
};
const liveDeck = async () => {
  await livePicture();
  press(KEY.RIGHT);
};
const liveDeckSeek = async () => {
  await mount({ liveDvr: true });
  press(KEY.ENTER);
  await settle(2_100);
  press(KEY.RIGHT);
  press(KEY.UP);
};
const liveDeckWithGuide = async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });
  press(KEY.ENTER);
  await settle(200);
  press(KEY.RIGHT);
};
const guideDrawer = async () => {
  await liveDeckWithGuide();
  press(KEY.RIGHT);
  press(KEY.ENTER);
};
const audioDrawer = async () => {
  await mount({ playerTracks: MATRIX_TRACKS });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
};
const subtitlesDrawer = async () => {
  await mount({ playerTracks: MATRIX_TRACKS });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Subtitles" }));
};
const finitePicture = startMovie;
const finiteDeck = async () => {
  await startMovie();
  press(KEY.PLAY_PAUSE);
};
const exitDialog = async () => {
  await livePictureCalm();
  press(KEY.BACK); // nothing left to close, so it asks
};

const TRANSITIONS: {
  surface: string;
  focus: string;
  key: number;
  arrange: () => Promise<void>;
  expected: string;
}[] = [
  // The uncovered Live picture
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.UP,
    arrange: livePicture,
    expected: "picture",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.DOWN,
    arrange: livePicture,
    expected: "picture",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.ENTER,
    arrange: livePicture,
    expected: "panel",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.LEFT,
    arrange: livePicture,
    expected: "panel",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.RIGHT,
    arrange: livePicture,
    expected: "deck:play-pause",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.PLAY_PAUSE,
    arrange: livePicture,
    expected: "deck:play-pause",
  },
  {
    surface: "live picture",
    focus: "channel",
    key: KEY.BACK,
    arrange: livePictureCalm,
    expected: "modal",
  },

  // The Live browser
  {
    surface: "live browser",
    focus: "channel row",
    key: KEY.UP,
    arrange: liveBrowser,
    expected: "panel",
  },
  {
    surface: "live browser",
    focus: "channel row",
    key: KEY.DOWN,
    arrange: liveBrowser,
    expected: "panel",
  },
  {
    surface: "live browser",
    focus: "channel row",
    key: KEY.ENTER,
    arrange: liveBrowser,
    expected: "picture",
  },
  {
    surface: "live browser",
    focus: "channel row",
    key: KEY.BACK,
    arrange: liveBrowser,
    expected: "picture",
  },

  // The deck over Live
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.LEFT,
    arrange: liveDeck,
    expected: "deck:previous",
  },
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.RIGHT,
    arrange: liveDeck,
    expected: "deck:next",
  },
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.UP,
    arrange: liveDeck,
    expected: "picture",
  },
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.BACK,
    arrange: liveDeck,
    expected: "picture",
  },
  {
    surface: "live deck",
    focus: "guide",
    key: KEY.RIGHT,
    arrange: async () => {
      await liveDeckWithGuide();
      press(KEY.RIGHT);
    },
    expected: "deck:guide", // the trailing edge clamps rather than wrapping
  },
  {
    surface: "live deck",
    focus: "next",
    key: KEY.RIGHT,
    arrange: async () => {
      await liveDeck();
      press(KEY.RIGHT);
    },
    expected: "deck:next",
  },

  // The delayed Live seek bar, and Go live one step past its edge
  {
    surface: "live deck",
    focus: "seek",
    key: KEY.LEFT,
    arrange: liveDeckSeek,
    expected: "deck:seek",
  },
  {
    surface: "live deck",
    focus: "seek",
    key: KEY.DOWN,
    arrange: liveDeckSeek,
    expected: "deck:play-pause",
  },
  {
    surface: "live deck",
    focus: "seek",
    key: KEY.UP,
    arrange: liveDeckSeek,
    expected: "picture",
  },
  {
    surface: "live deck",
    focus: "seek",
    key: KEY.RIGHT,
    arrange: async () => {
      await mount({ liveDvr: true });
      setPlaybackTime(3580, 3600);
      press(KEY.ENTER);
      await settle(2_100); // let the live clock publish the playhead before the deck reads it
      press(KEY.RIGHT); // the deck, and its bar starts at the playhead
      press(KEY.UP);
      press(KEY.RIGHT); // toward the edge
      press(KEY.RIGHT); // the clamped end of the window
    },
    expected: "deck:go-live",
  },
  {
    surface: "live deck",
    focus: "go-live",
    key: KEY.LEFT,
    arrange: async () => {
      await mount({ liveDvr: true });
      setPlaybackTime(3580, 3600);
      press(KEY.ENTER);
      await settle(2_100);
      press(KEY.RIGHT);
      press(KEY.UP);
      press(KEY.RIGHT);
      press(KEY.RIGHT); // one step past the end, onto Go live
    },
    expected: "deck:seek",
  },

  // Each drawer over the deck, and Back restoring the action that asked
  {
    surface: "audio drawer",
    focus: "rows",
    key: KEY.BACK,
    arrange: audioDrawer,
    expected: "deck:audio",
  },
  {
    surface: "audio drawer",
    focus: "rows",
    key: KEY.UP,
    arrange: audioDrawer,
    expected: "drawer",
  },
  {
    surface: "subtitles drawer",
    focus: "rows",
    key: KEY.BACK,
    arrange: subtitlesDrawer,
    expected: "deck:subtitles",
  },
  {
    surface: "subtitles drawer",
    focus: "rows",
    key: KEY.DOWN,
    arrange: subtitlesDrawer,
    expected: "drawer",
  },
  {
    surface: "guide drawer",
    focus: "rows",
    key: KEY.BACK,
    arrange: guideDrawer,
    expected: "deck:guide",
  },
  {
    surface: "guide drawer",
    focus: "rows",
    key: KEY.DOWN,
    arrange: guideDrawer,
    expected: "drawer",
  },

  // The uncovered finite picture
  {
    surface: "finite picture",
    focus: "playhead",
    key: KEY.LEFT,
    arrange: finitePicture,
    expected: "deck:seek",
  },
  {
    surface: "finite picture",
    focus: "playhead",
    key: KEY.RIGHT,
    arrange: finitePicture,
    expected: "deck:seek",
  },
  {
    surface: "finite picture",
    focus: "playhead",
    key: KEY.UP,
    arrange: finitePicture,
    expected: "picture",
  },
  {
    surface: "finite picture",
    focus: "playhead",
    key: KEY.PLAY_PAUSE,
    arrange: finitePicture,
    expected: "deck:play-pause",
  },

  // The deck over finite playback
  {
    surface: "finite deck",
    focus: "play-pause",
    key: KEY.UP,
    arrange: finiteDeck,
    expected: "deck:seek",
  },
  {
    surface: "finite deck",
    focus: "play-pause",
    key: KEY.LEFT,
    arrange: finiteDeck,
    expected: "deck:details",
  },
  {
    surface: "finite deck",
    focus: "play-pause",
    key: KEY.BACK,
    arrange: finiteDeck,
    expected: "picture",
  },
  {
    surface: "finite deck",
    focus: "details",
    key: KEY.LEFT,
    arrange: async () => {
      await finiteDeck();
      press(KEY.LEFT);
      press(KEY.LEFT); // previous, then details, the leading edge
    },
    expected: "deck:details", // clamps at the leading edge
  },

  // The modal owns everything while it asks
  {
    surface: "exit dialog",
    focus: "dialog",
    key: KEY.UP,
    arrange: exitDialog,
    expected: "modal",
  },
  { surface: "exit dialog", focus: "dialog", key: 53, arrange: exitDialog, expected: "modal" },
  {
    surface: "exit dialog",
    focus: "dialog",
    key: KEY.BACK,
    arrange: exitDialog,
    expected: "picture",
  },
];

test.each(TRANSITIONS)("$surface $focus handles $key", async ({ arrange, key, expected }) => {
  await arrange();
  press(key);
  await settle(0);
  expect(readFocusOwner()).toEqual(expected);
});

const finishContentMotion = async () => {
  await settle(400);
  await settle(64);
  await settle(400);
};

const vodWindowFetch = async (input: string | URL) => {
  const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
  if (action === "get_vod_streams") {
    return new Response(
      JSON.stringify(
        Array.from({ length: 40 }, (_, index) => ({
          stream_id: String(100 + index),
          category_id: "10",
          name: `Film ${index}`,
          container_extension: "mp4",
        })),
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (action === "get_series") {
    return new Response(
      JSON.stringify(
        Array.from({ length: 40 }, (_, index) => ({
          series_id: String(200 + index),
          category_id: "20",
          name: `Show ${index}`,
        })),
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  return VOD_FETCH(input);
};

test.each([
  ["Movies", "Film"],
  ["Series", "Show"],
] as const)(
  "%s details motion covers entry and Back without touching the catalogue",
  async (mode, title) => {
    await mountApp("", {
      source: XTREAM_SOURCE,
      fetchImplementation: vodWindowFetch,
    });
    const navigationButton = screen.getByRole("button", { name: mode });
    navigationButton.focus();
    fireEvent.click(navigationButton);
    await settle(300);
    await finishPageEntry();

    document.documentElement.style.setProperty("--t-navigation", "180ms");
    try {
      const first = screen.getByRole("button", {
        name: new RegExp(`^${title} 0$`),
      });
      first.focus();
      press(KEY.RIGHT);
      press(KEY.DOWN);
      press(KEY.DOWN);
      press(KEY.DOWN);
      await settle(32);
      const selected = document.querySelector<HTMLButtonElement>(".poster-card.cursor")!;
      const index = selected.dataset.posterIndex;
      expect(Number(index)).toBeGreaterThan(0);
      const transform = document.querySelector<HTMLElement>(".poster-grid")!.style.transform;
      const rendered = Array.from(document.querySelectorAll(".poster-card")).map((card) =>
        card.getAttribute("data-poster-index"),
      );
      const plays = playCalls.length;

      fireEvent.click(selected);
      expect(document.querySelector(".vod-details")).toBeNull();
      expect(
        document
          .querySelector(".vod-host .content-transition-shade")
          ?.getAttribute("data-phase"),
      ).toBe("leaving");
      expect(
        document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
      ).toBe(index);

      press(KEY.DOWN);
      press(KEY.ENTER);
      press(KEY.BACK);
      await settle(0);
      expect(document.querySelector(".vod-details")).toBeNull();
      expect(
        document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
      ).toBe(index);
      expect(playCalls.length).toBe(plays);

      await finishContentMotion();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.querySelector(".vod-details")).toBeNull();
      fireEvent.click(document.querySelector<HTMLButtonElement>(".poster-card.cursor")!);
      await finishContentMotion();
      expect(document.querySelector(".vod-details")).toBeTruthy();
      expect(document.querySelector(".vod-action.cursor")).toBeTruthy();
      expect(document.querySelector(".vod-detail-back")?.hasAttribute("data-selected")).toBe(
        false,
      );

      press(KEY.BACK);
      expect(document.querySelector(".vod-details")).toBeNull();
      await finishContentMotion();
      expect(document.querySelector(".vod-details")).toBeNull();
      expect(
        document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
      ).toBe(index);
      expect(document.querySelector<HTMLElement>(".poster-grid")!.style.transform).toBe(
        transform,
      );
      expect(
        Array.from(document.querySelectorAll(".poster-card")).map((card) =>
          card.getAttribute("data-poster-index"),
        ),
      ).toEqual(rendered);
      expect(playCalls.length).toBe(plays);
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

test("a source replacement during pending details entry keeps the obsolete title closed", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: vodWindowFetch,
  });
  const movies = screen.getByRole("button", { name: "Movies" });
  movies.focus();
  fireEvent.click(movies);
  await settle(300);
  await finishPageEntry();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    const poster = screen.getByRole("button", { name: /^Film 0$/ });
    poster.focus();
    fireEvent.click(poster);
    expect(
      document.querySelector(".vod-host .content-transition-shade")?.getAttribute("data-phase"),
    ).toBe("leaving");

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
    expect(document.querySelector(".vod-details")).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});
