import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AppNavigation,
  type AppNavigationAction,
  type AppNavigationItem,
  appNavigationItems as buildAppNavigationItems,
} from "./components/AppNavigation";
import { Clock } from "./components/Clock";
import { ExitDialog, exitApp } from "./components/ExitDialog";
import { Onboarding } from "./components/Onboarding";
import { PlaylistShortcut } from "./components/PlaylistShortcut";
import { PointerPad } from "./components/PointerPad";
import { isRecoveryStatusVisible, RecoveryStatus } from "./components/playback/RecoveryStatus";
import { Settings, type SettingsEntry, type SettingsSection } from "./components/Settings";
import { remoteVisible, SmartRemote } from "./components/SmartRemote";
import { StartupPlaylists } from "./components/StartupPlaylists";
import { ToastHost } from "./components/ToastHost";
import { useChrome } from "./hooks/useChrome";
import { useLocale } from "./hooks/useLocale";
import { useLongPress } from "./hooks/useLongPress";
import { usePageTransition } from "./hooks/usePageTransition";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { pointerInputActive, usePointerAwake } from "./hooks/usePointerAwake";
import { KEY, registerRemoteKeys, sendKey, useRemote } from "./hooks/useRemote";
import { type RemoteAccessControl, useRemoteAccess } from "./hooks/useRemoteAccess";
import { useToast } from "./hooks/useToast";
import { LiveScreen } from "./screens/LiveScreen";
import type { VodPlaybackRequest, VodScreenHandle } from "./screens/VodScreen";
import { availableContentModes } from "./services/contentSections";
import { hasPairedDevices, subscribePairedDevices } from "./services/deviceAccess";
import { whenIdle } from "./services/idle";
import { applyDocumentLocale, type MessageKey } from "./services/locale";
import { onTizen } from "./services/player";
import { PlaylistEntryFeedbackError } from "./services/playlistEntry";
import { developmentRemoteAccess } from "./services/remoteServer";
import { read, write } from "./services/store";
import {
  type AppMode,
  activeSurface,
  type LiveSurface,
  type PlaybackDrawerSurface,
  type SurfaceId,
  type SurfaceStack,
} from "./services/surfaceStack";
import { formatEpisodePlaybackName } from "./services/xtream";
import { useChannels } from "./stores/channels";
import { useLineup } from "./stores/lineup";
import { usePersonal } from "./stores/personal";
import { useSettings } from "./stores/settings";
import { useSetup } from "./stores/setup";
import { useStartup } from "./stores/startup";
import type { PlaybackTarget } from "./types";

let loadedVodScreen: typeof import("./screens/VodScreen").VodScreen | null = null;
const loadVodScreen = () =>
  import("./screens/VodScreen").then((module) => {
    loadedVodScreen = module.VodScreen;
    return { default: module.VodScreen };
  });
const LazyVodScreen = lazy(loadVodScreen);
export const preloadVodScreen = async () => {
  await loadVodScreen();
};

const rememberedMode = (): AppMode => {
  const settings = useSettings.getState();
  const playlist = settings.activePlaylist();
  const modes = availableContentModes(playlist?.source.kind ?? "m3u", settings);
  const saved = playlist ? read(`app:last-mode:${playlist.id}`) : null;
  return modes.find((mode) => mode === saved) ?? modes[0];
};

const rememberedLiveChannel = () => {
  const playlist = useSettings.getState().activePlaylist();
  if (!playlist) return "";
  const saved = read(`app:last-live:${playlist.id}`);
  const last = usePersonal.getState().lastPlayed;
  return (
    saved || (last?.kind === "live" && last.playlistId === playlist.id ? last.itemKey : "")
  );
};

export default function App() {
  const initialized = useStartup((state) => state.initialized);
  const pending = useStartup((state) => state.pending);
  // Keep the chooser mounted until its exit transition has finished.
  const [startupVisible, setStartupVisible] = useState(pending);
  const playlists = useSettings((state) => state.playlists);
  const { locale } = useLocale();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const developmentRemoteAccessEnabled = developmentRemoteAccess();
  const remoteAccessSupported = onTizen() || developmentRemoteAccessEnabled;
  const hasRemoteDevices = useSyncExternalStore(
    subscribePairedDevices,
    hasPairedDevices,
    () => false,
  );
  // Keep the socket serving a phone command alive when that command resolves startup.
  const remoteAccess = useRemoteAccess(
    remoteAccessSupported && (!playlists.length || settingsVisible || hasRemoteDevices),
    developmentRemoteAccessEnabled,
  );
  useLayoutEffect(() => {
    applyDocumentLocale(locale);
    useStartup.getState().prepare();
  }, [locale]);
  useEffect(() => registerRemoteKeys(), []);
  useLayoutEffect(() => {
    if (!pending) return;
    setStartupVisible(true);
    if (playlists.length < 2) {
      useStartup.getState().choose(useSettings.getState().activePlaylist()?.id);
    }
  }, [pending, playlists]);
  if (!initialized) return null;
  const access = {
    remoteAccess,
    remoteAccessSupported,
    onSettingsVisibilityChange: setSettingsVisible,
  };
  return pending || startupVisible ? (
    <StartupPlaylists onExited={() => setStartupVisible(false)} />
  ) : (
    <Application {...access} />
  );
}

interface ApplicationAccess {
  remoteAccess: RemoteAccessControl;
  remoteAccessSupported: boolean;
  onSettingsVisibilityChange: (visible: boolean) => void;
}

