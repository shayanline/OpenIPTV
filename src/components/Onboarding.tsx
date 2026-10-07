import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useLocale } from "../hooks/useLocale";
import { useSettings } from "../stores/settings";
import { useSetup } from "../stores/setup";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import {
  checkPlaylistUrl,
  m3uSource,
  nameFromUrl,
  parseXtreamTemplateUrl,
  type PlaylistSource,
  sourceDisplay,
  xtreamFromServerField,
  xtreamSource,
} from "../services/playlistUrl";
import type { MessageKey } from "../services/locale";
import { Icon } from "./Icon";
import { LanguagePicker } from "./LanguagePicker";
import { OptionPicker } from "./OptionPicker";
import { KeyGuide } from "./KeyGuide";
import { RemoteSetup } from "./RemoteSetup";
import type { PairingSessionView } from "../services/deviceAccess";
import type { RemoteAccessState } from "../services/remoteServer";

/**
 * First run.
 *
 * The app ships with no playlist. There is no neutral one to bundle, since any choice
 * would be the app deciding what somebody should watch, so it asks instead. One screen,
 * one field, one button: the guidance asks for unnecessary levels to be removed and for
 * an app to need no manual.
 */
const NO_REMOTE_ACCESS: RemoteAccessState = {
  status: "unavailable",
  address: "",
  port: 0,
  remotePath: "",
  pairing: null,
  pairingError: false,
  connectedDevice: "",
  error: "",
};

