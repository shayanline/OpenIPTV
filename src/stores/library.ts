import { create } from "zustand";
import { read as readDisk, write as writeDisk } from "../services/disk";
import { whenIdle } from "../services/idle";
import { read, write } from "../services/store";
import {
  authenticateXtream,
  buildXtreamCatchupUrl,
  buildXtreamEpisodeUrl,
  buildXtreamMovieUrl,
  loadXtreamCategories,
  loadXtreamGuide,
  loadXtreamMovieDetail,
  loadXtreamMovies,
  loadXtreamSeries,
  loadXtreamSeriesDetail,
  type XtreamCategory,
  type XtreamContentKind,
  type XtreamEpisode,
  type XtreamMovie,
  type XtreamMovieDetail,
  type XtreamProgramme,
  type XtreamSeries,
  type XtreamSeriesDetail,
  type XtreamSession,
} from "../services/xtream";
import type { Channel, PlaybackTarget } from "../types";
import type { Playlist } from "./settings";
import { usePersonal } from "./personal";

export type LibraryKind = Exclude<XtreamContentKind, "live">;
export type LibraryItem = XtreamMovie | XtreamSeries;
export type LibraryLoadState = "loading" | "loaded" | "empty" | "failed";

export interface LibraryList<T> {
  state: LibraryLoadState;
  items: T[];
  error?: string;
}

export interface LibraryDetail<T> {
  state: LibraryLoadState;
  value?: T;
  error?: string;
}

export interface GuideProgramme extends XtreamProgramme {
  target?: PlaybackTarget;
}

export interface ChannelGuide extends LibraryList<GuideProgramme> {
  current?: GuideProgramme;
  next?: GuideProgramme;
  fetchedAt?: number;
}

interface LibraryState {
  playlistId: string;
  sourceVersion: number;
  categories: Record<LibraryKind, LibraryList<XtreamCategory>>;
  categoryItems: Record<string, LibraryList<LibraryItem>>;
  searchItems: Record<LibraryKind, LibraryList<LibraryItem>>;
  movieDetails: Record<string, LibraryDetail<XtreamMovieDetail>>;
  seriesDetails: Record<string, LibraryDetail<XtreamSeriesDetail>>;
  guides: Record<string, ChannelGuide>;
  selectPlaylist: (playlist: Playlist | undefined) => void;
  loadCategories: (kind: LibraryKind) => Promise<void>;
  loadCategory: (categoryKey: string) => Promise<void>;
  loadSearch: (kind: LibraryKind) => Promise<void>;
  loadMovie: (movieKey: string) => Promise<void>;
  loadSeries: (seriesKey: string) => Promise<void>;
  loadGuide: (channel: Channel) => Promise<void>;
  guideFor: (channelId: string) => ChannelGuide;
  retry: (frameKey: string) => Promise<void>;
  clear: () => void;
}

const GUIDE_TTL_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const emptyList = <T>(): LibraryList<T> => ({ state: "empty", items: [] });
const emptyGuide = (): ChannelGuide => ({ state: "empty", items: [] });
const initialCategories = (): Record<LibraryKind, LibraryList<XtreamCategory>> => ({
  movie: emptyList(),
  series: emptyList(),
});
const initialSearch = (): Record<LibraryKind, LibraryList<LibraryItem>> => ({
  movie: emptyList(),
  series: emptyList(),
});

let selected: Playlist | undefined;
let generation = 0;
const controllers = new Set<AbortController>();
const requests = new Map<string, Promise<void>>();
const idleRefreshes = new Map<string, () => void>();
const loadedSearches = new Set<string>();
const sessions = new Map<string, XtreamSession>();
const sessionRequests = new Map<string, Promise<XtreamSession>>();
let sessionController: AbortController | undefined;
let guideController: AbortController | undefined;
let guideChannelId = "";

const selectionKey = (playlist: Playlist) => `${playlist.id}:v${playlist.sourceVersion}`;
const cachePrefix = (playlist: Playlist) => `xtream:${playlist.id}:v${playlist.sourceVersion}`;
const categoryCacheKey = (playlist: Playlist, kind: LibraryKind, id: string) =>
  `${cachePrefix(playlist)}:${kind}-category:${id}`;
const detailCacheKey = (playlist: Playlist, kind: LibraryKind, id: string) =>
  `${cachePrefix(playlist)}:${kind}:${id}`;
