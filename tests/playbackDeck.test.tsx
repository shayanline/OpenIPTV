import { act, fireEvent, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { useState } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PlaybackInfo } from "../src/components/PlaybackInfo";
import { PlaybackDrawer } from "../src/components/playback/PlaybackDrawer";
import {
  PlaybackDeck,
  type PlaybackDeckAction,
  type PlaybackDeckFocus,
  type PlaybackDeckProps,
} from "../src/components/playback/PlaybackDeck";
import { QuickSeek } from "../src/components/playback/QuickSeek";
import { DEFAULT_MARQUEE_DWELL_MS } from "../src/components/Text";
import type { PlaybackExpansionOrigin } from "../src/hooks/usePlaybackExpansion";
import { KEY } from "../src/hooks/useRemote";
import { translate } from "../src/services/locale";
import { useSettings } from "../src/stores/settings";
import type { PlaybackSnapshot } from "../src/types";

const press = (code: number) =>
  act(() => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => code });
    window.dispatchEvent(event);
  });

const pressEvent = (code: number) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => code });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

const finiteSnapshot = (overrides: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  phase: "playing",
  paused: overrides.phase === "paused",
  target: {
    id: "movie:1",
    playlistId: "pl-1",
    mode: "finite",
    kind: "movie",
    name: "The Film",
    group: "Movies",
    logo: "",
    url: "http://example.invalid/movie.mp4",
  },
  position: 60,
  duration: 300,
  seekRange: { startSeconds: 0, endSeconds: 300, liveEdge: false },
  bufferedPercent: 40,
  recoveryAttempt: 0,
  recoveryIn: 0,
  fault: null,
  ...overrides,
});

const renderDeckProps = (
  overrides: Partial<PlaybackDeckProps> = {},
): Omit<PlaybackDeckProps, "focus" | "onFocus"> => ({
  snapshot: finiteSnapshot(),
  metadata: { kind: "movie", title: "The Film", year: "2021", rating: "8.4", quality: "HD" },
  canPause: true,
  hasGuide: false,
  hasAudio: true,
  hasSubtitles: true,
  previousEnabled: true,
  nextEnabled: true,
  onSeek: vi.fn(),
  onAction: vi.fn(),
  onClose: vi.fn(),
  onInteraction: vi.fn(),
  ...overrides,
});

/** The screen owns deck focus and drawer state; this stands in for it in isolation. */
function Harness({
  initialFocus = "play-pause",
  ...props
}: Omit<PlaybackDeckProps, "focus" | "onFocus"> & { initialFocus?: PlaybackDeckFocus }) {
  const [focus, setFocus] = useState<PlaybackDeckFocus>(initialFocus);
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState<PlaybackDeckAction | null>(null);
  return (
    <>
      {open && !drawer && (
        <PlaybackDeck
          {...props}
          focus={focus}
          onFocus={setFocus}
          onClose={() => {
            setOpen(false);
            props.onClose();
          }}
          onAction={(action) => {
            if (action === "audio" || action === "subtitles") setDrawer(action);
            props.onAction(action);
          }}
        />
      )}
      {drawer && (
        <PlaybackDrawer
          title="Drawer"
          origin={drawer}
          onBack={(origin) => {
            setDrawer(null);
            setFocus(origin);
          }}
        >
          <div className="drawer-content">options</div>
        </PlaybackDrawer>
      )}
    </>
  );
}

const renderDeck = (props: Partial<PlaybackDeckProps> = {}, focus?: PlaybackDeckFocus) =>
  render(<Harness {...renderDeckProps(props)} initialFocus={focus} />);

const selectedControl = () =>
  document.querySelector("[data-selected]")?.getAttribute("data-control") ?? null;
const deckVisible = () => !!document.querySelector(".playback-deck");

let inputMode: string | undefined;

beforeEach(() => {
  inputMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "remote";
  document.body.innerHTML = "";
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  if (inputMode === undefined) delete document.documentElement.dataset.inputMode;
  else document.documentElement.dataset.inputMode = inputMode;
});

test("finite deck opens on Play or Pause and opens on seek after quick seeking", () => {
  const first = renderDeck();
  expect(selectedControl()).toBe("play-pause");
  first.unmount();
  renderDeck({}, "seek");
  expect(selectedControl()).toBe("seek");
});

test.each(["live", "movie", "episode"] as const)(
  "%s playback controls use the banner's shared entrance",
  (kind) => {
    renderDeck({ metadata: { kind, title: "Playing" } });
    const root = document.querySelector(".playback-deck");
    expect(root?.getAttribute("data-kind")).toBe(kind);
    expect(root?.getAttribute("data-entrance")).toBe("ordinary");
    const styles = readFileSync("src/styles/app.css", "utf8");
    expect(styles).toMatch(
      /\.pb-stack,\s*\.playback-deck \{[^}]*animation:\s*pb-in var\(--t-med\) var\(--ease-enter\);/,
    );
  },
);

test.each([
  {
    kind: "movie",
    phase: "playing",
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: false,
    expected: "play-pause",
  },
  {
    kind: "movie",
    phase: "connecting",
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: false,
    expected: "play-pause",
  },
  {
    kind: "episode",
    phase: "connecting",
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: false,
    expected: "play-pause",
  },
  {
    kind: "live",
    phase: "connecting",
    previousEnabled: true,
    nextEnabled: false,
    hasAudio: false,
    expected: "play-pause",
  },
  {
    kind: "live",
    phase: "recovering",
    previousEnabled: false,
    nextEnabled: true,
    hasAudio: false,
    expected: "play-pause",
  },
  {
    kind: "live",
    phase: "rebuffering",
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: true,
    expected: "play-pause",
  },
] as const)("a $kind deck initially focuses $expected during $phase", (entry) => {
  renderDeck({
    snapshot: finiteSnapshot({ phase: entry.phase, seekRange: null }),
    metadata: { kind: entry.kind, title: "Playing title" },
    previousEnabled: entry.previousEnabled,
    nextEnabled: entry.nextEnabled,
    hasAudio: entry.hasAudio,
    hasSubtitles: false,
    hasGuide: false,
  });
  expect(selectedControl()).toBe(entry.expected);
  expect(document.activeElement?.getAttribute("data-control")).toBe(entry.expected);
  expect(document.querySelectorAll(".deck-control[data-selected]")).toHaveLength(1);
  expect(
    document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')?.disabled,
  ).toBe(false);
});

test("native focus reaches Play or Pause when it becomes the first available control", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ phase: "connecting", seekRange: null }),
    metadata: { kind: "live", title: "Channel" },
    canPause: false,
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: false,
    hasSubtitles: false,
    hasGuide: false,
  });
  const view = render(<Harness {...props} />);
  expect(selectedControl()).toBeNull();
  view.rerender(<Harness {...props} canPause />);
  expect(selectedControl()).toBe("play-pause");
  expect(document.activeElement?.getAttribute("data-control")).toBe("play-pause");
});

test("loading keeps the requested pause state separate from the spinner", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ phase: "connecting", paused: true, seekRange: null }),
  });
  const view = render(<Harness {...props} />);
  const control = view.container.querySelector<HTMLButtonElement>(
    '[data-control="play-pause"]',
  )!;
  expect(control.disabled).toBe(false);
  expect(control.getAttribute("aria-pressed")).toBe("true");
  expect(view.container.querySelector(".spinner")).toBeTruthy();
  expect(selectedControl()).toBe("play-pause");
  press(KEY.ENTER);
  expect(props.onAction).toHaveBeenCalledWith("play-pause");
  view.rerender(
    <Harness
      {...props}
      snapshot={finiteSnapshot({ phase: "connecting", paused: false, seekRange: null })}
    />,
  );
  expect(control.getAttribute("aria-pressed")).toBe("false");
  expect(view.container.querySelector(".spinner")).toBeTruthy();
});

