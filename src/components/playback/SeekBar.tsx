import { useRef } from "react";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { clampSeekTarget } from "../../services/playbackRange";
import type { SeekRange } from "../../types";
import { clock } from "../PlaybackBanner";
import { Text } from "../Text";

export interface SeekBarProps {
  range: SeekRange;
  position: number;
  target: number;
  focused: boolean;
  disabled?: boolean;
  live: boolean;
  showGoLive: boolean;
  goLiveFocused: boolean;
  onTarget(target: number): void;
  onGoLive(): void;
  onFocus(focus: "seek" | "go-live"): void;
}

/**
 * The timeline inside the deck. Blue is what has played and white is where the eye is: focus
 * thickens the track, grows the thumb and floats the pending target time above it. The track
 * carries no border, since a seek bar inside a box reads as decoration rather than position.
 *
 * Live adds two things finite never has: the oldest available time on the left names the
 * start of the DVR window, and the right end is either a Live badge at the edge or a Go live
 * action while the playhead is behind it.
 */
export function SeekBar({
  range,
  position,
  target,
  focused,
  disabled = false,
  live,
  showGoLive,
  goLiveFocused,
  onTarget,
  onGoLive,
  onFocus,
}: SeekBarProps) {
  const { t, direction, time } = useLocale();
  const span = Math.max(range.endSeconds - range.startSeconds, 1);
  const percent = (value: number) =>
    Math.min(100, Math.max(0, ((value - range.startSeconds) / span) * 100));
  const pointStyle = (value: number): React.CSSProperties =>
    direction === "rtl" ? { right: `${percent(value)}%` } : { left: `${percent(value)}%` };
  /*
   * A live window starts at a wall clock moment, not at a stream position: the oldest
   * programme still in the window began at now minus the measured span.
   */
  const startLabel = live ? time(new Date(Date.now() - span * 1000)) : clock(position);

  const pointerId = useRef<number | null>(null);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (event.clientX - rect.left) / rect.width;
    const clampedRatio = Math.min(1, Math.max(0, direction === "rtl" ? 1 - ratio : ratio));
    onTarget(clampSeekTarget(range.startSeconds + clampedRatio * span, range));
  };

  return (
    <div className={`seekbar${focused ? " focused" : ""}${disabled ? " disabled" : ""}`}>
      <span className="seekbar-time seekbar-start">{startLabel}</span>
      <div
        className="seekbar-track"
        role="slider"
        tabIndex={-1}
        data-control="seek"
        data-selected={focused || undefined}
        aria-label={t("deck.seek")}
        aria-disabled={disabled || undefined}
        aria-valuemin={Math.floor(range.startSeconds)}
        aria-valuemax={Math.floor(range.endSeconds)}
        aria-valuenow={Math.floor(target)}
        aria-valuetext={clock(target)}
        onPointerDown={(event) => {
          if (disabled) return;
          onFocus("seek");
          pointerId.current = event.pointerId;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          point(event);
        }}
        onPointerMove={(event) => {
          if (pointerId.current === event.pointerId) point(event);
        }}
        onPointerUp={(event) => {
          if (pointerId.current !== event.pointerId) return;
          point(event);
          pointerId.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (pointerId.current !== event.pointerId) return;
          pointerId.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
      >
        <div className="seekbar-played" style={{ width: `${percent(position)}%` }} />
        <div className="seekbar-thumb" style={pointStyle(focused ? target : position)} />
        <div
          className={`seekbar-target ${focused ? "visible" : ""}`}
          style={pointStyle(target)}
          aria-hidden={!focused}
        >
          {clock(target)}
        </div>
      </div>
      {live ? (
        showGoLive ? (
          <button
            type="button"
            className="btn tonal seekbar-golive"
            data-control="go-live"
            data-selected={goLiveFocused || undefined}
            disabled={disabled}
            onPointerEnter={() => pointerOnly(() => onFocus("go-live"))}
            onClick={() => {
              onFocus("go-live");
              onGoLive();
            }}
          >
            <Text value={t("deck.goLive")} />
          </button>
        ) : (
          <span className="seekbar-time seekbar-end">
            {range.liveEdge ? "--:--" : `−${clock(Math.max(0, range.endSeconds - position))}`}
          </span>
        )
      ) : (
        <span className="seekbar-time seekbar-end">{clock(range.endSeconds)}</span>
      )}
    </div>
  );
}
