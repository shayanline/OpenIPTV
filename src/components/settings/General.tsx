import { useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { useSettings } from "../../stores/settings";
import { clearCache, useChannels } from "../../stores/channels";
import { Confirm } from "../Confirm";
import { forgetAll } from "../../services/disk";
import { forgetRepairHosts } from "../../services/repair";
import { Row, Toggle } from "./Field";

export function General({ onAsking }: { onAsking: (asking: boolean) => void }) {
  const { t } = useLocale();
  const s = useSettings();
  const { load, clearPersonal } = useChannels();
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const ask = (open: boolean) => {
    setConfirming(open);
    onAsking(open);
  };
  const askClear = (open: boolean) => {
    setClearing(open);
    onAsking(open);
  };

  return (
    <>
      <h3>{t("settings.general")}</h3>
      <Row label={t("settings.resumeLast")} hint={t("settings.resumeLastHint")}>
        <Toggle
          label={t("settings.resumeLast")}
          value={s.resumeLast}
          onChange={(v) => s.set("resumeLast", v)}
        />
      </Row>
      <Row label={t("settings.clearCache")} hint={t("settings.clearCacheHint")}>
        <button
          type="button"
          className="btn flat"
          aria-label={t("settings.clearCache")}
          onClick={() => askClear(true)}
        >
          {t("common.clear")}
        </button>
      </Row>
      {/**
       * Asked before done, like every other question the app puts.
       *
       * It is the most destructive action in the application, on a screen where removing
       * a single playlist already stops to confirm, so going unguarded here would be the
       * one press that undoes everything.
       */}
      <Row label={t("settings.resetData")} hint={t("settings.resetDataHint")}>
        <button
          type="button"
          className="btn flat danger"
          aria-label={t("settings.resetData")}
          onClick={() => ask(true)}
        >
          {t("settings.resetData")}
        </button>
      </Row>

      {clearing && (
        <Confirm
          title={t("settings.clearCacheQuestion")}
          body={t("settings.clearCacheBody")}
          confirmLabel={t("settings.clearCache")}
          cancelLabel={t("common.cancel")}
          onCancel={() => askClear(false)}
          onConfirm={() => {
            void clearCache();
            forgetRepairHosts();
            askClear(false);
          }}
        />
      )}

      {confirming && (
        <Confirm
          title={t("settings.resetDataQuestion")}
          body={t("settings.resetDataBody")}
          confirmLabel={t("settings.resetData")}
          cancelLabel={t("common.cancel")}
          destructive
          onCancel={() => ask(false)}
          onConfirm={() => {
            // App data has to mean all app data. Favourites and the last played channel
            // live in the other store and used to survive a reset, so the app came back
            // claiming to be freshly installed while still remembering what you liked. The
            // cached playlists and logos are the third store and had the same problem: an
            // app with no playlists configured, holding a copy of one.
            s.reset();
            clearPersonal();
            void forgetAll();
            // The fourth store follows the same rule, and which hosts this television cannot read
            // is a diagnosis it made rather than a fact.
            forgetRepairHosts();
            ask(false);
            void load(true);
          }}
        />
      )}
    </>
  );
}