test("terminal failure keeps Play/Pause disabled while other actions remain reachable", () => {
  renderDeck({ snapshot: finiteSnapshot({ phase: "failed" }) });
  const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;
  expect(control.disabled).toBe(true);
  expect(selectedControl()).toBe("details");
});

test("an active seek keeps its slider and focus while buffering disables seeking", () => {
  const props = renderDeckProps();
  const view = render(<Harness {...props} initialFocus="seek" />);
  const slider = view.getByRole("slider");
  expect(document.activeElement).toBe(slider);
  press(KEY.RIGHT);
  expect(props.onSeek).toHaveBeenCalledOnce();
  vi.mocked(props.onSeek).mockClear();
  view.rerender(
    <Harness
      {...props}
      snapshot={finiteSnapshot({ phase: "rebuffering", seekRange: null, position: null })}
    />,
  );
  expect(view.getByRole("slider")).toBe(slider);
  expect(slider.getAttribute("aria-disabled")).toBe("true");
  expect(selectedControl()).toBe("seek");
  expect(document.activeElement).toBe(slider);
  press(KEY.RIGHT);
  expect(props.onSeek).not.toHaveBeenCalled();
  view.rerender(<Harness {...props} snapshot={finiteSnapshot({ phase: "paused" })} />);
  expect(view.getByRole("slider")).toBe(slider);
  expect(slider.getAttribute("aria-disabled")).toBeNull();
  expect(document.activeElement).toBe(slider);
  expect(selectedControl()).toBe("seek");
  press(KEY.RIGHT);
  expect(props.onSeek).toHaveBeenCalledOnce();
});

test("the deck closes eight seconds after the latest interaction", () => {
  const props = renderDeckProps();
  render(<Harness {...props} />);
  advance(7_999);
  expect(deckVisible()).toBe(true);
  advance(1);
  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalled();
});

test.each([KEY.LEFT, KEY.ENTER, KEY.PLAY_PAUSE])(
  "input %s restarts the close timer",
  (code) => {
    const view = renderDeck();
    advance(7_900);
    press(code);
    advance(7_900);
    expect(deckVisible()).toBe(true);
    view.unmount();
  },
);

test("a paused picture still withdraws the deck after inactivity", () => {
  renderDeck({ snapshot: finiteSnapshot({ phase: "paused" }) });
  advance(7_999);
  expect(deckVisible()).toBe(true);
  advance(1);
  expect(deckVisible()).toBe(false);
});

test("ordinary position updates and fresh callbacks do not extend the deadline", () => {
  const props = renderDeckProps();
  const view = render(<Harness {...props} />);
  advance(7_000);
  /*
   * One second of playback is one snapshot: the close timer lives behind callback refs,
   * so neither the new position nor the new handler identities may restart it.
   */
  view.rerender(
    <Harness
      {...props}
      snapshot={finiteSnapshot({ position: 61 })}
      onClose={vi.fn()}
      onInteraction={vi.fn()}
    />,
  );
  advance(999);
  expect(deckVisible()).toBe(true);
  advance(1);
  expect(deckVisible()).toBe(false);
});

test("Down closes from a seekable control row", () => {
  const props = renderDeckProps();
  render(<Harness {...props} />);

  press(KEY.DOWN);

  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(selectedControl()).toBeNull();
});

test("Down closes from the seek row when no control action is available", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({
      seekRange: { startSeconds: 0, endSeconds: 300, liveEdge: true },
    }),
    metadata: { kind: "live", title: "Channel" },
    canPause: false,
    hasAudio: false,
    hasSubtitles: false,
    previousEnabled: false,
    nextEnabled: false,
  });
  render(<Harness {...props} initialFocus="seek" />);

  press(KEY.DOWN);

  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(selectedControl()).toBeNull();
});

test("Down closes from an unavailable control at the bottom edge", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ seekRange: null }),
    metadata: { kind: "live", title: "Channel" },
    canPause: false,
    hasAudio: false,
    hasSubtitles: false,
    previousEnabled: false,
    nextEnabled: false,
  });
  render(<Harness {...props} initialFocus="previous" />);

  press(KEY.DOWN);

  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(selectedControl()).toBeNull();
});

test("Up enters seek from controls and Up closes from seek", () => {
  const props = renderDeckProps();
  render(<Harness {...props} />);

  press(KEY.UP);
  expect(selectedControl()).toBe("seek");
  expect(deckVisible()).toBe(true);
  expect(props.onClose).not.toHaveBeenCalled();
  press(KEY.DOWN);
  expect(selectedControl()).toBe("play-pause");
  expect(deckVisible()).toBe(true);
  expect(props.onClose).not.toHaveBeenCalled();
  press(KEY.UP);
  expect(selectedControl()).toBe("seek");
  expect(props.onClose).not.toHaveBeenCalled();
  press(KEY.UP);

  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(selectedControl()).toBeNull();
});

test("Up closes from the control row when no seek action is available", () => {
  const props = renderDeckProps({ snapshot: finiteSnapshot({ seekRange: null }) });
  render(<Harness {...props} />);

  press(KEY.UP);

  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(selectedControl()).toBeNull();
});

test("Down from seek enters the first available control when play pause is unavailable", () => {
  const props = renderDeckProps({
    canPause: false,
    previousEnabled: false,
    nextEnabled: true,
    hasAudio: true,
    hasSubtitles: false,
  });
  render(<Harness {...props} initialFocus="seek" />);

  press(KEY.DOWN);

  expect(selectedControl()).toBe("details");
  expect(deckVisible()).toBe(true);
  expect(props.onClose).not.toHaveBeenCalled();
});

test("Back closes the deck immediately", () => {
  renderDeck();
  press(KEY.BACK);
  expect(deckVisible()).toBe(false);
});

test("inline start stays on the leading deck control", () => {
  renderDeck({}, "details");

  press(KEY.LEFT);

  expect(selectedControl()).toBe("details");
  expect(deckVisible()).toBe(true);
});

test("drawer Back restores its exact deck origin and starts a fresh deck interval", () => {
  const props = renderDeckProps();
  render(<Harness {...props} />);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  expect(selectedControl()).toBe("audio");
  press(KEY.ENTER);
  expect(document.querySelector(".playback-drawer")).toBeTruthy();

  advance(60_000); // drawers never close on a timer
  expect(document.querySelector(".playback-drawer")).toBeTruthy();

  press(KEY.BACK);
  expect(deckVisible()).toBe(true);
  expect(selectedControl()).toBe("audio");
  advance(4_999);
  expect(deckVisible()).toBe(true);
});

test("finite metadata shows the title, year, rating and quality", () => {
  renderDeck();
  const deck = document.querySelector(".playback-deck");
  expect(deck?.textContent).toContain("The Film");
  expect(deck?.textContent).toContain("2021");
  expect(deck?.textContent).toContain("8.4");
  expect(deck?.textContent).toContain("HD");
  expect(deck?.querySelector('[data-control="guide"]')).toBeNull();
  // The hairline spans the metadata to controls boundary.
  expect(document.querySelector(".deck-hairline")).toBeTruthy();
});

test("Live deck metadata reserves the TV logo placeholder", () => {
  renderDeck({
    metadata: { kind: "live", title: "News Channel", number: 7, logo: "" },
  });

  const placeholder = document.querySelector(".deck-artwork.live.placeholder");
  expect(placeholder?.getAttribute("aria-label")).toBe("News Channel");
  expect(placeholder?.querySelector(".icon-tv")).toBeTruthy();
});

