import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { pointerOnly } from "../../hooks/usePointerAwake";
import { useLocale } from "../../hooks/useLocale";
import { KEY } from "../../hooks/useRemote";
import {
  usePlaybackExpansion,
  type PlaybackExpansionOrigin,
} from "../../hooks/usePlaybackExpansion";
import { PLAYBACK_CHROME_TIMEOUT_MS } from "../../services/playbackChrome";
import { clampSeekTarget, type SeekHold, seekStepFromKey } from "../../services/playbackRange";
import type { MessageKey } from "../../services/locale";
import type { PlaybackSnapshot, PlaybackTarget } from "../../types";
import { Artwork } from "../Artwork";
import { Icon, type IconName } from "../Icon";
import { KeyGuide } from "../KeyGuide";
import { PlaybackIdentity } from "../PlaybackBanner";
import { Text } from "../Text";
import { SeekBar } from "./SeekBar";
import { SubtitleLayer } from "./SubtitleLayer";

export type PlaybackDeckFocus =
  | "seek"
  | "go-live"
  | "guide"
  | "details"
  | "previous"
  | "play-pause"
  | "next"
  | "audio"
  | "subtitles";

export type PlaybackDeckAction = Exclude<PlaybackDeckFocus, "seek">;

export interface PlaybackDeckMetadata {
  kind: PlaybackTarget["kind"];
  title: string;
  number?: number;
  group?: string;
  logo?: string;
  year?: string;
  rating?: string;
  quality?: string;
  currentProgramme?: string;
  /** Programme boundaries as epoch seconds, the same unit GuideProgramme uses. */
  currentStart?: number;
  currentEnd?: number;
  nextProgramme?: string;
}

export interface PlaybackDeckProps {
  snapshot: PlaybackSnapshot;
  metadata: PlaybackDeckMetadata;
  focus: PlaybackDeckFocus;
  canPause: boolean;
  /** Live only: whether loaded programme data enables Guide. */
  hasGuide: boolean;
  hasAudio: boolean;
  hasSubtitles: boolean;
  /** The active cue follows the panel's real top edge rather than a fixed height offset. */
  subtitleCue?: string;
  previousEnabled: boolean;
  nextEnabled: boolean;

  onFocus(focus: PlaybackDeckFocus): void;
  onSeek(targetSeconds: number, waitForRelease?: boolean): void;
  onAction(action: PlaybackDeckAction): void;
  onClose(): void;
  onInteraction(): void;
  /** False while a content transition covers the deck: keys and the settle timer stand down. */
  inputEnabled?: boolean;
  entrance?: "banner" | "ordinary";
  /** Geometry captured from the banner this deck replaces, when the entrance is "banner". */
  expansionOrigin?: PlaybackExpansionOrigin | null;
  /** Identity of the target this deck controls, matched against a captured banner. */
  targetKey?: string;
}

/**
 * After the latest interaction the deck withdraws, whatever playback is doing. It shares the
 * playback chrome timeout with the channel banner, including while paused: a pause is a
 * state the viewer chose, not a reason to leave controls up for ever.
 */
const DECK_CLOSE_MS = PLAYBACK_CHROME_TIMEOUT_MS;

const CONTROLS: Record<PlaybackDeckAction, { icon: IconName; key: MessageKey }> = {
  "go-live": { icon: "live", key: "deck.goLive" },
  guide: { icon: "guide", key: "common.guide" },
  details: { icon: "about", key: "library.details" },
  previous: { icon: "previous", key: "common.previous" },
  "play-pause": { icon: "play", key: "common.playPause" },
  next: { icon: "next", key: "common.next" },
  audio: { icon: "audio", key: "deck.audio" },
  subtitles: { icon: "subtitles", key: "deck.subtitles" },
};

/**
 * The complete playback surface: metadata, a hairline, the seek bar when the content is
 * seekable, and one row of controls. Finite playback leads with Details and the adjacent
 * episode actions, while Audio and Subtitles trail on both. Live ends with the programme
 * card and Guide.
 *
 * Focus is owned by the caller and handed down, because only the screen knows which drawer
 * returned where. Everything else the deck handles itself: the withdrawal any interaction
 * restarts, arrows and OK, pointer focus and seek, and the settle timer that turns seek
 * arrow presses into one engine seek.
 */
