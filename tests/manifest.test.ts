import { test } from "vitest";
import assert from "node:assert/strict";
import {
  SEQUENCE_CEILING,
  needsRepair,
  readPlaylist,
  renderPlaylist,
  windowOf,
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
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:2",
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
  ];
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

test("reading keeps the longest valid media segment duration", () => {
  const text = [
    "#EXTM3U",
    "#EXTINF:2.5,",
    "a.ts",
    "#EXTINF:not-a-number,",
    "b.ts",
    "#EXTINF:7.25,",
    "c.ts",
    "",
  ].join("\n");

  assert.equal(readPlaylist(text).longest, 7.25);
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
  assert.equal(
    readPlaylist(repaired(playlist(String(clock)), "https://h/x.m3u8", 0)).sequence,
    0,
  );
  // Six seconds later the clock has moved six million, and the number served has moved by three.
  const later = repaired(playlist(String(clock + 6_000_000)), "https://h/x.m3u8", 3);
  assert.equal(readPlaylist(later).sequence, 3);
});

test("segment addresses are made absolute against where the playlist came from", () => {
  const fixed = repaired(playlist("9007199254740991"), "https://host.example/live/index.m3u8");
  assert.match(fixed, /^https:\/\/host\.example\/live\/segment-0\.ts$/m);
});

test("addresses that are already absolute, or on another host, are untouched", () => {
  const text = [
    "#EXTM3U",
    "#EXT-X-MEDIA-SEQUENCE:1786136377905810",
    "#EXTINF:2.0,",
    "https://elsewhere.example/a.ts",
    "",
  ].join("\n");
  const fixed = repaired(text, "https://host.example/live/index.m3u8");
  assert.match(fixed, /https:\/\/elsewhere\.example\/a\.ts/);
});

test("repair preserves the complete provider window for Live seeking", () => {
  const fixed = repaired(playlist("1786136377905810", 600), "https://h/x.m3u8");
  const read = readPlaylist(fixed);
  assert.equal(read.segments, 600);
  assert.match(fixed, /segment-599\.ts/);
  assert.match(fixed, /segment-0\.ts/);
});

test("repair retains track metadata, initialization, encryption and segment tags", () => {
  const source = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-MEDIA-SEQUENCE:1786136377905810",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="../audio/en.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="../subs/en.m3u8"',
    '#EXT-X-KEY:METHOD=AES-128,URI="../key",IV=0x00000000000000000000000000000001',
    '#EXT-X-MAP:URI="init.mp4"',
    "#EXT-X-DISCONTINUITY-SEQUENCE:2",
    "#EXT-X-DISCONTINUITY",
    "#EXT-X-PROGRAM-DATE-TIME:2026-11-27T12:00:00Z",
    "#EXTINF:6,",
    "#EXT-X-BYTERANGE:1000@0",
    "media.mp4",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const window = windowOf(source, "https://host.example/live/index.m3u8");
  const fixed = renderPlaylist(window, 10);
  assert.equal(window.segments.length, 1);
  assert.match(fixed, /#EXT-X-MEDIA-SEQUENCE:10\n/);
  assert.match(fixed, /#EXT-X-VERSION:7/);
  assert.match(fixed, /TYPE=AUDIO.*URI="https:\/\/host.example\/audio\/en.m3u8"/);
  assert.match(fixed, /TYPE=SUBTITLES.*URI="https:\/\/host.example\/subs\/en.m3u8"/);
  assert.match(fixed, /#EXT-X-KEY:METHOD=AES-128,URI="https:\/\/host.example\/key",IV=/);
  assert.match(fixed, /#EXT-X-MAP:URI="https:\/\/host.example\/live\/init.mp4"/);
  assert.match(fixed, /#EXT-X-DISCONTINUITY-SEQUENCE:2\n#EXT-X-DISCONTINUITY\n/);
  assert.match(fixed, /#EXT-X-PROGRAM-DATE-TIME:2026-11-27T12:00:00Z/);
  assert.match(fixed, /#EXT-X-BYTERANGE:1000@0\nhttps:\/\/host.example\/live\/media.mp4/);
  assert.match(fixed, /#EXT-X-ENDLIST\n$/);
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
  assert.match(
    repaired(playlist("1786136377905810"), "https://h/x.m3u8"),
    /#EXT-X-TARGETDURATION:20/,
  );
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
  const text = playlist("1786136377905810").replace(
    /#EXTINF:2.000000,/g,
    "#EXTINF:2.000000,1786136377905810",
  );
  const fixed = repaired(text, "https://h/x.m3u8");
  assert.ok(!fixed.includes("2.000000,1786136377905810"), "a segment title survived");
});
