import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { OwnerIcon } from "../owner/OwnerIcons";
import { getEmployeeParkingLot, getEmployeeProfile, getEmployeeRevenue, getEmployeeSlotsOverview } from "./employeeService";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import SidebarPromoCard from "../components/SidebarPromoCard";
import "./employee.css";
import "./employee-reference.css";
import "./employee-layout-fix.css";
import "../styles/sidebar-promo.css";

const NAV_GROUPS = [
  {
    title: "TỔNG QUAN",
    items: [{ to: "/employee", label: "Tổng quan", icon: "dashboard", end: true }],
  },
  {
    title: "THAO TÁC",
    items: [
      { to: "/employee/scanner", label: "Quét QR", icon: "booking" },
      { to: "/employee/vehicles", label: "Xe trong bãi", icon: "parking" },
      { to: "/employee/booking-assist", label: "Đặt chỗ giúp khách", icon: "customer" },
      { to: "/employee/history", label: "Lịch sử giao dịch", icon: "reviews" },
    ],
  },
  {
    title: "THÔNG TIN BÃI XE",
    items: [
      { to: "/employee/profile", label: "Hồ sơ nhân viên", icon: "analytics" },
      { to: "/employee/revenue", label: "Thông tin bãi", icon: "settings" },
    ],
  },
];

const ROUTE_HINT = {
  "/employee": "Tổng quan vận hành theo thời gian thực.",
  "/employee/scanner": "Quét mã QR để check-in/check-out.",
  "/employee/vehicles": "Theo dõi xe trong bãi theo từng ô đỗ.",
  "/employee/booking-assist": "Hỗ trợ tạo booking cho khách tại bãi.",
  "/employee/history": "Nhật ký thao tác gần đây của nhân viên.",
  "/employee/profile": "Thông tin bãi xe được phân công.",
  "/employee/revenue": "Theo dõi doanh thu và lưu lượng bãi.",
};

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

function resolveStatusLabel(status) {
  if (status === "open") return "Hoạt động tốt";
  if (status === "full") return "Đang đầy";
  if (status === "closed") return "Tạm đóng";
  if (status === "locked") return "Bị khóa";
  return "Đang vận hành";
}

export default function EmployeeLayout({ auth, onLogout }) {
  const [pathName, setPathName] = useState(() => window.location.pathname);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [parkingLot, setParkingLot] = useState(null);
  const [profile, setProfile] = useState(null);
  const [revenue, setRevenue] = useState({ revenueToday: 0, revenueMonth: 0 });
  const [slotsOverview, setSlotsOverview] = useState({ total_slots: 0, available_slots: 0, reserved_slots: 0, in_use_slots: 0, maintenance_slots: 0, slots: [] });
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
    const initialLoadId = window.setTimeout(() => {
      refreshEmployee();
    }, 0);
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

  useEffect(() => {
    const onPopState = () => setPathName(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const displayName = auth?.user?.full_name || auth?.user?.name || auth?.user?.username || "Nhân viên";
  const isParkingLocked = parkingLot?.status === "locked";
  const pageTitle = useMemo(() => parkingLot?.parking_name || "Bãi xe Trường Chinh", [parkingLot?.parking_name]);
  const pageAddress = parkingLot?.address || ROUTE_HINT[pathName] || "Thông tin bãi xe";
  const isMenuItemActive = useCallback(
    (item, isActiveFromNavLink) => {
      if (item.suppressActive) return false;
      return isActiveFromNavLink;
    },
    [],
  );

  return (
    <div className={`employee-shell emp26-shell emp26-exact employee-dashboard-page${sidebarOpen ? " sidebar-open" : ""}${isParkingLocked ? " is-locked" : ""}`}>
      <aside className="employee-sidebar emp26-sidebar employee-sidebar-fixed">
        <div className="employee-sidebar-scroll">
          <div className="employee-brand emp26-brand">
            <div className="employee-brand-mark">SP</div>
            <div>
              <strong>Smart Parking</strong>
              <span>Employee App</span>
            </div>
          </div>

          <div className="emp26-nav-wrap">
            {NAV_GROUPS.map((group) => (
              <section key={group.title} className="emp26-nav-section">
                <p className="employee-sidebar-title">{group.title}</p>
                <nav className="employee-menu">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.label + item.to}
                      to={item.to}
                      end={Boolean(item.end)}
                      className={({ isActive }) => `employee-menu-link${isMenuItemActive(item, isActive) ? " active" : ""}`}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <OwnerIcon name={item.icon} className="owner-menu-icon" />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </nav>
              </section>
            ))}
          </div>

          <SidebarPromoCard variant="employee" />
        </div>

        <button type="button" className="employee-logout" onClick={onLogout}>
          <OwnerIcon name="logout" className="owner-menu-icon" />
          <span>Đăng xuất</span>
        </button>
      </aside>

      <div className="employee-main emp26-main employee-main-content">
        <header className="employee-topbar emp26-topbar employee-header-card">
          <div className="employee-topbar-main">
            <button type="button" className="employee-menu-toggle" onClick={() => setSidebarOpen((v) => !v)}>
              <OwnerIcon name="menu" className="owner-menu-icon" />
            </button>
            <div>
              <p className="employee-kicker">Xin chào, {displayName} 👋</p>
              <h1>{pageTitle}</h1>
              <div className="emp26-topline">
                <span>{pageAddress}</span>
                <span className={`emp26-status-badge is-${String(parkingLot?.status || "open").toLowerCase()}`}>{resolveStatusLabel(parkingLot?.status)}</span>
              </div>
            </div>
          </div>

          <div className="employee-topbar-tools emp26-tools">
            <div className="emp26-tool-card">
              <p>Cổng vào</p>
              <strong>{isParkingLocked ? "Tạm khóa" : "Hoạt động"}</strong>
            </div>
            <div className="emp26-tool-card">
              <strong>{formatTime(now)}</strong>
              <p>{formatDate(now)}</p>
            </div>
            <div className="emp26-icon-btn"><OwnerIcon name="booking" className="owner-menu-icon" /><b>2</b></div>
            <div className="emp26-icon-btn"><OwnerIcon name="bell" className="owner-menu-icon" /><b>3</b></div>
            <div className="employee-avatar emp26-avatar">
              <div className="employee-avatar-mark">{displayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{displayName}</strong>
                <span>{loading ? "Đang đồng bộ..." : syncNote}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="employee-content emp26-content employee-main-scroll">
          <div className="employee-content-layer">
            <Outlet context={{ auth, parkingLot, profile, revenue, slotsOverview, refreshEmployee, loading, syncNote, isParkingLocked }} />
          </div>
        </main>
      </div>
    </div>
  );
}


