import { expect, test } from "vitest";
import { detailActionColumns, stepDetailAction } from "../src/services/vodActionLayout";

test.each([2, 3, 4, 5, 6])(
  "all %i detail actions remain reachable through directional keys",
  (count) => {
    const visited = new Set([0]);
    const pending = [0];
    while (pending.length) {
      const index = pending.shift()!;
      for (const direction of ["up", "down", "start", "end"] as const) {
        const next = stepDetailAction(index, count, direction);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(count);
        if (!visited.has(next)) {
          visited.add(next);
          pending.push(next);
        }
      }
    }
    expect(visited.size).toBe(count);
  },
);

test("secondary focus follows the two column Series layout without wrapping at edges", () => {
  expect(detailActionColumns(5)).toBe(2);
  expect(stepDetailAction(0, 5, "down")).toBe(1);
  expect(stepDetailAction(1, 5, "end")).toBe(2);
  expect(stepDetailAction(2, 5, "down")).toBe(4);
  expect(stepDetailAction(4, 5, "start")).toBe(3);
  expect(stepDetailAction(3, 5, "up")).toBe(1);
  expect(stepDetailAction(2, 5, "up")).toBe(0);
  expect(stepDetailAction(2, 5, "end")).toBe(2);
  expect(stepDetailAction(4, 5, "down")).toBe(4);
});

test("the three secondary Movie actions stay on one row", () => {
  expect(detailActionColumns(4)).toBe(3);
  expect(stepDetailAction(1, 4, "end")).toBe(2);
  expect(stepDetailAction(2, 4, "end")).toBe(3);
  expect(stepDetailAction(3, 4, "up")).toBe(0);
  expect(stepDetailAction(3, 4, "down")).toBe(3);
});
