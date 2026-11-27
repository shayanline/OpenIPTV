import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Settings, settingsGuideLabel } from "../src/components/Settings";
import { ActionMenu } from "../src/components/settings/ActionMenu";
import { KEY } from "../src/hooks/useRemote";
import type { RemoteAccessControl } from "../src/hooks/useRemoteAccess";
import {
  createPairingSession,
  listPairedDevices,
  pairDevice,
} from "../src/services/deviceAccess";
import { channelRef, emptyPersonalisation, type StoredLineupV1 } from "../src/services/lineup";
import { type Locale, translate } from "../src/services/locale";
import { mountApp, playCalls, press, settle, XTREAM_SOURCE } from "./support/app";

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

const REORDER_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="Sport",Gamma
http://example.invalid/c.m3u8`;

function openActionMenu() {
  return document.querySelector<HTMLElement>("[data-settings-action-menu]");
}

function menuItem(id: string) {
  return document.querySelector<HTMLButtonElement>(`[data-settings-action="${id}"]`);
}

async function chooseMenuItem(id: string) {
  const item = menuItem(id);
  expect(item).toBeTruthy();
  fireEvent.click(item!);
  await settle(0);
}

function playlistMenuTrigger(name: string): HTMLButtonElement {
  const label = translate(document.documentElement.lang as Locale, "remote.actions");
  return screen.getByRole("button", { name: `${label}, ${name}` }) as HTMLButtonElement;
}

function openRowMenu(name: string) {
  fireEvent.click(playlistMenuTrigger(name));
}

async function openPlaylistMenu(name = "Test") {
  openRowMenu(name);
  await settle(0);
}

async function refreshPlaylistFromMenu(name: string) {
  await openPlaylistMenu(name);
  await chooseMenuItem("refresh");
}

async function playlistToast(kind: "error" | "warning" = "error") {
  return vi.waitFor(
    async () => {
      await settle(0);
      const toast = document.querySelector<HTMLElement>(
        `.toast-host .toast[data-toast-kind="${kind}"]`,
      );
      expect(toast).toBeTruthy();
      return toast!;
    },
    { interval: 10 },
  );
}

function quickPlaylistAction(action: "activate", name: string): HTMLButtonElement {
  const row = [...document.querySelectorAll<HTMLElement>(".pl")].find(
    (element) => element.querySelector(".pl-name")?.textContent === name,
  );
  expect(row).toBeTruthy();
  const button = row!.querySelector<HTMLButtonElement>(`[data-playlist-${action}]`);
  expect(button).toBeTruthy();
  return button!;
}

function preferenceButton(kind: string) {
  return document.querySelector<HTMLButtonElement>(`[data-lineup-preference="${kind}"]`)!;
}

const orderPreferenceButton = () => preferenceButton("order");
const customOrderButton = () =>
  document.querySelector<HTMLButtonElement>('[data-lineup-preference="custom-order"]');

function orderOption(mode: string) {
  return document.querySelector<HTMLButtonElement>(`[data-lineup-order-option="${mode}"]`);
}

function orderDialog() {
  return document.querySelector<HTMLElement>("[data-lineup-order-dialog]");
}

function layoutRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/* jsdom reports zero sized boxes, which would hide every spatial move. This
   spy answers real rectangles only inside the popup under test and delegates
   everything else, so directional navigation is genuinely exercised. Install
   it before the popup renders: the first layout is the one under test. */
function popupGeometry(
  popupSelector: string,
  popupRect: DOMRect,
  targets: Array<{ selector: string; rect: DOMRect }>,
) {
  const original = Element.prototype.getBoundingClientRect;
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const popup = document.querySelector(popupSelector);
    if (popup && (this === popup || popup.contains(this))) {
      if (this === popup) return popupRect;
      const target = targets.find((entry) => this.matches(entry.selector));
      if (target) return target.rect;
    }
    return original.call(this);
  });
}

function orderValueLabel() {
  return document
    .querySelector('[data-lineup-preference="order"] .lineup-preference-value')
    ?.textContent?.trim();
}

async function openOrderDialog() {
  fireEvent.click(orderPreferenceButton());
  await settle(0);
}

async function chooseOrderOption(mode: string) {
  const option = orderOption(mode);
  expect(option).toBeTruthy();
  fireEvent.click(option!);
  await settle(700);
}

async function selectOrderMode(mode: string) {
  await openOrderDialog();
  await chooseOrderOption(mode);
  await settle(0);
}

async function enterReorder() {
  if (!customOrderButton()) await selectOrderMode("custom");
  fireEvent.click(customOrderButton()!);
  await settle(0);
}

function bulkButton(action: "show" | "hide") {
  return document.querySelector<HTMLButtonElement>(`[data-lineup-bulk="${action}"]`)!;
}

async function chooseBulkHide() {
  fireEvent.click(bulkButton("hide"));
  await settle(700);
}

async function chooseBulkShow() {
  fireEvent.click(bulkButton("show"));
  await settle(700);
}

/* Eyes and pencils live on the ordinary rows now. A "visibility row" is the switch
   itself, which carries role=switch and aria-checked. The name lives on its row. */
function visibilityRows() {
  return [...document.querySelectorAll<HTMLButtonElement>("[data-lineup-visibility]")];
}

function visibilityRowText(switchButton: Element) {
  return switchButton.closest(".lineup-row")?.textContent ?? "";
}

function visibilitySwitch(name: string) {
  const switchButton = visibilityRows().find((button) =>
    visibilityRowText(button).includes(name),
  );
  expect(switchButton).toBeTruthy();
  return switchButton!;
}

async function openContent(channels = false) {
  const locale = document.documentElement.lang as Locale;
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: translate(locale, "settings.content") }));
  await settle(0);
  fireEvent.click(
    screen.getByRole("button", {
      name: `${translate(locale, "common.open")}, ${translate(locale, "playlist.managePlaylists")}`,
    }),
  );
  await settle(0);
  fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
  await settle(0);
  if (channels) await openFirstCategory();
}

async function openFirstCategory() {
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(".lineup-manager-list .lineup-row-open")!,
  );
  await settle(0);
}

async function openCategory(name: string) {
  const row = [
    ...document.querySelectorAll<HTMLButtonElement>(".lineup-manager-list .lineup-row-open"),
  ].find((candidate) => candidate.textContent?.includes(name))!;
  fireEvent.click(row);
  await settle(0);
}

async function openRenameRow(name: string) {
  const pencil = [...document.querySelectorAll<HTMLElement>("[data-lineup-edit]")].find(
    (button) => button.closest(".lineup-row")?.textContent?.includes(name),
  );
  expect(pencil).toBeTruthy();
  fireEvent.click(pencil!);
  await settle(0);
}

test("channel management uses static identities with explicit labelled actions", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  const body = document.querySelector<HTMLElement>(".sheet-body")!;
  const categoryRow = body.querySelector<HTMLElement>(".lineup-row-open")!;
  expect(categoryRow.tagName).toBe("BUTTON");
  expect(categoryRow.getAttribute("aria-label")).toBe("Open, News");
  expect(categoryRow.getAttribute("data-settings-focus")).toBe("lineup-open-News");
  expect(categoryRow.querySelector("[data-lineup-row-menu]")).toBeNull();
  const category = categoryRow.querySelector<HTMLElement>(".category-manager-main")!;
  expect(category.textContent).toContain("News");
  expect(category.hasAttribute("data-settings-focus")).toBe(false);
  expect(categoryRow.querySelector("[role='switch']")).toBeNull();
  fireEvent.click(categoryRow);
  await settle(0);

  const channelRow = [
    ...body.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row"),
  ].find((row) => row.textContent?.includes("Alpha"))!;
  expect(channelRow.tagName).toBe("DIV");
  expect(channelRow.getAttribute("data-lineup-provider-id")).toBeTruthy();
  expect(channelRow.querySelector(".lineup-channel-info .category-manager-main")).toBeTruthy();
  expect(channelRow.querySelector(".lineup-channel-info")?.textContent).toContain("Alpha");
  expect(channelRow.querySelector(".lineup-row-open")).toBeNull();
  expect(channelRow.querySelector("[data-lineup-edit]")).toBeTruthy();
  expect(channelRow.querySelector("[data-lineup-visibility]")).toBeTruthy();
  expect(channelRow.querySelector("[data-lineup-row-menu]")).toBeNull();

  await openRenameRow("Alpha");
  const editor = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(editor.getAttribute("role")).toBe("dialog");
  expect(editor.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector(".sheet-page > .page-key-guide")?.textContent).toContain(
    "Return",
  );
  expect(editor.querySelector(".page-key-guide")?.textContent).toContain("OK");
  expect(document.querySelector(".lineup-manager")).toBeTruthy();
  expect(
    [...editor.querySelectorAll<HTMLElement>(".dialog-actions button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).toEqual(["Reset to default", "Cancel", "Save"]);
  expect(screen.getByLabelText("Name")).toBeTruthy();
});

test("settings uses clear sections and concise labels", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  expect(
    [...document.querySelectorAll(".sheet-rail .row-label")].map((el) => el.textContent),
  ).toEqual(["Appearance", "Playback", "Content & playlists", "About"]);
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
    fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
    await settle(0);
    fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
    await settle(0);
  });
  expect(screen.getByRole("button", { name: "Actions, Test" })).toBeTruthy();
  await openPlaylistMenu();
  expect(menuItem("edit")).toBeTruthy();
  expect(menuItem("remove")).toBeTruthy();
  press(KEY.ESC);
  await settle(0);

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
  expect(document.querySelector(".toast-host [role='status']")?.textContent).toBe(
    "Second saved.",
  );

  fireEvent.click(quickPlaylistAction("activate", "Second"));
  const secondRow = [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
    row.textContent?.includes("Second"),
  )!;
  expect(secondRow.getAttribute("aria-busy")).toBe("true");
  expect(secondRow.querySelector("[data-playlist-refresh]")).toBeNull();
  await settle(0);
  expect(document.activeElement).toBe(quickPlaylistAction("activate", "Second"));
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().activePlaylist()?.name).toBe("Second");
  expect(screen.queryByText("Playlists are stored on this device only.")).toBeNull();

  press(KEY.BACK);
  await settle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "About" }));
  });
  await settle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Open, Diagnostics" }));
  });
  expect(screen.getByText(/This device's platform and remote input/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Device and application" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Compatibility" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remote keys" })).toBeTruthy();
});

test("playlist refresh restores focus to its menu trigger after completion", async () => {
  let finishRefresh!: (response: unknown) => void;
  let requests = 0;
  const response = () => ({ ok: true, text: async () => PLAYLIST });
  await mountApp(PLAYLIST, {
    fetchImplementation: async () => {
      requests += 1;
      if (requests === 1) return response();
      return new Promise((resolve) => {
        finishRefresh = resolve;
      });
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const trigger = playlistMenuTrigger("Test");
  await refreshPlaylistFromMenu("Test");
  expect(document.activeElement).toBe(trigger);
  // The row keeps its name while progress is announced by the toast.
  expect(trigger.closest(".pl")?.textContent).not.toContain("Refreshing");
  expect(trigger.textContent?.trim()).toBe("");
  await act(async () => finishRefresh(response()));
  await settle(0);

  expect(document.activeElement).toBe(trigger);

  const activate = quickPlaylistAction("activate", "Test");
  expect(activate.disabled).toBe(false);
  expect(activate.getAttribute("aria-pressed")).toBe("true");
  const fetches = vi.mocked(fetch).mock.calls.length;
  const plays = playCalls.length;
  const { useSettings } = await import("../src/stores/settings");
  const activeBefore = useSettings.getState().activePlaylistId;
  fireEvent.click(activate);
  await settle(0);
  fireEvent.click(quickPlaylistAction("activate", "Test"));
  await settle(0);
  expect(vi.mocked(fetch).mock.calls.length).toBe(fetches);
  expect(playCalls.length).toBe(plays);
  expect(useSettings.getState().activePlaylistId).toBe(activeBefore);
});

test("ArrowDown from Add Playlist enters the first playlist row", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();

  const add = screen.getByRole("button", { name: "Add a playlist" });
  const firstPlaylist = document.querySelector<HTMLButtonElement>(".pl .pl-open");
  expect(firstPlaylist).toBeTruthy();

  add.focus();
  expect(document.activeElement).toBe(add);
  press(KEY.DOWN);

  expect(document.activeElement).toBe(firstPlaylist);
});

test("ArrowDown from Add Playlist restores the last focused playlist row", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const add = screen.getByRole("button", { name: "Add a playlist" });
  const row = document.querySelector<HTMLButtonElement>(".pl .pl-open")!;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const top = this.classList.contains("settings-add-playlist") ? 0 : 100;
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });

  row.focus();
  press(KEY.UP);
  expect(document.activeElement).toBe(add);

  press(KEY.DOWN);
  expect(document.activeElement).toBe(row);
});

test("Settings guides describe actions without current values", () => {
  const translate = (key: string) =>
    ({
      "settings.change": "Change it",
      "settings.language": "Language",
      "common.edit": "Edit",
      "common.remove": "Remove",
      "common.refreshPlaylist": "Refresh playlist",
      "lineup.title": "Content",
      "common.select": "Select",
    })[key] ?? key;
  const language = document.createElement("button");
  language.className = "option-picker-current";
  language.setAttribute("aria-label", "Language, System");
  const playlistEdit = document.createElement("button");
  playlistEdit.setAttribute("aria-label", "Edit Test");
  const categoryEdit = document.createElement("button");
  categoryEdit.className = "settings-icon-action lineup-inline-edit";
  categoryEdit.setAttribute("aria-label", "Edit, News");

  expect(settingsGuideLabel(language, translate)).toBe("Change language");
  expect(settingsGuideLabel(playlistEdit, translate)).toBe("Edit");
  expect(settingsGuideLabel(categoryEdit, translate)).toBe("Edit");
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
      /html\[data-input-mode="remote"\] \.playlist-source-options \.btn\[aria-pressed="true"\]:focus \{([^}]*)\}/,
    )?.[1] ?? "";

  expect(selected).toContain("background: var(--accent-dim)");
  expect(selected).toContain("color: var(--accent)");
  expect(focused).toContain("background: var(--target-bg)");
  expect(focused).toContain("color: var(--target-text)");
});

test("playlist settings keep the specific M3U address guidance", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://example.com/my list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(document.querySelector("#pl-url-problem")?.textContent).toBe(
    "Addresses cannot contain spaces.",
  );
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);
});

test("playlist Save accepts a valid empty playlist and reports it was saved", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Empty" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://empty.invalid/list.m3u" },
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response("#EXTM3U\n# only comments\n", { status: 200 }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);

  expect(document.querySelector(".toast-host [role='status']")?.textContent).toContain(
    "Empty saved",
  );
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(2);
  expect(screen.queryByLabelText("Playlist address")).toBeNull();
});

const openAddPlaylistForm = async () => {
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
};

test("cancelling playlist validation discards the pending save silently", async () => {
  let releaseValidation: ((value: unknown) => void) | null = null;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (String(input).includes("pending.invalid")) {
        return new Promise((resolve) => {
          releaseValidation = resolve;
        });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  await openAddPlaylistForm();
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Late" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://pending.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);

  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect((cancel as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cancel);
  await settle(0);
  expect(screen.queryByLabelText("Playlist address")).toBeNull();
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);

  await act(async () => {
    releaseValidation?.(new Response(PLAYLIST, { status: 200 }));
    await Promise.resolve();
  });
  await settle(700);
  expect(useSettings.getState().playlists).toHaveLength(1);
  expect(document.querySelector(".toast-host [role='alert'] .toast")).toBeNull();
});

test("a rejected playlist operation uses only a toast and keeps the editable draft", async () => {
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) =>
      String(input).includes("broken.invalid")
        ? Promise.reject(new TypeError("Failed to fetch"))
        : new Response(PLAYLIST, { status: 200 }),
  });
  await openAddPlaylistForm();
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Broken" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://broken.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);

  const inline = () => document.querySelector(".playlist-dialog .field-problem[role='alert']");
  expect(inline()).toBeNull();
  expect(document.querySelector(".toast-host [role='alert'] .toast")?.textContent).toContain(
    "could not be reached",
  );
  const save = screen.getByRole("button", { name: "Save" });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);

  await settle(5300);
  expect(document.querySelector(".toast-host [role='alert'] .toast")).toBeNull();
  expect(inline()).toBeNull();
  expect((screen.getByLabelText("Playlist address") as HTMLInputElement).value).toBe(
    "http://broken.invalid/list.m3u",
  );

  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://broken.invalid/other.m3u" },
  });
  expect(inline()).toBeNull();
});

test("an empty playlist activates from its validated copy without another fetch", async () => {
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) =>
      String(input).includes("empty.invalid")
        ? new Response("#EXTM3U\n# only comments\n", { status: 200 })
        : new Response(PLAYLIST, { status: 200 }),
  });
  await openAddPlaylistForm();
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Empty" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://empty.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);
  expect(screen.queryByLabelText("Playlist address")).toBeNull();

  const emptyFetches = () =>
    vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes("empty.invalid"))
      .length;
  expect(emptyFetches()).toBe(1);

  await openPlaylistMenu("Empty");
  fireEvent.click(menuItem("activate")!);
  await settle(1200);

  expect(emptyFetches()).toBe(1);
  expect(document.querySelector(".toast-host [role='status']")?.textContent).toContain(
    "no channels could be read",
  );
});

test("playlist field errors clear independently and do not trap navigation before the name", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));
  const server = screen.getByLabelText("Server address");
  const username = screen.getByLabelText("Username");
  const password = screen.getByLabelText("Password");
  const format = screen.getByLabelText("Stream format");
  const name = screen.getByLabelText("Playlist name") as HTMLInputElement;
  const save = screen.getByRole("button", { name: "Save" });
  const dialog = screen.getByRole("dialog", { name: "Add playlist" });
  const requests = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(save);
  for (const [field, message] of [
    [server, "Enter the server address."],
    [username, "Enter your username."],
    [password, "Enter your password."],
  ] as const) {
    expect(field.nextElementSibling?.textContent).toBe(message);
    expect(field.getAttribute("aria-describedby")).toBe(field.nextElementSibling?.id);
    expect(field.getAttribute("aria-invalid")).toBe("true");
  }

  fireEvent.change(server, { target: { value: "https://provider.example" } });
  fireEvent.click(save);
  expect(server.getAttribute("aria-invalid")).toBeNull();
  expect(
    within(dialog)
      .getAllByRole("alert")
      .map((alert) => alert.textContent),
  ).toEqual(["Enter your username.", "Enter your password."]);
  act(() => format.focus());
  press(KEY.DOWN);
  expect(document.activeElement).toBe(name);
  fireEvent.change(name, { target: { value: "Draft" } });
  press(KEY.UP);
  expect(document.activeElement).toBe(format);
  fireEvent.change(username, { target: { value: "viewer" } });
  expect(username.getAttribute("aria-invalid")).toBeNull();
  expect(password.getAttribute("aria-invalid")).toBe("true");
  fireEvent.click(save);
  expect(within(dialog).getByRole("alert").textContent).toBe("Enter your password.");
  fireEvent.change(password, { target: { value: "secret" } });
  expect(within(dialog).queryByRole("alert")).toBeNull();
  expect(name.value).toBe("Draft");
  expect(vi.mocked(fetch).mock.calls).toHaveLength(requests);
});

test("playlist validation keeps the draft and suppresses repeated Save activation", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Second" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://second.invalid/list.m3u" },
  });
  let finish: ((response: Response) => void) | undefined;
  const before = vi.mocked(fetch).mock.calls.length;
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );

  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  fireEvent.click(save);
  fireEvent.click(save);

  expect(vi.mocked(fetch).mock.calls.length - before).toBe(1);
  expect(save.disabled).toBe(true);
  expect(save.getAttribute("aria-busy")).toBe("true");
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Second");

  finish?.(new Response(PLAYLIST, { status: 200 }));
  await act(async () => Promise.resolve());
  await settle(0);
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(2);
});

test("a playlist Save server failure keeps the draft without a duplicate inline error", async () => {
  let releaseSave: ((response: Response) => void) | null = null;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (String(input).includes("second.invalid")) {
        return new Promise<Response>((resolve) => {
          releaseSave = resolve;
        });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Second" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://second.invalid/list.m3u" },
  });

  const save = screen.getByRole("button", { name: "Save" });
  (save as HTMLElement).focus();
  fireEvent.click(save);
  await settle(50);

  const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]");
  expect(dialog).toBeTruthy();
  const busySave = within(dialog!).getByRole<HTMLButtonElement>("button", {
    name: /^Validating playlist/,
  });
  expect(busySave.disabled).toBe(true);
  expect(busySave.getAttribute("aria-busy")).toBe("true");
  expect(
    within(dialog as HTMLElement)
      .getByLabelText("Playlist name")
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(
    within(dialog as HTMLElement)
      .getByLabelText("Playlist address")
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(dialog?.contains(document.activeElement)).toBe(true);

  expect(releaseSave).toBeTruthy();
  releaseSave!(new Response("boom", { status: 500 }));
  await settle(700);
  expect(
    (within(dialog as HTMLElement).getByLabelText("Playlist name") as HTMLInputElement).value,
  ).toBe("Second");
  expect(
    (within(dialog as HTMLElement).getByLabelText("Playlist address") as HTMLInputElement)
      .value,
  ).toBe("http://second.invalid/list.m3u");
  expect(dialog?.querySelector("#pl-url-problem")).toBeNull();
  expect(dialog?.querySelector('[role="alert"]')).toBeNull();
  const toast = document.querySelector<HTMLElement>(".toast-host .toast");
  expect(toast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  const settledDialog = document.querySelector<HTMLElement>("[data-settings-dialog]");
  expect(settledDialog?.contains(document.activeElement)).toBe(true);
  const { useSettings } = await import("../src/stores/settings");
  expect(useSettings.getState().playlists).toHaveLength(1);
});

test("playlist settings suggest and prefill Xtream from an M3U address", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: {
      value:
        "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus",
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Use Xtream" }));

  const xtream = screen.getByRole("button", { name: "Xtream login" });
  const server = screen.getByLabelText("Server address");
  expect(document.activeElement).toBe(xtream);
  xtream.getBoundingClientRect = () =>
    ({ top: 0, bottom: 60, left: 0, right: 600, width: 600, height: 60 }) as DOMRect;
  server.getBoundingClientRect = () =>
    ({ top: 80, bottom: 140, left: 0, right: 600, width: 600, height: 60 }) as DOMRect;
  press(KEY.DOWN);
  expect(document.activeElement).toBe(server);
  expect((server as HTMLInputElement).value).toBe("http://provider.example:8080");
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, HLS (Recommended)",
  );
});

test("playlist settings extract credentials entered in the Xtream server field", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  const server = screen.getByLabelText("Server address");
  server.focus();
  fireEvent.change(server, {
    target: {
      value:
        "https://provider.example/get.php?username=viewer&password=secret&type=m3u_plus&output=ts",
    },
  });

  expect(document.activeElement).toBe(server);
  expect((server as HTMLInputElement).value).toBe("https://provider.example");
  expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("viewer");
  expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("secret");
  expect(screen.getByLabelText("Stream format").getAttribute("aria-label")).toBe(
    "Stream format, MPEG TS",
  );
});

test("the Settings Xtream stream format closes when focus moves to the password", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Xtream login" }));

  const output = screen.getByLabelText("Stream format");
  let triggerTop = window.innerHeight - 72;
  vi.spyOn(output, "getBoundingClientRect").mockImplementation(() =>
    layoutRect(window.innerWidth - 160, triggerTop, 140, 64),
  );
  output.focus();
  press(KEY.ENTER);
  const list = screen.getByRole("listbox", { name: "Stream format" });
  expect(list.parentElement).toBe(document.body);
  expect(Number.parseFloat(list.style.left)).toBeGreaterThanOrEqual(8);
  expect(
    Number.parseFloat(list.style.left) + Number.parseFloat(list.style.width),
  ).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(Number.parseFloat(list.style.top)).toBeLessThan(triggerTop);
  expect(Number.parseFloat(list.style.maxHeight)).toBeLessThanOrEqual(triggerTop - 8);
  const beforeScroll = list.style.top;
  fireEvent.scroll(list);
  expect(list.style.top).toBe(beforeScroll);
  triggerTop = 80;
  fireEvent.scroll(output.closest(".settings-dialog-body")!);
  expect(Number.parseFloat(list.style.top)).toBeGreaterThanOrEqual(144);
  expect(output.getAttribute("aria-expanded")).toBe("true");

  act(() => screen.getByLabelText("Password").focus());

  expect(screen.queryByRole("listbox", { name: "Stream format" })).toBeNull();
  expect(output.getAttribute("aria-expanded")).toBe("false");
});

test("an open language list in Settings keeps the arrow keys inside it", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  mockBodyRects();

  const trigger = screen.getByRole("button", { name: "Language, System" });
  press(KEY.RIGHT);
  expect(
    document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent,
  ).toBe("Language, System");
  press(KEY.ENTER);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");

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
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
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
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);

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
  expect(document.querySelector(".settings-list-body")?.textContent).not.toContain("get.php");
  expect(document.querySelector(".settings-list-body")?.textContent).not.toContain("viewer");
  expect(document.querySelector(".settings-list-body")?.textContent).not.toContain("secret");

  const providerRow = [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
    row.textContent?.includes("provider.example"),
  )!;
  fireEvent.click(providerRow.querySelector<HTMLElement>("[data-playlist-menu]")!);
  await chooseMenuItem("edit");
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
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "new-provider.example" },
      }),
    ),
  );
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
  expect(screen.getByRole("button", { name: "Open, Diagnostics" })).toBeTruthy();
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
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);

  const row = document.querySelectorAll(".pl")[1];
  expect(row.textContent).toContain("trial");
  expect(row.textContent).toContain("Expires");
  expect(row.textContent).toContain("1/2 connections");
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
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);

  expect(screen.getAllByText("Expiry unknown")).toHaveLength(2);
  expect(screen.getAllByText("Inactive").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
});

test("the lineup detail exposes channel and category management scopes", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  expect(screen.getByRole("heading", { level: 3, name: "Test" })).toBeTruthy();
  expect(screen.getByText("Here you can manage your playlist content.")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  await openCategory("News");
  expect(screen.getByRole("heading", { level: 3, name: "News" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /^Channel order/ })).toBeTruthy();
});

test("channel edits persist name and number while disabled memberships stay unchanged", async () => {
  const writes: StoredLineupV1[] = [];
  await mountApp(CATEGORIES, {
    personalLineup: {
      version: 1,
      revision: 1,
      personalisation: {
        personalCategories: [{ id: "mine", name: "Mine", channels: [] }],
      },
    },
    personalWrite: async (_id, value) => {
      writes.push(value as StoredLineupV1);
    },
  });
  await openContent(true);
  await openRenameRow("Alpha");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "My Alpha" } });
  fireEvent.change(screen.getByLabelText("Number"), { target: { value: "801" } });
  expect(screen.queryByRole("checkbox", { name: "Mine" })).toBeNull();
  expect(within(screen.getByRole("dialog")).queryByRole("switch")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(2500);
  const { useLineup } = await import("../src/stores/lineup");
  const channel = useLineup
    .getState()
    .managedChannels.find((item) => item.providerName === "Alpha");
  expect(channel?.effective.name).toBe("My Alpha");
  expect(channel?.effective.number).toBe(801);
  expect(channel?.hidden).toBeFalsy();
  expect(document.querySelector(".lineup-channel-number")?.textContent).toBe("801");
  expect(document.querySelector(".lineup-channel-name")?.textContent).toBe("My Alpha");
  expect(writes.at(-1)?.personalisation.personalCategories).toEqual([
    { id: "mine", name: "Mine", channels: [] },
  ]);
});

