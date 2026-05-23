import { createElement, useCallback, useEffect, useMemo, useState } from "react";
import { Car, Clock, Search, SquareParking } from "lucide-react";

import EmployeeParkingBoard from "../../employee/EmployeeParkingBoard";
import { employeeCheckOut, getEmployeeVehicles } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "parked", label: "Đang đỗ" },
  { value: "available", label: "Trống" },
];

const PARKED_SLOT_STATUSES = ["occupied", "in_use", "reserved"];
const AVAILABLE_SLOT_STATUSES = ["available", "maintenance"];

function createVehicleSearchText(vehicle) {
  return `${vehicle.license_plate || ""} ${vehicle.slot_code || ""} BK-${vehicle.booking_id}`.toLowerCase();
}

function resolveBookingIdFromSlot(slot) {
  if (slot?.booking_id) return Number(slot.booking_id);
  const bookingCode = String(slot?.booking_code || "");
  const match = bookingCode.match(/BK-(\d+)/i);
  return match ? Number(match[1]) : null;
}

function VehicleKpi({ icon: Icon, label, value, tone = "blue" }) {
  return (
    <article className={`employee-vehicle-kpi is-${tone}`}>
      <span>
        {createElement(Icon, { size: 20 })}
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

export default function EmployeeVehicles() {
  const { slotsOverview, refreshEmployee } = useEmployeeContext();
  const [data, setData] = useState({ vehicles: [], total_count: 0 });
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const occupiedOrReserved = (slotsOverview?.in_use_slots || 0) + (slotsOverview?.reserved_slots || 0);

  const refreshVehicles = useCallback(async () => {
    const res = await getEmployeeVehicles();
    setData(res);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadVehicles = () => refreshVehicles().catch(() => {
      if (mounted) {
        setData({ vehicles: [], total_count: 0 });
      }
    });
    const initialTimerId = window.setTimeout(loadVehicles, 0);

    const timerId = window.setInterval(() => {
      loadVehicles().catch(() => null);
    }, 20000);

    return () => {
      mounted = false;
      window.clearTimeout(initialTimerId);
      window.clearInterval(timerId);
    };
  }, [refreshVehicles]);

  const handleManualCheckout = useCallback(
    async (slot, paymentMethod = "cash") => {
      const bookingId = resolveBookingIdFromSlot(slot);
      if (!bookingId) {
        throw new Error("Không xác định được mã booking của ô này.");
      }

      const res = await employeeCheckOut({
        qr_data: String(bookingId),
        payment_method: paymentMethod,
      });

      await Promise.all([refreshVehicles(), refreshEmployee()]);

      return res;
    },
    [refreshEmployee, refreshVehicles],
  );

  const latestCheckIn = useMemo(() => {
    const first = data.vehicles?.[0];
    return first?.check_in_time ? new Date(first.check_in_time).toLocaleString("vi-VN") : "--";
  }, [data.vehicles]);

  const normalizedQuery = query.trim().toLowerCase();

  const boardSlotsOverview = useMemo(() => {
    const slots = Array.isArray(slotsOverview?.slots) ? slotsOverview.slots : [];
    if (!slots.length) return slotsOverview;

    const vehiclesBySlot = new Map();
    (data.vehicles || []).forEach((vehicle) => {
      const slotCode = String(vehicle.slot_code || "").toLowerCase();
      if (!slotCode) return;
      const list = vehiclesBySlot.get(slotCode) || [];
      list.push(vehicle);
      vehiclesBySlot.set(slotCode, list);
    });

    const getStatusOk = (slot) => {
      if (statusFilter === "parked") return PARKED_SLOT_STATUSES.includes(slot.status);
      if (statusFilter === "available") return AVAILABLE_SLOT_STATUSES.includes(slot.status);
      return true;
    };

    const getQueryOk = (slot) => {
      if (!normalizedQuery) return true;
      const code = String(slot.code || "").toLowerCase();
      if (code.includes(normalizedQuery)) return true;
      const relatedVehicles = vehiclesBySlot.get(code) || [];
      return relatedVehicles.some((vehicle) => createVehicleSearchText(vehicle).includes(normalizedQuery));
    };

    const filteredSlots = slots.filter((slot) => getStatusOk(slot) && getQueryOk(slot));

    const availableCount = filteredSlots.filter((slot) => slot.status === "available" || slot.status === "maintenance").length;
    const reservedCount = filteredSlots.filter((slot) => slot.status === "reserved").length;
    const inUseCount = filteredSlots.filter((slot) => slot.status === "in_use" || slot.status === "occupied").length;

    return {
      ...slotsOverview,
      slots: filteredSlots,
      total_slots: filteredSlots.length,
      available_slots: availableCount,
      reserved_slots: reservedCount,
      in_use_slots: inUseCount,
      maintenance_slots: filteredSlots.filter((slot) => slot.status === "maintenance").length,
    };
  }, [data.vehicles, normalizedQuery, slotsOverview, statusFilter]);

  return (
    <section className="employee-workspace-page employee-vehicles-page">
      <div className="employee-page-toolbar employee-filter-bar employee-vehicles-toolbar">
        <label className="employee-search-wrap">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm biển số, vị trí hoặc mã booking..."
          />
        </label>
        <div className="employee-filter-wrap">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        <div className="employee-filter-wrap">
          <select defaultValue="all" aria-label="Loại xe">
            <option value="all">Tất cả loại xe</option>
            <option value="car">Ô tô</option>
            <option value="motorbike">Xe máy</option>
          </select>
        </div>
        <span className="employee-filter-count">Tổng xe hiện tại: {occupiedOrReserved}</span>
      </div>

      <div className="employee-page-kpis employee-vehicle-kpi-grid">
        <VehicleKpi icon={Car} tone="green" label="Số xe giữ/đang đỗ" value={occupiedOrReserved} />
        <VehicleKpi icon={SquareParking} tone="blue" label="Vị trí trống" value={slotsOverview?.available_slots || 0} />
        <VehicleKpi icon={SquareParking} tone="purple" label="Vị trí đã dùng/giữ" value={(slotsOverview?.in_use_slots || 0) + (slotsOverview?.reserved_slots || 0)} />
        <VehicleKpi icon={Clock} tone="orange" label="Check-in gần nhất" value={latestCheckIn} />
      </div>

      <div className="employee-page-body">
      {boardSlotsOverview?.slots?.length ? (
        <EmployeeParkingBoard
          slotsOverview={boardSlotsOverview}
          title="Sơ đồ bãi đồng bộ với trang user"
          onManualCheckout={handleManualCheckout}
        />
      ) : (
        <div className="employee-empty-state">
          <h3>Không có ô phù hợp bộ lọc</h3>
          <p>Hãy thử đổi trạng thái lọc hoặc từ khóa tìm kiếm để xem dữ liệu.</p>
        </div>
      )}
      </div>
    </section>
  );
}
