import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getEmployeeHistory, getEmployeeVehicles } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";

const ACTION_TAG = {
  check_in: "Vào",
  check_out: "Ra",
  resolve_booking: "Thành công",
  parking_status_updated: "Cập nhật",
  employee_created: "Tạo",
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
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function Donut({ occupied, total }) {
  const safeTotal = Math.max(Number(total || 0), 1);
  const percent = Math.round((Number(occupied || 0) / safeTotal) * 1000) / 10;
  return (
    <div className="emp26-donut" style={{ background: `conic-gradient(#22c55e 0 ${percent}%, #2563eb ${percent}% 100%)` }}>
      <div className="emp26-donut-inner">
        <strong>{percent}%</strong>
        <span>Đang sử dụng</span>
      </div>
    </div>
  );
}

function KpiIcon({ tone, text }) {
  return <span className={`emp-ref-kpi-icon employee-stat-icon is-${tone}`}>{text}</span>;
}

function DemoQr() {
  const size = 29;
  const cells = [];
  const text = "SMART_PARKING_CHECKIN_CHECKOUT_DEMO";
  const hashAt = (x, y) => {
    const idx = (x * 17 + y * 31) % text.length;
    return text.charCodeAt(idx);
  };
  const isFinder = (x, y, ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inTL = isFinder(x, y, 0, 0);
      const inTR = isFinder(x, y, size - 7, 0);
      const inBL = isFinder(x, y, 0, size - 7);

      let dark = false;
      if (inTL || inTR || inBL) {
        const fx = inTL ? x : (inTR ? x - (size - 7) : x);
        const fy = inTL ? y : (inTR ? y : y - (size - 7));
        dark = fx === 0 || fx === 6 || fy === 0 || fy === 6 || ((fx >= 2 && fx <= 4) && (fy >= 2 && fy <= 4));
      } else {
        dark = ((hashAt(x, y) + x * 3 + y * 5) % 7) < 3;
      }

      if (dark) {
        cells.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0b1220" />);
      }
    }
  }

  return (
    <div className="employee-demo-qr" aria-hidden="true">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Demo QR check-in check-out">
        <rect x="0" y="0" width={size} height={size} fill="#ffffff" />
        {cells}
      </svg>
    </div>
  );
}

