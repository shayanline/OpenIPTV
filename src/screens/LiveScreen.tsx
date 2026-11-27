import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Chrome } from "../hooks/useChrome";
import type { PlaybackController } from "../hooks/usePlaybackController";
import { useChannels } from "../stores/channels";
import { applyLineupMutation, useLineup } from "../stores/lineup";
import { usePersonal } from "../stores/personal";
import { useLibrary, type ChannelGuide, type GuideProgramme } from "../stores/library";
import { useSettings } from "../stores/settings";
import { onTizen } from "../services/player";
import { type SeekHold, seekStepFromKey } from "../services/playbackRange";
import { warmChain } from "../services/logos";
import { cssMs } from "../services/metrics";
import {
  isFavouritesList,
  lineupOf,
  stepColumn,
  type ChannelList as LineupList,
} from "../services/lineup";
import { UNCATEGORISED } from "../services/m3u";
import { searchChannels } from "../services/search";
import { KEY, useRemote } from "../hooks/useRemote";
import { useLongPress } from "../hooks/useLongPress";
import { ChannelList } from "../components/ChannelList";
import { Sidebar } from "../components/Sidebar";
import { PlaybackBanner } from "../components/PlaybackBanner";
import { PlaybackInfo } from "../components/PlaybackInfo";
import { PictureState } from "../components/PictureState";
import { KeyGuide } from "../components/KeyGuide";
import { Icon } from "../components/Icon";
import {
  PlaybackDeck,
  type PlaybackDeckAction,
  type PlaybackDeckFocus,
  type PlaybackDeckMetadata,
} from "../components/playback/PlaybackDeck";
import { PlaybackDetails } from "../components/playback/PlaybackDetails";
import { PlaybackDrawer } from "../components/playback/PlaybackDrawer";
import { QuickSeek } from "../components/playback/QuickSeek";
import { SubtitleLayer } from "../components/playback/SubtitleLayer";
import { TrackPicker } from "../components/playback/TrackPicker";
import { GuideList } from "../components/GuideList";
import { useLocale } from "../hooks/useLocale";
import type {
  AppMode,
  LiveSurface,
  PlaybackDrawerSurface,
  SurfaceId,
  SurfaceKeyHandler,
} from "../services/surfaceStack";
import type {
  Channel,
  PlaybackProgressSeed,
  PlaybackReturnRoute,
  PlaybackTarget,
} from "../types";

/*
 * Every timer in the interface, in one place, with the reason for each number.
 *
 * They are all deliberately on the generous side of the guidance rather than the tight side.
 * Somebody who reads a channel name in two seconds and somebody who reads it in six are both
 * watching this, and the cost of a caption outstaying its welcome is that it is on screen a
 * moment longer, while the cost of it leaving early is that the viewer never found out what
 * they were looking at. Nothing here has to be waited out either: RETURN clears the screen at
 * once, so the timeout only decides when it goes if nobody asks.
 */

/** The empty channel list, shared, so that "no channels" is one value and not a new one each render. */
const NO_CHANNELS: Channel[] = [];
const EMPTY_GUIDE: ChannelGuide = { state: "empty", items: [] };
const EMPTY_GUIDES: Record<string, ChannelGuide> = {};

const currentGuideIndex = (items: readonly GuideProgramme[]) => {
  const now = Math.floor(Date.now() / 1000);
  return items.findIndex(
    (programme) =>
      programme.startTimestamp !== undefined &&
      programme.stopTimestamp !== undefined &&
      programme.startTimestamp <= now &&
      programme.stopTimestamp > now,
  );
};

/**
 * The cursor position of the search field, which is the row above the first result.
 *
 * Minus one rather than a separate flag, so the column is one list to walk: up from the first
 * result reaches the keyboard and down from the field reaches the results, using the two keys
 * that already move through a list. A flag would have meant a mode, and a mode needs a way out.
 */
const FIELD = -1;

/** No favourites, shared, for the same reason and with the same effect on the memo below it. */
const NO_FAVOURITES: ReadonlySet<string> = new Set<string>();

/**
 * How long the rail waits, after the last press, before the channel column follows it.
 *
 * Walking the rail is the most expensive thing anyone can ask of this app, because arriving
 * at a category throws away every row in the channel column and builds another twenty from
 * channel objects the memo has never seen. Measured on the floor profile, holding the key
 * down cost a median frame of 99ms and fifteen stalls in eighteen presses, which is about
 * six frames a second: the highlight crawled.
 *
 * The fix is the one this app already uses twice, for the same reason. Channel up and down
 * wait 450ms before tuning, so holding the key changes channel once rather than thirty
 * times, and the channel list waits before asking for artwork. This is the third: the
 * cursor moves on the press, and the column follows once the viewer has stopped. Eighteen
 * rebuilds become one.
 *
 * 150ms rather than the tuner's 450ms because nothing is torn down and nothing is fetched,
 * so the only cost of being wrong is a rebuild, and because the column trailing the cursor
 * by half a second would read as the app lagging rather than as the app waiting. Short
 * enough to feel immediate on a single press, long enough that a held key never pays twice.
 */
const RAIL_SETTLE_MS = 150;

/**
 * How long the search waits, after the last keystroke, before answering.
 *
 * The same 150ms as the rail and for the same reason. A letter has to appear the instant it is
 * typed, and the twelve thousand name comparisons behind it are worth about 60 to 120ms on the
 * floor profile, so doing them per keystroke means the caret falling behind the keyboard. Typing
 * "sport" this way searches once instead of five times, and the four searches skipped were for
 * "s", "sp", "spo" and "spor", which nobody wanted results for.
 *
 * Deliberately not longer. The results are the feedback that the typing is working, and a viewer
 * who has finished a word and sees the old list for half a second concludes the search is broken.
 */
const QUERY_SETTLE_MS = 150;

const cycleIndex = (index: number, delta: number, count: number) =>
  count ? (index + delta + count) % count : 0;

/**
 * App owns the five level surface stack: picture, primary panel, drawer, modal and popup.
 * LiveScreen owns the Live picture, panel and Guide drawer, and only the active one receives a
 * focus key. Picture state and the playback banner do not add surfaces because neither owns focus.
 *
 * Choosing a channel closes the panel, so the banner appears with the name and holds while the
 * channel tunes. A broken channel stays in the picture surface, which means it blocks no keys and
 * pressing down to try the next channel works exactly as it does when the picture is fine.
 */
type View = "watch" | "panel";

export interface LiveScreenProps {
  hostVisible: boolean;
  surface: SurfaceId;
  liveSurface: LiveSurface;
  onLiveSurfaceChange: (surface: LiveSurface) => void;
  panelHost: HTMLDivElement | null;
  entryRequestId: number;
  guideChannelId: string;
  onGuideChannelChange: (channelId: string) => void;
  deckOpen: boolean;
  compactRecoveryVisible: boolean;
  onDeckOpenChange: (open: boolean) => void;
  playbackDrawer: PlaybackDrawerSurface | null;
  onPlaybackDrawerChange: (drawer: PlaybackDrawerSurface | null) => void;
  playback: PlaybackController;
  chrome: Chrome;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onAppNavigationFocus: () => void;
  searchRequest: { id: number; mode: AppMode; open: boolean };
  onSearchClosed?: (mode: AppMode, requestId: number) => void;
  navigationTransitionActive?: boolean;
  onOpenSettings: () => void;
  onChoosePlaylist: () => void;
  onRequestExit: () => void;
  onFiniteReturn?: () => void;
  onFiniteStep?: (delta: -1 | 1) => void;
  finiteStepAvailable?: (delta: -1 | 1) => boolean;
  playbackPending: boolean;
  resumeLiveOnMount: boolean;
  inputEnabled: boolean;
}

/**
 * ---------------------------------------------------------------------------------------
 * The key model, which is mode specific rather than absolute.
 * ---------------------------------------------------------------------------------------
 *
 * At the uncovered Live picture, up and down always change channel, Left and OK open the
 * Live browser, and Right opens the playback deck whether or not the stream has a DVR
 * range. Live seeking happens only inside the deck, so the picture keys never change
 * meaning based on a range the viewer cannot see.
 *
 * At the uncovered finite picture, Left and Right quick seek and accumulate before the
 * engine hears about it, OK opens the deck, up and down deliberately do nothing, and Back
 * returns to the screen the content came from.
 *
 * In every surface, focus stops at list boundaries rather than wrapping. Channel up and
 * down still wrap, because a channel key is not focus and never has been.
 *
 * RETURN always goes back by exactly one thing: it clears transient feedback, closes the
 * topmost focus owning surface, and offers to close the application only when there is
 * nothing left to close.
 */

