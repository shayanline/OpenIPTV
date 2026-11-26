import { writeFileSync } from "node:fs";
import { createServer, request as requestHttp } from "node:http";
import { join } from "node:path";
import { HTTP_RELAY_PATH } from "../http-relay.mjs";

export function initializeMeasurementProfile(userDir) {
  // Automatic secure DNS probes bypass the HTTP proxy. Only seed a fresh measurement
  // profile, and refuse to overwrite any browser's existing local state.
  writeFileSync(
    join(userDir, "Local State"),
    JSON.stringify({ dns_over_https: { mode: "off" } }),
    { flag: "wx", mode: 0o600 },
  );
}

export function measurementOrigins(appUrl, fixtureOrigin) {
  const origins = new Set();
  for (const address of [appUrl, fixtureOrigin]) {
    const url = new URL(address);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        "Isolated measurements require HTTP loopback application and fixture URLs.",
      );
    }
    origins.add(url.origin);
  }
  return origins;
}

export async function startMeasurementNetwork({ appUrl, fixtureOrigin }) {
  const origins = measurementOrigins(appUrl, fixtureOrigin);
  const violations = new Set();
  let requests = {};
  let browserStartup = null;
  const block = (origin) => violations.add(origin);
  const proxy = createServer((request, response) => {
    let address;
    try {
      address = new URL(request.url);
    } catch {
      block("Invalid proxy destination.");
      response.writeHead(403).end();
      return;
    }
    requests[address.origin] = (requests[address.origin] ?? 0) + 1;
    if (
      !origins.has(address.origin) ||
      address.username ||
      address.password ||
      address.pathname === HTTP_RELAY_PATH
    ) {
      block(address.pathname === HTTP_RELAY_PATH ? "HTTP relay" : address.origin);
      response.writeHead(403).end();
      return;
    }
    const headers = { ...request.headers, host: address.host };
    delete headers["proxy-connection"];
    delete headers["proxy-authorization"];
    const upstream = requestHttp(
      {
        hostname: address.hostname.replace(/^\[|\]$/g, ""),
        autoSelectFamily: true,
        // Localhost must not depend on DNS, including when preview only listens on IPv6.
        lookup: (_hostname, options, done) => {
          if (options.all) {
            done(null, [
              { address: "::1", family: 6 },
              { address: "127.0.0.1", family: 4 },
            ]);
          } else {
            done(null, "127.0.0.1", 4);
          }
        },
        port: address.port,
        path: `${address.pathname}${address.search}`,
        method: request.method,
        headers,
      },
      (incoming) => {
        if (response.destroyed) return incoming.destroy();
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
        incoming.on("error", () => {
          if (!request.aborted && !response.destroyed) {
            block(`Local response failed: ${address.origin}`);
          }
          response.destroy();
        });
      },
    );
    upstream.setTimeout(10000, () => upstream.destroy(new Error("Local fixture timeout.")));
    upstream.on("error", () => {
      if (request.aborted || response.destroyed) return;
      block(`Local endpoint failed: ${address.origin}`);
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    response.on("close", () => {
      if (!response.writableFinished) upstream.destroy();
    });
    request.pipe(upstream);
  });
  proxy.on("connect", (request, socket) => {
    let origin = "Invalid CONNECT destination.";
    try {
      origin = new URL(`https://${request.url}`).origin;
    } catch {}
    requests[origin] = (requests[origin] ?? 0) + 1;
    block(origin);
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  proxy.on("upgrade", (request, socket) => {
    let origin = "Invalid WebSocket destination.";
    try {
      origin = new URL(request.url).origin;
    } catch {}
    requests[origin] = (requests[origin] ?? 0) + 1;
    block(`WebSocket: ${origin}`);
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  return {
    proxyUrl,
    beginAudit: () => {
      browserStartup = { requests: { ...requests }, violations: [...violations] };
      requests = {};
      violations.clear();
    },
    chromeArgs: [
      `--proxy-server=${proxyUrl}`,
      "--proxy-bypass-list=<-loopback>",
      "--disable-quic",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-component-extensions-with-background-pages",
      "--disable-client-side-phishing-detection",
      "--disable-domain-reliability",
      "--disable-sync",
      "--no-pings",
      `--disable-features=${[
        "CalculateNativeWinOcclusion",
        "NetworkTimeServiceQuerying",
        "AimEnabled",
        "PreconnectToSearch",
        "OptimizationHints",
        "OptimizationTargetPrediction",
        "MediaRouter",
        "AutofillServerCommunication",
        "Translate",
        "SafeBrowsingHashPrefixRealTimeLookups",
      ].join(",")}`,
      "--enable-features=SkipListAccountsWithoutGaiaCookies",
    ],
    snapshot: () => ({
      isolated: true,
      active: [...origins].every((origin) => requests[origin] > 0),
      allowedOrigins: [...origins],
      requests: { ...requests },
      violations: [...violations],
      browserStartup,
    }),
    close: () => new Promise((resolve) => proxy.close(resolve)),
  };
}
