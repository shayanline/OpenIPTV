import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ArtworkProps } from "../src/components/Artwork";
import type { EpisodeListProps } from "../src/components/vod/EpisodeList";
import { createArtworkWorkload, type ArtworkWorkload } from "../src/services/workload";

type Observation = Pick<
  IntersectionObserverEntry,
  "target" | "isIntersecting" | "intersectionRatio"
>;
const observations = new Map<Element, (visible: boolean, ratio?: number) => void>();
const finish: Array<() => void> = [];
const signals: AbortSignal[] = [];
let releaseAll: (() => void) | undefined;
let inputMode: string | undefined;
let capacity: Readonly<ArtworkWorkload>;

const fetcher = vi.fn((_input: string | URL, init?: RequestInit) => {
  const signal = init?.signal;
  if (!signal) throw new Error("Artwork fetch has no abort signal");
  signals.push(signal);
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    finish.push(() => {
      if (settled) return;
      settled = true;
      resolve(new Response(new Blob(["image"])));
    });
    signal.addEventListener(
      "abort",
      () => {
        if (settled) return;
        settled = true;
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
});

beforeEach(() => {
  inputMode = document.documentElement.dataset.inputMode;
  vi.resetModules();
  vi.useRealTimers();
  observations.clear();
  finish.length = 0;
  signals.length = 0;
  fetcher.mockClear();
  releaseAll = undefined;
  // Fixed stress capacity keeps the existing stale ownership races deterministic.
  capacity = { loads: 18, decodes: 2, prefetch: 18 };
  vi.doMock("../src/services/workload", () => ({
    artworkWorkload: () => capacity,
    observeArtworkWorkload: () => () => {},
    recordArtworkDecode: () => {},
    recordArtworkLoad: () => {},
    trackArtworkWork: () => () => {},
  }));
  vi.doMock("../src/services/disk", () => ({
    read: async () => null,
    write: async () => true,
  }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: 192,
      height: 288,
      close: vi.fn(),
    })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly targets = new Set<Element>();
      constructor(private readonly callback: (entries: Observation[]) => void) {}
      observe(target: Element) {
        this.targets.add(target);
        observations.set(target, (visible, ratio = visible ? 1 : 0) =>
          this.callback([{ target, isIntersecting: visible, intersectionRatio: ratio }]),
        );
      }
      unobserve(target: Element) {
        this.targets.delete(target);
        observations.delete(target);
      }
      disconnect() {
        for (const target of this.targets) observations.delete(target);
        this.targets.clear();
      }
    },
  );
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    for (const release of finish) release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  releaseAll?.();
  vi.doUnmock("../src/components/Artwork");
  vi.doUnmock("../src/components/Text");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (inputMode === undefined) delete document.documentElement.dataset.inputMode;
  else document.documentElement.dataset.inputMode = inputMode;
});

async function component() {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  return (await import("../src/components/Artwork")).Artwork;
}

const props = {
  src: "https://images.example/shared.jpg",
  kind: "poster" as const,
  width: 192,
  height: 288,
  placeholderIcon: "movie" as const,
};

function episodePreviewProps(image?: string): EpisodeListProps {
  return {
    detail: {
      key: "series:preview",
      seriesId: "preview",
      categoryKey: "",
      name: "Preview series",
      logo: "",
      year: "",
      rating: "",
      plot: "",
      cast: "",
      director: "",
      genre: "",
      releaseDate: "",
      metadata: {
        backdrops: [],
        rating: "",
        cast: [],
        director: "",
        genre: "",
        releaseDate: "",
        country: "",
        ageRating: "",
      },
      seasons: [1],
      episodes: [
        {
          key: "episode:preview",
          episodeIdentity: "preview",
          episodeId: "preview",
          directSource: "",
          seriesKey: "series:preview",
          seasonKey: 1,
          season: 1,
          number: 1,
          name: "Preview episode",
          providerOrder: 0,
          metadata: { rating: "", plot: "", releaseDate: "", image },
        },
      ],
    },
    seasonCursor: 1,
    selectedSeason: 1,
    episodeKey: "episode:preview",
    state: "loaded",
    visible: false,
    progress: [],
    onSummaryFocus: () => {},
    onFocusSeason: () => {},
    onCommitSeason: () => {},
    onFocusEpisode: () => {},
    onSelectEpisode: () => {},
    onWheel: () => {},
  };
}