export function LiveScreen({
  hostVisible,
  surface,
  liveSurface,
  onLiveSurfaceChange,
  panelHost,
  entryRequestId,
  guideChannelId,
  onGuideChannelChange: setGuideChannelId,
  deckOpen,
  compactRecoveryVisible,
  onDeckOpenChange,
  playbackDrawer,
  onPlaybackDrawerChange,
  playback,
  chrome,
  videoRef,
  onAppNavigationFocus,
  searchRequest,
  onSearchClosed,
  navigationTransitionActive = false,
  onOpenSettings,
  onChoosePlaylist,
  onRequestExit,
  onFiniteReturn,
  onFiniteStep,
  finiteStepAvailable: canStepFinite,
  playbackPending,
  resumeLiveOnMount,
  inputEnabled,
}: LiveScreenProps): React.ReactElement {
  const loading = useChannels((state) => state.loading);
  const error = useChannels((state) => state.error);
  const errorKey = useChannels((state) => state.errorKey);
  const errorDetail = useChannels((state) => state.errorDetail);
  const load = useChannels((state) => state.load);
  const channels = useLineup((state) => state.channels);
  const categories = useLineup((state) => state.categories);
  const numberIndex = useLineup((state) => state.numberIndex);
  const managedChannels = useLineup((state) => state.managedChannels);
  const browsableChannels = useLineup((state) => state.browsableChannels);
  const searchableChannels = useLineup((state) => state.searchableChannels);
  const loadFailed = !!error && errorKey !== "playlist.refreshFailed" && !loading;
  const favourites = usePersonal((state) => state.favourites);
  const lastPlayed = usePersonal((state) => state.lastPlayed);
  const toggleFavourite = usePersonal((state) => state.toggleFavourite);
  const rememberLast = usePersonal((state) => state.rememberLast);
  const rememberProgress = usePersonal((state) => state.rememberProgress);
  const completeProgress = usePersonal((state) => state.completeProgress);
  const beginProgressSession = usePersonal((state) => state.beginProgressSession);
  const libraryActive = inputEnabled;
  const selectPlaylist = useLibrary((state) => state.selectPlaylist);
  const loadGuide = useLibrary((state) => state.loadGuide);
  const guides = useLibrary((state) => (libraryActive ? state.guides : EMPTY_GUIDES));
  const activePlaylist = useSettings((state) => state.activePlaylist());
  const configured = useSettings((state) => state.playlists.length > 0);
  const showLogos = useSettings((state) => state.showLogos);
  const scale = useSettings((state) => state.scale());
  const resumeLast = useSettings((state) => state.resumeLast);
  const showPlaybackStats = useSettings((state) => state.showPlaybackStats);
  const showNumbers = useSettings((state) => state.showNumbers);
  const hideEmptyCategories = useSettings((state) => state.hideEmptyCategories);
  const { direction, t, number } = useLocale();
  const view: View = liveSurface === "picture" ? "watch" : "panel";
  const [recoveryAction, setRecoveryAction] = useState<"retry" | "settings">("retry");
  const [retryingPlaylist, setRetryingPlaylist] = useState(false);
  const retryingPlaylistRef = useRef(false);
  const retryPlaylist = useCallback(async () => {
    if (retryingPlaylistRef.current) return;
    retryingPlaylistRef.current = true;
    setRetryingPlaylist(true);
    await load(true);
    retryingPlaylistRef.current = false;
    setRetryingPlaylist(false);
  }, [load]);
  const setView = useCallback(
    (next: View) => onLiveSurfaceChange(next === "watch" ? "picture" : "panel"),
    [onLiveSurfaceChange],
  );

  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;

  /* Zero, the top of the rail, which is the playlist's first category until there is a
     favourite and Favourites once there is. Both are worth opening on, and neither can be
     empty: the row only exists while it has something in it. */
  const [category, setCategory] = useState(0);
  const [cursor, setCursor] = useState(1); // rail row, zero is the title bar
  const [index, setIndex] = useState(0);
  const [pane, setPane] = useState<"rail" | "list">("list");
  const [guideIndex, setGuideIndex] = useState(0);
  const [closingRail, setClosingRail] = useState<"guide" | "audio" | "subtitles" | null>(null);
  const guideReturnIndex = useRef(0);
  const guideOrigin = useRef<"live-browser" | "deck">("live-browser");
  const railCloseTimer = useRef<number | undefined>(undefined);
  const railCloseCommit = useRef<(() => void) | null>(null);
  const [deckFocus, setDeckFocus] = useState<PlaybackDeckFocus>("play-pause");
  const deckOpenRef = useRef(deckOpen);
  deckOpenRef.current = deckOpen;
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const faultRef = useRef(playback.snapshot.fault);
  faultRef.current = playback.snapshot.fault;
  const drawerOrigin = useRef<PlaybackDeckFocus>("audio");
  const finishRailClose = useCallback(() => {
    const commit = railCloseCommit.current;
    railCloseCommit.current = null;
    window.clearTimeout(railCloseTimer.current);
    railCloseTimer.current = undefined;
    setClosingRail(null);
    commit?.();
  }, []);
  const cancelRailClose = useCallback(() => {
    railCloseCommit.current = null;
    window.clearTimeout(railCloseTimer.current);
    railCloseTimer.current = undefined;
    setClosingRail(null);
  }, []);
  const closeRailDrawer = useCallback(
    (drawer: "guide" | "audio" | "subtitles", commit: () => void) => {
      if (railCloseCommit.current) return;
      railCloseCommit.current = commit;
      setClosingRail(drawer);
      const duration = cssMs("--t-panel");
      // Animation completion normally releases the drawer, with a fallback if it is interrupted.
      railCloseTimer.current = window.setTimeout(finishRailClose, duration ? duration + 50 : 0);
    },
    [finishRailClose],
  );
  useLayoutEffect(() => {
    if (
      closingRail &&
      (closingRail === "guide" ? !guideChannelId : playbackDrawer !== closingRail)
    )
      cancelRailClose();
  }, [closingRail, guideChannelId, playbackDrawer, cancelRailClose]);
  /** The screen a finite target was started from, read when playback is left. */
  const returnRoute = useRef<PlaybackReturnRoute | null>(null);
  const guideTimer = useRef<number | undefined>(undefined);
  const wheelAt = useRef({ rail: 0, list: 0, guide: 0 });
  const seekRepeat = useRef<SeekHold>({
    direction: 0,
    startedAt: 0,
    steppedAt: 0,
  });
  const allowWheel = useCallback((region: keyof typeof wheelAt.current) => {
    const now = Date.now();
    if (now - wheelAt.current[region] < 120) return false;
    wheelAt.current[region] = now;
    return true;
  }, []);

  const activePlaylistRef = useRef(activePlaylist);
  activePlaylistRef.current = activePlaylist;
  const activeSourceKey = `${activePlaylist?.id ?? ""}:v${activePlaylist?.sourceVersion ?? 0}`;
  useEffect(() => {
    if (!activeSourceKey) return;
    const playlist = activePlaylistRef.current;
    selectPlaylist(playlist);
    if (!playlist?.id) return;
    setCategory(0);
    setCursor(1);
    setIndex(0);
  }, [activeSourceKey, selectPlaylist]);

  /**
   * The search, which is the channel column showing an answer instead of a category.
   *
   * Two strings rather than one, and the second is the reason this works on a slow set. `query`
   * is what has been typed and is on screen the instant it is typed, because a field that lags
   * the keyboard is unusable. `applied` is what the results were built from, and it follows
   * 150ms later.
   *
   * That is the third time this application uses the same shape and the same number, for the
   * same reason: the rail's cursor moves on the press and its column follows, the tuner waits
   * before it retunes, and here a keystroke moves the caret while the twelve thousand name
   * comparisons behind it wait to see whether another letter is coming. Typing "sport" would
   * otherwise search five times, four of them for strings nobody wanted results for.
   */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const searchOrigin = useRef<{
    category: number;
    cursor: number;
    index: number;
    pane: "rail" | "list";
  }>({ category: 0, cursor: 1, index: 0, pane: "list" });
  const queryTimer = useRef<number | undefined>(undefined);
  /**
   * Whether a search is showing, for the callbacks that must not be rebuilt when it changes.
   *
   * `showCategory` is a dependency of half the handlers in this file, so giving it a real
   * dependency on `searching` would change its identity, and theirs, every time a search opened or
   * closed. Every row in both columns is memoised on props that include those handlers.
   */
  const searchingRef = useRef(false);
  searchingRef.current = searching;
  const searchOwnerId = useRef(0);
  const searchExit = useRef<{
    query: string;
    channels: readonly Channel[];
    total: number;
    index: number;
  } | null>(null);
  const handledEntryId = useRef(0);

  /**
   * End the search wherever it was open, and tell the application which request owned it.
   *
   * The owner id goes back with the close so the request channel can mark that request
   * answered without issuing a new one: a fresh id would read as a new command and close
   * again, and the retained exit snapshot would be cleared by a request that never asked
   * for one. The snapshot itself stays, because a picked result still owes the panel its
   * exit presentation.
   */
  const endSearch = useCallback(() => {
    window.clearTimeout(queryTimer.current);
    const owner = searchOwnerId.current;
    searchOwnerId.current = 0;
    setSearching(false);
    if (owner) onSearchClosed?.("live", owner);
  }, [onSearchClosed]);

  useLayoutEffect(() => {
    if (!entryRequestId || entryRequestId === handledEntryId.current) return;
    handledEntryId.current = entryRequestId;
    window.clearTimeout(queryTimer.current);
    searchExit.current = null;
    endSearch();
    setPane("rail");
    setCursor(category + 1);
    setView("panel");
  }, [category, endSearch, entryRequestId, setView]);

  const railTimer = useRef<number | undefined>(undefined);
  const [revealHidden, setRevealHidden] = useState(false);
  const [softHidden, setSoftHidden] = useState<string[]>([]);
  const previousSurface = useRef(surface);
  useLayoutEffect(() => {
    const settingsClosed = previousSurface.current === "settings" && surface !== "confirmation";
    previousSurface.current = surface;
    if (settingsClosed) setRevealHidden(false);
  }, [surface]);

  const hiddenChannels = useMemo(
    () => managedChannels.filter((channel) => channel.hidden).map((channel) => channel.ref.id),
    [managedChannels],
  );
  const hiddenCategories = useMemo(
    () => categories.filter((category) => category.hidden).map((category) => category.key),
    [categories],
  );
  const playlistFavourites = useMemo(
    () => favourites.filter((favourite) => favourite.playlistId === activePlaylist?.id),
    [activePlaylist?.id, favourites],
  );
  const lineup = useMemo(
    () =>
      lineupOf(channels, categories, playlistFavourites, {
        hiddenCategories,
        hiddenChannels,
        hideEmptyCategories,
      }),
    [
      channels,
      categories,
      playlistFavourites,
      hiddenCategories,
      hiddenChannels,
      hideEmptyCategories,
    ],
  );
  const { lists: browsableLists } = lineup;
  const savedHidden = useMemo(() => new Set(hiddenCategories), [hiddenCategories]);
  const softHiddenSet = useMemo(() => new Set(softHidden), [softHidden]);
  const lists = useMemo(() => {
    if (!revealHidden && !softHiddenSet.size) return browsableLists;
    const favouriteList = isFavouritesList(browsableLists[0]) ? browsableLists[0] : undefined;
    const categoryLists = (
      revealHidden
        ? categories
        : categories.filter(
            (category) => !savedHidden.has(category.key) || softHiddenSet.has(category.key),
          )
    ).filter((category) => hideEmptyCategories === false || category.channels.length > 0);
    return favouriteList ? [favouriteList, ...categoryLists] : categoryLists;
  }, [
    browsableLists,
    categories,
    hideEmptyCategories,
    revealHidden,
    savedHidden,
    softHiddenSet,
  ]);
  useEffect(() => {
    setRevealHidden(false);
    setSoftHidden([]);
  }, [activePlaylist?.id]);

  const displayListName = (list: LineupList | undefined) =>
    isFavouritesList(list)
      ? t("channel.favourites")
      : list?.name === UNCATEGORISED
        ? t("channel.uncategorised")
        : (list?.name ?? "");

  /**
   * The favourites, as a set, because the channel list asks about every row it draws.
   *
   * An array meant `favourites.includes(id)` per row per render, which is a scan of the
   * whole favourites list twenty times over for every press of the down key. Nobody
   * notices with three favourites and everybody notices with two hundred.
   */
  const favouriteIds = useMemo<ReadonlySet<string>>(
    () =>
      playlistFavourites.length
        ? new Set(playlistFavourites.map((favourite) => favourite.itemKey))
        : NO_FAVOURITES,
    [playlistFavourites],
  );

  /*
   * One shared empty list rather than a fresh one each time.
   *
   * `?? []` allocates on every render, and this is empty for the whole of the load: there
   * are no lists at all until the playlist parses, so lists[category] is undefined. A new
   * array is a new prop, which walks straight past ChannelList's memo and restarts the timer
   * it uses to decide the list has settled, so the logos were never asked for at all while a
   * playlist was arriving.
   */
  const visible = lists[category]?.channels ?? NO_CHANNELS;

  /**
   * The results, rebuilt only when the debounced query or the playlist changes.
   *
   * Memoised on `applied` rather than on `query`, which is what makes the debounce mean
   * anything: keyed on what has been typed, every keystroke would rebuild the list and the
   * timer below would only be delaying the render, not the work.
   */
  const results = useMemo(
    () => searchChannels(searchableChannels, applied),
    [searchableChannels, applied],
  );

  /**
   * What the channel column is showing: an answer, or a category.
   *
   * Only the column. `visible` stays the category, because it is also the list channel up and
   * down walk, and a viewer surfing away from a channel they found by searching should walk the
   * category that channel lives in rather than the remains of a query. Choosing a result moves
   * the rail to that category for the same reason, which is what `jump` already does for a
   * dialled number.
   */
  const column = searching ? results.matches : visible;

  const guideChannel = useMemo(
    () => channels.find((channel) => channel.id === guideChannelId),
    [channels, guideChannelId],
  );
  const guide = guides[guideChannelId] ?? EMPTY_GUIDE;
  useEffect(() => {
    if (guideChannelId && !guideChannel) setGuideChannelId("");
  }, [guideChannel, guideChannelId, setGuideChannelId]);
  /*
   * Type, and let the results catch up.
   *
   * Cleared on the way out as well as rescheduled on the way in, so a query abandoned by
   * closing search cannot land on an empty column a moment later.
   */
  useEffect(() => {
    if (!searching) return;
    window.clearTimeout(queryTimer.current);
    queryTimer.current = window.setTimeout(() => setApplied(query), QUERY_SETTLE_MS);
    return () => window.clearTimeout(queryTimer.current);
  }, [query, searching]);

  const snapshot = playback.snapshot;
  const seekAvailable =
    !!snapshot.seekRange &&
    snapshot.position !== null &&
    (snapshot.phase === "playing" || snapshot.phase === "paused");
  const current = snapshot.target;
  const busy =
    snapshot.phase === "connecting" ||
    snapshot.phase === "rebuffering" ||
    snapshot.phase === "recovering";
  const paused = snapshot.paused;
  const ended = snapshot.phase === "ended";
  const fault = snapshot.fault ?? "";

  useEffect(() => {
    if (
      !paused ||
      !current ||
      faultRef.current ||
      (surfaceRef.current !== "picture" && surfaceRef.current !== "playback-deck")
    )
      return;
    const wasOpen = deckOpenRef.current;
    setDeckFocus((focus) => (wasOpen && focus === "seek" ? "seek" : "play-pause"));
    onDeckOpenChange(true);
  }, [current?.id, onDeckOpenChange, paused]);

  useEffect(() => {
    if (current?.mode !== "live") return;
    const playing = channels.find((channel) => channel.id === current.id);
    if (playing?.xtream) void loadGuide(playing);
  }, [channels, current?.id, current?.mode, loadGuide]);

  useEffect(() => {
    if (!guideChannelId) return;
    const currentIndex = currentGuideIndex(guide.items);
    setGuideIndex((selected) =>
      currentIndex >= 0
        ? currentIndex
        : Math.min(selected, Math.max(0, guide.items.length - 1)),
    );
  }, [guide.items, guideChannelId]);

  useEffect(() => {
    window.clearTimeout(guideTimer.current);
    if (view !== "panel" || pane !== "list" || guideChannelId) return;
    const focused = column[index];
    if (!focused?.xtream) return;
    guideTimer.current = window.setTimeout(() => {
      void useLibrary.getState().loadGuide(focused);
    }, RAIL_SETTLE_MS);
    return () => window.clearTimeout(guideTimer.current);
  }, [column, guideChannelId, index, pane, view]);

  /** The channel as it is now, for callbacks that run between renders. */
  const currentRef = useRef<PlaybackTarget | null>(null);
  currentRef.current = current;

  const detailsSource = useRef(activeSourceKey);
  useLayoutEffect(() => {
    if (detailsSource.current === activeSourceKey) return;
    detailsSource.current = activeSourceKey;
    if (playbackDrawer === "details") onPlaybackDrawerChange(null);
  }, [activeSourceKey, onPlaybackDrawerChange, playbackDrawer]);

  /**
   * Seconds the channel now tuning has been tuning, so a slow one can say so.
   * Counted here rather than inside the controller because it is a display concern: the
   * overlay asks how long the viewer has been looking at a ring, which is render state.
   */
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    setWaited(0);
    if (!busy) return;
    const timer = window.setInterval(() => setWaited((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [busy, current?.id]);

  /**
   * The card over the picture says everything when a channel fails, so the banner goes. This
   * used to arrive as a callback from the tuner; now it is derived from the same snapshot
   * every other surface reads.
   */
  useLayoutEffect(() => {
    if (!fault) return;
    onDeckOpenChange(false);
    if (playbackDrawer !== "details") onPlaybackDrawerChange(null);
  }, [fault, onDeckOpenChange, onPlaybackDrawerChange, playbackDrawer]);

  useEffect(() => {
    if (fault) chrome.lowerBanner();
  }, [fault, chrome.lowerBanner]);

  /*
   * Details reads provider metadata only while the library still belongs to the playlist
   * the target came from: a foreign owner's catalogue must never leak into the dialog, so
   * both the playlist identity and its source version fence every selected value.
   */
  const movieDetails = useLibrary((state) =>
    playbackDrawer === "details" &&
    current?.kind === "movie" &&
    activePlaylist?.id === current.playlistId &&
    state.playlistId === current.playlistId &&
    state.sourceVersion === activePlaylist.sourceVersion
      ? state.movieDetails[current.id]?.value
      : undefined,
  );
  const seriesDetails = useLibrary((state) =>
    playbackDrawer === "details" &&
    current?.kind === "episode" &&
    activePlaylist?.id === current.playlistId &&
    state.playlistId === current.playlistId &&
    state.sourceVersion === activePlaylist.sourceVersion
      ? state.seriesDetails[current.progress?.parentKey ?? ""]?.value
      : undefined,
  );

  useEffect(() => {
    if (playbackDrawer !== "details" || !current || activePlaylist?.id !== current.playlistId)
      return;
    const library = useLibrary.getState();
    if (
      library.playlistId !== current.playlistId ||
      library.sourceVersion !== activePlaylist.sourceVersion
    )
      return;
    if (current.kind === "movie") void library.loadMovie(current.id);
    else if (current.kind === "episode" && current.progress?.parentKey)
      void library.loadSeries(current.progress.parentKey);
  }, [activePlaylist?.id, activePlaylist?.sourceVersion, current, playbackDrawer]);

  /**
   * Prepare the categories either side of this one, quietly.
   *
   * Arriving at a category is the most expensive thing in the app, because the whole channel
   * list is replaced and none of its logos have been seen. But the next category anyone
   * looks at is almost always the one above or below the current one, so the first screenful
   * of each can be got ready while nobody is asking for anything.
   *
   * Only the first screenful, and only at the lowest priority, so it is dropped the instant a
   * row that is genuinely on screen needs the queue. Idle work that delays real work is
   * worse than no idle work at all.
   */
  useEffect(() => {
    // Live stays mounted behind VOD, but its neighbouring categories no longer need warming.
    if (!hostVisible || !showLogos || !lists.length) return;
    /* A loop rather than filter, flatMap and filter again. Three intermediate arrays for a
       list of at most twenty eight strings is not the cost; Array.prototype.flatMap is. It
       arrived in Chromium 69, which is exactly the engine on a 2020 set, so it works with
       no margin at all and nothing here needs it. */
    const ahead: string[] = [];
    for (const list of [lists[category + 1], lists[category - 1]]) {
      if (!list) continue;
      for (const channel of list.channels.slice(0, 14)) {
        if (channel.logo) ahead.push(channel.logo);
      }
    }
    // A pause first: the category has only just changed and its own rows come before this.
    return warmChain(ahead, { delay: 1200, timeout: 2000 });
  }, [hostVisible, lists, category, showLogos]);

  /*
   * Every timer this component owns, called off when it goes.
   *
   * zapTimer is the one that matters. It fires playback.start(), which reaches for the player, and
   * the effect that owns the player has already stopped and detached it by then, so a tune
   * that was still settling ran against a discarded engine. StrictMode mounts everything
   * twice in development, which makes it reachable on any page load rather than only on an
   * unmount nobody performs.
   */
  useEffect(
    () => () => {
      window.clearTimeout(railTimer.current);
      window.clearTimeout(guideTimer.current);
      window.clearTimeout(railCloseTimer.current);
    },
    [],
  );

  useEffect(() => {
    document.documentElement.style.setProperty("--scale", String(scale));
  }, [scale]);

  /** The rail cursor as it is now, for presses that arrive faster than renders. */
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  const openPanel = useCallback(() => {
    setView("panel");
  }, [setView]);

  const watch = useCallback(() => {
    setRevealHidden(false);
    setSoftHidden([]);
    setView("watch");
  }, [setView]);

  /**
   * Where the finite session stands, for the boundaries that need it between renders.
   * A target change or a stop writes the last position before the new or absent target's
   * clock can be mistaken for the old one's.
   */
  const progressRef = useRef<{
    id: string;
    seed: PlaybackProgressSeed;
    seconds: number;
    duration?: number;
  } | null>(null);

  useEffect(() => {
    const previous = progressRef.current;
    if (previous && previous.id !== current?.id) {
      rememberProgress(
        previous.seed,
        previous.seconds,
        previous.duration,
        current ? "target-change" : "stop",
      );
      progressRef.current = null;
    }
    if (current?.mode === "finite" && current.progress) {
      beginProgressSession(current.id, current.resumeAt ?? 0);
      progressRef.current = {
        id: current.id,
        seed: current.progress,
        seconds: current.resumeAt ?? 0,
      };
    }
  }, [current, beginProgressSession, rememberProgress]);

  useEffect(() => {
    if (current?.mode !== "finite" || !current.progress || snapshot.position === null) return;
    progressRef.current = {
      id: current.id,
      seed: current.progress,
      seconds: snapshot.position,
      duration: snapshot.duration ?? undefined,
    };
    rememberProgress(
      current.progress,
      snapshot.position,
      snapshot.duration ?? undefined,
      "tick",
    );
  }, [current, snapshot.position, snapshot.duration, rememberProgress]);

  useEffect(() => {
    if (!paused || busy || current?.mode !== "finite") return;
    const held = progressRef.current;
    if (held) rememberProgress(held.seed, held.seconds, held.duration, "pause");
  }, [current, paused, busy, rememberProgress]);

  useEffect(() => {
    const persistHidden = () => {
      if (!document.hidden || currentRef.current?.mode !== "finite") return;
      const held = progressRef.current;
      if (held) rememberProgress(held.seed, held.seconds, held.duration, "hidden");
    };
    document.addEventListener("visibilitychange", persistHidden);
    return () => document.removeEventListener("visibilitychange", persistHidden);
  }, [rememberProgress]);

  /**
   * Which list a channel lives in, preferring a real category over Favourites.
   *
   * A favourite appears twice, and landing in the Favourites list would quietly move the
   * viewer somewhere they did not ask to be, so the playlist's own grouping wins.
   */
  const locate = useCallback(
    (channel: Channel) => {
      const has = (l: { channels: readonly Channel[] }) =>
        l.channels.some((c) => c.id === channel.id);
      const real = lists.findIndex((list) => !isFavouritesList(list) && has(list));
      return real >= 0 ? real : lists.findIndex(has);
    },
    [lists],
  );

  /**
   * Put a category in the channel column, now or once the viewer has stopped moving.
   *
   * The category and the row within it move together, always, and that is not tidiness. A
   * deferred category with an immediate index would reset the highlight to the top of the
   * list still on screen, so the column the viewer is reading would jump while they were
   * only passing over its name in the rail.
   *
   * Deferred for the rail walk, immediate for everything that is a jump rather than a
   * scroll: reopening the panel on what is playing, dialling a number, and the green key's
   * correction. A jump also cancels a walk that has not landed yet, which is why they all
   * come through here rather than calling setCategory themselves.
   */
  const showCategory = useCallback(
    (to: number, at: number, now: boolean) => {
      window.clearTimeout(railTimer.current);
      const apply = () => {
        /*
         * A category arriving is the end of a search, and it has to be, because the two want the
         * same column.
         *
         * Without this the rail went dead while a search was showing: walking it moved the cursor
         * and set the category underneath, and the column carried on showing results, so the one
         * control the viewer was using appeared to do nothing at all. Every way of asking for a
         * category comes through here, the rail walk, a dialled number, the green key's correction
         * and the resume, so this is the one place that has to know.
         *
         * Inside `apply` rather than beside it, so the change is a single transition. Cleared on the
         * press instead, the column would show the previous category for 150ms and then the new one,
         * which is two changes to answer one press.
         */
        if (searchingRef.current) endSearch();
        setCategory(to);
        setIndex(at);
      };
      if (now) apply();
      else railTimer.current = window.setTimeout(apply, RAIL_SETTLE_MS);
    },
    [endSearch],
  );

  /**
   * Keep the cursor inside a playlist that has got shorter.
   *
   * A refresh can return fewer categories than the last copy had, and the rail cursor is a
   * number: standing on the twelfth category of a playlist that now has five leaves
   * `lists[category]` undefined, so the channel column draws empty with a blank heading and
   * stays that way until the viewer presses something. Nothing crashes, which is why it went
   * unnoticed, and nothing works either.
   *
   * It became easier to reach when the rail started deferring: the category is now applied by
   * a timer that can land after a refresh has replaced the lists underneath it. But it was
   * always possible, since a background refresh is not something the viewer did.
   */
  useEffect(() => {
    if (!lists.length) return;
    const last = lists.length - 1;
    if (cursorRef.current > lists.length) {
      setCursor(lists.length);
      cursorRef.current = lists.length;
    }
    if (category > last) showCategory(last, 0, true);
  }, [lists.length, category, showCategory]);

  /**
   * Open the panel on whatever is playing.
   *
   * Coming back to the list should feel like returning to where you were, not to wherever
   * the cursor happened to be left. Reopening it puts the highlight back on the channel
   * on screen, in the category that channel belongs to.
   */
  const revealPanel = useCallback(() => {
    const target = currentRef.current;
    const playing =
      target?.mode === "live"
        ? channels.find((channel) => channel.id === target.id)
        : undefined;
    if (playing) {
      const cat = locate(playing);
      if (cat >= 0) {
        setCursor(cat + 1);
        cursorRef.current = cat + 1;
        showCategory(
          cat,
          lists[cat].channels.findIndex((channel) => channel.id === playing.id),
          true,
        );
      }
    }
    setPane("list");
    openPanel();
  }, [channels, locate, lists, openPanel, showCategory]);

  /**
   * Resume whatever was on last time, once the playlist has arrived.
   *
   * The cursor is put on that channel without opening the panel, so pressing Left later
   * lands on the row the viewer is watching rather than at the top of the first category.
   * That positioning was the useful half of revealPanel and the panel opening was the half
   * nobody asked for.
   *
   * A remembered channel that is no longer in the playlist is the one case that opens the
   * list. It happens whenever a playlist is edited, and the alternative is a television that
   * comes on to a black screen having silently decided there was nothing to play.
   */
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !channels.length) return;
    resumed.current = true;
    if (!resumeLiveOnMount || !resumeLast) return;

    const rememberedItemKey =
      lastPlayed && lastPlayed.playlistId === activePlaylist?.id ? lastPlayed.itemKey : "";
    const found = rememberedItemKey
      ? browsableChannels.find((c) => c.id === rememberedItemKey)
      : undefined;
    if (!found) {
      if (usePersonal.getState().hasRememberedLast()) openPanel();
      return;
    }
    const cat = locate(found);
    if (cat >= 0) {
      setCursor(cat + 1);
      cursorRef.current = cat + 1;
      showCategory(cat, lists[cat].channels.indexOf(found), true);
    }
    setPane("list");
    playback.start(found);
  }, [channels, browsableChannels, lastPlayed?.itemKey, resumeLiveOnMount]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Put the rail cursor somewhere, and let the category follow.
   *
   * The cursor moves on the press, which is the first of the two Tab UI behaviours Samsung
   * describes and the half that has to be immediate: the highlight is the app answering the
   * key. The column it names follows once the walking stops, for the reason set out at
   * RAIL_SETTLE_MS. Row zero is the Settings key, which is not a category and shows nothing.
   */
  const moveCursor = useCallback(
    (to: number) => {
      const next = Math.max(1, Math.min(Math.max(1, lists.length), to));
      cursorRef.current = next;
      setCursor(next);
      if (lists.length) showCategory(next - 1, 0, false);
    },
    [lists.length, showCategory],
  );

  const commitRailCursor = useCallback(() => {
    const nextCategory = cursorRef.current - 1;
    if (nextCategory < 0 || nextCategory === category) {
      window.clearTimeout(railTimer.current);
      return;
    }
    showCategory(nextCategory, 0, true);
  }, [category, showCategory]);

  const nudgeCursor = useCallback(
    (delta: number) => {
      const previous = cursorRef.current;
      const next = cycleIndex(previous - 1, delta, lists.length) + 1;
      if (next !== previous) moveCursor(next);
    },
    [lists.length, moveCursor],
  );

  const jump = useCallback(
    (n: number) => {
      const found = numberIndex.get(n);
      if (!found) {
        chrome.say(t("app.noChannel", { number: number(n) }));
        return;
      }
      const cat = locate(found);
      if (cat >= 0) {
        setCursor(cat + 1);
        cursorRef.current = cat + 1;
        showCategory(cat, lists[cat].channels.indexOf(found), true);
      }
      playback.start(found);
    },
    [numberIndex, lists, locate, playback.start, chrome.say, showCategory, t, number],
  );

  /**
   * Favourite or unfavourite a channel, and stay where the viewer was.
   *
   * Favourites is only in the rail while there is something in it, so the first one added
   * puts a row above every category and the last one removed takes it away again. The
   * viewer asked to favourite a channel, not to be moved: what is kept is the category they
   * are reading, not the number it happened to have. This is the only thing that can insert
   * or remove that row, which is why the correction lives here rather than in an effect
   * watching the lists for a change it cannot attribute to anything.
   *
   * The correction is measured from the cursor rather than from the category on screen,
   * because since the column started trailing the rail those two can disagree. Pressing
   * green halfway through a walk would otherwise correct a position the viewer had already
   * left, and send the highlight backwards.
   */
  const favouriteCurrent = useCallback(
    (channel: Channel | undefined) => {
      if (!channel) return;
      const had = playlistFavourites.some((favourite) => favourite.itemKey === channel.id);
      const favouriteList = isFavouritesList(lists[0]) ? lists[0] : undefined;
      const listed = searchableChannels.some((item) => item.id === channel.id);
      if (!had && !listed) {
        chrome.say(t("app.hiddenFavouriteUnavailable"));
        return;
      }
      const appears = !had && !favouriteList;
      const vanishes =
        had &&
        favouriteList?.channels.length === 1 &&
        favouriteList.channels[0].id === channel.id;

      if (appears || vanishes) {
        const from = Math.max(0, cursorRef.current - 1);
        const to = Math.max(0, from + (appears ? 1 : -1));
        setCursor(to + 1);
        cursorRef.current = to + 1;
        // Standing in Favourites as the last one goes: the row that takes its place is a
        // different list, and the row the highlight was on is not in it.
        showCategory(to, vanishes && from === 0 ? 0 : index, true);
      }

      if (!activePlaylist) return;
      toggleFavourite({
        itemKey: channel.id,
        playlistId: activePlaylist.id,
        kind: "live",
        providerId: channel.xtream?.streamId ?? channel.id,
        categoryKey: channel.xtream?.categoryKey ?? channel.group,
        name: channel.name,
        logo: channel.logo,
      });
      chrome.say(had ? t("app.removedFavourite") : t("app.addedFavourite"));
    },
    [
      playlistFavourites,
      activePlaylist,
      lists,
      searchableChannels,
      toggleFavourite,
      chrome.say,
      index,
      showCategory,
      t,
    ],
  );

  const revealHiddenCategories = useCallback(() => {
    if (view !== "panel" || (pane === "rail" && cursor === 0)) return false;
    const favouriteList = isFavouritesList(browsableLists[0]) ? browsableLists[0] : undefined;
    const nextLists = revealHidden
      ? browsableLists
      : favouriteList
        ? [favouriteList, ...categories]
        : categories;
    const nearest = (list: LineupList | undefined, fallback: number) => {
      if (!list) return Math.max(0, Math.min(fallback, nextLists.length - 1));
      const exact = nextLists.findIndex((candidate) =>
        isFavouritesList(list)
          ? isFavouritesList(candidate)
          : !isFavouritesList(candidate) && candidate.key === list.key,
      );
      if (exact >= 0) return exact;
      const raw = categories.findIndex((category) => category.key === list.key);
      for (let at = raw + 1; at < categories.length; at++) {
        const next = nextLists.findIndex(
          (candidate) => !isFavouritesList(candidate) && candidate.key === categories[at].key,
        );
        if (next >= 0) return next;
      }
      for (let at = raw - 1; at >= 0; at--) {
        const previous = nextLists.findIndex(
          (candidate) => !isFavouritesList(candidate) && candidate.key === categories[at].key,
        );
        if (previous >= 0) return previous;
      }
      return 0;
    };
    const shownAt = nearest(lists[category], category);
    setCategory(shownAt);
    setIndex(Math.min(index, Math.max(0, (nextLists[shownAt]?.channels.length ?? 1) - 1)));
    if (cursor > 0) {
      const focusedAt = nearest(lists[cursor - 1], cursor - 1);
      setCursor(focusedAt + 1);
      cursorRef.current = focusedAt + 1;
    }
    if (revealHidden) setSoftHidden([]);
    setRevealHidden((visible) => !visible);
    return true;
  }, [
    view,
    pane,
    cursor,
    savedHidden,
    lists,
    category,
    browsableLists,
    revealHidden,
    categories,
    index,
  ]);

  const toggleCategoryVisibility = useCallback(() => {
    if (view !== "panel" || pane !== "rail" || cursor === 0) return false;
    const item = lists[cursor - 1];
    if (!item || isFavouritesList(item)) return true;
    if (!useSettings.getState().activePlaylist()) return true;
    const hidden = savedHidden.has(item.key);
    if (!hidden && !revealHidden) {
      setSoftHidden((current) =>
        current.includes(item.key) ? current : [...current, item.key],
      );
    } else if (hidden) {
      setSoftHidden((current) => current.filter((key) => key !== item.key));
    }
    if (hidden && revealHidden && savedHidden.size === 1) {
      const favouriteAppears =
        isFavouritesList(lists[0]) ||
        item.channels.some((channel) => favouriteIds.has(channel.id));
      const categoryAt = categories.findIndex((category) => category.key === item.key);
      const to = categoryAt + (favouriteAppears ? 1 : 0);
      setCategory(to);
      setCursor(to + 1);
      cursorRef.current = to + 1;
      setRevealHidden(false);
    }
    void applyLineupMutation(useLineup.getState().revision, {
      type: "category.visibility",
      categoryKey: item.key,
      hidden: !hidden,
    }).then((result) => {
      if (!result.ok) chrome.say(t("lineup.persistenceFailed"));
    });
    return true;
  }, [
    view,
    pane,
    cursor,
    lists,
    savedHidden,
    revealHidden,
    categories,
    favouriteIds,
    chrome.say,
    t,
  ]);

  const redEnabled =
    configured &&
    inputEnabled &&
    (surface === "picture" || surface === "panel" || surface === "guide");

  useLongPress({
    code: KEY.RED,
    enabled: redEnabled,
    onShortPress: () => {
      if (surface === "panel" && !searchingRef.current) toggleCategoryVisibility();
    },
    onLongPress: () => {
      if (surface === "panel" && !searchingRef.current) revealHiddenCategories();
    },
  });

  const openSettings = useCallback(() => {
    onOpenSettings();
  }, [onOpenSettings]);

  /**
   * Open search, which means the channel column stops being a category.
   *
   * The cursor goes to the field, which is index -1: the field is the row above the first
   * result, so up and down walk the column and the keyboard is reached by pressing up from the
   * top of the list. That is one path rather than a mode, and it is why nothing here has to
   * teach the viewer a way back out.
   *
   * Each application Search request starts fresh for the active content mode, so a previous
   * query or result list never appears in a different destination.
   */
  const openSearch = useCallback(
    (requestId: number) => {
      if (!searchingRef.current) searchOrigin.current = { category, cursor, index, pane };
      searchOwnerId.current = requestId;
      window.clearTimeout(railTimer.current);
      window.clearTimeout(queryTimer.current);
      searchExit.current = null;
      setQuery("");
      setApplied("");
      setSearching(true);
      setPane("list");
      setIndex(FIELD);
      openPanel();
    },
    [category, cursor, index, openPanel, pane],
  );

  /**
   * Leave search, and land somewhere that exists.
   *
   * The cursor cannot stay where it was: it is somewhere in a list of results that is about to
   * stop being drawn, and the column underneath is a category with its own length. So it goes to
   * the top of that category, which is the only row certain to be there.
   */
  const closeSearch = useCallback(() => {
    const origin = searchOrigin.current;
    endSearch();
    setQuery("");
    setApplied("");
    setCategory(origin.category);
    setCursor(origin.cursor);
    cursorRef.current = origin.cursor;
    setIndex(origin.index);
    setPane(origin.pane);
  }, [endSearch]);

  const lastSearchRequest = useRef<typeof searchRequest | null>(null);
  useLayoutEffect(() => {
    if (lastSearchRequest.current?.id === searchRequest.id) return;
    lastSearchRequest.current = searchRequest;
    searchExit.current = null;
    if (searchRequest.open && searchRequest.mode === "live") {
      openSearch(searchRequest.id);
    } else if (searchingRef.current) {
      closeSearch();
    }
  }, [closeSearch, openSearch, searchRequest]);

  const focusApplicationNavigation = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    onAppNavigationFocus();
  }, [onAppNavigationFocus]);

  const leaveSearchStart = focusApplicationNavigation;

  const leaveSearchUp = leaveSearchStart;

  const openGuideChannel = useCallback(
    (channel: Channel, origin: "live-browser" | "deck") => {
      if (!channel.xtream) return;
      guideOrigin.current = origin;
      cancelRailClose();
      const heldGuide = useLibrary.getState().guideFor(channel.id);
      setGuideIndex(Math.max(0, currentGuideIndex(heldGuide.items)));
      guideReturnIndex.current = Math.max(0, index);
      endSearch();
      setQuery("");
      setApplied("");
      setGuideChannelId(channel.id);
      setPane("list");
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      chrome.clear();
      void useLibrary.getState().loadGuide(channel);
    },
    [cancelRailClose, chrome.clear, endSearch, index, setGuideChannelId],
  );

  const closeGuide = useCallback(() => {
    if (!guideChannelId) return;
    const openedFor = guideChannelId;
    closeRailDrawer("guide", () => {
      setGuideChannelId("");
      setPane("list");
      setIndex(guideReturnIndex.current);
      // A drawer closes back to the surface that opened it, with its action restored.
      if (guideOrigin.current === "deck") {
        setDeckFocus("guide");
      } else {
        /*
         * From the Live browser it was a drawer over the panel, so Back reopens the
         * panel standing on the channel the guide was read for.
         */
        openPanel();
        const channel = channels.find((item) => item.id === openedFor);
        if (channel) {
          const cat = locate(channel);
          if (cat >= 0) showCategory(cat, lists[cat].channels.indexOf(channel), true);
        }
      }
      guideOrigin.current = "live-browser";
    });
  }, [
    channels,
    guideChannelId,
    closeRailDrawer,
    lists,
    locate,
    openPanel,
    setGuideChannelId,
    showCategory,
  ]);

  /**
   * Start a target and remember where it was asked from, so leaving a finite picture
   * returns to the screen that started it instead of a generic list.
   */
  const play = useCallback(
    (target: PlaybackTarget, route: PlaybackReturnRoute) => {
      returnRoute.current = route;
      playback.start(target);
    },
    [playback.start],
  );

  const playGuide = useCallback(
    (at = guideIndex) => {
      const target = guide.items[at]?.target;
      if (!target) return;
      rememberLast({
        playlistId: target.playlistId,
        kind: "catchup",
        itemKey: target.id,
        categoryKey: guideChannel?.xtream?.categoryKey ?? target.group,
      });
      play(target, { surface: "guide", itemKey: guideChannel?.id ?? "" });
      watch();
    },
    [guide.items, guideChannel, guideIndex, rememberLast, play, watch],
  );

  const retryGuide = useCallback(() => {
    if (guideChannel) void useLibrary.getState().loadGuide(guideChannel);
  }, [guideChannel]);

  /**
   * Play a result, and take the rail with it.
   *
   * Choosing a channel by name is the one way into a channel that says nothing about where it
   * lives, and leaving the rail on whatever category it happened to be showing has two costs
   * that are both invisible until they bite: channel up and down would walk a category the
   * playing channel is not in, and closing search would land the viewer somewhere unrelated to
   * what they are watching. So the rail follows, exactly as it does for a dialled number.
   */
  const pickResult = useCallback(
    (channel: Channel) => {
      endSearch();
      setQuery("");
      setApplied("");
      const cat = locate(channel);
      if (cat >= 0) {
        setCursor(cat + 1);
        cursorRef.current = cat + 1;
        showCategory(cat, lists[cat].channels.indexOf(channel), true);
      }
      if (channel.id !== currentRef.current?.id) playback.start(channel);
      watch();
    },
    [endSearch, locate, lists, showCategory, playback.start, watch],
  );

  /**
   * Open the playback deck.
   *
   * Focus lands on Play or Pause, or on the seek bar when the deck is answering a quick
   * seek that was already under way: the bar is the control the viewer was already driving,
   * so it is the focus they find. Transient feedback is cleared first, because the deck is
   * a focus owning surface and nothing report only may float above it.
   */
  const openDeck = useCallback(
    (focus?: PlaybackDeckFocus) => {
      if (!currentRef.current || faultRef.current) return;
      // The whole deck uses the banner's light entrance, without geometry reads on input.
      chrome.clear();
      setDeckFocus(focus ?? (playback.quickSeek ? "seek" : "play-pause"));
      setView("watch");
      onDeckOpenChange(true);
    },
    [chrome.clear, onDeckOpenChange, setView, playback.quickSeek],
  );

  const closeDeck = useCallback(() => {
    onDeckOpenChange(false);
  }, [onDeckOpenChange]);

  const seekFinite = useCallback(
    (seconds: number) => playback.seekBy(seconds),
    [playback.seekBy],
  );
  const seekFiniteFromKey = useCallback(
    (direction: -1 | 1, repeated: boolean) => {
      const amount = seekStepFromKey(seekRepeat.current, direction, repeated);
      if (amount) seekFinite(direction * amount);
    },
    [seekFinite],
  );
  useEffect(() => {
    const resetSeekRepeat = (event: KeyboardEvent) => {
      if (
        event.keyCode === KEY.UP ||
        event.keyCode === KEY.DOWN ||
        event.keyCode === KEY.CH_UP ||
        event.keyCode === KEY.CH_DOWN ||
        event.keyCode === KEY.PREV ||
        event.keyCode === KEY.NEXT
      ) {
        playback.commitStep();
      }
      if (
        event.keyCode === KEY.LEFT ||
        event.keyCode === KEY.RIGHT ||
        event.keyCode === KEY.REWIND ||
        event.keyCode === KEY.FORWARD
      ) {
        seekRepeat.current = { direction: 0, startedAt: 0, steppedAt: 0 };
      }
    };
    window.addEventListener("keyup", resetSeekRepeat, true);
    return () => window.removeEventListener("keyup", resetSeekRepeat, true);
  }, [playback.commitStep]);

  const seekDeck = useCallback(
    (seconds: number) => playback.seekTo(seconds),
    [playback.seekTo],
  );

  const finiteStepAvailable = useCallback(
    (delta: -1 | 1) => canStepFinite?.(delta) ?? false,
    [canStepFinite],
  );

  /** Open a playback drawer over the deck, remembering which action asked for it. */
  const openPlaybackDrawer = useCallback(
    (drawer: PlaybackDrawerSurface, origin: PlaybackDeckFocus) => {
      cancelRailClose();
      drawerOrigin.current = origin;
      onPlaybackDrawerChange(drawer);
    },
    [cancelRailClose, onPlaybackDrawerChange],
  );

  /**
   * Close a playback drawer back to whatever opened it. The deck was never unmounted from
   * the surface stack, only covered, so returning is a focus restore and nothing else.
   */
  const closePlaybackDrawer = useCallback(
    (origin: PlaybackDeckFocus | "live-browser") => {
      const commit = () => {
        onPlaybackDrawerChange(null);
        if (origin !== "live-browser") setDeckFocus(origin);
      };
      if (playbackDrawer === "details") commit();
      else if (playbackDrawer) closeRailDrawer(playbackDrawer, commit);
    },
    [closeRailDrawer, onPlaybackDrawerChange, playbackDrawer],
  );

  const closePlaybackDetails = useCallback(
    () => closePlaybackDrawer("details"),
    [closePlaybackDrawer],
  );

  /**
   * Leave a finite picture, and land on the screen the content came from.
   *
   * Progress is persisted before the engine releases, so Stop and Back both cost the
   * viewer nothing: App keeps the originating VOD screen mounted while playback covers it,
   * so the exact details, season, episode and catalogue position remain unchanged.
   */
  const leaveFinite = useCallback(() => {
    const held = progressRef.current;
    if (held) {
      rememberProgress(held.seed, held.seconds, held.duration, "stop");
      progressRef.current = null;
    }
    onPlaybackDrawerChange(null);
    if (onFiniteReturn) {
      closeDeck();
      onFiniteReturn();
      return;
    }
    playback.stop();
    currentRef.current = null;
    chrome.lowerBanner();
    closeDeck();
    const route = returnRoute.current;
    returnRoute.current = null;
    const guideReturn =
      route?.surface === "guide"
        ? channels.find((channel) => channel.id === route.itemKey)
        : undefined;
    if (guideReturn) openGuideChannel(guideReturn, "live-browser");
    else openPanel();
  }, [
    channels,
    chrome.lowerBanner,
    closeDeck,
    onFiniteReturn,
    onPlaybackDrawerChange,
    openGuideChannel,
    openPanel,
    playback.stop,
    rememberProgress,
  ]);

  // The end hook owns progress completion. Target loss only restores the originating surface.
  useEffect(() => {
    if (current || playbackDrawer !== "details") return;
    progressRef.current = null;
    leaveFinite();
  }, [current, leaveFinite, playbackDrawer]);

  const handleDeckBack = useCallback(() => {
    /* A queued seek is the viewer's intent, not something to abandon with the controls:
       commit it now rather than letting its settle timer fire behind whatever opens next. */
    playback.flushSeek();
    closeDeck();
  }, [closeDeck, playback.flushSeek]);

  const onDeckAction = useCallback(
    (action: PlaybackDeckAction) => {
      switch (action) {
        case "go-live":
          playback.goLive();
          break;
        case "guide": {
          playback.flushSeek();
          const channel =
            current?.mode === "live"
              ? channels.find((candidate) => candidate.id === current.id)
              : undefined;
          if (channel) openGuideChannel(channel, "deck");
          break;
        }
        case "details":
          if (current?.mode === "finite") openPlaybackDrawer("details", "details");
          else {
            closeDeck();
            openPanel();
          }
          break;
        case "previous":
          if (current?.mode === "live") {
            playback.step(-1, visible);
            playback.commitStep();
          } else onFiniteStep?.(-1);
          break;
        case "next":
          if (current?.mode === "live") {
            playback.step(1, visible);
            playback.commitStep();
          } else onFiniteStep?.(1);
          break;
        case "play-pause":
          playback.togglePlaying();
          break;
        case "audio":
        case "subtitles":
          playback.flushSeek();
          openPlaybackDrawer(action, action);
          break;
      }
    },
    [
      channels,
      closeDeck,
      current,
      openGuideChannel,
      onFiniteStep,
      openPanel,
      openPlaybackDrawer,
      playback.flushSeek,
      playback.goLive,
      playback.step,
      playback.commitStep,
      playback.togglePlaying,
      visible,
    ],
  );

  useEffect(() => {
    if (!ended || current?.mode !== "finite") return;
    progressRef.current = null;
    completeProgress(current.id);
    leaveFinite();
  }, [completeProgress, current, ended, leaveFinite]);

  /**
   * Transport keys. Checklist 2.3 wants every playback button on the remote to work.
   * Off a stream they do nothing and say nothing, which is what the input guide specifies
   * for playback keys outside playback.
   */
  const onTransport = useCallback(
    (code: number, repeated: boolean): boolean => {
      const transport =
        code === KEY.PLAY_PAUSE ||
        code === KEY.PLAY ||
        code === KEY.PAUSE ||
        code === KEY.SPACE ||
        code === KEY.STOP ||
        code === KEY.REWIND ||
        code === KEY.FORWARD ||
        code === KEY.PREV ||
        code === KEY.NEXT ||
        code === KEY.VOL_UP ||
        code === KEY.VOL_DOWN;
      if (!transport) return false;
      if (!current) return true;
      if (
        fault &&
        (code === KEY.PLAY_PAUSE ||
          code === KEY.PLAY ||
          code === KEY.PAUSE ||
          code === KEY.SPACE)
      )
        return true;

      const transportFocus =
        deckOpenRef.current && deckFocus === "seek" ? "seek" : "play-pause";
      const revealTransport = (focus: PlaybackDeckFocus) => {
        if (surface === "picture" || surface === "playback-deck") openDeck(focus);
      };
      switch (code) {
        case KEY.VOL_UP:
          playback.adjustVolume(1);
          break;
        case KEY.VOL_DOWN:
          playback.adjustVolume(-1);
          break;
        /*
         * Play and Pause update the viewer's choice during loading too. Opening the deck
         * reveals that choice without moving focus away from an active seek.
         */
        case KEY.PLAY_PAUSE:
        case KEY.SPACE:
          if (!paused && !playback.capabilities.canPause)
            chrome.say(t("deck.pauseUnavailable"));
          else playback.togglePlaying();
          revealTransport(transportFocus);
          break;
        case KEY.PLAY:
          playback.setPlaying(true);
          revealTransport(transportFocus);
          break;
        case KEY.PAUSE:
          if (playback.capabilities.canPause) {
            playback.setPlaying(false);
            revealTransport(transportFocus);
          } else {
            chrome.say(t("deck.pauseUnavailable"));
          }
          break;
        /*
         * Stop releases playback and lands on the screen that is watching's home: the Live
         * browser for a channel, the content's own details for anything finite.
         */
        case KEY.STOP:
          if (current.mode === "finite") {
            leaveFinite();
            break;
          }
          playback.stop();
          currentRef.current = null;
          chrome.lowerBanner();
          closeDeck();
          revealPanel();
          break;
        /*
         * The scan keys quick seek finite content. On live television there is no picture
         * level seek: with a DVR window they open the deck on the seek bar, and without one
         * they do the useful thing nearest to what was asked, which is to fetch a stalled
         * channel again.
         */
        case KEY.REWIND:
          if (current.mode === "finite") {
            revealTransport("seek");
            seekFiniteFromKey(-1, repeated);
          } else if (snapshot.seekRange) revealTransport("seek");
          else playback.retune();
          break;
        case KEY.FORWARD:
          if (current.mode === "finite") {
            revealTransport("seek");
            seekFiniteFromKey(1, repeated);
          } else if (snapshot.seekRange) revealTransport("seek");
          else playback.retune();
          break;
        // Previous and next channel, which is what "previous and next" means on live
        // television. They announce rather than take focus, because they change the channel.
        case KEY.PREV:
          if (current.mode === "finite") onFiniteStep?.(-1);
          else playback.step(-1, visible, repeated);
          break;
        case KEY.NEXT:
          if (current.mode === "finite") onFiniteStep?.(1);
          else playback.step(1, visible, repeated);
          break;
      }
      return true;
    },
    [
      current,
      deckFocus,
      fault,
      paused,
      playback,
      visible,
      chrome.say,
      chrome.lowerBanner,
      closeDeck,
      leaveFinite,
      onFiniteStep,
      openDeck,
      revealPanel,
      seekFiniteFromKey,
      snapshot.seekRange,
      surface,
      t,
    ],
  );

  const onSharedKey = useCallback(
    (code: number, event: KeyboardEvent): boolean => {
      const active = document.activeElement;
      const textControl =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (textControl && code >= KEY.SPACE && code <= 126) return true;

      if (onTransport(code, event.repeat)) {
        event.preventDefault();
        return true;
      }

      // Consistency of Controls: a coloured key does the same thing wherever the viewer is.
      if (code === KEY.YELLOW) {
        event.preventDefault();
        openSettings();
        return true;
      }
      if (code === KEY.GREEN) {
        event.preventDefault();
        if (view === "panel" && guideChannel) favouriteCurrent(guideChannel);
        else {
          const playing =
            current?.mode === "live"
              ? channels.find((channel) => channel.id === current.id)
              : undefined;
          favouriteCurrent(view === "panel" ? visible[index] : playing);
        }
        return true;
      }
      // Up goes forwards, towards the higher channel number, which is what channel up has
      // meant on every television anyone has owned. It was the other way round.
      if (code === KEY.CH_UP || code === KEY.CH_DOWN) {
        event.preventDefault();
        if (
          current?.mode !== "finite" &&
          (surface === "picture" || surface === "panel" || surface === "playback-deck")
        )
          playback.step(code === KEY.CH_UP ? 1 : -1, visible, event.repeat);
        return true;
      }

      /*
       * A playlist that produced nothing has its own screen, and exactly two keys mean
       * anything on it. Answered here rather than in the panel branch, because the panel is
       * behind it with no rows to move through, so every press would land on nothing.
       */
      if (loadFailed) {
        if (code === inlineStart) {
          event.preventDefault();
          focusApplicationNavigation();
          return true;
        }
        if (code === KEY.UP || code === KEY.DOWN || code === inlineEnd) {
          event.preventDefault();
          setRecoveryAction((action) => (action === "retry" ? "settings" : "retry"));
          return true;
        }
        if (code === KEY.ENTER) {
          event.preventDefault();
          if (retryingPlaylistRef.current) return true;
          if (recoveryAction === "retry") void retryPlaylist();
          else onChoosePlaylist();
          return true;
        }
        if (code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          onRequestExit();
          return true;
        }
      } else if (!channels.length && !loading && activePlaylist?.source.kind !== "xtream") {
        if (code === KEY.ENTER) {
          event.preventDefault();
          openSettings();
          return true;
        }
        if (code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          onRequestExit();
          return true;
        }
      }

      /*
       * Dialling is a Live habit, so it exists only where channels are: the Live picture and
       * the Live browser. Every other surface keeps digit keys inert while it owns focus.
       */
      const digitsLive =
        surface === "panel" || (surface === "picture" && current?.mode !== "finite");
      if (digitsLive && code >= 48 && code <= 57) {
        event.preventDefault();
        chrome.dial(code - 48, jump);
        return true;
      }
      if (digitsLive && chrome.digits && code === KEY.ENTER) {
        event.preventDefault();
        jump(Number(chrome.commitDigits()));
        return true;
      }
      return false;
    },
    [
      activePlaylist?.source.kind,
      channels,
      chrome,
      current,
      favouriteCurrent,
      focusApplicationNavigation,
      guideChannel,
      index,
      inlineEnd,
      inlineStart,
      jump,
      loadFailed,
      loading,
      onChoosePlaylist,
      onRequestExit,
      onTransport,
      openSettings,
      recoveryAction,
      retryPlaylist,
      surface,
      playback,
      view,
      visible,
    ],
  );

  const onGuideKey: SurfaceKeyHandler = useCallback(
    (code, event) => {
      // Physical directions, not logical ones: Left is always the way out of the drawer in
      // both directions of writing, and Right is claimed so it can fall through to nothing.
      const owned =
        code === KEY.UP ||
        code === KEY.DOWN ||
        code === KEY.ENTER ||
        code === KEY.BACK ||
        code === KEY.ESC ||
        code === KEY.LEFT ||
        code === KEY.RIGHT;
      if (owned) event.preventDefault();
      if (code === KEY.UP) {
        setGuideIndex((currentIndex) => Math.max(0, currentIndex - 1));
        return;
      }
      if (code === KEY.DOWN) {
        setGuideIndex((currentIndex) =>
          Math.min(Math.max(0, guide.items.length - 1), currentIndex + 1),
        );
        return;
      }
      if (code === KEY.ENTER) {
        if (guide.state === "failed") retryGuide();
        else playGuide();
        return;
      }
      if (code === KEY.BACK || code === KEY.ESC || code === KEY.LEFT) {
        closeGuide();
        return;
      }
    },
    [closeGuide, guide, playGuide, retryGuide],
  );

  const onPictureKey: SurfaceKeyHandler = useCallback(
    (code, event) => {
      // Only the keys this screen actually owns are claimed. A remote carries plenty the
      // app has no business with, volume and mute and source among them, and a keyboard
      // carries a hundred more.
      const owned =
        code === KEY.UP ||
        code === KEY.DOWN ||
        code === KEY.LEFT ||
        code === KEY.RIGHT ||
        code === KEY.ENTER ||
        code === KEY.BACK ||
        code === KEY.ESC;
      if (owned) event.preventDefault();

      /*
       * The finite picture. Directions quick seek, which is why they are never shared with
       * channel changes: up and down deliberately do nothing, and Back returns to the screen
       * the content came from rather than offering to close the app.
       */
      if (current?.mode === "finite") {
        if (code === inlineStart || code === inlineEnd) {
          if (!seekAvailable) return;
          openDeck("seek");
          seekFiniteFromKey(code === inlineStart ? -1 : 1, event.repeat);
        } else if (code === KEY.ENTER) {
          // On a terminal failure OK is the way back, matching the card's own guide.
          if (fault) leaveFinite();
          else openDeck();
        } else if (code === KEY.BACK || code === KEY.ESC) {
          if (fault) leaveFinite();
          else if (chrome.showing) chrome.clear();
          else leaveFinite();
        }
        return;
      }

      /*
       * The Live picture. Up and down always change channel, including on a channel that
       * has failed: there is no Live picture state where channel up leaves the viewer where
       * they were, which is what makes it impossible to be stuck.
       */
      if (code === KEY.UP) {
        playback.step(1, visible, event.repeat);
        return;
      }
      if (code === KEY.DOWN) {
        playback.step(-1, visible, event.repeat);
        return;
      }

      switch (code) {
        // The browser is off the left of the picture, so Left goes to it. OK does the
        // obvious thing, which is the same browser.
        case inlineStart:
        case KEY.ENTER:
          revealPanel();
          return;

        // Right always opens the deck, whether or not this channel has a DVR range, so the
        // key never changes meaning based on a range the viewer cannot see.
        case inlineEnd:
          if (current) openDeck();
          else chrome.raiseBanner();
          return;

        /*
         * RETURN clears transient feedback if anything is showing, and closes the
         * application only when there is nothing left to clear. Two presses to leave rather
         * than one, so the button that closes the application is never the first press.
         */
        case KEY.BACK:
        case KEY.ESC:
          if (chrome.showing) chrome.clear();
          else onRequestExit();
          return;
        // No default on purpose. An unrecognised key is not an instruction to go
        // somewhere, and the banner below is the whole of the right response: press
        // something a television does not recognise and it shows you what is on, it does
        // not open a menu.
      }
      chrome.raiseBanner();
    },
    [
      chrome,
      current,
      fault,
      inlineEnd,
      inlineStart,
      leaveFinite,
      onRequestExit,
      openDeck,
      revealPanel,
      playback,
      seekAvailable,
      seekFiniteFromKey,
      visible,
    ],
  );

  const onPanelKey: SurfaceKeyHandler = useCallback(
    (code, event) => {
      // The channel panel.
      openPanel();

      /*
       * While the keyboard has the field, most keys are the field's.
       *
       * Left and right are a caret, not navigation, which is the whole reason this guard exists:
       * a viewer correcting the third letter of a channel name must not be thrown into the
       * category rail. Digits are text here too, so channel dialling stands aside, and the letter
       * keys were never ours. What is left to the application is up and down, which leave the
       * field, Enter, which stays in the field, and RETURN, which is the way out of
       * everything.
       *
       * The same shape as the first run screen, which has the same problem with the same keyboard.
       */
      const typing =
        searching &&
        pane === "list" &&
        index === FIELD &&
        document.activeElement instanceof HTMLInputElement;
      if (typing) {
        /*
         * Left is the caret until there is nothing to its left, and then it is a direction again.
         *
         * Without this the categories were unreachable from the keyboard: left belongs to the caret,
         * so the only way back to the rail was down into the results and left from there, and on an
         * empty field left did nothing whatsoever, which is indistinguishable from the application
         * having stopped listening.
         *
         * At offset zero there is no text to move through, so the press can only mean what it means
         * everywhere else in the panel. This is how a caret leaves a field on every platform that
         * has both a caret and a four directional pad.
         */
        if (code === inlineStart) {
          const el = document.activeElement as HTMLInputElement;
          if (el.selectionStart === 0 && el.selectionEnd === 0) {
            event.preventDefault();
            el.blur();
            focusApplicationNavigation();
          }
          return;
        }
        if (code === KEY.UP) {
          event.preventDefault();
          (document.activeElement as HTMLInputElement).blur();
          focusApplicationNavigation();
          return;
        }
        if (code === KEY.DOWN) {
          event.preventDefault();
          if (column.length) setIndex(0);
          return;
        }
        if (code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          /*
           * What was typed, and then the search itself. Two presses, one thought each.
           *
           * It was three for a while, and the third was an accident worth recording: putting the
           * keyboard away was its own press, then clearing was another, then leaving was a third.
           * Clearing already returns the cursor to the field, which raises the keyboard again, so
           * "put the keyboard away" was a press that undid something the next press asked for.
           *
           * An empty field means there is no search left to go back through, so RETURN leaves.
           * Nothing needs to dismiss the keyboard on its own: pressing down does that on the way
           * to the results, which is where somebody who has finished typing is going anyway.
           */
          if (query) setQuery("");
          else closeSearch();
          return;
        }
        if (code === KEY.ENTER) {
          event.preventDefault();
          // Enter stays in the field rather than opening whatever is below it.
          return;
        }
        if (code !== KEY.UP && code !== KEY.DOWN) return;
      }

      /**
       * Play whatever the channel column has under the cursor.
       *
       * One function because OK is the obvious action in either channel-column mode. Written once
       * so choosing a search result and choosing a category row cannot drift apart: a result takes
       * the rail to that channel's category, and a row of a category does not need to.
       */
      const panelLength = column.length;
      const chooseChannel = () => {
        if (searching) {
          if (column[index]) pickResult(column[index]);
          return;
        }
        const channel = visible[index];
        if (!channel) return;
        // Choosing the channel already playing only puts the panel away rather than tearing the
        // stream down and rebuilding it: see pickChannel.
        if (channel.id !== current?.id) playback.start(channel);
        watch();
      };

      const atTop = index <= 0;
      const atBottom = index >= panelLength - 1;

      if (pane === "list") {
        if (code === KEY.UP) {
          event.preventDefault();
          setIndex((i) =>
            searching && atTop
              ? FIELD
              : searching
                ? stepColumn(i, -1, panelLength, true)
                : cycleIndex(i, -1, panelLength),
          );
          return;
        }
        if (code === KEY.DOWN) {
          event.preventDefault();
          if (searching && atBottom) setIndex(FIELD);
          else
            setIndex((i) =>
              searching ? stepColumn(i, 1, panelLength, true) : cycleIndex(i, 1, panelLength),
            );
          return;
        }
        if (code === inlineStart) {
          event.preventDefault();
          if (searching) focusApplicationNavigation();
          else {
            setPane("rail");
            if (cursor < 1) moveCursor(category + 1);
          }
          return;
        }
        if (code === inlineEnd || code === KEY.ENTER) {
          event.preventDefault();
          chooseChannel();
          return;
        }
      } else {
        if (code === KEY.UP) {
          event.preventDefault();
          nudgeCursor(-1);
          return;
        }
        if (code === KEY.DOWN) {
          event.preventDefault();
          nudgeCursor(1);
          return;
        }
        if (code === inlineStart) {
          event.preventDefault();
          focusApplicationNavigation();
          return;
        }
        if (code === inlineEnd || code === KEY.ENTER) {
          event.preventDefault();
          commitRailCursor();
          setPane("list");
          return;
        }
      }
      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        if (searching && query) {
          setQuery("");
          setApplied("");
          setIndex(FIELD);
        } else if (searching) closeSearch();
        else watch();
      }
      // Keep dependencies limited to what this handler reads.
    },
    [
      category,
      closeSearch,
      column,
      commitRailCursor,
      current,
      index,
      inlineEnd,
      inlineStart,
      moveCursor,
      nudgeCursor,
      focusApplicationNavigation,
      openPanel,
      pane,
      pickResult,
      query,
      searching,
      playback,
      visible,
      watch,
      cursor,
    ],
  );

  const onKey: SurfaceKeyHandler = useCallback(
    (code, event) => {
      if (event.defaultPrevented) return;
      if (navigationTransitionActive && onTransport(code, event.repeat)) {
        event.preventDefault();
        return;
      }
      if (!inputEnabled) return;
      if (
        surface === "settings" ||
        surface === "onboarding" ||
        surface === "exit" ||
        surface === "confirmation"
      )
        return;
      if (
        closingRail &&
        [KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER, KEY.BACK, KEY.ESC].includes(
          code as never,
        )
      ) {
        event.preventDefault();
        return;
      }
      if (surface === "details") {
        if (onTransport(code, event.repeat)) event.preventDefault();
        return;
      }
      if (onSharedKey(code, event)) return;
      /*
       * The deck and the playback drawers carry their own key handling, mounted with them:
       * the deck drives its own focus and the drawer answers Back. Here they only need to
       * not be mistaken for the picture.
       */
      if (surface === "guide") onGuideKey(code, event);
      else if (surface === "panel") onPanelKey(code, event);
      else if (surface === "picture") onPictureKey(code, event);
    },
    [
      closingRail,
      closePlaybackDetails,
      inputEnabled,
      navigationTransitionActive,
      onGuideKey,
      onPanelKey,
      onPictureKey,
      onSharedKey,
      onTransport,
      playbackDrawer,
      surface,
    ],
  );

  useLongPress({
    code: KEY.ENTER,
    enabled: inputEnabled && surface === "picture" && !!current,
    onShortPress: () => {
      if (chrome.digits) jump(Number(chrome.commitDigits()));
      else onPictureKey(KEY.ENTER, { preventDefault() {} } as KeyboardEvent);
    },
    onLongPress: () => {
      const state = useSettings.getState();
      state.set("showPlaybackStats", !state.showPlaybackStats);
    },
  });

  useRemote(onKey);

  // Which layer is on top decides what everything below it is allowed to draw.
  const modal =
    surface === "confirmation" ||
    surface === "settings" ||
    surface === "exit" ||
    surface === "onboarding"; // layer 4
  const panelOpen = liveSurface === "panel" && !loadFailed; // layer 3
  const covered = surface !== "picture"; // any focus owning surface covers the player
  const atPlayer = !covered; // layer 2 may show

  /**
   * Stop telling the panel things it cannot show.
   *
   * The panel stays mounted, because it slides rather than appears, so closed and off the
   * left edge it was still being handed a new playingId on every channel change and still
   * reconciling all twenty of its rows to move a dot nobody could see.
   *
   * Freezing what it is told is the whole fix, and it is deliberately not the more obvious
   * one. Dropping the rows outright was tried first and measured worse: see the note above
   * the row loop in ChannelList. This costs nothing, because the rows stay exactly where
   * they were and the memo simply stops missing.
   *
   * Only once the slide is over, so the panel is honest for the whole of its exit: choosing
   * a channel moves the marker to the row you chose while the panel is still on its way
   * out. How long that takes is read from the stylesheet that performs it, so reduced
   * motion, which sets the slide to zero, freezes immediately and is still correct.
   */
  const [restingClosed, setRestingClosed] = useState(false);
  useEffect(() => {
    if (panelOpen) {
      setRestingClosed(false);
      return;
    }
    const t = window.setTimeout(() => setRestingClosed(true), cssMs("--t-navigation"));
    return () => window.clearTimeout(t);
  }, [panelOpen]);

  const offScreen = !panelOpen && restingClosed;
  const told = useRef({ playingId: "", live: false });
  if (!offScreen)
    told.current = { playingId: current?.id ?? "", live: !fault && !paused && !busy };

  if (panelOpen) {
    searchExit.current = searching
      ? { query, channels: results.matches, total: results.total, index }
      : null;
  } else if (restingClosed) {
    searchExit.current = null;
  }
  const exitingSearch = !panelOpen && !restingClosed ? searchExit.current : null;
  const panelSearching = exitingSearch !== null || searching;
  const panelChannels = exitingSearch?.channels ?? column;
  const panelIndex = exitingSearch?.index ?? index;
  const panelQuery = exitingSearch?.query ?? query;
  const panelResultCount = exitingSearch?.total ?? results.total;

  /**
   * Handlers the panel hands to its rows.
   *
   * These have to keep their identity between renders. A fresh closure per render is a new
   * prop on every row, which walks straight past the memo and rebuilds the entire window
   * on every press of the down key.
   */
  /**
   * Choose a channel from the list.
   *
   * Choosing the one already playing puts the list away and leaves the picture alone. It used
   * to tear the stream down and rebuild it, which is a second of black and a re-buffer as the
   * answer to a viewer who opened the list, looked, and decided they were happy where they
   * were. Rebuilding a stream is now something you ask for, with Reload, rather than something
   * that happens because you pressed OK on the row you were already watching.
   */
  const pickChannel = useCallback(
    (i: number) => {
      setPane("list");
      setIndex(i);
      const channel = lists[category]?.channels[i];
      if (channel && channel.id !== currentRef.current?.id) playback.start(channel);
      watch();
    },
    [lists, category, playback.start, watch],
  );

  const focusCategory = useCallback((i: number) => {
    setPane("rail");
    cursorRef.current = i + 1;
    setCursor(i + 1);
  }, []);
  const pickCategory = useCallback(
    (i: number) => {
      moveCursor(i + 1);
      setPane("list");
    },
    [moveCursor],
  );
  const focusChannel = useCallback((i: number) => {
    setPane("list");
    setIndex(i);
  }, []);
  // Wheel handlers are props too, so a fresh closure would bypass each column's memo.
  const wheelCategory = useCallback(
    (direction: -1 | 1) => {
      if (!allowWheel("rail")) return;
      setPane("rail");
      nudgeCursor(direction);
    },
    [allowWheel, nudgeCursor],
  );
  const wheelChannel = useCallback(
    (direction: -1 | 1) => {
      if (!allowWheel("list")) return;
      setPane("list");
      setIndex((currentIndex) =>
        searching
          ? stepColumn(currentIndex, direction, column.length, true)
          : cycleIndex(currentIndex, direction, column.length),
      );
    },
    [allowWheel, column.length, searching],
  );
  const leaveSearchDown = useCallback(() => {
    if (column.length) setIndex(0);
  }, [column.length]);
  const searchOnField =
    inputEnabled && !navigationTransitionActive && pane === "list" && index === FIELD;
  const panelSearch = useMemo(
    () =>
      panelSearching
        ? {
            query: panelQuery,
            total: panelResultCount,
            /* The field holds the keyboard only while this column holds the remote. Stepping
               into the rail has to put the keyboard away, or it stays up over a list the
               viewer has left, covering the categories they went to read. */
            onField: searchOnField,
            onQuery: setQuery,
            onExitStart: leaveSearchStart,
            onExitUp: leaveSearchUp,
            onExitDown: leaveSearchDown,
          }
        : undefined,
    [
      leaveSearchDown,
      leaveSearchStart,
      leaveSearchUp,
      panelQuery,
      panelResultCount,
      panelSearching,
      searchOnField,
    ],
  );
  const railItems = useMemo(
    () =>
      lists.map((l) => ({
        key: l.key,
        name: isFavouritesList(l)
          ? t("channel.favourites")
          : l.name === UNCATEGORISED
            ? t("channel.uncategorised")
            : l.name,
        count: l.channels.length,
        hidden: !isFavouritesList(l) && savedHidden.has(l.key),
      })),
    [lists, savedHidden, t],
  );
  const selectedRailList = cursor > 0 ? lists[cursor - 1] : undefined;
  const visibilityKey =
    selectedRailList && !isFavouritesList(selectedRailList) ? selectedRailList.key : undefined;
  const categoryVisibilityGuide =
    pane === "rail" && visibilityKey
      ? t(savedHidden.has(visibilityKey) ? "guide.unhideCategory" : "guide.hideCategory")
      : undefined;

  /**
   * How wide the number column has to be, in figures.
   *
   * From the playlist's length rather than from the category on screen, because the numbers are
   * the playlist's: channel 12,732 keeps that number in a category of three. Sized here so the
   * names line up whatever the playlist, where a fixed 58px column held four figures and clipped
   * the fifth.
   */
  const numberDigits = useMemo(
    () =>
      String(channels.reduce((largest, channel) => Math.max(largest, channel.number), 1))
        .length,
    [channels],
  );

  /**
   * Pressing OK, or clicking, on a row of the channel column.
   *
   * One handler for both of the things that column can be showing, because the row does not know
   * and should not have to: a result is a channel drawn exactly as a category's channel is drawn.
   * What differs is what choosing one does, and that is decided here.
   *
   * Read through a ref rather than captured, so the identity survives a search being typed. The
   * rows are memoised on their props and this is one of them, so a handler that changed whenever
   * the results did would rebuild the whole window on the keystroke that produced them, which is
   * the frame that can least afford it.
   */
  const picking = useRef({ searching, matches: results.matches });
  picking.current = { searching, matches: results.matches };
  const searchPick = useCallback(
    (i: number) => {
      const { searching: inSearch, matches } = picking.current;
      if (!inSearch) {
        pickChannel(i);
        return;
      }
      if (matches[i]) pickResult(matches[i]);
    },
    [pickChannel, pickResult],
  );

  const shownId = playback.shown?.id;
  const shownMode = playback.shown?.mode;
  const bannerChannel = useMemo(
    () =>
      shownMode === "live" ? channels.find((channel) => channel.id === shownId) : undefined,
    [channels, shownId, shownMode],
  );
  const bannerGuide = bannerChannel ? guides[bannerChannel.id] : undefined;

  /** What the deck says about what is on: live metadata where a guide exists for it. */
  const deckMetadata = useMemo<PlaybackDeckMetadata>(
    () => ({
      kind: playback.shown?.kind ?? "live",
      title: playback.shown?.name ?? "",
      number: bannerChannel?.number,
      group: playback.shown?.group,
      logo: playback.shown?.logo,
      year: playback.shown?.year,
      rating: playback.shown?.rating,
      quality: bannerChannel?.quality || undefined,
      currentProgramme: bannerGuide?.current?.title,
      currentStart: bannerGuide?.current?.startTimestamp,
      currentEnd: bannerGuide?.current?.stopTimestamp,
      nextProgramme: bannerGuide?.next?.title,
    }),
    [
      bannerChannel?.number,
      bannerChannel?.quality,
      bannerGuide,
      playback.shown?.group,
      playback.shown?.kind,
      playback.shown?.logo,
      playback.shown?.name,
      playback.shown?.rating,
      playback.shown?.year,
    ],
  );

  const deckVisible = !!current && deckOpen && !fault && surface === "playback-deck";
  const subtitlesVisible =
    !modal &&
    playbackDrawer !== "details" &&
    playback.capabilities.subtitleTracks.some((track) => track.selected);

  return (
    <>
      {/* ---- layer 1, the player -------------------------------------------------- */}
      {/* Only off the TV. AVPlay drives the set's own video plane and never touches this
          element, so on Tizen it would be an opaque black box sitting on top of the
          picture for no reason, and one more layer for the compositor to think about. */}
      {!onTizen() && <video ref={videoRef} className="video" playsInline muted={false} />}

      {/*
       * A configured playlist that produced nothing.
       *
       * The way out is named rather than drawn. Checklist 2.2 and 3.2 both require every
       * selectable object to be reachable with the four directional buttons, and a button
       * on this screen would have to earn that: there is no list to move through here, so
       * nothing would focus it and it would be a dead end with a control drawn on it.
       * Naming the keys that already work is the honest answer, and it is what the rest of
       * the app does. OK and the yellow key both open Settings from here.
       */}
      {configured &&
        (loadFailed ||
          (!channels.length && (loading || activePlaylist?.source.kind !== "xtream"))) && (
          <div
            className={`splash ${loadFailed ? "playlist-recovery" : ""}`}
            role={loadFailed ? "alert" : loading ? "status" : undefined}
            aria-busy={loading || retryingPlaylist || undefined}
          >
            {/*
             * The mark above the name, because this is the first thing a viewer sees after choosing
             * the app and a launcher tile that turns into a word on a black screen does not look like
             * the same application starting. The same file the launcher itself draws, so the two
             * cannot drift: scripts/icon.mjs renders the bitmap from this vector.
             */}
            <img className="splash-mark" src="./icon.svg" alt="" aria-hidden="true" />
            <h1>OpenIPTV</h1>
            <p>
              {loadFailed
                ? errorKey
                  ? t(errorKey, { detail: errorDetail })
                  : error
                : loading
                  ? t("app.loadingPlaylist")
                  : t("app.emptyPlaylist")}
            </p>
            {/* Under the line it belongs to rather than above the name, so the eye reads the mark, then
              what is happening, and the moving thing is last: a spinner at the top of a column drags
              attention off the words it is supposed to be explaining. */}
            {loading && <div className="spinner" />}
            {loadFailed && (
              <div className="playlist-recovery-actions">
                <button
                  type="button"
                  className="btn tonal"
                  data-selected={inputEnabled && recoveryAction === "retry" ? true : undefined}
                  disabled={retryingPlaylist}
                  onClick={() => void retryPlaylist()}
                >
                  <Icon name="refresh" />
                  <span>{t("vod.retry")}</span>
                </button>
                <button
                  type="button"
                  className="btn tonal"
                  data-selected={
                    inputEnabled && recoveryAction === "settings" ? true : undefined
                  }
                  disabled={retryingPlaylist}
                  onClick={onChoosePlaylist}
                >
                  <Icon name="playlists" />
                  <span>{t("app.chooseAnotherPlaylist")}</span>
                </button>
              </div>
            )}
            {!loading && (
              <KeyGuide
                className="splash-keys"
                items={
                  loadFailed
                    ? [
                        { keys: ["↑", "↓"], label: t("common.move") },
                        { keys: ["OK"], label: t("common.select") },
                        { keys: ["Return"], label: t("common.closeApp") },
                      ]
                    : [
                        { keys: ["OK"], label: t("app.chooseAnotherPlaylist") },
                        { keys: ["Return"], label: t("common.closeApp") },
                      ]
                }
              />
            )}
          </div>
        )}

      {/*
       * What is happening to the picture, in the middle of the picture, and nowhere else.
       *
       * Connecting, waiting, paused and failed are all things happening to the picture, so they
       * are reported over it, by one surface whose words change. The banner along the bottom
       * reports on the channel and says nothing about any of this.
       *
       * Tied to the state itself and to no timer, so checklist 4.5 holds: the indicator
       * outlasts the task rather than the other way round.
       */}
      {current && !covered && (
        <PictureState
          channel={current.name}
          busy={busy && !deckOpen && !compactRecoveryVisible && !playback.recovery.hasPlayed}
          filling={snapshot.bufferedPercent}
          waited={waited}
          fault={fault}
          finite={current.mode === "finite"}
          paused={
            paused &&
            !busy &&
            !compactRecoveryVisible &&
            !deckOpen &&
            !playbackPending &&
            !playback.seeking
          }
        />
      )}
      {current?.mode === "finite" && playback.quickSeek && atPlayer && (
        <QuickSeek state={playback.quickSeek} />
      )}
      {current && atPlayer && inputEnabled && (
        <PlaybackInfo
          read={playback.getStats}
          seekable={seekAvailable}
          visible={showPlaybackStats}
          recovery={{
            cause: playback.recovery.cause,
            attempt: playback.recovery.attempt,
            continuous: playback.recovery.continuous,
          }}
        />
      )}

      {/*
       * The Live title banner is a report only surface for channel changes and keeps its
       * eight second reading interval. Finite playback does not use it, and it hides
       * beneath the deck, a drawer, the browser, and every modal: the `atPlayer` gate is
       * what hides it beneath each of those.
       *
       * Its timer starts with the selection and does not depend on loading or playback.
       * It names the selected channel, which may differ from the playing channel during a zap.
       */}
      {playback.shown?.mode === "live" &&
        bannerChannel &&
        atPlayer &&
        !fault && (
          <PlaybackBanner
            visible={chrome.banner}
            channel={bannerChannel}
            programme={{
              current: bannerGuide?.current?.title,
            }}
            targetKey={playback.shown?.id ?? bannerChannel.id}
          />
        )}

      {/* ---- layer 3, the playback deck and its drawers ------------------------------ */}
      {current && deckVisible && (
        <PlaybackDeck
          snapshot={snapshot}
          metadata={deckMetadata}
          focus={deckFocus}
          canPause={playback.capabilities.canPause}
          /* Guide is available in its programme card only while the playing channel has
             programme data to open, the same rule the browser header uses. */
          hasGuide={
            !!bannerChannel?.xtream &&
            bannerGuide?.state === "loaded" &&
            bannerGuide.items.length > 0
          }
          hasAudio={playback.capabilities.audioTracks.length > 0}
          hasSubtitles={playback.capabilities.subtitleTracks.length > 0}
          subtitleCue={subtitlesVisible ? playback.subtitleCue : ""}
          previousEnabled={
            current.mode === "live" ? visible.length > 1 : finiteStepAvailable(-1)
          }
          nextEnabled={current.mode === "live" ? visible.length > 1 : finiteStepAvailable(1)}
          onFocus={setDeckFocus}
          onSeek={seekDeck}
          onAction={onDeckAction}
          onClose={handleDeckBack}
          onInteraction={chrome.clear}
          inputEnabled={inputEnabled}
          targetKey={playback.shown?.id ?? current.id}
        />
      )}
      {(playbackDrawer === "audio" || playbackDrawer === "subtitles") && !modal && (
        <PlaybackDrawer
          key={playbackDrawer}
          title={t(`deck.${playbackDrawer}`)}
          icon={playbackDrawer === "audio" ? "audio" : "subtitles"}
          origin={drawerOrigin.current}
          closing={closingRail === playbackDrawer}
          onClosed={finishRailClose}
          footer={
            <KeyGuide
              className="playback-drawer-hints ruled"
              items={[
                { keys: ["\u2191", "\u2193"], label: t("common.move") },
                { keys: ["OK"], label: t("common.select") },
                { keys: ["\u2190", "RETURN"], label: t("common.close") },
              ]}
            />
          }
          onBack={closePlaybackDrawer}
        >
          {playbackDrawer === "audio" ? (
            <TrackPicker
              kind="audio"
              tracks={playback.capabilities.audioTracks}
              selectedIdentity={
                playback.capabilities.audioTracks.find((track) => track.selected)?.identity ??
                null
              }
              deviceLanguage={navigator.language}
              inputEnabled={inputEnabled && !closingRail}
              onSelect={(engineIndex, identity) => {
                const moved = playback.selectTrack("audio", engineIndex, { identity });
                if (!moved) chrome.say(t("deck.trackUnavailable"));
                return moved;
              }}
            />
          ) : (
            <TrackPicker
              kind="subtitle"
              tracks={playback.capabilities.subtitleTracks}
              selectedIdentity={
                playback.capabilities.subtitleTracks.find((track) => track.selected)
                  ?.identity ?? null
              }
              deviceLanguage={navigator.language}
              inputEnabled={inputEnabled && !closingRail}
              onSelect={(engineIndex, identity, automatic) => {
                const moved = playback.selectTrack("subtitle", engineIndex, {
                  identity,
                  automatic,
                });
                if (!moved) chrome.say(t("deck.trackUnavailable"));
                return moved;
              }}
            />
          )}
        </PlaybackDrawer>
      )}
      {playbackDrawer === "details" && current && !modal && (
        <PlaybackDetails
          key={current.id}
          target={current}
          movie={movieDetails}
          series={seriesDetails}
          durationSeconds={snapshot.duration ?? undefined}
          onClose={closePlaybackDetails}
          inputEnabled={inputEnabled}
        />
      )}

      {/*
       * Open controls own the cue so CSS can anchor it above their complete height.
       * Other picture surfaces use the normal safe area position.
       */}
      <SubtitleLayer
        cue={playback.subtitleCue}
        hidden={!subtitlesVisible || deckVisible}
      />

      {guideChannel && !modal && (
        <PlaybackDrawer
          title={guideChannel.name || t("channel.unnamed")}
          icon="guide"
          subtitle={t("guide.subtitle")}
          ariaLabel={t("guide.title", {
            category: guideChannel.name || t("channel.unnamed"),
          })}
          origin={guideOrigin.current === "deck" ? "guide" : "live-browser"}
          closing={closingRail === "guide"}
          onClosed={finishRailClose}
          className="guide-drawer"
          footer={
            <KeyGuide
              className="guide-drawer-hints ruled"
              items={[
                ...(guide.state === "loaded" && guide.items.length
                  ? [{ keys: ["\u2191", "\u2193"], label: t("common.move") }]
                  : []),
                ...(guide.state === "failed"
                  ? [{ keys: ["OK"], label: t("library.retry") }]
                  : guide.items[guideIndex]?.target
                    ? [{ keys: ["OK"], label: t("guide.playFromStart") }]
                    : []),
                { keys: ["\u2190", "RETURN"], label: t("common.close") },
              ]}
            />
          }
          onBack={() => closeGuide()}
        >
          <GuideList
            key={`${guideChannel.id}:${guide.items.map((item) => item.id).join(",")}`}
            channel={guideChannel}
            guide={guide}
            index={guideIndex}
            focused
            scale={scale}
            onMove={setGuideIndex}
            onPlay={(at) => {
              setGuideIndex(at);
              playGuide(at);
            }}
            onRetry={retryGuide}
            onWheel={(direction) => {
              if (!allowWheel("guide")) return;
              setGuideIndex((currentIndex) =>
                Math.max(0, Math.min(guide.items.length - 1, currentIndex + direction)),
              );
            }}
          />
        </PlaybackDrawer>
      )}

      {/* ---- layer 3, the panel ---------------------------------------------------- */}
      {panelHost &&
        createPortal(
          <div className={`panel ${panelOpen ? "" : "away"}`}>
            <div className={`panel-cols ${panelSearching ? "searching" : ""}`}>
              {!panelSearching && (
                <Sidebar
                  categories={railItems}
                  /* Nothing is showing while a search is, and the rail has to say so. Left pointing at
                   the category the column used to hold, the marker claims the results beside it came
                   from there, which is the one thing that mark means. The Search key carries the state
                   instead, which is where it belongs. */
                  selected={category}
                  cursor={cursor}
                  loading={loading}
                  allHidden={categories.length > 0 && !lists.length}
                  focused={inputEnabled && pane === "rail"}
                  scale={scale}
                  onFocus={focusCategory}
                  onSelect={pickCategory}
                  onWheel={wheelCategory}
                />
              )}
              <ChannelList
                channels={panelChannels}
                category={displayListName(lists[category])}
                index={panelIndex}
                loading={loading}
                focused={inputEnabled && pane === "list"}
                playingId={told.current.playingId}
                live={told.current.live}
                favourites={favouriteIds}
                showNumbers={showNumbers}
                showLogos={showLogos}
                scale={scale}
                numberDigits={numberDigits}
                search={panelSearch}
                onFocus={focusChannel}
                onSelect={searchPick}
                onWheel={wheelChannel}
              />
            </div>

            {/*
             * The key guide, along the foot of the panel it describes.
             *
             * Inside the panel rather than floating beside it. Here it has the panel's full
             * width, it cannot collide with the pointer pad, and it sits beside the list it is
             * talking about. It is a row of the panel rather than an overlay on it, so it takes
             * its space from the list instead of covering the bottom of it, which is what
             * checklist 1.3 asks for.
             */}
            {/* Four items, because a fifth wraps the line, and wrapping the one piece of writing
                that explains the application is a poor trade. The green key is taught on the
                banner instead, which has the whole width of the screen for it. It used to be
                taught by the empty Favourites list saying how to fill itself, and that row is no
                longer drawn while it is empty. */}
            {/* While a search is showing, two of the four are no longer true: the digits are text
                in the field rather than a channel number, and RETURN goes back through the search
                before it goes back to the picture. A guide that says otherwise is worse than none. */}
            <KeyGuide
              className="panel-hints ruled"
              items={
                panelSearching
                  ? [
                      { keys: ["\u2191", "\u2193"], label: t("common.move") },
                      {
                        keys: ["OK"],
                        label:
                          panelIndex === FIELD ? t("guide.showMatches") : t("common.watch"),
                      },
                      {
                        keys: ["Return"],
                        label: panelQuery ? t("guide.clear") : t("common.backToChannels"),
                      },
                    ]
                  : [
                      { keys: ["\u2191", "\u2193"], label: t("common.move") },
                      { keys: ["OK"], label: t("common.watch") },
                      categoryVisibilityGuide
                        ? { keys: ["Red"], label: categoryVisibilityGuide }
                        : { keys: ["0-9"], label: t("common.channelNumber") },
                      {
                        keys: ["Return"],
                        label: current ? t("common.backToPicture") : t("common.closeApp"),
                      },
                    ]
              }
            />
          </div>,
          panelHost,
        )}
    </>
  );
}
