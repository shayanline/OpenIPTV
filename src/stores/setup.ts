import { create } from "zustand";
import type { PlaylistSource } from "../services/playlistUrl";

interface SetupState {
  name: string;
  source: PlaylistSource;
  set: (values: { name: string; source: PlaylistSource }) => void;
  clear: () => void;
}

const EMPTY_SOURCE: PlaylistSource = { kind: "m3u", url: "" };

export const useSetup = create<SetupState>((set) => ({
  name: "",
  source: EMPTY_SOURCE,
  set: ({ name, source }) => set({ name, source }),
  clear: () => set({ name: "", source: EMPTY_SOURCE }),
}));