export default function EmployeeDashboard() {
  const { parkingLot, revenue, slotsOverview, loading } = useEmployeeContext();
  const navigate = useNavigate();
  const [historyData, setHistoryData] = useState({ history: [], total_count: 0 });
  const [vehiclesData, setVehiclesData] = useState({ vehicles: [] });

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      const [historyRes, vehiclesRes] = await Promise.allSettled([
        getEmployeeHistory({ limit: 5 }),
        getEmployeeVehicles(),
      ]);

      if (!mounted) return;
      setHistoryData(historyRes.status === "fulfilled" ? historyRes.value : { history: [], total_count: 0 });
      setVehiclesData(vehiclesRes.status === "fulfilled" ? vehiclesRes.value : { vehicles: [] });
    };

    loadData();
    const timer = window.setInterval(loadData, 20000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const totalSlots = Number(parkingLot?.totalSlots || 0);
  const inUseSlots = Number(slotsOverview?.in_use_slots || 0);
  const reservedSlots = Number(slotsOverview?.reserved_slots || 0);
  const occupiedSlots = inUseSlots + reservedSlots;
  const availableSlots = Number(slotsOverview?.available_slots || 0);
  const maintenanceSlots = Number(slotsOverview?.maintenance_slots || 0);
  const checkInToday = (revenue?.trafficByHour || []).reduce((sum, i) => sum + Number(i.check_ins || 0), 0);

  const zones = useMemo(() => {
    const grouped = new Map();
    const slots = Array.isArray(slotsOverview?.slots) ? slotsOverview.slots : [];
    slots.forEach((slot) => {
      const zone = slot?.zone || "Khu";
      if (!grouped.has(zone)) grouped.set(zone, []);
      grouped.get(zone).push(slot);
    });
    return Array.from(grouped.entries()).map(([zone, items]) => ({ zone, items: items.slice(0, 6) }));
  }, [slotsOverview]);

  const parkedVehicles = useMemo(() => {
    const list = Array.isArray(vehiclesData?.vehicles) ? vehiclesData.vehicles : [];
    return list.slice(0, 6);
  }, [vehiclesData]);

  return (
    <div className="emp26-dashboard exact-dashboard employee-dashboard-content">
      <section className="employee-grid employee-stats-grid employee-stats-grid--4">
        <article className="employee-card emp26-kpi-card employee-stat-card">
          <KpiIcon tone="blue" text="P" />
          <div>
            <div className="employee-stat-label">Tổng chỗ đỗ</div>
            <div className="employee-stat-value">{loading ? "..." : totalSlots}</div>
            <div className="employee-stat-sub">Sức chứa toàn bãi</div>
          </div>
        </article>
        <article className="employee-card emp26-kpi-card employee-stat-card has-sparkline">
          <KpiIcon tone="green" text="🚗" />
          <div>
            <div className="employee-stat-label">Đang có xe</div>
            <div className="employee-stat-value">{loading ? "..." : occupiedSlots}</div>
            <div className="employee-stat-sub">{totalSlots ? `${((occupiedSlots / totalSlots) * 100).toFixed(1)}% công suất` : "0% công suất"}</div>
          </div>
          <span className="employee-stat-sparkline is-green" />
        </article>
        <article className="employee-card emp26-kpi-card employee-stat-card has-sparkline">
          <KpiIcon tone="yellow" text="🚘" />
          <div>
            <div className="employee-stat-label">Chỗ trống</div>
            <div className="employee-stat-value">{loading ? "..." : availableSlots}</div>
            <div className="employee-stat-sub">{totalSlots ? `${((availableSlots / totalSlots) * 100).toFixed(1)}% công suất` : "0% công suất"}</div>
          </div>
          <span className="employee-stat-sparkline is-yellow" />
        </article>
        <article className="employee-card emp26-kpi-card employee-stat-card has-sparkline">
          <KpiIcon tone="purple" text="∿" />
          <div>
            <div className="employee-stat-label">Check-in hôm nay</div>
            <div className="employee-stat-value">{loading ? "..." : checkInToday}</div>
            <div className="employee-stat-sub">{Number(revenue?.totalPaidBookings || 0)} giao dịch</div>
          </div>
          <span className="employee-stat-sparkline is-purple" />
        </article>
      </section>

      <section className="employee-grid employee-middle-grid">
        <article className="employee-card employee-panel-qr employee-qr-card">
          <div className="employee-qr-header">
            <h3>Quét mã QR</h3>
            <p>Quét để kiểm tra xe vào/ra hoặc booking</p>
          </div>
          <div className="employee-qr-frame">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
            <DemoQr />
            <div className="employee-scan-line" />
          </div>
          <div className="employee-qr-helper"><div>Đưa mã QR vào khung quét</div><span>hoặc</span></div>
          <div className="employee-qr-actions"><input placeholder="Nhập mã booking" /><button type="button" className="employee-btn" onClick={() => navigate("/employee/scanner")}>Quét thủ công</button></div>
        </article>

        <article className="employee-card employee-panel-activity">
          <div className="employee-card-head"><h2>Hoạt động gần đây</h2><button type="button" className="employee-btn employee-btn--ghost" onClick={() => navigate("/employee/history")}>Xem tất cả</button></div>
          <div className="emp26-activity-list">
            {historyData.history.map((item) => (
              <article key={item.id} className="emp26-activity-item">
                <div className={`emp26-activity-dot ${item.action === "check_in" ? "is-in" : item.action === "check_out" ? "is-out" : "is-neutral"}`} />
                <div className="emp26-activity-main"><strong>{item.detail || "Giao dịch"}</strong><p>{formatTime(item.created_at)}</p></div>
                <span>{ACTION_TAG[item.action] || "--"}</span>
              </article>
            ))}
            {!historyData.history.length ? <p className="employee-note">Chưa có hoạt động gần đây.</p> : null}
          </div>
        </article>

        <article className="employee-card employee-status-card">
          <div className="employee-card-head"><h2>Trạng thái bãi xe</h2><button type="button" className="employee-btn employee-btn--ghost" onClick={() => navigate("/employee/vehicles")}>Xem sơ đồ</button></div>
          <div className="employee-status-body">
            <Donut occupied={occupiedSlots} total={totalSlots} />
            <ul className="emp26-usage-list">
              <li><span>Đang có xe</span><strong>{occupiedSlots}</strong></li>
              <li><span>Chỗ trống</span><strong>{availableSlots}</strong></li>
              <li><span>Đặt trước</span><strong>{reservedSlots}</strong></li>
              <li><span>Bảo trì</span><strong>{maintenanceSlots}</strong></li>
            </ul>
          </div>
          <div className="employee-status-note">Lưu ý: Vui lòng hỗ trợ khách hàng để xe đúng vị trí quy định.</div>
        </article>
      </section>

      <section className="employee-grid employee-bottom-grid">
        <article className="employee-card employee-vehicles-card employee-vehicle-card">
          <div className="employee-card-head employee-card-header"><h2>Danh sách xe trong bãi</h2><button type="button" className="employee-btn employee-btn--ghost" onClick={() => navigate("/employee/vehicles")}>Xem tất cả</button></div>
          <div className="employee-table-wrap">
            <table className="employee-vehicle-table">
              <thead>
                <tr>
                  <th>Biển số</th><th>Vị trí đỗ</th><th>Giờ vào</th><th>Loại xe</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {parkedVehicles.length ? parkedVehicles.slice(0, 5).map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>{vehicle.plate_number || "--"}</td>
                    <td>{vehicle.slot_code || "--"}</td>
                    <td>{formatTime(vehicle.entry_time)}</td>
                    <td>{vehicle.vehicle_type || "--"}</td>
                    <td>{formatDuration(vehicle.entry_time)}</td>
                    <td><span className={`emp26-slot-tag is-${vehicle.status || "available"}`}>{vehicle.status_label || vehicle.status || "--"}</span></td>
                    <td>...</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7} className="employee-table-empty">Chưa có xe trong bãi</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="employee-card employee-panel-map employee-parking-map-card">
          <div className="employee-card-head employee-card-header"><h2>Sơ đồ bãi xe</h2><button type="button" className="employee-btn employee-btn--ghost" onClick={() => navigate("/employee/vehicles")}>Xem full</button></div>
          <div className="emp26-map-legend"><span><i className="is-available" /> Trống</span><span><i className="is-occupied" /> Đang đỗ</span><span><i className="is-reserved" /> Đặt trước</span><span><i className="is-maintenance" /> Bảo trì</span></div>
          <div className="employee-map-content">
            {zones.slice(0, 2).map((zone, idx) => (
              <div key={zone.zone} className="employee-map-zone">
                <div className="employee-zone-label">{`Cổng ${String.fromCharCode(65 + idx)}`}</div>
                <div className="employee-slot-grid">{zone.items.map((slot) => <span key={slot.id} className={`emp26-slot-tag employee-slot is-${slot.status || "available"}`}>{slot.code}</span>)}</div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="employee-notice">
        <div className="employee-notice-main">
          <span className="employee-notice-icon">i</span>
          <div><strong>Thông báo</strong><p>Hệ thống sẽ bảo trì lúc 23:00 hôm nay. Vui lòng lưu ý hỗ trợ khách hàng.</p></div>
        </div>
        <div className="employee-notice-tail"><span>10 phút trước</span><button type="button" aria-label="Đóng">×</button></div>
      </section>
    </div>
  );
}
