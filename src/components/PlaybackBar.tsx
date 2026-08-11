import { useEffect, useRef } from "react";
import { useSpatialNav } from "../hooks/useSpatialNav";

/**
 * On screen playback controls.
 *
 * Checklist item 3.1 requires them, and 3.2 requires every one to be reachable with the
 * four directional buttons and SELECT. The Smart Remote has only a single physical
 * PLAY/PAUSE key, which is why Samsung insists the rest live on screen.
 *
 * This is live television, so there is nothing to seek through. The useful controls are
 * the ones broadcast has always had: previous channel, pause, next channel, plus the two
 * doors out of the picture.
 */
interface Props {
  playing: boolean;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onList: () => void;
  onSettings: () => void;
}

export function PlaybackBar({ playing, onPrev, onPlayPause, onNext, onList, onSettings }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  useSpatialNav(bar, true);

  // The guidelines say that when the controls appear, PLAY/PAUSE is the focused one.
  useEffect(() => { playRef.current?.focus(); }, []);

  return (
    <div className="playbar" ref={bar} role="group" aria-label="Playback controls">
      <button type="button" className="pbtn" onClick={onPrev} aria-label="Previous channel">
        <span aria-hidden="true">{"\u23EE"}</span>
      </button>
      <button type="button" className="pbtn primary" ref={playRef} onClick={onPlayPause}
              aria-label={playing ? "Pause" : "Play"}>
        <span aria-hidden="true">{playing ? "\u23F8" : "\u25B6"}</span>
      </button>
      <button type="button" className="pbtn" onClick={onNext} aria-label="Next channel">
        <span aria-hidden="true">{"\u23ED"}</span>
      </button>
      <span className="pbar-gap" />
      <button type="button" className="pbtn wide" onClick={onList}>Channels</button>
      <button type="button" className="pbtn wide" onClick={onSettings}>Settings</button>
    </div>
  );
}
