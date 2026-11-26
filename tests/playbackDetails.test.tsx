import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ArtworkProps } from "../src/components/Artwork";
import type { PlaybackDetailsProps } from "../src/components/playback/PlaybackDetails";
import { KEY } from "../src/hooks/useRemote";
import { applyDocumentLocale, translate } from "../src/services/locale";
import type {
  XtreamEpisode,
  XtreamMovieDetail,
  XtreamSeriesDetail,
} from "../src/services/xtream";
import type { PlaybackTarget } from "../src/types";

/*
 * The information surface is presentational: the playlist, the engine and the store all
 * stay outside it. What is tested here is what it draws from the target and the two
 * detail models it is handed, how it scrolls and dismisses, and that it never reaches
 * for artwork the provider did not offer.
 */

const MOVIE_TARGET: PlaybackTarget = {
  id: "xtream:pl-1:movie:100",
  playlistId: "pl-1",
  mode: "finite",
  kind: "movie",
  name: "The Film",
  group: "Cinema",
  logo: "https://img.example/poster.jpg",
  year: "2019",
  rating: "7.5",
  url: "http://provider.example/movie/100.mp4",
};

const MINIMAL_TARGET: PlaybackTarget = {
  id: "xtream:pl-1:movie:101",
  playlistId: "pl-1",
  mode: "finite",
  kind: "movie",
  name: "Bare Film",
  group: "Cinema",
  logo: "",
  url: "http://provider.example/movie/101.mp4",
};

const MOVIE_DETAIL: XtreamMovieDetail = {
  key: MOVIE_TARGET.id,
  streamId: "100",
  categoryKey: "movie:10",
  name: "The Film",
  logo: "https://img.example/poster.jpg",
  directSource: "http://provider.example/movie/100.mp4",
  year: "2020",
  rating: "8.1",
  plot: "A complete synopsis that runs long enough to matter.",
  cast: "Lead Actor",
  director: "A Director",
  genre: "Drama",
  releaseDate: "2020-05-01",
  durationSeconds: 5400,
  metadata: {
    backdrops: ["https://img.example/backdrop.jpg"],
    rating: "8.1",
    cast: ["Lead Actor", "Second Actor"],
    director: "A Director",
    genre: "Drama",
    releaseDate: "2020-05-01",
    country: "US",
    ageRating: "PG-13",
  },
};

const EPISODE: XtreamEpisode = {
  key: "xtream:pl-1:episode:u:201",
  episodeIdentity: "201",
  episodeId: "201",
  directSource: "http://provider.example/episode/201.mp4",
  seriesKey: "xtream:pl-1:series:200",
  seasonKey: 1,
  season: 1,
  number: 2,
  name: "The Episode",
  durationSeconds: 2700,
  providerOrder: 0,
  metadata: {
    rating: "7.9",
    plot: "The episode synopsis, deliberately different from the series one.",
    releaseDate: "2021-03-04",
    image: "https://img.example/episode.jpg",
    durationSeconds: 2700,
  },
};

const SERIES_DETAIL: XtreamSeriesDetail = {
  key: "xtream:pl-1:series:200",
  seriesId: "200",
  categoryKey: "series:20",
  name: "The Series",
  logo: "https://img.example/series-poster.jpg",
  year: "2018",
  rating: "8.8",
  plot: "The series synopsis.",
  cast: "Series Lead",
  director: "Series Director",
  genre: "Crime",
  releaseDate: "2018-01-01",
  episodes: [EPISODE],
  seasons: [1],
  metadata: {
    backdrops: ["https://img.example/series-backdrop.jpg"],
    rating: "8.8",
    cast: ["Series Lead"],
    director: "Series Director",
    genre: "Crime",
    releaseDate: "2018-01-01",
    country: "UK",
    ageRating: "TV-MA",
  },
};