test("Live programme rows and their clock belong only to the trailing Guide card", () => {
  const currentStart = new Date("2026-10-07T12:00:00Z").getTime() / 1000;
  const currentEnd = currentStart + 1800;
  const time = (seconds: number) =>
    new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(
      new Date(seconds * 1000),
    );
  renderDeck({
    snapshot: finiteSnapshot({ seekRange: null }),
    metadata: {
      kind: "live",
      title: "News Channel",
      group: "World news",
      quality: "HD",
      currentProgramme: "News at Noon",
      currentStart,
      currentEnd,
      nextProgramme: "Weather",
    },
    hasGuide: true,
  });

  const panel = document.querySelector(".deck-tail > .deck-programme-panel");
  const copy = panel?.querySelector(".deck-programme-copy");
  const current = copy?.querySelector(".deck-programme-current");
  const now = current?.querySelector(".deck-programme-title");
  const programmeTime = current?.querySelector(".deck-programme-time");
  const next = copy?.querySelector(".deck-programme-next");
  expect(panel?.tagName).toBe("SECTION");
  expect(panel?.getAttribute("aria-label")).toBe("Programme Guide");
  expect(panel?.classList.contains("has-programmes")).toBe(true);
  expect(copy?.children).toHaveLength(2);
  expect(copy?.firstElementChild).toBe(current);
  expect(current?.nextElementSibling).toBe(next);
  /* The current title and its window share one row: only the title is a mapped part, and
     the time is a separate unmapped span that fades in with the rest of the new content. */
  expect(now?.textContent).toBe("News at Noon");
  expect(now?.getAttribute("data-playback-part")).toBe("now");
  expect(now?.getAttribute("data-playback-value")).toBe("News at Noon");
  expect(programmeTime?.textContent).toBe(`${time(currentStart)} - ${time(currentEnd)}`);
  expect(programmeTime?.hasAttribute("data-playback-part")).toBe(false);
  expect(panel?.querySelectorAll("[data-playback-part='now']")).toHaveLength(1);
  expect(next?.textContent).toBe("Weather");
  expect(now?.classList.contains("active")).toBe(true);
  expect(next?.classList.contains("active")).toBe(true);
  expect(copy?.nextElementSibling?.getAttribute("data-control")).toBe("guide");
  const header = document.querySelector(".deck-meta");
  expect(header?.textContent).toContain("World news");
  expect(header?.textContent).toContain("HD");
  expect(header?.textContent).not.toContain("News at Noon");
  expect(header?.textContent).not.toContain("Weather");
  expect(header?.textContent).not.toContain(time(currentStart));
  expect(document.querySelector(".playback-deck")?.getAttribute("data-kind")).toBe("live");
});

test.each([
  {
    currentProgramme: "Headlines",
    nextProgramme: undefined,
    current: "Headlines",
    next: null,
  },
  {
    currentProgramme: undefined,
    nextProgramme: "Weather",
    current: null,
    next: "Weather",
  },
  { currentProgramme: undefined, nextProgramme: undefined, current: null, next: null },
])(
  "the Guide card omits unavailable rows for $current and $next",
  ({ currentProgramme, nextProgramme, current, next }) => {
    renderDeck({
      metadata: { kind: "live", title: "Channel", currentProgramme, nextProgramme },
    });
    const panel = document.querySelector(".deck-programme-panel");
    expect(panel?.querySelector(".deck-programme-title")?.textContent ?? null).toBe(current);
    expect(panel?.querySelector(".deck-programme-next")?.textContent ?? null).toBe(next);
    expect(panel?.classList.contains("has-programmes")).toBe(!!(current || next));
    expect(!!panel?.querySelector(".deck-programme-copy")).toBe(!!(current || next));
    expect(!!panel?.querySelector(".deck-programme-current")).toBe(!!current);
    expect(panel?.querySelectorAll('[data-control="guide"]')).toHaveLength(1);
    expect(panel?.querySelector("[role=status]")).toBeNull();
  },
);

test("a programme window without a current title remains raw in the Guide card", () => {
  const currentStart = new Date("2026-10-07T12:00:00Z").getTime() / 1000;
  renderDeck({
    metadata: { kind: "live", title: "Channel", currentStart, currentEnd: currentStart + 1800 },
  });
  const current = document.querySelector(".deck-programme-current");
  const programmeTime = current?.querySelector(".deck-programme-time");
  expect(programmeTime?.textContent).toContain(" - ");
  expect(programmeTime?.textContent).not.toContain("Now:");
  expect(current?.querySelector(".deck-programme-title")).toBeNull();
  expect(current?.querySelector("[data-playback-part]")).toBeNull();
  expect(document.querySelector(".deck-programme-next")).toBeNull();
  expect(document.querySelector(".deck-meta")?.textContent).toBe("Channel");
});

test.each([
  { width: 100, content: 260, overflowing: true, shift: "-160px" },
  { width: 260, content: 100, overflowing: false, shift: "0px" },
])(
  "programme rows measure overflow at $width with content $content",
  async ({ width, content, overflowing, shift }) => {
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(width);
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(content);
    renderDeck({
      metadata: {
        kind: "live",
        title: "Channel",
        currentProgramme: "Long current title",
        nextProgramme: "Long next title",
      },
    });
    const fields = document.querySelectorAll<HTMLElement>(".deck-programme-copy .teleprompter");
    expect(fields).toHaveLength(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEFAULT_MARQUEE_DWELL_MS - 1);
    });
    for (const field of fields) {
      expect(field.classList.contains("overflowing")).toBe(false);
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(17);
    });
    for (const field of fields) {
      expect(field.classList.contains("active")).toBe(true);
      expect(field.classList.contains("overflowing")).toBe(overflowing);
      expect(field.style.getPropertyValue("--teleprompter-shift")).toBe(shift);
    }
    clientWidth.mockRestore();
    scrollWidth.mockRestore();
  },
);

test("the programme card shares the banner secondary palette and retains Guide sizing", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const style = document.createElement("style");
  style.textContent = styles.replace(/^@import[^;]+;/gm, "");
  document.head.appendChild(style);
  const rules = Array.from(style.sheet!.cssRules);
  style.remove();
  const rule = (selector: string) => {
    const found = rules.find(
      (candidate): candidate is CSSStyleRule =>
        "selectorText" in candidate && candidate.selectorText === selector,
    );
    expect(found, `expected a root rule for ${selector}`).toBeDefined();
    return found!.cssText;
  };
  expect(rule(".pb-meta")).toContain("color: var(--text-2);");
  expect(rule(".deck-context")).toContain("color: var(--text-2);");
  expect(rule(".deck-programme-panel")).toContain("color: var(--text-2);");
  expect(rule(".seekbar-time")).toContain("color: var(--text-2);");
  expect(rule(".deck-programme-panel")).not.toContain("background:");
  expect(rule(".deck-programme-panel")).not.toContain("padding:");
  expect(rule(".deck-programme-panel")).not.toContain("border:");
  expect(rule(".deck-programme-panel.has-programmes")).toContain("width: 560px;");
  expect(rule(".deck-programme-panel.has-programmes")).toContain("padding: var(--s2);");
  expect(rule(".deck-programme-panel.has-programmes")).toContain(
    "border: 1px solid var(--line);",
  );
  expect(rule(".deck-programme-panel.has-programmes")).toContain("border-radius: var(--r-md);");
  expect(rule(".deck-programme-panel.has-programmes")).toContain(
    "background: var(--surface-1);",
  );
  expect(rule(".deck-programme-copy")).toContain("flex-direction: column;");
  expect(rule(".deck-programme-copy")).toContain("gap: 4px;");
  expect(rule(".deck-programme-current")).toContain("display: flex;");
  expect(rule(".deck-programme-title")).toMatch(/flex:\s*1(?: 1 0%)?;/);
  expect(rule(".deck-programme-title")).toMatch(/min-width:\s*0(?:px)?;/);
  expect(rule(".deck-programme-time")).toContain("flex: 0 0 auto;");
  expect(rule(".deck-programme-time")).toContain("white-space: nowrap;");
  expect(rule('.deck-control[data-control="guide"] .icon')).toContain("width: 58px;");
  expect(rule('.deck-control[data-control="guide"] .icon')).toContain("height: 58px;");
  expect(rule('.deck-control[data-control="guide"] .icon')).toContain("padding: 17px;");
  expect(rule(".deck-controls")).toMatch(
    /grid-template-columns: minmax\(0(?:px)?, 1fr\) auto minmax\(0(?:px)?, 1fr\);/,
  );
  expect(styles).toContain(".no-flex-gap .deck-programme-panel > * + *");
  expect(styles).toContain('html[dir="rtl"].no-flex-gap .deck-programme-panel > * + *');
  expect(styles).toContain(".no-flex-gap .deck-programme-copy > * + *");
  expect(styles).toContain('html[dir="rtl"].no-flex-gap .deck-programme-copy > * + *');
  expect(styles).toContain(".no-flex-gap .deck-programme-current > * + *");
  expect(styles).toContain('html[dir="rtl"].no-flex-gap .deck-programme-current > * + *');
});

