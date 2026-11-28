import assert from "node:assert/strict";
import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  initialVodNavigation,
  reduceVodNavigation,
  useVodNavigation,
  type VodNavigationContext,
  type VodNavigationOptions,
  type VodNavigationState,
  type VodOrigin,
} from "../src/hooks/useVodNavigation";
import { useContentTransition } from "../src/hooks/useContentTransition";
import { KEY } from "../src/hooks/useRemote";
import { windowOf } from "../src/hooks/useWindowed";

const context = (overrides: Partial<VodNavigationContext> = {}): VodNavigationContext => ({
  direction: "ltr",
  headerKeys: ["live", "movie", "series", "search", "settings"],
  categoryKeys: ["movie:all", "movie:10", "movie:20"],
  itemKeys: Array.from({ length: 20 }, (_, index) => `movie:${index}`),
  searchItemKeys: ["movie:9", "movie:3"],
  seasons: [1, 2],
  episodeKeys: ["episode:1", "episode:2", "episode:3"],
  detailActionCount: 3,
  detailRetryAvailable: false,
  regionState: "loaded",
  ...overrides,
});

const key = (state: VodNavigationState, code: number, overrides = {}) =>
  reduceVodNavigation(state, { type: "key", code }, context(overrides));

const root = () => {
  const state = initialVodNavigation("movie");
  return reduceVodNavigation(state, { type: "category-focus", index: 0 }, context());
};

test.each(["ltr", "rtl"] as const)(
  "search arrows move between category and content columns in %s",
  (direction) => {
    const options = context({
      direction,
      searchCategoryKeys: ["movie:10", "movie:20"],
      searchItemKeys: ["movie:9", "movie:3"],
    });
    const move = (state: VodNavigationState, code: number) =>
      reduceVodNavigation(state, { type: "key", code }, options);
    const start = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
    const end = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
    let state = reduceVodNavigation(root(), { type: "search-open" }, options);
    state = reduceVodNavigation(state, { type: "query", value: "Name" }, options);
    state = reduceVodNavigation(state, { type: "query-apply", value: "Name" }, options);
    state = move(state, KEY.DOWN);
    expect(state.zone).toBe("search-grid");
    expect(state.search?.itemKey).toBe("movie:9");
    state = move(state, start);
    expect(state.zone).toBe("search-categories");
    state = move(state, KEY.DOWN);
    expect(state.search?.categoryIndex).toBe(1);
    state = move(state, end);
    expect(state.zone).toBe("search-grid");
    expect(state.search?.itemKey).toBe("movie:9");
    state = move(move(move(state, start), KEY.UP), KEY.UP);
    expect(state.zone).toBe("search-field");
    expect(state.search?.keyboardOpen).toBe(true);
  },
);

test("accelerated grid movement preserves columns until the partial final row", () => {
  const options = context({
    posterColumns: 6,
    itemKeys: Array.from({ length: 200 }, (_, index) => `movie:${index}`),
  });
  let state = reduceVodNavigation(
    { ...root(), zone: "grid" },
    { type: "item-focus", index: 2 },
    options,
  );
  state = reduceVodNavigation(
    state,
    { type: "key", code: KEY.DOWN, amount: 20, repeat: true },
    options,
  );
  expect(state.selectedItemIndex).toBe(122);
  state = reduceVodNavigation(
    state,
    { type: "key", code: KEY.DOWN, amount: 20, repeat: true },
    options,
  );
  expect(state.selectedItemIndex).toBe(199);
  state = reduceVodNavigation(
    state,
    { type: "key", code: KEY.UP, amount: 20, repeat: true },
    options,
  );
  expect(state.selectedItemIndex).toBe(79);
  state = reduceVodNavigation(
    state,
    { type: "key", code: KEY.UP, amount: 20, repeat: true },
    options,
  );
  expect(state.selectedItemIndex).toBe(1);
  state = reduceVodNavigation(
    state,
    { type: "key", code: KEY.UP, amount: 20, repeat: true },
    options,
  );
  expect(state.zone).toBe("grid");
  expect(state.selectedItemIndex).toBe(1);
});

test("VOD grids cross the former page boundary without resetting", () => {
  let state = { ...root(), zone: "grid" as const };
  state = reduceVodNavigation(state, { type: "item-focus", index: 12 }, context());
  const next = key(state, KEY.DOWN);
  expect(next.selectedItemIndex).toBe(18);
  expect(next.selectedItemKey).toBe("movie:18");
  expect(key(next, KEY.UP).selectedItemIndex).toBe(12);
});

test.each(["grid", "search-grid"] as const)(
  "%s reaches a partial last row from every column and stops there",
  (zone) => {
    const keys = Array.from({ length: 7 }, (_, index) => `movie:${index}`);
    const options = context({ itemKeys: keys, searchItemKeys: keys, posterColumns: 6 });
    const base =
      zone === "search-grid"
        ? reduceVodNavigation(root(), { type: "search-open" }, options)
        : root();
    for (let column = 0; column < 6; column += 1) {
      const start = reduceVodNavigation(
        { ...base, zone },
        { type: "item-focus", index: column },
        options,
      );
      const last = reduceVodNavigation(start, { type: "key", code: KEY.DOWN }, options);
      expect(last.search?.itemIndex ?? last.selectedItemIndex).toBe(6);
      expect(reduceVodNavigation(last, { type: "key", code: KEY.DOWN }, options)).toBe(last);
    }
  },
);

test.each([0, 0.5])(
  "measured poster movement updates the cursor and window together from row %s",
  (initialFirst) => {
    const measured = context({
      itemKeys: Array.from({ length: 37 }, (_, index) => `movie:${index}`),
      posterColumns: 6,
      posterVisibleRows: 2,
    });
    let state = reduceVodNavigation(
      root(),
      { type: "category-display", categoryKey: "movie:all", enterContent: true },
      measured,
    );
    state = reduceVodNavigation(
      state,
      { type: "item-window", firstRow: initialFirst },
      measured,
    );
    const moves = [
      [KEY.DOWN, 6, initialFirst],
      [KEY.RIGHT, 7, initialFirst],
      [KEY.LEFT, 6, initialFirst],
      [KEY.DOWN, 12, 1],
      [KEY.DOWN, 18, 2],
      [KEY.DOWN, 24, 3],
      [KEY.DOWN, 30, 4],
      [KEY.DOWN, 36, 5],
      [KEY.UP, 30, 5],
      [KEY.UP, 24, 4],
      [KEY.UP, 18, 3],
      [KEY.UP, 12, 2],
      [KEY.UP, 6, 1],
      [KEY.UP, 0, 0],
    ];

    for (const [code, index, firstRow] of moves) {
      const previousFirst = state.memories.movie.firstRow;
      state = reduceVodNavigation(state, { type: "key", code }, measured);
      expect(state.selectedItemIndex).toBe(index);
      expect(state.selectedItemKey).toBe(`movie:${index}`);
      expect(state.memories.movie.firstRow).toBe(firstRow);
      expect(state.memories.movie.firstRow).toBe(
        windowOf(7, Math.floor(index / 6), 2, 1, previousFirst, 1, 0).first,
      );
      expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(firstRow);
      expect(reduceVodNavigation(state, { type: "item-window", firstRow }, measured)).toBe(
        state,
      );
    }
  },
);

test("measured reconciliation shifts the original window only once", () => {
  const keys = Array.from({ length: 60 }, (_, index) => `movie:${index}`);
  const measured = context({
    itemKeys: keys,
    posterColumns: 6,
    posterVisibleRows: 2,
  });
  let state = reduceVodNavigation(
    root(),
    { type: "category-display", categoryKey: "movie:all", enterContent: true },
    measured,
  );
  state = reduceVodNavigation(state, { type: "item-focus", index: 18 }, measured);
  expect(state.memories.movie.firstRow).toBe(2);
  const reordered = keys.slice();
  [reordered[18], reordered[30]] = [reordered[30], reordered[18]];
  state = reduceVodNavigation(
    state,
    { type: "items-reconcile", preferredKey: "movie:18" },
    { ...measured, itemKeys: reordered },
  );

  expect(state.selectedItemIndex).toBe(30);
  expect(state.memories.movie.firstRow).toBe(4);
  expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(4);
});

test("measured category windows preserve exact origins and explicit reset rules", () => {
  const measured = context({
    itemKeys: Array.from({ length: 60 }, (_, index) => `movie:${index}`),
    posterColumns: 6,
    posterVisibleRows: 2,
  });
  let state = reduceVodNavigation(
    root(),
    { type: "category-display", categoryKey: "movie:all", enterContent: true },
    measured,
  );
  state = reduceVodNavigation(state, { type: "item-focus", index: 18 }, measured);
  state = reduceVodNavigation(state, { type: "item-window", firstRow: 2.5 }, measured);
  const origin: VodOrigin = {
    mode: "movie",
    surface: "category",
    categoryKey: "movie:all",
    itemKey: "movie:18",
    itemIndex: 18,
    firstRow: 2.5,
  };
  state = reduceVodNavigation(
    state,
    { type: "details-open", itemKey: origin.itemKey, origin },
    measured,
  );
  state = reduceVodNavigation(state, { type: "details-close" }, measured);
  expect(state.selectedItemIndex).toBe(18);
  expect(state.memories.movie.firstRow).toBe(2.5);
  expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(2.5);

  state = reduceVodNavigation(
    state,
    { type: "category-display", categoryKey: "movie:all", enterContent: true },
    measured,
  );
  expect(state.memories.movie.firstRow).toBe(2.5);
  state = reduceVodNavigation(
    state,
    { type: "category-display", categoryKey: "movie:10", enterContent: true },
    measured,
  );
  expect(state.selectedItemIndex).toBe(0);
  expect(state.memories.movie.firstRow).toBe(0);
  expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(2.5);
  state = reduceVodNavigation(state, { type: "item-focus", index: 24 }, measured);
  expect(state.memories.movie.firstRow).toBe(3);
  state = reduceVodNavigation(state, { type: "items-reset" }, measured);
  expect(state.selectedItemIndex).toBe(0);
  expect(state.memories.movie.firstRow).toBe(0);
  expect(state.memories.movie.firstRowByCategory["movie:10"]).toBe(0);
  expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(2.5);
  expect(state.memories.movie.posterWindowRevision).toBe(1);
  expect(state.memories.series).toEqual(initialVodNavigation("movie").memories.series);
});

