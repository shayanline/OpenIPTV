import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScrollIndicator, scrollIndicatorMetrics } from "../src/components/ScrollIndicator";
import {
  EPISODE_ROW_BASE,
  EpisodeList,
  episodeReference,
} from "../src/components/vod/EpisodeList";
import { PosterGrid, type PosterGridProps } from "../src/components/vod/PosterGrid";
import { SeriesDetails } from "../src/components/vod/SeriesDetails";
import {
  VodCategoryRail,
  type VodCategoryRailProps,
} from "../src/components/vod/VodCategoryRail";
import { movieActions, VodDetails } from "../src/components/vod/VodDetails";
import { KEY } from "../src/hooks/useRemote";
import { DEFAULT_MARQUEE_DWELL_MS } from "../src/components/Text";
import { RAIL_ROW_BASE, windowOf } from "../src/hooks/useWindowed";
import * as viewport from "../src/hooks/useViewport";
import * as artworkService from "../src/services/artwork";
import { availableVodSorts, applyVodView } from "../src/screens/VodScreen";
import {
  hold,
  mountApp,
  playCalls,
  press,
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

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function libraryFetch(
  options: {
    movies?: unknown[];
    series?: unknown[];
    movieCategories?: unknown[];
    seriesCategories?: unknown[];
    failMovieDetailOnce?: boolean;
    failIndexCount?: number;
    unplayableEpisode?: boolean;
    seriesInfo?: unknown;
  } = {},
) {
  let failMovieDetail = options.failMovieDetailOnce ?? false;
  let failIndexCount = options.failIndexCount ?? 0;
  return vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const action = url.searchParams.get("action") ?? "authenticate";
    if (action === "get_vod_info" && failMovieDetail) {
      failMovieDetail = false;
      return response({ error: "fixture failure" }, 503);
    }
    if (
      action === "get_vod_streams" &&
      !url.searchParams.has("category_id") &&
      failIndexCount > 0
    ) {
      failIndexCount -= 1;
      return response({ error: "fixture failure" }, 503);
    }
    const bodies: Record<string, unknown> = {
      authenticate: {
        user_info: { auth: 1, status: "Active" },
        server_info: { server_protocol: "http", url: "provider.example" },
      },
      get_live_categories: [{ category_id: "1", category_name: "Live" }],
      get_vod_categories: options.movieCategories ?? categories.movie,
      get_series_categories: options.seriesCategories ?? categories.series,
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: options.movies ?? [
        movie(100, "Film, exactly"),
        movie(101, "Another film"),
      ],
      get_series: options.series ?? [
        { series_id: "200", category_id: "20", name: "Series, exactly" },
      ],
      get_vod_info: {
        info: { name: "Film, exactly", plot: "A provider supplied plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
      get_series_info: options.seriesInfo ?? {
        info: { name: "Series, exactly", category_id: "20" },
        episodes: {
          "1": [
            {
              ...(options.unplayableEpisode ? {} : { id: "201" }),
              episode_num: 1,
              title: "Pilot, exactly",
              container_extension: "mp4",
              info: { duration_secs: 1800 },
            },
          ],
          "2": [
            {
              id: "202",
              episode_num: 1,
              title: "Return, exactly",
              container_extension: "mkv",
            },
          ],
        },
      },
    };
    return response(bodies[action] ?? []);
  });
}

async function mountLibrary(options?: Parameters<typeof libraryFetch>[0]) {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")) {
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight")!
      .get!;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function () {
      return this.classList.contains("poster-grid-region") ? 400 : clientHeight.call(this);
    });
  }
  const fetchImplementation = libraryFetch(options);
  const view = await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation,
  });
  const [{ useLineup }, { useLibrary }, { usePersonal }] = await Promise.all([
    import("../src/stores/lineup"),
    import("../src/stores/library"),
    import("../src/stores/personal"),
  ]);
  return { ...view, fetch: fetchImplementation, useLineup, useLibrary, usePersonal };
}

async function chooseMode(name: "Movies" | "Series") {
  const button = await vi.waitFor(
    async () => {
      await settle(0);
      return screen.getByRole("button", { name });
    },
    { interval: 10 },
  );
  button.focus();
  fireEvent.click(button);
  await act(async () => Promise.resolve());
  await settle(300);
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("idle");
    },
    { interval: 10 },
  );
  if (document.querySelector(".app-navigation.expanded")) press(KEY.RIGHT);
  await settle(0);
}

async function chooseButton(name: string | RegExp) {
  const button = screen.getByRole("button", { name });
  button.focus();
  fireEvent.click(button);
  await act(async () => Promise.resolve());
  await settle(0);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("hovering another category keeps displayed grid artwork loading", async () => {
  const poster = "https://images.example/visible-grid-poster.jpg";
  await mountLibrary({
    movies: [
      { ...movie(100), stream_icon: poster },
      { ...movie(101), category_id: "11" },
    ],
    movieCategories: [
      ...categories.movie,
      { category_id: "11", category_name: "Unopened category" },
    ],
  });
  const service = await import("../src/services/artwork");
  const load = vi.spyOn(service, "loadArtwork").mockResolvedValue(null);
  const release = vi.spyOn(service, "releaseArtwork");
  try {
    await chooseMode("Movies");
    await settle(200);
    expect(load.mock.calls.some(([request]) => request.url === poster)).toBe(true);
    release.mockClear();
    act(() => {
      document.documentElement.dataset.inputMode = "pointer";
    });
    const category = screen.getByRole("button", { name: /Unopened category/ });
    fireEvent.pointerEnter(category);
    expect(category.classList.contains("cursor")).toBe(true);
    expect(release.mock.calls.some(([request]) => request.url === poster)).toBe(false);
  } finally {
    load.mockRestore();
    release.mockRestore();
  }
});

test.each([
  ["Movies", /Film, exactly/],
  ["Series", /Series, exactly/],
] as const)("switching playlists clears the previous %s detail session", async (mode, name) => {
  await mountLibrary();
  press(KEY.ENTER);
  press(KEY.LEFT);
  await chooseMode(mode);
  await chooseButton(name);
  expect(document.querySelector(".vod-details")).toBeTruthy();
  const { useSettings } = await import("../src/stores/settings");
  act(() => {
    useSettings.getState().addPlaylist("Replacement", {
      ...XTREAM_SOURCE,
      server: "http://replacement.example",
    });
  });
  const replacement = useSettings
    .getState()
    .playlists.find((playlist) => playlist.name === "Replacement");
  if (!replacement) throw new Error("expected a replacement playlist");
  const starts = playCalls.length;
  fireEvent.click(screen.getByRole("button", { name: /^Playlists,/ }));
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(document.querySelector(".app")?.getAttribute("data-page-transition")).toBe("idle");
    },
    { interval: 10 },
  );
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Replacement" }));
  await vi.waitFor(
    async () => {
      await settle(0);
      expect(useSettings.getState().activePlaylistId).toBe(replacement.id);
    },
    { interval: 10 },
  );
  await chooseMode(mode);
  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
  expect(playCalls).toHaveLength(starts);
  expect(screen.getByRole("button", { name })).toBeTruthy();
});

test("VOD sort availability follows normalized catalogue fields", () => {
  const complete = [
    { key: "b", name: "Beta", rating: "7.5", year: "2023" },
    { key: "a", name: "Alpha", rating: "9.0", year: "2024" },
  ];
  expect(availableVodSorts(complete)).toEqual(["provider", "title", "rating", "release-date"]);
  expect(
    availableVodSorts(complete.map((item) => ({ ...item, rating: "", year: "" }))),
  ).toEqual(["provider", "title"]);
  expect(availableVodSorts(complete.map((item) => ({ ...item, name: "" })))).toEqual([
    "provider",
    "rating",
    "release-date",
  ]);
});

test("VOD sorting is local, immutable, and stable by item key", () => {
  const items = [
    { key: "b", name: "Beta", rating: "7.5", year: "2023" },
    { key: "a", name: "Alpha", rating: "9.0", year: "2024" },
    { key: "c", name: "Gamma", rating: "", year: "" },
  ];
  const original = items.slice();

  expect(applyVodView(items, "rating").map((item) => item.key)).toEqual(["a", "b", "c"]);
  expect(applyVodView(items, "title").map((item) => item.key)).toEqual(["a", "b", "c"]);
  expect(applyVodView(items, "release-date").map((item) => item.key)).toEqual(["a", "b", "c"]);
  expect(items).toEqual(original);
});

test("VOD Sort owns Back, resets to the first sorted item, and stays local", async () => {
  const view = await mountLibrary({
    movies: [
      { ...movie(100, "Beta"), rating: "7.5", release_date: "2023-01-01" },
      { ...movie(101, "Alpha"), rating: "9.0", release_date: "2024-01-01" },
    ],
  });
  await chooseMode("Movies");
  press(KEY.RIGHT);
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Beta");
  const requests = view.fetch.mock.calls.length;

  const sort = screen.getByRole("button", { name: /Sort:/ });
  fireEvent.pointerEnter(sort);
  fireEvent.click(sort);
  expect(screen.getByRole("menu", { name: "Sort" })).toBeTruthy();
  fireEvent.click(sort);
  expect(screen.queryByRole("menu", { name: "Sort" })).toBeNull();

  fireEvent.click(sort);
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Cinema, exactly" }));
  expect(screen.queryByRole("menu", { name: "Sort" })).toBeNull();

  fireEvent.click(sort);
  press(KEY.LEFT);
  expect(screen.queryByRole("menu", { name: "Sort" })).toBeNull();
  expect(document.querySelector(".vod-rail.focused")).toBeTruthy();

  fireEvent.click(sort);
  press(KEY.RIGHT);
  expect(screen.queryByRole("menu", { name: "Sort" })).toBeNull();
  expect(document.querySelector(".poster-card.cursor")).toBeTruthy();

  fireEvent.click(sort);
  press(KEY.BACK);
  expect(screen.queryByRole("menu", { name: "Sort" })).toBeNull();
  expect(sort.classList.contains("cursor")).toBe(true);

  fireEvent.click(sort);
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Rating" }));
  expect(sort.classList.contains("cursor")).toBe(true);
  press(KEY.DOWN);
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Alpha");
  expect(document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index")).toBe(
    "0",
  );
  expect(view.fetch.mock.calls.length).toBe(requests);

  expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  expect(view.fetch.mock.calls.length).toBe(requests);
});

test.each(["Movies", "Series"] as const)(
  "sorted %s navigation and detail publications do not sort the unchanged catalogue again",
  async (mode) => {
    const names = Array.from(
      { length: 60 },
      (_, index) => `Tile ${String(60 - index).padStart(3, "0")}`,
    );
    const view = await mountLibrary({
      movies: names.map((name, index) => movie(100 + index, name)),
      series: names.map((name, index) => ({
        series_id: String(200 + index),
        category_id: "20",
        name,
      })),
    });
    await chooseMode(mode);
    press(KEY.RIGHT);
    fireEvent.click(screen.getByRole("button", { name: /Sort:/ }));
    fireEvent.click(screen.getAllByRole("menuitemcheckbox")[1]);
    press(KEY.DOWN);
    await settle(0);
    expect(
      document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
    ).toBe("0");
    const compare = vi.spyOn(String.prototype, "localeCompare");

    press(KEY.RIGHT);
    press(KEY.RIGHT);
    press(KEY.LEFT);
    press(KEY.LEFT);
    press(KEY.LEFT);

    expect(compare.mock.calls.length).toBe(0);
    expect(document.querySelector(".vod-rail.focused") !== null).toBe(true);
    press(KEY.RIGHT);
    expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Tile 001");
    expect(compare.mock.calls.length).toBe(0);

    press(KEY.RIGHT);
    const origin = document.querySelector(".poster-card.cursor")!;
    const originIndex = origin.getAttribute("data-poster-index");
    const originLabel = origin.getAttribute("aria-label");
    const order = Array.from(document.querySelectorAll(".poster-card"), (card) =>
      card.getAttribute("aria-label"),
    );
    expect(origin.textContent).toContain("Tile 002");
    const originalFetch = view.fetch.getMockImplementation()!;
    const completions: Array<() => Promise<void>> = [];
    view.fetch.mockImplementation((input: string | URL) => {
      const action = new URL(String(input)).searchParams.get("action");
      if (action === (mode === "Movies" ? "get_vod_info" : "get_series_info")) {
        return new Promise<Response>((resolve) => {
          completions.push(async () => resolve(await originalFetch(input)));
        });
      }
      return originalFetch(input);
    });

    press(KEY.ENTER);
    await vi.waitFor(async () => {
      await settle(0);
      expect(completions).toHaveLength(1);
      expect(document.querySelector(".vod-details.loading")).toBeTruthy();
    });
    expect(compare.mock.calls.length).toBe(0);
    await act(async () => {
      for (const complete of completions.splice(0)) await complete();
    });
    await vi.waitFor(async () => {
      await settle(0);
      expect(document.querySelector(".vod-details.loaded")).toBeTruthy();
    });
    expect(compare.mock.calls.length).toBe(0);

    act(() => {
      const library = view.useLibrary.getState();
      if (mode === "Movies") {
        const [key, detail] = Object.entries(library.movieDetails)[0];
        if (!detail.value) throw new Error("expected loaded movie details");
        view.useLibrary.setState({
          movieDetails: {
            ...library.movieDetails,
            [key]: { ...detail, value: { ...detail.value, plot: "Refreshed detail plot" } },
          },
        });
      } else {
        const [key, detail] = Object.entries(library.seriesDetails)[0];
        if (!detail.value) throw new Error("expected loaded series details");
        view.useLibrary.setState({
          seriesDetails: {
            ...library.seriesDetails,
            [key]: { ...detail, value: { ...detail.value, plot: "Refreshed detail plot" } },
          },
        });
      }
    });
    expect(screen.getByText("Refreshed detail plot")).toBeTruthy();
    expect(compare.mock.calls.length).toBe(0);

    await settle(300);
    press(KEY.BACK);
    await settle(300);
    expect(document.querySelector(".vod-details")).toBeNull();
    const restored = document.querySelector(".poster-card.cursor")!;
    expect(restored.getAttribute("data-poster-index")).toBe(originIndex);
    expect(restored.getAttribute("aria-label")).toBe(originLabel);
    expect(
      Array.from(document.querySelectorAll(".poster-card"), (card) =>
        card.getAttribute("aria-label"),
      ),
    ).toEqual(order);
    expect(compare.mock.calls.length).toBe(0);
  },
);

