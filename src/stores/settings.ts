import { create } from "zustand";
import { readJSON, write } from "../services/store";

/**
 * Everything the viewer can change, persisted to localStorage.
 *
 * The type face is not among them, and deliberately so. It was offered for a while and it did
 * nothing on a television: the alternatives named families no Tizen set carries, so every choice
 * resolved back to the one font the device has, and the setting only worked on the desktop build
 * nobody watches television in. Whatever the set draws its own interface in is what this uses, and
 * the device supplies the glyphs for the playlist's language.
 */

/**
 * What to do with a picture that is not the shape of the screen.
 *
 * Live channels arrive in whatever shape the broadcaster sends, and plenty of them are not
 * sixteen by nine: standard definition feeds, old archive material, and streams whose
 * encoder has rounded the height to something odd. The names are the viewer's words for it
 * rather than the platform's, and each maps onto a display mode the TV already has.
 */
export const ASPECTS = [
  { id: "fill", label: "Fill", note: "Fills the screen, cropping the edges of the picture" },
  { id: "fit", label: "Fit", note: "The whole picture, with bars if it does not fill the screen" },
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
  /**
   * Whether to repair playlists this television cannot read, on the television.
   *
   * Off by default and deliberately so. It exists for one firmware defect: AVPlay keeps a
   * playlist's media sequence in a signed 32 bit integer, and a packager that numbers segments
   * from a microsecond clock overflows it, so the channel shows one frame and stops. Repairing it
   * means the application serving a corrected playlist to the set's own player over a loopback
   * socket, which is a great deal of machinery to have running for the majority of viewers who
   * never meet such a channel.
   */
  compatibility: boolean;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  addPlaylist: (name: string, url: string) => void;
  removePlaylist: (id: string) => void;
  updatePlaylist: (id: string, name: string, url: string) => void;
  reset: () => void;
  scale: () => number;
  activePlaylist: () => Playlist | undefined;
}

const KEY = "openiptv.settings";

// A fresh install ships with no playlist. There is no neutral one to choose: any list
// bundled here would be a decision about what somebody in some country should watch, made
// by the app rather than by them. The first run asks for a URL instead.
const DEFAULTS = {
  fontSizeId: "m",
  playlists: [] as Playlist[],
  activePlaylistId: "",
  showNumbers: true,
  showLogos: true,
  /* Fill, and it leads the list because it is the default. Almost everything in these
     playlists is sixteen by nine, and a television that leaves bars around a picture which
     would have fitted reads as a fault rather than as a choice. Fit is one press away for
     the feeds that get cropped badly, which are the standard definition ones. */
  aspectId: "fill" as AspectId,
  showClock: true,
  resumeLast: true,
  /* Four seconds remains the stored preference, although the channel panel no longer uses it. */
  panelTimeout: 4,
  sortAlphabetically: false,
  /* Off. Nothing that only some channels need should cost the others anything. */
  compatibility: false,
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
  const saved = readJSON<Record<string, unknown>>(KEY, {});
  const merged = { ...DEFAULTS } as Record<string, unknown>;
  /*
   * And only keys this version knows, so a setting that has been removed does not live on in the
   * file for ever. The type face was a real one: every install that had chosen a font kept carrying
   * `fontId` after the setting itself was gone, written back on every change, meaning nothing and
   * explaining nothing to whoever read the file next.
   */
  for (const key of Object.keys(DEFAULTS)) {
    if (key in saved) merged[key] = saved[key];
  }
  return merged as typeof DEFAULTS;
}

function persist(state: Settings) {
  const { set: _s, addPlaylist: _a, removePlaylist: _r, updatePlaylist: _u,
          reset: _re, scale: _sc, activePlaylist: _ap, ...data } = state;
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

  scale: () => FONT_SIZES.find((s) => s.id === get().fontSizeId)?.scale ?? 1,
  activePlaylist: () =>
    get().playlists.find((p) => p.id === get().activePlaylistId) ?? get().playlists[0],
}));
