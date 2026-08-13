import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannels } from "./stores/channels";
import { useSettings } from "./stores/settings";
import { onTizen } from "./services/player";
import { warmChain } from "./services/logos";
import { FAVOURITES, listsOf, wrap } from "./services/lineup";
import { KEY, registerRemoteKeys, useRemote } from "./hooks/useRemote";
import { ChannelList } from "./components/ChannelList";
import { Sidebar } from "./components/Sidebar";
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
 * banner appears with the name and holds while the channel tunes, and five seconds after
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
 *   3. Left and right move within whatever is showing. At the picture with nothing showing,
 *      left goes to the channel list, because that is what is off the left of the screen, and
 *      right goes to the buttons.
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
 * What that costs is that the buttons cannot be reached with down, so they are reached with
 * right instead. What it buys is that there is nothing to learn.
 */


export default function App() {
  const { channels, categories, favourites, load, loading, error, toggleFavourite,
          rememberLast, lastPlayed } = useChannels();
  const settings = useSettings();
  const configured = settings.playlists.length > 0;

  const [view, setView] = useState<View>("panel");
  /* Zero, the top of the rail, which is the playlist's first category until there is a
     favourite and Favourites once there is. Both are worth opening on, and neither can be
     empty: the row only exists while it has something in it. */
  const [category, setCategory] = useState(0);
  const [cursor, setCursor] = useState(1);   // rail row, zero is Settings
  const [index, setIndex] = useState(0);
  const [pane, setPane] = useState<"rail" | "list">("list");
  const [showSettings, setShowSettings] = useState(false);
  const [showExit, setShowExit] = useState(false);

  const chrome = useChrome();
  const pointerAwake = usePointerAwake();
  const hideTimer = useRef<number | undefined>(undefined);

  const lists = useMemo(
    () => listsOf(channels, categories, favourites),
    [channels, categories, favourites],
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const tuner = useTuner({
    list: visible,
    fit: settings.aspectId,
    video: videoRef,
    rememberLast,
    onNamed: chrome.holdBanner,
    onPicture: chrome.raiseBanner,
    onFault: chrome.lowerBanner,
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
    return warmChain(
      [lists[category + 1], lists[category - 1]]
        .filter(Boolean)
        .flatMap((l) => l!.channels.slice(0, 14))
        .map((c) => c.logo)
        .filter((src): src is string => !!src),
      // A pause first: the category has only just changed and its own rows come before this.
      { delay: 1200, timeout: 2000 },
    );
  }, [lists, category, settings.showLogos]);

  useEffect(() => {
    registerRemoteKeys();
    load();
  }, [load]);

  /*
   * Every timer this component owns, called off when it goes.
   *
   * zapTimer is the one that matters. It fires tuner.start(), which reaches for the player, and
   * the effect that owns the player has already stopped and detached it by then, so a tune
   * that was still settling ran against a discarded engine. StrictMode mounts everything
   * twice in development, which makes it reachable on any page load rather than only on an
   * unmount nobody performs.
   */
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

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
   * Its five seconds are counted from the press, and joining a stream can take four times
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

  /** The rail cursor as it is now, for presses that arrive faster than renders. */
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;


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
        setCategory(cat);
        setCursor(cat + 1);
        cursorRef.current = cat + 1;
        setIndex(lists[cat].channels.indexOf(playing));
      }
    }
    setPane("list");
    openPanel();
  }, [locate, lists, openPanel]);

  // Resume whatever was on last time, once the playlist has arrived.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !channels.length) return;
    resumed.current = true;
    if (!settings.resumeLast) return;
    const found = channels.find((c) => c.id === lastPlayed());
    if (found) {
      tuner.start(found);
      revealPanel();
    }
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Put the rail cursor somewhere, and show that category at once.
   *
   * Showing it immediately is the first of the two Tab UI behaviours Samsung describes, and
   * row zero is the Settings key, which is not a category and so changes nothing.
   */
  const moveCursor = useCallback((to: number) => {
    cursorRef.current = to;
    setCursor(to);
    if (to > 0) {
      setCategory(to - 1);
      setIndex(0);
    }
  }, []);

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
      setCategory(cat);
      setCursor(cat + 1);
      cursorRef.current = cat + 1;
      setIndex(lists[cat].channels.indexOf(found));
    }
    tuner.start(found);
  }, [channels, lists, locate, tuner.start, chrome.say]);

  /**
   * Favourite or unfavourite a channel, and stay where the viewer was.
   *
   * Favourites is only in the rail while there is something in it, so the first one added
   * puts a row above every category and the last one removed takes it away again. The
   * viewer asked to favourite a channel, not to be moved: what is kept is the category they
   * are reading, not the number it happened to have. This is the only thing that can insert
   * or remove that row, which is why the correction lives here rather than in an effect
   * watching the lists for a change it cannot attribute to anything.
   */
  const favouriteCurrent = useCallback((channel: Channel | undefined) => {
    if (!channel) return;
    const had = favourites.includes(channel.id);
    const appears = !had && !favourites.length;
    const vanishes = had && favourites.length === 1;

    if (appears || vanishes) {
      const to = Math.max(0, category + (appears ? 1 : -1));
      setCategory(to);
      setCursor(to + 1);
      cursorRef.current = to + 1;
      // Standing in Favourites as the last one goes: the row that takes its place is a
      // different list, and the row the highlight was on is not in it.
      if (vanishes && category === 0) setIndex(0);
    }

    toggleFavourite(channel.id);
    chrome.say(had ? "Removed from favourites" : "Added to favourites");
  }, [favourites, toggleFavourite, chrome.say, category]);

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
         * it. Nothing is off the right, so Right is not claimed: it falls through to the banner
         * like any other key, which is a press showing you what you are watching rather than a
         * press that does nothing.
         */
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
    switch (code) {
      case KEY.UP:
        event.preventDefault();
        if (pane === "list") setIndex((i) => wrap(i - 1, visible.length));
        else nudgeCursor(-1);
        break;
      case KEY.DOWN:
        event.preventDefault();
        if (pane === "list") setIndex((i) => wrap(i + 1, visible.length));
        else nudgeCursor(1);
        break;
      case KEY.LEFT:
        event.preventDefault();
        // Off the left edge of the rail is out of the panel altogether, which is the
        // gesture that opened it, reversed.
        if (pane === "list") setPane("rail");
        else if (current) watch();
        break;
      case KEY.RIGHT:
        event.preventDefault();
        /*
         * Right off the end of the panel closes it, which is the same door being used in the
         * same direction. The information panel already works that way: right opens it, left
         * shuts it. Having the channel panel open on left but refuse to close on right made
         * the two edges of the screen behave by different rules.
         */
        if (pane === "rail") setPane("list");
        else if (current) watch();
        break;
      case KEY.ENTER:
        event.preventDefault();
        if (pane === "rail") {
          if (cursor === 0) setShowSettings(true);
          // The Tab UI guidance: moving from the category area into the content list puts
          // the focus on the first item when the category has just changed, and back on the
          // item it left when it has not. moveCursor is what resets the index, so arriving
          // here without having moved keeps the row the viewer was on.
          else setPane("list");
        } else if (visible[index]) {
          // Choosing a channel means watching it, so the panel gets out of the way at once and
          // the banner carries the name until the picture arrives. Choosing the channel already
          // playing only puts the panel away: see pickChannel.
          if (visible[index].id !== current?.id) tuner.start(visible[index]);
          watch();
        }
        break;
      case KEY.BACK:
      case KEY.ESC:
        event.preventDefault();
        // The panel is one thing, so RETURN puts the whole thing away rather than
        // stepping through its two columns. With nothing playing there is no picture to
        // go back to, so the only way out is out.
        if (current) watch();
        else setShowExit(true);
        break;
    }
  // Only what the body actually reads. lists.length, moveCursor, banner and retune were all
  // in here and none of them appear above: useRemote takes the window listener off and puts
  // it back whenever this changes identity, so a dependency that is not a dependency is
  // listener churn on every keypress, on hardware that can least afford it.
  }, [configured, showSettings, showExit, channels.length, loading, onTransport, view,
      jump, pane, visible, index, tuner, favouriteCurrent, current, cursor,
      nudgeCursor, openPanel, revealPanel, watch, chrome]);

  useRemote(onKey);

  // Which layer is on top decides what everything below it is allowed to draw.
  const modal = showSettings || showExit || !configured;   // layer 4
  const panelOpen = view === "panel";                      // layer 3
  const covered = modal || view !== "watch";               // anything above the player
  const atPlayer = !covered;                               // layer 2 may show

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
          {loading && <div className="spinner" />}
          <h1>SimpleIPTV</h1>
          <p>{loading ? "Loading the playlist\u2026" : "That playlist has no channels in it."}</p>
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
        <div className="panel-cols">
        <Sidebar
          categories={railItems}
          selected={category}
          cursor={cursor}
          loading={loading}
          focused={pane === "rail"}
          scale={settings.scale()}
          onSettings={openSettings}
          onSelect={pickCategory}
        />
        <ChannelList
          channels={visible}
          category={lists[category]?.name ?? ""}
          index={index}
          loading={loading}
          focused={pane === "list"}
          playingId={current?.id ?? ""}
          live={!fault && !paused && !busy}
          favourites={favourites}
          showNumbers={settings.showNumbers}
          showLogos={settings.showLogos}
          scale={settings.scale()}
          onSelect={pickChannel}
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
        <KeyGuide
          className="panel-hints ruled"
          items={[
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
