/**
 * Whether an address is worth trying to load a playlist from.
 *
 * Nothing here talks to the network. The point is to catch the mistakes that are obvious
 * before a request is made, so the viewer gets an answer immediately rather than waiting out
 * a timeout to be told something that could have been said at once. Anything that might
 * plausibly work is allowed through and left to fail honestly if it does not: this rejects
 * what cannot possibly be a playlist, not what is unlikely to be one.
 */
import type { MessageKey } from "./locale";

export interface UrlCheck {
  ok: boolean;
  /** What is wrong, in the viewer's terms. Empty when nothing is. */
  problem: string;
  problemKey?: MessageKey;
}

const OK: UrlCheck = { ok: true, problem: "" };
const no = (problem: string, problemKey: MessageKey): UrlCheck => ({
  ok: false,
  problem,
  problemKey,
});

export type XtreamOutput = "m3u8" | "ts";

export interface M3USource {
  kind: "m3u";
  url: string;
}

export interface XtreamSource {
  kind: "xtream";
  server: string;
  username: string;
  password: string;
  output: XtreamOutput;
}

export type PlaylistSource = M3USource | XtreamSource;

export function m3uSource(raw: string): M3USource | null {
  const url = raw.trim();
  return checkPlaylistUrl(url).ok ? { kind: "m3u", url } : null;
}

/**
 * Everything about an Xtream source except whether the credentials are present, so the
 * strict builder and the template parser share the same address handling.
 */
function xtreamUncheckedSource(
  server: string,
  username: string,
  password: string,
  output: XtreamOutput,
): XtreamSource | null {
  try {
    const url = new URL(server.trim());
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      !url.hostname.includes(".")
    ) {
      return null;
    }
    url.pathname = url.pathname.replace(/\/get\.php$/i, "").replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return {
      kind: "xtream",
      server: url.toString().replace(/\/$/, ""),
      username: username.trim(),
      password,
      output,
    };
  } catch {
    return null;
  }
}

export function xtreamSource(
  server: string,
  username: string,
  password: string,
  output: XtreamOutput,
): XtreamSource | null {
  if (!username.trim() || !password) return null;
  return xtreamUncheckedSource(server, username, password, output);
}

export function sourceDisplay(source: PlaylistSource): string {
  return source.kind === "m3u" ? source.url : source.server;
}

/**
 * An Xtream get.php address, credentials optional.
 *
 * Providers hand out the address as a template for the viewer to fill in, so blank
 * username and password parameters still mark it as Xtream: the server and the stream
 * format are adopted and the credentials are left to be typed.
 */
export function parseXtreamTemplateUrl(
  raw: string,
  defaultOutput: XtreamOutput = "ts",
): XtreamSource | null {
  try {
    const url = new URL(raw.trim());
    const username = url.searchParams.get("username") ?? "";
    const password = url.searchParams.get("password") ?? "";
    const type = url.searchParams.get("type") ?? "m3u_plus";
    const requestedOutput = url.searchParams.get("output") ?? defaultOutput;
    const output = requestedOutput === "mpegts" ? "ts" : requestedOutput;
    /* The type only picks which flavour of playlist get.php returns, and both of these
       are playlists, so it does not decide whether the address is an Xtream login. The
       conversion targets the Xtream API, which never sees that parameter. */
    if (
      !/\/get\.php$/i.test(url.pathname) ||
      (type !== "m3u_plus" && type !== "m3u") ||
      (output !== "m3u8" && output !== "ts")
    ) {
      return null;
    }
    /* Lists get passed around with a watermark in front of the host, such as
       http://listshare@provider.example/get.php, which the URL parser reads as a userinfo
       component. An Xtream address carries its login in the username and password beside
       it in the query, so anything in front of the host is noise. */
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return xtreamUncheckedSource(url.toString(), username, password, output);
  } catch {
    return null;
  }
}

/** The `type` parameter exactly as written, or null when absent or unreadable. */
function explicitType(raw: string): string | null {
  try {
    return new URL(raw.trim()).searchParams.get("type");
  } catch {
    return null;
  }
}

/**
 * An Xtream get.php address with credentials, strictly.
 *
 * Saved playlists are migrated through this without being asked, and the Xtream path talks
 * only to player_api.php, so a panel that serves get.php and nothing else would lose a
 * playlist that works today. Plain `m3u` is therefore only ever offered as a question in
 * the form, and an address carrying it explicitly keeps converting nowhere but there. An
 * address with no `type` at all still defaults to `m3u_plus` and converts as it always has.
 */
export function parseXtreamPlaylistUrl(
  raw: string,
  defaultOutput: XtreamOutput = "ts",
): XtreamSource | null {
  const parsed = parseXtreamTemplateUrl(raw, defaultOutput);
  if (explicitType(raw) === "m3u") return null;
  return parsed?.username && parsed.password ? parsed : null;
}

/** Fold an address typed or pasted into the server field into the login beside it. */
export function xtreamFromServerField(current: XtreamSource, typed: string): XtreamSource {
  const parsed = parseXtreamTemplateUrl(typed, current.output);
  if (!parsed) return { ...current, server: typed };
  return {
    ...current,
    server: parsed.server,
    output: parsed.output,
    username: parsed.username || current.username,
    password: parsed.password || current.password,
  };
}

export function checkPlaylistUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return no("Enter the address of a playlist.", "validation.enterAddress");

  // A bare hostname is the commonest slip, and it is worth naming the fix rather than just
  // calling the whole thing invalid.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return no("Start the address with http:// or https://", "validation.startHttp");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return no("That is not a complete web address.", "validation.completeAddress");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return no("Only http and https addresses can be loaded.", "validation.httpOnly");
  }
  if (!url.hostname?.includes(".")) {
    return no(
      "The address is missing a domain, such as example.com.",
      "validation.missingDomain",
    );
  }
  if (/\s/.test(value)) return no("Addresses cannot contain spaces.", "validation.noSpaces");

  return OK;
}

/** A name for a playlist that has not been given one, taken from where it comes from. */
export function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const file = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const stem = (file.toLowerCase() === "get.php" ? "" : file)
      .replace(/\.(m3u8?|txt)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    return stem || url.hostname.replace(/^www\./, "");
  } catch {
    return "Untitled";
  }
}
