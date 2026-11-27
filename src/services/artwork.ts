import * as disk from "./disk";
import { performArtworkOperation } from "./artwork-operations";
import { artworkOperation } from "./artwork-worker-client";
import { whenIdle } from "./idle";
import {
  artworkWorkload,
  observeArtworkWorkload,
  recordArtworkDecode,
  recordArtworkLoad,
  trackArtworkWork,
} from "./workload";

export type ArtworkKind = "logo" | "poster";

export interface ArtworkRequest {
  url: string;
  kind: ArtworkKind;
  width: number;
  height: number;
  fit?: "cover" | "contain";
  eager?: boolean;
  signal?: AbortSignal;
}

export interface ArtworkPalette {
  primary: string;
  secondary: string;
}

export interface ArtworkEntry {
  bitmap: ImageBitmap;
  bytes: number;
  palette: ArtworkPalette;
}

export interface BackdropLease {
  bitmap: ImageBitmap;
  palette: ArtworkPalette;
  release: () => void;
}

export interface WarmOptions {
  delay?: number;
  timeout?: number;
}

export const POSTER_BOX = { width: 192, height: 288 } as const;
export const DETAIL_POSTER_BOX = { width: 360, height: 540 } as const;
export const EPISODE_PREVIEW_BOX = { width: 512, height: 288 } as const;
const MAX_DISPLAY_ARTWORK_PIXELS = 1920 * 1080;

export function displayArtworkBox(
  box: { width: number; height: number },
  pixelRatio = globalThis.devicePixelRatio || 1,
) {
  const density = Number.isFinite(pixelRatio) ? Math.min(2, Math.max(1, pixelRatio)) : 1;
  const scale = Math.min(
    density,
    Math.sqrt(MAX_DISPLAY_ARTWORK_PIXELS / (box.width * box.height)),
  );
  return {
    width: Math.max(1, Math.floor(box.width * scale)),
    height: Math.max(1, Math.floor(box.height * scale)),
  };
}

const MAX_RETRIES = 5;
const RETRY_STEP_MS = 1000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 15_000;
const POSTER_MEMORY_BYTES = 12 * 1024 * 1024;
const POSTER_MEMORY_ENTRIES = 54;
const LOGO_MEMORY_ENTRIES = 240;
const FAILURE_CACHE_LIMIT = 128;
const FAILURE_RETRY_MS = 30_000;

const cache = new Map<string, ArtworkEntry>();
const listeners = new Map<string, Set<() => void>>();
const claims = new Map<string, number>();
let logoEntries = 0;
let posterEntries = 0;
let posterBytes = 0;
interface ArtworkWork {
  promise: Promise<ArtworkEntry | null>;
  controller: AbortController;
  urgent: boolean;
  kind: ArtworkKind;
  retrying: boolean;
  // Queue membership ends before the load slot is released after decode.
  waitingForLoad: boolean;
}

const inflight = new Map<string, ArtworkWork>();
const failed = new Map<string, number>();
interface WorkQueue {
  urgent: Waiter[];
  background: Waiter[];
  active: Set<ArtworkWork>;
  lane: "loads" | "decodes";
}
const loads: WorkQueue = {
  urgent: [],
  background: [],
  active: new Set(),
  lane: "loads",
};
const decodes: WorkQueue = {
  urgent: [],
  background: [],
  active: new Set(),
  lane: "decodes",
};
let generation = 0;

interface Waiter {
  key: string;
  kind: ArtworkKind;
  start: () => void;
  cancel: () => void;
}

const keyOf = (request: Omit<ArtworkRequest, "eager" | "signal">) =>
  `${request.kind}:${request.width}x${request.height}${request.fit === "contain" ? ":contain" : ""}|${request.url}`;

