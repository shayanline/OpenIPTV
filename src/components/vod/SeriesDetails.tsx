import { useCallback, useState, type ReactNode } from "react";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import type { VodOrigin } from "../../hooks/useVodNavigation";
import type { ArtworkPalette } from "../../services/artwork";
import type { XtreamSeriesDetail } from "../../services/xtream";
import type { LibraryResource, SeriesContinueTarget } from "../../stores/library";
import { Artwork } from "../Artwork";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { episodeReference } from "./EpisodeList";
import { VodBackdrop, VodDetailSkeleton, VodDetailTags } from "./VodDetails";
import { VodCredits } from "./VodCredits";
import { VodTitleRow } from "./VodTitleRow";

export type SeriesAction = "continue" | "restart" | "episodes" | "favourite";

export function seriesActions(
  detail: XtreamSeriesDetail,
  continueTarget: SeriesContinueTarget | null,
): SeriesAction[] {
  const actions: SeriesAction[] = [];
  if (continueTarget) {
    actions.push("continue");
    if (continueTarget.reason === "resume") actions.push("restart");
  }
  if (detail.episodes.length) actions.push("episodes");
  actions.push("favourite");
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
    return <VodDetailSkeleton titleRow={titleRow} poster={poster} palette={posterPalette} />;
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
  const continueLabel = continueTarget
    ? continueTarget.reason === "resume"
      ? `${t("vod.continue", { episode: reference })}${continueTarget.remainingSeconds !== undefined ? `, ${t("vod.minutes", { count: Math.ceil(continueTarget.remainingSeconds / 60) })}` : ""}`
      : `${t("vod.play")} ${reference}`
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
            {!!detail.plot && (
              <p className="vod-synopsis" dir="auto">
                {detail.plot}
              </p>
            )}
            <VodCredits cast={detail.metadata.cast} director={detail.metadata.director} />
            {!continueTarget && <p className="episode-state">{t("vod.noEpisodes")}</p>}
          </div>
          <div className="vod-actions series-actions">
            {actions.map((action, index) => {
              const label =
                action === "continue"
                  ? continueLabel
                  : action === "restart"
                    ? `${t("vod.restart")} ${reference}`
                    : action === "favourite"
                      ? t(favourite ? "vod.removeFavourite" : "vod.addFavourite")
                      : t("vod.episodes");
              return (
                <button
                  key={action}
                  type="button"
                  className={`vod-action ${action === "favourite" ? "vod-favourite" : ""} ${action === "favourite" && favourite ? "on" : ""} ${actionFocused && actionIndex === index ? "cursor" : ""}`}
                  aria-pressed={action === "favourite" ? favourite : undefined}
                  disabled={playbackPending}
                  onPointerEnter={() => pointerOnly(() => onFocusAction?.(index))}
                  onClick={() => {
                    onFocusAction?.(index);
                    if (action === "continue" && continueTarget) onContinue(continueTarget);
                    else if (action === "restart" && continueTarget) onRestart(continueTarget);
                    else if (action === "episodes") onToggleEpisodes();
                    else if (action === "favourite") onToggleFavourite();
                  }}
                >
                  <Icon
                    name={
                      action === "favourite"
                        ? "star"
                        : action === "restart"
                          ? "refresh"
                          : action === "episodes"
                            ? "episode"
                            : "play"
                    }
                  />
                  <Text value={label} marquee active={actionFocused && actionIndex === index} />
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
              width={192}
              height={288}
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
