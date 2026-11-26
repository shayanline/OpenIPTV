import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Onboarding } from "../src/components/Onboarding";
import { KEY } from "../src/hooks/useRemote";
import { translate } from "../src/services/locale";
import type { PlaylistSource } from "../src/services/playlistUrl";
import type { RemoteAccessState } from "../src/services/remoteServer";
import { useSettings } from "../src/stores/settings";
import { useSetup } from "../src/stores/setup";
import { press } from "./support/app";

beforeEach(() => {
  localStorage.clear();
  useSettings.getState().set("locale", "en");
  useSetup.getState().clear();
});

afterEach(() => {
  cleanup();
});

test("first setup suppresses duplicate submission while adoption is pending", async () => {
  let finish: (() => void) | undefined;
  let advance: ((state: "saving") => void) | undefined;
  const onAdd = vi.fn(
    (_name: string, _source: PlaylistSource, onState?: (state: "saving") => void) => {
      advance = onState;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
  );
  render(<Onboarding onAdd={onAdd} onError={() => {}} onExit={() => {}} />);
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.invalid/list.m3u" },
  });
  const submit = screen.getByRole("button", { name: "Add a playlist" });

  fireEvent.click(submit);
  fireEvent.click(submit);

  expect(onAdd).toHaveBeenCalledOnce();
  expect(submit.getAttribute("aria-busy")).toBe("true");
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(
    "http://example.invalid/list.m3u",
  );
  expect(submit.querySelector(".spinner.small")).toBeTruthy();

  act(() => advance?.("saving"));
  expect(submit.querySelector(".spinner.small")).toBeTruthy();
  finish?.();
  await act(async () => Promise.resolve());
  expect(submit.getAttribute("aria-busy")).toBeNull();
});

