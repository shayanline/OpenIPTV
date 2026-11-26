import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { ProviderLineup } from "../src/services/lineup";
import type { Playlist } from "../src/stores/settings";
import type { XtreamCategory, XtreamMovie, XtreamSession } from "../src/services/xtream";

const personal = vi.hoisted(() => ({
  read: vi.fn<(playlistId: string) => Promise<unknown | null>>(),
  write: vi.fn<(playlistId: string, value: unknown) => Promise<void>>(),
  ifAbsent: vi.fn<(playlistId: string, value: unknown) => Promise<boolean>>(),
  remove: vi.fn<(playlistId: string) => Promise<void>>(),
  clear: vi.fn<() => Promise<void>>(),
}));

vi.mock("../src/services/personalDisk", () => ({
  readLineup: personal.read,
  writeLineup: personal.write,
  writeLineupIfAbsent: personal.ifAbsent,
  removeLineup: personal.remove,
  clearLineups: personal.clear,
}));

const cache = vi.hoisted(() => ({
  read: vi.fn<(key: string) => Promise<unknown | null>>(),
  write: vi.fn<(key: string, value: unknown, kind?: string) => Promise<boolean>>(),
}));

vi.mock("../src/services/disk", () => ({
  read: cache.read,
  write: cache.write,
  forget: vi.fn(async () => 0),
  forgetAll: vi.fn(async () => {}),
}));

const xtream = vi.hoisted(() => ({
  authenticate: vi.fn(),
  categories: vi.fn(),
  live: vi.fn(),
  movies: vi.fn(),
  series: vi.fn(),
}));

vi.mock("../src/services/xtream", () => {
  class XtreamRequestError extends Error {
    reason = "network";
    constructor(message: string, reason = "network") {
      super(message);
      this.reason = reason;
    }
  }
  return {
    authenticateXtream: xtream.authenticate,
    loadXtreamCategories: xtream.categories,
    loadXtreamLive: xtream.live,
    loadXtreamMovies: xtream.movies,
    loadXtreamSeries: xtream.series,
    XtreamRequestError,
    loadXtreamGuide: vi.fn(async () => []),
    loadXtreamMovieDetail: vi.fn(),
    loadXtreamSeriesDetail: vi.fn(),
    buildXtreamCatchupUrl: vi.fn(() => ""),
    buildXtreamEpisodeUrl: vi.fn(() => ""),
    buildXtreamMovieUrl: vi.fn(() => ""),
    compareXtreamSeasonKeys: vi.fn(() => 0),
    directSourceFingerprint: vi.fn(() => ""),
  };
});

const idle = vi.hoisted(() => ({
  hold: false,
  deferred: [] as Array<() => void>,
}));

vi.mock("../src/services/idle", () => ({
  whenIdle: (work: () => void) => {
    if (idle.hold) {
      idle.deferred.push(work);
      return () => {
        const index = idle.deferred.indexOf(work);
        if (index >= 0) idle.deferred.splice(index, 1);
      };
    }
    work();
    return () => {};
  },
}));

