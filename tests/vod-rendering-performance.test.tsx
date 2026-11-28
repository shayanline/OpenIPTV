import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Text } from "../src/components/Text";
import { PosterGrid, type PosterGridProps } from "../src/components/vod/PosterGrid";
import {
  VodCategoryRail,
  type VodCategoryRailProps,
} from "../src/components/vod/VodCategoryRail";
import * as viewport from "../src/hooks/useViewport";

vi.mock("../src/components/Text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/components/Text")>();
  return {
    ...actual,
    Text: vi.fn((props: ComponentProps<typeof actual.Text>) =>
      createElement(actual.Text, props),
    ),
  };
});

let previousInputMode: string | undefined;

beforeEach(() => {
  previousInputMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "remote";
  vi.spyOn(viewport, "useViewport").mockReturnValue(840);
  vi.mocked(Text).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (previousInputMode === undefined) delete document.documentElement.dataset.inputMode;
  else document.documentElement.dataset.inputMode = previousInputMode;
});

function railProps(): VodCategoryRailProps {
  return {
    items: Array.from({ length: 5 }, (_, index) => ({
      key: `category:${index}`,
      name: `Category ${index}`,
      source: "provider",
    })),
    cursor: 0,
    selectedKey: "category:0",
    focused: true,
    scale: 1,
    onFocus: vi.fn(),
    onSelect: vi.fn(),
  };
}

test("category cursor movement renders only the two changed titles", () => {
  const props = railProps();
  const view = render(<VodCategoryRail {...props} />);
  const first = screen.getByRole("button", { name: "Category 0" });
  vi.mocked(Text).mockClear();
  view.rerender(<VodCategoryRail {...props} cursor={1} selectedKey="category:1" />);
  expect(vi.mocked(Text).mock.calls.map(([title]) => title.value)).toEqual([
    "Category 0",
    "Category 1",
  ]);
  expect(first.classList.contains("cursor")).toBe(false);
  expect(first.hasAttribute("aria-current")).toBe(false);
  const current = screen.getByRole("button", { name: "Category 1" });
  expect(current.classList.contains("cursor")).toBe(true);
  expect(current.getAttribute("aria-current")).toBe("true");
  vi.mocked(Text).mockClear();
  view.rerender(<VodCategoryRail {...props} cursor={1} selectedKey="category:1" />);
  expect(Text).not.toHaveBeenCalled();
});

test("category rows retain current labels and handlers when their inputs change", () => {
  const props = railProps();
  const view = render(<VodCategoryRail {...props} />);
  const onFocus = vi.fn();
  const onSelect = vi.fn();
  const items = props.items.map((item) =>
    item.key === "category:2" ? { ...item, name: "Renamed category" } : item,
  );
  view.rerender(
    <VodCategoryRail {...props} items={items} onFocus={onFocus} onSelect={onSelect} />,
  );
  const renamed = screen.getByRole("button", { name: "Renamed category" });
  fireEvent.pointerEnter(renamed);
  expect(onFocus).not.toHaveBeenCalled();
  document.documentElement.dataset.inputMode = "pointer";
  fireEvent.pointerEnter(renamed);
  expect(onFocus).toHaveBeenLastCalledWith(2);
  fireEvent.click(renamed);
  expect(onSelect).toHaveBeenLastCalledWith(2);
  const focusOrder = onFocus.mock.invocationCallOrder;
  expect(focusOrder[focusOrder.length - 1]).toBeLessThan(onSelect.mock.invocationCallOrder[0]);
  expect(props.onFocus).not.toHaveBeenCalled();
  expect(props.onSelect).not.toHaveBeenCalled();
});

test("category memoization keeps pointer and remote marquee activation current", () => {
  const props = railProps();
  const view = render(<VodCategoryRail {...props} />);
  vi.mocked(Text).mockClear();
  document.documentElement.dataset.inputMode = "pointer";
  view.rerender(<VodCategoryRail {...props} />);
  expect(Text).toHaveBeenCalledTimes(props.items.length);
  expect(vi.mocked(Text).mock.calls.every(([title]) => title.active === undefined)).toBe(true);
  vi.mocked(Text).mockClear();
  document.documentElement.dataset.inputMode = "remote";
  view.rerender(<VodCategoryRail {...props} />);
  expect(Text).toHaveBeenCalledTimes(props.items.length);
  expect(vi.mocked(Text).mock.calls.map(([title]) => title.active)).toEqual([
    true,
    false,
    false,
    false,
    false,
  ]);
});

test("poster cursor movement within a window does not rescan its preparation URLs", () => {
  vi.useFakeTimers();
  vi.spyOn(viewport, "useViewport").mockReturnValue(1128);
  const readPoster = vi.fn((index: number) => `https://images.example/movie-${index}.jpg`);
  const props: PosterGridProps = {
    items: Array.from({ length: 30 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie",
      title: `Movie ${index}`,
      get poster() {
        return readPoster(index);
      },
      metadata: "",
      rating: "",
      favourite: false,
    })),
    resourceState: "loaded",
    cursor: 0,
    firstRow: 0,
    focused: true,
    fetchReady: false,
    artworkActive: false,
    scale: 1,
    columns: 6,
    onFocus: vi.fn(),
    onActivate: vi.fn(),
    onRetry: vi.fn(),
    onWheel: vi.fn(),
  };
  const view = render(<PosterGrid {...props} />);
  readPoster.mockClear();
  view.rerender(<PosterGrid {...props} cursor={1} />);
  expect(readPoster.mock.calls.map(([index]) => index)).toEqual([0, 1]);
  expect(screen.getByRole("grid").getAttribute("aria-activedescendant")).toBe(
    screen.getByRole("gridcell", { name: "Movie 1" }).id,
  );
});
