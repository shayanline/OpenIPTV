import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle } from "./support/app";

/**
 * Up and down cycle through the title bar and whichever column the cursor is in.
 *
 * The categories always had this: Search and Settings are row zero of the rail, so walking up off
 * the first category reaches them and walking down comes back. The channel column had no route at
 * all, and getting to two keys visible directly above a channel took three presses through the rail.
 *
 * The rule these tests hold to is that the bar sits above both columns, and leaving it downward
 * lands where the cursor came from rather than always in the categories.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
#EXTINF:-1 group-title="Sport",Third Channel
http://example.invalid/3.m3u8
`;

/** The cursor is in the title bar when one of its two keys is the selected thing. */
const inTitleBar = () => !!document.querySelector(".panel-key.selected");

/** Which title bar key the cursor is on, or nothing. */
const barKey = () =>
  document.querySelector(".panel-key.selected")?.getAttribute("aria-label") ?? "";

/**
 * The channel the cursor is on, by name, and the category likewise.
 *
 * Both columns render `.row.selected` with the text in `.row-label`, which is what makes them one
 * pattern rather than two: `.list` is the channels and `.rail` is the categories.
 */
const channelUnderCursor = () =>
  document.querySelector(".list .row.selected .row-label")?.textContent ?? "";

const categoryUnderCursor = () =>
  document.querySelector(".rail .row.selected .row-label")?.textContent ?? "";

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

test("up from the top of the channel list reaches Search, and down comes back to it", async () => {
  await mountApp(PLAYLIST);
  const wasOn = channelUnderCursor();
  assert.notEqual(wasOn, "", "the cursor was not in the channel column to begin with");

  press(KEY.UP);
  await settle();
  assert.equal(inTitleBar(), true, "up from the first channel did not reach the title bar");

  press(KEY.DOWN);
  await settle();
  assert.equal(inTitleBar(), false, "down did not leave the title bar");
  assert.equal(channelUnderCursor(), wasOn, "it came back to a different place than it left");
});

test("down from the bottom of the channel list also reaches the bar, so the column cycles", async () => {
  await mountApp(PLAYLIST);
  // To the last channel of this category, wherever that is, then one more.
  press(KEY.UP);                        // into the bar
  await settle();
  press(KEY.UP);                        // and round to the bottom of the column
  await settle();
  assert.equal(inTitleBar(), false, "up from the bar should have gone back into the column");

  press(KEY.DOWN);
  await settle();
  assert.equal(inTitleBar(), true, "down off the bottom of the column did not reach the bar");
});

test("down from Search reached at the bottom returns to the top of the channel list", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);                        // Search from the first channel
  await settle();
  press(KEY.UP);                        // wrap to the last channel
  await settle();
  press(KEY.DOWN);                      // Search from the bottom
  await settle();
  assert.equal(inTitleBar(), true);

  press(KEY.DOWN);
  await settle();
  assert.equal(channelUnderCursor(), "First Channel", "down from Search did not return to the top");
});

test("the categories keep their own way in and out of the bar", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);                      // out of the channel column, into the rail
  await settle();
  const wasOn = categoryUnderCursor();
  assert.notEqual(wasOn, "", "left did not put the cursor on a category");

  press(KEY.UP);
  await settle();
  assert.equal(inTitleBar(), true, "up from the first category did not reach the title bar");

  press(KEY.DOWN);
  await settle();
  // The point of remembering: arriving from the rail must go back to the rail, not to a channel.
  assert.equal(inTitleBar(), false);
  assert.equal(categoryUnderCursor(), wasOn, "down from the bar left the categories");
});

test("left and right switch between lists without losing either cursor", async () => {
  await mountApp(PLAYLIST);
  const wasOn = channelUnderCursor();

  press(KEY.LEFT);
  await settle();
  const category = categoryUnderCursor();
  assert.notEqual(category, "", "left did not enter the category list");

  press(KEY.RIGHT);
  await settle();
  assert.equal(channelUnderCursor(), wasOn, "right did not restore the channel cursor");
});

test("left on the category list keeps the category list selected", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  await settle();
  const wasOn = categoryUnderCursor();

  press(KEY.LEFT);
  await settle();
  assert.equal(categoryUnderCursor(), wasOn, "left moved away from the selected category");
  assert.ok(document.querySelector(".rail.focused"), "left moved out of the category list");
});

test("switching back to categories restores the latest category row", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  await settle();
  press(KEY.DOWN);
  await settle();
  assert.equal(categoryUnderCursor(), "Sport");

  press(KEY.RIGHT);
  await settle();
  assert.equal(channelUnderCursor(), "Third Channel");
  press(KEY.LEFT);
  await settle();
  assert.equal(categoryUnderCursor(), "Sport", "left reset the category cursor");
});

test("the header cycles Search and Settings in both horizontal directions", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);
  await settle();
  assert.equal(barKey(), "Search");

  press(KEY.LEFT);
  await settle();
  assert.equal(barKey(), "Settings", "left from Search did not cycle to Settings");

  press(KEY.RIGHT);
  await settle();
  assert.equal(barKey(), "Search", "right from Settings did not cycle to Search");
});

test("vertical movement from Settings returns to the matching channel-list edge", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);
  await settle();
  press(KEY.LEFT);
  await settle();
  assert.equal(barKey(), "Settings");

  press(KEY.DOWN);
  await settle();
  assert.equal(channelUnderCursor(), "First Channel");

  press(KEY.UP);
  await settle();
  press(KEY.UP);
  await settle();
  assert.equal(channelUnderCursor(), "Second Channel");
});

test("arriving from the channel list does not return the cursor to the categories", async () => {
  /*
   * The mistake this remembers to avoid. Before the bar sat above both columns, the only way out of
   * it downward was into the categories, so a viewer who reached Search from a channel and changed
   * their mind was moved to a list they had not been in.
   */
  await mountApp(PLAYLIST);
  press(KEY.UP);                        // into the bar from the channel column
  await settle();
  press(KEY.DOWN);
  await settle();

  assert.notEqual(channelUnderCursor(), "", "down from the bar landed somewhere other than a channel");
});

test("left and right still move within the bar before leaving it", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);
  await settle();
  assert.equal(barKey(), "Search", "the bar is entered on its first key");

  press(KEY.RIGHT);
  await settle();
  assert.equal(barKey(), "Settings", "right did not move along the bar");
});
