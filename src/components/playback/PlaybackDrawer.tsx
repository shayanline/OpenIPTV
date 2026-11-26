import { useEffect } from "react";
import { KEY } from "../../hooks/useRemote";
import { Icon, type IconName } from "../Icon";
import type { PlaybackDeckFocus } from "./PlaybackDeck";

export type PlaybackDrawerOrigin = PlaybackDeckFocus | "live-browser";

export interface PlaybackDrawerProps {
  title: string;
  icon?: IconName;
  subtitle?: string;
  footer?: React.ReactNode;
  ariaLabel?: string;
  /** The deck action or browser that opened the drawer, restored verbatim on Back. */
  origin: PlaybackDrawerOrigin;
  /** The closing transition, which keeps Back ownership until it finishes. */
  closing?: boolean;
  onClosed?(): void;
  /** An extra class for drawers that keep their own styling, like the programme guide. */
  className?: string;
  children: React.ReactNode;
  onBack(origin: PlaybackDrawerOrigin): void;
}

/**
 * One context surface above the deck or the Live browser: a fixed header with the title
 * centred in it, then the options. Drawers never close on a timer, because reading a list of
 * tracks takes as long as it takes. The caller that opened it is not rendered underneath, so
 * Back is the only key this surface needs and it hands the origin back untouched.
 */
export function PlaybackDrawer({
  title,
  icon,
  subtitle,
  footer,
  ariaLabel,
  origin,
  closing = false,
  onClosed,
  className,
  children,
  onBack,
}: PlaybackDrawerProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.keyCode !== KEY.BACK && event.keyCode !== KEY.ESC && event.keyCode !== KEY.LEFT)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (closing) return;
      onBack(origin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closing, origin, onBack]);

  return (
    <aside
      className={`playback-drawer ${closing ? "closing " : ""}${className ?? ""}`.trim()}
      aria-label={ariaLabel ?? title}
      onAnimationEnd={(event) => {
        if (
          closing &&
          event.target === event.currentTarget &&
          event.animationName === "playback-drawer-out"
        )
          onClosed?.();
      }}
    >
      <div className="playback-drawer-head">
        {icon || subtitle ? (
          <>
            {icon && <Icon name={icon} />}
            <div className="playback-drawer-heading">
              <h2 className="playback-drawer-title">{title}</h2>
              {subtitle && <p className="playback-drawer-subtitle">{subtitle}</p>}
            </div>
          </>
        ) : (
          <h2 className="playback-drawer-title">{title}</h2>
        )}
      </div>
      <div className="playback-drawer-body">{children}</div>
      {footer && <div className="playback-drawer-footer">{footer}</div>}
    </aside>
  );
}
