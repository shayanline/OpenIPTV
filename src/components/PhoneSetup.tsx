import { useEffect, useMemo } from "react";
import { encode } from "uqr";
import { useLocale } from "../hooks/useLocale";
import type { PairingSessionView } from "../services/phoneAccess";
import type { PhoneManagementState } from "../services/phoneServer";

export interface PhoneSetupProps {
  management: PhoneManagementState;
  onOpenPairing?: () => PairingSessionView;
}

export function PhoneSetup({ management, onOpenPairing }: PhoneSetupProps) {
  const { t } = useLocale();
  useEffect(() => {
    if (
      management.status === "listening" &&
      !management.pairing &&
      !management.connectedPhone &&
      onOpenPairing
    ) {
      onOpenPairing();
    }
  }, [management.status, management.pairing, management.connectedPhone, onOpenPairing]);

  const address = management.address
    ? `http://${management.address}:${management.port}`
    : "";
  const setupUrl = management.pairing
    ? `${address}/#pair=${encodeURIComponent(management.pairing.secret)}`
    : "";
  const qr = useMemo(() => {
    if (!setupUrl) return null;
    const encoded = encode(setupUrl, { ecc: "M" });
    const pieces: string[] = [];
    for (let y = 0; y < encoded.data.length; y += 1) {
      for (let x = 0; x < encoded.data[y].length; x += 1) {
        if (encoded.data[y][x]) pieces.push(`M${x + 2} ${y + 2}h1v1h-1z`);
      }
    }
    return { path: pieces.join(""), size: encoded.size + 4 };
  }, [setupUrl]);

  const status = management.connectedPhone
    ? t("phone.connected", { name: management.connectedPhone })
    : management.status === "unavailable"
      ? t("phone.unavailable")
      : t("phone.waiting");

  return (
    <section className="phone-setup" aria-labelledby="phone-setup-title">
      <h2 id="phone-setup-title">{t("phone.setupTitle")}</h2>
      <p className="phone-setup-lead">{t("phone.setupBody")}</p>
      {qr && (
        <div className="phone-qr" role="img" aria-label={t("phone.qrAlt")}>
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" focusable="false">
            <path d={qr.path} />
          </svg>
        </div>
      )}
      {address && (
        <div className="phone-manual">
          <span>{t("phone.addressHint")}</span>
          <strong dir="ltr">{address}</strong>
          {management.pairing && (
            <>
              <span>{t("phone.codeHint")}</span>
              <strong className="phone-code" dir="ltr">
                {management.pairing.code}
              </strong>
            </>
          )}
        </div>
      )}
      <p className={`phone-status ${management.status}`} role="status">
        {status}
      </p>
      {management.status === "unavailable" && (
        <p className="phone-fallback">{t("phone.manualFallback")}</p>
      )}
    </section>
  );
}
