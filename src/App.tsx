import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannels } from "./stores/channels";
import { useSettings } from "./stores/settings";
import { onTizen } from "./services/player";
import { warmChain } from "./services/logos";
import { cssMs } from "./services/metrics";
import { whenIdle } from "./services/idle";
import { FAVOURITES, listsOf, stepColumn, wrap } from "./services/lineup";
import { searchChannels } from "./services/search";
import { KEY, registerRemoteKeys, useRemote } from "./hooks/useRemote";
import { ChannelList } from "./components/ChannelList";
import { Sidebar } from "./components/Sidebar";
import { PanelHeader } from "./components/PanelHeader";
import { Settings } from "./components/Settings";
import { PlaybackBanner } from "./components/PlaybackBanner";
import { Onboarding } from "./components/Onboarding";
import { Clock } from "./components/Clock";
import { ExitDialog, exitApp } from "./components/ExitDialog";
import { PictureState } from "./components/PictureState";
import { KeyGuide } from "./components/KeyGuide";
import { PointerPad } from "./components/PointerPad";
import { SmartRemote, remoteVisible } from "./components/SmartRemote";
import { useChrome } from "./hooks/useChrome";
import { usePointerAwake } from "./hooks/usePointerAwake";
import { RETRY_DELAYS_MS, useTuner } from "./hooks/useTuner";
import type { Channel } from "./types";

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

/**
 * The screen is a stack, and only the top of it is ever showing.
 *
 *   1    the player, always present, filling the screen
 *   1.1  a failed channel, drawn in the player rather than over everything
 *   2    the playback banner and its key guide, transient
 *   3    the channel panel
 *   4    settings, the close confirmation and first run
 *
 * The rule is that a layer only appears when nothing above it is open, which is what
 * stops the interface piling up on itself. Choosing a channel closes the panel, so the
 * banner appears with the name and holds while the channel tunes, and eight seconds after
 * the picture arrives that goes too and only the programme is left.
 *
 * Layer 1.1 is why a broken channel does not interrupt anything. It takes no focus and
 * blocks no keys, so pressing down to try the next channel works exactly as it does when
 * the picture is fine, which in a playlist where some channels are off the air is the
 * difference between hopping and being nagged.
 *
 * Two places, not three. The name, the number, the category and the quality all fit on the
 * banner along the bottom, so a second panel on the right would only repeat the first, and
 * Right is worth more as a way through what is already on screen.
 */
type View = "watch" | "panel";

/**
 * ---------------------------------------------------------------------------------------
 * The whole key model, which is four laws and no exceptions.
 * ---------------------------------------------------------------------------------------
 *
 *   1. At the picture, up and down always change channel. In every state, whatever is on
 *      screen, whatever holds the focus. In the channel list they move the highlight, because
 *      there is visibly a list with a highlight in it.
 *   2. OK does the obvious thing where it is pressed. At the picture that is always the
 *      channel list, and on a focused button it is that button.
 *   3. Left and right move within whatever is showing, and then one step further in or out of
 *      it. Left goes towards the picture and right goes away from it: at the picture, left
 *      opens the channel list, because that is what is off the left of the screen, and right
 *      has nothing to travel to so it puts away whatever is on screen. In the panel, right
 *      moves one step further in at every stop and plays the highlighted channel at the last
 *      one, since the only thing further in than the channel list is the programme.
 *   4. RETURN always goes back. It clears the screen if anything is on it, closes the panel if
 *      the panel is open, and closes the application only when there is nothing left to close.
 *
 * Law 1 is the one worth defending. Samsung's media player guidance gives up and down to the
 * playback controls, but this is a television and up and down have changed channel on every
 * television ever built. Making them mean something else, or worse making them mean something
 * else only sometimes, is the single most confusing thing this app could do.
 *
 * Being absolute is also what makes it impossible to get stuck. There is no state at the
 * picture, including a channel that has failed and including one with a button focused, where
 * channel up leaves the viewer where they were. Whatever has gone wrong, one press moves on.
 *
 * What it costs is that nothing else at the picture may claim up and down, which is why there is
 * no row of buttons there to be reached with them and why the banner reports rather than offers.
 * What it buys is that there is nothing to learn.
 */


