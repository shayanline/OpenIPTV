import { test } from "vitest";
import assert from "node:assert/strict";
import { checkPlaylistUrl, nameFromUrl } from "../src/services/playlistUrl";

/**
 * The point of these is the line between the two kinds of wrong. An address that cannot
 * possibly work should be refused at once, and an address that merely looks unusual should
 * be allowed through to fail honestly, because guessing which hosts are real is not this
 * function's business.
 */

const accepted = [
  "https://example.com/list.m3u",
  "http://example.com/list.m3u8",
  "https://example.com/api/playlist?user=a&pass=b",
  "https://10.0.0.5:8080/get.php?type=m3u_plus",
  "https://sub.domain.example.co.uk/a/b/c",
  // No file extension at all: plenty of providers serve a playlist straight off a path.
  "https://example.com/playlist",
];

for (const url of accepted) {
  test(`accepts ${url}`, () => assert.equal(checkPlaylistUrl(url).ok, true));
}

const refused: [string, RegExp][] = [
  ["", /enter the address/i],
  ["   ", /enter the address/i],
  ["test", /http:\/\/ or https:\/\//],
  ["example.com/list.m3u", /http:\/\/ or https:\/\//],
  ["ftp://example.com/list.m3u", /http and https/i],
  ["file:///Users/me/list.m3u", /http and https/i],
  ["https://localhost/list.m3u", /missing a domain/i],
  ["https://", /not a complete web address|missing a domain/i],
];

for (const [url, expected] of refused) {
  test(`refuses ${JSON.stringify(url)}`, () => {
    const { ok, problem } = checkPlaylistUrl(url);
    assert.equal(ok, false);
    assert.match(problem, expected);
  });
}

test("every refusal says what to do about it, not just that it is wrong", () => {
  for (const [url] of refused) {
    const { problem } = checkPlaylistUrl(url);
    assert.ok(problem.length > 12, `${url} was refused with only "${problem}"`);
    // Ends in a full stop, or in the example it is pointing at, such as "https://".
    assert.ok(/[.:/]$/.test(problem), `${url} was refused without a finished thought`);
  }
});

test("surrounding whitespace is forgiven rather than rejected", () => {
  assert.equal(checkPlaylistUrl("  https://example.com/a.m3u  ").ok, true);
});

test("a name is taken from the file, then the host", () => {
  assert.equal(nameFromUrl("https://example.com/lists/my-channels.m3u"), "my channels");
  assert.equal(nameFromUrl("https://www.example.com/"), "example.com");
  assert.equal(nameFromUrl("nonsense"), "Untitled");
});
