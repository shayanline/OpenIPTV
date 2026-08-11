import type { Channel } from "../types";

/**
 * Parse an extended M3U playlist.
 *
 * Written against the shape iptv-iran emits, but kept tolerant, because playlists in the
 * wild break the format in predictable ways:
 *
 *  - the title runs to end of line and may itself contain commas, so only the first comma
 *    after #EXTINF separates attributes from the title
 *  - attribute values may be single or double quoted
 *  - #EXTGRP and player directives such as #EXTVLCOPT sit between the #EXTINF and the url
 *  - a tag written without its leading '#' should be ignored rather than read as a url,
 *    which is a real defect seen on Telewebion's masters
 */
const ATTRS = /([a-zA-Z0-9-]+)=("([^"]*)"|'([^']*)')/g;
const KNOWN_TAG = /^(EXT|#)/i;

export function parseM3U(text: string): Channel[] {
  const channels: Channel[] = [];
  const lines = text.split(/\r?\n/);
  let pending: Partial<Channel> | null = null;
  let group = "";

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
      while ((m = ATTRS.exec(attrText)) !== null) {
        attrs[m[1].toLowerCase()] = m[3] ?? m[4] ?? "";
      }
      pending = {
        id: attrs["tvg-id"] || "",
        name: attrs["tvg-name"] || title || "Unnamed",
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || "",
        language: attrs["tvg-language"] || "",
        quality: attrs["tvg-quality"] || "",
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
        id: pending.id || `url:${line}`,
        name: pending.name || "Unnamed",
        logo: pending.logo || "",
        group: pending.group || group || "Uncategorised",
        url: line,
        language: pending.language || "",
        quality: pending.quality || "",
        number: channels.length + 1,
      });
      pending = null;
    }
  }
  return channels;
}

export function groupByCategory(channels: Channel[]) {
  const order: string[] = [];
  const map = new Map<string, Channel[]>();
  for (const c of channels) {
    if (!map.has(c.group)) {
      map.set(c.group, []);
      order.push(c.group);
    }
    map.get(c.group)!.push(c);
  }
  return order.map((name) => ({ name, channels: map.get(name)! }));
}
