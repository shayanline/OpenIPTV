import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { Onboarding } from "../src/components/Onboarding";
import { KEY } from "../src/hooks/useRemote";
import { press } from "./support/app";
import { useSettings } from "../src/stores/settings";
import { useSetup } from "../src/stores/setup";
import type { RemoteAccessState } from "../src/services/remoteServer";
import type { PlaylistSource } from "../src/services/playlistUrl";

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
      source: { kind: "m3u", url: "http://example.com/device.m3u" },
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

test("M3U setup keeps the specific address guidance", () => {
  const onAdd = vi.fn();
  render(<Onboarding onAdd={onAdd} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "example.com/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));

  expect(screen.getByRole("alert").textContent).toBe(
    "Start the address with http:// or https://",
  );
  expect(onAdd).not.toHaveBeenCalled();
});

test("M3U setup suggests Xtream and prefills the login when accepted", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value:
        "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=m3u8",
    },
  });

  expect(screen.getByText("This address contains an Xtream login.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://provider.example:8080",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, HLS, recommended",
  );
});

test("M3U setup can keep a detected Xtream address as M3U", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);

  const address =
    "http://provider.example/get.php?username=viewer&password=secret&type=m3u_plus";
  fireEvent.change(screen.getByLabelText("Playlist address"), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Keep M3U" }));

  expect(screen.queryByText("This address contains an Xtream login.")).toBeNull();
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(address);
});

test("Xtream setup extracts credentials pasted into the server field", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  fireEvent.change(screen.getByLabelText("Server address"), {
    target: {
      value:
        "https://provider.example/portal/get.php?username=user%20name&password=p%26ss&type=m3u_plus&output=ts",
    },
  });

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "https://provider.example/portal",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("user name");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("p&ss");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, MPEG TS",
  );
});

test("source buttons own physical arrow navigation on the welcome screen", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);
  const m3u = screen.getByRole("button", { name: "M3U playlist" });
  const xtream = screen.getByRole("button", { name: "Xtream login" });

  m3u.focus();
  fireEvent.keyDown(m3u, { keyCode: KEY.RIGHT });
  expect(document.activeElement).toBe(xtream);
  fireEvent.keyDown(xtream, { keyCode: KEY.ENTER });
  expect(screen.getByLabelText("Server address")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("button", { name: "Xtream login" }), {
    keyCode: KEY.DOWN,
  });
  expect(document.activeElement).toBe(screen.getByLabelText("Server address"));

  for (const label of ["Username", "Password", "Stream format", "Name it (optional)"]) {
    fireEvent.keyDown(document.activeElement!, { keyCode: KEY.DOWN });
    expect(document.activeElement).toBe(screen.getByLabelText(label));
  }
  fireEvent.keyDown(document.activeElement!, { keyCode: KEY.DOWN });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Language, English" }),
  );
  fireEvent.keyDown(document.activeElement!, { keyCode: KEY.DOWN });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Xtream login" }));
  fireEvent.keyDown(document.activeElement!, { keyCode: KEY.UP });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Language, English" }),
  );
});

test("M3U stays the default and Xtream login submits a typed source", () => {
  const added: { name: string; source: PlaylistSource }[] = [];
  render(
    <Onboarding onAdd={(name, source) => added.push({ name, source })} onExit={() => {}} />,
  );

  expect(
    screen.getByRole("button", { name: "M3U playlist" }).getAttribute("aria-pressed"),
  ).toBe("true");
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
      source: {
        kind: "xtream",
        server: "https://provider.example:8443",
        username: "viewer",
        password: "secret",
        output: "m3u8",
      },
    },
  ]);
});

test("the Xtream stream format closes when focus moves to the password", () => {
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  const output = screen.getByLabelText("Stream format");
  output.focus();
  fireEvent.click(output);
  expect(screen.getByRole("listbox", { name: "Stream format" })).toBeTruthy();
  expect(output.getAttribute("aria-expanded")).toBe("true");

  act(() => screen.getByLabelText("Password").focus());

  expect(screen.queryByRole("listbox", { name: "Stream format" })).toBeNull();
  expect(output.getAttribute("aria-expanded")).toBe("false");
});

test("remote navigation reaches the Xtream stream format", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const top =
      {
        "ob-server": 100,
        "ob-username": 200,
        "ob-password": 300,
        "ob-output": 400,
        "ob-name": 500,
      }[this.id] ?? 0;
    return {
      left: 0,
      right: 100,
      top,
      bottom: top + 40,
      width: 100,
      height: 40,
      x: 0,
      y: top,
    } as DOMRect;
  });
  render(<Onboarding onAdd={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  const password = screen.getByLabelText("Password");
  const output = screen.getByLabelText("Stream format");
  password.focus();

  press(KEY.DOWN);
  expect(document.activeElement).toBe(output);

  press(KEY.ENTER);
  expect(screen.getByRole("listbox", { name: "Stream format" })).toBeTruthy();
  const mpegTs = screen.getByRole("option", { name: "MPEG TS" });
  mpegTs.focus();
  press(KEY.ENTER);

  expect(screen.queryByRole("listbox", { name: "Stream format" })).toBeNull();
  expect(output.getAttribute("aria-label")).toBe("Stream format, MPEG TS");
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
  const added: { name: string; source: PlaylistSource }[] = [];
  render(
    <Onboarding
      onAdd={(name, source) => added.push({ name, source })}
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
  expect(added).toEqual([
    { name: "list", source: { kind: "m3u", url: "http://example.com/list.m3u" } },
  ]);
});
