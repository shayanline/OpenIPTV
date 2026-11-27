/**
 * The application's own subtitle text, inside the television safe area.
 *
 * One text node inherits the app direction and renders provider markup as literal text.
 * The layer renders nothing when subtitles are Off or there is no cue. Open playback
 * controls position it above their top edge, while other surfaces use the safe area.
 */
export interface SubtitleLayerProps {
  cue: string;
  hidden: boolean;
}

export function SubtitleLayer({ cue, hidden }: SubtitleLayerProps) {
  if (hidden || !cue) return null;
  return (
    <div className="subtitle-layer" aria-live="off">
      <p className="subtitle-cue">{cue}</p>
    </div>
  );
}
