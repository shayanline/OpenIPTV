import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePageTransition, type PageMotionPair } from "../src/hooks/usePageTransition";

const DURATION_MS = 180;
const DURATION = `${DURATION_MS}ms`;
const FADE: PageMotionPair = { leaving: "fade", entering: "fade" };
const RAIL: PageMotionPair = { leaving: "rail", entering: "rail" };

const setup = (ownerKey = "pl-1:0") => {
  const commits: string[] = [];
  const finishes: number[] = [];
  const view = renderHook(
    ({ owner }: { owner: string }) =>
      usePageTransition<string>({
        ownerKey: owner,
        onCommit: (target) => commits.push(target),
        onFinish: () => finishes.push(finishes.length + 1),
      }),
    { initialProps: { owner: ownerKey } },
  );
  return { ...view, commits, finishes };
};

/**
 * A transitionend the way the shade emits it: the element is both target and currentTarget,
 * and its computed opacity is whatever the test painted it to.
 */
const opacityEnd = (opacity: string, propertyName = "opacity", stale = false) => {
  const element = document.createElement("div");
  element.style.opacity = opacity;
  document.body.appendChild(element);
  const event = {
    target: stale ? document.createElement("div") : element,
    currentTarget: element,
    propertyName,
  } as unknown as import("react").TransitionEvent;
  element.remove();
  return event;
};

/**
 * The same event shape for the rail leg: the host's own transform end, with the computed
 * transform and direction the acceptance checks read, plus an optional box for the
 * offscreen test.
 */
const transformEnd = (
  transform: string,
  {
    direction,
    rect,
    propertyName = "transform",
    stale = false,
  }: {
    direction?: string;
    rect?: { left: number; right: number };
    propertyName?: string;
    stale?: boolean;
  } = {},
) => {
  const element = document.createElement("div");
  element.style.transform = transform;
  if (direction) element.style.direction = direction;
  if (rect) {
    element.getBoundingClientRect = () =>
      ({
        left: rect.left,
        right: rect.right,
        top: 0,
        bottom: 0,
        width: rect.right - rect.left,
        height: 0,
        x: rect.left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  document.body.appendChild(element);
  const event = {
    target: stale ? document.createElement("div") : element,
    currentTarget: element,
    propertyName,
  } as unknown as import("react").TransitionEvent;
  element.remove();
  return event;
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const readyNow = (result: { current: { settlingRevision: number } }) =>
  result.current.settlingRevision;

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--t-navigation");
  vi.useRealTimers();
});

test("a request leaves, commits once at full opacity, waits for readiness, then enters", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits, finishes } = setup();

  expect(result.current.requestedTarget).toBeNull();
  act(() => result.current.request("movies", FADE));
  expect(result.current.phase).toBe("leaving");
  expect(result.current.requestedTarget).toBe("movies");
  expect(result.current.motion).toEqual(FADE);
  expect(commits).toHaveLength(0);

  act(() => result.current.onTransitionEnd(opacityEnd("0.5")));
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  expect(result.current.phase).toBe("settling");
  expect(result.current.requestedTarget).toBe("movies");
  expect(commits).toEqual(["movies"]);
  expect(finishes).toHaveLength(0);

  const revision = readyNow(result);
  act(() => result.current.ready(revision));
  await advance(10);
  expect(result.current.phase).toBe("settling");

  await advance(60);
  expect(result.current.phase).toBe("entering");
  expect(result.current.requestedTarget).toBe("movies");

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(finishes).toHaveLength(1);
});

test("the requested marker follows retargets in every phase without committing stale targets", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  act(() => result.current.request("series", FADE));
  expect(result.current.requestedTarget).toBe("series");
  expect(commits).toEqual([]);

  await advance(300);
  expect(result.current.phase).toBe("settling");
  expect(result.current.requestedTarget).toBe("series");
  expect(commits).toEqual(["series"]);
  const staleRevision = readyNow(result);
  act(() => result.current.ready(staleRevision));
  act(() => result.current.request("search", FADE));
  expect(result.current.requestedTarget).toBe("search");
  expect(commits).toEqual(["series", "search"]);
  act(() => result.current.ready(staleRevision));
  await advance(60);
  expect(result.current.phase).toBe("settling");
  expect(result.current.requestedTarget).toBe("search");

  act(() => result.current.ready(readyNow(result)));
  await advance(60);
  expect(result.current.phase).toBe("entering");
  expect(result.current.requestedTarget).toBe("search");
  act(() => result.current.request("settings", FADE));
  expect(result.current.phase).toBe("leaving");
  expect(result.current.requestedTarget).toBe("settings");
  expect(commits).toEqual(["series", "search"]);
  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.requestedTarget).toBe("settings");
  await advance(300);
  expect(commits).toEqual(["series", "search", "settings"]);
  act(() => result.current.ready(readyNow(result)));
  await advance(60);
  expect(result.current.requestedTarget).toBe("settings");
  await advance(300);
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();

  act(() => result.current.request("live", RAIL));
  expect(result.current.requestedTarget).toBe("live");
  expect(result.current.phase).toBe("leaving");
  await advance(300);
  expect(commits).toEqual(["series", "search", "settings", "live"]);
});

