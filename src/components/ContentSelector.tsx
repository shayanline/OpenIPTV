import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import type { XtreamContentKind } from "../services/xtream";
import { Icon, type IconName } from "./Icon";

const LABELS = {
  live: "content.live",
  movie: "content.movies",
  series: "content.series",
} as const;

const ICONS: Record<XtreamContentKind, IconName> = {
  live: "tv",
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
  value: XtreamContentKind;
  focus: XtreamContentKind;
  available: readonly XtreamContentKind[];
  focused: boolean;
  onChange: (value: XtreamContentKind) => void;
}) {
  const { t } = useLocale();

  return (
    <div className={`content-selector ${focused ? "focused" : ""}`}>
      {available.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`content-option ${kind === value ? "selected" : ""} ${focused && kind === focus ? "focused" : ""}`}
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
