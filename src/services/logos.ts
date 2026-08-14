/**
 * Channel logos, shrunk once to the size they are actually drawn at.
 *
 * Playlists point at whatever artwork the broadcaster happens to host, and it is never
 * sized for a list row. Measured on a real playlist, the fifteen logos on screen carried
 * 46.9 MB of bitmap between them against 0.21 MB at display size, one of them 2000x2000
 * pixels squeezed into a box of 76x48. On a set with two gigabytes of memory, that is a
 * lot to spend on fifteen thumbnails, and every repaint resamples the full size original.
 *
 * So each address is decoded once, resampled to the box it occupies, and the original is
 * dropped. Samsung's memory guidance puts this first for a reason: "the real memory is the
 * number of pixels actually drawn on screen times four bytes".
 *
 * The result is an ImageBitmap drawn into a canvas rather than a smaller file swapped into
 * an <img>. Producing a file would mean reading pixels back out of a canvas, and a logo
 * fetched from a host that sends no CORS headers taints the canvas and makes that throw.
 * Drawing is unaffected by tainting, so this works whatever the host does.
 */

import * as disk from "./disk";
import { whenIdle } from "./idle";

/** Enough entries for a long category, and a trivial amount of memory at this size. */
const LIMIT = 240;

/**
 * The key a logo is saved under on disk, which is the key it is cached under in memory.
 *
 * Prefixed so the sweep in the channel store can tell a logo from a playlist. Deliberately
 * not swept when a playlist goes: the same channels usually come back, artwork is what takes
 * longest to reappear, and the budget already bounds it.
 */
const diskKey = (key: string) => `logo:${key}`;

/**
 * The box a logo is drawn into, in one place.
 *
 * Both the list and the preparing of neighbouring categories need it, and two copies of the
 * same pair of numbers is how a cache ends up holding bitmaps at a size nothing asks for.
 */
export const LOGO_BOX = { width: 76, height: 48 };

const cache = new Map<string, ImageBitmap>();
const inflight = new Map<string, Promise<ImageBitmap | null>>();
const failed = new Set<string>();

/**
 * Keyed by the box it was reduced to, not just the address.
 *
 * The same logo is drawn at three sizes: small in the list, larger in the information panel,
 * larger again on the notice card. Keying on the address alone would hand the card the
 * seventy six pixel version and stretch it. Three small bitmaps are still a rounding error
 * against one original.
 */
const keyOf = (url: string, width: number, height: number) => `${width}x${height}|${url}`;

/** Ready to draw now, or nothing. */
export const logoOf = (url: string, width: number, height: number): ImageBitmap | null =>
  cache.get(keyOf(url, width, height)) ?? null;

function remember(key: string, bitmap: ImageBitmap) {
  cache.set(key, bitmap);
  // Map keeps insertion order, so the front of it is the least recently added.
  while (cache.size > LIMIT) {
    const oldest = cache.keys().next().value as string;
    cache.get(oldest)?.close();
    cache.delete(oldest);
  }
}

/**
 * A queue, so a screenful of rows does not all start decoding at once.
 *
 * Changing category mounts a screenful together and each row asks for its own logo. Left
 * unmanaged that was fifteen decodes starting at the same moment, and the interface froze
 * for three and a half seconds, which is not a dropped frame, it is the app appearing to
 * have crashed.
 *
 * Two at a time. Measured on the floor profile against one, four and eight while racing the
 * category rail: one and two are indistinguishable, four is no better, and eight is plainly
 * worse, taking the median frame from about seventy milliseconds to a hundred and thirty and
 * adding stalls. Widening the queue does not fill the rows any sooner, it only lets the
 * decodes compete with the interface that is trying to draw them.
 */
const LANES = 2;