test("the Guide button survives programme metadata arriving and disappearing", () => {
  const props = renderDeckProps({ metadata: { kind: "live", title: "Channel" } });
  const view = render(<Harness {...props} />);
  const panel = () => view.container.querySelector(".deck-programme-panel");
  const guide = view.container.querySelector<HTMLButtonElement>('[data-control="guide"]');
  expect(panel()?.classList.contains("has-programmes")).toBe(false);
  expect(view.container.querySelector(".deck-programme-copy")).toBeNull();
  expect(guide?.disabled).toBe(true);

  view.rerender(
    <Harness
      {...props}
      hasGuide
      metadata={{
        ...props.metadata,
        currentProgramme: "Headlines",
        nextProgramme: "Weather",
      }}
    />,
  );
  expect(view.container.querySelector('[data-control="guide"]')).toBe(guide);
  expect(panel()?.classList.contains("has-programmes")).toBe(true);
  expect(view.container.querySelector(".deck-programme-title")?.textContent).toBe("Headlines");
  expect(view.container.querySelector(".deck-programme-next")?.textContent).toBe("Weather");
  expect(panel()?.textContent).not.toContain("Now:");
  expect(panel()?.textContent).not.toContain("Next:");
  expect(guide?.disabled).toBe(false);
  expect(selectedControl()).toBe("play-pause");

  view.rerender(<Harness {...props} />);
  expect(view.container.querySelector('[data-control="guide"]')).toBe(guide);
  expect(panel()?.classList.contains("has-programmes")).toBe(false);
  expect(view.container.querySelector(".deck-programme-copy")).toBeNull();
  expect(guide?.disabled).toBe(true);
});

test.each([
  { direction: "ltr", forward: KEY.RIGHT, backward: KEY.LEFT },
  { direction: "rtl", forward: KEY.LEFT, backward: KEY.RIGHT },
])(
  "Live actions follow the trailing card order in $direction",
  ({ direction, forward, backward }) => {
    const locale = useSettings.getState().locale;
    act(() => useSettings.setState({ locale: direction === "rtl" ? "fa" : "en" }));
    try {
      renderDeck(
        {
          snapshot: finiteSnapshot({ seekRange: null }),
          metadata: { kind: "live", title: "Channel" },
          hasGuide: true,
        },
        "next",
      );
      expect(
        Array.from(document.querySelectorAll(".deck-controls [data-control]"), (control) =>
          control.getAttribute("data-control"),
        ),
      ).toEqual(["previous", "play-pause", "next", "audio", "subtitles", "guide"]);
      press(forward);
      expect(selectedControl()).toBe("audio");
      press(forward);
      expect(selectedControl()).toBe("subtitles");
      press(forward);
      expect(selectedControl()).toBe("guide");
      press(forward);
      expect(selectedControl()).toBe("guide");
      press(backward);
      expect(selectedControl()).toBe("subtitles");
    } finally {
      act(() => useSettings.setState({ locale }));
    }
  },
);

test("Guide follows Next directly when no track actions are available", () => {
  renderDeck(
    {
      metadata: { kind: "live", title: "Channel" },
      hasGuide: true,
      hasAudio: false,
      hasSubtitles: false,
    },
    "next",
  );
  press(KEY.RIGHT);
  expect(selectedControl()).toBe("guide");
  press(KEY.LEFT);
  expect(selectedControl()).toBe("next");
});

test("Previous and Next keep their places while disabled", () => {
  const props = renderDeckProps({ previousEnabled: false, nextEnabled: false });
  render(<Harness {...props} initialFocus="previous" />);
  const previous = document.querySelector<HTMLButtonElement>('[data-control="previous"]');
  const next = document.querySelector<HTMLButtonElement>('[data-control="next"]');
  expect(previous?.disabled).toBe(true);
  expect(next?.disabled).toBe(true);

  press(KEY.ENTER);
  fireEvent.click(previous!);
  expect(props.onAction).not.toHaveBeenCalledWith("previous");
});

test("Previous and Next are the only deck icons mirrored by reading direction", () => {
  renderDeck();

  expect(document.querySelector('[data-control="previous"] .icon')?.classList).toContain(
    "icon-logical-direction",
  );
  expect(document.querySelector('[data-control="next"] .icon')?.classList).toContain(
    "icon-logical-direction",
  );
  expect(document.querySelector('[data-control="play-pause"] .icon')?.classList).not.toContain(
    "icon-logical-direction",
  );
  expect(readFileSync("src/styles/app.css", "utf8")).toMatch(
    /html\[dir="rtl"\] \.icon-logical-direction \{[^}]*transform:\s*scaleX\(-1\);/,
  );
});

test.each(["idle", "connecting", "rebuffering", "recovering", "ended"] as const)(
  "Play or Pause follows target capability while playback is %s",
  (phase) => {
    const props = renderDeckProps({
      snapshot: finiteSnapshot({ phase }),
      canPause: true,
    });
    render(<Harness {...props} />);
    const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;

    expect(control.disabled).toBe(false);
    fireEvent.click(control);
    press(KEY.ENTER);
    expect(props.onAction).toHaveBeenCalledTimes(2);
    expect(props.onAction).toHaveBeenCalledWith("play-pause");
  },
);

test("Play or Pause is available for a capable target", () => {
  const props = renderDeckProps({ canPause: true });
  render(<Harness {...props} />);
  const control = document.querySelector<HTMLButtonElement>('[data-control="play-pause"]')!;

  expect(control.disabled).toBe(false);
  fireEvent.click(control);
  expect(props.onAction).toHaveBeenCalledWith("play-pause");
});

test("disabled deck controls stay muted on hover", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");

  expect(styles).toMatch(
    /html\[data-input-mode="pointer"\] \.deck-control:disabled:hover,[\s\S]*opacity: 0\.4;/,
  );
});

test.each(["movie", "episode"] as const)(
  "finite %s controls reflect playback intent while connecting",
  (kind) => {
    renderDeck({
      snapshot: finiteSnapshot({
        phase: "connecting",
        target: { ...finiteSnapshot().target!, kind },
        position: null,
        duration: null,
        seekRange: null,
      }),
      metadata: { kind, title: kind === "movie" ? "The Film" : "The Episode" },
      hasAudio: false,
      hasSubtitles: false,
      canPause: false,
    });
    const control = document.querySelector('[data-control="play-pause"]');
    expect(document.querySelector<HTMLButtonElement>('[data-control="audio"]')?.disabled).toBe(
      true,
    );
    expect(
      document.querySelector<HTMLButtonElement>('[data-control="subtitles"]')?.disabled,
    ).toBe(true);
    expect(control?.getAttribute("aria-label")).toBe("Play or pause");
    expect((control as HTMLButtonElement | null)?.disabled).toBe(true);
    expect(control?.getAttribute("data-selected")).toBeNull();
    expect(control?.querySelector(".icon-play")).toBeNull();
    expect(control?.querySelector(".icon-pause")).toBeTruthy();
    const details = document.querySelector<HTMLButtonElement>('[data-control="details"]');
    expect(details?.tagName).toBe("BUTTON");
    expect(details?.disabled).toBe(false);
    expect(details?.parentElement).toBe(document.querySelector(".deck-lead"));
    expect(document.querySelector(".deck-lead > [role=status]")).toBeTruthy();
  },
);

