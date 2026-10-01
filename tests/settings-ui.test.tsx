import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import { mountApp, press } from "./support/app";

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
  expect(screen.getByRole("button", { name: "Playback information" })).toBeTruthy();
  expect(screen.getByText(/Blue remote key/)).toBeTruthy();
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
  expect(screen.getByText(/last eight keys received by the app/)).toBeTruthy();
});

test("each playlist manages its own category visibility", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Playlists" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Manage categories for Test" }));
  });

  expect(screen.getByRole("heading", { level: 3, name: "Test categories" })).toBeTruthy();
  const news = screen.getByRole("button", { name: "News" });
  expect(news.getAttribute("aria-pressed")).toBe("true");
  await act(async () => {
    fireEvent.click(news);
    fireEvent.click(screen.getByRole("button", { name: "Hidden channels, Keep searchable" }));
  });

  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().playlists[0];
  expect(playlist.hiddenCategories).toEqual(["News"]);
  expect(playlist.hiddenCategoryMode).toBe("search");
  expect(screen.getByRole("button", { name: "News" }).getAttribute("aria-pressed")).toBe(
    "false",
  );
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

  expect(screen.getByRole("heading", { level: 3, name: "Second categories" })).toBeTruthy();
  const category = screen.getByRole("button", { name: "Second Sport" });
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

  expect(Boolean(screen.queryByRole("heading", { level: 3, name: "Offline categories" }))).toBe(
    false,
  );
  expect(screen.getByRole("status").textContent).toContain("offline");
  expect(useSettings.getState().activePlaylistId).toBe(first);
});