export function Onboarding({
  onAdd,
  onExit,
  remoteAccess = NO_REMOTE_ACCESS,
  onOpenPairing,
  showRemoteSetup = false,
}: {
  onAdd: (name: string, source: PlaylistSource) => void;
  /** RETURN here closes the application, because this screen is the application's home. */
  onExit: () => void;
  remoteAccess?: RemoteAccessState;
  onOpenPairing?: () => PairingSessionView | null;
  showRemoteSetup?: boolean;
}) {
  const { t, direction } = useLocale();
  const settings = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const manual = useRef<HTMLElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const m3uButton = useRef<HTMLButtonElement>(null);
  const xtreamButton = useRef<HTMLButtonElement>(null);
  const { move } = useSpatialNav(box, true);
  const { name, source, set: setSetup } = useSetup();
  const [problem, setProblem] = useState<MessageKey | "">("");
  const [dismissedXtreamUrl, setDismissedXtreamUrl] = useState("");
  const url = source.kind === "m3u" ? source.url : "";
  const suggestedXtream =
    source.kind === "m3u" && source.url !== dismissedXtreamUrl
      ? parseXtreamTemplateUrl(source.url, "m3u8")
      : null;
  const server = source.kind === "xtream" ? source.server : "";
  const username = source.kind === "xtream" ? source.username : "";
  const password = source.kind === "xtream" ? source.password : "";
  const output = source.kind === "xtream" ? source.output : "m3u8";

  useEffect(() => {
    first.current?.focus();
  }, []);

  const moveWelcomeVertical = (code: number) => {
    const container = manual.current;
    if (!container) return false;
    const sources = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".playlist-source-options button"),
    );
    const selectedSource =
      sources.find((button) => button.getAttribute("aria-pressed") === "true") ?? sources[0];
    const active = document.activeElement as HTMLElement | null;
    const sourceFocus = sources.includes(active as HTMLButtonElement) ? active : selectedSource;
    const ordered = Array.from(
      container.querySelectorAll<HTMLElement>(
        "button:not([hidden]):not([disabled]):not([tabindex='-1']), input:not([hidden]):not([disabled]):not([tabindex='-1'])",
      ),
    ).filter(
      (element) => !sources.includes(element as HTMLButtonElement) || element === sourceFocus,
    );
    if (!ordered.length) return false;
    const current = Math.max(0, ordered.indexOf(active as HTMLElement));
    const delta = code === KEY.DOWN ? 1 : -1;
    ordered[(current + delta + ordered.length) % ordered.length].focus();
    return true;
  };

  const captureWelcomeVertical = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.keyCode !== KEY.UP && event.keyCode !== KEY.DOWN) return;
    event.preventDefault();
    event.stopPropagation();
    moveWelcomeVertical(event.keyCode);
  };

  const moveFromSource = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const inlineStart = direction === "rtl" ? KEY.RIGHT : KEY.LEFT;
    const inlineEnd = direction === "rtl" ? KEY.LEFT : KEY.RIGHT;
    if (event.keyCode === inlineStart || event.keyCode === inlineEnd) {
      event.preventDefault();
      event.stopPropagation();
      if (event.keyCode === inlineStart) m3uButton.current?.focus();
      else xtreamButton.current?.focus();
      return;
    }
    if (event.keyCode === KEY.DOWN) {
      event.preventDefault();
      event.stopPropagation();
      moveWelcomeVertical(KEY.DOWN);
    }
  };

  const applyXtream = (next: NonNullable<typeof suggestedXtream>) => {
    setSetup({ name, source: next });
    setProblem("");
  };

  const submit = () => {
    if (source.kind === "m3u") {
      const verdict = checkPlaylistUrl(source.url);
      if (!verdict.ok) {
        setProblem(verdict.problemKey ?? "validation.completeAddress");
        return;
      }
      const valid = m3uSource(source.url);
      if (!valid) return;
      onAdd(name.trim() || nameFromUrl(sourceDisplay(valid)), valid);
      useSetup.getState().clear();
      return;
    }

    const valid = xtreamSource(source.server, source.username, source.password, source.output);
    if (!valid) {
      setProblem("validation.completeAddress");
      return;
    }
    onAdd(name.trim() || nameFromUrl(sourceDisplay(valid)), valid);
    useSetup.getState().clear();
  };

  useRemote((code, event) => {
    /*
     * This is the application's home screen until a playlist exists, so RETURN closes the
     * application, which is what the input guide says RETURN means here. Swallowing the key
     * instead would leave the viewer with no way out of the first screen, using the button
     * that means "leave" everywhere else on the television.
     */
    if (code === KEY.BACK || code === KEY.ESC) {
      event.preventDefault();
      const typing = document.activeElement instanceof HTMLInputElement;
      // While the on-screen keyboard is up, RETURN belongs to the keyboard.
      if (typing) (document.activeElement as HTMLInputElement).blur();
      else onExit();
      return;
    }
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement;
    if (!typing && code === KEY.ENTER && active instanceof HTMLButtonElement) {
      event.preventDefault();
      active.click();
      return;
    }
    // Enter in the address field is the same as pressing the button, so the viewer never
    // has to work out that there is one further down.
    if (typing && code === KEY.ENTER) {
      event.preventDefault();
      submit();
      return;
    }
    if (typing && code !== KEY.UP && code !== KEY.DOWN) return;
    if (
      (code === KEY.UP || code === KEY.DOWN) &&
      active instanceof HTMLElement &&
      manual.current?.contains(active)
    ) {
      event.preventDefault();
      moveWelcomeVertical(code);
      return;
    }
    if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(code as never)) {
      event.preventDefault();
      move(code);
    }
  });

  return (
    <div className="onboard">
      <div className="onboard-box" ref={box}>
        <div className={showRemoteSetup ? "onboard-split" : "onboard-single"}>
          <section
            className="onboard-manual"
            ref={manual}
            onKeyDownCapture={captureWelcomeVertical}
          >
            <header className="onboard-head">
              <h1>OpenIPTV</h1>
              <div className="onboard-language">
                <span className="onboard-language-label">
                  <Icon name="language" />
                  {t("settings.language")}
                </span>
                <LanguagePicker
                  value={settings.locale}
                  onChange={(id) => settings.set("locale", id)}
                />
              </div>
            </header>
            <p className="lead">{t("onboarding.description")}</p>

            <div className="form">
              <div className="playlist-source-options">
                <button
                  ref={m3uButton}
                  type="button"
                  className="btn tonal"
                  aria-pressed={source.kind === "m3u"}
                  onKeyDown={moveFromSource}
                  onClick={() => {
                    setSetup({ name, source: { kind: "m3u", url: "" } });
                    setProblem("");
                  }}
                >
                  <span>{t("onboarding.m3uPlaylist")}</span>
                </button>
                <button
                  ref={xtreamButton}
                  type="button"
                  className="btn tonal"
                  aria-pressed={source.kind === "xtream"}
                  onKeyDown={moveFromSource}
                  onClick={() => {
                    setSetup({
                      name,
                      source: {
                        kind: "xtream",
                        server: "",
                        username: "",
                        password: "",
                        output: "m3u8",
                      },
                    });
                    setProblem("");
                  }}
                >
                  <span>{t("onboarding.xtreamLogin")}</span>
                </button>
              </div>
              {source.kind === "m3u" ? (
                <>
                  <label htmlFor="ob-url">{t("onboarding.playlistAddress")}</label>
                  <input
                    id="ob-url"
                    ref={first}
                    value={url}
                    spellCheck={false}
                    dir="ltr"
                    className={problem ? "wrong" : ""}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? "ob-url-problem" : undefined}
                    placeholder={t("onboarding.urlPlaceholder")}
                    onChange={(e) => {
                      setSetup({ name, source: { kind: "m3u", url: e.target.value } });
                      setProblem("");
                    }}
                  />
                  {suggestedXtream && (
                    <div className="xtream-suggestion">
                      <span>{t("onboarding.xtreamDetected")}</span>
                      <div>
                        <button
                          type="button"
                          className="btn tonal"
                          onClick={() => setDismissedXtreamUrl(source.url)}
                        >
                          <span>{t("onboarding.keepM3u")}</span>
                        </button>
                        <button
                          type="button"
                          className="btn tonal"
                          onClick={() => applyXtream(suggestedXtream)}
                        >
                          <span>{t("onboarding.useXtream")}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="xtream-fields">
                  <label htmlFor="ob-server">{t("onboarding.serverAddress")}</label>
                  <input
                    id="ob-server"
                    value={server}
                    spellCheck={false}
                    dir="ltr"
                    onChange={(event) => {
                      setSetup({
                        name,
                        source: xtreamFromServerField(source, event.target.value),
                      });
                      setProblem("");
                    }}
                  />
                  <label htmlFor="ob-username">{t("onboarding.username")}</label>
                  <input
                    id="ob-username"
                    value={username}
                    spellCheck={false}
                    dir="ltr"
                    onChange={(event) =>
                      setSetup({ name, source: { ...source, username: event.target.value } })
                    }
                  />
                  <label htmlFor="ob-password">{t("onboarding.password")}</label>
                  <input
                    id="ob-password"
                    type="password"
                    value={password}
                    dir="ltr"
                    onChange={(event) =>
                      setSetup({ name, source: { ...source, password: event.target.value } })
                    }
                  />
                  <label htmlFor="ob-output">{t("onboarding.streamFormat")}</label>
                  <OptionPicker
                    id="ob-output"
                    label={t("onboarding.streamFormat")}
                    value={output}
                    options={[
                      { value: "m3u8", label: t("onboarding.hls") },
                      { value: "ts", label: t("onboarding.mpegTs") },
                    ]}
                    onChange={(value) =>
                      setSetup({ name, source: { ...source, output: value } })
                    }
                  />
                </div>
              )}
              {problem && (
                <p className="field-problem" id="ob-url-problem" role="alert">
                  {t(problem)}
                </p>
              )}
              <label htmlFor="ob-name">{t("onboarding.nameOptional")}</label>
              <input
                id="ob-name"
                value={name}
                dir="auto"
                placeholder={t("onboarding.takenFromAddress")}
                onChange={(e) => setSetup({ name: e.target.value, source })}
              />
            </div>

            <button
              type="button"
              className="btn filled wide"
              onClick={submit}
              disabled={!sourceDisplay(source).trim()}
            >
              {t("common.addPlaylist")}
            </button>
          </section>
          {showRemoteSetup && (
            <>
              <div className="onboard-divider" aria-hidden="true" />
              <RemoteSetup
                remoteAccess={remoteAccess}
                onOpenPairing={onOpenPairing}
                manualFallback
              />
            </>
          )}
        </div>
        <KeyGuide
          className="onboard-foot ruled"
          items={[
            { keys: ["\u2191", "\u2193"], label: t("common.move") },
            { keys: ["OK"], label: t("guide.addIt") },
            { keys: ["Return"], label: t("common.closeApp") },
          ]}
        />
      </div>
    </div>
  );
}
