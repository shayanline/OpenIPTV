import { FONT_SIZES, useSettings } from "../../stores/settings";
import { useLocale } from "../../hooks/useLocale";
import { resolveLocale } from "../../services/locale";
import { rematerialise } from "../../stores/lineup";
import { Choice, PageHeader, Row, Toggle } from "./Field";
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
  return (
    <>
      <PageHeader title={t("settings.appearance")} />
      <Row label={t("settings.language")} hint={t("settings.languageHint")}>
        <LanguagePicker
          value={s.locale}
          onChange={(id) => {
            s.set("locale", id);
            rematerialise(resolveLocale(id));
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
    </>
  );
}
