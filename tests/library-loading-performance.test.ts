import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { XtreamCategory } from "../src/services/xtream";
import type { Playlist } from "../src/stores/settings";

const disk = new Map<string, string | Blob>();
const idleWork = new Set<() => void>();
const adoptCategorySummaries = vi.fn(async () => {});
const loadXtreamCategories = vi.fn<() => Promise<XtreamCategory[]>>();
const cacheKey = "xtream:catalogue:v1:categories";
const playlist: Playlist = {
  id: "catalogue",
  name: "Provider",
  sourceVersion: 1,
  hiddenCategories: [],
  source: {
    kind: "xtream",
    server: "http://provider.example",
    username: "viewer",
    password: "fixture",
    output: "m3u8",
  },
};
const categories: XtreamCategory[] = [
  { key: "live:1", id: "1", kind: "live", name: "Provider Live" },
  { key: "movie:10", id: "10", kind: "movie", name: "Provider Movies", count: 4 },
  { key: "series:20", id: "20", kind: "series", name: "Provider Series", count: 2 },
  { key: "series:21", id: "21", kind: "series", name: "More Series" },
];
const copyCategories = () => categories.map((category) => ({ ...category }));

async function loadStore(cachedCategories = categories) {
  vi.resetModules();
  disk.set(cacheKey, JSON.stringify(cachedCategories));
  localStorage.setItem(`openiptv.at.${cacheKey}`, String(Date.now() - 7 * 60 * 60 * 1000));
  vi.doMock("../src/services/disk", () => ({
    read: async (key: string) => disk.get(key) ?? null,
    write: async (key: string, value: string | Blob) => {
      disk.set(key, value);
      return true;
    },
  }));
  vi.doMock("../src/services/idle", () => ({
    whenIdle: (work: () => void) => {
      idleWork.add(work);
      return () => idleWork.delete(work);
    },
  }));
  vi.doMock("../src/stores/lineup", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/stores/lineup")>()),
    adoptCategorySummaries,
  }));
  vi.doMock("../src/services/xtream", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/services/xtream")>()),
    authenticateXtream: vi.fn(async () => ({})),
    loadXtreamCategories,
  }));
  const { useLibrary } = await import("../src/stores/library");
  useLibrary.getState().selectPlaylist(playlist);
  await useLibrary.getState().loadCategories("movie");
  return useLibrary;
}

function refreshMetadata() {
  const queued = [...idleWork];
  idleWork.clear();
  for (const work of queued) work();
}

beforeEach(() => {
  localStorage.clear();
  disk.clear();
  idleWork.clear();
  adoptCategorySummaries.mockClear();
  loadXtreamCategories.mockReset();
  loadXtreamCategories.mockResolvedValue(copyCategories());
});

afterEach(() => vi.restoreAllMocks());

test("unchanged metadata refresh keeps both category lists and publishes no library update", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  expect(previous.movie.state).toBe("loaded");
  expect(previous.series.state).toBe("loaded");
  const published = vi.fn();
  const unsubscribe = useLibrary.subscribe(published);

  refreshMetadata();
  await vi.waitFor(() => expect(adoptCategorySummaries).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(Number(localStorage.getItem(`openiptv.at.${cacheKey}`))).toBeGreaterThan(
      Date.now() - 60 * 1000,
    ),
  );

  expect(useLibrary.getState().categories).toBe(previous);
  expect(published).not.toHaveBeenCalled();
  expect(JSON.parse(String(disk.get(cacheKey)))).toEqual(categories);
  unsubscribe();
});

test("fresh metadata clears a category error without replacing the unaffected mode", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  useLibrary.setState({
    categories: {
      ...previous,
      movie: { ...previous.movie, error: "Previous request failed" },
    },
  });

  refreshMetadata();
  await vi.waitFor(() => expect(useLibrary.getState().categories.movie.error).toBeUndefined());
  expect(useLibrary.getState().categories.movie.items).toEqual(previous.movie.items);
  expect(useLibrary.getState().categories.series).toBe(previous.series);
});

