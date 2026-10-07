import { create } from "zustand";
import { read, readJSON, remove, write } from "../services/store";
import type { Channel, PlaybackProgressSeed } from "../types";
import type { Playlist } from "./settings";

export type PersonalContentKind = "live" | "movie" | "series" | "episode" | "catchup";

export interface FavouriteSnapshot {
  itemKey: string;
  playlistId: string;
  kind: "live" | "movie" | "series";
  providerId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension?: string;
}

export interface LastPlayed {
  playlistId: string;
  kind: PersonalContentKind;
  itemKey: string;
  categoryKey: string;
}

export interface ResolvedPlaybackProgress {
  itemKey: string;
  playlistId: string;
  kind: "movie" | "episode" | "catchup";
  providerId?: string;
  episodeIdentity?: string;
  directSourceFingerprint?: string;
  categoryKey: string;
  extension?: string;
  seconds: number;
  duration?: number;
  updatedAt: number;
  name: string;
  logo: string;
  parentKey?: string;
  parentProviderId?: string;
  parentName?: string;
  season?: number;
  episode?: number;
}

export interface LegacyPlaybackProgress {
  itemKey: string;
  seconds: number;
  duration?: number;
  legacyOrder: number;
}

export type PlaybackProgress = ResolvedPlaybackProgress | LegacyPlaybackProgress;
export type ProgressSnapshot = PlaybackProgressSeed;
export type ProgressBoundary = "tick" | "pause" | "stop" | "hidden" | "target-change";

interface SavedPersonal {
  favourites: FavouriteSnapshot[];
  lastPlayed: LastPlayed | null;
  progress: PlaybackProgress[];
  /**
   * One timestamp captured the first time legacy records are read. Resolved legacy entries
   * are dated backwards from it, so they can never look newer than activity saved after the
   * migration. Removed once the last legacy record resolves or is deleted.
   */
  progressMigrationBaseTime?: number;
}

interface PersonalState extends SavedPersonal {
  unresolvedLast: boolean;
  toggleFavourite: (snapshot: FavouriteSnapshot) => void;
  rememberLast: (last: LastPlayed) => void;
  progressFor: (itemKey: string) => PlaybackProgress | undefined;
  /** Mark where the current viewing session began, so a restart cannot look like progress. */
  beginProgressSession: (itemKey: string, startSeconds: number) => void;
  rememberProgress: (
    snapshot: ProgressSnapshot,
    seconds: number,
    duration?: number,
    boundary?: ProgressBoundary,
    now?: number,
  ) => void;
  /** Turn legacy records into resolved ones using seeds from an authoritative catalogue load. */
  resolveLegacyProgress: (seeds: readonly ProgressSnapshot[]) => void;
  /** Delete legacy records an authoritative index has proved no longer exist. */
  removeAbsentLegacyProgress: (
    playlistId: string,
    kind: "movie",
    authoritativeItemKeys: ReadonlySet<string>,
  ) => void;
  completeProgress: (itemKey: string) => void;
  clearPlaylistPersonal: (playlistId: string) => void;
  adoptLegacyPersonal: (
    playlists: Playlist[],
    loadedPlaylistId: string,
    channels: Channel[],
  ) => void;
  hasRememberedLast: () => boolean;
  clearPersonal: () => void;
}

const KEY = "openiptv.personal";
const LEGACY_FAVOURITES_KEY = "openiptv.favourites";
const LEGACY_LAST_KEY = "openiptv.last";
const MAX_PROGRESS = 100;
const PROGRESS_STEP = 15;

const favouriteKinds = new Set(["live", "movie", "series"]);
const contentKinds = new Set(["live", "movie", "series", "episode", "catchup"]);
const loadedPlaylists = new Set<string>();
/** Where each viewing session started, so a restart keeps prior progress until it earns it. */
const sessionStarts = new Map<string, number>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function favouriteFrom(value: unknown): FavouriteSnapshot | null {
  if (!isRecord(value) || !favouriteKinds.has(String(value.kind))) return null;
  if (
    typeof value.itemKey !== "string" ||
    typeof value.playlistId !== "string" ||
    typeof value.providerId !== "string" ||
    typeof value.categoryKey !== "string" ||
    typeof value.name !== "string" ||
    typeof value.logo !== "string"
  ) {
    return null;
  }
  return {
    itemKey: value.itemKey,
    playlistId: value.playlistId,
    kind: value.kind as FavouriteSnapshot["kind"],
    providerId: value.providerId,
    categoryKey: value.categoryKey,
    name: value.name,
    logo: value.logo,
    ...(typeof value.extension === "string" ? { extension: value.extension } : {}),
  };
}

