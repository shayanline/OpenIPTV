/**
 * The set's flash, as a cache with a budget, over IndexedDB.
 *
 * services/store is the other half of this and the two are not interchangeable. That one is
 * localStorage, for settings, favourites and the last channel: a handful of short strings
 * that have to be readable before the first paint, which is exactly what a synchronous API
 * is good for. This one is for the bulk, which is the playlist text and the logos, and it is
 * a different API for three reasons.
 *
 *   1. Samsung documents localStorage as holding "up to 5 MB of data for your application".
 *      A twelve thousand channel playlist is around 2.3MB of text, so one large playlist
 *      plus the settings is already most of the allowance and a larger one does not fit at
 *      all. The failure is a thrown QuotaExceededError, which store.ts quite correctly
 *      swallows, so the effect was a cache that silently stopped working on exactly the
 *      playlists that most needed one, with nothing anywhere reporting it.
 *   2. setItem is synchronous. Writing two megabytes of text to flash on the main thread of
 *      a quad Cortex-A53, during launch, between the viewer pressing the button and the
 *      picture arriving, is the sort of thing the rest of this application has spent a lot
 *      of effort not doing.
 *   3. It cannot hold a Blob at all, and a logo is a Blob.
 *
 * IndexedDB has been on these televisions since Tizen 2.4, which is five years before the
 * oldest set this application supports, so nothing here is a new dependency on a new engine.
 * Samsung's own offline storage table lists it as supported on every version.
 *
 * The budget is ours rather than the platform's, which is the point of moving: 5MB was a
 * wall and is now a decision. Everything is a cache, so anything here can be thrown away at
 * any time and the application will fetch it again.
 */

import { whenIdle } from "./idle";

const DB_NAME = "simpleiptv";
const DB_VERSION = 1;

/**
 * Two stores, because eviction has to read the sizes of everything without reading the
 * things themselves.
 *
 * `values` holds the payloads and is only ever touched one key at a time. `meta` holds a
 * size and a last used time per key, and is small enough to read whole: a thousand entries
 * is a few tens of kilobytes. One store with an index on the timestamp would work too, and
 * would mean a cursor whose every step carries a payload, which is the thing being avoided.
 */
const VALUES = "values";
const META = "meta";

/**
 * What the whole cache may occupy.
 *
 * This was 5MB, deliberately the same as localStorage allowed, so that moving to a store with a
 * far larger quota did not quietly turn into using it. The reasoning was sound and the number
 * was wrong, in a way nothing said out loud: a playlist too big for the whole budget is refused
 * rather than cached, and the playlist people actually use is too big for 5MB.
 *
 * iptv-org's index is 2.7MB of text, which this file counts as 5.4MB at two bytes a character.
 * So it was refused, every launch, silently, and the app is right not to make a fuss about a
 * cache that would not take. What it cost was the launch: 2.7MB fetched over the air and
 * reparsed every single time the television was switched on, where a cached copy is an indexed
 * read off flash. Measured on the floor profile, six and a half seconds to a channel list
 * against two.
 *
 * 24MB, then, which holds that playlist and something like four thousand logos beside it. Not
 * larger, because the original argument still holds for everything above this line: a set has
 * four gigabytes of eMMC, Samsung publishes a flash optimisation guide asking applications not
 * to treat that as an invitation, and everything in here is refetchable. What changed is the
 * recognition that "refetchable" is not free when the thing being refetched is the first thing
 * the viewer waits for.
 */
export const BUDGET_BYTES = 24 * 1024 * 1024;

export interface Entry {
  key: string;
  bytes: number;
  /** When it was last read or written, so the least useful thing goes first. */
  at: number;
}

/**
 * What to delete to fit something new in, oldest first.
 *
 * Separated from the database and exported so it can be tested, which is the same reasoning
 * as windowOf in useWindowed: this is arithmetic over a list, mistakes in it are quiet, and
 * nothing on screen would announce that the cache had started evicting the entry it was
 * about to read.
 *
 * Least recently used rather than largest first. Largest first would keep four hundred
 * logos and evict the playlist, which is the one entry whose absence is felt at launch, and
 * it would do it every single time because the playlist is always the biggest thing here.
 *
 * `incoming` is counted but not evicted, and a replacement frees its own old size first, so
 * refreshing a playlist does not have to evict anything to make room for a copy of what it
 * is replacing.
 */
export function evictionPlan(
  entries: Entry[],
  incoming: { key: string; bytes: number },
  budget = BUDGET_BYTES,
): { evict: string[]; refused: boolean } {
  // Bigger than the whole budget on its own. Nothing to evict that would help, so it is not
  // cached at all rather than emptying the cache in a doomed attempt to fit it.
  if (incoming.bytes > budget) return { evict: [], refused: true };

  const others = entries.filter((e) => e.key !== incoming.key);
  let used = others.reduce((sum, e) => sum + e.bytes, 0) + incoming.bytes;
  if (used <= budget) return { evict: [], refused: false };

  const evict: string[] = [];
  for (const entry of [...others].sort((a, b) => a.at - b.at)) {
    evict.push(entry.key);
    used -= entry.bytes;
    if (used <= budget) break;
  }
  return { evict, refused: false };
}

