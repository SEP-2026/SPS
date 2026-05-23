import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarPlus,
  Car,
  ChevronDown,
  Clock,
  History,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  QrCode,
  Settings,
  UserRound,
  Wallet,
  X,
} from "lucide-react";

import { getEmployeeParkingLot, getEmployeeProfile, getEmployeeRevenue, getEmployeeSlotsOverview } from "./employeeService";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import "./employee.css";
import "./employee-reference.css";
import "./employee-layout-fix.css";
import "../styles/sidebar-promo.css";
import "./employee-redesign.css";
import "./employee-workspace.css";
import "./employee-sidebar.css";
import "./employee-slot-status.css";

const SIDEBAR_NAV_ITEMS = [
  { to: "/employee", label: "Tổng quan", icon: LayoutDashboard, end: true },
  { to: "/employee/scanner", label: "Quét QR", icon: QrCode },
  { to: "/employee/vehicles", label: "Xe trong bãi", icon: Car },
  { to: "/employee/history", label: "Lịch sử ra/vào", icon: History },
  { to: "/employee/booking-assist", label: "Đặt chỗ hộ", icon: CalendarPlus },
  { to: "/employee/revenue", label: "Doanh thu", icon: Wallet },
  { to: "/employee/profile", label: "Cài đặt", icon: Settings },
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
      <Icon size={18} strokeWidth={2.1} />
      <span>{item.label}</span>
      {item.badge ? <b>{item.badge}</b> : null}
    </NavLink>
  );
}

