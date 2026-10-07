export type AppMode = "live" | "movie" | "series";
export type PictureSurface = "picture";
export type PrimarySurface = "panel" | "playback-deck" | "vod";
export type DrawerSurface = "guide" | "audio" | "subtitles" | "more";
export type PlaybackDrawerSurface = Exclude<DrawerSurface, "guide">;
export type ModalSurface = "settings" | "onboarding" | "exit";
export type PopupSurface = "confirmation";
export type LiveSurface = PictureSurface | "panel";
export type SurfaceId =
  | PictureSurface
  | PrimarySurface
  | DrawerSurface
  | ModalSurface
  | PopupSurface;
export type SurfaceKeyHandler = (code: number, event: KeyboardEvent) => void;

export interface SurfaceStack {
  picture: PictureSurface;
  primary: PrimarySurface | null;
  drawer: DrawerSurface | null;
  modal: ModalSurface | null;
  popup: PopupSurface | null;
}

export function activeSurface(stack: SurfaceStack): SurfaceId {
  return stack.popup ?? stack.modal ?? stack.drawer ?? stack.primary ?? stack.picture;
}
