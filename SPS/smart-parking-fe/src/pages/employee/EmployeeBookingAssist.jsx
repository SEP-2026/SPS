import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../../services/api";

const EMPTY_FORM = {
  userId: "",
  slotId: "",
  startTime: "",
  expireTime: "",
  bookingMode: "hourly",
};

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

export default function EmployeeBookingAssist() {
  const [customers, setCustomers] = useState([]);
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const selectedCustomer = useMemo(
    () => customers.find((item) => String(item.id) === String(form.userId)) || null,
    [customers, form.userId],
  );

  const selectedSlot = useMemo(
    () => slots.find((item) => String(item.id) === String(form.slotId)) || null,
    [slots, form.slotId],
  );

  const estimatedAmount = useMemo(() => {
    if (!form.startTime || !form.expireTime) return 0;
    const start = new Date(form.startTime);
    const end = new Date(form.expireTime);
    const hours = Math.max((end - start) / (1000 * 60 * 60), 0);
    if (hours <= 0) return 0;
    const hourly = 5000;
    if (form.bookingMode === "monthly") return Math.max(Math.ceil(hours / (24 * 30)), 1) * 1500000;
    if (form.bookingMode === "daily") return Math.max(Math.ceil(hours / 24), 1) * 70000;
    return Math.max(hours, 1) * hourly;
  }, [form.startTime, form.expireTime, form.bookingMode]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [customersRes, slotsRes] = await Promise.all([
        API.get("/api/employee/customers-list"),
        API.get("/api/employee/slots-overview"),
      ]);

      setCustomers(Array.isArray(customersRes.data) ? customersRes.data : []);

      const rawSlots = Array.isArray(slotsRes.data?.slots) ? slotsRes.data.slots : [];
      setSlots(rawSlots.filter((slot) => slot.status === "available"));
    } catch (error) {
      setMessage(error?.response?.data?.detail || "Không tải được dữ liệu đặt chỗ giúp khách");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!form.userId || !form.slotId || !form.startTime || !form.expireTime) {
      setMessage("Vui lòng điền đầy đủ thông tin.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const payload = {
        user_id: Number(form.userId),
        slot_id: Number(form.slotId),
        start_time: new Date(form.startTime).toISOString(),
        expire_time: new Date(form.expireTime).toISOString(),
        booking_mode: form.bookingMode,
      };
      const res = await API.post("/api/employee/booking-assist", payload);
      setMessage(`Tạo đặt chỗ thành công. Mã booking: #${res.data.booking_id}.`);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (error) {
      setMessage(error?.response?.data?.detail || "Không thể tạo đặt chỗ");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="employee-card employee-section-shell">
      <div className="employee-section-headline">
        <h2>Đặt chỗ giúp khách</h2>
        <span className="employee-chip">Nhân viên tạo booking trực tiếp</span>
      </div>

      {message ? <p className="employee-note">{message}</p> : null}

      <form className="employee-form-grid" onSubmit={onSubmit}>
        <label>
          <span>Khách hàng</span>
          <select className="employee-input" value={form.userId} onChange={(e) => setForm((p) => ({ ...p, userId: e.target.value }))} required>
            <option value="">-- Chọn khách hàng --</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} {customer.phone ? `- ${customer.phone}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Chỗ đỗ trống</span>
          <select className="employee-input" value={form.slotId} onChange={(e) => setForm((p) => ({ ...p, slotId: e.target.value }))} required>
            <option value="">-- Chọn chỗ đỗ --</option>
            {slots.map((slot) => (
              <option key={slot.id} value={slot.id}>{slot.code}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Bắt đầu</span>
          <input className="employee-input" type="datetime-local" value={form.startTime} onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))} required />
        </label>

        <label>
          <span>Kết thúc</span>
          <input className="employee-input" type="datetime-local" value={form.expireTime} onChange={(e) => setForm((p) => ({ ...p, expireTime: e.target.value }))} required />
        </label>

        <label>
          <span>Loại đặt chỗ</span>
          <select className="employee-input" value={form.bookingMode} onChange={(e) => setForm((p) => ({ ...p, bookingMode: e.target.value }))}>
            <option value="hourly">Theo giờ</option>
            <option value="daily">Theo ngày</option>
            <option value="monthly">Theo tháng</option>
          </select>
        </label>

        <div>
          <span>Ước tính</span>
          <p className="employee-stat-value">{formatCurrency(estimatedAmount)}đ</p>
          {selectedCustomer ? <p className="employee-note">Khách: {selectedCustomer.name}</p> : null}
          {selectedSlot ? <p className="employee-note">Chỗ: {selectedSlot.code}</p> : null}
        </div>

        <div className="employee-action-row" style={{ gridColumn: "1 / -1" }}>
          <button type="submit" className="employee-btn" disabled={loading || submitting}>
            {submitting ? "Đang tạo..." : "Tạo đặt chỗ"}
          </button>
        </div>
      </form>
    </section>
  );
}
