import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { PointerPad } from "../src/components/PointerPad";
import { usePointerAwake } from "../src/hooks/usePointerAwake";
import { KEY } from "../src/hooks/useRemote";

/**
 * The pad remembers where it was dragged through localStorage rather than settings,
 * because a parked position is not a viewer facing choice and the settings store persists
 * one blob.
 */

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

test("repeated input in the current mode does not invalidate root observers", () => {
  const hook = renderHook(() => usePointerAwake());
  const root = document.documentElement;
  const observer = new MutationObserver(() => {});
  observer.observe(root, { attributes: true, attributeFilter: ["data-input-mode"] });
  try {
    fireEvent.keyDown(window, { keyCode: KEY.DOWN });
    fireEvent.keyDown(window, { keyCode: KEY.DOWN });
    expect(root.dataset.inputMode).toBe("remote");
    expect(observer.takeRecords()).toHaveLength(0);

    fireEvent.pointerMove(window);
    fireEvent.pointerMove(window);
    fireEvent.pointerDown(window);
    expect(root.dataset.inputMode).toBe("pointer");
    expect(observer.takeRecords()).toHaveLength(1);

    fireEvent.keyDown(window, { keyCode: 65 });
    expect(root.dataset.inputMode).toBe("pointer");
    expect(observer.takeRecords()).toHaveLength(0);

    fireEvent.keyDown(window, { keyCode: KEY.DOWN });
    fireEvent.keyDown(window, { keyCode: KEY.UP });
    expect(root.dataset.inputMode).toBe("remote");
    expect(observer.takeRecords()).toHaveLength(1);
  } finally {
    observer.disconnect();
    hook.unmount();
  }
});

test("a dragged position is written on pointerup and restored on remount", () => {
  const first = render(<PointerPad shown />);
  const pad = first.container.querySelector(".pad") as HTMLElement;
  fireEvent.pointerDown(pad, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(pad, { pointerId: 1, clientX: 300, clientY: 200 });
  fireEvent.pointerUp(pad, { pointerId: 1 });

  const stored = JSON.parse(localStorage.getItem("openiptv.pad") ?? "null") as {
    x: number;
    y: number;
  } | null;
  expect(stored).not.toBeNull();
  first.unmount();

  const second = render(<PointerPad shown />);
  const parked = second.container.querySelector(".pad") as HTMLElement;
  expect(parked.style.left).toBe(`${stored?.x}px`);
  expect(parked.style.top).toBe(`${stored?.y}px`);
});

test("a stored position outside the window is clamped back inside", () => {
  localStorage.setItem("openiptv.pad", JSON.stringify({ x: 99999, y: 99999 }));
  const { container } = render(<PointerPad shown />);
  const pad = container.querySelector(".pad") as HTMLElement;

  const x = parseFloat(pad.style.left);
  const y = parseFloat(pad.style.top);
  expect(x).toBeGreaterThan(0);
  expect(y).toBeGreaterThan(0);
  expect(x).toBeLessThan(window.innerWidth);
  expect(y).toBeLessThan(window.innerHeight);
});

test("a pointerup that was not a drag writes nothing", () => {
  const { container } = render(<PointerPad shown />);
  const pad = container.querySelector(".pad") as HTMLElement;
  const button = pad.querySelector(".pad-ok") as HTMLElement;

  fireEvent.pointerDown(button, { pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });

  expect(localStorage.getItem("openiptv.pad")).toBeNull();
});

test("the pointer pad sits above playback chrome and below modal popups", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const value = (name: string) =>
    Number(tokens.match(new RegExp(`--${name}:\\s*(\\d+);`))?.[1]);

  expect(value("z-playback")).toBeLessThan(value("z-pointer"));
  expect(value("z-pointer")).toBeLessThan(value("z-popup"));
});
