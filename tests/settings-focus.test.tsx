import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { useSpatialNav } from "../src/hooks/useSpatialNav";
import { Settings, type SettingsEntry } from "../src/components/Settings";
import type { RemoteAccessControl } from "../src/hooks/useRemoteAccess";
import type { RemoteAccessState } from "../src/services/remoteServer";
import {
  clearDeviceAccess,
  createPairingSession,
  pairDevice,
} from "../src/services/deviceAccess";
import { useSettings } from "../src/stores/settings";

const ENTRY: SettingsEntry = { session: 1, section: "devices" };

const access = (change: Partial<RemoteAccessState> = {}): RemoteAccessState => ({
  status: "unavailable",
  address: "192.168.1.20",
  port: 8080,
  remotePath: "/remote/index.html",
  pairing: null,
  pairingError: false,
  connectedDevice: "",
  error: "",
  ...change,
});

function remoteHarness() {
  const actions = {
    openPairing: vi.fn(),
    cancelPairing: vi.fn(),
    retry: vi.fn(),
  };
  const remote = (change: Partial<RemoteAccessState> = {}): RemoteAccessControl => ({
    ...access(change),
    ...actions,
  });
  return { actions, remote };
}

async function pairLocalDevice(name: string) {
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name });
  if (!paired.ok) throw new Error("pairing failed");
}

function sheet(
  remoteAccess: RemoteAccessControl,
  {
    inputEnabled = true,
    onAppNavigationFocus = vi.fn(),
  }: { inputEnabled?: boolean; onAppNavigationFocus?: () => void } = {},
) {
  return (
    <Settings
      onClose={vi.fn()}
      onAppNavigationFocus={onAppNavigationFocus}
      remoteAccess={remoteAccess}
      entry={ENTRY}
      showRemoteAccess
      inputEnabled={inputEnabled}
    />
  );
}

function press(code: number): KeyboardEvent {
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "keyCode", { get: () => code });
    Object.defineProperty(event, "which", { get: () => code });
    window.dispatchEvent(event);
  });
  return event;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function stubGeometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 120,
        bottom: 40,
        width: 120,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect,
  );
}

const railRows = () => [...document.querySelectorAll<HTMLButtonElement>(".sheet-rail .row")];

const railRow = (label: string) => railRows().find((row) => row.textContent?.includes(label));

const deviceAction = () =>
  document.querySelector<HTMLButtonElement>(".sheet-body .device-access-actions .btn");

const phase = () =>
  document
    .querySelector<HTMLElement>(".sheet-page > .content-transition-shade")
    ?.getAttribute("data-phase");

const bodyHeader = () =>
  document.querySelector<HTMLElement>(".sheet-body .settings-page-header h3")?.textContent ??
  null;

const railCursor = () => document.querySelector<HTMLElement>(".sheet-rail .row.cursor");

const bodyHasFocus = () =>
  document.querySelector(".sheet-body")?.contains(document.activeElement) ?? false;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function pressSequence(codes: number[]) {
  act(() => {
    for (const code of codes) {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "keyCode", { get: () => code });
      Object.defineProperty(event, "which", { get: () => code });
      window.dispatchEvent(event);
    }
  });
}

// Replay retry states that unmount the focused button.
async function orphanedRetry(statuses: RemoteAccessState["status"][], enterKey = KEY.RIGHT) {
  const { actions, remote } = remoteHarness();
  const onAppNavigationFocus = vi.fn();
  const view = render(sheet(remote(), { onAppNavigationFocus }));
  expect(document.activeElement).toBe(railRows()[3]);

  press(enterKey);
  await flush();
  const retry = deviceAction();
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry!);
  expect(actions.retry).toHaveBeenCalledTimes(1);

  for (const status of statuses) {
    view.rerender(sheet(remote({ status }), { onAppNavigationFocus }));
  }
  expect(document.activeElement).toBe(document.body);
  return { view, actions, remote, onAppNavigationFocus };
}

beforeEach(() => {
  localStorage.clear();
  clearDeviceAccess();
  useSettings.setState({ locale: "en", playlists: [], activePlaylistId: "" });
  vi.useFakeTimers();
  stubGeometry();
});

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--t-navigation");
  delete document.documentElement.dataset.inputMode;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("settings reveals focused controls in its own viewport without scrolling the outer page", async () => {
  const { remote } = remoteHarness();
  render(sheet(remote()));
  press(KEY.RIGHT);
  await flush();
  const target = deviceAction()!;
  const body = document.querySelector<HTMLElement>(".sheet-body")!;
  const outer = body.parentElement!;
  outer.scrollTop = 70;
  body.style.overflowY = "auto";
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: 240 },
    scrollHeight: { configurable: true, value: 1200 },
  });
  body.getBoundingClientRect = () => new DOMRect(0, 100, 600, 240);
  target.getBoundingClientRect = () => new DOMRect(0, 600 - body.scrollTop, 120, 40);
  act(() => {
    target.blur();
    target.focus({ preventScroll: true });
  });
  expect(body.scrollTop).toBe(316);
  act(() => {
    target.blur();
    target.focus({ preventScroll: true });
  });
  expect(body.scrollTop).toBe(316);
  body.scrollTop = 700;
  act(() => {
    target.blur();
    target.focus({ preventScroll: true });
  });
  expect(body.scrollTop).toBe(484);
  expect(outer.scrollTop).toBe(70);
});

