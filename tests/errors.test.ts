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

test("a geo block is not blamed on the viewer's network", () => {
  assert.match(explain("403").why, /not allowing/i);
});
