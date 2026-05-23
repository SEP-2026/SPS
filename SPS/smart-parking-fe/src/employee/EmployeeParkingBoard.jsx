import { useEffect, useMemo, useState } from "react";
import "../pages/Home.css";

function formatStatusLabel(status) {
  const mapping = {
    available: "Trống",
    reserved: "Đang đỗ",
    in_use: "Đang đỗ",
    occupied: "Đang đỗ",
    maintenance: "Bảo trì",
  };
  return mapping[status] || "Trống";
}

function formatServiceLabel(mode) {
  const mapping = {
    hourly: "Theo giờ",
    daily: "Theo ngày",
    monthly: "Theo tháng",
  };
  return mapping[String(mode || "").toLowerCase()] || "Không rõ";
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("vi-VN");
}

function resolveBookingId(slot) {
  if (slot?.booking_id) return Number(slot.booking_id);
  const bookingCode = String(slot?.booking_code || "");
  const match = bookingCode.match(/BK-(\d+)/i);
  return match ? Number(match[1]) : null;
}

function isOverdue(slot) {
  if (!slot?.check_out_time) return false;
  const expected = new Date(slot.check_out_time);
  if (Number.isNaN(expected.getTime())) return false;
  return expected.getTime() <= Date.now();
}

export default function EmployeeParkingBoard({ slotsOverview, title = "Sơ đồ bãi xe", onManualCheckout }) {
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutError, setCheckoutError] = useState("");

  const slots = useMemo(() => (Array.isArray(slotsOverview?.slots) ? slotsOverview.slots : []), [slotsOverview?.slots]);
  const total = Number(slotsOverview?.total_slots || 0);
  const available = Number(slotsOverview?.available_slots || 0);
  const occupied = Number(slotsOverview?.in_use_slots || 0) + Number(slotsOverview?.reserved_slots || 0);

  const normalizedSlots = useMemo(
    () =>
      slots.map((slot) => ({
        ...slot,
        clickable: slot.status === "occupied" || slot.status === "in_use" || slot.status === "reserved",
      })),
    [slots],
  );

  const selectedVehicleSlot = useMemo(
    () => normalizedSlots.find((slot) => slot.id === selectedSlotId) || null,
    [normalizedSlots, selectedSlotId],
  );

  useEffect(() => {
    if (!selectedVehicleSlot) return;
    const stillVisible = normalizedSlots.some((slot) => slot.id === selectedSlotId);
    if (!stillVisible) {
      setSelectedSlotId(null);
    }
  }, [normalizedSlots, selectedSlotId, selectedVehicleSlot]);

  useEffect(() => {
    setCheckoutMessage("");
    setCheckoutError("");
    setPaymentMethod("cash");
    setCheckoutLoading(false);
  }, [selectedSlotId]);

  const bookingStatus = String(selectedVehicleSlot?.booking_status || "").toLowerCase();
  const canManualCheckout = Boolean(
    selectedVehicleSlot
      && selectedVehicleSlot.clickable
      && resolveBookingId(selectedVehicleSlot)
      && ["checked_in", "in_progress", "booked", "pending"].includes(bookingStatus),
  );
  const slotIsOverdue = isOverdue(selectedVehicleSlot);

  const handleManualCheckout = async () => {
    if (!canManualCheckout || !onManualCheckout) return;

    const bookingId = resolveBookingId(selectedVehicleSlot);
    const confirmText = slotIsOverdue
      ? `Xác nhận checkout quá giờ cho booking BK-${bookingId}?`
      : `Xác nhận checkout thủ công cho booking BK-${bookingId}?`;

    if (!window.confirm(confirmText)) return;

    setCheckoutLoading(true);
    setCheckoutError("");
    setCheckoutMessage("");

    try {
      const result = await onManualCheckout(selectedVehicleSlot, paymentMethod);
      const extraFee = Number(result?.payment_preview?.extra_fee || result?.booking?.payment?.overtime_fee || 0);
      setCheckoutMessage(
        extraFee > 0
          ? `Checkout thành công. Phí phát sinh: ${extraFee.toLocaleString("vi-VN")}đ.`
          : "Checkout thành công.",
      );
      setSelectedSlotId(null);
    } catch (error) {
      setCheckoutError(error?.response?.data?.detail || error?.message || "Không thể checkout lúc này.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <section className="parking-lot-card employee-parking-board">
      <div className="parking-lot-head employee-parking-board-head">
        <div>
          <h2 className="parking-lot-name">{slotsOverview?.parking_name || title}</h2>
          <p className="parking-lot-address">{title}</p>
          <p className="employee-note employee-board-hint">Nhấn vào ô có xe để xem thông tin chi tiết.</p>
        </div>
        <div className="parking-lot-stats">
          <span className="stat-chip stat-available">Trống: {available}</span>
          <span className="stat-chip stat-occupied">Đang đỗ: {occupied}</span>
          <span className="stat-chip stat-total">Tổng: {total}</span>
        </div>
      </div>

      <div className="parking-grid">
        {normalizedSlots.map((slot) => {
          const isAvailable = slot.status === "available";
          const cardClass = `slot-card slot-card--${slot.status || "available"}${slot.clickable ? " employee-slot-card--interactive" : " employee-slot-card--static"}`;

          return (
            <article
              key={slot.id}
              className={cardClass}
              role={slot.clickable ? "button" : undefined}
              tabIndex={slot.clickable ? 0 : undefined}
              onClick={() => {
                if (!slot.clickable) return;
                setSelectedSlotId(slot.id);
              }}
              onKeyDown={(event) => {
                if (!slot.clickable) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedSlotId(slot.id);
                }
              }}
            >
              <div className="slot-lane" />
              <div className={`slot-car ${isAvailable ? "slot-available" : "slot-occupied"}`}>
                <img
                  src={isAvailable ? "/car-top-view2.png" : "/car-top-view.png"}
                  alt={isAvailable ? "Vị trí trống" : "Vị trí đã có xe"}
                  className="car-image"
                />
              </div>
              <div className="slot-badge">
                {slot.code} - {formatStatusLabel(slot.status)}
              </div>
            </article>
          );
        })}
      </div>

      {selectedVehicleSlot ? (
        <div className="employee-vehicle-modal-backdrop" onClick={() => setSelectedSlotId(null)}>
          <div className="employee-vehicle-modal" onClick={(event) => event.stopPropagation()}>
            <div className="employee-vehicle-modal-head">
              <h3>Thông tin xe tại ô {selectedVehicleSlot.code}</h3>
              <button type="button" className="employee-vehicle-modal-close" onClick={() => setSelectedSlotId(null)}>
                ×
              </button>
            </div>
            <div className="employee-vehicle-modal-body">
              <p>
                <strong>Tên chủ xe:</strong> {selectedVehicleSlot.owner_name || "--"}
              </p>
              <p>
                <strong>Biển số xe:</strong> {selectedVehicleSlot.vehicle_plate || "--"}
              </p>
              <p>
                <strong>Số điện thoại:</strong> {selectedVehicleSlot.owner_phone || "--"}
              </p>
              <p>
                <strong>Dịch vụ khách chọn:</strong> {formatServiceLabel(selectedVehicleSlot.booking_mode)}
              </p>
              <p>
                <strong>Giờ vào:</strong> {formatDateTime(selectedVehicleSlot.check_in_time)}
              </p>
              <p>
                <strong>Giờ ra dự kiến:</strong> {formatDateTime(selectedVehicleSlot.check_out_time)}
              </p>
              <p>
                <strong>Trạng thái booking:</strong> {selectedVehicleSlot.booking_status || "--"}
              </p>

              {canManualCheckout ? (
                <div className="employee-manual-checkout-box">
                  <p className={`employee-manual-checkout-tag ${slotIsOverdue ? "is-overdue" : ""}`}>
                    {slotIsOverdue ? "Đã quá giờ: có thể checkout và tính phí phát sinh." : "Chưa quá giờ: vẫn có thể checkout thủ công."}
                  </p>
                  <div className="employee-manual-checkout-row">
                    <select
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                      disabled={checkoutLoading}
                    >
                      <option value="cash">Tiền mặt</option>
                      <option value="bank_transfer">Chuyển khoản</option>
                      <option value="qr">QR</option>
                      <option value="vnpay">VNPay</option>
                    </select>
                    <button
                      type="button"
                      className="employee-btn"
                      onClick={handleManualCheckout}
                      disabled={checkoutLoading}
                    >
                      {checkoutLoading ? "Đang checkout..." : slotIsOverdue ? "Checkout quá giờ" : "Checkout thủ công"}
                    </button>
                  </div>
                  {checkoutMessage ? <p className="employee-manual-checkout-message is-success">{checkoutMessage}</p> : null}
                  {checkoutError ? <p className="employee-manual-checkout-message is-error">{checkoutError}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
