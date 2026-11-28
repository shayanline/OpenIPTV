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
    /html\[dir="rtl"\] \.pane-head \{[^}]*padding-left: var\(--content-gutter\);[^}]*padding-right: var\(--content-gutter\);/,
  );
});

test("playback information stays a compact diagnostic outside playback drawers", () => {
  expect(styles).toMatch(
    /\.playback-drawer \{[\s\S]*right: var\(--safe-x\);[\s\S]*left: var\(--safe-x\);/,
  );
  expect(styles).not.toMatch(/\.playback-drawer \.playback-info \{/);
  expect(styles).toMatch(/\.playback-info \{[^}]*position: absolute/);
});

test("a remotely focused off switch keeps its track and knob visible", () => {
  expect(styles).toMatch(
    /html\[data-input-mode="remote"\] \.switch:focus:not\(\.on\) \.switch-track \{[^}]*background: var\(--target-badge\);/,
  );
  expect(styles).toMatch(
    /html\[data-input-mode="remote"\] \.switch:focus:not\(\.on\) \.switch-knob \{[^}]*background: var\(--target-muted\);/,
  );
});

test("the seek thumb and target label follow the reading direction", () => {
  expect(styles).toMatch(/\.seekbar-thumb \{[^}]*transform: translate\(-50%, -50%\);/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.seekbar-thumb \{[^}]*transform: translate\(50%, -50%\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.seekbar-target \{[^}]*transform: translate\(50%, 6px\);/,
  );
});

test("deck and seek spacing mirrors under RTL margin fallback", () => {
  expect(styles).toMatch(/\.no-flex-gap \.seekbar > \* \+ \* \{\s*margin-left: var\(--s3\);/);
  expect(styles).toMatch(
    /html\[dir="rtl"\]\.no-flex-gap \.seekbar > \* \+ \*[\s\S]*margin-right: var\(--s3\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\]\.no-flex-gap \.deck-transport > \* \+ \* \{[^}]*margin-right: 14px;/,
  );
});

test("the deck context and track actions keep stable logical columns", () => {
  expect(styles).toMatch(/\.deck-lead \{[^}]*grid-column: 1;/);
  expect(styles).toMatch(/\.deck-tail \{[^}]*grid-column: 3;/);
  expect(styles).toMatch(/\.deck-transport \{[^}]*grid-column: 2;/);
});

test("playback drawers dock and animate from the right in both writing directions", () => {
  expect(styles).toMatch(
    /\.playback-drawer \{[^}]*right: var\(--safe-x\);[^}]*left: auto;[^}]*animation: playback-drawer-in/,
  );
  expect(styles).not.toMatch(/html\[dir="rtl"\] \.playback-drawer(?:\.guide-drawer)? \{/);
  expect(styles).toMatch(
    /@keyframes playback-drawer-in \{[\s\S]*translateX\(calc\(100% \+ var\(--safe-x\)\)\)/,
  );
});

test("the top strip mirrors under the logical margin fallback", () => {
  expect(styles).toMatch(
    /\.no-flex-gap \.top-strip > \* \+ \* \{\s*margin-inline-start: var\(--s1\);/,
  );
});

test("the application rail mirrors to the physical leading edge in RTL", () => {
  expect(styles).toMatch(/html\[dir="rtl"\] \.app-navigation \{[^}]*right: 0;[^}]*left: auto;/);
  expect(styles).toMatch(/\.sheet \{[^}]*right: 0;[^}]*left: 0;/);
});

test("subtitle cues stay below modals and track spacing survives without flex gap", () => {
  expect(styles).toMatch(/\.subtitle-layer \{[^}]*z-index: var\(--z-panel\);/);
  expect(styles).toMatch(/\.subtitle-cue \{[^}]*text-align: center;/);
  expect(styles).toMatch(/\.track-option-check \{[^}]*margin-left: var\(--s2\);/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.track-option-check \{[^}]*margin-right: var\(--s2\);[^}]*margin-left: 0;/,
  );
  expect(styles).toMatch(
    /\.no-flex-gap \.track-picker > \* \+ \* \{[^}]*margin-top: var\(--s1\);/,
  );
});

test("Guide drawer geometry is owned only by the playback drawer selector", () => {
  expect(styles).not.toMatch(/(?:^|\n)\.guide-drawer \{/);
  expect(styles).toMatch(
    /\.playback-drawer\.guide-drawer \.guide-list \{[^}]*width: 100%;[^}]*height: auto;[^}]*flex: 1 1 auto;/,
  );
});