test("channel number collisions keep the editor and durable record unchanged", async () => {
  await mountApp(CATEGORIES);
  await openContent(true);
  await openRenameRow("Alpha");
  fireEvent.change(screen.getByLabelText("Number"), { target: { value: "2" } });
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
  await openContent(true);
  await openRenameRow("Alpha");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retained" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Retained");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
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
  await openContent();
  expect(screen.getByText("Unavailable custom name")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Actions, Unavailable custom name" })).toBeNull();
  const unavailableRow = document.querySelector<HTMLElement>(".lineup-unavailable-row")!;
  fireEvent.click(
    unavailableRow.querySelector<HTMLButtonElement>("[data-lineup-unavailable-remove]")!,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await settle(700);
  expect(Boolean(screen.queryByText("Unavailable custom name"))).toBe(false);
});

test("Sort mode restores focus and rolls back a grabbed tentative move", async () => {
  await mountApp(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`);
  await openContent(true);
  const bulkActions = [
    ...document.querySelectorAll<HTMLButtonElement>(
      ".lineup-header-actions [data-lineup-bulk]",
    ),
  ];
  expect(bulkActions.map((button) => button.dataset.lineupBulk)).toEqual(["show", "hide"]);
  const toolbar = [
    ...document.querySelectorAll<HTMLButtonElement>(".lineup-header-actions > button"),
  ];
  expect(
    toolbar.map((button) => button.dataset.lineupAction ?? button.dataset.lineupBulk),
  ).toEqual(["search", "show", "hide"]);
  expect(toolbar.every((button) => button.classList.contains("tonal"))).toBe(true);
  expect(
    bulkActions.every(
      (button) =>
        !!button.getAttribute("aria-label") &&
        button.title === button.getAttribute("aria-label"),
    ),
  ).toBe(true);
  orderPreferenceButton().focus();
  await enterReorder();
  const first = document.querySelector<HTMLButtonElement>(
    ".lineup-manager-list.sorting .lineup-manager-row",
  );
  expect(document.activeElement).toBe(first);
  fireEvent.click(first!);
  await settle(0);
  press(KEY.DOWN);
  press(KEY.BACK);
  await settle(0);
  expect(
    document.querySelector(".lineup-manager-list.sorting .lineup-manager-row")?.textContent,
  ).toContain("Alpha");
  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(customOrderButton());
  await enterReorder();
  const grabbed = document.querySelector<HTMLButtonElement>(
    ".lineup-manager-list.sorting .lineup-manager-row",
  );
  fireEvent.click(grabbed!);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  fireEvent.click(grabbed!);
  await settle(700);
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
});

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])(
  "ordinary reorder arrows move focus without changing the lineup for $scope",
  async ({ channels }) => {
    await mountApp(REORDER_PLAYLIST);
    await openContent(channels);
    const { useLineup } = await import("../src/stores/lineup");
    await enterReorder();
    await settle(700);

    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row"));
    expect(rows).toHaveLength(2);
    const baseline = useLineup.getState();
    const rowIds = rows.map((row) => row.dataset.sortId);
    rows.forEach((row) => {
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(layoutRect(0, 0, 200, 60));
    });

    rows[0].focus();
    for (let index = 0; index < 3; index += 1) {
      press(KEY.DOWN);
      expect(document.activeElement).toBe(rows[1]);
      press(KEY.UP);
      expect(document.activeElement).toBe(rows[0]);
    }

    await settle(700);
    const afterRows = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row"),
    );
    expect(afterRows.map((row) => row.dataset.sortId)).toEqual(rowIds);
    afterRows.forEach((row, index) => {
      expect(row).toBe(rows[index]);
      expect(row.getAttribute("aria-pressed")).toBe("false");
      expect(row.classList.contains("grabbed")).toBe(false);
    });
    expect(useLineup.getState()).toBe(baseline);
  },
);

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])(
  "reorder without movement preserves the acknowledged Custom mode for $scope",
  async ({ channels }) => {
    await mountApp(REORDER_PLAYLIST);
    await openContent(channels);
    const { useLineup } = await import("../src/stores/lineup");

    await enterReorder();
    await settle(0);
    press(KEY.BACK);
    await settle(0);
    const revision = useLineup.getState().revision;
    const orderLabel = orderValueLabel();
    expect(orderLabel).toBe("Custom Order");

    await enterReorder();
    await settle(0);
    const held = document.querySelector<HTMLButtonElement>("[data-sort-id]")!;
    fireEvent.click(held);
    fireEvent.click(held);
    await settle(700);
    press(KEY.BACK);
    await settle(0);

    const state = useLineup.getState();
    expect(orderValueLabel()).toBe(orderLabel);
    if (channels) {
      const key = state.provider.categories[0].key;
      expect(state.itemOrderModes[key]).toBe("custom");
    } else {
      expect(state.categoryOrderModes.live).toBe("custom");
    }
    expect(state.revision).toBe(revision);
  },
);

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])(
  "returning to the provider sequence retains Custom and compacts placements for $scope",
  async ({ channels }) => {
    await mountApp(REORDER_PLAYLIST);
    await openContent(channels);
    const { isDefaultCategoryOrder, isDefaultItemOrder, useLineup } = await import(
      "../src/stores/lineup"
    );
    await enterReorder();
    await settle(0);
    const original = [...document.querySelectorAll<HTMLButtonElement>("[data-sort-id]")];
    const originalIds = original.map((row) => row.dataset.sortId);
    expect(originalIds).toHaveLength(2);
    fireEvent.click(original[0]);
    press(KEY.DOWN);
    fireEvent.click(original[0]);
    await settle(700);
    press(KEY.BACK);
    await settle(0);
    const orderLabel = orderValueLabel();
    expect(orderLabel).toBe("Custom Order");

    await enterReorder();
    await settle(0);
    const reordered = [...document.querySelectorAll<HTMLButtonElement>("[data-sort-id]")];
    expect(reordered.map((row) => row.dataset.sortId)).toEqual([
      originalIds[1],
      originalIds[0],
    ]);
    fireEvent.click(reordered[1]);
    reordered[1].focus();
    press(KEY.UP);
    fireEvent.click(reordered[1]);
    await settle(700);
    press(KEY.BACK);
    await settle(0);

    const state = useLineup.getState();
    expect(orderValueLabel()).toBe(orderLabel);
    if (channels) {
      const key = state.provider.categories[0].key;
      expect(state.itemOrderModes[key]).toBe("custom");
      expect(isDefaultItemOrder(key)).toBe(true);
    } else {
      expect(state.categoryOrderModes.live).toBe("custom");
      expect(isDefaultCategoryOrder("live")).toBe(true);
    }
  },
);

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])("entering reorder preserves an explicit Custom mode for $scope", async ({ channels }) => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(channels);
  const { applyLineupMutation, useLineup } = await import("../src/stores/lineup");
  const state = useLineup.getState();
  const changed = applyLineupMutation(
    state.revision,
    channels
      ? {
          type: "item-order.mode",
          categoryKey: state.provider.categories[0].key,
          mode: "custom",
        }
      : { type: "category-order.mode", section: "live", mode: "custom" },
  );
  await settle(700);
  expect((await changed).ok).toBe(true);
  expect(customOrderButton()).toBeTruthy();
  const actionGroup = document.querySelector<HTMLElement>(".lineup-order-attach")!;
  const customOrder = customOrderButton()!;
  expect(actionGroup.contains(orderPreferenceButton())).toBe(true);
  expect(actionGroup.contains(customOrder)).toBe(true);
  expect(customOrder.textContent).toContain("Edit custom order");
  expect(customOrder.disabled).toBe(false);
  const listHeader = document.querySelector(".lineup-list-header")!;
  expect(
    actionGroup.compareDocumentPosition(listHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const revision = useLineup.getState().revision;

  await enterReorder();
  await settle(700);
  press(KEY.BACK);
  await settle(0);

  expect(orderValueLabel()).toBe("Custom Order");
  if (channels) {
    expect(useLineup.getState().itemOrderModes[state.provider.categories[0].key]).toBe(
      "custom",
    );
  } else {
    expect(useLineup.getState().categoryOrderModes.live).toBe("custom");
  }
  expect(useLineup.getState().revision).toBe(revision);
});

test("opening reorder preserves unresolved custom category placements", async () => {
  await mountApp(REORDER_PLAYLIST, {
    personalLineup: {
      version: 1,
      revision: 1,
      personalisation: {
        categoryOrderModes: { live: "custom", movie: "provider", series: "provider" },
        categoryOrders: {
          live: [{ itemId: "missing-category", beforeId: "missing-anchor" }],
          movie: [],
          series: [],
        },
      },
    },
  });
  await openContent();
  const { useLineup } = await import("../src/stores/lineup");
  const before = useLineup.getState();
  expect(before.unavailable).toHaveLength(1);
  expect(orderValueLabel()).toBe("Custom Order");

  await enterReorder();
  await settle(700);
  press(KEY.BACK);
  await settle(0);

  expect(orderValueLabel()).toBe("Custom Order");
  expect(useLineup.getState().categoryOrderModes.live).toBe("custom");
  expect(useLineup.getState().revision).toBe(before.revision);
  expect(useLineup.getState().unavailable).toEqual(before.unavailable);
});

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])("a non-custom order mode hides the custom order editor for $scope", async ({ channels }) => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(channels);
  const { applyLineupMutation, useLineup } = await import("../src/stores/lineup");
  const state = useLineup.getState();
  const changed = applyLineupMutation(
    state.revision,
    channels
      ? {
          type: "item-order.mode",
          categoryKey: state.provider.categories[0].key,
          mode: "alphabetical",
        }
      : { type: "category-order.mode", section: "live", mode: "alphabetical" },
  );
  await settle(700);
  expect((await changed).ok).toBe(true);
  const revision = useLineup.getState().revision;

  expect(customOrderButton()).toBeNull();
  expect(orderValueLabel()).toBe("Alphabetical");

  await openOrderDialog();
  await settle(0);
  const dialog = orderDialog();
  expect(dialog).toBeTruthy();
  expect(dialog!.querySelector(".lineup-order-hint")).toBeNull();
  expect(dialog!.textContent).not.toContain("Saved for this playlist");
  const options = [...dialog!.querySelectorAll<HTMLElement>("[data-lineup-order-option]")].map(
    (option) => option.dataset.lineupOrderOption,
  );
  expect(options).toEqual(
    channels
      ? ["provider", "alphabetical", "number", "custom"]
      : ["provider", "alphabetical", "custom"],
  );
  expect(orderOption("alphabetical")?.getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(orderOption("alphabetical"));

  fireEvent.click(
    within(document.querySelector("[data-settings-dialog]")!).getByRole("button", {
      name: "Close",
    }),
  );
  await settle(0);
  expect(orderDialog()).toBeNull();
  expect(document.activeElement).toBe(orderPreferenceButton());
  expect(customOrderButton()).toBeNull();
  expect(orderValueLabel()).toBe("Alphabetical");
  expect(useLineup.getState().revision).toBe(revision);
});

test("the order dialog saves modes, toggles the custom row and restores focus", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  const { useLineup } = await import("../src/stores/lineup");

  expect(customOrderButton()).toBeNull();
  expect(orderValueLabel()).toBe("Provider order");

  await openOrderDialog();
  await settle(0);
  expect(orderDialog()).toBeTruthy();
  expect(document.querySelector(".lineup-manager-list")).toBeTruthy();
  const revision = useLineup.getState().revision;
  fireEvent.click(orderOption("provider")!);
  await settle(700);
  expect(orderDialog()).toBeNull();
  expect(useLineup.getState().revision).toBe(revision);
  expect(document.activeElement).toBe(orderPreferenceButton());

  await selectOrderMode("alphabetical");
  expect(orderValueLabel()).toBe("Alphabetical");
  expect(customOrderButton()).toBeNull();

  await selectOrderMode("custom");
  expect(orderValueLabel()).toBe("Custom Order");
  const editRow = customOrderButton();
  expect(editRow).toBeTruthy();
  expect(orderDialog()).toBeNull();
  expect(document.activeElement).toBe(orderPreferenceButton());

  fireEvent.click(editRow!);
  await settle(0);
  expect(document.querySelector(".lineup-manager-list.sorting")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(customOrderButton());

  await selectOrderMode("provider");
  expect(orderValueLabel()).toBe("Provider order");
  expect(customOrderButton()).toBeNull();
  expect(useLineup.getState().categoryOrderModes.live).toBe("provider");

  await selectOrderMode("custom");
  expect(orderValueLabel()).toBe("Custom Order");
  expect(customOrderButton()).toBeTruthy();
});

test.each([{ kind: "movie" as const }, { kind: "series" as const }])(
  "$kind scopes expose their own order labels without visibility",
  async ({ kind }) => {
    const categoryId = kind === "movie" ? "10" : "20";
    const items = ["Beta", "Alpha"].map((name, index) => ({
      stream_id: String(100 + index),
      series_id: String(100 + index),
      category_id: categoryId,
      name,
      container_extension: "mp4",
    }));
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "News" }],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live" }],
      get_vod_categories:
        kind === "movie" ? [{ category_id: categoryId, category_name: "Cinema" }] : [],
      get_vod_streams: kind === "movie" ? items : [],
      get_series_categories:
        kind === "series" ? [{ category_id: categoryId, category_name: "Shows" }] : [],
      get_series: kind === "series" ? items : [],
    };
    await mountApp("", {
      source: XTREAM_SOURCE,
      fetchImplementation: async (input) => {
        const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
        if (!(action in bodies)) throw new Error(`Unexpected fixture action ${action}`);
        return new Response(JSON.stringify(bodies[action]), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await openContent();
    await settle(0);
    fireEvent.click(
      screen.getByRole("tab", { name: kind === "movie" ? /^Movies/ : /^Series/ }),
    );
    await settle(0);

    expect(
      document
        .querySelector('[data-lineup-preference="order"] .lineup-preference-label')
        ?.textContent?.trim(),
    ).toBe("Category order");
    await openOrderDialog();
    await settle(0);
    expect(
      [...orderDialog()!.querySelectorAll("[data-lineup-order-option]")].map((option) =>
        option.querySelector(".lineup-preference-label")?.textContent?.trim(),
      ),
    ).toEqual(["Provider order", "Alphabetical", "Custom Order"]);
    fireEvent.click(
      within(document.querySelector("[data-settings-dialog]")!).getByRole("button", {
        name: "Close",
      }),
    );
    await settle(0);

    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".lineup-manager-list .lineup-row-open")!,
    );
    await settle(0);
    expect(
      document
        .querySelector('[data-lineup-preference="order"] .lineup-preference-label')
        ?.textContent?.trim(),
    ).toBe(kind === "movie" ? "Movie order" : "Series order");
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-lineup-preference]")].map(
        (button) => button.dataset.lineupPreference,
      ),
    ).toEqual(["order"]);
    await openOrderDialog();
    await settle(0);
    expect(
      [...orderDialog()!.querySelectorAll("[data-lineup-order-option]")].map(
        (option) => option.dataset.lineupOrderOption,
      ),
    ).toEqual(["provider", "alphabetical", "custom"]);
  },
);

test("hiding all categories sends one scoped write with no confirmation", async () => {
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      return Promise.resolve();
    },
  });
  const { useLineup } = await import("../src/stores/lineup");
  await openContent();
  const revision = useLineup.getState().revision;
  const mark = writes.length;

  await settle(0);

  const hideAll = bulkButton("hide");
  hideAll.focus();
  fireEvent.click(hideAll);
  await settle(700);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(writes.length).toBe(mark + 1);
  expect(useLineup.getState().revision).not.toBe(revision);
  expect(useLineup.getState().managedCategories.every((category) => category.hidden)).toBe(
    true,
  );
});

test("the order dialog closes on selection and a failed write restores the mode silently", async () => {
  let armed = false;
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!armed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  const { useLineup } = await import("../src/stores/lineup");
  await openContent();

  await openOrderDialog();
  armed = true;
  const mark = writes.length;
  orderOption("alphabetical")!.focus();
  press(KEY.ENTER);
  await settle(0);

  // The chooser is gone on the press itself: the optimistic mode is already
  // showing and persistence is not the dialog's concern anymore.
  expect(orderDialog()).toBeNull();
  expect(orderValueLabel()).toBe("Alphabetical");
  expect(useLineup.getState().categoryOrderModes.live).toBe("alphabetical");

  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();

  await act(async () => {
    gates[0]!.reject(new Error("quota"));
  });
  await settle(700);

  // The failed write restores the durable mode with no notice and no retry view.
  expect(orderValueLabel()).toBe("Provider order");
  expect(useLineup.getState().categoryOrderModes.live).toBe("provider");
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();

  // A later choice still saves: nothing needed a Retry mechanism to recover.
  await openOrderDialog();
  await chooseOrderOption("alphabetical");
  await settle(700);
  expect(writes.length).toBe(mark + 2);
  await act(async () => {
    gates[1]!.resolve();
  });
  await settle(700);
  expect(orderValueLabel()).toBe("Alphabetical");
  expect(useLineup.getState().categoryOrderModes.live).toBe("alphabetical");
});

test("bulk hide sends its scoped write directly with no confirmation", async () => {
  let armed = false;
  let resolveWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      return armed ? pendingWrite : Promise.resolve();
    },
  });
  await openContent();
  await settle(0);

  armed = true;
  const mark = writes.length;
  fireEvent.click(bulkButton("hide"));
  await settle(700);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(writes.length).toBe(mark + 1);
  fireEvent.click(bulkButton("hide"));
  await settle(0);
  expect(writes.length).toBe(mark + 1);

  await act(async () => {
    resolveWrite();
  });
  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(document.activeElement).toBe(
    document.querySelector('[data-settings-focus="lineup-open-News"]'),
  );
});

test("bulk hide covers every section category behind an active search", async () => {
  let armed = false;
  let resolveWrite!: () => void;
  const pendingWrite = new Promise<void>((resolve) => {
    resolveWrite = resolve;
  });
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      return armed ? pendingWrite : Promise.resolve();
    },
  });
  await openContent();
  await settle(0);

  fireEvent.click(document.querySelector<HTMLElement>('[data-lineup-action="search"]')!);
  await settle(0);
  fireEvent.change(document.querySelector<HTMLInputElement>(".lineup-search-input")!, {
    target: { value: "News" },
  });
  await settle(700);
  expect(visibilityRows().some((row) => visibilityRowText(row).includes("Sport"))).toBe(false);

  armed = true;
  const mark = writes.length;
  fireEvent.click(bulkButton("hide"));
  await settle(700);

  expect(writes.length).toBe(mark + 1);
  await act(async () => {
    resolveWrite();
  });
  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(visibilityRows().every((row) => row.getAttribute("aria-checked") === "false")).toBe(
    true,
  );
});

test("a scope mode change while editing exits the editor safely", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(true);
  await enterReorder();
  await settle(0);
  expect(document.querySelector(".lineup-sort-row")).toBeTruthy();

  const { applyLineupMutation, useLineup } = await import("../src/stores/lineup");
  const state = useLineup.getState();
  const changed = applyLineupMutation(state.revision, {
    type: "item-order.mode",
    categoryKey: "News",
    mode: "provider",
  });
  await settle(700);
  expect((await changed).ok).toBe(true);
  await settle(0);

  expect(document.querySelector(".lineup-sort-row")).toBeNull();
  expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-mode")).toBe(
    "browse",
  );
  expect(orderValueLabel()).toBe("Provider order");
  expect(customOrderButton()).toBeNull();
});

test.each([
  { kind: "movie" as const, indexed: false },
  { kind: "movie" as const, indexed: true },
  { kind: "series" as const, indexed: false },
  { kind: "series" as const, indexed: true },
])(
  "returning $kind item order to provider sequence retains Custom with indexed=$indexed",
  async ({ kind, indexed }) => {
    const categoryId = kind === "movie" ? "10" : "20";
    const items = ["Beta", "Alpha"].map((name, index) => ({
      stream_id: String(100 + index),
      series_id: String(100 + index),
      category_id: categoryId,
      name,
      container_extension: "mp4",
    }));
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "News" }],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live" }],
      get_vod_categories:
        kind === "movie" ? [{ category_id: categoryId, category_name: "Cinema" }] : [],
      get_series_categories:
        kind === "series" ? [{ category_id: categoryId, category_name: "Shows" }] : [],
      get_vod_streams: items,
      get_series: items,
    };
    await mountApp("", {
      source: XTREAM_SOURCE,
      fetchImplementation: async (input) => {
        const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
        if (!(action in bodies)) throw new Error(`Unexpected fixture action ${action}`);
        return new Response(JSON.stringify(bodies[action]), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await openContent();
    await settle(0);
    fireEvent.click(
      screen.getByRole("tab", { name: kind === "movie" ? /^Movies/ : /^Series/ }),
    );
    await settle(0);
    if (indexed) {
      const { useLibrary } = await import("../src/stores/library");
      await act(async () => useLibrary.getState().loadIndex(kind));
    }
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".lineup-manager-list .lineup-row-open")!,
    );
    await settle(0);
    expect(document.querySelectorAll(".lineup-channel-number")).toHaveLength(0);
    expect(document.querySelectorAll(".lineup-channel-label")).toHaveLength(0);
    expect(orderValueLabel()).toBe("Provider order");
    await enterReorder();
    await settle(0);
    const original = [...document.querySelectorAll<HTMLButtonElement>("[data-sort-id]")];
    const originalIds = original.map((row) => row.dataset.sortId);
    expect(originalIds).toHaveLength(2);
    fireEvent.click(original[0]);
    press(KEY.DOWN);
    fireEvent.click(original[0]);
    await settle(700);
    press(KEY.BACK);
    await settle(0);
    expect(orderValueLabel()).toBe("Custom Order");
    await enterReorder();
    await settle(0);
    const reordered = [...document.querySelectorAll<HTMLButtonElement>("[data-sort-id]")];
    expect(reordered.map((row) => row.dataset.sortId)).toEqual([
      originalIds[1],
      originalIds[0],
    ]);
    fireEvent.click(reordered[1]);
    reordered[1].focus();
    press(KEY.UP);
    fireEvent.click(reordered[1]);
    await settle(700);
    press(KEY.BACK);
    await settle(0);

    const { isDefaultItemOrder, useLineup } = await import("../src/stores/lineup");
    const modes = useLineup.getState().itemOrderModes;
    const keys = Object.keys(modes);
    expect(keys).toHaveLength(1);
    expect(modes[keys[0]]).toBe("custom");
    expect(isDefaultItemOrder(keys[0])).toBe(true);
    expect(orderValueLabel()).toBe("Custom Order");
  },
);

test("reorder carries a grabbed row into the next 20 item page without duplication", async () => {
  const playlist = `#EXTM3U\n${Array.from(
    { length: 21 },
    (_, index) =>
      `#EXTINF:-1 tvg-id="${index}" group-title="News",Channel ${index + 1}\nhttp://example.invalid/${index}.m3u8`,
  ).join("\n")}`;
  await mountApp(playlist);
  await openContent(true);
  await enterReorder();
  await settle(0);

  expect(document.querySelectorAll(".lineup-sort-row")).toHaveLength(20);
  const grabbed = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
  fireEvent.click(grabbed);
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(".lineup-pagination button:last-child")!,
  );
  await settle(0);

  const labels = [...document.querySelectorAll(".lineup-sort-row")].map(
    (row) => row.textContent,
  );
  expect(labels).toHaveLength(1);
  expect(labels.filter((label) => label?.includes("Channel 1"))).toHaveLength(1);
  expect(document.querySelector(".lineup-sort-row")).toBe(grabbed);
  expect(document.activeElement).toBe(grabbed);
  expect(document.querySelector(".lineup-pagination > span")?.textContent).toBe("Page 2 of 2");
});

test("pointer drag tentatively reorders rows and commits once on drop", async () => {
  await mountApp(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);

  fireEvent.pointerDown(rows[0], { pointerId: 7, clientY: 20 });
  fireEvent.pointerMove(rows[0], { pointerId: 7, clientY: 100 });
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Beta");
  fireEvent.pointerUp(rows[0], { pointerId: 7, clientY: 100 });
  await settle(700);

  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
  expect(
    useLineup
      .getState()
      .categories.find((category) => category.name === "News")
      ?.channels.map((channel) => channel.name),
  ).toEqual(["Beta", "Alpha"]);
});

test("pointer cancellation rolls a tentative reorder back without committing", async () => {
  await mountApp(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);

  fireEvent.pointerDown(rows[0], { pointerId: 9, clientY: 20 });
  fireEvent.pointerMove(rows[0], { pointerId: 9, clientY: 100 });
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Beta");
  fireEvent.pointerCancel(rows[0], { pointerId: 9, clientY: 100 });

  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Alpha");
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
});

test("bulk hide keeps focus on its trigger through the direct write", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  await settle(0);

  const hideAll = bulkButton("hide");
  hideAll.focus();
  fireEvent.click(hideAll);
  await settle(700);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement).toBe(hideAll);
});

test("a focused active Settings section shows one visual state", () => {
  const styles = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  expect(styles).toMatch(
    /html\[data-input-mode="pointer"\] \.sheet-rail \.row\.showing:hover::before/,
  );
});

test("lineup action menu rows respect the rounded popup edges", () => {
  const styles = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  expect(styles).toMatch(/\.action-menu-list > button \{[^}]*border-radius:\s*var\(--r-md\);/);
  expect(styles).toMatch(/\.action-menu-list \{[^}]*overflow-y:\s*auto;/);
});

test("lineup categories keep Search alone in the toolbar with saved preferences above the list", async () => {
  await mountApp(CATEGORIES);
  await openContent();

  expect(
    [
      ...document.querySelectorAll<HTMLElement>(
        ".lineup-header-actions > [data-lineup-action]",
      ),
    ].map((element) => element.dataset.lineupAction),
  ).toEqual(["search"]);
  expect(document.querySelector('[data-lineup-action="more"]')).toBeNull();
  expect(document.querySelector(".lineup-manager .option-picker")).toBeNull();
  expect(document.querySelector('button[data-lineup-action="create"]')).toBeNull();
  expect(document.querySelector(".lineup-create-dock")).toBeNull();

  const preferences = document.querySelector<HTMLElement>("[data-lineup-preferences]")!;
  expect(preferences).toBeTruthy();
  const header = document.querySelector<HTMLElement>(".lineup-list-header")!;
  expect(header.contains(preferences)).toBe(false);
  expect(
    preferences.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(header.querySelector('[data-lineup-action="search"]')).toBeTruthy();

  const labels = [...preferences.querySelectorAll<HTMLElement>("[data-lineup-preference]")].map(
    (button) => button.dataset.lineupPreference,
  );
  expect(labels).toEqual(["order"]);
  expect(
    preferences.querySelector('[data-lineup-preference="order"] .lineup-preference-label')
      ?.textContent,
  ).toBe("Category order");
});

test("lineup row actions inherit the selected colour and toasts wrap", () => {
  const styles = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  const inherited = styles.match(/\.management-row-actions:hover[^{]*\{([^}]*)\}/)?.[1] ?? "";
  expect(inherited).toContain("color: var(--target-text)");
  const number = styles.match(/\.lineup-channel-number \{([^}]*)\}/)?.[1] ?? "";
  expect(number).toContain("font-variant-numeric: tabular-nums");
  const toast = styles.match(/\.toast \{([^}]*)\}/)?.[1] ?? "";
  expect(toast).toContain("overflow-wrap");
});

test("reorder hover and grabbed rows use readable white targets", () => {
  const styles = readFileSync(join(process.cwd(), "src/styles/app.css"), "utf8");
  const grabbed = styles.match(/\.lineup-sort-row\.grabbed \{([^}]*)\}/)?.[1] ?? "";
  expect(grabbed).toContain("background: var(--target-bg)");
  expect(grabbed).toContain("color: var(--target-text)");
  expect(grabbed).not.toContain("accent-dim");
  expect(styles).toMatch(
    /html\[data-input-mode="pointer"\] \.lineup-sort-row:hover[^{]*\{[^}]*background:\s*var\(--target-bg\);[^}]*color:\s*var\(--target-text\);/,
  );
  expect(
    /html\[data-input-mode="pointer"\] \.lineup-sort-row:hover \.lineup-sort-handle[^{]*\{[^}]*color:\s*var\(--target-text\);/.test(
      styles,
    ),
  ).toBe(true);
  expect(
    /html\[data-input-mode="remote"\] \.lineup-sort-row:focus \.lineup-sort-handle[^{]*\{[^}]*color:\s*var\(--target-text\);/.test(
      styles,
    ),
  ).toBe(true);
});

test("opening a category and its editor keeps directional focus active", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        ".sheet-body button, .sheet-body input, [data-settings-dialog] button, [data-settings-dialog] input",
      ),
    ];
    const top = Math.max(0, controls.indexOf(this)) * 50;
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });

  await openCategory("News");
  await settle(0);
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();

  await openRenameRow("News");
  await settle(0);
  const name = document.querySelector<HTMLInputElement>("#lineup-name");
  expect(document.activeElement).toBe(name);

  press(KEY.DOWN);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset to default" }));
  press(KEY.DOWN);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  press(KEY.DOWN);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save" }));
});

test("category rename and bulk visibility use effective category records", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  await openRenameRow("News");
  await settle(0);
  fireEvent.change(document.querySelector<HTMLInputElement>("#lineup-name")!, {
    target: { value: "Headlines" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1200);
  expect(screen.getAllByText("Headlines").length).toBeGreaterThan(0);

  await chooseBulkHide();
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().managedCategories.every((category) => category.hidden)).toBe(
    true,
  );
});

test("saving an untouched provider category keeps its revision and closes the editor", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  const lineup = await import("../src/stores/lineup");
  const revision = lineup.useLineup.getState().revision;

  await openRenameRow("News");
  await settle(0);
  const name = document.querySelector<HTMLInputElement>("#lineup-name")!;
  expect(name.value).toBe("News");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);

  expect(lineup.useLineup.getState().revision).toBe(revision);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
});

test("a pending category rename ignores repeat saves and keeps its draft until cancelled", async () => {
  let armed = false;
  let rejectWrite!: (error: unknown) => void;
  const pendingWrite = new Promise<void>((_resolve, reject) => {
    rejectWrite = reject;
  });
  const writes: unknown[] = [];
  await mountApp(CATEGORIES, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      return armed ? pendingWrite : Promise.resolve();
    },
  });
  await openContent();
  await openRenameRow("News");
  await settle(0);
  const name = document.querySelector<HTMLInputElement>("#lineup-name")!;
  fireEvent.change(name, { target: { value: "Headlines" } });

  armed = true;
  const mark = writes.length;
  const save = screen.getByRole("button", { name: "Save" });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  fireEvent.click(save);
  fireEvent.click(save);
  await settle(700);

  expect(writes.length).toBe(mark + 1);
  expect(JSON.stringify(writes[mark])).toContain("Headlines");
  expect(name.disabled).toBe(true);
  expect((save as HTMLButtonElement).disabled).toBe(true);
  expect((cancel as HTMLButtonElement).disabled).toBe(true);

  press(KEY.BACK);
  await settle(0);
  press(KEY.BACK);
  await settle(0);
  fireEvent.click(document.querySelector<HTMLElement>(".settings-dialog-scrim")!);
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeTruthy();

  await act(async () => {
    rejectWrite(new Error("quota"));
  });
  await settle(700);

  expect(document.querySelector("[data-settings-dialog]")).toBeTruthy();
  expect(document.querySelector<HTMLInputElement>("#lineup-name")!.value).toBe("Headlines");

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(writes.length).toBe(mark + 1);
});

test("Settings blocks panel movement while it owns input", async () => {
  await mountApp(CATEGORIES);
  const selected = document.querySelector(".panel .row.cursor")?.textContent;

  press(KEY.YELLOW);
  press(KEY.DOWN);

  expect(document.querySelector(".sheet")).toBeTruthy();
  expect(document.querySelector(".panel .row.cursor")).toBeNull();
  press(KEY.BACK);
  expect(document.querySelector(".panel .row.cursor")?.textContent).toBe(selected);
});

test("a Settings confirmation owns directional input", async () => {
  await mountApp(CATEGORIES);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  await chooseMenuItem("remove");
  await settle(0);

  const section = document.querySelector(".sheet-rail .row.cursor")?.textContent;
  const panelRow = document.querySelector(".panel .row.cursor")?.textContent;
  const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
  expect(back.disabled).toBe(true);
  fireEvent.click(back);
  expect(document.querySelector(".playlist-list-header")).toBeTruthy();
  press(KEY.RIGHT);

  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(document.querySelector(".sheet-rail .row.cursor")?.textContent).toBe(section);
  expect(document.querySelector(".panel .row.cursor")?.textContent).toBe(panelRow);
  expect(document.activeElement?.closest(".dialog")).toBeTruthy();
});

test("raw Enter on the safe answer closes a confirmation without confirming", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  await chooseMenuItem("remove");
  await settle(0);

  const dialog = document.querySelector<HTMLElement>(".dialog")!;
  const keep = within(dialog).getByRole("button", { name: "Keep it" });
  expect(document.activeElement).toBe(keep);
  press(KEY.ENTER);
  await settle(0);

  expect(document.querySelector(".dialog")).toBeNull();
  const trigger = screen.getByRole("button", { name: "Actions, Test" });
  expect(trigger).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
});

test("playlist editors use the same detail back behavior", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  const closeMenu = openActionMenu()?.querySelector<HTMLButtonElement>(
    ".action-menu-actions .btn",
  );
  expect(closeMenu).toBeTruthy();
  fireEvent.click(closeMenu!);
  await settle(0);
  expect(openActionMenu()).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);
  await chooseMenuItem("edit");
  await settle(0);

  expect(openActionMenu()).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Edit playlist address" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Back to Playlists" })).toBeNull();

  const xtreamChoice = screen.getByRole("button", { name: "Xtream login" });
  xtreamChoice.focus();
  fireEvent.click(xtreamChoice);
  await settle(0);
  expect(screen.getByRole("heading", { level: 2, name: "Edit credentials" })).toBeTruthy();
  expect(document.activeElement).toBe(xtreamChoice);

  const m3uChoice = screen.getByRole("button", { name: "M3U playlist" });
  m3uChoice.focus();
  fireEvent.click(m3uChoice);
  await settle(0);
  expect(screen.getByRole("heading", { level: 2, name: "Edit playlist address" })).toBeTruthy();
  expect(document.activeElement).toBe(m3uChoice);

  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions, Test" }));

  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await settle(0);
  expect(screen.getByRole("heading", { level: 2, name: "Add playlist" })).toBeTruthy();
  expect(document.querySelector(".pl")).toBeTruthy();
  const addXtream = screen.getByRole("button", { name: "Xtream login" });
  addXtream.focus();
  fireEvent.click(addXtream);
  await settle(0);
  expect(screen.getByRole("heading", { level: 2, name: "Add playlist" })).toBeTruthy();
});

test("playlist editing is a dialog over the mounted list and cancel writes nothing", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  await chooseMenuItem("edit");
  await settle(0);

  const editor = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(editor.getAttribute("role")).toBe("dialog");
  expect(editor.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector(".pl")).toBeTruthy();
  expect(
    [...editor.querySelectorAll<HTMLElement>(".dialog-actions button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).toEqual(["Cancel", "Save"]);

  const name = screen.getByLabelText("Playlist name") as HTMLInputElement;
  const url = screen.getByLabelText("Playlist address") as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Draft name" } });
  fireEvent.change(url, { target: { value: "http://draft.invalid/list.m3u" } });

  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(
    within(document.querySelector<HTMLElement>("[data-settings-dialog]")!).getByRole("button", {
      name: "Cancel",
    }),
  );
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(document.querySelector(".pl")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions, Test" }));
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);

  await openPlaylistMenu();
  await chooseMenuItem("edit");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Playlist address"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeTruthy();
  expect((screen.getByLabelText("Playlist name") as HTMLInputElement).value).toBe("Test");
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
});

test("resetting application data revokes authorised devices", async () => {
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Authorised device" });
  if (!paired.ok) throw new Error("pairing failed");
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);

  fireEvent.click(screen.getByRole("button", { name: "About" }));
  const disconnectWarning =
    "This will also disconnect paired devices. Pair again to reconnect.";
  expect(document.querySelector(".sheet-body")?.textContent).not.toContain(disconnectWarning);
  fireEvent.click(screen.getByRole("button", { name: "Reset app data" }));
  const confirmation = document.querySelector('[role="alertdialog"], [role="dialog"]');
  expect(confirmation?.textContent).toContain(disconnectWarning);
  expect(confirmation?.textContent).not.toContain("It does not delete the source playlists");
  const resetButtons = screen.getAllByRole("button", { name: "Reset app data" });
  fireEvent.click(resetButtons[resetButtons.length - 1]);
  await settle(0);

  expect(listPairedDevices()).toEqual([]);
});

function xtreamBodies(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: {
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    },
    get_live_categories: [{ category_id: "1", category_name: "News" }],
    get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live" }],
    get_vod_categories: [{ category_id: "10", category_name: "Cinema" }],
    get_vod_streams: [
      { stream_id: "100", category_id: "10", name: "Film", container_extension: "mp4" },
    ],
    get_series_categories: [{ category_id: "20", category_name: "Shows" }],
    get_series: [
      {
        stream_id: "200",
        series_id: "200",
        category_id: "20",
        name: "Show",
        container_extension: "mp4",
      },
    ],
    ...overrides,
  } as Record<string, unknown>;
}

async function mountXtream(overrides: Record<string, unknown> = {}) {
  const bodies = xtreamBodies(overrides);
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
      if (!(action in bodies)) throw new Error(`Unexpected fixture action ${action}`);
      return new Response(JSON.stringify(bodies[action]), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

test("an M3U playlist hides the content type selector", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  expect(document.querySelector(".category-kind-selector")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(document.querySelectorAll(".category-manager-main").length).toBeGreaterThan(0);
});

test("an Xtream playlist with only live categories hides the selector", async () => {
  await mountXtream({
    get_vod_categories: [],
    get_vod_streams: [],
    get_series_categories: [],
    get_series: [],
  });
  await openContent();
  await settle(0);
  expect(document.querySelector(".category-kind-selector")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(
    document.querySelector(".lineup-manager-list .category-manager-main")?.textContent,
  ).toContain("News");
});

test("an Xtream playlist with only movie categories selects movies automatically", async () => {
  await mountXtream({
    get_live_categories: [],
    get_live_streams: [],
    get_series_categories: [],
    get_series: [],
  });
  await openContent();
  await settle(0);
  await settle(0);
  expect(document.querySelector(".category-kind-selector")).toBeNull();
  expect(screen.queryByRole("tab")).toBeNull();
  expect(
    document.querySelector(".lineup-manager-list .category-manager-main")?.textContent,
  ).toContain("Cinema");
  expect(
    document.querySelector(".lineup-manager-list .lineup-category-label .count"),
  ).toBeNull();
  await openFirstCategory();
  await settle(700);
  expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Film");
  press(KEY.BACK);
  await settle(700);
  expect(
    document.querySelector(".lineup-manager-list .lineup-category-label .count")?.textContent,
  ).toBe("1");
});

test("VOD management preserves provider totals for Movies and Series", async () => {
  await mountXtream({
    get_vod_categories: [{ category_id: "10", category_name: "Cinema", count: 7 }],
    get_series_categories: [{ category_id: "20", category_name: "Shows", count: 3 }],
  });
  await openContent();
  fireEvent.click(screen.getByRole("tab", { name: /Movies/ }));
  await settle(700);
  expect(
    document.querySelector(".lineup-manager-list .lineup-category-label .count")?.textContent,
  ).toBe("7");
  fireEvent.click(screen.getByRole("tab", { name: /Series/ }));
  await settle(700);
  expect(
    document.querySelector(".lineup-manager-list .lineup-category-label .count")?.textContent,
  ).toBe("3");
});

test("an Xtream playlist lists only its available content types", async () => {
  await mountXtream({ get_series_categories: [], get_series: [] });
  await openContent();
  await settle(0);
  const tabs = screen.getAllByRole("tab");
  expect(tabs).toHaveLength(2);
  expect(tabs[0].textContent).toContain("Live");
  expect(tabs[1].textContent).toContain("Movies");
  expect(screen.queryByRole("tab", { name: /Series/ })).toBeNull();
  expect(tabs.every((tab) => tab.getAttribute("data-ok-guide") === "Select Content Type")).toBe(
    true,
  );
  expect(tabs.every((tab) => !tab.querySelector(".count"))).toBe(true);
  expect(document.querySelector(".lineup-list-header .count")).toBeTruthy();

  const layout = document.querySelector(".lineup-layout") as HTMLElement;
  const selector = document.querySelector(".category-kind-selector") as HTMLElement;
  const preferences = document.querySelector("[data-lineup-preferences]") as HTMLElement;
  const list = document.querySelector(".lineup-manager-list") as HTMLElement;
  expect(layout).toBeTruthy();
  expect(
    selector.compareDocumentPosition(preferences) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    preferences.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(preferences.contains(document.querySelector('[data-lineup-preference="order"]'))).toBe(
    true,
  );
  expect(preferences.contains(document.querySelector(".lineup-order-attach"))).toBe(true);
  const actionGroup = preferences.querySelector(".lineup-order-attach") as HTMLElement;
  expect(actionGroup).toBeTruthy();
  expect(actionGroup.contains(document.querySelector('[data-lineup-preference="order"]'))).toBe(
    true,
  );
  expect(preferences.contains(list)).toBe(false);

  const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
  expect(panels).toHaveLength(1);
  const panel = panels[0];
  const liveTab = document.querySelector<HTMLElement>(
    '.category-kind-option[aria-selected="true"]',
  )!;
  expect(liveTab.id).toBeTruthy();
  expect(liveTab.getAttribute("aria-controls")).toBe(panel.id);
  expect(document.getElementById(liveTab.getAttribute("aria-controls")!)).toBe(panel);
  expect(panel.getAttribute("aria-labelledby")).toBe(liveTab.id);
  expect(panel.classList.contains("lineup-tab-content")).toBe(true);
  expect(panel.contains(preferences)).toBe(true);
  expect(panel.contains(list)).toBe(true);
  expect(panel.contains(selector)).toBe(false);

  fireEvent.click(screen.getAllByRole("tab")[1]);
  await settle(0);
  expect(document.querySelectorAll('.category-kind-option[aria-selected="true"]')).toHaveLength(
    1,
  );
  const movieTab = document.querySelector<HTMLElement>(
    '.category-kind-option[aria-selected="true"]',
  )!;
  const moviePanel = document.getElementById(
    movieTab.getAttribute("aria-controls")!,
  ) as HTMLElement;
  expect(moviePanel).toBeTruthy();
  expect(moviePanel.classList.contains("lineup-tab-content")).toBe(true);
  expect(moviePanel.getAttribute("aria-labelledby")).toBe(movieTab.id);
  expect(moviePanel.contains(document.querySelector("[data-lineup-preferences]"))).toBe(true);
  expect(moviePanel.contains(document.querySelector(".lineup-manager-list"))).toBe(true);
  expect(
    document.querySelector(".lineup-manager-list .category-manager-main")?.textContent,
  ).toContain("Cinema");

  fireEvent.click(
    document.querySelector<HTMLButtonElement>(".lineup-manager-list .lineup-row-open")!,
  );
  await settle(0);
  expect(document.querySelector(".category-kind-selector")).toBeNull();
  expect(document.querySelector('[role="tabpanel"]')).toBeNull();
  expect(document.querySelector(".lineup-tab-content")).toBeNull();
  expect(document.querySelector("[data-lineup-preferences]")).toBeTruthy();
});

test("empty search results keep every available content type", async () => {
  await mountXtream({ get_series_categories: [], get_series: [] });
  await openContent();
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Search categories" }));
  const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  fireEvent.change(input, { target: { value: "zzz-no-match" } });
  await settle(300);
  expect(screen.getByText("No matching items.")).toBeTruthy();
  expect(screen.getAllByRole("tab")).toHaveLength(2);
});

test("drilling into a category and editing returns one level at a time", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  await openCategory("News");
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();

  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  const categoryOpener = document.activeElement as HTMLElement | null;
  expect(categoryOpener?.getAttribute("data-settings-focus") ?? "").toBe("lineup-open-News");
  expect(categoryOpener?.getAttribute("aria-label") ?? "").toBe("Open, News");

  await openCategory("News");
  await openRenameRow("Alpha");
  await settle(0);
  expect(screen.getByLabelText("Name")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-mode")).toBe(
    "browse",
  );
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  expect(
    (document.activeElement as HTMLElement | null)?.getAttribute("data-settings-focus"),
  ).toBe("lineup-open-News");

  press(KEY.BACK);
  await settle(0);
  expect(screen.queryByRole("heading", { level: 4, name: "Categories" })).toBeNull();
  expect(screen.getByRole("button", { name: "Actions, Test" })).toBeTruthy();
});

const OPAQUE_LINEUP = `#EXTM3U
#EXTINF:-1 tvg-id="opaque-ch-9f2" group-title="News",Alpha "Beta" اليوم
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="opaque-ch-71c" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="opaque-ch-33d" group-title="Sport",Gamma
http://example.invalid/c.m3u8`;

test("playlist cards open their content directly while actions stay explicit", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const row = document.querySelector<HTMLElement>(".pl")!;
  const open = row.querySelector<HTMLElement>(".pl-open")!;
  const listHeader = document.querySelector<HTMLElement>(".playlist-list-header")!;
  expect(
    listHeader.querySelector("[data-playlist-search-toggle]")?.getAttribute("aria-label"),
  ).toBe("Search playlists");
  expect(listHeader.querySelector(".settings-add-playlist")?.getAttribute("aria-label")).toBe(
    "Add a playlist",
  );
  expect(open.getAttribute("aria-label")).toBe("Open, Test");
  expect(open.getAttribute("data-ok-guide")).toBe("Open");
  const trigger = row.querySelector<HTMLElement>(".pl-menu")!;
  expect(trigger.getAttribute("data-playlist-menu")).toBe("pl-1");
  expect(trigger.getAttribute("aria-label")).toBe("Actions, Test");
  expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  const main = open.querySelector<HTMLElement>(".pl-main")!;
  expect(main.tagName).toBe("SPAN");
  expect(main.hasAttribute("data-playlist-action")).toBe(false);
  expect(main.querySelector(".pl-name")?.textContent).toBe("Test");
  expect(main.querySelector(".tag")?.textContent).toBe("Active");
  expect(open.contains(trigger)).toBe(false);
  expect(trigger.contains(open)).toBe(false);
  expect(open.parentElement).toBe(trigger.parentElement);

  const calls = () => vi.mocked(fetch).mock.calls.length;
  const before = calls();
  fireEvent.click(open);
  await settle(0);
  expect(document.querySelector(".lineup-manager")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".pl")).toBeTruthy();
  expect(document.activeElement).toBe(document.querySelector(".pl-open"));
  expect(calls()).toBe(before);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();

  await openPlaylistMenu();
  const menu = openActionMenu()!;
  const menuHeading = menu.querySelector("h2")!;
  expect(menuHeading.getAttribute("dir")).toBeNull();
  expect(menuHeading.querySelector("span")?.getAttribute("dir")).toBeNull();
  expect(menuHeading.textContent).toBe("Test");
  const menuButtons = [...menu.querySelectorAll<HTMLButtonElement>("[data-settings-action]")];
  expect(menuButtons.map((button) => button.dataset.settingsAction)).toEqual([
    "activate",
    "refresh",
    "edit",
    "reset",
    "remove",
  ]);
  expect(menuButtons.every((button) => button.textContent?.trim())).toBe(true);
  expect(menuButtons.every((button) => button.querySelector(".icon"))).toBe(true);
  expect(menuItem("reset")!.classList.contains("danger")).toBe(true);
  expect(menuItem("remove")!.classList.contains("danger")).toBe(true);
  const footer = menu.querySelector<HTMLElement>(".action-menu-actions")!;
  expect(footer).toBeTruthy();
  expect(footer.closest('[role="menu"]')).toBeNull();
  expect(within(footer).getByRole("button", { name: "Close" })).toBeTruthy();
  const activeQuickActivate = quickPlaylistAction("activate", "Test");
  expect(activeQuickActivate.getAttribute("aria-pressed")).toBe("true");
  expect(activeQuickActivate.disabled).toBe(false);

  press(KEY.ESC);
  await settle(0);
  expect(openActionMenu()).toBeNull();
  const activeCalls = calls();
  await openPlaylistMenu();
  const activeActivate = menuItem("activate")!;
  expect(activeActivate.disabled).toBe(true);
  expect(activeActivate.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(activeActivate);
  await settle(0);
  expect(openActionMenu()).not.toBeNull();
  expect(calls()).toBe(activeCalls);
  press(KEY.ESC);
  await settle(0);
  expect(openActionMenu()).toBeNull();
  await refreshPlaylistFromMenu("Test");
  await settle(700);
  expect(calls()).toBe(before + 1);
});

test("activating an inactive playlist switches once and restores its control", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Second" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://second.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect(document.querySelector(".toast-host [role='status']")?.textContent).toBe(
    "Second saved.",
  );

  const { useSettings } = await import("../src/stores/settings");
  const second = useSettings.getState().playlists.find((item) => item.name === "Second")!;
  const rowFor = (name: string) =>
    quickPlaylistAction("activate", name).closest<HTMLElement>(".pl")!;
  const menuTrigger = screen.getByRole("button", { name: "Actions, Second" });
  await openPlaylistMenu("Second");
  fireEvent.click(menuItem("activate")!);
  await settle(0);
  expect(rowFor("Second").getAttribute("aria-busy")).toBeNull();
  expect(rowFor("Second").querySelector("[data-playlist-refresh]")).toBeNull();
  await settle(1200);

  expect(useSettings.getState().activePlaylistId).toBe(second.id);
  expect(document.activeElement).toBe(menuTrigger);
  const secondActivate = quickPlaylistAction("activate", "Second");
  expect(secondActivate.getAttribute("aria-pressed")).toBe("true");
  expect(secondActivate.disabled).toBe(false);

  const calls = vi.mocked(fetch).mock.calls.length;
  expect(quickPlaylistAction("activate", "Test").disabled).toBe(false);
  expect(quickPlaylistAction("activate", "Test").getAttribute("aria-disabled")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
});

