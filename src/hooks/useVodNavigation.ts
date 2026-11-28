import { useCallback, useEffect, useRef, useState } from "react";
import type { Direction } from "../services/locale";
import type { XtreamSeasonKey } from "../services/xtream";
import { stepDetailAction } from "../services/vodActionLayout";
import { pointerInputActive } from "./usePointerAwake";
import { KEY } from "./useRemote";
import { MAX_LIST_STEP, useListAcceleration } from "./useListAcceleration";
import { POSTER_COLUMNS, wheelStep, windowOf } from "./useWindowed";

export type VodHeaderControl = "live" | "movie" | "series" | "search" | "settings";

export type VodZone =
  | "header"
  | "rail"
  | "rail-search"
  | "catalogue-actions"
  | "grid"
  | "search-field"
  | "search-submit"
  | "search-grid"
  | "search-categories"
  | "detail-actions"
  | "detail-copy"
  | "season-row"
  | "episode-list"
  | "episode-summary"
  | "retry";

export type VodOrigin = {
  mode: "movie" | "series";
  surface: "category" | "search";
  categoryKey: string;
  itemKey: string;
  itemIndex: number;
  firstRow: number;
  query?: string;
  appliedQuery?: string;
};

export interface VodModeMemory {
  categoryKey: string;
  railIndex: number;
  itemKey: string;
  itemIndex: number;
  firstRow: number;
  categoryFirst: number;
  categoryScrollOffset?: number;
  posterWindowRevision: number;
  itemByCategory: Record<string, string>;
  indexByCategory: Record<string, number>;
  firstRowByCategory: Record<string, number>;
  contentZoneByCategory?: Record<string, "grid" | "catalogue-actions">;
  seasonBySeries: Record<string, XtreamSeasonKey>;
  episodeBySeason: Record<string, string>;
}

export interface VodNavigationState {
  mode: "movie" | "series";
  zone: VodZone;
  headerControl: VodHeaderControl;
  headerReturnZone: "rail" | "grid" | "search-field" | "detail-actions";
  selectedCategoryKey: string;
  displayedCategoryKey: string;
  selectedItemKey: string;
  selectedItemIndex: number;
  catalogueActionIndex: number;
  search: null | {
    query: string;
    applied: string;
    keyboardOpen: boolean;
    control?: "search-field" | "search-submit";
    itemKey: string;
    itemIndex: number;
    categoryIndex?: number;
    firstRow: number;
    origin: VodOrigin;
  };
  details: null | {
    itemKey: string;
    origin: VodOrigin;
    actionIndex: number;
    drawerOpen: boolean;
  };
  episodes: null | {
    open: boolean;
    seasonCursor: XtreamSeasonKey;
    selectedSeason: XtreamSeasonKey;
    episodeKey: string;
    heroActionIndex: number;
  };
  memories: Record<"movie" | "series", VodModeMemory>;
}

export interface VodNavigationContext {
  direction: Direction;
  headerKeys: readonly VodHeaderControl[];
  categoryKeys: readonly string[];
  categoryHeaderIndex?: number;
  categoryVisibleRows?: number;
  categoryRowHeight?: number;
  itemKeys: readonly string[];
  itemKeysByCategory?: Readonly<Record<string, readonly string[]>>;
  posterColumns?: number;
  posterVisibleRows?: number;
  searchVisibleRows?: number;
  searchItemKeys: readonly string[];
  searchKeysForQuery?: (query: string) => readonly string[];
  searchCategoryKeys?: readonly string[];
  searchCategoryKeysForQuery?: (query: string) => readonly string[];
  seasons: readonly XtreamSeasonKey[];
  episodeKeys: readonly string[];
  episodeKeysBySeason?: Readonly<Record<string, readonly string[]>>;
  initialSeason?: XtreamSeasonKey;
  initialEpisodeKey?: string;
  detailActionCount: number;
  detailInfoOverflow?: boolean;
  detailRetryAvailable: boolean;
  regionState: "loaded" | "empty" | "failed";
  searchRegionState?: "idle" | "loading" | "loaded" | "empty" | "failed";
}

export type VodAction =
  | { type: "key"; code: number; amount?: number; repeat?: boolean }
  | { type: "mode"; mode: "movie" | "series" }
  | { type: "category-focus"; index: number }
  | { type: "category-display"; categoryKey: string; enterContent?: boolean }
  | { type: "category-window"; first: number; scrollOffset?: number }
  | { type: "item-focus"; index: number }
  | { type: "items-reconcile"; preferredKey: string }
  | { type: "items-reset" }
  | { type: "catalogue-action-focus"; index: number }
  | { type: "item-window"; firstRow: number }
  | { type: "search-window"; firstRow: number }
  | { type: "search-open" }
  | { type: "search-close" }
  | { type: "query"; value: string }
  | { type: "query-apply"; value: string }
  | { type: "search-control-focus"; control: "search-field" | "search-submit" }
  | { type: "search-category-focus"; index: number }
  | { type: "keyboard"; open: boolean }
  | { type: "details-open"; itemKey: string; origin: VodOrigin }
  | { type: "details-close" }
  | { type: "details-ready" }
  | { type: "detail-action-focus"; index: number }
  | { type: "detail-copy-focus" }
  | { type: "retry-focus" }
  | { type: "drawer"; open: boolean }
  | { type: "retry-exit" }
  | { type: "episodes-toggle" }
  | { type: "episodes-reconcile" }
  | { type: "episode-summary-focus" }
  | { type: "season-preview"; season: XtreamSeasonKey }
  | { type: "season-commit"; season: XtreamSeasonKey }
  | { type: "episode-focus"; episodeKey: string }
  | { type: "restore"; origin: VodOrigin };

export interface VodNavigationOptions extends VodNavigationContext {
  active?: boolean;
  inputScope?: string;
  mode: "movie" | "series";
  onCategorySettled: (categoryKey: string) => void;
  onQuerySettled: (query: string) => void;
  onPosterSettled: () => void;
  onActivate: (state: VodNavigationState) => void;
  onRetry: (state: VodNavigationState) => void;
  onRequestExit: () => void;
  onAppNavigationFocus?: () => void;
  onSummaryScroll?: (delta: -1 | 1) => void;
  onInfoScroll?: (delta: -1 | 1) => boolean;
  onDetailsTransition?: (commit: () => void, returning: boolean) => void;
}

export interface VodNavigation {
  state: VodNavigationState;
  posterFetchReady: boolean;
  handleKey: (code: number, event: KeyboardEvent) => void;
  handleWheel: (deltaY: number, now?: number) => boolean;
  focusCategory: (index: number) => void;
  selectCategory: (index: number, enterContent?: boolean) => void;
  rememberCategoryWindow: (
    first: number,
    scrollOffset?: number,
    visibleRows?: number,
    rowHeight?: number,
  ) => void;
  selectItem: (index: number) => void;
  reconcileItems: (preferredKey: string) => void;
  resetItems: () => void;
  focusCatalogueAction: (index: number) => void;
  rememberWindow: (firstRow: number, search?: boolean, visibleRows?: number) => void;
  setQuery: (value: string) => void;
  submitQuery: () => void;
  focusSearchControl: (control: "search-field" | "search-submit") => void;
  focusSearchCategory: (index: number) => void;
  retry: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  openDetails: (itemKey: string) => void;
  focusFirstDetailAction: () => void;
  focusDetailAction: (index: number) => void;
  focusDetailCopy: () => void;
  focusRetry: () => void;
  setDrawerOpen: (open: boolean) => void;
  toggleEpisodes: () => void;
  reconcileEpisodes: () => void;
  focusSummary: () => void;
  focusSeason: (season: XtreamSeasonKey) => void;
  commitSeason: (season: XtreamSeasonKey) => void;
  selectEpisode: (episodeKey: string) => void;
  restoreOrigin: (origin: VodOrigin) => void;
}

