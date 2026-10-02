import { useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import type { PhoneManagementControl } from "../../hooks/usePhoneManagement";
import {
  listPairedPhones,
  renamePairedPhone,
  revokePairedPhone,
  type PairedPhone,
} from "../../services/phoneAccess";
import { Confirm } from "../Confirm";
import { PhoneSetup } from "../PhoneSetup";
import { PageHeader } from "./Field";
import { Icon } from "../Icon";

export function Phones({
  management,
  onAsking,
}: {
  management: PhoneManagementControl;
  onAsking: (asking: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const [, setRevision] = useState(0);
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [confirming, setConfirming] = useState("");
  const phones: PairedPhone[] = listPairedPhones();
  const refresh = () => setRevision((value) => value + 1);

  const ask = (id: string) => {
    setConfirming(id);
    onAsking(!!id);
  };

  return (
    <>
      <PageHeader title={t("settings.phoneAccess")} description={t("phone.pairedHint")} />
      {management.pairing && <PhoneSetup management={management} />}
      <div className="phone-list">
        {phones.map((phone) => (
          <div className="phone-row" key={phone.id}>
            {editing === phone.id ? (
              <div className="form phone-rename">
                <label htmlFor={`phone-${phone.id}`}>{t("phone.phoneName")}</label>
                <input
                  id={`phone-${phone.id}`}
                  value={name}
                  dir="auto"
                  onChange={(event) => setName(event.target.value)}
                />
                <div className="actions">
                  <button
                    type="button"
                    className="btn filled"
                    onClick={() => {
                      if (renamePairedPhone(phone.id, name)) refresh();
                      setEditing("");
                    }}
                  >
                    <span>{t("common.save")}</span>
                  </button>
                  <button type="button" className="btn tonal" onClick={() => setEditing("")}>
                    <span>{t("common.cancel")}</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="phone-row-main">
                  <strong dir="auto">{phone.name}</strong>
                  <span>
                    {t("phone.lastUsed", {
                      when: new Date(phone.lastUsedAt).toLocaleDateString(locale),
                    })}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn tonal"
                  aria-label={t("phone.renameAria", { name: phone.name })}
                  onClick={() => {
                    setEditing(phone.id);
                    setName(phone.name);
                  }}
                >
                  <Icon name="edit" />
                  <span>{t("common.edit")}</span>
                </button>
                <button
                  type="button"
                  className="btn tonal danger"
                  aria-label={t("phone.revokeAria", { name: phone.name })}
                  onClick={() => ask(phone.id)}
                >
                  <Icon name="unlink" />
                  <span>{t("phone.revoke")}</span>
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!phones.length && <p className="sheet-lead">{t("phone.noPhones")}</p>}
      <div className="actions">
        <button type="button" className="btn tonal" onClick={management.openPairing}>
          <Icon name="plus" />
          <span>{t("phone.add")}</span>
        </button>
      </div>
      {confirming && (
        <Confirm
          title={t("phone.revokeQuestion", {
            name: phones.find((phone) => phone.id === confirming)?.name ?? "",
          })}
          body={t("phone.revokeBody")}
          confirmLabel={t("phone.revoke")}
          cancelLabel={t("common.cancel")}
          destructive
          onCancel={() => ask("")}
          onConfirm={() => {
            revokePairedPhone(confirming);
            ask("");
            refresh();
          }}
        />
      )}
    </>
  );
}
