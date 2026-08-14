import type { Channel } from "../types";

/**
 * Finding a channel by name, in a playlist that may hold twelve thousand of them.
 *
 * The name only. Groups are not searched, and that is a decision rather than an omission: a
 * query answers with the channels whose names contain it, so a list of results always looks
 * like the thing that was typed. Matching the group as well doubles the answers to "news" with
 * channels that have nothing to do with news except the company they were filed under, and a
 * viewer cannot see why a row is in the list.
 *
 * Nothing here is clever about language, deliberately. The names come from whatever playlist
 * somebody added, in whatever scripts they chose, and the two useful things to do with a
 * bilingual name are to search both halves of it and to leave it alone otherwise.
 */

/**
 * How many results are kept.
 *
 * Not a limit on the DOM, which is bounded anyway: the channel column only ever builds the rows
 * that are in view. This bounds the work of finding and ranking them, which is paid on every
 * keystroke, and it reflects what anybody does with a result list. One letter matches thousands
 * of channels in a real playlist and nobody walks to row four hundred; they type another letter.
 *
 * The total is reported separately so the interface can say the answer is longer than the list,
 * which is the honest thing to do about a cap.
 */
export const SEARCH_LIMIT = 300;

export interface Results {
  /** Ranked, and no longer than SEARCH_LIMIT. */
  matches: Channel[];
  /** How many matched in total, which may be more than were kept. */
  total: number;
}

/**
 * The lowercase names, once per playlist rather than once per keystroke.
 *
 * `name.toLowerCase()` allocates a string, and doing it inside the loop means twelve thousand
 * allocations for every letter typed, on a set whose whole application budget is 120MB and whose
 * main thread is the only one doing anything. Folded once, held against the array the names came
 * from, and thrown away with it.
 *
 * A WeakMap keyed on the channels array, because that array is already the identity of "this
 * playlist as it currently is": the store replaces it when a playlist is loaded, refreshed or
 * sorted, and a new array is exactly when these need folding again. Keying on anything else, a
 * URL or a length, is how a search comes to answer from the previous playlist's names.
 */
const folded = new WeakMap<readonly Channel[], string[]>();

function foldedNames(channels: readonly Channel[]): string[] {
  let names = folded.get(channels);
  if (!names) {
    names = channels.map((c) => c.name.toLowerCase());
    folded.set(channels, names);
  }
  return names;
}

/**
 * Channels whose names contain the query, the ones that start with it first.
 *
 * Two passes in one loop rather than a sort. A sort of every match by "does it start with the
 * query" is a comparison function called thousands of times to answer a question with two
 * possible values, and it would also have to be told how to break ties to keep playlist order.
 * Collecting into two lists does both for free, and the concatenation is the ranking.
 *
 * Starts-with first matters more than it sounds. Type "bbc" into a playlist carrying "Sky News",
 * "BBC News" and "BBC One" and playlist order alone puts Sky at the top, which reads as the
 * search ignoring what was typed.
 */
export function searchChannels(channels: readonly Channel[], query: string): Results {
  const needle = query.trim().toLowerCase();
  // An empty query matches nothing rather than everything. A viewer who has typed nothing has
  // asked for nothing, and answering with the whole playlist is the opposite of what search is.
  if (!needle) return { matches: [], total: 0 };

  const names = foldedNames(channels);
  const starts: Channel[] = [];
  const contains: Channel[] = [];
  let total = 0;

  for (let i = 0; i < channels.length; i++) {
    const at = names[i].indexOf(needle);
    if (at < 0) continue;
    total += 1;
    /*
     * Each rank is capped rather than the pair of them, which costs one more array of at most
     * three hundred and buys the ranking being true.
     *
     * Capping the total instead reads as the obvious thing and quietly loses the best results:
     * three hundred channels containing "bbc" somewhere in their names would fill the list
     * before the first channel actually called "BBC One" was reached, and the one result the
     * viewer was certainly looking for is the one thrown away. Both are bounded, so the work is
     * still bounded, and the slice below takes the best three hundred of what was kept.
     */
    const rank = at === 0 ? starts : contains;
    if (rank.length < SEARCH_LIMIT) rank.push(channels[i]);
  }

  return { matches: starts.concat(contains).slice(0, SEARCH_LIMIT), total };
}