test.each([
  { name: "portrait", width: 144, height: 288, x: 184, y: 0 },
  { name: "wide", width: 512, height: 128, x: 0, y: 80 },
])(
  "EpisodeList centres the complete $name image inside its existing preview canvas",
  async ({ width, height, x, y }) => {
    const service = await import("../src/services/artwork");
    releaseAll = service.releaseAllArtwork;
    const { EpisodeList } = await import("../src/components/vod/EpisodeList");
    const request = {
      url: "https://images.example/episode-preview.jpg",
      kind: "poster" as const,
      width: 512,
      height: 288,
      fit: "contain" as const,
    };
    const image = { width, height, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => image),
    );
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(
          Array.from({ length: 64 }, () => [224, 96, 32, 255]).flat(),
        ),
      }),
    } as unknown as CanvasRenderingContext2D);
    const pending = service.loadArtwork({ ...request, eager: false });
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    finish[0]();
    const entry = await pending;
    expect(entry?.bitmap).toBe(image);
    expect(entry?.palette).not.toEqual(service.QUIET_NEUTRAL_PALETTE);
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      clearRect,
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const view = render(<EpisodeList {...episodePreviewProps(request.url)} />);
    const frame = view.container.querySelector(".episode-preview-art") as HTMLDivElement;
    const canvas = view.container.querySelector(
      ".episode-preview-art > canvas",
    ) as HTMLCanvasElement;
    expect(canvas instanceof HTMLCanvasElement).toBe(true);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(288);
    expect(clearRect).toHaveBeenLastCalledWith(0, 0, 512, 288);
    expect(drawImage).toHaveBeenLastCalledWith(image, x, y, width, height);
    expect(frame.style.background).toBe(service.paletteCss(entry!.palette));
    expect(service.artworkOf({ ...request, fit: "cover" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

test("EpisodeList clears the previous frame palette until the selected image is cached", async () => {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const { EpisodeList } = await import("../src/components/vod/EpisodeList");
  let color = [224, 96, 32, 255];
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({
      data: new Uint8ClampedArray(Array.from({ length: 64 }, () => color).flat()),
    }),
  } as unknown as CanvasRenderingContext2D);
  const first = episodePreviewProps("https://images.example/episode-a.jpg");
  const episode = first.detail.episodes[0];
  const secondImage = "https://images.example/episode-b.jpg";
  const detail = {
    ...first.detail,
    episodes: [
      episode,
      { ...episode, key: "episode:b", metadata: { ...episode.metadata, image: secondImage } },
      {
        ...episode,
        key: "episode:missing",
        metadata: { ...episode.metadata, image: undefined },
      },
    ],
  };
  const request = {
    url: episode.metadata.image!,
    kind: "poster" as const,
    width: 512,
    height: 288,
    fit: "contain" as const,
    eager: false,
  };
  const pendingA = service.loadArtwork(request);
  await vi.waitFor(() => expect(finish).toHaveLength(1));
  finish[0]();
  const entryA = await pendingA;
  const view = render(<EpisodeList {...first} detail={detail} />);
  const frame = view.container.querySelector(".episode-preview-art") as HTMLDivElement;
  await vi.waitFor(() =>
    expect(frame.style.background).toBe(service.paletteCss(entryA!.palette)),
  );

  view.rerender(<EpisodeList {...first} detail={detail} episodeKey="episode:b" />);
  expect(frame.style.background).toBe("");
  expect(service.artworkOf({ ...request, url: secondImage })).toBeNull();
  color = [32, 96, 224, 255];
  const pendingB = service.loadArtwork({ ...request, url: secondImage });
  await vi.waitFor(() => expect(finish).toHaveLength(2));
  await act(async () => {
    finish[1]();
    await pendingB;
  });
  const entryB = service.artworkOf({ ...request, url: secondImage });
  expect(entryB?.palette).not.toEqual(entryA?.palette);
  expect(frame.style.background).toBe(service.paletteCss(entryB!.palette));

  view.rerender(<EpisodeList {...first} detail={detail} episodeKey="episode:missing" />);
  expect(frame.style.background).toBe("");
  expect(frame.querySelector("canvas") === null).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("EpisodeList ignores late palettes from an old image and keeps its callback stable", async () => {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const callbacks = new Map<string, NonNullable<ArtworkProps["onPalette"]>>();
  vi.doMock("../src/components/Artwork", () => ({
    Artwork: ({ src, onPalette }: ArtworkProps) => {
      if (src && onPalette) callbacks.set(src, onPalette);
      return null;
    },
  }));
  const { EpisodeList } = await import("../src/components/vod/EpisodeList");
  const firstImage = "https://images.example/episode-a.jpg";
  const secondImage = "https://images.example/episode-b.jpg";
  const first = episodePreviewProps(firstImage);
  const episode = first.detail.episodes[0];
  const detail = {
    ...first.detail,
    episodes: [
      episode,
      { ...episode, key: "episode:b", metadata: { ...episode.metadata, image: secondImage } },
    ],
  };
  const paletteA = { primary: "rgb(80, 24, 12)", secondary: "rgb(60, 32, 16)" };
  const paletteB = { primary: "rgb(12, 24, 80)", secondary: "rgb(16, 32, 60)" };
  const view = render(<EpisodeList {...first} detail={detail} />);
  const frame = view.container.querySelector(".episode-preview-art") as HTMLDivElement;
  const callbackA = callbacks.get(firstImage)!;
  act(() => callbackA(paletteA));
  expect(callbacks.get(firstImage)).toBe(callbackA);
  view.rerender(<EpisodeList {...first} detail={detail} episodeKey="episode:b" />);
  expect(frame.style.background).toBe("");
  const callbackB = callbacks.get(secondImage)!;
  act(() => callbackA(paletteA));
  expect(frame.style.background).toBe("");
  act(() => callbackB(paletteB));
  expect(frame.style.background).toBe(service.paletteCss(paletteB));
  act(() => callbackA(paletteA));
  expect(frame.style.background).toBe(service.paletteCss(paletteB));
  view.rerender(
    <EpisodeList {...first} detail={detail} episodeKey="episode:b" summaryFocused />,
  );
  expect(callbacks.get(secondImage)).toBe(callbackB);
  expect(fetcher).not.toHaveBeenCalled();
});

test.each(["poster", "logo"] as const)(
  "%s canvas drawing retains its default geometry",
  async (kind) => {
    const Artwork = await component();
    const service = await import("../src/services/artwork");
    const image = { width: 144, height: 288, close: vi.fn() } as unknown as ImageBitmap;
    vi.spyOn(service, "artworkOf").mockReturnValue({
      bitmap: image,
      bytes: 144 * 288 * 4,
      palette: service.QUIET_NEUTRAL_PALETTE,
    });
    const drawImage = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      clearRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    render(
      <Artwork {...props} kind={kind} width={512} alt="Default geometry" fetchable={false} />,
    );
    expect(drawImage).toHaveBeenLastCalledWith(
      image,
      kind === "logo" ? 184 : 0,
      0,
      kind === "logo" ? 144 : 512,
      288,
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test("artwork reads a cache entry installed between render and subscription", async () => {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const entry = {
    bitmap: { width: 192, height: 288, close: vi.fn() } as unknown as ImageBitmap,
    bytes: 192 * 288 * 4,
    palette: service.QUIET_NEUTRAL_PALETTE,
  };
  let ready = false;
  vi.spyOn(service, "artworkOf").mockImplementation(() => (ready ? entry : null));
  const subscribe = vi.spyOn(service, "subscribeArtwork").mockImplementation(() => {
    ready = true;
    return () => {};
  });
  const Artwork = await component();
  render(<Artwork {...props} alt="Ready during subscription" fetchable={false} />);
  await vi.waitFor(() =>
    expect(screen.getByRole("img", { name: "Ready during subscription" }).tagName).toBe(
      "CANVAS",
    ),
  );
  expect(subscribe).toHaveBeenCalledTimes(1);
  expect(fetcher).not.toHaveBeenCalled();
  expect(observations.size).toBe(0);
});

test("viewport bookkeeping skips unchanged poster cells while handlers and changed items stay current", async () => {
  const renders = vi.fn(() => <span role="img" aria-label="Poster" />);
  vi.doMock("../src/components/Artwork", () => ({ Artwork: renders }));
  vi.doMock("../src/components/Text", () => ({
    Text: ({ value }: { value: string }) => <span>{value}</span>,
  }));
  const viewport = await import("../src/hooks/useViewport");
  vi.spyOn(viewport, "useViewport").mockReturnValue(376 * 2);
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  const items = Array.from({ length: 30 }, (_, index) => ({
    key: `movie:${index}`,
    kind: "movie" as const,
    title: `Memo movie ${index}`,
    poster: "",
    metadata: "",
    rating: "",
    favourite: false,
  }));
  const grid = {
    items,
    resourceState: "loaded" as const,
    cursor: 12,
    focused: true,
    fetchReady: false,
    artworkActive: false,
    scale: 1,
    columns: 6,
    onFocus: vi.fn(),
    onActivate: vi.fn(),
    onRetry: () => undefined,
    onWheel: () => undefined,
  };
  const view = render(<PosterGrid {...grid} firstRow={0} />);
  const initialRenders = renders.mock.calls.length;
  const onFocus = vi.fn();
  const onActivate = vi.fn();
  view.rerender(
    <PosterGrid {...grid} firstRow={1} onFocus={onFocus} onActivate={onActivate} />,
  );
  expect(renders).toHaveBeenCalledTimes(initialRenders);
  fireEvent.click(view.getByRole("button", { name: "Memo movie 12", exact: true }));
  expect(onFocus).toHaveBeenCalledWith(12);
  expect(onActivate).toHaveBeenCalledWith("movie:12", 12);
  expect(grid.onFocus).not.toHaveBeenCalled();
  expect(grid.onActivate).not.toHaveBeenCalled();
  view.rerender(
    <PosterGrid
      {...grid}
      firstRow={1}
      items={items.map((item, index) =>
        index === 12 ? { ...item, title: "Updated movie", favourite: true } : item,
      )}
      onFocus={onFocus}
      onActivate={onActivate}
    />,
  );
  expect(view.getByRole("button", { name: /Updated movie/ })).toBeDefined();
  expect(renders).toHaveBeenCalledTimes(initialRenders + 1);
});

test("current grid preparation paints while fetching is disabled and intersection is pending", async () => {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  render(
    <PosterGrid
      items={[
        {
          key: "movie:prepared-without-intersection",
          kind: "movie",
          title: "Prepared without intersection",
          poster: props.src,
          metadata: "",
          rating: "",
          favourite: false,
        },
      ]}
      resourceState="loaded"
      cursor={0}
      firstRow={0}
      focused={false}
      fetchReady={false}
      artworkActive
      scale={1}
      columns={6}
      onFocus={() => {}}
      onActivate={() => {}}
      onRetry={() => {}}
      onWheel={() => {}}
    />,
  );
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("img").tagName).toBe("SPAN");
  await act(async () => finish[0]());
  await vi.waitFor(() => expect(screen.getByRole("img").tagName).toBe("CANVAS"));
  expect(observations.size).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test.each([80, 376 * 6])(
  "poster content reset clears a pointer offset of %s pixels even when firstRow stays zero",
  async (deltaY) => {
    const { POSTER_CARD_ROW_BASE } = await import("../src/hooks/useWindowed");
    const viewport = await import("../src/hooks/useViewport");
    vi.spyOn(viewport, "useViewport").mockReturnValue(POSTER_CARD_ROW_BASE * 2);
    const { PosterGrid } = await import("../src/components/vod/PosterGrid");
    const items = Array.from({ length: 120 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie" as const,
      title: `Pointer item ${index}`,
      poster: "",
      metadata: "",
      rating: "",
      favourite: false,
    }));
    const grid = {
      items,
      resourceState: "loaded" as const,
      cursor: 0,
      firstRow: 0,
      windowKey: "movie:all:0",
      focused: false,
      fetchReady: false,
      artworkActive: false,
      scale: 1,
      columns: 6,
      onFocus: () => {},
      onActivate: () => {},
      onRetry: () => {},
      onWheel: () => {},
      onWindowChange: vi.fn(),
    };
    const view = render(<PosterGrid {...grid} />);
    const region = view.container.querySelector(".poster-grid-region")!;
    const list = view.container.querySelector(".poster-grid") as HTMLElement;
    fireEvent.wheel(region, { deltaMode: 0, deltaY });
    const offset = list.style.transform;
    expect(offset).not.toBe("translateY(0px)");
    expect(grid.onWindowChange).toHaveBeenLastCalledWith(
      deltaY < POSTER_CARD_ROW_BASE ? 0 : 6,
      2,
    );
    view.rerender(<PosterGrid {...grid} items={items.slice()} cursor={1} />);
    expect(list.style.transform).toBe(offset);

    const sorted = items.slice().reverse();
    view.rerender(<PosterGrid {...grid} items={sorted} windowKey="movie:all:1" />);
    expect(view.container.querySelector(".poster-grid")).toBe(list);
    expect(list.style.transform).toBe("translateY(0px)");
    expect(list.style.transition).toBe("");
    expect(view.container.querySelector('[data-poster-index="0"]')?.textContent).toContain(
      "Pointer item 119",
    );
    fireEvent.wheel(region, { deltaMode: 0, deltaY: 40 });
    expect(list.style.transform).toBe("translateY(-40px)");
    view.rerender(<PosterGrid {...grid} items={sorted.slice()} windowKey="movie:all:1" />);
    expect(list.style.transform).toBe("translateY(-40px)");
  },
);

test("remote poster content reset cancels the old row animation and positions immediately", async () => {
  document.documentElement.dataset.inputMode = "remote";
  vi.doMock("../src/components/Text", () => ({
    Text: ({ value }: { value: string }) => <span>{value}</span>,
  }));
  const viewport = await import("../src/hooks/useViewport");
  vi.spyOn(viewport, "useViewport").mockReturnValue(376 * 2);
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  const frame = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(123);
  const items = Array.from({ length: 120 }, (_, index) => ({
    key: `series:${index}`,
    kind: "series" as const,
    title: `Remote item ${index}`,
    poster: "",
    metadata: "",
    rating: "",
    favourite: false,
  }));
  const grid = {
    items,
    resourceState: "loaded" as const,
    cursor: 36,
    firstRow: 5,
    windowKey: "series:all:0",
    focused: false,
    fetchReady: false,
    artworkActive: false,
    scale: 1,
    columns: 6,
    onFocus: () => {},
    onActivate: () => {},
    onRetry: () => {},
    onWheel: () => {},
  };
  const view = render(<PosterGrid {...grid} />);
  const animate = vi.spyOn(Element.prototype, "animate");
  view.rerender(<PosterGrid {...grid} cursor={42} firstRow={6} />);
  const list = view.container.querySelector(".poster-grid") as HTMLElement;
  expect(animate).toHaveBeenCalledTimes(1);
  const animation = animate.mock.results[0].value as Animation;
  const cancel = vi.spyOn(animation, "cancel");
  expect(cancel).not.toHaveBeenCalled();
  const flush = vi.spyOn(list, "getBoundingClientRect");
  view.rerender(
    <PosterGrid
      {...grid}
      items={items.slice().reverse()}
      cursor={0}
      firstRow={0}
      windowKey="series:all:1"
    />,
  );
  expect(frame).not.toHaveBeenCalled();
  expect(flush).not.toHaveBeenCalled();
  expect(list.style.transform).toBe("translateY(0px)");
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(animate).toHaveBeenCalledTimes(1);
});

test.each(["movie", "series"] as const)(
  "%s sort releases old preparation and paints the new first window without intersection",
  async (kind) => {
    document.documentElement.dataset.inputMode = "remote";
    const stale = [0, 1].map(() => ({ width: 192, height: 288, close: vi.fn() }));
    const releaseDecodes: Array<() => void> = [];
    let nativeCalls = 0;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(() => {
        const index = nativeCalls++;
        if (index < 2) {
          return new Promise<ImageBitmap>((resolve) =>
            releaseDecodes.push(() => resolve(stale[index] as unknown as ImageBitmap)),
          );
        }
        return Promise.resolve({ width: 192, height: 288, close: vi.fn() });
      }),
    );
    const service = await import("../src/services/artwork");
    releaseAll = service.releaseAllArtwork;
    const viewport = await import("../src/hooks/useViewport");
    vi.spyOn(viewport, "useViewport").mockReturnValue(376 * 2);
    const { PosterGrid } = await import("../src/components/vod/PosterGrid");
    const items = Array.from({ length: 120 }, (_, index) => ({
      key: `${kind}:${index}`,
      kind,
      title: `Sort item ${index}`,
      poster: `https://images.example/${kind}-sort-${index}.jpg`,
      metadata: "",
      rating: "",
      favourite: false,
    }));
    const grid = {
      items,
      resourceState: "loaded" as const,
      cursor: 60,
      firstRow: 10,
      windowKey: `${kind}:all:0`,
      focused: false,
      fetchReady: false,
      artworkActive: true,
      scale: 1,
      columns: 6,
      onFocus: () => {},
      onActivate: vi.fn(),
      onRetry: () => {},
      onWheel: () => {},
    };
    const view = render(<PosterGrid {...grid} />);
    const list = view.container.querySelector(".poster-grid");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(18));
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(
      items.slice(60, 78).map((item) => item.poster),
    );
    await act(async () => {
      finish[0]();
      finish[1]();
    });
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

    const sorted = items.slice().reverse();
    view.rerender(
      <PosterGrid
        {...grid}
        items={sorted}
        cursor={0}
        firstRow={0}
        windowKey={`${kind}:all:1`}
      />,
    );
    expect(view.container.querySelector(".poster-grid")).toBe(list);
    expect((list as HTMLElement).style.transform).toBe("translateY(0px)");
    // The two abandoned native decodes still occupy their load and decode lanes.
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(34));
    expect(signals.slice(2, 18).every((signal) => signal.aborted)).toBe(true);
    const firstUrls = new Set(sorted.slice(0, 18).map((item) => item.poster));
    const waitingFetches = fetcher.mock.calls.flatMap(([url], index) =>
      firstUrls.has(String(url)) && !signals[index].aborted ? [index] : [],
    );
    expect(waitingFetches).toHaveLength(16);
    await act(async () => {
      for (const index of waitingFetches) finish[index]();
    });
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    await act(async () => {
      for (const release of releaseDecodes) release();
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(36));
    const currentFetches = fetcher.mock.calls.flatMap(([url], index) =>
      firstUrls.has(String(url)) && !signals[index].aborted ? [index] : [],
    );
    expect(currentFetches).toHaveLength(18);
    await act(async () => {
      for (const index of currentFetches) finish[index]();
    });
    await vi.waitFor(() => {
      for (const item of sorted.slice(0, 18)) {
        const card = screen.getByRole("button", { name: item.title });
        expect(card.querySelector('[role="img"]')?.tagName).toBe("CANVAS");
      }
    });
    for (const bitmap of stale) expect(bitmap.close).toHaveBeenCalledTimes(1);
    for (const item of items.slice(60, 62)) {
      expect(
        service.artworkOf({ url: item.poster, kind: "poster", ...service.POSTER_BOX }),
      ).toBeNull();
    }
    expect(observations.size).toBe(0);
    expect(grid.onActivate).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledTimes(20);
    expect(fetcher).toHaveBeenCalledTimes(36);
  },
);

test.each([
  { name: "floor", memoryGB: 1, cores: 4, simultaneous: 1 },
  { name: "stronger", memoryGB: 8, cores: 8, simultaneous: 4 },
])(
  "$name hardware applies its measured prefetch capacity to the committed grid",
  async ({ memoryGB, cores, simultaneous }) => {
    const policy = createArtworkWorkload({ memoryGB, cores });
    for (let window = 0; window < 12; window += 1) {
      const start = window * 1500;
      for (let index = 0; index < 8; index += 1) policy.decoded(8, start + 50);
      for (let index = 0; index < 4; index += 1) policy.completed(start, start + 100);
      for (let index = 0; index < 8; index += 1) {
        policy.frame(16, start + 120 + index * 16);
      }
    }
    capacity = policy.limits();
    const service = await import("../src/services/artwork");
    releaseAll = service.releaseAllArtwork;
    const { PosterGrid } = await import("../src/components/vod/PosterGrid");
    const items = Array.from({ length: 24 }, (_, index) => ({
      key: `adaptive:${index}`,
      kind: "movie" as const,
      title: `Adaptive poster ${index}`,
      poster: `https://images.example/adaptive-ui-${index}.jpg`,
      metadata: "",
      rating: "",
      favourite: false,
    }));
    const view = render(
      <PosterGrid
        items={items}
        resourceState="loaded"
        cursor={0}
        firstRow={0}
        focused={false}
        fetchReady={false}
        artworkActive
        scale={1}
        columns={6}
        onFocus={() => {}}
        onActivate={() => {}}
        onRetry={() => {}}
        onWheel={() => {}}
      />,
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(simultaneous));
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(
      items.slice(0, simultaneous).map((item) => item.poster),
    );
    expect(observations.size).toBe(0);
    view.unmount();
    await act(async () => {});
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  },
);

test.each(["movie", "series"] as const)(
  "rapid wheel scrolling paints the final %s preparation without intersection callbacks",
  async (kind) => {
    const service = await import("../src/services/artwork");
    releaseAll = service.releaseAllArtwork;
    const { POSTER_CARD_ROW_BASE } = await import("../src/hooks/useWindowed");
    const viewport = await import("../src/hooks/useViewport");
    vi.spyOn(viewport, "useViewport").mockReturnValue(POSTER_CARD_ROW_BASE * 2);
    const { PosterGrid } = await import("../src/components/vod/PosterGrid");
    const items = Array.from({ length: 120 }, (_, index) => ({
      key: `${kind}:${index}`,
      kind,
      title: `Wheel item ${index}`,
      poster: `https://images.example/${kind}-wheel-${index}.jpg`,
      metadata: "",
      rating: "",
      favourite: false,
    }));
    const onActivate = vi.fn();
    const view = render(
      <PosterGrid
        items={items}
        resourceState="loaded"
        cursor={0}
        firstRow={0}
        focused={false}
        fetchReady
        artworkActive
        scale={1}
        columns={6}
        onFocus={() => {}}
        onActivate={onActivate}
        onRetry={() => {}}
        onWheel={() => {}}
      />,
    );
    const region = view.container.querySelector(".poster-grid-region")!;
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(18));
    for (let step = 1; step <= 3; step += 1) {
      fireEvent.wheel(region, { deltaMode: 0, deltaY: POSTER_CARD_ROW_BASE * 4 });
      const urls = items.slice(step * 24, step * 24 + 18).map((item) => item.poster);
      await vi.waitFor(() => {
        const active = fetcher.mock.calls.filter(
          ([url], index) => urls.includes(String(url)) && !signals[index].aborted,
        );
        expect(active).toHaveLength(18);
      });
    }
    const current = items.slice(72, 90);
    const currentUrls = new Set(current.map((item) => item.poster));
    const currentFetches = fetcher.mock.calls.flatMap(([url], index) =>
      currentUrls.has(String(url)) && !signals[index].aborted ? [index] : [],
    );
    expect(currentFetches).toHaveLength(18);
    expect(
      fetcher.mock.calls.every(
        ([url], index) => currentUrls.has(String(url)) || signals[index].aborted,
      ),
    ).toBe(true);
    for (const item of current) {
      const card = screen.getByRole("button", { name: item.title });
      expect(card.querySelector('[role="img"]')?.tagName).toBe("SPAN");
    }
    await act(async () => {
      for (const index of currentFetches) finish[index]();
    });
    await vi.waitFor(() => {
      expect(view.container.querySelectorAll('canvas[role="img"]')).toHaveLength(18);
      for (const item of current) {
        const card = screen.getByRole("button", { name: item.title });
        expect(card.querySelector('[role="img"]')?.tagName).toBe("CANVAS");
      }
    });
    for (const item of [current[0], current[current.length - 1]]) {
      expect(
        service.artworkOf({
          url: item.poster,
          kind: "poster",
          ...service.POSTER_BOX,
        }),
      ).not.toBeNull();
    }
    expect(observations.size).toBeGreaterThan(0);
    expect(onActivate).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(72);
  },
);

test("artwork loads only while displayed and resumes after leaving and returning", async () => {
  const Artwork = await component();
  render(<Artwork {...props} alt="Poster" />);
  await act(async () => Promise.resolve());
  expect(fetcher.mock.calls.length).toBe(0);
  const observe = observations.get(screen.getByRole("img", { name: "Poster" }));
  expect(observe).toBeDefined();
  act(() => observe!(true, 0));
  expect(fetcher.mock.calls.length).toBe(0);
  act(() => observe!(true));
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(1));
  act(() => observe!(false));
  await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
  act(() => observe!(true));
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(2));
  await act(async () => finish[1]());
  await vi.waitFor(() =>
    expect(screen.getByRole("img", { name: "Poster" }).tagName).toBe("CANVAS"),
  );
});

test("shared artwork stays active until its last displayed owner leaves", async () => {
  const Artwork = await component();
  render(
    <>
      <Artwork {...props} alt="First" />
      <Artwork {...props} alt="Second" />
    </>,
  );
  const first = observations.get(screen.getByRole("img", { name: "First" }));
  const second = observations.get(screen.getByRole("img", { name: "Second" }));
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  act(() => {
    first!(true);
    second!(true);
  });
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(1));
  act(() => first!(false));
  expect(signals[0].aborted).toBe(false);
  act(() => second!(false));
  await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
});

