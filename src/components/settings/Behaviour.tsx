import { ASPECTS, useSettings } from "../../stores/settings";
import { useLocale } from "../../hooks/useLocale";
import { Choice, PageHeader, Row, Toggle } from "./Field";
import { stopRepair } from "../../services/repair";

export function Playback() {
  const s = useSettings();
  const { t } = useLocale();
  const aspects = ASPECTS.map((aspect) => ({
    ...aspect,
    label: t(
      aspect.id === "fill"
        ? "settings.fill"
        : aspect.id === "fit"
          ? "settings.fit"
          : "settings.stretch",
    ),
    note: t(
      aspect.id === "fill"
        ? "settings.fillHint"
        : aspect.id === "fit"
          ? "settings.fitHint"
          : "settings.stretchHint",
    ),
  }));

  return (
    <>
      <PageHeader title={t("settings.playback")} />
      <Row
        label={t("settings.screenFit")}
        hint={aspects.find((a) => a.id === s.aspectId)?.note}
      >
        <Choice
          label={t("settings.screenFit")}
          options={aspects}
          value={s.aspectId}
          onChange={(id) => s.set("aspectId", id)}
        />
      </Row>
      <Row label={t("settings.resumeLast")} hint={t("settings.resumeLastHint")}>
        <Toggle
          label={t("settings.resumeLast")}
          value={s.resumeLast}
          onChange={(value) => s.set("resumeLast", value)}
        />
      </Row>
      <Row label={t("settings.compatibility")} hint={t("settings.compatibilityHint")}>
        <Toggle
          label={t("settings.compatibility")}
          value={s.compatibility}
          onChange={(v) => {
            s.set("compatibility", v);
            // Turning it off has to take effect now, not at the next channel: the socket and its
            // refresh loop are exactly what the viewer just asked to be rid of.
            if (!v) stopRepair();
          }}
        />
      </Row>
      <Row label={t("settings.playbackInfo")} hint={t("settings.playbackInfoHint")}>
        <Toggle
          label={t("settings.playbackInfo")}
          value={s.showPlaybackStats}
          onChange={(value) => s.set("showPlaybackStats", value)}
        />
      </Row>
    </>
  );
}