test("measured Movie and Series windows restore independently on mode changes", () => {
  const movie = context({
    categoryKeys: ["movie:all"],
    itemKeys: Array.from({ length: 60 }, (_, index) => `movie:${index}`),
    posterColumns: 6,
    posterVisibleRows: 2,
  });
  const series = context({
    categoryKeys: ["series:all"],
    itemKeys: Array.from({ length: 60 }, (_, index) => `series:${index}`),
    posterColumns: 6,
    posterVisibleRows: 2,
  });
  let state = reduceVodNavigation(
    root(),
    { type: "category-display", categoryKey: "movie:all", enterContent: true },
    movie,
  );
  state = reduceVodNavigation(state, { type: "item-focus", index: 18 }, movie);
  state = reduceVodNavigation(state, { type: "mode", mode: "series" }, series);
  state = reduceVodNavigation(state, { type: "item-focus", index: 30 }, series);
  expect(state.memories.movie.firstRow).toBe(2);
  expect(state.memories.series.firstRow).toBe(4);

  state = reduceVodNavigation(state, { type: "mode", mode: "movie" }, movie);
  expect(state.selectedItemKey).toBe("movie:18");
  expect(state.selectedItemIndex).toBe(18);
  expect(state.memories.movie.firstRow).toBe(2);
  expect(state.memories.movie.firstRowByCategory["movie:all"]).toBe(2);
  state = reduceVodNavigation(state, { type: "mode", mode: "series" }, series);
  expect(state.selectedItemKey).toBe("series:30");
  expect(state.selectedItemIndex).toBe(30);
  expect(state.memories.series.firstRow).toBe(4);
  expect(state.memories.series.firstRowByCategory["series:all"]).toBe(4);
});

test("generic item reconciliation keeps the selected item in the same viewport row", () => {
  const state = {
    ...root(),
    zone: "catalogue-actions" as const,
    displayedCategoryKey: "movie:all",
    selectedItemIndex: 3,
    selectedItemKey: "movie:old",
    memories: {
      ...root().memories,
      movie: {
        ...root().memories.movie,
        firstRow: 1,
        firstRowByCategory: { "movie:all": 1 },
      },
    },
  };
  const next = reduceVodNavigation(
    state,
    { type: "items-reconcile", preferredKey: "movie:old" },
    context({
      itemKeysByCategory: {
        "movie:all": Array.from({ length: 12 }, (_, index) =>
          index === 9 ? "movie:old" : `movie:${index}`,
        ),
      },
      posterColumns: 3,
    }),
  );

  expect(next.selectedItemIndex).toBe(9);
  expect(next.memories.movie.firstRow).toBe(3);
});

test.each(["movie", "series"] as const)(
  "%s explicit item reset selects the reordered first item and clears only its window",
  (mode) => {
    const categoryKey = `${mode}:10`;
    let state = initialVodNavigation(mode);
    state = {
      ...state,
      zone: "catalogue-actions",
      selectedCategoryKey: categoryKey,
      displayedCategoryKey: categoryKey,
    };
    const originalContext = context({
      itemKeysByCategory: {
        [categoryKey]: Array.from({ length: 60 }, (_, index) => `${mode}:${index}`),
      },
    });
    state = reduceVodNavigation(state, { type: "item-focus", index: 18 }, originalContext);
    state = reduceVodNavigation(state, { type: "item-window", firstRow: 3 }, originalContext);
    const otherMode = mode === "movie" ? "series" : "movie";
    const oldMemory = state.memories[mode];
    const reordered = [
      `${mode}:new-first`,
      ...originalContext.itemKeysByCategory![categoryKey].slice().reverse(),
    ];
    const next = reduceVodNavigation(
      state,
      { type: "items-reset" },
      context({ itemKeysByCategory: { [categoryKey]: reordered } }),
    );

    expect(reordered.indexOf(state.selectedItemKey)).toBeGreaterThan(30);
    expect(next.selectedItemIndex).toBe(0);
    expect(next.selectedItemKey).toBe(reordered[0]);
    expect(next.zone).toBe(state.zone);
    expect(next.selectedCategoryKey).toBe(categoryKey);
    expect(next.displayedCategoryKey).toBe(categoryKey);
    expect(next.memories[mode]).toEqual({
      ...oldMemory,
      itemIndex: 0,
      itemKey: reordered[0],
      firstRow: 0,
      itemByCategory: { ...oldMemory.itemByCategory, [categoryKey]: reordered[0] },
      indexByCategory: { ...oldMemory.indexByCategory, [categoryKey]: 0 },
      firstRowByCategory: { ...oldMemory.firstRowByCategory, [categoryKey]: 0 },
      posterWindowRevision: oldMemory.posterWindowRevision + 1,
    });
    expect(next.memories[otherMode]).toBe(state.memories[otherMode]);
    expect(state.memories[mode]).toBe(oldMemory);
    expect(state.selectedItemIndex).toBe(18);
    expect(oldMemory.firstRow).toBe(3);
    const repeated = reduceVodNavigation(
      next,
      { type: "items-reset" },
      context({
        itemKeysByCategory: { [categoryKey]: reordered },
      }),
    );
    expect(repeated.memories[mode].posterWindowRevision).toBe(2);
  },
);

test.each(["movie", "series"] as const)("%s item reset handles an empty catalogue", (mode) => {
  const state = initialVodNavigation(mode);
  const next = reduceVodNavigation(state, { type: "items-reset" }, context({ itemKeys: [] }));
  expect(next.selectedItemIndex).toBe(0);
  expect(next.selectedItemKey).toBe("");
  expect(next.memories[mode].itemByCategory[""]).toBe("");
  expect(next.memories[mode].indexByCategory[""]).toBe(0);
  expect(next.memories[mode].firstRowByCategory[""]).toBe(0);
  expect(next.memories[mode].firstRow).toBe(0);
  expect(next.memories[mode].posterWindowRevision).toBe(1);
});

test("catalogue item reset leaves search state unchanged", () => {
  const state = reduceVodNavigation(root(), { type: "search-open" }, context());
  expect(reduceVodNavigation(state, { type: "items-reset" }, context())).toBe(state);
});

test("Movie and Series category rails include Search at their boundary", () => {
  const first = root();
  const search = key(first, KEY.UP);
  expect(search.zone).toBe("rail-search");
  const last = key(search, KEY.UP);
  expect(last.selectedCategoryKey).toBe("movie:20");
  expect(key(last, KEY.DOWN).zone).toBe("rail-search");
  expect(key(key(last, KEY.DOWN), KEY.DOWN).selectedCategoryKey).toBe("movie:all");
});

const refreshedCategoryCases = [
  [
    "reordered",
    ["movie:20", "movie:all", "movie:10"],
    "movie:20",
    "movie:all",
    "rail-search",
    "rail",
  ],
  ["shortened", ["movie:20"], "movie:20", "movie:20", "rail-search", "rail-search"],
  [
    "missing selected key",
    ["movie:all", "movie:10", "movie:30"],
    "movie:10",
    "movie:20",
    "rail",
    "rail-search",
  ],
  ["empty", [], "movie:20", "movie:20", "rail-search", "rail-search"],
] as const;

test.each(refreshedCategoryCases)(
  "%s categories preserve reducer rail movement with stale memory",
  (_label, categoryKeys, up, down, upZone, downZone) => {
    const state = reduceVodNavigation(root(), { type: "category-focus", index: 2 }, context());
    expect(key(state, KEY.UP, { categoryKeys }).selectedCategoryKey).toBe(up);
    expect(key(state, KEY.DOWN, { categoryKeys }).selectedCategoryKey).toBe(down);
    expect(key(state, KEY.UP, { categoryKeys }).zone).toBe(upZone);
    expect(key(state, KEY.DOWN, { categoryKeys }).zone).toBe(downZone);
  },
);

test("header cursor reaches every rendered control and mirrors inline movement", () => {
  let state = { ...root(), zone: "header" as const, headerControl: "movie" as const };
  state = key(state, KEY.RIGHT);
  assert.equal(state.headerControl, "series");
  state = key(state, KEY.RIGHT);
  assert.equal(state.headerControl, "search");
  state = key(state, KEY.RIGHT);
  assert.equal(state.headerControl, "settings");
  assert.equal(key(state, KEY.RIGHT).headerControl, "settings");
  assert.equal(key(state, KEY.DOWN).zone, "rail");

  const rtl = key({ ...root(), zone: "header" as const, headerControl: "movie" }, KEY.LEFT, {
    direction: "rtl",
  });
  assert.equal(rtl.headerControl, "series");
});

test("details retain action focus at the top edge", () => {
  const details = reduceVodNavigation(
    root(),
    {
      type: "details-open",
      itemKey: "movie:1",
      origin: {
        mode: "movie",
        surface: "category",
        categoryKey: "movie:all",
        itemKey: "movie:1",
        itemIndex: 1,
        firstRow: 0,
      },
    },
    context(),
  );
  const header = key(details, KEY.UP);
  assert.equal(header.zone, "detail-actions");
  assert.equal(key(header, KEY.DOWN).zone, "detail-actions");
});

test("loaded details reach Favourite across the secondary action row", () => {
  const opened = reduceVodNavigation(
    root(),
    {
      type: "details-open",
      itemKey: "movie:1",
      origin: {
        mode: "movie",
        surface: "category",
        categoryKey: "movie:all",
        itemKey: "movie:1",
        itemIndex: 1,
        firstRow: 0,
      },
    },
    context(),
  );
  const ready = reduceVodNavigation(opened, { type: "details-ready" }, context());
  assert.equal(ready.zone, "detail-actions");
  assert.equal(ready.details?.actionIndex, 0);
  const favourite = key(key(ready, KEY.DOWN), KEY.RIGHT);
  assert.equal(favourite.zone, "detail-actions");
  assert.equal(favourite.details?.actionIndex, 2);
  const header = key(ready, KEY.UP);
  assert.equal(header.zone, "detail-actions");
  assert.equal(key(header, KEY.DOWN).zone, "detail-actions");
  assert.equal(key(favourite, KEY.DOWN).details?.actionIndex, 2);
});

