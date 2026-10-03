import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { KEY } from "../src/hooks/useRemote";
import {
  finishPlayback,
  hold,
  mountApp,
  panelOpen,
  playCalls,
  played,
  press,
  seekChanges,
  setPlaybackTime,
  settle,
  XTREAM_SOURCE,
} from "./support/app";

const categories = {
  movie: [{ category_id: "10", category_name: "Cinema, exactly" }],
  series: [{ category_id: "20", category_name: "Shows, exactly" }],
};

const movie = (id: number, name = `Movie ${id}`) => ({
  stream_id: String(id),
  category_id: "10",
  name,
  container_extension: "mp4",
});

const series = {
  series_id: "200",
  category_id: "20",
  name: "Series, exactly",
};

function libraryFetch(
  options: { movies?: unknown[]; failMoviesOnce?: boolean; failMovieDetailOnce?: boolean } = {},
) {
  let failMovies = options.failMoviesOnce ?? false;
  let failMovieDetail = options.failMovieDetailOnce ?? false;
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_streams" && url.searchParams.has("category_id") && failMovies) {
      failMovies = false;
      throw new Error("Movies are unavailable");
    }
    if (action === "get_vod_info" && failMovieDetail) {
      failMovieDetail = false;
      throw new Error("Movie details are unavailable");
    }
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: categories.movie,
      get_series_categories: categories.series,
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: options.movies ?? [
        movie(100, "Film, exactly"),
        movie(101, "Another film"),
      ],
      get_series: [series],
      get_vod_info: {
        info: { name: "Film, exactly", plot: "A provider supplied plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
      get_series_info: {
        info: { name: "Series, exactly", category_id: "20" },
        episodes: {
          "1": [
            { id: "201", episode_num: 1, title: "Pilot, exactly", container_extension: "mp4" },
          ],
          "2": [
            { id: "202", episode_num: 1, title: "Return, exactly", container_extension: "mkv" },
          ],
        },
      },
    };
    return { ok: true, status: 200, json: async () => bodies[action] };
  });
}

async function mountLibrary(
  options?: Parameters<typeof libraryFetch>[0],
  mountOptions: Parameters<typeof mountApp>[1] = {},
) {
  const view = await mountApp("", {
    ...mountOptions,
    source: XTREAM_SOURCE,
    fetchImplementation: libraryFetch(options),
  });
  return view;
}

async function chooseContent(name: "Movies" | "Series") {
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => Promise.resolve());
  await settle(0);
}

async function chooseRow(name: string) {
  const label = screen.getAllByText(name).find((item) => item.closest("button"));
  if (!label) throw new Error(`No row named ${name}`);
  fireEvent.click(label.closest("button")!);
  await act(async () => Promise.resolve());
  await settle(0);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("Movies loads a category, preserves names, opens details, and restores its cursor", async () => {
  await mountLibrary();
  await chooseContent("Movies");

  expect(screen.getAllByText("Cinema, exactly").length).toBeGreaterThan(0);
  await chooseRow("Cinema, exactly");
  expect(screen.getByText("Film, exactly")).toBeTruthy();

  press(KEY.DOWN);
  await settle();
  expect(document.querySelector(".media-list .row.selected")?.textContent).toContain(
    "Another film",
  );
  press(KEY.UP);
  await settle();
  press(KEY.ENTER);
  await settle(0);

  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".media-list .row.selected")?.textContent).toContain(
    "Film, exactly",
  );
  expect(panelOpen()).toBe(true);
});

test("remote OK retries a failed movie detail request", async () => {
  await mountLibrary({ failMovieDetailOnce: true });
  await chooseContent("Movies");
  await chooseRow("Cinema, exactly");

  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("This content could not be loaded.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Movie details are unavailable");
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

  press(KEY.ENTER);
  await settle(0);
  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
});

test("Series descends through seasons and episodes and RETURN removes one frame", async () => {
  await mountLibrary();
  await chooseContent("Series");
  await chooseRow("Shows, exactly");
  await chooseRow("Series, exactly");

  expect(screen.getByText("Season 1")).toBeTruthy();
  expect(screen.getByText("Season 2")).toBeTruthy();
  await chooseRow("Season 1");
  expect(screen.getByText("Pilot, exactly")).toBeTruthy();

  press(KEY.BACK);
  await settle(0);
  expect(screen.getByText("Season 1")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);
  expect(screen.getByText("Series, exactly")).toBeTruthy();
  expect(panelOpen()).toBe(true);
});

