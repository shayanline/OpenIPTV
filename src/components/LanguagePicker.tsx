import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY } from "../hooks/useRemote";
import { LOCALE_OPTIONS, localeLabelKey, type LocalePreference } from "../services/locale";

export function LanguagePicker({
  value,
  onChange,
}: {
  value: LocalePreference;
  onChange: (value: LocalePreference) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const current = LOCALE_OPTIONS.find((option) => option.id === value) ?? LOCALE_OPTIONS[0];
  const currentLabel = t(localeLabelKey(current.id));

  const close = () => {
    setOpen(false);
    window.setTimeout(() => currentRef.current?.focus(), 0);
  };

  const choose = (next: LocalePreference) => {
    onChange(next);
    close();
  };

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
      const id = active.getAttribute("data-locale") as LocalePreference | null;
      if (id) choose(id);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <div className="language-picker" ref={pickerRef}>
      <button
        ref={currentRef}
        type="button"
        className="language-picker-current"
        aria-label={`${t("settings.language")}, ${currentLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{current.nativeLabel}</span>
        <span className="language-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="language-picker-list"
          role="listbox"
          aria-label={t("settings.language")}
        >
          {LOCALE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              data-locale={option.id}
              className={`language-picker-option ${option.id === value ? "selected" : ""}`}
              aria-label={`${option.nativeLabel} ${t(localeLabelKey(option.id))}`}
              aria-selected={option.id === value}
              onClick={() => choose(option.id)}
            >
              <span dir="auto">{option.nativeLabel}</span>
              <span className="language-picker-secondary" dir="auto">
                {t(localeLabelKey(option.id))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
