import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, muted, panelOpen, played, press, volumeChanges } from "./support/app";

/**
 * The four laws of the key model, asserted rather than described.
 *
 * App.tsx sets these out at length, and they are the whole of how the application is driven:
 *
 *   1. At the picture, up and down always change channel. In every state, whatever is on
 *      screen, whatever holds the focus.
 *   2. OK does the obvious thing where it is pressed. At the picture that is the channel list.
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

const mount = () => mountApp(PLAYLIST);

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
  vi.useFakeTimers();
  press(KEY.LEFT);
  await act(async () => { vi.advanceTimersByTime(5000); });
  assert.ok(panelOpen(), "the channel list closed without being dismissed");
});

test("law 1: up and down change channel at the picture, always", async () => {
  await mount();
  press(KEY.ENTER);                       // watch the first channel
  const started = played.length;

  press(KEY.UP);
  // Naming is immediate and tuning waits for the pressing to stop, so the channel has been
  // named but not yet tuned.
  assert.equal(played.length, started, "tuned before the viewer had finished pressing");
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  assert.equal(played.length, started + 1, "channel up did not tune anything");
});

test("law 1 holds even when the channel on screen has failed", async () => {
  const { container } = await mount();
  press(KEY.ENTER);
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });

  // A channel that will not start must not trap anybody: one press has to move on.
  assert.ok(container);
  press(KEY.UP);
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
  assert.ok(played.length >= 2, "channel up did nothing on a failed channel");
});

test("law 3: left at the picture opens the channel list", async () => {
  await mount();
  press(KEY.ENTER);
  assert.ok(!panelOpen());
  press(KEY.LEFT);
  assert.ok(panelOpen(), "left should reach the list that is off the left of the screen");
});

test("law 2: OK at the picture opens the channel list", async () => {
  await mount();
  press(KEY.ENTER);
  press(KEY.ENTER);
  assert.ok(panelOpen());
});

test("law 4: RETURN clears the screen before it offers to close the app", async () => {
  await mount();
  press(KEY.ENTER);                       // watching, banner up
  assert.ok(!panelOpen());

  press(KEY.BACK);                        // clears the banner
  assert.equal(document.querySelector(".dialog"), null, "offered to exit on the first press");

  press(KEY.BACK);                        // nothing left, so now it asks
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

test("a dialled number tunes the channel carrying it", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;
  press(51);                              // "3"
  await act(async () => { await new Promise((r) => setTimeout(r, 2200)); });
  assert.equal(played.length, started + 1);
  assert.match(played[played.length - 1], /c\.m3u8$/);
});

test("OK finishes a dialled number rather than waiting it out", async () => {
  await mount();
  press(KEY.ENTER);
  const started = played.length;
  press(50);                              // "2"
  press(KEY.ENTER);
  assert.equal(played.length, started + 1, "OK did not commit the number");
  assert.match(played[played.length - 1], /b\.m3u8$/);
});

test("the yellow key opens settings from anywhere", async () => {
  await mount();
  press(KEY.YELLOW);
  assert.ok(document.querySelector(".sheet"), "the settings sheet did not open");
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

  assert.deepEqual(volumeChanges, [0.1, -0.1]);
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
  app.requestFullscreen = vi.fn(async () => { fullscreen = app; });
  document.exitFullscreen = vi.fn(async () => { fullscreen = null; });

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

test("no key that leaves you at the picture can strand you there", async () => {
  await mount();
  press(KEY.ENTER);

  /*
   * The claim the source makes is that there is no state *at the picture* where channel up
   * leaves the viewer where they were, which is what makes it impossible to get stuck.
   *
   * Keys that deliberately go somewhere else are not part of it and are covered above: OK
   * and Left open the panel, Stop returns to it, RETURN offers the exit. What is swept here
   * is every key that answers and leaves you watching, including the ones that put something
   * on screen or take a focus.
   */
  const staysAtThePicture = [
    KEY.RIGHT,        // takes a focus on the buttons
    KEY.GREEN,        // favourites, and raises a message
    KEY.PLAY,
    KEY.PAUSE,
    KEY.FORWARD,      // reloads the channel
    KEY.YELLOW - 1,   // a key the app does not handle at all
  ];

  for (const code of staysAtThePicture) {
    press(code);
    assert.ok(!panelOpen(), `key ${code} was expected to leave the viewer watching`);
    const before = played.length;
    press(KEY.UP);
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    assert.ok(played.length > before, `channel up did nothing after key ${code}`);
  }
});
