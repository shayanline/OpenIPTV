import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle } from "./support/app";
import {
  createPairingSession,
  listPairedDevices,
  pairDevice,
} from "../src/services/deviceAccess";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

const CATEGORIES = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="Sport",Beta
http://example.invalid/b.m3u8`;

test("settings uses clear sections and concise labels", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  expect(
    [...document.querySelectorAll(".sheet-rail .row-label")].map((el) => el.textContent),
  ).toEqual(["Appearance", "Playback", "Playlists", "About"]);
  expect(Boolean(document.querySelector(".settings-breadcrumb"))).toBe(false);
  const appearance = screen.getByRole("button", { name: "Appearance" });
  expect(appearance.getAttribute("aria-current")).toBe("page");
  expect(Boolean(screen.queryByRole("button", { name: "Watching" }))).toBe(false);
  expect(screen.getByRole("button", { name: "Show channel numbers" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show channel logos" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show clock" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Text size, Medium" })).toBeTruthy();
  expect(Boolean(screen.queryByText("Hide the channel list after"))).toBe(false);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playback" }));
  });
  expect(screen.getByRole("heading", { level: 3, name: "Playback" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Playback" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByText("Screen fit")).toBeTruthy();
  expect(screen.getByText("Resume last channel")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Continuous reconnect" })).toBeTruthy();
  expect(screen.getByText("Compatibility mode")).toBeTruthy();
  expect(screen.getByText(/additional data while repairing/)).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  expect(screen.getByRole("button", { name: "Edit Test" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remove Test" })).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Second" } });
    fireEvent.change(screen.getByLabelText("Playlist address"), {
      target: { value: "http://second.invalid/list.m3u" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  expect(screen.getByRole("status").textContent).toBe("Second saved.");

  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Secondhttp:\/\/second\.invalid/ }));
  });
  expect(screen.getByRole("status").textContent).toBe("Could not load the playlist: offline");
  expect(screen.getByText("Playlists are stored on this device only.")).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "About" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
  });
  expect(screen.getByText(/This device's platform and remote input/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Device and application" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Compatibility" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remote keys" })).toBeTruthy();
});

test("form selects use the same inset chevron spacing as other controls", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  const matches = [...css.matchAll(/\.form select \{([^}]*)\}/g)];
  const rule =
    matches.map((match) => match[1]).find((value) => value.includes("appearance: none")) ?? "";

  expect(rule).toContain("appearance: none");
  expect(rule).toContain("background-position: right var(--s3) center");
  expect(rule).toContain("padding-right: var(--s6)");
});

test("playlist source selection stays distinct from remote focus", () => {
  const css = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  const selected =
    css.match(/\.playlist-source-options \.btn\[aria-pressed="true"\] \{([^}]*)\}/)?.[1] ?? "";
  const focused =
    css.match(
      /\.playlist-source-options \.btn\[aria-pressed="true"\]:focus \{([^}]*)\}/,
    )?.[1] ?? "";

  expect(selected).toContain("background: var(--control-on)");
  expect(selected).toContain("color: var(--on-accent)");
  expect(focused).toContain("background: var(--focus)");
  expect(focused).toContain("color: var(--on-focus)");
});

test("playlist settings keep the specific M3U address guidance", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.com/my list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("alert").textContent).toBe("Addresses cannot contain spaces.");
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);
});

test("playlist settings suggest and prefill Xtream from an M3U address", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value:
        "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus",
    },
  });

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

test("playlist settings extract credentials entered in the Xtream server field", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  fireEvent.change(screen.getByLabelText("Server address"), {
    target: {
      value:
        "https://provider.example/get.php?username=viewer&password=secret&type=m3u_plus&output=ts",
    },
  });

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "https://provider.example",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, MPEG TS",
  );
});

