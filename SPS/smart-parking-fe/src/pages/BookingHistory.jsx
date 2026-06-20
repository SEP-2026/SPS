import { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Star, X } from "lucide-react";
import ReviewForm from "../components/ReviewForm";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import { formatDateTimeVN, parseVietnamDate, toDatetimeLocalValue, toVietnamIsoString } from "../utils/dateTime";
import "./BookingHistory.css";

const ACTIVE_STATUSES = ["pending", "booked", "checked_in", "checked_out", "completed"];
const BOOKING_TABS = [
  { key: "all", label: "Tất cả" },
  { key: "not_checked_in", label: "Chưa check in" },
  { key: "checked_in", label: "Đang check in" },
  { key: "checked_out", label: "Đã check out" },
  { key: "review", label: "Đánh giá" },
];

const SORT_OPTIONS = [
  { key: "date_desc", label: "Mới nhất" },
  { key: "date_asc", label: "Cũ nhất" },
  { key: "amount_desc", label: "Giá cao nhất" },
  { key: "amount_asc", label: "Giá thấp nhất" },
];

const fmtDateTime = (value) => {
  return formatDateTimeVN(value, "N/A");
};

const toDatetimeLocal = (value) => {
  return toDatetimeLocalValue(value);
};

const formatDuration = (start, end) => {
  const startDate = parseVietnamDate(start);
  const endDate = parseVietnamDate(end);
  if (!startDate || !endDate) return "N/A";
  const totalMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} giờ ${minutes} phút`;
};

const statusText = (status) => {
  const map = {
    pending: "Chờ thanh toán",
    booked: "Chưa check-in",
    checked_in: "Đang gửi xe",
    checked_out: "Đã check-out",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
  };
  return map[status] || status || "N/A";
};

const lifecycleStatus = (item) => {
  const rawStatus = `${item?.checkin_status || item?.status || ""}`.toLowerCase();
  if (rawStatus === "completed") return "checked_out";
  if (rawStatus === "confirmed") return "booked";
  if (rawStatus === "in_progress") return "checked_in";
  if (rawStatus === "not_checked_in") return "booked";
  return rawStatus;
};

const isCheckedOutBooking = (item) => {
  const status = lifecycleStatus(item);
  return status === "checked_out" || item?.status === "completed";
};

const renderBookingStateDetails = (item) => {
  const status = lifecycleStatus(item);
  if (isCheckedOutBooking(item) || status === "cancelled") {
    return null;
  }

  const config = {
    pending: {
      className: "is-pending",
      title: "Chờ thanh toán",
      description: "Booking đã tạo nhưng chưa thanh toán giữ chỗ.",
      firstLabel: "Check-in dự kiến",
      firstValue: fmtDateTime(item.checkin_time),
      secondLabel: "Check-out dự kiến",
      secondValue: fmtDateTime(item.checkout_time),
      thirdLabel: "Cần thanh toán",
      thirdValue: `${Number(item.total_amount || 0).toLocaleString("vi-VN")}đ`,
    },
    booked: {
      className: "is-booked",
      title: "Chưa check-in",
      description: "Booking đã được giữ chỗ, xe chưa vào bãi.",
      firstLabel: "Check-in dự kiến",
      firstValue: fmtDateTime(item.checkin_time),
      secondLabel: "Check-out dự kiến",
      secondValue: fmtDateTime(item.checkout_time),
      thirdLabel: "Phí gốc",
      thirdValue: `${Number(item.total_amount || 0).toLocaleString("vi-VN")}đ`,
    },
    checked_in: {
      className: "is-checked-in",
      title: "Đang check-in",
      description: "Xe đang ở trong bãi, trạng thái sẽ tự cập nhật khi check-out.",
      firstLabel: "Check-in thực tế",
      firstValue: fmtDateTime(item.actual_checkin || item.checkin_time),
      secondLabel: "Check-out dự kiến",
      secondValue: fmtDateTime(item.checkout_time),
      thirdLabel: "Thời gian dự kiến",
      thirdValue: formatDuration(item.actual_checkin || item.checkin_time, item.checkout_time),
    },
  }[status];

  if (!config) {
    return null;
  }

  return (
    <div className={`booking-state-details ${config.className}`}>
      <div className="booking-state-header">
        <svg className="booking-state-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <span>{config.title}</span>
      </div>
      <p>{config.description}</p>
      <div className="booking-state-grid">
        <div className="booking-state-item">
          <span className="booking-state-label">{config.firstLabel}</span>
          <span className="booking-state-value">{config.firstValue}</span>
        </div>
        <div className="booking-state-item">
          <span className="booking-state-label">{config.secondLabel}</span>
          <span className="booking-state-value">{config.secondValue}</span>
        </div>
        <div className="booking-state-item total">
          <span className="booking-state-label">{config.thirdLabel}</span>
          <span className="booking-state-value">{config.thirdValue}</span>
        </div>
      </div>
    </div>
  );
};

const statusClass = (status) => {
  const map = {
    pending: "is-pending",
    booked: "is-booked",
    checked_in: "is-checked-in",
    checked_out: "is-completed",
    completed: "is-completed",
    cancelled: "is-cancelled",
  };
  return map[status] || "is-pending";
};

const buildGoogleMapsLinks = (parking) => {
  const name = parking?.name?.trim() || "";
  const address = parking?.address?.trim() || "";
  const destinationText = address || name;
  const searchText = [name, address].filter(Boolean).join(", ") || destinationText;

  if (!destinationText) {
    return { directionsUrl: "", mapUrl: "" };
  }

  return {
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destinationText)}`,
    mapUrl: `https://www.google.com/maps/search/${encodeURIComponent(searchText)}`,
  };
};

