import { create } from "zustand";
import { readJSON, write } from "../services/store";

/**
 * Everything the viewer can change, persisted to localStorage.
 *
 * Fonts are whatever the device already has. Nothing is bundled: a webfont adds weight to
 * every launch, and the choice of which script to bundle would be a guess about who is
 * watching. The families below are generic, so each resolves to something sensible
 * wherever the app runs, and the device supplies the glyphs for the playlist's language.
 */

export interface FontChoice {
  id: string;
  label: string;
  stack: string;
  note?: string;
}

export const FONTS: FontChoice[] = [
  {
    id: "system",
    label: "System",
    // system-ui resolves to One UI Sans on a Samsung TV, which is what the rest of the
    // set is drawn in, and to the platform font everywhere else.
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    note: "The device's own interface font",
  },
  {
    id: "sans",
    label: "Sans serif",
    stack: '"Noto Sans", Arial, Helvetica, sans-serif',
    note: "Widest script coverage where the device has it",
  },
  {
    id: "serif",
    label: "Serif",
    stack: '"Noto Serif", Georgia, "Times New Roman", serif',
  },
  {
    id: "mono",
    label: "Monospace",
    stack: '"Noto Sans Mono", Menlo, Consolas, monospace',
    note: "Aligns channel numbers neatly",
  },
];

/**
 * What to do with a picture that is not the shape of the screen.
 *
 * Live channels arrive in whatever shape the broadcaster sends, and plenty of them are not
 * sixteen by nine: standard definition feeds, old archive material, and streams whose
 * encoder has rounded the height to something odd. The names are the viewer's words for it
 * rather than the platform's, and each maps onto a display mode the TV already has.
 */
export const ASPECTS = [
  { id: "fit", label: "Fit", note: "The whole picture, with bars if it does not fill the screen" },
  { id: "fill", label: "Fill", note: "Fills the screen, cropping the edges of the picture" },
  { id: "stretch", label: "Stretch", note: "Fills the screen by distorting the picture" },
] as const;

export type AspectId = (typeof ASPECTS)[number]["id"];

export const FONT_SIZES = [
  { id: "s", label: "Small", scale: 0.85 },
  { id: "m", label: "Medium", scale: 1 },
  { id: "l", label: "Large", scale: 1.15 },
  { id: "xl", label: "Extra large", scale: 1.3 },
];

export interface Playlist {
  id: string;
  name: string;
  url: string;
}

interface Settings {
  fontId: string;
  fontSizeId: string;
  playlists: Playlist[];
  activePlaylistId: string;
  showNumbers: boolean;
  showLogos: boolean;
  /** How a picture that is not the shape of the screen should be fitted to it. */
  aspectId: AspectId;
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
  activePlaylist: () => Playlist | undefined;
}

const KEY = "simpleiptv.settings";

// A fresh install ships with no playlist. There is no neutral one to choose: any list
// bundled here would be a decision about what somebody in some country should watch, made
// by the app rather than by them. The first run asks for a URL instead.
const DEFAULTS = {
  fontId: "system",
  fontSizeId: "m",
  playlists: [] as Playlist[],
  activePlaylistId: "",
  showNumbers: true,
  showLogos: true,
  aspectId: "fit" as AspectId,
  showClock: true,
  resumeLast: true,
  /* Fifteen seconds, not eight. The channel list is read rather than glanced at, and a
     playlist with two hundred channels in twenty five categories takes longer than eight
     seconds to find your way around. A menu that closes itself while somebody is still
     deciding reads as the television interrupting them. */
  panelTimeout: 15,
  sortAlphabetically: false,
};

/**
 * An id no existing playlist is using.
 *
 * The clock alone is not enough. It has a resolution of one millisecond, and adding two
 * playlists within the same millisecond is not a race anyone has to try for: it happens
 * whenever anything adds two in a row. Two playlists carrying one id is not a cosmetic
 * problem, because removal filters by id, so removing either removes both, takes the active
 * playlist with them and drops the app back to its first run screen.
 */
function freshId(existing: Playlist[]): string {
  const used = new Set(existing.map((p) => p.id));
  const stamp = Date.now().toString(36);
  let id = `pl-${stamp}`;
  for (let n = 2; used.has(id); n += 1) id = `pl-${stamp}-${n}`;
  return id;
}

function load(): typeof DEFAULTS {
  // Merged rather than replaced, so a settings file written by an older version keeps working
  // when new keys appear.
  return { ...DEFAULTS, ...readJSON<Partial<typeof DEFAULTS>>(KEY, {}) };
}

function persist(state: Settings) {
  const { set: _s, addPlaylist: _a, removePlaylist: _r, updatePlaylist: _u,
          reset: _re, font: _f, scale: _sc, activePlaylist: _ap, ...data } = state;
  write(KEY, JSON.stringify(data));
}

export const useSettings = create<Settings>((set, get) => ({
  ...load(),

  set(key, value) {
    set({ [key]: value } as Pick<Settings, typeof key>);
    persist(get());
  },

  addPlaylist(name, url) {
    const playlist = { id: freshId(get().playlists), name: name.trim(), url: url.trim() };
    const first = !get().playlists.length;
    set({
      playlists: [...get().playlists, playlist],
      // The first one added becomes the active one, so adding a playlist is the whole of
      // first run rather than adding then choosing.
      activePlaylistId: first ? playlist.id : get().activePlaylistId,
    });
    persist(get());
  },

  removePlaylist(id) {
    const remaining = get().playlists.filter((p) => p.id !== id);
    set({
      playlists: remaining,
      activePlaylistId: get().activePlaylistId === id
        ? (remaining[0]?.id ?? "")
        : get().activePlaylistId,
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