const EPISODE_TARGET: PlaybackTarget = {
  id: EPISODE.key,
  playlistId: "pl-1",
  mode: "finite",
  kind: "episode",
  name: "The Series \u00b7 S1:E2 \u00b7 The Episode",
  group: "Drama",
  logo: "https://img.example/series-poster.jpg",
  url: "http://provider.example/episode/201.mp4",
  progress: {
    itemKey: EPISODE.key,
    playlistId: "pl-1",
    kind: "episode",
    categoryKey: "series:20",
    name: "The Episode",
    logo: "https://img.example/series-poster.jpg",
    parentKey: SERIES_DETAIL.key,
    parentName: "The Series",
    season: 1,
    episode: 2,
  },
};

const artworkCalls: ArtworkProps[] = [];
let unavailableArtwork = "";

function pressKey(code: number, shiftKey = false, repeat = false) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    shiftKey,
    repeat,
  });
  Object.defineProperty(event, "keyCode", { get: () => code });
  act(() => window.dispatchEvent(event));
  return event;
}

async function mountDetails(props: Omit<PlaybackDetailsProps, "onClose">) {
  const { PlaybackDetails } = await import("../src/components/playback/PlaybackDetails");
  const onClose = vi.fn();
  render(<PlaybackDetails {...props} onClose={onClose} />);
  return onClose;
}

function makeScrollable() {
  const viewport = document.querySelector<HTMLElement>(".playback-details-scroll");
  expect(viewport).toBeTruthy();
  Object.defineProperty(viewport, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(viewport, "scrollHeight", { value: 1400, configurable: true });
  act(() => window.dispatchEvent(new Event("resize")));
  return viewport!;
}

beforeEach(() => {
  vi.resetModules();
  artworkCalls.length = 0;
  unavailableArtwork = "";
  localStorage.clear();
  vi.doMock("../src/components/Artwork", () => ({
    // biome-ignore lint/correctness/noComponentHookFactories: This module mock is created once per test and keeps its identity across rerenders.
    Artwork: (props: ArtworkProps) => {
      artworkCalls.push(props);
      return props.src === unavailableArtwork ? (
        <span
          className={`${props.className} placeholder`}
          data-src={props.src}
          role="img"
          aria-label={props.alt}
        />
      ) : (
        <img
          className={props.className}
          data-src={props.src ?? ""}
          data-fit={props.fit ?? ""}
          data-kind={props.kind}
          alt={props.alt}
        />
      );
    },
  }));
});

afterEach(() => {
  cleanup();
  vi.doUnmock("../src/components/Artwork");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("A movie displays its provider metadata beside separate artwork frames.", async () => {
  await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL, durationSeconds: 5400 });
  const dialog = document.querySelector(".playback-details");
  expect(dialog?.getAttribute("role")).toBe("dialog");
  expect(document.querySelector("#playback-details-title")?.textContent).toBe("The Film");
  expect(document.querySelector(".playback-details-context")?.textContent).toBe("Cinema");
  const tags = document.querySelector(".playback-details-copy > .vod-detail-tags");
  for (const value of ["2020-05-01", "8.1", "Drama", "90 min"]) {
    expect(tags?.textContent).toContain(value);
  }
  const extra = document.querySelector(".playback-details-extra");
  expect(tags?.querySelector('img[alt="United States"]')?.getAttribute("src")).toBe(
    `${import.meta.env.BASE_URL}flags/us.svg`,
  );
  expect(extra?.textContent).toContain("PG-13");
  expect(extra?.textContent).not.toContain("US");
  expect(document.querySelector(".playback-details-synopsis")?.textContent).toBe(
    MOVIE_DETAIL.plot,
  );
  const credits = [...document.querySelectorAll(".vod-credit-row")].map(
    (row) => row.textContent,
  );
  expect(credits.some((row) => row?.includes("A Director"))).toBe(true);
  expect(credits.some((row) => row?.includes("Lead Actor, Second Actor"))).toBe(true);
  expect(document.querySelector(".playback-details-series")).toBeNull();
  expect(document.querySelectorAll("[data-artwork]")).toHaveLength(2);
  expect(
    artworkCalls.some((call) => call.src === MOVIE_DETAIL.logo && call.fit === "contain"),
  ).toBe(true);
  expect(
    artworkCalls.some(
      (call) => call.src === MOVIE_DETAIL.metadata.backdrops[0] && call.fit === "contain",
    ),
  ).toBe(true);
  expect(artworkCalls.every((call) => call.kind === "poster")).toBe(true);
});

test("Artwork backgrounds follow the displayed image palette without changing viewer focus.", async () => {
  const { paletteCss } = await import("../src/services/artwork");
  await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL });
  const posterPalette = { primary: "#102030", secondary: "#304050" };
  const backdropPalette = { primary: "#302010", secondary: "#504030" };
  const poster = artworkCalls.find((call) => call.src === MOVIE_DETAIL.logo && call.onPalette)!;
  act(() => poster.onPalette?.(posterPalette));
  const expected = document.createElement("div");
  expected.style.background = paletteCss(posterPalette);
  expect(expected.style.background).not.toBe("");
  expect(document.querySelector<HTMLElement>(".playback-details")?.style.background).toBe(
    expected.style.background,
  );
  fireEvent.click(document.querySelector('[data-artwork="image"]')!);
  const viewer = document.querySelector(".playback-details-viewer");
  expect(document.activeElement).toBe(viewer);
  const image = artworkCalls
    .filter((call) => call.className === "playback-details-viewer-image")
    .pop()!;
  expect(image.src).toBe(MOVIE_DETAIL.metadata.backdrops[0]);
  expect(image.palette).not.toEqual(posterPalette);
  act(() => image.onPalette?.(backdropPalette));
  expected.style.background = paletteCss(backdropPalette);
  expect(document.querySelector<HTMLElement>(".playback-details")?.style.background).toBe(
    expected.style.background,
  );
  expect(document.activeElement).toBe(viewer);
});

