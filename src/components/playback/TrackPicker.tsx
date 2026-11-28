import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pointerInputActive, pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { KEY } from "../../hooks/useRemote";
import { automaticTrack } from "../../services/playbackTracks";
import type { MediaTrack } from "../../types";
import { Icon } from "../Icon";

export interface TrackPickerOption {
  id: string;
  label: string;
  selected: boolean;
  engineIndex: number | null;
  automatic?: boolean;
}

export interface TrackPickerProps {
  kind: "audio" | "subtitle";
  tracks: readonly MediaTrack[];
  /** The normalized identity of the selected track, or null when nothing is on. */
  selectedIdentity: string | null;
  deviceLanguage: string;
  inputEnabled?: boolean;
  /**
   * Apply a choice now and report whether the engine took it. `automatic` marks the
   * device language row so the choice can follow the language rather than pinning a track.
   */
  onSelect(engineIndex: number | null, identity: string | null, automatic?: boolean): boolean;
}

/**
 * The option list inside an Audio or Subtitles drawer. It owns its own directional focus,
 * clamped at both ends like every focus list, and applies a choice the moment it is made:
 * the row stays focused and the viewer hears the result immediately. A selection the engine
 * refuses leaves the previously selected row marked, because the prop still says what is
 * actually on and this component keeps no optimistic state of its own.
 */
export function TrackPicker({
  kind,
  tracks,
  selectedIdentity,
  deviceLanguage,
  inputEnabled = true,
  onSelect,
}: TrackPickerProps) {
  const { t } = useLocale();
  const list = useRef<HTMLDivElement>(null);
  const prepared = useRef(false);

  const options = useMemo<TrackPickerOption[]>(() => {
    const rows: TrackPickerOption[] = [];
    if (kind === "subtitle") {
      rows.push({
        id: "off",
        label: t("deck.off"),
        selected: selectedIdentity === null,
        engineIndex: null,
      });
      /*
       * Automatic exists only when exactly one track speaks the device language: two
       * matches are a guess and zero is a lie.
       */
      const automatic = automaticTrack(tracks, deviceLanguage);
      if (automatic) {
        rows.push({
          id: "automatic",
          label: t("deck.automatic"),
          selected: automatic.identity === selectedIdentity,
          engineIndex: automatic.engineIndex,
          automatic: true,
        });
      }
    }
    for (const track of tracks) {
      rows.push({
        id: track.id,
        label: track.label || track.language || track.id,
        selected: track.identity === selectedIdentity,
        engineIndex: track.engineIndex,
      });
    }
    return rows;
  }, [kind, tracks, selectedIdentity, deviceLanguage, t]);

  const [focus, setFocus] = useState(() => {
    const at = options.findIndex((option) => option.selected);
    return at === -1 ? 0 : at;
  });
  const previousOptions = useRef(options);

  useLayoutEffect(() => {
    const previous = previousOptions.current;
    previousOptions.current = options;
    if (
      previous.length === options.length &&
      options.every((option, index) => option.id === previous[index].id)
    )
      return;
    const at = options.findIndex((option) => option.selected);
    setFocus(at === -1 ? 0 : at);
  }, [options]);

  useLayoutEffect(() => {
    if (!inputEnabled) return;
    const root = list.current;
    const target = root?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focus];
    if (!root || !target) return;
    target.focus({ preventScroll: true });
    const reveal = !prepared.current || !pointerInputActive();
    prepared.current = true;
    if (!reveal || !root.clientHeight) return;
    const top = target.offsetTop;
    const bottom = top + target.offsetHeight;
    if (top < root.scrollTop) root.scrollTop = top;
    else if (bottom > root.scrollTop + root.clientHeight)
      root.scrollTop = bottom - root.clientHeight;
  }, [focus, inputEnabled, options]);

  const choose = useCallback(
    (option: TrackPickerOption) => {
      if (!inputEnabled) return;
      onSelect(
        option.engineIndex,
        option.automatic
          ? option.id
          : option.id === "off"
            ? null
            : trackIdentityOf(option, tracks),
        option.automatic,
      );
    },
    [inputEnabled, onSelect, tracks],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const code = event.keyCode;
      if (![KEY.UP, KEY.DOWN, KEY.ENTER].includes(code as never)) return;
      event.preventDefault();
      if (!inputEnabled) return;
      if (code === KEY.UP) {
        setFocus((at) => Math.max(0, at - 1));
      } else if (code === KEY.DOWN) {
        setFocus((at) => Math.min(options.length - 1, at + 1));
      } else if (code === KEY.ENTER) {
        const option = options[focus];
        if (option) choose(option);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, focus, choose, inputEnabled]);

  return (
    <div
      className="track-picker"
      ref={list}
      role="listbox"
      aria-disabled={!inputEnabled || undefined}
      aria-label={t(kind === "audio" ? "deck.audio" : "deck.subtitles")}
    >
      {options.map((option, at) => (
        <button
          key={option.id}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={option.selected}
          data-selected={focus === at || undefined}
          className={option.selected ? "track-option selected" : "track-option"}
          onPointerEnter={() => pointerOnly(() => setFocus(at))}
          onClick={() => {
            if (!inputEnabled) return;
            setFocus(at);
            choose(option);
          }}
        >
          <span className="track-option-label">{option.label}</span>
          <span className="track-option-check" aria-hidden="true">
            {option.selected && <Icon name="check" />}
          </span>
        </button>
      ))}
    </div>
  );
}

function trackIdentityOf(
  option: TrackPickerOption,
  tracks: readonly MediaTrack[],
): string | null {
  const track = tracks.find((item) => item.id === option.id);
  return track ? track.identity : null;
}
