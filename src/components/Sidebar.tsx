import { memo, useRef } from "react";
import { Text } from "./Text";
import { Icon } from "./Icon";
import { ScrollIndicator } from "./ScrollIndicator";
import { RAIL_ROW_BASE, useWindowed } from "../hooks/useWindowed";
import { useViewport } from "../hooks/useViewport";

/**
 * The category rail.
 *
 * Settings is a single small key in the header rather than a row of its own, so the
 * categories start level with the channels beside them. A full width row pushed the whole
 * rail down and left the two lists out of step, which the checklist's grid alignment rule
 * exists to prevent.
 *
 * The cursor treats it as position zero, above the first category, so it is still reached
 * by pressing up and nothing sits outside the four directional path.
 */
interface Props {
  categories: { name: string; count: number }[];
  /** Which category the channel list is showing. */
  selected: number;
  /** Which row the remote is on. Zero is Settings, so a category is index + 1. */
  cursor: number;
  /** So an arriving playlist is not announced as a playlist with nothing in it. */
  loading: boolean;
  focused: boolean;
  scale: number;
  onSettings: () => void;
  /** Must be stable, or every row rebuilds on every press. */
  onSelect: (index: number) => void;
}

const Row = memo(function Row({ name, count, index, selected, showing, top, height, onPick }: {
  name: string;
  count: number;
  index: number;
  selected: boolean;
  showing: boolean;
  top: number;
  height: number;
  onPick: (index: number) => void;
}) {
  return (
    <button
      type="button"
      className={`row ${selected ? "selected" : ""} ${showing ? "showing" : ""}`}
      style={{ top, height }}
      onClick={() => onPick(index)}
    >
      {/* Wrapped to two lines rather than cut with an ellipsis. A playlist that names its
          groups in two scripts, "News | اخبار", truncates catastrophically: the ellipsis
          removes the logical end of the string, which in a right to left run is its visual
          beginning, so what is left on screen is the middle of a word. */}
      <Text value={name} className="row-label two-line" />
      <span className="count">{count}</span>
    </button>
  );
});

/**
 * Memoised as a whole, not just row by row.
 *
 * Moving the cursor in the channel list re-renders the app, and without this the rail
 * reconciled all of its categories again each time even though nothing it draws had
 * changed. The rows were memoised, so nothing repainted, but React still walked every one
 * of them, and on entry hardware that walk is not free.
 */
export const Sidebar = memo(function Sidebar({
  categories, selected, cursor, loading, focused, scale, onSettings, onSelect,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  // Cursor zero is the Settings key in the header, so the list's own cursor is one behind.
  // Taller rows here than in the channel list, because a group title wraps to two lines.
  const win = useWindowed(categories.length, Math.max(0, cursor - 1), height, scale,
                         RAIL_ROW_BASE);

  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    rows.push(
      <Row
        key={categories[i].name}
        name={categories[i].name}
        count={categories[i].count}
        index={i}
        selected={cursor === i + 1}
        showing={i === selected}
        top={i * win.row}
        height={win.row}
        onPick={onSelect}
      />,
    );
  }

  return (
    <nav className={`rail pane ${focused ? "focused" : ""}`}>
      {/*
        * The application's name on the left and its Settings key on the right.
        *
        * The key used to sit beside a "CATEGORIES" subheader at the far end of the rail,
        * which put it a few pixels from the channel column's own heading and made it read as
        * though it belonged to the channels. Paired with the name it plainly belongs to the
        * application, which is what it opens.
        *
        * It stays in the header rather than becoming a row, because checklist 1.3 keeps other
        * selectable areas away from the top and the bottom of a vertically scrollable list.
        */}
      <div className="pane-head">
        <p className="rail-brand">SimpleIPTV</p>
        <button
          type="button"
          className={`gear ${cursor === 0 ? "selected" : ""}`}
          onClick={onSettings}
          aria-label="Settings"
        >
          <Icon name="settings" />
          {/* In an element of its own rather than bare, so that it is a flex item the
              stylesheet can reach. A loose text node becomes an anonymous flex item, which
              no selector matches, and the margin that stands in for flex gap on the older
              sets could not be applied to it. */}
          <span>Settings</span>
        </button>
      </div>

      <div className="viewport" ref={viewport}>
        <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>{rows}</div>
        {!loading && !categories.length && <p className="empty">No categories yet.</p>}
      </div>
      <ScrollIndicator count={categories.length} first={win.first} visible={win.visible} />
    </nav>
  );
});
