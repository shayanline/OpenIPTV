import { afterEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { act, cleanup, renderHook, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { useBrowseStack, type BrowseFrame } from "../src/hooks/useBrowseStack";
import { availableHeaderControls } from "../src/components/PanelHeader";
import {
  mountApp,
  press,
  pressDown,
  release,
  settle,
  XTREAM_SOURCE,
  xtreamFetch,
} from "./support/app";

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

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

const XTREAM_CATEGORIES = [{ category_id: "10", category_name: "News" }];
const XTREAM_STREAMS = [
  {
    stream_id: "1",
    name: "Provider One",
    category_id: "10",
    stream_icon: "",
    stream_type: "live",
  },
];

const frame = (key: string, cursor = 0): BrowseFrame<string> => ({
  key,
  title: key,
  items: [`${key} item`],
  cursor,
  state: "loaded",
});

test("the browse stack restores its parent cursor after one frame is removed", () => {
  const { result } = renderHook(() => useBrowseStack(frame("root", 1)));

  act(() => {
    result.current.setCursor(4);
    result.current.push(frame("detail", 2));
  });
  expect(result.current.current).toMatchObject({ key: "detail", cursor: 2 });

  act(() => result.current.setCursor(6));
  expect(result.current.current.cursor).toBe(6);

  act(() => result.current.pop());
  expect(result.current.current).toMatchObject({ key: "root", cursor: 4 });

  act(() => result.current.pop());
  expect(result.current.current.key).toBe("root");
});

test("the ordered header model keeps Guide outside the global title bar", () => {
  expect(availableHeaderControls(false, false)).toEqual(["search", "settings"]);
  expect(availableHeaderControls(true, false)).toEqual(["content", "search", "settings"]);
  expect(availableHeaderControls(true, true)).toEqual(["content", "search", "settings"]);
});

test("the M3U header remains Search followed by Settings", async () => {
  await mountApp(PLAYLIST);

  expect(document.querySelector(".content-selector")).toBeNull();
  expect(
    [...document.querySelectorAll(".panel-bar button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Search", "Settings"]);
});

test("an Xtream header starts on Live and separates selection from remote focus", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(XTREAM_CATEGORIES, XTREAM_STREAMS),
  });

  const live = screen.getByRole("button", { name: "Live" });
  expect(live.getAttribute("aria-pressed")).toBe("true");
  expect(live.classList.contains("selected")).toBe(true);
  expect(document.querySelector(".content-selector.focused")).toBeNull();
  expect(screen.queryByRole("button", { name: "Guide" })).toBeNull();
  expect(
    [...document.querySelectorAll(".panel-bar button")].map((button) => button.textContent),
  ).toEqual(["Search", "Settings"]);

  press(KEY.LEFT);
  await settle();
  press(KEY.UP);
  await settle();
  expect(document.querySelector(".content-selector.focused")).toBeTruthy();
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("Live");

  press(KEY.RIGHT);
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("Movies");
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")).toBe(
    "true",
  );

  press(KEY.RIGHT);
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("Series");
  press(KEY.RIGHT);
  expect(barKey()).toBe("Search");
  expect(screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")).toBe(
    "true",
  );

  press(KEY.LEFT);
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("Series");
  press(KEY.LEFT);
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("Movies");
  press(KEY.ENTER);
  await settle();
  expect(screen.getByRole("button", { name: "Movies" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(document.querySelector(".content-selector.focused .content-option.selected")).toBe(
    screen.getByRole("button", { name: "Movies" }),
  );
});

test("right to left header navigation follows the visible control order", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    locale: "ar",
    fetchImplementation: xtreamFetch(XTREAM_CATEGORIES, XTREAM_STREAMS),
  });

  press(KEY.RIGHT);
  await settle();
  press(KEY.UP);
  await settle();
  expect(document.querySelector(".content-selector.focused")).toBeTruthy();

  press(KEY.LEFT);
  await settle();
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("أفلام");

  press(KEY.LEFT);
  await settle();
  expect(document.querySelector(".content-option.focused")?.textContent).toBe("مسلسلات");

  press(KEY.LEFT);
  await settle();
  expect(barKey()).toBe("بحث");

  press(KEY.LEFT);
  await settle();
  expect(barKey()).toBe("الإعدادات");
});

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
  press(KEY.UP); // into the bar
  await settle();
  press(KEY.UP); // and round to the bottom of the column
  await settle();
  assert.equal(inTitleBar(), false, "up from the bar should have gone back into the column");

  press(KEY.DOWN);
  await settle();
  assert.equal(inTitleBar(), true, "down off the bottom of the column did not reach the bar");
});

test("down from Search reached at the bottom returns to the top of the channel list", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP); // Search from the first channel
  await settle();
  press(KEY.UP); // wrap to the last channel
  await settle();
  press(KEY.DOWN); // Search from the bottom
  await settle();
  assert.equal(inTitleBar(), true);

  press(KEY.DOWN);
  await settle();
  assert.equal(
    channelUnderCursor(),
    "First Channel",
    "down from Search did not return to the top",
  );
});

test("category focus does not move the displayed category until the rail is committed", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  await settle();
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("News");

  press(KEY.DOWN);
  await settle();
  expect(categoryUnderCursor()).toBe("Sport");
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("News");

  press(KEY.RIGHT);
  await settle();
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("Sport");
  expect(channelUnderCursor()).toBe("Third Channel");
});

test("the categories keep their own way in and out of the bar", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT); // out of the channel column, into the rail
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

test("selecting the displayed category restores its channel cursor", async () => {
  await mountApp(PLAYLIST);
  press(KEY.DOWN);
  await settle();
  expect(channelUnderCursor()).toBe("Second Channel");

  press(KEY.LEFT);
  await settle();
  expect(categoryUnderCursor()).toBe("News");
  press(KEY.ENTER);
  await settle();

  expect(channelUnderCursor()).toBe("Second Channel");
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

test("the header moves directionally and stops at each edge", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);
  await settle();
  assert.equal(barKey(), "Search");

  press(KEY.LEFT);
  await settle();
  assert.equal(barKey(), "Search", "left moved past the first header control");

  press(KEY.RIGHT);
  press(KEY.RIGHT);
  await settle();
  assert.equal(barKey(), "Settings", "right moved past the last header control");

  press(KEY.LEFT);
  await settle();
  assert.equal(barKey(), "Search");
});

test("Red on the title bar does not disturb horizontal header focus", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  press(KEY.UP);
  await settle();
  assert.equal(barKey(), "Search");

  press(KEY.RED);
  pressDown(KEY.RIGHT);
  pressDown(KEY.RIGHT, true);
  release(KEY.RIGHT);
  await settle();

  assert.equal(barKey(), "Settings");
});

test("vertical movement from Settings returns to the matching channel-list edge", async () => {
  await mountApp(PLAYLIST);
  press(KEY.UP);
  await settle();
  press(KEY.RIGHT);
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
  press(KEY.UP); // into the bar from the channel column
  await settle();
  press(KEY.DOWN);
  await settle();

  assert.notEqual(
    channelUnderCursor(),
    "",
    "down from the bar landed somewhere other than a channel",
  );
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