const managed: Playlist = {
  id: "pl-managed",
  name: "Managed",
  source: { kind: "m3u", url: "http://example.invalid/managed.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};
const active: Playlist = {
  id: "pl-active",
  name: "Active",
  source: { kind: "m3u", url: "http://example.invalid/active.m3u" },
  sourceVersion: 1,
  hiddenCategories: [],
};
const vod: Playlist = {
  id: "pl-vod",
  name: "Vod",
  source: {
    kind: "xtream",
    server: "http://example.invalid",
    username: "user",
    password: "pass",
    output: "ts",
  },
  sourceVersion: 1,
  hiddenCategories: [],
};

const alpha = {
  id: "a",
  name: "Alpha",
  number: 1,
  group: "News",
  categoryKey: "News",
  logo: "",
  quality: "",
  url: "http://example.invalid/a",
  sourceFingerprint: "0123456789abcdef",
};
const m3uText = '#EXTM3U\n#EXTINF:-1 tvg-id="a",Alpha\nhttp://example.invalid/a\n';
const managedProvider: ProviderLineup = {
  channels: [alpha],
  categories: [{ key: "News", name: "News", kind: "live", channels: [alpha] }],
};
const movieCategory: XtreamCategory = {
  key: "movie:7",
  id: "7",
  kind: "movie",
  name: "Films",
  count: 2,
};
const seriesCategory: XtreamCategory = {
  key: "series:9",
  id: "9",
  kind: "series",
  name: "Shows",
};
const vodProvider: ProviderLineup = {
  channels: [],
  categories: [
    { key: "movie:7", name: "Films", kind: "movie", channels: [], count: 2 },
    { key: "series:9", name: "Shows", kind: "series", channels: [] },
  ],
};
const vodCategories: XtreamCategory[] = [movieCategory, seriesCategory];
const vodSession: XtreamSession = {
  server: "http://example.invalid",
  username: "user",
  password: "pass",
  output: "ts",
  streamOrigin: "",
  account: { status: "Active", isTrial: false },
};
const movieZebra: XtreamMovie = {
  key: "xtream:pl-vod:movie:1",
  streamId: "1",
  categoryKey: "movie:7",
  name: "Zebra Film",
  logo: "",
  directSource: "",
  year: "2020",
  rating: "",
};
const movieApple: XtreamMovie = {
  key: "xtream:pl-vod:movie:2",
  streamId: "2",
  categoryKey: "movie:7",
  name: "Apple Film",
  logo: "",
  directSource: "",
  year: "2021",
  rating: "",
};

async function modules() {
  const lineup = await import("../src/stores/lineup");
  const settings = await import("../src/stores/settings");
  const channels = await import("../src/stores/channels");
  const library = await import("../src/stores/library");
  const management = await import("../src/services/lineupManagement");
  return { lineup, settings, channels, library, management };
}

const flush = async (ticks = 20) => {
  for (let index = 0; index < ticks; index += 1) await Promise.resolve();
};

const flushIdle = () => {
  const pending = idle.deferred.splice(0);
  for (const work of pending) work();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    // Node test environments may not provide localStorage.
  }
  personal.read.mockReset();
  personal.write.mockReset();
  personal.ifAbsent.mockReset();
  personal.remove.mockReset();
  personal.clear.mockReset();
  personal.write.mockResolvedValue();
  personal.ifAbsent.mockResolvedValue(true);
  personal.remove.mockResolvedValue();
  personal.clear.mockResolvedValue();
  personal.read.mockResolvedValue(null);
  cache.read.mockReset();
  cache.write.mockReset();
  cache.read.mockResolvedValue(null);
  cache.write.mockResolvedValue(true);
  xtream.authenticate.mockReset();
  xtream.categories.mockReset();
  xtream.live.mockReset();
  xtream.movies.mockReset();
  xtream.series.mockReset();
  xtream.authenticate.mockResolvedValue(vodSession);
  xtream.categories.mockResolvedValue(vodCategories);
  xtream.live.mockResolvedValue([]);
  xtream.movies.mockResolvedValue([movieZebra, movieApple]);
  xtream.series.mockResolvedValue([]);
  idle.hold = false;
  idle.deferred.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("an inactive managed edit leaves the active facade and library untouched", async () => {
  const { lineup, settings, library, management } = await modules();
  settings.useSettings.setState({ playlists: [active, managed], activePlaylistId: active.id });
  personal.read.mockResolvedValue(null);
  const prepared = lineup.prepareLineup(active);
  await lineup.adoptCatalogue(active, managedProvider, prepared);
  library.useLibrary.getState().selectPlaylist(active);
  const before = lineup.useLineup.getState();
  const beforeIndex = before.numberIndex;
  const beforeLibrary = library.useLibrary.getState();
  cache.read.mockImplementation(async (key: string) =>
    key === "playlist:http://example.invalid/managed.m3u" ? m3uText : null,
  );
  const context = await management.acquireManagementContext(managed.id, "tv");
  assert.equal(context.isCurrent(), true);
  const managedState = context.controller.store.getState();
  assert.equal(managedState.playlistId, "pl-managed");
  const target = managedState.managedChannels[0];
  assert.ok(target);
  assert.equal(target.effective.name, "Alpha");
  const mutation = context.controller.applyLineupMutation(managedState.revision, {
    type: "channel.rename",
    channel: target.ref,
    name: "Managed",
  });
  await vi.runAllTimersAsync();
  assert.equal((await mutation).ok, true);
  assert.equal(
    context.controller.store.getState().managedChannels[0]?.effective.name,
    "Managed",
  );
  const after = lineup.useLineup.getState();
  assert.equal(after.playlistId, before.playlistId);
  assert.equal(after.revision, before.revision);
  assert.equal(after.numberIndex, beforeIndex);
  assert.deepEqual(
    after.channels.map((channel) => channel.name),
    before.channels.map((channel) => channel.name),
  );
  assert.equal(library.useLibrary.getState().playlistId, beforeLibrary.playlistId);
  assert.equal(library.useLibrary.getState().categoryItems, beforeLibrary.categoryItems);
  assert.equal(library.useLibrary.getState().categoryItems["movie:7"], undefined);
  assert.deepEqual(personal.write.mock.calls.at(-1)?.[0], "pl-managed");
  await context.release();
});

test("TV and phone contexts share the engine but keep separate view resources", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  const tv = await management.acquireManagementContext(vod.id, "tv");
  const phone = await management.withRemoteManagement(vod.id, async (context) => context);
  assert.equal(phone.controller, tv.controller);
  await tv.library.getState().loadCategories("movie");
  await tv.library.getState().loadCategory("movie", "movie:7");
  assert.equal(tv.library.getState().categoryItems["movie:7"]?.state, "loaded");
  assert.equal(phone.library.getState().categoryItems["movie:7"], undefined);
  const items = tv.library.getState().itemsFor("movie", "movie:7");
  assert.equal(items.state, "loaded");
  assert.equal(items.value.length, 2);
  assert.equal(items.stale, false);
  assert.equal(xtream.movies.mock.calls.length, 1);
  await tv.release();
  await phone.release();
});

test("view ordering projects sorted items while raw provider order stays", async () => {
  const { settings, library, management } = await modules();
  settings.useSettings.setState({ playlists: [vod, active], activePlaylistId: "" });
  library.useLibrary.getState().selectPlaylist(active);
  const context = await management.acquireManagementContext(vod.id, "tv");
  await context.library.getState().loadCategories("movie");
  await context.library.getState().loadCategory("movie", "movie:7");
  const providerOrder = context.library.getState().itemsFor("movie", "movie:7");
  assert.deepEqual(
    providerOrder.value.map((item) => item.name),
    ["Zebra Film", "Apple Film"],
  );
  const applied = await context.controller.applyLineupMutation(
    context.controller.store.getState().revision,
    { type: "item-order.mode", categoryKey: "movie:7", mode: "alphabetical" },
  );
  assert.equal(applied.ok, true);
  const sorted = context.library.getState().itemsFor("movie", "movie:7");
  assert.deepEqual(
    sorted.value.map((item) => item.name),
    ["Apple Film", "Zebra Film"],
  );
  const raw = context.library.getState().categoryItems["movie:7"]?.items ?? [];
  assert.deepEqual(
    raw.map((item) => item.name),
    ["Zebra Film", "Apple Film"],
  );
  assert.equal(library.useLibrary.getState().categoryItems["movie:7"], undefined);
  await context.release();
});

test("a VOD-only cached provider and a missing-cache refresh both acquire", async () => {
  const { settings, channels, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  cache.read.mockImplementation(async (key: string) => {
    if (key === "xtream:pl-vod:v1:categories") return JSON.stringify(vodCategories);
    if (key === "xtream:pl-vod:v1:live") return JSON.stringify([]);
    return null;
  });
  const cached = await management.acquireManagementContext(vod.id, "tv");
  assert.equal(cached.controller.store.getState().playlistId, "pl-vod");
  await cached.library.getState().loadCategories("movie");
  assert.equal(cached.library.getState().categories.movie.items[0]?.count, 2);
  assert.equal(cached.library.getState().categories.movie.items.length, 1);
  await cached.release();

  cache.read.mockResolvedValue(null);
  const refresh = vi.fn(async () => ({
    count: 0,
    error: "",
    provider: vodProvider,
  }));
  channels.useChannels.setState({ refreshPlaylist: refresh });
  const fetched = await management.acquireManagementContext(vod.id, "remote");
  assert.equal(fetched.controller.store.getState().playlistId, "pl-vod");
  assert.equal(refresh.mock.calls.length, 1);
  await fetched.release();
});

test("abort during a started cache read releases the lease before it resolves", async () => {
  const { lineup, settings, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  const raw = await lineup.acquireLineup(managed, "tv");
  const rawController = raw.controller;
  let releaseRead: ((value: unknown) => void) | null = null;
  let reads = 0;
  cache.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        reads += 1;
        releaseRead = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = management.acquireManagementContext(managed.id, "tv", controller.signal);
  for (let index = 0; index < 30 && reads < 1; index += 1) await Promise.resolve();
  assert.equal(reads >= 1, true);
  controller.abort();
  await assert.rejects(pending);
  assert.equal(rawController.disposed, true);
  cache.read.mockImplementation(async (key: string) =>
    key === "playlist:http://example.invalid/managed.m3u" ? m3uText : null,
  );
  const retryLease = await management.acquireManagementContext(managed.id, "remote");
  assert.equal(retryLease.isCurrent(), true);
  releaseRead?.(m3uText);
  await flush();
  await retryLease.release();
  await raw.release();
});

test("abort during personal preparation releases the controller before the read finishes", async () => {
  const { lineup, settings, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  const raw = await lineup.acquireLineup(managed, "tv");
  const controller = raw.controller;
  const adopt = vi.spyOn(controller, "adoptCatalogue");
  let releasePersonal: (value: unknown) => void = () => {};
  personal.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        releasePersonal = resolve;
      }),
  );
  cache.read.mockImplementation(async (key: string) =>
    key === "playlist:http://example.invalid/managed.m3u" ? m3uText : null,
  );
  const signal = new AbortController();
  const pending = management.acquireManagementContext(managed.id, "tv", signal.signal);
  for (let index = 0; index < 80 && adopt.mock.calls.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(adopt.mock.calls.length, 1);
  signal.abort();
  await assert.rejects(pending);
  assert.equal(controller.disposed, true);
  releasePersonal(null);
  await flush();
  assert.equal(controller.store.getState().lineupSummary(), null);
  await raw.release();
});

test("two views share one provider preparation when one aborts", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  const requests: string[] = [];
  let releaseBarrier: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  cache.read.mockImplementation(async (key: string) => {
    requests.push(key);
    await barrier;
    return null;
  });
  const controller = new AbortController();
  const first = management.acquireManagementContext(vod.id, "tv", controller.signal);
  const second = management.acquireManagementContext(vod.id, "remote");
  for (let index = 0; index < 50 && requests.length < 2; index += 1) {
    await Promise.resolve();
  }
  assert.equal(requests.length >= 2, true);
  controller.abort();
  await assert.rejects(first);
  releaseBarrier();
  const context = await second;
  assert.equal(context.controller.store.getState().playlistId, "pl-vod");
  const providerReads = requests.filter((key) => key.startsWith("xtream:pl-vod"));
  assert.equal(providerReads.filter((key) => key.endsWith(":categories")).length, 1);
  assert.equal(providerReads.filter((key) => key.endsWith(":live")).length, 1);
  await context.release();
});

test("loaded category totals survive item pruning without changing the provider", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  xtream.categories.mockResolvedValue([
    ...vodCategories,
    { ...movieCategory, key: "movie:8", id: "8", name: "Empty films" },
    { ...seriesCategory, key: "series:10", id: "10", name: "More shows" },
  ]);
  const context = await management.acquireManagementContext(vod.id, "tv");
  try {
    await context.library.getState().loadCategories("movie");
    await context.library.getState().loadCategories("series");
    assert.equal(context.library.getState().categories.movie.items[0]?.count, 2);
    assert.equal(context.library.getState().categories.series.items[0]?.count, undefined);
    const revision = context.controller.store.getState().revision;
    xtream.movies.mockResolvedValueOnce([movieZebra]);
    await context.library.getState().loadCategory("movie", "movie:7");
    xtream.movies.mockResolvedValueOnce([]);
    await context.library.getState().loadCategory("movie", "movie:8");
    assert.deepEqual(Object.keys(context.library.getState().categoryItems), ["movie:8"]);
    await context.library.getState().loadCategories("movie");
    const counts = new Map(
      context.library
        .getState()
        .categories.movie.items.map((category) => [category.key, category.count]),
    );
    assert.equal(counts.get("movie:7"), 1);
    assert.equal(counts.get("movie:8"), 0);
    await context.library.getState().loadCategory("series", "series:9");
    assert.equal(context.library.getState().categories.series.items[0]?.count, 0);
    xtream.series.mockResolvedValueOnce([
      {
        key: "xtream:pl-vod:series:1",
        seriesId: "1",
        categoryKey: "series:10",
        name: "One show",
        logo: "",
        year: "",
        rating: "",
      },
    ]);
    await context.library.getState().loadCategory("series", "series:10");
    assert.equal(
      context.library
        .getState()
        .categories.series.items.find((category) => category.key === "series:10")?.count,
      1,
    );
    assert.equal(context.controller.store.getState().revision, revision);
    assert.equal(
      context.controller.store
        .getState()
        .provider.categories.find((category) => category.key === "movie:7")?.count,
      2,
    );
    assert.equal(xtream.movies.mock.calls.length, 2);
    assert.equal(xtream.series.mock.calls.length, 2);
  } finally {
    await context.release();
  }
});

