import { useLayoutEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VodCategoryRail } from "../src/components/vod/VodCategoryRail";
import { KEY } from "../src/hooks/useRemote";
import {
  initialVodNavigation,
  reduceVodNavigation,
  useVodNavigation,
  type VodNavigation,
  type VodNavigationContext,
  type VodNavigationState,
} from "../src/hooks/useVodNavigation";
import * as viewport from "../src/hooks/useViewport";
import { RAIL_ROW_BASE } from "../src/hooks/useWindowed";

const categories = Array.from({ length: 30 }, (_, index) => ({
  key: `category:${index}`,
  name: `Category ${index}`,
  source: "provider" as const,
}));

const context: VodNavigationContext = {
  direction: "ltr",
  headerKeys: ["live", "movie", "series", "search", "settings"],
  categoryKeys: categories.map((category) => category.key),
  itemKeys: ["movie:0"],
  searchItemKeys: [],
  seasons: [],
  episodeKeys: [],
  detailActionCount: 0,
  detailRetryAvailable: false,
  regionState: "loaded",
};

let previousInputMode: string | undefined;

beforeEach(() => {
  previousInputMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "remote";
  vi.useFakeTimers();
  vi.spyOn(viewport, "useViewport").mockReturnValue(840);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (previousInputMode === undefined) delete document.documentElement.dataset.inputMode;
  else document.documentElement.dataset.inputMode = previousInputMode;
});

function mountRail(initialMode: "movie" | "series" = "movie", initialScale = 1) {
  let current: VodNavigation | undefined;
  const states: VodNavigationState[] = [];
  const onCategorySettled = vi.fn();
  const onPosterSettled = vi.fn();
  function Fixture({ mode, scale }: { mode: "movie" | "series"; scale: number }) {
    const navigation = useVodNavigation({
      ...context,
      mode,
      onCategorySettled,
      onPosterSettled,
      onQuerySettled: () => undefined,
      onActivate: () => undefined,
      onRetry: () => undefined,
      onRequestExit: () => undefined,
    });
    current = navigation;
    useLayoutEffect(() => {
      states.push(navigation.state);
    }, [navigation.state]);
    const memory = navigation.state.memories[mode];
    return (
      <VodCategoryRail
        items={categories}
        cursor={memory.railIndex}
        selectedKey={navigation.state.selectedCategoryKey}
        focused
        scale={scale}
        firstRow={memory.categoryFirst}
        scrollOffset={memory.categoryScrollOffset}
        reportWindowMetrics
        onFocus={navigation.focusCategory}
        onSelect={navigation.selectCategory}
        onWindowChange={navigation.rememberCategoryWindow}
      />
    );
  }
  const view = render(<Fixture mode={initialMode} scale={initialScale} />);
  return {
    get navigation() {
      if (!current) throw new Error("The category rail has not mounted.");
      return current;
    },
    states,
    onCategorySettled,
    onPosterSettled,
    rerender: (mode = initialMode, scale = initialScale) =>
      view.rerender(<Fixture mode={mode} scale={scale} />),
  };
}

test.each([
  [1, 840, 10],
  [1.25, 840, 8],
  [1, 420, 5],
])(
  "remote category movement saves one state per press at scale %s and height %s",
  (scale, height, visible) => {
    vi.mocked(viewport.useViewport).mockReturnValue(height);
    const rail = mountRail("movie", scale);
    const row = RAIL_ROW_BASE * scale;
    for (const [index, first] of [
      [0, 0],
      [visible - 1, 0],
      [visible, 1],
      [visible + 1, 2],
      [visible, 2],
      [1, 1],
      [0, 0],
      [29, 30 - visible],
      [0, 0],
    ]) {
      rail.states.length = 0;
      act(() => rail.navigation.focusCategory(index));
      expect(rail.states).toHaveLength(1);
      expect(rail.states[0].memories.movie).toMatchObject({
        railIndex: index,
        categoryFirst: first,
        categoryScrollOffset: first * row,
      });
      expect(rail.navigation.state.selectedCategoryKey).toBe(`category:${index}`);
      expect(rail.navigation.state.displayedCategoryKey).toBe("");
    }
  },
);

test("a category boundary press keeps the category and artwork settle timers", () => {
  const rail = mountRail();
  act(() => rail.navigation.selectCategory(9, false));
  rail.states.length = 0;
  act(() => rail.navigation.handleKey(KEY.DOWN, { preventDefault() {} } as KeyboardEvent));
  expect(rail.states).toHaveLength(1);
  expect(rail.states[0].memories.movie.categoryFirst).toBe(1);
  expect(rail.navigation.state.selectedCategoryKey).toBe("category:10");
  expect(rail.navigation.state.displayedCategoryKey).toBe("");
  act(() => vi.advanceTimersByTime(149));
  expect(rail.onCategorySettled).not.toHaveBeenCalled();
  expect(rail.onPosterSettled).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(rail.onCategorySettled).toHaveBeenCalledOnce();
  expect(rail.onCategorySettled).toHaveBeenLastCalledWith("category:10");
  expect(rail.navigation.state.zone).toBe("rail");
  expect(rail.navigation.state.displayedCategoryKey).toBe("category:10");
  act(() => vi.advanceTimersByTime(119));
  expect(rail.onPosterSettled).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(rail.onPosterSettled).toHaveBeenCalledOnce();
});

