import { test } from "vitest";
import assert from "node:assert/strict";
import {
  SEQUENCE_CEILING, needsRepair, readPlaylist, renderPlaylist, windowOf,
} from "../src/services/manifest";

/** What the service does with a window: render it, numbered from where the caller has counted to. */
const repaired = (text: string, from: string, sequence = 0) =>
  renderPlaylist(windowOf(text, from), sequence);

/**
 * The one defect this application repairs, and the arithmetic that repairs it.
 *
 * The boundary here is not a guess. Measured on a 2025 set by serving it manifests that differed
 * in one property: a sequence of 2,147,483,000 played and reported its window correctly,
 * 2,147,484,000 reported the whole live stream as 2000ms, and 4,294,966,000 failed the same way,
 * which is what says the field is signed rather than unsigned. 3600 segments and 813KB played
 * perfectly well with a small sequence, so size is not part of it.
 */

const playlist = (sequence: string, segments = 3) => {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:2",
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`];
  for (let i = 0; i < segments; i += 1) {
    lines.push("#EXTINF:2.000000,");
    lines.push(`segment-${i}.ts`);
  }
  return `${lines.join("\n")}\n`;
};

test("a sequence the set can hold needs no repair", () => {
  assert.equal(needsRepair(playlist(String(SEQUENCE_CEILING))), false);
});

test("a sequence one above the ceiling needs repair", () => {
  assert.equal(needsRepair(playlist(String(SEQUENCE_CEILING + 1))), true);
});

test("telewebion's sixteen digit sequence needs repair", () => {
  assert.equal(needsRepair(playlist("1786136377905810")), true);
});

test("a playlist with no segments is not something to repair", () => {
  // A master playlist, which lists variants rather than segments. Repairing it would hand the
  // player a window with nothing in it, which is worse than the failure it replaced.
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n720p/index.m3u8\n";
  assert.equal(needsRepair(master), false);
  assert.equal(readPlaylist(master).variants, 1);
});

test("a playlist that never declared a sequence is left alone", () => {
  assert.equal(needsRepair("#EXTM3U\n#EXTINF:2.0,\na.ts\n"), false);
});

test("reading reports what the playlist says about itself", () => {
  const read = readPlaylist(playlist("1786136377905810", 5));
  assert.equal(read.sequence, 1786136377905810);
  assert.equal(read.segments, 5);
  assert.equal(read.longest, 2);
  assert.equal(read.variants, 0);
});

test("repairing brings the sequence inside what the set can hold", () => {
  const fixed = repaired(playlist("1786136377905810"), "https://host.example/live/index.m3u8");
  const sequence = readPlaylist(fixed).sequence;
  assert.ok(sequence !== null && sequence <= SEQUENCE_CEILING, `sequence was ${sequence}`);
  assert.equal(needsRepair(fixed), false, "the repaired playlist still needs repair");
});

test("the number written out is the one the caller counted, not one derived from the upstream", () => {
  /*
   * This is the bug that reached the television. Renumbering by subtracting a fixed base looks
   * right until you notice that these streams number segments from a microsecond clock, so the
   * upstream field advances by about two million per segment: every refresh then republished a
   * window whose sequence had jumped by millions, the player reset to the live edge each time, and
   * the picture rebuffered every few seconds with the playhead running at five times real time.
   * Counting segments is the only thing that keeps the promise HLS makes, one per segment.
   */
  const clock = 1786136377905810;
  assert.equal(readPlaylist(repaired(playlist(String(clock)), "https://h/x.m3u8", 0)).sequence, 0);
  // Six seconds later the clock has moved six million, and the number served has moved by three.
  const later = repaired(playlist(String(clock + 6_000_000)), "https://h/x.m3u8", 3);
  assert.equal(readPlaylist(later).sequence, 3);
});

test("segment addresses are made absolute against where the playlist came from", () => {
  const fixed = repaired(playlist("9007199254740991"), "https://host.example/live/index.m3u8");
  assert.match(fixed, /^https:\/\/host\.example\/live\/segment-0\.ts$/m);
});

test("addresses that are already absolute, or on another host, are untouched", () => {
  const text = ["#EXTM3U", "#EXT-X-MEDIA-SEQUENCE:1786136377905810", "#EXTINF:2.0,",
    "https://elsewhere.example/a.ts", ""].join("\n");
  const fixed = repaired(text, "https://host.example/live/index.m3u8");
  assert.match(fixed, /https:\/\/elsewhere\.example\/a\.ts/);
});

test("the window is trimmed to its tail, keeping the newest segments", () => {
  // 150 seconds of two second segments is 75, so a longer window is cut and the end is what stays:
  // the end is where live television is.
  const fixed = repaired(playlist("1786136377905810", 200), "https://h/x.m3u8");
  const read = readPlaylist(fixed);
  assert.equal(read.segments, 75);
  assert.match(fixed, /segment-199\.ts/, "the newest segment was dropped");
  assert.ok(!fixed.includes("segment-0.ts"), "the oldest segment was kept");
});

test("a short window is published whole rather than padded", () => {
  const fixed = repaired(playlist("1786136377905810", 4), "https://h/x.m3u8");
  assert.equal(readPlaylist(fixed).segments, 4);
});

test("the declared target duration is inflated, because it chooses where the player starts", () => {
  /*
   * A player starts about three target durations from the end of a live window, so the honest 2
   * seconds parked AVPlay 6 seconds from the live edge and it waited there for data arriving at
   * real time: twelve seconds on the set with the buffer at 97%, long enough that the app declared
   * the picture frozen before it began. Twenty starts it a minute back, inside content the window
   * already holds.
   */
  assert.match(repaired(playlist("1786136377905810"), "https://h/x.m3u8"),
    /#EXT-X-TARGETDURATION:20/);
});

test("the declared target is never lower than the longest segment", () => {
  // The one thing this field must not do is understate a segment, so a stream of half minute
  // segments raises it rather than keeping the default.
  const text = playlist("1786136377905810").replace(/#EXTINF:2.000000,/g, "#EXTINF:30.000000,");
  assert.match(repaired(text, "https://h/x.m3u8"), /#EXT-X-TARGETDURATION:30/);
});

test("the sixteen digit titles the packager writes into EXTINF are dropped", () => {
  // Another oversized integer per segment, read by nothing, and one more thing for a parser that
  // has already been defeated by one number to trip over.
  const text = playlist("1786136377905810").replace(/#EXTINF:2.000000,/g, "#EXTINF:2.000000,1786136377905810");
  const fixed = repaired(text, "https://h/x.m3u8");
  assert.ok(!fixed.includes("2.000000,1786136377905810"), "a segment title survived");
});
