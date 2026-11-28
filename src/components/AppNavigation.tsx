import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { pointerInputActive, pointerOnly } from "../hooks/usePointerAwake";
import { cssMs } from "../services/metrics";
import type { AppMode } from "../services/surfaceStack";
import { Icon, type IconName } from "./Icon";
import { PlaylistAvatar } from "./PlaylistAvatar";

export type AppNavigationAction = "playlists" | "search" | AppMode | "settings";

export interface AppNavigationItem {
  id: AppNavigationAction;
  label: string;
  icon: IconName;
  playlist?: { name: string; number: number };
}

const CONTENT_ITEMS = [
  { id: "live", label: "content.live", icon: "live" },
  { id: "movie", label: "content.movies", icon: "movie" },
  { id: "series", label: "content.series", icon: "series" },
] as const;

export function appNavigationItems(
  modes: readonly AppMode[],
  t: (
    key:
      | "common.search"
      | "content.live"
      | "content.movies"
      | "content.series"
      | "settings.playlists"
      | "common.settings",
  ) => string,
  playlist?: { name: string; number: number },
): AppNavigationItem[] {
  return [
    ...(playlist
      ? [
          {
            id: "playlists" as const,
            label: t("settings.playlists"),
            icon: "more" as const,
            playlist,
          },
        ]
      : []),
    ...CONTENT_ITEMS.filter((item) => modes.some((mode) => mode === item.id)).map((item) => ({
      id: item.id,
      label: t(item.label),
      icon: item.icon,
    })),
    { id: "settings", label: t("common.settings"), icon: "settings" },
  ];
}

export interface AppNavigationProps {
  activeMode: AppMode;
  items: AppNavigationItem[];
  focused: boolean;
  /** Visual width only: the rail can stay focused for keys while it is collapsed. */
  expanded?: boolean;
  visible?: boolean;
  focusedAction?: AppNavigationAction;
  activeAction?: AppNavigationAction | "none";
  onActivate: (item: AppNavigationItem) => void;
  onHover?: (item: AppNavigationItem) => void;
  onFocusChange: (focused: boolean) => void;
}

export function AppNavigation({
  activeMode,
  items,
  focused,
  expanded = focused,
  visible = true,
  focusedAction,
  activeAction,
  onActivate,
  onHover,
  onFocusChange,
}: AppNavigationProps) {
  const navigation = useRef<HTMLElement>(null);
  const playlist = items.find((item) => item.id === "playlists");

  useLayoutEffect(() => {
    const element = navigation.current;
    if (!element) return;
    if (focused) {
      const target =
        items.find((item) => item.id === (focusedAction ?? activeMode)) ??
        items.find((item) => item.id === activeMode) ??
        items[1] ??
        items[0];
      element.querySelector<HTMLElement>(`[data-navigation-action="${target.id}"]`)?.focus();
    } else if (element.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
  }, [activeMode, focused, focusedAction, items]);

  return (
    <nav
      ref={navigation}
      className={`app-navigation ${visible ? "visible" : ""} ${expanded ? "expanded" : ""} ${focused ? "focused" : ""}`.trim()}
      aria-label="Application navigation"
      aria-hidden={!visible}
      onFocus={(event) => {
        if (!visible || pointerInputActive()) return;
        const action =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-navigation-action]")?.dataset
                .navigationAction
            : undefined;
        const item = items.find((candidate) => candidate.id === action);
        onFocusChange(true);
        if (item) onHover?.(item);
      }}
      onPointerEnter={() => {
        if (pointerInputActive()) onFocusChange(true);
      }}
      onPointerLeave={() => {
        if (pointerInputActive()) onFocusChange(false);
      }}
      onBlur={(event) => {
        if (pointerInputActive()) return;
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return;
        }
        onFocusChange(false);
      }}
    >
      <div className="app-navigation-brand" data-app-mark>
        <span className="app-navigation-icon">
          <img src="./icon.svg" alt="" aria-hidden="true" />
        </span>
        <strong className="app-navigation-brand-label">OpenIPTV</strong>
      </div>
      <div className="app-navigation-mark-gap" aria-hidden="true" />
      <div className="app-navigation-actions">
        {playlist && (
          <Action
            item={playlist}
            activeMode={activeMode}
            activeAction={activeAction}
            focusedAction={focusedAction}
            onActivate={onActivate}
            onHover={onHover}
          />
        )}
        {playlist && <div className="app-navigation-divider" aria-hidden="true" />}
        <ActionGroup
          items={items.filter((item) =>
            CONTENT_ITEMS.some((content) => content.id === item.id),
          )}
          activeMode={activeMode}
          activeAction={activeAction}
          focusedAction={focusedAction}
          onActivate={onActivate}
          onHover={onHover}
        />
      </div>
      <div className="app-navigation-spacer app-navigation-footer-spacer" aria-hidden="true" />
      <Action
        item={items[items.length - 1]}
        activeMode={activeMode}
        activeAction={activeAction}
        focusedAction={focusedAction}
        onActivate={onActivate}
        onHover={onHover}
      />
    </nav>
  );
}

