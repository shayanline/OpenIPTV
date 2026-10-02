import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

interface RemoteApp {
  start(): Promise<void>;
  parsePairSecret(): string;
}

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
  hls: "HLS, recommended",
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
  appearance: "Appearance",
  playback: "Playback",
  devices: "Paired devices",
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
  changeFailed: "The change could not be saved.",
  pairingFailed: "The pairing code is invalid or has expired.",
  revokeSelfConfirm:
    "This is the device you are using. Revoking access will disconnect it, and you will need to pair it again.",
  invalidUrl: "That is not a complete web address.",
  cache: "Clear downloaded cache",
  cacheConfirm: "Clear downloaded cache?",
  removeConfirm: "Remove this playlist?",
  conflict: "Settings changed on another device. Review and try again.",
  unavailable: "The TV is unavailable. Keep OpenIPTV open and try again.",
  revoked: "This device no longer has access.",
};

const publicState = { locale: "en", direction: "ltr", labels };

const snapshot = (change: Record<string, unknown> = {}) => ({
  revision: 0,
  locale: "en",
  direction: "ltr",
  labels,
  localeOptions: [
    { id: "en", label: "English" },
    { id: "fa", label: "فارسی Persian" },
  ],
  settings: {
    locale: "en",
    fontSizeId: "m",
    showNumbers: true,
    showLogos: true,
    aspectId: "fill",
    showClock: true,
    resumeLast: true,
    sortAlphabetically: false,
    compatibility: false,
    showPlaybackStats: false,
  },
  playlists: [{ id: "pl-1", name: "News", url: "http://example.com/list.m3u" }],
  activePlaylistId: "pl-1",
  setup: { name: "", url: "" },
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

function choosePlaylistAction(action: string) {
  (
    document.querySelector(
      '[data-action="open-item-menu"][data-kind="playlist"]',
    ) as HTMLButtonElement
  ).click();
  (document.querySelector(`[data-menu-action="${action}"]`) as HTMLButtonElement).click();
}

function loadApp(): RemoteApp {
  document.body.innerHTML = '<main id="app"></main>';
  (window as unknown as { __OPENIPTV_TEST__: boolean }).__OPENIPTV_TEST__ = true;
  const source = readFileSync(join(process.cwd(), "public/remote/remote.js"), "utf8");
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

afterEach(() => vi.restoreAllMocks());

test("loads device assets relative to either the TV root or build preview path", () => {
  const html = readFileSync(join(process.cwd(), "public/remote/index.html"), "utf8");
  const css = readFileSync(join(process.cwd(), "public/remote/remote.css"), "utf8");

  expect(html).toContain('href="remote.css"');
  expect(html).toContain('src="remote.js"');
  expect(html).toContain('src="/icon.svg"');
  expect(html).not.toContain('<main id="app" aria-live');
  expect(css).toContain("@media (max-width: 680px)");
  expect(css).toContain("@media (max-width: 380px)");
  expect(css).toContain("env(safe-area-inset-bottom)");
  expect(css).toContain("scroll-snap-type: x proximity");
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
    expect(document.querySelector("[data-section=playlists]")).toBeTruthy(),
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
  await app.start();

  (document.querySelector('[name="deviceName"]') as HTMLInputElement).value = "Kitchen device";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.querySelector("[data-section=playlists]")).toBeTruthy(),
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

  await loadApp().start();

  const order = [
    labels.appearance,
    labels.playback,
    labels.playlists,
    labels.devices,
    labels.about,
  ];
  const tabs = [...document.querySelectorAll<HTMLAnchorElement>(".tabs a")];
  expect(tabs.map((link) => link.textContent)).toEqual(order);
  expect(tabs[0].getAttribute("aria-current")).toBe("page");
  tabs[3].click();
  expect(tabs[0].hasAttribute("aria-current")).toBe(false);
  expect(tabs[3].getAttribute("aria-current")).toBe("page");
  expect(
    [...document.querySelectorAll("[data-section] h2")].map((heading) => heading.textContent),
  ).toEqual(order);
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
              url: "http://example.com/get.php?username=one&password=secret&type=m3u_plus&output=m3u8",
              active: true,
            },
            { id: "two", name: "Two", url: "http://example.com/two.m3u", active: false },
          ],
        }),
      ),
    ),
  );

  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  expect(document.querySelector('[name="newName"]')?.getAttribute("aria-label")).toBe(
    labels.playlistName,
  );
  expect(document.querySelector('[name="newUrl"]')?.getAttribute("aria-label")).toBe(
    labels.playlistAddress,
  );
  expect(document.querySelector('[name="newUrl"]')?.getAttribute("dir")).toBe("ltr");
  expect(document.querySelector("#playlists")?.textContent).toContain("http://example.com");
  expect(document.querySelector("#playlists")?.textContent).not.toContain("get.php");
  expect(document.querySelector("#playlists")?.textContent).not.toContain("secret");
  const menus = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-action="open-item-menu"]'),
  ];
  expect(menus[0].getAttribute("aria-label")).toContain("One");
  menus[1].click();
  expect(document.querySelector("[data-item-menu]")?.parentElement).toBe(document.body);
  expect(document.querySelector('[data-menu-action="activate"]')?.textContent).toBe(
    labels.activate,
  );
});

