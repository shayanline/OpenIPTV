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

export interface ChannelList {
  name: string;
  channels: Channel[];
}

/**
 * The playlist's own categories, with Favourites always first.
 *
 * Always, including when it is empty. Appearing only once something is in it would make the
 * green key insert a list at position zero and shift every category index by one: the
 * highlight would stay where it was, which is now Favourites, so favouriting a channel would
 * silently move the viewer out of the category they were reading, and removing the last
 * favourite would throw them back. A row that is always present cannot shift anything, and
 * it answers the question an absent one raises, which is where a favourite goes.
 */
export function listsOf(
  channels: Channel[],
  categories: ChannelList[],
  favourites: string[],
): ChannelList[] {
  const wanted = new Set(favourites);
  return [
    { name: FAVOURITES, channels: channels.filter((c) => wanted.has(c.id)) },
    ...categories,
  ];
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