test("grid preparation starts before intersection and visible artwork joins the same request", async () => {
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  const items = [
    {
      key: "movie:prepared",
      kind: "movie" as const,
      title: "Prepared movie",
      poster: props.src,
      metadata: "",
      rating: "",
      favourite: false,
    },
  ];
  const grid = {
    items,
    resourceState: "loaded" as const,
    cursor: 0,
    firstRow: 0,
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
  const request = {
    url: props.src,
    kind: props.kind,
    width: props.width,
    height: props.height,
  };
  const view = render(<PosterGrid {...grid} />);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(observations.size).toBe(0);
  const pending = service.loadArtwork({ ...request, eager: false });
  view.rerender(<PosterGrid {...grid} fetchReady />);
  expect(signals[0].aborted).toBe(false);
  const observe = observations.get(screen.getByRole("img"));
  expect(observe).toBeDefined();
  act(() => observe!(true));
  await act(async () => Promise.resolve());
  expect(service.loadArtwork(request)).toBe(pending);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => finish[0]());
  await vi.waitFor(() => expect(screen.getByRole("img").tagName).toBe("CANVAS"));
  expect(await pending).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  view.rerender(<PosterGrid {...grid} artworkActive={false} fetchReady />);
  expect(observations.size).toBe(0);
});