test("an obsolete category finally cannot detach the newer request", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  xtream.categories.mockResolvedValue([
    ...vodCategories,
    { ...movieCategory, key: "movie:8", id: "8", name: "Second" },
    { ...movieCategory, key: "movie:9", id: "9", name: "Third" },
  ]);
  const context = await management.acquireManagementContext(vod.id, "tv");
  const gates = new Map<string, (items: XtreamMovie[]) => void>();
  const signals = new Map<string, AbortSignal | undefined>();
  xtream.movies.mockImplementation(
    (_session: unknown, _playlistId: string, id: string, signal?: AbortSignal) =>
      new Promise<XtreamMovie[]>((resolve) => {
        gates.set(id, resolve);
        signals.set(id, signal);
      }),
  );

  const loadA = context.library.getState().loadCategory("movie", "movie:7");
  await flush();
  assert.equal(gates.has("7"), true);
  const loadB = context.library.getState().loadCategory("movie", "movie:8");
  await flush();
  assert.equal(gates.has("8"), true);
  gates.get("7")!([movieApple]);
  await loadA;

  const loadC = context.library.getState().loadCategory("movie", "movie:9");
  await flush();
  assert.equal(gates.has("9"), true);
  assert.equal(signals.get("8")?.aborted, true);
  gates.get("9")!([{ ...movieZebra, categoryKey: "movie:9" }]);
  await loadC;
  gates.get("8")!([{ ...movieApple, categoryKey: "movie:8" }]);
  await loadB;
  const frames = context.library.getState().categoryItems;
  assert.deepEqual(Object.keys(frames), ["movie:9"]);
  assert.deepEqual(
    frames["movie:9"]?.items.map((item) => item.name),
    ["Zebra Film"],
  );
  await context.library.getState().loadCategories("movie");
  const counts = new Map(
    context.library
      .getState()
      .categories.movie.items.map((category) => [category.key, category.count]),
  );
  assert.equal(counts.get("movie:7"), 2);
  assert.equal(counts.get("movie:8"), 2);
  assert.equal(counts.get("movie:9"), 1);
  await context.release();
});

