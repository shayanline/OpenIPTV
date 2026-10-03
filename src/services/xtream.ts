import type { Channel } from "../types";
import { UNCATEGORISED } from "./m3u";
import type { XtreamOutput, XtreamSource } from "./playlistUrl";

export type XtreamContentKind = "live" | "movie" | "series";

export interface XtreamAccount {
  status: string;
  expiresAt?: number;
  isTrial: boolean;
  activeConnections?: number;
  createdAt?: number;
  maxConnections?: number;
}

export interface XtreamSession {
  server: string;
  username: string;
  password: string;
  output: XtreamOutput;
  streamOrigin: string;
  account: XtreamAccount;
}

export interface XtreamCategory {
  key: string;
  id: string;
  kind: XtreamContentKind;
  name: string;
  count?: number;
}

export interface XtreamMovie {
  key: string;
  streamId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension: string;
  year: string;
  rating: string;
}

export interface XtreamSeries {
  key: string;
  seriesId: string;
  categoryKey: string;
  name: string;
  logo: string;
  year: string;
  rating: string;
}

export interface XtreamEpisode {
  key: string;
  episodeId: string;
  seriesKey: string;
  season: number;
  number: number;
  name: string;
  extension: string;
  durationSeconds?: number;
}

export interface XtreamMovieDetail extends XtreamMovie {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  durationSeconds?: number;
}

export interface XtreamSeriesDetail extends XtreamSeries {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  episodes: XtreamEpisode[];
}

export interface XtreamProgramme {
  id: string;
  title: string;
  description: string;
  start: string;
  end: string;
  startTimestamp?: number;
  stopTimestamp?: number;
  archived: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

const number = (value: unknown): number | undefined => {
  if (value === "" || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const integer = (value: unknown): number | undefined => {
  const parsed = number(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
};

export const formatXtreamRating = (value: unknown): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(1) : "";
};

const browserUsesHttps = () =>
  typeof window !== "undefined" && window.location.protocol === "https:";

const applyBrowserTransport = (url: URL): URL => {
  if (browserUsesHttps() && url.protocol === "http:") url.protocol = "https:";
  return url;
};

const httpUrl = (value: string, base?: string): URL | null => {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return applyBrowserTransport(url);
  } catch {
    return null;
  }
};

const address = (value: unknown, base: string): string => {
  const url = httpUrl(text(value), base);
  return url?.toString() ?? "";
};

const endpoint = (
  server: string,
  username: string,
  password: string,
  action?: string,
  parameters: Record<string, string> = {},
): string => {
  const url = httpUrl(server);
  if (!url) throw new Error("invalid Xtream server origin");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/player_api.php`;
  url.search = "";
  url.hash = "";
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  if (action) url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url.toString();
};

const json = async (url: string, signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("Xtream returned malformed JSON");
  }
};

const api = (
  session: XtreamSession,
  action: string,
  parameters: Record<string, string> = {},
  signal?: AbortSignal,
) =>
  json(
    endpoint(session.server, session.username, session.password, action, parameters),
    signal,
  );

const configuredOrigin = (server: string): URL => {
  const url = httpUrl(server);
  if (!url) throw new Error("invalid Xtream server origin");
  return url;
};

const validPort = (value: unknown): string => {
  const port = text(value);
  if (!/^\d+$/.test(port)) return "";
  const parsed = Number(port);
  return parsed >= 1 && parsed <= 65535 ? String(parsed) : "";
};

const providerOrigin = (server: string, value: unknown): string => {
  const configured = configuredOrigin(server);
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new Error("Xtream authentication returned an invalid response");
  }
  const info = isRecord(value) ? value : {};
  const suppliedHost = text(info.url).trim();
  let supplied: URL | null = null;
  if (suppliedHost) {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(suppliedHost);
    supplied = httpUrl(hasScheme ? suppliedHost : `${configured.protocol}//${suppliedHost}`);
    if (!supplied) throw new Error("invalid Xtream stream origin");
  }

  const protocolField = text(info.server_protocol).replace(/:$/, "").toLowerCase();
  const providerProtocol =
    protocolField === "http" || protocolField === "https"
      ? `${protocolField}:`
      : (supplied?.protocol ?? configured.protocol);
  const protocol =
    browserUsesHttps() && providerProtocol === "http:" ? "https:" : providerProtocol;
  const hostname = supplied?.hostname || configured.hostname;
  const providerPort = validPort(protocol === "https:" ? info.https_port : info.port);
  const port = providerPort || supplied?.port || configured.port;
  const origin = new URL(`${protocol}//${hostname}`);
  if (port) origin.port = port;
  return origin.origin;
};

const optionalAccountNumber = (
  target: XtreamAccount,
  key: keyof XtreamAccount,
  value: unknown,
) => {
  const parsed = integer(value);
  if (parsed !== undefined) Object.assign(target, { [key]: parsed });
};

export async function authenticateXtream(
  source: XtreamSource,
  signal?: AbortSignal,
): Promise<XtreamSession> {
  const payload = await json(endpoint(source.server, source.username, source.password), signal);
  if (!isRecord(payload) || !isRecord(payload.user_info)) {
    throw new Error("Xtream authentication returned an invalid response");
  }
  const user = payload.user_info;
  if (Number(user.auth) !== 1) throw new Error("Xtream login was rejected");
  const status = text(user.status);
  const expiresAt = integer(user.exp_date);

  const account: XtreamAccount = {
    status,
    ...(expiresAt ? { expiresAt } : {}),
    isTrial: Number(user.is_trial) === 1,
  };
  optionalAccountNumber(account, "activeConnections", user.active_cons);
  optionalAccountNumber(account, "createdAt", user.created_at);
  optionalAccountNumber(account, "maxConnections", user.max_connections);

  return {
    server: applyBrowserTransport(configuredOrigin(source.server))
      .toString()
      .replace(/\/$/, ""),
    username: source.username,
    password: source.password,
    output: source.output,
    streamOrigin: providerOrigin(source.server, payload.server_info),
    account,
  };
}

const categories = (value: unknown, kind: XtreamContentKind): XtreamCategory[] => {
  const result: XtreamCategory[] = [];
  const seen = new Set<string>();
  for (const category of records(value)) {
    const id = text(category.category_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      key: `${kind}:${id}`,
      id,
      kind,
      name: text(category.category_name) || UNCATEGORISED,
      ...(integer(category.count) !== undefined ? { count: integer(category.count) } : {}),
    });
  }
  return result;
};

