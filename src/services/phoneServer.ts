import {
  authenticatePhone,
  createPairingSession,
  hasPairedPhones,
  pairPhone,
  type PairingSessionView,
} from "./phoneAccess";
import { applyPhoneCommand, phoneSnapshot, type CommandRequest } from "./phoneProtocol";

const PORT = 8976;
const BODY_MAX = 64 * 1024;
const STOP_TIMEOUT_MS = 1500;

export interface PhoneManagementState {
  status: "idle" | "starting" | "listening" | "unavailable";
  address: string;
  port: number;
  pairing: PairingSessionView | null;
  connectedPhone: string;
  error: string;
}

export interface PhoneRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface PhoneResponse {
  status: number;
  contentType: string;
  body: string;
}

interface WorkerRequest extends PhoneRequest {
  type: "request";
  id: number;
}

const listeners = new Set<(state: PhoneManagementState) => void>();
let state: PhoneManagementState = {
  status: "idle",
  address: "",
  port: 0,
  pairing: null,
  connectedPhone: "",
  error: "",
};
let worker: Worker | null = null;
let stopPromise: Promise<void> | null = null;
let stopResolve: (() => void) | null = null;
let stopTimer: number | undefined;

function publish(change: Partial<PhoneManagementState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener(state);
}

function json(status: number, value: unknown): PhoneResponse {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(value) };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function bearer(headers: Record<string, string>): { id: string; credential: string } | null {
  const value = headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  const split = value.slice(7).indexOf(":");
  if (split <= 0) return null;
  return {
    id: value.slice(7, split + 7),
    credential: value.slice(split + 8),
  };
}

async function authorised(request: PhoneRequest): Promise<boolean> {
  const token = bearer(request.headers);
  return !!token && authenticatePhone(token.id, token.credential);
}

function validJsonPost(request: PhoneRequest): boolean {
  return (
    request.method === "POST" &&
    request.headers["content-type"]?.toLowerCase().startsWith("application/json") === true
  );
}

export function isPrivateIPv4(value: string): boolean {
  const parts = value.split(".");
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

export function phoneManagementState(): PhoneManagementState {
  return state;
}

export function subscribePhoneManagement(
  listener: (state: PhoneManagementState) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function phoneManagementNeeded(configured: boolean): boolean {
  return !configured || hasPairedPhones();
}

export function openPairing(): PairingSessionView {
  const pairing = createPairingSession();
  publish({ pairing, connectedPhone: "" });
  return pairing;
}

export async function routePhoneRequest(request: PhoneRequest): Promise<PhoneResponse> {
  if (new TextEncoder().encode(request.body).length > BODY_MAX) {
    return json(413, { error: "payloadTooLarge" });
  }
  if (request.path === "/api/v1/status" && request.method === "GET") {
    return json(200, { name: "OpenIPTV", status: state.status });
  }
  if (request.path === "/api/v1/pair") {
    if (!validJsonPost(request)) return json(415, { error: "jsonRequired" });
    const input = parseJson(request.body);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(400, { error: "invalidRequest" });
    }
    const values = input as Record<string, unknown>;
    const keys = Object.keys(values).sort().join(",");
    const hasSecret = typeof values.secret === "string";
    const hasCode = typeof values.code === "string";
    if (
      typeof values.name !== "string" ||
      hasSecret === hasCode ||
      (keys !== "name,secret" && keys !== "code,name")
    ) {
      return json(400, { error: "invalidRequest" });
    }
    const paired = await pairPhone(
      {
        name: values.name,
        ...(typeof values.secret === "string" ? { secret: values.secret } : {}),
        ...(typeof values.code === "string" ? { code: values.code } : {}),
      },
    );
    if (!paired.ok) {
      return json(paired.reason === "expired" ? 410 : 401, { error: paired.reason });
    }
    publish({ pairing: null, connectedPhone: values.name.trim() || "Phone" });
    return json(200, paired);
  }
  if (request.path === "/api/v1/state") {
    if (request.method !== "GET") return json(405, { error: "methodNotAllowed" });
    if (!(await authorised(request))) return json(401, { error: "unauthorised" });
    return json(200, phoneSnapshot());
  }
  if (request.path === "/api/v1/command") {
    if (!validJsonPost(request)) return json(415, { error: "jsonRequired" });
    if (!(await authorised(request))) return json(401, { error: "unauthorised" });
    const input = parseJson(request.body) as CommandRequest | null;
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !== "command,id,revision"
    ) {
      return json(400, { error: "invalidRequest" });
    }
    const result = await applyPhoneCommand(input);
    return json(result.reason === "conflict" ? 409 : result.ok ? 200 : 400, result);
  }
  return json(404, { error: "notFound" });
}

function failWorker(reason: string): void {
  if (stopTimer !== undefined) window.clearTimeout(stopTimer);
  stopTimer = undefined;
  worker?.terminate();
  worker = null;
  stopResolve?.();
  stopResolve = null;
  stopPromise = null;
  publish({ status: "unavailable", error: reason });
}

function finishStop(): void {
  if (stopTimer !== undefined) window.clearTimeout(stopTimer);
  stopTimer = undefined;
  worker?.terminate();
  worker = null;
  const resolve = stopResolve;
  stopResolve = null;
  stopPromise = null;
  publish({ status: "idle", address: "", port: 0, pairing: null, error: "" });
  resolve?.();
}

export function startPhoneManagement(): void {
  if (worker) return;
  const address = window.webapis?.network?.getIp?.() ?? "";
  if (!isPrivateIPv4(address)) {
    publish({ status: "unavailable", address: "", port: 0, error: "no private TV address" });
    return;
  }
  publish({ status: "starting", address, port: PORT, error: "" });
  try {
    worker = new Worker("./wasm/management-socket.worker.js");
  } catch (error) {
    publish({ status: "unavailable", error: error instanceof Error ? error.message : String(error) });
    return;
  }
  worker.onerror = ({ message }) => failWorker(message);
  worker.onmessage = ({ data }) => {
    const message = data as Record<string, unknown>;
    if (message.type === "listening") {
      publish({ status: "listening", address: String(message.address), port: Number(message.port) });
    } else if (message.type === "error") {
      failWorker(String(message.reason));
    } else if (message.type === "stopped") {
      finishStop();
    } else if (message.type === "request") {
      const request = message as unknown as WorkerRequest;
      void routePhoneRequest(request).then((response) => {
        worker?.postMessage({ type: "response", id: request.id, ...response });
      });
    }
  };
  worker.postMessage({ type: "start", address, port: PORT });
}

export function stopPhoneManagement(): Promise<void> {
  if (!worker) return Promise.resolve();
  if (stopPromise) return stopPromise;
  stopPromise = new Promise((resolve) => {
    stopResolve = resolve;
    worker?.postMessage({ type: "stop" });
    stopTimer = window.setTimeout(finishStop, STOP_TIMEOUT_MS);
  });
  return stopPromise;
}
