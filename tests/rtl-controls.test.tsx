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
