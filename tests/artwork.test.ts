import assert from "node:assert/strict";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ArtworkWorkload } from "../src/services/workload";

const disk = new Map<string, Blob | string>();
const diskWrites: string[] = [];
let capacity: ArtworkWorkload;
const capacityObservers = new Set<() => void>();

const setCapacity = (next: Partial<ArtworkWorkload>) => {
  capacity = { ...capacity, ...next };
  for (const observer of capacityObservers) observer();
};

async function artwork(limits: Partial<ArtworkWorkload> = {}) {
  vi.resetModules();
  capacity = { loads: 18, decodes: 2, prefetch: 18, ...limits };
  capacityObservers.clear();
  // Ownership races keep fixed stress limits independent of adaptive policy measurements.
  vi.doMock("../src/services/workload", () => ({
    artworkWorkload: () => capacity,
    observeArtworkWorkload: (observer: () => void) => {
      capacityObservers.add(observer);
      return () => capacityObservers.delete(observer);
    },
    recordArtworkDecode: () => {},
    recordArtworkLoad: () => {},
    trackArtworkWork: () => () => {},
  }));
  vi.doMock("../src/services/disk", () => ({
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: Blob | string) => {
      diskWrites.push(key);
      disk.set(key, value);
      return true;
    },
  }));
  return import("../src/services/artwork");
}

beforeEach(() => {
  disk.clear();
  diskWrites.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => vi.restoreAllMocks());

const bitmap = (width: number, height: number) => {
  const close = vi.fn();
  return {
    value: { width, height, close } as unknown as ImageBitmap,
    close,
  };
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const posterRequest = (url: string) => ({
  url,
  kind: "poster" as const,
  width: 192,
  height: 288,
});

const logoRequest = (url: string) => ({
  url,
  kind: "logo" as const,
  width: 76,
  height: 48,
});

test.each([
  {
    name: "standard detail",
    box: { width: 360, height: 540 },
    density: 1,
    expected: { width: 360, height: 540 },
  },
  {
    name: "Retina detail",
    box: { width: 360, height: 540 },
    density: 2,
    expected: { width: 720, height: 1080 },
  },
  {
    name: "Retina episode",
    box: { width: 512, height: 288 },
    density: 2,
    expected: { width: 1024, height: 576 },
  },
  {
    name: "density ceiling",
    box: { width: 360, height: 540 },
    density: 4,
    expected: { width: 720, height: 1080 },
  },
  {
    name: "viewer pixel ceiling",
    box: { width: 1920, height: 1080 },
    density: 2,
    expected: { width: 1920, height: 1080 },
  },
])(
  "$name preserves display detail within the pixel budget",
  async ({ box, density, expected }) => {
    const { displayArtworkBox } = await artwork();
    expect(displayArtworkBox(box, density)).toEqual(expected);
  },
);

const smallPng = () =>
  new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yD1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );

test("a larger episode source bypasses the cached thumbnail and shares the canonical image entry", async () => {
  const service = await artwork();
  const thumbnail = "https://image.tmdb.org/t/p/w185/still.jpg";
  const source = "https://image.tmdb.org/t/p/w780/still.jpg";
  disk.set(`poster:512x288:contain|${thumbnail}`, new Blob([smallPng()]));
  const normalized = bitmap(512, 288);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => normalized.value),
  );
  const fetch = vi.fn(async () => new Response(smallPng()));
  vi.stubGlobal("fetch", fetch);
  const request = {
    url: thumbnail,
    kind: "poster" as const,
    width: 512,
    height: 288,
    fit: "contain" as const,
  };
  try {
    const loaded = await service.loadArtwork(request);
    expect(loaded?.bitmap).toBe(normalized.value);
    expect(fetch).toHaveBeenCalledWith(source, expect.any(Object));
    expect(await service.loadArtwork({ ...request, url: source })).toBe(loaded);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(disk.has(`poster:512x288:contain|${thumbnail}`)).toBe(true);
  } finally {
    service.releaseAllArtwork();
  }
});

test.each([undefined, "contain"] as const)(
  "small PNG fit %s normalizes directly from the encoded image",
  async (fit) => {
    const service = await artwork();
    const normalized = bitmap(32, 32);
    const decode = vi.fn(async () => normalized.value);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(smallPng())),
    );
    const entry = await service.loadArtwork({
      ...posterRequest("https://images.example/small.png"),
      width: 32,
      height: 32,
      fit,
      eager: false,
    });
    expect(entry?.bitmap).toBe(normalized.value);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[0]).toEqual(
      fit
        ? [expect.any(Blob), { resizeWidth: 32, resizeQuality: "high" }]
        : [
            expect.any(Blob),
            0,
            0,
            1,
            1,
            { resizeWidth: 32, resizeHeight: 32, resizeQuality: "high" },
          ],
    );
    service.releaseAllArtwork();
    expect(normalized.close).toHaveBeenCalledTimes(1);
  },
);

test.each(["exif", "truncated"] as const)(
  "a %s PNG retains browser dimension and orientation handling",
  async (variant) => {
    const service = await artwork();
    const png = smallPng();
    let bytes: Uint8Array<ArrayBuffer>;
    if (variant === "truncated") {
      bytes = png.slice(0, -1);
    } else {
      bytes = new Uint8Array(png.length + 12);
      bytes.set(png.subarray(0, -12));
      bytes.set([0, 0, 0, 0, 101, 88, 73, 102, 0, 0, 0, 0], png.length - 12);
      bytes.set(png.subarray(-12), png.length);
    }
    const source = bitmap(1, 1);
    const normalized = bitmap(32, 32);
    const decode = vi
      .fn()
      .mockResolvedValueOnce(source.value)
      .mockResolvedValueOnce(normalized.value);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    const entry = await service.loadArtwork({
      ...posterRequest("https://images.example/fallback.png"),
      width: 32,
      height: 32,
      eager: false,
    });
    expect(entry?.bitmap).toBe(normalized.value);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(decode.mock.calls[0]).toEqual([expect.any(Blob)]);
    expect(decode.mock.calls[1][0]).toBe(source.value);
    expect(source.close).toHaveBeenCalledTimes(1);
    service.releaseAllArtwork();
  },
);

test.each([undefined, "cover"] as const)(
  "poster fit %s retains the default centre crop",
  async (fit) => {
    const service = await artwork();
    const source = bitmap(400, 400);
    const cropped = bitmap(192, 288);
    const decode = vi
      .fn()
      .mockResolvedValueOnce(source.value)
      .mockResolvedValueOnce(cropped.value);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    try {
      const entry = await service.loadArtwork({
        ...posterRequest("https://images.example/movie.jpg"),
        fit,
        eager: false,
      });
      expect(entry?.bitmap).toBe(cropped.value);
      expect(decode.mock.calls[0]).toEqual([expect.any(Blob)]);
      expect(decode.mock.calls[1]).toEqual([
        source.value,
        (400 - 400 * (192 / 288)) / 2,
        0,
        400 * (192 / 288),
        400,
        { resizeWidth: 192, resizeHeight: 288, resizeQuality: "high" },
      ]);
      expect(source.close).toHaveBeenCalledTimes(1);
    } finally {
      service.releaseAllArtwork();
    }
  },
);