function lastFrom(value: unknown): LastPlayed | null {
  if (
    !isRecord(value) ||
    !contentKinds.has(String(value.kind)) ||
    typeof value.playlistId !== "string" ||
    typeof value.itemKey !== "string" ||
    typeof value.categoryKey !== "string"
  ) {
    return null;
  }
  return {
    playlistId: value.playlistId,
    kind: value.kind as PersonalContentKind,
    itemKey: value.itemKey,
    categoryKey: value.categoryKey,
  };
}

const resolvedProgressKinds = new Set(["movie", "episode", "catchup"]);

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function resolvedProgressFrom(value: unknown): ResolvedPlaybackProgress | null {
  if (!isRecord(value) || !resolvedProgressKinds.has(String(value.kind))) return null;
  if (
    typeof value.itemKey !== "string" ||
    typeof value.playlistId !== "string" ||
    typeof value.categoryKey !== "string" ||
    typeof value.name !== "string" ||
    typeof value.logo !== "string" ||
    typeof value.seconds !== "number" ||
    !Number.isFinite(value.seconds) ||
    value.seconds < 0 ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt)
  ) {
    return null;
  }
  return {
    itemKey: value.itemKey,
    playlistId: value.playlistId,
    kind: value.kind as ResolvedPlaybackProgress["kind"],
    ...(optionalString(value.providerId) !== undefined
      ? { providerId: optionalString(value.providerId) }
      : {}),
    ...(optionalString(value.episodeIdentity) !== undefined
      ? { episodeIdentity: optionalString(value.episodeIdentity) }
      : {}),
    ...(optionalString(value.directSourceFingerprint) !== undefined
      ? { directSourceFingerprint: optionalString(value.directSourceFingerprint) }
      : {}),
    categoryKey: value.categoryKey,
    ...(optionalString(value.extension) !== undefined
      ? { extension: optionalString(value.extension) }
      : {}),
    seconds: value.seconds,
    ...(optionalNumber(value.duration) !== undefined
      ? { duration: optionalNumber(value.duration) }
      : {}),
    updatedAt: value.updatedAt,
    name: value.name,
    logo: value.logo,
    ...(optionalString(value.parentKey) !== undefined
      ? { parentKey: optionalString(value.parentKey) }
      : {}),
    ...(optionalString(value.parentProviderId) !== undefined
      ? { parentProviderId: optionalString(value.parentProviderId) }
      : {}),
    ...(optionalString(value.parentName) !== undefined
      ? { parentName: optionalString(value.parentName) }
      : {}),
    ...(optionalNumber(value.season) !== undefined
      ? { season: optionalNumber(value.season) }
      : {}),
    ...(optionalNumber(value.episode) !== undefined
      ? { episode: optionalNumber(value.episode) }
      : {}),
  };
}

function legacyProgressFrom(value: unknown, index: number): LegacyPlaybackProgress | null {
  if (
    !isRecord(value) ||
    typeof value.itemKey !== "string" ||
    typeof value.seconds !== "number" ||
    !Number.isFinite(value.seconds) ||
    value.seconds < 0
  ) {
    return null;
  }
  return {
    itemKey: value.itemKey,
    seconds: value.seconds,
    ...(optionalNumber(value.duration) !== undefined
      ? { duration: optionalNumber(value.duration) }
      : {}),
    legacyOrder: optionalNumber(value.legacyOrder) ?? index,
  };
}

const isLegacyProgress = (entry: PlaybackProgress): entry is LegacyPlaybackProgress =>
  "legacyOrder" in entry;

function progressFrom(value: unknown, index: number): PlaybackProgress | null {
  if (isRecord(value) && typeof value.playlistId === "string") {
    return resolvedProgressFrom(value);
  }
  return legacyProgressFrom(value, index);
}

/**
 * The entry a progress boundary writes, or null when the seed cannot prove what it is.
 * A movie needs its provider id and category, an episode needs a category plus either a
 * provider id or a direct source fingerprint, and an idless episode never persists at all.
 */
