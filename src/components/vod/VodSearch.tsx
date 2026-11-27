import { useEffect, useId, useRef } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { LibraryItem, LibraryResource } from "../../stores/library";
import { Icon } from "../Icon";
import { NavigationGuide } from "../KeyGuide";
import { SearchField } from "../SearchField";
import { PosterGrid, type PosterGridProps, type PosterItem } from "./PosterGrid";

export interface VodSearchProps {
  kind: "movie" | "series";
  query: string;
  appliedQuery: string;
  fieldFocused: boolean;
  submitFocused: boolean;
  results: LibraryResource<LibraryItem[]>;
  items: readonly PosterItem[];
  total: number;
  catalogueEmpty: boolean;
  onFieldFocus: () => void;
  onSubmitFocus: () => void;
  onRetryFocus: () => void;
  onRetry: () => void;
  grid: Omit<PosterGridProps, "items" | "resourceState">;
  onQuery: (value: string) => void;
  onSubmit: () => void;
  onExitUp: () => void;
  onExitDown: () => void;
  onExitStart: () => void;
  onExitEnd: () => void;
  onDismissKeyboard: () => void;
}

export function VodSearch({
  kind,
  query,
  appliedQuery,
  fieldFocused,
  submitFocused,
  results,
  items,
  total,
  catalogueEmpty,
  onFieldFocus,
  onSubmitFocus,
  onRetryFocus,
  onRetry,
  grid,
  onQuery,
  onSubmit,
  onExitUp,
  onExitDown,
  onExitStart,
  onExitEnd,
  onDismissKeyboard,
}: VodSearchProps) {
  const { t } = useLocale();
  const submit = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const scope = t(kind === "movie" ? "content.movies" : "content.series");
  const submitted = !!appliedQuery.trim();
  const loading = submitted && (results.state === "loading" || results.state === "idle");
  const failed = submitted && results.state === "failed";
  const empty = submitted && results.state === "empty" && !items.length;
  const showGrid = submitted && !loading && !failed && !empty;
  const busy = loading && query === appliedQuery;
  const tooLarge = results.error === "too-large";
  const title = !submitted || (empty && catalogueEmpty)
    ? `${t("common.search")} ${scope}`
    : loading
      ? t("vod.searching")
      : failed
        ? t("vod.searchFailed")
        : t("vod.noResults", { query: appliedQuery });
  const message = !submitted
    ? t("vod.searchHint")
    : failed
      ? t(tooLarge ? "vod.tooLarge" : "vod.searchFailedHint")
      : empty
        ? t(catalogueEmpty ? "vod.searchEmptyCatalogue" : "vod.searchEmptyHint")
        : "";

  useEffect(() => {
    if (submitFocused) submit.current?.focus();
  }, [submitFocused]);
  useEffect(() => {
    if (failed && grid.focused) retry.current?.focus();
  }, [failed, grid.focused]);

  return (
    <section
      className="vod-search"
      aria-label={`${t("common.search")} ${scope}`}
      aria-busy={loading}
    >
      <div className="vod-search-bar">
        <SearchField
          value={query}
          focused={fieldFocused}
          shown={items.length}
          total={total}
          showCount={submitted && !loading && !failed && appliedQuery === query}
          placeholder={`${t("common.search")} ${scope}`}
          ariaLabel={`${t("common.search")} ${scope}`}
          onChange={onQuery}
          onFocus={onFieldFocus}
          onSubmit={onSubmit}
          onExitUp={onExitUp}
          onExitDown={onExitDown}
          onExitStart={onExitStart}
          onExitEnd={onExitEnd}
          onDismissKeyboard={onDismissKeyboard}
        />
        <button
          ref={submit}
          type="button"
          className={`vod-search-submit ${submitFocused ? "cursor" : ""}`}
          disabled={!query.trim()}
          aria-disabled={busy || !query.trim()}
          onFocus={onSubmitFocus}
          onClick={() => {
            if (!busy) onSubmit();
          }}
        >
          <Icon name="search" />
          <span>{t("common.search")}</span>
        </button>
      </div>
      {submitted && query !== appliedQuery && (
        <p className="vod-search-notice" role="status">
          {t("vod.searchDraft", { query: appliedQuery })}
        </p>
      )}
      {showGrid && results.stale && (
        <p className="vod-search-notice" role="status">
          {t("vod.searchCached")}
        </p>
      )}
      {showGrid ? (
        <PosterGrid {...grid} items={items} resourceState={results.state} />
      ) : (
        <div className="vod-search-state" role="status" aria-atomic="true">
          {loading ? (
            <div className="spinner" aria-hidden="true" />
          ) : (
            <span className="vod-error-icon" aria-hidden="true">
              <Icon name={failed ? "warn" : "search"} />
            </span>
          )}
          <h2>{title}</h2>
          {message && <p id={descriptionId}>{message}</p>}
          {failed && (
            <button
              ref={retry}
              type="button"
              className="vod-retry"
              data-selected={grid.focused || undefined}
              aria-describedby={descriptionId}
              onFocus={onRetryFocus}
              onClick={onRetry}
            >
              <Icon name={tooLarge ? kind : "refresh"} />
              <span>{t(tooLarge ? "vod.browseCategories" : "vod.retry")}</span>
            </button>
          )}
        </div>
      )}
      <NavigationGuide className="page-key-guide vod-search-key-guide" />
    </section>
  );
}
