import { useEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import type { PlaybackStats } from "../services/player";
import { KeyGuide } from "./KeyGuide";

const rate = (value?: number): string => {
  if (value === undefined) return "";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))} Mbps`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))} kbps`;
  return `${value} bps`;
};

export function PlaybackInfo({ read }: { read: () => PlaybackStats | null }) {
  const { t } = useLocale();
  const [stats, setStats] = useState(read);

  useEffect(() => {
    setStats(read());
    const timer = window.setInterval(() => setStats(read()), 1000);
    return () => window.clearInterval(timer);
  }, [read]);

  if (!stats) return null;
  const missing = t("diagnostics.notReported");
  const rows = [
    [t("playbackInfo.engine"), stats.engine],
    [
      t("playbackInfo.resolution"),
      stats.width && stats.height ? `${stats.width} × ${stats.height}` : missing,
    ],
    [t("playbackInfo.scan"), stats.scan ? t(`playbackInfo.${stats.scan}`) : missing],
    [t("playbackInfo.videoCodec"), stats.videoCodec ?? missing],
    [t("playbackInfo.audioCodec"), stats.audioCodec ?? missing],
    [t("playbackInfo.bitrate"), rate(stats.bitrate) || missing],
    [t("playbackInfo.bandwidth"), rate(stats.bandwidth) || missing],
    [
      t("playbackInfo.buffer"),
      stats.bufferSeconds === undefined
        ? missing
        : `${Number(stats.bufferSeconds.toFixed(1))} s`,
    ],
    [
      t("playbackInfo.frameRate"),
      stats.frameRate === undefined ? missing : `${Number(stats.frameRate.toFixed(1))} fps`,
    ],
    [
      t("playbackInfo.droppedFrames"),
      stats.droppedFrames === undefined || stats.totalFrames === undefined
        ? missing
        : `${stats.droppedFrames} / ${stats.totalFrames}`,
    ],
    [
      t("playbackInfo.level"),
      stats.level === undefined || stats.levels === undefined
        ? stats.levels === undefined
          ? missing
          : t("playbackInfo.autoLevels", { count: stats.levels })
        : `${stats.level} / ${stats.levels}`,
    ],
    [t("playbackInfo.switches"), String(stats.switches)],
  ];

  return (
    <aside className="playback-info" aria-label={t("playbackInfo.title")}>
      <h2>{t("playbackInfo.title")}</h2>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <KeyGuide
        className="playback-info-guide"
        items={[{ keys: ["OK"], label: t("playbackInfo.hideHint") }]}
      />
    </aside>
  );
}
