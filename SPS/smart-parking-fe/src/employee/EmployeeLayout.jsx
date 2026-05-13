import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { OwnerIcon } from "../owner/OwnerIcons";
import { getEmployeeParkingLot, getEmployeeProfile, getEmployeeRevenue, getEmployeeSlotsOverview } from "./employeeService";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import "./employee.css";

const NAV_ITEMS = [
  { to: "/employee", label: "Bảng điều khiển", icon: "dashboard" },
  { to: "/employee/booking-assist", label: "Đặt chỗ giúp khách", icon: "booking" },
  { to: "/employee/scanner", label: "Quét mã QR", icon: "scan" },
  { to: "/employee/vehicles", label: "Xe trong bãi", icon: "parking" },
  { to: "/employee/revenue", label: "Doanh thu", icon: "revenue" },
  { to: "/employee/history", label: "Lịch sử", icon: "reviews" },
  { to: "/employee/profile", label: "Hồ sơ bãi", icon: "settings" },
];

const ROUTE_HINT = {
  "/employee": "Tổng quan luồng xe và trạng thái bãi theo thời gian thực.",
  "/employee/booking-assist": "Nhân viên tạo đặt chỗ giúp khách hàng tại bãi được phân công.",
  "/employee/scanner": "Xử lý check-in/check-out bằng mã QR tại cổng.",
  "/employee/vehicles": "Theo dõi xe trong bãi và vị trí đỗ trực quan theo ô.",
  "/employee/revenue": "Theo dõi doanh thu theo ngày và theo tháng.",
  "/employee/history": "Nhật ký thao tác gần nhất của nhân viên.",
  "/employee/profile": "Thông tin bãi đỗ đang được phân công vận hành.",
};

export default function EmployeeLayout({ auth, onLogout }) {
  const location = useLocation();
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

  const refreshEmployee = useCallback(async () => {
    setLoading(true);
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
    setSyncNote(failedCount > 0 ? `Đồng bộ thiếu ${failedCount} mục dữ liệu` : "Đồng bộ thành công");
    setLoading(false);
  }, []);

  useRealtimeRefresh(refreshEmployee, { enabled: Boolean(auth?.token), minRefreshIntervalMs: 2000 });

  useEffect(() => {
    refreshEmployee();

    const intervalId = window.setInterval(() => {
      refreshEmployee();
    }, 10000);

    const handleFocus = () => refreshEmployee();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshEmployee();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshEmployee]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const displayName = auth?.user?.username || "nhân viên";
  const routeHint = ROUTE_HINT[location.pathname] || "Không gian vận hành dành cho tài khoản nhân viên.";
  const notificationsCount = Math.max(0, Number(parkingLot?.occupiedSlots || 0));
  const isParkingLocked = parkingLot?.status === "locked";

  return (
    <div className={`employee-shell${sidebarOpen ? " sidebar-open" : ""}${isParkingLocked ? " is-locked" : ""}`}>
      <aside className="employee-sidebar">
        <div className="employee-brand">
          <div className="employee-brand-mark">EP</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Trung tâm vận hành nhân viên</span>
          </div>
        </div>

        <div className="employee-sidebar-panel">
          <p className="employee-sidebar-title">Điều hướng vận hành</p>
          <nav className="employee-menu">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/employee"}
                className={({ isActive }) => `employee-menu-link${isActive ? " active" : ""}${isParkingLocked ? " disabled" : ""}`}
                onClick={(event) => {
                  if (isParkingLocked) {
                    event.preventDefault();
                    return;
                  }
                  setSidebarOpen(false);
                }}
              >
                <OwnerIcon name={item.icon} className="owner-menu-icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <button type="button" className="employee-logout" onClick={onLogout}>
          <OwnerIcon name="logout" className="owner-menu-icon" />
          <span>Đăng xuất</span>
        </button>
      </aside>

      <button
        type="button"
        aria-label="Đóng menu"
        className="employee-sidebar-backdrop"
        onClick={() => setSidebarOpen(false)}
      />

      <div className="employee-main">
        <header className="employee-topbar">
          <div className="employee-topbar-main">
            <button type="button" className="employee-menu-toggle" onClick={() => setSidebarOpen((value) => !value)}>
              <OwnerIcon name="menu" className="owner-menu-icon" />
            </button>
            <div>
              <p className="employee-kicker">Không gian nhân viên</p>
              <h1>{parkingLot?.parking_name || "Bảng điều khiển nhân viên"}</h1>
              <span>{parkingLot?.address || routeHint}</span>
            </div>
          </div>

          <div className="employee-topbar-tools">
            <div className="employee-notify-pill" title="Số xe đang sử dụng chỗ">
              <OwnerIcon name="bell" className="owner-menu-icon" />
              <span>{notificationsCount}</span>
            </div>
            <div className="employee-role-pill">Vận hành bãi</div>
            {isParkingLocked ? <div className="employee-lock-pill">Bãi đang bị khóa</div> : null}
            <div className="employee-avatar">
              <div className="employee-avatar-mark">{displayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{displayName}</strong>
                <span>{loading ? "Đang đồng bộ..." : `${syncNote} · Hôm nay ${Number(revenue.revenueToday || 0).toLocaleString("vi-VN")}đ`}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="employee-content">
          <div className="employee-content-layer">
            <Outlet context={{ auth, parkingLot, profile, revenue, slotsOverview, refreshEmployee, loading, syncNote, isParkingLocked }} />
          </div>
          {isParkingLocked ? (
            <div className="employee-locked-overlay" role="status" aria-live="polite">
              <div className="employee-locked-card">
                <strong>Bãi đang bị admin khóa</strong>
                <span>Toàn bộ chức năng tạm thời bị vô hiệu hóa. Vui lòng đợi mở khóa để tiếp tục thao tác.</span>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