test("logos retain their complete image without an explicit fit", async () => {
  const service = await artwork();
  const partial = bitmap(76, 152);
  const fitted = bitmap(24, 48);
  const decode = vi
    .fn()
    .mockResolvedValueOnce(partial.value)
    .mockResolvedValueOnce(fitted.value);
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  try {
    const entry = await service.loadArtwork({
      ...logoRequest("https://images.example/tall-logo.png"),
      eager: false,
    });
    expect(entry?.bitmap).toBe(fitted.value);
    expect(decode.mock.calls).toEqual([
      [expect.any(Blob), { resizeWidth: 76, resizeQuality: "high" }],
      [partial.value, { resizeHeight: 48, resizeQuality: "high" }],
    ]);
    expect(partial.close).toHaveBeenCalledTimes(1);
  } finally {
    service.releaseAllArtwork();
  }
});

test.each([
  { name: "portrait", intermediate: [512, 1024], fitted: [144, 288] },
  { name: "wide", intermediate: [512, 128], fitted: [512, 128] },
])(
  "contain posters preserve the complete $name image during decode",
  async ({ intermediate, fitted }) => {
    const service = await artwork();
    const partial = bitmap(intermediate[0], intermediate[1]);
    const final = intermediate[1] > 288 ? bitmap(fitted[0], fitted[1]) : partial;
    const decode = vi.fn().mockResolvedValueOnce(partial.value).mockResolvedValue(final.value);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    vi.stubGlobal("createImageBitmap", decode);
    try {
      const entry = await service.loadArtwork({
        url: "https://images.example/episode.jpg",
        kind: "poster",
        width: 512,
        height: 288,
        fit: "contain",
        eager: false,
      });
      expect(entry?.bitmap).toBe(final.value);
      expect(entry?.bytes).toBe(fitted[0] * fitted[1] * 4);
      expect(decode.mock.calls[0]).toEqual([
        expect.any(Blob),
        { resizeWidth: 512, resizeQuality: "high" },
      ]);
      if (partial !== final) {
        expect(decode).toHaveBeenCalledTimes(2);
        expect(decode.mock.calls[1]).toEqual([
          partial.value,
          { resizeHeight: 288, resizeQuality: "high" },
        ]);
        expect(partial.close).toHaveBeenCalledTimes(1);
      } else expect(decode).toHaveBeenCalledTimes(1);
      expect(final.close).not.toHaveBeenCalled();
    } finally {
      service.releaseAllArtwork();
    }
  },
);

test("cover and contain isolate disk derivatives, inflight work, claims and subscriptions", async () => {
  const service = await artwork();
  const cover = {
    ...posterRequest("https://images.example/shared-episode.jpg"),
    width: 512,
  };
  const contain = { ...cover, fit: "contain" as const };
  const oldDerivative = new Blob(["cropped"]);
  disk.set(`poster:512x288|${cover.url}`, oldDerivative);
  const cropped = bitmap(512, 288);
  const complete = bitmap(512, 128);
  const decode = vi
    .fn()
    .mockResolvedValueOnce(cropped.value)
    .mockResolvedValueOnce(complete.value);
  let finishFetch: (() => void) | undefined;
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishFetch = () => resolve(new Response(new Blob(["complete"])));
        }),
    ),
  );
  const coverListener = vi.fn();
  const containListener = vi.fn();
  const unsubscribeCover = service.subscribeArtwork(cover, coverListener);
  const unsubscribeContain = service.subscribeArtwork(contain, containListener);
  service.claimArtwork(cover);
  service.claimArtwork(contain);
  const coverWork = service.loadArtwork(cover);
  const containWork = service.loadArtwork(contain);
  try {
    expect(containWork).not.toBe(coverWork);
    expect(service.loadArtwork(contain)).toBe(containWork);
    const covered = await coverWork;
    await vi.waitFor(() => expect(finishFetch).toBeDefined());
    expect(covered?.bitmap).toBe(cropped.value);
    expect(decode.mock.calls[0]).toEqual([oldDerivative]);
    expect(service.artworkOf({ ...cover, fit: "cover" })).toBe(covered);
    expect(service.artworkOf(contain)).toBeNull();
    expect(coverListener).toHaveBeenCalledTimes(1);
    expect(containListener).not.toHaveBeenCalled();
    service.releaseArtwork(cover);
    finishFetch!();
    const contained = await containWork;
    expect(contained?.bitmap).toBe(complete.value);
    expect(service.artworkOf(cover)).toBe(covered);
    expect(service.artworkOf(contain)).toBe(contained);
    expect(coverListener).toHaveBeenCalledTimes(1);
    expect(containListener).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(decode.mock.calls[1][1]).toEqual({ resizeWidth: 512, resizeQuality: "high" });
  } finally {
    finishFetch?.();
    unsubscribeCover();
    unsubscribeContain();
    service.releaseAllArtwork();
    await Promise.all([coverWork, containWork]);
  }
});

test.each(["intermediate", "final"] as const)(
  "contain cancellation closes a late %s bitmap while the same request reloads",
  async (stage) => {
    const service = await artwork();
    const partial = bitmap(512, 1024);
    const fitted = bitmap(144, 288);
    const replacement = bitmap(512, 128);
    let finishDecode: (() => void) | undefined;
    const late = new Promise<ImageBitmap>((resolve) => {
      finishDecode = () => resolve(stage === "intermediate" ? partial.value : fitted.value);
    });
    const decode = vi.fn();
    if (stage === "intermediate") decode.mockReturnValueOnce(late);
    else decode.mockResolvedValueOnce(partial.value).mockReturnValueOnce(late);
    decode.mockResolvedValue(replacement.value);
    vi.stubGlobal("createImageBitmap", decode);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    const request = {
      ...posterRequest("https://images.example/reloaded-episode.jpg"),
      width: 512,
      fit: "contain" as const,
    };
    const listener = vi.fn();
    const unsubscribe = service.subscribeArtwork(request, listener);
    service.claimArtwork(request);
    const cancelled = service.loadArtwork(request);
    try {
      await vi.waitFor(() =>
        expect(decode).toHaveBeenCalledTimes(stage === "intermediate" ? 1 : 2),
      );
      service.releaseArtwork(request);
      service.claimArtwork(request);
      const fresh = await service.loadArtwork(request);
      expect(fresh?.bitmap).toBe(replacement.value);
      finishDecode!();
      expect(await cancelled).toBeNull();
      expect(partial.close).toHaveBeenCalledTimes(1);
      expect(fitted.close).toHaveBeenCalledTimes(stage === "final" ? 1 : 0);
      expect(replacement.close).not.toHaveBeenCalled();
      expect(service.artworkOf(request)).toBe(fresh);
      expect(await service.loadArtwork(request)).toBe(fresh);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      finishDecode?.();
      unsubscribe();
      service.releaseAllArtwork();
      await cancelled;
    }
  },
);

