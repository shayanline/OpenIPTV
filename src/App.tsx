import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Clock } from "./components/Clock";
import { ExitDialog, exitApp } from "./components/ExitDialog";
import { Onboarding } from "./components/Onboarding";
import { PointerPad } from "./components/PointerPad";
import { Settings } from "./components/Settings";
import { SmartRemote, remoteVisible } from "./components/SmartRemote";
import { RecoveryStatus } from "./components/playback/RecoveryStatus";
import { useChrome } from "./hooks/useChrome";
import { useLocale } from "./hooks/useLocale";
import { usePointerAwake } from "./hooks/usePointerAwake";
import { KEY, registerRemoteKeys, useRemote } from "./hooks/useRemote";
import { useRemoteAccess } from "./hooks/useRemoteAccess";
import { usePlaybackController } from "./hooks/usePlaybackController";
import { LiveScreen } from "./screens/LiveScreen";
import type { VodPlaybackRequest, VodScreenHandle } from "./screens/VodScreen";
import { hasPairedDevices, subscribePairedDevices } from "./services/deviceAccess";
import { whenIdle } from "./services/idle";
import { applyDocumentLocale, type MessageKey } from "./services/locale";
import { onTizen } from "./services/player";
import { developmentRemoteAccess } from "./services/remoteServer";
import { read, write } from "./services/store";
import {
  activeSurface,
  type AppMode,
  type PlaybackDrawerSurface,
  type LiveSurface,
  type SurfaceId,
  type SurfaceStack,
} from "./services/surfaceStack";
import { useChannels } from "./stores/channels";
import { useLineup } from "./stores/lineup";
import { usePersonal } from "./stores/personal";
import { useSettings } from "./stores/settings";
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
  const playlist = useSettings.getState().activePlaylist();
  if (playlist?.source.kind !== "xtream") return "live";
  const saved = read(`app:last-mode:${playlist.id}`);
  return saved === "movie" || saved === "series" ? saved : "live";
};

const rememberedLiveChannel = () => {
  const playlist = useSettings.getState().activePlaylist();
  if (!playlist) return "";
  const saved = read(`app:last-live:${playlist.id}`);
  const last = usePersonal.getState().lastPlayed;
  return saved || (last?.kind === "live" ? last.itemKey : "");
};