test("a stranded focus after retry recovers to the rail and keeps settings reachable", async () => {
  const { onAppNavigationFocus } = await orphanedRetry(["idle", "starting"]);

  const down = press(KEY.DOWN);
  expect(down.defaultPrevented).toBe(true);
  expect(onAppNavigationFocus).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(railRow("Remote access"));

  press(KEY.UP);
  expect(document.activeElement).toBe(railRow("Content & playlists"));

  press(KEY.ENTER);
  await flush();
  expect((document.activeElement as HTMLElement | null)?.dataset.settingsFocus).toBe(
    "manage-playlists",
  );
});

test("a successful retry lands focus on Add device without activating it", async () => {
  const { actions, onAppNavigationFocus } = await orphanedRetry([
    "idle",
    "starting",
    "listening",
  ]);

  const enter = press(KEY.ENTER);
  expect(enter.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(deviceAction());
  expect(actions.openPairing).not.toHaveBeenCalled();

  press(KEY.LEFT);
  expect(document.activeElement).toBe(railRow("Remote access"));
  expect(onAppNavigationFocus).not.toHaveBeenCalled();
});

test("a retry that fails again strands focus once more and the new Try again takes it", async () => {
  const { actions } = await orphanedRetry(["idle", "starting", "unavailable"]);

  press(KEY.DOWN);
  expect(document.activeElement).toBe(deviceAction());
  expect(actions.retry).toHaveBeenCalledTimes(1);
});

test("the logical start key returns an orphaned body to the rail even with controls waiting", async () => {
  const { onAppNavigationFocus } = await orphanedRetry(["idle", "starting", "listening"]);

  press(KEY.LEFT);
  expect(document.activeElement).toBe(railRow("Remote access"));
  expect(onAppNavigationFocus).not.toHaveBeenCalled();
});

test("in right to left the mirrored start key escapes the orphaned body", async () => {
  useSettings.setState({ locale: "ar" });
  const { actions, onAppNavigationFocus } = await orphanedRetry(
    ["idle", "starting", "listening"],
    KEY.LEFT,
  );

  // RIGHT is the logical inline start in Arabic, so it is the key that leaves.
  press(KEY.RIGHT);
  expect(document.activeElement).toBe(railRows()[3]);
  expect(onAppNavigationFocus).not.toHaveBeenCalled();

  press(KEY.LEFT);
  await flush();
  expect(document.activeElement).toBe(deviceAction());
  expect(actions.openPairing).not.toHaveBeenCalled();
});

test("suspended settings neither recover focus nor consume the keys", async () => {
  const { remote } = remoteHarness();
  const onAppNavigationFocus = vi.fn();
  const view = render(sheet(remote(), { onAppNavigationFocus }));
  press(KEY.RIGHT);
  await flush();
  fireEvent.click(deviceAction()!);
  view.rerender(sheet(remote({ status: "idle" }), { onAppNavigationFocus }));
  view.rerender(sheet(remote({ status: "starting" }), { onAppNavigationFocus }));
  view.rerender(
    sheet(remote({ status: "listening" }), {
      onAppNavigationFocus,
      inputEnabled: false,
    }),
  );
  expect(document.activeElement).toBe(document.body);

  const down = press(KEY.DOWN);
  expect(down.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(document.body);

  const enter = press(KEY.ENTER);
  expect(enter.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(document.body);
});

async function openPairingModal(remote: RemoteAccessControl, enterKey = KEY.RIGHT) {
  const view = render(sheet(remote));
  press(enterKey);
  await flush();
  const add = deviceAction();
  expect(add).toBeTruthy();
  await act(async () => {
    fireEvent.click(add!);
    const session = vi.mocked(remote.openPairing).mock.results.at(-1)?.value;
    expect(session).toBeTruthy();
    view.rerender(sheet({ ...remote, pairing: session ?? null }));
  });
  await flush();
  return { view, add };
}

const pairingDialog = () => document.querySelector<HTMLElement>(".device-pairing-dialog");
const pairingCancel = () =>
  pairingDialog()?.querySelector<HTMLButtonElement>(".dialog-actions .btn") ?? null;

test("Add a device opens a pairing modal and Cancel restores focus to Add", async () => {
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const { view } = await openPairingModal(remote({ status: "listening" }));

  expect(actions.openPairing).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".device-access")).toBeTruthy();
  const dialog = pairingDialog();
  expect(dialog).toBeTruthy();
  expect(dialog?.getAttribute("role")).toBe("dialog");
  expect(dialog?.getAttribute("aria-label")).toBe("Add a device");
  expect(document.querySelector(".settings-detail-appbar")).toBeNull();
  expect(dialog?.querySelectorAll(".dialog-actions .btn")).toHaveLength(1);
  expect(document.querySelector(".remote-pairing-action")).toBeNull();
  expect(document.querySelector("[data-cancel-pairing]")).toBeNull();
  expect(document.activeElement).toBe(pairingCancel());

  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();
  expect(document.querySelector(".remote-setup.settings .remote-qr")).toBeTruthy();

  act(() => {
    fireEvent.click(pairingCancel()!);
    view.rerender(sheet(remote({ status: "listening", pairing: null })));
  });
  expect(actions.cancelPairing).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".device-access")).toBeTruthy();
  expect(pairingDialog()).toBeNull();
  await flush();
  expect(document.activeElement).toBe(deviceAction());
});

