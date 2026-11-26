import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContentTransitionShade } from "../components/ContentTransitionShade";
import { Icon } from "../components/Icon";
import { PosterGrid, type PosterItem } from "../components/vod/PosterGrid";
import { VodCategoryRail } from "../components/vod/VodCategoryRail";
import { EpisodeList, isPlayableEpisode } from "../components/vod/EpisodeList";
import { seriesActions, SeriesDetails } from "../components/vod/SeriesDetails";
import { movieActions, VodDetails } from "../components/vod/VodDetails";
import { VodSearch } from "../components/vod/VodSearch";
import { pointerOnly } from "../hooks/usePointerAwake";
import { useContentTransition } from "../hooks/useContentTransition";
import { useLocale } from "../hooks/useLocale";
import { KEY } from "../hooks/useRemote";
import {
  useVodNavigation,
  type VodNavigation,
  type VodNavigationState,
  type VodOrigin,
} from "../hooks/useVodNavigation";
import { posterColumnsForViewport } from "../hooks/useWindowed";
import { recordFromEntries } from "../services/record";
import { searchVodItems, type SearchResults } from "../services/search";
import type { AppMode, SurfaceKeyHandler } from "../services/surfaceStack";
import type {
  XtreamCategory,
  XtreamEpisode,
  XtreamMovieDetail,
  XtreamSeriesDetail,
} from "../services/xtream";
import type { PlaybackProgressSeed } from "../types";
import {
  type LibraryItem,
  type LibraryKind,
  type LibraryList,
  type LibraryResource,
  type VodCategoryRow,
  useLibrary,
} from "../stores/library";
import { useLineup } from "../stores/lineup";
import {
  type FavouriteSnapshot,
  type ResolvedPlaybackProgress,
  usePersonal,
} from "../stores/personal";
import { useSettings, type Playlist } from "../stores/settings";

export interface VodScreenHandle {
  handleKey: SurfaceKeyHandler;
  closeDetails: () => void;
  closeSearch: () => void;
  restoreOrigin: (origin: VodOrigin) => void;
}

export interface VodPlaybackRequest {
  kind: "movie" | "episode";
  itemKey: string;
  name: string;
  categoryName: string;
  poster: string;
  year: string;
  rating: string;
  directSource: string;
  extension?: string;
  providerId?: string;
  resumeAt: number;
  restart: boolean;
  progress: PlaybackProgressSeed;
  origin: VodOrigin;
  siblingKeys: string[];
}

export interface VodScreenProps {
  mode: "movie" | "series";
  playlist: Playlist;
  scale: number;
  active: boolean;
  visible: boolean;
  playbackPending: boolean;
  onCancelPending: () => void;
  onAppNavigationFocus: () => void;
  searchRequest: { id: number; mode: AppMode; open: boolean };
  onSearchClosed?: (mode: AppMode, requestId: number) => void;
  onPageReady?: (mode: "movie" | "series") => void;
  onModeChange: (mode: AppMode) => void;
  onSettings: () => void;
  onReturnLive: () => void;
  onRequestExit: () => void;
  onPlay: (request: VodPlaybackRequest) => void;
}

const HIDDEN_PROGRESS: ResolvedPlaybackProgress[] = [];
const EMPTY_FAVOURITES: FavouriteSnapshot[] = [];
const EMPTY_VOD_CATEGORIES: VodCategoryRow[] = [];
const EMPTY_LIBRARY_RESOURCE: LibraryResource<LibraryItem[]> = {
  state: "idle",
  value: [],
  stale: false,
};
const EMPTY_LIBRARY_CATEGORIES: Record<LibraryKind, LibraryList<XtreamCategory>> = {
  movie: { state: "empty", items: [] },
  series: { state: "empty", items: [] },
};
const EMPTY_LIBRARY_CATEGORY_ITEMS: Record<string, LibraryList<LibraryItem>> = {};
const EMPTY_LIBRARY_SEARCH_ITEMS: Record<LibraryKind, LibraryList<LibraryItem>> = {
  movie: { state: "empty", items: [] },
  series: { state: "empty", items: [] },
};
export type VodSort = "provider" | "title" | "rating" | "release-date";

type VodViewItem = Pick<LibraryItem, "key" | "name" | "rating" | "year">;

export function availableVodSorts(items: readonly VodViewItem[]): VodSort[] {
  const options: VodSort[] = ["provider"];
  if (items.some((item) => item.name.trim())) options.push("title");
  if (items.some((item) => Number(item.rating) > 0)) options.push("rating");
  if (items.some((item) => /^\d{4}/.test(item.year))) options.push("release-date");
  return options;
}

export function applyVodView<T extends VodViewItem>(items: readonly T[], sort: VodSort): T[] {
  if (sort === "provider") return items.slice();
  const providerOrder = new Map(items.map((item, index) => [item.key, index]));
  return items.slice().sort((left, right) => {
    let compared = 0;
    if (sort === "title") compared = left.name.localeCompare(right.name);
    else if (sort === "rating") compared = Number(right.rating || 0) - Number(left.rating || 0);
    else compared = Number.parseInt(right.year, 10) - Number.parseInt(left.year, 10);
    if (!Number.isFinite(compared)) compared = 0;
    return compared || (providerOrder.get(left.key) ?? 0) - (providerOrder.get(right.key) ?? 0);
  });
}

const posterItems = (
  items: readonly LibraryItem[],
  favourites: ReadonlySet<string>,
  progress: ReadonlyMap<string, ResolvedPlaybackProgress>,
): PosterItem[] =>
  items.map((item) => {
    const saved = progress.get(item.key);
    return {
      key: item.key,
      kind: "streamId" in item ? "movie" : "series",
      title: item.name,
      poster: item.logo,
      metadata: item.year,
      rating: item.rating,
      favourite: favourites.has(item.key),
      ...(saved?.duration
        ? { progressPercent: Math.round((saved.seconds / saved.duration) * 100) }
        : {}),
    };
  });