test("a failed playlist activation keeps the error and restores its control", async () => {
  let failPlaylist = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (failPlaylist && String(input).includes("second.invalid")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  const second = useSettings.getState().playlists.find((item) => item.name === "Second")!;
  const trigger = quickPlaylistAction("activate", "Second");

  failPlaylist = true;
  fireEvent.click(trigger);
  await settle(1200);

  expect(useSettings.getState().activePlaylistId).toBe(second.id);
  const toast = await playlistToast();
  expect(toast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(toast?.textContent).toBe("Second: Could not load the playlist: HTTP 500");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(document.querySelector(".playlist-row-error")).toBeNull();
  expect(document.querySelector(".sheet-body [role='alert']")).toBeNull();
  expect(document.activeElement).toBe(trigger);

  await settle(6000);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("a playlist recovery error notifies once as a transient toast", async () => {
  let fail = true;
  await mountApp(PLAYLIST, {
    fetchImplementation: async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Manage playlists" }));
  await settle(0);

  const body = document.querySelector<HTMLElement>(".sheet-body")!;
  const message = "Test: Could not load the playlist: Failed to fetch";
  const toast = document.querySelector<HTMLElement>(".toast-host .toast");
  expect(toast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(toast?.textContent).toBe(message);
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(body.querySelector(".playlist-row-error")).toBeNull();
  expect(body.querySelector('[role="alert"]')).toBeNull();
  expect(body.querySelector(".settings-status")).toBeNull();

  fail = false;
  await refreshPlaylistFromMenu("Test");
  await settle(700);

  const successToast = document.querySelector<HTMLElement>(".toast-host .toast");
  expect(successToast?.parentElement?.getAttribute("role")).toBe("status");
  expect(successToast?.textContent).toContain("Refreshed");
  expect(body.textContent).not.toContain("Could not load the playlist");
  expect(body.querySelector(".settings-status")).toBeNull();
  expect(document.activeElement).toBe(playlistMenuTrigger("Test"));

  await settle(6000);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("an inactive playlist refresh failure notifies once without touching shared state", async () => {
  let failSecond = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (failSecond && String(input).includes("second.invalid")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  failSecond = true;
  await refreshPlaylistFromMenu("Second");
  await settle(700);

  const body = document.querySelector<HTMLElement>(".sheet-body")!;
  const firstToast = await playlistToast();
  expect(firstToast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(firstToast?.textContent).toContain("Second");
  expect(firstToast?.textContent).toContain("HTTP 500");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(body.querySelector(".playlist-row-error")).toBeNull();
  expect(body.querySelectorAll('[role="alert"]')).toHaveLength(0);
  expect(useChannels.getState().error).toBe("");

  await settle(4000);
  await refreshPlaylistFromMenu("Second");
  await settle(700);

  const secondToast = await playlistToast();
  expect(secondToast.textContent).toBe(firstToast.textContent);
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(document.activeElement).toBe(playlistMenuTrigger("Second"));
  expect(useChannels.getState().error).toBe("");

  await settle(6000);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("saving active Xtream credentials toasts once when the reload fails", async () => {
  let failCatalogues = false;
  const bodies: Record<string, unknown> = {
    get_live_categories: [{ category_id: "1", category_name: "News" }],
    get_vod_categories: [],
    get_series_categories: [],
    get_live_streams: [
      { stream_id: "1", category_id: "1", name: "Live", container_extension: "m3u8" },
    ],
  };
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      const action = new URL(String(input)).searchParams.get("action");
      if (!action) {
        return new Response(
          JSON.stringify({
            user_info: { auth: 1, status: "Active" },
            server_info: { server_protocol: "http", url: "provider.example" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (failCatalogues) return new Response("boom", { status: 500 });
      if (action in bodies) {
        return new Response(JSON.stringify(bodies[action]), {
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fixture action ${action}`);
    },
  });

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  await chooseMenuItem("edit");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "rotated" } });

  failCatalogues = true;
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1200);

  const toasts = document.querySelectorAll<HTMLElement>(".toast-host .toast");
  expect(toasts).toHaveLength(1);
  expect(toasts[0].parentElement?.getAttribute("role")).toBe("alert");
  expect(toasts[0].textContent).toContain("Test");
  expect(toasts[0].textContent).toContain("Could not load the playlist");
  expect(document.querySelector(".sheet-body [role='alert']")).toBeNull();

  await settle(6000);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("a saved content warning stays a single toast across settings pages", async () => {
  let failActive = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (failActive && String(input).includes("list.invalid")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const base = useSettings.getState().playlists[0]!;
  act(() => {
    useSettings.getState().set("playlists", [
      base,
      ...Array.from({ length: 20 }, (_, index) => ({
        ...base,
        id: `pl-extra-${index}`,
        name: `Extra ${index}`,
      })),
    ]);
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  failActive = true;
  await refreshPlaylistFromMenu("Test");
  await settle(700);

  const body = document.querySelector<HTMLElement>(".sheet-body")!;
  const toast = await playlistToast("warning");
  expect(toast?.parentElement?.getAttribute("role")).toBe("status");
  expect(toast?.textContent).toBe("Could not refresh: HTTP 500. Showing the last saved copy.");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(body.querySelector(".playlist-row-error")).toBeNull();
  expect(body.querySelector(".settings-status")).toBeNull();
  expect(body.querySelectorAll('[role="alert"]')).toHaveLength(0);

  const pagination = body.querySelector<HTMLElement>(".settings-pagination")!;
  fireEvent.click(within(pagination).getByRole("button", { name: "Next" }));
  await settle(0);

  expect(
    [...body.querySelectorAll<HTMLElement>(".pl")].some((item) =>
      item.textContent?.includes("Test"),
    ),
  ).toBe(false);
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(document.querySelector(".toast-host .toast")?.textContent).toBe(
    "Could not refresh: HTTP 500. Showing the last saved copy.",
  );

  fireEvent.click(within(pagination).getByRole("button", { name: "Previous" }));
  await settle(0);
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);

  await settle(6000);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("channel rows keep their effective numbers in browse, visibility and Custom Order", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await settle(0);
  expect(document.querySelectorAll(".lineup-channel-number")).toHaveLength(0);

  await openCategory("News");
  await settle(0);

  const expectChannelNumbers = () => {
    const labels = [
      ...document.querySelectorAll<HTMLElement>(".lineup-manager .lineup-channel-label"),
    ];
    expect(
      labels.map((label) => label.querySelector(".lineup-channel-number")?.textContent),
    ).toEqual(["1", "2"]);
    expect(
      labels.map((label) => label.querySelector(".lineup-channel-name")?.textContent),
    ).toEqual(["Alpha", "Beta"]);
    expect(
      labels.every(
        (label) => label.querySelector(".lineup-channel-number")?.getAttribute("dir") === "ltr",
      ),
    ).toBe(true);
  };
  expectChannelNumbers();

  await openOrderDialog();
  await settle(0);
  expect(
    [...orderDialog()!.querySelectorAll("[data-lineup-order-option]")].map((option) =>
      option.querySelector(".lineup-preference-label")?.textContent?.trim(),
    ),
  ).toEqual(["Provider order", "Alphabetical", "Channel number", "Custom Order"]);
  fireEvent.click(
    within(document.querySelector("[data-settings-dialog]")!).getByRole("button", {
      name: "Close",
    }),
  );
  await settle(0);

  fireEvent.click(visibilityRows()[0]);
  await settle(700);
  expectChannelNumbers();

  await enterReorder();
  await settle(0);
  expectChannelNumbers();
  expect(document.querySelector(".lineup-list-header")?.textContent).toContain("Custom Order");
});

test("switching categories preserves hidden members and their custom order", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await openCategory("News");

  const channelNames = () =>
    [...document.querySelectorAll(".lineup-manager-list .lineup-channel-name")].map(
      (node) => node.textContent,
    );
  expect(channelNames()).toEqual(["Alpha", "Beta"]);
  fireEvent.click(visibilitySwitch("Beta"));
  await settle(700);
  expect(visibilitySwitch("Beta").getAttribute("aria-checked")).toBe("false");

  await enterReorder();
  const first = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
  fireEvent.click(first);
  press(KEY.DOWN);
  fireEvent.click(first);
  await settle(700);
  press(KEY.BACK);
  await settle(0);
  expect(channelNames()).toEqual(["Beta", "Alpha"]);
  expect(visibilitySwitch("Beta").closest(".lineup-row")?.classList.contains("hidden")).toBe(
    true,
  );

  press(KEY.BACK);
  await settle(0);
  await openCategory("Sport");
  expect(channelNames()).toEqual(["Gamma"]);
  expect(visibilityRows()).toHaveLength(1);

  press(KEY.BACK);
  await settle(0);
  await openCategory("News");
  expect(channelNames()).toEqual(["Beta", "Alpha"]);
  expect(orderValueLabel()).toBe("Custom Order");
  expect(visibilitySwitch("Beta").getAttribute("aria-checked")).toBe("false");
  expect(visibilitySwitch("Alpha").getAttribute("aria-checked")).toBe("true");

  const { useLineup } = await import("../src/stores/lineup");
  expect(
    useLineup.getState().provider.categories.map((category) => ({
      name: category.name,
      channels: category.channels.map((channel) => channel.name),
    })),
  ).toEqual([
    { name: "News", channels: ["Alpha", "Beta"] },
    { name: "Sport", channels: ["Gamma"] },
  ]);
});

test("a failed playlist removal toasts once and keeps the confirmation open", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
    useSettings.setState({ removePlaylist: async () => false });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  await openPlaylistMenu("Second");
  await chooseMenuItem("remove");
  await settle(0);
  const dialog = document.querySelector<HTMLElement>(".dialog")!;
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await settle(0);

  const toast = document.querySelector<HTMLElement>(".toast-host .toast");
  expect(toast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(toast?.textContent).toContain("Second");
  expect(toast?.textContent).toContain("could not be saved");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(document.querySelector(".settings-status")?.textContent ?? "").not.toContain(
    "could not be saved",
  );
  expect(document.querySelector(".sheet-body [role='alert']")).toBeNull();
  expect(useSettings.getState().playlists.some((item) => item.name === "Second")).toBe(true);
});

test("a failed visibility write restores the switch silently and later writes still land", async () => {
  let armed = false;
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!armed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  await openContent(true);
  await settle(0);

  armed = true;
  const mark = writes.length;
  const alpha = () => visibilitySwitch("Alpha");
  const alphaRow = () => alpha().closest<HTMLElement>(".lineup-row")!;
  fireEvent.click(alpha());
  await settle(700);

  // The switch answered before the disk did: it flips at once, stays enabled
  // and keeps the focus it already had, with no notice and no retry view.
  expect(writes.length).toBe(mark + 1);
  expect(alpha().getAttribute("aria-checked")).toBe("false");
  expect(alphaRow().classList.contains("hidden")).toBe(true);
  expect(alpha().hasAttribute("disabled")).toBe(false);
  expect(alpha().hasAttribute("aria-disabled")).toBe(false);
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();

  await act(async () => {
    gates[0]!.reject(new Error("quota"));
  });
  await settle(700);

  // Durable rollback restores the switch with no toast, no persistence alert
  // and no spinner anywhere in the manager.
  expect(alpha().getAttribute("aria-checked")).toBe("true");
  expect(alphaRow().classList.contains("hidden")).toBe(false);
  expect(document.querySelector(".toast-host .toast")).toBeNull();
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();

  // The next press enqueues a fresh write and resolves without any retry step.
  fireEvent.click(alpha());
  await settle(700);
  expect(writes.length).toBe(mark + 2);
  expect(alpha().getAttribute("aria-checked")).toBe("false");
  await act(async () => {
    gates[1]!.resolve();
  });
  await settle(700);
  expect(alpha().getAttribute("aria-checked")).toBe("false");
  expect(alphaRow().classList.contains("hidden")).toBe(true);
});

test.each([
  { name: "categories", openChannels: false, first: "News", second: "Sport" },
  { name: "channels", openChannels: true, first: "Alpha", second: "Beta" },
])(
  "visibility presses queue in order and a later failure restores the durable state ($name)",
  async ({ openChannels, first, second }) => {
    let armed = false;
    const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
    const writes: unknown[] = [];
    await mountApp(REORDER_PLAYLIST, {
      personalWrite: (_id: string, value: unknown) => {
        writes.push(value);
        if (!armed) return Promise.resolve();
        return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
      },
    });
    await openContent(openChannels);
    await settle(0);

    const row = (name: string) => visibilitySwitch(name);
    armed = true;
    const mark = writes.length;

    // Hide the first row: this write is the known durable target.
    fireEvent.click(row(first));
    await settle(700);
    expect(writes.length).toBe(mark + 1);
    expect(gates).toHaveLength(1);
    expect(row(first).getAttribute("aria-checked")).toBe("false");
    expect(row(second).getAttribute("aria-checked")).toBe("true");

    // While that write is in flight the list keeps answering: the second row
    // hides and the first flips twice inside one batch, two real inversions
    // that leave it hidden.
    fireEvent.click(row(second));
    act(() => {
      fireEvent.click(row(first));
      fireEvent.click(row(first));
    });
    await settle(0);
    expect(row(first).getAttribute("aria-checked")).toBe("false");
    expect(row(second).getAttribute("aria-checked")).toBe("false");
    for (const name of [first, second]) {
      expect(row(name).hasAttribute("disabled")).toBe(false);
      expect(row(name).hasAttribute("aria-disabled")).toBe(false);
    }
    expect(document.querySelector(".lineup-recovery")).toBeNull();
    expect(document.querySelector(".toast-host .toast")).toBeNull();

    // Serialization keeps one disk write in flight.
    await settle(700);
    expect(writes.length).toBe(mark + 1);
    expect(gates).toHaveLength(1);

    await act(async () => {
      gates[0]!.resolve();
    });
    await settle(700);
    expect(writes.length).toBe(mark + 2);
    expect(gates).toHaveLength(2);
    expect(row(first).getAttribute("aria-checked")).toBe("false");
    expect(row(second).getAttribute("aria-checked")).toBe("false");

    // Rejecting the queued write restores the first snapshot exactly: first
    // hidden, second visible, with no notice and no retry view.
    await act(async () => {
      gates[1]!.reject(new Error("quota"));
    });
    await settle(700);
    expect(row(first).getAttribute("aria-checked")).toBe("false");
    expect(row(second).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".toast-host .toast")).toBeNull();
    expect(document.querySelector(".lineup-recovery")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
    expect(document.querySelector(".lineup-manager [role='alert']")).toBeNull();
    expect(document.querySelector(".lineup-manager .spinner")).toBeNull();

    // A fresh press still saves: the queue recovered without any retry step.
    fireEvent.click(row(second));
    await settle(700);
    expect(gates).toHaveLength(3);
    expect(row(second).getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      gates[2]!.resolve();
    });
    await settle(700);
    expect(row(second).getAttribute("aria-checked")).toBe("false");
  },
);

test("a busy playlist row keeps its menu trigger focused and its menu actions unavailable until refresh settles", async () => {
  let finishRefresh!: (response: unknown) => void;
  let holdRefresh = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (holdRefresh && String(input).includes("second.invalid")) {
        return new Promise((resolve) => {
          finishRefresh = resolve;
        });
      }
      return { ok: true, text: async () => PLAYLIST };
    },
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  fireEvent.change(screen.getByLabelText("Playlist name"), { target: { value: "Second" } });
  fireEvent.change(screen.getByLabelText("Playlist address"), {
    target: { value: "http://second.invalid/list.m3u" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect(document.querySelector(".toast-host [role='status']")?.textContent).toBe(
    "Second saved.",
  );

  const { useSettings } = await import("../src/stores/settings");
  const row = [...document.querySelectorAll<HTMLElement>(".pl")].find((item) =>
    item.textContent?.includes("Second"),
  )!;
  const trigger = screen.getByRole("button", { name: "Actions, Second" });

  holdRefresh = true;
  await refreshPlaylistFromMenu("Second");
  await settle(0);
  expect(row.getAttribute("aria-busy")).toBe("true");
  expect(row.querySelector("[data-playlist-refresh]")).toBeNull();
  expect(row.textContent).not.toContain("Refreshing");
  expect(document.activeElement).toBe(trigger);
  expect(settingsGuideLabel(trigger, (key) => translate("en", key))).toBe("Actions");

  const activate = quickPlaylistAction("activate", "Second");
  expect(activate.getAttribute("aria-disabled")).toBe("true");
  expect(activate.disabled).toBe(false);
  const activeActivate = quickPlaylistAction("activate", "Test");
  expect(activeActivate.getAttribute("aria-pressed")).toBe("true");
  expect(activeActivate.disabled).toBe(false);

  const hash = window.location.hash;
  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(activate);
  await settle(0);
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);

  fireEvent.click(activeActivate);
  await settle(0);
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);

  await openPlaylistMenu("Second");
  for (const id of ["activate", "refresh", "edit", "reset", "remove"]) {
    expect(menuItem(id)!.getAttribute("aria-disabled")).toBe("true");
  }
  fireEvent.click(menuItem("refresh")!);
  fireEvent.click(menuItem("edit")!);
  fireEvent.click(menuItem("reset")!);
  fireEvent.click(menuItem("remove")!);
  await settle(0);
  expect(openActionMenu()).toBeTruthy();
  expect(document.querySelectorAll(".dialog")).toHaveLength(1);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(window.location.hash).toBe(hash);
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");

  press(KEY.ESC);
  await settle(0);
  expect(openActionMenu()).toBeNull();
  expect(document.activeElement).toBe(trigger);

  await act(async () => finishRefresh({ ok: true, text: async () => PLAYLIST }));
  await settle(700);
  expect(row.getAttribute("aria-busy")).toBeNull();
  expect(trigger.disabled).toBe(false);
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");
  expect(document.activeElement).toBe(trigger);

  holdRefresh = false;
  await refreshPlaylistFromMenu("Second");
  await settle(700);
  expect(document.activeElement).toBe(trigger);
  expect(settingsGuideLabel(trigger, (key) => translate("en", key))).toBe("Actions");

  await openPlaylistMenu("Second");
  for (const id of ["activate", "refresh", "edit", "reset", "remove"]) {
    expect(menuItem(id)!.getAttribute("aria-disabled")).toBeNull();
  }
  const secondRefreshCalls = () =>
    vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes("second.invalid"))
      .length;
  const callsBeforeMenuRefresh = secondRefreshCalls();
  fireEvent.click(menuItem("refresh")!);
  await settle(700);
  expect(secondRefreshCalls()).toBe(callsBeforeMenuRefresh + 1);
  await openPlaylistMenu("Second");
  fireEvent.click(menuItem("edit")!);
  await settle(0);
  expect(screen.getByRole("heading", { level: 2, name: "Edit playlist address" })).toBeTruthy();
});

function mockBodyRects() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    const controls = [
      ...document.querySelectorAll<HTMLElement>(".sheet-body button, .sheet-body input"),
    ];
    const top = Math.max(0, controls.indexOf(this)) * 50;
    return {
      top,
      bottom: top + 40,
      left: 0,
      right: 200,
      width: 200,
      height: 40,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

test("playlist menu arrows move between the explicit actions", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  mockBodyRects();

  await openPlaylistMenu();
  const action = () => (document.activeElement as HTMLElement | null)?.dataset?.settingsAction;
  expect(action()).toBe("refresh");
  press(KEY.DOWN);
  expect(action()).toBe("edit");
  press(KEY.DOWN);
  expect(action()).toBe("reset");
  press(KEY.DOWN);
  expect(action()).toBe("remove");
  press(KEY.UP);
  expect(action()).toBe("reset");
  press(KEY.UP);
  expect(action()).toBe("edit");
});

test("playlist menu arrows keep their order in right to left", async () => {
  await mountApp(PLAYLIST, { locale: "ar" });
  press(KEY.YELLOW);
  const rail = [...document.querySelectorAll<HTMLElement>(".sheet-rail .row")];
  fireEvent.click(rail[2]);
  await settle(0);
  fireEvent.click(
    document.querySelector<HTMLElement>('[data-settings-focus="manage-playlists"]')!,
  );
  await settle(0);
  mockBodyRects();

  await openPlaylistMenu();
  const action = () => (document.activeElement as HTMLElement | null)?.dataset?.settingsAction;
  expect(action()).toBe("refresh");
  press(KEY.DOWN);
  expect(action()).toBe("edit");
  press(KEY.DOWN);
  expect(action()).toBe("reset");
  press(KEY.DOWN);
  expect(action()).toBe("remove");
  press(KEY.UP);
  expect(action()).toBe("reset");
});

test("browse rows open eligible bodies while labelled actions target the right record", async () => {
  await mountApp(OPAQUE_LINEUP);
  await openContent();
  const categoryRow = document.querySelector<HTMLElement>(
    ".lineup-manager-list .lineup-row-open",
  )!;
  expect(categoryRow.tagName).toBe("BUTTON");
  expect(categoryRow.getAttribute("aria-label")).toBe("Open, News");
  expect(categoryRow.getAttribute("data-ok-guide")).toBe("Open");
  expect(categoryRow.querySelector("[data-lineup-row-menu]")).toBeNull();
  const categoryMain = categoryRow.querySelector<HTMLElement>(".category-manager-main")!;
  expect(categoryMain.tagName).toBe("SPAN");
  expect(categoryMain.textContent).toContain("News");
  expect(categoryMain.hasAttribute("data-settings-focus")).toBe(false);

  const hash = window.location.hash;
  fireEvent.click(categoryMain);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  expect(window.location.hash).toBe(hash);

  const restoredRow = document.querySelector<HTMLElement>(
    ".lineup-manager-list .lineup-row-open",
  )!;
  expect(document.activeElement).toBe(restoredRow);
  expect(restoredRow.querySelector("[data-lineup-row-menu]")).toBeNull();
  expect(openActionMenu()).toBeNull();
  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(window.location.hash).toBe(hash);

  await openCategory("News");
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();

  const channelRow = [
    ...document.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row"),
  ].find((row) => row.textContent?.includes("Alpha"))!;
  expect(channelRow.tagName).toBe("DIV");
  const channelMain = channelRow.querySelector<HTMLElement>(
    ".lineup-channel-info .category-manager-main",
  )!;
  expect(channelMain.tagName).toBe("SPAN");
  expect(channelMain.textContent).toContain("Alpha");
  expect(channelRow.querySelector(".lineup-row-open")).toBeNull();
  expect(channelRow.querySelector("[data-lineup-edit]")).toBeTruthy();
  expect(channelRow.querySelector("[data-lineup-visibility]")).toBeTruthy();
  const providerId = channelRow.getAttribute("data-lineup-provider-id")!;
  expect(providerId).toBeTruthy();
  expect(providerId).not.toContain("Alpha");
  const callsBefore = vi.mocked(fetch).mock.calls.length;
  const hashBefore = window.location.hash;
  fireEvent.click(channelMain);
  await settle(0);
  expect(openActionMenu()).toBeNull();
  expect(document.querySelector(".lineup-edit-form")).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
  expect(window.location.hash).toBe(hashBefore);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();

  (channelRow.querySelector(".lineup-channel-info") as HTMLButtonElement).focus();
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();

  await openRenameRow('Alpha "Beta" اليوم');
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeTruthy();
  expect(
    document.querySelector(".lineup-edit-form .lineup-edit-provider")?.textContent,
  ).toContain('Alpha "Beta" اليوم');
  const { useLineup } = await import("../src/stores/lineup");
  expect(
    useLineup.getState().managedChannels.find((item) => item.effective.id === "opaque-ch-9f2"),
  ).toBeTruthy();
});

test("All channels management is gone and categories still open their channels", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  expect(document.querySelector(".lineup-all-channels-row")).toBeNull();
  expect(document.querySelector('[data-lineup-action="more"]')).toBeNull();

  const categoryPreferences = [
    ...document.querySelectorAll<HTMLElement>("[data-lineup-preference]"),
  ].map((button) => button.dataset.lineupPreference);
  expect(categoryPreferences).toEqual(["order"]);

  const openButton = document.querySelector<HTMLElement>(
    ".lineup-manager-list .lineup-row-open",
  )!;
  fireEvent.click(openButton.querySelector(".category-manager-main")!);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
  expect(document.querySelector(".settings-detail-appbar")).toBeNull();
  expect(screen.getByRole("heading", { level: 3, name: "News" })).toBeTruthy();
  expect(document.querySelector(".lineup-category-context")).toBeNull();
  expect(document.querySelectorAll(".lineup-manager-list .lineup-row")).toHaveLength(2);

  const channelPreferences = [
    ...document.querySelectorAll<HTMLElement>("[data-lineup-preference]"),
  ].map((button) => button.dataset.lineupPreference);
  expect(channelPreferences).toEqual(["order"]);
  expect(
    document
      .querySelector('[data-lineup-preference="order"] .lineup-preference-label')
      ?.textContent?.trim(),
  ).toBe("Channel order");
});

test("the visibility eye keeps focus on its row and Back climbs the normal hierarchy", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(true);
  await settle(0);

  expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-mode")).toBe(
    "browse",
  );
  const alpha = visibilitySwitch("Alpha");
  expect(alpha.getAttribute("role")).toBe("switch");
  expect(alpha.getAttribute("aria-checked")).toBe("true");

  alpha.focus();
  fireEvent.click(alpha);
  await settle(700);

  const alphaRow = alpha.closest<HTMLElement>(".lineup-row")!;
  expect(alpha.getAttribute("aria-checked")).toBe("false");
  expect(alphaRow.classList.contains("hidden")).toBe(true);
  expect(alphaRow.textContent).toContain("Hidden");
  expect(document.activeElement).toBe(alpha);
  expect(visibilityRows()).toContain(alpha);

  press(KEY.BACK);
  await settle(0);
  expect((document.activeElement as HTMLElement | null)?.dataset?.settingsFocus).toMatch(
    /^lineup-open-/,
  );
});

test("bulk hiding marks every category until Show all restores them", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await chooseBulkHide();

  const hiddenRows = visibilityRows();
  expect(hiddenRows.length).toBeGreaterThan(0);
  expect(hiddenRows.every((row) => row.getAttribute("aria-checked") === "false")).toBe(true);

  const categoryRows = [
    ...document.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row"),
  ];
  expect(categoryRows.length).toBeGreaterThan(0);
  expect(categoryRows.every((row) => row.classList.contains("hidden"))).toBe(true);
  expect(categoryRows[0].textContent).toContain("Hidden");

  await chooseBulkShow();
  expect(visibilityRows().every((row) => row.getAttribute("aria-checked") === "true")).toBe(
    true,
  );
  expect(document.querySelector(".lineup-manager-list .lineup-row.hidden")).toBeNull();
});

test("content for an inactive playlist manages it without activating", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.setState({ activePlaylistId: "ghost" });
  });
  await settle(0);

  fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
  await settle(1200);
  expect(screen.queryByText("Make this playlist active to manage its content.")).toBeNull();
  expect(document.querySelector(".lineup-manager-list .lineup-row-open")).toBeTruthy();
  expect(document.querySelector(".lineup-sort-row")).toBeNull();
  expect(useSettings.getState().activePlaylistId).toBe("ghost");
});

test("removing the managed playlist closes the whole scoped detail stack", async () => {
  await mountApp(CATEGORIES);
  await openContent(true);
  await openRenameRow("Alpha");
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeTruthy();

  const { useSettings } = await import("../src/stores/settings");
  const replacement = { ...useSettings.getState().playlists[0], id: "replacement" };
  act(() => {
    useSettings.setState({ activePlaylistId: replacement.id, playlists: [replacement] });
  });
  await settle(0);

  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(document.querySelector(".settings-detail-appbar")).toBeNull();
  expect(document.querySelector(".lineup-manager-list .lineup-row-open")).toBeNull();
  expect(document.querySelector(".pl")).toBeTruthy();
});

test("a save interrupted by lost ownership cannot keep writing", async () => {
  const writes: unknown[] = [];
  const gates: Array<() => void> = [];
  let hold = false;
  await mountApp(CATEGORIES, {
    personalWrite: (_playlistId, value) => {
      writes.push(value);
      if (!hold) return Promise.resolve();
      return new Promise<void>((resolve) => gates.push(resolve));
    },
  });
  await openContent(true);
  await openRenameRow("Alpha");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Retained" } });
  await settle(2500);

  const mark = writes.length;
  hold = true;
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1500);
  expect(writes.length).toBeGreaterThan(mark);
  const inFlight = writes.length;

  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.setState({ activePlaylistId: "ghost" });
  });
  await settle(0);
  hold = false;
  for (const release of gates.splice(0)) release();
  await settle(2500);

  expect(writes.length).toBe(inFlight);
});

test("Return blurs a focused lineup input before it closes the editor", async () => {
  await mountApp(CATEGORIES);
  await openContent(true);
  await openRenameRow("Alpha");
  await settle(0);
  const name = document.querySelector<HTMLInputElement>("#lineup-name")!;
  expect(document.activeElement).toBe(name);

  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).not.toBe(name);
  expect(document.querySelector(".lineup-edit-form")).toBeTruthy();

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
});

test("Return inside the lineup search field blurs first, then closes the inline search", async () => {
  await mountApp(CATEGORIES);
  await openContent();
  const toggle = screen.getByRole("button", { name: "Search categories" });
  expect(toggle.textContent).toContain("Search");
  fireEvent.click(toggle);
  await settle(0);
  const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  expect(input.getAttribute("aria-label")).toBe("Search categories");
  expect(document.activeElement).toBe(input);

  fireEvent.change(input, { target: { value: "alp" } });
  await settle(200);
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-search-input")).toBeTruthy();
  expect(document.activeElement).not.toBe(input);
  expect(document.activeElement).toBe(toggle);

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-search-input")).toBeNull();
  expect(document.querySelector(".settings-detail-appbar")).toBeNull();
  expect(screen.getByRole("heading", { level: 3, name: "Test" })).toBeTruthy();
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  expect(document.activeElement).toBe(toggle);

  fireEvent.click(toggle);
  await settle(0);
  expect(document.querySelector<HTMLInputElement>(".lineup-search-input")!.value).toBe("");
});

test("a search with no matches keeps the scoped settings available", async () => {
  await mountApp(CATEGORIES);
  await openContent(true);
  fireEvent.click(screen.getByRole("button", { name: "Search channels" }));
  await settle(0);
  const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  fireEvent.change(input, { target: { value: "zzz-no-match" } });
  await settle(250);
  expect(document.querySelectorAll(".lineup-manager-list .lineup-row")).toHaveLength(0);
  expect(document.querySelector('[data-lineup-preference="order"]')).toBeTruthy();
  expect(document.querySelector("[data-lineup-edit]")).toBeNull();
  expect(document.querySelector("[data-lineup-visibility]")).toBeNull();
});

test("suspended settings cannot move or place a held reorder item", async () => {
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_playlistId, value) => {
      writes.push(value);
      return Promise.resolve();
    },
  });
  await openContent(true);
  await enterReorder();
  await settle(0);
  const grabbed = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
  fireEvent.click(grabbed);
  await settle(0);
  expect(grabbed.getAttribute("aria-pressed")).toBe("true");
  const order = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const held = order();
  const writeMark = writes.length;

  const appNav = document.querySelector<HTMLElement>('[data-navigation-action="settings"]')!;
  appNav.focus();
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(true);
  expect(document.activeElement).toBe(appNav);

  press(KEY.DOWN);
  await settle(0);

  expect(order()).toEqual(held);
  expect(grabbed.getAttribute("aria-pressed")).toBe("true");
  press(KEY.ENTER);
  await settle(0);
  expect(writes.length).toBe(writeMark);
});

test("a grabbed sort row updates its OK action without another focus event", async () => {
  await mountApp(`#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8`);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const row = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
  expect(document.activeElement).toBe(row);
  const okLabel = () => settingsGuideLabel(row, (key) => translate("en", key)) ?? "";
  expect(okLabel()).toContain("Move");

  fireEvent.click(row);
  await settle(0);
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(okLabel()).toContain("Place here");

  fireEvent.click(row);
  await settle(0);
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("aria-pressed")).toBe("false");
  expect(okLabel()).toContain("Move");
});

const THREE_CHANNELS = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="News",Beta
http://example.invalid/b.m3u8
#EXTINF:-1 tvg-id="c" group-title="News",Gamma
http://example.invalid/c.m3u8`;

const TWENTY_ONE_CHANNELS = `#EXTM3U\n${Array.from(
  { length: 21 },
  (_, index) =>
    `#EXTINF:-1 tvg-id="${index}" group-title="News",Channel ${index + 1}\nhttp://example.invalid/${index}.m3u8`,
).join("\n")}`;

function mockSortRects(rows: HTMLElement[]) {
  const list = rows[0]?.parentElement?.parentElement;
  if (list) {
    list.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 10000,
        left: 0,
        right: 400,
        width: 400,
        height: 10000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
  rows.forEach((row, index) => {
    const top = index * 60;
    row.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 60,
        left: 0,
        right: 400,
        width: 400,
        height: 60,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;
    const slot = row.parentElement!;
    const slotIndex = () =>
      Array.prototype.indexOf.call(slot.parentElement?.children ?? [], slot);
    Object.defineProperty(slot, "offsetTop", {
      configurable: true,
      get: () => slotIndex() * 60,
    });
    Object.defineProperty(slot, "offsetHeight", {
      configurable: true,
      get: () => 60,
    });
  });
}

/* The reorder motion reads offsetTop/offsetHeight off the .lineup-sort-item
   wrappers, which do not exist until Sort mode renders them. Prototype getters
   scoped to that class give every current and future wrapper a live index * 60
   box. Every other element keeps jsdom's zero layout. Returns a restore. */
function mockSortItemGeometry() {
  const topDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get: function (this: HTMLElement) {
      if (this.classList?.contains("lineup-sort-item")) {
        const parent = this.parentElement;
        return parent ? Array.prototype.indexOf.call(parent.children, this) * 60 : 0;
      }
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: function (this: HTMLElement) {
      return this.classList?.contains("lineup-sort-item") ? 60 : 0;
    },
  });
  return () => {
    if (topDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "offsetTop", topDescriptor);
    } else {
      delete (HTMLElement.prototype as { offsetTop?: number }).offsetTop;
    }
    if (heightDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", heightDescriptor);
    } else {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
  };
}

function mockSheetSortViewport() {
  const scroller = document.querySelector<HTMLElement>(".sheet-body")!;
  const list = document.querySelector<HTMLElement>(".lineup-manager-list.sorting")!;
  scroller.scrollTop = 0;
  const rectangles = [
    vi
      .spyOn(scroller, "getBoundingClientRect")
      .mockImplementation(() => layoutRect(0, 100, 500, 240)),
    vi
      .spyOn(list, "getBoundingClientRect")
      .mockImplementation(() => layoutRect(0, 140 - scroller.scrollTop, 400, 1400)),
  ];
  const restoreOffsets = mockSortItemGeometry();
  return {
    scroller,
    restore() {
      for (const rectangle of rectangles) rectangle.mockRestore();
      restoreOffsets();
    },
  };
}

test("held keyboard movement reveals logical slots in the sheet without moving the window", async () => {
  await mountApp(TWENTY_ONE_CHANNELS);
  await openContent(true);
  await enterReorder();
  const viewport = mockSheetSortViewport();
  const windowScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  try {
    const held = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
    act(() => held.focus());
    fireEvent.click(held);
    for (let step = 0; step < 5; step += 1) press(KEY.DOWN);
    expect(viewport.scroller.scrollTop).toBeGreaterThan(0);
    expect(document.activeElement).toBe(held);
    expect(document.querySelector('[aria-pressed="true"].lineup-sort-row')).toBe(held);
    const slot = held.closest<HTMLElement>(".lineup-sort-item")!;
    const top = 140 - viewport.scroller.scrollTop + slot.offsetTop;
    expect(top).toBeGreaterThanOrEqual(132);
    expect(top + slot.offsetHeight).toBeLessThanOrEqual(308);
    const beforeCrossing = viewport.scroller.scrollTop;
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".lineup-pagination button:last-child")!,
    );
    expect(document.activeElement).toBe(held);
    expect(document.querySelector('[aria-pressed="true"].lineup-sort-row')).toBe(held);
    expect(viewport.scroller.scrollTop).toBeLessThan(beforeCrossing);
    expect(viewport.scroller.scrollTop).toBe(0);
    expect(windowScroll).not.toHaveBeenCalled();
  } finally {
    viewport.restore();
  }
});

test.each([false, true])(
  "reorder pages change explicitly while carrying an item, channels=%s",
  async (channels) => {
    await mountApp(channels ? TWENTY_ONE_CHANNELS : TWENTY_TWO_GROUPS);
    await openContent(channels);
    await enterReorder();
    const { useLineup } = await import("../src/stores/lineup");
    const savedIds = () =>
      channels
        ? useLineup
            .getState()
            .categories.find((category) => category.key === "News")!
            .channels.map((channel) => channelRef(channel).id)
        : useLineup
            .getState()
            .managedCategories.filter((category) => category.kind === "live")
            .map((category) => category.key);
    const original = savedIds();
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
    const pager = document.querySelector<HTMLElement>(".lineup-sort-pagination")!;
    const previous = within(pager).getByRole("button", {
      name: "Previous",
    }) as HTMLButtonElement;
    const next = within(pager).getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    expect(
      pager.compareDocumentPosition(document.querySelector(".lineup-manager-list")!) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();

    const viewport = mockSheetSortViewport();
    try {
      const held = rows()[0];
      const id = held.dataset.sortId;
      fireEvent.click(held);
      for (let step = 0; step < 20; step += 1) press(KEY.DOWN);

      expect(rows()).toHaveLength(20);
      expect(rows()[19]).toBe(held);
      expect(document.activeElement).toBe(next);
      expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 1 of 2");
      expect(savedIds()).toEqual(original);
      const bottom = viewport.scroller.scrollTop;
      expect(bottom).toBeGreaterThan(0);
      press(KEY.DOWN);
      expect(document.activeElement).toBe(next);
      press(KEY.UP);
      expect(document.activeElement).toBe(held);
      press(KEY.DOWN);
      expect(document.activeElement).toBe(next);
      expect(viewport.scroller.scrollTop).toBe(bottom);
      expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 1 of 2");

      press(KEY.ENTER);
      await settle(0);
      expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 2 of 2");
      expect(previous.disabled).toBe(false);
      expect(next.disabled).toBe(true);
      expect(rows()[0]).toBe(held);
      expect(document.activeElement).toBe(held);
      expect(viewport.scroller.scrollTop).toBe(0);
      expect(savedIds()).toEqual(original);

      viewport.scroller.scrollTop = 200;
      press(KEY.UP);
      expect(document.activeElement).toBe(held);
      expect(viewport.scroller.scrollTop).toBe(0);
      expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 2 of 2");
      if (!channels) {
        press(KEY.DOWN);
        const first = rows()[0];
        act(() => first.focus({ preventScroll: true }));
        press(KEY.UP);
        expect(document.activeElement).toBe(first);
        press(KEY.DOWN);
        expect(document.activeElement).toBe(held);
      }
      press(KEY.DOWN);
      expect(document.activeElement).toBe(previous);
      press(KEY.ENTER);
      await settle(0);
      expect(rows()[0]).toBe(held);
      expect(viewport.scroller.scrollTop).toBe(0);
      expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 1 of 2");

      fireEvent.click(next);
      await settle(0);
      press(KEY.ENTER);
      await settle(700);
      expect(savedIds()[20]).toBe(id);
      expect(savedIds()).toHaveLength(original.length);
      expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();
    } finally {
      viewport.restore();
    }
  },
);

test("ungrabbed reorder navigation reveals the header and the pager below the list", async () => {
  await mountApp(TWENTY_ONE_CHANNELS);
  await openContent(true);
  await enterReorder();
  const viewport = mockSheetSortViewport();
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
  const windowScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  const pager = document.querySelector<HTMLElement>(".lineup-sort-pagination")!;
  const list = document.querySelector<HTMLElement>(".lineup-manager-list.sorting")!;
  const previousOverflow = viewport.scroller.style.overflowY;
  viewport.scroller.style.overflowY = "auto";
  vi.spyOn(viewport.scroller, "clientHeight", "get").mockReturnValue(240);
  vi.spyOn(viewport.scroller, "scrollHeight", "get").mockReturnValue(1700);
  const pagerBounds = () =>
    layoutRect(0, 140 - viewport.scroller.scrollTop + list.children.length * 60 + 16, 500, 80);
  vi.spyOn(pager, "getBoundingClientRect").mockImplementation(pagerBounds);
  for (const button of pager.querySelectorAll("button")) {
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(pagerBounds);
  }
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  try {
    act(() => rows[5].focus({ preventScroll: true }));
    viewport.scroller.scrollTop = 300;
    press(KEY.UP);
    expect(document.activeElement).toBe(rows[4]);
    const top = 140 - viewport.scroller.scrollTop + rows[4].parentElement!.offsetTop;
    expect(top).toBeGreaterThanOrEqual(132);
    expect(top + rows[4].parentElement!.offsetHeight).toBeLessThanOrEqual(308);

    act(() => rows[1].focus({ preventScroll: true }));
    viewport.scroller.scrollTop = 400;
    press(KEY.UP);
    expect(document.activeElement).toBe(rows[0]);
    expect(viewport.scroller.scrollTop).toBe(0);
    viewport.scroller.scrollTop = 200;
    press(KEY.UP);
    expect(document.activeElement).toBe(document.querySelector("[data-lineup-reset-order]"));
    expect(viewport.scroller.scrollTop).toBe(0);
    press(KEY.DOWN);
    expect(document.activeElement).toBe(rows[0]);
    expect(viewport.scroller.scrollTop).toBe(0);

    act(() => rows[19].focus({ preventScroll: true }));
    viewport.scroller.scrollTop = 900;
    press(KEY.DOWN);
    expect(document.activeElement).toBe(within(pager).getByRole("button", { name: "Next" }));
    expect(pager.getBoundingClientRect().top).toBeGreaterThanOrEqual(116);
    expect(pager.getBoundingClientRect().bottom).toBeLessThanOrEqual(324);
    expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 1 of 2");
    press(KEY.ENTER);
    await settle(0);
    expect(pager.querySelector(":scope > span")?.textContent).toBe("Page 2 of 2");
    expect(viewport.scroller.scrollTop).toBe(0);
    expect(document.activeElement).toBe(document.querySelector(".lineup-sort-row"));

    fireEvent.click(within(pager).getByRole("button", { name: "Previous" }));
    await settle(0);
    const selected = document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")[5];
    act(() => selected.focus({ preventScroll: true }));
    viewport.scroller.scrollTop = 200;
    fireEvent.click(selected);
    expect(document.activeElement).toBe(selected);
    expect(viewport.scroller.scrollTop).toBe(200);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(windowScroll).not.toHaveBeenCalled();
  } finally {
    viewport.scroller.style.overflowY = previousOverflow;
    viewport.restore();
  }
});

test.each([
  "release",
  "pointercancel",
  "lostpointercapture",
  "input loss",
  "owner loss",
  "unmount",
])("a stationary pointer scrolls the sheet and ends safely on %s", async (ending) => {
  const writes: unknown[] = [];
  const view = await mountApp(TWENTY_ONE_CHANNELS, {
    personalWrite: (_id, value) => {
      writes.push(value);
      return Promise.resolve();
    },
  });
  await openContent(true);
  await enterReorder();
  await settle(700);
  const viewport = mockSheetSortViewport();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const cancelFrame = vi.fn((id: number) => frames.delete(id));
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const frame = () =>
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => {
        callback(0);
      });
    });
  const windowScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  try {
    const held = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
    const heldId = held.dataset.sortId;
    const release = vi.fn();
    const capture = vi.fn();
    held.setPointerCapture = capture;
    held.releasePointerCapture = release;
    const mark = writes.length;
    fireEvent.pointerDown(held, { pointerId: 71, clientY: 160 });
    fireEvent.pointerMove(held, { pointerId: 71, clientY: 330 });
    frame();
    expect(viewport.scroller.scrollTop).toBe(16);
    frame();
    expect(viewport.scroller.scrollTop).toBe(32);
    expect(writes).toHaveLength(mark);
    expect(document.querySelector(`[data-sort-id="${heldId}"]`)).toBe(held);
    expect(capture).toHaveBeenCalledWith(71);
    expect(windowScroll).not.toHaveBeenCalled();
    const pendingFrame = nextFrame;

    if (ending === "input loss") {
      fireEvent.pointerEnter(document.querySelector<HTMLElement>(".app-navigation")!);
      await settle(0);
      frame();
    } else if (ending === "owner loss") {
      const { useSettings } = await import("../src/stores/settings");
      act(() => useSettings.setState({ playlists: [], activePlaylistId: "" }));
    } else if (ending === "unmount") view.unmount();
    else if (ending === "release") fireEvent.pointerUp(held, { pointerId: 71, clientY: 330 });
    else if (ending === "pointercancel")
      fireEvent.pointerCancel(held, { pointerId: 71, clientY: 330 });
    else fireEvent.lostPointerCapture(held, { pointerId: 71, clientY: 330 });

    expect(release).toHaveBeenCalledWith(71);
    if (ending !== "input loss") expect(cancelFrame).toHaveBeenCalledWith(pendingFrame);
    const stoppedAt = viewport.scroller.scrollTop;
    frame();
    expect(viewport.scroller.scrollTop).toBe(stoppedAt);
    expect(frames.size).toBe(0);
    await settle(700);
    if (ending === "release") expect(writes.length).toBeGreaterThan(mark);
    else expect(writes).toHaveLength(mark);
  } finally {
    viewport.restore();
  }
});

interface SortAnimationRecord {
  node: HTMLElement;
  keyframes: unknown;
  options: unknown;
  cancel: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
}

/* jsdom has no Web Animations, so the FLIP effect's animate() calls are
   captured with cancel/onfinish handles the test can drive. */
function stubSortAnimations() {
  const animations: SortAnimationRecord[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, keyframes: unknown, options?: unknown) {
      const record: SortAnimationRecord = {
        node: this,
        keyframes,
        options,
        cancel: vi.fn(),
        onfinish: null,
      };
      animations.push(record);
      return record;
    },
  });
  return {
    animations,
    restore() {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, "animate", descriptor);
      } else {
        delete (HTMLElement.prototype as { animate?: unknown }).animate;
      }
    },
  };
}

async function lineupChannelOrder() {
  const { useLineup } = await import("../src/stores/lineup");
  return useLineup
    .getState()
    .categories.find((category) => category.name === "News")
    ?.channels.map((channel) => channel.name);
}

test("settings edits still commit after StrictMode replays effects", async () => {
  await mountApp(CATEGORIES, { strict: true });
  await openContent(true);
  await openRenameRow("Alpha");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Strict Alpha" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(2500);
  const { useLineup } = await import("../src/stores/lineup");
  expect(
    useLineup.getState().managedChannels.find((item) => item.effective.id === "a")?.effective
      .name,
  ).toBe("Strict Alpha");
});

test("a fast pointer release without a move event still places the row once", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);

  fireEvent.pointerDown(rows[0], { pointerId: 3, clientY: 10 });
  fireEvent.pointerUp(rows[0], { pointerId: 3, clientY: 130 });
  fireEvent.click(rows[0], { detail: 1 });
  await settle(700);

  expect(await lineupChannelOrder()).toEqual(["Beta", "Alpha", "Gamma"]);
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");

  fireEvent.click(rows[0], { detail: 1 });
  await settle(0);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
});

test("pointer cancellation releases capture and leaves no stale click suppression", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);
  const release = vi.fn();
  rows[0].releasePointerCapture = release;

  fireEvent.pointerDown(rows[0], { pointerId: 5, clientY: 10 });
  fireEvent.pointerMove(rows[0], { pointerId: 5, clientY: 100 });
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Beta");
  fireEvent.pointerCancel(rows[0], { pointerId: 5, clientY: 100 });
  expect(release).toHaveBeenCalledWith(5);
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Alpha");

  fireEvent.click(rows[0], { detail: 1 });
  await settle(0);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
});

test("Escape during a pointer drag cancels it and releases capture", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);
  const release = vi.fn();
  rows[0].releasePointerCapture = release;

  fireEvent.pointerDown(rows[0], { pointerId: 6, clientY: 10 });
  fireEvent.pointerMove(rows[0], { pointerId: 6, clientY: 100 });
  press(KEY.ESC);
  await settle(0);

  expect(release).toHaveBeenCalledWith(6);
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Alpha");
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
});

test("Back during a pointer drag releases capture, then a second Back exits sorting", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);
  const release = vi.fn();
  rows[0].releasePointerCapture = release;

  fireEvent.pointerDown(rows[0], { pointerId: 11, clientY: 10 });
  fireEvent.pointerMove(rows[0], { pointerId: 11, clientY: 100 });
  const back = document.querySelector<HTMLElement>("[data-settings-edge-back]")!;
  back.focus();
  press(KEY.ENTER);
  await settle(0);

  expect(release).toHaveBeenCalledWith(11);
  expect(document.querySelector(".lineup-sort-row")).toBeTruthy();
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row")).toBeNull();
});

test("a real drag takes over an uncommitted click preview", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);
  const { useLineup } = await import("../src/stores/lineup");
  const revision = useLineup.getState().revision;

  fireEvent.click(rows[0]);
  await settle(0);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");

  fireEvent.pointerDown(rows[2], { pointerId: 8, clientY: 130 });
  fireEvent.pointerMove(rows[2], { pointerId: 8, clientY: 10 });
  await settle(0);

  expect(rows[0].getAttribute("aria-pressed")).toBe("false");
  expect(rows[2].getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(".lineup-sort-row")?.textContent).toContain("Gamma");
  expect(useLineup.getState().revision).toBe(revision);
});

test("a held item places before the destination row that receives it", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];

  press(KEY.ENTER);
  await settle(0);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");

  press(KEY.DOWN);
  await settle(0);

  const gamma = rows[2];
  gamma.focus();
  press(KEY.ENTER);
  await settle(700);

  expect(await lineupChannelOrder()).toEqual(["Beta", "Alpha", "Gamma"]);
});

test("a pending reorder write leaves grab, move, drop and Back available", async () => {
  let holdWrites = false;
  const writeReleases: Array<() => void> = [];
  const writes: unknown[] = [];
  await mountApp(THREE_CHANNELS, {
    personalWrite: (_playlistId, value) => {
      writes.push(value);
      if (!holdWrites) return Promise.resolve();
      return new Promise<void>((resolve) => {
        writeReleases.push(resolve);
      });
    },
  });
  await settle(700);
  const settledWrites = writes.length;
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  mockSortRects(rows);
  const release = vi.fn();
  rows[0].releasePointerCapture = release;
  const order = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );

  fireEvent.pointerDown(rows[0], { pointerId: 4, clientY: 10 });
  fireEvent.pointerMove(rows[0], { pointerId: 4, clientY: 100 });
  await settle(0);
  const held = order();
  expect(held).toEqual([
    rows[1].dataset.sortId,
    rows[0].dataset.sortId,
    rows[2].dataset.sortId,
  ]);

  holdWrites = true;
  fireEvent.click(rows[0], { detail: 0 });
  await settle(600);
  expect(writes.length).toBeGreaterThan(settledWrites);
  const writeCount = writes.length;
  expect(release).toHaveBeenCalledWith(4);

  // The first placement is committed to the preview even though its write is
  // still in flight: the grab is released and another row can be taken at once.
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();
  const again = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  fireEvent.click(again[0]);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeTruthy();
  fireEvent.click(again[2]);
  await settle(0);

  // The second placement lands in the preview immediately, but the writer is
  // serialized: no second disk write can start while the first is in flight.
  expect(order()).toEqual([
    again[1].dataset.sortId,
    again[0].dataset.sortId,
    again[2].dataset.sortId,
  ]);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();
  expect(writes).toHaveLength(writeCount);

  // Back answers while the writes are still queued.
  press(KEY.ESC);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row")).toBeNull();

  await act(async () => {
    writeReleases[0]!();
  });
  await settle(700);
  expect(writeReleases.length).toBeGreaterThan(1);

  await act(async () => {
    writeReleases[1]!();
  });
  await settle(700);
  expect(await lineupChannelOrder()).toEqual(["Alpha", "Beta", "Gamma"]);
});

test("held reorder rows all offer Place here while only the held row is pressed", async () => {
  await mountApp(TWENTY_ONE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  expect(rows).toHaveLength(20);
  const heldId = rows[0].dataset.sortId;

  fireEvent.click(rows[0]);
  await settle(0);

  const all = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  for (const row of all) {
    expect(row.getAttribute("data-ok-guide")).toBe("Place here");
    expect(row.getAttribute("aria-label")).toContain("Place here");
  }
  expect(all.filter((row) => row.getAttribute("aria-pressed") === "true")).toHaveLength(1);
  expect(all.find((row) => row.dataset.sortId === heldId)?.getAttribute("aria-pressed")).toBe(
    "true",
  );

  const next = [
    ...document.querySelectorAll<HTMLButtonElement>(".lineup-pagination button"),
  ].at(-1)!;
  next.focus();
  press(KEY.ENTER);
  await settle(0);

  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  const pinned = [...document.querySelectorAll(".lineup-sort-row")].filter(
    (row) => row.dataset.sortId === heldId,
  );
  expect(pinned).toHaveLength(1);
  expect(pinned[0].getAttribute("aria-pressed")).toBe("true");

  const back = document.querySelector<HTMLElement>("[data-settings-edge-back]")!;
  back.focus();
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row")).toBeNull();
  const { useLineup } = await import("../src/stores/lineup");
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
});

test("keyboard movement follows the held row across a page boundary", async () => {
  await mountApp(TWENTY_ONE_CHANNELS);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const rows = [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  const last = rows[19];
  last.focus();
  press(KEY.ENTER);
  await settle(0);
  expect(last.getAttribute("aria-pressed")).toBe("true");

  const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
  press(KEY.DOWN);
  await settle(0);

  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next" }));
  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  const held = [...document.querySelectorAll(".lineup-sort-row")].filter(
    (row) => row.dataset.sortId === last.dataset.sortId,
  );
  expect(held).toHaveLength(1);
  expect(held[0].getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(held[0]);
  expect(scrollSpy).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>(".sheet-body")!.scrollTop).toBe(0);
});

test("the pager carries a held reorder row to the next page top and drop commits it", async () => {
  const pagedReorder = `#EXTM3U\n${Array.from({ length: 25 }, (_, index) => {
    const id = index + 1;
    return `#EXTINF:-1 tvg-id="r${id}" group-title="News",Channel ${id}\nhttp://example.invalid/r${id}.m3u8`;
  }).join("\n")}`;
  await mountApp(pagedReorder);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const pagerButton = (label: string) =>
    within(document.querySelector<HTMLElement>(".lineup-pagination")!).getByRole("button", {
      name: label,
    });
  const sortRows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

  const held = sortRows()[10];
  expect(held.textContent).toContain("Channel 11");
  held.focus();
  press(KEY.ENTER);
  await settle(0);
  expect(held.getAttribute("aria-pressed")).toBe("true");

  pagerButton("Next").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
  const pageRows = sortRows();
  expect(pageRows).toHaveLength(5);
  expect(pageRows[0].dataset.sortId).toBe(held.dataset.sortId);
  expect(pageRows[0].getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(pageRows[0]);
  expect(scrollSpy).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>(".sheet-body")!.scrollTop).toBe(0);
  expect(pageRows[1].textContent).toContain("Channel 22");

  fireEvent.click(pageRows[0], { detail: 0 });
  await settle(700);
  const committed = await lineupChannelOrder();
  expect(committed.indexOf("Channel 11")).toBe(committed.indexOf("Channel 22") - 1);
});

test("the pager carries a held reorder row to the previous page top and drop commits it", async () => {
  const pagedReorder = `#EXTM3U\n${Array.from({ length: 25 }, (_, index) => {
    const id = index + 1;
    return `#EXTINF:-1 tvg-id="r${id}" group-title="News",Channel ${id}\nhttp://example.invalid/r${id}.m3u8`;
  }).join("\n")}`;
  await mountApp(pagedReorder);
  await openContent(true);
  await enterReorder();
  await settle(0);
  const pagerButton = (label: string) =>
    within(document.querySelector<HTMLElement>(".lineup-pagination")!).getByRole("button", {
      name: label,
    });
  const sortRows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");

  pagerButton("Next").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();

  const held = sortRows().find((row) => row.textContent?.includes("Channel 23"))!;
  expect(held).toBeTruthy();
  held.focus();
  press(KEY.ENTER);
  await settle(0);
  expect(held.getAttribute("aria-pressed")).toBe("true");

  pagerButton("Previous").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  const pageRows = sortRows();
  expect(pageRows).toHaveLength(20);
  expect(pageRows[0].dataset.sortId).toBe(held.dataset.sortId);
  expect(pageRows[0].getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(pageRows[0]);
  expect(scrollSpy).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLElement>(".sheet-body")!.scrollTop).toBe(0);
  expect(pageRows[1].textContent).toContain("Channel 1");

  fireEvent.click(pageRows[0], { detail: 0 });
  await settle(700);
  const committed = await lineupChannelOrder();
  expect(committed[0]).toBe("Channel 23");
  expect(committed[1]).toBe("Channel 1");
});

test("reorder clears an unsettled search and restores it on exit", async () => {
  await mountApp(THREE_CHANNELS);
  await openContent(true);
  const { applyLineupMutation, useLineup } = await import("../src/stores/lineup");
  const state = useLineup.getState();
  const changed = applyLineupMutation(state.revision, {
    type: "item-order.mode",
    categoryKey: "News",
    mode: "custom",
  });
  await settle(700);
  expect((await changed).ok).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Search channels" }));
  await settle(0);
  const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  fireEvent.change(input, { target: { value: "Alp" } });
  await settle(200);
  await enterReorder();
  await settle(0);

  expect(document.querySelector(".lineup-search-input")).toBeNull();
  expect(document.querySelectorAll(".lineup-sort-row")).toHaveLength(3);

  press(KEY.BACK);
  await settle(0);
  await settle(200);
  expect(document.querySelector<HTMLInputElement>(".lineup-search-input")?.value).toBe("Alp");
  const rows = [...document.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row")];
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain("Alpha");
});

test.each([
  {
    scope: "categories",
    channels: false,
    selector: ".lineup-category-name",
    query: "News",
    cleared: "",
    expected: ["Sport", "News"],
  },
  {
    scope: "channels",
    channels: true,
    selector: ".lineup-channel-name",
    query: "Alpha",
    cleared: "   ",
    expected: ["Beta", "Alpha"],
  },
])(
  "clearing a $scope search restores the complete custom order after settling",
  async ({ channels, selector, query, cleared, expected }) => {
    await mountApp(REORDER_PLAYLIST);
    await openContent(channels);
    await enterReorder();
    const first = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
    fireEvent.click(first);
    press(KEY.DOWN);
    fireEvent.click(first);
    await settle(700);
    press(KEY.BACK);
    await settle(0);

    const labels = () =>
      [...document.querySelectorAll(`.lineup-manager-list ${selector}`)].map(
        (node) => node.textContent,
      );
    expect(labels()).toEqual(expected);
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-lineup-action="search"]')!,
    );
    const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
    fireEvent.change(input, { target: { value: query } });
    await settle(149);
    expect(labels()).toEqual(expected);
    await settle(1);
    expect(labels()).toEqual([query]);

    fireEvent.change(input, { target: { value: cleared } });
    await settle(149);
    expect(labels()).toEqual([query]);
    await settle(1);
    expect(labels()).toEqual(expected);
    expect(orderValueLabel()).toBe("Custom Order");
  },
);

test("a suspended settings body cannot open or drive an action menu", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const appNav = document.querySelector<HTMLElement>('[data-navigation-action="settings"]')!;
  appNav.focus();
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);
  expect(openActionMenu()).toBeNull();
  expect(document.activeElement).toBe(appNav);

  press(KEY.ESC);
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(false);

  await openPlaylistMenu();
  expect(openActionMenu()).toBeTruthy();
  expect(document.activeElement).toBe(menuItem("refresh"));
});

test("an open action menu yields to higher navigation and regains focus on resume", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await openPlaylistMenu();
  await settle(0);

  expect(openActionMenu()).toBeTruthy();
  expect(document.activeElement).toBe(menuItem("refresh"));

  const appNav = document.querySelector<HTMLElement>('[data-navigation-action="settings"]')!;
  appNav.focus();
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(true);
  expect(document.activeElement).toBe(appNav);
  expect(openActionMenu()).toBeTruthy();

  fireEvent.click(menuItem("remove")!);
  fireEvent.click(menuItem("reset")!);
  expect(openActionMenu()).toBeTruthy();
  expect(document.activeElement).toBe(appNav);

  press(KEY.ESC);
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(false);
  expect(openActionMenu()).toBeTruthy();
  expect(document.activeElement).toBe(menuItem("refresh"));
});

test("a programmatic row menu still opens while edge Back keeps focus", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const back = document.querySelector<HTMLElement>("[data-settings-edge-back]")!;
  act(() => back.focus());
  await settle(0);
  expect(document.activeElement).toBe(back);
  fireEvent.click(screen.getByRole("button", { name: "Actions, Test" }));
  await settle(0);

  expect(openActionMenu()).toBeTruthy();
  expect(document.activeElement).toBe(menuItem("refresh"));
  press(KEY.ESC);
  await settle(0);
  expect(openActionMenu()).toBeNull();
});

test("a menu mounted while input is suspended stays inert until enabled", () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const menu = (inputEnabled: boolean) => (
    <ActionMenu
      title="Test"
      inputEnabled={inputEnabled}
      onClose={onClose}
      actions={[{ id: "activate", label: "Make active", onSelect }]}
    />
  );
  const view = render(menu(false));

  const popup = openActionMenu();
  expect(popup).toBeTruthy();
  expect(popup!.contains(document.activeElement)).toBe(false);
  expect(document.activeElement).not.toBe(menuItem("activate"));

  const footerClose = popup!.querySelector<HTMLButtonElement>(".action-menu-actions .btn")!;
  expect(footerClose.textContent).toContain("Close");
  fireEvent.click(footerClose);
  fireEvent.click(menuItem("activate")!);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  view.rerender(menu(true));
  expect(document.activeElement).toBe(menuItem("activate"));

  fireEvent.click(menuItem("activate")!);
  expect(onClose).toHaveBeenCalledWith(false);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test("an action menu footer Close is reachable by D-pad and wraps Tab", () => {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  popupGeometry("[data-settings-action-menu]", layoutRect(0, 0, 480, 420), [
    { selector: '[data-settings-action="first"]', rect: layoutRect(0, 100, 400, 64) },
    { selector: '[data-settings-action="second"]', rect: layoutRect(0, 180, 400, 64) },
    { selector: ".action-menu-actions .btn", rect: layoutRect(0, 260, 400, 64) },
  ]);
  render(
    <ActionMenu
      title="Test"
      inputEnabled
      onClose={onClose}
      actions={[
        { id: "first", label: "First", onSelect },
        { id: "second", label: "Second", onSelect },
      ]}
    />,
  );

  const menu = openActionMenu()!;
  expect(menu.querySelector("h2 button")).toBeNull();
  const footer = menu.querySelector<HTMLElement>(".action-menu-actions")!;
  expect(footer.closest('[role="menu"]')).toBeNull();
  const close = footer.querySelector<HTMLButtonElement>(".btn")!;
  expect(close.textContent).toContain("Close");

  const first = menuItem("first")!;
  const second = menuItem("second")!;
  expect(document.activeElement).toBe(first);

  press(KEY.DOWN);
  expect(document.activeElement).toBe(second);
  press(KEY.DOWN);
  expect(document.activeElement).toBe(close);
  press(KEY.DOWN);
  expect(document.activeElement).toBe(close);
  press(KEY.UP);
  expect(document.activeElement).toBe(second);

  // Tab wraps the footer Close back to the first action and Shift+Tab returns.
  close.focus();
  fireEvent.keyDown(close, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(close);

  // Remote Enter and a native click both dismiss through onClose(true).
  press(KEY.ENTER);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenLastCalledWith(true);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenLastCalledWith(true);

  // Choosing an action still hands focus forward through onClose(false).
  fireEvent.click(second);
  expect(onClose).toHaveBeenLastCalledWith(false);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test("initially hidden rows keep their quiet status and stay manageable", async () => {
  await mountApp(CATEGORIES, { hiddenCategories: ["News"] });
  await openContent();

  const categoryRow = [
    ...document.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row-open"),
  ].find((row) => row.textContent?.includes("News"))!;
  expect(categoryRow.closest(".lineup-manager-row")?.classList.contains("hidden")).toBe(true);
  const categoryMain = categoryRow.querySelector<HTMLElement>(".category-manager-main")!;
  const categoryBadge = categoryRow.querySelector<HTMLElement>(".lineup-row-hidden")!;
  expect(categoryBadge.textContent).toBe("Hidden");
  expect(categoryMain.contains(categoryBadge)).toBe(false);
  expect(categoryMain.nextElementSibling).toBe(categoryBadge);
  expect(categoryRow.querySelector(".category-manager-meta")?.textContent ?? "").not.toContain(
    "Hidden",
  );

  fireEvent.click(categoryRow);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
  press(KEY.BACK);
  await settle(0);

  await settle(0);
  const news = visibilitySwitch("News");
  expect(news.getAttribute("aria-checked")).toBe("false");
  expect(visibilityRowText(news)).toContain("Hidden");
  news.focus();
  fireEvent.click(news);
  await settle(700);
  expect(news.getAttribute("aria-checked")).toBe("true");
  const newsRow = news.closest<HTMLElement>(".lineup-row")!;
  expect(visibilityRowText(news)).not.toContain("Hidden");
  expect(newsRow.classList.contains("hidden")).toBe(false);
  expect(newsRow.querySelector(".lineup-row-hidden")).toBeNull();
});

test("a failed active playlist is gated while edit and retry stay reachable", async () => {
  let failSecond = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (failSecond && String(input).includes("second.invalid")) {
        return new Response("boom", { status: 500 });
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  failSecond = true;
  fireEvent.click(quickPlaylistAction("activate", "Second"));
  await settle(1200);

  const rowFor = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
      row.textContent?.includes(name),
    )!;
  const secondOpen = rowFor("Second").querySelector<HTMLButtonElement>(".pl-open")!;
  expect(secondOpen.disabled).toBe(true);
  expect(rowFor("Second").textContent).toContain("Unavailable");
  expect(rowFor("Second").querySelector("[data-playlist-refresh]")).toBeNull();

  const calls = vi.mocked(fetch).mock.calls.length;
  fireEvent.click(secondOpen);
  await settle(0);
  expect(document.querySelector(".lineup-manager")).toBeNull();
  expect(vi.mocked(fetch).mock.calls.length).toBe(calls);

  await openPlaylistMenu("Second");
  expect(menuItem("edit")).toBeTruthy();
  expect(menuItem("reset")).toBeTruthy();
  expect(menuItem("remove")).toBeTruthy();
  expect(menuItem("refresh")!.disabled).toBe(false);
  press(KEY.ESC);
  await settle(0);

  const testOpen = rowFor("Test").querySelector<HTMLButtonElement>(".pl-open")!;
  expect(testOpen.disabled).toBe(false);
  expect(rowFor("Test").textContent).not.toContain("Unavailable");
  await openPlaylistMenu("Test");
  const testActivate = quickPlaylistAction("activate", "Test");
  expect(testActivate.getAttribute("aria-pressed")).toBe("false");
  expect(testActivate.disabled).toBe(false);
  expect(testActivate.getAttribute("aria-disabled")).toBeNull();
  press(KEY.ESC);
  await settle(0);
  fireEvent.click(testOpen);
  await settle(0);
  expect(
    document.querySelector(".lineup-manager .lineup-row-open")?.getAttribute("aria-label"),
  ).toBe("Open, News");
  expect(useSettings.getState().activePlaylist()?.name).toBe("Second");
});

test("a failed refresh on a usable lineup stays open and is marked as saved content", async () => {
  let fail = false;
  await mountApp(PLAYLIST, {
    fetchImplementation: async () => {
      if (fail) throw new TypeError("Failed to fetch");
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  await openContent();
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();

  fail = true;
  await refreshPlaylistFromMenu("Test");
  await settle(700);

  const row = document.querySelector<HTMLElement>(".pl")!;
  expect(row.textContent).toContain("Saved content");
  expect(row.textContent).not.toContain("Unavailable");
  const open = row.querySelector<HTMLButtonElement>(".pl-open")!;
  expect(open.disabled).toBe(false);
  fireEvent.click(open);
  await settle(0);
  expect(document.querySelector(".lineup-manager")).toBeTruthy();
});

test("a deferred refresh owns one persistent progress toast on a later page", async () => {
  let mode: "hold" | "fail" | "ok" = "ok";
  let release: ((response: Response) => void) | undefined;
  await mountApp(PLAYLIST, {
    fetchImplementation: async (input) => {
      if (String(input).includes("slow.invalid")) {
        if (mode === "fail") return new Response("boom", { status: 500 });
        if (mode === "hold") {
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
      }
      return new Response(PLAYLIST, { status: 200 });
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const base = useSettings.getState().playlists[0]!;
  act(() => {
    useSettings.getState().set("playlists", [
      base,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...base,
        id: `pl-filler-${index}`,
        name: `Filler ${index}`,
      })),
      {
        ...base,
        id: "pl-slow",
        name: "Slow",
        source: { kind: "m3u" as const, url: "http://slow.invalid/list.m3u" },
      },
    ]);
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const pagination = document.querySelector<HTMLElement>(".settings-pagination")!;
  fireEvent.click(within(pagination).getByRole("button", { name: "Next" }));
  await settle(0);
  const slowRow = () =>
    [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
      row.textContent?.includes("Slow"),
    )!;
  expect(slowRow()).toBeTruthy();

  mode = "hold";
  await refreshPlaylistFromMenu("Slow");
  await settle(0);

  expect(document.querySelector("[data-playlist-refresh]")).toBeNull();
  expect(slowRow().getAttribute("aria-busy")).toBe("true");
  expect(
    document.querySelector<HTMLElement>(".sheet-body")!.querySelector(".settings-status"),
  ).toBeNull();
  const progress = document.querySelector(".toast-host [data-toast-kind='loading']");
  expect(progress?.textContent).toContain("Slow");
  expect(progress?.querySelector(".spinner")).toBeTruthy();
  await settle(6000);
  expect(document.querySelector(".toast-host [data-toast-kind='loading']")).toBe(progress);

  release!(new Response(PLAYLIST, { status: 200 }));
  await settle(700);
  const successToast = document.querySelector<HTMLElement>(".toast-host .toast")!;
  expect(successToast.parentElement?.getAttribute("role")).toBe("status");
  expect(successToast.textContent).toContain("Refreshed");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(slowRow().getAttribute("aria-busy")).toBeNull();

  mode = "fail";
  await refreshPlaylistFromMenu("Slow");
  await settle(700);
  const failureToast = document.querySelector<HTMLElement>(".toast-host .toast")!;
  expect(failureToast.parentElement?.getAttribute("role")).toBe("alert");
  expect(failureToast.textContent).toContain("Slow");
  expect(document.querySelectorAll(".toast-host .toast")).toHaveLength(1);
  expect(slowRow().textContent).toContain("Unavailable");

  mode = "ok";
  await refreshPlaylistFromMenu("Slow");
  await settle(700);
  const clearedToast = document.querySelector<HTMLElement>(".toast-host .toast")!;
  expect(clearedToast.parentElement?.getAttribute("role")).toBe("status");
  expect(clearedToast.textContent).toContain("Refreshed");
  expect(slowRow().textContent).not.toContain("Unavailable");
  expect(slowRow().querySelector<HTMLButtonElement>(".pl-open")!.disabled).toBe(false);
});

test("the add dialog dismisses on Escape and backdrop and returns focus to its opener", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  const add = screen.getByRole("button", { name: "Add a playlist" });

  add.focus();
  fireEvent.click(add);
  await settle(0);
  const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(dialog.getAttribute("role")).toBe("dialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector(".pl")).toBeTruthy();

  press(KEY.ESC);
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBe(dialog);
  press(KEY.ESC);
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(document.activeElement).toBe(add);

  add.focus();
  fireEvent.click(add);
  await settle(0);
  fireEvent.click(document.querySelector<HTMLElement>(".settings-dialog-scrim")!);
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect(document.activeElement).toBe(add);
});

test("playlist breadcrumbs stay noninteractive through ordering and drilling", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  const crumbs = document.querySelector<HTMLElement>(".settings-breadcrumbs")!;
  expect(crumbs).toBeTruthy();
  expect(crumbs.textContent).toContain("Playlists");
  expect(crumbs.querySelectorAll("a, button, [href], [tabindex]")).toHaveLength(0);

  await enterReorder();
  await settle(0);
  expect(screen.getByRole("heading", { level: 3, name: "Custom Order" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Test" })).toBeNull();
  expect(
    document.querySelectorAll(
      ".settings-breadcrumbs a, .settings-breadcrumbs button, .settings-breadcrumbs [tabindex]",
    ),
  ).toHaveLength(0);

  fireEvent.click(document.querySelector<HTMLElement>("[data-settings-edge-back]")!);
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Categories" })).toBeTruthy();
  expect(
    document.querySelectorAll(
      ".settings-breadcrumbs a, .settings-breadcrumbs button, .settings-breadcrumbs [tabindex]",
    ),
  ).toHaveLength(0);

  await openCategory("News");
  await settle(0);
  expect(screen.getByRole("heading", { level: 4, name: "Channels" })).toBeTruthy();
});

test("a previous playlist reload cannot release a new form's pending validation", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  await openPlaylistMenu();
  fireEvent.click(menuItem("edit")!);
  await settle(0);

  const { useChannels } = await import("../src/stores/channels");
  let finishReload:
    | ((result: { activated: boolean; count: number; error: string }) => void)
    | undefined;
  let finishValidation: ((result: { count: number; error: string }) => void) | undefined;
  const reload = new Promise<{ activated: boolean; count: number; error: string }>(
    (resolve) => {
      finishReload = resolve;
    },
  );
  const validation = new Promise<{ count: number; error: string }>((resolve) => {
    finishValidation = resolve;
  });
  const activate = vi.fn(() => reload);
  const validate = vi
    .fn()
    .mockResolvedValueOnce({ count: 1, error: "" })
    .mockReturnValueOnce(validation);
  act(() => {
    useChannels.setState({ activatePlaylist: activate, validatePlaylist: validate });
  });
  const initialActivations = activate.mock.calls.length;

  fireEvent.change(screen.getByLabelText("Playlist name"), {
    target: { value: "Renamed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(0);
  expect(activate).toHaveBeenCalledTimes(initialActivations + 1);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Add a playlist" }));
  await settle(0);
  const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(dialog.getAttribute("aria-busy")).toBeNull();
  const address = screen.getByLabelText("Playlist address") as HTMLInputElement;
  fireEvent.change(address, { target: { value: "http://fresh.invalid/list.m3u" } });
  const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  fireEvent.click(save);
  await settle(0);
  expect(dialog.getAttribute("aria-busy")).toBe("true");

  await act(async () => {
    finishReload!({ activated: true, count: 1, error: "" });
    await Promise.resolve();
  });
  expect(document.querySelector("[data-settings-dialog]")).toBe(dialog);
  expect(dialog.getAttribute("aria-busy")).toBe("true");
  expect(address.value).toBe("http://fresh.invalid/list.m3u");
  expect(save.disabled).toBe(true);

  await act(async () => {
    finishValidation!({ count: 0, error: "Could not validate the new playlist." });
    await Promise.resolve();
  });
  expect(dialog.getAttribute("aria-busy")).toBeNull();
  expect((await playlistToast()).textContent).toContain("Could not validate the new playlist.");
  expect(address.value).toBe("http://fresh.invalid/list.m3u");
});

const TWENTY_TWO_GROUPS = `#EXTM3U\n${Array.from(
  { length: 22 },
  (_, index) =>
    `#EXTINF:-1 tvg-id="g${index}" group-title="Provider ${String(index + 1).padStart(2, "0")}",Provider ${index + 1}\nhttp://example.invalid/g${index}.m3u8`,
).join("\n")}`;

const TWENTY_TWO_LINEUP = {
  version: 1,
  revision: 1,
  personalisation: {
    categories: Object.fromEntries(
      Array.from({ length: 22 }, (_, index) => [
        `Provider ${String(index + 1).padStart(2, "0")}`,
        { name: `Match ${String(index + 1).padStart(2, "0")}` },
      ]),
    ),
  },
};

test("rename cancel and save on a later page preserve the browse view", async () => {
  await mountApp(TWENTY_TWO_GROUPS, { personalLineup: TWENTY_TWO_LINEUP });
  await openContent();
  const scroller = document.querySelector<HTMLElement>(".sheet-body")!;
  scroller.scrollTop = 120;

  fireEvent.click(document.querySelector<HTMLElement>('[data-lineup-action="search"]')!);
  await settle(0);
  const search = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  expect(search).toBeTruthy();
  fireEvent.change(search, { target: { value: "Match" } });
  await settle(200);

  fireEvent.click(
    within(document.querySelector(".lineup-pagination")!).getByRole("button", {
      name: "Next",
    }),
  );
  await settle(0);
  expect(document.querySelector(".lineup-pagination > span")?.textContent).toBe("Page 2 of 2");

  await openRenameRow("Match 22");
  const editor = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(editor).toBeTruthy();
  fireEvent.change(within(editor).getByLabelText("Custom name"), {
    target: { value: "Other 22" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(document.querySelector(".lineup-pagination > span")?.textContent).toBe("Page 2 of 2");
  expect((document.querySelector(".lineup-search-input") as HTMLInputElement).value).toBe(
    "Match",
  );
  expect(scroller.scrollTop).toBe(120);
  await settle(0);
  expect((document.activeElement as HTMLElement | null)?.dataset.settingsFocus).toBe(
    "lineup-edit-Provider 22",
  );

  await openRenameRow("Match 22");
  const editorAgain = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  fireEvent.change(within(editorAgain).getByLabelText("Custom name"), {
    target: { value: "Other 22" },
  });
  fireEvent.click(within(editorAgain).getByRole("button", { name: "Save" }));
  await settle(2500);
  expect(document.querySelector(".lineup-edit-form")).toBeNull();
  expect(document.querySelector("[data-lineup-edit]")).toBeTruthy();
  expect(document.querySelector(".lineup-pagination > span")?.textContent).toBe("Page 2 of 2");
  expect((document.querySelector(".lineup-search-input") as HTMLInputElement).value).toBe(
    "Match",
  );
  expect(scroller.scrollTop).toBe(120);
  await settle(0);
  // The renamed row no longer matches the "Match" filter, so focus falls back
  // to the manager's own search control rather than a stale pencil.
  expect((document.activeElement as HTMLElement | null)?.dataset.lineupAction).toBe("search");
});

test("channel row bodies open their editor and restore focus on cancel", async () => {
  await mountApp(CATEGORIES);
  await openContent(true);
  const primary = document.querySelector<HTMLButtonElement>(".lineup-channel-info")!;
  expect(primary.tagName).toBe("BUTTON");
  expect(primary.dataset.okGuide).toBe("Edit");
  expect(primary.getAttribute("aria-haspopup")).toBe("dialog");
  const token = primary.dataset.settingsFocus;
  const before = playCalls.length;
  fireEvent.pointerMove(primary);
  fireEvent.click(primary);
  await settle(0);
  const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  expect(dialog).toBeTruthy();
  expect(document.querySelector("#lineup-name")).toBeTruthy();
  expect(playCalls).toHaveLength(before);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();
  expect((document.activeElement as HTMLElement | null)?.dataset.settingsFocus).toBe(token);
  expect(document.querySelectorAll(".lineup-manager-list [data-lineup-edit]")).toHaveLength(1);
});

test("the content tabs share one measured ink marker that follows selection", async () => {
  await mountXtream({ get_series_categories: [], get_series: [] });
  await openContent();
  await settle(0);

  const strip = document.querySelector<HTMLElement>(".category-kind-selector")!;
  expect(strip).toBeTruthy();
  expect(strip.getAttribute("aria-orientation")).toBe("vertical");
  const inks = () => strip.querySelectorAll<HTMLElement>(".category-kind-ink");
  expect(inks()).toHaveLength(1);
  const ink = inks()[0];
  expect(ink.getAttribute("aria-hidden")).toBe("true");

  const tabs = [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.length).toBeGreaterThan(1);
  const labelOf = (tab: HTMLElement) => tab.querySelector<HTMLElement>(".category-kind-label")!;
  for (const tab of tabs) {
    const wrapper = labelOf(tab);
    expect(wrapper.querySelector(".icon")).toBeTruthy();
    const text = wrapper.querySelector("span");
    expect(text).toBeTruthy();
    expect(text!.textContent).toBe(tab.textContent);
    expect(text!.textContent?.trim().length).toBeGreaterThan(0);
  }

  // jsdom has no layout, so give the strip and each tab label a deterministic box.
  const rect = (top: number, height: number, width = 80) =>
    ({
      x: 0,
      y: top,
      top,
      left: 0,
      right: width,
      bottom: top + height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
  const stripBox = rect(30, 40, 400);
  const labelRects = new Map<HTMLElement, { top: number; height: number }>();
  tabs.forEach((tab, index) => {
    labelRects.set(labelOf(tab), {
      top: index === 0 ? 60 : 180,
      height: index === 0 ? 20 : 30,
    });
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this === strip) return stripBox;
    const box = labelRects.get(this);
    return box ? rect(box.top, box.height) : rect(0, 0, 0);
  });

  const second = tabs[1];
  fireEvent.click(second);
  await settle(0);
  expect(second.getAttribute("aria-selected")).toBe("true");
  // Second label sits at top 180 inside a strip starting at 30. The ink
  // insets two pixels and pads four so it frames the icon and the text together.
  expect(ink.style.transform).toBe("translateY(148px)");
  expect(ink.style.height).toBe("34px");
  expect(strip.querySelectorAll(".category-kind-ink")).toHaveLength(1);
  expect(strip.querySelector(".category-kind-ink")).toBe(ink);

  fireEvent.click(tabs[0]);
  await settle(0);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(ink.style.transform).toBe("translateY(28px)");
  expect(ink.style.height).toBe("24px");

  // Live stays selected while the managed category list identity changes: the
  // marker must re-measure and follow the label to a new position at the same
  // height rather than keeping its stale rectangle.
  labelRects.set(labelOf(tabs[0]), { top: 160, height: 20 });
  const { acquireLineup } = await import("../src/stores/lineup");
  const { useSettings } = await import("../src/stores/settings");
  const owned = useSettings.getState().playlists.find((item) => item.id === "pl-1");
  expect(owned).toBeTruthy();
  const lease = await acquireLineup(owned!, "remote");
  act(() => {
    lease.controller.store.setState({
      managedCategories: [...lease.controller.store.getState().managedCategories],
    });
  });
  await act(async () => {
    await lease.release();
  });
  await settle(0);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  expect(ink.style.transform).toBe("translateY(128px)");
  expect(ink.style.height).toBe("24px");
  expect(strip.querySelector(".category-kind-ink")).toBe(ink);
});

test("an inactive playlist edits its own saved owner without activation", async () => {
  const SECOND_PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="x" group-title="Managed",Other Alpha
http://second.invalid/other.m3u8`;
  const writes: Array<[string, unknown]> = [];
  await mountApp(REORDER_PLAYLIST, {
    fetchImplementation: async (input) => {
      const url = String(input);
      return new Response(url.includes("second.invalid") ? SECOND_PLAYLIST : REORDER_PLAYLIST, {
        status: 200,
      });
    },
    personalWrite: async (playlistId: string, value: unknown) => {
      writes.push([playlistId, value]);
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const { useLineup } = await import("../src/stores/lineup");
  const { useLibrary } = await import("../src/stores/library");
  const before = useLineup.getState();
  const revisionBefore = before.revision;
  const channelsBefore = JSON.stringify(before.managedChannels);
  const numbersBefore = before.numberIndex;
  const libraryBefore = useLibrary.getState();
  await act(async () => {
    useSettings.setState({
      playlists: [
        ...useSettings.getState().playlists,
        {
          id: "pl-2",
          name: "Second",
          source: { kind: "m3u", url: "http://second.invalid/second.m3u" },
          sourceVersion: 1,
          hiddenCategories: [],
        },
      ],
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  const second = [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
    row.textContent?.includes("Second"),
  )!;
  expect(second).toBeTruthy();
  fireEvent.click(second.querySelector<HTMLElement>(".pl-open")!);
  await settle(1500);
  expect(document.querySelector(".lineup-manager")).toBeTruthy();
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");
  expect(useLineup.getState().playlistId).toBe("pl-1");

  await openCategory("Managed");
  await openRenameRow("Other Alpha");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Second Alpha" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(2500);
  expect(writes.some(([id]) => id === "pl-2")).toBe(true);
  expect(writes.some(([id]) => id === "pl-1")).toBe(false);
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");
  expect(useLineup.getState().playlistId).toBe("pl-1");
  const after = useLineup.getState();
  expect(after.revision).toBe(revisionBefore);
  expect(JSON.stringify(after.managedChannels)).toBe(channelsBefore);
  expect(after.numberIndex).toEqual(numbersBefore);
  expect(useLibrary.getState().playlistId).toBe(libraryBefore.playlistId);
  expect(useLibrary.getState().categoryItems).toBe(libraryBefore.categoryItems);
});

test("the edge Back is an icon button outside the toolbar on the category and channel lists", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(true);

  for (const scope of ["channels", "categories"]) {
    expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
      scope,
    );
    const backs = document.querySelectorAll<HTMLElement>("[data-settings-edge-back]");
    expect(backs).toHaveLength(1);
    const back = backs[0];
    expect(back.closest(".sheet-edge-back")).toBeTruthy();
    expect(back.getAttribute("aria-label")).toBe("Back");
    expect(back.textContent?.trim()).toBe("");
    expect(back.querySelector("svg")).toBeTruthy();
    expect(document.querySelector("[data-lineup-mode-back]")).toBeNull();
    fireEvent.click(back);
    await settle(0);
  }
  expect(document.querySelector(".lineup-manager")).toBeNull();
  expect(screen.getByRole("heading", { name: "Saved playlists" })).toBeTruthy();
});

test("visibility eyes are single switch targets with a state icon", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(true);
  await settle(0);

  const eyes = visibilityRows();
  expect(eyes.length).toBeGreaterThan(0);
  for (const eye of eyes) {
    expect(eye.getAttribute("role")).toBe("switch");
    expect(eye.querySelectorAll("button, input")).toHaveLength(0);
    expect(eye.querySelector("svg")).toBeTruthy();
  }

  const alpha = visibilitySwitch("Alpha");
  const checkedBefore = alpha.getAttribute("aria-checked");
  const glyphBefore = alpha.querySelector("svg")!.innerHTML;
  alpha.focus();
  fireEvent.click(alpha);
  await settle(700);

  expect(alpha.getAttribute("aria-checked")).toBe(checkedBefore === "true" ? "false" : "true");
  expect(visibilityRows()).toContain(alpha);
  expect(alpha.querySelector("svg")!.innerHTML).not.toBe(glyphBefore);
});

test("the order dialog marks the saved choice with a real check icon", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await openOrderDialog();
  await settle(0);

  const options = [
    ...orderDialog()!.querySelectorAll<HTMLElement>("[data-lineup-order-option]"),
  ];
  const selected = options.filter((option) => option.getAttribute("aria-selected") === "true");
  expect(selected).toHaveLength(1);
  expect(selected[0].querySelector(".lineup-order-check svg")).toBeTruthy();
  for (const option of options.filter((entry) => entry !== selected[0])) {
    expect(option.querySelector(".lineup-order-check")).toBeNull();
  }
});

test("a reorder applies at once and a failed write restores the durable order silently", async () => {
  let armed = false;
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!armed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  const { useLineup } = await import("../src/stores/lineup");
  await openContent(true);
  await enterReorder();
  await settle(0);

  const sortIds = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const original = sortIds();
  expect(original).toHaveLength(2);

  armed = true;
  const mark = writes.length;
  const grabbed = document.querySelector<HTMLButtonElement>("[data-sort-id]")!;
  fireEvent.click(grabbed);
  await settle(0);
  press(KEY.DOWN);
  fireEvent.click(grabbed);
  await settle(0);

  // The placement is accepted immediately: the preview keeps the new order,
  // the grab is released and the write is merely queued behind it.
  const moved = sortIds();
  expect(moved).toHaveLength(2);
  expect(moved).not.toEqual(original);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();

  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();

  await act(async () => {
    gates[0]!.reject(new Error("quota"));
  });
  await settle(700);

  // The durable rollback restores the last saved order with no retry view.
  expect(sortIds()).toEqual(original);
  expect(useLineup.getState().itemOrderModes.News).toBe("custom");
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();
});

test("category placements queue in order and a rollback cancels an active grab", async () => {
  let armed = false;
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!armed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  await openContent();
  await enterReorder();
  await settle(0);

  const sortIds = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const sortRows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  const original = sortIds();
  expect(original).toHaveLength(2);

  armed = true;
  const mark = writes.length;

  // First swap: grab the first category and drop it after the second.
  const first = sortRows()[0];
  first.focus();
  fireEvent.click(first);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  fireEvent.click(first);
  await settle(0);
  const swapped = sortIds();
  expect(swapped).toEqual([original[1], original[0]]);

  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(gates).toHaveLength(1);

  // The swap back is accepted into the preview while the first write is still
  // in flight, but the serialized writer cannot start a second one yet.
  const second = sortRows()[0];
  second.focus();
  fireEvent.click(second);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  expect(sortIds()).toEqual(original);
  fireEvent.click(second);
  await settle(0);
  expect(sortIds()).toEqual(original);
  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(gates).toHaveLength(1);

  await act(async () => {
    gates[0]!.resolve();
  });
  await settle(700);
  expect(writes.length).toBe(mark + 2);
  expect(gates).toHaveLength(2);

  // A fresh grab without a drop is still in progress when the second write
  // fails: the rollback has to cancel it rather than leave a stale preview.
  const held = sortRows()[0];
  held.focus();
  fireEvent.click(held);
  await settle(0);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeTruthy();

  await act(async () => {
    gates[1]!.reject(new Error("quota"));
  });
  await settle(700);

  // Durable state is the first successful swap; the grab is cancelled and no
  // notice or retry view appears.
  expect(sortIds()).toEqual(swapped);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();
  expect(document.querySelector(".lineup-sort-row[aria-pressed='true']")).toBeNull();
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();

  // A fresh placement still saves: recovery needs no retry mechanism.
  const fresh = sortRows()[0];
  fresh.focus();
  fireEvent.click(fresh);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  fireEvent.click(fresh);
  await settle(0);
  await settle(700);
  expect(gates).toHaveLength(3);
  expect(sortIds()).toEqual(original);
  await act(async () => {
    gates[2]!.resolve();
  });
  await settle(700);
  expect(sortIds()).toEqual(original);
});

test("a provider refresh drops a stale reorder preview without a notice", async () => {
  await mountApp(REORDER_PLAYLIST);
  const { acquireLineup } = await import("../src/stores/lineup");
  const { useSettings } = await import("../src/stores/settings");
  await openContent(true);
  await enterReorder();
  await settle(0);

  const sortIds = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const original = sortIds();
  expect(original).toHaveLength(2);

  // Grab Alpha and preview it after Beta, but do not drop it yet.
  const grabbed = document.querySelector<HTMLButtonElement>("[data-sort-id]")!;
  grabbed.focus();
  fireEvent.click(grabbed);
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  expect(sortIds()).toEqual([original[1], original[0]]);

  // Refresh the provider without Beta: the held placement's anchor is gone.
  const owned = useSettings.getState().playlists.find((item) => item.id === "pl-1")!;
  const lease = await acquireLineup(owned, "remote");
  const provider = lease.controller.store.getState().provider;
  const beta = provider.channels.find((channel) => channel.name === "Beta")!;
  const withoutBeta = <T extends { id: string }>(channels: readonly T[]) =>
    channels.filter((channel) => channel.id !== beta.id);
  const nextProvider = {
    ...provider,
    channels: withoutBeta(provider.channels),
    categories: provider.categories.map((category) => {
      const channels = withoutBeta(category.channels);
      return {
        ...category,
        channels,
        ...(category.count === undefined ? {} : { count: channels.length }),
      };
    }),
  };
  await act(async () => {
    await lease.controller.refreshCatalogue(owned, nextProvider);
  });
  await settle(0);

  // Dropping the held row now finds no anchor: the placement is unavailable,
  // the grab clears and the preview falls back to the canonical rows.
  fireEvent.click(grabbed);
  await settle(700);
  expect(sortIds()).toEqual([original[0]]);
  expect(document.querySelectorAll(".lineup-sort-row")).toHaveLength(1);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();
  expect((await lineupChannelOrder()) ?? []).toEqual(["Alpha"]);

  await act(async () => {
    await lease.release();
  });
});

test("channel number badges share one width across the managed list", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent(true);
  await openRenameRow("Alpha");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Number"), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);

  const manager = document.querySelector<HTMLElement>(".lineup-manager")!;
  expect(manager.style.getPropertyValue("--lineup-number-width")).toBe("3ch");

  const badges = [...manager.querySelectorAll<HTMLElement>(".lineup-channel-number")];
  expect(badges).toHaveLength(2);
  for (const badge of badges) {
    expect(badge.getAttribute("role")).toBe("img");
    expect(badge.getAttribute("aria-label")).toContain(badge.textContent!);
    const label = badge.closest(".lineup-channel-label")!;
    expect(label.querySelector(".lineup-channel-name")).toBeTruthy();
    expect(badge.nextElementSibling?.classList.contains("lineup-channel-name")).toBe(true);
  }
  expect(badges.map((badge) => badge.textContent)).toEqual(["120", "2"]);

  await enterReorder();
  await settle(0);
  const grabbed = document.querySelector<HTMLButtonElement>("[data-sort-id]")!;
  fireEvent.click(grabbed);
  await settle(0);
  press(KEY.DOWN);
  fireEvent.click(grabbed);
  await settle(700);
  press(KEY.BACK);
  await settle(0);
  const sorted = [...document.querySelectorAll<HTMLElement>(".lineup-channel-number")];
  expect(sorted).toHaveLength(2);
  expect(sorted.map((badge) => badge.textContent)).toEqual(["2", "120"]);
});

test.each([
  { name: "LTR", locale: undefined, towardRail: KEY.LEFT },
  { name: "RTL", locale: "ar" as const, towardRail: KEY.RIGHT },
])(
  "edge Back stays usable while a same-owner write is in flight ($name)",
  async ({ locale, towardRail }) => {
    let armed = false;
    let resolveWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      resolveWrite = resolve;
    });
    const writes: unknown[] = [];
    await mountApp(CATEGORIES, {
      ...(locale ? { locale } : {}),
      personalWrite: (_id: string, value: unknown) => {
        writes.push(value);
        return armed ? pendingWrite : Promise.resolve();
      },
    });
    await openContent();
    await settle(0);

    const backs = () => document.querySelectorAll<HTMLElement>("[data-settings-edge-back]");
    expect(backs()).toHaveLength(1);
    const back = backs()[0];

    const rows = visibilityRows();
    expect(rows.length).toBeGreaterThan(1);
    const remembered = rows[1];
    remembered.focus();
    press(towardRail);
    await settle(0);
    expect(document.activeElement).toBe(back);

    armed = true;
    const mark = writes.length;
    fireEvent.click(rows[0]);
    await settle(700);
    expect(writes.length).toBe(mark + 1);
    // The write is still in flight, yet the rail back button is not blocked.
    expect(back.getAttribute("aria-disabled")).not.toBe("true");
    expect(back.hasAttribute("disabled")).toBe(false);
    back.focus();
    await settle(0);
    expect(document.activeElement).toBe(back);

    press(KEY.ENTER);
    await settle(0);
    expect(
      screen.getByRole("heading", {
        name: translate((locale ?? "en") as Locale, "playlist.savedPlaylists"),
      }),
    ).toBeTruthy();

    await act(async () => {
      resolveWrite();
    });
    await settle(700);
    expect(document.querySelector(".lineup-manager")).toBeNull();
  },
);

test("list pagination keeps directional access between pages and enabled controls", async () => {
  const many = `#EXTM3U\n${Array.from({ length: 21 }, (_, index) => {
    const id = String(index + 1).padStart(2, "0");
    return `#EXTINF:-1 tvg-id="c${id}" group-title="Cat${id}",Channel ${id}\nhttp://example.invalid/c${id}.m3u8`;
  }).join("\n")}`;
  await mountApp(many);
  await openContent();
  await settle(0);

  const paginationButtons = () => [
    ...document.querySelectorAll<HTMLButtonElement>(".lineup-pagination button"),
  ];
  expect(paginationButtons()).toHaveLength(2);
  const [previous, next] = paginationButtons();
  expect(previous.disabled).toBe(true);
  expect(next.disabled).toBe(false);

  const zero = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  } as DOMRect;
  const rects = new Map<Element, DOMRect>();
  const place = (el: Element, box: { x: number; y: number; w: number; h: number }) =>
    rects.set(el, {
      x: box.x,
      y: box.y,
      top: box.y,
      left: box.x,
      right: box.x + box.w,
      bottom: box.y + box.h,
      width: box.w,
      height: box.h,
      toJSON: () => ({}),
    } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return rects.get(this) ?? zero;
  });

  // Page one shows twenty rows; the disabled Previous sits closest below the
  // final row so only :disabled exclusion keeps Next reachable.
  const firstPageRows = () => [
    ...document.querySelectorAll<HTMLElement>(".lineup-manager-list .lineup-row-open"),
  ];
  expect(firstPageRows()).toHaveLength(20);
  firstPageRows().forEach((row, index) => {
    place(row, { x: 0, y: index * 50, w: 400, h: 40 });
  });
  place(previous, { x: 150, y: 1100, w: 100, h: 40 });
  place(next, { x: 320, y: 1100, w: 100, h: 40 });

  const lastRow = firstPageRows()[19];
  lastRow.focus();
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(next);

  press(KEY.ENTER);
  await settle(0);
  expect(firstPageRows()).toHaveLength(1);
  expect(document.activeElement).toBe(
    document.querySelector(".lineup-manager-list [data-settings-detail-first]"),
  );
  expect(
    document.querySelector(".lineup-manager-list [data-settings-detail-first]")?.textContent,
  ).toContain("Cat21");

  // Page two's disabled Next is again the closest target; enabled Previous wins.
  const lastPageRow = firstPageRows()[0];
  place(lastPageRow, { x: 0, y: 0, w: 400, h: 40 });
  place(previous, { x: 320, y: 100, w: 100, h: 40 });
  place(next, { x: 150, y: 100, w: 100, h: 40 });
  lastPageRow.focus();
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(previous);

  press(KEY.ENTER);
  await settle(0);
  expect(firstPageRows()).toHaveLength(20);
  expect(document.activeElement).toBe(
    document.querySelector(".lineup-manager-list [data-settings-detail-first]"),
  );
  expect(
    document.querySelector(".lineup-manager-list [data-settings-detail-first]")?.textContent,
  ).toContain("Cat01");
});

test("channel list pagination moves focus to the new first row", async () => {
  const paged = `#EXTM3U\n${[
    ...Array.from({ length: 25 }, (_, index) => {
      const id = index + 1;
      return `#EXTINF:-1 tvg-id="b${id}" group-title="Bulk",Bulk Channel ${id}\nhttp://example.invalid/b${id}.m3u8`;
    }),
    ...Array.from({ length: 20 }, (_, index) => {
      const id = index + 1;
      const group = `Solo${String(id).padStart(2, "0")}`;
      return `#EXTINF:-1 tvg-id="s${id}" group-title="${group}",Solo ${id}\nhttp://example.invalid/s${id}.m3u8`;
    }),
  ].join("\n")}`;
  await mountApp(paged);
  await openContent();
  await settle(0);

  const marked = () =>
    document.querySelector<HTMLElement>(".lineup-manager-list [data-settings-detail-first]")!;
  const pagerButton = (label: string) =>
    within(document.querySelector<HTMLElement>(".lineup-pagination")!).getByRole("button", {
      name: label,
    });

  expect(document.querySelectorAll(".lineup-row-open")).toHaveLength(20);
  pagerButton("Next").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(marked().textContent).toContain("Solo20");
  expect(document.activeElement).toBe(marked());

  pagerButton("Previous").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(marked().textContent).toContain("Bulk");
  expect(document.activeElement).toBe(marked());

  await openCategory("Bulk");
  await settle(0);
  expect(document.querySelectorAll(".lineup-channel-info")).toHaveLength(20);

  pagerButton("Next").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(marked().textContent).toContain("Bulk Channel 21");
  expect(document.activeElement).toBe(marked());

  pagerButton("Previous").focus();
  press(KEY.ENTER);
  await settle(0);
  expect(marked().textContent).toContain("Bulk Channel 1");
  expect(document.activeElement).toBe(marked());
});

test("management search keeps Enter inert in the field and Down reaches the rows", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  fireEvent.click(document.querySelector<HTMLButtonElement>('[data-lineup-action="search"]')!);
  await settle(0);
  const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  expect(document.activeElement).toBe(input);

  fireEvent.change(input, { target: { value: "News" } });
  await settle(250);
  const value = input.value;

  // Both the native keydown and the remote Enter stay inside the field.
  fireEvent.keyDown(input, { keyCode: KEY.ENTER });
  press(KEY.ENTER);
  await settle(0);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe(value);
  expect(document.querySelector(".lineup-manager-list .lineup-row-open")).toBeTruthy();

  // Down reaches the first result row and Enter there opens it.
  press(KEY.DOWN);
  await settle(0);
  const first = document.querySelector<HTMLElement>(".lineup-manager-list .lineup-row-open")!;
  expect(document.activeElement).toBe(first);
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
    "channels",
  );
});

test("the channel editor shows provider identity and reset restores provider drafts only", async () => {
  await mountApp(REORDER_PLAYLIST);
  const { useLineup } = await import("../src/stores/lineup");
  await openContent(true);

  // Hide Alpha through the real visibility UI so reset must preserve it.
  fireEvent.click(visibilitySwitch("Alpha"));
  await settle(700);

  await openRenameRow("Alpha");
  await settle(0);

  const editor = () => document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  const origin = editor().querySelector<HTMLElement>(".lineup-edit-origin")!;
  expect(origin).toBeTruthy();
  const provider = origin.querySelector<HTMLElement>(".lineup-edit-provider")!;
  const channel = useLineup
    .getState()
    .managedChannels.find((item) => item.effective.name === "Alpha")!;
  expect(provider.textContent).toContain(channel.providerName);
  expect(provider.querySelector("[dir='ltr']")?.textContent).toBe(
    String(channel.providerNumber),
  );
  expect(provider.querySelector("input, textarea, select")).toBeNull();
  expect(provider.getAttribute("role")).toBe("note");

  const fields = [...editor().querySelectorAll<HTMLElement>(".lineup-edit-field")];
  expect(fields).toHaveLength(2);
  expect(fields[0].querySelector("label")?.textContent).toBe("Number");
  expect(fields[1].querySelector("label")?.textContent).toBe("Name");
  expect(fields[0].querySelector<HTMLInputElement>("input")!.id).toBe("lineup-number");
  expect(fields[1].querySelector<HTMLInputElement>("input")!.id).toBe("lineup-name");
  expect(document.activeElement).toBe(fields[1].querySelector("input"));
  expect(fields[0].querySelector<HTMLInputElement>("input")!.value).toBe(
    String(channel.effective.number),
  );

  const badge = provider.querySelector<HTMLElement>(".lineup-channel-number")!;
  expect(badge).toBeTruthy();
  expect(badge.textContent?.trim()).toBe(String(channel.providerNumber));
  expect(provider.contains(badge)).toBe(true);
  expect(provider.textContent).toContain(channel.providerName);

  const resetButton = within(editor()).getByRole("button", {
    name: "Reset to default",
  });
  expect(resetButton.classList.contains("btn")).toBe(true);
  expect(resetButton.classList.contains("tonal")).toBe(true);
  expect(resetButton.classList.contains("flat")).toBe(false);
  expect((resetButton as HTMLButtonElement).disabled).toBe(false);
  expect(resetButton.closest(".dialog-actions")).toBeTruthy();
  expect(resetButton.closest(".lineup-edit-origin")).toBeNull();
  const draftName = fields[1].querySelector<HTMLInputElement>("input")!;
  const draftNumber = fields[0].querySelector<HTMLInputElement>("input")!;
  fireEvent.change(draftName, { target: { value: "Draft name" } });
  fireEvent.change(draftNumber, { target: { value: "7" } });
  resetButton.focus();
  expect(document.activeElement).toBe(resetButton);
  press(KEY.ENTER);
  await settle(0);
  expect(draftName.value).toBe(channel.providerName);
  expect(draftNumber.value).toBe(String(channel.providerNumber));

  // Save a custom name and number first so reset has something to undo.
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Custom Alpha" },
  });
  fireEvent.change(screen.getByLabelText("Number"), {
    target: { value: "42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  // Name and number commit as two serialized idle writes.
  await settle(1000);
  expect(editor()).toBeNull();

  // Reopen: the origin still shows the provider values, never the overrides.
  await openRenameRow("Custom Alpha");
  await settle(0);
  const reopened = editor();
  const reopenedProvider = reopened.querySelector<HTMLElement>(".lineup-edit-provider")!;
  expect(reopenedProvider.textContent).toContain(channel.providerName);
  expect(reopenedProvider.querySelector(".lineup-channel-number")!.textContent?.trim()).toBe(
    String(channel.providerNumber),
  );
  expect(reopenedProvider.querySelector("[dir='ltr']")!.textContent?.trim()).toBe(
    String(channel.providerNumber),
  );

  // Reset changes drafts only; Cancel keeps the saved overrides.
  fireEvent.click(within(reopened).getByRole("button", { name: "Reset to default" }));
  await settle(0);
  const nameInput = reopened.querySelector<HTMLInputElement>("#lineup-name")!;
  const numberInput = reopened.querySelector<HTMLInputElement>("#lineup-number")!;
  expect(nameInput.value).toBe(channel.providerName);
  expect(numberInput.value).toBe(String(channel.providerNumber));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);

  const persisted = useLineup
    .getState()
    .managedChannels.find((item) => item.ref.id === channel.ref.id)!;
  expect(persisted.effective.name).toBe("Custom Alpha");
  expect(persisted.effective.number).toBe(42);

  // Reset then Save clears the overrides and keeps visibility untouched.
  await openRenameRow("Custom Alpha");
  await settle(0);
  const again = editor();
  const wasHidden = useLineup
    .getState()
    .managedChannels.find((item) => item.ref.id === channel.ref.id)!.hidden;
  fireEvent.click(within(again).getByRole("button", { name: "Reset to default" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(1000);

  const restored = useLineup
    .getState()
    .managedChannels.find((item) => item.ref.id === channel.ref.id)!;
  expect(restored.effective.name).toBe(channel.providerName);
  expect(restored.effective.number).toBe(channel.providerNumber);
  expect(restored.hidden).toBe(wasHidden);
  expect(useLineup.getState().saving).toBe(false);
});

test("the category editor shows the provider name and reset restores it on save", async () => {
  await mountApp(CATEGORIES);
  const { useLineup } = await import("../src/stores/lineup");
  await openContent();

  // Hide News through the real visibility UI so reset must preserve it.
  fireEvent.click(visibilitySwitch("News"));
  await settle(700);

  // Rename News to Headlines through the real editor.
  await openRenameRow("News");
  await settle(0);
  fireEvent.change(screen.getByLabelText("Custom name"), {
    target: { value: "Headlines" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect(document.querySelector("[data-settings-dialog]")).toBeNull();

  const newsCategory = () =>
    useLineup
      .getState()
      .managedCategories.find((category) => category.providerName === "News")!;
  expect(newsCategory().name).toBe("Headlines");
  expect(newsCategory().hidden).toBe(true);

  // Reopen: the provider wrapper shows the original News beside tonal Reset.
  // The saved name replaces the row label, so the pencil answers to Headlines.
  await openRenameRow("Headlines");
  await settle(0);
  const editor = () => document.querySelector<HTMLElement>("[data-settings-dialog]")!;
  const provider = editor().querySelector<HTMLElement>(".lineup-edit-provider")!;
  expect(provider.classList.contains("lineup-edit-provider-category")).toBe(true);
  expect(provider.getAttribute("role")).toBe("note");
  expect(provider.textContent).toContain("News");
  expect(provider.querySelector(".lineup-channel-number")).toBeNull();
  const resetButton = within(editor()).getByRole("button", {
    name: "Reset to default",
  });
  expect(resetButton.classList.contains("btn")).toBe(true);
  expect(resetButton.classList.contains("tonal")).toBe(true);
  expect(resetButton.classList.contains("flat")).toBe(false);
  expect((resetButton as HTMLButtonElement).disabled).toBe(false);
  expect(resetButton.closest(".dialog-actions")).toBeTruthy();

  // Reset changes only the draft: no write is issued and nothing persists.
  const revisionBefore = useLineup.getState().revision;
  resetButton.focus();
  expect(document.activeElement).toBe(resetButton);
  press(KEY.ENTER);
  await settle(0);
  expect(editor().querySelector<HTMLInputElement>("#lineup-name")!.value).toBe("News");
  expect(useLineup.getState().revision).toBe(revisionBefore);

  // Cancel keeps the persisted Headlines.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(newsCategory().name).toBe("Headlines");

  // Reset then Save restores News while hidden stays true.
  await openRenameRow("Headlines");
  await settle(0);
  fireEvent.click(within(editor()).getByRole("button", { name: "Reset to default" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await settle(700);
  expect(newsCategory().name).toBe("News");
  expect(newsCategory().hidden).toBe(true);
});

test.each([
  { scope: "categories", channels: false },
  { scope: "channels", channels: true },
])(
  "sort rows own focus on click and the header reset restores provider order for $scope",
  async ({ channels }) => {
    await mountApp(REORDER_PLAYLIST);
    const { useLineup } = await import("../src/stores/lineup");
    await openContent(channels);

    if (channels) {
      // A saved channel name must survive the order reset untouched.
      await openRenameRow("Alpha");
      await settle(0);
      fireEvent.change(screen.getByLabelText("Name"), {
        target: { value: "Alpha Custom" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle(700);
    }

    await enterReorder();
    await settle(0);

    const sortIds = () =>
      [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
        (row) => row.dataset.sortId,
      );
    const sortRows = () => [
      ...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row"),
    ];
    const providerOrder = sortIds();
    expect(providerOrder).toHaveLength(2);

    // Focus the first row, then click a DIFFERENT row: the click itself must
    // move focus and the grab to it without any manual focus call.
    const first = sortRows()[0];
    const second = sortRows()[1];
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.click(second);
    await settle(0);
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(second.classList.contains("grabbed")).toBe(true);

    // Remote Up reorders the grabbed row; remote Enter drops and persists it.
    press(KEY.UP);
    await settle(0);
    expect(sortIds()).toEqual([providerOrder[1], providerOrder[0]]);
    press(KEY.ENTER);
    await settle(700);
    expect(sortIds()).toEqual([providerOrder[1], providerOrder[0]]);
    expect(document.querySelector(".lineup-sort-row.grabbed")).toBeNull();

    const state = useLineup.getState();
    if (channels) {
      const key = state.provider.categories[0].key;
      expect(state.itemOrderModes[key]).toBe("custom");
      const renamed = state.managedChannels.find(
        (channel) => channel.providerName === "Alpha",
      )!;
      expect(renamed.effective.name).toBe("Alpha Custom");
      const news = state.categories.find((category) => category.key === key)!;
      expect(news.channels.map((channel) => channel.name)).toEqual(["Beta", "Alpha Custom"]);
    } else {
      expect(state.categoryOrderModes.live).toBe("custom");
      const liveKeys = state.categories
        .filter((category) => category.kind === "live" && !category.personal)
        .map((category) => category.key);
      expect(liveKeys).toEqual([providerOrder[1], providerOrder[0]]);
    }

    // Up from the first row reaches Reset, and Down returns to that row.
    const reset = document.querySelector<HTMLButtonElement>(
      ".lineup-header-actions [data-lineup-reset-order]",
    )!;
    expect(reset).toBeTruthy();
    expect(reset.classList.contains("btn")).toBe(true);
    expect(reset.classList.contains("tonal")).toBe(true);
    expect(reset.classList.contains("flat")).toBe(false);
    expect(reset.disabled).toBe(false);
    act(() => sortRows()[0].focus());
    press(KEY.UP);
    expect(document.activeElement).toBe(reset);
    press(KEY.DOWN);
    expect(document.activeElement).toBe(sortRows()[0]);
    press(KEY.UP);
    press(KEY.ENTER);
    await settle(700);
    expect(document.querySelector(".lineup-sort-row")).toBeNull();
    expect(orderValueLabel()).toBe("Provider order");
    expect(document.activeElement).toBe(orderPreferenceButton());

    // Custom again starts at provider order: the discarded layout is gone.
    await enterReorder();
    await settle(0);
    expect(sortIds()).toEqual(providerOrder);
  },
);

test("the order dialog reset is a real button outside the listbox and clears remembered placements", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await enterReorder();
  await settle(0);

  const sortIds = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const providerOrder = sortIds();
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];

  // Create and persist a real moved arrangement, then leave Custom Order.
  fireEvent.click(rows()[0]);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(700);
  press(KEY.BACK);
  await settle(0);
  expect(orderValueLabel()).toBe("Custom Order");

  // Choose another mode; the remembered layout stays but is inactive.
  await selectOrderMode("alphabetical");
  await settle(0);
  expect(orderValueLabel()).toBe("Alphabetical");

  await openOrderDialog();
  await settle(0);
  // Reset lives in the dialog footer, outside the inner order body.
  const footer = orderDialog()!.closest<HTMLElement>("[data-settings-dialog]")!;
  const reset = footer.querySelector<HTMLButtonElement>("[data-lineup-reset-order]")!;
  expect(reset).toBeTruthy();
  expect(reset.tagName).toBe("BUTTON");
  expect(reset.closest("[role='listbox']")).toBeNull();
  expect(reset.closest("[data-lineup-order-dialog]")).toBeNull();
  expect(reset.closest(".dialog-actions")).toBe(footer.querySelector(".dialog-actions"));
  expect(reset.classList.contains("btn")).toBe(true);
  expect(reset.classList.contains("tonal")).toBe(true);
  expect(reset.disabled).toBe(false);
  fireEvent.click(reset);
  await settle(0);
  expect(orderDialog()).toBeNull();
  expect(orderValueLabel()).toBe("Provider order");
  expect(document.activeElement).toBe(orderPreferenceButton());

  // Custom again starts at provider order: old placements are gone.
  await enterReorder();
  await settle(0);
  expect(sortIds()).toEqual(providerOrder);
});

test.each([
  { name: "LTR", locale: undefined, logicalEnd: KEY.RIGHT },
  { name: "RTL", locale: "ar" as const, logicalEnd: KEY.LEFT },
])(
  "the order dialog footer keeps Reset and Close reachable by D-pad ($name)",
  async ({ locale, logicalEnd }) => {
    const rtl = locale === "ar";
    // Installed before mount so the dialog's first layout is measured: the
    // marked option must win over any competing layout autofocus.
    popupGeometry("[data-settings-dialog]", layoutRect(0, 0, 640, 500), [
      {
        selector: '[data-lineup-order-option="provider"]',
        rect: layoutRect(0, 100, 640, 64),
      },
      {
        selector: '[data-lineup-order-option="alphabetical"]',
        rect: layoutRect(0, 180, 640, 64),
      },
      {
        selector: '[data-lineup-order-option="custom"]',
        rect: layoutRect(0, 260, 640, 64),
      },
      {
        selector: "[data-lineup-reset-order]",
        rect: layoutRect(rtl ? 340 : 0, 360, 300, 64),
      },
      {
        selector: ".dialog-actions > button:last-child",
        rect: layoutRect(rtl ? 0 : 340, 360, 300, 64),
      },
    ]);
    const writes: StoredLineupV1[] = [];
    await mountApp(REORDER_PLAYLIST, {
      ...(locale ? { locale } : {}),
      personalWrite: async (_id: string, value: unknown) => {
        writes.push(value as StoredLineupV1);
      },
    });
    const { useLineup } = await import("../src/stores/lineup");
    if (locale) {
      press(KEY.YELLOW);
      const rail = [...document.querySelectorAll<HTMLElement>(".sheet-rail .row")];
      fireEvent.click(rail[2]);
      await settle(0);
      fireEvent.click(
        document.querySelector<HTMLElement>('[data-settings-focus="manage-playlists"]')!,
      );
      await settle(0);
      fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
      await settle(0);
    } else {
      await openContent();
    }

    const sortIds = () =>
      [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
        (row) => row.dataset.sortId,
      );
    const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];

    // Persist a real moved arrangement inside Custom Order, then leave the
    // dedicated view so the chooser preference is reachable again.
    await enterReorder();
    await settle(0);
    const providerOrder = sortIds();
    fireEvent.click(rows()[0]);
    press(KEY.DOWN);
    press(KEY.ENTER);
    await settle(700);
    press(KEY.BACK);
    await settle(0);
    const savedOrder = () => writes[writes.length - 1]!.personalisation.categoryOrders.live;
    const placements = savedOrder();
    const writesBeforeClose = writes.length;
    expect(placements.length).toBeGreaterThan(0);
    expect(useLineup.getState().categoryOrderModes.live).toBe("custom");

    await openOrderDialog();
    await settle(0);
    const dialog = orderDialog()!.closest<HTMLElement>("[data-settings-dialog]")!;
    const actions = dialog.querySelector<HTMLElement>(".dialog-actions")!;
    expect(actions.classList.contains("dialog-actions-split")).toBe(true);
    const reset = actions.querySelector<HTMLButtonElement>("[data-lineup-reset-order]")!;
    const close = actions.querySelector<HTMLButtonElement>(":scope > button:last-child")!;
    expect(reset).toBeTruthy();
    expect(close).toBeTruthy();
    expect(close.textContent).toBeTruthy();
    const custom = orderOption("custom")!;

    // The selected option keeps initial focus; Down reaches Reset and the
    // logical end reaches Close in both directions.
    expect(document.activeElement).toBe(custom);
    press(KEY.DOWN);
    expect(document.activeElement).toBe(reset);
    press(logicalEnd);
    expect(document.activeElement).toBe(close);

    // Close dismisses one level without touching mode, placements or focus.
    const revision = useLineup.getState().revision;
    press(KEY.ENTER);
    await settle(0);
    expect(orderDialog()).toBeNull();
    expect(useLineup.getState().revision).toBe(revision);
    expect(useLineup.getState().categoryOrderModes.live).toBe("custom");
    expect(writes.length).toBe(writesBeforeClose);
    expect(savedOrder()).toEqual(placements);
    expect(document.activeElement).toBe(orderPreferenceButton());

    // Reopen and reset through the footer: the remembered layout is cleared.
    await openOrderDialog();
    await settle(0);
    press(KEY.DOWN);
    expect(document.activeElement).toBe(
      orderDialog()!
        .closest<HTMLElement>("[data-settings-dialog]")!
        .querySelector("[data-lineup-reset-order]"),
    );
    press(KEY.ENTER);
    await settle(700);
    expect(orderDialog()).toBeNull();
    expect(useLineup.getState().categoryOrderModes.live).toBe("provider");
    expect(savedOrder()).toEqual([]);
    expect(document.activeElement).toBe(orderPreferenceButton());

    await enterReorder();
    await settle(0);
    expect(sortIds()).toEqual(providerOrder);
  },
);

test("a deferred order reset updates the view at once and rolls back silently", async () => {
  let armed = false;
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const writes: unknown[] = [];
  await mountApp(REORDER_PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!armed) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  const { useLineup } = await import("../src/stores/lineup");
  await openContent();

  const sortIds = () =>
    [...document.querySelectorAll<HTMLElement>("[data-sort-id]")].map(
      (row) => row.dataset.sortId,
    );
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
  await enterReorder();
  await settle(0);
  const providerOrder = sortIds();

  // A durable custom layout first: grab the first row and drop it second.
  fireEvent.click(rows()[0]);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(700);
  const customOrder = sortIds();
  expect(customOrder).toEqual([providerOrder[1], providerOrder[0]]);
  const mark = writes.length;

  armed = true;
  const reset = document.querySelector<HTMLButtonElement>(
    ".lineup-header-actions [data-lineup-reset-order]",
  )!;
  fireEvent.click(reset);
  await settle(0);

  // The mode and view update immediately while the write is still in flight:
  // no spinner, no notice, no Retry, and navigation still works.
  expect(orderValueLabel()).toBe("Provider order");
  expect(document.querySelector(".lineup-sort-row")).toBeNull();
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();
  await openOrderDialog();
  expect(orderDialog()).toBeTruthy();
  press(KEY.ESC);
  await settle(0);
  await settle(700);
  expect(writes.length).toBe(mark + 1);
  expect(gates).toHaveLength(1);

  await act(async () => {
    gates[0]!.reject(new Error("quota"));
  });
  await settle(700);

  // The durable custom mode and arrangement return silently.
  expect(orderValueLabel()).toBe("Custom Order");
  expect(document.querySelector(".lineup-recovery")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry saving changes" })).toBeNull();
  expect(document.querySelector(".toast-host .toast")).toBeNull();
  const state = useLineup.getState();
  expect(state.categoryOrderModes.live).toBe("custom");
  await enterReorder();
  await settle(0);
  expect(sortIds()).toEqual(customOrder);

  // A fresh reset still works once writes resolve.
  armed = false;
  fireEvent.click(
    document.querySelector<HTMLButtonElement>(
      ".lineup-header-actions [data-lineup-reset-order]",
    )!,
  );
  await settle(700);
  expect(orderValueLabel()).toBe("Provider order");
  expect(document.querySelector(".lineup-sort-row")).toBeNull();
});

test.each([
  { name: "LTR", locale: undefined, towardRail: KEY.LEFT, backToBody: KEY.RIGHT },
  { name: "RTL", locale: "ar" as const, towardRail: KEY.RIGHT, backToBody: KEY.LEFT },
])(
  "nested settings pages keep one edge Back rail without the application menu ($name)",
  async ({ locale, towardRail, backToBody }) => {
    await mountApp(REORDER_PLAYLIST, locale ? { locale } : {});

    const checkPage = async (channels: boolean) => {
      // Exactly one narrow Back outside the toolbar on every nested page.
      const backs = document.querySelectorAll<HTMLElement>("[data-settings-edge-back]");
      expect(backs).toHaveLength(1);
      const back = backs[0];
      expect(back.closest(".sheet-edge-back")).toBeTruthy();
      expect(back.closest(".sheet-body")).toBeNull();
      expect(back.closest(".settings-list-header")).toBeNull();
      expect(back.closest(".lineup-header-actions")).toBeNull();

      // Logical start reaches Back and stays inside the full screen page.
      const opener =
        document.querySelector<HTMLElement>(".sheet-body [data-settings-detail-first]") ??
        document.querySelector<HTMLElement>(".sheet-body button, .sheet-body [tabindex='0']");
      expect(opener).toBeTruthy();
      opener!.focus();
      await settle(0);
      for (let attempt = 0; attempt < 4 && document.activeElement !== back; attempt += 1) {
        press(towardRail);
        await settle(0);
      }
      expect(document.activeElement).toBe(back);

      press(towardRail);
      await settle(0);
      expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(
        false,
      );
      expect(screen.queryByRole("navigation", { name: "Application navigation" })).toBeNull();
      expect(document.activeElement).toBe(back);

      // Logical end returns to the remembered body control.
      press(backToBody);
      await settle(0);
      expect(document.activeElement).toBe(opener);

      // Back activation pops one level and restores the opener.
      for (let attempt = 0; attempt < 4 && document.activeElement !== back; attempt += 1) {
        press(towardRail);
        await settle(0);
      }
      expect(document.activeElement).toBe(back);
      press(KEY.ENTER);
      await settle(0);
      if (channels) {
        // One level only: back to the categories page inside the same manager.
        expect(
          document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope"),
        ).toBe("categories");
        expect(document.querySelector("[data-settings-edge-back]")).toBeTruthy();
        expect((document.activeElement as HTMLElement | null)?.dataset?.settingsFocus).toMatch(
          /^lineup-open-/,
        );
      } else {
        expect(document.querySelector(".lineup-manager")).toBeNull();
        expect(document.querySelector("[data-settings-edge-back]")).toBeTruthy();
        expect((document.activeElement as HTMLElement | null)?.dataset?.settingsFocus).toMatch(
          /^playlist-open-/,
        );
      }
    };

    // Category page: rail -> Content & playlists -> Saved playlists -> playlist.
    press(KEY.YELLOW);
    if (locale) {
      const rail = [...document.querySelectorAll<HTMLElement>(".sheet-rail .row")];
      fireEvent.click(rail[2]);
    } else {
      fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
    }
    await settle(0);
    fireEvent.click(
      document.querySelector<HTMLElement>('[data-settings-focus="manage-playlists"]')!,
    );
    await settle(0);
    fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
    await settle(0);
    await checkPage(false);

    // Channel page: reopen management and enter the first category.
    fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
    await settle(0);
    await openFirstCategory();
    await settle(0);
    await checkPage(true);
  },
);

test("a pointer visit to the app sidebar restores the last body control", async () => {
  await mountApp(REORDER_PLAYLIST);
  await openContent();
  await settle(0);

  const opener =
    document.querySelector<HTMLElement>(".sheet-body [data-settings-detail-first]") ??
    document.querySelector<HTMLElement>(".sheet-body button, .sheet-body [tabindex='0']");
  expect(opener).toBeTruthy();
  opener!.focus();
  await settle(0);

  // A pointer wakes pointer input; hovering the sidebar focuses app navigation.
  fireEvent.pointerDown(document.body, { pointerId: 1 });
  const settingsNav = document.querySelector<HTMLElement>(
    "[data-navigation-action='settings']",
  )!;
  expect(settingsNav).toBeTruthy();
  fireEvent.pointerOver(settingsNav, { pointerId: 1 });
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(true);

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(false);
  expect(document.activeElement).toBe(opener);
});

test("edge Back keeps focus while a grabbed reorder row rerenders", async () => {
  await mountApp(REORDER_PLAYLIST);
  const { applyLineupMutation, useLineup } = await import("../src/stores/lineup");
  await openContent();
  await enterReorder();
  await settle(0);

  const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
  expect(back).toBeTruthy();
  const row = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
  fireEvent.click(row);
  await settle(0);
  expect(row.classList.contains("grabbed")).toBe(true);
  expect(document.activeElement).toBe(row);

  // Toward the rail while sorting lands on Back without dropping the grab.
  press(KEY.LEFT);
  await settle(0);
  expect(document.activeElement).toBe(back);
  expect(document.querySelector(".lineup-sort-row.grabbed")?.getAttribute("aria-pressed")).toBe(
    "true",
  );

  // Back owns the vertical keys while it holds focus.
  press(KEY.UP);
  await settle(0);
  expect(document.activeElement).toBe(back);

  // A store-driven rerender of the row subtree must not steal Back's focus.
  const state = useLineup.getState();
  let mutation!: ReturnType<typeof applyLineupMutation>;
  act(() => {
    mutation = applyLineupMutation(state.revision, {
      type: "channel.visibility",
      channel: state.managedChannels[0].ref,
      hidden: true,
    });
  });
  await settle(700);
  expect((await mutation).ok).toBe(true);
  expect(document.activeElement).toBe(back);
  expect(document.querySelector(".lineup-sort-row.grabbed")).toBeTruthy();
});

test("an inactive playlist acquisition shows a named spinner status and usable Back", async () => {
  let releaseSecond: ((response: Response) => void) | undefined;
  await mountApp(PLAYLIST, {
    fetchImplementation: (input) => {
      if (String(input).includes("second.invalid")) {
        return new Promise<Response>((resolve) => {
          releaseSecond = resolve;
        });
      }
      return Promise.resolve(new Response(PLAYLIST, { status: 200 }));
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const { useChannels } = await import("../src/stores/channels");
  const { useLineup } = await import("../src/stores/lineup");
  const { useLibrary } = await import("../src/stores/library");
  const playCallsBefore = playCalls.length;
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  const activeId = useSettings.getState().activePlaylistId;
  const lineupPlaylist = useLineup.getState().playlistId;
  const lineupProvider = useLineup.getState().provider;
  const libraryPlaylist = useLibrary.getState().playlistId;
  const libraryCategories = useLibrary.getState().categories;
  const libraryItems = useLibrary.getState().categoryItems;
  const channelRows = useChannels.getState().channels;

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  const openSecond = () =>
    [...document.querySelectorAll<HTMLButtonElement>(".pl-open")].find((button) =>
      button.getAttribute("aria-label")?.includes("Second"),
    )!;
  fireEvent.click(openSecond());
  await settle(0);

  // The gate names the managed playlist through an accessible status only:
  // a centered spinner, no visible loading sentence, no "active" wording.
  const status = document.querySelector<HTMLElement>(".lineup-manager-loading")!;
  expect(status).toBeTruthy();
  expect(status.getAttribute("role")).toBe("status");
  expect(status.hasAttribute("tabindex")).toBe(false);
  expect(status.hasAttribute("data-settings-detail-first")).toBe(false);
  expect(status.getAttribute("aria-label")).toBe("Loading Second…");
  expect(status.querySelector(".spinner")?.getAttribute("aria-hidden")).toBe("true");
  expect(status.textContent?.trim()).toBe("");
  expect(document.querySelector(".sheet-body")?.textContent ?? "").not.toContain(
    "Loading the active playlist",
  );

  // Back exists and is reachable while the catalogue is still held.
  const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
  expect(back).toBeTruthy();
  expect(back.disabled).toBe(false);
  back.focus();
  expect(document.activeElement).toBe(back);

  // Drive timers so acquisition has definitely reached the held fetch, then
  // release it explicitly: the resolver is a hard prerequisite, not optional.
  await settle(700);
  expect(typeof releaseSecond).toBe("function");
  await act(async () => {
    releaseSecond!(new Response(PLAYLIST, { status: 200 }));
  });
  await settle(1200);
  expect(document.querySelector(".lineup-manager-loading")).toBeNull();
  expect(document.querySelector(".lineup-manager")).toBeTruthy();

  // Back leaves the managed view once the catalogue has landed.
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".lineup-manager")).toBeNull();

  // The active playlist, its controller, playback and the library are untouched.
  expect(playCalls.length).toBe(playCallsBefore);
  expect(useSettings.getState().activePlaylistId).toBe(activeId);
  expect(useLineup.getState().playlistId).toBe(lineupPlaylist);
  expect(useLineup.getState().provider).toBe(lineupProvider);
  expect(useChannels.getState().channels).toBe(channelRows);
  expect(useLibrary.getState().playlistId).toBe(libraryPlaylist);
  expect(useLibrary.getState().categories).toBe(libraryCategories);
  expect(useLibrary.getState().categoryItems).toBe(libraryItems);
});

test("vertical content tabs route directional keys without stealing text carets", async () => {
  await mountXtream();
  await openContent();
  await settle(0);

  // A text field inside the content keeps its caret keys while the caret is
  // inside the text. Only a boundary press is allowed to hand focus back.
  fireEvent.click(document.querySelector<HTMLElement>('[data-lineup-action="search"]')!);
  await settle(0);
  const field = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
  expect(field).toBeTruthy();
  field.focus();
  fireEvent.change(field, { target: { value: "news" } });
  await settle(0);
  field.setSelectionRange(2, 2);
  press(KEY.LEFT);
  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).toBe(field);
  press(KEY.ESC);
  await settle(0);
  press(KEY.ESC);
  await settle(0);

  const strip = document.querySelector<HTMLElement>(".category-kind-selector")!;
  const tabs = () => [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs()).toHaveLength(3);

  // Down/Up move focus through the tabs without selecting until OK.
  tabs()[0].focus();
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[1]);
  expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[2]);
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[2]);
  press(KEY.UP);
  press(KEY.UP);
  press(KEY.UP);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[0]);

  // Enter activates the focused tab.
  tabs()[1].focus();
  press(KEY.ENTER);
  await settle(700);
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");

  // Toward the body activates the focused tab and lands on the order control.
  tabs()[2].focus();
  press(KEY.RIGHT);
  await settle(0);
  expect(tabs()[2].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(orderPreferenceButton());

  // The inline start direction from the content returns to the selected tab,
  // then Back, then the app sidebar.
  press(KEY.LEFT);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[2]);
  press(KEY.LEFT);
  await settle(0);
  const back = document.querySelector<HTMLElement>("[data-settings-edge-back]")!;
  expect(document.activeElement).toBe(back);
  press(KEY.LEFT);
  await settle(0);
  expect(document.activeElement?.closest(".app-navigation")).toBeTruthy();
});

test("vertical content tabs mirror their horizontal routes in RTL", async () => {
  const bodies = xtreamBodies();
  await mountApp("", {
    source: XTREAM_SOURCE,
    locale: "ar",
    fetchImplementation: async (input) => {
      const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
      if (!(action in bodies)) throw new Error(`Unexpected fixture action ${action}`);
      return new Response(JSON.stringify(bodies[action]), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  press(KEY.YELLOW);
  const rail = [...document.querySelectorAll<HTMLElement>(".sheet-rail .row")];
  fireEvent.click(rail[2]);
  await settle(0);
  fireEvent.click(document.querySelector<HTMLElement>(".content-manage")!);
  await settle(0);
  fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
  await settle(0);

  const strip = document.querySelector<HTMLElement>(".category-kind-selector")!;
  const tabs = () => [...strip.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs()).toHaveLength(3);

  // In RTL the direction toward the body is LEFT and the inline start
  // direction is RIGHT.
  tabs()[1].focus();
  press(KEY.LEFT);
  await settle(0);
  expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(orderPreferenceButton());
  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).toBe(tabs()[1]);
  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement).toBe(
    document.querySelector<HTMLElement>("[data-settings-edge-back]"),
  );
  press(KEY.RIGHT);
  await settle(0);
  expect(document.activeElement?.closest(".app-navigation")).toBeTruthy();
});

test("reorder motion animates real moves, carries in-flight translation and cancels cleanly", async () => {
  const restoreGeometry = mockSortItemGeometry();
  const motion = stubSortAnimations();
  const carried = new Set<HTMLElement>();
  const realGCS = window.getComputedStyle.bind(window);
  const tokenDuration = "160ms";
  vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
    if (element === document.documentElement) {
      return {
        getPropertyValue: (name: string) =>
          name === "--t-fast"
            ? tokenDuration
            : name === "--ease-enter"
              ? "linear"
              : realGCS(element).getPropertyValue(name),
      } as CSSStyleDeclaration;
    }
    if (carried.has(element as HTMLElement)) {
      return {
        transform: "matrix(1, 0, 0, 1, 0, -40)",
      } as CSSStyleDeclaration;
    }
    return realGCS(element);
  }) as typeof window.getComputedStyle);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  try {
    const view = await mountApp(TWENTY_ONE_CHANNELS);
    await openContent(true);
    await enterReorder();
    await settle(0);

    const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".lineup-sort-row")];
    const wrapperFor = (id: string) =>
      document.querySelector<HTMLElement>(`[data-lineup-sort-motion="${id}"]`)!;
    const animationsFor = (id: string) =>
      motion.animations.filter((record) => record.node.dataset.lineupSortMotion === id);
    const firstFrame = (record: SortAnimationRecord) =>
      (record.keyframes as Array<{ transform: string }>)[0].transform;

    const grabbedButton = rows()[0];
    const grabbedId = grabbedButton.dataset.sortId!;
    const displacedId = rows()[1].dataset.sortId!;
    fireEvent.click(grabbedButton);
    await settle(0);

    // The held row owns its layout slot immediately, while displaced rows animate.
    press(KEY.DOWN);
    await settle(0);
    expect(document.activeElement).toBe(grabbedButton);
    expect(animationsFor(grabbedId)).toHaveLength(0);
    expect(firstFrame(animationsFor(displacedId)[0])).toBe("translateY(60px)");

    // Move two while the first move is visually in flight at -40px: the new
    // animation starts from the carried translation rather than jumping.
    carried.add(wrapperFor(displacedId));
    const scroller = document.querySelector<HTMLElement>(".sheet-body")!;
    scroller.scrollTop = 300;
    press(KEY.UP);
    await settle(0);
    expect(animationsFor(grabbedId)).toHaveLength(0);
    expect(document.activeElement).toBe(grabbedButton);
    expect(scroller.scrollTop).toBe(0);
    expect(firstFrame(animationsFor(displacedId)[1])).toBe("translateY(-100px)");
    expect(animationsFor(displacedId)[0].cancel).toHaveBeenCalled();

    // A finished handle removes itself, so a later move cannot cancel it again.
    const finished = animationsFor(displacedId)[1];
    finished.onfinish!();
    press(KEY.DOWN);
    await settle(0);
    expect(animationsFor(grabbedId)).toHaveLength(0);
    expect(finished.cancel).not.toHaveBeenCalled();

    // A page change re-measures without animating unrelated rows: the moved
    // rows' animations in flight are cancelled and nothing new starts.
    const count = motion.animations.length;
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".lineup-pagination button:last-child")!,
    );
    await settle(0);
    expect(motion.animations).toHaveLength(count);
    expect(animationsFor(displacedId)[2].cancel).toHaveBeenCalled();

    // Back on the first page the same context animates a real move again, and
    // unmounting cancels whatever is still in flight.
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".lineup-pagination button:first-child")!,
    );
    await settle(0);
    const held = document.querySelector<HTMLButtonElement>(`[data-sort-id="${grabbedId}"]`)!;
    held.focus();
    const beforeUnmountMove = motion.animations.length;
    press(KEY.DOWN);
    await settle(0);
    const fresh = motion.animations.slice(beforeUnmountMove);
    expect(fresh.length).toBeGreaterThan(0);
    view.unmount();
    for (const record of fresh) {
      expect(record.cancel).toHaveBeenCalled();
    }
  } finally {
    motion.restore();
    restoreGeometry();
  }
});

test("reorder motion stays still for reduced motion and zero duration", async () => {
  const restoreGeometry = mockSortItemGeometry();
  const motion = stubSortAnimations();
  const realGCS = window.getComputedStyle.bind(window);
  let tokenDuration = "0ms";
  let reduced = false;
  vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element) => {
    if (element === document.documentElement) {
      return {
        getPropertyValue: (name: string) =>
          name === "--t-fast"
            ? tokenDuration
            : name === "--ease-enter"
              ? "linear"
              : realGCS(element).getPropertyValue(name),
      } as CSSStyleDeclaration;
    }
    return realGCS(element);
  }) as typeof window.getComputedStyle);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  try {
    await mountApp(THREE_CHANNELS);
    await openContent(true);
    await enterReorder();
    await settle(0);

    const grabbed = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
    fireEvent.click(grabbed);
    await settle(0);

    // Zero duration: the layout still reorders but nothing animates.
    press(KEY.DOWN);
    await settle(0);
    expect(motion.animations).toHaveLength(0);

    // Reduced motion with a real duration also produces no animate calls.
    tokenDuration = "160ms";
    reduced = true;
    press(KEY.UP);
    await settle(0);
    expect(motion.animations).toHaveLength(0);

    // With both gates open the same move animates again.
    reduced = false;
    press(KEY.DOWN);
    await settle(0);
    expect(motion.animations.length).toBeGreaterThan(0);
  } finally {
    motion.restore();
    restoreGeometry();
  }
});

test("playlist rows show one active marker and compact account metadata", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const { useChannels } = await import("../src/stores/channels");
  act(() => {
    for (const name of ["Trial", "Expired", "Limited", "Uncapped"]) {
      useSettings.getState().addPlaylist(name, {
        kind: "xtream",
        server: `https://${name.toLowerCase()}.example`,
        username: `${name.toLowerCase()}-user`,
        password: `${name.toLowerCase()}-secret`,
        output: "m3u8",
      });
    }
    const saved = useSettings.getState().playlists;
    const byName = (name: string) => saved.find((item) => item.name === name)!;
    useChannels.setState({
      accounts: {
        [byName("Trial").id]: {
          status: "Active",
          isTrial: true,
          expiresAt: 1_900_000_000,
          activeConnections: 1,
          maxConnections: 2,
        },
        [byName("Expired").id]: {
          status: "Expired",
          isTrial: false,
          expiresAt: 1,
          activeConnections: 0,
          maxConnections: 2,
        },
        [byName("Limited").id]: {
          status: "Active",
          isTrial: false,
          expiresAt: 1_900_000_000,
          activeConnections: 3,
          maxConnections: 0,
        },
        [byName("Uncapped").id]: {
          status: "Active",
          isTrial: false,
          expiresAt: 1_900_000_000,
          activeConnections: 2,
        },
      },
    });
  });

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const rowFor = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".pl")].find(
      (row) => row.querySelector(".pl-name")?.textContent === name,
    )!;

  // The healthy current playlist carries only its one Active marker.
  const testRow = rowFor("Test");
  expect(testRow.querySelectorAll(".tag")).toHaveLength(1);
  expect(testRow.querySelector(".tag")!.textContent).toBe("Active");
  expect(testRow.querySelector(".playlist-account-status")).toBeNull();

  // Trial keeps its badge beside the name and expiry plus compact connections.
  const trial = rowFor("Trial");
  expect(trial.querySelector(".playlist-state-tag")?.textContent).toContain("trial");
  const trialStatus = trial.querySelector<HTMLElement>(".playlist-account-status")!;
  expect(trialStatus).toBeTruthy();
  expect(trialStatus.children.length).toBeLessThanOrEqual(2);
  expect(trialStatus.textContent).toContain("Expires");
  expect(trialStatus.textContent).toContain("1/2 connections");

  // Expired and inactive accounts keep their badges.
  expect(rowFor("Expired").querySelector(".playlist-state-tag")?.textContent).toContain(
    "Expired",
  );

  // A zero or missing maximum shows the supplied active count only. The
  // connections label is the status element's last child. Scoping to it keeps
  // the expiry date's own slashes out of the ratio checks.
  const connectionsLabel = (name: string) =>
    rowFor(name).querySelector<HTMLElement>(".playlist-account-status")!.lastElementChild!
      .textContent;
  expect(connectionsLabel("Limited")).toBe("3 active connections");
  expect(connectionsLabel("Limited")).not.toContain("/");
  expect(connectionsLabel("Uncapped")).toBe("2 active connections");
  expect(connectionsLabel("Uncapped")).not.toContain("/");

  // Credentials never reach the row.
  for (const name of ["Trial", "Expired", "Limited", "Uncapped"]) {
    const text = rowFor(name).textContent ?? "";
    expect(text).not.toContain("-user");
    expect(text).not.toContain("-secret");
  }
});

