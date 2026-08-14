import { test } from "vitest";
import assert from "node:assert/strict";
import { explain } from "../src/services/errors";

/**
 * Checklist 4.6 asks a failure to say why it happened and what to do about it. These pin
 * the codes each engine actually emits to an answer, so a message cannot quietly rot into
 * the catch-all when a code changes.
 */
const cases: [string, RegExp][] = [
  // AVPlay, on the TV
  ["PLAYER_ERROR_CONNECTION_FAILED", /could not reach/i],
  ["PLAYER_ERROR_NOT_SUPPORTED_FILE", /cannot decode/i],
  ["PLAYER_ERROR_INVALID_URI", /no longer points/i],
  // hls.js, in a browser
  ["manifestLoadError", /could not reach/i],
  ["fragLoadTimeOut", /could not reach/i],
  ["manifestParsingError", /cannot decode/i],
  // Ours
  ["TIMEOUT", /could not reach/i],
  ["STREAM_ENDED", /stopped broadcasting/i],
  ["NOT_SUPPORTED", /nothing playable/i],
  /*
   * The status the server sent, which the TV reports separately from the fault and the player
   * joins onto it. These have to beat the engine's own name for the failure, because a refusal
   * and a dead host both arrive as CONNECTION_FAILED and only the status can tell them apart.
   */
  ["PLAYER_ERROR_CONNECTION_FAILED (http 403)", /refusing this connection/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 451)", /refusing this connection/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 404)", /no longer points/i],
  ["PLAYER_ERROR_CONNECTION_FAILED (http 502)", /server is failing/i],
];

for (const [code, expected] of cases) {
  test(`${code} is explained`, () => {
    const { why, fix } = explain(code);
    assert.match(why, expected);
    assert.ok(fix.length > 0, "every cause needs a remedy");
  });
}

test("an unknown code still gets a cause and a remedy rather than nothing", () => {
  const { why, fix } = explain("SOME_FUTURE_CODE_42");
  assert.ok(why.length > 0);
  assert.ok(fix.length > 0);
});

test("no explanation leaks a raw engine code into the prose", () => {
  for (const [code] of cases) {
    const { why, fix } = explain(code);
    assert.ok(!`${why} ${fix}`.includes(code), `${code} appeared in its own explanation`);
  }
});

test("a refusal is blamed on the broadcaster rather than on the viewer's network", () => {
  /*
   * The point of this one is the blame, not the wording, which is why it no longer pins the
   * sentence: it asked for "not allowing" and failed the day that became "refusing", which
   * taught nobody anything. A viewer told to check their network over a 403 goes and reboots a
   * router for a channel that was never going to play.
   */
  const { why, fix } = explain("403");
  assert.match(why, /broadcaster/i);
  assert.ok(!/network|could not reach/i.test(`${why} ${fix}`), `blamed the network: ${why} ${fix}`);
});