test.each(["connecting", "rebuffering", "recovering"] as const)(
  "Live %s keeps a disabled programme button separate from loading status",
  (phase) => {
    const props = renderDeckProps({
      snapshot: finiteSnapshot({ phase, seekRange: null }),
      metadata: { kind: "live", title: "Channel" },
      hasGuide: false,
      hasAudio: false,
      hasSubtitles: false,
    });
    const view = render(<Harness {...props} initialFocus="next" />);
    const guide = view.container.querySelector<HTMLButtonElement>('[data-control="guide"]');
    const status = view.container.querySelector(".deck-lead > [role=status]");
    expect(guide?.tagName).toBe("BUTTON");
    expect(guide?.disabled).toBe(true);
    expect(guide?.getAttribute("aria-label")).toBe("Guide");
    expect(status?.classList.contains("loading")).toBe(true);
    expect(status?.getAttribute("aria-label")).toBeTruthy();
    expect(status?.parentElement).toBe(view.container.querySelector(".deck-lead"));
    expect(guide?.closest(".deck-tail")).toBeTruthy();
    expect(guide?.closest(".deck-programme-panel")?.querySelector("[role=status]")).toBeNull();
    expect(guide?.querySelector("[role=status]")).toBeNull();
    expect(status?.closest("button")).toBeNull();
    for (const attribute of ["tabindex", "id", "data-control", "data-selected"]) {
      expect(status?.hasAttribute(attribute)).toBe(false);
    }

    press(KEY.RIGHT);
    expect(selectedControl()).toBe("next");
    document.documentElement.dataset.inputMode = "pointer";
    fireEvent.pointerEnter(guide!);
    fireEvent.click(guide!);
    document.documentElement.dataset.inputMode = "remote";
    expect(selectedControl()).toBe("next");
    expect(props.onAction).not.toHaveBeenCalled();

    view.rerender(<Harness {...props} hasGuide />);
    expect(view.container.querySelector('[data-control="guide"]')).toBe(guide);
    expect(guide?.disabled).toBe(false);
    expect(view.container.querySelector(".deck-lead > [role=status]")).toBe(status);
    expect(selectedControl()).toBe("next");
    press(KEY.RIGHT);
    expect(selectedControl()).toBe("guide");
    expect(guide?.getAttribute("data-selected")).toBe("true");
    press(KEY.ENTER);
    expect(props.onAction).toHaveBeenCalledOnce();
    expect(props.onAction).toHaveBeenCalledWith("guide");
  },
);

test("Guide becomes focused when it is the first enabled control", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ phase: "connecting", seekRange: null }),
    metadata: { kind: "live", title: "Channel" },
    canPause: false,
    hasGuide: false,
    previousEnabled: false,
    nextEnabled: false,
    hasAudio: false,
    hasSubtitles: false,
  });
  const view = render(<Harness {...props} initialFocus="play-pause" />);
  const playPause = view.container.querySelector<HTMLButtonElement>(
    '[data-control="play-pause"]',
  );
  const guide = view.container.querySelector<HTMLButtonElement>('[data-control="guide"]');
  const status = view.container.querySelector(".deck-lead > [role=status]");
  expect(playPause?.disabled).toBe(true);
  expect(guide?.disabled).toBe(true);
  expect(selectedControl()).toBeNull();
  press(KEY.ENTER);
  press(KEY.RIGHT);
  expect(selectedControl()).toBeNull();
  expect(props.onAction).not.toHaveBeenCalled();

  view.rerender(<Harness {...props} hasGuide />);
  expect(view.container.querySelector('[data-control="guide"]')).toBe(guide);
  expect(guide?.disabled).toBe(false);
  expect(playPause?.disabled).toBe(true);
  expect(selectedControl()).toBe("guide");
  expect(document.activeElement).toBe(guide);
  expect(props.onAction).not.toHaveBeenCalled();
  press(KEY.RIGHT);
  expect(selectedControl()).toBe("guide");
  expect(guide?.getAttribute("data-selected")).toBe("true");
  expect(view.container.querySelector(".deck-lead > [role=status]")).toBe(status);
  expect(status?.parentElement).toBe(view.container.querySelector(".deck-lead"));
  expect(guide?.closest(".deck-programme-panel")?.querySelector("[role=status]")).toBeNull();
  expect(status?.closest("button")).toBeNull();
  expect(status?.hasAttribute("data-selected")).toBe(false);
  press(KEY.ENTER);
  expect(props.onAction).toHaveBeenCalledOnce();
  expect(props.onAction).toHaveBeenCalledWith("guide");
});

test.each([
  { phase: "playing", previousEnabled: true, hasAudio: true, expected: "play-pause" },
  { phase: "connecting", previousEnabled: true, hasAudio: true, expected: "play-pause" },
  { phase: "recovering", previousEnabled: false, hasAudio: true, expected: "play-pause" },
  { phase: "connecting", previousEnabled: false, hasAudio: false, expected: "play-pause" },
] as const)(
  "unavailable programme data rehomes Guide focus to $expected during $phase",
  ({ phase, previousEnabled, hasAudio, expected }) => {
    const props = renderDeckProps({
      snapshot: finiteSnapshot({ phase, seekRange: null }),
      metadata: { kind: "live", title: "Channel" },
      hasGuide: true,
      previousEnabled,
      nextEnabled: false,
      hasAudio,
      hasSubtitles: false,
    });
    const view = render(<Harness {...props} initialFocus="guide" />);
    const guide = view.container.querySelector<HTMLButtonElement>('[data-control="guide"]');
    expect(selectedControl()).toBe("guide");
    view.rerender(<Harness {...props} hasGuide={false} />);
    expect(view.container.querySelector('[data-control="guide"]')).toBe(guide);
    expect(guide?.disabled).toBe(true);
    expect(guide?.hasAttribute("data-selected")).toBe(false);
    expect(selectedControl()).toBe(expected);
    document.documentElement.dataset.inputMode = "pointer";
    fireEvent.pointerEnter(guide!);
    fireEvent.click(guide!);
    document.documentElement.dataset.inputMode = "remote";
    expect(selectedControl()).toBe(expected);
    expect(props.onAction).not.toHaveBeenCalled();
    press(KEY.ENTER);
    expect(props.onAction).toHaveBeenCalledOnce();
    expect(props.onAction).toHaveBeenCalledWith(expected);
  },
);

test("Live controls keep their DOM buttons when only the loading phase changes", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ phase: "connecting" }),
    metadata: { kind: "live", title: "Channel" },
    hasGuide: true,
  });
  const view = render(<Harness {...props} initialFocus="guide" />);
  const controls = Array.from(view.container.querySelectorAll(".deck-controls [data-control]"));
  expect(view.container.querySelector('[data-control="go-live"]')).toBeTruthy();
  for (const phase of ["rebuffering", "recovering", "playing", "connecting"] as const) {
    view.rerender(<Harness {...props} snapshot={finiteSnapshot({ phase })} />);
    const updated = Array.from(
      view.container.querySelectorAll(".deck-controls [data-control]"),
    );
    expect(updated).toHaveLength(controls.length);
    updated.forEach((control, index) => {
      expect(control).toBe(controls[index]);
    });
    expect(selectedControl()).toBe("guide");
    expect(!!view.container.querySelector(".deck-live.loading")).toBe(phase !== "playing");
  }
});

