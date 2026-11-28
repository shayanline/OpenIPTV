import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GuideList } from "../src/components/GuideList";
import { KEY } from "../src/hooks/useRemote";
import { formatTime, translate } from "../src/services/locale";
import type { ChannelGuide } from "../src/stores/library";
import type { Channel, PlaybackTarget } from "../src/types";
import { finishPlayback, mountApp, played, press, settle, XTREAM_SOURCE } from "./support/app";

const GUIDE_CHANNEL: Channel = {
  id: "xtream:pl-1:live:1",
  name: "Provider One",
  group: "News",
  url: "http://provider.example/live/viewer/secret/1.m3u8",
  quality: "",
  number: 1,
};

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
      channel={GUIDE_CHANNEL}
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
      onPlay={() => {}}
      onRetry={() => {}}
      onWheel={() => {}}
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
  const onPlay = vi.fn();
  render(
    <GuideList
      channel={GUIDE_CHANNEL}
      guide={loadedGuide}
      index={0}
      focused
      scale={1}
      onMove={() => {}}
      onPlay={onPlay}
      onRetry={() => {}}
      onWheel={() => {}}
    />,
  );

  expect(screen.getByText("Morning News")).toBeTruthy();
  expect(screen.getByText("The morning headlines")).toBeTruthy();
  expect(screen.getByText("Evening News")).toBeTruthy();
  expect(screen.getByText("Tonight's headlines")).toBeTruthy();
  const playButtons = screen.getAllByRole("button", { name: "Play from start" });
  expect(playButtons).toHaveLength(1);
  fireEvent.click(playButtons[0]);
  expect(onPlay).toHaveBeenCalledWith(0);
});

test("GuideList visibly selects programmes without catchup", () => {
  render(
    <GuideList
      channel={GUIDE_CHANNEL}
      guide={loadedGuide}
      index={1}
      focused
      scale={1}
      onMove={() => {}}
      onPlay={() => {}}
      onRetry={() => {}}
      onWheel={() => {}}
    />,
  );

  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "Evening News",
  );
});

test("GuideList moves focus to the viewport edge before scrolling", () => {
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(304);
  const guide: ChannelGuide = {
    state: "loaded",
    items: Array.from({ length: 8 }, (_, index) => ({
      id: `programme-${index}`,
      title: `Programme ${index}`,
      description: "",
      start: "",
      end: "",
      archived: false,
    })),
  };
  const props = {
    channel: GUIDE_CHANNEL,
    guide,
    focused: true,
    scale: 1,
    onMove: () => {},
    onPlay: () => {},
    onRetry: () => {},
    onWheel: () => {},
  };

  try {
    const { rerender } = render(<GuideList {...props} index={0} />);
    expect((document.querySelector(".guide-list .window") as HTMLElement).style.transform).toBe(
      "translateY(0px)",
    );

    rerender(<GuideList {...props} index={3} />);
    expect((document.querySelector(".guide-list .window") as HTMLElement).style.transform).toBe(
      "translateY(0px)",
    );

    rerender(<GuideList {...props} index={4} />);
    expect((document.querySelector(".guide-list .window") as HTMLElement).style.transform).toBe(
      "translateY(-76px)",
    );
  } finally {
    height.mockRestore();
  }
});