test.each([
  ["Movies", "Title"],
  ["Movies", "Rating"],
  ["Series", "Title"],
  ["Series", "Rating"],
] as const)(
  "%s sorting by %s resets a deep catalogue to its new first item",
  async (mode, sort) => {
    const entries = Array.from({ length: 90 }, (_, index) => ({
      name: `Tile ${String(90 - index).padStart(3, "0")}`,
      rating: String((index + 1) / 10),
    }));
    const view = await mountLibrary({
      movies: entries.map((entry, index) => ({ ...movie(100 + index), ...entry })),
      series: entries.map((entry, index) => ({
        series_id: String(200 + index),
        category_id: "20",
        ...entry,
      })),
    });
    await chooseMode(mode);
    press(KEY.RIGHT);
    for (let index = 0; index < 8; index += 1) press(KEY.DOWN);
    await settle(32);
    const oldCard = document.querySelector(".poster-card.cursor")!;
    const oldLabel = oldCard.getAttribute("aria-label");
    expect(Number(oldCard.getAttribute("data-poster-index"))).toBeGreaterThan(0);
    expect((document.querySelector(".poster-grid") as HTMLElement).style.transform).not.toBe(
      "translateY(0px)",
    );
    const requests = view.fetch.mock.calls.length;
    const sortButton = screen.getByRole("button", { name: /Sort:/ });
    sortButton.focus();
    fireEvent.click(sortButton);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: sort }));
    expect(document.activeElement).toBe(sortButton);
    expect((document.querySelector(".poster-grid") as HTMLElement).style.transform).toBe(
      "translateY(0px)",
    );
    const first = document.querySelector('[data-poster-index="0"]')!;
    expect(first.textContent).toContain("Tile 001");
    expect(first.getAttribute("aria-label")).not.toBe(oldLabel);
    press(KEY.DOWN);
    expect(document.querySelector(".poster-card.cursor")).toBe(first);
    expect(view.fetch.mock.calls.length).toBe(requests);

    for (let index = 0; index < 5; index += 1) press(KEY.DOWN);
    await settle(40);
    const remembered = document
      .querySelector(".poster-card.cursor")
      ?.getAttribute("data-poster-index");
    const transform = (document.querySelector(".poster-grid") as HTMLElement).style.transform;
    fireEvent.click(sortButton);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: sort }));
    expect((document.querySelector(".poster-grid") as HTMLElement).style.transform).toBe(
      transform,
    );
    press(KEY.DOWN);
    expect(
      document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
    ).toBe(remembered);
  },
);

test("Movies and Series remember independent sorts and ordinary navigation on mode changes", async () => {
  const entries = Array.from({ length: 90 }, (_, index) => ({
    name: `Tile ${String(90 - index).padStart(3, "0")}`,
    rating: String((index + 1) / 10),
  }));
  await mountLibrary({
    movies: entries.map((entry, index) => ({ ...movie(100 + index), ...entry })),
    series: entries.map((entry, index) => ({
      series_id: String(200 + index),
      category_id: "20",
      ...entry,
    })),
  });
  const memories: Record<string, { index: string | null; transform: string }> = {};
  for (const [mode, sort] of [
    ["Movies", "Title"],
    ["Series", "Rating"],
  ] as const) {
    await chooseMode(mode);
    fireEvent.click(screen.getByRole("button", { name: /Sort:/ }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: sort }));
    press(KEY.DOWN);
    for (let index = 0; index < (mode === "Movies" ? 5 : 7); index += 1) press(KEY.DOWN);
    await settle(40);
    memories[mode] = {
      index: document.querySelector(".poster-card.cursor")!.getAttribute("data-poster-index"),
      transform: (document.querySelector(".poster-grid") as HTMLElement).style.transform,
    };
  }
  for (const [mode, sort] of [
    ["Movies", "Title"],
    ["Series", "Rating"],
  ] as const) {
    await chooseMode(mode);
    expect(screen.getByRole("button", { name: `Sort: ${sort}` })).toBeTruthy();
    press(KEY.RIGHT);
    expect(
      document.querySelector(".poster-card.cursor")?.getAttribute("data-poster-index"),
    ).toBe(memories[mode].index);
    expect((document.querySelector(".poster-grid") as HTMLElement).style.transform).toBe(
      memories[mode].transform,
    );
  }
});

test.each(["Movies", "Series"] as const)(
  "%s favourites are the final full detail action and never start playback",
  async (mode) => {
    const view = await mountLibrary();
    await chooseMode(mode);
    await chooseButton(mode === "Movies" ? /Film, exactly/ : /Series, exactly/);
    const favourite = screen.getByRole("button", { name: "Add to Favourites" });
    expect(favourite.classList.contains("vod-action")).toBe(true);
    expect(favourite.parentElement?.classList.contains("vod-actions")).toBe(true);
    expect(favourite.parentElement?.lastElementChild).toBe(favourite);
    expect(favourite.textContent).toContain("Add to Favourites");
    const actions = document.querySelectorAll(".vod-actions .vod-action");
    for (let index = 1; index < actions.length; index++) press(KEY.DOWN);
    expect(favourite.classList.contains("cursor")).toBe(true);

    press(KEY.ENTER);
    await settle(0);
    expect(
      screen
        .getByRole("button", { name: "Remove from Favourites" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(view.usePersonal.getState().favourites).toHaveLength(1);
    expect(playCalls).toHaveLength(0);
    press(KEY.GREEN);
    await settle(0);
    expect(
      screen.getByRole("button", { name: "Add to Favourites" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(playCalls).toHaveLength(0);
  },
);

test("returning to the category rail does not replace its saved window before measurement", () => {
  const height = vi.spyOn(viewport, "useViewport").mockReturnValue(840);
  const inputMode = document.documentElement.dataset.inputMode;
  document.documentElement.dataset.inputMode = "pointer";
  const remember = vi.fn();
  const offset = 30 * RAIL_ROW_BASE + 37;
  const props: VodCategoryRailProps = {
    items: Array.from({ length: 100 }, (_, index) => ({
      key: `category:${index}`,
      name: `Category ${index}`,
      source: "provider",
    })),
    cursor: 5,
    selectedKey: "category:5",
    focused: false,
    scale: 1,
    firstRow: 30,
    scrollOffset: offset,
    onFocus: vi.fn(),
    onSelect: vi.fn(),
    onWindowChange: remember,
  };
  try {
    const beforeDetails = render(<VodCategoryRail {...props} />);
    expect(remember).toHaveBeenLastCalledWith(30, offset);
    const position = document.querySelector<HTMLElement>(".vod-rail-window")!.style.transform;
    beforeDetails.unmount();
    remember.mockClear();
    height.mockReturnValue(0);
    const returned = render(<VodCategoryRail {...props} />);
    expect(remember).not.toHaveBeenCalled();
    height.mockReturnValue(840);
    returned.rerender(<VodCategoryRail {...props} />);
    expect(remember).toHaveBeenCalledTimes(1);
    expect(remember).toHaveBeenLastCalledWith(30, offset);
    expect(document.querySelector<HTMLElement>(".vod-rail-window")!.style.transform).toBe(
      position,
    );
    expect(document.querySelector(".vod-category.selected")).toBeNull();
  } finally {
    height.mockRestore();
    if (inputMode === undefined) delete document.documentElement.dataset.inputMode;
    else document.documentElement.dataset.inputMode = inputMode;
  }
});

test("virtual poster focus never adds native scrolling to the window offset", () => {
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  render(
    <PosterGrid
      items={Array.from({ length: 30 }, (_, index) => ({
        key: `movie:${index}`,
        kind: "movie" as const,
        title: `Movie ${index}`,
        poster: "",
        metadata: "",
        rating: "",
        favourite: false,
      }))}
      resourceState="loaded"
      cursor={12}
      firstRow={2}
      focused
      fetchReady={false}
      artworkActive={false}
      scale={1}
      columns={6}
      onFocus={() => undefined}
      onActivate={() => undefined}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );
  expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
});

function preparationFixture(viewportHeight = 1128) {
  const height = vi.spyOn(viewport, "useViewport").mockReturnValue(viewportHeight);
  const claim = vi.spyOn(artworkService, "claimArtwork").mockImplementation(() => {});
  const load = vi.spyOn(artworkService, "loadArtwork").mockResolvedValue(null);
  const release = vi.spyOn(artworkService, "releaseArtwork").mockImplementation(() => {});
  const props: PosterGridProps = {
    items: Array.from({ length: 90 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie",
      title: `Movie ${index}`,
      poster: `https://images.example/preparation-${index}.jpg`,
      metadata: "",
      rating: "",
      favourite: false,
    })),
    resourceState: "loaded",
    cursor: 12,
    firstRow: 2,
    focused: false,
    fetchReady: false,
    artworkActive: true,
    scale: 1,
    columns: 6,
    onFocus: () => {},
    onActivate: () => {},
    onRetry: () => {},
    onWheel: () => {},
  };
  return {
    props,
    claim,
    load,
    release,
    restore: () => {
      cleanup();
      height.mockRestore();
      claim.mockRestore();
      load.mockRestore();
      release.mockRestore();
    },
  };
}

test("committed grids claim eighteen nearby posters before loading without intersection or permission", () => {
  const fixture = preparationFixture();
  try {
    const view = render(<PosterGrid {...fixture.props} />);
    const requests = fixture.props.items.slice(12, 30).map((item) => ({
      url: item.poster,
      kind: "poster",
      width: 192,
      height: 288,
    }));
    expect(fixture.claim.mock.calls.map(([request]) => request)).toEqual(requests);
    expect(fixture.load.mock.calls.map(([request]) => request)).toEqual(
      requests.map((request) => ({ ...request, eager: false })),
    );
    expect(Math.max(...fixture.claim.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...fixture.load.mock.invocationCallOrder),
    );
    view.rerender(<PosterGrid {...fixture.props} fetchReady />);
    expect(fixture.release).not.toHaveBeenCalled();
    expect(fixture.claim).toHaveBeenCalledTimes(18);
    view.rerender(<PosterGrid {...fixture.props} artworkActive={false} />);
    expect(fixture.release.mock.calls.map(([request]) => request)).toEqual(requests);
  } finally {
    fixture.restore();
  }
});

test.each(["idle", "loading", "empty", "failed"] as const)(
  "a %s grid does not prepare artwork until its loaded window is active",
  (resourceState) => {
    const fixture = preparationFixture();
    try {
      const view = render(<PosterGrid {...fixture.props} resourceState={resourceState} />);
      expect(fixture.load).not.toHaveBeenCalled();
      view.rerender(<PosterGrid {...fixture.props} artworkActive={false} />);
      expect(fixture.claim).not.toHaveBeenCalled();
      view.rerender(<PosterGrid {...fixture.props} />);
      expect(fixture.claim).toHaveBeenCalledTimes(18);
      view.rerender(<PosterGrid {...fixture.props} resourceState={resourceState} />);
      expect(fixture.release).toHaveBeenCalledTimes(18);
    } finally {
      fixture.restore();
    }
  },
);

test("preparation ignores metadata changes and releases its previous window on movement", () => {
  vi.useFakeTimers();
  const fixture = preparationFixture();
  try {
    const view = render(<PosterGrid {...fixture.props} />);
    const items = fixture.props.items.map((item) => ({
      ...item,
      title: `${item.title} renamed`,
      favourite: true,
      metadata: "Updated",
    }));
    view.rerender(<PosterGrid {...fixture.props} items={items} />);
    expect(fixture.claim).toHaveBeenCalledTimes(18);
    expect(fixture.release).not.toHaveBeenCalled();
    const old = fixture.claim.mock.calls.map(([request]) => request);
    view.rerender(<PosterGrid {...fixture.props} items={items} cursor={48} firstRow={8} />);
    expect(fixture.release.mock.calls.map(([request]) => request)).toEqual(old);
    expect(fixture.claim).toHaveBeenCalledTimes(18);
    act(() => vi.advanceTimersByTime(120));
    expect(fixture.claim).toHaveBeenCalledTimes(36);
    expect(fixture.claim.mock.calls.slice(18).map(([request]) => request.url)).toEqual(
      items.slice(48, 66).map((item) => item.poster),
    );
  } finally {
    fixture.restore();
  }
});

test("held poster movement retains overlap and prepares only the final settled window", () => {
  vi.useFakeTimers();
  const fixture = preparationFixture();
  try {
    const props = { ...fixture.props, focused: true, fetchReady: true };
    const view = render(<PosterGrid {...props} />);
    view.rerender(<PosterGrid {...props} cursor={18} firstRow={3} />);
    act(() => vi.advanceTimersByTime(100));
    view.rerender(<PosterGrid {...props} cursor={24} firstRow={4} />);
    expect(screen.getByRole("grid").getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("gridcell", { name: "Movie 24" }).id,
    );
    expect(fixture.claim).toHaveBeenCalledTimes(18);
    expect(fixture.release.mock.calls.map(([request]) => request.url)).toEqual(
      props.items.slice(12, 24).map((item) => item.poster),
    );
    act(() => vi.advanceTimersByTime(119));
    expect(fixture.load).toHaveBeenCalledTimes(18);
    act(() => vi.advanceTimersByTime(1));
    expect(fixture.load.mock.calls.slice(18).map(([request]) => request.url)).toEqual(
      props.items.slice(30, 42).map((item) => item.poster),
    );
    view.rerender(<PosterGrid {...props} cursor={48} firstRow={8} />);
    view.unmount();
    act(() => vi.advanceTimersByTime(120));
    expect(fixture.load).toHaveBeenCalledTimes(30);
  } finally {
    fixture.restore();
  }
});

test("preparation excludes empty URLs and identical poster renditions", () => {
  const fixture = preparationFixture();
  try {
    const items = fixture.props.items.slice(0, 30).map((item, index) => ({
      ...item,
      poster:
        index === 12 || index >= 18
          ? ""
          : index === 14
            ? fixture.props.items[13].poster
            : item.poster,
    }));
    render(<PosterGrid {...fixture.props} items={items} />);
    expect(fixture.claim.mock.calls.map(([request]) => request.url)).toEqual(
      [13, 15, 16, 17].map((index) => items[index].poster),
    );
  } finally {
    fixture.restore();
  }
});

test("a short viewport prepares the current row and its next nearby row only", () => {
  const fixture = preparationFixture(376);
  try {
    render(<PosterGrid {...fixture.props} />);
    expect(fixture.claim.mock.calls.map(([request]) => request.url)).toEqual(
      fixture.props.items.slice(12, 24).map((item) => item.poster),
    );
  } finally {
    fixture.restore();
  }
});

test("episode preview stacks a full width image above the title and description", async () => {
  await mountLibrary({
    seriesInfo: {
      info: { name: "Series, exactly", category_id: "20" },
      episodes: {
        "1": [
          {
            id: "201",
            episode_num: 1,
            title: "Pilot, exactly",
            info: { plot: "Episode description", duration_secs: 1800 },
          },
        ],
      },
    },
  });
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");
  const preview = document.querySelector(".episode-preview")!;
  expect([...preview.children].map((child) => child.className)).toEqual([
    "episode-preview-art",
    "episode-preview-heading",
    "episode-preview-copy",
  ]);
  expect(preview.children[1].querySelector("h3")?.textContent).toBe("Pilot, exactly");
  expect(preview.children[2].textContent).toBe("Episode description");
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(/\.episode-preview-art \{[^}]*width:\s*100%;/.test(styles)).toBe(true);
});

test("Movies and Series use one opaque VOD surface with no Live panel behind it", async () => {
  await mountLibrary();
  await chooseMode("Movies");

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector('.live-panel-host[aria-hidden="false"] .panel')).toBeNull();

  press(KEY.BACK);
  await settle(0);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.querySelector(".vod-host:not(.hidden) .vod-screen")).toBeTruthy();
  expect(document.querySelector(".video")).toBeTruthy();
});

test("VOD categories remain rendered while application navigation expands", async () => {
  await mountLibrary();
  await chooseMode("Movies");

  expect(document.querySelector(".vod-rail .vod-category")).toBeTruthy();
  press(KEY.LEFT);
  await settle(0);

  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.querySelector(".vod-rail .vod-category")).toBeTruthy();
});

test("VOD browsing hides only the categories known to be empty", async () => {
  const movieCategories = [
    { category_id: "10", category_name: "Cinema, exactly" },
    { category_id: "30", category_name: "Empty, exactly", count: 0 },
    { category_id: "40", category_name: "Unknown, exactly" },
  ];
  const fetchImplementation = libraryFetch({ movieCategories });
  const view = await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation,
  });
  const { useLibrary } = await import("../src/stores/library");
  await chooseMode("Movies");

  const railNames = () =>
    [...document.querySelectorAll(".vod-rail .vod-category-name")].map(
      (element) => element.textContent,
    );
  expect(railNames()).toContain("Cinema, exactly");
  expect(railNames()).toContain("Unknown, exactly");
  expect(railNames()).not.toContain("Empty, exactly");

  const categoryFetches = fetchImplementation.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.includes("get_vod_streams") && url.includes("category_id="));
  expect(categoryFetches.some((url) => url.includes("category_id=30"))).toBe(false);
  expect(categoryFetches.some((url) => url.includes("category_id=40"))).toBe(false);

  expect(
    useLibrary
      .getState()
      .categoriesFor("movie")
      .map((category) => category.name),
  ).toContain("Empty, exactly");

  view.unmount();
  await mountApp("", {
    source: XTREAM_SOURCE,
    fetchImplementation: libraryFetch({ movieCategories }),
    appearance: { hideEmptyCategories: false },
  });
  await settle(300);

  expect(railNames()).toContain("Empty, exactly");
  expect(railNames()).toContain("Unknown, exactly");
});