test("a cancelled idle category refresh cannot restart after another category is selected", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  xtream.categories.mockResolvedValue([
    ...vodCategories,
    { ...movieCategory, key: "movie:8", id: "8", name: "Second" },
  ]);
  const context = await management.acquireManagementContext(vod.id, "tv");
  await context.library.getState().loadCategories("movie");
  const cachedA = JSON.stringify([movieZebra, movieApple]);
  cache.read.mockImplementation(async (key: string) =>
    key === "xtream:pl-vod:v1:movie-category:7" ? cachedA : null,
  );
  idle.hold = true;
  const loadA = context.library.getState().loadCategory("movie", "movie:7");
  await flush();
  flushIdle();
  await loadA;
  assert.equal(context.library.getState().categoryItems["movie:7"]?.state, "loaded");
  assert.equal(idle.deferred.length > 0, true);
  const obsoleteRefreshes = [...idle.deferred];
  let releaseB: (items: XtreamMovie[]) => void = () => {};
  let startedB = false;
  xtream.movies.mockImplementation(
    () =>
      new Promise<XtreamMovie[]>((resolve) => {
        startedB = true;
        releaseB = resolve;
      }),
  );
  const loadB = context.library.getState().loadCategory("movie", "movie:8");
  await flush();
  assert.equal(startedB, true);
  // An idle callback may already be queued when its cancellation runs.
  for (const refresh of obsoleteRefreshes) refresh();
  await flush();
  assert.equal(xtream.movies.mock.calls.filter((call) => call[2] === "7").length, 0);
  releaseB([{ ...movieApple, categoryKey: "movie:8" }]);
  await loadB;
  assert.deepEqual(
    context.library.getState().categoryItems["movie:8"]?.items.map((item) => item.name),
    ["Apple Film"],
  );
  await context.release();
});

