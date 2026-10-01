import { afterEach, beforeEach, expect, test } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Onboarding } from "../src/components/Onboarding";
import { useSettings } from "../src/stores/settings";
import type { PhoneManagementState } from "../src/services/phoneServer";

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
});

afterEach(() => {
  cleanup();
});

test("the first run screen lets the viewer change language before adding a playlist", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  expect(document.querySelector(".onboard-split")).toBeFalsy();
  expect(screen.queryByText("Set up with your phone")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Language, English" }));
  fireEvent.click(screen.getByRole("option", { name: "فارسی Persian" }));

  expect(useSettings.getState().locale).toBe("fa");
  expect(screen.getByText("زبان")).toBeTruthy();
});

test("the welcome screen keeps manual setup beside phone setup", () => {
  const management: PhoneManagementState = {
    status: "listening",
    address: "192.168.1.8",
    port: 8976,
    pairing: { secret: "secret", code: "123456", expiresAt: Date.now() + 60_000 },
    connectedPhone: "",
    error: "",
  };
  const added: string[] = [];
  render(
    <Onboarding
      onAdd={(name, url) => added.push(`${name}:${url}`)}
      onExit={() => {}}
      phoneManagement={management}
      showPhoneSetup
    />,
  );

  expect(document.querySelector(".onboard-split")).toBeTruthy();
  expect(document.querySelector(".onboard-divider")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.com/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  expect(added).toEqual(["list:http://example.com/list.m3u"]);
});
