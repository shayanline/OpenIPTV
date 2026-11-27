import { memo, useRef, useState } from "react";
import { pointerOnly, usePointerInput } from "../hooks/usePointerAwake";
import { useLocale } from "../hooks/useLocale";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { ScrollIndicator } from "./ScrollIndicator";
import { KeyGuide, SettingsPath } from "./KeyGuide";
import { RAIL_ROW_BASE, useNavigableWindow } from "../hooks/useWindowed";
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
  categories: {
    key: string;
    name: string;
    count: number;
    hidden: boolean;
    favourite?: boolean;
  }[];
  /** Which category the channel list is showing. */
  selected: number;
  /** Which row the remote is on. Zero is the title bar, so a category is index + 1. */
  cursor: number;
  /** So an arriving playlist is not announced as a playlist with nothing in it. */
  loading: boolean;
  allHidden: boolean;
  focused: boolean;
  scale: number;
  /** Must be stable, or every row rebuilds on every press. */
  onFocus: (index: number) => void;
  onSelect: (index: number) => void;
  onWheel: (direction: -1 | 1) => void;
}

const Row = memo(function Row({
  name,
  count,
  index,
  cursor,
  pointerMode,
  showing,
  hidden,
  favourite = false,
  top,
  height,
  onFocus,
  onPick,
}: {
  name: string;
  count: number;
  index: number;
  cursor: boolean;
  pointerMode: boolean;
  showing: boolean;
  hidden: boolean;
  favourite?: boolean;
  top: number;
  height: number;
  onFocus: (index: number) => void;
  onPick: (index: number) => void;
}) {
  const { t, number } = useLocale();
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      className={`row ${cursor ? "cursor" : ""} ${showing ? "showing" : ""} ${hidden ? "hidden" : ""}`}
      style={{ top, height }}
      onPointerEnter={() =>
        pointerOnly(() => {
          setHovered(true);
          onFocus(index);
        })
      }
      onPointerLeave={() => setHovered(false)}
      onClick={() => onPick(index)}
    >
      {favourite && <Icon name="star" />}
      <Text
        value={name}
        className="row-label"
        marquee
        active={pointerMode ? hovered : cursor}
      />
      {hidden && (
        <span className="hidden-state" role="img" aria-label={t("channel.hidden")}>
          <Icon name="hidden" />
        </span>
      )}{" "}
      <span className="count">{number(count)}</span>
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
  categories,
  selected,
  cursor,
  loading,
  allHidden,
  focused,
  scale,
  onFocus,
  onSelect,
  onWheel,
}: Props) {
  const { t, number, direction } = useLocale();
  const pointerMode = usePointerInput();
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  // Cursor zero is the Settings key in the header, so the list's own cursor is one behind.
  const win = useNavigableWindow(
    categories.length,
    Math.max(0, cursor - 1),
    height,
    scale,
    RAIL_ROW_BASE,
  );

  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    rows.push(
      <Row
        key={categories[i].key}
        name={categories[i].name}
        count={categories[i].count}
        index={i}
        cursor={focused && cursor === i + 1}
        pointerMode={pointerMode}
        showing={i === selected}
        hidden={categories[i].hidden}
        favourite={categories[i].favourite}
        top={i * win.row}
        height={win.row}
        onFocus={onFocus}
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
        {/*
         * The glyph and the word travel together in a wrapper of their own, because the header
         * spreads its children to the edges so the count sits at the far side: a third child left
         * loose would push the word into the middle of the column.
         */}
        <span className="pane-head-label">
          <Icon name="categories" />
          <p className="panel-title">{t("channel.categories")}</p>
        </span>
        {!!categories.length && <span className="count">{number(categories.length)}</span>}
      </div>

      <div
        className="viewport"
        ref={viewport}
        onWheel={(event) => {
          if (!event.deltaY) return;
          if (win.onWheel(event.deltaY, event.deltaMode)) {
            event.preventDefault();
            return;
          }
          onWheel(event.deltaY > 0 ? 1 : -1);
        }}
      >
        <div className="window" style={{ transform: `translateY(${-win.scrollOffset}px)` }}>
          {rows}
        </div>
        {!loading &&
          !categories.length &&
          (allHidden ? (
            <div className="empty">
              <p>{t("channel.allCategoriesHidden")}</p>
              <div className="empty-guide-row">
                <KeyGuide
                  className="empty-guide"
                  items={[{ keys: ["Red"], label: t("playlist.showAllCategories") }]}
                />
                <SettingsPath
                  items={[t("settings.title"), t("settings.playlists"), t("lineup.title")]}
                  direction={direction}
                />
              </div>
            </div>
          ) : (
            <p className="empty">{t("channel.noCategories")}</p>
          ))}
        <ScrollIndicator
          count={categories.length}
          first={win.indicatorFirst}
          visible={win.visible}
        />
      </div>
    </nav>
  );
});