test("programme availability changes do not restart the inactivity timer", () => {
  const props = renderDeckProps({
    snapshot: finiteSnapshot({ phase: "connecting", seekRange: null }),
    metadata: { kind: "live", title: "Channel" },
    hasGuide: true,
  });
  const view = render(<Harness {...props} initialFocus="guide" />);
  advance(3_000);
  view.rerender(<Harness {...props} hasGuide={false} />);
  expect(selectedControl()).toBe("play-pause");
  advance(1_000);
  view.rerender(<Harness {...props} hasGuide />);
  expect(selectedControl()).toBe("play-pause");
  advance(3_999);
  expect(deckVisible()).toBe(true);
  advance(1);
  expect(deckVisible()).toBe(false);
  expect(props.onClose).toHaveBeenCalledOnce();
  expect(props.onInteraction).toHaveBeenCalledOnce();
});

test("Audio and Subtitles are the trailing controls without More", () => {
  renderDeck({ hasAudio: true, hasSubtitles: true });
  const tail = document.querySelector(".deck-tail");
  expect(tail?.querySelector('[data-control="audio"]')).toBeTruthy();
  expect(tail?.querySelector('[data-control="subtitles"]')).toBeTruthy();
  expect(tail?.querySelector('[data-control="more"]')).toBeNull();
});

test("remote focus stops on Subtitles after skipping the removed More action", () => {
  renderDeck({ hasAudio: true, hasSubtitles: true });
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.RIGHT);

  expect(selectedControl()).toBe("subtitles");
});

test("seek focus thickens the track and floats the target time", () => {
  renderDeck({}, "seek");
  expect(document.querySelector(".seekbar.focused")).toBeTruthy();
  expect(document.querySelector(".seekbar-target")?.textContent).toBe("1:00");
});

test("finite timing shows elapsed position on the left and duration on the right", () => {
  renderDeck();

  expect(document.querySelector(".seekbar-start")?.textContent).toBe("1:00");
  expect(document.querySelector(".seekbar-end")?.textContent).toBe("5:00");
});

test("a pending finite seek target does not replace the elapsed time", () => {
  renderDeck({}, "seek");
  press(KEY.RIGHT);

  expect(document.querySelector(".seekbar-start")?.textContent).toBe("1:00");
  expect(document.querySelector(".seekbar-target")?.textContent).toBe("1:10");
});

test("paused finite timing keeps the current elapsed position", () => {
  renderDeck({ snapshot: finiteSnapshot({ phase: "paused", position: 75 }) });

  expect(document.querySelector(".seekbar-start")?.textContent).toBe("1:15");
  expect(document.querySelector(".seekbar-end")?.textContent).toBe("5:00");
});

test("Live timing keeps the oldest wall clock label", () => {
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  const range = { startSeconds: 10, endSeconds: 70, liveEdge: false };
  renderDeck({
    snapshot: finiteSnapshot({ position: 60, seekRange: range }),
    metadata: { kind: "live", title: "News Channel" },
  });
  const expected = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(Date.now() - 60_000),
  );

  expect(document.querySelector(".seekbar-start")?.textContent).toBe(expected);
  expect(document.querySelector(".seekbar-end")?.textContent).toBe("−0:10");
});

test("Left and Right adjust the target and commit once input settles", () => {
  const props = renderDeckProps();
  render(<Harness {...props} initialFocus="seek" />);
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  assert.equal(document.querySelector(".seekbar-target")?.textContent, "1:20");
  expect(props.onSeek).toHaveBeenNthCalledWith(1, 70);
  expect(props.onSeek).toHaveBeenNthCalledWith(2, 80);
  advance(400);
  expect(props.onSeek).toHaveBeenCalledTimes(2);

  // The target clamps at the media edges rather than running past them.
  for (let index = 0; index < 40; index += 1) press(KEY.RIGHT);
  advance(400);
  expect(props.onSeek).toHaveBeenLastCalledWith(300);
});

test("held seek accelerates with elapsed time rather than a burst of repeat events", () => {
  const props = renderDeckProps();
  render(<Harness {...props} initialFocus="seek" />);
  act(() => {
    for (let repeat = 0; repeat < 9; repeat += 1) {
      if (repeat) vi.advanceTimersByTime(200);
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        repeat: repeat > 0,
      });
      Object.defineProperty(event, "keyCode", { get: () => KEY.RIGHT });
      window.dispatchEvent(event);
    }
    const release = new KeyboardEvent("keyup", { bubbles: true, cancelable: true });
    Object.defineProperty(release, "keyCode", { get: () => KEY.RIGHT });
    window.dispatchEvent(release);
  });

  expect(document.querySelector(".seekbar-target")?.textContent).toBe("3:10");
  expect(props.onSeek).toHaveBeenLastCalledWith(190);
});

test("pointer seeking clamps through the range and commits like the remote", () => {
  const props = renderDeckProps();
  render(<Harness {...props} />);
  const track = document.querySelector<HTMLElement>(".seekbar-track");
  assert.ok(track);
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
    left: 100,
    width: 800,
    top: 0,
    height: 32,
    right: 900,
    bottom: 32,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  act(() => {
    track.dispatchEvent(
      new (window.PointerEvent ?? MouseEvent)("pointerdown", {
        bubbles: true,
        clientX: 900,
      }),
    );
  });
  advance(400);
  expect(props.onSeek).toHaveBeenCalledWith(300);
  expect(selectedControl()).toBe("seek");
});

test("delayed Live offers Go live one press past the safe edge and restores on Left", () => {
  const snapshot = finiteSnapshot({
    seekRange: { startSeconds: 10, endSeconds: 70, liveEdge: false },
  });
  const props = renderDeckProps({
    snapshot,
    metadata: { kind: "live", title: "News Channel", currentProgramme: "Headlines" },
  });
  render(<Harness {...props} initialFocus="seek" />);
  // The first Right lands at the clamped end, the one after it moves to Go live.
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  expect(selectedControl()).toBe("go-live");
  press(KEY.LEFT);
  expect(selectedControl()).toBe("seek");
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  expect(props.onAction).toHaveBeenCalledWith("go-live");
});

test("ordinary Live shows the badge beside the channel and no seek bar", () => {
  renderDeck({
    snapshot: finiteSnapshot({ seekRange: null }),
    metadata: { kind: "live", title: "News Channel" },
    hasGuide: true,
  });
  expect(document.querySelector(".deck-live")?.getAttribute("aria-label")).toBe("Live");
  expect(document.querySelector(".seekbar.disabled")).toBeTruthy();
  expect(document.querySelector('[data-control="guide"]')).toBeTruthy();
  expect(document.querySelector('[data-control="previous"]')).toBeTruthy();
});

test("quick seek shows the accumulated direction and the target clock", () => {
  render(<QuickSeek state={{ deltaSeconds: 30, targetSeconds: 95 }} />);
  const indicator = document.querySelector(".quick-seek");
  expect(indicator?.textContent).toContain("+30 s");
  expect(indicator?.textContent).toContain("1:35");
});

test("new deck styles keep the caption floor and share the motion tokens", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const section = styles.slice(
    styles.lastIndexOf(".playback-deck {"),
    styles.indexOf(".vod-screen {"),
  );
  const sizes = [...section.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
  assert.deepEqual(sizes, [], `deck text below the caption floor: ${sizes.join(", ")}`);
  // Motion is expressed only through the shared tokens, which reduced motion already zeroes.
  const transitions = [...section.matchAll(/transition:[^;]+/g)].map((m) => m[0]);
  for (const rule of transitions) {
    expect(rule.includes("var(--t-fast)") || rule.includes("var(--t-panel)")).toBe(true);
  }
});

