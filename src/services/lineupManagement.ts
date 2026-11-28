import { create, type StoreApi, type UseBoundStore } from "zustand";
import { read as readDisk, write as writeDisk } from "./disk";
import { whenIdle } from "./idle";
import { read, write } from "./store";
import { translate, resolveLocale } from "./locale";
import {
  authenticateXtream,
  loadXtreamMovies,
  loadXtreamSeries,
  XtreamRequestError,
  type XtreamCategory,
  type XtreamSession,
} from "./xtream";
import type { ProviderLineup } from "./lineup";
import { acquireLineup, type LineupController, type LineupLease } from "../stores/lineup";
import { useSettings, type Playlist } from "../stores/settings";
import { readCachedProvider, useChannels } from "../stores/channels";
import {
  useLibrary,
  type LibraryItem,
  type LibraryKind,
  type LibraryList,
  type LibraryLoadState,
  type LibraryResource,
} from "../stores/library";

export class LineupManagementError extends Error {
  readonly reason: "notFound" | "unavailable";

  constructor(reason: "notFound" | "unavailable", message: string) {
    super(message);
    this.reason = reason;
  }
}

export interface ManagedLibraryState {
  playlistId: string;
  sourceVersion: number;
  categories: Record<LibraryKind, LibraryList<XtreamCategory>>;
  categoryItems: Record<string, LibraryList<LibraryItem>>;
  loadCategories: (kind: LibraryKind) => Promise<void>;
  loadCategory: (kind: LibraryKind, categoryKey: string) => Promise<void>;
  itemsFor: (kind: LibraryKind, categoryKey: string) => LibraryResource<LibraryItem[]>;
}

export interface LineupManagementContext {
  readonly playlist: Playlist;
  readonly sourceVersion: number;
  readonly controller: LineupController;
  readonly library: UseBoundStore<StoreApi<ManagedLibraryState>>;
  isCurrent(): boolean;
  release(): Promise<void>;
}

const LIBRARY_KINDS: readonly LibraryKind[] = ["movie", "series"];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const humanError = () =>
  translate(resolveLocale(useSettings.getState().locale), "remote.lineupLoadFailed");

const savedPlaylist = (playlistId: string) =>
  useSettings.getState().playlists.find((item) => item.id === playlistId);

const savedMatches = (playlist: Playlist) => {
  const saved = savedPlaylist(playlist.id);
  return !!saved && saved.sourceVersion === playlist.sourceVersion;
};

const controllerReady = (controller: LineupController, playlistId: string) =>
  !controller.disposed && controller.store.getState().playlistId === playlistId;

const categoryIdOf = (categoryKey: string, kind: LibraryKind) =>
  categoryKey.startsWith(`${kind}:`) ? categoryKey.slice(kind.length + 1) : "";

const providerCategories = (provider: ProviderLineup, kind: LibraryKind): XtreamCategory[] =>
  provider.categories
    .filter((category) => category.kind === kind)
    .map((category) => ({
      key: category.key,
      id: categoryIdOf(category.key, kind),
      kind,
      name: category.name,
      ...(category.count !== undefined ? { count: category.count } : {}),
    }));

const categoryCacheKey = (playlist: Playlist, kind: LibraryKind, id: string) =>
  `xtream:${playlist.id}:v${playlist.sourceVersion}:${kind}-category:${id}`;
const stampKey = (key: string) => `openiptv.at.${key}`;
const fresh = (key: string) => Date.now() - (Number(read(stampKey(key))) || 0) < CACHE_TTL_MS;

