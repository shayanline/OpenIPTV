import type { Channel } from "../types";
import type { XtreamOutput, XtreamSource } from "./playlistUrl";
import { SEARCH_LIMIT, searchVodItems, type SearchResults } from "./search";

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
  /** The address the viewer configured and that the API authenticated against. */
  streamOrigin: string;
  /** The address the provider advertises, used only if the configured one fails. */
  fallbackStreamOrigin?: string;
  account: XtreamAccount;
}

export interface XtreamCategory {
  key: string;
  id: string;
  kind: XtreamContentKind;
  name: string;
  count?: number;
}

/**
 * Provider metadata safe to render and persist. Each field either holds a normalised value
 * or is absent, so a hostile payload can never carry a malformed value deeper into the app.
 */
export interface VodMetadata {
  backdrops: string[];
  rating: string;
  cast: string[];
  director: string;
  genre: string;
  releaseDate: string;
  country: string;
  ageRating: string;
  episodeRuntimeSeconds?: number;
}

/**
 * The metadata an episode keeps while it waits for its detail panel. It covers the fields a
 * series info response already knows, so the episode can render before a richer fetch.
 */
export interface EpisodeMetadata {
  rating: string;
  plot: string;
  releaseDate: string;
  image: string;
  durationSeconds?: number;
}

/**
 * A season on a series detail is either the number the provider declared or the
 * "unassigned" bucket episodes without a season number share.
 */
export type XtreamSeasonKey = number | "unassigned";

export function compareXtreamSeasonKeys(left: XtreamSeasonKey, right: XtreamSeasonKey): number {
  if (left === "unassigned") return right === "unassigned" ? 0 : 1;
  if (right === "unassigned") return -1;
  const leftNumbered = left > 0;
  const rightNumbered = right > 0;
  if (leftNumbered !== rightNumbered) return leftNumbered ? -1 : 1;
  return left - right;
}

