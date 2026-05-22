import { createElement, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Car,
  ExternalLink,
  Info,
  MoreVertical,
  PencilLine,
  QrCode,
  Search,
  SquareParking,
  X,
} from "lucide-react";

import { getEmployeeHistory, getEmployeeVehicles } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";

const DEMO_STATS = {
  totalSlots: 120,
  occupiedSlots: 86,
  availableSlots: 34,
  reservedSlots: 0,
  maintenanceSlots: 0,
  checkInToday: 156,
};

const DEMO_ACTIVITIES = [
  { id: "a1", time: "10:29", title: "Xe 51A-123.45", detail: "Vừa vào bãi - Cổng A", type: "in", badge: "Vào" },
  { id: "a2", time: "10:25", title: "Xe 30F-678.90", detail: "Vừa ra bãi - Cổng B", type: "out", badge: "Ra" },
  { id: "a3", time: "10:20", title: "Booking BK-250516-001", detail: "Quét mã QR thành công", type: "booking", badge: "Thành công" },
  { id: "a4", time: "10:15", title: "Xe 62A-456.78", detail: "Vừa vào bãi - Cổng A", type: "in", badge: "Vào" },
  { id: "a5", time: "10:10", title: "Xe 51H-987.65", detail: "Vừa ra bãi - Cổng B", type: "out", badge: "Ra" },
];

const DEMO_VEHICLES = [
  { id: "v1", plate: "51A-123.45", slot: "A12", entry: "10:29", type: "Ô tô", duration: "00:01:45", status: "parking", label: "Đang đỗ" },
  { id: "v2", plate: "62A-456.78", slot: "B05", entry: "10:15", type: "Ô tô", duration: "00:15:20", status: "parking", label: "Đang đỗ" },
  { id: "v3", plate: "59C-789.01", slot: "A07", entry: "09:51", type: "Ô tô", duration: "00:39:12", status: "parking", label: "Đang đỗ" },
  { id: "v4", plate: "30F-678.90", slot: "B02", entry: "-", type: "Ô tô", duration: "-", status: "left", label: "Đã ra" },
  { id: "v5", plate: "51H-987.65", slot: "A03", entry: "-", type: "Ô tô", duration: "-", status: "left", label: "Đã ra" },
];

const SLOT_PLATES = {
  A03: "51H-987.65",
  A07: "59C-789.01",
  A12: "51A-123.45",
  B01: "60A-222.19",
  B05: "62A-456.78",
};

const SLOT_STATUS = {
  A03: "occupied",
  A05: "reserved",
  A06: "maintenance",
  A07: "occupied",
  A12: "occupied",
  B01: "occupied",
  B02: "disabled",
  B05: "occupied",
};

