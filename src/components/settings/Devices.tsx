import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { RemoteAccessControl } from "../../hooks/useRemoteAccess";
import {
  listPairedDevices,
  renamePairedDevice,
  revokePairedDevice,
  type PairedDevice,
} from "../../services/deviceAccess";
import { Confirm } from "../Confirm";
import { RemoteSetup } from "../RemoteSetup";

export function Devices({
  remoteAccess,
  onAsking,
}: {
  remoteAccess: RemoteAccessControl;
  onAsking: (asking: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const [, setRevision] = useState(0);
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState("");
  const [returning, setReturning] = useState("");
  const [showConnected, setShowConnected] = useState(false);
  const pairingWasOpen = useRef(!!remoteAccess.pairing);
  const renameInput = useRef<HTMLInputElement>(null);
  const pairAction = useRef<HTMLButtonElement>(null);
  const devices: PairedDevice[] = listPairedDevices();
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    if (editing) renameInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!returning || editing) return;
    document.querySelector<HTMLButtonElement>(`[data-device-edit="${returning}"]`)?.focus();
    setReturning("");
  }, [editing, returning]);

  useEffect(() => {
    if (remoteAccess.pairing) {
      pairingWasOpen.current = true;
      setShowConnected(false);
      document.querySelector<HTMLButtonElement>("[data-cancel-pairing]")?.focus();
      return;
    }
    if (!remoteAccess.connectedDevice || !pairingWasOpen.current) return;
    pairingWasOpen.current = false;
    setShowConnected(true);
    pairAction.current?.focus();
    const timer = window.setTimeout(() => setShowConnected(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [remoteAccess.connectedDevice, remoteAccess.pairing]);

  const ask = (id: string) => {
    setConfirming(id);
    onAsking(!!id);
  };
  const finishEdit = (id: string) => {
    setReturning(id);
    setEditing("");
  };

  return (
    <div className="device-access">
      <h3>{t("settings.remoteAccess")}</h3>
      {!remoteAccess.pairing && <p className="sheet-lead">{t("remote.pairedHint")}</p>}
      {(remoteAccess.pairing || showConnected) && (
        <RemoteSetup
          remoteAccess={remoteAccess}
          headingLevel={4}
          onCancelPairing={remoteAccess.pairing ? () => remoteAccess.cancelPairing() : undefined}
        />
      )}
      {remoteAccess.status === "starting" && (
        <p className="sheet-lead" role="status">{t("remote.starting")}</p>
      )}
      {remoteAccess.pairingError && (
        <p className="field-problem" role="alert">{t("remote.pairingFailed")}</p>
      )}
      {remoteAccess.status === "unavailable" && (
        <>
          <p className="field-problem" role="alert">{t("remote.unavailable")}</p>
          <div className="actions device-access-actions">
            <button type="button" className="btn tonal" onClick={remoteAccess.retry}>
              {t("remote.retry")}
            </button>
          </div>
        </>
      )}
      {remoteAccess.status === "listening" && !remoteAccess.pairing && (
        <div className="actions device-access-actions">
          <button
            ref={pairAction}
            type="button"
            className="btn tonal"
            onClick={remoteAccess.openPairing}
          >
            {t("remote.add")}
          </button>
        </div>
      )}
      <div className="device-list">
        {devices.map((device) => (
          <div className="device-row" key={device.id}>
            {editing === device.id ? (
              <form
                className="form device-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (renamePairedDevice(device.id, name)) refresh();
                  finishEdit(device.id);
                }}
              >
                <label htmlFor={`device-${device.id}`}>{t("remote.deviceName")}</label>
                <input
                  id={`device-${device.id}`}
                  value={name}
                  dir="auto"
                  ref={renameInput}
                  onChange={(event) => setName(event.target.value)}
                />
                <div className="actions">
                  <button type="submit" className="btn filled">
                    {t("common.save")}
                  </button>
                  <button
                    type="button"
                    className="btn tonal"
                    onClick={() => finishEdit(device.id)}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="device-row-main">
                  <strong dir="auto">{device.name}</strong>
                  <span>{t("remote.lastUsed", { when: new Date(device.lastUsedAt).toLocaleDateString(locale) })}</span>
                </div>
                <button
                  type="button"
                  className="btn tonal"
                  aria-label={t("remote.renameAria", { name: device.name })}
                  data-device-edit={device.id}
                  onClick={() => {
                    setEditing(device.id);
                    setName(device.name);
                  }}
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="btn tonal"
                  aria-label={t("remote.revokeAria", { name: device.name })}
                  onClick={() => ask(device.id)}
                >
                  {t("remote.revoke")}
                </button>
              </>
            )}
          </div>
        ))}
        {!devices.length && <p className="sheet-lead device-empty">{t("remote.noDevices")}</p>}
      </div>
      {confirming && (
        <Confirm
          title={t("remote.revokeQuestion", {
            name: devices.find((device) => device.id === confirming)?.name ?? "",
          })}
          body={t("remote.revokeBody")}
          confirmLabel={t("remote.revoke")}
          cancelLabel={t("common.cancel")}
          destructive
          onCancel={() => ask("")}
          onConfirm={() => {
            revokePairedDevice(confirming);
            ask("");
            refresh();
          }}
        />
      )}
    </div>
  );
}
