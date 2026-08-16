import assert from "node:assert/strict";
import { test, vi } from "vitest";
import type HlsType from "hls.js";
import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
  PlaylistLoaderContext,
} from "hls.js";
import { createRepairingPlaylistLoader } from "../src/services/browserRepair";

const SOURCE = "https://host.example/live/index.m3u8";
const stats = {} as LoaderStats;

const playlist = (sequence: number, segments: string[]) => {
  const lines = ["#EXTM3U", "#EXT-X-TARGETDURATION:2", `#EXT-X-MEDIA-SEQUENCE:${sequence}`];
  for (const segment of segments) lines.push("#EXTINF:2.0,", segment);
  return `${lines.join("\n")}\n`;
};

class FakeLoader {
  static instances: FakeLoader[] = [];
  text = "";
  stats = stats;

  constructor(_config: HlsConfig) {
    FakeLoader.instances.push(this);
  }

  load(
    context: PlaylistLoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<PlaylistLoaderContext>,
  ) {
    callbacks.onSuccess({ url: context.url, data: this.text }, this.stats, context, null);
  }

  abort() {}
  destroy() {}
  getCacheAge() { return null; }
  getResponseHeader() { return null; }
}

const fakeHls = {
  DefaultConfig: { loader: FakeLoader },
} as unknown as typeof HlsType;

const context = { url: SOURCE, type: "level" } as PlaylistLoaderContext;
const config = {} as LoaderConfiguration;
const hlsConfig = {} as HlsConfig;

test("repairs each live manifest refresh and keeps the repaired sequence moving", () => {
  const Loader = createRepairingPlaylistLoader(fakeHls);
  const loader = new Loader(hlsConfig);
  const base = FakeLoader.instances[0];
  const onSuccess = vi.fn();
  const callbacks = {
    onSuccess,
    onError: vi.fn(),
    onTimeout: vi.fn(),
  } as unknown as LoaderCallbacks<PlaylistLoaderContext>;

  base.text = playlist(1786136377905810, ["a.ts", "b.ts", "c.ts"]);
  loader.load(context, config, callbacks);
  base.text = playlist(1786136377905816, ["b.ts", "c.ts", "d.ts"]);
  loader.load(context, config, callbacks);

  const first = onSuccess.mock.calls[0][0].data as string;
  const second = onSuccess.mock.calls[1][0].data as string;
  assert.match(first, /#EXT-X-MEDIA-SEQUENCE:0/);
  assert.match(second, /#EXT-X-MEDIA-SEQUENCE:1/);
  assert.match(second, /https:\/\/host\.example\/live\/d\.ts/);
  assert.equal(onSuccess.mock.calls[0][0].url, SOURCE);
});

test("passes a healthy manifest through unchanged", () => {
  FakeLoader.instances = [];
  const Loader = createRepairingPlaylistLoader(fakeHls);
  const loader = new Loader(hlsConfig);
  const base = FakeLoader.instances[0];
  const healthy = playlist(42, ["a.ts"]);
  base.text = healthy;
  const onSuccess = vi.fn();
  const callbacks = {
    onSuccess,
    onError: vi.fn(),
    onTimeout: vi.fn(),
  } as unknown as LoaderCallbacks<PlaylistLoaderContext>;

  loader.load(context, config, callbacks);

  assert.equal(onSuccess.mock.calls[0][0].data, healthy);
});