export function formatEpisodePlaybackName(
  parentName: string | undefined,
  episodeName: string,
  season?: number,
  episode?: number,
): string {
  const reference = [
    season !== undefined ? `S${String(Math.max(0, Math.floor(season))).padStart(2, "0")}` : "",
    episode !== undefined
      ? `E${String(Math.max(0, Math.floor(episode))).padStart(2, "0")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [parentName?.trim(), reference, episodeName.trim()].filter(Boolean).join(" · ");
}

export interface XtreamMovie {
  key: string;
  streamId: string;
  categoryKey: string;
  name: string;
  logo: string;
  extension?: string;
  directSource: string;
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
  /** Stable identity for the season and episode, from the id, the source or its position. */
  episodeIdentity: string;
  episodeId?: string;
  directSource: string;
  directSourceFingerprint?: string;
  seriesKey: string;
  seasonKey: XtreamSeasonKey;
  season?: number;
  number?: number;
  name: string;
  extension?: string;
  durationSeconds?: number;
  providerOrder: number;
  metadata: EpisodeMetadata;
}

export interface XtreamMovieDetail extends XtreamMovie {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  durationSeconds?: number;
  metadata: VodMetadata;
}

export interface XtreamSeriesDetail extends XtreamSeries {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  episodes: XtreamEpisode[];
  seasons: XtreamSeasonKey[];
  metadata: VodMetadata;
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

export type XtreamRequestFailure = "timeout" | "aborted" | "http" | "malformed" | "too-large";

/**
 * A provider request that failed. The message deliberately carries no server address,
 * credential or stream URL, because it may be repeated to a viewer.
 */
export class XtreamRequestError extends Error {
  constructor(
    readonly reason: XtreamRequestFailure,
    readonly status?: number,
  ) {
    super(
      reason === "http"
        ? `The provider answered HTTP ${status}`
        : reason === "too-large"
          ? "The provider response exceeded its limit"
          : reason === "malformed"
            ? "The provider returned malformed JSON"
            : reason === "timeout"
              ? "The provider request timed out"
              : "The provider request was aborted",
    );
    this.name = "XtreamRequestError";
  }
}

export interface XtreamRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes: number;
  maxResponseBytes?: number;
  mapRecord?: (record: Record<string, unknown>) => unknown;
}

const REQUEST_TIMEOUT_MS = 30_000;
const INDEX_TIMEOUT_MS = 120_000;
const INDEX_SLICE_MS = 8;
const INDEX_SCAN_CHARACTERS = 8192;
const INDEX_RECORD_CHARACTERS = 8 * 1024 * 1024;

/** Endpoint response ceilings and the retained normalized index budget, in bytes. */
export const XTREAM_LIMITS = {
  categories: 1 * 1024 * 1024,
  contents: 8 * 1024 * 1024,
  detail: 4 * 1024 * 1024,
  index: 12 * 1024 * 1024,
  indexResponse: 128 * 1024 * 1024,
} as const;

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

/**
 * Decode a provider string that may be base64, passing through anything that fails the
 * encoding rules, fails UTF-8, decodes to replacement characters, or fails a round trip.
 */
const decodeBase64 = (value: unknown): string => {
  const supplied = text(value);
  if (!supplied || supplied.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(supplied)) {
    return supplied;
  }
  try {
    const binary = atob(supplied);
    if (btoa(binary) !== supplied) return supplied;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const control = Array.from(decoded).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    });
    const first = decoded.charCodeAt(0);
    const startsText =
      first >= 128 ||
      (first >= 48 && first <= 57) ||
      (first >= 65 && first <= 90) ||
      (first >= 97 && first <= 122);
    return decoded.includes("\uFFFD") || control || !startsText ? supplied : decoded;
  } catch {
    return supplied;
  }
};

/**
 * Decode and trim a provider string. Optional code point bounds cut at the last whitespace
 * boundary inside the limit, so emoji, flags and combining marks survive whole. A string
 * with no whitespace boundary inside the limit is omitted entirely.
 */
export function normalizeProviderText(value: unknown, maxCodePoints?: number): string {
  const supplied = decodeBase64(value).trim();
  if (maxCodePoints === undefined) return supplied;
  const characters = Array.from(supplied);
  if (characters.length <= maxCodePoints) return supplied;
  let cut = 0;
  for (let index = maxCodePoints - 1; index >= 0; index--) {
    if (/\s/u.test(characters[index])) {
      cut = index;
      break;
    }
  }
  return cut === 0 ? "" : characters.slice(0, cut).join("").trimEnd();
}

/**
 * A rating on the ten point scale, to one decimal, or empty. `rating` wins when it is a
 * plausible score; `rating_5based` is the five point fallback the provider kept beside it.
 */
export function normalizeXtreamRating(rating: unknown, rating5Based?: unknown): string {
  const ten = Number(rating);
  if (Number.isFinite(ten) && ten > 0 && ten <= 10) return ten.toFixed(1);
  const five = Number(rating5Based);
  if (Number.isFinite(five) && five > 0 && five <= 5) return (five * 2).toFixed(1);
  return "";
}

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

/** Buffer one raw record at a time and retain only budgeted, normalized catalogue data. */
async function readIndex(
  response: Response,
  options: XtreamRequestOptions,
): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  const result: unknown[] = [];
  let received = 0;
  let retained = 2;
  const parser: { state: "start" | "value" | "done" } = { state: "start" };
  let allowEnd = true;
  const parts: string[] = [];
  let reading = false;
  let recordCharacters = 0;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let scanned = 0;
  let yieldedAt = performance.now();
  const malformed = () => new XtreamRequestError("malformed");
  const consume = async (chunk: string) => {
    let from = reading ? 0 : -1;
    for (let index = 0; index < chunk.length; index += 1) {
      const character = chunk[index];
      scanned += 1;
      if (scanned >= INDEX_SCAN_CHARACTERS) {
        scanned = 0;
        if (performance.now() - yieldedAt >= INDEX_SLICE_MS) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (options.signal?.aborted) throw new XtreamRequestError("aborted");
          yieldedAt = performance.now();
        }
      }
      if (parser.state === "start") {
        if (/\s/.test(character)) continue;
        if (character !== "[") throw malformed();
        parser.state = "value";
        continue;
      }
      if (parser.state === "done") {
        if (!/\s/.test(character)) throw malformed();
        continue;
      }
      if (!reading && /\s/.test(character)) continue;
      if (!quoted && depth === 0 && (character === "," || character === "]")) {
        if (!reading) {
          if (character !== "]" || !allowEnd) throw malformed();
          parser.state = "done";
          continue;
        }
        let parsed: unknown;
        try {
          parts.push(chunk.slice(from, index));
          parsed = JSON.parse(parts.join(""));
        } catch {
          throw malformed();
        }
        const mapped = isRecord(parsed) ? options.mapRecord!(parsed) : null;
        if (mapped != null) {
          retained += encoder.encode(JSON.stringify(mapped)).byteLength + 1;
          if (retained > options.maxBytes) throw new XtreamRequestError("too-large");
          result.push(mapped);
        }
        parts.length = 0;
        reading = false;
        recordCharacters = 0;
        from = -1;
        parser.state = character === "]" ? "done" : "value";
        allowEnd = false;
        continue;
      }
      if (!reading) {
        reading = true;
        from = index;
      }
      recordCharacters += 1;
      if (recordCharacters > INDEX_RECORD_CHARACTERS) throw new XtreamRequestError("too-large");
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth < 0) throw malformed();
      }
    }
    if (reading) parts.push(chunk.slice(from));
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > (options.maxResponseBytes ?? XTREAM_LIMITS.indexResponse))
        throw new XtreamRequestError("too-large");
      await consume(decoder.decode(value, { stream: true }));
    }
    await consume(decoder.decode());
    if (parser.state !== "done") throw malformed();
    return result;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function requestXtreamJson(url: string, options: XtreamRequestOptions): Promise<unknown> {
  const caller = options.signal;
  if (caller?.aborted) throw new XtreamRequestError("aborted");
  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new XtreamRequestError(timedOut ? "timeout" : "aborted"));
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectAbort();
  }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onAbort = () => {
    controller.abort();
    rejectAbort();
  };
  caller?.addEventListener("abort", onAbort);
  const tooLarge = () => new XtreamRequestError("too-large");
  try {
    const response = await Promise.race([
      fetch(url, { cache: "no-cache", signal: controller.signal }),
      aborted,
    ]);
    if (!response.ok) throw new XtreamRequestError("http", response.status);
    const declared = Number(response.headers?.get("content-length"));
    const responseLimit =
      options.maxResponseBytes ??
      (options.mapRecord ? XTREAM_LIMITS.indexResponse : options.maxBytes);
    if (Number.isFinite(declared) && declared > responseLimit) {
      void response.body?.cancel();
      throw tooLarge();
    }
    let parsed: unknown;
    if (response.body) {
      if (options.mapRecord) {
        return await Promise.race([
          readIndex(response, { ...options, signal: controller.signal }),
          aborted,
        ]);
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > options.maxBytes) {
          void reader.cancel();
          throw tooLarge();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      try {
        parsed = JSON.parse(new TextDecoder("utf-8").decode(bytes));
      } catch {
        throw new XtreamRequestError("malformed");
      }
    } else {
      throw new XtreamRequestError("malformed");
    }
    return parsed;
  } catch (error) {
    if (error instanceof XtreamRequestError) throw error;
    if (timedOut) throw new XtreamRequestError("timeout");
    if (caller?.aborted || controller.signal.aborted) throw new XtreamRequestError("aborted");
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onAbort);
  }
}

const api = (
  session: XtreamSession,
  action: string,
  parameters: Record<string, string> = {},
  options: XtreamRequestOptions,
) =>
  requestXtreamJson(
    endpoint(session.server, session.username, session.password, action, parameters),
    options,
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

/** Keep the authenticated address and its path ahead of provider advertisements. */
const configuredStreamOrigin = (server: string): string => {
  const url = configuredOrigin(server);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
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
  const payload = await requestXtreamJson(
    endpoint(source.server, source.username, source.password),
    { signal, maxBytes: XTREAM_LIMITS.categories },
  );
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

  const streamOrigin = configuredStreamOrigin(source.server);

  // Malformed advertisements must not reject an authenticated account.
  let fallbackStreamOrigin: string | undefined;
  try {
    const info = payload.server_info;
    if (
      isRecord(info) &&
      ["url", "server_protocol", "port", "https_port"].some((key) => text(info[key]).trim())
    ) {
      const advertised = providerOrigin(source.server, info);
      if (advertised !== streamOrigin) fallbackStreamOrigin = advertised;
    }
  } catch {
    /* the configured address is already known to answer */
  }

  return {
    server: streamOrigin,
    username: source.username,
    password: source.password,
    output: source.output,
    streamOrigin,
    ...(fallbackStreamOrigin ? { fallbackStreamOrigin } : {}),
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
      name: normalizeProviderText(category.category_name),
      ...(integer(category.count) !== undefined ? { count: integer(category.count) } : {}),
    });
  }
  return result;
};

export async function loadXtreamCategories(
  session: XtreamSession,
  signal?: AbortSignal,
): Promise<XtreamCategory[]> {
  const options = { signal, maxBytes: XTREAM_LIMITS.categories };
  const [live, movies, series] = await Promise.all([
    api(session, "get_live_categories", {}, options),
    api(session, "get_vod_categories", {}, options),
    api(session, "get_series_categories", {}, options),
  ]);
  return [
    ...categories(live, "live"),
    ...categories(movies, "movie"),
    ...categories(series, "series"),
  ];
}

const itemKey = (playlistId: string, kind: XtreamContentKind | "episode", id: string) =>
  `xtream:${playlistId}:${kind}:${id}`;

const vodCategoryKey = (kind: "movie" | "series", id: unknown): string =>
  `${kind}:${text(id) || "__none__"}`;

export interface XtreamStreamUrls {
  url: string;
  /** The provider-advertised address, present only when it differs from the configured one. */
  fallbackUrl?: string;
}

const pathAt = (
  origin: string,
  session: Pick<XtreamSession, "username" | "password">,
  kind: "live" | "movie" | "series",
  id: string,
  extension?: string,
): string => {
  const base = `${origin}/${kind}/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(id)}`;
  return extension ? `${base}.${encodeURIComponent(extension)}` : base;
};

const pathUrl = (
  session: XtreamSession,
  kind: "live" | "movie" | "series",
  id: string,
  extension?: string,
): string => pathAt(session.streamOrigin, session, kind, id, extension);

const fallbackPathUrl = (
  session: XtreamSession,
  kind: "live" | "movie" | "series",
  id: string,
  extension?: string,
): string =>
  session.fallbackStreamOrigin
    ? pathAt(session.fallbackStreamOrigin, session, kind, id, extension)
    : "";

const withFallback = (url: string, fallbackUrl: string): XtreamStreamUrls =>
  fallbackUrl && fallbackUrl !== url ? { url, fallbackUrl } : { url };

export const buildXtreamLiveUrls = (
  session: XtreamSession,
  streamId: string,
): XtreamStreamUrls =>
  withFallback(
    pathUrl(session, "live", streamId, session.output),
    fallbackPathUrl(session, "live", streamId, session.output),
  );

export const buildXtreamLiveUrl = (session: XtreamSession, streamId: string): string =>
  buildXtreamLiveUrls(session, streamId).url;

export const buildXtreamMovieUrls = (
  session: XtreamSession,
  streamId: string,
  extension?: string,
): XtreamStreamUrls =>
  withFallback(
    pathUrl(session, "movie", streamId, extension),
    fallbackPathUrl(session, "movie", streamId, extension),
  );

export const buildXtreamMovieUrl = (
  session: XtreamSession,
  streamId: string,
  extension?: string,
): string => buildXtreamMovieUrls(session, streamId, extension).url;

export const buildXtreamEpisodeUrls = (
  session: XtreamSession,
  episodeId: string,
  extension?: string,
): XtreamStreamUrls =>
  withFallback(
    pathUrl(session, "series", episodeId, extension),
    fallbackPathUrl(session, "series", episodeId, extension),
  );

export const buildXtreamEpisodeUrl = (
  session: XtreamSession,
  episodeId: string,
  extension?: string,
): string => buildXtreamEpisodeUrls(session, episodeId, extension).url;

const catchupAt = (
  origin: string,
  session: XtreamSession,
  streamId: string,
  durationMinutes: number,
  start: string,
): string => {
  const providerStart = start
    .slice(0, 16)
    .replace(" ", ":")
    .replace(/:/g, (match, offset) => (offset > 10 ? "-" : match));
  return `${origin}/timeshift/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(String(Math.floor(durationMinutes)))}/${encodeURIComponent(providerStart).replace(/%3A/gi, ":")}/${encodeURIComponent(streamId)}.ts`;
};

export const buildXtreamCatchupUrls = (
  session: XtreamSession,
  streamId: string,
  durationMinutes: number,
  start: string,
): XtreamStreamUrls =>
  withFallback(
    catchupAt(session.streamOrigin, session, streamId, durationMinutes, start),
    session.fallbackStreamOrigin
      ? catchupAt(session.fallbackStreamOrigin, session, streamId, durationMinutes, start)
      : "",
  );

export const buildXtreamCatchupUrl = (
  session: XtreamSession,
  streamId: string,
  durationMinutes: number,
  start: string,
): string => buildXtreamCatchupUrls(session, streamId, durationMinutes, start).url;

/** Preserve an explicit direct source with a configured fallback when an id exists. */
export function buildXtreamDirectUrls(
  source: XtreamSource,
  item: XtreamMovie | XtreamEpisode,
): XtreamStreamUrls {
  const movie = "streamId" in item;
  const id = movie ? item.streamId : item.episodeId;
  return withFallback(
    item.directSource,
    id
      ? pathAt(
          configuredStreamOrigin(source.server),
          source,
          movie ? "movie" : "series",
          id,
          item.extension,
        )
      : "",
  );
}

/** Upgrade cached Live addresses without waiting for another provider request. */
export function restoreXtreamLiveAddress(source: XtreamSource, channel: Channel): Channel {
  if (!channel.xtream) return channel;
  const configured = pathAt(
    configuredStreamOrigin(source.server),
    source,
    "live",
    channel.xtream.streamId,
    source.output,
  );
  const direct = channel.xtream.directSource;
  const url = direct || configured;
  const fallbackUrl = direct ? configured : channel.fallbackUrl || channel.url;
  const restored = { ...channel, url };
  delete restored.fallbackUrl;
  if (fallbackUrl && fallbackUrl !== url) restored.fallbackUrl = fallbackUrl;
  return restored;
}

export async function loadXtreamLive(
  session: XtreamSession,
  playlistId: string,
  signal?: AbortSignal,
): Promise<Channel[]> {
  const payload = await api(
    session,
    "get_live_streams",
    {},
    {
      signal,
      maxBytes: XTREAM_LIMITS.index,
    },
  );
  const result: Channel[] = [];
  const seen = new Set<string>();
  for (const stream of records(payload)) {
    const streamId = text(stream.stream_id);
    if (!streamId || seen.has(streamId)) continue;
    seen.add(streamId);
    const categoryKey = `live:${text(stream.category_id)}`;
    const directSource = address(stream.direct_source, session.streamOrigin);
    const numberText = text(stream.num).trim();
    const providerNumber = Number(numberText);
    const addresses = buildXtreamLiveUrls(session, streamId);
    const url = directSource || addresses.url;
    const fallbackUrl = directSource ? addresses.url : addresses.fallbackUrl;
    result.push({
      id: itemKey(playlistId, "live", streamId),
      name: text(stream.name),
      logo: address(stream.stream_icon, session.streamOrigin),
      group: categoryKey,
      url,
      ...(fallbackUrl && fallbackUrl !== url ? { fallbackUrl } : {}),
      quality: "",
      number:
        /^\d+$/.test(numberText) && Number.isSafeInteger(providerNumber) && providerNumber > 0
          ? providerNumber
          : result.length + 1,
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

const RELEASE_YEAR_MIN = 1888;
const RELEASE_YEAR_GRACE = 3;

/**
 * A date that could describe a real release. Candidates are tried in order and the first
 * plausible year wins, so a bogus year field cannot hide a good releaseDate behind it.
 */
export function normalizeReleaseDate(
  values: unknown[],
  currentYear = new Date().getFullYear(),
): string {
  const newest = currentYear + RELEASE_YEAR_GRACE;
  for (const value of values) {
    const supplied = text(value).trim();
    const match = /^(\d{4})(?:[-/]\d{1,2})?(?:[-/]\d{1,2})?$/.exec(supplied);
    if (!match) continue;
    const year = Number(match[1]);
    if (year >= RELEASE_YEAR_MIN && year <= newest) return supplied;
  }
  return "";
}

const yearFrom = (values: unknown[]): string => {
  const date = normalizeReleaseDate(values);
  return date ? date.slice(0, 4) : "";
};

/**
 * Duration in whole seconds, or nothing. duration_secs wins, then a duration written as
 * "90", "90:30" or "1:30:25" is interpreted as seconds, minutes and hours respectively.
 */
export function normalizeDurationSeconds(value: Record<string, unknown>): number | undefined {
  const declared = integer(value.duration_secs);
  if (declared !== undefined && declared > 0) return declared;
  const written = text(value.duration).trim();
  if (!written) return undefined;
  let seconds: number | undefined;
  if (/^\d+$/.test(written)) {
    seconds = Number(written);
  } else if (/^\d+:\d{1,2}(?::\d{1,2})?$/.test(written)) {
    const parts = written.split(":").map(Number);
    if (parts.length === 2 && parts[1] < 60) seconds = parts[0] * 60 + parts[1];
    if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }
  return seconds !== undefined && seconds > 0 ? seconds : undefined;
}

/**
 * A container extension that can close a stream URL. Leading dots and case differences
 * survive normalisation, anything else means the item plays without an extension suffix.
 */
export function normalizeExtension(value: unknown): string | undefined {
  const candidate = text(value).trim().replace(/^\.+/, "").toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(candidate) ? candidate : undefined;
}

const episodeCode =
  /(^|[\s[(._-])(?:s(?:eason)?\s*0*(\d{1,3})\s*[:._ -]?\s*e(?:p(?:isode)?)?\s*[:._ -]?\s*0*(\d{1,4})|0*(\d{1,3})\s*x\s*0*(\d{1,4}))(?=$|[\s)\]._:-])/i;
const episodeOnlyCode =
  /(^|[\s[(._-])e(?:p(?:isode)?)?\s*[:._ -]?\s*0*(\d{1,4})(?=$|[\s)\]._:-])/i;

const trimEpisodeSeparators = (value: string) =>
  value
    .replace(/\s+/g, " ")
    .replace(/^[\s[\](){}|:._\u2013\u2014-]+|[\s[\](){}|:._\u2013\u2014-]+$/g, "")
    .trim();

const providerDomain = /\b[a-z0-9-]+\.(?:com|net|org|tv|to|me|cc)\b/i;
const trimProviderNoise = (value: string) => {
  if (/^[a-z0-9-]+\.(?:com|net|org|tv|to|me|cc)$/i.test(value)) return "";
  const wrapper = /^\s*[[(]([^\])]+)[\])]\s*$/.exec(value);
  return wrapper?.[1] && providerDomain.test(wrapper[1]) ? "" : value;
};

const comparableTitle = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();

const seriesAliases = (seriesName: string) => {
  const aliases = new Set([seriesName]);
  const withoutQualifier = trimEpisodeSeparators(
    seriesName.replace(/\s*[[(][^\])]+[\])]\s*$/, ""),
  );
  if (withoutQualifier) aliases.add(withoutQualifier);
  for (const alias of [...aliases]) {
    const withoutLanguage = alias.replace(/^[a-z]{2,3}\s*-\s*/i, "");
    if (withoutLanguage) aliases.add(withoutLanguage);
  }
  return [...aliases];
};

const includesSeriesName = (value: string, seriesName: string) => {
  const supplied = comparableTitle(value);
  return seriesAliases(seriesName).some(
    (alias) => alias.length >= 4 && supplied.includes(comparableTitle(alias)),
  );
};

const matchesSeriesName = (value: string, seriesName: string) =>
  seriesAliases(seriesName).some((alias) => comparableTitle(value) === comparableTitle(alias));

const withoutSeriesName = (value: string, seriesName: string, allowWhitespace = false) => {
  if (!seriesName || comparableTitle(value) === comparableTitle(seriesName)) return value;
  const leadingWrapper = /^\s*[[(]\s*([^\])]+?)\s*[\])]\s*/.exec(value);
  if (
    leadingWrapper?.[1] &&
    comparableTitle(leadingWrapper[1]) === comparableTitle(seriesName)
  ) {
    const remainder = trimEpisodeSeparators(value.slice(leadingWrapper[0].length));
    if (remainder) return remainder;
  }
  const trailingWrapper = /\s*[[(]\s*([^\])]+?)\s*[\])]\s*$/.exec(value);
  if (
    trailingWrapper?.[1] &&
    comparableTitle(trailingWrapper[1]) === comparableTitle(seriesName)
  ) {
    const prefix = trimEpisodeSeparators(
      value.slice(0, value.length - trailingWrapper[0].length),
    );
    if (prefix) return prefix;
  }
  const lower = comparableTitle(value);
  const seriesLower = comparableTitle(seriesName);
  if (lower.startsWith(seriesLower)) {
    const remainder = value.slice(seriesName.length);
    const separated = /^\s*[-\u2013\u2014:|]+\s*/.test(remainder);
    if (separated || (allowWhitespace && /^\s+\S/.test(remainder))) {
      const cleaned = trimEpisodeSeparators(
        separated ? remainder.replace(/^\s*[-\u2013\u2014:|]+\s*/, "") : remainder,
      );
      if (cleaned) return cleaned;
    }
  }
  if (lower.endsWith(seriesLower)) {
    const prefix = value.slice(0, value.length - seriesName.length);
    const separated = /\s*[-\u2013\u2014:|]+\s*$/.test(prefix);
    if (separated || (allowWhitespace && /\S\s+$/.test(prefix))) {
      const cleaned = trimEpisodeSeparators(
        separated ? prefix.replace(/\s*[-\u2013\u2014:|]+\s*$/, "") : prefix,
      );
      if (cleaned) return cleaned;
    }
  }
  return value;
};

export function normalizeEpisodeTitle(
  value: unknown,
  seriesValue: unknown,
  declaredSeason?: number,
  declaredEpisode?: number,
): { name: string; season?: number; episode?: number } {
  const original = normalizeProviderText(value);
  const seriesName = normalizeProviderText(seriesValue);
  let name = withoutSeriesName(original, seriesName);
  let match = episodeCode.exec(name);
  let parsedSeason = match ? Number(match[2] || match[4]) : undefined;
  let parsedEpisode = match ? Number(match[3] || match[5]) : undefined;
  if (!match && declaredSeason !== undefined) {
    const episodeMatch = episodeOnlyCode.exec(name);
    if (episodeMatch) {
      match = episodeMatch;
      parsedSeason = declaredSeason;
      parsedEpisode = Number(episodeMatch[2]);
    }
  }
  const codeTail = match ? name.slice(match.index + match[0].length) : "";
  const codeUsable =
    parsedSeason !== undefined &&
    parsedEpisode !== undefined &&
    (declaredSeason === undefined || declaredSeason === parsedSeason) &&
    !/^\s*(?:to|-|\u2013|\u2014)\s*\d/i.test(codeTail);
  if (match && codeUsable) {
    const before = trimProviderNoise(trimEpisodeSeparators(name.slice(0, match.index)));
    const after = trimProviderNoise(
      trimEpisodeSeparators(name.slice(match.index + match[0].length)),
    );
    name =
      after && includesSeriesName(before, seriesName)
        ? after
        : !after && matchesSeriesName(before, seriesName)
          ? ""
          : trimEpisodeSeparators(`${before} ${after}`);
    for (const alias of seriesAliases(seriesName)) {
      name = withoutSeriesName(name, alias, true);
    }
    if (!name.includes(" ") && (name.match(/\./g)?.length ?? 0) >= 3) {
      name = trimEpisodeSeparators(name.replace(/\./g, " "));
    }
  }
  const resolvedSeason = declaredSeason ?? (codeUsable ? parsedSeason : undefined);
  const resolvedEpisode = codeUsable ? parsedEpisode : declaredEpisode;
  return {
    name,
    ...(resolvedSeason !== undefined ? { season: resolvedSeason } : {}),
    ...(resolvedEpisode !== undefined ? { episode: resolvedEpisode } : {}),
  };
}

/**
 * Backdrop addresses, at most three. Arrays pass through, a plain string is a single
 * address, and a string that starts with "[" is parsed as an encoded array. Anything that
 * does not decode to a credential free http or https address is dropped.
 */
export function normalizeBackdrops(value: unknown, base: string): string[] {
  let candidates: unknown[];
  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string") {
    const supplied = value.trim();
    if (!supplied) return [];
    if (supplied.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(supplied);
        candidates = Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    } else {
      candidates = [supplied];
    }
  } else {
    return [];
  }
  const result: string[] = [];
  for (const candidate of candidates) {
    const url = httpUrl(text(candidate), base);
    if (url) result.push(url.toString());
    if (result.length === 3) break;
  }
  return result;
}

/**
 * At most ten cast members, each cut to one hundred twenty code points. Arrays pass
 * through, a string splits on commas, and anything else keeps nobody.
 */
export function normalizeCast(value: unknown): string[] {
  const raw =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.filter((member): member is string => typeof member === "string")
        : [];
  const people: string[] = [];
  for (const member of raw) {
    const person = normalizeProviderText(member, 120);
    if (person) people.push(person);
    if (people.length === 10) break;
  }
  return people;
}

/** Directors arrive as a comma string or an array; both end as one display string. */
export function normalizeDirector(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .filter((member): member is string => typeof member === "string")
      .map((member) => normalizeProviderText(member, 120))
      .filter(Boolean)
      .join(", ");
  }
  return normalizeProviderText(value, 120);
}

/**
 * A short opaque fingerprint of a direct source address, used to give an episode a stable
 * identity without persisting the credential bearing URL itself.
 */
export function directSourceFingerprint(value: string): string | undefined {
  const url = httpUrl(value);
  if (!url) return undefined;
  const canonical = url.toString();
  let hash = 2166136261;
  for (const character of canonical) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function querySelection(query: string) {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const retained = new Set<string>();
  let identityCharacters = 0;
  const ranks = [0, 0];
  return {
    total: 0,
    totalIsLowerBound: false,
    rank(name: string) {
      const at = name.toLowerCase().indexOf(needle);
      return at < 0 ? -1 : at === 0 ? 0 : 1;
    },
    accept(identity: string, rank: number) {
      if (rank < 0 || seen.has(identity) || retained.has(identity)) return false;
      // Bound identity tracking too, while later records still compete for result slots.
      if (seen.size < 50_000 && identityCharacters + identity.length <= 512 * 1024) {
        seen.add(identity);
        identityCharacters += identity.length;
        this.total += 1;
      } else this.totalIsLowerBound = true;
      if (ranks[rank] >= SEARCH_LIMIT) return false;
      ranks[rank] += 1;
      retained.add(identity);
      return true;
    },
  };
}

export async function searchXtreamCatalogue(
  session: XtreamSession,
  playlistId: string,
  kind: "movie" | "series",
  query: string,
  signal?: AbortSignal,
): Promise<SearchResults<XtreamMovie | XtreamSeries>> {
  if (!query.trim()) return { matches: [], total: 0 };
  const selection = querySelection(query);
  const items: (XtreamMovie | XtreamSeries)[] =
    kind === "movie"
      ? await loadXtreamMovies(session, playlistId, "", signal, selection)
      : await loadXtreamSeries(session, playlistId, "", signal, selection);
  return {
    matches: searchVodItems(items, query).matches,
    total: Math.max(selection.total, items.length),
    totalIsLowerBound: selection.totalIsLowerBound,
  };
}

export async function loadXtreamMovies(
  session: XtreamSession,
  playlistId: string,
  categoryId: string,
  signal?: AbortSignal,
  selection?: ReturnType<typeof querySelection>,
): Promise<XtreamMovie[]> {
  const seen = new Set<string>();
  const normalize = (movie: Record<string, unknown>): XtreamMovie | null => {
    const name = normalizeProviderText(movie.name);
    const rank = selection?.rank(name) ?? 0;
    if (rank < 0) return null;
    const streamId = text(movie.stream_id);
    const directSource = address(movie.direct_source, session.streamOrigin);
    const identity = streamId || directSourceFingerprint(directSource);
    if (!identity || (selection ? !selection.accept(identity, rank) : seen.has(identity)))
      return null;
    if (!selection) seen.add(identity);
    const itemCategory = text(movie.category_id) || categoryId;
    const extension = normalizeExtension(movie.container_extension);
    return {
      key: itemKey(playlistId, "movie", identity),
      streamId,
      categoryKey: vodCategoryKey("movie", itemCategory),
      name,
      logo: address(movie.stream_icon, session.streamOrigin),
      ...(extension !== undefined ? { extension } : {}),
      directSource,
      year: yearFrom([movie.year, movie.releaseDate, movie.release_date]),
      rating: normalizeXtreamRating(movie.rating, movie.rating_5based),
    };
  };
  const payload = await api(
    session,
    "get_vod_streams",
    categoryId ? { category_id: categoryId } : {},
    {
      signal,
      maxBytes: categoryId ? XTREAM_LIMITS.contents : XTREAM_LIMITS.index,
      ...(!categoryId ? { mapRecord: normalize, timeoutMs: INDEX_TIMEOUT_MS } : {}),
      ...(selection ? { maxResponseBytes: Infinity } : {}),
    },
  );
  if (!categoryId) return payload as XtreamMovie[];
  const result: XtreamMovie[] = [];
  for (const movie of records(payload)) {
    const item = normalize(movie);
    if (item) result.push(item);
  }
  return result;
}

export async function loadXtreamSeries(
  session: XtreamSession,
  playlistId: string,
  categoryId: string,
  signal?: AbortSignal,
  selection?: ReturnType<typeof querySelection>,
): Promise<XtreamSeries[]> {
  const seen = new Set<string>();
  const normalize = (series: Record<string, unknown>): XtreamSeries | null => {
    const name = normalizeProviderText(series.name);
    const rank = selection?.rank(name) ?? 0;
    if (rank < 0) return null;
    const seriesId = text(series.series_id);
    if (!seriesId || (selection ? !selection.accept(seriesId, rank) : seen.has(seriesId)))
      return null;
    if (!selection) seen.add(seriesId);
    const itemCategory = text(series.category_id) || categoryId;
    return {
      key: itemKey(playlistId, "series", seriesId),
      seriesId,
      categoryKey: vodCategoryKey("series", itemCategory),
      name,
      logo: address(series.cover, session.streamOrigin),
      year: yearFrom([series.year, series.releaseDate, series.release_date]),
      rating: normalizeXtreamRating(series.rating, series.rating_5based),
    };
  };
  const payload = await api(
    session,
    "get_series",
    categoryId ? { category_id: categoryId } : {},
    {
      signal,
      maxBytes: categoryId ? XTREAM_LIMITS.contents : XTREAM_LIMITS.index,
      ...(!categoryId ? { mapRecord: normalize, timeoutMs: INDEX_TIMEOUT_MS } : {}),
      ...(selection ? { maxResponseBytes: Infinity } : {}),
    },
  );
  if (!categoryId) return payload as XtreamSeries[];
  const result: XtreamSeries[] = [];
  for (const series of records(payload)) {
    const item = normalize(series);
    if (item) result.push(item);
  }
  return result;
}

const detailRecord = (payload: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(payload)) throw new Error("Xtream detail returned an invalid response");
  const value = payload[field];
  return isRecord(value) ? value : {};
};

/**
 * The shared metadata block a detail response carries. Both detail loaders assemble the
 * same shape so the interface never has to ask which endpoint a value came from.
 */
const vodMetadata = (info: Record<string, unknown>, base: string): VodMetadata => ({
  backdrops: normalizeBackdrops(info.backdrop_path, base),
  rating: normalizeXtreamRating(info.rating, info.rating_5based),
  cast: normalizeCast(info.cast ?? info.actors),
  director: normalizeDirector(info.director),
  genre: normalizeProviderText(info.genre, 200),
  releaseDate: normalizeReleaseDate([info.releasedate, info.releaseDate, info.release_date]),
  country: normalizeProviderText(info.country, 120),
  ageRating: normalizeProviderText(info.age ?? info.mpaa_rating, 30),
});

export async function loadXtreamMovieDetail(
  session: XtreamSession,
  playlistId: string,
  streamId: string,
  signal?: AbortSignal,
): Promise<XtreamMovieDetail> {
  const payload = await api(
    session,
    "get_vod_info",
    { vod_id: streamId },
    { signal, maxBytes: XTREAM_LIMITS.detail },
  );
  const info = detailRecord(payload, "info");
  const movie = detailRecord(payload, "movie_data");
  const duration = normalizeDurationSeconds(info);
  const extension = normalizeExtension(movie.container_extension);
  const metadata = vodMetadata(info, session.streamOrigin);
  return {
    key: itemKey(playlistId, "movie", streamId),
    streamId,
    categoryKey: vodCategoryKey("movie", movie.category_id),
    name: normalizeProviderText(info.name || movie.name),
    logo: address(
      info.movie_image || info.cover_big || movie.stream_icon,
      session.streamOrigin,
    ),
    ...(extension !== undefined ? { extension } : {}),
    directSource: address(movie.direct_source, session.streamOrigin),
    year: yearFrom([movie.year, info.year]) || metadata.releaseDate.slice(0, 4),
    rating: metadata.rating || normalizeXtreamRating(movie.rating, movie.rating_5based),
    plot: normalizeProviderText(info.plot, 2000),
    cast: metadata.cast.join(", "),
    director: metadata.director,
    genre: metadata.genre,
    releaseDate: metadata.releaseDate,
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    metadata,
  };
}

export async function loadXtreamSeriesDetail(
  session: XtreamSession,
  playlistId: string,
  seriesId: string,
  signal?: AbortSignal,
): Promise<XtreamSeriesDetail> {
  const payload = await api(
    session,
    "get_series_info",
    { series_id: seriesId },
    { signal, maxBytes: XTREAM_LIMITS.detail },
  );
  if (!isRecord(payload)) throw new Error("Xtream detail returned an invalid response");
  const info = isRecord(payload.info) ? payload.info : {};
  const seriesKey = itemKey(playlistId, "series", seriesId);
  const seriesName = normalizeProviderText(info.name);
  const episodes: XtreamEpisode[] = [];
  const seen = new Set<string>();
  const seasonNumbers = new Set<number>();
  let providerOrder = 0;
  if (isRecord(payload.episodes)) {
    for (const key of Object.keys(payload.episodes)) {
      const numeric = /^-?\d+$/.test(key) ? Number(key) : Number.NaN;
      const numbered = Number.isInteger(numeric) && numeric >= 0;
      for (const episode of records(payload.episodes[key])) {
        const episodeInfo = isRecord(episode.info) ? episode.info : {};
        const declaredEpisode = integer(episode.episode_num);
        const normalizedTitle = normalizeEpisodeTitle(
          episode.title || episodeInfo.title,
          seriesName,
          numbered ? numeric : undefined,
          declaredEpisode,
        );
        const resolvedSeason = numbered ? numeric : normalizedTitle.season;
        const seasonKey: XtreamSeasonKey = resolvedSeason ?? "unassigned";
        const episodeNumber = declaredEpisode ?? normalizedTitle.episode;
        if (resolvedSeason !== undefined) seasonNumbers.add(resolvedSeason);
        const episodeId = text(episode.id) || text(episodeInfo.id) || undefined;
        const directSource = address(episode.direct_source, session.streamOrigin);
        const fingerprint = directSource ? directSourceFingerprint(directSource) : undefined;
        const episodeIdentity =
          episodeId ||
          fingerprint ||
          `s${resolvedSeason ?? "u"}:e${episodeNumber ?? text(episode.episode_num)}:${text(episode.title)}:${providerOrder}`;
        const seasonScoped = `${resolvedSeason ?? "u"}:${episodeIdentity}`;
        if (seen.has(seasonScoped)) continue;
        seen.add(seasonScoped);
        const duration = normalizeDurationSeconds(episodeInfo);
        const extension = normalizeExtension(episode.container_extension);
        episodes.push({
          key: itemKey(playlistId, "episode", seasonScoped),
          episodeIdentity,
          ...(episodeId !== undefined ? { episodeId } : {}),
          directSource,
          ...(fingerprint !== undefined ? { directSourceFingerprint: fingerprint } : {}),
          seriesKey,
          seasonKey,
          ...(resolvedSeason !== undefined ? { season: resolvedSeason } : {}),
          ...(episodeNumber !== undefined ? { number: episodeNumber } : {}),
          name: normalizedTitle.name,
          ...(extension !== undefined ? { extension } : {}),
          ...(duration !== undefined ? { durationSeconds: duration } : {}),
          providerOrder,
          metadata: {
            rating: normalizeXtreamRating(episodeInfo.rating, episodeInfo.rating_5based),
            plot: normalizeProviderText(episodeInfo.plot, 2000),
            releaseDate: normalizeReleaseDate([
              episodeInfo.movie_release_date,
              episodeInfo.releaseDate,
              episodeInfo.release_date,
            ]),
            image: address(
              episodeInfo.movie_image || episodeInfo.still || episode.image,
              session.streamOrigin,
            ),
            ...(duration !== undefined ? { durationSeconds: duration } : {}),
          },
        });
        providerOrder++;
      }
    }
  }
  for (const season of records(payload.seasons)) {
    const declared = integer(season.season_number);
    if (declared !== undefined) seasonNumbers.add(declared);
  }
  const seasons: XtreamSeasonKey[] = [...seasonNumbers].sort(compareXtreamSeasonKeys);
  if (episodes.some((episode) => episode.seasonKey === "unassigned")) {
    seasons.push("unassigned");
  }
  const seasonOrder = new Map<XtreamSeasonKey, number>(
    seasons.map((key, index) => [key, index]),
  );
  episodes.sort((left, right) => {
    const season =
      (seasonOrder.get(left.seasonKey) ?? 0) - (seasonOrder.get(right.seasonKey) ?? 0);
    if (season !== 0) return season;
    if (left.number !== undefined && right.number !== undefined) {
      return left.number - right.number || left.providerOrder - right.providerOrder;
    }
    if (left.number !== undefined) return -1;
    if (right.number !== undefined) return 1;
    return left.providerOrder - right.providerOrder;
  });
  const metadata = vodMetadata(info, session.streamOrigin);
  const runMinutes = integer(info.episode_run_time);
  if (runMinutes !== undefined && runMinutes > 0) {
    metadata.episodeRuntimeSeconds = runMinutes * 60;
  }
  return {
    key: seriesKey,
    seriesId,
    categoryKey: vodCategoryKey("series", info.category_id),
    name: seriesName,
    logo: address(info.cover, session.streamOrigin),
    year: yearFrom([info.year]) || metadata.releaseDate.slice(0, 4),
    rating: metadata.rating,
    plot: normalizeProviderText(info.plot, 2000),
    cast: metadata.cast.join(", "),
    director: metadata.director,
    genre: metadata.genre,
    releaseDate: metadata.releaseDate,
    episodes,
    seasons,
    metadata,
  };
}

export async function loadXtreamGuide(
  session: XtreamSession,
  streamId: string,
  signal?: AbortSignal,
): Promise<XtreamProgramme[]> {
  const payload = await api(
    session,
    "get_short_epg",
    { stream_id: streamId, limit: "20" },
    { signal, maxBytes: XTREAM_LIMITS.categories },
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