test("moving the poster window preserves overlapping requests and releases only departed work", async () => {
  capacity = { ...capacity, loads: 30, prefetch: 30 };
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const viewport = await import("../src/hooks/useViewport");
  vi.spyOn(viewport, "useViewport").mockReturnValue(376);
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  const grid = {
    items: Array.from({ length: 30 }, (_, index) => ({
      key: `movie:${index}`,
      kind: "movie" as const,
      title: `Movie ${index}`,
      poster: `https://images.example/overlap-${index}.jpg`,
      metadata: "",
      rating: "",
      favourite: false,
    })),
    resourceState: "loaded" as const,
    firstRow: 0,
    focused: false,
    fetchReady: false,
    artworkActive: true,
    scale: 1,
    columns: 6,
    onFocus: () => undefined,
    onActivate: () => undefined,
    onRetry: () => undefined,
    onWheel: () => undefined,
  };
  const view = render(<PosterGrid {...grid} cursor={0} />);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(12));
  view.rerender(<PosterGrid {...grid} cursor={6} />);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(18));
  expect(signals.slice(0, 6).every((signal) => signal.aborted)).toBe(true);
  expect(signals.slice(6, 12).every((signal) => !signal.aborted)).toBe(true);
  view.unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

test("withdrawing fetch permission releases displayed work without losing its retry", async () => {
  const Artwork = await component();
  const view = render(<Artwork {...props} alt="Poster" />);
  const observe = observations.get(screen.getByRole("img", { name: "Poster" }));
  expect(observe).toBeDefined();
  act(() => observe!(true));
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(1));
  view.rerender(<Artwork {...props} alt="Poster" fetchable={false} />);
  await vi.waitFor(() => expect(signals[0].aborted).toBe(true));
  view.rerender(<Artwork {...props} alt="Poster" fetchable />);
  const resumed = observations.get(screen.getByRole("img", { name: "Poster" }));
  expect(resumed).toBeDefined();
  act(() => resumed!(true));
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(2));
});

