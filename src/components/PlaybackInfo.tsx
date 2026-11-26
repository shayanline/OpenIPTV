import { useEffect, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { RETRY_DELAYS_MS, type RecoveryCause } from "../services/playbackRecovery";
import type { PlaybackStats } from "../services/player";
import { KeyGuide } from "./KeyGuide";

const rate = (value?: number): string => {
  if (value === undefined) return "";
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))} Mbps`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))} kbps`;
  return `${value} bps`;
};

export function PlaybackInfo({
  read,
  recovery,
  visible = true,
  seekable,
}: {
  read: () => PlaybackStats | null;
  /** What the coordinator is doing about a fault, when there is one. */
  recovery?: { cause: RecoveryCause | null; attempt: number; continuous?: boolean };
  visible?: boolean;
  seekable?: boolean;
}) {
  const { t } = useLocale();
  const [stats, setStats] = useState(() => (visible ? read() : null));

  useEffect(() => {
    if (!visible) return;
    setStats(read());
    const timer = window.setInterval(() => setStats(read()), 1000);
    return () => window.clearInterval(timer);
  }, [read, visible]);

  const missing = t("diagnostics.notReported");
  const rows = [
    ...(stats
      ? [
          [t("playbackInfo.engine"), stats.engine],
          [
            t("playbackInfo.resolution"),
            stats.width && stats.height ? `${stats.width} × ${stats.height}` : missing,
          ],
          [
            t("playbackInfo.dynamicRange"),
            stats.dynamicRange === "PQ" ? "PQ (HDR)" : (stats.dynamicRange ?? missing),
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
            stats.frameRate === undefined
              ? missing
              : `${Number(stats.frameRate.toFixed(1))} fps`,
          ],
          [
            t("playbackInfo.droppedFrames"),
            stats.droppedFrames === undefined || stats.totalFrames === undefined
              ? missing
              : t("playbackInfo.frameCounts", {
                  dropped: stats.droppedFrames,
                  total: stats.totalFrames,
                }),
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
        ]
      : []),
    ...(recovery?.cause
      ? [[t("playbackInfo.recovery"), t(`recovery.cause.${recovery.cause}`)]]
      : []),
    ...(recovery && recovery.attempt > 0
      ? [
          [
            t("playbackInfo.attemptLabel"),
            /* A continuous reconnect has no bound, so the attempt is reported without one. */
            recovery.continuous
              ? String(recovery.attempt)
              : t("playbackInfo.attempt", {
                  attempt: recovery.attempt,
                  total: RETRY_DELAYS_MS.length,
                }),
          ],
        ]
      : []),
  ];

  return (
    <aside
      className={`playback-info ${visible ? "visible" : ""}`.trim()}
      aria-label={t("playbackInfo.title")}
      data-recovery-cause={recovery?.cause ?? ""}
      data-seekable={seekable}
    >
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
        items={[
          {
            keys: ["OK"],
            beforeKeys: t("playbackInfo.hold"),
            label: t("playbackInfo.hideHint"),
          },
        ]}
      />
    </aside>
  );
}