test("the content pane reports busy while a category commit is pending", async () => {
  const { useLineup } = await mountLibrary();
  await chooseMode("Movies");

  act(() =>
    useLineup.setState({
      revision: useLineup.getState().revision + 1,
      categories: [
        ...useLineup.getState().categories,
        {
          key: "movie:11",
          name: "Docs, exactly",
          kind: "movie",
          channels: [],
          hidden: false,
          personal: false,
        },
      ],
    }),
  );

  const pane = () => document.querySelector(".vod-pane");
  expect(pane()?.getAttribute("aria-busy")).toBe("false");
  expect(document.querySelector(".vod-rail.focused")).toBeTruthy();
  expect(document.querySelector(".poster-card")).toBeTruthy();

  press(KEY.DOWN);
  expect(pane()?.getAttribute("aria-busy")).toBe("true");
  expect(document.querySelector(".poster-card")).toBeTruthy();
  await settle(149);
  expect(pane()?.getAttribute("aria-busy")).toBe("true");
  await settle(1);
  await settle(0);
  expect(pane()?.getAttribute("aria-busy")).toBe("false");
  expect(document.querySelector(".poster-card")).toBeTruthy();
});

test("VOD browsing survives a Live switch and returns to the selected poster", async () => {
  await mountLibrary({ movies: [movie(100, "First film"), movie(101, "Second film")] });
  await chooseMode("Movies");
  press(KEY.RIGHT);
  press(KEY.RIGHT);
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Second film");

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await settle(0);
  expect(document.querySelector(".live-host:not(.hidden)")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Second film");
});

test("Enter opens the first VOD poster without moving the cursor", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  press(KEY.RIGHT);

  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Film, exactly");
  press(KEY.ENTER);
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeTruthy();
});

test("Up from the first VOD grid row focuses Sort", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  press(KEY.RIGHT);
  press(KEY.UP);

  expect(screen.getByRole("button", { name: /Sort:/ }).classList.contains("cursor")).toBe(true);
});

test.each(["Movies", "Series"] as const)(
  "%s keeps the category title and sort geometry owners while loading",
  async (mode) => {
    const view = await mountLibrary();
    const original = view.fetch.getMockImplementation()!;
    const completions: Array<() => Promise<void>> = [];
    let held = true;
    view.fetch.mockImplementation((input: string | URL) => {
      const action = new URL(String(input)).searchParams.get("action");
      if (held && action === (mode === "Movies" ? "get_vod_streams" : "get_series")) {
        return new Promise<Response>((resolve) => {
          completions.push(async () => resolve(await original(input)));
        });
      }
      return original(input);
    });
    await chooseMode(mode);
    const heading = document.querySelector(".vod-category-heading h2");
    const sort = document.querySelector<HTMLButtonElement>(".vod-catalogue-action")!;
    expect(heading?.classList.contains("vod-category-title-skeleton")).toBe(true);
    expect(sort.disabled).toBe(true);
    expect(sort.classList.contains("vod-catalogue-action-skeleton")).toBe(true);
    expect(sort.querySelectorAll(".vod-sort-size")).toHaveLength(4);
    expect(completions.length).toBeGreaterThan(0);
    held = false;
    await act(async () => {
      for (const complete of completions.splice(0)) await complete();
    });
    await settle(300);
    expect(document.querySelector(".vod-category-heading h2")).toBe(heading);
    expect(document.querySelector(".vod-catalogue-action")).toBe(sort);
    expect(heading?.classList.contains("vod-category-title-skeleton")).toBe(false);
    expect(sort.disabled).toBe(false);
    expect(sort.querySelectorAll(".vod-sort-size")).toHaveLength(4);
  },
);

test("VOD browsing reaches physical edges while static headings and details stay safe", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  for (const selector of [".vod-catalogue", ".vod-search", ".vod-details"]) {
    const rule = styles.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule).toMatch(/height:\s*100%/);
    expect(rule).not.toMatch(/height:\s*calc\(100%\s*-\s*80px\)/);
  }
  expect(styles).toMatch(/\.vod-screen\.safe-area \{[^}]*padding:\s*0;/);
  expect(styles).toMatch(
    /\.vod-screen\.safe-area\.details-open \{[^}]*padding:\s*0 var\(--content-gutter\) var\(--safe-y\);/,
  );
  expect(styles).toMatch(
    /\.vod-category-header \{[^}]*padding:\s*var\(--safe-y\) var\(--s4\) var\(--s2\);/,
  );
});

test("loaded VOD details animate in after their skeleton", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.vod-details\.loaded \.vod-hero \{[^}]*animation:\s*vod-detail-content-in var\(--t-panel\) var\(--ease-enter\);/,
  );
  expect(styles).toMatch(
    /@keyframes vod-detail-content-in[\s\S]*from \{[^}]*opacity:\s*0;[^}]*transform:\s*translateY\(var\(--s2\)\);[\s\S]*to \{[^}]*opacity:\s*1;[^}]*transform:\s*translateY\(0\);/,
  );
  expect(styles).toMatch(
    /\.vod-details\.loaded \.vod-hero \{[^}]*animation:\s*none;[^}]*transform:\s*none;/,
  );
  expect(readFileSync("src/components/vod/VodDetails.tsx", "utf8")).toContain(
    'className="vod-details loaded"',
  );
  expect(readFileSync("src/components/vod/SeriesDetails.tsx", "utf8")).toContain(
    "vod-details loaded series-details",
  );
});

test("VOD Search keeps poster columns compact like category grids", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.poster-grid-row \{[^}]*grid-template-columns:\s*repeat\(var\(--poster-columns\),\s*var\(--poster-w\)\);[^}]*justify-content:\s*space-between;/,
  );
  expect(styles).toMatch(/\.vod-search \.poster-grid-row \{[^}]*justify-content:\s*center;/);
});

test("the TV edge uses a 40px Safe-Y and a 48px Safe-X", () => {
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const styles = readFileSync("src/styles/app.css", "utf8");

  expect(tokens).toMatch(/--safe-x:\s*48px;/);
  expect(tokens).toMatch(/--safe-y:\s*40px;/);
  expect(styles).toMatch(/\.app-navigation \{[^}]*padding:\s*var\(--safe-y\)/);
  expect(styles).toMatch(
    /\.panel-bar \{[^}]*padding:\s*var\(--safe-y\) var\(--safe-x\) var\(--s2\);/,
  );
  expect(styles).toMatch(/\.rail,\s*\.list \{[^}]*padding:\s*var\(--safe-y\)/);
  expect(styles).toMatch(/\.vod-rail \{[^}]*padding:\s*var\(--safe-y\)/);
  expect(styles).toMatch(/\.vod-category-header \{[^}]*padding:\s*var\(--safe-y\)/);
  expect(styles).toMatch(/\.sheet-rail \{[^}]*var\(--safe-y\)/);
  expect(styles).toMatch(/\.sheet-body \{[^}]*var\(--safe-y\)/);
  expect(styles).toMatch(/\.playlist-recovery \{[^}]*padding:\s*var\(--safe-y\)/);
});

test("VOD category rows keep balanced physical insets beside the divider", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(/\.vod-rail \{[^}]*padding:\s*var\(--safe-y\) 0;/);
  expect(styles).toMatch(
    /\.vod-rail-window \{[^}]*left:\s*var\(--s4\);[^}]*right:\s*var\(--s4\);/,
  );
  expect(styles).toMatch(/\.vod-catalogue \{[^}]*column-gap:\s*0;/);
  expect(styles).toMatch(
    /\.vod-category-divider::after \{[^}]*left:\s*var\(--s4\);[^}]*right:\s*var\(--s4\);/,
  );
  expect(styles).not.toMatch(/\.vod-category-divider \{[^}]*margin:/);
  expect(styles).toMatch(
    /\.vod-synthetic-divider \{[^}]*height:\s*1px;[^}]*margin:\s*var\(--s2\) 0;/,
  );
});

test("Live lists and full pages use the shared VOD insets", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.rail \.viewport,\s*\.list \.viewport \{[^}]*padding-left:\s*0;[^}]*padding-right:\s*0;/,
  );
  expect(styles).toMatch(
    /\.list \.window \{[^}]*left:\s*var\(--content-gutter\);[^}]*right:\s*var\(--content-gutter\);/,
  );
  expect(readFileSync("src/styles/tokens.css", "utf8")).toMatch(
    /--panel-w:\s*calc\(var\(--rail-w\) \+ var\(--list-w\)\);/,
  );
  expect(styles).toMatch(
    /\.sheet-body \{[^}]*padding:\s*var\(--safe-y\) var\(--content-gutter\);/,
  );
  expect(styles).toMatch(/\.vod-details \{[^}]*padding:\s*0;/);
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.sheet-body \{[^}]*padding:\s*var\(--safe-y\) var\(--content-gutter\);/,
  );
  expect(styles).toMatch(/html\[dir="rtl"\] \.vod-details \{[^}]*padding:\s*0;/);
  expect(styles).toMatch(/\.sheet-rail \.rail-scroll \.row \{[^}]*margin-right:\s*0;/);
  expect(styles).toMatch(
    /\.poster-grid-region \{[^}]*padding:\s*var\(--s2\) var\(--s4\) var\(--safe-y\);/,
  );
});

