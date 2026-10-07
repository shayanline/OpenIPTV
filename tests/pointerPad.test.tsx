import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { PointerPad } from "../src/components/PointerPad";

/**
 * The pad remembers where it was dragged through localStorage rather than settings,
 * because a parked position is not a viewer facing choice and the settings store persists
 * one blob.
 */

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

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
