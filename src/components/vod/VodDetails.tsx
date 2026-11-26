import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  artworkOf,
  loadBackdrop,
  paletteCss,
  peekArtworkPalette,
  QUIET_NEUTRAL_PALETTE,
  type ArtworkPalette,
  type BackdropLease,
} from "../../services/artwork";
import { resolveCountryFlags } from "../../services/countryFlags";
import type { XtreamMovieDetail } from "../../services/xtream";
import type { VodOrigin } from "../../hooks/useVodNavigation";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import type { LibraryResource } from "../../stores/library";
import type { ResolvedPlaybackProgress } from "../../stores/personal";
import { Artwork } from "../Artwork";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { VodCredits } from "./VodCredits";
import { VodTitleRow } from "./VodTitleRow";

export type MovieAction = "play" | "resume" | "restart" | "favourite";

export interface MoviePlaybackChoice {
  resumeAt: number;
  restart: boolean;
}

export function movieActions(
  progress: ResolvedPlaybackProgress | undefined,
  _more: boolean,
): MovieAction[] {
  return progress ? ["resume", "restart", "favourite"] : ["play", "favourite"];
}

export interface VodDetailsProps {
  resource: LibraryResource<XtreamMovieDetail | undefined>;
  origin: VodOrigin;
  title?: string;
  poster?: string;
  progress?: ResolvedPlaybackProgress;
  favourite: boolean;
  playbackPending?: boolean;
  focus: { zone: "actions" | "drawer" | "retry" | null; index: number };
  drawerOpen?: boolean;
  onToggleFavourite: () => void;
  onFocusAction?: (index: number) => void;
  onFocusRetry?: () => void;
  onPlay: (choice: MoviePlaybackChoice) => void;
  onDrawerChange?: (open: boolean) => void;
  onOverflowChange?: (overflow: boolean) => void;
  onRetry: () => void;
}

