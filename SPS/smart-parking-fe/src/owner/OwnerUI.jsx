import { OwnerIcon } from "./OwnerIcons";
import { formatDateTimeVN } from "../utils/dateTime";

export function formatCurrency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function formatDateTime(value) {
  return formatDateTimeVN(value, "--");
}

export function getStatusMeta(status) {
  const map = {
    available: { label: "Trống", tone: "success" },
    active: { label: "Hoạt động", tone: "success" },
    locked: { label: "Đã khóa", tone: "danger" },
    reserved: { label: "Đang giữ", tone: "info" },
    in_use: { label: "Đang sử dụng", tone: "warning" },
    maintenance: { label: "Bảo trì", tone: "danger" },
    banned: { label: "Bị khóa", tone: "danger" },
    suspended: { label: "Tạm khóa", tone: "danger" },
    blocked: { label: "Bị chặn", tone: "danger" },
    pending: { label: "Chờ xác nhận", tone: "info" },
    booked: { label: "Đã đặt", tone: "success" },
    checked_in: { label: "Đã check-in", tone: "warning" },
    confirmed: { label: "Đã xác nhận", tone: "success" },
    in_progress: { label: "Đang hoạt động", tone: "warning" },
    completed: { label: "Hoàn tất", tone: "success" },
    cancelled: { label: "Đã hủy", tone: "danger" },
    paid: { label: "Đã thanh toán", tone: "success" },
    refunded: { label: "Hoàn tiền", tone: "danger" },
    system: { label: "Hệ thống", tone: "neutral" },
    security: { label: "Bảo mật", tone: "danger" },
    booking: { label: "Đặt chỗ", tone: "info" },
    occupancy: { label: "Công suất", tone: "warning" },
    warning: { label: "Cảnh báo", tone: "warning" },
    success: { label: "Thành công", tone: "success" },
  };

  return map[status] || { label: status, tone: "neutral" };
}

export function StatusBadge({ status }) {
  const meta = getStatusMeta(status);
  return <span className={`owner-badge owner-badge--${meta.tone}`}>{meta.label}</span>;
}

export function SectionCard({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`owner-section-card ${className}`.trim()}>
      <header className="owner-section-head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="owner-section-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function StatCard({ title, value, note, trend, icon }) {
  return (
    <article className="owner-stat-card">
      <div className="owner-stat-icon">
        <OwnerIcon name={icon} />
      </div>
      <div className="owner-stat-body">
        <p className="owner-stat-title">{title}</p>
        <h3>{value}</h3>
        <div className="owner-stat-foot">
          <span>{note}</span>
          {trend ? <strong className="owner-stat-trend">{trend}</strong> : null}
        </div>
      </div>
    </article>
  );
}

export function LineChart({ data, formatValue = formatCurrency }) {
  const isEmptyState = data.length === 1 && data[0]?.label === "Không có dữ liệu" && Number(data[0]?.amount || 0) === 0;
  const width = 640;
  const height = 260;
  const padding = 30;
  const max = Math.max(...data.map((item) => item.amount), 1);
  const min = Math.min(...data.map((item) => item.amount), 0);
  const range = Math.max(max - min, 1);

  const points = data.map((item, index) => {
    const x = data.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1);
    const y = height - padding - ((item.amount - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const areaPoints = data.length > 1
    ? [`${padding},${height - padding}`, ...points, `${width - padding},${height - padding}`].join(" ")
    : "";
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  return (
    <div className="owner-chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="owner-chart-svg" role="img" aria-label="Biểu đồ doanh thu">
        {[0, 1, 2, 3].map((line) => {
          const y = padding + (line * (height - padding * 2)) / 3;
          return <line key={line} x1={padding} y1={y} x2={width - padding} y2={y} className="owner-chart-grid" />;
        })}
        {!isEmptyState && data.length > 1 ? <polygon points={areaPoints} className="owner-chart-area" /> : null}
        {!isEmptyState && data.length > 1 ? <polyline points={points.join(" ")} className="owner-chart-line" /> : null}
        {isEmptyState ? (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="owner-chart-empty">
            Chưa có dữ liệu doanh thu trong kỳ này
          </text>
        ) : null}
        {!isEmptyState && data.map((item, index) => {
          const [x, y] = points[index].split(",");
          const shouldRenderLabel = data.length <= 8 || index % labelStep === 0 || index === data.length - 1;
          return (
            <g key={item.label}>
              <circle cx={x} cy={y} r="5" className="owner-chart-dot" />
              <title>{`${item.label}: ${formatValue(item.amount)}`}</title>
              {shouldRenderLabel ? (
                <text x={x} y={height - 8} textAnchor="middle" className="owner-chart-label">
                  {item.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="owner-chart-legend">
        <span className="owner-chart-chip">Đỉnh: {formatValue(max)}</span>
        <span className="owner-chart-chip">Trung bình: {formatValue(data.reduce((sum, item) => sum + item.amount, 0) / data.length)}</span>
      </div>
    </div>
  );
}

export function BarChart({ data, formatValue = formatCurrency }) {
  const max = Math.max(...data.map((item) => item.amount), 1);

  return (
    <div className="owner-bars">
      {data.map((item) => (
        <div key={item.label} className="owner-bar-item">
          <div className="owner-bar-track">
            <div className="owner-bar-fill" style={{ height: `${(item.amount / max) * 100}%` }} />
          </div>
          <strong>{item.label}</strong>
          <span>{formatValue(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}
