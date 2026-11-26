import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { activatePointerInput, pointerOnly } from "../../hooks/usePointerAwake";
import { useViewport } from "../../hooks/useViewport";
import { normalizeWheelDelta, useNavigableWindow } from "../../hooks/useWindowed";
import { type ArtworkPalette, paletteCss } from "../../services/artwork";
import type { MessageKey, MessageValues } from "../../services/locale";
import type { XtreamEpisode, XtreamSeasonKey, XtreamSeriesDetail } from "../../services/xtream";
import type { ResolvedPlaybackProgress } from "../../stores/personal";
import { Artwork } from "../Artwork";
import { Icon } from "../Icon";
import { ScrollIndicator } from "../ScrollIndicator";
import { Text } from "../Text";

export const EPISODE_ROW_BASE = 84;

const scrollBehavior = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export const isPlayableEpisode = (
  episode: Pick<XtreamEpisode, "episodeId" | "directSourceFingerprint">,
) => !!episode.episodeId || !!episode.directSourceFingerprint;

export function episodeReference(
  episode: Pick<XtreamEpisode, "season" | "number">,
  translate: (key: MessageKey, values?: MessageValues) => string,
): string {
  if (episode.season !== undefined && episode.number !== undefined) {
    return translate("vod.episodeBoth", { season: episode.season, episode: episode.number });
  }
  if (episode.number !== undefined)
    return translate("vod.episodeOnly", { episode: episode.number });
  if (episode.season !== undefined)
    return translate("vod.seasonOnly", { season: episode.season });
  return translate("vod.selectedEpisode");
}

export interface EpisodeListProps {
  detail: XtreamSeriesDetail;
  seasonCursor: XtreamSeasonKey;
  selectedSeason: XtreamSeasonKey;
  episodeKey: string;
  focusedZone?: "back" | "season" | "episode" | null;
  visible?: boolean;
  disabled?: boolean;
  summaryFocused?: boolean;
  state: "loaded" | "empty";
  nextEpisodeKey?: string;
  progress: readonly ResolvedPlaybackProgress[];
  onSummaryFocus: () => void;
  onFocusSeason: (season: XtreamSeasonKey) => void;
  onCommitSeason: (season: XtreamSeasonKey) => void;
  onFocusEpisode: (episodeKey: string) => void;
  onSelectEpisode: (episode: XtreamEpisode) => void;
  onWheel: (deltaY: number) => void;
}

