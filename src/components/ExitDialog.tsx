import { Confirm } from "./Confirm";

/**
 * Samsung's input guide says RETURN on the application's home screen closes the
 * application, and recommends confirming first. Without this the app is a place a viewer
 * can enter and not leave with the button that everywhere else means "leave".
 */
export function exitApp() {
  const tizen = (window as unknown as {
    tizen?: { application?: { getCurrentApplication(): { exit(): void } } };
  }).tizen;
  try {
    tizen?.application?.getCurrentApplication().exit();
  } catch {
    // Off the TV there is nothing to exit, so the dialog simply closes.
  }
}

export function ExitDialog({ watching, onCancel }: {
  /** Whether a channel is actually playing, which decides what staying is called. */
  watching: boolean;
  onCancel: () => void;
}) {
  return (
    <Confirm
      title="Close SimpleIPTV?"
      body="You can open it again from the Apps row."
      confirmLabel="Close"
      /* "Keep watching" is only true if they are. This dialog is also reachable from the channel
         list with nothing playing and from a playlist that loaded nothing, where it told the
         viewer they were watching something they were not. */
      cancelLabel={watching ? "Keep watching" : "Stay here"}
      onConfirm={exitApp}
      onCancel={onCancel}
    />
  );
}