test("banner expansion fades only genuinely new content and settles under reduced motion", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  /* The root does not take the ordinary entrance when a measured origin exists. */
  expect(styles).toMatch(/\.playback-deck\[data-entrance="banner"\] \{[^}]*animation:\s*none/);
  /* The fade is per child on the shared token, with the stagger inside the keyframes
     rather than a fixed delay so a zero duration still settles immediately. */
  expect(styles).toMatch(
    /\.playback-deck\[data-entrance="banner"\] \.deck-programme-time,[\s\S]*?animation:\s*deck-content-in var\(--t-playback-expand\) linear backwards;/,
  );
  expect(styles).toMatch(
    /\.playback-deck\[data-entrance="banner"\] \.deck-programme-panel\.has-programmes::before,[\s\S]*?animation:\s*deck-content-in var\(--t-playback-expand\) linear backwards;/,
  );
  expect(styles).not.toMatch(/animation:\s*deck-content-in[^;]*\d+ms/);
  expect(styles).toMatch(
    /@keyframes deck-content-in \{[^}]*from,[\s\S]*?20%[\s\S]*?opacity:\s*0/,
  );
  expect(styles).not.toContain("@keyframes deck-expand");
  expect(styles).toMatch(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.playback-deck\[data-entrance="banner"\][\s\S]*animation:\s*none/,
  );
});

const expansionOriginFor = (title: string): PlaybackExpansionOrigin => ({
  targetKey: "ch-1",
  bounds: { top: 600, right: 448, bottom: 720, left: 48, width: 400, height: 120 },
  parts: {
    title: {
      rect: { top: 610, right: 580, bottom: 650, left: 330, width: 250, height: 40 },
      fontSize: 30,
      value: title,
    },
  },
});

interface ExpansionProbe {
  calls: Array<{
    el: Element;
    animation: { cancel: ReturnType<typeof vi.fn> };
  }>;
  restore(): void;
}

/*
 * Controlled geometry and a recording Element.animate, so the deck's expansion can be
 * observed without a layout engine. Everything installed here is undone by restore.
 */
const stubExpansion = (): ExpansionProbe => {
  const probe: ExpansionProbe = {
    calls: [],
    restore: () => {},
  };
  const animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  Element.prototype.animate = function () {
    const animation = { cancel: vi.fn(), onfinish: null, oncancel: null };
    probe.calls.push({ el: this, animation });
    return animation as unknown as Animation;
  };
  const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 0,
    left: 0,
    right: 1600,
    bottom: 240,
    width: 1600,
    height: 240,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  document.documentElement.style.setProperty("--t-playback-expand", "420ms");
  probe.restore = () => {
    if (animateDescriptor) {
      Object.defineProperty(Element.prototype, "animate", animateDescriptor);
    } else {
      Reflect.deleteProperty(Element.prototype, "animate");
    }
    rectSpy.mockRestore();
    document.documentElement.style.removeProperty("--t-playback-expand");
  };
  return probe;
};

test("clock rerenders leave the expansion alone while metadata changes cancel it", () => {
  const probe = stubExpansion();
  try {
    const props = renderDeckProps({
      entrance: "banner",
      expansionOrigin: expansionOriginFor("The Film"),
      targetKey: "ch-1",
    });
    const view = render(<Harness {...props} />);
    const created = probe.calls.length;
    expect(created).toBeGreaterThan(0);

    /* Keys answer at once while the motion is still running: it is decoration, not a
       gate on input or focus. */
    press(KEY.RIGHT);
    expect(selectedControl()).toBe("next");

    /* A clock tick changes the snapshot but not what is on: the motion is untouched. */
    view.rerender(<Harness {...props} snapshot={finiteSnapshot({ position: 61 })} />);
    expect(probe.calls).toHaveLength(created);
    expect(probe.calls.every((call) => call.animation.cancel.mock.calls.length === 0)).toBe(
      true,
    );

    /* New metadata cancels the group and the consumed origin does not replay. */
    view.rerender(
      <Harness {...props} metadata={{ ...props.metadata, title: "Another Film" }} />,
    );
    expect(probe.calls).toHaveLength(created);
    expect(probe.calls.every((call) => call.animation.cancel.mock.calls.length >= 1)).toBe(
      true,
    );
  } finally {
    probe.restore();
  }
});

test("a locale change cancels an in-flight expansion without replaying it", () => {
  const probe = stubExpansion();
  const locale = useSettings.getState().locale;
  try {
    renderDeck({
      entrance: "banner",
      expansionOrigin: expansionOriginFor("The Film"),
      targetKey: "ch-1",
    });
    const created = probe.calls.length;
    expect(created).toBeGreaterThan(0);

    act(() => useSettings.setState({ locale: "de" }));

    expect(probe.calls).toHaveLength(created);
    expect(probe.calls.every((call) => call.animation.cancel.mock.calls.length >= 1)).toBe(
      true,
    );
  } finally {
    act(() => useSettings.setState({ locale }));
    probe.restore();
  }
});

test("does not read playback diagnostics while the overlay is hidden", () => {
  const read = vi.fn(() => ({ engine: "AVPlay" as const, switches: 0 }));
  const view = render(<PlaybackInfo read={read} visible={false} />);

  expect(read).not.toHaveBeenCalled();
  view.rerender(<PlaybackInfo read={read} visible />);
  expect(read).not.toHaveBeenCalled();
  advance(400);
  expect(read).toHaveBeenCalledTimes(1);
  view.rerender(<PlaybackInfo read={read} visible={false} />);
  advance(2000);
  expect(read).toHaveBeenCalledTimes(1);
});

test("shows the reported dynamic range without guessing a PQ format", () => {
  render(
    <PlaybackInfo
      read={() => ({ engine: "AVPlay", dynamicRange: "PQ", switches: 0 })}
      visible
    />,
  );
  advance(400);
  const label = Array.from(document.querySelectorAll("dt")).find(
    (item) => item.textContent === "Dynamic range",
  );
  expect(label?.nextElementSibling?.textContent).toBe("PQ (HDR)");
});

test("exposes a stable sanitised recovery cause diagnostic", () => {
  const target = "http://viewer:secret@example.invalid/live/channel.m3u8";
  render(<PlaybackInfo read={() => null} recovery={{ cause: "engine-network", attempt: 2 }} />);
  const diagnostics = document.querySelector("[data-recovery-cause]");
  expect(diagnostics?.getAttribute("data-recovery-cause")).toBe("engine-network");
  expect(diagnostics?.textContent).toContain("A network fault interrupted playback");
  expect(diagnostics?.textContent).not.toContain(target);
  expect(diagnostics?.textContent).not.toContain("secret");
});

/*
 * The hint row is a caption, not a control. It gives fixed horizontal directions for
 * controls and vertical directions for the current focus, with no added focus stops.
 */
const deckHints = () =>
  Array.from(document.querySelectorAll(".playback-deck .deck-hints > span")).map((item) => ({
    keys: Array.from(item.querySelectorAll("kbd")).map((key) => key.textContent),
    text: item.textContent ?? "",
  }));

