import { test } from "vitest";
import assert from "node:assert/strict";
import {
  checkPlaylistUrl,
  m3uSource,
  nameFromUrl,
  parseXtreamPlaylistUrl,
  parseXtreamTemplateUrl,
  sourceDisplay,
  type XtreamSource,
  xtreamFromServerField,
  xtreamSource,
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

test("saved Xtream addresses are parsed into typed credentials with defaults", () => {
  assert.deepEqual(
    parseXtreamPlaylistUrl(
      "https://provider.example:8443/portal/get.php?username=user+name&password=p%26ss",
    ),
    {
      kind: "xtream",
      server: "https://provider.example:8443/portal",
      username: "user name",
      password: "p&ss",
      output: "ts",
    },
  );
  assert.deepEqual(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=mpegts",
    ),
    {
      kind: "xtream",
      server: "https://provider.example",
      username: "user",
      password: "pass",
      output: "ts",
    },
  );
  assert.equal(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&password=pass&type=m3u&output=ts",
    ),
    null,
  );
  assert.equal(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&password=pass&type=m3u_plus&output=rtmp",
    ),
    null,
  );
  assert.equal(
    parseXtreamPlaylistUrl(
      "https://provider.example/get.php?username=user&password=pass&type=enigma22",
    ),
    null,
  );
});

test("a watermark in front of the host is noise, and the query login is kept", () => {
  const watermarked =
    "http://listshare@watermarked.example:80/get.php?username=viewer&password=secret&type=m3u";
  const parsed = {
    kind: "xtream",
    server: "http://watermarked.example",
    username: "viewer",
    password: "secret",
    output: "m3u8",
  } as const;
  assert.deepEqual(parseXtreamTemplateUrl(watermarked, "m3u8"), parsed);
  /* This one carries type=m3u, which the silent migration refuses: it is only ever
     offered as a question in the form. */
  assert.equal(parseXtreamPlaylistUrl(watermarked, "m3u8"), null);

  assert.deepEqual(
    parseXtreamTemplateUrl(
      "http://listshare@watermarked.example:8080/get.php?username=viewer&password=secret&type=m3u_plus&output=m3u8",
      "m3u8",
    ),
    {
      kind: "xtream",
      server: "http://watermarked.example:8080",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    },
  );
});

test("typed source builders reject malformed input", () => {
  assert.deepEqual(m3uSource(" https://example.com/list.m3u "), {
    kind: "m3u",
    url: "https://example.com/list.m3u",
  });
  assert.equal(m3uSource("not an address"), null);
  assert.deepEqual(xtreamSource("https://provider.example", " viewer ", "p& ss+", "m3u8"), {
    kind: "xtream",
    server: "https://provider.example",
    username: "viewer",
    password: "p& ss+",
    output: "m3u8",
  });
  assert.equal(xtreamSource("not a server", "viewer", "secret", "m3u8"), null);
  assert.equal(xtreamSource("https://provider.example", "", "secret", "m3u8"), null);
  assert.equal(
    xtreamSource("https://embedded:credential@provider.example", "viewer", "secret", "m3u8"),
    null,
  );
});

test("typed sources display without exposing credentials", () => {
  const source = xtreamSource(
    "https://provider.example/portal",
    "viewer+name",
    "p& ss+",
    "m3u8",
  );
  assert.ok(source);
  assert.equal(sourceDisplay(source), "https://provider.example/portal");
  assert.equal(
    sourceDisplay({ kind: "m3u", url: "https://example.com/list.m3u" }),
    "https://example.com/list.m3u",
  );
});

test("type=m3u is offered in the form but never converted silently", () => {
  const address =
    "https://provider.example/get.php?username=user&password=pass&type=m3u&output=ts";
  assert.deepEqual(parseXtreamTemplateUrl(address), {
    kind: "xtream",
    server: "https://provider.example",
    username: "user",
    password: "pass",
    output: "ts",
  });
  /* The migration converts a saved playlist without being asked, and the Xtream path
     talks only to player_api.php, so an explicit type=m3u stays cautious: a panel serving
     get.php alone would otherwise lose a playlist that works today. */
  assert.equal(parseXtreamPlaylistUrl(address), null);
});

test("a credential-less Xtream template parses, while the strict parse still refuses it", () => {
  const template =
    "http://template.example/get.php?username=&password=&type=m3u_plus&output=m3u8";
  assert.deepEqual(parseXtreamTemplateUrl(template, "m3u8"), {
    kind: "xtream",
    server: "http://template.example",
    username: "",
    password: "",
    output: "m3u8",
  });
  // Saved playlists migrate through the strict parse, which a template must not satisfy.
  assert.equal(parseXtreamPlaylistUrl(template, "m3u8"), null);
});

test("the server field folds a pasted address in without eating typed credentials", () => {
  const current: XtreamSource = {
    kind: "xtream",
    server: "https://provider.example",
    username: "viewer",
    password: "secret",
    output: "ts",
  };
  assert.deepEqual(
    xtreamFromServerField(
      current,
      "http://template.example/get.php?username=&password=&type=m3u_plus&output=m3u8",
    ),
    {
      kind: "xtream",
      server: "http://template.example",
      username: "viewer",
      password: "secret",
      output: "m3u8",
    },
  );
  assert.deepEqual(
    xtreamFromServerField(
      current,
      "https://new.example/get.php?username=u&password=p&type=m3u_plus",
    ),
    {
      kind: "xtream",
      server: "https://new.example",
      username: "u",
      password: "p",
      output: "ts",
    },
  );
  assert.equal(xtreamFromServerField(current, "https://new.example/get.php").output, "ts");
  assert.deepEqual(xtreamFromServerField(current, "not an address"), {
    ...current,
    server: "not an address",
  });
  /* A pasted address carrying a watermark and its own credentials replaces what was
     typed. */
  assert.deepEqual(
    xtreamFromServerField(
      current,
      "http://listshare@watermarked.example/get.php?username=viewer&password=secret&type=m3u",
    ),
    {
      kind: "xtream",
      server: "http://watermarked.example",
      username: "viewer",
      password: "secret",
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
});