test("empty and failed categories have labelled rows and Retry is local", async () => {
  await mountLibrary({ movies: [], failMoviesOnce: true });
  await chooseContent("Movies");
  await chooseRow("Cinema, exactly");

  expect(screen.getByText("This content could not be loaded.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Movies are unavailable");
  await chooseRow("Retry");
  expect(screen.getByText("Nothing in this category.")).toBeTruthy();
});

test("large provider categories remain windowed", async () => {
  await mountLibrary({ movies: Array.from({ length: 400 }, (_, index) => movie(index + 1)) });
  await chooseContent("Movies");
  await chooseRow("Cinema, exactly");

  expect(screen.getByText("Movie 1")).toBeTruthy();
  expect(document.querySelectorAll(".media-list .row").length).toBeLessThan(40);
});

test("on demand search uses the complete provider index", async () => {
  await mountLibrary();
  await chooseContent("Movies");
  await chooseRow("Cinema, exactly");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(0);

  expect(document.body.textContent).not.toContain("Search covers loaded Movies categories.");
  expect(screen.getByText("Film, exactly")).toBeTruthy();
});

test("library Red actions use provider category keys and describe the visible row", async () => {
  await mountLibrary(undefined, { hiddenCategories: ["movie:10"] });
  await chooseContent("Movies");

  expect(document.body.textContent).not.toContain("Cinema, exactly");
  await hold(KEY.RED);
  expect(screen.getAllByText("Cinema, exactly").length).toBeGreaterThan(0);
  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".rail .row.selected")?.textContent).toContain(
    "Cinema, exactly",
  );
  expect(document.querySelector(".panel-hints")?.textContent).toContain("Unhide category");
  press(KEY.RED);

  const saved = JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}");
  expect(saved.playlists[0].hiddenCategories).toEqual([]);
});

test("library Red short press ignores its synthetic favourites row", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [
        {
          itemKey: "xtream:pl-1:movie:100",
          playlistId: "pl-1",
          kind: "movie",
          providerId: "100",
          categoryKey: "movie:10",
          name: "Saved film",
          logo: "",
          extension: "mp4",
        },
      ],
      lastPlayed: null,
      progress: [],
    }),
  );
  await mountLibrary();
  await chooseContent("Movies");
  press(KEY.LEFT);
  press(KEY.RED);

  const saved = JSON.parse(localStorage.getItem("openiptv.settings") ?? "{}");
  expect(saved.playlists[0].hiddenCategories).toEqual([]);
});

