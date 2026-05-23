import { createElement, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Banknote,
  CalendarPlus,
  Car,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  Info,
  QrCode,
  SquareParking,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { getEmployeeHistory } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";

function formatTime(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function formatUpdatedAt(value) {
  if (!value) return "Vừa cập nhật";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Vừa cập nhật";
  return `Cập nhật lúc ${new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date)}`;
}

function extractPlate(detail) {
  const text = String(detail || "");
  const match = text.match(/\b\d{2}[A-Z]-?\d{2,3}\.?\d{2,3}\b/i) || text.match(/Xe\s+([^\s-]+)/i);
  return match ? (match[1] || match[0]).replace(/^Xe\s+/i, "") : "--";
}

function actionLabel(action) {
  if (action === "check_out") return "Ra";
  if (action === "check_in") return "Vào";
  if (action === "resolve_booking") return "Booking";
  return "Khác";
}

function actionTone(action) {
  if (action === "check_out") return "out";
  if (action === "check_in") return "in";
  if (action === "resolve_booking") return "booking";
  return "slate";
}

function OverviewStatCard({ icon: Icon, tone, label, value, unit, delta }) {
  return (
    <article className="employee-overview-stat">
      <div className={`employee-overview-stat-icon is-${tone}`}>
        {createElement(Icon, { size: 22, strokeWidth: 2.2 })}
      </div>
      <div className="employee-overview-stat-copy">
        <span>{label}</span>
        <strong>
          {value}
          {unit ? <em>{unit}</em> : null}
        </strong>
      </div>
      {delta ? <div className={`employee-overview-stat-delta is-${tone}`}>{delta}</div> : null}
    </article>
  );
}

function UsageDonutCard({ stats, updatedAt }) {
  const usedPercentNumber = stats.totalSlots ? (stats.occupiedSlots / stats.totalSlots) * 100 : 0;
  const availablePercentNumber = stats.totalSlots ? (stats.availableSlots / stats.totalSlots) * 100 : 0;
  const usedPercent = usedPercentNumber.toFixed(1);
  const availablePercent = availablePercentNumber.toFixed(1);

  return (
    <section className="employee-overview-panel">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Tỷ lệ sử dụng bãi</h2>
        </div>
      </div>
      <div className="employee-overview-donut-wrap">
        <div className="employee-modern-donut employee-overview-donut" style={{ "--used-percent": `${usedPercent}%` }}>
          <div>
            <strong>{usedPercent}%</strong>
            <span>Đã sử dụng</span>
          </div>
        </div>
        <div className="employee-overview-legend">
          <p><i className="is-green" /><span>Đã sử dụng</span><strong>{stats.occupiedSlots} ({usedPercent}%)</strong></p>
          <p><i className="is-blue" /><span>Còn trống</span><strong>{stats.availableSlots} ({availablePercent}%)</strong></p>
        </div>
      </div>
      <small className="employee-overview-updated">{formatUpdatedAt(updatedAt)}</small>
    </section>
  );
}

function TrafficChartCard({ points }) {
  const data = Array.isArray(points) ? points : [];
  const maxValue = Math.max(
    ...data.map((item) => Math.max(Number(item.check_ins || 0), Number(item.check_outs || 0))),
    1,
  );

  return (
    <section className="employee-overview-panel">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Biểu đồ xe ra/vào</h2>
        </div>
        <button type="button" className="employee-overview-select" aria-label="Chọn khoảng thời gian">
          Hôm nay
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="employee-overview-traffic-chart">
        {data.length ? data.map((item) => {
          const inHeight = (Number(item.check_ins || 0) / maxValue) * 100;
          const outHeight = (Number(item.check_outs || 0) / maxValue) * 100;
          return (
            <div key={item.label} className="employee-overview-traffic-col">
              <div className="employee-overview-traffic-bars">
                <span className="is-in" style={{ height: `${Math.max(inHeight, 4)}%` }} title={`Vào: ${item.check_ins || 0}`} />
                <span className="is-out" style={{ height: `${Math.max(outHeight, 4)}%` }} title={`Ra: ${item.check_outs || 0}`} />
              </div>
              <small>{item.label}</small>
            </div>
          );
        }) : <p className="employee-note">Chưa có dữ liệu lưu lượng hôm nay.</p>}
      </div>
      <div className="employee-overview-traffic-legend">
        <span><i className="is-in" />Xe vào</span>
        <span><i className="is-out" />Xe ra</span>
      </div>
    </section>
  );
}

function NotificationListCard({ items, onViewAll }) {
  return (
    <section className="employee-overview-panel">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Thông báo</h2>
        </div>
        <button type="button" onClick={onViewAll}>Xem tất cả</button>
      </div>
      <div className="employee-overview-notifications">
        {items.length ? items.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.id} className={`employee-overview-notice is-${item.tone}`}>
              <span><Icon size={17} /></span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                <time>{item.time}</time>
              </div>
            </article>
          );
        }) : <p className="employee-note">Chưa có thông báo mới.</p>}
      </div>
    </section>
  );
}

