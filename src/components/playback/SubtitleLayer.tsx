/**
 * The application's own subtitle text, inside the television safe area.
 *
 * One text node with `dir="auto"`: whatever markup a provider embeds is rendered as the
 * text it is, and a right to left cue finds its own direction rather than inheriting the
 * interface's. The layer renders nothing when subtitles are Off or there is no cue, and a
 * sibling selector in the stylesheet lifts it above the deck whenever the deck is showing,
 * because controls and captions must never share the same strip of the picture.
 */
export interface SubtitleLayerProps {
  cue: string;
  hidden: boolean;
}

export function SubtitleLayer({ cue, hidden }: SubtitleLayerProps) {
  if (hidden || !cue) return null;
  return (
    <div className="subtitle-layer" aria-live="off">
      <p className="subtitle-cue" dir="auto">
        {cue}
      </p>
    </div>
  );
}