test.each(["RETURN", "content change"] as const)(
  "a late movie detail response cannot replace a frame removed by %s",
  async (departure) => {
    let finishDetail: ((value: Response) => void) | undefined;
    const base = libraryFetch();
    const fetchImplementation = vi.fn(async (input: string | URL) => {
      const action = new URL(String(input)).searchParams.get("action") ?? "authenticate";
      if (action === "get_vod_info") {
        return new Promise<Response>((resolve) => {
          finishDetail = resolve;
        });
      }
      return base(input) as Promise<Response>;
    });
    await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
    await chooseContent("Movies");
    await chooseRow("Cinema, exactly");

    press(KEY.ENTER);
    await settle(0);
    expect(finishDetail).toBeDefined();
    if (departure === "RETURN") press(KEY.BACK);
    else await chooseContent("Series");
    finishDetail?.({
      ok: true,
      status: 200,
      json: async () => ({
        info: { name: "Film, exactly", plot: "Late plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      }),
    } as Response);
    await settle(0);

    expect(
      screen.getAllByText(departure === "RETURN" ? "Film, exactly" : "Shows, exactly").length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("Late plot");
  },
);

async function startMovie(seekFails = false) {
  await mountLibrary(undefined, { seekFails });
  setPlaybackTime(0, 0);
  await chooseContent("Movies");
  await chooseRow("Cinema, exactly");
  await chooseRow("Film, exactly");
  fireEvent.click(screen.getByRole("button", { name: /Play|Resume/ }));
  await settle(0);
}

test("movie playback uses a finite target and transport keys seek ten seconds", async () => {
  await startMovie();

  expect(panelOpen()).toBe(false);
  expect(document.querySelector(".pb-group")?.textContent).toBe("Cinema, exactly");
  expect(played[0]).toBe("http://provider.example/movie/viewer/secret/100.mp4");
  expect(playCalls[0].slice(1)).toEqual([false, undefined, "finite", undefined]);
  press(KEY.FORWARD);
  press(KEY.REWIND);
  await settle(0);
  expect(seekChanges).toEqual([10, -10]);
});

test("movie Previous and Next stay inside the category that launched playback", async () => {
  const fetchImplementation = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    const id = url.searchParams.get("vod_id") ?? "100";
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: [
        { category_id: "10", category_name: "Category A" },
        { category_id: "11", category_name: "Category B" },
      ],
      get_series_categories: [],
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams:
        url.searchParams.get("category_id") === "10"
          ? [movie(100, "Movie A")]
          : [movie(101, "Movie B")],
      get_vod_info: {
        info: { name: id === "100" ? "Movie A" : "Movie B" },
        movie_data: {
          stream_id: id,
          category_id: id === "100" ? "10" : "11",
          container_extension: "mp4",
        },
      },
    };
    return { ok: true, status: 200, json: async () => bodies[action] } as Response;
  });
  await mountApp("", { source: XTREAM_SOURCE, fetchImplementation });
  await chooseContent("Movies");
  await chooseRow("Category A");
  await chooseRow("Category B");
  await chooseRow("Category A");
  await chooseRow("Movie A");
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await settle(0);

  press(KEY.NEXT);
  await settle(0);

  expect(played).toEqual(["http://provider.example/movie/viewer/secret/100.mp4"]);
});

test("a rejected finite seek keeps playback active and shows nonfatal feedback", async () => {
  await startMovie(true);
  press(KEY.FORWARD);
  await settle(0);

  expect(played).toHaveLength(1);
  expect(panelOpen()).toBe(false);
  expect(screen.getByText("This video cannot seek on this device.")).toBeTruthy();
});

test("movie resume, progress boundaries, STOP, and completion restore its detail frame", async () => {
  localStorage.setItem(
    "openiptv.personal",
    JSON.stringify({
      favourites: [],
      lastPlayed: null,
      progress: [{ itemKey: "xtream:pl-1:movie:100", seconds: 35, duration: 120 }],
    }),
  );
  await startMovie();
  expect(playCalls[0][4]).toBe(35);

  setPlaybackTime(49, 120);
  await settle(1000);
  let saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress[0].seconds).toBe(35);
  setPlaybackTime(50, 120);
  await settle(1000);
  saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress[0].seconds).toBe(50);

  setPlaybackTime(54, 120);
  await settle(1000);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  document.dispatchEvent(new Event("visibilitychange"));
  saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress[0].seconds).toBe(54);
  Object.defineProperty(document, "hidden", { configurable: true, value: false });

  setPlaybackTime(55, 120);
  await settle(1000);
  press(KEY.PAUSE);
  await settle(0);
  saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress[0].seconds).toBe(55);
  press(KEY.PLAY);

  press(KEY.STOP);
  await settle(0);
  expect(panelOpen()).toBe(true);
  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
  saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress[0].seconds).toBe(55);

  fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
  await settle(0);
  finishPlayback();
  await settle(0);
  expect(panelOpen()).toBe(true);
  saved = JSON.parse(localStorage.getItem("openiptv.personal") ?? "{}");
  expect(saved.progress).toEqual([]);
});

test("episode selection starts finite series playback", async () => {
  await mountLibrary();
  setPlaybackTime(0, 0);
  await chooseContent("Series");
  await chooseRow("Shows, exactly");
  await chooseRow("Series, exactly");
  await chooseRow("Season 1");
  await chooseRow("Pilot, exactly");

  expect(document.querySelector(".pb-group")?.textContent).toBe("Shows, exactly");
  expect(played[0]).toBe("http://provider.example/series/viewer/secret/201.mp4");
  expect(playCalls[0][3]).toBe("finite");
});
