import { test } from "vitest";
import assert from "node:assert/strict";
import { FAVOURITES, lineupOf, nextChannel, stepColumn, wrap } from "../src/services/lineup";
import type { Channel } from "../src/types";

/**
 * The lists, and moving through one with the channel keys.
 *
 * Both of these went wrong in a way nothing on screen announced, which is exactly the kind
 * of mistake worth pinning: favouriting a channel moved the viewer to another category, and
 * channel up skipped the first channel of a category they had just walked into.
 */

const channel = (id: string, name = id, group = ""): Channel => ({
  id,
  name,
  logo: "",
  group,
  url: `http://example.com/${id}`,
  language: "",
  quality: "",
  number: 1,
});

const news = {
  key: "News",
  name: "News",
  channels: [channel("a", "a", "News"), channel("b", "b", "News"), channel("c", "c", "News")],
};
const sport = { key: "Sport", name: "Sport", channels: [channel("d", "d", "Sport")] };
const visible = { hiddenCategories: [] };
const listsOf = (channels: Channel[], categories: (typeof news)[], favourites: string[]) =>
  lineupOf(channels, categories, favourites, visible).lists;

test("there is no Favourites list until there is a favourite", () => {
  assert.deepEqual(listsOf([], [], []), []);
  assert.deepEqual(
    listsOf(news.channels, [news], []).map((l) => l.name),
    ["News"],
  );
});

test("the first favourite puts Favourites at the top", () => {
  const channels = [...news.channels, ...sport.channels];
  const lists = listsOf(channels, [news, sport], ["b"]);

  assert.deepEqual(
    lists.map((l) => l.name),
    [FAVOURITES, "News", "Sport"],
  );
  assert.deepEqual(
    lists[0].channels.map((c) => c.id),
    ["b"],
  );
  // Which is the shift App has to correct for: News was the first row and is now the second.
  assert.equal(
    listsOf(channels, [news, sport], []).findIndex((l) => l.name === "News"),
    0,
  );
  assert.equal(
    lists.findIndex((l) => l.name === "News"),
    1,
  );
});

test("a playlist category named Favourites remains distinct from the generated row", () => {
  const real = {
    key: FAVOURITES,
    name: FAVOURITES,
    channels: [channel("real", "real", FAVOURITES)],
  };
  const lists = listsOf([...real.channels, ...sport.channels], [real, sport], ["d"]);

  assert.equal(lists.length, 3);
  assert.equal(lists[0].synthetic, "favourites");
  assert.equal(lists[1].synthetic, undefined);
  assert.equal(lists[1].channels[0].id, "real");
});

test("favourites saved against another playlist leave no row behind", () => {
  // Favourites outlive the playlist they were made in, so a set of ids matching nothing here
  // is ordinary rather than exceptional, and it must not put an empty row at the top.
  assert.deepEqual(
    listsOf(news.channels, [news], ["gone"]).map((l) => l.name),
    ["News"],
  );
});

test("favourites keep the playlist's order rather than the order they were added", () => {
  const lists = listsOf(news.channels, [news], ["c", "a"]);
  assert.deepEqual(
    lists[0].channels.map((c) => c.id),
    ["a", "c"],
  );
});

test("a favourite for a channel the playlist no longer carries is simply absent", () => {
  const lists = listsOf(news.channels, [news], ["a", "gone"]);
  assert.deepEqual(
    lists[0].channels.map((c) => c.id),
    ["a"],
  );
});

test("effective hidden state removes categories and individual channels", () => {
  const lineup = lineupOf(
    [...news.channels, ...sport.channels],
    [{ ...news, hidden: true }, sport],
    ["a", "d"],
    {
      hiddenCategories: [],
      hiddenChannels: ["d"],
    },
  );
  assert.deepEqual(lineup.lists, []);
  assert.deepEqual(lineup.browsableChannels, []);
});

test("hidden categories and their channels leave the default lineup", () => {
  const lineup = lineupOf([...news.channels, ...sport.channels], [news, sport], ["a", "d"], {
    hiddenCategories: ["News"],
  });

  assert.deepEqual(
    lineup.lists.map((list) => list.name),
    [FAVOURITES, "Sport"],
  );
  assert.deepEqual(
    lineup.lists[0].channels.map((item) => item.id),
    ["d"],
  );
  assert.deepEqual(
    lineup.browsableChannels.map((item) => item.id),
    ["d"],
  );
  assert.deepEqual(
    lineup.searchableChannels.map((item) => item.id),
    ["d"],
  );
});

test("category visibility uses the playlist's exact category text", () => {
  const upper = {
    key: "NEWS",
    name: "NEWS",
    channels: [channel("upper", "upper", "NEWS")],
  };
  const lineup = lineupOf([...news.channels, ...upper.channels], [news, upper], [], {
    hiddenCategories: ["News"],
  });

  assert.deepEqual(
    lineup.lists.map((list) => list.name),
    ["NEWS"],
  );
  assert.deepEqual(
    lineup.browsableChannels.map((item) => item.id),
    ["upper"],
  );
});

test("empty categories stay hidden unless the viewer asks to keep them", () => {
  const empty = { key: "Empty", name: "Empty", channels: [] as Channel[] };
  const channels = [...news.channels, ...sport.channels];
  const categories = [news, empty, sport];
  const names = (visibility: {
    hiddenCategories: string[];
    hiddenChannels?: string[];
    hideEmptyCategories?: boolean;
  }) => lineupOf(channels, categories, [], visibility).lists.map((list) => list.name);

  assert.deepEqual(names({ hiddenCategories: [] }), ["News", "Sport"]);
  assert.deepEqual(names({ hiddenCategories: [], hideEmptyCategories: true }), [
    "News",
    "Sport",
  ]);
  assert.deepEqual(names({ hiddenCategories: [], hideEmptyCategories: false }), [
    "News",
    "Empty",
    "Sport",
  ]);
  assert.deepEqual(names({ hiddenCategories: ["Empty"], hideEmptyCategories: false }), [
    "News",
    "Sport",
  ]);

  const lineup = lineupOf(channels, categories, [], {
    hiddenCategories: [],
    hiddenChannels: ["d"],
    hideEmptyCategories: false,
  });
  assert.deepEqual(
    lineup.browsableChannels.map((item) => item.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    lineup.lists.find((list) => list.key === "Sport")?.channels.map((item) => item.id),
    [],
  );
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

test("column focus clamps at both ends rather than wrapping", () => {
  assert.equal(stepColumn(0, -1, 3, false), 0);
  assert.equal(stepColumn(2, 1, 3, false), 2);
  assert.equal(stepColumn(1, 1, 3, false), 2);
  assert.equal(stepColumn(1, -1, 3, false), 0);
});

test("a searched column clamps on the field above the first row", () => {
  assert.equal(stepColumn(-1, -1, 3, true), -1);
  assert.equal(stepColumn(0, -1, 3, true), -1);
  assert.equal(stepColumn(2, 1, 3, true), 2);
});

test("an empty searched column holds the field and nothing else", () => {
  assert.equal(stepColumn(-1, 1, 0, true), -1);
  assert.equal(stepColumn(0, 1, 0, false), 0);
});