test("RETURN closes the pairing modal the same way as Cancel", async () => {
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const { view } = await openPairingModal(remote({ status: "listening" }));
  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();

  act(() => {
    press(KEY.BACK);
    view.rerender(sheet(remote({ status: "listening", pairing: null })));
  });
  await flush();
  expect(actions.cancelPairing).toHaveBeenCalledTimes(1);
  expect(document.querySelector(".device-access")).toBeTruthy();
  expect(pairingDialog()).toBeNull();
  expect(document.activeElement).toBe(deviceAction());
});

test("a pairing modal blocks section switching until Cancel", async () => {
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const { view } = await openPairingModal(remote({ status: "listening" }));
  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  document.documentElement.dataset.inputMode = "pointer";
  try {
    press(KEY.UP);
    press(KEY.DOWN);
    fireEvent.pointerEnter(railRow("Content & playlists")!);
    fireEvent.pointerEnter(railRow("Appearance")!);
    fireEvent.click(railRow("Content & playlists")!);
    await flush();
    expect(actions.cancelPairing).not.toHaveBeenCalled();
    expect(pairingDialog()).toBeTruthy();
    expect(document.querySelector(".device-access")).toBeTruthy();
    expect(document.querySelector(".content-manage")).toBeNull();
    expect(phase()).toBe("idle");
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
    delete document.documentElement.dataset.inputMode;
  }

  fireEvent.click(pairingCancel()!);
  await flush();
  expect(actions.cancelPairing).toHaveBeenCalledTimes(1);
  expect(pairingDialog()).toBeNull();

  fireEvent.click(railRow("Content & playlists")!);
  await flush();
  expect(document.querySelector(".device-access")).toBeNull();
});

test("browsing the device list without opening pairing never cancels", async () => {
  const { actions, remote } = remoteHarness();
  const view = render(sheet(remote({ status: "listening" })));

  const header = document.querySelector(".settings-list-header");
  expect(header?.querySelector("h4")?.textContent).toBe("Paired devices");
  expect(header?.querySelector(".count")?.textContent).toBe("0");
  const addButton = header?.querySelector(".settings-list-actions .device-access-actions .btn");
  expect(addButton?.textContent).toContain("Add a device");
  expect(addButton?.querySelector("svg.icon-plus")).toBeTruthy();
  expect(addButton?.querySelector("span")?.textContent).toBe("Add a device");

  const pageHeader = document.querySelector(".settings-page-header");
  expect(pageHeader?.querySelector("h3")?.textContent).toBe("Remote access");
  expect([...(pageHeader?.querySelectorAll("p") ?? [])].map((p) => p.textContent)).toEqual([
    "Authorised devices can manage playlists, settings, and playback while OpenIPTV is running.",
  ]);
  expect(pageHeader?.textContent).not.toContain("trusted private network");

  view.rerender(sheet(remote({ status: "unavailable" })));
  const retryButton = document.querySelector(".device-access-actions .btn");
  expect(retryButton?.querySelector("svg.icon-refresh")).toBeTruthy();
  expect(retryButton?.querySelector("span")?.textContent).toBe("Try again");

  fireEvent.click(railRow("Content & playlists")!);
  await flush();
  fireEvent.click(railRow("Remote access")!);
  await flush();
  view.unmount();

  expect(actions.cancelPairing).not.toHaveBeenCalled();
  expect(actions.openPairing).not.toHaveBeenCalled();
});