test("the Settings Xtream stream format closes when focus moves to the password", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
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

test("an open language list in Settings keeps the arrow keys inside it", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  const trigger = screen.getByRole("button", { name: "Language, System" });
  trigger.focus();
  press(KEY.ENTER);

  const list = screen.getByRole("listbox", { name: "Language" });
  const start = document.activeElement as HTMLElement;
  expect(start.getAttribute("aria-selected")).toBe("true");

  press(KEY.DOWN);
  const moved = document.activeElement as HTMLElement;
  expect(moved).not.toBe(start);
  expect(list.contains(moved)).toBe(true);

  /* Right closes the list without moving the body navigation underneath it. */
  press(KEY.RIGHT);
  expect(screen.queryByRole("listbox", { name: "Language" })).toBeNull();
  expect(document.activeElement).toBe(trigger);

  press(KEY.ENTER);
  const reopened = screen.getByRole("listbox", { name: "Language" });
  const refocused = document.activeElement as HTMLElement;
  expect(reopened.contains(refocused)).toBe(true);
  expect(refocused.getAttribute("aria-selected")).toBe("true");

  press(KEY.BACK);
  expect(screen.queryByRole("listbox", { name: "Language" })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("playlist settings add Xtream credentials while keeping M3U as the default", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));

  expect(
    screen.getByRole("button", { name: "M3U playlist" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  fireEvent.change(screen.getByLabelText("Server address"), {
    target: { value: "http://provider.example:8080" },
  });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "viewer" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
  fireEvent.click(screen.getByLabelText("Stream format"));
  fireEvent.click(screen.getByRole("option", { name: "MPEG TS" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists[1]).toMatchObject({
    name: "provider.example",
    source: {
      kind: "xtream",
      server: "http://provider.example:8080",
      username: "viewer",
      password: "secret",
      output: "ts",
    },
    sourceVersion: 1,
  });
  expect(document.querySelector(".settings-list-body")?.textContent).toContain(
    "http://provider.example:8080",
  );
  expect(document.querySelector(".settings-list-body")?.textContent).not.toContain("get.php");
  expect(document.querySelector(".settings-list-body")?.textContent).not.toContain("secret");

  fireEvent.click(screen.getByRole("button", { name: "Edit provider.example" }));
  expect(
    screen.getByRole("button", { name: "Xtream login" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://provider.example:8080",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, MPEG TS",
  );

  fireEvent.change(screen.getByLabelText("Server address"), {
    target: { value: "http://new-provider.example:8080" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);
  expect(useSettings.getState().playlists[1]).toMatchObject({
    source: {
      kind: "xtream",
      server: "http://new-provider.example:8080",
      username: "viewer",
      password: "secret",
      output: "ts",
    },
    sourceVersion: 2,
  });
});

test("About groups support and application data beneath concise app information", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "About" }));
  });

  expect(screen.getByRole("heading", { level: 3, name: "About" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Support" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Application data" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Clear cache" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reset app data" })).toBeTruthy();
  expect(document.querySelector(".about-summary")?.textContent).toContain(
    "No OpenIPTV account is required.",
  );
  expect(
    screen.getByRole("link", { name: "https://github.com/shayanline/OpenIPTV" }),
  ).toHaveProperty("tabIndex", -1);
});

test("saved Xtream playlists show safe account status details", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer-private",
      password: "status-secret",
      output: "m3u8",
    });
    const playlist = useSettings.getState().playlists[1];
    useChannels.setState({
      accounts: {
        [playlist.id]: {
          status: "Active",
          expiresAt: 1_900_000_000,
          isTrial: true,
          activeConnections: 1,
          maxConnections: 2,
        },
      },
    });
  });

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

  const row = document.querySelectorAll(".pl")[1];
  expect(row.textContent).toContain("Active trial");
  expect(row.textContent).toContain("Expires");
  expect(row.textContent).toContain("1 of 2 connections active");
  expect(row.textContent).not.toContain("status-secret");
  expect(row.textContent).not.toContain("viewer-private");
});

