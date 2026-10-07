import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import type { MediaTrack } from "../src/types";
import {
  emitPlayback,
  hold,
  mountApp,
  muted,
  panelOpen,
  playCalls,
  setPlaybackTime,
  played,
  press,
  seekChanges,
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("the playlist arrives and the panel opens on it", async () => {
  await mount();
  expect(document.querySelectorAll(".app")).toHaveLength(1);
  expect(document.querySelectorAll("video.video")).toHaveLength(1);
  expect(document.querySelectorAll(".panel")).toHaveLength(1);
  assert.ok(panelOpen(), "the app should open on the channel list");
  expect(screen.getByText("Alpha")).toBeTruthy();
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
  // Naming is immediate and tuning waits for the pressing to stop, so the channel has been
  // named but not yet tuned.
  assert.equal(played.length, started, "tuned before the viewer had finished pressing");
  await settle(600);
  assert.equal(played.length, started + 1, "channel up did not tune anything");
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

test("OK at the Live picture answers on the press, with no held action", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);

  await hold(KEY.ENTER);

  assert.ok(panelOpen(), "OK did not reach the browser a plain press reaches");
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
  // Right opens the deck; Guide is the leading action, one step left of Play or Pause.
  press(KEY.RIGHT);
  press(KEY.LEFT);
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
  expect(panelOpen()).toBe(false);

  press(KEY.BACK);
  press(KEY.LEFT);
  expect(document.querySelector(".list .row.selected .row-label")?.textContent).toBe(
    "Provider One",
  );
  expect(panelOpen()).toBe(true);
});

test("law 4 returns from a Guide opened in the browser to the same channel row", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });

  press(KEY.ENTER);
  await settle(0);
  press(KEY.LEFT); // the panel, standing on the channel row
  await settle(200); // the focused channel's guide settles first, so the bar offers Guide
  fireEvent.click(screen.getByRole("button", { name: "Guide" }));
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(panelOpen()).toBe(false);

  press(KEY.BACK);
  expect(document.querySelector(".guide-drawer.closing")).toBeTruthy();
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
  /* The drawer came from the browser, so Back lands back on the browser channel row. */
  expect(panelOpen()).toBe(true);
  expect(document.querySelector(".list .row.selected .row-label")?.textContent).toBe(
    "Provider One",
  );
});

test("Catchup Details returns to the Guide that started playback", async () => {
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
  press(KEY.LEFT);
  press(KEY.ENTER);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Play from start" }));
  await settle(0);
  press(KEY.BACK);
  await settle(180);
  press(KEY.ENTER);
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  await settle(0);

  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(document.querySelector(".panel")).toBeTruthy();
  expect(panelOpen()).toBe(false);
  expect(screen.getByText("Morning News")).toBeTruthy();
});

test("law 4 returns from the VOD root to the Live picture", async () => {
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

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(screen.getByRole("button", { name: "Movies" }).getAttribute("aria-pressed")).toBe(
    "true",
  );

  press(KEY.BACK);
  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".dialog")).toBeNull();
});

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
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: /Film/ }));
  await settle(0);

  press(KEY.BACK);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".vod-screen")).toBeTruthy();
  expect(screen.getByText("Film")).toBeTruthy();

  press(KEY.BACK);
  expect(document.querySelector(".vod-screen")).toBeNull();
  expect(panelOpen()).toBe(false);
});

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

test("the yellow key opens settings from anywhere", async () => {
  await mount();
  press(KEY.YELLOW);
  assert.ok(document.querySelector(".sheet"), "the settings sheet did not open");
});

test("opening Settings cancels a pending numeric dial", async () => {
  await mount();
  const started = played.length;
  press(50);
  expect(document.querySelector(".digits")?.textContent).toBe("2");

  press(KEY.YELLOW);
  await settle(2_100);

  expect(document.querySelector(".sheet")).toBeTruthy();
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

test("double clicking the browser video toggles application fullscreen", async () => {
  await mount();
  const video = document.querySelector("video");
  const app = document.querySelector(".app");
  assert.ok(video, "the browser video was not rendered");
  assert.ok(app, "the application root was not rendered");

  let fullscreen: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreen,
  });
  app.requestFullscreen = vi.fn(async () => {
    fullscreen = app;
  });
  document.exitFullscreen = vi.fn(async () => {
    fullscreen = null;
  });

  video.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  assert.equal(app.requestFullscreen.mock.calls.length, 1);
  assert.equal(document.exitFullscreen.mock.calls.length, 0);

  video.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  assert.equal(document.exitFullscreen.mock.calls.length, 1);
});

test("the green key favourites the highlighted channel and says so", async () => {
  await mount();
  press(KEY.GREEN);
  expect(screen.getByText("Added to favourites")).toBeTruthy();
});

test("playback information lives in the More drawer above the deck", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.BACK);

  press(KEY.RIGHT);
  assert.ok(document.querySelector(".playback-deck"), "the deck did not open");
  press(KEY.RIGHT); // play-pause to More, the last control
  press(KEY.ENTER);

  const info = screen.getByRole("complementary", { name: "Playback information" });
  expect(info.textContent).toContain("hls.js");
  expect(info.textContent).toMatch(/1920.*1080/);
  expect(info.textContent).toContain("avc1.640028");
  expect(info.textContent).toContain("4.5 Mbps");
  expect(info.textContent).toContain("12.4 s");
  expect(info.textContent).toContain("2 / 1000");
  expect(info.textContent).toContain("3 / 5");
});

