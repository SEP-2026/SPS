import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../services/api";
import { formatDateTimeVN } from "../utils/dateTime";
import { formatCurrency } from "../features/gate/gateFormatters";
import { useWallet } from "../context/WalletContext";
import "./Payment.css";

const formatMoney = (value) => Number(value || 0).toLocaleString("vi-VN");
const bookingStatusLabel = (status) => {
  const normalized = String(status || "").toLowerCase();
  const map = {
    pending: "Chờ thanh toán",
    booked: "Chưa check-in",
    checked_in: "Đang gửi xe",
    checked_out: "Đã check-out",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
  };
  return map[normalized] || status || "N/A";
};

export default function Payment() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { wallet, loading: walletQueryLoading, error: walletQueryError, refreshWallet } = useWallet();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState(null);
  const [successBookingId, setSuccessBookingId] = useState(null);
  const [countdownSeconds, setCountdownSeconds] = useState(10);

  const numericBookingId = useMemo(() => Number(bookingId), [bookingId]);
  const remainingAmount = Math.max(0, Number(booking?.total_amount || 0) - Number(booking?.upfront_amount || 0));

  const refreshData = async () => {
    const bookingRes = await API.get(`/booking/my/${numericBookingId}`);
    setBooking(bookingRes.data);
  };

  useEffect(() => {
    const loadData = async () => {
      if (!Number.isInteger(numericBookingId) || numericBookingId <= 0) {
        setError("Booking ID không hợp lệ");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        await refreshData();
      } catch (err) {
        setError(err?.response?.data?.detail || "Không tải được thông tin booking");
        setBooking(null);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [numericBookingId]);

  useEffect(() => {
    if (!successBookingId) {
      return undefined;
    }

    setCountdownSeconds(10);
    const intervalId = window.setInterval(() => {
      setCountdownSeconds((value) => Math.max(value - 1, 0));
    }, 1000);
    const timer = window.setTimeout(() => {
      navigate("/booking-history", { replace: true });
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timer);
    };
  }, [navigate, successBookingId]);

  const goToBookingHistory = () => {
    navigate("/booking-history", { replace: true });
  };

  const handleMockPaid = async () => {
    if (!booking?.booking_id) {
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      await API.post("/payment/mock-success", { booking_id: booking.booking_id });
      await refreshData();
      await refreshWallet();
      setSuccessBookingId(booking.booking_id);
    } catch (err) {
      setError(err?.response?.data?.detail || "Không mô phỏng thanh toán được");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="page-wrap">
      <div className="page-card payment-shell">
        <h1 className="page-title">Thanh Toán Bằng Ví</h1>
        <p className="payment-note">Flow cũ bằng QR ngân hàng đã được thay bằng ví nội bộ.</p>

        {loading && <p className="payment-note">Đang tải thông tin booking...</p>}
        {error && <p className="payment-error">{error}</p>}

        {successBookingId && !loading ? (
          <div className="payment-success-pop" role="status" aria-live="polite">
            <button
              type="button"
              className="payment-success-close"
              onClick={goToBookingHistory}
              aria-label="Đóng và về lịch sử booking"
            >
              ×
            </button>
            <div className="payment-success-check" aria-hidden="true">
              <svg viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="24" />
                <path d="M15 27.5 22.5 35 38 18" />
              </svg>
            </div>
            <h2>Thanh toán thành công</h2>
            <div className="payment-success-countdown" aria-label={`Tự chuyển sau ${countdownSeconds} giây`}>
              <span>{countdownSeconds}</span>
              <small>giây</small>
            </div>
            <p>Booking #{successBookingId} đã được giữ chỗ. Hệ thống sẽ tự chuyển về lịch sử booking sau {countdownSeconds} giây.</p>
            <button type="button" className="btn-primary" onClick={goToBookingHistory}>
              Về lịch sử booking
            </button>
          </div>
        ) : null}

        {booking && !loading && !successBookingId && (
          <div className="payment-card">
            <p><strong>Booking ID:</strong> {booking.booking_id}</p>
            <p><strong>Trạng thái:</strong> {bookingStatusLabel(booking.checkin_status || booking.booking_status)}</p>
            <p><strong>Bãi xe:</strong> {booking.parking?.name}</p>
            <p><strong>Slot:</strong> {booking.slot?.code || booking.slot?.id}</p>
            <p><strong>Biển số:</strong> {booking.vehicle?.license_plate}</p>
            <p><strong>Check-in:</strong> {formatDateTimeVN(booking.checkin_time)}</p>
            <p><strong>Check-out:</strong> {formatDateTimeVN(booking.checkout_time)}</p>
            <p><strong>Tổng tiền booking:</strong> {formatMoney(booking.total_amount)}đ</p>
            <p><strong>Đã giữ 30%:</strong> {formatMoney(booking.upfront_amount)}đ</p>
            <p><strong>Còn lại khi checkout:</strong> {formatMoney(remainingAmount)}đ</p>
            {walletQueryLoading ? (
              <p><strong>Số dư ví:</strong> Đang tải...</p>
            ) : walletQueryError ? (
              <p><strong>Số dư ví:</strong> Không tải được số dư</p>
            ) : wallet ? (
              <p><strong>Số dư ví:</strong> {formatCurrency(wallet.balance)}</p>
            ) : null}

            <div className="payment-actions">
              <button type="button" className="btn-primary" onClick={handleMockPaid} disabled={submitting}>
                {submitting ? "Đang mô phỏng..." : "Mô phỏng thanh toán thành công"}
              </button>
              <button type="button" className="btn-primary" onClick={goToBookingHistory}>
                Xem chi tiết booking
              </button>
              <button type="button" className="btn-secondary" onClick={() => navigate("/profile")}>Về hồ sơ ví</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
