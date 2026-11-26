import { memo, useEffect, useRef } from "react";
import { pointerInputActive, pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { useViewport } from "../../hooks/useViewport";
import { RAIL_ROW_BASE, useNavigableWindow } from "../../hooks/useWindowed";
import type { VodCategoryRow } from "../../stores/library";
import { ScrollIndicator } from "../ScrollIndicator";
import { Text } from "../Text";

export interface VodCategoryRailProps {
  items: readonly VodCategoryRow[];
  cursor: number;
  selectedKey: string;
  focused: boolean;
  scale: number;
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
}

interface CategoryRowProps {
  name: string;
  index: number;
  selected: boolean;
  highlighted: boolean;
  marqueeActive: boolean | undefined;
  separatesSynthetic: boolean;
  onFocus: VodCategoryRailProps["onFocus"];
  onSelect: VodCategoryRailProps["onSelect"];
}

const CategoryRow = memo(function CategoryRow({
  name,
  index,
  selected,
  highlighted,
  marqueeActive,
  separatesSynthetic,
  onFocus,
  onSelect,
}: CategoryRowProps) {
  return (
    <>
      <button
        type="button"
        className={`vod-category ${selected ? "selected" : ""} ${highlighted ? "cursor" : ""}`}
        onPointerEnter={() => pointerOnly(() => onFocus(index))}
        onClick={() => {
          onFocus(index);
          onSelect(index);
        }}
        aria-current={selected ? "true" : undefined}
      >
        <Text value={name} className="vod-category-name" marquee active={marqueeActive} />
      </button>
      {separatesSynthetic && <div className="vod-synthetic-divider" aria-hidden="true" />}
    </>
  );
});

export function VodCategoryRail({
  items,
  cursor,
  selectedKey,
  focused,
  scale,
  firstRow = 0,
  scrollOffset,
  reportWindowMetrics = false,
  onFocus,
  onSelect,
  onWindowChange,
}: VodCategoryRailProps) {
  const { t } = useLocale();
  const rail = useRef<HTMLElement>(null);
  const height = useViewport(rail, true);
  const window = useNavigableWindow(
    items.length,
    cursor,
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
    <nav
      ref={rail}
      className={`vod-rail ${focused ? "focused" : ""}`}
      aria-label={t("vod.all")}
      onWheel={(event) => {
        if (window.onWheel(event.deltaY, event.deltaMode)) event.preventDefault();
      }}
    >
      <div className="vod-rail-window" style={{ transform: `translateY(${displacement}px)` }}>
        {items.slice(window.start, window.end).map((item, offset) => {
          const index = window.start + offset;
          const name =
            item.source === "continue"
              ? t("vod.continueWatching")
              : item.source === "favourites"
                ? t("vod.favourites")
                : item.name || t("vod.uncategorised");
          const separatesSynthetic =
            item.source !== "provider" && items[index + 1]?.source === "provider";
          const highlighted = focused && cursor === index;
          return (
            <CategoryRow
              key={item.key}
              name={name}
              index={index}
              selected={selectedKey === item.key}
              highlighted={highlighted}
              marqueeActive={pointerActive ? undefined : highlighted}
              separatesSynthetic={separatesSynthetic}
              onFocus={onFocus}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      <ScrollIndicator
        count={items.length}
        first={window.indicatorFirst}
        visible={window.visible}
      />
    </nav>
  );
}
