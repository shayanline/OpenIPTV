import { useLocale } from "../../hooks/useLocale";
import { Icon } from "../Icon";

export function VodCredits({ cast, director }: { cast: readonly string[]; director?: string }) {
  const { t } = useLocale();
  if (!director && !cast.length) return null;
  return (
    <dl className="vod-credits">
      {!!director && (
        <div className="vod-credit-row">
          <dt className="vod-credit-label">
            <Icon name="movie" />
            {t("vod.directedBy")}
          </dt>
          <dd className="vod-credit-names">{director}</dd>
        </div>
      )}
      {!!cast.length && (
        <div className="vod-credit-row">
          <dt className="vod-credit-label">
            <Icon name="cast" />
            {t("vod.starring")}
          </dt>
          <dd className="vod-credit-names">{cast.join(", ")}</dd>
        </div>
      )}
    </dl>
  );
}