test("a successful owned pairing closes the modal and lists the new device", async () => {
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const { view, add } = await openPairingModal(remote({ status: "listening" }));
  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();

  await act(async () => {
    await pairDevice({ secret: session.secret, name: "Kitchen device" });
  });
  view.rerender(
    sheet(remote({ status: "listening", pairing: null, connectedDevice: "Kitchen device" })),
  );
  await flush();

  expect(actions.cancelPairing).not.toHaveBeenCalled();
  expect(pairingDialog()).toBeNull();
  expect(document.querySelector(".settings-status")?.textContent).toContain(
    "Kitchen device connected",
  );
  expect(document.querySelector(".device-list")?.textContent).toContain("Kitchen device");
  expect(document.activeElement).toBe(add);
});

test("an expired pairing keeps the modal open and its retry reuses it", async () => {
  const { actions, remote } = remoteHarness();
  const first = createPairingSession(1_800_000_000_000);
  const second = createPairingSession(1_800_000_001_000);
  actions.openPairing.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const { view } = await openPairingModal(remote({ status: "listening" }));
  view.rerender(sheet(remote({ status: "listening", pairing: first })));
  await flush();

  view.rerender(sheet(remote({ status: "listening", pairing: null, pairingError: true })));
  await flush();
  expect(pairingDialog()).toBeTruthy();
  expect(actions.cancelPairing).not.toHaveBeenCalled();
  expect(actions.openPairing).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(actions.openPairing).toHaveBeenCalledTimes(2);
  view.rerender(sheet(remote({ status: "listening", pairing: second })));
  await flush();
  expect(pairingDialog()).toBeTruthy();
  expect(document.querySelector(".remote-setup.settings .remote-qr")).toBeTruthy();
});

test("in right to left Cancel still restores focus to Add a device", async () => {
  useSettings.setState({ locale: "ar" });
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const { view } = await openPairingModal(remote({ status: "listening" }), KEY.LEFT);
  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();

  act(() => {
    fireEvent.click(pairingCancel()!);
    view.rerender(sheet(remote({ status: "listening", pairing: null })));
  });
  expect(actions.cancelPairing).toHaveBeenCalledTimes(1);
  await flush();
  expect(pairingDialog()).toBeNull();
  expect(document.activeElement).toBe(deviceAction());
});

function livePairingHarness() {
  const calls = {
    openPairing: vi.fn(),
    cancelPairing: vi.fn(),
    retry: vi.fn(),
  };
  const publish: { current: ((change: Partial<RemoteAccessState>) => void) | null } = {
    current: null,
  };
  // biome-ignore lint/correctness/noComponentHookFactories: Each harness call creates one isolated component whose identity is retained by rerender.
  function LiveSettings({ inputEnabled = true }: { inputEnabled?: boolean }) {
    const [state, setState] = useState<RemoteAccessState>(() =>
      access({ status: "listening" }),
    );
    publish.current = (change) => setState((current) => ({ ...current, ...change }));
    const remote: RemoteAccessControl = {
      ...state,
      openPairing: () => {
        calls.openPairing();
        const session = createPairingSession(1_800_000_000_000);
        setState((current) => ({ ...current, pairing: session }));
        return session;
      },
      cancelPairing: () => {
        calls.cancelPairing();
        setState((current) => ({ ...current, pairing: null }));
      },
      retry: calls.retry,
    };
    return sheet(remote, { inputEnabled });
  }
  return { calls, publish, LiveSettings };
}

test.each([
  {
    name: "the Cancel button",
    close: () => fireEvent.click(pairingCancel()!),
  },
  { name: "the Return key", close: () => press(KEY.BACK) },
  { name: "the Escape key", close: () => press(KEY.ESC) },
])(
  "closing the pairing modal with $name restores Add device focus before any timer",
  async ({ close }) => {
    const { calls, LiveSettings } = livePairingHarness();
    const view = render(<LiveSettings />);
    press(KEY.RIGHT);
    await flush();
    fireEvent.click(deviceAction()!);
    await flush();
    expect(pairingDialog()).toBeTruthy();
    expect(calls.openPairing).toHaveBeenCalledTimes(1);

    close();
    expect(calls.cancelPairing).toHaveBeenCalledTimes(1);
    expect(pairingDialog()).toBeNull();
    expect(document.activeElement).toBe(deviceAction());
    view.unmount();
  },
);

