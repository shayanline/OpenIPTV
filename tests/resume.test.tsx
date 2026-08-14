import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, panelOpen, played, press, settle } from "./support/app";

/**
 * Coming back to what was on last time.
 *
 * A television that is switched on shows a picture. This used to show the channel list
 * instead: the panel opened on every launch, and only once the playlist had arrived and the
 * remembered channel had been found in it was the panel closed again, so the viewer watched
 * a menu appear, wait, and slide away from a channel they had not chosen.
 *
 * The part worth asserting is the timing rather than the outcome. Deciding to start at the
 * picture has to happen on the very first render, because anything later is visible, and
 * "eventually the panel closed" is what the old behaviour did too.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma
http://example.invalid/c.m3u8`;

/** The rail row the cursor is on, so where the panel would open can be checked without opening it. */
const cursorOn = () =>
  document.querySelector(".rail .row.selected .row-label")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("with resuming off, a launch opens the channel list as it always did", async () => {
  await mountApp(PLAYLIST);
  assert.ok(panelOpen(), "nothing is playing, so the list is the only useful thing to show");
  assert.deepEqual(played, []);
});

test("the remembered channel plays and the panel never opens", async () => {
  await mountApp(PLAYLIST, { resume: "c" });

  assert.deepEqual(played, ["http://example.invalid/c.m3u8"]);
  assert.ok(!panelOpen(), "the channel list was shown over a channel the viewer chose");
});

test("the panel is closed from the very first render, not closed afterwards", async () => {
  /*
   * The distinction this whole change is about, and the only assertion here that the old
   * behaviour fails.
   *
   * Before the playlist has arrived there is nothing to resume yet, and the panel still has
   * to be shut, because the decision is made from what localStorage already knows rather
   * than from the playlist. Checking the end state instead would pass either way: the old
   * code also ended up closed, having opened, waited out the download, and slid away.
   */
  await mountApp(PLAYLIST, { resume: "a", awaitPlaylist: false });
  assert.ok(!panelOpen(), "the panel was drawn open before the playlist had even arrived");

  await settle();
  assert.ok(!panelOpen(), "and it must still be closed once the channel is playing");
});

test("the cursor is left on the resumed channel, so opening the list lands on it", async () => {
  await mountApp(PLAYLIST, { resume: "c" });
  // Gamma is the only channel in Sport, so the rail has to be on Sport rather than on the
  // first category. This was the useful half of what reopening the panel used to do.
  press(KEY.LEFT);
  assert.ok(panelOpen());
  assert.equal(cursorOn(), "Sport");
  assert.ok(screen.getByText("Gamma"));
});

test("a remembered channel that has gone from the playlist opens the list instead", async () => {
  /*
   * Which happens whenever a playlist is edited, and the alternative is worse than opening a
   * menu: a television that comes on to a black screen, having quietly decided there was
   * nothing to play and nothing to say about it.
   */
  await mountApp(PLAYLIST, { resume: "no-longer-in-the-playlist" });

  assert.deepEqual(played, [], "something was played that is not in the playlist");
  assert.ok(panelOpen(), "the viewer was left at a black screen with no way in");
});
