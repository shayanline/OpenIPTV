import {
  artworkOf,
  claimArtwork,
  dropQueuedArtwork,
  loadArtwork,
  releaseAllArtwork,
  releaseArtwork,
  warmArtworkChain,
  type WarmOptions,
} from "./artwork";

export const LOGO_BOX = { width: 76, height: 48 } as const;

const request = (url: string, width: number, height: number) => ({
  url,
  kind: "logo" as const,
  width,
  height,
});

export const logoOf = (url: string, width: number, height: number): ImageBitmap | null =>
  artworkOf(request(url, width, height))?.bitmap ?? null;

export function claimLogo(url: string, width: number, height: number): void {
  claimArtwork(request(url, width, height));
}

export function releaseLogo(url: string, width: number, height: number): void {
  releaseArtwork(request(url, width, height));
}

export function shrink(
  url: string,
  width: number,
  height: number,
  eager = true,
): Promise<ImageBitmap | null> {
  return loadArtwork({ ...request(url, width, height), eager }).then(
    (entry) => entry?.bitmap ?? null,
  );
}

export function dropQueuedWarming(): void {
  dropQueuedArtwork("logo");
}

export function releaseLogos(): void {
  releaseAllArtwork();
}

export function warmLogo(url: string): Promise<ImageBitmap | null> {
  return shrink(url, LOGO_BOX.width, LOGO_BOX.height, false);
}

export function warmChain(urls: string[], options: WarmOptions = {}): () => void {
  return warmArtworkChain(
    urls.map((url) => ({ ...request(url, LOGO_BOX.width, LOGO_BOX.height), eager: false })),
    options,
  );
}

export type { WarmOptions };
