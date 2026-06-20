import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_NAV_ITEMS, ADMIN_ROUTE_META } from "./adminData";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import { AdminHeader, AdminSidebar } from "./AdminDashboardComponents";
import "./admin.css";
import "./AdminPartners.css";
import "../owner/owner.css";
import "../styles/sidebar-promo.css";

function resolveAdminRouteMeta(pathname) {
  if (ADMIN_ROUTE_META[pathname]) {
    return ADMIN_ROUTE_META[pathname];
  }
  const matches = Object.entries(ADMIN_ROUTE_META)
    .filter(([route]) => route !== "/admin" && pathname.startsWith(route))
    .sort((a, b) => b[0].length - a[0].length);
  return matches[0]?.[1] || ADMIN_ROUTE_META["/admin"];
}

export default function AdminLayout({ auth, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [syncNote, setSyncNote] = useState("Đang tải dữ liệu admin");
  const [loading, setLoading] = useState(true);
  const meta = useMemo(() => resolveAdminRouteMeta(location.pathname), [location.pathname]);
  const [notificationStorageVersion, setNotificationStorageVersion] = useState(0);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key === "admin_read_notifications") {
        setNotificationStorageVersion((value) => value + 1);
      }
    };
    const handleNotificationsUpdate = () => {
      setNotificationStorageVersion((value) => value + 1);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("admin_notifications_updated", handleNotificationsUpdate);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("admin_notifications_updated", handleNotificationsUpdate);
    };
  }, []);

  // Filter only high-priority notifications for admin: errors, security issues, warnings
  const highPriorityNotifications = useMemo(() => {
    if (!adminData?.notifications) return [];
    return adminData.notifications.filter((n) => {
      const level = (n.level || "").toLowerCase();
      return ["error", "critical", "security", "warning", "success"].includes(level);
    });
  }, [adminData?.notifications]);

  const unreadNotificationsCount = useMemo(() => {
    try {
      const stored = localStorage.getItem("admin_read_notifications");
      const readIds = stored ? new Set(JSON.parse(stored)) : new Set();
      return highPriorityNotifications.filter((n) => !readIds.has(n.id)).length;
    } catch {
      return highPriorityNotifications.length;
    }
  }, [highPriorityNotifications, notificationStorageVersion]);
  const adminDisplayName = auth?.user?.full_name || auth?.user?.name || auth?.user?.email || "Admin";

  const refreshAdminData = useCallback(async ({ silent = false } = {}) => {
    if (!silent && !adminData) {
      setLoading(true);
    }

    try {
      const res = await API.get("/admin/bootstrap");
      setAdminData(res.data);
      if (!silent) {
        setSyncNote("Đồng bộ từ CSDL");
      }
    } catch {
      if (!silent) {
        setSyncNote("Không tải được dữ liệu admin");
      }
      if (!adminData) {
        setAdminData(null);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [adminData]);

  useRealtimeRefresh(() => refreshAdminData({ silent: true }), { enabled: Boolean(auth?.token), minRefreshIntervalMs: 2500 });

  useEffect(() => {
    refreshAdminData({ silent: false });
  }, [refreshAdminData]);

  useEffect(() => {
    document.documentElement.classList.add("admin-page-lock");
    document.body.classList.add("admin-page-lock");
    return () => {
      document.documentElement.classList.remove("admin-page-lock");
      document.body.classList.remove("admin-page-lock");
    };
  }, []);

  const stats = useMemo(() => {
    if (!adminData) {
      return {
        totalUsers: 0,
        totalOwners: 0,
        totalParkingLots: 0,
        totalBookings: 0,
        totalRevenue: 0,
        totalCommission: 0,
      };
    }
    const totalGross = adminData.transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.gross, 0);
    const totalCommission = adminData.transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.commission, 0);
    return {
      totalUsers: adminData.users.length,
      totalOwners: adminData.owners.length,
      totalParkingLots: adminData.parkingLots.length,
      totalBookings: adminData.bookings.length,
      totalRevenue: totalGross,
      totalCommission,
    };
  }, [adminData]);

  const actions = {
    async execWithRefresh(task) {
      try {
        await task();
        await refreshAdminData({ silent: false });
        return true;
      } catch (error) {
        const message = error?.response?.data?.detail || "Không thể thực hiện thao tác";
        window.alert(message);
        return false;
      }
    },
    async toggleUserStatus(id, status) {
      await actions.execWithRefresh(() => API.patch(`/admin/users/${id}/status`, { status }));
    },
    async toggleOwnerStatus(id, status) {
      await actions.execWithRefresh(() => API.patch(`/admin/owners/${id}/status`, { status }));
    },
    async updateOwner(id, payload) {
      return actions.execWithRefresh(() => API.patch(`/admin/owners/${id}`, payload));
    },
    async resetOwnerPassword(id) {
      await actions.execWithRefresh(async () => {
        const res = await API.post(`/admin/owners/${id}/reset-password`);
        window.alert(`Mật khẩu tạm: ${res.data.temporary_password}`);
      });
    },
    async deleteOwner(id) {
      await actions.execWithRefresh(() => API.delete(`/admin/owners/${id}`));
    },
    async addOwner(payload) {
      const res = await API.post("/admin/owners", payload);
      window.alert(`Đã tạo chủ khu vực. Mật khẩu mặc định: ${res.data.default_password}`);
      if (res.data && res.data.owner) {
        setAdminData((prev) => ({
          ...prev,
          owners: [...(prev?.owners || []), res.data.owner],
        }));
      } else {
        const synth = {
          id: res.data && res.data.id ? res.data.id : Date.now(),
          name: payload.name,
          email: payload.email,
          parkingLots: payload.parkingLot ? [{ id: null, name: payload.parkingLot }] : [],
          parkingLot: payload.parkingLot || "Chưa gán trong CSDL",
          status: "active",
          performance: "0 lượt đặt chỗ • 0% lấp đầy",
          passwordHint: res.data?.default_password ? `Mật khẩu: ${res.data.default_password}` : "Có thể reset từ admin",
        };
        setAdminData((prev) => ({
          ...prev,
          owners: [...(prev?.owners || []), synth],
        }));
      }
      refreshAdminData({ silent: false });
    },
    async updateParkingLot(id, payload) {
      return actions.execWithRefresh(() => API.patch(`/admin/parking-lots/${id}`, payload));
    },
    async addParkingLot(payload) {
      await actions.execWithRefresh(() => API.post("/admin/parking-lots", payload));
    },
    async deleteParkingLot(id) {
      await actions.execWithRefresh(() => API.delete(`/admin/parking-lots/${id}`));
    },
    async updateBookingStatus(id, status) {
      const bookingId = String(id).replace(/^BK-/, "");
      await actions.execWithRefresh(() => API.patch(`/admin/bookings/${bookingId}/status`, { status }));
    },
    async updateSettings(payload) {
      const res = await API.patch("/admin/settings", payload);
      setAdminData((prev) => ({ ...prev, settings: res.data.settings }));
      setSyncNote("Đã cập nhật cấu hình admin");
    },
    async rebuildOwnerAssignments() {
      const res = await API.post("/admin/rebuild-owner-assignments");
      await refreshAdminData({ silent: false });
      return res.data;
    },
    async autoAssignOwners() {
      const res = await API.post("/admin/auto-assign-owners");
      await refreshAdminData({ silent: false });
      return res.data;
    },
    async getOwnerAssignmentsDebug() {
      const res = await API.get("/admin/owner-assignments-debug");
      return Array.isArray(res.data) ? res.data : [];
    },
  };

  return (
    <div className={`owner-shell min-h-screen w-full flex${sidebarOpen ? " sidebar-open" : ""}`}>
      <AdminSidebar
        navItems={ADMIN_NAV_ITEMS}
        adminName={adminDisplayName}
        adminEmail={auth?.user?.email || "admin@smartparking.vn"}
        onLogout={onLogout}
        isOpen={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <button
        type="button"
        className="owner-sidebar-backdrop"
        aria-label="Đóng menu admin"
        onClick={() => setSidebarOpen(false)}
      />

      <div className="owner-main flex-1 min-w-0 w-full overflow-x-hidden">
        <AdminHeader
          adminName={adminDisplayName}
          meta={meta}
          unreadNotificationsCount={unreadNotificationsCount}
          syncNote={syncNote}
          onMenuToggle={() => setSidebarOpen((value) => !value)}
          onLogout={onLogout}
        />

        <main className="owner-content">
          {loading && !adminData ? (
            <div className="owner-state-card owner-state-card--loading">
              <span>Đang tải dữ liệu admin từ CSDL...</span>
            </div>
          ) : null}
          {!loading && !adminData ? (
            <div className="owner-state-card owner-state-card--error">
              <strong>Không lấy được dữ liệu admin từ backend.</strong>
              <span>Có thể backend chưa restart để nhận route `/admin/*` mới hoặc API đang lỗi.</span>
            </div>
          ) : null}
          {adminData ? <Outlet context={{ auth, adminData, stats, actions }} /> : null}
        </main>
      </div>
    </div>
  );
}