export function VodBackdrop({
  url,
  poster,
  posterPalette,
  onPalette,
}: {
  url?: string;
  poster: string;
  posterPalette?: ArtworkPalette;
  onPalette?: (palette: ArtworkPalette | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [lease, setLease] = useState<BackdropLease | null>(null);
  const cachedPoster = artworkOf({
    url: poster,
    kind: "poster",
    width: 192,
    height: 288,
  });
  const cachedPosterPalette = cachedPoster
    ? peekArtworkPalette(cachedPoster.bitmap)
    : undefined;
  const fallbackPalette = posterPalette ?? cachedPosterPalette ?? QUIET_NEUTRAL_PALETTE;

  useEffect(() => {
    const controller = new AbortController();
    let current: BackdropLease | null = null;
    setLease(null);
    onPalette?.(null);
    if (url) {
      void loadBackdrop(url, controller.signal).then((next) => {
        if (controller.signal.aborted) {
          next?.release();
          return;
        }
        current = next;
        setLease(next);
        onPalette?.(next?.palette ?? null);
      });
    }
    return () => {
      controller.abort();
      current?.release();
    };
  }, [onPalette, url]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context || !lease) return;
    try {
      const scale = Math.max(1280 / lease.bitmap.width, 720 / lease.bitmap.height);
      const sourceWidth = 1280 / scale;
      const sourceHeight = 720 / scale;
      context.drawImage(
        lease.bitmap,
        (lease.bitmap.width - sourceWidth) / 2,
        (lease.bitmap.height - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        0,
        0,
        1280,
        720,
      );
    } catch {
      return;
    }
  }, [lease]);

  return (
    <span
      className={`vod-backdrop ${lease ? "" : "fallback"}`}
      style={lease ? undefined : { background: paletteCss(fallbackPalette) }}
      aria-hidden="true"
    >
      {lease && (
        <canvas ref={canvas} className="vod-backdrop-image" width={1280} height={720} />
      )}
      <span className="vod-backdrop-shade" />
    </span>
  );
}

const durationMinutes = (seconds?: number) => (seconds ? Math.round(seconds / 60) : undefined);

export function VodDetailTags({
  year,
  rating,
  genre,
  duration,
  seasons,
  country,
}: {
  year?: string;
  rating?: string;
  genre?: string;
  duration?: string;
  seasons?: number;
  country?: string;
}) {
  const { t } = useLocale();
  const flags = resolveCountryFlags(country);
  if (
    !year &&
    !rating &&
    !genre &&
    !duration &&
    !(seasons !== undefined && seasons > 0) &&
    !flags.length
  )
    return null;
  return (
    <div className="deck-tags vod-detail-tags">
      {year && <span>{year}</span>}
      {rating && (
        <span className="deck-rating" title={t("vod.rating", { rating })}>
          <Icon name="star" />
          {rating}
        </span>
      )}
      {genre && <span dir="auto">{genre}</span>}
      {duration && <span>{duration}</span>}
      {seasons !== undefined && seasons > 0 && (
        <span>{t("vod.seasons", { count: seasons })}</span>
      )}
      {flags.map((flag) => (
        <span className="vod-country-flag" lang="en" key={flag.code}>
          <img
            src={`${import.meta.env.BASE_URL}flags/${flag.code}.svg`}
            alt={flag.name}
            width={28}
            height={21}
          />
        </span>
      ))}
    </div>
  );
}

export function VodDetailSkeleton({
  titleRow,
  poster = "",
  palette,
}: {
  titleRow: ReactNode;
  poster?: string;
  palette?: ArtworkPalette;
}) {
  const { t } = useLocale();
  return (
    <section className="vod-details loading" role="status" aria-label={t("vod.loading")}>
      <VodBackdrop poster={poster} posterPalette={palette} />
      <div className="vod-hero">
        <div className="vod-copy-panel">
          {titleRow}
          <div className="vod-detail-copy-skeleton" aria-hidden="true">
            <span className="skeleton-line medium" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line short" />
          </div>
        </div>
        <span
          className="vod-detail-poster-skeleton"
          aria-hidden="true"
          style={palette ? { background: paletteCss(palette) } : undefined}
        />
      </div>
    </section>
  );
}

export function VodDetails({
  resource,
  title,
  poster = "",
  progress,
  favourite,
  playbackPending = false,
  focus,
  onToggleFavourite,
  onFocusAction,
  onFocusRetry,
  onPlay,
  onOverflowChange,
  onRetry,
}: VodDetailsProps) {
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

  useEffect(() => {
    onOverflowChange?.(false);
  }, [onOverflowChange]);

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
          data-selected={focus.zone === "retry" || undefined}
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

  const minutes = durationMinutes(detail.durationSeconds);
  const actions = movieActions(progress, false);
  const actionLabel = (action: MovieAction) => {
    if (action === "favourite")
      return t(favourite ? "vod.removeFavourite" : "vod.addFavourite");
    if (action === "resume") {
      const resumeMinutes = durationMinutes(progress?.seconds) ?? 0;
      return t("vod.resume", { time: t("vod.minutes", { count: resumeMinutes }) });
    }
    if (action === "restart") return t("vod.restart");
    return t("vod.play");
  };
  const activate = (action: MovieAction) => {
    if (action === "resume") onPlay({ resumeAt: progress?.seconds ?? 0, restart: false });
    else if (action === "restart") onPlay({ resumeAt: 0, restart: true });
    else if (action === "play") onPlay({ resumeAt: 0, restart: false });
    else if (action === "favourite") onToggleFavourite();
  };

  return (
    <section className="vod-details loaded" aria-busy={playbackPending}>
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
              country={detail.metadata.country}
              duration={
                minutes !== undefined ? t("vod.minutes", { count: minutes }) : undefined
              }
            />
            {!!detail.plot && (
              <p className="vod-synopsis" dir="auto">
                {detail.plot}
              </p>
            )}
            <VodCredits cast={detail.metadata.cast} director={detail.metadata.director} />
            {!!detail.metadata.ageRating && (
              <p className="vod-credit" dir="auto">
                {detail.metadata.ageRating}
              </p>
            )}
          </div>
          <div className="vod-actions">
            {actions.map((action, index) => (
              <button
                key={action}
                type="button"
                className={`vod-action ${action === "favourite" ? "vod-favourite" : ""} ${action === "favourite" && favourite ? "on" : ""} ${focus.zone === "actions" && focus.index === index ? "cursor" : ""}`}
                aria-pressed={action === "favourite" ? favourite : undefined}
                disabled={playbackPending}
                onPointerEnter={() => pointerOnly(() => onFocusAction?.(index))}
                onClick={() => {
                  onFocusAction?.(index);
                  activate(action);
                }}
              >
                <Icon
                  name={
                    action === "favourite" ? "star" : action === "restart" ? "refresh" : "play"
                  }
                />
                <Text value={actionLabel(action)} />
              </button>
            ))}
          </div>
        </div>
        <Artwork
          src={detail.logo}
          alt={t("vod.movieArtwork")}
          kind="poster"
          width={192}
          height={288}
          placeholderIcon="movie"
          palette={backdropPalette ?? posterPalette}
          onPalette={handlePosterPalette}
        />
      </div>
    </section>
  );
}
