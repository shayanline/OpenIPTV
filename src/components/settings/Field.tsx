import { useLocale } from "../../hooks/useLocale";

/**
 * The three controls every settings section is built from.
 *
 * They were defined inside Settings.tsx among the four sections that use them, which meant
 * the file described both the shape of a settings row and the whole of what is in one. They
 * are generic and they are shared, so they live on their own.
 */

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="settings-page-header">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </header>
  );
}

/**
 * Where the viewer is, without spending a focus target on it. Every entry is a
 * static span inside an ordered list, so the remote's D-pad never lands here.
 */
export function SettingsBreadcrumbs({
  items,
}: {
  items: readonly { label: string }[];
}) {
  const { t } = useLocale();
  return (
    <nav className="settings-breadcrumbs" aria-label={t("remote.breadcrumbs")}>
      <ol>
        {items.map((item, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: Breadcrumbs are a positional path of stateless labels.
            key={index}
          >
            {index > 0 && (
              <span className="settings-breadcrumb-sep" aria-hidden="true">
                /
              </span>
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

export function SettingsListHeader({
  title,
  count,
  children,
  className = "",
  headingLevel = 4,
}: {
  title: string;
  count?: string;
  children?: React.ReactNode;
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className={`settings-list-header ${className}`.trim()}>
      <div className="settings-list-title">
        <Heading>{title}</Heading>
        {count && <span className="count">{count}</span>}
      </div>
      {children && <div className="settings-list-actions">{children}</div>}
    </div>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
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

export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
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
          aria-label={`${label}, ${o.label}`}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          <span>{o.label}</span>
        </button>
      ))}
    </>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      className={`switch ${value ? "on" : ""}`}
      aria-label={label}
      aria-pressed={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    >
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      <span>{value ? t("common.on") : t("common.off")}</span>
    </button>
  );
}
