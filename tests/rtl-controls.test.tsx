import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const styles = readFileSync("src/styles/app.css", "utf8");

test("the pointer pad starts on the left in RTL", () => {
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.pad \{[\s\S]*left: var\(--safe-x\);[\s\S]*right: auto;/,
  );
});

test("the debug remote starts on the left in RTL", () => {
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.remote-stage \{[\s\S]*left: 28px;[\s\S]*right: auto;/,
  );
});

test("the category count keeps its inset from the RTL divider", () => {
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.pane-head \{[^}]*padding-left: var\(--s2\);[^}]*padding-right: 0;/,
  );
});

test("playback information follows the reading edge", () => {
  expect(styles).toMatch(/\.playback-info \{[\s\S]*right: var\(--safe-x\);[\s\S]*left: auto;/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.playback-info \{[\s\S]*left: var\(--safe-x\);[\s\S]*right: auto;/,
  );
});

test("a focused off switch keeps its track and knob visible", () => {
  expect(styles).toMatch(
    /\.switch:focus:not\(\.on\) \.switch-track \{[^}]*background: rgba\(16, 16, 19, 0\.14\);/,
  );
  expect(styles).toMatch(
    /\.switch:focus:not\(\.on\) \.switch-knob \{[^}]*background: rgba\(16, 16, 19, 0\.62\);/,
  );
});
