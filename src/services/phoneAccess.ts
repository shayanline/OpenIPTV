import { readJSON, remove, write } from "./store";

const KEY = "openiptv.phones";
const SESSION_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export interface PairedPhone {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
}

interface StoredPhone extends PairedPhone {
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
  | { ok: true; phoneId: string; credential: string }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

let session: PairingSession | null = null;

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

function validPhone(value: unknown): value is StoredPhone {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const phone = value as Record<string, unknown>;
  return (
    typeof phone.id === "string" &&
    typeof phone.name === "string" &&
    typeof phone.credentialHash === "string" &&
    typeof phone.createdAt === "number" &&
    typeof phone.lastUsedAt === "number"
  );
}

function storedPhones(): StoredPhone[] {
  const value = readJSON<unknown>(KEY, []);
  return Array.isArray(value) ? value.filter(validPhone) : [];
}

function persist(phones: StoredPhone[]): void {
  write(KEY, JSON.stringify(phones));
}

function publicPhone({ id, name, createdAt, lastUsedAt }: StoredPhone): PairedPhone {
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

export function createPairingSession(now = Date.now()): PairingSessionView {
  const secret = base64url(random(32));
  const code = String(new DataView(random(4).buffer).getUint32(0) % 1_000_000).padStart(6, "0");
  session = { secret, code, expiresAt: now + SESSION_MS, attempts: 0 };
  return { secret, code, expiresAt: session.expiresAt };
}

export async function pairPhone(input: PairRequest, now = Date.now()): Promise<PairResult> {
  if (!session) return { ok: false, reason: "unavailable" };
  if (now >= session.expiresAt) {
    session = null;
    return { ok: false, reason: "expired" };
  }

  const accepted =
    (typeof input.secret === "string" && equal(input.secret, session.secret)) ||
    (typeof input.code === "string" && equal(input.code, session.code));
  if (!accepted) {
    session.attempts += 1;
    if (session.attempts >= MAX_ATTEMPTS) session = null;
    return { ok: false, reason: "invalid" };
  }

  const id = base64url(random(12));
  const credential = base64url(random(32));
  const phone: StoredPhone = {
    id,
    name: input.name.trim() || "Phone",
    credentialHash: await digest(credential),
    createdAt: now,
    lastUsedAt: now,
  };
  persist([...storedPhones(), phone]);
  session = null;
  return { ok: true, phoneId: id, credential };
}

export async function authenticatePhone(
  id: string,
  credential: string,
  now = Date.now(),
): Promise<boolean> {
  const phones = storedPhones();
  const phone = phones.find((candidate) => candidate.id === id);
  if (!phone || !equal(await digest(credential), phone.credentialHash)) return false;
  phone.lastUsedAt = now;
  persist(phones);
  return true;
}

export function listPairedPhones(): PairedPhone[] {
  return storedPhones().map(publicPhone);
}

export function renamePairedPhone(id: string, name: string): boolean {
  const phones = storedPhones();
  const phone = phones.find((candidate) => candidate.id === id);
  if (!phone || !name.trim()) return false;
  phone.name = name.trim();
  persist(phones);
  return true;
}

export function revokePairedPhone(id: string): boolean {
  const phones = storedPhones();
  const remaining = phones.filter((phone) => phone.id !== id);
  if (remaining.length === phones.length) return false;
  persist(remaining);
  return true;
}

export function hasPairedPhones(): boolean {
  return storedPhones().length > 0;
}

export function clearPhoneAccess(): void {
  session = null;
  remove(KEY);
}
