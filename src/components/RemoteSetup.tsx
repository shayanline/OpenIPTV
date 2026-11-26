import { useEffect, useMemo } from "react";
import { encode } from "uqr";
import { useLocale } from "../hooks/useLocale";
import type { PairingSessionView } from "../services/deviceAccess";
import type { RemoteAccessState } from "../services/remoteServer";

export interface RemoteSetupProps {
  remoteAccess: RemoteAccessState;
  onOpenPairing?: () => PairingSessionView | null;
  onCancelPairing?: () => void;
  manualFallback?: boolean;
  headingLevel?: 2 | 4;
  variant?: "onboarding" | "settings";
  autoStart?: boolean;
  embedded?: boolean;
}

export function RemoteSetup({
  remoteAccess,
  onOpenPairing,
  onCancelPairing,
  manualFallback = false,
  headingLevel = 2,
  variant = "onboarding",
  autoStart = true,
  embedded = false,
}: RemoteSetupProps) {
  const { t } = useLocale();
  useEffect(() => {
    if (
      autoStart &&
      remoteAccess.status === "listening" &&
      !remoteAccess.pairing &&
      !remoteAccess.pairingError &&
      !remoteAccess.connectedDevice &&
      onOpenPairing
    ) {
      onOpenPairing();
    }
  }, [
    autoStart,
    remoteAccess.status,
    remoteAccess.pairing,
    remoteAccess.pairingError,
    remoteAccess.connectedDevice,
    onOpenPairing,
  ]);

  const address = remoteAccess.address
    ? `http://${remoteAccess.address}:${remoteAccess.port}${remoteAccess.remotePath}`
    : "";
  const setupUrl =
    remoteAccess.pairing && address
      ? `${address}#pair=${encodeURIComponent(remoteAccess.pairing.secret)}`
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

  const status = remoteAccess.connectedDevice
    ? t("remote.connected", { name: remoteAccess.connectedDevice })
    : remoteAccess.status === "unavailable"
      ? t("remote.unavailable")
      : remoteAccess.status === "listening"
        ? t("remote.waiting")
        : t("remote.starting");
  const Heading = headingLevel === 4 ? "h4" : "h2";
  const variantClass = variant === "settings" ? " settings" : "";

  if (remoteAccess.connectedDevice) {
    return (
      <section className={"remote-setup connected" + variantClass} aria-live="polite">
        {!embedded && <Heading>{status}</Heading>}
        {!embedded && <p className="remote-setup-lead">{t("remote.pairedHint")}</p>}
      </section>
    );
  }

  if (remoteAccess.status !== "listening" || !remoteAccess.pairing) {
    const unavailable = remoteAccess.status === "unavailable";
    const failed = remoteAccess.pairingError;
    return (
      <section className={"remote-setup" + variantClass}>
        {!embedded && <Heading>{t("remote.setupTitle")}</Heading>}
        <p
          className={`remote-status ${remoteAccess.status}`}
          role={unavailable || failed ? "alert" : "status"}
        >
          {failed
            ? t("remote.pairingFailed")
            : unavailable
              ? t("remote.unavailable")
              : t("remote.starting")}
        </p>
        {failed && onOpenPairing && (
          <button type="button" className="btn tonal" onClick={onOpenPairing}>
            {t("remote.retry")}
          </button>
        )}
        {unavailable && manualFallback && (
          <p className="remote-fallback">{t("remote.manualFallback")}</p>
        )}
      </section>
    );
  }

  return (
    <section
      className={
        "remote-setup" + variantClass + (variant === "settings" && qr ? " has-qr" : "")
      }
      aria-labelledby={embedded ? undefined : "remote-setup-title"}
    >
      {!embedded && <Heading id="remote-setup-title">{t("remote.setupTitle")}</Heading>}
      {!embedded && <p className="remote-setup-lead">{t("remote.setupBody")}</p>}
      {qr && (
        <div className="remote-qr" role="img" aria-label={t("remote.qrAlt")}>
          <svg viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true" focusable="false">
            <path d={qr.path} />
          </svg>
        </div>
      )}
      {address && (
        <div className="remote-manual">
          <div className="remote-manual-group">
            <span>{t("remote.addressHint")}</span>
            <strong className="remote-address" dir="ltr">
              {address}
            </strong>
          </div>
          {remoteAccess.pairing && (
            <div className="remote-manual-group">
              <span>{t("remote.codeHint")}</span>
              <strong className="remote-code" dir="ltr">
                {`${remoteAccess.pairing.code.slice(0, 3)} ${remoteAccess.pairing.code.slice(3)}`}
              </strong>
              <span>{t("remote.expires")}</span>
            </div>
          )}
        </div>
      )}
      <p className={`remote-status ${remoteAccess.status}`} role="status">
        {status}
      </p>
      {onCancelPairing && (
        <div className="remote-pairing-action">
          <button
            type="button"
            className="btn tonal"
            data-cancel-pairing
            data-settings-detail-first={variant === "settings" ? "" : undefined}
            onClick={onCancelPairing}
          >
            {t("remote.cancelPairing")}
          </button>
        </div>
      )}
    </section>
  );
}
