import { describe, expect, it } from "vitest";
import { recordFromEntries } from "../src/services/record";

describe("recordFromEntries", () => {
  it("returns a plain object with no own keys for empty input", () => {
    const record = recordFromEntries([]);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.keys(record)).toHaveLength(0);
  });

  it("copies Map entries preserving values and insertion order", () => {
    const record = recordFromEntries(
      new Map<string, number>([
        ["beta", 2],
        ["alpha", 1],
      ]),
    );
    expect(record).toEqual({ beta: 2, alpha: 1 });
    expect(Object.keys(record)).toEqual(["beta", "alpha"]);
  });

  it("keeps the last value for a duplicate key", () => {
    const record = recordFromEntries([
      ["key", 1],
      ["other", 9],
      ["key", 7],
    ] as const);
    expect(record.key).toBe(7);
    expect(record.other).toBe(9);
    expect(Object.keys(record)).toEqual(["key", "other"]);
  });

  it("writes __proto__ and built in names as own data properties", () => {
    const record = recordFromEntries<unknown>([
      ["__proto__", { custom: true }],
      ["constructor", "ctor"],
      ["toString", "ts"],
    ]);
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(record, "__proto__")?.value).toEqual({
      custom: true,
    });
    expect(record.constructor).toBe("ctor");
    expect(record.toString).toBe("ts");
    expect(Object.keys(record)).toEqual(["__proto__", "constructor", "toString"]);
  });

  it("preserves symbol keys alongside string keys", () => {
    const marker = Symbol("marker");
    const record = recordFromEntries([
      ["plain", 1],
      [marker, 2],
    ] as const);
    expect(record.plain).toBe(1);
    expect(record[marker]).toBe(2);
    expect(Object.getOwnPropertySymbols(record)).toEqual([marker]);
  });

  it("keeps undefined values as enumerable own properties", () => {
    const record = recordFromEntries([["missing", undefined]]);
    expect(record.missing).toBeUndefined();
    expect(Object.keys(record)).toEqual(["missing"]);
  });
});
