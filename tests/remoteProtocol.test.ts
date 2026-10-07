import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/services/personalDisk", () => ({
  readLineup: vi.fn().mockResolvedValue(null),
  writeLineup: vi.fn().mockResolvedValue(undefined),
  removeLineup: vi.fn().mockResolvedValue(undefined),
  clearLineups: vi.fn().mockResolvedValue(undefined),
}));

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
      { type: "setting", key: "lineupOrderMode", value: "provider" },
      { type: "setting", key: "lineupOrderMode", value: "alphabetical" },
      { type: "setting", key: "lineupOrderMode", value: "number" },
      { type: "setting", key: "lineupOrderMode", value: "custom" },
      { type: "setting", key: "compatibility", value: true },
      { type: "setting", key: "continuousReconnect", value: true },
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
    expect(
      parseRemoteCommand({ type: "setting", key: "sortAlphabetically", value: true }),
    ).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "lineupOrderMode", value: "recent" }),
    ).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "continuousReconnect", value: "yes" }),
    ).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "showPlaybackStats", value: true }),
    ).toBeNull();
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
    expect(result.snapshot.settings.continuousReconnect).toBe(false);
    expect(result.snapshot.settings.lineupOrderMode).toBe("provider");
    expect("sortAlphabetically" in result.snapshot.settings).toBe(false);
    expect("showPlaybackStats" in result.snapshot.settings).toBe(false);
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
    await s.applyRemoteCommand({
      id: "later-change",
      revision: first.snapshot.revision,
      command: { type: "setting", key: "showClock", value: false },
    });
    const duplicate = await s.applyRemoteCommand(request);

    expect(duplicate.ok).toBe(first.ok);
    expect(duplicate.reason).toBe(first.reason);
    expect(duplicate.snapshot.revision).toBeGreaterThan(first.snapshot.revision);
    expect(duplicate.snapshot.settings.showClock).toBe(false);
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

  test("strips Xtream server userinfo from snapshots", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://server-user:server-pass@provider.example/base",
      username: "viewer",
      password: "account-secret",
      output: "m3u8",
    });

    const serialised = JSON.stringify(s.remoteSnapshot());
    expect(serialised).toContain("provider.example/base");
    expect(serialised).not.toContain("server-user");
    expect(serialised).not.toContain("server-pass");
    expect(serialised).not.toContain("account-secret");
  });

  test("strips M3U URL credentials from snapshots and conflicts", async () => {
    const s = await load();
    s.useSettings
      .getState()
      .addPlaylist(
        "Private M3U",
        m3u(
          "https://url-user-987:url-pass-987@example.invalid/list.m3u?username=query-user-987&password=query-pass-987&token=query-token-987&format=m3u8#fragment-secret",
        ),
      );
    const serialised = JSON.stringify(s.remoteSnapshot());
    expect(serialised).toContain("example.invalid/list.m3u");
    expect(serialised).toContain("format=m3u8");
    expect(serialised).not.toContain("url-user-987");
    expect(serialised).not.toContain("url-pass-987");
    expect(serialised).not.toContain("query-user-987");
    expect(serialised).not.toContain("query-pass-987");
    expect(serialised).not.toContain("query-token-987");
    expect(serialised).not.toContain("fragment-secret");

    await s.applyRemoteCommand({
      id: "advance",
      revision: 0,
      command: { type: "setting", key: "showClock", value: false },
    });
    const conflict = await s.applyRemoteCommand({
      id: "stale",
      revision: 0,
      command: { type: "setting", key: "showLogos", value: false },
    });
    expect(JSON.stringify(conflict)).not.toContain("url-user-987");
    expect(JSON.stringify(conflict)).not.toContain("url-pass-987");
    expect(JSON.stringify(conflict)).not.toContain("query-token-987");
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

test("keeps complete catalogues out of remote snapshots", async () => {
  const s = await load();
  const { useLineup } = await import("../src/stores/lineup");
  useLineup.setState({
    playlistId: "large",
    revision: 7,
    managedChannels: Array.from({ length: 12_000 }, (_, index) => ({
      ref: { id: `channel-${index}` },
      providerName: `Channel ${index}`,
      providerNumber: index + 1,
      effective: {
        id: `channel-${index}`,
        name: `Channel ${index}`,
        number: index + 1,
        group: "All",
        categoryKey: "All",
        logo: "",
        quality: "",
        url: `http://example.invalid/${index}`,
      },
      hidden: false,
      categoryKeys: ["All"],
    })),
  });
  const snapshot = s.remoteSnapshot();
  expect(snapshot.lineup).toEqual({ playlistId: "large", revision: 7, ready: true });
  expect(JSON.stringify(snapshot)).not.toContain("channel-11999");
});

test("publishes the active lineup readiness and revision", async () => {
  const s = await load();
  const { useLineup } = await import("../src/stores/lineup");
  expect(s.remoteSnapshot().lineup).toBeNull();
  useLineup.setState({ playlistId: "active", revision: 4 });
  expect(s.remoteSnapshot().lineup).toEqual({ playlistId: "active", revision: 4, ready: true });
});