const vodOptions = (mode: "movie" | "series") => ({
  direction: "ltr" as const,
  headerKeys: ["live", "movie", "series", "search", "settings"] as const,
  categoryKeys: [`${mode}:all`],
  itemKeys: [`${mode}:0`, `${mode}:1`],
  searchItemKeys: [] as string[],
  seasons: [],
  episodeKeys: [] as string[],
  detailActionCount: 0,
  detailRetryAvailable: false,
  regionState: "loaded" as const,
  mode,
  onCategorySettled: () => undefined,
  onQuerySettled: () => undefined,
  onPosterSettled: () => undefined,
  onActivate: () => undefined,
  onRetry: () => undefined,
  onRequestExit: () => undefined,
});

const posterProbe = (
  Artwork: Awaited<ReturnType<typeof component>>,
  useVodNavigation: typeof import("../src/hooks/useVodNavigation").useVodNavigation,
) =>
  function Probe({ mode, sources }: { mode: "movie" | "series"; sources: string[] }) {
    const navigation = useVodNavigation(vodOptions(mode));
    return (
      <>
        {sources.map((source) => (
          <Artwork
            key={source}
            {...props}
            src={source}
            alt={`Art ${source}`}
            fetchable={navigation.posterFetchReady}
          />
        ))}
      </>
    );
  };

