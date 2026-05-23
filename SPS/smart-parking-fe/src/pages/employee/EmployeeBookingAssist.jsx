import { useEffect, useMemo, useState } from "react";
import API from "../../services/api";
import { useEmployeeContext } from "../../employee/useEmployeeContext";
import "../Home.css";

const BOOKING_MODE_OPTIONS = [
  { value: "hourly", label: "Theo giờ" },
  { value: "daily", label: "Theo ngày" },
  { value: "monthly", label: "Theo tháng" },
];

function toDatetimeLocalValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

function toDateInputValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateValue(value) {
  if (!value) return null;
  const [y, m, d] = String(value).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function addMonths(date, months) {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const maxDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, maxDay));
  return result;
}

function getDefaultForm() {
  const now = new Date();
  const checkin = new Date(now.getTime() + 60 * 60 * 1000);
  const checkout = new Date(checkin.getTime() + 2 * 60 * 60 * 1000);
  const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
  return {
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    vehiclePlate: "",
    vehicleColor: "",
    vehicleBrand: "",
    vehicleModel: "",
    vehicleSeatCount: "",
    slotId: "",
    bookingMode: "hourly",
    checkinTime: toDatetimeLocalValue(checkin),
    checkoutTime: toDatetimeLocalValue(checkout),
    startDate: toDateInputValue(startDate),
    endDate: toDateInputValue(endDate),
    monthCount: "1",
  };
}

function formatCurrency(v) {
  return `${Number(v || 0).toLocaleString("vi-VN")}đ`;
}

function buildBookingWindow(form) {
  if (form.bookingMode === "hourly") {
    const checkin = new Date(form.checkinTime);
    const checkout = new Date(form.checkoutTime);
    if (Number.isNaN(checkin.getTime()) || Number.isNaN(checkout.getTime())) return { ok: false, error: "Thời gian không hợp lệ." };
    if (checkout <= checkin) return { ok: false, error: "Thời gian kết thúc phải sau thời gian bắt đầu." };
    return { ok: true, checkin, checkout, mode: "hourly" };
  }

  if (form.bookingMode === "daily") {
    const startDate = parseDateValue(form.startDate);
    const endDate = parseDateValue(form.endDate);
    if (!startDate || !endDate) return { ok: false, error: "Vui lòng chọn ngày bắt đầu và kết thúc." };
    if (endDate < startDate) return { ok: false, error: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu." };
    const checkout = new Date(endDate);
    checkout.setDate(checkout.getDate() + 1);
    return { ok: true, checkin: startDate, checkout, mode: "daily" };
  }

  const startDate = parseDateValue(form.startDate);
  const monthCount = Number(form.monthCount || 0);
  if (!startDate) return { ok: false, error: "Vui lòng chọn ngày bắt đầu gói tháng." };
  if (!Number.isInteger(monthCount) || monthCount < 1) return { ok: false, error: "Số tháng không hợp lệ." };
  return { ok: true, checkin: startDate, checkout: addMonths(startDate, monthCount), mode: "monthly", monthCount };
}

function computeEstimate(price, window) {
  if (!window.ok) return { amount: 0, billedUnits: 0, billedUnit: "" };
  const h = Math.max((window.checkout.getTime() - window.checkin.getTime()) / (1000 * 60 * 60), 0);
  if (window.mode === "monthly") {
    const units = Number(window.monthCount || 1);
    return { amount: units * Number(price.price_per_month || 0), billedUnits: units, billedUnit: "tháng" };
  }
  if (window.mode === "daily") {
    const units = Math.max(1, Math.ceil(h / 24));
    return { amount: units * Number(price.price_per_day || 0), billedUnits: units, billedUnit: "ngày" };
  }
  if (h > 12) return { amount: Number(price.price_per_day || 0), billedUnits: 1, billedUnit: "ngày" };
  const units = Math.max(1, Math.ceil(h));
  return { amount: units * Number(price.price_per_hour || 0), billedUnits: units, billedUnit: "giờ" };
}

function resolveStatusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return "Trống";
  if (s === "maintenance") return "Bảo trì";
  if (s === "reserved") return "Đã đặt";
  if (s === "in_use" || s === "occupied") return "Đang đỗ";
  return "Không rõ";
}

function resolveStatusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "available") return "slot-available";
  if (s === "maintenance") return "slot-maintenance";
  return "slot-occupied";
}

