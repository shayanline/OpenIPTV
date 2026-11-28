import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { type ReactElement, useRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_MARQUEE_DWELL_MS, DEFAULT_MARQUEE_SPEED, Text } from "../src/components/Text";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useRef: vi.fn(actual.useRef) };
});

const mockWidths = (client: number, scroll: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter") ? client : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter-run") ? scroll : 0;
  });
};

const outer = (container: HTMLElement) => container.querySelector<HTMLElement>(".teleprompter");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("the marquee speed defaults to 36 pixels a second", () => {
  expect(DEFAULT_MARQUEE_SPEED).toBe(36);
});

test.each(["ltr", "rtl"])(
  "%s app direction owns plain and scrolling text regardless of the provider script",
  (direction) => {
    const { container } = render(
      <div dir={direction}>
        <Text value="English" />
        <Text value="فارسی" />
        <Text value="English" marquee />
        <Text value="فارسی" marquee />
      </div>,
    );
    for (const node of container.querySelectorAll("span")) {
      expect(node.getAttribute("dir")).toBeNull();
      expect(node.closest("[dir]")?.getAttribute("dir")).toBe(direction);
    }
  },
);

test.each([false, true])(
  "parent updates skip unchanged label render work when marquee is %s",
  (marquee) => {
    const refs = vi.mocked(useRef).mockClear();
    const view = render(
      <div className="row">
        <Text value="Channel name" marquee={marquee} active={false} />
      </div>,
    );
    // Hook calls expose render work even when React would reuse the same DOM.
    const initialWork = refs.mock.calls.length;
    expect(initialWork).toBeGreaterThan(0);

    view.rerender(
      <div className="row cursor">
        <Text value="Channel name" marquee={marquee} active={false} />
      </div>,
    );
    expect(view.container.firstElementChild?.className).toBe("row cursor");
    expect(refs).toHaveBeenCalledTimes(initialWork);

    view.rerender(
      <div className="row cursor">
        <Text value="Updated channel name" marquee={marquee} active={false} />
      </div>,
    );
    expect(refs.mock.calls.length).toBeGreaterThan(initialWork);
    expect(view.container.textContent).toBe("Updated channel name");
  },
);

test("an overflow of 360 pixels scrolls for ten seconds at the default speed", async () => {
  mockWidths(100, 460);
  const { container } = await renderMeasured(<Text value="A very long channel name" marquee />);
  expect(outer(container)?.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
  expect(outer(container)?.style.getPropertyValue("--teleprompter-duration")).toBe("10s");
});

test("an overflow of 720 pixels scrolls for twenty seconds at the default speed", async () => {
  mockWidths(100, 820);
  const { container } = await renderMeasured(<Text value="A very long channel name" marquee />);
  expect(outer(container)?.style.getPropertyValue("--teleprompter-shift")).toBe("-720px");
  expect(outer(container)?.style.getPropertyValue("--teleprompter-duration")).toBe("20s");
});

test("marqueeSpeed overrides the default", async () => {
  mockWidths(100, 460);
  const { container } = await renderMeasured(
    <Text value="A very long channel name" marquee marqueeSpeed={72} />,
  );
  expect(outer(container)?.style.getPropertyValue("--teleprompter-duration")).toBe("5s");
});

test.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
  "an invalid marqueeSpeed of %s falls back to the default",
  async (speed) => {
    mockWidths(100, 460);
    const { container } = await renderMeasured(
      <Text value="A very long channel name" marquee marqueeSpeed={speed} />,
    );
    expect(outer(container)?.style.getPropertyValue("--teleprompter-duration")).toBe("10s");
  },
);

test("text that fits does not overflow or move", async () => {
  mockWidths(100, 100);
  const { container } = await renderMeasured(<Text value="Short" marquee />);
  expect(outer(container)?.classList.contains("overflowing")).toBe(false);
  expect(outer(container)?.style.getPropertyValue("--teleprompter-shift")).toBe("0px");
});