/**
 * Someone waiting for a lane, who must be told either way.
 *
 * Both outcomes have to be delivered. Discarding a waiter rather than cancelling it leaves
 * the job awaiting it suspended for the rest of the session: its `finally` never runs, so
 * its entry is never taken out of `inflight`, and every later caller for that logo is handed
 * the same promise that will never settle. One dropped warming pass is enough to make a logo
 * unloadable for good and to stall the chain queuing the rest of them.
 */
interface Waiter {
  /** A lane is free: take it. */
  start: () => void;
  /** Nobody wants this any more: come back with nothing, having taken no lane. */
  cancel: () => void;
}

let active = 0;
/** Rows on screen now. Never abandoned: something is waiting to draw them. */
const urgent: Waiter[] = [];
/** Rows just out of view. Worth doing, worth dropping the moment the list moves on. */
const background: Waiter[] = [];

/** Resolves true when a lane was taken, false when the work was called off while queued. */
const takeTurn = (eager: boolean): Promise<boolean> => {
  if (active < LANES) {
    active += 1;
    return Promise.resolve(true);
  }
  return new Promise<boolean>((settle) => {
    (eager ? urgent : background).push({
      start: () => { active += 1; settle(true); },
      cancel: () => settle(false),
    });
  });
};

const endTurn = () => {
  active -= 1;
  // Rows on screen always go before rows being prepared ahead of time.
  (urgent.shift() ?? background.shift())?.start();
};

/**
 * Which addresses are on screen at this moment.
 *
 * A queue alone was not enough. Walking briskly through ten categories queues a hundred
 * and fifty logos, all of them urgent when they were asked for and almost all of them
 * pointless by the time their turn arrives, and they went on decoding for seconds after
 * the viewer had settled somewhere else. So a job checks, at the front of the queue rather
 * than the back, whether anybody is still waiting to see it.
 */
const onScreen = new Map<string, number>();

export function claimLogo(url: string, width: number, height: number) {
  const key = keyOf(url, width, height);
  onScreen.set(key, (onScreen.get(key) ?? 0) + 1);
}

export function releaseLogo(url: string, width: number, height: number) {
  const key = keyOf(url, width, height);
  const held = (onScreen.get(key) ?? 0) - 1;
  if (held > 0) onScreen.set(key, held);
  else onScreen.delete(key);
}

/**
 * Forget the work queued for rows nobody is looking at any more.
 *
 * Changing category makes every queued logo from the last one worthless, and leaving them
 * in the queue means the next category waits behind artwork for channels that are no
 * longer on screen. Measured, that spilled across into scrolling and put fifteen stalls
 * into a phase that had none.
 *
 * Every dropped waiter is cancelled rather than discarded, so the job behind it finishes
 * tidily and its address can be asked for again later. See Waiter above.
 */
export function dropQueuedWarming() {
  const dropped = background.splice(0, background.length);
  for (const waiter of dropped) waiter.cancel();
}

/** Hosts that refused a cross origin fetch once will refuse it again. */
const noFetch = new Set<string>();

/**
 * Keep the reduced logo, so the next launch does not decode it again.
 *
 * The reduced one, not the original, and that is the whole value. The expensive part of a
 * logo has never been the download, it is the decode: broadcasters host artwork at whatever
 * size suits them, two thousand pixels square being real, and fifteen of those decoding at
 * once froze the interface for three and a half seconds. Saving the original would spare the
 * network and leave that cost exactly where it was, on every launch, forever.
 *
 * Re-encoded through a canvas, which means reading pixels back out of one, which is the one
 * thing tainting forbids. On a television it is never tainted: a packaged Tizen app declares
 * the origins it may reach in config.xml, so the fetch path in decodeToSize succeeds and the
 * bitmap came from bytes this app owns. In a desktop browser most hosts refuse that fetch,
 * the <img> fallback runs, the canvas is tainted and toBlob throws. So the saving works
 * where it matters and quietly does not where it does not, which is the same trade
 * decodeToSize already makes and for the same reason.
 *
 * PNG, because these are logos: flat colour, hard edges and transparency, all of which PNG
 * keeps and JPEG ruins. At 76x48 the file is a few kilobytes.
 */
