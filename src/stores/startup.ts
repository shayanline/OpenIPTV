import { create } from "zustand";
import { useSettings } from "./settings";

interface StartupState {
  initialized: boolean;
  pending: boolean;
  activated: boolean;
  prepare: () => void;
  choose: (id?: string) => void;
  activationStarted: () => void;
}

// A launch decision belongs to this application session, never to persisted settings.
export const useStartup = create<StartupState>((set, get) => ({
  initialized: false,
  pending: false,
  activated: false,
  prepare() {
    if (get().initialized) return;
    const settings = useSettings.getState();
    const preference = settings.startupPlaylist;
    if (
      preference.mode === "specific" &&
      settings.playlists.some((playlist) => playlist.id === preference.playlistId)
    ) {
      settings.set("activePlaylistId", preference.playlistId);
    }
    set({
      initialized: true,
      pending: preference.mode === "ask" && settings.playlists.length > 1,
    });
  },
  choose(id) {
    const settings = useSettings.getState();
    if (id && !settings.playlists.some((playlist) => playlist.id === id)) return;
    if (id) settings.set("activePlaylistId", id);
    set({ pending: false });
  },
  activationStarted() {
    set({ initialized: true, pending: false, activated: true });
  },
}));
