import { beforeEach, expect, test, vi } from "vitest";
import type { XtreamSource } from "../src/services/playlistUrl";
import type { Playlist } from "../src/stores/settings";
import type { Channel } from "../src/types";

const source: XtreamSource = {
  kind: "xtream",
  server: "http://provider.example",
  username: "viewer",
  password: "secret",
  output: "m3u8",
};

const playlist: Playlist = {
  id: "pl-1",
  name: "Provider",
  source,
  sourceVersion: 1,
  hiddenCategories: [],
  hiddenCategoryMode: "exclude",
};

const channel = (streamId = "10", archiveDays = 7): Channel => ({
  id: `xtream:pl-1:live:${streamId}`,
  name: `Channel ${streamId}`,
  logo: "http://provider.example/logo.png",
  group: "live:1",
  url: `http://provider.example/live/${streamId}.m3u8`,
  quality: "",
  number: Number(streamId),
  xtream: {
    playlistId: "pl-1",
    streamId,
    categoryKey: "live:1",
    archiveDays,
    directSource: "",
  },
});

const auth = {
  user_info: { auth: 1, status: "Active" },
  server_info: { server_protocol: "http", url: "provider.example" },
};

const programme = (
  id: string,
  startTimestamp: number,
  stopTimestamp: number,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  title: btoa(`Programme ${id}`),
  description: btoa(`Description ${id}`),
  start: new Date(startTimestamp * 1000).toISOString().slice(0, 19).replace("T", " "),
  end: new Date(stopTimestamp * 1000).toISOString().slice(0, 19).replace("T", " "),
  start_timestamp: startTimestamp,
  stop_timestamp: stopTimestamp,
  has_archive: 1,
  ...overrides,
});

async function loadStore(fetchImplementation: typeof fetch) {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(fetchImplementation));
  return import("../src/stores/library");
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
});

test("guide sorts programmes and selects the current and next entries", async () => {
  const now = Date.now() / 1000;
  const { useLibrary } = await loadStore(async (input) => {
    const action = new URL(String(input)).searchParams.get("action");
    return {
      ok: true,
      status: 200,
      json: async () =>
        action === "get_short_epg"
          ? {
              epg_listings: [
                programme("next", now + 1800, now + 3600),
                programme("past", now - 3600, now - 1800),
                programme("current", now - 1800, now + 1800),
              ],
            }
          : auth,
    } as Response;
  });
  useLibrary.getState().selectPlaylist(playlist);

  await useLibrary.getState().loadGuide(channel());

  const guide = useLibrary.getState().guideFor(channel().id);
  expect(guide.items.map((item) => item.id)).toEqual(["past", "current", "next"]);
  expect(guide.current?.id).toBe("current");
  expect(guide.next?.id).toBe("next");
});

test("guide keeps malformed base64 text readable", async () => {
  const now = Date.now() / 1000;
  const { useLibrary } = await loadStore(
    async (input) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          new URL(String(input)).searchParams.get("action") === "get_short_epg"
            ? {
                epg_listings: [
                  programme("bad", now - 60, now + 60, {
                    title: "News %%%",
                    description: "Already plain text",
                  }),
                ],
              }
            : auth,
      }) as Response,
  );
  useLibrary.getState().selectPlaylist(playlist);

  await useLibrary.getState().loadGuide(channel());

  expect(useLibrary.getState().guideFor(channel().id).items[0]).toMatchObject({
    title: "News %%%",
    description: "Already plain text",
  });
});

test("catchup targets require a complete past programme inside the archive boundary", async () => {
  const now = Date.now() / 1000;
  const exactBoundary = now - 7 * 86400;
  const { useLibrary } = await loadStore(
    async (input) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          new URL(String(input)).searchParams.get("action") === "get_short_epg"
            ? {
                epg_listings: [
                  programme("boundary", exactBoundary, exactBoundary + 5401),
                  programme("expired", exactBoundary - 1, exactBoundary + 100),
                  programme("future", now + 60, now + 3660),
                  programme("current", now - 60, now + 60),
                  programme("not-archived", now - 7200, now - 3600, { has_archive: 0 }),
                  programme("missing-stop", now - 7200, now - 3600, { stop_timestamp: "" }),
                ],
              }
            : auth,
      }) as Response,
  );
  useLibrary.getState().selectPlaylist(playlist);

  await useLibrary.getState().loadGuide(channel());

  const byId = new Map(
    useLibrary
      .getState()
      .guideFor(channel().id)
      .items.map((item) => [item.id, item]),
  );
  expect(byId.get("boundary")?.target).toMatchObject({
    id: "xtream:pl-1:catchup:10:boundary",
    playlistId: "pl-1",
    mode: "finite",
    kind: "catchup",
    name: "Programme boundary",
    group: "Channel 10",
    logo: "http://provider.example/logo.png",
  });
  expect(byId.get("boundary")?.target?.url).toContain("/timeshift/viewer/secret/91/");
  expect(byId.get("expired")?.target).toBeUndefined();
  expect(byId.get("future")?.target).toBeUndefined();
  expect(byId.get("current")?.target).toBeUndefined();
  expect(byId.get("not-archived")?.target).toBeUndefined();
  expect(byId.get("missing-stop")?.target).toBeUndefined();
});

test("a newer focused channel request cancels the abandoned guide request", async () => {
  let firstAborted = false;
  let markFirstStarted: (() => void) | undefined;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  const { useLibrary } = await loadStore(async (input, init) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action");
    if (action !== "get_short_epg")
      return { ok: true, status: 200, json: async () => auth } as Response;
    const streamId = url.searchParams.get("stream_id");
    if (streamId === "10") {
      markFirstStarted?.();
      return new Promise<Response>((_resolve, reject) => {
        const abort = () => {
          firstAborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort);
      });
    }
    return { ok: true, status: 200, json: async () => ({ epg_listings: [] }) } as Response;
  });
  useLibrary.getState().selectPlaylist(playlist);

  const abandoned = useLibrary.getState().loadGuide(channel("10"));
  await firstStarted;
  await useLibrary.getState().loadGuide(channel("11"));
  await abandoned;

  expect(firstAborted).toBe(true);
  expect(useLibrary.getState().guideFor(channel("10").id).state).not.toBe("failed");
  expect(useLibrary.getState().guideFor(channel("11").id).state).toBe("empty");
});

test("guide data is reused briefly and refetched after its memory lifetime", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
  let guideRequests = 0;
  const { useLibrary } = await loadStore(async (input) => {
    const action = new URL(String(input)).searchParams.get("action");
    if (action === "get_short_epg") guideRequests += 1;
    return {
      ok: true,
      status: 200,
      json: async () => (action === "get_short_epg" ? { epg_listings: [] } : auth),
    } as Response;
  });
  useLibrary.getState().selectPlaylist(playlist);

  await useLibrary.getState().loadGuide(channel());
  await useLibrary.getState().loadGuide(channel());
  expect(guideRequests).toBe(1);

  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
  await useLibrary.getState().loadGuide(channel());
  expect(guideRequests).toBe(2);
});
