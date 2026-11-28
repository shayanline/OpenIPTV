import { test } from "vitest";
import assert from "node:assert/strict";
import {
  UNCATEGORISED,
  groupByCategory,
  parseM3U,
  sourceFingerprint,
} from "../src/services/m3u";

/**
 * The parser is the one part of the app fed by strangers, so it is the part worth pinning
 * down. Every case here is a way a real playlist bends the format, not a hypothetical.
 */

test("source fingerprints are stable lowercase hexadecimal values", () => {
  const fingerprint = sourceFingerprint(
    "a.tv",
    "Channel A",
    "News",
    "http://example.com/a.m3u8",
  );
  assert.equal(
    fingerprint,
    sourceFingerprint("a.tv", "Channel A", "News", "http://example.com/a.m3u8"),
  );
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.notEqual(
    fingerprint,
    sourceFingerprint("a.tv", "شبکه یک", "News", "http://example.com/a.m3u8"),
  );
  assert.equal(fingerprint.includes("example"), false);
});

test("duplicate source fingerprints receive deterministic occurrence suffixes", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="same" group-title="News",Same
http://user:secret@example.com/live
#EXTINF:-1 tvg-id="same" group-title="News",Same
http://user:secret@example.com/live`);
  assert.match(channels[0].sourceFingerprint ?? "", /^[0-9a-f]{16}$/);
  assert.equal(channels[1].sourceFingerprint, `${channels[0].sourceFingerprint}00000002`);
  assert.equal(channels[1].sourceFingerprint?.includes("secret"), false);
  const reordered = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="other",Other
http://example.com/other
#EXTINF:-1 tvg-id="same" group-title="News",Same
http://user:secret@example.com/live`);
  assert.equal(reordered[1].sourceFingerprint, channels[0].sourceFingerprint);
});

test("reads the attributes and the title", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="a.tv" tvg-logo="http://x/a.png" group-title="News" tvg-quality="FHD",Channel A
http://example.com/a.m3u8`);

  assert.equal(c.id, "a.tv");
  assert.equal(c.name, "Channel A");
  assert.equal(c.logo, "http://x/a.png");
  assert.equal(c.group, "News");
  assert.equal(c.quality, "FHD");
  assert.equal(c.url, "http://example.com/a.m3u8");
  assert.equal(c.number, 1);
});

test("reads the provider channel numbers from the issue 46 example", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-chno="1",Canal 1
http://example.invalid/1
#EXTINF:-1 tvg-chno="2",Canal 2 CDR
http://example.invalid/2
#EXTINF:-1 tvg-chno="4",Canal 4
http://example.invalid/4
#EXTINF:-1 tvg-chno="6",Canal 6
http://example.invalid/6
#EXTINF:-1 tvg-chno="8",Canal 8
http://example.invalid/8
#EXTINF:-1 tvg-chno="11",Canal 11
http://example.invalid/11
#EXTINF:-1 tvg-chno="88",88 Stereo
http://example.invalid/88`);
  assert.deepEqual(
    channels.map((channel) => channel.number),
    [1, 2, 4, 6, 8, 11, 88],
  );
});

test("missing numbers follow the last emitted number, including after a lower provider number", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1,First
http://example.invalid/first
#EXTINF:-1 TVG-CHNO=' 0042 ',Forty Two
http://example.invalid/forty-two
#EXTINF:-1,Next
http://example.invalid/next
#EXTINF:-1 tvg-chno="4",Four
http://example.invalid/four
#EXTINF:-1,Last
http://example.invalid/last`);
  assert.deepEqual(
    channels.map((channel) => channel.number),
    [1, 42, 43, 4, 5],
  );
});

test.each([
  "",
  " ",
  "0",
  "-1",
  "7.1",
  "7.0",
  "+7",
  "1e3",
  "0x10",
  "NaN",
  "Infinity",
  "12text",
  "9007199254740992",
  "9007199254740993",
])("invalid tvg-chno %j uses fallback numbering without poisoning later entries", (value) => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-chno="40",Forty
http://example.invalid/forty
#EXTINF:-1 tvg-chno="${value}",Fallback
http://example.invalid/fallback
#EXTINF:-1,Next
http://example.invalid/next`);
  assert.deepEqual(
    channels.map((channel) => channel.number),
    [40, 41, 42],
  );
});

test("an overflowing increment falls back to the emitted channel's playlist position", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-chno="9007199254740991",Largest
http://example.invalid/largest
#EXTINF:-1,Fallback
http://example.invalid/fallback
#EXTINF:-1,Next
http://example.invalid/next`);
  assert.deepEqual(
    channels.map((channel) => channel.number),
    [9007199254740991, 2, 3],
  );
});

