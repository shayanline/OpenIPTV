import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { KEY, useRemote } from "../../hooks/useRemote";
import { useLocale } from "../../hooks/useLocale";
import { useToast } from "../../hooks/useToast";
import { useLayoutTask } from "../../hooks/useLayoutTask";
import { useSettings, type Playlist } from "../../stores/settings";
import { clearPlaylistCache, type LoadResult, useChannels } from "../../stores/channels";
import { useLineup } from "../../stores/lineup";
import {
  nameFromUrl,
  parseXtreamTemplateUrl,
  sourceDisplay,
  type XtreamOutput,
  type PlaylistSourceField,
  type PlaylistSourceProblems,
  validatePlaylistSource,
  xtreamFromServerField,
} from "../../services/playlistUrl";
import type { MessageKey } from "../../services/locale";
import { acquireManagementContext } from "../../services/lineupManagement";
import { forgetRepairSource } from "../../services/repair";
import type { XtreamAccount } from "../../services/xtream";
import { Confirm } from "../Confirm";
import { Icon } from "../Icon";
import { OptionPicker } from "../OptionPicker";
import { TextInput } from "../TextInput";
import type { SettingsDetailNavigation } from "../Settings";
import { SettingsListHeader } from "./Field";
import { ActionMenu } from "./ActionMenu";
import { ContentSettings } from "./ContentSettings";
import { LineupManager } from "./LineupManager";
import { SettingsDialog } from "./SettingsDialog";

function AccountBadge({ account }: { account: XtreamAccount }) {
  const { t } = useLocale();
  const status = account.status.toLowerCase();
  const expired =
    status === "expired" ||
    (!!account.expiresAt && account.expiresAt <= Math.floor(Date.now() / 1000));
  const inactive = status !== "active";
  if (!expired && !inactive && !account.isTrial) return null;
  const label = expired
    ? t("playlist.accountExpired")
    : inactive
      ? t("playlist.accountInactive")
      : "";
  return (
    <span
      className={`tag playlist-state-tag ${expired || inactive ? "playlist-state-unavailable" : ""}`}
    >
      {label}
      {account.isTrial ? `${label ? " " : ""}${t("playlist.accountTrial")}` : ""}
    </span>
  );
}

function AccountStatus({ account }: { account: XtreamAccount }) {
  const { t, locale, number } = useLocale();
  const connections =
    account.activeConnections === undefined
      ? ""
      : account.maxConnections !== undefined && account.maxConnections > 0
        ? t("playlist.accountConnectionsCompact", {
            active: number(account.activeConnections),
            maximum: number(account.maxConnections),
          })
        : t("playlist.accountConnectionsOnly", {
            active: number(account.activeConnections),
            total: account.activeConnections,
          });
  return (
    <span className="playlist-account-status management-row-meta">
      <span>
        {account.expiresAt
          ? t("playlist.accountExpires", {
              date: new Date(account.expiresAt * 1000).toLocaleDateString(locale),
            })
          : t("playlist.accountExpiryUnknown")}
      </span>
      {connections && <span>{connections}</span>}
    </span>
  );
}

const PAGE_SIZE = 6;

function replacesSourceAccount(left: Playlist["source"], right: Playlist["source"]): boolean {
  return (
    left.kind !== right.kind ||
    (left.kind === "xtream" &&
      right.kind === "xtream" &&
      (left.server !== right.server || left.username !== right.username))
  );
}

