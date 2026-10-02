import { test } from "vitest";
import assert from "node:assert/strict";
import {
  checkPlaylistUrl,
  nameFromUrl,
  parseXtreamPlaylistUrl,
  redactPlaylistUrl,
  xtreamPlaylistUrl,
} from "../src/services/playlistUrl";

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

test("a refusal includes a locale key for the interface", () => {
  assert.equal(checkPlaylistUrl("").problemKey, "validation.enterAddress");
});

test("surrounding whitespace is forgiven rather than rejected", () => {
  assert.equal(checkPlaylistUrl("  https://example.com/a.m3u  ").ok, true);
});

test("a name is taken from the file, then the host", () => {
  assert.equal(nameFromUrl("https://example.com/lists/my-channels.m3u"), "my channels");
  assert.equal(nameFromUrl("https://www.example.com/"), "example.com");
  assert.equal(
    nameFromUrl("https://provider.example/get.php?username=user&password=pass"),
    "provider.example",
  );
  assert.equal(nameFromUrl("nonsense"), "Untitled");
});

test("Xtream credentials become an encoded M3U Plus address", () => {
  assert.equal(
    xtreamPlaylistUrl(" https://provider.example:8443/portal/ ", "user name", "p&ss", "m3u8"),
    "https://provider.example:8443/portal/get.php?username=user+name&password=p%26ss&type=m3u_plus&output=m3u8",
  );
});

test("Xtream usernames are trimmed while password whitespace and plus signs are preserved", () => {
  assert.equal(
    xtreamPlaylistUrl("https://provider.example", "  viewer  ", " secret+ pass ", "m3u8"),
    "https://provider.example/get.php?username=viewer&password=+secret%2B+pass+&type=m3u_plus&output=m3u8",
  );
});

test("an existing Xtream endpoint is reused and MPEG TS remains available", () => {
  assert.equal(
    xtreamPlaylistUrl("http://provider.example/get.php?old=1", "user", "pass", "ts"),
    "http://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=ts",
  );
});

test("incomplete Xtream credentials do not produce a playlist address", () => {
  assert.equal(xtreamPlaylistUrl("https://provider.example", "", "pass", "m3u8"), "");
  assert.equal(xtreamPlaylistUrl("not a server", "user", "pass", "m3u8"), "");
});

test("saved Xtream addresses are parsed back into editable credentials", () => {
  assert.deepEqual(
    parseXtreamPlaylistUrl(
      "https://provider.example:8443/portal/get.php?username=user+name&password=p%26ss&type=m3u_plus&output=ts",
    ),
    {
      server: "https://provider.example:8443/portal",
      username: "user name",
      password: "p&ss",
      output: "ts",
    },
  );
});

test("nonstandard and incomplete addresses stay in the M3U editor", () => {
  assert.equal(parseXtreamPlaylistUrl("https://example.com/list.m3u"), null);
  assert.equal(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&type=m3u_plus&output=m3u8",
    ),
    null,
  );
  assert.equal(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=rtmp",
    ),
    null,
  );
});

test("saved playlist summaries hide Xtream passwords", () => {
  assert.equal(
    redactPlaylistUrl(
      "https://provider.example/get.php?username=user&password=secret&type=m3u_plus&output=m3u8",
    ),
    "https://provider.example/get.php?username=user&password=••••••••&type=m3u_plus&output=m3u8",
  );
  assert.equal(
    redactPlaylistUrl("https://example.com/list.m3u"),
    "https://example.com/list.m3u",
  );
});
