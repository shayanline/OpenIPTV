import { useEffect, useRef, useState } from "react";
import { KEY, keyGrants, supportedKeys } from "../../hooks/useRemote";
import { supportsFlexGap } from "../../services/capabilities";
import * as disk from "../../services/disk";
import { repairState } from "../../services/repair";
import { APP_VERSION } from "../../meta";

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
function compatibilityFact(): string {
  const { state, port, why, hosts } = repairState();
  const known = hosts.length ? `, ${hosts.length} host${hosts.length === 1 ? "" : "s"} known` : "";
  if (state === "serving") return `serving on port ${port}${known}`;
  if (state === "starting") return `starting${known}`;
  if (state === "unavailable") return `not available on this TV: ${why}`;
  return `idle${known}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="diag-fact">
      <span className="diag-label">{label}</span>
      <span className="diag-value">{value}</span>
    </div>
  );
}

export function Diagnostics() {
  const [presses, setPresses] = useState<Press[]>([]);
  /**
   * What the cache is holding, which is the one fact here that is not fixed.
   *
   * Read once when the screen opens rather than watched. It changes only when a playlist is
   * refreshed or a logo is saved, neither of which happens while somebody is reading this,
   * and a figure that ticks upwards on its own invites the reader to wonder what is going on
   * rather than telling them anything.
   */
  const [cache, setCache] = useState("reading\u2026");
  useEffect(() => {
    let live = true;
    void disk.usage().then(({ bytes, count }) => {
      if (!live) return;
      const share = Math.round((bytes / disk.BUDGET_BYTES) * 100);
      setCache(`${(bytes / 1048576).toFixed(2)}MB of `
        + `${Math.round(disk.BUDGET_BYTES / 1048576)}MB, ${share}%, in ${count} entries`);
    });
    return () => { live = false; };
  }, []);
  /** Read once. None of it changes while the app is running, and the probe costs a layout. */
  const facts = useRef<{ label: string; value: string }[] | null>(null);

  if (!facts.current) {
    const ua = navigator.userAgent;
    const tizen = /Tizen (\d+\.\d+)/.exec(ua)?.[1];
    const chromium = /Chrome\/(\d+)/.exec(ua)?.[1] ?? /\) (\d+)\./.exec(ua)?.[1];
    const memory = (navigator as { deviceMemory?: number }).deviceMemory;
    const heap = (performance as { memory?: { jsHeapSizeLimit: number } }).memory;
    const granted = keyGrants();
    const supported = supportedKeys();

    facts.current = [
      { label: "App", value: APP_VERSION },
      { label: "Platform", value: tizen ? `Tizen ${tizen}` : "Not a Samsung TV" },
      { label: "Engine", value: chromium ? `Chromium ${chromium}` : "unknown" },
      { label: "Screen", value: `${window.innerWidth}x${window.innerHeight}` },
      { label: "Memory", value: memory ? `${memory}GB` : "not reported" },
      {
        label: "Script heap",
        value: heap ? `${Math.round(heap.jsHeapSizeLimit / 1048576)}MB` : "not reported",
      },
      // The one capability the app measures rather than assumes, and the one that decides
      // how the whole interface is spaced. Worth being able to see on the set itself.
      { label: "Flex gap", value: supportsFlexGap() ? "yes" : "no, using the margin fallback" },
      {
        label: "Keys granted",
        value: granted.length
          ? `${granted.filter((g) => g.granted).length} of ${granted.length}`
          : "none, this is not a television",
      },
      ...(granted.some((g) => !g.granted)
        ? [{
            label: "Refused",
            value: granted.filter((g) => !g.granted).map((g) => g.name).join(", "),
          }]
        : []),
      ...(supported.length ? [{ label: "Remote has", value: `${supported.length} keys` }] : []),
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setPresses((had) => [{ code: e.keyCode, key: e.key, at: Date.now() }, ...had].slice(0, KEPT));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <>
      <h3>Diagnostics</h3>
      <p className="sheet-lead">
        What this television is, and what its remote sends. Useful when something works here
        and not on another set: read these out rather than describing them.
      </p>

      <div className="diag-facts">
        {facts.current.map((f) => <Fact key={f.label} label={f.label} value={f.value} />)}
        {/* Not in `facts`, because that is read once during render and this arrives later. */}
        <Fact label="Cached" value={cache} />
        {/*
          * Compatibility, read on every render rather than once, because it is the one fact here
          * that changes while somebody is looking at it: a channel repaired in the last minute
          * moves this from idle to serving. It is also the only way to tell "this television
          * cannot do it" from "nothing has needed it yet", which is the first question anybody
          * asks when the toggle appears to have done nothing.
          */}
        <Fact label="Compatibility" value={compatibilityFact()} />
      </div>

      <h4 className="diag-heading">Keys</h4>
      <p className="sheet-lead">
        Press anything on the remote. Every key is listed, including the ones this app does
        nothing with, so a button that is missing from the list never reached the app at all.
      </p>
      <div className="diag-keys">
        {presses.length === 0
          ? <p className="empty">Nothing pressed yet.</p>
          : presses.map((p) => (
              <div className="diag-press" key={`${p.at}-${p.code}`}>
                <span className="diag-code">{p.code}</span>
                <span className="diag-name">{NAMED[p.code] ?? p.key ?? "not a key this app knows"}</span>
              </div>
            ))}
      </div>
    </>
  );
}
