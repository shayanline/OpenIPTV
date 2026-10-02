import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, test, vi } from "vitest";

interface Harness {
  messages: unknown[];
  responses: string[];
  stopped: { value: number };
  queueRequest(raw: string): Promise<void>;
  breakSocket(): Promise<void>;
  send(message: unknown): Promise<void>;
  start(): Promise<void>;
}

function harness(): Harness {
  const source = readFileSync(join(process.cwd(), "public/wasm/management-socket.worker.js"), "utf8");
  const messages: unknown[] = [];
  const responses: string[] = [];
  const requests: string[] = [];
  const timers: (() => void)[] = [];
  const stopped = { value: 0 };
  let broken = false;
  const workerScope = {
    postMessage: (message: unknown) => messages.push(message),
    onmessage: (_event: { data: unknown }) => {},
  };
  const bindings = Object.fromEntries(
    [
      "create",
      "bind",
      "listen",
      "accept",
      "connect",
      "close",
      "recv",
      "recvFrom",
      "recvMsg",
      "send",
      "sendTo",
      "sendMsg",
      "poll",
      "select",
      "shutdown",
      "getSockName",
      "getPeerName",
      "getSockOpt",
      "setSockOpt",
    ].map((name) => [name, () => 0]),
  );
  const functions: Record<string, (...args: unknown[]) => unknown> = {
    start_server: () => 8976,
    receive_request: () => (broken ? -1 : requests.length ? 1 : 0),
    request_text: () => requests.shift() ?? "",
    send_response: (response) => {
      responses.push(String(response));
      return 0;
    },
    stop_server: () => {
      stopped.value += 1;
    },
  };
  const context = vm.createContext({
    self: workerScope,
    tizentvwasm: { SocketsHostBindings: bindings },
    fetch: vi.fn(async (path: string) => ({
      ok: true,
      text: async () => `asset:${path}`,
    })),
    TextEncoder,
    URL,
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout: () => {},
    importScripts: () => {},
    console,
  });
  new vm.Script(source).runInContext(context);
  const module = context.Module as {
    onRuntimeInitialized: () => void;
    cwrap: (name: string) => (...args: unknown[]) => unknown;
  };
  module.cwrap = (name) => functions[name];

  async function flush() {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  }

  return {
    messages,
    responses,
    stopped,
    async start() {
      workerScope.onmessage({
        data: { type: "start", address: "192.168.1.8", port: 8976 },
      });
      module.onRuntimeInitialized();
      await flush();
    },
    async queueRequest(raw) {
      requests.push(raw);
      const timer = timers.shift();
      if (!timer) throw new Error("worker did not schedule polling");
      timer();
      await flush();
    },
    async breakSocket() {
      broken = true;
      const timer = timers.shift();
      if (!timer) throw new Error("worker did not schedule polling");
      timer();
      await flush();
    },
    async send(message) {
      workerScope.onmessage({ data: message });
      await flush();
    },
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("management socket worker", () => {
  test("queues startup until WebAssembly is ready", async () => {
    const worker = harness();

    await worker.start();

    expect(worker.messages[0]).toEqual({
      type: "listening",
      address: "192.168.1.8",
      port: 8976,
    });
  });

  test("serves only the remote assets and application icon", async () => {
    const worker = harness();
    await worker.start();

    await worker.queueRequest("GET / HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[0]).toContain("200 OK");
    expect(worker.responses[0]).toContain("asset:../remote/index.html");

    await worker.queueRequest("GET /remote.css HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[1]).toContain("Content-Type: text/css");

    await worker.queueRequest("GET /remote.js HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[2]).toContain("Content-Type: text/javascript");

    await worker.queueRequest("GET /icon.svg HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[3]).toContain("Content-Type: image/svg+xml");
    expect(worker.responses[3]).toContain("asset:../icon.svg");
  });

  test("forwards bounded API requests to the main thread", async () => {
    const worker = harness();
    await worker.start();
    const body = JSON.stringify({ code: "123456" });

    await worker.queueRequest(
      `POST /api/v1/pair HTTP/1.1\r\nHost: tv\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
    );

    expect(worker.messages[1]).toEqual({
      type: "request",
      id: 1,
      method: "POST",
      path: "/api/v1/pair",
      headers: {
        host: "tv",
        "content-type": "application/json",
        "content-length": String(body.length),
      },
      body,
    });

    await worker.send({
      type: "response",
      id: 1,
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
    expect(worker.responses[0]).toContain("HTTP/1.1 200 OK");
    expect(worker.responses[0]).toContain("Content-Type: application/json");
  });

  test("rejects unsupported methods and path traversal", async () => {
    const worker = harness();
    await worker.start();

    await worker.queueRequest("PUT /api/v1/state HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[0]).toContain("405 Method Not Allowed");

    await worker.queueRequest("GET /../config.xml HTTP/1.1\r\nHost: tv\r\n\r\n");
    expect(worker.responses[1]).toContain("400 Bad Request");
    expect(worker.messages).toHaveLength(1);
  });

  test("rejects oversized headers and bodies", async () => {
    const worker = harness();
    await worker.start();

    await worker.queueRequest(`GET / HTTP/1.1\r\nX-Large: ${"x".repeat(8 * 1024)}\r\n\r\n`);
    expect(worker.responses[0]).toContain("431 Request Header Fields Too Large");

    await worker.queueRequest(
      "POST /api/v1/pair HTTP/1.1\r\nContent-Length: 65537\r\n\r\n",
    );
    expect(worker.responses[1]).toContain("413 Payload Too Large");
  });

  test("closes the socket before reporting a worker error", async () => {
    const worker = harness();
    await worker.start();

    await worker.breakSocket();

    expect(worker.stopped.value).toBe(1);
    expect(worker.messages.at(-1)).toEqual({
      type: "error",
      reason: "the management socket went away, code -1",
    });
  });

  test("closes the socket before reporting that it stopped", async () => {
    const worker = harness();
    await worker.start();

    await worker.send({ type: "stop" });

    expect(worker.stopped.value).toBe(1);
    expect(worker.messages.at(-1)).toEqual({ type: "stopped" });
  });
});
