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

function loadClassicScript(): Promise<typeof HlsType> {
  return new Promise<typeof HlsType>((resolve, reject) => {
    const global = window as unknown as { Hls?: typeof HlsType };
    if (typeof global.Hls === "function") {
      resolve(global.Hls);
      return;
    }
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      script.remove();
      if (error) reject(error);
      else if (typeof global.Hls === "function") resolve(global.Hls);
      else reject(new Error("hls.js did not register"));
    };
    const timeout = window.setTimeout(
      () => finish(new Error("hls.js loading timed out")),
      15_000,
    );
    script.src = hlsScriptUrl;
    script.onload = () => finish();
    script.onerror = () => finish(new Error("hls.js could not be loaded"));
    document.head.appendChild(script);
  });
}

export function loadHlsLibrary(): Promise<typeof HlsType> {
  loading ??= (
    import.meta.env.DEV || import.meta.env.MODE === "test"
      ? import("hls.js").then((module) => module.default)
      : loadClassicScript()
  ).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
