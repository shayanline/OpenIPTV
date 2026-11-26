import { StrictMode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import {
  clearToast,
  releaseToastOwner,
  retainToastOwner,
  resolveToast,
  showToast,
  TOAST_LIFETIME,
  useToasts,
  type ToastOutcome,
  type ToastOwner,
} from "../src/services/toast";
import { useToast } from "../src/hooks/useToast";
import { ToastHost } from "../src/components/ToastHost";
import { useChrome } from "../src/hooks/useChrome";

/*
 * The shared toast store is one notice at a time, owned by a disposable symbol. These
 * tests pin the contract the hook and the passive host both rely on: bounded lifetimes
 * per kind, dedup that never extends an expiry, owners that cannot outlive their scope,
 * and a host that reports without ever taking focus.
 */

const owners: ToastOwner[] = [];
function owner(): ToastOwner {
  const token = Symbol("toast-test");
  owners.push(token);
  retainToastOwner(token);
  return token;
}
const notice = () => useToasts.getState().notice;

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ notice: null });
});

afterEach(() => {
  cleanup();
  owners.splice(0).forEach(releaseToastOwner);
  useToasts.setState({ notice: null });
  vi.useRealTimers();
});

test("each kind holds for its own bounded lifetime", () => {
  const kinds: ToastOutcome[] = ["neutral", "success", "error", "information", "warning"];
  for (const kind of kinds) {
    const token = owner();
    showToast(token, `kind-${kind}`, kind);
    const shown = notice();
    expect(shown?.kind).toBe(kind);
    expect(shown?.message).toBe(`kind-${kind}`);
    vi.advanceTimersByTime(TOAST_LIFETIME[kind] - 1);
    expect(notice()?.id).toBe(shown?.id);
    vi.advanceTimersByTime(1);
    expect(notice()).toBeNull();
  }
});

test("loading persists until its operation resolves, then uses the outcome lifetime", () => {
  const token = owner();
  const id = showToast(token, "Refreshing", "loading");
  vi.advanceTimersByTime(60000);
  expect(notice()?.id).toBe(id);
  resolveToast(token, id, "Refreshed", "success");
  expect(notice()?.kind).toBe("success");
  vi.advanceTimersByTime(TOAST_LIFETIME.success);
  expect(notice()).toBeNull();
});

test("superseded operations cannot resolve or clear a newer loading notice", () => {
  const token = owner();
  const old = showToast(token, "Refreshing", "loading", Symbol("first"));
  const current = showToast(token, "Refreshing", "loading", Symbol("second"));
  expect(current).not.toBe(old);
  resolveToast(token, old, "Old failure", "error");
  clearToast(token, old);
  expect(notice()?.id).toBe(current);
  releaseToastOwner(token);
  vi.advanceTimersByTime(60000);
  expect(notice()).toBeNull();
});

test("the same owner, kind and message dedups without extending the expiry", () => {
  const token = owner();
  showToast(token, "same words", "neutral");
  const first = notice();
  vi.advanceTimersByTime(2000);
  showToast(token, "same words", "neutral");
  expect(notice()?.id).toBe(first?.id);
  vi.advanceTimersByTime(1999);
  expect(notice()).not.toBeNull();
  vi.advanceTimersByTime(1);
  expect(notice()).toBeNull();
});

test("a different owner replaces the notice and survives the first owner's cleanup", () => {
  const first = owner();
  const second = owner();
  showToast(first, "first words", "neutral");
  vi.advanceTimersByTime(1000);
  showToast(second, "second words", "error");
  const current = notice();
  expect(current?.message).toBe("second words");
  expect(current?.kind).toBe("error");
  // Past the point the replaced notice would have expired on its own.
  vi.advanceTimersByTime(4100);
  expect(notice()?.id).toBe(current?.id);
  releaseToastOwner(first);
  expect(notice()?.id).toBe(current?.id);
  vi.advanceTimersByTime(1100);
  expect(notice()).toBeNull();
});

test("a released owner cannot publish and cannot clear another owner's notice", () => {
  const first = owner();
  const second = owner();
  showToast(second, "kept words", "success");
  releaseToastOwner(first);
  showToast(first, "late words", "error");
  expect(notice()?.message).toBe("kept words");
  clearToast(first);
  expect(notice()?.message).toBe("kept words");
});

test("empty messages are rejected", () => {
  const token = owner();
  showToast(token, "   ", "error");
  showToast(token, "", "success");
  expect(notice()).toBeNull();
});

