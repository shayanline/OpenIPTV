import { create } from "zustand";

interface SetupState {
  name: string;
  url: string;
  set: (values: { name: string; url: string }) => void;
  clear: () => void;
}

export const useSetup = create<SetupState>((set) => ({
  name: "",
  url: "",
  set: ({ name, url }) => set({ name, url }),
  clear: () => set({ name: "", url: "" }),
}));
