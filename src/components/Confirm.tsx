import { useEffect, useRef } from "react";
import { pointerOnly } from "../hooks/usePointerAwake";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import { Icon, type IconName } from "./Icon";
import { DialogGuide } from "./KeyGuide";

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
export function Confirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  confirmIcon,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Colours the confirming button as a warning rather than as the ordinary next step. */
  destructive?: boolean;
  confirmIcon?: IconName;
  /** The answer is already on its way: the question cannot be dismissed or re-answered. */
  busy?: boolean;
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
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  /*
   * While the answer is in flight the dialog itself holds focus, because neither button
   * can take it. When the wait ends, focus still sitting on the box goes back to the safe
   * answer rather than being left on an element that cannot be pressed.
   */
  useEffect(() => {
    if (busy) box.current?.focus();
    else if (document.activeElement === box.current) cancelRef.current?.focus();
  }, [busy]);

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
  dismiss.current = () => {
    if (!busy) onCancel();
  };
  useEffect(() => {
    const t = window.setTimeout(() => dismiss.current(), 60000);
    return () => window.clearTimeout(t);
  }, []);

  /* A confirmation can sit above a form dialog, so Tab must not leak through to the
     controls underneath it. */
  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !box.current) return;
    if (busy) {
      event.preventDefault();
      return;
    }
    const focusable = Array.from(
      box.current.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((element) => !element.disabled);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !box.current.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !box.current.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  useRemote((code, event) => {
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      dismiss.current();
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN].includes(code as never)) {
      event.preventDefault();
      if (!busy) move(code);
      return;
    }
    // Same boundary as Settings: a virtual Enter arrives as a key, not a click, so
    // the focused answer is clicked here. A prevented Enter belongs to whoever
    // already claimed it.
    if (code === KEY.ENTER) {
      if (event.defaultPrevented) return;
      if (busy) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && box.current?.contains(active)) {
        event.preventDefault();
        active.click();
      }
      return;
    }
  });

  return (
    <div className="dialog-scrim" onClick={() => dismiss.current()}>
      <div
        className="dialog confirm-dialog"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapTab}
      >
        <h2>{title}</h2>
        {body && <p>{body}</p>}
        <div className="dialog-actions">
          <DialogGuide />
          <button
            type="button"
            ref={cancelRef}
            className="btn tonal"
            disabled={busy}
            onPointerEnter={(event) => pointerOnly(() => event.currentTarget.focus())}
            onClick={() => dismiss.current()}
          >
            <Icon name="back" />
            <span>{cancelLabel}</span>
          </button>
          <button
            type="button"
            className={`btn tonal ${destructive ? "danger" : confirmIcon ? "confirm-emphasis" : ""}`}
            disabled={busy}
            onPointerEnter={(event) => pointerOnly(() => event.currentTarget.focus())}
            onClick={onConfirm}
          >
            {(confirmIcon || destructive || busy) && (
              <span className="confirm-action-icon" aria-hidden="true">
                {busy ? (
                  <span className="spinner small" />
                ) : (
                  <Icon name={confirmIcon ?? "remove"} />
                )}
              </span>
            )}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
