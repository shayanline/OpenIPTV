import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useContentTransition } from "../../hooks/useContentTransition";
import { useLayoutTask } from "../../hooks/useLayoutTask";
import { useLocale } from "../../hooks/useLocale";
import { KEY, useRemote } from "../../hooks/useRemote";
import { useSpatialNav } from "../../hooks/useSpatialNav";
import { useToast } from "../../hooks/useToast";
import type { LineupOrderMode, ManagedCategory, ManagedChannel } from "../../services/lineup";
import { CUSTOM_CATEGORIES_ENABLED } from "../../services/lineupCapabilities";
import {
  acquireManagementContext,
  type LineupManagementContext,
} from "../../services/lineupManagement";
import type { MessageKey } from "../../services/locale";
import { cssMs } from "../../services/metrics";
import type { LibraryItem } from "../../stores/library";
import {
  isCustomUnavailable,
  type LineupMutation,
  type LineupMutationResult,
} from "../../stores/lineup";
import type { Playlist } from "../../stores/settings";
import { Confirm } from "../Confirm";
import { ContentTransitionShade } from "../ContentTransitionShade";
import { Icon } from "../Icon";
import type { SettingsDetailNavigation } from "../Settings";
import { Text } from "../Text";
import { TextInput } from "../TextInput";
import { PageHeader, SettingsBreadcrumbs, SettingsListHeader } from "./Field";
import { SettingsDialog } from "./SettingsDialog";

const PAGE_SIZE = 20;
const QUERY_SETTLE_MS = 150;
type Scope = "channels" | "categories";
type EditTarget =
  | { kind: "channel"; value: ManagedChannel }
  | { kind: "category"; value: ManagedCategory };
type SortDrag = {
  pointerId: number;
  id: string;
  startY: number;
  clientY: number;
  moved: boolean;
  raf: number;
  node: HTMLElement;
};

/* Visibility and ordering writes apply optimistically and never hold the interface. */
const BACKGROUND_MUTATIONS = new Set<LineupMutation["type"]>([
  "category-order.mode",
  "category-order.reset",
  "item-order.mode",
  "item-order.reset",
  "category.place",
  "channel.place",
  "item.place",
  "category.visibility",
  "categories.visibility",
  "channel.visibility",
  "channels.visibility",
]);

const rowId = (row: ManagedCategory | ManagedChannel | LibraryItem) =>
  "ref" in row ? row.ref.id : row.key;

function revealSortRow(row: HTMLElement, pageTop = false) {
  const list = row.closest<HTMLElement>(".lineup-manager-list.sorting");
  const slot = row.closest<HTMLElement>(".lineup-sort-item");
  const scroller = row.closest<HTMLElement>(".sheet-body");
  if (!list || !slot || !scroller) return;
  if (pageTop) {
    scroller.scrollTop = 0;
    return;
  }
  const bounds = scroller.getBoundingClientRect();
  const pagination = row
    .closest(".lineup-manager-results")
    ?.querySelector<HTMLElement>(".lineup-sort-pagination");
  const paginationBounds = pagination?.getBoundingClientRect();
  const visibleTop = bounds.top + 32;
  const visibleBottom = paginationBounds?.height
    ? Math.min(bounds.bottom - 32, paginationBounds.top - 16)
    : bounds.bottom - 32;
  const top = list.getBoundingClientRect().top + slot.offsetTop;
  const bottom = top + slot.offsetHeight;
  if (top < visibleTop) scroller.scrollTop -= visibleTop - top;
  else if (bottom > visibleBottom) scroller.scrollTop += bottom - visibleBottom;
}

export function LineupManager({
  playlist,
  onAsking,
  navigation,
  busy,
  error,
  onError,
  onRefresh,
}: {
  playlist: Playlist;
  onAsking: (asking: boolean, restoreFocus?: boolean) => void;
  navigation: SettingsDetailNavigation;
  busy: boolean;
  error: string;
  onError: (message: string) => void;
  onRefresh: (trigger: HTMLButtonElement) => void;
}): React.ReactElement {
  const { t } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<LineupManagementContext | null>(null);
  const [acquireError, setAcquireError] = useState<MessageKey | null>(null);
  const acquisition = useRef(0);
  const contextRef = useRef<LineupManagementContext | null>(null);

  useEffect(() => {
    const run = ++acquisition.current;
    const controller = new AbortController();
    setContext(null);
    setAcquireError(null);
    void acquireManagementContext(playlist.id, "tv", controller.signal).then(
      (ready) => {
        if (acquisition.current !== run || controller.signal.aborted) {
          void ready.release();
          return;
        }
        contextRef.current = ready;
        setContext(ready);
      },
      () => {
        if (acquisition.current !== run || controller.signal.aborted) return;
        setAcquireError("remote.lineupLoadFailed");
      },
    );
    return () => {
      acquisition.current += 1;
      controller.abort();
      const held = contextRef.current;
      contextRef.current = null;
      void held?.release();
    };
  }, [playlist.id, playlist.sourceVersion, attempt]);

  useEffect(() => {
    if (!context) return;
    return context.controller.store.subscribe((state) => {
      if (state.playlistId !== playlist.id || !context.isCurrent()) {
        setContext(null);
        setAttempt((value) => value + 1);
      }
    });
  }, [context, playlist.id]);

  const handleRefresh = (trigger: HTMLButtonElement) => {
    onRefresh(trigger);
    setAttempt((value) => value + 1);
  };

  if (
    !context ||
    context.playlist.id !== playlist.id ||
    context.sourceVersion !== playlist.sourceVersion ||
    !context.isCurrent()
  ) {
    return (
      <div className="lineup-manager-gate">
        <SettingsBreadcrumbs
          items={[{ label: t("settings.playlists") }, { label: playlist.name, auto: true }]}
        />
        <PageHeader title={playlist.name} description={t("lineup.manageContentHint")} />
        {acquireError || error ? (
          <>
            <p className="field-problem" role="alert">
              {acquireError ? t(acquireError) : error}
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn tonal"
                disabled={busy}
                onClick={(event) => handleRefresh(event.currentTarget)}
              >
                <span>{t("common.refreshPlaylist")}</span>
              </button>
            </div>
          </>
        ) : (
          <div
            className="lineup-manager-loading"
            role="status"
            aria-busy="true"
            aria-label={t("playlist.loading", { name: playlist.name })}
          >
            <span className="spinner" aria-hidden="true" />
          </div>
        )}
      </div>
    );
  }
  return (
    <OwnedLineupManager
      key={`${playlist.id}:v${playlist.sourceVersion}`}
      playlist={playlist}
      context={context}
      onAsking={onAsking}
      navigation={navigation}
      onError={onError}
    />
  );
}