test("Down from the header restores the exact grid item it came from", () => {
  const header = {
    ...root(),
    zone: "header" as const,
    headerReturnZone: "grid" as const,
    selectedItemIndex: 4,
    selectedItemKey: "movie:4",
  };
  const restored = key(header, KEY.DOWN);
  assert.equal(restored.zone, "grid");
  assert.equal(restored.selectedItemIndex, 4);
  assert.equal(restored.selectedItemKey, "movie:4");
});

test("category selection changes immediately while displayed content waits", () => {
  const selected = reduceVodNavigation(root(), { type: "category-focus", index: 2 }, context());
  assert.equal(selected.selectedCategoryKey, "movie:20");
  assert.equal(selected.displayedCategoryKey, "");
  const displayed = reduceVodNavigation(
    selected,
    { type: "category-display", categoryKey: "movie:20" },
    context(),
  );
  assert.equal(displayed.displayedCategoryKey, "movie:20");
});

test("the category window counts its heading without making that row selectable", () => {
  const options = context({
    categoryHeaderIndex: 1,
    categoryVisibleRows: 2,
    categoryRowHeight: 84,
  });
  const state = reduceVodNavigation(root(), { type: "category-focus", index: 1 }, options);
  expect(state.selectedCategoryKey).toBe("movie:10");
  expect(state.memories.movie.railIndex).toBe(1);
  expect(state.memories.movie.categoryFirst).toBe(1);
  expect(state.memories.movie.categoryScrollOffset).toBe(84);
});

test("category rail window origins stay isolated between Movie and Series memory", () => {
  let state = reduceVodNavigation(
    root(),
    { type: "category-window", first: 4, scrollOffset: 355.5 },
    context(),
  );
  expect(state.memories.movie.categoryFirst).toBe(4);
  expect(state.memories.movie.categoryScrollOffset).toBe(355.5);
  state = reduceVodNavigation(
    state,
    { type: "category-window", first: 4, scrollOffset: 379.25 },
    context(),
  );
  expect(state.memories.movie.categoryScrollOffset).toBe(379.25);

  state = reduceVodNavigation(
    state,
    { type: "mode", mode: "series" },
    context({ categoryKeys: ["series:all"], itemKeys: ["series:0"] }),
  );
  expect(state.memories.series.categoryFirst).toBe(0);
  expect(state.memories.series.categoryScrollOffset).toBeUndefined();

  state = reduceVodNavigation(
    state,
    { type: "mode", mode: "movie" },
    context({ categoryKeys: ["movie:all"], itemKeys: ["movie:0"] }),
  );
  expect(state.memories.movie.categoryFirst).toBe(4);
  expect(state.memories.movie.categoryScrollOffset).toBe(379.25);
});

test("mode changes expose the new category and first item before the next paint", () => {
  vi.useFakeTimers();
  const settled = vi.fn();
  const options = (mode: "movie" | "series") => {
    const categoryKey = `${mode}:all`;
    const itemKeys = [`${mode}:0`, `${mode}:1`];
    return {
      ...context({
        categoryKeys: [categoryKey],
        itemKeys,
        itemKeysByCategory: { [categoryKey]: itemKeys },
      }),
      mode,
      onCategorySettled: settled,
      onQuerySettled: () => undefined,
      onPosterSettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
    };
  };
  const { result, rerender, unmount } = renderHook(
    ({ mode }) => useVodNavigation(options(mode)),
    { initialProps: { mode: "movie" as const } },
  );

  act(() => {
    result.current.selectItem(1);
    result.current.selectCategory(0, false);
  });
  rerender({ mode: "series" });
  act(() => vi.advanceTimersByTime(150));

  expect(result.current.state.mode).toBe("series");
  expect(result.current.state.selectedCategoryKey).toBe("series:all");
  expect(result.current.state.selectedItemKey).toBe("series:0");
  expect(result.current.state.zone).toBe("rail");
  expect(settled).not.toHaveBeenCalled();

  unmount();
  vi.useRealTimers();
});

test("Search is reachable from either end of a category rail", () => {
  const first = root();
  assert.equal(key(first, KEY.UP).zone, "rail-search");
  const last = reduceVodNavigation(first, { type: "category-focus", index: 2 }, context());
  assert.equal(key(last, KEY.DOWN).zone, "rail-search");
  assert.equal(key(key(first, KEY.UP), KEY.ENTER).zone, "search-field");
});

test("an empty category retains rail focus and a failed category exposes Retry", () => {
  const state = root();
  assert.equal(key(state, KEY.RIGHT, { regionState: "empty" }).zone, "rail");
  assert.equal(key(state, KEY.RIGHT, { regionState: "failed" }).zone, "retry");
});

test("rail Enter waits for the selected category resource and enters with its first item key", () => {
  const selected = root();
  const early = key(selected, KEY.ENTER);
  expect(early.zone).toBe("rail");
  expect(early.selectedItemKey).toBe("");

  const displayed = reduceVodNavigation(
    selected,
    { type: "category-display", categoryKey: "movie:all" },
    context(),
  );
  const entered = key(displayed, KEY.ENTER);
  expect(entered.zone).toBe("grid");
  expect(entered.selectedItemKey).toBe("movie:0");
  expect(entered.details).toBeNull();
});

test("Retry returns to the owning region on inline start and Back", () => {
  const failed = key(root(), KEY.RIGHT, { regionState: "failed" });
  assert.equal(failed.zone, "retry");
  assert.equal(key(failed, KEY.LEFT).zone, "rail");
  assert.equal(key(failed, KEY.BACK).zone, "rail");

  let search = reduceVodNavigation(root(), { type: "search-open" }, context());
  expect(key(search, KEY.DOWN, { searchRegionState: "failed" }).zone).toBe("search-field");
  search = reduceVodNavigation(search, { type: "query-apply", value: "pilot" }, context());
  const searchRetry = key(search, KEY.DOWN, { searchRegionState: "failed" });
  assert.equal(searchRetry.zone, "retry");
  assert.equal(key(searchRetry, KEY.BACK).zone, "search-field");
});

test.each(["ltr", "rtl"] as const)(
  "Search recovery uses vertical navigation in %s and returns to its originating control",
  (direction) => {
    const failed = context({ direction, searchRegionState: "failed" });
    let search = reduceVodNavigation(root(), { type: "search-open" }, failed);
    search = reduceVodNavigation(search, { type: "query-apply", value: "pilot" }, failed);
    for (const control of ["search-field", "search-submit"] as const) {
      const bar = reduceVodNavigation(
        search,
        { type: "search-control-focus", control },
        failed,
      );
      const retry = reduceVodNavigation(bar, { type: "key", code: KEY.DOWN }, failed);
      expect(retry.zone).toBe("retry");
      expect(retry.search?.keyboardOpen).toBe(false);
      expect(reduceVodNavigation(retry, { type: "key", code: KEY.UP }, failed).zone).toBe(
        control,
      );
      expect(reduceVodNavigation(retry, { type: "key", code: KEY.LEFT }, failed).zone).toBe(
        "retry",
      );
      expect(reduceVodNavigation(retry, { type: "key", code: KEY.RIGHT }, failed).zone).toBe(
        "retry",
      );
      const loading = reduceVodNavigation(retry, { type: "retry-exit" }, failed);
      expect(loading.zone).toBe("search-submit");
      expect(loading.search?.keyboardOpen).toBe(false);
    }
  },
);

test("Search grid returns to Search controls at its edges", () => {
  let search = reduceVodNavigation(root(), { type: "search-open" }, context());
  search = reduceVodNavigation(search, { type: "query", value: "pilot" }, context());
  search = reduceVodNavigation(search, { type: "query-apply", value: "pilot" }, context());
  search = { ...search, zone: "search-grid" };

  const left = key(search, KEY.LEFT);
  assert.equal(left.zone, "search-submit");
  assert.equal(key(left, KEY.LEFT).zone, "search-field");
  assert.equal(key(search, KEY.UP).zone, "search-submit");
});

test("category and search cursors keep isolated item and row memory", () => {
  let state = reduceVodNavigation(
    root(),
    { type: "category-display", categoryKey: "movie:all" },
    context(),
  );
  state = reduceVodNavigation(state, { type: "item-focus", index: 8 }, context());
  state = reduceVodNavigation(state, { type: "item-window", firstRow: 1 }, context());
  const categoryMemory = state.memories.movie;
  state = reduceVodNavigation(state, { type: "search-open" }, context());
  state = { ...state, zone: "search-grid" };
  state = reduceVodNavigation(state, { type: "item-focus", index: 1 }, context());
  state = reduceVodNavigation(state, { type: "search-window", firstRow: 2 }, context());

  assert.equal(state.search?.itemIndex, 1);
  assert.equal(state.search?.firstRow, 2);
  assert.deepEqual(state.memories.movie, categoryMemory);
});

test("category row windows restore independently after details", () => {
  let state = reduceVodNavigation(
    root(),
    { type: "category-display", categoryKey: "movie:all" },
    context(),
  );
  state = reduceVodNavigation(state, { type: "item-focus", index: 12 }, context());
  state = reduceVodNavigation(state, { type: "item-window", firstRow: 2 }, context());
  const origin = {
    mode: "movie" as const,
    surface: "category" as const,
    categoryKey: "movie:all",
    itemKey: "movie:12",
    itemIndex: 12,
    firstRow: 2,
  };
  state = reduceVodNavigation(
    state,
    { type: "details-open", itemKey: "movie:12", origin },
    context(),
  );
  state = reduceVodNavigation(state, { type: "details-close" }, context());

  assert.equal(state.selectedItemIndex, 12);
  assert.equal(state.memories.movie.firstRow, 2);
  assert.equal(state.memories.movie.firstRowByCategory["movie:all"], 2);
});

