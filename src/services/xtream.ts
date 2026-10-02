import type { Channel } from "../types";
import { parseXtreamPlaylistUrl, type XtreamOutput } from "./playlistUrl";

export type XtreamSource = "live" | "vod";

interface Session {
  server: string;
  username: string;
  password: string;
  output: XtreamOutput;
  streamOrigin: string;
}

export interface XtreamCategory {
  name: string;
  channels: Channel[];
  source: XtreamSource;
  categoryId: string;
  session: Session;
}

const endpoint = (
  server: string,
  username: string,
  password: string,
  action?: string,
  categoryId?: string,
) => {
  const url = new URL(server);
  if (window.location.protocol === "https:" && url.protocol === "http:")
    url.protocol = "https:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/player_api.php`;
  url.search = "";
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  if (action) url.searchParams.set("action", action);
  if (categoryId) url.searchParams.set("category_id", categoryId);
  return url.toString();
};

const json = async (url: string, signal?: AbortSignal) => {
  const response = await fetch(url, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
};

const records = (value: unknown) =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const text = (value: unknown) => (typeof value === "string" ? value : String(value ?? ""));

const streamOrigin = (server: string, info: Record<string, unknown>) => {
  const configured = new URL(server);
  const protocol = text(info.server_protocol) === "https" ? "https:" : configured.protocol;
  const hostname = text(info.url) || configured.hostname;
  const port = text(protocol === "https:" ? info.https_port : info.port);
  const origin = new URL(`${protocol}//${hostname}`);
  if (port) origin.port = port;
  return origin.origin;
};

export async function loadXtreamCatalog(raw: string, signal?: AbortSignal) {
  const credentials = parseXtreamPlaylistUrl(raw);
  if (!credentials) throw new Error("invalid Xtream credentials");
  const auth = (await json(
    endpoint(credentials.server, credentials.username, credentials.password),
    signal,
  )) as Record<string, unknown>;
  const user = (auth.user_info ?? {}) as Record<string, unknown>;
  if (Number(user.auth) !== 1 || text(user.status).toLowerCase() !== "active") {
    throw new Error("Xtream login was rejected");
  }
  const session: Session = {
    ...credentials,
    streamOrigin: streamOrigin(
      credentials.server,
      (auth.server_info ?? {}) as Record<string, unknown>,
    ),
  };
  const [live, vod] = await Promise.all([
    json(
      endpoint(session.server, session.username, session.password, "get_live_categories"),
      signal,
    ),
    json(
      endpoint(session.server, session.username, session.password, "get_vod_categories"),
      signal,
    ),
  ]);
  const categories: XtreamCategory[] = [];
  for (const [source, values] of [
    ["live", live],
    ["vod", vod],
  ] as const) {
    for (const category of records(values)) {
      const categoryId = text(category.category_id);
      if (!categoryId) continue;
      categories.push({
        name: `${source === "live" ? "Live" : "VOD"} · ${text(category.category_name) || "Uncategorised"}`,
        channels: [],
        source,
        categoryId,
        session,
      });
    }
  }
  if (!categories.length) throw new Error("no categories in that Xtream account");
  return categories;
}

export async function loadXtreamCategory(category: XtreamCategory, signal?: AbortSignal) {
  const { session, source, categoryId, name } = category;
  const values = await json(
    endpoint(
      session.server,
      session.username,
      session.password,
      source === "live" ? "get_live_streams" : "get_vod_streams",
      categoryId,
    ),
    signal,
  );
  return records(values).map((stream, index): Channel => {
    const streamId = text(stream.stream_id);
    const extension =
      source === "live"
        ? session.output
        : text(stream.container_extension).replace(/[^a-zA-Z0-9]/g, "") || "mp4";
    const path = source === "live" ? "live" : "movie";
    return {
      id: `xtream:${source}:${streamId}`,
      name: text(stream.name) || "Unnamed",
      logo: text(stream.stream_icon),
      group: name,
      url: `${session.streamOrigin}/${path}/${encodeURIComponent(session.username)}/${encodeURIComponent(session.password)}/${encodeURIComponent(streamId)}.${extension}`,
      quality: "",
      number: Number(stream.num) || index + 1,
    };
  });
}
