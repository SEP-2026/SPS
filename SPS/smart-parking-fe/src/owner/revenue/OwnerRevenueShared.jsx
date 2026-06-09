import { createPortal } from "react-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CalendarDays, ChevronDown, Download, Filter, Search } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { formatCurrency, formatDateTime, StatusBadge } from "../OwnerUI";
import { downloadCsv, formatNumber } from "../ownerUtils";
import {
  formatGrowthLabel,
  formatPercentOfTotal,
  getMethodLabel,
  REVENUE_SECTION_TABS,
} from "./revenueUtils";

const STAT_TONES = ["blue", "green", "orange", "pink", "sky"];
const CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#64748b"];

export function RevenueSectionTabs() {
  return (
    <nav className="owner-revenue-section-tabs" aria-label="Doanh thu và thanh toán">
      {REVENUE_SECTION_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) => `owner-revenue-section-tab${isActive ? " is-active" : ""}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function RevenueDateRange({
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}) {
  return (
    <div className="owner-revenue-date-range">
      <CalendarDays size={17} />
      <input type="date" value={dateFrom} onChange={(event) => onDateFromChange(event.target.value)} aria-label="Từ ngày" />
      <span>-</span>
      <input type="date" value={dateTo} onChange={(event) => onDateToChange(event.target.value)} aria-label="Đến ngày" />
    </div>
  );
}

export function RevenuePageActions({ children }) {
  return <div className="owner-page-actions owner-revenue-page-actions">{children}</div>;
}

export function RevenueStatGrid({ items }) {
  return (
    <div className="owner-management-stats owner-designed-stats owner-revenue-stat-grid">
      {items.map((item, index) => (
        <article key={item.title} className={`owner-management-stat owner-management-stat--${item.tone || STAT_TONES[index % STAT_TONES.length]}`}>
          <span>{item.icon}</span>
          <div>
            <p>{item.title}</p>
            <strong>{item.value}</strong>
            {item.growth !== undefined && item.growth !== null ? (
              <small className={`owner-revenue-growth${item.growth >= 0 ? " is-up" : " is-down"}`}>
                {formatGrowthLabel(item.growth)}
              </small>
            ) : item.subtitle ? <small>{item.subtitle}</small> : null}
          </div>
          {item.action ? <div className="owner-revenue-stat-action">{item.action}</div> : null}
        </article>
      ))}
    </div>
  );
}

export function RevenueFilterBar({
  search,
  onSearchChange,
  parkingFilter,
  onParkingFilterChange,
  methodFilter,
  onMethodFilterChange,
  statusFilter,
  onStatusFilterChange,
  parkingOptions,
  methodOptions,
  statusOptions,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  searchPlaceholder = "Tìm kiếm biển số, mã booking...",
  onApply,
}) {
  return (
    <div className="owner-filterbar owner-revenue-filterbar">
      <RevenueDateRange
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={onDateFromChange}
        onDateToChange={onDateToChange}
      />
      {parkingOptions ? (
        <select className="owner-management-select" value={parkingFilter} onChange={(event) => onParkingFilterChange(event.target.value)}>
          <option value="all">Tất cả bãi xe</option>
          {parkingOptions.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      ) : null}
      {methodOptions ? (
        <select className="owner-management-select" value={methodFilter} onChange={(event) => onMethodFilterChange(event.target.value)}>
          <option value="all">Tất cả phương thức</option>
          {methodOptions.map((method) => <option key={method} value={method}>{getMethodLabel(method)}</option>)}
        </select>
      ) : null}
      {statusOptions ? (
        <select className="owner-management-select" value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          {statusOptions.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
        </select>
      ) : null}
      <label className="owner-management-search">
        <Search size={18} />
        <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={searchPlaceholder} />
      </label>
      <button type="button" className="owner-management-secondary" onClick={onApply}>
        <Filter size={17} />
        Bộ lọc
      </button>
    </div>
  );
}

export function RevenueTableTabs({ tabs, activeTab, onChange }) {
  return (
    <div className="owner-revenue-table-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          className={activeTab === tab.value ? "is-active" : ""}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function RevenuePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label = "giao dịch",
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total ? (safePage - 1) * pageSize + 1 : 0;
  const to = Math.min(safePage * pageSize, total);

  const pages = [];
  const maxButtons = 5;
  let start = Math.max(1, safePage - 2);
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);
  for (let index = start; index <= end; index += 1) {
    pages.push(index);
  }

  return (
    <div className="owner-management-pagination owner-revenue-pagination">
      <span>Hiển thị {from} - {to} của {formatNumber(total)} {label}</span>
      <div className="owner-revenue-pagination-pages">
        <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>‹</button>
        {pages.map((item) => (
          <button key={item} type="button" className={safePage === item ? "is-active" : ""} onClick={() => onPageChange(item)}>
            {item}
          </button>
        ))}
        {end < totalPages ? <span>...</span> : null}
        {end < totalPages ? (
          <button type="button" className={safePage === totalPages ? "is-active" : ""} onClick={() => onPageChange(totalPages)}>
            {totalPages}
          </button>
        ) : null}
        <button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>›</button>
      </div>
      <label className="owner-revenue-page-size">
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size} / trang</option>)}
        </select>
        <ChevronDown size={14} />
      </label>
    </div>
  );
}

export function RevenueDonutPanel({ title, data, centerLabel, centerValue, emptyText = "Chưa có dữ liệu" }) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  return (
    <section className="owner-revenue-side-card">
      <h3>{title}</h3>
      {data.length === 0 ? <p className="owner-empty-cell">{emptyText}</p> : (
        <>
          <div className="owner-revenue-donut-wrap">
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2}>
                  {data.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="owner-revenue-donut-center">
              <strong>{centerValue}</strong>
              <span>{centerLabel}</span>
            </div>
          </div>
          <div className="owner-revenue-legend-list">
            {data.map((item, index) => (
              <div key={item.name} className="owner-revenue-legend-item">
                <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                <span>{item.name}</span>
                <strong>{formatCurrency(item.value)}</strong>
                <em>{formatPercentOfTotal(item.value, total)}</em>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function RevenueSideList({ title, items, footerLink }) {
  return (
    <section className="owner-revenue-side-card">
      <div className="owner-revenue-side-head">
        <h3>{title}</h3>
        {footerLink ? <Link to={footerLink.to}>{footerLink.label}</Link> : null}
      </div>
      <div className="owner-revenue-side-list">
        {items.length === 0 ? <p className="owner-empty-cell">Chưa có dữ liệu.</p> : items.map((item) => (
          <div key={item.key} className="owner-revenue-side-row">
            <div>
              <strong>{item.title}</strong>
              {item.subtitle ? <span>{item.subtitle}</span> : null}
            </div>
            {item.barPercent !== undefined ? (
              <div className="owner-revenue-side-bar">
                <em style={{ width: `${Math.max(4, item.barPercent)}%` }} />
              </div>
            ) : null}
            <b>{item.value}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

export function RevenueNotice({ title, children, tone = "info" }) {
  return (
    <div className={`owner-revenue-notice owner-revenue-notice--${tone}`}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function ExportReportButton({ rows, filename, label = "Xuất báo cáo" }) {
  return (
    <button
      type="button"
      className="owner-management-secondary"
      onClick={() => downloadCsv(filename, rows)}
    >
      <Download size={17} />
      {label}
    </button>
  );
}

export function TransactionTypeBadge({ typeMeta }) {
  const tone = typeMeta?.tone || "neutral";
  return <span className={`owner-revenue-type-badge owner-revenue-type-badge--${tone}`}>{typeMeta?.label || "Giao dịch"}</span>;
}

export function TransactionDetailModal({ transaction, onClose }) {
  if (!transaction) {
    return null;
  }

  return createPortal(
    <div className="owner-modal-backdrop" onClick={onClose}>
      <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
        <div className="owner-modal-head">
          <div>
            <h2>{transaction.id}</h2>
            <p>{formatDateTime(transaction.time)}</p>
          </div>
          <button type="button" className="owner-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="owner-detail-grid">
          <div><span>Mã booking</span><strong>{transaction.bookingCode}</strong></div>
          <div><span>Biển số</span><strong>{transaction.licensePlate || "Chưa có"}</strong></div>
          <div><span>Bãi xe</span><strong>{transaction.parkingLotName}</strong></div>
          <div><span>Phương thức</span><strong>{getMethodLabel(transaction.method)}</strong></div>
          <div><span>Gross</span><strong>{formatCurrency(transaction.gross)}</strong></div>
          <div><span>Hoa hồng</span><strong>{formatCurrency(transaction.commission)}</strong></div>
          <div><span>Owner nhận</span><strong>{formatCurrency(transaction.amount)}</strong></div>
          <div><span>Trạng thái</span><StatusBadge status={transaction.status} /></div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MissingBackendModal({ open, title, message, onClose }) {
  if (!open) {
    return null;
  }

  return createPortal(
    <div className="owner-modal-backdrop" onClick={onClose}>
      <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
        <div className="owner-modal-head">
          <div>
            <h2>{title}</h2>
            <p>Tính năng cần API backend trước khi kích hoạt đầy đủ.</p>
          </div>
          <button type="button" className="owner-modal-close" onClick={onClose}>×</button>
        </div>
        <p className="owner-modal-note">{message}</p>
        <div className="owner-modal-actions">
          <button type="button" className="owner-management-primary" onClick={onClose}>Đã hiểu</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export { CHART_COLORS };
