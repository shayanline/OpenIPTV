import { beforeEach, describe, expect, test, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: unknown[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  constructor(public url: string) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

async function load() {
  vi.resetModules();
  const server = await import("../src/services/phoneServer");
  const access = await import("../src/services/phoneAccess");
  const protocol = await import("../src/services/phoneProtocol");
  return { ...server, ...access, ...protocol };
}

beforeEach(() => {
  localStorage.clear();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
  delete (window as unknown as { webapis?: unknown }).webapis;
});

describe("private TV addresses", () => {
  test("accepts private IPv4 addresses only", async () => {
    const { isPrivateIPv4 } = await load();

    expect(isPrivateIPv4("10.2.3.4")).toBe(true);
    expect(isPrivateIPv4("172.16.0.1")).toBe(true);
    expect(isPrivateIPv4("172.31.255.254")).toBe(true);
    expect(isPrivateIPv4("192.168.1.20")).toBe(true);
    expect(isPrivateIPv4("127.0.0.1")).toBe(false);
    expect(isPrivateIPv4("172.32.0.1")).toBe(false);
    expect(isPrivateIPv4("8.8.8.8")).toBe(false);
    expect(isPrivateIPv4("not-an-address")).toBe(false);
  });
});

describe("management lifecycle", () => {
  test("starts with Samsung's private address and reports listening", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    const states: string[] = [];
    server.subscribePhoneManagement((state) => states.push(state.status));

    server.startPhoneManagement();
    const worker = FakeWorker.instances[0];
    expect(worker.messages[0]).toEqual({
      type: "start",
      address: "192.168.1.8",
      port: 8976,
    });
    worker.emit({ type: "listening", address: "192.168.1.8", port: 8976 });

    expect(server.phoneManagementState().status).toBe("listening");
    expect(states).toContain("listening");
  });

  test("fails closed when the address is public or bindings fail", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "203.0.113.7" },
    };
    const server = await load();

    server.startPhoneManagement();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(server.phoneManagementState().status).toBe("unavailable");

    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    server.startPhoneManagement();
    const failedWorker = FakeWorker.instances[0];
    failedWorker.emit({ type: "error", reason: "no socket bindings" });
    expect(server.phoneManagementState().error).toContain("no socket bindings");
    expect(failedWorker.terminated).toBe(true);

    server.startPhoneManagement();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  test("starts only for onboarding or remembered phones", async () => {
    const server = await load();

    expect(server.phoneManagementNeeded(false)).toBe(true);
    expect(server.phoneManagementNeeded(true)).toBe(false);

    const session = server.createPairingSession();
    const paired = await server.pairPhone({ secret: session.secret, name: "Phone" });
    expect(paired.ok).toBe(true);
    expect(server.phoneManagementNeeded(true)).toBe(true);
  });

  test("waits for socket closure before terminating the worker", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    server.startPhoneManagement();
    const worker = FakeWorker.instances[0];

    const stopping = server.stopPhoneManagement();
    await Promise.resolve();
    expect(worker.terminated).toBe(false);
    worker.emit({ type: "stopped" });
    await stopping;
    expect(worker.terminated).toBe(true);
  });
});

describe("management API", () => {
  test("rejects pairing requests with unknown fields or two credentials", async () => {
    const server = await load();
    const session = server.openPairing();

    const unknown = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, name: "Phone", admin: true }),
    });
    const ambiguous = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, code: session.code, name: "Phone" }),
    });

    expect(unknown.status).toBe(400);
    expect(ambiguous.status).toBe(400);
  });

  test("pairs, authenticates state, applies commands, and rejects stale revisions", async () => {
    const server = await load();
    const session = server.openPairing();
    const paired = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, name: "Shayan's phone" }),
    });
    expect(paired.status).toBe(200);
    const credential = JSON.parse(paired.body) as { phoneId: string; credential: string };
    const authorization = `Bearer ${credential.phoneId}:${credential.credential}`;

    const state = await server.routePhoneRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization },
      body: "",
    });
    expect(state.status).toBe(200);

    const unknownEnvelope = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/command",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: "unknown-envelope",
        revision: 0,
        command: { type: "setting", key: "showClock", value: false },
        admin: true,
      }),
    });
    expect(unknownEnvelope.status).toBe(400);

    const command = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/command",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: "clock",
        revision: 0,
        command: { type: "setting", key: "showClock", value: false },
      }),
    });
    expect(command.status).toBe(200);

    const stale = await server.routePhoneRequest({
      method: "POST",
      path: "/api/v1/command",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        id: "logos",
        revision: 0,
        command: { type: "setting", key: "showLogos", value: false },
      }),
    });
    expect(stale.status).toBe(409);
  });

  test("rejects missing and revoked credentials without affecting another phone", async () => {
    const server = await load();
    const firstSession = server.openPairing();
    const first = await server.pairPhone({ secret: firstSession.secret, name: "First" });
    const secondSession = server.openPairing();
    const second = await server.pairPhone({ secret: secondSession.secret, name: "Second" });
    if (!first.ok || !second.ok) throw new Error("pairing failed");

    const missing = await server.routePhoneRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: {},
      body: "",
    });
    expect(missing.status).toBe(401);

    server.revokePairedPhone(first.phoneId);
    const revoked = await server.routePhoneRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization: `Bearer ${first.phoneId}:${first.credential}` },
      body: "",
    });
    const remaining = await server.routePhoneRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization: `Bearer ${second.phoneId}:${second.credential}` },
      body: "",
    });

    expect(revoked.status).toBe(401);
    expect(remaining.status).toBe(200);
  });
});
