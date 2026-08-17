import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import { Icon, type IconName } from "./Icon";
import type { MessageKey } from "../services/locale";
import { KeyGuide } from "./KeyGuide";
import { About } from "./settings/About";
import { Appearance } from "./settings/Appearance";
import { General } from "./settings/General";
import { Playback } from "./settings/Behaviour";
import { Diagnostics } from "./settings/Diagnostics";
import { Playlists } from "./settings/Playlists";

type Section = "appearance" | "playback" | "general" | "playlists" | "diagnostics" | "about";

/**
 * The sections, in the order the rail lists them, each with the glyph beside its name.
 *
 * A glyph per section because six words in a column are six words to read, and a viewer looking
 * for the picture size is looking for a shape they remember rather than reading the list again. They
 * are outline glyphs rather than filled ones: the rail is a list to walk, and the filled family is
 * reserved for status and transport, which is why the gear that opens this sheet is filled and the
 * one inside it is not.
 */
const SECTIONS: { id: Section; label: MessageKey; icon: IconName }[] = [
  { id: "appearance", label: "settings.appearance", icon: "appearance" },
  { id: "playback", label: "settings.playback", icon: "tv" },
  { id: "general", label: "settings.general", icon: "settings" },
  { id: "playlists", label: "settings.playlists", icon: "playlists" },
  { id: "diagnostics", label: "settings.diagnostics", icon: "diagnostics" },
  { id: "about", label: "settings.about", icon: "about" },
];

