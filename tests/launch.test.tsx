import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup } from "@testing-library/react";
import { mountApp, settle } from "./support/app";

/**
 * What is on screen before the playlist has arrived.
 *
 * There is exactly one wrong thing the app can say at this moment, and it said it. The splash
 * reports either "Loading the playlist" or "That playlist has no channels in it" depending on
 * `loading`, and the store starts with that false and no channels. So for as long as the load
 * has not answered, a television that is working perfectly tells the viewer their playlist is
 * empty and offers to replace it.
 *
 * The window used to be a single frame, because `loading` was raised synchronously. Moving the
 * cache to IndexedDB put an await in front of it, and reading flash on a 2020 set is not a
 * single frame.
 *
 * Assertions here are on text, never on a DOM node. `assert.equal(node, null)` on a jsdom
 * element sends node:assert off to serialise the element for its diff, which exhausts the
 * worker's memory and kills it with no stack trace and no failing test name. Half an hour.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

/** What the splash is saying, or that there is no splash, as a string either way. */
const splash = () => document.querySelector(".splash p")?.textContent ?? "(no splash)";

const EMPTY = "That playlist has no channels in it.";
const LOADING = "Loading the playlist\u2026";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("a launch never claims the playlist is empty before it has looked", async () => {
  await mountApp(PLAYLIST, { awaitPlaylist: false });
  assert.notEqual(splash(), EMPTY, "said the playlist was empty before it had looked");
  assert.equal(splash(), LOADING);
});

test("the launch screen carries the app's own mark", async () => {
  /*
   * The first thing a viewer sees after pressing the launcher tile, and it used to be a word on a
   * black screen, which does not look like the tile they pressed starting up. The same vector the
   * launcher draws, so `npm run icon` cannot leave the two disagreeing.
   */
  await mountApp(PLAYLIST, { awaitPlaylist: false });
  const mark = document.querySelector(".splash .splash-mark");
  assert.equal(mark?.getAttribute("src"), "./icon.svg", "no mark on the launch screen");
  assert.equal(mark?.getAttribute("aria-hidden"), "true", "the mark is decorative beside the name");
});

test("the splash goes once the channels are there", async () => {
  await mountApp(PLAYLIST, { awaitPlaylist: false });
  await settle();
  assert.equal(splash(), "(no splash)");
});

test("a playlist that really is empty is reported, once that is known", async () => {
  await mountApp("#EXTM3U\nnothing here", { awaitPlaylist: false });
  assert.equal(splash(), LOADING, "the verdict was reached before the playlist was read");

  await settle();
  // The message is right, it just has to wait its turn.
  assert.equal(splash(), EMPTY);
});
