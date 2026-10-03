import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { moveWithinPlaylistRow } from "../src/components/Settings";
import { mountApp, press, settle, XTREAM_SOURCE } from "./support/app";
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

const LONG_PLAYLIST_NAME = "📺 قائمة تشغيل طويلة جداً | Family channels and more";
const MIXED_CATEGORY = "📡 أخبار المساء | Evening News and Headlines";
const MIXED_CATEGORIES = `#EXTM3U
#EXTINF:-1 tvg-id="mixed" group-title="${MIXED_CATEGORY}",Mixed Channel
http://example.invalid/mixed.m3u8`;
const MANY_CATEGORIES = `#EXTM3U\n${Array.from(
  { length: 21 },
  (_, index) =>
    `#EXTINF:-1 tvg-id="${index}" group-title="Category ${index + 1}",Channel ${index + 1}\nhttp://example.invalid/${index}.m3u8`,
).join("\n")}`;

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
  expect(screen.getByText("Sort channels alphabetically")).toBeTruthy();
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
  expect(screen.getByRole("button", { name: "Playback information" })).toBeTruthy();
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
  const rule = css.match(/\.form select \{([^}]*)\}/)?.[1] ?? "";

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
        "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=m3u8",
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  expect((screen.getByLabelText("Server address") as HTMLInputElement).value).toBe(
    "http://provider.example:8080",
  );
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
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

test("remote navigation reaches the Categories action in a playlist row", async () => {
  const box = (left: number, width: number): DOMRect =>
    ({
      left,
      right: left + width,
      top: 100,
      bottom: 180,
      width,
      height: 80,
      x: left,
      y: 100,
    }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if (this.classList.contains("pl-main")) return box(500, 360);
    if (this.closest(".pl") && this instanceof HTMLButtonElement) {
      const buttons = Array.from(this.parentElement?.children ?? []);
      return box(870 + buttons.indexOf(this) * 130, 120);
    }
    if (this.closest(".sheet-body")) return box(500, 200);
    return box(0, 100);
  });
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  await settle(0);
  const playlistRow = document.querySelector<HTMLButtonElement>(".pl-main");
  act(() => playlistRow?.focus());
  expect(document.activeElement).toBe(playlistRow);

  expect(moveWithinPlaylistRow(document.activeElement, KEY.RIGHT, KEY.LEFT, KEY.RIGHT)).toBe(
    true,
  );

  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Manage categories for Test" }),
  );
});

test("Categories is a Settings detail screen with hierarchical RETURN", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  const opener = screen.getByRole("button", { name: "Manage categories for Test" });
  fireEvent.click(opener);

  const back = screen.getByRole("button", { name: "Back to Playlists" });
  const first = screen.getByRole("button", {
    name: "Hidden category channels, Hide everywhere",
  });
  expect(Boolean(document.querySelector(".settings-breadcrumb"))).toBe(false);
  expect(document.querySelector(".settings-detail-appbar")?.textContent).toContain(
    "Categories",
  );
  expect(screen.getByRole("heading", { level: 3, name: "Categories" })).toBeTruthy();
  expect(document.querySelector(".sheet-hints")?.textContent).toContain("Back");
  await settle(0);
  expect(document.activeElement).toBe(first);

  press(KEY.UP);
  expect(document.activeElement).toBe(back);
  press(KEY.DOWN);
  expect(document.activeElement).toBe(first);
  press(KEY.LEFT);
  expect(screen.getByRole("heading", { level: 3, name: "Categories" })).toBeTruthy();

  press(KEY.BACK);
  await settle(0);

  const restored = screen.getByRole("button", { name: "Manage categories for Test" });
  expect(document.activeElement).toBe(restored);
  expect(screen.getByRole("heading", { level: 3, name: "Playlists" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
});

test("playlist editors use the same detail back behavior", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Test" }));

  expect(screen.getByRole("heading", { level: 3, name: "Edit playlist" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Back to Playlists" })).toBeTruthy();

  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit Test" }));
});

test("category search and bulk actions expand on demand", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));

  expect(Boolean(screen.queryByRole("textbox", { name: "Search categories" }))).toBe(false);
  expect(Boolean(screen.queryByRole("button", { name: "Hide all categories" }))).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Search categories" }));
  expect(screen.getByRole("textbox", { name: "Search categories" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Category actions" }));
  expect(screen.getByRole("button", { name: "Hide all categories" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Show all categories" })).toBeTruthy();
});

test("each playlist manages its own category visibility", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  const manage = screen.getByRole("button", { name: "Manage categories for Test" });
  expect(manage.textContent).toBe("2 Categories");
  await act(async () => {
    fireEvent.click(manage);
  });

  expect(screen.getByRole("heading", { level: 3, name: "Categories" })).toBeTruthy();
  expect(document.querySelector(".settings-detail-context")?.textContent).toBe("Test");
  expect(screen.getByText("Hidden category channels")).toBeTruthy();
  expect(
    screen.getByText("Choose whether hidden channels also appear in Search and Favourites"),
  ).toBeTruthy();
  const news = screen.getByRole("button", { name: "Hide News" });
  await act(async () => news.focus());
  expect(document.querySelector(".sheet-hints")?.textContent).toContain("Hide category");
  expect(document.querySelector(".sheet-hints")?.textContent).not.toContain("Hide News");
  await act(async () => {
    fireEvent.click(news);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Hidden category channels, Hide everywhere",
      }),
    );
  });

  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];
  expect(playlist.hiddenCategories).toEqual(["News"]);
  expect(playlist.hiddenCategoryMode).toBe("search");
  expect(screen.getByRole("button", { name: "Unhide News" })).toBeTruthy();
  expect(document.querySelector(".sheet-hints")?.textContent).toContain("Unhide category");
  expect(document.querySelector(".sheet-hints")?.textContent).not.toContain("Unhide News");
});

test("playlist settings can hide and show every category", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));
  });
  const { useSettings } = await import("../src/stores/settings");

  fireEvent.click(screen.getByRole("button", { name: "Category actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide all categories" }));
  const hideAll = screen.getAllByRole("button", { name: "Hide all categories" });
  fireEvent.click(hideAll[hideAll.length - 1]);
  expect(useSettings.getState().playlists[0].hiddenCategories).toEqual(["News", "Sport"]);
  expect(screen.getByRole("button", { name: "Unhide News" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Category actions" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Show all categories" }));
  });
  expect(useSettings.getState().playlists[0].hiddenCategories).toEqual([]);
  expect(screen.getByRole("button", { name: "Hide News" })).toBeTruthy();
});

test("category paging recovers when a refresh returns fewer categories", async () => {
  await mountApp(MANY_CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));
  const rows = document.querySelectorAll<HTMLButtonElement>(".category-setting-row");
  fireEvent.keyDown(rows[rows.length - 1], { keyCode: KEY.DOWN });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Category 21")).toBeTruthy();

  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    const state = useChannels.getState();
    useChannels.setState({
      channels: state.channels.slice(0, 1),
      categories: state.categories.slice(0, 1),
      managedCategories: state.managedCategories.slice(0, 1),
    });
  });

  expect(
    [...document.querySelectorAll(".sheet-body .category-setting-row")].some((element) =>
      element.textContent?.includes("Category 1"),
    ),
  ).toBe(true);
  expect(Boolean(screen.queryByText("No categories match this search."))).toBe(false);
});

test("an empty category manager explains that the playlist has no categories", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));
  const { useChannels } = await import("../src/stores/channels");
  act(() => useChannels.setState({ channels: [], categories: [], managedCategories: [] }));

  expect(screen.getByText("This playlist has no categories.")).toBeTruthy();
  expect(Boolean(screen.queryByText("No categories match this search."))).toBe(false);
});

test("category settings preserve arbitrary playlist content outside fixed labels", async () => {
  await mountApp(MIXED_CATEGORIES);
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];
  await act(async () => {
    useSettings.getState().updatePlaylist(playlist.id, LONG_PLAYLIST_NAME, playlist.source);
  });

  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: `Manage categories for ${LONG_PLAYLIST_NAME}` }),
    );
  });

  const playlistName = document.querySelector(".settings-detail-context [dir='auto']");
  expect(playlistName?.textContent).toBe(LONG_PLAYLIST_NAME);
  const categoryName = document.querySelector(".sheet-body .category-setting-row [dir='auto']");
  expect(categoryName?.textContent).toBe(MIXED_CATEGORY);
  expect(categoryName?.getAttribute("dir")).toBe("auto");
  expect(screen.getByRole("button", { name: `Hide ${MIXED_CATEGORY}` })).toBeTruthy();
});

test("managing an inactive playlist loads that playlist before showing its categories", async () => {
  await mountApp(CATEGORIES);
  const { useSettings } = await import("../src/stores/settings");
  await act(async () => {
    useSettings
      .getState()
      .addPlaylist("Second", { kind: "m3u", url: "http://list.invalid/second.m3u" });
  });
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true,
    text: async () => `#EXTM3U
