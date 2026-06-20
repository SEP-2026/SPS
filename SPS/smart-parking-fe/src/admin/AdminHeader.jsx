import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bell, CalendarDays, ChevronDown, Clock, FileBarChart, LayoutDashboard, Plus } from "lucide-react";

function formatHeaderDateLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function formatHeaderTimeLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function adminInitial(name) {
  return (name || "Admin").trim().slice(0, 1).toUpperCase();
}

export function AdminHeader({
  adminName,
  meta,
  unreadNotificationsCount,
  syncNote,
  onMenuToggle,
  onLogout,
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="owner-dashboard-header">
      <div className="owner-dashboard-title">
        <button type="button" className="owner-mobile-menu" onClick={onMenuToggle} aria-label="Mở menu admin">
          <LayoutDashboard size={20} />
        </button>
        <div>
          <p>Xin chào, {adminName || "Admin"} 👋</p>
          <h1>{meta?.title || "Bảng quản trị"}</h1>
          <span>{meta?.description || "Trung tâm điều hành hệ thống Smart Parking"}</span>
        </div>
      </div>

      <div className="owner-dashboard-tools">
        <div className="owner-date-picker owner-date-picker--readonly" aria-label="Ngày giờ hiện tại">
          <CalendarDays size={18} />
          <span className="owner-date-picker-text">
            <strong>{formatHeaderDateLabel(now)}</strong>
            <small><Clock size={13} /> {formatHeaderTimeLabel(now)}</small>
          </span>
        </div>

        <Link to="/admin/notifications" className="owner-icon-button" aria-label="Thông báo">
          <Bell size={20} />
          {unreadNotificationsCount > 0 ? <span>{unreadNotificationsCount}</span> : null}
        </Link>

        <div className="owner-header-avatar">
          <span>{adminInitial(adminName)}</span>
          <div>
            <strong>{adminName || "Admin"}</strong>
            <small>{syncNote || "Trung tâm vận hành"}</small>
          </div>
          <ChevronDown size={16} />
        </div>

        <Link to="/admin/parking-lots" className="owner-header-button owner-header-button--light">
          <Plus size={18} />
          <span>Quản lý bãi xe</span>
        </Link>

        <Link to="/admin" className="owner-header-button owner-header-button--primary">
          <FileBarChart size={18} />
          <span>Tổng quan</span>
        </Link>
      </div>
    </header>
  );
}