/**
 * Logos encoded and waiting to be written, and the write happens in idle time.
 *
 * Saving them inline cost a measurable regression and it is worth recording what it looked
 * like, because the mistake is an easy one to make twice. Holding the down key inside a
 * category went from eight stalls to twelve, and unevenly: four runs of the old code gave
 * 8, 10, 8, 8, and four of the new gave 14, 5, 14, 9. The spread is the tell. A scroll that
 * crossed rows whose artwork was already saved cost nothing, and one that crossed new rows
 * paid for a database transaction per logo, on the main thread, while the viewer's thumb was
 * still on the key.
 *
 * Nothing is waiting for these. The logo is already decoded, already in memory and already
 * on screen; writing it down only matters for the next launch. So it queues, and the queue
 * drains one at a time in whatever time is going spare, which is the same shape as
 * warmChain below and for the same reason.
 */
/**
 * A map rather than an array, so an address queued twice is queued once.
 *
 * It can be: a logo evicted from the memory cache and then scrolled back to is decoded again,
 * and without this it would be written again as well.
 */
const unsaved = new Map<string, Blob>();

/**
 * How many encoded logos may be waiting.
 *
 * Bounded because they are Blobs, and idle time is not guaranteed to arrive: a viewer holding
 * the down key gives the browser no idle callbacks at all, and every new row decodes artwork
 * that then queues. Unbounded, a long walk through a large playlist accumulates every logo it
 * passed, in memory, on a set whose whole application budget is 120MB.
 *
 * The oldest goes when it is full, which is the right one to lose: it has been waiting longest
 * so it is the most likely to have been written by an earlier pass, and if it has not, all
 * that happens is the next launch fetches one logo.
 */
const MOST_UNSAVED = 64;

/** A drain waiting for idle time. */
let scheduled: (() => void) | null = null;
/** A write actually in flight, which is a different thing and used to be conflated. */
let draining = false;

function queueSave(key: string, blob: Blob): void {
  if (!unsaved.has(key) && unsaved.size >= MOST_UNSAVED) {
    const oldest = unsaved.keys().next();
    if (!oldest.done) unsaved.delete(oldest.value);
  }
  unsaved.set(key, blob);
  scheduleSaves();
}

/**
 * One write at a time, which took two flags to actually mean.
 *
 * With a single flag cleared at the top of the drain, anything queued while a write was in
 * flight found it already null and scheduled another drain, so the number of concurrent
 * database writes was however many logos happened to be decoded during one write. That is
 * the opposite of the intent: the queue exists so that the set is asked to write to flash
 * once at a time, in the gaps, rather than in a burst while somebody is pressing a key.
 */
function scheduleSaves(): void {
  if (scheduled || draining) return;
  scheduled = whenIdle(drainSaves, 3000);
}

function drainSaves(): void {
  scheduled = null;
  const next = unsaved.entries().next();
  if (next.done) return;
  const [key, blob] = next.value;
  unsaved.delete(key);

  draining = true;
  const done = () => {
    draining = false;
    if (unsaved.size) scheduleSaves();
  };
  // Both arms, so a rejection cannot leave `draining` stuck true and the queue stalled for
  // the rest of the session. disk.write is written not to reject, and that is its business.
  disk.write(diskKey(key), blob).then(done, done);
}

function keep(key: string, bitmap: ImageBitmap): void {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    // toBlob encodes off the main thread, so the cost here is the drawImage. The write it
    // hands on is the expensive part, and that is what waits.
    canvas.toBlob((blob) => {
      if (blob) queueSave(key, blob);
    }, "image/png");
  } catch {
    // Tainted, or no canvas support. Neither is worth reporting: the logo is on screen, and
    // all that is lost is having to fetch it again next time.
  }
}

