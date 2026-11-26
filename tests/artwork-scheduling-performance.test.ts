import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function artwork() {
  vi.resetModules();
  const capacity = { loads: 1, decodes: 1, prefetch: 1 };
  const workload = vi.fn(() => capacity);
  let notifyCapacity = () => {};
  vi.doMock("../src/services/workload", () => ({
    artworkWorkload: workload,
    observeArtworkWorkload: (listener: () => void) => {
      notifyCapacity = listener;
      return () => {};
    },
    recordArtworkDecode: () => {},
    recordArtworkLoad: () => {},
    trackArtworkWork: () => () => {},
  }));
  vi.doMock("../src/services/disk", () => ({
    read: async () => null,
    write: async () => true,
  }));
  vi.doMock("../src/services/idle", () => ({
    whenIdle: () => () => {},
  }));
  vi.doMock("../src/services/artwork-operations", () => ({
    performArtworkOperation: async () =>
      ({ width: 192, height: 288, close: vi.fn() }) as unknown as ImageBitmap,
  }));
  const service = await import("../src/services/artwork");
  return { service, workload, notifyCapacity: () => notifyCapacity() };
}

const poster = (name: string) => ({
  url: `https://images.example/${name}.jpg`,
  kind: "poster" as const,
  width: 192,
  height: 288,
});

test("empty lanes do not consult capacity on completion or policy notifications", async () => {
  const { service, workload, notifyCapacity } = await artwork();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("image")),
  );
  try {
    notifyCapacity();
    expect(workload).not.toHaveBeenCalled();
    const entry = await service.loadArtwork({ ...poster("single"), eager: false });
    expect(entry).not.toBeNull();
    expect(workload).toHaveBeenCalledTimes(2);
    workload.mockClear();
    notifyCapacity();
    expect(workload).not.toHaveBeenCalled();
  } finally {
    service.releaseAllArtwork();
  }
});

test("urgent work preserves unclaimed load waiters and runs ahead of them", async () => {
  const { service } = await artwork();
  let finishFirst = () => {};
  const fetcher = vi.fn((url: string) => {
    if (url.endsWith("/first.jpg")) {
      return new Promise<Response>((resolve) => {
        finishFirst = () => resolve(new Response("image"));
      });
    }
    return Promise.resolve(new Response("image"));
  });
  vi.stubGlobal("fetch", fetcher);
  const first = poster("first");
  const current = poster("current");
  const nearby = [poster("nearby-0"), poster("nearby-1")];
  service.claimArtwork(first);
  const active = service.loadArtwork(first);
  const warming = nearby.map((request) => service.loadArtwork({ ...request, eager: false }));
  service.claimArtwork(current);
  const urgent = service.loadArtwork(current);
  try {
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(service.loadArtwork({ ...nearby[0], eager: false })).toBe(warming[0]);
    finishFirst();
    const entries = await Promise.all([active, urgent, ...warming]);
    expect(entries.every((entry) => entry !== null)).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      first.url,
      current.url,
      ...nearby.map((request) => request.url),
    ]);
  } finally {
    finishFirst();
    service.releaseAllArtwork();
    await Promise.all([active, urgent, ...warming]);
  }
});