test("navigation and content surfaces share the 32px inner gutter", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  const tokens = readFileSync("src/styles/tokens.css", "utf8");

  expect(tokens).toMatch(/--content-gutter:\s*var\(--s4\);/);
  expect(tokens).toMatch(/--app-nav-gutter:\s*var\(--safe-x\);/);
  expect(styles).toMatch(/\.rail \{[^}]*padding-left:\s*0;/);
  expect(styles).toMatch(
    /\.sheet-rail \{[^}]*padding:\s*var\(--safe-y\) var\(--content-gutter\);/,
  );
  expect(styles).toMatch(
    /\.vod-screen\.safe-area\.details-open \{[^}]*padding:\s*0 var\(--content-gutter\) var\(--safe-y\);/,
  );
});

test("Settings keeps vertical breathing while VOD content uses wider grid margins", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");

  expect(styles).toMatch(
    /\.sheet-body \{[^}]*padding:\s*var\(--safe-y\) var\(--content-gutter\);/,
  );
  expect(styles).toMatch(
    /\.vod-category-header \{[^}]*padding:\s*var\(--safe-y\) var\(--s4\) var\(--s2\);/,
  );
  expect(styles).not.toMatch(/\.vod-category-header \{[^}]*min-height:/);
  expect(styles).toMatch(
    /\.poster-grid-region \{[^}]*padding:\s*var\(--s2\) var\(--s4\) var\(--safe-y\);/,
  );
});

test("Live pane headers share the content gutter with their rows", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.pane-head \{[^}]*padding-left:\s*var\(--content-gutter\);[^}]*padding-right:\s*var\(--content-gutter\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.pane-head \{[^}]*padding-left:\s*var\(--content-gutter\);[^}]*padding-right:\s*var\(--content-gutter\);/,
  );
});

test("Live headers use the VOD header bar and inset divider treatment", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(/\.pane-head \{[^}]*margin-bottom:\s*var\(--s2\);/);
  expect(styles).toMatch(
    /\.pane-head::after \{[\s\S]*left:\s*var\(--content-gutter\);[\s\S]*right:\s*var\(--content-gutter\);[\s\S]*background:\s*var\(--line\);/,
  );
  expect(styles).toMatch(
    /\.pane-head \{[^}]*padding-left:\s*var\(--content-gutter\);[^}]*padding-right:\s*var\(--content-gutter\);[^}]*padding-bottom:\s*var\(--s2\);[^}]*border-bottom:\s*0;/,
  );
  expect(styles).not.toMatch(/\.pane-head \{[^}]*min-height:/);
});

test("other divider headers use content height and standard breathing room", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.panel-bar \{[^}]*padding:\s*var\(--safe-y\) var\(--safe-x\) var\(--s2\);[^}]*border-bottom:/,
  );
  expect(styles).toMatch(
    /\.settings-list-header \{[^}]*padding:\s*0 0 var\(--s2\);[^}]*border-bottom:/,
  );
  expect(styles).toMatch(
    /\.playback-drawer-head \{[^}]*flex:\s*0 0 auto;[^}]*padding-bottom:\s*var\(--s2\);[^}]*border-bottom:/,
  );
});

test("VOD categories react to lineup rename and visibility revisions", async () => {
  const { useLineup, useLibrary } = await mountLibrary();
  await chooseMode("Movies");
  expect(screen.getByRole("heading", { name: "Cinema, exactly" })).toBeTruthy();

  const lineup = useLineup.getState();
  const category = {
    key: "movie:10",
    name: "Cinema renamed",
    kind: "movie" as const,
    channels: [],
    hidden: false,
    personal: false,
  };
  act(() =>
    useLineup.setState({
      playlistId: useLibrary.getState().playlistId,
      revision: lineup.revision + 1,
      categories: [...lineup.categories.filter((item) => item.kind !== "movie"), category],
    }),
  );
  expect(
    useLibrary
      .getState()
      .categoriesFor("movie")
      .map((item) => item.name),
  ).toContain("Cinema renamed");
  expect(screen.getByRole("heading", { name: "Cinema renamed" })).toBeTruthy();

  act(() =>
    useLineup.setState({
      revision: useLineup.getState().revision + 1,
      categories: [{ ...category, hidden: true }],
    }),
  );
  expect(!!screen.queryByText("Cinema renamed")).toBe(false);
});

test("hidden VOD does not rebuild categories for progress writes", async () => {
  const { useLibrary, usePersonal } = await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);
  await chooseButton("Play");
  const original = useLibrary.getState().categoriesFor;
  const categoriesFor = vi.fn(original);
  act(() => useLibrary.setState({ categoriesFor }));
  const calls = categoriesFor.mock.calls.length;

  act(() =>
    usePersonal.setState({
      progress: [
        {
          itemKey: "xtream:test:movie:100",
          playlistId: useLibrary.getState().playlistId,
          kind: "movie",
          providerId: "100",
          categoryKey: "movie:10",
          seconds: 30,
          duration: 120,
          updatedAt: 1,
          name: "Film, exactly",
          logo: "",
        },
      ],
    }),
  );

  expect(categoriesFor).toHaveBeenCalledTimes(calls);
  useLibrary.setState({ categoriesFor: original });
});

test("finite playback keeps the Live panel closed when VOD starts from a remembered Movie mode", async () => {
  localStorage.setItem("app:last-mode:pl-1", "movie");
  await mountLibrary();
  await settle(300);
  await chooseButton(/Film, exactly/);
  await chooseButton("Play");
  await settle(0);

  expect(document.querySelector(".panel")?.classList.contains("away")).toBe(true);
});

test("finite playback keeps the visible browser video exposed while time and stats update", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);
  await chooseButton("Play");
  setPlaybackTime(30, 120);
  await settle(1_000);
  press(KEY.ENTER);
  await settle(0);

  const video = document.querySelector("video.video");
  expect(video?.isConnected).toBe(true);
  expect(document.querySelector(".vod-host")?.classList.contains("hidden")).toBe(true);
  expect(document.querySelector(".app-navigation")?.classList.contains("visible")).toBe(false);
  expect(document.querySelector(".seekbar")?.textContent).toContain("0:30");
  expect(screen.queryByRole("button", { name: "More" })).toBeNull();

  press(KEY.BACK);
  await hold(KEY.ENTER);
  expect(document.querySelector(".playback-info")?.textContent).toContain("1920 × 1080");
  expect(document.querySelector(".playback-info")?.textContent).toContain("50 fps");
  expect(document.querySelector(".playback-drawer")).toBeNull();
  expect(video?.isConnected).toBe(true);
});

test("Stop invalidates a finite step while the next Movie detail is loading", async () => {
  const { useLibrary } = await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);
  await chooseButton("Play");
  const original = useLibrary.getState().loadMovie;
  let resolveLoad: (() => void) | undefined;
  act(() =>
    useLibrary.setState({
      loadMovie: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      ),
    }),
  );

  press(KEY.NEXT);
  await act(async () => Promise.resolve());
  expect(document.querySelector(".playback-deck")).toBeTruthy();
  expect(document.querySelector(".vod-host")?.classList.contains("hidden")).toBe(true);
  expect(playCalls).toHaveLength(1);

  press(KEY.STOP);
  resolveLoad?.();
  await act(async () => Promise.resolve());
  await settle(0);

  expect(playCalls).toHaveLength(1);
  expect(document.querySelector(".vod-details")).toBeTruthy();
  act(() => useLibrary.setState({ loadMovie: original }));
});

test("the shared rail switches VOD modes and Search remains scoped", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  press(KEY.LEFT);
  press(KEY.DOWN);
  press(KEY.ENTER);
  await settle(300);
  expect(document.querySelector(".vod-screen[data-mode='series']")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: /Search Series/ })).toBeTruthy();
});

test("browser typing reaches the VOD Search input without window navigation", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ });

  expect(fireEvent.keyDown(field, { key: "f", code: "KeyF", keyCode: 70 })).toBe(true);
  fireEvent.input(field, { target: { value: "f" } });
  await settle(0);

  expect((field as HTMLInputElement).value).toBe("f");
  expect(document.activeElement).toBe(field);
  expect(document.querySelector(".vod-search")).toBeTruthy();
});

test("VOD Search keeps caret movement native until an inline boundary", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ }) as HTMLInputElement;
  fireEvent.input(field, { target: { value: "Film" } });
  field.setSelectionRange(2, 2);

  fireEvent.keyDown(field, { keyCode: KEY.LEFT });

  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
  expect(document.activeElement).toBe(field);
});

test("VOD Search inline start preserves Search while application navigation owns input", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ }) as HTMLInputElement;
  fireEvent.input(field, { target: { value: "Film" } });
  field.setSelectionRange(0, 0);

  fireEvent.keyDown(field, { keyCode: KEY.LEFT });
  await settle(0);

  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search Movies" }));

  press(KEY.RIGHT);
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(document.activeElement).toBe(field);
});

test("empty VOD Search keeps its real disabled submit outside navigation", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ }) as HTMLInputElement;
  field.setSelectionRange(0, 0);

  fireEvent.keyDown(field, { keyCode: KEY.RIGHT });
  const submit = document.querySelector<HTMLButtonElement>(".vod-search-submit")!;
  expect(submit.disabled).toBe(true);
  expect(document.activeElement).toBe(field);
  expect(document.querySelector(".vod-search")).toBeTruthy();
});

test("VOD Search leaves the keyboard before leaving the search surface", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ });

  fireEvent.keyDown(field, { keyCode: KEY.BACK });
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(document.activeElement).not.toBe(field);

  fireEvent.keyDown(field, { keyCode: KEY.BACK });
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeNull();
});

test("VOD Search applies a typed query after its settle delay", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ });

  fireEvent.input(field, { target: { value: "Film" } });
  await settle(200);

  expect(document.querySelector(".vod-search .poster-card")?.textContent).toContain(
    "Film, exactly",
  );
});

test("Search grid owns focus and exits to application navigation", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ });
  fireEvent.input(field, { target: { value: "Film" } });
  await settle(300);

  fireEvent.keyDown(field, { keyCode: KEY.DOWN });
  await settle(0);
  const card = document.querySelector<HTMLButtonElement>(".vod-search .poster-card");
  expect(card).toBeTruthy();
  expect(document.activeElement).toBe(card?.closest('[role="grid"]'));
  expect(document.activeElement?.getAttribute("aria-activedescendant")).toBe(
    card?.parentElement?.id,
  );

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search Movies" }));
});

test("Search Retry reloads the current nonempty query without a category id", async () => {
  const view = await mountLibrary({ failIndexCount: 2 });
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  const field = screen.getByRole("textbox");
  fireEvent.input(field, { target: { value: "Film" } });
  await settle(200);
  fireEvent.keyDown(field, { keyCode: KEY.DOWN });
  const retry = screen.getByRole("button", { name: "Retry" });
  expect(retry).toBeTruthy();
  expect(retry.getAttribute("data-selected")).toBe("true");

  press(KEY.ENTER);
  await settle(0);

  const fetch = view.fetch as ReturnType<typeof vi.fn>;
  const indexCalls = fetch.mock.calls.filter(([input]) => {
    const url = new URL(String(input));
    return (
      url.searchParams.get("action") === "get_vod_streams" &&
      !url.searchParams.has("category_id")
    );
  });
  expect(indexCalls).toHaveLength(2);
});

test("poster wheel input scrolls the viewport without changing the remote cursor", async () => {
  await mountLibrary({ movies: Array.from({ length: 80 }, (_, index) => movie(index + 1)) });
  await chooseMode("Movies");
  press(KEY.RIGHT);
  const region = document.querySelector(".poster-grid-region");
  if (!region) throw new Error("Poster grid region did not render");

  fireEvent.wheel(region, { deltaY: 48 });
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Movie 1");
  expect(document.documentElement.dataset.inputMode).toBe("pointer");
  expect(document.querySelector<HTMLElement>(".poster-grid")?.style.transform).toContain(
    "-48px",
  );
  expect(document.querySelector(".scrollbar.show")).toBeTruthy();
});

test("scroll indicator arithmetic clamps stale windows to the track", () => {
  expect(scrollIndicatorMetrics(100, -20, 25)).toEqual({ ratio: 0.25, progress: 0 });
  expect(scrollIndicatorMetrics(100, 200, 25)).toEqual({ ratio: 0.25, progress: 1 });
  expect(scrollIndicatorMetrics(100, Number.POSITIVE_INFINITY, 250)).toEqual({
    ratio: 1,
    progress: 0,
  });
});

test("scroll indicator styles keep both orientations inside their tracks", () => {
  const vertical = render(<ScrollIndicator count={100} first={200} visible={25} />);
  const verticalThumb = document.querySelector<HTMLElement>(".scrollbar-thumb")!;
  expect(verticalThumb.style.height).toBe("25%");
  expect(verticalThumb.style.top).toBe("100%");
  expect(verticalThumb.style.transform).toBe("translateY(-100%)");
  vertical.unmount();

  document.documentElement.dir = "rtl";
  render(<ScrollIndicator count={100} first={200} visible={25} orientation="horizontal" />);
  const horizontalThumb = document.querySelector<HTMLElement>(".scrollbar-thumb")!;
  expect(horizontalThumb.style.width).toBe("25%");
  expect(horizontalThumb.style.right).toBe("100%");
  expect(horizontalThumb.style.transform).toBe("translateX(100%)");
  document.documentElement.dir = "ltr";
});

