import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { usePlaybackPresence } from "../hooks/usePlaybackPresence";
import { cssMs } from "../services/metrics";
import type { RecoveryCause } from "../services/playbackRecovery";
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
  const [sample, setStats] = useState<PlaybackStats | null>(null);
  const stats: Partial<PlaybackStats> = sample ?? {};
  const { present, closing, onAnimationEnd } = usePlaybackPresence(visible);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!visible) return;
    const element = box.current;
    let interval: number | undefined;
    let firstFrame = 0;
    let secondFrame = 0;
    let started = false;
    // Native diagnostics can block Samsung's main thread, so let the entrance finish first.
    const start = () => {
      if (started) return;
      started = true;
      window.clearTimeout(timer);
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          setStats(read());
          interval = window.setInterval(() => setStats(read()), 1000);
        });
      });
    };
    const entered = (event: AnimationEvent) => {
      if (event.target === element && event.animationName === "pb-in") start();
    };
    const duration = cssMs("--t-med");
    const timer = window.setTimeout(start, duration + 100);
    element?.addEventListener("animationend", entered);
    if (!duration) start();
    return () => {
      element?.removeEventListener("animationend", entered);
      window.clearTimeout(timer);
      window.clearInterval(interval);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [read, visible]);

  const missing = t("diagnostics.notReported");
  const rows = [
    [t("playbackInfo.engine"), stats.engine ?? missing],
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
      stats.frameRate === undefined ? missing : `${Number(stats.frameRate.toFixed(1))} fps`,
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
    [
      t("playbackInfo.switches"),
      stats.switches === undefined ? missing : String(stats.switches),
    ],
  ];

  return (
    <aside
      ref={box}
      className={`playback-info ${present ? "visible" : ""}${closing ? " playback-closing" : ""}`.trim()}
      aria-label={t("playbackInfo.title")}
      aria-hidden={!visible || undefined}
      onAnimationEnd={onAnimationEnd}
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