export default function EmployeeBookingAssist() {
  const context = useEmployeeContext() || {};
  const { parkingLot, slotsOverview, refreshEmployee, isParkingLocked } = context;
  const [form, setForm] = useState(getDefaultForm);
  const [price, setPrice] = useState({ price_per_hour: 0, price_per_day: 0, price_per_month: 0 });
  const [selectedMapSlotId, setSelectedMapSlotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [updatingSlot, setUpdatingSlot] = useState(false);
  const [message, setMessage] = useState("");

  const slots = useMemo(() => (Array.isArray(slotsOverview?.slots) ? slotsOverview.slots : []), [slotsOverview]);
  const selectedSlot = useMemo(() => slots.find((item) => String(item.id) === String(form.slotId)) || null, [slots, form.slotId]);
  const selectedMapSlot = useMemo(
    () => slots.find((item) => String(item.id) === String(selectedMapSlotId)) || null,
    [slots, selectedMapSlotId],
  );
  const bookingWindow = useMemo(() => buildBookingWindow(form), [form]);
  const estimate = useMemo(() => computeEstimate(price, bookingWindow), [price, bookingWindow]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        await refreshEmployee?.();
        setMessage("");
      } catch {
        setMessage("Không tải được dữ liệu bãi xe.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [refreshEmployee]);

  useEffect(() => {
    const loadParkingPrice = async () => {
      if (!parkingLot?.parking_id) return;
      try {
        const res = await API.get(`/parking-lots/${parkingLot.parking_id}`);
        setPrice({
          price_per_hour: Number(res.data?.price_per_hour || 0),
          price_per_day: Number(res.data?.price_per_day || 0),
          price_per_month: Number(res.data?.price_per_month || 0),
        });
      } catch {
        setPrice({ price_per_hour: 0, price_per_day: 0, price_per_month: 0 });
      }
    };
    loadParkingPrice();
  }, [parkingLot?.parking_id]);

  const handleSelectSlotFromMap = (slot) => {
    setSelectedMapSlotId(String(slot.id));
    if (slot.status !== "available") return;
    setForm((prev) => ({ ...prev, slotId: String(slot.id) }));
  };

  const handleUpdateSlotStatus = async (nextStatus) => {
    if (!selectedMapSlot) return;
    const currentStatus = String(selectedMapSlot.status || "").toLowerCase();
    if (!["available", "maintenance"].includes(currentStatus)) {
      setMessage("Chỉ đổi trạng thái được với ô đang trống hoặc bảo trì.");
      return;
    }
    if (currentStatus === nextStatus) return;

    setUpdatingSlot(true);
    try {
      await API.patch(`/api/employee/slots/${selectedMapSlot.id}/status`, { status: nextStatus });
      setMessage("Đã cập nhật trạng thái ô đỗ.");
      await refreshEmployee?.();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "Không thể cập nhật trạng thái ô đỗ.");
    } finally {
      setUpdatingSlot(false);
    }
  };

  const handleForceReleaseSlot = async () => {
    if (!selectedMapSlot) return;
    setUpdatingSlot(true);
    try {
      await API.patch(`/api/employee/slots/${selectedMapSlot.id}/status`, {
        status: "available",
        force_release: true,
      });
      setMessage("Đã giải phóng ô về trống do xe ra sớm.");
      await refreshEmployee?.();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "Không thể giải phóng ô lúc này.");
    } finally {
      setUpdatingSlot(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isParkingLocked) {
      setMessage("Bãi đang bị admin khóa, không thể tạo đặt chỗ.");
      return;
    }
    if (!form.slotId) {
      setMessage("Vui lòng chọn vị trí đỗ trên sơ đồ bãi xe.");
      return;
    }
    if (!bookingWindow.ok) {
      setMessage(bookingWindow.error || "Thông tin thời gian chưa hợp lệ.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const payload = {
        customer_name: form.customerName,
        customer_phone: form.customerPhone,
        customer_email: form.customerEmail || null,
        vehicle_plate: form.vehiclePlate,
        vehicle_color: form.vehicleColor || null,
        vehicle_brand: form.vehicleBrand || null,
        vehicle_model: form.vehicleModel || null,
        vehicle_seat_count: form.vehicleSeatCount ? Number(form.vehicleSeatCount) : null,
        slot_id: Number(form.slotId),
        start_time: bookingWindow.checkin.toISOString(),
        expire_time: bookingWindow.checkout.toISOString(),
        booking_mode: form.bookingMode,
      };
      const res = await API.post("/api/employee/booking-assist", payload);
      setMessage(`Tạo đặt chỗ thành công. Mã booking: #${res.data.booking_id}. Tổng tiền: ${formatCurrency(res.data.total_amount)}.`);
      setForm(getDefaultForm());
      await refreshEmployee?.();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "Không thể tạo đặt chỗ.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="employee-workspace-page employee-booking-assist-page">
      <div className="employee-page-toolbar">
        <div className="employee-filter-bar employee-booking-toolbar">
          <span className="employee-filter-count">Ô trống: {slotsOverview?.available_slots ?? 0}</span>
          <button type="button" className="employee-assist-flow-button">Nhập thông tin giống luồng user</button>
        </div>
        {message ? <p className="employee-note">{message}</p> : null}
      </div>

      <div className="employee-page-body employee-assist-layout">
        <div className="employee-assist-map-wrap">
          <div className="employee-assist-map-head">
            <h3>Sơ đồ bãi xe {parkingLot?.parking_name || ""}</h3>
            <p>Nhấn vào ô bất kỳ để xem và chỉnh trạng thái. Ô trống có thể dùng để tạo đặt chỗ.</p>
          </div>

          <div className="parking-map-legend employee-assist-legend">
            <div className="legend-item"><div className="legend-color slot-available"></div><span>Trống</span></div>
            <div className="legend-item"><div className="legend-color slot-selected"></div><span>Đang chọn</span></div>
            <div className="legend-item"><div className="legend-color slot-occupied"></div><span>Đang đỗ / Đã đặt</span></div>
            <div className="legend-item"><div className="legend-color slot-maintenance"></div><span>Bảo trì</span></div>
          </div>

          <div className="parking-map-grid employee-assist-map-grid">
            {slots.map((slot) => {
              const isSelected = String(slot.id) === String(selectedMapSlotId);
              const cls = isSelected ? "slot-selected" : resolveStatusClass(slot.status);
              const clickable = true;
              return (
                <button
                  key={slot.id}
                  type="button"
                  className={`parking-slot ${cls} ${clickable ? "is-clickable" : "is-locked"}`}
                  onClick={() => handleSelectSlotFromMap(slot)}
                  title={`${slot.code || slot.slot_number} - ${resolveStatusLabel(slot.status)}`}
                >
                  <div className="slot-code">{slot.code || slot.slot_number || `S-${slot.id}`}</div>
                  {slot.zone ? <div className="slot-zone">{slot.zone}</div> : null}
                </button>
              );
            })}
          </div>

          {selectedMapSlot ? (
            <div className="employee-assist-slot-actions">
              <p>
                <strong>Ô đang chọn:</strong> {selectedMapSlot.code || selectedMapSlot.slot_number || `S-${selectedMapSlot.id}`} - {resolveStatusLabel(selectedMapSlot.status)}
              </p>
              <div className="employee-action-row">
                <button
                  type="button"
                  className="employee-btn employee-btn--ghost"
                  disabled={updatingSlot || isParkingLocked || !["available", "maintenance"].includes(String(selectedMapSlot.status || "").toLowerCase())}
                  onClick={() => handleUpdateSlotStatus("available")}
                >
                  Đặt trạng thái Trống
                </button>
                <button
                  type="button"
                  className="employee-btn employee-btn--ghost"
                  disabled={updatingSlot || isParkingLocked || !["available", "maintenance"].includes(String(selectedMapSlot.status || "").toLowerCase())}
                  onClick={() => handleUpdateSlotStatus("maintenance")}
                >
                  Đặt trạng thái Bảo trì
                </button>
                <button
                  type="button"
                  className="employee-btn employee-btn--ghost"
                  disabled={updatingSlot || isParkingLocked || !["occupied", "in_use", "reserved"].includes(String(selectedMapSlot.status || "").toLowerCase())}
                  onClick={handleForceReleaseSlot}
                >
                  Giải phóng ô (xe ra sớm)
                </button>
              </div>
            </div>
          ) : null}

          <div className="employee-assist-note-box">
            <strong>Lưu ý vận hành</strong>
            <span>Chỉ chọn ô còn trống để tạo đặt chỗ. Các ô đang đỗ, đã đặt hoặc bảo trì không khả dụng cho booking mới.</span>
          </div>
        </div>

        <form className="employee-form-grid employee-assist-form" onSubmit={handleSubmit}>
          <div className="employee-assist-form-head employee-form-span">
            <p>Thông tin đặt chỗ cho khách</p>
            <strong>{selectedSlot?.code || selectedSlot?.slot_number || "Chưa chọn ô"}</strong>
          </div>

          <label>
            <span>Tên khách hàng</span>
            <input className="employee-input" value={form.customerName} onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))} required />
          </label>
          <label>
            <span>Số điện thoại</span>
            <input className="employee-input" value={form.customerPhone} onChange={(e) => setForm((p) => ({ ...p, customerPhone: e.target.value }))} required />
          </label>
          <label className="employee-form-span">
            <span>Email (không bắt buộc)</span>
            <input className="employee-input" type="email" value={form.customerEmail} onChange={(e) => setForm((p) => ({ ...p, customerEmail: e.target.value }))} />
          </label>

          <label>
            <span>Biển số xe</span>
            <input className="employee-input" value={form.vehiclePlate} onChange={(e) => setForm((p) => ({ ...p, vehiclePlate: e.target.value.toUpperCase() }))} required />
          </label>
          <label>
            <span>Màu xe</span>
            <input className="employee-input" value={form.vehicleColor} onChange={(e) => setForm((p) => ({ ...p, vehicleColor: e.target.value }))} />
          </label>
          <label>
            <span>Hãng xe</span>
            <input className="employee-input" value={form.vehicleBrand} onChange={(e) => setForm((p) => ({ ...p, vehicleBrand: e.target.value }))} />
          </label>
          <label>
            <span>Dòng xe</span>
            <input className="employee-input" value={form.vehicleModel} onChange={(e) => setForm((p) => ({ ...p, vehicleModel: e.target.value }))} />
          </label>
          <label>
            <span>Số chỗ</span>
            <input className="employee-input" type="number" min={1} max={100} value={form.vehicleSeatCount} onChange={(e) => setForm((p) => ({ ...p, vehicleSeatCount: e.target.value }))} />
          </label>

          <label className="employee-form-span">
            <span>Loại đặt chỗ</span>
            <div className="employee-assist-mode-row">
              {BOOKING_MODE_OPTIONS.map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  className={`employee-chip ${form.bookingMode === mode.value ? "is-active" : ""}`}
                  onClick={() => setForm((prev) => ({ ...prev, bookingMode: mode.value }))}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </label>

          {form.bookingMode === "hourly" ? (
            <>
              <label><span>Bắt đầu</span><input className="employee-input" type="datetime-local" value={form.checkinTime} onChange={(e) => setForm((p) => ({ ...p, checkinTime: e.target.value }))} required /></label>
              <label><span>Kết thúc</span><input className="employee-input" type="datetime-local" value={form.checkoutTime} onChange={(e) => setForm((p) => ({ ...p, checkoutTime: e.target.value }))} required /></label>
            </>
          ) : null}

          {form.bookingMode === "daily" ? (
            <>
              <label><span>Từ ngày</span><input className="employee-input" type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required /></label>
              <label><span>Đến ngày</span><input className="employee-input" type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} required /></label>
            </>
          ) : null}

          {form.bookingMode === "monthly" ? (
            <>
              <label><span>Bắt đầu từ ngày</span><input className="employee-input" type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} required /></label>
              <label><span>Số tháng</span><input className="employee-input" type="number" min={1} max={24} value={form.monthCount} onChange={(e) => setForm((p) => ({ ...p, monthCount: e.target.value }))} required /></label>
            </>
          ) : null}

          <div className="employee-assist-summary employee-form-span">
            <p><strong>Khách:</strong> {form.customerName || "--"}</p>
            <p><strong>SĐT:</strong> {form.customerPhone || "--"}</p>
            <p><strong>Biển số:</strong> {form.vehiclePlate || "--"}</p>
            <p><strong>Ô đỗ:</strong> {selectedSlot?.code || selectedSlot?.slot_number || "--"}</p>
            {!bookingWindow.ok ? <p className="employee-assist-error">{bookingWindow.error}</p> : <p><strong>Ước tính:</strong> {formatCurrency(estimate.amount)} ({estimate.billedUnits} {estimate.billedUnit})</p>}
          </div>

          <div className="employee-action-row employee-form-span">
            <button type="submit" className="employee-btn" disabled={loading || submitting || isParkingLocked}>
              {submitting ? "Đang tạo..." : "Xác nhận đặt chỗ"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
