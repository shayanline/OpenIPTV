import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { pointerInputActive, pointerOnly } from "../hooks/usePointerAwake";
import { KEY, useRemote } from "../hooks/useRemote";
import type { RemoteAccessControl } from "../hooks/useRemoteAccess";
import { useSpatialNav } from "../hooks/useSpatialNav";
import { useToast } from "../hooks/useToast";
import type { MessageKey } from "../services/locale";
import { Icon, type IconName } from "./Icon";
import { KeyGuide, NavigationGuide } from "./KeyGuide";
import { About } from "./settings/About";
import { Appearance } from "./settings/Appearance";
import { Playback } from "./settings/Behaviour";
import { Devices } from "./settings/Devices";
import { Playlists } from "./settings/Playlists";
import { textInputExit } from "./TextInput";

export interface SettingsDetailNavigation {
  open: (id: string, label: string, returnFocus: string, close: () => void) => void;
  back: () => void;
  dismiss: (id: string) => void;
  updateLabel: (id: string, label: string) => void;
  focusStart: () => void;
  registerEdgeBack: (id: string, action: () => void, disabled: boolean) => () => void;
  focusEdgeBack: (returnFocus: HTMLElement) => boolean;
  transition: (commit: () => void) => void;
  active: boolean;
  inputEnabled: boolean;
  focusReady: boolean;
  surfaceInputEnabled: boolean;
}

type DetailEntry = {
  id: string;
  label: string;
  returnFocus: string;
  close: () => void;
  scrollTop: number;
};

export type SettingsSection = "appearance" | "playback" | "playlists" | "devices" | "about";

export interface SettingsEntry {
  session: number;
  section: SettingsSection;
  playlistId?: string;
  loadError?: string;
}

/**
 * The sections, in the order the rail lists them, each with the glyph beside its name.
 *
 * A glyph per section because six words in a column are six words to read, and a viewer looking
 * for the picture size is looking for a shape they remember rather than reading the list again. They
 * are outline glyphs rather than filled ones: the rail is a list to walk, and the filled family is
 * reserved for status and transport, which is why the gear that opens this sheet is filled and the
 * one inside it is not.
 */
const SECTIONS: { id: SettingsSection; label: MessageKey; icon: IconName }[] = [
  { id: "appearance", label: "settings.appearance", icon: "appearance" },
  { id: "playback", label: "settings.playback", icon: "tv" },
  { id: "playlists", label: "settings.content", icon: "playlists" },
  { id: "devices", label: "settings.remoteAccess", icon: "remoteAccess" },
  { id: "about", label: "settings.about", icon: "about" },
];
const DESKTOP_SECTIONS = SECTIONS.filter((section) => section.id !== "devices");

export function settingsGuideLabel(
  target: HTMLElement,
  t: (key: MessageKey) => string,
): string | undefined {
  const ariaLabel = target.getAttribute("aria-label") ?? "";
  if (
    target.dataset.settingsInformational !== undefined ||
    target.matches(":disabled, [aria-disabled='true']")
  ) {
    return "";
  }
  const changeAction = t("settings.change").replace(/\s+it$/i, "");
  let label = target.dataset.okGuide;
  if (!label && target instanceof HTMLInputElement) label = t("common.edit");
  if (!label && target.classList.contains("option-picker-current")) {
    const field = ariaLabel.split(",")[0]?.trim();
    label =
      field === t("settings.language")
        ? `${changeAction} ${field.charAt(0).toLocaleLowerCase()}${field.slice(1)}`
        : changeAction;
  }
  if (
    !label &&
    (target.classList.contains("switch") ||
      target.classList.contains("chip") ||
      target.classList.contains("language-picker-current"))
  )
    label = changeAction;
  if (
    !label &&
    (target.classList.contains("language-picker-option") ||
      target.classList.contains("option-picker-option"))
  )
    label = t("common.select");
  if (!label && target.classList.contains("lineup-visibility-row")) label = t("lineup.visible");
  if (!label && target.classList.contains("settings-icon-action"))
    label = ariaLabel.split(",")[0]?.trim() || undefined;
  if (!label && target instanceof HTMLButtonElement) {
    const actions = [
      t("remote.activate"),
      t("remote.manageContent"),
      t("remote.actions"),
      t("common.open"),
      t("common.edit"),
      t("common.remove"),
      t("common.refreshPlaylist"),
      t("lineup.title"),
    ];
    label = actions.find(
      (action) =>
        ariaLabel === action ||
        ariaLabel.startsWith(`${action},`) ||
        ariaLabel.startsWith(`${action} `),
    );
    label ??= target.textContent?.replace(/\s+/g, " ").trim() || ariaLabel || undefined;
  }
  return label;
}

