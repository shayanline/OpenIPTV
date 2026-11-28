import { useEffect, useRef } from "react";
import { KEY } from "../hooks/useRemote";
import { useLocale } from "../hooks/useLocale";
import { Icon } from "./Icon";
import { TextInput } from "./TextInput";

/**
 * The query, in the channel column's header, where that column's heading otherwise goes.
 *
 * A real input rather than anything built here, because on a television focusing one is what
 * raises the set's own on-screen keyboard. That is the same thing the playlist address field in
 * Settings relies on, and it is worth having for two reasons beyond the work it saves: it is the
 * keyboard the viewer already knows how to drive, and it is the one their remote's voice and
 * pointer input already talk to.
 *
 * It takes the place of the heading rather than sitting above it, so the results start on the
 * same line as the categories beside them. A field that pushed the rows down would leave the two
 * columns out of step, which is the ragged layout the checklist's grid rule exists to prevent.
 */
export function SearchField({
  value,
  focused,
  keyboardOpen = true,
  shown,
  total,
  placeholder,
  ariaLabel,
  onChange,
  onFocus,
  onSubmit,
  onExitUp,
  onExitDown,
  onExitStart,
  onExitEnd,
  onDismissKeyboard,
  showCount = true,
}: {
  value: string;
  /** Whether the cursor is on the field, as opposed to down among the results. */
  focused: boolean;
  keyboardOpen?: boolean;
  /** How many results the column is holding. */
  shown: number;
  /** How many matched altogether, which is the larger number when the list has been capped. */
  total: number;
  placeholder?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onSubmit?: () => void;
  onExitUp?: () => void;
  onExitDown?: () => void;
  onExitStart?: () => void;
  onExitEnd?: () => void;
  onDismissKeyboard?: () => void;
  showCount?: boolean;
}) {
  const { t, number } = useLocale();
  const field = useRef<HTMLInputElement>(null);

  /*
   * Focus follows the cursor, in both directions.
   *
   * Arriving on the field has to focus it or the keyboard never appears, and leaving it has to
   * blur it or the keyboard stays up over the results the viewer has just gone down to read. The
   * effect runs on the flag rather than on mount for exactly that: the field is not remounted
   * when the cursor moves into the list and back.
   */
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    if (focused && keyboardOpen) el.focus();
    else if (document.activeElement === el) el.blur();
  }, [focused, keyboardOpen]);

  return (
    <div className={`search ${focused ? "focused" : ""}`}>
      <span className="search-icon">
        <Icon name="search" />
      </span>
      <TextInput
        ref={field}
        variant="embedded"
        className="search-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onExitStart={onExitStart}
        onExitEnd={onExitEnd}
        onExitUp={onExitUp}
        onExitDown={onExitDown}
        onKeyDown={(event) => {
          if (event.defaultPrevented) return;
          if (event.keyCode === KEY.ENTER) {
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            onSubmit?.();
            return;
          }
          if ((event.keyCode === 10009 || event.keyCode === 27) && onDismissKeyboard) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
            onDismissKeyboard();
            return;
          }
        }}
        placeholder={placeholder ?? t("common.search")}
        aria-label={ariaLabel ?? t("search.ariaLabel")}
        spellCheck={false}
        autoComplete="off"
        /* An unrestricted keyboard rather than a search one. `enterkeyhint` would relabel the
           key on a phone and means nothing here, and `type="search"` brings a clear button that
           cannot be reached with a remote. */
        type="text"
      />
      {/*
       * How many, in the same chip the rail uses for a category's count.
       *
       * Silent until something has been typed, because "0" against an empty field reads as a
       * search that failed rather than one that has not happened yet.
       *
       * "300+" rather than the true total when the list has been capped. The exact number is
       * known and printing it would be worse: a chip reading 4,211 above a list holding three
       * hundred invites somebody to scroll to the end looking for the rest.
       */}
      {showCount && !!value.trim() && (
        <span className="count">{total > shown ? `${number(shown)}+` : number(total)}</span>
      )}
    </div>
  );
}