function Application({
  remoteAccess,
  remoteAccessSupported,
  onSettingsVisibilityChange,
}: ApplicationAccess) {
  const VodScreen = loadedVodScreen ?? LazyVodScreen;
  const MemoVodScreen = useMemo(() => memo(VodScreen), [VodScreen]);
  const load = useChannels((state) => state.load);
  const activatePlaylist = useChannels((state) => state.activatePlaylist);
  const validatePlaylist = useChannels((state) => state.validatePlaylist);
  const sweep = useChannels((state) => state.sweep);
  const loading = useChannels((state) => state.loading);
  const error = useChannels((state) => state.error);
  const errorKey = useChannels((state) => state.errorKey);
  const errorDetail = useChannels((state) => state.errorDetail);
  const channels = useLineup((state) => state.channels);
  const lineupPlaylistId = useLineup((state) => state.playlistId);
  const playlists = useSettings((state) => state.playlists);
  const activePlaylist = useSettings((state) => state.activePlaylist());
  const aspectId = useSettings((state) => state.aspectId);
  const compatibility = useSettings((state) => state.compatibility);
  const continuousReconnect = useSettings((state) => state.continuousReconnect);
  const scale = useSettings((state) => state.scale());
  const showClock = useSettings((state) => state.showClock);
  const showLive = useSettings((state) => state.showLive);
  const showMovies = useSettings((state) => state.showMovies);
  const showSeries = useSettings((state) => state.showSeries);
  const playlistShortcut = useSettings((state) => state.playlistShortcut);
  const playlistShortcutAvailable = playlistShortcut && playlists.length > 1;
  const addPlaylist = useSettings((state) => state.addPlaylist);
  const configured = playlists.length > 0;
  const { direction, t } = useLocale();
  const appNavigationSourceKind = activePlaylist?.source.kind ?? "m3u";
  const enabledModes = useMemo(
    () => availableContentModes(appNavigationSourceKind, { showLive, showMovies, showSeries }),
    [appNavigationSourceKind, showLive, showMovies, showSeries],
  );
  const appNavigationItems = useMemo(
    () =>
      buildAppNavigationItems(
        enabledModes,
        t,
        playlistShortcutAvailable && activePlaylist
          ? {
              name: activePlaylist.name,
              number: playlists.findIndex((item) => item.id === activePlaylist.id) + 1,
            }
          : undefined,
      ),
    [activePlaylist, enabledModes, playlistShortcutAvailable, playlists, t],
  );
  const [initialLiveChannel] = useState(rememberedLiveChannel);
  const [liveSurface, setLiveSurface] = useState<LiveSurface>(() =>
    useSettings.getState().resumeLast &&
    (initialLiveChannel || usePersonal.getState().hasRememberedLast())
      ? "picture"
      : "panel",
  );
  const [liveEntryId, setLiveEntryId] = useState(0);
  const [appMode, setAppMode] = useState<AppMode>(rememberedMode);
  const [vodMode, setVodMode] = useState<"movie" | "series">(
    appMode === "series" ? "series" : "movie",
  );
  const [vodPhase, setVodPhase] = useState<"browsing" | "resolving" | "starting" | "playing">(
    "browsing",
  );
  const vodRef = useRef<VodScreenHandle>(null);
  const rememberedLive = useRef(initialLiveChannel);
  const [pendingLivePlaylistId, setPendingLivePlaylistId] = useState<string | null>(null);
  const vodRequest = useRef<VodPlaybackRequest | null>(null);
  const vodToken = useRef(0);
  const [guideChannelId, setGuideChannelId] = useState("");
  const [deckOpen, setDeckOpen] = useState(false);
  const [playbackDrawer, setPlaybackDrawer] = useState<PlaybackDrawerSurface | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsEntry, setSettingsEntry] = useState<SettingsEntry>({
    session: 0,
    section: "appearance",
  });
  const [settingsPopupOpen, setSettingsPopupOpen] = useState(false);
  const [playlistShortcutOpen, setPlaylistShortcutOpen] = useState(false);
  const [appNavigationFocused, setAppNavigationFocused] = useState(false);
  const [vodDetailsOpen, setVodDetailsOpen] = useState(false);
  const [vodInfoOpen, setVodInfoOpen] = useState(false);
  const [appNavigationAction, setAppNavigationAction] = useState<AppNavigationAction>("live");
  const appNavigationActionRef = useRef<AppNavigationAction>("live");
  const [livePanelHost, setLivePanelHost] = useState<HTMLDivElement | null>(null);
  const [searchRequest, setSearchRequest] = useState<{
    id: number;
    mode: AppMode;
    open: boolean;
  }>({ id: 0, mode: "live", open: false });
  useLayoutEffect(() => {
    if (appNavigationItems.some((item) => item.id === appNavigationActionRef.current)) return;
    const preferred = showSettings
      ? "settings"
      : (appNavigationItems.find((item) => item.id === appMode)?.id ?? enabledModes[0]);
    appNavigationActionRef.current = preferred;
    setAppNavigationAction(preferred);
  }, [appNavigationItems, appMode, enabledModes, showSettings]);
  useLayoutEffect(() => {
    if (!playlistShortcutOpen || playlistShortcutAvailable) return;
    setPlaylistShortcutOpen(false);
    setAppNavigationFocused(configured && !pointerInputActive());
  }, [configured, playlistShortcutAvailable, playlistShortcutOpen]);
  const [showExit, setShowExit] = useState(false);
  const requestExit = useCallback(() => setShowExit(true), []);
  const chrome = useChrome(
    `playback:${activePlaylist?.id ?? "setup"}:${activePlaylist?.sourceVersion ?? 0}`,
  );
  const entryToast = useToast("playlist-entry-completion");
  const openSettings = useCallback(
    (destination?: {
      section?: SettingsSection;
      playlistId?: string;
      loadError?: string;
      savedPlaylists?: boolean;
    }) => {
      setPlaylistShortcutOpen(false);
      vodToken.current += 1;
      setVodPhase((phase) =>
        phase === "resolving" || phase === "starting" ? "browsing" : phase,
      );
      chrome.cancelDigits();
      setAppNavigationFocused(false);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setSettingsEntry((current) => ({
        session: current.session + 1,
        section: destination?.section ?? "appearance",
        ...(destination?.playlistId ? { playlistId: destination.playlistId } : {}),
        ...(destination?.loadError ? { loadError: destination.loadError } : {}),
        ...(destination?.savedPlaylists ? { savedPlaylists: true } : {}),
      }));
      setShowSettings(true);
    },
    [chrome.cancelDigits],
  );
  const pointerAwake = usePointerAwake();

  useLayoutEffect(() => {
    onSettingsVisibilityChange(showSettings);
    return () => onSettingsVisibilityChange(false);
  }, [onSettingsVisibilityChange, showSettings]);

  useEffect(() => {
    if (!useStartup.getState().activated) {
      const playlist = useSettings.getState().activePlaylist();
      if (playlist) void activatePlaylist(playlist.id, false);
      else void load();
    }
    return whenIdle(() => void sweep(), 8000);
  }, [activatePlaylist, load, sweep]);

  const appRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  useEffect(() => {
    const keyboard = (
      navigator as Navigator & {
        keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
      }
    ).keyboard;
    const syncFullscreen = () => {
      const active = document.fullscreenElement === document.documentElement;
      setBrowserFullscreen(active);
      // Escape is reserved by the browser unless fullscreen keyboard locking is allowed.
      if (active) void keyboard?.lock?.(["Escape"]).catch(() => undefined);
      else keyboard?.unlock?.();
    };
    syncFullscreen();
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      keyboard?.unlock?.();
    };
  }, []);
  useLongPress({
    code: KEY.ESC,
    enabled: browserFullscreen,
    capture: true,
    onShortPress: () => sendKey(KEY.BACK),
    onLongPress: () => void document.exitFullscreen(),
  });
  const toggleFullscreen = useCallback(() => {
    if (onTizen()) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen?.({
      keyboardLock: "browser",
    } as FullscreenOptions & { keyboardLock: "browser" });
  }, []);

  const rememberLive = useCallback((itemKey: string) => {
    const channel = useLineup.getState().channels.find((item) => item.id === itemKey);
    const activePlaylist = useSettings.getState().activePlaylist();
    if (!channel || !activePlaylist) return;
    rememberedLive.current = itemKey;
    write(`app:last-live:${activePlaylist.id}`, itemKey);
    usePersonal.getState().rememberLast({
      playlistId: activePlaylist.id,
      kind: "live",
      itemKey,
      categoryKey: channel.xtream?.categoryKey ?? channel.categoryKey ?? channel.group,
    });
  }, []);

  const named = useCallback(() => chrome.raiseBanner(), [chrome.raiseBanner]);
  const message = useCallback((key: MessageKey) => chrome.say(t(key)), [chrome.say, t]);
  const playbackEnded = useCallback((target: PlaybackTarget) => {
    if (target.mode !== "finite") return;
    usePersonal.getState().completeProgress(target.id);
    if (vodRequest.current) {
      vodToken.current += 1;
      setVodPhase("browsing");
      setLiveSurface("picture");
      setDeckOpen(false);
      setPlaybackDrawer(null);
    }
  }, []);
  const playbackStopped = useCallback(
    (target: PlaybackTarget, clock: { position: number | null; duration: number | null }) => {
      if (target.mode !== "finite" || !target.progress || clock.position === null) return;
      usePersonal
        .getState()
        .rememberProgress(target.progress, clock.position, clock.duration ?? undefined, "stop");
    },
    [],
  );

  const playback = usePlaybackController({
    playlistId: activePlaylist?.id,
    fit: aspectId,
    video: videoRef,
    compatibility,
    continuousReconnect,
    onNamed: named,
    onMessage: message,
    onEnded: playbackEnded,
    onStopped: playbackStopped,
    rememberLast: rememberLive,
  });
  const playbackOwner = useRef(activePlaylist?.id ?? "");
  const resumeInitialLive = useRef(true);
  const shortcutPause = useRef<{
    playlistId: string;
    itemKey: string;
    resume: boolean;
  } | null>(null);

  useEffect(() => {
    playback.setMuted((showSettings || playlistShortcutOpen) && !!playback.snapshot.target);
  }, [showSettings, playlistShortcutOpen, playback.snapshot.target, playback.setMuted]);

  useEffect(() => {
    const target = playback.snapshot.target;
    if (playlistShortcutOpen) {
      if (!target || target.playlistId !== activePlaylist?.id) return;
      const held = shortcutPause.current;
      if (held?.playlistId !== target.playlistId || held.itemKey !== target.id) {
        shortcutPause.current = {
          playlistId: target.playlistId,
          itemKey: target.id,
          resume: !playback.snapshot.paused,
        };
      }
      if (!playback.snapshot.paused) playback.setPlaying(false);
      return;
    }
    const held = shortcutPause.current;
    shortcutPause.current = null;
    if (
      held?.resume &&
      target &&
      target.playlistId === activePlaylist?.id &&
      held.playlistId === target.playlistId &&
      held.itemKey === target.id &&
      appMode ===
        (target.kind === "movie" ? "movie" : target.kind === "episode" ? "series" : "live") &&
      playback.snapshot.paused
    ) {
      playback.setPlaying(true);
    }
  }, [
    activePlaylist?.id,
    appMode,
    playlistShortcutOpen,
    playback.snapshot.target,
    playback.snapshot.paused,
    playback.setPlaying,
  ]);

  const cancelPendingVod = useCallback(() => {
    vodToken.current += 1;
    if (playback.snapshot.target?.mode === "finite") {
      playback.stop();
      vodRequest.current = null;
    }
    setVodPhase((phase) =>
      phase === "resolving" || phase === "starting" ? "browsing" : phase,
    );
  }, [playback.snapshot.target, playback.stop]);

  const changeMode = useCallback(
    (mode: AppMode) => {
      const settings = useSettings.getState();
      if (
        !availableContentModes(
          settings.activePlaylist()?.source.kind ?? "m3u",
          settings,
        ).includes(mode)
      ) {
        return;
      }
      if (mode === appMode) {
        const target = playback.snapshot.target;
        if (
          mode === "live" &&
          (target?.mode !== "live" || target.playlistId !== settings.activePlaylist()?.id)
        ) {
          resumeInitialLive.current = false;
          setPendingLivePlaylistId(settings.activePlaylist()?.id ?? null);
        }
        cancelPendingVod();
        vodRef.current?.closeDetails();
        return;
      }
      vodToken.current += 1;
      chrome.cancelDigits();
      vodRef.current?.closeSearch();
      setSearchRequest((request) => ({ id: request.id + 1, mode, open: false }));
      if (mode !== "live") setVodMode(mode);
      const playlist = useSettings.getState().activePlaylist();
      if (playlist) write(`app:last-mode:${playlist.id}`, mode);
      if (mode === "live") {
        setAppMode("live");
        setVodPhase("browsing");
        vodRequest.current = null;
        setLiveSurface("panel");
        setLiveEntryId((value) => value + 1);
        resumeInitialLive.current = false;
        setPendingLivePlaylistId(playlist?.id ?? null);
        return;
      }
      if (appMode === "live") {
        const target = playback.snapshot.target;
        if (target?.mode === "live") rememberedLive.current = target.id;
        playback.stop();
        setLiveSurface("picture");
        setDeckOpen(false);
        setPlaybackDrawer(null);
        setGuideChannelId("");
      }
      setAppMode(mode);
    },
    [appMode, cancelPendingVod, chrome.cancelDigits, playback.snapshot.target, playback.stop],
  );

  const playlistRecovery =
    configured && !!error && errorKey !== "playlist.refreshFailed" && !loading;

  useEffect(() => {
    if (playlistRecovery || enabledModes.includes(appMode)) return;
    changeMode(enabledModes[0]);
  }, [appMode, changeMode, enabledModes, playlistRecovery]);

  const releaseAppNavigation = useCallback(() => {
    setAppNavigationFocused(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, []);

  const closePlaylistShortcut = useCallback(() => {
    setPlaylistShortcutOpen(false);
    setAppNavigationFocused(false);
  }, []);

  const openPlaylistShortcut = useCallback(() => {
    if (!playlistShortcutAvailable) return;
    setShowSettings(false);
    setSettingsPopupOpen(false);
    setDeckOpen(false);
    setPlaybackDrawer(null);
    setGuideChannelId("");
    setPlaylistShortcutOpen(true);
    appNavigationActionRef.current = "playlists";
    setAppNavigationAction("playlists");
    releaseAppNavigation();
  }, [playlistShortcutAvailable, releaseAppNavigation]);

  const focusAppNavigation = useCallback(() => {
    if (
      showSettings ||
      playlistShortcutOpen ||
      (!playlistRecovery && appMode !== "live" && vodDetailsOpen)
    )
      return;
    const preferred =
      searchRequest.open && searchRequest.mode === appMode
        ? "search"
        : (appNavigationItems.find((item) => item.id === appMode)?.id ?? enabledModes[0]);
    appNavigationActionRef.current = preferred;
    setAppNavigationAction(preferred);
    setAppNavigationFocused(true);
  }, [
    appMode,
    appNavigationItems,
    enabledModes,
    playlistShortcutOpen,
    playlistRecovery,
    searchRequest.mode,
    searchRequest.open,
    showSettings,
    vodDetailsOpen,
  ]);

  const fullScreenPage =
    showSettings ||
    playlistShortcutOpen ||
    (!playlistRecovery && appMode !== "live" && vodDetailsOpen);
  const commitAppNavigation = useCallback(
    (item: AppNavigationItem) => {
      if (item.id === "playlists") {
        if (playlistShortcut) openPlaylistShortcut();
        return;
      }
      setPlaylistShortcutOpen(false);
      if (item.id === "search") {
        setShowSettings(false);
        if (!searchRequest.open || searchRequest.mode !== appMode) {
          setSearchRequest((request) => ({ id: request.id + 1, mode: appMode, open: true }));
        }
        if (playlistRecovery) void useChannels.getState().load(true);
        return;
      }
      setSearchRequest((request) => ({ id: request.id + 1, mode: appMode, open: false }));
      if (item.id === "settings") {
        openSettings();
        return;
      }
      setShowSettings(false);
      appNavigationActionRef.current = item.id;
      setAppNavigationAction(item.id);
      if (item.id === "live" && appMode === "live") {
        setLiveSurface("panel");
        setLiveEntryId((value) => value + 1);
      }
      changeMode(item.id);
      if (playlistRecovery) void useChannels.getState().load(true);
    },
    [
      appMode,
      changeMode,
      openPlaylistShortcut,
      openSettings,
      playlistShortcut,
      playlistRecovery,
      searchRequest.mode,
      searchRequest.open,
    ],
  );

  const playlistOwnerKey = `${activePlaylist?.id ?? ""}:${activePlaylist?.sourceVersion ?? 0}`;
  const [playlistHandoff, setPlaylistHandoff] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const pageTransition = usePageTransition<
    AppNavigationItem & { commit?: () => void; coverNavigation?: boolean }
  >({
    ownerKey:
      playlistHandoff &&
      (playlistOwnerKey === playlistHandoff.from || playlistOwnerKey === playlistHandoff.to)
        ? playlistHandoff.from
        : playlistOwnerKey,
    onCommit: (request) => {
      if (request.commit) request.commit();
      else commitAppNavigation(request);
    },
    onFinish: () => setPlaylistHandoff(null),
  });
  const {
    phase: pageTransitionPhase,
    motion: pageTransitionMotion,
    settlingRevision,
    request: requestPageTransition,
    cancel: cancelPageTransition,
    ready: readyPageTransition,
    onTransitionEnd: onPageTransitionEnd,
  } = pageTransition;

  useLayoutEffect(() => {
    const next = activePlaylist?.id ?? "";
    if (playbackOwner.current === next) return;
    const switched = !!playbackOwner.current;
    if (switched) resumeInitialLive.current = false;
    playbackOwner.current = next;
    vodToken.current += 1;
    if (playlistHandoff?.to !== playlistOwnerKey) cancelPageTransition();
    chrome.clear();
    if (playback.snapshot.target) playback.stop();
    rememberedLive.current = rememberedLiveChannel();
    setPendingLivePlaylistId(switched && next ? next : null);
    vodRequest.current = null;
    setDeckOpen(false);
    setPlaybackDrawer(null);
    setGuideChannelId("");
    setShowExit(false);
    setAppNavigationFocused(false);
    setVodPhase("browsing");
    setLiveSurface("panel");
    setLiveEntryId((value) => value + 1);
    const mode = rememberedMode();
    setAppMode(mode);
    if (mode !== "live") setVodMode(mode);
    setSearchRequest((request) => ({ id: request.id + 1, mode: "live", open: false }));
  }, [
    activePlaylist?.id,
    cancelPageTransition,
    chrome.clear,
    playback.snapshot.target,
    playback.stop,
    playlistHandoff,
    playlistOwnerKey,
  ]);

  useEffect(() => {
    if (
      !pendingLivePlaylistId ||
      pendingLivePlaylistId !== activePlaylist?.id ||
      lineupPlaylistId !== pendingLivePlaylistId ||
      appMode !== "live" ||
      playlistShortcutOpen ||
      showSettings ||
      loading ||
      !channels.length
    )
      return;
    const channel = channels.find((item) => item.id === rememberedLive.current) ?? channels[0];
    const token = vodToken.current;
    const timer = window.setTimeout(() => {
      if (vodToken.current !== token) return;
      setPendingLivePlaylistId(null);
      playback.start(channel);
      if (liveSurface === "panel") setLiveEntryId((value) => value + 1);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    activePlaylist?.id,
    appMode,
    channels,
    lineupPlaylistId,
    liveSurface,
    loading,
    pendingLivePlaylistId,
    playback.start,
    playlistShortcutOpen,
    showSettings,
  ]);

  const activateAppNavigation = useCallback(
    (item: AppNavigationItem) => {
      const active = playlistShortcutOpen
        ? "playlists"
        : showSettings
          ? "settings"
          : searchRequest.open && searchRequest.mode === appMode
            ? "search"
            : appMode;
      if (item.id === active) {
        cancelPageTransition();
        if (
          playlistRecovery &&
          (item.id === "live" ||
            item.id === "movie" ||
            item.id === "series" ||
            item.id === "search")
        ) {
          commitAppNavigation(item);
          releaseAppNavigation();
          return;
        }
        if (item.id === "settings") openSettings();
        if (item.id === "live") {
          setLiveSurface("panel");
          setLiveEntryId((value) => value + 1);
        }
        if (item.id === "movie" || item.id === "series") vodRef.current?.closeDetails();
        releaseAppNavigation();
        return;
      }
      appNavigationActionRef.current = item.id;
      setAppNavigationAction(item.id);
      releaseAppNavigation();
      if (item.id === "movie" || item.id === "series") void loadVodScreen();
      requestPageTransition(
        {
          ...item,
          coverNavigation: fullScreenPage || item.id === "settings" || item.id === "playlists",
        },
        { leaving: "fade", entering: "fade" },
      );
    },
    [
      appMode,
      cancelPageTransition,
      commitAppNavigation,
      fullScreenPage,
      openSettings,
      playlistShortcutOpen,
      playlistRecovery,
      releaseAppNavigation,
      requestPageTransition,
      searchRequest.mode,
      searchRequest.open,
      showSettings,
    ],
  );

  const requestContentTransition = useCallback(
    (
      commit: () => void,
      destination: AppNavigationItem["id"] = playlistShortcutOpen
        ? "playlists"
        : showSettings
          ? "settings"
          : appMode,
      coverNavigation = true,
    ) => {
      const item = appNavigationItems.find((entry) => entry.id === destination);
      if (!item) {
        commit();
        return;
      }
      requestPageTransition(
        { ...item, commit, coverNavigation },
        { leaving: "fade", entering: "fade" },
      );
    },
    [appMode, appNavigationItems, playlistShortcutOpen, requestPageTransition, showSettings],
  );
  const selectShortcutPlaylist = useCallback(
    (id: string) => {
      const target = useSettings.getState().playlists.find((playlist) => playlist.id === id);
      if (!target) return;
      // Preserve the exit fade across the intentional playlist owner change.
      const handoff = {
        from: playlistOwnerKey,
        to: `${target.id}:${target.sourceVersion ?? 0}`,
      };
      if (id !== useSettings.getState().activePlaylist()?.id) setPlaylistHandoff(handoff);
      requestContentTransition(() => {
        closePlaylistShortcut();
        if (id === useSettings.getState().activePlaylist()?.id) return;
        void activatePlaylist(id).catch((cause: unknown) => {
          chrome.say(cause instanceof Error ? cause.message : t("playlist.unavailable"), true);
          cancelPageTransition();
        });
      }, appMode);
    },
    [
      activatePlaylist,
      appMode,
      cancelPageTransition,
      chrome.say,
      closePlaylistShortcut,
      playlistOwnerKey,
      requestContentTransition,
      t,
    ],
  );
  const requestSettings = useCallback(
    (destination?: Parameters<typeof openSettings>[0]) =>
      requestContentTransition(() => openSettings(destination), "settings"),
    [openSettings, requestContentTransition],
  );
  const requestModeChange = useCallback(
    (mode: AppMode) => requestContentTransition(() => changeMode(mode), mode, fullScreenPage),
    [changeMode, fullScreenPage, requestContentTransition],
  );

  const onSearchClosed = useCallback((mode: AppMode, requestId: number) => {
    setSearchRequest((request) =>
      request.id === requestId && request.mode === mode && request.open
        ? { ...request, open: false }
        : request,
    );
  }, []);

  const playVod = useCallback(
    async (request: VodPlaybackRequest, replacement = false) => {
      const settings = useSettings.getState();
      const targetMode = request.kind === "movie" ? "movie" : "series";
      if (
        !availableContentModes(
          settings.activePlaylist()?.source.kind ?? "m3u",
          settings,
        ).includes(targetMode)
      ) {
        return;
      }
      const token = ++vodToken.current;
      chrome.cancelDigits();
      setLiveSurface("picture");
      if (replacement) {
        setDeckOpen(true);
        setPlaybackDrawer(null);
      } else {
        vodRequest.current = null;
        setVodPhase("resolving");
        setDeckOpen(false);
        setPlaybackDrawer(null);
      }
      const displayName =
        request.kind === "episode"
          ? formatEpisodePlaybackName(
              request.progress.parentName,
              request.name,
              request.progress.season,
              request.progress.episode,
            )
          : request.name;
      const item =
        request.kind === "movie"
          ? {
              key: request.itemKey,
              streamId: request.providerId ?? "",
              categoryKey: request.progress.categoryKey,
              name: request.name,
              logo: request.poster,
              directSource: request.directSource,
              ...(request.extension ? { extension: request.extension } : {}),
              year: request.year,
              rating: request.rating,
            }
          : {
              key: request.itemKey,
              episodeIdentity: request.progress.episodeIdentity ?? request.itemKey,
              ...(request.providerId ? { episodeId: request.providerId } : {}),
              directSource: request.directSource,
              ...(request.progress.directSourceFingerprint
                ? { directSourceFingerprint: request.progress.directSourceFingerprint }
                : {}),
              seriesKey: request.progress.parentKey ?? "",
              seasonKey: request.progress.season ?? ("unassigned" as const),
              ...(request.progress.season !== undefined
                ? { season: request.progress.season }
                : {}),
              ...(request.progress.episode !== undefined
                ? { number: request.progress.episode }
                : {}),
              name: displayName,
              ...(request.extension ? { extension: request.extension } : {}),
              providerOrder: 0,
              metadata: { rating: "", plot: "", releaseDate: "", image: "" },
            };
      let addresses: { url: string; fallbackUrl?: string };
      try {
        const { libraryPlaybackTarget } = await import("./stores/library");
        addresses = await libraryPlaybackTarget(item);
      } catch {
        if (vodToken.current !== token) return;
        if (!replacement) setVodPhase("browsing");
        chrome.say(t("library.failed"));
        return;
      }
      if (vodToken.current !== token) return;
      if (!replacement) setVodPhase("starting");
      window.setTimeout(() => {
        if (vodToken.current !== token) return;
        vodRequest.current = request;
        usePersonal.getState().beginProgressSession(request.itemKey, request.resumeAt);
        if (request.kind === "episode") {
          usePersonal.getState().rememberLast({
            playlistId: request.progress.playlistId,
            kind: "episode",
            itemKey: request.itemKey,
            categoryKey: request.progress.categoryKey,
          });
        }
        playback.start(
          {
            id: request.itemKey,
            playlistId: request.progress.playlistId,
            mode: "finite",
            kind: request.kind,
            name: displayName,
            group: request.categoryName,
            logo: request.poster,
            year: request.year,
            rating: request.rating,
            ...addresses,
            resumeAt: request.resumeAt,
            progress: request.progress,
          },
          { restart: request.restart },
        );
        setDeckOpen(true);
        setVodPhase("playing");
      }, 0);
    },
    [chrome.cancelDigits, chrome.say, playback.start, t],
  );

  const stepVod = useCallback(
    async (delta: -1 | 1) => {
      const token = ++vodToken.current;
      const request = vodRequest.current;
      if (!request) return;
      const at = request.siblingKeys.indexOf(request.itemKey);
      const itemKey = request.siblingKeys[at + delta];
      if (at < 0 || !itemKey) return;
      setDeckOpen(true);
      setPlaybackDrawer(null);
      const { useLibrary } = await import("./stores/library");
      const library = useLibrary.getState();
      if (request.kind === "movie") {
        await library.loadMovie(itemKey);
        if (vodToken.current !== token) return;
        const detail = useLibrary.getState().movieDetails[itemKey]?.value;
        if (!detail) return;
        const progress = useLibrary.getState().progressSeedFor(detail);
        if (!progress || vodToken.current !== token) return;
        const saved = usePersonal.getState().progressFor(itemKey);
        if (vodToken.current !== token) return;
        const categoryName =
          useLibrary
            .getState()
            .categoriesFor("movie")
            .find((category) => category.key === detail.categoryKey)?.name ??
          request.categoryName;
        void playVod(
          {
            ...request,
            itemKey,
            name: detail.name,
            categoryName,
            poster: detail.logo,
            year: detail.year,
            rating: detail.rating,
            directSource: detail.directSource,
            extension: detail.extension,
            providerId: detail.streamId,
            resumeAt: saved && !("legacyOrder" in saved) ? saved.seconds : 0,
            restart: false,
            progress,
          },
          true,
        );
        return;
      }
      const parent = request.progress.parentKey
        ? useLibrary.getState().seriesDetails[request.progress.parentKey]?.value
        : undefined;
      const episode = parent?.episodes.find((item) => item.key === itemKey);
      if (!parent || !episode) return;
      const progress = useLibrary.getState().progressSeedFor(episode, parent);
      if (!progress) return;
      const saved = usePersonal.getState().progressFor(itemKey);
      if (vodToken.current !== token) return;
      void playVod(
        {
          ...request,
          itemKey,
          name: episode.name,
          directSource: episode.directSource,
          extension: episode.extension,
          providerId: episode.episodeId,
          resumeAt: saved && !("legacyOrder" in saved) ? saved.seconds : 0,
          restart: false,
          progress,
        },
        true,
      );
    },
    [playVod],
  );

  const guideChannel = channels.find((channel) => channel.id === guideChannelId);
  const playlistWarning =
    errorKey === "playlist.refreshFailed" && !loading && !playback.snapshot.fault
      ? t(errorKey, { detail: errorDetail })
      : "";
  useEffect(() => {
    if (playlistWarning) chrome.say(playlistWarning, true);
  }, [chrome.say, playlistWarning]);
  const modalSurface = showSettings
    ? "settings"
    : showExit
      ? "exit"
      : !configured
        ? "onboarding"
        : null;
  const surfaceStack = useMemo<SurfaceStack>(
    () => ({
      picture: "picture",
      primary: playlistShortcutOpen
        ? "playlists"
        : playlistRecovery
          ? null
          : appMode !== "live" && vodPhase !== "playing"
            ? "vod"
            : deckOpen && !playback.snapshot.fault
              ? "playback-deck"
              : liveSurface === "panel"
                ? "panel"
                : null,
      drawer: vodInfoOpen ? "details" : guideChannel ? "guide" : playbackDrawer,
      modal: modalSurface,
      popup: settingsPopupOpen ? "confirmation" : null,
    }),
    [
      appMode,
      deckOpen,
      guideChannel,
      playback.snapshot.fault,
      liveSurface,
      modalSurface,
      playbackDrawer,
      playlistRecovery,
      playlistShortcutOpen,
      settingsPopupOpen,
      vodPhase,
      vodInfoOpen,
    ],
  );
  const surface: SurfaceId = activeSurface(surfaceStack);
  const handleAppNavigationKey = useCallback(
    (code: number, event: KeyboardEvent): boolean => {
      if (!appNavigationFocused) return false;
      const index = appNavigationItems.findIndex(
        (item) => item.id === appNavigationActionRef.current,
      );
      const item = appNavigationItems[index];
      const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
      const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
      if (code === KEY.UP || code === KEY.DOWN) {
        const next = Math.max(
          0,
          Math.min(appNavigationItems.length - 1, index + (code === KEY.DOWN ? 1 : -1)),
        );
        const nextItem = appNavigationItems[next];
        if (nextItem && next !== index) {
          appNavigationActionRef.current = nextItem.id;
          setAppNavigationAction(nextItem.id);
        }
        event.preventDefault();
        return true;
      }
      if (code === inlineStart) {
        event.preventDefault();
        return true;
      }
      if (code === inlineEnd) {
        event.preventDefault();
        const active = playlistShortcutOpen
          ? "playlists"
          : showSettings
            ? "settings"
            : searchRequest.open && searchRequest.mode === appMode
              ? "search"
              : appMode;
        if (item && item.id !== active) activateAppNavigation(item);
        else {
          cancelPageTransition();
          releaseAppNavigation();
        }
        return true;
      }
      if (code === KEY.BACK || code === KEY.ESC) {
        cancelPageTransition();
        setAppNavigationFocused(false);
        event.preventDefault();
        return true;
      }
      if (code === KEY.ENTER) {
        event.preventDefault();
        if (item) activateAppNavigation(item);
        return true;
      }
      return false;
    },
    [
      activateAppNavigation,
      appMode,
      appNavigationFocused,
      cancelPageTransition,
      releaseAppNavigation,
      appNavigationItems,
      direction,
      playlistShortcutOpen,
      searchRequest.mode,
      searchRequest.open,
      showSettings,
    ],
  );

  useRemote(
    useCallback(
      (code, event) => {
        if (event.defaultPrevented) return;
        if (pageTransitionPhase === "leaving") {
          if (code === KEY.BACK || code === KEY.ESC) {
            cancelPageTransition();
            event.preventDefault();
            return;
          }
          if (
            code === KEY.UP ||
            code === KEY.DOWN ||
            code === KEY.LEFT ||
            code === KEY.RIGHT ||
            code === KEY.ENTER
          )
            event.preventDefault();
          return;
        }
        if (playlistHandoff) {
          event.preventDefault();
          return;
        }
        if (appNavigationFocused) handleAppNavigationKey(code, event);
      },
      [
        appNavigationFocused,
        cancelPageTransition,
        handleAppNavigationKey,
        pageTransitionPhase,
        playlistHandoff,
      ],
    ),
    true,
  );
  useRemote(
    useCallback(
      (code, event) => {
        if (event.defaultPrevented || pageTransitionPhase === "leaving" || playlistHandoff)
          return;
        if (surface !== "vod" && surface !== "playlists") return;
        if (code === KEY.YELLOW) {
          requestSettings();
          event.preventDefault();
          return;
        }
        if (surface === "vod") vodRef.current?.handleKey(code, event);
      },
      [requestSettings, pageTransitionPhase, playlistHandoff, surface],
    ),
  );

  /*
   * The compact status belongs to an uncovered picture with something already shown: the
   * deck, a drawer, the browser and every modal cover it, connecting, paused and failed
   * own the middle of the picture, and a target that has never played gets the full
   * panel instead of a corner note.
   */
  const recoveryHidden = surface !== "picture" || !playback.recovery.hasPlayed;
  const compactRecoveryVisible = isRecoveryStatusVisible(playback.recovery, recoveryHidden);
  const loadingSplashVisible =
    loading &&
    (!channels.length || lineupPlaylistId !== activePlaylist?.id) &&
    !showSettings &&
    !playlistShortcutOpen;
  const clockVisible =
    showClock &&
    !loadingSplashVisible &&
    ((appMode === "live" && surface === "panel") ||
      (surface === "playback-deck" && !!playback.snapshot.target) ||
      (surface === "picture" &&
        playback.shown?.mode === "live" &&
        chrome.banner &&
        !playback.snapshot.fault));
  // Exit covers the picture without changing the rail's animation coordinates.
  // Loading must not reveal navigation hidden for resume or change its motion owner.
  const livePanelMotion =
    appMode === "live" && !playlistShortcutOpen && !showSettings && !playlistRecovery;
  const appNavigationVisible =
    configured &&
    !fullScreenPage &&
    (playlistRecovery ||
      appNavigationFocused ||
      (appMode !== "live" ? vodPhase !== "playing" : liveSurface === "panel"));
  const activeNavigationAction =
    (playlistShortcutOpen ? "playlists" : pageTransition.requestedTarget?.id) ??
    (showSettings
      ? "settings"
      : searchRequest.open && searchRequest.mode === appMode
        ? "search"
        : appMode);
  const appNavigationExpanded =
    appNavigationVisible && appNavigationFocused && pageTransitionPhase === "idle";
  const navigationRestoring =
    loadingSplashVisible ||
    (appMode === "live" &&
      !playlistRecovery &&
      channels.length > 0 &&
      pendingLivePlaylistId !== null);
  const navigationPresentation = useRef({
    fullScreen: fullScreenPage,
    expanded: appNavigationExpanded,
    restoring: navigationRestoring,
  });
  const [navigationReturning, setNavigationReturning] = useState(false);
  const navigationStatic =
    fullScreenPage ||
    navigationPresentation.current.fullScreen ||
    navigationRestoring ||
    navigationPresentation.current.restoring ||
    navigationReturning ||
    pageTransitionPhase !== "idle";
  const navigationPresentedExpanded =
    fullScreenPage ||
    (pageTransitionPhase === "leaving" && pageTransition.requestedTarget?.coverNavigation)
      ? navigationPresentation.current.expanded
      : appNavigationExpanded;
  useLayoutEffect(() => {
    if (appNavigationVisible && pageTransitionPhase === "idle") {
      navigationPresentation.current.expanded = appNavigationExpanded;
    }
  }, [appNavigationExpanded, appNavigationVisible, pageTransitionPhase]);
  useLayoutEffect(() => {
    const returning =
      (navigationPresentation.current.fullScreen || navigationPresentation.current.restoring) &&
      !fullScreenPage &&
      !navigationRestoring;
    navigationPresentation.current.fullScreen = fullScreenPage;
    navigationPresentation.current.restoring = navigationRestoring;
    if (!returning) {
      if (fullScreenPage || navigationRestoring) setNavigationReturning(false);
      return;
    }
    setNavigationReturning(true);
    // Keep transitions disabled through the first restored paint.
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => setNavigationReturning(false));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fullScreenPage, navigationRestoring]);

  const vodPageReadyContext = useRef({
    appMode,
    pageTransitionPhase,
    readyPageTransition,
    showSettings,
  });
  vodPageReadyContext.current = {
    appMode,
    pageTransitionPhase,
    readyPageTransition,
    showSettings,
  };
  // A new revision must still wake the child's readiness effect. Phase changes need not.
  const vodPageReady = useCallback(
    (readyMode: AppMode) => {
      const context = vodPageReadyContext.current;
      if (
        context.pageTransitionPhase === "settling" &&
        !context.showSettings &&
        context.appMode !== "live" &&
        readyMode === context.appMode
      ) {
        context.readyPageTransition(settlingRevision);
      }
    },
    [settlingRevision],
  );
  const vodReturnLive = useCallback(() => {
    if (enabledModes.includes("live")) changeMode("live");
    else focusAppNavigation();
  }, [changeMode, enabledModes, focusAppNavigation]);
  const requestVodReturnLive = useCallback(
    () => requestContentTransition(vodReturnLive, "live", fullScreenPage),
    [fullScreenPage, requestContentTransition, vodReturnLive],
  );
  const vodPlayRequest = useCallback(
    (request: VodPlaybackRequest) => void playVod(request),
    [playVod],
  );

  useLayoutEffect(() => {
    if (pageTransitionPhase === "idle") return;
    if (showExit || settingsPopupOpen) {
      cancelPageTransition();
    }
  }, [cancelPageTransition, pageTransitionPhase, settingsPopupOpen, showExit]);
  const liveVisible =
    playlistRecovery || appMode === "live" || vodPhase === "starting" || vodPhase === "playing";
  const vodVisible =
    !playlistRecovery &&
    activePlaylist?.source.kind === "xtream" &&
    appMode !== "live" &&
    vodPhase !== "playing";
  const vodPageVisible = vodVisible && !showSettings && !playlistShortcutOpen;

  /*
   * A visible VOD screen answers readiness itself through onPageReady once mounted,
   * lazy chunk included. Every other committed destination is already in the DOM.
   */
  useLayoutEffect(() => {
    if (pageTransitionPhase !== "settling" || vodPageVisible) return;
    readyPageTransition(settlingRevision);
  }, [pageTransitionPhase, readyPageTransition, settlingRevision, vodPageVisible]);

  return (
    <div
      ref={appRef}
      className={`app ${fullScreenPage ? "full-screen-page" : ""} ${navigationStatic ? "navigation-static" : ""} ${appNavigationVisible ? "app-navigation-visible" : ""} ${appNavigationVisible && navigationPresentedExpanded ? "app-navigation-expanded" : ""} ${showSettings ? "settings-open" : ""} ${showSettings && settingsPopupOpen ? "settings-popup-open" : ""} ${livePanelMotion ? "live-panel-motion" : ""} ${pageTransitionPhase !== "idle" ? "page-transition-active" : ""}`}
      data-page-transition={pageTransitionPhase}
      data-page-fade-scope={
        fullScreenPage || pageTransition.requestedTarget?.coverNavigation ? "screen" : "content"
      }
      data-page-leave-motion={pageTransitionMotion.leaving}
      data-page-enter-motion={pageTransitionMotion.entering}
      dir={direction}
      onPointerDownCapture={(event) => {
        const target = event.target;
        const focused = document.activeElement;
        if (
          !(target instanceof Element) ||
          target.closest("button, input, select, textarea, a, [tabindex]") ||
          !(focused instanceof HTMLButtonElement) ||
          !event.currentTarget.contains(focused)
        )
          return;
        window.setTimeout(() => {
          if (focused.isConnected) focused.focus();
        }, 0);
      }}
      onDoubleClick={toggleFullscreen}
    >
      <div className="app-content">
        {configured && (
          <div
            className={`live-host ${liveVisible ? "" : "hidden"}`.trim()}
            aria-hidden={!liveVisible || playlistShortcutOpen}
          >
            <LiveScreen
              key={activePlaylist?.id}
              hostVisible={liveVisible}
              surface={surface}
              liveSurface={liveSurface}
              onLiveSurfaceChange={setLiveSurface}
              panelHost={livePanelHost}
              entryRequestId={liveEntryId}
              guideChannelId={guideChannelId}
              onGuideChannelChange={setGuideChannelId}
              deckOpen={deckOpen}
              compactRecoveryVisible={compactRecoveryVisible}
              onDeckOpenChange={setDeckOpen}
              playbackDrawer={playbackDrawer}
              onPlaybackDrawerChange={setPlaybackDrawer}
              playback={playback}
              chrome={chrome}
              videoRef={videoRef}
              onAppNavigationFocus={focusAppNavigation}
              onContentFocus={releaseAppNavigation}
              searchRequest={searchRequest}
              onSearchClosed={onSearchClosed}
              navigationTransitionActive={pageTransitionPhase !== "idle"}
              onOpenSettings={requestSettings}
              onChoosePlaylist={() =>
                requestSettings({
                  section: "playlists",
                  playlistId: activePlaylist?.id,
                  loadError: errorKey ? t(errorKey, { detail: errorDetail }) : error,
                })
              }
              recoveryContext={
                appNavigationItems.find(
                  (item) =>
                    item.id ===
                    (searchRequest.open && searchRequest.mode === appMode ? "search" : appMode),
                )?.label
              }
              onRequestExit={requestExit}
              onFiniteReturn={
                vodPhase === "playing"
                  ? () => {
                      vodToken.current += 1;
                      playback.stop();
                      vodRequest.current = null;
                      setVodPhase("browsing");
                      setLiveSurface("picture");
                      setDeckOpen(false);
                      setPlaybackDrawer(null);
                    }
                  : undefined
              }
              onFiniteStep={vodPhase === "playing" ? (delta) => void stepVod(delta) : undefined}
              finiteStepAvailable={
                vodPhase === "playing"
                  ? (delta) => {
                      const request = vodRequest.current;
                      if (!request) return false;
                      const at = request.siblingKeys.indexOf(request.itemKey);
                      return at >= 0 && !!request.siblingKeys[at + delta];
                    }
                  : undefined
              }
              playbackPending={vodPhase === "resolving" || vodPhase === "starting"}
              resumeLiveOnMount={
                resumeInitialLive.current &&
                playbackOwner.current === activePlaylist?.id &&
                appMode === "live" &&
                showLive
              }
              resumeChannelId={initialLiveChannel}
              inputEnabled={
                pageTransitionPhase !== "leaving" &&
                !playlistHandoff &&
                !appNavigationFocused &&
                !showSettings &&
                !showExit &&
                !playlistShortcutOpen &&
                (playlistRecovery || appMode === "live" || vodPhase === "playing")
              }
            />
          </div>
        )}
        {configured && activePlaylist?.source.kind === "xtream" && (
          <div
            className={`vod-host ${vodVisible ? "" : "hidden"}`.trim()}
            aria-hidden={!vodVisible || playlistShortcutOpen}
          >
            <Suspense fallback={null}>
              <MemoVodScreen
                key={activePlaylist.id}
                ref={vodRef}
                mode={vodMode}
                playlist={activePlaylist}
                scale={scale}
                active={
                  vodVisible &&
                  pageTransitionPhase !== "leaving" &&
                  !playlistHandoff &&
                  !appNavigationFocused &&
                  !playlistShortcutOpen &&
                  !showSettings &&
                  !showExit
                }
                visible={vodPageVisible}
                playbackPending={vodPhase === "resolving" || vodPhase === "starting"}
                onCancelPending={cancelPendingVod}
                onAppNavigationFocus={focusAppNavigation}
                onContentFocus={releaseAppNavigation}
                onAnnounce={chrome.say}
                searchRequest={searchRequest}
                onSearchClosed={onSearchClosed}
                onPageReady={vodPageReady}
                onDetailsOpenChange={setVodDetailsOpen}
                onInfoOpenChange={setVodInfoOpen}
                onPageTransition={requestContentTransition}
                onModeChange={requestModeChange}
                onSettings={requestSettings}
                onRequestExit={requestExit}
                onReturnLive={requestVodReturnLive}
                onPlay={vodPlayRequest}
              />
            </Suspense>
          </div>
        )}
        {configured && playlistShortcutOpen && (
          <PlaylistShortcut
            playlists={playlists}
            activePlaylistId={activePlaylist?.id ?? ""}
            scale={scale}
            inputEnabled={
              surface === "playlists" &&
              !appNavigationFocused &&
              pageTransitionPhase !== "leaving"
            }
            onSelect={selectShortcutPlaylist}
            onManage={() => requestSettings({ section: "playlists", savedPlaylists: true })}
            onClose={() => requestContentTransition(closePlaylistShortcut, appMode)}
            onContentFocus={() => setAppNavigationFocused(false)}
          />
        )}
      </div>
      <div className="top-strip">
        <RecoveryStatus state={playback.recovery} hidden={recoveryHidden} />
        {clockVisible && <Clock />}
      </div>
      {configured && (
        <div className="app-navigation-motion">
          <AppNavigation
            visible={appNavigationVisible}
            activeMode={appMode}
            items={appNavigationItems}
            focused={appNavigationVisible && appNavigationFocused}
            expanded={navigationPresentedExpanded}
            activeAction={activeNavigationAction}
            focusedAction={appNavigationFocused ? appNavigationAction : undefined}
            onActivate={activateAppNavigation}
            onHover={(item) => {
              appNavigationActionRef.current = item.id;
              setAppNavigationAction(item.id);
              setAppNavigationFocused(true);
            }}
            onFocusChange={(focused) => {
              if (!appNavigationVisible) return;
              if (focused && !appNavigationFocused) focusAppNavigation();
              else if (!focused && pageTransitionPhase === "idle") {
                setAppNavigationFocused(focused);
              }
            }}
          />
          <div
            className="live-panel-host"
            ref={setLivePanelHost}
            hidden={playlistShortcutOpen}
            aria-hidden={!livePanelMotion || playlistShortcutOpen}
            onTransitionEnd={onPageTransitionEnd}
          />
        </div>
      )}

      {configured && (
        <div
          className={`settings-host ${showSettings ? "" : "hidden"}`.trim()}
          aria-hidden={!showSettings}
        >
          <Settings
            key={settingsEntry.session}
            entry={settingsEntry}
            onClose={() => requestContentTransition(() => setShowSettings(false), appMode)}
            onPageTransition={requestContentTransition}
            onPopupChange={setSettingsPopupOpen}
            remoteAccess={remoteAccess}
            showRemoteAccess={remoteAccessSupported}
            inputEnabled={
              showSettings && !appNavigationFocused && pageTransitionPhase !== "leaving"
            }
          />
        </div>
      )}
      {configured && (
        <div
          className="page-transition-shade"
          aria-hidden="true"
          onTransitionEnd={onPageTransitionEnd}
        />
      )}
      {showExit && (
        <ExitDialog onConfirm={() => playback.stop()} onCancel={() => setShowExit(false)} />
      )}
      {!configured && (
        <Onboarding
          onAdd={async (name, source, onState, signal) => {
            const validation = await validatePlaylist(name, source, signal);
            if (validation.cancelled || signal?.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            if (validation.error) {
              throw new PlaylistEntryFeedbackError(
                validation.errorKey ?? "playlist.entryNetwork",
              );
            }
            if (useSettings.getState().playlists.length > 0) {
              throw new DOMException("Aborted", "AbortError");
            }
            onState?.("saving");
            addPlaylist(name, source);
            const playlist = useSettings.getState().activePlaylist();
            if (!playlist) return;
            const savedId = playlist.id;
            const savedVersion = playlist.sourceVersion;
            let activation: Awaited<ReturnType<typeof activatePlaylist>> | null = null;
            try {
              activation = await activatePlaylist(playlist.id);
            } catch {
              activation = null;
            }
            const current = useSettings.getState();
            const stillActive =
              current.activePlaylistId === savedId &&
              current.activePlaylist()?.sourceVersion === savedVersion;
            if (!stillActive) return;
            if (!activation) {
              const message = t("playlist.entryNetwork");
              useChannels.setState({
                loading: false,
                error: message,
                errorKey: "playlist.entryNetwork",
                errorDetail: "",
              });
              entryToast.show(message, "error");
              return;
            }
            if (activation.error) {
              entryToast.show(
                activation.errorKey
                  ? t(activation.errorKey, { detail: activation.errorDetail ?? "" })
                  : activation.error,
                "error",
              );
              return;
            }
            useSetup.getState().clear();
            entryToast.show(
              activation.count > 0
                ? t("playlist.loaded", { name: playlist.name, count: activation.count })
                : t("playlist.savedNoChannels", { name: playlist.name }),
              activation.count > 0 ? "success" : "information",
            );
          }}
          onError={(message) => entryToast.show(message, "error")}
          onClearFeedback={entryToast.clear}
          onExit={exitApp}
          remoteAccess={remoteAccess}
          onOpenPairing={remoteAccess.openPairing}
          showRemoteSetup={remoteAccessSupported}
        />
      )}

      {chrome.digits && <div className="digits">{chrome.digits}</div>}
      <ToastHost
        avoidPlayback={
          configured && !modalSurface && (appMode === "live" || vodPhase === "playing")
        }
        layoutKey={`${deckOpen}:${playbackDrawer}:${!!guideChannel}`}
      />

      {configured && <PointerPad shown={pointerAwake} />}
      {import.meta.env.DEV && remoteVisible() && <SmartRemote />}
    </div>
  );
}
