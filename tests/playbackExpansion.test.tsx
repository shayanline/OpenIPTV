import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRef, type RefObject } from "react";
import {
  capturePlaybackExpansion,
  usePlaybackExpansion,
  type PlaybackExpansionOrigin,
  type PlaybackExpansionPartName,
} from "../src/hooks/usePlaybackExpansion";

const rect = (top: number, left: number, width: number, height: number): DOMRect =>
  ({
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const expansionOrder: string[] = [];
const setRect = (el: Element, value: DOMRect) => {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => {
      expansionOrder.push("measure");
      return value;
    },
  });
};

interface RecordedAnimation {
  el: Element;
  frames: Keyframe[];
  options?: KeyframeAnimationOptions;
  animation: {
    cancel: ReturnType<typeof vi.fn>;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
  };
}

const animateCalls: RecordedAnimation[] = [];
let animateDescriptor: PropertyDescriptor | undefined;
const createdRoots: HTMLElement[] = [];

beforeEach(() => {
  animateCalls.length = 0;
  expansionOrder.length = 0;
  /*
   * Element.animate may not exist at all in the test engine, so the stub is installed
   * and removed through its property descriptor rather than restored to a method that
   * was never there. The returned objects are plain records: the hook must not rely on
   * anything beyond cancel and the two handlers.
   */
  animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  Element.prototype.animate = function (
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    expansionOrder.push("animate");
    const opts = typeof options === "number" ? { duration: options } : options;
    const animation: RecordedAnimation["animation"] = {
      cancel: vi.fn(),
      onfinish: null,
      oncancel: null,
    };
    animateCalls.push({
      el: this,
      frames: (Array.isArray(frames) ? frames : []) as Keyframe[],
      options: opts,
      animation,
    });
    return animation as unknown as Animation;
  };
  /* The duration token the hook reads through cssMs, pinned so the stylesheet is not
     involved. */
  document.documentElement.style.setProperty("--t-playback-expand", "420ms");
});

afterEach(() => {
  if (animateDescriptor) {
    Object.defineProperty(Element.prototype, "animate", animateDescriptor);
  } else {
    Reflect.deleteProperty(Element.prototype, "animate");
  }
  animateDescriptor = undefined;
  document.documentElement.style.removeProperty("--t-playback-expand");
  document.documentElement.removeAttribute("dir");
  for (const root of createdRoots.splice(0)) root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const track = (root: HTMLElement) => {
  createdRoots.push(root);
  return root;
};

const banner = (): HTMLElement => {
  const root = track(document.createElement("div"));
  root.innerHTML = `
    <div class="pb-stack" data-playback-target="ch-1">
      <span class="pb-number" data-playback-part="number" data-playback-value="12">12</span>
      <span class="pb-logo-slot" data-playback-part="logo" data-playback-value="logo.png"><img /></span>
      <div class="pb-id">
        <span class="pb-title teleprompter" data-playback-part="title" data-playback-value="Title">
          <span class="teleprompter-run">Title</span>
        </span>
        <span class="pb-meta">
          <span class="pb-quality" data-playback-part="quality" data-playback-value="HD">HD</span>
          <span class="pb-group teleprompter" data-playback-part="category" data-playback-value="News">
            <span class="teleprompter-run">News</span>
          </span>
        </span>
        <span class="pb-meta pb-programme teleprompter" data-playback-part="now" data-playback-value="Show">
          <span class="teleprompter-run">Now: Show</span>
        </span>
      </div>
    </div>`;
  document.body.appendChild(root);
  const stack = root.querySelector<HTMLElement>(".pb-stack")!;
  setRect(stack, rect(600, 48, 400, 120));
  const positions: Record<string, DOMRect> = {
    number: rect(620, 64, 108, 60),
    logo: rect(620, 190, 132, 68),
    title: rect(610, 330, 250, 40),
    quality: rect(655, 330, 44, 24),
    category: rect(655, 330, 200, 20),
    now: rect(680, 330, 250, 20),
  };
  stack.querySelectorAll("[data-playback-part]").forEach((node) => {
    setRect(node, positions[(node as HTMLElement).dataset.playbackPart!]);
  });
  return root;
};

describe("capturePlaybackExpansion", () => {
  test("reads bounds, radius and every shared part from a matching visible banner", () => {
    const root = banner();
    const origin = capturePlaybackExpansion(root, "ch-1")!;
    expect(origin.targetKey).toBe("ch-1");
    expect(origin.bounds).toMatchObject({ top: 600, left: 48, width: 400, height: 120 });
    expect(Object.keys(origin.parts).sort()).toEqual([
      "category",
      "logo",
      "now",
      "number",
      "quality",
      "title",
    ]);
    expect(origin.parts.title?.value).toBe("Title");
    expect(origin.parts.quality).toMatchObject({
      value: "HD",
      rect: { top: 655, left: 330, width: 44, height: 24 },
    });
    expect(origin.parts.now?.value).toBe("Show");
    expect(origin.parts.now?.rect.top).toBe(680);
  });

  test("refuses a banner for a different target", () => {
    const root = banner();
    expect(capturePlaybackExpansion(root, "ch-9")).toBeNull();
  });

  test("refuses when there is no banner at all", () => {
    const root = document.createElement("div");
    expect(capturePlaybackExpansion(root, "ch-1")).toBeNull();
  });

  test("parses a travelling marquee offset from the computed transform string", () => {
    const root = banner();
    const run = root.querySelector<HTMLElement>(
      "[data-playback-part='now'] .teleprompter-run",
    )!;
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const style = real(el);
      if (el === run) {
        return {
          ...style,
          transform: "matrix(1, 0, 0, 1, -96, 0)",
          fontSize: "14px",
        } as CSSStyleDeclaration;
      }
      return style;
    });
    const origin = capturePlaybackExpansion(root, "ch-1")!;
    expect(origin.parts.now?.offset).toBe(-96);
  });
});