test("the hook keeps one notice and its expiry across same-scope rerenders", () => {
  const { result, rerender } = renderHook(() => useToast("player"));
  act(() => {
    result.current.show("channel changed", "neutral");
  });
  const shown = notice();
  expect(shown?.message).toBe("channel changed");
  rerender();
  expect(notice()?.id).toBe(shown?.id);
  act(() => {
    vi.advanceTimersByTime(3999);
  });
  expect(notice()).not.toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(notice()).toBeNull();
});

test("changing scope or unmounting releases the notice", () => {
  const { result, rerender, unmount } = renderHook(({ scope }) => useToast(scope), {
    initialProps: { scope: "one" },
  });
  act(() => {
    result.current.show("scoped words", "information");
  });
  expect(notice()?.message).toBe("scoped words");
  rerender({ scope: "two" });
  expect(notice()).toBeNull();
  act(() => {
    result.current.show("second scope", "neutral");
  });
  expect(notice()?.message).toBe("second scope");
  unmount();
  expect(notice()).toBeNull();
});

test("a stale captured show cannot republish after its scope is gone", () => {
  const { result, rerender } = renderHook(({ scope }) => useToast(scope), {
    initialProps: { scope: "old" },
  });
  const staleShow = result.current.show;
  rerender({ scope: "new" });
  act(() => {
    staleShow("ghost words", "error");
  });
  expect(notice()).toBeNull();
});

test("a disabled owner ignores results", () => {
  const { result } = renderHook(() => useToast("paused", false));
  act(() => {
    result.current.show("suppressed words", "error");
  });
  expect(notice()).toBeNull();
});

test("StrictMode still accepts the first real notification", () => {
  let api: ReturnType<typeof useToast> | null = null;
  // biome-ignore lint/correctness/noComponentHookFactories: This test creates its probe once before rendering it.
  function Probe() {
    api = useToast("strict");
    return <ToastHost />;
  }
  render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );
  act(() => {
    api!.show("strict hello", "success");
  });
  const toast = document.querySelector(".toast-host .toast");
  expect(toast?.getAttribute("data-toast-kind")).toBe("success");
  expect(toast?.textContent).toContain("strict hello");
});

test("the host keeps focus, splits alert from status and stays passive", () => {
  let api: ReturnType<typeof useToast> | null = null;
  // biome-ignore lint/correctness/noComponentHookFactories: This test creates its probe once before rendering it.
  function Probe() {
    api = useToast("host");
    return (
      <>
        <button type="button">target</button>
        <ToastHost />
      </>
    );
  }
  render(<Probe />);
  const button = screen.getByRole("button", { name: "target" });
  button.focus();
  expect(document.activeElement).toBe(button);

  act(() => {
    api!.show("assertive words", "error");
  });
  const host = document.querySelector(".toast-host")!;
  const alertRegion = host.querySelector('[role="alert"]')!;
  const statusRegion = host.querySelector('[role="status"]')!;
  const toast = alertRegion.querySelector(".toast")!;
  expect(toast.getAttribute("data-toast-kind")).toBe("error");
  expect(toast.textContent).toContain("assertive words");
  expect(statusRegion.querySelector(".toast")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(toast.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(
    0,
  );

  act(() => {
    api!.show("a message long enough to wrap across the whole toast ".repeat(8));
  });
  const wrapped = document.querySelector(
    ".toast-host [role='status'] .toast span",
  )?.textContent;
  expect(wrapped).toBe("a message long enough to wrap across the whole toast ".repeat(8));
});

test("non-error kinds land in the polite region with their kind marker", () => {
  let api: ReturnType<typeof useToast> | null = null;
  // biome-ignore lint/correctness/noComponentHookFactories: This test creates its probe once before rendering it.
  function Probe() {
    api = useToast("kinds");
    return <ToastHost />;
  }
  render(<Probe />);
  act(() => {
    api!.show("polite words", "information");
  });
  const host = document.querySelector(".toast-host")!;
  const statusToast = host.querySelector('[role="status"] .toast')!;
  expect(statusToast.getAttribute("data-toast-kind")).toBe("information");
  expect(statusToast.textContent).toContain("polite words");
  expect(host.querySelector('[role="alert"] .toast')).toBeNull();
});

test("chrome messages project into the shared store", () => {
  const { result } = renderHook(() => useChrome("chrome-test"));
  act(() => {
    result.current.say("watching notice", true);
  });
  expect(notice()?.kind).toBe("warning");
  expect(result.current.toast).toBe("watching notice");
  expect(result.current.toastWarning).toBe(true);
  act(() => {
    result.current.say("plain words");
  });
  expect(notice()?.kind).toBe("neutral");
  expect(result.current.toastWarning).toBe(false);
  act(() => {
    result.current.clear();
  });
  expect(notice()).toBeNull();
  expect(result.current.toast).toBe("");
});
