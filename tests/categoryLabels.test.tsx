import { readFileSync } from "node:fs";
import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Sidebar } from "../src/components/Sidebar";
import { DEFAULT_MARQUEE_DWELL_MS, Text } from "../src/components/Text";
import { VodCategoryRail } from "../src/components/vod/VodCategoryRail";

const names = [
  "IRIB National Networks | شبکه‌های سراسری سیما",
  "شبکه‌های خبری بین‌المللی | International news networks",
  "News",
];
const appCss = readFileSync("src/styles/app.css", "utf8");
let style: HTMLStyleElement;
let previousInputMode: string | null;

beforeEach(() => {
  previousInputMode = document.documentElement.getAttribute("data-input-mode");
  document.documentElement.setAttribute("data-input-mode", "remote");
  style = document.createElement("style");
  style.textContent = appCss.replace('@import "./tokens.css";', "");
  document.head.append(style);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (this.textContent?.length ?? 0) > 20 ? 260 : 60;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  style.remove();
  vi.restoreAllMocks();
  if (previousInputMode === null) {
    document.documentElement.removeAttribute("data-input-mode");
  } else {
    document.documentElement.setAttribute("data-input-mode", previousInputMode);
  }
});

const liveProps: ComponentProps<typeof Sidebar> = {
  categories: names.map((name, index) => ({
    key: String(index),
    name,
    count: 12,
    hidden: false,
  })),
  selected: 0,
  cursor: 1,
  loading: false,
  allHidden: false,
  focused: false,
  scale: 1,
  onFocus: () => {},
  onSelect: () => {},
  onWheel: () => {},
};

const vodProps: ComponentProps<typeof VodCategoryRail> = {
  items: names.map((name, index) => ({
    key: String(index),
    source: "provider",
    name,
  })),
  selectedKey: "0",
  cursor: 0,
  focused: false,
  scale: 1,
  onFocus: () => {},
  onSelect: () => {},
};

const renderers = [
  {
    name: "Live TV",
    selectedClass: "showing",
    countSuffix: " 12",
    deferred: true,
    pointerDeferred: true,
    draw: (cursor: number, focused: boolean) => (
      <Sidebar {...liveProps} cursor={cursor + 1} focused={focused} />
    ),
  },
  {
    name: "Movies and Series",
    selectedClass: "selected",
    countSuffix: "",
    deferred: true,
    pointerDeferred: false,
    draw: (cursor: number, focused: boolean) => (
      <VodCategoryRail {...vodProps} cursor={cursor} focused={focused} />
    ),
  },
];

function labelOf(row: HTMLElement): HTMLElement {
  const label = row.querySelector<HTMLElement>(".teleprompter");
  if (!label) throw new Error("The category must render the real Text teleprompter.");
  return label;
}

function runOf(row: HTMLElement): HTMLElement {
  const run = labelOf(row).querySelector<HTMLElement>(".teleprompter-run");
  if (!run) throw new Error("The category must retain its full text run.");
  return run;
}

// jsdom exposes declarations but does not paint ellipsis or execute animations.
// Native verification must cover RTL travel, pointer hover and reduced motion.
function expectEllipsis(row: HTMLElement) {
  const labelStyle = getComputedStyle(labelOf(row));
  expect(labelStyle.whiteSpace).toBe("nowrap");
  expect(labelStyle.overflow).toBe("hidden");
  expect(labelStyle.textOverflow).toBe("ellipsis");
  const run = labelOf(row).querySelector<HTMLElement>(".teleprompter-run");
  if (!run) return;
  const runStyle = getComputedStyle(run);
  expect(runStyle.maxWidth).toBe("100%");
  expect(runStyle.overflow).toBe("hidden");
  expect(runStyle.textOverflow).toBe("ellipsis");
  expect(["", "none"]).toContain(runStyle.animation);
  expect(["", "none"]).toContain(runStyle.transform);
}

