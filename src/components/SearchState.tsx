import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function SearchState({
  title,
  description,
  descriptionId,
  loading = false,
  failed = false,
  compact = false,
  className = "",
  children,
}: {
  title: string;
  description?: string;
  descriptionId?: string;
  loading?: boolean;
  failed?: boolean;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`search-state ${compact ? "compact" : ""} ${className}`}
      role="status"
      aria-atomic="true"
    >
      {loading ? (
        <div className="spinner" aria-hidden="true" />
      ) : (
        !compact && (
          <span className="vod-error-icon" aria-hidden="true">
            <Icon name={failed ? "warn" : "search"} />
          </span>
        )
      )}
      <h2>{title}</h2>
      {description && <p id={descriptionId}>{description}</p>}
      {children}
    </div>
  );
}