const memory = (): VodModeMemory => ({
  categoryKey: "",
  railIndex: 0,
  itemKey: "",
  itemIndex: 0,
  firstRow: 0,
  categoryFirst: 0,
  posterWindowRevision: 0,
  itemByCategory: {},
  indexByCategory: {},
  firstRowByCategory: {},
  contentZoneByCategory: {},
  seasonBySeries: {},
  episodeBySeason: {},
});

export const initialVodNavigation = (mode: "movie" | "series"): VodNavigationState => ({
  mode,
  zone: "rail",
  headerControl: mode,
  headerReturnZone: "rail",
  selectedCategoryKey: "",
  displayedCategoryKey: "",
  selectedItemKey: "",
  selectedItemIndex: 0,
  catalogueActionIndex: 0,
  search: null,
  details: null,
  episodes: null,
  memories: { movie: memory(), series: memory() },
});

const clampedIndex = (keys: readonly string[], index: number) =>
  Math.max(0, Math.min(index, Math.max(0, keys.length - 1)));

const selectedCategoryIndex = (state: VodNavigationState, keys: readonly string[]) => {
  const index = state.memories[state.mode].railIndex;
  return keys[index] === state.selectedCategoryKey
    ? index
    : keys.indexOf(state.selectedCategoryKey);
};

const categoryNavigationIndex = (state: VodNavigationState, keys: readonly string[]) => {
  const index = selectedCategoryIndex(state, keys);
  return index >= 0 ? index : clampedIndex(keys, state.memories[state.mode].railIndex);
};

const categoryItems = (context: VodNavigationContext, categoryKey: string): readonly string[] =>
  context.itemKeysByCategory?.[categoryKey] ?? context.itemKeys;

const seasonEpisodes = (
  context: VodNavigationContext,
  season: XtreamSeasonKey,
): readonly string[] => context.episodeKeysBySeason?.[String(season)] ?? context.episodeKeys;

const withItem = (
  state: VodNavigationState,
  keys: readonly string[],
  index: number,
  context: VodNavigationContext,
) => {
  const selectedItemIndex = clampedIndex(keys, index);
  const selectedItemKey = keys[selectedItemIndex] ?? "";
  const current = state.memories[state.mode];
  const categoryKey = state.displayedCategoryKey;
  const columns = context.posterColumns ?? POSTER_COLUMNS;
  const firstRow =
    context.posterVisibleRows === undefined
      ? current.firstRow
      : windowOf(
          Math.ceil(keys.length / columns),
          Math.floor(selectedItemIndex / columns),
          context.posterVisibleRows,
          1,
          current.firstRow,
          1,
          0,
        ).first;
  return {
    ...state,
    selectedItemIndex,
    selectedItemKey,
    memories: {
      ...state.memories,
      [state.mode]: {
        ...current,
        itemKey: selectedItemKey,
        itemIndex: selectedItemIndex,
        itemByCategory: { ...current.itemByCategory, [categoryKey]: selectedItemKey },
        indexByCategory: { ...current.indexByCategory, [categoryKey]: selectedItemIndex },
        ...(context.posterVisibleRows === undefined
          ? {}
          : {
              firstRow,
              firstRowByCategory: {
                ...current.firstRowByCategory,
                [categoryKey]: firstRow,
              },
            }),
      },
    },
  };
};

const withSearchItem = (
  state: VodNavigationState,
  keys: readonly string[],
  index: number,
  context: VodNavigationContext,
): VodNavigationState => {
  if (!state.search) return state;
  const itemIndex = clampedIndex(keys, index);
  const columns = context.posterColumns ?? POSTER_COLUMNS;
  return {
    ...state,
    selectedItemIndex: itemIndex,
    selectedItemKey: keys[itemIndex] ?? "",
    search: {
      ...state.search,
      itemIndex,
      itemKey: keys[itemIndex] ?? "",
      firstRow:
        context.searchVisibleRows === undefined
          ? state.search.firstRow
          : windowOf(
              Math.ceil(keys.length / columns),
              Math.floor(itemIndex / columns),
              context.searchVisibleRows,
              1,
              state.search.firstRow,
              1,
              0,
            ).first,
    },
  };
};

const originOf = (state: VodNavigationState): VodOrigin => ({
  mode: state.mode,
  surface: state.search ? "search" : "category",
  categoryKey: state.displayedCategoryKey,
  itemKey: state.search?.itemKey ?? state.selectedItemKey,
  itemIndex: state.search?.itemIndex ?? state.selectedItemIndex,
  firstRow: state.search?.firstRow ?? state.memories[state.mode].firstRow,
  ...(state.search ? { query: state.search.query, appliedQuery: state.search.applied } : {}),
});

const rememberCatalogueFocus = (state: VodNavigationState): VodNavigationState => {
  if (
    (state.zone !== "grid" && state.zone !== "catalogue-actions") ||
    !state.displayedCategoryKey
  )
    return state;
  const held = state.memories[state.mode];
  if (held.contentZoneByCategory?.[state.displayedCategoryKey] === state.zone) return state;
  return {
    ...state,
    memories: {
      ...state.memories,
      [state.mode]: {
        ...held,
        contentZoneByCategory: {
          ...held.contentZoneByCategory,
          [state.displayedCategoryKey]: state.zone,
        },
      },
    },
  };
};

