import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, panelOpen, played, press, settle } from "./support/app";

/**
 * Searching for a channel by name, from the remote.
 *
 * What is worth asserting here is not that the matcher works, which has its own tests, but the
 * key model around it: a field that is a row of the column, a keyboard that gets the keys it
 * needs while it has them, and a way back out that goes back by one thing at a time. Every one
 * of those is invisible in the code and, when it is wrong, leaves the viewer somewhere they
 * cannot get out of with the four keys a remote has.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha News
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta Report
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma Sport
http://example.invalid/c.m3u8
#EXTINF:-1 tvg-id="d" group-title="Sport",Alpha Sport
http://example.invalid/d.m3u8`;

/**
 * The query field, as an element or null.
 *
 * Always asserted through a boolean or a property, never against null directly: `assert.equal`
 * given a jsdom element and a failing comparison goes off to serialise the whole node for its
 * diff, exhausts the worker and kills it with no stack trace and no failing test name. It is
 * written down in AGENTS.md and this file paid for it again anyway.
 */
const field = () => document.querySelector<HTMLInputElement>(".search-field");
const rows = () =>
  Array.from(document.querySelectorAll(".list .row .row-label")).map((r) => r.textContent);
const selected = () =>
  document.querySelector(".list .row.selected .row-label")?.textContent ?? "";
const searchKeyOn = () => !!document.querySelector(".panel-key.on");
/** The rail row the cursor is on, which moves on the press rather than after it. */
const cursorOn = () =>
  document.querySelector(".rail .row.selected .row-label")?.textContent ?? "";

/**
 * Type, and let the results catch up.
 *
 * Through fireEvent.change rather than by setting `value` and dispatching an input event, which
 * is the obvious thing and does nothing: React tracks the value it last wrote through its own
 * property descriptor, so assigning to `value` directly leaves its tracker thinking nothing
 * changed and onChange never runs. Testing Library's helper resets that tracker, which is most of
 * what it is for.
 *
 * The settle afterwards is the search's own 150ms debounce, the same one the rail has, and the
 * reason a test that asserts on results has to wait while one asserting on the field must not.
 */
async function type(text: string) {
  const el = field();
  assert.ok(el, "the search field is not on screen");
  fireEvent.change(el, { target: { value: text } });
  await settle();
}

/**
 * Open search from the title bar, using the keys a viewer has.
 *
 * Left until the rail has the cursor, up until the title bar does, then OK on Search, which is
 * the leftmost of the two keys and the one the cursor arrives on. Driven by what is on screen
 * rather than by a fixed number of presses, because how many it takes depends on where the panel
 * opened: resuming a channel opens it on the channel column, and launching without one opens it
 * on the column too but with the panel already showing.
 */
async function openSearch() {
  for (let i = 0; i < 4 && !document.querySelector(".rail.focused"); i++) press(KEY.LEFT);
  for (let i = 0; i < 4 && !document.querySelector(".panel-key.selected"); i++) press(KEY.UP);
  press(KEY.ENTER);
  await settle();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("search is opened from the title bar and puts the cursor in the field", async () => {
  await mountApp(PLAYLIST);
  await openSearch();

  assert.ok(field(), "the field replaced the channel column's heading");
  assert.equal(document.activeElement, field(), "and it has the keyboard");
  assert.ok(searchKeyOn(), "and the key says the column is showing a search");
});

test("typing filters the column to the channels whose names match", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  assert.deepEqual(rows(), ["Alpha News", "Alpha Sport"]);
});

