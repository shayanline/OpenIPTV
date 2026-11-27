import { useLocale } from "../../hooks/useLocale";
import { Icon } from "../Icon";

export function VodCredits({ cast, director }: { cast: readonly string[]; director?: string }) {
  const { t } = useLocale();
  if (!director && !cast.length) return null;
  return (
    <>
      {!!director && (
        <p className="vod-credit-row">
          <Icon name="movie" />
          <span className="vod-credit-label">{t("vod.directedBy")}</span>
          <span className="vod-credit-names">
            {director}
          </span>
        </p>
      )}
      {!!cast.length && (
        <p className="vod-credit-row">
          <Icon name="cast" />
          <span className="vod-credit-label">{t("vod.starring")}</span>
          <span className="vod-credit-names">
            {cast.join(", ")}
          </span>
        </p>
      )}
    </>
  );
}
