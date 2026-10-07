import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EPISODE_ROW_BASE, episodeReference } from "../src/components/vod/EpisodeList";
import { PosterGrid } from "../src/components/vod/PosterGrid";
import { movieActions, VodDetails } from "../src/components/vod/VodDetails";
import { KEY } from "../src/hooks/useRemote";
import { windowOf } from "../src/hooks/useWindowed";
import { mountApp, playCalls, press, settle, XTREAM_SOURCE } from "./support/app";

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
    failMovieDetailOnce?: boolean;
    failIndexCount?: number;
    unplayableEpisode?: boolean;
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
      get_vod_categories: categories.movie,
      get_series_categories: categories.series,
      get_live_streams: [{ stream_id: "1", category_id: "1", name: "Live One" }],
      get_vod_streams: options.movies ?? [
        movie(100, "Film, exactly"),
        movie(101, "Another film"),
      ],
      get_series: [{ series_id: "200", category_id: "20", name: "Series, exactly" }],
      get_vod_info: {
        info: { name: "Film, exactly", plot: "A provider supplied plot" },
        movie_data: { stream_id: "100", category_id: "10", container_extension: "mp4" },
      },
      get_series_info: {
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
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => Promise.resolve());
  await settle(300);
}

async function chooseButton(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  await act(async () => Promise.resolve());
  await settle(0);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("Movies and Series use one opaque VOD surface with no Live panel behind it", async () => {
  await mountLibrary();
  await chooseMode("Movies");

  expect(document.querySelector(".vod-screen[data-mode='movie']")).toBeTruthy();
  expect(document.querySelector(".panel")).toBeNull();

  press(KEY.BACK);
  await settle(0);
  expect(document.querySelector(".vod-screen")).toBeNull();
  expect(document.querySelector(".video")).toBeTruthy();
});

test("VOD categories react to lineup rename and visibility revisions", async () => {
  const { useLineup, useLibrary } = await mountLibrary();
  await chooseMode("Movies");
  expect(screen.getByText("Cinema, exactly")).toBeTruthy();

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
  expect(screen.getByText("Cinema renamed")).toBeTruthy();

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
  press(KEY.STOP);
  resolveLoad?.();
  await act(async () => Promise.resolve());
  await settle(0);

  expect(playCalls).toHaveLength(1);
  expect(document.querySelector(".vod-details")).toBeTruthy();
  act(() => useLibrary.setState({ loadMovie: original }));
});

test("remote header controls switch modes and Search remains scoped", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  press(KEY.RIGHT);
  press(KEY.UP);
  await settle(0);
  expect(screen.getByRole("button", { name: "Movies" }).classList.contains("selected")).toBe(
    true,
  );

  press(KEY.RIGHT);
  await settle(0);
  press(KEY.ENTER);
  await settle(300);
  expect(document.querySelector(".vod-screen[data-mode='series']")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(0);
  expect(document.querySelector(".vod-search")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: /Search Series/ })).toBeTruthy();
});

test("browser typing reaches the VOD Search input without window navigation", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(0);
  const field = screen.getByRole("textbox", { name: /Search Movies/ });

  expect(fireEvent.keyDown(field, { key: "f", code: "KeyF", keyCode: 70 })).toBe(true);
  fireEvent.input(field, { target: { value: "f" } });
  await settle(0);

  expect((field as HTMLInputElement).value).toBe("f");
  expect(document.activeElement).toBe(field);
  expect(document.querySelector(".vod-search")).toBeTruthy();
});

test("Search Retry reloads the complete index without a category id", async () => {
  const view = await mountLibrary({ failIndexCount: 2 });
  await chooseMode("Movies");
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await settle(0);
  fireEvent.keyDown(screen.getByRole("textbox"), { keyCode: KEY.DOWN });
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();

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
  expect(indexCalls).toHaveLength(3);
});

