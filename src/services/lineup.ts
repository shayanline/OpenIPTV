import type { Channel } from "../types";

/**
 * How the channel lists are built, and how channel up and down move through one.
 *
 * Both are arithmetic over lists, both were wrong in ways nothing on screen announced, and
 * both are pure, which is why they are here rather than inside a component: a mistake in
 * either shows up as the interface quietly going somewhere the viewer did not ask to go.
 */

export const FAVOURITES = "Favourites";

/**
 * Move an index by one and come out the other side.
 *
 * Samsung's input guidance says the opposite: "Focus does not loop in a list. Thus, focus stops
 * moving when it reaches the first or last item in a list." That holds for focus, and it is what
 * the panel and the buttons do. Channel up is not focus: it wraps, on this app and on every
 * television ever made, and the channel keys and the arrows share one list, so stopping dead at
 * the end while the keys came round would be two ways of reaching the same channel disagreeing
 * about what happens at the end.
 */
export const wrap = (index: number, length: number) =>
  length < 1 ? 0 : ((index % length) + length) % length;

/**
 * Where the cursor in the channel column lands, with or without a search field above the rows.
 *
 * The field is index -1, so a searched column is a ring of `count + 1` places and a category is a
 * ring of `count`. Expressed by shifting the whole thing up by one before wrapping and back down
 * afterwards, which is the only way to wrap a range that starts below zero without a special case
 * at each end. The special cases are what this replaces: they had the field reachable by pressing
 * up from the first row and unreachable from the last, so a viewer at the bottom of a long list
 * of results had to walk back up through all of them to change what they had typed.
 *
 * Wrapping at all, rather than stopping, because the rows below it wrap: the column is one list
 * to walk whether or not a keyboard is sitting on top of it.
 */
export function stepColumn(index: number, delta: number, count: number, withField: boolean) {
  if (!withField) return wrap(index + delta, count);
  return wrap(index + 1 + delta, count + 1) - 1;
}

export interface ChannelList {
  name: string;
  channels: Channel[];
}

/**
 * The playlist's own categories, with Favourites first while there is something in it.
 *
 * An empty row is a row that says nothing, and a rail that opens with one is a rail whose
 * first line is an apology. So it appears with the first favourite and goes with the last.
 *
 * That costs something, and the cost is paid in App: inserting a list at position zero moves
 * every category down by one, and a viewer who pressed the green key asked to favourite a
 * channel, not to be taken somewhere else. The green key is the only thing that can add or
 * remove this row, so it is the one place that corrects for it.
 */
export function listsOf(
  channels: Channel[],
  categories: ChannelList[],
  favourites: string[],
): ChannelList[] {
  const wanted = new Set(favourites);
  const mine = channels.filter((c) => wanted.has(c.id));
  if (!mine.length) return categories;
  return [{ name: FAVOURITES, channels: mine }, ...categories];
}

/**
 * Where channel up or down lands, given the channel playing now.
 *
 * It wraps, which Samsung's input guidance does not ask for in a list. That is deliberate:
 * channel up wraps on every television ever made, and the channel keys and this share one
 * list, so stopping dead at the end while the keys came round would be two ways of reaching
 * the same channel disagreeing about what happens at the end.
 *
 * Returns -1 when there is nowhere to go at all.
 *
 * The awkward case is a playing channel that is not in this list, which happens whenever the
 * viewer has changed category without choosing anything. Up should then land on the first
 * row and down on the last. The arithmetic used to treat "not found" as position zero, so up
 * went to the second channel and skipped the first.
 */
export function nextChannel(list: Channel[], playingId: string, delta: number): number {
  if (!list.length) return -1;
  const at = list.findIndex((c) => c.id === playingId);
  const from = at === -1 ? (delta > 0 ? -1 : 0) : at;
  return wrap(from + delta, list.length);
}
