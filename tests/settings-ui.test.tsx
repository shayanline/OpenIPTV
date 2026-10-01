import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press, settle } from "./support/app";
import { createPairingSession, listPairedPhones, pairPhone } from "../src/services/phoneAccess";

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
  ).toEqual(["Appearance", "Playback", "General", "Playlists", "Diagnostics", "About"]);
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
  expect(Boolean(screen.queryByText("Resume last channel"))).toBe(false);
  expect(Boolean(screen.queryByRole("button", { name: "Playback information" }))).toBe(false);
  expect(screen.getByText("Compatibility mode")).toBeTruthy();
  expect(screen.getByText(/additional data while repairing/)).toBeTruthy();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "General" }));
  });
  expect(screen.getByRole("heading", { level: 3, name: "General" })).toBeTruthy();
  expect(screen.getByText("Resume last channel")).toBeTruthy();
  const reset = screen.getByRole("button", { name: "Reset app data" });
  expect(Boolean(reset.closest(".field"))).toBe(true);

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
  expect(
    [...document.querySelectorAll(".sheet-body .sheet-lead")].some(
      (el) => el.textContent === "Could not refresh: offline. Showing the last saved copy.",
    ),
  ).toBe(true);
  expect(
    [...document.querySelectorAll(".sheet-body .sheet-lead")].some(
      (el) => el.textContent === "Playlists are stored on this device only.",
    ),
  ).toBe(true);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
  });
  expect(screen.getByText(/This device's platform and remote input/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Playback information" })).toBeTruthy();
  expect(screen.getByText(/until you turn them off here/)).toBeTruthy();
  expect(screen.getByText(/last eight keys received by the app/)).toBeTruthy();
});

test("About explains every category shortcut in one place", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "About" }));
  });

  const heading = screen.getByRole("heading", { level: 4, name: "Category shortcuts" });
  const shortcuts = heading.closest(".category-shortcuts");
  expect(shortcuts?.textContent).toContain(
    "RedIn the category list, hide or unhide the highlighted category",
  );
  expect(shortcuts?.textContent).toContain(
    "Hold RedWith a channel or category focused, show or hide hidden categories",
  );
  expect(shortcuts?.textContent).toContain("Changes are saved immediately.");
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

  press(KEY.RIGHT);

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

  expect(screen.getByRole("button", { name: "Back to Playlists" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 3, name: "Categories" })).toBeTruthy();
  expect(document.querySelector(".sheet-hints")?.textContent).toContain("Back");

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
  expect(manage.textContent).toBe("Categories");
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
  expect(screen.getByText("Category 21")).toBeTruthy();

  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    const state = useChannels.getState();
    useChannels.setState({
      channels: state.channels.slice(0, 1),
      categories: state.categories.slice(0, 1),
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
  act(() => useChannels.setState({ channels: [], categories: [] }));

  expect(screen.getByText("This playlist has no categories.")).toBeTruthy();
  expect(Boolean(screen.queryByText("No categories match this search."))).toBe(false);
});

test("category settings preserve arbitrary playlist content outside fixed labels", async () => {
  await mountApp(MIXED_CATEGORIES);
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];
  await act(async () => {
    useSettings.getState().updatePlaylist(playlist.id, LONG_PLAYLIST_NAME, playlist.url);
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
    useSettings.getState().addPlaylist("Second", "http://list.invalid/second.m3u");
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
  expect(Boolean(screen.queryByRole("status"))).toBe(false);
});

test("a failed inactive playlist load does not show categories from the active playlist", async () => {
  await mountApp(CATEGORIES);
  const { useSettings } = await import("../src/stores/settings");
  await act(async () => {
    useSettings.getState().addPlaylist("Offline", "http://list.invalid/offline.m3u");
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

test("resetting application data revokes remembered phones", async () => {
  const session = createPairingSession();
  const paired = await pairPhone({ secret: session.secret, name: "Remembered phone" });
  if (!paired.ok) throw new Error("pairing failed");
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  fireEvent.click(screen.getByRole("button", { name: "General" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset app data" }));
  const resetButtons = screen.getAllByRole("button", { name: "Reset app data" });
  fireEvent.click(resetButtons[resetButtons.length - 1]);

  expect(listPairedPhones()).toEqual([]);
});
