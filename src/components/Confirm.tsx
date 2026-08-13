import { useEffect, useRef } from "react";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";

/**
 * Asking before doing something that cannot be undone.
 *
 * A popup rather than a pair of buttons appearing in the row, which is what removing a
 * playlist used to offer. Two extra targets arriving inside a row shift everything beside
 * them, sit a single press from the button that plays the thing, and leave the rest of the
 * screen live while a question is outstanding. The popup guidance is the opposite of all
 * three: a question makes everything outside itself unavailable until it is answered.
 *
 * The safe answer takes focus, so a viewer pressing SELECT out of habit keeps what they
 * have. Sixty seconds of silence is taken as no, matching the popup duration table.
 */
export function Confirm({ title, body, confirmLabel, cancelLabel, destructive, onConfirm, onCancel }: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Colours the confirming button as a warning rather than as the ordinary next step. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const { move } = useSpatialNav(box, true);
  const cancelRef = useRef<HTMLButtonElement>(null);

  /*
   * The safe answer takes the focus, said here rather than left to the spatial navigation.
   *
   * useSpatialNav focuses the first candidate it finds, which is the same button only for
   * as long as Cancel happens to come first in the markup. Naming it means reordering the
   * two buttons cannot quietly hand the opening focus to the destructive one.
   */
  useEffect(() => { cancelRef.current?.focus(); }, []);

  /*
   * Sixty seconds of silence is taken as no, per the popup duration table.
   *
   * The callback is held in a ref and the effect depends on nothing, because every caller
   * passes an inline arrow and so hands this a new function on each of its own renders.
   * Depending on it restarted the count every time, and with a failed channel behind the
   * dialog the retry countdown re-renders App twice a second, so the minute never elapsed
   * and the timeout this documents simply did not exist.
   */
  const dismiss = useRef(onCancel);
  dismiss.current = onCancel;
  useEffect(() => {
    const t = window.setTimeout(() => dismiss.current(), 60000);
    return () => window.clearTimeout(t);
  }, []);

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
    <div className="dialog-scrim" onClick={onCancel}>
      <div className="dialog" ref={box} role="dialog" aria-modal="true" aria-label={title}
           onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        {/*
          * Both buttons are tonal, and only the focus is loud.
          *
          * Filling the confirming button would give the dialog two things shouting at once:
          * the focus ring on the safe answer and a solid fill beside it, which reads as the
          * one that is chosen. Checklist 4.2 allows one focused object and 4.3 wants it
          * clearly recognisable against the others, so nothing else may compete with it. A
          * destructive action still says so in its text colour.
          */}
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} className="btn tonal" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn tonal ${destructive ? "danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