test("poster directions stay within rows while vertical movement uses six columns", () => {
  const state = {
    ...root(),
    zone: "grid" as const,
    selectedItemIndex: 6,
    selectedItemKey: "movie:6",
  };
  assert.equal(key(state, KEY.RIGHT).selectedItemIndex, 7);
  assert.equal(key(state, KEY.DOWN).selectedItemIndex, 12);
  assert.equal(key(state, KEY.UP).selectedItemIndex, 0);
  assert.equal(key({ ...state, selectedItemIndex: 5 }, KEY.RIGHT).selectedItemIndex, 5);
  const partialRow = { itemKeys: Array.from({ length: 14 }, (_, index) => `movie:${index}`) };
  assert.equal(
    key({ ...state, selectedItemIndex: 8 }, KEY.DOWN, partialRow).selectedItemIndex,
    13,
  );
  assert.equal(
    key({ ...state, selectedItemIndex: 7 }, KEY.DOWN, partialRow).selectedItemIndex,
    13,
  );
  assert.equal(
    key({ ...state, selectedItemIndex: 12 }, KEY.DOWN, partialRow).selectedItemIndex,
    12,
  );
  const top = key({ ...state, selectedItemIndex: 0, selectedItemKey: "movie:0" }, KEY.UP);
  assert.equal(top.zone, "catalogue-actions");
  assert.equal(top.selectedItemIndex, 0);
  assert.equal(top.selectedItemKey, "movie:0");
  assert.equal(top.memories.movie.firstRow, state.memories.movie.firstRow);
});

test("physical inline directions mirror in right to left layouts", () => {
  const state = {
    ...root(),
    zone: "grid" as const,
    selectedItemIndex: 6,
    selectedItemKey: "movie:6",
  };
  assert.equal(key(state, KEY.LEFT, { direction: "rtl" }).selectedItemIndex, 7);
  assert.equal(key(state, KEY.RIGHT, { direction: "rtl" }).zone, "rail");
});

test("search Back dismisses the keyboard before restoring its exact origin", () => {
  const category = {
    ...root(),
    zone: "grid" as const,
    displayedCategoryKey: "movie:10",
    selectedItemIndex: 8,
    selectedItemKey: "movie:8",
  };
  const search = reduceVodNavigation(category, { type: "search-open" }, context());
  const dismissed = key(search, KEY.BACK);
  assert.equal(dismissed.zone, "search-field");
  assert.equal(dismissed.search?.keyboardOpen, false);
  const restored = key(dismissed, KEY.BACK);
  assert.equal(restored.zone, "grid");
  assert.equal(restored.selectedItemIndex, 8);
  assert.equal(restored.displayedCategoryKey, "movie:10");
});

test("leaving the search field clears keyboard ownership", () => {
  const opened = reduceVodNavigation(root(), { type: "search-open" }, context());
  const search = reduceVodNavigation(opened, { type: "query-apply", value: "Film" }, context());
  const results = key(search, KEY.DOWN);
  assert.equal(results.zone, "search-grid");
  assert.equal(results.search?.keyboardOpen, false);
  const closed = key(results, KEY.BACK);
  assert.equal(closed.search, null);
  assert.equal(closed.zone, "grid");
});

test("details Back restores the exact search result origin", () => {
  const origin: VodOrigin = {
    mode: "movie",
    surface: "search",
    categoryKey: "movie:all",
    itemKey: "movie:3",
    itemIndex: 1,
    firstRow: 0,
    query: "film",
  };
  const details = reduceVodNavigation(
    root(),
    { type: "details-open", itemKey: "movie:3", origin },
    context(),
  );
  const restored = key(details, KEY.BACK);
  assert.equal(restored.zone, "search-grid");
  assert.equal(restored.selectedItemKey, "movie:3");
  assert.equal(restored.search?.query, "film");
  assert.equal(key(restored, KEY.BACK).search, null);
});

test("returning from a search result preserves the category origin for the next Back", () => {
  const category = {
    ...root(),
    zone: "grid" as const,
    selectedCategoryKey: "movie:10",
    displayedCategoryKey: "movie:10",
    selectedItemIndex: 8,
    selectedItemKey: "movie:8",
  };
  const search = reduceVodNavigation(category, { type: "search-open" }, context());
  const origin: VodOrigin = {
    mode: "movie",
    surface: "search",
    categoryKey: "movie:10",
    itemKey: "movie:3",
    itemIndex: 1,
    firstRow: 0,
    query: "film draft",
    appliedQuery: "film",
  };
  const details = reduceVodNavigation(
    search,
    { type: "details-open", itemKey: "movie:3", origin },
    context(),
  );
  const restored = key(details, KEY.BACK);
  expect(restored.search?.origin).toEqual(search.search?.origin);
  expect(restored.search?.query).toBe("film draft");
  expect(restored.search?.applied).toBe("film");
  const closed = key(restored, KEY.BACK);
  expect(closed.search).toBeNull();
  expect(closed.displayedCategoryKey).toBe("movie:10");
  expect(closed.selectedItemIndex).toBe(8);
});

test("Back closes information before leaving details", () => {
  const origin: VodOrigin = {
    mode: "movie",
    surface: "category",
    categoryKey: "movie:all",
    itemKey: "movie:1",
    itemIndex: 0,
    firstRow: 0,
  };
  let state = reduceVodNavigation(
    root(),
    { type: "details-open", itemKey: "movie:1", origin },
    context(),
  );
  state = reduceVodNavigation(state, { type: "drawer", open: true }, context());
  const closed = key(state, KEY.BACK);
  assert.equal(closed.details?.drawerOpen, false);
  assert.equal(closed.details?.itemKey, "movie:1");
  assert.equal(closed.zone, "detail-actions");
});

test("Back closes the episode panel before leaving Series details", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  let state = initialVodNavigation("series");
  state = reduceVodNavigation(
    state,
    { type: "details-open", itemKey: "series:1", origin },
    context({ categoryKeys: ["series:all"], itemKeys: ["series:1"] }),
  );
  state = reduceVodNavigation(state, { type: "episodes-toggle" }, context());
  const restored = key(state, KEY.BACK, {
    categoryKeys: ["series:all"],
    itemKeys: ["series:1"],
  });
  assert.equal(restored.details?.itemKey, "series:1");
  assert.equal(restored.episodes?.open, false);
  assert.equal(restored.zone, "detail-actions");
});

test("episode directions expose seasons and summary with automatic season selection", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  let state = reduceVodNavigation(
    initialVodNavigation("series"),
    { type: "details-open", itemKey: "series:1", origin },
    context(),
  );
  const episodeContext = {
    episodeKeys: ["episode:1"],
    episodeKeysBySeason: { "1": ["episode:1"], "2": ["episode:2", "episode:3"] },
  };
  state = reduceVodNavigation(state, { type: "episodes-toggle" }, context(episodeContext));

  const secondFromList = key(state, KEY.RIGHT, episodeContext);
  assert.equal(secondFromList.zone, "episode-list");
  assert.equal(secondFromList.episodes?.selectedSeason, 2);
  assert.equal(secondFromList.episodes?.episodeKey, "episode:2");
  const firstFromList = key(secondFromList, KEY.LEFT, episodeContext);
  assert.equal(firstFromList.zone, "episode-list");
  assert.equal(firstFromList.episodes?.selectedSeason, 1);
  assert.equal(firstFromList.episodes?.episodeKey, "episode:1");
  const listClosed = key(firstFromList, KEY.LEFT, episodeContext);
  assert.equal(listClosed.zone, "detail-actions");
  assert.equal(listClosed.episodes?.open, false);

  const summary = reduceVodNavigation(
    state,
    { type: "episode-summary-focus" },
    context(episodeContext),
  );
  assert.equal(summary.zone, "episode-summary");
  assert.equal(key(summary, KEY.ENTER, episodeContext).zone, "episode-summary");
  assert.equal(key(summary, KEY.LEFT, episodeContext).zone, "episode-list");

  const firstSeason = key(state, KEY.UP, episodeContext);
  assert.equal(firstSeason.zone, "season-row");
  assert.equal(key(firstSeason, KEY.UP, episodeContext).zone, "season-row");
  const secondSeason = key(firstSeason, KEY.RIGHT, episodeContext);
  assert.equal(secondSeason.zone, "season-row");
  assert.equal(secondSeason.episodes?.seasonCursor, 2);
  assert.equal(secondSeason.episodes?.selectedSeason, 2);
  assert.equal(secondSeason.episodes?.episodeKey, "episode:2");
  const committedSeason = key(secondSeason, KEY.DOWN, episodeContext);
  assert.equal(committedSeason.zone, "episode-list");
  assert.equal(committedSeason.episodes?.selectedSeason, 2);
  assert.equal(committedSeason.episodes?.episodeKey, "episode:2");
  assert.equal(committedSeason.memories.series.seasonBySeries["series:1"], 2);

  const seasonClosed = key(firstSeason, KEY.LEFT, episodeContext);
  assert.equal(seasonClosed.zone, "detail-actions");
  assert.equal(seasonClosed.episodes?.open, false);
  const closed = key(firstSeason, KEY.BACK, episodeContext);
  assert.equal(closed.zone, "detail-actions");
  assert.equal(closed.episodes?.open, false);
});

test("switching through an empty season restarts the next populated season at its first episode", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  const episodeContext = {
    seasons: [1, 2],
    episodeKeysBySeason: { "1": ["episode:1", "episode:2"], "2": [] },
  };
  let state = reduceVodNavigation(
    initialVodNavigation("series"),
    { type: "details-open", itemKey: "series:1", origin },
    context(episodeContext),
  );
  state = reduceVodNavigation(state, { type: "episodes-toggle" }, context(episodeContext));
  state = reduceVodNavigation(
    state,
    { type: "episode-focus", episodeKey: "episode:2" },
    context(episodeContext),
  );
  state = reduceVodNavigation(
    state,
    { type: "season-commit", season: 2 },
    context(episodeContext),
  );
  state = reduceVodNavigation(
    state,
    { type: "season-commit", season: 1 },
    context(episodeContext),
  );

  expect(state.episodes?.selectedSeason).toBe(1);
  expect(state.episodes?.episodeKey).toBe("episode:1");
  expect(state.memories.series.episodeBySeason["series:1:1"]).toBe("episode:1");
});

