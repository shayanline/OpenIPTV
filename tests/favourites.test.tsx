import { afterEach, beforeEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { hold, mountApp, press, pressDown, release, settle } from "./support/app";

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

const THREE_CATEGORIES = `${PLAYLIST}
#EXTINF:-1 tvg-id="d" group-title="Kids",Delta
http://example.invalid/d.m3u8`;
const REAL_FAVOURITES_CATEGORY = `#EXTM3U
#EXTINF:-1 tvg-id="real" group-title="Favourites",Real Favourite
http://example.invalid/real.m3u8
#EXTINF:-1 tvg-id="sport" group-title="Sport",Sport
http://example.invalid/sport.m3u8`;

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
const railRow = (name: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".rail .row")).find(
    (row) => row.querySelector(".row-label")?.textContent === name,
  );

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
  press(KEY.LEFT); // into the rail
  for (let i = 0; i < 8 && cursorOn() !== name; i++) press(KEY.DOWN);
  await settle(); // and let the column catch up
  press(KEY.RIGHT); // back into the channels
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

test("favourites from hidden categories disappear in the default mode", async () => {
  localStorage.setItem("openiptv.favourites", '["a"]');
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });

  assert.deepEqual(rail(), ["Sport"]);
  assert.equal(showing(), "Sport");
});

test("hiding every category says how to restore the list", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News", "Sport"] });

  assert.deepEqual(rail(), []);
  assert.ok(
    screen.getByText(
      "All categories are hidden. Hold Red to show them here, or unhide them in Settings, Playlists, Categories.",
    ),
  );
});

test("search mode keeps explicit favourites from hidden categories", async () => {
  localStorage.setItem("openiptv.favourites", '["a"]');
  await mountApp(PLAYLIST, {
    hiddenCategories: ["News"],
    hiddenCategoryMode: "search",
  });

  assert.deepEqual(rail(), ["Favourites", "Sport"]);
  assert.equal(showing(), "Favourites");
  assert.ok(screen.getByText("Alpha"));
});

test("the red key hides and unhides the selected category immediately", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  press(KEY.LEFT);
  assert.ok(screen.getByText("Hide category"));

  press(KEY.RED);
  assert.deepEqual(rail(), ["Sport"]);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);

  await hold(KEY.RED);
  assert.equal(cursorOn(), "Sport");
  press(KEY.UP);
  assert.ok(screen.getByText("Unhide category"));
  press(KEY.RED);

  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(Boolean(railRow("News")?.querySelector(".hidden-state")), false);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, []);
  press(KEY.UP);
  assert.equal(Boolean(screen.queryByText("Show visible categories only")), false);
});

test("a real category named Favourites can be hidden", async () => {
  await mountApp(REAL_FAVOURITES_CATEGORY);
  const { useSettings } = await import("../src/stores/settings");
  press(KEY.LEFT);

  press(KEY.RED);

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["Favourites"]);
  assert.deepEqual(rail(), ["Sport"]);
});

test("hiding a category moves to the nearest visible category", async () => {
  await mountApp(THREE_CATEGORIES, { hiddenCategories: ["News"] });
  press(KEY.LEFT);

  press(KEY.RED);

  assert.deepEqual(rail(), ["Kids"]);
  assert.equal(cursorOn(), "Kids");
  assert.equal(showing(), "Kids");
});

test("concealing a focused hidden row moves to the next visible category", async () => {
  await mountApp(THREE_CATEGORIES, { hiddenCategories: ["News"] });
  press(KEY.LEFT);
  await hold(KEY.RED);
  assert.equal(cursorOn(), "Sport");
  press(KEY.UP);
  await settle();
  assert.equal(cursorOn(), "News");

  await hold(KEY.RED);

  assert.equal(showing(), "Sport");
  assert.equal(cursorOn(), "Sport");
});

test("holding red reveals saved hidden categories without toggling another row", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  const { useSettings } = await import("../src/stores/settings");
  press(KEY.LEFT);

  await hold(KEY.RED);

  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(cursorOn(), "Sport");
  assert.equal(Boolean(railRow("News")?.querySelector(".hidden-state")), true);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);

  await hold(KEY.RED);
  assert.deepEqual(rail(), ["Sport"]);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
});