test("a provider refresh fences a pending category fetch", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  const context = await management.acquireManagementContext(vod.id, "tv");
  await context.library.getState().loadCategories("movie");
  const releases: Array<(items: unknown) => void> = [];
  xtream.movies.mockImplementation(
    () =>
      new Promise((resolve) => {
        releases.push(resolve as (items: unknown) => void);
      }),
  );
  const pending = context.library.getState().loadCategory("movie", "movie:7");
  await flush();
  assert.equal(releases.length, 1);
  const refreshed = {
    ...vodProvider,
    categories: vodProvider.categories.map((category) => ({ ...category })),
  };
  const refresh = context.controller.refreshCatalogue(vod, refreshed);
  await flush();
  assert.equal(releases.length, 2);
  releases[1]([movieZebra]);
  releases[0]([movieApple]);
  await Promise.all([pending, refresh]);
  await flush();
  const frame = context.library.getState().categoryItems["movie:7"];
  assert.deepEqual(
    frame?.items.map((item) => item.name),
    ["Zebra Film"],
  );
  assert.equal(context.library.getState().categories.movie.items[0]?.count, 1);
  const nextProvider = {
    ...vodProvider,
    categories: vodProvider.categories.map((category) =>
      category.key === "movie:7" ? { ...category, count: 5 } : category,
    ),
  };
  const nextRefresh = context.controller.refreshCatalogue(vod, nextProvider);
  await flush();
  await context.library.getState().loadCategories("movie");
  assert.equal(context.library.getState().categories.movie.items[0]?.count, 5);
  assert.equal(releases.length, 3);
  releases[2]([movieZebra, movieApple]);
  await nextRefresh;
  await flush();
  assert.equal(context.library.getState().categories.movie.items[0]?.count, 2);
  await context.release();
});

