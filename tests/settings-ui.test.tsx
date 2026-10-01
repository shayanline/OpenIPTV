import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press } from "./support/app";
import { createPairingSession, listPairedPhones, pairPhone } from "../src/services/phoneAccess";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
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
  expect(document.querySelector(".category-playlist-name")?.textContent).toBe("Test");
  expect(screen.getByText("Hidden category channels")).toBeTruthy();
  expect(
    screen.getByText("Choose whether hidden channels also appear in Search and Favourites"),
  ).toBeTruthy();
  const news = screen.getByRole("button", { name: "Hide News" });
  expect(news.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    fireEvent.click(news);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Hidden category channels, Keep in Search and Favourites",
      }),
    );
  });

  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];
  expect(playlist.hiddenCategories).toEqual(["News"]);
  expect(playlist.hiddenCategoryMode).toBe("search");
  expect(screen.getByRole("button", { name: "Unhide News" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
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

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Hide all categories" }));
  });
  expect(useSettings.getState().playlists[0].hiddenCategories).toEqual(["News", "Sport"]);
  expect(screen.getByRole("button", { name: "Unhide News" }).getAttribute("aria-pressed")).toBe(
    "false",
  );

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Unhide all categories" }));
  });
  expect(useSettings.getState().playlists[0].hiddenCategories).toEqual([]);
  expect(screen.getByRole("button", { name: "Hide News" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
});

test("category paging recovers when a refresh returns fewer categories", async () => {
  await mountApp(MANY_CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
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
    [...document.querySelectorAll(".sheet-body .field-label")].some(
      (element) => element.textContent === "Category 1",
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

  const playlistName = document.querySelector(".category-playlist-name [dir='auto']");
  expect(playlistName?.textContent).toBe(LONG_PLAYLIST_NAME);
  const categoryName = document.querySelector(".sheet-body .field-label [dir='auto']");
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
  expect(document.querySelector(".category-playlist-name")?.textContent).toBe("Second");
  const category = screen.getByRole("button", { name: "Hide Second Sport" });
  await act(async () => {
    fireEvent.click(category);
  });

  const [first, second] = useSettings.getState().playlists;
  expect(first.hiddenCategories).toEqual([]);
  expect(second.hiddenCategories).toEqual(["Second Sport"]);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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

  expect(Boolean(document.querySelector(".category-playlist-name"))).toBe(false);
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
