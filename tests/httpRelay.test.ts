import { expect, test } from "vitest";
import {
  blockedHttpRelayHost,
  resolveHttpRelayTarget,
  rewriteHttpManifest,
} from "../scripts/http-relay.mjs";

test("HTTP relay blocks local and private literal hosts", () => {
  expect(blockedHttpRelayHost("localhost")).toBe(true);
  expect(blockedHttpRelayHost("127.0.0.1")).toBe(true);
  expect(blockedHttpRelayHost("10.0.0.2")).toBe(true);
  expect(blockedHttpRelayHost("172.20.0.2")).toBe(true);
  expect(blockedHttpRelayHost("192.168.1.2")).toBe(true);
  expect(blockedHttpRelayHost("media.example.com")).toBe(false);
});

test("HTTP relay rejects DNS names with any private resolution", async () => {
  const target = new URL("http://media.example.com/video.mp4");
  expect(
    await resolveHttpRelayTarget(target, async () => [
      { address: "203.0.113.10", family: 4 },
      { address: "192.168.1.10", family: 4 },
    ]),
  ).toBeNull();
  expect(
    await resolveHttpRelayTarget(target, async () => [{ address: "203.0.113.10", family: 4 }]),
  ).toEqual({ address: "203.0.113.10", family: 4 });
});

test("HTTP relay rewrites HLS segments and keys through the local endpoint", () => {
  const source = new URL("http://media.example.com/live/master.m3u8?token=secret");
  const rewritten = rewriteHttpManifest(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\nvariant/playlist.m3u8\nhttps://secure.example.com/segment.ts',
    source,
  );

  expect(rewritten).toContain(
    `/__openiptv_http_relay__?url=${encodeURIComponent("http://media.example.com/live/keys/key.bin")}`,
  );
  expect(rewritten).toContain(
    `/__openiptv_http_relay__?url=${encodeURIComponent("http://media.example.com/live/variant/playlist.m3u8")}`,
  );
  expect(rewritten).toContain("https://secure.example.com/segment.ts");
});