const mockHeights = (client: number, scroll: number) => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter") ? client : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter-run") ? scroll : 0;
  });
};

const inner = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".teleprompter-run")!;

const phase = (run: HTMLElement) => run.style.getPropertyValue("--teleprompter-animation");

const legEnd = (run: HTMLElement, name: string) => {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  run.dispatchEvent(event);
};

const stubLegName = (state: { active: boolean }) => {
  const realGCS = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation(((
    element: Element,
    pseudo?: string | null,
  ) => {
    const styles = realGCS(element, pseudo ?? undefined);
    if (element instanceof HTMLElement && element.classList.contains("teleprompter-run")) {
      return new Proxy(styles, {
        get(target, property, receiver) {
          if (property === "animationName") {
            if (!state.active) return "none";
            const host = element.closest(".teleprompter");
            const axis = host?.classList.contains("vertical")
              ? "teleprompter-y"
              : "teleprompter-x";
            return element.style.getPropertyValue("--teleprompter-animation") || axis;
          }
          return Reflect.get(target, property, receiver);
        },
      });
    }
    return styles;
  }) as typeof window.getComputedStyle);
};

const flushFrame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

const renderMeasured = async (element: ReactElement) => {
  const view = render(element);
  await flushFrame();
  await flushFrame();
  return view;
};

test("the dwell before each leg is 1200 milliseconds", async () => {
  expect(DEFAULT_MARQUEE_DWELL_MS).toBe(1200);
  mockWidths(100, 460);
  const { container } = await renderMeasured(<Text value="A very long channel name" marquee />);
  expect(outer(container)?.style.getPropertyValue("--teleprompter-dwell")).toBe("1200ms");
});

test("the stylesheet runs each marquee leg once with a shared dwell and fill", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const legs = styles.match(
    /animation:\s*var\(--teleprompter-animation\)\s+var\(--teleprompter-duration\)\s+linear\s+var\(--teleprompter-dwell\)\s+1 both;/g,
  );
  expect(legs).toHaveLength(3);
  expect(styles).toContain("@keyframes teleprompter-x-back");
  expect(styles).toContain("@keyframes teleprompter-y-back");
  expect(styles).not.toContain("linear 1.2s infinite alternate");
  expect(styles).toContain("--teleprompter-animation: teleprompter-x;");
  expect(styles).toContain("--teleprompter-animation: teleprompter-y;");
  expect(styles).toMatch(
    /\.teleprompter \.teleprompter-run(?:,[^{]*)? \{[^}]*animation: none !important;[^}]*transform: none !important;/,
  );
});

test("each completed leg swaps to its counterpart and back", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  const { container } = await renderMeasured(<Text value="A very long channel name" marquee />);
  const run = inner(container);
  expect(phase(run)).toBe("teleprompter-x");

  legEnd(run, "teleprompter-y");
  expect(phase(run)).toBe("teleprompter-x");
  legEnd(run, "teleprompter-x-back");
  expect(phase(run)).toBe("teleprompter-x");

  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");
  legEnd(run, "teleprompter-x-back");
  expect(phase(run)).toBe("teleprompter-x");
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");
});

test("an unrelated rerender keeps a running reverse phase", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  const { container, rerender } = await renderMeasured(
    <Text value="A very long channel name" marquee />,
  );
  const run = inner(container);
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");

  rerender(<Text value="A very long channel name" marquee part="title" partValue="x" />);
  await act(async () => {});
  expect(outer(container)?.dataset.playbackPart).toBe("title");
  expect(outer(container)?.dataset.playbackValue).toBe("x");
  expect(phase(run)).toBe("teleprompter-x-back");
});