function OwnedLineupManager({
  playlist,
  context,
  onAsking,
  navigation,
  onError,
}: {
  playlist: Playlist;
  context: LineupManagementContext;
  onAsking: (asking: boolean, restoreFocus?: boolean) => void;
  navigation: SettingsDetailNavigation;
  onError: (message: string) => void;
}): React.ReactElement {
  const { t, number, direction } = useLocale();
  const queueLayoutTask = useLayoutTask();
  const useLineup = context.controller.store;
  const useLibrary = context.library;
  const managedCategories = useLineup((state) => state.managedCategories);
  const personalCategoriesState = useLineup((state) => state.categories);
  const managedChannels = useLineup((state) => state.managedChannels);
  const saveError = useLineup((state) => state.saveError);
  const saving = useLineup((state) => state.saving);
  const unavailable = useLineup((state) => state.unavailable);
  const categoryOrderModes = useLineup((state) => state.categoryOrderModes);
  const itemOrderModes = useLineup((state) => state.itemOrderModes);
  const libraryCategories = useLibrary((state) => state.categories);
  const libraryItemsFor = useLibrary((state) => state.itemsFor);
  const libraryLoadCategories = useLibrary((state) => state.loadCategories);
  const libraryLoadCategory = useLibrary((state) => state.loadCategory);
  const libraryCategoryItems = useLibrary((state) => state.categoryItems);
  const lineup = useMemo(
    () => ({
      categories: personalCategoriesState,
      categoryOrderModes,
      itemOrderModes,
      managedCategories,
      managedChannels,
      saving,
      unavailable,
    }),
    [
      categoryOrderModes,
      itemOrderModes,
      managedCategories,
      managedChannels,
      personalCategoriesState,
      saving,
      unavailable,
    ],
  );
  const visibleUnavailable = useMemo(
    () =>
      CUSTOM_CATEGORIES_ENABLED
        ? unavailable
        : unavailable.filter((record) => !isCustomUnavailable(record)),
    [unavailable],
  );
  const library = useMemo(
    () => ({
      categories: libraryCategories,
      categoryItems: libraryCategoryItems,
      itemsFor: libraryItemsFor,
      loadCategories: libraryLoadCategories,
      loadCategory: libraryLoadCategory,
    }),
    [
      libraryCategories,
      libraryCategoryItems,
      libraryItemsFor,
      libraryLoadCategories,
      libraryLoadCategory,
    ],
  );
  const [scope, setScope] = useState<Scope>("categories");
  const [kind, setKind] = useState<"live" | "movie" | "series">("live");
  const [selectedKind, setSelectedKind] = useState<typeof kind>("live");
  const [categoryKey, setCategoryKey] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [page, setPage] = useState(0);
  const pendingPageFocus = useRef(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [numberDraft, setNumberDraft] = useState("");
  const [problem, setProblem] = useState("");
  const [membershipDraft, setMembershipDraft] = useState<string[]>([]);
  const [personalName, setPersonalName] = useState("");
  const [confirmingPersonal, setConfirmingPersonal] = useState("");
  const [confirmingUnavailable, setConfirmingUnavailable] = useState("");
  const [sorting, setSorting] = useState(false);
  const [grabbed, setGrabbed] = useState("");
  const revealPageTop = useRef(false);
  const [sortIds, setSortIds] = useState<string[]>([]);
  const [orderDialog, setOrderDialog] = useState<string | null>(null);
  const kindTransition = useContentTransition(
    `lineup-kind:${playlist.id}:v${context.sourceVersion}:${scope}:${sorting ? "sort" : "browse"}`,
  );
  const kindChanging =
    kindTransition.phase === "leaving" || kindTransition.phase === "settling";
  const createInput = useRef<HTMLInputElement>(null);
  const createCancelButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const orderButton = useRef<HTMLButtonElement>(null);
  const customOrderButton = useRef<HTMLButtonElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const paginationRef = useRef<HTMLElement>(null);
  const kindStripRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  const { move: moveTabContent } = useSpatialNav(tabContentRef, false);
  const tabPanelId = useId();
  const pendingKindFocus = useRef(false);
  const [kindInk, setKindInk] = useState<{ y: number; height: number } | null>(null);
  const browseSnapshot = useRef<{
    page: number;
    query: string;
    appliedQuery: string;
    searching: boolean;
    scrollTop: number;
  } | null>(null);
  const sortOrigin = useRef<string[]>([]);
  const sortIdsRef = useRef<string[]>([]);
  const sortMotionPositions = useRef(new Map<string, number>());
  const sortMotionAnimations = useRef(new Map<string, Animation>());
  const sortMotionContext = useRef<readonly (string | number)[]>([]);
  const drag = useRef<SortDrag | null>(null);
  const editPending = useRef(false);
  const [editBusy, setEditBusy] = useState(false);
  const suppressDragClick = useRef<{ id: string; timer: number } | null>(null);
  const mountedRef = useRef(true);
  const inputEnabledRef = useRef(navigation.inputEnabled);
  inputEnabledRef.current = navigation.inputEnabled && !kindChanging;
  const surfaceInputEnabledRef = useRef(navigation.surfaceInputEnabled);
  surfaceInputEnabledRef.current = navigation.surfaceInputEnabled;
  sortIdsRef.current = sortIds;

  const endDragGesture = useCallback((held: SortDrag | null) => {
    if (!held) return;
    if (held.raf) {
      cancelAnimationFrame(held.raf);
      held.raf = 0;
    }
    if (drag.current === held) drag.current = null;
    try {
      held.node.releasePointerCapture?.(held.pointerId);
    } catch {
      // The pointer is already gone, so there is nothing to release.
    }
  }, []);

  const cancelSortPreview = useCallback(() => {
    sortIdsRef.current = sortOrigin.current;
    setSortIds(sortOrigin.current);
    setGrabbed("");
  }, []);

  const cancelSortDrag = useCallback(() => {
    endDragGesture(drag.current);
    cancelSortPreview();
  }, [cancelSortPreview, endDragGesture]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      endDragGesture(drag.current);
      if (suppressDragClick.current) window.clearTimeout(suppressDragClick.current.timer);
    };
  }, [endDragGesture]);
  const categoryBrowseSnapshot = useRef<{
    page: number;
    query: string;
    appliedQuery: string;
    searching: boolean;
  } | null>(null);
  const retryMutation = useRef<LineupMutation | null>(null);

  const notifyPersistenceFailure = useCallback(() => {
    onError(t("lineup.persistenceFailed"));
  }, [onError, t]);

  const applyOwnedMutation = useCallback(
    async (revision: number, mutation: LineupMutation): Promise<LineupMutationResult> => {
      const lineupState = useLineup.getState();
      if (
        !mountedRef.current ||
        !context.isCurrent() ||
        lineupState.playlistId !== playlist.id
      ) {
        return { ok: false, reason: "unavailable", revision: lineupState.revision };
      }
      return context.controller.applyLineupMutation(revision, mutation);
    },
    [context, playlist.id],
  );

  const commitMutation = useCallback(
    async (mutation: LineupMutation): Promise<LineupMutationResult> => {
      if (BACKGROUND_MUTATIONS.has(mutation.type)) {
        retryMutation.current = null;
        setProblem("");
        return applyOwnedMutation(useLineup.getState().revision, mutation);
      }
      const retrying = retryMutation.current === mutation;
      if (!retrying) retryMutation.current = null;
      const result = await applyOwnedMutation(useLineup.getState().revision, mutation);
      if (result.ok) {
        retryMutation.current = null;
        setProblem("");
        context.controller.clearLineupError();
      } else {
        retryMutation.current = result.reason === "persistence" ? mutation : null;
        setProblem(t("lineup.persistenceFailed"));
        notifyPersistenceFailure();
      }
      return result;
    },
    [applyOwnedMutation, notifyPersistenceFailure, t],
  );

  const focusPreferenceFallback = useCallback(
    (key?: string) => {
      queueLayoutTask(() => {
        if (!inputEnabledRef.current) return;
        const root = managerRef.current;
        const target =
          (key
            ? root?.querySelector<HTMLButtonElement>(`[data-lineup-preference="${key}"]`)
            : null) ??
          orderButton.current ??
          customOrderButton.current ??
          root?.querySelector<HTMLElement>("[data-lineup-unavailable-remove]");
        target?.focus({ preventScroll: true });
      });
    },
    [queueLayoutTask],
  );

  const closeCreate = () => {
    createInput.current?.blur();
    setPersonalName("");
    setCreatingCategory(false);
    focusPreferenceFallback();
  };

  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    queueLayoutTask(() => {
      if (inputEnabledRef.current) searchButton.current?.focus({ preventScroll: true });
    });
  }, [queueLayoutTask]);

  const toggleSearch = useCallback(() => {
    if (searching) {
      closeSearch();
      return;
    }
    setSearching(true);
  }, [searching, closeSearch]);

  const searchLabelKey =
    scope === "categories"
      ? ("lineup.searchCategories" as const)
      : kind === "live"
        ? ("lineup.searchChannels" as const)
        : ("lineup.searchTitles" as const);

  const createCategory = async () => {
    const result = await commitMutation({
      type: "personal-category.create",
      name: personalName,
    });
    if (!result.ok) {
      setProblem(
        t(
          result.reason === "limit"
            ? "lineup.personalCategoryLimit"
            : "lineup.personalCategoryRequired",
        ),
      );
      return;
    }
    closeCreate();
  };

  const categories = useMemo(
    () =>
      lineup.managedCategories.filter(
        (category) =>
          category.kind === kind && (CUSTOM_CATEGORIES_ENABLED || !category.personal),
      ),
    [lineup.managedCategories, kind],
  );
  const availableKinds = useMemo(() => {
    const present = new Set(
      lineup.managedCategories
        .filter((category) => CUSTOM_CATEGORIES_ENABLED || !category.personal)
        .filter((category) => playlist.source.kind !== "m3u" || category.kind === "live")
        .map((category) => category.kind),
    );
    return (["live", "movie", "series"] as const).filter((section) => present.has(section));
  }, [lineup.managedCategories, playlist.source.kind]);
  const activeCategory = lineup.managedCategories.find(
    (category) => category.key === categoryKey,
  );
  useEffect(() => {
    if (scope !== "channels" || !activeCategory) return;
    navigation.updateLabel(`lineup-category-${activeCategory.key}`, activeCategory.name);
  }, [scope, activeCategory, navigation.updateLabel]);
  const categoryFocusKey = scope === "channels" ? categoryKey : "";
  const personalCategories = useMemo(
    () =>
      CUSTOM_CATEGORIES_ENABLED
        ? lineup.categories.filter((category) => category.personal)
        : [],
    [lineup.categories],
  );
  const selectedCategoryChannels = useMemo(() => {
    if (scope !== "channels" || kind !== "live" || !categoryKey) return [];
    const category = lineup.categories.find((item) => item.key === categoryKey);
    if (!category) return [];
    const byId = new Map<string, ManagedChannel>();
    for (const channel of lineup.managedChannels) {
      byId.set(channel.effective.id, channel);
    }
    const selected: ManagedChannel[] = [];
    for (const channel of category.channels) {
      const managed = byId.get(channel.id);
      if (managed) selected.push(managed);
    }
    return selected;
  }, [scope, kind, categoryKey, lineup.categories, lineup.managedChannels]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!sorting) setAppliedQuery(query);
    }, QUERY_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [query, sorting]);
  const rows = useMemo(() => {
    const folded = appliedQuery.trim().toLocaleLowerCase();
    if (scope === "channels") {
      if (kind !== "live") {
        const source = library.itemsFor(kind, categoryKey).value;
        return folded
          ? source.filter((item) => item.name.toLocaleLowerCase().includes(folded))
          : source;
      }
      const source = categoryKey ? selectedCategoryChannels : lineup.managedChannels;
      return folded
        ? source.filter((channel) =>
            channel.effective.name.toLocaleLowerCase().includes(folded),
          )
        : source;
    }
    return folded
      ? categories.filter((category) => category.name.toLocaleLowerCase().includes(folded))
      : categories;
  }, [
    appliedQuery,
    categories,
    categoryKey,
    selectedCategoryChannels,
    kind,
    library,
    lineup.managedChannels,
    scope,
  ]);
  const sectionRows = useMemo<
    readonly (ManagedCategory | ManagedChannel | LibraryItem)[]
  >(() => {
    if (scope === "categories") return categories;
    if (kind !== "live") return library.itemsFor(kind, categoryKey).value;
    return categoryKey ? selectedCategoryChannels : lineup.managedChannels;
  }, [
    scope,
    categories,
    kind,
    library,
    categoryKey,
    selectedCategoryChannels,
    lineup.managedChannels,
  ]);
  const sectionItemCount = sectionRows.length;
  const contentResource =
    scope === "channels" && kind !== "live" ? library.itemsFor(kind, categoryKey) : null;
  const resultsLoading =
    contentResource?.state === "idle" || contentResource?.state === "loading";
  const resultsFailed = contentResource?.state === "failed";

  // A failed write restores durable state; the preview and any grab fall back with it.
  useEffect(() => {
    if (!saveError || !sorting) return;
    endDragGesture(drag.current);
    const ids = sectionRows.map(rowId);
    sortOrigin.current = ids;
    sortIdsRef.current = ids;
    setSortIds(ids);
    setGrabbed("");
  }, [saveError, sectionRows, sorting, endDragGesture]);

  // A released preview tracks the controller so refreshes cannot leave it stale.
  useEffect(() => {
    if (!sorting || grabbed) return;
    const ids = sectionRows.map(rowId);
    sortOrigin.current = ids;
    sortIdsRef.current = ids;
    setSortIds((current) =>
      current.length === ids.length && current.every((id, index) => id === ids[index])
        ? current
        : ids,
    );
  }, [sectionRows, sorting, grabbed]);

  const channelNumberWidth = useMemo(() => {
    let width = 2;
    if (scope === "channels" && kind === "live") {
      for (const row of sectionRows) {
        const channel = row as ManagedChannel;
        width = Math.max(width, number(channel.effective.number).length);
      }
    }
    return `${width}ch`;
  }, [sectionRows, scope, kind, number]);
  const pages = Math.max(1, Math.ceil((sorting ? sortIds.length : rows.length) / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const notifications = useToast(
    `lineup:${playlist.id}:v${context.sourceVersion}:${scope}:${kind}:${categoryKey}:${appliedQuery}:${currentPage}`,
    navigation.surfaceInputEnabled && !kindChanging,
  );
  useEffect(() => {
    setPage((value) => Math.min(value, pages - 1));
  }, [pages]);

  useEffect(() => {
    if (scope !== "categories" || !availableKinds.length || availableKinds.includes(kind))
      return;
    setKind(availableKinds[0]);
    setCategoryKey("");
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    categoryBrowseSnapshot.current = null;
  }, [availableKinds, kind, scope]);

  useEffect(() => {
    if (kind === "live" || playlist.source.kind !== "xtream") return;
    void libraryLoadCategories(kind);
  }, [kind, playlist, libraryLoadCategories]);
  const shown = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const sortPage = sortIds.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const shownSortIds =
    grabbed && !sortPage.includes(grabbed) ? [grabbed, ...sortPage] : sortPage;

  const goToPage = (wanted: number) => {
    if (!inputEnabledRef.current || !context.isCurrent()) return;
    const nextPage = Math.max(0, Math.min(pages - 1, wanted));
    if (nextPage === currentPage) return;
    if (sorting && grabbed) {
      revealPageTop.current = true;
      const current = sortIdsRef.current;
      const from = current.indexOf(grabbed);
      const to = Math.min(nextPage * PAGE_SIZE, Math.max(0, current.length - 1));
      if (from >= 0 && from !== to) {
        const next = current.slice();
        next.splice(from, 1);
        next.splice(to, 0, grabbed);
        sortIdsRef.current = next;
        setSortIds(next);
      }
    }
    pendingPageFocus.current = true;
    setPage(nextPage);
  };

  useLayoutEffect(() => {
    if (!pendingPageFocus.current) return;
    if (
      !navigation.focusReady ||
      kindTransition.phase === "leaving" ||
      editing ||
      creatingCategory ||
      !context.isCurrent()
    )
      return;
    pendingPageFocus.current = false;
    let target: HTMLElement | null = null;
    if (sorting && grabbed) {
      for (const node of Array.from(
        managerRef.current?.querySelectorAll<HTMLElement>("[data-sort-id]") ?? [],
      )) {
        if (node.dataset.sortId === grabbed) {
          target = node;
          break;
        }
      }
    }
    target ??=
      managerRef.current?.querySelector<HTMLElement>(
        ".lineup-manager-list [data-settings-detail-first]",
      ) ?? null;
    const focused = target ?? orderButton.current ?? searchButton.current;
    focused?.focus({ preventScroll: true });
    if (sorting && target) {
      if (!grabbed) revealSortRow(target, true);
    } else focused?.scrollIntoView({ block: "nearest" });
  }, [
    currentPage,
    rows,
    sorting,
    grabbed,
    editing,
    creatingCategory,
    navigation.focusReady,
    kindTransition.phase,
    context,
  ]);

  const beginEdit = (target: EditTarget) => {
    setEditing(target);
    const name = target.kind === "channel" ? target.value.effective.name : target.value.name;
    setNameDraft(name);
    setNumberDraft(target.kind === "channel" ? String(target.value.effective.number) : "");
    setMembershipDraft(
      target.kind === "channel"
        ? personalCategories
            .filter((category) =>
              category.channels.some((channel) => channel.id === target.value.ref.id),
            )
            .map((category) => category.key.slice("personal:".length))
        : [],
    );
    setProblem("");
    context.controller.clearLineupError();
    onAsking(true);
  };

  const closeEdit = () => {
    const targetId = editing
      ? editing.kind === "channel"
        ? editing.value.ref.id
        : editing.value.key
      : "";
    setEditing(null);
    onAsking(false, true);
    queueLayoutTask(() => {
      if (!inputEnabledRef.current) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== document.body &&
        managerRef.current?.contains(active)
      )
        return;
      const pencil = targetId
        ? Array.from(
            managerRef.current?.querySelectorAll<HTMLElement>("[data-lineup-edit]") ?? [],
          ).find((row) => row.dataset.lineupEdit === targetId)
        : null;
      (pencil ?? searchButton.current ?? orderButton.current)?.focus({
        preventScroll: true,
      });
    });
  };

  const saveEdit = async () => {
    if (!editing || editPending.current) return;
    editPending.current = true;
    setEditBusy(true);
    setProblem("");
    try {
      let revision = useLineup.getState().revision;
      if (editing.kind === "channel") {
        const trimmedNumber = numberDraft.trim();
        const parsedNumber = trimmedNumber ? Number(trimmedNumber) : null;
        if (
          parsedNumber !== null &&
          (!Number.isInteger(parsedNumber) ||
            parsedNumber <= 0 ||
            String(parsedNumber) !== trimmedNumber)
        ) {
          setProblem(t("lineup.invalidNumber"));
          return;
        }
        const customNumber =
          parsedNumber === editing.value.providerNumber ? null : parsedNumber;
        const customName = nameDraft.trim();
        const changes = [
          {
            type: "channel.rename" as const,
            channel: editing.value.ref,
            name: customName && customName !== editing.value.providerName ? customName : null,
          },
          { type: "channel.number" as const, channel: editing.value.ref, number: customNumber },
        ];
        for (const change of changes) {
          const result = await applyOwnedMutation(revision, change);
          if (!result.ok) {
            setProblem(
              t(
                result.reason === "duplicate-number"
                  ? "lineup.duplicateNumber"
                  : "lineup.persistenceFailed",
              ),
            );
            return;
          }
          revision = result.revision;
        }
        if (CUSTOM_CATEGORIES_ENABLED) {
          const memberships = await applyOwnedMutation(revision, {
            type: "personal-category.memberships",
            channel: editing.value.ref,
            categoryIds: membershipDraft,
          });
          if (!memberships.ok) {
            setProblem(t("lineup.persistenceFailed"));
            return;
          }
        }
      } else {
        const trimmedName = nameDraft.trim();
        const renamed = await applyOwnedMutation(
          revision,
          editing.value.personal
            ? {
                type: "personal-category.rename",
                categoryId: editing.value.key.slice("personal:".length),
                name: trimmedName || editing.value.providerName,
              }
            : {
                type: "category.rename",
                categoryKey: editing.value.key,
                name:
                  trimmedName && trimmedName !== editing.value.providerName
                    ? trimmedName
                    : null,
              },
        );
        if (!renamed.ok) {
          setProblem(t("lineup.persistenceFailed"));
          return;
        }
      }
      if (mountedRef.current) closeEdit();
    } finally {
      editPending.current = false;
      if (mountedRef.current) setEditBusy(false);
    }
  };

  const resetEditDraft = () => {
    if (!editing || editPending.current || !surfaceInputEnabledRef.current) return;
    setNameDraft(editing.value.providerName);
    if (editing.kind === "channel") setNumberDraft(String(editing.value.providerNumber));
    setProblem("");
  };

  const defaultSortOrder = () => {
    if (kind === "live") return context.controller.defaultItemOrder(categoryKey);
    const currentLibrary = useLibrary.getState();
    return (currentLibrary.categoryItems[categoryKey]?.items ?? []).map((item) => item.key);
  };

  const captureBrowse = useCallback(() => {
    const scroller = managerRef.current?.closest(".sheet-body");
    browseSnapshot.current = {
      page: currentPage,
      query,
      appliedQuery,
      searching,
      scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : 0,
    };
  }, [currentPage, query, appliedQuery, searching]);

  const restoreBrowse = useCallback(() => {
    const snapshot = browseSnapshot.current;
    browseSnapshot.current = null;
    if (!snapshot) return;
    setPage(snapshot.page);
    setQuery(snapshot.query);
    setAppliedQuery(snapshot.appliedQuery);
    setSearching(snapshot.searching);
    queueLayoutTask(() => {
      const scroller = managerRef.current?.closest(".sheet-body");
      if (scroller instanceof HTMLElement) scroller.scrollTop = snapshot.scrollTop;
    });
  }, [queueLayoutTask]);

  const enterSort = () => {
    if (!sectionItemCount) return;
    captureBrowse();
    setSearching(false);
    setQuery("");
    setAppliedQuery("");
    setPage(0);
    const ids = sectionRows.map(rowId);
    sortOrigin.current = ids;
    setSortIds(ids);
    setGrabbed("");
    setSorting(true);
  };

  const exitSort = useCallback(() => {
    if (!inputEnabledRef.current) return;
    endDragGesture(drag.current);
    if (grabbed) cancelSortPreview();
    setSorting(false);
    restoreBrowse();
    focusPreferenceFallback("custom-order");
  }, [cancelSortPreview, endDragGesture, grabbed, focusPreferenceFallback, restoreBrowse]);

  const visibilitySupported =
    scope === "categories" || (scope === "channels" && kind === "live");

  const renameSupported =
    (scope === "categories" && sectionItemCount > 0) ||
    (scope === "channels" && kind === "live" && !!categoryKey && sectionItemCount > 0);

  const requestModeBack = useCallback(() => {
    if (!sorting) return;
    if (!inputEnabledRef.current) return;
    if (drag.current || grabbed) {
      cancelSortDrag();
      return;
    }
    exitSort();
  }, [sorting, grabbed, cancelSortDrag, exitSort]);

  const registerEdgeBack = navigation.registerEdgeBack;
  const focusEdgeBack = navigation.focusEdgeBack;
  const requestModeBackRef = useRef(requestModeBack);
  requestModeBackRef.current = requestModeBack;
  const edgeBackAction = useCallback(() => requestModeBackRef.current(), []);
  const edgeBackMode = sorting ? "order" : "";
  useLayoutEffect(() => {
    if (!edgeBackMode) return;
    return registerEdgeBack(
      `lineup-${playlist.id}:v${playlist.sourceVersion}-${kind}-${scope}-${categoryKey}-${edgeBackMode}`,
      edgeBackAction,
      false,
    );
  }, [
    edgeBackMode,
    registerEdgeBack,
    edgeBackAction,
    playlist.id,
    playlist.sourceVersion,
    kind,
    scope,
    categoryKey,
  ]);

  const orderScope = useMemo(() => {
    const providerOption = {
      value: "provider" as LineupOrderMode,
      label: t("lineup.orderProvider"),
    };
    const alphabeticalOption = {
      value: "alphabetical" as LineupOrderMode,
      label: t("lineup.orderAlphabetical"),
    };
    const numberOption = {
      value: "number" as LineupOrderMode,
      label: t("lineup.orderNumber"),
    };
    const customOption = {
      value: "custom" as LineupOrderMode,
      label: t("lineup.orderCustom"),
    };
    if (scope === "categories") {
      return {
        key: `categories:${kind}`,
        mode: lineup.categoryOrderModes[kind] ?? "provider",
        title: t("lineup.categoryOrder"),
        preferenceLabel: t("lineup.categoryOrder"),
        options: [providerOption, alphabeticalOption, customOption],
      };
    }
    if (scope === "channels" && activeCategory) {
      const orderLabel =
        kind === "live"
          ? "lineup.channelOrder"
          : kind === "movie"
            ? "lineup.movieOrder"
            : "lineup.seriesOrder";
      return {
        key: `channels:${categoryKey}`,
        mode: lineup.itemOrderModes[categoryKey] ?? "provider",
        title: t(orderLabel),
        preferenceLabel: t(orderLabel),
        options: [
          providerOption,
          alphabeticalOption,
          ...(kind === "live" ? [numberOption] : []),
          customOption,
        ],
      };
    }
    return null;
  }, [
    scope,
    kind,
    categoryKey,
    activeCategory,
    lineup.categoryOrderModes,
    lineup.itemOrderModes,
    t,
  ]);

  const openOrderDialog = () => {
    if (!orderScope) return;
    setProblem("");
    orderButton.current?.focus({ preventScroll: true });
    setOrderDialog(orderScope.key);
    onAsking(true);
  };

  const closeOrderDialog = useCallback(
    (restoreFocus = true) => {
      setOrderDialog(null);
      setProblem("");
      onAsking(false, false);
      if (restoreFocus) focusPreferenceFallback("order");
    },
    [onAsking, focusPreferenceFallback],
  );

  const resetOrder = () => {
    if (
      !orderScope ||
      !(orderDialog ? surfaceInputEnabledRef.current : inputEnabledRef.current)
    )
      return;
    void commitMutation(
      scope === "categories"
        ? { type: "category-order.reset", section: kind }
        : { type: "item-order.reset", categoryKey },
    );
    if (orderDialog) closeOrderDialog();
  };

  const selectOrderMode = (mode: LineupOrderMode) => {
    if (!orderScope) return;
    if (mode === orderScope.mode) {
      closeOrderDialog();
      return;
    }
    void commitMutation(
      scope === "categories"
        ? { type: "category-order.mode", section: kind, mode }
        : { type: "item-order.mode", categoryKey, mode },
    );
    closeOrderDialog();
  };

  const savedOrderMode = orderScope?.mode;
  useEffect(() => {
    if (!sorting || savedOrderMode === undefined || savedOrderMode === "custom") return;
    cancelSortDrag();
    setSorting(false);
    restoreBrowse();
    focusPreferenceFallback("order");
  }, [sorting, savedOrderMode, cancelSortDrag, focusPreferenceFallback, restoreBrowse]);

  const orderScopeKey = orderScope?.key;
  useEffect(() => {
    if (orderDialog && orderScopeKey !== orderDialog) closeOrderDialog(false);
  }, [orderDialog, orderScopeKey, closeOrderDialog]);

  const sectionLabel = t(
    kind === "live" ? "content.live" : kind === "movie" ? "content.movies" : "content.series",
  );
  const channelBulkKey = scope === "channels" && kind === "live" ? categoryKey : "";
  const bulkSupported =
    visibilitySupported &&
    (scope === "categories" ? categories.length > 0 : channelBulkKey !== "");
  const showAllItems = () => {
    if (!bulkSupported) return;
    void commitMutation(
      scope === "categories"
        ? {
            type: "categories.visibility",
            categoryKeys: categories.map((category) => category.key),
            hidden: false,
          }
        : { type: "channels.visibility", categoryKey: channelBulkKey, hidden: false },
    );
  };
  const hideAllItems = () => {
    if (!bulkSupported) return;
    void commitMutation(
      scope === "categories"
        ? {
            type: "categories.visibility",
            categoryKeys: categories.map((category) => category.key),
            hidden: true,
          }
        : { type: "channels.visibility", categoryKey: channelBulkKey, hidden: true },
    );
  };

  useLayoutEffect(() => {
    if (creatingCategory && inputEnabledRef.current) createInput.current?.focus();
  }, [creatingCategory]);

  useLayoutEffect(() => {
    if (categoryFocusKey) navigation.focusStart();
  }, [categoryFocusKey, navigation.focusStart]);

  useLayoutEffect(() => {
    if (!navigation.focusReady || !sorting) return;
    const root = managerRef.current;
    const active = document.activeElement;
    if (active instanceof HTMLElement && root?.contains(active)) return;
    const held = root?.querySelector<HTMLElement>(".lineup-sort-row[aria-pressed='true']");
    const first =
      held ??
      root?.querySelector<HTMLElement>(
        ".lineup-manager-list.sorting [data-settings-detail-first]",
      );
    first?.focus({ preventScroll: true });
    if (first) revealSortRow(first, !held);
  }, [sorting, navigation.focusReady]);

  useLayoutEffect(() => {
    const rows = sorting
      ? Array.from(
          managerRef.current?.querySelectorAll<HTMLElement>("[data-lineup-sort-motion]") ?? [],
        )
      : [];
    const context = [
      playlist.id,
      playlist.sourceVersion,
      scope,
      kind,
      categoryKey,
      currentPage,
    ];
    const sameContext = context.every(
      (part, index) => part === sortMotionContext.current[index],
    );
    const measured = rows.map((node) => {
      const id = node.dataset.lineupSortMotion!;
      const transform = sortMotionAnimations.current.has(id)
        ? getComputedStyle(node).transform
        : "none";
      const matrix = /^matrix\((.+)\)$/.exec(transform);
      const translateY = matrix ? Number(matrix[1].split(",")[5]) : 0;
      return {
        node,
        id,
        top: node.offsetTop,
        height: node.offsetHeight,
        translateY,
      };
    });
    for (const animation of sortMotionAnimations.current.values()) animation.cancel();
    sortMotionAnimations.current.clear();
    const previous = sortMotionPositions.current;
    sortMotionPositions.current = new Map(measured.map((row) => [row.id, row.top]));
    sortMotionContext.current = sorting ? context : [];
    if (!sorting || !sameContext) return;
    const duration = cssMs("--t-fast");
    if (duration <= 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const easing =
      getComputedStyle(document.documentElement).getPropertyValue("--ease-enter").trim() ||
      "ease";
    for (const row of measured) {
      const from = previous.get(row.id);
      if (row.id === grabbed || from === undefined || !row.height) continue;
      const delta = from - row.top + row.translateY;
      if (!delta) continue;
      const animation = row.node.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0px)" }],
        { duration, easing },
      );
      sortMotionAnimations.current.set(row.id, animation);
      animation.onfinish = () => {
        if (sortMotionAnimations.current.get(row.id) === animation) {
          sortMotionAnimations.current.delete(row.id);
        }
      };
    }
  }, [
    sortIds,
    sorting,
    playlist.id,
    playlist.sourceVersion,
    scope,
    kind,
    categoryKey,
    currentPage,
    grabbed,
  ]);

  useEffect(
    () => () => {
      for (const animation of sortMotionAnimations.current.values()) animation.cancel();
      sortMotionAnimations.current.clear();
    },
    [],
  );

  useLayoutEffect(() => {
    if (!sorting || !grabbed || !inputEnabledRef.current) {
      revealPageTop.current = false;
      return;
    }
    let held: HTMLButtonElement | null = null;
    for (const row of Array.from(
      managerRef.current?.querySelectorAll<HTMLButtonElement>(".lineup-sort-row") ?? [],
    )) {
      if (row.dataset.sortId === grabbed) {
        held = row;
        break;
      }
    }
    if (!held) return;
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      active === document.body ||
      (managerRef.current?.contains(active) &&
        active.classList.contains("lineup-sort-row") &&
        active !== held)
    ) {
      held.focus({ preventScroll: true });
    }
    if (!drag.current?.moved) revealSortRow(held, revealPageTop.current);
    revealPageTop.current = false;
    const pending = drag.current;
    if (pending && pending.id === grabbed) {
      try {
        held.setPointerCapture(pending.pointerId);
      } catch {
        // The pointer is already gone; nothing to recapture.
      }
    }
  }, [sortIds, sorting, grabbed, currentPage]);

  const initialContentFocus = useRef(true);
  useLayoutEffect(() => {
    if (sorting || editing || !navigation.focusReady) return;
    const firstReady = initialContentFocus.current;
    initialContentFocus.current = false;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.isConnected &&
      active !== document.body &&
      !(
        firstReady &&
        active.hasAttribute("data-settings-edge-back") &&
        !active.hasAttribute("data-settings-focus-claimed")
      )
    )
      return;
    const selectedTab = kindStripRef.current?.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    const first =
      selectedTab ??
      managerRef.current?.querySelector<HTMLElement>(
        ".lineup-manager-list button, .lineup-manager-list [tabindex='0'], [data-lineup-unavailable-remove]",
      );
    (first ?? orderButton.current ?? searchButton.current)?.focus();
  }, [rows, sorting, editing, navigation.focusReady]);

  const moveGrabbed = useCallback(
    (delta: -1 | 1) => {
      if (!grabbed) return false;
      const current = sortIdsRef.current;
      const at = current.indexOf(grabbed);
      if (at < 0) return false;
      const first = currentPage * PAGE_SIZE;
      const last = Math.min(current.length - 1, first + PAGE_SIZE - 1);
      const to = Math.max(first, Math.min(last, at + delta));
      if (at === to) return false;
      const next = current.slice();
      next.splice(at, 1);
      next.splice(to, 0, grabbed);
      revealPageTop.current = to === first;
      sortIdsRef.current = next;
      setSortIds(next);
      return true;
    },
    [grabbed, currentPage],
  );

  const focusSortPagination = () => {
    const target =
      paginationRef.current?.querySelector<HTMLButtonElement>(
        '[data-lineup-page="next"]:not(:disabled)',
      ) ?? paginationRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    target?.focus({ preventScroll: true });
  };

  const commitPlacement = (orderedIds = sortIdsRef.current, itemId = grabbed) => {
    if (!itemId) return;
    endDragGesture(drag.current);
    if (
      orderedIds.length === sortOrigin.current.length &&
      orderedIds.every((id, index) => id === sortOrigin.current[index])
    ) {
      setGrabbed("");
      return;
    }
    const at = orderedIds.indexOf(itemId);
    const placement = {
      itemId,
      ...(orderedIds[at + 1]
        ? { beforeId: orderedIds[at + 1] }
        : orderedIds[at - 1]
          ? { afterId: orderedIds[at - 1] }
          : {}),
    };
    const state = useLineup.getState();
    const placementCategoryKey =
      scope === "categories"
        ? ""
        : kind === "live"
          ? categoryKey ||
            state.managedChannels.find((channel) => channel.ref.id === itemId)
              ?.categoryKeys[0] ||
            ""
          : categoryKey;
    const savedMode =
      scope === "categories"
        ? state.categoryOrderModes[kind]
        : placementCategoryKey
          ? (state.itemOrderModes[placementCategoryKey] ?? "provider")
          : "provider";
    if (savedMode !== "custom") {
      cancelSortPreview();
      return;
    }
    void commitMutation(
      scope === "categories"
        ? { type: "category.place", section: kind, placement }
        : kind === "live"
          ? {
              type: "channel.place",
              categoryKey: placementCategoryKey,
              placement,
            }
          : {
              type: "item.place",
              categoryKey,
              placement,
              providerOrder: defaultSortOrder(),
            },
    );
    setGrabbed("");
    sortOrigin.current = orderedIds;
  };

  const sortIdsForPoint = (clientY: number, heldId: string) => {
    const list = managerRef.current?.querySelector<HTMLElement>(".lineup-manager-list.sorting");
    if (!list) return null;
    const pagination = paginationRef.current;
    const paginationBounds = pagination?.getBoundingClientRect();
    if (paginationBounds?.height && clientY >= paginationBounds.top) return null;
    const origin = list.getBoundingClientRect().top;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>(".lineup-sort-row"));
    const target = rows.find((row) => {
      const slot = row.parentElement!;
      const top = origin + slot.offsetTop;
      return clientY >= top && clientY <= top + slot.offsetHeight;
    });
    const targetId = target?.dataset.sortId;
    if (!targetId || targetId === heldId) return null;
    const current = sortIdsRef.current;
    const at = current.indexOf(heldId);
    const targetAt = current.indexOf(targetId);
    if (at < 0 || targetAt < 0) return null;
    const slot = target!.parentElement!;
    const top = origin + slot.offsetTop;
    let to = targetAt + (clientY >= top + slot.offsetHeight / 2 ? 1 : 0);
    const next = current.filter((id) => id !== heldId);
    if (at < to) to -= 1;
    next.splice(to, 0, heldId);
    if (next.every((id, index) => id === current[index])) return null;
    return next;
  };

  const movePointerGrab = (event: React.PointerEvent<HTMLButtonElement>) => {
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;
    if (!inputEnabledRef.current || !context.isCurrent()) {
      endDragGesture(held);
      cancelSortPreview();
      return;
    }
    held.clientY = event.clientY;
    if (!held.moved) {
      if (Math.abs(event.clientY - held.startY) < 8) return;
      held.moved = true;
      if (grabbed && grabbed !== held.id) cancelSortPreview();
      if (grabbed !== held.id) {
        sortOrigin.current = sortIdsRef.current;
        setGrabbed(held.id);
      }
      const step = () => {
        held.raf = 0;
        if (drag.current !== held || !mountedRef.current) return;
        if (!inputEnabledRef.current || !context.isCurrent()) {
          endDragGesture(held);
          cancelSortPreview();
          return;
        }
        const scroller = managerRef.current?.closest<HTMLElement>(".sheet-body");
        if (scroller) {
          const bounds = scroller.getBoundingClientRect();
          const top = bounds.top;
          const paginationBounds = paginationRef.current?.getBoundingClientRect();
          const bottom = paginationBounds?.height
            ? Math.min(bounds.bottom, paginationBounds.top)
            : bounds.bottom;
          if (held.clientY < top + 56) scroller.scrollTop -= 16;
          else if (held.clientY > bottom - 56) scroller.scrollTop += 16;
          const insideY = Math.min(Math.max(held.clientY, top), bottom - 1);
          const next = sortIdsForPoint(insideY, held.id);
          if (next) {
            sortIdsRef.current = next;
            setSortIds(next);
          }
        }
        held.raf = requestAnimationFrame(step);
      };
      held.raf = requestAnimationFrame(step);
    }
    const next = sortIdsForPoint(event.clientY, held.id);
    if (!next) return;
    sortIdsRef.current = next;
    setSortIds(next);
  };

  const armSortClickSuppress = (id: string) => {
    if (suppressDragClick.current) window.clearTimeout(suppressDragClick.current.timer);
    const record: { id: string; timer: number } = { id, timer: 0 };
    record.timer = window.setTimeout(() => {
      suppressDragClick.current = null;
    }, 0);
    suppressDragClick.current = record;
  };

  const finishPointerGrab = (event: React.PointerEvent<HTMLButtonElement>, cancel = false) => {
    const held = drag.current;
    if (!held || held.pointerId !== event.pointerId) return;
    const moved = held.moved || Math.abs(event.clientY - held.startY) >= 8;
    endDragGesture(held);
    if (!moved) return;
    if (cancel || !inputEnabledRef.current) {
      cancelSortPreview();
      return;
    }
    if (grabbed && grabbed !== held.id) cancelSortPreview();
    if (!held.moved && grabbed !== held.id) {
      sortOrigin.current = sortIdsRef.current;
      setGrabbed(held.id);
    }
    const next = sortIdsForPoint(event.clientY, held.id);
    if (next) {
      sortIdsRef.current = next;
      setSortIds(next);
    }
    armSortClickSuppress(held.id);
    commitPlacement(sortIdsRef.current, held.id);
  };

  const returnToCategories = useCallback(() => {
    const snapshot = categoryBrowseSnapshot.current;
    categoryBrowseSnapshot.current = null;
    setScope("categories");
    setCategoryKey("");
    setQuery(snapshot?.query ?? "");
    setAppliedQuery(snapshot?.appliedQuery ?? "");
    setSearching(snapshot?.searching ?? false);
    setPage(snapshot?.page ?? 0);
  }, []);

  const focusTabContent = useCallback(() => {
    orderButton.current?.focus({ preventScroll: true });
  }, []);
  const selectContentKind = (next: "live" | "movie" | "series", enterContent = false) => {
    if (!navigation.inputEnabled) return;
    if (next === selectedKind) {
      if (enterContent) {
        if (kindChanging) pendingKindFocus.current = true;
        else focusTabContent();
      }
      return;
    }
    setSelectedKind(next);
    pendingKindFocus.current = enterContent;
    if (next === kind) {
      kindTransition.cancel();
      if (enterContent) focusTabContent();
      return;
    }
    kindTransition.navigate(() => {
      if (!context.isCurrent()) return;
      setKind(next);
      setPage(0);
    });
  };
  useLayoutEffect(() => {
    if (kindTransition.phase === "idle") setSelectedKind(kind);
  }, [kindTransition.phase, kind]);
  useLayoutEffect(() => {
    if (
      !pendingKindFocus.current ||
      !navigation.focusReady ||
      kindTransition.phase === "leaving"
    )
      return;
    pendingKindFocus.current = false;
    if (context.isCurrent()) focusTabContent();
  }, [context, kind, navigation.focusReady, kindTransition.phase, focusTabContent]);
  useLayoutEffect(() => {
    if (navigation.surfaceInputEnabled) return;
    pendingKindFocus.current = false;
    kindTransition.cancel();
  }, [navigation.surfaceInputEnabled, kindTransition.cancel]);

  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  useRemote((code, event) => {
    if (!navigation.inputEnabled) return;
    if (
      kindChanging &&
      tabContentRef.current?.contains(document.activeElement) &&
      [KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER].includes(code as never)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (creatingCategory) {
      const active = document.activeElement;
      if (code === inlineEnd && active === createInput.current && !personalName.trim()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        createCancelButton.current?.focus();
        return;
      }
    }
    if (creatingCategory && [KEY.BACK, KEY.ESC].includes(code as never)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeCreate();
      return;
    }
    if (searching && !sorting) {
      const active = document.activeElement;
      const inField = active === searchInput.current;
      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (inField) {
          searchInput.current?.blur();
          searchButton.current?.focus({ preventScroll: true });
        } else {
          closeSearch();
        }
        return;
      }
      if (inField && code === KEY.ENTER) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (inField && code === KEY.DOWN) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const target =
          managerRef.current?.querySelector<HTMLElement>(
            ".lineup-manager-list button, .lineup-manager-list [tabindex='0']",
          ) ?? searchButton.current;
        target?.focus({ preventScroll: true });
        return;
      }
    }
    if (sorting && [KEY.BACK, KEY.ESC].includes(code as never)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!inputEnabledRef.current) return;
      requestModeBack();
      return;
    }
    if (sorting && code === inlineStart) {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.closest(".lineup-manager-list") ||
          active.closest('[data-lineup-action="search"]')) &&
        focusEdgeBack(active)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (!sorting) {
      const active = document.activeElement;
      if (showContentTabs && active instanceof HTMLElement) {
        const inTabs = !!kindStripRef.current?.contains(active);
        if (inTabs && (code === KEY.UP || code === KEY.DOWN)) {
          const tabs = Array.from(
            kindStripRef.current!.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
          );
          const at = tabs.indexOf(active as HTMLButtonElement);
          const next = Math.max(
            0,
            Math.min(tabs.length - 1, at + (code === KEY.DOWN ? 1 : -1)),
          );
          event.preventDefault();
          event.stopImmediatePropagation();
          tabs[next]?.focus({ preventScroll: true });
          return;
        }
        if (inTabs && code === inlineStart && focusEdgeBack(active)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (inTabs && code === inlineEnd) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const next = availableKinds.find(
            (section) => active.id === `${tabPanelId}-${section}`,
          );
          if (next) selectContentKind(next, true);
          return;
        }
        const textControl =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active.isContentEditable;
        if (code === inlineStart && !textControl && tabContentRef.current?.contains(active)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!moveTabContent(code)) {
            kindStripRef.current
              ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
              ?.focus({ preventScroll: true });
          }
          return;
        }
      }
      return;
    }
    if (code !== KEY.UP && code !== KEY.DOWN) return;
    const active = document.activeElement;
    if (
      code === KEY.DOWN &&
      active instanceof HTMLElement &&
      active.matches("[data-lineup-reset-order]") &&
      managerRef.current?.contains(active)
    ) {
      const first = managerRef.current.querySelector<HTMLButtonElement>(".lineup-sort-row");
      if (first) {
        event.preventDefault();
        event.stopImmediatePropagation();
        first.focus({ preventScroll: true });
        revealSortRow(first, true);
      }
      return;
    }
    if (active instanceof HTMLElement && paginationRef.current?.contains(active)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (code === KEY.UP) {
        const sortRows = Array.from(
          managerRef.current?.querySelectorAll<HTMLButtonElement>(".lineup-sort-row") ?? [],
        );
        const target =
          sortRows.find((row) => row.dataset.sortId === grabbed) ??
          sortRows[sortRows.length - 1];
        if (target) {
          target.focus({ preventScroll: true });
          revealSortRow(target, target === sortRows[0]);
        }
      }
      return;
    }
    if (
      !(active instanceof HTMLButtonElement) ||
      !active.classList.contains("lineup-sort-row") ||
      !managerRef.current?.contains(active)
    )
      return;
    if (grabbed && active.dataset.sortId === grabbed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = code === KEY.UP ? -1 : 1;
      if (!moveGrabbed(delta)) {
        if (delta < 0) revealSortRow(active, true);
        else focusSortPagination();
      }
      return;
    }
    const sortRows = Array.from(
      managerRef.current.querySelectorAll<HTMLButtonElement>(".lineup-sort-row:not(:disabled)"),
    );
    const at = sortRows.indexOf(active);
    const next = sortRows[at + (code === KEY.UP ? -1 : 1)];
    if (at < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!next) {
      if (code === KEY.UP && !grabbed) {
        managerRef.current
          .querySelector<HTMLButtonElement>("[data-lineup-reset-order]")
          ?.focus({ preventScroll: true });
        revealSortRow(active, true);
        return;
      }
      if (code === KEY.UP) revealSortRow(active, true);
      else focusSortPagination();
      return;
    }
    next.focus({ preventScroll: true });
    revealSortRow(next, next === sortRows[0]);
  }, true);

  const editorDialog = editing ? (
    <SettingsDialog
      title={t(editing.kind === "channel" ? "lineup.editChannel" : "lineup.renameCategory")}
      inputEnabled={navigation.surfaceInputEnabled && !confirmingPersonal}
      onClose={closeEdit}
      busy={editBusy}
      onSave={() => void saveEdit()}
      saveLabel={problem ? t("remote.retry") : undefined}
      footerStart={
        editing.kind === "channel" || !editing.value.personal ? (
          <button
            type="button"
            className="btn tonal lineup-reset-action lineup-edit-reset"
            disabled={editBusy}
            onClick={resetEditDraft}
          >
            <Icon name="refresh" />
            <span>{t("lineup.resetDetails")}</span>
          </button>
        ) : undefined
      }
    >
      <div className="lineup-edit-form form">
        <div className="lineup-edit-origin">
          {editing.kind === "channel" ? (
            <p className="lineup-edit-provider" role="note">
              <span dir="ltr" className="lineup-channel-number">
                {number(editing.value.providerNumber)}
              </span>
              <span dir="auto">
                <Text value={editing.value.providerName} />
              </span>
            </p>
          ) : (
            <p className="lineup-edit-provider lineup-edit-provider-category" role="note">
              <Text value={editing.value.providerName} />
            </p>
          )}
        </div>
        {editing.kind === "channel" ? (
          <div className="lineup-edit-fields">
            <div className="lineup-edit-field">
              <label htmlFor="lineup-number">{t("lineup.number")}</label>
              <TextInput
                id="lineup-number"
                variant="compact"
                inputMode="numeric"
                dir="ltr"
                disabled={editBusy}
                value={numberDraft}
                onChange={(event) => setNumberDraft(event.target.value)}
              />
            </div>
            <div className="lineup-edit-field">
              <label htmlFor="lineup-name">{t("lineup.name")}</label>
              <TextInput
                id="lineup-name"
                variant="compact"
                data-settings-detail-first
                dir="auto"
                disabled={editBusy}
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="lineup-edit-field">
            <label htmlFor="lineup-name">{t("lineup.customName")}</label>
            <TextInput
              id="lineup-name"
              variant="compact"
              data-settings-detail-first
              dir="auto"
              disabled={editBusy}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </div>
        )}
        {editing.kind === "channel" && personalCategories.length > 0 && (
          <fieldset className="lineup-memberships">
            <legend>{t("lineup.personalCategories")}</legend>
            {personalCategories.map((category) => {
              const id = category.key.slice("personal:".length);
              return (
                <label key={category.key}>
                  <input
                    type="checkbox"
                    disabled={editBusy}
                    checked={membershipDraft.includes(id)}
                    onChange={(event) =>
                      setMembershipDraft((current) =>
                        event.target.checked
                          ? [...current.filter((item) => item !== id), id]
                          : current.filter((item) => item !== id),
                      )
                    }
                  />
                  <Text value={category.name} />
                </label>
              );
            })}
          </fieldset>
        )}
        {CUSTOM_CATEGORIES_ENABLED && editing.kind === "category" && editing.value.personal && (
          <button
            type="button"
            className="btn tonal danger"
            onClick={() => {
              setConfirmingPersonal(editing.value.key.slice("personal:".length));
              onAsking(true);
            }}
          >
            <Icon name="remove" />
            <span>{t("lineup.deletePersonalCategory")}</span>
          </button>
        )}
        {problem && (
          <p className="field-problem" role="alert">
            {problem}
          </p>
        )}
        {confirmingPersonal && (
          <Confirm
            title={t("lineup.deletePersonalQuestion")}
            body={t("lineup.deletePersonalBody")}
            confirmLabel={t("common.remove")}
            cancelLabel={t("common.cancel")}
            destructive
            onCancel={() => {
              setConfirmingPersonal("");
            }}
            onConfirm={async () => {
              const result = await applyOwnedMutation(useLineup.getState().revision, {
                type: "personal-category.delete",
                categoryId: confirmingPersonal,
              });
              if (!result.ok) {
                setProblem(t("lineup.persistenceFailed"));
                notifyPersistenceFailure();
                return;
              }
              setConfirmingPersonal("");
              setScope("categories");
              setCategoryKey("");
              setPage(0);
              closeEdit();
            }}
          />
        )}
      </div>
    </SettingsDialog>
  ) : null;

  const orderDialogContext = `${playlist.name} · ${
    scope === "categories" ? sectionLabel : activeCategory?.name || sectionLabel
  }`;
  const orderDialogEl =
    orderDialog && orderScope && orderDialog === orderScope.key ? (
      <SettingsDialog
        title={orderScope.title}
        inputEnabled={navigation.surfaceInputEnabled}
        onClose={closeOrderDialog}
        footerStart={
          <button
            type="button"
            className="btn tonal lineup-reset-action lineup-order-reset"
            data-lineup-reset-order
            onClick={resetOrder}
          >
            <Icon name="refresh" />
            <span>{t("lineup.resetDetails")}</span>
          </button>
        }
      >
        <div className="lineup-order-dialog" data-lineup-order-dialog>
          <p className="sheet-lead settings-detail-context">
            <Text value={orderDialogContext} />
          </p>
          <div className="lineup-order-options" role="listbox" aria-label={orderScope.title}>
            {orderScope.options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={orderScope.mode === option.value}
                className="lineup-order-option management-row-single"
                data-lineup-order-option={option.value}
                data-settings-detail-first={orderScope.mode === option.value ? true : undefined}
                onClick={() => selectOrderMode(option.value)}
              >
                <span className="lineup-preference-main">
                  <span className="lineup-preference-label">{option.label}</span>
                </span>
                {orderScope.mode === option.value && (
                  <span className="lineup-order-check" aria-hidden="true">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </SettingsDialog>
    ) : null;

  const dedicatedMode = sorting;
  const showContentTabs = scope === "categories" && availableKinds.length > 1 && !dedicatedMode;
  const crumbItems = [
    { label: t("settings.playlists") },
    { label: playlist.name, auto: true },
    { label: t("lineup.contentManagement", { kind: sectionLabel }) },
    ...(scope === "channels" && activeCategory
      ? [{ label: activeCategory.name, auto: true }]
      : []),
  ];
  const pageHeading =
    scope === "channels" ? (activeCategory?.name ?? sectionLabel) : playlist.name;
  const pageDescription =
    scope === "categories" && !dedicatedMode ? t("lineup.manageContentHint") : undefined;

  useLayoutEffect(() => {
    const strip = kindStripRef.current;
    if (!showContentTabs || !strip) {
      setKindInk(null);
      return;
    }
    const measure = () => {
      const selected = strip.querySelector<HTMLElement>(
        '.category-kind-option[aria-selected="true"]',
      );
      const label = selected?.querySelector<HTMLElement>(".category-kind-label");
      if (!selected || !label) {
        setKindInk(null);
        return;
      }
      const stripRect = strip.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const y = labelRect.top - stripRect.top + strip.scrollTop - 2;
      const height = labelRect.height + 4;
      setKindInk((current) =>
        current && current.y === y && current.height === height ? current : { y, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    const selected = strip.querySelector<HTMLElement>(
      '.category-kind-option[aria-selected="true"]',
    );
    const label = selected?.querySelector<HTMLElement>(".category-kind-label");
    if (label) observer.observe(label);
    return () => observer.disconnect();
  }, [selectedKind, showContentTabs, t, availableKinds]);

  const openCategory = (category: ManagedCategory, returnFocus?: string) => {
    navigation.transition(() => {
      if (!context.isCurrent()) return;
      categoryBrowseSnapshot.current = {
        page: currentPage,
        query,
        appliedQuery,
        searching,
      };
      setSearching(false);
      setCategoryKey(category.key);
      setScope("channels");
      setQuery("");
      setAppliedQuery("");
      setPage(0);
      if (category.kind !== "live") void library.loadCategory(category.kind, category.key);
      navigation.open(
        `lineup-category-${category.key}`,
        category.name,
        returnFocus ?? `lineup-open-${category.key}`,
        returnToCategories,
      );
    });
  };

  const renderChannelName = (channel: ManagedChannel) => (
    <span className="lineup-channel-label">
      <span
        className="lineup-channel-number"
        dir="ltr"
        role="img"
        aria-label={`${t("lineup.channelNumber")}, ${channel.effective.number}`}
      >
        {number(channel.effective.number)}
      </span>
      <Text className="lineup-channel-name" value={channel.effective.name} />
    </span>
  );

  const pagination =
    pages > 1 ? (
      <nav
        ref={paginationRef}
        className={`lineup-pagination${sorting ? " lineup-sort-pagination" : ""}`}
        aria-label={pageHeading}
      >
        <button
          type="button"
          className="btn tonal"
          data-lineup-page="previous"
          disabled={currentPage === 0}
          onClick={() => goToPage(currentPage - 1)}
        >
          <span>{t("common.previous")}</span>
        </button>
        <span aria-live="polite" aria-atomic="true">
          {t("lineup.page", { current: currentPage + 1, total: pages })}
        </span>
        <button
          type="button"
          className="btn tonal"
          data-lineup-page="next"
          disabled={currentPage === pages - 1}
          onClick={() => goToPage(currentPage + 1)}
        >
          <span>{t("common.next")}</span>
        </button>
      </nav>
    ) : null;

  return (
    <div
      ref={managerRef}
      className="lineup-manager"
      style={{ "--lineup-number-width": channelNumberWidth } as React.CSSProperties}
      data-lineup-mode={sorting ? "reorder" : "browse"}
      data-lineup-scope={scope}
    >
      <SettingsBreadcrumbs items={crumbItems} />
      {!dedicatedMode && <PageHeader title={pageHeading} description={pageDescription} auto />}
      <div className={showContentTabs ? "lineup-layout lineup-layout-tabbed" : "lineup-layout"}>
        {showContentTabs && (
          <section className="lineup-context-group" aria-label={t("lineup.contentContext")}>
            <div
              ref={kindStripRef}
              className="category-kind-selector"
              role="tablist"
              aria-orientation="vertical"
              aria-label={t("lineup.contentContext")}
            >
              {availableKinds.map((section) => {
                return (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    id={`${tabPanelId}-${section}`}
                    aria-controls={tabPanelId}
                    className="category-kind-option"
                    aria-selected={selectedKind === section}
                    data-settings-detail-first={selectedKind === section ? true : undefined}
                    data-ok-guide={t("lineup.selectContentType")}
                    onClick={() => selectContentKind(section)}
                  >
                    <span className="category-kind-label">
                      <Icon
                        name={
                          section === "live" ? "tv" : section === "movie" ? "movie" : "series"
                        }
                      />
                      <span>
                        {t(
                          section === "live"
                            ? "content.live"
                            : section === "movie"
                              ? "content.movies"
                              : "content.series",
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
              {kindInk && (
                <span
                  className="category-kind-ink"
                  aria-hidden="true"
                  style={{
                    transform: `translateY(${kindInk.y}px)`,
                    height: `${kindInk.height}px`,
                  }}
                />
              )}
            </div>
          </section>
        )}
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: The tab role and its label are enabled together. */}
        <div
          ref={tabContentRef}
          className={showContentTabs ? "lineup-tab-pane lineup-tab-content" : "lineup-tab-pane"}
          id={showContentTabs ? tabPanelId : undefined}
          role={showContentTabs ? "tabpanel" : undefined}
          aria-labelledby={showContentTabs ? `${tabPanelId}-${selectedKind}` : undefined}
          aria-busy={kindTransition.phase !== "idle" || undefined}
          onClickCapture={(event) => {
            if (!kindChanging) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div className="lineup-content">
            {retryMutation.current && (
              <div className="lineup-recovery">
                <button
                  type="button"
                  className="btn tonal"
                  disabled={lineup.saving}
                  onClick={() =>
                    retryMutation.current && void commitMutation(retryMutation.current)
                  }
                >
                  <span>{t("lineup.retrySave")}</span>
                </button>
              </div>
            )}
            {!dedicatedMode && orderScope && (
              <div className="lineup-order-settings" data-lineup-preferences>
                <div className="lineup-order-attach">
                  <button
                    ref={orderButton}
                    type="button"
                    className="lineup-preference management-row-single"
                    data-lineup-preference="order"
                    data-settings-focus="lineup-preference-order"
                    onClick={openOrderDialog}
                  >
                    <span className="lineup-preference-leading" aria-hidden="true">
                      <Icon name="sort" />
                    </span>
                    <span className="lineup-preference-main">
                      <span className="lineup-preference-label">
                        {orderScope.preferenceLabel}
                      </span>
                      <span className="lineup-preference-value">
                        {orderScope.options.find((option) => option.value === orderScope.mode)
                          ?.label ?? ""}
                      </span>
                    </span>
                    <span className="lineup-preference-icon" aria-hidden="true">
                      <Icon name="chevronRight" logicalDirection />
                    </span>
                  </button>
                  {orderScope.mode === "custom" && (
                    <>
                      <span className="lineup-order-divider" aria-hidden="true" />
                      <button
                        ref={customOrderButton}
                        type="button"
                        className="lineup-custom-order management-row-single"
                        data-lineup-preference="custom-order"
                        data-settings-focus="lineup-preference-custom-order"
                        disabled={!sectionItemCount}
                        onClick={enterSort}
                      >
                        <span className="lineup-preference-leading" aria-hidden="true">
                          <Icon name="edit" />
                        </span>
                        <span>{t("lineup.editCustomOrder")}</span>
                      </button>
                    </>
                  )}
                </div>
                {CUSTOM_CATEGORIES_ENABLED && scope === "categories" && kind === "live" && (
                  <button
                    type="button"
                    className="lineup-preference lineup-preference-create management-row-single"
                    data-lineup-create-category
                    disabled={lineup.saving}
                    onClick={() => setCreatingCategory(true)}
                  >
                    <span className="lineup-preference-main">
                      <span className="lineup-preference-label">
                        {t("lineup.createPersonalCategory")}
                      </span>
                    </span>
                  </button>
                )}
              </div>
            )}
            <SettingsListHeader
              className="lineup-list-header"
              headingLevel={dedicatedMode ? 3 : 4}
              title={t(
                sorting
                  ? "lineup.sort"
                  : scope === "categories"
                    ? "lineup.categories"
                    : kind === "live"
                      ? "lineup.channels"
                      : "lineup.items",
              )}
              count={
                sorting
                  ? number(sortIds.length)
                  : resultsLoading || resultsFailed
                    ? undefined
                    : number(rows.length)
              }
            >
              {!sorting && (
                <div className="lineup-header-actions">
                  <button
                    ref={searchButton}
                    type="button"
                    className="btn tonal"
                    data-lineup-action="search"
                    aria-label={t(searchLabelKey)}
                    aria-expanded={searching}
                    onClick={toggleSearch}
                  >
                    <Icon name="search" />
                    <span>{t("common.search")}</span>
                  </button>
                  {visibilitySupported && sectionItemCount > 0 && (
                    <>
                      <button
                        type="button"
                        className="btn tonal"
                        data-lineup-bulk="show"
                        aria-label={t("lineup.showAllItems")}
                        title={t("lineup.showAllItems")}
                        onClick={showAllItems}
                      >
                        <Icon name="visible" />
                        <span>{t("lineup.showAllItems")}</span>
                      </button>
                      <button
                        type="button"
                        className="btn tonal"
                        data-lineup-bulk="hide"
                        aria-label={t("lineup.hideAllItems")}
                        title={t("lineup.hideAllItems")}
                        onClick={hideAllItems}
                      >
                        <Icon name="hidden" />
                        <span>{t("lineup.hideAllItems")}</span>
                      </button>
                    </>
                  )}
                </div>
              )}
              {sorting && (
                <div className="lineup-header-actions">
                  <button
                    type="button"
                    className="btn tonal lineup-reset-action lineup-order-reset"
                    data-lineup-reset-order
                    data-settings-focus="lineup-reset-order"
                    onClick={resetOrder}
                  >
                    <Icon name="refresh" />
                    <span>{t("lineup.resetDetails")}</span>
                  </button>
                </div>
              )}
            </SettingsListHeader>
            {searching && !sorting && (
              <div className="lineup-search-field">
                <TextInput
                  ref={searchInput}
                  className="lineup-search-input"
                  variant="compact"
                  aria-label={t(searchLabelKey)}
                  placeholder={t(searchLabelKey)}
                  autoFocus
                  value={query}
                  dir="auto"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(0);
                  }}
                />
              </div>
            )}
            {CUSTOM_CATEGORIES_ENABLED &&
              scope === "categories" &&
              kind === "live" &&
              !dedicatedMode && (
                <div
                  className={`lineup-create-dock ${creatingCategory ? "open" : ""}`.trim()}
                  aria-hidden={!creatingCategory}
                >
                  <div className="lineup-create-dock-inner">
                    <TextInput
                      ref={createInput}
                      className="lineup-create-input"
                      variant="compact"
                      aria-label={t("lineup.personalCategoryName")}
                      placeholder={t("lineup.personalCategoryName")}
                      tabIndex={creatingCategory ? 0 : -1}
                      dir="auto"
                      value={personalName}
                      onChange={(event) => setPersonalName(event.target.value)}
                    />
                    <div className="lineup-create-actions">
                      <button
                        type="button"
                        className="btn filled"
                        disabled={lineup.saving || !personalName.trim()}
                        tabIndex={creatingCategory ? 0 : -1}
                        onClick={() => void createCategory()}
                      >
                        <span>{t("lineup.createPersonalCategory")}</span>
                      </button>
                      <button
                        ref={createCancelButton}
                        type="button"
                        className="btn tonal"
                        tabIndex={creatingCategory ? 0 : -1}
                        onClick={closeCreate}
                      >
                        <span>{t("common.cancel")}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            {sorting && <p className="lineup-reorder-help">{t("remote.lineupReorderHelp")}</p>}
            <div
              className={`lineup-manager-results${contentResource ? " vod" : ""}${sorting ? " sorting" : ""}`}
              aria-busy={resultsLoading || undefined}
            >
              <div className={`lineup-manager-list${sorting ? " sorting" : ""}`}>
                {sorting
                  ? shownSortIds.map((id, index) => {
                      const channel =
                        scope === "channels" && kind === "live"
                          ? lineup.managedChannels.find((item) => item.ref.id === id)
                          : undefined;
                      const category = lineup.managedCategories.find((item) => item.key === id);
                      const libraryItem =
                        kind === "live"
                          ? undefined
                          : library
                              .itemsFor(kind, categoryKey)
                              .value.find((item) => item.key === id);
                      const label =
                        channel?.effective.name ?? category?.name ?? libraryItem?.name ?? id;
                      const sortLabel = channel ? (
                        renderChannelName(channel)
                      ) : (
                        <Text value={label} />
                      );
                      const sortAria = channel
                        ? `${number(channel.effective.number)} ${label}, ${t(grabbed ? "lineup.release" : "lineup.grab")}`
                        : `${label}, ${t(grabbed ? "lineup.release" : "lineup.grab")}`;
                      return (
                        <div
                          key={id}
                          className={`lineup-sort-item ${grabbed === id ? "grabbed" : ""}`}
                          data-lineup-sort-motion={id}
                        >
                          <button
                            type="button"
                            className={`lineup-manager-row lineup-sort-row ${grabbed === id ? "grabbed" : ""}`}
                            data-settings-detail-first={index === 0 ? true : undefined}
                            aria-label={sortAria}
                            data-ok-guide={t(grabbed ? "lineup.release" : "lineup.grab")}
                            aria-pressed={grabbed === id}
                            data-sort-id={id}
                            onPointerDown={(event) => {
                              if (event.button !== 0 || !inputEnabledRef.current) return;
                              event.currentTarget.focus({ preventScroll: true });
                              if (suppressDragClick.current) {
                                window.clearTimeout(suppressDragClick.current.timer);
                                suppressDragClick.current = null;
                              }
                              const previous = drag.current;
                              if (previous) {
                                endDragGesture(previous);
                                if (previous.moved) cancelSortPreview();
                              }
                              drag.current = {
                                pointerId: event.pointerId,
                                id,
                                startY: event.clientY,
                                clientY: event.clientY,
                                moved: false,
                                raf: 0,
                                node: event.currentTarget,
                              };
                              event.currentTarget.setPointerCapture?.(event.pointerId);
                            }}
                            onPointerMove={movePointerGrab}
                            onPointerUp={finishPointerGrab}
                            onPointerCancel={(event) => finishPointerGrab(event, true)}
                            onLostPointerCapture={(event) => finishPointerGrab(event, true)}
                            onClick={(event) => {
                              if (!inputEnabledRef.current) return;
                              const suppress = suppressDragClick.current;
                              if (suppress && suppress.id === id && event.detail !== 0) {
                                window.clearTimeout(suppress.timer);
                                suppressDragClick.current = null;
                                return;
                              }
                              event.currentTarget.focus({ preventScroll: true });
                              if (!grabbed) {
                                sortOrigin.current = sortIdsRef.current;
                                setGrabbed(id);
                              } else if (grabbed === id) commitPlacement();
                              else {
                                const current = sortIdsRef.current;
                                const next = current.filter((item) => item !== grabbed);
                                next.splice(next.indexOf(id), 0, grabbed);
                                sortIdsRef.current = next;
                                setSortIds(next);
                                commitPlacement(next);
                              }
                            }}
                          >
                            <span className="lineup-sort-label">{sortLabel}</span>
                            <span className="lineup-sort-handle" aria-hidden="true">
                              <Icon name="sort" />
                            </span>
                          </button>
                        </div>
                      );
                    })
                  : shown.map((row, index) => {
                      if (scope === "channels" && kind !== "live") {
                        const item = row as LibraryItem;
                        return (
                          <div
                            key={item.key}
                            className="lineup-manager-row lineup-row management-row"
                          >
                            <button
                              type="button"
                              className="lineup-row-open management-row-primary"
                              data-settings-focus={`lineup-open-${item.key}`}
                              data-settings-detail-first={index === 0 ? true : undefined}
                              data-ok-guide={t("common.noAction")}
                              aria-label={`${t("common.noAction")}, ${item.name}`}
                              onClick={(event) => {
                                if (!inputEnabledRef.current) return;
                                event.currentTarget.focus({ preventScroll: true });
                                notifications.show(t("common.noAction"), "neutral");
                              }}
                            >
                              <span className="category-manager-main">
                                <Text value={item.name} />
                              </span>
                            </button>
                          </div>
                        );
                      }
                      const id =
                        scope === "channels"
                          ? (row as ManagedChannel).ref.id
                          : (row as ManagedCategory).key;
                      const label =
                        scope === "channels"
                          ? (row as ManagedChannel).effective.name
                          : (row as ManagedCategory).name;
                      const hidden = (row as ManagedChannel | ManagedCategory).hidden;
                      if (scope === "channels") {
                        const channel = row as ManagedChannel;
                        return (
                          <div
                            key={id}
                            className={`lineup-manager-row lineup-row management-row ${hidden ? "hidden" : ""}`}
                            data-lineup-provider-id={id}
                          >
                            <button
                              type="button"
                              className="lineup-channel-info management-row-primary"
                              data-settings-focus={`lineup-open-${id}`}
                              data-settings-detail-first={index === 0 ? true : undefined}
                              data-ok-guide={t("common.edit")}
                              aria-label={`${t("common.open")}, ${number(channel.effective.number)} ${label}`}
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                if (!inputEnabledRef.current) return;
                                event.currentTarget.focus({ preventScroll: true });
                                beginEdit({ kind: "channel", value: channel });
                              }}
                            >
                              <span className="category-manager-main">
                                {renderChannelName(channel)}
                                {channel.providerName !== label && (
                                  <span className="category-manager-meta management-row-meta">
                                    <Text value={channel.providerName} />
                                  </span>
                                )}
                              </span>
                              {hidden && (
                                <span className="lineup-row-hidden">{t("channel.hidden")}</span>
                              )}
                            </button>
                            {renameSupported && (
                              <button
                                type="button"
                                className="management-row-actions"
                                data-lineup-edit={id}
                                data-settings-focus={`lineup-edit-${id}`}
                                data-ok-guide={t("common.edit")}
                                aria-label={`${t("common.edit")}, ${number(channel.effective.number)} ${label}`}
                                onClick={(event) => {
                                  if (!inputEnabledRef.current) return;
                                  event.currentTarget.focus({ preventScroll: true });
                                  beginEdit({ kind: "channel", value: channel });
                                }}
                              >
                                <Icon name="edit" />
                              </button>
                            )}
                            {visibilitySupported && (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!hidden}
                                className="management-row-actions"
                                data-lineup-visibility={id}
                                data-settings-focus={`lineup-visibility-${id}`}
                                data-ok-guide={t(
                                  hidden ? "remote.lineupShow" : "remote.lineupHide",
                                )}
                                aria-label={`${number(channel.effective.number)} ${label}, ${t(
                                  hidden ? "channel.hidden" : "lineup.visible",
                                )}`}
                                onClick={(event) => {
                                  if (!inputEnabledRef.current) return;
                                  event.currentTarget.focus({ preventScroll: true });
                                  const state = useLineup.getState();
                                  const current = state.managedChannels.find(
                                    (item) => item.ref.id === id,
                                  );
                                  if (!current) return;
                                  void commitMutation({
                                    type: "channel.visibility",
                                    channel: current.ref,
                                    hidden: !current.hidden,
                                  });
                                }}
                              >
                                <Icon name={hidden ? "hidden" : "visible"} />
                              </button>
                            )}
                          </div>
                        );
                      }
                      const category = row as ManagedCategory;
                      const categoryCount =
                        category.kind === "live"
                          ? category.count
                          : (library.categories[category.kind].items.find(
                              (item) => item.key === category.key,
                            )?.count ?? category.count);
                      return (
                        <div
                          key={id}
                          className={`lineup-manager-row lineup-row management-row ${hidden ? "hidden" : ""}`}
                        >
                          <button
                            type="button"
                            className="lineup-row-open management-row-primary"
                            data-settings-focus={`lineup-open-${category.key}`}
                            data-settings-detail-first={
                              scope === "categories" && index === 0 ? true : undefined
                            }
                            data-ok-guide={t("common.open")}
                            aria-label={`${t("common.open")}, ${label}`}
                            onClick={() => {
                              if (!inputEnabledRef.current) return;
                              openCategory(category, `lineup-open-${category.key}`);
                            }}
                          >
                            <span className="category-manager-main">
                              <span className="lineup-category-label">
                                <Text className="lineup-category-name" value={label} />
                                {categoryCount !== undefined && (
                                  <span className="count">{number(categoryCount)}</span>
                                )}
                              </span>
                              {category.providerName !== label && (
                                <span className="category-manager-meta management-row-meta">
                                  <Text value={category.providerName} />
                                </span>
                              )}
                            </span>
                            {hidden && (
                              <span className="lineup-row-hidden">{t("channel.hidden")}</span>
                            )}
                          </button>
                          {renameSupported && (
                            <button
                              type="button"
                              className="management-row-actions"
                              data-lineup-edit={category.key}
                              data-settings-focus={`lineup-edit-${category.key}`}
                              data-ok-guide={t("common.edit")}
                              aria-label={`${t("common.edit")}, ${label}`}
                              onClick={(event) => {
                                if (!inputEnabledRef.current) return;
                                event.currentTarget.focus({ preventScroll: true });
                                beginEdit({ kind: "category", value: category });
                              }}
                            >
                              <Icon name="edit" />
                            </button>
                          )}
                          {visibilitySupported && (
                            <button
                              type="button"
                              role="switch"
                              aria-checked={!hidden}
                              className="management-row-actions"
                              data-lineup-visibility={category.key}
                              data-settings-focus={`lineup-visibility-${category.key}`}
                              data-ok-guide={t(
                                hidden ? "remote.lineupShow" : "remote.lineupHide",
                              )}
                              aria-label={`${label}, ${t(hidden ? "channel.hidden" : "lineup.visible")}`}
                              onClick={(event) => {
                                if (!inputEnabledRef.current) return;
                                event.currentTarget.focus({ preventScroll: true });
                                const state = useLineup.getState();
                                const current = state.managedCategories.find(
                                  (item) => item.key === category.key,
                                );
                                if (!current) return;
                                void commitMutation({
                                  type: "category.visibility",
                                  categoryKey: current.key,
                                  hidden: !current.hidden,
                                });
                              }}
                            >
                              <Icon name={hidden ? "hidden" : "visible"} />
                            </button>
                          )}
                        </div>
                      );
                    })}
              </div>
              {resultsLoading && (
                <div className="lineup-manager-pending" role="status">
                  <span className="spinner" aria-hidden="true" />
                  <span>{t("library.loading")}</span>
                </div>
              )}
              {resultsFailed && contentResource && (
                <div className="lineup-manager-failed" role="alert">
                  <p>
                    {t(contentResource.error === "too-large" ? "vod.tooLarge" : "vod.failed")}
                  </p>
                  <button
                    type="button"
                    className="btn tonal"
                    data-settings-focus={`lineup-retry-${categoryKey}`}
                    data-ok-guide={t("library.retry")}
                    onClick={(event) => {
                      if (!inputEnabledRef.current || !context.isCurrent()) return;
                      if (kind !== "movie" && kind !== "series") return;
                      if (!categoryKey) return;
                      event.currentTarget.focus({ preventScroll: true });
                      void library.loadCategory(kind, categoryKey);
                    }}
                  >
                    <span>{t("library.retry")}</span>
                  </button>
                </div>
              )}
              {!sorting && !shown.length && !resultsLoading && !resultsFailed && (
                <p className="sheet-lead" role="status">
                  {t("lineup.noMatches")}
                </p>
              )}
            </div>
            {!dedicatedMode && visibleUnavailable.length > 0 && (
              <section className="lineup-unavailable">
                <SettingsListHeader
                  title={t("lineup.unavailableTitle")}
                  count={number(visibleUnavailable.length)}
                />
                {visibleUnavailable.map((record) => (
                  <div className="lineup-unavailable-row management-row" key={record.key}>
                    <div className="lineup-unavailable-info management-row-static">
                      <span className="lineup-unavailable-main">
                        <Text value={record.label || record.itemId} />
                        <span className="management-row-meta">
                          {t(`lineup.unavailable.${record.kind}` as MessageKey)}
                        </span>
                      </span>
                    </div>
                    <button
                      type="button"
                      className="management-row-actions danger"
                      data-lineup-unavailable-remove={record.key}
                      data-settings-focus={`lineup-unavailable-${record.key}`}
                      data-ok-guide={t("common.remove")}
                      aria-label={`${t("common.remove")}, ${record.label || record.itemId}`}
                      title={t("common.remove")}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        if (!navigation.inputEnabled) return;
                        event.currentTarget.focus();
                        setConfirmingUnavailable(record.key);
                        onAsking(true);
                      }}
                    >
                      <Icon name="remove" />
                    </button>
                  </div>
                ))}
              </section>
            )}
            {confirmingUnavailable && (
              <Confirm
                title={t("lineup.removeUnavailableQuestion")}
                body={t("lineup.removeUnavailableBody")}
                confirmLabel={t("common.remove")}
                cancelLabel={t("common.cancel")}
                destructive
                onCancel={() => {
                  setConfirmingUnavailable("");
                  onAsking(false);
                }}
                onConfirm={async () => {
                  const result = await applyOwnedMutation(useLineup.getState().revision, {
                    type: "unavailable.remove",
                    key: confirmingUnavailable,
                  });
                  if (!result.ok) {
                    setProblem(t("lineup.persistenceFailed"));
                    notifyPersistenceFailure();
                    return;
                  }
                  setConfirmingUnavailable("");
                  onAsking(false);
                }}
              />
            )}
            {pagination}
          </div>
          {showContentTabs && (
            <ContentTransitionShade
              phase={kindTransition.phase}
              onTransitionEnd={kindTransition.onTransitionEnd}
            />
          )}
        </div>
      </div>
      {editorDialog}
      {orderDialogEl}
    </div>
  );
}