test("horizontal indicators stay hidden until scrolling and withdraw after movement", () => {
  vi.useFakeTimers();
  const view = render(
    <ScrollIndicator count={100} first={0} visible={25} orientation="horizontal" />,
  );
  expect(document.querySelector(".scrollbar.show")).toBeNull();

  view.rerender(
    <ScrollIndicator count={100} first={10} visible={25} orientation="horizontal" />,
  );
  expect(document.querySelector(".scrollbar.show")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1_999));
  expect(document.querySelector(".scrollbar.show")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1));
  expect(document.querySelector(".scrollbar.show")).toBeNull();
});

test("scroll tracks use symmetric insets and are invisible while inactive", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.scrollbar \{[^}]*opacity:\s*0;/);
  expect(css).toMatch(
    /\.scrollbar\.vertical \{[^}]*top:\s*var\(--s2\);[^}]*bottom:\s*var\(--s2\);/,
  );
});

test("Movie details Back restores the exact poster origin", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  press(KEY.UP);
  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".app-navigation.expanded")).toBeTruthy();
  press(KEY.RIGHT);
  await settle(0);
  press(KEY.BACK);
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Film, exactly");
});

test("clicking active Movies returns from details to the Movie grid", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".vod-screen[data-mode='movie'] .vod-catalogue")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
});

test("clicking active Series returns from details to the Series grid", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(0);

  expect(document.querySelector(".series-details")).toBeNull();
  expect(document.querySelector(".vod-screen[data-mode='series'] .vod-catalogue")).toBeTruthy();
  expect(document.querySelector(".app-navigation.expanded")).toBeNull();
});

test("switching VOD modes closes search instead of reusing its query", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  fireEvent.input(screen.getByRole("textbox", { name: /Search Movies/ }), {
    target: { value: "Film" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Series" }));
  await settle(300);
  expect(document.querySelector(".vod-search")).toBeNull();
  expect(document.querySelector(".vod-screen[data-mode='series'] .vod-catalogue")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);
  fireEvent.input(screen.getByRole("textbox", { name: /Search Series/ }), {
    target: { value: "Pilot" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Movies" }));
  await settle(300);
  expect(document.querySelector(".vod-search")).toBeNull();
  expect(document.querySelector(".vod-screen[data-mode='movie'] .vod-catalogue")).toBeTruthy();
});

test("Search from details closes details and opens the scoped search", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeNull();
  expect(screen.getByRole("textbox", { name: /Search Movies/ })).toBeTruthy();
});

test("Down from the focused Play action reaches the full Favourite action", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  press(KEY.DOWN);
  press(KEY.ENTER);

  expect(screen.getByRole("button", { name: "Remove from Favourites" })).toBeTruthy();
  expect(document.querySelector(".vod-details")).toBeTruthy();
});

test("Green toggles the visible VOD detail Favourite without changing depth", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);
  const favourite = screen.getByRole("button", { name: "Add to Favourites" });

  press(KEY.GREEN);

  expect(favourite.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector(".vod-details")).toBeTruthy();
});

test("failed Movie details expose one local Retry action", async () => {
  await mountLibrary({ failMovieDetailOnce: true });
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  const back = screen.getByRole("button", { name: "Back", exact: true });
  expect(back.classList.contains("vod-detail-back")).toBe(true);
  const retry = screen.getByRole("button", { name: "Retry" });
  fireEvent.click(retry);
  expect(document.querySelector(".vod-details.loading")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  await settle(0);
  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
});

test("Right activates the focused Series Play action like OK", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  press(KEY.RIGHT);
  await settle(0);

  expect(playCalls).toHaveLength(1);
});

test("Right activates the focused Episodes action like OK", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  press(KEY.DOWN);

  press(KEY.RIGHT);
  await settle(0);

  expect(document.querySelector(".series-details")?.classList.contains("panel-open")).toBe(
    true,
  );
});

test("episode list horizontal navigation switches seasons and closes at the start", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");

  const seasonRow = document.querySelector<HTMLElement>(".season-row")!;
  seasonRow.scrollLeft = 120;
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
  press(KEY.RIGHT);
  await settle(0);
  const seasonTwo = screen.getByRole("tab", { name: "Season 2" });
  expect(seasonTwo.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("option", { name: /Return, exactly/ })).toBeTruthy();
  expect(document.querySelector(".season-row")).toBe(seasonRow);
  expect(seasonRow.scrollLeft).toBe(120);
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(scrollIntoView.mock.instances[0]).toBe(seasonTwo);
  expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ inline: "nearest" });

  press(KEY.LEFT);
  await settle(0);
  const seasonOne = screen.getByRole("tab", { name: "Season 1" });
  expect(seasonOne.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("option", { name: /Pilot, exactly/ })).toBeTruthy();
  expect(document.querySelector(".season-row")).toBe(seasonRow);
  expect(seasonRow.scrollLeft).toBe(120);
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  expect(scrollIntoView.mock.instances[1]).toBe(seasonOne);
  expect(scrollIntoView.mock.calls[1][0]).toMatchObject({ inline: "nearest" });

  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".series-details")?.classList.contains("panel-open")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "Episodes" }).classList.contains("cursor")).toBe(
    true,
  );
});

test("episode window survives remote navigation through an empty season", async () => {
  const resizes = new Set<() => void>();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly notify: () => void) {}
      observe() {
        resizes.add(this.notify);
      }
      disconnect() {
        resizes.delete(this.notify);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.isConnected ? EPISODE_ROW_BASE * 6 : 0;
  });
  await mountLibrary({
    seriesInfo: {
      info: { name: "Series, exactly", category_id: "20" },
      seasons: [{ season_number: 1 }, { season_number: 2 }],
      episodes: {
        "1": Array.from({ length: 12 }, (_, index) => ({
          id: String(201 + index),
          episode_num: index + 1,
          title: `Installment ${index + 1}`,
          container_extension: "mp4",
        })),
        "2": [],
      },
    },
  });
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");

  const firstPage = screen.getAllByRole("option");
  expect(firstPage).toHaveLength(8);
  const firstEpisodeLabel = firstPage[0].getAttribute("aria-label");
  for (let index = 0; index < 11; index++) press(KEY.DOWN);
  expect(screen.getByRole("option", { selected: true }).getAttribute("aria-label")).toContain(
    "Installment 12",
  );

  const seasonRow = screen.getByRole("tablist");
  const seasonTabs = screen.getAllByRole("tab");
  seasonRow.scrollLeft = 120;
  const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

  press(KEY.RIGHT);
  await settle(0);
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByRole("tab", { selected: true })).toBe(seasonTabs[1]);

  // Browsers report zero height after an observed list is detached.
  act(() => {
    for (const resize of resizes) resize();
  });

  press(KEY.LEFT);
  await settle(0);
  expect(screen.getAllByRole("option")).toHaveLength(8);
  expect(screen.getByRole("option", { selected: true }).getAttribute("aria-label")).toBe(
    firstEpisodeLabel,
  );
  expect(screen.getByRole("listbox").querySelector<HTMLElement>("div")?.style.transform).toBe(
    "translateY(0px)",
  );
  expect(screen.getByRole("tablist")).toBe(seasonRow);
  expect(seasonRow.scrollLeft).toBe(120);
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  expect(scrollIntoView.mock.instances).toEqual([seasonTabs[1], seasonTabs[0]]);
  for (const [options] of scrollIntoView.mock.calls) {
    expect(options).toMatchObject({ inline: "nearest" });
  }

  press(KEY.DOWN);
  for (let index = 0; index < 11; index++) press(KEY.DOWN);
  expect(screen.getByRole("option", { selected: true }).getAttribute("aria-label")).toContain(
    "Installment 12",
  );
});

test("season row navigation selects seasons and closes at the start", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");

  press(KEY.UP);
  press(KEY.RIGHT);
  await settle(0);

  const seasonTwo = screen.getByRole("tab", { name: "Season 2" });
  expect(seasonTwo.getAttribute("aria-selected")).toBe("true");
  expect(seasonTwo.classList.contains("cursor")).toBe(true);
  expect(screen.getByRole("option", { name: /Return, exactly/ })).toBeTruthy();

  press(KEY.LEFT);
  press(KEY.LEFT);
  await settle(0);
  expect(document.querySelector(".series-details")?.classList.contains("panel-open")).toBe(
    false,
  );
  expect(screen.getByRole("button", { name: "Episodes" }).classList.contains("cursor")).toBe(
    true,
  );
});

test("episode hover changes visual focus without changing the selected season", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");

  const seasonTwo = screen.getByRole("tab", { name: "Season 2" });
  fireEvent.pointerMove(seasonTwo);
  fireEvent.pointerEnter(seasonTwo);

  expect(seasonTwo.getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("option", { name: /Pilot, exactly/ })).toBeTruthy();

  fireEvent.click(seasonTwo);
  await settle(0);
  expect(screen.getByRole("tab", { name: "Season 2" }).getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(screen.getByRole("option", { name: /Return, exactly/ })).toBeTruthy();
});

test("Back closes the inline episode panel before leaving Series details", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  expect(document.querySelector(".app-navigation")).toBeTruthy();
  await chooseButton("Episodes");
  expect(document.querySelector(".episode-panel")).toBeTruthy();

  press(KEY.BACK);
  await settle(0);

  expect(document.querySelector(".series-details")).toBeTruthy();
  expect(document.querySelector(".series-details")?.classList.contains("panel-open")).toBe(
    false,
  );
});

test("manual episode selection starts from zero and Back returns to the hidden Series origin", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");
  fireEvent.click(screen.getByRole("option", { name: /Pilot, exactly/ }));
  await settle(0);

  expect(playCalls[0][4]).toBeUndefined();
  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".series-details")).toBeTruthy();
  expect(document.querySelector(".episode-panel")).toBeTruthy();
});

