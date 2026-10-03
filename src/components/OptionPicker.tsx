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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !pickerRef.current?.contains(active)) return;
      if (event.keyCode === KEY.BACK || event.keyCode === KEY.ESC) {
        if (!open) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
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
  }, [choose, close, open]);

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