/**
 * A logo saved by an earlier run, decoded at the size it was saved at.
 *
 * Which is small, so this is the cheap decode rather than the expensive one, and it is why
 * saving the reduced version rather than the original was the point.
 */
async function fromDisk(key: string): Promise<ImageBitmap | null> {
  const saved = await disk.read(diskKey(key));
  if (!(saved instanceof Blob)) return null;
  try {
    return await createImageBitmap(saved);
  } catch {
    // Saved by a version that wrote something else, or simply corrupt. Drop it so the next
    // launch does not try again, and fall through to the network.
    void disk.forget((k) => k === diskKey(key));
    return null;
  }
}

/**
 * Decode straight to the size wanted, never materialising the original.
 *
 * This is the whole trick. Handing an <img> to createImageBitmap means the browser has
 * already decoded two thousand pixels square before anything is resized, and that decode is
 * what stalls the list. Handing it the compressed bytes instead lets it scale during the
 * decode, so the large bitmap never exists.
 *
 * It needs the bytes, which means fetching them. In a plain browser that is a cross origin
 * request most broadcasters will refuse, and the caller falls back. On the TV it is allowed:
 * a packaged Tizen app declares the origins it may reach in config.xml, which is why that
 * file carries an access element, and the platform grants them rather than asking the server
 * for permission. So the path that matters is the one that works where it matters. A host
 * that refuses is remembered, so the refusal is paid for once instead of on every visit.
 */
async function decodeToSize(url: string, width: number, height: number) {
  let host: string;
  try { host = new URL(url, location.href).host; } catch { return null; }
  if (noFetch.has(host)) return null;

  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();

    // One dimension only. Given both, the decoder stretches to fill them; given one it
    // keeps the proportions, which is what the box wants.
    const byWidth = await createImageBitmap(blob, { resizeWidth: width, resizeQuality: "high" });
    if (byWidth.height <= height) return byWidth;

    // Taller than the box, so constrain the other way instead. Cheap, because it is
    // rescaling something already small rather than going back to the original.
    const byHeight = await createImageBitmap(byWidth, { resizeHeight: height, resizeQuality: "high" });
    byWidth.close();
    return byHeight;
  } catch {
    noFetch.add(host);
    return null;
  }
}

/**
 * Fetch, decode and shrink, once per address.
 *
 * Callers may ask repeatedly and from several rows at once; the work happens a single time
 * and everyone waits on the same promise.
 */
export function shrink(
  url: string,
  width: number,
  height: number,
  /** A row on screen, as opposed to one being warmed ahead of arriving. */
  eager = true,
): Promise<ImageBitmap | null> {
  const key = keyOf(url, width, height);
  const ready = cache.get(key);
  if (ready) return Promise.resolve(ready);
  if (failed.has(url)) return Promise.resolve(null);

  const already = inflight.get(key);
  if (already) return already;

  const work = (async () => {
    // No lane, because the work was called off while it waited for one. Nothing has been
    // taken, so nothing is given back, but the entry has to go or this address is stuck.
    if (!(await takeTurn(eager))) {
      inflight.delete(key);
      return null;
    }
    try {
      // The list may have moved on while this waited its turn.
      const arrived = cache.get(key);
      if (arrived) return arrived;
      if (eager && !onScreen.has(key)) return null;   // its row is long gone

      // Disk before network. An earlier run already paid for the download and, more to the
      // point, for reducing it, so this is a small decode of a few kilobytes.
      const saved = await fromDisk(key);
      if (saved) { remember(key, saved); return saved; }

      const scaled = await decodeToSize(url, width, height);
      if (scaled) { remember(key, scaled); keep(key, scaled); return scaled; }

      // Nothing scaled arrived, so fall back to letting the browser load it as an image and
      // shrinking afterwards. Costs a full size decode, which is the thing worth avoiding,
      // but it works where fetching does not.
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();

      // Fitted inside the box rather than stretched to it, which is what object-fit was
      // doing for the <img> this replaces. Resampling happens inside the decoder, so the
      // full size bitmap is never handed to us and never becomes ours to hold.
      const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight, 1);
      const bitmap = await createImageBitmap(img, {
        resizeWidth: Math.max(1, Math.round(img.naturalWidth * scale)),
        resizeHeight: Math.max(1, Math.round(img.naturalHeight * scale)),
        resizeQuality: "high",
      });
      remember(key, bitmap);
      // Saved too, and it will usually fail. This path only runs when the fetch was refused,
      // which means the pixels came through an <img> from another origin and the canvas keep
      // uses is tainted. Attempted anyway rather than skipped, because the refusal is the
      // host's decision and not every host that blocks fetch also lacks CORS headers.
      keep(key, bitmap);
      return bitmap;
    } catch {
      // A logo that will not load is not worth reporting, and not worth retrying either.
      failed.add(url);
      return null;
    } finally {
      inflight.delete(key);
      endTurn();
    }
  })();

  inflight.set(key, work);
  return work;
}

