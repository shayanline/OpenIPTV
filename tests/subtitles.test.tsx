import { afterEach, beforeEach, expect, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { SubtitleLayer } from "../src/components/playback/SubtitleLayer";
import { TrackPicker } from "../src/components/playback/TrackPicker";
import type { MediaTrack } from "../src/types";
import { emitPlayback, emitSubtitle, mountApp, press, settle } from "./support/app";

/**
 * Subtitle text and the track drawers behind it.
 *
 * The layer is the application's own caption surface: whatever a provider embeds is rendered
 * as text, never as markup, inside the television safe area. The drawers are option lists
 * that apply immediately, keep every direction inside themselves, and restore the row that
 * is actually selected when the engine refuses a choice.
 */

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",First Channel
http://example.invalid/1.m3u8
#EXTINF:-1 group-title="News",Second Channel
http://example.invalid/2.m3u8
`;

const track = (
  kind: "audio" | "subtitle",
  engineIndex: number,
  language: string,
  label = "",
  selected = false,
): MediaTrack => ({
  id: `${kind}|${language}|${engineIndex}`,
  identity: `${kind}|${language}|${label}`,
  engineIndex,
  kind,
  label,
  language,
  selected,
});

const subtitleText = () => document.querySelector(".subtitle-cue")?.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

// ---- the subtitle layer ----------------------------------------------------------------

test("subtitle markup is rendered as text, not interpreted", () => {
  render(<SubtitleLayer cue="<b>Provider words</b>" hidden={false} />);
  expect(screen.getByText("<b>Provider words</b>")).toBeTruthy();
});

test("an empty or hidden cue renders nothing", () => {
  const { rerender } = render(<SubtitleLayer cue="" hidden={false} />);
  assert.equal(subtitleText(), "");
  rerender(<SubtitleLayer cue="Words" hidden />);
  assert.equal(subtitleText(), "");
});

test("a cue carries its own direction", () => {
  render(<SubtitleLayer cue="مرحبا" hidden={false} />);
  assert.equal(document.querySelector(".subtitle-cue")?.getAttribute("dir"), "auto");
});

const subtitleOn = [track("subtitle", 3, "en", "English", true)];

test("AVPlay subtitle markup is rendered as text and clears at its duration", async () => {
  await mountApp(PLAYLIST, { playerTracks: subtitleOn });
  press(KEY.ENTER);

  emitSubtitle("<b>Provider words</b>", 2_000);
  expect(screen.getByText("<b>Provider words</b>")).toBeTruthy();

  await settle(2_100);
  assert.equal(subtitleText(), "");
});

test("modal settings take visual ownership from an active subtitle cue", async () => {
  await mountApp(PLAYLIST, { playerTracks: subtitleOn });
  press(KEY.ENTER);
  emitSubtitle("Provider words", 0);
  expect(screen.getByText("Provider words")).toBeTruthy();

  press(KEY.YELLOW);
  expect(document.querySelector(".sheet")).toBeTruthy();
  expect(document.querySelector(".subtitle-layer")).toBeNull();
});

test("a new cue replaces the old and clears on target change", async () => {
  await mountApp(PLAYLIST, { playerTracks: subtitleOn });
  press(KEY.ENTER);

  emitSubtitle("First", 0);
  assert.equal(subtitleText(), "First");
  emitSubtitle("Second", 0);
  assert.equal(subtitleText(), "Second");

  press(KEY.UP);
  await settle(600);
  assert.equal(subtitleText(), "", "the cue survived a channel change");
});

// ---- the track drawers -----------------------------------------------------------------

const renderPicker = (
  props: Partial<Parameters<typeof TrackPicker>[0]> = {},
  tracks: MediaTrack[] = [
    track("audio", 0, "en", "English", true),
    track("audio", 1, "de", "Deutsch"),
  ],
) =>
  render(
    <TrackPicker
      kind="audio"
      tracks={tracks}
      selectedIdentity={tracks.find((item) => item.selected)?.identity ?? null}
      deviceLanguage="en-US"
      onSelect={vi.fn(() => true)}
      {...props}
    />,
  );

test("audio options are the tracks, with the selected one marked", () => {
  renderPicker();
  const options = document.querySelectorAll(".track-option");
  assert.equal(options.length, 2);
  assert.equal(options[0].textContent, "English");
  assert.equal(options[0].getAttribute("aria-selected"), "true");
});

test("subtitle options begin with Off and add Automatic for one language match", () => {
  render(
    <TrackPicker
      kind="subtitle"
      tracks={[track("subtitle", 2, "en", "English"), track("subtitle", 3, "de", "Deutsch")]}
      selectedIdentity={null}
      deviceLanguage="en-US"
      onSelect={vi.fn(() => true)}
    />,
  );
  const labels = [...document.querySelectorAll(".track-option")].map((row) => row.textContent);
  assert.deepEqual(labels, ["Off", "Automatic", "English", "Deutsch"]);
});

test("Automatic is omitted when the device language matches twice or not at all", () => {
  render(
    <TrackPicker
      kind="subtitle"
      tracks={[
        track("subtitle", 2, "en", "English SDH"),
        track("subtitle", 3, "en", "English"),
        track("subtitle", 4, "de", "Deutsch"),
      ]}
      selectedIdentity={null}
      deviceLanguage="en-US"
      onSelect={vi.fn(() => true)}
    />,
  );
  assert.equal(
    [...document.querySelectorAll(".track-option")].some(
      (row) => row.textContent === "Automatic",
    ),
    false,
  );
});

test("direction keys clamp inside the drawer and Enter selects immediately", () => {
  const onSelect = vi.fn(() => true);
  renderPicker({ onSelect });
  const rows = () => document.querySelectorAll(".track-option");

  press(KEY.UP);
  assert.equal(rows()[0].hasAttribute("data-selected"), true);
  press(KEY.DOWN);
  press(KEY.DOWN);
  press(KEY.DOWN);
  assert.equal(
    rows()[rows().length - 1].hasAttribute("data-selected"),
    true,
    "down wrapped past the last option",
  );

  press(KEY.ENTER);
  assert.equal(onSelect.mock.calls.length, 1);
  assert.equal(onSelect.mock.calls[0][0], 1);
});

test("a refused selection keeps the previous row marked", () => {
  const onSelect = vi.fn(() => false);
  renderPicker({ onSelect });
  press(KEY.DOWN);
  press(KEY.ENTER);
  assert.equal(onSelect.mock.calls.length, 1);
  assert.equal(
    document.querySelectorAll(".track-option")[0].getAttribute("aria-selected"),
    "true",
    "the refused row stayed selected in the list",
  );
});

// ---- through the application ------------------------------------------------------------

test("Audio appears in the deck when multiple tracks exist", async () => {
  await mountApp(PLAYLIST, {
    playerTracks: [
      track("audio", 0, "en", "English", true),
      track("audio", 1, "de", "Deutsch"),
    ],
  });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  assert.ok(
    document.querySelector('[data-control="audio"]'),
    "the deck offered Audio for one real choice",
  );
});

test("one available audio track exposes its drawer action", async () => {
  await mountApp(PLAYLIST, {
    playerTracks: [track("audio", 0, "en", "English", true)],
  });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  expect(document.querySelector('[data-control="audio"]')).toBeTruthy();
});

test("track buttons follow tracks that become available during playback", async () => {
  const tracks: MediaTrack[] = [];
  await mountApp(PLAYLIST, { playerTracks: tracks });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  expect(document.querySelector('[data-control="audio"]')).toBeNull();
  expect(document.querySelector('[data-control="subtitles"]')).toBeNull();

  tracks.push(track("audio", 0, "en", "English", true), track("subtitle", 1, "de", "Deutsch"));
  emitPlayback({ type: "tracks" });
  expect(document.querySelector('[data-control="audio"]')).toBeTruthy();
  expect(document.querySelector('[data-control="subtitles"]')).toBeTruthy();

  tracks.length = 0;
  emitPlayback({ type: "tracks" });
  expect(document.querySelector('[data-control="audio"]')).toBeNull();
  expect(document.querySelector('[data-control="subtitles"]')).toBeNull();
});

test.each([
  ["audio", "Audio", KEY.LEFT],
  ["subtitles", "Subtitles", KEY.BACK],
] as const)(
  "%s uses a rail drawer that keeps controls hidden through dismissal",
  async (kind, label, closeKey) => {
    await mountApp(PLAYLIST, {
      playerTracks: [
        track("audio", 0, "en", "English", true),
        track("audio", 1, "de", "Deutsch"),
        track("subtitle", 2, "en", "English", true),
        track("subtitle", 3, "de", "Deutsch"),
      ],
    });
    press(KEY.ENTER);
    press(KEY.RIGHT);
    document.documentElement.style.setProperty("--t-panel", "180ms");
    try {
      fireEvent.click(screen.getByRole("button", { name: label }));
      const drawer = screen.getByRole("complementary", { name: label });
      expect(screen.getByRole("listbox", { name: label })).toBeTruthy();
      expect(drawer.querySelector(".playback-drawer-footer")).toBeTruthy();
      expect(document.querySelector(".playback-deck")).toBeNull();
      const choice = screen.getByRole("option", { name: "Deutsch" });
      fireEvent.click(choice);
      expect(choice.getAttribute("aria-selected")).toBe("true");
      expect(choice.getAttribute("data-selected")).toBe("true");

      press(closeKey);
      expect(drawer.classList.contains("closing")).toBe(true);
      expect(document.querySelector(".playback-deck")).toBeNull();
      press(KEY.UP);
      press(KEY.ENTER);
      expect(choice.getAttribute("aria-selected")).toBe("true");

      const end = (name: string) => {
        const event = new Event("animationend", { bubbles: true });
        Object.defineProperty(event, "animationName", { value: name });
        fireEvent(drawer, event);
      };
      end("playback-drawer-in");
      expect(document.querySelector(".playback-drawer")).toBe(drawer);
      end("playback-drawer-out");
      expect(document.querySelector(".playback-drawer")).toBeNull();
      expect(document.querySelector(".playback-deck")).toBeTruthy();
      expect(document.querySelector(`[data-control="${kind}"][data-selected]`)).toBeTruthy();
      await settle(250);
      expect(document.querySelector(".playback-drawer")).toBeNull();
    } finally {
      document.documentElement.style.removeProperty("--t-panel");
    }
  },
);

test("track drawer dismissal completes when no animation event arrives", async () => {
  await mountApp(PLAYLIST, {
    playerTracks: [track("audio", 0, "en", "English", true)],
  });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  document.documentElement.style.setProperty("--t-panel", "180ms");
  try {
    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    press(KEY.BACK);
    expect(document.querySelector(".playback-drawer.closing")).toBeTruthy();
    await settle(229);
    expect(document.querySelector(".playback-deck")).toBeNull();
    await settle(1);
    expect(document.querySelector(".playback-drawer")).toBeNull();
    expect(document.querySelector(".playback-deck")).toBeTruthy();
  } finally {
    document.documentElement.style.removeProperty("--t-panel");
  }
});

test("a refused track selection shows one compact message", async () => {
  await mountApp(PLAYLIST, {
    trackFails: true,
    playerTracks: [
      track("audio", 0, "en", "English", true),
      track("audio", 1, "de", "Deutsch"),
    ],
  });
  press(KEY.ENTER);
  press(KEY.RIGHT);
  fireEvent.click(screen.getByRole("button", { name: "Audio" }));
  assert.ok(document.querySelector(".playback-drawer"), "the Audio drawer did not open");

  press(KEY.DOWN);
  press(KEY.ENTER);
  expect(screen.getByText("That track is not available right now.")).toBeTruthy();
});