function expectScrolling(row: HTMLElement) {
  expect(getComputedStyle(labelOf(row)).overflow).toBe("hidden");
  const runStyle = getComputedStyle(runOf(row));
  expect(runStyle.maxWidth).toBe("none");
  expect(runStyle.overflow).toBe("visible");
  expect(labelOf(row).style.getPropertyValue("--teleprompter-duration")).toBe(`${160 / 36}s`);
  expect(runStyle.animationName).toBe(
    labelOf(row).classList.contains("vertical") ? "teleprompter-y" : "teleprompter-x",
  );
  expect(runStyle.animationIterationCount).toBe("1");
  expect(runStyle.animationFillMode).toBe("both");
}

test.each([
  { className: "row-label", display: "inline-block", whiteSpace: "nowrap" },
  { className: "poster-title", display: "inline-block", whiteSpace: "nowrap" },
  { className: "guide-description", display: "inline-block", whiteSpace: "nowrap" },
])(
  "$className keeps the same clamped layout through transient focus",
  async ({ className, display, whiteSpace }) => {
    vi.useFakeTimers();
    const view = render(<Text value={names[1]} className={className} marquee active={false} />);
    const label = labelOf(view.container);
    const run = runOf(view.container);
    const labelStyle = getComputedStyle(label);
    const layout = () => {
      const css = getComputedStyle(run);
      return {
        display: css.display,
        minWidth: css.minWidth,
        maxWidth: css.maxWidth,
        overflow: css.overflow,
        textOverflow: css.textOverflow,
        whiteSpace: css.whiteSpace,
        verticalAlign: css.verticalAlign,
      };
    };
    const before = layout();
    const reads = (["scrollWidth", "scrollHeight"] as const).map((property) =>
      vi.spyOn(HTMLElement.prototype, property, "get").mockClear(),
    );

    view.rerender(<Text value={names[1]} className={className} marquee active />);
    await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
    expect(layout()).toEqual(before);
    expect(before).toEqual({
      display,
      minWidth: "100%",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace,
      verticalAlign: "top",
    });
    for (const read of reads) expect(read).not.toHaveBeenCalled();

    view.rerender(<Text value={names[1]} className={className} marquee active={false} />);
    await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
    expect(runOf(view.container)).toBe(run);
    expect(layout()).toEqual(before);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(labelStyle.overflow).toBe("hidden");
    expect(labelStyle.textOverflow).toBe("ellipsis");
    expect(labelStyle.whiteSpace).toBe("nowrap");
    expect(label.textContent).toBe(names[1]);
    expect(label.getAttribute("dir")).toBeNull();
  },
);

test("vertical labels retain their inactive inline flow", () => {
  const draw = (active: boolean) => (
    <Text value={names[1]} className="two-line" marquee active={active} />
  );
  const view = render(draw(false));
  const run = runOf(view.container);
  expect(getComputedStyle(run).display).toBe("inline");
  expect(getComputedStyle(run).whiteSpace).toBe("nowrap");

  view.rerender(draw(true));
  expect(getComputedStyle(run).display).toBe("block");
  expect(getComputedStyle(run).whiteSpace).toBe("normal");

  view.rerender(draw(false));
  expect(runOf(view.container)).toBe(run);
  expect(getComputedStyle(run).display).toBe("inline");
  expect(getComputedStyle(run).whiteSpace).toBe("nowrap");
});

test.each([
  {
    name: "poster",
    className: "poster-title",
    scope: "",
    owner: "poster-card cursor",
    controlled: true,
  },
  {
    name: "Guide",
    className: "row-label",
    scope: "guide-list",
    owner: "guide-row cursor",
    controlled: false,
  },
  {
    name: "vertical",
    className: "two-line",
    scope: "pane",
    owner: "row cursor",
    controlled: false,
  },
])(
  "$name labels release the clamp only while measured scrolling is active",
  async ({ className, scope, owner, controlled }) => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(660);
    const draw = (focused: boolean) => (
      <div className={`${scope} ${focused ? "focused" : ""}`}>
        <div className={focused ? owner : ""}>
          <Text
            value={names[0]}
            className={className}
            marquee
            active={controlled ? focused : undefined}
          />
        </div>
      </div>
    );
    const view = render(draw(true));
    await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
    await act(async () => vi.advanceTimersByTime(32));
    expectScrolling(view.container);

    view.rerender(draw(false));
    await act(async () => {});
    expectEllipsis(view.container);
  },
);

