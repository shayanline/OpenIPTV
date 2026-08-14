import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

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
export function SearchField({ value, focused, shown, total, onChange }: {
  value: string;
  /** Whether the cursor is on the field, as opposed to down among the results. */
  focused: boolean;
  /** How many results the column is holding. */
  shown: number;
  /** How many matched altogether, which is the larger number when the list has been capped. */
  total: number;
  onChange: (value: string) => void;
}) {
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
    if (focused) el.focus();
    else if (document.activeElement === el) el.blur();
  }, [focused]);

  return (
    <div className={`search ${focused ? "focused" : ""}`}>
      <span className="search-icon"><Icon name="search" /></span>
      <input
        ref={field}
        className="search-field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Channel name"
        aria-label="Search channels by name"
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
      {!!value.trim() && (
        <span className="count">{total > shown ? `${shown}+` : total}</span>
      )}
    </div>
  );
}
