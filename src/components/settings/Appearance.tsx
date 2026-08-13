import { FONTS, FONT_SIZES, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { Choice, Row, Toggle } from "./Field";

export function Appearance() {
  const s = useSettings();
  const { channels } = useChannels();
  const font = s.font();
  /**
   * The preview, in the script the viewer is actually going to read.
   *
   * A pangram in English tells someone whose playlist is in Persian, Greek or Thai nothing
   * whatsoever about whether the font they have just chosen can draw it. The names in the
   * loaded playlist are the only honest sample, so the preview is three of them, and the
   * pangram is the fallback for when nothing is loaded yet.
   */
  const sample = channels.length
    ? channels.slice(0, 3).map((c) => c.name).join("   \u00b7   ")
    : "The quick brown fox jumps over the lazy dog";
  return (
    <>
      <h3>Appearance</h3>
      <Row label="Font" hint={font.note}>
        <Choice
          options={FONTS.map((f) => ({ id: f.id, label: f.label }))}
          value={s.fontId}
          onChange={(id) => s.set("fontId", id)}
        />
      </Row>
      <Row label="Text size">
        <Choice options={FONT_SIZES} value={s.fontSizeId} onChange={(id) => s.set("fontSizeId", id)} />
      </Row>
      <Row label="Channel numbers"><Toggle value={s.showNumbers} onChange={(v) => s.set("showNumbers", v)} /></Row>
      <Row label="Channel logos" hint="Turn off on a slow connection">
        <Toggle value={s.showLogos} onChange={(v) => s.set("showLogos", v)} />
      </Row>
      <Row label="Clock"><Toggle value={s.showClock} onChange={(v) => s.set("showClock", v)} /></Row>
      <p className="preview" style={{ fontFamily: font.stack }} dir="auto">
        {sample}
      </p>
      <p className="sheet-lead">
        Channel names appear exactly as the playlist writes them, in any language.
      </p>
    </>
  );
}
