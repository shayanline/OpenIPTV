import { useEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { RemoteAccessControl } from "../../hooks/useRemoteAccess";
import {
  listPairedDevices,
  renamePairedDevice,
  revokePairedDevice,
  type PairedDevice,
  type PairingSessionView,
} from "../../services/deviceAccess";
import type { SettingsDetailNavigation } from "../Settings";
import { Confirm } from "../Confirm";
import { Icon } from "../Icon";
import { RemoteSetup } from "../RemoteSetup";
import { TextInput } from "../TextInput";
import { PageHeader, SettingsListHeader } from "./Field";
import { SettingsDialog } from "./SettingsDialog";

export function Devices({
  remoteAccess,
  onAsking,
  navigation,
}: {
  remoteAccess: RemoteAccessControl;
  onAsking: (asking: boolean, restoreFocus?: boolean) => void;
  navigation: SettingsDetailNavigation;
}) {
  const { t, locale, number } = useLocale();
  const [, setRevision] = useState(0);
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState("");
  const [showConnected, setShowConnected] = useState(false);
  const [pairingOpen, setPairingOpen] = useState(false);
  const ownedPairing = useRef<PairingSessionView | null>(null);
  const remoteAccessRef = useRef(remoteAccess);
  remoteAccessRef.current = remoteAccess;
  const cancelPairingRef = useRef(remoteAccess.cancelPairing);
  cancelPairingRef.current = remoteAccess.cancelPairing;
  const devices: PairedDevice[] = listPairedDevices();
  const refresh = () => setRevision((value) => value + 1);

  const closePairing = () => {
    const access = remoteAccessRef.current;
    if (ownedPairing.current && access.pairing === ownedPairing.current) {
      access.cancelPairing();
    }
    ownedPairing.current = null;
    setPairingOpen(false);
    onAsking(false, true);
  };

  const startPairing = () => {
    if (!navigation.inputEnabled || ownedPairing.current || pairingOpen) return;
    const access = remoteAccessRef.current;
    if (access.pairing) return;
    const session = access.openPairing();
    if (!session) return;
    ownedPairing.current = session;
    onAsking(true);
    setPairingOpen(true);
  };

  const retryPairing = () => {
    const session = remoteAccess.openPairing();
    if (session) ownedPairing.current = session;
    return session;
  };

  useEffect(() => {
    const owned = ownedPairing.current;
    if (!owned || remoteAccess.pairing === owned) return;
    ownedPairing.current = null;
    if (!remoteAccess.connectedDevice && !remoteAccess.pairing) return;
    if (remoteAccess.connectedDevice) setShowConnected(true);
    setPairingOpen(false);
    onAsking(false, true);
  }, [remoteAccess.pairing, remoteAccess.connectedDevice, onAsking]);

  useEffect(() => {
    if (!showConnected) return;
    const timer = window.setTimeout(() => setShowConnected(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [showConnected]);

  useEffect(() => {
    return () => {
      const access = remoteAccessRef.current;
      if (ownedPairing.current && access.pairing === ownedPairing.current) {
        cancelPairingRef.current();
      }
      ownedPairing.current = null;
    };
  }, []);

  const ask = (id: string) => {
    setConfirming(id);
    onAsking(!!id);
  };
  const closeEdit = () => {
    setEditing("");
    onAsking(false, true);
  };
  const editingDevice = devices.find((device) => device.id === editing) || null;
  useEffect(() => {
    if (editing && !devices.some((device) => device.id === editing)) {
      setEditing("");
      onAsking(false);
    }
  }, [editing, devices, onAsking]);

  return (
    <div className="device-access">
      <PageHeader title={t("settings.remoteAccess")} description={t("remote.pairedHint")} />
      {showConnected && remoteAccess.connectedDevice && (
        <p className="settings-status" role="status">
          {t("remote.connected", { name: remoteAccess.connectedDevice })}
        </p>
      )}
      {remoteAccess.status === "starting" && (
        <p className="sheet-lead" role="status">
          {t("remote.starting")}
        </p>
      )}
      {remoteAccess.pairingError && (
        <p className="field-problem" role="alert">
          {t("remote.pairingFailed")}
        </p>
      )}
      {remoteAccess.status === "unavailable" && (
        <p className="field-problem" role="alert">
          {t("remote.unavailable")}
        </p>
      )}
      <SettingsListHeader
        className="device-list-header"
        title={t("remote.pairedDevices")}
        count={number(devices.length)}
      >
        {(remoteAccess.status === "unavailable" ||
          (remoteAccess.status === "listening" && (!remoteAccess.pairing || pairingOpen))) && (
          <div className="actions device-access-actions">
            {remoteAccess.status === "unavailable" ? (
              <button
                type="button"
                className="btn tonal"
                data-settings-focus="device-pair"
                onClick={remoteAccess.retry}
              >
                <Icon name="refresh" />
                <span>{t("remote.retry")}</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn tonal"
                data-settings-focus="device-pair"
                onClick={startPairing}
              >
                <Icon name="plus" />
                <span>{t("remote.add")}</span>
              </button>
            )}
          </div>
        )}
      </SettingsListHeader>
      <div className="device-list">
        {devices.map((device) => (
          <div className="device-row management-row" key={device.id}>
            <button
              type="button"
              className="device-row-info management-row-primary"
              data-device-rename={device.id}
              data-settings-focus={`device-rename-${device.id}`}
              data-ok-guide={t("common.rename")}
              aria-label={`${t("common.rename")}, ${device.name}`}
              title={t("common.rename")}
              aria-haspopup="dialog"
              onClick={(event) => {
                if (!navigation.inputEnabled) return;
                event.currentTarget.focus();
                setEditing(device.id);
                setName(device.name);
                onAsking(true);
              }}
            >
              <span className="device-row-main">
                <strong dir="auto">{device.name}</strong>
                <span className="management-row-meta">
                  {t("remote.lastUsed", {
                    when: new Date(device.lastUsedAt).toLocaleDateString(locale),
                  })}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="management-row-actions danger"
              data-device-revoke={device.id}
              data-settings-focus={`device-revoke-${device.id}`}
              data-ok-guide={t("remote.revoke")}
              aria-label={`${t("remote.revoke")}, ${device.name}`}
              title={t("remote.revoke")}
              aria-haspopup="dialog"
              onClick={(event) => {
                if (!navigation.inputEnabled) return;
                event.currentTarget.focus();
                ask(device.id);
              }}
            >
              <Icon name="remove" />
            </button>
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
      {editingDevice && (
        <SettingsDialog
          title={t("common.rename")}
          inputEnabled={navigation.surfaceInputEnabled}
          onClose={closeEdit}
          onSave={() => {
            if (!name.trim()) return;
            if (renamePairedDevice(editingDevice.id, name)) {
              refresh();
              closeEdit();
            }
          }}
          saveDisabled={!name.trim()}
        >
          <div className="form">
            <label htmlFor="device-edit-name">{t("remote.deviceName")}</label>
            <TextInput
              id="device-edit-name"
              data-settings-detail-first
              value={name}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </SettingsDialog>
      )}
      {pairingOpen && (
        <SettingsDialog
          title={t("remote.add")}
          inputEnabled={navigation.surfaceInputEnabled}
          onClose={closePairing}
          closeLabel={t("common.cancel")}
          className="device-pairing-dialog"
        >
          <p className="device-pairing-description">{t("remote.pairedHint")}</p>
          <RemoteSetup
            variant="settings"
            embedded
            autoStart={false}
            remoteAccess={remoteAccess}
            onOpenPairing={retryPairing}
          />
        </SettingsDialog>
      )}
    </div>
  );
}
