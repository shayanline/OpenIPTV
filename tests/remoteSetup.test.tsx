import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Onboarding } from "../src/components/Onboarding";
import { RemoteSetup } from "../src/components/RemoteSetup";
import type { SettingsDetailNavigation } from "../src/components/Settings";
import { Devices } from "../src/components/settings/Devices";
import { KEY } from "../src/hooks/useRemote";
import type { RemoteAccessControl } from "../src/hooks/useRemoteAccess";
import {
  clearDeviceAccess,
  createPairingSession,
  listPairedDevices,
  pairDevice,
} from "../src/services/deviceAccess";
import { PlaylistEntryFeedbackError } from "../src/services/playlistEntry";
import type { RemoteAccessState } from "../src/services/remoteServer";
import { useSettings } from "../src/stores/settings";

const state = (change: Partial<RemoteAccessState> = {}): RemoteAccessState => ({
  status: "listening",
  address: "192.168.1.8",
  port: 8976,
  remotePath: "",
  pairing: createPairingSession(1_800_000_000_000),
  pairingError: false,
  connectedDevice: "",
  error: "",
  ...change,
});

const control = (change: Partial<RemoteAccessControl> = {}): RemoteAccessControl => ({
  ...state(),
  openPairing: vi.fn(),
  cancelPairing: vi.fn(),
  retry: vi.fn(),
  ...change,
});

const navigation = (): SettingsDetailNavigation => ({
  open: vi.fn(),
  back: vi.fn(),
  dismiss: vi.fn(),
  updateLabel: vi.fn(),
  focusStart: vi.fn(),
  registerEdgeBack: vi.fn(() => () => {}),
  focusEdgeBack: vi.fn(() => false),
  transition: vi.fn(),
  active: false,
  inputEnabled: true,
  focusReady: true,
  surfaceInputEnabled: true,
});

beforeEach(() => {
  localStorage.clear();
  clearDeviceAccess();
  useSettings.getState().set("locale", "en");
});

afterEach(cleanup);

