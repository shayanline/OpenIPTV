import { create } from "zustand";
import type { Channel } from "../types";
import { groupByCategory, parseM3U } from "../services/m3u";
import { useSettings } from "./settings";

const FAVOURITES_KEY = "simpleiptv.favourites";
const LAST_KEY = "simpleiptv.last";
const cacheKey = (playlistId: string) => `simpleiptv.cache.${playlistId}`;

const read = (key: string, fallback = "") => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A full or disabled store must not stop a channel change.
  }
};

interface State {
  channels: Channel[];
  categories: { name: string; channels: Channel[] }[];
  favourites: string[];
  loading: boolean;
  error: string;
  load: (force?: boolean) => Promise<void>;
  toggleFavourite: (id: string) => void;
  rememberLast: (id: string) => void;
  lastPlayed: () => string;
}

export const useChannels = create<State>((set, get) => ({
  channels: [],
  categories: [],
  favourites: JSON.parse(read(FAVOURITES_KEY, "[]")) as string[],
  loading: false,
  error: "",

  async load(force = false) {
    const settings = useSettings.getState();
    const playlist = settings.activePlaylist();
    if (!playlist) return;
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

    try {
      const res = await fetch(playlist.url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = apply(text);
      if (!parsed.channels.length) throw new Error("no channels in that playlist");
      write(cacheKey(playlist.id), text);
      set({ ...parsed, loading: false });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Keep whatever the cache gave us rather than emptying the screen.
      set({
        loading: false,
        error: get().channels.length
          ? `Could not refresh: ${message}. Showing the last saved copy.`
          : `Could not load the playlist: ${message}`,
      });
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
}));
