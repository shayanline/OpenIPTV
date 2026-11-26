import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
import { host, XTREAM_FIXTURE, xtreamFixtureResponse } from "../scripts/present.mjs";
import {
  benchmarkResult,
  createJourneyTracker,
  createXtreamJourneyTracker,
  driver,
  evaluationValue,
  pageResult,
  REDESIGN_JOURNEYS,
  serve,
  VOD_CATEGORY_READY,
  XTREAM_JOURNEYS,
} from "../scripts/tv/harness.mjs";

const get = (port: number, path: string) =>
  new Promise<{ body: string; status: number }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ body, status: response.statusCode ?? 0 }));
    });
    req.on("error", reject);
    req.end();
  });

test("lets the operating system assign the fixture server port", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-harness-test-"));
  writeFileSync(join(root, "index.html"), "ready");
  const hosted = await serve(root);
  try {
    assert.ok(Number.isInteger(hosted.port) && hosted.port > 0);
    assert.equal(typeof hosted.close, "function");
    assert.equal(
      await fetch(`http://127.0.0.1:${hosted.port}/`).then((response) => response.text()),
      "ready",
    );
  } finally {
    if (hosted.close) await hosted.close();
    else await new Promise((resolve) => hosted.server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps the fixture server inside its distribution directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-harness-test-"));
  const dist = join(root, "dist");
  mkdirSync(dist);
  writeFileSync(join(root, "secret"), "private");
  const hosted = await serve(dist);
  try {
    assert.deepEqual(await get(hosted.port, "/../secret"), { body: "not found", status: 404 });
  } finally {
    await hosted.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps the presentation server inside its distribution directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-presentation-test-"));
  const dist = join(root, "dist");
  mkdirSync(dist);
  writeFileSync(join(root, "secret"), "private");
  const server = await host(dist, 0);
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    assert.deepEqual(await get(address.port, "/../secret"), { body: "no", status: 404 });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
});

test("serves a deterministic large Xtream catalogue without credential values in responses", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-xtream-test-"));
  const server = await host(root, 0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = (action: string, extra = "") =>
    `/player_api.php?username=${encodeURIComponent(XTREAM_FIXTURE.username)}&password=${encodeURIComponent(XTREAM_FIXTURE.password)}&action=${action}${extra}`;
  try {
    const authentication = await get(
      address.port,
      `/player_api.php?username=${encodeURIComponent(XTREAM_FIXTURE.username)}&password=${encodeURIComponent(XTREAM_FIXTURE.password)}`,
    );
    const liveCategories = await get(address.port, endpoint("get_live_categories"));
    const movieCategories = await get(address.port, endpoint("get_vod_categories"));
    const seriesCategories = await get(address.port, endpoint("get_series_categories"));
    const live = await get(address.port, endpoint("get_live_streams"));
    const filteredLive = await get(
      address.port,
      endpoint("get_live_streams", "&category_id=live-duplicate-b"),
    );
    const movies = await get(
      address.port,
      endpoint("get_vod_streams", "&category_id=movie-large"),
    );
    const completeMovies = await get(address.port, endpoint("get_vod_streams"));
    const emptyMovies = await get(
      address.port,
      endpoint("get_vod_streams", "&category_id=movie-empty"),
    );
    const failedMovies = await get(
      address.port,
      endpoint("get_vod_streams", "&category_id=movie-failed"),
    );
    const series = await get(address.port, endpoint("get_series", "&category_id=series-large"));

    assert.equal(authentication.status, 200);
    assert.equal(JSON.parse(authentication.body).user_info.status, "Active");
    assert.equal(JSON.parse(live.body).length, XTREAM_FIXTURE.liveCount);
    assert.ok(JSON.parse(movies.body).length >= 500);
    assert.ok(JSON.parse(series.body).length >= 300);
    const complete = JSON.parse(completeMovies.body) as Array<Record<string, unknown>>;
    assert.equal(complete.length, XTREAM_FIXTURE.movieCount);
    assert.ok(complete.some((item) => item.name === ""));
    assert.ok(
      complete.some((item) => item.rating === "invalid" && item.rating_5based === "4.2"),
    );
    assert.ok(new Set(complete.map((item) => item.stream_id)).size < complete.length);
    assert.ok(new Set(complete.map((item) => item.name)).size < complete.length);
    assert.ok(complete.some((item) => String(item.name).includes("👨‍👩‍👧‍👦")));
    assert.deepEqual(JSON.parse(emptyMovies.body), []);
    assert.equal(failedMovies.status, 503);
    assert.ok(
      JSON.parse(filteredLive.body).every(
        (stream: { category_id: string }) => stream.category_id === "live-duplicate-b",
      ),
    );
    for (const categories of [liveCategories, movieCategories, seriesCategories]) {
      const names = JSON.parse(categories.body).map(
        (category: { category_name: string }) => category.category_name,
      );
      assert.ok(names.includes(""));
      assert.ok(new Set(names).size < names.length);
    }
    const bodies = [
      authentication,
      liveCategories,
      movieCategories,
      seriesCategories,
      live,
      filteredLive,
      movies,
      completeMovies,
      emptyMovies,
      failedMovies,
      series,
    ]
      .map(({ body }) => body)
      .join("\n");
    assert.equal(bodies.includes(XTREAM_FIXTURE.username), false);
    assert.equal(bodies.includes(XTREAM_FIXTURE.password), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
});

test("serves Xtream movie details, episodes, programme data, and finite media routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-xtream-detail-test-"));
  const server = await host(root, 0);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const endpoint = (action: string, extra: string) =>
    `/player_api.php?username=${encodeURIComponent(XTREAM_FIXTURE.username)}&password=${encodeURIComponent(XTREAM_FIXTURE.password)}&action=${action}${extra}`;
  try {
    const movie = await get(address.port, endpoint("get_vod_info", "&vod_id=movie-1"));
    const series = await get(address.port, endpoint("get_series_info", "&series_id=series-1"));
    const guide = await get(
      address.port,
      endpoint("get_short_epg", "&stream_id=live-1&limit=20"),
    );
    const live = await get(
      address.port,
      `/live/${encodeURIComponent(XTREAM_FIXTURE.username)}/${encodeURIComponent(XTREAM_FIXTURE.password)}/live-1.m3u8`,
    );
    const catchupPath = `/timeshift/${encodeURIComponent(XTREAM_FIXTURE.username)}/${encodeURIComponent(XTREAM_FIXTURE.password)}/60/2026-01-02:10-00/live-1.ts`;
    const catchup = await get(address.port, catchupPath);
    const poster = await get(address.port, "/fixture/poster/1.jpg");
    const missing = await get(address.port, "/fixture/missing.jpg");
    const undecodable = await get(address.port, "/fixture/undecodable.jpg");
    const malformed = await get(
      address.port,
      `${endpoint("get_vod_streams", "")}&fixture=malformed`,
    );
    const failed = await get(address.port, `${endpoint("get_vod_streams", "")}&fixture=failed`);

    const movieDetail = JSON.parse(movie.body);
    const seriesDetail = JSON.parse(series.body);
    const manualEpisode = seriesDetail.episodes["2"].find(
      (episode: Record<string, unknown>) => episode.title === "Episode 2.1",
    );
    const movieSource = String(movieDetail.movie_data.direct_source);
    const episodeSource = String(manualEpisode?.direct_source);
    const movieMedia = await get(address.port, movieSource);
    const episodeMedia = await get(address.port, episodeSource);
    assert.equal(movieDetail.movie_data.stream_id, "movie-1");
    assert.equal(movieSource, "/fixture/playback/movie-movie-1.mp4");
    assert.equal(episodeSource, "/fixture/playback/episode-2-1.mp4");
    assert.equal(
      new URL(movieSource, `http://127.0.0.1:${address.port}`).origin,
      `http://127.0.0.1:${address.port}`,
    );
    assert.equal(
      new URL(episodeSource, `http://127.0.0.1:${address.port}`).origin,
      `http://127.0.0.1:${address.port}`,
    );
    assert.equal(movieMedia.status, 200);
    assert.equal(movieMedia.body, "fixture finite media");
    assert.equal(episodeMedia.status, 200);
    assert.equal(episodeMedia.body, "fixture finite media");
    assert.ok(Array.isArray(movieDetail.info.backdrop_path));
    assert.ok(seriesDetail.episodes["0"].length > 0);
    assert.deepEqual(seriesDetail.episodes["4"], []);
    assert.ok(
      seriesDetail.episodes["1"].some(
        (episode: Record<string, unknown>) => !episode.id && episode.direct_source,
      ),
    );
    assert.ok(
      seriesDetail.episodes["1"].some(
        (episode: Record<string, unknown>) => !episode.episode_num,
      ),
    );
    assert.ok(seriesDetail.episodes["1"].length > 1);
    assert.ok(
      JSON.parse(guide.body).epg_listings.some(
        (item: { has_archive: number }) => item.has_archive,
      ),
    );
    assert.equal(live.status, 200);
    assert.ok(catchupPath.startsWith("/timeshift/"));
    assert.equal(catchup.status, 200);
    assert.equal(catchup.body, "fixture media");
    assert.equal(poster.status, 200);
    assert.equal(missing.status, 404);
    assert.equal(undecodable.status, 200);
    assert.equal(malformed.body, "{");
    assert.equal(failed.status, 503);
    assert.equal(movie.body.includes(XTREAM_FIXTURE.password), false);
    assert.equal(series.body.includes(XTREAM_FIXTURE.password), false);
    assert.equal(guide.body.includes(XTREAM_FIXTURE.password), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(root, { recursive: true, force: true });
  }
});

test("harness serving honours deterministic fixture delay", async () => {
  const root = mkdtempSync(join(tmpdir(), "openiptv-delay-test-"));
  writeFileSync(join(root, "index.html"), "ready");
  const hosted = await serve(root);
  try {
    const started = Date.now();
    const path = `/player_api.php?username=${encodeURIComponent(XTREAM_FIXTURE.username)}&password=${encodeURIComponent(XTREAM_FIXTURE.password)}&action=get_vod_streams&fixture=slow`;
    const response = await get(hosted.port, path);
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  } finally {
    await hosted.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("serves deterministic playback and provider fault fixtures without credentials", () => {
  const finite = xtreamFixtureResponse("/fixture/playback/finite.mp4");
  const movie = xtreamFixtureResponse("/fixture/playback/movie-movie-1.mp4");
  const episode = xtreamFixtureResponse("/fixture/playback/episode-2-1.mp4");
  const dvr = xtreamFixtureResponse("/fixture/playback/live-dvr.m3u8");
  const live = xtreamFixtureResponse("/fixture/playback/live.m3u8");
  const tracks = xtreamFixtureResponse("/fixture/playback/tracks.m3u8");
  const subtitles = xtreamFixtureResponse("/fixture/playback/subtitles.vtt");
  const failed = xtreamFixtureResponse("/fixture/playback/network-failure");
  expect(finite).toMatchObject({ status: 200, type: "video/mp4" });
  expect(movie).toMatchObject({ status: 200, type: "video/mp4" });
  expect(episode).toMatchObject({ status: 200, type: "video/mp4" });
  expect(String(dvr?.body)).toContain("PROGRAM-DATE-TIME");
  expect(String(live?.body)).not.toContain("ENDLIST");
  expect(String(tracks?.body)).toContain("TYPE=AUDIO");
  expect(String(tracks?.body)).toContain("TYPE=SUBTITLES");
  expect(String(subtitles?.body)).toContain("Fixture subtitle");
  expect(failed).toMatchObject({ status: 503 });
  const serialised = JSON.stringify([
    finite,
    movie,
    episode,
    dvr,
    live,
    tracks,
    subtitles,
    failed,
  ]);
  expect(serialised).not.toContain(XTREAM_FIXTURE.username);
  expect(serialised).not.toContain(XTREAM_FIXTURE.password);
});

test("the TV shim keeps relayed finite media out of hls.js", () => {
  const loaded: string[] = [];
  let instances = 0;
  class Hls {
    static Events = {
      ERROR: "error",
      LEVEL_SWITCHED: "level-switched",
      MANIFEST_PARSED: "manifest-parsed",
    };
    static isSupported = () => true;
    levels = [];
    constructor() {
      instances += 1;
    }
    on() {}
    loadSource(source: string) {
      loaded.push(source);
    }
    attachMedia() {}
    destroy() {}
  }
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  Object.assign(window, { Hls });
  runInNewContext(readFileSync(join(process.cwd(), "scripts/tv/shim.js"), "utf8"), {
    console,
    document,
    performance,
    setTimeout,
    URL,
    window,
  });
  const relay = (target: string) =>
    `${window.location.origin}/__openiptv_http_relay__?url=${encodeURIComponent(target)}`;
  const hls = relay("http://media.example/live/channel.m3u8");
  const movie = relay("http://media.example/movie/film.mp4");

  try {
    window.webapis?.avplay?.open(hls);
    window.webapis?.avplay?.prepareAsync(
      () => {},
      () => {},
    );
    assert.equal(instances, 1);
    assert.deepEqual(loaded, [hls]);

    window.webapis?.avplay?.stop();
    window.webapis?.avplay?.open(movie);
    window.webapis?.avplay?.prepareAsync(
      () => {},
      () => {},
    );
    assert.equal(instances, 1);
    assert.equal(document.querySelector<HTMLVideoElement>("#tv-video-el")?.src, movie);
  } finally {
    document.querySelector("#tv-video-plane")?.remove();
    document.querySelector("#tv-hide-avplayer")?.remove();
    pause.mockRestore();
    load.mockRestore();
    log.mockRestore();
    delete (window as Window & { Hls?: unknown }).Hls;
    delete window.webapis;
    delete window.tizen;
  }
});

test("the controlled TV shim exposes deterministic playback and fault controls", async () => {
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  runInNewContext(readFileSync(join(process.cwd(), "scripts/tv/shim.js"), "utf8"), {
    console,
    document,
    Event: window.Event,
    performance,
    setTimeout,
    URL,
    window,
  });
  const controls = (
    window as Window & {
      __openiptvTvFaults: {
        reset(): void;
        useControlledPlayback(): void;
        completePrepare(): void;
        startBuffering(): void;
        endBuffering(): void;
        freezePlayhead(): void;
        resumePlayhead(): void;
        nextSeek(outcome: "complete" | "omit-callback" | "reject"): void;
        emitNetworkFault(): void;
        emitMediaFault(): void;
        setLiveWindow(start: number, end: number): void;
        setHidden(hidden: boolean): void;
        snapshot(): {
          controlled: boolean;
          connections: number;
          seeks: number[];
          buffering: boolean;
          frozen: boolean;
          liveWindow: [number, number] | null;
          lastFault: string;
          hidden: boolean;
        };
      };
    }
  ).__openiptvTvFaults;
  const events: string[] = [];
  const avplay = window.webapis?.avplay;
  if (!avplay) throw new Error("AVPlay shim missing");
  avplay.setListener({
    onbufferingstart: () => events.push("start"),
    onbufferingcomplete: () => events.push("complete"),
    onerror: (name: unknown) => events.push(String(name)),
  });
  controls.useControlledPlayback();
  avplay.open("fixture:controlled");
  let prepared = false;
  avplay.prepareAsync(
    () => {
      prepared = true;
    },
    () => {},
  );
  expect(prepared).toBe(false);
  controls.completePrepare();
  expect(prepared).toBe(true);
  avplay.play();
  controls.startBuffering();
  expect(controls.snapshot().buffering).toBe(true);
  controls.endBuffering();
  controls.freezePlayhead();
  const frozenAt = avplay.getCurrentTime!();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(avplay.getCurrentTime!()).toBe(frozenAt);
  controls.resumePlayhead();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(avplay.getCurrentTime!()).toBeGreaterThan(frozenAt);
  let completed = false;
  controls.nextSeek("complete");
  avplay.seekTo!(
    10_000,
    () => {
      completed = true;
    },
    () => {},
  );
  expect(completed).toBe(true);
  let omitted = false;
  controls.nextSeek("omit-callback");
  avplay.seekTo!(
    20_000,
    () => {
      omitted = true;
    },
    () => {},
  );
  expect(omitted).toBe(false);
  let rejected = false;
  controls.nextSeek("reject");
  avplay.seekTo!(
    30_000,
    () => {},
    () => {
      rejected = true;
    },
  );
  expect(rejected).toBe(true);
  controls.setLiveWindow(40_000, 100_000);
  expect(avplay.getStreamingProperty!("GET_LIVE_DURATION")).toBe("40000|100000");
  controls.emitNetworkFault();
  controls.emitMediaFault();
  controls.setHidden(true);
  expect(document.hidden).toBe(true);
  expect(controls.snapshot()).toMatchObject({
    controlled: true,
    connections: 1,
    seeks: [10_000, 20_000, 30_000],
    buffering: false,
    frozen: false,
    liveWindow: [40_000, 100_000],
    lastFault: "PLAYER_ERROR_NOT_SUPPORTED_FILE",
    hidden: true,
  });
  expect(events).toContain("PLAYER_ERROR_CONNECTION_FAILED");
  avplay.stop();
  avplay.open("fixture:pending");
  let cancelledPrepare = "";
  avplay.prepareAsync(
    () => {},
    (error) => {
      cancelledPrepare = String(error);
    },
  );
  controls.reset();
  expect(cancelledPrepare).toBe("PLAYER_ERROR_OPERATION_ABORTED");
  expect(controls.snapshot()).toEqual({
    controlled: false,
    connections: 0,
    seeks: [],
    buffering: false,
    frozen: false,
    liveWindow: null,
    lastFault: "",
    hidden: false,
  });

  for (const source of [
    "http://127.0.0.1:4174/fixture/playback/movie-movie-1.mp4",
    "http://127.0.0.1:4174/movie/viewer/secret/movie-1.mp4",
    "http://127.0.0.1:4174/series/viewer/secret/episode-2-1.mp4",
    "http://127.0.0.1:4174/timeshift/viewer/secret/60/2026-01-02:10-00/live-1.ts",
  ]) {
    avplay.open(source);
    expect(controls.snapshot()).toMatchObject({ controlled: true, connections: 1 });
    controls.reset();
  }

  avplay.open("http://127.0.0.1:4174/fixture/playback/episode-2-1.mp4");
  let episodePrepared = false;
  avplay.prepareAsync(
    () => {
      episodePrepared = true;
    },
    () => {},
  );
  expect(controls.snapshot()).toMatchObject({ controlled: true, connections: 1 });
  expect(avplay.getCurrentTime!()).toBe(0);
  expect(episodePrepared).toBe(false);
  controls.completePrepare();
  expect(episodePrepared).toBe(true);
  expect(avplay.getCurrentTime!()).toBe(0);
  controls.reset();

  const eventCount = events.length;
  controls.emitNetworkFault();
  expect(events).toHaveLength(eventCount);
  pause.mockRestore();
  load.mockRestore();
  log.mockRestore();
  delete window.webapis;
  delete window.tizen;
  delete (window as Window & { __openiptvTvFaults?: unknown }).__openiptvTvFaults;
});

test("reports page evaluation exceptions instead of returning undefined", () => {
  assert.throws(
    () =>
      evaluationValue(
        {
          result: { type: "object" },
          exceptionDetails: {
            text: "Uncaught",
            exception: { description: "TypeError: window.__bench is undefined" },
          },
        },
        "surfing channels",
      ),
    /surfing channels failed in the page: TypeError: window\.__bench is undefined/,
  );
});

test("reports missing benchmark state instead of parsing undefined", () => {
  assert.throws(
    () => benchmarkResult(undefined, "surfing channels"),
    /surfing channels: benchmark state was unavailable because CDP returned undefined/,
  );
  assert.throws(
    () =>
      benchmarkResult(
        JSON.stringify({
          url: "http://127.0.0.1:4173/",
          readyState: "loading",
          benchmark: "undefined",
        }),
        "surfing channels",
      ),
    /benchmark recorder was undefined.*document was loading/,
  );
  assert.deepEqual(
    benchmarkResult(
      JSON.stringify({
        url: "http://127.0.0.1:4173/",
        readyState: "complete",
        benchmark: "object",
        result: { median: 40, of: 20 },
      }),
      "surfing channels",
    ),
    { median: 40, of: 20 },
  );
});

test("reports missing measured page state with document context", () => {
  assert.throws(
    () => pageResult(undefined, "category landing state"),
    /category landing state: page state was unavailable because CDP returned undefined/,
  );
  assert.throws(
    () =>
      pageResult(
        JSON.stringify({
          url: "http://127.0.0.1:4173/",
          readyState: "complete",
        }),
        "category landing state",
      ),
    /category landing state: page state returned no value at http:\/\/127\.0\.0\.1:4173\/ while the document was complete/,
  );
  assert.deepEqual(
    pageResult(
      JSON.stringify({
        url: "http://127.0.0.1:4173/",
        readyState: "complete",
        result: { cursor: "News", showing: "Sport" },
      }),
      "category landing state",
    ),
    { cursor: "News", showing: "Sport" },
  );
});

test("fails a simulator run when a required redesign journey does not complete", () => {
  const tracker = createJourneyTracker(Object.values(REDESIGN_JOURNEYS));
  for (const label of Object.values(REDESIGN_JOURNEYS).slice(0, -1)) tracker.complete(label);
  assert.throws(() => tracker.assertComplete(), /Poster interaction budget/);
  assert.throws(() => tracker.complete("invented journey"), /Unknown or repeated journey/);
});

test("fails a simulator run when a real Xtream journey does not complete", () => {
  const tracker = createXtreamJourneyTracker();
  for (const label of Object.values(XTREAM_JOURNEYS).slice(0, -1)) tracker.complete(label);
  assert.throws(() => tracker.assertComplete(), /VOD heap growth/);
  assert.throws(() => tracker.complete("invented journey"), /Unknown or repeated journey/);
});

test("the simulator uses every authoritative Xtream journey label", () => {
  const source = readFileSync(join(process.cwd(), "scripts/tv/sim.mjs"), "utf8");
  for (const key of Object.keys(XTREAM_JOURNEYS)) {
    assert.ok(
      source.includes(`XTREAM_JOURNEYS.${key}`),
      `${key} is not wired into the simulator`,
    );
  }
});

test("every redesign journey is wired to an asserted television action", () => {
  const harness = readFileSync(join(process.cwd(), "scripts/tv/harness.mjs"), "utf8");
  const simulator = readFileSync(join(process.cwd(), "scripts/tv/sim.mjs"), "utf8");
  for (const key of Object.keys(REDESIGN_JOURNEYS)) {
    assert.ok(
      harness.includes(`REDESIGN_JOURNEYS.${key}`) ||
        simulator.includes(`REDESIGN_JOURNEYS.${key}`),
      `${key} is not wired into a television journey`,
    );
  }
  assert.ok(harness.includes("redesign.assertComplete()"));
  assert.ok(simulator.includes("redesignJourneys.assertComplete()"));
  assert.ok(simulator.includes("[data-recovery-cause]"));
  assert.ok(simulator.includes("recoveryConnections"));
  assert.equal(simulator.includes("webapis.avplay.setListener"), false);
});

test("the parity and budget walks share the authoritative lineup journey", () => {
  const harness = readFileSync(join(process.cwd(), "scripts/tv/harness.mjs"), "utf8");
  const simulator = readFileSync(join(process.cwd(), "scripts/tv/sim.mjs"), "utf8");
  assert.equal(XTREAM_JOURNEYS.lineupManagement, "Xtream lineup management");
  assert.ok(harness.includes("XTREAM_JOURNEYS.lineupManagement"));
  assert.ok(simulator.includes("XTREAM_JOURNEYS.lineupManagement"));
  assert.ok(harness.includes("openiptv-personal"));
  assert.ok(simulator.includes("openiptv-personal"));
  assert.equal(harness.includes("indexedDB.deleteDatabase('openiptv-personal')"), false);
});

test("VOD category readiness waits for the committed pane while the rail owns focus", () => {
  let focused = true;
  let selected = true;
  let busy: string | null = "true";
  const pane = { getAttribute: () => busy };
  const rail = { querySelector: () => (selected ? {} : null) };
  const document = {
    querySelector: (selector: string) =>
      selector.endsWith(".vod-pane") ? pane : focused ? rail : null,
  };
  const ready = () => runInNewContext(VOD_CATEGORY_READY, { document });
  assert.equal(ready(), false);
  busy = "false";
  assert.equal(ready(), true);
  focused = false;
  assert.equal(ready(), false);
  focused = true;
  selected = false;
  assert.equal(ready(), false);
  selected = true;
  busy = null;
  assert.equal(ready(), false);
});

test("installs the fixture seed before navigating to the application", async () => {
  const calls: string[] = [];
  const cdp = {
    async send(method: string) {
      calls.push(method);
      return method === "Runtime.evaluate" ? { result: { value: true } } : {};
    },
  };
  await driver(cdp, 4321).open();
  const seeded = calls.indexOf("Page.addScriptToEvaluateOnNewDocument");
  assert.ok(seeded >= 0 && seeded < calls.indexOf("Page.navigate"));
});

test("the parity driver configures M3U before it changes to Xtream", async () => {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const cdp = {
    async send(method: string, params?: Record<string, unknown>) {
      calls.push({ method, params });
      return method === "Runtime.evaluate" ? { result: { value: true } } : {};
    },
  };
  const d = driver(cdp, 4321);
  await d.open();
  await d.openXtream();

  const initialSeed = calls.find(
    ({ method }) => method === "Page.addScriptToEvaluateOnNewDocument",
  )?.params?.source;
  const transition = calls.find(
    ({ method, params }) =>
      method === "Runtime.evaluate" && String(params?.expression).includes("fixture-viewer"),
  )?.params?.expression;
  assert.match(String(initialSeed), /playlist\.m3u/);
  assert.match(String(initialSeed), /kind: "m3u"/);
  assert.match(String(transition), /kind: "xtream"/);
  assert.ok(calls.some(({ method }) => method === "Page.reload"));
});

test("waits for a requested key transition instead of sleeping", async () => {
  let ready = false;
  const cdp = {
    async send(method: string, params: { type?: string } = {}) {
      if (method === "Input.dispatchKeyEvent" && params.type === "keyUp") {
        setTimeout(() => {
          ready = true;
        }, 200);
      }
      if (method === "Runtime.evaluate") return { result: { value: ready } };
      return {};
    },
  };
  await driver(cdp, 4321).press("ArrowLeft", 37, "window.ready");
  assert.equal(ready, true);
});

test("shows both Smart Remote pages in the README screenshot", () => {
  const image = readFileSync(join(process.cwd(), "docs/screenshots/10-smart-remote.png"));
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [820, 900]);
});
