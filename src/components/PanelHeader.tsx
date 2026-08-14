import { memo } from "react";
import { Icon } from "./Icon";

/**
 * The panel's title bar: the application's name, and the two keys that belong to the
 * application rather than to either column.
 *
 * It spans the whole panel, above both lists, and that is the point of it. Settings used to sit
 * inside the category rail's own header, which made an application level control look like part
 * of the category column, and there was nowhere to put a second one: a key at the far end of the
 * rail lands a few pixels from the channel column's heading and reads as though it belongs to the
 * channels. One UI puts the title and its actions on one line across the top of a surface, with a
 * divider under it, and then the content below is free to be two columns of rows.
 *
 * Search sits to the left of Settings, in reading order, because it is the one somebody reaches
 * for and Settings is the one they reach for twice a month.
 *
 * The keys are one cursor position between them, not two. Up from the first category arrives
 * here, on Search, and left and right choose between the pair exactly as they move within
 * anything else that is showing: left off Search leaves the panel and right off Settings goes to
 * the channel column, which is what those two keys already did at the rail's edges. Nothing new
 * to learn, and no fifth law.
 */
export const PanelHeader = memo(function PanelHeader({
  active, on, searching, onSearch, onSettings,
}: {
  /** Whether the remote's cursor is up here rather than in one of the lists. */
  active: boolean;
  /** Which of the two keys the cursor is on, while it is up here. */
  on: "search" | "settings";
  /** Whether the channel column is currently showing search results. */
  searching: boolean;
  onSearch: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="panel-bar">
      <div className="brand">
        {/*
          * The app's own mark, from the same file the launcher icon is rendered from.
          *
          * An <img> at the vector master rather than the glyph inlined here as JSX. The mark is a
          * squircle, a gradient and a television on a twenty unit grid, and it exists once in
          * public/icon.svg because `npm run icon` renders the set's launcher bitmap from it: a
          * second copy in a component is a copy that drifts the first time either is touched.
          *
          * Decorative, so it is hidden from anything reading the screen aloud. The application's
          * name is the text beside it, and hearing it twice is worse than not hearing the picture.
          */}
        <img className="brand-mark" src="./icon.svg" alt="" aria-hidden="true" />
        <p className="rail-brand">SimpleIPTV</p>
      </div>
      <div className="panel-keys">
        {/*
          * Two states, and they are different things. `selected` is the cursor resting on the
          * key, which only the pane holding the remote may draw. `on` is search being what the
          * channel column is showing, which stays true while the cursor is down in the results,
          * and is the same relationship the rail's `showing` category has with its column.
          */}
        <button
          type="button"
          className={`panel-key ${active && on === "search" ? "selected" : ""} `
            + `${searching ? "on" : ""}`}
          onClick={onSearch}
          /* The same word the key shows, rather than a longer description of it. An accessible
             name that does not contain the visible label is a name a viewer using voice control
             cannot say, and the field itself is where the fuller description belongs. */
          aria-label="Search"
          aria-pressed={searching}
        >
          <Icon name="search" />
          {/* In an element of its own rather than as a bare text node, so it is a flex item the
              stylesheet can reach: an anonymous flex item matches no selector, and the margin
              that stands in for flex gap on the 2020 and 2021 sets has nothing to apply to. */}
          <span>Search</span>
        </button>
        <button
          type="button"
          className={`panel-key ${active && on === "settings" ? "selected" : ""}`}
          onClick={onSettings}
          aria-label="Settings"
        >
          <Icon name="settings" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
});
