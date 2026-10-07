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

test("playback information lives inside the drawer, which spans both edges", () => {
  expect(styles).toMatch(
    /\.playback-drawer \{[\s\S]*right: var\(--safe-x\);[\s\S]*left: var\(--safe-x\);/,
  );
  expect(styles).toMatch(/\.playback-drawer \.playback-info \{/);
  expect(styles).not.toMatch(/\.playback-info \{[^}]*position: absolute/);
});

test("a focused off switch keeps its track and knob visible", () => {
  expect(styles).toMatch(
    /\.switch:focus:not\(\.on\) \.switch-track \{[^}]*background: rgba\(16, 16, 19, 0\.14\);/,
  );
  expect(styles).toMatch(
    /\.switch:focus:not\(\.on\) \.switch-knob \{[^}]*background: rgba\(16, 16, 19, 0\.62\);/,
  );
});

test("the seek thumb and target label follow the reading direction", () => {
  expect(styles).toMatch(/\.seekbar-thumb \{[^}]*transform: translate\(-50%, -50%\);/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.seekbar-thumb \{[^}]*transform: translate\(50%, -50%\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.seekbar-target \{[^}]*transform: translateX\(50%\);/,
  );
});

test("deck and seek spacing mirrors under RTL margin fallback", () => {
  expect(styles).toMatch(/\.no-flex-gap \.seekbar > \* \+ \* \{\s*margin-left: var\(--s3\);/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.no-flex-gap \.seekbar > \* \+ \*[\s\S]*margin-right: var\(--s3\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.no-flex-gap \.deck-transport > \* \+ \* \{[^}]*margin-right: var\(--s2\);/,
  );
});

test("the deck context and track actions have physical fallbacks and RTL mirrors", () => {
  expect(styles).toMatch(/\.deck-lead \{[^}]*left: 0;[^}]*inset-inline-start: 0;/);
  expect(styles).toMatch(/\.deck-tail \{[^}]*right: 0;[^}]*inset-inline-end: 0;/);
  expect(styles).toMatch(/html\[dir="rtl"\] \.deck-lead \{[^}]*right: 0;[^}]*left: auto;/);
  expect(styles).toMatch(/html\[dir="rtl"\] \.deck-tail \{[^}]*right: auto;[^}]*left: 0;/);
});

test("Guide docks and animates from the physical outer edge", () => {
  expect(styles).toMatch(
    /\.playback-drawer\.guide-drawer \{[^}]*right: var\(--safe-x\);[^}]*left: auto;[^}]*animation: guide-drawer-in/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.playback-drawer\.guide-drawer \{[^}]*right: auto;[^}]*left: var\(--safe-x\);[^}]*animation-name: guide-drawer-in-rtl/,
  );
  expect(styles).toMatch(
    /@keyframes guide-drawer-in-rtl \{[\s\S]*translateX\(calc\(-100% - var\(--safe-x\)\)\)/,
  );
});

test("the top strip mirrors under the logical margin fallback", () => {
  expect(styles).toMatch(
    /\.no-flex-gap \.top-strip > \* \+ \* \{\s*margin-inline-start: var\(--s1\);/,
  );
});

test("VOD Back mirrors its directional icon in RTL", () => {
  expect(styles).toMatch(/html\[dir="rtl"\] \.vod-back \.icon \{[^}]*transform: scaleX\(-1\);/);
});

test("subtitle cues stay below modals and track spacing survives without flex gap", () => {
  expect(styles).toMatch(/\.subtitle-layer \{[^}]*z-index: var\(--z-panel\);/);
  expect(styles).toMatch(/\.subtitle-cue \{[^}]*text-align: center;/);
  expect(styles).toMatch(
    /\.track-option\.selected::before \{[^}]*margin-inline-end: var\(--s2\);/,
  );
  expect(styles).toMatch(
    /\.no-flex-gap \.track-picker > \* \+ \* \{[^}]*margin-top: var\(--s1\);/,
  );
});

test("Guide drawer geometry is owned only by the playback drawer selector", () => {
  expect(styles).not.toMatch(/(?:^|\n)\.guide-drawer \{/);
  expect(styles).toMatch(/\.playback-drawer\.guide-drawer \{/);
});
