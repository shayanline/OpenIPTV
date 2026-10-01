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
      <h3>{t("settings.phoneAccess")}</h3>
      <p className="sheet-lead">{t("phone.pairedHint")}</p>
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
                    {t("common.save")}
                  </button>
                  <button type="button" className="btn tonal" onClick={() => setEditing("")}>
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="phone-row-main">
                  <strong dir="auto">{phone.name}</strong>
                  <span>{t("phone.lastUsed", { when: new Date(phone.lastUsedAt).toLocaleDateString(locale) })}</span>
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
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className="btn tonal"
                  aria-label={t("phone.revokeAria", { name: phone.name })}
                  onClick={() => ask(phone.id)}
                >
                  {t("phone.revoke")}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {!phones.length && <p className="sheet-lead">{t("phone.noPhones")}</p>}
      <div className="actions">
        <button type="button" className="btn tonal" onClick={management.openPairing}>
          {t("phone.add")}
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
