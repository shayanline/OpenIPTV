import { create } from "zustand";
import type { Channel } from "../types";
import { groupByCategory, parseM3U, UNCATEGORISED } from "../services/m3u";
import { legacyLineupOrderMode, useSettings, type Playlist } from "./settings";
import { usePersonal } from "./personal";
import { keys, read, remove, write } from "../services/store";
import * as disk from "../services/disk";
import { whenIdle } from "../services/idle";
import { cancelArtworkWork } from "../services/artwork";
import { translate, resolveLocale, type MessageKey } from "../services/locale";
import {
  adoptCatalogue,
  migrateLegacyOrder,
  prepareLineup,
  refreshCatalogue,
  type PreparedLineup,
  useLineup,
} from "./lineup";
import type { ProviderLineup } from "../services/lineup";
import {
  authenticateXtream,
  loadXtreamCategories,
  loadXtreamLive,
  restoreXtreamLiveAddress,
  XtreamRequestError,
  type XtreamAccount,
  type XtreamCategory,
  type XtreamSession,
} from "../services/xtream";
import type { PlaylistSource, XtreamSource } from "../services/playlistUrl";
import {
  assertPlaylistContent,
  PLAYLIST_ENTRY_MESSAGE,
  PlaylistEntryError,
  playlistEntryProblem,
  type PlaylistEntryProblem,
} from "../services/playlistEntry";
import { useLibrary } from "./library";

const LEGACY_PREFIX = "openiptv.cache.";
const SWEEP_STAMP = "openiptv.sweep";
const SWEEP_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cacheKey = (url: string) => `playlist:${url}`;
const stampKey = (url: string) => `openiptv.at.${url}`;
const validatorKey = (url: string) => `openiptv.validator.${url}`;

type PlaylistValidators = { etag?: string; lastModified?: string };
const playlistValidators = (url: string): PlaylistValidators => {
  try {
    const value = JSON.parse(read(validatorKey(url), "{}")) as PlaylistValidators;
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
};
const rememberPlaylistValidators = (url: string, response: Response) => {
  const etag = response.headers?.get("etag") ?? "";
  const lastModified = response.headers?.get("last-modified") ?? "";
  if (etag || lastModified) {
    write(
      validatorKey(url),
      JSON.stringify({
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {}),
      }),
    );
  }
};
const xtreamPrefix = (playlist: Pick<Playlist, "id" | "sourceVersion">) =>
  `xtream:${playlist.id}:v${playlist.sourceVersion}`;
const xtreamCacheKey = (playlist: Pick<Playlist, "id" | "sourceVersion">, scope: string) =>
  `${xtreamPrefix(playlist)}:${scope}`;
const xtreamStampKey = (playlist: Pick<Playlist, "id" | "sourceVersion">, scope: string) =>
  `openiptv.at.${xtreamCacheKey(playlist, scope)}`;
const XTREAM_SCOPES = ["account", "categories", "live"] as const;

export interface LoadResult {
  count: number;
  error: string;
  errorKey?: MessageKey;
  errorDetail?: string;
  cancelled?: boolean;
  problem?: PlaylistEntryProblem;
}

export type ProviderLoadResult = LoadResult & { provider?: ProviderLineup };

export interface ChannelCategory {
  key: string;
  name: string;
  channels: Channel[];
}

export interface ManagedCategory {
  key: string;
  name: string;
}

interface State {
  channels: Channel[];
  categories: ChannelCategory[];
  managedCategories: ManagedCategory[];
  loading: boolean;
  error: string;
  errorKey: MessageKey | "";
  errorDetail: string;
  accounts: Record<string, XtreamAccount>;
  load: (force?: boolean, refreshCached?: boolean) => Promise<LoadResult>;
  activatePlaylist: (
    id: string,
    refreshCached?: boolean,
  ) => Promise<LoadResult & { activated: boolean }>;
  validatePlaylist: (
    name: string,
    source: PlaylistSource,
    signal?: AbortSignal,
  ) => Promise<LoadResult>;
  refreshPlaylist: (playlist: Playlist) => Promise<ProviderLoadResult>;
  sweep: () => Promise<void>;
}