function formatTime(value) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDuration(entryTime) {
  if (!entryTime) return "--";
  const start = new Date(entryTime);
  if (Number.isNaN(start.getTime())) return "--";
  const diff = Math.max(0, Date.now() - start.getTime());
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function Sparkline({ tone = "blue" }) {
  const paths = {
    green: "M2 26 C12 8, 20 28, 31 16 C42 4, 48 18, 58 10 C68 2, 75 12, 84 7",
    yellow: "M2 24 C12 14, 22 18, 31 12 C42 6, 48 22, 58 15 C68 8, 74 10, 84 5",
    purple: "M2 28 C14 26, 20 10, 32 16 C43 22, 50 4, 61 10 C70 16, 76 5, 84 8",
  };
  return (
    <svg className={`employee-modern-sparkline is-${tone}`} viewBox="0 0 86 32" aria-hidden="true">
      <path d={paths[tone] || paths.green} />
    </svg>
  );
}

function DemoQr() {
  const size = 29;
  const cells = [];
  const text = "SMART_PARKING_EMPLOYEE_DASHBOARD";
  const isFinder = (x, y, ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
  const hashAt = (x, y) => text.charCodeAt((x * 19 + y * 31) % text.length);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inTL = isFinder(x, y, 0, 0);
      const inTR = isFinder(x, y, size - 7, 0);
      const inBL = isFinder(x, y, 0, size - 7);
      let dark = false;

      if (inTL || inTR || inBL) {
        const fx = inTL ? x : inTR ? x - (size - 7) : x;
        const fy = inTL || inTR ? y : y - (size - 7);
        dark = fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
      } else {
        dark = (hashAt(x, y) + x * 5 + y * 7) % 9 < 4;
      }

      if (dark) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" rx="0.08" fill="#0f172a" />);
    }
  }

  return (
    <div className="employee-modern-qr" aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`}>
        <rect x="0" y="0" width={size} height={size} rx="2" fill="#ffffff" />
        {cells}
      </svg>
    </div>
  );
}

function StatCard({ icon: Icon, tone, label, value, subtitle, percent, sparkline }) {
  return (
    <article className="employee-modern-stat-card">
      <div className={`employee-modern-stat-icon is-${tone}`}>
        {createElement(Icon, { size: 24, strokeWidth: 2.2 })}
      </div>
      <div className="employee-modern-stat-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{subtitle}</small>
      </div>
      {percent ? <div className={`employee-modern-percent is-${tone}`}>{percent}</div> : null}
      {sparkline ? <Sparkline tone={sparkline} /> : null}
    </article>
  );
}

function QRScannerCard({ onManualScan }) {
  return (
    <section className="employee-modern-qr-card">
      <div className="employee-modern-card-heading is-dark">
        <h2>Quét mã QR</h2>
        <p>Quét để kiểm tra xe vào/ra hoặc booking</p>
      </div>

      <div className="employee-modern-scan-frame">
        <span className="employee-modern-scan-corner tl" />
        <span className="employee-modern-scan-corner tr" />
        <span className="employee-modern-scan-corner bl" />
        <span className="employee-modern-scan-corner br" />
        <DemoQr />
        <span className="employee-modern-scan-line" />
      </div>

      <div className="employee-modern-qr-helper">
        <strong>Đưa mã QR vào khung quét</strong>
        <span>hoặc</span>
      </div>

      <div className="employee-modern-manual-scan">
        <label>
          <input type="text" placeholder="Nhập mã booking" />
          <Search size={18} />
        </label>
        <button type="button" onClick={onManualScan}>
          <PencilLine size={18} />
          Quét thủ công
        </button>
      </div>
    </section>
  );
}

function ActivityIcon({ type }) {
  if (type === "out") return <ArrowUp size={18} />;
  if (type === "booking") return <QrCode size={18} />;
  return <ArrowDown size={18} />;
}

function RecentActivities({ activities, onViewAll }) {
  return (
    <section className="employee-modern-card">
      <div className="employee-modern-card-heading">
        <h2>Hoạt động gần đây</h2>
        <button type="button" onClick={onViewAll}>Xem tất cả</button>
      </div>

      <div className="employee-modern-activity-list">
        {activities.map((item) => (
          <article key={item.id} className="employee-modern-activity-item">
            <div className={`employee-modern-activity-icon is-${item.type}`}>
              <ActivityIcon type={item.type} />
            </div>
            <div>
              <time>{item.time}</time>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            <span className={`employee-modern-badge is-${item.type}`}>{item.badge}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ParkingStatusCard({ stats, onViewMap }) {
  const usedPercent = stats.totalSlots ? ((stats.occupiedSlots / stats.totalSlots) * 100).toFixed(1) : "0.0";
  const availablePercent = stats.totalSlots ? ((stats.availableSlots / stats.totalSlots) * 100).toFixed(1) : "0.0";

  return (
    <section className="employee-modern-card">
      <div className="employee-modern-card-heading">
        <h2>Trạng thái bãi xe</h2>
        <button type="button" onClick={onViewMap}>Xem sơ đồ</button>
      </div>

      <div className="employee-modern-status-body">
        <div className="employee-modern-donut" style={{ "--used-percent": `${usedPercent}%` }}>
          <div>
            <strong>{usedPercent}%</strong>
            <span>Đang sử dụng</span>
          </div>
        </div>

        <div className="employee-modern-legend-list">
          <p><i className="is-green" /><span>Đang có xe</span><strong>{stats.occupiedSlots} ({usedPercent}%)</strong></p>
          <p><i className="is-blue" /><span>Chỗ trống</span><strong>{stats.availableSlots} ({availablePercent}%)</strong></p>
          <p><i className="is-muted" /><span>Đặt trước</span><strong>{stats.reservedSlots} (0%)</strong></p>
          <p><i className="is-orange" /><span>Bảo trì</span><strong>{stats.maintenanceSlots} (0%)</strong></p>
        </div>
      </div>

      <div className="employee-modern-warning">
        <Info size={18} />
        <span>Lưu ý: Vui lòng hỗ trợ khách hàng để xe đúng vị trí quy định.</span>
      </div>
    </section>
  );
}

function VehicleTable({ vehicles, onViewAll }) {
  return (
    <section className="employee-modern-card employee-modern-table-card">
      <div className="employee-modern-card-heading">
        <h2>Danh sách xe trong bãi</h2>
        <button type="button" onClick={onViewAll}>Xem tất cả</button>
      </div>

      <div className="employee-modern-table-wrap">
        <table>
          <thead>
            <tr>
              <th>BIỂN SỐ</th>
              <th>VỊ TRÍ ĐỖ</th>
              <th>GIỜ VÀO</th>
              <th>LOẠI XE</th>
              <th>THỜI GIAN</th>
              <th>TRẠNG THÁI</th>
              <th>THAO TÁC</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <tr key={vehicle.id}>
                <td><strong>{vehicle.plate}</strong></td>
                <td>{vehicle.slot}</td>
                <td>{vehicle.entry}</td>
                <td>{vehicle.type}</td>
                <td>{vehicle.duration}</td>
                <td><span className={`employee-modern-status-pill is-${vehicle.status}`}>{vehicle.label}</span></td>
                <td>
                  <button type="button" className="employee-modern-table-action" aria-label="Mở thao tác">
                    <MoreVertical size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ParkingSlot({ code }) {
  const status = SLOT_STATUS[code] || "available";
  return (
    <button type="button" className={`employee-modern-slot is-${status}`}>
      <strong>{code}</strong>
      {status === "occupied" ? (
        <>
          <Car size={17} />
          <span>{SLOT_PLATES[code]}</span>
        </>
      ) : null}
    </button>
  );
}

function ParkingMap({ onViewFull }) {
  const rowA = Array.from({ length: 12 }, (_, index) => `A${String(index + 1).padStart(2, "0")}`);
  const rowB = Array.from({ length: 6 }, (_, index) => `B${String(index + 1).padStart(2, "0")}`);

  return (
    <section className="employee-modern-card employee-modern-map-card">
      <div className="employee-modern-card-heading">
        <h2>Sơ đồ bãi xe</h2>
        <button type="button" onClick={onViewFull}>
          Xem full
          <ExternalLink size={16} />
        </button>
      </div>

      <div className="employee-modern-map-legend">
        <span><i className="is-available" />Trống</span>
        <span><i className="is-occupied" />Đang đỗ</span>
        <span><i className="is-reserved" />Đặt trước</span>
        <span><i className="is-maintenance" />Bảo trì</span>
      </div>

      <div className="employee-modern-gates">
        <span className="is-in"><ArrowDown size={16} />CỔNG A</span>
        <span className="is-out"><ArrowUp size={16} />CỔNG B</span>
      </div>

      <div className="employee-modern-parking-map">
        <div className="employee-modern-map-row">
          <small>Row A</small>
          <div>{rowA.map((slot) => <ParkingSlot key={slot} code={slot} />)}</div>
        </div>
        <div className="employee-modern-map-row">
          <small>Row B</small>
          <div>{rowB.map((slot) => <ParkingSlot key={slot} code={slot} />)}</div>
        </div>
      </div>

      <p className="employee-modern-map-note">Chạm vào ô để xem chi tiết vị trí</p>
    </section>
  );
}

function NotificationBar() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <section className="employee-modern-notification">
      <div>
        <span><Info size={18} /></span>
        <div>
          <strong>Thông báo</strong>
          <p>Hệ thống sẽ bảo trì lúc 23:00 hôm nay. Vui lòng lưu ý hỗ trợ khách hàng.</p>
        </div>
      </div>
      <div>
        <time>10 phút trước</time>
        <button type="button" onClick={() => setVisible(false)} aria-label="Đóng thông báo">
          <X size={18} />
        </button>
      </div>
    </section>
  );
}

function normalizeActivity(item, index) {
  const isOut = item.action === "check_out";
  const isBooking = item.action === "resolve_booking";
  return {
    id: item.id || `api-${index}`,
    time: formatTime(item.created_at),
    title: item.plate_number ? `Xe ${item.plate_number}` : item.booking_code ? `Booking ${item.booking_code}` : "Hoạt động bãi xe",
    detail: item.detail || (isOut ? "Vừa ra bãi - Cổng B" : isBooking ? "Quét mã QR thành công" : "Vừa vào bãi - Cổng A"),
    type: isOut ? "out" : isBooking ? "booking" : "in",
    badge: isOut ? "Ra" : isBooking ? "Thành công" : "Vào",
  };
}

function normalizeVehicle(vehicle, index) {
  const active = !["checked_out", "completed", "left"].includes(String(vehicle.status || "").toLowerCase());
  return {
    id: vehicle.id || `vehicle-${index}`,
    plate: vehicle.plate_number || vehicle.license_plate || vehicle.vehicle_plate || DEMO_VEHICLES[index % DEMO_VEHICLES.length].plate,
    slot: vehicle.slot_code || vehicle.slot_number || DEMO_VEHICLES[index % DEMO_VEHICLES.length].slot,
    entry: active ? formatTime(vehicle.entry_time || vehicle.checkin_time || vehicle.start_time) : "-",
    type: vehicle.vehicle_type || "Ô tô",
    duration: active ? formatDuration(vehicle.entry_time || vehicle.checkin_time || vehicle.start_time) : "-",
    status: active ? "parking" : "left",
    label: active ? "Đang đỗ" : "Đã ra",
  };
}

export default function EmployeeDashboard() {
  const { revenue, slotsOverview } = useEmployeeContext();
  const navigate = useNavigate();
  const [historyData, setHistoryData] = useState({ history: [] });
  const [vehiclesData, setVehiclesData] = useState({ vehicles: [] });

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      const [historyRes, vehiclesRes] = await Promise.allSettled([
        getEmployeeHistory({ limit: 5 }),
        getEmployeeVehicles(),
      ]);

      if (!mounted) return;
      setHistoryData(historyRes.status === "fulfilled" ? historyRes.value : { history: [] });
      setVehiclesData(vehiclesRes.status === "fulfilled" ? vehiclesRes.value : { vehicles: [] });
    };

    loadData();
    const timer = window.setInterval(loadData, 20000);
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
    const maintenance = Number(slotsOverview?.maintenance_slots || 0);
    const checkIns = (revenue?.trafficByHour || []).reduce((sum, item) => sum + Number(item.check_ins || 0), 0);

    if (!total) return DEMO_STATS;
    return {
      totalSlots: total,
      occupiedSlots: inUse + reserved || DEMO_STATS.occupiedSlots,
      availableSlots: available || DEMO_STATS.availableSlots,
      reservedSlots: reserved,
      maintenanceSlots: maintenance,
      checkInToday: checkIns || DEMO_STATS.checkInToday,
    };
  }, [revenue?.trafficByHour, slotsOverview]);

  const activities = useMemo(() => {
    const rows = Array.isArray(historyData?.history) ? historyData.history : [];
    return rows.length ? rows.slice(0, 5).map(normalizeActivity) : DEMO_ACTIVITIES;
  }, [historyData]);

  const vehicles = useMemo(() => {
    const rows = Array.isArray(vehiclesData?.vehicles) ? vehiclesData.vehicles : [];
    return rows.length ? rows.slice(0, 5).map(normalizeVehicle) : DEMO_VEHICLES;
  }, [vehiclesData]);

  const occupiedPercent = stats.totalSlots ? `${((stats.occupiedSlots / stats.totalSlots) * 100).toFixed(1)}%` : "0%";
  const availablePercent = stats.totalSlots ? `${((stats.availableSlots / stats.totalSlots) * 100).toFixed(1)}%` : "0%";

  return (
    <div className="employee-modern-dashboard">
      <section className="employee-modern-stats-grid">
        <StatCard icon={SquareParking} tone="blue" label="Tổng chỗ đỗ" value={stats.totalSlots} subtitle="Sức chứa toàn bãi" />
        <StatCard icon={Car} tone="green" label="Đang có xe" value={stats.occupiedSlots} subtitle="Công suất hiện tại" percent={occupiedPercent} sparkline="green" />
        <StatCard icon={Car} tone="yellow" label="Chỗ trống" value={stats.availableSlots} subtitle="Có thể nhận khách" percent={availablePercent} sparkline="yellow" />
        <StatCard icon={Activity} tone="purple" label="Check-in hôm nay" value={stats.checkInToday} subtitle="+12.5% so với hôm qua" sparkline="purple" />
      </section>

      <section className="employee-modern-top-grid">
        <QRScannerCard onManualScan={() => navigate("/employee/scanner")} />
        <RecentActivities activities={activities} onViewAll={() => navigate("/employee/history")} />
        <ParkingStatusCard stats={stats} onViewMap={() => navigate("/employee/vehicles")} />
      </section>

      <section className="employee-modern-bottom-grid">
        <VehicleTable vehicles={vehicles} onViewAll={() => navigate("/employee/vehicles")} />
        <ParkingMap onViewFull={() => navigate("/employee/vehicles")} />
      </section>

      <NotificationBar />
    </div>
  );
}