test.each(["poster", "logo"] as const)(
  "%s cache subscriptions notify only their request key and stop after unsubscribe",
  async (kind) => {
    const service = await artwork();
    const requestOf = kind === "poster" ? posterRequest : logoRequest;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        async () => bitmap(kind === "poster" ? 192 : 76, kind === "poster" ? 288 : 48).value,
      ),
    );
    const first = requestOf("https://images.example/subscribed-first.jpg");
    const second = requestOf("https://images.example/subscribed-second.jpg");
    const firstListener = vi.fn(() => service.artworkOf(first));
    const secondListener = vi.fn(() => service.artworkOf(second));
    const removedListener = vi.fn();
    const unsubscribeFirst = service.subscribeArtwork(first, firstListener);
    const unsubscribeSecond = service.subscribeArtwork(second, secondListener);
    const unsubscribeRemoved = service.subscribeArtwork(second, removedListener);
    unsubscribeRemoved();
    try {
      const firstEntry = await service.loadArtwork({ ...first, eager: false });
      expect(firstEntry).not.toBeNull();
      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(firstListener.mock.results[0].value).toBe(firstEntry);
      expect(secondListener).not.toHaveBeenCalled();
      const secondEntry = await service.loadArtwork({ ...second, eager: false });
      expect(secondEntry).not.toBeNull();
      expect(secondListener).toHaveBeenCalledTimes(1);
      expect(secondListener.mock.results[0].value).toBe(secondEntry);
      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(removedListener).not.toHaveBeenCalled();
      unsubscribeFirst();
      unsubscribeSecond();
      service.releaseAllArtwork();
      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(secondListener).toHaveBeenCalledTimes(1);
      expect(removedListener).not.toHaveBeenCalled();
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
      unsubscribeRemoved();
      service.releaseAllArtwork();
    }
  },
);

test("cache subscriptions do not fetch or claim artwork", async () => {
  const service = await artwork();
  const fetcher = vi.fn(async () => new Response(new Blob(["image"])));
  vi.stubGlobal("fetch", fetcher);
  const request = posterRequest("https://images.example/observation-only.jpg");
  const listener = vi.fn();
  const unsubscribe = service.subscribeArtwork(request, listener);
  try {
    await settle();
    expect(fetcher).not.toHaveBeenCalled();
    expect(service.artworkOf(request)).toBeNull();
    expect(await service.loadArtwork(request)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    service.releaseAllArtwork();
  }
});

test("cache clearing publishes null snapshots and subscriptions survive owner reset", async () => {
  const service = await artwork();
  const images: ReturnType<typeof bitmap>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      const image = bitmap(192, 288);
      images.push(image);
      return image.value;
    }),
  );
  const request = posterRequest("https://images.example/reset-subscription.jpg");
  const listener = vi.fn(() => service.artworkOf(request));
  const unsubscribe = service.subscribeArtwork(request, listener);
  try {
    const initial = await service.loadArtwork({ ...request, eager: false });
    expect(initial).not.toBeNull();
    expect(listener.mock.results.map((result) => result.value)).toEqual([initial]);
    service.releaseAllArtwork();
    expect(images[0].close).toHaveBeenCalledTimes(1);
    expect(listener.mock.results.map((result) => result.value)).toEqual([initial, null]);
    const fresh = await service.loadArtwork({ ...request, eager: false });
    expect(fresh).not.toBeNull();
    expect(fresh).not.toBe(initial);
    expect(listener.mock.results.map((result) => result.value)).toEqual([initial, null, fresh]);
    unsubscribe();
    service.releaseAllArtwork();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(images.every((image) => image.close.mock.calls.length === 1)).toBe(true);
  } finally {
    unsubscribe();
    service.releaseAllArtwork();
  }
});

test("poster eviction publishes a null snapshot without pinning an observed entry", async () => {
  const service = await artwork();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const request = posterRequest("https://images.example/observed-eviction.jpg");
  const listener = vi.fn(() => service.artworkOf(request));
  const unsubscribe = service.subscribeArtwork(request, listener);
  try {
    const initial = await service.loadArtwork({ ...request, eager: false });
    expect(initial).not.toBeNull();
    for (let index = 0; index < 54; index += 1) {
      await service.loadArtwork({
        ...posterRequest(`https://images.example/eviction-${index}.jpg`),
        eager: false,
      });
    }
    expect(service.artworkOf(request)).toBeNull();
    expect(initial!.bitmap.close).toHaveBeenCalledTimes(1);
    expect(listener.mock.results.map((result) => result.value)).toEqual([initial, null]);
  } finally {
    unsubscribe();
    service.releaseAllArtwork();
  }
});

test("a cancelled late bitmap closes without publishing a cache snapshot", async () => {
  const service = await artwork();
  const image = bitmap(192, 288);
  let finishDecode: (() => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finishDecode = () => resolve(image.value);
        }),
    ),
  );
  const request = posterRequest("https://images.example/cancelled-subscription.jpg");
  const listener = vi.fn();
  const unsubscribe = service.subscribeArtwork(request, listener);
  service.claimArtwork(request);
  const pending = service.loadArtwork(request);
  try {
    await vi.waitFor(() => expect(finishDecode).toBeDefined());
    service.releaseArtwork(request);
    finishDecode!();
    expect(await pending).toBeNull();
    expect(image.close).toHaveBeenCalledTimes(1);
    expect(service.artworkOf(request)).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    finishDecode?.();
    await pending;
    unsubscribe();
    service.releaseAllArtwork();
  }
});

function holdFirstDecodeLanes(onDecode?: (source: Blob) => void) {
  const releases: Array<() => void> = [];
  let calls = 0;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((source: Blob) => {
      onDecode?.(source);
      calls += 1;
      return calls <= 2
        ? new Promise<ImageBitmap>((resolve) => {
            releases.push(() => resolve(bitmap(192, 288).value));
          })
        : Promise.resolve(bitmap(192, 288).value);
    }),
  );
  return () => {
    for (const release of releases) release();
  };
}

test("a poster can rejoin its queue immediately after leaving view", async () => {
  const service = await artwork();
  const releaseDecodes = holdFirstDecodeLanes();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  const active = [0, 1].map((index) =>
    service.loadArtwork({
      ...posterRequest(`https://images.example/active-${index}.jpg`),
      eager: false,
    }),
  );
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  const request = posterRequest("https://images.example/returning.jpg");
  service.claimArtwork(request);
  const previous = service.loadArtwork(request);
  service.releaseArtwork(request);
  service.claimArtwork(request);
  const returning = service.loadArtwork(request);

  try {
    expect(returning).not.toBe(previous);
    expect(await previous).toBeNull();
    expect(service.loadArtwork(request)).toBe(returning);
    releaseDecodes();
    expect((await returning) !== null).toBe(true);
    expect(service.artworkOf(request) !== null).toBe(true);
  } finally {
    releaseDecodes();
    await Promise.all([...active, previous, returning]);
    service.releaseArtwork(request);
    service.releaseAllArtwork();
  }
});

test("an already queued poster is promoted when it becomes visible", async () => {
  const service = await artwork();
  const sources = new Map<Blob, string>();
  const decoded: string[] = [];
  const releaseDecodes = holdFirstDecodeLanes((blob) => decoded.push(sources.get(blob)!));
  const fetcher = vi.fn(async (input: string | URL) => {
    const blob = new Blob(["image"]);
    sources.set(blob, String(input));
    return { ok: true, headers: new Headers(), body: null, blob: async () => blob } as Response;
  });
  vi.stubGlobal("fetch", fetcher);
  const active = [0, 1].map((index) => {
    const request = posterRequest(`https://images.example/active-${index}.jpg`);
    service.claimArtwork(request);
    return service.loadArtwork({ ...request, eager: false });
  });
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  const earlierRequest = posterRequest("https://images.example/earlier.jpg");
  service.claimArtwork(earlierRequest);
  const earlier = service.loadArtwork({ ...earlierRequest, eager: false });
  const request = posterRequest("https://images.example/current.jpg");
  const warming = service.loadArtwork({ ...request, eager: false });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await settle();
  service.claimArtwork(request);
  const visible = service.loadArtwork(request);

  try {
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    releaseDecodes();
    await Promise.all(active);
    await vi.waitFor(() => expect(decoded.length).toBe(4));
    expect(decoded[2]).toBe(request.url);
    expect(decoded[3]).toBe(earlierRequest.url);
    expect(visible).toBe(warming);
    expect((await visible) !== null).toBe(true);
  } finally {
    releaseDecodes();
    await Promise.all([...active, earlier, warming, visible]);
    service.releaseArtwork(request);
    service.releaseAllArtwork();
  }
});

