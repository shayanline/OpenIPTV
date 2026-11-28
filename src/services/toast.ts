import { create } from "zustand";

export type ToastKind = "neutral" | "success" | "error" | "information" | "warning" | "loading";
export type ToastOutcome = Exclude<ToastKind, "loading">;
export type ToastOwner = symbol;
export interface ToastNotice {
  id: number;
  owner: ToastOwner;
  kind: ToastKind;
  message: string;
  operation?: symbol;
}
export const TOAST_LIFETIME: Record<ToastOutcome, number> = {
  neutral: 4000,
  success: 3200,
  error: 5200,
  information: 4000,
  warning: 5200,
};
export const useToasts = create<{ notice: ToastNotice | null }>(() => ({ notice: null }));
const owners = new Set<ToastOwner>();
let timer: number | undefined;
let sequence = 0;

export function retainToastOwner(owner: ToastOwner): void {
  owners.add(owner);
}
export function clearToast(owner: ToastOwner, id?: number): void {
  const notice = useToasts.getState().notice;
  if (notice?.owner !== owner || (id !== undefined && notice.id !== id)) return;
  window.clearTimeout(timer);
  timer = undefined;
  useToasts.setState({ notice: null });
}
export function releaseToastOwner(owner: ToastOwner): void {
  owners.delete(owner);
  clearToast(owner);
}
export function showToast(
  owner: ToastOwner,
  message: string,
  kind: ToastKind = "neutral",
  operation?: symbol,
): number | undefined {
  if (!owners.has(owner) || !message.trim()) return;
  const current = useToasts.getState().notice;
  if (
    current?.owner === owner &&
    current.kind === kind &&
    current.message === message &&
    current.operation === operation
  )
    return current.id;
  window.clearTimeout(timer);
  timer = undefined;
  const notice: ToastNotice = { id: ++sequence, owner, kind, message, operation };
  useToasts.setState({ notice });
  if (kind !== "loading") {
    timer = window.setTimeout(() => {
      if (useToasts.getState().notice?.id !== notice.id) return;
      timer = undefined;
      useToasts.setState({ notice: null });
    }, TOAST_LIFETIME[kind]);
  }
  return notice.id;
}
export function resolveToast(
  owner: ToastOwner,
  id: number | undefined,
  message: string,
  kind: ToastOutcome,
): void {
  const notice = useToasts.getState().notice;
  if (id === undefined || notice?.owner !== owner || notice.id !== id) return;
  showToast(owner, message, kind);
}