async function cachedItems<T>(key: string): Promise<T | null> {
  const value = await readDisk(key);
  if (typeof value !== "string") return null;
  return new Promise((resolve) => {
    whenIdle(() => {
      try {
        resolve(JSON.parse(value) as T);
      } catch {
        resolve(null);
      }
    }, 1000);
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The provider request failed";
}

function listFailure(error: unknown): LibraryLoadState {
  return error instanceof XtreamRequestError && error.reason === "too-large"
    ? "too-large"
    : "failed";
}

function viewError(frame: LibraryList<unknown>) {
  if (frame.state === "too-large") return "too-large" as const;
  if (frame.state !== "failed") return undefined;
  const error = frame.error ?? "";
  if (/HTTP 401|authentication/i.test(error)) return "authentication" as const;
  if (/HTTP 403|permission/i.test(error)) return "permission" as const;
  if (/JSON|malformed/i.test(error)) return "malformed" as const;
  return "network" as const;
}

const coldProviders = new Map<string, Promise<ProviderLineup | null>>();

function coldProvider(
  controller: LineupController,
  playlist: Playlist,
): Promise<ProviderLineup | null> {
  const controllerId = controller.controllerId;
  const held = coldProviders.get(controllerId);
  if (held) return held;
  const request = (async () => {
    const cached = await readCachedProvider(playlist);
    if (cached) return cached;
    const result = await useChannels.getState().refreshPlaylist(playlist);
    return result.provider ?? null;
  })().then(
    (provider) => provider,
    () => null,
  );
  coldProviders.set(controllerId, request);
  const settled = () => {
    if (coldProviders.get(controllerId) === request) {
      coldProviders.delete(controllerId);
    }
  };
  void request.then(settled, settled);
  return request;
}

function watchReady(
  controller: LineupController,
  playlist: Playlist,
  signal: AbortSignal,
): Promise<ProviderLineup | null> {
  return new Promise((resolve) => {
    let done = false;
    const unsubs: (() => void)[] = [];
    const onAbort = () => finish(null);
    const finish = (provider: ProviderLineup | null) => {
      if (done) return;
      done = true;
      for (const unsubscribe of unsubs) unsubscribe();
      signal.removeEventListener("abort", onAbort);
      resolve(provider);
    };
    const check = () => {
      if (signal.aborted || controller.disposed || !savedMatches(playlist)) {
        finish(null);
        return;
      }
      if (controllerReady(controller, playlist.id)) {
        finish(controller.store.getState().provider);
      }
    };
    unsubs.push(controller.store.subscribe(check), useSettings.subscribe(check));
    signal.addEventListener("abort", onAbort);
    check();
  });
}

async function waitForForeground(
  controller: LineupController,
  playlist: Playlist,
  signal: AbortSignal,
): Promise<"ready" | "failed" | "inactive" | "stale" | "aborted"> {
  return new Promise((resolve) => {
    let done = false;
    const unsubs: (() => void)[] = [];
    const onAbort = () => finish("aborted");
    const finish = (value: "ready" | "failed" | "inactive" | "stale" | "aborted") => {
      if (done) return;
      done = true;
      for (const unsubscribe of unsubs) unsubscribe();
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const checkNow = () => {
      if (signal.aborted) return finish("aborted");
      if (!savedMatches(playlist)) return finish("stale");
      if (controllerReady(controller, playlist.id)) return finish("ready");
      if (useSettings.getState().activePlaylistId !== playlist.id) {
        return finish("inactive");
      }
      const channels = useChannels.getState();
      if (!channels.loading) return finish("failed");
    };
    const check = () => {
      void Promise.resolve().then(() => {
        if (!done) checkNow();
      });
    };
    unsubs.push(
      controller.store.subscribe(check),
      useSettings.subscribe(check),
      useChannels.subscribe(check),
    );
    signal.addEventListener("abort", onAbort);
    check();
  });
}

interface KindRequest {
  kind: LibraryKind;
  categoryKey: string;
  controller: AbortController;
  generation: number;
}

function createViewLibrary(
  controller: LineupController,
  playlist: Playlist,
  lease: LineupLease,
): { library: UseBoundStore<StoreApi<ManagedLibraryState>>; dispose(): void } {
  let generation = 0;
  let released = false;
  const kindRequests = new Map<LibraryKind, KindRequest>();
  const requests = new Map<string, Promise<void>>();
  const idleRefreshes = new Map<string, () => void>();
  const staleKeys = new Set<string>();
  const forcedKeys = new Set<string>();
  const loadedCategoryCounts = new Map<string, number>();
  let session: XtreamSession | null = null;
  let sessionRequest: Promise<XtreamSession> | null = null;
  let sessionController: AbortController | null = null;

  const emptyCategories = (): Record<LibraryKind, LibraryList<XtreamCategory>> => ({
    movie: { state: "empty", items: [] },
    series: { state: "empty", items: [] },
  });

  const requestCurrent = (request: KindRequest) =>
    !released &&
    generation === request.generation &&
    kindRequests.get(request.kind) === request &&
    !request.controller.signal.aborted &&
    lease.isCurrent() &&
    savedMatches(playlist);

  /*
   * Badge counts reuse what is already resident: a category this view loaded wins, then
   * the shared library's count for the same playlist and source version, then the
   * provider's declared total. Nothing here requests catalogue data.
   */
  const sharedCount = (kind: LibraryKind, key: string, declared: number | undefined) => {
    const learned = loadedCategoryCounts.get(key);
    if (learned !== undefined) return learned;
    const shared = useLibrary.getState();
    if (shared.playlistId === playlist.id && shared.sourceVersion === playlist.sourceVersion) {
      return shared.categoryCountFor(kind, key, declared);
    }
    return declared;
  };

  const sessionCurrent = (requestController: AbortController) =>
    !released &&
    lease.isCurrent() &&
    savedMatches(playlist) &&
    !requestController.signal.aborted;

  const sessionFor = (): Promise<XtreamSession> => {
    if (session) return Promise.resolve(session);
    if (sessionRequest) return sessionRequest;
    const source = playlist.source;
    if (source.kind !== "xtream") {
      return Promise.reject(new Error("This playlist has no on demand library"));
    }
    const requestController = new AbortController();
    sessionController = requestController;
    const request = authenticateXtream(source, requestController.signal)
      .then((next) => {
        if (!sessionCurrent(requestController)) {
          throw new DOMException("Aborted", "AbortError");
        }
        session = next;
        return next;
      })
      .finally(() => {
        if (sessionRequest === request) sessionRequest = null;
        if (sessionController === requestController) sessionController = null;
      });
    sessionRequest = request;
    return request;
  };

  const cancelIdle = (key: string) => {
    const cancel = idleRefreshes.get(key);
    if (cancel) {
      idleRefreshes.delete(key);
      cancel();
    }
  };

  const refreshWhenIdle = (request: KindRequest, work: () => Promise<void>) => {
    const key = request.categoryKey;
    if (idleRefreshes.has(key) || released) return;
    const cancel = whenIdle(() => {
      idleRefreshes.delete(key);
      if (kindRequests.get(request.kind) === request && !released) void work();
    }, 4000);
    idleRefreshes.set(key, cancel);
  };

  const useViewLibrary = create<ManagedLibraryState>((set, get) => {
    const pruneKind = (kind: LibraryKind, keepKey: string) => {
      const items = { ...get().categoryItems };
      let changed = false;
      for (const key of Object.keys(items)) {
        if (key !== keepKey && key.startsWith(`${kind}:`)) {
          delete items[key];
          changed = true;
        }
      }
      if (changed) set({ categoryItems: items });
    };

    const commitItems = (request: KindRequest, items: LibraryItem[]) => {
      if (!requestCurrent(request)) return;
      pruneKind(request.kind, request.categoryKey);
      const count = items.filter((item) => item.categoryKey === request.categoryKey).length;
      loadedCategoryCounts.set(request.categoryKey, count);
      const categories = get().categories[request.kind];
      set({
        categories: {
          ...get().categories,
          [request.kind]: {
            ...categories,
            items: categories.items.map((category) =>
              category.key === request.categoryKey ? { ...category, count } : category,
            ),
          },
        },
        categoryItems: {
          ...get().categoryItems,
          [request.categoryKey]: {
            state: items.length ? "loaded" : "empty",
            items,
          },
        },
      });
    };

    const loadCategory = async (kind: LibraryKind, categoryKey: string, force = false) => {
      if (released) return;
      const owned = generation;
      const current = get().categoryItems[categoryKey];
      const forced = forcedKeys.delete(categoryKey) || force;
      /*
       * A loading frame only joins the request that owns it: the kind's live request must
       * be this same category, un-aborted and still current. Anything else is a stale
       * frame left behind by an interrupted A->B->A hop, so a fresh request replaces it
       * rather than leaving the row pending forever.
       */
      const active = kindRequests.get(kind);
      const activeMatches =
        !!active &&
        active.categoryKey === categoryKey &&
        !active.controller.signal.aborted &&
        requestCurrent(active);
      if (!forced) {
        if (current?.state === "loaded" || current?.state === "empty") return;
        if (current?.state === "loading" && activeMatches) {
          return requests.get(categoryKey);
        }
      }
      const held = requests.get(categoryKey);
      if (held && !forced && activeMatches) return held;
      const previous = kindRequests.get(kind);
      if (previous && (previous.categoryKey !== categoryKey || forced || !activeMatches)) {
        cancelIdle(previous.categoryKey);
        previous.controller.abort();
      }
      const request: KindRequest = {
        kind,
        categoryKey,
        controller: new AbortController(),
        generation: owned,
      };
      kindRequests.set(kind, request);
      const raw = (async () => {
        const id = categoryIdOf(categoryKey, kind);
        const key = categoryCacheKey(playlist, kind, id);
        pruneKind(kind, categoryKey);
        if (!forced || current?.state !== "loaded") {
          set({
            categoryItems: {
              ...get().categoryItems,
              [categoryKey]: { state: "loading", items: [] },
            },
          });
        }
        const refresh = async () => {
          try {
            const session = await sessionFor();
            if (!requestCurrent(request)) return;
            const items =
              kind === "movie"
                ? await loadXtreamMovies(session, playlist.id, id, request.controller.signal)
                : await loadXtreamSeries(session, playlist.id, id, request.controller.signal);
            if (!requestCurrent(request)) return;
            commitItems(request, items);
            staleKeys.delete(categoryKey);
            const stored = await writeDisk(key, JSON.stringify(items), "catalogue").catch(
              () => false,
            );
            if (!requestCurrent(request)) return;
            if (stored) write(stampKey(key), String(Date.now()));
          } catch (error) {
            if (requestCurrent(request)) {
              set({
                categoryItems: {
                  ...get().categoryItems,
                  [categoryKey]: {
                    state: listFailure(error),
                    items: [],
                    error: message(error),
                  },
                },
              });
            }
          }
        };
        if (!forced) {
          const shared = useLibrary.getState();
          if (
            shared.playlistId === playlist.id &&
            shared.sourceVersion === playlist.sourceVersion
          ) {
            const frame = shared.categoryItems[categoryKey];
            if (frame && (frame.state === "loaded" || frame.state === "empty")) {
              commitItems(request, frame.items);
              return;
            }
          }
          const fromCache = await cachedItems<unknown>(key).catch(() => null);
          if (!requestCurrent(request)) return;
          if (Array.isArray(fromCache)) {
            commitItems(request, fromCache);
            if (!fresh(key)) {
              staleKeys.add(categoryKey);
              refreshWhenIdle(request, refresh);
            }
            return;
          }
        }
        await refresh();
      })();
      const work = raw.then(
        () => undefined,
        () => undefined,
      );
      requests.set(categoryKey, work);
      void work.then(() => {
        if (requests.get(categoryKey) === work) requests.delete(categoryKey);
      });
      return work;
    };

    return {
      playlistId: playlist.id,
      sourceVersion: playlist.sourceVersion,
      categories: emptyCategories(),
      categoryItems: {},

      async loadCategories(kind) {
        if (released) return;
        const items = providerCategories(controller.store.getState().provider, kind).map(
          (category) => {
            const count = sharedCount(kind, category.key, category.count);
            return count === undefined ? category : { ...category, count };
          },
        );
        set({
          categories: {
            ...get().categories,
            [kind]: { state: items.length ? "loaded" : "empty", items },
          },
        });
      },

      loadCategory: (kind, categoryKey) => loadCategory(kind, categoryKey, false),

      itemsFor(_kind, categoryKey) {
        const frame = get().categoryItems[categoryKey];
        if (!frame) return { state: "idle", value: [], stale: false };
        const error = viewError(frame);
        return {
          state: frame.state === "too-large" ? "failed" : frame.state,
          value: controller.orderedCategoryItems(
            categoryKey,
            frame.items,
            (item) => item.key,
            (item) => item.name,
          ),
          stale: staleKeys.has(categoryKey),
          ...(error ? { error } : {}),
        };
      },
    };
  });

  const clearWork = () => {
    for (const request of kindRequests.values()) {
      cancelIdle(request.categoryKey);
      request.controller.abort();
    }
    kindRequests.clear();
    requests.clear();
    for (const cancel of idleRefreshes.values()) cancel();
    idleRefreshes.clear();
    staleKeys.clear();
    forcedKeys.clear();
    loadedCategoryCounts.clear();
  };

  let unsubscribeSource = () => {};
  let unsubscribeProvider = () => {};
  let unsubscribeShared = () => {};
  const disposeView = () => {
    if (released) return;
    released = true;
    generation += 1;
    unsubscribeSource();
    unsubscribeProvider();
    unsubscribeShared();
    sessionController?.abort();
    sessionController = null;
    session = null;
    sessionRequest = null;
    clearWork();
    useViewLibrary.setState({ categoryItems: {}, categories: emptyCategories() });
  };

  unsubscribeSource = useSettings.subscribe(() => {
    if (released || savedMatches(playlist)) return;
    disposeView();
  });

  unsubscribeProvider = controller.store.subscribe((state, previous) => {
    if (released) return;
    if (controller.disposed) {
      disposeView();
      return;
    }
    if (state.provider === previous.provider) return;
    generation += 1;
    clearWork();
    const provider = state.provider;
    const next = { ...useViewLibrary.getState().categories };
    for (const kind of LIBRARY_KINDS) {
      const items = providerCategories(provider, kind).map((category) => {
        const count = sharedCount(kind, category.key, category.count);
        return count === undefined ? category : { ...category, count };
      });
      next[kind] = { state: items.length ? "loaded" : "empty", items };
    }
    useViewLibrary.setState({ categories: next });
    for (const [key, frame] of Object.entries(useViewLibrary.getState().categoryItems)) {
      if (frame.state === "loaded" || frame.state === "empty" || frame.state === "loading") {
        forcedKeys.add(key);
        staleKeys.add(key);
        const kind: LibraryKind = key.startsWith("movie:") ? "movie" : "series";
        void useViewLibrary.getState().loadCategory(kind, key);
      }
    }
  });

  unsubscribeShared = useLibrary.subscribe((shared, previous) => {
    if (released) return;
    if (
      shared.playlistId === previous.playlistId &&
      shared.sourceVersion === previous.sourceVersion &&
      shared.categoryItems === previous.categoryItems &&
      shared.searchItems === previous.searchItems &&
      shared.searchItemsByCategory === previous.searchItemsByCategory
    ) {
      return;
    }
    if (shared.playlistId !== playlist.id || shared.sourceVersion !== playlist.sourceVersion) {
      return;
    }
    const provider = controller.store.getState().provider;
    const state = useViewLibrary.getState();
    let changed = false;
    const categories = { ...state.categories };
    for (const kind of LIBRARY_KINDS) {
      const frame = categories[kind];
      if (frame.state !== "loaded" && frame.state !== "empty") continue;
      const declaredByKey = new Map(
        providerCategories(provider, kind).map((category) => [category.key, category.count]),
      );
      let kindChanged = false;
      const items = frame.items.map((category) => {
        const count = sharedCount(kind, category.key, declaredByKey.get(category.key));
        if (count === undefined) {
          if (category.count === undefined) return category;
          const { count: _dropped, ...rest } = category;
          kindChanged = true;
          return rest;
        }
        if (category.count === count) return category;
        kindChanged = true;
        return { ...category, count };
      });
      if (kindChanged) {
        categories[kind] = { ...frame, items };
        changed = true;
      }
    }
    if (changed) useViewLibrary.setState({ categories });
  });

  return {
    library: useViewLibrary,
    dispose: disposeView,
  };
}

export async function acquireManagementContext(
  playlistId: string,
  role: "tv" | "remote",
  signal?: AbortSignal,
): Promise<LineupManagementContext> {
  const playlist = savedPlaylist(playlistId);
  if (!playlist) {
    throw new LineupManagementError("notFound", humanError());
  }

  const lifetime = new AbortController();
  const cleanups: (() => void)[] = [];
  const onCallerAbort = () => lifetime.abort();
  if (signal) {
    if (signal.aborted) {
      lifetime.abort();
    } else {
      signal.addEventListener("abort", onCallerAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onCallerAbort));
    }
  }

  let lease: LineupLease | null = null;
  let releasePromise: Promise<void> | null = null;
  const releaseLease = () => {
    const held = lease;
    if (!held) return Promise.resolve();
    if (!releasePromise) releasePromise = held.release();
    return releasePromise;
  };
  const unavailable = () => new LineupManagementError("unavailable", humanError());

  const onLifetimeAbort = () => {
    void releaseLease();
  };
  lifetime.signal.addEventListener("abort", onLifetimeAbort);

  try {
    lease = await acquireLineup(playlist, role);
    if (lifetime.signal.aborted) throw unavailable();
    const heldLease = lease;
    const controller = heldLease.controller;

    const onSettings = () => {
      if (!savedMatches(playlist) || controller.disposed) lifetime.abort();
    };
    const settingsUnsub = useSettings.subscribe(onSettings);
    cleanups.push(() => settingsUnsub());
    cleanups.push(
      controller.store.subscribe((state) => {
        if (controller.disposed) {
          lifetime.abort();
          return;
        }
        if (state.playlistId && state.playlistId !== playlist.id) lifetime.abort();
      }),
    );
    onSettings();

    let capturedProvider: ProviderLineup | null = null;
    let pendingPrepared: ReturnType<LineupController["prepareLineup"]> | null = null;
    let readiness: ReturnType<typeof watchReady> | null = null;
    const lifetimeCancelled = new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(unavailable());
      if (lifetime.signal.aborted) onAbort();
      else lifetime.signal.addEventListener("abort", onAbort, { once: true });
    });
    void lifetimeCancelled.then(
      () => undefined,
      () => undefined,
    );

    for (;;) {
      if (
        lifetime.signal.aborted ||
        !heldLease.isCurrent() ||
        !savedMatches(playlist) ||
        controller.disposed
      ) {
        throw unavailable();
      }
      if (controllerReady(controller, playlist.id)) break;
      if (useSettings.getState().activePlaylistId === playlist.id) {
        const outcome = await waitForForeground(controller, playlist, lifetime.signal);
        if (outcome === "ready" || outcome === "inactive") continue;
        throw unavailable();
      }
      if (!capturedProvider) {
        if (!pendingPrepared) {
          pendingPrepared = controller.prepareLineup(playlist);
          void pendingPrepared.then(
            () => undefined,
            () => undefined,
          );
        }
        if (!readiness) readiness = watchReady(controller, playlist, lifetime.signal);
        const cold = coldProvider(controller, playlist);
        const outcome = await Promise.race([
          cold.then((next) => ({ kind: "cold" as const, next })),
          readiness.then((next) => ({ kind: "ready" as const, next })),
        ]);
        if (
          lifetime.signal.aborted ||
          !heldLease.isCurrent() ||
          !savedMatches(playlist) ||
          controller.disposed
        ) {
          throw unavailable();
        }
        if (outcome.kind === "ready") {
          if (outcome.next) break;
          throw unavailable();
        }
        if (outcome.next === null) throw unavailable();
        capturedProvider = outcome.next;
      }
      if (useSettings.getState().activePlaylistId === playlist.id) continue;
      const canAdopt = () =>
        heldLease.isCurrent() &&
        savedMatches(playlist) &&
        !lifetime.signal.aborted &&
        !controller.disposed &&
        useSettings.getState().activePlaylistId !== playlist.id &&
        !controllerReady(controller, playlist.id);
      const prepared = pendingPrepared ?? controller.prepareLineup(playlist);
      void prepared.then(
        () => undefined,
        () => undefined,
      );
      try {
        await Promise.race([
          controller.adoptCatalogue(playlist, capturedProvider, prepared, canAdopt),
          lifetimeCancelled,
        ]);
      } catch {
        throw unavailable();
      }
    }

    if (
      lifetime.signal.aborted ||
      !heldLease.isCurrent() ||
      !savedMatches(playlist) ||
      controller.disposed ||
      !controllerReady(controller, playlist.id)
    ) {
      throw unavailable();
    }
    const provider = controller.store.getState().provider;
    if (!provider) throw unavailable();

    const view = createViewLibrary(controller, playlist, heldLease);
    let released = false;
    lifetime.signal.removeEventListener("abort", onLifetimeAbort);
    return {
      playlist,
      sourceVersion: playlist.sourceVersion,
      controller,
      library: view.library,
      isCurrent() {
        return !released && heldLease.isCurrent() && savedMatches(playlist);
      },
      async release() {
        if (released) return;
        released = true;
        view.dispose();
        await releaseLease();
      },
    };
  } catch (error) {
    await releaseLease();
    if (error instanceof LineupManagementError) throw error;
    throw unavailable();
  } finally {
    for (const cleanup of cleanups) cleanup();
    lifetime.abort();
  }
}

let remoteQueue: Promise<unknown> = Promise.resolve();
let remoteHeld: { playlistId: string; context: LineupManagementContext } | null = null;

export function withRemoteManagement<T>(
  playlistId: string,
  work: (context: LineupManagementContext) => Promise<T>,
): Promise<T> {
  const run = remoteQueue.then(async () => {
    const playlist = savedPlaylist(playlistId);
    if (!playlist) {
      throw new LineupManagementError("notFound", humanError());
    }
    if (
      remoteHeld &&
      (remoteHeld.playlistId !== playlistId || !remoteHeld.context.isCurrent())
    ) {
      const stale = remoteHeld.context;
      remoteHeld = null;
      await stale.release();
    }
    if (!remoteHeld) {
      const context = await acquireManagementContext(playlistId, "remote");
      remoteHeld = { playlistId, context };
    }
    return work(remoteHeld.context);
  });
  remoteQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
