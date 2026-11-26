import { useLayoutEffect, useRef } from "react";
import { useLocale } from "../../hooks/useLocale";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { KEY, useRemote } from "../../hooks/useRemote";
import { useSpatialNav } from "../../hooks/useSpatialNav";
import { Icon, type IconName } from "../Icon";

export interface ActionMenuAction {
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * The one popup every management list opens from a row's menu control.
 *
 * A row keeps its choices behind a dedicated trigger and this carries them, so a list
 * stays a list of names rather than a grid of buttons. The safe patterns are the confirmation's: the first
 * action takes focus, every dismissal route leads back through onClose, and a virtual
 * Enter is turned into the click the remote never sends. Choosing calls onClose before
 * the action so the parent can suspend and restore in one step, and the action itself
 * only ever holds the selected operation. onClose receives whether the invoking row
 * should take focus back: a chosen action hands focus to whatever it opens instead.
 */
export function ActionMenu({
  title,
  actions,
  inputEnabled,
  onClose,
}: {
  title: string;
  actions: ActionMenuAction[];
  inputEnabled: boolean;
  onClose: (restoreFocus: boolean) => void;
}) {
  const { t } = useLocale();
  const box = useRef<HTMLDivElement>(null);
  const { move } = useSpatialNav(box, false);
  const inputEnabledRef = useRef(inputEnabled);
  inputEnabledRef.current = inputEnabled;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const popup = box.current;
    if (!inputEnabled || !popup || popup.contains(document.activeElement)) return;
    (
      popup.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
      popup.querySelector<HTMLButtonElement>(".action-menu-actions button")
    )?.focus();
  }, [inputEnabled]);

  useRemote((code, event) => {
    if (event.defaultPrevented || !inputEnabledRef.current) return;
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      onCloseRef.current(true);
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN].includes(code as never)) {
      event.preventDefault();
      move(code);
      return;
    }
    if (code === KEY.ENTER) {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && box.current?.contains(active)) {
        event.preventDefault();
        active.click();
      }
      return;
    }
  }, true);

  const choose = (action: ActionMenuAction) => {
    if (action.disabled || !inputEnabledRef.current) return;
    onCloseRef.current(false);
    action.onSelect();
  };

  const dismiss = () => {
    if (inputEnabledRef.current) onCloseRef.current(true);
  };

  const trapTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || !box.current || !inputEnabledRef.current) return;
    const focusable = Array.from(
      box.current.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((element) => !element.disabled);
    if (!focusable.length) return;
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

  return (
    <div className="dialog-scrim" onClick={dismiss}>
      <div
        className="dialog action-menu"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-settings-action-menu
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        <h2>
          <span dir="auto">{title}</span>
        </h2>
        <div className="action-menu-list" role="menu" aria-label={title}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={action.danger ? "danger" : undefined}
              data-settings-action={action.id}
              disabled={action.disabled || undefined}
              aria-disabled={action.disabled || undefined}
              onPointerEnter={(event) =>
                pointerOnly(() => {
                  if (inputEnabledRef.current && !action.disabled) {
                    event.currentTarget.focus();
                  }
                })
              }
              onClick={() => choose(action)}
            >
              {action.icon && <Icon name={action.icon} />}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
        <div className="dialog-actions action-menu-actions">
          <button
            type="button"
            className="btn tonal"
            onPointerEnter={(event) =>
              pointerOnly(() => {
                if (inputEnabledRef.current) event.currentTarget.focus();
              })
            }
            onClick={dismiss}
          >
            <Icon name="close" />
            <span>{t("common.close")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
