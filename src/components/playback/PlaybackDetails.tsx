import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { KEY } from "../../hooks/useRemote";
import {
  artworkOf,
  paletteCss,
  peekArtworkPalette,
  POSTER_BOX,
  QUIET_NEUTRAL_PALETTE,
  type ArtworkPalette,
} from "../../services/artwork";
import { resolveCountryFlags } from "../../services/countryFlags";
import type { XtreamMovieDetail, XtreamSeriesDetail } from "../../services/xtream";
import type { PlaybackTarget } from "../../types";
import { Artwork } from "../Artwork";
import { KeyGuide } from "../KeyGuide";
import { ScrollIndicator } from "../ScrollIndicator";
import { episodeReference } from "../vod/EpisodeList";
import { VodCredits } from "../vod/VodCredits";
import { VodDetailTags } from "../vod/VodDetails";

export interface PlaybackDetailsProps {
  target: PlaybackTarget;
  movie?: XtreamMovieDetail;
  series?: XtreamSeriesDetail;
  durationSeconds?: number;
  onClose(): void;
  inputEnabled?: boolean;
}

type DetailsArtwork = {
  id: "poster" | "image";
  url: string;
  label: string;
  portrait: boolean;
};

export function PlaybackDetails(props: PlaybackDetailsProps) {
  return (
    <PlaybackDetailsContent key={`${props.target.playlistId}:${props.target.id}`} {...props} />
  );
}