export default function App() {
  const { channels, categories, favourites, load, sweep, loading, error, toggleFavourite,
          rememberLast, lastPlayed } = useChannels();
  const settings = useSettings();
  const configured = settings.playlists.length > 0;

  /**
   * Where a launch starts, which is at the picture when there is a picture to come back to.
   *
   * Decided at mount rather than after the playlist arrives, and that is the difference
   * between resuming and appearing to resume. The panel used to open on every launch and
   * then be closed again once the last channel had been found, so a viewer switching the
   * television on saw the channel list appear, sit there for as long as the playlist took,
   * and then slide away from a channel they had not chosen.
   *
   * It can be decided this early because both halves of the question are answered by
   * localStorage, synchronously: whether the viewer asked for resuming at all, and whether
   * there is a channel remembered. Whether that channel is still in the playlist is not
   * known yet, and the effect below opens the panel if it turns out not to be, which is the
   * one case where the list is the honest thing to show.
   */
  const [view, setView] = useState<View>(
    () => (useSettings.getState().resumeLast && useChannels.getState().lastPlayed()
      ? "watch"
      : "panel"),
  );
  /* Zero, the top of the rail, which is the playlist's first category until there is a
     favourite and Favourites once there is. Both are worth opening on, and neither can be
     empty: the row only exists while it has something in it. */
  const [category, setCategory] = useState(0);
  const [cursor, setCursor] = useState(1);   // rail row, zero is the title bar
  const [index, setIndex] = useState(0);
  const [pane, setPane] = useState<"rail" | "list">("list");
  const [showSettings, setShowSettings] = useState(false);
  const [showExit, setShowExit] = useState(false);

  /**
   * Which of the title bar's two keys the cursor is on, while it is up there.
   *
   * The bar is one cursor position with two keys in it rather than two positions, because left
   * and right already mean "move within whatever is showing" and up and down already walk the
   * rail. Search is the leftmost and the one arrived at, since it is the one anybody reaches for.
   */
  const [headerKey, setHeaderKey] = useState<"search" | "settings">("search");

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

  const chrome = useChrome();
  const pointerAwake = usePointerAwake();
  const hideTimer = useRef<number | undefined>(undefined);
  const railTimer = useRef<number | undefined>(undefined);

  const lists = useMemo(
    () => listsOf(channels, categories, favourites),
    [channels, categories, favourites],
  );

  /**
   * The favourites, as a set, because the channel list asks about every row it draws.
   *
   * An array meant `favourites.includes(id)` per row per render, which is a scan of the
   * whole favourites list twenty times over for every press of the down key. Nobody
   * notices with three favourites and everybody notices with two hundred.
   */
  const favouriteIds = useMemo<ReadonlySet<string>>(
    () => (favourites.length ? new Set(favourites) : NO_FAVOURITES),
    [favourites],
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
  const results = useMemo(() => searchChannels(channels, applied), [channels, applied]);

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

  const videoRef = useRef<HTMLVideoElement>(null);
  const tuner = useTuner({
    list: visible,
    fit: settings.aspectId,
    video: videoRef,
    rememberLast,
    onNamed: chrome.holdBanner,
    onPicture: chrome.raiseBanner,
    onFault: chrome.lowerBanner,
    compatibility: settings.compatibility,
  });
  const { current, busy, paused, fault } = tuner;
  /** The channel as it is now, for callbacks that run between renders. */
  const currentRef = useRef<Channel | null>(null);
  currentRef.current = current;

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
    if (!settings.showLogos || !lists.length) return;
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
  }, [lists, category, settings.showLogos]);

  useEffect(() => {
    registerRemoteKeys();
    void load();
    /* Housekeeping, and deliberately after the load rather than before it. The playlist is
       what the viewer is waiting for; collecting cached copies of playlists they removed
       months ago is not, and doing it first would put a flash read in front of the picture
       to save space nobody is short of yet.

       Cancelled on unmount, which is not only tidiness: StrictMode mounts twice in
       development, so without this every reload queues a sweep from the discarded mount as
       well as the live one, and both run. */
    return whenIdle(() => void sweep(), 8000);
  }, [load, sweep]);

  /*
   * Every timer this component owns, called off when it goes.
   *
   * zapTimer is the one that matters. It fires tuner.start(), which reaches for the player, and
   * the effect that owns the player has already stopped and detached it by then, so a tune
   * that was still settling ran against a discarded engine. StrictMode mounts everything
   * twice in development, which makes it reachable on any page load rather than only on an
   * unmount nobody performs.
   */
  useEffect(() => () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(railTimer.current);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font", settings.font().stack);
    root.style.setProperty("--scale", String(settings.scale()));
  }, [settings]);


  useEffect(() => {
    if (view === "watch" && current) chrome.raiseBanner();
  }, [view, current?.id, chrome.raiseBanner]);

  /**
   * Hold the banner open while the channel is still coming.
   *
   * Its eight seconds are counted from the press, and joining a stream can take twice
   * that: the name went away, the picture had not arrived, and the viewer was left with a
   * black screen and a turning ring that said nothing about what they were waiting for.
   * Checklist 4.5 wants a task that is under way to say so, and what the viewer needs said
   * is the name of the channel. So while it is tuning the banner is held, and the five
   * seconds begin when there is finally something to look at.
   */
  useEffect(() => {
    if (!busy || !current || view !== "watch") return;
    chrome.holdBanner();
  }, [busy, current, view, chrome.holdBanner]);

  /**
   * And when the waiting ends, whatever ended it, the eight seconds begin.
   *
   * The other half of the effect above, without which a held banner could stay up for ever. The
   * countdown used to be restarted only by a picture arriving, and an arrival is announced once per
   * channel, so anything that made the app busy again on a channel it had already announced left the
   * banner held with nothing to lower it. Pausing and playing was the reliable way to see it, and it
   * went away on right or back only because those clear every overlay at once.
   *
   * settleBanner refuses to raise a banner that is already down, so this cannot resurrect one after
   * a stall recovers.
   */
  useEffect(() => {
    if (busy || !current || view !== "watch") return;
    chrome.settleBanner();
  }, [busy, current, view, chrome.settleBanner]);

  /** The rail cursor as it is now, for presses that arrive faster than renders. */
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  /**
   * Which column the cursor was in before it went up into the title bar.
   *
   * Search and Settings sit above both columns, so leaving them downward has to land where the
   * viewer came from rather than always in the categories. A ref rather than state because it is
   * read by the key handler between renders, and nothing on screen depends on it.
   */
  const barFrom = useRef<"rail" | "list">("rail");


  // The channel panel withdraws on its own once there is a picture behind it to withdraw
  // to. With nothing playing it stays, because hiding it would leave the viewer on an
  // empty screen wondering what happened.
  const openPanel = useCallback(() => {
    setView("panel");
    window.clearTimeout(hideTimer.current);
    if (settings.panelTimeout > 0) {
      hideTimer.current = window.setTimeout(
        () => setView((v) => (v === "panel" && currentRef.current ? "watch" : v)),
        settings.panelTimeout * 1000,
      );
    }
  }, [settings.panelTimeout]);

  const watch = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setView("watch");
  }, []);

  /**
   * Which list a channel lives in, preferring a real category over Favourites.
   *
   * A favourite appears twice, and landing in the Favourites list would quietly move the
   * viewer somewhere they did not ask to be, so the playlist's own grouping wins.
   */
  const locate = useCallback((channel: Channel) => {
    const has = (l: { channels: Channel[] }) => l.channels.some((c) => c.id === channel.id);
    const real = lists.findIndex((l, i) => !(i === 0 && l.name === FAVOURITES) && has(l));
    return real >= 0 ? real : lists.findIndex(has);
  }, [lists]);

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
  const showCategory = useCallback((to: number, at: number, now: boolean) => {
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
      if (searchingRef.current) {
        window.clearTimeout(queryTimer.current);
        setSearching(false);
      }
      setCategory(to);
      setIndex(at);
    };
    if (now) apply();
    else railTimer.current = window.setTimeout(apply, RAIL_SETTLE_MS);
  }, []);

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
    if (!lists.length || category < lists.length) return;
    const to = lists.length - 1;
    setCursor(to + 1);
    cursorRef.current = to + 1;
    showCategory(to, 0, true);
  }, [lists.length, category, showCategory]);

  /**
   * Open the panel on whatever is playing.
   *
   * Coming back to the list should feel like returning to where you were, not to wherever
   * the cursor happened to be left. Reopening it puts the highlight back on the channel
   * on screen, in the category that channel belongs to.
   */
  const revealPanel = useCallback(() => {
    const playing = currentRef.current;
    if (playing) {
      const cat = locate(playing);
      if (cat >= 0) {
        setCursor(cat + 1);
        cursorRef.current = cat + 1;
        showCategory(cat, lists[cat].channels.indexOf(playing), true);
      }
    }
    setPane("list");
    openPanel();
  }, [locate, lists, openPanel, showCategory]);

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
    if (!settings.resumeLast) return;

    const found = channels.find((c) => c.id === lastPlayed());
    if (!found) {
      if (lastPlayed()) openPanel();
      return;
    }
    const cat = locate(found);
    if (cat >= 0) {
      setCursor(cat + 1);
      cursorRef.current = cat + 1;
      showCategory(cat, lists[cat].channels.indexOf(found), true);
    }
    setPane("list");
    tuner.start(found);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Put the rail cursor somewhere, and let the category follow.
   *
   * The cursor moves on the press, which is the first of the two Tab UI behaviours Samsung
   * describes and the half that has to be immediate: the highlight is the app answering the
   * key. The column it names follows once the walking stops, for the reason set out at
   * RAIL_SETTLE_MS. Row zero is the Settings key, which is not a category and shows nothing.
   */
  const moveCursor = useCallback((to: number) => {
    cursorRef.current = to;
    setCursor(to);
    if (to > 0) showCategory(to - 1, 0, false);
  }, [showCategory]);

  /**
   * Move the rail cursor by one, from wherever it actually is.
   *
   * By a delta rather than to a position, and read from a ref rather than from state, because
   * the input guide says movement accelerates while a direction is held: presses then arrive
   * faster than React re-renders, and every press in a burst was computing its destination
   * from the same captured cursor. Holding Down walked one row and stopped dead.
   */
  const nudgeCursor = useCallback((delta: number) => {
    // The rail has Settings at zero above the categories, so its length is one more.
    moveCursor(wrap(cursorRef.current + delta, lists.length + 1));
  }, [moveCursor, lists.length]);

  const jump = useCallback((n: number) => {
    const found = channels.find((c) => c.number === n);
    if (!found) {
      chrome.say(`No channel ${n} in this playlist.`);
      return;
    }
    const cat = locate(found);
    if (cat >= 0) {
      setCursor(cat + 1);
      cursorRef.current = cat + 1;
      showCategory(cat, lists[cat].channels.indexOf(found), true);
    }
    tuner.start(found);
  }, [channels, lists, locate, tuner.start, chrome.say, showCategory]);

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
  const favouriteCurrent = useCallback((channel: Channel | undefined) => {
    if (!channel) return;
    const had = favourites.includes(channel.id);
    const appears = !had && !favourites.length;
    const vanishes = had && favourites.length === 1;

    if (appears || vanishes) {
      const from = Math.max(0, cursorRef.current - 1);
      const to = Math.max(0, from + (appears ? 1 : -1));
      setCursor(to + 1);
      cursorRef.current = to + 1;
      // Standing in Favourites as the last one goes: the row that takes its place is a
      // different list, and the row the highlight was on is not in it.
      showCategory(to, vanishes && from === 0 ? 0 : index, true);
    }

    toggleFavourite(channel.id);
    chrome.say(had ? "Removed from favourites" : "Added to favourites");
  }, [favourites, toggleFavourite, chrome.say, index, showCategory]);

  /**
   * Open search, which means the channel column stops being a category.
   *
   * The cursor goes to the field, which is index -1: the field is the row above the first
   * result, so up and down walk the column and the keyboard is reached by pressing up from the
   * top of the list. That is one path rather than a mode, and it is why nothing here has to
   * teach the viewer a way back out.
   *
   * The query is kept between visits deliberately. Somebody who searched for a channel, watched
   * it, and came back to look for the next one has almost always got the same word in mind, and
   * a field that empties itself is a field that has to be typed into twice.
   */
  const openSearch = useCallback(() => {
    setSearching(true);
    setPane("list");
    setIndex(FIELD);
    openPanel();
  }, [openPanel]);

  /**
   * Leave search, and land somewhere that exists.
   *
   * The cursor cannot stay where it was: it is somewhere in a list of results that is about to
   * stop being drawn, and the column underneath is a category with its own length. So it goes to
   * the top of that category, which is the only row certain to be there.
   */
  const closeSearch = useCallback(() => {
    window.clearTimeout(queryTimer.current);
    setSearching(false);
    setIndex(0);
  }, []);

  /**
   * Play a result, and take the rail with it.
   *
   * Choosing a channel by name is the one way into a channel that says nothing about where it
   * lives, and leaving the rail on whatever category it happened to be showing has two costs
   * that are both invisible until they bite: channel up and down would walk a category the
   * playing channel is not in, and closing search would land the viewer somewhere unrelated to
   * what they are watching. So the rail follows, exactly as it does for a dialled number.
   */
  const pickResult = useCallback((channel: Channel) => {
    const cat = locate(channel);
    if (cat >= 0) {
      setCursor(cat + 1);
      cursorRef.current = cat + 1;
      showCategory(cat, lists[cat].channels.indexOf(channel), true);
    }
    closeSearch();
    if (channel.id !== currentRef.current?.id) tuner.start(channel);
    watch();
  }, [locate, lists, showCategory, closeSearch, tuner.start, watch]);

  /**
   * Transport keys. Checklist 2.3 wants every playback button on the remote to work.
   * Off a stream they do nothing and say nothing, which is what the input guide specifies
   * for playback keys outside playback.
   */
  const onTransport = useCallback((code: number): boolean => {
    const transport = code === KEY.PLAY_PAUSE || code === KEY.PLAY || code === KEY.PAUSE
      || code === KEY.SPACE
      || code === KEY.STOP || code === KEY.REWIND || code === KEY.FORWARD
      || code === KEY.PREV || code === KEY.NEXT;
    if (!transport) return false;
    if (!current) return true;

    switch (code) {
      /* Pausing has no on-screen button, because it does not need one: it has a key on the
         Smart Remote, a key on every keyboard and a button on the on-screen pad. The banner
         still comes up as a notice, so the viewer can see which channel they have just held,
         and the picture itself says Paused. */
      case KEY.PLAY_PAUSE:
      case KEY.SPACE: tuner.togglePause(); chrome.raiseBanner(); break;
      case KEY.PLAY: tuner.setPlaying(true); chrome.raiseBanner(); break;
      case KEY.PAUSE: tuner.setPlaying(false); chrome.raiseBanner(); break;
      /*
       * Stop returns to the channel list rather than leaving a black screen.
       *
       * Stopping live television is a strange thing to ask for and the key exists, so the
       * kindest reading of it is "I have finished with this channel", which is the list.
       */
      case KEY.STOP:
        tuner.clear();
        currentRef.current = null;
        chrome.lowerBanner();
        revealPanel();
        break;
      /*
       * The scan keys reload the channel.
       *
       * Nothing can be scanned through: there is no timeline any more, and on most of these
       * streams there never was one worth trusting. Rather than answering with a refusal, or
       * with nothing at all, they do the useful thing that is nearest to what was asked, which
       * on a live stream that has stalled is to fetch it again.
       */
      case KEY.REWIND:
      case KEY.FORWARD: tuner.retune(); break;
      // Previous and next channel, which is what "previous and next" means on live
      // television. They announce rather than take focus, because they change the channel.
      case KEY.PREV: tuner.step(-1); break;
      case KEY.NEXT: tuner.step(1); break;
    }
    return true;
  }, [current, tuner, chrome.raiseBanner, revealPanel]);

  const onKey = useCallback((code: number, event: KeyboardEvent) => {
    // Only layer four owns the remote. A failed channel deliberately does not: pressing
    // down to try the next one has to keep working.
    if (!configured || showSettings || showExit) return;

    if (onTransport(code)) { event.preventDefault(); return; }

    // Consistency of Controls: a coloured key does the same thing wherever the viewer is.
    if (code === KEY.YELLOW) { event.preventDefault(); setShowSettings(true); return; }
    if (code === KEY.GREEN) {
      event.preventDefault();
      favouriteCurrent(view === "panel" ? visible[index] : current ?? undefined);
      return;
    }
    // Up goes forwards, towards the higher channel number, which is what channel up has
    // meant on every television anyone has owned. It was the other way round.
    if (code === KEY.CH_UP) { event.preventDefault(); tuner.step(1); return; }
    if (code === KEY.CH_DOWN) { event.preventDefault(); tuner.step(-1); return; }

    /*
     * A playlist that produced nothing has its own screen, and exactly two keys mean
     * anything on it. Answered here rather than in the panel branch, because the panel is
     * behind it with no rows to move through, so every press would land on nothing.
     */
    if (!channels.length && !loading) {
      if (code === KEY.ENTER) { event.preventDefault(); setShowSettings(true); return; }
      if (code === KEY.BACK || code === KEY.ESC) { event.preventDefault(); setShowExit(true); return; }
    }

    // A channel number can be dialled from anywhere.
    if (code >= 48 && code <= 57) {
      event.preventDefault();
      chrome.dial(code - 48, jump);
      return;
    }
    /* OK goes to a dialled number now rather than waiting out the second and a bit, which is
       what a television does and what anyone who has just typed a number expects. */
    if (chrome.digits && code === KEY.ENTER) {
      event.preventDefault();
      jump(Number(chrome.commitDigits()));
      return;
    }

    if (view === "watch") {
      // Only the keys this screen actually owns are claimed. A remote carries plenty the
      // app has no business with, volume and mute and source among them, and a keyboard
      // carries a hundred more.
      const owned = code === KEY.UP || code === KEY.DOWN || code === KEY.LEFT
        || code === KEY.RIGHT || code === KEY.ENTER || code === KEY.BACK || code === KEY.ESC;
      if (owned) event.preventDefault();

      /*
       * Law 1, before anything else and with no exceptions: up and down change channel.
       *
       * Ahead of every other consideration on this screen, including a focused button and
       * including a channel that has failed. There is no state in this application where
       * pressing channel up leaves the viewer where they were, which is what makes it
       * impossible to be stuck: whatever is on screen, one press gets you somewhere else.
       */
      if (code === KEY.UP) { tuner.step(1); return; }
      if (code === KEY.DOWN) { tuner.step(-1); return; }

      switch (code) {
        /*
         * Law 3 at the picture. The channel list is off the left of the screen, so left goes to
         * it. Nothing is off the right, so right has nothing to travel to, and it puts away
         * whatever is on the screen instead.
         *
         * Which makes it the pair of the press that raised it: any key the app does not otherwise
         * own brings the banner up, and right takes it down again. RETURN still does too, and goes
         * on to offer to close the application once the screen is clear, so the two are not the
         * same key with the same job: right only ever means "I have read it, thank you".
         *
         * With nothing showing it falls through to the line below the switch and raises the
         * banner, so the two presses are a toggle rather than one working and the other not.
         */
        case KEY.RIGHT:
          if (chrome.showing) { chrome.clear(); return; }
          break;

        case KEY.LEFT: revealPanel(); return;

        // Law 2. At the picture, the only question worth a whole screen is what else is on,
        // and OK answers it in every state including a channel that has failed to start.
        case KEY.ENTER: revealPanel(); return;

        /*
         * Law 4. RETURN clears the screen if anything is on it, and closes the application if
         * nothing is.
         *
         * Two presses to leave rather than one, and that is the point. It means nothing on this
         * screen has to be waited out, and it means the button that closes the application is
         * never the first press of anything.
         */
        case KEY.BACK:
        case KEY.ESC:
          if (chrome.showing) chrome.clear();
          else setShowExit(true);
          return;
        // No default on purpose. An unrecognised key is not an instruction to go
        // somewhere, and the banner below is the whole of the right response: press
        // something a television does not recognise and it shows you what is on, it does
        // not open a menu.
      }
      chrome.raiseBanner();
      return;
    }

    // The channel panel.
    openPanel();   // any key here restarts its countdown

    /*
     * While the keyboard has the field, most keys are the field's.
     *
     * Left and right are a caret, not navigation, which is the whole reason this guard exists:
     * a viewer correcting the third letter of a channel name must not be thrown into the
     * category rail. Digits are text here too, so channel dialling stands aside, and the letter
     * keys were never ours. What is left to the application is up and down, which leave the
     * field, OK, which commits, and RETURN, which is the way out of everything.
     *
     * The same shape as the first run screen, which has the same problem with the same keyboard.
     */
    const typing = searching && pane === "list" && index === FIELD
      && document.activeElement instanceof HTMLInputElement;
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
      if (code === KEY.LEFT) {
        const el = document.activeElement as HTMLInputElement;
        if (el.selectionStart === 0 && el.selectionEnd === 0) {
          event.preventDefault();
          setPane("rail");
        }
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
        // Into the results, on the first one. Playing it outright would be a viewer pressing OK
        // on a keyboard and getting a channel they had not looked at yet.
        if (column.length) setIndex(0);
        return;
      }
      if (code !== KEY.UP && code !== KEY.DOWN) return;
    }

    /**
     * Play whatever the channel column has under the cursor.
     *
     * One function because two keys now do it. OK has always meant "the obvious thing here", and
     * right means it too at the last column, where the only thing further in is the programme.
     * Written once so the two cannot drift into disagreeing about what a search result is: a
     * result takes the rail to that channel's category, and a row of a category does not need to.
     */
    const chooseChannel = () => {
      if (searching) {
        if (column[index]) pickResult(column[index]);
        return;
      }
      const channel = visible[index];
      if (!channel) return;
      // Choosing the channel already playing only puts the panel away rather than tearing the
      // stream down and rebuilding it: see pickChannel.
      if (channel.id !== current?.id) tuner.start(channel);
      watch();
    };

    /*
     * Up and down cycle through the title bar and whichever column the cursor is in.
     *
     * The categories have always worked this way, because Search and Settings sit at row zero of
     * the rail with the categories below them, so walking up off the first category reaches them
     * and walking down comes back. The channel column had no such route: the only way to those two
     * keys from a channel was left into the rail, up to the top, and then back again, which is
     * three presses to reach something a viewer can see directly above where they are looking.
     *
     * So the bar is now the row above both columns rather than above one of them, and which column
     * the cursor left is remembered, because coming back to the categories from a channel list
     * would be the interface deciding the viewer meant something they did not press.
     *
     * The search field is left out of it. While searching, the thing above the results is the field
     * being typed into, and putting the title bar above that as well would make one press mean two
     * different things depending on how the column got there.
     */
    const inBar = pane === "rail" && cursor === 0;
    const atTop = index <= 0;
    const atBottom = index >= column.length - 1;
    const enterBar = (from: "rail" | "list") => {
      barFrom.current = from;
      setPane("rail");
      moveCursor(0);
    };

    switch (code) {
      case KEY.UP:
        event.preventDefault();
        if (pane === "list") {
          if (!searching && atTop) enterBar("list");
          else setIndex((i) => stepColumn(i, -1, column.length, searching));
        } else if (inBar && barFrom.current === "list") {
          // Back to the column it came from, at the bottom, which is what the rail does when it
          // wraps off the bar onto the last category.
          setPane("list");
          setIndex(Math.max(0, column.length - 1));
        } else {
          if (cursor === 1) barFrom.current = "rail";
          nudgeCursor(-1);
        }
        break;
      case KEY.DOWN:
        event.preventDefault();
        if (pane === "list") {
          if (!searching && atBottom) enterBar("list");
          else setIndex((i) => stepColumn(i, 1, column.length, searching));
        } else if (inBar && barFrom.current === "list") {
          setPane("list");                     // exactly where it was, which is the whole point
        } else {
          if (cursor === lists.length) barFrom.current = "rail";
          nudgeCursor(1);
        }
        break;
      case KEY.LEFT:
        event.preventDefault();
        // Out of the channel column into the rail, which is the gesture that opened it reversed.
        if (pane === "list") setPane("rail");
        // Within the title bar first, since left and right move inside whatever is showing
        // before they leave it.
        else if (cursor === 0 && headerKey === "settings") setHeaderKey("search");
        /*
         * And off the first key of the bar into the categories, rather than out of the panel.
         *
         * Leaving the application's own two keys by the left edge used to close the whole panel,
         * which is a lot to happen to somebody who was aiming for the category list a few pixels
         * below. The bar has no third key to its left, so the only thing left of it is the column
         * underneath, and that is where left goes.
         *
         * It costs the shortcut of closing the panel from up here, and RETURN is the key for that
         * everywhere else in the application anyway. What it buys is that neither horizontal key
         * can throw the viewer out of the panel by accident from a row they did not aim for.
         */
        else if (cursor === 0) nudgeCursor(1);
        else if (current) watch();
        break;
      case KEY.RIGHT:
        event.preventDefault();
        if (pane === "rail" && cursor === 0 && headerKey === "search") setHeaderKey("settings");
        /*
         * Off the last key of the title bar and into the categories, which is where right
         * belongs from there and is not where it went.
         *
         * It used to fall through to the line below and land in the channel column, so a walk
         * rightwards from Search went Search, Settings, channels: the categories, which sit
         * between them on screen, were reachable by pressing down and by nothing else. Now the
         * rightward path crosses everything in order, Search, Settings, categories, channels,
         * and each press moves to the next thing along rather than skipping one.
         *
         * The same landing as pressing down from the bar, deliberately, so two ways of leaving it
         * do not disagree about where the cursor ends up.
         */
        else if (pane === "rail" && cursor === 0) nudgeCursor(1);
        else if (pane === "rail") setPane("list");
        /*
         * And in the channel column, right plays the row it is on, exactly as OK does.
         *
         * It used to close the panel back to the picture, on the reasoning that right off the end
         * of the panel is the door being used in the same direction. Playing the channel goes
         * through that same door and takes the viewer somewhere they asked to be rather than back
         * to what was already on, so the old behaviour is a special case of the new one: choosing
         * a channel closes the panel too.
         *
         * It also means the last column obeys the same rule as everything to its left. Right has
         * moved one step further into the interface at every stop along the way, and at the end of
         * it the next step is the programme.
         */
        else chooseChannel();
        break;
      case KEY.ENTER:
        event.preventDefault();
        if (pane === "rail") {
          if (cursor === 0) {
            if (headerKey === "settings") setShowSettings(true);
            else openSearch();
          }
          // The Tab UI guidance: moving from the category area into the content list puts
          // the focus on the first item when the category has just changed, and back on the
          // item it left when it has not. moveCursor is what resets the index, so arriving
          // here without having moved keeps the row the viewer was on.
          else setPane("list");
        } else chooseChannel();
        break;
      case KEY.BACK:
      case KEY.ESC:
        event.preventDefault();
        /*
         * RETURN goes back by exactly one thing, which in a search is two things deep.
         *
         * A query clears first, because the viewer's last action was typing it and the press
         * that undoes their last action is the one they expect. With the field empty there is
         * nothing left of the search, so the next press leaves it for the category the rail is
         * on, and the one after that puts the panel away.
         *
         * Clearing from down in the results takes the cursor back to the field, because the
         * results it was standing in have just gone and the field is the only place left.
         */
        if (searching && query) { setQuery(""); setApplied(""); setIndex(FIELD); }
        else if (searching) closeSearch();
        // The panel is one thing, so RETURN puts the whole thing away rather than
        // stepping through its two columns. With nothing playing there is no picture to
        // go back to, so the only way out is out.
        else if (current) watch();
        else setShowExit(true);
        break;
    }
  // Only what the body actually reads. lists.length, moveCursor, banner and retune were all
  // in here and none of them appear above: useRemote takes the window listener off and puts
  // it back whenever this changes identity, so a dependency that is not a dependency is
  // listener churn on every keypress, on hardware that can least afford it.
  }, [configured, showSettings, showExit, channels.length, loading, onTransport, view,
      jump, pane, visible, index, tuner, favouriteCurrent, current, cursor,
      nudgeCursor, openPanel, revealPanel, watch, chrome,
      searching, query, column, headerKey, openSearch, closeSearch, pickResult]);

  useRemote(onKey);

  // Which layer is on top decides what everything below it is allowed to draw.
  const modal = showSettings || showExit || !configured;   // layer 4
  const panelOpen = view === "panel";                      // layer 3
  const covered = modal || view !== "watch";               // anything above the player
  const atPlayer = !covered;                               // layer 2 may show

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
    const t = window.setTimeout(() => setRestingClosed(true), cssMs("--t-panel"));
    return () => window.clearTimeout(t);
  }, [panelOpen]);

  const offScreen = !panelOpen && restingClosed;
  const told = useRef({ playingId: "", live: false });
  if (!offScreen) told.current = { playingId: current?.id ?? "", live: !fault && !paused && !busy };

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
  const pickChannel = useCallback((i: number) => {
    setPane("list");
    setIndex(i);
    const channel = lists[category]?.channels[i];
    if (channel && channel.id !== currentRef.current?.id) tuner.start(channel);
    watch();
  }, [lists, category, tuner.start, watch]);

  const pickCategory = useCallback((i: number) => {
    moveCursor(i + 1);
    setPane("list");
  }, [moveCursor]);

  const openSettings = useCallback(() => setShowSettings(true), []);


  const railItems = useMemo(
    () => lists.map((l) => ({ name: l.name, count: l.channels.length })),
    [lists],
  );

  /**
   * How wide the number column has to be, in figures.
   *
   * From the playlist's length rather than from the category on screen, because the numbers are
   * the playlist's: channel 12,732 keeps that number in a category of three. Sized here so the
   * names line up whatever the playlist, where a fixed 58px column held four figures and clipped
   * the fifth.
   */
  const numberDigits = useMemo(
    () => String(Math.max(1, channels.length)).length,
    [channels.length],
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
  const searchPick = useCallback((i: number) => {
    const { searching: inSearch, matches } = picking.current;
    if (!inSearch) { pickChannel(i); return; }
    if (matches[i]) pickResult(matches[i]);
  }, [pickChannel, pickResult]);

  /**
   * Where the playing channel sits in the list channel up and down walks.
   *
   * On the banner, so the scope of the next press is visible rather than something to be
   * discovered by pressing it. "4 of 23 in Satellite - News" also answers why channel up
   * came back round to the first channel instead of going to the next number.
   */
  const position = useMemo(() => {
    const shown = tuner.shown;
    if (!shown) return undefined;
    const at = visible.findIndex((c) => c.id === shown.id);
    if (at === -1) return undefined;
    return { at: at + 1, of: visible.length, list: lists[category]?.name ?? "" };
  }, [tuner.shown, visible, lists, category]);

  return (
    <div className="app">
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
      {configured && !channels.length && (
        <div className="splash">
          {/*
            * The mark above the name, because this is the first thing a viewer sees after choosing
            * the app and a launcher tile that turns into a word on a black screen does not look like
            * the same application starting. The same file the launcher itself draws, so the two
            * cannot drift: scripts/icon.mjs renders the bitmap from this vector.
            */}
          <img className="splash-mark" src="./icon.svg" alt="" aria-hidden="true" />
          <h1>SimpleIPTV</h1>
          <p>{loading ? "Loading the playlist\u2026" : "That playlist has no channels in it."}</p>
          {/* Under the line it belongs to rather than above the name, so the eye reads the mark, then
              what is happening, and the moving thing is last: a spinner at the top of a column drags
              attention off the words it is supposed to be explaining. */}
          {loading && <div className="spinner" />}
          {!loading && (
            <KeyGuide
              className="splash-keys"
              items={[
                { keys: ["OK"], label: "Choose another playlist" },
                { keys: ["Return"], label: "Close the app" },
              ]}
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
          busy={busy}
          paused={paused}
          filling={tuner.filling}
          waited={tuner.waited}
          fault={fault}
          retryIn={tuner.retryIn}
          attempt={tuner.attempt}
          attempts={RETRY_DELAYS_MS.length}
        />
      )}

      {/* ---- layer 2, the playback banner and its key guide ----------------------- */}
      {/*
        * Held open while a channel is tuning and while it is paused, so the name is on screen
        * for as long as there is any question about what is happening.
        *
        * It shows the channel the viewer has landed on rather than the one playing, which
        * during a burst of channel up are not the same thing: the name has to keep up with the
        * key while the tuner deliberately does not.
        */}
      {(tuner.shown) && atPlayer && (chrome.banner || paused) && !fault && (
        <PlaybackBanner channel={(tuner.shown)!} position={position} />
      )}

      {/* ---- layer 3, the panel ---------------------------------------------------- */}
      <div className={`panel ${panelOpen ? "" : "away"}`}>
        {/* The application's own line, above both columns, so a control that belongs to the
            application does not look like part of either list. */}
        <PanelHeader
          active={pane === "rail" && cursor === 0}
          on={headerKey}
          searching={searching}
          onSearch={openSearch}
          onSettings={openSettings}
        />
        <div className="panel-cols">
        <Sidebar
          categories={railItems}
          /* Nothing is showing while a search is, and the rail has to say so. Left pointing at
             the category the column used to hold, the marker claims the results beside it came
             from there, which is the one thing that mark means. The Search key carries the state
             instead, which is where it belongs. */
          selected={searching ? -1 : category}
          cursor={cursor}
          loading={loading}
          focused={pane === "rail"}
          scale={settings.scale()}
          onSelect={pickCategory}
        />
        <ChannelList
          channels={column}
          category={lists[category]?.name ?? ""}
          index={index}
          loading={loading}
          focused={pane === "list"}
          playingId={told.current.playingId}
          live={told.current.live}
          favourites={favouriteIds}
          showNumbers={settings.showNumbers}
          showLogos={settings.showLogos}
          scale={settings.scale()}
          numberDigits={numberDigits}
          search={searching
            ? {
                query,
                total: results.total,
                /* The field holds the keyboard only while this column holds the remote. Stepping
                   into the rail has to put the keyboard away, or it stays up over a list the
                   viewer has left, covering the categories they went to read. */
                onField: pane === "list" && index === FIELD,
                onQuery: setQuery,
              }
            : undefined}
          onSelect={searchPick}
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
          items={searching
            ? [
                { keys: ["\u2191", "\u2193"], label: "Move" },
                { keys: ["OK"], label: index === FIELD ? "Show matches" : "Watch" },
                { keys: ["Return"], label: query ? "Clear" : "Back to the channels" },
              ]
            : [
                { keys: ["\u2191", "\u2193"], label: "Move" },
                { keys: ["OK"], label: "Watch" },
                { keys: ["0-9"], label: "Channel number" },
                { keys: ["Return"], label: current ? "Back to the picture" : "Close the app" },
              ]}
        />
      </div>
      {settings.showClock && panelOpen && !modal && <Clock />}

      {/* ---- layer 4, the modals --------------------------------------------------- */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showExit && <ExitDialog watching={!!current && !fault} onCancel={() => setShowExit(false)} />}
      {/* No confirmation on the way out of first run, unlike everywhere else. There is
          nothing in progress to interrupt and nothing to lose, and the footer says what
          RETURN will do before it is pressed. */}
      {!configured && (
        <Onboarding
          onAdd={(name, url) => { settings.addPlaylist(name, url); void load(true); }}
          onExit={exitApp}
        />
      )}

      {/* ---- above the stack ------------------------------------------------------- */}
      {/* A dialled channel number and a transient message answer to nothing below them. */}
      {chrome.digits && <div className="digits">{chrome.digits}</div>}
      {chrome.toast && <div className="toast">{chrome.toast}</div>}
      {error && !fault && <div className="toast warn">{error}</div>}

      {/* The whole remote's directional pad in one place, so the app can be driven without
          one. It sends the same keys, so it needs to know nothing about what they do. */}
      {configured && <PointerPad shown={pointerAwake} />}

      {/* import.meta.env.DEV first, so a production build sees `false && ...` here and the
          bundler removes both the branch and the component it refers to. */}
      {import.meta.env.DEV && remoteVisible() && <SmartRemote />}
    </div>
  );
}
