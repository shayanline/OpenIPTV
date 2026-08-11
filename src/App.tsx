import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannels } from "./stores/channels";
import { useSettings } from "./stores/settings";
import { Player, onTizen, type PlayerEvent } from "./services/player";
import { KEY, registerRemoteKeys, useRemote } from "./hooks/useRemote";
import { ChannelList } from "./components/ChannelList";
import { Sidebar } from "./components/Sidebar";
import { Settings } from "./components/Settings";
import { NowPlaying } from "./components/NowPlaying";
import { Clock } from "./components/Clock";
import type { Channel } from "./types";

const FAVOURITES = "\u2605 Favourites";

export default function App() {
  const { channels, categories, favourites, load, loading, error, toggleFavourite,
          rememberLast, lastPlayed } = useChannels();
  const settings = useSettings();

  const [category, setCategory] = useState(0);
  const [index, setIndex] = useState(0);
  const [pane, setPane] = useState<"categories" | "channels">("channels");
  const [current, setCurrent] = useState<Channel | null>(null);
  const [status, setStatus] = useState("");
  const [chrome, setChrome] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [digits, setDigits] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Player | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const digitTimer = useRef<number | undefined>(undefined);

  const lists = useMemo(() => {
    const favs = channels.filter((c) => favourites.includes(c.id));
    return favs.length ? [{ name: FAVOURITES, channels: favs }, ...categories] : categories;
  }, [channels, categories, favourites]);

  const visible = lists[category]?.channels ?? [];

  useEffect(() => {
    registerRemoteKeys();
    load();
  }, [load]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--font", settings.font().stack);
    root.style.setProperty("--scale", String(settings.scale()));
  }, [settings]);

  useEffect(() => {
    const onEvent = (e: PlayerEvent) => {
      if (e.type === "buffering") setStatus("Loading\u2026");
      else if (e.type === "playing") setStatus("");
      else if (e.type === "ended") setStatus("Stream ended");
      else setStatus(e.message);
    };
    playerRef.current = new Player(onEvent);
    return () => playerRef.current?.stop();
  }, []);

  useEffect(() => {
    if (videoRef.current) playerRef.current?.attach(videoRef.current);
  }, []);

  // Resume whatever was on last time, once the playlist has arrived.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !channels.length) return;
    resumed.current = true;
    if (!settings.resumeLast) return;
    const id = lastPlayed();
    const found = channels.find((c) => c.id === id);
    if (found) start(found);
  }, [channels]); // eslint-disable-line react-hooks/exhaustive-deps

  const showChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    if (settings.panelTimeout > 0) {
      hideTimer.current = window.setTimeout(() => setChrome(false), settings.panelTimeout * 1000);
    }
  }, [settings.panelTimeout]);

  const start = useCallback((channel: Channel) => {
    setCurrent(channel);
    rememberLast(channel.id);
    playerRef.current?.play(channel.url);
    showChrome();
  }, [rememberLast, showChrome]);

  const step = useCallback((delta: number) => {
    if (!visible.length) return;
    const at = current ? visible.findIndex((c) => c.id === current.id) : -1;
    const next = visible[(((at === -1 ? 0 : at) + delta) % visible.length + visible.length) % visible.length];
    setIndex(visible.indexOf(next));
    start(next);
  }, [visible, current, start]);

  // Moving between categories starts at the top of the new one. Jumping to a channel
  // number does not, so the two cannot share an effect on `category`: the effect would
  // fire after the jump and drop the selection back to row zero.
  const selectCategory = useCallback((i: number) => {
    setCategory(i);
    setIndex(0);
  }, []);

  const jump = useCallback((n: number) => {
    const found = channels.find((c) => c.number === n);
    if (!found) return;
    const cat = lists.findIndex((l) => l.channels.some((c) => c.id === found.id));
    if (cat >= 0) {
      setCategory(cat);
      setIndex(lists[cat].channels.indexOf(found));
    }
    start(found);
  }, [channels, lists, start]);

  const onKey = useCallback((code: number, event: KeyboardEvent) => {
    if (showSettings) return;   // the settings screen owns the remote while it is open

    // With the panel hidden the arrows are not navigating a list, so up and down become
    // channel change, which is what every TV does and so needs no instruction.
    if (!chrome && current) {
      if (code === KEY.UP) { event.preventDefault(); step(-1); return; }
      if (code === KEY.DOWN) { event.preventDefault(); step(1); return; }
      if (code === KEY.BACK || code === KEY.ESC) { event.preventDefault(); showChrome(); return; }
      if (code < 48 || code > 57) { showChrome(); return; }
    }
    showChrome();

    if (code >= 48 && code <= 57) {
      const next = (digits + String(code - 48)).slice(-4);
      setDigits(next);
      window.clearTimeout(digitTimer.current);
      digitTimer.current = window.setTimeout(() => {
        jump(Number(next));
        setDigits("");
      }, 1200);
      return;
    }

    switch (code) {
      case KEY.UP:
        event.preventDefault();
        if (pane === "channels") setIndex((i) => Math.max(0, i - 1));
        else selectCategory(Math.max(0, category - 1));
        break;
      case KEY.DOWN:
        event.preventDefault();
        if (pane === "channels") setIndex((i) => Math.min(visible.length - 1, i + 1));
        else selectCategory(Math.min(lists.length - 1, category + 1));
        break;
      case KEY.LEFT:
        event.preventDefault();
        setPane("categories");
        break;
      case KEY.RIGHT:
        event.preventDefault();
        setPane("channels");
        break;
      case KEY.ENTER:
        if (pane === "channels" && visible[index]) start(visible[index]);
        else {
          setPane("channels");
          setIndex(0);
        }
        break;
      case KEY.CH_UP:
        step(-1);
        break;
      case KEY.CH_DOWN:
        step(1);
        break;
      case KEY.GREEN:
        if (visible[index]) toggleFavourite(visible[index].id);
        break;
      case KEY.YELLOW:
        setShowSettings(true);
        break;
      case KEY.BACK:
      case KEY.ESC:
        event.preventDefault();
        // Back hides the panel so the picture is unobstructed. Pressing it again with
        // nothing playing would leave a blank screen, so that case keeps the panel.
        if (current) {
          window.clearTimeout(hideTimer.current);
          setChrome(false);
        }
        break;
    }
  }, [showSettings, showChrome, digits, jump, pane, visible, index, lists.length, start,
      step, toggleFavourite, chrome, current, category, selectCategory]);

  useRemote(onKey);

  return (
    <div className="app">
      {/* AVPlay renders behind the page, so the element stays empty on a TV. */}
      <video ref={videoRef} className="video" playsInline muted={false} />
      {onTizen() && <div className="avplay-surface" />}

      {!current && !loading && (
        <div className="splash">
          <h1>SimpleIPTV</h1>
          <p>{channels.length ? "Pick a channel to start" : "Loading the playlist\u2026"}</p>
        </div>
      )}

      {current && <NowPlaying channel={current} status={status} />}
      {!current && status && <div className="status">{status}</div>}
      {digits && <div className="digits">{digits}</div>}
      {settings.showClock && chrome && <Clock />}

      <div className={`chrome ${chrome ? "" : "hidden"}`}>
        <Sidebar
          categories={lists.map((l) => ({ name: l.name, count: l.channels.length }))}
          selected={category}
          focused={pane === "categories"}
          onSelect={(i) => {
            selectCategory(i);
            setPane("channels");
          }}
        />
        <ChannelList
          channels={visible}
          index={index}
          loading={loading}
          focused={pane === "channels"}
          playingId={current?.id ?? ""}
          favourites={favourites}
          showNumbers={settings.showNumbers}
          showLogos={settings.showLogos}
          language={settings.language}
          onSelect={(c, i) => {
            setIndex(i);
            start(c);
          }}
        />
      </div>

      {error && <div className="error">{error}</div>}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {chrome && (
        <div className="hints">
          <span><b>OK</b> play</span>
          <span><b>&larr; &rarr;</b> panes</span>
          <span><b>Ch+/-</b> next</span>
          <span><b>Green</b> favourite</span>
          <span><b>Yellow</b> settings</span>
          <span><b>Back</b> hide</span>
        </div>
      )}
    </div>
  );
}
