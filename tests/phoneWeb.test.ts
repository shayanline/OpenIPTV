import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

interface PhoneApp {
  start(): Promise<void>;
  parsePairSecret(): string;
}

const labels = {
  title: "OpenIPTV",
  pairTitle: "Connect to your TV",
  pairBody: "Keep OpenIPTV open on your television.",
  phoneName: "Phone name",
  code: "Pairing code",
  pair: "Connect",
  setupTitle: "Add your first playlist",
  playlistName: "Playlist name",
  playlistAddress: "Playlist address",
  language: "Language",
  finish: "Finish setup",
  playlists: "Playlists",
  appearance: "Appearance",
  playback: "Playback",
  general: "General",
  phones: "Paired phones",
  addPlaylist: "Add playlist",
  remove: "Remove",
  active: "Active",
  cache: "Clear downloaded cache",
  cacheConfirm: "Clear downloaded cache?",
  removeConfirm: "Remove this playlist?",
  conflict: "Settings changed on another phone. Review and try again.",
  unavailable: "The TV is unavailable. Keep OpenIPTV open and try again.",
  revoked: "This phone no longer has access.",
};

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
  },
  playlists: [{ id: "pl-1", name: "News", url: "http://example.com/list.m3u" }],
  activePlaylistId: "pl-1",
  phones: [{ id: "phone-1", name: "My phone", createdAt: 1, lastUsedAt: 1 }],
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

function loadApp(): PhoneApp {
  document.body.innerHTML = '<main id="app"></main>';
  (window as unknown as { __OPENIPTV_TEST__: boolean }).__OPENIPTV_TEST__ = true;
  const source = readFileSync(join(process.cwd(), "public/phone/phone.js"), "utf8");
  new Function("window", "document", "localStorage", "fetch", "confirm", source)(
    window,
    document,
    localStorage,
    fetch,
    window.confirm,
  );
  return (window as unknown as { OpenIPTVPhone: PhoneApp }).OpenIPTVPhone;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

test("loads phone assets relative to either the TV root or build preview path", () => {
  const html = readFileSync(join(process.cwd(), "public/phone/index.html"), "utf8");

  expect(html).toContain('href="phone.css"');
  expect(html).toContain('src="phone.js"');
});

test("reads the pairing secret from the QR fragment", () => {
  window.history.replaceState({}, "", "/#pair=a_secret-123");
  const app = loadApp();

  expect(app.parsePairSecret()).toBe("a_secret-123");
});

test("pairs with a manual code and remembers the credential", async () => {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, { ok: true, phoneId: "phone-1", credential: "key-1" }))
    .mockImplementationOnce(() => reply(200, snapshot()));
  vi.stubGlobal("fetch", fetchMock);
  const app = loadApp();
  await app.start();

  (document.querySelector('[name="phoneName"]') as HTMLInputElement).value = "Kitchen phone";
  (document.querySelector('[name="code"]') as HTMLInputElement).value = "123456";
  document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[data-section=playlists]")).toBeTruthy());

  expect(JSON.parse(localStorage.getItem("openiptv.phone") ?? "{}")).toEqual({
    phoneId: "phone-1",
    credential: "key-1",
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    code: "123456",
    name: "Kitchen phone",
  });
});

test("uses remembered authentication and applies the TV language direction", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const persian = snapshot({ locale: "fa", direction: "rtl" });
  const fetchMock = vi.fn(() => reply(200, persian));
  vi.stubGlobal("fetch", fetchMock);

  await loadApp().start();

  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer p:c");
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.querySelector("[data-section=appearance]")).toBeTruthy();
});

test("keeps first playlist values when TV validation fails", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot({ playlists: [], activePlaylistId: "" })))
    .mockImplementationOnce(() => reply(400, { ok: false, reason: "failed", snapshot: snapshot({ playlists: [] }) }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  const name = document.querySelector('[name="playlistName"]') as HTMLInputElement;
  const url = document.querySelector('[name="playlistUrl"]') as HTMLInputElement;
  name.value = "My list";
  url.value = "http://example.com/list.m3u";
  document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("[role=alert]")).toBeTruthy());

  expect(name.value).toBe("My list");
  expect(url.value).toBe("http://example.com/list.m3u");
});

test("adds playlists and confirms removal before sending commands", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementation(() => reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector('[name="newName"]') as HTMLInputElement).value = "Sport";
  (document.querySelector('[name="newUrl"]') as HTMLInputElement).value = "http://example.com/sport.m3u";
  (document.querySelector("[data-action=add-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  (document.querySelector("[data-action=remove-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

  expect(window.confirm).toHaveBeenCalledWith(labels.removeConfirm);
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).command.type).toBe("playlist.remove");
});

test("edits and refreshes an existing playlist", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: snapshot({ revision: 2 }) }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "prompt")
    .mockReturnValueOnce("Renamed news")
    .mockReturnValueOnce("http://example.com/renamed.m3u");
  await loadApp().start();

  (document.querySelector("[data-action=edit-playlist]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  (document.querySelector("[data-action=refresh-playlist]") as HTMLButtonElement).click();
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

test("refreshes state after a revision conflict", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(409, { ok: false, reason: "conflict", snapshot: snapshot({ revision: 4 }) }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector('[data-setting="showClock"]') as HTMLInputElement).click();
  await vi.waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toBe(labels.conflict));
});

test("clears revoked credentials and reports an unavailable TV", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  vi.stubGlobal("fetch", vi.fn(() => reply(401, { error: "unauthorised" })));
  await loadApp().start();
  expect(localStorage.getItem("openiptv.phone")).toBeNull();
  expect(document.body.textContent).toContain(labels.revoked);

  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await loadApp().start();
  expect(document.body.textContent).toContain(labels.unavailable);
});

test("confirms cache clearing before sending it", async () => {
  localStorage.setItem("openiptv.phone", JSON.stringify({ phoneId: "p", credential: "c" }));
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(() => reply(200, snapshot()))
    .mockImplementationOnce(() => reply(200, { ok: true, snapshot: snapshot({ revision: 1 }) }));
  vi.stubGlobal("fetch", fetchMock);
  await loadApp().start();

  (document.querySelector("[data-action=clear-cache]") as HTMLButtonElement).click();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

  expect(window.confirm).toHaveBeenCalledWith(labels.cacheConfirm);
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).command.type).toBe("cache.clear");
});