test("Series continuation is derived once per input change and keeps playback targets current", async () => {
  const view = await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
  if (!detail) throw new Error("expected a loaded series detail");
  const seed = view.useLibrary.getState().progressSeedFor(detail.episodes[0], detail);
  if (!seed) throw new Error("expected a progress seed for the first episode");
  const original = view.useLibrary.getState().seriesContinueFor;
  const derive = vi.fn(original);
  try {
    act(() => view.useLibrary.setState({ seriesContinueFor: derive }));
    expect(derive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play S1:E1" })).toBeTruthy();

    press(KEY.DOWN);
    expect(screen.getByRole("button", { name: "Episodes" }).classList.contains("cursor")).toBe(
      true,
    );
    expect(derive).toHaveBeenCalledTimes(1);
    press(KEY.UP);
    expect(
      screen.getByRole("button", { name: "Play S1:E1" }).classList.contains("cursor"),
    ).toBe(true);
    expect(derive).toHaveBeenCalledTimes(1);
    await chooseButton("Episodes");
    const episodePanel = document.querySelector(".episode-panel");
    expect(episodePanel).toBeTruthy();
    expect(document.querySelector(".series-details.panel-open")).toBeTruthy();
    expect(playCalls).toHaveLength(0);
    expect(document.querySelector(".vod-host.hidden")).toBeNull();
    expect(derive).toHaveBeenCalledTimes(1);
    press(KEY.BACK);
    await settle(0);
    expect(document.querySelector(".series-details.panel-open")).toBeNull();
    expect(document.querySelector(".episode-panel")).toBe(episodePanel);
    expect(screen.getByRole("button", { name: "Episodes" }).classList.contains("cursor")).toBe(
      true,
    );
    expect(derive).toHaveBeenCalledTimes(1);

    const lastPlayed = view.usePersonal.getState().lastPlayed;
    act(() => view.usePersonal.getState().rememberProgress(seed, 605, 3600, "pause"));
    expect(view.usePersonal.getState().lastPlayed).toBe(lastPlayed);
    expect(screen.getByRole("button", { name: "Continue S1:E1, 50 min" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start from beginning S1:E1" })).toBeTruthy();
    expect(derive).toHaveBeenCalledTimes(2);

    act(() => view.usePersonal.getState().rememberProgress(seed, 905, 3600, "pause"));
    expect(screen.getByRole("button", { name: "Continue S1:E1, 45 min" })).toBeTruthy();
    expect(derive).toHaveBeenCalledTimes(3);

    act(() => view.usePersonal.setState({ progress: [] }));
    expect(screen.getByRole("button", { name: "Play S1:E1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Continue / })).toBeNull();
    expect(derive).toHaveBeenCalledTimes(4);

    act(() =>
      view.usePersonal.getState().rememberLast({
        playlistId: seed.playlistId,
        kind: "episode",
        itemKey: detail.episodes[0].key,
        categoryKey: detail.categoryKey,
      }),
    );
    expect(screen.getByRole("button", { name: "Play S2:E1" })).toBeTruthy();
    expect(derive).toHaveBeenCalledTimes(5);
    act(() =>
      view.usePersonal.getState().rememberLast({
        playlistId: seed.playlistId,
        kind: "episode",
        itemKey: detail.episodes[detail.episodes.length - 1].key,
        categoryKey: detail.categoryKey,
      }),
    );
    expect(screen.getByRole("button", { name: "Play S1:E1" })).toBeTruthy();
    expect(derive).toHaveBeenCalledTimes(6);

    act(() =>
      view.useLibrary.setState({
        seriesDetails: {
          ...view.useLibrary.getState().seriesDetails,
          [detail.key]: { state: "loaded", value: { ...detail } },
        },
      }),
    );
    expect(screen.getByRole("button", { name: "Play S1:E1" })).toBeTruthy();
    expect(derive).toHaveBeenCalledTimes(7);

    const replacement = vi.fn(original);
    act(() => view.useLibrary.setState({ seriesContinueFor: replacement }));
    expect(replacement).toHaveBeenCalledTimes(1);
    const nextSeed = view.useLibrary.getState().progressSeedFor(detail.episodes[1], detail);
    if (!nextSeed) throw new Error("expected a progress seed for the second episode");
    act(() => view.usePersonal.getState().rememberProgress(nextSeed, 1200, 3600, "pause"));
    expect(screen.getByRole("button", { name: "Continue S2:E1, 40 min" })).toBeTruthy();
    expect(replacement).toHaveBeenCalledTimes(2);
    await chooseButton("Continue S2:E1, 40 min");
    expect(playCalls[0][4]).toBe(1200);
  } finally {
    act(() => view.useLibrary.setState({ seriesContinueFor: original }));
  }
});

test("a partially watched episode shows its resume position instead of a watched underline", async () => {
  const view = await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
  if (!detail) throw new Error("expected a loaded series detail");
  const seed = view.useLibrary.getState().progressSeedFor(detail.episodes[0], detail);
  if (!seed) throw new Error("expected a progress seed for the first episode");
  act(() => view.usePersonal.getState().rememberProgress(seed, 605, 3600, "pause"));

  await chooseButton("Episodes");
  const row = screen.getByRole("option", { name: /Pilot, exactly/ });
  expect(row.getAttribute("aria-label")).toContain("Resume");
  const badge = row.querySelector(".episode-row-badge")!;
  expect(badge.classList.contains("episode-status")).toBe(true);
  expect(badge.querySelector(".icon-play")).toBeTruthy();
  expect(badge.querySelector(".icon-next")).toBeNull();
  expect(badge.querySelector(".episode-status-label")?.textContent).toBe("Resume");
  expect(row.querySelector(".episode-progress")).toBeNull();
  expect(row.textContent).not.toContain("Up next");
  expect(document.querySelector(".episode-progress")).toBeNull();
});

test("the Resume badge stays on its saved episode while selection moves to another row", async () => {
  const view = await mountLibrary({
    seriesInfo: {
      info: { name: "Series, exactly", category_id: "20" },
      episodes: {
        "1": [
          {
            id: "201",
            episode_num: 1,
            title: "Pilot, exactly",
            container_extension: "mp4",
          },
          {
            id: "202",
            episode_num: 2,
            title: "Another episode",
            container_extension: "mp4",
          },
        ],
      },
    },
  });
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
  if (!detail) throw new Error("expected a loaded series detail");
  const seed = view.useLibrary.getState().progressSeedFor(detail.episodes[0], detail);
  if (!seed) throw new Error("expected a progress seed for the first episode");
  act(() => view.usePersonal.getState().rememberProgress(seed, 605, 3600, "pause"));

  await chooseButton("Episodes");
  const savedRow = screen.getByRole("option", { name: /Pilot, exactly/ });
  expect(savedRow.querySelector(".episode-status-label")?.textContent).toBe("Resume");

  press(KEY.DOWN);
  await settle(0);

  const selected = screen.getByRole("option", { selected: true });
  expect(selected).not.toBe(savedRow);
  expect(selected.querySelector(".episode-status")).toBeNull();
  expect(savedRow.querySelector(".episode-status-label")?.textContent).toBe("Resume");
  expect(document.querySelectorAll(".episode-status-label")).toHaveLength(1);
});

test("only the genuine next episode carries the Up next badge", async () => {
  const view = await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
  if (!detail) throw new Error("expected a loaded series detail");
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().activePlaylist();
  if (!playlist) throw new Error("expected an active playlist");
  act(() =>
    view.usePersonal.setState({
      lastPlayed: {
        playlistId: playlist.id,
        kind: "episode",
        itemKey: detail.episodes[0].key,
        categoryKey: "series:20",
      },
    }),
  );

  await chooseButton("Episodes");
  const next = screen.getByRole("option", { name: /Return, exactly/ });
  expect(next.getAttribute("aria-label")).toContain("Up next");
  const badge = next.querySelector(".episode-status.episode-row-badge");
  expect(badge?.querySelector(".icon-next")).toBeTruthy();
  expect(badge?.querySelector(".icon-play")).toBeNull();
  expect(next.querySelector(".episode-progress")).toBeNull();
});

test("an unstarted series shows durations and no next or resume markers", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");

  const row = screen.getByRole("option", { name: /Pilot, exactly/ });
  expect(row.getAttribute("aria-label")).not.toContain("Up next");
  expect(row.getAttribute("aria-label")).not.toContain("Resume from");
  expect(row.querySelector(".episode-status")).toBeNull();
  expect(row.querySelector(".episode-duration")?.textContent).toContain("30 min");
  expect(row.textContent).not.toContain("Up next");
});

test("a finished series offers Play from the start without marking any row Up next", async () => {
  const view = await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);

  const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
  if (!detail) throw new Error("expected a loaded series detail");
  const { useSettings } = await import("../src/stores/settings");
  const playlist = useSettings.getState().activePlaylist();
  if (!playlist) throw new Error("expected an active playlist");
  const lastEpisode = detail.episodes[detail.episodes.length - 1];
  act(() =>
    view.usePersonal.setState({
      lastPlayed: {
        playlistId: playlist.id,
        kind: "episode",
        itemKey: lastEpisode.key,
        categoryKey: "series:20",
      },
    }),
  );

  await chooseButton("Episodes");
  expect(screen.getByRole("button", { name: /^Play / })).toBeTruthy();
  for (const row of document.querySelectorAll(".episode-row")) {
    expect(row.querySelector(".episode-status")).toBeNull();
    expect(row.textContent).not.toContain("Up next");
  }
});

test.each(["pointer", "remote"] as const)(
  "choosing a partially watched episode resumes at its saved seconds via %s",
  async (inputMode) => {
    const view = await mountLibrary();
    await chooseMode("Series");
    await chooseButton(/Series, exactly/);

    const detail = Object.values(view.useLibrary.getState().seriesDetails)[0]?.value;
    if (!detail) throw new Error("expected a loaded series detail");
    const seed = view.useLibrary.getState().progressSeedFor(detail.episodes[0], detail);
    if (!seed) throw new Error("expected a progress seed for the first episode");
    act(() => view.usePersonal.getState().rememberProgress(seed, 605, 3600, "pause"));

    await chooseButton("Episodes");
    const row = screen.getByRole("option", { name: /Pilot, exactly/ });
    expect(row.getAttribute("aria-label")).toContain("Resume");

    if (inputMode === "pointer") {
      fireEvent.click(row);
    } else {
      row.focus();
      press(KEY.ENTER);
    }
    await settle(0);

    expect(playCalls[0][4]).toBe(605);
  },
);

test("the episode selection marker sits at the inline end, mirrored in RTL", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.episode-row\[aria-selected="true"\]::before \{[^}]*right:\s*0;[^}]*left:\s*auto;[^}]*width:\s*4px;[^}]*height:\s*38%;[^}]*background:\s*var\(--accent\);/,
  );
  expect(styles).toMatch(
    /html\[dir="rtl"\] \.episode-row\[aria-selected="true"\]::before \{[^}]*right:\s*auto;[^}]*left:\s*0;/,
  );
  expect(styles).not.toMatch(/\.episode-progress \{/);
  expect(styles).toMatch(
    /\.episode-row-content \{[^}]*grid-template-columns:\s*32px minmax\(0, 1fr\) minmax\(0, 45%\);/,
  );
});

test("keyboard OK on an unplayable episode does nothing", async () => {
  await mountLibrary({ unplayableEpisode: true });
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");
  fireEvent.click(screen.getByRole("tab", { name: "Season 1" }));
  await settle(0);

  const episode = screen.getByRole("option", { name: /Pilot, exactly/ });
  expect(episode.getAttribute("aria-disabled")).toBe("true");
  press(KEY.ENTER);
  await settle(0);

  expect(playCalls).toEqual([]);
  expect(document.querySelector(".toast")).toBeNull();
  expect(document.querySelector(".episode-panel")).toBeTruthy();
});

test("poster grid windows a large catalogue and keeps complete accessible positions", () => {
  const items = Array.from({ length: 10_000 }, (_, index) => ({
    key: `movie:${index}`,
    kind: "movie" as const,
    title: `Movie ${index}`,
    poster: "",
    metadata: "2026",
    rating: index === 0 ? "8.4" : "",
    favourite: index === 0,
  }));
  render(
    <PosterGrid
      items={items}
      resourceState="loaded"
      cursor={0}
      firstRow={0}
      focused
      fetchReady={false}
      artworkActive={false}
      scale={1}
      columns={6}
      onFocus={() => undefined}
      onActivate={() => undefined}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );

  const cards = document.querySelectorAll(".poster-card");
  const grid = screen.getByRole("grid");
  const positions = screen.getAllByRole("gridcell");
  expect(cards.length).toBeLessThanOrEqual(12);
  expect(grid.getAttribute("aria-rowcount")).toBe("1667");
  expect(grid.getAttribute("aria-colcount")).toBe("6");
  expect(positions[0].parentElement?.getAttribute("aria-rowindex")).toBe("1");
  expect(positions[0].getAttribute("aria-colindex")).toBe("1");
  expect(grid.getAttribute("aria-activedescendant")).toBe(positions[0].id);
  expect(document.activeElement).toBe(grid);
  expect(cards[0].getAttribute("aria-label")).toContain("Rating 8.4 out of 10");
  expect(cards[0].getAttribute("aria-label")).toContain("In Favourites");
});

test("the first mounted poster activates its published item key before artwork loads", () => {
  const onFocus = vi.fn();
  const onActivate = vi.fn();
  render(
    <PosterGrid
      items={[
        {
          key: "movie:first",
          kind: "movie",
          title: "First film",
          poster: "https://images.example.invalid/first.jpg",
          metadata: "2026",
          rating: "",
          favourite: false,
        },
      ]}
      resourceState="loaded"
      cursor={0}
      firstRow={0}
      focused
      fetchReady={false}
      artworkActive={false}
      scale={1}
      columns={6}
      onFocus={onFocus}
      onActivate={onActivate}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );

  const poster = screen.getByRole("button", { name: /First film/ });
  document.documentElement.dataset.inputMode = "pointer";
  fireEvent.pointerMove(poster);
  fireEvent.pointerEnter(poster);
  expect(onFocus).toHaveBeenCalledWith(0);
  expect(onActivate).not.toHaveBeenCalled();

  fireEvent.click(poster);
  expect(onFocus).toHaveBeenCalledWith(0);
  expect(onActivate).toHaveBeenCalledWith("movie:first", 0);
  delete document.documentElement.dataset.inputMode;
});

test("poster row window uses negative overscan displacement", () => {
  vi.spyOn(viewport, "useViewport").mockReturnValue(376);
  render(
    <PosterGrid
      items={Array.from({ length: 60 }, (_, index) => ({
        key: `movie:${index}`,
        kind: "movie" as const,
        title: `Movie ${index}`,
        poster: "",
        metadata: "",
        rating: "",
        favourite: false,
      }))}
      resourceState="loaded"
      cursor={12}
      firstRow={0}
      focused
      fetchReady={false}
      artworkActive={false}
      scale={1}
      columns={6}
      onFocus={() => undefined}
      onActivate={() => undefined}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );
  expect(document.querySelector<HTMLElement>(".poster-grid")?.style.transform).toBe(
    "translateY(-376px)",
  );
});

test("poster row slots keep their nodes while titles and activation follow the new items", async () => {
  vi.useFakeTimers();
  vi.spyOn(viewport, "useViewport").mockReturnValue(376 * 2);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(460);
  const onFocus = vi.fn();
  const onActivate = vi.fn();
  const props: PosterGridProps = {
    items: Array.from({ length: 60 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie",
      title: `Movie ${index}`,
      poster: "",
      metadata: "",
      rating: "",
      favourite: false,
    })),
    resourceState: "loaded",
    cursor: 0,
    firstRow: 0,
    focused: true,
    fetchReady: false,
    artworkActive: false,
    scale: 1,
    columns: 6,
    onFocus,
    onActivate,
    onRetry: () => {},
    onWheel: () => {},
  };
  const view = render(<PosterGrid {...props} />);
  const previous = view.container.querySelector<HTMLButtonElement>('[data-poster-index="0"]')!;
  await act(async () => vi.advanceTimersByTime(DEFAULT_MARQUEE_DWELL_MS + 32));
  expect(previous.querySelector(".poster-title")?.classList.contains("overflowing")).toBe(true);
  view.rerender(<PosterGrid {...props} cursor={24} firstRow={3} />);
  const current = view.container.querySelector<HTMLButtonElement>('[data-poster-index="24"]')!;
  expect(current).toBe(previous);
  expect(current.querySelector(".poster-title")?.textContent).toBe("Movie 24");
  expect(current.querySelector(".poster-title")?.classList.contains("overflowing")).toBe(false);
  expect(view.container.querySelector('[data-poster-index="0"]')).toBeNull();
  expect(
    view.container.querySelector(".poster-grid")?.getAttribute("aria-activedescendant"),
  ).toBe(current.closest('[role="gridcell"]')?.id);
  fireEvent.click(current);
  expect(onFocus).toHaveBeenLastCalledWith(24);
  expect(onActivate).toHaveBeenLastCalledWith("movie:24", 24);
});