export async function loadXtreamCategories(
  session: XtreamSession,
  signal?: AbortSignal,
): Promise<XtreamCategory[]> {
  const [live, movies, series] = await Promise.all([
    api(session, "get_live_categories", {}, signal),
    api(session, "get_vod_categories", {}, signal),
    api(session, "get_series_categories", {}, signal),
  ]);
  return [
    ...categories(live, "live"),
    ...categories(movies, "movie"),
    ...categories(series, "series"),
  ];
}

const itemKey = (playlistId: string, kind: XtreamContentKind | "episode", id: string) =>
  `xtream:${playlistId}:${kind}:${id}`;

const pathUrl = (
  session: XtreamSession,
  kind: "live" | "movie" | "series",
  id: string,
  extension: string,
): string =>
  `${session.streamOrigin}/${kind}/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(id)}.${encodeURIComponent(extension)}`;

export const buildXtreamLiveUrl = (session: XtreamSession, streamId: string): string =>
  pathUrl(session, "live", streamId, session.output);

export const buildXtreamMovieUrl = (
  session: XtreamSession,
  streamId: string,
  extension: string,
): string => pathUrl(session, "movie", streamId, extension);

export const buildXtreamEpisodeUrl = (
  session: XtreamSession,
  episodeId: string,
  extension: string,
): string => pathUrl(session, "series", episodeId, extension);

