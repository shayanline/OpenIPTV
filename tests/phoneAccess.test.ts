import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  authenticatePhone,
  clearPhoneAccess,
  createPairingSession,
  hasPairedPhones,
  listPairedPhones,
  pairPhone,
  renamePairedPhone,
  revokePairedPhone,
} from "../src/services/phoneAccess";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  clearPhoneAccess();
  vi.restoreAllMocks();
});

describe("phone pairing", () => {
  test("creates a five minute session with a QR secret and six digit code", () => {
    const session = createPairingSession(NOW);

    expect(session.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.code).toMatch(/^\d{6}$/);
    expect(session.expiresAt).toBe(NOW + 5 * 60_000);
  });

  test("rejects a session after it expires", async () => {
    const session = createPairingSession(NOW);

    const result = await pairPhone(
      { secret: session.secret, name: "Living room phone" },
      session.expiresAt,
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(hasPairedPhones()).toBe(false);
  });

  test("invalidates a session after one phone pairs", async () => {
    const session = createPairingSession(NOW);
    const first = await pairPhone({ secret: session.secret, name: "First phone" }, NOW + 1);
    const second = await pairPhone({ secret: session.secret, name: "Second phone" }, NOW + 2);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "unavailable" });
    expect(listPairedPhones()).toHaveLength(1);
  });

  test("invalidates the code after five failed attempts", async () => {
    const session = createPairingSession(NOW);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await pairPhone({ code: "000000", name: "Unknown" }, NOW + attempt);
      expect(result.ok).toBe(false);
    }

    expect(await pairPhone({ code: session.code, name: "Too late" }, NOW + 6)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  test("stores only the credential verifier", async () => {
    const session = createPairingSession(NOW);
    const result = await pairPhone({ code: session.code, name: "Shayan's phone" }, NOW + 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = localStorage.getItem("openiptv.phones") ?? "";
    expect(stored).not.toContain(result.credential);
    expect(stored).toContain("credentialHash");
    expect(await authenticatePhone(result.phoneId, result.credential, NOW + 2)).toBe(true);
  });

  test("remembers, renames, and independently revokes multiple phones", async () => {
    const firstSession = createPairingSession(NOW);
    const first = await pairPhone({ secret: firstSession.secret, name: "Phone one" }, NOW + 1);
    const secondSession = createPairingSession(NOW + 2);
    const second = await pairPhone({ secret: secondSession.secret, name: "Phone two" }, NOW + 3);
    if (!first.ok || !second.ok) throw new Error("pairing failed");

    expect(renamePairedPhone(first.phoneId, "Kitchen phone")).toBe(true);
    expect(revokePairedPhone(first.phoneId)).toBe(true);
    expect(listPairedPhones().map(({ name }) => name)).toEqual(["Phone two"]);
    expect(await authenticatePhone(first.phoneId, first.credential, NOW + 4)).toBe(false);
    expect(await authenticatePhone(second.phoneId, second.credential, NOW + 4)).toBe(true);
  });

  test("ignores malformed persisted records", () => {
    localStorage.setItem("openiptv.phones", JSON.stringify([{ id: 3, credentialHash: null }]));

    expect(listPairedPhones()).toEqual([]);
    expect(hasPairedPhones()).toBe(false);
  });
});