export function EpisodeList({
  detail,
  seasonCursor,
  selectedSeason,
  episodeKey,
  focusedZone = null,
  visible = true,
  disabled = false,
  summaryFocused = false,
  state,
  nextEpisodeKey,
  progress,
  onSummaryFocus,
  onFocusSeason,
  onCommitSeason,
  onFocusEpisode,
  onSelectEpisode,
  onWheel,
}: EpisodeListProps) {
  const { t, number } = useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const previewCopy = useRef<HTMLDivElement>(null);
  const seasons = useRef<HTMLDivElement>(null);
  const [seasonScroll, setSeasonScroll] = useState({ first: 0, count: 0, visible: 0 });
  const height = useViewport(viewport);
  const episodes = detail.episodes.filter((episode) => episode.seasonKey === selectedSeason);
  const cursor = Math.max(
    0,
    episodes.findIndex((episode) => episode.key === episodeKey),
  );
  const window = useNavigableWindow(episodes.length, cursor, height, 1, EPISODE_ROW_BASE, 2);
  const windowDisplacement = window.start * window.row - window.scrollOffset;
  const selected = episodes[cursor];
  const image = selected?.metadata.image ?? "";
  const currentImage = useRef(image);
  currentImage.current = image;
  const [imagePalette, setImagePalette] = useState<{
    source: string;
    palette: ArtworkPalette;
  } | null>(null);
  const currentPalette = image && imagePalette?.source === image ? imagePalette.palette : null;
  const onPalette = useCallback(
    (palette: ArtworkPalette) => {
      if (image && currentImage.current === image) {
        setImagePalette({ source: image, palette });
      }
    },
    [image],
  );
  const oneUnassignedSeason = detail.seasons.length === 1 && detail.seasons[0] === "unassigned";
  const seasonLabel = (season: XtreamSeasonKey) =>
    season === "unassigned"
      ? t("vod.selectedEpisode")
      : season === 0
        ? t("vod.specials")
        : t("library.season", { number: season });

  const updateSeasonScroll = useCallback(() => {
    if (!detail.seasons.length) return;
    const element = seasons.current;
    if (!element) return;
    setSeasonScroll({
      first: Math.abs(element.scrollLeft),
      count: element.scrollWidth,
      visible: element.clientWidth,
    });
  }, [detail.seasons]);

  useEffect(updateSeasonScroll, [updateSeasonScroll]);

  const selectedEpisodeKey = selected?.key ?? "";
  useEffect(() => {
    if (selectedEpisodeKey && previewCopy.current) previewCopy.current.scrollTop = 0;
  }, [selectedEpisodeKey]);

  useEffect(() => {
    if (!visible) return;
    const visibleSeason = focusedZone === "season" ? seasonCursor : selectedSeason;
    const index = detail.seasons.indexOf(visibleSeason);
    const pill = seasons.current?.children.item(index) as HTMLElement | null;
    pill?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
      behavior: scrollBehavior(),
    });
    updateSeasonScroll();
  }, [detail.seasons, focusedZone, seasonCursor, selectedSeason, updateSeasonScroll, visible]);

  return (
    <aside className="episode-panel">
      {!oneUnassignedSeason && (
        <div className="season-scroll-region">
          <div
            ref={seasons}
            className="season-row"
            role="tablist"
            onScroll={updateSeasonScroll}
            onWheel={(event) => {
              const delta = event.deltaX || event.deltaY;
              if (!delta) return;
              event.preventDefault();
              activatePointerInput();
              seasons.current?.scrollBy({
                left: normalizeWheelDelta(delta, event.deltaMode, seasons.current.clientWidth),
                behavior: scrollBehavior(),
              });
            }}
          >
            {detail.seasons.map((season) => (
              <button
                key={season}
                type="button"
                role="tab"
                className={`season-pill ${selectedSeason === season ? "selected" : ""} ${focusedZone === "season" && seasonCursor === season ? "cursor" : ""}`}
                aria-selected={selectedSeason === season}
                onPointerEnter={() => pointerOnly(() => onFocusSeason(season))}
                onClick={() => onCommitSeason(season)}
              >
                {seasonLabel(season)}
              </button>
            ))}
          </div>
          <ScrollIndicator
            count={seasonScroll.count}
            first={seasonScroll.first}
            visible={seasonScroll.visible}
            orientation="horizontal"
          />
        </div>
      )}
      <div ref={viewport} className="episode-content">
        {!episodes.length || state === "empty" ? (
          <p className="episode-state" role="status">
            {t("vod.noEpisodes")}
          </p>
        ) : (
          <div
            className="episode-list"
            role="listbox"
            onWheel={(event) => {
              window.onWheel(event.deltaY, event.deltaMode);
              onWheel(event.deltaY);
            }}
          >
            <div style={{ transform: `translateY(${windowDisplacement}px)` }}>
              {episodes.slice(window.start, window.end).map((episode) => {
                const saved = progress.find((entry) => entry.itemKey === episode.key);
                const playable = isPlayableEpisode(episode);
                const reference = episodeReference(episode, t);
                const displayNumber =
                  episode.number !== undefined ? number(episode.number) : "\u2014";
                const statusLabel = saved?.seconds
                  ? t("library.resume")
                  : nextEpisodeKey === episode.key
                    ? t("vod.upNext")
                    : undefined;
                return (
                  <button
                    key={episode.key}
                    type="button"
                    className={`episode-row ${focusedZone === "episode" && episode.key === episodeKey ? "cursor" : ""}`}
                    role="option"
                    aria-label={`${reference}, ${episode.name || t("vod.untitled")}${statusLabel ? `, ${statusLabel}` : ""}`}
                    aria-selected={episode.key === episodeKey}
                    aria-disabled={!playable}
                    disabled={disabled}
                    onClick={() => {
                      onFocusEpisode(episode.key);
                      if (playable) onSelectEpisode(episode);
                    }}
                  >
                    <span className="episode-row-content">
                      <span className="episode-reference" aria-hidden="true">
                        {displayNumber}
                      </span>
                      <Text
                        value={episode.name || t("vod.untitled")}
                        className="episode-title"
                        marquee
                        active={episode.key === episodeKey}
                      />
                      <span className="episode-row-tail">
                        {statusLabel ? (
                          <span className="episode-status episode-row-badge">
                            <Icon name={saved?.seconds ? "play" : "next"} />
                            <Text
                              value={statusLabel}
                              className="episode-status-label"
                              marquee
                              active={episode.key === episodeKey}
                            />
                          </span>
                        ) : (
                          episode.durationSeconds !== undefined && (
                            <span className="episode-duration episode-row-badge">
                              <Icon name="time" />
                              {t("vod.minutes", {
                                count: number(Math.round(episode.durationSeconds / 60)),
                              })}
                            </span>
                          )
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <ScrollIndicator
              count={episodes.length}
              first={window.indicatorFirst}
              visible={window.visible}
            />
          </div>
        )}
        {selected && (
          <button
            type="button"
            className={`episode-preview ${summaryFocused ? "cursor" : ""}`}
            aria-label={selected.name || t("vod.untitled")}
            onClick={onSummaryFocus}
          >
            <div
              className="episode-preview-art"
              style={{ background: currentPalette ? paletteCss(currentPalette) : undefined }}
            >
              <Artwork
                src={selected.metadata.image}
                alt={t("vod.episodeArtwork")}
                kind="poster"
                fit="contain"
                width={512}
                height={288}
                placeholderIcon="episode"
                fetchable={visible}
                onPalette={onPalette}
              />
            </div>
            <div className="episode-preview-heading">
              <h3 className="episode-preview-title" dir="auto">
                {selected.name || t("vod.untitled")}
              </h3>
              {(selected.durationSeconds !== undefined ||
                !!selected.metadata.rating ||
                !!selected.metadata.releaseDate) && (
                <div className="episode-preview-meta">
                  {selected.durationSeconds !== undefined && (
                    <span className="episode-meta-badge">
                      <Icon name="time" />
                      {t("vod.minutes", {
                        count: number(Math.round(selected.durationSeconds / 60)),
                      })}
                    </span>
                  )}
                  {!!selected.metadata.rating && (
                    <span className="episode-meta-badge rating">
                      <Icon name="star" />
                      {selected.metadata.rating}
                    </span>
                  )}
                  {selected.metadata.releaseDate && (
                    <span className="episode-meta-badge" dir="auto">
                      <Icon name="guide" />
                      {selected.metadata.releaseDate}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div ref={previewCopy} className="episode-preview-copy">
              {selected.metadata.plot && <p dir="auto">{selected.metadata.plot}</p>}
            </div>
          </button>
        )}
      </div>
    </aside>
  );
}