export function Settings({ onClose }: { onClose: () => void }) {
  const { t, direction } = useLocale();
  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const inlineEndArrow = direction === "rtl" ? "←" : "→";
  const [section, setSection] = useState<Section>("appearance");
  const [inSections, setInSections] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * Whether a question is outstanding somewhere inside the body.
   *
   * A popup must make everything outside itself unavailable until it is answered, and this
   * screen was the one place that did not: the confirmation registered its own key handler
   * while this one stayed live, so a single press of Left moved the focus inside the dialog
   * and moved it again behind the dialog, and the arrow keys drove two screens at once.
   * The child raises this while it is asking, and this stands aside.
   */
  const [asking, setAsking] = useState(false);
  // Every control in the body has to be reachable with the four directional buttons,
  // which the browser will not do on its own. Checklist items 2.2 and 3.2.
  const { move, focusFirst, hasTargets } = useSpatialNav(bodyRef, !inSections && !asking);

  /**
   * Where the focus was when a question interrupted, so it can be given back.
   *
   * Without it the answer returned focus to the first control in the section rather than to
   * the button that asked, which on a list of playlists is several rows away from where the
   * viewer was looking.
   */
  const interrupted = useRef<HTMLElement | null>(null);
  const ask = useCallback(
    (open: boolean) => {
      if (open) interrupted.current = document.activeElement as HTMLElement | null;
      setAsking(open);
      if (open) return;
      // After the dialog has gone, and only if it is still something that can be focused.
      window.setTimeout(() => {
        const back = interrupted.current;
        interrupted.current = null;
        if (back?.isConnected) back.focus();
        else focusFirst();
      }, 0);
    },
    [focusFirst],
  );

  const enterBody = useCallback(() => {
    setInSections(false);
    window.setTimeout(focusFirst, 0);
  }, [focusFirst]);

  /**
   * Back to the section list, and take the highlight with it.
   *
   * Controls in the body are lit by `:focus`, and a browser keeps focus exactly where it was unless
   * something moves it, so going back to the rail left two things lit at once: the section under the
   * rail's cursor and the option the viewer had just stepped away from. Two highlights on one screen
   * is the interface saying the cursor is in two places.
   *
   * Blurring rather than a class, because the focus is real rather than decorative. The stale one was
   * still the document's active element, so it was the thing a stray click or any key this screen did
   * not intercept would have operated, on a row the viewer had already left.
   */
  const leaveBody = useCallback(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && bodyRef.current?.contains(focused)) focused.blur();
    setInSections(true);
  }, []);

  /**
   * A section with nothing to operate keeps the focus on the rail.
   *
   * About is all prose, so leaving the rail for it took the highlight off the rail and then
   * found nothing to put it on: no focus anywhere on the screen, with Up, Down and Right all
   * swallowed and doing nothing, and only Left or RETURN to recover.
   *
   * Checked here, after the body has rendered, rather than before moving. The section and
   * the move are two pieces of state and the click path sets both at once, so asking "does
   * the body have anything in it" before the render is asking about the section being left.
   * Before paint, so the rail's highlight never visibly flickers off and back.
   */
  useLayoutEffect(() => {
    if (!inSections && !asking && !hasTargets()) leaveBody();
  }, [inSections, asking, section, hasTargets, leaveBody]);

  // Settings takes the whole remote while it is open, so App stops handling keys and
  // this owns navigation. Left and right move between the rail and the body, which is
  // the same shape as the main screen and so needs no explaining.
  const onKey = useCallback(
    (code: number, event: KeyboardEvent) => {
      if (asking) return;
      const editing = document.activeElement instanceof HTMLInputElement;

      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        // While the IME is up, RETURN belongs to the keyboard. Blurring dismisses it and
        // keeps the viewer in settings, which is the step back they expect.
        if (editing) (document.activeElement as HTMLInputElement).blur();
        else onClose();
        return;
      }
      // A text field consumes the arrows for the cursor and the on-screen keyboard.
      if (editing && code !== KEY.UP && code !== KEY.DOWN) return;
      if (code === inlineEnd && inSections) {
        event.preventDefault();
        enterBody();
        return;
      }

      if (inSections) {
        if (code === KEY.UP || code === KEY.DOWN) {
          event.preventDefault();
          /*
           * Worked out from the value React is about to have, not from the one this closure
           * captured. The input guide says movement accelerates while a direction is held, so
           * presses arrive faster than renders, and computing the target from the captured
           * section meant every press in a burst moved to the same place: holding Down walked
           * one row and stopped.
           */
          setSection((was) => {
            const at = SECTIONS.findIndex((s) => s.id === was);
            const next =
              code === KEY.UP ? Math.max(0, at - 1) : Math.min(SECTIONS.length - 1, at + 1);
            return SECTIONS[next].id;
          });
        }
        if (code === KEY.ENTER) {
          event.preventDefault();
          enterBody();
        }
        return;
      }

      // Inside the body, arrows move focus between controls geometrically. When a move
      // finds nothing to the left, the rail is the natural next stop.
      if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(code as never)) {
        event.preventDefault();
        const moved = move(code);
        if (!moved && code === inlineStart) leaveBody();
      }
    },
    [asking, inSections, onClose, move, enterBody, leaveBody, inlineStart, inlineEnd],
  );

  useRemote(onKey);

  return (
    <div className="sheet" dir={direction}>
      <nav className={`sheet-rail pane ${inSections ? "focused" : ""}`}>
        <h2>{t("settings.title")}</h2>
        <div className="rail-scroll">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`row ${s.id === section ? "selected showing" : ""}`}
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => {
                setSection(s.id);
                enterBody();
              }}
            >
              <Icon name={s.icon} />
              {/*
               * The name in an element of its own rather than as a bare text node, so the
               * stylesheet can reach it: the 2020 and 2021 sets have no flex gap, and the margin
               * that stands in for it applies to elements, which an anonymous text node is not.
               * The glyph and the word would touch on exactly the televisions tv:gap exists for.
               */}
              <span className="row-label">{t(s.label)}</span>
            </button>
          ))}
        </div>
        {/* The same guide as everywhere else, in the same shape, because this screen needs
            explaining as much as the others and had only the last line of it. */}
        {/* What the keys do where the viewer actually is. It described the rail whichever side
            had the focus, so half the time it named a key that did something else. */}
        <KeyGuide
          className="sheet-hints ruled"
          items={
            inSections
              ? [
                  { keys: ["\u2191", "\u2193"], label: t("common.move") },
                  { keys: [inlineEndArrow], label: t("common.open") },
                  { keys: ["Return"], label: t("settings.close") },
                ]
              : [
                  { keys: ["\u2191", "\u2193", "\u2190", "\u2192"], label: t("common.move") },
                  { keys: ["OK"], label: t("settings.change") },
                  { keys: ["Return"], label: t("settings.close") },
                ]
          }
        />
      </nav>

      <div className="sheet-body" ref={bodyRef}>
        {section === "appearance" && <Appearance />}
        {section === "playback" && <Playback />}
        {section === "general" && <General onAsking={ask} />}
        {section === "playlists" && <Playlists onAsking={ask} />}
        {section === "diagnostics" && <Diagnostics />}
        {section === "about" && <About />}
      </div>
    </div>
  );
}