#EXTINF:-1 tvg-id="s" group-title="Second Sport",Second Channel
http://example.invalid/s.m3u8`,
  } as Response);

  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Manage categories for Second" }));
  });

  expect(screen.getByRole("heading", { level: 3, name: "Categories" })).toBeTruthy();
  expect(document.querySelector(".settings-detail-context")?.textContent).toBe("Second");
  const category = screen.getByRole("button", { name: "Hide Second Sport" });
  await act(async () => {
    fireEvent.click(category);
  });

  const [first, second] = useSettings.getState().playlists;
  expect(first.hiddenCategories).toEqual([]);
  expect(second.hiddenCategories).toEqual(["Second Sport"]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back to Playlists" }));
  });
  expect(screen.getByRole("status").textContent).toBe(
    "1 channel loaded from the active playlist.",
  );
});

test("a failed inactive playlist load does not show categories from the active playlist", async () => {
  await mountApp(CATEGORIES);
  const { useSettings } = await import("../src/stores/settings");
  await act(async () => {
    useSettings
      .getState()
      .addPlaylist("Offline", { kind: "m3u", url: "http://list.invalid/offline.m3u" });
  });
  const first = useSettings.getState().activePlaylistId;
  vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));

  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Manage categories for Offline" }));
  });

  expect(Boolean(document.querySelector(".settings-detail-context"))).toBe(false);
  expect(screen.getByRole("status").textContent).toContain("offline");
  expect(useSettings.getState().activePlaylistId).toBe(first);
});