export const VodScreen = forwardRef<VodScreenHandle, VodScreenProps>(function VodScreen(
  {
    mode,
    playlist,
    scale,
    active,
    visible,
    playbackPending,
    onCancelPending,
    onAppNavigationFocus,
    searchRequest,
    onSearchClosed,
    onPageReady,
    onModeChange,
    onSettings,
    onReturnLive,
    onRequestExit,
    onPlay,
  },
  ref,
) {
  const { locale, direction, number, t } = useLocale();
  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const kind: LibraryKind = mode;
  const libraryCategories = useLibrary((state) =>
    visible ? state.categories : EMPTY_LIBRARY_CATEGORIES,
  );
  const libraryCategoryItems = useLibrary((state) =>
    visible ? state.categoryItems : EMPTY_LIBRARY_CATEGORY_ITEMS,
  );
  const librarySearchItems = useLibrary((state) =>
    visible ? state.searchItems : EMPTY_LIBRARY_SEARCH_ITEMS,
  );
  const movieDetails = useLibrary((state) => state.movieDetails);
  const seriesDetails = useLibrary((state) => state.seriesDetails);
  const categoriesFor = useLibrary((state) => state.categoriesFor);
  const itemsFor = useLibrary((state) => state.itemsFor);
  const loadCategories = useLibrary((state) => state.loadCategories);
  const loadCategoryFromLibrary = useLibrary((state) => state.loadCategory);
  const loadIndex = useLibrary((state) => state.loadIndex);
  const loadMovie = useLibrary((state) => state.loadMovie);
  const loadSeries = useLibrary((state) => state.loadSeries);
  const progressSeedFor = useLibrary((state) => state.progressSeedFor);
  const retry = useLibrary((state) => state.retry);
  const selectPlaylist = useLibrary((state) => state.selectPlaylist);
  const seriesContinueFor = useLibrary((state) => state.seriesContinueFor);
  const library = useMemo(
    () => ({
      categoriesFor,
      itemsFor,
      loadCategories,
      loadCategory: loadCategoryFromLibrary,
      loadIndex,
      loadMovie,
      loadSeries,
      movieDetails,
      progressSeedFor,
      retry,
      selectPlaylist,
      seriesContinueFor,
      seriesDetails,
      libraryCategories,
      libraryCategoryItems,
      librarySearchItems,
    }),
    [
      categoriesFor,
      itemsFor,
      libraryCategories,
      libraryCategoryItems,
      librarySearchItems,
      loadCategories,
      loadCategoryFromLibrary,
      loadIndex,
      loadMovie,
      loadSeries,
      movieDetails,
      progressSeedFor,
      retry,
      selectPlaylist,
      seriesContinueFor,
      seriesDetails,
    ],
  );
  const favourites = usePersonal((state) => (visible ? state.favourites : EMPTY_FAVOURITES));
  const progress = usePersonal((state) => (visible ? state.progress : HIDDEN_PROGRESS));
  const lastPlayed = usePersonal((state) => (visible ? state.lastPlayed : null));
  const toggleFavourite = usePersonal((state) => state.toggleFavourite);
  const lineupRevision = useLineup((state) => (visible ? state.revision : 0));
  const hideEmptyCategories = useSettings((state) => state.hideEmptyCategories);
  const [movieInfoOverflow, setMovieInfoOverflow] = useState(false);
  const [posterColumns, setPosterColumns] = useState(() =>
    posterColumnsForViewport(window.innerWidth),
  );
  const [sortByMode, setSortByMode] = useState<Record<"movie" | "series", VodSort>>({
    movie: "provider",
    series: "provider",
  });
  const [cataloguePopup, setCataloguePopup] = useState(false);
  const [popupIndex, setPopupIndex] = useState(0);
  const selectedSort = sortByMode[mode];
  const pendingSortReset = useRef<{ mode: "movie" | "series"; sort: VodSort } | null>(null);
  const favouriteKeys = useMemo(
    () =>
      new Set(
        favourites
          .filter((item) => item.playlistId === playlist.id)
          .map((item) => item.itemKey),
      ),
    [favourites, playlist.id],
  );
  const progressByKey = useMemo(() => {
    const resolved = new Map<string, ResolvedPlaybackProgress>();
    for (const entry of progress) {
      if ("legacyOrder" in entry || entry.playlistId !== playlist.id) continue;
      const key =
        mode === "series" && entry.kind === "episode" ? entry.parentKey : entry.itemKey;
      if (!key) continue;
      const previous = resolved.get(key);
      if (!previous || previous.updatedAt < entry.updatedAt) resolved.set(key, entry);
    }
    return resolved;
  }, [mode, progress, playlist.id]);
  const navigationRef = useRef<VodNavigation | null>(null);
  const catalogueActionsRef = useRef<HTMLDivElement>(null);
  const readyDetail = useRef("");
  const loadedMode = useRef<"movie" | "series">(mode);
  const {
    categories,
    categoryKeys,
    categoryResources,
    viewedItemsByCategory,
    itemKeysByCategory,
    searchIndex,
  } =
    // biome-ignore lint/correctness/useExhaustiveDependencies: The getters read catalogue resources, personal overlays, lineup order and locale outside their arguments.
    useMemo(() => {
      const categories = visible
        ? categoriesFor(kind).filter((category) => !hideEmptyCategories || category.count !== 0)
        : EMPTY_VOD_CATEGORIES;
      const categoryResources = recordFromEntries(
        categories.map((category) => [category.key, itemsFor(kind, category.key)] as const),
      );
      const viewedItemsByCategory = recordFromEntries(
        Object.entries(categoryResources).map(
          ([key, resource]) => [key, applyVodView(resource.value, selectedSort)] as const,
        ),
      );
      const itemKeysByCategory = recordFromEntries(
        Object.entries(viewedItemsByCategory).map(
          ([key, items]) => [key, items.map((item) => item.key)] as const,
        ),
      );
      return {
        categories,
        categoryKeys: categories.map((category) => category.key),
        categoryResources,
        viewedItemsByCategory,
        itemKeysByCategory,
        searchIndex: visible ? itemsFor(kind, `${kind}:all`) : EMPTY_LIBRARY_RESOURCE,
      };
    }, [
      visible,
      kind,
      categoriesFor,
      itemsFor,
      libraryCategories,
      libraryCategoryItems,
      librarySearchItems,
      selectedSort,
      favourites,
      progress,
      lastPlayed,
      lineupRevision,
      locale,
      hideEmptyCategories,
    ]);

  const hintedDetailKey = navigationRef.current?.state.details?.itemKey ?? "";
  const hintedDetailResource =
    mode === "movie"
      ? library.movieDetails[hintedDetailKey]
      : library.seriesDetails[hintedDetailKey];
  const hintedMovie = library.movieDetails[hintedDetailKey]?.value;
  const hintedSeries = library.seriesDetails[hintedDetailKey]?.value;
  const hintedProgress = useMemo(
    () =>
      hintedDetailKey
        ? progress.find(
            (entry): entry is ResolvedPlaybackProgress =>
              !("legacyOrder" in entry) && entry.itemKey === hintedDetailKey,
          )
        : undefined,
    [hintedDetailKey, progress],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: seriesContinueFor reads current personal progress outside its arguments.
  const hintedContinue = useMemo(
    () => (hintedSeries ? seriesContinueFor(hintedSeries, lastPlayed) : null),
    [hintedSeries, lastPlayed, progress, seriesContinueFor],
  );
  const hintedSeason =
    navigationRef.current?.state.episodes?.selectedSeason ??
    hintedContinue?.episode.seasonKey ??
    hintedSeries?.seasons[0] ??
    "unassigned";
  const episodeKeysBySeason = useMemo(
    () =>
      recordFromEntries(
        (hintedSeries?.seasons ?? []).map(
          (season) =>
            [
              String(season),
              (hintedSeries?.episodes ?? [])
                .filter((episode) => episode.seasonKey === season && isPlayableEpisode(episode))
                .map((episode) => episode.key),
            ] as const,
        ),
      ),
    [hintedSeries],
  );
  const hintedDisplayed =
    navigationRef.current?.state.displayedCategoryKey ?? categories[0]?.key ?? `${kind}:all`;
  const hintedResource =
    categoryResources[hintedDisplayed] ??
    (visible ? library.itemsFor(kind, hintedDisplayed) : EMPTY_LIBRARY_RESOURCE);
  const loadCategory = useCallback(
    (categoryKey: string) => {
      if (categoryKey === `${kind}:all`) void library.loadIndex(kind, "all");
      else if (!categoryKey.endsWith(":continue") && !categoryKey.endsWith(":favourites")) {
        void library.loadCategory(kind, categoryKey);
      }
    },
    [kind, library.loadCategory, library.loadIndex],
  );

  const detailsTransition = useContentTransition(
    `${playlist.id}:v${playlist.sourceVersion}:${mode}`,
  );
  const detailsTransitioning =
    detailsTransition.phase === "leaving" || detailsTransition.phase === "settling";

  const searchForQuery = useMemo(() => {
    let cached:
      | { query: string; result: SearchResults<LibraryItem>; keys: string[] }
      | undefined;
    return (query: string) => {
      if (!cached || cached.query !== query) {
        const result = searchVodItems(searchIndex.value, query);
        cached = { query, result, keys: result.matches.map((item) => item.key) };
      }
      return cached;
    };
  }, [searchIndex.value]);

  const navigation = useVodNavigation({
    mode,
    direction,
    headerKeys: ["live", "movie", "series", "search", "settings"],
    categoryKeys,
    itemKeys: itemKeysByCategory[hintedDisplayed] ?? [],
    posterColumns,
    itemKeysByCategory,
    searchItemKeys: [],
    searchKeysForQuery: (query) => searchForQuery(query).keys,
    seasons: hintedSeries?.seasons ?? [],
    episodeKeys: episodeKeysBySeason[String(hintedSeason)] ?? [],
    episodeKeysBySeason,
    initialSeason: hintedContinue?.episode.seasonKey,
    initialEpisodeKey: hintedContinue?.episode.key,
    detailActionCount:
      mode === "movie" && hintedMovie
        ? movieActions(hintedProgress, movieInfoOverflow).length
        : mode === "series" && hintedSeries
          ? seriesActions(hintedSeries, hintedContinue).length
          : 0,
    detailRetryAvailable:
      !!hintedDetailResource &&
      !["idle", "loading"].includes(hintedDetailResource.state) &&
      (hintedDetailResource.state === "failed" ||
        hintedDetailResource.state === "too-large" ||
        !hintedDetailResource.value),
    regionState:
      hintedResource.state === "failed"
        ? "failed"
        : hintedResource.state === "empty"
          ? "empty"
          : "loaded",
    searchRegionState:
      searchIndex.state === "failed"
        ? "failed"
        : searchIndex.state === "empty"
          ? "empty"
          : "loaded",
    onCategorySettled: loadCategory,
    onQuerySettled: (query) => {
      if (query.trim()) void library.loadIndex(kind, "search");
    },
    onPosterSettled: () => undefined,
    onActivate: (state) => {
      if (state.zone === "header") {
        if (playbackPending) onCancelPending();
        if (state.headerControl === "live") onReturnLive();
        else if (state.headerControl === "movie" || state.headerControl === "series") {
          onModeChange(state.headerControl);
        } else if (state.headerControl === "search") {
          navigationRef.current?.openSearch();
        } else if (state.headerControl === "settings") onSettings();
        return;
      }
      if (state.zone === "grid" || state.zone === "search-grid") {
        const itemKey =
          state.zone === "search-grid" ? state.search?.itemKey : state.selectedItemKey;
        if (itemKey) navigationRef.current?.openDetails(itemKey);
        return;
      }
      if (state.zone === "detail-actions" && state.details) activateDetailAction(state);
      if (state.zone === "episode-list" && state.episodes) {
        const episode = seasonEpisodes.find((item) => item.key === state.episodes?.episodeKey);
        if (episode && isPlayableEpisode(episode)) activateEpisode(episode);
      }
    },
    onRetry: (state) => {
      if (state.search) void library.loadIndex(kind, "search");
      else void library.retry(state.displayedCategoryKey);
    },
    onRequestExit,
    onAppNavigationFocus,
    onSummaryScroll: (delta) => {
      const target = document.querySelector<HTMLElement>(".episode-preview-copy");
      target?.scrollBy({
        top: delta * 112,
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    },
    onDetailsTransition: (commit, returning) => {
      if (visible && active && !returning) detailsTransition.navigate(commit);
      else detailsTransition.navigateNow(commit);
    },
  });
  navigationRef.current = navigation;
  const selectedCategoryIndex = useMemo(
    () => categoryKeys.indexOf(navigation.state.selectedCategoryKey),
    [categoryKeys, navigation.state.selectedCategoryKey],
  );
  const rememberGridWindow = useCallback(
    (firstRow: number, visibleRows: number) =>
      navigation.rememberWindow(firstRow, false, visibleRows),
    [navigation.rememberWindow],
  );
  const rememberSearchWindow = useCallback(
    (firstRow: number, visibleRows: number) =>
      navigation.rememberWindow(firstRow, true, visibleRows),
    [navigation.rememberWindow],
  );

  const displayedKey =
    navigation.state.displayedCategoryKey || categories[0]?.key || `${kind}:all`;
  const categoryResource =
    categoryResources[displayedKey] ?? library.itemsFor(kind, displayedKey);
  const categoryItems = viewedItemsByCategory[displayedKey] ?? categoryResource.value;
  const appliedQuery = navigation.state.search?.applied ?? "";
  const searchResult = searchForQuery(appliedQuery).result;
  const searchResource: LibraryResource<LibraryItem[]> = {
    ...searchIndex,
    state:
      searchIndex.state === "loaded" && !searchResult.matches.length
        ? "empty"
        : searchIndex.state,
    value: searchResult.matches,
  };
  const cards = useMemo(
    () => posterItems(categoryItems, favouriteKeys, progressByKey),
    [categoryItems, favouriteKeys, progressByKey],
  );
  const searchCards = useMemo(
    () => posterItems(searchResult.matches, favouriteKeys, progressByKey),
    [favouriteKeys, progressByKey, searchResult.matches],
  );

  useEffect(() => {
    if (navigation.state.search || navigation.state.selectedItemKey || !categoryItems.length)
      return;
    navigationRef.current?.reconcileItems("");
  }, [categoryItems.length, navigation.state.search, navigation.state.selectedItemKey]);

  const detailKey = navigation.state.details?.itemKey ?? "";
  const movieDetail = library.movieDetails[detailKey];
  const movieState = movieDetail?.state ?? "idle";
  const detailResource: LibraryResource<XtreamMovieDetail | undefined> = {
    state: movieState === "too-large" ? "failed" : movieState,
    value: movieDetail?.value,
    stale: false,
    ...(movieState === "too-large" ? { error: "too-large" } : {}),
  };
  const detailProgress = progressByKey.get(detailKey);
  const seriesDetail = library.seriesDetails[detailKey];
  const seriesState = seriesDetail?.state ?? "idle";
  const seriesResource: LibraryResource<XtreamSeriesDetail | undefined> = {
    state: seriesState === "too-large" ? "failed" : seriesState,
    value: seriesDetail?.value,
    stale: false,
    ...(seriesState === "too-large" ? { error: "too-large" } : {}),
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: seriesContinueFor reads current personal progress outside its arguments.
  const continueTarget = useMemo(
    () =>
      seriesDetail?.value === hintedSeries
        ? hintedContinue
        : seriesDetail?.value
          ? seriesContinueFor(seriesDetail.value, lastPlayed)
          : null,
    [
      hintedContinue,
      hintedSeries,
      lastPlayed,
      progress,
      seriesContinueFor,
      seriesDetail?.value,
    ],
  );
  const selectedSeason =
    navigation.state.episodes?.selectedSeason ??
    continueTarget?.episode.seasonKey ??
    seriesDetail?.value?.seasons[0] ??
    "unassigned";
  const seasonEpisodes = useMemo(
    () =>
      seriesDetail?.value?.episodes.filter((episode) => episode.seasonKey === selectedSeason) ??
      [],
    [seriesDetail?.value, selectedSeason],
  );
  const episodeProgress = useMemo(
    () =>
      progress.filter(
        (entry): entry is ResolvedPlaybackProgress =>
          !("legacyOrder" in entry) &&
          entry.playlistId === playlist.id &&
          entry.kind === "episode" &&
          entry.parentKey === detailKey,
      ),
    [detailKey, progress, playlist.id],
  );
  const activeDetailState = mode === "movie" ? detailResource.state : seriesResource.state;

  useLayoutEffect(() => {
    if (!detailKey) {
      readyDetail.current = "";
      return;
    }
    const readyKey = `${mode}:${detailKey}`;
    if (activeDetailState !== "loaded" || readyDetail.current === readyKey) return;
    readyDetail.current = readyKey;
    navigation.focusFirstDetailAction();
  }, [activeDetailState, detailKey, mode, navigation.focusFirstDetailAction]);

  const playMovie = (resumeAt: number, restart: boolean) => {
    const detail = movieDetail?.value;
    const origin = navigation.state.details?.origin;
    if (!detail || !origin) return;
    const progress = library.progressSeedFor(detail);
    if (!progress) return;
    const siblings = origin.surface === "search" ? searchResult.matches : categoryItems;
    onPlay({
      kind: "movie",
      itemKey: detail.key,
      name: detail.name,
      categoryName:
        categories.find((category) => category.key === detail.categoryKey)?.name ?? "",
      poster: detail.logo,
      year: detail.year,
      rating: detail.rating,
      directSource: detail.directSource,
      ...(detail.extension ? { extension: detail.extension } : {}),
      ...(detail.streamId ? { providerId: detail.streamId } : {}),
      resumeAt,
      restart,
      progress,
      origin,
      siblingKeys: siblings.map((item) => item.key),
    });
  };

  const playEpisode = (episode: XtreamEpisode, resumeAt: number, restart: boolean) => {
    const detail = seriesDetail?.value;
    const origin = navigation.state.details?.origin;
    if (!detail || !origin) return;
    const progress = library.progressSeedFor(episode, detail);
    if (!progress) return;
    onPlay({
      kind: "episode",
      itemKey: episode.key,
      name: episode.name,
      categoryName: detail.name,
      poster: detail.logo,
      year: detail.year,
      rating: detail.rating,
      directSource: episode.directSource,
      ...(episode.extension ? { extension: episode.extension } : {}),
      ...(episode.episodeId ? { providerId: episode.episodeId } : {}),
      resumeAt,
      restart,
      progress,
      origin,
      siblingKeys: detail.episodes.filter(isPlayableEpisode).map((item) => item.key),
    });
  };

  const activateEpisode = (episode: XtreamEpisode) => {
    const saved = episodeProgress.find((entry) => entry.itemKey === episode.key);
    playEpisode(episode, saved?.seconds ?? 0, false);
  };

  const toggleDetailFavourite = () => {
    if (mode === "movie" && movieDetail?.value) {
      const detail = movieDetail.value;
      toggleFavourite({
        itemKey: detail.key,
        playlistId: playlist.id,
        kind: "movie",
        providerId: detail.streamId,
        categoryKey: detail.categoryKey,
        name: detail.name,
        logo: detail.logo,
        ...(detail.extension ? { extension: detail.extension } : {}),
      });
    } else if (mode === "series" && seriesDetail?.value) {
      const detail = seriesDetail.value;
      toggleFavourite({
        itemKey: detail.key,
        playlistId: playlist.id,
        kind: "series",
        providerId: detail.seriesId,
        categoryKey: detail.categoryKey,
        name: detail.name,
        logo: detail.logo,
      });
    }
  };

  const activateDetailAction = (state: VodNavigationState) => {
    if (!state.details) return;
    if (state.mode === "movie") {
      const action = movieActions(detailProgress, movieInfoOverflow)[state.details.actionIndex];
      if (action === "favourite") toggleDetailFavourite();
      else if (action === "resume") playMovie(detailProgress?.seconds ?? 0, false);
      else if (action === "restart") playMovie(0, true);
      else if (action === "play") playMovie(0, false);
      return;
    }
    if (!seriesDetail?.value) return;
    const action = seriesActions(seriesDetail.value, continueTarget)[state.details.actionIndex];
    if (action === "favourite") {
      toggleDetailFavourite();
    } else if (action === "continue" && continueTarget) {
      playEpisode(continueTarget.episode, continueTarget.resumeAt, false);
    } else if (action === "restart" && continueTarget) {
      playEpisode(continueTarget.episode, 0, true);
    } else if (action === "episodes") navigation.toggleEpisodes();
  };

  useEffect(() => {
    const resize = () => setPosterColumns(posterColumnsForViewport(window.innerWidth));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    library.selectPlaylist(playlist);
    void library.loadCategories(kind);
  }, [kind, library.loadCategories, library.selectPlaylist, playlist]);

  useEffect(() => {
    if (!categories.length || navigation.state.selectedCategoryKey) return;
    navigation.selectCategory(0, false);
  }, [categories.length, navigation.selectCategory, navigation.state.selectedCategoryKey]);

  useEffect(() => {
    if (
      navigation.state.mode !== mode ||
      !navigation.state.selectedCategoryKey ||
      loadedMode.current === mode
    )
      return;
    loadedMode.current = mode;
    loadCategory(navigation.state.selectedCategoryKey);
  }, [loadCategory, mode, navigation.state.mode, navigation.state.selectedCategoryKey]);

  useEffect(() => {
    const itemKey = navigation.state.details?.itemKey;
    if (!itemKey) return;
    if (mode === "movie") void library.loadMovie(itemKey);
    else void library.loadSeries(itemKey);
  }, [library.loadMovie, library.loadSeries, mode, navigation.state.details?.itemKey]);

  useEffect(() => {
    if (navigation.state.episodes?.open && seriesDetail?.value) {
      navigationRef.current?.reconcileEpisodes();
    }
  }, [navigation.state.episodes?.open, seriesDetail?.value]);

  const sortOptions = useMemo(
    () => availableVodSorts(categoryResource.value),
    [categoryResource.value],
  );
  const categoryLoading =
    categoryResource.state === "loading" || categoryResource.state === "idle";
  useLayoutEffect(() => {
    if (
      !active ||
      navigation.state.search ||
      navigation.state.details ||
      navigation.state.zone !== "grid"
    )
      return;
    if (categoryResource.state === "failed") {
      navigation.focusRetry();
      return;
    }
    if (
      cards.length ||
      (categoryResource.state !== "loaded" && categoryResource.state !== "empty")
    )
      return;
    const index = categories.findIndex(
      (category) => category.key === navigation.state.selectedCategoryKey,
    );
    if (index >= 0) navigation.focusCategory(index);
  }, [
    active,
    cards.length,
    categories,
    categoryResource.state,
    navigation.focusCategory,
    navigation.focusRetry,
    navigation.state.details,
    navigation.state.search,
    navigation.state.selectedCategoryKey,
    navigation.state.zone,
  ]);
  const effectiveSort = sortOptions.includes(selectedSort) ? selectedSort : "provider";
  useLayoutEffect(() => {
    const pending = pendingSortReset.current;
    if (pending?.mode !== mode || pending.sort !== selectedSort) return;
    pendingSortReset.current = null;
    navigationRef.current?.resetItems();
  }, [mode, selectedSort]);

  const choosePopupOption = useCallback(
    (index: number) => {
      const option = sortOptions[index];
      if (!option) return;
      if (option !== selectedSort) pendingSortReset.current = { mode, sort: option };
      setSortByMode((current) => ({ ...current, [mode]: option }));
      setCataloguePopup(false);
    },
    [mode, selectedSort, sortOptions],
  );

  useEffect(() => {
    if (!cataloguePopup) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !catalogueActionsRef.current?.contains(event.target)
      ) {
        setCataloguePopup(false);
      }
    };
    window.addEventListener("pointerdown", closeOutside, true);
    return () => window.removeEventListener("pointerdown", closeOutside, true);
  }, [cataloguePopup]);

  const backFromDetails = useCallback(() => {
    if (playbackPending) onCancelPending();
    navigation.handleKey(KEY.BACK, { preventDefault() {} } as KeyboardEvent);
    navigation.focusDetailBack();
  }, [navigation.handleKey, navigation.focusDetailBack, onCancelPending, playbackPending]);

  const handleKey = useCallback<SurfaceKeyHandler>(
    (code, event) => {
      if (detailsTransitioning) {
        if (code === KEY.BACK || code === KEY.ESC) {
          detailsTransition.cancel();
          if (navigation.state.details) navigation.handleKey(code, event);
          event.preventDefault();
          return;
        }
        if (
          code === KEY.UP ||
          code === KEY.DOWN ||
          code === KEY.LEFT ||
          code === KEY.RIGHT ||
          code === KEY.ENTER
        ) {
          event.preventDefault();
          return;
        }
      }
      if (cataloguePopup) {
        if (code === KEY.LEFT || code === KEY.RIGHT) {
          setCataloguePopup(false);
          navigation.handleKey(code, event);
          return;
        }
        if (code === KEY.BACK || code === KEY.ESC) setCataloguePopup(false);
        else if (code === KEY.UP || code === KEY.DOWN) {
          const delta = code === KEY.DOWN ? 1 : -1;
          setPopupIndex((current) =>
            Math.max(0, Math.min(sortOptions.length - 1, current + delta)),
          );
        } else if (code === KEY.ENTER) choosePopupOption(popupIndex);
        event.preventDefault();
        return;
      }
      if (navigation.state.zone === "catalogue-actions" && code === KEY.ENTER) {
        if (!categoryLoading) {
          setCataloguePopup(true);
          setPopupIndex(Math.max(0, sortOptions.indexOf(effectiveSort)));
        }
        event.preventDefault();
        return;
      }
      const activeElement = document.activeElement;
      const textControl =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      if (textControl && code >= KEY.SPACE && code <= 126) return;
      if (navigation.state.zone === "detail-back" && code === KEY.ENTER) {
        backFromDetails();
        event.preventDefault();
        return;
      }
      if (playbackPending && code === KEY.STOP) {
        onCancelPending();
        event.preventDefault();
        return;
      }
      if (playbackPending && (code === KEY.BACK || code === KEY.ESC)) onCancelPending();
      const activatesPlayback =
        code === KEY.ENTER ||
        (navigation.state.zone === "detail-actions" && code === inlineEnd);
      if (
        playbackPending &&
        activatesPlayback &&
        (navigation.state.zone === "detail-actions" || navigation.state.zone === "episode-list")
      ) {
        event.preventDefault();
        return;
      }
      const failed =
        mode === "movie"
          ? detailResource.state === "failed"
          : seriesResource.state === "failed";
      if (navigation.state.details && failed && code === KEY.ENTER) {
        event.preventDefault();
        void library.retry(detailKey);
        return;
      }
      navigation.handleKey(code, event);
    },
    [
      backFromDetails,
      cataloguePopup,
      categoryLoading,
      choosePopupOption,
      detailsTransition.cancel,
      detailsTransitioning,
      detailKey,
      detailResource.state,
      effectiveSort,
      inlineEnd,
      library.retry,
      mode,
      navigation.handleKey,
      navigation.state.details,
      navigation.state.zone,
      popupIndex,
      onCancelPending,
      playbackPending,
      seriesResource.state,
      sortOptions,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      handleKey,
      closeDetails: () => {
        const origin = navigationRef.current?.state.details?.origin;
        if (origin) navigationRef.current?.restoreOrigin(origin);
      },
      closeSearch: navigation.closeSearch,
      restoreOrigin: navigation.restoreOrigin,
    }),
    [handleKey, navigation.closeSearch, navigation.restoreOrigin],
  );

  const openSearch = useCallback(() => {
    if (playbackPending) onCancelPending();
    navigation.openSearch();
  }, [navigation.openSearch, onCancelPending, playbackPending]);

  const lastSearchRequest = useRef<typeof searchRequest | null>(null);
  const searchOwnerRef = useRef<{ mode: AppMode; id: number } | null>(null);
  useLayoutEffect(() => {
    if (lastSearchRequest.current?.id === searchRequest.id) return;
    lastSearchRequest.current = searchRequest;
    if (searchRequest.open && searchRequest.mode === mode) {
      searchOwnerRef.current = { mode: searchRequest.mode, id: searchRequest.id };
      openSearch();
    } else {
      navigation.closeSearch();
    }
  }, [mode, navigation.closeSearch, openSearch, searchRequest]);

  /*
   * A search closed here, not by a request, still owes the request channel its answer.
   * The owner saved when the request opened it travels with the close, so an acknowledgement
   * from an older scope can never cancel a newer one: the channel matches id, mode and open.
   */
  const vodSearchOpen = !!navigation.state.search;
  const previousVodSearchOpen = useRef(vodSearchOpen);
  useLayoutEffect(() => {
    if (vodSearchOpen === previousVodSearchOpen.current) return;
    previousVodSearchOpen.current = vodSearchOpen;
    const owner = searchOwnerRef.current;
    if (!vodSearchOpen && owner) {
      searchOwnerRef.current = null;
      onSearchClosed?.(owner.mode, owner.id);
    }
  }, [onSearchClosed, vodSearchOpen]);

  useLayoutEffect(() => {
    if (visible) onPageReady?.(mode);
  }, [mode, onPageReady, visible]);

  const displayedCategory = useMemo(
    () => categories.find((category) => category.key === displayedKey),
    [categories, displayedKey],
  );
  const categoryTitle =
    displayedCategory?.source === "continue"
      ? t("vod.continueWatching")
      : displayedCategory?.source === "favourites"
        ? t("vod.favourites")
        : displayedCategory?.name || t("vod.uncategorised");
  const categoryCount =
    categoryResource.state === "loaded" || categoryResource.state === "empty"
      ? cards.length
      : displayedCategory?.count;
  const categoryHeadingId = `vod-category-heading-${mode}`;
  const sortLabel = (sort: VodSort) =>
    t(
      sort === "title"
        ? "vod.sortTitle"
        : sort === "rating"
          ? "vod.sortRating"
          : sort === "release-date"
            ? "vod.sortReleaseDate"
            : "vod.sortProvider",
    );
  const grid = {
    windowKey: `${mode}:${displayedKey}:${navigation.state.memories[mode].posterWindowRevision}`,
    cursor: navigation.state.selectedItemIndex,
    totalItems: cards.length,
    firstRow: navigation.state.memories[mode].firstRow,
    focused: active && (navigation.state.zone === "grid" || navigation.state.zone === "retry"),
    fetchReady: navigation.posterFetchReady,
    artworkActive:
      visible &&
      (!navigation.state.search ||
        navigation.state.search.query === navigation.state.search.applied),
    scale,
    columns: posterColumns,
    onFocus: navigation.selectItem,
    onActivate: (itemKey: string, index: number) => {
      navigation.selectItem(index);
      navigation.openDetails(itemKey);
    },
    onRetry: () => void library.retry(displayedKey),
    onWheel: (deltaY: number) => {
      if (!detailsTransitioning) navigation.handleWheel(deltaY);
    },
    onWindowChange: rememberGridWindow,
  };

  return (
    <section
      className={`vod-screen safe-area ${navigation.state.details ? "details-open" : ""}`.trim()}
      style={{ "--scale": scale } as React.CSSProperties}
      data-mode={mode}
    >
      {navigation.state.details && (
        <div className="vod-detail-back-rail">
          <button
            className="btn tonal vod-detail-back"
            type="button"
            aria-label={t("common.back")}
            data-selected={(active && navigation.state.zone === "detail-back") || undefined}
            onPointerEnter={() => pointerOnly(navigation.focusDetailBack)}
            onFocus={navigation.focusDetailBack}
            onClick={backFromDetails}
          >
            <Icon name="return" logicalDirection />
          </button>
        </div>
      )}
      {navigation.state.details && mode === "movie" ? (
        <VodDetails
          resource={detailResource}
          origin={navigation.state.details.origin}
          title={
            categoryItems.find((item) => item.key === detailKey)?.name ??
            searchIndex.value.find((item) => item.key === detailKey)?.name
          }
          poster={
            categoryItems.find((item) => item.key === detailKey)?.logo ??
            searchIndex.value.find((item) => item.key === detailKey)?.logo
          }
          progress={detailProgress}
          favourite={favouriteKeys.has(detailKey)}
          playbackPending={playbackPending}
          drawerOpen={navigation.state.details.drawerOpen}
          focus={{
            zone: !active
              ? null
              : navigation.state.details.drawerOpen
                ? "drawer"
                : navigation.state.zone === "detail-actions"
                  ? "actions"
                  : navigation.state.zone === "retry"
                    ? "retry"
                    : null,
            index: navigation.state.details.actionIndex,
          }}
          onToggleFavourite={toggleDetailFavourite}
          onFocusAction={navigation.focusDetailAction}
          onFocusRetry={navigation.focusRetry}
          onPlay={(choice) => playMovie(choice.resumeAt, choice.restart)}
          onDrawerChange={navigation.setDrawerOpen}
          onOverflowChange={setMovieInfoOverflow}
          onRetry={() => void library.retry(detailKey)}
        />
      ) : navigation.state.details && mode === "series" ? (
        <SeriesDetails
          resource={seriesResource}
          origin={navigation.state.details.origin}
          title={
            categoryItems.find((item) => item.key === detailKey)?.name ??
            searchIndex.value.find((item) => item.key === detailKey)?.name
          }
          poster={
            categoryItems.find((item) => item.key === detailKey)?.logo ??
            searchIndex.value.find((item) => item.key === detailKey)?.logo
          }
          continueTarget={continueTarget}
          favourite={favouriteKeys.has(detailKey)}
          playbackPending={playbackPending}
          actionIndex={navigation.state.details.actionIndex}
          actionFocused={active && navigation.state.zone === "detail-actions"}
          retryFocused={active && navigation.state.zone === "retry"}
          episodePanelOpen={navigation.state.episodes?.open ?? false}
          episodePanel={
            seriesDetail?.value ? (
              <EpisodeList
                detail={seriesDetail.value}
                seasonCursor={navigation.state.episodes?.seasonCursor ?? selectedSeason}
                selectedSeason={navigation.state.episodes?.selectedSeason ?? selectedSeason}
                episodeKey={
                  navigation.state.episodes?.episodeKey ||
                  continueTarget?.episode.key ||
                  seasonEpisodes[0]?.key ||
                  ""
                }
                visible={navigation.state.episodes?.open ?? false}
                disabled={playbackPending}
                summaryFocused={active && navigation.state.zone === "episode-summary"}
                focusedZone={
                  active && navigation.state.episodes?.open
                    ? navigation.state.zone === "season-row"
                      ? "season"
                      : navigation.state.zone === "episode-list"
                        ? "episode"
                        : null
                    : null
                }
                state={seasonEpisodes.length ? "loaded" : "empty"}
                nextEpisodeKey={
                  continueTarget?.reason === "next" ? continueTarget.episode.key : undefined
                }
                progress={episodeProgress}
                onSummaryFocus={navigation.focusSummary}
                onFocusSeason={navigation.focusSeason}
                onCommitSeason={navigation.commitSeason}
                onFocusEpisode={navigation.selectEpisode}
                onSelectEpisode={activateEpisode}
                onWheel={(deltaY) => {
                  if (!detailsTransitioning) navigation.handleWheel(deltaY);
                }}
              />
            ) : undefined
          }
          onToggleFavourite={toggleDetailFavourite}
          onFocusAction={navigation.focusDetailAction}
          onFocusRetry={navigation.focusRetry}
          onContinue={(target) => playEpisode(target.episode, target.resumeAt, false)}
          onRestart={(target) => playEpisode(target.episode, 0, true)}
          onToggleEpisodes={navigation.toggleEpisodes}
          onRetry={() => void library.retry(detailKey)}
        />
      ) : navigation.state.search ? (
        <VodSearch
          kind={kind}
          query={navigation.state.search.query}
          appliedQuery={navigation.state.search.applied}
          fieldFocused={active && navigation.state.zone === "search-field"}
          submitFocused={active && navigation.state.zone === "search-submit"}
          results={searchResource}
          items={searchCards}
          total={searchResult.total}
          grid={{
            ...grid,
            windowKey: `${mode}:search:${navigation.state.search.applied}`,
            cursor: navigation.state.search.itemIndex,
            totalItems: searchCards.length,
            firstRow: navigation.state.search.firstRow,
            focused:
              active &&
              (navigation.state.zone === "search-grid" || navigation.state.zone === "retry"),
            onRetry: () => void library.loadIndex(kind, "search"),
            onWindowChange: rememberSearchWindow,
            onFocus: navigation.selectItem,
            onActivate: (itemKey, index) => {
              navigation.selectItem(index);
              navigation.openDetails(itemKey);
            },
          }}
          onQuery={navigation.setQuery}
          onSubmit={navigation.submitQuery}
          onExitUp={() =>
            navigation.handleKey(KEY.UP, { preventDefault() {} } as KeyboardEvent)
          }
          onExitDown={() =>
            navigation.handleKey(KEY.DOWN, { preventDefault() {} } as KeyboardEvent)
          }
          onExitStart={() =>
            navigation.handleKey(inlineStart, { preventDefault() {} } as KeyboardEvent)
          }
          onExitEnd={() =>
            navigation.handleKey(inlineEnd, { preventDefault() {} } as KeyboardEvent)
          }
          onDismissKeyboard={() =>
            navigation.handleKey(KEY.BACK, { preventDefault() {} } as KeyboardEvent)
          }
        />
      ) : (
        <div className="vod-catalogue">
          <VodCategoryRail
            items={categories}
            cursor={Math.max(0, selectedCategoryIndex)}
            selectedKey={navigation.state.selectedCategoryKey}
            focused={active && navigation.state.zone === "rail"}
            scale={scale}
            firstRow={navigation.state.memories[mode].categoryFirst}
            scrollOffset={navigation.state.memories[mode].categoryScrollOffset}
            reportWindowMetrics
            onFocus={navigation.focusCategory}
            onSelect={navigation.selectCategory}
            onWindowChange={navigation.rememberCategoryWindow}
          />
          <div className="vod-pane-divider" aria-hidden="true" />
          <div
            className="vod-pane"
            aria-busy={
              navigation.state.selectedCategoryKey !== navigation.state.displayedCategoryKey ||
              categoryResource.state === "loading" ||
              categoryResource.state === "idle"
            }
          >
            <header className="vod-category-header">
              <div className="vod-category-heading">
                <h2
                  id={categoryHeadingId}
                  className={categoryLoading ? "vod-category-title-skeleton" : undefined}
                >
                  {categoryTitle}
                </h2>
                <span
                  className={`count${categoryLoading ? " vod-category-count-skeleton" : ""}`}
                  aria-hidden={categoryLoading || categoryCount === undefined}
                  style={{
                    visibility:
                      !categoryLoading && categoryCount === undefined ? "hidden" : undefined,
                  }}
                >
                  {number(categoryCount ?? 0)}
                </span>
              </div>
              <div ref={catalogueActionsRef} className="vod-catalogue-actions">
                <button
                  type="button"
                  className={`vod-catalogue-action ${categoryLoading ? "vod-catalogue-action-skeleton" : active && navigation.state.zone === "catalogue-actions" && navigation.state.catalogueActionIndex === 0 ? "cursor" : ""}`}
                  disabled={categoryLoading}
                  aria-haspopup="menu"
                  aria-expanded={!categoryLoading && cataloguePopup}
                  onPointerEnter={() =>
                    !categoryLoading && pointerOnly(() => navigation.focusCatalogueAction(0))
                  }
                  onClick={() => {
                    navigation.focusCatalogueAction(0);
                    setPopupIndex(Math.max(0, sortOptions.indexOf(effectiveSort)));
                    setCataloguePopup((open) => !open);
                  }}
                >
                  <Icon name="sort" />
                  <span className="vod-sort-label">
                    <span>{`${t("vod.sort")}: ${sortLabel(effectiveSort)}`}</span>
                    {(["provider", "title", "rating", "release-date"] as const).map(
                      (option) => (
                        <span
                          key={option}
                          className="vod-sort-size"
                          aria-hidden="true"
                        >{`${t("vod.sort")}: ${sortLabel(option)}`}</span>
                      ),
                    )}
                  </span>
                </button>
                {!categoryLoading && cataloguePopup && (
                  <div className="vod-catalogue-popup" role="menu" aria-label={t("vod.sort")}>
                    {sortOptions.map((option, index) => {
                      const selected = effectiveSort === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={selected}
                          className={index === popupIndex ? "cursor" : ""}
                          onPointerEnter={() => pointerOnly(() => setPopupIndex(index))}
                          onClick={() => {
                            setPopupIndex(index);
                            choosePopupOption(index);
                          }}
                        >
                          <span>{sortLabel(option)}</span>
                          <span className="vod-popup-selection" aria-hidden="true">
                            {selected ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </header>
            <div className="vod-category-divider" aria-hidden="true" />
            <PosterGrid
              key={displayedKey}
              items={cards}
              resourceState={categoryResource.state}
              ariaLabelledBy={categoryHeadingId}
              {...grid}
            />
          </div>
        </div>
      )}
      <ContentTransitionShade
        phase={detailsTransition.phase}
        onTransitionEnd={detailsTransition.onTransitionEnd}
      />
    </section>
  );
});