const timelineSegments = (oldStartRaw, oldEndRaw, newStartRaw, newEndRaw) => {
  const oldStart = parseVietnamDate(oldStartRaw);
  const oldEnd = parseVietnamDate(oldEndRaw);
  const newStart = parseVietnamDate(newStartRaw);
  const newEnd = parseVietnamDate(newEndRaw);

  if (
    !oldStart ||
    !oldEnd ||
    !newStart ||
    !newEnd ||
    Number.isNaN(oldStart.getTime()) ||
    Number.isNaN(oldEnd.getTime()) ||
    Number.isNaN(newStart.getTime()) ||
    Number.isNaN(newEnd.getTime())
  ) {
    return null;
  }

  const minStart = Math.min(oldStart.getTime(), newStart.getTime());
  const maxEnd = Math.max(oldEnd.getTime(), newEnd.getTime());
  const total = maxEnd - minStart;
  if (total <= 0) {
    return null;
  }

  const overlapStart = Math.max(oldStart.getTime(), newStart.getTime());
  const overlapEnd = Math.min(oldEnd.getTime(), newEnd.getTime());

  const toPct = (value) => ((value - minStart) / total) * 100;

  return {
    old: {
      left: toPct(oldStart.getTime()),
      width: ((oldEnd.getTime() - oldStart.getTime()) / total) * 100,
    },
    requested: {
      left: toPct(newStart.getTime()),
      width: ((newEnd.getTime() - newStart.getTime()) / total) * 100,
    },
    overlap:
      overlapEnd > overlapStart
        ? {
            left: toPct(overlapStart),
            width: ((overlapEnd - overlapStart) / total) * 100,
          }
        : null,
  };
};

