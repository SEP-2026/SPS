import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReviewForm from "../components/ReviewForm";
import API from "../services/api";
import CountdownTimer from "../components/CountdownTimer";
import { formatDateTimeVN } from "../utils/dateTime";
import { formatCurrency } from "../features/gate/gateFormatters";
import { useWallet } from "../context/WalletContext";
import "./PaymentSuccess.css";

const formatMoney = (value) => Number(value || 0).toLocaleString("vi-VN");
const BACKEND_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
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

export default function PaymentSuccess() {
  const { bookingId } = useParams();
  const navigate = useNavigate();
  const { wallet, loading: walletQueryLoading, error: walletQueryError } = useWallet();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState(null);
  const [shareNotice, setShareNotice] = useState("");
  const [statusData, setStatusData] = useState(null);
  const [reviewData, setReviewData] = useState(null);

  const numericBookingId = useMemo(() => Number(bookingId), [bookingId]);
  const currentCheckinStatus = (statusData?.checkin_status || booking?.checkin_status || booking?.booking_status || "").toLowerCase();

  useEffect(() => {
    const fetchBooking = async () => {
      if (!Number.isInteger(numericBookingId) || numericBookingId <= 0) {
        setError("Booking ID không hợp lệ");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const bookingRes = await API.get(`/booking/my/${numericBookingId}`);
        setBooking(bookingRes.data);
      } catch (err) {
        setBooking(null);
        setError(err?.response?.data?.detail || "Không tải được thông tin booking");
      } finally {
        setLoading(false);
      }
    };

    fetchBooking();
  }, [numericBookingId]);

  useEffect(() => {
    if (!numericBookingId || !booking) return undefined;
    const currentStatus = (statusData?.checkin_status || booking.booking_status || "").toLowerCase();
    if (currentStatus !== "checked_in") return undefined;

    const timer = window.setInterval(async () => {
      try {
        const res = await API.get(`/bookings/${numericBookingId}/status`);
        setStatusData(res.data);
      } catch {
        // Keep old status if polling fails once.
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [numericBookingId, booking, statusData?.checkin_status, booking?.booking_status]);

  useEffect(() => {
    const canLoadReview = booking?.is_reviewed || statusData?.is_reviewed;
    if (!canLoadReview || !numericBookingId) {
      return;
    }
    const loadReview = async () => {
      try {
        const res = await API.get(`/reviews/booking/${numericBookingId}`);
        setReviewData(res.data);
      } catch {
        setReviewData(null);
      }
    };
    loadReview();
  }, [booking?.is_reviewed, statusData?.is_reviewed, numericBookingId]);

  const qrImageUrl = useMemo(() => {
    if (!booking?.qr_code && !booking?.qr_code_path) {
      return "";
    }
    const qrPath = booking.qr_code_path || booking.qr_code;
    // Extract just the filename if it contains a path
    const filename = qrPath.includes("/") ? qrPath.split("/").pop() : qrPath;
    return `${BACKEND_BASE_URL}/qrcodes/${filename}`;
  }, [booking?.qr_code, booking?.qr_code_path]);

  const buildShareMessage = () => {
    if (!booking) {
      return "";
    }
    return [
      `Booking #${booking.booking_id}`,
      `Bai xe: ${booking.parking?.name || "N/A"}`,
      `Slot: ${booking.slot?.code || booking.slot?.id || "N/A"}`,
      `Bien so: ${booking.vehicle?.license_plate || "N/A"}`,
      `Check-in: ${formatDateTimeVN(booking.checkin_time)}`,
      `Check-out: ${formatDateTimeVN(booking.checkout_time)}`,
      `So tien: ${formatMoney(booking.total_amount)}d`,
      qrImageUrl,
    ].join("\n");
  };

  const handleDownloadQr = async () => {
    if (!qrImageUrl) {
      setShareNotice("Không tìm thấy QR để tải.");
      return;
    }

    try {
      const response = await fetch(qrImageUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch QR");
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `booking-${booking.booking_id}-qr.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
      setShareNotice("Đã tải QR thành công.");
    } catch {
      setShareNotice("Tải QR thất bại. Vui lòng thử lại.");
    }
  };

  const handleShareEmail = () => {
    if (!booking) {
      return;
    }

    const subject = encodeURIComponent(`Thông tin booking #${booking.booking_id}`);
    const body = encodeURIComponent(buildShareMessage());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleShareZalo = async () => {
    if (!booking) {
      return;
    }

    const message = buildShareMessage();
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Booking #${booking.booking_id}`,
          text: message,
        });
        setShareNotice("Đã chia sẻ qua ứng dụng trên điện thoại.");
        return;
      }

      await navigator.clipboard.writeText(message);
      window.open("https://zalo.me", "_blank", "noopener,noreferrer");
      setShareNotice("Đã copy nội dung. Hãy dán vào Zalo để gửi.");
    } catch {
      setShareNotice("Chia sẻ Zalo thất bại. Hãy thử lại.");
    }
  };

  return (
    <section className="page-wrap">
      <div className="page-card payment-success-shell">
        <h1 className="page-title">Booking Đã Xác Nhận</h1>
        <p className="payment-success-note">Ví đã giữ trước 30% tổng tiền booking, phần còn lại sẽ tự trừ khi checkout.</p>

        {loading && <p className="payment-success-note">Đang tải thông tin booking...</p>}
        {error && <p className="payment-success-error">{error}</p>}

        {booking && !loading && (
          <div className="payment-success-card">
            {(currentCheckinStatus === "checked_in") ? (
              <CountdownTimer
                expectedCheckout={statusData?.checkout_time || booking.checkout_time}
                pricePerHour={statusData?.price_per_hour || 0}
              />
            ) : null}
            {(currentCheckinStatus === "checked_out" || currentCheckinStatus === "completed") ? (
              <p className="payment-success-note">✅ Đã check-out thành công</p>
            ) : null}
            <p><strong>Booking ID:</strong> {booking.booking_id}</p>
            <p><strong>Trạng thái:</strong> {bookingStatusLabel(currentCheckinStatus || booking.booking_status)}</p>
            <p><strong>Bãi xe:</strong> {booking.parking?.name}</p>
            <p><strong>Slot:</strong> {booking.slot?.code || booking.slot?.id}</p>
            <p><strong>Chủ xe:</strong> {booking.vehicle?.owner_name}</p>
            <p><strong>Số điện thoại:</strong> {booking.vehicle?.phone || "Chưa cập nhật"}</p>
            <p><strong>Biển số:</strong> {booking.vehicle?.license_plate}</p>
            <p><strong>Màu xe:</strong> {booking.vehicle?.vehicle_color || "Chưa cập nhật"}</p>
            <p><strong>Check-in:</strong> {formatDateTimeVN(booking.checkin_time)}</p>
            <p><strong>Check-out:</strong> {formatDateTimeVN(booking.checkout_time)}</p>
            <p><strong>Số tiền:</strong> {formatMoney(booking.total_amount)}đ</p>
            <p><strong>Đã giữ từ ví:</strong> {formatMoney(booking.upfront_amount)}đ</p>
            <p><strong>Còn lại sẽ trừ khi checkout:</strong> {formatMoney(Math.max(0, Number(booking.total_amount || 0) - Number(booking.upfront_amount || 0)))}đ</p>
            {walletQueryLoading ? (
              <p><strong>Số dư ví hiện tại:</strong> Đang tải...</p>
            ) : walletQueryError ? (
              <p><strong>Số dư ví hiện tại:</strong> Không tải được số dư</p>
            ) : wallet ? (
              <p><strong>Số dư ví hiện tại:</strong> {formatCurrency(wallet.balance)}</p>
            ) : null}
            {(currentCheckinStatus === "checked_out" || currentCheckinStatus === "completed") ? (
              <p><strong>Tổng chi phí thực tế:</strong> {formatMoney(statusData?.total_actual_fee || booking.total_amount)}đ</p>
            ) : null}

            {booking.qr_code || booking.qr_code_path ? (
              <div className="payment-success-qr-box">
                <img 
                  src={qrImageUrl} 
                  alt="QR check-in/check-out"
                  onError={(e) => { e.target.src = '/placeholder-qr.png'; }}
                  style={{ width: 220, height: 220, border: '1px solid #eee', borderRadius: 8 }}
                />
              </div>
            ) : (
              <p className="payment-success-note">Đang tạo mã QR, vui lòng đợi...</p>
            )}

            <div className="payment-success-actions">
              <button type="button" className="payment-success-btn secondary" onClick={handleDownloadQr}>
                Tải QR
              </button>
              <button type="button" className="payment-success-btn secondary" onClick={handleShareEmail}>
                Gửi qua Email
              </button>
              <button type="button" className="payment-success-btn secondary" onClick={handleShareZalo}>
                Gửi qua Zalo
              </button>
              <button type="button" className="btn-primary" onClick={() => navigate("/booking-history", { replace: true })}>
                Xem chi tiết booking
              </button>
            </div>
            {shareNotice && <p className="payment-success-share-notice">{shareNotice}</p>}

            {(currentCheckinStatus === "checked_out" || currentCheckinStatus === "completed") ? (
              <div className="payment-review-section">
                {!reviewData && !(booking?.is_reviewed || statusData?.is_reviewed) ? (
                  <ReviewForm
                    bookingId={numericBookingId}
                    parkingName={booking.parking?.name}
                    onSkip={() => {}}
                    onSubmit={(result) => {
                      setReviewData({
                        review_id: result.review_id,
                        booking_id: result.booking_id,
                        rating: result.rating,
                        comment: result.comment,
                        owner_reply: null,
                        owner_replied_at: null,
                        created_at: result.created_at,
                      });
                      setBooking((prev) => (prev ? { ...prev, is_reviewed: true } : prev));
                    }}
                  />
                ) : null}
                {reviewData ? (
                  <div className="booking-review-result">
                    <h3>✅ Đánh giá của bạn</h3>
                    <p className="owner-review-rating">{"★".repeat(reviewData.rating)}{"☆".repeat(5 - reviewData.rating)} ({reviewData.rating}/5)</p>
                    <p>"{reviewData.comment || "Không có nhận xét."}"</p>
                    <p>Gửi lúc: {formatDateTimeVN(reviewData.created_at)}</p>
                    <p><strong>Phản hồi từ chủ bãi:</strong></p>
                    {reviewData.owner_reply ? <p>💬 "{reviewData.owner_reply}"</p> : <p>⏳ Chưa có phản hồi từ chủ bãi</p>}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
