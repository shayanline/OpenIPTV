import { create } from "zustand";
import type { Channel } from "../types";
import { groupByCategory, parseM3U } from "../services/m3u";
import { useSettings } from "./settings";
import { read, readJSON, remove, write } from "../services/store";

const FAVOURITES_KEY = "simpleiptv.favourites";
const LAST_KEY = "simpleiptv.last";
const cacheKey = (playlistId: string) => `simpleiptv.cache.${playlistId}`;

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

export const useChannels = create<State>((set, get) => ({
  channels: [],
  categories: [],
  favourites: readJSON<string[]>(FAVOURITES_KEY, []),
  loading: false,
  error: "",

  async load(force = false): Promise<LoadResult> {
    const settings = useSettings.getState();
    const playlist = settings.activePlaylist();
    // Nothing configured yet, which is the first run. The onboarding screen is showing.
    if (!playlist) {
      set({ channels: [], categories: [], loading: false, error: "" });
      return { count: 0, error: "" };
    }
    set({ loading: true, error: "" });

    const apply = (text: string) => {
      let channels = parseM3U(text);
      if (settings.sortAlphabetically) {
        channels = [...channels].sort((a, b) => a.name.localeCompare(b.name, "en"));
      }
      return { channels, categories: groupByCategory(channels) };
    };

    // Show the cached copy first. A TV on a slow connection should not sit on a blank
    // screen while a 200 KB playlist downloads, and the refresh replaces it in place.
    if (!force) {
      const cached = read(cacheKey(playlist.id));
      if (cached) {
        const parsed = apply(cached);
        if (parsed.channels.length) set(parsed);
      }
    }

    inFlight?.abort();
    const attempt = new AbortController();
    inFlight = attempt;

    try {
      const res = await fetch(playlist.url, { cache: "no-cache", signal: attempt.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = apply(text);
      if (!parsed.channels.length) throw new Error("no channels in that playlist");
      write(cacheKey(playlist.id), text);
      set({ ...parsed, loading: false });
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
}));