test("a saved source change aborts a pending VOD fetch and frees the phone queue", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  const tv = await management.acquireManagementContext(vod.id, "tv");
  await tv.library.getState().loadCategories("movie");
  let releaseMovies: ((items: unknown) => void) | null = null;
  let moviesStarted = 0;
  xtream.movies.mockImplementation(
    (_session: unknown, _playlistId: string, _id: string, signal?: AbortSignal) =>
      new Promise((resolve, reject) => {
        moviesStarted += 1;
        releaseMovies = resolve as (items: unknown) => void;
        signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  const pendingLoad = management.withRemoteManagement(vod.id, async (context) => {
    await context.library.getState().loadCategories("movie");
    return context.library.getState().loadCategory("movie", "movie:7");
  });
  for (let index = 0; index < 50 && moviesStarted < 1; index += 1) {
    await Promise.resolve();
  }
  assert.equal(moviesStarted >= 1, true);
  settings.useSettings.setState({
    playlists: [{ ...vod, sourceVersion: 2 }],
    activePlaylistId: "",
  });
  const next = management.withRemoteManagement(
    vod.id,
    async (context) => context.sourceVersion,
  );
  const version = await next;
  assert.equal(version, 2);
  assert.equal(releaseMovies !== null, true);
  await pendingLoad;
  await flush();
  const frames = tv.library.getState().categoryItems;
  assert.notEqual(frames["movie:7"]?.state, "loaded");
  await tv.release();
});

test("promotion during a cold read follows the foreground winner then demotes", async () => {
  const { lineup, settings, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  let releaseRead: (value: unknown) => void = () => {};
  cache.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseRead = resolve;
      }),
  );
  const pending = management.acquireManagementContext(managed.id, "tv");
  await flush();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: managed.id });
  personal.read.mockResolvedValue(null);
  const prepared = lineup.prepareLineup(managed);
  await lineup.adoptCatalogue(managed, managedProvider, prepared);
  releaseRead(m3uText);
  const context = await pending;
  assert.equal(context.playlist.id, "pl-managed");
  assert.equal(context.isCurrent(), true);
  const revision = context.controller.store.getState().revision;
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  await flush();
  assert.equal(context.isCurrent(), true);
  assert.equal(context.controller.store.getState().revision, revision);
  const again = await management.acquireManagementContext(managed.id, "remote");
  assert.equal(again.controller, context.controller);
  await context.release();
  await again.release();
});

