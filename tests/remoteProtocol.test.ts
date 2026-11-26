import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/services/personalDisk", () => ({
  readLineup: vi.fn().mockResolvedValue(null),
  writeLineup: vi.fn().mockResolvedValue(undefined),
  removeLineup: vi.fn().mockResolvedValue(undefined),
  clearLineups: vi.fn().mockResolvedValue(undefined),
  writeLineupIfAbsent: vi.fn().mockResolvedValue(true),
}));

const m3u = (url: string) => ({ kind: "m3u" as const, url });

const PLAYLIST = `#EXTM3U
#EXTINF:-1 group-title="News",Alpha
http://example.invalid/a.m3u8`;

const disk = new Map<string, Blob | string>();
const serviceOrder: string[] = [];
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
      serviceOrder.push("disk.forgetAll");
      cleared += 1;
      disk.clear();
    },
    usage: async () => ({ bytes: 0, count: disk.size }),
    entries: async () => [],
    evictionPlan: () => ({ evict: [], refused: false }),
  }));
  vi.doMock("../src/services/repair", () => ({
    stopRepair: () => {
      serviceOrder.push("repair.stopRepair");
      repairStops += 1;
    },
    forgetRepairHosts: () => {
      serviceOrder.push("repair.forgetRepairHosts");
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
  serviceOrder.length = 0;
  cleared = 0;
  repairStops = 0;
  forgottenRepairHosts = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("player_api.php")) {
        return new Response(
          JSON.stringify({
            user_info: { auth: 1, status: "Active" },
            server_info: { server_protocol: "http", url: "provider.invalid" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(PLAYLIST, { status: 200 });
    }),
  );
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
      { type: "setting", key: "showPlaybackStats", value: true },
      { type: "setting", key: "resumeLast", value: false },
      { type: "setting", key: "compatibility", value: true },
      { type: "setting", key: "continuousReconnect", value: true },
      { type: "setting", key: "hideEmptyCategories", value: false },
      { type: "setting", key: "playlistShortcut", value: false },
      { type: "setting", key: "showLive", value: false },
      { type: "setting", key: "showMovies", value: false },
      { type: "setting", key: "showSeries", value: true },
      { type: "app.reset" },
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
      parseRemoteCommand({ type: "setting", key: "lineupOrderMode", value: "provider" }),
    ).toBeNull();
    expect(parseRemoteCommand({ type: "playlist.refresh" })).toBeNull();
    expect(
      parseRemoteCommand({ type: "playlist.refresh", id: "pl-1", extra: true }),
    ).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "continuousReconnect", value: "yes" }),
    ).toBeNull();
    expect(parseRemoteCommand({ type: "setting", key: "showLive", value: "yes" })).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "playlistShortcut", value: "yes" }),
    ).toBeNull();
    expect(parseRemoteCommand({ type: "setting", key: "showMovies", value: 1 })).toBeNull();
    expect(
      parseRemoteCommand({ type: "setting", key: "hideEmptyCategories", value: "on" }),
    ).toBeNull();
    expect(parseRemoteCommand({ type: "app.reset", extra: true })).toBeNull();
    expect(parseRemoteCommand({ type: "app.reset", id: "pl-1" })).toBeNull();
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

    const playlist = s.useSettings.getState().playlists[0];
    const first = s.applyRemoteCommand({
      id: "refresh-first",
      revision: 0,
      command: { type: "playlist.refresh", id: playlist.id },
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

  test("playlist refresh targets the selected playlist without activating it", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
    s.useSettings.getState().addPlaylist("Two", m3u("http://example.invalid/two.m3u"));
    const [first, second] = s.useSettings.getState().playlists;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const body = url.includes("two.m3u")
        ? '#EXTM3U\n#EXTINF:-1 group-title="Other",Two\nhttp://example.invalid/t2.m3u8'
        : PLAYLIST;
      return new Response(body, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await s.useChannels.getState().activatePlaylist(first.id);
    expect(s.useChannels.getState().channels).toHaveLength(1);

    const refreshed = await s.applyRemoteCommand({
      id: "refresh-inactive",
      revision: 0,
      command: { type: "playlist.refresh", id: second.id },
    });

    expect(refreshed.ok).toBe(true);
    expect(refreshed.message).toBe("Refreshed, 1 channel.");
    expect(s.useSettings.getState().activePlaylistId).toBe(first.id);
    expect(s.useChannels.getState().channels).toHaveLength(1);
    expect(s.useChannels.getState().loading).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("two.m3u"))).toBe(true);

    const missing = await s.applyRemoteCommand({
      id: "refresh-missing",
      revision: refreshed.snapshot.revision,
      command: { type: "playlist.refresh", id: "pl-missing" },
    });
    expect(missing).toMatchObject({ ok: false, reason: "notFound" });

    const active = await s.applyRemoteCommand({
      id: "refresh-active",
      revision: refreshed.snapshot.revision,
      command: { type: "playlist.refresh", id: first.id },
    });

    expect(active.ok).toBe(true);
    expect(active.message).toBe("Refreshed, 1 channel.");
    expect(s.useSettings.getState().activePlaylistId).toBe(first.id);
    expect(s.useChannels.getState().channels).toHaveLength(1);
    expect(s.useChannels.getState().loading).toBe(false);
  });

  test("playlist feedback uses the same localized messages as the main app", async () => {
    const s = await load();
    const { translate } = await import("../src/services/locale");
    s.useSettings.getState().set("locale", "fa");
    s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
    s.useSettings.getState().addPlaylist("Two", m3u("http://example.invalid/two.m3u"));
    const [first, second] = s.useSettings.getState().playlists;
    await s.useChannels.getState().activatePlaylist(first.id);
    const refreshed = await s.applyRemoteCommand({
      id: "feedback-refresh",
      revision: 0,
      command: { type: "playlist.refresh", id: second.id },
    });
    expect(refreshed.message).toBe(translate("fa", "playlist.refreshed", { count: 1 }));
    const activated = await s.applyRemoteCommand({
      id: "feedback-activate",
      revision: refreshed.snapshot.revision,
      command: { type: "playlist.activate", id: second.id },
    });
    expect(activated.message).toBe(
      translate("fa", "playlist.loaded", { name: "Two", count: 1 }),
    );
    const updated = await s.applyRemoteCommand({
      id: "feedback-update",
      revision: activated.snapshot.revision,
      command: {
        type: "playlist.update",
        id: second.id,
        name: "Renamed",
        source: second.source,
      },
    });
    expect(updated.message).toBe(translate("fa", "playlist.updated", { name: "Renamed" }));
    const removed = await s.applyRemoteCommand({
      id: "feedback-remove",
      revision: updated.snapshot.revision,
      command: { type: "playlist.remove", id: second.id },
    });
    expect(removed.message).toBe(translate("fa", "playlist.removed", { name: "Renamed" }));
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
    expect("lineupOrderMode" in result.snapshot.settings).toBe(false);
    expect("sortAlphabetically" in result.snapshot.settings).toBe(false);
    expect(result.snapshot.settings.showPlaybackStats).toBe(false);
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

  test("first setup commits only after a playlist validates, empty included", async () => {
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

    const empty = await load();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, text: async () => "#EXTM3U\n# no channels yet\n" }),
    );
    const emptyResult = await empty.applyRemoteCommand({
      id: "empty-setup",
      revision: 0,
      command: {
        type: "setup",
        locale: "fr",
        name: "Empty",
        source: m3u("http://example.invalid/empty.m3u"),
      },
    });
    expect(emptyResult.ok).toBe(true);
    expect(empty.useSettings.getState().playlists).toHaveLength(1);

    localStorage.clear();
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

  test("a late remote setup cannot overwrite playlists added while it validated", async () => {
    const s = await load();
    const pendingFetches: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingFetches.push(resolve);
          }),
      ),
    );
    const pending = s.applyRemoteCommand({
      id: "late-setup",
      revision: 0,
      command: {
        type: "setup",
        locale: "en",
        name: "Remote",
        source: m3u("http://example.invalid/remote.m3u"),
      },
    });
    await vi.waitFor(() => expect(pendingFetches.length).toBeGreaterThan(0));

    s.useSettings.getState().addPlaylist("Local", m3u("http://example.invalid/local.m3u"));
    for (const resolve of pendingFetches.splice(0)) {
      resolve(new Response(PLAYLIST, { status: 200 }));
    }
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
    expect(s.useSettings.getState().playlists.map((playlist) => playlist.name)).toEqual([
      "Local",
    ]);
  });

  test("a remote playlist update cannot overwrite credentials changed during validation", async () => {
    const s = await load();
    s.useSettings.getState().addPlaylist("Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    });
    const playlist = s.useSettings.getState().playlists[0];
    const pendingFetches: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            pendingFetches.push(resolve);
          }),
      ),
    );
    const pending = s.applyRemoteCommand({
      id: "stale-update",
      revision: 0,
      command: {
        type: "playlist.update",
        id: playlist.id,
        name: "Provider",
        source: {
          kind: "xtream",
          server: "https://provider.example",
          username: "viewer",
          password: "",
          output: "ts",
        },
      },
    });
    await vi.waitFor(() => expect(pendingFetches.length).toBeGreaterThan(0));

    await s.useSettings.getState().updatePlaylist(playlist.id, "Provider", {
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "new-secret",
      output: "m3u8",
    });
    for (const resolve of pendingFetches.splice(0)) {
      resolve(
        new Response(
          JSON.stringify({
            user_info: { auth: 1, status: "Active" },
            server_info: { server_protocol: "http", url: "provider.example" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("conflict");
    expect(s.useSettings.getState().playlists[0].source).toEqual({
      kind: "xtream",
      server: "https://provider.example",
      username: "viewer",
      password: "new-secret",
      output: "m3u8",
    });
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
  const lineup = await import("../src/stores/lineup");
  s.useSettings.getState().addPlaylist("Large", m3u("http://example.invalid/large.m3u"));
  const playlist = s.useSettings.getState().playlists[0];
  const channels = Array.from({ length: 12_000 }, (_, index) => ({
    id: `channel-${index}`,
    name: `Channel ${index}`,
    number: index + 1,
    group: "All",
    categoryKey: "All",
    logo: "",
    quality: "",
    url: `http://example.invalid/${index}`,
  }));
  await lineup.adoptCatalogue(
    playlist,
    { channels, categories: [] },
    lineup.prepareLineup(playlist),
  );
  expect(lineup.useLineup.getState().managedChannels).toHaveLength(12_000);
  const snapshot = s.remoteSnapshot();
  expect(snapshot.lineup).toEqual({ playlistId: playlist.id, revision: 0, ready: true });
  expect(JSON.stringify(snapshot)).not.toContain("channel-11999");
});

test("remote locale options pair native names with translated labels", async () => {
  const s = await load();
  const locale = await import("../src/services/locale");
  const chosenLocale = "fr";
  s.useSettings.setState({ locale: chosenLocale });
  const snapshot = s.remoteSnapshot();
  expect(snapshot.locale).toBe(chosenLocale);
  expect(snapshot.localeOptions).toEqual(
    locale.LOCALE_OPTIONS.map((option) => ({
      id: option.id,
      label: option.nativeLabel,
      secondary: locale.translate(chosenLocale, locale.localeLabelKey(option.id)),
    })),
  );
});

test("publishes the active lineup readiness and revision", async () => {
  const s = await load();
  expect(s.remoteSnapshot().lineup).toBeNull();
  s.useSettings.getState().addPlaylist("Active", m3u("http://example.invalid/active.m3u"));
  const playlist = s.useSettings.getState().playlists[0];
  await s.useChannels.getState().activatePlaylist(playlist.id);
  expect(s.remoteSnapshot().lineup).toEqual({
    playlistId: playlist.id,
    revision: 0,
    ready: true,
  });
});

test("localizes the management section and playlist list labels", async () => {
  const s = await load();
  const { labels } = s.remoteSnapshot();
  expect(labels.appearance).toBe("Appearance");
  expect(labels.playback).toBe("Playback");
  expect(labels.playlists).toBe("Playlists");
  expect(labels.devices).toBe("Remote access");
  expect(labels.about).toBe("About");
  expect(labels.savedPlaylists).toBe("Saved playlists");
  expect(labels.lineupGrab).toBe("Move");
  expect(labels.lineupRelease).toBe("Place here");
  expect(labels.lineupReorder).toBe("Custom Order");
  expect(labels.orderCustom).toBe("Custom Order");
  expect(labels.lineupReorderHelp).toBe(
    "Drag the handle to move an item, or select an item and then select where to place it.",
  );
  expect(labels.lineupPlaylistSettings).toBe("Playlist settings");
  expect(labels.lineupCategoryVisibility).toBe("Category visibility");
  expect(labels.lineupChannelVisibility).toBe("Channel visibility");
  expect(labels.lineupChannelOrder).toBe("Channel order");
  expect(labels.lineupMovieOrder).toBe("Movie order");
  expect(labels.lineupSeriesOrder).toBe("Series order");
  expect(labels.lineupEditCustomOrder).toBe("Edit custom order");
  expect(labels.lineupAllCategoriesIn).toBe("All categories in {section}");
  expect(labels.lineupHideAllQuestion).toBe("Hide all categories?");
  expect(labels.lineupHideAllBody).toBe(
    "This hides all categories in {section} for {playlist}, including other pages and categories outside the current search.",
  );
  expect(labels.lineupBulkShow).toBe("Show all categories");
  expect(labels.lineupBulkHide).toBe("Hide all categories");
  expect(labels.playlistUnavailable).toBe("Unavailable");
  expect(labels.playlistSavedContent).toBe("Saved content");
  expect(labels.playlistUpdated).toBe("{name} updated.");
  expect(labels.refreshing).toBe("Refreshing…");
});

test("content section snapshots expose the new switches", async () => {
  const s = await load();
  const result = await s.applyRemoteCommand({
    id: "snapshot-sections",
    revision: 0,
    command: { type: "setting", key: "hideEmptyCategories", value: false },
  });

  expect(result.ok).toBe(true);
  expect(result.snapshot.settings.hideEmptyCategories).toBe(false);
  expect(result.snapshot.settings.playlistShortcut).toBe(true);
  expect(result.snapshot.settings.showLive).toBe(true);
  expect(result.snapshot.settings.showMovies).toBe(true);
  expect(result.snapshot.settings.showSeries).toBe(true);
  expect(s.useSettings.getState().hideEmptyCategories).toBe(false);
});

test("the playlist shortcut preference can be changed through remote commands", async () => {
  const s = await load();
  const result = await s.applyRemoteCommand({
    id: "disable-playlist-shortcut",
    revision: 0,
    command: { type: "setting", key: "playlistShortcut", value: false },
  });
  expect(result.ok).toBe(true);
  expect(result.snapshot.settings.playlistShortcut).toBe(false);
  expect(s.useSettings.getState().playlistShortcut).toBe(false);
});

test("the last supported section guard holds through remote commands", async () => {
  const s = await load();
  const xtream = {
    kind: "xtream" as const,
    server: "http://provider.invalid",
    username: "viewer",
    password: "secret",
    output: "m3u8" as const,
  };

  let rev = 0;
  const command = async (
    name: string,
    key: "showLive" | "showMovies" | "showSeries",
    value: boolean,
  ) => {
    const result = await s.applyRemoteCommand({
      id: name,
      revision: rev,
      command: { type: "setting", key, value },
    });
    rev = result.snapshot.revision;
    return result;
  };

  // M3U supports only Live, so switching it off is rejected outright while the
  // unsupported section switches still record their values.
  s.useSettings.getState().addPlaylist("M3U", m3u("http://example.invalid/list.m3u"));
  expect(
    (await command("m3u-movies-off", "showMovies", false)).snapshot.settings.showMovies,
  ).toBe(false);
  expect((await command("m3u-live-off", "showLive", false)).snapshot.settings.showLive).toBe(
    true,
  );
  expect(s.useSettings.getState().showLive).toBe(true);
  expect(s.useSettings.getState().showMovies).toBe(false);

  // Xtream supports all three: the last one standing can never be switched off.
  s.useSettings.setState({
    playlists: [
      {
        id: "pl-x",
        name: "Provider",
        source: xtream,
        sourceVersion: 1,
      },
    ],
    activePlaylistId: "pl-x",
    showLive: true,
    showMovies: true,
    showSeries: true,
  });
  await command("x-movies-off", "showMovies", false);
  await command("x-series-off", "showSeries", false);
  const liveOff = await command("x-live-off", "showLive", false);
  expect(liveOff.snapshot.settings.showLive).toBe(true);
  expect(liveOff.snapshot.settings.showMovies).toBe(false);
  expect(liveOff.snapshot.settings.showSeries).toBe(false);
  expect(s.useSettings.getState().showLive).toBe(true);
});

test("app reset clears every store in order and reloads channels", async () => {
  const s = await load();
  const { createPairingSession, pairDevice, listPairedDevices } = await import(
    "../src/services/deviceAccess"
  );
  s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
  disk.set("cached-logo", "blob");
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Handset" });
  if (!paired.ok) throw new Error("pairing failed");
  expect(listPairedDevices()).toHaveLength(1);

  const innerReset = s.useSettings.getState().reset;
  s.useSettings.setState({
    reset: async () => {
      serviceOrder.push("settings.reset");
      return innerReset();
    },
  });
  const innerLoad = s.useChannels.getState().load;
  s.useChannels.setState({
    load: async (...args: Parameters<typeof innerLoad>) => {
      serviceOrder.push("channels.load");
      expect(listPairedDevices()).toEqual([]);
      return innerLoad(...args);
    },
  });

  const result = await s.applyRemoteCommand({
    id: "reset-all",
    revision: 0,
    command: { type: "app.reset" },
  });

  expect(result.ok).toBe(true);
  expect(serviceOrder).toEqual([
    "settings.reset",
    "disk.forgetAll",
    "repair.stopRepair",
    "repair.forgetRepairHosts",
    "channels.load",
  ]);
  expect(cleared).toBe(1);
  expect(forgottenRepairHosts).toBe(1);
  expect(disk.size).toBe(0);
  expect(listPairedDevices()).toEqual([]);
  expect(s.useSettings.getState().playlists).toEqual([]);
  expect(s.useSettings.getState().hideEmptyCategories).toBe(true);
  expect(s.useChannels.getState().channels).toEqual([]);
});

test("a failed app reset stops before touching the other stores", async () => {
  const s = await load();
  const { createPairingSession, pairDevice, listPairedDevices } = await import(
    "../src/services/deviceAccess"
  );
  s.useSettings.getState().addPlaylist("One", m3u("http://example.invalid/one.m3u"));
  disk.set("cached-logo", "blob");
  const session = createPairingSession();
  const paired = await pairDevice({ secret: session.secret, name: "Handset" });
  if (!paired.ok) throw new Error("pairing failed");
  s.useSettings.setState({ reset: async () => false });

  const result = await s.applyRemoteCommand({
    id: "reset-fails",
    revision: 0,
    command: { type: "app.reset" },
  });

  expect(result.ok).toBe(false);
  expect(result.reason).toBe("failed");
  expect(serviceOrder).toEqual([]);
  expect(cleared).toBe(0);
  expect(forgottenRepairHosts).toBe(0);
  expect(disk.size).toBe(1);
  expect(listPairedDevices()).toHaveLength(1);
  expect(s.useSettings.getState().playlists).toHaveLength(1);
});
