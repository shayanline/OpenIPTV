import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PhoneSetup } from "../src/components/PhoneSetup";
import { Phones } from "../src/components/settings/Phones";
import {
  clearPhoneAccess,
  createPairingSession,
  listPairedPhones,
  pairPhone,
} from "../src/services/phoneAccess";
import { useSettings } from "../src/stores/settings";
import type { PhoneManagementState } from "../src/services/phoneServer";

const state = (change: Partial<PhoneManagementState> = {}): PhoneManagementState => ({
  status: "listening",
  address: "192.168.1.8",
  port: 8976,
  pairing: createPairingSession(1_800_000_000_000),
  connectedPhone: "",
  error: "",
  ...change,
});

beforeEach(() => {
  localStorage.clear();
  clearPhoneAccess();
  useSettings.getState().set("locale", "en");
});

afterEach(cleanup);

test("phone setup shows a local QR code, address, code, and waiting state", () => {
  const management = state();
  render(<PhoneSetup management={management} />);

  expect(document.querySelector(".phone-qr svg")).toBeTruthy();
  expect(screen.getByText("http://192.168.1.8:8976")).toBeTruthy();
  expect(screen.getByText(management.pairing?.code ?? "missing")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Waiting for a phone");
  expect(document.querySelectorAll(".phone-setup button, .phone-setup input")).toHaveLength(0);
});

test("phone setup reports connected and unavailable states", () => {
  const view = render(<PhoneSetup management={state({ connectedPhone: "Shayan's phone" })} />);
  expect(screen.getByRole("status").textContent).toContain("Shayan's phone connected");

  view.rerender(
    <PhoneSetup
      management={state({
        status: "unavailable",
        pairing: null,
        error: "no private TV address",
      })}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain("Phone setup is unavailable");
  expect(screen.getByText(/enter the playlist on the left/i)).toBeTruthy();
});

test("paired phones can be renamed and revoked with confirmation", async () => {
  const session = createPairingSession();
  const paired = await pairPhone({ secret: session.secret, name: "Living room phone" });
  if (!paired.ok) throw new Error("pairing failed");
  render(<Phones management={state({ pairing: null })} onAsking={() => {}} />);

  fireEvent.click(screen.getByRole("button", { name: "Rename Living room phone" }));
  fireEvent.change(screen.getByLabelText("Phone name"), { target: { value: "Kitchen phone" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(listPairedPhones()[0].name).toBe("Kitchen phone");

  fireEvent.click(screen.getByRole("button", { name: "Revoke Kitchen phone" }));
  expect(screen.getByRole("heading", { name: "Revoke Kitchen phone?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect(listPairedPhones()).toEqual([]);
  expect(screen.getByText("No phones are paired.")).toBeTruthy();
});