export function reduceVodNavigation(
  previous: VodNavigationState,
  action: VodAction,
  context: VodNavigationContext,
): VodNavigationState {
  const state = rememberCatalogueFocus(previous);
  if (action.type === "mode") {
    const held = state.memories[action.mode];
    const categoryIndex = clampedIndex(context.categoryKeys, held.railIndex);
    const categoryKey = context.categoryKeys[categoryIndex] ?? "";
    const keys = categoryItems(context, categoryKey);
    const rememberedIndex = keys.indexOf(held.itemByCategory[categoryKey] ?? held.itemKey);
    const index = clampedIndex(
      keys,
      rememberedIndex >= 0
        ? rememberedIndex
        : (held.indexByCategory[categoryKey] ?? held.itemIndex),
    );
    return {
      ...state,
      mode: action.mode,
      zone: "rail",
      headerControl: action.mode,
      headerReturnZone: "rail",
      selectedCategoryKey: categoryKey,
      displayedCategoryKey: categoryKey,
      selectedItemIndex: index,
      selectedItemKey: keys[index] ?? "",
      search: null,
      details: null,
      episodes: null,
    };
  }
  if (action.type === "category-focus") {
    if (action.index < 0) return { ...state, zone: "rail-search" };
    const index = clampedIndex(context.categoryKeys, action.index);
    const key = context.categoryKeys[index] ?? "";
    const held = state.memories[state.mode];
    const { categoryVisibleRows, categoryRowHeight } = context;
    const headerIndex = context.categoryHeaderIndex ?? -1;
    const hasHeader = headerIndex >= 0 && headerIndex < context.categoryKeys.length;
    const rowIndex = index + (hasHeader && index >= headerIndex ? 1 : 0);
    const first =
      categoryVisibleRows === undefined || categoryRowHeight === undefined
        ? undefined
        : windowOf(
            context.categoryKeys.length + (hasHeader ? 1 : 0),
            rowIndex,
            categoryVisibleRows,
            1,
            held.categoryFirst,
            1,
            0,
          ).first;
    return {
      ...state,
      zone: "rail",
      selectedCategoryKey: key,
      memories: {
        ...state.memories,
        [state.mode]: {
          ...held,
          categoryKey: key,
          railIndex: index,
          ...(first === undefined || categoryRowHeight === undefined
            ? {}
            : { categoryFirst: first, categoryScrollOffset: first * categoryRowHeight }),
        },
      },
    };
  }
  if (action.type === "category-display") {
    const held = state.memories[state.mode];
    const keys = categoryItems(context, action.categoryKey);
    const changed = action.categoryKey !== state.displayedCategoryKey;
    const rememberedIndex = changed
      ? -1
      : keys.indexOf(held.itemByCategory[action.categoryKey] ?? "");
    const index = changed
      ? 0
      : clampedIndex(
          keys,
          rememberedIndex >= 0
            ? rememberedIndex
            : (held.indexByCategory[action.categoryKey] ?? 0),
        );
    const contentZone = changed
      ? "grid"
      : (held.contentZoneByCategory?.[action.categoryKey] ?? "grid");
    const next = withItem(
      {
        ...state,
        displayedCategoryKey: action.categoryKey,
        zone: action.enterContent ? contentZone : state.zone,
      },
      keys,
      index,
      context,
    );
    const firstRow = changed ? 0 : (held.firstRowByCategory[action.categoryKey] ?? 0);
    return {
      ...next,
      memories: {
        ...next.memories,
        [state.mode]: {
          ...next.memories[state.mode],
          firstRow,
          firstRowByCategory: {
            ...next.memories[state.mode].firstRowByCategory,
            [action.categoryKey]: firstRow,
          },
          contentZoneByCategory: {
            ...held.contentZoneByCategory,
            [action.categoryKey]: contentZone,
          },
        },
      },
    };
  }
  if (action.type === "category-window") {
    const held = state.memories[state.mode];
    const first = Math.max(0, action.first);
    const scrollOffset =
      action.scrollOffset === undefined ? undefined : Math.max(0, action.scrollOffset);
    if (held.categoryFirst === first && held.categoryScrollOffset === scrollOffset)
      return state;
    return {
      ...state,
      memories: {
        ...state.memories,
        [state.mode]: { ...held, categoryFirst: first, categoryScrollOffset: scrollOffset },
      },
    };
  }
  if (action.type === "item-focus") {
    return state.search
      ? withSearchItem(
          { ...state, zone: "search-grid" },
          context.searchItemKeys,
          action.index,
          context,
        )
      : withItem(
          state,
          categoryItems(context, state.displayedCategoryKey),
          action.index,
          context,
        );
  }
  if (action.type === "items-reset" && !state.search) {
    const next = withItem(
      state,
      categoryItems(context, state.displayedCategoryKey),
      0,
      context,
    );
    const memory = next.memories[state.mode];
    return {
      ...next,
      memories: {
        ...next.memories,
        [state.mode]: {
          ...memory,
          firstRow: 0,
          firstRowByCategory: {
            ...memory.firstRowByCategory,
            [state.displayedCategoryKey]: 0,
          },
          posterWindowRevision: memory.posterWindowRevision + 1,
        },
      },
    };
  }
  if (action.type === "items-reconcile" && !state.search) {
    const keys = categoryItems(context, state.displayedCategoryKey);
    const preferred = keys.indexOf(action.preferredKey);
    const next = withItem(
      state,
      keys,
      preferred >= 0 ? preferred : state.selectedItemIndex,
      context,
    );
    const columns = context.posterColumns ?? POSTER_COLUMNS;
    const rowDelta =
      Math.floor(next.selectedItemIndex / columns) -
      Math.floor(state.selectedItemIndex / columns);
    const memory = next.memories[state.mode];
    const firstRow = Math.max(0, state.memories[state.mode].firstRow + rowDelta);
    return {
      ...next,
      memories: {
        ...next.memories,
        [state.mode]: {
          ...memory,
          firstRow,
          firstRowByCategory: {
            ...memory.firstRowByCategory,
            [state.displayedCategoryKey]: firstRow,
          },
        },
      },
    };
  }
  if (action.type === "catalogue-action-focus") {
    return { ...state, zone: "catalogue-actions", catalogueActionIndex: 0 };
  }
  if (action.type === "item-window") {
    const held = state.memories[state.mode];
    if (
      held.firstRow === action.firstRow &&
      held.firstRowByCategory[state.displayedCategoryKey] === action.firstRow
    ) {
      return state;
    }
    return {
      ...state,
      memories: {
        ...state.memories,
        [state.mode]: {
          ...held,
          firstRow: action.firstRow,
          firstRowByCategory: {
            ...held.firstRowByCategory,
            [state.displayedCategoryKey]: action.firstRow,
          },
        },
      },
    };
  }
  if (action.type === "search-window" && state.search) {
    return state.search.firstRow === action.firstRow
      ? state
      : { ...state, search: { ...state.search, firstRow: action.firstRow } };
  }
  if (action.type === "search-open") {
    return {
      ...state,
      zone: "search-field",
      headerControl: "search",
      search: {
        query: "",
        applied: "",
        keyboardOpen: true,
        itemKey: "",
        itemIndex: 0,
        firstRow: 0,
        origin: originOf(state),
      },
      details: null,
      episodes: null,
    };
  }
  if (action.type === "search-close") {
    return action.type === "search-close" && state.search
      ? reduceVodNavigation(state, { type: "restore", origin: state.search.origin }, context)
      : state;
  }
  if (action.type === "query" && state.search) {
    return { ...state, search: { ...state.search, query: action.value } };
  }
  if (action.type === "query-apply" && state.search) {
    return {
      ...state,
      search: {
        ...state.search,
        applied: action.value,
        itemKey: "",
        itemIndex: 0,
        categoryIndex: 0,
        firstRow: 0,
      },
    };
  }
  if (action.type === "search-control-focus" && state.search) {
    const keyboardOpen = action.control === "search-field";
    if (
      state.zone === action.control &&
      state.search.control === action.control &&
      state.search.keyboardOpen === keyboardOpen
    )
      return state;
    return {
      ...state,
      zone: action.control,
      search: { ...state.search, control: action.control, keyboardOpen },
    };
  }
  if (action.type === "search-category-focus" && state.search) {
    return {
      ...state,
      zone: "search-categories",
      search: {
        ...state.search,
        keyboardOpen: false,
        categoryIndex: clampedIndex(context.searchCategoryKeys ?? [], action.index),
      },
    };
  }
  if (action.type === "keyboard" && state.search) {
    return { ...state, search: { ...state.search, keyboardOpen: action.open } };
  }
  if (action.type === "details-open") {
    return {
      ...state,
      zone: "detail-actions",
      details: {
        itemKey: action.itemKey,
        origin: action.origin,
        actionIndex: 0,
        drawerOpen: false,
      },
      episodes: null,
    };
  }
  if (action.type === "details-ready" && state.details && context.detailActionCount) {
    return {
      ...state,
      zone: "detail-actions",
      details: { ...state.details, actionIndex: 0 },
    };
  }
  if (action.type === "detail-action-focus" && state.details && context.detailActionCount) {
    return {
      ...state,
      zone: "detail-actions",
      details: {
        ...state.details,
        actionIndex: Math.max(0, Math.min(context.detailActionCount - 1, action.index)),
      },
    };
  }
  if (action.type === "detail-copy-focus" && state.details && context.detailInfoOverflow)
    return { ...state, zone: "detail-copy" };
  if (action.type === "retry-focus") return { ...state, zone: "retry" };
  if (action.type === "drawer" && state.details) {
    return {
      ...state,
      zone: action.open ? "detail-actions" : state.zone,
      details: { ...state.details, drawerOpen: action.open },
    };
  }
  if (action.type === "details-close" && state.details) {
    return reduceVodNavigation(
      state,
      { type: "restore", origin: state.details.origin },
      context,
    );
  }
  if (action.type === "retry-exit") {
    return {
      ...state,
      zone: state.search ? "search-submit" : "rail",
      ...(state.search
        ? { search: { ...state.search, control: "search-submit", keyboardOpen: false } }
        : {}),
    };
  }
  if (action.type === "episodes-toggle" && state.details) {
    const held = state.memories[state.mode];
    if (state.episodes?.open) {
      return {
        ...state,
        zone: "detail-actions",
        episodes: { ...state.episodes, open: false },
      };
    }
    const seriesKey = state.details.itemKey;
    const selectedSeason = context.seasons.includes(context.initialSeason ?? "unassigned")
      ? (context.initialSeason ?? "unassigned")
      : context.seasons.includes(held.seasonBySeries[seriesKey] ?? "unassigned")
        ? (held.seasonBySeries[seriesKey] ?? "unassigned")
        : (context.seasons[0] ?? "unassigned");
    const keys = seasonEpisodes(context, selectedSeason);
    const remembered = held.episodeBySeason[`${seriesKey}:${selectedSeason}`];
    const episodeKey =
      context.initialEpisodeKey && keys.includes(context.initialEpisodeKey)
        ? context.initialEpisodeKey
        : remembered && keys.includes(remembered)
          ? remembered
          : (keys[0] ?? "");
    return {
      ...state,
      zone: keys.length ? "episode-list" : "season-row",
      episodes: {
        open: true,
        seasonCursor: selectedSeason,
        selectedSeason,
        episodeKey,
        heroActionIndex: state.episodes?.heroActionIndex ?? state.details.actionIndex,
      },
    };
  }
  if (action.type === "episodes-reconcile" && state.episodes && state.details) {
    const held = state.memories[state.mode];
    const seriesKey = state.details.itemKey;
    const selectedSeason = context.seasons.includes(state.episodes.selectedSeason)
      ? state.episodes.selectedSeason
      : context.seasons.includes(context.initialSeason ?? "unassigned")
        ? (context.initialSeason ?? "unassigned")
        : (context.seasons[0] ?? "unassigned");
    const keys = seasonEpisodes(context, selectedSeason);
    const memoryKey = `${seriesKey}:${selectedSeason}`;
    const remembered = held.episodeBySeason[memoryKey];
    const episodeKey = keys.includes(state.episodes.episodeKey)
      ? state.episodes.episodeKey
      : keys.includes(context.initialEpisodeKey ?? "")
        ? (context.initialEpisodeKey ?? "")
        : remembered && keys.includes(remembered)
          ? remembered
          : (keys[0] ?? "");
    return {
      ...state,
      zone:
        state.zone === "season-row" || state.zone === "episode-list"
          ? keys.length
            ? state.zone
            : "season-row"
          : state.zone,
      episodes: {
        ...state.episodes,
        selectedSeason,
        seasonCursor: context.seasons.includes(state.episodes.seasonCursor)
          ? state.episodes.seasonCursor
          : selectedSeason,
        episodeKey,
      },
      memories: {
        ...state.memories,
        [state.mode]: {
          ...held,
          seasonBySeries: { ...held.seasonBySeries, [seriesKey]: selectedSeason },
          episodeBySeason: episodeKey
            ? { ...held.episodeBySeason, [memoryKey]: episodeKey }
            : held.episodeBySeason,
        },
      },
    };
  }
  if (action.type === "episode-summary-focus" && state.episodes) {
    return { ...state, zone: "episode-summary" };
  }
  if (action.type === "season-preview" && state.episodes) {
    return {
      ...state,
      zone: "season-row",
      episodes: { ...state.episodes, seasonCursor: action.season },
    };
  }
  if (action.type === "season-commit" && state.episodes && state.details) {
    const held = state.memories[state.mode];
    const seriesKey = state.details.itemKey;
    const memoryKey = `${seriesKey}:${action.season}`;
    const keys = seasonEpisodes(context, action.season);
    const episodeKey = keys[0] ?? "";
    return {
      ...state,
      zone: keys.length ? "episode-list" : "season-row",
      episodes: {
        ...state.episodes,
        seasonCursor: action.season,
        selectedSeason: action.season,
        episodeKey,
      },
      memories: {
        ...state.memories,
        [state.mode]: {
          ...held,
          seasonBySeries: { ...held.seasonBySeries, [seriesKey]: action.season },
          episodeBySeason: episodeKey
            ? { ...held.episodeBySeason, [memoryKey]: episodeKey }
            : held.episodeBySeason,
        },
      },
    };
  }
  if (action.type === "episode-focus" && state.episodes && state.details) {
    const held = state.memories[state.mode];
    const memoryKey = `${state.details.itemKey}:${state.episodes.selectedSeason}`;
    return {
      ...state,
      zone: "episode-list",
      episodes: { ...state.episodes, episodeKey: action.episodeKey },
      memories: {
        ...state.memories,
        [state.mode]: {
          ...held,
          episodeBySeason: {
            ...held.episodeBySeason,
            [memoryKey]: action.episodeKey,
          },
        },
      },
    };
  }
  if (action.type === "restore") {
    const search = action.origin.surface === "search";
    const keys = search
      ? context.searchItemKeys
      : categoryItems(context, action.origin.categoryKey);
    const index = clampedIndex(keys, action.origin.itemIndex);
    const held = state.memories[action.origin.mode];
    return {
      ...state,
      mode: action.origin.mode,
      zone: search ? "search-grid" : "grid",
      selectedCategoryKey: action.origin.categoryKey,
      displayedCategoryKey: action.origin.categoryKey,
      selectedItemIndex: index,
      selectedItemKey: keys[index] ?? "",
      search: search
        ? {
            query: action.origin.query ?? "",
            applied: action.origin.appliedQuery ?? action.origin.query ?? "",
            keyboardOpen: false,
            itemKey: keys[index] ?? "",
            itemIndex: index,
            firstRow: action.origin.firstRow,
            // Details restore the search cursor without replacing its category return location.
            origin:
              state.search?.origin.surface === "category" &&
              state.search.origin.mode === action.origin.mode
                ? state.search.origin
                : {
                    mode: action.origin.mode,
                    surface: "category",
                    categoryKey: action.origin.categoryKey,
                    itemKey: held.itemByCategory[action.origin.categoryKey] ?? held.itemKey,
                    itemIndex:
                      held.indexByCategory[action.origin.categoryKey] ?? held.itemIndex,
                    firstRow:
                      held.firstRowByCategory[action.origin.categoryKey] ?? held.firstRow,
                  },
          }
        : null,
      details: null,
      episodes: null,
      memories: search
        ? state.memories
        : {
            ...state.memories,
            [action.origin.mode]: {
              ...held,
              firstRow: action.origin.firstRow,
              firstRowByCategory: {
                ...held.firstRowByCategory,
                [action.origin.categoryKey]: action.origin.firstRow,
              },
            },
          },
    };
  }
  if (action.type !== "key") return state;

  const inlineStart = context.direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = context.direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const code = action.code;
  const amount = Math.max(1, Math.min(MAX_LIST_STEP, action.amount ?? 1));

  if (code === KEY.BACK || code === KEY.ESC) {
    if (state.episodes?.open) {
      return reduceVodNavigation(state, { type: "episodes-toggle" }, context);
    }
    if (state.details?.drawerOpen) {
      return reduceVodNavigation(state, { type: "drawer", open: false }, context);
    }
    if (state.details) return reduceVodNavigation(state, { type: "details-close" }, context);
    if (state.zone === "retry") {
      return { ...state, zone: state.search ? "search-field" : "rail" };
    }
    if (state.zone === "catalogue-actions") return { ...state, zone: "rail" };
    if (state.search?.keyboardOpen) {
      return reduceVodNavigation(state, { type: "keyboard", open: false }, context);
    }
    if (state.search) return reduceVodNavigation(state, { type: "search-close" }, context);
    return state;
  }
  if (state.details?.drawerOpen) return state;
  if (state.zone === "header") {
    const index = context.headerKeys.indexOf(state.headerControl);
    if (code === inlineStart && index > 0) {
      return { ...state, headerControl: context.headerKeys[index - 1] };
    }
    if (code === inlineEnd && index + 1 < context.headerKeys.length) {
      return { ...state, headerControl: context.headerKeys[index + 1] };
    }
    if (code === KEY.DOWN) {
      const requested = state.headerReturnZone;
      const zone =
        requested === "detail-actions" && !state.details
          ? "rail"
          : requested === "search-field" && !state.search
            ? "rail"
            : requested;
      return {
        ...state,
        zone,
        ...(zone === "search-field" && state.search
          ? { search: { ...state.search, keyboardOpen: true } }
          : {}),
      };
    }
    return state;
  }
  if (state.zone === "retry") {
    if (state.search) {
      if (code === KEY.UP) {
        return reduceVodNavigation(
          state,
          { type: "search-control-focus", control: state.search.control ?? "search-field" },
          context,
        );
      }
      return state;
    }
    if (code === inlineStart) {
      if (state.details) return state;
      return { ...state, zone: state.search ? "search-field" : "rail" };
    }
    return state;
  }
  if (state.zone === "rail-search") {
    if (code === KEY.ENTER) {
      return reduceVodNavigation(state, { type: "search-open" }, context);
    }
    if (code === inlineEnd) {
      return { ...state, zone: context.regionState === "failed" ? "retry" : "grid" };
    }
    if (code === KEY.DOWN || code === KEY.UP) {
      return reduceVodNavigation(
        state,
        {
          type: "category-focus",
          index: code === KEY.DOWN ? 0 : context.categoryKeys.length - 1,
        },
        context,
      );
    }
    return state;
  }
  if (state.zone === "search-categories" && state.search) {
    if (code === KEY.UP && !(state.search.categoryIndex ?? 0)) {
      if (action.repeat) return state;
      return reduceVodNavigation(
        state,
        {
          type: "search-control-focus",
          control: "search-field",
        },
        context,
      );
    }
    if (code === KEY.UP || code === KEY.DOWN) {
      return reduceVodNavigation(
        state,
        {
          type: "search-category-focus",
          index: (state.search.categoryIndex ?? 0) + (code === KEY.DOWN ? amount : -amount),
        },
        context,
      );
    }
    if (code === inlineEnd) {
      if (!context.searchItemKeys.length) {
        return reduceVodNavigation(
          state,
          {
            type: "search-control-focus",
            control: "search-field",
          },
          context,
        );
      }
      return withSearchItem(
        { ...state, zone: "search-grid" },
        context.searchItemKeys,
        state.search.itemIndex,
        context,
      );
    }
    return state;
  }
  if (state.zone === "rail") {
    if (code === KEY.UP || code === KEY.DOWN) {
      if (!context.categoryKeys.length) return { ...state, zone: "rail-search" };
      const index = categoryNavigationIndex(state, context.categoryKeys);
      const delta = code === KEY.UP ? -amount : amount;
      const next = action.repeat
        ? Math.max(0, Math.min(context.categoryKeys.length - 1, index + delta))
        : ((index + 1 + delta + context.categoryKeys.length + 1) %
            (context.categoryKeys.length + 1)) -
          1;
      return reduceVodNavigation(state, { type: "category-focus", index: next }, context);
    }
    if (
      code === KEY.ENTER &&
      context.regionState === "loaded" &&
      state.selectedCategoryKey === state.displayedCategoryKey
    ) {
      return {
        ...state,
        zone:
          state.memories[state.mode].contentZoneByCategory?.[state.displayedCategoryKey] ??
          "grid",
      };
    }
    if (code === inlineEnd) {
      if (context.regionState === "failed") return { ...state, zone: "retry" };
      if (
        context.regionState === "loaded" &&
        state.selectedCategoryKey === state.displayedCategoryKey &&
        categoryItems(context, state.displayedCategoryKey).length
      ) {
        return { ...state, zone: "grid" };
      }
    }
    return state;
  }
  if (state.zone === "catalogue-actions") {
    if (code === inlineStart) return { ...state, zone: "rail" };
    if ((code === inlineEnd || code === KEY.DOWN) && context.regionState === "loaded") {
      return { ...state, zone: "grid" };
    }
    return state;
  }
  if (state.zone === "grid" || state.zone === "search-grid") {
    const search = state.zone === "search-grid";
    const keys = search
      ? context.searchItemKeys
      : categoryItems(context, state.displayedCategoryKey);
    const index = clampedIndex(
      keys,
      search ? (state.search?.itemIndex ?? 0) : state.selectedItemIndex,
    );
    const move = (next: number) =>
      search
        ? withSearchItem(state, keys, next, context)
        : withItem(state, keys, next, context);
    const columns = context.posterColumns ?? POSTER_COLUMNS;
    const returnToSearch = () => {
      const zone: "search-submit" | "search-field" = state.search?.query.trim()
        ? "search-submit"
        : "search-field";
      return {
        ...state,
        zone,
        search: state.search
          ? { ...state.search, keyboardOpen: zone === "search-field" }
          : null,
      };
    };
    if (code === inlineStart) {
      if (index % columns === 0) {
        if (search && context.searchCategoryKeys?.length) {
          return reduceVodNavigation(
            state,
            {
              type: "search-category-focus",
              index: state.search?.categoryIndex ?? 0,
            },
            context,
          );
        }
        return search ? returnToSearch() : { ...state, zone: "rail" };
      }
      return move(index - 1);
    }
    if (code === inlineEnd) {
      if (index + 1 >= keys.length || index % columns === columns - 1) return state;
      return move(index + 1);
    }
    if (code === KEY.UP) {
      if (index < columns) {
        if (action.repeat) return state;
        return search
          ? returnToSearch()
          : { ...state, zone: "catalogue-actions", catalogueActionIndex: 0 };
      }
      return move(Math.max(index % columns, index - columns * amount));
    }
    if (code === KEY.DOWN) {
      const row = Math.floor(index / columns);
      const lastRow = Math.floor((keys.length - 1) / columns);
      if (row >= lastRow) return state;
      const targetRow = Math.min(lastRow, row + amount);
      return move(Math.min(keys.length - 1, targetRow * columns + (index % columns)));
    }
    return state;
  }
  if (state.zone === "search-field" || state.zone === "search-submit") {
    if (code === KEY.DOWN && !state.search?.applied.trim()) return state;
    if (code === inlineEnd && state.zone === "search-field" && state.search?.query.trim()) {
      return {
        ...state,
        zone: "search-submit",
        search: { ...state.search, keyboardOpen: false },
      };
    }
    if (code === inlineStart && state.zone === "search-submit" && state.search) {
      return {
        ...state,
        zone: "search-field",
        search: { ...state.search, keyboardOpen: true },
      };
    }
    if (
      code === KEY.DOWN &&
      context.searchRegionState === "failed" &&
      state.search?.applied.trim()
    ) {
      return {
        ...state,
        zone: "retry",
        search: { ...state.search, control: state.zone, keyboardOpen: false },
      };
    }
    if (code === KEY.DOWN && context.searchItemKeys.length && state.search) {
      return withSearchItem(
        {
          ...state,
          zone: "search-grid",
          search: { ...state.search, keyboardOpen: false },
        },
        context.searchItemKeys,
        state.search.itemIndex,
        context,
      );
    }
    if (code === KEY.DOWN && context.searchCategoryKeys?.length && state.search) {
      return reduceVodNavigation(
        state,
        {
          type: "search-category-focus",
          index: state.search.categoryIndex ?? 0,
        },
        context,
      );
    }
    return state;
  }
  if (state.zone === "detail-copy" && state.details) {
    if (code === KEY.DOWN || code === KEY.ENTER) {
      return {
        ...state,
        zone: "detail-actions",
        details: { ...state.details, actionIndex: 0 },
      };
    }
    return state;
  }
  if (state.zone === "detail-actions" && state.details) {
    if (!context.detailActionCount) return state;
    if (code === KEY.UP && state.details.actionIndex === 0 && context.detailInfoOverflow)
      return { ...state, zone: "detail-copy" };
    const direction =
      code === KEY.UP
        ? "up"
        : code === KEY.DOWN
          ? "down"
          : code === inlineStart
            ? "start"
            : code === inlineEnd
              ? "end"
              : undefined;
    const next = direction
      ? stepDetailAction(state.details.actionIndex, context.detailActionCount, direction)
      : state.details.actionIndex;
    if (next !== state.details.actionIndex)
      return {
        ...state,
        details: { ...state.details, actionIndex: next },
      };
    if (code === inlineEnd && state.episodes?.open) return { ...state, zone: "episode-list" };
    return state;
  }
  if (state.zone === "season-row" && state.episodes) {
    const index = context.seasons.indexOf(state.episodes.seasonCursor);
    const selectSeason = (season: XtreamSeasonKey) => ({
      ...reduceVodNavigation(state, { type: "season-commit", season }, context),
      zone: "season-row" as const,
    });
    if (code === inlineStart && index === 0)
      return reduceVodNavigation(state, { type: "episodes-toggle" }, context);
    if (code === inlineStart && index > 0) return selectSeason(context.seasons[index - 1]);
    if (code === inlineEnd && index + 1 < context.seasons.length)
      return selectSeason(context.seasons[index + 1]);
    if (code === KEY.UP) return state;
    if (code === KEY.ENTER || code === KEY.DOWN) {
      return reduceVodNavigation(
        state,
        { type: "season-commit", season: state.episodes.seasonCursor },
        context,
      );
    }
    return state;
  }
  if (state.zone === "episode-list" && state.episodes) {
    const seasonIndex = context.seasons.indexOf(state.episodes.selectedSeason);
    const index = clampedIndex(
      context.episodeKeys,
      context.episodeKeys.indexOf(state.episodes.episodeKey),
    );
    if (code === inlineStart && seasonIndex <= 0)
      return reduceVodNavigation(state, { type: "episodes-toggle" }, context);
    if (code === inlineStart)
      return reduceVodNavigation(
        state,
        { type: "season-commit", season: context.seasons[seasonIndex - 1] },
        context,
      );
    if (code === inlineEnd && seasonIndex + 1 < context.seasons.length)
      return reduceVodNavigation(
        state,
        { type: "season-commit", season: context.seasons[seasonIndex + 1] },
        context,
      );
    if (code === inlineEnd) return state;
    if (code === KEY.UP && index === 0) {
      if (action.repeat) return state;
      const hasVisibleSeason =
        context.seasons.length > 1 || context.seasons[0] !== "unassigned";
      return hasVisibleSeason ? { ...state, zone: "season-row" } : state;
    }
    if (code === KEY.UP || code === KEY.DOWN) {
      const next = clampedIndex(
        context.episodeKeys,
        index + (code === KEY.DOWN ? amount : -amount),
      );
      const episodeKey = context.episodeKeys[next] ?? "";
      if (!state.details) return { ...state, episodes: { ...state.episodes, episodeKey } };
      const held = state.memories[state.mode];
      const memoryKey = `${state.details.itemKey}:${state.episodes.selectedSeason}`;
      return {
        ...state,
        episodes: { ...state.episodes, episodeKey },
        memories: {
          ...state.memories,
          [state.mode]: {
            ...held,
            episodeBySeason: { ...held.episodeBySeason, [memoryKey]: episodeKey },
          },
        },
      };
    }
    return state;
  }
  if (state.zone === "episode-summary" && state.episodes) {
    if (code === inlineStart) return { ...state, zone: "episode-list" };
    return state;
  }
  return state;
}

