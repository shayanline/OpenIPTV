import { useLocale } from "../../hooks/useLocale";
import type { QuickSeekState } from "../../types";
import { clock } from "../PlaybackBanner";

export interface QuickSeekProps {
  state: QuickSeekState;
}

/**
 * The compact companion to quick seeking: how far the accumulated presses land, and the time
 * they land at. It reports and nothing else, so it takes no focus, answers no pointer, and
 * never appears over a deck or drawer, which the caller guarantees by not mounting it.
 */
export function QuickSeek({ state }: QuickSeekProps) {
  const { t } = useLocale();
  const sign = state.deltaSeconds > 0 ? "+" : state.deltaSeconds < 0 ? "−" : "";
  return (
    <div className="quick-seek" role="status" aria-label={t("quickSeek.label")}>
      <span className="quick-seek-delta">{`${sign}${Math.abs(state.deltaSeconds)} s`}</span>
      <span className="quick-seek-target">{clock(state.targetSeconds)}</span>
    </div>
  );
}
