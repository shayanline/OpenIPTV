import { useCallback, useEffect, useRef, useState } from "react";
import { KEY } from "../hooks/useRemote";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  secondary?: string;
}

export function OptionPicker<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id?: string;
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];
  const close = useCallback(() => {
    currentRef.current?.focus();
    setOpen(false);
  }, []);
  const choose = useCallback(
    (next: T) => {
      onChange(next);
      close();
    },
    [close, onChange],
  );

  /* Opening puts focus on the selected option, so the first arrow press moves inside the
     list rather than leaving the trigger while the list is already up. */
  useEffect(() => {
    if (!open) return;
    const list = pickerRef.current?.querySelector<HTMLElement>('[role="listbox"]');
    const selected =
      list?.querySelector<HTMLElement>(`[data-value="${value}"]`) ??
      list?.querySelector<HTMLElement>("[data-value]");
    selected?.focus();
  }, [open, value]);

  /* The listener is registered once and reads through a ref: keys dispatched on window,
     which is how the on-screen pad and the dev remote send theirs, are answered in
     registration order, so re-registering on every state change would let the screen's
     own navigation run before an open list. */
  const latest = useRef({ open, choose, close });
  latest.current = { open, choose, close };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { open, choose, close } = latest.current;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !pickerRef.current?.contains(active)) return;
      if (event.keyCode === KEY.BACK || event.keyCode === KEY.ESC) {
        if (!open) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      /* While the list is open it owns up and down, which step between the options and
         stop at the ends rather than looping. Left and right are a way out alongside
         Return: the press closes the list without moving the screen's focus underneath
         it, and the next press moves. */
      if (open && (event.keyCode === KEY.LEFT || event.keyCode === KEY.RIGHT)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (open && (event.keyCode === KEY.UP || event.keyCode === KEY.DOWN)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const options = Array.from(
          pickerRef.current?.querySelectorAll<HTMLElement>("[data-value]") ?? [],
        );
        if (!options.length) return;
        const at = options.indexOf(active);
        /* A click opened the list with focus still on the trigger, so the first press
           only enters it. */
        if (at === -1) {
          const selected = options.findIndex((option) => option.classList.contains("selected"));
          options[Math.max(0, selected)].focus();
          return;
        }
        const next =
          event.keyCode === KEY.DOWN
            ? Math.min(options.length - 1, at + 1)
            : Math.max(0, at - 1);
        options[next].focus();
        /* The list scrolls when it is longer than its cap, so a stepped-to option can be
           out of view without this. */
        options[next].scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.keyCode !== KEY.ENTER) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (active === currentRef.current) {
        setOpen((was) => !was);
        return;
      }
      const next = active.getAttribute("data-value") as T | null;
      if (next) choose(next);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      className="option-picker"
      ref={pickerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        id={id}
        ref={currentRef}
        type="button"
        className="option-picker-current"
        aria-label={`${label}, ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{current.label}</span>
        <span className="option-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="option-picker-list" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              data-value={option.value}
              className={`option-picker-option ${option.value === value ? "selected" : ""}`}
              aria-label={
                option.secondary ? `${option.label} ${option.secondary}` : option.label
              }
              aria-selected={option.value === value}
              onClick={() => choose(option.value)}
            >
              <span dir="auto">{option.label}</span>
              {option.secondary && (
                <span className="option-picker-secondary" dir="auto">
                  {option.secondary}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
