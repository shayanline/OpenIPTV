import { useEffect, useRef } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { LibraryItem, LibraryResource } from "../../stores/library";
import { Icon } from "../Icon";
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
  const scope = t(kind === "movie" ? "content.movies" : "content.series");

  useEffect(() => {
    if (submitFocused) submit.current?.focus();
  }, [submitFocused]);

  return (
    <section
      className="vod-search"
      aria-label={t("vod.results", { kind: scope, count: total })}
    >
      <div className="vod-search-bar">
        <SearchField
          value={query}
          focused={fieldFocused}
          shown={items.length}
          total={total}
          showCount={!!appliedQuery.trim() && appliedQuery === query}
          placeholder={`${t("common.search")} ${scope}`}
          ariaLabel={`${t("common.search")} ${scope}`}
          onChange={onQuery}
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
          onClick={onSubmit}
        >
          <Icon name="search" />
          <span>{t("common.search")}</span>
        </button>
      </div>
      {results.state === "failed" ? (
        <PosterGrid {...grid} items={items} resourceState={results.state} />
      ) : results.state === "loading" || results.state === "idle" ? (
        <div className="vod-search-loading" role="status">
          <div className="spinner" />
          <p>{t("vod.loading")}</p>
        </div>
      ) : !appliedQuery.trim() ? (
        <p className="vod-no-results" role="status">
          {`${t("common.search")} ${scope}`}
        </p>
      ) : results.state === "empty" && !items.length ? (
        <p className="vod-no-results" role="status">
          {t("vod.noResults", { query: appliedQuery })}
        </p>
      ) : (
        <PosterGrid {...grid} items={items} resourceState={results.state} />
      )}
    </section>
  );
}
