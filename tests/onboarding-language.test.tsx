import { afterEach, beforeEach, expect, test } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Onboarding } from "../src/components/Onboarding";
import { useSettings } from "../src/stores/settings";
import { useSetup } from "../src/stores/setup";
import type { RemoteAccessState } from "../src/services/remoteServer";

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
  useSetup.getState().clear();
});

afterEach(() => {
  cleanup();
});

test("the first run screen lets the viewer change language before adding a playlist", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  expect(document.querySelector(".onboard-split")).toBeFalsy();
  expect(screen.queryByText("Set up with another device")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Language, English" }));
  fireEvent.click(screen.getByRole("option", { name: "فارسی Persian" }));

  expect(useSettings.getState().locale).toBe("fa");
  expect(screen.getByText("زبان")).toBeTruthy();
});

test("device setup typing and language mirror onto the player welcome form", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  act(() => {
    useSetup.getState().set({
      name: "Device playlist",
      url: "http://example.com/device.m3u",
    });
    useSettings.getState().set("locale", "fa");
  });

  expect(screen.getByLabelText("آدرس فهرست").getAttribute("value")).toBe(
    "http://example.com/device.m3u",
  );
  expect(screen.getByLabelText("نام فهرست (اختیاری)").getAttribute("value")).toBe(
    "Device playlist",
  );
});

test("M3U stays the default and Xtream login builds a playlist address", () => {
  const added: { name: string; url: string }[] = [];
  render(<Onboarding onAdd={(name, url) => added.push({ name, url })} onExit={() => {}} />);

  expect(screen.getByRole("button", { name: "M3U playlist" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByLabelText("Playlist address")).toBeTruthy();
  expect(screen.queryByLabelText("Server address")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  fireEvent.change(screen.getByLabelText("Server address"), {
    target: { value: "https://provider.example:8443" },
  });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "viewer" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));

  expect(added).toEqual([
    {
      name: "provider.example",
      url: "https://provider.example:8443/get.php?username=viewer&password=secret&type=m3u_plus&output=m3u8",
    },
  ]);
});

test("the welcome screen keeps manual setup beside device setup", () => {
  const management: RemoteAccessState = {
    status: "listening",
    address: "192.168.1.8",
    port: 8976,
    remotePath: "",
    pairing: { secret: "secret", code: "123456", expiresAt: Date.now() + 60_000 },
    pairingError: false,
    connectedDevice: "",
    error: "",
  };
  const added: string[] = [];
  render(
    <Onboarding
      onAdd={(name, url) => added.push(`${name}:${url}`)}
      onExit={() => {}}
      remoteAccess={management}
      showRemoteSetup
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