test.each(["movie", "catchup"] as const)(
  "A bare %s target displays its own identity without empty metadata or artwork.",
  async (kind) => {
    await mountDetails({ target: { ...MINIMAL_TARGET, kind } });
    expect(document.querySelector("#playback-details-title")?.textContent).toBe("Bare Film");
    expect(document.querySelector(".playback-details-context")?.textContent).toBe("Cinema");
    expect(document.querySelector(".vod-detail-tags")).toBeNull();
    expect(document.querySelector(".playback-details-extra")).toBeNull();
    expect(document.querySelector(".playback-details-synopsis")).toBeNull();
    expect(document.querySelector(".vod-credit-row")).toBeNull();
    expect(document.querySelector(".playback-details-series")).toBeNull();
    expect(document.querySelector(".playback-details-artworks")).toBeNull();
    expect(artworkCalls).toHaveLength(0);
  },
);

test.each(["Italy", "Atlantis"])(
  "A movie with only country %s renders tags only for a supported flag.",
  async (country) => {
    await mountDetails({
      target: MINIMAL_TARGET,
      movie: {
        ...MOVIE_DETAIL,
        key: MINIMAL_TARGET.id,
        streamId: "101",
        name: MINIMAL_TARGET.name,
        logo: "",
        year: "",
        rating: "",
        plot: "",
        cast: "",
        director: "",
        genre: "",
        releaseDate: "",
        durationSeconds: 0,
        metadata: {
          backdrops: [],
          rating: "",
          cast: [],
          director: "",
          genre: "",
          releaseDate: "",
          country,
          ageRating: "",
        },
      },
    });
    const tags = document.querySelector(".playback-details-copy > .vod-detail-tags");
    if (country === "Italy") {
      expect(tags?.children).toHaveLength(1);
      expect(tags?.querySelector('img[alt="Italy"]')?.getAttribute("src")).toBe(
        `${import.meta.env.BASE_URL}flags/it.svg`,
      );
      expect(tags?.textContent).toBe("");
    } else expect(tags).toBeNull();
    expect(document.querySelector(".playback-details-extra")).toBeNull();
  },
);

test("Poster only metadata creates one selectable frame.", async () => {
  await mountDetails({
    target: MOVIE_TARGET,
    movie: { ...MOVIE_DETAIL, metadata: { ...MOVIE_DETAIL.metadata, backdrops: [] } },
  });
  expect(document.querySelectorAll("[data-artwork]")).toHaveLength(1);
  expect(document.querySelector('[data-artwork="poster"]')).toBeTruthy();
  expect(artworkCalls.every((call) => call.src === MOVIE_DETAIL.logo)).toBe(true);
});

