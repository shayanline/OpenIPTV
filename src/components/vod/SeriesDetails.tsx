import { useCallback, useState, type ReactNode } from "react";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import type { VodOrigin } from "../../hooks/useVodNavigation";
import {
  DETAIL_POSTER_BOX,
  displayArtworkBox,
  type ArtworkPalette,
} from "../../services/artwork";
import type { XtreamSeriesDetail } from "../../services/xtream";
import { detailActionColumns } from "../../services/vodActionLayout";
import type { LibraryResource, SeriesContinueTarget } from "../../stores/library";
import { Artwork } from "../Artwork";
import { Icon } from "../Icon";
import { clock } from "../PlaybackBanner";
import { Text } from "../Text";
import { episodeReference } from "./EpisodeList";
import { VodBackdrop, VodDetailSkeleton, VodDetailTags } from "./VodDetails";
import { VodCredits } from "./VodCredits";
import { VodTitleRow } from "./VodTitleRow";

export type SeriesAction = "continue" | "restart" | "episodes" | "info" | "favourite";

export function seriesActions(
  detail: XtreamSeriesDetail | undefined,
  continueTarget: SeriesContinueTarget | null,
): SeriesAction[] {
  const actions: SeriesAction[] = [];
  if (continueTarget) {
    actions.push("continue");
    if (continueTarget.reason === "resume") actions.push("restart");
  }
  if (!detail || detail.episodes.length) actions.push("episodes");
  actions.push("info", "favourite");
  return actions;
}

export interface SeriesDetailsProps {
  resource: LibraryResource<XtreamSeriesDetail | undefined>;
  origin: VodOrigin;
  title?: string;
  poster?: string;
  continueTarget: SeriesContinueTarget | null;
  favourite: boolean;
  playbackPending?: boolean;
  actionIndex: number;
  actionFocused?: boolean;
  episodePanelOpen: boolean;
  retryFocused?: boolean;
  onInfo?: () => void;
  episodePanel?: ReactNode;
  onToggleFavourite: () => void;
  onFocusAction?: (index: number) => void;
  onFocusRetry?: () => void;
  onContinue: (target: SeriesContinueTarget) => void;
  onRestart: (target: SeriesContinueTarget) => void;
  onToggleEpisodes: () => void;
  onRetry: () => void;
}