test.each(["offscreen", "warming"] as const)(
  "current artwork starts before obsolete %s responses finish",
  async (source) => {
    const service = await artwork();
    const signals: AbortSignal[] = [];
    const finish: Array<() => void> = [];
    let activeFetches = 0;
    let maximumFetches = 0;
    const fetcher = vi.fn((input: string | URL, init?: RequestInit) => {
      activeFetches += 1;
      maximumFetches = Math.max(maximumFetches, activeFetches);
      if (!String(input).includes("/obsolete-")) {
        activeFetches -= 1;
        return Promise.resolve(new Response(new Blob(["image"])));
      }
      const signal = init?.signal;
      if (!signal) throw new Error("Artwork fetch has no abort signal");
      signals.push(signal);
      return new Promise<Response>((resolve, reject) => {
        let settled = false;
        finish.push(() => {
          if (settled) return;
          settled = true;
          activeFetches -= 1;
          resolve(new Response(new Blob(["image"])));
        });
        signal.addEventListener(
          "abort",
          () => {
            if (settled) return;
            settled = true;
            activeFetches -= 1;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap(192, 288).value),
    );
    const obsolete = [0, 1].map((index) =>
      posterRequest(`https://images.example/obsolete-${index}.jpg`),
    );
    const previous = obsolete.map((request) => {
      if (source === "offscreen") service.claimArtwork(request);
      return service.loadArtwork({ ...request, eager: source === "offscreen" });
    });
    const request = posterRequest("https://images.example/displayed.jpg");
    let current: ReturnType<typeof service.loadArtwork> | undefined;

    try {
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      service.claimArtwork(request);
      current = service.loadArtwork(request);
      if (source === "offscreen") {
        for (const old of obsolete) service.releaseArtwork(old);
      }
      await vi.waitFor(() => {
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(fetcher.mock.calls.some(([url]) => String(url) === request.url)).toBe(true);
      });
      expect((await current) !== null).toBe(true);
      expect(maximumFetches).toBeLessThanOrEqual(18);
    } finally {
      for (const release of finish) release();
      await Promise.all([...previous, ...(current ? [current] : [])]);
      service.releaseArtwork(request);
      service.releaseAllArtwork();
    }
  },
);

test("two decode lanes accept mixed logo and poster work while all three loads start", async () => {
  const service = await artwork();
  const releases: Array<() => void> = [];
  const fetch = vi.fn(async () => new Response(new Blob(["image"])));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((...args: unknown[]) =>
      args.length > 1
        ? Promise.resolve(bitmap(76, 48).value)
        : new Promise<ImageBitmap>((resolve) => {
            releases.push(() => resolve(bitmap(76, 48).value));
          }),
    ),
  );

  const logo = service.loadArtwork({
    ...logoRequest("https://images.example/logo.png"),
    eager: false,
  });
  const poster = service.loadArtwork({
    ...posterRequest("https://images.example/poster.jpg"),
    eager: false,
  });
  const queued = service.loadArtwork({
    ...posterRequest("https://images.example/queued.jpg"),
    eager: false,
  });
  await vi.waitFor(() => assert.equal(releases.length, 2));

  assert.equal(fetch.mock.calls.length, 3);
  releases.shift()?.();
  releases.shift()?.();
  await Promise.all([logo, poster, queued]);
  service.releaseAllArtwork();
});

test("capacity growth drains queued loads and backoff waits for excess active jobs to finish", async () => {
  const service = await artwork({ loads: 2, decodes: 1 });
  const responses: Array<() => void> = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const requests = Array.from({ length: 6 }, (_, index) =>
    posterRequest(`https://images.example/adaptive-${index}.jpg`),
  );
  const work = requests.map((request) => {
    service.claimArtwork(request);
    return service.loadArtwork(request);
  });
  try {
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    setCapacity({ loads: 4 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    setCapacity({ loads: 2 });
    responses[0]();
    await work[0];
    expect(fetcher).toHaveBeenCalledTimes(4);
    responses[1]();
    await work[1];
    expect(fetcher).toHaveBeenCalledTimes(4);
    responses[2]();
    await work[2];
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
    responses[3]();
    await work[3];
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
    responses[4]();
    responses[5]();
    expect((await Promise.all(work)).every(Boolean)).toBe(true);
  } finally {
    service.releaseAllArtwork();
  }
});

test("visible promotion bypasses a saturated prefetch quota without losing its shared job", async () => {
  const service = await artwork({ loads: 4, decodes: 1, prefetch: 1 });
  const responses: Array<() => void> = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const requests = Array.from({ length: 3 }, (_, index) =>
    posterRequest(`https://images.example/prefetch-${index}.jpg`),
  );
  const work = requests.map((request) => {
    service.claimArtwork(request);
    return service.loadArtwork({ ...request, eager: false });
  });
  try {
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const promoted = service.loadArtwork(requests[1]);
    expect(promoted).toBe(work[1]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    setCapacity({ prefetch: 2 });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    for (const respond of responses) respond();
    expect((await Promise.all(work)).every(Boolean)).toBe(true);
  } finally {
    service.releaseAllArtwork();
  }
});

test("idle warming gains parallel slots and cancellation prevents later batches", async () => {
  const service = await artwork({ loads: 8, decodes: 2, prefetch: 1 });
  const idle: Array<() => void> = [];
  const responses: Array<() => void> = [];
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  vi.stubGlobal("cancelIdleCallback", vi.fn());
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const requests = Array.from({ length: 5 }, (_, index) =>
    posterRequest(`https://images.example/idle-${index}.jpg`),
  );
  const stop = service.warmArtworkChain(requests);
  try {
    idle.shift()?.();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    setCapacity({ prefetch: 3 });
    idle.shift()?.();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    stop();
    for (const respond of responses) respond();
    await vi.waitFor(() => {
      for (const request of requests.slice(0, 3)) {
        expect(service.artworkOf(request)).not.toBeNull();
      }
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    stop();
    service.releaseAllArtwork();
  }
});

test("eighteen pending downloads hold every load lane until one completes", async () => {
  const service = await artwork();
  const responses: Array<() => void> = [];
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const work = Array.from({ length: 19 }, (_, index) =>
    service.loadArtwork({
      ...posterRequest(`https://images.example/load-${index}.jpg`),
      eager: false,
    }),
  );
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(18));
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(18);
  responses.shift()?.();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(19));
  for (const respond of responses) respond();
  expect((await Promise.all(work)).every(Boolean)).toBe(true);
  service.releaseAllArtwork();
});

test("eighteen completed responses hold load slots while only two decoders run", async () => {
  const service = await artwork();
  const responses: Array<() => void> = [];
  const decoders: Array<() => void> = [];
  const created: ReturnType<typeof bitmap>[] = [];
  let decoding = 0;
  let maximum = 0;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        responses.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => {
      decoding += 1;
      maximum = Math.max(maximum, decoding);
      const image = bitmap(192, 288);
      created.push(image);
      return new Promise<ImageBitmap>((resolve) =>
        decoders.push(() => {
          decoding -= 1;
          resolve(image.value);
        }),
      );
    }),
  );
  const requests = Array.from({ length: 19 }, (_, index) =>
    posterRequest(`https://images.example/decode-${index}.jpg`),
  );
  const work = requests.map((request) => {
    service.claimArtwork(request);
    return service.loadArtwork({ ...request, eager: false });
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(18));
  for (const respond of responses.splice(0)) respond();
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  expect(fetcher).toHaveBeenCalledTimes(18);
  service.releaseArtwork(requests[0]);
  expect(created[0].close).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(18);
  decoders.shift()?.();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(19));
  await vi.waitFor(() => expect(created[0].close).toHaveBeenCalledTimes(1));
  for (const respond of responses.splice(0)) respond();
  for (let index = 0; index < 18; index += 1) {
    await vi.waitFor(() => expect(decoders.length).toBeGreaterThan(0));
    decoders.shift()?.();
  }
  const entries = await Promise.all(work);
  expect(entries[0]).toBeNull();
  expect(entries.slice(1).every(Boolean)).toBe(true);
  expect(maximum).toBe(2);
  expect(service.artworkOf(requests[0])).toBeNull();
  service.releaseAllArtwork();
});

test("retry delays increase by one second while callers retain one promise", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  const request = posterRequest("https://images.example/retry.jpg");
  service.claimArtwork(request);
  const pending = service.loadArtwork(request);
  let finished = false;
  void pending.then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  for (let retry = 1; retry <= 5; retry += 1) {
    await vi.advanceTimersByTimeAsync(retry * 1000 - 1);
    expect(fetcher).toHaveBeenCalledTimes(retry);
    expect(finished).toBe(false);
    expect(service.loadArtwork({ ...request, eager: false })).toBe(pending);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetcher).toHaveBeenCalledTimes(retry + 1);
  }
  expect(await pending).toBeNull();
  expect(await service.loadArtwork({ ...request, eager: false })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(await service.loadArtwork({ ...request, eager: false })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(1);
  const renewed = service.loadArtwork({ ...request, eager: false });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(7);
  service.releaseArtwork(request);
  expect(await renewed).toBeNull();
  service.releaseAllArtwork();
});

test("an intermediate retry succeeds while another image completes during backoff", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  let attempts = 0;
  const fetcher = vi.fn(async (input: string | URL) => {
    if (String(input).includes("/retry") && ++attempts <= 2) throw new Error("offline");
    return new Response(new Blob(["image"]));
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const pending = service.loadArtwork({
    ...posterRequest("https://images.example/retry-success.jpg"),
    eager: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  const other = service.loadArtwork({
    ...posterRequest("https://images.example/other.jpg"),
    eager: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(await other).not.toBeNull();
  expect(attempts).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(attempts).toBe(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).not.toBeNull();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(attempts).toBe(3);
  service.releaseAllArtwork();
});

test.each(["claim", "signal", "drop", "reset", "preempt"] as const)(
  "%s cancellation clears a retry timer without poisoning its replacement",
  async (source) => {
    vi.useFakeTimers();
    const service = await artwork();
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap(192, 288).value),
    );
    const request = posterRequest("https://images.example/cancel-retry.jpg");
    const controller = new AbortController();
    if (source !== "preempt") service.claimArtwork(request);
    const pending = service.loadArtwork({
      ...request,
      eager: false,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    let current: Promise<unknown> | undefined;
    if (source === "claim") service.releaseArtwork(request);
    if (source === "signal") controller.abort();
    if (source === "drop") service.dropQueuedArtwork("poster");
    if (source === "reset") service.releaseAllArtwork();
    if (source === "preempt") {
      const visible = posterRequest("https://images.example/visible-retry.jpg");
      service.claimArtwork(visible);
      fetcher.mockImplementation(async () => new Response(new Blob(["image"])));
      current = service.loadArtwork(visible);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(await pending).toBeNull();
    fetcher.mockImplementation(async () => new Response(new Blob(["image"])));
    const replacement = service.loadArtwork({ ...request, eager: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(await replacement).not.toBeNull();
    if (current) expect(await current).not.toBeNull();
    const calls = fetcher.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetcher).toHaveBeenCalledTimes(calls);
    service.releaseAllArtwork();
  },
);

test("a corrupt cached blob falls through to fresh bytes without consuming a retry", async () => {
  const service = await artwork();
  const request = posterRequest("https://images.example/corrupt.jpg");
  const saved = new Blob(["corrupt"]);
  disk.set(`poster:192x288|${request.url}`, saved);
  const read = vi.spyOn(await import("../src/services/disk"), "read");
  const fetcher = vi.fn(async () => new Response(new Blob(["fresh"])));
  vi.stubGlobal("fetch", fetcher);
  const decoded = bitmap(192, 288);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockRejectedValueOnce(new Error("corrupt")).mockResolvedValueOnce(decoded.value),
  );
  expect((await service.loadArtwork({ ...request, eager: false }))?.bitmap).toBe(decoded.value);
  expect(read).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(createImageBitmap).toHaveBeenCalledTimes(2);
  service.releaseAllArtwork();
});

test("a disk read failure falls through to network and disk is read once across retries", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  const read = vi
    .spyOn(await import("../src/services/disk"), "read")
    .mockRejectedValueOnce(new Error("cache unavailable"));
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response(new Blob(["fresh"])));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const pending = service.loadArtwork({
    ...posterRequest("https://images.example/disk-failure.jpg"),
    eager: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).not.toBeNull();
  expect(read).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
  service.releaseAllArtwork();
});

test("bitmap decode failure retries fresh bytes", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  const fetcher = vi.fn(async () => new Response(new Blob(["image"])));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValueOnce(bitmap(192, 288).value),
  );
  const pending = service.loadArtwork({
    ...posterRequest("https://images.example/decode-retry.jpg"),
    eager: false,
  });
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
  service.releaseAllArtwork();
});

test("owner reset preserves decoder accounting and an old completion cannot replace its successor", async () => {
  const service = await artwork();
  const finishes: Array<() => void> = [];
  const images: ReturnType<typeof bitmap>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => {
      const image = bitmap(192, 288);
      images.push(image);
      return new Promise<ImageBitmap>((resolve) => finishes.push(() => resolve(image.value)));
    }),
  );
  const request = posterRequest("https://images.example/owner.jpg");
  const old = [request, posterRequest("https://images.example/other-owner.jpg")].map((value) =>
    service.loadArtwork({ ...value, eager: false }),
  );
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  service.releaseAllArtwork();
  service.claimArtwork(request);
  const replacement = service.loadArtwork(request);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  await settle();
  expect(createImageBitmap).toHaveBeenCalledTimes(2);
  finishes.shift()?.();
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
  expect(await old[0]).toBeNull();
  expect(images[0].close).toHaveBeenCalledTimes(1);
  expect(service.artworkOf(request)).toBeNull();
  expect(service.loadArtwork(request)).toBe(replacement);
  finishes.pop()?.();
  expect((await replacement)?.bitmap).toBe(images[2].value);
  finishes.shift()?.();
  expect(await old[1]).toBeNull();
  expect(images[1].close).toHaveBeenCalledTimes(1);
  expect(service.artworkOf(request)?.bitmap).toBe(images[2].value);
  service.releaseAllArtwork();
});

test("dropping load queued work cancels it immediately without aborting active downloads", async () => {
  const service = await artwork();
  const signals: AbortSignal[] = [];
  const responses: Array<() => void> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: string | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Promise<Response>((resolve) =>
        responses.push(() => resolve(new Response(new Blob(["image"])))),
      );
    }),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const active = Array.from({ length: 18 }, (_, index) =>
    service.loadArtwork({
      ...posterRequest(`https://images.example/held-${index}.jpg`),
      eager: false,
    }),
  );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(18));
  const request = posterRequest("https://images.example/dropped.jpg");
  const queued = service.loadArtwork({ ...request, eager: false });
  service.dropQueuedArtwork("poster");
  expect(await queued).toBeNull();
  expect(signals.every((signal) => !signal.aborted)).toBe(true);
  const replacement = service.loadArtwork({ ...request, eager: false });
  expect(replacement).not.toBe(queued);
  for (const respond of responses.splice(0)) respond();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(19));
  for (const respond of responses.splice(0)) respond();
  expect((await Promise.all([...active, replacement])).every(Boolean)).toBe(true);
  service.releaseAllArtwork();
});

test("visible promotion during backoff retains urgent load priority on the retry", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  const responses: Array<() => void> = [];
  const fetcher = vi.fn(
    (_input: string | URL) =>
      new Promise<Response>((resolve) =>
        responses.push(() => resolve(new Response(new Blob(["image"])))),
      ),
  );
  fetcher.mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const request = posterRequest("https://images.example/promoted-retry.jpg");
  const warming = service.loadArtwork({ ...request, eager: false });
  await vi.advanceTimersByTimeAsync(0);
  service.claimArtwork(request);
  expect(service.loadArtwork(request)).toBe(warming);
  const active = Array.from({ length: 18 }, (_, index) => {
    const held = posterRequest(`https://images.example/priority-${index}.jpg`);
    service.claimArtwork(held);
    return service.loadArtwork({ ...held, eager: false });
  });
  await vi.advanceTimersByTimeAsync(0);
  const laterRequest = posterRequest("https://images.example/queued-warming.jpg");
  service.claimArtwork(laterRequest);
  const later = service.loadArtwork({ ...laterRequest, eager: false });
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetcher).toHaveBeenCalledTimes(19);
  responses.shift()?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(String(fetcher.mock.calls[19][0])).toBe(request.url);
  for (const respond of responses.splice(0)) respond();
  await vi.advanceTimersByTimeAsync(0);
  for (const respond of responses.splice(0)) respond();
  await vi.advanceTimersByTimeAsync(0);
  expect((await Promise.all([...active, later, warming])).every(Boolean)).toBe(true);
  service.releaseAllArtwork();
});