test("Back from the More drawer lands on the deck, then Back closes it", async () => {
  await mount();
  press(KEY.ENTER);

  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  assert.ok(
    screen.getByRole("complementary", { name: "Playback information" }),
    "the More drawer did not open",
  );

  press(KEY.BACK);
  assert.equal(
    Boolean(screen.queryByRole("complementary", { name: "Playback information" })),
    false,
    "Back did not close the drawer",
  );
  assert.ok(document.querySelector(".playback-deck"), "Back closed the deck under the drawer");

  press(KEY.BACK);
  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
});

test("Back above a playback drawer closes one modal surface", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  expect(document.querySelector(".playback-drawer")).toBeTruthy();

  press(KEY.YELLOW);
  expect(document.querySelector(".sheet")).toBeTruthy();
  expect(document.querySelector(".playback-drawer")).toBeNull();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".sheet")).toBeNull();
  expect(document.querySelector(".playback-drawer")).toBeTruthy();
});

test("the blue key does not open playback surfaces", async () => {
  await mount();
  press(KEY.BLUE);
  press(KEY.ENTER);

  assert.equal(Boolean(document.querySelector(".playback-deck")), false);
  assert.equal(Boolean(document.querySelector(".playback-drawer")), false);
});

test("a terminal failure is reported on the picture and the banner stays down", async () => {
  await mount({ faultPicture: true });
  press(KEY.ENTER);
  await settle(600);

  assert.equal(Boolean(document.querySelector(".pb-stack")), false);
  assert.ok(document.querySelector(".picture-state"), "no failure card showed");
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

async function startMovie() {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: VOD_FETCH });
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: /Film/ }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /Play|Resume/ }));
  await settle(0);
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
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);
  fireEvent.click(screen.getByRole("button", { name: /Film/ }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /Play|Resume/ }));
  await settle(0);
  return (url = "http://provider.example/movie/100.mp4") => resolveUrl?.(url);
}

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
  ["Live", [KEY.LEFT], ".vod-screen", false],
  ["Movies", [], ".vod-screen[data-mode='movie']", true],
  ["Series", [KEY.RIGHT], ".vod-screen[data-mode='series']", true],
  ["Search", [KEY.RIGHT, KEY.RIGHT], ".vod-search", true],
  ["Settings", [KEY.RIGHT, KEY.RIGHT, KEY.RIGHT], ".sheet", true],
] as const)(
  "remote %s activation cancels pending VOD resolution",
  async (_name, directions, selector, expected) => {
    const resolveUrl = await startPendingMovie();

    press(KEY.UP);
    for (const direction of directions) press(direction);
    expect(screen.getByRole("button", { name: _name }).classList.contains("selected")).toBe(
      true,
    );
    press(KEY.ENTER);
    resolveUrl();
    await settle(0);

    expect(played.some((url) => url.includes("movie/100.mp4"))).toBe(false);
    expect(Boolean(document.querySelector(selector))).toBe(expected);
    expect(document.querySelector(".vod-action:disabled")).toBeNull();
  },
);

test("the uncovered finite picture quick seeks on Left and Right and ignores Up and Down", async () => {
  await startMovie();
  assert.equal(panelOpen(), false, "the movie did not start at the picture");

  press(KEY.RIGHT);
  expect(document.querySelector(".quick-seek")).toBeTruthy();
  await settle(400);
  expect(seekChanges).toEqual([10]);

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

test("Play or Pause at the finite picture opens the deck", async () => {
  await startMovie();

  press(KEY.PLAY_PAUSE);
  assert.ok(document.querySelector(".playback-deck"), "Play or Pause did not open the deck");
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
  expect(document.querySelector(".panel")).toBeNull();
  press(KEY.YELLOW);
  expect(document.querySelector(".sheet")).toBeTruthy();
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
  await mount();
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

  press(KEY.RIGHT); // play-pause to More
  press(KEY.ENTER); // the More drawer
  assert.ok(
    screen.getByRole("complementary", { name: "Playback information" }),
    "the More drawer did not open",
  );
  assert.equal(
    Boolean(document.querySelector(".recovery-status")),
    false,
    "status showed under the drawer",
  );

  press(KEY.BACK); // drawer to deck
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
  if (document.querySelector(".dialog") || document.querySelector(".sheet")) return "modal";
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
  press(KEY.LEFT);
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
const moreDrawer = async () => {
  await liveDeck();
  press(KEY.RIGHT); // Play or Pause to More, the trailing control
  press(KEY.ENTER);
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
    expected: "deck:play-pause",
  },
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.RIGHT,
    arrange: liveDeck,
    expected: "deck:more",
  },
  {
    surface: "live deck",
    focus: "play-pause",
    key: KEY.UP,
    arrange: liveDeck,
    expected: "deck:play-pause",
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
    key: KEY.LEFT,
    arrange: async () => {
      await liveDeckWithGuide();
      press(KEY.LEFT);
    },
    expected: "deck:guide", // the leading edge clamps rather than wrapping
  },
  {
    surface: "live deck",
    focus: "more",
    key: KEY.RIGHT,
    arrange: async () => {
      await liveDeck();
      press(KEY.RIGHT);
    },
    expected: "deck:more", // the trailing edge clamps rather than wrapping
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
    key: KEY.RIGHT,
    arrange: async () => {
      await mount({ liveDvr: true });
      setPlaybackTime(100, 120);
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
      setPlaybackTime(100, 120);
      press(KEY.ENTER);
      await settle(2_100);
      press(KEY.RIGHT);
      press(KEY.UP);
      press(KEY.RIGHT);
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
    surface: "more drawer",
    focus: "info",
    key: KEY.BACK,
    arrange: moreDrawer,
    expected: "deck:more",
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
    expected: "picture",
  },
  {
    surface: "finite picture",
    focus: "playhead",
    key: KEY.RIGHT,
    arrange: finitePicture,
    expected: "picture",
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
    expected: "deck:previous",
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
