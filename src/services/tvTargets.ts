/** Shared by the app and the release packager. Node strips types in the build scripts. */
export const TV_TARGETS = {
  webos: {
    name: "LG webOS",
    delivery: "ipk",
    nativeHls: true,
    integration: "public",
  },
  titan: {
    name: "Titan OS",
    delivery: "hosted",
    nativeHls: true,
    integration: "public",
  },
  vidaa: {
    name: "VIDAA",
    delivery: "hosted",
    nativeHls: true,
    integration: "partner-required",
  },
  vizio: {
    name: "VIZIO",
    delivery: "hosted",
    nativeHls: true,
    integration: "partner-required",
  },
  vega: {
    name: "Amazon Vega",
    delivery: "webview",
    nativeHls: false,
    integration: "sdk-required",
  },
} as const;

export type TVTarget = keyof typeof TV_TARGETS;

const TV_TARGET_NAMES = Object.keys(TV_TARGETS);

export function isTVTarget(value: string): value is TVTarget {
  return TV_TARGET_NAMES.includes(value);
}
