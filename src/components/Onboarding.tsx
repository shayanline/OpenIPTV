import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { useSettings } from "../stores/settings";
import { useSetup } from "../stores/setup";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import {
  checkPlaylistUrl,
  m3uSource,
  nameFromUrl,
  type PlaylistSource,
  sourceDisplay,
  xtreamSource,
} from "../services/playlistUrl";
import type { MessageKey } from "../services/locale";
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
  const { t } = useLocale();
  const settings = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const { move } = useSpatialNav(box, true);
  const { name, source, set: setSetup } = useSetup();
  const [problem, setProblem] = useState<MessageKey | "">("");
  const url = source.kind === "m3u" ? source.url : "";
  const server = source.kind === "xtream" ? source.server : "";
  const username = source.kind === "xtream" ? source.username : "";
  const password = source.kind === "xtream" ? source.password : "";
  const output = source.kind === "xtream" ? source.output : "m3u8";

  useEffect(() => {
    first.current?.focus();
  }, []);

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
    if ([KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT].includes(code as never)) {
      event.preventDefault();
      move(code);
    }
  });

  return (
    <div className="onboard">
      <div className="onboard-box" ref={box}>
        <div className={showRemoteSetup ? "onboard-split" : "onboard-single"}>
          <section className="onboard-manual">
            <h1>OpenIPTV</h1>
            <p className="lead">{t("onboarding.description")}</p>

            <div className="form">
              <div className="playlist-source-options">
                <button
                  type="button"
                  className="btn tonal"
                  aria-pressed={source.kind === "m3u"}
                  onClick={() => {
                    setSetup({ name, source: { kind: "m3u", url: "" } });
                    setProblem("");
                  }}
                >
                  <span>{t("onboarding.m3uPlaylist")}</span>
                </button>
                <button
                  type="button"
                  className="btn tonal"
                  aria-pressed={source.kind === "xtream"}
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
                      setSetup({ name, source: { ...source, server: event.target.value } });
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

            <div className="onboard-language">
              <span className="onboard-language-label">{t("settings.language")}</span>
              <div className="onboard-language-options">
                <LanguagePicker
                  value={settings.locale}
                  onChange={(id) => settings.set("locale", id)}
                />
              </div>
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