test("device setup shows a local QR code, address, code, and waiting state", () => {
  const management = state();
  render(<RemoteSetup remoteAccess={management} />);

  expect(document.querySelector(".remote-qr svg")).toBeTruthy();
  expect(screen.getByText("http://192.168.1.8:8976")).toBeTruthy();
  const code = management.pairing?.code ?? "missing";
  expect(screen.getByText(`${code.slice(0, 3)} ${code.slice(3)}`)).toBeTruthy();
  expect(screen.getByText("This code expires in five minutes.")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Waiting for a device");
  expect(document.querySelectorAll(".remote-setup button, .remote-setup input")).toHaveLength(
    0,
  );
});

test("development setup points the device at Vite device interface", () => {
  render(
    <RemoteSetup
      remoteAccess={state({
        address: "192.168.1.44",
        port: 49862,
        remotePath: "/remote/index.html",
      })}
    />,
  );

  expect(screen.getByText("http://192.168.1.44:49862/remote/index.html")).toBeTruthy();
  expect(document.querySelector(".remote-qr svg")).toBeTruthy();
});

test("device setup does not claim it is waiting before the server listens", () => {
  render(
    <RemoteSetup
      remoteAccess={state({ status: "starting", address: "", port: 0, pairing: null })}
    />,
  );

  expect(screen.getByRole("status").textContent).toBe("Starting remote access…");
  expect(document.querySelector(".remote-qr")).toBeNull();
  expect(screen.queryByText(/Scan the QR code/)).toBeNull();
});

test("a failed pairing waits for an explicit retry", () => {
  const openPairing = vi.fn();
  render(
    <RemoteSetup
      remoteAccess={state({ pairing: null, pairingError: true })}
      onOpenPairing={openPairing}
    />,
  );

  expect(screen.getByRole("alert").textContent).toContain("invalid or has expired");
  expect(openPairing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(openPairing).toHaveBeenCalledTimes(1);
});

test("the settings variant never auto starts while onboarding keeps doing so", () => {
  const openPairing = vi.fn(() => createPairingSession(1_800_000_000_000));
  const idle = state({ pairing: null, pairingError: false, connectedDevice: "" });
  const view = render(
    <RemoteSetup
      remoteAccess={idle}
      onOpenPairing={openPairing}
      variant="settings"
      autoStart={false}
    />,
  );

  expect(openPairing).not.toHaveBeenCalled();
  expect(document.querySelector(".remote-setup.settings")).toBeTruthy();

  view.rerender(<RemoteSetup remoteAccess={idle} onOpenPairing={openPairing} />);
  expect(openPairing).toHaveBeenCalledTimes(1);
});

test("device setup reports connected and unavailable states", () => {
  const openPairing = vi.fn();
  const view = render(
    <RemoteSetup
      remoteAccess={state({ pairing: null, connectedDevice: "Shayan's device" })}
      onOpenPairing={openPairing}
    />,
  );
  expect(screen.getByRole("heading", { name: "Shayan's device connected" })).toBeTruthy();
  expect(
    screen.queryByText("Scan the QR code to add playlists and choose settings more easily."),
  ).toBeNull();
  expect(document.querySelector(".remote-qr")).toBeNull();
  expect(screen.queryByText("http://192.168.1.8:8976")).toBeNull();
  expect(openPairing).not.toHaveBeenCalled();

  view.rerender(
    <RemoteSetup
      remoteAccess={state({
        status: "unavailable",
        pairing: null,
        error: "no private TV address",
      })}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("Remote setup is unavailable");
  expect(screen.queryByText(/enter the playlist on the left/i)).toBeNull();
});

test("the embedded settings variant keeps setup content without its own heading", () => {
  const remote = state();
  render(<RemoteSetup remoteAccess={remote} variant="settings" embedded autoStart={false} />);

  const section = document.querySelector<HTMLElement>(".remote-setup.settings.has-qr")!;
  expect(section).toBeTruthy();
  expect(section.getAttribute("aria-labelledby")).toBeNull();
  expect(document.querySelector(".remote-qr svg")).toBeTruthy();
  expect(screen.getByText("http://192.168.1.8:8976")).toBeTruthy();
  const code = remote.pairing?.code ?? "";
  expect(screen.getByText(`${code.slice(0, 3)} ${code.slice(3)}`)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Waiting for a device");
  expect(document.querySelector(".remote-setup h2, .remote-setup h4")).toBeNull();
  expect(document.querySelector(".remote-setup-lead")).toBeNull();
  expect(document.querySelector("[data-cancel-pairing], .remote-pairing-action")).toBeNull();
  expect(screen.queryByText(/Scan the QR code/)).toBeNull();
});

test("Remote access opens pairing as a modal instead of an inline card", () => {
  const session = createPairingSession(1_800_000_000_000);
  const ready = control({
    pairing: null,
    openPairing: vi.fn(() => session),
  });
  const nav = navigation();
  const asking = vi.fn();
  const view = render(<Devices remoteAccess={ready} onAsking={asking} navigation={nav} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a device" }));

  expect(ready.openPairing).toHaveBeenCalledTimes(1);
  expect(nav.open).not.toHaveBeenCalled();
  expect(asking).toHaveBeenCalledWith(true);
  expect(document.querySelector(".device-access")).toBeTruthy();
  const dialog = document.querySelector<HTMLElement>(".device-pairing-dialog")!;
  expect(dialog).toBeTruthy();
  expect(dialog.getAttribute("role")).toBe("dialog");
  expect(dialog.getAttribute("aria-label")).toBe("Add a device");
  expect(document.querySelector(".device-pairing")).toBeNull();
  expect(screen.getByRole("button", { name: "Add a device" })).toBeTruthy();

  const active = control({ pairing: session });
  view.rerender(<Devices remoteAccess={active} onAsking={asking} navigation={nav} />);
  expect(screen.getByText("http://192.168.1.8:8976")).toBeTruthy();
  fireEvent.click(
    document.querySelector<HTMLElement>(".device-pairing-dialog .dialog-actions .btn")!,
  );
  expect(active.cancelPairing).toHaveBeenCalledTimes(1);
  expect(asking).toHaveBeenLastCalledWith(false, true);
  expect(document.querySelector(".device-pairing-dialog")).toBeNull();
  view.unmount();

  const unavailable = control({ status: "unavailable", pairing: null });
  render(<Devices remoteAccess={unavailable} onAsking={() => {}} navigation={nav} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(unavailable.retry).toHaveBeenCalledTimes(1);
});

test("a finished owned pairing closes the modal without cancelling", async () => {
  const session = createPairingSession(1_800_000_000_000);
  const ready = control({
    pairing: null,
    openPairing: vi.fn(() => session),
  });
  const nav = navigation();
  const asking = vi.fn();
  const view = render(<Devices remoteAccess={ready} onAsking={asking} navigation={nav} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a device" }));

  const paired = control({ pairing: null, connectedDevice: "Kitchen device" });
  view.rerender(<Devices remoteAccess={paired} onAsking={asking} navigation={nav} />);

  expect(paired.cancelPairing).not.toHaveBeenCalled();
  expect(nav.back).not.toHaveBeenCalled();
  expect(nav.open).not.toHaveBeenCalled();
  expect(asking).toHaveBeenLastCalledWith(false, true);
  expect(document.querySelector(".device-pairing-dialog")).toBeNull();
  expect(document.querySelector(".remote-setup")).toBeNull();
  expect(document.querySelector(".settings-status")?.textContent).toContain(
    "Kitchen device connected",
  );
});

test("paired devices can be renamed and revoked with confirmation", async () => {
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Living room device" });
  if (!paired.ok) throw new Error("pairing failed");
  const onAsking = vi.fn();
  render(
    <Devices
      remoteAccess={control({ pairing: null })}
      onAsking={onAsking}
      navigation={navigation()}
    />,
  );

  const deviceRow = document.querySelector<HTMLElement>(".device-list .device-row")!;
  const rowButtons = [...deviceRow.querySelectorAll<HTMLButtonElement>("button")];
  expect(rowButtons).toHaveLength(2);
  expect(rowButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "Rename, Living room device",
    "Remove access, Living room device",
  ]);
  expect(rowButtons[1].querySelector(".icon")).toBeTruthy();
  expect(deviceRow.querySelector('[aria-haspopup="menu"]')).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Rename, Living room device" }));
  const editor = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(editor.getAttribute("role")).toBe("dialog");
  expect(editor.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector(".device-list .device-row")).toBeTruthy();
  expect(
    [...editor.querySelectorAll<HTMLElement>(".dialog-actions button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).toEqual(["Cancel", "Save"]);
  const nameInput = screen.getByLabelText("Device name");
  expect(document.activeElement).toBe(nameInput);
  fireEvent.change(nameInput, { target: { value: "Kitchen device" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(listPairedDevices()[0].name).toBe("Kitchen device");
  expect(onAsking).toHaveBeenLastCalledWith(false, true);

  fireEvent.click(screen.getByRole("button", { name: "Rename, Kitchen device" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(listPairedDevices()[0].name).toBe("Kitchen device");
  expect(onAsking).toHaveBeenLastCalledWith(false, true);

  fireEvent.click(screen.getByRole("button", { name: "Remove access, Kitchen device" }));
  expect(
    screen.getByRole("heading", { name: "Remove access for Kitchen device?" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
  expect(listPairedDevices()).toEqual([]);
  expect(screen.getByText("No devices are authorised.")).toBeTruthy();
});

test("device row actions stay inert while body input is suspended", async () => {
  const session = createPairingSession();
  const paired = await pairDevice({
    secret: session.secret,
    name: "Living room device",
  });
  if (!paired.ok) throw new Error("pairing failed");
  const onAsking = vi.fn();
  render(
    <Devices
      remoteAccess={control({ pairing: null })}
      onAsking={onAsking}
      navigation={{ ...navigation(), inputEnabled: false }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Rename, Living room device" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove access, Living room device" }));

  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(document.querySelector(".dialog-scrim")).toBeNull();
  expect(onAsking).not.toHaveBeenCalled();
  expect(listPairedDevices().map((device) => device.name)).toEqual(["Living room device"]);
});

test("constrained onboarding scrolls an Extra large focused control into view", () => {
  const scrollIntoView = vi.fn();
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  useSettings.getState().set("fontSizeId", "xl");
  try {
    render(
      <Onboarding onAdd={() => undefined} onError={() => undefined} onExit={() => undefined} />,
    );
    const address = screen.getByLabelText("Playlist address");
    fireEvent.focus(address);

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
    const styles = readFileSync("src/styles/app.css", "utf8");
    expect(styles).toMatch(/\.onboard-box \{[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;/);
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});

const pressRemoteKey = (code: number) => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "keyCode", { get: () => code });
  Object.defineProperty(event, "which", { get: () => code });
  window.dispatchEvent(event);
};

test("onboarding Back cancels an in-flight add without exiting, then exits when idle", async () => {
  let resolveAdd: (() => void) | null = null;
  const onAdd = vi.fn<Parameters<typeof Onboarding>[0]["onAdd"]>(
    () =>
      new Promise<void>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  const onExit = vi.fn();
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={onExit} />);
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://pending.invalid/list.m3u" },
  });
  const submit = screen.getByRole("button", { name: "Add a playlist" });
  act(() => submit.focus());
  fireEvent.click(submit);
  await act(async () => {});
  expect(onAdd).toHaveBeenCalledTimes(1);
  const signal = onAdd.mock.calls[0][3] as AbortSignal;

  pressRemoteKey(KEY.BACK);
  expect(onExit).not.toHaveBeenCalled();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveAdd?.();
    await Promise.resolve();
  });
  expect(onExit).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();

  pressRemoteKey(KEY.BACK);
  expect(onExit).toHaveBeenCalledTimes(1);
});

test("onboarding reports a typed safe notification without attaching it to a field", async () => {
  const onAdd = vi
    .fn()
    .mockRejectedValue(new PlaylistEntryFeedbackError("playlist.entryExpired"));
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  const address = screen.getByLabelText("Playlist address");
  fireEvent.change(address, { target: { value: "http://expired.invalid/list.m3u" } });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await act(async () => {});

  const expected = "This account has expired or is disabled. Contact your provider.";
  expect(document.querySelector(".field-problem")).toBeNull();
  expect(onError).toHaveBeenCalledWith(expected);

  fireEvent.change(address, { target: { value: "http://expired.invalid/other.m3u" } });
  expect(document.querySelector(".field-problem")).toBeNull();
});

test("onboarding never shows provider text for an unknown add failure", async () => {
  const onAdd = vi.fn().mockRejectedValue(new Error("provider said secret-token-123"));
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://broken.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await act(async () => {});

  expect(onError).toHaveBeenCalledWith(
    "The provider could not be reached. Check your connection and the address, then try again.",
  );
  expect(document.body.textContent).not.toContain("secret-token-123");
});
