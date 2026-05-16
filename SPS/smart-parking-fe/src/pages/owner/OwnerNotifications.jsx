import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { SectionCard, formatDateTime } from "../../owner/OwnerUI";
import "./OwnerNotifications.css";

const NOTIFICATION_TYPES = {
  booking: { label: "Đặt chỗ", tone: "success", icon: "booking" },
  review: { label: "Đánh giá", tone: "info", icon: "review" },
  payment: { label: "Thanh toán", tone: "payment", icon: "payment" },
  system: { label: "Hệ thống", tone: "system", icon: "system" },
  alert: { label: "Cảnh báo", tone: "alert", icon: "alert" },
};

const STORAGE_KEY = "owner_read_notifications";

function NotificationTypeIcon({ name }) {
  const icons = {
    booking: (
      <>
        <path d="M8 7h8" />
        <path d="M8 11h5" />
        <path d="M9 19h6a4 4 0 0 0 4-4V7a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3v8a4 4 0 0 0 4 4Z" />
      </>
    ),
    review: (
      <>
        <path d="m12 4 2.24 4.54 5.01.73-3.62 3.53.85 4.99L12 15.43l-4.48 2.36.85-4.99-3.62-3.53 5.01-.73L12 4Z" />
      </>
    ),
    payment: (
      <>
        <path d="M4 8h16" />
        <path d="M7 15h4" />
        <rect x="3" y="5" width="18" height="14" rx="3" />
      </>
    ),
    system: (
      <>
        <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.09 1.65V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.09-1.65 1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 0 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.09H3a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 4.7 8.62a1.8 1.8 0 0 0-.36-1.98l-.04-.04A2.1 2.1 0 0 1 7.27 3.63l.04.04a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.38 2.4V2a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.97 2.97l-.04.04a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.09H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z" />
      </>
    ),
    alert: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.5 2.8 17.4A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.6L13.7 4.5a2 2 0 0 0-3.4 0Z" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[name] || icons.system}
    </svg>
  );
}