test("playlist reset clears only the selected playlist's saved customisations", async () => {
  const writes: Array<{ playlistId: string; value: StoredLineupV1 }> = [];
  const seed: StoredLineupV1 = {
    version: 1,
    revision: 1,
    personalisation: {
      channels: {},
      categories: {},
      categoryOrderModes: { live: "custom", movie: "provider", series: "provider" },
      categoryOrders: {
        live: [{ itemId: "Sport", beforeId: "News" }],
        movie: [],
        series: [],
      },
      personalCategories: [{ id: "mine", name: "Mine", channels: [] }],
    },
  };
  await mountApp(PLAYLIST, {
    personalLineup: seed,
    personalWrite: (playlistId: string, value: unknown) => {
      const saved = value as StoredLineupV1;
      writes.push({ playlistId, value: saved });
      Object.assign(seed, saved);
      return Promise.resolve();
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  const { usePersonal } = await import("../src/stores/personal");
  const { useChannels } = await import("../src/stores/channels");
  const { useLineup } = await import("../src/stores/lineup");
  const { useLibrary } = await import("../src/stores/library");
  const secondPlaylist = `#EXTM3U
#EXTINF:-1 tvg-id="a" group-title="News",Alpha
http://example.invalid/a.m3u8
#EXTINF:-1 tvg-id="b" group-title="Sport",Beta
http://example.invalid/b.m3u8`;
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  const secondId = useSettings.getState().playlists.find((item) => item.name === "Second")!.id;
  act(() => {
    usePersonal.setState({
      favourites: [
        {
          itemKey: "keep-me",
          playlistId: secondId,
          kind: "live",
          providerId: "a",
          categoryKey: "News",
          name: "Alpha",
          logo: "",
        },
      ],
      progress: [{ itemKey: "keep-progress", seconds: 12, duration: 120, legacyOrder: 0 }],
      lastPlayed: {
        playlistId: secondId,
        kind: "live",
        itemKey: "keep-me",
        categoryKey: "News",
      },
    });
  });
  vi.mocked(fetch).mockImplementation(
    async (input) =>
      ({
        ok: true,
        text: async () =>
          String(input).includes("second.invalid") ? secondPlaylist : PLAYLIST,
      }) as Response,
  );
  await settle(0);

  const activeId = useSettings.getState().activePlaylistId;
  const activeSource = useSettings.getState().activePlaylist()?.source;
  const lineupPlaylist = useLineup.getState().playlistId;
  const lineupProvider = useLineup.getState().provider;
  const lineupCategories = useLineup.getState().categories;
  const channelRows = useChannels.getState().channels;
  const libraryPlaylist = useLibrary.getState().playlistId;
  const libraryCategories = useLibrary.getState().categories;
  const libraryItems = useLibrary.getState().categoryItems;
  const favourites = usePersonal.getState().favourites.map((item) => ({ ...item }));
  const progress = usePersonal.getState().progress.map((item) => ({ ...item }));
  const lastPlayed = { ...usePersonal.getState().lastPlayed! };
  const playCount = playCalls.length;
  const assertActiveUnchanged = () => {
    expect(useSettings.getState().activePlaylistId).toBe(activeId);
    expect(useSettings.getState().activePlaylist()?.source).toBe(activeSource);
    expect(useLineup.getState().playlistId).toBe(lineupPlaylist);
    expect(useLineup.getState().provider).toBe(lineupProvider);
    expect(useLineup.getState().categories).toBe(lineupCategories);
    expect(useChannels.getState().channels).toBe(channelRows);
    expect(useLibrary.getState().playlistId).toBe(libraryPlaylist);
    expect(useLibrary.getState().categories).toBe(libraryCategories);
    expect(useLibrary.getState().categoryItems).toBe(libraryItems);
    expect(usePersonal.getState().favourites).toEqual(favourites);
    expect(usePersonal.getState().progress).toEqual(progress);
    expect(usePersonal.getState().lastPlayed).toEqual(lastPlayed);
    expect(playCalls.length).toBe(playCount);
  };
  const categoryKeys = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".lineup-manager-list [data-settings-focus^='lineup-open-']",
      ),
    ].map((row) => row.dataset.settingsFocus!.slice("lineup-open-".length));

  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  const secondRow = quickPlaylistAction("activate", "Second").closest<HTMLElement>(".pl")!;
  fireEvent.click(secondRow.querySelector<HTMLButtonElement>(".pl-open")!);
  await settle(700);
  expect(categoryKeys()).toEqual(["Sport", "News"]);
  assertActiveUnchanged();

  press(KEY.BACK);
  await settle(0);
  const writesBeforeReset = writes.length;
  await openPlaylistMenu("Second");
  await chooseMenuItem("reset");
  await settle(0);
  const dialog = document.querySelector<HTMLElement>(".dialog")!;
  expect(dialog.textContent).toContain("Reset Second to default?");
  expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset to default" }));
  await settle(1500);

  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions, Second" }));
  const resetWrites = writes.slice(writesBeforeReset);
  expect(resetWrites).toHaveLength(1);
  expect(resetWrites[0].playlistId).toBe(secondId);
  expect(resetWrites[0].value.personalisation).toEqual(emptyPersonalisation());
  assertActiveUnchanged();

  const reopenedRow = quickPlaylistAction("activate", "Second").closest<HTMLElement>(".pl")!;
  fireEvent.click(reopenedRow.querySelector<HTMLButtonElement>(".pl-open")!);
  await settle(700);
  expect(categoryKeys()).toEqual(["News", "Sport"]);
  assertActiveUnchanged();
});

test("a pending playlist reset holds its confirmation until the write settles", async () => {
  const writes: unknown[] = [];
  const gates: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  let hold = false;
  await mountApp(PLAYLIST, {
    personalLineup: {
      version: 1,
      revision: 1,
      personalisation: {
        channels: {},
        categories: {},
        categoryOrderModes: {
          live: "custom",
          movie: "provider",
          series: "provider",
        },
        categoryOrders: { live: [], movie: [], series: [] },
        personalCategories: [{ id: "mine", name: "Mine", channels: [] }],
      },
    },
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      if (!hold) return Promise.resolve();
      return new Promise<void>((resolve, reject) => gates.push({ resolve, reject }));
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  await openPlaylistMenu("Second");
  await chooseMenuItem("reset");
  await settle(0);
  const dialog = () => document.querySelector<HTMLElement>(".dialog")!;
  const cancel = () =>
    within(dialog()).getByRole<HTMLButtonElement>("button", { name: "Cancel" });
  const confirm = () =>
    within(dialog()).getByRole<HTMLButtonElement>("button", { name: "Reset to default" });
  expect(document.activeElement).toBe(cancel());
  const slot = confirm().querySelector(".confirm-action-icon");
  expect(slot).toBeTruthy();
  const label = confirm().textContent;

  hold = true;
  fireEvent.click(confirm());
  await settle(1500);
  expect(cancel().disabled).toBe(true);
  expect(confirm().disabled).toBe(true);
  expect(document.activeElement).toBe(dialog());
  expect(dialog().getAttribute("aria-busy")).toBe("true");
  expect(confirm().querySelector(".confirm-action-icon")).toBe(slot);
  expect(confirm().textContent).toBe(label);
  expect(gates.length).toBeGreaterThan(0);

  // While the write is in flight no dismissal route answers or resubmits.
  const writeCount = writes.length;
  press(KEY.ENTER);
  press(KEY.BACK);
  press(KEY.ESC);
  fireEvent.click(document.querySelector<HTMLElement>(".dialog-scrim")!);
  act(() => {
    vi.advanceTimersByTime(60000);
  });
  await settle(0);
  expect(document.querySelector(".dialog")).toBeTruthy();
  expect(writes.length).toBe(writeCount);

  // A rejected write rolls the durable values back and keeps the prompt with
  // the persistence explanation. Retrying submits a fresh write.
  await act(async () => {
    for (const gate of gates.splice(0)) gate.reject(new Error("quota"));
  });
  await settle(1000);
  expect(dialog().textContent).toContain("could not be saved");
  expect(cancel().disabled).toBe(false);
  expect(confirm().disabled).toBe(false);

  fireEvent.click(confirm());
  await settle(1500);
  expect(gates.length).toBeGreaterThan(0);
  await act(async () => {
    for (const gate of gates.splice(0)) gate.resolve();
  });
  await settle(1500);
  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions, Second" }));
});

test("a playlist reset abandoned by a source change publishes nothing", async () => {
  let releaseFetch: ((response: Response) => void) | undefined;
  const writes: unknown[] = [];
  await mountApp(PLAYLIST, {
    personalWrite: (_id: string, value: unknown) => {
      writes.push(value);
      return Promise.resolve();
    },
    fetchImplementation: (input) => {
      if (String(input).includes("second.invalid")) {
        return new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        });
      }
      return Promise.resolve(new Response(PLAYLIST, { status: 200 }));
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  await openPlaylistMenu("Second");
  await chooseMenuItem("reset");
  await settle(0);
  const dialog = document.querySelector<HTMLElement>(".dialog")!;
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset to default" }));
  await settle(700);

  // The acquisition is still held on the provider read. Change the source.
  expect(releaseFetch).toBeTruthy();
  act(() => {
    useSettings.setState({
      playlists: useSettings
        .getState()
        .playlists.map((playlist) =>
          playlist.name === "Second"
            ? { ...playlist, sourceVersion: (playlist.sourceVersion ?? 0) + 1 }
            : playlist,
        ),
    });
  });
  await settle(0);
  expect(document.querySelector(".dialog")).toBeNull();

  await act(async () => {
    releaseFetch!(new Response(PLAYLIST, { status: 200 }));
  });
  await settle(1200);
  expect(writes).toHaveLength(0);
  expect(document.querySelector(".dialog")).toBeNull();
});

test("content settings keep their switches on the landing with section explanations", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  const manage = document.querySelector<HTMLElement>(".content-manage")!;
  vi.spyOn(manage, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 40));
  press(KEY.ENTER);
  await settle(0);

  expect(manage).toBeTruthy();
  expect(document.activeElement).toBe(manage);

  const switches = [...document.querySelectorAll<HTMLButtonElement>(".switch")];
  expect(switches.map((element) => element.getAttribute("aria-label"))).toEqual([
    "Playlist Shortcut",
    "Hide empty categories",
    "Show Live",
    "Show Movies",
    "Show Series",
  ]);
  const fieldFor = (name: string) =>
    switches.find((element) => element.getAttribute("aria-label") === name)!.closest(".field")!;
  const hintFor = (name: string) => fieldFor(name).querySelector(".field-hint")!.textContent;

  const live = switches.find((element) => element.getAttribute("aria-label") === "Show Live")!;
  expect(live.disabled).toBe(true);
  expect(hintFor("Show Live")).toBe("At least one supported section must stay on.");
  expect(hintFor("Show Movies")).toBe(
    "Available when the active playlist supports this section.",
  );
  expect(hintFor("Show Series")).toBe(
    "Available when the active playlist supports this section.",
  );

  const { useSettings } = await import("../src/stores/settings");
  const before = useSettings.getState().hideEmptyCategories;
  fireEvent.click(
    switches.find((element) => element.getAttribute("aria-label") === "Hide empty categories")!,
  );
  await settle(0);
  expect(useSettings.getState().hideEmptyCategories).toBe(!before);

  fireEvent.click(screen.getByRole("button", { name: "Appearance" }));
  await settle(0);
  expect(document.querySelector(".content-manage")).toBeNull();
  for (const name of ["Hide empty categories", "Show Live", "Show Movies", "Show Series"]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
});

function seedAlphaPlaylists() {
  const seeded = Array.from({ length: 7 }, (_, index) => ({
    id: `pl-alpha-${index + 1}`,
    name: `Alpha ${index + 1}`,
    source: {
      kind: "m3u" as const,
      url: `http://user:s3cr3t-${index + 1}@alpha${index + 1}.invalid/private/path-${index + 1}/list.m3u`,
    },
    sourceVersion: index + 1,
  }));
  return seeded;
}

async function openSavedPlaylists() {
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
}

test("saved playlists page by six and filter by name only", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const seeded = seedAlphaPlaylists();
  act(() => {
    useSettings.setState({
      playlists: seeded,
      activePlaylistId: seeded[0].id,
    });
  });
  await openSavedPlaylists();

  expect(document.querySelectorAll(".pl")).toHaveLength(6);
  const pager = document.querySelector<HTMLElement>(".settings-pagination")!;
  expect(pager.textContent).toContain("1 / 2");
  fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(1);
  expect(document.querySelector(".pl-name")?.textContent).toBe("Alpha 7");
  const lastPageOpen = document.querySelector<HTMLElement>(".pl-line .pl-open:not(:disabled)")!;
  expect(document.activeElement).toBe(lastPageOpen);

  fireEvent.click(
    within(document.querySelector<HTMLElement>(".settings-pagination")!).getByRole("button", {
      name: "Previous",
    }),
  );
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(6);
  const firstPageOpen = document.querySelector<HTMLElement>(
    ".pl-line .pl-open:not(:disabled)",
  )!;
  expect(document.activeElement).toBe(firstPageOpen);

  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-playlist-search-toggle]")!);
  await settle(0);
  const search = document.querySelector<HTMLInputElement>(".playlist-search-field")!;
  fireEvent.change(search, { target: { value: "alpha 3" } });
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(1);
  expect(document.querySelector(".pl-name")?.textContent).toBe("Alpha 3");

  fireEvent.change(search, { target: { value: "s3cr3t" } });
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(0);
  expect(document.querySelector(".empty")?.textContent).toBe("No matching items.");
  const body = document.querySelector(".settings-list-body")!;
  expect(body.innerHTML).not.toContain("s3cr3t");
  expect(body.innerHTML).not.toContain("private");
  expect(body.innerHTML).not.toContain("alpha1.invalid");
});

test("the saved list keeps its query and page across details and clamps removals", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const seeded = seedAlphaPlaylists();
  act(() => {
    useSettings.setState({
      playlists: seeded,
      activePlaylistId: seeded[0].id,
    });
  });
  await openSavedPlaylists();

  fireEvent.click(document.querySelector<HTMLButtonElement>("[data-playlist-search-toggle]")!);
  await settle(0);
  const search = document.querySelector<HTMLInputElement>(".playlist-search-field")!;
  fireEvent.change(search, { target: { value: "alpha" } });
  await settle(0);
  const pager = document.querySelector<HTMLElement>(".settings-pagination")!;
  fireEvent.click(within(pager).getByRole("button", { name: "Next" }));
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(1);
  expect(document.querySelector(".pl-name")?.textContent).toBe("Alpha 7");
  expect(document.activeElement).toBe(
    document.querySelector(".pl-line .pl-open:not(:disabled)"),
  );

  // Enter on the focused search field must not move the route, the query,
  // the focus or the caret.
  search.focus();
  fireEvent.change(search, { target: { value: "alph" } });
  search.setSelectionRange(1, 3);
  await settle(0);
  press(KEY.ENTER);
  await settle(0);
  expect(document.querySelector(".playlist-list-header")).toBeTruthy();
  expect(document.querySelector<HTMLInputElement>(".playlist-search-field")!.value).toBe(
    "alph",
  );
  expect(document.activeElement).toBe(search);
  expect(search.selectionStart).toBe(1);
  expect(search.selectionEnd).toBe(3);

  // Re-filter to the full set and return to the last page before opening.
  fireEvent.change(search, { target: { value: "alpha" } });
  await settle(0);
  fireEvent.click(
    within(document.querySelector<HTMLElement>(".settings-pagination")!).getByRole("button", {
      name: "Next",
    }),
  );
  await settle(0);
  const open = document.querySelector<HTMLElement>(".pl .pl-open")!;
  fireEvent.click(open);
  await settle(0);
  await settle(0);
  expect(document.querySelector(".lineup-manager")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  await settle(0);
  expect(document.querySelector<HTMLInputElement>(".playlist-search-field")!.value).toBe(
    "alpha",
  );
  expect(document.querySelector<HTMLElement>(".settings-pagination")!.textContent).toContain(
    "2 / 2",
  );
  expect(document.querySelectorAll(".pl")).toHaveLength(1);
  expect(document.querySelector(".pl-name")?.textContent).toBe("Alpha 7");

  // Removing the sole row on the last filtered page clamps back to one page.
  openRowMenu("Alpha 7");
  await settle(0);
  await chooseMenuItem("remove");
  const question = document.querySelector<HTMLElement>(".dialog")!;
  fireEvent.click(within(question).getByRole("button", { name: "Remove" }));
  await settle(0);
  await settle(0);
  expect(document.querySelectorAll(".pl")).toHaveLength(6);
  expect(document.querySelector(".settings-pagination")).toBeNull();
  expect(document.querySelector<HTMLInputElement>(".playlist-search-field")!.value).toBe(
    "alpha",
  );

  // Removing the last source returns to onboarding.
  act(() => {
    useSettings.setState({ playlists: [], activePlaylistId: "" });
  });
  await settle(0);
  expect(document.querySelector(".onboard")).toBeTruthy();
});

test("saved search Down reaches the row and Return steps back through the toggle", async () => {
  await mountApp(PLAYLIST);
  const { useSettings } = await import("../src/stores/settings");
  const seeded = seedAlphaPlaylists();
  act(() => {
    useSettings.setState({
      playlists: seeded,
      activePlaylistId: seeded[0].id,
    });
  });
  await openSavedPlaylists();

  const toggle = document.querySelector<HTMLButtonElement>("[data-playlist-search-toggle]")!;
  fireEvent.click(toggle);
  await settle(0);
  const field = document.querySelector<HTMLInputElement>(".playlist-search-field")!;
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "alpha 1" } });
  await settle(0);
  press(KEY.DOWN);
  await settle(0);
  expect(document.activeElement).toBe(document.querySelector(".pl .pl-open"));
  field.focus();
  press(KEY.BACK);
  await settle(0);
  expect(document.activeElement).toBe(toggle);
  expect(document.querySelector(".playlist-search-field")).toBe(field);
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".playlist-search-field")).toBeNull();
  expect(document.querySelector(".playlist-list-header")).toBeTruthy();
  expect(document.querySelectorAll(".pl")).toHaveLength(6);
  expect(document.activeElement).toBe(toggle);
  press(KEY.BACK);
  await settle(0);
  await settle(0);
  expect(document.querySelector(".playlist-list-header")).toBeNull();
  expect(screen.getByRole("button", { name: "Open, Manage playlists" })).toBeTruthy();
});

