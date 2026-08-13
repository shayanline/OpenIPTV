import { test } from "vitest";
import assert from "node:assert/strict";
import { FAVOURITES, listsOf, nextChannel, wrap } from "../src/services/lineup";
import type { Channel } from "../src/types";

/**
 * The lists, and moving through one with the channel keys.
 *
 * Both of these went wrong in a way nothing on screen announced, which is exactly the kind
 * of mistake worth pinning: favouriting a channel moved the viewer to another category, and
 * channel up skipped the first channel of a category they had just walked into.
 */

const channel = (id: string, name = id): Channel => ({
  id, name, logo: "", group: "", url: `http://example.com/${id}`,
  language: "", quality: "", number: 1,
});

const news = { name: "News", channels: [channel("a"), channel("b"), channel("c")] };
const sport = { name: "Sport", channels: [channel("d")] };

test("Favourites is the first list even when nothing is in it", () => {
  const lists = listsOf([], [], []);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].name, FAVOURITES);
  assert.deepEqual(lists[0].channels, []);
});

test("adding a favourite does not move the categories", () => {
  const channels = [...news.channels, ...sport.channels];
  const before = listsOf(channels, [news, sport], []);
  const after = listsOf(channels, [news, sport], ["b"]);

  // The point of the whole exercise: the index a category sits at cannot change because a
  // favourite was made, or the viewer is moved somewhere they did not ask to be.
  assert.deepEqual(before.map((l) => l.name), after.map((l) => l.name));
  assert.equal(before.findIndex((l) => l.name === "News"), 1);
  assert.equal(after.findIndex((l) => l.name === "News"), 1);
  assert.deepEqual(after[0].channels.map((c) => c.id), ["b"]);
});

test("removing the last favourite does not move them back", () => {
  const lists = listsOf(news.channels, [news], []);
  assert.equal(lists.findIndex((l) => l.name === "News"), 1);
});

test("favourites keep the playlist's order rather than the order they were added", () => {
  const lists = listsOf(news.channels, [news], ["c", "a"]);
  assert.deepEqual(lists[0].channels.map((c) => c.id), ["a", "c"]);
});

test("a favourite for a channel the playlist no longer carries is simply absent", () => {
  const lists = listsOf(news.channels, [news], ["a", "gone"]);
  assert.deepEqual(lists[0].channels.map((c) => c.id), ["a"]);
});

test("channel up and down move by one", () => {
  assert.equal(nextChannel(news.channels, "a", 1), 1);
  assert.equal(nextChannel(news.channels, "b", -1), 0);
});

test("channel up wraps at the end, as it does on every television", () => {
  assert.equal(nextChannel(news.channels, "c", 1), 0);
  assert.equal(nextChannel(news.channels, "a", -1), 2);
});

test("a channel that is not in this list puts up on the first row and down on the last", () => {
  // Walking into a category without choosing anything leaves the playing channel elsewhere.
  // Treating that as position zero is what used to skip the first channel on the way up.
  assert.equal(nextChannel(news.channels, "elsewhere", 1), 0);
  assert.equal(nextChannel(news.channels, "elsewhere", -1), 2);
});

test("a list of one re-tunes the one channel there is rather than refusing in silence", () => {
  assert.equal(nextChannel(sport.channels, "d", 1), 0);
  assert.equal(nextChannel(sport.channels, "d", -1), 0);
});

test("an empty list has nowhere to go and says so", () => {
  assert.equal(nextChannel([], "a", 1), -1);
  assert.equal(nextChannel([], "", -1), -1);
});

test("wrap comes out the other side in both directions and survives an empty list", () => {
  assert.equal(wrap(3, 3), 0);
  assert.equal(wrap(-1, 3), 2);
  assert.equal(wrap(7, 3), 1);
  assert.equal(wrap(-7, 3), 2);
  // No list to wrap around, and no division by zero on the way to finding that out.
  assert.equal(wrap(5, 0), 0);
});
