import { useEffect, useId, useRef } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { LibraryItem, LibraryResource } from "../../stores/library";
import { Icon } from "../Icon";
import { NavigationGuide, type Guide } from "../KeyGuide";
import { SearchField } from "../SearchField";
import { SearchState } from "../SearchState";
import { Sidebar } from "../Sidebar";
import { PosterGrid, type PosterGridProps, type PosterItem } from "./PosterGrid";

export interface VodSearchProps {
  kind: "movie" | "series";
  query: string;
  appliedQuery: string;
  fieldFocused: boolean;
  keyboardOpen?: boolean;
  submitFocused: boolean;
  retryFocused?: boolean;
  categories: { key: string; name: string; count?: number; hidden: boolean }[];
  categoryTotal: number;
  categoryCursor: number;
  categoriesFocused: boolean;
  categoriesLoading?: boolean;
  shortcuts?: Guide[];
  onCategoryFocus: (index: number) => void;
  onCategorySelect: (index: number) => void;
  onCategoryWheel: (direction: -1 | 1) => void;
  results: LibraryResource<LibraryItem[]>;
  items: readonly PosterItem[];
  total: number;
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
  keyboardOpen = true,
  submitFocused,
  retryFocused,
  categories,
  categoryTotal,
  categoryCursor,
  categoriesFocused,
  categoriesLoading = false,
  shortcuts,
  onCategoryFocus,
  onCategorySelect,
  onCategoryWheel,
  results,
  items,
  total,
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
  const { t, number } = useLocale();
  const submit = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const scope = t(kind === "movie" ? "content.movies" : "content.series");
  const submitted = !!appliedQuery.trim();
  const loading = submitted && (results.state === "loading" || results.state === "idle");
  const failed = submitted && results.state === "failed";
  const empty = submitted && results.state === "empty" && !items.length;
  const showColumns = submitted && (!empty || categoriesLoading || categories.length > 0);
  const showGrid = submitted && !loading && !failed && !empty;
  const busy = loading && query === appliedQuery;
  const tooLarge = results.error === "too-large";
  const retryActive = retryFocused ?? grid.focused;
  const title = !submitted
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
        ? t("vod.searchEmptyHint")
        : "";

  useEffect(() => {
    if (submitFocused) submit.current?.focus();
  }, [submitFocused]);
  useEffect(() => {
    if (failed && retryActive) retry.current?.focus();
  }, [failed, retryActive]);

  return (
    <section className="vod-search" aria-label={`${t("common.search")} ${scope}`}>
      <div className="vod-search-bar">
        <SearchField
          value={query}
          focused={fieldFocused}
          keyboardOpen={keyboardOpen}
          shown={items.length + categories.length}
          total={total + categoryTotal}
          showCount={submitted && !loading && !failed && appliedQuery === query}
          placeholder={t("common.search")}
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
      <div className={`vod-search-results ${showColumns ? "" : "search-prompt"}`}>
        {showColumns && (
          <Sidebar
            className="search-categories"
            categories={categories}
            total={categoryTotal}
            cursor={categoryCursor + 1}
            selected={-1}
            focused={categoriesFocused}
            loading={categoriesLoading}
            allHidden={false}
            emptyLabel={t("playlist.noCategoryMatches")}
            scale={grid.scale}
            onFocus={onCategoryFocus}
            onSelect={onCategorySelect}
            onWheel={onCategoryWheel}
          />
        )}
        <section className="vod-search-content" aria-label={scope} aria-busy={loading}>
          {showColumns && (
            <header className="pane-head search-content-heading">
              <h2>{scope}</h2>
              {!loading && !failed && (
                <span className="count">
                  {items.length < total
                    ? `${number(items.length)} / ${number(total)}`
                    : number(total)}
                </span>
              )}
            </header>
          )}
          {showGrid ? (
            <PosterGrid {...grid} items={items} resourceState={results.state} />
          ) : (
            <SearchState
              className="vod-search-state"
              title={title}
              description={message}
              descriptionId={descriptionId}
              loading={loading}
              failed={failed}
              compact={empty && !!showColumns}
            >
              {failed && (
                <button
                  ref={retry}
                  type="button"
                  className="vod-retry"
                  data-selected={retryActive || undefined}
                  aria-describedby={descriptionId}
                  onFocus={onRetryFocus}
                  onClick={onRetry}
                >
                  <Icon name={tooLarge ? kind : "refresh"} />
                  <span>{t(tooLarge ? "vod.browseCategories" : "vod.retry")}</span>
                </button>
              )}
            </SearchState>
          )}
        </section>
      </div>
      <NavigationGuide className="page-key-guide vod-search-key-guide" shortcuts={shortcuts} />
    </section>
  );
}