test.each([0, 180])(
  "saved playlists focuses the first row on entry with %ims of motion",
  async (motion) => {
    await mountApp(PLAYLIST);
    const { useSettings } = await import("../src/stores/settings");
    const seeded = seedAlphaPlaylists();
    act(() => {
      useSettings.setState({
        playlists: seeded,
        activePlaylistId: seeded[0].id,
      });
    });
    press(KEY.YELLOW);
    fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
    await settle(0);
    document.documentElement.style.setProperty("--t-navigation", `${motion}ms`);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
      await settle(0);
      if (motion) {
        await settle(400);
        await settle(64);
        await settle(400);
      }
      await settle(0);

      const firstOpen = document.querySelector<HTMLButtonElement>(".pl .pl-open")!;
      expect(firstOpen).toBeTruthy();
      expect(firstOpen.disabled).toBe(false);
      expect(document.activeElement).toBe(firstOpen);
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

test("playlist content tabs are usable as soon as their Settings page opens", async () => {
  await mountXtream();
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(document.querySelector<HTMLButtonElement>(".pl .pl-open")!);
    await settle(0);
    expect(document.querySelector(".sheet .content-transition-shade")).toBeNull();
    const live = screen.getByRole("tab", { name: "Live" });
    expect(document.activeElement).toBe(live);
    const movies = screen.getByRole("tab", { name: "Movies" });
    expect(document.activeElement).toBe(live);
    fireEvent.click(movies);
    expect(live.getAttribute("aria-selected")).toBe("false");
    expect(movies.getAttribute("aria-selected")).toBe("true");
    await settle(0);
    expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("playlist management focuses its first row once a held acquisition lands", async () => {
  let releaseFetch: ((response: Response) => void) | undefined;
  await mountApp(PLAYLIST, {
    fetchImplementation: (input) => {
      if (String(input).includes("second.invalid")) {
        return new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        });
      }
      return Promise.resolve(new Response(PLAYLIST, { status: 200 }));
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const secondRow = [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
    row.textContent?.includes("Second"),
  )!;
  const openSecond = secondRow.querySelector<HTMLElement>(".pl-open")!;

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(openSecond);
    await settle(300);
    const loading = document.querySelector<HTMLElement>(".lineup-manager-loading")!;
    expect(loading).toBeTruthy();
    expect(loading.hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(document.querySelector("[data-settings-edge-back]"));

    await act(async () => {
      releaseFetch!(new Response(PLAYLIST, { status: 200 }));
    });
    await settle(400);
    await settle(64);
    await settle(400);
    await settle(0);

    const firstRow = document.querySelector<HTMLElement>(
      ".lineup-manager-list .lineup-row-open",
    )!;
    expect(firstRow).toBeTruthy();
    expect(document.activeElement).toBe(firstRow);

    const opener = firstRow.getAttribute("data-settings-focus")!;
    fireEvent.click(firstRow);
    await settle(300);
    await settle(400);
    await settle(64);
    await settle(400);
    await settle(0);
    expect(document.querySelector(".lineup-manager-list")).toBeTruthy();
    press(KEY.BACK);
    await settle(300);
    await settle(0);
    const restored = document.querySelector<HTMLElement>(`[data-settings-focus="${opener}"]`)!;
    expect(restored).toBeTruthy();
    expect(document.activeElement).toBe(restored);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("playlist entry focuses the selected content tab when the source has tabs", async () => {
  await mountXtream();
  await openContent();
  await settle(0);
  expect(document.querySelector(".lineup-manager-list .lineup-row-open")).toBeTruthy();
  await settle(0);
  const selectedTab = document.querySelector<HTMLElement>(
    '.category-kind-selector [role="tab"][aria-selected="true"]',
  )!;
  expect(selectedTab).toBeTruthy();
  expect(document.activeElement).toBe(selectedTab);
});

test("a pending lineup acquisition keeps a deliberately chosen focus target", async () => {
  let releaseFetch: ((response: Response) => void) | undefined;
  await mountApp(PLAYLIST, {
    fetchImplementation: (input) => {
      if (String(input).includes("second.invalid")) {
        return new Promise<Response>((resolve) => {
          releaseFetch = resolve;
        });
      }
      return Promise.resolve(new Response(PLAYLIST, { status: 200 }));
    },
  });
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Second", {
      kind: "m3u",
      url: "http://second.invalid/list.m3u",
    });
  });
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);

  const secondRow = [...document.querySelectorAll<HTMLElement>(".pl")].find((row) =>
    row.textContent?.includes("Second"),
  )!;

  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(secondRow.querySelector<HTMLElement>(".pl-open")!);
    await settle(300);
    expect(document.querySelector(".lineup-manager-loading")).toBeTruthy();
    await settle(400);
    await settle(64);
    await settle(400);
    await settle(0);

    const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
    expect(back).toBeTruthy();
    fireEvent.pointerDown(back);
    back.focus();
    expect(document.activeElement).toBe(back);

    await act(async () => {
      releaseFetch!(new Response(PLAYLIST, { status: 200 }));
    });
    await settle(0);
    await settle(0);
    expect(document.querySelector(".lineup-manager-list button")).toBeTruthy();
    expect(document.activeElement).toBe(back);
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

const unavailableRemote = (): RemoteAccessControl => ({
  status: "unavailable",
  address: "",
  port: 0,
  remotePath: "",
  pairing: null,
  pairingError: false,
  connectedDevice: "",
  error: "",
  openPairing: vi.fn(),
  cancelPairing: vi.fn(),
  retry: vi.fn(),
});

test("a recovery entry registers the saved list and its Back before input resumes", async () => {
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.setState({
      locale: "en",
      playlists: [
        {
          id: "pl-1",
          name: "Test",
          source: { kind: "m3u", url: "http://list.invalid/a.m3u" },
          sourceVersion: 1,
        },
      ],
      activePlaylistId: "pl-1",
    });
  });
  const entry = {
    session: 1,
    section: "playlists" as const,
    playlistId: "pl-1",
    loadError: "boom",
  };
  const view = render(
    <Settings
      onClose={vi.fn()}
      remoteAccess={unavailableRemote()}
      entry={entry}
      showRemoteAccess
      inputEnabled={false}
    />,
  );
  await settle(0);

  expect(document.querySelector(".playlist-list-header")?.textContent).toContain(
    "Saved playlists",
  );
  const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
  expect(back).toBeTruthy();
  expect(back.disabled).toBe(true);
  expect(document.querySelector(".lineup-manager")).toBeNull();
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");

  view.rerender(
    <Settings
      onClose={vi.fn()}
      remoteAccess={unavailableRemote()}
      entry={entry}
      showRemoteAccess
      inputEnabled
    />,
  );
  await settle(0);
  expect(document.querySelectorAll("[data-settings-edge-back]")).toHaveLength(1);
  expect(document.querySelector(".playlist-list-header")).toBeTruthy();
  expect(document.querySelector(".content-manage")).toBeNull();
  expect(document.querySelector(".lineup-manager")).toBeNull();
  expect(useSettings.getState().activePlaylistId).toBe("pl-1");

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".content-manage")).toBeTruthy();
});

test("a paired device renames from its row and confirms removal with focus restore", async () => {
  popupGeometry(".sheet", layoutRect(0, 0, 1200, 800), [
    { selector: "button, input", rect: layoutRect(0, 0, 200, 40) },
  ]);
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Kitchen TV" });
  if (!paired.ok) throw new Error("pairing failed");
  const deviceId = paired.deviceId;

  render(
    <Settings
      onClose={vi.fn()}
      remoteAccess={unavailableRemote()}
      entry={{ session: 1, section: "devices" }}
      showRemoteAccess
      inputEnabled
    />,
  );
  await settle(0);
  press(KEY.ENTER);
  await settle();

  const row = document.querySelector<HTMLElement>(".device-row")!;
  expect(row).toBeTruthy();
  expect(row.querySelectorAll("button")).toHaveLength(2);
  const rename = row.querySelector<HTMLElement>("[data-device-rename]")!;
  expect(rename.getAttribute("aria-haspopup")).toBe("dialog");
  expect(row.querySelector("[data-lineup-edit]")).toBeNull();

  act(() => rename.focus());
  await settle(0);
  fireEvent.click(rename);
  await settle(0);
  const editor = document.querySelector<HTMLElement>(".dialog")!;
  expect(editor).toBeTruthy();
  expect(document.querySelector("#device-edit-name")).toBeTruthy();
  fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
  await settle(0);
  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement?.getAttribute("data-device-rename")).toBe(deviceId);

  const revoke = row.querySelector<HTMLElement>("[data-device-revoke]")!;
  fireEvent.click(revoke);
  await settle(0);
  const question = document.querySelector<HTMLElement>(".dialog")!;
  expect(question).toBeTruthy();
  const cancel = within(question).getByRole("button", { name: "Cancel" });
  expect(document.activeElement).toBe(cancel);
  fireEvent.click(cancel);
  await settle(0);
  expect(document.querySelector(".dialog")).toBeNull();
  expect(document.activeElement?.getAttribute("data-device-revoke")).toBe(deviceId);
  expect(listPairedDevices()).toHaveLength(1);
});

