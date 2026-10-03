import { networkInterfaces } from "node:os";

const API_PATHS = new Set([
  "/api/v1/status",
  "/api/v1/pair",
  "/api/v1/state",
  "/api/v1/command",
]);
const BODY_MAX = 64 * 1024;

const json = (status, value) => ({
  status,
  contentType: "application/json; charset=utf-8",
  body: JSON.stringify(value),
});

function privateIPv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return false;
  const bytes = parts.map(Number);
  if (bytes.some((byte, index) => !/^\d+$/.test(parts[index]) || byte < 0 || byte > 255)) {
    return false;
  }
  return (
    bytes[0] === 10 ||
    (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
    (bytes[0] === 192 && bytes[1] === 168)
  );
}

function interfaceRank(name) {
  if (/^(en0|wlan|wifi|eth0)$/i.test(name)) return 0;
  if (/^(en|wl|eth)/i.test(name)) return 1;
  return 2;
}

export function choosePrivateAddress(interfaces = networkInterfaces()) {
  return (
    Object.entries(interfaces)
      .sort(([left], [right]) => interfaceRank(left) - interfaceRank(right))
      .flatMap(([name, entries]) => (entries ?? []).map((entry) => ({ ...entry, name })))
      .find(
        (entry) =>
          !entry.internal &&
          (entry.family === "IPv4" || entry.family === 4) &&
          privateIPv4(entry.address),
      )?.address ?? ""
  );
}

export function createRemoteRelay({ address, timeoutMs = 30_000 } = {}) {
  let send = null;
  let closeOwner = null;
  let nextId = 1;
  const pending = new Map();

  function failPending() {
    for (const [id, held] of pending) {
      clearTimeout(held.timer);
      held.resolve(json(503, { error: "desktopUnavailable" }));
      pending.delete(id);
    }
  }

  return {
    info(port) {
      return { address, port, remotePath: "/remote/index.html" };
    },
    connect(nextSend, nextClose = () => {}) {
      closeOwner?.();
      failPending();
      send = nextSend;
      closeOwner = nextClose;
      return () => {
        if (send !== nextSend) return;
        send = null;
        closeOwner = null;
        failPending();
      };
    },
    request(input) {
      const path = String(input.path ?? "").split("?", 1)[0];
      if (!API_PATHS.has(path)) return Promise.resolve(json(404, { error: "notFound" }));
      if (Buffer.byteLength(String(input.body ?? ""), "utf8") > BODY_MAX) {
        return Promise.resolve(json(413, { error: "payloadTooLarge" }));
      }
      if (!send) return Promise.resolve(json(503, { error: "desktopUnavailable" }));
      const id = nextId;
      nextId += 1;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(json(504, { error: "desktopTimeout" }));
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        send({
          id,
          method: String(input.method ?? "GET"),
          path,
          headers: input.headers ?? {},
          body: String(input.body ?? ""),
        });
      });
    },
    respond(id, response) {
      const held = pending.get(id);
      if (!held) return false;
      clearTimeout(held.timer);
      pending.delete(id);
      held.resolve(response);
      return true;
    },
    close() {
      closeOwner?.();
      send = null;
      closeOwner = null;
      failPending();
    },
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    request.on("data", (chunk) => {
      length += chunk.length;
      if (length > BODY_MAX) {
        reject(Object.assign(new Error("payloadTooLarge"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function response(target, value) {
  target.statusCode = value.status;
  target.setHeader("Content-Type", value.contentType);
  target.setHeader("Cache-Control", "no-store");
  target.end(value.body);
}

function requestHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value ?? ""),
    ]),
  );
}

export function devRemoteBridge() {
  const relay = createRemoteRelay({ address: choosePrivateAddress() });
  return {
    name: "openiptv-dev-remote-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, target, next) => {
        const path = String(request.url ?? "").split("?", 1)[0];
        if (path === "/__openiptv/remote/info") {
          const bound = server.httpServer?.address();
          const port =
            typeof bound === "object" && bound ? bound.port : server.config.server.port;
          response(target, json(200, relay.info(port)));
          return;
        }
        if (path === "/__openiptv/remote/events") {
          target.statusCode = 200;
          target.setHeader("Content-Type", "text/event-stream");
          target.setHeader("Cache-Control", "no-store");
          target.setHeader("Connection", "keep-alive");
          target.flushHeaders?.();
          const disconnect = relay.connect(
            (message) => target.write(`data: ${JSON.stringify(message)}\n\n`),
            () => {
              target.write(`data: ${JSON.stringify({ type: "replaced" })}\n\n`);
              target.end();
            },
          );
          request.on("close", disconnect);
          return;
        }
        if (path.startsWith("/__openiptv/remote/responses/")) {
          try {
            const body = JSON.parse(await readBody(request));
            const id = Number(path.slice(path.lastIndexOf("/") + 1));
            response(
              target,
              relay.respond(id, body)
                ? json(200, { ok: true })
                : json(404, { error: "notFound" }),
            );
          } catch (error) {
            response(target, json(error.status ?? 400, { error: error.message }));
          }
          return;
        }
        if (API_PATHS.has(path)) {
          try {
            const body = request.method === "GET" ? "" : await readBody(request);
            response(
              target,
              await relay.request({
                method: request.method,
                path,
                headers: requestHeaders(request.headers),
                body,
              }),
            );
          } catch (error) {
            response(target, json(error.status ?? 400, { error: error.message }));
          }
          return;
        }
        next();
      });
      return () => relay.close();
    },
  };
}
