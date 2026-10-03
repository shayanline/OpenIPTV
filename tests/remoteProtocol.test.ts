import { beforeEach, describe, expect, test, vi } from "vitest";

const m3u = (url: string) => ({ kind: "m3u" as const, url });

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",Alpha
http://example.invalid/a.m3u8`;

const disk = new Map<string, Blob | string>();
let cleared = 0;
let repairStops = 0;
let forgottenRepairHosts = 0;

async function load() {
  vi.resetModules();
  vi.doMock("../src/services/disk", () => ({
    BUDGET_BYTES: 5 * 1024 * 1024,
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: Blob | string) => {
      disk.set(key, value);
      return true;
    },
    forget: async (matches: (key: string) => boolean) => {
      let removed = 0;
      for (const key of [...disk.keys()]) {
        if (!matches(key)) continue;
        disk.delete(key);
        removed += 1;
      }
      return removed;
    },
    forgetAll: async () => {
      cleared += 1;
      disk.clear();
    },
    usage: async () => ({ bytes: 0, count: disk.size }),
    entries: async () => [],
    evictionPlan: () => ({ evict: [], refused: false }),
  }));
  vi.doMock("../src/services/repair", () => ({
    stopRepair: () => {
      repairStops += 1;
    },
    forgetRepairHosts: () => {
      forgottenRepairHosts += 1;
    },
    forgetRepairSource: () => {},
  }));
  const protocol = await import("../src/services/remoteProtocol");
  const settings = await import("../src/stores/settings");
  const channels = await import("../src/stores/channels");
  const setup = await import("../src/stores/setup");
  return { ...protocol, ...settings, ...channels, ...setup };
}

beforeEach(() => {
  localStorage.clear();
  disk.clear();
  cleared = 0;
  repairStops = 0;
  forgottenRepairHosts = 0;
  vi.unstubAllGlobals();
});

describe("remote command parsing", () => {
  test("accepts every ordinary setting with the correct value type", async () => {
    const { parseRemoteCommand } = await load();
    const commands = [
      { type: "setting", key: "locale", value: "fr" },
      { type: "setting", key: "fontSizeId", value: "l" },
      { type: "setting", key: "showNumbers", value: false },
      { type: "setting", key: "showLogos", value: false },
      { type: "setting", key: "aspectId", value: "fit" },
      { type: "setting", key: "showClock", value: false },
      { type: "setting", key: "resumeLast", value: false },
      { type: "setting", key: "sortAlphabetically", value: true },
      { type: "setting", key: "compatibility", value: true },
      {
        type: "setup.preview",
        name: "News",
        source: m3u("http://example.invalid/list.m3u"),
      },
    ];

    for (const command of commands) expect(parseRemoteCommand(command)).toEqual(command);
  });

  test("rejects unknown commands, settings, values, and extra fields", async () => {
    const { parseRemoteCommand } = await load();

    expect(parseRemoteCommand({ type: "setting", key: "secret", value: true })).toBeNull();
    expect(parseRemoteCommand({ type: "setting", key: "showClock", value: "yes" })).toBeNull();
    expect(parseRemoteCommand({ type: "play", url: "http://example.invalid" })).toBeNull();
    expect(
      parseRemoteCommand({ type: "playlist.remove", id: "pl-1", credential: "leak" }),
    ).toBeNull();
  });
});

