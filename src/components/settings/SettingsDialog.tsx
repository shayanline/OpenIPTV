import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../hooks/useLocale";
import { KEY, useRemote } from "../../hooks/useRemote";
import { containsOwnedFocus, useSpatialNav } from "../../hooks/useSpatialNav";
import { Icon } from "../Icon";
import { DialogGuide } from "../KeyGuide";
import { textInputExit } from "../TextInput";

const FOCUSABLE = "button, input, select, textarea, [href], [tabindex]";

function enabledFocusable(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.matches(":disabled") && element.tabIndex >= 0 && !element.closest("[hidden]"),
  );
}

function owningPopup(element: Element): Element | null {
  return element.closest(
    '[role="dialog"], [data-settings-action-menu], [data-option-picker-popup]',
  );
}

/* Short management forms keep the list mounted underneath.
   This dialog owns focus and keys, while the parent owns onAsking. */
export function SettingsDialog({
  title,
  children,
  inputEnabled,
  onClose,
  busy = false,
  pending = busy,
  onSave,
  saveLabel,
  saveDisabled = false,
  closeLabel,
  footerStart,
  feedback,
  className,
  busyLabel,
}: {
  title: string;
  children: React.ReactNode;
  inputEnabled: boolean;
  onClose: () => void;
  busy?: boolean;
  pending?: boolean;
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  closeLabel?: string;
  footerStart?: React.ReactNode;
  feedback?: React.ReactNode;
  className?: string;
  busyLabel?: string;
}) {
  const { t } = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const { move } = useSpatialNav(box, false);
  const inputEnabledRef = useRef(inputEnabled);
  inputEnabledRef.current = inputEnabled;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const working = busy || pending;
  const workingRef = useRef(working);
  workingRef.current = working;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  /* Focus starts inside the dialog on the marked first control when it is
     enabled, and suspension or busy transitions only ever touch focus this
     dialog owns, never an upper popup's. */
  useLayoutEffect(() => {
    const panel = box.current;
    if (!panel) return;
    const active = document.activeElement;
    if (!inputEnabled) {
      if (active instanceof HTMLElement && owningPopup(active) === panel) {
        active.blur();
      }
      return;
    }
    if (active && active !== document.body) {
      if (active !== panel && containsOwnedFocus(panel, active) && !active.matches(":disabled"))
        return;
      const upper = owningPopup(active);
      if (upper && upper !== panel && !containsOwnedFocus(panel, active)) return;
    }
    const enabled = enabledFocusable(panel);
    const marked = panel.querySelector<HTMLElement>("[data-settings-detail-first]");
    const target = marked && enabled.includes(marked) ? marked : (enabled[0] ?? panel);
    target.focus();
  }, [inputEnabled, working]);

  useRemote((code, event) => {
    if (event.defaultPrevented || !inputEnabledRef.current) return;
    const active = document.activeElement;
    if (
      active instanceof Element &&
      (active.closest("[data-option-picker-popup], [data-option-picker-open]") ||
        (code === KEY.ENTER && active.closest(".option-picker")))
    )
      return;
    const inField =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      if (inField) (active as HTMLElement).blur();
      else if (!busyRef.current) onCloseRef.current();
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN].includes(code as never)) {
      if (inField) {
        if (!(active instanceof HTMLInputElement) || !textInputExit(active, code)) return;
      }
      event.preventDefault();
      const panel = box.current;
      if (
        (code === KEY.UP || code === KEY.DOWN) &&
        panel?.querySelector("[data-ordered-form]")
      ) {
        const ordered = enabledFocusable(panel).filter((element) => {
          const group = element.closest("[data-form-navigation-group]");
          if (!group) return true;
          const current =
            active && group.contains(active)
              ? active
              : group.querySelector('[aria-pressed="true"]');
          return element === current;
        });
        const at = Math.max(0, ordered.indexOf(active as HTMLElement));
        const next = Math.max(
          0,
          Math.min(ordered.length - 1, at + (code === KEY.DOWN ? 1 : -1)),
        );
        ordered[next]?.focus({ preventScroll: true });
        ordered[next]?.scrollIntoView({ block: "nearest" });
        return;
      }
      move(code);
      return;
    }
    if (code === KEY.ENTER) {
      if (active instanceof HTMLButtonElement && box.current?.contains(active)) {
        event.preventDefault();
        active.click();
      }
      return;
    }
  }, true);

  const dismiss = () => {
    if (inputEnabledRef.current && !busyRef.current) onCloseRef.current();
  };

  const save = () => {
    if (inputEnabledRef.current && !workingRef.current && !saveDisabled) {
      onSaveRef.current?.();
    }
  };

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !box.current || !inputEnabledRef.current) return;
    const focusable = enabledFocusable(box.current);
    if (!focusable.length) {
      event.preventDefault();
      box.current.focus();
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

  return createPortal(
    <div className="settings-dialog-scrim" onClick={dismiss}>
      <div
        className={`dialog settings-dialog${className ? ` ${className}` : ""}`}
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={working || undefined}
        tabIndex={-1}
        data-settings-dialog
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        <h2>
          <span>{title}</span>
        </h2>
        <div className="settings-dialog-body">{children}</div>
        {feedback && <div className="settings-dialog-feedback">{feedback}</div>}
        <div
          className={`dialog-actions ${
            onSave
              ? "dialog-actions-save"
              : footerStart
                ? "dialog-actions-split"
                : "dialog-actions-close"
          }`}
        >
          <DialogGuide />
          {footerStart && <div className="dialog-footer-start">{footerStart}</div>}
          <button type="button" className="btn tonal" disabled={busy} onClick={dismiss}>
            <Icon name="close" />
            <span>{closeLabel ?? t(onSave ? "common.cancel" : "common.close")}</span>
          </button>
          {onSave && (
            <button
              type="button"
              className="btn filled"
              disabled={working || saveDisabled}
              aria-busy={working || undefined}
              aria-label={working && busyLabel ? busyLabel : undefined}
              onClick={save}
            >
              {working ? (
                <span className="spinner small" aria-hidden="true" />
              ) : (
                <Icon name="check" />
              )}
              <span>{working && busyLabel ? busyLabel : (saveLabel ?? t("common.save"))}</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
