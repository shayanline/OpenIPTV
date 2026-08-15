import { FONTS, FONT_SIZES, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { Choice, Row, Toggle } from "./Field";

export function Appearance() {
  const s = useSettings();
  // `load` because sorting rebuilds the lists from the playlist that is already in hand: the order
  // is applied while the channels are read, so nothing changes on screen until they are read again.
  const { channels, load } = useChannels();
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
      {/*
        * Every row here says what it changes, including the three that used to say nothing.
        *
        * A label alone answers "what is this called" and not "what happens if I turn it off", and
        * these three were the ambiguous ones: numbers could plausibly mean dialling rather than
        * showing, a clock could be anywhere on the screen, and text size could be the channel names
        * alone rather than the whole interface. A viewer at three metres should not have to try a
        * setting to find out what it does.
        */}
      <Row label="Text size" hint="Applies to everything in the app">
        <Choice options={FONT_SIZES} value={s.fontSizeId} onChange={(id) => s.set("fontSizeId", id)} />
      </Row>
      <Row label="Channel numbers" hint="Shown beside each name in the list">
        <Toggle value={s.showNumbers} onChange={(v) => s.set("showNumbers", v)} />
      </Row>
      <Row label="Channel logos" hint="Fetched from your playlist, so turning them off saves data">
        <Toggle value={s.showLogos} onChange={(v) => s.set("showLogos", v)} />
      </Row>
      <Row label="Clock" hint="In the corner while the channel list is open">
        <Toggle value={s.showClock} onChange={(v) => s.set("showClock", v)} />
      </Row>
      {/*
        * Sorting lives here rather than under Watching, where it used to be.
        *
        * It changes the order of the list on this screen's own terms, beside the two rows that decide
        * what else that list shows. Watching is about the picture, and a channel order is not part of
        * the picture: it was there only because it is not about the picture, which is a reason to
        * exclude it from somewhere rather than a reason to put it here.
        */}
      <Row label="Sort channels A to Z" hint="Otherwise they stay in the order your playlist sent them">
        <Toggle
          value={s.sortAlphabetically}
          onChange={(v) => { s.set("sortAlphabetically", v); load(); }}
        />
      </Row>
      <p className="preview" style={{ fontFamily: font.stack }} dir="auto">
        {sample}
      </p>
      <p className="sheet-lead">
        Channel names appear exactly as the playlist writes them, in any language.
      </p>
    </>
  );
}