test("content, speed, axis and active changes restart the forward leg", async () => {
  mockWidths(100, 460);
  mockHeights(40, 100);
  const legState = { active: true };
  stubLegName(legState);
  const { container, rerender } = await renderMeasured(
    <Text value="A very long channel name" marquee />,
  );
  const run = inner(container);
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");

  rerender(<Text value="A different long channel name" marquee />);
  expect(phase(run)).toBe("teleprompter-x");
  expect(run.style.animationName).toBe("none");
  await flushFrame();
  expect(run.style.animationName).toBe("");

  rerender(<Text value="A different long channel name" marquee marqueeSpeed={72} />);
  expect(run.style.animationName).toBe("none");
  await flushFrame();

  rerender(<Text value="A different long channel name" marquee marqueeSpeed={72} active />);
  await flushFrame();
  expect(phase(run)).toBe("teleprompter-x");

  rerender(
    <Text
      value="A different long channel name"
      marquee
      marqueeSpeed={72}
      active
      className="two-line"
    />,
  );
  await flushFrame();
  expect(phase(run)).toBe("teleprompter-y");
  legEnd(run, "teleprompter-y");
  expect(phase(run)).toBe("teleprompter-y-back");
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-y-back");
});

test("right to left overflow travels the positive direction", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  const { container, rerender } = await renderMeasured(
    <Text value="A very long channel name" marquee />,
  );
  const host = outer(container)!;
  host.style.direction = "rtl";
  rerender(<Text value="A very long channel name!" marquee />);
  await flushFrame();
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("360px");
});

test("an app direction change reverses an existing marquee without changing its text", async () => {
  mockWidths(100, 460);
  const previousDirection = document.documentElement.dir;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    () => ({ direction: document.documentElement.dir }) as CSSStyleDeclaration,
  );
  document.documentElement.dir = "ltr";
  const view = await renderMeasured(<Text value="A very long channel name" marquee />);
  try {
    const host = outer(view.container)!;
    expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");

    await act(async () => {
      document.documentElement.dir = "rtl";
    });
    await flushFrame();
    expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("360px");
  } finally {
    view.unmount();
    document.documentElement.dir = previousDirection;
  }
});

test("leaving the owner or losing its animation resets the phase to forward", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  const { container } = await renderMeasured(
    <div className="row">
      <Text value="A very long channel name" marquee />
    </div>,
  );
  const host = outer(container)!;
  const run = inner(container)!;
  const owner = host.closest(".row")!;

  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");

  legState.active = false;
  owner.dispatchEvent(new FocusEvent("focusout", { relatedTarget: run, bubbles: true }));
  await act(async () => {});
  expect(phase(run)).toBe("teleprompter-x-back");

  owner.dispatchEvent(
    new FocusEvent("focusout", { relatedTarget: document.body, bubbles: true }),
  );
  await act(async () => {});
  expect(phase(run)).toBe("teleprompter-x");

  legState.active = true;
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");
  legState.active = false;
  owner.dispatchEvent(new Event("pointerleave"));
  await act(async () => {});
  expect(phase(run)).toBe("teleprompter-x");

  legState.active = true;
  owner.classList.add("cursor");
  await act(async () => {});
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");
  await act(async () => {
    legState.active = false;
    owner.classList.remove("cursor");
    await Promise.resolve();
  });
  expect(phase(run)).toBe("teleprompter-x");
});