describe("usePlaybackExpansion", () => {
  const originFor = (): PlaybackExpansionOrigin => ({
    targetKey: "ch-1",
    bounds: rect(600, 48, 400, 120),
    parts: {
      number: { rect: rect(620, 64, 108, 60), fontSize: 34, value: "12" },
      logo: { rect: rect(620, 190, 132, 68), fontSize: 99, value: "logo.png" },
      title: { rect: rect(610, 330, 250, 40), fontSize: 30, value: "Title" },
      quality: { rect: rect(655, 330, 44, 24), fontSize: 14, value: "HD" },
      category: { rect: rect(655, 330, 200, 20), fontSize: 14, value: "News" },
      now: { rect: rect(680, 330, 250, 20), fontSize: 14, value: "Show", offset: -96 },
    },
  });

  const deck = (
    values: Partial<Record<PlaybackExpansionPartName, string>> = {},
  ): { root: HTMLDivElement; ref: RefObject<HTMLDivElement> } => {
    const root = track(document.createElement("div")) as HTMLDivElement;
    root.className = "playback-deck";
    root.innerHTML = `
      <div class="deck-surface"></div>
      <span class="deck-channel-number" data-playback-part="number" data-playback-value="12">12</span>
      <span class="deck-logo-slot" data-playback-part="logo" data-playback-value="logo.png"><img /></span>
      <span class="deck-title teleprompter" data-playback-part="title" data-playback-value="Title">
        <span class="teleprompter-run">Title</span>
      </span>
      <span class="deck-quality" data-playback-part="quality" data-playback-value="HD">HD</span>
      <span class="deck-group teleprompter" data-playback-part="category" data-playback-value="News">
        <span class="teleprompter-run">News</span>
      </span>
      <span class="deck-programme-title teleprompter" data-playback-part="now" data-playback-value="Show">
        <span class="teleprompter-run">Now: Show</span>
      </span>`;
    document.body.appendChild(root);
    setRect(root, rect(560, 48, 1600, 240));
    const positions: Record<string, DOMRect> = {
      number: rect(570, 60, 108, 60),
      logo: rect(570, 180, 132, 68),
      title: rect(570, 300, 500, 30),
      quality: rect(612, 300, 40, 22),
      category: rect(612, 300, 200, 18),
      now: rect(640, 1100, 400, 16),
    };
    root.querySelectorAll<HTMLElement>("[data-playback-part]").forEach((node) => {
      const name = node.dataset.playbackPart as PlaybackExpansionPartName;
      if (values[name] !== undefined) node.dataset.playbackValue = values[name];
      setRect(node, positions[name]);
    });
    const styles = new Map<Element, Record<string, string>>([
      [root.querySelector(".deck-surface")!, { borderRadius: "24px" }],
      [root.querySelector("[data-playback-part='number']")!, { fontSize: "28px" }],
      [root.querySelector("[data-playback-part='logo']")!, { fontSize: "9px" }],
      [root.querySelector("[data-playback-part='title']")!, { fontSize: "24px" }],
      [root.querySelector("[data-playback-part='quality']")!, { fontSize: "12px" }],
      [root.querySelector("[data-playback-part='category']")!, { fontSize: "12px" }],
      [root.querySelector("[data-playback-part='now']")!, { fontSize: "12px" }],
    ]);
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element) => {
      const style = real(el);
      const override = styles.get(el);
      return override ? ({ ...style, ...override } as CSSStyleDeclaration) : style;
    });
    return { root, ref: createRef<HTMLDivElement>() as RefObject<HTMLDivElement> };
  };

  const mount = (
    root: HTMLDivElement,
    ref: RefObject<HTMLDivElement>,
    origin: PlaybackExpansionOrigin | null,
    key = "ch-1",
    content = "content",
  ) => {
    (ref as { current: HTMLDivElement | null }).current = root;
    return renderHook(({ o, t, c }) => usePlaybackExpansion(ref, o, t, c), {
      initialProps: { o: origin, t: key, c: content },
    });
  };

  const surfaceCall = () => animateCalls.find((call) => call.el.className === "deck-surface");
  const callFor = (name: PlaybackExpansionPartName) =>
    animateCalls.find((call) => (call.el as HTMLElement).dataset.playbackPart === name);
  const expanding = (root: HTMLDivElement) => root.classList.contains("expanding");

  test("moves the surface from the measured banner rectangle, never a guessed scale", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const surface = surfaceCall()!;
    const from = surface.frames[0] as Keyframe;
    /* 400/1600 by 120/240, translated so the surface sits at the banner's bottom left. */
    expect(from.transform).toBe("translate(0px, -80px) scale(0.25, 0.5)");
    expect(surface.options?.duration).toBe(420);
    expect(from.borderRadius).toBeUndefined();
    expect((surface.frames[1] as Keyframe).borderRadius).toBeUndefined();
  });

  test("measures every part before starting any animation and only animates transforms", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());

    expect(expansionOrder.lastIndexOf("measure")).toBeLessThan(
      expansionOrder.indexOf("animate"),
    );
    for (const { frames } of animateCalls) {
      for (const frame of frames) {
        expect(
          Object.keys(frame).every((key) => key === "transform" || key === "transformOrigin"),
        ).toBe(true);
      }
    }
  });

  test("moves each matching part with one uniform font scale and no anisotropic text scale", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const title = callFor("title")!;
    const from = title.frames[0] as Keyframe;
    /* 30/24 uniform scale, translated from the banner position. */
    expect(from.transform).toBe("translate(30px, 40px) scale(1.25)");
    expect(from.transform).not.toMatch(/scale\([^)]*,/);
    /* The part share of the surface duration is 380 of 420. */
    expect(title.options?.duration).toBe(380);
  });

  test("the logo scales by the measured geometry and ignores the font size", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const logo = callFor("logo")!;
    const from = logo.frames[0] as Keyframe;
    /* Both logo boxes are 132 by 68 so the ratio is 1, even though the inherited font
       sizes are wildly different (99px source, 9px destination). */
    expect(from.transform).toBe("translate(10px, 50px) scale(1)");
  });

  test("the quality badge moves from its measured position without stretching its text", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const badge = callFor("quality")!;
    expect(badge.frames[0].transform).toBe("translate(30px, 43px) scale(1.1666666666666667)");
    expect(badge.frames[1].transform).toBe("translate(0px, 0px) scale(1)");
  });

  test.each(["changed", "missing"])(
    "a %s quality badge does not inherit the previous badge",
    (state) => {
      const { root, ref } = deck({ quality: "SD" });
      if (state === "missing") root.querySelector('[data-playback-part="quality"]')!.remove();
      mount(root, ref, originFor());
      expect(callFor("quality")).toBeUndefined();
      expect(surfaceCall()).toBeTruthy();
    },
  );

  test("a marquee already travelling carries its offset divided by the outer scale", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const run = animateCalls.find((call) => call.el.className === "teleprompter-run")!;
    /* now scale is 14/12, so -96 / (14/12). */
    expect(run.frames[0].transform).toBe(`translateX(${-96 / (14 / 12)}px)`);
    expect(run.frames[1].transform).toBe("translateX(0px)");
  });

  test("the durations follow the token, including seconds notation", () => {
    document.documentElement.style.setProperty("--t-playback-expand", "0.5s");
    const { root, ref } = deck();
    mount(root, ref, originFor());
    expect(surfaceCall()?.options?.duration).toBe(500);
    expect(callFor("title")?.options?.duration).toBeCloseTo((500 * 19) / 21);
  });

  test("a zero token duration settles with no animation and no class", () => {
    document.documentElement.style.setProperty("--t-playback-expand", "0ms");
    const { root, ref } = deck();
    mount(root, ref, originFor());
    expect(animateCalls).toHaveLength(0);
    expect(expanding(root)).toBe(false);
  });

  test("translates by the physical rectangles in a right to left document", () => {
    document.documentElement.setAttribute("dir", "rtl");
    const { root, ref } = deck();
    mount(root, ref, originFor());
    const surface = surfaceCall()!;
    const from = surface.frames[0] as Keyframe;
    /* The rectangles are physical on every direction: same measured translate. */
    expect(from.transform).toBe("translate(0px, -80px) scale(0.25, 0.5)");
    expect(callFor("title")!.frames[0].transform).toBe("translate(30px, 40px) scale(1.25)");
  });

  test("a provider value containing quotes and backslashes still maps its part", () => {
    const { root, ref } = deck({ title: 'a "quoted" \\name' });
    const origin = originFor();
    origin.parts.title = { ...origin.parts.title!, value: 'a "quoted" \\name' };
    mount(root, ref, origin);
    expect(callFor("title")).toBeTruthy();
  });

  test("does nothing without an origin or for a mismatched target", () => {
    const { root, ref } = deck();
    mount(root, ref, null);
    mount(root, ref, originFor(), "other");
    expect(animateCalls).toHaveLength(0);
  });

  test("a part whose value changed does not travel", () => {
    const { root, ref } = deck();
    const origin = originFor();
    origin.parts.now = { ...origin.parts.now!, value: "Different" };
    mount(root, ref, origin);
    expect(callFor("now")).toBeUndefined();
  });

  test("reduced motion settles immediately with no animation", () => {
    const { root, ref } = deck();
    /* jsdom has no matchMedia, so the query is stubbed rather than spied: spyOn would
       find only vitest's populated getter and refuse a non function target. */
    vi.stubGlobal(
      "matchMedia",
      () =>
        ({
          matches: true,
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as MediaQueryList,
    );
    mount(root, ref, originFor());
    expect(animateCalls).toHaveLength(0);
    expect(expanding(root)).toBe(false);
  });

  test("the same origin does not replay on a re-render", () => {
    const { root, ref } = deck();
    const origin = originFor();
    const { rerender } = mount(root, ref, origin);
    const count = animateCalls.length;
    expect(count).toBeGreaterThan(0);
    act(() => rerender({ o: origin, t: "ch-1", c: "content" }));
    expect(animateCalls).toHaveLength(count);
  });

  test("StrictMode replays a released group with the captured geometry", () => {
    const { root, ref } = deck();
    const origin = originFor();
    (ref as { current: HTMLDivElement | null }).current = root;
    const view = renderHook(({ o, t, c }) => usePlaybackExpansion(ref, o, t, c), {
      initialProps: { o: origin, t: "ch-1", c: "content" },
      reactStrictMode: true,
    });
    const surfaceIndexes = animateCalls
      .map((call, index) => (call.el.className === "deck-surface" ? index : -1))
      .filter((index) => index >= 0);
    expect(surfaceIndexes).toHaveLength(2);
    const firstGroup = animateCalls.slice(surfaceIndexes[0], surfaceIndexes[1]);
    const replayGroup = animateCalls.slice(surfaceIndexes[1]);
    for (const call of firstGroup) {
      expect(call.animation.cancel).toHaveBeenCalledOnce();
      expect(call.animation.onfinish).toBeNull();
      expect(call.animation.oncancel).toBeNull();
    }
    for (const call of replayGroup) {
      expect(call.animation.cancel).not.toHaveBeenCalled();
      expect(call.animation.onfinish).toBeTruthy();
      expect(call.animation.oncancel).toBeTruthy();
    }
    expect(expanding(root)).toBe(true);
    expect(
      replayGroup.find((call) => (call.el as HTMLElement).dataset.playbackPart === "title")
        ?.frames[0]?.transform,
    ).toBe("translate(30px, 40px) scale(1.25)");

    const callCount = animateCalls.length;
    act(() => view.rerender({ o: origin, t: "ch-1", c: "content" }));
    expect(animateCalls).toHaveLength(callCount);
    expect(animateCalls.filter((call) => call.el.className === "deck-surface")).toHaveLength(2);

    for (const call of replayGroup.filter((item) => item.el.className !== "deck-surface")) {
      act(() => call.animation.onfinish?.());
    }
    expect(expanding(root)).toBe(true);
    act(() =>
      replayGroup.find((call) => call.el.className === "deck-surface")!.animation.onfinish?.(),
    );
    expect(expanding(root)).toBe(false);
    view.unmount();
    expect(expanding(root)).toBe(false);
  });

  test("a short part finishing keeps the class until the surface also finishes", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    expect(expanding(root)).toBe(true);
    const shorter = animateCalls.filter((call) => call !== surfaceCall());
    expect(shorter.length).toBeGreaterThan(0);
    for (const call of shorter) act(() => call.animation.onfinish?.());
    /* The 380ms members are done but the 420ms surface still runs: the class stays. */
    expect(expanding(root)).toBe(true);
    act(() => surfaceCall()!.animation.onfinish?.());
    expect(expanding(root)).toBe(false);
  });

  test("a resize after the parts finish still cancels the running surface", () => {
    const { root, ref } = deck();
    mount(root, ref, originFor());
    for (const call of animateCalls.filter((c) => c !== surfaceCall())) {
      act(() => call.animation.onfinish?.());
    }
    act(() => window.dispatchEvent(new Event("resize")));
    expect(surfaceCall()!.animation.cancel).toHaveBeenCalled();
    expect(expanding(root)).toBe(false);
  });

  test("cancelling the group detaches every handler before cancelling", () => {
    const { root, ref } = deck();
    const { unmount } = mount(root, ref, originFor());
    unmount();
    for (const call of animateCalls) {
      expect(call.animation.onfinish).toBeNull();
      expect(call.animation.oncancel).toBeNull();
      expect(call.animation.cancel).toHaveBeenCalled();
    }
    expect(expanding(root)).toBe(false);
  });

  test("a content identity change cancels the group without replaying it", () => {
    const { root, ref } = deck();
    const origin = originFor();
    const { rerender } = mount(root, ref, origin);
    const created = animateCalls.length;
    act(() => rerender({ o: origin, t: "ch-1", c: "metadata changed" }));
    expect(animateCalls).toHaveLength(created);
    for (const call of animateCalls) expect(call.animation.cancel).toHaveBeenCalled();
    expect(expanding(root)).toBe(false);
    act(() => rerender({ o: origin, t: "ch-1", c: "content" }));
    expect(animateCalls).toHaveLength(created);
    expect(expanding(root)).toBe(false);
  });

  test("a target change cancels the group and does not animate for the new key", () => {
    const { root, ref } = deck();
    const origin = originFor();
    const { rerender } = mount(root, ref, origin);
    const firstGroup = animateCalls.slice();
    const created = firstGroup.length;
    act(() => rerender({ o: origin, t: "ch-2", c: "content" }));
    expect(animateCalls).toHaveLength(created);
    for (const call of firstGroup) {
      expect(call.animation.cancel).toHaveBeenCalled();
      expect(call.animation.onfinish).toBeNull();
      expect(call.animation.oncancel).toBeNull();
    }
    expect(expanding(root)).toBe(false);
    act(() => rerender({ o: origin, t: "ch-1", c: "content" }));
    expect(animateCalls).toHaveLength(created);
    expect(expanding(root)).toBe(false);
  });

  test("an external cancellation of any member tears the whole group down", () => {
    const { root, ref } = deck();
    const origin = originFor();
    const { rerender } = mount(root, ref, origin);
    const group = animateCalls.slice();
    expect(group.length).toBeGreaterThan(1);
    /* The browser cancelling one animation is an interruption like any other: every
       member is cancelled and detached, and the expanding state goes with them. */
    act(() => group[0]!.animation.oncancel?.());
    for (const call of group) {
      expect(call.animation.cancel).toHaveBeenCalled();
      expect(call.animation.onfinish).toBeNull();
      expect(call.animation.oncancel).toBeNull();
    }
    expect(expanding(root)).toBe(false);
    act(() => rerender({ o: origin, t: "ch-1", c: "metadata changed" }));
    expect(animateCalls).toHaveLength(group.length);
    act(() => rerender({ o: origin, t: "ch-1", c: "content" }));
    expect(animateCalls).toHaveLength(group.length);
    expect(expanding(root)).toBe(false);
  });

  test("a new origin interrupts the running group and starts the new one", () => {
    const { root, ref } = deck();
    const first = originFor();
    const { rerender } = mount(root, ref, first);
    const firstGroup = animateCalls.slice();
    const second = { ...originFor(), bounds: rect(560, 48, 1600, 240) };
    act(() => rerender({ o: second, t: "ch-1", c: "content" }));
    for (const call of firstGroup) expect(call.animation.cancel).toHaveBeenCalled();
    expect(animateCalls.length).toBeGreaterThan(firstGroup.length);
    expect(expanding(root)).toBe(true);
  });
});