test("A repeated artwork URL does not create a duplicate frame.", async () => {
  await mountDetails({
    target: MOVIE_TARGET,
    movie: {
      ...MOVIE_DETAIL,
      metadata: { ...MOVIE_DETAIL.metadata, backdrops: [MOVIE_DETAIL.logo] },
    },
  });
  expect(document.querySelectorAll("[data-artwork]")).toHaveLength(1);
  expect(document.querySelector('[data-artwork="image"]')).toBeNull();
});

test("An unavailable still leaves the poster and reading content available.", async () => {
  unavailableArtwork = MOVIE_DETAIL.metadata.backdrops[0];
  await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL });
  expect(document.querySelector('[data-artwork="image"] .placeholder')).toBeTruthy();
  expect(document.querySelector('[data-artwork="poster"] img')).toBeTruthy();
  expect(document.querySelector("#playback-details-title")?.textContent).toBe(
    MOVIE_DETAIL.name,
  );
});

test("Episode facts remain separate from series facts and credits.", async () => {
  await mountDetails({ target: EPISODE_TARGET, series: SERIES_DETAIL, durationSeconds: 120 });
  expect(document.querySelector("#playback-details-title")?.textContent).toBe("The Episode");
  const context = document.querySelector(".playback-details-context");
  expect(context?.textContent).toContain("The Series");
  expect(context?.textContent).toContain("S1:E2");
  const tags = document.querySelector(".playback-details-copy > .vod-detail-tags");
  for (const value of ["2021-03-04", "7.9", "45 min"])
    expect(tags?.textContent).toContain(value);
  expect(tags?.textContent).not.toContain("Crime");
  expect(tags?.querySelector(".vod-country-flag img")).toBeNull();
  expect(document.querySelector(".playback-details-synopsis")?.textContent).toBe(
    EPISODE.metadata.plot,
  );
  const series = document.querySelector(".playback-details-series");
  expect(series?.querySelector("h2")?.textContent).toBe("The Series");
  for (const value of [
    "2018-01-01",
    "8.8",
    "Crime",
    "TV-MA",
    "The series synopsis.",
    "Series Director",
    "Series Lead",
  ]) {
    expect(series?.textContent).toContain(value);
  }
  expect(
    series?.querySelector('.vod-detail-tags img[alt="United Kingdom"]')?.getAttribute("src"),
  ).toBe(`${import.meta.env.BASE_URL}flags/gb.svg`);
  expect(series?.querySelector(".playback-details-extra")?.textContent).toBe("TV-MA");
  expect(artworkCalls.some((call) => call.src === EPISODE.metadata.image)).toBe(true);
  expect(artworkCalls.some((call) => call.src === SERIES_DETAIL.metadata.backdrops[0])).toBe(
    false,
  );
  expect(artworkCalls.some((call) => call.src === SERIES_DETAIL.logo)).toBe(true);
  expect(document.querySelector('[data-artwork="image"]')?.getAttribute("aria-label")).toBe(
    `${translate("en", "common.open")}, ${translate("en", "vod.episodeArtwork")}`,
  );
});

test("An unmatched episode uses its target identity while retaining series context.", async () => {
  await mountDetails({
    target: {
      ...EPISODE_TARGET,
      id: "xtream:pl-1:episode:u:999",
      name: "Missing Episode",
      progress: { ...EPISODE_TARGET.progress!, name: "Missing Episode", season: 1, episode: 9 },
    },
    series: SERIES_DETAIL,
  });
  expect(document.querySelector("#playback-details-title")?.textContent).toBe(
    "Missing Episode",
  );
  expect(document.querySelector(".playback-details-context")?.textContent).toContain("S1:E9");
  expect(document.querySelector(".playback-details-copy > .vod-detail-tags")).toBeNull();
  expect(document.querySelector(".playback-details-series h2")?.textContent).toBe("The Series");
  expect(document.querySelector('[data-artwork="image"]')?.getAttribute("aria-label")).toBe(
    `${translate("en", "common.open")}, ${translate("en", "vod.backdrop")}`,
  );
  expect(artworkCalls.some((call) => call.src === SERIES_DETAIL.metadata.backdrops[0])).toBe(
    true,
  );
});

