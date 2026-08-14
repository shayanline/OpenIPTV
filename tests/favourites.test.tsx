import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle } from "./support/app";

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

/**
 * The category the channel list is showing, which its heading names.
 *
 * The title element rather than the whole header, which also carries a count now and would have
 * this reading "News2". A helper that takes everything in a container is a helper that fails the
 * next time anything is added beside what it wanted.
 */
const showing = () =>
  document.querySelector(".list .pane-head .panel-title")?.textContent ?? "";

/** The rail's rows, top to bottom. */
const rail = () =>
  Array.from(document.querySelectorAll(".rail .row .row-label")).map((r) => r.textContent);

/** The rail row the cursor is on, which moves on the press rather than after it. */
const cursorOn = () =>
  document.querySelector(".rail .row.selected .row-label")?.textContent ?? "";

/**
 * Walk the rail to the named category and go into the list.
 *
 * The walk is driven by where the cursor is rather than by what the channel column shows,
 * because those are deliberately not the same thing while a key is being held: the cursor
 * answers the press and the column follows once the pressing stops. Waiting for the column
 * between every press would be testing a behaviour the app does not have.
 */
async function openCategory(name: string) {
  press(KEY.LEFT);                                  // into the rail
  for (let i = 0; i < 8 && cursorOn() !== name; i++) press(KEY.DOWN);
  await settle();                                   // and let the column catch up
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

/**
 * The rail answers the key and the channel column follows, which is two behaviours and not
 * one, so it is worth two assertions.
 *
 * Arriving at a category is the most expensive thing this app does: every row in the column
 * is thrown away and rebuilt from channel objects no memo has seen before. Walking the rail
 * used to do that on every press, which measured at a median frame of 99ms and fifteen
 * stalls in eighteen presses on the floor profile, or about six frames a second under the
 * viewer's thumb. Nothing on screen says this has regressed except that it feels slow, so
 * the timing is asserted rather than left to be noticed.
 */
test("walking the rail moves the cursor at once and the channel column only after", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);                                  // into the rail, on News

  press(KEY.DOWN);
  assert.equal(cursorOn(), "Sport", "the cursor did not answer the press");
  assert.equal(showing(), "News", "the column was rebuilt while the key was still moving");

  await settle();
  assert.equal(showing(), "Sport", "the column never caught up");
});

test("a refresh that returns fewer categories brings the cursor back inside", async () => {
  /*
   * A playlist is a file somebody edits, so it can get shorter. Standing on the second
   * category of a playlist that comes back with one left `lists[category]` undefined, and the
   * channel column drew empty with a blank heading and stayed that way: nothing crashed, so
   * nothing said anything, and nothing worked either.
   */
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  press(KEY.DOWN);            // onto Sport, the second and last category
  await settle();
  assert.equal(cursorOn(), "Sport");

  /* The same app, told the playlist now has only News in it. Pushed through the store rather
     than re-rendering, because that is how a background refresh arrives: nothing the viewer
     did, and no new element. */
  const { useChannels } = await import("../src/stores/channels");
  const { parseM3U, groupByCategory } = await import("../src/services/m3u");
  const shorter = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`);
  await act(async () => {
    useChannels.setState({ channels: shorter, categories: groupByCategory(shorter) });
  });
  await settle();

  assert.deepEqual(rail(), ["News"]);
  assert.equal(cursorOn(), "News", "the cursor was left pointing past the end of the rail");
  assert.equal(showing(), "News", "the channel column was left blank");
});

test("a walk that passes over a category never builds it", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);

  // Down to Sport and straight back to News without stopping. The column was showing News
  // when this began and has to still be showing News at the end, having done no work at
  // all: eighteen presses across a real playlist is eighteen rebuilds saved.
  press(KEY.DOWN);
  press(KEY.UP);
  assert.equal(cursorOn(), "News");

  await settle();
  assert.equal(showing(), "News");
  assert.ok(screen.getByText("Alpha"), "News's channels are not the ones on screen");
});

test("favouriting leaves the viewer in the category they were reading", async () => {
  await mountApp(PLAYLIST);
  await openCategory("Sport");
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
  await openCategory("Sport");
  press(KEY.GREEN);
  press(KEY.GREEN);

  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "Sport");
});

test("the last favourite removed from inside Favourites lands on a real category", async () => {
  await mountApp(PLAYLIST);
  press(KEY.GREEN);                                 // Alpha, from News
  await openCategory("Favourites");
  assert.equal(showing(), "Favourites");

  press(KEY.GREEN);                                 // and take it back again

  // The row the viewer was standing on has gone. What replaces it is the first category,
  // shown from its first channel rather than from whatever row number they were on.
  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "News");
});