export const buildXtreamCatchupUrl = (
  session: XtreamSession,
  streamId: string,
  durationMinutes: number,
  start: string,
): string => {
  const providerStart = start
    .slice(0, 16)
    .replace(" ", ":")
    .replace(/:/g, (match, offset) => (offset > 10 ? "-" : match));
  return `${session.streamOrigin}/timeshift/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(String(Math.floor(durationMinutes)))}/${encodeURIComponent(providerStart).replace(/%3A/gi, ":")}/${encodeURIComponent(streamId)}.ts`;
};

export async function loadXtreamLive(
  session: XtreamSession,
  playlistId: string,
  signal?: AbortSignal,
): Promise<Channel[]> {
  const payload = await api(session, "get_live_streams", {}, signal);
  const result: Channel[] = [];
  const seen = new Set<string>();
  for (const stream of records(payload)) {
    const streamId = text(stream.stream_id);
    if (!streamId || seen.has(streamId)) continue;
    seen.add(streamId);
    const categoryKey = `live:${text(stream.category_id)}`;
    const directSource = address(stream.direct_source, session.streamOrigin);
    result.push({
      id: itemKey(playlistId, "live", streamId),
      name: text(stream.name),
      logo: address(stream.stream_icon, session.streamOrigin),
      group: categoryKey,
      url: directSource || buildXtreamLiveUrl(session, streamId),
      quality: "",
      number: integer(stream.num) || result.length + 1,
      xtream: {
        playlistId,
        streamId,
        categoryKey,
        archiveDays: integer(stream.tv_archive_duration) ?? 0,
        directSource,
      },
    });
  }
  return result;
}

export async function loadXtreamMovies(
  session: XtreamSession,
  playlistId: string,
  categoryId: string,
  signal?: AbortSignal,
): Promise<XtreamMovie[]> {
  const payload = await api(
    session,
    "get_vod_streams",
    categoryId ? { category_id: categoryId } : {},
    signal,
  );
  const result: XtreamMovie[] = [];
  const seen = new Set<string>();
  for (const movie of records(payload)) {
    const streamId = text(movie.stream_id);
    if (!streamId || seen.has(streamId)) continue;
    seen.add(streamId);
    const itemCategory = text(movie.category_id) || categoryId;
    result.push({
      key: itemKey(playlistId, "movie", streamId),
      streamId,
      categoryKey: `movie:${itemCategory}`,
      name: text(movie.name),
      logo: address(movie.stream_icon, session.streamOrigin),
      extension: text(movie.container_extension),
      year: text(movie.year),
      rating: formatXtreamRating(movie.rating),
    });
  }
  return result;
}

export async function loadXtreamSeries(
  session: XtreamSession,
  playlistId: string,
  categoryId: string,
  signal?: AbortSignal,
): Promise<XtreamSeries[]> {
  const payload = await api(
    session,
    "get_series",
    categoryId ? { category_id: categoryId } : {},
    signal,
  );
  const result: XtreamSeries[] = [];
  const seen = new Set<string>();
  for (const series of records(payload)) {
    const seriesId = text(series.series_id);
    if (!seriesId || seen.has(seriesId)) continue;
    seen.add(seriesId);
    const itemCategory = text(series.category_id) || categoryId;
    const releaseDate = text(series.releaseDate) || text(series.release_date);
    result.push({
      key: itemKey(playlistId, "series", seriesId),
      seriesId,
      categoryKey: `series:${itemCategory}`,
      name: text(series.name),
      logo: address(series.cover, session.streamOrigin),
      year: text(series.year) || releaseDate.slice(0, 4),
      rating: formatXtreamRating(series.rating),
    });
  }
  return result;
}

const detailRecord = (payload: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(payload)) throw new Error("Xtream detail returned an invalid response");
  const value = payload[field];
  return isRecord(value) ? value : {};
};

