import { memo, useRef } from "react";
import { useLocale } from "../hooks/useLocale";
import { useViewport } from "../hooks/useViewport";
import { useWindowed } from "../hooks/useWindowed";
import type { XtreamSeriesDetail } from "../services/xtream";
import type { LibraryLoadState } from "../stores/library";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { MediaBreadcrumb, MediaHero } from "./MediaDetails";
import { ScrollIndicator } from "./ScrollIndicator";
import { SearchField } from "./SearchField";
import { Text } from "./Text";

export interface MediaRow {
  key: string;
  kind: "movie" | "series" | "season" | "episode";
  name: string;
  logo?: string;
  meta?: string;
  rating?: string;
  favourite?: boolean;
  season?: number;
  number?: number;
}

export const MediaList = memo(function MediaList({
  title,
  items,
  state,
  index,
  focused,
  scale,
  searchScope,
  search,
  detail,
  trail,
  backFocused,
  onBack,
  onSelect,
  onRetry,
  onWheel,
}: {
  title: string;
  items: MediaRow[];
  state: LibraryLoadState;
  index: number;
  focused: boolean;
  scale: number;
  searchScope?: string;
  search?: {
    query: string;
    onField: boolean;
    onQuery: (query: string) => void;
    onExitUp: () => void;
    onExitDown: () => void;
    onExitStart: () => void;
  };
  detail?: XtreamSeriesDetail;
  trail?: readonly string[];
  backFocused?: boolean;
  onBack?: () => void;
  onSelect: (index: number) => void;
  onRetry: () => void;
  onWheel: (direction: -1 | 1) => void;
}) {
  const { t } = useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  const win = useWindowed(items.length, Math.max(0, index), height, scale);
  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    const item = items[i];
    rows.push(
      <button
        type="button"
        className={`row ${i === index ? "selected" : ""}`}
        style={{ top: i * win.row, height: win.row }}
        key={i % win.slots}
        onClick={() => onSelect(i)}
      >
        {item.number !== undefined && <span className="media-number">E{item.number}</span>}
        {item.logo && <Logo src={item.logo} alt={item.name} fetchable width={64} height={64} />}
        <Text value={item.name} className="row-label" marquee />
        {item.meta && <span className="media-meta">{item.meta}</span>}
        {item.rating && (
          <span className="ch-badge media-rating">
            <Icon name="star" />
            <span>{item.rating}</span>
          </span>
        )}
        {item.favourite && (
          <span className="media-favourite" role="img" aria-label={t("channel.favourites")}>
            <Icon name="star" />
          </span>
        )}
      </button>,
    );
  }

  return (
    <div className={`list pane media-list ${focused ? "focused" : ""}`}>
      <div className={`pane-head ${onBack ? "media-appbar" : ""}`}>
        {onBack && (
          <button
            type="button"
            className={`media-back ${backFocused ? "selected" : ""}`}
            aria-label={t("common.back")}
            onClick={onBack}
          >
            <Icon name="back" />
          </button>
        )}
        {search ? (
          <SearchField
            value={search.query}
            focused={search.onField}
            shown={items.length}
            total={items.length}
            placeholder={t("search.mediaName")}
            ariaLabel={t("search.mediaAria")}
            onChange={search.onQuery}
            onExitUp={search.onExitUp}
            onExitDown={search.onExitDown}
            onExitStart={search.onExitStart}
          />
        ) : (
          <Text value={title} className="panel-title" />
        )}
      </div>
      {trail && trail.length > 1 && <MediaBreadcrumb items={trail} />}
      {searchScope && <p className="media-search-scope">{searchScope}</p>}
      {detail && <MediaHero detail={detail} compact />}
      <div
        className="viewport"
        ref={viewport}
        onWheel={(event) => {
          if (event.deltaY) onWheel(event.deltaY > 0 ? 1 : -1);
        }}
      >
        {state === "loading" && (
          <div className="media-state" role="status">
            <span className="spinner" />
            <span>{t("library.loading")}</span>
          </div>
        )}
        {state === "failed" && (
          <div className="media-state">
            <p>{t("library.failed")}</p>
            <button
              type="button"
              className={`btn tonal ${index === 0 ? "selected" : ""}`}
              onClick={onRetry}
            >
              {t("library.retry")}
            </button>
          </div>
        )}
        {state === "empty" && <p className="empty">{t("channel.nothingInCategory")}</p>}
        {(state === "loaded" || state === "empty") && (
          <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>
            {rows}
          </div>
        )}
        <ScrollIndicator count={items.length} first={win.first} visible={win.visible} />
      </div>
    </div>
  );
});
