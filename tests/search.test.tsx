import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TextInput } from "../src/components/TextInput";
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
  document.querySelector(".list .row.cursor .row-label")?.textContent ?? "";
const fieldKey = (keyCode: number) => fireEvent.keyDown(field()!, { keyCode });
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

/** Open Search above the Live lists. */
async function openSearch() {
  if (!panelOpen()) {
    press(KEY.ENTER);
    await settle();
  }
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.dir = "ltr";
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test("Live Search sits above both lists and is reachable from either", async () => {
  await mountApp(PLAYLIST);
  expect(document.querySelector('[data-navigation-action="search"]')).toBeNull();
  expect(screen.getByRole("button", { name: "Search" }).classList.contains("btn")).toBe(true);
  expect(screen.getByRole("button", { name: "Search" }).closest(".rail")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Search" }).closest(".live-search-entry"),
  ).toBeTruthy();
  press(KEY.UP);
  expect(document.querySelector(".section-search.cursor")).toBeTruthy();
  press(KEY.DOWN);
  expect(document.querySelector(".list.focused")).toBeTruthy();
  press(KEY.LEFT);
  press(KEY.UP);
  expect(document.querySelector(".section-search.cursor")).toBeTruthy();
  press(KEY.ENTER);
  await settle();
  expect(document.activeElement).toBe(field());
  expect(field()?.getAttribute("placeholder")).toBe("Search");
  press(KEY.BACK);
  await settle();
  expect(field()).toBeNull();
  expect(document.querySelector(".section-search.cursor")).toBeTruthy();
});

test("Blue opens Live Search without losing a draft on repeated presses", async () => {
  await mountApp(PLAYLIST);
  press(KEY.BLUE);
  await settle();
  await type("News");
  press(KEY.BLUE);
  expect(field()?.value).toBe("News");
  expect(document.querySelector(".panel-hints kbd[data-key='Blue']")).toBeTruthy();
});

test("Live Search shows one prompt or no-results state without empty result columns", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  expect(screen.getByRole("heading", { name: "Search Channels" })).toBeTruthy();
  expect(screen.getByText("Type a channel or category name.")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();

  await type("No matching name");
  expect(screen.getByRole("heading", { name: "No results for No matching name" })).toBeTruthy();
  expect(screen.getByText("Check the spelling or try another search.")).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Categories" })).toBeNull();
  expect(document.activeElement).toBe(field());
});

test("Live search separates category matches from channel matches", async () => {
  await mountApp(PLAYLIST);
  const before = played.length;
  await openSearch();
  await type("News");
  const categories = screen.getByRole("navigation", { name: "Categories" });
  expect(within(categories).getByRole("button", { name: /News/ })).toBeTruthy();
  expect(rows()).toEqual(["Alpha News"]);

  press(KEY.DOWN);
  press(KEY.LEFT);
  expect(categories.classList.contains("focused")).toBe(true);
  expect(
    within(categories).getByRole("button", { name: /News/ }).classList.contains("cursor"),
  ).toBe(true);
  press(KEY.UP);
  await settle(0);
  expect(document.activeElement).toBe(field());
  press(KEY.DOWN);
  press(KEY.LEFT);
  press(KEY.ENTER);
  await settle();

  expect(field()).toBeNull();
  expect(rows()).toEqual(["Alpha News", "Beta Report"]);
  expect(played).toHaveLength(before);
  press(KEY.LEFT);
  expect(document.querySelector(".rail.focused")).toBeTruthy();
  press(KEY.RIGHT);
  expect(document.querySelector(".list.focused")).toBeTruthy();
});

test("text input exits only at logical caret boundaries", () => {
  const onExitStart = vi.fn();
  const onExitEnd = vi.fn();
  render(
    <TextInput
      aria-label="Boundary input"
      defaultValue="alpha"
      onExitStart={onExitStart}
      onExitEnd={onExitEnd}
    />,
  );
  const input = document.querySelector<HTMLInputElement>(".text-input")!;

  input.setSelectionRange(2, 2);
  fireEvent.keyDown(input, { keyCode: KEY.LEFT });
  fireEvent.keyDown(input, { keyCode: KEY.RIGHT });
  expect(onExitStart).not.toHaveBeenCalled();
  expect(onExitEnd).not.toHaveBeenCalled();

  input.setSelectionRange(0, 0);
  fireEvent.keyDown(input, { keyCode: KEY.LEFT });
  input.setSelectionRange(input.value.length, input.value.length);
  fireEvent.keyDown(input, { keyCode: KEY.RIGHT });
  expect(onExitStart).toHaveBeenCalledOnce();
  expect(onExitEnd).toHaveBeenCalledOnce();
});

test("text input keeps selection ranges inside and mirrors RTL boundaries", () => {
  const onExitStart = vi.fn();
  const onExitEnd = vi.fn();
  document.documentElement.dir = "rtl";
  render(
    <TextInput
      aria-label="RTL boundary input"
      defaultValue="alpha"
      onExitStart={onExitStart}
      onExitEnd={onExitEnd}
    />,
  );
  const input = document.querySelector<HTMLInputElement>(".text-input")!;

  input.setSelectionRange(0, 3);
  fireEvent.keyDown(input, { keyCode: KEY.RIGHT });
  expect(onExitStart).not.toHaveBeenCalled();
  input.setSelectionRange(0, 0);
  fireEvent.keyDown(input, { keyCode: KEY.RIGHT });
  input.setSelectionRange(input.value.length, input.value.length);
  fireEvent.keyDown(input, { keyCode: KEY.LEFT });
  expect(onExitStart).toHaveBeenCalledOnce();
  expect(onExitEnd).toHaveBeenCalledOnce();
});

test("text input exposes shared vertical exit boundaries", () => {
  const onExitUp = vi.fn();
  const onExitDown = vi.fn();
  render(<TextInput aria-label="Vertical input" onExitUp={onExitUp} onExitDown={onExitDown} />);
  const input = document.querySelector<HTMLInputElement>(".text-input")!;

  fireEvent.keyDown(input, { keyCode: KEY.UP });
  fireEvent.keyDown(input, { keyCode: KEY.DOWN });
  expect(onExitUp).toHaveBeenCalledOnce();
  expect(onExitDown).toHaveBeenCalledOnce();
});

test("text input associates inline guidance and keeps its node and focus when it clears", () => {
  const view = render(
    <TextInput
      id="credentials"
      aria-label="Username"
      aria-describedby="credentials-hint"
      problem="Enter your username."
    />,
  );
  const input = screen.getByRole("textbox", { name: "Username" });
  const problem = screen.getByRole("alert");
  expect(input.nextElementSibling).toBe(problem);
  expect(input.getAttribute("aria-describedby")).toBe("credentials-hint credentials-problem");
  expect(problem.id).toBe("credentials-problem");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  input.focus();
  view.rerender(
    <TextInput id="credentials" aria-label="Username" aria-describedby="credentials-hint" />,
  );
  expect(screen.getByRole("textbox", { name: "Username" })).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute("aria-describedby")).toBe("credentials-hint");
  expect(input.getAttribute("aria-invalid")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("search is opened from the title bar and puts the cursor in the field", async () => {
  await mountApp(PLAYLIST);
  await openSearch();

  assert.ok(field(), "the field replaced the channel column's heading");
  assert.equal(document.activeElement, field(), "and it has the keyboard");
});

test("typing filters the column to the channels whose names match", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  assert.deepEqual(rows(), ["Alpha News", "Alpha Sport"]);
});

test("search uses effective channel names without changing provider identity", async () => {
  await mountApp(PLAYLIST, {
    personalLineup: {
      version: 1,
      revision: 1,
      personalisation: { channels: { a: { name: "My Headlines" } } },
    },
  });
  await openSearch();
  await type("headlines");
  assert.deepEqual(rows(), ["My Headlines"]);
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

test("Xtream search includes channels from every live category", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [
        { category_id: "first", category_name: "News" },
        { category_id: "second", category_name: "Sport" },
      ],
      [
        { stream_id: 1, name: "Morning News", category_id: "first", num: 1 },
        { stream_id: 2, name: "Night Sport", category_id: "second", num: 22 },
      ],
    ),
  });
  await openSearch();
  await type("night");

  assert.deepEqual(rows(), ["Night Sport"]);
});