function posterMotionFixture() {
  vi.spyOn(viewport, "useViewport").mockReturnValue(376);
  const root = document.documentElement;
  const previousMode = root.dataset.inputMode;
  const previousEasing = root.style.getPropertyValue("--ease-enter");
  const easing = "cubic-bezier(0, 0, 0.2, 1)";
  root.dataset.inputMode = "remote";
  root.style.setProperty("--ease-enter", easing);
  const animate = vi.spyOn(Element.prototype, "animate");
  const computedStyle = vi.spyOn(globalThis, "getComputedStyle");
  const props: PosterGridProps = {
    items: Array.from({ length: 60 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie",
      title: `Movie ${index}`,
      poster: "",
      metadata: "",
      rating: "",
      favourite: false,
    })),
    resourceState: "loaded",
    cursor: 0,
    firstRow: 0,
    windowKey: "first",
    focused: true,
    fetchReady: false,
    artworkActive: false,
    scale: 1,
    columns: 6,
    onFocus: () => undefined,
    onActivate: () => undefined,
    onRetry: () => undefined,
    onWheel: () => undefined,
  };
  const view = render(<PosterGrid {...props} />);
  const grid = view.container.querySelector<HTMLElement>(".poster-grid")!;
  return {
    props,
    view,
    grid,
    animate,
    computedStyle,
    easing,
    restore: () => {
      view.unmount();
      if (previousMode === undefined) delete root.dataset.inputMode;
      else root.dataset.inputMode = previousMode;
      if (previousEasing) root.style.setProperty("--ease-enter", previousEasing);
      else root.style.removeProperty("--ease-enter");
    },
  };
}

test("poster window slides restart without a synchronous geometry read", () => {
  const fixture = posterMotionFixture();
  const { props, view, grid, animate, computedStyle, easing } = fixture;
  try {
    const geometry = vi.spyOn(grid, "getBoundingClientRect");
    const width = vi.spyOn(grid, "offsetWidth", "get");
    const focus = vi.spyOn(grid, "focus");
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<PosterGrid {...props} cursor={12} />);
    expect(grid.style.transform).toBe("translateY(-376px)");
    expect(animate).toHaveBeenNthCalledWith(
      1,
      [{ transform: "translateY(376px)" }, { transform: "translateY(-376px)" }],
      { duration: 120, easing },
    );
    expect(animate.mock.contexts[0]).toBe(grid);
    const first = animate.mock.results[0].value as Animation;
    const cancelFirst = vi.spyOn(first, "cancel");
    expect(document.activeElement).toBe(grid);
    expect(
      document.getElementById(grid.getAttribute("aria-activedescendant")!)?.textContent,
    ).toContain("Movie 12");
    expect(focus).not.toHaveBeenCalled();

    view.rerender(<PosterGrid {...props} cursor={18} />);
    expect(cancelFirst).toHaveBeenCalledOnce();
    expect(first.playState).toBe("idle");
    expect(animate).toHaveBeenNthCalledWith(
      2,
      [{ transform: "translateY(0px)" }, { transform: "translateY(-376px)" }],
      { duration: 120, easing },
    );
    const second = animate.mock.results[1].value as Animation;
    const cancelSecond = vi.spyOn(second, "cancel");
    view.rerender(<PosterGrid {...props} cursor={12} />);
    expect(cancelSecond).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenNthCalledWith(
      3,
      [{ transform: "translateY(-752px)" }, { transform: "translateY(-376px)" }],
      { duration: 120, easing },
    );
    view.rerender(<PosterGrid {...props} cursor={13} />);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(grid.style.getPropertyValue("--poster-scroll-from")).toBe("");
    expect(grid.style.animationName).toBe("");
    expect(computedStyle).toHaveBeenCalledExactlyOnceWith(document.documentElement);
    expect(geometry).not.toHaveBeenCalled();
    expect(width).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  } finally {
    fixture.restore();
  }
});

test("poster window identity changes cancel the owned slide without restarting it", () => {
  const fixture = posterMotionFixture();
  const { props, view, grid, animate } = fixture;
  try {
    view.rerender(<PosterGrid {...props} cursor={12} />);
    const cancel = vi.spyOn(animate.mock.results[0].value as Animation, "cancel");
    view.rerender(<PosterGrid {...props} cursor={12} windowKey="second" />);
    expect(cancel).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledOnce();
    expect(grid.style.transform).toBe("translateY(-376px)");
    expect(document.activeElement).toBe(grid);
    view.rerender(<PosterGrid {...props} cursor={18} windowKey="second" />);
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    fixture.restore();
  }
});

test("pointer input cancels a poster slide without a render and retains pixel scrolling", async () => {
  const fixture = posterMotionFixture();
  const { props, view, grid, animate } = fixture;
  try {
    view.rerender(<PosterGrid {...props} cursor={12} />);
    const cancel = vi.spyOn(animate.mock.results[0].value as Animation, "cancel");
    await act(async () => {
      document.documentElement.dataset.inputMode = "pointer";
    });
    expect(cancel).toHaveBeenCalledOnce();
    view.rerender(<PosterGrid {...props} cursor={12} />);
    fireEvent.wheel(grid, { deltaY: 37 });
    expect(animate).toHaveBeenCalledOnce();
    expect(grid.style.transform).toBe("translateY(-413px)");
    document.documentElement.dataset.inputMode = "remote";
    view.rerender(<PosterGrid {...props} cursor={18} />);
    expect(grid.style.transform).toBe("translateY(-376px)");
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    fixture.restore();
  }
});

test("reduced motion suppresses poster slides and cancels an active slide without a render", () => {
  const motion = {
    matches: true,
    addListener: vi.fn<(listener: () => void) => void>(),
    removeListener: vi.fn<(listener: () => void) => void>(),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(motion as unknown as MediaQueryList);
  const fixture = posterMotionFixture();
  const { props, view, grid, animate } = fixture;
  try {
    view.rerender(<PosterGrid {...props} cursor={12} />);
    expect(animate).not.toHaveBeenCalled();
    expect(grid.style.transform).toBe("translateY(-376px)");
    motion.matches = false;
    view.rerender(<PosterGrid {...props} cursor={18} />);
    expect(animate).toHaveBeenCalledOnce();
    const cancel = vi.spyOn(animate.mock.results[0].value as Animation, "cancel");
    act(() => {
      motion.matches = true;
      for (const [onMotion] of motion.addListener.mock.calls) onMotion();
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(grid.style.transform).toBe("translateY(-376px)");
    view.rerender(<PosterGrid {...props} cursor={24} />);
    expect(animate).toHaveBeenCalledOnce();
    view.unmount();
    for (const [onMotion] of motion.addListener.mock.calls) {
      expect(motion.removeListener).toHaveBeenCalledWith(onMotion);
    }
  } finally {
    fixture.restore();
  }
});

test("unmount cancels the owned poster slide and disconnects input observation", async () => {
  const fixture = posterMotionFixture();
  const { props, view, animate } = fixture;
  try {
    view.rerender(<PosterGrid {...props} cursor={12} />);
    const cancel = vi.spyOn(animate.mock.results[0].value as Animation, "cancel");
    view.unmount();
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => {
      document.documentElement.dataset.inputMode = "pointer";
    });
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    fixture.restore();
  }
});

test.each(["loading", "idle", "empty", "failed"] as const)(
  "leaving the loaded poster grid for %s cancels its slide",
  (resourceState) => {
    const fixture = posterMotionFixture();
    const { props, view, animate } = fixture;
    try {
      view.rerender(<PosterGrid {...props} cursor={12} />);
      const cancel = vi.spyOn(animate.mock.results[0].value as Animation, "cancel");
      view.rerender(<PosterGrid {...props} cursor={12} resourceState={resourceState} />);
      expect(cancel).toHaveBeenCalledOnce();
      expect(animate).toHaveBeenCalledOnce();
      expect(view.container.querySelector(".poster-grid")).toBeNull();
    } finally {
      fixture.restore();
    }
  },
);

test("episode window displacement matches its 76px row and 8px spacing", () => {
  const window = windowOf(12, 5, 252, 1, 0, EPISODE_ROW_BASE, 2);
  expect((window.start - window.first) * window.row).toBe(-168);
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.episode-row \{[^}]*height: 76px;/);
  expect(css).toMatch(/\.episode-row \{[^}]*margin-bottom: var\(--s1\);/);
});

test("season indicator stays inside its track during native scrolling", () => {
  render(
    <EpisodeList
      detail={
        {
          seasons: Array.from({ length: 10 }, (_, index) => index + 1),
          episodes: [
            {
              key: "episode:1",
              episodeId: "1",
              directSourceFingerprint: "",
              seasonKey: 1,
              season: 1,
              number: 1,
              name: "Pilot",
              durationSeconds: 1800,
              metadata: { rating: "", plot: "", releaseDate: "", image: "" },
            },
          ],
        } as never
      }
      seasonCursor={1}
      selectedSeason={1}
      episodeKey="episode:1"
      focusedZone="season"
      state="loaded"
      progress={[]}
      onSummaryFocus={() => undefined}
      onFocusSeason={() => undefined}
      onCommitSeason={() => undefined}
      onFocusEpisode={() => undefined}
      onSelectEpisode={() => undefined}
      onWheel={() => undefined}
    />,
  );
  const seasons = document.querySelector<HTMLElement>(".season-row")!;
  Object.defineProperty(seasons, "scrollWidth", { configurable: true, value: 1_000 });
  Object.defineProperty(seasons, "clientWidth", { configurable: true, value: 300 });
  Object.defineProperty(seasons, "scrollLeft", { configurable: true, value: 800 });

  fireEvent.scroll(seasons);

  const thumb = document.querySelector<HTMLElement>(".scrollbar.horizontal .scrollbar-thumb")!;
  expect(Number.parseFloat(thumb.style.left)).toBeLessThanOrEqual(100);
  expect(thumb.style.transform).toBe("translateX(-100%)");
});

test("changing seasons restarts the episode window at the first row", () => {
  vi.spyOn(viewport, "useViewport").mockReturnValue(252);
  const episode = (season: number, number: number) => ({
    key: `episode:${season}:${number}`,
    episodeId: `${season}:${number}`,
    directSourceFingerprint: "",
    seasonKey: season,
    season,
    number,
    name: `Episode ${season}:${number}`,
    durationSeconds: 1800,
    metadata: { rating: "", plot: "", releaseDate: "", image: "" },
  });
  const detail = {
    seasons: [1, 2],
    episodes: [
      ...Array.from({ length: 12 }, (_, index) => episode(1, index + 1)),
      episode(2, 1),
    ],
  } as never;
  const props = {
    detail,
    seasonCursor: 1 as const,
    episodeKey: "episode:1:12",
    focusedZone: "episode" as const,
    state: "loaded" as const,
    progress: [],
    onSummaryFocus: () => undefined,
    onFocusSeason: () => undefined,
    onCommitSeason: () => undefined,
    onFocusEpisode: () => undefined,
    onSelectEpisode: () => undefined,
    onWheel: () => undefined,
  };
  const view = render(<EpisodeList {...props} selectedSeason={1} />);

  expect(document.querySelector<HTMLElement>(".episode-list > div")?.style.transform).not.toBe(
    "translateY(0px)",
  );

  view.rerender(
    <EpisodeList {...props} seasonCursor={2} selectedSeason={2} episodeKey="episode:2:1" />,
  );

  expect(document.querySelector<HTMLElement>(".episode-list > div")?.style.transform).toBe(
    "translateY(0px)",
  );
});

test("VOD backdrop uses a real sibling shade and skeletons match the poster grid", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.vod-backdrop-shade \{[\s\S]*linear-gradient/);
  expect(css).not.toMatch(/\.vod-backdrop::after/);
  expect(css).toMatch(
    /\.vod-hero > \.placeholder,[\s\S]*\.series-poster > \.placeholder \{[\s\S]*display: flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;[\s\S]*radial-gradient[\s\S]*box-shadow:/,
  );
  expect(css).toMatch(
    /\.vod-hero > \.placeholder \.icon,[\s\S]*\.series-poster > \.placeholder \.icon \{[\s\S]*width: 72px;[\s\S]*height: 72px;/,
  );
  expect(css).toMatch(
    /\.poster-skeletons \{[^}]*repeat\(var\(--poster-columns\), var\(--poster-w\)\)[^}]*justify-content: space-between/,
  );
});

test("loading VOD categories render exactly eighteen poster skeletons without visible loading text", () => {
  render(
    <PosterGrid
      items={[]}
      resourceState="loading"
      cursor={0}
      firstRow={0}
      focused={false}
      fetchReady={false}
      scale={1}
      artworkActive={false}
      columns={6}
      onFocus={() => undefined}
      onActivate={() => undefined}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );

  expect(document.querySelectorAll(".poster-skeleton-card")).toHaveLength(18);
  expect(document.querySelector(".poster-grid-region.loading > p")).toBeNull();
  expect(
    document.querySelector(".poster-grid-region.loading .visually-hidden")?.textContent,
  ).toContain("Loading");
  expect(document.querySelector(".poster-grid-region.loading")?.getAttribute("role")).toBe(
    "status",
  );
});

test("VOD teleprompters use shared dwell timing and respect reduced motion", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(
    /animation:\s*var\(--teleprompter-animation\)\s+var\(--teleprompter-duration\)\s+linear\s+var\(--teleprompter-dwell\) 1 both;/,
  );
  expect(css).toMatch(
    /prefers-reduced-motion[\s\S]*teleprompter\.active\.overflowing[\s\S]*animation: none/,
  );
});

test("loading Movie details keeps the provider title without a Back button", () => {
  render(
    <VodDetails
      resource={{ state: "loading", stale: false, value: undefined }}
      origin={{
        mode: "movie",
        surface: "category",
        categoryKey: "movie:all",
        itemKey: "movie:1",
        itemIndex: 0,
        firstRow: 0,
      }}
      title="Provider title"
      favourite={false}
      focus={{ zone: "title", index: 0 }}
      onToggleFavourite={() => undefined}
      onPlay={() => undefined}
      onRetry={() => undefined}
    />,
  );
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByText("Provider title")).toBeTruthy();
});

