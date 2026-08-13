/**
 * What a playback failure means, in words a viewer can act on.
 *
 * Checklist 4.6 asks a failure to say why it happened and what to do about it, so the
 * engines' own codes are translated rather than shown. Both engines are represented here:
 * AVPlay's PLAYER_ERROR_* names from the TV, hls.js's details from a browser, and the two
 * this app raises itself.
 *
 * Kept out of the component so it is plain data and a plain function, which is what makes
 * it testable without a renderer.
 */
export interface Reason {
  why: string;
  fix: string;
}

const REASONS: { match: RegExp; reason: Reason }[] = [
  {
    match: /CONNECTION_FAILED|NETWORK|manifestLoad|levelLoad|fragLoad|TIMEOUT/i,
    reason: {
      why: "The TV could not reach this channel's server.",
      fix: "It may be off the air. Check the network if other channels fail too.",
    },
  },
  {
    match: /NOT_SUPPORTED_FILE|CODEC|manifestParsing|manifestIncompatible/i,
    reason: {
      why: "This channel sends a format the TV cannot decode.",
      fix: "Nothing here will fix it. Try another channel.",
    },
  },
  {
    match: /INVALID_URI|NO_SUCH_FILE|404/i,
    reason: {
      why: "The address in the playlist no longer points at a stream.",
      fix: "Refresh the playlist in Settings to pull the current addresses.",
    },
  },
  {
    match: /GEO|403|451/i,
    reason: {
      why: "The broadcaster is not allowing this connection.",
      fix: "Streams are often restricted to the country they are broadcast in.",
    },
  },
  {
    match: /STREAM_ENDED/i,
    reason: {
      why: "This channel stopped broadcasting.",
      fix: "It may come back on its own.",
    },
  },
  {
    // Found by the app rather than reported by either engine: the connection is open and the
    // picture is not moving, which is how a public relay usually fails.
    match: /STALLED/i,
    reason: {
      why: "The picture from this channel has frozen.",
      fix: "The server stopped sending. It often recovers.",
    },
  },
  {
    // The engine says only that nothing playable arrived, which is true of a channel that
    // is off the air and of one sending something it cannot decode. Saying which would be
    // a guess, so it says both.
    match: /NotSupportedError|NOT_SUPPORTED/i,
    reason: {
      why: "Nothing playable arrived from this channel.",
      fix: "It may be off the air, or sending a format the TV cannot decode.",
    },
  },
];

/*
 * Neither of these names a key any more.
 *
 * Neither names a key. Retrying is automatic and OK means what it means everywhere else, so
 * a remedy telling the viewer to press a key that does something different would be worse
 * than no remedy at all. The cards say what is wrong, and the guide underneath them says
 * what the keys do.
 */
const FALLBACK: Reason = {
  why: "The stream stopped unexpectedly.",
  fix: "This usually clears on its own.",
};

export function explain(code: string): Reason {
  return REASONS.find((r) => r.match.test(code))?.reason ?? FALLBACK;
}