test("season changes ignore a remembered deep episode and start at the first episode", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  const episodeContext = {
    seasons: [1, 2],
    episodeKeysBySeason: { "1": ["episode:1"], "2": ["episode:2", "episode:3"] },
  };
  let state = reduceVodNavigation(
    initialVodNavigation("series"),
    { type: "details-open", itemKey: "series:1", origin },
    context(episodeContext),
  );
  state = reduceVodNavigation(state, { type: "episodes-toggle" }, context(episodeContext));
  state = {
    ...state,
    memories: {
      ...state.memories,
      series: {
        ...state.memories.series,
        episodeBySeason: { "series:1:2": "episode:3" },
      },
    },
  };

  const committed = reduceVodNavigation(
    state,
    { type: "season-commit", season: 2 },
    context(episodeContext),
  );

  expect(committed.episodes?.episodeKey).toBe("episode:2");
});

test("refreshed series details reconcile stale season and episode keys", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  let state = reduceVodNavigation(
    initialVodNavigation("series"),
    { type: "details-open", itemKey: "series:1", origin },
    context({
      seasons: [1, 2],
      episodeKeysBySeason: { "1": ["episode:1"], "2": ["episode:2"] },
    }),
  );
  state = reduceVodNavigation(
    state,
    { type: "episodes-toggle" },
    context({
      seasons: [1, 2],
      initialSeason: 2,
      initialEpisodeKey: "episode:2",
      episodeKeysBySeason: { "1": ["episode:1"], "2": ["episode:2"] },
    }),
  );

  const reconciled = reduceVodNavigation(
    state,
    { type: "episodes-reconcile" },
    context({
      seasons: [1, 3],
      initialSeason: 1,
      episodeKeysBySeason: { "1": ["episode:1b"], "3": ["episode:3"] },
    }),
  );

  assert.equal(reconciled.episodes?.selectedSeason, 1);
  assert.equal(reconciled.episodes?.seasonCursor, 1);
  assert.equal(reconciled.episodes?.episodeKey, "episode:1b");
  assert.equal(reconciled.zone, "episode-list");
});

test("episode reconciliation preserves a still playable selected episode", () => {
  const origin: VodOrigin = {
    mode: "series",
    surface: "category",
    categoryKey: "series:all",
    itemKey: "series:1",
    itemIndex: 0,
    firstRow: 0,
  };
  let state = reduceVodNavigation(
    initialVodNavigation("series"),
    { type: "details-open", itemKey: "series:1", origin },
    context(),
  );
  state = reduceVodNavigation(state, { type: "episodes-toggle" }, context());
  state = reduceVodNavigation(
    state,
    { type: "episode-focus", episodeKey: "episode:2" },
    context(),
  );

  const reconciled = reduceVodNavigation(
    state,
    { type: "episodes-reconcile" },
    context({ episodeKeys: ["episode:1", "episode:2", "episode:4"] }),
  );

  assert.equal(reconciled.episodes?.episodeKey, "episode:2");
});

test("wheel ignores the search field and resets its guard after a zone change", () => {
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...context(),
      mode: "movie",
      onCategorySettled: () => undefined,
      onQuerySettled: () => undefined,
      onPosterSettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
    }),
  );
  act(() => result.current.openSearch());
  assert.equal(result.current.handleWheel(1, 0), false);
  assert.equal(result.current.state.memories.movie.itemIndex, 0);
  act(() => result.current.selectItem(0));
  act(() => result.current.handleKey(KEY.DOWN, { preventDefault() {} } as KeyboardEvent));
  assert.equal(result.current.handleWheel(1, 0), true);
  unmount();
});

test("the mounted VOD grid reaches catalogue actions with Up from its first row", () => {
  vi.useFakeTimers();
  const onAppNavigationFocus = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...context(),
      mode: "movie",
      onCategorySettled: () => undefined,
      onQuerySettled: () => undefined,
      onPosterSettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
      onAppNavigationFocus,
    }),
  );
  act(() => result.current.selectCategory(0, false));
  act(() => vi.advanceTimersByTime(150));
  act(() => result.current.selectItem(0));
  act(() => result.current.handleKey(KEY.RIGHT, { preventDefault() {} } as KeyboardEvent));
  act(() => result.current.handleKey(KEY.UP, { preventDefault() {} } as KeyboardEvent));

  assert.equal(result.current.state.zone, "catalogue-actions");
  assert.equal(result.current.state.selectedItemIndex, 0);
  expect(onAppNavigationFocus).not.toHaveBeenCalled();

  act(() => result.current.handleKey(KEY.DOWN, { preventDefault() {} } as KeyboardEvent));

  assert.equal(result.current.state.zone, "grid");
  assert.equal(result.current.state.selectedItemIndex, 0);
  expect(onAppNavigationFocus).not.toHaveBeenCalled();
  unmount();
  vi.useRealTimers();
});

test("the mounted VOD rail hands left focus to application navigation", () => {
  const onAppNavigationFocus = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...context(),
      mode: "movie",
      onCategorySettled: () => undefined,
      onQuerySettled: () => undefined,
      onPosterSettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
      onAppNavigationFocus,
    }),
  );
  act(() => result.current.selectCategory(0, false));
  act(() => result.current.handleKey(KEY.LEFT, { preventDefault() {} } as KeyboardEvent));
  assert.equal(result.current.state.zone, "rail");
  expect(onAppNavigationFocus).toHaveBeenCalledOnce();
  unmount();
});

test.each([
  ["ltr", KEY.LEFT, KEY.RIGHT],
  ["rtl", KEY.RIGHT, KEY.LEFT],
] as const)(
  "mounted %s details keep focus inside the full screen page",
  (direction, inlineStart, inlineEnd) => {
    const onAppNavigationFocus = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVodNavigation({
        ...context({ direction }),
        mode: "movie",
        onCategorySettled: () => undefined,
        onQuerySettled: () => undefined,
        onPosterSettled: () => undefined,
        onActivate: () => undefined,
        onRetry: () => undefined,
        onRequestExit: () => undefined,
        onAppNavigationFocus,
      }),
    );
    act(() => {
      result.current.openDetails("movie:1");
      result.current.focusFirstDetailAction();
    });

    for (const [actionIndex, afterEnd] of [
      [0, 0],
      [1, 2],
      [2, 2],
    ]) {
      act(() => result.current.focusDetailAction(actionIndex));
      const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;
      act(() => result.current.handleKey(inlineStart, event));
      expect(result.current.state.zone).toBe("detail-actions");
      expect(onAppNavigationFocus).not.toHaveBeenCalled();
      expect(event.preventDefault).toHaveBeenCalledOnce();
      act(() => result.current.handleKey(inlineEnd, event));
      expect(result.current.state.zone).toBe("detail-actions");
      expect(result.current.state.details?.actionIndex).toBe(afterEnd);
    }

    const event = { preventDefault: vi.fn() } as unknown as KeyboardEvent;
    act(() => result.current.handleKey(inlineStart, event));
    act(() => result.current.handleKey(inlineStart, event));
    expect(onAppNavigationFocus).not.toHaveBeenCalled();
    expect(result.current.state.zone).toBe("detail-actions");
    act(() => result.current.handleKey(inlineEnd, event));
    act(() => result.current.focusDetailAction(0));
    act(() => result.current.handleKey(KEY.UP, event));
    expect(onAppNavigationFocus).not.toHaveBeenCalled();
    expect(result.current.state.zone).toBe("detail-actions");
    unmount();
  },
);

test("loading details keep their action focus until the details become ready", () => {
  const origin: VodOrigin = {
    mode: "movie",
    surface: "category",
    categoryKey: "movie:all",
    itemKey: "movie:1",
    itemIndex: 1,
    firstRow: 0,
  };
  const loading = context({ detailActionCount: 0 });
  const opened = reduceVodNavigation(
    root(),
    { type: "details-open", itemKey: origin.itemKey, origin },
    loading,
  );
  const back = reduceVodNavigation(opened, { type: "key", code: KEY.LEFT }, loading);
  expect(back.zone).toBe("detail-actions");
  expect(reduceVodNavigation(back, { type: "key", code: KEY.RIGHT }, loading)).toBe(back);
  expect(reduceVodNavigation(back, { type: "key", code: KEY.UP }, loading)).toBe(back);
  expect(reduceVodNavigation(back, { type: "key", code: KEY.DOWN }, loading)).toBe(back);
  const ready = reduceVodNavigation(back, { type: "details-ready" }, context());
  expect(ready.zone).toBe("detail-actions");
  expect(ready.details?.actionIndex).toBe(0);
  const reopened = reduceVodNavigation(
    ready,
    { type: "details-open", itemKey: "movie:2", origin },
    context(),
  );
  expect(reopened.zone).toBe("detail-actions");
  expect(reopened.details?.actionIndex).toBe(0);
  expect(key(opened, KEY.BACK).details).toBeNull();
});

test("the detail drawer owns input until physical Back closes it", () => {
  const origin: VodOrigin = {
    mode: "movie",
    surface: "category",
    categoryKey: "movie:all",
    itemKey: "movie:1",
    itemIndex: 1,
    firstRow: 0,
  };
  const opened = reduceVodNavigation(
    root(),
    { type: "details-open", itemKey: origin.itemKey, origin },
    context(),
  );
  const drawer = reduceVodNavigation(opened, { type: "drawer", open: true }, context());
  expect(key(drawer, KEY.LEFT)).toBe(drawer);
  const closed = key(drawer, KEY.BACK);
  expect(closed.details?.drawerOpen).toBe(false);
  expect(closed.details?.itemKey).toBe(origin.itemKey);
  expect(closed.zone).toBe("detail-actions");
  expect(key(closed, KEY.LEFT)).toBe(closed);
});