test("Welcome reports a recoverable operation failure only through notifications", async () => {
  const onError = vi.fn();
  const onAdd = vi.fn(() => Promise.reject(new TypeError("network unavailable")));
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "https://provider.example/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await act(async () => Promise.resolve());
  expect(onError).toHaveBeenCalledOnce();
  expect(document.querySelector(".onboard-form .field-problem")).toBeNull();
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(
    "https://provider.example/list.m3u",
  );
  expect(
    (screen.getByRole("button", { name: "Add a playlist" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("failed first setup keeps its draft and reports through onError", async () => {
  const onAdd = vi.fn(async () => {
    throw new Error("Could not load the playlist: offline");
  });
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  const address = screen.getByLabelText("Playlist address") as HTMLInputElement;
  fireEvent.change(address, { target: { value: "http://example.invalid/list.m3u" } });

  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await act(async () => Promise.resolve());

  expect(onError).toHaveBeenCalledWith(translate("en", "playlist.entryNetwork"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(address.value).toBe("http://example.invalid/list.m3u");
  expect(
    (screen.getByRole("button", { name: "Add a playlist" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("the first run screen lets the viewer change language before adding a playlist", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

  expect(document.querySelector(".onboard-split")).toBeFalsy();
  expect(screen.queryByText("Set up with another device")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Language, English" }));
  fireEvent.click(screen.getByRole("option", { name: "فارسی Persian" }));

  expect(useSettings.getState().locale).toBe("fa");
  expect(screen.getByText("زبان")).toBeTruthy();
});

test("device setup typing and language mirror onto the player welcome form", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

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
  render(<Onboarding onAdd={onAdd} onError={() => {}} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "example.com/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));

  expect(screen.getByRole("alert").textContent).toBe(
    "Start the address with http:// or https://",
  );
  expect(onAdd).not.toHaveBeenCalled();
});

test("Welcome puts validation below each field and keeps later fields reachable", () => {
  const onAdd = vi.fn(() => new Promise<void>(() => {}));
  render(<Onboarding onAdd={onAdd} onError={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  const server = screen.getByLabelText("Server address");
  const username = screen.getByLabelText("Username");
  const password = screen.getByLabelText("Password");
  const format = screen.getByLabelText("Stream format");
  const name = screen.getByLabelText("Name it (optional)") as HTMLInputElement;
  const submit = screen.getByRole("button", { name: "Add a playlist" });
  fireEvent.click(submit);
  for (const [field, message] of [
    [server, "Enter the server address."],
    [username, "Enter your username."],
    [password, "Enter your password."],
  ] as const) {
    const problem = document.getElementById(field.getAttribute("aria-describedby") ?? "");
    expect(problem?.textContent).toBe(message);
    expect(problem?.getAttribute("role")).toBe("alert");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  }
  expect(onAdd).not.toHaveBeenCalled();

  fireEvent.change(server, { target: { value: "https://provider.example" } });
  fireEvent.click(submit);
  expect(server.getAttribute("aria-invalid")).toBeNull();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  act(() => format.focus());
  press(KEY.DOWN);
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "Draft" } });
  press(KEY.UP);
  expect(document.activeElement).toBe(format);

  act(() => username.focus());
  fireEvent.change(username, { target: { value: "viewer" } });
  expect(document.activeElement).toBe(username);
  expect(username.getAttribute("aria-invalid")).toBeNull();
  expect(password.getAttribute("aria-invalid")).toBe("true");
  fireEvent.click(submit);
  expect(screen.getByRole("alert").textContent).toBe("Enter your password.");
  fireEvent.change(password, { target: { value: "secret" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(submit);
  expect(onAdd).toHaveBeenCalledOnce();
  expect(onAdd.mock.calls[0]?.slice(0, 2)).toEqual([
    "Draft",
    {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    },
  ]);
});

test("Welcome M3U errors stay under the URL and do not block the optional name", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
  const address = screen.getByLabelText("Playlist address");
  const name = screen.getByLabelText("Name it (optional)");
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  const problem = document.getElementById(address.getAttribute("aria-describedby") ?? "");
  expect(problem?.textContent).toBe("Enter the address of a playlist.");
  act(() => address.focus());
  press(KEY.DOWN);
  expect(document.activeElement).toBe(name);
  fireEvent.change(address, { target: { value: "https://provider.example/list.m3u" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("M3U setup suggests Xtream and prefills the login when accepted", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value:
        "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus",
    },
  });

  expect(screen.getByText("This address contains an Xtream login.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  const xtream = screen.getByRole("button", { name: "Xtream login" });
  expect(document.activeElement).toBe(xtream);
  fireEvent.keyDown(xtream, { keyCode: KEY.DOWN });
  expect(document.activeElement).toBe(screen.getByLabelText("Server address"));
  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://provider.example:8080",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, HLS (Recommended)",
  );
});

test("M3U setup can keep a detected Xtream address as M3U", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

  const address =
    "http://provider.example/get.php?username=viewer&password=secret&type=m3u_plus";
  fireEvent.change(screen.getByLabelText("Playlist address"), { target: { value: address } });
  fireEvent.click(screen.getByRole("button", { name: "Keep M3U" }));

  expect(screen.queryByText("This address contains an Xtream login.")).toBeNull();
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(address);
});

test("Xtream setup extracts credentials pasted into the server field", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  fireEvent.change(screen.getByLabelText("Server address"), {
    target: {
      value:
        "https://provider.example/portal/get.php?username=user%20name&password=p%26ss&type=m3u_plus",
    },
  });

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "https://provider.example/portal",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("user name");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("p&ss");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, HLS (Recommended)",
  );
});

test("a credential-less Xtream template still raises the suggestion", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value: "http://template.example/get.php?username=&password=&type=m3u_plus&output=m3u8",
    },
  });

  expect(screen.getByText("This address contains an Xtream login.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://template.example",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, HLS (Recommended)",
  );
});

test("a watermarked Xtream address still raises the suggestion and converts", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value:
        "http://listshare@watermarked.example:80/get.php?username=viewer&password=secret&type=m3u",
    },
  });

  expect(screen.getByText("This address contains an Xtream login.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://watermarked.example",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
});

test("an open stream format list keeps the arrow keys inside it", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  const output = screen.getByLabelText("Stream format");
  output.focus();

  press(KEY.ENTER);
  const list = screen.getByRole("listbox", { name: "Stream format" });
  expect(document.activeElement).toBe(
    screen.getByRole("option", { name: "HLS (Recommended)" }),
  );

  press(KEY.DOWN);
  const mpegTs = screen.getByRole("option", { name: "MPEG TS" });
  expect(document.activeElement).toBe(mpegTs);
  expect(list.contains(document.activeElement)).toBe(true);

  /* Left is a way out rather than a sideways move: the press only closes the list, and
     focus lands back on the trigger. */
  press(KEY.LEFT);
  expect(screen.queryByRole("listbox", { name: "Stream format" })).toBeNull();
  expect(document.activeElement).toBe(output);
  expect(output.getAttribute("aria-label")).toBe("Stream format, HLS (Recommended)");

  press(KEY.ENTER);
  press(KEY.DOWN);
  press(KEY.ENTER);
  expect(screen.queryByRole("listbox", { name: "Stream format" })).toBeNull();
  expect(output.getAttribute("aria-label")).toBe("Stream format, MPEG TS");
});

test("an open language list keeps focus inside and Return closes it", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Language, English" });
  trigger.focus();
  press(KEY.ENTER);

  const list = screen.getByRole("listbox", { name: "Language" });
  const start = document.activeElement as HTMLElement;
  expect(list.contains(start)).toBe(true);

  press(KEY.DOWN);
  const moved = document.activeElement as HTMLElement;
  expect(list.contains(moved)).toBe(true);
  expect(moved).not.toBe(start);

  press(KEY.UP);
  expect(document.activeElement).toBe(start);

  press(KEY.BACK);
  expect(screen.queryByRole("listbox", { name: "Language" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("language options scroll only at the menu edge and hover preserves wheel position", () => {
  const previousMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "remote";
  const scrollIntoView = vi
    .spyOn(Element.prototype, "scrollIntoView")
    .mockImplementation(() => {});
  try {
    render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Language, English" });
    trigger.focus();
    press(KEY.ENTER);
    const list = screen.getByRole("listbox", { name: "Language" });
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')];
    const selected = options.indexOf(document.activeElement as HTMLElement);
    expect(selected).toBeGreaterThanOrEqual(0);
    Object.defineProperty(list, "clientHeight", { configurable: true, value: 128 });
    for (const [index, option] of options.entries()) {
      Object.defineProperty(option, "offsetTop", { configurable: true, value: index * 64 });
      Object.defineProperty(option, "offsetHeight", { configurable: true, value: 64 });
    }
    list.scrollTop = 0;
    const page = document.querySelector<HTMLElement>(".onboard-box")!;
    page.scrollTop = 91;
    scrollIntoView.mockClear();
    const next = options[selected + 1];
    const nextFocus = vi.spyOn(next, "focus");
    try {
      press(KEY.DOWN);
      expect(document.activeElement).toBe(next);
      expect(nextFocus).toHaveBeenCalledWith({ preventScroll: true });
      expect(list.scrollTop).toBe(Math.max(0, (selected + 2) * 64 - 128));
      expect(page.scrollTop).toBe(91);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      nextFocus.mockRestore();
    }

    list.scrollTop += 12;
    const beforeHover = list.scrollTop;
    const position = list.style.top;
    const partial = options[Math.floor(list.scrollTop / 64)];
    const hoverFocus = vi.spyOn(partial, "focus");
    try {
      document.documentElement.dataset.inputMode = "pointer";
      fireEvent.scroll(list);
      fireEvent.pointerEnter(partial);
      expect(hoverFocus).toHaveBeenCalledWith({ preventScroll: true });
      expect(list.scrollTop).toBe(beforeHover);
      expect(list.style.top).toBe(position);
      expect(page.scrollTop).toBe(91);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      hoverFocus.mockRestore();
    }
  } finally {
    scrollIntoView.mockRestore();
    if (previousMode) document.documentElement.dataset.inputMode = previousMode;
    else delete document.documentElement.dataset.inputMode;
  }
});

test("source buttons own physical arrow navigation on the welcome screen", () => {
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
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
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add a playlist" }));
  /* The language picker sits in the header above the form, so it is the last stop down
     before the cycle wraps back to the selected source. */
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
    <Onboarding
      onAdd={(name, source) => added.push({ name, source })}
      onError={() => {}}
      onExit={() => {}}
    />,
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
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
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
  render(<Onboarding onAdd={() => {}} onError={() => {}} onExit={() => {}} />);
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

test("welcome hides unavailable remote setup and its divider without losing the form", () => {
  const management: RemoteAccessState = {
    status: "listening",
    address: "192.168.1.8",
    port: 8976,
    remotePath: "/remote/index.html",
    pairing: { secret: "fixture", code: "123456", expiresAt: Date.now() + 60_000 },
    pairingError: false,
    connectedDevice: "",
    error: "",
  };
  const props = {
    onAdd: vi.fn(),
    onError: vi.fn(),
    onExit: vi.fn(),
    remoteAccess: management,
    showRemoteSetup: true,
  };
  const view = render(<Onboarding {...props} />);
  expect(document.querySelector(".remote-setup")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.invalid/draft.m3u" },
  });
  view.rerender(
    <Onboarding
      {...props}
      remoteAccess={{ ...management, status: "unavailable", pairing: null }}
    />,
  );
  expect(document.querySelector(".onboard-single")).toBeTruthy();
  expect(document.querySelector(".remote-setup, .onboard-divider")).toBeNull();
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(
    "http://example.invalid/draft.m3u",
  );
  view.rerender(
    <Onboarding
      {...props}
      remoteAccess={{ ...management, status: "starting", pairing: null }}
    />,
  );
  expect(document.querySelector(".onboard-split .onboard-divider")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Starting remote access");
  view.rerender(<Onboarding {...props} showRemoteSetup={false} />);
  expect(document.querySelector(".remote-setup, .onboard-divider")).toBeNull();
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
      onError={() => {}}
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

test("a late failure from a superseded source cannot contaminate the new draft", async () => {
  let rejectFirst: ((error: Error) => void) | undefined;
  const onAdd = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    )
    .mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.invalid/list.m3u" },
  });
  const submit = screen.getByRole("button", { name: "Add a playlist" });
  fireEvent.click(submit);
  expect(submit.querySelector(".spinner.small")).toBeTruthy();

  const m3uChoice = screen.getByRole("button", { name: "M3U playlist" });
  const xtreamChoice = screen.getByRole("button", { name: "Xtream login" });
  const address = screen.getByLabelText("Playlist address") as HTMLInputElement;
  expect((m3uChoice as HTMLButtonElement).disabled).toBe(true);
  expect((xtreamChoice as HTMLButtonElement).disabled).toBe(true);
  expect(address.disabled).toBe(true);
  expect(submit.getAttribute("aria-busy")).toBe("true");

  act(() => {
    useSetup.getState().set({
      name: "",
      source: {
        kind: "xtream",
        server: "",
        username: "",
        password: "",
        output: "m3u8",
      },
    });
  });

  const server = screen.getByLabelText("Server address") as HTMLInputElement;
  expect(server.disabled).toBe(false);
  expect(
    (screen.getByRole("button", { name: "M3U playlist" }) as HTMLButtonElement).disabled,
  ).toBe(false);

  await act(async () => {
    rejectFirst!(new Error("stale failure"));
    await Promise.resolve();
  });

  expect(onError).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(submit.getAttribute("aria-busy")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "M3U playlist" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(server.disabled).toBe(false);

  fireEvent.change(server, {
    target: { value: "http://provider.example" },
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a failed setup reports once and a corrected draft can resubmit", async () => {
  const onAdd = vi
    .fn()
    .mockRejectedValueOnce(new Error("Could not load the playlist: offline"))
    .mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Onboarding onAdd={onAdd} onError={onError} onExit={() => {}} />);
  const address = screen.getByLabelText("Playlist address") as HTMLInputElement;
  fireEvent.change(address, { target: { value: "http://example.invalid/list.m3u" } });
  const submit = screen.getByRole("button", { name: "Add a playlist" });
  fireEvent.click(submit);
  await act(async () => Promise.resolve());

  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(translate("en", "playlist.entryNetwork"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(submit.getAttribute("aria-busy")).toBeNull();

  fireEvent.change(address, { target: { value: "http://example.invalid/other.m3u" } });
  fireEvent.click(submit);
  await act(async () => Promise.resolve());

  expect(onAdd).toHaveBeenCalledTimes(2);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onAdd.mock.calls[1][1]).toEqual({
    kind: "m3u",
    url: "http://example.invalid/other.m3u",
  });
  expect(address.value).toBe("");
});
