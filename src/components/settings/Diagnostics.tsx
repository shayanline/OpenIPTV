import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocale } from "../../hooks/useLocale";
import { KEY, keyGrants, supportedKeys } from "../../hooks/useRemote";
import { supportsFlexGap } from "../../services/capabilities";
import * as disk from "../../services/disk";
import { repairState } from "../../services/repair";
import type { MessageKey } from "../../services/locale";
import { APP_VERSION } from "../../meta";
import { PageHeader } from "./Field";
import { Icon } from "../Icon";

/**
 * What this particular television is, and what its remote actually sends.
 *
 * This exists because of the models nobody here owns. The app supports every Samsung set
 * from 2020 onwards, which is seven platform versions and hundreds of models, and the
 * things that differ between them are exactly the things no simulator reproduces: which
 * keys the remote has, which of them the platform hands over, and what the set reports
 * about itself. "The yellow button does nothing on my TV" is unanswerable by reading the
 * source, and answerable in about four seconds from this screen.
 *
 * It is a normal part of Settings rather than a hidden gesture. There is nothing here worth
 * concealing, a hidden combination on a device driven by a remote is a combination nobody
 * can be talked through over the phone, and anything that only appears in a debug build is
 * a thing that cannot help the one person who has the failing television.
 */

/** The names the app knows, so a code can be reported as something rather than as a number. */
const NAMED = Object.entries(KEY).reduce<Record<number, string>>((all, [name, code]) => {
  // Two names for one code is possible and the first is the one worth showing.
  if (!(code in all)) all[code] = name;
  return all;
}, {});

interface Press {
  code: number;
  key: string;
  at: number;
}

/** Long enough to show a pattern, short enough to read from a sofa. */
const KEPT = 8;

/**
 * What the repair is doing, in one line a viewer can read out over the telephone.
 *
 * Deliberately says how many hosts have been diagnosed even when nothing is serving, because that
 * is what distinguishes a television that has repaired something before from one that never has.
 */
function compatibilityFact(t: ReturnType<typeof useLocale>["t"]): string {
  const { state, port, why, hosts } = repairState();
  const known = hosts.length ? t("diagnostics.knownHosts", { count: hosts.length }) : "";
  if (state === "serving")
    return t("diagnostics.compatibilityServing", { port: port ?? "", known });
  // Bound and quiet, which is where a channel needing no repair leaves it. Named separately from
  // idle because the two look identical to a viewer and mean different things to anybody reading a
  // fault report: this one has already proved the television can do it.
  if (state === "listening")
    return t("diagnostics.compatibilityListening", { port: port ?? "", known });
  if (state === "starting") return t("diagnostics.compatibilityStarting", { known });
  if (state === "unavailable")
    return t("diagnostics.compatibilityUnavailable", { reason: why });
  return t("diagnostics.compatibilityIdle", { known });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="diag-fact">
      <span className="diag-label">{label}</span>
      <span className="diag-value">{value}</span>
    </div>
  );
}

function FactGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="diag-group">
      <h4>{title}</h4>
      <div className="diag-facts">{children}</div>
    </section>
  );
}

