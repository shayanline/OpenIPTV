import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { KeyGuide } from "./KeyGuide";
import { explain } from "../services/errors";

/**
 * What is happening to the picture, in the middle of the picture.
 *
 * One rule divides this from the banner along the bottom, and it is worth stating because the
 * two used to overlap: this reports on the picture, the banner reports on the channel.
 * Connecting, waiting, paused and failed are all things happening to the picture, so they are
 * said here, once, where the picture is missing.
 *
 * One surface for all four, and that is the point rather than a tidy-up.
 *
 * One surface whose words change, not several that take turns. A channel that fails
 * is retried automatically, so the two swapped places every few seconds: a card would unmount, a
 * different card would mount somewhere else on the screen, and the whole thing flashed on every
 * cycle. A fault that cleared within a frame or two flashed a card nobody could read. Since they
 * are the same statement at different moments, they are now the same box, and only the words
 * inside it change.
 *
 * Words, not only a spinner. A slow connection and a channel that is off the air look exactly
 * alike for the first half minute, and the viewer is the one deciding whether to keep waiting.
 */

/** How long a channel may take before the wait is worth remarking on. */
const SLOW_AFTER_S = 8;

/**
 * How long a fault must last before it is worth telling anybody about.
 *
 * Recoverable faults come and go in milliseconds: a segment that fails and is refetched, a
 * decoder that resets itself. Announcing those is worse than useless, because a message that
 * appears and vanishes before it can be read is only a flash of light. Anything still wrong
 * half a second later is real.
 */
const FAULT_SETTLE_MS = 500;

export function PictureState({
  channel, busy, paused, filling, waited, fault, retryIn, attempt, attempts,
}: {
  /** The channel this is about, named only when something has gone wrong with it. */
  channel: string;
  busy: boolean;
  paused: boolean;
  /** How full the buffer is, where the engine says, and null where it does not. */
  filling: number | null;
  /** Seconds spent waiting for this channel to start. */
  waited: number;
  /** The engine's name for the fault, or empty when there is none. */
  fault: string;
  /** Seconds until the next automatic attempt. */
  retryIn: number;
  attempt: number;
  attempts: number;
}) {
  /*
   * A fault is shown once it has lasted, and dropped the moment it clears.
   *
   * Slow to appear and quick to go, which is the right way round: nobody minds a card arriving
   * half a second late, and everybody minds one that is still apologising after the picture has
   * come back.
   */
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (!fault) { setSettled(""); return; }
    const t = window.setTimeout(() => setSettled(fault), FAULT_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [fault]);

  if (settled) {
    const { why, fix } = explain(settled);
    const trying = attempt < attempts;
    return (
      <div className="plate picture-state failed" role="alert">
        <span className="picture-state-mark warn"><Icon name="warn" /></span>
        <Text value={channel} className="picture-state-channel" />
        <p className="picture-state-word">{why}</p>
        <p className="picture-state-note">{fix}</p>

        {/* What the app is doing about it, in the present tense. Without this the card is a
            verdict, and a verdict invites turning the television off. */}
        <p className="picture-state-doing">
          {trying
            ? <><span className="spinner small" aria-hidden="true" />
                Trying again{retryIn > 0 ? ` in ${retryIn} second${retryIn === 1 ? "" : "s"}` : "\u2026"}
                {attempt > 0 && ` (${attempt + 1} of ${attempts})`}</>
            : "Tried three times without success. Try another channel and come back later."}
        </p>

        {/* The banner is hidden while this is up, so this is the only guide on screen and it
            has to be complete, including the way out. */}
        <KeyGuide
          className="picture-state-keys ruled"
          items={[
            { keys: ["\u2191", "\u2193"], label: "Another channel" },
            { keys: ["OK"], label: "All channels" },
            { keys: ["Return"], label: "Close the app" },
          ]}
        />
        {/* The engine's own name for the fault, last and quiet. Useful when reporting a
            problem, and never the explanation itself. */}
        <p className="picture-state-code">{settled}</p>
      </div>
    );
  }

  if (paused) {
    return (
      <div className="plate picture-state" role="status">
        <span className="picture-state-mark"><Icon name="pause" /></span>
        <p className="picture-state-word">Paused</p>
        <p className="picture-state-note">Press Play to carry on</p>
      </div>
    );
  }

  if (busy) {
    return (
      <div className="plate picture-state" role="status">
        <span className="spinner" aria-hidden="true" />
        {/*
          * The television reports how full its buffer is, so say so rather than turning a
          * ring at somebody. It is the difference between a channel that is arriving slowly
          * and one that is not arriving, which is the question a viewer is actually asking,
          * and it is the one thing on this screen that a spinner cannot answer.
          *
          * Only the set sends it. In a browser this is null and the word is what it was.
          */}
        <p className="picture-state-word">
          {filling === null ? "Connecting" : `Connecting ${filling}%`}
        </p>
        {waited >= SLOW_AFTER_S && (
          <p className="picture-state-note">This channel is being slow. Still trying&hellip;</p>
        )}
      </div>
    );
  }

  return null;
}