test("urgent visible work starts before queued warming work", async () => {
  const service = await artwork();
  const releases: Array<() => void> = [];
  const fetch = vi.fn(
    (_url: string | URL) =>
      new Promise<Response>((resolve) => {
        releases.push(() => resolve(new Response(new Blob(["image"]))));
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap(192, 288).value),
  );
  const active = Array.from({ length: 18 }, (_, index) => {
    const request = posterRequest(`https://images.example/active-${index}.jpg`);
    service.claimArtwork(request);
    return service.loadArtwork({ ...request, eager: false });
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(18));
  const warmingRequest = posterRequest("https://images.example/warming.jpg");
  service.claimArtwork(warmingRequest);
  const warming = service.loadArtwork({ ...warmingRequest, eager: false });
  const urgentRequest = posterRequest("https://images.example/urgent.jpg");
  service.claimArtwork(urgentRequest);
  const urgent = service.loadArtwork(urgentRequest);
  await settle();
  expect(fetch).toHaveBeenCalledTimes(18);
  releases.shift()?.();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(19));
  expect(String(fetch.mock.calls[18][0])).toBe(urgentRequest.url);
  for (const release of releases.splice(0)) release();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(20));
  for (const release of releases.splice(0)) release();
  await Promise.all([...active, warming, urgent]);
  service.releaseAllArtwork();
});

