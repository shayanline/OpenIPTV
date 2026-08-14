import { test } from "vitest";
import assert from "node:assert/strict";
import { SEARCH_LIMIT, searchChannels } from "../src/services/search";
import type { Channel } from "../src/types";

/**
 * Searching a playlist by name.
 *
 * The interesting cases are not "does substring matching work". They are the ones a real
 * playlist produces: two hundred channels whose names all contain the same broadcaster, names
 * written in two scripts at once, and twelve thousand rows to walk on a set with a slow core.
 */

const channel = (number: number, name: string, group = "General"): Channel => ({
  id: `c${number}`,
  name,
  logo: "",
  group,
  url: `http://example.invalid/${number}.m3u8`,
  quality: "",
  number,
});

const NAMES = [
  "BBC One",
  "BBC Two",
  "ITV1",
  "Channel 4",
  "Sky News",
  "BBC News",
  "IRIB TV1 | شبکه یک",
];
const LIST = NAMES.map((name, i) => channel(i + 1, name));

test("an empty query matches nothing at all, rather than everything", () => {
  /*
   * The whole playlist would be the other reasonable answer and it is the wrong one. A viewer
   * who has opened search and typed nothing has expressed no preference, and answering with
   * twelve thousand rows means the one thing they asked for, a shorter list, is what they get
   * last. The column says what to do instead.
   */
  const { matches, total } = searchChannels(LIST, "");
  assert.deepEqual(matches, []);
  assert.equal(total, 0);
});

test("whitespace only is the same as empty, because it is what a keyboard produces", () => {
  assert.equal(searchChannels(LIST, "   ").total, 0);
});

test("matching is case insensitive and anywhere in the name", () => {
  const { matches } = searchChannels(LIST, "news");
  assert.deepEqual(matches.map((c) => c.name), ["Sky News", "BBC News"]);
});

test("names that start with the query come first, and keep playlist order within that", () => {
  /*
   * "BBC" is in three of these names and starts two of them. Ranked purely by playlist order,
   * "Sky News" would sit above "BBC News" for the query "bbc n", which reads as the search
   * ignoring what was typed. Starts-with first is the shortest rule that fixes it.
   */
  const { matches } = searchChannels(LIST, "bbc");
  assert.deepEqual(matches.map((c) => c.name), ["BBC One", "BBC Two", "BBC News"]);

  const mixed = searchChannels(
    [channel(1, "Sky Sports Cricket"), channel(2, "Cricket 24"), channel(3, "BT Cricket")],
    "cricket",
  );
  assert.deepEqual(mixed.matches.map((c) => c.name),
    ["Cricket 24", "Sky Sports Cricket", "BT Cricket"]);
});

test("a bilingual name is searchable in either of its scripts", () => {
  // The normal case in a real playlist, and the reason nothing here splits a name into parts.
  assert.equal(searchChannels(LIST, "irib").matches.length, 1);
  assert.equal(searchChannels(LIST, "شبکه").matches.length, 1);
});

test("the group is not searched, so a query answers with what it looks like", () => {
  const list = [channel(1, "Alpha", "News"), channel(2, "News at Ten", "General")];
  assert.deepEqual(searchChannels(list, "news").matches.map((c) => c.name), ["News at Ten"]);
});

test("results are capped, and the total says how many there really were", () => {
  /*
   * A single letter matches thousands of channels in a real playlist. The cap is not about the
   * DOM, since the list only ever builds the rows in view, it is about the work of ranking and
   * holding them: on the floor profile a twelve thousand row answer is paid for on every
   * keystroke and nobody scrolls to row four hundred. The total is kept so the interface can
   * say the list is longer than what it is showing, rather than quietly lying by omission.
   */
  const many = Array.from({ length: SEARCH_LIMIT + 40 }, (_, i) => channel(i + 1, `News ${i}`));
  const { matches, total } = searchChannels(many, "news");
  assert.equal(matches.length, SEARCH_LIMIT);
  assert.equal(total, SEARCH_LIMIT + 40);
});

test("a channel named after the query survives a cap full of weaker matches", () => {
  /*
   * The case that made the cap per rank rather than per result. Three hundred channels contain
   * "bbc" in the middle of their names and the three hundred and first is called "BBC One",
   * which is the one result anybody typing "bbc" is looking for. Capping the pair of them
   * together fills the list before reaching it and throws away the best answer.
   */
  const list = [
    ...Array.from({ length: SEARCH_LIMIT }, (_, i) => channel(i + 1, `Watch bbc ${i}`)),
    channel(SEARCH_LIMIT + 1, "BBC One"),
  ];
  const { matches } = searchChannels(list, "bbc");
  assert.equal(matches[0].name, "BBC One");
  assert.equal(matches.length, SEARCH_LIMIT);
});

test("a query nothing matches is empty rather than an error", () => {
  const { matches, total } = searchChannels(LIST, "zzzz");
  assert.deepEqual(matches, []);
  assert.equal(total, 0);
});

test("the same list searched twice gives the same answer", () => {
  /*
   * Which is worth asserting because the lowercase names are cached against the array to keep
   * a keystroke from folding twelve thousand strings again. A cache that answered differently
   * the second time would be the sort of fault that only shows up as a viewer typing.
   */
  const first = searchChannels(LIST, "bbc").matches.map((c) => c.id);
  const second = searchChannels(LIST, "bbc").matches.map((c) => c.id);
  assert.deepEqual(first, second);
});

test("a playlist replaced by a different one is not answered from the old one's names", () => {
  // The cache is keyed on the array, so this is really a test that it is keyed on the array.
  const a = [channel(1, "Alpha")];
  const b = [channel(1, "Beta")];
  assert.equal(searchChannels(a, "alpha").matches.length, 1);
  assert.equal(searchChannels(b, "alpha").matches.length, 0);
  assert.equal(searchChannels(b, "beta").matches.length, 1);
});