test.each([
  ["loading", "Loading…"],
  ["empty", "No programme information is available."],
  ["failed", "Retry"],
] as const)("GuideList renders its %s state", (state, text) => {
  const retry = vi.fn();
  render(
    <GuideList
      channel={GUIDE_CHANNEL}
      guide={{ state, items: [], ...(state === "failed" ? { error: "Guide failed" } : {}) }}
      index={0}
      focused
      scale={1}
      onMove={() => {}}
      onPlay={() => {}}
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
  return new Response(JSON.stringify(body[action]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

/* Right opens the deck, then moves to Guide in the trailing programme card. */
async function openGuideViaDeck() {
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  press(KEY.ENTER);
  await settle(0);
}

test("the live Guide shows its channel header and truthful hints for the selected programme", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();

  const drawer = screen.getByRole("complementary", {
    name: "Programme guide: Provider One",
  });
  expect(screen.getByRole("heading", { level: 2, name: "Provider One" })).toBeTruthy();
  expect(screen.getByText("Programme Guide")).toBeTruthy();
  expect(drawer.querySelector(".playback-drawer-head .icon-guide")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Programme guide: Provider One" })).toBeTruthy();
  const hints = () => drawer.querySelector(".guide-drawer-hints")?.textContent;
  expect(hints()).toBe("\u2190RETURNClose");
  expect(drawer.querySelector(".playback-drawer-body")?.nextElementSibling).toBe(
    drawer.querySelector(".playback-drawer-footer"),
  );

  press(KEY.UP);
  expect(hints()).toBe("OKSelect\u2190RETURNClose");
  press(KEY.DOWN);
  press(KEY.DOWN);
  expect(hints()).toBe("\u2190RETURNClose");
  const before = played.length;
  press(KEY.ENTER);
  expect(played).toHaveLength(before);
  expect(drawer.querySelector(".guide-drawer-hints button")).toBeNull();

  press(KEY.BACK);
  await settle(180);
  expect(document.querySelector(".guide-drawer")).toBeNull();
  expect(document.querySelector(".deck-programme-panel")?.hasAttribute("data-selected")).toBe(
    true,
  );
});

test("the live Guide translates its RTL header while preserving the provider channel name", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();
  const { useSettings } = await import("../src/stores/settings");
  const locale = useSettings.getState().locale;
  try {
    act(() => useSettings.setState({ locale: "fa" }));
    const drawer = screen.getByRole("complementary", {
      name: translate("fa", "guide.title", { category: "Provider One" }),
    });
    expect(screen.getByRole("heading", { level: 2, name: "Provider One" })).toBeTruthy();
    expect(screen.getByText(translate("fa", "guide.subtitle"))).toBeTruthy();
    expect(document.documentElement.dir).toBe("rtl");
    expect(drawer.querySelector(".guide-drawer-hints")?.textContent).toContain(
      translate("fa", "common.close"),
    );
    expect(drawer.querySelector(".playback-drawer-body")?.nextElementSibling).toBe(
      drawer.querySelector(".playback-drawer-footer"),
    );
  } finally {
    act(() => useSettings.setState({ locale }));
  }
});

test.each(["loading", "empty", "failed"] as const)(
  "the live Guide keeps its header and only actionable hints while %s",
  async (state) => {
    await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
    press(KEY.ENTER);
    await settle(0);
    await openGuideViaDeck();
    const { useLibrary } = await import("../src/stores/library");
    const channelId = "xtream:pl-1:live:1";
    act(() => {
      useLibrary.setState({
        guides: {
          ...useLibrary.getState().guides,
          [channelId]: {
            state,
            items: [],
            ...(state === "failed" ? { error: "Guide failed" } : {}),
          },
        },
      });
    });
    const drawer = screen.getByRole("complementary", {
      name: "Programme guide: Provider One",
    });
    expect(screen.getByRole("heading", { level: 2, name: "Provider One" })).toBeTruthy();
    expect(screen.getByText("Programme Guide")).toBeTruthy();
    expect(drawer.querySelector(".guide-drawer-hints")?.textContent).toBe(
      state === "failed" ? "OKSelect\u2190RETURNClose" : "\u2190RETURNClose",
    );
    if (state === "loading") expect(within(drawer).getByRole("status")).toBeTruthy();
    if (state === "empty") {
      expect(screen.getByText("No programme information is available.")).toBeTruthy();
    }
    if (state === "failed") {
      const retry = vi.spyOn(useLibrary.getState(), "loadGuide").mockResolvedValue();
      try {
        press(KEY.ENTER);
        expect(retry).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ id: channelId }),
        );
      } finally {
        retry.mockRestore();
      }
    }
  },
);

test("Guide opens from live playback and starts archived playback", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  expect(document.querySelector(".guide-drawer")).toBeNull();

  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  expect(document.querySelector(".guide-row.current .row-label")?.textContent).toBe(
    "News at Noon",
  );
  press(KEY.UP);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "Morning News",
  );
  press(KEY.DOWN);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "News at Noon",
  );
  fireEvent.mouseEnter(document.querySelectorAll(".guide-row")[2]);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "News at Noon",
  );
  fireEvent.click(document.querySelectorAll(".guide-row")[2]);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe("Weather");
  fireEvent.mouseEnter(document.querySelectorAll(".guide-row")[0]);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe("Weather");
  fireEvent.click(document.querySelectorAll(".guide-row")[0]);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
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

test("mouse wheel scrolls the programme guide without moving remote selection", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();
  const viewport = document.querySelector(".guide-list .viewport");
  assert.ok(viewport);

  const selected = document.querySelector(".guide-row.cursor .row-label")?.textContent;
  fireEvent.wheel(viewport, { deltaY: 100 });
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(selected);

  await settle(120);
  fireEvent.wheel(viewport, { deltaY: -100 });
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(selected);
});

