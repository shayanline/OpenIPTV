import { act, fireEvent, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import {
  createListHold,
  listStepFromKey,
  useListAcceleration,
} from "../src/hooks/useListAcceleration";
import { KEY } from "../src/hooks/useRemote";

test("held list movement accelerates gradually and remains bounded", () => {
  const hold = createListHold();
  expect(listStepFromKey(hold, KEY.DOWN, false, "channels", 0)).toBe(1);
  const observed = new Map<number, number>();
  for (let now = 100; now <= 11000; now += 100) {
    observed.set(now, listStepFromKey(hold, KEY.DOWN, true, "channels", now));
  }
  expect([
    observed.get(1900),
    observed.get(2000),
    observed.get(4900),
    observed.get(5000),
    observed.get(9900),
    observed.get(10000),
    observed.get(11000),
  ]).toEqual([1, 5, 5, 10, 10, 20, 20]);
});

test("fresh presses, direction changes, and different lists reset acceleration", () => {
  const hold = { code: KEY.DOWN, scope: "channels", startedAt: 0, steppedAt: 10000 };
  expect(listStepFromKey(hold, KEY.DOWN, true, "channels", 10100)).toBe(20);
  expect(listStepFromKey(hold, KEY.UP, true, "channels", 10200)).toBe(1);
  expect(listStepFromKey(hold, KEY.UP, true, "categories", 10300)).toBe(1);
  expect(listStepFromKey(hold, KEY.UP, false, "categories", 10400)).toBe(1);
  expect(listStepFromKey(hold, KEY.UP, true, "categories", 12000)).toBe(1);
});

test("repeat streams are limited without delaying separate presses", () => {
  const hold = createListHold();
  expect(listStepFromKey(hold, KEY.DOWN, false, "grid", 0)).toBe(1);
  expect(listStepFromKey(hold, KEY.DOWN, true, "grid", 20)).toBe(0);
  expect(listStepFromKey(hold, KEY.DOWN, true, "grid", 100)).toBe(1);
  expect(listStepFromKey(hold, KEY.DOWN, false, "grid", 110)).toBe(1);
});

test("releasing a direction clears a hold before the next repeat", () => {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
  const view = renderHook(() => useListAcceleration(true));
  try {
    view.result.current(KEY.DOWN, false, "grid");
    for (now = 100; now <= 5000; now += 100) view.result.current(KEY.DOWN, true, "grid");
    act(() => {
      fireEvent.keyUp(window, { keyCode: KEY.DOWN });
    });
    now = 5100;
    expect(view.result.current(KEY.DOWN, true, "grid")).toBe(1);
  } finally {
    view.unmount();
    clock.mockRestore();
  }
});