test("reduced motion ignores leg ends and a preference change restarts safely", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  let reduced = true;
  const listeners: Array<() => void> = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return reduced;
      },
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: (listener: () => void) => {
        listeners.push(listener);
      },
      removeListener: (listener: () => void) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    })),
  );
  try {
    const { container } = await renderMeasured(
      <Text value="A very long channel name" marquee />,
    );
    const run = inner(container);
    legEnd(run, "teleprompter-x");
    expect(phase(run)).toBe("teleprompter-x");

    reduced = false;
    await act(async () => {
      for (const listener of [...listeners]) listener();
    });
    expect(run.style.animationName).toBe("none");
    await flushFrame();
    expect(run.style.animationName).toBe("");
    expect(phase(run)).toBe("teleprompter-x");

    reduced = true;
    await act(async () => {
      for (const listener of [...listeners]) listener();
    });
    legEnd(run, "teleprompter-x");
    expect(phase(run)).toBe("teleprompter-x");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("unmounting clears the phase and leaves no live reset behind", async () => {
  mockWidths(100, 460);
  const legState = { active: true };
  stubLegName(legState);
  const { container, unmount } = await renderMeasured(
    <Text value="A very long channel name" marquee />,
  );
  const host = outer(container)!;
  const run = inner(container);
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");

  unmount();
  expect(phase(run)).toBe("");
  expect(run.style.animationName).toBe("");

  legState.active = false;
  host.classList.add("cursor");
  legEnd(run, "teleprompter-x");
  await flushFrame();
  expect(phase(run)).toBe("");
  expect(run.style.animationName).toBe("");
});

test("a width resize remeasures, restarts forward and keeps the dwell loop", async () => {
  const clientWidth = 100;
  let scrollWidth = 460;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter") ? clientWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList?.contains("teleprompter-run") ? scrollWidth : 0;
  });
  let measure: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        measure = callback as unknown as () => void;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const legState = { active: true };
  stubLegName(legState);
  try {
    const { container } = await renderMeasured(
      <Text value="A very long channel name" marquee />,
    );
    const host = outer(container)!;
    const run = inner(container);
    expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");

    await flushFrame();
    legEnd(run, "teleprompter-x");
    expect(phase(run)).toBe("teleprompter-x-back");

    scrollWidth = 820;
    act(() => measure?.());
    await flushFrame();
    expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-720px");
    expect(host.style.getPropertyValue("--teleprompter-duration")).toBe("20s");
    expect(phase(run)).toBe("teleprompter-x");
    expect(run.style.animationName).toBe("none");
    await flushFrame();
    expect(run.style.animationName).toBe("");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("text that fits does not resolve computed direction", async () => {
  mockWidths(100, 90);
  const computed = vi.spyOn(window, "getComputedStyle");
  await renderMeasured(<Text value="Short" marquee />);
  expect(
    computed.mock.calls.filter(([element]) => element.classList.contains("teleprompter")),
  ).toHaveLength(0);
});

test("controlled labels measure after the first dwell without adding another dwell", async () => {
  vi.useFakeTimers();
  mockWidths(100, 460);
  stubLegName({ active: true });
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
  const view = render(<Text value="An inactive long poster title" marquee active={false} />);
  await act(async () => vi.advanceTimersByTime(32));
  expect(width).not.toHaveBeenCalled();
  expect(outer(view.container)?.textContent).toBe("An inactive long poster title");

  view.rerender(<Text value="An inactive long poster title" marquee active />);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
  expect(width).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(33));
  await act(async () => vi.advanceTimersByTime(32));
  expect(width).toHaveBeenCalled();
  expect(outer(view.container)?.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
  expect(inner(view.container).style.animationDelay).toBe("0ms");
  legEnd(inner(view.container), "teleprompter-x");
  expect(inner(view.container).style.animationDelay).toBe("");
  expect(phase(inner(view.container))).toBe("teleprompter-x-back");
});

test("refocusing a measured label waits for fresh geometry after the next dwell", async () => {
  vi.useFakeTimers();
  mockWidths(100, 460);
  stubLegName({ active: true });
  const view = render(<Text value="The previously measured title" marquee active />);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  await act(async () => vi.advanceTimersByTime(32));
  const host = outer(view.container)!;
  const run = inner(view.container);
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
  legEnd(run, "teleprompter-x");
  expect(phase(run)).toBe("teleprompter-x-back");

  view.rerender(<Text value="The updated title" marquee active={false} />);
  expect(host.classList.contains("overflowing")).toBe(false);
  expect(phase(run)).toBe("");
  const width = vi
    .spyOn(HTMLElement.prototype, "scrollWidth", "get")
    .mockReturnValue(820)
    .mockClear();

  view.rerender(<Text value="The updated title" marquee active />);
  expect(inner(view.container)).toBe(run);
  expect(host.classList.contains("overflowing")).toBe(false);
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("0px");
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
  expect(width).not.toHaveBeenCalled();
  expect(host.classList.contains("overflowing")).toBe(false);
  await act(async () => vi.advanceTimersByTime(33));
  expect(width).toHaveBeenCalledOnce();
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-720px");
  expect(phase(run)).toBe("teleprompter-x");
});

test("a recycled active label keeps its nodes and never reuses a previous title's distance", async () => {
  vi.useFakeTimers();
  mockWidths(100, 460);
  stubLegName({ active: true });
  const view = render(<Text value="Measured title" marquee active />);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  await act(async () => vi.advanceTimersByTime(32));
  const host = outer(view.container)!;
  const run = inner(view.container);
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");

  view.rerender(<Text value="Another title" marquee active />);
  expect(inner(view.container)).toBe(run);
  expect(host.classList.contains("overflowing")).toBe(false);
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("0px");
  await act(async () => vi.advanceTimersByTime(200));
  view.rerender(<Text value="Measured title" marquee active />);
  expect(inner(view.container)).toBe(run);
  expect(host.classList.contains("overflowing")).toBe(false);
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("0px");
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
  expect(host.classList.contains("overflowing")).toBe(false);
  await act(async () => vi.advanceTimersByTime(33));
  expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
});

test.each([
  { name: "horizontal", value: "A long channel name", className: "row-label", shift: "-360px" },
  { name: "right to left", value: "اسم قناة طويل", className: "poster-title", shift: "360px" },
  { name: "vertical", value: "A long description", className: "two-line", shift: "-60px" },
])(
  "$name marquee labels retain their content nodes across transient focus",
  async ({ name, value, className, shift }) => {
    vi.useFakeTimers();
    mockWidths(100, 460);
    mockHeights(40, 100);
    stubLegName({ active: true });
    const geometry = (
      ["clientWidth", "scrollWidth", "clientHeight", "scrollHeight"] as const
    ).map((property) => vi.spyOn(HTMLElement.prototype, property, "get"));
    const created = vi.fn();
    const disconnected = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          created();
        }
        observe() {}
        disconnect = disconnected;
      },
    );
    const view = render(<Text value={value} className={className} marquee active={false} />);
    const host = outer(view.container)!;
    if (name === "right to left") host.style.direction = "rtl";
    const content = host.firstChild;
    const text = content?.firstChild;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(host, { childList: true, subtree: true });
    try {
      view.rerender(<Text value={value} className={className} marquee active />);
      await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS - 1));
      view.rerender(<Text value={value} className={className} marquee active={false} />);
      await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));

      mutations.push(...observer.takeRecords());
      expect(mutations).toHaveLength(0);
      expect(host.firstChild).toBe(content);
      expect(content?.firstChild).toBe(text);
      expect(created).not.toHaveBeenCalled();
      for (const read of geometry) expect(read).not.toHaveBeenCalled();

      const updated = `${value}!`;
      view.rerender(<Text value={updated} className={className} marquee active={false} />);
      expect(host.textContent).toBe(updated);
      expect(host.firstChild).toBe(content);
      expect(content?.firstChild).toBe(text);

      // Omitting active restores CSS activation and measures the same run without a dwell.
      view.rerender(<Text value={updated} className={className} marquee />);
      await act(async () => vi.advanceTimersByTime(32));
      await act(async () => vi.advanceTimersByTime(32));
      expect(inner(view.container)).toBe(content);
      expect(created).toHaveBeenCalledOnce();
      expect(host.style.getPropertyValue("--teleprompter-shift")).toBe(shift);
      expect(host.classList.contains("active")).toBe(false);
      expect(host.classList.contains("inactive")).toBe(false);
      expect(host.classList.contains("overflowing")).toBe(true);
      const axis = name === "vertical" ? "teleprompter-y" : "teleprompter-x";
      legEnd(inner(view.container), axis);
      expect(phase(inner(view.container))).toBe(`${axis}-back`);

      view.rerender(<Text value={updated} className={className} marquee active={false} />);
      expect(host.firstChild).toBe(content);
      expect(host.classList.contains("overflowing")).toBe(false);
      expect(host.style.getPropertyValue("--teleprompter-shift")).toBe("");
      expect(phase(inner(view.container))).toBe("");
      expect(disconnected).toHaveBeenCalledOnce();
    } finally {
      observer.disconnect();
      view.unmount();
      vi.unstubAllGlobals();
    }
  },
);

