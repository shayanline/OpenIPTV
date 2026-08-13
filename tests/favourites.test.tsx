import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press } from "./support/app";

/**
 * The Favourites row, which is in the rail only while there is something in it.
 *
 * An empty row says nothing, so it is not drawn. The price is that the first favourite added
 * and the last one removed insert and remove a row above every category, and a viewer who
 * pressed the green key asked to favourite a channel rather than to be moved somewhere else.
 * That correction is the whole of what is asserted here: it cannot be seen in the code, and
 * when it is wrong nothing on screen announces it, the viewer is simply somewhere they did
 * not ask to be.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma
http://example.invalid/c.m3u8`;

/** The category the channel list is showing, which its heading names. */
const showing = () => document.querySelector(".list .pane-head")?.textContent ?? "";

/** The rail's rows, top to bottom. */
const rail = () =>
  Array.from(document.querySelectorAll(".rail .row .row-label")).map((r) => r.textContent);

/** Walk the rail from wherever the cursor is to the named category, and go into the list. */
function openCategory(name: string) {
  press(KEY.LEFT);                                  // into the rail
  for (let i = 0; i < 8 && showing() !== name; i++) press(KEY.DOWN);
  press(KEY.RIGHT);                                 // back into the channels
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("a playlist with no favourites opens on its own first category", async () => {
  await mountApp(PLAYLIST);
  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "News");
});

test("favouriting leaves the viewer in the category they were reading", async () => {
  await mountApp(PLAYLIST);
  openCategory("Sport");
  assert.equal(showing(), "Sport");

  press(KEY.GREEN);

  // The row it gains sits above every category, so Sport is now the third row rather than
  // the second. Staying on row two would have moved the viewer to News without being asked.
  assert.deepEqual(rail(), ["Favourites", "News", "Sport"]);
  assert.equal(showing(), "Sport");
  assert.ok(screen.getByText("Gamma"), "the channels shown are still Sport's");
});

test("unfavouriting the last one takes the row away and still does not move anybody", async () => {
  await mountApp(PLAYLIST);
  openCategory("Sport");
  press(KEY.GREEN);
  press(KEY.GREEN);

  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "Sport");
});

test("the last favourite removed from inside Favourites lands on a real category", async () => {
  await mountApp(PLAYLIST);
  press(KEY.GREEN);                                 // Alpha, from News
  openCategory("Favourites");
  assert.equal(showing(), "Favourites");

  press(KEY.GREEN);                                 // and take it back again

  // The row the viewer was standing on has gone. What replaces it is the first category,
  // shown from its first channel rather than from whatever row number they were on.
  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "News");
});
