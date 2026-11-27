import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";

interface RemoteApp {
  start(): Promise<void>;
  parsePairSecret(): string;
  sendCommandForTest(
    command: object,
    setup: boolean,
    source: HTMLElement | null,
  ): Promise<boolean>;
  renderManageForTest(message?: string, failed?: boolean, keepBusy?: boolean): void;
  replaceAuthForTest(next: { deviceId: string; credential: string }): void;
  loadLineupPage(nav: string, restoreSortFocus?: boolean): Promise<void>;
  sendLineupMutation(
    mutation: object,
    source: HTMLElement | null,
    options?: { keepPage?: boolean; keepReorder?: boolean },
  ): Promise<boolean>;
  showNotificationForTest(message: string, kind: string): void;
}

type CapturedLineupMutation = {
  id: string;
  playlistId: string;
  sourceVersion: number;
  revision: number;
  mutation: Record<string, unknown> & { type: string };
};

const labels = {
  title: "OpenIPTV",
  pairTitle: "Connect to your TV",
  pairBody: "Keep OpenIPTV open on your television.",
  deviceName: "Device name",
  code: "Pairing code",
  pair: "Connect",
  setupTitle: "Add your first playlist",
  playlistName: "Playlist name",
  playlistAddress: "Playlist address",
  m3uPlaylist: "M3U playlist",
  xtreamLogin: "Xtream login",
  serverAddress: "Server address",
  username: "Username",
  password: "Password",
  streamFormat: "Stream format",
  hls: "HLS (Recommended)",
  mpegTs: "MPEG TS",
  language: "Language",
  finish: "Finish setup",
  setupCompleteTitle: "Your playlist is ready",
  setupCompleteBody:
    "Found 1 channel and added it to OpenIPTV. Continue on your TV, or open Settings here to manage your playlists and preferences.",
  setupFailedTitle: "Couldn’t add this playlist",
  setupLoadFailed: "No channels were found at this address. Check the address and try again.",
  manage: "Settings",
  connecting: "Connecting",
  checkingPlaylist: "Loading the playlist…",
  saving: "Save…",
  saved: "Settings saved.",
  playlists: "Playlists",
  savedPlaylists: "Saved playlists",
  content: "Content & playlists",
  managePlaylists: "Manage playlists",
  searchPlaylists: "Search playlists",
  hideEmptyCategories: "Hide empty categories",
  hideEmptyCategoriesHint: "Categories with nothing in them are left out.",
  playlistShortcut: "Playlist Shortcut",
  playlistShortcutHint: "Show the active playlist in the main menu for quick switching.",
  showLive: "Live TV",
  showMovies: "Movies",
  showSeries: "Series",
  keepSectionHint: "At least one supported section must stay on.",
  sectionUnsupportedHint: "Available when the active playlist supports this section.",
  appearance: "Appearance",
  playback: "Playback",
  devices: "Remote access",
  about: "About",
  aboutVersion: "Version 1.5.0",
  aboutDescription: "A fast, private IPTV player designed for Samsung TVs.",
  aboutDisclaimer: "OpenIPTV does not provide channels or playlists.",
  remoteClose: "Close",
  remoteUp: "Up",
  remoteRight: "Right",
  remoteDown: "Down",
  remoteLeft: "Left",
  remoteSelect: "Select",
  remoteReturn: "Return",
  remotePlayPause: "Play/Pause",
  remoteVolumeUp: "Volume up",
  remoteVolumeDown: "Volume down",
  remoteChannelUp: "Channel up",
  remoteChannelDown: "Channel down",
  remoteRewind: "Rewind",
  remoteFastForward: "Fast forward",
  remoteStop: "Stop",
  remotePlay: "Play",
  remotePrevious: "Track previous",
  remoteNext: "Track next",
  remoteRed: "Red",
  remoteGreen: "Green",
  remoteYellow: "Yellow",
  remoteBlue: "Blue",
  addPlaylist: "Add playlist",
  remove: "Remove",
  active: "Active",
  activate: "Make active",
  actions: "Actions",
  rename: "Rename",
  editCredentials: "Edit credentials",
  editAddress: "Edit playlist address",
  manageContent: "Manage content",
  refresh: "Refresh playlist",
  refreshing: "Refreshing…",
  changeFailed: "The change could not be saved.",
  pairingFailed: "The pairing code is invalid or has expired.",
  revokeSelfConfirm:
    "This is the device you are using. Revoking access will disconnect it, and you will need to pair it again.",
  trustedNetwork:
    "This local HTTP connection is intended only for a trusted private network. Account credentials and stream addresses are never shown.",
  invalidUrl: "That is not a complete web address.",
  cache: "Clear downloaded cache",
  cacheConfirm: "Clear downloaded cache?",
  removeConfirm: "Remove this playlist?",
  clear: "Clear",
  conflict: "Settings changed on another device. Review and try again.",
  unavailable: "The TV is unavailable. Keep OpenIPTV open and try again.",
  revoked: "This device no longer has access.",
  accountActive: "Active",
  accountInactive: "Inactive",
  accountExpired: "Expired",
  accountTrial: "trial",
  accountExpiryUnknown: "Expiry unknown",
  accountExpires: "Expires {date}",
  accountConnections: "{active} of {maximum} connections active",
  accountConnectionsCompact: "{active} of {maximum} connections",
  accountConnectionsOnly: "{active} active connections",
  lastUsed: "Last used {when}",
  thisDevice: "This device",
  lineupSearchToggle: "Search",
  resetToDefault: "Reset to default",
  close: "Close",
};

const publicState = { locale: "en", direction: "ltr", labels };

const snapshot = (change: Record<string, unknown> = {}) => ({
  revision: 0,
  locale: "en",
  direction: "ltr",
  labels,
  localeOptions: [
    { id: "en", label: "English", secondary: "English" },
    { id: "fa", label: "فارسی", secondary: "Persian" },
  ],
  settings: {
    locale: "en",
    fontSizeId: "m",
    showNumbers: true,
    showLogos: true,
    aspectId: "fill",
    showClock: true,
    resumeLast: true,
    compatibility: false,
    continuousReconnect: false,
    hideEmptyCategories: true,
    playlistShortcut: true,
    showLive: true,
    showMovies: true,
    showSeries: true,
  },
  playlists: [
    {
      id: "pl-1",
      name: "News",
      source: { kind: "m3u", url: "http://example.com/list.m3u" },
      sourceVersion: 1,
    },
  ],
  activePlaylistId: "pl-1",
  lineup: null,
  setup: { name: "", source: { kind: "m3u", url: "" } },
  devices: [{ id: "device-1", name: "My device", createdAt: 1, lastUsedAt: 1 }],
  about: { version: "1.5.0", repository: "https://github.com/shayanline/OpenIPTV" },
  operation: { loading: false, error: "", errorKey: "", errorDetail: "" },
  ...change,
});

function reply(status: number, body: unknown) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
}

function deferredReply() {
  let complete!: (status: number, body: unknown) => void;
  const promise = new Promise<Awaited<ReturnType<typeof reply>>>((resolve) => {
    complete = (status, body) => resolve(reply(status, body));
  });
  return { promise, complete };
}

function openPlaylistEdit(id = "pl-1") {
  chooseItemAction("playlist", id, "edit");
}

function removePlaylistFromIndex(id = "pl-1") {
  chooseItemAction("playlist", id, "remove");
}

function itemMenuTrigger(kind: string, id = "") {
  const trigger = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-item-menu]"),
  ).find(
    (element) => element.dataset.itemMenu === kind && (id === "" || element.dataset.id === id),
  );
  if (!trigger) throw new Error(`item menu trigger missing: ${kind}${id ? ` ${id}` : ""}`);
  return trigger;
}

function openItemMenu(kind: string, id = "") {
  const trigger = itemMenuTrigger(kind, id);
  trigger.click();
  return trigger;
}

function itemAction(action: string) {
  const button = document.querySelector<HTMLElement>(`[data-item-action="${action}"]`);
  if (!button) throw new Error(`item action missing: ${action}`);
  return button;
}

function chooseItemAction(kind: string, id: string, action: string) {
  openItemMenu(kind, id);
  itemAction(action).click();
}

function preferenceButton(kind: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-lineup-preference="${kind}"]`,
  );
  if (!button) throw new Error(`lineup preference missing: ${kind}`);
  return button;
}

function orderOption(mode: string) {
  const option = document.querySelector<HTMLButtonElement>(
    `[data-lineup-order-option="${mode}"]`,
  );
  if (!option) throw new Error(`lineup order option missing: ${mode}`);
  return option;
}

async function chooseRemoteOrderMode(mode: string) {
  preferenceButton("order").click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  orderOption(mode).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
  );
}

async function enterRemoteReorder() {
  if (!document.querySelector('[data-lineup-preference="custom-order"]')) {
    await chooseRemoteOrderMode("custom");
  }
  preferenceButton("custom-order").click();
}

function mockRemoteSortViewport() {
  let scroll = 0;
  const box = (top: number, height: number) =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 400,
      width: 400,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    if (this.matches(".manage-top")) return box(0, 80);
    if (this.matches(".lineup-sort-list")) return box(120 - scroll, 4000);
    if (this.matches("[data-lineup-sort]")) return box(9000, 60);
    return original.call(this);
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches(".lineup-sort-item")
      ? Array.prototype.indexOf.call(this.parentElement?.children ?? [], this) * 60
      : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches(".lineup-sort-item") ? 60 : 0;
  });
  vi.stubGlobal("innerHeight", 250);
  const scrollBy = vi
    .spyOn(window, "scrollBy")
    .mockImplementation((options?: ScrollToOptions | number) => {
      if (typeof options === "object") scroll += options.top ?? 0;
    });
  return {
    scrollBy,
    setScroll(value: number) {
      scroll = value;
    },
    scroll: () => scroll,
  };
}

function lineupRowControl(
  rowId: string,
  attribute: "data-lineup-edit" | "data-lineup-visibility",
) {
  const control = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`[${attribute}]`),
  ).find((element) => element.dataset.id === rowId);
  if (!control) throw new Error(`lineup row control missing: ${attribute} ${rowId}`);
  return control;
}

function toggleRemoteRowVisibility(rowId: string) {
  lineupRowControl(rowId, "data-lineup-visibility").click();
}

async function openRemoteRename(rowId: string) {
  lineupRowControl(rowId, "data-lineup-edit").click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeTruthy());
}

function exitRemoteReorder() {
  (document.querySelector("[data-lineup-sort-done]") as HTMLButtonElement).click();
}

function confirmDialog() {
  const dialog = document.querySelector<HTMLElement>("[data-management-confirmation]");
  if (!dialog) throw new Error("management confirmation missing");
  return dialog;
}

function answerConfirmation(accept: boolean) {
  const button = confirmDialog().querySelector<HTMLElement>(
    accept ? "[data-confirm-accept]" : "[data-confirm-cancel]",
  );
  if (!button) throw new Error("confirmation answer missing");
  button.click();
}

async function confirmAndSettle(accept = true) {
  answerConfirmation(accept);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );
}

function lineupRowOpenAction(rowId: string) {
  const open = document.querySelector<HTMLElement>(
    `button[data-item-open="lineup"][data-id="${rowId}"]`,
  );
  if (!open) throw new Error(`lineup row open missing: ${rowId}`);
  open.click();
}

function firstLineupRowOpen() {
  const open = document.querySelector<HTMLElement>('button[data-item-open="lineup"]');
  if (!open) throw new Error("lineup row open missing");
  open.click();
}

function playlistMenuAction(id: string, action: string) {
  chooseItemAction("playlist", id, action);
}

function playlistRowAction(id: string, action: string) {
  if (action === "refresh") {
    playlistMenuAction(id, action);
    return itemMenuTrigger("playlist", id);
  }
  const button = document.querySelector<HTMLElement>(
    `[data-action="playlist-${action}"][data-id="${id}"]`,
  );
  if (!button) throw new Error(`playlist row action missing: ${action} ${id}`);
  button.focus();
  button.click();
  return button;
}

function deviceRowAction(id: string, action: string) {
  const button = document.querySelector<HTMLElement>(
    `[data-action="device-${action}"][data-id="${id}"]`,
  );
  if (!button) throw new Error(`device action missing: ${action} ${id}`);
  button.click();
}

function crumb(label: string) {
  return Array.from(document.querySelectorAll<HTMLAnchorElement>(".crumbs a")).find(
    (link) => link.textContent?.trim() === label,
  ) as HTMLAnchorElement | undefined;
}

function loadApp(): RemoteApp {
  document.body.innerHTML = '<div id="app"></div>';
  (window as unknown as { __OPENIPTV_TEST__: boolean }).__OPENIPTV_TEST__ = true;
  const source = readFileSync(join(process.cwd(), "public/remote/remote.js"), "utf8").replace(
    "    start: start,",
    "    start: start,\n    sendCommandForTest: sendCommand,\n    renderManageForTest: renderManage,\n    replaceAuthForTest: function(next) { auth = next; renderManage(); },\n    showNotificationForTest: showNotification,",
  );
  new Function("window", "document", "localStorage", "fetch", "confirm", source)(
    window,
    document,
    localStorage,
    fetch,
    window.confirm,
  );
  return (window as unknown as { OpenIPTVRemote: RemoteApp }).OpenIPTVRemote;
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  document.documentElement.style.removeProperty("--t-fast");
  vi.restoreAllMocks();
});

test("loads device assets relative to either the TV root or build preview path", () => {
  const html = readFileSync(join(process.cwd(), "public/remote/index.html"), "utf8");
  const css = readFileSync(join(process.cwd(), "public/remote/remote.css"), "utf8");

  expect(html).toContain('href="remote.css"');
  expect(html).toContain('src="remote.js"');
  expect(html).toContain('src="/icon.svg"');
  expect(html).toContain('<div id="app">');
  expect(html).not.toContain("<main");
  expect(css).toContain('@import url("/fonts/fonts.css")');
  expect(css).toContain("font-family: var(--font)");
  expect(css).toContain("@media (max-width: 680px)");
  expect(css).toMatch(/\.manage-nav-link \{[^}]*min-height: 48px;/);
  expect(css).toMatch(/\.item-menu-action \{[^}]*min-height: 52px;/);
  expect(css).toContain(".playlist-card-open");
  expect(css).toContain(".playlist-card-menu");
  expect(css).toMatch(/\.management-row-single \{[^}]*display: flex;[^}]*width: 100%;/);
  expect(css).toContain(".lineup-row-open");
  expect(css).toContain(".lineup-row-menu");
  expect(css).toMatch(
    /\.device-card-info \{[^}]*padding-block:\s*14px;[^}]*padding-inline:\s*16px;/,
  );
  expect(css).toMatch(
    /\.lineup-row-open \{[^}]*padding-block:\s*10px;[^}]*padding-inline-start:\s*16px;/,
  );
  expect(css).toMatch(
    /\.management-row-single:focus \{[^}]*background:\s*var\(--surface-raised\);/,
  );
  expect(css).toMatch(/\.lineup-channel-number \{[^}]*color:\s*var\(--text\);/);
  expect(css).toContain("@media (max-width: 380px)");
  expect(css).toContain("env(safe-area-inset-bottom)");
  expect(css).toContain(".manage-rail");
  expect(css).toContain(".manage-drawer");
  expect(css).toContain('.setting input[type="checkbox"]');
  expect(css).toContain("padding-inline: 16px 46px");
  expect(css).toContain("border-radius: var(--control-radius)");
});

test("reads the pairing secret from the QR fragment", () => {
  window.history.replaceState({}, "", "/#pair=a_secret-123");
  const app = loadApp();

  expect(app.parsePairSecret()).toBe("a_secret-123");
});

test("uses the TV language before authentication", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      reply(200, {
        locale: "fa",
        direction: "rtl",
        labels: { ...labels, pairTitle: "اتصال به تلویزیون" },
      }),
    ),
  );

  await loadApp().start();

  expect(document.documentElement.lang).toBe("fa");
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelector("h1")?.textContent).toBe("اتصال به تلویزیون");
});

test("shows progress while pairing", async () => {
  let finish: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, publicState))
    .mockImplementationOnce(() => pending)
    .mockImplementationOnce(() => reply(200, snapshot()));
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();

  (document.querySelector('[name="deviceName"]') as HTMLInputElement).value = "Kitchen device";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  expect(document.querySelector("[role=status]")?.textContent).toBe(labels.connecting);
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
    true,
  );
  finish({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, deviceId: "device-1", credential: "key-1" }),
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
  );
});

test("pairs with a manual code and remembers the credential", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, publicState))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, deviceId: "device-1", credential: "key-1" }),
    )
    .mockImplementationOnce(() => reply(200, snapshot()));
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();

  (document.querySelector('[name="deviceName"]') as HTMLInputElement).value = "Kitchen device";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
  );

  expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}")).toEqual({
    deviceId: "device-1",
    credential: "key-1",
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    code: "123456",
    name: "Kitchen device",
  });
});

test("matches the player settings menu order", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );

  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const order = [
    labels.appearance,
    labels.playback,
    labels.content,
    labels.devices,
    labels.about,
  ];
  const railLinks = () => [
    ...document.querySelectorAll<HTMLAnchorElement>(".manage-rail .manage-nav-link"),
  ];
  const drawerLinks = () => [
    ...document.querySelectorAll<HTMLAnchorElement>(".manage-drawer .manage-nav-link"),
  ];
  expect(railLinks().map((link) => link.textContent?.trim())).toEqual(order);
  expect(drawerLinks().map((link) => link.textContent?.trim())).toEqual(order);
  expect(document.querySelectorAll(".manage-page").length).toBe(1);
  expect(document.querySelector('[data-page="playlists"]')).toBeTruthy();
  expect(railLinks()[2].getAttribute("aria-current")).toBe("page");

  railLinks()[3].click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());
  expect(document.querySelector('[data-page="playlists"]')).toBeNull();
  expect(railLinks()[3].getAttribute("aria-current")).toBe("page");
  expect(railLinks()[2].hasAttribute("aria-current")).toBe(false);
});

test("appearance and playback list their controls and options in the player order", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );

  await loadApp().start();

  const settingKeys = () =>
    [...document.querySelectorAll<HTMLElement>("[data-page] [data-setting]")].map(
      (control) => control.dataset.setting,
    );
  const optionValues = (key: string) =>
    [...(document.querySelector(`[data-setting="${key}"]`) as HTMLSelectElement).options].map(
      (option) => option.value,
    );
  const optionLabels = (key: string) =>
    [...(document.querySelector(`[data-setting="${key}"]`) as HTMLSelectElement).options].map(
      (option) => option.textContent,
    );

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  expect(settingKeys()).toEqual([
    "locale",
    "fontSizeId",
    "showNumbers",
    "showLogos",
    "showClock",
  ]);
  expect(optionValues("locale")).toEqual(["en", "fa"]);
  expect(optionValues("fontSizeId")).toEqual(["s", "m", "l", "xl"]);
  expect(optionLabels("fontSizeId")).toEqual(["Small", "Medium", "Large", "Extra large"]);

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#playback"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="playback"]')).toBeTruthy());
  expect(settingKeys()).toEqual([
    "aspectId",
    "resumeLast",
    "compatibility",
    "showPlaybackStats",
    "continuousReconnect",
  ]);
  expect(optionValues("aspectId")).toEqual(["fill", "fit", "stretch"]);
  expect(optionLabels("aspectId")).toEqual(["Fill", "Fit", "Stretch"]);
});

test("labels playlist fields and actions with their context", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      reply(
        200,
        snapshot({
          playlists: [
            {
              id: "one",
              name: "One",
              source: {
                kind: "xtream",
                server: "http://example.com",
                username: "one",
                output: "m3u8",
                hasPassword: true,
              },
              sourceVersion: 1,
            },
            {
              id: "two",
              name: "Two",
              source: { kind: "m3u", url: "http://example.com/two.m3u" },
              sourceVersion: 1,
            },
          ],
        }),
      ),
    ),
  );

  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const index = document.querySelector('[data-page="playlists"]');
  expect(index?.textContent).toContain("One");
  expect(index?.textContent).not.toContain("get.php");
  expect(index?.textContent).not.toContain("secret");
  expect(index?.textContent).not.toContain("two.m3u");
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(2);
  expect(document.querySelectorAll('[data-item-menu="playlist"]')).toHaveLength(2);
  const triggerOne = document.querySelector(
    '[data-item-menu="playlist"][data-id="one"]',
  ) as HTMLButtonElement;
  expect(triggerOne.getAttribute("aria-label")).toBe(labels.actions + ", One");
  expect(triggerOne.getAttribute("aria-haspopup")).toBe("menu");
  expect(triggerOne.getAttribute("aria-expanded")).toBe("false");
  const identityOne = document.querySelector(
    ".playlist-card .playlist-card-info",
  ) as HTMLElement;
  expect(identityOne?.tagName).toBe("SPAN");
  expect(identityOne?.hasAttribute("data-item-menu")).toBe(false);
  expect(identityOne?.hasAttribute("data-id")).toBe(false);
  expect(document.querySelector('[data-action="open-item-menu"]')).toBeNull();
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();

  const activateOne = document.querySelector(
    '[data-action="playlist-activate"][data-id="one"]',
  ) as HTMLElement;
  const refreshOne = document.querySelector(
    '[data-action="playlist-refresh"][data-id="one"]',
  ) as HTMLElement;
  expect(activateOne).toBeTruthy();
  expect(refreshOne).toBeNull();
  expect(activateOne.getAttribute("aria-pressed")).toBe("false");

  triggerOne.click();
  const dialog = document.querySelector("[data-item-action-dialog]") as HTMLElement;
  expect(dialog?.getAttribute("aria-label")).toBe("One");
  const menuLabels = Array.from(dialog.querySelectorAll("[data-item-action]")).map((action) =>
    action.textContent?.trim(),
  );
  expect(menuLabels).toEqual([
    labels.activate,
    labels.refresh,
    labels.editCredentials,
    labels.resetToDefault,
    labels.remove,
  ]);
  expect(dialog.querySelector('[data-item-action="activate"]')).toBeTruthy();
  expect(dialog.querySelector('[data-item-action="refresh"]')).toBeTruthy();
  expect(dialog.querySelector('[data-item-action="remove"]')?.className).toContain("danger");
  const cancel = dialog.querySelector<HTMLButtonElement>(
    ".item-menu-foot button[data-item-menu-close]",
  );
  expect(cancel?.className).toContain("quiet");
  expect(cancel?.closest(".item-menu-foot")).toBeTruthy();
  expect(dialog.querySelector(".item-menu-head .item-menu-close")).toBeNull();
  const menuTitle = dialog.querySelector(".item-menu-title");
  expect(menuTitle?.textContent).toBe("One");
  expect(menuTitle?.getAttribute("dir")).toBeNull();
  expect(menuTitle?.querySelector("span")?.getAttribute("dir")).toBeNull();
  (dialog.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
  expect(itemMenuTrigger("playlist", "one").getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(itemMenuTrigger("playlist", "one"));

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  expect(window.location.hash).toBe("#playlists?view=add");
  expect(document.querySelector('[name="newName"]')?.getAttribute("aria-label")).toBe(
    labels.playlistName,
  );
  expect(document.querySelector('[name="newUrl"]')?.getAttribute("aria-label")).toBe(
    labels.playlistAddress,
  );
  expect(document.querySelector('[name="newUrl"]')?.getAttribute("dir")).toBe("ltr");

  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy(),
  );
  expect(window.location.hash).toBe("#playlists/list");

  openPlaylistEdit("two");
  await vi.waitFor(() =>
    expect(document.querySelector('[data-edit-playlist][data-id="two"]')).toBeTruthy(),
  );
  expect(window.location.hash).toBe("#playlists?view=edit&playlist=two");
});

test("shows safe Xtream account status and the trusted local HTTP boundary", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const password = "web-status-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      reply(
        200,
        snapshot({
          playlists: [
            {
              id: "xtream-one",
              name: "Provider",
              source: {
                kind: "xtream",
                server: "http://provider.example",
                username: "viewer-private",
                output: "m3u8",
                hasPassword: true,
              },
              sourceVersion: 1,
              account: {
                status: "Active",
                isTrial: true,
                activeConnections: 1,
                maxConnections: 2,
              },
            },
          ],
          operation: {
            loading: false,
            error: "",
            errorKey: "",
            errorDetail: "",
          },
        }),
      ),
    ),
  );

  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const text = document.querySelector('[data-page="playlists"]')?.textContent ?? "";
  expect(text).toContain("trial");
  expect(text).toContain("Expiry unknown");
  expect(text).toContain("1 of 2 connections");
  expect(text).not.toContain(password);
  expect(text).not.toContain("viewer-private");
  const playlistsHead = document.querySelector('[data-page="playlists"] .page-head');
  expect(playlistsHead?.querySelector("[data-lineup-heading]")?.textContent).toBe(
    labels.savedPlaylists,
  );

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#devices"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());
  expect(document.querySelector('[data-page="devices"]')?.textContent).not.toContain(
    labels.trustedNetwork,
  );
  const devicesHead = document.querySelector('[data-page="devices"] .page-head');
  expect(devicesHead?.querySelector("[data-lineup-heading]")?.textContent).toBe(labels.devices);
  expect(devicesHead?.querySelector(".page-description")).toBeNull();
  expect(devicesHead?.querySelector(".trusted-network")).toBeNull();
  expect(document.body.textContent).not.toContain(password);
  expect(document.body.textContent).not.toContain("viewer-private");
});

test("uses remembered authentication and applies the TV language direction", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const persian = snapshot({ locale: "fa", direction: "rtl" });
  const fetchMock = vi.fn(() => reply(200, persian));
  vi.stubGlobal("fetch", fetchMock);

  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer p:c");
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelector('[data-page="playlists"]')).toBeTruthy();
  expect(
    document.querySelector('.manage-rail .manage-nav-link[aria-current="page"]')?.textContent,
  ).toContain(labels.content);
});

test.each(["ltr", "rtl"] as const)(
  "the physical remote stays fixed and centres its rocker buttons under %s",
  async (direction) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        reply(200, snapshot({ direction, locale: direction === "rtl" ? "fa" : "en" })),
      ),
    );
    const style = document.createElement("style");
    style.textContent = readFileSync("public/remote/remote.css", "utf8");
    document.head.append(style);
    try {
      await loadApp().start();
      expect(document.documentElement.dir).toBe(direction);
      const remote = document.querySelector<HTMLElement>(".remote-sheet")!;
      expect(remote.dir).toBe("ltr");
      for (const page of remote.querySelectorAll<HTMLElement>(".remote-page")) {
        expect(getComputedStyle(page).direction).toBe("ltr");
      }
      expect(
        [...remote.querySelectorAll(".touch-rocker button")].map((button) =>
          button.getAttribute("data-remote-key"),
        ),
      ).toEqual(["448", "449", "427", "428"]);
      for (const button of remote.querySelectorAll<HTMLElement>(".touch-rocker button")) {
        const computed = getComputedStyle(button);
        expect(computed.display).toBe("grid");
        expect(computed.placeItems).toBe("center");
        expect(computed.textAlign).toBe("center");
      }
    } finally {
      style.remove();
    }
  },
);

test("matches the player welcome field order", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot({ playlists: [], activePlaylistId: "" }))),
  );
  await loadApp().start();

  const labelsInOrder = [...document.querySelectorAll("form label")].map((label) =>
    label.textContent?.trim(),
  );
  expect(labelsInOrder[0]).toContain(labels.playlistAddress);
  expect(labelsInOrder[1]).toContain(labels.playlistName);
  expect(labelsInOrder[2]).toContain(labels.language);
});

test("remote first setup keeps M3U default and submits Xtream credentials as M3U Plus", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ playlists: [], activePlaylistId: "" });
  const fetchMock = vi.fn(() => reply(200, { ok: true, snapshot: empty }));
  fetchMock.mockImplementationOnce(() => reply(200, empty));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  expect(document.querySelector('[data-source="m3u"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(document.querySelector('[name="playlistUrl"]')).toBeTruthy();
  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  (document.querySelector('[name="xtreamServer"]') as HTMLInputElement).value =
    "https://provider.example:8443";
  (document.querySelector('[name="xtreamUsername"]') as HTMLInputElement).value = "viewer";
  (document.querySelector('[name="xtreamPassword"]') as HTMLInputElement).value = "secret";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() => {
    const commands = fetchMock.mock.calls
      .slice(1)
      .map((call) => JSON.parse(call[1].body).command)
      .filter((command) => command.type === "setup");
    expect(commands[0].source).toEqual({
      kind: "xtream",
      server: "https://provider.example:8443",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    });
  });
});

test("mirrors setup typing and language through a quiet preview command", async () => {
  vi.useFakeTimers();
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const preview = snapshot({
    playlists: [],
    activePlaylistId: "",
    setup: {
      name: "Device playlist",
      source: { kind: "m3u", url: "http://example.com/device.m3u" },
    },
  });
  const translated = snapshot({
    revision: 1,
    locale: "fa",
    direction: "rtl",
    playlists: [],
    activePlaylistId: "",
    setup: preview.setup,
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot({ playlists: [], activePlaylistId: "" })))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: preview }))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: translated }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const name = document.querySelector('[name="playlistName"]') as HTMLInputElement;
  const url = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  const locale = document.querySelector('[name="locale"]') as HTMLSelectElement;
  name.value = "Device playlist";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  url.value = "http://example.com/device.m3u";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  locale.value = "fa";
  locale.dispatchEvent(new Event("change", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(300);
  await Promise.resolve();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "setup.preview",
    name: "Device playlist",
    source: { kind: "m3u", url: "http://example.com/device.m3u" },
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command).toEqual({
    type: "setting",
    key: "locale",
    value: "fa",
  });
});

test("submitting setup does not send a queued language command twice", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ playlists: [], activePlaylistId: "" });
  const completed = snapshot({ revision: 1, settings: { ...empty.settings, locale: "fa" } });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, empty))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: empty }))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: completed }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const locale = document.querySelector('[name="locale"]') as HTMLSelectElement;
  locale.value = "fa";
  locale.dispatchEvent(new Event("change", { bubbles: true }));
  (document.querySelector('[name="playlistUrl"]') as HTMLInputElement).value =
    "http://example.com/list.m3u";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

  const commands = fetchMock.mock.calls
    .slice(1)
    .map((call) => JSON.parse(call[1].body).command.type);
  expect(commands).toEqual(["setup.preview", "setup"]);
});

test("keeps first playlist values when TV validation fails", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot({ playlists: [], activePlaylistId: "" })))
    .mockImplementationOnce(() =>
      reply(400, { ok: false, reason: "invalid", snapshot: snapshot({ playlists: [] }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const name = document.querySelector('[name="playlistName"]') as HTMLInputElement;
  const url = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  name.value = "My list";
  url.value = "http://example.com/list.m3u";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(labels.invalidUrl),
  );
  const currentName = document.querySelector('[name="playlistName"]') as HTMLInputElement;
  const currentUrl = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  expect(currentName.value).toBe("My list");
  expect(currentUrl.value).toBe("http://example.com/list.m3u");
  expect(currentUrl.disabled).toBe(false);
});

test("a setup conflict preserves editable fields and safe feedback", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ playlists: [], activePlaylistId: "" });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, empty))
    .mockImplementationOnce(() =>
      reply(409, { ok: false, reason: "conflict", snapshot: empty }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector('[name="playlistUrl"]') as HTMLInputElement).value =
    "http://example.com/list.m3u";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(labels.conflict),
  );
  const currentUrl = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  expect(currentUrl.value).toBe("http://example.com/list.m3u");
  expect(currentUrl.disabled).toBe(false);
  expect(document.querySelector(".setup h1")?.textContent).toBe(labels.setupTitle);
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.querySelector('[name="playlistUrl"]')).toBeTruthy();
});

test("shows progress and confirms successful first playlist setup", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let finish: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot({ playlists: [], activePlaylistId: "" })))
    .mockImplementationOnce(() => pending);
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[name="playlistName"]') as HTMLInputElement).value = "NASA demo";
  (document.querySelector('[name="playlistUrl"]') as HTMLInputElement).value =
    "https://example.com/demo.m3u";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  expect(document.querySelector("#app")?.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector("[role=status]")?.textContent).toBe(labels.checkingPlaylist);
  expect((document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(
    true,
  );
  finish({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, snapshot: snapshot({ revision: 1 }) }),
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[data-setup-result="success"] h1')?.textContent).toBe(
      labels.setupCompleteTitle,
    ),
  );
  expect(document.querySelector('[data-setup-result="success"]')).toBeTruthy();
  expect(document.querySelector(".setup-result-description")?.textContent).toBe(
    labels.setupCompleteBody,
  );
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.querySelector("#app")?.hasAttribute("aria-busy")).toBe(false);

  (document.querySelector("[data-action=open-settings]") as HTMLButtonElement).click();
  expect(document.querySelector(".manage-rail")).toBeTruthy();
  expect(document.querySelector('[data-page="playlists"]')).toBeTruthy();
});

test("remote settings add an Xtream login through the playlist command", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  const addDialog = document
    .querySelector("[data-add-playlist-form]")!
    .closest<HTMLElement>('[role="dialog"]')!;
  expect(addDialog).toBeTruthy();
  expect(addDialog.closest(".management-view-enter")).toBeNull();
  expect(document.querySelector('[data-source="m3u"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  (document.querySelector('[name="newServer"]') as HTMLInputElement).value =
    "http://provider.example:8080";
  (document.querySelector('[name="newUsername"]') as HTMLInputElement).value = "viewer";
  (document.querySelector('[name="newPassword"]') as HTMLInputElement).value = "secret";
  const outputTrigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="newOutput"]',
  )!;
  const xtreamDialog = outputTrigger.closest<HTMLElement>('[role="dialog"]')!;
  expect(xtreamDialog).toBeTruthy();
  expect(xtreamDialog.closest(".management-view-enter")).toBeNull();
  outputTrigger.click();
  const escapeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(escapeEvent);
  expect(escapeEvent.defaultPrevented).toBe(true);
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(xtreamDialog.isConnected).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  outputTrigger.click();
  const legacyReturn = new KeyboardEvent("keydown", {
    key: "Unidentified",
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(legacyReturn, "keyCode", { value: 10009 });
  window.dispatchEvent(legacyReturn);
  expect(legacyReturn.defaultPrevented).toBe(true);
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(xtreamDialog.isConnected).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  outputTrigger.click();
  const outputOption = document.querySelector<HTMLButtonElement>(
    '[role="listbox"] [data-picker-value="ts"]',
  )!;
  let triggerReceivedFocus = false;
  outputTrigger.addEventListener(
    "focus",
    () => {
      triggerReceivedFocus = true;
    },
    { once: true },
  );
  const tab = new KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
  });
  outputOption.dispatchEvent(tab);
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(tab.defaultPrevented).toBe(false);
  expect(triggerReceivedFocus).toBe(true);
  outputTrigger.click();
  document
    .querySelector<HTMLElement>('[role="option"][data-picker-value="m3u8"]')
    ?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect((document.querySelector('[name="newOutput"]') as HTMLSelectElement).value).toBe("ts");
  const output = document.querySelector<HTMLSelectElement>('[name="newOutput"]')!;
  const outputLabel = output.options[output.selectedIndex].textContent || "";
  expect(outputTrigger.querySelector(".option-picker-value")?.textContent).toBe(outputLabel);
  expect(outputTrigger.getAttribute("aria-label")).toBe(
    output.getAttribute("aria-label") + ", " + outputLabel,
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "playlist.add",
    name: "",
    source: {
      kind: "xtream",
      server: "http://provider.example:8080",
      username: "viewer",
      password: "secret",
      output: "ts",
    },
  });
});

test("remote editing restores the Xtream credential form", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const provider = snapshot({
    playlists: [
      {
        id: "pl-1",
        name: "Provider",
        source: {
          kind: "xtream",
          server: "https://provider.example:8443/portal",
          username: "viewer",
          output: "ts",
          hasPassword: true,
        },
        sourceVersion: 1,
      },
    ],
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, provider))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: provider }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openPlaylistEdit();
  const editDialog = document
    .querySelector("[data-edit-playlist]")!
    .closest<HTMLElement>('[role="dialog"]')!;
  expect(editDialog).toBeTruthy();
  expect(editDialog.closest(".management-view-enter")).toBeNull();

  expect(document.querySelector('[data-source="xtream"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect((document.querySelector('[name="editServer"]') as HTMLInputElement).value).toBe(
    "https://provider.example:8443/portal",
  );
  expect((document.querySelector('[name="editUsername"]') as HTMLInputElement).value).toBe(
    "viewer",
  );
  expect((document.querySelector('[name="editPassword"]') as HTMLInputElement).value).toBe("");
  expect((document.querySelector('[name="editOutput"]') as HTMLSelectElement).value).toBe("ts");
  expect(document.querySelector('[name="editUrl"]')).toBeNull();

  (document.querySelector('[data-source="m3u"]') as HTMLButtonElement).click();
  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  expect((document.querySelector('[name="editOutput"]') as HTMLSelectElement).value).toBe("ts");
  (document.querySelector('[data-picker-trigger="editOutput"]') as HTMLButtonElement).click();
  (
    document.querySelector('[role="listbox"] [data-picker-value="m3u8"]') as HTMLButtonElement
  ).click();

  document
    .querySelector("[data-edit-playlist]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "playlist.update",
    id: "pl-1",
    name: "Provider",
    source: {
      kind: "xtream",
      server: "https://provider.example:8443/portal",
      username: "viewer",
      password: "",
      output: "m3u8",
    },
  });
});

test("adds playlists and confirms removal before sending commands", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementation((_path: string, options?: RequestInit) => {
      const command = JSON.parse(String(options?.body)).command;
      return reply(200, {
        ok: true,
        message: command.type === "playlist.add" ? "Sport saved." : "Removed News.",
        snapshot: snapshot({ revision: 1 }),
      });
    });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "Sport";
  (document.querySelector('[name="newUrl"]') as HTMLInputElement).value =
    "http://example.com/sport.m3u";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe("Sport saved."),
  );
  removePlaylistFromIndex();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  expect(confirmDialog().textContent).toContain("News");
  expect(confirmDialog().textContent).toContain(labels.removeConfirm);
  await confirmAndSettle();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(document.querySelector("[role=status]")?.textContent).toBe("Removed News.");

  expect(window.confirm).not.toHaveBeenCalled();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command.type).toBe("playlist.remove");
});

test("returns immediately to setup after removing the final playlist", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ revision: 1, playlists: [], activePlaylistId: "" });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, message: "Removed News.", snapshot: empty }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  removePlaylistFromIndex();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();

  await vi.waitFor(() => expect(document.querySelector('[name="playlistUrl"]')).toBeTruthy());
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.querySelector("[role=status]")?.textContent).toBe("Removed News.");
});

test("declining playlist removal sends no command", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn(() => reply(200, snapshot()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  removePlaylistFromIndex();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  answerConfirmation(false);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();
});

test("edits and refreshes an existing playlist", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, {
        ok: true,
        message: "Renamed news updated.",
        snapshot: snapshot({ revision: 1 }),
      }),
    )
    .mockImplementationOnce(() =>
      reply(200, {
        ok: true,
        message: "Refreshed, 3 channels.",
        snapshot: snapshot({ revision: 2 }),
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openPlaylistEdit();
  const name = document.querySelector('[name="editName"]') as HTMLInputElement;
  const url = document.querySelector('[name="editUrl"]') as HTMLInputElement;
  expect(document.activeElement).toBe(url);
  name.value = "Renamed news";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  url.value = "http://example.com/renamed.m3u";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-edit-playlist]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe("Renamed news updated."),
  );
  playlistRowAction("pl-1", "refresh");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe("Refreshed, 3 channels."),
  );

  const update = JSON.parse(fetchMock.mock.calls[1][1].body).command;
  expect(update).toEqual({
    type: "playlist.update",
    id: "pl-1",
    name: "Renamed news",
    source: { kind: "m3u", url: "http://example.com/renamed.m3u" },
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command).toEqual({
    type: "playlist.refresh",
    id: "pl-1",
  });
});

test("closing a saved playlist edit preserves the TV reload failure", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const failure = "The playlist could not be loaded.";
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(() => reply(200, snapshot()))
      .mockImplementationOnce(() =>
        reply(200, {
          ok: true,
          message: "News updated.",
          snapshot: snapshot({ revision: 1, operation: { loading: false, error: failure } }),
        }),
      ),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistEdit();
  (document.querySelector('[name="editUrl"]') as HTMLInputElement).value =
    "http://example.com/new-stream.m3u";
  document
    .querySelector("[data-edit-playlist]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeNull());
  expect(document.querySelector("[data-operation-status]")?.textContent).toBe(failure);
  expect(
    document.querySelector("[data-operation-status]")?.getAttribute("data-toast-kind"),
  ).toBe("error");
});

test("shows the TV playlist error instead of a saved message", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const failed = snapshot({
    revision: 1,
    operation: {
      loading: false,
      error: "The playlist could not be loaded.",
      errorKey: "playlist.loadFailed",
      errorDetail: "",
    },
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: failed }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  playlistRowAction("pl-1", "refresh");
  await vi.waitFor(() =>
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "The playlist could not be loaded.",
    ),
  );
});

test("restores focus after a setting is saved", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#appearance");
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, {
        ok: true,
        snapshot: snapshot({
          revision: 1,
          settings: { ...snapshot().settings, showClock: false },
        }),
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const toggle = document.querySelector('[data-setting="showClock"]') as HTMLInputElement;
  toggle.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved),
  );
  const savedToggle = document.querySelector<HTMLInputElement>('[data-setting="showClock"]')!;
  expect(savedToggle.checked).toBe(false);
  expect(document.activeElement).toBe(savedToggle);
});

test("the continuous reconnect toggle writes the same setting as the TV", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#playback");
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const toggle = document.querySelector(
    '[data-setting="continuousReconnect"]',
  ) as HTMLInputElement;
  expect(toggle).toBeTruthy();
  toggle.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved),
  );
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "setting",
    key: "continuousReconnect",
    value: true,
  });
});

test("refreshes state after a revision conflict", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#appearance");
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(409, { ok: false, reason: "conflict", snapshot: snapshot({ revision: 4 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector('[data-setting="showClock"]') as HTMLInputElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=alert]")?.textContent).toBe(labels.conflict),
  );
});

test("clears revoked credentials and reports an unavailable TV", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(401, { error: "unauthorised" })),
  );
  await loadApp().start();
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
  expect(document.body.textContent).toContain(labels.revoked);

  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await loadApp().start();
  expect(document.body.textContent).toContain(labels.unavailable);
});

test("confirms cache clearing before sending it", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#about");
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector("[data-action=clear-cache]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  expect(confirmDialog().textContent).toContain(labels.cacheConfirm);
  await confirmAndSettle();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  expect(window.confirm).not.toHaveBeenCalled();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command.type).toBe("cache.clear");
});

test("the about page orders identity, repository, copy and application data", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#about");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  await loadApp().start();

  const card = document.querySelector(".about-card") as HTMLElement;
  const repository = card.querySelector(".repository-link") as HTMLAnchorElement;
  expect(repository?.textContent?.trim()).toBe("GitHub");
  expect(repository?.getAttribute("href")).toBe("https://github.com/shayanline/OpenIPTV");

  const paragraphs = Array.from(card.querySelectorAll("p"));
  const description = paragraphs.find((entry) => !entry.classList.contains("muted"))!;
  const disclaimer = card.querySelector("p.muted")!;
  expect(
    repository.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    description.compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  const data = document.querySelector(".about-data") as HTMLElement;
  expect(card.compareDocumentPosition(data) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const row = data.querySelector(".setting") as HTMLElement;
  expect(row?.textContent).toContain(labels.cache);
  const clear = row?.querySelector('[data-action="clear-cache"]') as HTMLButtonElement;
  expect(clear?.textContent?.trim()).toBe(labels.clear);
});

const lineupSnapshot = (change: Record<string, unknown> = {}) =>
  snapshot({
    lineup: { playlistId: "pl-1", revision: 3, ready: true },
    ...change,
  });

const lineupChannel = (index: number, name = `Channel ${index}`) => ({
  kind: "channel",
  id: `channel-${index}`,
  name,
  providerName: `Provider ${index}`,
  number: index + 1,
  providerNumber: index + 1,
  hidden: false,
  categoryKeys: ["News"],
  personalCategoryIds: [],
});

const lineupCategory = (id = "News", contentKind = "live") => ({
  kind: "category",
  id,
  contentKind,
  name: id,
  providerName: id,
  hidden: false,
  count: 2,
  unavailableCount: 0,
});

const xtreamPlaylist = {
  id: "pl-1",
  name: "Provider",
  source: {
    kind: "xtream",
    server: "http://provider.example",
    username: "viewer",
    password: "secret",
    output: "m3u8",
  },
  sourceVersion: 1,
};

const xtreamLineupSnapshot = (change: Record<string, unknown> = {}) =>
  lineupSnapshot({ playlists: [xtreamPlaylist], ...change });

function lineupPage(
  items: unknown[],
  nextCursor: string | null = null,
  total = items.length,
  revision = 3,
  sectionCounts: Record<string, number> = { live: 1, movie: 0, series: 0 },
  orderMode?: string,
) {
  return {
    ok: true,
    page: {
      revision,
      items,
      nextCursor,
      total,
      sectionCounts,
      ...(orderMode ? { orderMode } : {}),
    },
  };
}

function openPlaylistContent(id = "pl-1") {
  const open = document.querySelector<HTMLElement>(
    `button[data-item-open="playlist"][data-id="${id}"]`,
  );
  if (!open) throw new Error(`playlist open missing: ${id}`);
  open.click();
}

test("migrates the previous phone credential key", async () => {
  localStorage.setItem(
    "openiptv.phone",
    JSON.stringify({ phoneId: "old-phone", credential: "secret" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  await loadApp().start();
  expect(localStorage.getItem("openiptv.phone")).toBeNull();
  expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}")).toEqual({
    deviceId: "old-phone",
    credential: "secret",
  });
});

test("loads only the first fifty lineup items", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const items = Array.from({ length: 50 }, (_, index) => lineupChannel(index));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage(items, "next", 151)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 3,
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  const next = document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement;
  expect(next).toBeTruthy();
  expect(next.disabled).toBe(false);
});

test("pages forward and back without duplicating rows", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const first = Array.from({ length: 50 }, (_, index) => lineupChannel(index));
  const second = Array.from({ length: 50 }, (_, index) => lineupChannel(index + 50));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage(first, "opaque-page-two", 120)))
    .mockImplementationOnce(() => reply(200, lineupPage(second, null, 120)))
    .mockImplementationOnce(() => reply(200, lineupPage(first, "opaque-page-two", 120)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-page="next"]')).toBeTruthy(),
  );
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 50",
    ),
  );
  const secondPageRow = document.querySelector(".lineup-row-channel");
  expect(secondPageRow?.querySelector(".lineup-channel-number")?.textContent).toBe("51");
  expect(secondPageRow?.querySelector(".lineup-channel-name")?.textContent).toBe("Channel 50");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).cursor).toBe("opaque-page-two");
  expect(document.activeElement).toBe(
    document.querySelector("#lineup .lineup-list .lineup-row .lineup-row-open"),
  );

  (document.querySelector('[data-lineup-page="prev"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 0"),
  );
  expect(
    document.querySelector(".lineup-row-channel .lineup-channel-number")?.textContent,
  ).toBe("1");
  expect(document.activeElement).toBe(
    document.querySelector("#lineup .lineup-list .lineup-row .lineup-row-open"),
  );
  expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 3,
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
});

test("changes kind without carrying the old cursor", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const counts = { live: 1, movie: 1, series: 0 };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, xtreamLineupSnapshot()))
    .mockImplementationOnce(() =>
      reply(200, lineupPage([lineupChannel(1)], "old-cursor", 2, 3, counts)),
    )
    .mockImplementationOnce(() => reply(200, lineupPage([], null, 0, 3, counts)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-kind="movie"]')).toBeTruthy(),
  );
  (document.querySelector('[data-lineup-kind="movie"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 3,
    scope: "categories",
    contentKind: "movie",
    includeHidden: true,
  });
});

test("debounces search and resets to page one", async () => {
  vi.useFakeTimers();
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupCategory()], "old", 2)))
    .mockImplementationOnce(() => reply(200, lineupPage([], null, 0)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  await vi.advanceTimersByTimeAsync(0);
  openPlaylistContent();
  await vi.advanceTimersByTimeAsync(0);
  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(0);
  const input = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  input.value = "خبر";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(149);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await Promise.resolve();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 3,
    scope: "categories",
    contentKind: "live",
    query: "خبر",
    includeHidden: true,
  });
});

test("management queries always include hidden items", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).includeHidden).toBe(true);
  expect(document.querySelector("[data-lineup-hidden]")).toBeNull();
});

test("opening a playlist adopts its first page revision without a conflict warning", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() =>
      reply(409, {
        ok: false,
        reason: "conflict",
        revision: 4,
        snapshot: lineupSnapshot({ lineup: { playlistId: "pl-1", revision: 4, ready: true } }),
      }),
    )
    .mockImplementationOnce(() => reply(200, lineupPage([lineupCategory()], null, 1, 4)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).revision).toBe(3);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).revision).toBe(4);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
});

test("refetches page one after a loaded page becomes stale", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const replacement = deferredReply();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(0)], "next", 51)))
    .mockImplementationOnce(() =>
      reply(409, {
        ok: false,
        reason: "conflict",
        revision: 4,
        snapshot: lineupSnapshot({ lineup: { playlistId: "pl-1", revision: 4, ready: true } }),
      }),
    )
    .mockImplementationOnce(() => replacement.promise);
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy();
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(document.querySelectorAll("[data-operation-status]")).toHaveLength(0);
  expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 4,
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  replacement.complete(200, lineupPage([lineupChannel(1)], null, 1, 4));
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  const toast = document.querySelector("[data-operation-status]");
  expect(document.querySelectorAll("[data-operation-status]")).toHaveLength(1);
  expect(toast?.textContent).toBe(
    "The lineup changed on the TV. The latest page has been loaded.",
  );
  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  expect(document.querySelector("[data-operation-status]")).toBe(toast);
  window.history.replaceState({}, "", "/#playback");
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() => expect(document.querySelector('[data-page="playback"]')).toBeTruthy());
  expect(toast?.isConnected).toBe(false);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
});

test("refetches the current query after a successful mutation", async () => {
  vi.useFakeTimers();
  try {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => reply(200, lineupSnapshot()))
      .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(1)])))
      .mockImplementationOnce(() =>
        reply(200, { ok: true, revision: 4, affectedIds: ["channel-1"] }),
      )
      .mockImplementationOnce(() =>
        reply(200, lineupPage([lineupChannel(1, "Renamed")], null, 1, 4)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const app = loadApp();
    window.history.replaceState({}, "", "/#playlists/list");
    await app.start();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
    await app.sendLineupMutation(
      { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
      null,
    );
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).revision).toBe(4);
    expect(document.querySelector(".lineup-row")?.textContent).toContain("Renamed");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(document.querySelector("[data-operation-status]")).toBeNull();
    vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
  }
});

test("a changed results query clears the current view toast", async () => {
  const queries: Array<Record<string, unknown>> = [];
  let revision = 3;
  const app = await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        return reply(200, lineupPage([lineupChannel(1, "Channel")], null, 1, revision));
      }
      if (path === "/api/v1/lineup/mutation") {
        return reply(200, { ok: true, revision: ++revision, affectedIds: ["channel-1"] });
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
    null,
  );
  app.renderManageForTest(labels.saved, false);
  const toast = document.querySelector("[data-operation-status]");
  expect(toast?.textContent).toBe(labels.saved);
  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  expect(document.querySelector("[data-operation-status]")).toBe(toast);
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  search.value = "filter";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(queries.some((body) => body.query === "filter")).toBe(true));
  expect(document.querySelector("[data-operation-status]")).toBeNull();
});

test("a replacement session clears the previous session toast", async () => {
  localStorage.setItem(
    "openiptv.remote",
    JSON.stringify({ deviceId: "p", credential: "first" }),
  );
  const replacementState = deferredReply();
  let stateCalls = 0;
  let revision = 3;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") {
        stateCalls += 1;
        return stateCalls === 1 ? reply(200, lineupSnapshot()) : replacementState.promise;
      }
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return reply(
          200,
          lineupPage([lineupChannel(1, "Channel")], null, 1, Number(body.revision) || revision),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        return reply(200, { ok: true, revision: ++revision, affectedIds: ["channel-1"] });
      }
      return reply(404, {});
    }),
  );
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
    null,
  );
  app.renderManageForTest(labels.saved, false);
  const toast = document.querySelector("[data-operation-status]");
  expect(toast?.textContent).toBe(labels.saved);

  localStorage.setItem(
    "openiptv.remote",
    JSON.stringify({ deviceId: "q", credential: "second" }),
  );
  const reloading = app.start();
  await vi.waitFor(() => expect(stateCalls).toBe(2));
  replacementState.complete(200, lineupSnapshot());
  await reloading;
  expect(toast?.isConnected).toBe(false);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
});

test("never renders a complete catalogue from the state snapshot", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementationOnce(() => reply(200, lineupSnapshot()))
      .mockImplementationOnce(() => reply(200, lineupPage([], null, 0))),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  expect(document.body.textContent).not.toContain("channel-11999");
});

test("sends every lineup operation with the current revision and a fresh request id", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  var revision = 3;
  const mutations: Array<{
    id: string;
    playlistId: string;
    revision: number;
    mutation: unknown;
  }> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") return reply(200, lineupPage([], null, 0, revision));
    const body = JSON.parse(String(options?.body)) as {
      id: string;
      playlistId: string;
      revision: number;
      mutation: unknown;
    };
    mutations.push(body);
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  const operations = [
    { type: "channel.rename", channelId: "channel-1", name: "Mine" },
    { type: "channel.rename", channelId: "channel-1", name: null },
    { type: "channel.number", channelId: "channel-1", number: 101 },
    { type: "channel.number", channelId: "channel-1", number: null },
    { type: "channel.visibility", channelId: "channel-1", hidden: true },
    { type: "category.rename", categoryKey: "News", name: "Headlines" },
    { type: "category.visibility", categoryKey: "News", hidden: true },
    { type: "categories.visibility", contentKind: "live", hidden: true },
    { type: "category-order.mode", section: "live", mode: "provider" },
    { type: "category-order.mode", section: "movie", mode: "alphabetical" },
    { type: "category-order.mode", section: "series", mode: "custom" },
    { type: "item-order.mode", categoryKey: "News", mode: "number" },
    { type: "item-order.mode", categoryKey: "News", mode: "custom" },
    {
      type: "item.place",
      categoryKey: "News",
      placement: { itemId: "title-1", beforeId: "title-2" },
    },
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: "channel-1", beforeId: "channel-2" },
    },
    { type: "category.place", placement: { itemId: "News", afterId: "Sport" } },
    { type: "personal-category.create", name: "Mine" },
    { type: "personal-category.rename", categoryId: "mine", name: "Ours" },
    { type: "personal-category.delete", categoryId: "mine" },
    { type: "personal-category.memberships", channelId: "channel-1", categoryIds: ["mine"] },
    { type: "personal-category.memberships", channelId: "channel-1", categoryIds: [] },
    {
      type: "personal-category.place-channel",
      categoryId: "mine",
      placement: { itemId: "channel-1", beforeId: "channel-2" },
    },
    { type: "unavailable.remove", key: "channel-override:missing" },
    { type: "unavailable.remove", key: "category-override:missing" },
    { type: "unavailable.remove", key: "personal-membership:missing" },
    { type: "unavailable.remove", key: "channel-placement:missing" },
    { type: "unavailable.remove", key: "category-placement:missing" },
  ];
  for (const operation of operations) {
    await vi.waitFor(() =>
      expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false"),
    );
    await app.sendLineupMutation(operation, null);
  }
  expect(new Set(mutations.map((entry) => entry.id)).size).toBe(operations.length);
  expect(mutations.map((entry) => entry.mutation)).toEqual(operations);
  expect(
    mutations.every((entry) => entry.playlistId === "pl-1" && Number.isInteger(entry.revision)),
  ).toBe(true);
});

test.each(["ltr", "rtl"])(
  "preserves provider text under the %s app direction",
  async (direction) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const exact = "العربية فارسی 👩‍👩‍👧‍👦 é English";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(() => reply(200, lineupSnapshot({ direction })))
        .mockImplementationOnce(() =>
          reply(
            200,
            lineupPage(
              [
                {
                  kind: "category",
                  id: "News",
                  contentKind: "live",
                  name: exact,
                  providerName: exact,
                  hidden: true,
                  count: 1,
                  unavailableCount: 0,
                },
              ],
              null,
              1,
              3,
              undefined,
              "custom",
            ),
          ),
        ),
    );
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe(exact),
    );
    const categoryName = document.querySelector(".lineup-row-category strong");
    expect(categoryName?.getAttribute("dir")).toBeNull();
    expect(categoryName?.closest("[dir]")?.getAttribute("dir")).toBe(direction);
    expect(document.querySelector('[dir="auto"]')).toBeNull();
    const hiddenCategoryRow = document.querySelector(".lineup-row-category") as HTMLElement;
    expect(hiddenCategoryRow.textContent).toContain("Hidden");
    const categoryMain = hiddenCategoryRow.querySelector(".lineup-row-main") as HTMLElement;
    const categoryTag = hiddenCategoryRow.querySelector(".lineup-hidden-tag") as HTMLElement;
    expect(categoryTag).toBeTruthy();
    expect(categoryTag.textContent).toBe("Hidden");
    expect(categoryMain.contains(categoryTag)).toBe(false);
    expect(categoryMain.nextElementSibling).toBe(categoryTag);
    expect(document.querySelector('[data-lineup-action="move"]')).toBeNull();
    await enterRemoteReorder();
    const sortRow = document.querySelector("[data-lineup-sort]") as HTMLElement;
    expect(sortRow?.getAttribute("aria-label")).toContain(exact);
    expect(document.documentElement.dir).toBe(direction);
  },
);

test("a field conflict keeps its draft visible without replay", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const category = {
    kind: "category",
    id: "News",
    contentKind: "live",
    name: "News",
    providerName: "News",
    hidden: false,
    count: 2,
    unavailableCount: 0,
  };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([category])))
    .mockImplementationOnce(() =>
      reply(409, {
        ok: false,
        reason: "conflict",
        revision: 4,
        snapshot: lineupSnapshot({ lineup: { playlistId: "pl-1", revision: 4, ready: true } }),
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  await openRemoteRename("News");
  const input = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  input.value = "Changed";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-editor] [role="alert"]')?.textContent).toBe(
      labels.changeFailed,
    ),
  );
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(1);
  expect(
    document.querySelector<HTMLInputElement>('[data-lineup-editor] [name="editorValue"]')
      ?.value,
  ).toBe("Changed");
});

test("failed rename retains typed value and restores opener focus", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const category = {
    kind: "category",
    id: "News",
    contentKind: "live",
    name: "News",
    providerName: "News",
    hidden: false,
    count: 2,
    unavailableCount: 0,
  };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([category])))
    .mockImplementationOnce(() =>
      reply(500, { ok: false, reason: "persistence", revision: 3 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  await openRemoteRename("News");
  const input = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  input.value = "Typed value";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect((document.querySelector('[name="editorValue"]') as HTMLInputElement)?.value).toBe(
      "Typed value",
    ),
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.closest("[data-lineup-editor]")).toBeTruthy();
  });
  expect(document.querySelector(".lineup-editor-dialog")?.getAttribute("role")).toBe("dialog");
  expect(document.querySelector(".lineup-editor .notice")).toBeTruthy();
});

test("reorder mode lists sortable rows and places a grabbed item before its target", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    mutations.push(JSON.parse(String(options?.body)).mutation);
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  expect(document.querySelector(".lineup-sort-list")).toBeTruthy();
  expect(document.querySelector(".list-head h2")).toBeNull();
  expect(document.querySelector(".page-head [data-lineup-heading]")?.textContent).toBe(
    "Custom Order",
  );
  expect(document.querySelectorAll("[data-lineup-heading]")).toHaveLength(1);
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
  expect(document.querySelector('[data-lineup-action="move"]')).toBeNull();
  expect(document.querySelector(".lineup-anchor-picker")).toBeNull();
  expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull();
  expect(document.querySelector("[data-lineup-preference]")).toBeNull();
  expect(document.querySelector("[data-lineup-search-toggle]")).toBeNull();
  expect(document.querySelector(".lineup-editor-dialog")).toBeNull();
  expect(document.querySelector(".lineup-reorder-help")?.textContent).toBe(
    "Drag the handle to move an item, or select an item and then select where to place it.",
  );
  expect(document.querySelector("[data-lineup-mode-back]")?.getAttribute("aria-label")).toBe(
    "Back",
  );

  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  expect(sortOrder()).toEqual(["Sport", "News"]);
  const writesBeforeGrab = mutations.length;

  const grab = document.querySelector(
    '[data-lineup-sort][data-id="News"]',
  ) as HTMLButtonElement;
  grab.focus();
  grab.click();
  expect(grab.getAttribute("aria-pressed")).toBe("true");
  expect(grab.getAttribute("aria-label")).toContain("Place here");
  expect(document.activeElement).toBe(grab);
  expect(document.querySelector('[data-lineup-sort][data-id="News"]')).toBe(grab);
  expect(mutations).toHaveLength(writesBeforeGrab);

  const target = document.querySelector(
    '[data-lineup-sort][data-id="Sport"]',
  ) as HTMLButtonElement;
  target.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(writesBeforeGrab + 1));
  expect(mutations[writesBeforeGrab]).toEqual({
    type: "category.place",
    placement: { itemId: "News", beforeId: "Sport" },
  });
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
});

test("ordinary reorder arrows move focus and only move the focused held row", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    mutations.push(JSON.parse(String(options?.body)).mutation);
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );

  const sortList = document.querySelector(".lineup-sort-list");
  const heading = document.querySelector("[data-lineup-heading]");
  const rows = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-lineup-sort]"));
  const rowIds = rows.map((row) => row.dataset.id);
  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map(
      (row) => (row as HTMLElement).dataset.id,
    );
  const sendKey = (key: string) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(event);
    return event;
  };
  const queryCount = () =>
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query").length;
  const requestsBefore = fetchMock.mock.calls.length;
  const queriesBefore = queryCount();
  const mutationsBefore = mutations.length;
  const viewport = mockRemoteSortViewport();

  rows[0].focus();
  for (let index = 0; index < 3; index += 1) {
    expect(sendKey("ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[1]);
    expect(sendKey("ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(rows[0]);
  }
  expect(sendKey("ArrowUp").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[0]);
  expect(sendKey("ArrowDown").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[1]);
  expect(sendKey("ArrowDown").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[1]);
  expect(document.querySelector(".lineup-sort-list")).toBe(sortList);
  expect(document.querySelector("[data-lineup-heading]")).toBe(heading);
  const ungrabbedRows = Array.from(document.querySelectorAll("[data-lineup-sort]"));
  expect(ungrabbedRows[0]).toBe(rows[0]);
  expect(ungrabbedRows[1]).toBe(rows[1]);
  expect(sortOrder()).toEqual(rowIds);
  rows.forEach((row) => {
    expect(row.getAttribute("aria-pressed")).toBe("false");
    expect(row.classList.contains("grabbed")).toBe(false);
  });
  expect(queryCount()).toBe(queriesBefore);
  expect(mutations).toHaveLength(mutationsBefore);
  expect(fetchMock.mock.calls).toHaveLength(requestsBefore);
  expect(viewport.scrollBy).not.toHaveBeenCalled();

  rows[0].click();
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  rows[1].focus();
  expect(sendKey("ArrowDown").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[1]);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  expect(rows[1].getAttribute("aria-pressed")).toBe("false");
  expect(rows[1].classList.contains("grabbed")).toBe(false);
  expect(sortOrder()).toEqual(rowIds);

  expect(sendKey("ArrowUp").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[0]);
  expect(sendKey("ArrowDown").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(rows[0]);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  expect(rows[0].classList.contains("grabbed")).toBe(true);
  expect(sortOrder()).toEqual([rowIds[1], rowIds[0]]);
  const movedRows = Array.from(document.querySelectorAll("[data-lineup-sort]"));
  expect(movedRows[0]).toBe(rows[1]);
  expect(movedRows[1]).toBe(rows[0]);
  expect(viewport.scrollBy).toHaveBeenCalledWith({ top: 22, behavior: "auto" });
  expect(viewport.scroll()).toBe(22);
  expect(document.querySelector(".lineup-sort-list")).toBe(sortList);
  expect(document.querySelector("[data-lineup-heading]")).toBe(heading);
  expect(queryCount()).toBe(queriesBefore);
  expect(mutations).toHaveLength(mutationsBefore);
  expect(fetchMock.mock.calls).toHaveLength(requestsBefore);
});

test("membership toggle sends the complete next personal category list", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const personal = {
    kind: "personal-category",
    id: "mine",
    name: "Mine",
    providerName: "Mine",
    hidden: false,
    count: 1,
    unavailableCount: 0,
  };
  const member = { ...lineupChannel(1), personalCategoryIds: ["mine"] };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() =>
      reply(200, lineupSnapshot({ capabilities: { customCategories: true } })),
    )
    .mockImplementationOnce(() => reply(200, lineupPage([])))
    .mockImplementationOnce(() => reply(200, lineupPage([personal])))
    .mockImplementationOnce(() => reply(200, lineupPage([member])))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, revision: 4, affectedIds: ["channel-1"] }),
    )
    .mockImplementationOnce(() =>
      reply(200, lineupPage([{ ...member, personalCategoryIds: [] }], null, 1, 4)),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-scope="personal-categories"]')).toBeTruthy(),
  );
  (
    document.querySelector('[data-lineup-scope="personal-categories"]') as HTMLButtonElement
  ).click();
  await vi.waitFor(() =>
    expect(
      document.querySelector('button[data-item-open="lineup"][data-id="mine"]'),
    ).toBeTruthy(),
  );
  lineupRowOpenAction("mine");
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-item-menu="lineup"][data-id="channel-1"]'),
    ).toBeTruthy(),
  );
  openItemMenu("lineup", "channel-1");
  itemAction("membership").click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
  expect(JSON.parse(fetchMock.mock.calls[4][1].body).mutation).toEqual({
    type: "personal-category.memberships",
    channelId: "channel-1",
    categoryIds: [],
  });
});

test("a slow lineup page cannot replace a newer search", async () => {
  vi.useFakeTimers();
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let releaseOld: (value: unknown) => void = () => {};
  const oldPage = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => oldPage)
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(2, "New result")])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("true");
  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  expect(search.disabled).toBe(false);
  search.value = "new";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(250);
  await Promise.resolve();
  releaseOld({
    status: 200,
    ok: true,
    json: async () => lineupPage([lineupChannel(1, "Old result")]),
  });
  await Promise.resolve();
  expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("New result");
});

test("a mutation invalidates a slow lineup query before the successful refetch", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let releaseOld: (value: unknown) => void = () => {};
  const oldPage = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => oldPage)
    .mockImplementationOnce(() =>
      reply(200, { ok: true, revision: 4, affectedIds: ["channel-1"] }),
    )
    .mockImplementationOnce(() =>
      reply(200, lineupPage([lineupChannel(2, "New revision item")], null, 1, 4)),
    );
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "New revision item" },
    null,
  );
  expect(JSON.parse(fetchMock.mock.calls[3][1].body).revision).toBe(4);
  expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
    "New revision item",
  );
  releaseOld({
    status: 200,
    ok: true,
    json: async () => lineupPage([lineupChannel(1, "Old revision item")]),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
    "New revision item",
  );
  expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false");
});

test("a placement conflict keeps reorder mode on the refreshed revision", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      return reply(409, {
        ok: false,
        reason: "conflict",
        revision: 4,
        snapshot: lineupSnapshot({
          lineup: { playlistId: "pl-1", revision: 4, ready: true },
        }),
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  (document.querySelector('[data-lineup-sort][data-id="News"]') as HTMLButtonElement).click();
  (document.querySelector('[data-lineup-sort][data-id="Sport"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe(
      labels.changeFailed,
    ),
  );
  const mutationBody = JSON.parse(
    String(
      fetchMock.mock.calls.find((call) => call[0] === "/api/v1/lineup/mutation")?.[1]?.body,
    ),
  );
  expect(mutationBody.revision).toBe(3);
  expect(mutationBody.mutation).toEqual({
    type: "category.place",
    placement: { itemId: "News", beforeId: "Sport" },
  });
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(1);
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  expect(document.querySelector('[data-lineup-sort][aria-pressed="true"]')).toBeNull();
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
});

test("bulk visibility offers live movie and series show and hide mutations", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  var revision = 3;
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const query = JSON.parse(String(options?.body));
        return reply(
          200,
          lineupPage([lineupCategory("News", query.contentKind)], null, 1, revision, {
            live: 1,
            movie: 1,
            series: 1,
          }),
        );
      }
      const body = JSON.parse(String(options?.body));
      sent.push(body.mutation);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-bulk="hide"]')).toBeTruthy(),
  );
  const settle = () =>
    vi.waitFor(() =>
      expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false"),
    );
  await settle();
  for (const kind of ["live", "movie", "series"]) {
    if (kind !== "live") {
      (document.querySelector(`[data-lineup-kind="${kind}"]`) as HTMLButtonElement).click();
      await settle();
      await vi.waitFor(() =>
        expect(document.querySelector('[data-lineup-bulk="hide"]')).toBeTruthy(),
      );
    }
    const bulkButtons = document.querySelectorAll<HTMLButtonElement>(
      "#lineup [data-lineup-bulk]",
    );
    expect(bulkButtons).toHaveLength(2);
    (document.querySelector('[data-lineup-bulk="hide"]') as HTMLButtonElement).click();
    await settle();
    expect(document.querySelector("[data-lineup-bulk-confirm]")).toBeNull();
    (document.querySelector('[data-lineup-bulk="show"]') as HTMLButtonElement).click();
    await settle();
  }
  await vi.waitFor(() => expect(sent).toHaveLength(6));
  expect(sent).toEqual([
    { type: "categories.visibility", contentKind: "live", hidden: true },
    { type: "categories.visibility", contentKind: "live", hidden: false },
    { type: "categories.visibility", contentKind: "movie", hidden: true },
    { type: "categories.visibility", contentKind: "movie", hidden: false },
    { type: "categories.visibility", contentKind: "series", hidden: true },
    { type: "categories.visibility", contentKind: "series", hidden: false },
  ]);
});

test("saved authentication renders management without any lineup request", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn(() => reply(200, lineupSnapshot()));
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/state");
  expect(document.querySelector('[data-page="playlists"]')).toBeTruthy();
  expect(document.querySelector("#lineup")).toBeNull();
  expect(document.querySelectorAll(".manage-rail .manage-nav-link")).toHaveLength(5);
  expect(document.querySelector('.manage-nav-link[href="#lineup"]')).toBeNull();
  expect(document.querySelector('[data-item-menu="playlist"]')).toBeTruthy();

  await app.start();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/state");
  expect(document.querySelector("#lineup")).toBeNull();
});

test("a successful pairing also waits for an explicit content open", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, publicState))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, deviceId: "device-1", credential: "key-1" }),
    )
    .mockImplementationOnce(() => reply(200, lineupSnapshot()));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  (document.querySelector('[name="deviceName"]') as HTMLInputElement).value = "Kitchen device";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
  );

  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
    "/api/v1/status",
    "/api/v1/pair",
    "/api/v1/state",
  ]);
  expect(document.querySelector("#lineup")).toBeNull();
  (document.querySelector('[data-focus-key="manage-playlists"]') as HTMLAnchorElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="playlists"]')).toBeTruthy(),
  );
  expect(document.querySelector('[data-item-menu="playlist"]')).toBeTruthy();
});

test("opening playlist content loads one bounded page inside the playlists section", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(1)], null, 1)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/lineup/query");
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    playlistId: "pl-1",
    sourceVersion: 1,
    revision: 3,
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
  });
  const head = document.querySelector(".content-head");
  expect(head?.textContent).toContain("manage your playlist content");
  expect(head?.textContent).toContain("News");
  expect(document.querySelector(".crumbs")?.textContent).toContain("Playlists");
  expect(document.querySelector('[data-page="content"] #lineup')).toBeTruthy();
  expect(document.querySelector('[data-item-menu="playlist"]')).toBeNull();
  expect(document.querySelector("[data-lineup-playlist]")).toBeNull();
});

test("an inactive playlist manages its own owner without activating it", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Sport", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: { body?: string }) => {
    if (path === "/api/v1/state") {
      return reply(200, lineupSnapshot({ playlists, activePlaylistId: "pl-1" }));
    }
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.revision === 0) {
        return reply(409, { ok: false, reason: "conflict", revision: 7 });
      }
      return reply(200, lineupPage([lineupCategory("Sport")], null, 1, 7));
    }
    if (path === "/api/v1/command") return reply(500, {});
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openPlaylistContent("pl-2");
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatchObject({
    playlistId: "pl-2",
    revision: 0,
    scope: "categories",
    contentKind: "live",
  });
  expect(queries[1]).toMatchObject({ playlistId: "pl-2", revision: 7 });
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(fetchMock.mock.calls.some((call) => call[0] === "/api/v1/command")).toBe(false);
  expect(document.querySelector('[data-page="content"]')?.textContent).not.toContain(
    "Make this playlist active",
  );
  window.history.replaceState({}, "", "/#playlists/list");
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-item-open="playlist"][data-id="pl-2"]')).toBeTruthy(),
  );
  openPlaylistContent("pl-2");
  await vi.waitFor(() => expect(queries).toHaveLength(4));
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(queries.slice(2).map((query) => query.revision)).toEqual([0, 7]);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
});

test("closing playlist content restores the list, refocuses the opener, and drops a stale page", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let releaseQuery: (value: unknown) => void = () => {};
  const pendingPage = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => pendingPage);
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector("#lineup")).toBeTruthy());

  (document.querySelector('.crumbs a[href="#playlists/list"]') as HTMLAnchorElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-item-menu="playlist"]')).toBeTruthy(),
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemOpen).toBe("playlist");
    expect(active?.dataset.id).toBe("pl-1");
  });

  releaseQuery({
    status: 200,
    ok: true,
    json: async () => lineupPage([lineupChannel(1, "Late")]),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("#lineup")).toBeNull();
  expect(document.querySelector(".lineup-row")).toBeNull();
  expect(document.querySelector('[data-item-menu="playlist"]')).toBeTruthy();
});

test("a deferred page response cannot focus or replace the newer playlist page", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const stale = deferredReply();
  const queries: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (body.playlistId === "pl-1" && body.cursor) return stale.promise;
        return reply(
          200,
          lineupPage(
            [lineupCategory(body.playlistId === "pl-2" ? "Other Cat" : "News Cat")],
            body.playlistId === "pl-1" ? "page-two" : null,
            60,
            3,
          ),
        );
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(queries.some((body) => body.playlistId === "pl-1" && body.cursor)).toBe(true),
  );
  const pendingBulkButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("#lineup [data-lineup-bulk]"),
  );
  expect(pendingBulkButtons.map((button) => button.dataset.lineupBulk)).toEqual([
    "show",
    "hide",
  ]);
  expect(pendingBulkButtons.every((button) => button.disabled)).toBe(true);

  crumb("Playlists")!.click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
  openPlaylistContent("pl-2");
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="Other Cat"]')).toBeTruthy(),
  );
  const newPageFocus = document.activeElement;
  expect(newPageFocus).toBe(
    document.querySelector("#lineup .lineup-list .lineup-row .lineup-row-open"),
  );

  stale.complete(200, lineupPage([lineupCategory("Stale Cat")], null, 1, 3));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector('[data-lineup-edit][data-id="Other Cat"]')).toBeTruthy();
  expect(document.querySelector('[data-id="Stale Cat"]')).toBeNull();
  expect(document.activeElement).toBe(newPageFocus);
});

test("a lineup transport failure stays inside the dashboard and retries inline", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let mode: "reject" | "json" | "ok" = "reject";
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      if (mode === "reject") return Promise.reject(new Error("offline"));
      if (mode === "json") {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.reject(new Error("not json")),
        });
      }
      return reply(200, lineupPage([lineupChannel(1)]));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-retry]")).toBeTruthy());
  expect(document.querySelector(".connection-state")).toBeNull();
  expect(document.querySelector('[data-page="content"]')).toBeTruthy();
  expect(localStorage.getItem("openiptv.remote")).toBeTruthy();

  mode = "json";
  (document.querySelector("[data-lineup-retry]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-retry]")).toBeTruthy());
  expect(document.querySelector(".connection-state")).toBeNull();

  mode = "ok";
  (document.querySelector("[data-lineup-retry]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
});

test("a revoked credential during lineup still returns to pairing", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") return reply(401, { error: "unauthorised" });
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairTitle));
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
  expect(document.querySelector("#lineup")).toBeNull();
});

function stubAgent(userAgent: string, userAgentData?: { platform: string; mobile: boolean }) {
  vi.stubGlobal("navigator", { userAgent, userAgentData });
}

test("pairing prefills a device name from the browser without blocking edits", async () => {
  const cases = [
    {
      agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      data: undefined,
      name: "iPhone",
    },
    {
      agent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      data: undefined,
      name: "iPad",
    },
    {
      agent:
        "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
      data: { platform: "Android", mobile: true },
      name: "Android phone",
    },
    {
      agent:
        "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      data: { platform: "Android", mobile: false },
      name: "Android tablet",
    },
    {
      agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      data: { platform: "macOS", mobile: false },
      name: "Mac",
    },
    {
      agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      data: { platform: "Windows", mobile: false },
      name: "Windows PC",
    },
    {
      agent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      data: { platform: "Linux", mobile: false },
      name: "Linux PC",
    },
    {
      agent: "Mozilla/5.0 (compatible; OpenIPTVTest/1.0)",
      data: undefined,
      name: "Web browser",
    },
  ];
  for (const entry of cases) {
    stubAgent(entry.agent, entry.data);
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => reply(200, publicState))
      .mockImplementationOnce(() => reply(400, { ok: false }));
    vi.stubGlobal("fetch", fetchMock);
    await loadApp().start();

    const name = document.querySelector('[name="deviceName"]') as HTMLInputElement;
    expect(name.value).toBe(entry.name);
    name.value = `Edited ${entry.name}`;
    (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
    document
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairingFailed));
    expect((document.querySelector('[name="deviceName"]') as HTMLInputElement).value).toBe(
      `Edited ${entry.name}`,
    );
    expect((document.querySelector('[name="code"]') as HTMLInputElement).value).toBe("123456");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: `Edited ${entry.name}`,
      code: "123456",
    });
  }
});

test("the QR pairing payload carries the secret and the editable name", async () => {
  window.history.replaceState({}, "", "/#pair=secret-abc");
  stubAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", {
    platform: "Windows",
    mobile: false,
  });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, publicState))
    .mockImplementationOnce(() => reply(200, { ok: true, deviceId: "d", credential: "k" }))
    .mockImplementationOnce(() => reply(200, snapshot()));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const name = document.querySelector('[name="deviceName"]') as HTMLInputElement;
  expect(name.value).toBe("Windows PC");
  expect(document.querySelector('[name="code"]')).toBeNull();
  name.value = " den ";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
  );
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
    name: "den",
    secret: "secret-abc",
  });
});

test("the unavailable screen is a compact card with a working retry", async () => {
  let releaseSecond: (error: Error) => void = () => {};
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => Promise.reject(new Error("offline")))
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          releaseSecond = reject;
        }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const card = document.querySelector(".connection-state");
  expect(card).toBeTruthy();
  expect(card?.querySelector("h1")?.textContent).toBe("Cannot reach your TV");
  expect(card?.querySelector("[role=alert]")?.textContent).toContain(labels.unavailable);
  const retry = card?.querySelector("[data-action=retry]") as HTMLButtonElement;
  expect(retry).toBeTruthy();

  retry.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe(
      labels.connecting,
    ),
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect((document.querySelector("[data-action=retry]") as HTMLButtonElement).disabled).toBe(
    true,
  );

  releaseSecond(new Error("offline"));
  await vi.waitFor(() =>
    expect(
      (document.querySelector("[data-action=retry]") as HTMLButtonElement | null)?.disabled,
    ).toBe(false),
  );
  expect(document.querySelector(".connection-state")).toBeTruthy();
});

test("a non JSON 401 during a lineup query still clears auth and returns to pairing", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() =>
      Promise.resolve({
        status: 401,
        ok: false,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".hero.pair")).toBeTruthy());
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  expect(document.querySelector("#lineup")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

const switchedLineupSnapshot = () =>
  lineupSnapshot({
    activePlaylistId: "pl-2",
    playlists: [
      {
        id: "pl-1",
        name: "News",
        source: { kind: "m3u", url: "http://example.com/list.m3u" },
        sourceVersion: 1,
      },
      {
        id: "pl-2",
        name: "Sport",
        source: { kind: "m3u", url: "http://example.com/sport.m3u" },
        sourceVersion: 1,
      },
    ],
    lineup: { playlistId: "pl-2", revision: 5, ready: true },
  });

test("a query conflict that switches the active playlist keeps managing the requested owner", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let queryCalls = 0;
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      queryCalls += 1;
      if (queryCalls === 1) {
        return reply(409, {
          ok: false,
          reason: "conflict",
          revision: 5,
          snapshot: switchedLineupSnapshot(),
        });
      }
      return reply(200, lineupPage([lineupChannel(9, "Stadium")], null, 1, 5));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row")?.textContent).toContain("Stadium"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatchObject({ playlistId: "pl-1", revision: 3 });
  expect(queries[1]).toMatchObject({ playlistId: "pl-1", revision: 5 });
  expect(fetchMock).toHaveBeenCalledTimes(3);

  (document.querySelector('.crumbs a[href="#playlists/list"]') as HTMLAnchorElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-item-menu="playlist"][data-id="pl-1"]')).toBeTruthy(),
  );
});

test("a mutation conflict that switches playlists reloads the requested owner", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let conflicted = false;
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") {
      return reply(200, conflicted ? switchedLineupSnapshot() : lineupSnapshot());
    }
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.scope === "channels") {
        return reply(
          200,
          lineupPage(
            [conflicted ? lineupChannel(1, "Restored owner A") : lineupChannel(1)],
            null,
            1,
            conflicted ? 5 : 3,
          ),
        );
      }
      return reply(200, lineupPage([lineupCategory("News")], null, 1, conflicted ? 5 : 3));
    }
    if (path === "/api/v1/lineup/mutation") {
      conflicted = true;
      return reply(409, {
        ok: false,
        reason: "conflict",
        revision: 5,
        snapshot: switchedLineupSnapshot(),
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const queriesBeforeConflict = queryBodies.length;
  toggleRemoteRowVisibility("channel-1");
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
    ).toHaveLength(1),
  );
  await vi.waitFor(() =>
    expect(
      queryBodies
        .slice(queriesBeforeConflict)
        .some(
          (body) =>
            body.revision === 5 &&
            body.scope === "channels" &&
            body.playlistId === "pl-1" &&
            body.sourceVersion === 1 &&
            body.categoryKey === "News",
        ),
    ).toBe(true),
  );
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel")?.textContent).toContain(
      "Restored owner A",
    ),
  );
  const postConflict = queryBodies.slice(queriesBeforeConflict);
  expect(postConflict.length > 0).toBe(true);
  expect(
    postConflict.every((body) => body.playlistId === "pl-1" && body.sourceVersion === 1),
  ).toBe(true);
  expect(
    postConflict.some(
      (body) => body.revision === 5 && body.scope === "channels" && body.categoryKey === "News",
    ),
  ).toBe(true);
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(1);
  expect(document.querySelector("#lineup")).toBeTruthy();
});

test("a placement conflict keeps its content owner when the active playlist changes", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      return reply(409, {
        ok: false,
        reason: "conflict",
        revision: 5,
        snapshot: switchedLineupSnapshot(),
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  (document.querySelector('[data-lineup-sort][data-id="News"]') as HTMLButtonElement).click();
  (document.querySelector('[data-lineup-sort][data-id="Sport"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  expect(document.querySelector(".lineup-sort-list")).toBeTruthy();
  expect(document.querySelector("#lineup")).toBeTruthy();
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query"),
    ).toHaveLength(2),
  );
  const queries = fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query");
  for (const call of queries) {
    expect(JSON.parse(String((call[1] as RequestInit).body)).playlistId).toBe("pl-1");
  }
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("changing the display order saves immediately and restores the settings row", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(1)])))
    .mockImplementationOnce(() => reply(200, { ok: true, revision: 4, affectedIds: [] }))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(1)], null, 1, 4)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-preference="order"]')).toBeTruthy(),
  );
  (document.querySelector('[data-lineup-preference="order"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  (
    document.querySelector('[data-lineup-order-option="alphabetical"]') as HTMLButtonElement
  ).click();
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.getAttribute("data-lineup-preference")).toBe("order");
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).mutation).toEqual({
    type: "category-order.mode",
    section: "live",
    mode: "alphabetical",
  });
});

test("category rows show provider context and counts after their names", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const films = {
    kind: "category",
    id: "Films",
    contentKind: "movie",
    name: "Films",
    providerName: "Films",
    hidden: false,
    count: 12,
    unavailableCount: 0,
  };
  const boxSets = {
    kind: "category",
    id: "box-sets",
    contentKind: "series",
    name: "Box sets",
    providerName: "Provider box sets",
    hidden: false,
    count: 7,
    unavailableCount: 0,
  };
  const news = {
    kind: "category",
    id: "News",
    contentKind: "live",
    name: "News",
    providerName: "News provider",
    hidden: false,
    count: 3,
    unavailableCount: 0,
  };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, xtreamLineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([films, boxSets, news])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(3));

  const rows = [...document.querySelectorAll(".lineup-row")];
  const filmRow = rows.find((row) => row.textContent?.includes("Films"))!;
  expect(filmRow.textContent).not.toContain("Movies");
  expect(filmRow.querySelector(".lineup-category-count")?.textContent).toBe("12");
  expect(filmRow.textContent?.match(/Films/g)).toHaveLength(1);
  const filmOpen = filmRow.querySelector(
    'button[data-item-open="lineup"][data-id="Films"]',
  ) as HTMLElement;
  expect(filmOpen?.getAttribute("aria-label")).toBe("Open, Films");
  expect(filmOpen?.contains(filmRow.querySelector(".lineup-row-main"))).toBe(true);
  expect(filmRow.querySelector(".lineup-compact-menu[data-item-menu='lineup']")).toBeTruthy();
  expect(filmRow.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  expect(filmRow.querySelector('[data-lineup-edit][data-id="Films"]')).toBeTruthy();
  expect(filmRow.querySelector(".lineup-item-actions")).toBeNull();
  const filmHeading = filmRow.querySelector(".lineup-category-label")!;
  expect(filmHeading.children[0].textContent).toBe("Films");
  expect(filmHeading.children[1].textContent).toBe("12");

  const seriesRow = rows.find((row) => row.textContent?.includes("Box sets"))!;
  expect(seriesRow.textContent).not.toContain("Series");
  expect(seriesRow.textContent).toContain("Provider box sets");
  expect(seriesRow.querySelector(".lineup-category-count")?.textContent).toBe("7");

  const newsRow = rows.find((row) => row.textContent?.includes("News"))!;
  expect(newsRow.querySelector(".lineup-category-count")?.textContent).toBe("3");
  expect(newsRow.textContent).toContain("News provider");
});

test("an M3U get.php address offers an explicit Xtream conversion", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const state = snapshot();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, state))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: state }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  const url = document.querySelector('[name="newUrl"]') as HTMLInputElement;
  url.value =
    "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=mpegts";
  url.dispatchEvent(new Event("input", { bubbles: true }));

  const banner = document.querySelector("[data-xtream-suggestion]") as HTMLElement;
  expect(banner.hidden).toBe(false);
  expect(banner.textContent).toContain("Xtream login");

  (document.querySelector('[data-xtream-choice="use"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('[name="newServer"]')).toBeTruthy());
  expect((document.querySelector('[name="newServer"]') as HTMLInputElement).value).toBe(
    "http://provider.example:8080",
  );
  expect((document.querySelector('[name="newUsername"]') as HTMLInputElement).value).toBe(
    "viewer",
  );
  expect((document.querySelector('[name="newPassword"]') as HTMLInputElement).value).toBe(
    "secret",
  );
  expect((document.querySelector('[name="newOutput"]') as HTMLSelectElement).value).toBe("ts");
  expect(document.querySelector('[name="newUrl"]')).toBeNull();

  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "Provider";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "playlist.add",
    name: "Provider",
    source: {
      kind: "xtream",
      server: "http://provider.example:8080",
      username: "viewer",
      password: "secret",
      output: "ts",
    },
  });
});

test("keeping M3U dismisses the Xtream suggestion without switching", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const state = snapshot();
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, state))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: state }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  const url = document.querySelector('[name="newUrl"]') as HTMLInputElement;
  const template =
    "http://provider.example/get.php?username=viewer&password=secret&type=m3u_plus";
  url.value = template;
  url.dispatchEvent(new Event("input", { bubbles: true }));
  expect((document.querySelector("[data-xtream-suggestion]") as HTMLElement).hidden).toBe(
    false,
  );

  (document.querySelector('[data-xtream-choice="keep"]') as HTMLButtonElement).click();
  expect((document.querySelector("[data-xtream-suggestion]") as HTMLElement).hidden).toBe(true);
  expect(document.querySelector('[name="newUrl"]')).toBeTruthy();
  expect(document.querySelector('[name="newServer"]')).toBeNull();

  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "playlist.add",
    name: "",
    source: { kind: "m3u", url: template },
  });
});

test("a get.php address pasted into the Xtream server adopts its parts", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  const server = document.querySelector('[name="newServer"]') as HTMLInputElement;
  server.value =
    "https://provider.example:8443/get.php?username=viewer&password=secret&type=m3u&output=ts";
  server.dispatchEvent(new Event("input", { bubbles: true }));

  expect(server.value).toBe("https://provider.example:8443");
  expect((document.querySelector('[name="newUsername"]') as HTMLInputElement).value).toBe(
    "viewer",
  );
  expect((document.querySelector('[name="newPassword"]') as HTMLInputElement).value).toBe(
    "secret",
  );
  const output = document.querySelector<HTMLSelectElement>('[name="newOutput"]')!;
  expect(output.value).toBe("ts");
  const outputLabel = output.options[output.selectedIndex].textContent || "";
  const outputTrigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="newOutput"]',
  )!;
  expect(outputTrigger.querySelector(".option-picker-value")?.textContent).toBe(outputLabel);
  expect(outputTrigger.getAttribute("aria-label")).toBe(
    output.getAttribute("aria-label") + ", " + outputLabel,
  );
  outputTrigger.click();
  expect(
    document
      .querySelector('[role="option"][data-picker-value="ts"]')
      ?.getAttribute("aria-selected"),
  ).toBe("true");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
});

test("a failed playlist add keeps the typed draft", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(400, { ok: false, reason: "invalid" }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "My list";
  (document.querySelector('[name="newUrl"]') as HTMLInputElement).value =
    "http://example.com/list.m3u";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect((document.querySelector('[name="newName"]') as HTMLInputElement | null)?.value).toBe(
      "My list",
    ),
  );

  expect((document.querySelector('[name="newUrl"]') as HTMLInputElement).value).toBe(
    "http://example.com/list.m3u",
  );
  expect(document.querySelector("[data-action=add-playlist]")).toBeTruthy();
  expect(document.querySelector("[role=alert]")?.textContent).toBe(labels.invalidUrl);
  expect(document.querySelector("[data-add-playlist-form] .playlist-form-error")).toBeNull();
  expect(
    (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("a failed playlist edit keeps the typed draft", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(400, { ok: false, reason: "invalid" }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openPlaylistEdit();
  (document.querySelector('[name="editName"]') as HTMLInputElement).value = "Renamed news";
  (document.querySelector('[name="editUrl"]') as HTMLInputElement).value =
    "http://example.com/renamed.m3u";
  document
    .querySelector("[data-edit-playlist]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(
      (document.querySelector('[name="editName"]') as HTMLInputElement | null)?.value,
    ).toBe("Renamed news"),
  );

  expect((document.querySelector('[name="editUrl"]') as HTMLInputElement).value).toBe(
    "http://example.com/renamed.m3u",
  );
  expect(document.querySelector("[data-edit-playlist]")).toBeTruthy();
  expect(document.querySelector("[data-edit-playlist] .playlist-form-error")).toBeNull();
  expect(document.querySelector(".notification-host [role=alert]")?.textContent).toBe(
    labels.invalidUrl,
  );
  expect(
    (document.querySelector("[data-action=save-playlist]") as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("playlist activation keeps refresh progress on its row after the phone menu closes", async () => {
  const command = deferredReply();
  const playlists = [
    ...snapshot().playlists,
    {
      id: "pl-2",
      name: "Sport",
      source: { kind: "m3u", url: "http://example.com/sport.m3u" },
      sourceVersion: 1,
    },
  ];
  const before = snapshot({ playlists });
  const after = snapshot({ playlists, activePlaylistId: "pl-2", revision: 1 });
  await startSavedRemote(
    vi.fn((path: string) => {
      if (path === "/api/v1/state") return reply(200, before);
      if (path === "/api/v1/command") return command.promise;
      return reply(404, {});
    }),
  );
  playlistMenuAction("pl-2", "activate");
  const card = () =>
    document
      .querySelector('[data-item-open="playlist"][data-id="pl-2"]')!
      .closest(".playlist-card")!;
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
  expect(card().getAttribute("aria-busy")).toBe("true");
  const progress = card().querySelector(".playlist-card-progress");
  expect(progress?.textContent).toBe(labels.refreshing);
  expect(progress?.getAttribute("role")).toBe("progressbar");
  expect(progress?.getAttribute("aria-label")).toContain("Sport");
  expect(progress?.querySelector(".form-spinner")).toBeTruthy();
  expect(card().querySelector(".playlist-card-menu")?.contains(progress)).toBe(false);
  command.complete(200, { ok: true, snapshot: after });
  await vi.waitFor(() => expect(card().getAttribute("aria-busy")).toBeNull());
  expect(card().querySelector(".playlist-card-progress")).toBeNull();
  expect(card().querySelector(".active-badge")).toBeTruthy();
});

test.each(["success", "failure", "cancel", "route"])(
  "refresh loading resolves safely on %s",
  async (ending) => {
    const command = deferredReply();
    let sent = false;
    await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        if (path === "/api/v1/command") {
          sent = true;
          return command.promise;
        }
        return reply(404, {});
      }),
    );
    playlistRowAction("pl-1", "refresh");
    const loading = document.querySelector("[data-operation-status]");
    expect(loading?.getAttribute("data-toast-kind")).toBe("loading");
    expect(loading?.textContent).toContain(labels.refreshing);
    expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
    await vi.waitFor(() => expect(sent).toBe(true));
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(60000);
      expect(document.querySelector("[data-operation-status]")).toBe(loading);
      if (ending === "route") {
        window.history.replaceState({}, "", "/#appearance");
        window.dispatchEvent(new Event("hashchange"));
        expect(document.querySelector("[data-operation-status]")).toBeNull();
      }
      command.complete(ending === "failure" ? 400 : 200, {
        ok: ending !== "failure",
        cancelled: ending === "cancel",
        reason: ending === "failure" ? "failed" : undefined,
        message: ending === "success" ? "Refreshed." : undefined,
        snapshot: lineupSnapshot(),
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[data-toast-kind='loading']")).toBeNull();
        const notice = document.querySelector("[data-operation-status]");
        if (ending === "cancel" || ending === "route") expect(notice).toBeNull();
        else
          expect(notice?.getAttribute("data-toast-kind")).toBe(
            ending === "failure" ? "error" : "success",
          );
      });
      vi.advanceTimersByTime(5200);
      expect(document.querySelector("[data-operation-status]")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  },
);

test("an inactive playlist refreshes from its menu without activating it", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#playlists/list");
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Sport", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/command") {
      return reply(200, { ok: true, snapshot: lineupSnapshot({ playlists }) });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  playlistRowAction("pl-2", "refresh");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  const commands = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/command")
    .map((call) => JSON.parse(String(call[1]?.body)).command);
  expect(commands).toEqual([{ type: "playlist.refresh", id: "pl-2" }]);
  expect(fetchMock.mock.calls.some((call) => call[0] === "/api/v1/lineup/query")).toBe(false);
});

test("a second lineup conflict stops with a local retry", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const conflict = (revision: number) =>
    reply(409, {
      ok: false,
      reason: "conflict",
      revision,
      snapshot: lineupSnapshot({ lineup: { playlistId: "pl-1", revision, ready: true } }),
    });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => conflict(4))
    .mockImplementationOnce(() => conflict(5))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupChannel(1)])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-retry]")).toBeTruthy());

  const queries = fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query");
  expect(queries).toHaveLength(2);
  expect(document.querySelector(".lineup-state-error")?.textContent).toContain(
    "could not be loaded",
  );
  expect(document.querySelector("[data-operation-status]")).toBeNull();

  (document.querySelector("[data-lineup-retry]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query"),
  ).toHaveLength(3);
});

test("an initial lineup load failure blocks with retry until a page arrives", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let fail = true;
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      if (fail) {
        fail = false;
        return reply(503, {});
      }
      return reply(200, lineupPage([lineupChannel(1)]));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-retry]")).toBeTruthy());
  expect(document.querySelector(".lineup-state-error")?.textContent).toContain(
    "could not be loaded",
  );
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query"),
  ).toHaveLength(1);

  (document.querySelector("[data-lineup-retry]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  expect(document.querySelector(".lineup-state-error")?.textContent ?? "").not.toContain(
    "could not be loaded",
  );
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query"),
  ).toHaveLength(2);
});

test("personal categories stay hidden when the capability is absent", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupCategory("News")])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  expect(document.querySelector('[data-lineup-kind="live"]')).toBeNull();
  expect(document.querySelector('[data-lineup-kind="movie"]')).toBeNull();
  expect(document.querySelector('[data-lineup-kind="series"]')).toBeNull();
  expect(document.querySelector(".lineup-tabs")).toBeNull();
  expect(document.querySelector('[data-lineup-scope="personal-categories"]')).toBeNull();
  expect(document.querySelector("[data-create-category]")).toBeNull();
});

test("an empty personal category page keeps creation available", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const createdCategory = {
    kind: "personal-category",
    id: "mine",
    name: "Mine",
    providerName: "Mine",
    hidden: false,
    count: 0,
    unavailableCount: 0,
  };
  let created = false;
  const queries: Array<Record<string, unknown>> = [];
  const mutations: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") {
        return reply(200, lineupSnapshot({ capabilities: { customCategories: true } }));
      }
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        const items =
          body.scope === "personal-categories"
            ? created
              ? [createdCategory]
              : []
            : [lineupCategory("News")];
        return reply(200, lineupPage(items, null, items.length, Number(body.revision) || 3));
      }
      if (path === "/api/v1/lineup/mutation") {
        const body = JSON.parse(String(options?.body)) as { mutation: Record<string, unknown> };
        mutations.push(body.mutation);
        created = true;
        return reply(200, { ok: true, revision: 4, affectedIds: ["mine"] });
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  (
    document.querySelector('[data-lineup-scope="personal-categories"]') as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector("[data-create-category]")).toBeTruthy());
  expect(document.querySelector(".lineup-state")?.textContent).toBe(
    "No matching lineup items.",
  );
  expect(
    (document.querySelector("[data-create-category] button[type=submit]") as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(queries.some((body) => body.scope === "personal-categories")).toBe(true);

  const form = document.querySelector<HTMLFormElement>("[data-create-category]")!;
  const name = form.elements.namedItem("personalCategoryName") as HTMLInputElement;
  name.value = "Mine";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({ type: "personal-category.create", name: "Mine" });
  await vi.waitFor(() =>
    expect(
      document.querySelector('button[data-item-open="lineup"][data-id="mine"]'),
    ).toBeTruthy(),
  );
});

test("the channel editor saves changed fields as sequential fresh mutations", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  const mutations: Array<{ id: string; revision: number; mutation: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, revision)
            : lineupPage([lineupCategory("News")], null, 1, revision),
        );
      }
      const body = JSON.parse(String(options?.body));
      mutations.push(body);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["channel-1"] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");
  expect(document.querySelector('[name="editorHidden"]')).toBeNull();

  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Renamed";
  (document.querySelector('[name="editorNumber"]') as HTMLInputElement).value = "42";
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(mutations.map((entry) => entry.mutation)).toEqual([
    { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
    { type: "channel.number", channelId: "channel-1", number: 42 },
  ]);
  expect(
    mutations.some(
      (entry) => (entry.mutation as { type?: string }).type === "channel.visibility",
    ),
  ).toBe(false);
  expect(new Set(mutations.map((entry) => entry.id)).size).toBe(2);
  expect(mutations.map((entry) => entry.revision)).toEqual([3, 4]);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
});

test("a failed channel editor step keeps the draft and does not replay", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const mutations: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, 3)
            : lineupPage([lineupCategory("News")], null, 1, 3),
        );
      }
      const body = JSON.parse(String(options?.body));
      mutations.push(body.mutation);
      if (mutations.length === 1) {
        return reply(200, { ok: true, revision: 4, affectedIds: ["channel-1"] });
      }
      if (mutations.length === 2) {
        return reply(500, { ok: false, reason: "duplicate-number", revision: 4 });
      }
      return reply(200, { ok: true, revision: 5, affectedIds: ["channel-1"] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Renamed";
  (document.querySelector('[name="editorNumber"]') as HTMLInputElement).value = "42";
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-editor .notice")?.textContent).toBe(
      "That channel number is already in use.",
    ),
  );
  await vi.waitFor(() =>
    expect(
      (document.querySelector('[name="editorName"]') as HTMLInputElement | null)?.value,
    ).toBe("Renamed"),
  );
  expect(mutations).toEqual([
    { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
    { type: "channel.number", channelId: "channel-1", number: 42 },
  ]);
  expect((document.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe(
    "42",
  );
  expect(document.querySelector('[name="editorHidden"]')).toBeNull();
  expect(document.querySelector(".lineup-editor .notice")?.textContent).toBe(
    "That channel number is already in use.",
  );

  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(mutations).toEqual([
    { type: "channel.rename", channelId: "channel-1", name: "Renamed" },
    { type: "channel.number", channelId: "channel-1", number: 42 },
    { type: "channel.number", channelId: "channel-1", number: 42 },
  ]);
  expect(
    mutations.some((entry) => (entry as { type?: string }).type === "channel.visibility"),
  ).toBe(false);
});

test("a drilled category offers the item order mutation", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const sent: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, 3)
            : lineupPage([lineupCategory("News")], null, 1, 3),
        );
      }
      const body = JSON.parse(String(options?.body));
      sent.push(body.mutation);
      return reply(200, { ok: true, revision: 4, affectedIds: [] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-preference="order"]')).toBeTruthy(),
  );

  (document.querySelector('[data-lineup-preference="order"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  (
    document.querySelector('[data-lineup-order-option="alphabetical"]') as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual({
    type: "item-order.mode",
    categoryKey: "News",
    mode: "alphabetical",
  });
});

test("the channel editor restores provider values through explicit draft intent", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const customised = {
    ...lineupChannel(1),
    name: "قناة مخصصة",
    number: 42,
    providerNumber: 7,
    providerName: "Provider 1",
    hidden: true,
  };
  let revision = 3;
  const mutations: Array<{ id: string; revision: number; mutation: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([customised], null, 1, revision)
            : lineupPage([lineupCategory("News")], null, 1, revision),
        );
      }
      const body = JSON.parse(String(options?.body));
      mutations.push(body);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["channel-1"] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const channelRow = document.querySelector(".lineup-row-channel") as HTMLElement;
  expect(channelRow.querySelector(".lineup-channel-number")?.textContent).toBe("42");
  expect(channelRow.querySelector(".lineup-channel-name")?.textContent).toBe("قناة مخصصة");
  expect(channelRow.querySelector(".lineup-channel-name")?.getAttribute("dir")).toBeNull();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  (document.querySelector('[data-lineup-action="restore-draft"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect((document.querySelector('[name="editorName"]') as HTMLInputElement).value).toBe(
      "Provider 1",
    ),
  );
  expect((document.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe("7");
  expect(document.querySelector('[name="editorHidden"]')).toBeNull();

  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(mutations.map((entry) => entry.mutation)).toEqual([
    { type: "channel.rename", channelId: "channel-1", name: null },
    { type: "channel.number", channelId: "channel-1", number: null },
  ]);
  expect(
    mutations.some(
      (entry) => (entry.mutation as { type?: string }).type === "channel.visibility",
    ),
  ).toBe(false);
  expect(new Set(mutations.map((entry) => entry.id)).size).toBe(2);
  expect(mutations.map((entry) => entry.revision)).toEqual([3, 4]);
});

test("a same-owner lineup conflict keeps every editor draft", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const mutations: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, 3)
            : lineupPage([lineupCategory("News")], null, 1, 3),
        );
      }
      const body = JSON.parse(String(options?.body));
      mutations.push(body);
      return reply(409, {
        ok: false,
        reason: "conflict",
        revision: 5,
        snapshot: lineupSnapshot({
          lineup: { playlistId: "pl-1", revision: 5, ready: true },
        }),
      });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Renamed";
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-editor .notice")?.textContent).toBe(
      labels.changeFailed,
    ),
  );
  expect((document.querySelector('[name="editorName"]') as HTMLInputElement).value).toBe(
    "Renamed",
  );
  expect(document.querySelector("[data-lineup-editor]")).toBeTruthy();
  expect(mutations).toHaveLength(1);
});

test("a revoked credential during an editor save leaves only pairing visible", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, 3)
            : lineupPage([lineupCategory("News")], null, 1, 3),
        );
      }
      return reply(401, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Renamed";
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() => expect(document.querySelector('[name="deviceName"]')).toBeTruthy());
  expect(document.querySelector("[data-lineup-editor]")).toBeNull();
  expect(document.querySelector("#lineup")).toBeNull();
  expect(document.querySelector(".lineup-editor-dialog")).toBeNull();
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
});

test("the editor dialog traps focus, closes on Escape and falls back when the opener is gone", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  let showChannel = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage(
                showChannel ? [lineupChannel(1)] : [],
                null,
                showChannel ? 1 : 0,
                revision,
              )
            : lineupPage([lineupCategory("News")], null, 1, revision),
        );
      }
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  const dialog = document.querySelector(".lineup-editor-dialog") as HTMLElement;
  expect(dialog.getAttribute("role")).toBe("dialog");
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]"),
  ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  last.focus();
  last.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.activeElement).toBe(last);

  last.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(document.querySelector("[data-lineup-editor]")).toBeNull();
  expect((document.activeElement as HTMLElement)?.dataset?.lineupEdit).toBe("");
  expect((document.activeElement as HTMLElement)?.dataset?.id).toBe("channel-1");

  await openRemoteRename("channel-1");
  await vi.waitFor(() => expect(document.querySelector('[name="editorName"]')).toBeTruthy());
  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Renamed";
  showChannel = false;
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeNull();
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-search-toggle")).toBe(true);
  });
});

test("grabbed placements keep reorder mode across refetches", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const channels = [lineupChannel(1), lineupChannel(2), lineupChannel(3)];
  const pages: Record<number, unknown[]> = {
    3: channels,
    4: [channels[1], channels[2], channels[0]],
  };
  let revision = 3;
  const mutations: Array<{ mutation: { placement?: Record<string, string> } }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage(pages[revision] ?? channels, null, 3, revision, undefined, "custom")
            : lineupPage([lineupCategory("News")], null, 1, revision, undefined, "custom"),
        );
      }
      const body = JSON.parse(String(options?.body));
      mutations.push(body);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-sort][data-id="channel-1"]')).toBeTruthy(),
  );
  const firstSortRow = document.querySelector('[data-lineup-sort][data-id="channel-1"]');
  expect(firstSortRow?.querySelector(".lineup-channel-number")?.textContent).toBe("2");
  expect(firstSortRow?.querySelector(".lineup-channel-name")?.textContent).toBe("Channel 1");

  const rowOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const settled = () =>
    document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";

  const grab = () =>
    (
      document.querySelector('[data-lineup-sort][data-id="channel-1"]') as HTMLButtonElement
    ).click();
  grab();
  const grabbed = document.querySelector(
    '[data-lineup-sort][data-id="channel-1"]',
  ) as HTMLButtonElement;
  expect(grabbed.getAttribute("aria-pressed")).toBe("true");
  expect(rowOrder()).toEqual(["channel-1", "channel-2", "channel-3"]);

  grabbed.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(rowOrder()).toEqual(["channel-2", "channel-1", "channel-3"]));
  expect(mutations).toHaveLength(0);
  grabbed.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(rowOrder()).toEqual(["channel-2", "channel-3", "channel-1"]));
  expect(mutations).toHaveLength(0);

  grabbed.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  await vi.waitFor(() => expect(settled()).toBe(true));
  expect(mutations.map((entry) => entry.mutation)).toEqual([
    {
      type: "channel.place",
      categoryKey: "News",
      placement: { itemId: "channel-1", afterId: "channel-3" },
    },
  ]);
  await vi.waitFor(() => expect(rowOrder()).toEqual(["channel-2", "channel-3", "channel-1"]));
  expect(document.querySelector("[data-lineup-preferences]")).toBeNull();
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
});

test("a held item stays pinned across bounded pages and places before a chosen target", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const pageOne = Array.from({ length: 50 }, (_, index) => lineupCategory(`cat-${index}`));
  const movedPageOne = [...pageOne.slice(1), pageOne[0]];
  const pageTwo = Array.from({ length: 50 }, (_, index) => lineupCategory(`cat-${index + 50}`));
  const mutations: unknown[] = [];
  let revision = 3;
  let conflictRevision = 0;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      const echoed = Number(body.revision) || 3;
      if (body.cursor === "page-two") {
        return reply(
          200,
          lineupPage(pageTwo, null, 100, conflictRevision || echoed, undefined, "custom"),
        );
      }
      return reply(
        200,
        lineupPage(
          echoed >= 4 ? movedPageOne : pageOne,
          "page-two",
          100,
          echoed,
          undefined,
          "custom",
        ),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
  expect(document.querySelector(".list-head .list-count")?.textContent).toBe("100");
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50),
  );

  const sortRow = (id: string) =>
    document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const settled = () =>
    document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";
  const pageButton = (dir: "prev" | "next") =>
    document.querySelector(`[data-lineup-page="${dir}"]`) as HTMLButtonElement;
  const pageOneIds = pageOne.map((category) => category.id);
  const movedPageOneIds = movedPageOne.map((category) => category.id);
  const pageTwoIds = pageTwo.map((category) => category.id);
  const viewport = mockRemoteSortViewport();

  sortRow("cat-0").click();
  const grabbed = sortRow("cat-0");
  expect(grabbed.getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(grabbed);
  expect(sortRow("cat-0")).toBe(grabbed);

  viewport.setScroll(400);
  viewport.scrollBy.mockClear();
  pageButton("next").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(51);
    expect(sortOrder()).toEqual(["cat-0", ...pageTwoIds]);
  });
  expect(document.activeElement).toBe(sortRow("cat-0"));
  expect(viewport.scrollBy).toHaveBeenCalledWith({ top: -392, behavior: "auto" });
  expect(viewport.scroll()).toBe(8);
  const queryBodies = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  expect(queryBodies[queryBodies.length - 1].cursor).toBe("page-two");
  expect(mutations).toHaveLength(0);

  pageButton("prev").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(pageOneIds);
    expect(sortRow("cat-0").getAttribute("aria-pressed")).toBe("true");
  });
  expect(document.activeElement).toBe(sortRow("cat-0"));
  expect(mutations).toHaveLength(0);

  pageButton("next").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(51);
    expect(sortOrder()).toEqual(["cat-0", ...pageTwoIds]);
  });

  // Dropping the carried hold commits it before the destination's first row.
  const pinned = sortRow("cat-0");
  pinned.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({
    type: "category.place",
    placement: { itemId: "cat-0", beforeId: "cat-50" },
  });
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(51);
    expect(sortOrder()).toEqual(["cat-0", ...pageTwoIds]);
  });
  expect(sortRow("cat-0").getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(sortRow("cat-0"));

  // Escape still releases the hold without another write once the quiet
  // page refresh has landed.
  const queryCalls = () =>
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query");
  await vi.waitFor(() => expect(queryCalls()).toHaveLength(5));
  const heldAgain = sortRow("cat-0");
  heldAgain.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(pageTwoIds);
  });
  expect(document.contains(heldAgain)).toBe(false);
  expect(document.activeElement).toBe(sortRow("cat-50"));
  expect(mutations).toHaveLength(1);

  pageButton("prev").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(movedPageOneIds);
  });
  expect(mutations).toHaveLength(1);

  sortRow("cat-1").click();
  conflictRevision = 5;
  pageButton("next").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(movedPageOneIds);
  });
  expect(document.querySelector('[data-lineup-sort][aria-pressed="true"]')).toBeNull();
  expect(document.querySelector("[data-operation-status]")?.textContent).toContain(
    "latest page",
  );
  expect(mutations).toHaveLength(1);

  // escaping while holding an off-page item drops the pinned row
  sortRow("cat-0").click();
  pageButton("next").click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(51);
    expect(sortOrder()).toEqual(["cat-0", ...pageTwoIds]);
  });
  const pinnedAgain = sortRow("cat-0");
  pinnedAgain.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(pageTwoIds);
  });
  expect(document.contains(pinnedAgain)).toBe(false);
  expect(document.activeElement).toBe(sortRow("cat-50"));
  expect(mutations).toHaveLength(1);
});

test("a held item listed mid destination page pins once at the top and drops before the first row", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const pageOne = Array.from({ length: 50 }, (_, index) => lineupCategory(`cat-${index}`));
  const pageTwoIds = [
    ...Array.from({ length: 25 }, (_, index) => `cat-${index + 50}`),
    "cat-0",
    ...Array.from({ length: 24 }, (_, index) => `cat-${index + 75}`),
  ];
  const pageTwo = pageTwoIds.map((id) => lineupCategory(id));
  const expectedPinned = ["cat-0", ...pageTwoIds.filter((id) => id !== "cat-0")];
  const mutations: unknown[] = [];
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.cursor === "page-two") {
        return reply(200, lineupPage(pageTwo, null, 100, revision, undefined, "custom"));
      }
      return reply(200, lineupPage(pageOne, "page-two", 100, revision, undefined, "custom"));
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50),
  );

  const sortRow = (id: string) =>
    document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const settled = () =>
    document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";

  sortRow("cat-0").click();
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(expectedPinned);
  });
  expect(document.querySelectorAll('[data-lineup-sort][data-id="cat-0"]')).toHaveLength(1);
  expect(sortRow("cat-0").getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(sortRow("cat-0"));

  sortRow("cat-0").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({
    type: "category.place",
    placement: { itemId: "cat-0", beforeId: "cat-50" },
  });
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50);
    expect(sortOrder()).toEqual(expectedPinned);
  });
  expect(sortRow("cat-0").getAttribute("aria-pressed")).toBe("false");
  expect(document.activeElement).toBe(sortRow("cat-0"));
});

test("a failed placement restores the page order and keeps reorder focused", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const sport = lineupCategory("Sport");
  const news = lineupCategory("News");
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      return reply(500, { ok: false, reason: "" });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );

  const sortRow = (id: string) =>
    document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const settled = () =>
    document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";

  sortRow("News").click();
  sortRow("Sport").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({
    type: "category.place",
    placement: { itemId: "News", beforeId: "Sport" },
  });
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(sortOrder()).toEqual(["Sport", "News"]);
    expect(document.querySelector('[data-lineup-sort][aria-pressed="true"]')).toBeNull();
  });
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
  expect(document.querySelector("[data-lineup-preferences]")).toBeNull();
  const toast = document.querySelector("[data-operation-status]");
  expect(toast?.parentElement?.getAttribute("role")).toBe("alert");
  expect(toast?.textContent).toContain("could not be saved");
  expect(document.querySelector(".lineup-state")?.textContent ?? "").not.toContain(
    "could not be saved",
  );
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  const mutationCalls = fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/v1/lineup/mutation",
  );
  expect(mutationCalls).toHaveLength(1);
  expect(document.activeElement).toBe(sortRow("News"));
});

test("a failed reorder page load hides stale rows and offers an inline retry", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const other = lineupCategory("Other");
  let failNext = true;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.cursor === "page-two") {
        if (failNext) {
          failNext = false;
          return reply(503, {});
        }
        return reply(
          200,
          lineupPage([other], null, 3, Number(body.revision) || 3, undefined, "custom"),
        );
      }
      return reply(
        200,
        lineupPage(
          [news, sport],
          "page-two",
          3,
          Number(body.revision) || 3,
          undefined,
          "custom",
        ),
      );
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );

  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const settled = () =>
    document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelector(".lineup-state-error")).toBeTruthy();
  });
  expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(0);
  expect(document.querySelector(".lineup-state-error")?.textContent).toContain(
    "could not be loaded",
  );
  expect(document.querySelector(".lineup-state-error [data-lineup-retry]")).toBeTruthy();
  expect(document.querySelector(".toast.error")).toBeNull();
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();

  (document.querySelector("[data-lineup-retry]") as HTMLButtonElement).click();
  await vi.waitFor(() => {
    expect(settled()).toBe(true);
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2);
    expect(sortOrder()).toEqual(["News", "Sport"]);
  });
  expect(document.querySelector(".lineup-state-error")).toBeNull();
});

test("reorder sends no writes for no-op releases, escape cancels and back discards", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const other = lineupCategory("Other");
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(200, lineupPage([news, sport, other], null, 3, 3, undefined, "custom"));
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      return reply(200, { ok: true, revision: 4, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(3));

  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3),
  );

  const sortRow = (id: string) =>
    document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
  const sortOrder = () =>
    Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
      row.getAttribute("data-id"),
    );
  const press = (key: string) =>
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  const newsRow = sortRow("News");
  newsRow.click();
  expect(sortRow("News").getAttribute("aria-pressed")).toBe("true");
  expect(document.activeElement).toBe(newsRow);
  expect(sortRow("News")).toBe(newsRow);
  sortRow("News").click();
  await vi.waitFor(() => expect(sortRow("News").getAttribute("aria-pressed")).toBe("false"));
  expect(mutations).toHaveLength(0);
  expect(sortOrder()).toEqual(["News", "Sport", "Other"]);

  sortRow("News").click();
  expect(document.activeElement).toBe(newsRow);
  press("ArrowUp");
  expect(sortOrder()).toEqual(["News", "Sport", "Other"]);
  expect(document.activeElement).toBe(newsRow);
  expect(sortRow("News")).toBe(newsRow);
  press("ArrowDown");
  expect(sortOrder()).toEqual(["Sport", "News", "Other"]);
  expect(document.activeElement).toBe(newsRow);
  expect(sortRow("News")).toBe(newsRow);
  press("ArrowDown");
  expect(sortOrder()).toEqual(["Sport", "Other", "News"]);
  expect(document.activeElement).toBe(newsRow);
  expect(sortRow("News")).toBe(newsRow);
  press("ArrowDown");
  expect(sortOrder()).toEqual(["Sport", "Other", "News"]);
  expect(document.activeElement).toBe(newsRow);
  expect(mutations).toHaveLength(0);

  press("Escape");
  await vi.waitFor(() => expect(sortOrder()).toEqual(["News", "Sport", "Other"]));
  expect(sortRow("News").getAttribute("aria-pressed")).toBe("false");
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
  expect(mutations).toHaveLength(0);

  const sportRow = sortRow("Sport");
  sportRow.focus();
  sportRow.click();
  expect(document.activeElement).toBe(sportRow);
  press("ArrowDown");
  expect(sortOrder()).toEqual(["News", "Other", "Sport"]);
  expect(document.activeElement).toBe(sportRow);
  (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-sort]")).toBeTruthy());
  expect(sortOrder()).toEqual(["News", "Sport", "Other"]);
  expect(mutations).toHaveLength(0);

  (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-sort]")).toBeNull());
  expect(document.querySelector('[data-lineup-preference="custom-order"]')).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('[data-lineup-preference="custom-order"]'),
    ),
  );
  expect(mutations).toHaveLength(0);

  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3),
  );
  sortRow("News").dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-sort]")).toBeNull());
  expect(document.querySelector('[data-lineup-preference="custom-order"]')).toBeTruthy();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('[data-lineup-preference="custom-order"]'),
    ),
  );
  expect(mutations).toHaveLength(0);
});

test.each(
  ["pointercancel", "lostpointercapture", "route", "auth"].flatMap((ending) =>
    ["mouse", "touch"].map((pointerType) => ({ ending, pointerType })),
  ),
)(
  "$pointerType drags preview locally, scroll while stationary and cancel on $ending",
  async ({ ending, pointerType }) => {
    document.documentElement.style.setProperty("--t-fast", "0ms");
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const news = lineupCategory("News");
    const sport = lineupCategory("Sport");
    const other = lineupCategory("Other");
    const mutations: unknown[] = [];
    let revision = 3;
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          lineupPage(
            [news, sport, other],
            null,
            3,
            Number(body.revision) || 3,
            undefined,
            "custom",
          ),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        mutations.push(JSON.parse(String(options?.body)).mutation);
        revision += 1;
        return reply(200, { ok: true, revision, affectedIds: [] });
      }
      return reply(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    const cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const flushFrames = () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => {
        callback(0);
      });
    };
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList?.contains("manage-top")) {
        return { top: 0, bottom: 80, height: 80 } as DOMRect;
      }
      if (this.classList?.contains("lineup-sort-item")) {
        const index = Array.from(this.parentElement?.children || []).indexOf(this);
        const top = index * 40;
        return {
          top,
          bottom: top + 40,
          height: 40,
          left: 0,
          right: 300,
          width: 300,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    } as typeof Element.prototype.getBoundingClientRect;
    try {
      window.history.replaceState({}, "", "/#playlists/list");
      const app = loadApp();
      await app.start();
      openPlaylistContent();
      await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(3));
      await enterRemoteReorder();
      await vi.waitFor(() =>
        expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3),
      );

      const sortRow = (id: string) =>
        document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
      const sortOrder = () =>
        Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
          row.getAttribute("data-id"),
        );
      const settled = () =>
        document.querySelector("#lineup")?.getAttribute("aria-busy") === "false";
      const pointer = (type: string, target: Element, y: number) => {
        const event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: y,
          button: 0,
        });
        Object.defineProperty(event, "pointerId", { value: 5 });
        Object.defineProperty(event, "pointerType", { value: pointerType });
        const hit =
          pointerType === "touch" && type === "pointerdown"
            ? (target.querySelector("[data-lineup-sort-handle]") ?? target)
            : target;
        hit.dispatchEvent(event);
      };

      if (pointerType === "touch") {
        const scroll = new MouseEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        });
        Object.defineProperty(scroll, "pointerType", { value: "touch" });
        sortRow("News").dispatchEvent(scroll);
        expect(scroll.defaultPrevented).toBe(false);
        expect(document.documentElement.classList.contains("lineup-dragging")).toBe(false);
      }
      // a sub-threshold press and release behaves like a click grab
      pointer("pointerdown", sortRow("News"), 10);
      expect(document.documentElement.classList.contains("lineup-dragging")).toBe(true);
      pointer("pointermove", sortRow("News"), 14);
      pointer("pointerup", sortRow("News"), 14);
      expect(document.documentElement.classList.contains("lineup-dragging")).toBe(false);
      sortRow("News").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      expect(sortRow("News").getAttribute("aria-pressed")).toBe("true");
      expect(mutations).toHaveLength(0);

      // escape cancels the grab without a write
      sortRow("News").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(sortRow("News").getAttribute("aria-pressed")).toBe("false"),
      );

      // a real drag keeps its node and focus through the preview, and a release
      // before the next frame still commits the final pointer position once
      const sportNode = sortRow("Sport");
      const capture = vi.fn();
      const release = vi.fn();
      sportNode.setPointerCapture = capture;
      sportNode.releasePointerCapture = release;
      sportNode.focus();
      pointer("pointerdown", sportNode, 50);
      expect(document.documentElement.classList.contains("lineup-dragging")).toBe(true);
      pointer("pointermove", sportNode, 60);
      flushFrames();
      expect(capture).toHaveBeenCalledWith(5);
      expect(scrollBy).toHaveBeenCalledWith({ top: -16, behavior: "auto" });
      const scrollFrames = scrollBy.mock.calls.length;
      flushFrames();
      expect(scrollBy.mock.calls.length).toBeGreaterThan(scrollFrames);
      expect(mutations).toHaveLength(0);
      expect(sortRow("Sport")).toBe(sportNode);
      expect(sortRow("Sport").getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(sportNode);
      expect(sortOrder()).toEqual(["News", "Sport", "Other"]);
      pointer("pointermove", sportNode, 100);
      pointer("pointerup", sortRow("Sport"), 100);
      expect(release).toHaveBeenCalledWith(5);
      expect(frames.size).toBe(0);
      expect(document.documentElement.classList.contains("lineup-dragging")).toBe(false);
      sortRow("Sport").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      await vi.waitFor(() => expect(mutations).toHaveLength(1));
      expect(mutations[0]).toEqual({
        type: "category.place",
        placement: { itemId: "Sport", afterId: "Other" },
      });
      await vi.waitFor(() => {
        expect(settled()).toBe(true);
        expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3);
        expect(document.querySelector('[data-lineup-sort][aria-pressed="true"]')).toBeNull();
      });
      expect(sortRow("Sport").getAttribute("aria-pressed")).toBe("false");
      expect(mutations).toHaveLength(1);

      // dragging a different row takes over an existing held item
      sortRow("News").click();
      expect(sortRow("News").getAttribute("aria-pressed")).toBe("true");
      const sportNodeAgain = sortRow("Sport");
      pointer("pointerdown", sportNodeAgain, 50);
      pointer("pointermove", sportNodeAgain, 10);
      flushFrames();
      expect(sortRow("Sport")).toBe(sportNodeAgain);
      expect(sortRow("News").getAttribute("aria-pressed")).toBe("false");
      expect(sortRow("Sport").getAttribute("aria-pressed")).toBe("true");
      expect(sortOrder()).toEqual(["Sport", "News", "Other"]);
      pointer("pointerup", sortRow("Sport"), 10);
      sortRow("Sport").dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      await vi.waitFor(() => expect(mutations).toHaveLength(2));
      expect(mutations[1]).toEqual({
        type: "category.place",
        placement: { itemId: "Sport", beforeId: "News" },
      });
      await vi.waitFor(() => {
        expect(settled()).toBe(true);
        expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3);
        expect(document.querySelector('[data-lineup-sort][aria-pressed="true"]')).toBeNull();
      });

      // Ending the gesture cancels its frame without another write.
      const otherNode = sortRow("Other");
      const releaseOther = vi.fn();
      otherNode.releasePointerCapture = releaseOther;
      pointer("pointerdown", otherNode, 100);
      pointer("pointermove", otherNode, 50);
      flushFrames();
      expect(sortOrder()).toEqual(["News", "Other", "Sport"]);
      expect(sortRow("Other")).toBe(otherNode);
      const pendingFrame = frameId;
      if (ending === "route") crumb("Playlists")!.click();
      else if (ending === "auth") {
        app.replaceAuthForTest({ deviceId: "replacement", credential: "replacement-fixture" });
      } else pointer(ending, sortRow("Other"), 50);
      await vi.waitFor(() => expect(releaseOther).toHaveBeenCalledWith(5));
      expect(cancelFrame).toHaveBeenCalledWith(pendingFrame);
      expect(frames.size).toBe(0);
      const finalScrollFrames = scrollBy.mock.calls.length;
      flushFrames();
      expect(scrollBy.mock.calls).toHaveLength(finalScrollFrames);
      expect(mutations).toHaveLength(2);
      expect(document.documentElement.classList.contains("lineup-dragging")).toBe(false);
      if (ending === "route" || ending === "auth") return;
      await vi.waitFor(() => expect(sortOrder()).toEqual(["News", "Sport", "Other"]));
      expect(sortRow("Other")).toBe(otherNode);
      expect(mutations).toHaveLength(2);
      sortRow("Other").click();
      expect(sortRow("Other").getAttribute("aria-pressed")).toBe("true");
      sortRow("Other").click();
      await vi.waitFor(() =>
        expect(sortRow("Other").getAttribute("aria-pressed")).toBe("false"),
      );
      expect(mutations).toHaveLength(2);
    } finally {
      Element.prototype.getBoundingClientRect = originalRect;
    }
  },
);

test("sort FLIP animates wrapper geometry, carries active translation and clears ownership", async () => {
  document.documentElement.style.setProperty("--t-fast", "150ms");
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const categories = [lineupCategory("News"), lineupCategory("Sport"), lineupCategory("Other")];
  const mutations: unknown[] = [];
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage(categories, null, 3, Number(body.revision) || revision, undefined, "custom"),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      return reply(200, { ok: true, revision: ++revision, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const topDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalAnimate = Element.prototype.animate;
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const flushFrames = () =>
    frames.splice(0).forEach((callback) => {
      callback(0);
    });
  const calls: Array<{ node: Element; transform: string; options: unknown }> = [];
  const handles: Array<{ node: HTMLElement; handle: Animation }> = [];
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.classList.contains("lineup-sort-item")) return 0;
      return Array.from(this.parentElement?.children || []).indexOf(this) * 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("lineup-sort-item") ? 40 : 0;
    },
  });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains("lineup-sort-item")) {
      const dy = /matrix\((.+)\)/.exec(getComputedStyle(this).transform);
      const top = (this as HTMLElement).offsetTop + (dy ? Number(dy[1].split(",")[5]) || 0 : 0);
      return {
        left: 0,
        right: 300,
        top,
        bottom: top + 40,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return originalRect.call(this);
  };
  Element.prototype.animate = function (
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options?: number | KeyframeAnimationOptions,
  ) {
    const transform = String((keyframes as Keyframe[])[0].transform);
    calls.push({ node: this, transform, options });
    const match = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(transform);
    (this as HTMLElement).style.transform =
      "matrix(1,0,0,1,0," + (match ? match[1] : "0") + ")";
    const handle = {
      onfinish: null,
      oncancel: null,
      cancel: vi.fn(() => {
        (this as HTMLElement).style.transform = "none";
      }),
    } as unknown as Animation;
    handles.push({ node: this as HTMLElement, handle });
    return handle;
  };
  try {
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(3));
    await enterRemoteReorder();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3),
    );
    const row = (id: string) =>
      document.querySelector<HTMLButtonElement>(`[data-lineup-sort][data-id="${id}"]`)!;
    const wrapper = (id: string) => row(id).closest(".lineup-sort-item") as HTMLElement;
    const sport = row("Sport");
    const sportWrapper = wrapper("Sport");
    const capture = vi.fn();
    sport.setPointerCapture = capture;
    sport.focus();
    const pointer = (type: string, target: Element, y: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: y,
          button: 0,
        }),
      );

    pointer("pointerdown", sport, 50);
    expect(document.documentElement.classList.contains("lineup-dragging")).toBe(true);
    expect(capture).toHaveBeenCalled();
    pointer("pointermove", sport, 100);
    flushFrames();
    expect(row("Sport")).toBe(sport);
    expect(wrapper("Sport")).toBe(sportWrapper);
    expect(sportWrapper.classList.contains("grabbed")).toBe(true);
    expect(sport.classList.contains("grabbed")).toBe(true);
    expect(
      Array.from(document.querySelectorAll("[data-lineup-sort]")).map(
        (item) => (item as HTMLElement).dataset.id,
      ),
    ).toEqual(["News", "Other", "Sport"]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node: wrapper("Other"), transform: "translateY(40px)" }),
      ]),
    );
    expect(calls.some(({ node }) => node === sportWrapper)).toBe(false);
    expect(calls[0].options).toEqual({
      duration: 150,
      easing: "cubic-bezier(0, 0, 0.2, 1)",
    });

    const firstHandles = handles.slice();
    pointer("pointermove", sport, 10);
    flushFrames();
    expect(
      Array.from(document.querySelectorAll("[data-lineup-sort]")).map(
        (item) => (item as HTMLElement).dataset.id,
      ),
    ).toEqual(["Sport", "News", "Other"]);
    expect(
      firstHandles.every(
        ({ handle }) =>
          (handle.cancel as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1,
      ),
    ).toBe(true);
    expect(calls.some(({ node }) => node === sportWrapper)).toBe(false);

    const remainingHandles = handles.slice(firstHandles.length);
    const finishedHandle = remainingHandles[0];
    finishedHandle.handle.onfinish?.call(
      finishedHandle.handle,
      new Event("finish") as AnimationPlaybackEvent,
    );
    finishedHandle.node.style.transform = "none";
    expect(
      (finishedHandle.handle.cancel as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);

    window.location.hash = "#playlists/list";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.querySelector(".playlist-list")).toBeTruthy());
    expect(document.documentElement.classList.contains("lineup-dragging")).toBe(false);
    expect(
      (finishedHandle.handle.cancel as unknown as ReturnType<typeof vi.fn>).mock.calls,
    ).toHaveLength(0);
    expect(
      remainingHandles
        .filter(({ handle }) => handle !== finishedHandle.handle)
        .every(
          ({ handle }) =>
            (handle.cancel as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1,
        ),
    ).toBe(true);
    expect(mutations).toHaveLength(0);
  } finally {
    Element.prototype.getBoundingClientRect = originalRect;
    Element.prototype.animate = originalAnimate;
    if (topDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetTop", topDescriptor);
    else delete (HTMLElement.prototype as { offsetTop?: number }).offsetTop;
    if (heightDescriptor)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", heightDescriptor);
    else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  }
});

test("sort row click suppression is scoped to the dragged row and event turn", async () => {
  document.documentElement.style.setProperty("--t-fast", "0ms");
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const other = lineupCategory("Other");
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        lineupPage(
          [news, sport, other],
          null,
          3,
          Number(body.revision) || 3,
          undefined,
          "custom",
        ),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      return reply(200, { ok: true, revision: 4, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const flushFrames = () => {
    frames.splice(0).forEach((callback) => {
      callback(0);
    });
  };
  const originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList?.contains("lineup-sort-item")) {
      const index = Array.from(this.parentElement?.children || []).indexOf(this);
      const top = index * 40;
      return {
        top,
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return originalRect.call(this);
  } as typeof Element.prototype.getBoundingClientRect;
  try {
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(3));
    await enterRemoteReorder();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(3),
    );

    const sortRow = (id: string) =>
      document.querySelector(`[data-lineup-sort][data-id="${id}"]`) as HTMLButtonElement;
    const sortOrder = () =>
      Array.from(document.querySelectorAll("[data-lineup-sort]")).map((row) =>
        row.getAttribute("data-id"),
      );
    const pointer = (type: string, target: Element, y: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: y,
          button: 0,
        }),
      );
    const generatedClick = (id: string) =>
      sortRow(id).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    // a no-op drag arms suppression for the dragged row only: its synthetic
    // click is swallowed while a pointer-generated click elsewhere still grabs
    pointer("pointerdown", sortRow("News"), 10);
    pointer("pointermove", sortRow("News"), 20);
    pointer("pointermove", sortRow("News"), 10);
    flushFrames();
    pointer("pointerup", sortRow("News"), 10);
    generatedClick("News");
    expect(sortRow("News").getAttribute("aria-pressed")).toBe("false");
    generatedClick("Sport");
    expect(sortRow("Sport").getAttribute("aria-pressed")).toBe("true");
    sortRow("Sport").click();
    await vi.waitFor(() => expect(sortRow("Sport").getAttribute("aria-pressed")).toBe("false"));
    expect(mutations).toHaveLength(0);

    // after the event turn the record expires, so even a detail:1 click activates
    await tick();
    generatedClick("News");
    expect(sortRow("News").getAttribute("aria-pressed")).toBe("true");
    sortRow("News").click();
    await vi.waitFor(() => expect(sortRow("News").getAttribute("aria-pressed")).toBe("false"));
    expect(mutations).toHaveLength(0);

    // a programmatic click is never swallowed inside the armed window
    pointer("pointerdown", sortRow("News"), 10);
    pointer("pointermove", sortRow("News"), 20);
    pointer("pointermove", sortRow("News"), 10);
    pointer("pointerup", sortRow("News"), 10);
    sortRow("News").click();
    expect(sortRow("News").getAttribute("aria-pressed")).toBe("true");
    sortRow("News").click();
    await vi.waitFor(() => expect(sortRow("News").getAttribute("aria-pressed")).toBe("false"));
    expect(mutations).toHaveLength(0);

    // pointercancel arms nothing, so the next pointer-generated click works
    pointer("pointerdown", sortRow("Other"), 100);
    pointer("pointermove", sortRow("Other"), 50);
    flushFrames();
    expect(sortOrder()).toEqual(["News", "Other", "Sport"]);
    pointer("pointercancel", sortRow("Other"), 50);
    await vi.waitFor(() => expect(sortOrder()).toEqual(["News", "Sport", "Other"]));
    generatedClick("Other");
    expect(sortRow("Other").getAttribute("aria-pressed")).toBe("true");
    sortRow("Other").click();
    await vi.waitFor(() => expect(sortRow("Other").getAttribute("aria-pressed")).toBe("false"));
    expect(mutations).toHaveLength(0);
    expect(sortOrder()).toEqual(["News", "Sport", "Other"]);
  } finally {
    Element.prototype.getBoundingClientRect = originalRect;
  }
});

test("an entered playlist name survives the Xtream suggestion switch", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  const url = document.querySelector('[name="newUrl"]') as HTMLInputElement;
  url.value =
    "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=mpegts";
  url.dispatchEvent(new Event("input", { bubbles: true }));
  const name = document.querySelector('[name="newName"]') as HTMLInputElement;
  name.value = "Kept Name";
  name.dispatchEvent(new Event("input", { bubbles: true }));

  (document.querySelector('[data-xtream-choice="use"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('[name="newServer"]')).toBeTruthy());
  expect((document.querySelector('[name="newName"]') as HTMLInputElement).value).toBe(
    "Kept Name",
  );
});

test("playlist settings offer no all channels management action", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupCategory("News")], null, 1, 3)));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-preference="order"]')).toBeTruthy(),
  );

  const kinds = Array.from(
    document.querySelectorAll<HTMLElement>("[data-lineup-preference]"),
  ).map((row) => row.dataset.lineupPreference);
  expect(kinds).not.toContain("all-channels");
  expect(kinds).toContain("order");
  expect(document.querySelectorAll("#lineup [data-lineup-bulk]")).toHaveLength(2);
  const queries = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map(
      (call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
    );
  expect(queries.some((body) => body.scope === "channels" && !body.categoryKey)).toBe(false);
});

test("live categories reach a missing-channel override and remove it only after confirmation", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const missing = {
    kind: "unavailable",
    key: "channel-override:gone",
    recordKind: "channel-override",
    itemId: "gone",
    label: "Gone channel",
  };
  const mutations: unknown[] = [];
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "categories"
          ? lineupPage([lineupCategory("News"), missing], null, 2, revision)
          : lineupPage([], null, 0, revision),
      );
    }
    const body = JSON.parse(String(options?.body));
    mutations.push(body);
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row.unavailable")).toBeTruthy(),
  );

  const queries = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  expect(queries.some((body) => body.scope === "categories")).toBe(true);
  expect(queries.some((body) => body.scope === "channels" && !body.categoryKey)).toBe(false);

  (
    document.querySelector(
      '[data-lineup-remove][data-id="channel-override:gone"]',
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  answerConfirmation(false);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );
  expect(mutations).toHaveLength(0);

  (
    document.querySelector(
      '[data-lineup-remove][data-id="channel-override:gone"]',
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    mutation: { type: "unavailable.remove", key: "channel-override:gone" },
  });
});

test("an M3U playlist needs no content type selector", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, lineupSnapshot()))
    .mockImplementationOnce(() => reply(200, lineupPage([lineupCategory("News")])));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(document.querySelector('[data-lineup-kind="live"]')).toBeNull();
  expect(document.querySelector('[data-lineup-kind="movie"]')).toBeNull();
  expect(document.querySelector('[data-lineup-kind="series"]')).toBeNull();
  expect(document.querySelector(".lineup-tabs")).toBeNull();
  const query = JSON.parse(String(fetchMock.mock.calls[1][1].body));
  expect(query.contentKind).toBe("live");
});

test.each([
  { kind: "movie" as const, name: "Cinema", counts: { live: 0, movie: 2, series: 0 } },
  { kind: "series" as const, name: "Shows", counts: { live: 0, movie: 0, series: 2 } },
])(
  "a sole $kind Xtream playlist opens its real categories without a kind selector",
  async ({ kind, name, counts }) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => reply(200, xtreamLineupSnapshot()))
      .mockImplementationOnce(() => reply(200, lineupPage([], null, 0, 3, counts)))
      .mockImplementationOnce(() =>
        reply(200, lineupPage([lineupCategory(name, kind)], null, 1, 3, counts)),
      );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row strong")?.textContent).toBe(name),
    );
    const queries = fetchMock.mock.calls
      .filter((call) => call[0] === "/api/v1/lineup/query")
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(queries.map((body) => body.contentKind)).toEqual(["live", kind]);
    expect(document.querySelector("[data-lineup-kind]")).toBeNull();
    expect(document.querySelector(".lineup-tabs")).toBeNull();
  },
);

test("an Xtream playlist offers only its available content kinds", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const counts = { live: 2, movie: 3, series: 1 };
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, xtreamLineupSnapshot()))
    .mockImplementationOnce(() =>
      reply(200, lineupPage([lineupCategory("News")], null, 1, 3, counts)),
    )
    .mockImplementationOnce(() =>
      reply(200, lineupPage([lineupCategory("Cinema", "movie")], null, 1, 3, counts)),
    )
    .mockImplementationOnce(() =>
      reply(
        200,
        lineupPage(
          [{ kind: "item", id: "title-1", name: "Title", contentKind: "movie" }],
          null,
          1,
          3,
          counts,
        ),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("News"),
  );
  expect(document.querySelector('[data-lineup-kind="live"]')).toBeTruthy();
  expect(document.querySelector('[data-lineup-kind="movie"]')).toBeTruthy();
  expect(document.querySelector('[data-lineup-kind="series"]')).toBeTruthy();
  const liveTab = document.querySelector('[data-lineup-kind="live"]');
  expect(liveTab?.getAttribute("role")).toBe("tab");
  expect(document.querySelector(".lineup-tabs")?.getAttribute("role")).toBe("tablist");
  expect(liveTab?.getAttribute("aria-selected")).toBe("true");
  const layout = document.querySelector(".lineup-layout") as HTMLElement;
  const tabs = document.querySelector(".lineup-tabs") as HTMLElement;
  const preferences = document.querySelector("[data-lineup-preferences]") as HTMLElement;
  const list = document.querySelector(".lineup-list") as HTMLElement;
  expect(layout).toBeTruthy();
  expect(
    tabs.compareDocumentPosition(preferences) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    preferences.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(preferences.contains(document.querySelector('[data-lineup-preference="order"]'))).toBe(
    true,
  );
  expect(preferences.contains(document.querySelector(".lineup-order-attach"))).toBe(true);
  expect(preferences.querySelector('[data-lineup-preference="rename"]')).toBeNull();
  expect(preferences.querySelector('[data-lineup-preference="visibility"]')).toBeNull();
  expect(list.contains(document.querySelector(".lineup-row"))).toBe(true);
  expect(preferences.contains(list)).toBe(false);

  const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
  expect(panels).toHaveLength(1);
  const panel = panels[0];
  expect(panel.id).toBe("lineup-tab-panel");
  expect(panel.classList.contains("lineup-tab-content")).toBe(true);
  expect(liveTab?.id).toBe("lineup-tab-live");
  expect(liveTab?.getAttribute("aria-controls")).toBe(panel.id);
  expect(panel.getAttribute("aria-labelledby")).toBe(liveTab?.id);
  expect(panel.contains(preferences)).toBe(true);
  expect(panel.contains(list)).toBe(true);
  expect(panel.contains(tabs)).toBe(false);

  (document.querySelector('[data-lineup-kind="movie"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Cinema"),
  );
  const queries = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
  expect(queries.map((body) => body.contentKind)).toEqual(["live", "movie"]);
  expect(document.querySelectorAll('[data-lineup-kind][aria-selected="true"]')).toHaveLength(1);
  const movieTab = document.querySelector('[data-lineup-kind="movie"]');
  expect(movieTab?.getAttribute("aria-selected")).toBe("true");
  const moviePanel = document.getElementById(
    movieTab?.getAttribute("aria-controls") ?? "",
  ) as HTMLElement;
  expect(moviePanel).toBeTruthy();
  expect(moviePanel.classList.contains("lineup-tab-content")).toBe(true);
  expect(moviePanel.getAttribute("aria-labelledby")).toBe(movieTab?.id);
  expect(moviePanel.contains(document.querySelector("[data-lineup-preferences]"))).toBe(true);
  expect(moviePanel.contains(document.querySelector(".lineup-list"))).toBe(true);

  lineupRowOpenAction("Cinema");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Title"),
  );
  expect(document.querySelector(".lineup-tabs")).toBeNull();
  expect(document.querySelector('[role="tabpanel"]')).toBeNull();
  expect(document.querySelector(".lineup-tab-content")).toBeNull();
  expect(document.querySelector("[data-lineup-preferences]")).toBeTruthy();
  expect(document.querySelector(".lineup-preference-actions")).toBeNull();
});

test("content transitions scroll the section and focus the heading without extra scrolls", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: scrollIntoView,
  });
  const headingFocus: Array<{ options: FocusOptions | undefined }> = [];
  const originalFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (this.hasAttribute("data-lineup-heading")) headingFocus.push({ options });
    return originalFocus.call(this, options);
  };
  try {
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body));
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1)
            : lineupPage([lineupCategory("Sport")]),
        );
      }
      return reply(404, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    scrollIntoView.mockClear();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

    expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
    expect(crumb("Playlists")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    lineupRowOpenAction("Sport");
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
    );
    expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Sport");
    expect(crumb("News")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(document.activeElement?.closest(".lineup-row")).toBeTruthy());
    expect(headingFocus.length).toBeGreaterThan(0);
    expect(headingFocus.every((entry) => entry.options?.preventScroll === true)).toBe(true);

    crumb("News")?.click();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("Sport"),
    );
    expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
    const input = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    input.value = "sport";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) => {
          if (call[0] !== "/api/v1/lineup/query") return false;
          return JSON.parse(String((call[1] as RequestInit).body)).query === "sport";
        }),
      ).toHaveLength(1),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(3);
  } finally {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
    HTMLElement.prototype.focus = originalFocus;
  }
});

test("playlist settings sit above a headed results list", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  let orderMode = "";
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.scope === "channels") {
        return reply(
          200,
          lineupPage([lineupChannel(1)], null, 1, revision, undefined, orderMode || undefined),
        );
      }
      return reply(
        200,
        lineupPage(
          [lineupCategory("News")],
          null,
          1,
          revision,
          undefined,
          orderMode || undefined,
        ),
      );
    }
    const body = JSON.parse(String(options?.body));
    if (body.mutation && typeof body.mutation.mode === "string") {
      orderMode = body.mutation.mode;
    }
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  expect(document.querySelector("[data-lineup-options]")).toBeNull();
  const results = document.querySelector(".lineup-results") as HTMLElement;
  const resultsBody = results.querySelector(".lineup-results-body") as HTMLElement;
  expect(resultsBody).toBeTruthy();
  expect(resultsBody.querySelector(".lineup-state")).toBeNull();
  const listHead = results.querySelector(".list-head") as HTMLElement;
  expect(listHead).toBeTruthy();
  expect(listHead.querySelector(".list-title h3")?.textContent).toBe("Categories");
  expect(listHead.querySelector(".list-count")?.textContent).toBe("1");

  const searchToggle = listHead.querySelector("[data-lineup-search-toggle]");
  expect(searchToggle).toBeTruthy();
  expect(listHead.querySelector("[data-lineup-order]")).toBeNull();
  expect(listHead.querySelector('[data-item-menu="page"]')).toBeNull();
  expect(
    listHead.compareDocumentPosition(resultsBody) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(resultsBody.querySelector(".lineup-list")).toBeTruthy();

  const controls = document.querySelector(".lineup-controls") as HTMLElement;
  expect(controls).toBeTruthy();
  const preferences = controls.querySelector("[data-lineup-preferences]") as HTMLElement;
  expect(preferences).toBeTruthy();
  expect(preferences.classList.contains("lineup-order-settings")).toBe(true);
  expect(preferences.getAttribute("role")).toBe("group");
  expect(preferences.getAttribute("aria-label")).toBe("Playlist settings");
  expect(preferences.querySelector(".lineup-preferences-title")).toBeNull();
  expect(preferences.querySelector(".lineup-preferences-rows")).toBeNull();
  expect(preferences.querySelector(".lineup-order-attach")?.parentElement).toBe(preferences);
  const rows = Array.from(
    preferences.querySelectorAll<HTMLElement>("[data-lineup-preference]"),
  ).map((row) => row.dataset.lineupPreference);
  expect(rows).toEqual(["order"]);
  expect(preferences.querySelector('[data-lineup-preference="order"]')?.textContent).toContain(
    "Provider order",
  );
  expect(
    preferences.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(results.firstElementChild).toBe(listHead);
  expect(document.querySelector(".lineup-order")).toBeNull();
  expect(document.querySelector(".lineup-all-channels-row")).toBeNull();
  const listRows = Array.from(document.querySelectorAll(".lineup-list > *"));
  expect(listRows).toHaveLength(1);
  expect(listRows[0].classList.contains("lineup-row")).toBe(true);
  expect(listRows[0].getAttribute("data-lineup-id")).toBe("News");

  const queryCount = () =>
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query").length;
  const queriesBefore = queryCount();
  preferenceButton("order").click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  expect(document.querySelector(".lineup-order-hint")).toBeNull();
  orderOption("alphabetical").click();
  await vi.waitFor(() => expect(queryCount()).toBe(queriesBefore + 1));
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false"),
  );
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
  );
  expect(document.querySelector('[data-lineup-preference="order"]')).toBeTruthy();

  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-mode-back]")?.getAttribute("aria-label")).toBe(
      "Back",
    ),
  );
  expect(document.querySelector(".manage-rail")).toBeTruthy();
  expect(document.querySelector(".manage-edge-rail")).toBeNull();
  expect(document.querySelectorAll("[data-lineup-mode-back]")).toHaveLength(1);

  (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-preferences]")).toBeTruthy(),
  );
  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  const categoryPreferences = document.querySelector(
    "[data-lineup-preferences]",
  ) as HTMLElement;
  expect(categoryPreferences.classList.contains("lineup-order-settings")).toBe(true);
  expect(categoryPreferences.getAttribute("role")).toBe("group");
  expect(categoryPreferences.getAttribute("aria-label")).toBe("Category settings");
  expect(categoryPreferences.querySelector(".lineup-preferences-title")).toBeNull();
  expect(categoryPreferences.querySelector(".lineup-preferences-rows")).toBeNull();
  expect(categoryPreferences.querySelector(".lineup-order-attach")?.parentElement).toBe(
    categoryPreferences,
  );
  expect(categoryPreferences.querySelector('[data-lineup-preference="order"]')).toBeTruthy();
  expect(
    categoryPreferences.querySelector('[data-lineup-preference="custom-order"]'),
  ).toBeTruthy();
  await enterRemoteReorder();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-sort]")).toBeTruthy());
  exitRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-preferences]")).toBeTruthy(),
  );
});

test("the order dialog offers the settled option sequence per scope and kind", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const counts = { live: 1, movie: 1, series: 1 };
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.scope === "categories") {
        const kind = body.contentKind || "live";
        const name = kind === "movie" ? "Cinema" : kind === "series" ? "Shows" : "News";
        return reply(200, lineupPage([lineupCategory(name, kind)], null, 1, 3, counts));
      }
      if (body.scope === "items") {
        return reply(
          200,
          lineupPage(
            [
              {
                kind: "item",
                id: "title-1",
                name: "Title",
                contentKind: body.contentKind,
              },
            ],
            null,
            1,
            3,
            counts,
          ),
        );
      }
      return reply(200, lineupPage([lineupChannel(1)], null, 1, 3, counts));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("News"),
  );

  const orderValues = async () => {
    preferenceButton("order").click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
    );
    const values = Array.from(
      document.querySelectorAll<HTMLElement>("[data-lineup-order-option]"),
    ).map((option) => option.dataset.lineupOrderOption);
    (document.querySelector("[data-lineup-order-dismiss]") as HTMLElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
    );
    return values;
  };
  const drillIntoFirstCategory = async (name: string) => {
    firstLineupRowOpen();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row-channel, .lineup-row-item")).toBeTruthy(),
    );
    expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe(name);
  };
  const showKindCategories = async (kind: string, name: string) => {
    (
      document.querySelector(".content-head [data-lineup-mode-back]") as HTMLButtonElement
    ).click();
    await vi.waitFor(() => expect(document.querySelector(".lineup-row-category")).toBeTruthy());
    (document.querySelector(`[data-lineup-kind="${kind}"]`) as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row strong")?.textContent).toBe(name),
    );
  };

  expect(await orderValues()).toEqual(["provider", "alphabetical", "custom"]);

  await drillIntoFirstCategory("News");
  expect(await orderValues()).toEqual(["provider", "alphabetical", "number", "custom"]);

  await showKindCategories("movie", "Cinema");
  await drillIntoFirstCategory("Cinema");
  expect(await orderValues()).toEqual(["provider", "alphabetical", "custom"]);

  await showKindCategories("series", "Shows");
  await drillIntoFirstCategory("Shows");
  expect(await orderValues()).toEqual(["provider", "alphabetical", "custom"]);
});

test("custom categories form a nested level with working back paths", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const counts = { live: 1, movie: 0, series: 0 };
  const personal = {
    kind: "personal-category",
    id: "mine",
    name: "Mine",
    providerName: "Mine",
    hidden: false,
    count: 2,
    unavailableCount: 0,
  };
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") {
      return reply(200, lineupSnapshot({ capabilities: { customCategories: true } }));
    }
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.scope === "personal-categories") {
        return reply(200, lineupPage([personal], null, 1, 3, counts));
      }
      if (body.scope === "channels") {
        return reply(
          200,
          body.categoryKey
            ? lineupPage([lineupChannel(1)], null, 1, 3, counts)
            : lineupPage([lineupChannel(1), lineupChannel(2)], null, 2, 3, counts),
        );
      }
      return reply(200, lineupPage([lineupCategory("News")], null, 1, 3, counts));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  expect(document.querySelector("[data-lineup-kind]")).toBeNull();
  const customTab = document.querySelector(
    '[data-lineup-scope="personal-categories"]',
  ) as HTMLButtonElement;
  expect(customTab).toBeTruthy();
  customTab.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Mine"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe(
    "Custom categories",
  );
  expect(crumb("News")).toBeTruthy();
  expect(document.querySelector("[data-lineup-kind]")).toBeNull();
  expect(document.querySelector('[data-lineup-scope="personal-categories"]')).toBeNull();

  lineupRowOpenAction("mine");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Mine");
  expect(crumb("Custom categories")).toBeTruthy();

  (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Mine"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe(
    "Custom categories",
  );

  window.location.hash = "#playlists?view=content&playlist=pl-1&scope=channels&membership=mine";
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Add to category");
  expect(crumb("Custom categories")).toBeTruthy();

  crumb("Custom categories")?.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Mine"),
  );
  crumb("News")?.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("News"),
  );
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
  expect(crumb("Playlists")).toBeTruthy();

  const scopes = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)).scope);
  expect(scopes).toEqual([
    "categories",
    "personal-categories",
    "channels",
    "personal-categories",
    "channels",
    "personal-categories",
    "categories",
  ]);
});

test("page navigation and history restore content views without duplicate lineup queries", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    {
      id: "pl-1",
      name: "Main",
      source: { kind: "m3u", url: "http://example.com/list.m3u" },
      sourceVersion: 1,
    },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1)
          : lineupPage([lineupCategory("News"), lineupCategory("Sport")], null, 2),
      );
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  expect(document.querySelectorAll(".manage-page")).toHaveLength(1);
  expect(document.querySelector('[data-page="playlists"]')).toBeTruthy();
  expect(document.querySelector('[data-page="appearance"]')).toBeNull();

  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  expect(queries).toHaveLength(1);
  expect(window.location.hash).toContain("view=content");
  expect(window.location.hash).toContain("playlist=pl-1");
  expect(
    document.querySelector('.manage-rail .manage-nav-link[aria-current="page"]')?.textContent,
  ).toContain(labels.content);

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  expect(queries).toHaveLength(2);
  expect(queries[1].scope).toBe("channels");
  expect(queries[1].categoryKey).toBe("News");
  expect(window.location.hash).toContain("category=News");
  expect(
    document.querySelector('.manage-rail .manage-nav-link[aria-current="page"]')?.textContent,
  ).toContain(labels.content);

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#devices"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());
  expect(document.querySelector("#lineup")).toBeNull();
  expect(queries).toHaveLength(2);

  window.history.back();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  expect(queries).toHaveLength(3);
  expect(queries[2].scope).toBe("channels");
  expect(queries[2].categoryKey).toBe("News");
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");

  window.history.back();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  expect(queries).toHaveLength(4);
  expect(queries[3].scope).toBe("categories");
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Main");

  window.history.forward();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Channel 1"),
  );
  expect(queries).toHaveLength(5);
  expect(queries[4].scope).toBe("channels");
  expect(queries[4].categoryKey).toBe("News");

  window.history.forward();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());
  expect(queries).toHaveLength(5);
});

test("a direct content route restores the drilled view with a generic heading", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    {
      id: "pl-1",
      name: "Main",
      source: { kind: "m3u", url: "http://example.com/list.m3u" },
      sourceVersion: 1,
    },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      return reply(200, lineupPage([lineupChannel(1)], null, 1));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    "/#playlists?view=content&playlist=pl-1&scope=channels&kind=live&category=News",
  );
  await loadApp().start();

  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(queries).toHaveLength(1);
  expect(queries[0].scope).toBe("channels");
  expect(queries[0].categoryKey).toBe("News");
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Channels");
  expect(crumb("Playlists")).toBeTruthy();
  expect(crumb("Main")).toBeTruthy();
});

test("invalid and disabled-custom routes normalize to safe management views", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const queries: string[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      queries.push(JSON.parse(String(options?.body)).scope);
      return reply(200, lineupPage([lineupCategory("News")]));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);

  window.history.replaceState({}, "", "/#bogus");
  await loadApp().start();
  expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy();
  expect(document.querySelectorAll(".manage-page")).toHaveLength(1);
  expect(queries).toHaveLength(0);

  window.history.replaceState(
    {},
    "",
    "/#playlists?view=content&playlist=missing&scope=channels",
  );
  await loadApp().start();
  expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy();
  expect(queries).toHaveLength(0);

  window.history.replaceState(
    {},
    "",
    "/#playlists?view=content&playlist=pl-1&scope=personal-categories&custom=1",
  );
  await loadApp().start();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(queries).toEqual(["categories"]);
  expect(document.querySelector('[data-lineup-scope="personal-categories"]')).toBeNull();
  expect(document.querySelector(".lineup-tabs")).toBeNull();
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
});

test("each playlist card exposes its identity and ordered row actions", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Sport", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      const next =
        command.type === "playlist.activate" && command.id === "pl-2"
          ? lineupSnapshot({ playlists, activePlaylistId: "pl-2" })
          : lineupSnapshot({ playlists });
      return reply(200, { ok: true, snapshot: next });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const cards = () => [...document.querySelectorAll(".playlist-card")];
  expect(cards()).toHaveLength(2);
  const trigger = (id: string) =>
    document.querySelector(`[data-item-menu="playlist"][data-id="${id}"]`) as HTMLElement;
  const menuActions = () =>
    Array.from(document.querySelectorAll("[data-item-action]")).map(
      (entry) => (entry as HTMLElement).dataset.itemAction,
    );
  const menuAction = (actionId: string) =>
    document.querySelector(`[data-item-action="${actionId}"]`) as HTMLElement | null;

  const identity = (id: string) =>
    trigger(id).closest(".playlist-card")?.querySelector(".playlist-card-info") as HTMLElement;
  for (const id of ["pl-1", "pl-2"]) {
    const node = identity(id);
    expect(node.tagName).toBe("SPAN");
    expect(node.hasAttribute("data-item-menu")).toBe(false);
    expect(node.hasAttribute("data-id")).toBe(false);
    expect(node.getAttribute("role")).toBeNull();
    expect(node.getAttribute("tabindex")).toBeNull();
  }
  expect(trigger("pl-1").getAttribute("aria-label")).toBe("Actions, News");
  expect(trigger("pl-2").getAttribute("aria-label")).toBe("Actions, Sport");

  const openButton = (id: string) =>
    document.querySelector(
      `button[data-item-open="playlist"][data-id="${id}"]`,
    ) as HTMLButtonElement;
  expect(openButton("pl-1").getAttribute("aria-label")).toBe("Open, News");
  expect(openButton("pl-2").getAttribute("aria-label")).toBe("Open, Sport");
  for (const id of ["pl-1", "pl-2"]) {
    expect(identity(id).closest("button[data-item-open]")?.getAttribute("data-id")).toBe(id);
    expect(identity(id).closest("button[data-item-open]")?.contains(trigger(id))).toBe(false);
  }
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();

  trigger("pl-1").click();
  expect(menuActions()).toEqual(["activate", "refresh", "edit", "reset", "remove"]);
  expect(itemAction("refresh").textContent?.trim()).toBe(labels.refresh);
  expect(document.querySelector("[data-item-action-dialog]")?.getAttribute("aria-label")).toBe(
    "News",
  );
  expect(
    document
      .querySelector('[data-action="playlist-activate"][data-id="pl-1"]')
      ?.getAttribute("aria-pressed"),
  ).toBe("true");
  expect(menuAction("remove")?.className).toContain("danger");
  (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();

  trigger("pl-2").click();
  expect(itemAction("activate").getAttribute("aria-disabled")).toBeNull();
  itemAction("activate").click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const activateCommand = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).command;
  expect(activateCommand).toEqual({ type: "playlist.activate", id: "pl-2" });
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset?.itemMenu).toBe("playlist");
    expect(active?.dataset?.id).toBe("pl-2");
  });

  const callsAfterActivate = fetchMock.mock.calls.length;
  trigger("pl-2").click();
  expect(itemAction("activate").getAttribute("aria-disabled")).toBe("true");
  itemAction("activate").click();
  expect(fetchMock.mock.calls.length).toBe(callsAfterActivate);
  (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();

  fetchMock.mockImplementationOnce(() => reply(500, { ok: false, reason: "" }));
  playlistRowAction("pl-1", "activate");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset?.action).toBe("playlist-activate");
    expect(active?.dataset?.id).toBe("pl-1");
  });

  trigger("pl-2").click();
  itemAction("refresh").click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  const command = JSON.parse(String(fetchMock.mock.calls[3][1]?.body)).command;
  expect(command).toEqual({ type: "playlist.refresh", id: "pl-2" });

  openButton("pl-2").click();
  await vi.waitFor(() => expect(window.location.hash).toContain("view=content"));
  expect(window.location.hash).toContain("playlist=pl-2");

  crumb("Playlists")?.click();
  await vi.waitFor(() => expect(window.location.hash).not.toContain("view=content"));
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(openButton("pl-2"));
  });
});

test("the remote language picker commits through its hidden select", async () => {
  const commands: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot());
    if (path === "/api/v1/command") {
      commands.push(JSON.parse(String(options?.body)));
      return reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) });
    }
    return reply(404, {});
  });
  await startSavedRemote(fetchMock);
  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="setting-locale"]',
  )!;
  expect(trigger.getAttribute("aria-label")).toContain("Language");
  const native = document.querySelector<HTMLSelectElement>(
    '[data-picker-native][data-setting="locale"]',
  )!;
  expect(native.hidden).toBe(true);
  expect(native.tabIndex).toBe(-1);
  expect(native.getAttribute("aria-hidden")).toBe("true");
  native.options[1].disabled = true;
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(options.length).toBeGreaterThan(1);
  expect(options.every((option) => option.querySelector(".option-picker-check"))).toBe(true);
  expect(
    options.map((option) => option.querySelectorAll(".option-picker-check svg").length),
  ).toEqual([1, ...Array(options.length - 1).fill(0)]);
  expect(options.some((option) => option.querySelector(".option-picker-secondary"))).toBe(true);
  expect(options[1].querySelector(".option-picker-text")?.firstElementChild?.textContent).toBe(
    "فارسی",
  );
  expect(options[1].querySelector(".option-picker-secondary")?.textContent).toBe("Persian");
  options[0].dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect((document.activeElement as HTMLElement).dataset.pickerValue).toBe("en");
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  native.options[1].disabled = false;
  trigger.click();
  (
    document.querySelector('[role="option"][data-picker-value="fa"]') as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]?.command).toEqual({ type: "setting", key: "locale", value: "fa" });
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(document.activeElement).toBe(
    document.querySelector('[data-picker-trigger="setting-locale"]'),
  );
});

test("a same owner rerender restores an open picker and navigation closes it", async () => {
  const fetchMock = vi.fn((path: string) =>
    path === "/api/v1/state" ? reply(200, snapshot()) : reply(404, {}),
  );
  const app = await startSavedRemote(fetchMock);
  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="setting-locale"]',
  )!;
  (document.querySelector('[data-setting="showClock"]') as HTMLInputElement).focus();
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(document.activeElement).toBe(trigger);
  const oldPopup = document.querySelector<HTMLElement>('[role="listbox"]')!;
  const highlighted = oldPopup.querySelector<HTMLElement>('[data-picker-value="fa"]')!;
  highlighted.dispatchEvent(new Event("pointerenter"));
  oldPopup.scrollTop = 36;
  app.renderManageForTest();
  const restoredPopup = document.querySelector<HTMLElement>('[role="listbox"]')!;
  expect(restoredPopup).not.toBe(oldPopup);
  expect(restoredPopup.scrollTop).toBe(36);
  expect(
    restoredPopup.querySelector('[data-picker-value="fa"]')?.classList.contains("highlighted"),
  ).toBe(true);
  expect((document.activeElement as HTMLElement).dataset.pickerValue).toBe("fa");

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#playback"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="playback"]')).toBeTruthy());
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect((document.activeElement as HTMLElement).dataset.pickerValue).not.toBe("fa");
});

test("replacing picker auth closes old listeners and keeps the new picker owned", async () => {
  const fetchMock = vi.fn((path: string) =>
    path === "/api/v1/state" ? reply(200, snapshot()) : reply(404, {}),
  );
  const app = await startSavedRemote(fetchMock);
  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  let trigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="setting-locale"]',
  )!;
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(document.querySelector("[role='listbox']")).toBeTruthy();

  app.replaceAuthForTest({ deviceId: "next", credential: "next" });
  expect(document.querySelector("[role='listbox']")).toBeNull();
  trigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="setting-locale"]',
  )!;
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  const popup = document.querySelector<HTMLElement>('[role="listbox"]')!;
  popup.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(document.querySelector("[role='listbox']")).toBe(popup);

  const escapeEvent = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(escapeEvent);
  expect(escapeEvent.defaultPrevented).toBe(true);
  expect(document.querySelector("[role='listbox']")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("the remote picker flips and clamps within the phone viewport", async () => {
  const fetchMock = vi.fn((path: string) =>
    path === "/api/v1/state" ? reply(200, snapshot()) : reply(404, {}),
  );
  await startSavedRemote(fetchMock);
  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  const trigger = document.querySelector<HTMLButtonElement>(
    '[data-picker-trigger="setting-locale"]',
  )!;
  const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const originalHeight = Object.getOwnPropertyDescriptor(window, "innerHeight");
  const originalDirection = document.documentElement.dir;
  let rect = { left: 220, right: 340, top: 560, bottom: 604, width: 120, height: 44 };
  trigger.getBoundingClientRect = () =>
    ({ ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 360 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
  try {
    trigger.click();
    const popup = document.querySelector<HTMLElement>('[role="listbox"]')!;
    Object.defineProperty(popup, "scrollHeight", { configurable: true, value: 500 });
    window.dispatchEvent(new Event("resize"));
    expect(popup.style.width).toBe("280px");
    expect(popup.style.left).toBe("60px");
    expect(popup.style.top).toBe("192px");
    expect(popup.style.maxHeight).toBe("360px");
    expect(
      Number.parseFloat(popup.style.top) + Number.parseFloat(popup.style.maxHeight),
    ).toBeLessThanOrEqual(rect.top - 8);

    rect = { left: 220, right: 340, top: 80, bottom: 124, width: 120, height: 44 };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    window.dispatchEvent(new Event("resize"));
    expect(popup.style.top).toBe("132px");
    expect(popup.style.maxHeight).toBe("360px");
    expect(document.querySelector('[role="listbox"]')).toBe(popup);

    rect = { left: 220, right: 340, top: 560, bottom: 604, width: 120, height: 44 };
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    document.documentElement.dir = "rtl";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    window.dispatchEvent(new Event("scroll"));
    expect(popup.style.width).toBe("280px");
    expect(Number.parseFloat(popup.style.width)).toBeLessThanOrEqual(288);
    expect(popup.style.left).toBe("24px");
    expect(document.querySelector('[role="listbox"]')).toBe(popup);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    outside.remove();
  } finally {
    document.documentElement.dir = originalDirection;
    if (originalWidth) Object.defineProperty(window, "innerWidth", originalWidth);
    if (originalHeight) Object.defineProperty(window, "innerHeight", originalHeight);
    const close = document.querySelector<HTMLButtonElement>(
      '[data-picker-trigger="setting-locale"]',
    );
    if (close && document.querySelector('[role="listbox"]')) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    }
  }
});

test("management page motion preserves elapsed time through a same view render", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/command") {
      return reply(200, { ok: true, snapshot: lineupSnapshot({ revision: 1 }) });
    }
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1)
          : lineupPage([lineupCategory("News")], null, 1),
      );
    }
    return reply(404, {});
  });
  try {
    await startSavedRemote(fetchMock);
    clock.mockReturnValue(1100);
    (
      document.querySelector(
        '.manage-rail .manage-nav-link[href="#appearance"]',
      ) as HTMLAnchorElement
    ).click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
    );
    expect(
      document
        .querySelector('[data-page="appearance"]')
        ?.classList.contains("management-view-enter"),
    ).toBe(true);
    expect(
      document.querySelector(".manage-rail")?.classList.contains("management-view-enter"),
    ).toBe(false);

    clock.mockReturnValue(1160);
    (document.querySelector('[data-setting="showClock"]') as HTMLInputElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        (document.querySelector('[data-page="appearance"]') as HTMLElement).style
          .animationDelay,
      ).toBe("-60ms"),
    );
    clock.mockReturnValue(1200);
    (
      document.querySelector(
        '.manage-rail .manage-nav-link[href="#playlists"]',
      ) as HTMLAnchorElement
    ).click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
    );
    (
      document.querySelector(
        '[data-page="content-settings"] a[href="#playlists/list"]',
      ) as HTMLAnchorElement
    ).click();
    await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelector(".lineup-row-category")).toBeTruthy());
    clock.mockReturnValue(1300);
    lineupRowOpenAction("News");
    await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
    expect(
      document.querySelector(".lineup-content")?.classList.contains("management-view-enter"),
    ).toBe(true);
    expect(
      document.querySelector(".manage-page")?.classList.contains("management-view-enter"),
    ).toBe(false);
    expect(
      document.querySelector(".manage-rail")?.classList.contains("management-view-enter"),
    ).toBe(false);
  } finally {
    clock.mockRestore();
  }
});

test("playlist surfaces mirror the settings ordering", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      reply(
        200,
        snapshot({
          playlists: [
            {
              id: "pl-1",
              name: "News",
              source: { kind: "m3u", url: "http://a" },
              sourceVersion: 1,
            },
            {
              id: "pl-2",
              name: "Sport",
              source: { kind: "m3u", url: "http://b" },
              sourceVersion: 1,
            },
          ],
        }),
      ),
    ),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const pageHead = document.querySelector('[data-page="playlists"] .page-head') as HTMLElement;
  expect(pageHead).toBeTruthy();
  expect(pageHead.querySelector("h1")?.textContent).toBe("Saved playlists");
  expect(pageHead.querySelector(".page-head-count")?.textContent).toBe("2");
  const list = document.querySelector(".playlist-list") as HTMLElement;
  expect(
    pageHead.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const addButton = pageHead.querySelector(
    '[data-action="open-add-playlist"]',
  ) as HTMLButtonElement;
  expect(addButton).toBeTruthy();

  addButton.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  const addOverlay = document.querySelector(
    '[data-form-overlay="playlist-add"]',
  ) as HTMLElement;
  expect(addOverlay.getAttribute("role")).toBe("dialog");
  expect(addOverlay.getAttribute("aria-modal")).toBe("true");
  expect(addOverlay.querySelector("#playlist-add-title")?.textContent).toBe(labels.addPlaylist);
  expect(addOverlay.querySelector(".crumbs")).toBeNull();
  expect(addOverlay.closest(".manage-page")).toBeNull();
  expect(addOverlay.parentElement?.querySelector("[data-playlist-add-dismiss]")).toBeTruthy();
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();
  const addForm = addOverlay.querySelector("[data-add-playlist-form]") as HTMLElement;
  const addBody = addForm.querySelector(".lineup-editor-body") as HTMLElement;
  const addChildren = Array.from(addBody.children);
  expect(addChildren[0].classList.contains("source-options")).toBe(true);
  expect(addChildren[1].classList.contains("add-source-fields")).toBe(true);
  expect(addChildren[2].tagName).toBe("LABEL");
  expect(addChildren[2].textContent).toContain(labels.playlistName);
  const addSources = Array.from(addChildren[0].querySelectorAll("button")).map(
    (button) => (button as HTMLElement).dataset.source,
  );
  expect(addSources).toEqual(["m3u", "xtream"]);
  const addFooter = addForm.querySelector(".form-actions") as HTMLElement;
  expect(addFooter.classList.contains("lineup-editor-footer")).toBe(true);
  const addActions = Array.from(addFooter.querySelectorAll("button"));
  expect(addActions.map((button) => button.textContent?.trim())).toEqual(["Cancel", "Save"]);
  expect((addActions[1] as HTMLButtonElement).type).toBe("submit");
  expect((addActions[1] as HTMLElement).dataset.action).toBe("add-playlist");

  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('[name="newServer"]')).toBeTruthy());
  const xtreamNames = Array.from(
    (document.querySelector(".add-source-fields") as HTMLElement).querySelectorAll(
      "input, select",
    ),
  ).map((control) => control.getAttribute("name"));
  expect(xtreamNames).toEqual(["newServer", "newUsername", "newPassword", "newOutput"]);
  const output = document.querySelector('[name="newOutput"]') as HTMLSelectElement;
  expect(output.closest(".option-picker-field")).toBeTruthy();
  expect([...output.options].map((option) => option.value)).toEqual(["m3u8", "ts"]);
  expect([...output.options].map((option) => option.textContent)).toEqual([
    labels.hls,
    labels.mpegTs,
  ]);

  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());

  openPlaylistEdit("pl-2");
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeTruthy());
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();
  const overlay = document.querySelector('[data-form-overlay="playlist-edit"]') as HTMLElement;
  expect(overlay.getAttribute("role")).toBe("dialog");
  expect(overlay.getAttribute("aria-modal")).toBe("true");
  expect(overlay.querySelector("#playlist-edit-title")?.textContent).toBe(labels.editAddress);
  expect(overlay.querySelector(".playlist-edit-name")?.textContent).toBe("Sport");
  const editForm = overlay.querySelector("[data-edit-playlist]") as HTMLElement;
  expect(editForm.dataset.id).toBe("pl-2");
  const editBody = editForm.querySelector(".lineup-editor-body") as HTMLElement;
  const editFields = Array.from(editBody.children);
  expect(editFields[0].classList.contains("source-options")).toBe(true);
  expect(editFields[1].classList.contains("add-source-fields")).toBe(true);
  expect(editFields[2].tagName).toBe("LABEL");
  expect(editFields[2].textContent).toContain(labels.playlistName);
  const editFooter = editForm.querySelector(".form-actions") as HTMLElement;
  const editActions = Array.from(editFooter.querySelectorAll("button"));
  expect(editActions.map((button) => button.textContent?.trim())).toEqual(["Cancel", "Save"]);
  expect(document.querySelector(".danger-zone")).toBeNull();
  expect(document.querySelector('[data-action="remove-playlist"]')).toBeNull();
});

test("playlist form drafts survive navigation and cancel restores the opener", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "Draft list";
  (document.querySelector('[name="newUrl"]') as HTMLInputElement).value =
    "http://example.com/draft.m3u";
  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#devices"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());
  window.history.back();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  expect((document.querySelector('[name="newName"]') as HTMLInputElement).value).toBe(
    "Draft list",
  );
  expect((document.querySelector('[name="newUrl"]') as HTMLInputElement).value).toBe(
    "http://example.com/draft.m3u",
  );
  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy(),
  );
  await vi.waitFor(() => {
    expect((document.activeElement as HTMLElement | null)?.dataset.action).toBe(
      "open-add-playlist",
    );
  });

  openPlaylistEdit();
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeTruthy());
  const editedNameField = document.querySelector<HTMLInputElement>('[name="editName"]')!;
  editedNameField.value = "Renamed draft";
  editedNameField.dispatchEvent(new Event("input", { bubbles: true }));
  (
    document.querySelector('.manage-rail .manage-nav-link[href="#about"]') as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="about"]')).toBeTruthy());
  window.history.back();
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeTruthy());
  expect((document.querySelector('[name="editName"]') as HTMLInputElement).value).toBe(
    "Renamed draft",
  );
  (document.querySelector('[data-action="cancel-edit-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy(),
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemMenu).toBe("playlist");
    expect(active?.dataset.id).toBe("pl-1");
  });
});

test("a new pairing cannot reuse a prior session's playlist edit draft", async () => {
  let paired = false;
  const app = await startSavedRemote(
    vi.fn((path: string) => {
      if (path === "/api/v1/status") return reply(200, publicState);
      if (path === "/api/v1/pair") {
        paired = true;
        return reply(200, { ok: true, deviceId: "device-new", credential: "new-key" });
      }
      if (path === "/api/v1/state") {
        return reply(
          200,
          snapshot({
            revision: paired ? 10 : 0,
            playlists: [
              {
                id: "pl-1",
                name: paired ? "Current saved name" : "News",
                source: { kind: "m3u", url: "http://example.com/list.m3u" },
                sourceVersion: 1,
              },
            ],
          }),
        );
      }
      return reply(401, {});
    }),
  );
  openPlaylistEdit();
  const name = document.querySelector<HTMLInputElement>('[name="editName"]')!;
  name.value = "Previous session draft";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  (
    document.querySelector('.manage-rail .manage-nav-link[href="#about"]') as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="about"]')).toBeTruthy());
  await app.sendCommandForTest(
    { type: "setting", key: "showClock", value: false },
    false,
    null,
  );
  await pairNewRemoteSession();
  window.location.hash = "#playlists/list";
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
  openPlaylistEdit();
  expect((document.querySelector('[name="editName"]') as HTMLInputElement).value).toBe(
    "Current saved name",
  );
});

test("the devices page lists every device with direct rename and revoke actions", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const devices = [
    { id: "p", name: "This phone", createdAt: 1, lastUsedAt: 1 },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `device-${index + 1}`,
      name: `Device ${index + 1}`,
      createdAt: index + 1,
      lastUsedAt: index + 1,
    })),
  ];
  const sent: unknown[] = [];
  let revision = 0;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot({ revision, devices }));
    const body = JSON.parse(String(options?.body));
    sent.push(body.command);
    revision += 1;
    return reply(200, { ok: true, snapshot: snapshot({ revision, devices }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#devices");
  await loadApp().start();

  expect(document.querySelectorAll(".device-card")).toHaveLength(6);
  const selfCard = document.querySelector(".device-card") as HTMLElement;
  const selfHeading = selfCard.querySelector(".device-card-heading") as HTMLElement;
  expect(selfHeading?.querySelector("strong")?.textContent).toBe("This phone");
  expect(selfHeading?.querySelector(".self-badge")?.textContent).toBe("This device");
  expect(selfCard.querySelector(".device-card-main")?.getAttribute("aria-label")).toBe(
    labels.rename + ", This phone",
  );

  deviceRowAction("device-1", "rename");
  const form = document.querySelector(
    '[data-edit-device][data-id="device-1"]',
  ) as HTMLFormElement;
  expect(form).toBeTruthy();
  (form.querySelector('[name="editDeviceName"]') as HTMLInputElement).value = "Kitchen";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  expect(sent[0]).toEqual({ type: "device.rename", id: "device-1", name: "Kitchen" });
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.action).toBe("device-rename");
    expect(active?.dataset.id).toBe("device-1");
  });

  deviceRowAction("device-2", "remove");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual({ type: "device.revoke", id: "device-2" });
  expect(window.confirm).not.toHaveBeenCalled();

  deviceRowAction("p", "remove");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  expect(confirmDialog().textContent).toContain(labels.revokeSelfConfirm);
  await confirmAndSettle();
  await vi.waitFor(() => expect(sent).toHaveLength(3));
  expect(sent[2]).toEqual({ type: "device.revoke", id: "p" });
  expect(window.confirm).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairTitle));
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
});

test("the mobile navigation drawer opens, focuses, navigates and closes", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  await loadApp().start();

  const opener = document.querySelector('[data-action="open-nav"]') as HTMLButtonElement;
  expect(opener).toBeTruthy();
  opener.click();
  const drawer = document.querySelector("[data-nav-drawer]") as HTMLDialogElement;
  expect(drawer.open).toBe(true);
  await vi.waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));

  (drawer.querySelector('.manage-nav-link[href="#about"]') as HTMLAnchorElement).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="about"]')).toBeTruthy());
  expect(document.querySelector("[data-nav-drawer]")?.hasAttribute("open")).toBe(false);

  (document.querySelector('[data-action="open-nav"]') as HTMLButtonElement).click();
  const reopened = document.querySelector("[data-nav-drawer]") as HTMLDialogElement;
  expect(reopened.open).toBe(true);
  reopened.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  expect(reopened.open).toBe(false);

  (document.querySelector('[data-action="open-nav"]') as HTMLButtonElement).click();
  const again = document.querySelector("[data-nav-drawer]") as HTMLDialogElement;
  expect(again.open).toBe(true);
  (again.querySelector('[data-action="close-nav"]') as HTMLButtonElement).click();
  expect(again.open).toBe(false);
});

test("the header remote launcher opens the control sheet and sends keys", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback),
  );
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const commands: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot());
    if (path === "/api/v1/command") {
      commands.push(JSON.parse(String(options?.body)).command);
      return reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const launcher = document.querySelector('[data-action="open-remote"]') as HTMLButtonElement;
  expect(launcher.closest(".manage-top")).toBeTruthy();
  launcher.click();
  const overlay = document.querySelector("[data-remote-overlay]") as HTMLElement;
  expect(overlay.hidden).toBe(false);
  expect(overlay.classList.contains("open")).toBe(false);
  frames.splice(0).forEach((callback) => {
    callback(0);
  });
  expect(overlay.classList.contains("open")).toBe(true);

  (document.querySelector('[data-remote-key="13"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toEqual({ type: "remote.key", code: 13 });

  (document.querySelector('[data-action="close-remote"]') as HTMLButtonElement).click();
  expect(overlay.classList.contains("open")).toBe(false);
  expect(launcher.getAttribute("aria-expanded")).toBe("false");
});

test("drilled channel rows expose edit and a dedicated visibility switch", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  let hidden = false;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([{ ...lineupChannel(1), hidden }], null, 1, revision)
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    revision += 1;
    hidden = true;
    return reply(200, { ok: true, revision, affectedIds: ["channel-1"] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel")?.textContent).toContain("Channel 1"),
  );

  const row = document.querySelector(".lineup-row-channel") as HTMLElement;
  const identity = row.querySelector(".lineup-row-open-info") as HTMLElement;
  expect(identity?.tagName).toBe("BUTTON");
  expect(identity?.tabIndex).toBe(0);
  expect(identity?.hasAttribute("data-settings-informational")).toBe(false);
  expect(identity?.dataset.lineupProviderId).toBe("channel-1");
  expect(identity?.getAttribute("aria-label")).toBe("Open, 2 Channel 1");
  expect(identity?.textContent).toContain("Channel 1");
  expect(row.querySelector("button[data-item-open]")).toBe(identity);
  expect(row.querySelector(".lineup-compact-menu[data-item-menu='lineup']")).toBeTruthy();
  expect(row.querySelector("details")).toBeNull();
  expect(row.querySelector(".lineup-item-actions")).toBeNull();

  const callsBeforeIdentity = fetchMock.mock.calls.length;
  const hashBeforeIdentity = window.location.hash;
  identity!.querySelector<HTMLElement>("strong")!.click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeTruthy());
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
  expect(fetchMock.mock.calls.length).toBe(callsBeforeIdentity);
  expect(window.location.hash).toBe(hashBeforeIdentity);
  (document.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());
  expect((document.activeElement as HTMLElement | null)?.dataset.lineupProviderId).toBe(
    "channel-1",
  );

  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");
  (document.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());

  const control = document.querySelector(
    '[data-lineup-visibility][data-id="channel-1"]',
  ) as HTMLElement;
  expect(control.getAttribute("role")).toBe("switch");
  expect(control.getAttribute("aria-checked")).toBe("true");

  control.click();
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.some((call) => call[0] === "/api/v1/lineup/mutation")).toBe(
      true,
    ),
  );
  const mutationCall = fetchMock.mock.calls.find(
    (call) => call[0] === "/api/v1/lineup/mutation",
  );
  expect(JSON.parse(String(mutationCall?.[1]?.body)).mutation).toEqual({
    type: "channel.visibility",
    channelId: "channel-1",
    hidden: true,
  });
  await vi.waitFor(() =>
    expect(
      document
        .querySelector('[data-lineup-visibility][data-id="channel-1"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false"),
  );
});

const normalizedRouteCases: Array<{
  name: string;
  query: string;
  enabled: boolean;
  xtream: boolean;
  scope: string;
  kind?: string;
  category?: string;
  noCategoryKey?: boolean;
}> = [
  {
    name: "personal categories without a flag",
    query: "scope=personal-categories",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "personal categories with a zero flag",
    query: "scope=personal-categories&custom=0",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "membership without a flag",
    query: "scope=channels&membership=mine",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "custom membership",
    query: "scope=channels&custom=1&membership=mine",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "custom member category",
    query: "scope=channels&custom=1&category=mine",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "an invalid kind",
    query: "scope=categories&kind=bogus",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "M3U items",
    query: "scope=items&kind=movie&category=News",
    enabled: false,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "Xtream items without a category",
    query: "scope=items&kind=movie",
    enabled: false,
    xtream: true,
    scope: "categories",
    kind: "movie",
  },
  {
    name: "Xtream items with a category",
    query: "scope=items&kind=movie&category=News",
    enabled: false,
    xtream: true,
    scope: "items",
    kind: "movie",
    category: "News",
  },
  {
    name: "enabled personal categories without a flag",
    query: "scope=personal-categories",
    enabled: true,
    xtream: false,
    scope: "personal-categories",
    kind: "live",
  },
  {
    name: "unscoped channels",
    query: "scope=channels",
    enabled: true,
    xtream: false,
    scope: "categories",
    kind: "live",
  },
  {
    name: "enabled membership without a flag",
    query: "scope=channels&membership=mine",
    enabled: true,
    xtream: false,
    scope: "channels",
    noCategoryKey: true,
  },
  {
    name: "enabled custom member category",
    query: "scope=channels&custom=1&category=mine",
    enabled: true,
    xtream: false,
    scope: "channels",
    category: "mine",
  },
];

test.each(normalizedRouteCases)(
  "normalizes the cold content route for $name before the first query",
  async ({ query, enabled, xtream, scope, kind, category, noCategoryKey }) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const state = enabled
      ? lineupSnapshot({ capabilities: { customCategories: true } })
      : xtream
        ? xtreamLineupSnapshot()
        : lineupSnapshot();
    const queries: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, state);
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          queries.push(body);
          return reply(
            200,
            lineupPage([lineupCategory("News")], null, 1, 3, {
              live: 1,
              movie: 1,
              series: 1,
            }),
          );
        }
        return reply(404, {});
      }),
    );
    window.history.replaceState({}, "", `/#playlists?view=content&playlist=pl-1&${query}`);
    await loadApp().start();

    await vi.waitFor(() => expect(queries).toHaveLength(1));
    expect(queries[0].playlistId).toBe("pl-1");
    expect(queries[0].scope).toBe(scope);
    if (kind) expect(queries[0].contentKind).toBe(kind);
    if (category) expect(queries[0].categoryKey).toBe(category);
    if (noCategoryKey) expect(queries[0].categoryKey).toBeUndefined();
    expect(window.location.hash).toContain(`scope=${scope}`);
  },
);

test("revocation returns to pairing and later hash navigation cannot resurrect management", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const devices = [
    { id: "p", name: "This phone", createdAt: 1, lastUsedAt: 1 },
    { id: "device-2", name: "Other device", createdAt: 2, lastUsedAt: 2 },
  ];
  const stateCalls: string[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") {
      stateCalls.push(path);
      return reply(200, snapshot({ devices }));
    }
    if (path === "/api/v1/status") return reply(200, publicState);
    if (path === "/api/v1/command") {
      const body = JSON.parse(String(options?.body)) as { command?: { type?: string } };
      if (body.command?.type === "device.revoke") {
        return reply(200, { ok: true, snapshot: snapshot({ devices }) });
      }
      return reply(200, { ok: true, snapshot: snapshot({ devices, revision: 1 }) });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#devices"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector('[data-page="devices"]')).toBeTruthy());

  deviceRowAction("p", "remove");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();
  await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairTitle));
  expect(localStorage.getItem("openiptv.remote")).toBeNull();
  expect(document.querySelector(".manage")).toBeNull();

  const callsAfterRevoke = fetchMock.mock.calls.length;
  window.history.replaceState({}, "", "/#about");
  window.dispatchEvent(new Event("hashchange"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.body.textContent).toContain(labels.pairTitle);
  expect(fetchMock).toHaveBeenCalledTimes(callsAfterRevoke);
  expect(stateCalls).toHaveLength(1);

  const app = loadApp();
  await app.start();
  await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairTitle));
  window.history.replaceState({}, "", "/#about");
  window.dispatchEvent(new Event("hashchange"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.body.textContent).toContain(labels.pairTitle);
  expect(stateCalls).toHaveLength(1);
});

test("a 401 command and an unreachable TV both ignore later hash navigation", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  window.history.replaceState({}, "", "/#playlists/list");
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, snapshot());
    if (path === "/api/v1/command") return reply(401, {});
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();
  playlistRowAction("pl-1", "refresh");
  await vi.waitFor(() => expect(document.body.textContent).toContain(labels.pairTitle));
  expect(localStorage.getItem("openiptv.remote")).toBeNull();

  const callsAfterRevoke = fetchMock.mock.calls.length;
  window.history.replaceState({}, "", "/#playback");
  window.dispatchEvent(new Event("hashchange"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".manage")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(callsAfterRevoke);

  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await loadApp().start();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Cannot reach your TV"));
  window.history.replaceState({}, "", "/#devices");
  window.dispatchEvent(new Event("hashchange"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".manage")).toBeNull();
  expect(document.body.textContent).toContain("Cannot reach your TV");
});

test("a reloaded content route keeps its category title from bound history metadata", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1)
          : lineupPage([lineupCategory("News"), lineupCategory("Sport")], null, 2),
      );
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News"),
  );

  const queriesBefore = queries.length;
  await loadApp().start();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
  expect(queries).toHaveLength(queriesBefore + 1);
  expect(queries[queries.length - 1].scope).toBe("channels");
  expect(queries[queries.length - 1].categoryKey).toBe("News");
});

test("an inactive deep content route manages its own owner through the conflict reload", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "Main", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Archive", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.revision === 0) {
        return reply(409, { ok: false, reason: "conflict", revision: 7 });
      }
      return reply(200, lineupPage([lineupChannel(1)], null, 1, 7));
    }
    if (path === "/api/v1/command") return reply(500, {});
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    "/#playlists?view=content&playlist=pl-2&scope=channels&kind=live&category=News",
  );
  await loadApp().start();

  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Channels");
  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatchObject({
    playlistId: "pl-2",
    revision: 0,
    scope: "channels",
    categoryKey: "News",
  });
  expect(queries[1]).toMatchObject({ playlistId: "pl-2", revision: 7, scope: "channels" });
  expect(fetchMock.mock.calls.some((call) => call[0] === "/api/v1/command")).toBe(false);
});

test("history back during a pending placement write restores the route and keeps reorder mode", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const news = lineupCategory("News");
  const sport = lineupCategory("Sport");
  const mutations: unknown[] = [];
  let finishMutation: (value: unknown) => void = () => {};
  const mutationPending = new Promise((resolve) => {
    finishMutation = resolve;
  });
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return reply(
        200,
        lineupPage([sport, news], null, 2, Number(body.revision) || 3, undefined, "custom"),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      mutations.push(JSON.parse(String(options?.body)).mutation);
      return mutationPending;
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  (document.querySelector('[data-lineup-sort][data-id="News"]') as HTMLButtonElement).click();
  (document.querySelector('[data-lineup-sort][data-id="Sport"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));

  const contentHash = window.location.hash;
  window.history.back();
  await vi.waitFor(() => expect(window.location.hash).toBe(contentHash));
  expect(document.querySelector(".lineup-sort-list")).toBeTruthy();
  expect(mutations).toHaveLength(1);

  finishMutation({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision: 4, affectedIds: ["News"] }),
  });
  await vi.waitFor(() => expect(document.querySelector(".lineup-sort-list")).toBeTruthy());
  expect(document.querySelector("[data-lineup-mode-back]")).toBeTruthy();
});

test("history back dismisses a non-saving editor and restores its opener", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1)
          : lineupPage([lineupCategory("News")], null, 1),
      );
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");
  const drilledHash = window.location.hash;

  window.history.back();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());
  expect(window.location.hash).toBe(drilledHash);
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-edit")).toBe(true);
    expect(active?.dataset.id).toBe("channel-1");
  });
});

test("add playlist drafts end on cancel and success while the form submits natively", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 0;
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const commands: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot({ revision, playlists }));
    const body = JSON.parse(String(options?.body)) as {
      command?: { type?: string; name?: string; source?: unknown };
    };
    commands.push(body.command);
    revision += 1;
    if (body.command?.type === "playlist.add") {
      playlists.push({
        id: "pl-2",
        name: String(body.command.name || ""),
        source: body.command.source as { kind: string; url: string },
        sourceVersion: 1,
      });
    }
    return reply(200, { ok: true, snapshot: snapshot({ revision, playlists }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const openAdd = () =>
    (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  const addForm = () => document.querySelector("[data-add-playlist-form]") as HTMLFormElement;
  const field = (name: string) =>
    document.querySelector(`[name="${name}"]`) as HTMLInputElement;

  openAdd();
  await vi.waitFor(() => expect(addForm()).toBeTruthy());
  field("newName").value = "Draft";
  field("newUrl").value = "http://example.com/draft.m3u";
  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());

  openAdd();
  await vi.waitFor(() => expect(addForm()).toBeTruthy());
  expect(field("newName").value).toBe("");
  expect(field("newUrl").value).toBe("");

  field("newName").value = "Second";
  field("newUrl").value = "http://example.com/second.m3u";
  addForm().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(commands).toHaveLength(1));
  expect(commands[0]).toEqual({
    type: "playlist.add",
    name: "Second",
    source: { kind: "m3u", url: "http://example.com/second.m3u" },
  });
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(2));

  openAdd();
  await vi.waitFor(() => expect(addForm()).toBeTruthy());
  expect(field("newName").value).toBe("");
  expect(field("newUrl").value).toBe("");
});

test("category rows navigate directly, channel rows open their editor and bulk actions share the toolbar", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  const mutations: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1, revision)
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    const body = JSON.parse(String(options?.body)) as { mutation?: unknown };
    mutations.push(body.mutation);
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  const categoryRow = document.querySelector(".lineup-row-category") as HTMLElement;
  const categoryIdentity = categoryRow.querySelector(".lineup-row-main") as HTMLElement;
  expect(categoryIdentity?.textContent).toContain("News");
  const categoryOpen = categoryRow.querySelector(
    'button[data-item-open="lineup"][data-id="News"]',
  ) as HTMLElement;
  expect(categoryOpen?.getAttribute("aria-label")).toBe("Open, News");
  expect(categoryOpen?.contains(categoryIdentity)).toBe(true);
  expect(
    categoryRow.querySelector(".lineup-compact-menu[data-item-menu='lineup']"),
  ).toBeTruthy();
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
  expect(document.querySelector(".lineup-editor-dialog")).toBeNull();

  await openRemoteRename("News");
  expect(document.querySelector('[name="editorValue"]')).toBeTruthy();
  (document.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-category")).toBeTruthy());

  const bulkButtons = document.querySelectorAll<HTMLButtonElement>(
    "#lineup [data-lineup-bulk]",
  );
  expect(bulkButtons).toHaveLength(2);
  expect(Array.from(bulkButtons).map((entry) => entry.dataset.lineupBulk)).toEqual([
    "show",
    "hide",
  ]);
  const showAll = document.querySelector('[data-lineup-bulk="show"]') as HTMLButtonElement;
  const hideAll = document.querySelector('[data-lineup-bulk="hide"]') as HTMLButtonElement;
  for (const button of [showAll, hideAll]) {
    const label = button.querySelector(".lineup-toolbar-label")?.textContent?.trim();
    expect(label).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe(label);
    expect(button.title).toBe(label);
    const icon = button.querySelector("svg.lineup-bulk-icon");
    expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(icon?.querySelector("path")?.getAttribute("d")).toBeTruthy();
    expect(button.disabled).toBe(false);
    const labelSpan = button.querySelector(".lineup-toolbar-label") as HTMLElement;
    labelSpan.hidden = true;
    expect(button.querySelector("svg.lineup-bulk-icon")).toBe(icon);
  }
  hideAll.focus();
  hideAll.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(document.querySelector("[data-lineup-bulk-confirm]")).toBeNull();
  expect(mutations[0]).toEqual({
    type: "categories.visibility",
    contentKind: "live",
    hidden: true,
  });
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.lineupBulk).toBe("hide");
  });

  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const channelRow = document.querySelector(".lineup-row-channel") as HTMLElement;
  const channelIdentity = channelRow.querySelector(".lineup-row-open-info") as HTMLElement;
  expect(channelIdentity?.tagName).toBe("BUTTON");
  expect(channelIdentity?.tabIndex).toBe(0);
  expect(channelIdentity?.hasAttribute("data-settings-informational")).toBe(false);
  expect(channelIdentity?.dataset.lineupProviderId).toBe("channel-1");
  expect(channelIdentity?.getAttribute("aria-label")).toBe("Open, 2 Channel 1");
  expect(channelIdentity?.textContent).toContain("Channel 1");
  expect(channelIdentity?.querySelector(".lineup-channel-number")?.textContent).toBe("2");
  expect(channelRow.querySelector("button[data-item-open]")).toBe(channelIdentity);
  expect(
    channelRow.querySelector(".lineup-compact-menu[data-item-menu='lineup']"),
  ).toBeTruthy();
  const callsBeforeChannelIdentity = fetchMock.mock.calls.length;
  const hashBeforeChannelIdentity = window.location.hash;
  channelIdentity!.querySelector<HTMLElement>("strong")!.click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeTruthy());
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
  expect(fetchMock.mock.calls.length).toBe(callsBeforeChannelIdentity);
  expect(window.location.hash).toBe(hashBeforeChannelIdentity);
  (document.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());
  expect((document.activeElement as HTMLElement | null)?.dataset.lineupProviderId).toBe(
    "channel-1",
  );

  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");
  await vi.waitFor(() => expect(document.querySelector('[name="editorName"]')).toBeTruthy());
  (document.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor-dialog")).toBeNull());
});

test("playlist and device menus open before lineup and trap Tab", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  expect(document.querySelector(".lineup-layout")).toBeNull();
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();

  openItemMenu("playlist", "pl-1");
  const dialog = document.querySelector("[data-item-action-dialog]") as HTMLElement;
  expect(dialog?.getAttribute("aria-label")).toBe("News");
  const actionButtons = () =>
    Array.from(dialog.querySelectorAll<HTMLElement>("[data-item-action]"));
  expect(actionButtons().map((entry) => entry.dataset.itemAction)).toEqual([
    "activate",
    "refresh",
    "edit",
    "reset",
    "remove",
  ]);
  const cancel = dialog.querySelector<HTMLButtonElement>("button[data-item-menu-close]")!;
  const firstEnabledAction = actionButtons().find((button) => !button.matches(":disabled"))!;
  const tab = (shiftKey: boolean) => {
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
      shiftKey,
    });
    (document.activeElement as HTMLElement).dispatchEvent(event);
    return event;
  };

  cancel.focus();
  expect(tab(false).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(firstEnabledAction);

  firstEnabledAction.focus();
  expect(tab(true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(cancel);

  (document.querySelector("[data-item-menu-close]") as HTMLElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeNull(),
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(itemMenuTrigger("playlist", "pl-1")),
  );

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#devices"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-action="device-rename"][data-id="device-1"]'),
    ).toBeTruthy(),
  );
  expect(
    document.querySelector('[data-action="device-remove"][data-id="device-1"]'),
  ).toBeTruthy();
  expect(document.querySelector('[data-item-menu="device"]')).toBeNull();
});

test("a highlighted lineup action keeps focus through a background write", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "categories"
          ? lineupPage([lineupCategory("News")], null, 1, revision)
          : lineupPage([lineupChannel(1)], null, 1, revision),
      );
    }
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  openItemMenu("lineup", "News");
  const edit = itemAction("edit");
  edit.focus();
  expect(document.activeElement).toBe(edit);

  const pending = app.sendLineupMutation(
    { type: "category.visibility", categoryKey: "News", hidden: true },
    null,
  );
  const midFlight = document.activeElement as HTMLElement | null;
  expect(midFlight?.dataset.itemAction).toBe("edit");
  await pending;
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemAction).toBe("edit");
  });
  expect(document.querySelector("[data-item-action-dialog]")).toBeTruthy();
});

test("a menu dismisses when its subroute changes", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openItemMenu("playlist", "pl-1");
  expect(document.querySelector("[data-item-action-dialog]")).toBeTruthy();

  window.location.hash = "#playlists?view=add";
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeNull(),
  );
  expect(
    document.querySelector('[data-form-overlay="playlist-add"] [name="newName"]'),
  ).toBeTruthy();
});

test("cancelling a device rename returns focus to its row trigger", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#devices");
  await loadApp().start();

  deviceRowAction("device-1", "rename");
  await vi.waitFor(() =>
    expect(document.querySelector('[data-edit-device][data-id="device-1"]')).toBeTruthy(),
  );
  (document.querySelector('[data-action="cancel-edit-device"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-edit-device]")).toBeNull());
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.action).toBe("device-rename");
    expect(active?.dataset.id).toBe("device-1");
  });
});

test("the device rename overlay keeps the list mounted and retains its draft through a failed save", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const devices = [
    { id: "p", name: "This phone", createdAt: 1, lastUsedAt: 1 },
    { id: "device-1", name: "Device 1", createdAt: 1, lastUsedAt: 1 },
  ];
  let resolveCommand: ((response: unknown) => void) | null = null;
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, snapshot({ devices }));
    if (path === "/api/v1/command") {
      return new Promise((resolve) => {
        resolveCommand = resolve;
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#devices");
  await loadApp().start();

  deviceRowAction("device-1", "rename");
  const overlay = (await vi.waitFor(() => {
    const element = document.querySelector('[data-form-overlay="device-edit"]') as HTMLElement;
    expect(element).toBeTruthy();
    return element;
  })) as HTMLElement;
  expect(overlay.getAttribute("role")).toBe("dialog");
  expect(overlay.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelectorAll(".device-card")).toHaveLength(2);

  const field = () => document.querySelector('[name="editDeviceName"]') as HTMLInputElement;
  const originalField = field();
  originalField.focus();
  originalField.value = "Kitchen";
  originalField.dispatchEvent(new Event("input", { bubbles: true }));
  originalField.setSelectionRange(2, 5);

  (overlay.querySelector("form") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(resolveCommand).toBeTruthy());
  expect(field().disabled).toBe(true);
  expect(
    (overlay.querySelector('[data-action="cancel-edit-device"]') as HTMLButtonElement).disabled,
  ).toBe(false);
  // jsdom keeps disabled inputs active after blur, so emulate the browser's focus loss.
  const bodyTabIndex = document.body.getAttribute("tabindex");
  document.body.tabIndex = -1;
  document.body.focus();
  if (bodyTabIndex === null) document.body.removeAttribute("tabindex");
  else document.body.setAttribute("tabindex", bodyTabIndex);
  expect(document.activeElement).not.toBe(field());

  resolveCommand!(
    reply(500, {
      ok: false,
      reason: "failed",
      snapshot: snapshot({
        revision: 9,
        devices: [
          { id: "p", name: "Patio phone", createdAt: 1, lastUsedAt: 1 },
          { id: "device-1", name: "Device 1", createdAt: 1, lastUsedAt: 1 },
        ],
      }),
    }),
  );
  await vi.waitFor(() => {
    expect(field().disabled).toBe(false);
    expect(field().value).toBe("Kitchen");
    expect(field().selectionStart).toBe(2);
    expect(field().selectionEnd).toBe(5);
  });
  expect(field()).not.toBe(originalField);
  expect(field().disabled).toBe(false);
  const cards = [...document.querySelectorAll(".device-card")];
  expect(cards.some((card) => card.textContent?.includes("Patio phone"))).toBe(true);
  expect(cards.some((card) => card.textContent?.includes("This phone"))).toBe(false);
  expect(cards.some((card) => card.textContent?.includes("Device 1"))).toBe(true);
  const reopened = document.querySelector<HTMLElement>('[data-form-overlay="device-edit"]')!;
  expect(reopened).toBeTruthy();
  expect(reopened.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(field());

  field().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-edit-device]")).toBeNull());
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.action).toBe("device-rename");
    expect(active?.dataset.id).toBe("device-1");
  });
});

test("the playlist edit overlay traps Tab, closes on Escape and Back returns to its opener", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  openPlaylistEdit("pl-1");
  const overlay = (await vi.waitFor(() => {
    const element = document.querySelector(
      '[data-form-overlay="playlist-edit"]',
    ) as HTMLElement;
    expect(element).toBeTruthy();
    return element;
  })) as HTMLElement;
  expect(overlay.getAttribute("role")).toBe("dialog");
  expect(overlay.getAttribute("aria-modal")).toBe("true");
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();

  const focusable = Array.from(
    overlay.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, [href], [tabindex]",
    ),
  ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex >= 0);
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  last.focus();
  last.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(first);
  first.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.activeElement).toBe(last);

  document.activeElement!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeNull());
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemMenu).toBe("playlist");
    expect(active?.dataset.id).toBe("pl-1");
  });

  openPlaylistEdit("pl-1");
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeTruthy());
  window.history.back();
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeNull());
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemMenu).toBe("playlist");
    expect(active?.dataset.id).toBe("pl-1");
  });
});

test("a queued setting waits for the row lane and sends at the acknowledged revision", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    {
      id: "pl-1",
      name: "News",
      source: { kind: "m3u", url: "http://example.com/list.m3u" },
      sourceVersion: 1,
    },
    {
      id: "pl-2",
      name: "Other",
      source: { kind: "m3u", url: "http://example.com/other.m3u" },
      sourceVersion: 1,
    },
  ];
  const commandBodies: Array<{
    id?: string;
    revision?: number;
    command?: Record<string, unknown>;
  }> = [];
  let resolveRefresh: ((response: unknown) => void) | null = null;
  let resolveSetting: ((response: unknown) => void) | null = null;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot({ playlists }));
    if (path === "/api/v1/command") {
      const body = JSON.parse(String(options?.body)) as {
        id?: string;
        revision?: number;
        command?: Record<string, unknown>;
      };
      commandBodies.push(body);
      if (body.command?.type === "playlist.refresh") {
        return new Promise((resolve) => {
          resolveRefresh = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveSetting = resolve;
      });
    }
    return reply(200, snapshot({ playlists }));
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  playlistRowAction("pl-1", "refresh");
  await vi.waitFor(() => expect(commandBodies).toHaveLength(1));
  expect(commandBodies[0].revision).toBe(0);
  expect(commandBodies[0].command).toEqual({ type: "playlist.refresh", id: "pl-1" });
  const busyActivate = document.querySelector<HTMLButtonElement>(
    '[data-action="playlist-activate"][data-id="pl-1"]',
  );
  expect(busyActivate?.getAttribute("aria-disabled")).toBe("true");
  const otherActivate = document.querySelector<HTMLButtonElement>(
    '[data-action="playlist-activate"][data-id="pl-2"]',
  );
  expect(otherActivate?.getAttribute("aria-disabled")).toBeNull();

  openItemMenu("playlist", "pl-2");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeTruthy(),
  );
  const actions = Array.from(document.querySelectorAll<HTMLElement>("[data-item-action]"));
  expect(actions.map((action) => action.dataset.itemAction).sort()).toEqual([
    "activate",
    "edit",
    "refresh",
    "remove",
    "reset",
  ]);
  for (const action of actions) {
    expect(action.getAttribute("aria-disabled")).toBeNull();
  }
  (document.querySelector("[data-item-menu-close]") as HTMLElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeNull(),
  );

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  (document.querySelector('[data-setting="showClock"]') as HTMLInputElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(commandBodies).toHaveLength(1);

  resolveRefresh!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, snapshot: snapshot({ playlists, revision: 1 }) }),
  });
  await vi.waitFor(() => expect(commandBodies).toHaveLength(2));
  expect(commandBodies[1].command).toEqual({
    type: "setting",
    key: "showClock",
    value: false,
  });
  expect(commandBodies[1].revision).toBe(1);

  await vi.waitFor(() => expect(resolveSetting).toBeTruthy());
  expect(document.querySelector('[data-page="appearance"]')).toBeTruthy();
  expect(document.querySelector("[data-operation-status]")?.textContent).toContain(
    labels.saving,
  );
  const heldClock = document.querySelector('[data-setting="showClock"]') as HTMLInputElement;
  expect(heldClock.disabled).toBe(true);

  const savedSnapshot = snapshot({ playlists, revision: 2 });
  savedSnapshot.settings.showClock = false;
  resolveSetting!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, snapshot: savedSnapshot }),
  });
  await vi.waitFor(() => {
    const clock = document.querySelector('[data-setting="showClock"]') as HTMLInputElement;
    expect(clock.checked).toBe(false);
    expect(clock.disabled).toBe(false);
  });
  expect(document.querySelector('[data-page="appearance"]')).toBeTruthy();
});

const CURSOR_OFFSETS: Record<string, number> = {
  "cursor-3-50": 50,
  "cursor-3-100": 100,
  "cursor-4-50": 50,
  "cursor-4-100": 100,
};

function offsetPage(
  channels: ReturnType<typeof lineupChannel>[],
  total: number,
  revision: () => number,
) {
  const pageAt = (offset: number) => {
    const slice = channels.slice(offset, offset + 50).map((channel) => ({ ...channel }));
    const nextOffset = offset + 50;
    return lineupPage(
      slice,
      nextOffset < total ? `cursor-${revision()}-${nextOffset}` : null,
      total,
      revision(),
    );
  };
  return (body: Record<string, unknown>): { status: number; body: unknown } => {
    if (typeof body.cursor === "string") {
      const offset = CURSOR_OFFSETS[body.cursor];
      if (offset === undefined) {
        return {
          status: 400,
          body: { ok: false, reason: "invalid", revision: revision() },
        };
      }
      if (Number(body.cursor.split("-")[1]) !== Number(body.revision)) {
        return {
          status: 409,
          body: { ok: false, reason: "conflict", revision: revision() },
        };
      }
      return { status: 200, body: pageAt(offset) };
    }
    const offset = typeof body.offset === "number" ? body.offset : 0;
    return { status: 200, body: pageAt(offset) };
  };
}

function applyServerVisibility(
  channels: ReturnType<typeof lineupChannel>[],
  mutation: { type?: string; channelId?: string; hidden?: boolean } | undefined,
) {
  if (mutation?.type !== "channel.visibility") return;
  const target = channels.find((channel) => channel.id === mutation.channelId);
  if (target && typeof mutation.hidden === "boolean") target.hidden = mutation.hidden;
}

test("a visibility write keeps the current page through an offset refresh", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const total = 120;
  const channels = Array.from({ length: total }, (_, index) => lineupChannel(index + 1));
  let revision = 3;
  const queries: Array<Record<string, unknown>> = [];
  const mutations: unknown[] = [];
  let heldMutation: ((response: unknown) => void) | null = null;
  let heldRefresh: ((response: unknown) => void) | null = null;
  let holdNextRefresh = false;
  const pageFor = offsetPage(channels, total, () => revision);

  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, revision));
      }
      if (holdNextRefresh) {
        holdNextRefresh = false;
        return new Promise((resolve) => {
          heldRefresh = resolve;
        });
      }
      const served = pageFor(body);
      return reply(served.status, served.body);
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as {
        mutation?: { type?: string; channelId?: string; hidden?: boolean };
      };
      mutations.push(body.mutation);
      applyServerVisibility(channels, body.mutation);
      revision += 1;
      return new Promise((resolve) => {
        heldMutation = resolve;
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  expect(queries[queries.length - 1].cursor).toBe("cursor-3-50");
  expect(document.activeElement).toBe(
    document.querySelector("#lineup .lineup-list .lineup-row .lineup-row-open"),
  );

  const eye = () => lineupRowControl("channel-51", "data-lineup-visibility") as HTMLElement;
  eye().focus();
  eye().click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({
    type: "channel.visibility",
    channelId: "channel-51",
    hidden: true,
  });

  const pagination = () => ({
    prev: document.querySelector<HTMLButtonElement>('[data-lineup-page="prev"]')!,
    next: document.querySelector<HTMLButtonElement>('[data-lineup-page="next"]')!,
  });
  const expectQuietPending = () => {
    expect(document.querySelector(".lineup-row-channel")).toBeTruthy();
    expect(eye()).toBeTruthy();
    expect((eye() as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector("[data-lineup-retry]")).toBeNull();
    expect(document.querySelector("p.lineup-state")).toBeNull();
    const status = document.querySelector("[data-operation-status]");
    expect(status?.textContent ?? "").not.toContain(labels.saving);
  };
  expect(pagination().prev.disabled).toBe(false);
  expect(pagination().next.disabled).toBe(false);
  expectQuietPending();

  holdNextRefresh = true;
  heldMutation!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision, affectedIds: ["channel-51"] }),
  });
  await vi.waitFor(() => expect(heldRefresh).toBeTruthy());
  const refreshBody = queries[queries.length - 1];
  expect(refreshBody.offset).toBe(50);
  expect(refreshBody.revision).toBe(4);
  expect(refreshBody.cursor).toBeUndefined();
  expect(refreshBody.scope).toBe("channels");
  expect(refreshBody.categoryKey).toBe("News");
  expect(pagination().prev.disabled).toBe(false);
  expect(pagination().next.disabled).toBe(false);
  expectQuietPending();

  heldRefresh!({
    status: 200,
    ok: true,
    json: async () => pageFor({ offset: 50 }).body,
  });
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-visibility")).toBe(true);
    expect(active?.dataset.id).toBe("channel-51");
  });
  const toggled = lineupRowControl("channel-51", "data-lineup-visibility");
  expect(toggled.getAttribute("aria-checked")).toBe("false");
  expect(toggled.getAttribute("aria-label")).toContain("Show");
  const row = toggled.closest(".lineup-row") as HTMLElement;
  expect(row.textContent).toContain("Channel 51");
  expect(pagination().prev.disabled).toBe(false);
  expect(pagination().next.disabled).toBe(false);

  pagination().prev.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  const prevBody = queries[queries.length - 1];
  expect(prevBody.cursor).toBeUndefined();
  expect(prevBody.offset).toBeUndefined();

  pagination().next.click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  expect(queries[queries.length - 1].cursor).toBe("cursor-4-50");
});

test("a failed quiet visibility read keeps the acknowledged toggle", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const channels = Array.from({ length: 120 }, (_, index) => lineupChannel(index + 1));
  let revision = 3;
  const queries: Array<Record<string, unknown>> = [];
  let heldMutation: ((response: unknown) => void) | null = null;
  let heldRefresh: ((response: unknown) => void) | null = null;
  let holdNextRefresh = false;
  const pageFor = offsetPage(channels, 120, () => revision);

  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, revision));
      }
      if (holdNextRefresh) {
        holdNextRefresh = false;
        return new Promise((resolve) => {
          heldRefresh = resolve;
        });
      }
      const served = pageFor(body);
      return reply(served.status, served.body);
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as {
        mutation?: { type?: string; channelId?: string; hidden?: boolean };
      };
      applyServerVisibility(channels, body.mutation);
      revision += 1;
      return new Promise((resolve) => {
        heldMutation = resolve;
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  const eye = lineupRowControl("channel-51", "data-lineup-visibility");
  eye.focus();
  eye.click();
  await vi.waitFor(() => expect(heldMutation).toBeTruthy());

  holdNextRefresh = true;
  heldMutation!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision, affectedIds: ["channel-51"] }),
  });
  await vi.waitFor(() => expect(heldRefresh).toBeTruthy());
  heldRefresh!({ status: 500, ok: false, json: async () => ({ error: "boom" }) });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  const toggled = lineupRowControl("channel-51", "data-lineup-visibility");
  expect(toggled.getAttribute("aria-checked")).toBe("false");
  expect(toggled.getAttribute("aria-label")).toContain("Show");
  expect((toggled as HTMLButtonElement).disabled).toBe(false);
  const row = toggled.closest(".lineup-row") as HTMLElement;
  expect(row.querySelector(".lineup-channel-number")?.textContent).toBe("52");
  expect(row.querySelector(".lineup-channel-name")?.textContent).toBe("Channel 51");
  expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 51");
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-visibility")).toBe(true);
    expect(active?.dataset.id).toBe("channel-51");
  });
  expect(document.querySelector<HTMLButtonElement>('[data-lineup-page="prev"]')!.disabled).toBe(
    false,
  );
  expect(document.querySelector<HTMLButtonElement>('[data-lineup-page="next"]')!.disabled).toBe(
    false,
  );
});

test("a superseded visibility refresh leaves the newer route alone", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const channels = Array.from({ length: 120 }, (_, index) => lineupChannel(index + 1));
  let revision = 3;
  const mutations: unknown[] = [];
  let heldMutation: ((response: unknown) => void) | null = null;
  let heldRefresh: ((response: unknown) => void) | null = null;
  let holdNextRefresh = false;
  const pageFor = offsetPage(channels, 120, () => revision);

  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, revision));
      }
      if (holdNextRefresh) {
        holdNextRefresh = false;
        return new Promise((resolve) => {
          heldRefresh = resolve;
        });
      }
      const served = pageFor(body);
      return reply(served.status, served.body);
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as {
        mutation?: { type?: string; channelId?: string; hidden?: boolean };
      };
      mutations.push(body.mutation);
      applyServerVisibility(channels, body.mutation);
      revision += 1;
      return new Promise((resolve) => {
        heldMutation = resolve;
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  const eye = lineupRowControl("channel-51", "data-lineup-visibility");
  eye.focus();
  eye.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));

  holdNextRefresh = true;
  heldMutation!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision, affectedIds: ["channel-51"] }),
  });
  await vi.waitFor(() => expect(heldRefresh).toBeTruthy());

  window.location.hash = "#appearance";
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  const heading = document.activeElement as HTMLElement | null;
  expect(heading?.hasAttribute("data-lineup-heading")).toBe(true);
  expect(document.querySelector("[data-lineup-visibility]")).toBeNull();

  heldRefresh!({
    status: 200,
    ok: true,
    json: async () => pageFor({ offset: 50 }).body,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector('[data-page="appearance"]')).toBeTruthy();
  expect(document.querySelector("[data-lineup-visibility]")).toBeNull();
  expect(document.activeElement).toBe(heading);
});

test("a stale quiet read retries once at the current revision", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const channels = Array.from({ length: 120 }, (_, index) => lineupChannel(index + 1));
  let revision = 3;
  const mutations: unknown[] = [];
  let heldMutation: ((response: unknown) => void) | null = null;
  let heldRefresh: ((response: unknown) => void) | null = null;
  let holdNextRefresh = false;
  const pageFor = offsetPage(channels, 120, () => revision);

  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, revision));
      }
      if (holdNextRefresh) {
        holdNextRefresh = false;
        return new Promise((resolve) => {
          heldRefresh = resolve;
        });
      }
      const served = pageFor(body);
      return reply(served.status, served.body);
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as {
        mutation?: { type?: string; channelId?: string; hidden?: boolean };
      };
      mutations.push(body.mutation);
      applyServerVisibility(channels, body.mutation);
      revision += 1;
      return new Promise((resolve) => {
        heldMutation = resolve;
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  const eye = lineupRowControl("channel-51", "data-lineup-visibility");
  eye.focus();
  eye.click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));

  holdNextRefresh = true;
  heldMutation!({
    status: 200,
    ok: true,
    json: async () => ({ ok: true, revision, affectedIds: ["channel-51"] }),
  });
  await vi.waitFor(() => expect(heldRefresh).toBeTruthy());
  const staleRead = queries[queries.length - 1];
  expect(staleRead.offset).toBe(50);
  expect(staleRead.revision).toBe(4);
  expect(staleRead.cursor).toBeUndefined();
  expect(staleRead.scope).toBe("channels");
  expect(staleRead.categoryKey).toBe("News");

  revision = 5;
  heldRefresh!({
    status: 409,
    ok: false,
    json: async () => ({ ok: false, reason: "conflict", revision: 5 }),
  });

  await vi.waitFor(() => {
    const retried = queries[queries.length - 1];
    expect(retried.revision).toBe(5);
    expect(retried.offset).toBe(50);
    expect(retried.cursor).toBeUndefined();
    expect(retried.scope).toBe("channels");
    expect(retried.categoryKey).toBe("News");
  });
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(document.querySelector(".lineup-state-loading")).toBeNull();
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  const toggled = lineupRowControl("channel-51", "data-lineup-visibility");
  expect(toggled.getAttribute("aria-checked")).toBe("false");
});

test("the order preference stays in the settings group and a category leads to its channels", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([{ ...lineupChannel(1), id: "opaque-ch-9f2" }], null, 1, 3)
          : lineupPage([lineupCategory("News")], null, 1, 3),
      );
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  const preferences = document.querySelector("[data-lineup-preferences]") as HTMLElement;
  expect(preferences?.closest(".lineup-controls")).toBeTruthy();
  const orderRow = preferences?.querySelector(
    '[data-lineup-preference="order"]',
  ) as HTMLElement;
  expect(orderRow?.textContent).toContain("Category order");
  expect(orderRow?.textContent).toContain("Provider order");
  const results = document.querySelector(".lineup-results") as HTMLElement;
  expect(
    preferences!.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(document.querySelector(".lineup-order")).toBeNull();
  expect(document.querySelector('[data-item-menu="page"]')).toBeNull();

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  expect(search?.getAttribute("aria-label")).toBe("Search categories");
  expect(search?.getAttribute("placeholder")).toBe("Search categories");
  expect(search?.closest("label")?.querySelector(".visually-hidden")?.textContent).toBe(
    "Search categories",
  );

  const categoryOpen = document.querySelector(
    '.lineup-row-category button[data-item-open="lineup"][data-id="News"]',
  ) as HTMLElement;
  expect(categoryOpen?.getAttribute("aria-label")).toBe("Open, News");
  const callsBeforeOpen = fetchMock.mock.calls.length;
  const hashBeforeOpen = window.location.hash;
  categoryOpen.click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const channelQuery = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/query")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    .find((body) => body.scope === "channels");
  expect(channelQuery?.categoryKey).toBe("News");
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");
  expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeOpen);
  expect(window.location.hash).not.toBe(hashBeforeOpen);
  expect(document.querySelector(".lineup-editor-dialog")).toBeNull();

  const row = document.querySelector(".lineup-row-channel") as HTMLElement;
  expect(row.getAttribute("data-lineup-id")).toBe("opaque-ch-9f2");
  const identity = row.querySelector(".lineup-row-open-info") as HTMLElement;
  expect(identity?.dataset.lineupProviderId).toBe("opaque-ch-9f2");
  expect(identity?.getAttribute("aria-label")).toBe("Open, 2 Channel 1");
  expect(identity?.textContent).toContain("Channel 1");
  expect(identity?.textContent).not.toContain("opaque-ch-9f2");
  expect(row.querySelector(".lineup-compact-menu[data-item-menu='lineup']")).toBeTruthy();
  expect(row.querySelector("details")).toBeNull();
});

test("content breadcrumbs list only ancestors and refresh stays on the playlist surfaces", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    {
      id: "pl-1",
      name: "Main",
      source: { kind: "m3u", url: "http://example.com/list.m3u" },
      sourceVersion: 1,
    },
    {
      id: "pl-2",
      name: "Second",
      source: { kind: "m3u", url: "http://example.com/other.m3u" },
      sourceVersion: 1,
    },
  ];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.playlistId === "pl-2" && body.revision === 0) {
        return reply(409, { ok: false, reason: "conflict", revision: 3 });
      }
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1)], null, 1, 3)
          : lineupPage([lineupCategory("News")], null, 1, 3),
      );
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  const crumbTexts = () =>
    Array.from(document.querySelectorAll(".crumbs a")).map((link) => link.textContent?.trim());
  expect(crumbTexts()).toEqual(["Playlists"]);
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Main");
  expect(document.querySelectorAll('[data-action="refresh-playlist"]')).toHaveLength(0);

  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  expect(crumbTexts()).toEqual(["Playlists", "Main"]);
  expect(crumbTexts()).not.toContain("News");
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("News");

  crumb("Main")?.click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-category")).toBeTruthy());
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Main");

  crumb("Playlists")?.click();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(2));
  openItemMenu("playlist", "pl-1");
  expect(
    Array.from(document.querySelectorAll<HTMLElement>("[data-item-action]"))
      .map((action) => action.dataset.itemAction)
      .sort(),
  ).toEqual(["activate", "edit", "refresh", "remove", "reset"]);
  (document.querySelector("[data-item-menu-close]") as HTMLElement).click();

  openPlaylistContent("pl-2");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Second");
  expect(document.querySelectorAll('[data-action="refresh-playlist"]')).toHaveLength(0);
  const queries = fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/query");
  const lastQuery = JSON.parse(
    String((queries[queries.length - 1][1] as RequestInit).body),
  ) as Record<string, unknown>;
  expect(lastQuery.playlistId).toBe("pl-2");
});

test("a complete single page shows its count once and single page views skip pagination", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(
        200,
        lineupPage(
          [lineupCategory("News"), lineupCategory("Sport")],
          null,
          2,
          3,
          undefined,
          "custom",
        ),
      );
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));

  expect(document.querySelector(".list-head .list-title h3")?.textContent).toBe("Categories");
  expect(document.querySelector(".list-head .list-count")?.textContent).toBe("2");
  expect(document.querySelectorAll(".list-count, .page-head-count")).toHaveLength(1);
  expect(document.querySelector(".lineup-pagination")).toBeNull();

  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  expect(document.querySelector('[data-lineup-action="move"]')).toBeNull();
  expect(document.querySelectorAll(".list-count, .page-head-count")).toHaveLength(1);
  expect(document.querySelector(".lineup-anchor-picker")).toBeNull();
  expect(document.querySelector("[data-lineup-mode-back]")?.getAttribute("aria-label")).toBe(
    "Back",
  );
});

test("a partial page keeps the shown of total status and cursor pagination", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const categories = Array.from({ length: 50 }, (_, index) =>
    lineupCategory(`Category ${index}`),
  );
  const fetchMock = vi.fn((path: string, _options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(200, lineupPage(categories, "cursor-two", 51, 3));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

  expect(document.querySelector(".list-head .list-count")?.textContent).toBe("51");
  const pagination = document.querySelector(".lineup-pagination") as HTMLElement;
  expect(pagination).toBeTruthy();
  expect((pagination.querySelector(".lineup-page-label") as HTMLElement)?.textContent).toBe(
    "Page 1 of 2",
  );
  expect(
    (pagination.querySelector('[data-lineup-page="next"]') as HTMLButtonElement)?.disabled,
  ).toBe(false);
  expect(
    (pagination.querySelector('[data-lineup-page="prev"]') as HTMLButtonElement)?.disabled,
  ).toBe(true);
});

test("the channel editor uses an entity title while provider details stay visible", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const providerChannel = { ...lineupChannel(1), name: "Provider 1" };
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([providerChannel], null, 1, revision)
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      revision += 1;
      return reply(200, {
        ok: true,
        revision,
        affectedIds: ["channel-1"],
      });
    }
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup-editor-title")?.textContent).toBe(
      "Edit channel details",
    ),
  );

  const footer = document.querySelector(".lineup-editor-footer") as HTMLElement;
  expect(
    Array.from(footer.querySelectorAll("button")).map((button) => button.textContent?.trim()),
  ).toEqual(["Reset to default", "Cancel", "Save"]);
  const restore = document.querySelector('[data-lineup-action="restore-draft"]') as HTMLElement;
  expect(restore.closest(".lineup-editor-footer")).toBe(footer);
  expect(restore.closest(".lineup-editor-actions")).toBeNull();
  expect(restore.closest(".lineup-editor-body")).toBeNull();
  expect(restore.getAttribute("aria-describedby")).toBe("lineup-provider-values");
  expect(restore.getAttribute("aria-label")).toBe("Reset to default");
  expect(restore.title).toBe("Reset to default");
  expect(restore.querySelector(".lineup-restore-label")?.textContent).toBe("Reset to default");
  expect(footer.classList.contains("has-restore")).toBe(true);
  expect((restore as HTMLButtonElement).disabled).toBe(false);
  const providerRef = document.querySelector("[data-lineup-provider-ref]") as HTMLElement;
  expect(providerRef.getAttribute("role")).toBe("note");
  const providerValues = document.querySelector("[data-lineup-provider-values]") as HTMLElement;
  expect(providerValues.hidden).toBe(false);
  expect(providerValues.id).toBe("lineup-provider-values");
  expect(providerValues.textContent).toContain("Provider 1");

  const nameInput = document.querySelector('[name="editorName"]') as HTMLInputElement;
  nameInput.focus();
  nameInput.value = "Custom channel";
  nameInput.setSelectionRange(1, 4);
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  expect(providerValues.hidden).toBe(false);
  expect(document.activeElement).toBe(nameInput);
  expect(nameInput.value).toBe("Custom channel");
  expect(nameInput.selectionStart).toBe(1);
  expect(nameInput.selectionEnd).toBe(4);

  (document.querySelector('[data-lineup-action="restore-draft"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(
      (document.querySelector("[data-lineup-provider-values]") as HTMLElement)?.hidden,
    ).toBe(false),
  );
  expect((document.querySelector('[name="editorName"]') as HTMLInputElement).value).toBe(
    "Provider 1",
  );
  expect((document.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe("2");
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(0);

  (
    document.querySelector(
      '.lineup-editor-actions [data-lineup-action="cancel-editor"]',
    ) as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(0);
  await openRemoteRename("channel-1");

  const numberInput = document.querySelector('[name="editorNumber"]') as HTMLInputElement;
  numberInput.value = "abc";
  numberInput.dispatchEvent(new Event("input", { bubbles: true }));
  expect((document.querySelector("[data-lineup-provider-values]") as HTMLElement)?.hidden).toBe(
    false,
  );
  numberInput.value = "2";
  numberInput.dispatchEvent(new Event("input", { bubbles: true }));
  expect((document.querySelector("[data-lineup-provider-values]") as HTMLElement)?.hidden).toBe(
    false,
  );

  expect(document.querySelector('[name="editorHidden"]')).toBeNull();

  (document.querySelector('[data-lineup-action="restore-draft"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(
      (document.querySelector("[data-lineup-provider-values]") as HTMLElement)?.hidden,
    ).toBe(false),
  );
  expect(
    fetchMock.mock.calls.filter((call) => call[0] === "/api/v1/lineup/mutation"),
  ).toHaveLength(0);
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  const mutations = fetchMock.mock.calls
    .filter((call) => call[0] === "/api/v1/lineup/mutation")
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)).mutation);
  expect(mutations).toEqual([
    { type: "channel.rename", channelId: "channel-1", name: null },
    { type: "channel.number", channelId: "channel-1", number: null },
  ]);
});

test("the category editor uses the rename category title", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string, _options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(200, lineupPage([lineupCategory("News")], null, 1, 3));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  await openRemoteRename("News");
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup-editor-title")?.textContent).toBe("Rename category"),
  );
  const valueInput = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  expect(valueInput).toBeTruthy();
  expect(valueInput.placeholder).toBe("News");
  const restore = document.querySelector('[data-lineup-action="restore-draft"]') as HTMLElement;
  expect(restore.getAttribute("aria-describedby")).toBe("lineup-provider-values");
  const providerValues = document.querySelector("[data-lineup-provider-values]") as HTMLElement;
  expect(providerValues.hidden).toBe(false);
  const providerRef = document.querySelector("[data-lineup-provider-ref]") as HTMLElement;
  expect(providerRef.getAttribute("role")).toBe("note");
  valueInput.value = "Current affairs";
  valueInput.dispatchEvent(new Event("input", { bubbles: true }));
  expect(providerValues.hidden).toBe(false);
  const footer = document.querySelector(".lineup-editor-footer") as HTMLElement;
  expect(
    Array.from(footer.querySelectorAll("button")).map((button) => button.textContent?.trim()),
  ).toEqual(["Reset to default", "Cancel", "Save"]);
  const actions = footer.querySelector(".lineup-editor-actions") as HTMLElement;
  expect(
    Array.from(actions.querySelectorAll("button")).map((button) => button.textContent?.trim()),
  ).toEqual(["Cancel", "Save"]);
});

test("a pending editor save keeps cancel visible and disabled", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const providerChannel = { ...lineupChannel(1), name: "Provider 1" };
  let revision = 3;
  let releaseMutation!: () => void;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([providerChannel], null, 1, revision)
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      return new Promise((resolve) => {
        releaseMutation = () => {
          revision += 1;
          resolve(
            reply(200, {
              ok: true,
              revision,
              affectedIds: ["channel-1"],
            }),
          );
        };
      });
    }
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('button[data-item-open="lineup"]')).toBeTruthy(),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy(),
  );
  await openRemoteRename("channel-1");

  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Custom channel";
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() => {
    const cancel = document.querySelector(
      '.lineup-editor-footer [data-lineup-action="cancel-editor"]',
    ) as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    expect(cancel.disabled).toBe(true);
  });
  expect(
    (document.querySelector('[data-lineup-editor] button[type="submit"]') as HTMLButtonElement)
      .disabled,
  ).toBe(true);

  await vi.waitFor(() => expect(releaseMutation).toBeTruthy());
  releaseMutation();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
});

test("the empty lineup state keeps only the list header controls", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi.fn((path: string, _options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(200, lineupPage([], null, 0, 3));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-results-body > .lineup-state")?.textContent).toBe(
      "No matching lineup items.",
    ),
  );

  const results = document.querySelector(".lineup-results") as HTMLElement;
  expect(results.textContent).not.toContain("Clear search");
  expect(document.querySelector("[data-lineup-search]")).toBeNull();
  expect(document.querySelector("[data-lineup-hidden]")).toBeNull();

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  expect(search).toBeTruthy();
  search.value = "news";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(
    () => {
      const bodies = fetchMock.mock.calls
        .filter((call) => call[0] === "/api/v1/lineup/query")
        .map((call) => JSON.parse(String((call[1] as RequestInit).body)));
      expect(bodies.some((body) => body.query === "news")).toBe(true);
    },
    { timeout: 5000 },
  );

  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(document.querySelector("[data-lineup-search-toggle]")),
  );
  expect(document.querySelector("[data-lineup-search]")).toBeTruthy();
  expect((document.querySelector("[data-lineup-search]") as HTMLInputElement).value).toBe(
    "news",
  );

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-search]")).toBeNull());
  expect(document.activeElement).toBe(document.querySelector("[data-lineup-search-toggle]"));
  expect(
    document.querySelector("[data-lineup-search-toggle]")?.classList.contains("active"),
  ).toBe(false);
});

test("the order dialog moves focus with arrows and activates Enter once", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const mutations: unknown[] = [];
  let revision = 3;
  let orderMode = "provider";
  let resolveMutation: (() => void) | null = null;
  let pendingMutation = false;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(
        200,
        lineupPage(
          [lineupCategory("News"), lineupCategory("Sport")],
          null,
          2,
          revision,
          undefined,
          orderMode,
        ),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body));
      mutations.push(body.mutation);
      const resolveSave = () => {
        orderMode = body.mutation.mode;
        revision += 1;
        return reply(200, { ok: true, revision, affectedIds: [] });
      };
      if (pendingMutation) {
        return new Promise((resolve) => {
          resolveMutation = () => resolve(resolveSave());
        });
      }
      return resolveSave();
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));

  preferenceButton("order").click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  const provider = orderOption("provider");
  const alphabetical = orderOption("alphabetical");
  expect(document.activeElement).toBe(provider);
  alphabetical.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(alphabetical);
  expect(mutations).toHaveLength(0);
  alphabetical.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
  );
  expect(mutations).toEqual([
    { type: "category-order.mode", section: "live", mode: "alphabetical" },
  ]);
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false"),
  );

  pendingMutation = true;
  preferenceButton("order").click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  orderOption("custom").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(2));
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
  );
  expect(preferenceButton("order").disabled).toBe(false);
  expect(preferenceButton("order").textContent).toContain("Custom Order");
  await vi.waitFor(() => expect(document.activeElement).toBe(preferenceButton("order")));
  resolveMutation!();
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).toBe("false"),
  );
  expect(mutations).toHaveLength(2);
});

test.each(["none", "keydown", "pointerdown", "route", "auth"])(
  "exiting reorder restores the origin unless later %s interaction takes ownership",
  async (interaction) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const scrollToMock = vi.fn();
    vi.stubGlobal("scrollTo", scrollToMock);
    const pageOne = Array.from({ length: 50 }, (_, index) =>
      lineupCategory(`Cat${String(index).padStart(2, "0")}`),
    );
    const pageTwo = Array.from({ length: 50 }, (_, index) =>
      lineupCategory(`Dog${String(index).padStart(2, "0")}`),
    );
    let revision = 3;
    let resolveRestore: (() => void) | null = null;
    const queryBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queryBodies.push(body);
        if (body.offset === 50) {
          return new Promise((resolve) => {
            resolveRestore = () =>
              resolve(
                reply(
                  200,
                  lineupPage(pageTwo, "cursor-three", 120, revision, undefined, "custom"),
                ),
              );
          });
        }
        if (body.cursor === "cursor-two") {
          return reply(
            200,
            lineupPage(pageTwo, "cursor-three", 120, revision, undefined, "custom"),
          );
        }
        return reply(
          200,
          lineupPage(pageOne, "cursor-two", 120, revision, undefined, "custom"),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        revision += 1;
        return reply(200, { ok: true, revision, affectedIds: [] });
      }
      return reply(200, {});
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/#playlists/list");
    const app = loadApp();
    await app.start();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

    (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector("[data-lineup-search]")).toBeTruthy());
    const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    search.value = "cat";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(
      () =>
        expect(
          queryBodies.some(
            (body) =>
              body.query === "cat" && body.cursor === undefined && body.offset === undefined,
          ),
        ).toBe(true),
      { timeout: 5000 },
    );

    (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));

    await enterRemoteReorder();
    await vi.waitFor(() => expect(document.querySelector(".lineup-sort-row")).toBeTruthy());
    (document.querySelector('[data-lineup-page="prev"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Cat00"));

    (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
    expect(document.querySelector(".lineup-sort-row")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector("[data-lineup-heading]"));
    await vi.waitFor(() => expect(queryBodies.some((body) => body.offset === 50)).toBe(true));
    expect(document.body.textContent).not.toContain("Dog00");
    expect(document.activeElement).not.toBe(
      document.querySelector('[data-lineup-preference="custom-order"]'),
    );

    if (interaction === "route") {
      crumb("Playlists")!.click();
      await vi.waitFor(() => expect(document.querySelector(".playlist-list")).toBeTruthy());
    } else if (interaction === "auth") {
      app.replaceAuthForTest({ deviceId: "replacement", credential: "replacement-fixture" });
    } else if (interaction !== "none") {
      const searchTarget = document.querySelector<HTMLInputElement>("[data-lineup-search]")!;
      searchTarget.focus();
      searchTarget.dispatchEvent(
        interaction === "keydown"
          ? new KeyboardEvent("keydown", { key: "Shift", bubbles: true, cancelable: true })
          : new MouseEvent("pointerdown", { bubbles: true }),
      );
    }
    const laterFocus = document.activeElement;
    scrollToMock.mockClear();
    resolveRestore!();
    if (interaction === "route" || interaction === "auth") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement).toBe(laterFocus);
      expect(scrollToMock).not.toHaveBeenCalled();
      return;
    }
    await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));
    if (interaction === "none") {
      expect(document.activeElement).toBe(
        document.querySelector('[data-lineup-preference="custom-order"]'),
      );
    } else {
      expect(document.activeElement?.hasAttribute("data-lineup-search")).toBe(true);
      expect(scrollToMock).not.toHaveBeenCalled();
    }

    const restoreBody = queryBodies.find((body) => body.offset === 50);
    expect(restoreBody).toBeTruthy();
    expect(restoreBody!.query).toBe("cat");
    expect(restoreBody!.cursor).toBeUndefined();
    const restoredSearch = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    expect(restoredSearch).toBeTruthy();
    expect(restoredSearch.value).toBe("cat");
    if (interaction === "none") expect(scrollToMock).toHaveBeenCalledWith(0, 0);
  },
);

test("a reusable sort return restores the preferred control, search, page and scroll synchronously", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const originalScrollY = window.scrollY;
  const scrollToMock = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const first = Array.from({ length: 50 }, (_, index) => lineupCategory(`Category ${index}`));
  const second = [lineupCategory("Last category")];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    const body = JSON.parse(String(options?.body));
    return reply(
      200,
      body.cursor === "second"
        ? lineupPage(second, null, 51, 3, undefined, "custom")
        : lineupPage(first, "second", 51, 3, undefined, "custom"),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
    (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Last category"));
    (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
    Object.defineProperty(window, "scrollY", { configurable: true, value: 321 });
    await enterRemoteReorder();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(50),
    );
    (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(1),
    );
    const requests = fetchMock.mock.calls.length;
    scrollToMock.mockClear();
    (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
    expect(document.querySelector("[data-lineup-sort]")).toBeNull();
    expect(document.activeElement).toBe(preferenceButton("custom-order"));
    expect(document.querySelector<HTMLInputElement>("[data-lineup-search]")?.value).toBe("");
    expect(document.querySelector(".lineup-pagination")?.textContent).toContain("2");
    expect(document.querySelectorAll(".lineup-row")).toHaveLength(1);
    expect(document.body.textContent).toContain("Last category");
    expect(scrollToMock).toHaveBeenCalledWith(0, 321);
    expect(fetchMock.mock.calls).toHaveLength(requests);
  } finally {
    Object.defineProperty(window, "scrollY", { configurable: true, value: originalScrollY });
  }
});

test("an order mode save from a later page reloads only that page", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal("scrollTo", vi.fn());
  const pageOne = Array.from({ length: 50 }, (_, index) =>
    lineupCategory(`Cat${String(index).padStart(2, "0")}`),
  );
  const pageTwo = Array.from({ length: 50 }, (_, index) =>
    lineupCategory(`Dog${String(index).padStart(2, "0")}`),
  );
  let revision = 3;
  let orderMode = "custom";
  const mutations: unknown[] = [];
  const queryBodies: Array<Record<string, unknown>> = [];
  let resolveMutation: (() => void) | null = null;
  let resolveReload: (() => void) | null = null;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.offset === 50) {
        return new Promise((resolve) => {
          resolveReload = () =>
            resolve(
              reply(
                200,
                lineupPage(pageTwo, "cursor-three", 120, revision, undefined, orderMode),
              ),
            );
        });
      }
      if (body.cursor === "cursor-two") {
        return reply(
          200,
          lineupPage(pageTwo, "cursor-three", 120, revision, undefined, orderMode),
        );
      }
      return reply(200, lineupPage(pageOne, "cursor-two", 120, revision, undefined, orderMode));
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body));
      mutations.push(body.mutation);
      return new Promise((resolve) => {
        resolveMutation = () => {
          if (body.mutation && typeof body.mutation.mode === "string") {
            orderMode = body.mutation.mode;
          }
          revision += 1;
          resolve(reply(200, { ok: true, revision, affectedIds: [] }));
        };
      });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));

  const queriesBefore = queryBodies.length;
  preferenceButton("order").click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeTruthy(),
  );
  orderOption("alphabetical").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  resolveMutation!();
  await vi.waitFor(() => expect(queryBodies.some((body) => body.offset === 50)).toBe(true));

  expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull();
  expect(preferenceButton("order").disabled).toBe(false);
  expect(preferenceButton("order").textContent).toContain("Alphabet");
  expect(mutations).toHaveLength(1);

  resolveReload!();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-order-dialog]")).toBeNull(),
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));

  const postSaveQueries = queryBodies.slice(queriesBefore);
  expect(postSaveQueries).toHaveLength(1);
  expect(postSaveQueries[0].offset).toBe(50);
  expect(postSaveQueries[0].cursor).toBeUndefined();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('[data-lineup-preference="order"]'),
    ),
  );
  expect(preferenceButton("order").textContent).toContain("Alphabet");
  expect(mutations).toEqual([
    { type: "category-order.mode", section: "live", mode: "alphabetical" },
  ]);
});

test("a non-custom snapshot exits reorder safely without writing Custom back", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const scrollToMock = vi.fn(() => {
    expect(document.body.textContent).toContain("Dog00");
  });
  vi.stubGlobal("scrollTo", scrollToMock);
  const pageOne = Array.from({ length: 50 }, (_, index) =>
    lineupCategory(`Cat${String(index).padStart(2, "0")}`),
  );
  const pageTwo = Array.from({ length: 50 }, (_, index) =>
    lineupCategory(`Dog${String(index).padStart(2, "0")}`),
  );
  let revision = 3;
  let providerOrder = false;
  let resolveRestore: (() => void) | null = null;
  const mutations: unknown[] = [];
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.offset === 50) {
        return new Promise((resolve) => {
          resolveRestore = () =>
            resolve(
              reply(200, lineupPage(pageTwo, null, 100, revision, undefined, "provider")),
            );
        });
      }
      if (providerOrder) {
        return reply(
          200,
          lineupPage(pageOne, "cursor-two", 100, revision, undefined, "provider"),
        );
      }
      if (body.cursor === "cursor-two") {
        return reply(200, lineupPage(pageTwo, null, 100, revision, undefined, "custom"));
      }
      return reply(200, lineupPage(pageOne, "cursor-two", 100, revision, undefined, "custom"));
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body));
      mutations.push(body.mutation);
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));

  await enterRemoteReorder();
  await vi.waitFor(() => expect(document.querySelector(".lineup-sort-row")).toBeTruthy());
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));
  providerOrder = true;
  (document.querySelector('[data-lineup-page="prev"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".lineup-sort-row")).toBeNull());
  await vi.waitFor(() => expect(queryBodies.some((body) => body.offset === 50)).toBe(true));
  expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Dog00");
  expect(document.activeElement).not.toBe(
    document.querySelector('[data-lineup-preference="order"]'),
  );

  resolveRestore!();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Dog00"));
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('[data-lineup-preference="order"]'),
    ),
  );
  const restoreBody = queryBodies.find((body) => body.offset === 50);
  expect(restoreBody).toBeTruthy();
  expect(restoreBody!.cursor).toBeUndefined();
  expect(restoreBody!.query).toBeUndefined();
  expect(scrollToMock).toHaveBeenCalledWith(0, 0);
  expect(mutations).toHaveLength(0);
});

test("switching away from Custom and back retains the arranged order", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let orderMode = "custom";
  let revision = 3;
  const arranged = [lineupCategory("Bravo"), lineupCategory("Alpha")];
  const provider = [lineupCategory("Alpha"), lineupCategory("Bravo")];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      return reply(
        200,
        lineupPage(
          orderMode === "custom" ? arranged : provider,
          null,
          2,
          revision,
          undefined,
          orderMode,
        ),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body));
      if (body.mutation && typeof body.mutation.mode === "string") {
        orderMode = body.mutation.mode;
      }
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: [] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-preference="custom-order"]')).toBeTruthy(),
  );

  await chooseRemoteOrderMode("provider");
  await vi.waitFor(() => expect(document.body.textContent).toContain("Alpha"));
  const providerRows = Array.from(document.querySelectorAll(".lineup-row"));
  expect(providerRows[0].textContent).toContain("Alpha");
  expect(providerRows[1].textContent).toContain("Bravo");

  await chooseRemoteOrderMode("custom");
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-preference="custom-order"]')).toBeTruthy(),
  );
  const customRows = Array.from(document.querySelectorAll(".lineup-row"));
  expect(customRows[0].textContent).toContain("Bravo");
  expect(customRows[1].textContent).toContain("Alpha");
});

test("the playlist index pages at six cards, clamps after removal and keeps its page", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `pl-x${index}`,
      name: `Extra ${index}`,
      source: { kind: "m3u", url: `http://x${index}` },
      sourceVersion: 1,
    })),
  ];
  let removed = false;
  const current = () =>
    snapshot({
      playlists: removed ? playlists.slice(0, 6) : playlists,
      revision: removed ? 1 : 0,
    });
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, current());
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      if (command.type === "playlist.remove") removed = true;
      return reply(200, { ok: true, snapshot: current() });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  expect(document.querySelectorAll(".playlist-card")).toHaveLength(6);
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 1 of 2");
  (document.querySelector('[data-playlist-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(1));
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-x5"]'),
  ).toBeTruthy();
  expect(document.querySelector('[data-playlist-number="pl-x5"]')?.textContent).toBe("7");
  expect(document.querySelector('[data-playlist-page="prev"]')).toBeTruthy();
  expect(document.activeElement).toBe(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-x5"]'),
  );

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-add-playlist-form]")).toBeNull());
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(1);
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");

  openPlaylistEdit("pl-x5");
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeTruthy());
  (document.querySelector("[data-playlist-edit-dismiss]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-edit-playlist]")).toBeNull());
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(1);
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");

  removePlaylistFromIndex("pl-x5");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(6));
  expect(document.querySelector(".playlist-pagination")).toBeNull();
});

test("the default route lands on content settings and follows the Saved list link", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const commandBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot());
    if (path === "/api/v1/command") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      commandBodies.push(body);
      const command = body.command as { key?: string; value?: unknown };
      const settings = {
        ...snapshot().settings,
        [String(command.key)]: command.value,
      };
      return reply(200, { ok: true, snapshot: snapshot({ revision: 1, settings }) });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/");
  await loadApp().start();

  expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy();
  expect(document.querySelector('[data-page="playlists"]')).toBeNull();
  expect(document.querySelector(".playlist-card")).toBeNull();
  const switches = document.querySelectorAll('[data-page="content-settings"] [data-setting]');
  expect(switches).toHaveLength(5);
  expect(
    document.querySelector<HTMLInputElement>('[data-setting="playlistShortcut"]')?.checked,
  ).toBe(true);
  const manage = document.querySelector<HTMLAnchorElement>(
    '[data-page="content-settings"] a[href="#playlists/list"]',
  );
  expect(manage?.textContent).toContain(labels.managePlaylists);
  const hints = Array.from(document.querySelectorAll(".content-setting .setting-hint")).map(
    (element) => element.textContent,
  );
  expect(hints).toContain(labels.keepSectionHint);
  expect(hints.filter((hint) => hint === labels.sectionUnsupportedHint)).toHaveLength(2);

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#appearance"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="appearance"]')).toBeTruthy(),
  );
  expect(
    document.querySelectorAll('[data-page="appearance"] [data-setting="hideEmptyCategories"]'),
  ).toHaveLength(0);
  expect(
    document.querySelectorAll('[data-page="appearance"] [data-setting="showLive"]'),
  ).toHaveLength(0);
  expect(
    document.querySelectorAll('[data-page="appearance"] [data-setting="showMovies"]'),
  ).toHaveLength(0);
  expect(
    document.querySelectorAll('[data-page="appearance"] [data-setting="showSeries"]'),
  ).toHaveLength(0);

  (
    document.querySelector(
      '.manage-rail .manage-nav-link[href="#playlists"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
  );
  const hideEmpty = document.querySelector<HTMLInputElement>(
    '[data-setting="hideEmptyCategories"]',
  );
  expect(hideEmpty?.checked).toBe(true);
  hideEmpty!.click();
  await vi.waitFor(() => expect(commandBodies).toHaveLength(1));
  expect(commandBodies[0].command).toEqual({
    type: "setting",
    key: "hideEmptyCategories",
    value: false,
  });
  await vi.waitFor(() => {
    const current = document.querySelector<HTMLInputElement>(
      '[data-setting="hideEmptyCategories"]',
    );
    expect(current?.checked).toBe(false);
    expect(current?.disabled).toBe(false);
  });

  (
    document.querySelector(
      '[data-page="content-settings"] a[href="#playlists/list"]',
    ) as HTMLAnchorElement
  ).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(1));
  expect(window.location.hash).toBe("#playlists/list");
});

const matchPlaylists = () =>
  Array.from({ length: 7 }, (_, index) => {
    if (index === 0) {
      return {
        id: "pl-m0",
        name: "Match 0",
        source: { kind: "m3u", url: "http://example.com/pathneedle/list.m3u" },
        sourceVersion: 1,
      };
    }
    if (index === 1) {
      return {
        id: "pl-m1",
        name: "Match 1",
        source: {
          kind: "xtream",
          server: "http://provider.example",
          username: "userneedle",
          output: "m3u8",
          hasPassword: true,
        },
        sourceVersion: 1,
      };
    }
    return {
      id: `pl-m${index}`,
      name: `Match ${index}`,
      source: { kind: "m3u", url: `http://example.com/m${index}` },
      sourceVersion: 1,
    };
  });

test("saved search matches playlist names only and reports no matches locally", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = matchPlaylists();
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ playlists, activePlaylistId: "pl-m0" }));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  expect(document.querySelectorAll(".playlist-card")).toHaveLength(6);
  const listMarkup = () => document.querySelector(".playlist-list")?.outerHTML ?? "";
  expect(listMarkup()).not.toContain("pathneedle");
  expect(listMarkup()).not.toContain("userneedle");
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-m0"]'),
  ).toBeTruthy();
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-m1"]'),
  ).toBeTruthy();

  (document.querySelector("[data-playlist-search-toggle]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-playlist-search]")).toBeTruthy());
  const typeSearch = (value: string) => {
    const input = document.querySelector("[data-playlist-search]") as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const callsBefore = fetchMock.mock.calls.length;
  typeSearch("pathneedle");
  await vi.waitFor(() => expect(document.querySelector(".playlist-empty")).toBeTruthy());
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(0);
  expect(document.querySelector(".playlist-empty")?.textContent).toContain("No matching");
  expect(document.querySelector('[data-action="open-add-playlist"]')).toBeTruthy();
  expect(window.location.hash).toBe("#playlists/list");
  expect(fetchMock.mock.calls.length).toBe(callsBefore);

  typeSearch("userneedle");
  await vi.waitFor(() => expect(document.querySelector(".playlist-empty")).toBeTruthy());
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(0);

  typeSearch("Match");
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(6));
  expect(document.querySelector(".playlist-empty")).toBeNull();
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 1 of 2");
});

test("saved search keeps the field, caret and page through its key contract", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = matchPlaylists();
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ playlists, activePlaylistId: "pl-m0" }));
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const toggle = document.querySelector<HTMLButtonElement>("[data-playlist-search-toggle]")!;
  toggle.click();
  await vi.waitFor(() => expect(document.querySelector("[data-playlist-search]")).toBeTruthy());
  const searchInput = () => document.querySelector<HTMLInputElement>("[data-playlist-search]")!;
  expect(searchInput().closest(".playlist-tools")).toBeNull();
  const field = searchInput();
  const list = document.querySelector(".playlist-list")!;
  expect(field.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const callsBefore = fetchMock.mock.calls.length;
  searchInput().value = "Ma";
  searchInput().dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(searchInput().value).toBe("Ma"));
  await vi.waitFor(() =>
    expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 1 of 2"),
  );

  (document.querySelector('[data-playlist-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2"),
  );
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-m6"]'),
  ).toBeTruthy();

  const pageTwoField = searchInput();
  pageTwoField.focus();
  pageTwoField.setSelectionRange(1, 2);
  pageTwoField.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  expect(window.location.hash).toBe("#playlists/list");
  expect(searchInput().value).toBe("Ma");
  expect(document.activeElement).toBe(searchInput());
  expect((document.activeElement as HTMLInputElement).selectionStart).toBe(1);
  expect((document.activeElement as HTMLInputElement).selectionEnd).toBe(2);
  expect(fetchMock.mock.calls.length).toBe(callsBefore);
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-m6"]'),
  ).toBeTruthy();

  searchInput().dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.itemOpen).toBe("playlist");
    expect(active?.dataset.id).toBe("pl-m6");
  });

  searchInput().focus();
  searchInput().dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(
      document.querySelector("[data-playlist-search-toggle]"),
    );
  });
  expect(document.querySelector("[data-playlist-search]")).toBeTruthy();
  expect(searchInput().value).toBe("Ma");
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");
  expect(
    document.querySelector('button[data-item-open="playlist"][data-id="pl-m6"]'),
  ).toBeTruthy();

  (document.querySelector("[data-playlist-search-toggle]") as HTMLButtonElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-playlist-search]")).toBeNull());
  expect(document.querySelectorAll(".playlist-card")).toHaveLength(6);
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 1 of 2");
  expect(
    document.querySelector("[data-playlist-search-toggle]")?.getAttribute("aria-expanded"),
  ).toBe("false");
  expect(document.activeElement).toBe(document.querySelector("[data-playlist-search-toggle]"));
});

test("saved search state survives a child visit and clamps after the last match is removed", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = matchPlaylists();
  let removed = false;
  const remaining = () => playlists.filter((playlist) => playlist.id !== "pl-m6" || !removed);
  const current = () =>
    snapshot({
      playlists: remaining(),
      activePlaylistId: "pl-m0",
      revision: removed ? 1 : 0,
    });
  const queries: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, current());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.revision === 0) {
        return reply(409, { ok: false, reason: "conflict", revision: 7 });
      }
      return reply(200, lineupPage([lineupCategory("News")], null, 1, 7));
    }
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      if (command.type === "playlist.remove" && command.id === "pl-m6") removed = true;
      return reply(200, { ok: true, snapshot: current() });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector("[data-playlist-search-toggle]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-playlist-search]")).toBeTruthy());
  const search = document.querySelector("[data-playlist-search]") as HTMLInputElement;
  search.value = "Match";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(6));
  (document.querySelector('[data-playlist-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(1));
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");

  openPlaylistContent("pl-m6");
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(queries).toHaveLength(2);
  expect(queries[0]).toMatchObject({
    playlistId: "pl-m6",
    revision: 0,
    sourceVersion: 1,
    scope: "categories",
  });
  expect(queries[1]).toMatchObject({ playlistId: "pl-m6", revision: 7, sourceVersion: 1 });

  (document.querySelector('.crumbs a[href="#playlists/list"]') as HTMLAnchorElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(1));
  expect(document.querySelector("[data-playlist-search]")?.getAttribute("value")).toBe("Match");
  expect((document.querySelector("[data-playlist-search]") as HTMLInputElement).value).toBe(
    "Match",
  );
  expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2");
  expect(
    document.querySelector("[data-playlist-search-toggle]")?.getAttribute("aria-expanded"),
  ).toBe("true");

  removePlaylistFromIndex("pl-m6");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  await confirmAndSettle();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(6));
  expect(document.querySelector(".playlist-pagination")).toBeNull();
  expect((document.querySelector("[data-playlist-search]") as HTMLInputElement).value).toBe(
    "Match",
  );
  expect(
    document.querySelector("[data-playlist-search-toggle]")?.getAttribute("aria-expanded"),
  ).toBe("true");
});

test("a failed refresh gates its card while saved content stays openable", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Sport", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const activeError = {
    loading: false,
    error: "Could not refresh the playlist.",
    errorKey: "",
    errorDetail: "",
  };
  const withError = lineupSnapshot({ playlists, operation: activeError });
  let failRefresh = true;
  let removeSent = false;
  const refreshCommands: unknown[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, withError);
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      if (command.type === "playlist.refresh" && command.id === "pl-2") {
        refreshCommands.push(command);
      }
      if (command.type === "playlist.refresh" && command.id === "pl-2" && failRefresh) {
        return reply(500, { ok: false, reason: "" });
      }
      if (command.type === "playlist.remove") {
        removeSent = true;
        return reply(500, { ok: false, reason: "" });
      }
      return reply(200, {
        ok: true,
        snapshot: withError,
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  const card = (id: string) =>
    (
      document.querySelector(
        `button[data-item-open="playlist"][data-id="${id}"]`,
      ) as HTMLElement
    ).closest(".playlist-card") as HTMLElement;
  const open = (id: string) =>
    document.querySelector(
      `button[data-item-open="playlist"][data-id="${id}"]`,
    ) as HTMLButtonElement;

  expect(card("pl-1").textContent).toContain("Saved content");
  expect(card("pl-1").querySelector(".playlist-state-saved")).toBeTruthy();
  expect(open("pl-1").disabled).toBe(false);
  expect(card("pl-2").querySelector(".playlist-state-unavailable")).toBeNull();

  playlistRowAction("pl-2", "refresh");
  await vi.waitFor(() =>
    expect(card("pl-2").querySelector(".playlist-state-unavailable")).toBeTruthy(),
  );
  expect(card("pl-2").textContent).toContain("Unavailable");
  expect(open("pl-2").disabled).toBe(true);

  const calls = fetchMock.mock.calls.length;
  open("pl-2").click();
  expect(fetchMock.mock.calls.length).toBe(calls);
  expect(window.location.hash).not.toContain("view=content");

  openItemMenu("playlist", "pl-2");
  const menuActions = Array.from(
    document.querySelectorAll<HTMLElement>("[data-item-action]"),
  ).map((action) => action.dataset.itemAction);
  expect(menuActions.sort()).toEqual(["activate", "edit", "refresh", "remove", "reset"]);
  (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeNull(),
  );

  const inlineRefresh = document.querySelector<HTMLButtonElement>(
    '[data-action="playlist-refresh"][data-id="pl-2"]',
  );
  expect(inlineRefresh).toBeNull();

  failRefresh = false;
  playlistRowAction("pl-2", "refresh");
  await vi.waitFor(() => expect(refreshCommands).toHaveLength(2));
  await vi.waitFor(() =>
    expect(card("pl-2").querySelector(".playlist-state-unavailable")).toBeNull(),
  );
  expect(open("pl-2").disabled).toBe(false);
  expect(card("pl-1").textContent).toContain("Saved content");
  expect(card("pl-1").querySelector(".playlist-state-saved")).toBeTruthy();

  chooseItemAction("playlist", "pl-2", "remove");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
  );
  answerConfirmation(true);
  await vi.waitFor(() => expect(removeSent).toBe(true));
  await vi.waitFor(() =>
    expect(confirmDialog().querySelector('[role="alert"]')?.textContent).toBe(
      labels.changeFailed,
    ),
  );
  await confirmAndSettle(false);
  expect(card("pl-2").querySelector(".playlist-state-unavailable")).toBeNull();
  expect(open("pl-2").disabled).toBe(false);
});

test("an error toast survives same view rerenders without extending its deadline", async () => {
  vi.useFakeTimers();
  try {
    const playlists = [
      { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    ];
    await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, snapshot({ playlists }));
        if (path === "/api/v1/command") return reply(500, { ok: false, reason: "" });
        return reply(404, {});
      }),
    );
    playlistRowAction("pl-1", "refresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe(
      labels.changeFailed,
    );
    const toast = document.querySelector("[data-operation-status]");
    expect(toast?.classList.contains("error")).toBe(true);
    vi.advanceTimersByTime(2000);
    (document.querySelector("[data-playlist-search-toggle]") as HTMLButtonElement).click();
    expect(document.querySelector("[data-operation-status]")).toBe(toast);
    vi.advanceTimersByTime(3199);
    expect(document.querySelector("[data-operation-status]")).toBe(toast);
    vi.advanceTimersByTime(1);
    expect(document.querySelector("[data-operation-status]")).toBeNull();
    vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
  }
});

test("a deferred menu refresh preserves page focus and shows persistent feedback", async () => {
  const refreshedMessage = "Refreshed, 12 channels.";
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `pl-x${index}`,
      name: `Extra ${index}`,
      source: { kind: "m3u", url: `http://x${index}` },
      sourceVersion: 1,
    })),
    {
      id: "pl-late",
      name: "Late",
      source: { kind: "m3u", url: "http://late" },
      sourceVersion: 1,
    },
  ];
  let refreshSent = false;
  let resolveRefresh: (() => void) | undefined;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, snapshot({ playlists }));
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      if (command.type === "playlist.refresh" && command.id === "pl-late") {
        refreshSent = true;
        return new Promise((resolve) => {
          resolveRefresh = () =>
            resolve(
              reply(200, {
                ok: true,
                message: refreshedMessage,
                snapshot: snapshot({ playlists }),
              }),
            );
        });
      }
      return reply(200, { ok: true, snapshot: snapshot({ playlists }) });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-playlist-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".playlist-page-label")?.textContent).toBe("Page 2 of 2"),
  );
  const card = () =>
    (
      document.querySelector(
        'button[data-item-open="playlist"][data-id="pl-late"]',
      ) as HTMLElement
    ).closest(".playlist-card") as HTMLElement;
  const menuTrigger = () => itemMenuTrigger("playlist", "pl-late");
  const activateButton = () =>
    document.querySelector<HTMLButtonElement>(
      '[data-action="playlist-activate"][data-id="pl-late"]',
    )!;

  menuTrigger().focus();
  playlistRowAction("pl-late", "refresh");
  await vi.waitFor(() => expect(refreshSent).toBe(true));
  await vi.waitFor(() => {
    expect(activateButton().getAttribute("aria-disabled")).toBe("true");
  });
  expect(document.querySelectorAll('[data-action="playlist-refresh"]')).toHaveLength(0);
  expect(document.querySelectorAll("[data-operation-status]")).toHaveLength(1);
  expect(card().querySelector(".playlist-card-progress")).toBeTruthy();
  expect(card().textContent ?? "").toContain("Refreshing");
  expect(card().getAttribute("aria-busy")).toBe("true");
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(menuTrigger());
  });
  openItemMenu("playlist", "pl-late");
  expect(itemAction("activate").getAttribute("aria-disabled")).toBe("true");
  expect(itemAction("refresh").getAttribute("aria-disabled")).toBe("true");
  (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(itemMenuTrigger("playlist", "pl-late"));
  });

  resolveRefresh!();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe(
      refreshedMessage,
    ),
  );
  await vi.waitFor(() => {
    expect(activateButton().getAttribute("aria-disabled")).toBeNull();
  });
  expect(document.querySelectorAll('[data-action="playlist-refresh"]')).toHaveLength(0);
  expect(document.querySelectorAll("[data-operation-status]")).toHaveLength(1);
  expect(card().querySelector(".playlist-card-progress")).toBeNull();
  expect(card().getAttribute("aria-busy")).toBeNull();
});

test("the add overlay dismisses on its backdrop and keeps the list mounted", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, snapshot())),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  const overlay = document.querySelector('[data-form-overlay="playlist-add"]') as HTMLElement;
  expect(overlay.getAttribute("role")).toBe("dialog");
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();

  (
    overlay.parentElement!.querySelector("[data-playlist-add-dismiss]") as HTMLButtonElement
  ).click();
  await vi.waitFor(() => expect(document.querySelector("[data-add-playlist-form]")).toBeNull());
  expect(document.querySelector('[data-page="playlists"] .playlist-card')).toBeTruthy();
  expect(window.location.hash).toBe("#playlists/list");
});

test("reorder keeps one activity heading and scope crumbs stay inert", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let orderMode = "provider";
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/lineup/query") {
        return reply(
          200,
          lineupPage(
            [lineupCategory("News"), lineupCategory("Sport")],
            null,
            2,
            3,
            undefined,
            orderMode,
          ),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        const body = JSON.parse(String(options?.body));
        if (body.mutation && body.mutation.mode) orderMode = body.mutation.mode;
        return reply(200, { ok: true, revision: 4, affectedIds: [] });
      }
      if (path === "/api/v1/command") {
        return reply(200, { ok: true, snapshot: lineupSnapshot() });
      }
      return reply(200, lineupSnapshot());
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));

  const ancestorLinks = () =>
    Array.from(document.querySelectorAll(".crumbs a")).map((link) => link.getAttribute("href"));
  expect(ancestorLinks()).toContain("#playlists/list");

  await enterRemoteReorder();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
  );
  expect(document.querySelectorAll("[data-lineup-heading]")).toHaveLength(1);
  expect(document.querySelector("[data-lineup-heading]")?.textContent).toBe("Custom Order");
  expect(document.querySelector(".crumb-scope")).toBeTruthy();
  expect(document.querySelector(".crumb-scope")?.tagName).toBe("SPAN");
  expect(document.querySelector(".crumbs a.crumb-scope")).toBeNull();

  (document.querySelector("[data-lineup-mode-back]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(0),
  );
  expect(document.querySelectorAll("[data-lineup-heading]")).toHaveLength(1);
});

test("a rename save on a later page keeps the page query and search", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const scrollToMock = vi.fn();
  vi.stubGlobal("scrollTo", scrollToMock);
  const matchCategory = (index: number) => ({
    kind: "category",
    id: `cat-${String(index).padStart(2, "0")}`,
    contentKind: "live",
    name: `Match ${String(index).padStart(2, "0")}`,
    providerName: `Provider ${String(index).padStart(2, "0")}`,
    hidden: false,
    count: 1,
    unavailableCount: 0,
  });
  const all = Array.from({ length: 52 }, (_, index) => matchCategory(index + 1));
  const pageOne = all.slice(0, 50);
  const pageTwo = all.slice(50);
  let revision = 3;
  let resolveReload: (() => void) | null = null;
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.query === "Match" && body.offset === 50) {
        return new Promise((resolve) => {
          resolveReload = () =>
            resolve(reply(200, lineupPage([matchCategory(51)], null, 51, 4)));
        });
      }
      if (body.query === "Match" && body.cursor === "match-c2") {
        return reply(200, lineupPage(pageTwo, null, 52, revision));
      }
      if (body.query === "Match") {
        return reply(200, lineupPage(pageOne, "match-c2", 52, revision));
      }
      return reply(200, lineupPage(pageOne, "base-c2", 52, revision));
    }
    if (path === "/api/v1/lineup/mutation") {
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["cat-52"] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-search]")).toBeTruthy());
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  search.value = "Match";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(
    () =>
      expect(
        queryBodies.some(
          (body) =>
            body.query === "Match" && body.cursor === undefined && body.offset === undefined,
        ),
      ).toBe(true),
    { timeout: 5000 },
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("Match 50"));

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Match 52"));

  Object.defineProperty(window, "scrollY", { value: 320, configurable: true });
  await openRemoteRename("cat-52");
  const input = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  input.value = "Other 52";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(
      queryBodies.some(
        (body) => body.offset === 50 && body.query === "Match" && body.revision === 4,
      ),
    ).toBe(true),
  );
  expect(resolveReload).toBeTruthy();
  expect(scrollToMock).not.toHaveBeenCalledWith(0, 320);
  const pendingPencil = document.querySelector<HTMLButtonElement>(
    '[data-lineup-edit][data-id="cat-51"]',
  );
  expect(pendingPencil).toBeNull();
  expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy();

  resolveReload!();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-edit]")).toHaveLength(1),
  );
  const reloadBody = queryBodies
    .filter((body) => body.offset === 50 && body.query === "Match")
    .pop();
  expect(reloadBody?.revision).toBe(4);
  expect(reloadBody?.cursor).toBeUndefined();
  const searchAfter = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  expect(searchAfter?.value).toBe("Match");
  expect(
    document.querySelector("[data-lineup-search-toggle]")?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(document.body.textContent).toContain("Match 51");
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-edit")).toBe(true);
    expect(active?.dataset.id).toBe("cat-51");
  });
  expect(scrollToMock).toHaveBeenCalledWith(0, 320);
});

test("a rename save that empties the last page clamps to the surviving page", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const scrollToMock = vi.fn();
  vi.stubGlobal("scrollTo", scrollToMock);
  const matchCategory = (index: number) => ({
    kind: "category",
    id: `cat-${String(index).padStart(2, "0")}`,
    contentKind: "live",
    name: `Match ${String(index).padStart(2, "0")}`,
    providerName: `Provider ${String(index).padStart(2, "0")}`,
    hidden: false,
    count: 1,
    unavailableCount: 0,
  });
  const all = Array.from({ length: 51 }, (_, index) => matchCategory(index + 1));
  const pageOne = all.slice(0, 50);
  const pageTwo = all.slice(50);
  let revision = 3;
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.query === "Match" && body.offset === 50) {
        return reply(200, lineupPage([], null, 50, 4));
      }
      if (body.query === "Match" && body.offset === 0) {
        return reply(200, lineupPage(pageOne, null, 50, 4));
      }
      if (body.query === "Match" && body.cursor === "match-c2") {
        return reply(200, lineupPage(pageTwo, null, 51, revision));
      }
      if (body.query === "Match") {
        return reply(200, lineupPage(pageOne, "match-c2", 51, revision));
      }
      return reply(200, lineupPage(pageOne, "base-c2", 51, revision));
    }
    if (path === "/api/v1/lineup/mutation") {
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["cat-51"] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-search]")).toBeTruthy());
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  search.value = "Match";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(
    () =>
      expect(
        queryBodies.some(
          (body) =>
            body.query === "Match" && body.cursor === undefined && body.offset === undefined,
        ),
      ).toBe(true),
    { timeout: 5000 },
  );
  await vi.waitFor(() => expect(document.body.textContent).toContain("Match 50"));

  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.body.textContent).toContain("Match 51"));

  Object.defineProperty(window, "scrollY", { value: 320, configurable: true });
  await openRemoteRename("cat-51");
  const input = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  input.value = "Other 51";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-edit]")).toHaveLength(50),
  );
  const reloads = queryBodies.filter(
    (body) => body.query === "Match" && (body.offset === 50 || body.offset === 0),
  );
  expect(reloads.map((body) => body.offset)).toEqual([50, 0]);
  expect(reloads.every((body) => body.revision === 4 && body.cursor === undefined)).toBe(true);
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.hasAttribute("data-lineup-edit")).toBe(true);
    expect(active?.dataset.id).toBe("cat-01");
  });
  expect(scrollToMock).not.toHaveBeenCalledWith(0, 320);
});

test("a late rename reload does not steal focus after the scope changes", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal("scrollTo", vi.fn());
  const category = lineupCategory("News");
  let revision = 3;
  let resolveReload: (() => void) | null = null;
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      if (body.offset === 0 && body.scope === "categories" && !body.query) {
        return new Promise((resolve) => {
          resolveReload = () => resolve(reply(200, lineupPage([category], null, 1, 4)));
        });
      }
      if (body.scope === "channels") {
        return reply(200, lineupPage([lineupChannel(1)], null, 1, revision));
      }
      return reply(200, lineupPage([category], null, 1, revision));
    }
    if (path === "/api/v1/lineup/mutation") {
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["News"] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());

  await openRemoteRename("News");
  const input = document.querySelector('[name="editorValue"]') as HTMLInputElement;
  input.value = "News Two";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  document
    .querySelector("[data-lineup-editor]")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  await vi.waitFor(() =>
    expect(queryBodies.some((body) => body.offset === 0 && body.scope === "categories")).toBe(
      true,
    ),
  );
  expect(resolveReload).toBeTruthy();

  crumb("Playlists")?.click();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-item-open="playlist"]')).toBeTruthy(),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const info = document.querySelector(
    'button[data-lineup-provider-id="channel-1"]',
  ) as HTMLElement;
  expect(info).toBeTruthy();
  info.focus();
  expect(document.activeElement).toBe(info);

  resolveReload!();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(info);
  expect(document.querySelector("[data-operation-status]")?.textContent ?? "").not.toContain(
    labels.saved,
  );
  expect(document.querySelector('[data-lineup-edit][data-id="channel-1"]')).toBeTruthy();
  expect(document.querySelector('[data-lineup-edit][data-id="News"]')).toBeNull();
  expect(document.querySelector("[data-lineup-editor]")).toBeNull();
});

test("snapshot focus restores row controls and channel row buttons in scope", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      return reply(
        200,
        body.scope === "channels"
          ? lineupPage([lineupChannel(1), lineupChannel(2)], null, 2, revision)
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    revision += 1;
    return reply(200, { ok: true, revision, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());

  const pencil = document.querySelector('[data-lineup-edit][data-id="News"]') as HTMLElement;
  expect(pencil).toBeTruthy();
  pencil.focus();
  expect(document.activeElement).toBe(pencil);
  await app.sendLineupMutation(
    { type: "category.visibility", categoryKey: "News", hidden: true },
    null,
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.id).toBe("News");
    expect(active?.hasAttribute("data-lineup-edit")).toBe(true);
  });

  const eye = document.querySelector('[data-lineup-visibility][data-id="News"]') as HTMLElement;
  expect(eye).toBeTruthy();
  eye.focus();
  expect(document.activeElement).toBe(eye);
  await app.sendLineupMutation(
    { type: "category.visibility", categoryKey: "News", hidden: false },
    null,
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.id).toBe("News");
    expect(active?.hasAttribute("data-lineup-visibility")).toBe(true);
  });

  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  const info = document.querySelector(
    'button[data-lineup-provider-id="channel-1"]',
  ) as HTMLElement;
  expect(info).toBeTruthy();
  info.focus();
  expect(document.activeElement).toBe(info);
  await app.sendLineupMutation(
    { type: "channel.visibility", channelId: "channel-1", hidden: true },
    null,
  );
  await vi.waitFor(() => {
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.lineupProviderId).toBe("channel-1");
    expect(active?.hasAttribute("data-settings-informational")).toBe(false);
    expect(active?.tagName).toBe("BUTTON");
  });
});

test("channel bulk visibility sends only the category scope and rolls back on failure", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  let revision = 3;
  let failBulk = true;
  const hiddenById: Record<string, boolean> = { "channel-1": false, "channel-2": true };
  const mutations: unknown[] = [];
  const queries: Array<Record<string, unknown>> = [];
  let heldMutation: ((response: unknown) => void) | null = null;
  const channelsPage = () =>
    lineupPage(
      [
        { ...lineupChannel(1), hidden: hiddenById["channel-1"] },
        { ...lineupChannel(2), hidden: hiddenById["channel-2"] },
      ],
      "chan-c2",
      60,
      revision,
    );
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, lineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      return reply(
        200,
        body.scope === "channels"
          ? channelsPage()
          : lineupPage([lineupCategory("News")], null, 1, revision),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as {
        mutation?: { type?: string; categoryKey?: string; hidden?: boolean };
      };
      mutations.push(body.mutation);
      if (failBulk) {
        return new Promise((resolve) => {
          heldMutation = resolve;
        });
      }
      if (body.mutation?.type === "channels.visibility") {
        hiddenById["channel-1"] = !!body.mutation.hidden;
        hiddenById["channel-2"] = !!body.mutation.hidden;
      }
      revision += 1;
      return reply(200, { ok: true, revision, affectedIds: ["News"] });
    }
    return reply(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-search]")).toBeTruthy());
  const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  search.value = "Channel";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(
    () =>
      expect(
        queries.some((body) => body.query === "Channel" && body.scope === "channels"),
      ).toBe(true),
    { timeout: 5000 },
  );

  const eyeState = (id: string) => {
    const eye = lineupRowControl(id, "data-lineup-visibility");
    return {
      checked: eye.getAttribute("aria-checked"),
      label: eye.getAttribute("aria-label") ?? "",
    };
  };
  expect(eyeState("channel-1").checked).toBe("true");
  expect(eyeState("channel-2").checked).toBe("false");
  const hiddenChannelRow = document.querySelector(".lineup-row-channel.hidden") as HTMLElement;
  expect(hiddenChannelRow).toBeTruthy();
  const channelMain = hiddenChannelRow.querySelector(".lineup-row-main") as HTMLElement;
  const channelTag = hiddenChannelRow.querySelector(".lineup-hidden-tag") as HTMLElement;
  expect(channelTag).toBeTruthy();
  expect(channelTag.textContent).toBe("Hidden");
  expect(channelMain.contains(channelTag)).toBe(false);
  expect(channelMain.nextElementSibling).toBe(channelTag);

  const bulkButtons = () => [
    ...document.querySelectorAll<HTMLButtonElement>("[data-lineup-bulk]"),
  ];
  expect(
    bulkButtons()
      .map((button) => button.dataset.lineupBulk)
      .sort(),
  ).toEqual(["hide", "show"]);

  (document.querySelector('[data-lineup-bulk="hide"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toEqual({
    type: "channels.visibility",
    categoryKey: "News",
    hidden: true,
  });
  expect(JSON.stringify(mutations[0])).not.toContain("channel-1");
  await vi.waitFor(() => expect(heldMutation).toBeTruthy());
  await vi.waitFor(() => {
    expect(eyeState("channel-1").checked).toBe("false");
    expect(eyeState("channel-2").checked).toBe("false");
  });
  for (const button of bulkButtons()) {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  }
  expect(document.querySelector("[data-lineup-bulk-confirm]")).toBeNull();
  const back = document.querySelector<HTMLButtonElement>("[data-lineup-mode-back]");
  expect(back).toBeTruthy();
  expect(back?.disabled).toBe(false);

  const queryCount = queries.length;
  heldMutation!({ status: 500, ok: false, json: async () => ({ error: "failed" }) });
  await vi.waitFor(() => {
    expect(eyeState("channel-1").checked).toBe("true");
    expect(eyeState("channel-2").checked).toBe("false");
  });
  expect(eyeState("channel-1").label).toContain("Hide");
  expect(eyeState("channel-2").label).toContain("Show");
  await vi.waitFor(() =>
    expect(
      queries
        .slice(queryCount)
        .some(
          (body) =>
            body.scope === "channels" &&
            body.categoryKey === "News" &&
            body.query === "Channel" &&
            body.offset === 0,
        ),
    ).toBe(true),
  );
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(document.querySelector("[data-lineup-editor]")).toBeNull();

  failBulk = false;
  (document.querySelector('[data-lineup-bulk="show"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(mutations).toHaveLength(2));
  expect(mutations[1]).toEqual({
    type: "channels.visibility",
    categoryKey: "News",
    hidden: false,
  });
  await vi.waitFor(() => {
    expect(eyeState("channel-1").checked).toBe("true");
    expect(eyeState("channel-2").checked).toBe("true");
  });
  await vi.waitFor(() =>
    expect(
      queries.some(
        (body) =>
          body.scope === "channels" &&
          body.categoryKey === "News" &&
          body.query === "Channel" &&
          body.revision === 4,
      ),
    ).toBe(true),
  );
  expect(document.querySelector("[data-lineup-bulk-confirm]")).toBeNull();
});

test("an unrelated or absent lineup summary never replaces the managed revision", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const pl1 = {
    id: "pl-1",
    name: "News",
    source: { kind: "m3u", url: "http://example.com/list.m3u" },
    sourceVersion: 1,
  };
  const pl2 = {
    id: "pl-2",
    name: "Other",
    source: { kind: "m3u", url: "http://example.com/other.m3u" },
    sourceVersion: 1,
  };
  const stateBody = (change: Record<string, unknown> = {}) =>
    snapshot({ playlists: [pl1, pl2], activePlaylistId: "pl-1", ...change });
  let revision = 3;
  const sent: number[] = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") {
      return reply(200, stateBody({ lineup: { playlistId: "pl-1", revision, ready: true } }));
    }
    if (path === "/api/v1/lineup/query") {
      return reply(200, lineupPage([lineupChannel(1)], null, 1, revision));
    }
    if (path === "/api/v1/lineup/mutation") {
      const body = JSON.parse(String(options?.body)) as { revision: number };
      sent.push(body.revision);
      revision += 1;
      if (sent.length === 1) {
        return reply(409, {
          ok: false,
          reason: "conflict",
          revision,
          snapshot: stateBody({
            activePlaylistId: "pl-2",
            lineup: { playlistId: "pl-2", revision: 99, ready: true },
          }),
        });
      }
      if (sent.length === 2) {
        return reply(409, {
          ok: false,
          reason: "conflict",
          revision,
          snapshot: stateBody({ lineup: null }),
        });
      }
      return reply(200, { ok: true, revision, affectedIds: [] });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));

  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "One" },
    null,
  );
  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "Two" },
    null,
  );
  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "Three" },
    null,
  );
  expect(sent).toEqual([3, 4, 5]);
});

test("an inactive owner keeps page, search and editor state through an unrelated active snapshot", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const pl1 = {
    id: "pl-1",
    name: "Managed",
    source: { kind: "m3u", url: "http://example.com/managed.m3u" },
    sourceVersion: 1,
  };
  const pl2 = {
    id: "pl-2",
    name: "Active",
    source: { kind: "m3u", url: "http://example.com/active.m3u" },
    sourceVersion: 1,
  };
  let activeRevision = 7;
  let snapshotRevision = 0;
  const activeSnapshot = () =>
    snapshot({
      revision: snapshotRevision,
      playlists: [pl1, pl2],
      activePlaylistId: "pl-2",
      lineup: { playlistId: "pl-2", revision: activeRevision, ready: true },
    });
  const channels = Array.from({ length: 60 }, (_, index) => lineupChannel(index + 1));
  const revision = 3;
  const queries: Array<Record<string, unknown>> = [];
  const pageFor = offsetPage(channels, 60, () => revision);
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, activeSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (body.playlistId !== "pl-1") return reply(404, {});
      if (body.revision === 0) {
        return reply(409, {
          ok: false,
          reason: "conflict",
          revision,
          snapshot: activeSnapshot(),
        });
      }
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, revision));
      }
      if (typeof body.query === "string" && body.query) {
        const needle = body.query.toLowerCase();
        const filtered = channels.filter((channel) =>
          channel.name.toLowerCase().includes(needle),
        );
        return reply(200, lineupPage(filtered.slice(0, 50), null, filtered.length, revision));
      }
      const served = pageFor(body);
      return reply(served.status, served.body);
    }
    if (path === "/api/v1/command") {
      const body = JSON.parse(String(options?.body)) as { command: object };
      expect(body.command).toEqual({ type: "playlist.refresh", id: "pl-2" });
      activeRevision += 1;
      snapshotRevision += 1;
      return reply(200, { ok: true, snapshot: activeSnapshot() });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  const refreshActive = (source: HTMLElement | null = null) =>
    app.sendCommandForTest({ type: "playlist.refresh", id: "pl-2" }, false, source);
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent("pl-1");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-manager, [data-page='content']")).toBeTruthy(),
  );
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".lineup-row").length).toBeGreaterThan(0),
  );

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );

  await refreshActive();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe(
      "Channel 51",
    ),
  );

  (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
  const searchField = document.querySelector("[data-lineup-search]") as HTMLInputElement;
  searchField.value = "Channel 5";
  searchField.dispatchEvent(new Event("input", { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 5"),
  );

  await refreshActive(searchField);
  await vi.waitFor(() =>
    expect((document.querySelector("[data-lineup-search]") as HTMLInputElement).value).toBe(
      "Channel 5",
    ),
  );
  expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 5");

  await openRemoteRename("channel-5");
  const nameField = document.querySelector(
    '[data-lineup-editor] [name="editorName"]',
  ) as HTMLInputElement;
  nameField.value = "Draft Name";
  nameField.dispatchEvent(new Event("input", { bubbles: true }));
  nameField.focus();
  await refreshActive(nameField);
  await vi.waitFor(() =>
    expect((document.activeElement as HTMLInputElement | null)?.name).toBe("editorName"),
  );
  expect(
    (document.querySelector('[data-lineup-editor] [name="editorName"]') as HTMLInputElement)
      .value,
  ).toBe("Draft Name");
  expect(queries.every((query) => query.playlistId === "pl-1")).toBe(true);
  expect(queries.slice(1).every((query) => query.revision === revision)).toBe(true);
});

test("a source replacement in a conflict snapshot resets before handling the old revision", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const pl1v1 = {
    id: "pl-1",
    name: "News",
    source: { kind: "m3u", url: "http://example.com/list.m3u" },
    sourceVersion: 1,
  };
  const pl1v2 = { ...pl1v1, sourceVersion: 2 };
  const replacedSnapshot = () =>
    snapshot({
      playlists: [pl1v2],
      activePlaylistId: "pl-1",
      lineup: { playlistId: "pl-1", revision: 0, ready: false },
    });
  const revision = 3;
  let replaced = false;
  const queryBodies: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") {
      return reply(
        200,
        replaced
          ? replacedSnapshot()
          : snapshot({
              playlists: [pl1v1],
              activePlaylistId: "pl-1",
              lineup: { playlistId: "pl-1", revision, ready: true },
            }),
      );
    }
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queryBodies.push(body);
      const served = replaced ? 0 : revision;
      if (body.scope === "categories") {
        return reply(200, lineupPage([lineupCategory("News")], null, 1, served));
      }
      return reply(200, lineupPage([lineupChannel(1)], null, 1, served));
    }
    if (path === "/api/v1/lineup/mutation") {
      replaced = true;
      return reply(409, {
        ok: false,
        reason: "conflict",
        revision: 9,
        snapshot: replacedSnapshot(),
      });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".lineup-row").length).toBeGreaterThan(0),
  );
  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel strong")?.textContent).toBe("Channel 1"),
  );
  const drilledHash = window.location.hash;
  expect(drilledHash).toContain("category=");

  await app.sendLineupMutation(
    { type: "channel.rename", channelId: "channel-1", name: "One" },
    null,
  );
  expect(document.body.textContent).not.toContain("Channel 1");
  expect(window.location.hash).not.toContain("category=");
  expect(window.location.hash).toContain("scope=categories");
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  const status = document.querySelector("[data-operation-status]");
  expect(status?.textContent ?? "").not.toContain(labels.changeFailed);
  const active = document.activeElement as HTMLElement | null;
  expect(active === null || active.isConnected).toBe(true);

  const before = queryBodies.length;
  await app.loadLineupPage("reset");
  await vi.waitFor(() => expect(queryBodies.length).toBeGreaterThan(before));
  const fresh = queryBodies[before];
  expect(fresh.playlistId).toBe("pl-1");
  expect(fresh.revision).toBe(0);
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".lineup-row").length).toBeGreaterThan(0),
  );
});

test("an old successful mutation cannot affect its replacement source or focus", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const managed = {
    id: "pl-1",
    name: "Managed",
    source: { kind: "m3u", url: "http://example.com/managed.m3u" },
    sourceVersion: 1,
  };
  const replacement = {
    ...managed,
    source: { kind: "m3u", url: "http://example.com/replacement.m3u" },
    sourceVersion: 2,
  };
  const active = {
    id: "pl-2",
    name: "Active",
    source: { kind: "m3u", url: "http://example.com/active.m3u" },
    sourceVersion: 1,
  };
  let replaced = false;
  let mutationStarted = false;
  let releaseMutation = () => {};
  const newRevisions: number[] = [];
  const queries: Array<Record<string, unknown>> = [];
  const stateBody = () =>
    snapshot({
      revision: replaced ? 1 : 0,
      playlists: [replaced ? replacement : managed, active],
      activePlaylistId: "pl-2",
      lineup: { playlistId: "pl-2", revision: replaced ? 8 : 7, ready: true },
    });
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, stateBody());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
      queries.push(body);
      if (replaced) newRevisions.push(Number(body.revision));
      const revision = replaced ? 6 : 3;
      if (body.revision !== revision) {
        return reply(409, {
          ok: false,
          reason: "conflict",
          revision,
          snapshot: stateBody(),
        });
      }
      return reply(
        200,
        lineupPage(
          body.scope === "categories"
            ? [lineupCategory(replaced ? "Replacement" : "News")]
            : [lineupChannel(1)],
          null,
          1,
          revision,
        ),
      );
    }
    if (path === "/api/v1/lineup/mutation") {
      return new Promise((resolve) => {
        mutationStarted = true;
        releaseMutation = () =>
          resolve(reply(200, { ok: true, revision: 4, affectedIds: ["channel-1"] }));
      });
    }
    if (path === "/api/v1/command") {
      replaced = true;
      return reply(200, { ok: true, snapshot: stateBody() });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  window.history.replaceState({}, "", "/#playlists/list");
  await app.start();
  openPlaylistContent("pl-1");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row")?.textContent).toContain("News"),
  );
  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-channel")?.textContent).toContain("Channel 1"),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-lineup-visibility][data-id="channel-1"]'),
    ).toBeTruthy(),
  );
  await vi.waitFor(() => {
    const row = document.querySelector<HTMLElement>(
      '[data-lineup-visibility][data-id="channel-1"]',
    )!;
    expect(row.hasAttribute("disabled")).toBe(false);
    expect(row.getAttribute("aria-disabled")).not.toBe("true");
  });
  const oldRow = document.querySelector<HTMLElement>(
    '[data-lineup-visibility][data-id="channel-1"]',
  )!;
  oldRow.focus();
  const pending = app.sendLineupMutation(
    { type: "channel.visibility", channelId: "channel-1", hidden: true },
    oldRow,
  );
  await vi.waitFor(() => expect(mutationStarted).toBe(true));

  await app.sendCommandForTest({ type: "playlist.refresh", id: "pl-2" }, false, null);
  await vi.waitFor(() =>
    expect(document.querySelector("#lineup")?.textContent).toContain("Replacement"),
  );
  expect(newRevisions).toEqual([0, 6]);
  expect(window.location.hash).not.toContain("category=");
  expect(document.querySelector<HTMLButtonElement>("[data-lineup-visibility]")?.disabled).toBe(
    false,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newControl = document.querySelector<HTMLButtonElement>("[data-lineup-search-toggle]")!;
  expect(newControl.disabled).toBe(false);
  newControl.focus();
  const feedback = () => document.querySelector("[data-operation-status]")?.textContent ?? "";
  const beforeFeedback = feedback();
  const beforeQueries = queries.length;

  releaseMutation();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(queries).toHaveLength(beforeQueries);
  expect(feedback()).toBe(beforeFeedback);
  expect(document.activeElement).toBe(newControl);
  expect(oldRow.isConnected).toBe(false);
  expect(document.querySelector("#lineup")?.textContent).toContain("Replacement");
});

function expectQuietLineup() {
  expect(document.querySelector("[data-lineup-retry]")).toBeNull();
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).not.toBe("true");
  const status = document.querySelector("[data-operation-status]")?.textContent ?? "";
  expect(status).not.toContain(labels.saving);
  expect(status).not.toContain(labels.saved);
}

test.each([false, true])(
  "queued visibility uses acknowledged revisions after a no op: %s",
  async (noOp) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    let revision = 3;
    let hidden = false;
    const first = deferredReply();
    const second = deferredReply();
    const mutations: CapturedLineupMutation[] = [];
    const queries: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        if (path === "/api/v1/lineup/query") {
          queries.push(JSON.parse(String(options?.body)));
          return reply(200, lineupPage([{ ...lineupCategory(), hidden }], null, 1, revision));
        }
        if (path === "/api/v1/lineup/mutation") {
          mutations.push(JSON.parse(String(options?.body)));
          return mutations.length === 1 ? first.promise : second.promise;
        }
        return reply(404, {});
      }),
    );
    window.history.replaceState({}, "", "/#playlists/list");
    const app = loadApp();
    await app.start();
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-lineup-visibility]")).toBeTruthy(),
    );
    const eye = () => lineupRowControl("News", "data-lineup-visibility");
    const pending = noOp
      ? app.sendLineupMutation(
          { type: "category.visibility", categoryKey: "News", hidden: false },
          null,
        )
      : undefined;
    if (!noOp) eye().click();
    await vi.waitFor(() => expect(mutations).toHaveLength(1));
    expect(eye().getAttribute("aria-checked")).toBe(String(noOp));
    eye().click();
    expect(eye().getAttribute("aria-checked")).toBe(String(!noOp));
    expect(eye().disabled).toBe(false);
    expect(mutations).toHaveLength(1);
    expectQuietLineup();

    revision = noOp ? 3 : 4;
    hidden = !noOp;
    first.complete(200, { ok: true, revision, affectedIds: ["News"] });
    await vi.waitFor(() => expect(mutations).toHaveLength(2));
    expect(mutations.map((body) => body.revision)).toEqual([3, revision]);
    expect(
      mutations.every((body) => body.playlistId === "pl-1" && body.sourceVersion === 1),
    ).toBe(true);
    expect(mutations[1].mutation).toEqual({
      type: "category.visibility",
      categoryKey: "News",
      hidden: noOp,
    });
    hidden = noOp;
    revision += 1;
    second.complete(200, { ok: true, revision, affectedIds: ["News"] });
    if (pending) await pending;
    await vi.waitFor(() =>
      expect(queries.some((body) => body.revision === revision)).toBe(true),
    );
    expect(eye().getAttribute("aria-checked")).toBe(String(!hidden));
    expectQuietLineup();
  },
);

test.each([500, 409])(
  "background failure %s preserves the last ACK and discards unsent intent",
  async (status) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    let revision = 3;
    let newsHidden = false;
    let holdRecovery = false;
    const failing = deferredReply();
    const recovery = deferredReply();
    const mutations: CapturedLineupMutation[] = [];
    const queries: Array<Record<string, unknown>> = [];
    const page = () =>
      lineupPage(
        [{ ...lineupCategory("News"), hidden: newsHidden }, lineupCategory("Sports")],
        null,
        2,
        revision,
      );
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        if (path === "/api/v1/lineup/query") {
          queries.push(JSON.parse(String(options?.body)));
          return holdRecovery ? recovery.promise : reply(200, page());
        }
        if (path === "/api/v1/lineup/mutation") {
          mutations.push(JSON.parse(String(options?.body)));
          if (mutations.length === 1) {
            revision = 4;
            newsHidden = true;
            return reply(200, { ok: true, revision, affectedIds: ["News"] });
          }
          return failing.promise;
        }
        return reply(404, {});
      }),
    );
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-visibility]")).toHaveLength(2),
    );
    const eye = (id: string) => lineupRowControl(id, "data-lineup-visibility");
    eye("News").click();
    await vi.waitFor(() => expect(queries.some((body) => body.revision === 4)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    eye("Sports").click();
    await vi.waitFor(() => expect(mutations).toHaveLength(2));
    eye("News").click();
    expect(eye("News").getAttribute("aria-checked")).toBe("true");
    expect(eye("Sports").getAttribute("aria-checked")).toBe("false");
    expect(eye("News").disabled).toBe(false);
    expect(eye("Sports").disabled).toBe(false);

    holdRecovery = true;
    const queriesBeforeFailure = queries.length;
    if (status === 409) revision = 5;
    failing.complete(status, {
      ok: false,
      reason: status === 409 ? "conflict" : "persistence",
      revision,
      ...(status === 409
        ? {
            snapshot: lineupSnapshot({ lineup: { playlistId: "pl-1", revision, ready: true } }),
          }
        : {}),
    });
    await vi.waitFor(() => expect(queries.length).toBeGreaterThan(queriesBeforeFailure));
    expect(eye("News").getAttribute("aria-checked")).toBe("false");
    expect(eye("Sports").getAttribute("aria-checked")).toBe("true");
    expect(mutations).toHaveLength(2);
    expectQuietLineup();
    recovery.complete(200, page());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mutations).toHaveLength(2);
    expect(eye("News").getAttribute("aria-checked")).toBe("false");
  },
);

test("a page one write failure never installs its baseline into page two", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const categories = Array.from({ length: 51 }, (_, index) =>
    lineupCategory(`Category ${index + 1}`),
  );
  const mutation = deferredReply();
  const recovery = deferredReply();
  let holdRecovery = false;
  const queries: Array<Record<string, unknown>> = [];
  const mutations: CapturedLineupMutation[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (holdRecovery) return recovery.promise;
        const secondPage = body.cursor === "last-page" || body.offset === 50;
        return reply(
          200,
          lineupPage(
            secondPage ? categories.slice(50) : categories.slice(0, 50),
            secondPage ? null : "last-page",
            51,
          ),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        mutations.push(JSON.parse(String(options?.body)));
        return mutation.promise;
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
  toggleRemoteRowVisibility("Category 1");
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  (document.querySelector('[data-lineup-page="next"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(1));
  expect(lineupRowControl("Category 51", "data-lineup-visibility")).toBeTruthy();
  holdRecovery = true;
  const beforeFailure = queries.length;
  mutation.complete(500, { ok: false, reason: "persistence", revision: 3 });
  await vi.waitFor(() => expect(queries.length).toBeGreaterThan(beforeFailure));
  expect(queries[queries.length - 1]).toMatchObject({
    offset: 50,
    revision: 3,
    scope: "categories",
  });
  expect(document.querySelectorAll(".lineup-row")).toHaveLength(1);
  expect(document.querySelector('[data-lineup-edit][data-id="Category 1"]')).toBeNull();
  expect(lineupRowControl("Category 51", "data-lineup-visibility")).toBeTruthy();
  expectQuietLineup();
  recovery.complete(200, lineupPage(categories.slice(50), null, 51));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelectorAll(".lineup-row")).toHaveLength(1);
});

test.each([200, 500])(
  "old owner completion %s preserves another owner's grabbed order and revision",
  async (status) => {
    localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
    const playlists = [
      { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
      { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
    ];
    const old = deferredReply();
    let revisionB = 8;
    let reversed = false;
    const mutations: CapturedLineupMutation[] = [];
    const queries: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          queries.push(body);
          if (body.playlistId === "pl-1") return reply(200, lineupPage([lineupCategory()]));
          if (body.revision === 0)
            return reply(409, { ok: false, reason: "conflict", revision: revisionB });
          const names = reversed ? ["B second", "B first"] : ["B first", "B second"];
          return reply(
            200,
            lineupPage(
              names.map((name) => lineupCategory(name)),
              null,
              2,
              revisionB,
              undefined,
              "custom",
            ),
          );
        }
        if (path === "/api/v1/lineup/mutation") {
          const body = JSON.parse(String(options?.body)) as CapturedLineupMutation;
          mutations.push(body);
          if (body.playlistId === "pl-1") return old.promise;
          reversed = true;
          revisionB = 9;
          return reply(200, { ok: true, revision: revisionB, affectedIds: ["B first"] });
        }
        return reply(404, {});
      }),
    );
    window.history.replaceState({}, "", "/#playlists/list");
    await loadApp().start();
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-lineup-visibility]")).toBeTruthy(),
    );
    toggleRemoteRowVisibility("News");
    await vi.waitFor(() => expect(mutations).toHaveLength(1));
    crumb("Playlists")!.click();
    await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
    openPlaylistContent("pl-2");
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(2));
    preferenceButton("custom-order").click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-sort]")).toHaveLength(2),
    );
    const row = () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("[data-lineup-sort]")).find(
        (button) => button.dataset.id === "B first",
      )!;
    row().focus();
    row().click();
    row().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    );
    expect(row().getAttribute("aria-pressed")).toBe("true");
    old.complete(
      status,
      status === 200
        ? { ok: true, revision: 4, affectedIds: ["News"] }
        : { ok: false, reason: "persistence", revision: 3 },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(row().getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(row());
    row().click();
    await vi.waitFor(() => expect(mutations).toHaveLength(2));
    expect(mutations[1]).toMatchObject({
      playlistId: "pl-2",
      sourceVersion: 1,
      revision: 8,
      mutation: {
        type: "category.place",
        placement: { itemId: "B first", afterId: "B second" },
      },
    });
    await vi.waitFor(() => expect(row().getAttribute("aria-pressed")).toBe("false"));
    await vi.waitFor(() =>
      expect(queries.some((body) => body.playlistId === "pl-2" && body.revision === 9)).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  },
);

test("reentering an unloaded view reapplies pending visibility without making it durable", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const write = deferredReply();
  const reentry = deferredReply();
  const recovery = deferredReply();
  let readPhase = "initial";
  const queries: Array<Record<string, unknown>> = [];
  const mutations: CapturedLineupMutation[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        queries.push(JSON.parse(String(options?.body)));
        if (readPhase === "reentry") return reentry.promise;
        if (readPhase === "recovery") return recovery.promise;
        return reply(200, lineupPage([lineupCategory()]));
      }
      if (path === "/api/v1/lineup/mutation") {
        mutations.push(JSON.parse(String(options?.body)));
        return write.promise;
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-visibility]")).toBeTruthy(),
  );
  toggleRemoteRowVisibility("News");
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  crumb("Playlists")!.click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
  readPhase = "reentry";
  const beforeReentry = queries.length;
  openPlaylistContent();
  await vi.waitFor(() => expect(queries.length).toBeGreaterThan(beforeReentry));
  expect(document.querySelector("[data-lineup-visibility]")).toBeNull();
  reentry.complete(200, lineupPage([lineupCategory()]));
  await vi.waitFor(() =>
    expect(
      lineupRowControl("News", "data-lineup-visibility").getAttribute("aria-checked"),
    ).toBe("false"),
  );
  readPhase = "recovery";
  const beforeFailure = queries.length;
  write.complete(500, { ok: false, reason: "persistence", revision: 3 });
  await vi.waitFor(() => expect(queries.length).toBeGreaterThan(beforeFailure));
  expect(lineupRowControl("News", "data-lineup-visibility").getAttribute("aria-checked")).toBe(
    "true",
  );
  expectQuietLineup();
  recovery.complete(200, lineupPage([lineupCategory()]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mutations).toHaveLength(1);
});

async function startSavedRemote(fetchMock: unknown) {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  const app = loadApp();
  await app.start();
  return app;
}

test("an older quiet page cannot erase an ACK while the next write is pending", async () => {
  let revision = 3;
  let newsHidden = false;
  let recovering = false;
  const oldRead = deferredReply();
  const newsWrite = deferredReply();
  const sportsWrite = deferredReply();
  const recovery = deferredReply();
  const oldPage = lineupPage([lineupCategory("News"), lineupCategory("Sports")]);
  const mutations: CapturedLineupMutation[] = [];
  let reads = 0;
  const page = () =>
    lineupPage(
      [{ ...lineupCategory("News"), hidden: newsHidden }, lineupCategory("Sports")],
      null,
      2,
      revision,
    );
  const app = await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        reads += 1;
        if (reads === 2) return oldRead.promise;
        return recovering ? recovery.promise : reply(200, page());
      }
      if (path === "/api/v1/lineup/mutation") {
        mutations.push(JSON.parse(String(options?.body)));
        if (mutations.length === 1)
          return reply(200, { ok: true, revision: 3, affectedIds: [] });
        return mutations.length === 2 ? newsWrite.promise : sportsWrite.promise;
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-visibility]")).toHaveLength(2),
  );
  await app.sendLineupMutation(
    { type: "category.visibility", categoryKey: "News", hidden: false },
    null,
  );
  await vi.waitFor(() => expect(reads).toBe(2));
  toggleRemoteRowVisibility("News");
  await vi.waitFor(() => expect(mutations).toHaveLength(2));
  toggleRemoteRowVisibility("Sports");
  newsHidden = true;
  revision = 4;
  newsWrite.complete(200, { ok: true, revision, affectedIds: ["News"] });
  await vi.waitFor(() => expect(mutations).toHaveLength(3));
  expect(mutations[2].revision).toBe(4);
  oldRead.complete(200, oldPage);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const checked = (id: string) =>
    lineupRowControl(id, "data-lineup-visibility").getAttribute("aria-checked");
  expect(checked("News")).toBe("false");
  expect(checked("Sports")).toBe("false");
  recovering = true;
  sportsWrite.complete(500, { ok: false, reason: "persistence", revision: 4 });
  await vi.waitFor(() => expect(reads).toBe(3));
  expect(checked("News")).toBe("false");
  expect(checked("Sports")).toBe("true");
  expectQuietLineup();
  recovery.complete(200, page());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mutations).toHaveLength(3);
});

test("an inconsistent foreground page stops retrying without new queue progress", async () => {
  const quietRead = deferredReply();
  const normalReads: Array<Record<string, unknown>> = [];
  let reads = 0;
  let normal = false;
  const app = await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        if (normal) {
          normalReads.push(JSON.parse(String(options?.body)));
          return normalReads.length <= 2
            ? reply(200, lineupPage([lineupCategory()]))
            : reply(500, { ok: false });
        }
        reads += 1;
        return reads === 2 ? quietRead.promise : reply(200, lineupPage([lineupCategory()]));
      }
      if (path === "/api/v1/lineup/mutation")
        return reply(200, { ok: true, revision: 4, affectedIds: ["News"] });
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-lineup-visibility]")).toBeTruthy(),
  );
  toggleRemoteRowVisibility("News");
  await vi.waitFor(() => expect(reads).toBe(2));
  normal = true;
  await app.loadLineupPage("current");
  expect(normalReads).toHaveLength(2);
  expect(normalReads.every((body) => body.revision === 4 && body.offset === 0)).toBe(true);
  expect(document.querySelector("[data-lineup-retry]")).toBeTruthy();
  quietRead.complete(200, lineupPage([{ ...lineupCategory(), hidden: true }], null, 1, 4));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(normalReads).toHaveLength(2);
  expect(document.querySelector("[data-lineup-retry]")).toBeTruthy();
});

test("channel Save flushes visibility and retries only its failed number step", async () => {
  let revision = 3;
  let name = "Channel 1";
  let number = 2;
  let hidden = false;
  let numberFailed = false;
  const eyeWrite = deferredReply();
  const mutations: CapturedLineupMutation[] = [];
  const queries: Array<Record<string, unknown>> = [];
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        return reply(
          200,
          lineupPage(
            body.scope === "channels"
              ? [{ ...lineupChannel(1, name), number, hidden }]
              : [lineupCategory()],
            null,
            1,
            revision,
          ),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        const body = JSON.parse(String(options?.body)) as CapturedLineupMutation;
        mutations.push(body);
        if (mutations.length === 1) return eyeWrite.promise;
        if (body.mutation.type === "channel.rename") name = String(body.mutation.name);
        if (body.mutation.type === "channel.number") {
          if (!numberFailed) {
            numberFailed = true;
            return reply(500, { ok: false, reason: "duplicate-number", revision });
          }
          number = Number(body.mutation.number);
        }
        if (body.mutation.type === "channel.visibility") hidden = Boolean(body.mutation.hidden);
        revision += 1;
        return reply(200, { ok: true, revision, affectedIds: ["channel-1"] });
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-edit]")).toBeTruthy());
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  toggleRemoteRowVisibility("channel-1");
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  await openRemoteRename("channel-1");
  (document.querySelector('[name="editorName"]') as HTMLInputElement).value = "Committed name";
  (document.querySelector('[name="editorNumber"]') as HTMLInputElement).value = "42";
  const submit = () =>
    document
      .querySelector("[data-lineup-editor]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  submit();
  submit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mutations).toHaveLength(1);
  revision = 4;
  hidden = true;
  eyeWrite.complete(200, { ok: true, revision, affectedIds: ["channel-1"] });
  await vi.waitFor(() => expect(document.querySelector(".lineup-editor .notice")).toBeTruthy());
  expect(mutations.map((body) => [body.mutation.type, body.revision])).toEqual([
    ["channel.visibility", 3],
    ["channel.rename", 4],
    ["channel.number", 5],
  ]);
  expect((document.querySelector('[name="editorName"]') as HTMLInputElement).value).toBe(
    "Committed name",
  );
  expect((document.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe(
    "42",
  );
  submit();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  expect(mutations.map((body) => [body.mutation.type, body.revision])).toEqual([
    ["channel.visibility", 3],
    ["channel.rename", 4],
    ["channel.number", 5],
    ["channel.number", 5],
  ]);
  expect(mutations[1].mutation).toEqual({
    type: "channel.rename",
    channelId: "channel-1",
    name: "Committed name",
  });
  expect(mutations.slice(2).map((body) => body.mutation)).toEqual([
    { type: "channel.number", channelId: "channel-1", number: 42 },
    { type: "channel.number", channelId: "channel-1", number: 42 },
  ]);
  expect(queries.some((body) => body.revision === 6 && body.scope === "channels")).toBe(true);
  await vi.waitFor(() =>
    expect(
      document.querySelector('#lineup[aria-busy="false"] .lineup-channel-name')?.textContent,
    ).toBe("Committed name"),
  );
  expect(document.querySelector(".lineup-channel-name")?.textContent).toBe("Committed name");
  expect(document.querySelector(".lineup-channel-number")?.textContent).toBe("42");
  toggleRemoteRowVisibility("channel-1");
  await vi.waitFor(() => expect(mutations).toHaveLength(5));
  expect(mutations[4].revision).toBe(6);
  expect(mutations.every((body) => body.sourceVersion === 1)).toBe(true);
  expect(document.querySelector(".lineup-channel-name")?.textContent).toBe("Committed name");
  await vi.waitFor(() => expect(queries.some((body) => body.revision === 7)).toBe(true));
});

test.each([false, true])(
  "row completion preserves or invalidates an editor for source replacement: %s",
  async (replaceSource) => {
    const rowWrite = deferredReply();
    const firstWrite = deferredReply();
    const mutations: CapturedLineupMutation[] = [];
    const queries: Array<Record<string, unknown>> = [];
    let replaced = false;
    let revision = 3;
    let savedName = "Channel 1";
    const playlists = () => [
      {
        id: "pl-1",
        name: "News",
        source: { kind: "m3u", url: replaced ? "http://new-a" : "http://a" },
        sourceVersion: replaced ? 2 : 1,
      },
      { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
    ];
    await startSavedRemote(
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state")
          return reply(200, lineupSnapshot({ playlists: playlists() }));
        if (path === "/api/v1/command") return rowWrite.promise;
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          queries.push(body);
          if (replaced) {
            if (body.revision === 0)
              return reply(409, { ok: false, reason: "conflict", revision: 3 });
            return reply(200, lineupPage([lineupCategory("Replacement")]));
          }
          return reply(
            200,
            lineupPage(
              body.scope === "channels"
                ? [{ ...lineupChannel(1, savedName), number: revision >= 5 ? 42 : 2 }]
                : [lineupCategory()],
              null,
              1,
              revision,
            ),
          );
        }
        if (path === "/api/v1/lineup/mutation") {
          mutations.push(JSON.parse(String(options?.body)));
          if (mutations.length === 1) return firstWrite.promise;
          revision = 5;
          return reply(200, { ok: true, revision, affectedIds: ["channel-1"] });
        }
        return reply(404, {});
      }),
    );
    playlistRowAction("pl-2", "refresh");
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelector("[data-lineup-edit]")).toBeTruthy());
    lineupRowOpenAction("News");
    await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
    if (replaceSource) {
      toggleRemoteRowVisibility("channel-1");
      await vi.waitFor(() => expect(mutations).toHaveLength(1));
      toggleRemoteRowVisibility("channel-1");
    }
    await openRemoteRename("channel-1");
    (document.querySelector('[name="editorName"]') as HTMLInputElement).value =
      "Committed name";
    (document.querySelector('[name="editorNumber"]') as HTMLInputElement).value = "42";
    document
      .querySelector("[data-lineup-editor]")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(mutations).toHaveLength(1));
    const selection = (document.querySelector('[name="editorName"]') as HTMLInputElement)
      .selectionStart;
    replaced = replaceSource;
    rowWrite.complete(200, {
      ok: true,
      snapshot: lineupSnapshot({ revision: 1, playlists: playlists() }),
    });
    if (replaceSource) {
      await vi.waitFor(() =>
        expect(document.querySelector("#lineup")?.textContent).toContain("Replacement"),
      );
      firstWrite.complete(200, { ok: true, revision: 4, affectedIds: ["channel-1"] });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mutations).toHaveLength(1);
      expect(document.querySelector("[data-lineup-editor]")).toBeNull();
      expect(queries.some((body) => body.sourceVersion === 2)).toBe(true);
      expect(document.querySelector("#lineup")?.textContent).toContain("Replacement");
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const input = document.querySelector('[name="editorName"]') as HTMLInputElement;
      expect(input.value).toBe("Committed name");
      expect(input.selectionStart).toBe(selection);
      expect(input.disabled).toBe(true);
      expect((document.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe(
        "42",
      );
      const submit = document.querySelector(
        '[data-lineup-editor] button[type="submit"]',
      ) as HTMLButtonElement;
      expect(submit.getAttribute("aria-busy")).toBe("true");
      expect(submit.getAttribute("aria-label")).toBe(labels.saving);
      expect(
        (
          document.querySelector(
            '[data-lineup-editor] [data-lineup-action="cancel-editor"]',
          ) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      savedName = "Committed name";
      revision = 4;
      firstWrite.complete(200, { ok: true, revision, affectedIds: ["channel-1"] });
      await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
      expect(mutations.map((body) => [body.mutation.type, body.revision])).toEqual([
        ["channel.rename", 3],
        ["channel.number", 4],
      ]);
      await vi.waitFor(() =>
        expect(
          document.querySelector('#lineup[aria-busy="false"] .lineup-channel-name')
            ?.textContent,
        ).toBe("Committed name"),
      );
      expect(queries.some((body) => body.revision === 5 && body.scope === "channels")).toBe(
        true,
      );
    }
  },
);

test.each(["search", "back"])(
  "a row completion restores the current Saved %s focus",
  async (target) => {
    const refresh = deferredReply();
    await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, snapshot());
        return refresh.promise;
      }),
    );
    playlistRowAction("pl-1", "refresh");
    if (target === "search") {
      (document.querySelector("[data-playlist-search-toggle]") as HTMLButtonElement).click();
      const input = document.querySelector("[data-playlist-search]") as HTMLInputElement;
      input.value = "News";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const current = document.querySelector("[data-playlist-search]") as HTMLInputElement;
      current.focus();
      current.setSelectionRange(1, 3);
    } else {
      (
        document.querySelector('[data-focus-key="playlists-back"]') as HTMLAnchorElement
      ).focus();
    }
    const oldFocus = document.activeElement;
    refresh.complete(200, { ok: true, snapshot: snapshot({ revision: 1 }) });
    await vi.waitFor(() =>
      expect(
        document.querySelector(
          target === "search" ? "[data-playlist-search]" : '[data-focus-key="playlists-back"]',
        ),
      ).not.toBe(oldFocus),
    );
    const current = document.querySelector(
      target === "search" ? "[data-playlist-search]" : '[data-focus-key="playlists-back"]',
    ) as HTMLInputElement | HTMLAnchorElement;
    expect(current).not.toBe(oldFocus);
    expect(document.activeElement).toBe(current);
    expect(window.location.hash).toBe("#playlists/list");
    if (current instanceof HTMLInputElement) {
      expect(current.value).toBe("News");
      expect([current.selectionStart, current.selectionEnd]).toEqual([1, 3]);
    } else {
      expect(current.getAttribute("href")).toBe("#playlists");
    }
  },
);

test("an old owner query snapshot cannot replace a newer unrelated source", async () => {
  const oldQuery = deferredReply();
  const playlists = (version: number) => [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    {
      id: "pl-2",
      name: "Other",
      source: { kind: "m3u", url: version === 1 ? "http://b" : "http://new-b" },
      sourceVersion: version,
    },
  ];
  const oldSnapshot = lineupSnapshot({ playlists: playlists(1) });
  const oldResponse = {
    ok: false,
    reason: "conflict",
    revision: 4,
    snapshot: lineupSnapshot({
      playlists: playlists(1),
      lineup: { playlistId: "pl-1", revision: 4, ready: true },
    }),
  };
  let published = false;
  let firstQuery = true;
  const queries: Array<Record<string, unknown>> = [];
  const app = await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, oldSnapshot);
      if (path === "/api/v1/command") {
        published = true;
        const updated = lineupSnapshot({ revision: 1, playlists: playlists(2) });
        updated.settings.showClock = false;
        return reply(200, { ok: true, snapshot: updated });
      }
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (firstQuery) {
          firstQuery = false;
          return oldQuery.promise;
        }
        if (body.playlistId === "pl-2" && body.revision === 0) {
          return reply(409, { ok: false, reason: "conflict", revision: 8 });
        }
        return reply(
          200,
          lineupPage([lineupCategory()], null, 1, body.playlistId === "pl-2" ? 8 : 4),
        );
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(queries).toHaveLength(1));
  await app.sendCommandForTest(
    { type: "setting", key: "showClock", value: false },
    false,
    null,
  );
  expect(published).toBe(true);
  oldQuery.complete(409, oldResponse);
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-edit]")).toBeTruthy());
  crumb("Playlists")!.click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
  openPlaylistContent("pl-2");
  await vi.waitFor(() =>
    expect(queries.some((body) => body.playlistId === "pl-2" && body.revision === 8)).toBe(
      true,
    ),
  );
  const ownerB = queries.filter((body) => body.playlistId === "pl-2");
  expect(ownerB.map((body) => body.revision)).toEqual([0, 8]);
  expect(ownerB.every((body) => body.sourceVersion === 2)).toBe(true);
  await vi.waitFor(() =>
    expect(
      document.querySelector('#lineup[aria-busy="false"] [data-lineup-edit][data-id="News"]'),
    ).toBeTruthy(),
  );
});

test("playlist entry focuses the selected content tab when the source has tabs", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        return reply(
          200,
          lineupPage([lineupCategory("live", "live")], null, 1, 3, {
            live: 1,
            movie: 1,
            series: 1,
          }),
        );
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-kind]")).toHaveLength(3),
  );
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector('.lineup-tabs [role="tab"][aria-selected="true"]'),
    ),
  );
  expect((document.activeElement as HTMLElement).dataset.lineupKind).toBe("live");
});

test("playlist entry focuses the first row control when no content tabs exist", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        return reply(200, lineupPage([lineupCategory("News")]));
      }
      return reply(404, {});
    }),
  );
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  expect(document.querySelector(".lineup-tabs")).toBeNull();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      document.querySelector("#lineup .lineup-list .lineup-row .lineup-row-open"),
    ),
  );
});

test("vertical content tabs separate directional focus from native activation", async () => {
  const style = document.createElement("style");
  style.textContent = ".lineup-tabs { flex-direction: column !important; }";
  document.head.appendChild(style);
  onTestFinished(() => style.remove());
  const queries: Array<Record<string, unknown>> = [];
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        const kind = String(body.contentKind);
        return reply(
          200,
          lineupPage([lineupCategory(kind, kind)], null, 1, 3, {
            live: 1,
            movie: 1,
            series: 1,
          }),
        );
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelectorAll("[data-lineup-kind]")).toHaveLength(3),
  );
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-edit]")).toBeTruthy());
  const tab = (kind: string) =>
    document.querySelector<HTMLButtonElement>(`[data-lineup-kind="${kind}"]`)!;
  const key = (button: HTMLButtonElement, value: string) => {
    const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    return event;
  };
  expect(document.querySelector('[role="tablist"]')?.getAttribute("aria-orientation")).toBe(
    "vertical",
  );
  tab("live").focus();
  key(tab("live"), "ArrowDown");
  expect(document.activeElement).toBe(tab("movie"));
  key(tab("movie"), "End");
  expect(document.activeElement).toBe(tab("series"));
  key(tab("series"), "Home");
  expect(document.activeElement).toBe(tab("live"));
  expect(queries).toHaveLength(1);
  expect(tab("live").getAttribute("aria-selected")).toBe("true");
  key(tab("live"), "ArrowDown");
  expect(key(tab("movie"), "Enter").defaultPrevented).toBe(false);
  tab("movie").click();
  await vi.waitFor(() => expect(queries).toHaveLength(2));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="movie"]')).toBeTruthy(),
  );
  expect(queries[1].contentKind).toBe("movie");
  expect(tab("movie").getAttribute("aria-selected")).toBe("true");
  expect(document.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  tab("movie").focus();
  key(tab("movie"), "ArrowDown");
  expect(key(tab("series"), " ").defaultPrevented).toBe(false);
  tab("series").click();
  await vi.waitFor(() => expect(queries).toHaveLength(3));
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="series"]')).toBeTruthy(),
  );
  expect(queries[2].contentKind).toBe("series");
  expect(tab("series").getAttribute("aria-selected")).toBe("true");
  expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(
    tab("series").id,
  );
});

test("content header Back follows row parents and returns to the saved list", async () => {
  const queries: Array<Record<string, unknown>> = [];
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage([lineupChannel(1)], null, 1, 3)
            : lineupPage([lineupCategory("News")], null, 1, 3),
        );
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());

  expect(document.querySelector(".manage-rail")).toBeTruthy();
  expect(document.querySelector(".manage-edge-rail")).toBeNull();
  expect(
    document.querySelector(".content-head .page-back[data-lineup-mode-back]"),
  ).toBeTruthy();

  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());
  (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("News"),
  );
  await vi.waitFor(() =>
    expect((document.activeElement as HTMLElement).dataset.id).toBe("News"),
  );
  expect(queries.map((body) => body.scope)).toEqual(["categories", "channels", "categories"]);

  (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-list")).toBeTruthy());
  const head = document.querySelector<HTMLElement>(".page-head")!;
  const back = head.querySelector<HTMLElement>('.page-back[href="#playlists"]')!;
  const title = head.querySelector<HTMLElement>(".page-head-text h1")!;
  const actions = head.querySelector<HTMLElement>(".page-head-actions")!;
  const search = actions.querySelector<HTMLButtonElement>("[data-playlist-search-toggle]")!;
  const add = actions.querySelector<HTMLButtonElement>('[data-action="open-add-playlist"]')!;
  expect(back.parentElement).toBe(head);
  expect(title.textContent).toBe("Saved playlists");
  expect(actions.parentElement).toBe(head);
  expect(actions.children).toHaveLength(2);
  expect(search.getAttribute("aria-label")).toBe(labels.searchPlaylists);
  expect(search.title).toBe(labels.searchPlaylists);
  expect(add.getAttribute("aria-label")).toBe(labels.addPlaylist);
  expect(add.title).toBe(labels.addPlaylist);
  expect(document.querySelector(".playlist-tools")).toBeNull();
});

test("compact lineup menus edit rows and queue category and provider visibility", async () => {
  const providerId = 'provider:"east"';
  const mutations: CapturedLineupMutation[] = [];
  let revision = 3;
  let categoryHidden = false;
  let channelHidden = false;
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return reply(
          200,
          body.scope === "channels"
            ? lineupPage(
                [{ ...lineupChannel(1), id: providerId, hidden: channelHidden }],
                null,
                1,
                revision,
              )
            : lineupPage([{ ...lineupCategory(), hidden: categoryHidden }], null, 1, revision),
        );
      }
      if (path === "/api/v1/lineup/mutation") {
        const body = JSON.parse(String(options?.body)) as CapturedLineupMutation;
        mutations.push(body);
        revision += 1;
        if (body.mutation.type === "category.visibility")
          categoryHidden = body.mutation.hidden === true;
        if (body.mutation.type === "channel.visibility")
          channelHidden = body.mutation.hidden === true;
        return reply(200, {
          ok: true,
          revision,
          affectedIds: [body.mutation.type === "category.visibility" ? "News" : providerId],
        });
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector('[data-lineup-edit][data-id="News"]')).toBeTruthy(),
  );

  const categoryMenu = document.querySelector<HTMLButtonElement>(
    '.lineup-compact-menu[data-id="News"]',
  )!;
  categoryMenu.click();
  expect(itemAction("edit").textContent).toContain("Rename category");
  expect(itemAction("visibility").textContent).toContain("Hide");
  expect(itemAction("visibility").querySelector(".item-menu-action-icon")).toBeTruthy();
  itemAction("visibility").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]?.mutation).toEqual({
    type: "category.visibility",
    categoryKey: "News",
    hidden: true,
  });
  await vi.waitFor(() =>
    expect(
      lineupRowControl("News", "data-lineup-visibility").getAttribute("aria-checked"),
    ).toBe("false"),
  );

  lineupRowOpenAction("News");
  await vi.waitFor(() =>
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('[data-item-open="lineup"]')].some(
        (button) => button.dataset.id === providerId,
      ),
    ).toBe(true),
  );
  itemMenuTrigger("lineup", providerId).click();
  expect(itemAction("edit").textContent).toContain("Edit channel details");
  expect(itemAction("visibility").textContent).toContain("Hide");
  itemAction("edit").click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeTruthy());
  const editor = document.querySelector<HTMLElement>("[data-lineup-editor]")!;
  expect((editor.querySelector('[name="editorName"]') as HTMLInputElement).value).toBe(
    "Channel 1",
  );
  expect((editor.querySelector('[name="editorNumber"]') as HTMLInputElement).value).toBe("2");
  (editor.querySelector('[data-lineup-action="cancel-editor"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-lineup-editor]")).toBeNull());
  const restoredTrigger = itemMenuTrigger("lineup", providerId);
  const restoredPrimary = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-item-open="lineup"]'),
  ].find((button) => button.dataset.id === providerId)!;
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(
      getComputedStyle(restoredTrigger).display === "none" ? restoredPrimary : restoredTrigger,
    ),
  );

  const beforeStatus = document.querySelector("[data-operation-status]")?.textContent ?? "";
  itemMenuTrigger("lineup", providerId).click();
  expect(itemAction("visibility").textContent).toContain("Hide");
  itemAction("visibility").click();
  await vi.waitFor(() => expect(mutations).toHaveLength(2));
  expect(mutations[1]?.mutation).toEqual({
    type: "channel.visibility",
    channelId: providerId,
    hidden: true,
  });
  await vi.waitFor(() =>
    expect(
      lineupRowControl(providerId, "data-lineup-visibility").getAttribute("aria-checked"),
    ).toBe("false"),
  );
  expect(document.querySelector("#lineup")?.getAttribute("aria-busy")).not.toBe("true");
  expect(document.querySelector("[data-operation-status]")?.textContent ?? "").toBe(
    beforeStatus,
  );
  expect(document.querySelector(".lineup-state.notice")).toBeNull();
  itemMenuTrigger("lineup", providerId).click();
  expect(itemAction("visibility").textContent).toContain("Show");
  (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();
});

test("closing a compact lineup menu after its trigger is hidden restores the row primary", async () => {
  await startSavedRemote(
    vi.fn((path: string) =>
      path === "/api/v1/state"
        ? reply(200, lineupSnapshot())
        : path === "/api/v1/lineup/query"
          ? reply(200, lineupPage([lineupCategory()]))
          : reply(404, {}),
    ),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  const trigger = document.querySelector<HTMLButtonElement>(
    '.lineup-compact-menu[data-id="News"]',
  )!;
  trigger.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeTruthy(),
  );
  const style = document.createElement("style");
  style.textContent = ".lineup-compact-menu { display: none; }";
  document.head.append(style);
  try {
    (document.querySelector("[data-item-menu-close]") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector('[data-item-open="lineup"][data-id="News"]'),
      ),
    );
  } finally {
    style.remove();
  }
});

test("a parent snapshot cannot restore a prior playlist owner", async () => {
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 2 },
  ];
  const queries: Array<Record<string, unknown>> = [];
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (body.scope === "channels") return reply(200, lineupPage([lineupChannel(1)]));
        return reply(
          200,
          lineupPage([lineupCategory(body.playlistId === "pl-2" ? "Other" : "News")]),
        );
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() => expect(document.querySelector(".lineup-row")).toBeTruthy());
  lineupRowOpenAction("News");
  await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());

  window.location.hash = "#playlists?view=content&playlist=pl-2&scope=categories&kind=live";
  window.dispatchEvent(new Event("hashchange"));
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Other"),
  );
  expect(queries.some((body) => body.playlistId === "pl-2")).toBe(true);
  (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-list")).toBeTruthy());
  expect(document.querySelector(".lineup-row")).toBeNull();
  expect(queries.some((body) => body.playlistId === "pl-1" && body.scope === "channels")).toBe(
    true,
  );
});

test("a pending initial page keeps controls usable and cannot replace the next view", async () => {
  const pending = deferredReply();
  const queries: Array<Record<string, unknown>> = [];
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        queries.push(JSON.parse(String(options?.body)));
        return pending.promise;
      }
      return reply(404, {});
    }),
  );
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy(),
  );
  const body = document.querySelector(".lineup-results-body") as HTMLElement;
  expect(body.getAttribute("role")).toBe("status");
  expect(body.getAttribute("aria-live")).toBe("polite");
  expect(body.children).toHaveLength(2);
  expect(body.querySelector(".lineup-loading-mark")).toBeTruthy();
  expect(body.querySelector(".lineup-loading-name")?.textContent).toContain("Provider");
  expect(document.querySelector(".list-count")).toBeNull();
  expect(document.querySelector(".lineup-row")).toBeNull();
  expect(document.querySelector("[data-lineup-preferences]")).toBeNull();
  expect(document.querySelector("[data-lineup-bulk]")).toBeNull();
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  expect(tabs).toHaveLength(0);
  expect(
    (document.querySelector(".content-head .page-back") as HTMLButtonElement).disabled,
  ).toBe(false);
  const toggle = document.querySelector<HTMLButtonElement>("[data-lineup-search-toggle]")!;
  toggle.click();
  expect((document.querySelector("[data-lineup-search]") as HTMLInputElement).disabled).toBe(
    false,
  );

  (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-list")).toBeTruthy());
  pending.complete(200, lineupPage([lineupCategory("Stale")]));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(document.querySelector(".playlist-list")).toBeTruthy();
  expect(document.querySelector(".manage-content")).toBeNull();
  expect(queries).toHaveLength(1);
});

test("horizontal content tabs measure the ink axis and rove in both directions", async () => {
  const style = document.createElement("style");
  style.textContent = ".lineup-tabs { flex-direction: row !important; }";
  document.head.appendChild(style);
  const originalRect = Element.prototype.getBoundingClientRect;
  const originalDirection = document.documentElement.dir;
  let resizeInk: ResizeObserverCallback | undefined;
  class TestResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeInk = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const queries: Array<Record<string, unknown>> = [];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList?.contains("lineup-tabs")) {
      return {
        left: 50,
        right: 350,
        top: 20,
        bottom: 68,
        width: 300,
        height: 48,
        x: 50,
        y: 20,
        toJSON: () => ({}),
      } as DOMRect;
    }
    if (this.classList?.contains("lineup-tab-text")) {
      return {
        left: 100,
        right: 180,
        top: 30,
        bottom: 50,
        width: 80,
        height: 20,
        x: 100,
        y: 30,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return originalRect.call(this);
  };
  try {
    await startSavedRemote(
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          queries.push(body);
          return reply(
            200,
            lineupPage([lineupCategory(String(body.contentKind))], null, 1, 3, {
              live: 1,
              movie: 1,
              series: 1,
            }),
          );
        }
        return reply(404, {});
      }),
    );
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelectorAll("[data-lineup-kind]")).toHaveLength(3),
    );
    const strip = document.querySelector('[role="tablist"]') as HTMLElement;
    const ink = document.querySelector(".lineup-tab-ink") as HTMLElement;
    expect(strip.getAttribute("aria-orientation")).toBe("horizontal");
    expect(ink.style.transform).toBe("translateX(48px)");
    expect(ink.style.width).toBe("84px");
    expect(ink.style.height).toBe("3px");
    const tab = (kind: string) =>
      document.querySelector<HTMLButtonElement>(`[data-lineup-kind="${kind}"]`)!;
    const key = (element: HTMLElement, value: string) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      );
    strip.style.direction = "ltr";
    document.documentElement.dir = "ltr";
    tab("movie").focus();
    key(tab("movie"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("live"));
    tab("movie").focus();
    key(tab("movie"), "ArrowRight");
    expect(document.activeElement).toBe(tab("series"));
    document.documentElement.dir = "rtl";
    strip.style.direction = "rtl";
    tab("movie").focus();
    key(tab("movie"), "ArrowRight");
    expect(document.activeElement).toBe(tab("live"));
    tab("movie").focus();
    key(tab("movie"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("series"));
    style.textContent = ".lineup-tabs { flex-direction: column !important; }";
    resizeInk?.([], {} as ResizeObserver);
    expect(strip.getAttribute("aria-orientation")).toBe("vertical");
    expect(ink.style.width).toBe("3px");
    expect(ink.style.height).toBe("24px");
    strip.style.direction = "ltr";
    tab("movie").focus();
    key(tab("movie"), "ArrowDown");
    expect(document.activeElement).toBe(tab("series"));
    tab("movie").focus();
    key(tab("movie"), "ArrowUp");
    expect(document.activeElement).toBe(tab("live"));
    style.textContent = ".lineup-tabs { flex-direction: row !important; }";
    resizeInk?.([], {} as ResizeObserver);
    expect(strip.getAttribute("aria-orientation")).toBe("horizontal");
    expect(ink.style.width).toBe("84px");
    expect(ink.style.height).toBe("3px");
    expect(queries).toHaveLength(1);
  } finally {
    Element.prototype.getBoundingClientRect = originalRect;
    document.documentElement.dir = originalDirection;
    style.remove();
  }
});

test("header Back restores the filtered parent page, opener and scroll after acceptance", async () => {
  const first = Array.from({ length: 50 }, (_, index) => lineupCategory(`Category ${index}`));
  const target = lineupCategory("Target");
  const filteredFirstPage = deferredReply();
  const secondPage = deferredReply();
  const parentPage = deferredReply();
  const queries: Array<Record<string, unknown>> = [];
  const originalScrollY = window.scrollY;
  const originalFocus = HTMLElement.prototype.focus;
  const restorationEvents: string[] = [];
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options?: FocusOptions,
  ) {
    if (this.dataset.id === "Target") {
      restorationEvents.push("focus:" + String(options?.preventScroll === true));
    }
    return originalFocus.call(this, options);
  });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 321 });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {
    restorationEvents.push("scroll");
  });
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot());
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (body.scope === "channels") return reply(200, lineupPage([lineupChannel(1)]));
        if (body.query === "filter" && body.offset === 50) return parentPage.promise;
        if (body.query === "filter" && body.cursor === "filtered-page-two") {
          return secondPage.promise;
        }
        if (body.query === "filter") return filteredFirstPage.promise;
        return reply(200, lineupPage(first, "filtered-page-two", 51, 3));
      }
      return reply(404, {});
    }),
  );
  try {
    openPlaylistContent();
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
    (document.querySelector("[data-lineup-search-toggle]") as HTMLButtonElement).click();
    const search = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    search.value = "filter";
    search.focus();
    search.setSelectionRange(1, 3);
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(queries.some((body) => body.query === "filter")).toBe(true));
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy(),
    );
    const pendingSearch = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    expect(document.activeElement).toBe(pendingSearch);
    expect(pendingSearch.selectionStart).toBe(1);
    expect(pendingSearch.selectionEnd).toBe(3);
    filteredFirstPage.complete(200, lineupPage(first, "filtered-page-two", 51, 3));
    await vi.waitFor(() => expect(document.querySelectorAll(".lineup-row")).toHaveLength(50));
    const nextPage = document.querySelector<HTMLButtonElement>('[data-lineup-page="next"]')!;
    nextPage.click();
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-results-body.is-loading")).toBeTruthy(),
    );
    expect(document.querySelector(".lineup-row")).toBeNull();
    expect(document.querySelector(".list-head .list-count")?.textContent).toBe("51");
    const searchAfterPage = document.querySelector("[data-lineup-search]") as HTMLInputElement;
    expect(searchAfterPage.value).toBe("filter");
    const queryCount = queries.length;
    nextPage.click();
    expect(queries).toHaveLength(queryCount);
    secondPage.complete(200, lineupPage([target], null, 51, 3));
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Target"),
    );
    lineupRowOpenAction("Target");
    await vi.waitFor(() => expect(document.querySelector(".lineup-row-channel")).toBeTruthy());

    (document.querySelector(".content-head .page-back") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        queries.some(
          (body) =>
            body.scope === "categories" && body.query === "filter" && body.offset === 50,
        ),
      ).toBe(true),
    );
    expect((document.querySelector("[data-lineup-search]") as HTMLInputElement).value).toBe(
      "filter",
    );
    expect(window.scrollTo).not.toHaveBeenCalled();
    parentPage.complete(200, lineupPage([target], null, 51, 3));
    await vi.waitFor(() =>
      expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Target"),
    );
    await vi.waitFor(() =>
      expect((document.activeElement as HTMLElement).dataset.id).toBe("Target"),
    );
    expect(window.scrollTo).toHaveBeenCalledWith(0, 321);
    expect(restorationEvents.slice(-2)).toEqual(["focus:true", "scroll"]);
  } finally {
    Object.defineProperty(window, "scrollY", { configurable: true, value: originalScrollY });
  }
});

test("inactive playlist reset requires a safe answer and a private owner revision", async () => {
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
    { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
  ];
  const privateRead = deferredReply();
  const reset = deferredReply();
  const queries: Array<Record<string, unknown>> = [];
  const mutations: CapturedLineupMutation[] = [];
  const commands: unknown[] = [];
  await startSavedRemote(
    vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/v1/state") return reply(200, lineupSnapshot({ playlists }));
      if (path === "/api/v1/command") {
        commands.push(JSON.parse(String(options?.body)));
        return reply(500, { ok: false });
      }
      if (path === "/api/v1/lineup/query") {
        const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        queries.push(body);
        if (body.playlistId === "pl-1") return reply(200, lineupPage([lineupCategory()]));
        if (body.revision === 0) {
          return reply(409, {
            ok: false,
            reason: "conflict",
            revision: 7,
            snapshot: lineupSnapshot({ playlists }),
          });
        }
        return privateRead.promise;
      }
      if (path === "/api/v1/lineup/mutation") {
        mutations.push(JSON.parse(String(options?.body)));
        return reset.promise;
      }
      return reply(404, {});
    }),
  );
  const openReset = async () => {
    playlistMenuAction("pl-2", "reset");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
    );
  };
  await openReset();
  const cancel = confirmDialog().querySelector<HTMLButtonElement>("[data-confirm-cancel]")!;
  const accept = confirmDialog().querySelector<HTMLButtonElement>("[data-confirm-accept]")!;
  expect(document.activeElement).toBe(cancel);
  cancel.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.activeElement).toBe(accept);
  accept.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(document.activeElement).toBe(cancel);
  cancel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );
  expect((document.activeElement as HTMLElement).dataset.id).toBe("pl-2");
  await openReset();
  (document.querySelector("[data-confirm-dismiss]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );
  expect(queries).toHaveLength(0);
  expect(mutations).toHaveLength(0);
  await openReset();
  answerConfirmation(true);
  await vi.waitFor(() => expect(queries).toHaveLength(2));
  expect(queries[0]).toMatchObject({
    playlistId: "pl-2",
    sourceVersion: 1,
    revision: 0,
    scope: "categories",
    contentKind: "live",
    includeHidden: true,
    limit: 1,
  });
  expect(queries[1]).toMatchObject({
    playlistId: "pl-2",
    sourceVersion: 1,
    revision: 7,
    limit: 1,
  });
  answerConfirmation(true);
  answerConfirmation(false);
  (document.querySelector("[data-confirm-dismiss]") as HTMLButtonElement).click();
  expect(confirmDialog()).toBeTruthy();
  expect(mutations).toHaveLength(0);
  expect(
    (confirmDialog().querySelector("[data-confirm-cancel]") as HTMLButtonElement).disabled,
  ).toBe(true);
  privateRead.complete(200, lineupPage([lineupCategory("B")], null, 1, 7));
  await vi.waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    playlistId: "pl-2",
    sourceVersion: 1,
    revision: 7,
    mutation: { type: "playlist.reset" },
  });
  answerConfirmation(true);
  expect(mutations).toHaveLength(1);
  reset.complete(200, { ok: true, revision: 8, affectedIds: [] });
  await vi.waitFor(() =>
    expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
  );
  expect(commands).toHaveLength(0);
  openPlaylistContent("pl-1");
  await vi.waitFor(() => expect(queries).toHaveLength(3));
  expect(queries[2]).toMatchObject({ playlistId: "pl-1", revision: 3, sourceVersion: 1 });
  await vi.waitFor(() =>
    expect(
      document.querySelector('#lineup[aria-busy="false"] [data-lineup-edit][data-id="News"]'),
    ).toBeTruthy(),
  );
});

test.each([200, 401, 500, "network"] as const)(
  "About reset handles %s without assuming an unacknowledged success",
  async (outcome) => {
    const commands: Array<{ revision: number; command: unknown }> = [];
    await startSavedRemote(
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/state") return reply(200, snapshot());
        if (path === "/api/v1/command") {
          commands.push(JSON.parse(String(options?.body)));
          if (commands.length === 1 && outcome === "network")
            return Promise.reject(new Error("offline"));
          if (commands.length === 1 && outcome !== 200 && outcome !== "network") {
            return reply(outcome, { ok: false });
          }
          return reply(200, {
            ok: true,
            snapshot: snapshot({ playlists: [], activePlaylistId: "" }),
          });
        }
        return reply(404, {});
      }),
    );
    (document.querySelector('.manage-rail a[href="#about"]') as HTMLAnchorElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-page="about"]')).toBeTruthy());
    const disconnectWarning =
      "This will also disconnect paired devices. Pair again to reconnect.";
    expect(document.querySelector('[data-page="about"]')?.textContent).not.toContain(
      disconnectWarning,
    );
    (document.querySelector('[data-action="reset-app-data"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
    );
    expect(confirmDialog().textContent).toContain(disconnectWarning);
    expect(confirmDialog().textContent).not.toContain(
      "It does not delete the source playlists",
    );
    expect(commands).toHaveLength(0);
    answerConfirmation(true);
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(commands[0]).toMatchObject({ revision: 0, command: { type: "app.reset" } });
    if (outcome === 500 || outcome === "network") {
      await vi.waitFor(() =>
        expect(confirmDialog().querySelector('[role="alert"]')).toBeTruthy(),
      );
      expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}").credential).toBe("c");
      expect(
        (confirmDialog().querySelector("[data-confirm-accept]") as HTMLButtonElement).disabled,
      ).toBe(false);
      answerConfirmation(true);
      await vi.waitFor(() => expect(commands).toHaveLength(2));
    }
    await vi.waitFor(() => expect(localStorage.getItem("openiptv.remote")).toBeNull());
    expect(document.querySelector(".manage")).toBeNull();
    expect(document.querySelector('[name="deviceName"]')).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();
  },
);

async function pairNewRemoteSession() {
  await vi.waitFor(() => expect(document.querySelector('[name="deviceName"]')).toBeTruthy());
  const name = document.querySelector('[name="deviceName"]') as HTMLInputElement;
  name.value = "New phone";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  name.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}").credential).toBe(
      "new-key",
    ),
  );
  await vi.waitFor(() => expect(document.querySelector(".manage")).toBeTruthy());
}

test.each([200, 401])(
  "a genuine new pairing fences old reply %s and unsent lineup work",
  async (oldStatus) => {
    const rowReply = deferredReply();
    const lineupReply = deferredReply();
    const playlists = [
      { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
      { id: "pl-2", name: "Other", source: { kind: "m3u", url: "http://b" }, sourceVersion: 1 },
      { id: "pl-3", name: "Third", source: { kind: "m3u", url: "http://c" }, sourceVersion: 1 },
    ];
    const oldRowResult = { ok: true, snapshot: lineupSnapshot({ revision: 1, playlists }) };
    let paired = false;
    const commands: Array<{ revision: number; command: Record<string, unknown> }> = [];
    const mutations: CapturedLineupMutation[] = [];
    const authorizations: Array<{ path: string; authorization: string | undefined }> = [];
    const app = await startSavedRemote(
      vi.fn((path: string, options?: RequestInit) => {
        authorizations.push({
          path,
          authorization: (options?.headers as Record<string, string> | undefined)
            ?.Authorization,
        });
        if (path === "/api/v1/status") return reply(200, publicState);
        if (path === "/api/v1/pair") {
          paired = true;
          return reply(200, { ok: true, deviceId: "device-new", credential: "new-key" });
        }
        if (path === "/api/v1/state")
          return reply(200, lineupSnapshot({ playlists, revision: paired ? 10 : 0 }));
        if (path === "/api/v1/command") {
          commands.push(JSON.parse(String(options?.body)));
          if (commands.length === 1) return rowReply.promise;
          const updated = lineupSnapshot({ playlists, revision: 11 });
          updated.settings.showClock = false;
          return reply(200, { ok: true, snapshot: updated });
        }
        if (path === "/api/v1/lineup/mutation") {
          mutations.push(JSON.parse(String(options?.body)));
          return lineupReply.promise;
        }
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          if (body.playlistId === "pl-2") {
            if (!paired) return reply(401, {});
            if (body.revision === 0)
              return reply(409, { ok: false, reason: "conflict", revision: 8 });
            return reply(200, lineupPage([lineupCategory("New B")], null, 1, 8));
          }
          return reply(200, lineupPage([lineupCategory()]));
        }
        return reply(404, {});
      }),
    );
    playlistRowAction("pl-3", "refresh");
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    openPlaylistContent();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-lineup-visibility]")).toBeTruthy(),
    );
    toggleRemoteRowVisibility("News");
    await vi.waitFor(() => expect(mutations).toHaveLength(1));
    toggleRemoteRowVisibility("News");
    crumb("Playlists")!.click();
    await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
    openPlaylistContent("pl-2");
    await pairNewRemoteSession();
    (document.querySelector('.manage-rail a[href="#playlists"]') as HTMLAnchorElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector('[data-page="content-settings"]')).toBeTruthy(),
    );
    (
      document.querySelector(
        '[data-page="content-settings"] a[href="#playlists/list"]',
      ) as HTMLAnchorElement
    ).click();
    await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
    openPlaylistContent("pl-2");
    await vi.waitFor(() =>
      expect(document.querySelector('[data-lineup-edit][data-id="New B"]')).toBeTruthy(),
    );
    await openRemoteRename("New B");
    const draft = document.querySelector('[name="editorValue"]') as HTMLInputElement;
    draft.value = "New session draft";
    draft.dispatchEvent(new Event("input", { bubbles: true }));
    draft.focus();
    draft.setSelectionRange(2, 6);
    rowReply.complete(oldStatus, oldStatus === 200 ? oldRowResult : {});
    lineupReply.complete(200, { ok: true, revision: 4, affectedIds: ["News"] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const currentDraft = document.querySelector('[name="editorValue"]') as HTMLInputElement;
    expect(currentDraft.value).toBe("New session draft");
    expect(document.activeElement).toBe(currentDraft);
    expect([currentDraft.selectionStart, currentDraft.selectionEnd]).toEqual([2, 6]);
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}").credential).toBe(
      "new-key",
    );
    expect(
      authorizations.some(
        (entry) =>
          entry.path === "/api/v1/state" && entry.authorization === "Bearer device-new:new-key",
      ),
    ).toBe(true);
    await app.sendCommandForTest(
      { type: "setting", key: "showClock", value: false },
      false,
      null,
    );
    expect(commands).toHaveLength(2);
    expect(commands[1].revision).toBe(10);
    expect((document.querySelector('[name="editorValue"]') as HTMLInputElement).value).toBe(
      "New session draft",
    );
  },
);

test.each(["session", "source"])(
  "an accepted removal revalidates its %s after waiting for the row lane",
  async (fence) => {
    const rowReply = deferredReply();
    const oldQuery = deferredReply();
    let paired = false;
    let replaced = false;
    const playlists = () => [
      { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
      {
        id: "pl-2",
        name: "Other",
        source: { kind: "m3u", url: replaced ? "http://new-b" : "http://b" },
        sourceVersion: replaced ? 2 : 1,
      },
    ];
    const oldResult = {
      ok: true,
      snapshot: lineupSnapshot({ revision: 1, playlists: playlists() }),
    };
    const commands: Array<{ command: Record<string, unknown> }> = [];
    const queries: Array<Record<string, unknown>> = [];
    await startSavedRemote(
      vi.fn((path: string, options?: RequestInit) => {
        if (path === "/api/v1/status") return reply(200, publicState);
        if (path === "/api/v1/pair") {
          paired = true;
          return reply(200, { ok: true, deviceId: "device-new", credential: "new-key" });
        }
        if (path === "/api/v1/state")
          return reply(
            200,
            lineupSnapshot({ playlists: playlists(), revision: paired ? 10 : 0 }),
          );
        if (path === "/api/v1/command") {
          commands.push(JSON.parse(String(options?.body)));
          return commands.length === 1 ? rowReply.promise : reply(500, { ok: false });
        }
        if (path === "/api/v1/lineup/query") {
          const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
          queries.push(body);
          if (body.playlistId === "pl-1") return oldQuery.promise;
          if (body.revision === 0)
            return reply(409, { ok: false, reason: "conflict", revision: 8 });
          return reply(200, lineupPage([lineupCategory("Replacement B")], null, 1, 8));
        }
        return reply(404, {});
      }),
    );
    if (fence === "session") {
      openPlaylistContent();
      await vi.waitFor(() => expect(queries).toHaveLength(1));
      crumb("Playlists")!.click();
      await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
    }
    playlistRowAction("pl-1", "refresh");
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    removePlaylistFromIndex("pl-2");
    await vi.waitFor(() =>
      expect(document.querySelector("[data-management-confirmation]")).toBeTruthy(),
    );
    answerConfirmation(true);
    await vi.waitFor(() =>
      expect(
        confirmDialog().querySelector("[data-confirm-accept]")?.getAttribute("aria-busy"),
      ).toBe("true"),
    );
    expect(commands).toHaveLength(1);
    if (fence === "session") {
      oldQuery.complete(401, {});
      await pairNewRemoteSession();
      rowReply.complete(200, oldResult);
      await new Promise((resolve) => setTimeout(resolve, 0));
      (
        document.querySelector(
          '[data-page="content-settings"] a[href="#playlists/list"]',
        ) as HTMLAnchorElement
      ).click();
      await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
      expect(
        document.querySelector('[data-item-open="playlist"][data-id="pl-2"]'),
      ).toBeTruthy();
      expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}").credential).toBe(
        "new-key",
      );
    } else {
      replaced = true;
      rowReply.complete(200, {
        ok: true,
        snapshot: lineupSnapshot({ revision: 1, playlists: playlists() }),
      });
      await vi.waitFor(() =>
        expect(document.querySelector("[data-management-confirmation]")).toBeNull(),
      );
      openPlaylistContent("pl-2");
      await vi.waitFor(() =>
        expect(queries.some((body) => body.playlistId === "pl-2" && body.revision === 8)).toBe(
          true,
        ),
      );
      expect(
        queries
          .filter((body) => body.playlistId === "pl-2")
          .every((body) => body.sourceVersion === 2),
      ).toBe(true);
      expect(JSON.parse(localStorage.getItem("openiptv.remote") ?? "{}").credential).toBe("c");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(commands.map((body) => body.command)).toEqual([
      { type: "playlist.refresh", id: "pl-1" },
    ]);
  },
);

test("content descriptions name sections in the main menu and search results", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => reply(200, xtreamLineupSnapshot())),
  );
  window.history.replaceState({}, "", "/");
  await loadApp().start();
  for (const [key, content] of [
    ["showLive", "Live"],
    ["showMovies", "Movies"],
    ["showSeries", "Series"],
  ]) {
    const control = document.querySelector<HTMLInputElement>(`[data-setting="${key}"]`)!;
    expect(
      control.closest(".content-setting")?.querySelector(".setting-hint")?.textContent,
    ).toBe(`Include ${content} in the main menu and search results.`);
  }
});

test("notifications carry each kind's role, lifetime and icon", async () => {
  vi.useFakeTimers();
  try {
    const app = await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        return reply(404, {});
      }),
    );
    const cases: Array<[string, number, string]> = [
      ["neutral", 4000, "status"],
      ["success", 3200, "status"],
      ["error", 5200, "alert"],
      ["information", 4000, "status"],
      ["warning", 5200, "status"],
    ];
    for (const [kind, lifetime, role] of cases) {
      app.showNotificationForTest(`kind-${kind}`, kind);
      const toast = document.querySelector("[data-operation-status]");
      expect(toast?.getAttribute("data-toast-kind")).toBe(kind);
      expect(toast?.classList.contains("toast")).toBe(true);
      expect(toast?.classList.contains(kind)).toBe(true);
      expect(toast?.parentElement?.getAttribute("role")).toBe(role);
      expect(toast?.querySelector(".toast-icon")).toBeTruthy();
      expect(toast?.textContent).toContain(`kind-${kind}`);
      // An identical repeat dedups onto the same node without restarting expiry.
      app.showNotificationForTest(`kind-${kind}`, kind);
      expect(document.querySelector("[data-operation-status]")).toBe(toast);
      vi.advanceTimersByTime(lifetime - 1);
      expect(document.querySelector("[data-operation-status]")).toBe(toast);
      vi.advanceTimersByTime(1);
      expect(document.querySelector("[data-operation-status]")).toBeNull();
    }
    vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
  }
});

test("a notice cannot dedup against a stale view owner", async () => {
  vi.useFakeTimers();
  try {
    const app = await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        return reply(404, {});
      }),
    );
    app.showNotificationForTest("same words", "success");
    const first = document.querySelector("[data-operation-status]");
    expect(first?.textContent).toContain("same words");
    window.history.replaceState({}, "", "/#appearance");
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() =>
      expect(document.querySelector("[data-operation-status]")).toBeNull(),
    );
    app.showNotificationForTest("same words", "success");
    const second = document.querySelector("[data-operation-status]");
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(second?.textContent).toContain("same words");
    vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
  }
});

test("busy progress stays in a persistent passive notification outside the manage region", async () => {
  vi.useFakeTimers();
  try {
    const command = deferredReply();
    const app = await startSavedRemote(
      vi.fn((path: string) => {
        if (path === "/api/v1/state") return reply(200, lineupSnapshot());
        if (path === "/api/v1/command") return command.promise;
        return reply(404, {});
      }),
    );
    const sent = app.sendCommandForTest(
      { type: "setting", key: "showClock", value: false },
      false,
      null,
    );
    const progress = document.querySelector("[data-operation-status]");
    expect(progress).toBeTruthy();
    expect(progress?.parentElement?.getAttribute("role")).toBe("status");
    expect(progress?.textContent).toContain(labels.saving);
    expect(progress?.querySelector(".form-spinner")).toBeTruthy();
    expect(progress?.closest("#app")).toBeNull();
    expect(progress?.getAttribute("data-toast-kind")).toBe("loading");
    const header = document.querySelector(".manage-top");
    vi.advanceTimersByTime(60000);
    expect(document.querySelector("[data-operation-status]")).toBe(progress);
    expect(document.querySelector(".manage-top")).toBe(header);
    command.complete(200, { ok: true });
    await sent;
    expect(
      document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
    ).toBeNull();
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe(labels.saved);
    vi.runOnlyPendingTimers();
  } finally {
    vi.useRealTimers();
  }
});

test("a movie title row answers Open with a neutral No action notice", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const counts = { live: 1, movie: 1, series: 0 };
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, xtreamLineupSnapshot());
    if (path === "/api/v1/lineup/query") {
      const body = JSON.parse(String(options?.body));
      if (body.scope === "categories") {
        const kind = body.contentKind || "live";
        const name = kind === "movie" ? "Cinema" : "News";
        return reply(200, lineupPage([lineupCategory(name, kind)], null, 1, 3, counts));
      }
      if (body.scope === "items") {
        return reply(
          200,
          lineupPage(
            [{ kind: "item", id: "title-1", name: "Title", contentKind: "movie" }],
            null,
            1,
            3,
            counts,
          ),
        );
      }
      return reply(200, lineupPage([lineupChannel(1)], null, 1, 3, counts));
    }
    return reply(200, { ok: true, revision: 4, affectedIds: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/#playlists/list");
  await loadApp().start();
  openPlaylistContent();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row-category strong")?.textContent).toBe("News"),
  );
  (document.querySelector('[data-lineup-kind="movie"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Cinema"),
  );
  firstLineupRowOpen();
  await vi.waitFor(() =>
    expect(document.querySelector(".lineup-row strong")?.textContent).toBe("Title"),
  );

  const open = document.querySelector<HTMLElement>(
    'button[data-item-open="lineup"][data-id="title-1"]',
  );
  expect(open).toBeTruthy();
  open!.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-operation-status]")?.textContent).toBe("No action"),
  );
  const notice = document.querySelector("[data-operation-status]");
  expect(notice?.parentElement?.getAttribute("role")).toBe("status");
  expect(document.querySelector(".lineup-editor-dialog")).toBeNull();
  expect(document.querySelector("[data-item-action-dialog]")).toBeNull();
});

test("a playlist add disables only its own overlay and leaves Cancel usable", async () => {
  const command = deferredReply();
  let revision = 0;
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ revision, playlists }));
    }
    if (path === "/api/v1/command") return command.promise;
    return reply(404, {});
  });
  await startSavedRemote(fetchMock);

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  const field = (name: string) =>
    document.querySelector(`[name="${name}"]`) as HTMLInputElement;
  field("newName").value = "Second";
  field("newUrl").value = "http://example.com/second.m3u";
  const addForm = document.querySelector("[data-add-playlist-form]") as HTMLFormElement;
  addForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(
      document.querySelector("[data-operation-status][data-toast-kind='loading']")?.textContent,
    ).toContain(labels.saving),
  );

  const overlay = document.querySelector('[data-form-overlay="playlist-add"]') as HTMLElement;
  expect(overlay).toBeTruthy();
  expect(field("newName").disabled).toBe(true);
  expect(field("newUrl").disabled).toBe(true);
  const cancel = document.querySelector(
    '[data-action="cancel-add-playlist"]',
  ) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  const outside = document.querySelector(
    'button[data-item-open="playlist"][data-id="pl-1"]',
  ) as HTMLButtonElement;
  expect(outside.disabled).toBe(false);

  revision = 1;
  playlists.push({
    id: "pl-2",
    name: "Second",
    source: { kind: "m3u", url: "http://example.com/second.m3u" },
    sourceVersion: 1,
  });
  command.complete(200, { ok: true, snapshot: snapshot({ revision, playlists }) });
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(2));
  expect(document.querySelector("[data-add-playlist-form]")).toBeNull();
});

test("a cancelled playlist form silences the late command response", async () => {
  const command = deferredReply();
  let revision = 0;
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ revision, playlists }));
    }
    if (path === "/api/v1/command") return command.promise;
    return reply(404, {});
  });
  await startSavedRemote(fetchMock);

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  const field = (name: string) =>
    document.querySelector(`[name="${name}"]`) as HTMLInputElement;
  field("newName").value = "Second";
  field("newUrl").value = "http://example.com/second.m3u";
  const addForm = document.querySelector("[data-add-playlist-form]") as HTMLFormElement;
  addForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
    ).toBeTruthy(),
  );

  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector(".playlist-card")).toBeTruthy());
  expect(document.querySelector("[data-add-playlist-form]")).toBeNull();

  revision = 1;
  playlists.push({
    id: "pl-2",
    name: "Second",
    source: { kind: "m3u", url: "http://example.com/second.m3u" },
    sourceVersion: 1,
  });
  command.complete(200, { ok: true, snapshot: snapshot({ revision, playlists }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(1));
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(document.querySelector("[data-add-playlist-form]")).toBeNull();

  (window as unknown as { OpenIPTVRemote: RemoteApp }).OpenIPTVRemote.renderManageForTest();
  await vi.waitFor(() => expect(document.querySelectorAll(".playlist-card")).toHaveLength(2));
});

test("a language change during first setup sends its setting command and frees busy", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ playlists: [], activePlaylistId: "" });
  const translated = snapshot({
    revision: 1,
    locale: "fa",
    direction: "rtl",
    settings: { ...empty.settings, locale: "fa" },
    playlists: [],
    activePlaylistId: "",
  });
  const setting = deferredReply();
  const fetchMock = vi.fn((path: string, options?: RequestInit) => {
    if (path === "/api/v1/state") return reply(200, empty);
    if (path === "/api/v1/command") {
      const command = JSON.parse(String(options?.body)).command;
      if (command.type === "setting") return setting.promise;
      return reply(200, { ok: true, snapshot: empty });
    }
    return reply(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const locale = document.querySelector('[name="locale"]') as HTMLSelectElement;
  locale.value = "fa";
  locale.dispatchEvent(new Event("change", { bubbles: true }));

  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some((call) => {
        if (call[0] !== "/api/v1/command") return false;
        const command = JSON.parse(String(call[1]?.body)).command;
        return command.type === "setting" && command.key === "locale" && command.value === "fa";
      }),
    ).toBe(true),
  );
  await vi.waitFor(() =>
    expect(document.querySelector("#app")?.getAttribute("aria-busy")).toBe("true"),
  );

  setting.complete(200, { ok: true, snapshot: translated });
  await vi.waitFor(() =>
    expect(document.querySelector("#app")?.hasAttribute("aria-busy")).toBe(false),
  );
  const after = document.querySelector('[name="locale"]') as HTMLSelectElement;
  expect(after.disabled).toBe(false);
  expect(
    document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
  ).toBeNull();
});

test("a drained command cannot close or overwrite a newer playlist form", async () => {
  const command = deferredReply();
  let revision = 0;
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ revision, playlists }));
    }
    if (path === "/api/v1/command") return command.promise;
    return reply(404, {});
  });
  const app = await startSavedRemote(fetchMock);

  const field = (name: string) =>
    document.querySelector(`[name="${name}"]`) as HTMLInputElement;
  const openAdd = () =>
    (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();

  openAdd();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  field("newName").value = "First";
  field("newUrl").value = "http://example.com/first.m3u";
  (document.querySelector("[data-add-playlist-form]") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
    ).toBeTruthy(),
  );

  (document.querySelector('[data-action="cancel-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector("[data-add-playlist-form]")).toBeNull());
  openAdd();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  field("newName").value = "Second";
  field("newUrl").value = "http://example.com/second.m3u";
  const nameField = field("newName");
  nameField.focus();
  const saveB = document.querySelector('[data-action="add-playlist"]') as HTMLButtonElement;
  expect(saveB.disabled).toBe(true);
  expect(nameField.disabled).toBe(false);

  revision = 1;
  playlists.push({
    id: "pl-2",
    name: "First",
    source: { kind: "m3u", url: "http://example.com/first.m3u" },
    sourceVersion: 1,
  });
  command.complete(200, { ok: true, snapshot: snapshot({ revision, playlists }) });
  await vi.waitFor(() => expect(saveB.disabled).toBe(false));

  expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy();
  expect(field("newName").value).toBe("Second");
  expect(field("newUrl").value).toBe("http://example.com/second.m3u");
  expect(document.activeElement).toBe(nameField);
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(
    document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
  ).toBeNull();

  app.renderManageForTest();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  expect(field("newName").value).toBe("Second");
  expect(field("newUrl").value).toBe("http://example.com/second.m3u");
  expect(
    (document.querySelector('[data-action="add-playlist"]') as HTMLButtonElement).disabled,
  ).toBe(false);
});

test("a retained busy rerender keeps Cancel usable and a cancelled reply resets the same form", async () => {
  const command = deferredReply();
  const revision = 0;
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ revision, playlists }));
    }
    if (path === "/api/v1/command") return command.promise;
    return reply(404, {});
  });
  const app = await startSavedRemote(fetchMock);

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy(),
  );
  const field = (name: string) =>
    document.querySelector(`[name="${name}"]`) as HTMLInputElement;
  field("newName").value = "Second";
  field("newUrl").value = "http://example.com/second.m3u";
  (document.querySelector("[data-add-playlist-form]") as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
    ).toBeTruthy(),
  );
  expect(
    (document.querySelector('[data-action="add-playlist"]') as HTMLButtonElement).disabled,
  ).toBe(true);

  app.renderManageForTest("", false, true);
  const cancel = document.querySelector(
    '[data-action="cancel-add-playlist"]',
  ) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  const backdrop = document.querySelector("[data-playlist-add-dismiss]") as HTMLButtonElement;
  expect(backdrop.disabled).toBe(false);
  const save = document.querySelector('[data-action="add-playlist"]') as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(field("newName").disabled).toBe(true);

  command.complete(200, { ok: true, cancelled: true });
  await vi.waitFor(() => expect(save.disabled).toBe(false));
  expect(document.querySelector("[data-add-playlist-form]")).toBeTruthy();
  expect(field("newName").disabled).toBe(false);
  expect(field("newName").value).toBe("Second");
  expect(save.querySelector(".form-spinner")).toBeNull();
  expect(document.querySelector("[data-operation-status]")).toBeNull();
  expect(
    document.querySelector('[data-operation-status][data-toast-kind="loading"]'),
  ).toBeNull();
});

test("the active playlist menu skips its disabled Activate for focus, arrows and Tab", async () => {
  const playlists = [
    { id: "pl-1", name: "News", source: { kind: "m3u", url: "http://a" }, sourceVersion: 1 },
  ];
  const fetchMock = vi.fn((path: string) => {
    if (path === "/api/v1/state") {
      return reply(200, snapshot({ revision: 0, playlists }));
    }
    return reply(404, {});
  });
  await startSavedRemote(fetchMock);

  openItemMenu("playlist", "pl-1");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-item-action-dialog]")).toBeTruthy(),
  );
  const action = () => (document.activeElement as HTMLElement | null)?.dataset?.itemAction;
  const activate = document.querySelector('[data-item-action="activate"]') as HTMLButtonElement;
  expect(activate.disabled).toBe(true);
  expect(activate.getAttribute("aria-disabled")).toBe("true");
  expect(action()).toBe("refresh");

  const pressKey = (key: string) =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  pressKey("ArrowUp");
  expect(action()).toBe("remove");
  pressKey("ArrowDown");
  expect(action()).toBe("refresh");

  const close = document.querySelector("[data-item-menu-close]") as HTMLButtonElement;
  close.focus();
  close.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
  );
  expect(action()).toBe("refresh");
});
