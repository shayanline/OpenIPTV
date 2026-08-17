import { FONT_SIZES, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { Choice, Row, Toggle } from "./Field";

export function Appearance() {
  const s = useSettings();
  // `load` because sorting rebuilds the lists from the playlist that is already in hand: the order
  // is applied while the channels are read, so nothing changes on screen until they are read again.
  const { channels, load } = useChannels();
  /**
   * The preview, in the writing the viewer is actually going to read.
   *
   * It previews the text size now that the type face has gone, and the sample is still taken from
   * the playlist rather than invented: a line of English tells somebody whose channels are named in
   * Persian, Greek or Thai nothing about whether the size they have chosen is comfortable for the
   * names they will be reading. The pangram is the fallback for when nothing is loaded yet.
   */
  const sample = channels.length
    ? channels.slice(0, 3).map((c) => c.name).join("   \u00b7   ")
    : "The quick brown fox jumps over the lazy dog";
  return (
    <>
      <h3>Appearance</h3>
      {/*
        * Every row here says what it changes, including the three that used to say nothing.
        *
        * A label alone answers "what is this called" and not "what happens if I turn it off", and
        * these three were the ambiguous ones: numbers could plausibly mean dialling rather than
        * showing, a clock could be anywhere on the screen, and text size could be the channel names
        * alone rather than the whole interface. A viewer at three metres should not have to try a
        * setting to find out what it does.
        */}
      <Row label="Text size" hint="Applies throughout the app">
        <Choice label="Text size" options={FONT_SIZES} value={s.fontSizeId} onChange={(id) => s.set("fontSizeId", id)} />
      </Row>
      <Row label="Show channel numbers" hint="Display numbers beside channel names">
        <Toggle label="Show channel numbers" value={s.showNumbers} onChange={(v) => s.set("showNumbers", v)} />
      </Row>
      <Row label="Show channel logos" hint="Load logos from playlist addresses">
        <Toggle label="Show channel logos" value={s.showLogos} onChange={(v) => s.set("showLogos", v)} />
      </Row>
      <Row label="Show clock" hint="Display a clock while the channel list is open">
        <Toggle label="Show clock" value={s.showClock} onChange={(v) => s.set("showClock", v)} />
      </Row>
      {/*
        * Sorting lives here rather than under Watching, where it used to be.
        *
        * It changes the order of the list on this screen's own terms, beside the two rows that decide
        * what else that list shows. Watching is about the picture, and a channel order is not part of
        * the picture: it was there only because it is not about the picture, which is a reason to
        * exclude it from somewhere rather than a reason to put it here.
        */}
      <Row label="Sort channels alphabetically" hint="Sort by channel name instead of playlist order">
        <Toggle
          label="Sort channels alphabetically"
          value={s.sortAlphabetically}
          onChange={(v) => { s.set("sortAlphabetically", v); load(); }}
        />
      </Row>
      <p className="preview" dir="auto">
        {sample}
      </p>
      <p className="sheet-lead">
        Channel names appear exactly as the playlist writes them, in any language.
      </p>
    </>
  );
}