test("unmounting settings with an owned pairing cancels it exactly once", async () => {
  const { calls, LiveSettings } = livePairingHarness();
  const view = render(<LiveSettings />);
  press(KEY.RIGHT);
  await flush();
  fireEvent.click(deviceAction()!);
  await flush();
  expect(pairingDialog()).toBeTruthy();

  view.unmount();
  expect(calls.cancelPairing).toHaveBeenCalledTimes(1);
});

test("a foreign pairing session is never cancelled by close or unmount", async () => {
  const { actions, remote } = remoteHarness();
  const owned = createPairingSession(1_800_000_000_000);
  const foreign = createPairingSession(1_800_000_001_000);
  actions.openPairing.mockReturnValue(owned);
  const { view } = await openPairingModal(remote({ status: "listening" }));
  view.rerender(sheet(remote({ status: "listening", pairing: owned })));
  await flush();
  expect(pairingDialog()).toBeTruthy();

  view.rerender(sheet(remote({ status: "listening", pairing: foreign })));
  await flush();
  expect(pairingDialog()).toBeNull();
  expect(actions.cancelPairing).not.toHaveBeenCalled();

  view.unmount();
  expect(actions.cancelPairing).not.toHaveBeenCalled();
});

test("suspended input blocks pairing keys until settings resumes", async () => {
  const { actions, remote } = remoteHarness();
  const session = createPairingSession(1_800_000_000_000);
  actions.openPairing.mockReturnValue(session);
  const view = render(sheet(remote({ status: "listening" })));
  press(KEY.RIGHT);
  await flush();
  fireEvent.click(deviceAction()!);
  await flush();
  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();
  expect(pairingDialog()).toBeTruthy();

  view.rerender(
    sheet(remote({ status: "listening", pairing: session }), { inputEnabled: false }),
  );
  await flush();
  press(KEY.BACK);
  press(KEY.ESC);
  await flush();
  expect(pairingDialog()).toBeTruthy();
  expect(actions.cancelPairing).not.toHaveBeenCalled();

  view.rerender(sheet(remote({ status: "listening", pairing: session })));
  await flush();
  press(KEY.BACK);
  await flush();
  expect(actions.cancelPairing).toHaveBeenCalledTimes(1);
  expect(pairingDialog()).toBeNull();
});

test("a phone pairing completing while suspended keeps outside focus and recovers on resume", async () => {
  const { calls, publish, LiveSettings } = livePairingHarness();
  const tree = (inputEnabled: boolean) => (
    <>
      <button type="button" data-testid="outside">
        Outside
      </button>
      <LiveSettings inputEnabled={inputEnabled} />
    </>
  );
  const view = render(tree(true));
  press(KEY.RIGHT);
  await flush();
  fireEvent.click(deviceAction()!);
  await flush();
  expect(pairingDialog()).toBeTruthy();

  view.rerender(tree(false));
  const outside = screen.getByTestId("outside");
  outside.focus();
  expect(document.activeElement).toBe(outside);

  act(() => {
    publish.current?.({ pairing: null, connectedDevice: "Kitchen phone" });
  });
  await flush();

  expect(calls.cancelPairing).not.toHaveBeenCalled();
  expect(pairingDialog()).toBeNull();
  expect(document.activeElement).toBe(outside);

  view.rerender(tree(true));
  await flush();
  expect(document.activeElement).toBe(deviceAction());
});