export function Playlists({
  onAsking,
  navigation,
  recoveryPlaylistId,
  recoveryError,
  onError,
  onSuccess,
  onClearFeedback,
}: {
  onAsking: (asking: boolean, restoreFocus?: boolean) => void;
  navigation: SettingsDetailNavigation;
  recoveryPlaylistId?: string;
  recoveryError?: string;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onClearFeedback?: () => void;
}) {
  const { t, locale, number } = useLocale();
  const s = useSettings();
  const {
    load,
    activatePlaylist,
    validatePlaylist,
    loading,
    error,
    errorKey,
    errorDetail,
    accounts,
  } = useChannels();
  const errorText = (
    key: MessageKey | "" | undefined,
    detail: string | undefined,
    fallback: string,
  ) => (key ? t(key, { detail: detail ?? "" }) : fallback);
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [source, setSource] = useState<"m3u" | "xtream">("m3u");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [output, setOutput] = useState<XtreamOutput>("m3u8");
  const [problems, setProblems] = useState<PlaylistSourceProblems>({});
  const [dismissedXtreamUrl, setDismissedXtreamUrl] = useState("");
  const suggestedXtream =
    source === "m3u" && url !== dismissedXtreamUrl ? parseXtreamTemplateUrl(url, "m3u8") : null;
  /** Which playlist has been asked about but not yet confirmed for removal. */
  const [confirming, setConfirming] = useState("");
  const [managing, setManaging] = useState("");
  const [menuFor, setMenuFor] = useState("");
  const menuReturn = useRef<HTMLElement | null>(null);
  const [resetting, setResetting] = useState<Playlist | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [resetProblem, setResetProblem] = useState(false);
  const resetRun = useRef<AbortController | null>(null);
  const [rowRefresh, setRowRefresh] = useState<
    Record<string, { busy: boolean; error: string }>
  >({});
  const rowBusy = useRef(new Set<string>());
  const inputEnabledRef = useRef(navigation.inputEnabled);
  inputEnabledRef.current = navigation.inputEnabled;
  const surfaceInputEnabledRef = useRef(navigation.surfaceInputEnabled);
  surfaceInputEnabledRef.current = navigation.surfaceInputEnabled;
  const queueLayoutTask = useLayoutTask();
  const [page, setPage] = useState(0);
  const pendingPageFocus = useRef(false);
  const [listOpen, setListOpen] = useState(() => !!recoveryPlaylistId);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery("");
    setPage(0);
    queueLayoutTask(() => {
      if (inputEnabledRef.current) searchButton.current?.focus({ preventScroll: true });
    });
  }, [queueLayoutTask]);
  const [operation, setOperation] = useState<"idle" | "validating" | "saving" | "failure">(
    "idle",
  );
  const operationRef = useRef({ token: 0, busy: false });
  const validationRun = useRef<AbortController | null>(null);
  const xtreamButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const operationBusy = operation === "validating" || operation === "saving";
  const lineupOwner = useLineup((state) => state.playlistId);
  const needle = query.trim().toLocaleLowerCase(locale);
  const filteredPlaylists = needle
    ? s.playlists.filter((playlist) => playlist.name.toLocaleLowerCase(locale).includes(needle))
    : s.playlists;
  const pages = Math.max(1, Math.ceil(filteredPlaylists.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const refreshNotice = useToast(
    `playlist-refresh:${listOpen}:${managing}:${currentPage}:${query}`,
    navigation.surfaceInputEnabled,
  );
  const refreshRuns = useRef(
    new Map<
      string,
      { sourceVersion: number | undefined; active: boolean; clear: () => void }
    >(),
  );
  useEffect(() => {
    const runs = refreshRuns.current;
    const unsubscribe = useSettings.subscribe((state) => {
      for (const [id, run] of runs) {
        if (
          (run.active && state.activePlaylistId !== id) ||
          !state.playlists.some(
            (playlist) => playlist.id === id && playlist.sourceVersion === run.sourceVersion,
          )
        ) {
          run.clear();
          runs.delete(id);
          rowBusy.current.delete(id);
          setRowRefresh((rows) => ({ ...rows, [id]: { busy: false, error: "" } }));
        }
      }
    });
    return () => {
      unsubscribe();
      for (const run of runs.values()) run.clear();
      runs.clear();
    };
  }, []);
  const visiblePlaylists = filteredPlaylists.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const goToPage = (wanted: number) => {
    if (!inputEnabledRef.current) return;
    const nextPage = Math.max(0, Math.min(pages - 1, wanted));
    if (nextPage === currentPage) return;
    pendingPageFocus.current = true;
    setPage(nextPage);
  };
  const activeLoadError = errorText(errorKey, errorDetail, error);
  const playlistError = (playlistId: string): string => {
    const row = rowRefresh[playlistId];
    if (row?.busy) return "";
    if (playlistId === s.activePlaylistId) return loading ? "" : activeLoadError;
    if (row) return row.error;
    if (playlistId === recoveryPlaylistId) return recoveryError || "";
    return "";
  };
  const playlistProgress = (playlist: Playlist): boolean =>
    !!rowRefresh[playlist.id]?.busy || (playlist.id === s.activePlaylistId && loading);
  const playlistUsable = (playlist: Playlist): boolean =>
    playlist.id === s.activePlaylistId && lineupOwner === playlist.id && !loading;
  const playlistUnavailable = (playlist: Playlist): boolean =>
    playlistError(playlist.id) !== "" && !playlistUsable(playlist);
  const playlistSaved = (playlist: Playlist): boolean =>
    playlistError(playlist.id) !== "" && playlistUsable(playlist);
  const playlistPrimaryDisabled = (playlist: Playlist): boolean =>
    playlistProgress(playlist) || playlistUnavailable(playlist);
  const notifiedRef = useRef<{ playlistId: string; message: string } | null>(null);
  const operationMessage = useCallback(
    (name: string, detail: string) => t("playlist.operationFailed", { name, detail }),
    [t],
  );
  useEffect(() => {
    const activeId = s.activePlaylistId;
    const active = s.playlists.find((playlist) => playlist.id === activeId);
    if (!activeLoadError || !activeId || !active) {
      notifiedRef.current = null;
      return;
    }
    if (rowBusy.current.has(activeId) || operationRef.current.busy) return;
    const message = operationMessage(active.name, activeLoadError);
    const seen = notifiedRef.current;
    if (seen && seen.playlistId === activeId && seen.message === message) return;
    notifiedRef.current = { playlistId: activeId, message };
    onError(message);
  }, [activeLoadError, s.activePlaylistId, s.playlists, onError, operationMessage]);
  useEffect(() => {
    if (page >= pages) setPage(pages - 1);
  }, [page, pages]);
  useEffect(
    () => () => {
      operationRef.current.token += 1;
      operationRef.current.busy = false;
      validationRun.current?.abort();
      validationRun.current = null;
    },
    [],
  );

  const clearProblems = (field?: PlaylistSourceField) => {
    setProblems((current) => {
      if (!field) return {};
      const next = { ...current };
      delete next[field];
      return next;
    });
    onClearFeedback?.();
  };

  const ask = (id: string) => {
    if (rowBusy.current.has(id)) return;
    setConfirming(id);
    onAsking(!!id);
  };

  const startAdd = () => {
    operationRef.current.token += 1;
    operationRef.current.busy = false;
    setOperation("idle");
    setEditing(null);
    setAdding(true);
    setName("");
    setUrl("");
    setM3uUrl("");
    setSource("m3u");
    setServer("");
    setUsername("");
    setPassword("");
    setOutput("m3u8");
    clearProblems();
    setDismissedXtreamUrl("");
    addButton.current?.focus();
    onAsking(true);
  };
  const startEdit = (p: Playlist) => {
    if (rowBusy.current.has(p.id)) return;
    operationRef.current.token += 1;
    operationRef.current.busy = false;
    setOperation("idle");
    const xtream = p.source.kind === "xtream" ? p.source : null;
    const address = p.source.kind === "m3u" ? p.source.url : "";
    setEditing(p);
    setName(p.name);
    setUrl(address);
    setM3uUrl(address);
    setSource(p.source.kind);
    setServer(xtream?.server ?? "");
    setUsername(xtream?.username ?? "");
    setPassword(xtream?.password ?? "");
    setOutput(xtream?.output ?? "m3u8");
    clearProblems();
    setDismissedXtreamUrl("");
    onAsking(true);
  };

  const closeEdit = () => {
    onClearFeedback?.();
    validationRun.current?.abort();
    validationRun.current = null;
    setEditing(null);
    onAsking(false, true);
  };

  const closeAdd = () => {
    onClearFeedback?.();
    validationRun.current?.abort();
    validationRun.current = null;
    setAdding(false);
    onAsking(false, true);
  };

  const applyXtream = (next: NonNullable<typeof suggestedXtream>, focusSource = false) => {
    setSource("xtream");
    setServer(next.server);
    setUsername(next.username);
    setPassword(next.password);
    setOutput(next.output);
    clearProblems();
    if (focusSource) xtreamButton.current?.focus();
  };

  /**
   * Check first, then load, then say what happened.
   *
   * An address that cannot work is refused here rather than sent off to time out, and either
   * way the viewer is told the outcome: a playlist that returns nothing looks exactly like
   * one that failed if nobody says which it was.
   */
  const save = async () => {
    if (operationRef.current.busy) return;
    onClearFeedback?.();
    const checked = validatePlaylistSource(
      source === "m3u"
        ? { kind: "m3u", url }
        : { kind: "xtream", server, username, password, output },
    );
    setProblems(checked.problems);
    const playlistSource = checked.source;
    if (!playlistSource) return;
    const label = name.trim() || nameFromUrl(sourceDisplay(playlistSource));
    const token = operationRef.current.token + 1;
    operationRef.current = { token, busy: true };
    setOperation("validating");
    validationRun.current?.abort();
    const controller = new AbortController();
    validationRun.current = controller;

    let loadsActivePlaylist = false;
    let savedPlaylistId = "";
    let phase: "entry" | "persistence" = "entry";
    try {
      const validation = await validatePlaylist(label, playlistSource, controller.signal);
      if (operationRef.current.token !== token) return;
      if (validation.cancelled) {
        operationRef.current.busy = false;
        setOperation("idle");
        return;
      }
      if (validation.error) {
        operationRef.current.busy = false;
        setOperation("failure");
        const detail = errorText(validation.errorKey, validation.errorDetail, validation.error);
        onError(operationMessage(label, detail));
        return;
      }
      const fresh = useSettings.getState();
      loadsActivePlaylist = editing?.id
        ? editing.id === fresh.activePlaylistId
        : fresh.playlists.length === 0;
      phase = "persistence";
      setOperation("saving");
      if (editing?.id) {
        const updated = await s.updatePlaylist(editing.id, label, playlistSource);
        if (operationRef.current.token !== token) return;
        if (!updated) {
          operationRef.current.busy = false;
          setOperation("failure");
          onError(operationMessage(label, t("lineup.persistenceFailed")));
          return;
        }
        if (replacesSourceAccount(editing.source, playlistSource)) {
          await clearPlaylistCache(editing);
          if (operationRef.current.token !== token) return;
          forgetRepairSource(editing.id);
        }
        savedPlaylistId = editing.id;
      } else {
        const known = new Set(useSettings.getState().playlists.map((item) => item.id));
        s.addPlaylist(label, playlistSource);
        savedPlaylistId =
          useSettings.getState().playlists.find((item) => !known.has(item.id))?.id ?? "";
      }
    } catch {
      if (operationRef.current.token !== token) return;
      operationRef.current.busy = false;
      setOperation("failure");
      const key = phase === "entry" ? "playlist.entryNetwork" : "lineup.persistenceFailed";
      onError(operationMessage(label, t(key)));
      return;
    } finally {
      if (operationRef.current.token === token) {
        operationRef.current.busy = false;
      }
    }
    operationRef.current.busy = false;
    setOperation("idle");
    if (editing?.id) closeEdit();
    else closeAdd();

    if (
      !loadsActivePlaylist ||
      !savedPlaylistId ||
      useSettings.getState().activePlaylistId !== savedPlaylistId
    ) {
      operationRef.current.busy = false;
      setOperation("idle");
      onSuccess(
        editing?.id
          ? t("playlist.updated", { name: label })
          : t("playlist.saved", { name: label }),
      );
      return;
    }

    let result: LoadResult & { activated: boolean };
    try {
      result = await activatePlaylist(savedPlaylistId);
    } catch {
      result = {
        count: 0,
        activated: false,
        error: t("playlist.entryNetwork"),
        errorKey: "playlist.entryNetwork",
        errorDetail: "",
      };
    }
    if (operationRef.current.token !== token) return;
    operationRef.current.busy = false;
    setOperation(result.error ? "failure" : "idle");
    if (result.error && savedPlaylistId) {
      const detail = errorText(result.errorKey, result.errorDetail, result.error);
      const message = operationMessage(label, detail);
      notifiedRef.current = { playlistId: savedPlaylistId, message };
      onError(message);
    } else {
      onSuccess(
        editing?.id
          ? t("playlist.updated", { name: label })
          : result.count > 0
            ? t("playlist.loaded", { name: label, count: result.count })
            : t("playlist.savedNoChannels", { name: label }),
      );
    }
  };

  const cancelEdit = () => {
    operationRef.current.token += 1;
    operationRef.current.busy = false;
    validationRun.current?.abort();
    validationRun.current = null;
    setOperation("idle");
    if (editing?.id) closeEdit();
    else closeAdd();
  };

  /*
   * When the pressed action ends up disabled, focus falls back to the row's Open control.
   * A button that is still enabled keeps its own focus, and a viewer who has moved on is
   * never pulled back.
   */
  const restoreRowFocus = (trigger: HTMLButtonElement) => {
    queueLayoutTask(() => {
      if (!inputEnabledRef.current || !trigger.isConnected) return;
      const active = document.activeElement;
      if (active !== trigger && active !== document.body) return;
      const target = trigger.disabled
        ? (trigger.closest(".pl-line")?.querySelector<HTMLElement>(".pl-open") ?? trigger)
        : trigger;
      target.focus();
    });
  };

  const activate = async (playlist: Playlist, trigger: HTMLButtonElement) => {
    if (
      playlist.id === useSettings.getState().activePlaylistId ||
      rowBusy.current.has(playlist.id)
    )
      return;
    const restoreFocus = document.activeElement === trigger;
    rowBusy.current.add(playlist.id);
    setRowRefresh((rows) => ({ ...rows, [playlist.id]: { busy: true, error: "" } }));
    try {
      const result = await activatePlaylist(playlist.id);
      const detail = result.error
        ? errorText(result.errorKey, result.errorDetail, result.error)
        : "";
      setRowRefresh((rows) => ({
        ...rows,
        [playlist.id]: { busy: false, error: detail },
      }));
      if (result.error) {
        const message = operationMessage(playlist.name, detail);
        notifiedRef.current = { playlistId: playlist.id, message };
        onError(message);
      } else {
        onSuccess(
          result.count > 0
            ? t("playlist.loaded", { name: playlist.name, count: result.count })
            : t("playlist.savedNoChannels", { name: playlist.name }),
        );
      }
    } finally {
      rowBusy.current.delete(playlist.id);
    }
    if (restoreFocus) restoreRowFocus(trigger);
  };

  const refreshPlaylist = async (playlist: Playlist, trigger: HTMLButtonElement) => {
    if (rowBusy.current.has(playlist.id)) return;
    const restoreFocus = document.activeElement === trigger;
    const wasActive = playlist.id === s.activePlaylistId;
    const noticeId = refreshNotice.show(
      `${t("playlist.refreshing")} ${playlist.name}`,
      "loading",
      Symbol(playlist.id),
    );
    const run = {
      sourceVersion: playlist.sourceVersion,
      active: wasActive,
      clear: () => {
        if (noticeId !== undefined) refreshNotice.clear(noticeId);
      },
    };
    refreshRuns.current.set(playlist.id, run);
    rowBusy.current.add(playlist.id);
    setRowRefresh((rows) => ({ ...rows, [playlist.id]: { busy: true, error: "" } }));
    try {
      const result =
        playlist.id === s.activePlaylistId
          ? await load(true)
          : await useChannels.getState().refreshPlaylist(playlist);
      if (refreshRuns.current.get(playlist.id) !== run) return;
      if (result.cancelled) {
        run.clear();
        setRowRefresh((rows) => ({ ...rows, [playlist.id]: { busy: false, error: "" } }));
        return;
      }
      const detail = result.error
        ? errorText(result.errorKey, result.errorDetail, result.error)
        : "";
      setRowRefresh((rows) => ({
        ...rows,
        [playlist.id]: { busy: false, error: detail },
      }));
      if (result.error) {
        const message = operationMessage(playlist.name, detail);
        if (wasActive) notifiedRef.current = { playlistId: playlist.id, message };
        refreshNotice.resolve(noticeId, message, "error");
      } else {
        refreshNotice.resolve(
          noticeId,
          t("playlist.refreshed", { count: result.count }),
          "success",
        );
      }
    } catch {
      if (refreshRuns.current.get(playlist.id) !== run) return;
      const detail = t("playlist.entryNetwork");
      const message = operationMessage(playlist.name, detail);
      setRowRefresh((rows) => ({ ...rows, [playlist.id]: { busy: false, error: detail } }));
      if (wasActive) notifiedRef.current = { playlistId: playlist.id, message };
      refreshNotice.resolve(noticeId, message, "error");
    } finally {
      if (refreshRuns.current.get(playlist.id) === run) {
        refreshRuns.current.delete(playlist.id);
        rowBusy.current.delete(playlist.id);
      }
    }
    if (restoreFocus) restoreRowFocus(trigger);
  };

  const askReset = (playlist: Playlist) => {
    if (rowBusy.current.has(playlist.id)) return;
    setResetting(playlist);
    setResetProblem(false);
    onAsking(true);
  };

  const closeReset = () => {
    if (resetRun.current) return;
    setResetting(null);
    setResetProblem(false);
    onAsking(false, true);
  };

  const resetCustomisations = async () => {
    const playlist = resetting;
    if (!playlist || resetRun.current) return;
    const abort = new AbortController();
    resetRun.current = abort;
    rowBusy.current.add(playlist.id);
    setResetPending(true);
    setResetProblem(false);
    let succeeded = false;
    try {
      const context = await acquireManagementContext(playlist.id, "tv", abort.signal);
      try {
        if (context.sourceVersion === playlist.sourceVersion && context.isCurrent()) {
          const state = context.controller.store.getState();
          const result = await context.controller.applyLineupMutation(state.revision, {
            type: "playlist.reset",
          });
          succeeded = result.ok && context.isCurrent();
        }
      } finally {
        await context.release();
      }
    } catch {
      succeeded = false;
    }
    if (resetRun.current !== abort) return;
    resetRun.current = null;
    rowBusy.current.delete(playlist.id);
    if (abort.signal.aborted) return;
    setResetPending(false);
    if (succeeded) {
      setResetting(null);
      onAsking(false, true);
    } else {
      setResetProblem(true);
    }
  };

  const requestTransition = navigation.transition;
  const openDetailPage = navigation.open;
  const enterSavedList = useCallback(() => {
    setListOpen(true);
    openDetailPage("playlist-list", t("playlist.savedPlaylists"), "manage-playlists", () =>
      setListOpen(false),
    );
  }, [openDetailPage, t]);
  const openList = useCallback(
    () => requestTransition(enterSavedList),
    [requestTransition, enterSavedList],
  );

  const manage = (playlist: Playlist, returnFocus?: string) => {
    if (rowBusy.current.has(playlist.id) || playlistUnavailable(playlist)) return;
    requestTransition(() => {
      const current = useSettings.getState().playlists.find((item) => item.id === playlist.id);
      if (!current || current.sourceVersion !== playlist.sourceVersion) return;
      setManaging(current.id);
      navigation.open(
        `playlist-lineup-${current.id}`,
        t("lineup.title"),
        returnFocus ?? `playlist-row-${current.id}`,
        () => setManaging(""),
      );
    });
  };

  const openRowMenu = (playlist: Playlist, trigger: HTMLElement) => {
    if (!surfaceInputEnabledRef.current) return;
    menuReturn.current = trigger;
    trigger.focus();
    setMenuFor(playlist.id);
    onAsking(true);
  };

  const closeRowMenu = (restoreFocus: boolean) => {
    setMenuFor("");
    onAsking(false, restoreFocus);
  };

  const runMenuAction = (action: () => void) => () => {
    const back = menuReturn.current;
    if (back?.isConnected && surfaceInputEnabledRef.current) back.focus();
    action();
  };

  const managedPlaylist = s.playlists.find((playlist) => playlist.id === managing);
  const menuPlaylist = s.playlists.find((playlist) => playlist.id === menuFor) || null;
  useEffect(() => {
    if (menuFor && !s.playlists.some((playlist) => playlist.id === menuFor)) {
      setMenuFor("");
      onAsking(false);
    }
  }, [menuFor, s.playlists, onAsking]);
  useEffect(() => {
    if (managing && !s.playlists.some((playlist) => playlist.id === managing)) {
      navigation.dismiss(`playlist-lineup-${managing}`);
    }
  }, [managing, s.playlists, navigation]);
  useEffect(() => {
    if (editing?.id && !s.playlists.some((playlist) => playlist.id === editing.id)) {
      setEditing(null);
      onAsking(false, true);
    }
  }, [editing?.id, s.playlists, onAsking]);
  useEffect(
    () => () => {
      resetRun.current?.abort();
      resetRun.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!resetting) return;
    const current = s.playlists.find((item) => item.id === resetting.id);
    if (current?.sourceVersion === resetting.sourceVersion) return;
    resetRun.current?.abort();
    resetRun.current = null;
    rowBusy.current.delete(resetting.id);
    setResetting(null);
    setResetPending(false);
    setResetProblem(false);
    onAsking(false, true);
  }, [resetting, s.playlists, onAsking]);
  useRemote((code, event) => {
    if (!listOpen || managing || !searching || !navigation.inputEnabled) return;
    const inField = document.activeElement === searchInput.current;
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
    if (!inField) return;
    if (code === KEY.ENTER) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (code === KEY.DOWN) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const line = document.querySelector<HTMLElement>(".pl-line");
      const target =
        line?.querySelector<HTMLElement>(".pl-open:not(:disabled)") ??
        line?.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), [tabindex='0']",
        ) ??
        searchButton.current;
      target?.focus({ preventScroll: true });
    }
  }, true);
  const recoveryApplied = useRef(false);
  useLayoutEffect(() => {
    if (recoveryApplied.current || !recoveryPlaylistId) return;
    recoveryApplied.current = true;
    const index = s.playlists.findIndex((playlist) => playlist.id === recoveryPlaylistId);
    if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
    enterSavedList();
  }, [recoveryPlaylistId, s.playlists, enterSavedList]);
  useLayoutEffect(() => {
    if (!pendingPageFocus.current) return;
    if (
      !listOpen ||
      managedPlaylist ||
      editing ||
      adding ||
      confirming ||
      menuFor ||
      resetting ||
      !navigation.inputEnabled
    )
      return;
    pendingPageFocus.current = false;
    const target =
      document.querySelector<HTMLElement>(".pl-line .pl-open:not(:disabled)") ??
      searchButton.current ??
      addButton.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  }, [
    currentPage,
    visiblePlaylists,
    listOpen,
    managedPlaylist,
    editing,
    adding,
    confirming,
    menuFor,
    resetting,
    navigation.inputEnabled,
  ]);
  if (managedPlaylist) {
    return (
      <LineupManager
        playlist={managedPlaylist}
        onAsking={onAsking}
        navigation={navigation}
        busy={
          !!rowRefresh[managedPlaylist.id]?.busy ||
          loading ||
          Object.values(rowRefresh).some((row) => row.busy)
        }
        error={playlistError(managedPlaylist.id)}
        onError={onError}
        onRefresh={(trigger) => void refreshPlaylist(managedPlaylist, trigger)}
      />
    );
  }

  const playlistForm = () => (
    <div className="form playlist-form" data-ordered-form>
      <div className="playlist-source-options" data-form-navigation-group>
        <button
          type="button"
          className="btn tonal"
          aria-pressed={source === "m3u"}
          disabled={operationBusy}
          onClick={() => {
            setSource("m3u");
            setUrl(m3uUrl);
            clearProblems();
          }}
        >
          <span>{t("onboarding.m3uPlaylist")}</span>
        </button>
        <button
          ref={xtreamButton}
          type="button"
          className="btn tonal"
          aria-pressed={source === "xtream"}
          disabled={operationBusy}
          onClick={() => {
            setSource("xtream");
            clearProblems();
          }}
        >
          <span>{t("onboarding.xtreamLogin")}</span>
        </button>
      </div>
      {source === "m3u" ? (
        <div className="form-field">
          <label htmlFor="pl-url">{t("onboarding.playlistAddress")}</label>
          <TextInput
            id="pl-url"
            data-settings-detail-first={source === "m3u" ? true : undefined}
            value={url}
            spellCheck={false}
            dir="ltr"
            disabled={operationBusy}
            problem={problems.url ? t(problems.url) : undefined}
            onChange={(event) => {
              setUrl(event.target.value);
              setM3uUrl(event.target.value);
              clearProblems("url");
            }}
            placeholder={t("onboarding.urlPlaceholder")}
          />
          {suggestedXtream && (
            <div className="xtream-suggestion">
              <span>{t("onboarding.xtreamDetected")}</span>
              <div>
                <button
                  type="button"
                  className="btn tonal"
                  disabled={operationBusy}
                  onClick={() => setDismissedXtreamUrl(url)}
                >
                  <span>{t("onboarding.keepM3u")}</span>
                </button>
                <button
                  type="button"
                  className="btn tonal"
                  disabled={operationBusy}
                  onClick={() => applyXtream(suggestedXtream, true)}
                >
                  <span>{t("onboarding.useXtream")}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="xtream-fields">
          <div className="form-field">
            <label htmlFor="pl-server">{t("onboarding.serverAddress")}</label>
            <TextInput
              id="pl-server"
              data-settings-detail-first
              value={server}
              spellCheck={false}
              dir="ltr"
              disabled={operationBusy}
              problem={problems.server ? t(problems.server) : undefined}
              onChange={(event) => {
                applyXtream(
                  xtreamFromServerField(
                    { kind: "xtream", server, username, password, output },
                    event.target.value,
                  ),
                );
              }}
            />
          </div>
          <div className="form-field-pair">
            <div className="form-field">
              <label htmlFor="pl-username">{t("onboarding.username")}</label>
              <TextInput
                id="pl-username"
                value={username}
                spellCheck={false}
                dir="ltr"
                disabled={operationBusy}
                problem={problems.username ? t(problems.username) : undefined}
                onChange={(event) => {
                  setUsername(event.target.value);
                  clearProblems("username");
                }}
              />
            </div>
            <div className="form-field">
              <label htmlFor="pl-password">{t("onboarding.password")}</label>
              <TextInput
                id="pl-password"
                type="password"
                value={password}
                dir="ltr"
                disabled={operationBusy}
                problem={problems.password ? t(problems.password) : undefined}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearProblems("password");
                }}
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="pl-output">{t("onboarding.streamFormat")}</label>
            <OptionPicker
              id="pl-output"
              label={t("onboarding.streamFormat")}
              value={output}
              disabled={operationBusy}
              options={[
                { value: "m3u8", label: t("onboarding.hls") },
                { value: "ts", label: t("onboarding.mpegTs") },
              ]}
              onChange={(value) => {
                setOutput(value);
                onClearFeedback?.();
              }}
            />
          </div>
        </div>
      )}
      <div className="form-field">
        <label htmlFor="pl-name">{t("onboarding.playlistName")}</label>
        <TextInput
          id="pl-name"
          value={name}
          disabled={operationBusy}
          onChange={(event) => {
            setName(event.target.value);
            onClearFeedback?.();
          }}
          placeholder={t("onboarding.optionalAddress")}
        />
      </div>
    </div>
  );

  if (!listOpen) {
    return <ContentSettings onManage={openList} />;
  }

  return (
    <>
      <SettingsListHeader
        className="playlist-list-header"
        title={t("playlist.savedPlaylists")}
        count={number(filteredPlaylists.length)}
      >
        <button
          ref={searchButton}
          type="button"
          className="settings-icon-action lineup-toolbar-action"
          data-playlist-search-toggle
          data-settings-focus="playlist-search-toggle"
          aria-label={t("playlist.searchPlaylists")}
          aria-expanded={searching}
          onClick={() => {
            if (!inputEnabledRef.current) return;
            if (searching) closeSearch();
            else setSearching(true);
          }}
        >
          <Icon name="search" />
          <span className="lineup-toolbar-label">{t("common.search")}</span>
        </button>
        <button
          ref={addButton}
          type="button"
          className="btn tonal settings-add-playlist"
          data-settings-focus="playlist-add"
          aria-label={t("common.addPlaylist")}
          onClick={startAdd}
        >
          <Icon name="plus" />
          <span>{t("common.addPlaylist")}</span>
        </button>
      </SettingsListHeader>
      {searching && (
        <div className="lineup-search-field">
          <TextInput
            ref={searchInput}
            className="lineup-search-input playlist-search-field"
            variant="compact"
            autoFocus
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder={t("playlist.searchPlaylists")}
            aria-label={t("playlist.searchPlaylists")}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </div>
      )}
      <div className="settings-list-body">
        {visiblePlaylists.map((p, index) => {
          const account = p.source.kind === "xtream" ? accounts[p.id] : undefined;
          return (
            <div
              key={p.id}
              className={`pl ${p.id === s.activePlaylistId ? "active" : ""} ${p.id === recoveryPlaylistId ? "recovery-owner" : ""}`.trim()}
              aria-busy={playlistProgress(p) || undefined}
            >
              <div className="pl-line management-row">
                <button
                  type="button"
                  className="pl-open management-row-primary"
                  data-settings-focus={`playlist-open-${p.id}`}
                  data-settings-detail-first={index === 0 ? true : undefined}
                  data-ok-guide={t("common.open")}
                  aria-label={`${t("common.open")}, ${p.name}`}
                  disabled={playlistPrimaryDisabled(p)}
                  onClick={() => {
                    if (!inputEnabledRef.current || playlistPrimaryDisabled(p)) return;
                    manage(p, `playlist-open-${p.id}`);
                  }}
                >
                  <span className={`pl-main${account ? " pl-main-with-account" : ""}`}>
                    <span className="pl-title">
                      <span
                        className="playlist-position"
                        data-playlist-number={p.id}
                        aria-hidden="true"
                      >
                        {number(s.playlists.findIndex((playlist) => playlist.id === p.id) + 1)}
                      </span>
                      <span className="pl-name">
                        {p.name}
                      </span>
                      <span className="pl-tags">
                        {/* Named, not just tinted. The accessibility guidance asks for a mark
                            alongside colour, since a tint alone says nothing in greyscale. */}
                        {p.id === s.activePlaylistId && (
                          <span className="tag">{t("common.active")}</span>
                        )}
                        {playlistUnavailable(p) && (
                          <span className="tag playlist-state-tag playlist-state-unavailable">
                            {t("playlist.unavailable")}
                          </span>
                        )}
                        {playlistSaved(p) && (
                          <span className="tag playlist-state-tag">
                            {t("playlist.savedContent")}
                          </span>
                        )}
                        {account && <AccountBadge account={account} />}
                      </span>
                    </span>
                    <span className="pl-stats management-row-meta">
                      {p.categoryCount !== undefined &&
                        t("playlist.categoryCount", {
                          count: number(p.categoryCount),
                          total: p.categoryCount,
                        })}
                      {p.channelCount !== undefined && (
                        <>
                          {p.categoryCount !== undefined && <span aria-hidden="true"> · </span>}
                          {number(p.channelCount)} {t("channel.channels")}
                        </>
                      )}
                    </span>
                    {account && <AccountStatus account={account} />}
                  </span>
                </button>
                <button
                  type="button"
                  className={`management-row-actions${p.id === s.activePlaylistId ? " is-active" : ""}`}
                  data-playlist-activate={p.id}
                  data-settings-focus={`playlist-activate-${p.id}`}
                  data-ok-guide={t("remote.activate")}
                  aria-label={`${t("remote.activate")}, ${p.name}`}
                  aria-pressed={p.id === s.activePlaylistId}
                  aria-disabled={rowRefresh[p.id]?.busy || undefined}
                  onClick={(event) => {
                    if (!inputEnabledRef.current) return;
                    event.currentTarget.focus();
                    void activate(p, event.currentTarget);
                  }}
                >
                  <Icon name="check" />
                </button>
                <button
                  type="button"
                  className="pl-menu management-row-actions"
                  data-playlist-menu={p.id}
                  data-settings-focus={`playlist-row-${p.id}`}
                  data-settings-detail-first={
                    index === 0 && playlistPrimaryDisabled(p) ? true : undefined
                  }
                  data-ok-guide={t("remote.actions")}
                  aria-label={`${t("remote.actions")}, ${p.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuFor === p.id}
                  onClick={(event) => openRowMenu(p, event.currentTarget)}
                >
                  <span className="pl-more" aria-hidden="true">
                    <Icon name="more" />
                  </span>
                </button>
              </div>
            </div>
          );
        })}
        {visiblePlaylists.length === 0 && (
          <p className="empty">
            {query.trim() ? t("lineup.noMatches") : t("playlist.addToStart")}
          </p>
        )}
      </div>
      {pages > 1 && (
        <nav className="settings-pagination" aria-label={t("playlist.savedPlaylists")}>
          <button
            type="button"
            className="btn tonal"
            disabled={currentPage === 0}
            onClick={() => goToPage(currentPage - 1)}
          >
            {t("common.previous")}
          </button>
          <span>{`${number(currentPage + 1)} / ${number(pages)}`}</span>
          <button
            type="button"
            className="btn tonal"
            disabled={currentPage === pages - 1}
            onClick={() => goToPage(currentPage + 1)}
          >
            {t("common.next")}
          </button>
        </nav>
      )}

      {menuPlaylist && (
        <ActionMenu
          title={menuPlaylist.name}
          inputEnabled={navigation.surfaceInputEnabled}
          onClose={closeRowMenu}
          actions={[
            {
              id: "activate",
              label: t("remote.activate"),
              icon: "check",
              disabled:
                menuPlaylist.id === s.activePlaylistId || !!rowRefresh[menuPlaylist.id]?.busy,
              onSelect: runMenuAction(() => {
                const trigger = menuReturn.current;
                if (trigger instanceof HTMLButtonElement) void activate(menuPlaylist, trigger);
              }),
            },
            {
              id: "refresh",
              label: t("common.refreshPlaylist"),
              icon: "refresh",
              disabled: !!rowRefresh[menuPlaylist.id]?.busy,
              onSelect: runMenuAction(() => {
                const trigger = menuReturn.current;
                if (trigger instanceof HTMLButtonElement)
                  void refreshPlaylist(menuPlaylist, trigger);
              }),
            },
            {
              id: "edit",
              label: t(
                menuPlaylist.source.kind === "xtream"
                  ? "playlist.editCredentials"
                  : "playlist.editAddress",
              ),
              icon: "edit",
              disabled: !!rowRefresh[menuPlaylist.id]?.busy,
              onSelect: runMenuAction(() => startEdit(menuPlaylist)),
            },
            {
              id: "reset",
              label: t("lineup.resetDetails"),
              icon: "clear",
              danger: true,
              disabled: !!rowRefresh[menuPlaylist.id]?.busy,
              onSelect: runMenuAction(() => askReset(menuPlaylist)),
            },
            {
              id: "remove",
              label: t("common.remove"),
              icon: "remove",
              danger: true,
              disabled: !!rowRefresh[menuPlaylist.id]?.busy,
              onSelect: runMenuAction(() => ask(menuPlaylist.id)),
            },
          ]}
        />
      )}

      {/* Asked in a popup, like every other question the app puts, rather than by growing
          two more buttons inside the row being asked about. */}
      {confirming && (
        <Confirm
          title={t("playlist.removeQuestion", {
            name: s.playlists.find((p) => p.id === confirming)?.name ?? t("settings.playlists"),
          })}
          body={t("playlist.removeBody")}
          confirmLabel={t("common.remove")}
          cancelLabel={t("common.keepIt")}
          destructive
          onCancel={() => ask("")}
          onConfirm={async () => {
            const gone = s.playlists.find((p) => p.id === confirming);
            const wasActive = s.activePlaylistId === confirming;
            const removed = await s.removePlaylist(confirming);
            if (!removed) {
              onError(operationMessage(gone?.name ?? "", t("lineup.persistenceFailed")));
              return;
            }
            if (gone) await clearPlaylistCache(gone);
            forgetRepairSource(confirming);
            ask("");
            onSuccess(t("playlist.removed", { name: gone?.name ?? "" }));
            const promoted = useSettings.getState().activePlaylistId;
            if (wasActive && promoted) void activatePlaylist(promoted);
            else if (!promoted) void load();
          }}
        />
      )}

      {resetting && (
        <Confirm
          title={t("playlist.resetQuestion", { name: resetting.name })}
          body={`${t("playlist.resetBody")}${resetProblem ? ` ${t("lineup.persistenceFailed")}` : ""}`}
          confirmLabel={t("lineup.resetDetails")}
          cancelLabel={t("common.cancel")}
          destructive
          busy={resetPending}
          onConfirm={() => void resetCustomisations()}
          onCancel={closeReset}
        />
      )}

      {adding && (
        <SettingsDialog
          title={t("playlist.addTitle")}
          inputEnabled={navigation.surfaceInputEnabled}
          onClose={cancelEdit}
          busy={operation === "saving"}
          pending={operationBusy}
          onSave={() => void save()}
          className="playlist-dialog"
          busyLabel={t(operation === "validating" ? "playlist.validating" : "playlist.saving")}
        >
          {playlistForm()}
        </SettingsDialog>
      )}

      {editing?.id && (
        <SettingsDialog
          title={t(source === "xtream" ? "playlist.editCredentials" : "playlist.editAddress")}
          inputEnabled={navigation.surfaceInputEnabled}
          onClose={cancelEdit}
          busy={operation === "saving"}
          pending={operationBusy}
          onSave={() => void save()}
          className="playlist-dialog"
          busyLabel={t(operation === "validating" ? "playlist.validating" : "playlist.saving")}
        >
          {playlistForm()}
        </SettingsDialog>
      )}
    </>
  );
}
