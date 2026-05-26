import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";

import Booking from "./pages/Booking";
import BookingHistory from "./pages/BookingHistory";
import PaymentHistory from "./pages/PaymentHistory";
import Home from "./pages/Home";
import Login from "./pages/Login";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminNotifications from "./pages/admin/AdminNotifications";
import AdminSettings from "./pages/admin/AdminSettings";
import BookingManagement from "./pages/admin/BookingManagement";
import OwnerManagement from "./pages/admin/OwnerManagement";
import AdminOwnerRegistrations from "./pages/admin/AdminOwnerRegistrations";
import AdminOwnerContracts from "./pages/admin/AdminOwnerContracts";
import ParkingManagement from "./pages/admin/ParkingManagement";
import RevenuePage from "./pages/admin/RevenuePage";
import AdminCommissions from "./pages/admin/AdminCommissions";
import AdminPartnerLayout from "./admin/AdminPartnerLayout";
import UserManagement from "./pages/admin/UserManagement";
import OwnerActivityHistory from "./pages/owner/OwnerActivityHistory";
import OwnerBookings from "./pages/owner/OwnerBookings";
import OwnerCustomers from "./pages/owner/OwnerCustomers";
import OwnerNotifications from "./pages/owner/OwnerNotifications";
import OwnerOverview from "./pages/owner/OwnerOverview";
import OwnerParking from "./pages/owner/OwnerParking";
import OwnerParkingDetail from "./pages/owner/OwnerParkingDetail";
import OwnerParkingMap from "./pages/owner/OwnerParkingMap";
import OwnerRevenueLayout from "./owner/revenue/OwnerRevenueLayout";
import OwnerRevenueOverview from "./owner/revenue/OwnerRevenueOverview";
import OwnerRevenueTransactions from "./owner/revenue/OwnerRevenueTransactions";
import OwnerRevenueWithdrawals from "./owner/revenue/OwnerRevenueWithdrawals";
import OwnerRevenueCommission from "./owner/revenue/OwnerRevenueCommission";
import OwnerReviews from "./pages/owner/OwnerReviews";
import OwnerSettings from "./pages/owner/OwnerSettings";
import Payment from "./pages/Payment";
import PaymentSuccess from "./pages/PaymentSuccess";
import Profile from "./pages/Profile";
import Scan from "./pages/Scan";
import NotificationBell from "./components/NotificationBell";
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
import API, { clearAuth, getAuth, saveAuth } from "./services/api";
import useRealtimeNotifications from "./services/useRealtimeNotifications";
import { WalletProvider } from "./context/WalletContext";
import "./styles/layout.css";
import "./styles/role-theme-sync.css";

const NOTIFICATIONS_KEY = "smart-parking.notifications";

function formatTimeLabel(value) {
  try {
    return new Date(value).toLocaleString("vi-VN");
  } catch {
    return "";
  }
}

function loadNotifications() {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
      // Ignore logout API failures and still clear local auth.
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
          if (!prev) {
            return prev;
          }
          const nextAuth = {
            ...prev,
            user: {
              ...prev.user,
              ...me.data,
            },
          };
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

  if (checkingSession) {
    return null;
  }

  return (
    <WalletProvider authToken={auth?.token} enabled={role === "user"}>
      <AppBody auth={auth} role={role} onLogin={setAuth} onLogout={handleLogout} />
    </WalletProvider>
  );
}

