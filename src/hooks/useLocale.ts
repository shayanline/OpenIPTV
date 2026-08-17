import { useMemo } from "react";
import { useSettings } from "../stores/settings";
import {
  directionFor,
  formatNumber,
  formatTime,
  resolveLocale,
  translate,
  type MessageKey,
  type MessageValues,
} from "../services/locale";

export function useLocale() {
  const preference = useSettings((state) => state.locale);
  const locale = resolveLocale(preference);

  return useMemo(
    () => ({
      locale,
      direction: directionFor(locale),
      t: (key: MessageKey, values?: MessageValues) => translate(locale, key, values),
      number: (value: number) => formatNumber(locale, value),
      time: (value: Date) => formatTime(locale, value),
    }),
    [locale],
  );
}