test("requests during leaving retarget the pending commit without replaying the exit", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  act(() => result.current.request("series", FADE));
  act(() => result.current.request("live", FADE));
  expect(result.current.phase).toBe("leaving");

  await advance(300);
  expect(commits).toEqual(["live"]);
  expect(result.current.phase).toBe("settling");
});

test("a retarget during leaving keeps the outgoing leg and updates only the incoming one", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();

  act(() => result.current.request("live", { leaving: "rail", entering: "fade" }));
  expect(result.current.motion).toEqual({ leaving: "rail", entering: "fade" });

  act(() => result.current.request("search", { leaving: "fade", entering: "rail" }));
  expect(result.current.motion).toEqual({ leaving: "rail", entering: "rail" });

  await advance(300);
  expect(result.current.phase).toBe("settling");
});

test("a request during settling commits the latest target while still masked", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  await advance(300);
  expect(commits).toEqual(["movies"]);
  expect(result.current.phase).toBe("settling");

  act(() => result.current.request("series", FADE));
  expect(result.current.phase).toBe("settling");
  expect(commits).toEqual(["movies", "series"]);
  expect(result.current.settlingRevision).toBe(2);

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
});

test("a stale readiness token is rejected after a same-phase retarget", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();

  act(() => result.current.request("movies", FADE));
  await advance(300);
  expect(result.current.phase).toBe("settling");
  const stale = result.current.settlingRevision;

  act(() => result.current.request("series", FADE));
  expect(result.current.settlingRevision).toBe(stale + 1);

  act(() => result.current.ready(stale));
  await advance(60);
  expect(result.current.phase).toBe("settling");

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
});

test("a request during entering reverses back to leaving", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  await advance(300);
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");

  act(() => result.current.request("settings", FADE));
  expect(result.current.phase).toBe("leaving");

  await advance(300);
  expect(commits).toEqual(["movies", "settings"]);
  expect(result.current.phase).toBe("settling");
});

test("a rail leg commits when the host reports fully offscreen and ignores opacity", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("live", RAIL));
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  expect(result.current.phase).toBe("leaving");

  act(() =>
    result.current.onTransitionEnd(
      transformEnd("matrix(1, 0, 0, 1, -700, 0)", { rect: { left: -900, right: -500 } }),
    ),
  );
  expect(result.current.phase).toBe("settling");
  expect(commits).toEqual(["live"]);
});

test("a rail leg rejects a transform end while the host still overlaps the viewport", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();

  act(() => result.current.request("live", RAIL));
  act(() =>
    result.current.onTransitionEnd(
      transformEnd("matrix(1, 0, 0, 1, -100, 0)", { rect: { left: -300, right: 100 } }),
    ),
  );
  expect(result.current.phase).toBe("leaving");

  act(() =>
    result.current.onTransitionEnd(
      transformEnd("matrix(1, 0, 0, 1, -700, 0)", { rect: { left: -900, right: -500 } }),
    ),
  );
  expect(result.current.phase).toBe("settling");
});

test("a rail leg uses the rtl edge when the document direction is rtl", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();

  act(() => result.current.request("live", RAIL));
  act(() =>
    result.current.onTransitionEnd(
      transformEnd("matrix(1, 0, 0, 1, 700, 0)", {
        direction: "rtl",
        rect: { left: 1200, right: 1600 },
      }),
    ),
  );
  expect(result.current.phase).toBe("settling");
});

test("an entering rail leg finishes only at zero transform translation", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, finishes } = setup();

  act(() => result.current.request("live", RAIL));
  await advance(300);
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(transformEnd("matrix(1, 0, 0, 1, -120, 0)")));
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(transformEnd("matrix(1, 0, 0, 1, 0, 0)")));
  expect(result.current.phase).toBe("idle");
  expect(finishes).toHaveLength(1);
});

test("mixed pairs finish each leg on its own signal", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits, finishes } = setup();

  act(() => result.current.request("settings", { leaving: "rail", entering: "fade" }));
  await advance(300);
  expect(commits).toEqual(["settings"]);
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(transformEnd("matrix(1, 0, 0, 1, 0, 0)")));
  expect(result.current.phase).toBe("entering");
  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(finishes).toHaveLength(1);

  act(() => result.current.request("live", { leaving: "fade", entering: "rail" }));
  await advance(300);
  expect(commits).toEqual(["settings", "live"]);
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("entering");
  act(() => result.current.onTransitionEnd(transformEnd("none")));
  expect(result.current.phase).toBe("idle");
});

