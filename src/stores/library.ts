import { create } from "zustand";
import { read as readDisk, write as writeDisk } from "../services/disk";
import { whenIdle } from "../services/idle";
import { read, write } from "../services/store";
import {
  authenticateXtream,
  buildXtreamCatchupUrl,
  buildXtreamEpisodeUrl,
  buildXtreamMovieUrl,
  directSourceFingerprint,
  loadXtreamCategories,
  loadXtreamGuide,
  loadXtreamMovieDetail,
  loadXtreamMovies,
  loadXtreamSeries,
  loadXtreamSeriesDetail,
  XtreamRequestError,
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
import type { Channel, PlaybackProgressSeed, PlaybackTarget } from "../types";
import type { Playlist } from "./settings";
import {
  type FavouriteSnapshot,
  type LastPlayed,
  type PlaybackProgress,
  type ResolvedPlaybackProgress,
  usePersonal,
} from "./personal";
import { adoptCategorySummaries, orderedCategoryItems, useLineup } from "./lineup";

export type LibraryKind = Exclude<XtreamContentKind, "live">;
export type LibraryItem = XtreamMovie | XtreamSeries;
export type LibraryLoadState = "loading" | "loaded" | "empty" | "failed" | "too-large";
export type LibraryError =
  | "authentication"
  | "permission"
  | "malformed"
  | "too-large"
  | "network";

export type LibraryResource<T> = {
  state: "idle" | "loading" | "loaded" | "empty" | "failed";
  value: T;
  stale: boolean;
  error?: LibraryError;
};

export type VodCategoryRow = {
  key: string;
  source: "continue" | "favourites" | "all" | "provider";
  name: string;
  count: number;
};

export interface SeriesContinueTarget {
  episode: XtreamEpisode;
  resumeAt: number;
  remainingSeconds?: number;
  reason: "resume" | "next" | "first" | "restart-series";
}

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
  loadCategory: {
    (categoryKey: string): Promise<void>;
    (kind: LibraryKind, categoryKey: string): Promise<void>;
  };
  loadIndex: (kind: LibraryKind, reason: "all" | "search") => Promise<void>;
  loadSearch: (kind: LibraryKind) => Promise<void>;
  loadMovie: (movieKey: string) => Promise<void>;
  loadSeries: (seriesKey: string) => Promise<void>;
  categoriesFor: (kind: LibraryKind) => VodCategoryRow[];
  itemsFor: (kind: LibraryKind, categoryKey: string) => LibraryResource<LibraryItem[]>;
  progressSeedFor: (
    item: XtreamMovie | XtreamEpisode,
    parent?: XtreamSeries,
  ) => PlaybackProgressSeed | null;
  continueWatchingFor: (playlistId: string, kind: LibraryKind) => ResolvedPlaybackProgress[];
  seriesContinueFor: (
    detail: XtreamSeriesDetail,
    lastPlayed: LastPlayed | null,
  ) => SeriesContinueTarget | null;
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
const staleResources = new Set<string>();
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

/**
 * A catalogue that outgrew its response ceiling ends in its own terminal state, so the row
 * can tell "too big to hold" apart from "failed to answer".
 */
function listFailure(error: unknown): LibraryLoadState {
  return error instanceof XtreamRequestError && error.reason === "too-large"
    ? "too-large"
    : "failed";
}

function categoryId(categoryKey: string, kind: LibraryKind): string {
  return categoryKey.startsWith(`${kind}:`) ? categoryKey.slice(kind.length + 1) : "";
}

function libraryItem(itemKey: string): LibraryItem | undefined {
  const state = useLibrary.getState();
  for (const frame of [
    ...Object.values(state.categoryItems),
    ...Object.values(state.searchItems),
  ]) {
    const item = frame.items.find((candidate) => candidate.key === itemKey);
    if (item) return item;
  }
  return undefined;
}

function providerId(itemKey: string, kind: LibraryKind): string {
  const item = libraryItem(itemKey);
  if (item) {
    return kind === "movie" ? (item as XtreamMovie).streamId : (item as XtreamSeries).seriesId;
  }
  const personal = usePersonal.getState();
  const progress = personal.progress.find(
    (entry): entry is ResolvedPlaybackProgress =>
      !("legacyOrder" in entry) &&
      (kind === "movie"
        ? entry.kind === "movie" && entry.itemKey === itemKey
        : entry.kind === "episode" && entry.parentKey === itemKey),
  );
  const progressProvider = kind === "movie" ? progress?.providerId : progress?.parentProviderId;
  const favourite = personal.favourites.find(
    (item) => item.itemKey === itemKey && item.kind === kind,
  );
  if (progressProvider || favourite?.providerId) {
    return progressProvider ?? favourite?.providerId ?? "";
  }
  if (kind === "movie" && (progress?.directSourceFingerprint || favourite?.providerId === "")) {
    return "";
  }
  const prefix = selected ? `xtream:${selected.id}:${kind}:` : "";
  return prefix && itemKey.startsWith(prefix) ? itemKey.slice(prefix.length) : "";
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
  staleResources.clear();
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
  /* A valid direct source is the provider's own address and beats a generated one. */
  if (item.directSource) return item.directSource;
  const session = await sessionFor(playlist);
  if ("streamId" in item) {
    return buildXtreamMovieUrl(session, item.streamId, item.extension);
  }
  if (!item.episodeId) throw new Error("This episode has no playable stream address");
  return buildXtreamEpisodeUrl(session, item.episodeId, item.extension);
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
  const id = `xtream:${playlist.id}:catchup:${metadata.streamId}:${programme.id}`;
  return {
    id,
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
    progress: {
      itemKey: id,
      playlistId: playlist.id,
      kind: "catchup",
      categoryKey: metadata.categoryKey,
      name: programme.title,
      logo: channel.logo,
    },
  };
}

/** What a movie index knows about one item, as the seed a progress record can be built from. */
const movieSeed = (playlistId: string, movie: XtreamMovie): PlaybackProgressSeed => {
  const fingerprint = directSourceFingerprint(movie.directSource);
  return {
    itemKey: movie.key,
    playlistId,
    kind: "movie",
    ...(movie.streamId ? { providerId: movie.streamId } : {}),
    ...(fingerprint ? { directSourceFingerprint: fingerprint } : {}),
    categoryKey: movie.categoryKey,
    ...(movie.extension !== undefined ? { extension: movie.extension } : {}),
    name: movie.name,
    logo: movie.logo,
  };
};

const episodeSeed = (
  playlistId: string,
  parent: XtreamSeries,
  episode: XtreamEpisode,
): PlaybackProgressSeed => ({
  itemKey: episode.key,
  legacyItemKeys: [`xtream:${playlistId}:episode:${episode.episodeIdentity}`],
  playlistId,
  kind: "episode",
  ...(episode.episodeId !== undefined ? { providerId: episode.episodeId } : {}),
  episodeIdentity: episode.episodeIdentity,
  ...(episode.directSourceFingerprint !== undefined
    ? { directSourceFingerprint: episode.directSourceFingerprint }
    : {}),
  categoryKey:
    !parent.categoryKey || parent.categoryKey === "series:"
      ? "series:__none__"
      : parent.categoryKey,
  ...(episode.extension !== undefined ? { extension: episode.extension } : {}),
  name: episode.name,
  logo: parent.logo,
  parentKey: parent.key,
  parentProviderId: parent.seriesId,
  parentName: parent.name,
  ...(episode.season !== undefined ? { season: episode.season } : {}),
  ...(episode.number !== undefined ? { episode: episode.number } : {}),
});

function summaryMovieDetail(movie: XtreamMovie): XtreamMovieDetail {
  return {
    ...movie,
    plot: "",
    cast: "",
    director: "",
    genre: "",
    releaseDate: movie.year,
    metadata: {
      backdrops: [],
      rating: movie.rating,
      cast: [],
      director: "",
      genre: "",
      releaseDate: movie.year,
      country: "",
      ageRating: "",
    },
  };
}

function seedFor(
  playlistId: string,
  item: XtreamMovie | XtreamEpisode,
  parent?: XtreamSeries,
): PlaybackProgressSeed | null {
  if ("streamId" in item) {
    return item.streamId || directSourceFingerprint(item.directSource)
      ? movieSeed(playlistId, item)
      : null;
  }
  if (!parent || (!item.episodeId && !item.directSourceFingerprint)) return null;
  return episodeSeed(playlistId, parent, item);
}

function continueWatching(
  progress: readonly PlaybackProgress[],
  playlistId: string,
  kind: LibraryKind,
): ResolvedPlaybackProgress[] {
  const resolved = progress.filter(
    (entry): entry is ResolvedPlaybackProgress =>
      !("legacyOrder" in entry) &&
      entry.playlistId === playlistId &&
      (kind === "movie" ? entry.kind === "movie" : entry.kind === "episode"),
  );
  if (kind === "movie") return resolved.sort((left, right) => right.updatedAt - left.updatedAt);
  const parents = new Map<string, ResolvedPlaybackProgress>();
  for (const entry of resolved) {
    const key = entry.parentKey;
    if (!key) continue;
    const previous = parents.get(key);
    if (!previous || previous.updatedAt < entry.updatedAt) parents.set(key, entry);
  }
  return [...parents.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

function playableEpisodes(detail: XtreamSeriesDetail): XtreamEpisode[] {
  return detail.episodes.filter(
    (episode) => !!episode.episodeId || !!episode.directSourceFingerprint,
  );
}

function continueForSeries(
  detail: XtreamSeriesDetail,
  lastPlayed: LastPlayed | null,
): SeriesContinueTarget | null {
  const episodes = playableEpisodes(detail);
  if (!episodes.length) return null;
  const progress = usePersonal
    .getState()
    .progress.filter(
      (entry): entry is ResolvedPlaybackProgress =>
        !("legacyOrder" in entry) &&
        entry.kind === "episode" &&
        entry.parentKey === detail.key &&
        episodes.some((episode) => episode.key === entry.itemKey),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (progress) {
    const episode = episodes.find((candidate) => candidate.key === progress.itemKey);
    if (episode) {
      return {
        episode,
        resumeAt: progress.seconds,
        ...(progress.duration !== undefined
          ? { remainingSeconds: Math.max(0, progress.duration - progress.seconds) }
          : {}),
        reason: "resume",
      };
    }
  }
  if (lastPlayed?.kind === "episode") {
    const index = episodes.findIndex((episode) => episode.key === lastPlayed.itemKey);
    if (index >= 0 && index + 1 < episodes.length) {
      return { episode: episodes[index + 1], resumeAt: 0, reason: "next" };
    }
    if (index === episodes.length - 1) {
      return { episode: episodes[0], resumeAt: 0, reason: "restart-series" };
    }
  }
  return { episode: episodes[0], resumeAt: 0, reason: "first" };
}

function resourceError(frame: LibraryList<unknown>): LibraryError | undefined {
  if (frame.state === "too-large") return "too-large";
  if (frame.state !== "failed") return undefined;
  const error = frame.error ?? "";
  if (/HTTP 401|authentication/i.test(error)) return "authentication";
  if (/HTTP 403|permission/i.test(error)) return "permission";
  if (/JSON|malformed/i.test(error)) return "malformed";
  return "network";
}

function favouriteItem(snapshot: FavouriteSnapshot): LibraryItem {
  if (snapshot.kind === "movie") {
    return {
      key: snapshot.itemKey,
      streamId: snapshot.providerId,
      categoryKey: snapshot.categoryKey,
      name: snapshot.name,
      logo: snapshot.logo,
      ...(snapshot.extension ? { extension: snapshot.extension } : {}),
      directSource: "",
      year: "",
      rating: "",
    };
  }
  return {
    key: snapshot.itemKey,
    seriesId: snapshot.providerId,
    categoryKey: snapshot.categoryKey,
    name: snapshot.name,
    logo: snapshot.logo,
    year: "",
    rating: "",
  };
}

function progressItem(entry: ResolvedPlaybackProgress): LibraryItem | null {
  if (entry.kind === "movie" && (entry.providerId || entry.directSourceFingerprint)) {
    return {
      key: entry.itemKey,
      streamId: entry.providerId ?? "",
      categoryKey: entry.categoryKey,
      name: entry.name,
      logo: entry.logo,
      ...(entry.extension ? { extension: entry.extension } : {}),
      directSource: "",
      year: "",
      rating: "",
    };
  }
  if (entry.kind === "episode" && entry.parentKey && entry.parentProviderId) {
    return {
      key: entry.parentKey,
      seriesId: entry.parentProviderId,
      categoryKey: entry.categoryKey,
      name: entry.parentName ?? entry.name,
      logo: entry.logo,
      year: "",
      rating: "",
    };
  }
  return null;
}

/** Resolve the movie records a complete index can prove, and drop the ones it disproves. */
function resolveMovieProgress(playlist: Playlist, items: readonly XtreamMovie[]) {
  const personal = usePersonal.getState();
  personal.resolveLegacyProgress(items.map((movie) => movieSeed(playlist.id, movie)));
  personal.removeAbsentLegacyProgress(
    playlist.id,
    "movie",
    new Set(items.map((movie) => movie.key)),
  );
}

/** Resolve the episode records one loaded series detail can prove; it proves nothing absent. */
function resolveEpisodeProgress(playlist: Playlist, detail: XtreamSeriesDetail) {
  usePersonal
    .getState()
    .resolveLegacyProgress(
      detail.episodes.map((episode) => episodeSeed(playlist.id, detail, episode)),
    );
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
      const key = `${cachePrefix(playlist)}:categories`;
      let showingCache = false;
      set({ categories: { ...get().categories, [kind]: { state: "loading", items: [] } } });
      const refresh = async () => {
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const session = await sessionFor(playlist);
          const all = await loadXtreamCategories(session, controller.signal);
          if (owned !== generation || controller.signal.aborted) return;
          await adoptCategorySummaries(
            playlist,
            all
              .filter((category) => category.kind === "movie" || category.kind === "series")
              .map((category) => ({ ...category, channels: [] })),
          );
          if (owned !== generation || controller.signal.aborted) return;
          const next = { ...get().categories };
          for (const contentKind of ["movie", "series"] as const) {
            const items = all.filter((category) => category.kind === contentKind);
            next[contentKind] = { state: items.length ? "loaded" : "empty", items };
          }
          set({ categories: next });
          void writeDisk(key, JSON.stringify(all), "catalogue");
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (owned === generation && !controller.signal.aborted && !showingCache) {
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
      };
      const fromCache = await cached<XtreamCategory[]>(key);
      if (owned !== generation) return;
      if (fromCache) {
        showingCache = true;
        await adoptCategorySummaries(
          playlist,
          fromCache
            .filter((category) => category.kind === "movie" || category.kind === "series")
            .map((category) => ({ ...category, channels: [] })),
        );
        if (owned !== generation) return;
        const items = fromCache.filter((category) => category.kind === kind);
        set({
          categories: {
            ...get().categories,
            [kind]: { state: items.length ? "loaded" : "empty", items },
          },
        });
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  async loadCategory(kindOrKey: LibraryKind | string, maybeKey?: string) {
    const playlist = selected;
    const categoryKey = maybeKey ?? kindOrKey;
    const kind: LibraryKind | undefined = maybeKey
      ? (kindOrKey as LibraryKind)
      : categoryKey.startsWith("movie:")
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
          staleResources.delete(categoryKey);
          void writeDisk(key, JSON.stringify(items), "catalogue");
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
        if (!fresh(key)) {
          staleResources.add(categoryKey);
          refreshWhenIdle(key, owned, refresh);
        }
        return;
      }
      await refresh();
    });
  },

  async loadIndex(kind, _reason) {
    return get().loadSearch(kind);
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
          if (kind === "movie" && !controller.signal.aborted && owned === generation) {
            resolveMovieProgress(playlist, items as XtreamMovie[]);
          }
          staleResources.delete(`${kind}:all`);
          void writeDisk(key, JSON.stringify(items), "catalogue");
          write(stampKey(key), String(Date.now()));
        } catch (error) {
          if (owned === generation && !controller.signal.aborted && !showingCache) {
            set({
              searchItems: {
                ...get().searchItems,
                [kind]: { state: listFailure(error), items: [], error: message(error) },
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
        if (kind === "movie") resolveMovieProgress(playlist, fromCache as XtreamMovie[]);
        if (!fresh(key)) {
          staleResources.add(`${kind}:all`);
          refreshWhenIdle(key, owned, refresh);
        }
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
      let id = providerId(movieKey, "movie");
      if (!id) {
        let summary = libraryItem(movieKey);
        if (!summary) {
          await get().loadIndex("movie", "all");
          if (owned !== generation) return;
          summary = libraryItem(movieKey);
        }
        if (summary && "streamId" in summary && summary.directSource) {
          set({
            movieDetails: {
              ...get().movieDetails,
              [movieKey]: { state: "loaded", value: summaryMovieDetail(summary) },
            },
          });
          return;
        }
        id = providerId(movieKey, "movie");
      }
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
          void writeDisk(key, JSON.stringify(value), "catalogue");
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
          resolveEpisodeProgress(playlist, value);
          void writeDisk(key, JSON.stringify(value), "catalogue");
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
        resolveEpisodeProgress(playlist, fromCache);
        if (!fresh(key)) refreshWhenIdle(key, owned, refresh);
        return;
      }
      await refresh();
    });
  },

  categoriesFor(kind) {
    const personal = usePersonal.getState();
    const rows: VodCategoryRow[] = [];
    const continued = continueWatching(personal.progress, get().playlistId, kind);
    if (continued.length) {
      rows.push({
        key: `${kind}:continue`,
        source: "continue",
        name: "Continue watching",
        count: continued.length,
      });
    }
    const favourites = personal.favourites.filter(
      (item) => item.playlistId === get().playlistId && item.kind === kind,
    );
    if (favourites.length) {
      rows.push({
        key: `${kind}:favourites`,
        source: "favourites",
        name: "Favourites",
        count: favourites.length,
      });
    }
    rows.push({
      key: `${kind}:all`,
      source: "all",
      name: "All",
      count: get().searchItems[kind].items.length,
    });
    const effective = useLineup.getState();
    const categories =
      effective.playlistId === get().playlistId
        ? effective.categories.filter((category) => category.kind === kind && !category.hidden)
        : get().categories[kind].items;
    for (const category of categories) {
      const provider = get().categories[kind].items.find((item) => item.key === category.key);
      rows.push({
        key: category.key,
        source: "provider",
        name: category.name,
        count: get().categoryItems[category.key]?.items.length ?? provider?.count ?? 0,
      });
    }
    return rows;
  },

  itemsFor(kind, categoryKey) {
    if (categoryKey === `${kind}:continue`) {
      const value = continueWatching(usePersonal.getState().progress, get().playlistId, kind)
        .map(progressItem)
        .filter((item): item is LibraryItem => item !== null);
      return { state: value.length ? "loaded" : "empty", value, stale: false };
    }
    if (categoryKey === `${kind}:favourites`) {
      const value = usePersonal
        .getState()
        .favourites.filter((item) => item.playlistId === get().playlistId && item.kind === kind)
        .map(favouriteItem);
      return { state: value.length ? "loaded" : "empty", value, stale: false };
    }
    const frame =
      categoryKey === `${kind}:all`
        ? get().searchItems[kind]
        : get().categoryItems[categoryKey];
    if (!frame) return { state: "idle", value: [], stale: false };
    return {
      state: frame.state === "too-large" ? "failed" : frame.state,
      value: orderedCategoryItems(
        categoryKey,
        frame.items,
        (item) => item.key,
        (item) => item.name,
      ),
      stale: staleResources.has(categoryKey),
      ...(resourceError(frame) ? { error: resourceError(frame) } : {}),
    };
  },

  progressSeedFor(item, parent) {
    return selected ? seedFor(selected.id, item, parent) : null;
  },

  continueWatchingFor(playlistId, kind) {
    return continueWatching(usePersonal.getState().progress, playlistId, kind);
  },

  seriesContinueFor(detail, lastPlayed) {
    return continueForSeries(detail, lastPlayed);
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
