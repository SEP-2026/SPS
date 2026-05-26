import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { formatDateTime } from "../../owner/OwnerUI";
import "./AdminNotifications.css";

const NOTIFICATION_TYPES = {
  security: { label: "Security", tone: "danger", icon: "security" },
  warning: { label: "Cảnh báo", tone: "warning", icon: "warning" },
  critical: { label: "Tới hạn", tone: "danger", icon: "critical" },
  error: { label: "Lỗi", tone: "error", icon: "error" },
};

const STORAGE_KEY = "admin_read_notifications";

function NotificationTypeIcon({ name }) {
  const icons = {
    security: (
      <>
        <path d="M12 1v6m0 6v6M4 4l4.5 4.5M15.5 15.5L20 20M4 20l4.5-4.5M15.5 4.5L20 4" />
        <rect x="3" y="3" width="18" height="18" rx="3" />
      </>
    ),
    warning: (
      <>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.5 2.8 17.4A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.6L13.7 4.5a2 2 0 0 0-3.4 0Z" />
      </>
    ),
    critical: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5" />
        <path d="M12 16h.01" />
      </>
    ),
    error: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6M9 9l6 6" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {icons[name] || icons.warning}
    </svg>
  );
}

export default function AdminNotifications() {
  const { adminData } = useOutletContext() || {};
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
    window.dispatchEvent(new CustomEvent("admin_notifications_updated", { detail: { readIds: readNotificationIds } }));
  }, [readNotificationIds]);

  // Build high-priority notifications from adminData
  const allNotifications = useMemo(() => {
    if (!adminData?.notifications) return [];

    return (adminData.notifications || [])
      .filter(n => {
        const level = (n.level || "").toLowerCase();
        return ["error", "critical", "security", "warning"].includes(level);
      })
      .map((notif) => ({
        id: notif.id,
        type: notif.level,
        title: notif.title,
        message: notif.description || "",
        time: notif.time,
        priority: ["security", "critical", "error"].includes(notif.level) ? "high" : "normal",
      }))
      .sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [adminData?.notifications]);

  // Add isRead property
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
    <div className="admin-notifications-page">
      <div className="admin-notifications-header">
        <div>
          <h1>Thông báo hệ thống</h1>
          <p>Theo dõi các vấn đề bảo mật, cảnh báo và sự kiện tới hạn</p>
        </div>

        <div className="notification-controls">
          <select
            className="admin-filter-select"
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
            className="admin-filter-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>
        </div>
      </div>

      <div className="admin-notifications-content">
        {filteredNotifications.length === 0 ? (
          <div className="admin-notifications-empty">
            <div className="admin-notifications-empty-icon">🔔</div>
            <p>Không có thông báo nào.</p>
          </div>
        ) : (
          <div className="notification-list">
            {filteredNotifications.map((notif) => {
              const typeInfo = NOTIFICATION_TYPES[notif.type] || NOTIFICATION_TYPES.warning;
              return (
                <div
                  key={notif.id}
                  className={`notification-item notification-item--${notif.priority} ${
                    !notif.isRead ? "notification-item--unread" : ""
                  }`}
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
                      <span className={`admin-badge admin-badge--${notif.type}`}>
                        {typeInfo.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="notification-summary">
        <div className="notification-summary-item">
          <span className="notification-summary-value">{unreadCount}</span>
          <span className="notification-summary-label">Chưa đọc</span>
        </div>
        <div className="notification-summary-item">
          <span className="notification-summary-value">{filteredNotifications.length}</span>
          <span className="notification-summary-label">Hiển thị</span>
        </div>
        <div className="notification-summary-item">
          <span className="notification-summary-value">{notificationsWithReadStatus.length}</span>
          <span className="notification-summary-label">Tổng cộng</span>
        </div>
      </div>
    </div>
  );
}
