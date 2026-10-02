import { useLocale } from "../hooks/useLocale";
import { LOCALE_OPTIONS, localeLabelKey, type LocalePreference } from "../services/locale";
import { OptionPicker } from "./OptionPicker";

export function LanguagePicker({
  value,
  onChange,
}: {
  value: LocalePreference;
  onChange: (value: LocalePreference) => void;
}) {
  const { t } = useLocale();
  return (
    <OptionPicker
      label={t("settings.language")}
      value={value}
      options={LOCALE_OPTIONS.map((option) => ({
        value: option.id,
        label: option.nativeLabel,
        secondary: t(localeLabelKey(option.id)),
      }))}
      onChange={onChange}
    />
  );
}
