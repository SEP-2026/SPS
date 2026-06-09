import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import Booking from "./pages/Booking";
import BookingHistory from "./pages/BookingHistory";
import Home from "./pages/Home";
import Login from "./pages/Login";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminSettings from "./pages/admin/AdminSettings";
import BookingManagement from "./pages/admin/BookingManagement";
import OwnerManagement from "./pages/admin/OwnerManagement";
import ParkingManagement from "./pages/admin/ParkingManagement";
import RevenuePage from "./pages/admin/RevenuePage";
import UserManagement from "./pages/admin/UserManagement";
import OwnerActivityHistory from "./pages/owner/OwnerActivityHistory";
import OwnerBookings from "./pages/owner/OwnerBookings";
import OwnerCustomers from "./pages/owner/OwnerCustomers";
import OwnerEmployees from "./pages/owner/OwnerEmployees";
import OwnerNotifications from "./pages/owner/OwnerNotifications";
import OwnerOverview from "./pages/owner/OwnerOverview";
import OwnerParking from "./pages/owner/OwnerParking";
import OwnerParkingDetail from "./pages/owner/OwnerParkingDetail";
import OwnerParkingMap from "./pages/owner/OwnerParkingMap";
import OwnerRevenue from "./pages/owner/OwnerRevenue";
import OwnerReviews from "./pages/owner/OwnerReviews";
import OwnerSettings from "./pages/owner/OwnerSettings";
import Payment from "./pages/Payment";
import PaymentSuccess from "./pages/PaymentSuccess";
import Profile from "./pages/Profile";
import Wallet from "./pages/Wallet";
import Scan from "./pages/Scan";
import AdminLayout from "./admin/AdminLayout";
import EmployeeLayout from "./employee/EmployeeLayout";
import OwnerLayout from "./owner/OwnerLayout";
import EmployeeDashboard from "./pages/employee/EmployeeDashboard";
import EmployeeBookingAssist from "./pages/employee/EmployeeBookingAssist";
import EmployeeHistory from "./pages/employee/EmployeeHistory";
import EmployeeProfile from "./pages/employee/EmployeeProfile";
import EmployeeQrScanner from "./pages/employee/EmployeeQrScanner";
import EmployeeRevenue from "./pages/employee/EmployeeRevenue";
import EmployeeVehicles from "./pages/employee/EmployeeVehicles";
import Vehicles from "./pages/Vehicles";
import API, { clearAuth, getAuth, saveAuth } from "./services/api";
import { WalletProvider, useWallet } from "./context/WalletContext";
import "./styles/layout.css";
import "./styles/role-theme-sync.css";

const CURRENCY_FORMATTER = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

const SHARED_NAV_ITEMS = [
  { key: "home", label: "Trang chủ", icon: "🏠", to: "/" },
  { key: "booking", label: "Tìm bãi xe", icon: "🔍", to: "/booking" },
  { key: "booking-history", label: "Lịch sử đặt chỗ", icon: "🕘", to: "/booking-history" },
  { key: "wallet", label: "Ví của tôi", icon: "💳", to: "/wallet" },
  { key: "vehicles", label: "Phương tiện", icon: "🚗", to: "/vehicles" },
  { key: "settings", label: "Cài đặt", icon: "⚙️", to: "/profile#settings", hash: "#settings" },
];

function formatCurrency(value) {
  return CURRENCY_FORMATTER.format(Number(value || 0));
}

function getSidebarItemActive(item, location) {
  if (item.key === "wallet") {
    return location.pathname === "/wallet";
  }

  if (item.hash) {
    return location.pathname === "/profile" && location.hash === item.hash;
  }

  return location.pathname === item.to;
}

function getSidebarAvatarLabel(displayName) {
  return `${displayName || "SP"}`.trim().charAt(0).toUpperCase() || "SP";
}