test("number entry finds an Xtream channel outside the first category", async () => {
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [
        { category_id: "first", category_name: "News" },
        { category_id: "second", category_name: "Sport" },
      ],
      [
        { stream_id: 1, name: "Morning News", category_id: "first", num: 1 },
        { stream_id: 2, name: "Night Sport", category_id: "second", num: 22 },
      ],
    ),
  });

  press(50);
  press(50);
  press(KEY.ENTER);

  assert.deepEqual(played, ["http://provider.example/live/viewer/secret/2.m3u8"]);
});

test("hidden categories are absent from search by default", async () => {
  await mountApp(PLAYLIST, { hiddenCategories: ["News"] });
  await openSearch();
  await type("alpha");

  assert.deepEqual(rows(), ["Alpha Sport"]);
});

test("down leaves the field for the results, and up comes back to it", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");

  fieldKey(KEY.DOWN);
  assert.equal(selected(), "Alpha News", "down goes to the first result");
  assert.notEqual(document.activeElement, field(), "and the keyboard goes away with it");

  press(KEY.UP);
  await settle(0);
  assert.equal(
    document.activeElement,
    field(),
    "up from the first result returns to the field",
  );
});

test("OK on a result plays it", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("gamma");

  fieldKey(KEY.DOWN);
  press(KEY.ENTER);
  await settle();

  assert.deepEqual(played, ["http://example.invalid/c.m3u8"]);
  assert.equal(
    panelOpen(),
    false,
    "and the panel gets out of the way, as choosing any row does",
  );
});