const searchCacheKey = (playlist: Playlist, kind: LibraryKind) =>
  `${cachePrefix(playlist)}:${kind}-search`;
const stampKey = (key: string) => `openiptv.at.${key}`;
const fresh = (key: string) => Date.now() - (Number(read(stampKey(key))) || 0) < CACHE_TTL_MS;

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The provider request failed";
}

function categoryId(categoryKey: string, kind: LibraryKind): string {
  return categoryKey.startsWith(`${kind}:`) ? categoryKey.slice(kind.length + 1) : "";
}

function providerId(itemKey: string, kind: LibraryKind): string {
  const state = useLibrary.getState();
  for (const frame of [
    ...Object.values(state.categoryItems),
    ...Object.values(state.searchItems),
  ]) {
    const item = frame.items.find((candidate) => candidate.key === itemKey);
    if (item)
      return kind === "movie"
        ? (item as XtreamMovie).streamId
        : (item as XtreamSeries).seriesId;
  }
  return (
    usePersonal
      .getState()
      .favourites.find((item) => item.itemKey === itemKey && item.kind === kind)?.providerId ??
    ""
  );
}

async function cached<T>(key: string): Promise<T | null> {
  const value = await readDisk(key);
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function abortRequests() {
  generation += 1;
  sessionController?.abort();
  sessionController = undefined;
  sessionRequests.clear();
  guideController?.abort();
  guideController = undefined;
  guideChannelId = "";
  for (const controller of controllers) controller.abort();
  controllers.clear();
  for (const cancel of idleRefreshes.values()) cancel();
  idleRefreshes.clear();
  loadedSearches.clear();
  requests.clear();
}

async function sessionFor(playlist: Playlist): Promise<XtreamSession> {
  if (playlist.source.kind !== "xtream")
    throw new Error("This playlist has no on demand library");
  const key = selectionKey(playlist);
  const held = sessions.get(key);
  if (held) return held;
  const pending = sessionRequests.get(key);
  if (pending) return pending;

  const owned = generation;
  const controller = new AbortController();
  sessionController = controller;
  const request = authenticateXtream(playlist.source, controller.signal)
    .then((session) => {
      if (
        controller.signal.aborted ||
        owned !== generation ||
        !selected ||
        selectionKey(selected) !== key
      )
        throw new DOMException("Aborted", "AbortError");
      sessions.set(key, session);
      return session;
    })
    .finally(() => {
      if (sessionRequests.get(key) === request) sessionRequests.delete(key);
      if (sessionController === controller) sessionController = undefined;
    });
  sessionRequests.set(key, request);
  return request;
}

export async function libraryPlaybackUrl(item: XtreamMovie | XtreamEpisode): Promise<string> {
  const playlist = selected;
  if (!playlist) throw new Error("This playlist has no on demand library");
  const session = await sessionFor(playlist);
  return "streamId" in item
    ? buildXtreamMovieUrl(session, item.streamId, item.extension)
    : buildXtreamEpisodeUrl(session, item.episodeId, item.extension);
}

function deduplicate(frameKey: string, work: () => Promise<void>): Promise<void> {
  const held = requests.get(frameKey);
  if (held) return held;
  const request = work().finally(() => {
    if (requests.get(frameKey) === request) requests.delete(frameKey);
  });
  requests.set(frameKey, request);
  return request;
}

function refreshWhenIdle(key: string, owned: number, work: () => Promise<void>) {
  if (idleRefreshes.has(key)) return;
  const cancel = whenIdle(() => {
    idleRefreshes.delete(key);
    if (owned === generation) void work();
  }, 4000);
  idleRefreshes.set(key, cancel);
}

function catchupTarget(
  playlist: Playlist,
  session: XtreamSession,
  channel: Channel,
  programme: XtreamProgramme,
  now: number,
): PlaybackTarget | undefined {
  const metadata = channel.xtream;
  const start = programme.startTimestamp;
  const stop = programme.stopTimestamp;
  if (
    !metadata ||
    !programme.archived ||
    metadata.archiveDays < 1 ||
    start === undefined ||
    stop === undefined ||
    start >= stop ||
    stop > now ||
    start < now - metadata.archiveDays * 86400 ||
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(programme.start)
  )
    return undefined;
  return {
    id: `xtream:${playlist.id}:catchup:${metadata.streamId}:${programme.id}`,
    playlistId: playlist.id,
    mode: "finite",
    kind: "catchup",
    name: programme.title,
    group: channel.name,
    logo: channel.logo,
    url: buildXtreamCatchupUrl(
      session,
      metadata.streamId,
      Math.ceil((stop - start) / 60),
      programme.start,
    ),
  };
}

export const useLibrary = create<LibraryState>((set, get) => ({
  playlistId: "",
  sourceVersion: 0,
  categories: initialCategories(),
  categoryItems: {},
  searchItems: initialSearch(),
  movieDetails: {},
  seriesDetails: {},
  guides: {},

  selectPlaylist(playlist) {
    const nextKey = playlist ? selectionKey(playlist) : "";
    const currentKey = selected ? selectionKey(selected) : "";
    if (nextKey === currentKey) return;
    abortRequests();
    selected = playlist?.source.kind === "xtream" ? playlist : undefined;
    set({
      playlistId: selected?.id ?? "",
      sourceVersion: selected?.sourceVersion ?? 0,
      categories: initialCategories(),
      categoryItems: {},
      searchItems: initialSearch(),
      movieDetails: {},
      seriesDetails: {},
      guides: {},
    });
  },

  async loadCategories(kind) {
    const playlist = selected;
    if (
      !playlist ||
      get().categories[kind].state === "loading" ||
      get().categories[kind].state === "loaded"
    )
      return;
    const frameKey = `categories:${kind}`;
    return deduplicate(frameKey, async () => {
      const owned = generation;
      set({ categories: { ...get().categories, [kind]: { state: "loading", items: [] } } });
      const fromCache = await cached<XtreamCategory[]>(`${cachePrefix(playlist)}:categories`);
      if (owned !== generation) return;
      if (fromCache) {
        const items = fromCache.filter((category) => category.kind === kind);
        set({
          categories: {
            ...get().categories,
            [kind]: { state: items.length ? "loaded" : "empty", items },
          },
        });
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const session = await sessionFor(playlist);
        const all = await loadXtreamCategories(session, controller.signal);
        if (owned !== generation) return;
        const next = { ...get().categories };
        for (const contentKind of ["movie", "series"] as const) {
          const items = all.filter((category) => category.kind === contentKind);
          next[contentKind] = { state: items.length ? "loaded" : "empty", items };
        }
        set({ categories: next });
        void writeDisk(`${cachePrefix(playlist)}:categories`, JSON.stringify(all));
      } catch (error) {
        if (owned === generation && !controller.signal.aborted) {
          set({
            categories: {
              ...get().categories,
              [kind]: { state: "failed", items: [], error: message(error) },
            },
          });
        }
      } finally {
        controllers.delete(controller);
      }
    });
  },

  async loadCategory(categoryKey) {
    const playlist = selected;
    const kind: LibraryKind | undefined = categoryKey.startsWith("movie:")
      ? "movie"
      : categoryKey.startsWith("series:")
        ? "series"
        : undefined;
    if (!playlist || !kind) return;
    const current = get().categoryItems[categoryKey];
    if (
      current?.state === "loading" ||
      current?.state === "loaded" ||
      current?.state === "empty"
    )
      return;
    return deduplicate(categoryKey, async () => {
      const owned = generation;
      set({
        categoryItems: {
          ...get().categoryItems,
          [categoryKey]: { state: "loading", items: [] },
        },
      });
      const id = categoryId(categoryKey, kind);
      const key = categoryCacheKey(playlist, kind, id);
      let showingCache = false;
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const items =
            kind === "movie"
              ? await loadXtreamMovies(session, playlist.id, id, controller.signal)
              : await loadXtreamSeries(session, playlist.id, id, controller.signal);
          if (owned !== generation || controller.signal.aborted) return;
          set({
            categoryItems: {
              ...get().categoryItems,
              [categoryKey]: { state: items.length ? "loaded" : "empty", items },
            },
          });
          void writeDisk(key, JSON.stringify(items));
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (owned === generation && !controller.signal.aborted && !showingCache) {
            set({
              categoryItems: {
                ...get().categoryItems,
                [categoryKey]: { state: "failed", items: [], error: message(error) },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = await cached<LibraryItem[]>(key);
      if (owned !== generation) return;
      if (fromCache) {
        showingCache = true;
        set({
          categoryItems: {
            ...get().categoryItems,
            [categoryKey]: { state: fromCache.length ? "loaded" : "empty", items: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadSearch(kind) {
    const playlist = selected;
    if (!playlist) return;
    const current = get().searchItems[kind];
    const owner = `${selectionKey(playlist)}:${kind}`;
    if (current.state === "loading" || loadedSearches.has(owner)) return;
    const frameKey = `search:${kind}`;
    return deduplicate(frameKey, async () => {
      const owned = generation;
      set({
        searchItems: { ...get().searchItems, [kind]: { state: "loading", items: [] } },
      });
      const key = searchCacheKey(playlist, kind);
      let showingCache = false;
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const items =
            kind === "movie"
              ? await loadXtreamMovies(session, playlist.id, "", controller.signal)
              : await loadXtreamSeries(session, playlist.id, "", controller.signal);
          if (owned !== generation || controller.signal.aborted) return;
          loadedSearches.add(owner);
          set({
            searchItems: {
              ...get().searchItems,
              [kind]: { state: items.length ? "loaded" : "empty", items },
            },
          });
          void writeDisk(key, JSON.stringify(items));
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (owned === generation && !controller.signal.aborted && !showingCache) {
            set({
              searchItems: {
                ...get().searchItems,
                [kind]: { state: "failed", items: [], error: message(error) },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = await cached<LibraryItem[]>(key);
      if (owned !== generation) return;
      if (fromCache) {
        showingCache = true;
        loadedSearches.add(owner);
        set({
          searchItems: {
            ...get().searchItems,
            [kind]: { state: fromCache.length ? "loaded" : "empty", items: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadMovie(movieKey) {
    const playlist = selected;
    if (!playlist) return;
    const current = get().movieDetails[movieKey];
    if (current?.state === "loading" || current?.state === "loaded") return;
    return deduplicate(movieKey, async () => {
      const owned = generation;
      set({ movieDetails: { ...get().movieDetails, [movieKey]: { state: "loading" } } });
      const id = providerId(movieKey, "movie");
      if (!id) {
        set({
          movieDetails: {
            ...get().movieDetails,
            [movieKey]: { state: "failed", error: "Movie details are unavailable" },
          },
        });
        return;
      }
      const key = detailCacheKey(playlist, "movie", id);
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const value = await loadXtreamMovieDetail(
            session,
            playlist.id,
            id,
            controller.signal,
          );
          if (owned !== generation || controller.signal.aborted) return;
          set({
            movieDetails: { ...get().movieDetails, [movieKey]: { state: "loaded", value } },
          });
          void writeDisk(key, JSON.stringify(value));
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (
            owned === generation &&
            !controller.signal.aborted &&
            !get().movieDetails[movieKey]?.value
          ) {
            set({
              movieDetails: {
                ...get().movieDetails,
                [movieKey]: { state: "failed", error: message(error) },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = await cached<XtreamMovieDetail>(key);
      if (owned !== generation) return;
      if (fromCache) {
        set({
          movieDetails: {
            ...get().movieDetails,
            [movieKey]: { state: "loaded", value: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadSeries(seriesKey) {
    const playlist = selected;
    if (!playlist) return;
    const current = get().seriesDetails[seriesKey];
    if (current?.state === "loading" || current?.state === "loaded") return;
    return deduplicate(seriesKey, async () => {
      const owned = generation;
      set({ seriesDetails: { ...get().seriesDetails, [seriesKey]: { state: "loading" } } });
      const id = providerId(seriesKey, "series");
      if (!id) {
        set({
          seriesDetails: {
            ...get().seriesDetails,
            [seriesKey]: { state: "failed", error: "Series details are unavailable" },
          },
        });
        return;
      }
      const key = detailCacheKey(playlist, "series", id);
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const value = await loadXtreamSeriesDetail(
            session,
            playlist.id,
            id,
            controller.signal,
          );
          if (owned !== generation || controller.signal.aborted) return;
          set({
            seriesDetails: { ...get().seriesDetails, [seriesKey]: { state: "loaded", value } },
          });
          void writeDisk(key, JSON.stringify(value));
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (
            owned === generation &&
            !controller.signal.aborted &&
            !get().seriesDetails[seriesKey]?.value
          ) {
            set({
              seriesDetails: {
                ...get().seriesDetails,
                [seriesKey]: { state: "failed", error: message(error) },
              },
            });
          }
        } finally {
          controllers.delete(controller);
        }
      };
      const fromCache = await cached<XtreamSeriesDetail>(key);
      if (owned !== generation) return;
      if (fromCache) {
        set({
          seriesDetails: {
            ...get().seriesDetails,
            [seriesKey]: { state: "loaded", value: fromCache },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadGuide(channel) {
    const playlist = selected;
    const metadata = channel.xtream;
    if (!playlist || !metadata || metadata.playlistId !== playlist.id) return;
    const held = get().guides[channel.id];
    if (held?.fetchedAt && Date.now() - held.fetchedAt <= GUIDE_TTL_MS) return;
    if (guideChannelId === channel.id && guideController) return;

    if (guideController) {
      guideController.abort();
      const abandoned = get().guides[guideChannelId];
      if (abandoned?.state === "loading") {
        set({ guides: { ...get().guides, [guideChannelId]: emptyGuide() } });
      }
    }
    const controller = new AbortController();
    guideController = controller;
    guideChannelId = channel.id;
    const owned = generation;
    set({
      guides: {
        ...get().guides,
        [channel.id]: { state: "loading", items: held?.items ?? [] },
      },
    });
    try {
      const session = await sessionFor(playlist);
      if (controller.signal.aborted || owned !== generation) return;
      const programmes = await loadXtreamGuide(session, metadata.streamId, controller.signal);
      if (controller.signal.aborted || owned !== generation) return;
      const now = Math.floor(Date.now() / 1000);
      const items: GuideProgramme[] = programmes
        .map((programme) => {
          const target = catchupTarget(playlist, session, channel, programme, now);
          return target ? { ...programme, target } : programme;
        })
        .sort(
          (left, right) =>
            (left.startTimestamp ?? Number.MAX_SAFE_INTEGER) -
            (right.startTimestamp ?? Number.MAX_SAFE_INTEGER),
        );
      const current = items.find(
        (programme) =>
          programme.startTimestamp !== undefined &&
          programme.stopTimestamp !== undefined &&
          programme.startTimestamp <= now &&
          programme.stopTimestamp > now,
      );
      const nextAfter = current?.stopTimestamp ?? now;
      const next = items.find(
        (programme) =>
          programme !== current &&
          programme.startTimestamp !== undefined &&
          programme.startTimestamp >= nextAfter,
      );
      set({
        guides: {
          ...get().guides,
          [channel.id]: {
            state: items.length ? "loaded" : "empty",
            items,
            ...(current ? { current } : {}),
            ...(next ? { next } : {}),
            fetchedAt: Date.now(),
          },
        },
      });
    } catch (error) {
      if (!controller.signal.aborted && owned === generation) {
        set({
          guides: {
            ...get().guides,
            [channel.id]: { state: "failed", items: [], error: message(error) },
          },
        });
      }
    } finally {
      if (guideController === controller) {
        guideController = undefined;
        guideChannelId = "";
      }
    }
  },

  guideFor(channelId) {
    return get().guides[channelId] ?? emptyGuide();
  },

  async retry(frameKey) {
    if (frameKey === "categories:movie" || frameKey === "categories:series") {
      const kind = frameKey.slice("categories:".length) as LibraryKind;
      set({ categories: { ...get().categories, [kind]: emptyList() } });
      return get().loadCategories(kind);
    }
    if (frameKey === "search:movie" || frameKey === "search:series") {
      const kind = frameKey.slice("search:".length) as LibraryKind;
      loadedSearches.delete(`${selected ? selectionKey(selected) : ""}:${kind}`);
      set({ searchItems: { ...get().searchItems, [kind]: emptyList() } });
      return get().loadSearch(kind);
    }
    if (frameKey.startsWith("movie:") || frameKey.startsWith("series:")) {
      const categoryItems = { ...get().categoryItems };
      delete categoryItems[frameKey];
      set({ categoryItems });
      return get().loadCategory(frameKey);
    }
    if (frameKey.includes(":movie:")) {
      set({ movieDetails: { ...get().movieDetails, [frameKey]: { state: "empty" } } });
      return get().loadMovie(frameKey);
    }
    if (frameKey.includes(":series:")) {
      set({ seriesDetails: { ...get().seriesDetails, [frameKey]: { state: "empty" } } });
      return get().loadSeries(frameKey);
    }
  },

  clear() {
    abortRequests();
    selected = undefined;
    set({
      playlistId: "",
      sourceVersion: 0,
      categories: initialCategories(),
      categoryItems: {},
      searchItems: initialSearch(),
      movieDetails: {},
      seriesDetails: {},
      guides: {},
    });
  },
}));
