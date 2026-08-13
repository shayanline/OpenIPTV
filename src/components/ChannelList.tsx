import { memo, useEffect, useRef, useState } from "react";
import type { Channel } from "../types";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { dropQueuedWarming, LOGO_BOX, warmChain } from "../services/logos";
import { ScrollIndicator } from "./ScrollIndicator";
import { useWindowed } from "../hooks/useWindowed";
import { useViewport } from "../hooks/useViewport";

interface Props {
  channels: Channel[];
  /** The category these channels came from, so this column can say where the viewer is. */
  category: string;
  index: number;
  focused: boolean;
  playingId: string;
  /** Whether the playing channel is actually running, so the marker can say so honestly. */
  live: boolean;
  favourites: string[];
  loading: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  scale: number;
  /** Must be stable, or every row rebuilds on every press. */
  onSelect: (index: number) => void;
}

/**
 * One channel.
 *
 * Memoised, and given only the values it actually draws rather than the whole list state.
 * Without this every press of the down key re-rendered every row in the playlist to change
 * two of them, and each of those renders touched an <img>.
 *
 * The index and a stable handler, rather than a ready-made closure. Building the closure
 * in the parent hands every row a new prop on every render, which defeats the memo
 * completely: the whole window rebuilt on each press while appearing to be optimised.
 */
const Row = memo(function Row({
  channel, index, selected, playing, live, favourite, showNumbers, showLogos, settled, top,
  height, onPick,
}: {
  channel: Channel;
  index: number;
  selected: boolean;
  playing: boolean;
  /** Whether that channel is actually running, as opposed to paused or frozen. */
  live: boolean;
  favourite: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  settled: boolean;
  top: number;
  height: number;
  onPick: (index: number) => void;
}) {
  return (
    <button
      type="button"
      className={`row ${selected ? "selected" : ""}`}
      style={{ top, height }}
      onClick={() => onPick(index)}
    >
      {showNumbers && <span className="ch-number">{channel.number}</span>}
      {showLogos && (
        // Where there is no number column, a channel with no artwork shows its number. Where
        // there is one, it shows a quiet television instead: with both, the row read "1 1
        // Channel Alpha".
        <Logo src={channel.logo} alt={channel.name} fetchable={settled}
              label={showNumbers ? undefined : String(channel.number)}
              width={LOGO_BOX.width} height={LOGO_BOX.height} />
      )}
      <Text value={channel.name} className="row-label" />
      {favourite && <span className="ch-star"><Icon name="star" /></span>}
      {channel.quality && <span className="ch-badge">{channel.quality}</span>}
      {/* The dot marks the channel you are on. It only pulses when that channel is actually
          running, because a pulse means live, and saying "live" over a frozen or paused
          picture is the marker lying about the one thing it is for. */}
      {playing && (
        <span className={`playing-dot ${live ? "live" : ""}`}
              title={live ? "Playing now" : "The channel you are on"} />
      )}
    </button>
  );
});

/**
 * Memoised as a whole, so the list is only rebuilt when something it draws has moved. The
 * app re-renders for plenty it has no interest in: the clock ticking, a toast arriving, the
 * notice card coming and going.
 */
export const ChannelList = memo(function ChannelList({
  channels, category, index, focused, playingId, live, favourites, loading,
  showNumbers, showLogos, scale, onSelect,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  const win = useWindowed(channels.length, index, height, scale);

  /**
   * Whether the list has stopped moving.
   *
   * Holding the key down on the category rail replaces the whole channel list thirty times a
   * second, and asking for fifteen pieces of artwork each time is work for categories nobody
   * is going to look at. So while it is still changing the rows show their initials, and the
   * logos are only asked for once it settles. Anything already in the cache still draws
   * immediately, so coming back to a category you have seen is instant either way.
   */
  const [settled, setSettled] = useState(true);
  useEffect(() => {
    setSettled(false);
    const t = window.setTimeout(() => setSettled(true), 180);
    return () => window.clearTimeout(t);
  }, [channels]);

  /**
   * Shrink the logos just beyond the view before they are needed.
   *
   * Reducing one costs a full size decode, and that is not work to do on the frame that
   * scrolls its row into view. Doing it a screen ahead means the row finds its bitmap
   * already waiting.
   *
   * Which addresses are already had, already going, or already known to be hopeless is the
   * logo cache's business and it is asked rather than tracked here. A set kept in this
   * component looked like the same thing and was not: it survived releaseLogos(), so after
   * the app had been off screen once every address was still marked as done and nothing was
   * ever prepared again.
   */
  useEffect(() => {
    if (!showLogos || !settled) return;
    const margin = win.slots;
    // Whatever was queued for the rows we have just left is no longer worth waiting for.
    dropQueuedWarming();
    return warmChain(
      [
        ...channels.slice(win.end, win.end + margin),
        ...channels.slice(Math.max(0, win.start - margin), win.start),
      ]
        .map((c) => c.logo)
        .filter((src): src is string => !!src),
    );
  }, [channels, win.start, win.end, win.slots, showLogos, settled]);

  // Only the rows in view are built. Everything outside is not in the DOM at all, so its
  // logo is not decoded and its memory is not held.
  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    const c = channels[i];
    rows.push(
      <Row
        // Keyed by slot, not by channel, so the row elements are recycled as the list
        // moves instead of being destroyed and rebuilt. Scrolling by one row then changes
        // one slot's contents rather than creating a new element and a new image.
        key={i % win.slots}
        channel={c}
        index={i}
        selected={i === index}
        playing={c.id === playingId}
        live={live}
        favourite={favourites.includes(c.id)}
        showNumbers={showNumbers}
        showLogos={showLogos}
        settled={settled}
        top={i * win.row}
        height={win.row}
        onPick={onSelect}
      />,
    );
  }

  return (
    <div className={`list pane ${focused ? "focused" : ""}`}>
      {/* Same header height as the rail, so the two lists start on the same line.
          It names the category rather than saying "Channels", which said nothing the column
          full of channels was not already saying: "users should always know exactly where
          they are within an application". */}
      {/* The name only. The count was here too, and the rail row it came from is on screen at
          the same time carrying the same number for the same category. */}
      <div className="pane-head">
        <Text value={category || "Channels"} className="panel-title" />
      </div>
      <div className="viewport" ref={viewport}>
        {loading && !channels.length
          ? Array.from({ length: 8 }, (_, i) => (
              /* Eight identical placeholders with no identity of their own and no order to
                 preserve, so the index is the only key they have and reordering them would
                 mean nothing. */
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <div className="row" key={i}>
                <span className="sk sk-logo" />
                <span className="sk sk-title" />
              </div>
            ))
          : <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>{rows}</div>}
        {/* No case for an empty Favourites: the row is only in the rail while it has
            something in it, so there is no way to be standing in an empty one. */}
        {!loading && !channels.length && <p className="empty">Nothing in this category.</p>}
      </div>
      <ScrollIndicator count={channels.length} first={win.first} visible={win.visible} />
    </div>
  );
});
