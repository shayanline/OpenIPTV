import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useSettings, type HiddenCategoryMode, type Playlist } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { checkPlaylistUrl, nameFromUrl } from "../../services/playlistUrl";
import type { MessageKey } from "../../services/locale";
import { Confirm } from "../Confirm";
import { Icon } from "../Icon";
import { Text } from "../Text";
import type { SettingsDetailNavigation } from "../Settings";
import { Row, SettingsListHeader } from "./Field";

const CATEGORY_PAGE_SIZE = 20;

function CategoryManager({
  playlist,
  categories,
  onAsking,
}: {
  playlist: Playlist;
  categories: { name: string }[];
  onAsking: (asking: boolean) => void;
}) {
  const { t, number } = useLocale();
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const folded = query.trim().toLocaleLowerCase();
  const matches = folded
    ? categories.filter((category) => category.name.toLocaleLowerCase().includes(folded))
    : categories;
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

  useEffect(() => {
    if (searching) window.setTimeout(() => searchInput.current?.focus(), 0);
  }, [searching]);

  const pageFromRow = (direction: -1 | 1) => {
    const next = currentPage + direction;
    if (next < 0 || next >= pages) return false;
    setPage(next);
    window.setTimeout(() => {
      const rows = document.querySelectorAll<HTMLButtonElement>(".category-setting-row");
      (direction > 0 ? rows[0] : rows[rows.length - 1])?.focus();
    }, 0);
    return true;
  };

  const askHideAll = (open: boolean) => {
    setConfirmingAll(open);
    onAsking(open);
  };

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
          aria-label={`${t("playlist.hiddenChannels")}, ${modeLabel}`}
          onClick={() =>
            settings.setHiddenCategoryMode(
              playlist.id,
              playlist.hiddenCategoryMode === "exclude" ? "search" : "exclude",
            )
          }
        >
          {modeLabel}
        </button>
      </Row>
      <SettingsListHeader title={t("playlist.manageCategories")} count={number(matches.length)}>
        <button
          type="button"
          className="settings-icon-action"
          aria-label={t("playlist.categorySearch")}
          aria-expanded={searching}
          onClick={() => setSearching((open) => !open)}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="settings-icon-action"
          aria-label={t("playlist.categoryActions")}
          aria-expanded={actionsOpen}
          onClick={() => setActionsOpen((open) => !open)}
        >
          <Icon name="more" />
        </button>
      </SettingsListHeader>
      {searching && (
        <div className="category-search">
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
          <button type="button" className="btn tonal" onClick={() => askHideAll(true)}>
            {t("playlist.hideAllCategories")}
          </button>
          <button
            type="button"
            className="btn tonal"
            onClick={() => {
              settings.setHiddenCategories(playlist.id, []);
              setActionsOpen(false);
            }}
          >
            {t("playlist.showAllCategories")}
          </button>
        </div>
      )}
      <div className="category-settings-list">
        {shown.map((category, row) => {
          const hidden = playlist.hiddenCategories.includes(category.name);
          return (
            <button
              key={category.name}
              type="button"
              className={`category-setting-row ${hidden ? "hidden" : ""}`}
              aria-label={t(hidden ? "playlist.unhideCategory" : "playlist.hideCategory", {
                name: category.name,
              })}
              onClick={() => settings.setCategoryHidden(playlist.id, category.name, !hidden)}
              onKeyDown={(event) => {
                if (event.keyCode === 40 && row === shown.length - 1 && pageFromRow(1)) {
                  event.preventDefault();
                  event.stopPropagation();
                }
                if (event.keyCode === 38 && row === 0 && pageFromRow(-1)) {
                  event.preventDefault();
                  event.stopPropagation();
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
      {!categories.length ? (
        <p className="sheet-lead">{t("playlist.noCategories")}</p>
      ) : (
        !shown.length && (
          <p className="sheet-lead" role="status">
            {t("playlist.noCategoryMatches")}
          </p>
        )
      )}
      {!!matches.length && (
        <p className="category-position">
          {t("playlist.categoryPosition", {
            from: currentPage * CATEGORY_PAGE_SIZE + 1,
            to: currentPage * CATEGORY_PAGE_SIZE + shown.length,
            total: matches.length,
          })}
        </p>
      )}
      {confirmingAll && (
        <Confirm
          title={t("playlist.hideAllQuestion")}
          body={t("playlist.hideAllBody")}
          confirmLabel={t("playlist.hideAllCategories")}
          cancelLabel={t("common.cancel")}
          onCancel={() => askHideAll(false)}
          onConfirm={() => {
            settings.setHiddenCategories(
              playlist.id,
              categories.map((category) => category.name),
            );
            setActionsOpen(false);
            askHideAll(false);
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
  const { load, loading, error, errorKey, errorDetail, channels, categories } = useChannels();
  const errorText = (
    key: MessageKey | "" | undefined,
    detail: string | undefined,
    fallback: string,
  ) => (key ? t(key, { detail: detail ?? "" }) : fallback);
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<MessageKey | "">("");
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
      url: "",
      hiddenCategories: [],
      hiddenCategoryMode: "exclude",
    });
    setName("");
    setUrl("");
    setProblem("");
    navigation.open("playlist-add", t("playlist.addTitle"), "playlist-add", () =>
      setEditing(null),
    );
  };
  const startEdit = (p: Playlist) => {
    setEditing(p);
    setName(p.name);
    setUrl(p.url);
    setProblem("");
    navigation.open(
      `playlist-edit-${p.id}`,
      t("playlist.editTitle"),
      `playlist-edit-${p.id}`,
      () => setEditing(null),
    );
  };

  /**
   * Check first, then load, then say what happened.
   *
   * An address that cannot work is refused here rather than sent off to time out, and either
   * way the viewer is told the outcome: a playlist that returns nothing looks exactly like
   * one that failed if nobody says which it was.
   */
  const save = async () => {
    const verdict = checkPlaylistUrl(url);
    if (!verdict.ok) {
      setProblem(verdict.problemKey ?? "validation.completeAddress");
      return;
    }
    setProblem("");

    const label = name.trim() || nameFromUrl(url);
    const loadsActivePlaylist = editing?.id
      ? editing.id === s.activePlaylist()?.id
      : s.playlists.length === 0;
    if (editing?.id) s.updatePlaylist(editing.id, label, url.trim());
    else s.addPlaylist(label, url.trim());
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

  const managedPlaylist = s.playlists.find((playlist) => playlist.id === managing);
  if (managedPlaylist) {
    return (
      <CategoryManager playlist={managedPlaylist} categories={categories} onAsking={onAsking} />
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
              setProblem("");
            }}
            placeholder={t("onboarding.urlPlaceholder")}
          />
          {problem && (
            <p className="field-problem" id="pl-url-problem" role="alert">
              {t(problem)}
            </p>
          )}
          <div className="actions">
            <button type="button" className="btn filled" onClick={save}>
              {t("common.save")}
            </button>
            <button type="button" className="btn tonal" onClick={navigation.back}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <h3>{t("settings.playlists")}</h3>
      {note && (
        <p className="sheet-lead" role="status">
          {note}
        </p>
      )}
      <p className="sheet-lead">
        {loading
          ? t("playlist.loadingActive")
          : error
            ? errorText(errorKey, errorDetail, error)
            : s.playlists.length
              ? t("playlist.loadedActive", { count: channels.length })
              : t("playlist.addToStart")}
      </p>
      <p className="sheet-lead">{t("playlist.storedLocally")}</p>

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
              <span className="pl-title" dir="auto">
                {p.name}
                {/* Named, not just tinted. The accessibility guidance asks for a mark
                    alongside colour, since a tint alone says nothing in greyscale. */}
                {p.id === s.activePlaylistId && (
                  <span className="tag">{t("common.active")}</span>
                )}
              </span>
              <span className="pl-url" dir="ltr">
                {p.url}
              </span>
            </button>
            {/* Tonal rather than flat. Flat text at three metres reads as a label, not as
                something you can press, and One UI gives a medium emphasis control a grey
                fill precisely so it still looks like a control. */}
            <button
              type="button"
              className="btn tonal"
              data-settings-focus={`playlist-categories-${p.id}`}
              aria-label={t("playlist.manageCategoriesAria", { name: p.name })}
              onClick={() => void manage(p)}
            >
              {t("playlist.manageCategories")}
            </button>
            <button
              type="button"
              className="btn tonal"
              data-settings-focus={`playlist-edit-${p.id}`}
              aria-label={t("playlist.editAria", { name: p.name })}
              onClick={() => startEdit(p)}
            >
              {t("common.edit")}
            </button>
            {/* Asked before done. Removing a playlist cannot be undone and the button sits a
                single press away from the one that plays it. */}
            <button
              type="button"
              className="btn tonal"
              aria-label={t("playlist.removeAria", { name: p.name })}
              onClick={() => ask(p.id)}
            >
              {t("common.remove")}
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
            ask("");
            setNote(t("playlist.removed", { name: gone?.name ?? "" }));
            void load();
          }}
        />
      )}
    </>
  );
}
