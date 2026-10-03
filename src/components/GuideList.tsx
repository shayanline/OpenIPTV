import { memo, useRef } from "react";
import { useLocale } from "../hooks/useLocale";
import { useViewport } from "../hooks/useViewport";
import { useWindowed } from "../hooks/useWindowed";
import type { ChannelGuide } from "../stores/library";
import { ScrollIndicator } from "./ScrollIndicator";
import { Text } from "./Text";

const programmeTime = (
  startTimestamp: number | undefined,
  stopTimestamp: number | undefined,
  time: (value: Date) => string,
) =>
  [startTimestamp, stopTimestamp]
    .filter((value): value is number => value !== undefined)
    .map((value) => time(new Date(value * 1000)))
    .join(" to ");

export const GuideList = memo(function GuideList({
  category,
  guide,
  index,
  focused,
  scale,
  onMove,
  onSelect,
  onRetry,
  onWheel,
}: {
  category: string;
  guide: ChannelGuide;
  index: number;
  focused: boolean;
  scale: number;
  onMove: (index: number) => void;
  onSelect: (index: number) => void;
  onRetry: () => void;
  onWheel: (direction: -1 | 1) => void;
}) {
  const { t, time } = useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  const win = useWindowed(guide.items.length, Math.max(0, index), height, scale);
  const now = Math.floor(Date.now() / 1000);
  const currentId =
    guide.items.find(
      (programme) =>
        programme.startTimestamp !== undefined &&
        programme.stopTimestamp !== undefined &&
        programme.startTimestamp <= now &&
        programme.stopTimestamp > now,
    )?.id ?? guide.current?.id;
  const rows = [];
  for (let i = win.start; i < win.end; i++) {
    const programme = guide.items[i];
    const current = programme.id === currentId;
    rows.push(
      <div
        className={`row guide-row ${current ? "current" : ""} ${focused && i === index ? "cursor selected" : ""}`}
        style={{ top: i * win.row, height: win.row }}
        key={i % win.slots}
        onClick={() => onMove(i)}
      >
        <div className="guide-programme">
          <span className="guide-time">
            {programmeTime(programme.startTimestamp, programme.stopTimestamp, time)}
          </span>
          <span className="guide-copy">
            <span className="guide-title-line">
              <Text value={programme.title} className="row-label" marquee />
              {current && <span className="guide-now">{t("channel.playingNow")}</span>}
            </span>
            {programme.description && (
              <Text value={programme.description} className="guide-description" marquee />
            )}
          </span>
        </div>
        {programme.target && (
          <button type="button" className="btn tonal guide-play" onClick={() => onSelect(i)}>
            {t("guide.playFromStart")}
          </button>
        )}
      </div>,
    );
  }

  return (
    <div className={`list pane guide-list ${focused ? "focused" : ""}`}>
      <div className="pane-head">
        <Text value={t("guide.title", { category })} className="panel-title" />
      </div>
      <div
        className="viewport"
        ref={viewport}
        onWheel={(event) => {
          if (event.deltaY) onWheel(event.deltaY > 0 ? 1 : -1);
        }}
      >
        {guide.state === "loading" && (
          <div className="media-state" role="status">
            <span className="spinner" />
            <span>{t("library.loading")}</span>
          </div>
        )}
        {guide.state === "failed" && (
          <div className="media-state">
            <p>{guide.error || t("guide.failed")}</p>
            <button type="button" className="btn tonal selected" onClick={onRetry}>
              {t("library.retry")}
            </button>
          </div>
        )}
        {guide.state === "empty" && <p className="empty guide-empty">{t("guide.empty")}</p>}
        {guide.state === "loaded" && (
          <div className="window" style={{ transform: `translateY(${-win.offset}px)` }}>
            {rows}
          </div>
        )}
        <ScrollIndicator count={guide.items.length} first={win.first} visible={win.visible} />
      </div>
    </div>
  );
});