test("detail Retry stays inside the page until physical Back restores its origin", () => {
  const origin: VodOrigin = {
    mode: "movie",
    surface: "category",
    categoryKey: "movie:all",
    itemKey: "movie:1",
    itemIndex: 1,
    firstRow: 0,
  };
  const opened = reduceVodNavigation(
    root(),
    { type: "details-open", itemKey: origin.itemKey, origin },
    context(),
  );
  const retry = reduceVodNavigation(opened, { type: "retry-focus" }, context());
  expect(key(retry, KEY.LEFT)).toBe(retry);
  expect(key(retry, KEY.RIGHT, { detailRetryAvailable: true })).toBe(retry);
  expect(key(retry, KEY.BACK).details).toBeNull();
  expect(key({ ...root(), zone: "retry" }, KEY.LEFT).zone).toBe("rail");
  const search = reduceVodNavigation(root(), { type: "search-open" }, context());
  expect(key({ ...search, zone: "retry" }, KEY.LEFT).zone).toBe("retry");
});

test.each([
  ["ltr", KEY.LEFT],
  ["rtl", KEY.RIGHT],
] as const)(
  "search feedback hands its %s leading edge to the application menu",
  (direction, inlineStart) => {
    const onAppNavigationFocus = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVodNavigation({
        ...context({ direction, searchRegionState: "failed" }),
        mode: "movie",
        onCategorySettled: () => undefined,
        onQuerySettled: () => undefined,
        onPosterSettled: () => undefined,
        onActivate: () => undefined,
        onRetry: () => undefined,
        onRequestExit: () => undefined,
        onAppNavigationFocus,
      }),
    );
    act(() => result.current.openSearch());
    act(() => result.current.setQuery("Film"));
    act(() => result.current.submitQuery());
    act(() => result.current.focusRetry());
    act(() => result.current.handleKey(inlineStart, { preventDefault() {} } as KeyboardEvent));
    expect(onAppNavigationFocus).toHaveBeenCalledOnce();
    expect(result.current.state.zone).toBe("retry");
    expect(result.current.state.search?.applied).toBe("Film");
    unmount();
  },
);

test("long detail information scrolls before Down returns to playback actions", () => {
  const onInfoScroll = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...context({ detailInfoOverflow: true }),
      mode: "movie",
      onCategorySettled: () => undefined,
      onQuerySettled: () => undefined,
      onPosterSettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
      onInfoScroll,
    }),
  );
  act(() => result.current.selectCategory(0, false));
  act(() => result.current.openDetails("movie:1"));
  act(() => result.current.focusFirstDetailAction());
  const press = (code: number) =>
    act(() => result.current.handleKey(code, { preventDefault() {} } as KeyboardEvent));
  press(KEY.UP);
  expect(result.current.state.zone).toBe("detail-copy");
  press(KEY.DOWN);
  expect(result.current.state.zone).toBe("detail-copy");
  press(KEY.DOWN);
  expect(result.current.state.zone).toBe("detail-actions");
  expect(result.current.state.details?.actionIndex).toBe(0);
  unmount();
});

test.each(["season-row", "episode-list", "episode-summary"] as const)(
  "physical Back closes %s while retaining the selected season and episode",
  (zone) => {
    const origin: VodOrigin = {
      mode: "series",
      surface: "category",
      categoryKey: "series:all",
      itemKey: "series:1",
      itemIndex: 0,
      firstRow: 0,
    };
    let state = reduceVodNavigation(
      initialVodNavigation("series"),
      { type: "details-open", itemKey: origin.itemKey, origin },
      context(),
    );
    state = reduceVodNavigation(state, { type: "detail-action-focus", index: 2 }, context());
    state = reduceVodNavigation(state, { type: "episodes-toggle" }, context());
    state = reduceVodNavigation(state, { type: "season-commit", season: 2 }, context());
    state = reduceVodNavigation(
      state,
      { type: "episode-focus", episodeKey: "episode:3" },
      context(),
    );
    state = { ...state, zone };
    const closed = key(state, KEY.BACK);
    expect(closed.zone).toBe("detail-actions");
    expect(closed.episodes?.open).toBe(false);
    expect(closed.episodes?.episodeKey).toBe(state.episodes?.episodeKey);
    expect(closed.episodes?.selectedSeason).toBe(state.episodes?.selectedSeason);
  },
);

test.each(["category", "search"] as const)(
  "physical Back from details restores the exact %s origin",
  (surface) => {
    const origin: VodOrigin = {
      mode: "movie",
      surface,
      categoryKey: "movie:20",
      itemKey: surface === "search" ? "movie:3" : "movie:14",
      itemIndex: surface === "search" ? 1 : 14,
      firstRow: 2,
      ...(surface === "search" ? { query: "Film" } : {}),
    };
    const opened = reduceVodNavigation(
      root(),
      { type: "details-open", itemKey: origin.itemKey, origin },
      context(),
    );
    const restored = key(opened, KEY.BACK);
    expect(restored.details).toBeNull();
    expect(restored.zone).toBe(surface === "search" ? "search-grid" : "grid");
    expect(restored.displayedCategoryKey).toBe(origin.categoryKey);
    if (surface === "search") {
      expect(restored.search?.query).toBe(origin.query);
      expect(restored.search?.applied).toBe(origin.query);
      expect(restored.search?.itemKey).toBe(origin.itemKey);
      expect(restored.search?.itemIndex).toBe(origin.itemIndex);
      expect(restored.search?.firstRow).toBe(origin.firstRow);
    } else {
      expect(restored.selectedItemKey).toBe(origin.itemKey);
      expect(restored.selectedItemIndex).toBe(origin.itemIndex);
      expect(restored.memories.movie.firstRow).toBe(origin.firstRow);
    }
  },
);

test("category and poster work settle at 150ms then 120ms", () => {
  vi.useFakeTimers();
  const categorySettled = vi.fn();
  const postersSettled = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...context(),
      mode: "movie",
      onCategorySettled: categorySettled,
      onQuerySettled: () => undefined,
      onPosterSettled: postersSettled,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
    }),
  );

  act(() => result.current.selectCategory(1));
  act(() => vi.advanceTimersByTime(149));
  assert.equal(result.current.state.selectedCategoryKey, "movie:10");
  assert.equal(result.current.state.displayedCategoryKey, "");
  assert.equal(categorySettled.mock.calls.length, 0);

  act(() => vi.advanceTimersByTime(1));
  assert.equal(categorySettled.mock.calls.length, 1);
  assert.equal(result.current.posterFetchReady, false);
  act(() => vi.advanceTimersByTime(119));
  assert.equal(postersSettled.mock.calls.length, 0);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(postersSettled.mock.calls.length, 1);
  assert.equal(result.current.posterFetchReady, true);
  unmount();
  vi.useRealTimers();
});

test("initial mount arms poster readiness at 120ms without any interaction", () => {
  vi.useFakeTimers();
  for (const mode of ["movie", "series"] as const) {
    const postersSettled = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVodNavigation({
        ...context(),
        mode,
        onCategorySettled: () => undefined,
        onQuerySettled: () => undefined,
        onPosterSettled: postersSettled,
        onActivate: () => undefined,
        onRetry: () => undefined,
        onRequestExit: () => undefined,
      }),
    );
    assert.equal(result.current.posterFetchReady, false);
    act(() => vi.advanceTimersByTime(119));
    assert.equal(result.current.posterFetchReady, false);
    assert.equal(postersSettled.mock.calls.length, 0);
    act(() => vi.advanceTimersByTime(1));
    assert.equal(result.current.posterFetchReady, true);
    assert.equal(postersSettled.mock.calls.length, 1);
    unmount();
  }
  vi.useRealTimers();
});

test("a mode switch relocks poster readiness and cannot borrow the old gate", () => {
  vi.useFakeTimers();
  const postersSettled = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ mode }: { mode: "movie" | "series" }) =>
      useVodNavigation({
        ...context(),
        mode,
        onCategorySettled: () => undefined,
        onQuerySettled: () => undefined,
        onPosterSettled: postersSettled,
        onActivate: () => undefined,
        onRetry: () => undefined,
        onRequestExit: () => undefined,
      }),
    { initialProps: { mode: "movie" } },
  );

  act(() => vi.advanceTimersByTime(120));
  assert.equal(result.current.posterFetchReady, true);

  rerender({ mode: "series" });
  assert.equal(result.current.posterFetchReady, false);
  act(() => result.current.selectItem(7));
  act(() => vi.advanceTimersByTime(119));
  assert.equal(result.current.posterFetchReady, false);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(result.current.posterFetchReady, true);
  assert.equal(postersSettled.mock.calls.length, 2);

  rerender({ mode: "movie" });
  act(() => vi.advanceTimersByTime(119));
  rerender({ mode: "series" });
  act(() => vi.advanceTimersByTime(119));
  assert.equal(postersSettled.mock.calls.length, 2);
  act(() => vi.advanceTimersByTime(1));
  assert.equal(postersSettled.mock.calls.length, 3);
  assert.equal(result.current.posterFetchReady, true);

  rerender({ mode: "movie" });
  unmount();
  act(() => vi.advanceTimersByTime(300));
  assert.equal(postersSettled.mock.calls.length, 3);
  vi.useRealTimers();
});

const detailTransitionOptions = (
  onDetailsTransition?: VodNavigationOptions["onDetailsTransition"],
): VodNavigationOptions => ({
  ...context(),
  mode: "movie",
  onCategorySettled: () => undefined,
  onQuerySettled: () => undefined,
  onPosterSettled: () => undefined,
  onActivate: () => undefined,
  onRetry: () => undefined,
  onRequestExit: () => undefined,
  ...(onDetailsTransition ? { onDetailsTransition } : {}),
});

