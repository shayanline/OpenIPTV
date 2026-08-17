import { create } from "zustand";
import type { Channel } from "../types";
import { groupByCategory, parseM3U } from "../services/m3u";
import { useSettings } from "./settings";
import { keys, read, readJSON, remove, write } from "../services/store";
import * as disk from "../services/disk";
import { whenIdle } from "../services/idle";

const FAVOURITES_KEY = "openiptv.favourites";
const LAST_KEY = "openiptv.last";

/**
 * The cached playlist, keyed by the address it came from.
 *
 * By URL, not by playlist id, and that is a fix rather than a preference. The id belongs to
 * the row in Settings and survives the address being edited, so a viewer who corrected a
 * typo in a URL had the previous playlist's channels served to them from a cache that
 * believed it was current. Nothing said so, because from the cache's point of view nothing
 * had changed.
 *
 * Keying on the address means an edit is a different entry, so the old one is never asked
 * for again and the sweep collects it. Two playlists pointing at the same address now share
 * one cached copy, which is correct and was not true before.
 *
 * The text is on disk and the timestamp stays in localStorage. They are different sizes and
 * want different things: the stamp is eight characters that decide whether to go to the
 * network at all, so having it synchronously is worth more than having it beside the text.
 */
const cacheKey = (url: string) => `playlist:${url}`;
const stampKey = (url: string) => `openiptv.at.${url}`;

/**
 * Where the playlist text used to live.
 *
 * localStorage, which Samsung caps at 5MB for the whole application, cannot hold a Blob and
 * writes synchronously on the main thread. See services/disk for why each of those matters.
 * The prefix survives only so the sweep can clear what older versions of the app wrote.
 */
const LEGACY_PREFIX = "openiptv.cache.";

/**
 * How old a cached playlist may be before it is worth going back to the network.
 *
 * A playlist is a file somebody edits occasionally, not a feed. Refetching it on every
 * launch cost the launch: a megabyte or two over the air, a second parse of the same text,
 * and a synchronous localStorage write of the whole thing, all of it between the viewer
 * pressing the button and the picture arriving, and almost always to arrive at exactly the
 * bytes already on disk.
 *
 * Six hours means a set switched on morning and evening refreshes twice a day, which is
 * more than a hand edited file needs, and every launch in between goes straight to a
 * picture. Nothing waits on this in any case: a stale cache is still shown first and the
 * refresh happens behind it. Settings has a Refresh that ignores it entirely.
 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Sorting by name, when the viewer asks for it.
 *
 * Through one Intl.Collator rather than String.prototype.localeCompare. They give the same
 * answer and they do not cost the same: localeCompare has to find or build a collator on
 * every single comparison, and a sort makes tens of thousands of them. Measured over 12,000
 * channel names, 19.3ms against 1.4ms, so about 115ms against 8ms once the floor set's
 * slower core is accounted for. It is the same one line either way.
 *
 * Numeric ordering, because these are channel names. Without it "Sport 10" sorts before
 * "Sport 2", which is the sort being alphabetical at the viewer rather than for them.
 *
 * Built on first use and then kept, since a viewer who never turns the setting on should
 * not pay for the collator at launch.
 */
let collator: Intl.Collator | null = null;
const byName = (a: Channel, b: Channel) => {
  if (!collator) collator = new Intl.Collator("en", { numeric: true });
  return collator.compare(a.name, b.name);
};



/** What a load attempt produced, so the caller can say so without re-reading the store. */
export interface LoadResult {
  count: number;
  /** Empty when it worked. */
  error: string;
}

interface State {
  channels: Channel[];
  categories: { name: string; channels: Channel[] }[];
  favourites: string[];
  loading: boolean;
  error: string;
  /**
   * Fetch the active playlist. Reports what happened, because a caller that has just asked
   * for a refresh has to be able to say whether it worked, and reading the store back
   * afterwards races the state it is trying to read.
   */
  load: (force?: boolean) => Promise<LoadResult>;
  /** Drop cached playlists nothing is configured to watch. Run once, at launch. */
  sweep: () => Promise<void>;
  toggleFavourite: (id: string) => void;
  rememberLast: (id: string) => void;
  lastPlayed: () => string;
  /** Forget the favourites and the last played channel, for "reset everything". */
  clearPersonal: () => void;
}

