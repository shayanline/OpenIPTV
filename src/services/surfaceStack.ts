export type PictureSurface = "picture";
export type PrimarySurface = "panel";
export type DrawerSurface = "guide";
export type ModalSurface = "settings" | "onboarding" | "exit";
export type PopupSurface = "confirmation";
export type LiveSurface = PictureSurface | PrimarySurface;
export type SurfaceId = LiveSurface | DrawerSurface | ModalSurface | PopupSurface;
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
