import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import {
  formatXtreamRating,
  type XtreamEpisode,
  type XtreamMovieDetail,
  type XtreamSeriesDetail,
} from "../services/xtream";
import type { LibraryLoadState } from "../stores/library";
import { Icon } from "./Icon";
import { Logo } from "./Logo";
import { clock } from "./PlaybackBanner";

export type FiniteSelection =
  | { kind: "movie"; item: XtreamMovieDetail; itemKeys: string[] }
  | { kind: "episode"; item: XtreamEpisode };

export function MediaHero({
  detail,
  compact = false,
}: {
  detail: XtreamMovieDetail | XtreamSeriesDetail;
  compact?: boolean;
}) {
  const duration = "durationSeconds" in detail ? detail.durationSeconds : undefined;
  const rating = formatXtreamRating(detail.rating);
  return (
    <div className={`media-hero ${compact ? "compact" : ""}`}>
      <div className="media-poster">
        {detail.logo ? (
          <Logo
            src={detail.logo}
            alt={detail.name}
            fetchable
            className="media-poster-art"
            width={compact ? 96 : 176}
            height={compact ? 144 : 264}
          />
        ) : (
          <Icon name={"seriesId" in detail ? "series" : "movie"} />
        )}
      </div>
      <div className="media-hero-copy">
        <h2 className="media-title">{detail.name}</h2>
        <div className="media-badges">
          {detail.year && <span className="media-badge">{detail.year}</span>}
          {duration !== undefined && <span className="media-badge">{clock(duration)}</span>}
          {detail.genre && <span className="media-badge">{detail.genre}</span>}
          {rating && (
            <span className="media-badge rating">
              <Icon name="star" />
              <span>{rating}</span>
            </span>
          )}
        </div>
        {detail.plot && <p className="media-plot">{detail.plot}</p>}
        {detail.cast && <p className="media-cast">{detail.cast}</p>}
        {!compact && detail.director && <p className="media-cast">{detail.director}</p>}
      </div>
    </div>
  );
}

export function MediaBreadcrumb({ items }: { items: readonly string[] }) {
  const shown = items.slice(0, -1).slice(-2);
  return (
    <div className="media-breadcrumb" aria-hidden="true">
      {shown.map((item, index) => (
        <span
          key={item}
          className={`media-breadcrumb-part ${index === shown.length - 1 ? "current" : ""}`}
        >
          {index > 0 && <span className="media-breadcrumb-separator">›</span>}
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}

export const MediaDetails = memo(function MediaDetails({
  state,
  title,
  trail,
  detail,
  itemKeys,
  resumeAt,
  focused,
  backFocused,
  onBack,
  onPlay,
  onRetry,
}: {
  state: LibraryLoadState;
  title: string;
  trail: readonly string[];
  detail?: XtreamMovieDetail;
  itemKeys: string[];
  resumeAt?: number;
  focused: boolean;
  backFocused: boolean;
  onBack: () => void;
  onPlay: (selection: FiniteSelection) => void;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className={`list pane media-details ${focused ? "focused" : ""}`}>
      <div className="pane-head media-appbar">
        <button
          type="button"
          className={`media-back ${backFocused ? "selected" : ""}`}
          aria-label={t("common.back")}
          onClick={onBack}
        >
          <Icon name="back" />
        </button>
        <p className="panel-title">{detail?.name || title}</p>
      </div>
      <MediaBreadcrumb items={trail} />
      {state === "loading" && (
        <div className="media-state" role="status">
          <span className="spinner" />
          <span>{t("library.loading")}</span>
        </div>
      )}
      {state === "failed" && (
        <div className="media-state">
          <p>{t("library.failed")}</p>
          <button type="button" className="btn tonal" onClick={onRetry}>
            {t("library.retry")}
          </button>
        </div>
      )}
      {state === "loaded" && detail && (
        <div className="media-detail-body">
          <MediaHero detail={detail} />
          <button
            type="button"
            className={`btn tonal media-play-action ${focused && !backFocused ? "selected" : ""}`}
            onClick={() => onPlay({ kind: "movie", item: detail, itemKeys })}
          >
            <Icon name="play" />
            <span>
              {resumeAt ? `${t("library.resume")} ${clock(resumeAt)}` : t("common.play")}
            </span>
          </button>
        </div>
      )}
    </div>
  );
});