test("saved Xtream status supports unknown expiry, inactive and expired accounts", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    for (const [name, status] of [
      ["Unknown", "Active"],
      ["Inactive", "Disabled"],
      ["Expired", "Expired"],
    ] as const) {
      useSettings.getState().addPlaylist(name, {
        kind: "xtream",
        server: `https://${name.toLowerCase()}.example`,
        username: "viewer",
        password: "secret",
        output: "m3u8",
      });
      const saved = useSettings.getState().playlists;
      const playlist = saved[saved.length - 1];
      useChannels.setState((state) => ({
        accounts: {
          ...state.accounts,
          [playlist.id]: {
            status: name === "Expired" ? "Active" : status,
            isTrial: false,
            ...(name === "Expired" ? { expiresAt: 1 } : {}),
          },
        },
      }));
    }
  });

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));

  expect(screen.getAllByText("Expiry unknown")).toHaveLength(2);
  expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
});

test("the lineup detail exposes channel and category management scopes", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  expect(screen.getByRole("heading", { level: 3, name: "Lineup" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Channels" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Categories" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reveal hidden" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Channel order" })).toBeTruthy();
});

test("channel edits persist effective name, number, visibility and membership", async () => {
  await mountApp(CATEGORIES, {
    personalLineup: {
      version: 1,
      revision: 1,
      personalisation: {
        personalCategories: [{ id: "mine", name: "Mine", channels: [] }],
      },
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: /AlphaVisible/ }));
  fireEvent.change(screen.getByLabelText("Custom name"), { target: { value: "My Alpha" } });
  fireEvent.change(screen.getByLabelText("Channel number"), { target: { value: "801" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Mine" }));
  fireEvent.click(screen.getByRole("button", { name: "Visible" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(2500);
  const { useLineup } = await import("../src/stores/lineup");
  const channel = useLineup
    .getState()
    .managedChannels.find((item) => item.effective.id === "a");
  expect(channel?.effective.name).toBe("My Alpha");
  expect(channel?.effective.number).toBe(801);
  expect(channel?.hidden).toBe(true);
  expect(
    useLineup.getState().categories.find((item) => item.key === "personal:mine")?.channels[0]
      .id,
  ).toBe("a");
});

test("channel number collisions keep the editor and durable record unchanged", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: /AlphaVisible/ }));
  fireEvent.change(screen.getByLabelText("Channel number"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect(screen.getByText("Another channel already uses this number.")).toBeTruthy();
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().channels[0].number).toBe(1);
});

test("persistence failure keeps the channel draft and shows Retry", async () => {
  await mountApp(CATEGORIES, {
    personalWrite: async () => {
      throw new Error("quota");
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: /AlphaVisible/ }));
  fireEvent.change(screen.getByLabelText("Custom name"), { target: { value: "Retained" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect((screen.getByLabelText("Custom name") as HTMLInputElement).value).toBe("Retained");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("personal category 129 keeps the creation draft and shows the limit", async () => {
  await mountApp(CATEGORIES, {
    personalLineup: {
      version: 1,
      revision: 4,
      personalisation: {
        personalCategories: Array.from({ length: 128 }, (_, index) => ({
          id: String(index),
          name: `Personal ${index}`,
          channels: [],
        })),
      },
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: "Categories" }));
  fireEvent.change(screen.getByLabelText("Personal category name"), {
    target: { value: "One too many" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create category" }));
  await settle(0);
  expect(
    screen.getByText("A playlist can contain up to 128 personal categories."),
  ).toBeTruthy();
  expect((screen.getByLabelText("Personal category name") as HTMLInputElement).value).toBe(
    "One too many",
  );
});

test("personal categories can be created, renamed and deleted with confirmation", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: "Categories" }));
  fireEvent.change(screen.getByLabelText("Personal category name"), {
    target: { value: "Mine" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create category" }));
  await settle(700);
  fireEvent.click(screen.getByRole("button", { name: /MineVisible/ }));
  fireEvent.change(screen.getByLabelText("Custom name"), { target: { value: "Family" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1200);
  fireEvent.click(screen.getByRole("button", { name: /FamilyVisible/ }));
  fireEvent.click(screen.getByRole("button", { name: "Delete personal category" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await settle(700);
  expect(Boolean(screen.queryByText("Family"))).toBe(false);
});

test("unavailable records require confirmation and remove only the selected record", async () => {
  await mountApp(CATEGORIES, {
    personalLineup: {
      version: 1,
      revision: 3,
      personalisation: {
        channels: {
          "m3u:0123456789abcdef": {
            name: "Unavailable custom name",
            sourceFingerprint: "0123456789abcdef",
          },
        },
      },
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  expect(screen.getByText("Unavailable custom name")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Remove" }).slice(-1)[0]);
  await settle(700);
  expect(Boolean(screen.queryByText("Unavailable custom name"))).toBe(false);
});

test("Sort mode restores focus and rolls back a grabbed tentative move", async () => {
  await mountApp(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  const sort = screen.getByRole("button", { name: "Sort" });
  sort.focus();
  fireEvent.click(sort);
  await settle(0);
  const first = document.querySelector<HTMLButtonElement>(
    ".lineup-sort-mode .lineup-manager-row",
  );
  expect(document.activeElement).toBe(first);
  fireEvent.click(first!);
  await settle(0);
  press(KEY.DOWN);
  press(KEY.BACK);
  await settle(0);
  expect(
    document.querySelector(".lineup-sort-mode .lineup-manager-row")?.textContent,
  ).toContain("Alpha");
  press(KEY.BACK);
  await settle(0);
  const restoredSort = screen.getByRole("button", { name: "Sort" });
  expect(document.activeElement).toBe(restoredSort);
  fireEvent.click(restoredSort);
  const grabbed = document.querySelector<HTMLButtonElement>(
    ".lineup-sort-mode .lineup-manager-row",
  );
  fireEvent.click(grabbed!);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  press(KEY.ENTER);
  await settle(700);
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().orderMode).toBe("custom");
});

test("category rename and bulk visibility use effective category records", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Lineup, Test" }));
  fireEvent.click(screen.getByRole("button", { name: "Categories" }));
  fireEvent.click(screen.getByRole("button", { name: /NewsVisible/ }));
  fireEvent.change(screen.getByLabelText("Custom name"), { target: { value: "Headlines" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1200);
  expect(screen.getAllByText("Headlines").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
  await settle(700);
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().managedCategories.every((category) => category.hidden)).toBe(
    true,
  );
});

test("Settings blocks panel movement while it owns input", async () => {
  await mountApp(CATEGORIES);
  const selected = document.querySelector(".panel .row.selected")?.textContent;

  press(KEY.YELLOW);
  press(KEY.DOWN);

  expect(document.querySelector(".sheet")).toBeTruthy();
  expect(document.querySelector(".panel .row.selected")?.textContent).toBe(selected);
});

test("a Settings confirmation owns directional input", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Test" }));

  const section = document.querySelector(".sheet-rail .row.selected")?.textContent;
  const panelRow = document.querySelector(".panel .row.selected")?.textContent;
  press(KEY.RIGHT);

  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(document.querySelector(".sheet-rail .row.selected")?.textContent).toBe(section);
  expect(document.querySelector(".panel .row.selected")?.textContent).toBe(panelRow);
  expect(document.activeElement?.closest(".dialog")).toBeTruthy();
});

test("playlist editors use the same detail back behavior", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Test" }));

  expect(screen.getByRole("heading", { level: 3, name: "Edit playlist" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to Playlists" })).toBeNull();

  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Test" }));
});

test("resetting application data revokes authorised devices", async () => {
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Authorised device" });
  if (!paired.ok) throw new Error("pairing failed");
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  fireEvent.click(screen.getByRole("button", { name: "About" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset app data" }));
  const resetButtons = screen.getAllByRole("button", { name: "Reset app data" });
  fireEvent.click(resetButtons[resetButtons.length - 1]);
  await settle(0);

  expect(listPairedDevices()).toEqual([]);
});
