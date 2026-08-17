import { memo, useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import type { Channel } from "../types";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { dropQueuedWarming, LOGO_BOX, warmChain } from "../services/logos";
import { ScrollIndicator } from "./ScrollIndicator";
import { SearchField } from "./SearchField";
import { useWindowed } from "../hooks/useWindowed";
import { useViewport } from "../hooks/useViewport";

interface Props {
  channels: Channel[];
  /** The category these channels came from, so this column can say where the viewer is. */
  category: string;
  index: number;
  focused: boolean;
  /**
   * The search, when the column is showing results rather than a category.
   *
   * Absent the column is a category, present it is an answer to a query, and the difference is
   * confined to what the header draws and what the empty case says. The rows are the same rows:
   * a result is a channel, and it keeps its number, its artwork, its favourite star and its
   * playing marker, which is the whole reason the results live in this column rather than on a
   * screen of their own.
   */
  search?: {
    query: string;
    /** How many matched altogether, so the header can own up to a capped list. */
    total: number;
    /** Whether the cursor is on the field, which is the row above the first result. */
    onField: boolean;
    onQuery: (query: string) => void;
  };
  playingId: string;
  /** Whether the playing channel is actually running, so the marker can say so honestly. */
  live: boolean;
  /**
   * A set, not an array. Every row asks whether it is a favourite on every render, and
   * `includes` made that a scan of the whole list per row per press.
   */
  favourites: ReadonlySet<string>;
  loading: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  scale: number;
  /**
   * How many figures the widest channel number in the playlist has.
   *
   * The number column is sized from this rather than from a constant, so the names still line up
   * whether the playlist has nine channels or twelve thousand. A fixed width was 58 pixels, which
   * holds four figures at the default text size and clips the fifth, and the playlist this app is
   * measured against has 12,732 channels in it.
   */
  numberDigits: number;
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
  channel,
  index,
  selected,
  playing,
  live,
  favourite,
  showNumbers,
  showLogos,
  settled,
  top,
  height,
  onPick,
}: {
  channel: Channel;
  index: number;
  selected: boolean;
  playing: boolean;
  /**
   * Whether this row's channel is actually running, as opposed to paused or frozen.
   *
   * This row's, not the app's. Passed as the app's, every row took a new prop each time
   * playback stalled or resumed, so twenty rows re-rendered to change the one dot that
   * draws it. Only the playing row can show the marker, so only the playing row is told.
   */
  live: boolean;
  favourite: boolean;
  showNumbers: boolean;
  showLogos: boolean;
  settled: boolean;
  top: number;
  height: number;
  onPick: (index: number) => void;
}) {
  const { t, number } = useLocale();
  const displayName = channel.name || t("channel.unnamed");
  return (
    <button
      type="button"
      className={`row ${selected ? "selected" : ""}`}
      style={{ top, height }}
      onClick={() => onPick(index)}
    >
      {showNumbers && <span className="ch-number">{number(channel.number)}</span>}
      {showLogos && (
        // Where there is no number column, a channel with no artwork shows its number. Where
        // there is one, it shows a quiet television instead: with both, the row read "1 1
        // Channel Alpha".
        <Logo
          src={channel.logo}
          alt={displayName}
          fetchable={settled}
          label={showNumbers ? undefined : number(channel.number)}
          width={LOGO_BOX.width}
          height={LOGO_BOX.height}
        />
      )}
      <Text value={displayName} className="row-label" />
      {favourite && (
        <span className="ch-star">
          <Icon name="star" />
        </span>
      )}
      {channel.quality && <span className="ch-badge">{channel.quality}</span>}
      {/* The dot marks the channel you are on. It only pulses when that channel is actually
          running, because a pulse means live, and saying "live" over a frozen or paused
          picture is the marker lying about the one thing it is for. */}
      {playing && (
        <span
          className={`playing-dot ${live ? "live" : ""}`}
          title={live ? t("channel.playingNow") : t("channel.youAreOn")}
        />
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
  channels,
  category,
  index,
  focused,
  playingId,
  live,
  favourites,
  loading,
  showNumbers,
  showLogos,
  scale,
  search,
  numberDigits,
  onSelect,
}: Props) {
  const { t, number } = useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  /*
   * Clamped, because the search field is index -1 and is not a row.
   *
   * The window decides where the list sits from where the cursor is, so a cursor of -1 asked it to
   * scroll one row above the first one: it obliged, carried `first: -1` in the ref that remembers
   * where the list was left, and drew every result a row further down than it belongs. It then
   * stayed that way until the cursor walked far enough down the results to force a recalculation.
   *
   * The rail has always done this for the same reason, since its own position zero is the title
   * bar rather than a category.
   */
  const win = useWindowed(channels.length, Math.max(0, index), height, scale);

  /**
   * Whether the list has stopped moving.
   *
   * This used to be the only thing standing between the rail and fifteen decodes per press:
   * holding the key down replaced the whole channel list thirty times a second, and each
   * replacement asked for a screenful of artwork nobody would look at. It is no longer the
   * front line, because the rail now waits before handing over a new category at all, so
   * this can only ever see one change per walk instead of eighteen.
   *
   * It stays as the backstop, for the changes the rail knows nothing about: a playlist
   * arriving, a refresh replacing it, favourites gaining or losing a member. Shorter than
   * it was, since the two delays are now paid one after the other and the second no longer
   * has eighteen rebuilds to absorb.
   */
  const [settled, setSettled] = useState(true);
  useEffect(() => {
    setSettled(false);
    const t = window.setTimeout(() => setSettled(true), 120);
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

  /*
   * Only the rows in view are built. Everything outside is not in the DOM at all, so its
   * logo is not decoded and its memory is not held.
   *
   * They are built whether or not the panel is on screen, which was tried the other way and
   * measured worse. Dropping the rows once the panel had finished sliding away took the
   * document from 187 nodes to 68 while watching, and cost a rebuild of the whole window on
   * every open: the p95 of opening the panel, walking it and choosing went from 145ms to
   * between 187 and 203ms across three runs, and the stalls from 29 to 35. Opening the
   * panel is the commonest thing anybody does with it, and holding a hundred and nineteen
   * nodes is not worth making it slower. What is left of the idea is the freeze in App,
   * which stops the closed panel being told about channel changes it cannot show.
   */
  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    const c = channels[i];
    const playing = c.id === playingId;
    rows.push(
      <Row
        // Keyed by slot, not by channel, so the row elements are recycled as the list
        // moves instead of being destroyed and rebuilt. Scrolling by one row then changes
        // one slot's contents rather than creating a new element and a new image.
        key={i % win.slots}
        channel={c}
        index={i}
        selected={i === index}
        playing={playing}
        live={playing && live}
        favourite={favourites.has(c.id)}
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
    <div
      className={`list pane ${focused ? "focused" : ""}`}
      /* The number column's width, published to the stylesheet as a count of figures, so the
         arithmetic that decides how wide the digits are and the rule that draws them cannot
         disagree. Same reasoning as services/metrics and the row height. */
      style={{ "--ch-digits": numberDigits } as React.CSSProperties}
    >
      {/*
       * Same header height as the rail, so the two lists start on the same line, and the same
       * shape: what the column is, and how many are in it.
       *
       * The name rather than "Channels", which said nothing a column full of channels was not
       * already saying: "users should always know exactly where they are within an
       * application". The count is back, and it is no longer a repetition of the rail's: while
       * a search is showing, the rail's counts describe categories nobody is looking at, and
       * this one describes the list actually on screen.
       */}
      <div className="pane-head">
        {search ? (
          <SearchField
            value={search.query}
            focused={search.onField}
            shown={channels.length}
            total={search.total}
            onChange={search.onQuery}
          />
        ) : (
          <>
            <Text value={category || t("channel.channels")} className="panel-title" />
            {!!channels.length && <span className="count">{number(channels.length)}</span>}
          </>
        )}
      </div>
      <div className="viewport" ref={viewport}>
        {loading && !channels.length ? (
          Array.from({ length: 8 }, (_, i) => (
            /* Eight identical placeholders with no identity of their own and no order to
                 preserve, so the index is the only key they have and reordering them would
                 mean nothing. */
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
            <div className="row" key={i}>
              <span className="sk sk-logo" />
              <span className="sk sk-title" />
            </div>
          ))
        ) : (
          <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>
            {rows}
          </div>
        )}
        {/*
         * Nothing to show, said three different ways, because they are three different
         * situations and one sentence for all of them would be wrong twice.
         *
         * A search with nothing typed has not failed, it has not started, so it says what to
         * do. A search that matched nothing names what was looked for, since a viewer typing
         * on a television is often typing a letter they did not mean. An empty category is the
         * remaining case and keeps what it always said.
         *
         * There is no case for an empty Favourites: that row is only in the rail while it has
         * something in it, so there is no way to be standing in an empty one.
         */}
        {!loading && !channels.length && (
          <p className="empty">
            {!search
              ? t("channel.nothingInCategory")
              : search.query.trim()
                ? t("channel.noMatches", { query: search.query.trim() })
                : t("channel.typeName")}
          </p>
        )}
      </div>
      <ScrollIndicator count={channels.length} first={win.first} visible={win.visible} />
    </div>
  );
});
