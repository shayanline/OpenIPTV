import { memo, useEffect, useRef, type CSSProperties } from "react";
import { pointerInputActive, pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { useViewport } from "../../hooks/useViewport";
import { RAIL_ROW_BASE, useNavigableWindow } from "../../hooks/useWindowed";
import type { VodCategoryRow } from "../../stores/library";
import { ScrollIndicator } from "../ScrollIndicator";
import { Icon } from "../Icon";
import { Text } from "../Text";

export interface VodCategoryRailProps {
  items: readonly VodCategoryRow[];
  cursor: number;
  selectedKey: string;
  focused: boolean;
  scale: number;
  /** Logical index before which a nonfocus provider heading is rendered. */
  headerIndex?: number;
  firstRow?: number;
  scrollOffset?: number;
  /** Include measured capacity without changing legacy callback arguments. */
  reportWindowMetrics?: boolean;
  onFocus: (index: number) => void;
  onSelect: (index: number) => void;
  onWindowChange?: (
    firstRow: number,
    scrollOffset: number,
    visibleRows?: number,
    rowHeight?: number,
  ) => void;
  onSearch?: () => void;
  onSearchFocus?: () => void;
  searchFocused?: boolean;
}

interface CategoryRowProps {
  name: string;
  hidden?: boolean;
  icon?: "time" | "star";
  index: number;
  selected: boolean;
  highlighted: boolean;
  marqueeActive: boolean | undefined;
  onFocus: VodCategoryRailProps["onFocus"];
  onSelect: VodCategoryRailProps["onSelect"];
}

const CategoryRow = memo(function CategoryRow({
  name,
  hidden,
  icon,
  index,
  selected,
  highlighted,
  marqueeActive,
  onFocus,
  onSelect,
}: CategoryRowProps) {
  const { t } = useLocale();
  return (
    <>
      <button
        type="button"
        className={`vod-category ${icon ? "has-icon" : ""} ${hidden ? "category-hidden" : ""} ${selected ? "selected" : ""} ${highlighted ? "cursor" : ""}`}
        onPointerEnter={() => pointerOnly(() => onFocus(index))}
        onClick={() => {
          onFocus(index);
          onSelect(index);
        }}
        aria-current={selected ? "true" : undefined}
      >
        {icon && <Icon name={icon} />}
        <Text value={name} className="vod-category-name" marquee active={marqueeActive} />
        {hidden && (
          <span className="hidden-state" role="img" aria-label={t("channel.hidden")}>
            <Icon name="hidden" />
          </span>
        )}
      </button>
    </>
  );
});

export function VodCategoryRail({
  items,
  cursor,
  selectedKey,
  focused,
  scale,
  headerIndex = -1,
  firstRow = 0,
  scrollOffset,
  reportWindowMetrics = false,
  onFocus,
  onSelect,
  onWindowChange,
  onSearch,
  onSearchFocus,
  searchFocused = false,
}: VodCategoryRailProps) {
  const { t, number } = useLocale();
  const rail = useRef<HTMLElement>(null);
  const height = useViewport(rail, true);
  const hasHeader = headerIndex >= 0 && headerIndex < items.length;
  const rowCount = items.length + (hasHeader ? 1 : 0);
  const cursorRow = cursor + (hasHeader && cursor >= headerIndex ? 1 : 0);
  const window = useNavigableWindow(
    rowCount,
    cursorRow,
    height,
    scale,
    RAIL_ROW_BASE,
    2,
    firstRow,
    undefined,
    scrollOffset,
  );
  const displacement = window.start * window.row - window.scrollOffset;
  const pointerActive = pointerInputActive();
  const reportedPointerMode = reportWindowMetrics ? window.pointerMode : undefined;
  const reportedVisibleRows = reportWindowMetrics ? window.visible : undefined;
  const reportedRowHeight = reportWindowMetrics ? window.row : undefined;
  useEffect(() => {
    if (height <= 0) return;
    if (reportedPointerMode !== undefined) {
      onWindowChange?.(
        window.first,
        window.scrollOffset,
        reportedVisibleRows,
        reportedRowHeight,
      );
    } else onWindowChange?.(window.first, window.scrollOffset);
  }, [
    height,
    onWindowChange,
    reportedPointerMode,
    reportedRowHeight,
    reportedVisibleRows,
    window.first,
    window.scrollOffset,
  ]);
  return (
    <div
      className="vod-rail-panel"
      style={{ "--vod-rail-row": `${window.row}px` } as CSSProperties}
    >
      {onSearch && (
        <div className="rail-search-row">
          <button
            type="button"
            className={`btn tonal section-search ${searchFocused ? "cursor" : ""}`}
            aria-label={t("common.search")}
            onPointerEnter={() => pointerOnly(() => onSearchFocus?.())}
            onClick={onSearch}
          >
            <Icon name="search" />
            <span>{t("common.search")}</span>
          </button>
        </div>
      )}
      <nav
        ref={rail}
        className={`vod-rail ${focused ? "focused" : ""}`}
        aria-label={t("channel.categories")}
        onWheel={(event) => {
          if (window.onWheel(event.deltaY, event.deltaMode)) event.preventDefault();
        }}
      >
        <div className="vod-rail-window" style={{ transform: `translateY(${displacement}px)` }}>
          {Array.from({ length: window.end - window.start }, (_, offset) => {
            const row = window.start + offset;
            if (hasHeader && row === headerIndex) {
              return (
                <div className="pane-head vod-rail-heading" key="categories-heading">
                  <h2 className="panel-title">{t("channel.categories")}</h2>
                  <span className="count">{number(items.length - headerIndex)}</span>
                </div>
              );
            }
            const index = row - (hasHeader && row > headerIndex ? 1 : 0);
            const item = items[index];
            const name =
              item.source === "continue"
                ? t("vod.continueWatching")
                : item.source === "favourites"
                  ? t("vod.favourites")
                  : item.name || t("vod.uncategorised");
            const highlighted = focused && cursor === index;
            return (
              <CategoryRow
                key={item.key}
                name={name}
                icon={
                  item.source === "continue"
                    ? "time"
                    : item.source === "favourites"
                      ? "star"
                      : undefined
                }
                index={index}
                selected={selectedKey === item.key}
                highlighted={highlighted}
                hidden={item.hidden}
                marqueeActive={pointerActive ? undefined : highlighted}
                onFocus={onFocus}
                onSelect={onSelect}
              />
            );
          })}
        </div>
        <ScrollIndicator
          count={rowCount}
          first={window.indicatorFirst}
          visible={window.visible}
        />
      </nav>
    </div>
  );
}