let inFlight: AbortController | null = null;
let requestToken = 0;
let channelSource = "";
let cancelPending: (() => void) | null = null;
const playlistRefreshes = new Map<string, Promise<ProviderLoadResult>>();
type ValidatedSource =
  | { source: PlaylistSource; kind: "m3u"; text: string }
  | { source: PlaylistSource; kind: "xtream"; session: XtreamSession };
let validatedSource: ValidatedSource | null = null;

const sameSource = (left: PlaylistSource, right: PlaylistSource) =>
  left.kind === right.kind &&
  (left.kind === "m3u"
    ? right.kind === "m3u" && left.url === right.url
    : right.kind === "xtream" &&
      left.server === right.server &&
      left.username === right.username &&
      left.password === right.password &&
      left.output === right.output);

const takeValidatedSource = (source: PlaylistSource) => {
  const held = validatedSource;
  validatedSource = null;
  if (!held || !sameSource(held.source, source)) return null;
  return held;
};

const requestUrl = (url: string) => {
  if (window.location.protocol !== "https:") return url;
  const request = new URL(url);
  if (request.protocol === "http:") request.protocol = "https:";
  return request.toString();
};

const failureDetail = (error: unknown, source: PlaylistSource) => {
  const detail = error instanceof Error ? error.message : String(error);
  if (
    source.kind === "xtream" &&
    (detail === "HTTP 404" || (error instanceof XtreamRequestError && error.status === 404))
  ) {
    return "The Xtream Player API returned HTTP 404. If the provider gave you a working get.php address, add it as an M3U source.";
  }
  const address = source.kind === "xtream" ? source.server : source.url;
  if (detail.includes(address) || /https?:\/\/|(?:username|password)=/i.test(detail)) {
    return "Failed to fetch";
  }
  if (
    window.location.protocol === "https:" &&
    new URL(address).protocol === "http:" &&
    !/^HTTP \d+$/.test(detail)
  ) {
    return translate(
      resolveLocale(useSettings.getState().locale),
      "playlist.browserTransportFailed",
    );
  }
  return detail;
};