test("VOD typing keeps the submitted query until Search is activated and preserves both across details", () => {
  vi.useFakeTimers();
  const submitted = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...detailTransitionOptions(),
      onQuerySettled: submitted,
    }),
  );
  try {
    act(() => result.current.openSearch());
    act(() => result.current.setQuery("Film"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.state.search?.applied).toBe("");
    expect(submitted).not.toHaveBeenCalled();
    act(() => result.current.submitQuery());
    expect(result.current.state.search?.applied).toBe("Film");
    expect(result.current.state.zone).toBe("search-submit");
    expect(submitted).toHaveBeenCalledTimes(1);
    act(() => result.current.setQuery("Unsubmitted"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.state.search?.applied).toBe("Film");
    expect(submitted).toHaveBeenCalledTimes(1);
    act(() => result.current.selectItem(0));
    act(() => result.current.openDetails("movie:9"));
    expect(result.current.state.details?.origin.query).toBe("Unsubmitted");
    expect(result.current.state.details?.origin.appliedQuery).toBe("Film");
    act(() => result.current.handleKey(KEY.BACK, { preventDefault() {} } as KeyboardEvent));
    expect(result.current.state.search?.query).toBe("Unsubmitted");
    expect(result.current.state.search?.applied).toBe("Film");
    expect(submitted).toHaveBeenCalledTimes(1);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

test("pointer selection preserves a partially visible poster window", () => {
  const previousMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "pointer";
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...detailTransitionOptions(),
      itemKeys: Array.from({ length: 60 }, (_, index) => `movie:${index}`),
      posterColumns: 6,
    }),
  );
  try {
    act(() => result.current.rememberWindow(1, false, 2));
    act(() => result.current.selectItem(18));
    expect(result.current.state.selectedItemIndex).toBe(18);
    expect(result.current.state.memories.movie.firstRow).toBe(1);
  } finally {
    unmount();
    if (previousMode === undefined) delete document.documentElement.dataset.inputMode;
    else document.documentElement.dataset.inputMode = previousMode;
  }
});

test("rememberWindow replaces measured capacity after a resize without bookkeeping renders", () => {
  vi.useFakeTimers();
  let renders = 0;
  const { result, unmount } = renderHook(() => {
    renders += 1;
    return useVodNavigation({
      ...detailTransitionOptions(),
      itemKeys: Array.from({ length: 60 }, (_, index) => `movie:${index}`),
      posterColumns: 6,
    });
  });
  const press = (code: number) =>
    result.current.handleKey(code, { preventDefault() {} } as KeyboardEvent);
  try {
    act(() =>
      result.current.restoreOrigin({
        mode: "movie",
        surface: "category",
        categoryKey: "movie:all",
        itemKey: "movie:0",
        itemIndex: 0,
        firstRow: 0,
      }),
    );
    act(() => result.current.rememberWindow(0));
    const beforeMeasurement = result.current.state;
    const beforeMeasurementRenders = renders;
    act(() => result.current.rememberWindow(0, false, 2));
    expect(result.current.state).toBe(beforeMeasurement);
    expect(renders).toBe(beforeMeasurementRenders);

    act(() => press(KEY.DOWN));
    expect(result.current.state.selectedItemIndex).toBe(6);
    expect(result.current.state.memories.movie.firstRow).toBe(0);
    act(() => press(KEY.DOWN));
    expect(result.current.state.selectedItemIndex).toBe(12);
    expect(result.current.state.memories.movie.firstRow).toBe(1);

    const beforeResizeRenders = renders;
    act(() => result.current.rememberWindow(1, false, 3));
    expect(renders).toBe(beforeResizeRenders);
    for (const invalid of [undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      act(() => result.current.rememberWindow(1, false, invalid));
    }
    expect(renders).toBe(beforeResizeRenders);
    act(() => press(KEY.DOWN));
    expect(result.current.state.selectedItemIndex).toBe(18);
    expect(result.current.state.memories.movie.firstRow).toBe(1);
    act(() => press(KEY.DOWN));
    expect(result.current.state.selectedItemIndex).toBe(24);
    expect(result.current.state.memories.movie.firstRow).toBe(2);

    act(() => result.current.rememberWindow(3, false, 2));
    act(() => press(KEY.DOWN));
    expect(result.current.state.selectedItemIndex).toBe(30);
    expect(result.current.state.memories.movie.firstRow).toBe(4);
    const beforeBookkeepingRenders = renders;
    act(() => result.current.rememberWindow(4, false, 2));
    expect(renders).toBe(beforeBookkeepingRenders);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

test("measured search capacity stays independent and Back restores category window memory", () => {
  vi.useFakeTimers();
  const items = Array.from({ length: 60 }, (_, index) => `movie:${index}`);
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...detailTransitionOptions(),
      itemKeys: items,
      searchItemKeys: items,
      posterColumns: 6,
    }),
  );
  const press = (code: number) =>
    result.current.handleKey(code, { preventDefault() {} } as KeyboardEvent);
  try {
    act(() =>
      result.current.restoreOrigin({
        mode: "movie",
        surface: "category",
        categoryKey: "movie:all",
        itemKey: "movie:18",
        itemIndex: 18,
        firstRow: 2,
      }),
    );
    act(() => result.current.rememberWindow(2, false, 2));
    const categoryMemory = result.current.state.memories.movie;
    act(() => result.current.openSearch());
    act(() => result.current.setQuery("Film"));
    act(() => result.current.submitQuery());
    act(() => press(KEY.DOWN));
    act(() => result.current.rememberWindow(0, true, 3));
    act(() => result.current.selectItem(18));
    expect(result.current.state.search?.itemIndex).toBe(18);
    expect(result.current.state.search?.firstRow).toBe(1);
    expect(result.current.state.memories.movie).toBe(categoryMemory);
    act(() => press(KEY.DOWN));
    expect(result.current.state.search?.itemIndex).toBe(24);
    expect(result.current.state.search?.firstRow).toBe(2);
    act(() => press(KEY.UP));
    act(() => press(KEY.UP));
    act(() => press(KEY.UP));
    expect(result.current.state.search?.itemIndex).toBe(6);
    expect(result.current.state.search?.firstRow).toBe(1);

    act(() => press(KEY.BACK));
    expect(result.current.state.search).toBeNull();
    expect(result.current.state.selectedItemIndex).toBe(18);
    expect(result.current.state.memories.movie.firstRow).toBe(2);
    expect(result.current.state.memories.movie.firstRowByCategory["movie:all"]).toBe(2);
    act(() => result.current.selectItem(24));
    expect(result.current.state.memories.movie.firstRow).toBe(3);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

test.each(["movie", "series"] as const)(
  "%s different category selections start at the first grid item",
  (mode) => {
    vi.useFakeTimers();
    for (const input of ["pointer", "keyboard"] as const) {
      const firstCategory = `${mode}:all`;
      const secondCategory = `${mode}:10`;
      const firstItems = Array.from({ length: 20 }, (_, index) => `${mode}:a${index}`);
      const secondItems = Array.from({ length: 20 }, (_, index) => `${mode}:b${index}`);
      const { result, unmount } = renderHook(() =>
        useVodNavigation({
          ...detailTransitionOptions(),
          ...context({
            categoryKeys: [firstCategory, secondCategory],
            itemKeys: firstItems,
            itemKeysByCategory: {
              [firstCategory]: firstItems,
              [secondCategory]: secondItems,
            },
          }),
          mode,
        }),
      );
      const select = (index: number) => {
        result.current.focusCategory(index);
        if (input === "pointer") result.current.selectCategory(index);
        else result.current.handleKey(KEY.ENTER, { preventDefault() {} } as KeyboardEvent);
      };
      act(() => select(0));
      act(() => vi.advanceTimersByTime(150));
      expect(result.current.state.zone).toBe("grid");
      expect(result.current.state.selectedItemKey).toBe(firstItems[0]);
      act(() => result.current.selectItem(6));
      act(() => result.current.rememberWindow(1));
      act(() => result.current.focusCatalogueAction(0));

      act(() => select(1));
      act(() => vi.advanceTimersByTime(150));
      expect(result.current.state.zone).toBe("grid");
      expect(result.current.state.selectedItemIndex).toBe(0);
      expect(result.current.state.selectedItemKey).toBe(secondItems[0]);
      expect(result.current.state.memories[mode].firstRow).toBe(0);
      act(() => result.current.selectItem(7));
      act(() => result.current.rememberWindow(1));

      act(() => select(0));
      act(() => vi.advanceTimersByTime(150));
      expect(result.current.state.zone).toBe("grid");
      expect(result.current.state.selectedItemIndex).toBe(0);
      expect(result.current.state.selectedItemKey).toBe(firstItems[0]);
      expect(result.current.state.memories[mode].firstRow).toBe(0);
      unmount();
    }
    vi.useRealTimers();
  },
);

test.each(["movie", "series"] as const)(
  "%s active category restores the last grid or Sort focus without reloading",
  (mode) => {
    vi.useFakeTimers();
    for (const target of ["grid", "catalogue-actions"] as const) {
      for (const input of ["pointer", "keyboard"] as const) {
        const settled = vi.fn();
        const { result, unmount } = renderHook(() =>
          useVodNavigation({
            ...detailTransitionOptions(),
            ...context({
              categoryKeys: [`${mode}:all`, `${mode}:10`, `${mode}:20`],
              itemKeys: Array.from({ length: 20 }, (_, index) => `${mode}:${index}`),
            }),
            mode,
            onCategorySettled: settled,
          }),
        );
        const enter = (code: number) =>
          result.current.handleKey(code, {
            preventDefault() {},
            repeat: false,
          } as KeyboardEvent);
        act(() => result.current.selectCategory(0, false));
        act(() => vi.advanceTimersByTime(150));
        act(() => enter(KEY.RIGHT));
        act(() => result.current.selectItem(6));
        act(() => result.current.rememberWindow(1));
        if (target === "catalogue-actions") act(() => result.current.focusCatalogueAction(0));
        act(() => result.current.focusCategory(0));
        const loads = settled.mock.calls.length;
        if (input === "pointer") act(() => result.current.selectCategory(0));
        else act(() => enter(KEY.ENTER));
        expect(result.current.state.zone).toBe(target);
        expect(result.current.state.selectedItemIndex).toBe(6);
        expect(result.current.state.selectedItemKey).toBe(`${mode}:6`);
        expect(result.current.state.memories[mode].firstRow).toBe(1);
        act(() => vi.advanceTimersByTime(300));
        expect(settled).toHaveBeenCalledTimes(loads);
        unmount();
      }
    }
    vi.useRealTimers();
  },
);

test("reentering the displayed category cancels a pending category change and resumes artwork", () => {
  vi.useFakeTimers();
  const settled = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVodNavigation({
      ...detailTransitionOptions(),
      onCategorySettled: settled,
    }),
  );
  act(() => result.current.selectCategory(0, false));
  act(() => vi.advanceTimersByTime(270));
  act(() => result.current.handleKey(KEY.RIGHT, { preventDefault() {} } as KeyboardEvent));
  act(() => result.current.selectItem(6));
  act(() => result.current.selectCategory(1));
  act(() => result.current.selectCategory(0));
  expect(result.current.state.zone).toBe("grid");
  expect(result.current.state.selectedItemKey).toBe("movie:6");
  act(() => vi.advanceTimersByTime(300));
  expect(result.current.state.displayedCategoryKey).toBe("movie:all");
  expect(result.current.posterFetchReady).toBe(true);
  expect(settled).toHaveBeenCalledTimes(1);
  unmount();
  vi.useRealTimers();
});

test("arrow navigation back to the displayed category remains on the rail", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useVodNavigation(detailTransitionOptions()));
  act(() => result.current.selectCategory(0, false));
  act(() => vi.advanceTimersByTime(150));
  act(() => result.current.handleKey(KEY.DOWN, { preventDefault() {} } as KeyboardEvent));
  act(() => result.current.handleKey(KEY.UP, { preventDefault() {} } as KeyboardEvent));
  expect(result.current.state.selectedCategoryKey).toBe("movie:all");
  expect(result.current.state.zone).toBe("rail");
  act(() => vi.advanceTimersByTime(300));
  expect(result.current.state.displayedCategoryKey).toBe("movie:all");
  unmount();
  vi.useRealTimers();
});

test.each(refreshedCategoryCases)(
  "%s categories preserve mounted rail movement and Enter with stale memory",
  (_label, categoryKeys, up, down, upZone, downZone) => {
    const keys: readonly string[] = categoryKeys;
    vi.useFakeTimers();
    try {
      for (const [code, expected] of [
        [KEY.UP, up],
        [KEY.DOWN, down],
        [KEY.ENTER, "movie:20"],
      ] as const) {
        const settled = vi.fn();
        const { result, rerender, unmount } = renderHook(
          ({ categoryKeys }: { categoryKeys: readonly string[] }) =>
            useVodNavigation({
              ...detailTransitionOptions(),
              categoryKeys,
              onCategorySettled: settled,
            }),
          { initialProps: { categoryKeys: context().categoryKeys } },
        );
        try {
          act(() => result.current.focusCategory(2));
          rerender({ categoryKeys: keys });
          const before = result.current.state;
          act(() => result.current.handleKey(code, { preventDefault() {} } as KeyboardEvent));
          expect(result.current.state.selectedCategoryKey).toBe(expected);
          if (code !== KEY.ENTER) {
            expect(result.current.state.zone).toBe(code === KEY.UP ? upZone : downZone);
          }
          if (result.current.state.zone === "rail-search") {
            expect(settled).not.toHaveBeenCalled();
            continue;
          }
          if (code === KEY.ENTER && !keys.includes("movie:20")) {
            expect(result.current.state).toBe(before);
            act(() => vi.advanceTimersByTime(150));
            expect(settled).not.toHaveBeenCalled();
          } else if (keys.length) {
            expect(result.current.state.memories.movie.railIndex).toBe(keys.indexOf(expected));
            act(() => vi.advanceTimersByTime(150));
            expect(result.current.state.displayedCategoryKey).toBe(expected);
            expect(settled).toHaveBeenCalledTimes(1);
            expect(settled).toHaveBeenCalledWith(expected);
          } else {
            expect(result.current.state).toBe(before);
          }
        } finally {
          unmount();
        }
      }
    } finally {
      vi.useRealTimers();
    }
  },
);

test.each(["movie", "series"] as const)(
  "%s root Return requests Exit without changing the catalogue cursor",
  (mode) => {
    vi.useFakeTimers();
    const onRequestExit = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVodNavigation({
        ...detailTransitionOptions(),
        ...context({
          categoryKeys: [`${mode}:all`],
          itemKeys: [`${mode}:1`],
        }),
        mode,
        onRequestExit,
      }),
    );
    try {
      for (const focus of [
        () => result.current.focusCategory(0),
        () => result.current.selectItem(0),
      ]) {
        act(focus);
        const before = result.current.state;
        for (const code of [KEY.BACK, KEY.ESC]) {
          const event = new KeyboardEvent("keydown", { cancelable: true });
          act(() => result.current.handleKey(code, event));
          expect(event.defaultPrevented).toBe(true);
          expect(result.current.state).toBe(before);
        }
      }
      expect(onRequestExit).toHaveBeenCalledTimes(4);
    } finally {
      unmount();
      vi.useRealTimers();
    }
  },
);

