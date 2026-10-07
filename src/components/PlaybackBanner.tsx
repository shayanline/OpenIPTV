import { useLocale } from "../hooks/useLocale";
import type { Channel } from "../types";
import { Text } from "./Text";
import { Logo } from "./Logo";
import { KeyGuide } from "./KeyGuide";

/**
 * Which channel this is, and underneath it, what the keys do.
 *
 * Two boxes stacked, not one. They are two different kinds of thing: the top one is about the
 * programme and changes with every channel, the bottom one is about the remote and hardly
 * changes at all. Drawn as a single card with a rule across it they read as one statement, and
 * the eye has to work out which half it is looking at.
 *
 * This is a report only surface for Live channel changes. It carries no buttons and no
 * timeline: the playing state is reported in the middle of the picture by PictureState, and
 * every action lives in the deck, which is one press of Right away.
 */

const BANNER_LOGO = { width: 132, height: 68 };

export const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
};

interface PlaybackBannerProps {
  channel: Channel;
  programme?: { current?: string; next?: string };
}

export function PlaybackBanner({ channel, programme }: PlaybackBannerProps) {
  const { t, direction } = useLocale();
  const inlineEndArrow = direction === "rtl" ? "←" : "→";
  const displayName = channel.name || t("channel.unnamed");
  return (
    <div className="pb-stack">
      <div className="pb">
        {/* The number first and largest, because it is the one piece of a channel's identity a
            viewer can type, and on a row with no artwork it is all there is. */}
        <span className="pb-number">{String(channel.number)}</span>
        <Logo
          src={channel.logo}
          alt={displayName}
          className="pb-logo"
          width={BANNER_LOGO.width}
          height={BANNER_LOGO.height}
          intrinsic
        />
        <div className="pb-id">
          <Text value={displayName} className="pb-title" />
          <span className="pb-meta">
            {channel.quality && <span className="pb-quality">{channel.quality}</span>}
            <Text value={channel.group} className="pb-group" />
          </span>
          {(programme?.current || programme?.next) && (
            <span className="pb-programmes">
              {programme.current && (
                <Text
                  value={t("banner.now", { title: programme.current })}
                  className="pb-programme"
                />
              )}
              {programme.next && (
                <Text
                  value={t("banner.next", { title: programme.next })}
                  className="pb-programme"
                />
              )}
            </span>
          )}
        </div>
      </div>

      {/* One guide for the one state this surface reports: channel up and down, the browser
          on OK, the deck on Right, and Return to put it away. The green key is no longer
          taught here because the four slots are spent on what the keys now do. */}
      <KeyGuide
        className="pb-hints"
        items={[
          { keys: ["↑", "↓"], label: t("guide.changeChannel") },
          { keys: ["OK"], label: t("common.allChannels") },
          { keys: [inlineEndArrow], label: t("deck.controls") },
          { keys: ["Return"], label: t("guide.hideThis") },
        ]}
      />
    </div>
  );
}
