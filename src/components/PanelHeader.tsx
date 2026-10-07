import { memo } from "react";
import { useLocale } from "../hooks/useLocale";
import type { AppMode } from "../services/surfaceStack";
import { Icon } from "./Icon";

export type HeaderControlId = AppMode | "search" | "guide" | "settings";

export function availableModeControls(
  sourceKind: "m3u" | "xtream",
  guideAvailable: boolean,
): HeaderControlId[] {
  const controls: HeaderControlId[] = ["live"];
  if (sourceKind === "xtream") controls.push("movie", "series");
  if (guideAvailable) controls.push("guide");
  controls.push("search", "settings");
  return controls;
}

export interface PanelHeaderProps {
  sourceKind: "m3u" | "xtream";
  activeMode: AppMode;
  focusedControl: HeaderControlId | null;
  guideAvailable: boolean;
  onModeChange: (mode: AppMode) => void;
  onSearch: () => void;
  onGuide: () => void;
  onSettings: () => void;
  showModes?: boolean;
}

const MODES: AppMode[] = ["live", "movie", "series"];

export const PanelHeader = memo(function PanelHeader(props: PanelHeaderProps) {
  const { t } = useLocale();
  const controls = availableModeControls(props.sourceKind, props.guideAvailable);
  const modes = props.showModes === false ? [] : MODES.filter((mode) => controls.includes(mode));
  const actions = controls.filter(
    (control): control is "search" | "guide" | "settings" => !MODES.includes(control as AppMode),
  );
  const modeLabel = (mode: AppMode) =>
    t(mode === "live" ? "content.live" : mode === "movie" ? "content.movies" : "content.series");

  return (
    <div
      className={`panel-bar ${props.activeMode === "live" ? "" : "vod-header"}`}
      role="toolbar"
    >
      <div className="brand">
        <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
        <p className="rail-brand">OpenIPTV</p>
      </div>
      {!!modes.length && (
        <nav className="panel-modes">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`panel-key mode-key ${props.focusedControl === mode ? "selected" : ""} ${props.activeMode === mode ? "on" : ""}`}
              onClick={() => props.onModeChange(mode)}
              aria-label={modeLabel(mode)}
              aria-pressed={props.activeMode === mode}
            >
              <Icon name={mode} />
              <span>{modeLabel(mode)}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="panel-keys">
        {actions.map((control) => {
          const label = t(
            control === "guide"
              ? "common.guide"
              : control === "search"
                ? "common.search"
                : "common.settings",
          );
          return (
            <button
              key={control}
              type="button"
              className={`panel-key ${props.focusedControl === control ? "selected" : ""}`}
              onClick={
                control === "guide"
                  ? props.onGuide
                  : control === "search"
                    ? props.onSearch
                    : props.onSettings
              }
              aria-label={label}
            >
              <Icon name={control} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
