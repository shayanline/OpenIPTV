import type HlsType from "hls.js";
import hlsScriptUrl from "hls.js/dist/hls.min.js?url";

/**
 * hls.js, fetched only when the browser path needs it.
 *
 * The production build is a classic script rather than an ES module, because a Tizen 5.5 set
 * loading its widget from the filesystem reports no MIME type for a .js file and Chromium refuses
 * to run a module without one: the app showed its name and nothing else. A classic bundle cannot
 * split off a chunk for a dynamic import, so in production hls.js is its own file, the library's
 * own UMD build, added with a script tag on first use. The television never reaches this, since
 * AVPlay plays there, so it never pays to parse the library either.
 *
 * Development and tests keep the plain dynamic import, which is what the tests mock.
 */
let loading: Promise<typeof HlsType> | null = null;

export function loadHlsLibrary(): Promise<typeof HlsType> {
  if (import.meta.env.DEV || import.meta.env.MODE === "test") {
    loading ??= import("hls.js").then((m) => m.default);
    return loading;
  }
  loading ??= new Promise<typeof HlsType>((resolve, reject) => {
    const global = window as unknown as { Hls?: typeof HlsType };
    if (global.Hls) {
      resolve(global.Hls);
      return;
    }
    const script = document.createElement("script");
    script.src = hlsScriptUrl;
    script.onload = () =>
      global.Hls ? resolve(global.Hls) : reject(new Error("hls.js did not register"));
    script.onerror = () => reject(new Error("hls.js could not be loaded"));
    document.head.appendChild(script);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
