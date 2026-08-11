import { create } from "zustand";

/**
 * Everything the viewer can change, persisted to localStorage.
 *
 * Fonts are bundled rather than fetched. A large share of this app's audience is inside
 * Iran, where Google Fonts is not reliably reachable, and a webfont that fails to load on
 * a TV leaves the interface in a fallback the layout was never checked against.
 */

export interface FontChoice {
  id: string;
  label: string;
  stack: string;
  /** True when the file ships inside the widget rather than coming from the system. */
  bundled?: boolean;
  note?: string;
}

export const FONTS: FontChoice[] = [
  {
    id: "vazirmatn",
    label: "Vazirmatn",
    stack: '"Vazirmatn", "Noto Sans Arabic", sans-serif',
    bundled: true,
    note: "Designed for Persian, and covers Latin too",
  },
  {
    id: "system",
    label: "System default",
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    note: "Whatever the TV ships with",
  },
  {
    id: "noto",
    label: "Noto Sans",
    stack: '"Noto Sans", "Noto Sans Arabic", system-ui, sans-serif',
    note: "Wide script coverage where the TV has it",
  },
  {
    id: "serif",
    label: "Serif",
    stack: 'Georgia, "Times New Roman", "Noto Naskh Arabic", serif',
  },
  {
    id: "mono",
    label: "Monospace",
    stack: '"SF Mono", Menlo, Consolas, monospace',
    note: "Aligns channel numbers neatly",
  },
];

export const FONT_SIZES = [
  { id: "s", label: "Small", scale: 0.85 },
  { id: "m", label: "Medium", scale: 1 },
  { id: "l", label: "Large", scale: 1.15 },
  { id: "xl", label: "Extra large", scale: 1.3 },
];

export const LANGUAGES = [
  { id: "auto", label: "Both, as the playlist provides" },
  { id: "en", label: "English only" },
  { id: "fa", label: "Persian only" },
];

export interface Playlist {
  id: string;
  name: string;
  url: string;
}

export const BUILT_IN_PLAYLISTS: Playlist[] = [
  {
    id: "iran",
    name: "Iran, everything",
    url: "https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/iran.m3u",
  },
  {
    id: "iran-global",
    name: "Iran, plays worldwide",
    url: "https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/iran-global.m3u",
  },
  {
    id: "iran-compat",
    name: "Iran, safest for older TVs",
    url: "https://raw.githubusercontent.com/shayanline/iptv-iran/main/playlists/iran-compat.m3u",
  },
];

interface Settings {
  fontId: string;
  fontSizeId: string;
  language: string;
  playlists: Playlist[];
  activePlaylistId: string;
  showNumbers: boolean;
  showLogos: boolean;
  showClock: boolean;
  resumeLast: boolean;
  panelTimeout: number;
  sortAlphabetically: boolean;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  addPlaylist: (name: string, url: string) => void;
  removePlaylist: (id: string) => void;
  updatePlaylist: (id: string, name: string, url: string) => void;
  reset: () => void;
  font: () => FontChoice;
  scale: () => number;
  activePlaylist: () => Playlist;
}

const KEY = "simpleiptv.settings";

const DEFAULTS = {
  fontId: "vazirmatn",
  fontSizeId: "m",
  language: "auto",
  playlists: BUILT_IN_PLAYLISTS,
  activePlaylistId: "iran",
  showNumbers: true,
  showLogos: true,
  showClock: true,
  resumeLast: true,
  panelTimeout: 8,
  sortAlphabetically: false,
};

function load(): typeof DEFAULTS {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw) as Partial<typeof DEFAULTS>;
    // Merge rather than replace, so a settings file written by an older version keeps
    // working when new keys appear.
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: Settings) {
  try {
    const { set: _s, addPlaylist: _a, removePlaylist: _r, updatePlaylist: _u,
            reset: _re, font: _f, scale: _sc, activePlaylist: _ap, ...data } = state;
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // A full or disabled store must not stop the app working.
  }
}

export const useSettings = create<Settings>((set, get) => ({
  ...load(),

  set(key, value) {
    set({ [key]: value } as Pick<Settings, typeof key>);
    persist(get());
  },

  addPlaylist(name, url) {
    const playlist = { id: `custom-${Date.now().toString(36)}`, name: name.trim(), url: url.trim() };
    set({ playlists: [...get().playlists, playlist] });
    persist(get());
  },

  removePlaylist(id) {
    const remaining = get().playlists.filter((p) => p.id !== id);
    if (!remaining.length) return;   // never leave the app with nothing to play
    set({
      playlists: remaining,
      activePlaylistId: get().activePlaylistId === id ? remaining[0].id : get().activePlaylistId,
    });
    persist(get());
  },

  updatePlaylist(id, name, url) {
    set({
      playlists: get().playlists.map((p) =>
        p.id === id ? { ...p, name: name.trim(), url: url.trim() } : p),
    });
    persist(get());
  },

  reset() {
    set({ ...DEFAULTS });
    persist(get());
  },

  font: () => FONTS.find((f) => f.id === get().fontId) ?? FONTS[0],
  scale: () => FONT_SIZES.find((s) => s.id === get().fontSizeId)?.scale ?? 1,
  activePlaylist: () =>
    get().playlists.find((p) => p.id === get().activePlaylistId) ?? get().playlists[0],
}));