test("a Red hold survives state updates during the press", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];

  pressDown(KEY.RED);
  act(() => useSettings.getState().setHiddenCategoryMode(playlist.id, "search"));
  await settle(600);
  release(KEY.RED);

  assert.deepEqual(rail(), ["News", "Sport"]);
});

test("repeated keydown events reveal hidden categories only once", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });

  pressDown(KEY.RED);
  pressDown(KEY.RED, true);
  pressDown(KEY.RED, true);
  release(KEY.RED);

  assert.deepEqual(rail(), ["News", "Sport"]);
});

test("holding Red during search keeps focus in search", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  press(KEY.LEFT);
  press(KEY.UP);
  press(KEY.ENTER);

  await hold(KEY.RED);

  assert.equal(document.querySelector(".rail")?.classList.contains("focused"), false);
  assert.ok(screen.getByLabelText("Search channels by name"));
});

test("the on-screen Smart Remote red key toggles category visibility", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  act(() => screen.getByRole("button", { name: "Show Smart Remote" }).click());
  act(() => screen.getByRole("button", { name: "123" }).click());

  const red = screen.getByRole("button", { name: "Red" });
  fireEvent.mouseDown(red);
  fireEvent.mouseUp(red);

  assert.deepEqual(rail(), ["Sport"]);
});

test("holding Red on the on-screen Smart Remote reveals hidden categories", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  press(KEY.LEFT);
  act(() => screen.getByRole("button", { name: "Show Smart Remote" }).click());
  act(() => screen.getByRole("button", { name: "123" }).click());
  const red = screen.getByRole("button", { name: "Red" });

  fireEvent.mouseDown(red);
  await settle(600);
  fireEvent.mouseUp(red);

  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(cursorOn(), "Sport");
  assert.equal(Boolean(railRow("News")?.querySelector(".hidden-state")), true);
});

test("a category hidden with Red stays hidden after the panel closes", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  press(KEY.LEFT);
  press(KEY.RED);

  press(KEY.RIGHT);
  press(KEY.ENTER);

  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
  press(KEY.LEFT);
  assert.deepEqual(rail(), ["Sport"]);
});

test("Red has no action or guide on the title bar", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  const { useSettings } = await import("../src/stores/settings");
  press(KEY.LEFT);
  press(KEY.UP);
  assert.equal(document.querySelector(".panel-hints")?.textContent?.includes("Red"), false);

  press(KEY.RED);
  await hold(KEY.RED);

  assert.deepEqual(rail(), ["Sport"]);
  assert.deepEqual(useSettings.getState().playlists[0].hiddenCategories, ["News"]);
});

test("a hidden channel cannot be added to an invisible Favourites row", async () => {
  await mountApp(PLAYLIST);
  press(KEY.ENTER);
  press(KEY.LEFT);
  press(KEY.LEFT);
  press(KEY.RED);
  press(KEY.BACK);

  press(KEY.GREEN);

  const { useChannels } = await import("../src/stores/channels");
  assert.deepEqual(useChannels.getState().favourites, []);
  assert.ok(screen.getByText("Unhide this category before adding favourites."));
});

test("unfavouriting a hidden playing channel keeps the visible category selected", async () => {
  localStorage.setItem("openiptv.favourites", '["a","c"]');
  await mountApp(PLAYLIST, { resume: "a" });
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];

  await act(async () => {
    useSettings.getState().setCategoryHidden(playlist.id, "News", true);
  });
  assert.equal(showing(), "Sport");

  press(KEY.GREEN);
  press(KEY.LEFT);

  assert.deepEqual(rail(), ["Favourites", "Sport"]);
  assert.equal(showing(), "Sport");
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
  press(KEY.LEFT); // into the rail, on News

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
  press(KEY.DOWN); // onto Sport, the second and last category
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
  press(KEY.GREEN); // Alpha, from News
  await openCategory("Favourites");
  assert.equal(showing(), "Favourites");

  press(KEY.GREEN); // and take it back again

  // The row the viewer was standing on has gone. What replaces it is the first category,
  // shown from its first channel rather than from whatever row number they were on.
  assert.deepEqual(rail(), ["News", "Sport"]);
  assert.equal(showing(), "News");
});
