import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GuideList } from "../src/components/GuideList";
import { KEY } from "../src/hooks/useRemote";
import { formatTime } from "../src/services/locale";
import type { ChannelGuide } from "../src/stores/library";
import type { PlaybackTarget } from "../src/types";
import { finishPlayback, mountApp, played, press, settle, XTREAM_SOURCE } from "./support/app";

const target: PlaybackTarget = {
  id: "xtream:pl-1:catchup:1:past",
  playlistId: "pl-1",
  mode: "finite",
  kind: "catchup",
  name: "Morning News",
  group: "Provider One",
  logo: "",
  url: "http://provider.example/timeshift/viewer/secret/60/2026-10-02:10-00/1.ts",
};

const loadedGuide: ChannelGuide = {
  state: "loaded",
  items: [
    {
      id: "past",
      title: "Morning News",
      description: "The morning headlines",
      start: "2026-10-02 10:00:00",
      end: "2026-10-02 11:00:00",
      startTimestamp: 1790935200,
      stopTimestamp: 1790938800,
      archived: true,
      target,
    },
    {
      id: "future",
      title: "Evening News",
      description: "Tonight's headlines",
      start: "2026-10-02 18:00:00",
      end: "2026-10-02 19:00:00",
      startTimestamp: 1790964000,
      stopTimestamp: 1790967600,
      archived: false,
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("GuideList formats programme timestamps in the viewer locale and timezone", () => {
  const startTimestamp = 0;
  const stopTimestamp = 3600;
  render(
    <GuideList
      channel="Provider One"
      guide={{
        state: "loaded",
        items: [
          {
            id: "timezone",
            title: "Timezone News",
            description: "",
            start: "2099-01-01 23:15:00",
            end: "2099-01-02 23:45:00",
            startTimestamp,
            stopTimestamp,
            archived: false,
          },
        ],
      }}
      index={0}
      focused
      scale={1}
      onMove={() => {}}
      onSelect={() => {}}
      onRetry={() => {}}
    />,
  );

  expect(
    screen.getByText(
      `${formatTime("en", new Date(startTimestamp * 1000))} to ${formatTime("en", new Date(stopTimestamp * 1000))}`,
    ),
  ).toBeTruthy();
  expect(document.body.textContent).not.toContain("23:15 to 23:45");
});

test("GuideList keeps every programme readable and only offers valid catchup", () => {
  const onSelect = vi.fn();
  render(
    <GuideList
      channel="Provider One"
      guide={loadedGuide}
      index={0}
      focused
      scale={1}
      onMove={() => {}}
      onSelect={onSelect}
      onRetry={() => {}}
    />,
  );

  expect(screen.getByText("Morning News")).toBeTruthy();
  expect(screen.getByText("The morning headlines")).toBeTruthy();
  expect(screen.getByText("Evening News")).toBeTruthy();
  expect(screen.getByText("Tonight's headlines")).toBeTruthy();
  const playButtons = screen.getAllByRole("button", { name: "Play from start" });
  expect(playButtons).toHaveLength(1);
  fireEvent.click(playButtons[0]);
  expect(onSelect).toHaveBeenCalledWith(0);
});

test.each([
  ["loading", "Loading…"],
  ["empty", "No programme information is available."],
  ["failed", "Retry"],
] as const)("GuideList renders its %s state", (state, text) => {
  const retry = vi.fn();
  render(
    <GuideList
      channel="Provider One"
      guide={{ state, items: [], ...(state === "failed" ? { error: "Guide failed" } : {}) }}
      index={0}
      focused
      scale={1}
      onMove={() => {}}
      onSelect={() => {}}
      onRetry={retry}
    />,
  );
  expect(screen.getByText(text)).toBeTruthy();
  if (state === "failed") {
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  }
});

const xtreamFetch = async (input: string | URL) => {
  const url = new URL(String(input));
  const action = url.searchParams.get("action") ?? "authenticate";
  const now = Math.floor(Date.now() / 1000);
  const body: Record<string, unknown> = {
    authenticate: {
      user_info: { auth: 1, status: "Active" },
      server_info: { server_protocol: "http", url: "provider.example" },
    },
    get_live_categories: [{ category_id: "10", category_name: "News" }],
    get_vod_categories: [],
    get_series_categories: [],
    get_live_streams: [
      {
        stream_id: "1",
        name: "Provider One",
        category_id: "10",
        tv_archive_duration: 7,
      },
    ],
    get_short_epg: {
      epg_listings: [
        {
          id: "past",
          title: btoa("Morning News"),
          description: btoa("Headlines"),
          start: new Date((now - 7200) * 1000).toISOString().slice(0, 19).replace("T", " "),
          end: new Date((now - 3600) * 1000).toISOString().slice(0, 19).replace("T", " "),
          start_timestamp: now - 7200,
          stop_timestamp: now - 3600,
          has_archive: 1,
        },
        {
          id: "current",
          title: btoa("News at Noon"),
          description: btoa("Current headlines"),
          start: "2026-10-02 11:30:00",
          end: "2026-10-02 12:30:00",
          start_timestamp: now - 1800,
          stop_timestamp: now + 1800,
          has_archive: 0,
        },
        {
          id: "next",
          title: btoa("Weather"),
          description: btoa("The forecast"),
          start: "2026-10-02 12:30:00",
          end: "2026-10-02 13:00:00",
          start_timestamp: now + 1800,
          stop_timestamp: now + 3600,
          has_archive: 0,
        },
      ],
    },
  };
  return { ok: true, status: 200, json: async () => body[action] } as Response;
};

test("Guide opens from live playback and starts archived playback", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  expect(document.querySelector(".guide-drawer")).toBeNull();

  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(document.querySelector(".guide-row.current .row-label")?.textContent).toBe(
    "News at Noon",
  );
  press(KEY.UP);
  expect(document.querySelector(".guide-row.selected .row-label")?.textContent).toBe(
    "Morning News",
  );
  press(KEY.DOWN);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "News at Noon",
  );
  fireEvent.mouseEnter(document.querySelectorAll(".guide-row")[2]);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe("Weather");
  fireEvent.mouseEnter(document.querySelectorAll(".guide-row")[0]);
  expect(document.querySelector(".guide-row.selected .row-label")?.textContent).toBe(
    "Morning News",
  );

  press(KEY.ENTER);
  await settle(0);
  expect(played[played.length - 1]).toContain("/timeshift/");

  press(KEY.STOP);
  expect(screen.getByText("Morning News")).toBeTruthy();

  press(KEY.ENTER);
  finishPlayback();
  await settle(0);
  expect(screen.getByText("Morning News")).toBeTruthy();
});

test("GREEN in Guide favourites its guide channel instead of the programme row index", async () => {
  const fetchImplementation = async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const body: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "10", category_name: "News" }],
      get_vod_categories: [],
      get_series_categories: [],
      get_live_streams: [
        { stream_id: "1", name: "Provider One", category_id: "10" },
        { stream_id: "2", name: "Provider Two", category_id: "10" },
      ],
      get_short_epg: { epg_listings: [] },
    };
    return { ok: true, status: 200, json: async () => body[action] } as Response;
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);

  press(KEY.GREEN);

  const personal = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(personal.favourites.map((item: { itemKey: string }) => item.itemKey)).toEqual([
    "xtream:pl-1:live:2",
  ]);
});

