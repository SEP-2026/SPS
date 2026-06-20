import { Bell } from "lucide-react";

export default function NotificationBell({ notifications = [], open = false, onToggle, onClear, onRemove }) {
  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <div className="notification-bell-wrap">
      <button
        type="button"
        className="notification-bell-btn"
        onClick={onToggle}
        aria-label="Thông báo"
        title="Thông báo"
      >
        <span className="notification-bell-icon" aria-hidden="true">
          <Bell size={20} />
        </span>
        {unreadCount > 0 ? <span className="notification-bell-badge">{unreadCount}</span> : null}
      </button>

      {open ? (
        <div className="notification-panel" role="dialog" aria-label="Danh sách thông báo">
          <div className="notification-panel__header">
            <strong>Thông báo</strong>
            <button type="button" className="notification-panel__clear" onClick={onClear}>
              Xóa tất cả
            </button>
          </div>

          <div className="notification-panel__list">
            {notifications.length === 0 ? (
              <div className="notification-panel__empty">Chưa có thông báo nào.</div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`notification-item${item.read ? "" : " notification-item--unread"}`}
                  onClick={() => onRemove(item.id)}
                >
                  <div className="notification-item__title">{item.title}</div>
                  <div className="notification-item__message">{item.message}</div>
                  <div className="notification-item__time">{item.timeLabel}</div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}