test("cancel discards an uncommitted target, keeps a committed page, and releases once", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits, finishes } = setup();

  act(() => result.current.cancel());
  expect(result.current.requestedTarget).toBeNull();
  expect(finishes).toHaveLength(0);

  act(() => result.current.request("movies", FADE));
  act(() => result.current.cancel());
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(commits).toHaveLength(0);
  expect(finishes).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  await advance(400);
  expect(commits).toHaveLength(0);
  expect(result.current.phase).toBe("idle");

  act(() => result.current.request("live", FADE));
  expect(result.current.requestedTarget).toBe("live");
  await advance(300);
  act(() => result.current.cancel());
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(commits).toEqual(["live"]);
  expect(finishes).toHaveLength(2);
});

test("an owner change cancels pending work and unmount clears every handle", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, rerender, unmount, commits, finishes } = setup();

  act(() => result.current.request("movies", FADE));
  rerender({ owner: "pl-2:0" });
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(finishes).toHaveLength(1);

  act(() => result.current.request("series", FADE));
  expect(result.current.requestedTarget).toBe("series");
  unmount();
  await advance(600);
  expect(commits).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");
});

test("zero duration commits and finishes synchronously without timers or frames", async () => {
  vi.useFakeTimers();
  const { result, commits, finishes } = setup();

  act(() => result.current.request("movies", FADE));
  expect(commits).toEqual(["movies"]);
  expect(finishes).toHaveLength(1);
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

test("an immediate request clears a pending marker before later independent navigation", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  expect(result.current.requestedTarget).toBe("movies");
  document.documentElement.style.setProperty("--t-navigation", "0ms");
  act(() => result.current.request("settings", FADE));
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(commits).toEqual(["settings"]);
  await advance(400);
  expect(commits).toEqual(["settings"]);

  act(() => result.current.request("search", FADE));
  expect(result.current.requestedTarget).toBeNull();
  expect(commits).toEqual(["settings", "search"]);
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  act(() => result.current.request("live", RAIL));
  expect(result.current.requestedTarget).toBe("live");
  await advance(300);
  expect(commits).toEqual(["settings", "search", "live"]);
});

test("stale opacity ends are ignored outside their phase and property", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("movies", FADE));
  act(() => result.current.onTransitionEnd(opacityEnd("1", "left")));
  act(() => result.current.onTransitionEnd(opacityEnd("1", "opacity", true)));
  expect(result.current.phase).toBe("leaving");

  await advance(300);
  expect(result.current.phase).toBe("settling");
  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("settling");

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
  act(() => result.current.onTransitionEnd(opacityEnd("0.4")));
  act(() => result.current.onTransitionEnd(opacityEnd("0", "left")));
  expect(result.current.phase).toBe("entering");

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(commits).toEqual(["movies"]);
});

test("the duration fallback drives fades that never emit transitionend", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits, finishes } = setup();

  act(() => result.current.request("movies", FADE));
  await advance(DURATION_MS + 99);
  expect(result.current.phase).toBe("leaving");
  await advance(1);
  expect(result.current.phase).toBe("settling");
  expect(commits).toEqual(["movies"]);

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
  await advance(DURATION_MS + 100);
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(finishes).toHaveLength(1);
});

test("the duration fallback also drives rail legs that never emit transitionend", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, commits } = setup();

  act(() => result.current.request("live", RAIL));
  await advance(DURATION_MS + 100);
  expect(result.current.phase).toBe("settling");
  expect(commits).toEqual(["live"]);

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
  await advance(DURATION_MS + 100);
  expect(result.current.phase).toBe("idle");
});

test("ready is ignored outside settling and a repeated ready does not double queue", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();

  act(() => result.current.ready(0));
  expect(result.current.phase).toBe("idle");

  act(() => result.current.request("movies", FADE));
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(300);
  expect(result.current.phase).toBe("settling");

  act(() => result.current.ready(result.current.settlingRevision));
  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
});

test("a function target is held, not invoked, and commits exactly once", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const commits: string[] = [];
  const { result } = renderHook(() =>
    usePageTransition<() => void>({
      ownerKey: "pl-1:0",
      onCommit: (commit) => {
        commits.push("commit");
        commit();
      },
    }),
  );
  const calls: string[] = [];
  const target = () => calls.push("target");

  act(() => result.current.request(target, FADE));
  expect(calls).toHaveLength(0);
  expect(commits).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");
  expect(typeof result.current.requestedTarget).toBe("function");

  act(() => result.current.onTransitionEnd(opacityEnd("0.5")));
  act(() => result.current.onTransitionEnd(opacityEnd("1", "left")));
  expect(calls).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  expect(result.current.phase).toBe("settling");
  expect(commits).toEqual(["commit"]);
  expect(calls).toEqual(["target"]);

  act(() => result.current.ready(result.current.settlingRevision));
  await advance(60);
  expect(result.current.phase).toBe("entering");
  expect(calls).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("0", "left")));
  act(() => result.current.onTransitionEnd(opacityEnd("0.4")));
  expect(result.current.phase).toBe("entering");
  expect(calls).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(result.current.requestedTarget).toBeNull();
  expect(calls).toHaveLength(1);
  expect(commits).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  await advance(400);
  expect(calls).toHaveLength(1);
  expect(commits).toHaveLength(1);
});