test("spatial navigation skips native disabled controls when choosing a target", async () => {
  const rects = new Map<HTMLElement, DOMRect>();
  const place = (el: HTMLElement, box: { x: number; y: number; w: number; h: number }) => {
    rects.set(el, {
      x: box.x,
      y: box.y,
      top: box.y,
      left: box.x,
      right: box.x + box.w,
      bottom: box.y + box.h,
      width: box.w,
      height: box.h,
      toJSON: () => ({}),
    } as DOMRect);
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return (
      rects.get(this) ??
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
      } as DOMRect)
    );
  });

  let move: ((code: number) => boolean) | null = null;
  // biome-ignore lint/correctness/noComponentHookFactories: This test creates its harness once before rendering it.
  function Harness({
    prevDisabled = true,
    nextDisabled = false,
  }: {
    prevDisabled?: boolean;
    nextDisabled?: boolean;
  }) {
    const box = useRef<HTMLDivElement>(null);
    const nav = useSpatialNav(box, true);
    move = nav.move;
    return (
      <div ref={box} data-harness>
        <button type="button" data-row>
          Row
        </button>
        <button type="button" data-prev disabled={prevDisabled} tabIndex={0}>
          Previous
        </button>
        <fieldset disabled>
          <button type="button" data-fieldset>
            Fieldset
          </button>
        </fieldset>
        <button type="button" data-next disabled={nextDisabled}>
          Next
        </button>
      </div>
    );
  }

  const view = render(<Harness />);
  const harness = document.querySelector<HTMLElement>("[data-harness]")!;
  const row = harness.querySelector<HTMLElement>("[data-row]")!;
  const prev = harness.querySelector<HTMLElement>("[data-prev]")!;
  const next = harness.querySelector<HTMLElement>("[data-next]")!;
  const fieldsetButton = harness.querySelector<HTMLElement>("[data-fieldset]")!;
  place(row, { x: 0, y: 0, w: 400, h: 40 });
  place(prev, { x: 0, y: 40, w: 260, h: 40 });
  place(next, { x: 160, y: 40, w: 240, h: 40 });
  place(fieldsetButton, { x: 0, y: 80, w: 400, h: 40 });
  place(harness, { x: 0, y: 0, w: 400, h: 200 });

  row.focus();
  expect(document.activeElement).toBe(row);
  act(() => {
    move!(KEY.DOWN);
  });
  expect(document.activeElement).toBe(next);

  act(() => {
    move!(KEY.UP);
  });
  expect(document.activeElement).toBe(row);

  // The fieldset-disabled control has no disabled property of its own, so only
  // :disabled matching excludes it. Make it the geometrically closest target:
  // an own-property check would let it win over the farther enabled Next.
  place(fieldsetButton, { x: 0, y: 40, w: 400, h: 40 });
  place(next, { x: 160, y: 200, w: 240, h: 40 });
  act(() => {
    move!(KEY.DOWN);
  });
  expect(document.activeElement).toBe(next);

  act(() => {
    move!(KEY.UP);
  });
  expect(document.activeElement).toBe(row);

  view.rerender(<Harness prevDisabled={false} nextDisabled />);
  act(() => {
    move!(KEY.DOWN);
  });
  expect(document.activeElement).toBe(prev);
});

test("Content & playlists lands on Manage and Enter enters Saved playlists", async () => {
  useSettings.setState({
    playlists: [
      {
        id: "pl-1",
        name: "Test",
        source: { kind: "m3u", url: "http://list.invalid/a.m3u" },
        sourceVersion: 1,
      },
    ],
    activePlaylistId: "pl-1",
  });
  const { remote } = remoteHarness();
  render(
    <Settings
      onClose={vi.fn()}
      remoteAccess={remote}
      entry={{ session: 1, section: "playlists" }}
      showRemoteAccess
      inputEnabled
    />,
  );
  await flush();

  press(KEY.RIGHT);
  await flush();
  const manage = document.querySelector<HTMLElement>(".content-manage")!;
  expect(manage).toBeTruthy();
  expect(document.activeElement).toBe(manage);

  press(KEY.ENTER);
  await flush();
  await flush();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add a playlist" })).toBeTruthy();
});

test.each(["en", "ar"] as const)(
  "Down from Add device chooses the primary row in %s",
  async (locale) => {
    useSettings.setState({ locale });
    await pairLocalDevice("Living room");
    const { remote, actions } = remoteHarness();
    render(sheet(remote({ status: "listening" })));
    press(locale === "ar" ? KEY.LEFT : KEY.RIGHT);
    await flush();
    const add = deviceAction()!;
    const primary = document.querySelector<HTMLButtonElement>("[data-device-rename]")!;
    const remove = document.querySelector<HTMLButtonElement>("[data-device-revoke]")!;
    const rect = (left: number, top: number, width: number): DOMRect =>
      ({
        x: left,
        y: top,
        left,
        top,
        right: left + width,
        bottom: top + 40,
        width,
        height: 40,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this === add) return rect(800, 0, 160);
      if (this === primary) return rect(0, 80, 840);
      if (this === remove) return rect(880, 80, 80);
      return rect(0, 0, 120);
    });
    act(() => add.focus());
    const down = press(KEY.DOWN);
    expect(down.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(primary);
    expect(document.querySelector("[data-settings-dialog]")).toBeNull();
    expect(actions.openPairing).not.toHaveBeenCalled();
  },
);

test("inline device revoke confirmation allows safe actions and blocks the background", async () => {
  await pairLocalDevice("Living room");
  const { remote } = remoteHarness();
  render(sheet(remote({ status: "listening" })));
  press(KEY.RIGHT);
  await flush();

  const revoke = document.querySelector<HTMLButtonElement>("[data-device-revoke]")!;
  fireEvent.click(revoke);
  await flush();
  let confirm = document.querySelector<HTMLElement>(".confirm-dialog");
  expect(confirm).toBeTruthy();
  const cancel = confirm!.querySelector<HTMLButtonElement>(".dialog-actions button")!;
  expect(document.activeElement).toBe(cancel);

  fireEvent.click(deviceAction()!);
  await flush();
  expect(document.querySelector(".confirm-dialog")).toBe(confirm);

  fireEvent.click(cancel);
  await flush();
  expect(document.querySelector(".confirm-dialog")).toBeNull();
  expect(document.querySelector(".device-row")).toBeTruthy();
  expect(document.activeElement).toBe(revoke);

  fireEvent.click(revoke);
  await flush();
  confirm = document.querySelector<HTMLElement>(".confirm-dialog");
  const keyboardCancel = confirm!.querySelector<HTMLButtonElement>(".dialog-actions button")!;
  expect(document.activeElement).toBe(keyboardCancel);
  press(KEY.ENTER);
  await flush();
  expect(document.querySelector(".confirm-dialog")).toBeNull();
  expect(document.querySelector(".device-row")).toBeTruthy();
  expect(document.activeElement).toBe(revoke);
});

