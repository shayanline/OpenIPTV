import { useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { KEY, useRemote } from "../../hooks/useRemote";
import { useSettings, type HiddenCategoryMode, type Playlist } from "../../stores/settings";
import { clearPlaylistCache, useChannels } from "../../stores/channels";
import {
  checkPlaylistUrl,
  m3uSource,
  nameFromUrl,
  parseXtreamPlaylistUrl,
  sourceDisplay,
  type XtreamOutput,
  xtreamSource,
} from "../../services/playlistUrl";
import type { MessageKey } from "../../services/locale";
import { forgetRepairSource } from "../../services/repair";
import type { XtreamAccount, XtreamContentKind } from "../../services/xtream";
import { Confirm } from "../Confirm";
import { Icon } from "../Icon";
import { Text } from "../Text";
import { OptionPicker } from "../OptionPicker";
import type { SettingsDetailNavigation } from "../Settings";
import { PageHeader, Row, SettingsListHeader } from "./Field";

const CATEGORY_PAGE_SIZE = 20;

function AccountStatus({ account }: { account: XtreamAccount }) {
  const { t, locale, number } = useLocale();
  const status = account.status.toLowerCase();
  const expired = !!account.expiresAt && account.expiresAt <= Math.floor(Date.now() / 1000);
  const state =
    status === "expired" || expired
      ? "playlist.accountExpired"
      : status === "active"
        ? "playlist.accountActive"
        : "playlist.accountInactive";
  return (
    <span className="playlist-account-status">
      <span>
        {t(state)}
        {account.isTrial ? ` ${t("playlist.accountTrial")}` : ""}
      </span>
      <span>
        {account.expiresAt
          ? t("playlist.accountExpires", {
              date: new Date(account.expiresAt * 1000).toLocaleDateString(locale),
            })
          : t("playlist.accountExpiryUnknown")}
      </span>
      {account.activeConnections !== undefined && (
        <span>
          {t("playlist.accountConnections", {
            active: number(account.activeConnections),
            maximum:
              account.maxConnections === undefined
                ? t("diagnostics.unknown")
                : number(account.maxConnections),
          })}
        </span>
      )}
    </span>
  );
}

function replacesSourceAccount(left: Playlist["source"], right: Playlist["source"]): boolean {
  return (
    left.kind !== right.kind ||
    (left.kind === "xtream" &&
      right.kind === "xtream" &&
      (left.server !== right.server || left.username !== right.username))
  );
}

function CategoryManager({
  playlist,
  categories,
  onAsking,
}: {
  playlist: Playlist;
  categories: { key: string; name: string }[];
  onAsking: (asking: boolean) => void;
}) {
  const { t, number } = useLocale();
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [categoryKind, setCategoryKind] = useState<XtreamContentKind>("live");
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const previousPage = useRef<HTMLButtonElement>(null);
  const nextPage = useRef<HTMLButtonElement>(null);
  const managed =
    playlist.source.kind === "xtream"
      ? categories.filter((category) => category.key.startsWith(`${categoryKind}:`))
      : categories;
  const managedKeys = new Set(managed.map((category) => category.key));
  const folded = query.trim().toLocaleLowerCase();
  const matches = folded
    ? managed.filter((category) => category.name.toLocaleLowerCase().includes(folded))
    : managed;
  const pages = Math.max(1, Math.ceil(matches.length / CATEGORY_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const shown = matches.slice(
    currentPage * CATEGORY_PAGE_SIZE,
    (currentPage + 1) * CATEGORY_PAGE_SIZE,
  );
  const modeOptions: readonly { id: HiddenCategoryMode; label: string }[] = [
    { id: "exclude", label: t("playlist.hideEverywhere") },
    { id: "search", label: t("playlist.keepSearchable") },
  ];
  const modeLabel = modeOptions.find(
    (option) => option.id === playlist.hiddenCategoryMode,
  )?.label;

  const pageFromRow = (direction: -1 | 1) => {
    const next = currentPage + direction;
    if (next < 0 || next >= pages) return false;
    setPage(next);
    return true;
  };

  const closeHideAll = () => {
    moreButton.current?.focus();
    setConfirmingAll(false);
    onAsking(false);
  };
  const closeSearch = () => {
    searchButton.current?.focus();
    setSearching(false);
    onAsking(false);
  };
  const openSearch = () => {
    setActionsOpen(false);
    setSearching(true);
    onAsking(true);
  };
  const closeActions = () => {
    moreButton.current?.focus();
    setActionsOpen(false);
    onAsking(false);
  };
  const openActions = () => {
    setSearching(false);
    setActionsOpen(true);
    onAsking(true);
  };

  useLayoutEffect(() => {
    if (searching) {
      searchInput.current?.focus();
      return;
    }
    if (actionsOpen) {
      document
        .querySelector<HTMLButtonElement>(".category-actions-menu .settings-menu-item")
        ?.focus();
      return;
    }
  }, [searching, actionsOpen]);

  useRemote((code, event) => {
    if (searching && code === KEY.ENTER) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearch();
      return;
    }
    if (
      searching &&
      (code === KEY.BACK || code === KEY.ESC || code === KEY.UP || code === KEY.DOWN)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeSearch();
      return;
    }
    if (!actionsOpen) return;
    if (code === KEY.BACK || code === KEY.ESC || code === KEY.LEFT || code === KEY.RIGHT) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeActions();
      return;
    }
    if (code !== KEY.UP && code !== KEY.DOWN) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const items = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".category-actions-menu .settings-menu-item",
      ),
    );
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = code === KEY.UP ? Math.max(0, at - 1) : Math.min(items.length - 1, at + 1);
    items[next]?.focus();
  });

  return (
    <>
      <p className="sheet-lead settings-detail-context">
        <Text value={playlist.name} />
      </p>
      <Row label={t("playlist.hiddenChannels")} hint={t("playlist.hiddenChannelsHint")}>
        <button
          type="button"
          className="btn tonal"
          data-settings-detail-first
          data-ok-guide={t("common.changeIt")}
          aria-label={`${t("playlist.hiddenChannels")}, ${modeLabel}`}
          onClick={() =>
            settings.setHiddenCategoryMode(
              playlist.id,
              playlist.hiddenCategoryMode === "exclude" ? "search" : "exclude",
            )
          }
        >
          <span>{modeLabel}</span>
        </button>
      </Row>
      {playlist.source.kind === "xtream" && (
        <div className="category-kind-selector">
          {(["live", "movie", "series"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className="category-kind-option"
              aria-pressed={categoryKind === kind}
              onClick={() => {
                setCategoryKind(kind);
                setPage(0);
              }}
            >
              <Icon name={kind === "live" ? "tv" : kind === "movie" ? "movie" : "series"} />
              <span>
                {t(
                  kind === "live"
                    ? "content.live"
                    : kind === "movie"
                      ? "content.movies"
                      : "content.series",
                )}
              </span>
              <span className="count">
                {number(
                  categories.filter((category) => category.key.startsWith(`${kind}:`)).length,
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="settings-list-tools">
        <SettingsListHeader
          title={t("playlist.manageCategories")}
          count={number(matches.length)}
        >
          <button
            ref={searchButton}
            type="button"
            className="settings-icon-action"
            aria-label={t("playlist.categorySearch")}
            aria-expanded={searching}
            aria-pressed={!!query}
            onClick={() => (searching ? closeSearch() : openSearch())}
          >
            <Icon name="search" />
          </button>
          <button
            ref={moreButton}
            type="button"
            className="settings-icon-action"
            aria-label={t("playlist.categoryActions")}
            aria-expanded={actionsOpen}
            onClick={() => (actionsOpen ? closeActions() : openActions())}
          >
            <Icon name="more" />
          </button>
        </SettingsListHeader>
        {searching && (
          <div className="category-search-popup">
            <input
              ref={searchInput}
              aria-label={t("playlist.categorySearch")}
              value={query}
              dir="auto"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </div>
        )}
        {actionsOpen && (
          <div className="category-actions-menu">
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                setActionsOpen(false);
                setConfirmingAll(true);
              }}
            >
              <Icon name="hidden" />
              <span>{t("playlist.hideAllCategories")}</span>
            </button>
            <button
              type="button"
              className="settings-menu-item"
              onClick={() => {
                settings.setHiddenCategories(
                  playlist.id,
                  playlist.hiddenCategories.filter((key) => !managedKeys.has(key)),
                );
                closeActions();
              }}
            >
              <Icon name="visible" />
              <span>{t("playlist.showAllCategories")}</span>
            </button>
          </div>
        )}
      </div>
      <div className="category-settings-list">
        {shown.map((category, row) => {
          const hidden = playlist.hiddenCategories.includes(category.key);
          return (
            <button
              key={category.key}
              type="button"
              className={`category-setting-row ${hidden ? "hidden" : ""}`}
              aria-label={t(hidden ? "playlist.unhideCategory" : "playlist.hideCategory", {
                name: category.name,
              })}
              data-ok-guide={t(
                hidden ? "playlist.unhideCategoryGuide" : "playlist.hideCategoryGuide",
              )}
              onClick={(event) => {
                const nextHidden = !hidden;
                settings.setCategoryHidden(playlist.id, category.key, nextHidden);
                event.currentTarget.dataset.okGuide = t(
                  nextHidden ? "playlist.unhideCategoryGuide" : "playlist.hideCategoryGuide",
                );
                event.currentTarget.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
              }}
              onKeyDown={(event) => {
                if (
                  event.keyCode === KEY.DOWN &&
                  row === shown.length - 1 &&
                  matches.length > CATEGORY_PAGE_SIZE
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  nextPage.current?.focus();
                }
              }}
            >
              <Text value={category.name} />
              <span className={`switch ${hidden ? "" : "on"}`} aria-hidden="true">
                <span className="switch-track">
                  <span className="switch-knob" />
                </span>
                <span>{t(hidden ? "common.off" : "common.on")}</span>
              </span>
            </button>
          );
        })}
      </div>
      {!managed.length ? (
        <p className="sheet-lead">{t("playlist.noCategories")}</p>
      ) : (
        !shown.length && (
          <p className="sheet-lead" role="status">
            {t("playlist.noCategoryMatches")}
          </p>
        )
      )}
      {matches.length > CATEGORY_PAGE_SIZE && (
        <div className="category-pagination">
          <button
            ref={previousPage}
            type="button"
            className="btn tonal"
            aria-disabled={currentPage === 0}
            onClick={() => pageFromRow(-1)}
            onKeyDown={(event) => {
              if (event.keyCode !== KEY.UP) return;
              event.preventDefault();
              event.stopPropagation();
              const rows =
                document.querySelectorAll<HTMLButtonElement>(".category-setting-row");
              rows[rows.length - 1]?.focus();
            }}
          >
            <span>{t("common.previous")}</span>
          </button>
          <p className="category-position">
            {t("playlist.categoryPosition", {
              from: currentPage * CATEGORY_PAGE_SIZE + 1,
              to: currentPage * CATEGORY_PAGE_SIZE + shown.length,
              total: matches.length,
            })}
          </p>
          <button
            ref={nextPage}
            type="button"
            className="btn tonal"
            aria-disabled={currentPage === pages - 1}
            onClick={() => pageFromRow(1)}
            onKeyDown={(event) => {
              if (event.keyCode !== KEY.UP) return;
              event.preventDefault();
              event.stopPropagation();
              const rows =
                document.querySelectorAll<HTMLButtonElement>(".category-setting-row");
              rows[rows.length - 1]?.focus();
            }}
          >
            <span>{t("common.next")}</span>
          </button>
        </div>
      )}
      {confirmingAll && (
        <Confirm
          title={t("playlist.hideAllQuestion")}
          body={t("playlist.hideAllBody")}
          confirmLabel={t("playlist.hideAllCategories")}
          cancelLabel={t("common.cancel")}
          onCancel={closeHideAll}
          onConfirm={() => {
            settings.setHiddenCategories(playlist.id, [
              ...playlist.hiddenCategories.filter((key) => !managedKeys.has(key)),
              ...managed.map((category) => category.key),
            ]);
            closeHideAll();
          }}
        />
      )}
    </>
  );
}

export function Playlists({
  onAsking,
  navigation,
}: {
  onAsking: (asking: boolean) => void;
  navigation: SettingsDetailNavigation;
}) {
  const { t, number } = useLocale();
  const s = useSettings();
  const { load, loading, error, errorKey, errorDetail, channels, managedCategories, accounts } =
    useChannels();
  const errorText = (
    key: MessageKey | "" | undefined,
    detail: string | undefined,
    fallback: string,
  ) => (key ? t(key, { detail: detail ?? "" }) : fallback);
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [m3uUrl, setM3uUrl] = useState("");
  const [source, setSource] = useState<"m3u" | "xtream">("m3u");
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [output, setOutput] = useState<XtreamOutput>("m3u8");
  const [problem, setProblem] = useState<MessageKey | "">("");
  const [dismissedXtreamUrl, setDismissedXtreamUrl] = useState("");
  const suggestedXtream =
    source === "m3u" && url !== dismissedXtreamUrl ? parseXtreamPlaylistUrl(url, "m3u8") : null;
  /** Which playlist has been asked about but not yet confirmed for removal. */
  const [confirming, setConfirming] = useState("");
  const [managing, setManaging] = useState("");

  const ask = (id: string) => {
    setConfirming(id);
    onAsking(!!id);
  };

  const startAdd = () => {
    setEditing({
      id: "",
      name: "",
      source: { kind: "m3u", url: "" },
      sourceVersion: 1,
      hiddenCategories: [],
      hiddenCategoryMode: "exclude",
    });
    setName("");
    setUrl("");
    setM3uUrl("");
    setSource("m3u");
    setServer("");
    setUsername("");
    setPassword("");
    setOutput("m3u8");
    setProblem("");
    setDismissedXtreamUrl("");
    navigation.open("playlist-add", t("playlist.addTitle"), "playlist-add", () =>
      setEditing(null),
    );
  };
  const startEdit = (p: Playlist) => {
    const xtream = p.source.kind === "xtream" ? p.source : null;
    const address = p.source.kind === "m3u" ? p.source.url : "";
    setEditing(p);
    setName(p.name);
    setUrl(address);
    setM3uUrl(address);
    setSource(p.source.kind);
    setServer(xtream?.server ?? "");
    setUsername(xtream?.username ?? "");
    setPassword(xtream?.password ?? "");
    setOutput(xtream?.output ?? "m3u8");
    setProblem("");
    setDismissedXtreamUrl("");
    navigation.open(
      `playlist-edit-${p.id}`,
      t("playlist.editTitle"),
      `playlist-edit-${p.id}`,
      () => setEditing(null),
    );
  };

  const applyXtream = (next: NonNullable<typeof suggestedXtream>) => {
    setSource("xtream");
    setServer(next.server);
    setUsername(next.username);
    setPassword(next.password);
    setOutput(next.output);
    setProblem("");
  };

  /**
   * Check first, then load, then say what happened.
   *
   * An address that cannot work is refused here rather than sent off to time out, and either
   * way the viewer is told the outcome: a playlist that returns nothing looks exactly like
   * one that failed if nobody says which it was.
   */
  const save = async () => {
    if (source === "m3u") {
      const verdict = checkPlaylistUrl(url);
      if (!verdict.ok) {
        setProblem(verdict.problemKey ?? "validation.completeAddress");
        return;
      }
    }
    const playlistSource =
      source === "m3u" ? m3uSource(url) : xtreamSource(server, username, password, output);
    if (!playlistSource) {
      setProblem("validation.completeAddress");
      return;
    }
    setProblem("");

    const label = name.trim() || nameFromUrl(sourceDisplay(playlistSource));
    const loadsActivePlaylist = editing?.id
      ? editing.id === s.activePlaylist()?.id
      : s.playlists.length === 0;
    if (editing?.id) {
      s.updatePlaylist(editing.id, label, playlistSource);
      if (replacesSourceAccount(editing.source, playlistSource)) {
        await clearPlaylistCache(editing);
        forgetRepairSource(editing.id);
      }
    } else s.addPlaylist(label, playlistSource);
    navigation.back();

    if (!loadsActivePlaylist) {
      setNote(t("playlist.saved", { name: label }));
      return;
    }

    setNote(t("playlist.loading", { name: label }));
    const result = await load(true);
    setNote(
      errorText(result.errorKey, result.errorDetail, result.error) ||
        (result.count > 0
          ? t("playlist.loaded", { name: label, count: result.count })
          : t("playlist.savedNoChannels", { name: label })),
    );
  };

  const refresh = async () => {
    setNote(t("playlist.refreshing"));
    const result = await load(true);
    setNote(
      errorText(result.errorKey, result.errorDetail, result.error) ||
        (result.count > 0
          ? t("playlist.refreshed", { count: result.count })
          : t("playlist.nothingRead")),
    );
  };

  const manage = async (playlist: Playlist) => {
    if (playlist.id !== s.activePlaylistId) {
      const previous = s.activePlaylistId;
      s.set("activePlaylistId", playlist.id);
      setNote(t("playlist.loading", { name: playlist.name }));
      const result = await load();
      if (result.error) {
        s.set("activePlaylistId", previous);
        setNote(errorText(result.errorKey, result.errorDetail, result.error));
        return;
      }
    }
    setNote("");
    setManaging(playlist.id);
    navigation.open(
      `playlist-categories-${playlist.id}`,
      t("playlist.manageCategories"),
      `playlist-categories-${playlist.id}`,
      () => setManaging(""),
    );
  };

  const categoryCountFor = (playlist: Playlist) =>
    playlist.id === s.activePlaylistId && managedCategories.length
      ? managedCategories.length
      : playlist.categoryCount;
  const managedPlaylist = s.playlists.find((playlist) => playlist.id === managing);
  if (managedPlaylist) {
    return (
      <CategoryManager
        playlist={managedPlaylist}
        categories={managedCategories}
        onAsking={onAsking}
      />
    );
  }

  if (editing) {
    return (
      <>
        {editing.id && (
          <p className="sheet-lead settings-detail-context">
            <Text value={editing.name} />
          </p>
        )}
        <div className="form playlist-form">
          <label htmlFor="pl-name">{t("onboarding.playlistName")}</label>
          <input
            id="pl-name"
            data-settings-detail-first
            value={name}
            dir="auto"
            onChange={(event) => setName(event.target.value)}
            placeholder={t("onboarding.optionalAddress")}
          />
          <div className="playlist-source-options">
            <button
              type="button"
              className="btn tonal"
              aria-pressed={source === "m3u"}
              onClick={() => {
                setSource("m3u");
                setUrl(m3uUrl);
                setProblem("");
              }}
            >
              <span>{t("onboarding.m3uPlaylist")}</span>
            </button>
            <button
              type="button"
              className="btn tonal"
              aria-pressed={source === "xtream"}
              onClick={() => {
                setSource("xtream");
                setProblem("");
              }}
            >
              <span>{t("onboarding.xtreamLogin")}</span>
            </button>
          </div>
          {source === "m3u" ? (
            <>
              <label htmlFor="pl-url">{t("onboarding.playlistAddress")}</label>
              <input
                id="pl-url"
                value={url}
                spellCheck={false}
                dir="ltr"
                className={problem ? "wrong" : ""}
                aria-invalid={problem ? true : undefined}
                aria-describedby={problem ? "pl-url-problem" : undefined}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setM3uUrl(event.target.value);
                  setProblem("");
                }}
                placeholder={t("onboarding.urlPlaceholder")}
              />
              {suggestedXtream && (
                <div className="xtream-suggestion">
                  <span>{t("onboarding.xtreamDetected")}</span>
                  <div>
                    <button
                      type="button"
                      className="btn tonal"
                      onClick={() => setDismissedXtreamUrl(url)}
                    >
                      <span>{t("onboarding.keepM3u")}</span>
                    </button>
                    <button
                      type="button"
                      className="btn tonal"
                      onClick={() => applyXtream(suggestedXtream)}
                    >
                      <span>{t("onboarding.useXtream")}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="xtream-fields">
              <label htmlFor="pl-server">{t("onboarding.serverAddress")}</label>
              <input
                id="pl-server"
                value={server}
                spellCheck={false}
                dir="ltr"
                onChange={(event) => {
                  const parsed = parseXtreamPlaylistUrl(event.target.value, "m3u8");
                  if (parsed) applyXtream(parsed);
                  else setServer(event.target.value);
                }}
              />
              <label htmlFor="pl-username">{t("onboarding.username")}</label>
              <input
                id="pl-username"
                value={username}
                spellCheck={false}
                dir="ltr"
                onChange={(event) => setUsername(event.target.value)}
              />
              <label htmlFor="pl-password">{t("onboarding.password")}</label>
              <input
                id="pl-password"
                type="password"
                value={password}
                dir="ltr"
                onChange={(event) => setPassword(event.target.value)}
              />
              <label htmlFor="pl-output">{t("onboarding.streamFormat")}</label>
              <OptionPicker
                id="pl-output"
                label={t("onboarding.streamFormat")}
                value={output}
                options={[
                  { value: "m3u8", label: t("onboarding.hls") },
                  { value: "ts", label: t("onboarding.mpegTs") },
                ]}
                onChange={setOutput}
              />
            </div>
          )}
          {problem && (
            <p className="field-problem" id="pl-url-problem" role="alert">
              {t(problem)}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn filled" onClick={save}>
              <span>{t("common.save")}</span>
            </button>
            <button type="button" className="btn tonal" onClick={navigation.back}>
              <span>{t("common.cancel")}</span>
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("settings.playlists")} description={t("playlist.storedLocally")} />
      <p className="settings-status" role="status">
        {note ||
          (loading
            ? t("playlist.loadingActive")
            : error
              ? errorText(errorKey, errorDetail, error)
              : s.playlists.length
                ? t("playlist.loadedActive", { count: channels.length })
                : t("playlist.addToStart"))}
      </p>

      <SettingsListHeader
        title={t("playlist.savedPlaylists")}
        count={number(s.playlists.length)}
      >
        <button
          type="button"
          className="settings-icon-action"
          data-settings-focus="playlist-add"
          aria-label={t("common.addPlaylist")}
          onClick={startAdd}
        >
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="settings-icon-action"
          aria-label={t("common.refreshPlaylist")}
          aria-busy={loading}
          onClick={refresh}
        >
          <Icon name="refresh" />
        </button>
      </SettingsListHeader>
      <div className="settings-list-body">
        {s.playlists.map((p) => (
          <div key={p.id} className={`pl ${p.id === s.activePlaylistId ? "active" : ""}`}>
            <button
              type="button"
              className="pl-main"
              onClick={async () => {
                setNote("");
                s.set("activePlaylistId", p.id);
                await load();
              }}
            >
              <span className="pl-title">
                <span className="pl-name" dir="auto">
                  {p.name}
                </span>
                {/* Named, not just tinted. The accessibility guidance asks for a mark
                    alongside colour, since a tint alone says nothing in greyscale. */}
                {p.id === s.activePlaylistId && (
                  <span className="tag">{t("common.active")}</span>
                )}
              </span>
              <span className="pl-url" dir="ltr">
                {sourceDisplay(p.source)}
              </span>
              {p.source.kind === "xtream" && accounts[p.id] && (
                <AccountStatus account={accounts[p.id]} />
              )}
            </button>
            {/* Tonal rather than flat. Flat text at three metres reads as a label, not as
                something you can press, and One UI gives a medium emphasis control a grey
                fill precisely so it still looks like a control. */}
            {categoryCountFor(p) !== 0 && (
              <button
                type="button"
                className="btn tonal"
                data-settings-focus={`playlist-categories-${p.id}`}
                data-ok-guide={t("common.open")}
                aria-label={t("playlist.manageCategoriesAria", { name: p.name })}
                onClick={() => void manage(p)}
              >
                <Icon name="categories" />
                <span>
                  {typeof categoryCountFor(p) === "number"
                    ? t("playlist.categoryCount", {
                        count: number(categoryCountFor(p) ?? 0),
                        total: categoryCountFor(p) ?? 0,
                      })
                    : t("playlist.manageCategories")}
                </span>
              </button>
            )}
            <button
              type="button"
              className="btn tonal"
              data-settings-focus={`playlist-edit-${p.id}`}
              aria-label={t("playlist.editAria", { name: p.name })}
              onClick={() => startEdit(p)}
            >
              <Icon name="edit" />
              <span>{t("common.edit")}</span>
            </button>
            {/* Asked before done. Removing a playlist cannot be undone and the button sits a
                single press away from the one that plays it. */}
            <button
              type="button"
              className="btn tonal danger"
              aria-label={t("playlist.removeAria", { name: p.name })}
              onClick={() => ask(p.id)}
            >
              <Icon name="remove" />
              <span>{t("common.remove")}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Asked in a popup, like every other question the app puts, rather than by growing
          two more buttons inside the row being asked about. */}
      {confirming && (
        <Confirm
          title={t("playlist.removeQuestion", {
            name: s.playlists.find((p) => p.id === confirming)?.name ?? t("settings.playlists"),
          })}
          body={t("playlist.removeBody")}
          confirmLabel={t("common.remove")}
          cancelLabel={t("common.keepIt")}
          destructive
          onCancel={() => ask("")}
          onConfirm={() => {
            const gone = s.playlists.find((p) => p.id === confirming);
            s.removePlaylist(confirming);
            if (gone) void clearPlaylistCache(gone);
            forgetRepairSource(confirming);
            ask("");
            setNote(t("playlist.removed", { name: gone?.name ?? "" }));
            void load();
          }}
        />
      )}
    </>
  );
}
