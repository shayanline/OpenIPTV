import { test } from "vitest";
import assert from "node:assert/strict";
import { explain, faultPolicy } from "../src/services/errors";

/** Unknown causes stay generic while an actual HTTP response can explain the refusal. */
const cases: [string, RegExp][] = [
  ["PLAYER_ERROR_CONNECTION_FAILED", /playback is unavailable/i],
  ["PLAYER_ERROR_NOT_SUPPORTED_FILE", /playback is unavailable/i],
  ["PLAYER_ERROR_INVALID_URI", /playback is unavailable/i],
  ["manifestLoadError", /playback is unavailable/i],
  ["fragLoadTimeOut", /playback is unavailable/i],
  ["manifestParsingError", /playback is unavailable/i],
  ["TIMEOUT", /playback is unavailable/i],
  ["STREAM_ENDED", /playback is unavailable/i],
  ["NOT_SUPPORTED", /playback is unavailable/i],
  ["FINITE_FORMAT_UNSUPPORTED", /playback is unavailable/i],
  ["FINITE_SOURCE_UNAVAILABLE", /playback is unavailable/i],
  ["SEEK_UNSUPPORTED", /playback is unavailable/i],
  ["SEEK_FAILED InvalidStateError", /playback is unavailable/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 401)", /access.*denied/i],
  ["manifestLoadError (http 401)", /access.*denied/i],
  ["FINITE_FORMAT_UNSUPPORTED (http 401)", /access.*denied/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 403)", /access.*denied/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 451)", /access.*denied/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 404)", /playback is unavailable/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 502)", /server returned an error/i],
];

for (const [code, expected] of cases) {
  test(`${code} is explained`, () => {
    const { why } = explain(code);
    assert.match(why, expected);
  });
}

test("an unknown code reports unavailable playback without guessing its cause", () => {
  assert.equal(explain("SOME_FUTURE_CODE_42").whyKey, "error.playbackUnavailable");
});

test("no explanation leaks a raw engine code into the prose", () => {
  for (const [code] of cases) {
    const { why } = explain(code);
    assert.ok(!why.includes(code), `${code} appeared in its own explanation`);
  }
});

test.each(["401", "403", "451"])(
  "HTTP %s reports denied access without a suggested cause",
  (code) => {
    const { why, whyKey } = explain(code);
    assert.equal(whyKey, "error.accessDenied");
    assert.doesNotMatch(why, /network|country|password|expired|format|try|check/i);
  },
);

/** Recovery policy remains independent of the generic display text. */
const terminalCodes = [
  "PLAYER_ERROR_CONNECTION_FAILED (http 401)",
  "PLAYER_ERROR_CONNECTION_FAILED (http 403)",
  "PLAYER_ERROR_CONNECTION_FAILED (http 451)",
  "PLAYER_ERROR_CONNECTION_FAILED (http 404)",
  "PLAYER_ERROR_INVALID_URI",
  "PLAYER_ERROR_NO_SUCH_FILE",
  "PLAYER_ERROR_NOT_SUPPORTED_FILE",
  "manifestParsingError",
  "manifestIncompatible",
  "FINITE_FORMAT_UNSUPPORTED",
  "FINITE_SOURCE_UNAVAILABLE",
];

for (const code of terminalCodes) {
  test(`${code} is terminal and earns no corrective step`, () => {
    const policy = faultPolicy(code);
    assert.equal(policy.terminal, true);
    assert.equal(policy.compatibility, false);
    assert.equal(policy.httpFallback, false);
  });
}

const recoverableCodes = [
  "PLAYER_ERROR_CONNECTION_FAILED",
  "TIMEOUT",
  "PLAYER_ERROR_CONNECTION_FAILED (http 502)",
  "STREAM_ENDED",
  "STALLED",
  "fragLoadTimeOut",
];

for (const code of recoverableCodes) {
  test(`${code} stays eligible for recovery`, () => {
    assert.equal(faultPolicy(code).terminal, false);
  });
}

test("HTTP fallback covers connection and decoding faults but not stalls or stream ends", () => {
  assert.equal(faultPolicy("PLAYER_ERROR_CONNECTION_FAILED").httpFallback, true);
  assert.equal(faultPolicy("manifestLoadError").httpFallback, true);
  assert.equal(faultPolicy("TIMEOUT").httpFallback, true);
  assert.equal(faultPolicy("STALLED").httpFallback, false);
  assert.equal(faultPolicy("STREAM_ENDED").httpFallback, false);
});