test("released offscreen posters leave the queue before a newly visible poster", async () => {
  const service = await artwork();
  const releases: Array<() => void> = [];
  const fetch = vi.fn(async (url: string | URL) => new Response(new Blob([String(url)])));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((...args: unknown[]) =>
      args.length > 1
        ? Promise.resolve(bitmap(192, 288).value)
        : new Promise<ImageBitmap>((resolve) => {
            releases.push(() => resolve(bitmap(192, 288).value));
          }),
    ),
  );

  const active = [
    posterRequest("https://images.example/active-1.jpg"),
    posterRequest("https://images.example/active-2.jpg"),
  ];
  const activeWork = active.map((request) => {
    service.claimArtwork(request);
    return service.loadArtwork({ ...request, eager: false });
  });
  await vi.waitFor(() => assert.equal(releases.length, 2));
  const offscreen = Array.from({ length: 8 }, (_, index) =>
    posterRequest(`https://images.example/offscreen-${index}.jpg`),
  );
  const offscreenWork = offscreen.map((request) => {
    service.claimArtwork(request);
    return service.loadArtwork(request);
  });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(10));
  for (const request of offscreen) service.releaseArtwork(request);

  const visible = posterRequest("https://images.example/visible.jpg");
  service.claimArtwork(visible);
  const visibleWork = service.loadArtwork(visible);
  releases.shift()?.();
  await vi.waitFor(() => assert.equal(fetch.mock.calls.length, 11));
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));
  assert.equal(String(fetch.mock.calls[10][0]), visible.url);
  releases.shift()?.();
  await vi.waitFor(() => assert.equal(releases.length, 1));
  releases.shift()?.();
  await Promise.all([...activeWork, ...offscreenWork, visibleWork]);
  expect(createImageBitmap).toHaveBeenCalledTimes(3);
  service.releaseArtwork(visible);
  service.releaseAllArtwork();
});

test("long poster traversal releases every queued lease without decoding stale rows", async () => {
  const service = await artwork();
  const releases: Array<() => void> = [];
  const fetch = vi.fn(async () => new Response(new Blob(["image"])));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((...args: unknown[]) =>
      args.length > 1
        ? Promise.resolve(bitmap(192, 288).value)
        : new Promise<ImageBitmap>((resolve) => {
            releases.push(() => resolve(bitmap(192, 288).value));
          }),
    ),
  );

  const activeWork = [0, 1].map((index) =>
    service.loadArtwork({
      ...posterRequest(`https://images.example/active-${index}.jpg`),
      eager: false,
    }),
  );
  await vi.waitFor(() => assert.equal(releases.length, 2));
  const staleWork = Array.from({ length: 400 }, (_, index) => {
    const request = posterRequest(`https://images.example/stale-${index}.jpg`);
    service.claimArtwork(request);
    const work = service.loadArtwork(request);
    service.releaseArtwork(request);
    return work;
  });
  await vi.waitFor(() => assert.equal(releases.length, 2));
  expect(await Promise.all(staleWork)).toEqual(Array.from({ length: 400 }, () => null));
  expect(fetch).toHaveBeenCalledTimes(2);

  releases.shift()?.();
  releases.shift()?.();
  await Promise.all(activeWork);
});

