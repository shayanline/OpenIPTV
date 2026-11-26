import { useLocale } from "../../hooks/useLocale";
import type { RecoveryState } from "../../services/playbackRecovery";

export function isRecoveryStatusVisible(state: RecoveryState, hidden: boolean): boolean {
  return !hidden && state.statusVisible && state.stage !== "idle" && state.stage !== "terminal";
}

/**
 * Compact recovery feedback beside the clock.
 *
 * This is the small statement, not the picture state: a channel that is already showing keeps
 * its last frame on screen while recovery works underneath it, and the viewer only needs to
 * know that something is being tried, not what the engine called it. The middle of the picture
 * reports loading until this compact status appears, and still owns pause and terminal failure.
 *
 * Deliberately plain. No engine code, no address, no provider wording: the optional playback
 * diagnostics keep that detail available without turning this status into another control surface.
 */
export function RecoveryStatus({ state, hidden }: { state: RecoveryState; hidden: boolean }) {
  const { t } = useLocale();
  if (!isRecoveryStatusVisible(state, hidden)) return null;

  const message =
    state.stage === "waiting" && state.retryIn > 0
      ? t("recovery.retryIn", { seconds: state.retryIn })
      : state.attempt > 0
        ? t("recovery.retry", { attempt: state.attempt })
        : t("picture.connecting");

  return (
    <div className="recovery-status" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