test("hovering a partially visible category preserves its fractional pointer window", () => {
  const rail = mountRail();
  act(() => rail.navigation.focusCategory(0));
  fireEvent.wheel(screen.getByRole("navigation"), { deltaY: 37.5 });
  expect(rail.navigation.state.memories.movie.categoryScrollOffset).toBe(37.5);
  const before = document.querySelector<HTMLElement>(".vod-rail-window")!.style.transform;
  rail.states.length = 0;
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Category 10" }));
  expect(rail.states).toHaveLength(1);
  expect(rail.navigation.state.memories.movie).toMatchObject({
    railIndex: 10,
    categoryFirst: 0,
    categoryScrollOffset: 37.5,
  });
  expect(document.querySelector<HTMLElement>(".vod-rail-window")!.style.transform).toBe(before);

  fireEvent.pointerEnter(screen.getByRole("button", { name: "Category 9" }));
  document.documentElement.dataset.inputMode = "remote";
  act(() => rail.navigation.handleKey(KEY.UP, { preventDefault() {} } as KeyboardEvent));
  expect(rail.navigation.state.memories.movie).toMatchObject({
    railIndex: 8,
    categoryFirst: 1,
    categoryScrollOffset: RAIL_ROW_BASE,
  });
  rail.states.length = 0;
  act(() => rail.navigation.focusCategory(11));
  expect(rail.states).toHaveLength(1);
  expect(rail.navigation.state.memories.movie.categoryFirst).toBe(2);
});

test("wheel memory keeps partial rows independent for Movies and Series", () => {
  const rail = mountRail();
  fireEvent.wheel(screen.getByRole("navigation"), { deltaY: 355.5 });
  expect(rail.navigation.state.memories.movie).toMatchObject({
    categoryFirst: 4,
    categoryScrollOffset: 355.5,
  });
  rail.rerender("series");
  fireEvent.wheel(screen.getByRole("navigation"), { deltaY: 379.25 });
  expect(rail.navigation.state.memories.series).toMatchObject({
    categoryFirst: 4,
    categoryScrollOffset: 379.25,
  });
  rail.rerender("movie");
  expect(rail.navigation.state.memories.movie.categoryScrollOffset).toBe(355.5);
  expect(rail.navigation.state.memories.series.categoryScrollOffset).toBe(379.25);
});

test("atomic remote category windows restore independently for Movies and Series", () => {
  const rail = mountRail();
  act(() => rail.navigation.focusCategory(19));
  expect(rail.navigation.state.memories.movie.categoryFirst).toBe(10);
  rail.rerender("series");
  rail.states.length = 0;
  act(() => rail.navigation.focusCategory(14));
  expect(rail.states).toHaveLength(1);
  expect(rail.navigation.state.memories.series).toMatchObject({
    railIndex: 14,
    categoryFirst: 5,
    categoryScrollOffset: 420,
  });
  rail.rerender("movie");
  expect(rail.navigation.state.memories.movie).toMatchObject({
    railIndex: 19,
    categoryFirst: 10,
    categoryScrollOffset: 840,
  });
  expect(rail.navigation.state.memories.series.categoryFirst).toBe(5);
});

test("a new rail measurement replaces the capacity and row height before movement", () => {
  const rail = mountRail();
  act(() => rail.navigation.focusCategory(7));
  rail.rerender("movie", 1.25);
  rail.states.length = 0;
  act(() => rail.navigation.focusCategory(8));
  expect(rail.states).toHaveLength(1);
  expect(rail.states[0].memories.movie).toMatchObject({
    categoryFirst: 1,
    categoryScrollOffset: 105,
  });
});

test("unmeasured categories keep legacy bookkeeping and measured feedback is unchanged", () => {
  const initial = initialVodNavigation("movie");
  const legacy = reduceVodNavigation(initial, { type: "category-focus", index: 10 }, context);
  expect(legacy.memories.movie.categoryFirst).toBe(0);
  expect(legacy.memories.movie.categoryScrollOffset).toBeUndefined();
  const measuredContext = {
    ...context,
    categoryVisibleRows: 10,
    categoryRowHeight: RAIL_ROW_BASE,
  };
  const measured = reduceVodNavigation(
    initial,
    { type: "category-focus", index: 10 },
    measuredContext,
  );
  expect(
    reduceVodNavigation(
      measured,
      { type: "category-window", first: 1, scrollOffset: RAIL_ROW_BASE },
      measuredContext,
    ),
  ).toBe(measured);
});
