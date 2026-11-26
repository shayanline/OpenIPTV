import { useSettings } from "../../stores/settings";
import { useLocale } from "../../hooks/useLocale";
import { availableContentModes } from "../../services/contentSections";
import { Icon } from "../Icon";
import { PageHeader, Row, Toggle } from "./Field";

const CONTENT_SECTIONS = [
  { key: "showLive", mode: "live", label: "settings.showLive", contentLabel: "content.live" },
  {
    key: "showMovies",
    mode: "movie",
    label: "settings.showMovies",
    contentLabel: "content.movies",
  },
  {
    key: "showSeries",
    mode: "series",
    label: "settings.showSeries",
    contentLabel: "content.series",
  },
] as const;

export function ContentSettings({ onManage }: { onManage: () => void }) {
  const s = useSettings();
  const { t, number } = useLocale();
  const sourceKind = s.activePlaylist()?.source.kind ?? "m3u";
  const availableModes = availableContentModes(sourceKind, s);
  const active = s.playlists.find((playlist) => playlist.id === s.activePlaylistId);
  return (
    <>
      <PageHeader title={t("settings.content")} />
      <button
        type="button"
        className="content-manage"
        data-settings-focus="manage-playlists"
        data-ok-guide={t("common.open")}
        aria-label={`${t("common.open")}, ${t("playlist.managePlaylists")}`}
        onClick={onManage}
      >
        <span className="content-manage-main">
          <span className="content-manage-title">{t("playlist.managePlaylists")}</span>
          <span className="content-manage-meta management-row-meta">
            {t("playlist.savedPlaylists")} · {number(s.playlists.length)}
            {active ? ` · ${active.name}` : ""}
          </span>
        </span>
        <Icon name="chevronRight" logicalDirection />
      </button>
      <Row label={t("settings.playlistShortcut")} hint={t("settings.playlistShortcutHint")}>
        <Toggle
          label={t("settings.playlistShortcut")}
          value={s.playlistShortcut}
          onChange={(value) => s.set("playlistShortcut", value)}
        />
      </Row>
      <Row
        label={t("settings.hideEmptyCategories")}
        hint={t("settings.hideEmptyCategoriesHint")}
      >
        <Toggle
          label={t("settings.hideEmptyCategories")}
          value={s.hideEmptyCategories}
          onChange={(v) => s.set("hideEmptyCategories", v)}
        />
      </Row>
      {CONTENT_SECTIONS.map((section) => {
        const disabled = availableModes.length === 1 && availableModes[0] === section.mode;
        const hint = disabled
          ? t("settings.keepSectionHint")
          : section.mode !== "live" && sourceKind !== "xtream"
            ? t("settings.sectionUnsupportedHint")
            : t("settings.sectionVisibilityHint", { section: t(section.contentLabel) });
        return (
          <Row key={section.key} label={t(section.label)} hint={hint}>
            <Toggle
              label={t(section.label)}
              value={s[section.key]}
              onChange={(v) => s.set(section.key, v)}
              disabled={disabled}
            />
          </Row>
        );
      })}
    </>
  );
}
