import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import type { AppMode } from "../services/surfaceStack";
import { Icon, type IconName } from "./Icon";

const LABELS = {
  live: "content.live",
  movie: "content.movies",
  series: "content.series",
} as const;

const ICONS: Record<AppMode, IconName> = {
  live: "live",
  movie: "movie",
  series: "series",
};

export const ContentSelector = memo(function ContentSelector({
  value,
  focus,
  available,
  focused,
  onChange,
}: {
  value: AppMode;
  focus: AppMode;
  available: readonly AppMode[];
  focused: boolean;
  onChange: (value: AppMode) => void;
}) {
  const { t } = useLocale();

  return (
    <div className={`content-selector ${focused ? "focused" : ""}`}>
      {available.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`content-option ${kind === value ? "selected" : ""} ${focused && kind === focus ? "cursor" : ""}`}
          aria-label={t(LABELS[kind])}
          aria-pressed={kind === value}
          onClick={() => onChange(kind)}
        >
          <Icon name={ICONS[kind]} />
          <span>{t(LABELS[kind])}</span>
        </button>
      ))}
    </div>
  );
});
