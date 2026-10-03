import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { host, XTREAM_FIXTURE } from "../scripts/present.mjs";
import {
  createXtreamJourneyTracker,
  driver,
  serve,
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
    const emptyMovies = await get(
      address.port,
      endpoint("get_vod_streams", "&category_id=movie-empty"),
    );
    const series = await get(address.port, endpoint("get_series", "&category_id=series-large"));

    assert.equal(authentication.status, 200);
    assert.equal(JSON.parse(authentication.body).user_info.status, "Active");
    assert.equal(JSON.parse(live.body).length, XTREAM_FIXTURE.liveCount);
    assert.ok(JSON.parse(movies.body).length >= 500);
    assert.ok(JSON.parse(series.body).length >= 300);
    assert.deepEqual(JSON.parse(emptyMovies.body), []);
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
      emptyMovies,
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
    const catchup = await get(
      address.port,
      `/timeshift/${encodeURIComponent(XTREAM_FIXTURE.username)}/${encodeURIComponent(XTREAM_FIXTURE.password)}/60/2026-01-02:10-00/live-1.ts`,
    );

    assert.equal(JSON.parse(movie.body).movie_data.stream_id, "movie-1");
    assert.ok(JSON.parse(series.body).episodes["1"].length > 1);
    assert.ok(
      JSON.parse(guide.body).epg_listings.some(
        (item: { has_archive: number }) => item.has_archive,
      ),
    );
    assert.equal(live.status, 200);
    assert.equal(catchup.status, 200);
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

test("fails a simulator run when a real Xtream journey does not complete", () => {
  const tracker = createXtreamJourneyTracker();
  for (const label of Object.values(XTREAM_JOURNEYS).slice(0, -1)) tracker.complete(label);
  assert.throws(() => tracker.assertComplete(), /Xtream heap growth/);
  assert.throws(() => tracker.complete("invented journey"), /Unknown Xtream journey/);
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