function AppBody({ auth, role, onLogin, onLogout }) {
  const location = useLocation();
  const [notifications, setNotifications] = useState(() => loadNotifications());
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const isOwnerWorkspace = location.pathname.startsWith("/owner");
  const isAdminWorkspace = location.pathname.startsWith("/admin");
  const isEmployeeWorkspace = location.pathname.startsWith("/employee");
  const isOwnerScanPage = location.pathname.startsWith("/scan");
  const displayName = auth?.user?.full_name || auth?.user?.name || auth?.user?.username || auth?.user?.email || "";

  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  }, [notifications]);

  useRealtimeNotifications(
    (payload) => {
      if (payload?.type !== "booking_no_show") {
        return;
      }

      setNotifications((current) => [
        {
          id: `${payload.booking_id || "booking"}-${payload.ts || Date.now()}`,
          title: "Booking quá hạn",
          message: payload.message || "Booking của bạn đã bị hủy do quá thời gian check-in.",
          timeLabel: formatTimeLabel(payload.ts || Date.now()),
          read: false,
        },
        ...current,
      ].slice(0, 20));
    },
    { enabled: Boolean(auth?.token) },
  );

  const toggleNotifications = () => {
    setNotificationsOpen((current) => !current);
    setNotifications((current) => current.map((item) => (item.read ? item : { ...item, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
    setNotificationsOpen(false);
  };

  const removeNotification = (notificationId) => {
    setNotifications((current) => current.filter((item) => item.id !== notificationId));
  };


  const links = useMemo(() => {
    if (!auth) {
      return [];
    }

    const roleLinks = {
      user: [
        { to: "/booking", label: "Đặt chỗ" },
        { to: "/booking-history", label: "Lịch sử booking" },
        { to: "/payment-history", label: "Lịch sử thanh toán" },
        { to: "/profile", label: "Hồ sơ" },
      ],
      owner: [
        { to: "/profile", label: "Hồ sơ" },
        { to: "/scan", label: "Quét QR vào/ra" },
        { to: "/owner/reviews", label: "Đánh giá & phản hồi" },
        { to: "/owner/settings?tab=parking-accounts", label: "Tạo nhân viên" },
      ],
      employee: [
        { to: "/employee", label: "Dashboard Employee" },
      ],
      admin: [
        { to: "/admin", label: "Bảng Admin" },
        { to: "/booking", label: "Đặt chỗ" },
        { to: "/booking-history", label: "Lịch sử booking" },
        { to: "/payment-history", label: "Lịch sử thanh toán" },
        { to: "/profile", label: "Hồ sơ" },
        { to: "/scan", label: "Quét QR vào/ra" },
      ],
    };

    return [{ to: "/", label: "Trang bãi xe" }, ...(roleLinks[role] || [])];
  }, [auth, role]);

  const userInfo = displayName;

  const defaultAuthedRoute = getDefaultRouteByRole(role);

  return (
    <div className={`app-shell${isOwnerWorkspace || isOwnerScanPage ? " app-shell--owner" : ""}${isAdminWorkspace ? " app-shell--admin" : ""}${isEmployeeWorkspace ? " app-shell--employee" : ""}`}>
      {auth && !isOwnerWorkspace && !isAdminWorkspace && !isEmployeeWorkspace && !isOwnerScanPage ? (
        <nav className="app-nav">
          <div className="app-nav-links">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end
                className={({ isActive }) => `app-link${isActive ? " active" : ""}`}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
          <div className="app-nav-user">
            <NotificationBell
              notifications={notifications}
              open={notificationsOpen}
              onToggle={toggleNotifications}
              onClear={clearNotifications}
              onRemove={removeNotification}
            />
            <span>
              {userInfo}
            </span>
            <button type="button" className="app-logout-btn" onClick={onLogout}>
              Đăng xuất
            </button>
          </div>
        </nav>
      ) : null}

      <div className="page-transition">
        <Routes location={location}>
        <Route
          path="/login"
          element={auth ? <Navigate to={defaultAuthedRoute} replace /> : <Login onLogin={onLogin} />}
        />
        <Route
          path="/"
          element={auth ? (role === "user" ? <Home role={role} /> : <Navigate to={defaultAuthedRoute} replace />) : <Navigate to="/login" replace />}
        />
        <Route
          path="/booking"
          element={auth ? <Booking /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/booking-history"
          element={auth ? <BookingHistory /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/payment-history"
          element={auth ? <PaymentHistory /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/profile"
          element={auth && role !== "employee" ? <Profile onAuthUpdated={onLogin} /> : <Navigate to={auth && role === "employee" ? "/employee/profile" : "/login"} replace />}
        />
        <Route
          path="/payment/:bookingId"
          element={auth ? <Payment /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/payment/success/:bookingId"
          element={auth ? <PaymentSuccess /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/scan"
          element={auth && (role === "owner" || role === "admin") ? <Scan /> : <Navigate to="/" replace />}
        />
        <Route
          path="/owner-review-replies"
          element={<Navigate to={auth && role === "owner" ? "/owner/reviews" : auth ? "/" : "/login"} replace />}
        />
        <Route
          path="/employee"
          element={auth && role === "employee" ? <EmployeeLayout auth={auth} onLogout={onLogout} /> : <Navigate to={auth ? "/" : "/login"} replace />}
        >
          <Route index element={<EmployeeDashboard />} />
          <Route path="booking-assist" element={<EmployeeBookingAssist />} />
          <Route path="scanner" element={<EmployeeQrScanner />} />
          <Route path="vehicles" element={<EmployeeVehicles />} />
          <Route path="revenue" element={<EmployeeRevenue />} />
          <Route path="history" element={<EmployeeHistory />} />
          <Route path="profile" element={<EmployeeProfile />} />
        </Route>
        <Route
          path="/owner"
          element={auth && role === "owner" ? <OwnerLayout auth={auth} onLogout={onLogout} /> : <Navigate to={auth && role === "admin" ? "/admin" : "/"} replace />}
        >
          <Route index element={<OwnerOverview />} />
          <Route path="parking" element={<OwnerParking />} />
          <Route path="parking/:parkingId" element={<OwnerParkingDetail />} />
          <Route path="bookings" element={<OwnerBookings />} />
          <Route path="customers" element={<OwnerCustomers />} />
          <Route path="parking-map" element={<OwnerParkingMap />} />
          <Route path="activity" element={<OwnerActivityHistory />} />
          <Route path="revenue" element={<OwnerRevenueLayout />}>
            <Route index element={<OwnerRevenueOverview />} />
            <Route path="transactions" element={<OwnerRevenueTransactions />} />
            <Route path="cash-reconciliation" element={<Navigate to="/owner/revenue" replace />} />
            <Route path="withdrawals" element={<OwnerRevenueWithdrawals />} />
            <Route path="commission" element={<OwnerRevenueCommission />} />
          </Route>
          <Route path="reviews" element={<OwnerReviews />} />
          <Route path="review-replies" element={<Navigate to="/owner/reviews" replace />} />
          <Route path="notifications" element={<OwnerNotifications />} />
          <Route path="settings" element={<OwnerSettings />} />
          <Route path="parking-accounts" element={<Navigate to="/owner/settings?tab=parking-accounts" replace />} />
          <Route path="employees" element={<Navigate to="/owner/settings?tab=parking-accounts" replace />} />
        </Route>
        <Route
          path="/admin"
          element={auth && role === "admin" ? <AdminLayout auth={auth} onLogout={onLogout} /> : <Navigate to="/" replace />}
        >
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<UserManagement />} />
          <Route path="owners" element={<AdminPartnerLayout />}>
            <Route index element={<OwnerManagement />} />
            <Route path="registrations" element={<AdminOwnerRegistrations />} />
            <Route path="commissions" element={<AdminCommissions />} />
            <Route path="contracts" element={<AdminOwnerContracts />} />
          </Route>
          <Route path="commissions" element={<Navigate to="/admin/owners/commissions" replace />} />
          <Route path="parking-lots" element={<ParkingManagement />} />
          <Route path="bookings" element={<BookingManagement />} />
          <Route path="revenue" element={<RevenuePage />} />
          <Route path="analytics" element={<AdminAnalytics />} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="settings" element={<AdminSettings />} />
        </Route>
        <Route path="*" element={<Navigate to={auth ? defaultAuthedRoute : "/login"} replace />} />
      </Routes>
      </div>
    </div>
  );
}

export default App;
