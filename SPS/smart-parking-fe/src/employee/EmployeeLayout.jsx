import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  Bell,
  Building2,
  CalendarPlus,
  Car,
  ChevronDown,
  Clock,
  History,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  Menu,
  MoreVertical,
  QrCode,
  Search,
  Settings,
  ShieldAlert,
  SquareParking,
  UserRound,
  Wrench,
  X,
} from "lucide-react";

import { getEmployeeParkingLot, getEmployeeProfile, getEmployeeRevenue, getEmployeeSlotsOverview } from "./employeeService";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import "./employee.css";
import "./employee-reference.css";
import "./employee-layout-fix.css";
import "../styles/sidebar-promo.css";

const NAV_GROUPS = [
  {
    title: "TỔNG QUAN",
    items: [{ to: "/employee", label: "Tổng quan", icon: LayoutDashboard, end: true }],
  },
  {
    title: "QUẢN LÝ VẬN HÀNH",
    items: [
      { to: "/employee/scanner", label: "Quét QR", icon: QrCode },
      { to: "/employee/vehicles", label: "Xe trong bãi", icon: Car },
      { to: "/employee/booking-assist", label: "Đặt chỗ giúp khách", icon: CalendarPlus },
      { to: "/employee/scanner", label: "Tìm booking", icon: Search, softActive: true },
      { to: "/employee/history", label: "Lịch sử giao dịch", icon: History },
    ],
  },
  {
    title: "THÔNG TIN BÃI XE",
    items: [
      { to: "/employee/vehicles", label: "Sơ đồ bãi xe", icon: Map, softActive: true },
      { to: "/employee/revenue", label: "Thông tin bãi", icon: Building2 },
    ],
  },
  {
    title: "HỖ TRỢ",
    items: [
      { to: "/employee/history", label: "Thông báo", icon: Bell, badge: "3", softActive: true },
      { to: "/employee/profile", label: "Báo sự cố", icon: ShieldAlert, softActive: true },
    ],
  },
  {
    title: "CÀI ĐẶT",
    items: [{ to: "/employee/profile", label: "Cài đặt", icon: Settings, softActive: true }],
  },
];

function formatDate(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function formatTime(value) {
  if (!value) return "--:--:--";
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value);
}

function ParkingStatusLabel({ status }) {
  const normalized = String(status || "open").toLowerCase();
  const isHealthy = !["closed", "locked", "full"].includes(normalized);
  return (
    <div className="employee-modern-status-card">
      <span className={`employee-modern-dot${isHealthy ? " is-online" : " is-warning"}`} />
      <div>
        <small>Trạng thái bãi</small>
        <strong>{isHealthy ? "Hoạt động bình thường" : "Cần chú ý"}</strong>
      </div>
    </div>
  );
}

function SidebarItem({ item, closeSidebar }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={Boolean(item.end)}
      className={({ isActive }) => `employee-modern-nav-link${isActive && !item.softActive ? " active" : ""}`}
      onClick={closeSidebar}
    >
      <Icon size={19} strokeWidth={2.1} />
      <span>{item.label}</span>
      {item.badge ? <b>{item.badge}</b> : null}
    </NavLink>
  );
}

