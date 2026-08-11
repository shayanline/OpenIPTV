import { useEffect, useRef } from "react";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";

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

export function ExitDialog({ onCancel }: { onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const { move } = useSpatialNav(box, true);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Cancel takes focus, so an accidental press of RETURN then SELECT keeps the viewer in
  // the app rather than dropping them out of it.
  useEffect(() => { cancelRef.current?.focus(); }, []);

  useRemote((code, event) => {
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onCancel();
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN].includes(code as never)) {
      event.preventDefault();
      move(code);
    }
  });

  return (
    <div className="dialog-scrim">
      <div className="dialog" ref={box} role="dialog" aria-modal="true" aria-label="Close SimpleIPTV">
        <h2>Close SimpleIPTV?</h2>
        <p>You can open it again from the Apps row.</p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} className="pill" onClick={onCancel}>
            Keep watching
          </button>
          <button type="button" className="pill on" onClick={exitApp}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