function resolvedFromSeed(
  seed: ProgressSnapshot,
  seconds: number,
  duration: number | undefined,
  now: number,
): ResolvedPlaybackProgress | null {
  if (!seed.itemKey || !seed.playlistId || !seed.categoryKey) return null;
  if (seed.kind === "movie" && !seed.providerId && !seed.directSourceFingerprint) return null;
  if (
    seed.kind === "episode" &&
    (!seed.episodeIdentity || (!seed.providerId && !seed.directSourceFingerprint))
  ) {
    return null;
  }
  const { legacyItemKeys: _legacyItemKeys, ...persisted } = seed;
  return {
    ...persisted,
    seconds,
    ...(typeof duration === "number" && Number.isFinite(duration) ? { duration } : {}),
    updatedAt: now,
  };
}

function load(): SavedPersonal {
  const saved = readJSON<unknown>(KEY, {});
  if (!isRecord(saved)) return { favourites: [], lastPlayed: null, progress: [] };
  const favourites = Array.isArray(saved.favourites)
    ? saved.favourites.reduce<FavouriteSnapshot[]>((items, value) => {
        const favourite = favouriteFrom(value);
        if (
          favourite &&
          !items.some(
            (item) =>
              item.playlistId === favourite.playlistId && item.itemKey === favourite.itemKey,
          )
        ) {
          items.push(favourite);
        }
        return items;
      }, [])
    : [];
  const progress = Array.isArray(saved.progress)
    ? saved.progress.reduce<PlaybackProgress[]>((items, value, index) => {
        const entry = progressFrom(value, index);
        if (!entry) return items;
        /* The same key twice is one record: the later write is the one that survived. */
        const kept = items.filter((item) => item.itemKey !== entry.itemKey);
        kept.push(entry);
        return kept;
      }, [])
    : [];
  const trimmed = progress.slice(-MAX_PROGRESS);
  let progressMigrationBaseTime = optionalNumber(saved.progressMigrationBaseTime);
  /*
   * The base time is captured once, on the load that first meets legacy records, and written
   * straight back so an interrupted session cannot pick a different one next launch.
   */
  if (trimmed.some(isLegacyProgress) && progressMigrationBaseTime === undefined) {
    progressMigrationBaseTime = Date.now();
    persist({
      favourites,
      lastPlayed: lastFrom(saved.lastPlayed),
      progress: trimmed,
      progressMigrationBaseTime,
    });
  }
  if (!trimmed.some(isLegacyProgress)) progressMigrationBaseTime = undefined;
  return {
    favourites,
    lastPlayed: lastFrom(saved.lastPlayed),
    progress: trimmed,
    ...(progressMigrationBaseTime !== undefined ? { progressMigrationBaseTime } : {}),
  };
}

function legacyFavourites(): string[] {
  const saved = readJSON<unknown>(LEGACY_FAVOURITES_KEY, []);
  return Array.isArray(saved)
    ? saved.filter((value): value is string => typeof value === "string")
    : [];
}

function persist(
  state: Pick<
    PersonalState,
    "favourites" | "lastPlayed" | "progress" | "progressMigrationBaseTime"
  >,
) {
  write(
    KEY,
    JSON.stringify({
      favourites: state.favourites,
      lastPlayed: state.lastPlayed,
      progress: state.progress,
      ...(state.progressMigrationBaseTime !== undefined
        ? { progressMigrationBaseTime: state.progressMigrationBaseTime }
        : {}),
    }),
  );
}

function snapshotFor(playlistId: string, channel: Channel): FavouriteSnapshot {
  return {
    itemKey: channel.id,
    playlistId,
    kind: "live",
    providerId: channel.xtream?.streamId ?? channel.id,
    categoryKey: channel.xtream?.categoryKey ?? channel.categoryKey ?? channel.group,
    name: channel.name,
    logo: channel.logo,
  };
}

