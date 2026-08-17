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

test("settings uses clear sections and concise labels", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  expect([...document.querySelectorAll(".sheet-rail .row-label")].map((el) => el.textContent)).toEqual([
    "Appearance", "Playback", "General", "Playlists", "Diagnostics", "About",
  ]);
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
  expect(screen.getByRole("button", { name: "Playback" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByText("Screen fit")).toBeTruthy();
  expect(Boolean(screen.queryByText("Resume last channel"))).toBe(false);
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
  expect([...document.querySelectorAll(".sheet-body .sheet-lead")].some(
    (el) => el.textContent === "Could not refresh: offline. Showing the last saved copy.",
  )).toBe(true);
  expect([...document.querySelectorAll(".sheet-body .sheet-lead")].some(
    (el) => el.textContent === "Playlists are stored on this device only.",
  )).toBe(true);

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
  });
  expect(screen.getByText(/This device's platform and remote input/)).toBeTruthy();
  expect(screen.getByText(/last eight keys received by the app/)).toBeTruthy();
});
