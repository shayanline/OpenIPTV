import { useLocale } from "../hooks/useLocale";
import { Confirm } from "./Confirm";

/**
 * Samsung's input guide says RETURN on the application's home screen closes the
 * application, and recommends confirming first. Without this the app is a place a viewer
 * can enter and not leave with the button that everywhere else means "leave".
 */
export function exitApp() {
  const tizen = (
    window as unknown as {
      tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
    }
  ).tizen;
  try {
    tizen?.application?.getCurrentApplication().exit();
  } catch {
    // Off the TV there is nothing to exit, so the dialog simply closes.
  }
}

export function ExitDialog({
  onConfirm,
  onCancel,
}: {
  /** Runs before the application exits, so playback is released first. */
  onConfirm?: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  return (
    <Confirm
      title={t("exit.question")}
      body={t("exit.body")}
      confirmLabel={t("exit.confirm")}
      cancelLabel={t("exit.stay")}
      destructive
      confirmIcon="power"
      cancelIcon={null}
      onConfirm={() => {
        onConfirm?.();
        exitApp();
      }}
      onCancel={onCancel}
    />
  );
}
