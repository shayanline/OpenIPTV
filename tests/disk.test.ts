import { test } from "vitest";
import assert from "node:assert/strict";
import { BUDGET_BYTES, entries, evictionPlan, read, usage, write } from "../src/services/disk";

/**
 * What the cache throws away, and what it does when it has nowhere to keep anything.
 *
 * The arithmetic is tested rather than the database, on the same reasoning as windowOf in
 * useWindowed: it is a pure function over a list, a mistake in it is silent, and the symptom
 * of getting it wrong is a cache that quietly evicts the entry it was about to read. The
 * IndexedDB plumbing is exercised by `npm run tv:engines`, which loads the built application
 * in a real Chromium 69 and fails on any exception, so it is checked on the engine that would
 * actually have trouble with it rather than against a fake.
 */

const at = (key: string, bytes: number, when: number) => ({ key, bytes, at: when });
const MB = 1024 * 1024;

test("nothing is evicted while there is room", () => {
  const plan = evictionPlan([at("a", 100, 1), at("b", 100, 2)], { key: "c", bytes: 100 }, 1000);
  assert.deepEqual(plan, { evict: [], refused: false });
});

test("the least recently used goes first, and only as many as it takes", () => {
  const plan = evictionPlan(
    [at("oldest", 300, 1), at("middle", 300, 2), at("newest", 300, 3)],
    { key: "incoming", bytes: 300 },
    1000,
  );
  // 900 held plus 300 arriving is 1200 against 1000, so one has to go and exactly one does.
  // Evicting until it merely fits, rather than down to some comfortable level, is what stops
  // a cache emptying itself a step at a time.
  assert.deepEqual(plan, { evict: ["oldest"], refused: false });
});

test("several go when one is not enough, and no more than several", () => {
  // 400 held, 800 arriving, 1000 allowed. Dropping the oldest leaves 1050 and is not enough;
  // dropping the next leaves 900 and is. The third is untouched, which is the assertion worth
  // having: it walks in order and stops, rather than clearing the cache to be sure.
  const plan = evictionPlan(
    [at("oldest", 150, 1), at("middle", 150, 2), at("newest", 100, 3)],
    { key: "big", bytes: 800 },
    1000,
  );
  assert.deepEqual(plan.evict, ["oldest", "middle"]);
  assert.equal(plan.refused, false);
});

test("replacing an entry does not have to evict the copy it replaces", () => {
  // A playlist refresh writes a new version of something already held. Counting the old copy
  // against the budget alongside the new one would evict every logo on every refresh, to make
  // room for a thing whose space was about to be freed anyway.
  const plan = evictionPlan(
    [at("playlist", 900, 1), at("logo", 50, 2)],
    { key: "playlist", bytes: 950 },
    1000,
  );
  assert.deepEqual(plan, { evict: [], refused: false });
});

test("something larger than the whole budget is refused rather than cached", () => {
  const plan = evictionPlan([at("a", 100, 1)], { key: "enormous", bytes: 2000 }, 1000);
  // Not "evict everything and then fail": there is no arrangement of the cache that fits it,
  // so emptying the cache first would be throwing away useful things for nothing.
  assert.deepEqual(plan, { evict: [], refused: true });
});

test("an empty cache accepts anything that fits", () => {
  assert.deepEqual(evictionPlan([], { key: "a", bytes: 1000 }, 1000),
    { evict: [], refused: false });
});

test("the budget holds the largest playlist anybody actually uses", () => {
  /*
   * The number is 24MB rather than the 5MB localStorage allowed, and this is the case that
   * moved it. iptv-org's index is 2.7MB of text, which sizeOf counts as 5.4MB at two bytes a
   * character, so under a 5MB budget it was refused outright: bigger than the whole cache means
   * there is no arrangement that fits it. Nothing reported that, quite deliberately, since a
   * cache that will not take is not worth interrupting a viewer over, so the visible effect was
   * only that every launch downloaded and reparsed 2.7MB.
   *
   * Asserted as the playlist rather than as the constant, because it is the requirement. If the
   * budget ever has to come down again, this is the test that should have to be argued with.
   */
  const playlist = { key: "playlist:https://iptv-org.github.io/iptv/index.m3u", bytes: 2.7 * MB * 2 };
  assert.deepEqual(evictionPlan([], playlist), { evict: [], refused: false });
  assert.ok(BUDGET_BYTES >= playlist.bytes * 2, "and with room for logos beside it");
});

/**
 * jsdom has no IndexedDB, which makes this the no database case for free.
 *
 * Worth asserting rather than assuming. Private browsing refuses to open one and a corrupt
 * store refuses too, and on a television neither is worth interrupting anybody over: the
 * whole thing is a cache, so the answer to not having it is to fetch things again. Every
 * function has to behave as though the cache were simply empty, and none may throw.
 */
test("with no database at all, the cache is empty and nothing throws", async () => {
  assert.equal(typeof indexedDB, "undefined", "jsdom grew an IndexedDB, so rewrite this test");

  assert.equal(await read("anything"), null);
  assert.equal(await write("anything", "some text"), false);
  assert.deepEqual(await entries(), []);
  assert.deepEqual(await usage(), { bytes: 0, count: 0 });
});