test("rail keys retarget a pending switch and keep the cursor ahead of the commit", async () => {
  const { remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    expect(document.activeElement).toBe(railRows()[3]);

    press(KEY.UP);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Content & playlists");
    expect(document.activeElement).toBe(railRow("Content & playlists"));
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(
      railRow("Content & playlists"),
    );
    expect(railRow("Content & playlists")?.getAttribute("aria-current")).toBe("page");
    expect(railRow("Remote access")?.hasAttribute("aria-current")).toBe(false);
    expect(bodyHeader()).toBe("Remote access");
    expect(document.querySelector(".device-access")).toBeTruthy();

    pressSequence([KEY.UP, KEY.UP]);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Appearance");
    expect(document.activeElement).toBe(railRow("Appearance"));
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(railRow("Appearance"));
    expect(railRow("Appearance")?.getAttribute("aria-current")).toBe("page");
    expect(bodyHeader()).toBe("Remote access");

    await advance(280);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Appearance");
    expect(document.querySelector(".device-access")).toBeNull();
    expect(document.querySelector(".content-manage")).toBeNull();
    await advance(64);
    expect(phase()).toBe("entering");
    await advance(280);
    expect(phase()).toBe("idle");

    expect(bodyHeader()).toBe("Appearance");
    expect(railCursor()?.textContent).toContain("Appearance");
    expect(document.activeElement).toBe(railRow("Appearance"));
    expect(bodyHasFocus()).toBe(false);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("pointer rail input retargets the pending switch without committing early", async () => {
  document.documentElement.dataset.inputMode = "pointer";
  const { remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(railRow("Playback")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Playback");
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(railRow("Playback"));
    expect(railRow("Playback")?.getAttribute("aria-current")).toBe("page");
    expect(bodyHeader()).toBe("Remote access");

    fireEvent.pointerEnter(railRow("Content & playlists")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Content & playlists");
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(railRow("Playback"));
    expect(railRow("Content & playlists")?.hasAttribute("aria-current")).toBe(false);
    expect(bodyHeader()).toBe("Remote access");

    fireEvent.click(railRow("Content & playlists")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Content & playlists");
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(
      railRow("Content & playlists"),
    );

    await advance(280);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Content & playlists");

    fireEvent.pointerEnter(railRow("Appearance")!);
    expect(railCursor()?.textContent).toContain("Appearance");
    fireEvent.click(railRow("Appearance")!);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Appearance");
    expect(railCursor()).toBeNull();
    expect(bodyHasFocus()).toBe(true);
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(railRow("Appearance"));

    await advance(64);
    expect(phase()).toBe("entering");

    fireEvent.click(railRow("About")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("About");
    expect(document.querySelector(".sheet-rail .row.showing")).toBe(railRow("About"));

    await advance(280);
    expect(phase()).toBe("settling");
    await advance(64);
    expect(phase()).toBe("entering");
    await advance(280);
    expect(phase()).toBe("idle");

    expect(bodyHeader()).toBe("About");
    expect(document.querySelector(".about")).toBeTruthy();
    expect(document.querySelector(".sheet-rail .row.showing")?.textContent).toContain("About");
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("clicking the displayed section during a pending switch replaces it", async () => {
  document.documentElement.dataset.inputMode = "pointer";
  const { remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(railRow("Playback")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Playback");

    fireEvent.click(railRow("Remote access")!);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Remote access");

    await advance(280);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Remote access");
    await advance(64);
    await advance(280);
    expect(phase()).toBe("idle");
    expect(bodyHeader()).toBe("Remote access");
    expect(document.querySelector(".device-access")).toBeTruthy();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("a queued body entry is cancelled when the rail moves before idle", async () => {
  const { remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.UP);
    expect(phase()).toBe("leaving");

    press(KEY.RIGHT);
    press(KEY.DOWN);
    press(KEY.UP);
    expect(phase()).toBe("leaving");
    expect(railCursor()?.textContent).toContain("Content & playlists");

    await advance(280);
    expect(phase()).toBe("settling");
    await advance(64);
    expect(phase()).toBe("entering");
    await advance(280);
    expect(phase()).toBe("idle");

    expect(bodyHeader()).toBe("Content & playlists");
    expect(document.activeElement).toBe(railRow("Content & playlists"));
    expect(bodyHasFocus()).toBe(false);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("an inner settings page receives focus before the entering animation starts", async () => {
  const { remote } = remoteHarness();
  render(
    <Settings
      onClose={vi.fn()}
      remoteAccess={remote()}
      entry={{ session: 1, section: "about" }}
      showRemoteAccess
    />,
  );
  press(KEY.RIGHT);
  await flush();
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  fireEvent.click(document.querySelector('[data-settings-focus="about-diagnostics"]')!);
  expect(phase()).toBe("leaving");
  await advance(280);
  expect(phase()).toBe("settling");
  const first = document.querySelector<HTMLButtonElement>(
    ".sheet-body [data-settings-detail-first]",
  )!;
  expect(first).toBeTruthy();
  expect(document.activeElement).toBe(first);
  const activated = vi.fn();
  first.addEventListener("click", activated);
  await advance(64);
  expect(phase()).toBe("entering");
  expect(document.activeElement).toBe(first);
  expect(press(KEY.ENTER).defaultPrevented).toBe(true);
  expect(activated).not.toHaveBeenCalled();
  await advance(280);
  expect(phase()).toBe("idle");
  expect(document.activeElement).toBe(first);
});

test("a pointer commit followed by hover does not steal body focus", async () => {
  document.documentElement.dataset.inputMode = "pointer";
  const { remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(railRow("Playback")!);
    expect(phase()).toBe("leaving");

    fireEvent.pointerEnter(railRow("Appearance")!);
    expect(railCursor()?.textContent).toContain("Appearance");

    await advance(280);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Playback");

    await advance(64);
    expect(phase()).toBe("entering");
    await advance(280);
    expect(phase()).toBe("idle");

    expect(bodyHeader()).toBe("Playback");
    expect(railCursor()?.textContent).toContain("Appearance");
    expect(bodyHasFocus()).toBe(false);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("the incoming body stays inert through entering until idle", async () => {
  const { actions, remote } = remoteHarness();
  render(sheet(remote()));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    press(KEY.UP);
    press(KEY.DOWN);
    await advance(280);
    expect(phase()).toBe("settling");
    expect(bodyHeader()).toBe("Remote access");
    await advance(64);
    expect(phase()).toBe("entering");

    const retry = deviceAction()!;
    fireEvent.click(retry);
    expect(actions.retry).not.toHaveBeenCalled();

    act(() => retry.focus());
    expect(document.activeElement).toBe(retry);
    expect(document.querySelector(".sheet-rail.focused")).toBeTruthy();

    const enter = press(KEY.ENTER);
    expect(enter.defaultPrevented).toBe(true);
    expect(actions.retry).not.toHaveBeenCalled();

    const left = press(KEY.LEFT);
    expect(left.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.body);
    expect(document.querySelector(".sheet-rail.focused")).toBeTruthy();

    press(KEY.UP);
    expect(railCursor()?.textContent).toContain("Content & playlists");
    expect(phase()).toBe("leaving");

    await advance(280);
    await advance(64);
    await advance(280);
    expect(phase()).toBe("idle");
    expect(bodyHeader()).toBe("Content & playlists");

    press(KEY.DOWN);
    await advance(280);
    await advance(64);
    await advance(280);
    expect(phase()).toBe("idle");
    expect(bodyHeader()).toBe("Remote access");

    press(KEY.RIGHT);
    await flush();
    expect(bodyHasFocus()).toBe(true);
    expect(document.activeElement).toBe(deviceAction());
    fireEvent.click(deviceAction()!);
    expect(actions.retry).toHaveBeenCalledTimes(1);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("suspended input ignores rail keys and pointer without consuming them", async () => {
  const { remote } = remoteHarness();
  render(sheet(remote(), { inputEnabled: false }));
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  document.documentElement.dataset.inputMode = "pointer";
  try {
    const up = press(KEY.UP);
    expect(up.defaultPrevented).toBe(false);

    fireEvent.pointerEnter(railRow("Playback")!);
    fireEvent.click(railRow("Playback")!);
    await flush();

    expect(phase()).toBe("idle");
    expect(bodyHeader()).toBe("Remote access");
    expect(document.querySelector(".sheet-rail .row.showing")?.textContent).toContain(
      "Remote access",
    );
    expect(railCursor()).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
    delete document.documentElement.dataset.inputMode;
  }
});