export default function EmployeeLayout({ auth, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isOverviewPage = location.pathname === "/employee" || location.pathname === "/employee/";

  const workspaceHeader = (() => {
    if (location.pathname.startsWith("/employee/scanner")) {
      return {
        eyebrow: "Quản lý vận hành",
        title: "Quét QR",
        subtitle: "Quét QR để nhận diện booking, check-in/check-out và xử lý thanh toán tại cổng.",
      };
    }
    if (location.pathname.startsWith("/employee/vehicles")) {
      return {
        eyebrow: "Quản lý vận hành",
        title: "Xe trong bãi",
        subtitle: "Theo dõi sơ đồ bãi, trạng thái ô đỗ và thông tin xe đang lưu bãi.",
      };
    }
    if (location.pathname.startsWith("/employee/history")) {
      return {
        eyebrow: "Lịch sử vận hành",
        title: "Lịch sử ra/vào",
        subtitle: "Xem lịch sử check-in, check-out và các hoạt động tại bãi xe.",
      };
    }
    if (location.pathname.startsWith("/employee/booking-assist")) {
      return {
        eyebrow: "Quản lý vận hành",
        title: "Đặt chỗ giúp khách",
        subtitle: "Chọn vị trí trống, nhập thông tin khách và tạo booking hộ.",
      };
    }
    if (location.pathname.startsWith("/employee/revenue")) {
      return {
        eyebrow: "Thông tin bãi / Doanh thu",
        title: "Doanh thu",
        subtitle: "Theo dõi doanh thu, lưu lượng và trạng thái lấp đầy bãi xe.",
      };
    }
    if (location.pathname.startsWith("/employee/profile")) {
      return {
        eyebrow: "Tài khoản",
        title: "Cài đặt & hồ sơ",
        subtitle: "Quản lý thông tin nhân viên và các tùy chọn liên quan.",
      };
    }
    return null;
  })();
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
  const displayName =
    profile?.employee?.full_name
    || auth?.user?.full_name
    || auth?.user?.name
    || auth?.user?.username
    || "Nguyễn Văn An";
  const pageTitle = parkingLot?.parking_name || profile?.parking_lot?.parking_name || "Bãi xe Trường Chinh";
  const lotShortName = pageTitle.replace(/^Bãi xe\s+/i, "").trim() || pageTitle;
  const pageAddress = parkingLot?.address || profile?.parking_lot?.address || "Trường Chinh, Tân Phú, TP.HCM";
  const currentShift = "Ca sáng (06:00 - 14:00)";
  const headerTitle = isOverviewPage
    ? `Tổng quan bãi xe ${lotShortName}`
    : workspaceHeader?.title || pageTitle;
  const headerSubtitle = isOverviewPage
    ? "Theo dõi hoạt động và quản lý công việc trong ca làm"
    : workspaceHeader?.subtitle || pageAddress;
  const headerEyebrow = isOverviewPage ? null : workspaceHeader?.eyebrow;

  return (
    <div className={`employee-shell employee-modern-shell${sidebarOpen ? " sidebar-open" : ""}${isParkingLocked ? " is-locked" : ""}`}>
      <aside className="employee-sidebar employee-modern-sidebar">
        <div className="employee-modern-brand">
          <div className="employee-modern-brand-mark">SP</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Nhân viên bãi xe</span>
          </div>
        </div>

        <div className="employee-modern-sidebar-main">
          <nav className="employee-modern-nav employee-modern-nav--flat" aria-label="Menu nhân viên">
            {SIDEBAR_NAV_ITEMS.map((item) => (
              <SidebarItem key={item.label} item={item} closeSidebar={() => setSidebarOpen(false)} />
            ))}
          </nav>

          <div className="employee-realtime-card">
            <div className="employee-realtime-row">
              <div className="employee-realtime-media">
                <img src="/owner-promo-car.png" alt="" onError={(event) => { event.currentTarget.src = "/car-top-view.png"; }} />
              </div>
              <div className="employee-realtime-copy">
                <strong>Vận hành realtime</strong>
                <small>Quét QR & cập nhật trạng thái bãi</small>
              </div>
            </div>
            <NavLink to="/employee/scanner" className="employee-realtime-button" onClick={() => setSidebarOpen(false)}>
              Quét QR
            </NavLink>
          </div>
        </div>

        <div className="employee-modern-sidebar-bottom">
          <div className="employee-modern-lot-card">
            <span className="employee-modern-lot-icon">P</span>
            <div>
              <strong title={pageTitle}>{lotShortName}</strong>
              <small>{currentShift}</small>
            </div>
          </div>

          <button type="button" className="employee-modern-logout" onClick={onLogout}>
            <LogOut size={18} />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      <div className="employee-main employee-modern-main">
        <header className={`employee-modern-header${isOverviewPage ? " is-overview" : " is-workspace"}`}>
          <button type="button" className="employee-modern-menu-toggle" onClick={() => setSidebarOpen((value) => !value)} aria-label="Mở menu">
            {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
          </button>

          <div className="employee-modern-title-block">
            <p>{headerEyebrow || `Xin chào, ${displayName} 👋`}</p>
            <h1>{headerTitle}</h1>
            <span className={isOverviewPage || workspaceHeader ? "employee-modern-header-subtitle" : ""}>
              {!isOverviewPage && !workspaceHeader ? <MapPin size={17} /> : null}
              {headerSubtitle}
            </span>
          </div>

          <div className="employee-modern-header-tools">
            {!isOverviewPage ? <ParkingStatusLabel status={parkingLot?.status} /> : null}
            {isOverviewPage ? (
              <div className="employee-modern-lot-chip">
                <span className="employee-modern-lot-icon">P</span>
                <div>
                  <strong>{lotShortName}</strong>
                  <small>{currentShift}</small>
                </div>
              </div>
            ) : null}
            <div className="employee-modern-clock-card">
              <Clock size={20} />
              <div>
                <strong>{formatTime(now)}</strong>
                <small>{formatDate(now)}</small>
              </div>
            </div>
            <button type="button" className="employee-modern-icon-button" aria-label="Thông báo" onClick={() => navigate("/employee/history")}>
              <Bell size={20} />
            </button>
            <button type="button" className="employee-modern-icon-button" aria-label="Quét QR" onClick={() => navigate("/employee/scanner")}>
              <QrCode size={20} />
            </button>
            <button type="button" className="employee-modern-report-btn" onClick={() => navigate("/employee/revenue")}>
              Báo cáo nhanh
            </button>
            <button type="button" className="employee-modern-header-avatar" onClick={() => navigate("/employee/profile")} aria-label="Tài khoản nhân viên">
              <UserRound size={18} />
              <span>{displayName.slice(0, 1).toUpperCase()}</span>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <main className={`employee-modern-content${isOverviewPage ? " is-overview" : " is-workspace"}`}>
          <Outlet context={{ auth, parkingLot, profile, revenue, slotsOverview, refreshEmployee, loading, syncNote, isParkingLocked }} />
        </main>
      </div>

      <div className="employee-modern-mobile-scrim" onClick={() => setSidebarOpen(false)} />
    </div>
  );
}
