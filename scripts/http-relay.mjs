import { lookup } from "node:dns/promises";
import { request as requestHttp } from "node:http";
import { isIP } from "node:net";

export const HTTP_RELAY_PATH = "/__openiptv_http_relay__";

export const blockedHttpRelayHost = (hostname) => {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (isIP(host) === 4) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return isIP(host) === 6;
};

const relayAddress = (address) =>
  `${HTTP_RELAY_PATH}?url=${encodeURIComponent(address.toString())}`;

export const rewriteHttpManifest = (text, source) =>
  text
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) {
        const resolved = new URL(line, source);
        return resolved.protocol === "http:" ? relayAddress(resolved) : resolved.toString();
      }
      return line.replace(/URI="([^"]+)"/g, (_match, value) => {
        const resolved = new URL(value, source);
        const address =
          resolved.protocol === "http:" ? relayAddress(resolved) : resolved.toString();
        return `URI="${address}"`;
      });
    })
    .join("\n");

const copyHeaders = (headers) => {
  const copied = {};
  for (const name of [
    "accept-ranges",
    "cache-control",
    "content-length",
    "content-range",
    "content-type",
    "etag",
    "last-modified",
  ]) {
    const value = headers[name];
    if (value !== undefined) copied[name] = value;
  }
  return copied;
};

export const resolveHttpRelayTarget = async (target, resolve = lookup) => {
  const addresses = await resolve(target.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => blockedHttpRelayHost(address)))
    return null;
  return addresses[0];
};

const relay = async (request, response, target, redirects = 0) => {
  const selected = await resolveHttpRelayTarget(target);
  if (!selected) {
    response.writeHead(403).end("The HTTP stream resolved to a private address.");
    return;
  }
  const headers = {};
  for (const name of ["accept", "if-modified-since", "if-none-match", "if-range", "range"]) {
    if (request.headers[name]) headers[name] = request.headers[name];
  }
  const upstream = requestHttp(
    {
      protocol: "http:",
      hostname: selected.address,
      family: selected.family,
      port: target.port || 80,
      path: `${target.pathname}${target.search}`,
      method: request.method,
      headers: { ...headers, host: target.host },
    },
    (incoming) => {
      if (
        incoming.statusCode >= 300 &&
        incoming.statusCode < 400 &&
        incoming.headers.location &&
        redirects < 5
      ) {
        const redirected = new URL(incoming.headers.location, target);
        incoming.resume();
        if (redirected.protocol !== "http:" || blockedHttpRelayHost(redirected.hostname)) {
          response.writeHead(502).end("The provider redirected outside the HTTP relay.");
          return;
        }
        void relay(request, response, redirected, redirects + 1).catch(() => {
          if (!response.headersSent) response.writeHead(502);
          response.end("The HTTP stream could not be relayed.");
        });
        return;
      }

      const type = String(incoming.headers["content-type"] ?? "").toLowerCase();
      const manifest =
        type.includes("mpegurl") || target.pathname.toLowerCase().endsWith(".m3u8");
      if (!manifest || request.method === "HEAD") {
        response.writeHead(incoming.statusCode ?? 502, copyHeaders(incoming.headers));
        incoming.pipe(response);
        return;
      }

      const chunks = [];
      let size = 0;
      incoming.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 5 * 1024 * 1024) chunks.push(chunk);
        else upstream.destroy(new Error("Manifest exceeds relay limit"));
      });
      incoming.on("end", () => {
        const body = rewriteHttpManifest(Buffer.concat(chunks).toString("utf8"), target);
        response.writeHead(incoming.statusCode ?? 502, {
          ...copyHeaders(incoming.headers),
          "content-length": Buffer.byteLength(body),
        });
        response.end(body);
      });
    },
  );
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("The HTTP stream could not be relayed.");
  });
  request.on("aborted", () => upstream.destroy());
  upstream.end();
};

export const handleHttpRelay = (request, response) => {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname !== HTTP_RELAY_PATH) return false;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return true;
  }
  let target;
  try {
    target = new URL(requestUrl.searchParams.get("url") ?? "");
  } catch {
    response.writeHead(400).end("A valid HTTP stream address is required.");
    return true;
  }
  if (target.protocol !== "http:" || blockedHttpRelayHost(target.hostname)) {
    response.writeHead(403).end("Only public HTTP stream addresses can be relayed.");
    return true;
  }
  void relay(request, response, target).catch(() => {
    if (!response.headersSent) response.writeHead(502);
    response.end("The HTTP stream could not be relayed.");
  });
  return true;
};