function notifyArtwork(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

function rememberFailure(key: string): void {
  failed.delete(key);
  failed.set(key, Date.now());
  while (failed.size > FAILURE_CACHE_LIMIT) failed.delete(failed.keys().next().value as string);
}

export const QUIET_NEUTRAL_PALETTE: ArtworkPalette = {
  primary: "rgb(23, 24, 28)",
  secondary: "rgb(29, 31, 38)",
};

const rgb = (red: number, green: number, blue: number): string =>
  `rgb(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)})`;

const darken = (red: number, green: number, blue: number) => {
  const factor = 0.36;
  return rgb(red * factor, green * factor, blue * factor);
};

export function paletteFromPixels(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
): ArtworkPalette {
  if (width <= 0 || height <= 0 || pixels.length < 4) return QUIET_NEUTRAL_PALETTE;
  const buckets = new Map<
    string,
    { count: number; red: number; green: number; blue: number }
  >();
  const step = Math.max(1, Math.floor(Math.max(width, height) / 24));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const at = (y * width + x) * 4;
      const alpha = pixels[at + 3] ?? 255;
      if (alpha < 64) continue;
      const red = Math.floor((pixels[at] ?? 0) / 32) * 32 + 16;
      const green = Math.floor((pixels[at + 1] ?? 0) / 32) * 32 + 16;
      const blue = Math.floor((pixels[at + 2] ?? 0) / 32) * 32 + 16;
      const key = `${red}:${green}:${blue}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
        bucket.red += red;
        bucket.green += green;
        bucket.blue += blue;
      } else buckets.set(key, { count: 1, red, green, blue });
    }
  }
  const ranked = [...buckets.values()].sort((left, right) => right.count - left.count);
  if (!ranked.length) return QUIET_NEUTRAL_PALETTE;
  const color = (bucket: (typeof ranked)[number]) =>
    darken(bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count);
  return {
    primary: color(ranked[0]),
    secondary: color(ranked[1] ?? ranked[0]),
  };
}

export const paletteCss = (palette: ArtworkPalette): string =>
  `linear-gradient(135deg, ${palette.primary}, ${palette.secondary})`;

const paletteCache = new WeakMap<ImageBitmap, ArtworkPalette>();
const paletteTasks = new WeakMap<ImageBitmap, Promise<ArtworkPalette>>();
let paletteTurn: Promise<unknown> = Promise.resolve();

export const peekArtworkPalette = (bitmap: ImageBitmap) => paletteCache.get(bitmap);

export function loadArtworkPalette(bitmap: ImageBitmap): Promise<ArtworkPalette> {
  let task = paletteTasks.get(bitmap);
  if (!task) {
    task = paletteTurn
      .then(async () => {
        const cached = paletteCache.get(bitmap);
        if (cached) return cached;
        const clone = await createImageBitmap(bitmap);
        const pixels = (await artworkOperation({
          kind: "pixels",
          bitmap: clone,
        })) as Uint8ClampedArray | null;
        const palette = pixels ? paletteFromPixels(pixels, 8, 8) : QUIET_NEUTRAL_PALETTE;
        paletteCache.set(bitmap, palette);
        return palette;
      })
      .catch(() => QUIET_NEUTRAL_PALETTE);
    paletteTasks.set(bitmap, task);
    paletteTurn = task;
  }
  return task;
}

function paletteFromBitmap(bitmap: ImageBitmap): ArtworkPalette {
  const cached = paletteCache.get(bitmap);
  if (cached) return cached;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return QUIET_NEUTRAL_PALETTE;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const palette = paletteFromPixels(
      context.getImageData(0, 0, canvas.width, canvas.height).data,
      8,
      8,
    );
    paletteCache.set(bitmap, palette);
    return palette;
  } catch {
    return QUIET_NEUTRAL_PALETTE;
  }
}

const drain = (queue: WorkQueue) => {
  if (!queue.urgent.length && !queue.background.length) return;
  const limits = artworkWorkload();
  if (queue.active.size >= limits[queue.lane]) return;
  let warming = 0;
  if (queue.background.length) {
    for (const work of queue.active) {
      if (!work.urgent) warming += 1;
    }
  }
  while (queue.active.size < limits[queue.lane]) {
    let next = queue.urgent.shift();
    if (!next && warming < limits.prefetch) {
      next = queue.background.shift();
      if (next) warming += 1;
    }
    if (!next) break;
    next.start();
  }
};

const takeTurn = (queue: WorkQueue, key: string, work: ArtworkWork): Promise<boolean> => {
  if (work.controller.signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (queue === loads) work.waitingForLoad = true;
    queue[work.urgent ? "urgent" : "background"].push({
      key,
      kind: work.kind,
      start: () => {
        if (queue === loads) work.waitingForLoad = false;
        queue.active.add(work);
        resolve(true);
      },
      cancel: () => {
        if (queue === loads) work.waitingForLoad = false;
        resolve(false);
      },
    });
    drain(queue);
  });
};

const endTurn = (queue: WorkQueue, work: ArtworkWork) => {
  queue.active.delete(work);
  drain(queue);
};

observeArtworkWorkload(() => {
  drain(loads);
  drain(decodes);
});

function cancelWork(key: string, controller?: AbortController) {
  const work = inflight.get(key);
  if (!work || (controller && work.controller !== controller)) return;
  inflight.delete(key);
  for (const queue of [loads, decodes]) {
    for (const priority of [queue.urgent, queue.background]) {
      const index = priority.findIndex((waiter) => waiter.key === key);
      if (index >= 0) priority.splice(index, 1)[0].cancel();
    }
  }
  work.controller.abort();
}

function preemptWarming() {
  for (const [key, work] of Array.from(inflight)) {
    if (!work.urgent && !claims.has(key) && !work.waitingForLoad) {
      cancelWork(key, work.controller);
    }
  }
}

const remember = (key: string, entry: ArtworkEntry, kind: ArtworkKind) => {
  const previous = cache.get(key);
  if (!previous) {
    if (kind === "logo") logoEntries += 1;
    else {
      posterEntries += 1;
      posterBytes += entry.bytes;
    }
  } else if (kind === "poster") {
    posterBytes += entry.bytes - previous.bytes;
  }
  if (previous && previous.bitmap !== entry.bitmap) previous.bitmap.close();
  cache.delete(key);
  cache.set(key, entry);
  if (kind === "logo") {
    while (logoEntries > LOGO_MEMORY_ENTRIES) {
      let oldest = "";
      for (const candidate of cache.keys()) {
        if (candidate.startsWith("logo:") && !claims.has(candidate)) {
          oldest = candidate;
          break;
        }
      }
      if (!oldest) break;
      cache.get(oldest)?.bitmap.close();
      cache.delete(oldest);
      logoEntries -= 1;
      if (oldest !== key) notifyArtwork(oldest);
    }
    notifyArtwork(key);
    return;
  }
  while (posterEntries > POSTER_MEMORY_ENTRIES || posterBytes > POSTER_MEMORY_BYTES) {
    let oldest = "";
    for (const [candidate] of cache) {
      if (candidate.startsWith("poster:") && !claims.has(candidate)) {
        oldest = candidate;
        break;
      }
    }
    if (!oldest) break;
    const removed = cache.get(oldest);
    removed?.bitmap.close();
    cache.delete(oldest);
    posterEntries -= 1;
    posterBytes -= removed?.bytes ?? 0;
    if (oldest !== key) notifyArtwork(oldest);
  }
  notifyArtwork(key);
};

class OversizedImage extends Error {}

const pngDimensions = new WeakMap<Blob, { width: number; height: number }>();

function smallPngDimensions(chunks: ArrayBuffer[], bytes: number) {
  if (bytes < 45 || bytes > 64 * 1024 || !chunks.length) return null;
  let buffer = chunks[0];
  if (chunks.length > 1) {
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    buffer = joined.buffer;
  }
  const view = new DataView(buffer);
  if (
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452
  )
    return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) return null;
  for (let offset = 8; offset + 12 <= bytes; ) {
    const size = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (size > bytes - offset - 12 || type === 0x65584966) return null;
    if (type === 0x49454e44) return size === 0 ? { width, height } : null;
    offset += size + 12;
  }
  return null;
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw new Error("Artwork cancelled");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let consumed = false;
  try {
    response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Artwork HTTP failure");
    const length = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) throw new OversizedImage();
    if (!response.body) {
      const blob = await response.blob();
      if (blob.size > MAX_IMAGE_BYTES) throw new OversizedImage();
      consumed = true;
      return blob;
    }
    reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let bytes = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) {
        throw new OversizedImage();
      }
      const chunk = new ArrayBuffer(result.value.byteLength);
      new Uint8Array(chunk).set(result.value);
      chunks.push(chunk);
    }
    consumed = true;
    const blob = new Blob(chunks);
    const dimensions = smallPngDimensions(chunks, bytes);
    if (dimensions) pngDimensions.set(blob, dimensions);
    return blob;
  } finally {
    if (!consumed) {
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
    reader?.releaseLock();
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

async function boundedBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  try {
    return await fetchBlob(url, signal);
  } catch {
    return null;
  }
}

async function decode(
  blob: Blob,
  width: number,
  height: number,
  fit = false,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const bitmap = (await performArtworkOperation(
    { kind: "decode", blob, width, height, fit, dimensions: pngDimensions.get(blob) },
    () => Boolean(signal?.aborted),
  )) as ImageBitmap | null;
  if (signal?.aborted) {
    bitmap?.close();
    return null;
  }
  return bitmap;
}

const pendingPersistence = new Map<string, { entry: ArtworkEntry; kind: ArtworkKind }>();
let persistenceCancel: (() => void) | null = null;
let persistenceActive = false;

function schedulePersistence() {
  if (persistenceCancel || persistenceActive || !pendingPersistence.size) return;
  persistenceCancel = whenIdle(drainPersistence, 3000);
}

function drainPersistence() {
  persistenceCancel = null;
  const next = pendingPersistence.entries().next();
  if (next.done) return;
  const [key, { entry, kind }] = next.value;
  pendingPersistence.delete(key);
  persistenceActive = true;
  const done = () => {
    persistenceActive = false;
    schedulePersistence();
  };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = entry.bitmap.width;
    canvas.height = entry.bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return done();
    context.drawImage(entry.bitmap, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return done();
        void disk.write(key, blob, kind).then(done, done);
      },
      kind === "poster" ? "image/jpeg" : "image/png",
      kind === "poster" ? 0.84 : undefined,
    );
  } catch {
    done();
  }
}

function persist(key: string, entry: ArtworkEntry, kind: ArtworkKind) {
  if (!pendingPersistence.has(key) && pendingPersistence.size >= 64) {
    const oldest = pendingPersistence.keys().next();
    if (!oldest.done) pendingPersistence.delete(oldest.value);
  }
  pendingPersistence.set(key, { entry, kind });
  schedulePersistence();
}

function recentArtwork(key: string): ArtworkEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

export function artworkOf(
  request: Omit<ArtworkRequest, "eager" | "signal">,
): ArtworkEntry | null {
  return recentArtwork(keyOf(request));
}

export function subscribeArtwork(
  request: Omit<ArtworkRequest, "eager" | "signal">,
  listener: () => void,
): () => void {
  const key = keyOf(request);
  const subscribed = listeners.get(key) ?? new Set<() => void>();
  listeners.set(key, subscribed);
  subscribed.add(listener);
  return () => {
    subscribed.delete(listener);
    if (!subscribed.size) listeners.delete(key);
  };
}

export function claimArtwork(request: Omit<ArtworkRequest, "eager" | "signal">): void {
  const key = keyOf(request);
  claims.set(key, (claims.get(key) ?? 0) + 1);
}

export function releaseArtwork(request: Omit<ArtworkRequest, "eager" | "signal">): void {
  const key = keyOf(request);
  const count = (claims.get(key) ?? 0) - 1;
  if (count > 0) {
    claims.set(key, count);
    return;
  }
  claims.delete(key);
  cancelWork(key);
}

function retryDelay(work: ArtworkWork, delay: number): Promise<void> {
  return new Promise((resolve) => {
    const signal = work.controller.signal;
    if (signal.aborted) return resolve();
    work.retrying = true;
    const finish = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      work.retrying = false;
      resolve();
    };
    const timer = window.setTimeout(finish, delay);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function loadArtwork(request: ArtworkRequest): Promise<ArtworkEntry | null> {
  const key = keyOf(request);
  const ready = recentArtwork(key);
  if (ready) return Promise.resolve(ready);
  const failedAt = failed.get(key);
  if (failedAt !== undefined) {
    if (request.eager === false && Date.now() - failedAt < FAILURE_RETRY_MS)
      return Promise.resolve(null);
    failed.delete(key);
  }
  const held = inflight.get(key);
  const urgent = request.eager !== false;
  if (held) {
    if (urgent) {
      held.urgent = true;
      for (const queue of [loads, decodes]) {
        const index = queue.background.findIndex((waiter) => waiter.key === key);
        if (index >= 0) queue.urgent.push(queue.background.splice(index, 1)[0]);
        drain(queue);
      }
      preemptWarming();
    }
    if (request.signal) {
      const signal = request.signal;
      const abort = () => cancelWork(key, held.controller);
      signal.addEventListener("abort", abort, { once: true });
      void held.promise.then(() => signal.removeEventListener("abort", abort));
      if (signal.aborted) abort();
    }
    return held.promise;
  }
  if (urgent) preemptWarming();
  const controller = new AbortController();
  const abort = () => cancelWork(key, controller);
  const owned = generation;
  const work: ArtworkWork = {
    promise: Promise.resolve(null),
    controller,
    urgent,
    kind: request.kind,
    retrying: false,
    waitingForLoad: false,
  };
  const live = () =>
    !controller.signal.aborted && owned === generation && inflight.get(key) === work;
  const decodeQueued = async (blob: Blob) => {
    const acquired = await takeTurn(decodes, key, work);
    try {
      if (!acquired || !live()) return null;
      const startedAt = performance.now();
      const bitmap = await decode(
        blob,
        request.width,
        request.height,
        request.kind === "logo" || request.fit === "contain",
        work.controller.signal,
      );
      if (bitmap) recordArtworkDecode(performance.now() - startedAt);
      return bitmap;
    } finally {
      if (acquired) endTurn(decodes, work);
    }
  };
  inflight.set(key, work);
  work.promise = (async () => {
    let diskRead = false;
    try {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        let permanent = false;
        const acquired = await takeTurn(loads, key, work);
        let stopSampling: (() => void) | undefined;
        try {
          if (!acquired || !live()) return null;
          if (work.urgent && !claims.has(key)) return null;
          const startedAt = performance.now();
          stopSampling = trackArtworkWork();
          let bitmap: ImageBitmap | null = null;
          let fromDisk = false;
          if (!diskRead) {
            diskRead = true;
            const saved = await disk.read(key).catch(() => null);
            if (!live()) return null;
            if (saved instanceof Blob) {
              bitmap = await decodeQueued(saved);
              fromDisk = bitmap !== null;
            }
          }
          if (!live()) {
            bitmap?.close();
            return null;
          }
          if (!bitmap) {
            const blob = await fetchBlob(request.url, controller.signal);
            if (!live()) return null;
            bitmap = await decodeQueued(blob);
          }
          if (!live()) {
            bitmap?.close();
            return null;
          }
          if (bitmap) {
            let palette: ArtworkPalette | undefined;
            const entry = {
              bitmap,
              bytes: bitmap.width * bitmap.height * 4,
              get palette(): ArtworkPalette {
                palette ??= paletteFromBitmap(this.bitmap);
                return palette;
              },
            };
            failed.delete(key);
            remember(key, entry, request.kind);
            if (!fromDisk) persist(key, entry, request.kind);
            recordArtworkLoad(startedAt);
            return entry;
          }
        } catch (error) {
          permanent = error instanceof OversizedImage;
        } finally {
          stopSampling?.();
          if (acquired) endTurn(loads, work);
        }
        if (!live()) return null;
        if (permanent || attempt === MAX_RETRIES) {
          rememberFailure(key);
          return null;
        }
        await retryDelay(work, (attempt + 1) * RETRY_STEP_MS);
      }
      return null;
    } finally {
      request.signal?.removeEventListener("abort", abort);
      if (inflight.get(key) === work) inflight.delete(key);
    }
  })();
  request.signal?.addEventListener("abort", abort, { once: true });
  if (request.signal?.aborted) abort();
  return work.promise;
}

export function dropQueuedArtwork(kind?: ArtworkKind): void {
  for (const [key, work] of Array.from(inflight)) {
    if (work.retrying && (!kind || work.kind === kind)) cancelWork(key, work.controller);
  }
  for (const queue of [loads, decodes]) {
    for (const priority of [queue.urgent, queue.background]) {
      for (const waiter of priority.slice()) {
        if (!kind || waiter.kind === kind) cancelWork(waiter.key);
      }
    }
  }
}

export function warmArtworkChain(
  requests: ArtworkRequest[],
  { delay = 0, timeout = 600 }: WarmOptions = {},
): () => void {
  const owned = generation;
  let live = true;
  let cancelIdle: (() => void) | undefined;
  let timer = 0;
  let active = 0;
  const queue = requests.slice();
  const stop = () => {
    live = false;
    unsubscribe();
    cancelIdle?.();
    cancelIdle = undefined;
    if (timer) window.clearTimeout(timer);
    timer = 0;
  };
  const schedule = () => {
    if (owned !== generation) return stop();
    if (!live || cancelIdle || timer) return;
    if (!queue.length) {
      if (!active) stop();
      return;
    }
    if (active < artworkWorkload().prefetch) cancelIdle = whenIdle(step, timeout);
  };
  const completed = () => {
    active -= 1;
    schedule();
  };
  const step = () => {
    cancelIdle = undefined;
    if (owned !== generation) return stop();
    if (!live) return;
    while (queue.length && active < artworkWorkload().prefetch) {
      const request = queue.shift();
      if (!request) break;
      active += 1;
      void loadArtwork({ ...request, eager: false }).then(completed, completed);
    }
    if (!queue.length && !active) stop();
  };
  const unsubscribe = observeArtworkWorkload(schedule);
  if (delay) {
    timer = window.setTimeout(() => {
      timer = 0;
      step();
    }, delay);
  } else {
    schedule();
  }
  return stop;
}

export async function loadBackdrop(
  url: string,
  signal?: AbortSignal,
): Promise<BackdropLease | null> {
  const blob = await boundedBlob(url, signal);
  if (!blob || signal?.aborted) return null;
  const bitmap = (await artworkOperation(
    {
      kind: "decode",
      blob,
      width: 1280,
      height: 720,
      fit: false,
      dimensions: pngDimensions.get(blob),
    },
    signal,
  )) as ImageBitmap | null;
  if (!bitmap || signal?.aborted) {
    bitmap?.close();
    return null;
  }
  const palette = await loadArtworkPalette(bitmap);
  if (signal?.aborted) {
    bitmap.close();
    return null;
  }
  let released = false;
  return {
    bitmap,
    palette,
    release: () => {
      if (released) return;
      released = true;
      bitmap.close();
    },
  };
}

export function cancelArtworkWork(): void {
  generation += 1;
  for (const [key, work] of Array.from(inflight)) cancelWork(key, work.controller);
  dropQueuedArtwork();
}

export function releaseAllArtwork(): void {
  const cachedKeys = [...cache.keys()];
  cancelArtworkWork();
  persistenceCancel?.();
  persistenceCancel = null;
  pendingPersistence.clear();
  for (const entry of cache.values()) entry.bitmap.close();
  cache.clear();
  logoEntries = 0;
  posterEntries = 0;
  posterBytes = 0;
  claims.clear();
  failed.clear();
  for (const key of cachedKeys) notifyArtwork(key);
}
