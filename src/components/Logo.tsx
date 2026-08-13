import { memo, useEffect, useRef, useState } from "react";
import { claimLogo, logoOf, releaseLogo, shrink } from "../services/logos";
import { Icon } from "./Icon";

/**
 * A channel logo, drawn at the size it occupies.
 *
 * A canvas rather than an <img>, because the bitmap behind it has already been resampled
 * down from whatever the broadcaster hosts. See services/logos for why that matters.
 *
 * What is drawn is read out of the cache during render rather than kept in state, and that
 * is the point rather than a detail. Rows are recycled as the list moves, so the element
 * showing a logo for one category is the same element that will show another's. Holding the
 * bitmap in state left the previous category's artwork on screen until the new one finished
 * decoding, because state only caught up after the frame had already been painted. Reading
 * through means what is on screen always belongs to the channel currently in that row, and
 * the initials stand in until there is something better.
 */
export const Logo = memo(function Logo({
  src, alt, label, width, height, className = "ch-logo", intrinsic = false, fetchable = true,
}: {
  src?: string;
  alt: string;
  /**
   * What to draw when there is no artwork.
   *
   * The first two characters of the name is what this used to do on its own, and it produced
   * "Ch" for Channel 4 and the same two letters for every channel a broadcaster names after
   * itself. A channel number is short, unique and already the thing the viewer dials.
   */
  label?: string;
  /** The box to fit inside, which is also the size the bitmap is reduced to. */
  width: number;
  height: number;
  className?: string;
  /**
   * Whether it is worth going and getting. False while a list is still moving, so artwork is
   * not fetched for rows the viewer is scrolling straight past. Anything already cached is
   * drawn regardless.
   */
  fetchable?: boolean;
  /**
   * Whether the element takes the size of the fitted logo rather than the whole box. A list
   * row wants a fixed box so the names beside it line up; the notice card wants the logo to
   * occupy only what it needs, so a tall one does not sit in a wide empty space.
   */
  intrinsic?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, redraw] = useState(0);
  const bitmap = src ? logoOf(src, width, height) : null;

  useEffect(() => {
    if (!src || !fetchable || logoOf(src, width, height)) return;

    // Registered as wanted for exactly as long as this row is on screen, so the queue can
    // drop the job if the viewer has moved on before its turn comes.
    let live = true;
    claimLogo(src, width, height);
    void shrink(src, width, height).then(() => { if (live) redraw((n) => n + 1); });
    return () => {
      live = false;
      releaseLogo(src, width, height);
    };
  }, [src, width, height, fetchable]);

  // Centred in the box at its own proportions, since the bitmap was already fitted to it.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !bitmap) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    try {
      ctx.drawImage(bitmap, (el.width - bitmap.width) / 2, (el.height - bitmap.height) / 2);
    } catch {
      // Evicted from the cache and closed between the render and the draw. The next render
      // finds nothing cached and shows the initials instead.
    }
  }, [bitmap]);

  if (!bitmap) {
    return (
      <span className={`${className} placeholder`} aria-label={alt} role="img">
        {/* A quiet television rather than an empty box or two letters of the name.
            The letters were meaningless, "Ch" for every channel a broadcaster names after
            itself, and an empty tile reads as artwork that failed rather than artwork that was
            never offered. */}
        {label ?? <Icon name="tv" />}
      </span>
    );
  }
  return (
    <canvas
      ref={canvas}
      className={className}
      width={intrinsic ? bitmap.width : width}
      height={intrinsic ? bitmap.height : height}
    />
  );
});