test("Live metadata changes still update the shared cache without replacing VOD lists", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  const refreshed = copyCategories();
  refreshed[0].name = "Updated Provider Live";
  loadXtreamCategories.mockResolvedValue(refreshed);

  refreshMetadata();
  await vi.waitFor(() =>
    expect(JSON.parse(String(disk.get(cacheKey)))[0].name).toBe("Updated Provider Live"),
  );

  expect(useLibrary.getState().categories).toBe(previous);
});

test("a Series rename preserves the Movie category list and exact provider text", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  const refreshed = copyCategories();
  refreshed[2].name = "  Séries | Original  ";
  loadXtreamCategories.mockResolvedValue(refreshed);

  refreshMetadata();
  await vi.waitFor(() =>
    expect(useLibrary.getState().categories.series.items[0].name).toBe("  Séries | Original  "),
  );

  expect(useLibrary.getState().categories.movie).toBe(previous.movie);
  expect(useLibrary.getState().categories.series).not.toBe(previous.series);
});

test("a Movie count change preserves the Series category list", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  const refreshed = copyCategories();
  refreshed[1].count = 0;
  loadXtreamCategories.mockResolvedValue(refreshed);

  refreshMetadata();
  await vi.waitFor(() => expect(useLibrary.getState().categories.movie.items[0].count).toBe(0));

  expect(useLibrary.getState().categories.series).toBe(previous.series);
  expect(useLibrary.getState().categories.movie).not.toBe(previous.movie);
});

test("metadata refresh preserves provider order when categories move", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  const refreshed = copyCategories();
  [refreshed[2], refreshed[3]] = [refreshed[3], refreshed[2]];
  loadXtreamCategories.mockResolvedValue(refreshed);

  refreshMetadata();
  await vi.waitFor(() =>
    expect(useLibrary.getState().categories.series.items.map((item) => item.key)).toEqual([
      "series:21",
      "series:20",
    ]),
  );

  expect(useLibrary.getState().categories.movie).toBe(previous.movie);
});

test("removing every Series category publishes the empty state without replacing Movies", async () => {
  const useLibrary = await loadStore();
  const previous = useLibrary.getState().categories;
  loadXtreamCategories.mockResolvedValue(
    copyCategories().filter((category) => category.kind !== "series"),
  );

  refreshMetadata();
  await vi.waitFor(() =>
    expect(useLibrary.getState().categories.series).toEqual({ state: "empty", items: [] }),
  );

  expect(useLibrary.getState().categories.movie).toBe(previous.movie);
});

test("an unchanged empty mode retains its list when the other mode refreshes", async () => {
  const onlyMovies = categories.filter((category) => category.kind !== "series");
  const useLibrary = await loadStore(onlyMovies);
  const previous = useLibrary.getState().categories;
  const refreshed = onlyMovies.map((category) => ({ ...category }));
  refreshed[1].count = 5;
  loadXtreamCategories.mockResolvedValue(refreshed);

  refreshMetadata();
  await vi.waitFor(() => expect(useLibrary.getState().categories.movie.items[0].count).toBe(5));

  expect(useLibrary.getState().categories.series).toBe(previous.series);
  expect(useLibrary.getState().categories.series.state).toBe("empty");
});

test("changing playlist ownership cancels the queued metadata refresh", async () => {
  const useLibrary = await loadStore();
  expect(idleWork.size).toBe(1);

  useLibrary.getState().selectPlaylist({ ...playlist, sourceVersion: 2 });
  const previous = useLibrary.getState().categories;
  refreshMetadata();

  expect(loadXtreamCategories).not.toHaveBeenCalled();
  expect(useLibrary.getState().categories).toBe(previous);
  expect(useLibrary.getState().sourceVersion).toBe(2);
});
