import { afterEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import {
  mountApp,
  panelOpen,
  played,
  press,
  settle,
  XTREAM_SOURCE,
  xtreamFetch,
} from "./support/app";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
#EXTINF:-1 group-title="Sport",Third Channel
http://example.invalid/3.m3u8
`;

/**
 * The channel the cursor is on, by name, and the category likewise.
 *
 * Both columns render `.row.cursor` with the text in `.row-label`, which is what makes them one
 * pattern rather than two: `.list` is the channels and `.rail` is the categories.
 */
const channelUnderCursor = () =>
  document.querySelector(".list .row.cursor .row-label")?.textContent ?? "";

const categoryUnderCursor = () =>
  document.querySelector(".rail .row.cursor .row-label")?.textContent ?? "";

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.removeProperty("--t-navigation");
  vi.useRealTimers();
});

test("the panel owns directions while it is open", async () => {
  await mountApp(PLAYLIST);
  const started = played.length;

  press(KEY.DOWN);
  await settle();

  expect(played).toHaveLength(started);
  expect(channelUnderCursor()).toBe("Second Channel");
});

test("pointer hover becomes the Live arrow origin without activating", async () => {
  await mountApp(PLAYLIST);
  const second = screen.getByRole("button", { name: /Second Channel/ });
  fireEvent.pointerMove(second);
  fireEvent.pointerEnter(second);

  expect(channelUnderCursor()).toBe("Second Channel");
  expect(played).toHaveLength(0);
  expect(panelOpen()).toBe(true);

  press(KEY.UP);
  expect(channelUnderCursor()).toBe("First Channel");
  expect(played).toHaveLength(0);

  fireEvent.click(second);
  expect(played).toEqual(["http://example.invalid/2.m3u8"]);
  expect(panelOpen()).toBe(false);
});

test("Enter selects a different highlighted channel and closes the panel", async () => {
  await mountApp(PLAYLIST);
  press(KEY.DOWN);

  press(KEY.ENTER);

  expect(played).toEqual(["http://example.invalid/2.m3u8"]);
  expect(panelOpen()).toBe(false);
});

test("Enter closes the panel without restarting the channel already playing", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /First Channel/ }));
  expect(played).toHaveLength(1);
  press(KEY.LEFT);

  press(KEY.ENTER);

  expect(played).toHaveLength(1);
  expect(panelOpen()).toBe(false);
});

test("Enter selects the highlighted Live search result", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const field = screen.getByRole("textbox", { name: /Search channels/ });
  fireEvent.change(field, { target: { value: "Third" } });
  await settle();
  fireEvent.keyDown(field, { keyCode: KEY.DOWN });

  press(KEY.ENTER);

  expect(played).toEqual(["http://example.invalid/3.m3u8"]);
  expect(panelOpen()).toBe(false);
});

test("category focus settles the displayed category without activating a channel", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  await settle();
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("News");

  press(KEY.DOWN);
  await settle();
  expect(categoryUnderCursor()).toBe("Sport");
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("Sport");
  expect(played[played.length - 1]?.name).not.toBe("Third Channel");

  press(KEY.RIGHT);
  await settle();
  expect(document.querySelector(".rail .row.showing .row-label")?.textContent).toBe("Sport");
  expect(channelUnderCursor()).toBe("Third Channel");
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

test("left on categories enters application navigation and restores the category cursor", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  await settle();
  const wasOn = categoryUnderCursor();

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.querySelector(".panel .row.cursor")).toBeNull();

  press(KEY.RIGHT);
  await settle(0);
  assert.equal(categoryUnderCursor(), wasOn, "the category cursor was not restored");
  assert.ok(document.querySelector(".rail.focused"), "focus did not return to categories");
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

test("Live channel and category lists cycle at their vertical boundaries", async () => {
  await mountApp(PLAYLIST);

  press(KEY.UP);
  await settle();
  expect(channelUnderCursor()).toBe("Second Channel");
  press(KEY.DOWN);
  await settle();
  expect(channelUnderCursor()).toBe("First Channel");

  press(KEY.LEFT);
  await settle();
  press(KEY.UP);
  await settle();
  expect(categoryUnderCursor()).toBe("Sport");
  press(KEY.DOWN);
  await settle();
  expect(categoryUnderCursor()).toBe("News");
});

test("a picked search result keeps its presentation through the panel exit", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /First Channel/ }));
  expect(played).toHaveLength(1);
  press(KEY.LEFT);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const field = screen.getByRole("textbox", { name: /Search channels/ });
  fireEvent.change(field, { target: { value: "First" } });
  await settle();
  expect(document.querySelector(".list")?.textContent).toContain("First Channel");

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  const result = [...document.querySelectorAll(".list .row")].find((row) =>
    row.querySelector(".playing-dot"),
  );
  assert.ok(result);
  fireEvent.click(result);

  expect(panelOpen()).toBe(false);
  expect(played).toHaveLength(1);
  expect(document.querySelector(".panel-cols.searching")).toBeTruthy();
  expect((document.querySelector(".search-field") as HTMLInputElement).value).toBe("First");
  expect(document.querySelector(".list")?.textContent).toContain("First Channel");
  expect(document.querySelector(".list")?.textContent).not.toContain("Second Channel");
  expect(document.querySelector(".panel .rail")).toBeNull();

  await settle(179);
  expect(document.querySelector(".panel-cols.searching")).toBeTruthy();
  expect(document.querySelector(".search-field")).toBeTruthy();
  expect(document.querySelector(".list")?.textContent).toContain("First Channel");
  expect(document.querySelector(".panel .rail")).toBeNull();

  await settle(1);
  expect(document.querySelector(".search-field")).toBeNull();
  expect(document.querySelector(".panel-cols.searching")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();
  expect(document.querySelector(".list")?.textContent).toContain("Second Channel");
});

test("a fresh search survives the deadline of the exit it interrupted", async () => {
  await mountApp(PLAYLIST);
  fireEvent.click(screen.getByRole("button", { name: /First Channel/ }));
  press(KEY.LEFT);
  await settle();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  const field = screen.getByRole("textbox", { name: /Search channels/ });
  fireEvent.change(field, { target: { value: "First" } });
  await settle();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  const result = [...document.querySelectorAll(".list .row")].find((row) =>
    row.querySelector(".playing-dot"),
  );
  assert.ok(result);
  fireEvent.click(result);
  expect(panelOpen()).toBe(false);

  await settle(50);
  press(KEY.LEFT);
  await settle(0);
  expect(panelOpen()).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(300);
  const nextField = screen.getByRole("textbox", { name: /Search channels/ });
  fireEvent.change(nextField, { target: { value: "Second" } });
  await settle(200);

  expect(panelOpen()).toBe(true);
  expect((document.querySelector(".search-field") as HTMLInputElement).value).toBe("Second");
  expect(document.querySelector(".panel-cols.searching")).toBeTruthy();
  expect(document.querySelector(".panel .rail")).toBeNull();
  expect(document.querySelector(".list")?.textContent).toContain("Second Channel");
  expect(document.querySelector(".list")?.textContent).not.toContain("First Channel");

  await settle(200);
  press(KEY.BACK);
  await settle(0);
  press(KEY.BACK);
  await settle(0);
  press(KEY.BACK);
  await settle(0);
  expect(panelOpen()).toBe(false);
  await settle(180);
  expect(document.querySelector(".search-field")).toBeNull();
  expect(document.querySelector(".panel .rail")).toBeTruthy();
});

test("dialling after a genuine Live reentry does not replay the entry", async () => {
  localStorage.removeItem("app:last-mode:pl-1");
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [
        { category_id: "10", category_name: "News" },
        { category_id: "20", category_name: "Sport" },
      ],
      [
        { stream_id: "1", name: "Alpha One", category_id: "10", stream_type: "live" },
        { stream_id: "2", name: "Beta Two", category_id: "20", stream_type: "live" },
      ],
    ),
  });

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(400);
  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(400);
  expect(panelOpen()).toBe(true);

  for (let attempt = 0; attempt < 3 && panelOpen(); attempt += 1) {
    press(KEY.BACK);
    await settle(0);
  }
  expect(panelOpen()).toBe(false);

  const before = played.length;
  press(50);
  press(KEY.ENTER);
  await settle(0);

  expect(played.length).toBe(before + 1);
  expect(played[played.length - 1]).toContain("/2.m3u8");
  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".panel:not(.away)")).toBeNull();
  expect(document.querySelector(".search-field")).toBeNull();
});