test("promotion during personal preparation waits for the foreground attempt", async () => {
  const { lineup, settings, channels, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  cache.read.mockImplementation(async (key: string) =>
    key === "playlist:http://example.invalid/managed.m3u" ? m3uText : null,
  );
  let releasePersonal: (value: unknown) => void = () => {};
  personal.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        releasePersonal = resolve;
      }),
  );
  const pending = management.acquireManagementContext(managed.id, "tv");
  await flush(40);
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: managed.id });
  channels.useChannels.setState({ loading: true });
  releasePersonal(null);
  const prepared = lineup.prepareLineup(managed);
  await lineup.adoptCatalogue(managed, managedProvider, prepared);
  channels.useChannels.setState({ loading: false });
  const context = await pending;
  assert.equal(context.playlist.id, "pl-managed");
  assert.equal(context.isCurrent(), true);
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  await flush();
  assert.equal(context.isCurrent(), true);
  await context.release();
});

test("an active unready playlist without an error is unavailable then recovers", async () => {
  const { lineup, settings, channels, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: managed.id });
  channels.useChannels.setState({ loading: false, error: "" });
  await assert.rejects(
    management.acquireManagementContext(managed.id, "tv"),
    (error: unknown) => {
      assert.ok(error instanceof management.LineupManagementError);
      assert.equal(error.reason, "unavailable");
      return true;
    },
  );
  personal.read.mockResolvedValue(null);
  const prepared = lineup.prepareLineup(managed);
  await lineup.adoptCatalogue(managed, managedProvider, prepared);
  const context = await management.acquireManagementContext(managed.id, "tv");
  assert.equal(context.isCurrent(), true);
  assert.equal(context.controller.store.getState().playlistId, "pl-managed");
  await context.release();
});

test("a replaced source cannot commit stale refresh counts or provider state", async () => {
  const { settings, channels, management } = await modules();
  settings.useSettings.setState({ playlists: [managed], activePlaylistId: "" });
  cache.read.mockImplementation(async (key: string) =>
    key === "playlist:http://example.invalid/managed.m3u" ? m3uText : null,
  );
  const context = await management.acquireManagementContext(managed.id, "tv");
  const before = context.controller.store.getState().provider;
  let releaseFetch: (value: unknown) => void = () => {};
  const fetchMock = vi.fn(
    () =>
      new Promise((resolve) => {
        releaseFetch = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  let releaseWrite: (value: boolean) => void = () => {};
  cache.write.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        releaseWrite = resolve;
      }),
  );
  const pending = channels.useChannels.getState().refreshPlaylist(managed);
  await flush();
  assert.equal(fetchMock.mock.calls.length, 1);
  releaseFetch({ ok: true, text: async () => m3uText });
  await flush();
  settings.useSettings.setState({
    playlists: [{ ...managed, sourceVersion: 2 }],
    activePlaylistId: "",
  });
  releaseWrite(true);
  const result = await pending;
  assert.equal(result.errorKey, "remote.changeFailed");
  assert.equal(result.provider, undefined);
  assert.equal(context.controller.store.getState().provider, before);
  const saved = settings.useSettings.getState().playlists[0];
  assert.equal(saved?.categoryCount, undefined);
  assert.equal(saved?.channelCount, undefined);
  await context.release();
});