test("finite hints keep fixed control arrows and context specific dismissal hints", () => {
  const view = renderDeck({}, "play-pause");
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192", "\u2191"], text: "\u2190\u2192\u2191Move" },
    { keys: ["OK"], text: "OKSelect" },
    { keys: ["\u2193", "Return"], text: "\u2193ReturnClose" },
  ]);

  /* Down moves into the controls, OK belongs to a focused action, and Up closes here. */
  press(KEY.UP);
  expect(selectedControl()).toBe("seek");
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192"], text: "\u2190\u2192Seek" },
    { keys: ["\u2193"], text: "\u2193Move" },
    { keys: ["\u2191", "Return"], text: "\u2191ReturnClose" },
  ]);
  view.unmount();

  /* An unavailable action returns focus to Play or Pause. */
  renderDeck({ previousEnabled: false }, "previous");
  expect(selectedControl()).toBe("play-pause");
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192", "\u2191"], text: "\u2190\u2192\u2191Move" },
    { keys: ["OK"], text: "OKSelect" },
    { keys: ["\u2193", "Return"], text: "\u2193ReturnClose" },
  ]);
});

test.each([
  ["previous", { previousEnabled: false, nextEnabled: true }],
  ["next", { previousEnabled: true, nextEnabled: false }],
] as const)("control focus %s keeps both horizontal Move arrows", (focus, availability) => {
  renderDeck(availability, focus);
  expect(deckHints()[0]).toEqual({
    keys: ["\u2190", "\u2192", "\u2191"],
    text: "\u2190\u2192\u2191Move",
  });
});

test("a Live channel without a DVR window offers no seek hints", () => {
  renderDeck(
    {
      snapshot: finiteSnapshot({ seekRange: null }),
      metadata: { kind: "live", title: "Channel" },
      hasGuide: true,
    },
    "play-pause",
  );
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192"], text: "\u2190\u2192Move" },
    { keys: ["OK"], text: "OKSelect" },
    { keys: ["\u2191", "\u2193", "Return"], text: "\u2191\u2193ReturnClose" },
  ]);
});

/*
 * Removed actions return focus to an enabled control.
 */
test("a removed Go live action restores Play or Pause focus and its Select hint", () => {
  renderDeck(
    {
      snapshot: finiteSnapshot({ seekRange: null }),
      metadata: { kind: "live", title: "News Channel" },
      hasGuide: true,
    },
    "go-live",
  );
  expect(selectedControl()).toBe("play-pause");
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192"], text: "\u2190\u2192Move" },
    { keys: ["OK"], text: "OKSelect" },
    { keys: ["\u2191", "\u2193", "Return"], text: "\u2191\u2193ReturnClose" },
  ]);
});

test("delayed Live hints cover the seek window and the Go live focus", () => {
  renderDeck(
    {
      snapshot: finiteSnapshot({
        seekRange: { startSeconds: 10, endSeconds: 70, liveEdge: false },
      }),
      metadata: { kind: "live", title: "News Channel" },
      hasGuide: true,
    },
    "seek",
  );
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192"], text: "\u2190\u2192Seek" },
    { keys: ["\u2193"], text: "\u2193Move" },
    { keys: ["\u2191", "Return"], text: "\u2191ReturnClose" },
  ]);

  press(KEY.DOWN);
  expect(selectedControl()).toBe("play-pause");
  press(KEY.LEFT);
  expect(selectedControl()).toBe("previous");
  press(KEY.LEFT);
  expect(selectedControl()).toBe("go-live");
  expect(deckHints()).toEqual([
    { keys: ["\u2190", "\u2192", "\u2191"], text: "\u2190\u2192\u2191Move" },
    { keys: ["OK"], text: "OKSelect" },
    { keys: ["\u2193", "Return"], text: "\u2193ReturnClose" },
  ]);
});

test.each(["episode", "catchup"] as const)(
  "%s playback shows the same finite hint contract as a movie",
  (kind) => {
    renderDeck(
      {
        snapshot: finiteSnapshot({
          target: { ...finiteSnapshot().target!, kind },
        }),
        metadata: { kind, title: kind === "episode" ? "The Episode" : "Catchup" },
      },
      "play-pause",
    );
    expect(document.querySelector('[data-control="details"]')).toBeTruthy();
    expect(deckHints()).toEqual([
      { keys: ["\u2190", "\u2192", "\u2191"], text: "\u2190\u2192\u2191Move" },
      { keys: ["OK"], text: "OKSelect" },
      { keys: ["\u2193", "Return"], text: "\u2193ReturnClose" },
    ]);
  },
);

test("hint arrows follow the reading direction", () => {
  const locale = useSettings.getState().locale;
  act(() => useSettings.setState({ locale: "fa" }));
  try {
    renderDeck({}, "play-pause");
    expect(deckHints()).toEqual([
      {
        keys: ["\u2192", "\u2190", "\u2191"],
        text: `\u2192\u2190\u2191${translate("fa", "common.move")}`,
      },
      { keys: ["OK"], text: `OK${translate("fa", "common.select")}` },
      { keys: ["\u2193", "Return"], text: `\u2193Return${translate("fa", "common.close")}` },
    ]);

    press(KEY.UP);
    expect(selectedControl()).toBe("seek");
    expect(deckHints()).toEqual([
      { keys: ["\u2192", "\u2190"], text: `\u2192\u2190${translate("fa", "deck.seek")}` },
      { keys: ["\u2193"], text: `\u2193${translate("fa", "common.move")}` },
      { keys: ["\u2191", "Return"], text: `\u2191Return${translate("fa", "common.close")}` },
    ]);
  } finally {
    act(() => useSettings.setState({ locale }));
  }
});

test("deck hints are presentational and add no focus stops", () => {
  renderDeck({}, "play-pause");
  const hints = document.querySelector(".playback-deck .deck-hints");
  expect(hints).toBeTruthy();
  expect(
    hints?.querySelectorAll("button, a, input, select, textarea, [tabindex]"),
  ).toHaveLength(0);
});

test("Details restores native focus on mount and on navigation to its action", () => {
  const first = renderDeck({}, "details");
  expect(document.activeElement?.getAttribute("data-control")).toBe("details");
  first.unmount();

  renderDeck({}, "play-pause");
  const details = document.querySelector<HTMLButtonElement>('[data-control="details"]')!;
  expect(document.activeElement).not.toBe(details);
  press(KEY.LEFT);
  press(KEY.LEFT);
  expect(selectedControl()).toBe("details");
  expect(document.activeElement).toBe(details);
  press(KEY.RIGHT);
  expect(selectedControl()).not.toBe("details");
  expect(document.activeElement?.getAttribute("data-control")).toBe(selectedControl());
});

test("a suspended deck keeps outside focus until its input ownership returns", () => {
  const outside = document.createElement("button");
  document.body.appendChild(outside);
  outside.focus();
  const props = renderDeckProps({ inputEnabled: false });
  const view = render(<Harness {...props} initialFocus="details" />);
  expect(document.activeElement).toBe(outside);
  view.rerender(<Harness {...props} inputEnabled initialFocus="details" />);
  expect(document.activeElement?.getAttribute("data-control")).toBe("details");
});

test("Enter on the focused Details action fires once and is claimed by the deck", () => {
  const props = renderDeckProps();
  render(<Harness {...props} initialFocus="details" />);
  expect(document.activeElement?.getAttribute("data-control")).toBe("details");

  const event = pressEvent(KEY.ENTER);
  expect(event.defaultPrevented).toBe(true);
  expect(props.onAction).toHaveBeenCalledTimes(1);
  expect(props.onAction).toHaveBeenCalledWith("details");
});

test("a disabled deck ignores window keys and never arms its close timer", () => {
  const props = renderDeckProps({ inputEnabled: false });
  render(<Harness {...props} />);
  for (const code of [KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER, KEY.BACK, KEY.ESC]) {
    const event = pressEvent(code);
    expect(event.defaultPrevented).toBe(false);
  }
  expect(props.onInteraction).not.toHaveBeenCalled();
  expect(props.onAction).not.toHaveBeenCalled();
  expect(props.onClose).not.toHaveBeenCalled();
  advance(10_000);
  expect(deckVisible()).toBe(true);
  expect(props.onClose).not.toHaveBeenCalled();
});