test.each(["", "Atlantis"])(
  "A series with country '%s' and no other displayable metadata creates no empty series section.",
  async (country) => {
    await mountDetails({
      target: EPISODE_TARGET,
      series: {
        ...SERIES_DETAIL,
        metadata: {
          backdrops: [],
          rating: "",
          cast: [],
          director: "",
          genre: "",
          releaseDate: "",
          country,
          ageRating: "",
        },
        plot: "",
        cast: "",
        director: "",
        genre: "",
        releaseDate: "",
        year: "",
        rating: "",
      },
    });
    expect(document.querySelector("#playback-details-title")?.textContent).toBe("The Episode");
    expect(document.querySelector(".playback-details-series")).toBeNull();
  },
);

test("Long titles, plot paragraphs and cast lists retain their complete provider text.", async () => {
  const name = "A deliberately long title ".repeat(24);
  const plot = "An extended description with details.\n".repeat(80);
  const cast = Array.from({ length: 40 }, (_, index) => `Actor ${index + 1}`);
  await mountDetails({
    target: MOVIE_TARGET,
    movie: { ...MOVIE_DETAIL, name, plot, metadata: { ...MOVIE_DETAIL.metadata, cast } },
  });
  expect(document.querySelector("#playback-details-title")?.textContent).toBe(name);
  expect(document.querySelector(".playback-details-synopsis")?.textContent).toBe(plot);
  expect(
    [...document.querySelectorAll(".vod-credit-names")].some(
      (row) => row.textContent === cast.join(", "),
    ),
  ).toBe(true);
  makeScrollable();
  expect(document.querySelector(".playback-details-footer .hints")?.textContent).toContain(
    "Scroll",
  );
});

test("The reading pane scrolls and closes on OK without a dismiss button.", async () => {
  const onClose = await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL });
  const viewport = makeScrollable();
  expect(document.activeElement).toBe(viewport);
  expect(document.querySelector(".playback-details-close")).toBeNull();
  expect(document.querySelector(".playback-details-reading > .scrollbar")).toBeTruthy();
  const hints = document.querySelector(".playback-details-footer .hints");
  expect(hints?.textContent).toContain("Scroll");
  expect(hints?.textContent).toContain("Close");
  expect(hints?.querySelector("button, [tabindex]")).toBeNull();
  for (const expected of [240, 480, 720, 960, 1000]) {
    pressKey(KEY.DOWN);
    expect(viewport.scrollTop).toBe(expected);
    expect(document.activeElement).toBe(viewport);
  }
  for (let index = 0; index < 6; index += 1) pressKey(KEY.UP);
  expect(viewport.scrollTop).toBe(0);
  pressKey(KEY.LEFT);
  expect(document.activeElement).toBe(document.querySelector('[data-artwork="poster"]'));
  pressKey(KEY.RIGHT);
  expect(document.activeElement).toBe(viewport);
  expect(pressKey(9).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(document.querySelector('[data-artwork="poster"]'));
  pressKey(9, true);
  expect(document.activeElement).toBe(viewport);
  for (const [index, code] of [KEY.BACK, KEY.ESC, KEY.ENTER].entries()) {
    expect(pressKey(code).defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(index + 1);
  }
});

