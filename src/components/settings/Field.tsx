
/**
 * The three controls every settings section is built from.
 *
 * They were defined inside Settings.tsx among the four sections that use them, which meant
 * the file described both the shape of a settings row and the whole of what is in one. They
 * are generic and they are shared, so they live on their own.
 */

export function Row({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </div>
      <div className="field-control">{children}</div>
    </div>
  );
}

export function Choice<T extends string>({ options, value, onChange }: {
  options: readonly { readonly id: T; readonly label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`chip ${o.id === value ? "on" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </>
  );
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`switch ${value ? "on" : ""}`} onClick={() => onChange(!value)}>
      <span className="switch-track"><span className="switch-knob" /></span>
      <span>{value ? "On" : "Off"}</span>
    </button>
  );
}
