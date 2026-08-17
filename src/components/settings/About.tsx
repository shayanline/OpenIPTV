import { useLocale } from "../../hooks/useLocale";
import { APP_VERSION, REPO_URL } from "../../meta";

export function About() {
  const { t } = useLocale();
  return (
    <>
      <h3>{t("about.title")}</h3>
      <div className="about">
        <div>
          <h4>OpenIPTV</h4>
          <p dir="ltr">{t("about.version", { version: APP_VERSION })}</p>
          <p className="link" dir="ltr">
            {REPO_URL}
          </p>
          <p className="sheet-lead">{t("about.description")}</p>
          {/*
           * The disclaimer, for the person holding the remote rather than the one reading the
           * repository, and kept to two lines for a reason beyond brevity. Font sizes here are
           * calc(22px * scale) with a unitless line height, so line boxes are fractional, and
           * Chromium 69 rounds each one where a current engine does not. The drift accumulates
           * per line, and a longer paragraph than this puts this sheet over the parity gate's
           * four pixel tolerance, which is the gate telling the truth rather than complaining.
           */}
          <p className="sheet-lead">{t("about.disclaimer")}</p>
          <p className="sheet-lead">{t("about.qr")}</p>
        </div>
        <img className="qr" src="./repo-qr.svg" alt={t("about.qrAlt", { url: REPO_URL })} />
      </div>
    </>
  );
}
