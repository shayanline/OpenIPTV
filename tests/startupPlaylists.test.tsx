import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { KEY } from "../src/hooks/useRemote";
import { translate } from "../src/services/locale";
import type { Playlist } from "../src/stores/settings";
import {
  finishPageEntry,
  mountApp,
  panelOpen,
  played,
  press,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8`;

const playlists: Playlist[] = [
  {
    id: "pl-1",
    name: "Television",
    source: { kind: "m3u", url: "http://first.invalid/list.m3u" },
    sourceVersion: 1,
  },
  {
    id: "pl-2",
    name: "Radio",
    source: { kind: "m3u", url: "http://second.invalid/list.m3u" },
    sourceVersion: 1,
  },
];

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.style.removeProperty("--t-navigation");
  vi.unstubAllGlobals();
  vi.doUnmock("../src/services/player");
});

test.each(["pl-1", "pl-2"])(
  "startup fades out before loading %s without contacting another provider",
  async (id) => {
    await mountApp(PLAYLIST, {
      savedPlaylists: playlists,
      startupPlaylist: { mode: "ask" },
      playlistShortcut: false,
      awaitPlaylist: false,
      strict: true,
    });
    await settle(100);
    expect(screen.getByRole("heading", { name: "Choose a playlist" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Television" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(played).toEqual([]);
    document.documentElement.style.setProperty("--t-navigation", "180ms");
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: playlists.find((playlist) => playlist.id === id)!.name,
      }),
    );
    expect(
      document.querySelector("[data-startup-playlists]")?.getAttribute("data-page-transition"),
    ).toBe("leaving");
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: playlists.find((playlist) => playlist.id !== id)!.name,
      }),
    );
    await settle(179);
    expect(document.querySelector("[data-startup-playlists]")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    await settle(1);
    const { useSettings } = await import("../src/stores/settings");
    expect(useSettings.getState().activePlaylistId).toBe(id);
    expect(document.querySelector("[data-startup-playlists]")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
      id === "pl-1" ? "http://first.invalid/list.m3u" : "http://second.invalid/list.m3u",
    ]);
    expect(played).toEqual([]);
    expect(panelOpen()).toBe(true);
  },
);

test("the chooser also defers hidden Xtream catalogue work", async () => {
  localStorage.setItem("app:last-mode:pl-1", "movie");
  await mountApp(PLAYLIST, {
    savedPlaylists: [{ ...playlists[0], source: XTREAM_SOURCE }, playlists[1]],
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
  });
  await settle(1000);
  expect(fetch).not.toHaveBeenCalled();
  expect(document.querySelector(".vod-host")).toBeNull();
  fireEvent.click(screen.getByRole("menuitem", { name: "Radio" }));
  await settle(0);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
    "http://second.invalid/list.m3u",
  ]);
});

test("Return asks to exit without choosing a playlist and cancel restores the chooser", async () => {
  await mountApp(PLAYLIST, {
    savedPlaylists: playlists,
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
    resume: "a",
  });
  expect(played).toEqual([]);
  const selected = screen.getByRole("menuitem", { name: "Television" });
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { name: "Exit OpenIPTV?" })).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  expect(played).toEqual([]);
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");
  fireEvent.click(screen.getByRole("button", { name: "Keep app open" }));
  await settle(0);
  expect(screen.queryByRole("heading", { name: "Exit OpenIPTV?" })).toBeNull();
  expect(document.activeElement).toBe(selected);
  expect(fetch).not.toHaveBeenCalled();
  press(KEY.ENTER);
  await settle(0);
  expect(played).toEqual(["http://example.invalid/a.m3u8"]);
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
});

test.each(["ask", "specific"] as const)(
  "%s startup resumes the chosen playlist's own remembered channel",
  async (mode) => {
    localStorage.setItem("app:last-live:pl-2", "a");
    await mountApp(PLAYLIST, {
      savedPlaylists: playlists,
      startupPlaylist: mode === "specific" ? { mode, playlistId: "pl-2" } : { mode },
      awaitPlaylist: mode !== "ask",
      resume: "a-different-channel",
    });
    if (mode === "ask") {
      fireEvent.click(screen.getByRole("menuitem", { name: "Radio" }));
      await settle(0);
    }
    expect(played).toEqual(["http://example.invalid/a.m3u8"]);
    expect(panelOpen()).toBe(false);
  },
);

test.each([
  { mode: "last" as const, expected: "pl-2", url: "http://second.invalid/list.m3u" },
  {
    mode: "specific" as const,
    playlistId: "pl-1",
    expected: "pl-1",
    url: "http://first.invalid/list.m3u",
  },
])("the $mode startup choice loads only its selected playlist", async (preference) => {
  await mountApp(PLAYLIST, {
    savedPlaylists: playlists,
    activePlaylistId: "pl-2",
    startupPlaylist:
      preference.mode === "specific"
        ? { mode: "specific", playlistId: preference.playlistId }
        : { mode: "last" },
  });
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().activePlaylistId).toBe(preference.expected);
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([preference.url]);
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
});

test("a missing remembered channel opens the selected playlist's channel list", async () => {
  localStorage.setItem("app:last-live:pl-2", "removed-channel");
  await mountApp(PLAYLIST, {
    savedPlaylists: playlists,
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => useSettings.getState().set("resumeLast", true));
  fireEvent.click(screen.getByRole("menuitem", { name: "Radio" }));
  await settle(0);
  expect(played).toEqual([]);
  expect(panelOpen()).toBe(true);
});

test("Always ask opens a single playlist directly and keeps an empty installation in onboarding", async () => {
  await mountApp(PLAYLIST, { startupPlaylist: { mode: "ask" } });
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
  expect(panelOpen()).toBe(true);
  cleanup();
  await mountApp("", { emptyPlaylists: true, startupPlaylist: { mode: "ask" } });
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
  expect(document.querySelector(".onboard")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["en", "fa"] as const)(
  "startup hides navigation actions and keeps %s focus on visible controls",
  async (locale) => {
    await mountApp(PLAYLIST, {
      savedPlaylists: playlists,
      startupPlaylist: { mode: "ask" },
      awaitPlaylist: false,
      locale,
    });
    expect(document.querySelector(".playlist-shortcut .sheet-edge-back")).toBeNull();
    expect(document.querySelector(".playlist-shortcut-manage")).toBeNull();
    press(KEY.UP);
    const search = screen.getByRole("textbox", {
      name: translate(locale, "playlist.searchPlaylists"),
    });
    expect(document.activeElement).toBe(search);
    press(KEY.UP);
    press(KEY.LEFT);
    press(KEY.RIGHT);
    expect(document.activeElement).toBe(search);
    press(KEY.BACK);
    await settle(0);
    expect(
      screen.getByRole("heading", { name: translate(locale, "exit.question") }),
    ).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("the ordinary switcher uses the same Manage playlists destination", async () => {
  await mountApp(PLAYLIST, { savedPlaylists: playlists });
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await finishPageEntry();
  const manage = screen.getByRole("button", { name: "Manage playlists" });
  expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
  expect(manage.closest(".playlist-shortcut-heading")).toBeTruthy();
  expect(document.querySelector(".playlist-shortcut-current")?.textContent).toContain(
    "Television",
  );
  fireEvent.click(manage);
  await finishPageEntry();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();
  expect(screen.queryByRole("menu", { name: "Saved playlists" })).toBeNull();
});

test("a paired phone confirms startup through the exit fade without a second load", async () => {
  await mountApp(PLAYLIST, {
    savedPlaylists: playlists,
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
  });
  const { applyRemoteCommand, remoteSnapshot } = await import("../src/services/remoteProtocol");
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  expect(remoteSnapshot().startupPending).toBe(true);
  await act(async () => {
    const result = await applyRemoteCommand({
      id: "confirm-startup",
      revision: remoteSnapshot().revision,
      command: { type: "playlist.activate", id: "pl-1" },
    });
    expect(result.ok).toBe(true);
  });
  await settle(0);
  expect(remoteSnapshot().startupPending).toBe(false);
  expect(
    document.querySelector("[data-startup-playlists]")?.getAttribute("data-page-transition"),
  ).toBe("leaving");
  expect(fetch).toHaveBeenCalledTimes(1);
  await settle(179);
  expect(document.querySelector("[data-startup-playlists]")).toBeTruthy();
  await settle(1);
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("removing a playlist while choosing cannot leave an obsolete startup screen", async () => {
  await mountApp(PLAYLIST, {
    savedPlaylists: playlists,
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
  });
  const { useSettings } = await import("../src/stores/settings");
  await act(async () => {
    await useSettings.getState().removePlaylist("pl-1");
  });
  await settle(0);
  expect(document.querySelector("[data-startup-playlists]")).toBeNull();
  expect(useSettings.getState().activePlaylistId).toBe("pl-2");
  expect(vi.mocked(fetch).mock.calls.map(([url]) => String(url))).toEqual([
    "http://second.invalid/list.m3u",
  ]);
});

test("a startup load failure retains the existing retry and playlist management recovery", async () => {
  await mountApp("", {
    savedPlaylists: playlists,
    startupPlaylist: { mode: "ask" },
    awaitPlaylist: false,
    fetchImplementation: async () => {
      throw new Error("offline");
    },
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Radio" }));
  await settle(0);
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Manage playlists" })).toBeTruthy();
});
