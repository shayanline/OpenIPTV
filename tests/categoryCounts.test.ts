import { describe, expect, it } from "vitest";
import { knownCategoryCount } from "../src/services/categoryCounts";

const frame = (state: "loaded" | "empty" | "loading" | "failed", keys: string[]) => ({
  state,
  items: keys.map((categoryKey) => ({ categoryKey })),
});

describe("knownCategoryCount", () => {
  it("counts matching titles inside a loaded category frame", () => {
    const category = frame("loaded", ["a", "a", "b"]);
    expect(knownCategoryCount("a", 9, category)).toBe(2);
    expect(knownCategoryCount("b", undefined, category)).toBe(1);
  });

  it("returns zero for a successfully empty category", () => {
    expect(knownCategoryCount("a", 9, frame("empty", []))).toBe(0);
  });

  it("returns undefined while the category is not settled", () => {
    expect(knownCategoryCount("a", undefined, frame("loading", ["a"]))).toBeUndefined();
    expect(knownCategoryCount("a", undefined, frame("failed", ["a"]))).toBeUndefined();
    expect(knownCategoryCount("a", undefined, undefined)).toBeUndefined();
  });

  it("prefers a valid declared count over the index", () => {
    expect(
      knownCategoryCount("a", 12, undefined, "loaded", [{}, {}, {}, {}, {}, {}, {}, {}]),
    ).toBe(12);
  });

  it("uses a completed loaded index when no category frame or declared count exists", () => {
    const items = [
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
      { categoryKey: "a" },
    ];
    expect(knownCategoryCount("a", undefined, undefined, "loaded", items)).toBe(8);
    expect(knownCategoryCount("absent", undefined, undefined, "loaded", undefined)).toBe(0);
    expect(knownCategoryCount("a", undefined, undefined, "empty", [])).toBe(0);
  });

  it("ignores an index that was never marked loaded", () => {
    expect(
      knownCategoryCount("a", undefined, undefined, "idle", [{ categoryKey: "a" }]),
    ).toBeUndefined();
    expect(
      knownCategoryCount("a", undefined, undefined, undefined, [{ categoryKey: "a" }]),
    ).toBeUndefined();
  });

  it("ignores unsafe declared counts", () => {
    expect(knownCategoryCount("a", -1, undefined, "loaded", [])).toBe(0);
    expect(knownCategoryCount("a", 1.5, undefined, "loaded", [])).toBe(0);
    expect(knownCategoryCount("a", Number.NaN, undefined)).toBeUndefined();
  });
});
