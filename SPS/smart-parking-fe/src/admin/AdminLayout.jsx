import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { ADMIN_NAV_ITEMS, ADMIN_ROUTE_META } from "./adminData";
import { AdminIcon } from "./AdminIcons";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import "./admin.css";
import "../owner/owner.css";

export default function AdminLayout({ auth, onLogout }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [syncNote, setSyncNote] = useState("Đang tải dữ liệu admin");
  const [loading, setLoading] = useState(true);
  const meta = ADMIN_ROUTE_META[location.pathname] || ADMIN_ROUTE_META["/admin"];
  const notificationsCount = adminData?.notifications?.length || adminData?.logs?.length || 0;
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
      await actions.execWithRefresh(() => API.patch(`/admin/parking-lots/${id}`, payload));
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
    <div className={`admin-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="admin-brand-mark">AD</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Trung tâm điều hành</span>
          </div>
        </div>

        <div className="admin-sidebar-panel">
          <p className="admin-sidebar-title">Điều hướng hệ thống</p>
          <nav className="admin-menu">
            {ADMIN_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) => `admin-menu-link${isActive ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <AdminIcon name={item.icon} className="admin-menu-icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <button type="button" className="admin-logout" onClick={onLogout}>
          <AdminIcon name="logout" className="admin-menu-icon" />
          <span>Đăng xuất</span>
        </button>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-main">
            <button type="button" className="admin-menu-toggle" onClick={() => setSidebarOpen((value) => !value)}>
              <AdminIcon name="menu" className="admin-menu-icon" />
            </button>
            <div>
              <p className="admin-kicker">Bảng quản trị</p>
              <h1>{meta.title}</h1>
              <span>{meta.description}</span>
            </div>
          </div>
          <div className="admin-topbar-tools">
            <div className="admin-notify-pill">
              <AdminIcon name="bell" className="admin-menu-icon" />
              <span>{notificationsCount}</span>
            </div>
            <div className="admin-role-pill">Trung tâm vận hành</div>
            <div className="admin-avatar">
              <div className="admin-avatar-mark">{adminDisplayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{adminDisplayName}</strong>
                <span>{syncNote}</span>
              </div>
            </div>
          </div>
        </header>
        <main className="admin-content">
          {loading && !adminData ? <section className="admin-state-card">Đang tải dữ liệu admin từ CSDL...</section> : null}
          {!loading && !adminData ? (
            <section className="admin-state-card admin-state-card--error">
              Không lấy được dữ liệu admin từ backend.
              Có thể backend chưa restart để nhận route `/admin/*` mới hoặc API đang lỗi.
            </section>
          ) : null}
          {adminData ? <Outlet context={{ auth, adminData, stats, actions }} /> : null}
        </main>
      </div>
    </div>
  );
}
