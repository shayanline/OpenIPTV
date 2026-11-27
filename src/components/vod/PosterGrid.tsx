import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { pointerInputActive, pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { useViewport } from "../../hooks/useViewport";
import {
  POSTER_CARD_ROW_BASE,
  POSTER_OVERSCAN_ROWS,
  useNavigableWindow,
} from "../../hooks/useWindowed";
import type { LibraryItem, LibraryResource } from "../../stores/library";
import {
  type ArtworkRequest,
  claimArtwork,
  loadArtwork,
  POSTER_BOX,
  releaseArtwork,
} from "../../services/artwork";
import { cssEnterEasing } from "../../services/metrics";
import { Artwork } from "../Artwork";
import { Icon } from "../Icon";
import { ScrollIndicator } from "../ScrollIndicator";
import { Text } from "../Text";

export interface PosterItem {
  key: string;
  kind: "movie" | "series";
  title: string;
  poster: string;
  metadata: string;
  rating: string;
  favourite: boolean;
  progressPercent?: number;
}

const POSTER_SKELETONS = Array.from({ length: 18 }, (_, index) => String(index));
interface PosterCellProps {
  item: PosterItem;
  index: number;
  column: number;
  id: string;
  selected: boolean;
  fetchable: boolean;
  t: ReturnType<typeof useLocale>["t"];
  onFocus: (index: number) => void;
  onActivate: (itemKey: string, index: number) => void;
}

const PosterCell = memo(function PosterCell({
  item,
  index,
  column,
  id,
  selected,
  fetchable,
  t,
  onFocus,
  onActivate,
}: PosterCellProps) {
  const rating = item.rating ? t("vod.rating", { rating: item.rating }) : "";
  const favourite = item.favourite ? t("vod.inFavourites") : "";
  const label = [item.title || t("vod.untitled"), item.metadata, rating, favourite]
    .filter(Boolean)
    .join(", ");
  return (
    // biome-ignore lint/a11y/useSemanticElements: The grid owns focus through this active descendant.
    <div
      id={id}
      role="gridcell"
      tabIndex={-1}
      className="poster-grid-cell"
      aria-colindex={column}
      aria-selected={selected}
      aria-label={label}
    >
      <button
        type="button"
        tabIndex={-1}
        className={`poster-card ${selected ? "cursor" : ""}`}
        data-poster-index={index}
        aria-label={label}
        onPointerEnter={() => pointerOnly(() => onFocus(index))}
        onClick={() => {
          onFocus(index);
          onActivate(item.key, index);
        }}
      >
        <span className="poster-art">
          <Artwork
            src={item.poster}
            alt={item.kind === "movie" ? t("vod.movieArtwork") : t("vod.seriesArtwork")}
            kind="poster"
            width={192}
            height={288}
            placeholderIcon={item.kind}
            fetchable={fetchable}
          />
          {item.favourite && (
            <span className="poster-favourite" aria-hidden="true">
              <Icon name="star" />
            </span>
          )}
          {item.progressPercent !== undefined && (
            <span
              className="poster-progress"
              style={{
                width: `${Math.max(0, Math.min(100, item.progressPercent))}%`,
              }}
            />
          )}
        </span>
        <Text
          value={item.title || t("vod.untitled")}
          className="poster-title"
          marquee
          active={selected}
        />
        <span className="poster-meta">
          {item.metadata}
        </span>
        {item.rating && (
          <span className="poster-rating" title={rating}>
            <Icon name="star" />
            {item.rating}
          </span>
        )}
      </button>
    </div>
  );
});

export interface PosterGridProps {
  items: readonly PosterItem[];
  itemOffset?: number;
  totalItems?: number;
  resourceState: LibraryResource<LibraryItem[]>["state"];
  cursor: number;
  firstRow: number;
  windowKey?: string;
  focused: boolean;
  fetchReady: boolean;
  artworkActive: boolean;
  scale: number;
  columns: number;
  onFocus: (index: number) => void;
  onActivate: (itemKey: string, index: number) => void;
  onRetry: () => void;
  onWheel: (deltaY: number) => void;
  onWindowChange?: (firstRow: number, visibleRows: number) => void;
  ariaLabelledBy?: string;
}

export function PosterGrid({
  items,
  itemOffset = 0,
  totalItems = items.length,
  resourceState,
  cursor,
  firstRow,
  windowKey,
  focused,
  fetchReady,
  artworkActive,
  scale,
  columns,
  onFocus,
  onActivate,
  onRetry,
  onWheel,
  onWindowChange,
  ariaLabelledBy,
}: PosterGridProps) {
  const { t } = useLocale();
  const gridId = useId();
  const region = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const preparedPosters = useRef(new Map<string, ArtworkRequest>());
  const callbacks = useRef({ onFocus, onActivate });
  callbacks.current = { onFocus, onActivate };
  const focusPoster = useCallback((index: number) => callbacks.current.onFocus(index), []);
  const activatePoster = useCallback(
    (key: string, index: number) => callbacks.current.onActivate(key, index),
    [],
  );
  const height = useViewport(region, true);
  const rows = Math.ceil(items.length / columns);
  const posterWindow = useNavigableWindow(
    rows,
    Math.floor(cursor / columns),
    height,
    scale,
    POSTER_CARD_ROW_BASE,
    POSTER_OVERSCAN_ROWS,
    firstRow,
    windowKey,
  );
  const itemStart = posterWindow.start * columns;
  const itemEnd = Math.min(items.length, posterWindow.end * columns);
  const activeIndex = cursor >= itemStart && cursor < itemEnd ? cursor : itemStart;
  const preparationSignature = useMemo(() => {
    const nearbyUrls: string[] = [];
    for (
      let index = posterWindow.first * columns;
      index < itemEnd && nearbyUrls.length < 18;
      index += 1
    ) {
      const url = items[index].poster;
      if (url && !nearbyUrls.includes(url)) nearbyUrls.push(url);
    }
    return JSON.stringify(nearbyUrls);
  }, [columns, itemEnd, items, posterWindow.first]);
  const [settledPreparation, setSettledPreparation] = useState(preparationSignature);
  const preparationReady = settledPreparation === preparationSignature;
  const previousFirst = useRef(posterWindow.first);
  const previousWindowKey = useRef(windowKey);
  const scrollAnimation = useRef<Animation | null>(null);
  const scrollEasing = useRef("");
  const motionPreference = useRef<MediaQueryList | null>(null);
  const cancelScroll = useCallback(() => {
    scrollAnimation.current?.cancel();
    scrollAnimation.current = null;
  }, []);
  const regionStyle = { "--poster-columns": columns } as CSSProperties;
  const windowDisplacement = posterWindow.start * posterWindow.row - posterWindow.scrollOffset;

  useEffect(() => {
    if (!artworkActive || resourceState !== "loaded" || preparationReady) return;
    const timer = window.setTimeout(() => setSettledPreparation(preparationSignature), 120);
    return () => window.clearTimeout(timer);
  }, [artworkActive, resourceState, preparationReady, preparationSignature]);

  useEffect(() => {
    const previous = preparedPosters.current;
    const urls: string[] =
      artworkActive && resourceState === "loaded" ? JSON.parse(preparationSignature) : [];
    const next = new Map<string, ArtworkRequest>();
    for (const url of urls) {
      const retained = previous.get(url);
      if (preparationReady || retained) {
        next.set(url, retained ?? { url, kind: "poster", ...POSTER_BOX });
      }
    }
    for (const [url, request] of next) {
      if (!previous.has(url)) claimArtwork(request);
    }
    for (const [url, request] of previous) {
      if (!next.has(url)) releaseArtwork(request);
    }
    preparedPosters.current = next;
    for (const [url, request] of next) {
      if (!previous.has(url)) void loadArtwork({ ...request, eager: false });
    }
  }, [artworkActive, resourceState, preparationSignature, preparationReady]);

  useEffect(
    () => () => {
      for (const request of preparedPosters.current.values()) releaseArtwork(request);
      preparedPosters.current.clear();
    },
    [],
  );

  useLayoutEffect(() => {
    // Motion tokens are constant, so navigation never needs a computed style read.
    scrollEasing.current = cssEnterEasing();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    motionPreference.current = motion;
    const onMotion = () => {
      if (motion.matches) cancelScroll();
    };
    motion.addListener(onMotion);
    // CSS cannot disable an owned Web Animations effect when input mode changes.
    const inputObserver = new MutationObserver(() => {
      if (pointerInputActive()) cancelScroll();
    });
    inputObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-input-mode"],
    });
    return () => {
      motion.removeListener(onMotion);
      inputObserver.disconnect();
      cancelScroll();
    };
  }, [cancelScroll]);

  useLayoutEffect(() => {
    const element = grid.current;
    const previous = previousFirst.current;
    const identityChanged = previousWindowKey.current !== windowKey;
    previousFirst.current = posterWindow.first;
    previousWindowKey.current = windowKey;
    if (
      !element ||
      resourceState !== "loaded" ||
      identityChanged ||
      posterWindow.pointerMode ||
      motionPreference.current?.matches
    ) {
      cancelScroll();
      return;
    }
    if (previous === posterWindow.first) return;
    const start = windowDisplacement + (posterWindow.first - previous) * posterWindow.row;
    cancelScroll();
    scrollAnimation.current = element.animate(
      [
        { transform: `translateY(${start}px)` },
        { transform: `translateY(${windowDisplacement}px)` },
      ],
      { duration: 120, easing: scrollEasing.current },
    );
  }, [
    cancelScroll,
    posterWindow.first,
    posterWindow.pointerMode,
    posterWindow.row,
    resourceState,
    windowDisplacement,
    windowKey,
  ]);

  useEffect(() => {
    if (height > 0) onWindowChange?.(posterWindow.first, posterWindow.visible);
  }, [height, onWindowChange, posterWindow.first, posterWindow.visible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Cursor movement reclaims grid focus after a pointer focuses a child button.
  useLayoutEffect(() => {
    if (!focused) return;
    const target =
      resourceState === "failed"
        ? region.current?.querySelector<HTMLButtonElement>(".vod-retry")
        : grid.current;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [cursor, focused, resourceState]);

  if (resourceState === "failed") {
    return (
      <section ref={region} className="poster-grid-region failed" style={regionStyle}>
        <span className="vod-error-icon" aria-hidden="true">
          <Icon name="warn" />
        </span>
        <p className="vod-error-message">{t("vod.failed")}</p>
        <button
          type="button"
          className="vod-retry"
          data-selected={focused || undefined}
          onClick={onRetry}
        >
          <Icon name="refresh" />
          <span>{t("vod.retry")}</span>
        </button>
      </section>
    );
  }
  if (resourceState === "empty") {
    return (
      <section
        ref={region}
        className="poster-grid-region empty"
        style={regionStyle}
        role="status"
      >
        {t("vod.empty")}
      </section>
    );
  }
  if (resourceState === "loading" || resourceState === "idle") {
    return (
      <section
        ref={region}
        className="poster-grid-region loading"
        style={regionStyle}
        role="status"
      >
        <span className="visually-hidden">{t("vod.loading")}</span>
        <div className="poster-skeletons" aria-hidden="true">
          {POSTER_SKELETONS.map((key) => (
            <span key={key} className="poster-skeleton-card">
              <span className="poster-skeleton" />
              <span className="poster-skeleton-title" />
              <span className="poster-skeleton-meta" />
            </span>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      ref={region}
      className={`poster-grid-region ${focused ? "focused" : ""}`}
      style={regionStyle}
      aria-labelledby={ariaLabelledBy}
      onWheel={(event) => {
        event.preventDefault();
        if (!posterWindow.onWheel(event.deltaY, event.deltaMode)) onWheel(event.deltaY);
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: Virtual poster rows use the ARIA grid focus model. */}
      <div
        ref={grid}
        className="poster-grid"
        role="grid"
        tabIndex={0}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabelledBy ? undefined : t("vod.all")}
        aria-rowcount={Math.ceil(totalItems / columns)}
        aria-colcount={columns}
        aria-activedescendant={
          focused && itemEnd > itemStart ? `${gridId}-${activeIndex}` : undefined
        }
        onFocus={(event) => {
          if (event.target === event.currentTarget && !focused) onFocus(activeIndex);
        }}
        style={{ transform: `translateY(${windowDisplacement}px)` }}
      >
        {Array.from({ length: posterWindow.end - posterWindow.start }, (_, rowOffset) => {
          const rowIndex = posterWindow.start + rowOffset;
          const rowStart = rowIndex * columns;
          const rowEnd = Math.min(rowStart + columns, itemEnd);
          const cells = [];
          for (let index = rowStart; index < rowEnd; index += 1) {
            const item = items[index];
            const offset = index - rowStart;
            cells.push(
              <PosterCell
                key={offset}
                id={`${gridId}-${index}`}
                item={item}
                index={index}
                column={offset + 1}
                selected={focused && cursor === index}
                fetchable={
                  fetchReady &&
                  artworkActive &&
                  (preparationReady || preparedPosters.current.has(item.poster))
                }
                t={t}
                onFocus={focusPoster}
                onActivate={activatePoster}
              />,
            );
          }
          return (
            // biome-ignore lint/a11y/useSemanticElements: This row belongs to the virtual ARIA grid.
            <div
              key={rowIndex % posterWindow.slots}
              role="row"
              tabIndex={-1}
              className="poster-grid-row"
              aria-rowindex={Math.floor((itemOffset + rowStart) / columns) + 1}
            >
              {cells}
            </div>
          );
        })}
      </div>
      <ScrollIndicator
        count={Math.ceil(items.length / columns)}
        first={posterWindow.indicatorFirst}
        visible={posterWindow.visible}
      />
    </section>
  );
}