test("entries without a playable URL do not advance fallback numbering", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-chno="500",Discarded
not a URL
#EXTINF:-1,First
http://example.invalid/first
#EXTINF:-1 tvg-chno="800",Also Discarded
#EXTVLCOPT:network-caching=1000
#EXTINF:-1,Second
http://example.invalid/second
#EXTINF:-1,Third
http://example.invalid/third
#EXTINF:-1 tvg-chno="900",No URL`);
  assert.deepEqual(
    channels.map((channel) => channel.number),
    [1, 2, 3],
  );
});

test("provider numbers and duplicates do not reorder or remove channels", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-chno="88",First
http://example.invalid/first
#EXTINF:-1 tvg-chno="2",Second
http://example.invalid/second
#EXTINF:-1 tvg-chno="2",Third
http://example.invalid/third`);
  assert.deepEqual(
    channels.map((channel) => [channel.name, channel.number]),
    [
      ["First", 88],
      ["Second", 2],
      ["Third", 2],
    ],
  );
});

test("changing only provider numbers preserves channel IDs and source fingerprints", () => {
  const original = `#EXTM3U
#EXTINF:-1 tvg-id="same" group-title="News",One
http://example.invalid/one
#EXTINF:-1 tvg-id="same" group-title="News",Two
http://example.invalid/two`;
  const before = parseM3U(original);
  const after = parseM3U(original.replace(/tvg-id="same"/g, 'tvg-id="same" tvg-chno="88"'));
  assert.deepEqual(
    after.map((channel) => channel.number),
    [88, 88],
  );
  assert.deepEqual(
    after.map((channel) => [channel.id, channel.sourceFingerprint]),
    before.map((channel) => [channel.id, channel.sourceFingerprint]),
  );
});

test("a title may contain commas, and only the first one separates", () => {
  const [c] = parseM3U(`#EXTINF:-1 tvg-id="x",News, Sport, and Weather
http://example.com/x.m3u8`);
  assert.equal(c.name, "News, Sport, and Weather");
});

test("attribute values may be single quoted", () => {
  const [c] = parseM3U(`#EXTINF:-1 group-title='Movies',A
http://example.com/a.m3u8`);
  assert.equal(c.group, "Movies");
});

test("player directives between the tag and the url are not urls", () => {
  const channels = parseM3U(`#EXTINF:-1,A
#EXTVLCOPT:network-caching=1000
#EXTGRP:Sport
http://example.com/a.m3u8`);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].url, "http://example.com/a.m3u8");
});

test("#EXTGRP supplies the group when group-title is absent", () => {
  const [c] = parseM3U(`#EXTINF:-1,A
#EXTGRP:Sport
http://example.com/a.m3u8`);
  assert.equal(c.group, "Sport");
});

test("a tag written without its leading hash is ignored, not taken for a url", () => {
  const channels = parseM3U(`#EXTINF:-1,A
EXTVLCOPT:something
http://example.com/a.m3u8`);
  assert.equal(channels.length, 1);
  assert.equal(channels[0].url, "http://example.com/a.m3u8");
});

test("anything that is not a url is skipped", () => {
  const channels = parseM3U(`#EXTINF:-1,A
not a url
http://example.com/a.m3u8`);
  assert.equal(channels.length, 1);
});

test("a channel with no id is keyed on its url, so favourites still work", () => {
  const [c] = parseM3U(`#EXTINF:-1,A
http://example.com/a.m3u8`);
  assert.equal(c.id, "url:http://example.com/a.m3u8");
});

test("carriage returns and blank lines are tolerated", () => {
  const channels = parseM3U("#EXTM3U\r\n\r\n#EXTINF:-1,A\r\nhttp://e.com/a.m3u8\r\n");
  assert.equal(channels.length, 1);
  assert.equal(channels[0].url, "http://e.com/a.m3u8");
});

test("an ungrouped channel lands in one named bucket rather than an empty one", () => {
  const groups = groupByCategory(
    parseM3U(`#EXTINF:-1,A
http://e.com/a.m3u8`),
  );
  assert.equal(groups[0].name, UNCATEGORISED);
});

test("groups keep the order the playlist introduces them in", () => {
  const groups = groupByCategory(
    parseM3U(`#EXTINF:-1 group-title="B",1
http://e.com/1
#EXTINF:-1 group-title="A",2
http://e.com/2
#EXTINF:-1 group-title="B",3
http://e.com/3`),
  );
  assert.deepEqual(
    groups.map((g) => g.name),
    ["B", "A"],
  );
  assert.equal(groups[0].channels.length, 2);
});

test("two spellings of a group stay two groups", () => {
  // Deciding they mean the same thing would mean guessing at a naming convention, and
  // every playlist has a different one.
  const groups = groupByCategory(
    parseM3U(`#EXTINF:-1 group-title="News",1
http://e.com/1
#EXTINF:-1 group-title="News | Sport",2
http://e.com/2`),
  );
  assert.equal(groups.length, 2);
});

