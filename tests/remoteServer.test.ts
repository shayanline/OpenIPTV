import { beforeEach, describe, expect, test, vi } from "vitest";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  open() {
    this.onopen?.();
  }

  emit(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  close() {
    this.closed = true;
  }
}

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
  const server = await import("../src/services/remoteServer");
  const access = await import("../src/services/deviceAccess");
  const protocol = await import("../src/services/remoteProtocol");
  return { ...server, ...access, ...protocol };
}

beforeEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  FakeWorker.instances = [];
  FakeEventSource.instances = [];
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

test("simulated TV onboarding requires its explicit development query", async () => {
  const { developmentRemoteAccess } = await load();

  expect(developmentRemoteAccess("?tv-onboarding")).toBe(true);
  expect(developmentRemoteAccess("?remote")).toBe(false);
  expect(developmentRemoteAccess("")).toBe(false);
});

describe("management lifecycle", () => {
  test("starts with Samsung's private address and reports listening", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    const states: string[] = [];
    server.subscribeRemoteAccess((state) => states.push(state.status));

    server.startRemoteAccess();
    const worker = FakeWorker.instances[0];
    expect(worker.messages[0]).toEqual({
      type: "start",
      address: "192.168.1.8",
      port: 8976,
    });
    worker.emit({ type: "listening", address: "192.168.1.8", port: 8976 });

    expect(server.remoteAccessState().status).toBe("listening");
    expect(states).toContain("listening");
  });

  test("opens pairing only while listening and clears it on expiry or cancel", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    expect(server.openPairing()).toBeNull();
    server.startRemoteAccess();
    FakeWorker.instances[0].emit({
      type: "listening",
      address: "192.168.1.8",
      port: 8976,
    });

    expect(server.openPairing()).toBeTruthy();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(server.remoteAccessState().pairing).toBeNull();
    expect(server.remoteAccessState().pairingError).toBe(true);

    expect(server.openPairing()).toBeTruthy();
    expect(server.remoteAccessState().pairingError).toBe(false);
    server.cancelPairing();
    expect(server.remoteAccessState().pairing).toBeNull();
  });

  test("returns an internal response when request handling rejects", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    server.startRemoteAccess();
    const worker = FakeWorker.instances[0];
    worker.emit({ type: "listening", address: "192.168.1.8", port: 8976 });
    const pairing = server.openPairing();
    if (!pairing) throw new Error("pairing did not open");
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("digest failed"));

    worker.emit({
      type: "request",
      id: 9,
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: pairing.secret, name: "Device" }),
    });

    await vi.waitFor(() =>
      expect(worker.messages).toContainEqual(
        expect.objectContaining({ type: "response", id: 9, status: 500 }),
      ),
    );
    expect(server.remoteAccessState()).toMatchObject({ pairing: null, pairingError: true });
  });

  test("fails closed when the address is public or bindings fail", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "203.0.113.7" },
    };
    const server = await load();

    server.startRemoteAccess();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(server.remoteAccessState().status).toBe("unavailable");

    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    server.startRemoteAccess();
    const failedWorker = FakeWorker.instances[0];
    failedWorker.emit({ type: "error", reason: "no socket bindings" });
    expect(server.remoteAccessState().error).toContain("no socket bindings");
    expect(failedWorker.terminated).toBe(true);

    server.startRemoteAccess();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  test("closes before restart and invalidates pairing when stopping", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    (window as unknown as { webapis: unknown }).webapis = {
      network: { getIp: () => "192.168.1.8" },
    };
    const server = await load();
    server.startRemoteAccess();
    const worker = FakeWorker.instances[0];
    worker.emit({ type: "listening", address: "192.168.1.8", port: 8976 });
    const pairing = server.openPairing();
    if (!pairing) throw new Error("pairing did not open");

    const stopping = server.stopRemoteAccess();
    server.startRemoteAccess();
    await Promise.resolve();
    expect(worker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    worker.emit({ type: "stopped" });
    await stopping;

    expect(worker.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    expect(await server.pairDevice({ secret: pairing.secret, name: "Stale" })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("development bridge lifecycle", () => {
  test("starts from Vite bridge information and uses the remote page path", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      }),
    );
    const server = await load();

    await server.startDevelopmentRemoteAccess();

    expect(server.remoteAccessState()).toMatchObject({
      status: "listening",
      address: "192.168.1.44",
      port: 49862,
      remotePath: "/remote/index.html",
    });
    expect(FakeEventSource.instances[0].url).toBe("/__openiptv/remote/events");
  });

  test("returns to listening when the development event stream reconnects", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      }),
    );
    const server = await load();
    await server.startDevelopmentRemoteAccess();
    const events = FakeEventSource.instances[0];

    events.onerror?.();
    expect(server.remoteAccessState().status).toBe("unavailable");
    events.open();

    expect(server.remoteAccessState()).toMatchObject({ status: "listening", error: "" });
  });

  test("coalesces concurrent development startup into one event stream", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      }),
    );
    const server = await load();

    await Promise.all([
      server.startDevelopmentRemoteAccess(),
      server.startDevelopmentRemoteAccess(),
    ]);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(server.remoteAccessState().status).toBe("listening");
  });

  test("returns to idle when development startup is cancelled", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let release: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const server = await load();
    const starting = server.startDevelopmentRemoteAccess();
    expect(server.remoteAccessState().status).toBe("starting");

    await server.stopRemoteAccess();
    release({
      ok: true,
      json: async () => ({
        address: "192.168.1.44",
        port: 49862,
        remotePath: "/remote/index.html",
      }),
    });
    await starting;

    expect(server.remoteAccessState().status).toBe("idle");
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  test("stops reconnecting when another laptop tab replaces this bridge owner", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      }),
    );
    const server = await load();
    await server.startDevelopmentRemoteAccess();
    const events = FakeEventSource.instances[0];

    events.emit({ type: "replaced" });

    expect(events.closed).toBe(true);
    expect(server.remoteAccessState()).toMatchObject({
      status: "unavailable",
      error: "another simulated TV tab took over",
    });
  });

  test("routes development events through the existing remote API and posts the response", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      })
      .mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const server = await load();
    await server.startDevelopmentRemoteAccess();

    FakeEventSource.instances[0].emit({
      id: 7,
      method: "GET",
      path: "/api/v1/status",
      headers: {},
      body: "",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[1][0]).toBe("/__openiptv/remote/responses/7");
    const posted = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(posted.status).toBe(200);
    expect(JSON.parse(posted.body).name).toBe("OpenIPTV");
  });

  test("closes the development event stream when remote access stops", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          address: "192.168.1.44",
          port: 49862,
          remotePath: "/remote/index.html",
        }),
      }),
    );
    const server = await load();
    await server.startDevelopmentRemoteAccess();

    await server.stopRemoteAccess();

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(server.remoteAccessState().status).toBe("idle");
  });

  test("reports unavailable when Vite bridge information cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const server = await load();

    await server.startDevelopmentRemoteAccess();

    expect(server.remoteAccessState()).toMatchObject({
      status: "unavailable",
      error: "offline",
    });
  });
});