test("queued warming settles when cancelled", async () => {
  const service = await artwork();
  const releases: Array<() => void> = [];
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: string | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Response(new Blob(["image"]));
    }),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn((...args: unknown[]) =>
      args.length > 1
        ? Promise.resolve(bitmap(76, 48).value)
        : new Promise<ImageBitmap>((resolve) => {
            releases.push(() => resolve(bitmap(76, 48).value));
          }),
    ),
  );
  const first = service.loadArtwork({
    ...posterRequest("https://images.example/a.jpg"),
    eager: false,
  });
  const second = service.loadArtwork({
    ...posterRequest("https://images.example/b.jpg"),
    eager: false,
  });
  const queued = service.loadArtwork({
    ...posterRequest("https://images.example/c.jpg"),
    eager: false,
  });
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  await settle();

  service.dropQueuedArtwork("poster");
  assert.equal(await queued, null);
  expect(signals.slice(0, 2).every((signal) => !signal.aborted)).toBe(true);
  expect(createImageBitmap).toHaveBeenCalledTimes(2);
  releases.shift()?.();
  releases.shift()?.();
  expect((await Promise.all([first, second])).every(Boolean)).toBe(true);
  service.releaseAllArtwork();
});

test("palette extraction uses representative artwork pixels and darkens them for TV text", async () => {
  const service = await artwork();
  const palette = service.paletteFromPixels(
    new Uint8ClampedArray([
      240, 24, 24, 255, 240, 24, 24, 255, 24, 24, 240, 255, 24, 24, 240, 255,
    ]),
    2,
    2,
  );

  expect(palette.primary).toMatch(/^rgb\(/);
  expect(palette.secondary).toMatch(/^rgb\(/);
  expect(palette.primary).not.toBe(palette.secondary);
  expect(service.paletteCss(palette)).toContain("linear-gradient");
});

test("Content-Length over eight MiB rejects before decode", async () => {
  const service = await artwork();
  const decode = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("x", {
          headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
        }),
    ),
  );
  vi.stubGlobal("createImageBitmap", decode);
  const request = posterRequest("https://images.example/large.jpg");
  service.claimArtwork(request);

  assert.equal(await service.loadArtwork(request), null);
  assert.equal(decode.mock.calls.length, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a streamed response stops when it crosses eight MiB", async () => {
  const service = await artwork();
  const decode = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(stream)),
  );
  vi.stubGlobal("createImageBitmap", decode);
  const request = posterRequest("https://images.example/streamed.jpg");
  service.claimArtwork(request);

  assert.equal(await service.loadArtwork(request), null);
  assert.equal(decode.mock.calls.length, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("a streamed response at exactly eight MiB decodes", async () => {
  const service = await artwork();
  const decoded = bitmap(192, 288);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.close();
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(stream)),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => decoded.value),
  );

  assert.equal(
    (
      await service.loadArtwork({
        ...posterRequest("https://images.example/exact.jpg"),
        eager: false,
      })
    )?.bitmap,
    decoded.value,
  );
});

test("an aborted active request does not become a permanent failure", async () => {
  const service = await artwork();
  const decoded = bitmap(192, 288);
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string | URL, init?: RequestInit) => {
      requests += 1;
      if (requests === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(new Response(new Blob(["poster"])));
    }),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => decoded.value),
  );
  const request = posterRequest("https://images.example/abort.jpg");
  const controller = new AbortController();
  const pending = service.loadArtwork({ ...request, eager: false, signal: controller.signal });
  await vi.waitFor(() => assert.equal(requests, 1));
  controller.abort();
  assert.equal(await pending, null);

  assert.equal(
    (await service.loadArtwork({ ...request, eager: false }))?.bitmap,
    decoded.value,
  );
  assert.equal(requests, 2);
});

test("each artwork attempt times out after fifteen seconds with six attempts in 105000ms", async () => {
  vi.useFakeTimers();
  const service = await artwork();
  const fetch = vi.fn(
    (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const request = posterRequest("https://images.example/timeout.jpg");
  service.claimArtwork(request);
  const pending = service.loadArtwork(request);

  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(104_999);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(service.loadArtwork({ ...request, eager: false })).toBe(pending);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(await pending, null);
  assert.equal(await service.loadArtwork({ ...request, eager: false }), null);
  assert.equal(fetch.mock.calls.length, 6);
  service.releaseAllArtwork();
});

test("a failed second logo resize closes its partial bitmap", async () => {
  const service = await artwork();
  const partial = bitmap(76, 120);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["logo"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi
      .fn()
      .mockResolvedValueOnce(partial.value)
      .mockRejectedValueOnce(new Error("resize failed")),
  );

  const controller = new AbortController();
  const pending = service.loadArtwork({
    ...logoRequest("https://images.example/tall.png"),
    eager: false,
    signal: controller.signal,
  });
  await vi.waitFor(() => expect(partial.close).toHaveBeenCalledTimes(1));
  controller.abort();
  assert.equal(await pending, null);
  assert.equal(partial.close.mock.calls.length, 1);
});

test.each([false, true])(
  "poster memory preserves recently revisited pages, revisit=%s",
  async (revisit) => {
    const service = await artwork();
    const sources = Array.from({ length: 55 }, () => bitmap(400, 600));
    const finals = Array.from({ length: 55 }, () => bitmap(192, 288));
    let index = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["poster"]))),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (...args: unknown[]) =>
        args.length > 1 ? finals[index++].value : sources[index].value,
      ),
    );

    const first = posterRequest("https://images.example/0.jpg");
    for (let at = 0; at < 55; at += 1) {
      if (revisit && at === 54) assert.notEqual(service.artworkOf(first), null);
      await service.loadArtwork({
        ...posterRequest(`https://images.example/${at}.jpg`),
        eager: false,
      });
    }

    const evicted = revisit ? 1 : 0;
    assert.equal(
      service.artworkOf(posterRequest(`https://images.example/${evicted}.jpg`)),
      null,
    );
    assert.equal(finals[evicted].close.mock.calls.length, 1);
    if (revisit) assert.notEqual(service.artworkOf(first), null);
  },
);

test("owner cancellation retains finished artwork for a warm playlist return", async () => {
  const service = await artwork();
  const source = bitmap(400, 600);
  const final = bitmap(192, 288);
  const fetch = vi.fn(async () => new Response(new Blob(["poster"])));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (...args: unknown[]) => (args.length > 1 ? final.value : source.value)),
  );
  const request = posterRequest("https://images.example/return.jpg");
  const ready = await service.loadArtwork(request);
  service.cancelArtworkWork();
  assert.equal(service.artworkOf(request), ready);
  assert.equal(await service.loadArtwork(request), ready);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(final.close).not.toHaveBeenCalled();
  service.releaseAllArtwork();
  assert.equal(service.artworkOf(request), null);
});

test("poster memory evicts by the twelve MiB byte budget", async () => {
  const service = await artwork();
  const sources = Array.from({ length: 4 }, () => bitmap(1024, 1024));
  const finals = Array.from({ length: 4 }, () => bitmap(1024, 1024));
  let index = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["poster"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (...args: unknown[]) =>
      args.length > 1 ? finals[index++].value : sources[index].value,
    ),
  );
  const first = posterRequest("https://images.example/bytes-0.jpg");

  for (let at = 0; at < 4; at += 1) {
    await service.loadArtwork({
      ...posterRequest(`https://images.example/bytes-${at}.jpg`),
      eager: false,
    });
  }

  assert.equal(service.artworkOf(first), null);
  assert.equal(finals[0].close.mock.calls.length, 1);
});