test("a replaced Xtream source cannot publish stale freshness or account state", async () => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  const { settings, channels } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  const writes = new Map<string, (value: boolean) => void>();
  cache.write.mockImplementation(
    (key: string) =>
      new Promise<boolean>((resolve) => {
        writes.set(key, resolve);
      }),
  );
  const pending = channels.useChannels.getState().refreshPlaylist(vod);
  for (let index = 0; index < 50 && writes.size < 3; index += 1) {
    await Promise.resolve();
  }
  assert.deepEqual([...writes.keys()].sort(), [
    "xtream:pl-vod:v1:account",
    "xtream:pl-vod:v1:categories",
    "xtream:pl-vod:v1:live",
  ]);
  settings.useSettings.setState({
    playlists: [{ ...vod, sourceVersion: 2 }],
    activePlaylistId: "",
  });
  for (const resolve of writes.values()) resolve(true);
  const result = await pending;
  assert.equal(result.errorKey, "remote.changeFailed");
  assert.equal(result.provider, undefined);
  const saved = settings.useSettings.getState().playlists[0];
  assert.equal(saved?.categoryCount, undefined);
  assert.equal(saved?.channelCount, undefined);
  assert.equal(channels.useChannels.getState().accounts[vod.id], undefined);
  for (const scope of ["account", "categories", "live"]) {
    assert.equal(stored.has(`openiptv.at.xtream:pl-vod:v1:${scope}`), false);
  }
});

test("management badges reuse a shared loaded count without catalogue requests", async () => {
  const { settings, library, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  xtream.categories.mockResolvedValue([{ ...movieCategory, count: 5 }, seriesCategory]);
  library.useLibrary.getState().selectPlaylist(vod);
  await library.useLibrary.getState().loadCategories("movie");
  await library.useLibrary.getState().loadCategory("movie:7");
  const context = await management.acquireManagementContext(vod.id, "tv");
  const callsBefore = xtream.movies.mock.calls.length;
  await context.library.getState().loadCategories("movie");
  const row = context.library
    .getState()
    .categories.movie.items.find((category) => category.key === "movie:7");
  assert.equal(row?.count, 2);
  assert.equal(xtream.movies.mock.calls.length, callsBefore);
  await context.release();
});

test("re-entering an aborted category refetches it and badges stay silent", async () => {
  const { settings, management } = await modules();
  settings.useSettings.setState({ playlists: [vod], activePlaylistId: "" });
  xtream.categories.mockResolvedValue([
    ...vodCategories,
    { ...movieCategory, key: "movie:8", id: "8", name: "Second" },
  ]);
  const context = await management.acquireManagementContext(vod.id, "tv");
  await context.library.getState().loadCategories("movie");
  const calls: Array<{
    id: string;
    resolve: (items: unknown) => void;
    signal?: AbortSignal;
  }> = [];
  xtream.movies.mockImplementation(
    (_session: unknown, _playlistId: string, id: string, signal?: AbortSignal) =>
      new Promise<unknown>((resolve) => {
        calls.push({ id, resolve: resolve as (items: unknown) => void, signal });
      }),
  );
  const loadA = context.library.getState().loadCategory("movie", "movie:7");
  await flush();
  const loadB = context.library.getState().loadCategory("movie", "movie:8");
  await flush();
  assert.equal(calls.filter((call) => call.id === "7").length, 1);
  assert.equal(calls.find((call) => call.id === "7")?.signal?.aborted, true);
  const callsBeforeBadge = xtream.movies.mock.calls.length;
  await context.library.getState().loadCategories("movie");
  assert.equal(xtream.movies.mock.calls.length, callsBeforeBadge);
  const loadA2 = context.library.getState().loadCategory("movie", "movie:7");
  await flush();
  assert.equal(calls.filter((call) => call.id === "7").length, 2);
  assert.equal(calls.filter((call) => call.id === "8").length, 1);
  for (const call of calls) {
    call.resolve(
      call.id === "8" ? [{ ...movieApple, categoryKey: "movie:8" }] : [movieZebra, movieApple],
    );
  }
  await Promise.all([loadA, loadB, loadA2]);
  await flush();
  const frame = context.library.getState().categoryItems["movie:7"];
  assert.equal(frame?.state, "loaded");
  assert.deepEqual(frame?.items.map((item) => item.name).sort(), ["Apple Film", "Zebra Film"]);
  await context.release();
});
