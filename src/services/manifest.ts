/**
 * Reading and repairing an HLS media playlist, for the one defect this television cannot survive.
 *
 * AVPlay keeps EXT-X-MEDIA-SEQUENCE in a signed 32 bit integer. Some packagers derive that field
 * from a microsecond clock, so it arrives with sixteen digits, and the set then plays one segment
 * and reports the entire live stream as 2000ms. Measured on a 2025 model, one property changed at
 * a time: 2,147,483,000 plays, 2,147,484,000 does not, and 4,294,966,000 does not either, so the
 * field is signed rather than unsigned. The size of the playlist has nothing to do with it: 3600
 * segments and 813KB played perfectly well with a small sequence.
 *
 * Everything here is a pure function over text, which is why it lives outside the player and the
 * worker: it is the part that can be tested without a television.
 */

/** The largest value AVPlay can hold. Anything above it overflows the set's parser. */
export const SEQUENCE_CEILING = 2_147_483_647;

/** The shortest initial buffer that gives the common five second streams a full segment. */
export const DEFAULT_INITIAL_BUFFER_SECONDS = 6;

/**
 * Leave one second beyond the longest segment, while keeping the measured default for shorter
 * streams.
 */
export const initialBufferSeconds = (longestSegment: number): number =>
  Math.max(DEFAULT_INITIAL_BUFFER_SECONDS, Math.ceil(longestSegment) + 1);

/**
 * How much of the window to publish, in seconds.
 *
 * Long enough that a player which starts three target durations behind the live edge still has
 * room in front of it, short enough that the response stays small. Window length costs bytes and
 * nothing else: it is not what the player's reload rate depends on.
 */
const WINDOW_SECONDS = 150;

/**
 * What to declare as the target duration, which is deliberately not the real segment length.
 *
 * This is the one field written here that differs from the truth on purpose, and it took the
 * television to explain why. A player starts roughly three target durations from the end of a live
 * window, so declaring the honest 2 seconds started AVPlay 6 seconds from the live edge, where it
 * then waited for data that only arrives as fast as real time: measured on the set, twelve seconds
 * pinned at the same playhead with the buffer reading 97%, which is long enough that the app's own
 * stall watchdog declared the picture frozen before it had begun. Declaring 20 starts it a minute
 * back, inside content this window already holds, and it plays immediately.
 *
 * The field is an upper bound on segment duration rather than a promise about it, and the only
 * other thing it controls is how often the player comes back: AVPlay returns at about half of what
 * is declared, measured at 6.4s for 12 and 9.1s for 20. That costs nothing when the server it is
 * asking is on the same device.
 */
const DECLARED_TARGET = 20;

export interface Playlist {
  /** The media sequence the upstream declared, or null when it declared none. */
  sequence: number | null;
  /** How many segments it listed. */
  segments: number;
  /** How many variants it listed, which is non-zero only for a master playlist. */
  variants: number;
  /** The longest segment duration seen, in seconds, or 0 when none was readable. */
  longest: number;
}

/**
 * What a playlist says about itself, in one pass.
 *
 * Tolerant on purpose, like the parser in services/m3u: these files come from strangers. A line
 * this does not understand is a line it ignores, and every field has an answer for the case
 * where the playlist never mentioned it.
 */
export function readPlaylist(text: string): Playlist {
  let sequence: number | null = null;
  let segments = 0;
  let variants = 0;
  let longest = 0;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("#")) continue;
    if (line.startsWith("#EXTINF:")) {
      segments += 1;
      const seconds = Number.parseFloat(line.slice(8));
      if (Number.isFinite(seconds) && seconds > longest) longest = seconds;
    } else if (line.startsWith("#EXT-X-STREAM-INF")) {
      variants += 1;
    } else if (sequence === null && line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
      const value = Number(line.slice(22).trim());
      if (Number.isFinite(value)) sequence = value;
    }
  }
  return { sequence, segments, variants, longest };
}

/**
 * Whether this television will fail on this playlist, and only for the reason we can repair.
 *
 * Deliberately narrow. A channel that is simply off the air, or sending a codec the set lacks,
 * must not be routed through a repair that cannot help it: the viewer would then wait twice and
 * be told nothing useful. So this answers yes for exactly one thing, and the rest of the app
 * treats a no as "the fault was something else".
 */
export function needsRepair(text: string): boolean {
  const { sequence, segments } = readPlaylist(text);
  return sequence !== null && segments > 0 && sequence > SEQUENCE_CEILING;
}

/** One segment, ready to be written out. */
export interface Segment {
  /** The EXTINF line, without the title the packager wrote after the comma. */
  duration: string;
  /** Where to fetch it, always absolute. */
  uri: string;
}

export interface Window {
  segments: Segment[];
  /** What to declare as the target duration. */
  target: number;
}

/**
 * The tail of a playlist, as segments the player can be given.
 *
 * Trimmed to the tail not because size is the problem, which it is not, but because this runs on
 * the television: a shorter list is fewer bytes to copy into the module on every refresh, and
 * nobody watching live television needs two hours of history.
 *
 * Addresses are made absolute, because a repaired manifest can be served from another origin.
 * They are resolved against the address the playlist actually came from, which is not always the
 * one that was asked for: a redirect is normal, and some hosts serve playlists from one machine
 * and segments from another.
 */
export function windowOf(text: string, from: string): Window {
  const lines = text.split("\n");
  const { longest } = readPlaylist(text);

  const segments: Segment[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith("#EXTINF")) continue;
    const uri = (lines[i + 1] ?? "").trim();
    if (!uri || uri.startsWith("#")) continue;
    // The title after the comma is dropped: nothing reads it, and on these streams it is another
    // sixteen digit number for a parser to trip over.
    segments.push({ duration: `${lines[i].split(",")[0]},`, uri: absolute(uri, from) });
  }

  const each = longest || 2;
  const keep = Math.min(segments.length, Math.max(3, Math.ceil(WINDOW_SECONDS / each)));
  return {
    segments: segments.slice(-keep),
    // Never below the real longest segment, which is the one thing the field must not understate.
    target: Math.max(DECLARED_TARGET, Math.ceil(each)),
  };
}

/**
 * A window written out as a playlist, numbered from `sequence`.
 *
 * The number belongs to the caller rather than to the upstream, and that is the whole point.
 * These streams number their segments from a microsecond clock, so the upstream's own field
 * advances by about two million per segment: anything derived from it by arithmetic, a modulus or
 * a subtraction from a fixed base, still jumps by millions between one refresh and the next. The
 * player answers a jump like that by resetting to the live edge, which is a stutter every few
 * seconds and a playhead running at five times real time.
 *
 * So the caller counts segments instead, and this writes down what it is told. HLS asks only that
 * the sequence advance by exactly one per segment, and counting is the only way to promise that
 * when the source is a clock.
 */
export function renderPlaylist(window: Window, sequence: number): string {
  const out = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${window.target}`,
    `#EXT-X-MEDIA-SEQUENCE:${Math.max(0, sequence)}`,
  ];
  for (const { duration, uri } of window.segments) {
    out.push(duration);
    out.push(uri);
  }
  return `${out.join("\n")}\n`;
}

/**
 * Resolve a segment address against where its playlist came from.
 *
 * Hand rolled rather than `new URL(uri, from)` because the fallback matters: an address this
 * cannot resolve is passed through untouched, so a playlist with one odd line still plays. URL
 * throws instead, which would lose the whole channel over a single segment.
 */
function absolute(uri: string, from: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return uri;
  try {
    return new URL(uri, from).href;
  } catch {
    return uri;
  }
}
