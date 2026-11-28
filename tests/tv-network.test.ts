import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  initializeMeasurementProfile,
  measurementOrigins,
  startMeasurementNetwork,
} from "../scripts/tv/measurement-network.mjs";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

const throughProxy = (proxyUrl: string, destination: string) =>
  new Promise<{ status: number; body: string; location?: string }>((resolve, reject) => {
    const url = new URL(proxyUrl);
    const outgoing = request(
      {
        hostname: url.hostname,
        port: url.port,
        path: destination,
        headers: { connection: "close" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body,
            location: response.headers.location,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });

const fixtureNetwork = async (appUrl: string, fixtureOrigin = appUrl) => {
  const network = await startMeasurementNetwork({ appUrl, fixtureOrigin });
  cleanups.push(network.close);
  return network;
};

test("fresh measurement profiles disable secure DNS probes outside the HTTP proxy", async () => {
  const userDir = await mkdtemp(join(tmpdir(), "openiptv-network-test-"));
  cleanups.push(() => rm(userDir, { recursive: true, force: true }));
  initializeMeasurementProfile(userDir);
  const statePath = join(userDir, "Local State");
  expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
    dns_over_https: { mode: "off" },
  });
  expect((await stat(statePath)).mode & 0o777).toBe(0o600);
});

test("measurement profile initialization never overwrites existing browser preferences", async () => {
  const userDir = await mkdtemp(join(tmpdir(), "openiptv-network-test-"));
  cleanups.push(() => rm(userDir, { recursive: true, force: true }));
  const statePath = join(userDir, "Local State");
  const existing = JSON.stringify({ dns_over_https: { mode: "secure" }, existing: true });
  await writeFile(statePath, existing);
  expect(() => initializeMeasurementProfile(userDir)).toThrow();
  expect(await readFile(statePath, "utf8")).toBe(existing);
});

test("measurements only accept HTTP loopback origins without credentials", () => {
  expect([
    ...measurementOrigins("http://localhost:4183/", "http://127.0.0.1:4174/playlist"),
  ]).toEqual(["http://localhost:4183", "http://127.0.0.1:4174"]);
  for (const address of [
    "http://provider.invalid/",
    "http://127.0.0.1.provider.invalid/",
    "http://fixture:fixture@127.0.0.1:4183/",
    "https://localhost:4183/",
  ]) {
    expect(() => measurementOrigins(address, "http://127.0.0.1:4174")).toThrow(/HTTP loopback/);
    expect(() => measurementOrigins("http://127.0.0.1:4183", address)).toThrow(/HTTP loopback/);
  }
});

test("the proxy preserves fixture status and bodies for both owned origins", async () => {
  const app = await listen(createServer((_request, response) => response.end("app")));
  const fixture = await listen(
    createServer((_request, response) => response.writeHead(503).end("fixture failure")),
  );
  const network = await fixtureNetwork(app, fixture);
  expect(network.snapshot().active).toBe(false);
  expect(await throughProxy(network.proxyUrl, `${app}/assets/app.js`)).toMatchObject({
    status: 200,
    body: "app",
  });
  expect(await throughProxy(network.proxyUrl, `${fixture}/player_api.php`)).toMatchObject({
    status: 503,
    body: "fixture failure",
  });
  expect(network.snapshot().violations).toEqual([]);
  expect(network.snapshot().active).toBe(true);
});

test("unknown origins and the HTTP relay never reach an upstream server", async () => {
  let received = 0;
  const origin = await listen(
    createServer((_request, response) => {
      received += 1;
      response.end("unexpected");
    }),
  );
  const network = await fixtureNetwork(origin);
  const denied = await listen(
    createServer((_request, response) => {
      received += 1;
      response.end("unexpected");
    }),
  );
  for (const url of [
    `${denied}/slow`,
    `${origin}/__openiptv_http_relay__?url=http://provider.invalid/slow`,
  ]) {
    expect((await throughProxy(network.proxyUrl, url)).status).toBe(403);
  }
  expect(received).toBe(0);
  expect(network.snapshot().violations).toEqual([denied, "HTTP relay"]);
});

test("localhost forwards to an owned loopback server without external DNS", async () => {
  const origin = await listen(createServer((_request, response) => response.end("local")));
  const localhost = origin.replace("127.0.0.1", "localhost");
  const network = await fixtureNetwork(localhost);
  expect(await throughProxy(network.proxyUrl, localhost)).toMatchObject({
    status: 200,
    body: "local",
  });
  expect(network.snapshot()).toMatchObject({ active: true, violations: [] });
});

test("an incomplete local response invalidates the network audit", async () => {
  const origin = await listen(
    createServer((_request, response) => {
      response.writeHead(200, { "content-length": "1000" });
      response.write("short");
      setTimeout(() => response.destroy(), 5);
    }),
  );
  const network = await fixtureNetwork(origin);
  await throughProxy(network.proxyUrl, origin).catch(() => null);
  expect(network.snapshot().violations.some((message) => message.includes(origin))).toBe(true);
});

test("a redirect cannot escape to an unowned origin", async () => {
  let received = 0;
  const denied = await listen(
    createServer((_request, response) => {
      received += 1;
      response.end();
    }),
  );
  const origin = await listen(
    createServer((_request, response) => response.writeHead(302, { location: denied }).end()),
  );
  const network = await fixtureNetwork(origin);
  const redirect = await throughProxy(network.proxyUrl, origin);
  expect(redirect.status).toBe(302);
  expect((await throughProxy(network.proxyUrl, redirect.location ?? "")).status).toBe(403);
  expect(received).toBe(0);
});

test("blocked browser startup traffic remains recorded outside the application audit", async () => {
  const origin = await listen(createServer((_request, response) => response.end("app")));
  const denied = await listen(createServer((_request, response) => response.end("unexpected")));
  const network = await fixtureNetwork(origin);
  expect((await throughProxy(network.proxyUrl, denied)).status).toBe(403);
  network.beginAudit();
  expect(network.snapshot()).toMatchObject({
    active: false,
    violations: [],
    browserStartup: { violations: [denied] },
  });
  expect((await throughProxy(network.proxyUrl, origin)).status).toBe(200);
  expect(network.snapshot().active).toBe(true);
  expect((await throughProxy(network.proxyUrl, denied)).status).toBe(403);
  expect(network.snapshot().violations).toEqual([denied]);
});

test("HTTPS tunnels are refused without opening an upstream connection", async () => {
  let received = 0;
  const origin = await listen(
    createServer((_request, response) => {
      received += 1;
      response.end();
    }),
  );
  const network = await fixtureNetwork(origin);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(network.proxyUrl, {
      method: "CONNECT",
      path: new URL(origin).host,
    });
    outgoing.on("connect", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
  expect(status).toBe(403);
  expect(received).toBe(0);
  expect(network.snapshot().violations).toContain(origin.replace("http:", "https:"));
});
