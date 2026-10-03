import { beforeEach, expect, test, vi } from "vitest";
import { choosePrivateAddress, createRemoteRelay } from "../scripts/dev-remote-bridge.mjs";

const request = (change: Record<string, unknown> = {}) => ({
  method: "GET",
  path: "/api/v1/state",
  headers: {},
  body: "",
  ...change,
});

beforeEach(() => vi.useRealTimers());

test("chooses an active private address and ignores loopback and public interfaces", () => {
  expect(
    choosePrivateAddress({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      utun3: [{ address: "203.0.113.4", family: "IPv4", internal: false }],
      en7: [{ address: "10.0.0.9", family: "IPv4", internal: false }],
      en0: [{ address: "192.168.1.44", family: "IPv4", internal: false }],
    }),
  ).toBe("192.168.1.44");
});

test("reports the actual Vite port and remote page", () => {
  const relay = createRemoteRelay({ address: "192.168.1.44" });

  expect(relay.info(49862)).toEqual({
    address: "192.168.1.44",
    port: 49862,
    remotePath: "/remote/index.html",
  });
});

test("returns unavailable until a laptop browser connects", async () => {
  const relay = createRemoteRelay({ address: "192.168.1.44" });

  await expect(relay.request(request())).resolves.toEqual({
    status: 503,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify({ error: "desktopUnavailable" }),
  });
});

test("relays one remote request and resolves the laptop response", async () => {
  const relay = createRemoteRelay({ address: "192.168.1.44" });
  const sent: unknown[] = [];
  relay.connect((message) => sent.push(message));

  const pending = relay.request(request({ headers: { authorization: "Bearer p:c" } }));
  expect(sent).toEqual([
    {
      id: 1,
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization: "Bearer p:c" },
      body: "",
    },
  ]);
  expect(relay.respond(1, { status: 200, contentType: "application/json", body: "{}" })).toBe(
    true,
  );
  await expect(pending).resolves.toEqual({
    status: 200,
    contentType: "application/json",
    body: "{}",
  });
});

test("a new laptop session replaces the previous owner", async () => {
  const relay = createRemoteRelay({ address: "192.168.1.44" });
  const first: unknown[] = [];
  const second: unknown[] = [];
  relay.connect((message) => first.push(message));
  const abandoned = relay.request(request());

  relay.connect((message) => second.push(message));

  await expect(abandoned).resolves.toMatchObject({ status: 503 });
  const active = relay.request(request());
  expect(first).toHaveLength(1);
  expect(second).toHaveLength(1);
  relay.respond(2, { status: 200, contentType: "application/json", body: "{}" });
  await expect(active).resolves.toMatchObject({ status: 200 });
});

test("rejects unknown routes and oversized bodies before relay", async () => {
  const relay = createRemoteRelay({ address: "192.168.1.44" });
  const sent: unknown[] = [];
  relay.connect((message) => sent.push(message));

  await expect(relay.request(request({ path: "/config.xml" }))).resolves.toMatchObject({
    status: 404,
  });
  await expect(
    relay.request(request({ method: "POST", path: "/api/v1/pair", body: "x".repeat(65537) })),
  ).resolves.toMatchObject({ status: 413 });
  expect(sent).toEqual([]);
});

test("times out a request the laptop does not answer", async () => {
  vi.useFakeTimers();
  const relay = createRemoteRelay({ address: "192.168.1.44", timeoutMs: 30_000 });
  relay.connect(() => {});

  const pending = relay.request(request());
  await vi.advanceTimersByTimeAsync(30_000);

  await expect(pending).resolves.toMatchObject({ status: 504 });
  expect(relay.respond(1, { status: 200, contentType: "application/json", body: "{}" })).toBe(
    false,
  );
});
