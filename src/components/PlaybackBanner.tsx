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
 * Samsung's media player guidance describes a banner carrying the title, the playing status and
 * the controls together, appearing on input and withdrawing when the viewer stops interacting.
 * This is that with two things taken out of it:
 *
 * The progress bar went because it was the least honest thing on the screen. It was drawn from a
 * live window measured off the stream, and half of these servers report a window they do not
 * have, so a channel that had just started announced "8 minutes behind" over a picture that was
 * live. It also cost two of the four directions and a second focus level.
 *
 * The playing status went to the middle of the picture, where the picture it describes is. See
 * PictureState: this reports on the channel, that reports on the picture, and between them
 * nothing is said twice.
 *
 * There are no buttons at all. There were two, then one, and the last of them was a Reload that
 * asked the viewer to notice a frozen picture and do something about it. The player notices that
 * on its own now and fetches the channel again, so the button had nothing left to do that was
 * worth a permanent place on the screen.
 */

const BANNER_LOGO = { width: 132, height: 68 };

export function PlaybackBanner({ channel, position }: {
  channel: Channel;
  /** Where this channel sits in the list channel up and down walks. */
  position?: { at: number; of: number; list: string };
}) {
  return (
    <div className="pb-stack">
      <div className="pb">
        {/* The number first and largest, because it is the one piece of a channel's identity a
            viewer can type, and on a row with no artwork it is all there is. */}
        <span className="pb-number">{channel.number}</span>
        <Logo src={channel.logo} alt={channel.name} className="pb-logo"
              width={BANNER_LOGO.width} height={BANNER_LOGO.height} intrinsic />
        <div className="pb-id">
          <Text value={channel.name} className="pb-title" />
          <span className="pb-meta">
            {channel.quality && <span className="pb-quality">{channel.quality}</span>}
            {/* The list channel up and down walks, and where in it this channel is, so the
                scope of the next press is stated rather than discovered. */}
            {position
              ? <Text value={`${position.at} of ${position.of} in ${position.list}`}
                      className="pb-group" />
              : <Text value={channel.group} className="pb-group" />}
          </span>
        </div>
      </div>

      {/* One guide, because there is now only one state to be in.
          The green key is taught here rather than in the panel, which has four items already
          and wraps at five. This has the width of the screen, the key does the same thing in
          both places, and the banner is the one guide every viewer sees, since it comes up on
          every channel change. */}
      <KeyGuide
        className="pb-hints"
        items={[
          { keys: ["\u2191", "\u2193"], label: "Change channel" },
          { keys: ["OK"], label: "All channels" },
          { keys: ["Green"], label: "Favourite" },
          /* Two keys, one label, because two keys do it. Right is the shorter reach of the pair
             and RETURN is the one every other screen uses, so both are taught rather than
             leaving whichever the viewer tries first to be the one that appears not to work. */
          { keys: ["Return", "\u2192"], label: "Hide this" },
        ]}
      />
    </div>
  );
}