function RecentTrafficTable({ rows, onViewAll }) {
  return (
    <section className="employee-overview-panel employee-overview-panel--table">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Xe ra/vào gần đây</h2>
        </div>
        <button type="button" onClick={onViewAll}>Xem tất cả</button>
      </div>
      <div className="employee-overview-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Biển số</th>
              <th>Loại xe</th>
              <th>Nhân viên</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.id}>
                <td>{row.time}</td>
                <td><span className={`employee-modern-badge is-${row.tone}`}>{row.type}</span></td>
                <td><strong>{row.plate}</strong></td>
                <td>{row.vehicleType}</td>
                <td>{row.employee}</td>
                <td>{row.action}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="employee-table-empty">Chưa có hoạt động ra/vào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TodayBookingsCard({ rows, onViewAll }) {
  return (
    <section className="employee-overview-panel employee-overview-panel--list">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Đặt chỗ hôm nay</h2>
        </div>
        <button type="button" onClick={onViewAll}>Xem tất cả</button>
      </div>
      <div className="employee-overview-booking-list">
        {rows.length ? rows.map((row) => (
          <article key={row.id}>
            <time>{row.time}</time>
            <strong>{row.plate}</strong>
            <span className={`employee-modern-status-pill is-${row.statusTone}`}>{row.status}</span>
          </article>
        )) : <p className="employee-note">Chưa có đặt chỗ hôm nay.</p>}
      </div>
    </section>
  );
}

function RevenueSummaryCard({ revenue, onViewAll }) {
  return (
    <section className="employee-overview-panel employee-overview-panel--revenue">
      <div className="employee-overview-panel-head">
        <div>
          <h2>Doanh thu</h2>
        </div>
        <button type="button" onClick={onViewAll}>Chi tiết</button>
      </div>
      <div className="employee-overview-revenue-total">
        <span>Tổng doanh thu</span>
        <strong>{formatMoney(revenue?.revenueToday)}</strong>
      </div>
      <div className="employee-overview-revenue-methods">
        <p><Wallet size={16} /><span>Tiền mặt</span><strong>--</strong></p>
        <p><Banknote size={16} /><span>Chuyển khoản</span><strong>--</strong></p>
      </div>
      <div className="employee-overview-revenue-breakdown">
        <p><span>Vé lượt</span><strong>{formatMoney(revenue?.revenueToday)}</strong></p>
        <p><span>Vé tháng</span><strong>--</strong></p>
        <p><span>Đặt chỗ</span><strong>{Number(revenue?.totalPaidBookings || 0)} vé</strong></p>
      </div>
    </section>
  );
}

function QuickActions({ onNavigate }) {
  const actions = [
    { label: "Quét QR", path: "/employee/scanner", icon: QrCode, tone: "blue" },
    { label: "Xe trong bãi", path: "/employee/vehicles", icon: Car, tone: "green" },
    { label: "Đặt chỗ giúp khách", path: "/employee/booking-assist", icon: CalendarPlus, tone: "purple" },
    { label: "Doanh thu", path: "/employee/revenue", icon: CreditCard, tone: "cyan" },
    { label: "Báo sự cố", path: "/employee/profile", icon: AlertTriangle, tone: "orange" },
    { label: "Hướng dẫn", path: "/employee/history", icon: FileText, tone: "slate" },
  ];

  return (
    <section className="employee-overview-quick">
      <h2>Thao tác nhanh</h2>
      <div className="employee-overview-quick-grid">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.label} type="button" className={`employee-overview-quick-item is-${action.tone}`} onClick={() => onNavigate(action.path)}>
              <span><Icon size={22} /></span>
              <strong>{action.label}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function normalizeNotification(item, index) {
  const action = String(item.action || "").toLowerCase();
  let tone = "info";
  let Icon = Info;
  let title = "Hoạt động hệ thống";

  if (action === "check_in") {
    tone = "success";
    Icon = CheckCircle2;
    title = `Xe ${extractPlate(item.detail)} vừa vào bãi`;
  } else if (action === "check_out") {
    tone = "warning";
    Icon = AlertTriangle;
    title = `Xe ${extractPlate(item.detail)} vừa ra bãi`;
  } else if (action === "resolve_booking") {
    tone = "info";
    Icon = QrCode;
    title = "Quét booking thành công";
  } else if (action === "parking_status_updated") {
    tone = "warning";
    Icon = AlertTriangle;
    title = "Cập nhật trạng thái bãi";
  }

  return {
    id: item.id || `notice-${index}`,
    tone,
    icon: Icon,
    title,
    detail: item.detail || "Không có mô tả",
    time: formatTime(item.created_at),
  };
}

function normalizeTrafficRow(item, index, employeeName) {
  const action = String(item.action || "").toLowerCase();
  if (!["check_in", "check_out"].includes(action)) return null;

  return {
    id: item.id || `traffic-${index}`,
    time: formatTime(item.created_at),
    type: actionLabel(action),
    tone: actionTone(action),
    plate: extractPlate(item.detail),
    vehicleType: "Ô tô",
    employee: employeeName,
    action: action === "check_out" ? "Check-out" : "Check-in",
  };
}

function normalizeBookingRow(item, index) {
  const action = String(item.action || "").toLowerCase();
  if (!["resolve_booking", "check_in"].includes(action)) return null;
  if (action === "check_in" && !/booking|BK-/i.test(String(item.detail || ""))) return null;

  return {
    id: item.id || `booking-${index}`,
    time: formatTime(item.created_at),
    plate: extractPlate(item.detail),
    status: action === "resolve_booking" ? "Đã quét" : "Đã vào",
    statusTone: action === "resolve_booking" ? "parking" : "green",
  };
}

export default function EmployeeDashboard() {
  const context = useEmployeeContext() || {};
  const { revenue = {}, slotsOverview = {}, profile = null, auth = null } = context;
  const navigate = useNavigate();
  const [historyData, setHistoryData] = useState({ history: [] });
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  const employeeName =
    profile?.employee?.full_name
    || auth?.user?.full_name
    || auth?.user?.name
    || auth?.user?.username
    || "Nhân viên";

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      const historyRes = await getEmployeeHistory({ limit: 30 });
      if (!mounted) return;
      setHistoryData(historyRes);
      setUpdatedAt(new Date());
    };

    loadData().catch(() => {
      if (mounted) setHistoryData({ history: [] });
    });
    const timer = window.setInterval(() => {
      loadData().catch(() => null);
    }, 20000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const stats = useMemo(() => {
    const total = Number(slotsOverview?.total_slots || 0);
    const inUse = Number(slotsOverview?.in_use_slots || 0);
    const reserved = Number(slotsOverview?.reserved_slots || 0);
    const available = Number(slotsOverview?.available_slots || 0);
    const traffic = Array.isArray(revenue?.trafficByHour) ? revenue.trafficByHour : [];
    const checkIns = traffic.reduce((sum, item) => sum + Number(item.check_ins || 0), 0);
    const checkOuts = traffic.reduce((sum, item) => sum + Number(item.check_outs || 0), 0);

    return {
      totalSlots: total,
      occupiedSlots: inUse + reserved,
      availableSlots: available,
      inUseSlots: inUse,
      checkInToday: checkIns,
      checkOutToday: checkOuts,
    };
  }, [revenue?.trafficByHour, slotsOverview]);

  const historyRows = Array.isArray(historyData?.history) ? historyData.history : [];

  const trafficRows = useMemo(
    () => historyRows.map((item, index) => normalizeTrafficRow(item, index, employeeName)).filter(Boolean).slice(0, 5),
    [employeeName, historyRows],
  );

  const bookingRows = useMemo(
    () => historyRows.map((item, index) => normalizeBookingRow(item, index)).filter(Boolean).slice(0, 5),
    [historyRows],
  );

  const notifications = useMemo(
    () => historyRows.slice(0, 4).map(normalizeNotification),
    [historyRows],
  );

  const occupiedPercent = stats.totalSlots
    ? `${((stats.occupiedSlots / stats.totalSlots) * 100).toFixed(1)}%`
    : null;
  const availablePercent = stats.totalSlots
    ? `${((stats.availableSlots / stats.totalSlots) * 100).toFixed(1)}%`
    : null;

  return (
    <div className="employee-overview-page employee-overview-dashboard">
      <section className="employee-overview-kpi-row">
        <OverviewStatCard icon={SquareParking} tone="blue" label="Tổng chỗ đỗ" value={stats.totalSlots} unit="chỗ" />
        <OverviewStatCard icon={SquareParking} tone="cyan" label="Chỗ trống" value={stats.availableSlots} unit="chỗ" delta={availablePercent} />
        <OverviewStatCard icon={Car} tone="green" label="Xe đang đỗ" value={stats.inUseSlots} unit="xe" delta={occupiedPercent} />
        <OverviewStatCard icon={ArrowDown} tone="purple" label="Xe vào hôm nay" value={stats.checkInToday} unit="lượt" />
        <OverviewStatCard icon={ArrowUp} tone="orange" label="Xe ra hôm nay" value={stats.checkOutToday} unit="lượt" />
        <OverviewStatCard icon={TrendingUp} tone="blue" label="Doanh thu hôm nay" value={formatMoney(revenue?.revenueToday)} />
      </section>

      <section className="employee-overview-mid-row">
        <UsageDonutCard stats={stats} updatedAt={updatedAt} />
        <TrafficChartCard points={revenue?.trafficByHour} />
        <NotificationListCard items={notifications} onViewAll={() => navigate("/employee/history")} />
      </section>

      <section className="employee-overview-bottom-row">
        <RecentTrafficTable rows={trafficRows} onViewAll={() => navigate("/employee/history")} />
        <TodayBookingsCard rows={bookingRows} onViewAll={() => navigate("/employee/booking-assist")} />
        <RevenueSummaryCard revenue={revenue} onViewAll={() => navigate("/employee/revenue")} />
      </section>

      <QuickActions onNavigate={navigate} />
    </div>
  );
}
