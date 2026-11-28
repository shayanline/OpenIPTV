import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useLongPress } from "../src/hooks/useLongPress";
import { KEY } from "../src/hooks/useRemote";
import { pressDown, release, settle } from "./support/app";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a release before the threshold performs one short action", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      delayMs: 500,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );

  pressDown(KEY.ENTER);
  release(KEY.ENTER);

  expect(shortPress).toHaveBeenCalledOnce();
  expect(longPress).not.toHaveBeenCalled();
});

test("the timeout performs one long action and suppresses the short action", async () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      delayMs: 500,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );

  pressDown(KEY.ENTER);
  await settle(500);
  pressDown(KEY.ENTER, true);
  release(KEY.ENTER);

  expect(longPress).toHaveBeenCalledOnce();
  expect(shortPress).not.toHaveBeenCalled();
});

test("the first native repeat performs one long action before the timeout", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      delayMs: 500,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );

  pressDown(KEY.ENTER);
  pressDown(KEY.ENTER, true);
  pressDown(KEY.ENTER, true);
  release(KEY.ENTER);

  expect(longPress).toHaveBeenCalledOnce();
  expect(shortPress).not.toHaveBeenCalled();
});

test("repeated nonrepeat key downs remain one physical press", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      delayMs: 500,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );

  pressDown(KEY.ENTER);
  pressDown(KEY.ENTER);
  release(KEY.ENTER);

  expect(shortPress).toHaveBeenCalledOnce();
  expect(longPress).not.toHaveBeenCalled();
});

test("an unrelated key passes through unchanged", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  const followingListener = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );
  window.addEventListener("keydown", followingListener);

  pressDown(KEY.LEFT);
  release(KEY.LEFT);

  expect(followingListener).toHaveBeenCalledOnce();
  expect(followingListener.mock.calls[0][0].defaultPrevented).toBe(false);
  expect(shortPress).not.toHaveBeenCalled();
  expect(longPress).not.toHaveBeenCalled();
  window.removeEventListener("keydown", followingListener);
});

test("disabled ownership leaves the configured key untouched", () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  const followingListener = vi.fn();
  renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: false,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );
  window.addEventListener("keydown", followingListener);

  pressDown(KEY.ENTER);
  release(KEY.ENTER);

  expect(followingListener).toHaveBeenCalledOnce();
  expect(followingListener.mock.calls[0][0].defaultPrevented).toBe(false);
  expect(shortPress).not.toHaveBeenCalled();
  expect(longPress).not.toHaveBeenCalled();
  window.removeEventListener("keydown", followingListener);
});

test("changing surface while a key is held cancels both actions", async () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  const { rerender } = renderHook(
    ({ enabled }) =>
      useLongPress({
        code: KEY.ENTER,
        enabled,
        delayMs: 500,
        onShortPress: shortPress,
        onLongPress: longPress,
      }),
    { initialProps: { enabled: true } },
  );

  pressDown(KEY.ENTER);
  rerender({ enabled: false });
  await settle(500);
  release(KEY.ENTER);

  expect(shortPress).not.toHaveBeenCalled();
  expect(longPress).not.toHaveBeenCalled();
});

test("unmounting before the threshold cancels both actions", async () => {
  const shortPress = vi.fn();
  const longPress = vi.fn();
  const { unmount } = renderHook(() =>
    useLongPress({
      code: KEY.ENTER,
      enabled: true,
      delayMs: 500,
      onShortPress: shortPress,
      onLongPress: longPress,
    }),
  );

  pressDown(KEY.ENTER);
  unmount();
  await settle(500);
  release(KEY.ENTER);

  expect(shortPress).not.toHaveBeenCalled();
  expect(longPress).not.toHaveBeenCalled();
});

test("callback changes do not replace listeners during a press", () => {
  const firstShortPress = vi.fn();
  const latestShortPress = vi.fn();
  const longPress = vi.fn();
  const { rerender } = renderHook(
    ({ onShortPress }) =>
      useLongPress({
        code: KEY.ENTER,
        enabled: true,
        onShortPress,
        onLongPress: longPress,
      }),
    { initialProps: { onShortPress: firstShortPress } },
  );

  pressDown(KEY.ENTER);
  rerender({ onShortPress: latestShortPress });
  release(KEY.ENTER);

  expect(firstShortPress).not.toHaveBeenCalled();
  expect(latestShortPress).toHaveBeenCalledOnce();
  expect(longPress).not.toHaveBeenCalled();
});