function SharedSidebar({ auth, displayName, location }) {
  const navigate = useNavigate();
  const { wallet, loading: walletLoading, error: walletError } = useWallet();
  const avatarLabel = getSidebarAvatarLabel(displayName);
  const avatarSrc = auth?.user?.avatar_url || auth?.user?.avatar || auth?.user?.photo_url || "";

  return (
    <aside className="app-sidebar app-sidebar--shared">
      <div className="app-sidebar-brand">
        <div className="app-sidebar-brand-mark">SP</div>
        <div className="app-sidebar-brand-copy">
          <strong>Smart Parking</strong>
          <span>Tìm chỗ đỗ xe dễ dàng</span>
        </div>
      </div>

      <nav className="app-sidebar-links" aria-label="Điều hướng chính">
        {SHARED_NAV_ITEMS.map((item) => {
          const active = getSidebarItemActive(item, location);
          return (
            <button
              key={item.key}
              type="button"
              className={`app-sidebar-link${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              onClick={() => navigate(item.to)}
            >
              <span className="app-sidebar-link-icon" aria-hidden="true">{item.icon}</span>
              <span className="app-sidebar-link-label">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="app-sidebar-wallet">
      <div className="app-sidebar-wallet-head">
        <span>Số dư ví</span>
        <button
          type="button"
          className="app-sidebar-wallet-add"
          aria-label="Mở ví của tôi"
          onClick={() => navigate("/wallet")}
        >
          +
        </button>
      </div>
        {walletLoading ? (
          <div className="app-sidebar-wallet-skeleton" aria-label="Đang tải số dư" />
        ) : walletError ? (
          <p className="app-sidebar-wallet-error">Không tải được số dư</p>
        ) : (
          <strong className="app-sidebar-wallet-value">{formatCurrency(wallet?.balance || 0)}</strong>
        )}
      </div>

      <div className="app-sidebar-support-card">
        <strong>Hỗ trợ 24/7</strong>
        <p>Luôn sẵn sàng hỗ trợ bạn khi cần.</p>
      </div>

      <div className="app-sidebar-user">
        {avatarSrc ? (
          <img className="app-sidebar-avatar" src={avatarSrc} alt={displayName || "User avatar"} />
        ) : (
          <div className="app-sidebar-avatar app-sidebar-avatar--initial">{avatarLabel}</div>
        )}
        <div className="app-sidebar-user-copy">
          <strong>{displayName || "User"}</strong>
          <span>{auth?.user?.email || auth?.user?.username || ""}</span>
        </div>
      </div>
    </aside>
  );
}

function getDefaultRouteByRole(role) {
  if (role === "admin") return "/admin";
  if (role === "employee") return "/employee";
  if (role === "owner") return "/owner";
  return "/";
}

function App() {
  const [auth, setAuth] = useState(() => getAuth());
  const [checkingSession, setCheckingSession] = useState(() => Boolean(getAuth()?.token));
  const role = auth?.user?.role || "";

  const handleLogout = async () => {
    try {
      if (auth?.token) {
        await API.post("/auth/logout");
      }
    } catch {
      // ignore
    } finally {
      clearAuth();
      setAuth(null);
    }
  };

  useEffect(() => {
    const verifySession = async () => {
      if (!auth?.token) {
        setCheckingSession(false);
        return;
      }
      try {
        const me = await API.get("/auth/me");
        setAuth((prev) => {
          if (!prev) return prev;
          const nextAuth = { ...prev, user: { ...prev.user, ...me.data } };
          return saveAuth(nextAuth) || nextAuth;
        });
      } catch {
        clearAuth();
        setAuth(null);
      } finally {
        setCheckingSession(false);
      }
    };
    verifySession();
  }, [auth?.token, auth?.user?.role]);

  if (checkingSession) return null;

  return (
    <WalletProvider authToken={auth?.token} enabled={role === "user"}>
      <AppBody auth={auth} role={role} onLogin={setAuth} onLogout={handleLogout} />
    </WalletProvider>
  );
}

function AppBody({ auth, role, onLogin, onLogout }) {
  const location = useLocation();
  const isOwnerWorkspace = location.pathname.startsWith("/owner");
  const isAdminWorkspace = location.pathname.startsWith("/admin");
  const isEmployeeWorkspace = location.pathname.startsWith("/employee");
  const isOwnerScanPage = location.pathname.startsWith("/scan");
  const displayName = auth?.user?.full_name || auth?.user?.name || auth?.user?.username || auth?.user?.email || "";
  const defaultAuthedRoute = getDefaultRouteByRole(role);
  const showSharedSidebar = Boolean(auth) && role === "user";

  const shellClass = `app-shell${isOwnerWorkspace || isOwnerScanPage ? " app-shell--owner" : ""}${isAdminWorkspace ? " app-shell--admin" : ""}${isEmployeeWorkspace ? " app-shell--employee" : ""}${showSharedSidebar ? " app-shell--shared" : ""}`;

  return (
    <div className={shellClass}>
      <div className={`app-layout${showSharedSidebar ? " app-layout--shared" : ""}`}>
        {showSharedSidebar ? <SharedSidebar auth={auth} displayName={displayName} location={location} /> : null}
        <main className="page-transition app-content">
          <Routes location={location}>
            <Route path="/login" element={auth ? <Navigate to={defaultAuthedRoute} replace /> : <Login onLogin={onLogin} />} />
            <Route path="/" element={auth ? (role === "user" ? <Home role={role} /> : <Navigate to={defaultAuthedRoute} replace />) : <Navigate to="/login" replace />} />
            <Route path="/booking" element={auth ? <Booking /> : <Navigate to="/login" replace />} />
            <Route path="/booking-history" element={auth ? <BookingHistory /> : <Navigate to="/login" replace />} />
            <Route path="/payment-history" element={<Navigate to="/wallet" replace />} />
            <Route path="/profile" element={auth && role !== "employee" ? <Profile onAuthUpdated={onLogin} /> : <Navigate to={auth && role === "employee" ? "/employee/profile" : "/login"} replace />} />
            <Route path="/vehicles" element={auth ? <Vehicles /> : <Navigate to="/login" replace />} />
            <Route path="/wallet" element={auth ? <Wallet /> : <Navigate to="/login" replace />} />
            <Route path="/payment/:bookingId" element={auth ? <Payment /> : <Navigate to="/login" replace />} />
            <Route path="/payment/success/:bookingId" element={auth ? <PaymentSuccess /> : <Navigate to="/login" replace />} />
            <Route path="/scan" element={auth && (role === "owner" || role === "admin") ? <Scan /> : <Navigate to="/" replace />} />
            <Route path="/owner-review-replies" element={<Navigate to={auth && role === "owner" ? "/owner/reviews" : auth ? "/" : "/login"} replace />} />

            <Route path="/employee" element={auth && role === "employee" ? <EmployeeLayout auth={auth} onLogout={onLogout} /> : <Navigate to={auth ? "/" : "/login"} replace />}>
              <Route index element={<EmployeeDashboard />} />
              <Route path="booking-assist" element={<EmployeeBookingAssist />} />
              <Route path="scanner" element={<EmployeeQrScanner />} />
              <Route path="vehicles" element={<EmployeeVehicles />} />
              <Route path="revenue" element={<EmployeeRevenue />} />
              <Route path="history" element={<EmployeeHistory />} />
              <Route path="profile" element={<EmployeeProfile />} />
            </Route>

            <Route path="/owner" element={auth && role === "owner" ? <OwnerLayout auth={auth} onLogout={onLogout} /> : <Navigate to={auth && role === "admin" ? "/admin" : "/"} replace />}>
              <Route index element={<OwnerOverview />} />
              <Route path="parking" element={<OwnerParking />} />
              <Route path="parking/:parkingId" element={<OwnerParkingDetail />} />
              <Route path="bookings" element={<OwnerBookings />} />
              <Route path="customers" element={<OwnerCustomers />} />
              <Route path="parking-map" element={<OwnerParkingMap />} />
              <Route path="activity" element={<OwnerActivityHistory />} />
              <Route path="revenue" element={<OwnerRevenue />} />
              <Route path="reviews" element={<OwnerReviews />} />
              <Route path="review-replies" element={<Navigate to="/owner/reviews" replace />} />
              <Route path="notifications" element={<OwnerNotifications />} />
              <Route path="settings" element={<OwnerSettings />} />
              <Route path="parking-accounts" element={<OwnerEmployees />} />
              <Route path="employees" element={<OwnerEmployees />} />
            </Route>

            <Route path="/admin" element={auth && role === "admin" ? <AdminLayout auth={auth} onLogout={onLogout} /> : <Navigate to="/" replace />}>
              <Route index element={<AdminDashboard />} />
              <Route path="users" element={<UserManagement />} />
              <Route path="owners" element={<OwnerManagement />} />
              <Route path="parking-lots" element={<ParkingManagement />} />
              <Route path="bookings" element={<BookingManagement />} />
              <Route path="revenue" element={<RevenuePage />} />
              <Route path="analytics" element={<AdminAnalytics />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>

            <Route path="*" element={<Navigate to={auth ? defaultAuthedRoute : "/login"} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default App;
