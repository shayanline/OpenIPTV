import { create } from "zustand";
import type { Channel } from "../types";
import { groupByCategory, parseM3U } from "../services/m3u";

const PLAYLIST_KEY = "simpleiptv.playlist.url";
const CACHE_KEY = "simpleiptv.playlist.cache";
const FAVOURITES_KEY = "simpleiptv.favourites";
const LAST_KEY = "simpleiptv.last";

export const DEFAULT_PLAYLIST =
  "https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/iran.m3u";

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
    // A full or disabled store is not worth failing a channel change over.
  }
};

interface State {
  channels: Channel[];
  categories: { name: string; channels: Channel[] }[];
  favourites: string[];
  playlistUrl: string;
  loading: boolean;
  error: string;
  load: (force?: boolean) => Promise<void>;
  setPlaylistUrl: (url: string) => void;
  toggleFavourite: (id: string) => void;
  rememberLast: (id: string) => void;
  lastPlayed: () => string;
}

export const useChannels = create<State>((set, get) => ({
  channels: [],
  categories: [],
  favourites: JSON.parse(read(FAVOURITES_KEY, "[]")) as string[],
  playlistUrl: read(PLAYLIST_KEY, DEFAULT_PLAYLIST),
  loading: false,
  error: "",

  async load(force = false) {
    set({ loading: true, error: "" });
    const url = get().playlistUrl;

    // Show the cached copy immediately. A TV on a slow connection should not sit on a
    // blank screen while a 200 KB playlist downloads, and a refresh replaces it in place.
    if (!force) {
      const cached = read(CACHE_KEY);
      if (cached) {
        const channels = parseM3U(cached);
        if (channels.length) set({ channels, categories: groupByCategory(channels) });
      }
    }

    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const channels = parseM3U(text);
      if (!channels.length) throw new Error("no channels in that playlist");
      write(CACHE_KEY, text);
      set({ channels, categories: groupByCategory(channels), loading: false });
    } catch (e) {
      // Keep whatever the cache gave us rather than emptying the screen.
      set({
        loading: false,
        error: get().channels.length
          ? `Could not refresh: ${String(e)}. Showing the last saved copy.`
          : `Could not load the playlist: ${String(e)}`,
      });
    }
  },

  setPlaylistUrl(url) {
    write(PLAYLIST_KEY, url);
    set({ playlistUrl: url });
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
