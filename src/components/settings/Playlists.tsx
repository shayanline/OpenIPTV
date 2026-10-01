import { useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useSettings, type HiddenCategoryMode, type Playlist } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { checkPlaylistUrl, nameFromUrl } from "../../services/playlistUrl";
import type { MessageKey } from "../../services/locale";
import { Confirm } from "../Confirm";
import { Text } from "../Text";
import { Choice, Row, Toggle } from "./Field";

const CATEGORY_PAGE_SIZE = 20;

function CategoryManager({
  playlist,
  categories,
  onDone,
}: {
  playlist: Playlist;
  categories: { name: string }[];
  onDone: () => void;
}) {
  const { t } = useLocale();
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const folded = query.trim().toLocaleLowerCase();
  const matches = folded
    ? categories.filter((category) => category.name.toLocaleLowerCase().includes(folded))
    : categories;
  const pages = Math.max(1, Math.ceil(matches.length / CATEGORY_PAGE_SIZE));
  const shown = matches.slice(page * CATEGORY_PAGE_SIZE, (page + 1) * CATEGORY_PAGE_SIZE);
  const modeOptions: readonly { id: HiddenCategoryMode; label: string }[] = [
    { id: "exclude", label: t("playlist.hideEverywhere") },
    { id: "search", label: t("playlist.keepSearchable") },
  ];

  return (
    <>
      <h3>{t("playlist.categoriesTitle")}</h3>
      <p className="sheet-lead category-playlist-name">
        <Text value={playlist.name} />
      </p>
      <Row label={t("playlist.hiddenChannels")} hint={t("playlist.hiddenChannelsHint")}>
        <Choice
          label={t("playlist.hiddenChannels")}
          options={modeOptions}
          value={playlist.hiddenCategoryMode}
          onChange={(mode) => settings.setHiddenCategoryMode(playlist.id, mode)}
        />
      </Row>
      <div className="actions">
        <button
          type="button"
          className="btn tonal"
          onClick={() =>
            settings.setHiddenCategories(
              playlist.id,
              categories.map((category) => category.name),
            )
          }
        >
          {t("playlist.hideAllCategories")}
        </button>
        <button
          type="button"
          className="btn tonal"
          onClick={() => settings.setHiddenCategories(playlist.id, [])}
        >
          {t("playlist.unhideAllCategories")}
        </button>
      </div>
      <div className="form">
        <label htmlFor="category-search">{t("playlist.categorySearch")}</label>
        <input
          id="category-search"
          value={query}
          dir="auto"
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(0);
          }}
        />
      </div>
      {shown.map((category) => {
        const hidden = playlist.hiddenCategories.includes(category.name);
        return (
          <Row key={category.name} label={<Text value={category.name} />}>
            <Toggle
              label={t(hidden ? "playlist.unhideCategory" : "playlist.hideCategory", {
                name: category.name,
              })}
              value={!hidden}
              onChange={(visible) =>
                settings.setCategoryHidden(playlist.id, category.name, !visible)
              }
            />
          </Row>
        );
      })}
      {!shown.length && <p className="sheet-lead">{t("playlist.noCategoryMatches")}</p>}
      <div className="actions">
        {pages > 1 && (
          <>
            <button
              type="button"
              className="btn tonal"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              {t("common.previous")}
            </button>
            <button
              type="button"
              className="btn tonal"
              disabled={page === pages - 1}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("common.next")}
            </button>
          </>
        )}
        <button type="button" className="btn tonal" onClick={onDone}>
          {t("common.done")}
        </button>
      </div>
    </>
  );
}

export function Playlists({ onAsking }: { onAsking: (asking: boolean) => void }) {
  const { t } = useLocale();
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
  };
  const startEdit = (p: Playlist) => {
    setEditing(p);
    setName(p.name);
    setUrl(p.url);
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
    setEditing(null);

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
  };

  const managedPlaylist = s.playlists.find((playlist) => playlist.id === managing);
  if (managedPlaylist) {
    return (
      <CategoryManager
        playlist={managedPlaylist}
        categories={categories}
        onDone={() => setManaging("")}
      />
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

      <div>
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
              aria-label={t("playlist.manageCategoriesAria", { name: p.name })}
              onClick={() => void manage(p)}
            >
              {t("playlist.manageCategories")}
            </button>
            <button
              type="button"
              className="btn tonal"
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

      {editing ? (
        <div className="form">
          <label htmlFor="pl-name">{t("onboarding.playlistName")}</label>
          <input
            id="pl-name"
            value={name}
            dir="auto"
            onChange={(e) => setName(e.target.value)}
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
            onChange={(e) => {
              setUrl(e.target.value);
              setProblem("");
            }}
            placeholder={t("onboarding.urlPlaceholder")}
          />
          {/* Under the field it belongs to, which is where One UI puts an error, rather than
              in a popup that has to be dismissed before the mistake can be corrected. */}
          {problem && (
            <p className="field-problem" id="pl-url-problem" role="alert">
              {t(problem)}
            </p>
          )}
          <div className="actions">
            {/* One filled button per screen, on the action the viewer came here to take. */}
            <button type="button" className="btn filled" onClick={save}>
              {t("common.save")}
            </button>
            <button type="button" className="btn tonal" onClick={() => setEditing(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn tonal" onClick={startAdd}>
            {t("common.addPlaylist")}
          </button>
          <button type="button" className="btn tonal" onClick={refresh} aria-busy={loading}>
            {loading ? t("playlist.refreshing") : t("common.refreshPlaylist")}
          </button>
        </div>
      )}
    </>
  );
}
