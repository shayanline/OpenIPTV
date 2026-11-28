import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRemoteAccess } from "../src/hooks/useRemoteAccess";
import type { RemoteAccessState } from "../src/services/remoteServer";
import { TOAST_LIFETIME, useToasts } from "../src/services/toast";
import { useSettings } from "../src/stores/settings";

const server = vi.hoisted(() => {
  const initial = (): RemoteAccessState => ({
    status: "idle",
    address: "",
    port: 0,
    remotePath: "",
    pairing: null,
    pairingError: false,
    connectedDevice: "",
    error: "",
  });
  let state = initial();
  const listeners = new Set<(state: RemoteAccessState) => void>();
  return {
    read: () => state,
    publish(change: Partial<RemoteAccessState>) {
      state = { ...state, ...change };
      listeners.forEach((listener) => {
        listener(state);
      });
    },
    subscribe(listener: (state: RemoteAccessState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      state = initial();
      listeners.clear();
    },
    start: vi.fn(),
    startDevelopment: vi.fn(),
    stop: vi.fn<() => Promise<void>>(),
    openPairing: vi.fn(),
    cancelPairing: vi.fn(),
  };
});

vi.mock("../src/services/remoteServer", () => ({
  remoteAccessState: server.read,
  subscribeRemoteAccess: server.subscribe,
  startRemoteAccess: server.start,
  startDevelopmentRemoteAccess: server.startDevelopment,
  stopRemoteAccess: server.stop,
  openPairing: server.openPairing,
  cancelPairing: server.cancelPairing,
}));

beforeEach(() => {
  vi.useFakeTimers();
  server.reset();
  vi.clearAllMocks();
  server.stop.mockResolvedValue(undefined);
  useSettings.setState({ locale: "en" });
  useToasts.setState({ notice: null });
});

afterEach(() => {
  cleanup();
  useToasts.setState({ notice: null });
  vi.useRealTimers();
});

test("server failures show their diagnostic in a notification without changing focus", () => {
  const button = document.createElement("button");
  document.body.appendChild(button);
  button.focus();
  const view = renderHook(() => useRemoteAccess(true));
  try {
    act(() =>
      server.publish({
        status: "unavailable",
        error: "Samsung Network API is unavailable",
      }),
    );

    expect(useToasts.getState().notice).toMatchObject({
      kind: "error",
      message: expect.stringContaining("Samsung Network API is unavailable"),
    });
    expect(document.activeElement).toBe(button);

    act(() => vi.advanceTimersByTime(TOAST_LIFETIME.error));
    act(() => server.publish({ address: "192.168.1.8" }));
    expect(useToasts.getState().notice).toBeNull();
  } finally {
    view.unmount();
    button.remove();
  }
});

test("pairing failures notify and disabling remote access clears its notification", () => {
  const view = renderHook(({ enabled }) => useRemoteAccess(enabled), {
    initialProps: { enabled: true },
  });
  act(() => server.publish({ status: "listening", pairingError: true }));

  expect(useToasts.getState().notice).toMatchObject({ kind: "error" });
  view.rerender({ enabled: false });
  expect(useToasts.getState().notice).toBeNull();
});

test.each(["disabled", "unmounted"])(
  "a restart waiting for socket close cannot start after the hook is %s",
  async (ending) => {
    let finishStop = () => {};
    server.stop.mockReturnValue(
      new Promise<void>((resolve) => {
        finishStop = resolve;
      }),
    );
    const view = renderHook(({ enabled }) => useRemoteAccess(enabled), {
      initialProps: { enabled: true },
    });
    act(() => view.result.current.retry());
    expect(server.start).toHaveBeenCalledTimes(1);

    if (ending === "disabled") view.rerender({ enabled: false });
    else view.unmount();
    await act(async () => finishStop());

    expect(server.start).toHaveBeenCalledTimes(1);
  },
);

test("a retry starts once after close completes and ignores an older retry", async () => {
  let finishStop = () => {};
  server.stop.mockReturnValue(
    new Promise<void>((resolve) => {
      finishStop = resolve;
    }),
  );
  const view = renderHook(() => useRemoteAccess(true));
  act(() => {
    view.result.current.retry();
    view.result.current.retry();
  });
  expect(server.start).toHaveBeenCalledTimes(1);

  await act(async () => finishStop());

  expect(server.start).toHaveBeenCalledTimes(2);
});