export function Diagnostics({
  onAsking,
  nested = false,
}: {
  onAsking: (asking: boolean) => void;
  nested?: boolean;
}) {
  const { t } = useLocale();
  const [presses, setPresses] = useState<Press[]>([]);
  const [testing, setTesting] = useState(false);
  const testButton = useRef<HTMLButtonElement>(null);
  const tester = useRef<HTMLDivElement>(null);
  /**
   * What the cache is holding, which is the one fact here that is not fixed.
   *
   * Read once when the screen opens rather than watched. It changes only when a playlist is
   * refreshed or a logo is saved, neither of which happens while somebody is reading this,
   * and a figure that ticks upwards on its own invites the reader to wonder what is going on
   * rather than telling them anything.
   */
  const [cache, setCache] = useState(() => t("diagnostics.reading"));
  useEffect(() => {
    let live = true;
    void disk.usage().then(({ bytes, count }) => {
      if (!live) return;
      const share = Math.round((bytes / disk.BUDGET_BYTES) * 100);
      const entries = t("diagnostics.entryCount", { count });
      setCache(
        t("diagnostics.cacheUsage", {
          used: (bytes / 1048576).toFixed(2),
          budget: Math.round(disk.BUDGET_BYTES / 1048576),
          share,
          entries,
        }),
      );
    });
    return () => {
      live = false;
    };
  }, [t]);
  /** Read once. None of it changes while the app is running, and the probe costs a layout. */
  const facts = useRef<{ label: MessageKey; value: string }[] | null>(null);

  if (!facts.current) {
    const ua = navigator.userAgent;
    const tizen = /Tizen (\d+\.\d+)/.exec(ua)?.[1];
    const chromium = /Chrome\/(\d+)/.exec(ua)?.[1] ?? /\) (\d+)\./.exec(ua)?.[1];
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const heap = (performance as { memory?: { jsHeapSizeLimit: number } }).memory;
    const granted = keyGrants();
    const supported = supportedKeys();

    facts.current = [
      { label: "diagnostics.app", value: APP_VERSION },
      {
        label: "diagnostics.platform",
        value: tizen ? t("diagnostics.tizen", { version: tizen }) : t("diagnostics.notSamsung"),
      },
      {
        label: "diagnostics.engine",
        value: chromium
          ? t("diagnostics.chromium", { version: chromium })
          : t("diagnostics.unknown"),
      },
      { label: "diagnostics.screen", value: `${window.innerWidth}x${window.innerHeight}` },
      {
        label: "diagnostics.memory",
        value: memory ? `${memory}GB` : t("diagnostics.notReported"),
      },
      {
        label: "diagnostics.scriptHeap",
        value: heap
          ? `${Math.round(heap.jsHeapSizeLimit / 1048576)}MB`
          : t("diagnostics.notReported"),
      },
      // The one capability the app measures rather than assumes, and the one that decides
      // how the whole interface is spaced. Worth being able to see on the set itself.
      {
        label: "diagnostics.flexGap",
        value: supportsFlexGap() ? t("diagnostics.yes") : t("diagnostics.noMarginFallback"),
      },
      {
        label: "diagnostics.keysGranted",
        value: granted.length
          ? `${granted.filter((g) => g.granted).length} of ${granted.length}`
          : t("diagnostics.noneNotTv"),
      },
      ...(granted.some((g) => !g.granted)
        ? [
            {
              label: "diagnostics.refused" as MessageKey,
              value: granted
                .filter((g) => !g.granted)
                .map((g) => g.name)
                .join(", "),
            },
          ]
        : []),
      ...(supported.length
        ? [
            {
              label: "diagnostics.remoteHas" as MessageKey,
              value: t("diagnostics.keysCount", { count: supported.length }),
            },
          ]
        : []),
    ];
  }

  /*
   * Every key, including the ones the app ignores.
   *
   * Capturing, and on the window, so a press is recorded before anything decides not to act
   * on it. That is the whole point: the interesting key is the one that appears to do
   * nothing, and a log that only shows the keys the app already handles could not tell a
   * button that never arrived from a button that arrived and was ignored.
   */
  const closeTester = useCallback(() => {
    testButton.current?.focus();
    setTesting(false);
    onAsking(false);
  }, [onAsking]);

  useLayoutEffect(() => {
    if (testing) tester.current?.focus();
  }, [testing]);

  useEffect(() => {
    if (!testing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.keyCode === KEY.BACK || event.keyCode === KEY.ESC) {
        closeTester();
        return;
      }
      setPresses((had) =>
        [{ code: event.keyCode, key: event.key, at: Date.now() }, ...had].slice(0, KEPT),
      );
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [testing, closeTester]);

  const deviceLabels: MessageKey[] = [
    "diagnostics.app",
    "diagnostics.platform",
    "diagnostics.engine",
    "diagnostics.screen",
    "diagnostics.memory",
    "diagnostics.scriptHeap",
  ];
  const deviceFacts = facts.current.filter((fact) => deviceLabels.includes(fact.label));
  const compatibilityFacts = facts.current.filter((fact) => !deviceLabels.includes(fact.label));

  return (
    <>
      {!nested && (
        <PageHeader title={t("diagnostics.title")} description={t("diagnostics.lead")} />
      )}
      {nested && <p className="sheet-lead diag-nested-lead">{t("diagnostics.lead")}</p>}
      <div className="diag-groups">
        <FactGroup title={t("diagnostics.deviceInfo")}>
          {deviceFacts.map((fact) => (
            <Fact key={fact.label} label={t(fact.label)} value={fact.value} />
          ))}
          <Fact label={t("diagnostics.cached")} value={cache} />
        </FactGroup>
        <FactGroup title={t("diagnostics.compatibility")}>
          {compatibilityFacts.map((fact) => (
            <Fact key={fact.label} label={t(fact.label)} value={fact.value} />
          ))}
          <Fact label={t("diagnostics.compatibility")} value={compatibilityFact(t)} />
        </FactGroup>
      </div>

      <section className="diag-remote">
        <div>
          <h4>{t("diagnostics.remoteKeys")}</h4>
          <p>{t("diagnostics.remoteLead")}</p>
        </div>
        <button
          ref={testButton}
          type="button"
          className="btn tonal"
          data-settings-detail-first
          data-ok-guide={t("common.open")}
          onClick={() => {
            setPresses([]);
            setTesting(true);
            onAsking(true);
          }}
        >
          <Icon name="diagnostics" />
          <span>{t("diagnostics.remoteKeys")}</span>
        </button>
      </section>

      {testing && (
        <div className="dialog-scrim" onClick={closeTester}>
          <div
            ref={tester}
            className="diag-tester"
            role="dialog"
            aria-modal="true"
            aria-label={t("diagnostics.remoteKeys")}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>{t("diagnostics.remoteKeys")}</h2>
            <p>{t("diagnostics.remoteLead")}</p>
            {presses.length ? (
              <div className="diag-latest">
                <strong>
                  {NAMED[presses[0].code] ?? presses[0].key ?? t("diagnostics.unknown")}
                </strong>
                <span>{presses[0].code}</span>
              </div>
            ) : (
              <p className="empty">{t("diagnostics.noKeys")}</p>
            )}
            <div className="diag-key-history">
              {presses.slice(1).map((press) => (
                <span key={`${press.at}-${press.code}`}>
                  <b>{press.code}</b>
                  {NAMED[press.code] ?? press.key ?? "not a key this app knows"}
                </span>
              ))}
            </div>
            <button type="button" className="btn tonal" onClick={closeTester}>
              <span>{t("common.close")}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