const waitForObservers = (sources: string[]) =>
  vi.waitFor(() => {
    for (const source of sources) {
      expect(
        observations.get(screen.getByRole("img", { name: `Art ${source}` })),
      ).toBeDefined();
    }
  });

const markVisible = (sources: string[]) =>
  act(() => {
    for (const source of sources) {
      const observe = observations.get(screen.getByRole("img", { name: `Art ${source}` }));
      expect(observe).toBeDefined();
      observe!(true);
    }
  });

test("unfocused posters wait for the initial settle before fetching", async () => {
  const Artwork = await component();
  const { useVodNavigation } = await import("../src/hooks/useVodNavigation");
  const Probe = posterProbe(Artwork, useVodNavigation);
  const sources = ["https://images.example/movie-a.jpg", "https://images.example/movie-b.jpg"];

  const view = render(<Probe mode="movie" sources={sources} />);
  await act(async () => Promise.resolve());
  expect(fetcher.mock.calls.length).toBe(0);
  for (const source of sources) {
    expect(
      observations.get(screen.getByRole("img", { name: `Art ${source}` })),
    ).toBeUndefined();
  }

  await waitForObservers(sources);
  expect(fetcher.mock.calls.length).toBe(0);
  markVisible(sources);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(2));

  await act(async () => {
    finish[0]();
    finish[1]();
  });
  const late = "https://images.example/movie-c.jpg";
  view.rerender(<Probe mode="movie" sources={[...sources, late]} />);
  await waitForObservers([late]);
  markVisible([late]);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(3));
});

