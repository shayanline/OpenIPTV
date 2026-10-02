import { useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { APP_VERSION, REPO_URL } from "../../meta";
import type { SettingsDetailNavigation } from "../Settings";
import { Icon } from "../Icon";
import { Diagnostics } from "./Diagnostics";
import { ApplicationData } from "./General";
import { PageHeader, Row, SettingsSection } from "./Field";

export function About({
  onAsking,
  navigation,
}: {
  onAsking: (asking: boolean) => void;
  navigation: SettingsDetailNavigation;
}) {
  const { t } = useLocale();
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (showDiagnostics) return <Diagnostics onAsking={onAsking} nested />;
  return (
    <>
      <PageHeader title={t("about.title")} />
      <div className="about">
        <div className="about-copy">
          <div className="about-identity">
            <img className="about-app-icon" src="./icon.svg" alt="" />
            <div>
              <strong>OpenIPTV</strong>
              <p dir="ltr">{t("about.version", { version: APP_VERSION })}</p>
            </div>
          </div>
          <a
            className="about-repository"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
          >
            {REPO_URL}
          </a>
          <p className="sheet-lead about-summary">{t("about.description")}</p>
        </div>
        <img className="qr" src="./repo-qr.svg" alt={t("about.qrAlt", { url: REPO_URL })} />
      </div>
      <SettingsSection title={t("settings.support")}>
        <Row label={t("diagnostics.title")} hint={t("diagnostics.lead")}>
          <button
            type="button"
            className="btn tonal"
            data-settings-focus="about-diagnostics"
            onClick={() => {
              setShowDiagnostics(true);
              navigation.open(
                "about-diagnostics",
                t("diagnostics.title"),
                "about-diagnostics",
                () => setShowDiagnostics(false),
              );
            }}
          >
            <Icon name="diagnostics" />
            <span>{t("common.open")}</span>
          </button>
        </Row>
      </SettingsSection>
      <SettingsSection title={t("settings.applicationData")}>
        <ApplicationData onAsking={onAsking} />
      </SettingsSection>
    </>
  );
}
