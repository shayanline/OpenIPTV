import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { TransitionEvent } from "react";
import { useContentTransition } from "../src/hooks/useContentTransition";

const DURATION_MS = 180;
const DURATION = `${DURATION_MS}ms`;
const transitionHosts = new Set<HTMLElement>();

const setup = (ownerKey = "pl-1:v1:details") =>
  renderHook(({ owner }: { owner: string }) => useContentTransition(owner), {
    initialProps: { owner: ownerKey },
  });

/* The shade's own end event: target and currentTarget are the same element and the
   computed opacity is whatever the test painted it to. */
const opacityEnd = (opacity: string, propertyName = "opacity", stale = false) => {
  const element = document.createElement("div");
  element.style.opacity = opacity;
  document.body.appendChild(element);
  const event = {
    target: stale ? document.createElement("div") : element,
    currentTarget: element,
    propertyName,
  } as unknown as TransitionEvent;
  transitionHosts.add(element);
  return event;
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

afterEach(() => {
  cleanup();
  transitionHosts.forEach((element) => {
    element.remove();
  });
  transitionHosts.clear();
  document.documentElement.style.removeProperty("--t-navigation");
  vi.useRealTimers();
});

test("a function commit is held, not invoked, and runs exactly once at the leg end", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();
  const calls: string[] = [];
  const commit = () => calls.push("commit");

  act(() => result.current.navigate(commit));
  expect(calls).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("0.5")));
  act(() => result.current.onTransitionEnd(opacityEnd("1", "left")));
  act(() => result.current.onTransitionEnd(opacityEnd("1", "opacity", true)));
  expect(calls).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  expect(result.current.phase).toBe("settling");
  expect(calls).toEqual(["commit"]);

  await advance(60);
  expect(result.current.phase).toBe("entering");
  expect(calls).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(calls).toHaveLength(1);

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  await advance(400);
  expect(calls).toHaveLength(1);
});

test("zero duration runs the commit synchronously without a leg", async () => {
  vi.useFakeTimers();
  const { result } = setup();
  const calls: string[] = [];

  act(() => result.current.navigate(() => calls.push("commit")));
  expect(calls).toEqual(["commit"]);
  expect(result.current.phase).toBe("idle");
  expect(vi.getTimerCount()).toBe(0);
});

test("an immediate return cancels a queued forward commit and its stale completion", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();
  const forward = vi.fn();
  const returning = vi.fn();

  act(() => result.current.navigate(forward));
  const oldEnd = result.current.onTransitionEnd;
  expect(result.current.phase).toBe("leaving");
  act(() => result.current.navigateNow(returning));
  expect(returning).toHaveBeenCalledTimes(1);
  expect(forward).not.toHaveBeenCalled();
  expect(result.current.phase).toBe("idle");

  act(() => oldEnd(opacityEnd("1")));
  await advance(DURATION_MS + 400);
  act(() => oldEnd(opacityEnd("0")));
  expect(returning).toHaveBeenCalledTimes(1);
  expect(forward).not.toHaveBeenCalled();
  expect(result.current.phase).toBe("idle");
});

test("a retarget during leaving commits only the latest callback", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result } = setup();
  const calls: string[] = [];

  act(() => result.current.navigate(() => calls.push("first")));
  act(() => result.current.navigate(() => calls.push("second")));
  act(() => result.current.navigate(() => calls.push("third")));
  expect(calls).toHaveLength(0);
  expect(result.current.phase).toBe("leaving");

  act(() => result.current.onTransitionEnd(opacityEnd("1")));
  expect(result.current.phase).toBe("settling");
  expect(calls).toEqual(["third"]);

  await advance(60);
  expect(result.current.phase).toBe("entering");
  act(() => result.current.onTransitionEnd(opacityEnd("0")));
  expect(result.current.phase).toBe("idle");
  expect(calls).toEqual(["third"]);
});

test("an owner change cancels a pending commit before it can run", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, rerender } = setup();
  const calls: string[] = [];

  act(() => result.current.navigate(() => calls.push("commit")));
  expect(result.current.phase).toBe("leaving");

  rerender({ owner: "pl-2:v1:grid" });
  expect(result.current.phase).toBe("idle");

  await advance(DURATION_MS + 200);
  expect(calls).toHaveLength(0);
});

test("unmount clears a pending commit and every timer", async () => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--t-navigation", DURATION);
  const { result, unmount } = setup();
  const calls: string[] = [];

  act(() => result.current.navigate(() => calls.push("commit")));
  unmount();
  await advance(DURATION_MS + 200);
  expect(calls).toHaveLength(0);
});
