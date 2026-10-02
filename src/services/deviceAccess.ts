import { readJSON, remove, write } from "./store";

const KEY = "openiptv.devices";
const LEGACY_KEY = "openiptv.phones";
const SESSION_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
}

interface StoredDevice extends PairedDevice {
  credentialHash: string;
}

interface PairingSession extends PairingSessionView {
  attempts: number;
}

export interface PairingSessionView {
  secret: string;
  code: string;
  expiresAt: number;
}

export interface PairRequest {
  secret?: string;
  code?: string;
  name: string;
}

export type PairResult =
  | { ok: true; deviceId: string; credential: string }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

let session: PairingSession | null = null;
let sessionVersion = 0;
const deviceListeners = new Set<() => void>();

const notifyDevices = () => {
  for (const listener of deviceListeners) listener();
};

function random(bytes: number): Uint8Array {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return value;
}

function base64url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64url(new Uint8Array(hash));
}

function validDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.id === "string" &&
    typeof device.name === "string" &&
    typeof device.credentialHash === "string" &&
    typeof device.createdAt === "number" &&
    typeof device.lastUsedAt === "number"
  );
}

function storedDevices(): StoredDevice[] {
  const current = readJSON<unknown>(KEY, null);
  const value = current ?? readJSON<unknown>(LEGACY_KEY, []);
  const devices = Array.isArray(value) ? value.filter(validDevice) : [];
  if (current === null && devices.length) {
    persist(devices);
    remove(LEGACY_KEY);
  }
  return devices;
}

function persist(devices: StoredDevice[]): void {
  write(KEY, JSON.stringify(devices));
}

function publicDevice({ id, name, createdAt, lastUsedAt }: StoredDevice): PairedDevice {
  return { id, name, createdAt, lastUsedAt };
}

function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function subscribePairedDevices(listener: () => void): () => void {
  deviceListeners.add(listener);
  return () => deviceListeners.delete(listener);
}

export function clearPairingSession(): void {
  session = null;
  sessionVersion += 1;
}

export function hasPairingSession(now = Date.now()): boolean {
  if (session && now >= session.expiresAt) clearPairingSession();
  return session !== null;
}

export function createPairingSession(now = Date.now()): PairingSessionView {
  sessionVersion += 1;
  const secret = base64url(random(32));
  const code = String(new DataView(random(4).buffer).getUint32(0) % 1_000_000).padStart(6, "0");
  session = { secret, code, expiresAt: now + SESSION_MS, attempts: 0 };
  return { secret, code, expiresAt: session.expiresAt };
}

export async function pairDevice(input: PairRequest, now = Date.now()): Promise<PairResult> {
  if (!session) return { ok: false, reason: "unavailable" };
  if (now >= session.expiresAt) {
    clearPairingSession();
    return { ok: false, reason: "expired" };
  }

  const accepted =
    (typeof input.secret === "string" && equal(input.secret, session.secret)) ||
    (typeof input.code === "string" && equal(input.code, session.code));
  if (!accepted) {
    session.attempts += 1;
    if (session.attempts >= MAX_ATTEMPTS) clearPairingSession();
    return { ok: false, reason: "invalid" };
  }

  const claimedVersion = sessionVersion;
  session = null;
  const id = base64url(random(12));
  const credential = base64url(random(32));
  const credentialHash = await digest(credential);
  if (claimedVersion !== sessionVersion) return { ok: false, reason: "unavailable" };
  const device: StoredDevice = {
    id,
    name: input.name.trim() || "Device",
    credentialHash,
    createdAt: now,
    lastUsedAt: now,
  };
  persist([...storedDevices(), device]);
  notifyDevices();
  sessionVersion += 1;
  return { ok: true, deviceId: id, credential };
}

export async function authenticateDevice(
  id: string,
  credential: string,
  now = Date.now(),
): Promise<boolean> {
  const devices = storedDevices();
  const device = devices.find((candidate) => candidate.id === id);
  if (!device || !equal(await digest(credential), device.credentialHash)) return false;
  if (now - device.lastUsedAt >= 60_000) {
    device.lastUsedAt = now;
    persist(devices);
  }
  return true;
}

export function listPairedDevices(): PairedDevice[] {
  return storedDevices().map(publicDevice);
}

export function renamePairedDevice(id: string, name: string): boolean {
  const devices = storedDevices();
  const device = devices.find((candidate) => candidate.id === id);
  if (!device || !name.trim()) return false;
  device.name = name.trim();
  persist(devices);
  notifyDevices();
  return true;
}

export function revokePairedDevice(id: string): boolean {
  const devices = storedDevices();
  const remaining = devices.filter((device) => device.id !== id);
  if (remaining.length === devices.length) return false;
  persist(remaining);
  notifyDevices();
  return true;
}

export function hasPairedDevices(): boolean {
  return storedDevices().length > 0;
}

export function clearDeviceAccess(): void {
  clearPairingSession();
  remove(KEY);
  remove(LEGACY_KEY);
  notifyDevices();
}
