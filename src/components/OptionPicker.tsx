import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pointerInputActive, pointerOnly } from "../hooks/usePointerAwake";
import { KEY } from "../hooks/useRemote";
import { Icon } from "./Icon";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  secondary?: string;
}

function revealOption(list: HTMLElement, option: HTMLElement): void {
  if (!list.clientHeight) return;
  const top = option.offsetTop;
  const bottom = top + option.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight)
    list.scrollTop = bottom - list.clientHeight;
}

export function OptionPicker<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id?: string;
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const triggerId = id ?? `option-picker-${generatedId}`;
  const listId = `${triggerId}-options`;
  const pickerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    direction: "ltr" | "rtl";
  } | null>(null);
  const positioned = placement !== null;
  const current = options.find((option) => option.value === value) ?? options[0];
  const close = useCallback(() => {
    currentRef.current?.focus({ preventScroll: true });
    setOpen(false);
  }, []);
  const choose = useCallback(
    (next: T) => {
      onChange(next);
      close();
    },
    [close, onChange],
  );

  /* Remote opening puts focus on the selected option, so the first arrow press moves inside the
     list. Pointer opening leaves focus on the trigger until the pointer enters an option. */
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    const list = listRef.current;
    const selected =
      list?.querySelector<HTMLElement>(`[data-value="${value}"]`) ??
      list?.querySelector<HTMLElement>("[data-value]");
    if (!list || !selected) return;
    if (!pointerInputActive()) selected.focus({ preventScroll: true });
    revealOption(list, selected);
  }, [open, positioned, value]);

  useLayoutEffect(() => {
    if (!disabled) return;
    if (listRef.current?.contains(document.activeElement)) {
      currentRef.current
        ?.closest<HTMLElement>('[role="dialog"]')
        ?.focus({ preventScroll: true });
    }
    setOpen(false);
  }, [disabled]);

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const margin =
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--safe-x"),
      ) || 48;
    const position = (event?: Event) => {
      const trigger = currentRef.current;
      const list = listRef.current;
      if (!trigger || !list) return;
      if (event?.target instanceof Node && list.contains(event.target)) return;
      const bounds = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (bounds.bottom < 0 || bounds.top > viewportHeight) {
        setOpen(false);
        return;
      }
      const gap = 8;
      const width = Math.min(
        Math.max(bounds.width, 380),
        Math.max(0, viewportWidth - margin * 2),
      );
      const naturalHeight = Math.min(list.scrollHeight || 480, 480);
      const below = Math.max(0, viewportHeight - bounds.bottom - gap - margin);
      const above = Math.max(0, bounds.top - gap - margin);
      const upwards = below < naturalHeight && above > below;
      const maxHeight = Math.min(480, upwards ? above : below);
      const height = Math.min(naturalHeight, maxHeight);
      const direction = getComputedStyle(trigger).direction === "rtl" ? "rtl" : "ltr";
      const wantedLeft = direction === "rtl" ? bounds.left : bounds.right - width;
      const next = {
        top: Math.max(
          margin,
          Math.min(
            upwards ? bounds.top - gap - height : bounds.bottom + gap,
            viewportHeight - margin - height,
          ),
        ),
        left: Math.max(margin, Math.min(wantedLeft, viewportWidth - margin - width)),
        width,
        maxHeight,
        direction,
      } as const;
      setPlacement((previous) =>
        previous &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.width === next.width &&
        previous.maxHeight === next.maxHeight &&
        previous.direction === next.direction
          ? previous
          : next,
      );
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, value, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !pickerRef.current?.contains(event.target) &&
        !listRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [open]);

  /* The listener is registered once and reads through a ref: keys dispatched on window,
     which is how the on-screen pad and the dev remote send theirs, are answered in
     registration order, so re-registering on every state change would let the screen's
     own navigation run before an open list. */
  const latest = useRef({ open, choose, close });
  latest.current = { open, choose, close };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { open, choose, close } = latest.current;
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        (!pickerRef.current?.contains(active) && !listRef.current?.contains(active))
      )
        return;
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
      if (
        open &&
        (event.key === "Tab" || event.keyCode === KEY.LEFT || event.keyCode === KEY.RIGHT)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (open && (event.keyCode === KEY.UP || event.keyCode === KEY.DOWN)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const options = Array.from(
          listRef.current?.querySelectorAll<HTMLElement>("[data-value]") ?? [],
        );
        if (!options.length) return;
        const at = options.indexOf(active);
        /* A click opened the list with focus still on the trigger, so the first press
           only enters it. */
        if (at === -1) {
          const selected = options.findIndex((option) => option.classList.contains("selected"));
          const target = options[Math.max(0, selected)];
          target.focus({ preventScroll: true });
          if (listRef.current) revealOption(listRef.current, target);
          return;
        }
        const next =
          event.keyCode === KEY.DOWN
            ? Math.min(options.length - 1, at + 1)
            : Math.max(0, at - 1);
        options[next].focus({ preventScroll: true });
        if (listRef.current) revealOption(listRef.current, options[next]);
        return;
      }
      if (event.keyCode !== KEY.ENTER) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (active === currentRef.current) {
        if (!currentRef.current?.disabled) setOpen((was) => !was);
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
      data-option-picker-open={open ? true : undefined}
      ref={pickerRef}
      onBlur={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !listRef.current?.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        id={triggerId}
        ref={currentRef}
        type="button"
        className="option-picker-current"
        aria-label={`${label}, ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        <span>{current.label}</span>
        <span className="option-picker-chevron" aria-hidden="true">
          ▾
        </span>
      </button>
      {open &&
        createPortal(
          <div
            id={listId}
            ref={listRef}
            className="option-picker-list"
            role="listbox"
            aria-label={label}
            data-option-picker-popup
            data-focus-owner={triggerId}
            dir={placement?.direction}
            style={{
              top: placement?.top ?? 0,
              left: placement?.left ?? 0,
              width: placement?.width ?? 0,
              maxHeight: placement?.maxHeight ?? 0,
              visibility: placement ? "visible" : "hidden",
            }}
          >
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
                onPointerEnter={(event) =>
                  pointerOnly(() => event.currentTarget.focus({ preventScroll: true }))
                }
                onClick={() => choose(option.value)}
              >
                <span className="option-picker-text">
                  <span>{option.label}</span>
                  {option.secondary && (
                    <span className="option-picker-secondary">
                      {option.secondary}
                    </span>
                  )}
                </span>
                <span className="option-picker-check" aria-hidden="true">
                  {option.value === value && <Icon name="check" />}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
