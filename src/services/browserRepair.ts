import type HlsType from "hls.js";
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
  PlaylistLoaderContext,
} from "hls.js";
import { needsRepair, renderPlaylist, windowOf } from "./manifest";

interface PublishedWindow {
  addresses: string[];
  sequence: number;
}

type PlaylistLoader = Loader<PlaylistLoaderContext>;

/**
 * A playlist loader that repairs the one manifest defect this application knows how to fix.
 *
 * The base loader still owns requests, retries, response status and cancellation. This wrapper
 * only changes successful manifest responses, so hls.js continues to reload a live playlist in
 * the ordinary way and the repaired text is applied on every refresh.
 */
export function createRepairingPlaylistLoader(
  Hls: typeof HlsType,
): NonNullable<HlsConfig["pLoader"]> {
  const BaseLoader = Hls.DefaultConfig.loader;

  return class RepairingPlaylistLoader implements PlaylistLoader {
    private readonly base: PlaylistLoader;
    private readonly published = new Map<string, PublishedWindow>();
    context: PlaylistLoaderContext | null = null;
    stats: LoaderStats;

    constructor(config: HlsConfig) {
      this.base = new BaseLoader(config) as unknown as PlaylistLoader;
      this.stats = this.base.stats;
    }

    load(
      context: PlaylistLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<PlaylistLoaderContext>,
    ): void {
      this.context = context;
      this.base.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, loadedContext, networkDetails) => {
          const text = typeof response.data === "string" ? response.data : null;
          if (!text || !needsRepair(text)) {
            this.published.delete(loadedContext.url);
            callbacks.onSuccess(response, stats, loadedContext, networkDetails);
            return;
          }

          const source = response.url || loadedContext.url;
          const repaired = windowOf(text, source);
          const addresses = repaired.segments.map((segment) => segment.uri);
          const previous = this.published.get(loadedContext.url);
          let sequence = previous?.sequence ?? 0;

          if (previous && addresses.length) {
            const slid = previous.addresses.indexOf(addresses[0]);
            sequence += slid >= 0 ? slid : previous.addresses.length;
          }

          this.published.set(loadedContext.url, { addresses, sequence });
          callbacks.onSuccess(
            { ...response, data: renderPlaylist(repaired, sequence) },
            stats,
            loadedContext,
            networkDetails,
          );
        },
      });
      this.stats = this.base.stats;
    }

    abort(): void {
      this.base.abort();
    }

    destroy(): void {
      this.published.clear();
      this.context = null;
      this.base.destroy();
    }

    getCacheAge(): number | null {
      return this.base.getCacheAge?.() ?? null;
    }

    getResponseHeader(name: string): string | null {
      return this.base.getResponseHeader?.(name) ?? null;
    }
  };
}