import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RemoteSetup } from "../src/components/RemoteSetup";
import { Devices } from "../src/components/settings/Devices";
import {
  clearDeviceAccess,
  createPairingSession,
  listPairedDevices,
  pairDevice,
} from "../src/services/deviceAccess";
import { useSettings } from "../src/stores/settings";
import type { RemoteAccessControl } from "../src/hooks/useRemoteAccess";
import type { RemoteAccessState } from "../src/services/remoteServer";

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

const control = (
  change: Partial<RemoteAccessControl> = {},
): RemoteAccessControl => ({
  ...state(),
  openPairing: vi.fn(),
  cancelPairing: vi.fn(),
  retry: vi.fn(),
  ...change,
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
  expect(document.querySelectorAll(".remote-setup button, .remote-setup input")).toHaveLength(0);
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

test("device setup reports connected and unavailable states", () => {
  const openPairing = vi.fn();
  const view = render(
    <RemoteSetup
      remoteAccess={state({ pairing: null, connectedDevice: "Shayan's device" })}
      onOpenPairing={openPairing}
    />,
  );
  expect(screen.getByRole("heading", { name: "Shayan's device connected" })).toBeTruthy();
  expect(screen.queryByText("Scan the QR code to add playlists and choose settings more easily.")).toBeNull();
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

test("Remote access exposes one correct action for each server state", () => {
  const ready = control({ pairing: null });
  const view = render(<Devices remoteAccess={ready} onAsking={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a device" }));
  expect(ready.openPairing).toHaveBeenCalledTimes(1);

  const pairing = createPairingSession(1_800_000_000_000);
  const active = control({ pairing });
  view.rerender(<Devices remoteAccess={active} onAsking={() => {}} />);
  expect(screen.getByText("http://192.168.1.8:8976")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add a device" })).toBeNull();
  const cancel = screen.getByRole("button", { name: "Cancel pairing" });
  expect(document.activeElement).toBe(cancel);
  expect(cancel.closest(".remote-setup")).toBeTruthy();
  fireEvent.click(cancel);
  expect(active.cancelPairing).toHaveBeenCalledTimes(1);
  expect(active.cancelPairing).toHaveBeenCalledWith();

  const unavailable = control({ status: "unavailable", pairing: null });
  view.rerender(<Devices remoteAccess={unavailable} onAsking={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(unavailable.retry).toHaveBeenCalledTimes(1);
});

test("Remote access confirms a device only after an active pairing completes", () => {
  const view = render(<Devices remoteAccess={control()} onAsking={() => {}} />);
  view.rerender(
    <Devices
      remoteAccess={control({ pairing: null, connectedDevice: "Kitchen device" })}
      onAsking={() => {}}
    />,
  );

  expect(screen.getByRole("heading", { name: "Kitchen device connected" })).toBeTruthy();
});

test("paired devices can be renamed and revoked with confirmation", async () => {
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Living room device" });
  if (!paired.ok) throw new Error("pairing failed");
  render(<Devices remoteAccess={control({ pairing: null })} onAsking={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Rename Living room device" }));
  const nameInput = screen.getByLabelText("Device name");
  expect(document.activeElement).toBe(nameInput);
  fireEvent.change(nameInput, { target: { value: "Kitchen device" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(listPairedDevices()[0].name).toBe("Kitchen device");
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Rename Kitchen device" }));

  fireEvent.click(screen.getByRole("button", { name: "Remove access for Kitchen device" }));
  expect(screen.getByRole("heading", { name: "Remove access for Kitchen device?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
  expect(listPairedDevices()).toEqual([]);
  expect(screen.getByText("No devices are authorised.")).toBeTruthy();
});
