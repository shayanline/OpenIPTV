import { memo, useRef, useState } from "react";
import { pointerOnly, usePointerInput } from "../hooks/usePointerAwake";
import { useLocale } from "../hooks/useLocale";
import { useViewport } from "../hooks/useViewport";
import { useNavigableWindow } from "../hooks/useWindowed";
import type { ChannelGuide } from "../stores/library";
import type { Channel } from "../types";
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

export interface GuideListProps {
  channel: Channel;
  guide: ChannelGuide;
  index: number;
  focused: boolean;
  scale: number;
  onMove(index: number): void;
  onPlay(index: number): void;
  onRetry(): void;
  onWheel(direction: -1 | 1): void;
}

/*
 * Drawer content and nothing more: the playback drawer owns the fixed header, the surface
 * and Back. This is the windowed programme list itself, with current programme marking kept
 * distinct from the white focus and the blue selection colours.
 */
export const GuideList = memo(function GuideList({
  channel,
  guide,
  index,
  focused,
  scale,
  onMove,
  onPlay,
  onRetry,
  onWheel,
}: GuideListProps) {
  const { t, time } = useLocale();
  const pointerMode = usePointerInput();
  const [hovered, setHovered] = useState<number | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const height = useViewport(viewport);
  const win = useNavigableWindow(guide.items.length, Math.max(0, index), height, scale);
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
    const labelActive = pointerMode ? hovered === i % win.slots : focused && i === index;
    rows.push(
      <div
        className={`row guide-row ${current ? "current" : ""} ${focused && i === index ? "cursor" : ""}`}
        style={{ top: i * win.row, height: win.row }}
        key={i % win.slots}
        onPointerEnter={() =>
          pointerOnly(() => {
            setHovered(i % win.slots);
            onMove(i);
          })
        }
        onPointerLeave={() =>
          setHovered((previous) => (previous === i % win.slots ? null : previous))
        }
        onClick={() => onMove(i)}
      >
        <div className="guide-programme">
          <span className="guide-time">
            {programmeTime(programme.startTimestamp, programme.stopTimestamp, time)}
          </span>
          <span className="guide-copy">
            <span className="guide-title-line">
              <Text
                value={programme.title}
                className="row-label"
                marquee
                active={labelActive}
              />
              {current && <span className="guide-now">{t("channel.playingNow")}</span>}
            </span>
            {programme.description && (
              <Text
                value={programme.description}
                className="guide-description"
                marquee
                active={labelActive}
              />
            )}
          </span>
        </div>
        {programme.target && (
          <button type="button" className="btn tonal guide-play" onClick={() => onPlay(i)}>
            {t("guide.playFromStart")}
          </button>
        )}
      </div>,
    );
  }

  return (
    <section
      className={`list pane guide-list ${focused ? "focused" : ""}`}
      aria-label={t("guide.title", { category: channel.name })}
    >
      <div
        className="viewport"
        ref={viewport}
        onWheel={(event) => {
          if (!event.deltaY) return;
          if (win.onWheel(event.deltaY, event.deltaMode)) {
            event.preventDefault();
            return;
          }
          onWheel(event.deltaY > 0 ? 1 : -1);
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
            <button type="button" className="btn tonal cursor" onClick={onRetry}>
              {t("library.retry")}
            </button>
          </div>
        )}
        {guide.state === "empty" && <p className="empty guide-empty">{t("guide.empty")}</p>}
        {guide.state === "loaded" && (
          <div className="window" style={{ transform: `translateY(${-win.scrollOffset}px)` }}>
            {rows}
          </div>
        )}
        <ScrollIndicator
          count={guide.items.length}
          first={win.indicatorFirst}
          visible={win.visible}
        />
      </div>
    </section>
  );
});