test("Xtream category management includes every content kind with visible paging controls", async () => {
  const liveCategories = Array.from({ length: 25 }, (_, index) => ({
    category_id: `live-${index + 1}`,
    category_name: `Live category ${index + 1}`,
  }));
  const movieCategories = Array.from({ length: 25 }, (_, index) => ({
    category_id: `movie-${index + 1}`,
    category_name: `Movie category ${index + 1}`,
  }));
  const seriesCategories = Array.from({ length: 5 }, (_, index) => ({
    category_id: `series-${index + 1}`,
    category_name: `Series category ${index + 1}`,
  }));
  const fetchImplementation = async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const body: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: liveCategories,
      get_vod_categories: movieCategories,
      get_series_categories: seriesCategories,
      get_live_streams: [],
    };
    return { ok: true, status: 200, json: async () => body[action] } as Response;
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  expect(screen.getByRole("button", { name: "Manage categories for Test" }).textContent).toBe(
    "55 Categories",
  );
  fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));

  expect(screen.getByRole("button", { name: "Hide Live category 1" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Hide Live category 21" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("button", { name: "Hide Live category 21" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous" })).toBeTruthy();
  fireEvent.click(document.querySelectorAll(".category-kind-option")[2]);
  expect(screen.getByRole("button", { name: "Hide Series category 5" })).toBeTruthy();
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

  expect(listPairedDevices()).toEqual([]);
});