function revealSettingsControl(target: HTMLElement, body: HTMLElement) {
  if (target.closest(".lineup-sort-row")) return;
  const boundary = target.closest<HTMLElement>('[role="dialog"], [role="listbox"]') ?? body;
  let parent = target.parentElement;
  while (parent && boundary.contains(parent)) {
    if (parent.clientHeight > 0 && parent.scrollHeight > parent.clientHeight) {
      const overflow = getComputedStyle(parent).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        const bounds = parent.getBoundingClientRect();
        const item = target.getBoundingClientRect();
        if (item.top < bounds.top + 16) parent.scrollTop -= bounds.top + 16 - item.top;
        else if (item.bottom > bounds.bottom - 16)
          parent.scrollTop += item.bottom - bounds.bottom + 16;
      }
    }
    if (parent === boundary) break;
    parent = parent.parentElement;
  }
}

export function Settings({
  onClose,
  onPageTransition,
  onAppNavigationFocus,
  onPopupChange,
  remoteAccess,
  entry,
  showRemoteAccess = false,
  inputEnabled = true,
}: {
  onClose: () => void;
  onPageTransition?: (commit: () => void) => void;
  onAppNavigationFocus?: () => void;
  onPopupChange?: (open: boolean) => void;
  remoteAccess: RemoteAccessControl;
  entry: SettingsEntry;
  showRemoteAccess?: boolean;
  inputEnabled?: boolean;
}) {
  const { t, direction } = useLocale();
  const sections = showRemoteAccess ? SECTIONS : DESKTOP_SECTIONS;
  const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
  const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
  const inlineEndArrow = direction === "rtl" ? "←" : "→";
  const [section, setSection] = useState<SettingsSection>(entry.section);
  const [sectionFocus, setSectionFocus] = useState<SettingsSection>(entry.section);
  const sectionFocusRef = useRef(sectionFocus);
  sectionFocusRef.current = sectionFocus;
  const [inSections, setInSections] = useState(true);
  const [pendingBodyFocus, setPendingBodyFocus] = useState(false);
  const sectionRefs = useRef<Partial<Record<SettingsSection, HTMLButtonElement>>>({});
  const [details, setDetails] = useState<DetailEntry[]>([]);
  const detailsRef = useRef(details);
  detailsRef.current = details;
  const pendingDetailFocus = useRef<string | null>(null);
  const pendingDetailReturn = useRef<{
    detailId: string | undefined;
    token: string;
    scrollTop: number;
  } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const playlistFocusRef = useRef<HTMLButtonElement | null>(null);
  const [inEdgeBack, setInEdgeBack] = useState(false);
  const lastBodyFocus = useRef<HTMLElement | null>(null);
  const previousInputEnabled = useRef(inputEnabled);
  const edgeBackButton = useRef<HTMLButtonElement>(null);
  const edgeBackFocusTarget = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!inputEnabled) {
      if (active instanceof HTMLElement && active.closest(".sheet")) active.blur();
      return;
    }
    if (!inSections) return;
    if (active instanceof HTMLElement && bodyRef.current?.contains(active)) active.blur();
    sectionRefs.current[sectionFocusRef.current]?.focus();
  }, [inputEnabled, inSections]);

  useLayoutEffect(() => {
    if (!inputEnabled || !inSections || pointerInputActive()) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== sectionRefs.current[sectionFocus])
      active.blur();
    sectionRefs.current[sectionFocus]?.focus();
  }, [inputEnabled, inSections, sectionFocus]);

  const bodyResetKey = `${section}:${details.length}`;
  useLayoutEffect(() => {
    if (!bodyResetKey || !bodyRef.current) return;
    bodyRef.current.scrollTop = 0;
  }, [bodyResetKey]);
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
  const onPopupChangeRef = useRef(onPopupChange);
  onPopupChangeRef.current = onPopupChange;
  const inputEnabledRef = useRef(inputEnabled);
  inputEnabledRef.current = inputEnabled;
  useEffect(() => {
    onPopupChange?.(asking);
  }, [asking, onPopupChange]);
  useEffect(
    () => () => {
      onPopupChangeRef.current?.(false);
    },
    [],
  );
  const [okGuide, setOkGuide] = useState(() => t("common.select"));
  const notifications = useToast(`settings:${entry.session}:${section}`, inputEnabled);
  const notifyError = useCallback(
    (message: string) => notifications.show(message, "error"),
    [notifications.show],
  );
  const notifySuccess = useCallback(
    (message: string) => notifications.show(message, "success"),
    [notifications.show],
  );
  const tRef = useRef(t);
  tRef.current = t;
  const askingRef = useRef(asking);
  askingRef.current = asking;
  const preparingFocusRef = useRef(false);
  const okGuideObserver = useRef<MutationObserver | null>(null);
  const okGuideTarget = useRef<HTMLElement | null>(null);
  const disconnectOkGuideObserver = useCallback(() => {
    okGuideObserver.current?.disconnect();
    okGuideObserver.current = null;
    okGuideTarget.current = null;
  }, []);
  const recalcOkGuide = useCallback(() => {
    const control = okGuideTarget.current;
    if (!control || document.activeElement !== control) return;
    if (!inputEnabledRef.current || askingRef.current) return;
    setOkGuide(settingsGuideLabel(control, tRef.current) ?? tRef.current("common.select"));
  }, []);
  useEffect(() => recalcOkGuide(), [t, recalcOkGuide]);
  useEffect(() => disconnectOkGuideObserver, [disconnectOkGuideObserver]);
  useLayoutEffect(() => {
    const returning = inputEnabled && !previousInputEnabled.current;
    previousInputEnabled.current = inputEnabled;
    if (!returning || asking || inSections || inEdgeBack) return;
    const target = lastBodyFocus.current;
    if (
      target?.isConnected &&
      bodyRef.current?.contains(target) &&
      !target.matches(":disabled")
    ) {
      target.focus({ preventScroll: true });
    }
  }, [inputEnabled, asking, inSections, inEdgeBack]);

  // Every control in the body has to be reachable with the four directional buttons,
  // which the browser will not do on its own. Checklist items 2.2 and 3.2.
  const { move, focusFirst, hasTargets } = useSpatialNav(
    bodyRef,
    inputEnabled && !inSections && !inEdgeBack && !asking,
  );
  const focusStart = useCallback(
    (preparing = false) => {
      if (!inputEnabledRef.current || askingRef.current) return;
      const body = bodyRef.current;
      if (!body) return;
      preparingFocusRef.current = preparing;
      try {
        for (const first of Array.from(
          body.querySelectorAll<HTMLElement>("[data-settings-detail-first]"),
        )) {
          if (first.matches(":disabled")) continue;
          first.focus();
          if (document.activeElement === first) return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && body.contains(active)) active.blur();
        focusFirst();
        const back = edgeBackButton.current;
        if (!body.contains(document.activeElement) && back && !back.disabled) {
          back.focus({ preventScroll: true });
        }
      } finally {
        preparingFocusRef.current = false;
      }
    },
    [focusFirst],
  );

  /**
   * Where the focus was when a question interrupted, so it can be given back.
   *
   * Without it the answer returned focus to the first control in the section rather than to
   * the button that asked, which on a list of playlists is several rows away from where the
   * viewer was looking.
   */
  const interrupted = useRef<HTMLElement | null>(null);
  const pendingReturn = useRef<HTMLElement | null>(null);
  const ask = useCallback((open: boolean, restoreFocus = true) => {
    if (open) {
      // A popup opened in the same breath keeps the row that opened the first one, so a
      // menu choosing Remove still returns to it when the question is answered.
      if (!askingRef.current)
        interrupted.current = document.activeElement as HTMLElement | null;
    } else {
      pendingReturn.current = restoreFocus ? interrupted.current : null;
    }
    setAsking(open);
  }, []);
  useLayoutEffect(() => {
    if (asking) return;
    const back = pendingReturn.current;
    pendingReturn.current = null;
    interrupted.current = null;
    if (!inputEnabled || !(back instanceof HTMLElement)) return;
    if (!back.isConnected || !bodyRef.current?.contains(back)) return;
    back.focus();
  }, [asking, inputEnabled]);

  const findFocusTarget = useCallback((token: string) => {
    const candidates = bodyRef.current?.querySelectorAll<HTMLElement>("[data-settings-focus]");
    if (!candidates) return null;
    for (const element of Array.from(candidates)) {
      if (element.dataset.settingsFocus === token) return element;
    }
    return null;
  }, []);

  const dismissDetail = useCallback((id: string) => {
    const current = detailsRef.current;
    const at = current.findIndex((entry) => entry.id === id);
    if (at < 0) return;
    const removed = current.slice(at);
    const returning = current[at];
    const remaining = current.slice(0, at);
    pendingDetailFocus.current = null;
    pendingDetailReturn.current = {
      detailId: remaining[remaining.length - 1]?.id,
      token: returning.returnFocus,
      scrollTop: returning.scrollTop,
    };
    for (const entry of [...removed].reverse()) entry.close();
    detailsRef.current = remaining;
    setDetails(remaining);
    setInSections(false);
    setInEdgeBack(false);
  }, []);

  const backDetailNow = useCallback(() => {
    const current = detailsRef.current;
    const detail = current[current.length - 1];
    if (detail) dismissDetail(detail.id);
  }, [dismissDetail]);

  const transitionDetail = useCallback(
    (commit: () => void) => {
      if (!inputEnabledRef.current || askingRef.current) return;
      if (onPageTransition) onPageTransition(commit);
      else commit();
    },
    [onPageTransition],
  );
  const backDetail = useCallback(() => {
    if (!inputEnabledRef.current || askingRef.current) return;
    transitionDetail(backDetailNow);
  }, [backDetailNow, transitionDetail]);

  const openDetail = useCallback(
    (id: string, label: string, returnFocus: string, close: () => void) => {
      pendingDetailReturn.current = null;
      pendingDetailFocus.current = id;
      const next = [
        ...detailsRef.current,
        {
          id,
          label,
          returnFocus,
          close,
          scrollTop: bodyRef.current?.scrollTop ?? 0,
        },
      ];
      detailsRef.current = next;
      setDetails(next);
      setInSections(false);
      setInEdgeBack(false);
    },
    [],
  );

  const clearDetails = useCallback(() => {
    pendingDetailFocus.current = null;
    pendingDetailReturn.current = null;
    for (const detail of [...detailsRef.current].reverse()) detail.close();
    detailsRef.current = [];
    setDetails([]);
    setInEdgeBack(false);
  }, []);

  const updateDetailLabel = useCallback((id: string, label: string) => {
    const current = detailsRef.current;
    const at = current.findIndex((entry) => entry.id === id);
    if (at < 0 || current[at].label === label) return;
    const next = current.map((entry, index) => (index === at ? { ...entry, label } : entry));
    detailsRef.current = next;
    setDetails(next);
  }, []);

  const enterBody = useCallback(() => {
    if (!inputEnabledRef.current || askingRef.current) return;
    setPendingBodyFocus(true);
  }, []);

  const edgeBackRef = useRef<{
    id: string;
    action: () => void;
    disabled: boolean;
  } | null>(null);
  const [edgeBack, setEdgeBack] = useState<{ id: string; disabled: boolean } | null>(null);
  const showEdgeBack = !!edgeBack || details.length > 0;
  const registerEdgeBack = useCallback((id: string, action: () => void, disabled: boolean) => {
    edgeBackRef.current = { id, action, disabled };
    setEdgeBack((current) =>
      current && current.id === id && current.disabled === disabled
        ? current
        : { id, disabled },
    );
    return () => {
      if (edgeBackRef.current?.id !== id) return;
      edgeBackRef.current = null;
      setEdgeBack(null);
    };
  }, []);
  const focusEdgeBack = useCallback((returnFocus: HTMLElement) => {
    const registration = edgeBackRef.current;
    const button = edgeBackButton.current;
    if (
      (!registration && !detailsRef.current.length) ||
      registration?.disabled ||
      !button ||
      button.disabled ||
      !inputEnabledRef.current ||
      askingRef.current
    )
      return false;
    edgeBackFocusTarget.current = returnFocus;
    button.focus({ preventScroll: true });
    return document.activeElement === button;
  }, []);
  const activateEdgeBack = useCallback(() => {
    if (!inputEnabledRef.current || askingRef.current) return;
    const registration = edgeBackRef.current;
    if (registration) {
      if (!registration.disabled) registration.action();
    } else {
      backDetail();
    }
  }, [backDetail]);
  const deepestDetailId = details[details.length - 1]?.id;
  useLayoutEffect(() => {
    edgeBackButton.current?.removeAttribute("data-settings-focus-claimed");
  }, [deepestDetailId]);
  useLayoutEffect(() => {
    edgeBackFocusTarget.current = null;
  }, [edgeBack?.id, deepestDetailId]);
  useLayoutEffect(() => {
    const pending = pendingDetailFocus.current;
    // A child layout effect can register a detail before this render includes it.
    if (!pending || pending !== deepestDetailId) return;
    if (!inputEnabled || asking) return;
    pendingDetailFocus.current = null;
    if (!inSections && !inEdgeBack) focusStart(true);
  }, [deepestDetailId, inputEnabled, asking, inSections, inEdgeBack, focusStart]);
  useLayoutEffect(() => {
    const pending = pendingDetailReturn.current;
    if (!pending) return;
    if (pending.detailId !== deepestDetailId) {
      pendingDetailReturn.current = null;
      return;
    }
    if (!inputEnabled || asking) return;
    pendingDetailReturn.current = null;
    if (inSections || inEdgeBack) return;
    const target = findFocusTarget(pending.token);
    if (target && !target.matches(":disabled")) {
      target.focus({ preventScroll: true });
      if (bodyRef.current) bodyRef.current.scrollTop = pending.scrollTop;
    } else {
      focusStart();
    }
  }, [
    deepestDetailId,
    inputEnabled,
    asking,
    inSections,
    inEdgeBack,
    findFocusTarget,
    focusStart,
  ]);
  useLayoutEffect(() => {
    if (!showEdgeBack) {
      setInEdgeBack(false);
      return;
    }
    if (inputEnabled && !asking && inEdgeBack) {
      edgeBackButton.current?.focus({ preventScroll: true });
    }
  }, [showEdgeBack, inputEnabled, asking, inEdgeBack]);

  const detailNavigation: SettingsDetailNavigation = {
    open: openDetail,
    back: backDetail,
    dismiss: dismissDetail,
    updateLabel: updateDetailLabel,
    focusStart,
    registerEdgeBack,
    focusEdgeBack,
    transition: transitionDetail,
    active: details.length > 0,
    inputEnabled: inputEnabled && !inSections && !asking,
    focusReady: inputEnabled && !inSections && !asking,
    surfaceInputEnabled: inputEnabled,
  };

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
    setPendingBodyFocus(false);
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && bodyRef.current?.contains(focused)) focused.blur();
    setInSections(true);
    setInEdgeBack(false);
  }, []);

  useLayoutEffect(() => {
    if (!pendingBodyFocus) return;
    if (!inputEnabled || asking) {
      setPendingBodyFocus(false);
      return;
    }
    setPendingBodyFocus(false);
    setInSections(false);
    setInEdgeBack(false);
    focusStart(true);
  }, [pendingBodyFocus, inputEnabled, asking, focusStart]);

  const activateSection = useCallback(
    (nextSection: SettingsSection, enterWhenCommitted = false) => {
      if (!inputEnabledRef.current || askingRef.current) return;
      leaveBody();
      sectionFocusRef.current = nextSection;
      setSectionFocus(nextSection);
      if (detailsRef.current.length) clearDetails();
      setSection(nextSection);
      if (enterWhenCommitted && pointerInputActive()) enterBody();
    },
    [leaveBody, clearDetails, enterBody],
  );

  const updateOkGuide = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (inputEnabledRef.current && bodyRef.current?.contains(target)) {
        revealSettingsControl(target, bodyRef.current);
      }
      if (askingRef.current) return;
      if (target instanceof HTMLButtonElement && target.closest(".pl")) {
        playlistFocusRef.current = target;
      }
      disconnectOkGuideObserver();
      setOkGuide(settingsGuideLabel(target, tRef.current) ?? tRef.current("common.select"));
      if (!inputEnabledRef.current || !bodyRef.current?.contains(target)) return;
      lastBodyFocus.current = target;
      setInEdgeBack(false);
      setInSections(false);
      okGuideTarget.current = target;
      const observer = new MutationObserver(recalcOkGuide);
      observer.observe(target, {
        attributes: true,
        attributeFilter: [
          "data-ok-guide",
          "aria-label",
          "aria-pressed",
          "aria-checked",
          "aria-disabled",
          "disabled",
        ],
        childList: true,
        subtree: true,
        characterData: true,
      });
      okGuideObserver.current = observer;
    },
    [disconnectOkGuideObserver, recalcOkGuide],
  );

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
    if (!inSections && !asking && !details.length && section === sectionFocus && !hasTargets())
      leaveBody();
  }, [inSections, asking, section, sectionFocus, details.length, hasTargets, leaveBody]);

  // Settings takes the whole remote while it is open, so App stops handling keys and
  // this owns navigation. Left and right move between the rail and the body, which is
  // the same shape as the main screen and so needs no explaining.
  const onKey = useCallback(
    (code: number, event: KeyboardEvent) => {
      if (event.defaultPrevented || !inputEnabled || asking) return;
      const editing = document.activeElement instanceof HTMLInputElement;

      if (code === KEY.BACK || code === KEY.ESC) {
        event.preventDefault();
        // While the IME is up, RETURN belongs to the keyboard. Blurring dismisses it and
        // keeps the viewer in settings, which is the step back they expect.
        if (editing) (document.activeElement as HTMLInputElement).blur();
        else if (detailsRef.current.length) backDetail();
        else onClose();
        return;
      }
      // A text field consumes directions until its caret reaches that logical boundary.
      if (editing && !textInputExit(document.activeElement as HTMLInputElement, code)) return;
      const active = document.activeElement;
      const inBody = active instanceof HTMLElement && bodyRef.current?.contains(active);
      if (active === edgeBackButton.current) {
        if (code === KEY.ENTER) {
          event.preventDefault();
          activateEdgeBack();
          return;
        }
        if (code === inlineEnd) {
          event.preventDefault();
          const target = edgeBackFocusTarget.current;
          if (
            target instanceof HTMLElement &&
            target.isConnected &&
            bodyRef.current?.contains(target) &&
            !target.matches(":disabled")
          ) {
            target.focus();
          } else {
            focusStart();
          }
          return;
        }
        if (code === inlineStart) {
          event.preventDefault();
          onAppNavigationFocus?.();
          return;
        }
        if (code === KEY.UP || code === KEY.DOWN) {
          event.preventDefault();
          return;
        }
      }
      if (!inSections && !inBody) {
        // Retry can remove the focused control while the body still owns input.
        // Recover navigation without activating the next control.
        if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER].includes(code as never)) {
          event.preventDefault();
          if (!detailsRef.current.length && (code === inlineStart || !hasTargets())) {
            leaveBody();
          } else {
            focusFirst();
          }
          return;
        }
      }
      if (inBody) {
        if (code === KEY.DOWN && active.classList.contains("settings-add-playlist")) {
          const remembered = playlistFocusRef.current;
          const target =
            remembered?.isConnected && bodyRef.current?.contains(remembered)
              ? remembered
              : bodyRef.current?.querySelector<HTMLElement>(".pl .pl-open");
          if (target) {
            event.preventDefault();
            target.focus();
          }
          return;
        }
        if (code === KEY.DOWN && active.dataset.settingsFocus === "device-pair") {
          const target = bodyRef.current?.querySelector<HTMLElement>("[data-device-rename]");
          if (target) {
            event.preventDefault();
            target.focus();
            return;
          }
        }
        // The virtual remote sends keys and never the click a native Enter would
        // produce, so the focused button is clicked here for both. preventDefault
        // keeps a real Enter from reaching the button a second time.
        if (code === KEY.ENTER && active instanceof HTMLButtonElement) {
          event.preventDefault();
          active.click();
          return;
        }

        // Inside the body, arrows move focus between controls geometrically. When a move
        // finds nothing to the left, the rail is the natural next stop.
        if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(code as never)) {
          event.preventDefault();
          const moved = move(code);
          if (!moved && code === inlineStart) {
            if (focusEdgeBack(active)) return;
            if (!detailsRef.current.length) leaveBody();
          }
        }
        return;
      }

      if (code === inlineStart && inSections) {
        event.preventDefault();
        setPendingBodyFocus(false);
        onAppNavigationFocus?.();
        return;
      }
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
          const at = sections.findIndex((item) => item.id === sectionFocusRef.current);
          const next =
            code === KEY.UP ? Math.max(0, at - 1) : Math.min(sections.length - 1, at + 1);
          const nextSection = sections[next].id;
          if (nextSection === sectionFocusRef.current) return;
          activateSection(nextSection);
        }
        if (code === KEY.ENTER) {
          event.preventDefault();
          enterBody();
        }
      }
    },
    [
      asking,
      inputEnabled,
      inSections,
      onAppNavigationFocus,
      onClose,
      move,
      focusFirst,
      hasTargets,
      enterBody,
      leaveBody,
      backDetail,
      focusStart,
      activateEdgeBack,
      focusEdgeBack,
      inlineStart,
      inlineEnd,
      sections,
      activateSection,
    ],
  );

  useRemote(onKey);

  const detail = details[details.length - 1];

  return (
    <div className={`sheet ${inputEnabled ? "" : "input-suspended"}`.trim()} dir={direction}>
      {showEdgeBack ? (
        <div className="sheet-edge-back">
          <button
            ref={edgeBackButton}
            type="button"
            className="btn tonal"
            data-settings-edge-back
            aria-label={t("common.back")}
            title={t("common.back")}
            disabled={!inputEnabled || asking}
            aria-disabled={edgeBack?.disabled || undefined}
            onClick={activateEdgeBack}
            onPointerDown={(event) => {
              event.currentTarget.dataset.settingsFocusClaimed = "true";
            }}
            onFocus={(event) => {
              if (!preparingFocusRef.current) {
                event.currentTarget.dataset.settingsFocusClaimed = "true";
              }
              setInSections(false);
              setInEdgeBack(true);
            }}
          >
            <Icon name="return" logicalDirection />
          </button>
        </div>
      ) : (
        <nav className={`sheet-rail pane ${inputEnabled && inSections ? "focused" : ""}`}>
          <div className="settings-titlebar">
            <h2>{t("settings.title")}</h2>
          </div>
          <div className="rail-scroll">
            {sections.map((s) => (
              <button
                key={s.id}
                ref={(element) => {
                  if (element) sectionRefs.current[s.id] = element;
                  else delete sectionRefs.current[s.id];
                }}
                type="button"
                className={`row ${s.id === section ? "showing" : ""} ${inputEnabled && inSections && s.id === sectionFocus ? "cursor" : ""}`}
                aria-current={s.id === section ? "page" : undefined}
                onPointerEnter={() =>
                  pointerOnly(() => {
                    if (!inputEnabledRef.current || askingRef.current) return;
                    leaveBody();
                    sectionFocusRef.current = s.id;
                    setSectionFocus(s.id);
                  })
                }
                onClick={() => activateSection(s.id, true)}
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
                    { keys: [inlineEndArrow], label: t("common.open") },
                    {
                      keys: ["Return"],
                      label: details.length ? t("common.back") : t("settings.close"),
                    },
                  ]
                : [
                    ...(asking || okGuide ? [{ keys: ["OK"], label: t("common.select") }] : []),
                    {
                      keys: ["Return"],
                      label: details.length ? t("common.back") : t("settings.close"),
                    },
                  ]
            }
          />
        </nav>
      )}

      <div className="sheet-page">
        <div
          className="sheet-body"
          ref={bodyRef}
          onFocusCapture={updateOkGuide}
          onClickCapture={(event) => {
            const target = event.target;
            if (!(target instanceof Node) || !bodyRef.current?.contains(target)) return;
            const inlinePopup = target instanceof Element && target.closest(".dialog-scrim");
            if (inputEnabledRef.current && (!askingRef.current || inlinePopup)) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onBlurCapture={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !bodyRef.current?.contains(next)) {
              disconnectOkGuideObserver();
            }
          }}
        >
          {detail &&
            !details.some(
              (entry) =>
                entry.id.startsWith("playlist-lineup-") || entry.id === "playlist-list",
            ) && (
              <header className="settings-detail-appbar">
                <h3>{detail.label}</h3>
              </header>
            )}
          {section === "appearance" && <Appearance />}
          {section === "playback" && <Playback />}
          {section === "playlists" && (
            <Playlists
              onAsking={ask}
              navigation={detailNavigation}
              recoveryPlaylistId={entry.playlistId}
              recoveryError={entry.loadError}
              onError={notifyError}
              onSuccess={notifySuccess}
              onClearFeedback={notifications.clear}
            />
          )}
          {section === "devices" && (
            <Devices remoteAccess={remoteAccess} onAsking={ask} navigation={detailNavigation} />
          )}
          {section === "about" && <About onAsking={ask} navigation={detailNavigation} />}
        </div>
        {showEdgeBack && <NavigationGuide className="page-key-guide" />}
      </div>
    </div>
  );
}
