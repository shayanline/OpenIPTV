import { useLocale } from "../hooks/useLocale";
import { usePlaybackPresence } from "../hooks/usePlaybackPresence";
import type { Channel } from "../types";
import { Icon } from "./Icon";
import { KeyGuide } from "./KeyGuide";
import { Logo } from "./Logo";
import { Text } from "./Text";

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
  visible?: boolean;
  programme?: { current?: string };
  /** Identity of the target this banner names, matched against the deck it expands into. */
  targetKey?: string;
}

export interface PlaybackIdentityProps {
  variant: "banner" | "deck";
  title: string;
  number?: number;
  logo?: string;
  group?: string;
  quality?: string;
  year?: string;
  rating?: string;
  currentProgramme?: string;
}

export function PlaybackIdentity({
  variant,
  title,
  number,
  logo,
  group,
  quality,
  year,
  rating,
  currentProgramme,
}: PlaybackIdentityProps) {
  const { t } = useLocale();
  const banner = variant === "banner";
  return (
    <div
      className={`playback-identity ${banner ? "pb" : "deck-identity"}`}
      data-playback-identity
    >
      {number !== undefined && (
        <span
          className={banner ? "pb-number" : "deck-channel-number"}
          data-playback-part="number"
          data-playback-value={String(number)}
        >
          {number}
        </span>
      )}
      {/* A fixed size slot carries the part identity so the image itself keeps its own
          classes and artwork cache behaviour. */}
      <span
        className={banner ? "pb-logo-slot" : "deck-logo-slot"}
        data-playback-part="logo"
        data-playback-value={logo ?? title}
      >
        <Logo
          src={logo}
          alt={title}
          className={banner ? "pb-logo" : "deck-artwork live"}
          width={BANNER_LOGO.width}
          height={BANNER_LOGO.height}
        />
      </span>
      <div className={banner ? "pb-id" : "deck-copy"}>
        <Text
          value={title}
          className={banner ? "pb-title" : "deck-title"}
          marquee
          active
          part="title"
          partValue={title}
        />
        {banner ? (
          <>
            {(quality || group) && (
              <span className="pb-meta">
                {quality && (
                  <span
                    className="pb-quality"
                    data-playback-part="quality"
                    data-playback-value={quality}
                  >
                    {quality}
                  </span>
                )}
                {group && (
                  <Text
                    value={group}
                    className="pb-group"
                    marquee
                    active
                    part="category"
                    partValue={group}
                  />
                )}
              </span>
            )}
            {currentProgramme && (
              <Text
                value={t("banner.now", { title: currentProgramme })}
                className="pb-meta pb-programme"
                marquee
                active
                part="now"
                partValue={currentProgramme}
              />
            )}
          </>
        ) : (
          <div className="deck-context">
            {(year || rating || quality) && (
              <span className="deck-tags">
                {quality && (
                  <span data-playback-part="quality" data-playback-value={quality}>
                    {quality}
                  </span>
                )}
                {year && <span>{year}</span>}
                {rating && (
                  <span className="deck-rating">
                    <Icon name="star" />
                    {rating}
                  </span>
                )}
              </span>
            )}
            {group && (
              <Text
                value={group}
                className="deck-group"
                marquee
                active
                part="category"
                partValue={group}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function PlaybackBanner({
  channel,
  programme,
  targetKey,
  visible = true,
}: PlaybackBannerProps) {
  const { t, direction } = useLocale();
  const { present, closing, onAnimationEnd } = usePlaybackPresence(visible);
  if (!present) return null;
  const inlineEndArrow = direction === "rtl" ? "←" : "→";
  const displayName = channel.name || t("channel.unnamed");
  return (
    <div
      className={`pb-stack${closing ? " playback-closing" : ""}`}
      data-playback-target={targetKey}
      aria-hidden={closing || undefined}
      onAnimationEnd={onAnimationEnd}
    >
      {/* The number first and largest, because it is the one piece of a channel's identity a
          viewer can type, and on a row with no artwork it is all there is. */}
      <PlaybackIdentity
        variant="banner"
        title={displayName}
        number={channel.number}
        logo={channel.logo}
        group={channel.group}
        quality={channel.quality}
        currentProgramme={programme?.current}
      />

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