/**
 * The database, opened once, and never a reason for anything to fail.
 *
 * Private browsing refuses to open one, a corrupted store refuses too, and neither is worth
 * interrupting a viewer over: this is a cache, so the answer to not having it is to fetch
 * things again. Every function below therefore treats an absent database as an empty one,
 * exactly as store.ts treats an absent localStorage.
 */
let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((settle) => {
    if (typeof indexedDB === "undefined") return settle(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return settle(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VALUES)) db.createObjectStore(VALUES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => settle(request.result);
    request.onerror = () => settle(null);
    request.onblocked = () => settle(null);
  });
  return opening;
}

/**
 * One read, as a promise. Null for a miss and null for a failure, which for a cache is the
 * same answer: go and get it from wherever it really came from.
 */
function get<T>(
  db: IDBDatabase,
  store: string,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return new Promise((settle) => {
    let request: IDBRequest<T>;
    try {
      request = work(db.transaction([store], "readonly").objectStore(store));
    } catch {
      return settle(null);
    }
    request.onsuccess = () => settle(request.result ?? null);
    request.onerror = () => settle(null);
  });
}

/**
 * One write, as a promise, reporting whether it actually happened.
 *
 * Separate from `get` and returning a boolean, which it did not always do. Both were one
 * function that resolved null on transaction complete and null on transaction error, so
 * every caller that checked for null was told a quota failure or an aborted transaction had
 * succeeded. The in memory index was then updated to say the cache held something it did not,
 * and the discrepancy would have survived until the next launch.
 *
 * The transaction completing is the answer rather than the request succeeding: a request can
 * succeed inside a transaction that later aborts, and then nothing was written.
 */
function commit(
  db: IDBDatabase,
  stores: string[],
  work: (tx: IDBTransaction) => void,
): Promise<boolean> {
  return new Promise((settle) => {
    try {
      const tx = db.transaction(stores, "readwrite");
      tx.oncomplete = () => settle(true);
      tx.onerror = tx.onabort = () => settle(false);
      work(tx);
    } catch {
      settle(false);
    }
  });
}

/**
 * The metadata, in memory, read from the database once.
 *
 * This started out reading the whole meta store on every write, which is tidy and was much
 * too slow to survive being measured. A write has to know what else is held before it can
 * decide what to evict, so caching a screenful of logos meant two full reads of the store per
 * logo, twenty eight times over, each its own transaction with its own structured clone and
 * its own event dispatch. On the floor profile that showed up as a frame of about 840
 * milliseconds while the interface was otherwise doing nothing at all, in every single run.
 *
 * It is only sizes and timestamps, a few tens of bytes per entry, so holding all of it costs
 * nothing worth counting even at a thousand entries. The database stays the record and this
 * stays a mirror of it.
 */
/**
 * Held as the promise rather than the map, so concurrent callers share one load.
 *
 * A cache miss on a screenful of logos asks for a dozen of these at once, and against a bare
 * `if (index) return index` every one of them would find it still null and start its own pair
 * of full reads of the metadata store. Twelve concurrent loads is not merely wasteful: they
 * settle in an arbitrary order, each assigning its own fresh map, so a write recorded against
 * one of them can be silently dropped when a later one replaces it.
 */
let indexing: Promise<Map<string, Omit<Entry, "key">>> | null = null;

function loadIndex(): Promise<Map<string, Omit<Entry, "key">>> {
  indexing ??= (async () => {
    const fresh = new Map<string, Omit<Entry, "key">>();
    const db = await open();
    if (!db) return fresh;
    const keys = await get<IDBValidKey[]>(db, META, (s) => s.getAllKeys());
    const values = await get<Omit<Entry, "key">[]>(db, META, (s) => s.getAll());
    if (keys && values) {
      // A loop rather than forEach, because Map.set returns the map and a forEach callback
      // that returns something reads as a map() somebody forgot to collect.
      for (let i = 0; i < keys.length; i++) fresh.set(String(keys[i]), values[i]);
    }
    return fresh;
  })();
  return indexing;
}

/** Everything the cache is holding, without reading any of it. */
export async function entries(): Promise<Entry[]> {
  return [...(await loadIndex())].map(([key, meta]) => ({ key, ...meta }));
}

export async function usage(): Promise<{ bytes: number; count: number }> {
  const all = await entries();
  return { bytes: all.reduce((sum, e) => sum + e.bytes, 0), count: all.length };
}

/**
 * Timestamps that have moved in memory and not yet on disk.
 *
 * Recency is only consulted when the cache is full, so it does not have to be durable the
 * instant it changes: what it must not do is cost a transaction per read, which is what
 * writing it through did. Flushed together in idle time, which keeps least recently used
 * meaningful across a restart without putting a write in front of every read.
 */
