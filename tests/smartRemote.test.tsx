import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SmartRemote } from "../src/components/SmartRemote";
import { KEY } from "../src/hooks/useRemote";
import { usePointerAwake } from "../src/hooks/usePointerAwake";

const originalUrl = window.location.href;
const originalHistoryState = window.history.state;

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

function PointerPreview() {
  usePointerAwake();
  return <SmartRemote />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(originalHistoryState, "", originalUrl);
});

test("remote double clicks do not reach the app fullscreen gesture", () => {
  const fullscreen = vi.fn();
  render(
    <div onDoubleClick={fullscreen}>
      <SmartRemote />
    </div>,
  );
  const launcher = screen.getByRole("button", { name: "Show Smart Remote" });
  fireEvent.doubleClick(launcher);
  expect(fullscreen).not.toHaveBeenCalled();
  fireEvent.click(launcher);
  fireEvent.doubleClick(screen.getByRole("button", { name: "Down" }));
  expect(fullscreen).not.toHaveBeenCalled();
});

test("virtual remote pointer events preserve remote input while canvas movement restores pointer input", () => {
  render(<PointerPreview />);
  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  const down = screen.getByRole("button", { name: "Down" });
  fireEvent.pointerDown(down);
  expect(document.documentElement.dataset.inputMode).toBe("remote");
  fireEvent.pointerMove(down);
  expect(document.documentElement.dataset.inputMode).toBe("remote");
  fireEvent.pointerUp(down);
  fireEvent.pointerMove(document.body);
  expect(document.documentElement.dataset.inputMode).toBe("pointer");
});

test.each(["blur", "capture", "outside", "hide"] as const)(
  "a held virtual key releases once after %s and stops repeating",
  (ending) => {
    vi.useFakeTimers();
    const downEvents: KeyboardEvent[] = [];
    const upEvents: KeyboardEvent[] = [];
    const onDown = (event: KeyboardEvent) => downEvents.push(event);
    const onUp = (event: KeyboardEvent) => upEvents.push(event);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    try {
      render(<SmartRemote />);
      fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
      const down = screen.getByRole("button", { name: "Down" });
      fireEvent.pointerDown(down);
      act(() => vi.advanceTimersByTime(640));
      expect(downEvents[0].keyCode).toBe(KEY.DOWN);
      expect(downEvents[0].repeat).toBe(false);
      expect(downEvents.slice(1).every((event) => event.repeat)).toBe(true);
      expect(downEvents.length).toBeGreaterThan(1);
      if (ending === "blur") fireEvent.blur(window);
      else if (ending === "capture") fireEvent.lostPointerCapture(down);
      else if (ending === "outside") fireEvent.pointerUp(window);
      else fireEvent.click(screen.getByRole("button", { name: "Hide the remote" }));
      fireEvent.pointerUp(window);
      expect(upEvents.map((event) => event.keyCode)).toEqual([KEY.DOWN]);
      const count = downEvents.length;
      act(() => vi.advanceTimersByTime(2000));
      expect(downEvents).toHaveLength(count);
    } finally {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    }
  },
);

test("the Smart Remote stays a launcher without the remote flag", () => {
  setSearch("");
  render(<SmartRemote />);
  expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
});

test.each(["?remote", "?remote=1"])(
  "the Smart Remote stays collapsed even with %s",
  (search) => {
    setSearch(search);
    render(<SmartRemote />);
    expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
  },
);

test.each(["?remotely=1", "?source=remote"])(
  "the Smart Remote ignores unrelated parameters like %s",
  (search) => {
    setSearch(search);
    render(<SmartRemote />);
    expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();
  },
);

test("an explicitly opened Smart Remote still hides and reopens", () => {
  setSearch("?remote");
  render(<SmartRemote />);
  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Hide the remote" }));
  expect(screen.getByRole("button", { name: "Show Smart Remote" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Volume up" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Show Smart Remote" }));
  expect(screen.getByRole("button", { name: "Select" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Volume up" })).toBeTruthy();
});