test("choosing a result takes the rail to that channel's category", async () => {
  /*
   * Otherwise channel up and down would walk a category the playing channel is not in, and
   * closing the search would land the viewer somewhere unrelated to what they are watching.
   */
  await mountApp(PLAYLIST);
  await openSearch();
  await type("gamma");
  fieldKey(KEY.DOWN);
  press(KEY.ENTER);
  await settle();

  press(KEY.LEFT); // back into the panel, which reopens on what is playing
  await settle();
  assert.equal(document.querySelector(".rail .row.showing .row-label")?.textContent, "Sport");
});

test("channel arrows continue from the channel selected in Search", async () => {
  await mountApp(PLAYLIST, { resume: "a" });
  await openSearch();
  await type("Alpha Sport");
  fieldKey(KEY.DOWN);
  press(KEY.ENTER);
  await settle(0);
  assert.equal(played[played.length - 1], "http://example.invalid/d.m3u8");

  press(KEY.UP);
  await settle(48);
  assert.equal(played[played.length - 1], "http://example.invalid/c.m3u8");
  press(KEY.DOWN);
  await settle(48);
  assert.equal(played[played.length - 1], "http://example.invalid/d.m3u8");
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

  press(52); // the "4" key, which outside a search dials channel 4
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

test("returning from application navigation restores the existing Search result", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("alpha");
  fieldKey(KEY.DOWN);

  press(KEY.LEFT);
  await settle(0);

  assert.ok(field(), "the search remains mounted");
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  assert.deepEqual(rows(), ["Alpha News", "Alpha Sport"]);

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".list .row.cursor .row-label")?.textContent).toBe(
    "Alpha News",
  );
});

test("left on an empty field enters application navigation", async () => {
  await mountApp(PLAYLIST);
  await openSearch();

  fieldKey(KEY.LEFT);
  await settle(0);

  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  assert.notEqual(document.activeElement, field(), "and the keyboard has gone with it");
});

test("Search replaces browsing categories with matches and Back restores the exact origin", async () => {
  await mountApp(PLAYLIST);
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.RIGHT);
  await settle();
  assert.deepEqual(rows(), ["Gamma Sport", "Alpha Sport"]);

  await openSearch();
  await type("alpha");
  expect(document.querySelector(".panel .search-categories")).toBeTruthy();
  expect(document.querySelectorAll(".panel .search-categories .row")).toHaveLength(0);
  press(KEY.BACK);
  press(KEY.BACK);
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
  press(KEY.DOWN); // the second result

  press(KEY.BACK); // clears the query, and the cursor returns to the field
  await settle();
  press(KEY.BACK); // an empty field has no search left to go back through
  await settle();

  assert.equal(selected(), "Alpha News", "the first row of the category");
});

test("Enter while typing stays in the field and Down then Enter still opens a result", async () => {
  await mountApp(PLAYLIST);
  await openSearch();
  await type("Alpha");

  const before = played.length;
  const value = field()!.value;
  const names = rows();

  // A native Enter on the focused field is inert: same element, same text,
  // same results and nothing played.
  fieldKey(KEY.ENTER);
  await settle(0);
  assert.equal(document.activeElement, field());
  assert.equal(field()!.value, value);
  assert.deepEqual(rows(), names);
  assert.equal(played.length, before);

  // The remote's Enter is inert the same way.
  press(KEY.ENTER);
  await settle(0);
  assert.equal(document.activeElement, field());
  assert.equal(field()!.value, value);
  assert.deepEqual(rows(), names);
  assert.equal(played.length, before);

  // Down reaches the results and Enter there still activates the first one.
  press(KEY.DOWN);
  await settle(0);
  assert.notEqual(document.activeElement, field());
  press(KEY.ENTER);
  await settle(0);
  assert.ok(played.length > before, "the result played");
});
