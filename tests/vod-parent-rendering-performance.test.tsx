import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { createElement, forwardRef } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VodScreenHandle, VodScreenProps } from "../src/screens/VodScreen";
import { mountApp, settle, XTREAM_SOURCE, xtreamFetch } from "./support/app";

const observed = { renders: 0, props: null as VodScreenProps | null };
let previousDuration = "";

beforeEach(() => {
  localStorage.clear();
  observed.renders = 0;
  observed.props = null;
  previousDuration = document.documentElement.style.getPropertyValue("--t-navigation");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.doUnmock("../src/screens/VodScreen");
  if (previousDuration) {
    document.documentElement.style.setProperty("--t-navigation", previousDuration);
  } else {
    document.documentElement.style.removeProperty("--t-navigation");
  }
  vi.unstubAllGlobals();
});

function mountXtream() {
  // Count parent renders without replacing the real screen or its readiness effect.
  vi.doMock("../src/screens/VodScreen", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/screens/VodScreen")>();
    // biome-ignore lint/correctness/noComponentHookFactories: This module mock creates one wrapper whose identity is retained across screen renders.
    const Counting = forwardRef<VodScreenHandle, VodScreenProps>(function Counting(props, ref) {
      observed.renders += 1;
      observed.props = props;
      return createElement(actual.VodScreen, { ...props, ref });
    });
    return { ...actual, VodScreen: Counting };
  });
  return mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: xtreamFetch(
      [{ category_id: "10", category_name: "News" }],
      [{ stream_id: "1", name: "Provider One", category_id: "10", stream_type: "live" }],
    ),
  });
}

function latestProps() {
  if (!observed.props) throw new Error("Expected the VOD screen to render");
  return observed.props;
}

test("an unrelated app update does not render the VOD screen again", async () => {
  document.documentElement.style.setProperty("--t-navigation", "0ms");
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(0);
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
  expect(document.querySelector(".top-strip .clock")).toBeTruthy();

  observed.renders = 0;
  const { useSettings } = await import("../src/stores/settings");
  act(() => useSettings.getState().set("showClock", false));
  await settle(0);

  expect(document.querySelector(".top-strip .clock")).toBeNull();
  expect(observed.renders).toBe(0);
});

test("returning from VOD uses the current enabled modes", async () => {
  document.documentElement.style.setProperty("--t-navigation", "0ms");
  await mountXtream();
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(0);
  const previous = latestProps().onReturnLive;
  const { useSettings } = await import("../src/stores/settings");
  act(() => useSettings.getState().set("showLive", false));
  await settle(0);
  const current = latestProps().onReturnLive;
  expect(current).not.toBe(previous);

  act(() => current());
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
});

test("VOD readiness releases each destination without rendering again when entry finishes", async () => {
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  await mountXtream();
  const app = document.querySelector(".app")!;

  for (const name of ["Movies", "Series", "Movies"] as const) {
    fireEvent.click(screen.getByRole("button", { name }));
    expect(app.getAttribute("data-page-transition")).toBe("leaving");
    await settle(300);
    expect(app.getAttribute("data-page-transition")).toBe("settling");
    await settle(10);
    expect(app.getAttribute("data-page-transition")).toBe("settling");
    await settle(60);
    expect(app.getAttribute("data-page-transition")).toBe("entering");

    observed.renders = 0;
    await settle(300);
    expect(app.getAttribute("data-page-transition")).toBe("idle");
    expect(observed.renders).toBe(0);
  }
});