test("details entry defers through onDetailsTransition and commits once", () => {
  vi.useFakeTimers();
  const pending: Array<() => void> = [];
  const flags: boolean[] = [];
  const { result, unmount } = renderHook(() =>
    useVodNavigation(
      detailTransitionOptions((commit, returning) => {
        flags.push(returning);
        if (returning) commit();
        else pending.push(commit);
      }),
    ),
  );
  act(() => result.current.selectCategory(0));
  act(() => vi.advanceTimersByTime(150));
  act(() => result.current.selectItem(0));
  const zoneBefore = result.current.state.zone;

  act(() => result.current.openDetails("movie:3"));
  expect(result.current.state.details).toBeNull();
  expect(result.current.state.zone).toBe(zoneBefore);
  expect(pending).toHaveLength(1);
  expect(flags).toEqual([false]);

  act(() => pending[0]());
  expect(result.current.state.details?.itemKey).toBe("movie:3");
  expect(result.current.state.zone).toBe("detail-actions");

  unmount();
  vi.useRealTimers();
});

test.each(["grid", "search"] as const)(
  "leaving details immediately restores the exact %s origin",
  (origin) => {
    vi.useFakeTimers();
    const pending: Array<() => void> = [];
    const flags: boolean[] = [];
    const { result, unmount } = renderHook(() =>
      useVodNavigation(
        detailTransitionOptions((commit, returning) => {
          flags.push(returning);
          if (returning) commit();
          else pending.push(commit);
        }),
      ),
    );
    act(() => result.current.selectCategory(0));
    act(() => vi.advanceTimersByTime(150));
    act(() => result.current.selectItem(0));
    if (origin === "search") {
      act(() => result.current.openSearch());
      act(() => result.current.setQuery("alpha"));
      act(() => result.current.submitQuery());
    }
    act(() => result.current.selectItem(origin === "search" ? 1 : 7));
    act(() => result.current.rememberWindow(1, origin === "search"));
    const before = result.current.state;
    act(() => result.current.openDetails("movie:3"));
    act(() => pending[0]());
    expect(result.current.state.details).toBeTruthy();

    act(() => result.current.handleKey(KEY.BACK, { preventDefault() {} } as KeyboardEvent));
    expect(result.current.state.details).toBeNull();
    expect(result.current.state.zone).toBe(origin === "search" ? "search-grid" : "grid");
    expect(result.current.state.selectedCategoryKey).toBe(before.selectedCategoryKey);
    expect(result.current.state.displayedCategoryKey).toBe(before.displayedCategoryKey);
    expect(result.current.state.selectedItemIndex).toBe(
      origin === "search" ? before.search?.itemIndex : before.selectedItemIndex,
    );
    expect(result.current.state.selectedItemKey).toBe(
      origin === "search" ? before.search?.itemKey : before.selectedItemKey,
    );
    if (origin === "search") {
      expect(result.current.state.search).toMatchObject({
        query: "alpha",
        applied: "alpha",
        itemKey: before.search?.itemKey,
        itemIndex: before.search?.itemIndex,
        firstRow: 1,
        keyboardOpen: false,
      });
    } else expect(result.current.state.memories.movie.firstRow).toBe(1);
    expect(pending).toHaveLength(1);
    expect(flags).toEqual([false, true]);

    unmount();
    vi.useRealTimers();
  },
);

test("grid, search and drawer actions never consult the details transition", () => {
  vi.useFakeTimers();
  const gate = vi.fn();
  const { result, unmount } = renderHook(() => useVodNavigation(detailTransitionOptions(gate)));
  act(() => result.current.selectCategory(0));
  act(() => vi.advanceTimersByTime(150));
  act(() => result.current.selectItem(0));
  act(() => result.current.selectItem(4));
  act(() => result.current.openSearch());
  act(() => result.current.setQuery("alpha"));
  act(() => result.current.submitQuery());
  act(() => result.current.closeSearch());
  expect(gate).not.toHaveBeenCalled();
  expect(result.current.state.details).toBeNull();

  act(() => result.current.openDetails("movie:3"));
  expect(gate).toHaveBeenCalledTimes(1);
  const commit = gate.mock.calls[0]?.[0] as (() => void) | undefined;
  expect(commit).toBeTruthy();
  act(() => commit!());
  expect(result.current.state.details).toBeTruthy();

  act(() => result.current.setDrawerOpen(true));
  expect(result.current.state.details?.drawerOpen).toBe(true);
  expect(gate).toHaveBeenCalledTimes(1);

  unmount();
  vi.useRealTimers();
});

test("an owner change cancels a pending details commit through the shared transition", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  const { result, rerender, unmount } = renderHook(
    ({ owner }: { owner: string }) => {
      const transition = useContentTransition(owner);
      const navigation = useVodNavigation({
        ...detailTransitionOptions(),
        onDetailsTransition: (commit, returning) => {
          if (returning) transition.navigateNow(commit);
          else transition.navigate(commit);
        },
      });
      return { navigation, transition };
    },
    { initialProps: { owner: "pl-1:v1" } },
  );
  act(() => result.current.navigation.selectCategory(0));
  act(() => vi.advanceTimersByTime(150));
  act(() => result.current.navigation.openDetails("movie:3"));
  expect(result.current.navigation.state.details).toBeNull();
  expect(result.current.transition.phase).toBe("leaving");

  rerender({ owner: "pl-2:v1" });
  expect(result.current.transition.phase).toBe("idle");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(result.current.navigation.state.details).toBeNull();

  unmount();
  document.documentElement.style.removeProperty("--t-navigation");
  vi.useRealTimers();
});
