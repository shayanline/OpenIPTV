/**
 * Whether an address is worth trying to load a playlist from.
 *
 * Nothing here talks to the network. The point is to catch the mistakes that are obvious
 * before a request is made, so the viewer gets an answer immediately rather than waiting out
 * a timeout to be told something that could have been said at once. Anything that might
 * plausibly work is allowed through and left to fail honestly if it does not: this rejects
 * what cannot possibly be a playlist, not what is unlikely to be one.
 */
export interface UrlCheck {
  ok: boolean;
  /** What is wrong, in the viewer's terms. Empty when nothing is. */
  problem: string;
}

const OK: UrlCheck = { ok: true, problem: "" };
const no = (problem: string): UrlCheck => ({ ok: false, problem });

export function checkPlaylistUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return no("Enter the address of a playlist.");

  // A bare hostname is the commonest slip, and it is worth naming the fix rather than just
  // calling the whole thing invalid.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return no("Start the address with http:// or https://");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return no("That is not a complete web address.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return no("Only http and https addresses can be loaded.");
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    return no("The address is missing a domain, such as example.com.");
  }
  if (/\s/.test(value)) return no("Addresses cannot contain spaces.");

  return OK;
}

/** A name for a playlist that has not been given one, taken from where it comes from. */
export function nameFromUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const file = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const stem = file.replace(/\.(m3u8?|txt)$/i, "").replace(/[-_]+/g, " ").trim();
    return stem || url.hostname.replace(/^www\./, "");
  } catch {
    return "Untitled";
  }
}