export default function BookingHistory() {
  const location = useLocation();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [qrModal, setQrModal] = useState({ isOpen: false, bookingId: null, qrUrl: null, loading: false });
  const [reviewModal, setReviewModal] = useState({ isOpen: false, booking: null, review: null, loading: false, error: "" });

  const initialConflict = location.state?.conflictContext || null;
  const [conflictContext, setConflictContext] = useState(initialConflict);
  const [editMode, setEditMode] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [slotOptions, setSlotOptions] = useState([]);
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("date_desc");

  const conflictingBooking = conflictContext?.conflicting_booking || null;
  const requestedBooking = conflictContext?.requested_booking_view || conflictContext?.requested_booking || null;
  const pendingCreatePayload = conflictContext?.pending_create_payload || null;

  const [editForm, setEditForm] = useState(() => ({
    checkin_time: toDatetimeLocal(conflictingBooking?.checkin_time),
    checkout_time: toDatetimeLocal(conflictingBooking?.checkout_time),
    slot_id: conflictingBooking?.slot_id || "",
  }));

  const refreshBookings = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
        setError("");
      }
      const res = await API.get("/booking/my");
      setBookings(res.data || []);
    } catch (err) {
      if (!silent) {
        setError(err?.response?.data?.detail || "Khong tai duoc lich su booking");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useRealtimeRefresh(() => refreshBookings({ silent: true }), { minRefreshIntervalMs: 2000 });

  useEffect(() => {
    refreshBookings();
  }, [refreshBookings]);

  useEffect(() => {
    setEditForm({
      checkin_time: toDatetimeLocal(conflictingBooking?.checkin_time),
      checkout_time: toDatetimeLocal(conflictingBooking?.checkout_time),
      slot_id: conflictingBooking?.slot_id || "",
    });
  }, [conflictingBooking?.booking_id]);

  useEffect(() => {
    const loadSlots = async () => {
      if (!conflictingBooking?.parking_id || !editMode) {
        setSlotOptions([]);
        return;
      }
      try {
        const res = await API.get("/slots", {
          params: { parking_id: conflictingBooking.parking_id },
        });
        const options = (res.data || []).filter(
          (slot) => slot.status === "available" || slot.id === conflictingBooking.slot_id,
        );
        setSlotOptions(options);
      } catch {
        setSlotOptions([]);
      }
    };

    loadSlots();
  }, [conflictingBooking?.parking_id, conflictingBooking?.slot_id, editMode]);

  useEffect(() => {
    const checkedIn = bookings.filter((item) => lifecycleStatus(item) === "checked_in");
    if (!checkedIn.length) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const updates = await Promise.all(
          checkedIn.map(async (item) => {
            const res = await API.get(`/bookings/${item.booking_id}/status`);
            return { booking_id: item.booking_id, payload: res.data };
          }),
        );
        setBookings((prev) =>
          prev.map((item) => {
            const found = updates.find((u) => u.booking_id === item.booking_id);
            if (!found) return item;
            return {
              ...item,
              checkin_status: found.payload.checkin_status,
              actual_checkin: found.payload.actual_checkin || item.actual_checkin,
              actual_checkout: found.payload.actual_checkout || item.actual_checkout,
              overstay_fee: found.payload.overstay_fee,
              total_actual_fee: found.payload.total_actual_fee,
            };
          }),
        );
      } catch {
        // Ignore a failed poll cycle.
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [bookings]);

  const activeBookings = useMemo(
    () => bookings.filter((item) => ACTIVE_STATUSES.includes(item.status)),
    [bookings],
  );

  const filteredBookings = useMemo(() => {
    let filtered = activeBookings;
    
    if (activeTab === "all") filtered = activeBookings;
    else if (activeTab === "not_checked_in") {
      filtered = activeBookings.filter((item) => ["pending", "booked"].includes(lifecycleStatus(item)));
    } else if (activeTab === "checked_in") {
      filtered = activeBookings.filter((item) => lifecycleStatus(item) === "checked_in");
    } else if (activeTab === "checked_out" || activeTab === "review") {
      filtered = activeBookings.filter((item) => {
        const isCheckedOut = isCheckedOutBooking(item);
        if (activeTab === "review") {
          return isCheckedOut && Boolean(item.has_review);
        }
        return isCheckedOut;
      });
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((item) =>
        String(item.booking_id).includes(query) ||
        (item.parking?.name || "").toLowerCase().includes(query) ||
        (item.parking?.address || "").toLowerCase().includes(query) ||
        (item.vehicle?.license_plate || "").toLowerCase().includes(query) ||
        (item.slot?.code || "").toLowerCase().includes(query)
      );
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "date_desc":
          return new Date(b.checkin_time) - new Date(a.checkin_time);
        case "date_asc":
          return new Date(a.checkin_time) - new Date(b.checkin_time);
        case "amount_desc":
          return (b.total_amount || 0) - (a.total_amount || 0);
        case "amount_asc":
          return (a.total_amount || 0) - (b.total_amount || 0);
        default:
          return 0;
      }
    });

    return filtered;
  }, [activeBookings, activeTab, searchQuery, sortBy]);

  const segments = useMemo(() => {
    if (!conflictingBooking || !requestedBooking) {
      return null;
    }
    return timelineSegments(
      conflictingBooking.checkin_time,
      conflictingBooking.checkout_time,
      requestedBooking.checkin_time,
      requestedBooking.checkout_time,
    );
  }, [conflictingBooking, requestedBooking]);

  const retryCreatePending = async () => {
    if (!pendingCreatePayload) {
      throw new Error("Không có dữ liệu booking mới để tạo lại");
    }

    const createRes = await API.post("/booking/create", pendingCreatePayload);
    navigate(`/payment/${createRes.data.booking_id}`, {
      state: { booking: createRes.data },
    });
  };


  const handleViewQr = async (bookingId) => {
    setQrModal({ isOpen: true, bookingId, qrUrl: null, loading: true });
    try {
      const res = await API.get(`/bookings/${bookingId}/qr`);
      const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
      const fullQrUrl = `${baseUrl}${res.data.qr_url}`;
      setQrModal({ isOpen: true, bookingId, qrUrl: fullQrUrl, loading: false });
    } catch (err) {
      setQrModal({ isOpen: true, bookingId, qrUrl: null, loading: false, error: err?.response?.data?.detail || "Lỗi tải QR" });
    }
  };

  const handleDownloadQr = async () => {
    if (!qrModal.qrUrl) {
      return;
    }
    try {
      const response = await fetch(qrModal.qrUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `booking-${qrModal.bookingId}-qr.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // Handle download error silently
    }
  };

  const closeQrModal = () => {
    setQrModal({ isOpen: false, bookingId: null, qrUrl: null, loading: false });
  };

  const openReviewModal = async (booking, mode = "view") => {
    setReviewModal({ isOpen: true, booking, review: null, loading: mode === "view", error: "" });
    if (mode !== "view") {
      return;
    }
    try {
      const res = await API.get(`/reviews/booking/${booking.booking_id}`);
      setReviewModal({ isOpen: true, booking, review: res.data, loading: false, error: "" });
    } catch (err) {
      setReviewModal({
        isOpen: true,
        booking,
        review: null,
        loading: false,
        error: err?.response?.data?.detail || "Không tải được đánh giá",
      });
    }
  };

  const closeReviewModal = () => {
    setReviewModal({ isOpen: false, booking: null, review: null, loading: false, error: "" });
  };

  const clearConflictRouteState = () => {
    navigate(location.pathname, { replace: true, state: {} });
  };

  const handleKeepOldBooking = async () => {
    const duplicateBookingId =
      conflictContext?.requested_booking?.booking_id ||
      conflictContext?.requested_booking_view?.booking_id ||
      conflictContext?.duplicate_booking_id ||
      null;

    try {
      setProcessing(true);
      setError("");
      setNotice("");

      if (duplicateBookingId) {
        await API.post(`/booking/my/${duplicateBookingId}/cancel`);
      }

      await refreshBookings();
      setConflictContext(null);
      setEditMode(false);
      clearConflictRouteState();
      setNotice("Bạn đã chọn giữ booking cũ. Hệ thống đã hủy thao tác đặt mới.");
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(
        (typeof detail === "string" && detail) ||
          detail?.message ||
          "Không thể xử lý lựa chọn giữ booking cũ",
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateOldBooking = async () => {
    if (!conflictingBooking?.booking_id) {
      return;
    }

    try {
      setProcessing(true);
      setError("");
      setNotice("");

      await API.patch(`/booking/my/${conflictingBooking.booking_id}`, {
        slot_id: Number(editForm.slot_id),
        checkin_time: new Date(editForm.checkin_time).toISOString(),
        checkout_time: new Date(editForm.checkout_time).toISOString(),
      });

      await refreshBookings();
      await retryCreatePending();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.reason === "overlap_booking") {
        setConflictContext((prev) => ({ ...prev, ...detail }));
      }
      setError(
        (typeof detail === "string" && detail) ||
          detail?.message ||
          "Cập nhật booking cũ thất bại",
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelOldAndRebook = async () => {
    if (!conflictingBooking?.booking_id) {
      return;
    }

    const confirmCancel = window.confirm("Bạn có chắc muốn hủy booking hiện tại không?");
    if (!confirmCancel) {
      return;
    }

    try {
      setProcessing(true);
      setError("");
      setNotice("");

      await API.post(`/booking/my/${conflictingBooking.booking_id}/cancel`);
      await refreshBookings();
      await retryCreatePending();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.reason === "overlap_booking") {
        setConflictContext((prev) => ({ ...prev, ...detail }));
      }
      setError(
        (typeof detail === "string" && detail) ||
          detail?.message ||
          "Hủy booking cũ và đặt lại thất bại",
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleCancelBooking = async (bookingId) => {
    if (!bookingId) {
      return;
    }

    const confirmCancel = window.confirm("Bạn có chắc muốn hủy booking này không?");
    if (!confirmCancel) {
      return;
    }

    try {
      setProcessing(true);
      setError("");
      setNotice("");
      await API.post(`/booking/my/${bookingId}/cancel`);
      await refreshBookings();
      setNotice(`Đã hủy booking #${bookingId}.`);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(
        (typeof detail === "string" && detail) ||
          detail?.message ||
          "Không thể hủy booking",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <section className="page-wrap booking-history-wrap">
      <div className="page-card booking-history-shell">
        <header className="booking-history-head">
          <h1 className="page-title">Lịch sử booking</h1>
          <p className="page-subtitle">Theo dõi booking hiện tại và xử lý booking bị trùng nhanh chóng</p>
        </header>

        {notice && <p className="booking-history-notice">{notice}</p>}
        {error && <p className="booking-history-error">{error}</p>}

        {conflictContext && conflictingBooking && requestedBooking && (
          <section className="conflict-panel">
            <h2>Thông báo lỗi booking bị trùng</h2>
            <p className="conflict-message">
              {conflictContext.message || "Booking mới của bạn bị trùng với booking hiện tại."}
            </p>

            <div className="conflict-grid">
              <article className="conflict-card old-booking">
                <h3>Booking đang gây xung đột</h3>
                <p><strong>Mã booking:</strong> #{conflictingBooking.booking_id}</p>
                <p><strong>Bãi xe:</strong> {conflictingBooking.parking_name || "N/A"}</p>
                <p><strong>Vị trí:</strong> {conflictingBooking.slot_code || conflictingBooking.slot_id}</p>
                <p><strong>Biển số:</strong> {conflictingBooking.license_plate || "N/A"}</p>
                <p><strong>Check-in:</strong> {fmtDateTime(conflictingBooking.checkin_time)}</p>
                <p><strong>Check-out:</strong> {fmtDateTime(conflictingBooking.checkout_time)}</p>
                <p>
                  <strong>Trạng thái:</strong>{" "}
                  <span className={`status-chip ${statusClass(conflictingBooking.status)}`}>
                    {statusText(conflictingBooking.status)}
                  </span>
                </p>
              </article>

              <article className="conflict-card new-booking">
                <h3>Booking mới bạn vừa nhập</h3>
                <p><strong>Bãi xe mới:</strong> {requestedBooking.parking_name || requestedBooking.parking_id || "N/A"}</p>
                <p><strong>Vị trí mới:</strong> {requestedBooking.slot_code || requestedBooking.slot_id || "N/A"}</p>
                <p><strong>Check-in mới:</strong> {fmtDateTime(requestedBooking.checkin_time)}</p>
                <p><strong>Check-out mới:</strong> {fmtDateTime(requestedBooking.checkout_time)}</p>
                <p><strong>Giá dự kiến:</strong> {Number(requestedBooking.estimated_total_amount || 0).toLocaleString("vi-VN")}đ</p>
              </article>
            </div>

            {segments && (
              <div className="timeline-box">
                <h3>Lịch / timeline trực quan</h3>
                <div className="timeline-track">
                  <div className="timeline-bar timeline-old" style={{ left: `${segments.old.left}%`, width: `${segments.old.width}%` }} />
                  <div className="timeline-bar timeline-new" style={{ left: `${segments.requested.left}%`, width: `${segments.requested.width}%` }} />
                  {segments.overlap && (
                    <div className="timeline-bar timeline-overlap" style={{ left: `${segments.overlap.left}%`, width: `${segments.overlap.width}%` }} />
                  )}
                </div>
                <div className="timeline-legend">
                  <span><i className="dot old" /> Xanh = booking cũ</span>
                  <span><i className="dot overlap" /> Đỏ = phần bị trùng</span>
                  <span><i className="dot requested" /> Vàng = booking mới</span>
                </div>
              </div>
            )}

            <div className="action-cards">
              <button type="button" className="action-card" onClick={handleKeepOldBooking} disabled={processing}>
                <strong>Giữ booking cũ</strong>
                <span>Hủy thao tác đặt mới và quay về danh sách booking</span>
              </button>

              <button
                type="button"
                className="action-card"
                onClick={() => setEditMode((value) => !value)}
                disabled={processing}
              >
                <strong>Chỉnh sửa booking cũ</strong>
                <span>Mở form chỉnh thời gian / đổi vị trí rồi tạo lại booking mới</span>
              </button>

              <button type="button" className="action-card danger" onClick={handleCancelOldAndRebook} disabled={processing}>
                <strong>Hủy booking cũ và đặt lại</strong>
                <span>Chuyển booking cũ sang Đã hủy, sau đó tự động tạo booking mới</span>
              </button>
            </div>

            {editMode && (
              <div className="edit-panel">
                <h3>Chỉnh sửa booking cũ</h3>
                <div className="edit-grid">
                  <label>
                    Thời gian check-in
                    <input
                      type="datetime-local"
                      value={editForm.checkin_time}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, checkin_time: event.target.value }))}
                    />
                  </label>
                  <label>
                    Thời gian check-out
                    <input
                      type="datetime-local"
                      value={editForm.checkout_time}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, checkout_time: event.target.value }))}
                    />
                  </label>
                  <label>
                    Đổi vị trí (nếu cần)
                    <select
                      value={editForm.slot_id}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, slot_id: event.target.value }))}
                    >
                      {slotOptions.map((slot) => (
                        <option key={slot.id} value={slot.id}>
                          {slot.code} - {slot.status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" className="btn-primary history-submit" onClick={handleUpdateOldBooking} disabled={processing}>
                  {processing ? "Đang xử lý..." : "Lưu booking cũ và tạo lại booking mới"}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="history-panel">
          <h2>Thông tin booking hiện tại</h2>
          <div className="history-controls">
            <div className="history-tabs" role="tablist" aria-label="Bộ lọc lịch sử booking">
              {BOOKING_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  className={`history-tab ${activeTab === tab.key ? "active" : ""}`}
                  aria-selected={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="history-filters">
              <div className="search-box">
                <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="Tìm kiếm..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="sort-select"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner" />
              <p>Đang tải danh sách booking...</p>
            </div>
          ) : null}

          {!loading && filteredBookings.length === 0 && (
            <div className="empty-state">
              <svg className="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <p>
                {activeTab === "review"
                  ? "Chưa có booking nào đã được đánh giá."
                  : searchQuery
                  ? "Không tìm thấy booking nào phù hợp."
                  : "Không có booking trong tab này."}
              </p>
            </div>
          )}

          <div className="history-list">
            {filteredBookings.map((item) => (
              <article key={item.booking_id} className="history-item">
                {(() => {
                  const { directionsUrl, mapUrl } = buildGoogleMapsLinks(item.parking);
                  return (
                    <>
                <header>
                  <div className="booking-header-left">
                    <h3>#{item.booking_id}</h3>
                    <span className={`status-chip ${statusClass(lifecycleStatus(item))}`}>{statusText(lifecycleStatus(item))}</span>
                  </div>
                  <div className="booking-price">
                    {Number(item.total_amount || 0).toLocaleString("vi-VN")}đ
                  </div>
                </header>
                <div className="booking-details">
                  <div className="detail-row">
                    <svg className="detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 21h18M5 21V7l8-4 8 4v14M8 21v-9a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9" />
                    </svg>
                    <span>{item.parking?.name || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <svg className="detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    <span>{item.parking?.address || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <svg className="detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <path d="M9 3v18" />
                      <path d="M15 3v18" />
                      <path d="M3 9h18" />
                      <path d="M3 15h18" />
                    </svg>
                    <span>Vị trí: {item.slot?.code || item.slot?.id || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <svg className="detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="1" y="3" width="15" height="13" />
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                    <span>{item.vehicle?.license_plate || "N/A"}</span>
                  </div>
                  <div className="detail-row">
                    <svg className="detail-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{fmtDateTime(item.checkin_time)} - {fmtDateTime(item.checkout_time)}</span>
                  </div>
                </div>
                {renderBookingStateDetails(item)}
                {isCheckedOutBooking(item) && (
                  <div className="checkout-details">
                    <div className="checkout-header">
                      <svg className="checkout-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      <span>Đã check-out</span>
                    </div>
                    <div className="checkout-grid">
                      <div className="checkout-item">
                        <span className="checkout-label">Check-in thực tế</span>
                        <span className="checkout-value">{fmtDateTime(item.actual_checkin)}</span>
                      </div>
                      <div className="checkout-item">
                        <span className="checkout-label">Check-out thực tế</span>
                        <span className="checkout-value">{fmtDateTime(item.actual_checkout)}</span>
                      </div>
                      <div className="checkout-item">
                        <span className="checkout-label">Thời gian</span>
                        <span className="checkout-value">{formatDuration(item.actual_checkin || item.checkin_time, item.actual_checkout || item.checkout_time)}</span>
                      </div>
                      <div className="checkout-item">
                        <span className="checkout-label">Phí gốc</span>
                        <span className="checkout-value">{Number(item.total_amount || 0).toLocaleString("vi-VN")}đ</span>
                      </div>
                      {item.overstay_fee > 0 && (
                        <div className="checkout-item highlight">
                          <span className="checkout-label">Phí quá giờ</span>
                          <span className="checkout-value">+{Number(item.overstay_fee || 0).toLocaleString("vi-VN")}đ</span>
                        </div>
                      )}
                      <div className="checkout-item total">
                        <span className="checkout-label">Tổng cộng</span>
                        <span className="checkout-value">{Number(item.total_actual_fee || item.total_amount || 0).toLocaleString("vi-VN")}đ</span>
                      </div>
                    </div>
                  </div>
                )}
                {directionsUrl && mapUrl && (
                  <div className="history-item-actions">
                    {item.status !== "pending" && (
                      <button
                        type="button"
                        className="btn-qr"
                        onClick={() => handleViewQr(item.booking_id)}
                        title="Xem mã QR"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="3" width="7" height="7" />
                          <rect x="14" y="3" width="7" height="7" />
                          <rect x="14" y="14" width="7" height="7" />
                          <rect x="3" y="14" width="7" height="7" />
                        </svg>
                        <span>QR</span>
                      </button>
                    )}
                    {item.status === "pending" && (
                      <button
                        type="button"
                        className="btn-pay"
                        onClick={() => navigate(`/payment/${item.booking_id}`, { state: { booking: item } })}
                        title="Thanh toán"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="2" y="7" width="20" height="14" rx="2" />
                          <line x1="2" y1="11" x2="22" y2="11" />
                        </svg>
                        <span>Thanh toán</span>
                      </button>
                    )}
                    {["pending", "booked"].includes(lifecycleStatus(item)) && (
                      <button
                        type="button"
                        className="btn-cancel-booking"
                        onClick={() => handleCancelBooking(item.booking_id)}
                        disabled={processing}
                        title="Hủy booking"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        <span>Hủy</span>
                      </button>
                    )}
                    <a
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-directions"
                      title="Mở Google Maps - Chỉ đường"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="3 11 22 2 13 21 11 13 3 11" />
                      </svg>
                      <span>Chỉ đường</span>
                    </a>
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-view-map"
                      title="Xem bản đồ"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                        <line x1="8" y1="2" x2="8" y2="18" />
                        <line x1="16" y1="6" x2="16" y2="22" />
                      </svg>
                      <span>Bản đồ</span>
                    </a>
                    {isCheckedOutBooking(item) && (
                      item.is_reviewed ? (
                        <button type="button" className="btn-review" onClick={() => openReviewModal(item, "view")}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                          </svg>
                          <span>Đã đánh giá</span>
                        </button>
                      ) : (
                        <button type="button" className="btn-review" onClick={() => openReviewModal(item, "create")}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                          </svg>
                          <span>Đánh giá</span>
                        </button>
                      )
                    )}
                  </div>
                )}
                    </>
                  );
                })()}
              </article>
            ))}
          </div>
        </section>
      </div>

      {/* QR Code Modal */}
      {qrModal.isOpen && ReactDOM.createPortal(
        <div className="history-qr-modal-overlay" onClick={closeQrModal}>
          <div className="history-qr-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-qr-modal-close" onClick={closeQrModal}><X size={18} /></button>
            <h2>Mã QR - Booking #{qrModal.bookingId}</h2>
            {qrModal.loading && <p>Đang tải mã QR...</p>}
            {qrModal.error && <p className="history-qr-modal-error">{qrModal.error}</p>}
            {qrModal.qrUrl && (
              <>
                <div className="history-qr-modal-image">
                  <img src={qrModal.qrUrl} alt="QR Code" />
                </div>
                <button className="history-qr-modal-download" onClick={handleDownloadQr}>
                  Tải QR
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
      {reviewModal.isOpen && ReactDOM.createPortal(
        <div className="history-qr-modal-overlay" onClick={closeReviewModal}>
          <div className="history-qr-modal" onClick={(e) => e.stopPropagation()}>
            <button className="history-qr-modal-close" onClick={closeReviewModal}><X size={18} /></button>
            {reviewModal.loading ? <p>Đang tải đánh giá...</p> : null}
            {reviewModal.error ? <p className="history-qr-modal-error">{reviewModal.error}</p> : null}

            {!reviewModal.loading && !reviewModal.review && reviewModal.booking && !reviewModal.booking.is_reviewed ? (
              <ReviewForm
                bookingId={reviewModal.booking.booking_id}
                parkingName={reviewModal.booking.parking?.name}
                onSkip={closeReviewModal}
                onSubmit={(result) => {
                  setReviewModal((prev) => ({
                    ...prev,
                    review: {
                      review_id: result.review_id,
                      booking_id: result.booking_id,
                      rating: result.rating,
                      comment: result.comment,
                      owner_reply: null,
                      owner_replied_at: null,
                      created_at: result.created_at,
                    },
                  }));
                  setBookings((prev) =>
                    prev.map((item) =>
                      item.booking_id === result.booking_id ? { ...item, is_reviewed: true, has_review: true } : item,
                    ),
                  );
                }}
              />
            ) : null}

            {reviewModal.review ? (
              <div className="booking-review-result">
                <div className="review-result-head">
                  <h3>Đánh giá của bạn</h3>
                  <span className="review-result-score">{reviewModal.review.rating}/5</span>
                </div>
                <p className="owner-review-rating">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star key={index} size={16} fill={index < reviewModal.review.rating ? "#eab308" : "none"} />
                  ))}
                </p>
                <blockquote className="review-result-comment">
                  {reviewModal.review.comment || "Không có nhận xét."}
                </blockquote>
                <p className="review-result-time">Gửi lúc: {fmtDateTime(reviewModal.review.created_at)}</p>

                <div className="review-result-reply">
                  <p className="reply-title">Phản hồi từ chủ bãi</p>
                  {reviewModal.review.owner_reply ? (
                    <p className="reply-content">“{reviewModal.review.owner_reply}”</p>
                  ) : (
                    <p className="reply-empty">Chưa có phản hồi từ chủ bãi</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