test("uses remembered authentication and applies the TV language direction", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const persian = snapshot({ locale: "fa", direction: "rtl" });
  const fetchMock = vi.fn(() => reply(200, persian));
  vi.stubGlobal("fetch", fetchMock);

  await loadApp().start();

  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer p:c");
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelector("[data-section=appearance]")).toBeTruthy();
});

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
    expect(commands[0].url).toBe(
      "https://provider.example:8443/get.php?username=viewer&password=secret&type=m3u_plus&output=m3u8",
    );
  });
});

test("mirrors setup typing and language through a quiet preview command", async () => {
  vi.useFakeTimers();
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const preview = snapshot({
    playlists: [],
    activePlaylistId: "",
    setup: { name: "Device playlist", url: "http://example.com/device.m3u" },
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
    url: "http://example.com/device.m3u",
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
    expect(document.querySelector('[data-setup-result="error"] h1')?.textContent).toBe(
      labels.setupFailedTitle,
    ),
  );
  expect(document.querySelector(".setup-result-description")?.textContent).toBe(
    labels.invalidUrl,
  );
  expect(document.querySelector('[data-setup-result="error"]')).toBeTruthy();
  expect(document.querySelector('[name="playlistUrl"]')).toBeNull();

  (document.querySelector("[data-action=retry-setup]") as HTMLButtonElement).click();
  const currentName = document.querySelector('[name="playlistName"]') as HTMLInputElement;
  const currentUrl = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  expect(currentName.value).toBe("My list");
  expect(currentUrl.value).toBe("http://example.com/list.m3u");
  expect(currentUrl.disabled).toBe(false);
});

test("shows a dedicated error page after a setup conflict", async () => {
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
    expect(document.querySelector('[data-setup-result="error"] h1')?.textContent).toBe(
      labels.setupFailedTitle,
    ),
  );
  expect(document.querySelector(".setup-result-description")?.textContent).toBe(
    labels.conflict,
  );

  expect(document.querySelector('[data-setup-result="error"]')).toBeTruthy();
  expect(document.querySelector('[name="playlistUrl"]')).toBeNull();
  expect(document.querySelector(".tabs")).toBeNull();
  (document.querySelector("[data-action=retry-setup]") as HTMLButtonElement).click();
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
  await loadApp().start();

  (document.querySelector('[name="playlistName"]') as HTMLInputElement).value = "NASA demo";
  (document.querySelector('[name="playlistUrl"]') as HTMLInputElement).value =
    "https://example.com/demo.m3u";
  document
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
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
  expect(document.querySelector(".tabs")).toBeNull();
  expect(document.querySelector("main")?.hasAttribute("aria-busy")).toBe(false);

  (document.querySelector("[data-action=open-settings]") as HTMLButtonElement).click();
  expect(document.querySelector(".tabs")).toBeTruthy();
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
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  expect(document.querySelector('[data-source="m3u"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  (document.querySelector('[data-source="xtream"]') as HTMLButtonElement).click();
  (document.querySelector('[name="newServer"]') as HTMLInputElement).value =
    "http://provider.example:8080";
  (document.querySelector('[name="newUsername"]') as HTMLInputElement).value = "viewer";
  (document.querySelector('[name="newPassword"]') as HTMLInputElement).value = "secret";
  (document.querySelector('[name="newOutput"]') as HTMLSelectElement).value = "ts";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();

  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command).toEqual({
    type: "playlist.add",
    name: "",
    url: "http://provider.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=ts",
  });
});

test("remote editing restores the Xtream credential form", async () => {
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
              name: "Provider",
              url: "https://provider.example:8443/portal/get.php?username=viewer&password=secret&type=m3u_plus&output=ts",
            },
          ],
        }),
      ),
    ),
  );
  await loadApp().start();

  choosePlaylistAction("edit");

  expect(document.querySelector('[data-source="xtream"]')?.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect((document.querySelector('[name="editServer"]') as HTMLInputElement).value).toBe(
    "https://provider.example:8443/portal",
  );
  expect((document.querySelector('[name="editUsername"]') as HTMLInputElement).value).toBe(
    "viewer",
  );
  expect((document.querySelector('[name="editPassword"]') as HTMLInputElement).value).toBe(
    "secret",
  );
  expect((document.querySelector('[name="editOutput"]') as HTMLSelectElement).value).toBe("ts");
  expect(document.querySelector('[name="editUrl"]')).toBeNull();
});

