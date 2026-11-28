import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { KEY, remoteKeyCode } from "../src/hooks/useRemote";
import { Confirm } from "../src/components/Confirm";
import { OptionPicker } from "../src/components/OptionPicker";
import {
  closeTVApp,
  platform,
  platformName,
  prefersNativeHls,
} from "../src/services/tvPlatform";
import { TV_TARGETS, type TVTarget } from "../src/services/tvTargets";

function selectTarget(target: string) {
  const meta = document.createElement("meta");
  meta.name = "openiptv-platform";
  meta.content = target;
  document.head.append(meta);
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('meta[name="openiptv-platform"]').forEach((meta) => {
    meta.remove();
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each(Object.keys(TV_TARGETS) as TVTarget[])(
  "release metadata selects the %s profile independently of the browser user agent",
  (target) => {
    selectTarget(target);
    expect(platform()).toBe(target);
    expect(platformName()).toBe(TV_TARGETS[target].name);
    expect(prefersNativeHls()).toBe(TV_TARGETS[target].nativeHls);
  },
);

test("an unknown target cannot enable a TV profile", () => {
  selectTarget("__proto__");
  expect(platform()).toBe("browser");
  expect(prefersNativeHls()).toBe(false);
});

test("a browser user agent does not enable device behavior", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("webOS TV Tizen VIDAA");
  expect(platform()).toBe("browser");
  expect(remoteKeyCode({ keyCode: 461 })).toBe(461);
});

test("real AVPlay keeps the Samsung engine even if a foreign marker is present", () => {
  selectTarget("webos");
  const previous = window.webapis;
  Object.defineProperty(window, "webapis", { configurable: true, value: { avplay: {} } });
  try {
    expect(platform()).toBe("tizen");
  } finally {
    if (previous) Object.defineProperty(window, "webapis", { configurable: true, value: previous });
    else delete window.webapis;
  }
});

test.each([
  ["webos", 461],
  ["titan", 8],
  ["vega", 27],
] as const)("%s Back closes a shared dialog without closing the application", (target, code) => {
  selectTarget(target);
  const cancel = vi.fn();
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  render(
    createElement(Confirm, {
      title: "Confirm",
      confirmLabel: "Leave",
      cancelLabel: "Stay",
      onConfirm: vi.fn(),
      onCancel: cancel,
    }),
  );
  fireEvent.keyDown(window, { keyCode: code });
  expect(cancel).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});

test("Titan transport and channel codes preserve the existing key model", () => {
  selectTarget("titan");
  expect(remoteKeyCode({ keyCode: 179 })).toBe(KEY.PLAY_PAUSE);
  expect(remoteKeyCode({ keyCode: 33 })).toBe(KEY.CH_UP);
  expect(remoteKeyCode({ keyCode: 34 })).toBe(KEY.CH_DOWN);
});

test("Titan honours firmware Back constants", () => {
  selectTarget("titan");
  Object.defineProperty(window, "VK_BACK_SPACE", { configurable: true, value: 461 });
  try {
    expect(remoteKeyCode({ keyCode: 461 })).toBe(KEY.BACK);
  } finally {
    delete (window as unknown as { VK_BACK_SPACE?: number }).VK_BACK_SPACE;
  }
});

test("Titan Backspace deletes text rather than navigating away", () => {
  selectTarget("titan");
  const input = document.createElement("input");
  expect(remoteKeyCode({ keyCode: 8, key: "Backspace", target: input })).toBe(8);
  expect(remoteKeyCode({ keyCode: 8, key: "Backspace", target: document.body })).toBe(KEY.BACK);
});

test("the option picker's capture listener accepts LG Back", () => {
  selectTarget("webos");
  render(
    createElement(OptionPicker, {
      label: "Choice",
      value: "first",
      options: [
        { value: "first", label: "First" },
        { value: "second", label: "Second" },
      ],
      onChange: vi.fn(),
    }),
  );
  const trigger = screen.getByRole("button", { name: "Choice, First" });
  trigger.focus();
  fireEvent.keyDown(window, { keyCode: KEY.ENTER });
  expect(Boolean(screen.queryByRole("listbox"))).toBe(true);
  fireEvent.keyDown(window, { keyCode: 461 });
  expect(Boolean(screen.queryByRole("listbox"))).toBe(false);
  expect(document.activeElement === trigger).toBe(true);
});

test("only a TV profile asks the host to close the application", () => {
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  closeTVApp();
  expect(close).not.toHaveBeenCalled();
  selectTarget("webos");
  closeTVApp();
  expect(close).toHaveBeenCalledOnce();
});

test("Samsung can still exit when its media API is unavailable", () => {
  const previous = window.tizen;
  const exit = vi.fn();
  Object.defineProperty(window, "tizen", {
    configurable: true,
    value: { application: { getCurrentApplication: () => ({ exit }) } },
  });
  try {
    closeTVApp();
    expect(exit).toHaveBeenCalledOnce();
  } finally {
    if (previous) Object.defineProperty(window, "tizen", { configurable: true, value: previous });
    else delete window.tizen;
  }
});