/**
 * The fetch in flight, so a later request can call off an earlier one.
 *
 * Switching playlist twice quickly used to leave two requests running and let whichever
 * answered last win, which on a slow connection is the one you asked for first. Outside the
 * store because it is machinery rather than state: nothing renders from it.
 */
let inFlight: AbortController | null = null;

/**
 * The background refresh that has been scheduled but not started.
 *
 * Called off whenever a load is asked for, because it belongs to the playlist that was
 * active when it was queued. Switching playlist and then having the old one quietly arrive
 * a few seconds later and overwrite the screen is exactly the race inFlight exists to
 * prevent, moved to a place inFlight cannot see.
 */
let cancelPending: (() => void) | null = null;

export const useChannels = create<State>((set, get) => {
  const parse = (text: string) => {
    let channels = parseM3U(text);
    if (useSettings.getState().sortAlphabetically) channels = [...channels].sort(byName);
    return { channels, categories: groupByCategory(channels) };
  };

  /**
   * Go and get the playlist.
   *
   * `known` is the text already on screen, when there is one, and it earns its place twice.
   * A playlist that has not changed since it was cached is the ordinary case, and comparing
   * the two strings is far cheaper than what it avoids: parsing a second copy of the same
   * megabyte, and writing that megabyte back to the set's flash.
   */
  const refresh = async (url: string, known: string): Promise<LoadResult> => {
    inFlight?.abort();
    const attempt = new AbortController();
    inFlight = attempt;

    try {
      const res = await fetch(url, { cache: "no-cache", signal: attempt.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();

      if (known && text === known) {
        // Byte for byte what is already on screen. Stamped so the next launch trusts the
        // cache for another six hours rather than asking again immediately.
        write(stampKey(url), String(Date.now()));
        set({ loading: false, error: "" });
        return { count: get().channels.length, error: "" };
      }

      const parsed = parse(text);
      if (!parsed.channels.length) throw new Error("no channels in that playlist");
      /*
       * Kept if it fits, and the launch does not wait to find out.
       *
       * The channels are already on screen by the time this resolves. A playlist too large
       * for the whole budget is refused rather than allowed to evict everything else for a
       * copy of itself, and the only consequence is that the next launch waits for the
       * network, which is what happened before any of this existed.
       */
      void disk.write(cacheKey(url), text);
      write(stampKey(url), String(Date.now()));
      set({ ...parsed, loading: false, error: "" });
      return { count: parsed.channels.length, error: "" };
    } catch (e) {
      // Called off because something newer was asked for. The newer one owns the state now,
      // so this must not touch it, and in particular must not report a failure.
      if (attempt.signal.aborted) return { count: get().channels.length, error: "" };
      const message = e instanceof Error ? e.message : String(e);
      // Keep whatever the cache gave us rather than emptying the screen.
      const error = get().channels.length
        ? `Could not refresh: ${message}. Showing the last saved copy.`
        : `Could not load the playlist: ${message}`;
      set({ loading: false, error });
      return { count: get().channels.length, error };
    }
  };

  return {
    channels: [],
    categories: [],
    favourites: readJSON<string[]>(FAVOURITES_KEY, []),
    loading: false,
    error: "",

    async load(force = false): Promise<LoadResult> {
      cancelPending?.();
      cancelPending = null;

      const playlist = useSettings.getState().activePlaylist();
      // Nothing configured yet, which is the first run. The onboarding screen is showing.
      if (!playlist) {
        set({ channels: [], categories: [], loading: false, error: "" });
        return { count: 0, error: "" };
      }

      /*
       * The cached copy first, and then get out of the way.
       *
       * This used to show the cache and then immediately go to the network regardless, so
       * every launch paid for the playlist twice before the first picture: a download, a
       * second parse of text that was almost always identical, and a synchronous write of
       * the whole file back to flash. All of it on the main thread, all of it between the
       * viewer pressing the button and the channel starting.
       *
       * Now the cache answers the launch. A refresh still happens when the copy is old, but
       * behind the picture rather than in front of it, in idle time, and this returns
       * without waiting for it.
       */
      /*
       * Loading, before anything is awaited.
       *
       * Not a spinner for its own sake. The splash reports either "Loading the playlist" or
       * "That playlist has no channels in it" depending on this flag, and the store starts
       * with it false and no channels, so for as long as this function has not answered, a
       * television that is working perfectly tells the viewer their playlist is empty and
       * offers to replace it.
       *
       * It used to be raised here and I moved it below the cache read, reasoning that an
       * indexed lookup resolves in a few milliseconds and a spinner that brief is noise. That
       * was answering the wrong question: the cost of not raising it is not a missing
       * spinner, it is a false statement, and on a set with a slow main thread and slower
       * flash the window is not a few milliseconds.
       */
      set({ loading: true, error: "" });

      /*
       * A read from disk rather than from localStorage, so this is now awaited. The wait is
       * for one indexed lookup off flash rather than for a download, and it is bought at the
       * price of not blocking the main thread while flash is written.
       */
      const cached = force ? null : await disk.read(cacheKey(playlist.url));
      if (typeof cached === "string" && cached) {
        const parsed = parse(cached);
        if (parsed.channels.length) {
          set({ ...parsed, loading: false, error: "" });
          const at = Number(read(stampKey(playlist.url))) || 0;
          if (Date.now() - at < CACHE_TTL_MS) return { count: parsed.channels.length, error: "" };
          cancelPending = whenIdle(
            () => { cancelPending = null; void refresh(playlist.url, cached); },
            4000,
          );
          return { count: parsed.channels.length, error: "" };
        }
      }

      // Nothing usable to show, so the network is the only answer and the viewer waits.
      return refresh(playlist.url, "");
    },

    /**
     * Throw away cached playlists nobody is configured to watch any more.
     *
     * Removing a playlist used to leave its cached copy behind for good, and there was no
     * code anywhere that could ever have deleted it: the key was derived from an id that no
     * longer existed, so nothing knew the entry's name. Within a 5MB budget that is a leak
     * with a hard stop at the end of it.
     *
     * A sweep rather than a deletion in removePlaylist, because the same pass collects
     * everything else that goes stale on its own: a playlist whose address was edited, and
     * the copies written by versions of this app that kept them in localStorage. One place
     * that asks "is anything still using this", run once at launch, cannot miss a case the
     * way five call sites can.
     */
    async sweep(): Promise<void> {
      const wanted = new Set(useSettings.getState().playlists.map((p) => cacheKey(p.url)));
      // Logos are not playlists and are not swept here: they are bounded by the budget and
      // are worth keeping across a playlist change, since the channels usually come back.
      await disk.forget((key) => key.startsWith("playlist:") && !wanted.has(key));

      for (const key of keys()) {
        if (key.startsWith(LEGACY_PREFIX)) remove(key);
      }
      const stamps = new Set(useSettings.getState().playlists.map((p) => stampKey(p.url)));
      for (const key of keys()) {
        if (key.startsWith("openiptv.at.") && !stamps.has(key)) remove(key);
      }
    },

    toggleFavourite(id) {
      const next = get().favourites.includes(id)
        ? get().favourites.filter((f) => f !== id)
        : [...get().favourites, id];
      write(FAVOURITES_KEY, JSON.stringify(next));
      set({ favourites: next });
    },

    rememberLast: (id) => write(LAST_KEY, id),
    lastPlayed: () => read(LAST_KEY),

    clearPersonal() {
      remove(FAVOURITES_KEY);
      remove(LAST_KEY);
      set({ favourites: [] });
    },
  };
});

export async function clearCache(): Promise<void> {
  cancelPending?.();
  cancelPending = null;
  inFlight?.abort();
  inFlight = null;
  await disk.forgetAll();
  for (const key of keys()) {
    if (key.startsWith(LEGACY_PREFIX) || key.startsWith("openiptv.at.")) remove(key);
  }
}
