import { useLocale } from "../../hooks/useLocale";
import { Text } from "../Text";

export function VodTitleRow({ title }: { title: string }) {
  const { t } = useLocale();
  return (
    <div className="vod-title-row">
      <Text value={title || t("vod.untitled")} className="vod-detail-title" />
    </div>
  );
}