test("poster wheel input moves one item and exposes a transient scroll indicator", async () => {
  await mountLibrary({ movies: Array.from({ length: 80 }, (_, index) => movie(index + 1)) });
  await chooseMode("Movies");
  press(KEY.RIGHT);
  const region = document.querySelector(".poster-grid-region");
  if (!region) throw new Error("Poster grid region did not render");

  fireEvent.wheel(region, { deltaY: 1 });
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Movie 2");
  fireEvent.wheel(region, { deltaY: 1 });
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Movie 2");
  expect(document.querySelector(".scrollbar.show")).toBeTruthy();
});

test("Movie details Back restores the exact poster origin", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
  press(KEY.BACK);
  await settle(0);

  expect(document.querySelector(".vod-details")).toBeNull();
  expect(document.querySelector(".poster-card.cursor")?.textContent).toContain("Film, exactly");
});

test("Up from the focused Play action reaches Favourite", async () => {
  await mountLibrary();
  await chooseMode("Movies");
  await chooseButton(/Film, exactly/);

  press(KEY.UP);
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

  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  await chooseButton("Retry");
  expect(screen.getByText("A provider supplied plot")).toBeTruthy();
});

test("Back closes the inline episode panel before leaving Series details", async () => {
  await mountLibrary();
  await chooseMode("Series");
  await chooseButton(/Series, exactly/);
  await chooseButton("Episodes");
  expect(document.querySelector(".episode-panel")).toBeTruthy();

  press(KEY.BACK);
  await settle(0);

  expect(document.querySelector(".series-details")).toBeTruthy();
  expect(document.querySelector(".series-details")?.classList.contains("panel-open")).toBe(false);
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
      scale={1}
      columns={6}
      onFocus={() => undefined}
      onActivate={() => undefined}
      onRetry={() => undefined}
      onWheel={() => undefined}
    />,
  );

  const cards = document.querySelectorAll(".poster-card");
  const positions = screen.getAllByRole("listitem");
  expect(cards.length).toBeLessThanOrEqual(12);
  expect(positions[0].getAttribute("aria-posinset")).toBe("1");
  expect(positions[0].getAttribute("aria-setsize")).toBe("10000");
  expect(cards[0].getAttribute("aria-label")).toContain("Rating 8.4 out of 10");
  expect(cards[0].getAttribute("aria-label")).toContain("In Favourites");
});

test("poster row window uses negative overscan displacement", () => {
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

test("episode window displacement matches its 76px row and 8px spacing", () => {
  const window = windowOf(12, 5, 252, 1, 0, EPISODE_ROW_BASE, 2);
  expect((window.start - window.first) * window.row).toBe(-168);
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.episode-row \{[^}]*height: 76px;/);
  expect(css).toMatch(/\.episode-row \{[^}]*margin-bottom: var\(--s1\);/);
});

test("VOD backdrop uses a real sibling shade and skeletons match the poster grid", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toMatch(/\.vod-backdrop-shade \{[\s\S]*linear-gradient/);
  expect(css).not.toMatch(/\.vod-backdrop::after/);
  expect(css).toMatch(
    /\.poster-skeletons \{[^}]*repeat\(var\(--poster-columns\), var\(--poster-w\)\)[^}]*justify-content: space-between/,
  );
});

test("VOD teleprompters wait 1.2 seconds and reduced motion removes movement", () => {
  const css = readFileSync("src/styles/app.css", "utf8");
  expect(css).toContain("animation: teleprompter-x 10s linear 1.2s infinite");
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
  expect(movieActions(undefined, false)).toEqual(["play"]);
  expect(movieActions(undefined, true)).toEqual(["play"]);
  expect(movieActions(progress, true)).toEqual(["resume", "restart"]);
});

test("Movie details keeps Favourite beside Rating and emits explicit resume choices", () => {
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

  expect(screen.getByRole("button", { name: "Add to Favourites" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Resume from/ }));
  fireEvent.click(screen.getByRole("button", { name: "Start from beginning" }));
  expect(choices).toEqual([
    { resumeAt: 600, restart: false },
    { resumeAt: 0, restart: true },
  ]);
  expect(screen.getByText("A very long provider movie title 🧑‍🚀").textContent).toContain(
    "🧑‍🚀",
  );
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
