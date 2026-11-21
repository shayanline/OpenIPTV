/**
 * Which dynamic range a stream declares, read from its HLS manifest.
 *
 * Neither engine reports it while playing: AVPlay has no reliable property for it and the media
 * element knows nothing about colour. What the manifest declares is the next best thing, and the
 * HLS specification gives it three places to say so:
 *
 *   VIDEO-RANGE=SDR|PQ|HLG on #EXT-X-STREAM-INF, where PQ is what HDR10 and HDR10+ use
 *   CODECS and SUPPLEMENTAL-CODECS naming Dolby Vision (dvh1, dvhe, dav1, dva1), whose brand
 *     after the slash names the layer an older set falls back to: db1p HDR10, db4h HLG, db2g SDR
 *   the cdm4 brand, which marks HDR10+ dynamic metadata
 *
 * "unsignalled" is a manifest that says nothing, which is most IPTV and usually means SDR. It is
 * reported as such rather than guessed, because a guess on this line is exactly what the viewer
 * opened the panel to avoid.
 */

export type HdrFormat =
  | "SDR"
  | "HDR10"
  | "HDR10+"
  | "HLG"
  | "Dolby Vision"
  | "Dolby Vision · HDR10"
  | "Dolby Vision · HLG"
  | "Dolby Vision · SDR"
  | "unsignalled";

export interface HdrSignals {
  videoRange?: string;
  codecs?: string;
  supplementalCodecs?: string;
}

const DOLBY_VISION = /^(dvh1|dvhe|dav1|dva1)\./;
const DOLBY_COMPATIBLE: Record<string, HdrFormat> = {
  db1p: "Dolby Vision · HDR10",
  db4h: "Dolby Vision · HLG",
  db2g: "Dolby Vision · SDR",
};

export function hdrFormat({ videoRange, codecs, supplementalCodecs }: HdrSignals): HdrFormat {
  const entries = `${codecs ?? ""},${supplementalCodecs ?? ""}`
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const range = (videoRange ?? "").trim().toUpperCase();

  const vision = entries.find((entry) => DOLBY_VISION.test(entry));
  if (vision) {
    for (const brand of vision.split("/").slice(1)) {
      const compatible = DOLBY_COMPATIBLE[brand];
      if (compatible) return compatible;
    }
    if (range === "HLG") return "Dolby Vision · HLG";
    return "Dolby Vision";
  }

  const dynamic = entries.some((entry) => entry.split("/").slice(1).includes("cdm4"));
  if (range === "PQ") return dynamic ? "HDR10+" : "HDR10";
  if (range === "HLG") return "HLG";
  if (range === "SDR") return "SDR";
  return dynamic ? "HDR10+" : "unsignalled";
}

export interface Variant {
  bandwidth?: number;
  signals: HdrSignals;
}

const ATTRIBUTE = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;

/** The variants a master playlist offers. A media playlist has none. */
export function variantsFromManifest(text: string): Variant[] {
  const variants: Variant[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    // exec in a loop rather than matchAll, which Chromium 69 does not have.
    const attributes: Record<string, string> = {};
    const list = line.slice(18);
    ATTRIBUTE.lastIndex = 0;
    for (let match = ATTRIBUTE.exec(list); match; match = ATTRIBUTE.exec(list)) {
      attributes[match[1]] = match[2].replace(/^"|"$/g, "");
    }
    const bandwidth = Number(attributes.BANDWIDTH);
    variants.push({
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : undefined,
      signals: {
        videoRange: attributes["VIDEO-RANGE"],
        codecs: attributes.CODECS,
        supplementalCodecs: attributes["SUPPLEMENTAL-CODECS"],
      },
    });
  }
  return variants;
}

/**
 * The format of the variant playing, matched by bitrate where the engine reports one. Without a
 * bitrate an answer is only given when every variant agrees.
 */
export function hdrFromVariants(variants: Variant[], bitrate?: number): HdrFormat | undefined {
  if (!variants.length) return "unsignalled";
  if (bitrate) {
    let best = variants[0];
    for (const variant of variants) {
      const distance = Math.abs((variant.bandwidth ?? 0) - bitrate);
      if (distance < Math.abs((best.bandwidth ?? 0) - bitrate)) best = variant;
    }
    return hdrFormat(best.signals);
  }
  const formats = new Set(variants.map((variant) => hdrFormat(variant.signals)));
  return formats.size === 1 ? [...formats][0] : undefined;
}