const unflushed = new Map<string, number>();
let flushing: (() => void) | null = null;

function flushSoon(): void {
  if (flushing) return;
  flushing = whenIdle(() => {
    flushing = null;
    void flushTouches();
  }, 4000);
}

async function flushTouches(): Promise<void> {
  const db = await open();
  if (!db || !unflushed.size) return;
  /*
   * The index is loaded here rather than at the point of the read, and that is deliberate.
   *
   * Loading it means reading the whole metadata store, two transactions, and the read it
   * would have hung off is the one that fetches the playlist during launch. Two transactions
   * on the launch path to record a timestamp that nothing consults until the cache is full is
   * the wrong trade. So the read notes when it happened and this applies it, in idle time,
   * where loading the index costs nothing anybody is waiting for.
   */
  const held = await loadIndex();
  // Taken only once there is a database to write them to. Clearing before checking meant that
  // with no database, or none yet open, the timestamps were dropped rather than deferred, and
  // the first flush after a launch is the one carrying the most of them.
  const touched = [...unflushed];
  unflushed.clear();
  const ok = await commit(db, [META], (tx) => {
    const store = tx.objectStore(META);
    for (const [key, at] of touched) {
      const meta = held.get(key);
      if (!meta) continue;
      meta.at = at;
      store.put(meta, key);
    }
  });
  // Put back what did not land, so a failed flush costs an ordering hint rather than losing
  // it. Only what is still held: anything forgotten meanwhile is gone for good reasons.
  if (!ok) for (const [key, at] of touched) if (held.has(key)) unflushed.set(key, at);
}

/**
 * Read something, and record that it was wanted.
 *
 * The touch is what makes eviction least recently used rather than least recently written,
 * and it matters for logos: a channel somebody watches every evening is written once and
 * read every launch, and without this it would be evicted ahead of artwork for a category
 * nobody has opened since the playlist was added. Not awaited, because a read should not
 * wait on a write to bookkeeping.
 */
export async function read(key: string): Promise<Blob | string | null> {
  const db = await open();
  if (!db) return null;
  const value = await get<Blob | string>(db, VALUES, (s) => s.get(key));
  if (value == null) return null;

  // One transaction, and nothing else waited on. When it was read is noted and applied later;
  // see flushTouches for why the index is deliberately not loaded here.
  unflushed.set(key, Date.now());
  flushSoon();
  return value;
}

const sizeOf = (value: Blob | string) =>
  typeof value === "string" ? value.length * 2 : value.size;

/**
 * Write something, evicting whatever has to go to make room for it.
 *
 * Returns whether it was kept, so a caller can say so rather than assume. Nothing here
 * throws: a cache that could not be written is a cache that will be read from the network
 * instead, and that is not a fault worth putting on a television screen.
 */
export async function write(key: string, value: Blob | string): Promise<boolean> {
  const db = await open();
  if (!db) return false;

  const bytes = sizeOf(value);
  // From the mirror, so this costs no transaction. It used to read the whole store, twice.
  const { evict, refused } = evictionPlan(await entries(), { key, bytes });
  if (refused) return false;
  if (evict.length) await forget((k) => evict.includes(k));

  const meta = { bytes, at: Date.now() };
  const ok = await commit(db, [VALUES, META], (tx) => {
    tx.objectStore(VALUES).put(value, key);
    tx.objectStore(META).put(meta, key);
  });
  // Only recorded if it actually landed. Recording it either way is how the mirror comes to
  // claim the cache holds something it does not, and a quota failure is the likeliest way in.
  if (!ok) return false;
  (await loadIndex()).set(key, meta);
  unflushed.delete(key);   // just written through, so nothing outstanding for it
  return true;
}

/**
 * Throw away everything the predicate agrees to.
 *
 * A predicate rather than a key or a prefix, because the two callers want different
 * questions asked: one drops a single logo, the other drops every playlist that is no longer
 * configured, and a prefix match cannot express the second.
 */
export async function forget(doomed: (key: string) => boolean): Promise<number> {
  const db = await open();
  if (!db) return 0;
  const going = (await entries()).filter((e) => doomed(e.key)).map((e) => e.key);
  if (!going.length) return 0;
  const ok = await commit(db, [VALUES, META], (tx) => {
    for (const key of going) {
      tx.objectStore(VALUES).delete(key);
      tx.objectStore(META).delete(key);
    }
  });
  // The mirror only forgets what the database forgot. Forgetting regardless would leave the
  // cache holding entries nothing knows the size of, so they could never be evicted and the
  // budget would drift permanently out of true.
  if (!ok) return 0;
  const held = await loadIndex();
  for (const key of going) {
    held.delete(key);
    unflushed.delete(key);
  }
  return going.length;
}

/** Everything, for "reset everything", which has to mean everything. */
export const forgetAll = () => forget(() => true);
