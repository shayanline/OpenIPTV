import { expect, test } from "vitest";
import { hdrFormat, hdrFromVariants, variantsFromManifest } from "../src/services/hdr";

test("VIDEO-RANGE names SDR, HDR10 and HLG", () => {
  expect(hdrFormat({ videoRange: "SDR" })).toBe("SDR");
  expect(hdrFormat({ videoRange: "PQ", codecs: "hvc1.2.4.L150.B0" })).toBe("HDR10");
  expect(hdrFormat({ videoRange: "HLG" })).toBe("HLG");
});

test("the cdm4 brand marks HDR10+", () => {
  expect(hdrFormat({ videoRange: "PQ", codecs: "av01.0.05M.10.0.112/cdm4,mp4a.40.2" })).toBe(
    "HDR10+",
  );
});

test("Dolby Vision is named with the layer an older set falls back to", () => {
  expect(
    hdrFormat({
      videoRange: "PQ",
      codecs: "hvc1.2.4.L153.b0",
      supplementalCodecs: "dvh1.08.07/db1p",
    }),
  ).toBe("Dolby Vision · HDR10");
  expect(hdrFormat({ videoRange: "HLG", supplementalCodecs: "dvh1.08.09/db4h" })).toBe(
    "Dolby Vision · HLG",
  );
  expect(hdrFormat({ codecs: "dvh1.05.06" })).toBe("Dolby Vision");
});

test("a manifest that declares nothing is reported as such, not guessed", () => {
  expect(hdrFormat({ codecs: "avc1.640028,mp4a.40.2" })).toBe("unsignalled");
  expect(hdrFromVariants([])).toBe("unsignalled");
});

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,CODECS="avc1.640028,mp4a.40.2",VIDEO-RANGE=SDR
sdr.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=12000000,CODECS="hvc1.2.4.L150.B0,ec-3",VIDEO-RANGE=PQ,SUPPLEMENTAL-CODECS="dvh1.08.07/db1p"
dv.m3u8`;

test("the variant playing is found by bitrate, and disagreement without one is not guessed", () => {
  const variants = variantsFromManifest(MASTER);
  expect(variants).toHaveLength(2);
  expect(hdrFromVariants(variants, 2_100_000)).toBe("SDR");
  expect(hdrFromVariants(variants, 11_000_000)).toBe("Dolby Vision · HDR10");
  expect(hdrFromVariants(variants)).toBeUndefined();
});