test("focused live guide loading waits for the row to settle", async () => {
  const requested: string[] = [];
  const fetchImplementation = async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    if (action === "get_short_epg") {
      requested.push(url.searchParams.get("stream_id") ?? "");
      return { ok: true, status: 200, json: async () => ({ epg_listings: [] }) } as Response;
    }
    const body: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "10", category_name: "News" }],
      get_vod_categories: [],
      get_series_categories: [],
      get_live_streams: [
        { stream_id: "1", name: "One", category_id: "10" },
        { stream_id: "2", name: "Two", category_id: "10" },
      ],
    };
    return { ok: true, status: 200, json: async () => body[action] } as Response;
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });

  press(KEY.DOWN);
  await settle(149);
  expect(requested).toEqual([]);
  await settle(1);
  expect(requested).toEqual(["2"]);
});

test("playing an Xtream live channel loads now and next into the banner", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);

  expect(screen.getByText("Now: News at Noon")).toBeTruthy();
  expect(screen.getByText("Next: Weather")).toBeTruthy();
});

test("Guide disappears outside Xtream live", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(screen.queryByRole("button", { name: "Guide" })).toBeNull();
});

test("opening and returning from Guide preserves the live row", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  const selected = () => document.querySelector(".list .row.selected .row-label")?.textContent;
  assert.equal(selected(), "Provider One");

  press(KEY.ENTER);
  await settle(0);
  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  press(KEY.BACK);
  await settle(180);

  assert.equal(selected(), "Provider One");
});