export function PlaybackDeck({
  snapshot,
  metadata,
  focus,
  canPause,
  hasGuide,
  hasAudio,
  hasSubtitles,
  subtitleCue = "",
  previousEnabled,
  nextEnabled,
  onFocus,
  onSeek,
  onAction,
  onClose,
  onInteraction,
  inputEnabled = true,
  entrance = "ordinary",
  expansionOrigin = null,
  targetKey = "",
}: PlaybackDeckProps) {
  const { t, direction, locale, time } = useLocale();
  const live = metadata.kind === "live";
  const range = snapshot.seekRange;
  const seekable =
    !!range &&
    snapshot.position !== null &&
    (snapshot.phase === "playing" || snapshot.phase === "paused");
  // Buffering can withdraw the range while the viewer still owns the timeline.
  const seekOwner = snapshot.target?.id ?? targetKey;
  const rememberedRange = useRef({ owner: seekOwner, range });
  if (rememberedRange.current.owner !== seekOwner) {
    rememberedRange.current = { owner: seekOwner, range };
  } else if (range) {
    rememberedRange.current.range = range;
  }
  const displayRange = range ?? (focus === "seek" ? rememberedRange.current.range : null);
  const rtl = direction === "rtl";

  const [target, setTarget] = useState<number>(snapshot.position ?? range?.startSeconds ?? 0);
  const position = snapshot.position ?? target;

  const closeTimer = useRef(0);
  const targetTouched = useRef(false);
  const targetRef = useRef(target);
  const seekRepeat = useRef<SeekHold>({
    direction: 0,
    startedAt: 0,
    steppedAt: 0,
  });
  targetRef.current = target;
  /*
   * The callbacks are read through refs so a re-rendered parent cannot restart the close
   * timer: the position updates once a second, and a timer that followed render identity
   * would never fire while anything was playing.
   */
  const onCloseRef = useRef(onClose);
  const onInteractionRef = useRef(onInteraction);
  const inputEnabledRef = useRef(inputEnabled);
  onCloseRef.current = onClose;
  onInteractionRef.current = onInteraction;
  inputEnabledRef.current = inputEnabled;
  useEffect(() => {
    if (focus !== "seek") targetTouched.current = false;
    if (targetTouched.current || snapshot.position === null) return;
    setTarget(range ? clampSeekTarget(snapshot.position, range) : snapshot.position);
  }, [focus, range, snapshot.position]);

  const interact = useCallback(() => {
    if (!inputEnabledRef.current) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), DECK_CLOSE_MS);
    onInteractionRef.current();
  }, []);
  useEffect(() => {
    if (!inputEnabled) return;
    interact();
    return () => {
      window.clearTimeout(closeTimer.current);
    };
  }, [interact, inputEnabled, targetKey]);
  useEffect(() => {
    const resetSeekRepeat = (event: KeyboardEvent) => {
      if (event.keyCode === KEY.LEFT || event.keyCode === KEY.RIGHT) {
        seekRepeat.current = { direction: 0, startedAt: 0, steppedAt: 0 };
      }
    };
    window.addEventListener("keyup", resetSeekRepeat, true);
    return () => window.removeEventListener("keyup", resetSeekRepeat, true);
  }, []);

  const showGoLive = live && !!range && !range.liveEdge;
  const connecting =
    snapshot.phase === "connecting" ||
    snapshot.phase === "rebuffering" ||
    snapshot.phase === "recovering";
  const liveBadge = snapshot.phase === "playing" && live && !showGoLive;
  const canTogglePlayback = canPause && snapshot.phase !== "failed";

  /* Leading context action, centred transport and trailing track and Guide actions, in focus order.
     Guide keeps its place while programme data loads, but cannot be focused or activated. */
  const [lead, mid, tail, controls] = useMemo((): [
    PlaybackDeckAction[],
    PlaybackDeckAction[],
    PlaybackDeckAction[],
    PlaybackDeckAction[],
  ] => {
    const head: PlaybackDeckAction[] = live ? (showGoLive ? ["go-live"] : []) : ["details"];
    const centre: PlaybackDeckAction[] = ["previous", "play-pause", "next"];
    const end: PlaybackDeckAction[] = [
      "audio",
      "subtitles",
      ...(live ? (["guide"] as const) : []),
    ];
    return [head, centre, end, [...head, ...centre, ...end]];
  }, [live, showGoLive]);

  const disabled = useCallback(
    (control: PlaybackDeckAction) =>
      (control === "guide" && !hasGuide) ||
      (control === "audio" && !hasAudio) ||
      (control === "subtitles" && !hasSubtitles) ||
      (control === "previous" && !previousEnabled) ||
      (control === "next" && !nextEnabled) ||
      (control === "play-pause" && !canTogglePlayback),
    [hasGuide, hasAudio, hasSubtitles, canTogglePlayback, previousEnabled, nextEnabled],
  );

  const navigableControls = useMemo(
    () => controls.filter((control) => !disabled(control)),
    [controls, disabled],
  );

  useLayoutEffect(() => {
    if (focus === "seek" || navigableControls.includes(focus)) return;
    const available = navigableControls.includes("play-pause")
      ? "play-pause"
      : navigableControls[0];
    if (available) onFocus(available);
  }, [focus, navigableControls, onFocus]);

  const showGoLiveRef = useRef(showGoLive);
  showGoLiveRef.current = showGoLive;

  const moveTarget = useCallback(
    (step: number) => {
      if (!seekable || !range) return;
      const before = targetRef.current;
      const next = clampSeekTarget(before + step, range);
      const forward = step > 0;
      /* Delayed Live offers Go live one step past the safe edge, and nothing beyond it. */
      if (live && forward && next === before && showGoLiveRef.current) {
        onFocus("go-live");
        return;
      }
      /* An edge is an edge: a press that moves nowhere asks nothing of the engine. */
      if (next === before) return;
      targetTouched.current = true;
      targetRef.current = next;
      setTarget(next);
      onSeek(next, true);
    },
    [range, seekable, live, onFocus, onSeek],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!inputEnabled) return;
      /*
       * Every keypress counts as interaction, including the transport keys the shared
       * handler has already claimed, so this runs before the defaultPrevented check.
       */
      interact();
      if (event.defaultPrevented) return;
      const code = event.keyCode;
      if (
        code === KEY.UP ||
        code === KEY.DOWN ||
        code === KEY.LEFT ||
        code === KEY.RIGHT ||
        code === KEY.ENTER ||
        code === KEY.BACK ||
        code === KEY.ESC
      )
        event.preventDefault();
      if (code === KEY.BACK || code === KEY.ESC) {
        onClose();
        return;
      }
      const step = (code === KEY.RIGHT ? 1 : -1) * (rtl ? -1 : 1);
      if (focus === "go-live" && (code === KEY.LEFT || code === KEY.RIGHT) && step < 0) {
        onFocus("seek");
        return;
      }
      if (focus === "seek") {
        if (code === KEY.UP) {
          onClose();
        } else if (code === KEY.DOWN) {
          const control = navigableControls.includes("play-pause")
            ? "play-pause"
            : navigableControls[0];
          if (control) onFocus(control);
          else onClose();
        } else if (code === KEY.LEFT || code === KEY.RIGHT) {
          const direction = (step < 0 ? -1 : 1) as -1 | 1;
          const amount = seekStepFromKey(seekRepeat.current, direction, event.repeat);
          if (amount) moveTarget(direction * amount);
        }
        return;
      }
      if (code === KEY.UP) {
        if (seekable) onFocus("seek");
        else onClose();
        return;
      }
      if (code === KEY.DOWN) {
        onClose();
        return;
      }
      const at = navigableControls.indexOf(focus as PlaybackDeckAction);
      if (at === -1) {
        if (code !== KEY.LEFT && code !== KEY.RIGHT) return;
        const current = controls.indexOf(focus as PlaybackDeckAction);
        if (current === -1) return;
        for (let next = current + step; next >= 0 && next < controls.length; next += step) {
          if (!disabled(controls[next])) {
            onFocus(controls[next]);
            return;
          }
        }
        return;
      }
      if (code === KEY.LEFT || code === KEY.RIGHT) {
        const next = Math.min(navigableControls.length - 1, Math.max(0, at + step));
        if (next !== at) onFocus(navigableControls[next]);
      } else if (code === KEY.ENTER) {
        const control = navigableControls[at];
        if (control && !disabled(control)) onAction(control);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    inputEnabled,
    interact,
    onClose,
    focus,
    controls,
    navigableControls,
    disabled,
    moveTarget,
    onFocus,
    onAction,
    seekable,
    rtl,
  ]);

  const activate = (control: PlaybackDeckAction) => {
    interact();
    onFocus(control);
    if (!disabled(control)) onAction(control);
  };

  const programmeWindow =
    metadata.currentStart !== undefined && metadata.currentEnd !== undefined
      ? [new Date(metadata.currentStart * 1000), new Date(metadata.currentEnd * 1000)]
          .map((at) => time(at))
          .join(" - ")
      : "";
  const title = metadata.title;
  /*
   * The current title and the programme window stay on the same row but are separate
   * elements: only the title maps to the banner's Now part for the expansion, while the
   * time is new content that fades in with everything else.
   */
  const currentProgramme = metadata.currentProgramme ?? "";
  const nextProgramme = metadata.nextProgramme ?? "";
  const hasProgrammes = !!(currentProgramme || programmeWindow || nextProgramme);

  /*
   * What the expansion may and may not follow. The identity of the displayed metadata is
   * the key, including the locale that words are drawn in: a clock tick re-rendering the
   * same title must not restart the motion, while a different programme or a different
   * language under the same banner cancels it. The playhead itself is deliberately not
   * here, because it changes every second without changing what is on.
   */
  const contentKey = useMemo(
    () =>
      JSON.stringify([
        locale,
        metadata.number,
        metadata.logo,
        metadata.title,
        metadata.group,
        metadata.quality,
        metadata.year,
        metadata.rating,
        metadata.currentProgramme,
        metadata.currentStart,
        metadata.currentEnd,
        metadata.nextProgramme,
      ]),
    [
      locale,
      metadata.number,
      metadata.logo,
      metadata.title,
      metadata.group,
      metadata.quality,
      metadata.year,
      metadata.rating,
      metadata.currentProgramme,
      metadata.currentStart,
      metadata.currentEnd,
      metadata.nextProgramme,
    ],
  );
  const rootRef = useRef<HTMLDivElement>(null);
  usePlaybackExpansion(
    rootRef,
    entrance === "banner" ? expansionOrigin : null,
    targetKey,
    contentKey,
  );

  useLayoutEffect(() => {
    if (!inputEnabled) return;
    const control = rootRef.current?.querySelector<HTMLElement>(`[data-control="${focus}"]`);
    if (control && !control.matches(":disabled")) control.focus({ preventScroll: true });
  }, [focus, inputEnabled, disabled, displayRange]);

  /*
   * Both horizontal arrows describe control movement, including at bounded edges.
   * Vertical hints show movement between rows when available and the close keys for each focus.
   */
  const inlineStartArrow = rtl ? "\u2192" : "\u2190";
  const inlineEndArrow = rtl ? "\u2190" : "\u2192";
  const moveKeys =
    focus === "seek"
      ? navigableControls.length
        ? ["\u2193"]
        : []
      : [inlineStartArrow, inlineEndArrow, ...(seekable ? ["\u2191"] : [])];
  const closeKeys =
    focus === "seek"
      ? ["\u2191", "Return"]
      : seekable
        ? ["\u2193", "Return"]
        : ["\u2191", "\u2193", "Return"];
  const seekKeys =
    focus === "seek" && seekable && range
      ? [
          ...(target > range.startSeconds ? [inlineStartArrow] : []),
          ...(target < range.endSeconds || showGoLive ? [inlineEndArrow] : []),
        ]
      : [];
  const hintItems = [
    ...(seekKeys.length ? [{ keys: seekKeys, label: t("deck.seek") }] : []),
    ...(moveKeys.length ? [{ keys: moveKeys, label: t("common.move") }] : []),
    ...(navigableControls.includes(focus as PlaybackDeckAction)
      ? [{ keys: ["OK"], label: t("common.select") }]
      : []),
    { keys: closeKeys, label: t("common.close") },
  ];

  return (
    <div
      ref={rootRef}
      className="playback-deck"
      data-kind={metadata.kind}
      data-entrance={entrance}
      data-playback-target={targetKey || undefined}
      onPointerDown={interact}
      onPointerMove={interact}
      onWheel={interact}
    >
      {/* The painted panel, so the expansion can move the background independently of the
          words and controls travelling to their places above it. */}
      <div className="deck-surface" aria-hidden="true" />
      <div className="deck-meta">
        {live ? (
          <PlaybackIdentity
            variant="deck"
            title={title}
            number={metadata.number}
            logo={metadata.logo}
            group={metadata.group}
            quality={metadata.quality}
            year={metadata.year}
            rating={metadata.rating}
          />
        ) : (
          <div className="deck-identity">
            <Artwork
              src={metadata.logo}
              alt=""
              kind="poster"
              width={72}
              height={108}
              className="deck-artwork finite"
              placeholderIcon={metadata.kind === "episode" ? "series" : "movie"}
            />
            <div className="deck-copy">
              <Text
                value={title}
                className="deck-title"
                marquee
                active
                part="title"
                partValue={title}
              />
              <div className="deck-context">
                {(metadata.year || metadata.rating || metadata.quality) && (
                  <span className="deck-tags">
                    {metadata.quality && <span>{metadata.quality}</span>}
                    {metadata.year && <span>{metadata.year}</span>}
                    {metadata.rating && (
                      <span className="deck-rating">
                        <Icon name="star" />
                        {metadata.rating}
                      </span>
                    )}
                  </span>
                )}
                {metadata.group && <Text value={metadata.group} />}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="deck-hairline" />
      {displayRange ? (
        <SeekBar
          range={displayRange}
          position={position}
          target={target}
          focused={focus === "seek"}
          disabled={!seekable}
          live={live}
          showGoLive={false}
          goLiveFocused={false}
          onTarget={(value) => {
            targetTouched.current = true;
            targetRef.current = value;
            setTarget(value);
            onSeek(value);
          }}
          onGoLive={() => onAction("go-live")}
          onFocus={onFocus}
        />
      ) : (
        <div className="seekbar disabled" aria-disabled="true">
          <span className="seekbar-time">--:--</span>
          <div className="seekbar-track" />
          <span className="seekbar-time">--:--</span>
        </div>
      )}
      <div className="deck-controls" role="toolbar" aria-label={t("deck.controls")}>
        {/*
         * The context action sits on the leading edge, the transport keys stay centred, and
         * Audio and Subtitles keep the trailing edge, so the row reads the same on every
         * kind of content regardless of which of them the stream actually has.
         */}
        <div className="deck-lead">
          {lead.map((control) => controlButton(control))}
          {connecting ? (
            <span
              className="deck-live loading"
              role="status"
              aria-label={t("picture.connecting")}
            >
              <span className="spinner small" aria-hidden="true" />
            </span>
          ) : liveBadge ? (
            <span className="deck-live" role="img" aria-label={t("content.live")}>
              <Icon name="live" />
            </span>
          ) : null}
        </div>
        <div className="deck-transport">{mid.map((control) => controlButton(control))}</div>
        <div className="deck-tail">
          {tail.map((control) =>
            control === "guide" ? (
              <section
                key="guide"
                className={`deck-programme-panel${hasProgrammes ? " has-programmes" : ""}`}
                data-selected={focus === "guide" && !disabled("guide") ? true : undefined}
                aria-label={t("guide.subtitle")}
              >
                {hasProgrammes && (
                  <div className="deck-programme-copy">
                    {(currentProgramme || programmeWindow) && (
                      <div className="deck-programme-current">
                        {currentProgramme && (
                          <Text
                            value={currentProgramme}
                            className="deck-programme-title"
                            marquee
                            active
                            part="now"
                            partValue={metadata.currentProgramme}
                          />
                        )}
                        {programmeWindow && (
                          <span className="deck-programme-time">{programmeWindow}</span>
                        )}
                      </div>
                    )}
                    {nextProgramme && (
                      <Text
                        value={nextProgramme}
                        className="deck-programme-next"
                        marquee
                        active
                      />
                    )}
                  </div>
                )}
                {controlButton("guide")}
              </section>
            ) : (
              controlButton(control)
            ),
          )}
        </div>
      </div>
      <KeyGuide className="deck-hints ruled" items={hintItems} />
      <SubtitleLayer cue={subtitleCue} hidden={false} />
    </div>
  );

  function controlButton(control: PlaybackDeckAction, className = "") {
    const entry = CONTROLS[control];
    const icon = control === "play-pause" && !snapshot.paused ? "pause" : entry.icon;
    return (
      <button
        key={control}
        type="button"
        className={`btn tonal deck-control ${className}`.trim()}
        data-control={control}
        data-selected={
          control !== "guide" && !disabled(control) && focus === control ? true : undefined
        }
        aria-label={t(entry.key)}
        aria-pressed={control === "play-pause" ? snapshot.paused : undefined}
        disabled={disabled(control)}
        onPointerEnter={() =>
          pointerOnly(() => {
            if (!disabled(control)) onFocus(control);
          })
        }
        onClick={() => activate(control)}
      >
        <Icon name={icon} logicalDirection={control === "previous" || control === "next"} />
      </button>
    );
  }
}