test.each([
  ["poster", KEY.BACK],
  ["image", KEY.ENTER],
] as const)(
  "Opening the %s restores its frame and scroll after viewing.",
  async (id, closeKey) => {
    const onClose = await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL });
    const dialog = document.querySelector<HTMLElement>("section.playback-details")!;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    const viewport = makeScrollable();
    pressKey(KEY.DOWN);
    pressKey(KEY.DOWN);
    expect(viewport.scrollTop).toBe(480);
    const rail = document.querySelector<HTMLElement>(".playback-details-artworks")!;
    rail.scrollTop = 73;
    rail.scrollLeft = 51;
    pressKey(KEY.LEFT);
    if (id === "image") pressKey(KEY.DOWN);
    expect(document.activeElement).toBe(document.querySelector(`[data-artwork="${id}"]`));
    pressKey(KEY.ENTER, false, true);
    expect(document.querySelector(".playback-details-viewer")).toBeNull();
    pressKey(KEY.ENTER);
    const viewer = document.querySelector(".playback-details-viewer")!;
    expect(viewer.textContent?.trim()).toBe("");
    expect(document.querySelector("section.playback-details")).toBe(dialog);
    expect(viewer.closest('[role="dialog"]')).toBe(dialog);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(document.activeElement).toBe(viewer);
    pressKey(KEY.ENTER, false, true);
    expect(document.querySelector(".playback-details-viewer")).toBe(viewer);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector(".playback-details-copy")).toBeNull();
    const request = artworkCalls.find(
      (call) => call.className === "playback-details-viewer-image",
    );
    expect(request).toMatchObject({
      src: id === "poster" ? MOVIE_DETAIL.logo : MOVIE_DETAIL.metadata.backdrops[0],
      width: 1280,
      height: 720,
      kind: "poster",
      fit: "contain",
    });
    for (const code of [KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN]) {
      expect(pressKey(code).defaultPrevented).toBe(true);
    }
    expect(onClose).not.toHaveBeenCalled();
    pressKey(closeKey);
    expect(document.querySelector(".playback-details-viewer")).toBeNull();
    expect(document.querySelector("section.playback-details")).toBe(dialog);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(document.activeElement).toBe(document.querySelector(`[data-artwork="${id}"]`));
    expect(document.querySelector<HTMLElement>(".playback-details-scroll")?.scrollTop).toBe(
      480,
    );
    expect(document.querySelector<HTMLElement>(".playback-details-artworks")?.scrollTop).toBe(
      73,
    );
    expect(document.querySelector<HTMLElement>(".playback-details-artworks")?.scrollLeft).toBe(
      51,
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(`[data-artwork="${id}"]`)!);
    expect(document.querySelector("section.playback-details")).toBe(dialog);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    fireEvent.click(document.querySelector(".playback-details-viewer")!);
    expect(document.querySelector(".playback-details-viewer")).toBeNull();
    expect(document.querySelector("section.playback-details")).toBe(dialog);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector("#playback-details-title")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".playback-details-layer")!);
    expect(onClose).toHaveBeenCalledOnce();
  },
);

test("RTL moves logically between reading and artwork with localized guides.", async () => {
  const { useSettings } = await import("../src/stores/settings");
  const previous = useSettings.getState().locale;
  const previousDir = document.documentElement.getAttribute("dir");
  const previousLang = document.documentElement.getAttribute("lang");
  act(() => useSettings.setState({ locale: "fa" }));
  applyDocumentLocale("fa");
  try {
    const onClose = await mountDetails({ target: MOVIE_TARGET, movie: MOVIE_DETAIL });
    const viewport = makeScrollable();
    expect(document.activeElement).toBe(viewport);
    const hints = document.querySelector(".playback-details-footer .hints");
    expect(hints?.textContent).toContain(translate("fa", "common.scroll"));
    expect(hints?.textContent).toContain(translate("fa", "common.close"));
    pressKey(KEY.RIGHT);
    expect(document.activeElement).toBe(document.querySelector('[data-artwork="poster"]'));
    pressKey(KEY.LEFT);
    expect(document.activeElement).toBe(viewport);
    pressKey(KEY.BACK);
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => useSettings.setState({ locale: previous }));
    if (previousDir === null) document.documentElement.removeAttribute("dir");
    else document.documentElement.setAttribute("dir", previousDir);
    if (previousLang === null) document.documentElement.removeAttribute("lang");
    else document.documentElement.setAttribute("lang", previousLang);
  }
});

