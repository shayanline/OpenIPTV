import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import { Icon } from "./Icon";

export type HeaderControlId = "content" | "search" | "settings";

export function availableHeaderControls(
  contentAvailable: boolean,
  _guideAvailable?: boolean,
): HeaderControlId[] {
  const controls: HeaderControlId[] = [];
  if (contentAvailable) controls.push("content");
  controls.push("search", "settings");
  return controls;
}

export const PanelHeader = memo(function PanelHeader({
  active,
  on,
  controls,
  searching,
  onSearch,
  onSettings,
}: {
  active: boolean;
  on: HeaderControlId;
  controls: readonly HeaderControlId[];
  searching: boolean;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="panel-bar">
      <div className="brand">
        <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
        <p className="rail-brand">OpenIPTV</p>
      </div>
      <div className="panel-keys">
        {controls.map((control) => {
          if (control === "content") return null;
          if (control === "search") {
            return (
              <button
                key={control}
                type="button"
                className={
                  `panel-key ${active && on === control ? "selected" : ""} ` +
                  `${searching ? "on" : ""}`
                }
                onClick={onSearch}
                aria-label={t("common.search")}
                aria-pressed={searching}
              >
                <Icon name="search" />
                <span>{t("common.search")}</span>
              </button>
            );
          }
          return (
            <button
              key={control}
              type="button"
              className={`panel-key ${active && on === control ? "selected" : ""}`}
              onClick={onSettings}
              aria-label={t("common.settings")}
            >
              <Icon name="settings" />
              <span>{t("common.settings")}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