function ActionGroup({
  items,
  activeMode,
  activeAction,
  focusedAction,
  onActivate,
  onHover,
}: {
  items: AppNavigationItem[];
  activeMode: AppMode;
  activeAction?: AppNavigationAction | "none";
  focusedAction?: AppNavigationAction;
  onActivate: (item: AppNavigationItem) => void;
  onHover?: (item: AppNavigationItem) => void;
}) {
  return (
    <>
      {CONTENT_ITEMS.map(({ id }) => (
        <PresenceAction
          key={id}
          item={items.find((item) => item.id === id)}
          activeMode={activeMode}
          activeAction={activeAction}
          focusedAction={focusedAction}
          onActivate={onActivate}
          onHover={onHover}
        />
      ))}
    </>
  );
}

type ActionProps = {
  item: AppNavigationItem;
  activeMode: AppMode;
  activeAction?: AppNavigationAction | "none";
  focusedAction?: AppNavigationAction;
  onActivate: (item: AppNavigationItem) => void;
  onHover?: (item: AppNavigationItem) => void;
  available?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
};

type PresenceMotion = {
  layout: Animation;
  visual: Animation;
  remaining: number;
  commit: () => void;
};

function cancelPresenceMotion(current: PresenceMotion | null) {
  if (!current) return;
  for (const animation of [current.layout, current.visual]) {
    animation.onfinish = null;
    animation.cancel();
  }
}

function clearPresenceStyles(node: HTMLElement) {
  for (const property of ["height", "flex-basis", "margin-bottom"]) {
    node.style.removeProperty(property);
  }
  const visual = node.querySelector<HTMLElement>(".app-navigation-action-visual");
  visual?.style.removeProperty("opacity");
  visual?.style.removeProperty("transform");
}