test("losing focus cancels pending label geometry and a later focus measures current text", async () => {
  vi.useFakeTimers();
  mockWidths(100, 460);
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
  const view = render(<Text value="The previously focused title" marquee active />);
  view.rerender(<Text value="The newly loaded title" marquee active={false} />);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  expect(width).not.toHaveBeenCalled();

  view.rerender(<Text value="The newly loaded title" marquee active />);
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  expect(outer(view.container)?.textContent).toBe("The newly loaded title");
  expect(outer(view.container)?.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
});

test("moving through labels before the dwell ends never reads their geometry", async () => {
  vi.useFakeTimers();
  mockWidths(100, 460);
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
  const view = render(<Text value="First transient label" marquee active />);
  for (let index = 0; index < 6; index += 1) {
    await act(async () => vi.advanceTimersByTime(200));
    view.rerender(<Text value={`Transient label ${index}`} marquee active />);
  }
  expect(width).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  expect(width).toHaveBeenCalled();
  expect(outer(view.container)?.textContent).toBe("Transient label 5");
});

test("transient focus does not allocate resize observers before the marquee dwell", async () => {
  vi.useFakeTimers();
  const created = vi.fn();
  const observed = vi.fn();
  const disconnected = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor() {
        created();
      }
      observe = observed;
      unobserve() {}
      disconnect = disconnected;
    },
  );
  const view = render(<Text value="First transient label" marquee active />);
  try {
    for (let index = 0; index < 4; index += 1) {
      await act(async () => vi.advanceTimersByTime(200));
      view.rerender(<Text value={`Transient label ${index}`} marquee active />);
    }
    expect(created).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS));
    expect(created).toHaveBeenCalledOnce();
    expect(observed).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(disconnected).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
});