export default function App() {
  const VodScreen = loadedVodScreen ?? LazyVodScreen;
  const { load, sweep, error, errorKey, errorDetail } = useChannels();
  const { channels } = useLineup();
  const settings = useSettings();
  const configured = settings.playlists.length > 0;
  const { locale, direction, t } = useLocale();
  const [liveSurface, setLiveSurface] = useState<LiveSurface>(() =>
    useSettings.getState().resumeLast && usePersonal.getState().hasRememberedLast()
      ? "picture"
      : "panel",
  );
  const [appMode, setAppMode] = useState<AppMode>(rememberedMode);
  const [vodPhase, setVodPhase] = useState<"browsing" | "resolving" | "starting" | "playing">(
    "browsing",
  );
  const vodRef = useRef<VodScreenHandle>(null);
  const rememberedLive = useRef(rememberedLiveChannel());
  const vodRequest = useRef<VodPlaybackRequest | null>(null);
  const vodToken = useRef(0);
  const [guideChannelId, setGuideChannelId] = useState("");
  const [deckOpen, setDeckOpen] = useState(false);
  const [playbackDrawer, setPlaybackDrawer] = useState<PlaybackDrawerSurface | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPopupOpen, setSettingsPopupOpen] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const requestExit = useCallback(() => setShowExit(true), []);
  const chrome = useChrome();
  const openSettings = useCallback(() => {
    vodToken.current += 1;
    setVodPhase((phase) =>
      phase === "resolving" || phase === "starting" ? "browsing" : phase,
    );
    chrome.cancelDigits();
    setShowSettings(true);
  }, [chrome.cancelDigits]);
  const pointerAwake = usePointerAwake();

  const developmentRemoteAccessEnabled = developmentRemoteAccess();
  const remoteAccessSupported = onTizen() || developmentRemoteAccessEnabled;
  const hasRemoteDevices = useSyncExternalStore(
    subscribePairedDevices,
    hasPairedDevices,
    () => false,
  );
  const remoteAccess = useRemoteAccess(
    remoteAccessSupported && (!configured || showSettings || hasRemoteDevices),
    developmentRemoteAccessEnabled,
  );

  useLayoutEffect(() => {
    applyDocumentLocale(locale);
  }, [locale]);

  useEffect(() => {
    registerRemoteKeys();
    void load();
    return whenIdle(() => void sweep(), 8000);
  }, [load, sweep]);

  const appRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void appRef.current?.requestFullscreen?.();
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

  const named = useCallback(() => chrome.holdBanner(), [chrome.holdBanner]);
  const pictured = useCallback(() => chrome.raiseBanner(), [chrome.raiseBanner]);
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
    fit: settings.aspectId,
    video: videoRef,
    compatibility: settings.compatibility,
    continuousReconnect: settings.continuousReconnect,
    onNamed: named,
    onPicture: pictured,
    onMessage: message,
    onEnded: playbackEnded,
    onStopped: playbackStopped,
    rememberLast: rememberLive,
  });

  useEffect(() => {
    playback.setMuted(showSettings && !!playback.snapshot.target);
  }, [showSettings, playback.snapshot.target, playback.setMuted]);

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
      if (mode === appMode) {
        cancelPendingVod();
        return;
      }
      vodToken.current += 1;
      chrome.cancelDigits();
      const playlist = useSettings.getState().activePlaylist();
      if (playlist) write(`app:last-mode:${playlist.id}`, mode);
      if (mode === "live") {
        setAppMode("live");
        setVodPhase("browsing");
        vodRequest.current = null;
        setLiveSurface("picture");
        const channel =
          channels.find((item) => item.id === rememberedLive.current) ?? channels[0];
        if (channel) {
          const token = vodToken.current;
          window.setTimeout(() => {
            if (vodToken.current === token) playback.start(channel);
          }, 0);
        }
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
    [
      appMode,
      cancelPendingVod,
      channels,
      chrome.cancelDigits,
      playback.snapshot.target,
      playback.start,
      playback.stop,
    ],
  );

  const playVod = useCallback(
    async (request: VodPlaybackRequest) => {
      const token = ++vodToken.current;
      chrome.cancelDigits();
      vodRequest.current = null;
      setVodPhase("resolving");
      setDeckOpen(false);
      setPlaybackDrawer(null);
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
              year: "",
              rating: "",
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
              name: request.name,
              ...(request.extension ? { extension: request.extension } : {}),
              providerOrder: 0,
              metadata: { rating: "", plot: "", releaseDate: "", image: "" },
            };
      let url: string;
      try {
        const { libraryPlaybackUrl } = await import("./stores/library");
        url = await libraryPlaybackUrl(item);
      } catch {
        if (vodToken.current !== token) return;
        setVodPhase("browsing");
        chrome.say(t("library.failed"));
        return;
      }
      if (vodToken.current !== token) return;
      setVodPhase("starting");
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
            name: request.name,
            group: request.categoryName,
            logo: request.poster,
            url,
            resumeAt: request.resumeAt,
            progress: request.progress,
          },
          { restart: request.restart },
        );
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
        void playVod({
          ...request,
          itemKey,
          name: detail.name,
          poster: detail.logo,
          directSource: detail.directSource,
          extension: detail.extension,
          providerId: detail.streamId,
          resumeAt: saved && !("legacyOrder" in saved) ? saved.seconds : 0,
          restart: false,
          progress,
        });
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
      void playVod({
        ...request,
        itemKey,
        name: episode.name,
        directSource: episode.directSource,
        extension: episode.extension,
        providerId: episode.episodeId,
        resumeAt: saved && !("legacyOrder" in saved) ? saved.seconds : 0,
        restart: false,
        progress,
      });
    },
    [playVod],
  );

  const guideChannel = channels.find((channel) => channel.id === guideChannelId);
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
      primary:
        appMode !== "live" && vodPhase !== "playing"
          ? "vod"
          : deckOpen
            ? "playback-deck"
            : liveSurface === "panel"
              ? "panel"
              : null,
      drawer: guideChannel ? "guide" : playbackDrawer,
      modal: modalSurface,
      popup: settingsPopupOpen ? "confirmation" : null,
    }),
    [
      appMode,
      deckOpen,
      guideChannel,
      liveSurface,
      modalSurface,
      playbackDrawer,
      settingsPopupOpen,
      vodPhase,
    ],
  );
  const surface: SurfaceId = activeSurface(surfaceStack);
  useRemote(
    useCallback(
      (code, event) => {
        if (event.defaultPrevented) return;
        if (surface === "vod") {
          if (code === KEY.YELLOW) {
            openSettings();
            event.preventDefault();
            return;
          }
          vodRef.current?.handleKey(code, event);
          return;
        }
      },
      [openSettings, surface],
    ),
  );
  /*
   * The compact status belongs to an uncovered live picture only: the deck, a drawer, the
   * browser and every modal cover it, finite playback answers faults through its own deck,
   * and connecting, paused and failed already own the middle of the picture.
   */
  const recoveryHidden =
    surface !== "picture" ||
    playback.snapshot.target?.mode !== "live" ||
    !playback.recovery.hasPlayed;
  const activePlaylist = settings.activePlaylist();

  return (
    <div ref={appRef} className="app" dir={direction}>
      {(appMode === "live" || vodPhase === "starting" || vodPhase === "playing") && (
        <LiveScreen
          surface={surface}
          liveSurface={liveSurface}
          onLiveSurfaceChange={setLiveSurface}
          guideChannelId={guideChannelId}
          onGuideChannelChange={setGuideChannelId}
          deckOpen={deckOpen}
          onDeckOpenChange={setDeckOpen}
          playbackDrawer={playbackDrawer}
          onPlaybackDrawerChange={setPlaybackDrawer}
          playback={playback}
          chrome={chrome}
          videoRef={videoRef}
          onToggleFullscreen={toggleFullscreen}
          onOpenSettings={openSettings}
          onRequestExit={requestExit}
          onModeChange={changeMode}
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
          resumeLiveOnMount={appMode === "live"}
          inputEnabled={appMode === "live" || vodPhase === "playing"}
        />
      )}
      {appMode !== "live" && activePlaylist?.source.kind === "xtream" && (
        <div className={`vod-host ${vodPhase === "playing" ? "hidden" : ""}`}>
          <Suspense fallback={null}>
            <VodScreen
              ref={vodRef}
              mode={appMode}
              playlist={activePlaylist}
              scale={settings.scale()}
              active={vodPhase !== "playing"}
              playbackPending={vodPhase === "resolving" || vodPhase === "starting"}
              onCancelPending={cancelPendingVod}
              onModeChange={changeMode}
              onSettings={openSettings}
              onReturnLive={() => changeMode("live")}
              onPlay={(request) => void playVod(request)}
            />
          </Suspense>
        </div>
      )}

      <div className="top-strip">
        <RecoveryStatus state={playback.recovery} hidden={recoveryHidden} />
        {settings.showClock && !showSettings && <Clock />}
      </div>

      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onPopupChange={setSettingsPopupOpen}
          remoteAccess={remoteAccess}
          showRemoteAccess={remoteAccessSupported}
        />
      )}
      {showExit && (
        <ExitDialog
          watching={!!playback.snapshot.target && !playback.snapshot.fault}
          onConfirm={() => playback.stop()}
          onCancel={() => setShowExit(false)}
        />
      )}
      {!configured && (
        <Onboarding
          onAdd={(name, url) => {
            settings.addPlaylist(name, url);
            void load(true);
          }}
          onExit={exitApp}
          remoteAccess={remoteAccess}
          onOpenPairing={remoteAccess.openPairing}
          showRemoteSetup={remoteAccessSupported}
        />
      )}

      {chrome.digits && <div className="digits">{chrome.digits}</div>}
      {chrome.toast && <div className="toast">{chrome.toast}</div>}
      {error && !playback.snapshot.fault && (
        <div className="toast warn">
          {errorKey ? t(errorKey, { detail: errorDetail }) : error}
        </div>
      )}

      {configured && <PointerPad shown={pointerAwake} />}
      {import.meta.env.DEV && remoteVisible() && <SmartRemote />}
    </div>
  );
}
