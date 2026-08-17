import { useEffect, useRef, useState } from "react";
import { useLocale } from "../hooks/useLocale";
import { useSettings } from "../stores/settings";
import { KEY, useRemote } from "../hooks/useRemote";
import { useSpatialNav } from "../hooks/useSpatialNav";
import { checkPlaylistUrl, nameFromUrl } from "../services/playlistUrl";
import type { MessageKey } from "../services/locale";
import { LanguagePicker } from "./LanguagePicker";
import { KeyGuide } from "./KeyGuide";

/**
 * First run.
 *
 * The app ships with no playlist. There is no neutral one to bundle, since any choice
 * would be the app deciding what somebody should watch, so it asks instead. One screen,
 * one field, one button: the guidance asks for unnecessary levels to be removed and for
 * an app to need no manual.
 */
export function Onboarding({
  onAdd,
  onExit,
}: {
  onAdd: (name: string, url: string) => void;
  /** RETURN here closes the application, because this screen is the application's home. */
  onExit: () => void;
}) {
  const { t } = useLocale();
  const settings = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const { move } = useSpatialNav(box, true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<MessageKey | "">("");

  useEffect(() => {
    first.current?.focus();
  }, []);

  const submit = () => {
    // Checked here as well as in Settings, so a typo on the very first screen is answered
    // at once instead of after a twenty second timeout that blames the network.
    const verdict = checkPlaylistUrl(url);
    if (!verdict.ok) {
      setProblem(verdict.problemKey ?? "validation.completeAddress");
      return;
    }
    onAdd(name.trim() || nameFromUrl(url), url.trim());
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
    const typing = document.activeElement instanceof HTMLInputElement;
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
        <h1>OpenIPTV</h1>
        <p className="lead">{t("onboarding.description")}</p>

        <div className="form">
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
              setUrl(e.target.value);
              setProblem("");
            }}
          />
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
            onChange={(e) => setName(e.target.value)}
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
          disabled={!url.trim()}
        >
          {t("common.addPlaylist")}
        </button>
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
