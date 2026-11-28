import { isTVTarget, TV_TARGETS, type TVTarget } from "./tvTargets";

export type Platform = TVTarget | "tizen" | "browser";

/**
 * Release packages select their platform explicitly. A browser user agent must never
 * enable a privileged device API or silently turn a partner candidate into a supported TV.
 */
export function platform(): Platform {
  if (typeof window === "undefined") return "browser";
  if (window.webapis?.avplay) return "tizen";
  const target = document
    .querySelector<HTMLMetaElement>('meta[name="openiptv-platform"]')
    ?.content;
  return target && isTVTarget(target) ? target : "browser";
}

export const isTV = (): boolean => platform() !== "browser";

export function prefersNativeHls(): boolean {
  const target = platform();
  return isTVTarget(target) && TV_TARGETS[target].nativeHls;
}

export function platformName(): string {
  const target = platform();
  if (target === "browser") return "Browser";
  if (target === "tizen") return "Samsung Tizen";
  return TV_TARGETS[target].name;
}

export function closeTVApp(): void {
  if (typeof window === "undefined") return;
  try {
    const application = (
      window as unknown as {
        tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
      }
    ).tizen?.application;
    if (application) {
      application.getCurrentApplication().exit();
    } else if (isTV()) {
      // LG and Titan document window.close. Vega's wrapper handles onCloseWindow.
      window.close();
    }
  } catch {
    // An unavailable platform API must not crash the exit dialog.
  }
}