const durationSeconds = (value: Record<string, unknown>): number | undefined => {
  const seconds = integer(value.duration_secs);
  if (seconds !== undefined) return seconds;
  const parts = text(value.duration).split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return undefined;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

export async function loadXtreamMovieDetail(
  session: XtreamSession,
  playlistId: string,
  streamId: string,
  signal?: AbortSignal,
): Promise<XtreamMovieDetail> {
  const payload = await api(session, "get_vod_info", { vod_id: streamId }, signal);
  const info = detailRecord(payload, "info");
  const movie = detailRecord(payload, "movie_data");
  const duration = durationSeconds(info);
  return {
    key: itemKey(playlistId, "movie", streamId),
    streamId,
    categoryKey: `movie:${text(movie.category_id)}`,
    name: text(info.name) || text(movie.name),
    logo: address(
      info.movie_image || info.cover_big || movie.stream_icon,
      session.streamOrigin,
    ),
    extension: text(movie.container_extension),
    year: text(movie.year) || text(info.year),
    rating: formatXtreamRating(info.rating) || text(movie.rating),
    plot: text(info.plot),
    cast: text(info.cast),
    director: text(info.director),
    genre: text(info.genre),
    releaseDate: text(info.releasedate) || text(info.releaseDate),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
  };
}

export async function loadXtreamSeriesDetail(
  session: XtreamSession,
  playlistId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<XtreamSeriesDetail> {
  const payload = await api(session, "get_series_info", { series_id: seriesId }, signal);
  if (!isRecord(payload)) throw new Error("Xtream detail returned an invalid response");
  const info = isRecord(payload.info) ? payload.info : {};
  const seriesKey = itemKey(playlistId, "series", seriesId);
  const episodes: XtreamEpisode[] = [];
  const seen = new Set<string>();
  if (isRecord(payload.episodes)) {
    const seasons = Object.keys(payload.episodes)
      .map(Number)
      .filter((season) => Number.isInteger(season) && season >= 0)
      .sort((left, right) => left - right);
    for (const season of seasons) {
      for (const episode of records(payload.episodes[String(season)])) {
        const episodeId = text(episode.id);
        if (!episodeId || seen.has(episodeId)) continue;
        seen.add(episodeId);
        const episodeInfo = isRecord(episode.info) ? episode.info : {};
        const duration = durationSeconds(episodeInfo);
        episodes.push({
          key: itemKey(playlistId, "episode", episodeId),
          episodeId,
          seriesKey,
          season,
          number: integer(episode.episode_num) ?? 0,
          name: text(episode.title),
          extension: text(episode.container_extension),
          ...(duration !== undefined ? { durationSeconds: duration } : {}),
        });
      }
    }
  }
  const releaseDate = text(info.releaseDate) || text(info.release_date);
  return {
    key: seriesKey,
    seriesId,
    categoryKey: `series:${text(info.category_id)}`,
    name: text(info.name),
    logo: address(info.cover, session.streamOrigin),
    year: text(info.year) || releaseDate.slice(0, 4),
    rating: formatXtreamRating(info.rating),
    plot: text(info.plot),
    cast: text(info.cast),
    director: text(info.director),
    genre: text(info.genre),
    releaseDate,
    episodes,
  };
}

const decodeBase64 = (value: unknown): string => {
  const supplied = text(value);
  if (!supplied || supplied.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(supplied)) {
    return supplied;
  }
  try {
    const binary = atob(supplied);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return supplied;
  }
};

export async function loadXtreamGuide(
  session: XtreamSession,
  streamId: string,
  signal?: AbortSignal,
): Promise<XtreamProgramme[]> {
  const payload = await api(
    session,
    "get_short_epg",
    { stream_id: streamId, limit: "20" },
    signal,
  );
  if (!isRecord(payload)) throw new Error("Xtream guide returned an invalid response");
  const result: XtreamProgramme[] = [];
  const seen = new Set<string>();
  for (const programme of records(payload.epg_listings)) {
    const id = text(programme.id) || text(programme.epg_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const startTimestamp = integer(programme.start_timestamp);
    const stopTimestamp = integer(programme.stop_timestamp);
    result.push({
      id,
      title: decodeBase64(programme.title),
      description: decodeBase64(programme.description),
      start: text(programme.start),
      end: text(programme.end),
      ...(startTimestamp !== undefined ? { startTimestamp } : {}),
      ...(stopTimestamp !== undefined ? { stopTimestamp } : {}),
      archived: Number(programme.has_archive) === 1,
    });
  }
  return result;
}
