import { useLocale } from "../../hooks/useLocale";
import type { RecoveryState } from "../../services/playbackRecovery";

export function isRecoveryStatusVisible(state: RecoveryState, hidden: boolean): boolean {
  return !hidden && state.statusVisible && state.stage !== "idle" && state.stage !== "terminal";
}

/**
 * An accessible spinner beside the clock, without visible recovery text.
 * The picture surface still owns pause and terminal failure.
 */
export function RecoveryStatus({ state, hidden }: { state: RecoveryState; hidden: boolean }) {
  const { t } = useLocale();
  if (!isRecoveryStatusVisible(state, hidden)) return null;

  return (
    <div className="recovery-status" role="status" aria-label={t("picture.connecting")}>
      <span className="spinner" aria-hidden="true" />
    </div>
  );
}
