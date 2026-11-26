import type { MessageKey } from "./locale";

export interface Reason {
  why: string;
  whyKey: MessageKey;
}

/** Only a reported HTTP response supports a more specific explanation. */
const REASONS: { match: RegExp; reason: Reason }[] = [
  {
    match: /\bhttp\s+(401|403|451)\b|^(401|403|451)$/i,
    reason: {
      why: "Access to this stream was denied.",
      whyKey: "error.accessDenied",
    },
  },
  {
    match: /\bhttp\s+5[0-9][0-9]\b|^5[0-9][0-9]$/i,
    reason: {
      why: "The server returned an error.",
      whyKey: "error.serverError",
    },
  },
];

const FALLBACK: Reason = {
  why: "Playback is unavailable.",
  whyKey: "error.playbackUnavailable",
};

export function explain(code: string): Reason {
  return REASONS.find((r) => r.match.test(code))?.reason ?? FALLBACK;
}

/** Controls automatic recovery independently of the brief viewer message. */
export interface FaultPolicy {
  terminal: boolean;
  compatibility: boolean;
  httpFallback: boolean;
}

const TERMINAL_REFUSAL = /http (401|403|451)|\b(401|403|451)\b|GEO/i;
const TERMINAL_ADDRESS = /http 40[0-9]|\b404\b|INVALID_URI|NO_SUCH_FILE/i;
const TERMINAL_FORMAT =
  /NOT_SUPPORTED_FILE|CODEC|manifestParsing|manifestIncompatible|FINITE_FORMAT_UNSUPPORTED/i;
const TERMINAL_SOURCE = /FINITE_SOURCE_UNAVAILABLE/i;
const FALLBACK_ELIGIBLE =
  /CONNECTION_FAILED|NETWORK|manifestLoad|levelLoad|fragLoad|TIMEOUT|CIPHER|CERT|NOT_SUPPORTED/i;

export function faultPolicy(code: string): FaultPolicy {
  const terminal =
    TERMINAL_REFUSAL.test(code) ||
    TERMINAL_ADDRESS.test(code) ||
    TERMINAL_FORMAT.test(code) ||
    TERMINAL_SOURCE.test(code);
  return {
    terminal,
    compatibility: !terminal,
    httpFallback: !terminal && FALLBACK_ELIGIBLE.test(code),
  };
}