test.each([
  { query: "", nextPages: 2, motion: 0 },
  { query: "", nextPages: 2, motion: 180 },
  { query: "Group 4", nextPages: 0, motion: 0 },
  { query: "Group 4", nextPages: 0, motion: 180 },
])(
  "Back restores the category opener with query '$query' and $motion ms motion",
  async ({ query, nextPages, motion }) => {
    const playlist =
      "#EXTM3U\n" +
      Array.from({ length: 45 }, (_, index) => {
        const id = index + 1;
        const group = `Group ${String(id).padStart(2, "0")}`;
        return `#EXTINF:-1 tvg-id="c${id}" group-title="${group}",Channel ${id}\nhttp://example.invalid/${id}.m3u8`;
      }).join("\n");
    await mountApp(playlist);
    await openContent();
    if (query) {
      fireEvent.click(document.querySelector<HTMLElement>('[data-lineup-action="search"]')!);
      await settle(0);
      fireEvent.change(document.querySelector<HTMLInputElement>(".lineup-search-input")!, {
        target: { value: query },
      });
      await settle(200);
    }
    for (let page = 0; page < nextPages; page += 1) {
      fireEvent.click(
        document.querySelector<HTMLButtonElement>(".lineup-pagination button:last-child")!,
      );
      await settle(0);
    }
    const opener = [
      ...document.querySelectorAll<HTMLButtonElement>(".lineup-manager-list .lineup-row-open"),
    ].find((button) => button.textContent?.includes("Group 43"))!;
    expect(opener).toBeTruthy();
    const token = opener.dataset.settingsFocus;
    const pageLabel = document.querySelector(".lineup-pagination > span")?.textContent ?? "";
    const scroller = document.querySelector<HTMLElement>(".sheet-body")!;
    act(() => opener.focus());
    scroller.scrollTop = 120;
    document.documentElement.style.setProperty("--t-navigation", `${motion}ms`);
    try {
      fireEvent.click(opener);
      await settle(300);
      await settle(64);
      await settle(300);
      expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
        "channels",
      );
      press(KEY.BACK);
      const expectParent = () => {
        expect(
          document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope"),
        ).toBe("categories");
        const restored = [
          ...document.querySelectorAll<HTMLElement>("[data-settings-focus]"),
        ].find((element) => element.dataset.settingsFocus === token);
        expect(restored).toBeTruthy();
        expect(document.activeElement).toBe(restored);
        expect(
          document.querySelector<HTMLInputElement>(".lineup-search-input")?.value ?? "",
        ).toBe(query);
        expect(document.querySelector(".lineup-pagination > span")?.textContent ?? "").toBe(
          pageLabel,
        );
        expect(scroller.scrollTop).toBe(120);
      };
      expectParent();
      await settle(700);
      expectParent();
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

test.each([0, 180])(
  "content tabs switch immediately without a shade with a %ims motion token",
  async (motion) => {
    await mountXtream();
    await openContent();
    const live = screen.getByRole("tab", { name: "Live" });
    const movies = screen.getByRole("tab", { name: "Movies" });
    const tabs = document.querySelector<HTMLElement>(".category-kind-selector")!;
    const pane = document.querySelector<HTMLElement>(".lineup-tab-pane[role='tabpanel']")!;
    expect(pane.querySelector(".content-transition-shade")).toBeNull();
    expect(document.querySelector(".sheet-page > .content-transition-shade")).toBeNull();
    const heading = document.querySelector<HTMLElement>(
      ".lineup-manager > .settings-page-header",
    )!;
    const breadcrumbs = document.querySelector<HTMLElement>(
      ".lineup-manager > .settings-breadcrumbs",
    )!;
    const { useLineup } = await import("../src/stores/lineup");
    const revision = useLineup.getState().revision;
    expect(tabs).toBeTruthy();
    expect(heading).toBeTruthy();
    expect(breadcrumbs).toBeTruthy();
    expect(pane.contains(tabs)).toBe(false);
    expect(pane.contains(heading)).toBe(false);
    expect(pane.contains(breadcrumbs)).toBe(false);
    document.documentElement.style.setProperty("--t-navigation", `${motion}ms`);
    try {
      fireEvent.click(movies);
      expect(movies.getAttribute("aria-selected")).toBe("true");
      expect(live.getAttribute("aria-selected")).toBe("false");
      await settle(0);
      expect(movies.getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");
      expect(useLineup.getState().revision).toBe(revision);
      expect(document.querySelector(".sheet .content-transition-shade")).toBeNull();
      expect(document.querySelector(".category-kind-selector")).toBe(tabs);
      expect(document.querySelector(".lineup-manager > .settings-page-header")).toBe(heading);
      expect(document.querySelector(".lineup-manager > .settings-breadcrumbs")).toBe(
        breadcrumbs,
      );
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

test("rapid content tab activations keep only the last intent selected", async () => {
  await mountXtream();
  await openContent();
  await settle(0);
  const live = screen.getByRole("tab", { name: "Live" });
  const movies = screen.getByRole("tab", { name: "Movies" });
  const series = screen.getByRole("tab", { name: "Series" });
  const pane = document.querySelector<HTMLElement>(".lineup-tab-pane[role='tabpanel']")!;
  expect(pane.querySelector(".content-transition-shade")).toBeNull();
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(movies);
    await settle(0);
    expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");
    fireEvent.click(series);
    await settle(0);
    expect(series.getAttribute("aria-selected")).toBe("true");
    expect(movies.getAttribute("aria-selected")).toBe("false");
    expect(live.getAttribute("aria-selected")).toBe("false");
    const list = document.querySelector(".lineup-manager-list")?.textContent ?? "";
    expect(list).toContain("Shows");
    expect(list).not.toContain("Cinema");
    expect(series.getAttribute("aria-selected")).toBe("true");
    expect(movies.getAttribute("aria-selected")).toBe("false");
    expect(live.getAttribute("aria-selected")).toBe("false");
    expect(pane.querySelector(".content-transition-shade")).toBeNull();
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("reselecting Live after Movies restores its content immediately", async () => {
  await mountXtream();
  await openContent();
  await settle(0);
  const live = screen.getByRole("tab", { name: "Live" });
  const movies = screen.getByRole("tab", { name: "Movies" });
  const pane = document.querySelector<HTMLElement>(".lineup-tab-pane[role='tabpanel']")!;
  expect(pane.querySelector(".content-transition-shade")).toBeNull();
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(movies);
    await settle(0);
    expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");
    expect(movies.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(live);
    await settle(0);
    expect(live.getAttribute("aria-selected")).toBe("true");
    expect(movies.getAttribute("aria-selected")).toBe("false");
    expect(pane.querySelector(".content-transition-shade")).toBeNull();
    const list = document.querySelector(".lineup-manager-list")?.textContent ?? "";
    expect(list).toContain("News");
    expect(list).not.toContain("Cinema");
    expect(live.getAttribute("aria-selected")).toBe("true");
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("suspending settings preserves the kind that was switched immediately", async () => {
  await mountXtream();
  await openContent();
  await settle(0);
  const live = screen.getByRole("tab", { name: "Live" });
  const movies = screen.getByRole("tab", { name: "Movies" });
  document.documentElement.style.setProperty("--t-navigation", "180ms");
  try {
    fireEvent.click(movies);
    await settle(0);
    expect(movies.getAttribute("aria-selected")).toBe("true");

    fireEvent.pointerDown(document.body, { pointerId: 1 });
    const settingsNav = document.querySelector<HTMLElement>(
      "[data-navigation-action='settings']",
    )!;
    expect(settingsNav).toBeTruthy();
    fireEvent.pointerOver(settingsNav, { pointerId: 1 });
    await settle(0);
    await settle(0);
    expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(true);
    const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
    expect(back.disabled).toBe(true);
    fireEvent.click(back);
    expect(document.querySelector(".lineup-manager")).toBeTruthy();
    expect(live.getAttribute("aria-selected")).toBe("false");
    expect(movies.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".lineup-manager-list")?.textContent).toContain("Cinema");

    press(KEY.RIGHT);
    await settle(0);
    expect(document.querySelector(".sheet")?.classList.contains("input-suspended")).toBe(false);
    expect(live.getAttribute("aria-selected")).toBe("false");
    expect(movies.getAttribute("aria-selected")).toBe("true");
  } finally {
    document.documentElement.style.removeProperty("--t-navigation");
  }
});

test("supported section descriptions name their content and menu scope", async () => {
  await mountXtream();
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  for (const [label, content] of [
    ["Show Live", "Live"],
    ["Show Movies", "Movies"],
    ["Show Series", "Series"],
  ]) {
    const control = [...document.querySelectorAll<HTMLButtonElement>(".switch")].find(
      (button) => button.getAttribute("aria-label") === label,
    )!;
    expect(control.closest(".field")?.querySelector(".field-hint")?.textContent).toBe(
      `Include ${content} in the main menu and search results.`,
    );
  }
});

test.each(["physical", "edge OK", "edge click"])(
  "Back after an immediate nested detail returns one level via %s",
  async (method) => {
    await mountApp(REORDER_PLAYLIST);
    await openContent();
    await settle(0);
    document.documentElement.style.setProperty("--t-navigation", "180ms");
    try {
      const back = document.querySelector<HTMLButtonElement>("[data-settings-edge-back]")!;
      await openFirstCategory();
      expect(document.querySelector(".sheet .content-transition-shade")).toBeNull();
      expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
        "channels",
      );
      if (method !== "physical") act(() => back.focus());

      if (method === "physical") press(KEY.BACK);
      else {
        expect(document.activeElement).toBe(back);
        expect(back.disabled).toBe(false);
        if (method === "edge OK") press(KEY.ENTER);
        else fireEvent.click(back);
      }
      expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
        "categories",
      );

      await settle(700);
      expect(document.querySelector(".lineup-manager")?.getAttribute("data-lineup-scope")).toBe(
        "categories",
      );
    } finally {
      document.documentElement.style.removeProperty("--t-navigation");
    }
  },
);

const vodItemFixture = (kind: "movie" | "series") => {
  const categoryId = kind === "movie" ? "10" : "20";
  const items = ["Beta", "Alpha"].map((name, index) => ({
    stream_id: String(100 + index),
    series_id: String(100 + index),
    category_id: categoryId,
    name,
    container_extension: "mp4",
  }));
  const bodies: Record<string, unknown> = {
    authenticate: {
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    },
    get_live_categories: [{ category_id: "1", category_name: "News" }],
    get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live" }],
    get_vod_categories:
      kind === "movie" ? [{ category_id: categoryId, category_name: "Cinema" }] : [],
    get_vod_streams: kind === "movie" ? items : [],
    get_series_categories:
      kind === "series" ? [{ category_id: categoryId, category_name: "Shows" }] : [],
    get_series: kind === "series" ? items : [],
  };
  const itemsAction = kind === "movie" ? "get_vod_streams" : "get_series";
  const categoryName = kind === "movie" ? "Cinema" : "Shows";
  return { bodies, items, itemsAction, categoryName };
};

const mountVodManager = async (
  kind: "movie" | "series",
  itemsHandler: (action: string) => Promise<unknown>,
) => {
  const fixture = vodItemFixture(kind);
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: async (input) => {
      const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
      const handled = await itemsHandler(action);
      if (handled !== undefined) return handled;
      if (!(action in fixture.bodies)) throw new Error(`Unexpected fixture action ${action}`);
      return new Response(JSON.stringify(fixture.bodies[action]), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  await openContent();
  await settle(0);
  fireEvent.click(screen.getByRole("tab", { name: kind === "movie" ? /^Movies/ : /^Series/ }));
  await settle(0);
  await openCategory(fixture.categoryName);
  return fixture;
};

test.each([{ kind: "movie" as const }, { kind: "series" as const }])(
  "clearing a $kind management search restores every item in custom order",
  async ({ kind }) => {
    await mountVodManager(kind, async () => undefined);
    await settle(700);
    const labels = () =>
      [...document.querySelectorAll(".lineup-manager-list .category-manager-main")].map(
        (node) => node.textContent,
      );
    expect(labels()).toEqual(["Beta", "Alpha"]);

    await enterReorder();
    const first = document.querySelector<HTMLButtonElement>(".lineup-sort-row")!;
    fireEvent.click(first);
    press(KEY.DOWN);
    fireEvent.click(first);
    await settle(700);
    press(KEY.BACK);
    await settle(0);
    expect(labels()).toEqual(["Alpha", "Beta"]);

    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-lineup-action="search"]')!,
    );
    const input = document.querySelector<HTMLInputElement>(".lineup-search-input")!;
    fireEvent.change(input, { target: { value: "Beta" } });
    await settle(150);
    expect(labels()).toEqual(["Beta"]);
    fireEvent.change(input, { target: { value: "" } });
    await settle(150);
    expect(labels()).toEqual(["Alpha", "Beta"]);
    expect(orderValueLabel()).toBe("Custom Order");
  },
);

test.each([{ kind: "movie" as const }, { kind: "series" as const }])(
  "a delayed $kind catalogue shows loading instead of an empty list, then its items",
  async ({ kind }) => {
    const fixture = vodItemFixture(kind);
    let releaseItems: ((response: Response) => void) | null = null;
    const itemGate = new Promise<Response>((resolve) => {
      releaseItems = resolve;
    });
    await mountVodManager(kind, async (action) =>
      action === fixture.itemsAction ? itemGate : undefined,
    );

    const pending = document.querySelector(".lineup-manager-pending");
    expect(pending?.getAttribute("role")).toBe("status");
    expect(pending?.textContent).toContain("Loading…");
    expect(document.querySelector(".lineup-manager-results .sheet-lead")).toBeNull();
    expect(document.querySelector(".lineup-manager-failed")).toBeNull();

    await act(async () => {
      releaseItems?.(
        new Response(JSON.stringify(fixture.items), {
          headers: { "Content-Type": "application/json" },
        }),
      );
      await Promise.resolve();
    });
    await settle(0);

    expect(document.querySelector(".lineup-manager-pending")).toBeNull();
    const results = document.querySelector(".lineup-manager-results")!;
    expect(results.textContent).toContain("Alpha");
    expect(results.textContent).toContain("Beta");
    expect(document.querySelector(".lineup-manager-results .sheet-lead")).toBeNull();
  },
);

test.each([{ kind: "movie" as const }, { kind: "series" as const }])(
  "a failed $kind catalogue keeps Retry and recovers on retry",
  async ({ kind }) => {
    const fixture = vodItemFixture(kind);
    let itemCalls = 0;
    await mountVodManager(kind, async (action) => {
      if (action !== fixture.itemsAction) return undefined;
      itemCalls += 1;
      if (itemCalls === 1) throw new Error("provider down");
      return new Response(JSON.stringify(fixture.items), {
        headers: { "Content-Type": "application/json" },
      });
    });
    await settle(0);

    const failed = document.querySelector(".lineup-manager-failed");
    expect(failed?.getAttribute("role")).toBe("alert");
    expect(failed?.textContent).toContain("The provider catalogue could not be loaded.");
    expect(document.querySelector(".lineup-manager-results .sheet-lead")).toBeNull();

    fireEvent.click(within(failed as HTMLElement).getByRole("button", { name: "Retry" }));
    await settle(0);

    expect(itemCalls).toBe(2);
    expect(document.querySelector(".lineup-manager-failed")).toBeNull();
    const results = document.querySelector(".lineup-manager-results")!;
    expect(results.textContent).toContain("Alpha");
    expect(results.textContent).toContain("Beta");
  },
);

test("the active playlist menu skips its disabled Activate for focus, arrows and Tab", async () => {
  await mountApp(PLAYLIST);
  press(KEY.YELLOW);
  fireEvent.click(screen.getByRole("button", { name: "Content & playlists" }));
  await settle(0);
  fireEvent.click(screen.getByRole("button", { name: "Open, Manage playlists" }));
  await settle(0);
  await settle(0);
  mockBodyRects();

  await openPlaylistMenu();
  const action = () => (document.activeElement as HTMLElement | null)?.dataset?.settingsAction;
  const activate = menuItem("activate")!;
  expect(activate.disabled).toBe(true);
  expect(activate.getAttribute("aria-disabled")).toBe("true");
  expect(action()).toBe("refresh");

  press(KEY.DOWN);
  expect(action()).toBe("edit");
  press(KEY.UP);
  expect(action()).toBe("refresh");
  press(KEY.UP);
  expect(action()).not.toBe("activate");
  expect(openActionMenu()).toBeTruthy();

  const close = within(openActionMenu()!).getByRole("button", { name: "Close" });
  close.focus();
  fireEvent.keyDown(close, { key: "Tab" });
  expect(action()).toBe("refresh");
  fireEvent.keyDown(menuItem("refresh")!, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(close);
});