test("names in any script survive untouched", () => {
  const [c] = parseM3U(`#EXTINF:-1,شبکه یک
http://e.com/a.m3u8`);
  assert.equal(c.name, "شبکه یک");
});

test("an empty playlist yields nothing rather than throwing", () => {
  assert.deepEqual(parseM3U(""), []);
  assert.deepEqual(parseM3U("#EXTM3U"), []);
});

test("an absurd quality label is held to the length of a badge", () => {
  // Nothing standardises this attribute and nothing stops a playlist writing an essay in it.
  // Drawn unbounded beside the channel name it pushed the rest of the row off the screen.
  const [channel] = parseM3U(
    '#EXTM3U\n#EXTINF:-1 tvg-quality="1080p60 HDR10+ Dolby Vision",Big\nhttp://e.com/a\n',
  );
  assert.equal(channel.quality.length <= 6, true);
  assert.equal(channel.quality, "1080p6");
});

test("a playlist with no quality attribute reports none rather than whitespace", () => {
  const [channel] = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-quality="  ",Plain\nhttp://e.com/a\n');
  assert.equal(channel.quality, "");
});

/*
 * Identity, which the rest of the application takes on trust.
 *
 * Favourites are a list of ids, the playing marker compares one, and channel up and down
 * find their place with findIndex. All of that quietly breaks if two channels share an id,
 * and tvg-id is not an identifier: it names a channel in a programme guide, so a playlist
 * carrying one channel at three bitrates gives all three the same value.
 */
test("channels carrying the same tvg-id still get one id each", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="bbc.uk",BBC One HD
http://example.com/hd.m3u8
#EXTINF:-1 tvg-id="bbc.uk",BBC One SD
http://example.com/sd.m3u8
#EXTINF:-1 tvg-id="bbc.uk",BBC One Low
http://example.com/low.m3u8`);

  const ids = channels.map((c) => c.id);
  assert.equal(new Set(ids).size, 3);
  // The first keeps the bare id, so anything already saved under it goes on meaning what it
  // meant before. Only the later claimants are moved out of the way.
  assert.equal(ids[0], "bbc.uk");
});

test("channels with no tvg-id at all are still distinct", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1,One
http://example.com/1.m3u8
#EXTINF:-1,Two
http://example.com/2.m3u8`);
  assert.equal(new Set(channels.map((c) => c.id)).size, 2);
});

test("a playlist that repeats the same url twice still gets two ids", () => {
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1,Same
http://example.com/x.m3u8
#EXTINF:-1,Same again
http://example.com/x.m3u8`);
  assert.equal(new Set(channels.map((c) => c.id)).size, 2);
});

test("a channel walked from is not the one walked back to", () => {
  // The shape of the original fault, stated as behaviour: with a shared id, stepping
  // forward from the second of a pair landed on the one after the first.
  const channels = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="dup",A
http://example.com/a.m3u8
#EXTINF:-1 tvg-id="dup",B
http://example.com/b.m3u8
#EXTINF:-1 tvg-id="c",C
http://example.com/c.m3u8`);
  const at = channels.findIndex((c) => c.id === channels[1].id);
  assert.equal(at, 1);
});

test("a quoted attribute value may contain commas without ending the attributes", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id="101tvAntequera.es@SD" tvg-logo="http://example.com/antequera.png" http-user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" group-title="General",101tv Antequera (720p) [Geo-blocked]
http://example.com/antequera.m3u8`);
  assert.equal(c.id, "101tvAntequera.es@SD");
  assert.equal(c.name, "101tv Antequera (720p) [Geo-blocked]");
  assert.equal(c.group, "General");
  assert.equal(c.categoryKey, "General");
  assert.equal(c.logo, "http://example.com/antequera.png");
});

test("single quoted attribute values may contain commas and double quotes", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-id='quoted.tv' http-user-agent='Agent "quoted", Next' group-title='News, "World"',Kid's News, Sport
http://example.com/quoted.m3u8`);
  assert.equal(c.id, "quoted.tv");
  assert.equal(c.group, 'News, "World"');
  assert.equal(c.name, "Kid's News, Sport");
});

test("an apostrophe inside a double quoted value does not close it", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 group-title="Children's, Family",Kid's News, Sport
http://example.com/kids.m3u8`);
  assert.equal(c.group, "Children's, Family");
  assert.equal(c.name, "Kid's News, Sport");
});

test("a line with no title comma still reads quoted commas as values", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 tvg-name="News, Sport" group-title="General"
http://example.com/news.m3u8`);
  assert.equal(c.name, "News, Sport");
  assert.equal(c.group, "General");
  assert.equal(c.categoryKey, "General");
});

test("an apostrophe in unquoted metadata does not open a quoted value", () => {
  const [c] = parseM3U(`#EXTM3U
#EXTINF:-1 http-user-agent=Kid'sBrowser group-title="General",A
http://example.com/a.m3u8`);
  assert.equal(c.name, "A");
  assert.equal(c.group, "General");
});