test("Movie actions do not add a duplicate information drawer", () => {
  const progress = {
    itemKey: "movie:1",
    playlistId: "pl-1",
    kind: "movie" as const,
    providerId: "1",
    categoryKey: "movie:all",
    seconds: 60,
    updatedAt: 1,
    name: "Movie",
    logo: "",
  };
  expect(movieActions(undefined, false)).toEqual(["play", "favourite"]);
  expect(movieActions(undefined, true)).toEqual(["play", "favourite"]);
  expect(movieActions(progress, true)).toEqual(["resume", "restart", "favourite"]);
});

test("Movie details keeps Favourite in its action column and emits explicit resume choices", () => {
  const choices: Array<{ resumeAt: number; restart: boolean }> = [];
  render(
    <VodDetails
      resource={{
        state: "loaded",
        stale: false,
        value: {
          key: "xtream:pl-1:movie:100",
          streamId: "100",
          categoryKey: "movie:10",
          name: "A very long provider movie title 🧑‍🚀",
          logo: "",
          directSource: "",
          extension: "mp4",
          year: "2026",
          rating: "8.4",
          plot: "Provider synopsis",
          cast: "First Actor",
          director: "Director",
          genre: "Drama",
          releaseDate: "2026",
          durationSeconds: 7200,
          metadata: {
            backdrops: [],
            rating: "8.4",
            cast: ["First Actor"],
            director: "Director",
            genre: "Drama",
            releaseDate: "2026",
            country: "Italy",
            ageRating: "12",
          },
        },
      }}
      origin={{
        mode: "movie",
        surface: "category",
        categoryKey: "movie:10",
        itemKey: "xtream:pl-1:movie:100",
        itemIndex: 0,
        firstRow: 0,
      }}
      progress={{
        itemKey: "xtream:pl-1:movie:100",
        playlistId: "pl-1",
        kind: "movie",
        providerId: "100",
        categoryKey: "movie:10",
        seconds: 600,
        duration: 7200,
        updatedAt: 1,
        name: "Movie",
        logo: "",
      }}
      favourite={false}
      focus={{ zone: "actions", index: 0 }}
      onToggleFavourite={() => undefined}
      onPlay={(choice) => choices.push(choice)}
      onRetry={() => undefined}
    />,
  );

  const tags = document.querySelector<HTMLElement>(".vod-detail-tags");
  expect(tags?.classList.contains("deck-tags")).toBe(true);
  expect([...(tags?.children ?? [])].map((child) => child.textContent?.trim())).toEqual([
    "2026",
    "8.4",
    "Drama",
    "120 min",
    "",
  ]);
  expect(tags?.querySelector('img[alt="Italy"]')?.getAttribute("src")).toBe(
    `${import.meta.env.BASE_URL}flags/it.svg`,
  );
  expect(document.querySelector(".vod-hero-copy")?.textContent).not.toContain("Italy");
  expect(screen.getByRole("button", { name: "Add to Favourites" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Resume from/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
  expect(choices).toEqual([
    { resumeAt: 600, restart: false },
    { resumeAt: 0, restart: true },
  ]);
  const title = screen.getByText("A very long provider movie title 🧑‍🚀");
  expect(title.textContent).toContain("🧑‍🚀");
  expect(title.classList.contains("teleprompter")).toBe(false);
});

test("detail titles wrap and the copy panel aligns with the poster", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(
    /\.vod-title-row \{[^}]*min-height:\s*calc\(56px \* var\(--scale\)\);[^}]*height:\s*auto;/,
  );
  expect(styles).toMatch(
    /\.vod-detail-title \{[^}]*line-height:\s*1\.12;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*break-word;/,
  );
  expect(styles).toMatch(
    /\.vod-copy-panel \{[^}]*top:\s*12%;[^}]*bottom:\s*7%;[^}]*justify-content:\s*center;/,
  );
  expect(styles).toMatch(
    /\.vod-hero > \.artwork,[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\);/,
  );
  expect(styles).toMatch(
    /\.series-poster \{[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\) scale\(1\);/,
  );
  expect(styles).toMatch(
    /\.vod-detail-poster-skeleton \{[\s\S]*top:\s*50%;[\s\S]*transform:\s*translateY\(-50%\);/,
  );
});

test("Favourite action fills its star when active", () => {
  const styles = readFileSync("src/styles/app.css", "utf8");
  expect(styles).toMatch(/\.vod-action\.vod-favourite\.on \.icon \{[^}]*fill:\s*currentColor;/);
});

test("Series details show the season count in the shared metadata tag row", () => {
  render(
    <SeriesDetails
      resource={{
        state: "loaded",
        stale: false,
        value: {
          key: "xtream:pl-1:series:200",
          seriesId: "200",
          categoryKey: "series:20",
          name: "A series",
          logo: "",
          year: "2016",
          rating: "8.6",
          plot: "Provider synopsis",
          cast: "First Actor",
          director: "Director",
          genre: "Drama, Documentary",
          releaseDate: "2016",
          episodes: [],
          seasons: [1, 2, 3],
          metadata: {
            backdrops: [],
            rating: "8.6",
            cast: ["First Actor"],
            director: "Director",
            genre: "Drama, Documentary",
            releaseDate: "2016",
            country: "Italy",
            ageRating: "12",
          },
        },
      }}
      origin={{
        mode: "series",
        surface: "category",
        categoryKey: "series:20",
        itemKey: "xtream:pl-1:series:200",
        itemIndex: 0,
        firstRow: 0,
      }}
      continueTarget={null}
      favourite={false}
      actionIndex={0}
      episodePanelOpen={false}
      onToggleFavourite={() => undefined}
      onContinue={() => undefined}
      onRestart={() => undefined}
      onToggleEpisodes={() => undefined}
      onRetry={() => undefined}
    />,
  );

  const tags = document.querySelector<HTMLElement>(".vod-detail-tags");
  expect(tags?.classList.contains("deck-tags")).toBe(true);
  expect([...(tags?.children ?? [])].map((child) => child.textContent?.trim())).toEqual([
    "2016",
    "8.6",
    "Drama, Documentary",
    "3 Seasons",
    "",
  ]);
  expect(tags?.querySelector('img[alt="Italy"]')?.getAttribute("src")).toBe(
    `${import.meta.env.BASE_URL}flags/it.svg`,
  );
  expect(document.querySelector(".vod-hero-copy")?.textContent).not.toContain("Italy");
  expect(screen.getByRole("button", { name: "Add to Favourites" })).toBeTruthy();
});

const loadedMovieDetail = (cast: string[], director: string) => ({
  key: "xtream:pl-1:movie:100",
  streamId: "100",
  categoryKey: "movie:10",
  name: "A movie",
  logo: "",
  directSource: "",
  extension: "mp4",
  year: "2026",
  rating: "8.4",
  plot: "Provider synopsis",
  cast: cast.join(", "),
  director,
  genre: "Drama",
  releaseDate: "2026",
  durationSeconds: 7200,
  metadata: {
    backdrops: [],
    rating: "8.4",
    cast,
    director,
    genre: "Drama",
    releaseDate: "2026",
    country: "",
    ageRating: "",
  },
});

const loadedSeriesDetail = (cast: string[], director: string) => ({
  key: "xtream:pl-1:series:200",
  seriesId: "200",
  categoryKey: "series:20",
  name: "A series",
  logo: "",
  year: "2016",
  rating: "8.6",
  plot: "Provider synopsis",
  cast: cast.join(", "),
  director,
  genre: "Drama",
  releaseDate: "2016",
  episodes: [],
  seasons: [1],
  metadata: {
    backdrops: [],
    rating: "8.6",
    cast,
    director,
    genre: "Drama",
    releaseDate: "2016",
    country: "",
    ageRating: "",
  },
});

const movieOrigin = {
  mode: "movie" as const,
  surface: "category" as const,
  categoryKey: "movie:10",
  itemKey: "xtream:pl-1:movie:100",
  itemIndex: 0,
  firstRow: 0,
};

const seriesOrigin = {
  mode: "series" as const,
  surface: "category" as const,
  categoryKey: "series:20",
  itemKey: "xtream:pl-1:series:200",
  itemIndex: 0,
  firstRow: 0,
};

const renderMovieCredits = (cast: string[], director: string) =>
  render(
    <VodDetails
      resource={{ state: "loaded", stale: false, value: loadedMovieDetail(cast, director) }}
      origin={movieOrigin}
      favourite={false}
      focus={{ zone: "actions", index: 0 }}
      onToggleFavourite={() => undefined}
      onPlay={() => undefined}
      onRetry={() => undefined}
    />,
  );

const renderSeriesCredits = (cast: string[], director: string) =>
  render(
    <SeriesDetails
      resource={{ state: "loaded", stale: false, value: loadedSeriesDetail(cast, director) }}
      origin={seriesOrigin}
      continueTarget={null}
      favourite={false}
      actionIndex={0}
      episodePanelOpen={false}
      onToggleFavourite={() => undefined}
      onContinue={() => undefined}
      onRestart={() => undefined}
      onToggleEpisodes={() => undefined}
      onRetry={() => undefined}
    />,
  );

test.each(["movie", "series"] as const)(
  "%s details label the director before the joined cast",
  (kind) => {
    if (kind === "movie") renderMovieCredits(["First Actor", "Second Actor"], "Director");
    else renderSeriesCredits(["First Actor", "Second Actor"], "Director");

    const rows = document.querySelectorAll<HTMLElement>(".vod-credit-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".icon-movie")).toBeTruthy();
    expect(rows[0].querySelector(".vod-credit-label")?.textContent).toBe("Director:");
    expect(rows[0].querySelector(".vod-credit-names")?.textContent).toBe("Director");
    expect(rows[1].querySelector(".icon-cast")).toBeTruthy();
    expect(rows[1].querySelector(".vod-credit-label")?.textContent).toBe("Cast:");
    expect(rows[1].querySelector(".vod-credit-names")?.textContent).toBe(
      "First Actor, Second Actor",
    );
  },
);

test.each(["movie", "series"] as const)("%s details hide absent credit rows", (kind) => {
  if (kind === "movie") renderMovieCredits([], "");
  else renderSeriesCredits([], "");
  expect(document.querySelectorAll(".vod-credit-row")).toHaveLength(0);

  cleanup();
  if (kind === "movie") renderMovieCredits(["Only Actor"], "");
  else renderSeriesCredits(["Only Actor"], "");
  const rows = document.querySelectorAll<HTMLElement>(".vod-credit-row");
  expect(rows).toHaveLength(1);
  expect(rows[0].querySelector(".icon-cast")).toBeTruthy();
  expect(rows[0].querySelector(".vod-credit-names")?.textContent).toBe("Only Actor");
});

test("episode references preserve missing numbers and use translated patterns", () => {
  const translate = (key: string, values: Record<string, string | number> = {}) => {
    if (key === "vod.episodeBoth") return `S${values.season}:E${values.episode}`;
    if (key === "vod.episodeOnly") return `Episode ${values.episode}`;
    if (key === "vod.seasonOnly") return `Season ${values.season} selected episode`;
    return "Selected episode";
  };
  expect(episodeReference({ season: 1, number: 3 }, translate as never)).toBe("S1:E3");
  expect(episodeReference({ number: 3 }, translate as never)).toBe("Episode 3");
  expect(episodeReference({ season: 1 }, translate as never)).toBe("Season 1 selected episode");
  expect(episodeReference({}, translate as never)).toBe("Selected episode");
  expect(episodeReference({}, translate as never)).not.toContain("S0:E0");
});

test.each([
  { mode: "Movies" as const, scope: "Movies", query: "Film", marker: "Film, exactly" },
  { mode: "Series" as const, scope: "Series", query: "Series", marker: "Series, exactly" },
])(
  "VOD Search Enter stays in the field and never submits early ($mode)",
  async ({ mode, scope, query, marker }) => {
    await mountLibrary();
    await chooseMode(mode);
    fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
    await settle(0);
    const field = screen.getByRole("textbox", {
      name: new RegExp(`Search ${scope}`),
    }) as HTMLInputElement;
    const count = () => document.querySelector(".vod-search-bar .count");
    const posters = () => document.querySelector(".vod-search .poster-card");

    fireEvent.input(field, { target: { value: query } });
    const plays = playCalls.length;
    // Enter before the debounce settles submits nothing and moves nothing.
    fireEvent.keyDown(field, { keyCode: KEY.ENTER });
    press(KEY.ENTER);
    await settle(0);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe(query);
    expect(count()).toBeNull();
    expect(posters()).toBeNull();
    expect(playCalls.length).toBe(plays);

    // The debounce still applies the query on its own schedule.
    await settle(250);
    expect(count()).toBeTruthy();
    expect(posters()?.textContent).toContain(marker);

    // The explicit Search button still submits on demand: a changed query
    // hides the count until it is applied, and the button applies it at once.
    fireEvent.input(field, { target: { value: `${query} ` } });
    await settle(0);
    expect(count()).toBeNull();
    fireEvent.click(document.querySelector<HTMLButtonElement>(".vod-search-submit")!);
    await settle(0);
    expect(count()).toBeTruthy();

    // Down reaches a result and Enter there still activates it.
    fireEvent.keyDown(field, { keyCode: KEY.DOWN });
    await settle(0);
    const card = document.querySelector<HTMLButtonElement>(".vod-search .poster-card");
    expect(document.activeElement).toBe(card?.closest('[role="grid"]'));
    expect(document.activeElement?.getAttribute("aria-activedescendant")).toBe(
      card?.parentElement?.id,
    );
    press(KEY.ENTER);
    await settle(0);
    expect(document.querySelector(".vod-details")).toBeTruthy();
  },
);