function legacyChannel(
  value: string,
  playlists: Playlist[],
  loadedPlaylistId: string,
  channels: Channel[],
): Channel | undefined {
  const exact = channels.find((channel) => channel.id === value);
  if (exact) return exact;
  const match = /^xtream:live:(.+)$/.exec(value);
  if (
    !match ||
    playlists.filter((playlist) => playlist.source.kind === "xtream").length !== 1
  ) {
    return undefined;
  }
  const only = playlists.find((playlist) => playlist.source.kind === "xtream");
  if (only?.id !== loadedPlaylistId) return undefined;
  return channels.find((channel) => channel.xtream?.streamId === match[1]);
}

export const usePersonal = create<PersonalState>((set, get) => ({
  ...load(),
  unresolvedLast: false,

  toggleFavourite(snapshot) {
    if (!favouriteKinds.has(snapshot.kind)) return;
    const matches = (item: FavouriteSnapshot) =>
      item.playlistId === snapshot.playlistId && item.itemKey === snapshot.itemKey;
    const next = get().favourites.some(matches)
      ? get().favourites.filter((item) => !matches(item))
      : [...get().favourites, snapshot];
    set({ favourites: next });
    persist(get());
  },

  rememberLast(last) {
    set({ lastPlayed: last });
    persist(get());
  },

  progressFor(itemKey) {
    return get().progress.find((entry) => entry.itemKey === itemKey);
  },

  beginProgressSession(itemKey, startSeconds) {
    sessionStarts.set(itemKey, startSeconds);
  },

  rememberProgress(snapshot, seconds, duration, boundary = "tick", now = Date.now()) {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const saved = get().progressFor(snapshot.itemKey);
    const startedAt = sessionStarts.get(snapshot.itemKey);
    if (
      saved &&
      !isLegacyProgress(saved) &&
      startedAt !== undefined &&
      startedAt < saved.seconds &&
      seconds < saved.seconds
    )
      return;
    /*
     * Ordinary ticks persist once the session has moved fifteen seconds from where it began
     * or from the last write. A restart begins a new session, so its first fifteen seconds
     * cannot overwrite the progress the viewer had already earned.
     */
    if (boundary === "tick") {
      const base = startedAt ?? saved?.seconds ?? 0;
      if (seconds - base < PROGRESS_STEP) return;
    }
    if (
      saved &&
      !isLegacyProgress(saved) &&
      saved.seconds === seconds &&
      saved.duration === duration
    )
      return;
    sessionStarts.set(snapshot.itemKey, seconds);
    const entry = resolvedFromSeed(snapshot, seconds, duration, now);
    if (!entry) return;
    const progress = [
      ...get().progress.filter((item) => item.itemKey !== snapshot.itemKey),
      entry,
    ].slice(-MAX_PROGRESS);
    set({
      progress,
      ...(progress.some(isLegacyProgress) ? {} : { progressMigrationBaseTime: undefined }),
    });
    persist(get());
  },

  resolveLegacyProgress(seeds) {
    const base = get().progressMigrationBaseTime;
    if (base === undefined || !seeds.length) return;
    const progress = [...get().progress];
    /*
     * legacyOrder is the index in the stored array, not the rank among the legacy records
     * still present, so a kept duplicate could carry a late index and land its updatedAt
     * after the base time. Ranking what survives keeps every migrated record older than
     * anything written after migration began.
     */
    const legacyRank = new Map<string, number>();
    let legacyCount = 0;
    for (const entry of progress) {
      if (isLegacyProgress(entry)) legacyRank.set(entry.itemKey, legacyCount++);
    }
    if (!legacyCount) return;
    let changed = false;
    for (const seed of seeds) {
      const itemKeys = new Set([seed.itemKey, ...(seed.legacyItemKeys ?? [])]);
      const index = progress.findIndex(
        (entry) => isLegacyProgress(entry) && itemKeys.has(entry.itemKey),
      );
      if (index === -1) continue;
      const record = progress[index] as LegacyPlaybackProgress;
      const rank = legacyRank.get(record.itemKey) ?? 0;
      const resolved = resolvedFromSeed(
        seed,
        record.seconds,
        record.duration,
        base - (legacyCount - rank) * 1000,
      );
      if (!resolved) continue;
      progress[index] = resolved;
      changed = true;
    }
    if (!changed) return;
    set({
      progress,
      ...(progress.some(isLegacyProgress) ? {} : { progressMigrationBaseTime: undefined }),
    });
    persist(get());
  },

  removeAbsentLegacyProgress(playlistId, kind, authoritativeItemKeys) {
    const prefix = `xtream:${playlistId}:${kind}:`;
    const progress = get().progress.filter(
      (entry) =>
        !isLegacyProgress(entry) ||
        !entry.itemKey.startsWith(prefix) ||
        authoritativeItemKeys.has(entry.itemKey),
    );
    if (progress.length === get().progress.length) return;
    set({
      progress,
      ...(progress.some(isLegacyProgress) ? {} : { progressMigrationBaseTime: undefined }),
    });
    persist(get());
  },

  completeProgress(itemKey) {
    sessionStarts.delete(itemKey);
    const progress = get().progress.filter((entry) => entry.itemKey !== itemKey);
    if (progress.length === get().progress.length) return;
    set({
      progress,
      ...(progress.some(isLegacyProgress) ? {} : { progressMigrationBaseTime: undefined }),
    });
    persist(get());
  },

  clearPlaylistPersonal(playlistId) {
    const prefix = `xtream:${playlistId}:`;
    for (const key of [...sessionStarts.keys()]) {
      if (key.startsWith(prefix)) sessionStarts.delete(key);
    }
    const progress = get().progress.filter((entry) => !entry.itemKey.startsWith(prefix));
    const next = {
      favourites: get().favourites.filter((item) => item.playlistId !== playlistId),
      lastPlayed: get().lastPlayed?.playlistId === playlistId ? null : get().lastPlayed,
      progress,
      ...(progress.some(isLegacyProgress)
        ? { progressMigrationBaseTime: get().progressMigrationBaseTime }
        : { progressMigrationBaseTime: undefined }),
    };
    set(next);
    persist(next);
  },

  adoptLegacyPersonal(playlists, loadedPlaylistId, channels) {
    const configured = new Set(playlists.map((playlist) => playlist.id));
    for (const playlistId of loadedPlaylists) {
      if (!configured.has(playlistId)) loadedPlaylists.delete(playlistId);
    }
    loadedPlaylists.add(loadedPlaylistId);
    const complete = playlists.every((playlist) => loadedPlaylists.has(playlist.id));

    const remainingFavourites: string[] = [];
    const adopted = [...get().favourites];
    for (const value of legacyFavourites()) {
      const channel = legacyChannel(value, playlists, loadedPlaylistId, channels);
      if (!channel) {
        if (!complete) remainingFavourites.push(value);
        continue;
      }
      if (!adopted.some((item) => item.itemKey === channel.id)) {
        adopted.push(snapshotFor(loadedPlaylistId, channel));
      }
    }

    const savedLast = read(LEGACY_LAST_KEY);
    let lastPlayed = get().lastPlayed;
    let unresolvedLast = get().unresolvedLast;
    if (savedLast && !lastPlayed) {
      const channel = legacyChannel(savedLast, playlists, loadedPlaylistId, channels);
      if (channel) {
        lastPlayed = {
          playlistId: loadedPlaylistId,
          kind: "live",
          itemKey: channel.id,
          categoryKey: channel.xtream?.categoryKey ?? channel.categoryKey ?? channel.group,
        };
        unresolvedLast = false;
        remove(LEGACY_LAST_KEY);
      } else if (complete) {
        unresolvedLast = true;
      }
    }
    if (savedLast && complete) remove(LEGACY_LAST_KEY);

    if (remainingFavourites.length) {
      write(LEGACY_FAVOURITES_KEY, JSON.stringify(remainingFavourites));
    } else {
      remove(LEGACY_FAVOURITES_KEY);
    }
    if (
      adopted.length !== get().favourites.length ||
      lastPlayed !== get().lastPlayed ||
      unresolvedLast !== get().unresolvedLast
    ) {
      set({ favourites: adopted, lastPlayed, unresolvedLast });
      persist(get());
    }
  },

  hasRememberedLast() {
    return !!get().lastPlayed || get().unresolvedLast || !!read(LEGACY_LAST_KEY);
  },

  clearPersonal() {
    loadedPlaylists.clear();
    sessionStarts.clear();
    remove(KEY);
    remove(LEGACY_FAVOURITES_KEY);
    remove(LEGACY_LAST_KEY);
    set({
      favourites: [],
      lastPlayed: null,
      progress: [],
      progressMigrationBaseTime: undefined,
      unresolvedLast: false,
    });
  },
}));
