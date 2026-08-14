import { memo, useRef } from "react";
import { Text } from "./Text";
import { ScrollIndicator } from "./ScrollIndicator";
import { RAIL_ROW_BASE, useWindowed } from "../hooks/useWindowed";
import { useViewport } from "../hooks/useViewport";

/**
 * The category rail.
 *
 * Its own header carries a subheader naming what the column is and how many of them there are,
 * and nothing else. The application's name and its two keys moved up to the panel's title bar,
 * which spans both columns: an application level control sitting inside this column made it look
 * like part of the categories, and there was nowhere to put a second one.
 *
 * What is left is the One UI shape for a list: a quiet subheader, a count, then the rows. The
 * channel column beside it carries the same shape, and the two subheaders share a line, so the
 * two lists start level. That is the checklist's grid alignment rule, and it is the reason
 * nothing here is allowed to grow taller than its neighbour.
 *
 * The cursor treats the title bar as position zero, above the first category, so it is reached
 * by pressing up and nothing sits outside the four directional path.
 */
interface Props {
  categories: { name: string; count: number }[];
  /** Which category the channel list is showing. */
  selected: number;
  /** Which row the remote is on. Zero is the title bar, so a category is index + 1. */
  cursor: number;
  /** So an arriving playlist is not announced as a playlist with nothing in it. */
  loading: boolean;
  focused: boolean;
  scale: number;
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
  categories, selected, cursor, loading, focused, scale, onSelect,
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
        * What this column is, and how many are in it.
        *
        * "Categories" is a fixed English word and the count beside it is not, which is the same
        * pairing every row below uses. It is a subheader rather than a title: One UI chunks a
        * list with one, and it is deliberately quieter than the category name in the column
        * beside it, because that one names something the viewer chose and this one names the
        * furniture.
        */}
      <div className="pane-head">
        <p className="panel-title">Categories</p>
        {!!categories.length && <span className="count">{categories.length}</span>}
      </div>

      <div className="viewport" ref={viewport}>
        <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>{rows}</div>
        {!loading && !categories.length && <p className="empty">No categories yet.</p>}
      </div>
      <ScrollIndicator count={categories.length} first={win.first} visible={win.visible} />
    </nav>
  );
});