test("results come from the whole playlist, not the category that was showing", async () => {
  /*
   * The rail is left on News, and Gamma Sport is in Sport. A search that only looked at the
   * column it replaced would be a filter rather than a search, and it would be a filter over
   * whichever category the viewer happened to have open, which is not a thing anybody asked for.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("sport");

  assert.deepEqual(rows(), ["Gamma Sport", "Alpha Sport"]);
});

test("down leaves the field for the results, and up comes back to it", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  press(KEY.DOWN);
  assert.equal(selected(), "Alpha News", "down goes to the first result");
  assert.notEqual(document.activeElement, field(), "and the keyboard goes away with it");

  press(KEY.UP);
  await settle(0);
  assert.equal(document.activeElement, field(), "up from the first result returns to the field");
});

test("OK on a result plays it", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("gamma");

  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle();

  assert.deepEqual(played, ["http://example.invalid/c.m3u8"]);
  assert.equal(panelOpen(), false, "and the panel gets out of the way, as choosing any row does");
});

test("choosing a result takes the rail to that channel's category", async () => {
  /*
   * Otherwise channel up and down would walk a category the playing channel is not in, and
   * closing the search would land the viewer somewhere unrelated to what they are watching.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("gamma");
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle();

  press(KEY.LEFT);        // back into the panel, which reopens on what is playing
  await settle();
  assert.equal(
    document.querySelector(".rail .row.showing .row-label")?.textContent,
    "Sport",
  );
});

test("left and right belong to the caret while the keyboard has the field", async () => {
  /*
   * The one that would be most annoying to get wrong. A viewer correcting the third letter of a
   * channel name presses left, and if that walked into the category rail the field would lose
   * the keyboard mid-word.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  press(KEY.LEFT);
  assert.equal(document.activeElement, field(), "left did not leave the field");
  press(KEY.RIGHT);
  assert.equal(document.activeElement, field(), "and neither did right");
});

test("digits are text in the field rather than a channel number", async () => {
  await mountApp(PLAYLIST);
  await openSearch();

  press(52);              // the "4" key, which outside a search dials channel 4
  await settle();

  assert.deepEqual(played, [], "nothing was tuned");
  assert.ok(field(), "and the search is still open");
});

test("RETURN goes back by one thing at a time: the query, then the search", async () => {
  /*
   * Two presses, and it was three until the middle one was found to be undoing the next one:
   * dismissing the keyboard was a press of its own, and clearing the query puts the cursor back
   * on the field, which raises the keyboard again. Pressing down is what puts the keyboard away,
   * on the way to the results, which is where somebody who has finished typing is going.
   */
  await mountApp(PLAYLIST, { resume: "a" });
  await openSearch();
  await type("alpha");

  press(KEY.BACK);
  await settle();
  assert.equal(field()?.value, "", "the first press clears what was typed");
  assert.ok(field(), "and the search is still showing");

  press(KEY.BACK);
  await settle();
  assert.equal(!!field(), false, "the second leaves the search");
  assert.ok(rows().length > 0, "and the column is a category again");
});

test("walking to a category while a search is showing puts the categories back", async () => {
  /*
   * The rail went dead otherwise. Its cursor moved and the category underneath changed, and the
   * column carried on showing results, so the control the viewer was using appeared to do
   * nothing. A category arriving is the end of a search: they want the same column.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");
  assert.deepEqual(rows(), ["Alpha News", "Alpha Sport"]);

  press(KEY.DOWN);        // out of the field, into the results
  press(KEY.LEFT);        // and into the rail, which is where it was left: on the title bar
  // Down until the cursor is on Sport, rather than a fixed number of presses. The rail keeps the
  // position it had when the search was opened, which is the title bar, so how far Sport is
  // depends on where the viewer came from and is not something a test should assume.
  for (let i = 0; i < 6 && !cursorOn().includes("Sport"); i++) press(KEY.DOWN);
  await settle();

  assert.equal(!!field(), false, "the search is gone");
  assert.deepEqual(rows(), ["Gamma Sport", "Alpha Sport"], "and the category is showing");
});

test("left on an empty field goes to the categories rather than nowhere", async () => {
  /*
   * Left belongs to the caret while there is text to move through, and with none there is nothing
   * for it to do: it did nothing at all, which is indistinguishable from the app having stopped
   * listening. At offset zero it can only mean the direction it means everywhere else.
   */
  await mountApp(PLAYLIST);
  await openSearch();

  press(KEY.LEFT);
  await settle(0);

  assert.ok(document.querySelector(".rail.focused"), "the rail has the cursor");
  assert.notEqual(document.activeElement, field(), "and the keyboard has gone with it");
});

test("choosing a category by clicking it also puts the categories back", async () => {
  // Same rule, reached the other way: every route to a category goes through one place.
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  const sport = Array.from(document.querySelectorAll<HTMLElement>(".rail .row"))
    .find((r) => r.textContent?.includes("Sport"));
  assert.ok(sport, "the Sport category is in the rail");
  await act(async () => { sport.click(); });
  await settle();

  assert.equal(!!field(), false);
  assert.deepEqual(rows(), ["Gamma Sport", "Alpha Sport"]);
});

test("leaving the search puts the cursor on a row that exists", async () => {
  /*
   * The cursor was somewhere in a list of results that is no longer drawn, and the category
   * underneath has its own length. The top of it is the only row certain to be there.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");
  press(KEY.DOWN);
  press(KEY.DOWN);        // the second result

  press(KEY.BACK);        // clears the query, and the cursor returns to the field
  await settle();
  press(KEY.BACK);        // an empty field has no search left to go back through
  await settle();

  assert.equal(selected(), "Alpha News", "the first row of the category");
});
