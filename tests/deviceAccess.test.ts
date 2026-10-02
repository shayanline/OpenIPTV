import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  authenticateDevice,
  clearPairingSession,
  clearDeviceAccess,
  createPairingSession,
  hasPairedDevices,
  listPairedDevices,
  pairDevice,
  renamePairedDevice,
  revokePairedDevice,
  subscribePairedDevices,
} from "../src/services/deviceAccess";

const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.clear();
  clearDeviceAccess();
  vi.restoreAllMocks();
});

describe("device pairing", () => {
  test("creates a five minute session with a QR secret and six digit code", () => {
    const session = createPairingSession(NOW);

    expect(session.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.code).toMatch(/^\d{6}$/);
    expect(session.expiresAt).toBe(NOW + 5 * 60_000);
  });

  test("rejects a session after it expires", async () => {
    const session = createPairingSession(NOW);

    const result = await pairDevice(
      { secret: session.secret, name: "Living room device" },
      session.expiresAt,
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
    expect(hasPairedDevices()).toBe(false);
  });

  test("can cancel an active pairing session", async () => {
    const session = createPairingSession(NOW);

    clearPairingSession();

    expect(await pairDevice({ secret: session.secret, name: "Cancelled" }, NOW + 1)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  test("allows only one in-flight request to claim a pairing session", async () => {
    const session = createPairingSession(NOW);
    let release: (value: ArrayBuffer) => void = () => {};
    vi.spyOn(crypto.subtle, "digest").mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const first = pairDevice({ secret: session.secret, name: "First" }, NOW + 1);
    const second = pairDevice({ secret: session.secret, name: "Second" }, NOW + 1);
    release(new ArrayBuffer(32));

    expect((await first).ok).toBe(true);
    expect(await second).toEqual({ ok: false, reason: "unavailable" });
    expect(listPairedDevices()).toHaveLength(1);
  });

  test("cancellation rejects a pairing request that is still hashing", async () => {
    const session = createPairingSession(NOW);
    let release: (value: ArrayBuffer) => void = () => {};
    vi.spyOn(crypto.subtle, "digest").mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );

    const pairing = pairDevice({ secret: session.secret, name: "Cancelled" }, NOW + 1);
    clearPairingSession();
    release(new ArrayBuffer(32));

    expect(await pairing).toEqual({ ok: false, reason: "unavailable" });
    expect(listPairedDevices()).toEqual([]);
  });

  test("invalidates a session after one device pairs", async () => {
    const session = createPairingSession(NOW);
    const first = await pairDevice({ secret: session.secret, name: "First device" }, NOW + 1);
    const second = await pairDevice({ secret: session.secret, name: "Second device" }, NOW + 2);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "unavailable" });
    expect(listPairedDevices()).toHaveLength(1);
  });

  test("invalidates the code after five failed attempts", async () => {
    const session = createPairingSession(NOW);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await pairDevice({ code: "000000", name: "Unknown" }, NOW + attempt);
      expect(result.ok).toBe(false);
    }

    expect(await pairDevice({ code: session.code, name: "Too late" }, NOW + 6)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  test("stores only the credential verifier", async () => {
    const session = createPairingSession(NOW);
    const result = await pairDevice({ code: session.code, name: "Shayan's device" }, NOW + 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const stored = localStorage.getItem("openiptv.devices") ?? "";
    expect(stored).not.toContain(result.credential);
    expect(stored).toContain("credentialHash");
    expect(await authenticateDevice(result.deviceId, result.credential, NOW + 2)).toBe(true);
  });

  test("remembers, renames, and independently revokes multiple devices", async () => {
    const firstSession = createPairingSession(NOW);
    const first = await pairDevice({ secret: firstSession.secret, name: "Device one" }, NOW + 1);
    const secondSession = createPairingSession(NOW + 2);
    const second = await pairDevice({ secret: secondSession.secret, name: "Device two" }, NOW + 3);
    if (!first.ok || !second.ok) throw new Error("pairing failed");

    expect(renamePairedDevice(first.deviceId, "Kitchen device")).toBe(true);
    expect(revokePairedDevice(first.deviceId)).toBe(true);
    expect(listPairedDevices().map(({ name }) => name)).toEqual(["Device two"]);
    expect(await authenticateDevice(first.deviceId, first.credential, NOW + 4)).toBe(false);
    expect(await authenticateDevice(second.deviceId, second.credential, NOW + 4)).toBe(true);
  });

  test("publishes paired device changes for server lifecycle updates", async () => {
    const counts: number[] = [];
    const unsubscribe = subscribePairedDevices(() => counts.push(listPairedDevices().length));
    const session = createPairingSession(NOW);
    const paired = await pairDevice({ secret: session.secret, name: "Device" }, NOW + 1);
    if (!paired.ok) throw new Error("pairing failed");

    renamePairedDevice(paired.deviceId, "Renamed device");
    revokePairedDevice(paired.deviceId);
    unsubscribe();

    expect(counts).toEqual([1, 1, 0]);
  });

  test("ignores malformed persisted records", () => {
    localStorage.setItem("openiptv.devices", JSON.stringify([{ id: 3, credentialHash: null }]));

    expect(listPairedDevices()).toEqual([]);
    expect(hasPairedDevices()).toBe(false);
  });
});