describe("management API", () => {
  test("rejects pairing requests with unknown fields or two credentials", async () => {
    const server = await load();
    const session = server.createPairingSession();

    const unknown = await server.routeRemoteRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, name: "Device", admin: true }),
    });
    const ambiguous = await server.routeRemoteRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, code: session.code, name: "Device" }),
    });

    expect(unknown.status).toBe(400);
    expect(ambiguous.status).toBe(400);
  });

  test("pairs, authenticates state, applies commands, and rejects stale revisions", async () => {
    const server = await load();
    const session = server.createPairingSession();
    const paired = await server.routeRemoteRequest({
      method: "POST",
      path: "/api/v1/pair",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: session.secret, name: "Shayan's device" }),
    });
    expect(paired.status).toBe(200);
    const credential = JSON.parse(paired.body) as { deviceId: string; credential: string };
    const authorization = `Bearer ${credential.deviceId}:${credential.credential}`;

    const state = await server.routeRemoteRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization },
      body: "",
    });
    expect(state.status).toBe(200);

    const unknownEnvelope = await server.routeRemoteRequest({
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

    const command = await server.routeRemoteRequest({
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

    const stale = await server.routeRemoteRequest({
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

  test("rejects missing and revoked credentials without affecting another device", async () => {
    const server = await load();
    const firstSession = server.createPairingSession();
    const first = await server.pairDevice({ secret: firstSession.secret, name: "First" });
    const secondSession = server.createPairingSession();
    const second = await server.pairDevice({ secret: secondSession.secret, name: "Second" });
    if (!first.ok || !second.ok) throw new Error("pairing failed");

    const missing = await server.routeRemoteRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: {},
      body: "",
    });
    expect(missing.status).toBe(401);

    server.revokePairedDevice(first.deviceId);
    const revoked = await server.routeRemoteRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization: `Bearer ${first.deviceId}:${first.credential}` },
      body: "",
    });
    const remaining = await server.routeRemoteRequest({
      method: "GET",
      path: "/api/v1/state",
      headers: { authorization: `Bearer ${second.deviceId}:${second.credential}` },
      body: "",
    });

    expect(revoked.status).toBe(401);
    expect(remaining.status).toBe(200);
  });
});
