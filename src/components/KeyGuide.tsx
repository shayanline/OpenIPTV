import { useLocale } from "../hooks/useLocale";

/**
 * The line of "press this, get that" that appears on every screen.
 *
 * It is the whole of this application's manual, which is why it is one component rather than
 * six similar ones: it was written out by hand in the banner, the channel panel, settings,
 * first run, the empty playlist screen and the failed channel card, in three different markups
 * with three separate definitions of the key badge in the stylesheet, and the banner's copy had
 * quietly missed the badge altogether and was drawing bare text.
 *
 * One component and one style means a change to how a key is drawn happens once and appears
 * everywhere, and it is impossible for one screen's guide to drift out of step with the rest.
 */

export interface Guide {
  /** The keys to press, drawn as badges. Arrows are written as the arrows themselves. */
  keys: string[];
  beforeKeys?: React.ReactNode;
  label: React.ReactNode;
}

export function SettingsPath({
  items,
  direction,
}: {
  items: string[];
  direction: "ltr" | "rtl";
}) {
  return (
    <span className="settings-path">
      {items.map((item, index) => (
        <span key={item}>
          {index > 0 && <span aria-hidden="true">{direction === "rtl" ? "‹" : "›"}</span>}
          <span>{item}</span>
        </span>
      ))}
    </span>
  );
}

export function KeyGuide({
  items,
  className = "",
}: {
  items: Guide[];
  /** A layout variant, since the same guide sits along a banner, a panel and a column. */
  className?: string;
}) {
  return (
    <div className={`hints ${className}`}>
      {items.map((item) => (
        <span key={item.keys.join("|")}>
          {item.keys.map((key, keyIndex) => (
            <kbd key={key} data-key={key}>
              {keyIndex === 0 && item.beforeKeys ? (
                <>
                  {item.beforeKeys} {key}
                </>
              ) : (
                key
              )}
            </kbd>
          ))}
          <span
            className="guide-label"
            title={typeof item.label === "string" ? item.label : undefined}
          >
            {item.label}
          </span>
        </span>
      ))}
    </div>
  );
}

export function NavigationGuide({
  className = "",
  scroll = false,
  shortcuts = [],
  returnLabel,
}: {
  className?: string;
  scroll?: boolean;
  shortcuts?: Guide[];
  returnLabel?: string;
}) {
  const { t } = useLocale();
  return (
    <KeyGuide
      className={className}
      items={[
        ...(scroll ? [{ keys: ["\u2191", "\u2193"], label: t("common.scroll") }] : []),
        { keys: ["OK"], label: t("common.select") },
        { keys: ["Return"], label: returnLabel ?? t("common.back") },
        ...shortcuts,
      ]}
    />
  );
}

export function DialogGuide() {
  const { t } = useLocale();
  return (
    <KeyGuide
      className="page-key-guide dialog-key-guide"
      items={[
        { keys: ["OK"], label: t("common.select") },
        { keys: ["Return"], label: t("common.back") },
      ]}
    />
  );
}
