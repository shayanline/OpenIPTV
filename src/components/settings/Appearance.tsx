import { FONT_SIZES, useSettings } from "../../stores/settings";
import { useChannels } from "../../stores/channels";
import { useLocale } from "../../hooks/useLocale";
import { Choice, Row, Toggle } from "./Field";
import { LanguagePicker } from "../LanguagePicker";

export function Appearance() {
  const s = useSettings();
  const { t } = useLocale();
  const fontOptions = FONT_SIZES.map((option) => ({
    ...option,
    label:
      option.id === "s"
        ? t("settings.small")
        : option.id === "m"
          ? t("settings.medium")
          : option.id === "l"
            ? t("settings.large")
            : t("settings.extraLarge"),
  }));
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
    ? channels
        .slice(0, 3)
        .map((c) => c.name)
        .join("   \u00b7   ")
    : "";
  return (
    <>
      <h3>{t("settings.appearance")}</h3>
      <Row label={t("settings.language")} hint={t("settings.languageHint")}>
        <LanguagePicker
          value={s.locale}
          onChange={(id) => {
            s.set("locale", id);
            if (s.sortAlphabetically) void load();
          }}
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
      <Row label={t("settings.textSize")} hint={t("settings.textSizeHint")}>
        <Choice
          label={t("settings.textSize")}
          options={fontOptions}
          value={s.fontSizeId}
          onChange={(id) => s.set("fontSizeId", id)}
        />
      </Row>
      <Row label={t("settings.showNumbers")} hint={t("settings.showNumbersHint")}>
        <Toggle
          label={t("settings.showNumbers")}
          value={s.showNumbers}
          onChange={(v) => s.set("showNumbers", v)}
        />
      </Row>
      <Row label={t("settings.showLogos")} hint={t("settings.showLogosHint")}>
        <Toggle
          label={t("settings.showLogos")}
          value={s.showLogos}
          onChange={(v) => s.set("showLogos", v)}
        />
      </Row>
      <Row label={t("settings.showClock")} hint={t("settings.showClockHint")}>
        <Toggle
          label={t("settings.showClock")}
          value={s.showClock}
          onChange={(v) => s.set("showClock", v)}
        />
      </Row>
      {/*
       * Sorting lives here rather than under Watching, where it used to be.
       *
       * It changes the order of the list on this screen's own terms, beside the two rows that decide
       * what else that list shows. Watching is about the picture, and a channel order is not part of
       * the picture: it was there only because it is not about the picture, which is a reason to
       * exclude it from somewhere rather than a reason to put it here.
       */}
      <Row label={t("settings.sortAlphabetically")} hint={t("settings.sortAlphabeticallyHint")}>
        <Toggle
          label={t("settings.sortAlphabetically")}
          value={s.sortAlphabetically}
          onChange={(v) => {
            s.set("sortAlphabetically", v);
            load();
          }}
        />
      </Row>
      <p className="preview" dir="auto">
        {sample || t("settings.previewFallback")}
      </p>
      <p className="sheet-lead">{t("settings.playlistNamesPreserved")}</p>
    </>
  );
}