function PlaybackDetailsContent({
  target,
  movie,
  series,
  durationSeconds,
  onClose,
  inputEnabled = true,
}: PlaybackDetailsProps) {
  const { t, number, direction } = useLocale();
  const episodePlayback = target.kind === "episode";
  const episode = episodePlayback
    ? series?.episodes.find((item) => item.key === target.id)
    : undefined;
  const title =
    (episodePlayback ? episode?.name || target.progress?.name : movie?.name) || target.name;
  const parentName = series?.name || target.progress?.parentName || "";
  const reference = episodePlayback
    ? episodeReference(
        {
          season: episode?.season ?? target.progress?.season,
          number: episode?.number ?? target.progress?.episode,
        },
        t,
      )
    : "";
  const date = episodePlayback
    ? episode?.metadata.releaseDate
    : movie?.metadata.releaseDate || movie?.releaseDate || movie?.year || target.year;
  const seconds =
    (episodePlayback
      ? (episode?.durationSeconds ?? episode?.metadata.durationSeconds)
      : movie?.durationSeconds) ?? durationSeconds;
  const duration =
    seconds !== undefined && seconds > 0
      ? t("vod.minutes", { count: number(Math.max(1, Math.round(seconds / 60))) })
      : undefined;
  const rating = episodePlayback
    ? episode?.metadata.rating
    : movie?.metadata.rating || movie?.rating || target.rating;
  const poster = movie?.logo || series?.logo || target.logo;
  const backdrop = episodePlayback
    ? episode?.metadata.image || series?.metadata.backdrops[0]
    : movie?.metadata.backdrops[0];
  const synopsis = episodePlayback ? episode?.metadata.plot : movie?.plot;
  const mainGenre = !episodePlayback ? movie?.metadata.genre || movie?.genre : undefined;
  const movieCountry = !episodePlayback ? movie?.metadata.country : undefined;
  const movieAgeRating = !episodePlayback ? movie?.metadata.ageRating : undefined;
  const seriesDate = series?.metadata.releaseDate || series?.releaseDate || series?.year;
  const seriesRating = series?.metadata.rating || series?.rating;
  const seriesGenre = series?.metadata.genre || series?.genre;
  const seriesCast = series
    ? series.metadata.cast.length
      ? series.metadata.cast
      : series.cast
        ? [series.cast]
        : []
    : [];
  const seriesDirector = series?.metadata.director || series?.director;
  const showSeries = !!(
    seriesDate ||
    seriesRating ||
    seriesGenre ||
    resolveCountryFlags(series?.metadata.country).length ||
    series?.metadata.ageRating ||
    series?.plot ||
    seriesCast.length ||
    seriesDirector
  );
  const posterLabel = t("vod.poster");
  const imageLabel = t(episode?.metadata.image ? "vod.episodeArtwork" : "vod.backdrop");
  const artworks = useMemo<DetailsArtwork[]>(
    () => [
      ...(poster
        ? [{ id: "poster" as const, url: poster, label: posterLabel, portrait: true }]
        : []),
      ...(backdrop && backdrop !== poster
        ? [{ id: "image" as const, url: backdrop, label: imageLabel, portrait: false }]
        : []),
    ],
    [poster, backdrop, posterLabel, imageLabel],
  );
  const dialogRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const artworkRailRef = useRef<HTMLDivElement>(null);
  const artworkRefs = useRef<Partial<Record<DetailsArtwork["id"], HTMLButtonElement>>>({});
  const viewerRef = useRef<HTMLButtonElement>(null);
  const [viewing, setViewing] = useState<DetailsArtwork | null>(null);
  const [imagePalette, setImagePalette] = useState<{
    url: string;
    palette: ArtworkPalette;
  } | null>(null);
  const paletteSource = viewing?.url || poster || backdrop;
  const portraitPalette = viewing ? viewing.portrait : !!poster;
  const paletteRequest = paletteSource
    ? {
        url: paletteSource,
        kind: "poster" as const,
        width: portraitPalette ? POSTER_BOX.width : 320,
        height: portraitPalette ? POSTER_BOX.height : 180,
      }
    : null;
  const cachedArtwork = paletteRequest
    ? (artworkOf({ ...paletteRequest, fit: "contain" }) ?? artworkOf(paletteRequest))
    : null;
  const palette =
    (imagePalette?.url === paletteSource ? imagePalette?.palette : undefined) ??
    (cachedArtwork ? peekArtworkPalette(cachedArtwork.bitmap) : undefined) ??
    QUIET_NEUTRAL_PALETTE;
  const rememberPalette = useCallback(
    (next: ArtworkPalette) => {
      if (!paletteSource) return;
      setImagePalette((previous) =>
        previous?.url === paletteSource && previous.palette === next
          ? previous
          : { url: paletteSource, palette: next },
      );
    },
    [paletteSource],
  );
  const [focusedArtwork, setFocusedArtwork] = useState<DetailsArtwork["id"] | null>(null);
  const focusedArtworkRef = useRef<DetailsArtwork["id"] | null>(null);
  const savedScroll = useRef({ copy: 0, artwork: 0, artworkLeft: 0 });
  const restoreScroll = useRef(false);
  const [scroll, setScroll] = useState({ height: 0, content: 0, top: 0 });
  const measure = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const next = {
      height: element.clientHeight,
      content: element.scrollHeight,
      top: element.scrollTop,
    };
    setScroll((previous) =>
      previous.height === next.height &&
      previous.content === next.content &&
      previous.top === next.top
        ? previous
        : next,
    );
  }, []);
  const rememberFocus = useCallback((id: DetailsArtwork["id"] | null) => {
    focusedArtworkRef.current = id;
    setFocusedArtwork(id);
  }, []);
  const focusCopy = useCallback(() => viewportRef.current?.focus(), []);
  const focusArtwork = useCallback(
    (id: DetailsArtwork["id"]) => artworkRefs.current[id]?.focus(),
    [],
  );
  const openArtwork = useCallback(
    (artwork: DetailsArtwork) => {
      if (!inputEnabled) return;
      savedScroll.current = {
        copy: viewportRef.current?.scrollTop ?? 0,
        artwork: artworkRailRef.current?.scrollTop ?? 0,
        artworkLeft: artworkRailRef.current?.scrollLeft ?? 0,
      };
      rememberFocus(artwork.id);
      setViewing(artwork);
    },
    [inputEnabled, rememberFocus],
  );
  const closeCurrent = useCallback(() => {
    if (!inputEnabled) return;
    if (viewing) {
      restoreScroll.current = true;
      setViewing(null);
    } else {
      onClose();
    }
  }, [inputEnabled, onClose, viewing]);

  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!inputEnabled) {
      if (active instanceof HTMLElement && dialogRef.current?.contains(active)) active.blur();
      return;
    }
    if (viewing) {
      viewerRef.current?.focus();
      return;
    }
    if (restoreScroll.current) {
      restoreScroll.current = false;
      if (viewportRef.current) viewportRef.current.scrollTop = savedScroll.current.copy;
      if (artworkRailRef.current) {
        artworkRailRef.current.scrollTop = savedScroll.current.artwork;
        artworkRailRef.current.scrollLeft = savedScroll.current.artworkLeft;
      }
    }
    const id = focusedArtworkRef.current;
    if (id && artworks.some((artwork) => artwork.id === id)) focusArtwork(id);
    else focusCopy();
    measure();
  }, [inputEnabled, viewing, artworks, focusArtwork, focusCopy, measure]);

  useEffect(() => {
    if (viewing) return;
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, viewing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!inputEnabled || event.defaultPrevented) return;
      const code = event.keyCode;
      const vertical = code === KEY.UP || code === KEY.DOWN;
      const horizontal = code === KEY.LEFT || code === KEY.RIGHT;
      const dismiss = code === KEY.BACK || code === KEY.ESC;
      if (!vertical && !horizontal && !dismiss && code !== KEY.ENTER && code !== 9) return;
      event.preventDefault();
      if (code === KEY.ENTER && event.repeat) return;
      if (viewing) {
        if (dismiss || code === KEY.ENTER) closeCurrent();
        else if (code === 9) viewerRef.current?.focus();
        return;
      }
      if (dismiss) {
        closeCurrent();
        return;
      }
      const id = focusedArtworkRef.current;
      const at = artworks.findIndex((artwork) => artwork.id === id);
      if (code === KEY.ENTER) {
        if (at >= 0) openArtwork(artworks[at]);
        else closeCurrent();
      } else if (code === 9) {
        const current = at + 1;
        const next =
          (current + (event.shiftKey ? -1 : 1) + artworks.length + 1) % (artworks.length + 1);
        if (!next) focusCopy();
        else focusArtwork(artworks[next - 1].id);
      } else if (horizontal) {
        const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
        if (code === inlineStart && at < 0 && artworks.length) focusArtwork(artworks[0].id);
        else if (code !== inlineStart && at >= 0) focusCopy();
      } else if (at >= 0) {
        const next = Math.max(
          0,
          Math.min(artworks.length - 1, at + (code === KEY.DOWN ? 1 : -1)),
        );
        focusArtwork(artworks[next].id);
      } else {
        const element = viewportRef.current;
        if (!element) return;
        const step = Math.max(1, Math.round(element.clientHeight * 0.6));
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
        element.scrollTop = Math.max(
          0,
          Math.min(maximum, element.scrollTop + (code === KEY.DOWN ? step : -step)),
        );
        measure();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    inputEnabled,
    viewing,
    artworks,
    direction,
    closeCurrent,
    openArtwork,
    focusArtwork,
    focusCopy,
    measure,
  ]);

  const overflowing = scroll.content > scroll.height && scroll.height > 0;
  return (
    <div className="playback-details-layer" onClick={closeCurrent}>
      <section
        ref={dialogRef}
        className="playback-details"
        style={{ background: paletteCss(palette) }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={viewing ? undefined : "playback-details-title"}
        aria-label={viewing ? `${title}, ${viewing.label}` : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {viewing ? (
          <button
            ref={viewerRef}
            type="button"
            className="playback-details-viewer"
            aria-label={`${t("common.back")}, ${viewing.label}`}
            tabIndex={inputEnabled ? 0 : -1}
            disabled={!inputEnabled}
            onClick={closeCurrent}
          >
            <Artwork
              src={viewing.url}
              alt={`${title}, ${viewing.label}`}
              kind="poster"
              width={1280}
              height={720}
              fit="contain"
              className="playback-details-viewer-image"
              palette={palette}
              onPalette={rememberPalette}
              placeholderIcon={episodePlayback ? "episode" : "movie"}
            />
          </button>
        ) : (
          <>
            <header className="playback-details-head">
              <span className="playback-details-label">{t("library.details")}</span>
            </header>
            <div className="playback-details-body">
              {!!artworks.length && (
                <div ref={artworkRailRef} className="playback-details-artworks">
                  {artworks.map((artwork) => (
                    <button
                      key={artwork.id}
                      ref={(element) => {
                        if (element) artworkRefs.current[artwork.id] = element;
                        else delete artworkRefs.current[artwork.id];
                      }}
                      type="button"
                      className="playback-details-artwork"
                      data-artwork={artwork.id}
                      data-selected={
                        (inputEnabled && focusedArtwork === artwork.id) || undefined
                      }
                      disabled={!inputEnabled}
                      aria-label={`${t("common.open")}, ${artwork.label}`}
                      onFocus={() => rememberFocus(artwork.id)}
                      onPointerEnter={() =>
                        pointerOnly(() => {
                          if (inputEnabled) focusArtwork(artwork.id);
                        })
                      }
                      onClick={() => openArtwork(artwork)}
                    >
                      <span
                        className={`playback-details-artwork-frame${artwork.portrait ? " portrait" : ""}`}
                      >
                        <Artwork
                          src={artwork.url}
                          alt={`${title}, ${artwork.label}`}
                          kind="poster"
                          width={artwork.portrait ? POSTER_BOX.width : 320}
                          height={artwork.portrait ? POSTER_BOX.height : 180}
                          fit="contain"
                          className="playback-details-artwork-image"
                          onPalette={
                            artwork.url === paletteSource ? rememberPalette : undefined
                          }
                          placeholderIcon={episodePlayback ? "series" : "movie"}
                        />
                      </span>
                      <span className="playback-details-artwork-caption">{artwork.label}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="playback-details-reading">
                <div
                  ref={viewportRef}
                  className="playback-details-scroll"
                  role="document"
                  aria-label={t("library.details")}
                  tabIndex={inputEnabled ? 0 : -1}
                  onFocus={() => rememberFocus(null)}
                  onPointerEnter={() =>
                    pointerOnly(() => {
                      if (inputEnabled) focusCopy();
                    })
                  }
                  onScroll={measure}
                >
                  <div ref={contentRef} className="playback-details-copy">
                    {episodePlayback ? (
                      <p className="playback-details-context">
                        {parentName && <span dir="auto">{parentName}</span>}
                        <span>{reference}</span>
                      </p>
                    ) : target.group ? (
                      <p className="playback-details-context" dir="auto">
                        {target.group}
                      </p>
                    ) : null}
                    <h1 id="playback-details-title" dir="auto">
                      {title}
                    </h1>
                    <VodDetailTags
                      year={date}
                      rating={rating}
                      genre={mainGenre}
                      duration={duration}
                      country={movieCountry}
                    />
                    {movieAgeRating && (
                      <div className="deck-tags vod-detail-tags playback-details-extra">
                        <span dir="auto">{movieAgeRating}</span>
                      </div>
                    )}
                    {synopsis && (
                      <p className="playback-details-synopsis" dir="auto">
                        {synopsis}
                      </p>
                    )}
                    {!episodePlayback && movie && (
                      <VodCredits
                        cast={
                          movie.metadata.cast.length
                            ? movie.metadata.cast
                            : movie.cast
                              ? [movie.cast]
                              : []
                        }
                        director={movie.metadata.director || movie.director}
                      />
                    )}
                    {episodePlayback && series && showSeries && (
                      <section
                        className="playback-details-series"
                        aria-label={t("content.series")}
                      >
                        <p className="playback-details-label">{t("content.series")}</p>
                        <h2 dir="auto">{series.name}</h2>
                        <VodDetailTags
                          year={seriesDate}
                          rating={seriesRating}
                          genre={seriesGenre}
                          country={series.metadata.country}
                        />
                        {series.metadata.ageRating && (
                          <div className="deck-tags vod-detail-tags playback-details-extra">
                            <span dir="auto">{series.metadata.ageRating}</span>
                          </div>
                        )}
                        {series.plot && (
                          <p className="playback-details-synopsis" dir="auto">
                            {series.plot}
                          </p>
                        )}
                        <VodCredits cast={seriesCast} director={seriesDirector} />
                      </section>
                    )}
                  </div>
                </div>
                <ScrollIndicator
                  count={scroll.content}
                  first={scroll.top}
                  visible={scroll.height}
                />
              </div>
            </div>
          </>
        )}
        <footer className="playback-details-footer">
          <KeyGuide
            className="playback-details-hints"
            items={
              viewing
                ? [{ keys: ["OK", "Return"], label: t("common.back") }]
                : focusedArtwork
                  ? [
                      {
                        keys:
                          artworks.length > 1
                            ? ["\u2190", "\u2192", "\u2191", "\u2193"]
                            : ["\u2190", "\u2192"],
                        label: t("common.move"),
                      },
                      { keys: ["OK"], label: t("common.open") },
                      { keys: ["Return"], label: t("common.close") },
                    ]
                  : [
                      ...(overflowing
                        ? [{ keys: ["\u2191", "\u2193"], label: t("common.scroll") }]
                        : []),
                      ...(artworks.length
                        ? [{ keys: ["\u2190", "\u2192"], label: t("common.move") }]
                        : []),
                      { keys: ["OK", "Return"], label: t("common.close") },
                    ]
            }
          />
        </footer>
      </section>
    </div>
  );
}