export function useVodNavigation(options: VodNavigationOptions): VodNavigation {
  const listStep = useListAcceleration(options.active !== false);
  const [state, setState] = useState(() => initialVodNavigation(options.mode));
  const [posterFetchReady, setPosterFetchReady] = useState(false);
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const categoryTimer = useRef(0);
  const posterTimer = useRef(0);
  const wheelAt = useRef(Number.NEGATIVE_INFINITY);
  const wheelZone = useRef<VodZone | null>(null);
  const categoryWindow = useRef<
    { visibleRows: number; rowHeight: number; followsCursor: boolean } | undefined
  >(undefined);
  const posterVisibleRows = useRef<number | undefined>(undefined);
  const searchVisibleRows = useRef<number | undefined>(undefined);
  stateRef.current = state;
  optionsRef.current = options;

  const context = useCallback((): VodNavigationContext => {
    const options = optionsRef.current;
    const current = stateRef.current;
    const followCursor = !pointerInputActive();
    const measuredCategory =
      followCursor && categoryWindow.current?.followsCursor
        ? categoryWindow.current
        : undefined;
    return {
      ...options,
      categoryVisibleRows: measuredCategory?.visibleRows,
      categoryRowHeight: measuredCategory?.rowHeight,
      posterVisibleRows: followCursor
        ? (posterVisibleRows.current ?? options.posterVisibleRows)
        : undefined,
      searchVisibleRows: followCursor
        ? (searchVisibleRows.current ?? options.searchVisibleRows)
        : undefined,
      itemKeys: categoryItems(options, current.displayedCategoryKey),
      searchItemKeys: options.searchKeysForQuery
        ? options.searchKeysForQuery(current.search?.applied ?? "")
        : options.searchItemKeys,
      searchCategoryKeys: options.searchCategoryKeysForQuery
        ? options.searchCategoryKeysForQuery(current.search?.applied ?? "")
        : options.searchCategoryKeys,
      episodeKeys: seasonEpisodes(
        options,
        current.episodes?.selectedSeason ??
          options.initialSeason ??
          options.seasons[0] ??
          "unassigned",
      ),
    };
  }, []);
  const renderedState =
    state.mode === options.mode
      ? state
      : reduceVodNavigation(state, { type: "mode", mode: options.mode }, context());
  stateRef.current = renderedState;

  const dispatch = useCallback(
    (action: VodAction) => {
      const before = stateRef.current;
      const next = reduceVodNavigation(before, action, context());
      if (next === before) return before;
      if (
        Boolean(before.details) !== Boolean(next.details) &&
        optionsRef.current.onDetailsTransition
      ) {
        optionsRef.current.onDetailsTransition(() => {
          const committed = reduceVodNavigation(stateRef.current, action, context());
          stateRef.current = committed;
          setState(committed);
        }, Boolean(before.details) && !next.details);
        return stateRef.current;
      }
      stateRef.current = next;
      setState(next);
      return next;
    },
    [context],
  );

  useEffect(() => {
    if (
      options.active === false ||
      !options.detailRetryAvailable ||
      !state.details ||
      state.zone === "retry" ||
      state.details.drawerOpen ||
      state.episodes?.open
    ) {
      return;
    }
    dispatch({ type: "retry-focus" });
  }, [
    dispatch,
    options.active,
    options.detailRetryAvailable,
    state.details,
    state.episodes?.open,
    state.zone,
  ]);

  const settlePosters = useCallback((mode = optionsRef.current.mode) => {
    setPosterFetchReady(false);
    window.clearTimeout(posterTimer.current);
    posterTimer.current = window.setTimeout(() => {
      if (optionsRef.current.mode !== mode) return;
      setPosterFetchReady(true);
      optionsRef.current.onPosterSettled();
    }, 120);
  }, []);

  const focusCategory = useCallback(
    (index: number) => {
      dispatch({ type: "category-focus", index });
    },
    [dispatch],
  );

  const selectCategory = useCallback(
    (index: number, enterContent = true) => {
      const next = dispatch({ type: "category-focus", index });
      window.clearTimeout(categoryTimer.current);
      if (
        next.selectedCategoryKey === next.displayedCategoryKey &&
        optionsRef.current.regionState === "loaded"
      ) {
        if (enterContent) dispatch({ type: "key", code: KEY.ENTER });
        settlePosters();
        return;
      }
      window.clearTimeout(posterTimer.current);
      setPosterFetchReady(false);
      categoryTimer.current = window.setTimeout(() => {
        dispatch({
          type: "category-display",
          categoryKey: next.selectedCategoryKey,
          enterContent:
            enterContent &&
            stateRef.current.zone === "rail" &&
            stateRef.current.selectedCategoryKey === next.selectedCategoryKey,
        });
        optionsRef.current.onCategorySettled(next.selectedCategoryKey);
        settlePosters();
      }, 150);
    },
    [dispatch, settlePosters],
  );

  const selectItem = useCallback(
    (index: number) => {
      dispatch({ type: "item-focus", index });
    },
    [dispatch],
  );
  const focusSearchCategory = useCallback(
    (index: number) => {
      dispatch({ type: "search-category-focus", index });
    },
    [dispatch],
  );

  const setQuery = useCallback(
    (value: string) => dispatch({ type: "query", value }),
    [dispatch],
  );

  const submitQuery = useCallback(() => {
    const search = stateRef.current.search;
    if (!search?.query.trim()) return;
    if (optionsRef.current.searchRegionState === "loading" && search.applied === search.query)
      return;
    dispatch({ type: "query-apply", value: search.query });
    dispatch({ type: "search-control-focus", control: "search-submit" });
    optionsRef.current.onQuerySettled(search.query);
    settlePosters();
  }, [dispatch, settlePosters]);

  const retry = useCallback(() => {
    optionsRef.current.onRetry(stateRef.current);
    dispatch({ type: "retry-exit" });
  }, [dispatch]);

  const handleKey = useCallback(
    (code: number, event: KeyboardEvent) => {
      const before = stateRef.current;
      const typing =
        before.zone === "search-field" && document.activeElement instanceof HTMLInputElement;
      const inlineStart = optionsRef.current.direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
      const inlineEnd = optionsRef.current.direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
      const scrolling =
        before.zone === "rail" ||
        before.zone === "grid" ||
        before.zone === "search-grid" ||
        before.zone === "search-categories" ||
        before.zone === "episode-list";
      const amount =
        (code === KEY.UP || code === KEY.DOWN) && scrolling
          ? listStep(
              code,
              event.repeat,
              `${optionsRef.current.inputScope ?? ""}:${before.mode}:${before.zone}:${
                before.search?.applied ??
                (before.zone === "rail" ? "" : before.displayedCategoryKey)
              }:${before.episodes?.selectedSeason ?? ""}:${before.details?.itemKey ?? ""}`,
            )
          : 1;
      if (!amount || (before.zone === "rail-search" && code === KEY.UP && event.repeat)) {
        event.preventDefault();
        return;
      }
      if (before.zone === "search-field" && code === KEY.ENTER && !typing) {
        dispatch({ type: "keyboard", open: true });
        event.preventDefault();
        return;
      }
      if (
        code === inlineStart &&
        before.search &&
        !before.details &&
        context().searchCategoryKeys?.length &&
        (before.zone === "search-field" || before.zone === "retry")
      ) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        dispatch({ type: "search-category-focus", index: before.search.categoryIndex ?? 0 });
        event.preventDefault();
        return;
      }
      if (
        code === inlineStart &&
        (before.zone === "rail" ||
          before.zone === "rail-search" ||
          before.zone === "search-categories" ||
          (before.zone === "retry" && before.search && !before.details))
      ) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        optionsRef.current.onAppNavigationFocus?.();
        event.preventDefault();
        return;
      }
      if (before.zone === "search-grid" && code === inlineStart) {
        const columns = optionsRef.current.posterColumns ?? POSTER_COLUMNS;
        const index = before.search?.itemIndex ?? before.selectedItemIndex;
        if (index % columns === 0 && !context().searchCategoryKeys?.length) {
          optionsRef.current.onAppNavigationFocus?.();
          event.preventDefault();
          return;
        }
      }
      if (before.zone === "search-field" && (code === KEY.UP || code === inlineStart)) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        optionsRef.current.onAppNavigationFocus?.();
        event.preventDefault();
        return;
      }
      if (
        typing &&
        code !== KEY.UP &&
        code !== KEY.DOWN &&
        code !== KEY.ENTER &&
        code !== KEY.BACK &&
        code !== KEY.ESC &&
        code !== inlineStart &&
        code !== inlineEnd
      )
        return;
      if (
        code === KEY.GREEN &&
        before.details &&
        !before.details.drawerOpen &&
        context().detailActionCount > 0
      ) {
        optionsRef.current.onActivate({
          ...before,
          zone: "detail-actions",
          details: { ...before.details, actionIndex: context().detailActionCount - 1 },
        });
        event.preventDefault();
        return;
      }
      if (code === KEY.BACK || code === KEY.ESC) {
        if (!before.details && !before.search) {
          optionsRef.current.onRequestExit();
          event.preventDefault();
          return;
        }
      }
      if (
        before.zone === "detail-copy" &&
        (code === KEY.UP || code === KEY.DOWN) &&
        optionsRef.current.onInfoScroll?.(code === KEY.DOWN ? 1 : -1)
      ) {
        event.preventDefault();
        return;
      }
      if (before.zone === "episode-summary" && (code === KEY.UP || code === KEY.DOWN)) {
        optionsRef.current.onSummaryScroll?.(code === KEY.DOWN ? 1 : -1);
        event.preventDefault();
        return;
      }
      if (
        (before.zone === "rail" || before.zone === "rail-search") &&
        (code === KEY.UP || code === KEY.DOWN)
      ) {
        const keys = context().categoryKeys;
        if (!keys.length) {
          if (before.zone !== "rail-search") dispatch({ type: "category-focus", index: -1 });
          event.preventDefault();
          return;
        }
        const index =
          before.zone === "rail-search" ? -1 : categoryNavigationIndex(before, keys);
        if (keys.length) {
          const delta = code === KEY.DOWN ? amount : -amount;
          const next = event.repeat
            ? Math.max(0, Math.min(keys.length - 1, index + delta))
            : ((index + 1 + delta + keys.length + 1) % (keys.length + 1)) - 1;
          if (next === index) {
            event.preventDefault();
            return;
          }
          if (next < 0) dispatch({ type: "category-focus", index: -1 });
          else selectCategory(next, false);
          event.preventDefault();
          return;
        }
      }
      if (before.zone === "rail" && code === KEY.ENTER) {
        const index = selectedCategoryIndex(before, context().categoryKeys);
        if (index >= 0) selectCategory(index);
        event.preventDefault();
        return;
      }
      if (before.zone === "search-submit" && code === KEY.ENTER) {
        if (!event.repeat && before.search?.query.trim()) submitQuery();
        event.preventDefault();
        return;
      }
      const next = dispatch({ type: "key", code, amount, repeat: event.repeat });
      if (code === KEY.ENTER) {
        if (before.zone === "retry") {
          retry();
        } else if (
          before.zone === "header" ||
          before.zone === "grid" ||
          before.zone === "search-grid" ||
          before.zone === "search-categories" ||
          (before.zone === "detail-actions" && context().detailActionCount > 0) ||
          before.zone === "episode-list"
        ) {
          optionsRef.current.onActivate(next);
        }
      }
      event.preventDefault();
    },
    [context, dispatch, listStep, retry, selectCategory, submitQuery],
  );

  const handleWheel = useCallback(
    (deltaY: number, now = performance.now()) => {
      const current = stateRef.current;
      if (
        current.zone !== "grid" &&
        current.zone !== "search-grid" &&
        current.zone !== "episode-list"
      ) {
        return false;
      }
      if (wheelZone.current !== current.zone) {
        wheelZone.current = current.zone;
        wheelAt.current = Number.NEGATIVE_INFINITY;
      }
      const currentContext = context();
      const keys =
        current.zone === "episode-list"
          ? currentContext.episodeKeys
          : current.zone === "search-grid"
            ? currentContext.searchItemKeys
            : categoryItems(currentContext, current.displayedCategoryKey);
      const cursor =
        current.zone === "episode-list"
          ? Math.max(0, keys.indexOf(current.episodes?.episodeKey ?? ""))
          : current.zone === "search-grid"
            ? (current.search?.itemIndex ?? 0)
            : current.selectedItemIndex;
      const step = wheelStep(cursor, keys.length, deltaY, now, wheelAt.current);
      if (!step.accepted) return false;
      wheelAt.current = step.lastAcceptedAt;
      if (current.zone === "episode-list" && current.episodes) {
        const next = reduceVodNavigation(
          current,
          { type: "key", code: deltaY > 0 ? KEY.DOWN : KEY.UP },
          currentContext,
        );
        stateRef.current = next;
        setState(next);
      } else {
        dispatch({ type: "item-focus", index: step.cursor });
      }
      return true;
    },
    [context, dispatch],
  );

  useEffect(() => {
    if (state.mode === options.mode) return;
    window.clearTimeout(categoryTimer.current);
    window.clearTimeout(posterTimer.current);
    setPosterFetchReady(false);
    setState(renderedState);
  }, [options.mode, renderedState, state.mode]);

  // Mount and each genuine mode change arm the poster settle once.
  useEffect(() => {
    settlePosters(options.mode);
  }, [options.mode, settlePosters]);

  useEffect(
    () => () => {
      window.clearTimeout(categoryTimer.current);
      window.clearTimeout(posterTimer.current);
    },
    [],
  );

  const rememberCategoryWindow = useCallback(
    (first: number, scrollOffset?: number, visibleRows?: number, rowHeight?: number) => {
      if (
        visibleRows !== undefined &&
        Number.isInteger(visibleRows) &&
        visibleRows > 0 &&
        rowHeight !== undefined &&
        Number.isFinite(rowHeight) &&
        rowHeight > 0
      ) {
        // A pointer window can leave the remote window at a different row. Let the rail
        // report that handoff before predicting later remote movement.
        categoryWindow.current = {
          visibleRows,
          rowHeight,
          followsCursor: !pointerInputActive(),
        };
      }
      dispatch({ type: "category-window", first, scrollOffset });
    },
    [dispatch],
  );
  const rememberWindow = useCallback(
    (firstRow: number, search = false, visibleRows?: number) => {
      if (visibleRows !== undefined && Number.isInteger(visibleRows) && visibleRows > 0) {
        const capacity = search ? searchVisibleRows : posterVisibleRows;
        capacity.current = visibleRows;
      }
      dispatch({ type: search ? "search-window" : "item-window", firstRow });
    },
    [dispatch],
  );

  return {
    state: renderedState,
    posterFetchReady: posterFetchReady && state.mode === options.mode,
    handleKey,
    handleWheel,
    focusCategory,
    selectCategory,
    rememberCategoryWindow,
    selectItem,
    reconcileItems: (preferredKey) => dispatch({ type: "items-reconcile", preferredKey }),
    resetItems: () => dispatch({ type: "items-reset" }),
    focusCatalogueAction: (index) => dispatch({ type: "catalogue-action-focus", index }),
    rememberWindow,
    setQuery,
    submitQuery,
    focusSearchControl: (control) => dispatch({ type: "search-control-focus", control }),
    focusSearchCategory,
    retry,
    openSearch: () => dispatch({ type: "search-open" }),
    closeSearch: () => dispatch({ type: "search-close" }),
    openDetails: (itemKey) =>
      dispatch({ type: "details-open", itemKey, origin: originOf(stateRef.current) }),
    focusFirstDetailAction: () => dispatch({ type: "details-ready" }),
    focusDetailAction: (index) => dispatch({ type: "detail-action-focus", index }),
    focusDetailCopy: () => dispatch({ type: "detail-copy-focus" }),
    focusRetry: () => dispatch({ type: "retry-focus" }),
    setDrawerOpen: (open) => dispatch({ type: "drawer", open }),
    toggleEpisodes: () => dispatch({ type: "episodes-toggle" }),
    reconcileEpisodes: () => dispatch({ type: "episodes-reconcile" }),
    focusSummary: () => dispatch({ type: "episode-summary-focus" }),
    focusSeason: (season) => dispatch({ type: "season-preview", season }),
    commitSeason: (season) => dispatch({ type: "season-commit", season }),
    selectEpisode: (episodeKey) => dispatch({ type: "episode-focus", episodeKey }),
    restoreOrigin: (origin) => dispatch({ type: "restore", origin }),
  };
}
