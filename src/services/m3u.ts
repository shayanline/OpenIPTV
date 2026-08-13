import type { Channel } from "../types";

/**
 * Parse an extended M3U playlist.
 *
 * There is no standard for extended M3U, only a convention, so the parser is deliberately
 * tolerant of the ways real playlists bend it:
 *
 *  - the title runs to end of line and may itself contain commas, so only the first comma
 *    after #EXTINF separates attributes from the title
 *  - attribute values may be single or double quoted
 *  - #EXTGRP and player directives such as #EXTVLCOPT sit between the #EXTINF and the url
 *  - a tag written without its leading '#' should be ignored rather than read as a url
 *
 * Nothing here interprets the content of a name or a group. Whatever the playlist says is
 * what the viewer sees, in whatever language it was written in.
 */
const ATTRS = /([a-zA-Z0-9-]+)=("([^"]*)"|'([^']*)')/g;
const KNOWN_TAG = /^(EXT|#)/i;
export const UNCATEGORISED = "Uncategorised";

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let pending: Partial<Channel> | null = null;
  let group = "";
  /**
   * Every id handed out so far, because the whole application assumes they are unique.
   *
   * tvg-id is not an identifier, whatever its name suggests. It names the *channel* in an
   * electronic programme guide, so a playlist carrying BBC One at three bitrates gives all
   * three the same one, and plenty of playlists repeat it out of simple carelessness.
   *
   * Everything downstream looks a channel up by id: favourites are a list of them, the
   * playing marker compares against one, and channel up and down find their place with
   * findIndex. With duplicates, favouriting one channel favourites its twin, the marker
   * appears on two rows at once, and channel up from the second of the pair jumps back to
   * the one after the first, so a viewer walking down the list gets stuck in a loop of two.
   *
   * So the first claimant keeps the bare id and the rest are suffixed. The first is left
   * untouched on purpose: an id already saved in someone's favourites goes on meaning what
   * it meant before this was fixed.
   */
  const taken = new Set<string>();
  const unique = (id: string) => {
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    let n = 2;
    while (taken.has(`${id}#${n}`)) n += 1;
    const fresh = `${id}#${n}`;
    taken.add(fresh);
    return fresh;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const attrText = comma === -1 ? line : line.slice(0, comma);
      const title = comma === -1 ? "" : line.slice(comma + 1).trim();

      const attrs: Record<string, string> = {};
      ATTRS.lastIndex = 0;
      let m: RegExpExecArray | null;
      /* String.matchAll would read better and cannot be used: it is ES2020, and Chromium 69
         does not have it. The lib setting in tsconfig catches that, which is what it is for.
         biome-ignore lint/suspicious/noAssignInExpressions: the assignment is the loop
         condition, which is how RegExp.exec is iterated without matchAll. */
      while ((m = ATTRS.exec(attrText)) !== null) {
        attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
      }
      pending = {
        id: attrs["tvg-id"] || "",
        name: attrs["tvg-name"] || title || "Unnamed",
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || "",
        /*
         * A badge, so it is held to the length of a badge.
         *
         * There is no standard for this attribute and nothing stops a playlist putting a
         * sentence in it. Drawn unbounded beside a channel name, one playlist's idea of a
         * quality label pushed everything else off the row. Anything longer than a few
         * characters is not a quality, so it is not treated as one.
         */
        quality: (attrs["tvg-quality"] || "").trim().slice(0, 6),
      };
      // Prefer the on screen title, since it is the bilingual one.
      if (title) pending.name = title;
      continue;
    }

    if (line.startsWith("#EXTGRP:")) {
      group = line.slice(8).trim();
      continue;
    }
    // Any other directive, and any tag someone forgot the '#' on, is not a url.
    if (line.startsWith("#") || KNOWN_TAG.test(line)) continue;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(line)) continue;

    if (pending) {
      channels.push({
        id: unique(pending.id || `url:${line}`),
        name: pending.name || "Unnamed",
        logo: pending.logo || "",
        group: pending.group || group || UNCATEGORISED,
        url: line,
        quality: pending.quality || "",
        number: channels.length + 1,
      });
      pending = null;
    }
  }
  return channels;
}

/**
 * Group channels by their group-title, in the order the playlist introduces them.
 *
 * Grouping is on the exact string. Two spellings of a group stay two groups, because
 * deciding that they mean the same thing would mean guessing at a naming convention, and
 * every playlist has a different one.
 */
export function groupByCategory(channels: Channel[]) {
  const order: string[] = [];
  const map = new Map<string, Channel[]>();

  for (const c of channels) {
    const group = c.group || UNCATEGORISED;
    if (!map.has(group)) {
      map.set(group, []);
      order.push(group);
    }
    map.get(group)!.push(c);
  }

  return order.map((name) => ({ name, channels: map.get(name)! }));
}