test("Suspended input disables all controls and preserves reading on resume.", async () => {
  const { PlaybackDetails } = await import("../src/components/playback/PlaybackDetails");
  const onClose = vi.fn();
  const view = render(
    <PlaybackDetails target={MOVIE_TARGET} movie={MOVIE_DETAIL} onClose={onClose} />,
  );
  const viewport = makeScrollable();
  pressKey(KEY.DOWN);
  view.rerender(
    <PlaybackDetails
      target={MOVIE_TARGET}
      movie={MOVIE_DETAIL}
      onClose={onClose}
      inputEnabled={false}
    />,
  );
  expect(document.activeElement).not.toBe(viewport);
  expect(viewport.tabIndex).toBe(-1);
  expect(
    [...document.querySelectorAll<HTMLButtonElement>("[data-artwork]")].every(
      (button) => button.disabled,
    ),
  ).toBe(true);
  for (const code of [KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER, KEY.BACK, KEY.ESC, 9]) {
    expect(pressKey(code).defaultPrevented).toBe(false);
  }
  fireEvent.click(document.querySelector(".playback-details-layer")!);
  fireEvent.click(document.querySelector('[data-artwork="poster"]')!);
  expect(document.querySelector(".playback-details-viewer")).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(
    <PlaybackDetails target={MOVIE_TARGET} movie={MOVIE_DETAIL} onClose={onClose} />,
  );
  expect(document.activeElement).toBe(viewport);
  expect(viewport.scrollTop).toBe(240);
  fireEvent.click(document.querySelector('[data-artwork="poster"]')!);
  const viewer = document.querySelector<HTMLButtonElement>(".playback-details-viewer")!;
  view.rerender(
    <PlaybackDetails
      target={MOVIE_TARGET}
      movie={MOVIE_DETAIL}
      onClose={onClose}
      inputEnabled={false}
    />,
  );
  expect(viewer.disabled).toBe(true);
  expect(pressKey(KEY.BACK).defaultPrevented).toBe(false);
  expect(document.querySelector(".playback-details-viewer")).toBe(viewer);
  expect(onClose).not.toHaveBeenCalled();
  view.rerender(
    <PlaybackDetails target={MOVIE_TARGET} movie={MOVIE_DETAIL} onClose={onClose} />,
  );
  expect(document.activeElement).toBe(viewer);
  pressKey(KEY.BACK);
  expect(document.querySelector(".playback-details-viewer")).toBeNull();
  expect(document.querySelector<HTMLElement>(".playback-details-scroll")?.scrollTop).toBe(240);
});

test("Replacing the target resets image mode and retires its previous key handler.", async () => {
  const { PlaybackDetails } = await import("../src/components/playback/PlaybackDetails");
  const previousClose = vi.fn();
  const nextClose = vi.fn();
  const view = render(
    <PlaybackDetails target={MOVIE_TARGET} movie={MOVIE_DETAIL} onClose={previousClose} />,
  );
  fireEvent.click(document.querySelector('[data-artwork="poster"]')!);
  expect(document.querySelector(".playback-details-viewer")).toBeTruthy();
  view.rerender(<PlaybackDetails target={MINIMAL_TARGET} onClose={nextClose} />);
  expect(document.querySelector(".playback-details-viewer")).toBeNull();
  expect(document.querySelectorAll("[data-artwork]")).toHaveLength(0);
  expect(document.querySelector("#playback-details-title")?.textContent).toBe("Bare Film");
  expect(document.activeElement).toBe(document.querySelector(".playback-details-scroll"));
  pressKey(KEY.ENTER);
  expect(nextClose).toHaveBeenCalledOnce();
  expect(previousClose).not.toHaveBeenCalled();
});

test("Removing focused artwork returns focus to the reading pane.", async () => {
  const { PlaybackDetails } = await import("../src/components/playback/PlaybackDetails");
  const onClose = vi.fn();
  const view = render(
    <PlaybackDetails target={MOVIE_TARGET} movie={MOVIE_DETAIL} onClose={onClose} />,
  );
  pressKey(KEY.LEFT);
  pressKey(KEY.DOWN);
  expect(document.activeElement).toBe(document.querySelector('[data-artwork="image"]'));
  view.rerender(
    <PlaybackDetails
      target={MOVIE_TARGET}
      movie={{ ...MOVIE_DETAIL, metadata: { ...MOVIE_DETAIL.metadata, backdrops: [] } }}
      onClose={onClose}
    />,
  );
  expect(document.querySelector('[data-artwork="image"]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector(".playback-details-scroll"));
  pressKey(KEY.ENTER);
  expect(onClose).toHaveBeenCalledOnce();
});