test("adds playlists and confirms removal before sending commands", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementation(() => reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector('[data-action="open-add-playlist"]') as HTMLButtonElement).click();
  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "Sport";
  (document.querySelector('[name="newUrl"]') as HTMLInputElement).value =
    "http://example.com/sport.m3u";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved),
  );
  choosePlaylistAction("remove");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

  expect(window.confirm).toHaveBeenCalledWith(`News\n\n${labels.removeConfirm}`);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command.type).toBe("playlist.remove");
});

test("returns immediately to setup after removing the final playlist", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const empty = snapshot({ revision: 1, playlists: [], activePlaylistId: "" });
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: empty }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  choosePlaylistAction("remove");

  await vi.waitFor(() => expect(document.querySelector('[name="playlistUrl"]')).toBeTruthy());
  expect(document.querySelector("[data-section=playlists]")).toBeNull();
  expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved);
});

test("edits and refreshes an existing playlist", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 2 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  choosePlaylistAction("edit");
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
    expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved),
  );
  choosePlaylistAction("refresh");
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

  const update = JSON.parse(fetchMock.mock.calls[1][1].body).command;
  expect(update).toEqual({
    type: "playlist.update",
    id: "pl-1",
    name: "Renamed news",
    url: "http://example.com/renamed.m3u",
  });
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command.type).toBe("playlist.refresh");
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
  await loadApp().start();

  choosePlaylistAction("refresh");
  await vi.waitFor(() =>
    expect(document.querySelector("[role=alert]")?.textContent).toBe(
      "The playlist could not be loaded.",
    ),
  );
});

test("restores focus after a setting is saved", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const toggle = document.querySelector('[data-setting="showClock"]') as HTMLInputElement;
  toggle.click();
  await vi.waitFor(() =>
    expect(document.querySelector("[role=status]")?.textContent).toBe(labels.saved),
  );
  expect(document.querySelector('[data-setting="showClock"]')).toBe(toggle);
  expect((document.activeElement as HTMLElement | null)?.dataset.setting).toBe("showClock");
});

test("refreshes state after a revision conflict", async () => {
  localStorage.setItem("openiptv.remote", JSON.stringify({ deviceId: "p", credential: "c" }));
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
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() =>
      reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }),
    );
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector("[data-action=clear-cache]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  expect(window.confirm).toHaveBeenCalledWith(labels.cacheConfirm);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command.type).toBe("cache.clear");
});