test("text measurements are deferred and all geometry reads precede overflow writes", async () => {
  const events: string[] = [];
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains("teleprompter")) events.push("read");
    return 100;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(460);
  const setProperty = CSSStyleDeclaration.prototype.setProperty;
  vi.spyOn(CSSStyleDeclaration.prototype, "setProperty").mockImplementation(function (
    this: CSSStyleDeclaration,
    property: string,
    value: string | null,
    priority?: string,
  ) {
    if (property === "--teleprompter-shift" && value === "-360px") events.push("write");
    return setProperty.call(this, property, value, priority);
  });
  render(
    <>
      <Text value="First long channel name" marquee />
      <Text value="Second long channel name" marquee />
    </>,
  );
  expect(events).toEqual([]);
  await flushFrame();
  expect(events.filter((event) => event === "read")).toHaveLength(2);
  expect(events.lastIndexOf("read")).toBeLessThan(events.indexOf("write"));
});

test("unmounting before measurement cancels its geometry work", async () => {
  const width = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get");
  const view = render(<Text value="Removed before the next frame" marquee />);
  view.unmount();
  await flushFrame();
  expect(width).not.toHaveBeenCalled();
});

test("removing one pending label preserves the other label's shared measurement", async () => {
  mockWidths(100, 460);
  const view = render(
    <>
      <Text key="removed" value="Removed long label" marquee />
      <Text key="retained" value="Retained long label" marquee />
    </>,
  );
  view.rerender(<Text key="retained" value="Retained long label" marquee />);
  await flushFrame();
  expect(outer(view.container)?.style.getPropertyValue("--teleprompter-shift")).toBe("-360px");
});