function PresenceAction({
  item,
  ...props
}: Omit<ActionProps, "item" | "available" | "buttonRef"> & {
  item: AppNavigationItem | undefined;
}) {
  const [retainedItem, setRetainedItem] = useState(item);
  const button = useRef<HTMLButtonElement>(null);
  const motion = useRef<PresenceMotion | null>(null);
  const previousTarget = useRef(Boolean(item));
  const latestTarget = useRef(Boolean(item));

  if (item && item !== retainedItem) setRetainedItem(item);

  useLayoutEffect(() => {
    const available = Boolean(item);
    latestTarget.current = available;
    const node = button.current;
    if (!node) {
      cancelPresenceMotion(motion.current);
      motion.current = null;
      previousTarget.current = available;
      return;
    }
    if (previousTarget.current === available) return;
    previousTarget.current = available;
    const duration = cssMs("--t-navigation");
    const current = motion.current;
    if (!duration || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!available) {
        const visual = node.querySelector<HTMLElement>(".app-navigation-action-visual")!;
        visual.style.opacity = "0";
        visual.style.transform = "scale(0)";
      }
      cancelPresenceMotion(current);
      motion.current = null;
      if (!available) setRetainedItem(undefined);
      else clearPresenceStyles(node);
      return;
    }
    const visual = node.querySelector<HTMLElement>(".app-navigation-action-visual")!;

    const fresh = available && !current;
    const buttonStyles = getComputedStyle(node);
    const visualStyles = getComputedStyle(visual);
    const gap =
      Number.parseFloat(getComputedStyle(node.parentElement!).rowGap) ||
      Number.parseFloat(buttonStyles.marginTop) ||
      0;
    const height = node.querySelector<HTMLElement>(".app-navigation-icon")!.offsetHeight;
    const collapsedLayout = {
      height: "0px",
      flexBasis: "0px",
      marginBottom: `${-gap}px`,
    };
    const expandedLayout = {
      height: `${height}px`,
      flexBasis: `${height}px`,
      marginBottom: "0px",
    };
    const collapsedVisual = { opacity: 0, transform: "scale(0)" };
    const expandedVisual = { opacity: 1, transform: "scale(1)" };
    const layoutFrom = fresh
      ? collapsedLayout
      : {
          height: buttonStyles.height,
          flexBasis: buttonStyles.flexBasis,
          marginBottom: buttonStyles.marginBottom,
        };
    const visualFrom = fresh
      ? collapsedVisual
      : { opacity: visualStyles.opacity, transform: visualStyles.transform };
    const options: KeyframeAnimationOptions = {
      duration,
      easing: getComputedStyle(document.documentElement)
        .getPropertyValue("--ease-enter")
        .trim(),
      fill: "forwards",
    };
    cancelPresenceMotion(current);
    const group: PresenceMotion = {
      layout: node.animate([layoutFrom, available ? expandedLayout : collapsedLayout], options),
      visual: visual.animate(
        [visualFrom, available ? expandedVisual : collapsedVisual],
        options,
      ),
      remaining: 2,
      commit: () => {
        Object.assign(node.style, available ? expandedLayout : collapsedLayout);
        Object.assign(visual.style, available ? expandedVisual : collapsedVisual);
      },
    };
    const settle = () => {
      if (motion.current !== group) return;
      group.remaining -= 1;
      if (group.remaining > 0) return;
      const expanding = latestTarget.current;
      // Commit the endpoint before removing the animation's fill, including the exit frame before unmount.
      group.commit();
      cancelPresenceMotion(group);
      motion.current = null;
      if (!expanding) setRetainedItem(undefined);
      else clearPresenceStyles(node);
    };
    group.layout.onfinish = settle;
    group.visual.onfinish = settle;
    motion.current = group;
  }, [item, retainedItem]);

  useLayoutEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settleInstant = () => {
      if (!query.matches) return;
      const current = motion.current;
      motion.current = null;
      current?.commit();
      cancelPresenceMotion(current);
      if (!latestTarget.current) setRetainedItem(undefined);
      else if (button.current) clearPresenceStyles(button.current);
    };
    query.addListener(settleInstant);
    return () => query.removeListener(settleInstant);
  }, []);

  useLayoutEffect(
    () => () => {
      const current = motion.current;
      motion.current = null;
      if (current) {
        previousTarget.current = !latestTarget.current;
        cancelPresenceMotion(current);
      }
    },
    [],
  );

  const displayedItem = item ?? retainedItem;
  return displayedItem ? (
    <Action {...props} item={displayedItem} available={Boolean(item)} buttonRef={button} />
  ) : null;
}

function Action({
  item,
  activeMode,
  activeAction,
  focusedAction,
  onActivate,
  onHover,
  available = true,
  buttonRef,
}: ActionProps) {
  const accessibleName = item.playlist ? `${item.label}, ${item.playlist.name}` : item.label;
  const content = (
    <>
      <span className="app-navigation-icon">
        {item.playlist ? (
          <PlaylistAvatar name={item.playlist.name} number={item.playlist.number} />
        ) : (
          <Icon name={item.icon} />
        )}
      </span>
      <span className="app-navigation-label">{item.label}</span>
    </>
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`app-navigation-action ${available && item.id === (activeAction ?? activeMode) ? "active" : ""} ${available && item.id === focusedAction ? "cursor" : ""}`}
      data-navigation-action={available ? item.id : undefined}
      data-navigation-presence={buttonRef ? item.id : undefined}
      data-navigation-exiting={available ? undefined : item.id}
      aria-label={accessibleName}
      aria-current={available && item.id === (activeAction ?? activeMode) ? "page" : undefined}
      aria-hidden={available ? undefined : true}
      disabled={!available}
      tabIndex={available ? undefined : -1}
      onPointerEnter={available ? () => pointerOnly(() => onHover?.(item)) : undefined}
      onClick={available ? () => onActivate(item) : undefined}
    >
      <span className="app-navigation-action-visual">{content}</span>
    </button>
  );
}