test.each(renderers)(
  "$name category labels preserve full names and scroll only the remote cursor",
  async ({ draw, selectedClass, countSuffix, deferred }) => {
    vi.useFakeTimers();
    const settle = async () => {
      await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
      await act(async () => vi.advanceTimersByTime(32));
    };
    const view = render(draw(0, false));
    await settle();
    const rows = names.map((name) =>
      view.getByRole("button", { name: `${name}${countSuffix}`, exact: true }),
    );

    for (const [index, row] of rows.entries()) {
      const label = labelOf(row);
      expect(label.textContent).toBe(names[index]);
      expect(label.getAttribute("dir")).toBeNull();
      expect(label.classList.contains("two-line")).toBe(false);
      expect(label.classList.contains("vertical")).toBe(false);
      expect(label.classList.contains("active")).toBe(false);
      expect(label.classList.contains("overflowing")).toBe(!deferred && index < 2);
      expect(label.style.getPropertyValue("--teleprompter-shift")).toBe(
        deferred ? "" : ["-160px", "160px", "0px"][index],
      );
      expectEllipsis(row);
    }

    view.rerender(draw(0, true));
    await settle();
    expectScrolling(rows[0]);
    expectEllipsis(rows[1]);
    expectEllipsis(rows[2]);

    view.rerender(draw(1, true));
    await settle();
    expect(rows[0].classList.contains(selectedClass)).toBe(true);
    expect(rows[0].classList.contains("cursor")).toBe(false);
    expect(rows[1].classList.contains("cursor")).toBe(true);
    expect(rows[1].classList.contains(selectedClass)).toBe(false);
    expectEllipsis(rows[0]);
    expectScrolling(rows[1]);

    view.rerender(draw(1, false));
    for (const row of rows) expectEllipsis(row);

    view.rerender(draw(2, true));
    await settle();
    expect(rows[2].classList.contains("cursor")).toBe(true);
    for (const row of rows) expectEllipsis(row);
  },
);

test.each(renderers)(
  "$name remote cursor does not animate in pointer mode",
  async ({ draw, countSuffix, pointerDeferred }) => {
    document.documentElement.setAttribute("data-input-mode", "pointer");
    const view = render(draw(0, true));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const row = view.getByRole("button", { name: `${names[0]}${countSuffix}`, exact: true });
    expect(row.classList.contains("cursor")).toBe(true);
    expect(labelOf(row).classList.contains("overflowing")).toBe(!pointerDeferred);
    expectEllipsis(row);
  },
);

test("Live pointer hover prepares only its own label and leaving cancels its marquee", async () => {
  vi.useFakeTimers();
  document.documentElement.setAttribute("data-input-mode", "pointer");
  const view = render(<Sidebar {...liveProps} cursor={1} focused={false} />);
  const row = view.getByRole("button", { name: `${names[0]} 12`, exact: true });
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
  expect(width).not.toHaveBeenCalled();
  fireEvent.pointerEnter(row);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
  expect(width).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(33));
  expect(labelOf(row).classList.contains("overflowing")).toBe(true);
  await act(async () => document.documentElement.setAttribute("data-input-mode", "remote"));
  expect(labelOf(row).classList.contains("active")).toBe(false);
  expect(labelOf(row).classList.contains("overflowing")).toBe(false);
  await act(async () => document.documentElement.setAttribute("data-input-mode", "pointer"));
  fireEvent.pointerLeave(row);
  expect(labelOf(row).classList.contains("active")).toBe(false);
  expect(labelOf(row).classList.contains("overflowing")).toBe(false);
  expectEllipsis(row);
});