export default function EmployeeLayout({ auth, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [parkingLot, setParkingLot] = useState(null);
  const [profile, setProfile] = useState(null);
  const [revenue, setRevenue] = useState({ revenueToday: 0, revenueMonth: 0 });
  const [slotsOverview, setSlotsOverview] = useState({
    total_slots: 0,
    available_slots: 0,
    reserved_slots: 0,
    in_use_slots: 0,
    maintenance_slots: 0,
    slots: [],
  });
  const [loading, setLoading] = useState(true);
  const [syncNote, setSyncNote] = useState("Đang đồng bộ...");
  const [now, setNow] = useState(() => new Date());
  const hasLoadedOnceRef = useRef(false);

  const refreshEmployee = useCallback(async () => {
    const isInitialLoad = !hasLoadedOnceRef.current;
    if (isInitialLoad) setLoading(true);

    const [parkingLotRes, profileRes, revenueRes, slotsOverviewRes] = await Promise.allSettled([
      getEmployeeParkingLot(),
      getEmployeeProfile(),
      getEmployeeRevenue(),
      getEmployeeSlotsOverview(),
    ]);

    if (parkingLotRes.status === "fulfilled") setParkingLot(parkingLotRes.value);
    if (profileRes.status === "fulfilled") setProfile(profileRes.value);
    if (revenueRes.status === "fulfilled") setRevenue(revenueRes.value);
    if (slotsOverviewRes.status === "fulfilled") setSlotsOverview(slotsOverviewRes.value);

    const failedCount = [parkingLotRes, profileRes, revenueRes, slotsOverviewRes].filter((item) => item.status === "rejected").length;
    setSyncNote(failedCount > 0 ? `Đồng bộ thiếu ${failedCount} mục` : "Đồng bộ thành công");

    if (isInitialLoad) {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, []);

  useRealtimeRefresh(refreshEmployee, { enabled: Boolean(auth?.token), minRefreshIntervalMs: 2000 });

  useEffect(() => {
    const initialLoadId = window.setTimeout(refreshEmployee, 0);
    const intervalId = window.setInterval(refreshEmployee, 10000);

    window.addEventListener("focus", refreshEmployee);
    document.addEventListener("visibilitychange", refreshEmployee);

    return () => {
      window.clearTimeout(initialLoadId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshEmployee);
      document.removeEventListener("visibilitychange", refreshEmployee);
    };
  }, [refreshEmployee]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isParkingLocked = parkingLot?.status === "locked";
  const displayName = "Nguyễn Văn An";
  const pageTitle = "Bãi xe Trường Chinh";
  const pageAddress = "Trường Chinh, Tân Phú, TP.HCM";

  return (
    <div className={`employee-shell employee-modern-shell${sidebarOpen ? " sidebar-open" : ""}${isParkingLocked ? " is-locked" : ""}`}>
      <aside className="employee-sidebar employee-modern-sidebar">
        <div className="employee-modern-sidebar-scroll">
          <div className="employee-modern-brand">
            <div className="employee-modern-brand-mark">SP</div>
            <div>
              <strong>Smart Parking</strong>
              <span>Employee Dashboard</span>
            </div>
          </div>

          <div className="employee-modern-nav">
            {NAV_GROUPS.map((group) => (
              <section key={group.title} className="employee-modern-nav-section">
                <p>{group.title}</p>
                <nav>
                  {group.items.map((item) => (
                    <SidebarItem key={`${group.title}-${item.label}`} item={item} closeSidebar={() => setSidebarOpen(false)} />
                  ))}
                </nav>
              </section>
            ))}
          </div>
        </div>

        <div className="employee-modern-sidebar-bottom">
          <div className="employee-modern-profile-card">
            <div className="employee-modern-avatar">
              <UserRound size={21} />
              <span />
            </div>
            <div>
              <strong>{displayName}</strong>
              <small>Nhân viên bãi xe</small>
            </div>
            <ChevronDown size={18} />
          </div>
          <button type="button" className="employee-modern-logout" onClick={onLogout}>
            <LogOut size={18} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      <div className="employee-modern-main">
        <header className="employee-modern-header">
          <button type="button" className="employee-modern-menu-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label="Mở menu">
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div className="employee-modern-title-block">
            <p>Xin chào, {displayName} 👋</p>
            <h1>{pageTitle}</h1>
            <span>
              <MapPin size={17} />
              {pageAddress}
            </span>
          </div>

          <div className="employee-modern-header-tools">
            <ParkingStatusLabel status={parkingLot?.status} />
            <div className="employee-modern-clock-card">
              <Clock size={20} />
              <div>
                <strong>{formatTime(now)}</strong>
                <small>{formatDate(now)}</small>
              </div>
            </div>
            <button type="button" className="employee-modern-icon-button" aria-label="Thông báo">
              <Bell size={20} />
              <b className="is-red">3</b>
            </button>
            <button type="button" className="employee-modern-icon-button" aria-label="Mã QR đang chờ">
              <QrCode size={20} />
              <b className="is-blue">4</b>
            </button>
          </div>
        </header>

        <main className="employee-modern-content">
          <Outlet context={{ auth, parkingLot, profile, revenue, slotsOverview, refreshEmployee, loading, syncNote, isParkingLocked }} />
        </main>
      </div>

      <div className="employee-modern-mobile-scrim" onClick={() => setSidebarOpen(false)} />
      <Wrench className="employee-modern-hidden-icon" size={1} aria-hidden="true" />
      <SquareParking className="employee-modern-hidden-icon" size={1} aria-hidden="true" />
      <MoreVertical className="employee-modern-hidden-icon" size={1} aria-hidden="true" />
    </div>
  );
}
