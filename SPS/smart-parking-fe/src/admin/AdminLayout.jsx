import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_NAV_ITEMS, ADMIN_ROUTE_META } from "./adminData";
import { AdminIcon } from "./AdminIcons";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import SidebarPromoCard from "../components/SidebarPromoCard";
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
  const partnerSectionOpen = location.pathname.startsWith("/admin/owners");
  const usersSectionOpen = location.pathname.startsWith("/admin/users");
  const parkingSectionOpen = location.pathname.startsWith("/admin/parking-lots");
  
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
    <div className={`admin-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <aside className="admin-sidebar">
        <div className="admin-sidebar-scroll">
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
              {ADMIN_NAV_ITEMS.map((item) => {
                if (item.children) {
                  const groupBase = item.id === "users"
                    ? "/admin/users"
                    : item.id === "parking"
                      ? "/admin/parking-lots"
                      : "/admin/owners";
                  const groupOpen = item.id === "users"
                    ? usersSectionOpen
                    : item.id === "parking"
                      ? parkingSectionOpen
                      : partnerSectionOpen;
                  return (
                    <div key={item.id} className="admin-menu-group">
                      <NavLink
                        to={groupBase}
                        end
                        className={({ isActive }) =>
                          `admin-menu-link admin-menu-group-toggle${isActive || groupOpen ? " active" : ""}`
                        }
                        onClick={() => setSidebarOpen(false)}
                      >
                        <AdminIcon name={item.icon} className="admin-menu-icon" />
                        <span>{item.label}</span>
                      </NavLink>
                      {groupOpen
                        ? item.children.map((child) => (
                            child.disabled ? (
                              <span key={child.label} className="admin-menu-link admin-menu-sublink is-disabled" title="Sắp ra mắt">
                                {child.label}
                              </span>
                            ) : (
                              <NavLink
                                key={child.to + child.label}
                                to={child.to}
                                end={Boolean(child.end)}
                                className={({ isActive }) => `admin-menu-link admin-menu-sublink${isActive ? " active" : ""}`}
                                onClick={() => setSidebarOpen(false)}
                              >
                                <span>{child.label}</span>
                              </NavLink>
                            )
                          ))
                        : null}
                    </div>
                  );
                }

                return (
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
                );
              })}
            </nav>
          </div>

          <SidebarPromoCard variant="admin" />
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
            <button
              type="button"
              className="admin-notify-pill"
              onClick={() => navigate("/admin/notifications")}
              aria-label="Thông báo hệ thống"
              title="Thông báo quan trọng của admin"
            >
              <AdminIcon name="bell" className="admin-menu-icon" />
              {unreadNotificationsCount > 0 ? <span>{unreadNotificationsCount}</span> : null}
            </button>
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