export default function OwnerNotifications() {
  const { ownerData } = useOwnerContext();
  const [filterType, setFilterType] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  
  // Initialize from localStorage
  const [readNotificationIds, setReadNotificationIds] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Save to localStorage whenever readNotificationIds changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(readNotificationIds)));
    // Dispatch custom event for same-tab updates
    window.dispatchEvent(new CustomEvent("owner_notifications_updated", { detail: { readIds: readNotificationIds } }));
  }, [readNotificationIds]);

  // Combine and categorize notifications
  const allNotifications = useMemo(() => {
    const notifications = [];

    // Booking notifications
    const recentBookings = (ownerData.bookings || []).slice(0, 5);
    recentBookings.forEach((booking) => {
      if (booking.status === "pending") {
        notifications.push({
          id: `booking-pending-${booking.id}`,
          type: "booking",
          title: "Booking mới cần xác nhận",
          message: `${booking.code} - ${booking.plate} - ${booking.slotCode}`,
          time: booking.startTime,
          status: "pending",
          priority: "high",
          action: { label: "Xem chi tiết", link: "/owner/bookings" },
        });
      } else if (booking.status === "confirmed") {
        notifications.push({
          id: `booking-confirmed-${booking.id}`,
          type: "booking",
          title: "Booking đã xác nhận",
          message: `${booking.code} - ${booking.plate}`,
          time: booking.startTime,
          status: "confirmed",
          priority: "normal",
        });
      }
    });

    // Review notifications
    const unrepliedReviews = (ownerData.reviews || []).filter((r) => !r.ownerReply).slice(0, 3);
    unrepliedReviews.forEach((review) => {
      notifications.push({
        id: `review-unreplied-${review.id}`,
        type: "review",
        title: `Đánh giá ${review.rating}/5 chưa phản hồi`,
        message: review.comment || "Khách hàng đã để lại đánh giá",
        time: review.createdAt,
        status: "unreplied",
        priority: "normal",
        action: { label: "Phản hồi", link: "/owner/reviews" },
      });
    });

    // Activity-based notifications
    const activities = (ownerData.activities || []).slice(0, 5);
    activities.forEach((activity) => {
      const typeMap = {
        warning: "alert",
        booking: "booking",
        review: "review",
        payment: "payment",
      };
      notifications.push({
        id: activity.id,
        type: typeMap[activity.type] || "system",
        title: activity.title,
        message: activity.message || "",
        time: activity.time,
        status: activity.type,
        priority: activity.type === "warning" ? "high" : "normal",
      });
    });

    // Sort by newest
    return notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [ownerData]);

  // Add isRead property to notifications
  const notificationsWithReadStatus = useMemo(() => {
    return allNotifications.map((n) => ({
      ...n,
      isRead: readNotificationIds.has(n.id),
    }));
  }, [allNotifications, readNotificationIds]);

  const filteredNotifications = useMemo(() => {
    let filtered = notificationsWithReadStatus;
    if (filterType !== "all") {
      filtered = filtered.filter((n) => n.type === filterType);
    }
    if (sortBy === "oldest") {
      filtered = [...filtered].reverse();
    }
    return filtered;
  }, [notificationsWithReadStatus, filterType, sortBy]);

  const unreadCount = notificationsWithReadStatus.filter((n) => !n.isRead).length;

  const handleNotificationHover = (notificationId) => {
    setReadNotificationIds((prev) => new Set([...prev, notificationId]));
  };

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Thông báo & Cảnh báo"
        subtitle="Theo dõi tất cả các sự kiện, booking, đánh giá và hệ thống."
        actions={
          <div className="notification-controls">
            <select
              className="owner-input owner-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">Tất cả loại</option>
              {Object.entries(NOTIFICATION_TYPES).map(([key, val]) => (
                <option key={key} value={key}>
                  {val.label}
                </option>
              ))}
            </select>
            <select
              className="owner-input owner-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
            </select>
          </div>
        }
      >
        {filteredNotifications.length === 0 ? (
          <div className="owner-empty">Không có thông báo nào.</div>
        ) : (
          <div className="notification-list">
            {filteredNotifications.map((notif) => {
              const typeInfo = NOTIFICATION_TYPES[notif.type] || NOTIFICATION_TYPES.system;
              return (
                <div
                  key={notif.id}
                  className={`notification-item notification-item--${notif.priority} ${!notif.isRead ? "notification-item--unread" : ""}`}
                  onMouseEnter={() => handleNotificationHover(notif.id)}
                >
                  <div className={`notification-type-icon notification-type-icon--${typeInfo.tone}`}>
                    <NotificationTypeIcon name={typeInfo.icon} />
                  </div>
                  <div className="notification-content">
                    <div className="notification-title-row">
                      <h4>{notif.title}</h4>
                      {!notif.isRead ? <span className="notification-unread-dot" /> : null}
                    </div>
                    {notif.message && <p>{notif.message}</p>}
                    <div className="notification-meta-row">
                      <span className="notification-time">{formatDateTime(notif.time)}</span>
                      <span className={`owner-badge owner-badge--${notif.type}`}>
                        {typeInfo.label}
                      </span>
                    </div>
                  </div>
                  {notif.action && (
                    <Link to={notif.action.link} className="notification-action">
                      {notif.action.label}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <div className="notification-summary">
        <div className="notification-summary-item">
          <span className="notification-summary-value">{unreadCount}</span>
          <span className="notification-summary-label">Chưa đọc</span>
        </div>
        <div className="notification-summary-item">
          <span className="notification-summary-value">{filteredNotifications.length}</span>
          <span className="notification-summary-label">Thông báo hiển thị</span>
        </div>
        <div className="notification-summary-item">
          <span className="notification-summary-value">{notificationsWithReadStatus.length}</span>
          <span className="notification-summary-label">Tổng cộng</span>
        </div>
      </div>
    </div>
  );
}