test("Guide clamps its cursor when refreshed programmes become shorter", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();
  press(KEY.DOWN);
  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe("Weather");

  const { useLibrary } = await import("../src/stores/library");
  act(() => {
    const state = useLibrary.getState();
    const entry = Object.entries(state.guides).find(([, guide]) => guide.items.length);
    assert.ok(entry);
    const [channelId, held] = entry;
    useLibrary.setState({
      guides: {
        ...state.guides,
        [channelId]: { ...held, items: held.items.slice(0, 1) },
      },
    });
  });
  await settle(0);

  expect(document.querySelector(".guide-row.cursor .row-label")?.textContent).toBe(
    "Morning News",
  );
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
    return new Response(JSON.stringify(body[action]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();

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
      return new Response(JSON.stringify({ epg_listings: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
    return new Response(JSON.stringify(body[action]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });

  press(KEY.DOWN);
  await settle(149);
  expect(requested).toEqual([]);
  await settle(1);
  expect(requested).toEqual(["2"]);
});

test("playing an Xtream live channel loads now into the banner and now and next into the deck", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  press(KEY.ENTER);
  await settle(0);

  expect(screen.getByText("Now: News at Noon")).toBeTruthy();
  expect(screen.queryByText("Next: Weather")).toBeNull();

  press(KEY.RIGHT);
  await settle(0);
  const panel = document.querySelector(".deck-programme-panel");
  expect(panel?.textContent).toContain("News at Noon");
  expect(panel?.textContent).toContain("Weather");
  expect(panel?.textContent).not.toContain("Now:");
  expect(panel?.textContent).not.toContain("Next:");
});

test("Guide disappears outside Xtream live", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  expect(screen.queryByRole("button", { name: "Guide" })).toBeNull();
});

test("opening and returning from Guide preserves the live row", async () => {
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
  const selected = () => document.querySelector(".list .row.cursor .row-label")?.textContent;
  assert.equal(selected(), "Provider One");

  press(KEY.ENTER);
  await settle(0);
  await openGuideViaDeck();
  expect(document.querySelector(".guide-drawer")).toBeTruthy();
  press(KEY.BACK);
  await settle(180);

  assert.equal(selected(), "Provider One");
});

/*
 * Catchup started from the Guide has no finite return route, so leaving it must still
 * release the playback drawer it was reading through: the information dialog goes, the
 * Guide it came from takes the screen back, and no stale Details owner is left holding
 * the keys afterwards.
 */
test.each(["stop", "ended"] as const)(
  "details over Guide catchup releases its owner on %s",
  async (exit) => {
    await mountApp("", { source: XTREAM_SOURCE, fetchImplementation: xtreamFetch });
    press(KEY.ENTER);
    await settle(0);
    await openGuideViaDeck();

    /* Into the archived programme, then back out to the deck the Guide was opened from. */
    press(KEY.UP);
    press(KEY.ENTER);
    await settle(0);
    expect(played[played.length - 1]).toContain("/timeshift/");
    press(KEY.BACK);
    await settle(180);
    expect(document.querySelector(".playback-deck")).toBeTruthy();

    /* Deck to Details over the finite catchup picture. */
    press(KEY.LEFT);
    await settle(0);
    press(KEY.ENTER);
    await settle(0);
    const details = document.querySelector(".playback-details");
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain("Morning News");

    if (exit === "stop") press(KEY.STOP);
    else finishPlayback();
    await settle(0);

    /* The reading surface is gone and the Guide it was started from takes the screen
       back, still answering the keys. */
    expect(document.querySelector(".playback-details")).toBeNull();
    const drawer = document.querySelector(".guide-drawer");
    expect(drawer?.textContent).toContain("Morning News");
    const cursor = () => drawer?.querySelector(".guide-row.cursor .row-label")?.textContent;
    expect(cursor()).toBe("News at Noon");
    press(KEY.UP);
    expect(cursor()).toBe("Morning News");

    /* Closing the Guide lands on the browser, whose Enter reaches a channel rather than
       a stale Details surface that no longer has a target. */
    press(KEY.BACK);
    await settle(180);
    expect(document.querySelector(".guide-drawer")).toBeNull();
    const plays = played.length;
    press(KEY.ENTER);
    await settle(0);
    expect(played).toHaveLength(plays + 1);
    expect(played[played.length - 1]).not.toContain("/timeshift/");
  },
);