/** Drop everything, for when the app goes off screen and the memory is better spent. */
export function releaseLogos() {
  for (const bitmap of cache.values()) bitmap.close();
  cache.clear();
  failed.clear();
}

/**
 * Prepare a logo nobody has asked to see yet.
 *
 * The dimensions are the row's, since that is where it will end up, and the priority is the
 * lowest there is: anything actually on screen goes first.
 */
export function warmLogo(url: string) {
  return shrink(url, LOGO_BOX.width, LOGO_BOX.height, false);
}

/** Whether warming this address would do anything, or it is already had, going, or hopeless. */
const worthWarming = (url: string): boolean => {
  const key = keyOf(url, LOGO_BOX.width, LOGO_BOX.height);
  return !cache.has(key) && !inflight.has(key) && !failed.has(url);
};

export interface WarmOptions {
  /** A pause before the first one, to let whatever prompted this finish drawing. */
  delay?: number;
  /** How long to let the browser hold an idle callback before insisting. */
  timeout?: number;
}

/**
 * Prepare a run of logos, one at a time, in whatever time is going spare.
 *
 * One at a time and chained, rather than started together. Broadcasters host artwork at
 * whatever size suits them, two thousand pixels square being real, and asking for eighteen
 * of those at once produces exactly the stall this exists to avoid: the median frame is fine
 * and every so often the list freezes for a third of a second. Spread out, no single press
 * ever pays for more than one.
 *
 * Returns the function that calls the whole thing off.
 *
 * One implementation, shared. The channel list and the category rail both warm ahead of
 * themselves, and two copies of this drift: the idle timeout, the cancellation, and in
 * particular the one detail that is easy to get wrong. An idle callback id and a timeout id
 * are separate numeric namespaces, so clearing one by the other's number cancels whichever
 * unrelated timer happens to share it, and this application keeps seven live at once.
 */
export function warmChain(urls: string[], { delay = 0, timeout = 600 }: WarmOptions = {}) {
  const queue = urls.filter(worthWarming);
  let live = true;
  let idle: number | undefined;
  let timer: number | undefined;

  const stop = () => {
    live = false;
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    if (timer !== undefined) window.clearTimeout(timer);
    idle = timer = undefined;
  };

  if (!queue.length) return stop;

  const step = () => {
    idle = timer = undefined;
    const src = queue.shift();
    if (!live || !src) return;
    // The next one is queued only once this has finished, so the work stays behind whatever
    // the viewer is doing rather than beside it.
    void warmLogo(src).then(() => { if (live) schedule(); });
  };

  const schedule = () => {
    if (!live) return;
    if (window.requestIdleCallback) idle = window.requestIdleCallback(step, { timeout });
    else timer = window.setTimeout(step, Math.min(timeout, 120));
  };

  if (delay > 0) timer = window.setTimeout(schedule, delay);
  else schedule();

  return stop;
}