test("claimed posters survive eviction and logo memory remains independent", async () => {
  const service = await artwork();
  const created: ReturnType<typeof bitmap>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (_source: unknown, options?: ImageBitmapOptions) => {
      const next = bitmap(options?.resizeWidth ?? 192, options?.resizeHeight ?? 288);
      created.push(next);
      return next.value;
    }),
  );
  const claimed = posterRequest("https://images.example/claimed.jpg");
  const logo = logoRequest("https://images.example/logo.png");
  await service.loadArtwork({ ...claimed, eager: false });
  service.claimArtwork(claimed);
  await service.loadArtwork({ ...logo, eager: false });
  for (let index = 0; index < 49; index += 1) {
    await service.loadArtwork({
      ...posterRequest(`https://images.example/churn-${index}.jpg`),
      eager: false,
    });
  }

  assert.ok(service.artworkOf(claimed));
  assert.ok(service.artworkOf(logo));
  service.releaseArtwork(claimed);
});

test("releaseAllArtwork closes every retained bitmap", async () => {
  const service = await artwork();
  const poster = bitmap(192, 288);
  const logo = bitmap(76, 48);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValueOnce(poster.value).mockResolvedValueOnce(logo.value),
  );
  await service.loadArtwork({
    ...posterRequest("https://images.example/release.jpg"),
    eager: false,
  });
  await service.loadArtwork({
    ...logoRequest("https://images.example/release.png"),
    eager: false,
  });

  service.releaseAllArtwork();

  assert.equal(poster.close.mock.calls.length, 1);
  assert.equal(logo.close.mock.calls.length, 1);
});

test("releaseAllArtwork closes a bitmap that finishes after release", async () => {
  const service = await artwork();
  const decoded = bitmap(192, 288);
  let finish: ((value: ImageBitmap) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["poster"]))),
  );
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const request = posterRequest("https://images.example/inflight.jpg");
  service.claimArtwork(request);
  const pending = service.loadArtwork(request);
  await settle();
  await vi.waitFor(() => assert.ok(finish));

  service.releaseAllArtwork();
  finish?.(decoded.value);

  assert.equal(await pending, null);
  assert.equal(decoded.close.mock.calls.length, 1);
  assert.equal(service.artworkOf(request), null);
});

test("poster loading skips palette readbacks until a consumer requests the cached tone", async () => {
  const service = await artwork();
  const image = bitmap(192, 288);
  const readback = vi.fn(() => ({
    data: new Uint8ClampedArray(Array.from({ length: 64 }, () => [224, 96, 32, 255]).flat()),
  }));
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    drawImage: vi.fn(),
    getImageData: readback,
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => image.value),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  const request = posterRequest("https://images.example/lazy-tone.jpg");
  try {
    const entry = await service.loadArtwork({ ...request, eager: false });
    expect(entry).not.toBeNull();
    expect(readback).not.toHaveBeenCalled();
    const palette = entry!.palette;
    expect(palette).not.toEqual(service.QUIET_NEUTRAL_PALETTE);
    expect(readback).toHaveBeenCalledTimes(1);
    expect(service.artworkOf(request)?.palette).toBe(palette);
    expect(readback).toHaveBeenCalledTimes(1);
  } finally {
    service.releaseAllArtwork();
  }
});

test("backdrops bypass shared caches and poster tone remains available for fallback", async () => {
  const service = await artwork();
  const poster = bitmap(192, 288);
  const backdrop = bitmap(1280, 720);
  const fetch = vi.fn(async (url: string | URL) => {
    if (String(url).includes("missing")) return new Response("missing", { status: 404 });
    return new Response(new Blob(["image"]));
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValueOnce(poster.value).mockResolvedValueOnce(backdrop.value),
  );
  const request = posterRequest("https://images.example/tone.jpg");
  await service.loadArtwork({ ...request, eager: false });
  const palette = service.artworkOf(request)?.palette;

  const lease = await service.loadBackdrop("https://images.example/backdrop.jpg");
  assert.equal(service.artworkOf(posterRequest("https://images.example/backdrop.jpg")), null);
  assert.deepEqual(diskWrites, []);
  lease?.release();
  assert.equal(await service.loadBackdrop("https://images.example/missing.jpg"), null);
  assert.deepEqual(service.artworkOf(request)?.palette, palette);
});

test.each([
  { name: "poster", make: posterRequest, partialSize: [400, 600], resultSize: [192, 288] },
  { name: "logo", make: logoRequest, partialSize: [76, 480], resultSize: [76, 48] },
] as const)(
  "a $name decode cancelled after its first bitmap closes it and never starts the resize",
  async ({ name, make, partialSize }) => {
    const service = await artwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    const partial = bitmap(partialSize[0], partialSize[1]);
    const releases: Array<() => void> = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(
        () =>
          new Promise<ImageBitmap>((resolve) => releases.push(() => resolve(partial.value))),
      ),
    );
    const request = make(`https://images.example/cancel-decode-${name}.jpg`);
    const controller = new AbortController();
    service.claimArtwork(request);
    const pending = service.loadArtwork({ ...request, signal: controller.signal });
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));

    controller.abort();
    releases[0]();
    expect(await pending).toBeNull();
    expect(partial.close).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    service.releaseArtwork(request);
    service.releaseAllArtwork();
  },
);

test.each([
  { name: "poster", make: posterRequest, partialSize: [400, 600], resultSize: [192, 288] },
  { name: "logo", make: logoRequest, partialSize: [76, 480], resultSize: [76, 48] },
] as const)(
  "a $name decode cancelled during its resize closes partial and result once each",
  async ({ name, make, partialSize, resultSize }) => {
    const service = await artwork();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Blob(["image"]))),
    );
    const partial = bitmap(partialSize[0], partialSize[1]);
    const result = bitmap(resultSize[0], resultSize[1]);
    const releases: Array<() => void> = [];
    let calls = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(partial.value)
          : new Promise<ImageBitmap>((resolve) => releases.push(() => resolve(result.value)));
      }),
    );
    const request = make(`https://images.example/cancel-resize-${name}.jpg`);
    const controller = new AbortController();
    service.claimArtwork(request);
    const pending = service.loadArtwork({ ...request, signal: controller.signal });
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

    controller.abort();
    releases[0]();
    expect(await pending).toBeNull();
    expect(partial.close).toHaveBeenCalledTimes(1);
    expect(result.close).toHaveBeenCalledTimes(1);
    service.releaseArtwork(request);
    service.releaseAllArtwork();
  },
);

test("a cancelled decode cannot cache over its own replacement", async () => {
  const service = await artwork();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob(["image"]))),
  );
  const stale = bitmap(400, 600);
  const fresh = bitmap(192, 288);
  const releases: Array<() => void> = [];
  let calls = 0;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => {
      calls += 1;
      return calls === 1
        ? new Promise<ImageBitmap>((resolve) => releases.push(() => resolve(stale.value)))
        : Promise.resolve(fresh.value);
    }),
  );
  const request = posterRequest("https://images.example/reenter.jpg");
  const controller = new AbortController();
  service.claimArtwork(request);
  const cancelled = service.loadArtwork({ ...request, signal: controller.signal });
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));

  controller.abort();
  const replacement = service.loadArtwork(request);
  releases[0]();
  expect(await cancelled).toBeNull();
  expect(stale.close).toHaveBeenCalledTimes(1);
  expect((await replacement)?.bitmap).toBe(fresh.value);
  expect(service.artworkOf(request)?.bitmap).toBe(fresh.value);
  service.releaseArtwork(request);
  service.releaseAllArtwork();
});
