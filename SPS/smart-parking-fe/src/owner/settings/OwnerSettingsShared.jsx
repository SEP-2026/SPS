import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Car,
  Clock,
  CreditCard,
  Globe,
  KeyRound,
  LayoutGrid,
  Link2,
  Mail,
  Monitor,
  Palette,
  QrCode,
  Settings,
  Shield,
  User,
  Users,
  Wallet,
} from "lucide-react";

const SECTION_ICONS = {
  user: User,
  key: KeyRound,
  globe: Globe,
  palette: Palette,
  mail: Mail,
  api: Link2,
  info: Car,
  clock: Clock,
  qr: QrCode,
  booking: CalendarCheck,
  device: Monitor,
  payment: CreditCard,
  other: Settings,
  pricing: Wallet,
  fee: CreditCard,
  late: Clock,
  rules: LayoutGrid,
  entries: Users,
  overdue: AlertCircle,
  bell: Bell,
  limits: LayoutGrid,
};

export function SettingsSectionIcon({ name, size = 18 }) {
  const Icon = SECTION_ICONS[name] || Settings;
  return <Icon size={size} aria-hidden="true" />;
}

export function SettingsPanel({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`owner-settings-panel ${className}`.trim()}>
      {(title || subtitle || actions) ? (
        <header className="owner-settings-panel-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="owner-settings-panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="owner-settings-panel-body">{children}</div>
    </section>
  );
}

export function SettingsSaveButton({ saving, saved, label = "Lưu thay đổi", onClick, type = "submit", disabled = false }) {
  return (
    <div className="owner-settings-save-wrap">
      {saved ? <span className="owner-settings-saved">Đã lưu thay đổi.</span> : null}
      <button
        type={type}
        className="owner-management-primary owner-settings-save-btn"
        disabled={disabled || saving}
        onClick={onClick}
      >
        {saving ? "Đang lưu..." : label}
      </button>
    </div>
  );
}

export function BackendPendingNotice({ title = "Chưa có API backend", detail }) {
  return (
    <div className="owner-settings-pending" role="status">
      <AlertCircle size={20} />
      <div>
        <strong>{title}</strong>
        <p>
          {detail || "Phần cấu hình này chưa có endpoint lưu trên CSDL. Vui lòng xác nhận với team backend trước khi triển khai — giao diện chỉ hiển thị theo thiết kế, không lưu dữ liệu giả."}
        </p>
      </div>
    </div>
  );
}

export function SettingsSubNav({ items, activeId, onChange }) {
  return (
    <nav className="owner-settings-subnav" aria-label="Cấu hình chi tiết">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`owner-settings-subnav-item${activeId === item.id ? " is-active" : ""}${item.pending ? " is-pending" : ""}`}
          onClick={() => onChange(item.id)}
        >
          <span className="owner-settings-subnav-icon">
            <SettingsSectionIcon name={item.icon} />
          </span>
          <span>{item.label}</span>
          {item.pending ? <small>Chưa API</small> : null}
        </button>
      ))}
    </nav>
  );
}

export function SettingsSplitLayout({ subnav, children }) {
  return (
    <div className="owner-settings-split">
      <aside className="owner-settings-split-aside">{subnav}</aside>
      <div className="owner-settings-split-main">{children}</div>
    </div>
  );
}

export function SettingsFormGrid({ children, className = "" }) {
  return <div className={`owner-settings-form-grid ${className}`.trim()}>{children}</div>;
}

export function SettingsField({ label, hint, children, span = false }) {
  return (
    <label className={`owner-settings-field${span ? " owner-settings-field--span" : ""}`}>
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function SettingsMetaRow({ items }) {
  return (
    <div className="owner-settings-meta-row">
      {items.map((item) => (
        <article key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </div>
  );
}

export function PasswordToggleInput({ value, onChange, placeholder, autoComplete }) {
  return (
    <div className="owner-settings-password-wrap">
      <input
        className="owner-input"
        type="password"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </div>
  );
}

export function SettingsToggle({ checked, onChange, disabled = false, label }) {
  return (
    <label className={`owner-settings-toggle${disabled ? " is-disabled" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="owner-settings-toggle-track" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function SecurityIconBadge({ tone = "success", children }) {
  return <span className={`owner-settings-security-icon owner-settings-security-icon--${tone}`}>{children}</span>;
}

export function ShieldIcon() {
  return <Shield size={18} />;
}