describe("remote command application", () => {
  test("rejects a stale revision without applying its command", async () => {
    const s = await load();
    const first = await s.applyRemoteCommand({
      id: "one",
      revision: 0,
      command: { type: "setting", key: "showClock", value: false },
    });
    const stale = await s.applyRemoteCommand({
      id: "two",
      revision: 0,
      command: { type: "setting", key: "showLogos", value: false },
    });

    expect(first.ok).toBe(true);
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe("conflict");
    expect(s.useSettings.getState().showLogos).toBe(true);
  });

  test("serializes commands so only one request can claim a revision", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
    let release: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = s.applyRemoteCommand({
      id: "refresh-first",
      revision: 0,
      command: { type: "playlist.refresh" },
    });
    const second = s.applyRemoteCommand({
      id: "setting-second",
      revision: 0,
      command: { type: "setting", key: "showClock", value: false },
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release({ ok: true, text: async () => PLAYLIST });

    expect((await first).ok).toBe(true);
    expect(await second).toMatchObject({ ok: false, reason: "conflict" });
    expect(s.useSettings.getState().showClock).toBe(true);
  });

  test("mirrors an in-memory setup draft without adding a playlist", async () => {
    const s = await load();

    const result = await s.applyRemoteCommand({
      id: "preview",
      revision: 0,
      command: {
        type: "setup.preview",
        name: "News",
        source: m3u("http://example.invalid/list.m3u"),
      },
    });

    expect(result.ok).toBe(true);
    expect(s.useSettings.getState().locale).toBe("system");
    expect(s.useSetup.getState()).toMatchObject({
      name: "News",
      source: m3u("http://example.invalid/list.m3u"),
    });
    expect(result.snapshot.setup).toEqual({
      name: "News",
      source: m3u("http://example.invalid/list.m3u"),
    });
    expect(result.snapshot.revision).toBe(0);
    const setting = await s.applyRemoteCommand({
      id: "after-preview",
      revision: 0,
      command: { type: "setting", key: "locale", value: "fa" },
    });
    expect(setting.ok).toBe(true);
    expect(s.useSettings.getState().locale).toBe("fa");
    expect(s.useSettings.getState().playlists).toEqual([]);
  });

  test("returns the first result for a duplicate request identifier", async () => {
    const s = await load();
    const request = {
      id: "same-request",
      revision: 0,
      command: {
        type: "playlist.add" as const,
        name: "One",
        source: m3u("http://example.invalid/one.m3u"),
      },
    };

    const first = await s.applyRemoteCommand(request);
    const duplicate = await s.applyRemoteCommand(request);

    expect(duplicate).toEqual(first);
    expect(s.useSettings.getState().playlists).toHaveLength(1);
  });

  test("removing the active playlist promotes and loads the next one", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
    s.useSettings.getState().addPlaylist("Two", m3u("http://example.invalid/two.m3u"));
    const [first, second] = s.useSettings.getState().playlists;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));

    const result = await s.applyRemoteCommand({
      id: "remove",
      revision: 0,
      command: { type: "playlist.remove", id: first.id },
    });

    expect(result.ok).toBe(true);
    expect(s.useSettings.getState().activePlaylistId).toBe(second.id);
    expect(s.useChannels.getState().channels).toHaveLength(1);
  });

  test("first setup commits only after a nonempty playlist validates", async () => {
    const failed = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "not a playlist" }),
    );
    const bad = await failed.applyRemoteCommand({
      id: "bad-setup",
      revision: 0,
      command: {
        type: "setup",
        locale: "fr",
        name: "Bad",
        source: m3u("http://example.invalid/bad.m3u"),
      },
    });
    expect(bad.ok).toBe(false);
    expect(failed.useSettings.getState().playlists).toEqual([]);
    expect(failed.useSettings.getState().locale).toBe("system");

    const good = await load();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => PLAYLIST }));
    const result = await good.applyRemoteCommand({
      id: "good-setup",
      revision: 0,
      command: {
        type: "setup",
        locale: "fr",
        name: "News",
        source: m3u("http://example.invalid/good.m3u"),
      },
    });
    expect(result.ok).toBe(true);
    expect(good.useSettings.getState().locale).toBe("fr");
    expect(good.useSettings.getState().playlists[0].name).toBe("News");
  });

  test("Xtream snapshots omit passwords and blank remote edits preserve them", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "secret",
      output: "ts",
    });
    const playlist = s.useSettings.getState().playlists[0];

    expect(s.remoteSnapshot().playlists[0].source).toEqual({
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      output: "ts",
      hasPassword: true,
    });
    expect(JSON.stringify(s.remoteSnapshot())).not.toContain("secret");

    const result = await s.applyRemoteCommand({
      id: "blank-password",
      revision: 0,
      command: {
        type: "playlist.update",
        id: playlist.id,
        name: "Provider",
        source: {
          kind: "xtream",
          server: "https://new-provider.example",
          username: "viewer",
          password: "",
          output: "m3u8",
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(s.useSettings.getState().playlists[0].source).toEqual({
      kind: "xtream",
      server: "https://new-provider.example",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    });
  });

  test("sanitises account summaries and operation errors at the device boundary", async () => {
    const s = await load();
    const password = "device-boundary-secret";
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password,
      output: "m3u8",
    });
    const playlist = s.useSettings.getState().playlists[0];
    const streamUrl = `https://provider.example/live/viewer/${password}/7.m3u8`;
    s.useChannels.setState({
      accounts: {
        [playlist.id]: {
          status: "Active",
          expiresAt: 1_900_000_000,
          isTrial: true,
          activeConnections: 1,
          maxConnections: 2,
        },
      },
      error: `Could not play ${streamUrl}`,
      errorDetail: streamUrl,
    });

    const serialised = JSON.stringify(s.remoteSnapshot());
    expect(serialised).not.toContain(password);
    expect(serialised).not.toContain("/live/viewer/");
    expect(s.remoteSnapshot().playlists[0].account).toEqual({
      status: "Active",
      expiresAt: 1_900_000_000,
      isTrial: true,
      activeConnections: 1,
      maxConnections: 2,
    });
    expect(s.remoteSnapshot().operation.error).toBe("The change could not be saved.");
    expect(s.remoteSnapshot().operation.errorDetail).toBe("");
  });

  test("a supplied remote password replaces the saved password", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "old-secret",
      output: "ts",
    });
    const playlist = s.useSettings.getState().playlists[0];

    const result = await s.applyRemoteCommand({
      id: "replace-password",
      revision: 0,
      command: {
        type: "playlist.update",
        id: playlist.id,
        name: "Provider",
        source: { ...playlist.source, password: "new-secret" },
      },
    });

    expect(result.ok).toBe(true);
    expect(s.useSettings.getState().playlists[0].source).toMatchObject({
      password: "new-secret",
    });
    expect(JSON.stringify(result.snapshot)).not.toContain("new-secret");
  });

  test("playlist removal and account replacement clear source owned data", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    });
    const playlist = s.useSettings.getState().playlists[0];
    disk.set(`xtream:${playlist.id}:v1:account`, "cached");
    localStorage.setItem(`openiptv.at.xtream:${playlist.id}:v1:account`, "1");

    await s.applyRemoteCommand({
      id: "replace-account",
      revision: 0,
      command: {
        type: "playlist.update",
        id: playlist.id,
        name: "Provider",
        source: {
          kind: "xtream",
          server: "https://replacement.example",
          username: "viewer",
          password: "",
          output: "m3u8",
        },
      },
    });

    expect([...disk.keys()].some((key) => key.startsWith(`xtream:${playlist.id}:`))).toBe(
      false,
    );
    expect(localStorage.getItem(`openiptv.at.xtream:${playlist.id}:v1:account`)).toBeNull();
  });

  test("settings keep their TV side effects and cache clears only on command", async () => {
    const s = await load();
    s.useSettings.getState().set("compatibility", true);

    await s.applyRemoteCommand({
      id: "compatibility",
      revision: 0,
      command: { type: "setting", key: "compatibility", value: false },
    });
    expect(repairStops).toBe(1);
    expect(cleared).toBe(0);

    await s.applyRemoteCommand({
      id: "cache",
      revision: 1,
      command: { type: "cache.clear" },
    });
    expect(cleared).toBe(1);
    expect(forgottenRepairHosts).toBe(1);
  });
});