test("a mode switch relocks unfocused poster fetches for its own settle", async () => {
  const Artwork = await component();
  const { useVodNavigation } = await import("../src/hooks/useVodNavigation");
  const Probe = posterProbe(Artwork, useVodNavigation);
  const movieSources = [
    "https://images.example/movie-a.jpg",
    "https://images.example/movie-b.jpg",
  ];
  const seriesSources = [
    "https://images.example/series-a.jpg",
    "https://images.example/series-b.jpg",
  ];

  const view = render(<Probe mode="movie" sources={movieSources} />);
  await act(async () => Promise.resolve());
  await waitForObservers(movieSources);
  markVisible(movieSources);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(2));

  await act(async () => {
    finish[0]();
    finish[1]();
  });
  view.rerender(<Probe mode="series" sources={seriesSources} />);
  expect(fetcher.mock.calls.length).toBe(2);
  for (const source of seriesSources) {
    expect(
      observations.get(screen.getByRole("img", { name: `Art ${source}` })),
    ).toBeUndefined();
  }

  await waitForObservers(seriesSources);
  expect(fetcher.mock.calls.length).toBe(2);
  markVisible(seriesSources);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(4));
});

test("leaving and returning a poster grid cancels native decodes without caching stale bitmaps", async () => {
  const stale = [
    { width: 192, height: 288, close: vi.fn() },
    { width: 192, height: 288, close: vi.fn() },
  ];
  const fresh = [
    { width: 192, height: 288, close: vi.fn() },
    { width: 192, height: 288, close: vi.fn() },
  ];
  const releases: Array<() => void> = [];
  let bitmapCalls = 0;
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(() => {
      bitmapCalls += 1;
      const index = bitmapCalls - 1;
      if (index < 2) {
        return new Promise<ImageBitmap>((resolve) =>
          releases.push(() => resolve(stale[index] as unknown as ImageBitmap)),
        );
      }
      return Promise.resolve(fresh[index - 2] as unknown as ImageBitmap);
    }),
  );
  const service = await import("../src/services/artwork");
  releaseAll = service.releaseAllArtwork;
  const { PosterGrid } = await import("../src/components/vod/PosterGrid");
  const items = [0, 1].map((index) => ({
    key: `movie-${index}`,
    kind: "movie" as const,
    title: `Poster ${index}`,
    poster: `https://images.example/grid-${index}.jpg`,
    metadata: "",
    rating: "",
    favourite: false,
  }));
  const requests = items.map((item) => ({
    url: item.poster,
    kind: "poster" as const,
    width: 192,
    height: 288,
  }));
  const gridProps = (artworkActive: boolean) => ({
    items,
    resourceState: "loaded" as const,
    cursor: 0,
    firstRow: 0,
    focused: true,
    fetchReady: true,
    artworkActive,
    scale: 1,
    columns: 6,
    onFocus: () => undefined,
    onActivate: () => undefined,
    onRetry: () => undefined,
    onWheel: () => undefined,
  });
  const images = (view: { container: HTMLElement }) =>
    [0, 1].map((index) => {
      const image = view.container.querySelector(`[data-poster-index="${index}"] [role="img"]`);
      expect(image).not.toBeNull();
      return image!;
    });
  const show = (view: { container: HTMLElement }) =>
    act(() => {
      for (const image of images(view)) {
        const observe = observations.get(image);
        expect(observe).toBeDefined();
        observe!(true);
      }
    });

  const view = render(<PosterGrid {...gridProps(true)} />);
  await act(async () => Promise.resolve());
  show(view);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(2));
  const oldJobs = requests.map((request) => service.loadArtwork({ ...request, eager: false }));
  await act(async () => {
    finish[0]();
    finish[1]();
  });
  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

  view.rerender(<PosterGrid {...gridProps(false)} />);
  for (const image of images(view)) {
    expect(observations.get(image)).toBeUndefined();
  }

  view.rerender(<PosterGrid {...gridProps(true)} />);
  await act(async () => Promise.resolve());
  show(view);
  await vi.waitFor(() => expect(fetcher.mock.calls.length).toBe(4));
  const newJobs = requests.map((request) => service.loadArtwork({ ...request, eager: false }));
  for (const [index, job] of newJobs.entries()) {
    expect(job).not.toBe(oldJobs[index]);
  }
  await act(async () => {
    finish[2]();
    finish[3]();
  });
  // Both decode lanes are still held by the abandoned work, so nothing new runs yet.
  await act(async () => Promise.resolve());
  expect(createImageBitmap).toHaveBeenCalledTimes(2);

  await act(async () => {
    releases[0]();
    releases[1]();
  });
  for (const job of oldJobs) expect(await job).toBeNull();
  expect(stale[0].close).toHaveBeenCalledTimes(1);
  expect(stale[1].close).toHaveBeenCalledTimes(1);

  await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(4));
  for (const [index, job] of newJobs.entries()) {
    expect((await job)?.bitmap).toBe(fresh[index]);
  }
  expect(fresh[0].close).not.toHaveBeenCalled();
  expect(fresh[1].close).not.toHaveBeenCalled();
  for (const [index, request] of requests.entries()) {
    expect(service.artworkOf(request)?.bitmap).toBe(fresh[index]);
  }
  await vi.waitFor(() => {
    for (const image of images(view)) {
      expect(image instanceof HTMLCanvasElement).toBe(true);
    }
  });
});
