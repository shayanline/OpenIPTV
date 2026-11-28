import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { pointerInputActive, pointerOnly } from "../hooks/usePointerAwake";
import { KEY, useRemote } from "../hooks/useRemote";
import { useViewport } from "../hooks/useViewport";
import { useNavigableWindow } from "../hooks/useWindowed";
import type { Playlist } from "../stores/settings";
import { Icon } from "./Icon";
import { NavigationGuide } from "./KeyGuide";
import { PlaylistAvatar } from "./PlaylistAvatar";
import { ScrollIndicator } from "./ScrollIndicator";
import { TextInput, textInputExit } from "./TextInput";

const PLAYLIST_ROW_BASE = 104;
const PAGE_SIZE = 5;
type FocusTarget = "row" | "search" | "clear" | "previous" | "next" | "back" | "manage";

export function PlaylistShortcut({
  playlists,
  activePlaylistId,
  scale,
  inputEnabled,
  onSelect,
  onManage,
  onClose,
  onContentFocus,
  startup = false,
}: {
  playlists: readonly Playlist[];
  activePlaylistId: string;
  scale: number;
  inputEnabled: boolean;
  onSelect: (id: string) => void;
  onManage?: () => void;
  onClose: () => void;
  onContentFocus: () => void;
  startup?: boolean;
}) {
  const { t, number, direction, locale } = useLocale();
  const hasManage = !startup && !!onManage;
  const activeIndex = Math.max(
    0,
    playlists.findIndex((item) => item.id === activePlaylistId),
  );
  const [query, setQuery] = useState("");
  const back = useRef<HTMLButtonElement>(null);
  const manage = useRef<HTMLButtonElement>(null);
  const [page, setPage] = useState(() => Math.floor(activeIndex / PAGE_SIZE));
  const [focus, setFocus] = useState<{ id: string; target: FocusTarget }>({
    id: activePlaylistId,
    target: "row",
  });
  const needle = query.trim().toLocaleLowerCase(locale);
  // Number against saved order before search or pagination changes the visible rows.
  const entries = useMemo(
    () =>
      playlists
        .map((playlist, index) => ({ playlist, ordinal: index + 1 }))
        .filter(
          ({ playlist }) => !needle || playlist.name.toLocaleLowerCase(locale).includes(needle),
        ),
    [playlists, needle, locale],
  );
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageEntries = useMemo(
    () => entries.slice(pageStart, pageStart + PAGE_SIZE),
    [entries, pageStart],
  );
  const found = entries.findIndex(({ playlist }) => playlist.id === focus.id);
  const cursor = Math.max(0, Math.min(pageEntries.length - 1, found - pageStart));
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const clear = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const prepared = useRef(false);
  const pendingPageFocus = useRef(false);
  const windowKey = `${currentPage}:${query}`;
  const initialWindow = useRef({ key: windowKey, first: cursor });
  if (initialWindow.current.key !== windowKey) {
    initialWindow.current = { key: windowKey, first: cursor };
  }
  const height = useViewport(viewport);
  const win = useNavigableWindow(
    pageEntries.length,
    cursor,
    height,
    scale,
    PLAYLIST_ROW_BASE,
    undefined,
    initialWindow.current.first,
    windowKey,
  );
  const focusRow = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry) return;
      setPage(Math.floor(index / PAGE_SIZE));
      setFocus({ id: entry.playlist.id, target: "row" });
    },
    [entries],
  );
  const focusControl = useCallback(
    (target: FocusTarget) => {
      if ((target === "back" && startup) || (target === "manage" && !hasManage)) return;
      setFocus((current) => (current.target === target ? current : { ...current, target }));
    },
    [hasManage, startup],
  );
  const pointAt = (index: number) =>
    pointerOnly(() => {
      onContentFocus();
      if (focus.target !== "row" || cursor !== index) focusRow(pageStart + index);
    });
  const pointAtControl = (target: FocusTarget) =>
    pointerOnly(() => {
      if (
        (target === "previous" && currentPage === 0) ||
        (target === "next" && currentPage === pages - 1)
      )
        return;
      onContentFocus();
      focusControl(target);
    });
  const goToPage = useCallback(
    (value: number) => {
      if (!inputEnabled) return;
      const target = Math.max(0, Math.min(pages - 1, value));
      if (target === currentPage) return;
      pendingPageFocus.current = true;
      focusRow(target * PAGE_SIZE);
    },
    [currentPage, focusRow, inputEnabled, pages],
  );
  const updateQuery = (value: string) => {
    if (!inputEnabled) return;
    setQuery(value);
    setPage(0);
    setFocus({ id: "", target: "search" });
  };

  useLayoutEffect(() => {
    if (
      !inputEnabled ||
      (prepared.current && pointerInputActive() && !pendingPageFocus.current)
    )
      return;
    let target: HTMLElement | null | undefined =
      focus.target === "row"
        ? viewport.current?.querySelector<HTMLButtonElement>(
            `[data-playlist-shortcut-index="${cursor}"]`,
          )
        : {
            search: search.current,
            clear: clear.current,
            previous: previous.current,
            next: next.current,
            back: back.current,
            manage: manage.current,
          }[focus.target];
    if (!target || target.matches(":disabled")) {
      target = viewport.current?.querySelector<HTMLButtonElement>("button") ?? search.current;
    }
    if (target) {
      target.focus({ preventScroll: true });
      prepared.current = true;
      pendingPageFocus.current = false;
    }
  }, [cursor, focus, inputEnabled, pageEntries, win.start, win.end]);

  useRemote(
    useCallback(
      (code, event) => {
        if (!inputEnabled || event.defaultPrevented) return;
        if (startup && (code === KEY.BACK || code === KEY.ESC)) {
          event.preventDefault();
          onClose();
          return;
        }
        if (code === KEY.ENTER && event.repeat) {
          event.preventDefault();
          return;
        }
        const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
        const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
        if (focus.target === "manage") {
          if (code === KEY.ENTER) onManage?.();
          else if (code === KEY.BACK || code === KEY.ESC) onClose();
          else if (code === KEY.DOWN || code === inlineStart) focusControl("search");
          if (
            code === KEY.ENTER ||
            code === KEY.BACK ||
            code === KEY.ESC ||
            code === KEY.UP ||
            code === KEY.DOWN ||
            code === inlineStart ||
            code === inlineEnd
          ) {
            event.preventDefault();
          }
          return;
        }
        if (focus.target === "back") {
          if (code === KEY.ENTER || code === KEY.BACK || code === KEY.ESC) onClose();
          else if (code === inlineEnd) {
            if (pageEntries.length) focusRow(pageStart + cursor);
            else focusControl("search");
          }
          if (
            code === KEY.ENTER ||
            code === KEY.BACK ||
            code === KEY.ESC ||
            code === KEY.UP ||
            code === KEY.DOWN ||
            code === inlineStart ||
            code === inlineEnd
          ) {
            event.preventDefault();
          }
          return;
        }
        if (focus.target === "search") {
          const field = search.current;
          if (!field) return;
          const exit = textInputExit(field, code, direction === "rtl");
          if (code === KEY.ENTER || code === KEY.BACK || code === KEY.ESC || exit === "down") {
            event.preventDefault();
            if (pageEntries.length) focusRow(pageStart);
            else if (query) focusControl("clear");
            else focusControl("back");
          } else if (exit === "start") {
            event.preventDefault();
            focusControl("back");
          } else if (exit === "end") {
            event.preventDefault();
            focusControl(query ? "clear" : "manage");
          } else if (exit === "up") {
            event.preventDefault();
            focusControl("manage");
          }
          return;
        }
        if (code === KEY.UP || code === KEY.DOWN) {
          event.preventDefault();
          if (focus.target === "row") {
            if (code === KEY.UP && cursor === 0) focusControl("search");
            else if (code === KEY.DOWN && cursor === pageEntries.length - 1 && pages > 1) {
              focusControl(currentPage < pages - 1 ? "next" : "previous");
            } else {
              focusRow(
                pageStart +
                  Math.max(
                    0,
                    Math.min(pageEntries.length - 1, cursor + (code === KEY.UP ? -1 : 1)),
                  ),
              );
            }
          } else if (focus.target === "clear" && code === KEY.UP) focusControl("search");
          else if (pageEntries.length)
            focusRow(pageStart + (code === KEY.UP ? pageEntries.length - 1 : 0));
          else focusControl("search");
        } else if (code === inlineStart) {
          event.preventDefault();
          if (focus.target === "clear") focusControl("search");
          else if (focus.target === "next" && currentPage > 0) focusControl("previous");
          else focusControl("back");
        } else if (code === inlineEnd) {
          event.preventDefault();
          if (pages > 1) focusControl(currentPage < pages - 1 ? "next" : "previous");
          else focusControl("manage");
        } else if (code === KEY.BACK || code === KEY.ESC) {
          event.preventDefault();
          if (query) {
            const index = Math.max(
              0,
              playlists.findIndex((playlist) => playlist.id === focus.id),
            );
            setQuery("");
            setPage(Math.floor(index / PAGE_SIZE));
            pendingPageFocus.current = true;
            setFocus({ id: playlists[index]?.id ?? "", target: "row" });
          } else onClose();
        } else if (code === KEY.ENTER) {
          event.preventDefault();
          if (focus.target === "previous") goToPage(currentPage - 1);
          else if (focus.target === "next") goToPage(currentPage + 1);
          else if (focus.target === "clear") clear.current?.click();
          else if (pageEntries[cursor]) onSelect(pageEntries[cursor].playlist.id);
        }
      },
      [
        currentPage,
        cursor,
        direction,
        focus.id,
        focus.target,
        focusControl,
        focusRow,
        goToPage,
        inputEnabled,
        onClose,
        onManage,
        onSelect,
        pageEntries,
        pageStart,
        pages,
        playlists,
        query,
        startup,
      ],
    ),
    true,
  );

  const active = playlists[activeIndex];
  const description = (playlist: Playlist) =>
    [
      playlist.source.kind === "xtream" ? "Xtream" : "M3U",
      ...(playlist.channelCount === undefined
        ? []
        : [
            t("playlist.shortcutChannels", {
              count: number(playlist.channelCount),
              total: playlist.channelCount,
            }),
          ]),
    ].join(" \u00b7 ");

  return (
    <section
      className={`vod-screen playlist-shortcut${startup ? " playlist-startup" : ""}`}
      aria-labelledby="playlist-shortcut-title"
      onPointerDown={(event) => {
        if (event.target instanceof Element && event.target.closest("button, input"))
          onContentFocus();
      }}
    >
      {!startup && (
        <div className="sheet-edge-back">
          <button
            ref={back}
            type="button"
            className="btn tonal"
            aria-label={t("common.back")}
            disabled={!inputEnabled}
            tabIndex={inputEnabled ? 0 : -1}
            onFocus={() => focusControl("back")}
            onPointerEnter={() => pointerOnly(() => focusControl("back"))}
            onClick={onClose}
          >
            <Icon name="return" logicalDirection />
          </button>
        </div>
      )}
      <div className="playlist-shortcut-content">
        <header className="playlist-shortcut-heading">
          <div className="playlist-shortcut-intro">
            <div className="playlist-shortcut-title-line">
              <h1 id="playlist-shortcut-title">
                {t(startup ? "playlist.startupTitle" : "settings.playlists")}
              </h1>
              <span className="count">{number(entries.length)}</span>
            </div>
            <p>{t(startup ? "playlist.startupHint" : "playlist.shortcutHint")}</p>
            {active && (
              <p className="playlist-shortcut-current">
                <span>{t(startup ? "playlist.lastActive" : "common.active")}</span>
                <strong>{active.name}</strong>
              </p>
            )}
          </div>
          {hasManage && (
            <button
              ref={manage}
              type="button"
              className="btn tonal playlist-shortcut-manage"
              disabled={!inputEnabled}
              tabIndex={inputEnabled ? 0 : -1}
              onFocus={() => focusControl("manage")}
              onPointerEnter={() => pointAtControl("manage")}
              onPointerMove={() => pointAtControl("manage")}
              onClick={() => {
                if (inputEnabled) onManage?.();
              }}
            >
              <Icon name="playlists" />
              <span>{t("playlist.managePlaylists")}</span>
            </button>
          )}
        </header>
        <div
          className="playlist-shortcut-search"
          onPointerMove={() => pointerOnly(onContentFocus)}
        >
          <Icon name="search" />
          <TextInput
            ref={search}
            variant="embedded"
            value={query}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("playlist.searchPlaylists")}
            placeholder={t("playlist.searchPlaylists")}
            tabIndex={inputEnabled ? 0 : -1}
            onFocus={() => {
              onContentFocus();
              focusControl("search");
            }}
            onChange={(event) => updateQuery(event.target.value)}
          />
          {query && (
            <button
              ref={clear}
              type="button"
              className="btn tonal playlist-shortcut-clear"
              tabIndex={inputEnabled ? 0 : -1}
              onFocus={() => focusControl("clear")}
              onPointerEnter={() => pointAtControl("clear")}
              onPointerMove={() => pointAtControl("clear")}
              onClick={() => {
                if (!inputEnabled) return;
                pendingPageFocus.current = true;
                updateQuery("");
              }}
            >
              {t("common.clear")}
            </button>
          )}
        </div>
        <div
          ref={viewport}
          className="playlist-shortcut-list"
          role="menu"
          aria-label={t("playlist.savedPlaylists")}
          onWheel={(event) => {
            if (inputEnabled && win.onWheel(event.deltaY, event.deltaMode))
              event.preventDefault();
          }}
        >
          {pageEntries.slice(win.start, win.end).map(({ playlist, ordinal }, offset) => {
            const index = win.start + offset;
            const selected = playlist.id === activePlaylistId;
            return (
              <button
                key={playlist.id}
                type="button"
                role="menuitem"
                className={`playlist-shortcut-row${inputEnabled && focus.target === "row" && cursor === index ? " cursor" : ""}`}
                data-playlist-shortcut-index={index}
                aria-label={playlist.name}
                aria-current={!startup && selected ? true : undefined}
                aria-posinset={pageStart + index + 1}
                aria-setsize={entries.length}
                title={playlist.name}
                tabIndex={inputEnabled && cursor === index ? 0 : -1}
                style={{ top: index * win.row - win.scrollOffset, height: win.row }}
                onPointerEnter={() => pointAt(index)}
                onPointerMove={() => pointAt(index)}
                onFocus={() => {
                  if (focus.target !== "row" || focus.id !== playlist.id)
                    focusRow(pageStart + index);
                }}
                onClick={() => {
                  if (!inputEnabled) return;
                  focusRow(pageStart + index);
                  onSelect(playlist.id);
                }}
              >
                <PlaylistAvatar name={playlist.name} number={number(ordinal)} />
                <span className="playlist-shortcut-row-copy">
                  <span className="playlist-shortcut-name">{playlist.name}</span>
                  <span className="playlist-shortcut-meta">{description(playlist)}</span>
                </span>
                <span className="playlist-shortcut-open" aria-hidden="true">
                  <Icon name="chevronRight" logicalDirection />
                </span>
              </button>
            );
          })}
          {!pageEntries.length && (
            <p className="playlist-shortcut-empty" role="status">
              {t("lineup.noMatches")}
            </p>
          )}
          <ScrollIndicator
            count={pageEntries.length}
            first={win.indicatorFirst}
            visible={win.visible}
          />
        </div>
        {pages > 1 && (
          <nav
            className="settings-pagination playlist-shortcut-pagination"
            aria-label={t("playlist.savedPlaylists")}
          >
            <button
              ref={previous}
              type="button"
              className="btn tonal playlist-shortcut-page-action"
              aria-label={t("common.previous")}
              title={t("common.previous")}
              disabled={currentPage === 0}
              tabIndex={inputEnabled ? 0 : -1}
              onFocus={() => focusControl("previous")}
              onPointerEnter={() => pointAtControl("previous")}
              onPointerMove={() => pointAtControl("previous")}
              onClick={() => goToPage(currentPage - 1)}
            >
              <Icon name="chevronLeft" logicalDirection />
            </button>
            <span aria-live="polite">{`${number(currentPage + 1)} / ${number(pages)}`}</span>
            <button
              ref={next}
              type="button"
              className="btn tonal playlist-shortcut-page-action"
              aria-label={t("common.next")}
              title={t("common.next")}
              disabled={currentPage === pages - 1}
              tabIndex={inputEnabled ? 0 : -1}
              onFocus={() => focusControl("next")}
              onPointerEnter={() => pointAtControl("next")}
              onPointerMove={() => pointAtControl("next")}
              onClick={() => goToPage(currentPage + 1)}
            >
              <Icon name="chevronRight" logicalDirection />
            </button>
          </nav>
        )}
        <NavigationGuide
          className="playlist-shortcut-keys ruled"
          returnLabel={startup ? t("exit.confirm") : undefined}
        />
      </div>
    </section>
  );
}