const parseJSON = <T>(value: Blob | string | null): T | null => {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

const accountSummary = (value: unknown): XtreamAccount | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  const optionalNumber = (key: string) => {
    const candidate = saved[key];
    return typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0
      ? Math.floor(candidate)
      : undefined;
  };
  const expiresAt = optionalNumber("expiresAt");
  const activeConnections = optionalNumber("activeConnections");
  const createdAt = optionalNumber("createdAt");
  const maxConnections = optionalNumber("maxConnections");
  return {
    status: typeof saved.status === "string" ? saved.status : "",
    isTrial: saved.isTrial === true,
    ...(expiresAt ? { expiresAt } : {}),
    ...(activeConnections !== undefined ? { activeConnections } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(maxConnections !== undefined ? { maxConnections } : {}),
  };
};

const m3uCatalogue = (text: string) => {
  const channels = parseM3U(text);
  const categories = groupByCategory(channels).map((category) => ({
    key: category.name,
    ...category,
  }));
  return {
    channels,
    categories,
    managedCategories: categories.map(({ key, name }) => ({ key, name })),
    provider: {
      channels,
      categories: categories.map((category) => ({ ...category, kind: "live" as const })),
    },
  };
};

const liveCatalogue = (
  categories: XtreamCategory[],
  loaded: Channel[],
  source?: XtreamSource,
) => {
  const live = categories.filter((category) => category.kind === "live");
  const names = new Map(live.map((category) => [category.key, category.name]));
  const channels = loaded.map((channel) => ({
    ...(source ? restoreXtreamLiveAddress(source, channel) : channel),
    group: names.get(channel.xtream?.categoryKey ?? "") ?? UNCATEGORISED,
  }));
  const grouped = new Map<string, Channel[]>();
  for (const channel of channels) {
    const key = channel.xtream?.categoryKey ?? "live:";
    const members = grouped.get(key);
    if (members) members.push(channel);
    else grouped.set(key, [channel]);
  }
  const result: ChannelCategory[] = live.map((category) => ({
    key: category.key,
    name: category.name,
    channels: grouped.get(category.key) ?? [],
  }));
  for (const [key, members] of grouped) {
    if (!names.has(key)) result.push({ key, name: UNCATEGORISED, channels: members });
  }
  return {
    channels,
    categories: result,
    provider: {
      channels,
      categories: categories.map((category) => ({
        key: category.key,
        name: category.name,
        kind: category.kind,
        channels: category.kind === "live" ? (grouped.get(category.key) ?? []) : [],
        ...(category.count !== undefined ? { count: category.count } : {}),
      })),
    },
  };
};

const savedCurrent = (playlist: Playlist) => {
  const saved = useSettings.getState().playlists.find((item) => item.id === playlist.id);
  return !!saved && saved.sourceVersion === playlist.sourceVersion;
};

const staleRefresh = (): ProviderLoadResult => ({
  count: 0,
  error: translate(resolveLocale(useSettings.getState().locale), "remote.changeFailed"),
  errorKey: "remote.changeFailed",
});

export function readCachedProvider(playlist: Playlist): Promise<ProviderLineup | null> {
  return (async () => {
    try {
      if (playlist.source.kind === "m3u") {
        const cached = await disk.read(cacheKey(playlist.source.url));
        if (typeof cached !== "string" || !cached) return null;
        return await new Promise<ProviderLineup | null>((resolve) => {
          whenIdle(() => {
            try {
              const catalogue = m3uCatalogue(cached);
              resolve(catalogue.channels.length ? catalogue.provider : null);
            } catch {
              resolve(null);
            }
          }, 1000);
        });
      }
      const [categoriesRaw, liveRaw] = await Promise.all([
        disk.read(xtreamCacheKey(playlist, "categories")),
        disk.read(xtreamCacheKey(playlist, "live")),
      ]);
      return await new Promise<ProviderLineup | null>((resolve) => {
        whenIdle(() => {
          try {
            const categories = parseJSON<XtreamCategory[]>(categoriesRaw);
            const live = parseJSON<Channel[]>(liveRaw);
            const hasLibrary =
              Array.isArray(categories) &&
              categories.some(
                (category) => category.kind === "movie" || category.kind === "series",
              );
            if (
              !Array.isArray(categories) ||
              !Array.isArray(live) ||
              (!live.length && !hasLibrary)
            ) {
              resolve(null);
              return;
            }
            resolve(
              liveCatalogue(
                categories,
                live,
                playlist.source.kind === "xtream" ? playlist.source : undefined,
              ).provider,
            );
          } catch {
            resolve(null);
          }
        }, 1000);
      });
    } catch {
      return null;
    }
  })();
}

export const useChannels = create<State>((set, get) => {
  const adoptPersonal = (playlist: Playlist, channels: Channel[]) => {
    usePersonal
      .getState()
      .adoptLegacyPersonal(useSettings.getState().playlists, playlist.id, channels);
  };

  const adopt = async (
    playlist: Playlist,
    provider: ProviderLineup,
    prepared: Promise<PreparedLineup>,
  ) => {
    await adoptCatalogue(playlist, provider, prepared);
    const effective = useLineup.getState();
    return {
      channels: effective.channels,
      categories: effective.categories
        .filter((category) => category.kind === "live")
        .map(({ key, name, channels }) => ({ key, name, channels: channels.slice() })),
    };
  };

  const owns = (attempt: AbortController, token: number) =>
    inFlight === attempt && requestToken === token && !attempt.signal.aborted;

  const commit = (
    attempt: AbortController,
    token: number,
    state: Partial<
      Pick<
        State,
        | "channels"
        | "categories"
        | "managedCategories"
        | "loading"
        | "error"
        | "errorKey"
        | "errorDetail"
        | "accounts"
      >
    >,
  ) => {
    if (owns(attempt, token)) set(state);
  };

  const begin = () => {
    inFlight?.abort();
    const attempt = new AbortController();
    inFlight = attempt;
    requestToken += 1;
    return { attempt, token: requestToken };
  };

  const rememberCounts = (playlistId: string, categories: number, channels: number) => {
    const settings = useSettings.getState();
    settings.setPlaylistCategoryCount(playlistId, categories);
    settings.setPlaylistChannelCount(playlistId, channels);
  };

  const refreshStoredPlaylist = async (playlist: Playlist): Promise<ProviderLoadResult> => {
    try {
      if (playlist.source.kind === "m3u") {
        const response = await fetch(requestUrl(playlist.source.url), { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!savedCurrent(playlist)) return staleRefresh();
        const catalogue = m3uCatalogue(text);
        assertPlaylistContent(text, catalogue.channels.length);
        await disk.write(cacheKey(playlist.source.url), text, "catalogue");
        await refreshCatalogue(playlist, catalogue.provider, () => savedCurrent(playlist));
        if (!savedCurrent(playlist)) return staleRefresh();
        write(stampKey(playlist.source.url), String(Date.now()));
        rememberCounts(playlist.id, catalogue.categories.length, catalogue.channels.length);
        return { count: catalogue.channels.length, error: "", provider: catalogue.provider };
      }
      const session = await authenticateXtream(playlist.source);
      const [categories, live] = await Promise.all([
        loadXtreamCategories(session),
        loadXtreamLive(session, playlist.id),
      ]);
      if (!savedCurrent(playlist)) return staleRefresh();
      if (
        !live.length &&
        !categories.some((category) => category.kind === "movie" || category.kind === "series")
      ) {
        throw new Error("no playable content in that Xtream account");
      }
      await Promise.all([
        disk.write(
          xtreamCacheKey(playlist, "account"),
          JSON.stringify(session.account),
          "catalogue",
        ),
        disk.write(
          xtreamCacheKey(playlist, "categories"),
          JSON.stringify(categories),
          "catalogue",
        ),
        disk.write(xtreamCacheKey(playlist, "live"), JSON.stringify(live), "catalogue"),
      ]);
      if (!savedCurrent(playlist)) return staleRefresh();
      const provider = liveCatalogue(categories, live).provider;
      await refreshCatalogue(playlist, provider, () => savedCurrent(playlist));
      if (!savedCurrent(playlist)) return staleRefresh();
      for (const scope of XTREAM_SCOPES) {
        write(xtreamStampKey(playlist, scope), String(Date.now()));
      }
      rememberCounts(playlist.id, categories.length, live.length);
      set({ accounts: { ...get().accounts, [playlist.id]: session.account } });
      return { count: live.length, error: "", provider };
    } catch (error) {
      if (error instanceof PlaylistEntryError) {
        const key = PLAYLIST_ENTRY_MESSAGE[error.problem];
        return {
          count: 0,
          error: translate(resolveLocale(useSettings.getState().locale), key),
          errorKey: key,
          errorDetail: "",
        };
      }
      const detail = failureDetail(error, playlist.source);
      return {
        count: 0,
        error: `Could not load the playlist: ${detail}`,
        errorKey: "playlist.loadFailed",
        errorDetail: detail,
      };
    }
  };

  const reportFailure = (
    error: unknown,
    playlist: Playlist,
    attempt: AbortController,
    token: number,
  ): LoadResult => {
    if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
    const entryKey =
      error instanceof PlaylistEntryError ? PLAYLIST_ENTRY_MESSAGE[error.problem] : null;
    const detail = entryKey ? "" : failureDetail(error, playlist.source);
    const hasChannels = get().channels.length > 0;
    const errorKey: MessageKey =
      entryKey ?? (hasChannels ? "playlist.refreshFailed" : "playlist.loadFailed");
    const message = entryKey
      ? translate(resolveLocale(useSettings.getState().locale), entryKey)
      : hasChannels
        ? `Could not refresh: ${detail}. Showing the last saved copy.`
        : `Could not load the playlist: ${detail}`;
    commit(attempt, token, { loading: false, error: message, errorKey, errorDetail: detail });
    return { count: get().channels.length, error: message, errorKey, errorDetail: detail };
  };

  const refreshM3U = async (
    playlist: Playlist,
    known: string,
    attempt: AbortController,
    token: number,
    prepared: Promise<PreparedLineup>,
    validatedText?: string,
  ): Promise<LoadResult> => {
    if (playlist.source.kind !== "m3u") return { count: 0, error: "" };
    const url = playlist.source.url;
    try {
      let text = validatedText;
      if (text === undefined) {
        const validators = known ? playlistValidators(url) : {};
        const headers: Record<string, string> = {};
        if (validators.etag) headers["If-None-Match"] = validators.etag;
        if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;
        const response = await fetch(requestUrl(url), {
          cache: "no-cache",
          headers,
          signal: attempt.signal,
        });
        if (response.status === 304 && known) {
          write(stampKey(url), String(Date.now()));
          rememberCounts(playlist.id, get().categories.length, get().channels.length);
          commit(attempt, token, { loading: false, error: "", errorKey: "", errorDetail: "" });
          return { count: get().channels.length, error: "" };
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        rememberPlaylistValidators(url, response);
        text = await response.text();
      }
      if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
      if (known && text === known) {
        write(stampKey(url), String(Date.now()));
        rememberCounts(playlist.id, get().categories.length, get().channels.length);
        commit(attempt, token, { loading: false, error: "", errorKey: "", errorDetail: "" });
        return { count: get().channels.length, error: "" };
      }
      const catalogue = m3uCatalogue(text);
      assertPlaylistContent(text, catalogue.channels.length);
      adoptPersonal(playlist, catalogue.channels);
      const effective = await adopt(playlist, catalogue.provider, prepared);
      if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
      void disk.write(cacheKey(url), text, "catalogue");
      write(stampKey(url), String(Date.now()));
      rememberCounts(playlist.id, catalogue.categories.length, effective.channels.length);
      commit(attempt, token, {
        ...effective,
        managedCategories: catalogue.managedCategories,
        loading: false,
        error: "",
        errorKey: "",
        errorDetail: "",
      });
      return { count: effective.channels.length, error: "" };
    } catch (error) {
      return reportFailure(error, playlist, attempt, token);
    }
  };

  const refreshXtream = async (
    playlist: Playlist,
    attempt: AbortController,
    token: number,
    prepared: Promise<PreparedLineup>,
    validatedSession?: XtreamSession,
  ): Promise<LoadResult> => {
    if (playlist.source.kind !== "xtream") return { count: 0, error: "" };
    try {
      const session =
        validatedSession ?? (await authenticateXtream(playlist.source, attempt.signal));
      useLibrary.getState().adoptSession(playlist, session);
      const [categories, live] = await Promise.all([
        loadXtreamCategories(session, attempt.signal),
        loadXtreamLive(session, playlist.id, attempt.signal),
      ]);
      if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
      const hasLibrary = categories.some(
        (category) => category.kind === "movie" || category.kind === "series",
      );
      if (!live.length && !hasLibrary)
        throw new Error("no playable content in that Xtream account");
      const catalogue = liveCatalogue(categories, live);
      const managedCategories = categories.map(({ key, name }) => ({ key, name }));
      adoptPersonal(playlist, catalogue.channels);
      const effective = await adopt(playlist, catalogue.provider, prepared);
      if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
      void disk.write(
        xtreamCacheKey(playlist, "account"),
        JSON.stringify(session.account),
        "catalogue",
      );
      void disk.write(
        xtreamCacheKey(playlist, "categories"),
        JSON.stringify(categories),
        "catalogue",
      );
      void disk.write(xtreamCacheKey(playlist, "live"), JSON.stringify(live), "catalogue");
      for (const scope of XTREAM_SCOPES) {
        write(xtreamStampKey(playlist, scope), String(Date.now()));
      }
      rememberCounts(playlist.id, managedCategories.length, catalogue.channels.length);
      commit(attempt, token, {
        ...effective,
        managedCategories,
        accounts: { ...get().accounts, [playlist.id]: session.account },
        loading: false,
        error: "",
        errorKey: "",
        errorDetail: "",
      });
      return { count: catalogue.channels.length, error: "" };
    } catch (error) {
      return reportFailure(error, playlist, attempt, token);
    }
  };

  return {
    channels: [],
    categories: [],
    managedCategories: [],
    loading: false,
    error: "",
    errorKey: "",
    errorDetail: "",
    accounts: {},

    async validatePlaylist(_name, source, signal?: AbortSignal): Promise<LoadResult> {
      validatedSource = null;
      if (signal?.aborted) return { count: 0, error: "", cancelled: true };
      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 15_000);
      const onCallerAbort = () => controller.abort();
      signal?.addEventListener("abort", onCallerAbort, { once: true });
      const abortReason = () =>
        timedOut
          ? new PlaylistEntryError("timeout")
          : new DOMException("Aborted", "AbortError");
      try {
        if (source.kind === "xtream") {
          const session = await authenticateXtream(source, controller.signal);
          if (controller.signal.aborted) throw abortReason();
          const account = session.account;
          const expired =
            /^(expired|disabled|banned)$/i.test(account.status.trim()) ||
            (account.expiresAt !== undefined && account.expiresAt * 1000 < Date.now());
          if (expired) throw new PlaylistEntryError("expired");
          validatedSource = { source, kind: "xtream", session };
          return { count: 1, error: "" };
        }
        const response = await fetch(requestUrl(source.url), {
          cache: "no-cache",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        const count = parseM3U(text).length;
        assertPlaylistContent(text, count);
        if (controller.signal.aborted) throw abortReason();
        validatedSource = { source, kind: "m3u", text };
        return { count, error: "" };
      } catch (error) {
        if (signal?.aborted || (!timedOut && controller.signal.aborted)) {
          return { count: 0, error: "", cancelled: true };
        }
        const problem = timedOut ? "timeout" : playlistEntryProblem(error);
        let key = PLAYLIST_ENTRY_MESSAGE[problem];
        const address = source.kind === "xtream" ? source.server : source.url;
        if (
          problem === "network" &&
          window.location.protocol === "https:" &&
          !(error instanceof Error && /^HTTP \d+$/.test(error.message))
        ) {
          try {
            if (new URL(address).protocol === "http:") {
              key = "playlist.browserTransportFailed";
            }
          } catch {
            // An address without a scheme cannot be mixed content; keep the entry message.
          }
        }
        const locale = resolveLocale(useSettings.getState().locale);
        return {
          count: 0,
          error: translate(locale, key),
          errorKey: key,
          problem,
        };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onCallerAbort);
      }
    },

    async refreshPlaylist(playlist): Promise<LoadResult> {
      const key = `${playlist.id}:v${playlist.sourceVersion}`;
      const held = playlistRefreshes.get(key);
      if (held) return held;
      const request = refreshStoredPlaylist(playlist).finally(() => {
        if (playlistRefreshes.get(key) === request) playlistRefreshes.delete(key);
      });
      playlistRefreshes.set(key, request);
      return request;
    },

    async activatePlaylist(
      id,
      refreshCached = true,
    ): Promise<LoadResult & { activated: boolean }> {
      const playlist = useSettings.getState().playlists.find((item) => item.id === id);
      if (!playlist) return { activated: false, count: get().channels.length, error: "" };
      cancelPending?.();
      cancelPending = null;
      inFlight?.abort();
      cancelArtworkWork();
      useLibrary.getState().selectPlaylist(undefined);
      useSettings.getState().set("activePlaylistId", playlist.id);
      useLibrary.getState().selectPlaylist(playlist);
      const result = await get().load(false, refreshCached);
      return { ...result, activated: true };
    },

    async load(force = false, refreshCached = false): Promise<LoadResult> {
      cancelPending?.();
      cancelPending = null;
      const { attempt, token } = begin();
      const playlist = useSettings.getState().activePlaylist();
      if (!playlist) {
        channelSource = "";
        commit(attempt, token, {
          channels: [],
          categories: [],
          managedCategories: [],
          loading: false,
          error: "",
          errorKey: "",
          errorDetail: "",
        });
        return { count: 0, error: "" };
      }

      const prepared = prepareLineup(playlist);
      const validated = takeValidatedSource(playlist.source);
      const identity =
        playlist.source.kind === "m3u" ? `m3u:${playlist.source.url}` : xtreamPrefix(playlist);
      const switching = channelSource !== identity;
      channelSource = identity;
      commit(attempt, token, {
        ...(switching ? { channels: [], categories: [], managedCategories: [] } : {}),
        loading: true,
        error: "",
        errorKey: "",
        errorDetail: "",
      });

      if (playlist.source.kind === "m3u") {
        const url = playlist.source.url;
        const cached = force ? null : await disk.read(cacheKey(url));
        if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
        if (typeof cached === "string" && cached) {
          const catalogue = m3uCatalogue(cached);
          let usableCache = false;
          try {
            assertPlaylistContent(cached, catalogue.channels.length);
            usableCache = true;
          } catch {
            usableCache = false;
          }
          if (usableCache) {
            adoptPersonal(playlist, catalogue.channels);
            const effective = await adopt(playlist, catalogue.provider, prepared);
            if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
            rememberCounts(playlist.id, catalogue.categories.length, effective.channels.length);
            commit(attempt, token, {
              ...effective,
              managedCategories: catalogue.managedCategories,
              loading: false,
              error: "",
              errorKey: "",
              errorDetail: "",
            });
            if (refreshCached) {
              return refreshM3U(
                playlist,
                cached,
                attempt,
                token,
                prepared,
                validated?.kind === "m3u" ? validated.text : undefined,
              );
            }
            const at = Number(read(stampKey(url))) || 0;
            if (Date.now() - at < CACHE_TTL_MS) {
              return { count: catalogue.channels.length, error: "" };
            }
            cancelPending = whenIdle(() => {
              cancelPending = null;
              void refreshM3U(playlist, cached, attempt, token, prepared);
            }, 4000);
            return { count: catalogue.channels.length, error: "" };
          }
        }
        return refreshM3U(
          playlist,
          "",
          attempt,
          token,
          prepared,
          validated?.kind === "m3u" ? validated.text : undefined,
        );
      }

      const cached = force
        ? [null, null, null]
        : await Promise.all(
            XTREAM_SCOPES.map((scope) => disk.read(xtreamCacheKey(playlist, scope))),
          );
      if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
      const account = accountSummary(parseJSON(cached[0]));
      const categories = parseJSON<XtreamCategory[]>(cached[1]);
      const live = parseJSON<Channel[]>(cached[2]);
      const hasLibrary =
        Array.isArray(categories) &&
        categories.some((category) => category.kind === "movie" || category.kind === "series");
      if (
        account &&
        Array.isArray(categories) &&
        Array.isArray(live) &&
        (live.length || hasLibrary)
      ) {
        const catalogue = liveCatalogue(categories, live, playlist.source);
        const managedCategories = categories.map(({ key, name }) => ({ key, name }));
        adoptPersonal(playlist, catalogue.channels);
        const effective = await adopt(playlist, catalogue.provider, prepared);
        if (!owns(attempt, token)) return { count: get().channels.length, error: "" };
        rememberCounts(playlist.id, managedCategories.length, catalogue.channels.length);
        commit(attempt, token, {
          ...effective,
          managedCategories,
          accounts: { ...get().accounts, [playlist.id]: account },
          loading: false,
          error: "",
          errorKey: "",
          errorDetail: "",
        });
        if (refreshCached) {
          return refreshXtream(
            playlist,
            attempt,
            token,
            prepared,
            validated?.kind === "xtream" ? validated.session : undefined,
          );
        }
        const fresh = XTREAM_SCOPES.every(
          (scope) =>
            Date.now() - (Number(read(xtreamStampKey(playlist, scope))) || 0) < CACHE_TTL_MS,
        );
        if (fresh) return { count: catalogue.channels.length, error: "" };
        cancelPending = whenIdle(() => {
          cancelPending = null;
          void refreshXtream(playlist, attempt, token, prepared);
        }, 4000);
        return { count: catalogue.channels.length, error: "" };
      }
      return refreshXtream(
        playlist,
        attempt,
        token,
        prepared,
        validated?.kind === "xtream" ? validated.session : undefined,
      );
    },

    async sweep(): Promise<void> {
      const lastSweep = Number(read(SWEEP_STAMP)) || 0;
      if (Date.now() - lastSweep < SWEEP_TTL_MS) return;
      const playlists = useSettings.getState().playlists;
      const legacyOrder = legacyLineupOrderMode();
      if (legacyOrder) {
        for (const playlist of playlists) {
          if (playlist.id === useLineup.getState().playlistId) continue;
          try {
            await migrateLegacyOrder(playlist, legacyOrder);
          } catch {
            break;
          }
        }
      }
      const wantedM3U = new Set(
        playlists
          .filter((playlist) => playlist.source.kind === "m3u")
          .map((playlist) => cacheKey((playlist.source as { kind: "m3u"; url: string }).url)),
      );
      const wantedXtream = playlists
        .filter((playlist) => playlist.source.kind === "xtream")
        .map((playlist) => `${xtreamPrefix(playlist)}:`);
      await disk.forget(
        (key) =>
          (key.startsWith("playlist:") && !wantedM3U.has(key)) ||
          (key.startsWith("xtream:") && !wantedXtream.some((prefix) => key.startsWith(prefix))),
      );

      for (const key of keys()) {
        if (key.startsWith(LEGACY_PREFIX)) remove(key);
      }
      const wantedStamps = new Set<string>();
      const wantedValidators = new Set<string>();
      const wantedXtreamStamps: string[] = [];
      for (const playlist of playlists) {
        if (playlist.source.kind === "m3u") {
          wantedStamps.add(stampKey(playlist.source.url));
          wantedValidators.add(validatorKey(playlist.source.url));
        } else wantedXtreamStamps.push(`openiptv.at.${xtreamPrefix(playlist)}:`);
      }
      for (const key of keys()) {
        if (
          (key.startsWith("openiptv.at.") &&
            !wantedStamps.has(key) &&
            !wantedXtreamStamps.some((prefix) => key.startsWith(prefix))) ||
          (key.startsWith("openiptv.validator.") && !wantedValidators.has(key))
        )
          remove(key);
      }
      write(SWEEP_STAMP, String(Date.now()));
    },
  };
});

export async function clearPlaylistCache(playlist: Playlist): Promise<void> {
  const diskPrefix = `xtream:${playlist.id}:`;
  await disk.forget((key) =>
    playlist.source.kind === "m3u"
      ? key === cacheKey(playlist.source.url)
      : key.startsWith(diskPrefix),
  );
  for (const key of keys()) {
    const owned =
      playlist.source.kind === "m3u"
        ? key === stampKey(playlist.source.url) || key === validatorKey(playlist.source.url)
        : key.startsWith(`openiptv.at.${diskPrefix}`);
    if (owned) remove(key);
  }
  const accounts = { ...useChannels.getState().accounts };
  delete accounts[playlist.id];
  useChannels.setState({ accounts });
}

export async function clearCache(): Promise<void> {
  cancelPending?.();
  cancelPending = null;
  inFlight?.abort();
  inFlight = null;
  requestToken += 1;
  await disk.forgetAll();
  for (const key of keys()) {
    if (
      key === SWEEP_STAMP ||
      key.startsWith(LEGACY_PREFIX) ||
      key.startsWith("openiptv.at.") ||
      key.startsWith("openiptv.validator.")
    )
      remove(key);
  }
}