export function SeriesDetails({
  resource,
  title,
  poster = "",
  continueTarget,
  favourite,
  playbackPending = false,
  actionIndex,
  actionFocused = false,
  episodePanelOpen,
  retryFocused = false,
  onInfo,
  episodePanel,
  onToggleFavourite,
  onFocusAction,
  onFocusRetry,
  onContinue,
  onRestart,
  onToggleEpisodes,
  onRetry,
}: SeriesDetailsProps) {
  const { t } = useLocale();
  const detail = resource.value;
  const posterBox = displayArtworkBox(DETAIL_POSTER_BOX);
  const [posterPalette, setPosterPalette] = useState<ArtworkPalette | undefined>();
  const [backdropPalette, setBackdropPalette] = useState<ArtworkPalette | undefined>();
  const handlePosterPalette = useCallback((palette: ArtworkPalette) => {
    setPosterPalette(palette);
  }, []);
  const handleBackdropPalette = useCallback((palette: ArtworkPalette | null) => {
    setBackdropPalette(palette ?? undefined);
  }, []);
  const titleRow = <VodTitleRow title={detail?.name ?? title ?? ""} />;
  if (resource.state === "loading" || resource.state === "idle") {
    return (
      <VodDetailSkeleton
        titleRow={titleRow}
        poster={poster}
        palette={posterPalette}
        actionCount={seriesActions(detail, continueTarget).length}
      />
    );
  }
  if (resource.state === "failed" || !detail) {
    return (
      <section className="vod-details failed">
        {titleRow}
        <span className="vod-error-icon" aria-hidden="true">
          <Icon name="warn" />
        </span>
        <p className="vod-error-message">{t("vod.failed")}</p>
        <button
          type="button"
          className="vod-retry"
          data-selected={retryFocused || undefined}
          onPointerEnter={() => pointerOnly(() => onFocusRetry?.())}
          onClick={() => {
            onFocusRetry?.();
            onRetry();
          }}
        >
          <Icon name="refresh" />
          <span>{t("vod.retry")}</span>
        </button>
      </section>
    );
  }

  const reference = continueTarget ? episodeReference(continueTarget.episode, t) : "";
  const episodeDescription = continueTarget
    ? [
        continueTarget.episode.season !== undefined
          ? t("library.season", { number: continueTarget.episode.season })
          : "",
        continueTarget.episode.number !== undefined
          ? t("library.episode", { number: continueTarget.episode.number })
          : "",
      ]
        .filter(Boolean)
        .join(", ") || reference
    : "";
  const continueLabel = continueTarget
    ? continueTarget.reason === "resume"
      ? t("vod.resumeEpisode", {
          episode: episodeDescription,
          time: clock(continueTarget.resumeAt),
        })
      : continueTarget.reason === "next"
        ? t("vod.continue", { episode: episodeDescription })
        : `${t("vod.play")} ${episodeDescription}`
    : "";
  const actions = seriesActions(detail, continueTarget);
  const seasonCount = detail.seasons.filter((season) => season !== "unassigned").length;

  return (
    <section
      className={`vod-details loaded series-details ${episodePanelOpen ? "panel-open" : ""}`}
      aria-busy={playbackPending}
      onClickCapture={(event) => {
        if (!episodePanelOpen) return;
        const target = event.target;
        if (target instanceof Element && target.closest(".episode-panel")) return;
        event.preventDefault();
        event.stopPropagation();
        onToggleEpisodes();
      }}
    >
      <VodBackdrop
        url={detail.metadata.backdrops[0]}
        poster={detail.logo}
        posterPalette={posterPalette}
        onPalette={handleBackdropPalette}
      />
      <div className="vod-hero">
        <div className="vod-copy-panel">
          {titleRow}
          <div className="vod-hero-copy">
            <VodDetailTags
              year={detail.year}
              rating={detail.rating}
              genre={detail.genre}
              seasons={seasonCount}
              country={detail.metadata.country}
            />
            {!!detail.plot && <p className="vod-synopsis">{detail.plot}</p>}
            <VodCredits cast={detail.metadata.cast} director={detail.metadata.director} />
            {!continueTarget && <p className="episode-state">{t("vod.noEpisodes")}</p>}
          </div>
          <div
            className="vod-actions series-actions"
            data-columns={detailActionColumns(actions.length)}
          >
            {actions.map((action, index) => {
              const label =
                action === "continue"
                  ? continueLabel
                  : action === "restart"
                    ? `${t("vod.restartEpisode")}, ${episodeDescription}`
                    : action === "info"
                      ? t("library.details")
                      : action === "favourite"
                        ? t(favourite ? "vod.removeFavourite" : "vod.addFavourite")
                        : t("vod.episodes");
              const visibleLabel =
                action === "continue"
                  ? t(
                      continueTarget?.reason === "resume"
                        ? "library.resume"
                        : continueTarget?.reason === "next"
                          ? "vod.continueShort"
                          : "vod.play",
                    )
                  : action === "restart"
                    ? t("vod.restartEpisode")
                    : action === "favourite"
                      ? t("vod.favourites")
                      : label;
              return (
                <button
                  key={action}
                  type="button"
                  className={`vod-action ${action === "favourite" ? "vod-favourite" : ""} ${action === "favourite" && favourite ? "on" : ""} ${actionFocused && actionIndex === index ? "cursor" : ""}`}
                  aria-pressed={action === "favourite" ? favourite : undefined}
                  aria-label={label}
                  disabled={playbackPending}
                  onPointerEnter={() => pointerOnly(() => onFocusAction?.(index))}
                  onClick={() => {
                    onFocusAction?.(index);
                    if (action === "continue" && continueTarget) onContinue(continueTarget);
                    else if (action === "restart" && continueTarget) onRestart(continueTarget);
                    else if (action === "episodes") onToggleEpisodes();
                    else if (action === "info") onInfo?.();
                    else if (action === "favourite") onToggleFavourite();
                  }}
                >
                  <Icon
                    name={
                      action === "favourite"
                        ? "star"
                        : action === "restart"
                          ? "refresh"
                          : action === "info"
                            ? "about"
                            : action === "episodes"
                              ? "episode"
                              : "play"
                    }
                  />
                  <span className="vod-action-copy">
                    <Text value={visibleLabel} />
                    {action === "continue" && (
                      <span className="vod-action-caption">
                        <span>{episodeDescription}</span>
                        {continueTarget?.reason === "resume" && (
                          <>
                            {" "}
                            &middot;{" "}
                            {t("vod.resumeTime", { time: clock(continueTarget.resumeAt) })}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="series-poster-region">
          <div className="series-poster">
            <Artwork
              src={detail.logo}
              alt={t("vod.seriesArtwork")}
              kind="poster"
              width={posterBox.width}
              height={posterBox.height}
              placeholderIcon="series"
              palette={backdropPalette ?? posterPalette}
              onPalette={handlePosterPalette}
            />
          </div>
          {episodePanel}
        </div>
      </div>
    </section>
  );
}
