import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import { OwnerIcon } from "./OwnerIcons";
import { OWNER_NAV_ITEMS, OWNER_ROUTE_META } from "./ownerData";
import { parseVietnamDate } from "../utils/dateTime";
import "./owner.css";

const EMPTY_OWNER_DATA = {
  parkingLot: null,
  parkingLots: [],
  slots: [],
  bookings: [],
  transactions: [],
  activities: [],
  settings: {
    parkingName: "",
    slotCapacity: "0",
    totalSlotCapacity: "0",
    managedParkingCount: "0",
    districtName: "",
    pricePerHour: "0",
    pricePerDay: "0",
    pricePerMonth: "0",
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    parkingLots: [],
  },
  reviews: [],
};

function isTodayIso(value) {
  if (!value) {
    return false;
  }
  const date = parseVietnamDate(value);
  if (!date) {
    return false;
  }
  const now = parseVietnamDate(new Date());
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export default function OwnerLayout({ auth, onLogout }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ownerData, setOwnerData] = useState(EMPTY_OWNER_DATA);
  const [syncNote, setSyncNote] = useState("Đang tải dữ liệu bãi");
  const [isSyncing, setIsSyncing] = useState(true);

  const refreshOwnerData = useCallback(async () => {
    try {
      setIsSyncing(true);
      const res = await API.get("/owner/bootstrap");
      if (res.data?.parkingLot) {
        const managedParkingCount = Array.isArray(res.data.parkingLots) ? res.data.parkingLots.length : 0;
        setOwnerData((prev) => ({
          ...EMPTY_OWNER_DATA,
          ...prev,
          parkingLot: res.data.parkingLot,
          parkingLots: Array.isArray(res.data.parkingLots) ? res.data.parkingLots : prev.parkingLots,
          slots: Array.isArray(res.data.slots) ? res.data.slots : prev.slots,
          bookings: Array.isArray(res.data.bookings) ? res.data.bookings : prev.bookings,
          transactions: Array.isArray(res.data.transactions) ? res.data.transactions : prev.transactions,
          activities: Array.isArray(res.data.activities) ? res.data.activities : prev.activities,
          reviews: Array.isArray(res.data.reviews) ? res.data.reviews : prev.reviews,
          settings: res.data.settings ? { ...prev.settings, ...res.data.settings } : prev.settings,
        }));
        setSyncNote(`Quản lý ${managedParkingCount} bãi đỗ`);
        return;
      }
      setOwnerData({
        ...EMPTY_OWNER_DATA,
        settings: {
          ...EMPTY_OWNER_DATA.settings,
          parkingName: "Chưa được gán bãi",
          slotCapacity: "0",
        },
      });
      setSyncNote("Owner chưa được gán bãi trong CSDL");
    } catch {
      setOwnerData(EMPTY_OWNER_DATA);
      setSyncNote("Không tải được dữ liệu owner từ CSDL");
    } finally {
      setIsSyncing(false);
    }
  }, []);

  useRealtimeRefresh(refreshOwnerData, { enabled: Boolean(auth?.token), minRefreshIntervalMs: 2000 });

  useEffect(() => {
    refreshOwnerData();
  }, [refreshOwnerData]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      refreshOwnerData();
    }, 10000);

    const handleFocus = () => {
      refreshOwnerData();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshOwnerData();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshOwnerData]);

  // Re-render when localStorage changes (from OwnerNotifications page or other tabs)
  const [storageVersion, setStorageVersion] = useState(0);
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "owner_read_notifications") {
        setStorageVersion((prev) => prev + 1);
      }
    };
    
    const handleNotificationsUpdate = () => {
      setStorageVersion((prev) => prev + 1);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("owner_notifications_updated", handleNotificationsUpdate);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("owner_notifications_updated", handleNotificationsUpdate);
    };
  }, []);

  const stats = useMemo(() => {
    const todayRevenue = ownerData.transactions
      .filter((item) => item.status === "paid")
      .filter((item) => isTodayIso(item.time))
      .reduce((sum, item) => sum + item.amount, 0);
    const todayBookings = ownerData.bookings.filter((item) => isTodayIso(item.startTime)).length;
    const activeSlots = ownerData.slots.filter((item) => item.status === "in_use" || item.status === "reserved").length;
    const managedParkingCount = ownerData.parkingLots.length;

    return {
      totalSlots: ownerData.slots.length,
      availableSlots: ownerData.slots.filter((item) => item.status === "available").length,
      usedSlots: activeSlots,
      todayBookings,
      todayRevenue,
      managedParkingCount,
    };
  }, [ownerData]);

  const meta = OWNER_ROUTE_META[location.pathname] || OWNER_ROUTE_META["/owner"];
  
  // Calculate unread notification count from stored read state
  const unreadNotificationsCount = useMemo(() => {
    try {
      const stored = localStorage.getItem("owner_read_notifications");
      const readIds = stored ? new Set(JSON.parse(stored)) : new Set();
      
      let count = 0;
      // Count pending bookings that aren't marked as read
      (ownerData.bookings || []).slice(0, 5).forEach((booking) => {
        if (booking.status === "pending" && !readIds.has(`booking-pending-${booking.id}`)) {
          count++;
        }
        if (booking.status === "confirmed" && !readIds.has(`booking-confirmed-${booking.id}`)) {
          count++;
        }
      });
      // Count unreplied reviews that aren't marked as read
      (ownerData.reviews || []).filter((r) => !r.ownerReply).slice(0, 3).forEach((review) => {
        if (!readIds.has(`review-unreplied-${review.id}`)) {
          count++;
        }
      });
      // Count warning activities that aren't marked as read
      (ownerData.activities || []).slice(0, 5).forEach((activity) => {
        if (activity.type === "warning" && !readIds.has(activity.id)) {
          count++;
        }
      });
      return count;
    } catch {
      return 0;
    }
  }, [ownerData, storageVersion]);
  
  const ownerDisplayName = auth?.user?.full_name || auth?.user?.name || auth?.user?.email || "Owner";

  const actions = {
    async addSlot(payload) {
      try {
        await API.post("/owner/slots", payload);
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể thêm chỗ đỗ");
        return false;
      }
    },
    async updateSlot(id, payload) {
      try {
        await API.patch(`/owner/slots/${id}`, payload);
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể cập nhật chỗ đỗ");
        return false;
      }
    },
    async deleteSlot(id) {
      try {
        await API.delete(`/owner/slots/${id}`);
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể xóa chỗ đỗ");
        return false;
      }
    },
    async updateBookingStatus(id, status) {
      try {
        await API.patch(`/owner/bookings/${id}/status`, { status });
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể cập nhật booking");
        return false;
      }
    },
    async updateSettings(payload) {
      try {
        await API.patch("/owner/settings", {
          contactPhone: payload.contactPhone,
          contactEmail: payload.contactEmail,
        });
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể lưu thông tin owner");
        return false;
      }
    },
    async updateParkingLotSettings(parkingId, payload) {
      try {
        await API.patch(`/owner/parking-lots/${parkingId}/settings`, payload);
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể cập nhật bãi đỗ");
        return false;
      }
    },
    async updateReviewReply(reviewId, reply) {
      try {
        await API.patch(`/owner/reviews/${reviewId}/reply`, { reply });
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể lưu phản hồi đánh giá");
        return false;
      }
    },
    async updateAccount(payload) {
      try {
        const res = await API.patch("/owner/account", payload);
        setOwnerData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            contactEmail: res.data.user.email,
          },
        }));
        setSyncNote("Đã cập nhật tài khoản owner");
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể cập nhật tài khoản");
        return false;
      }
    },
    async createEmployee(payload) {
      try {
        const res = await API.post("/api/owner/create-employee", payload);
        if (res.data?.employee?.email && res.data?.employee?.default_password) {
          window.alert(`Tài khoản employee đã tạo:\nEmail: ${res.data.employee.email}\nMật khẩu: ${res.data.employee.default_password}`);
        }
        await refreshOwnerData();
        return res.data?.employee || null;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể tạo tài khoản nhân viên");
        return null;
      }
    },
    async listEmployees() {
      try {
        const res = await API.get("/api/owner/employees");
        return Array.isArray(res.data?.employees) ? res.data.employees : [];
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể tải danh sách nhân viên");
        return [];
      }
    },
    async updateEmployee(employeeId, payload) {
      try {
        const res = await API.patch(`/api/owner/employees/${employeeId}`, payload);
        await refreshOwnerData();
        return res.data?.employee || null;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể cập nhật tài khoản nhân viên");
        return null;
      }
    },
    async deleteEmployee(employeeId) {
      try {
        await API.delete(`/api/owner/employees/${employeeId}`);
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(error?.response?.data?.detail || "Không thể xóa tài khoản nhân viên");
        return false;
      }
    },
  };

  return (
    <div className={`owner-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <aside className="owner-sidebar">
        <div className="owner-brand">
          <div className="owner-brand-mark">SP</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Owner Console</span>
          </div>
        </div>

        <div className="owner-sidebar-panel">
          <p className="owner-sidebar-title">Điều hướng vận hành</p>
          <nav className="owner-menu">
            {OWNER_NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/owner"}
                className={({ isActive }) => `owner-menu-link${isActive ? " active" : ""}`}
                onClick={() => setSidebarOpen(false)}
              >
                <OwnerIcon name={item.icon} className="owner-menu-icon" />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="owner-sidebar-panel owner-sidebar-panel--compact">
          <p className="owner-sidebar-title">Lối tắt</p>
          <Link to="/" className="owner-shortcut">Trang bãi xe</Link>
          <Link to="/owner/booking-owner" className="owner-shortcut">Đặt chỗ</Link>
          <Link to="/scan" className="owner-shortcut" data-discover="true">Quét QR</Link>
        </div>

        <button type="button" className="owner-logout" onClick={onLogout}>
          <OwnerIcon name="logout" className="owner-menu-icon" />
          <span>Đăng xuất</span>
        </button>
      </aside>

      <div className="owner-main">
        <header className="owner-topbar">
          <div className="owner-topbar-main">
            <button type="button" className="owner-menu-toggle" onClick={() => setSidebarOpen((value) => !value)}>
              <OwnerIcon name="menu" className="owner-menu-icon" />
            </button>
            <div>
              <p className="owner-kicker">Owner Workspace</p>
              <h1>{meta.title}</h1>
              <span>{meta.description}</span>
            </div>
          </div>

          <div className="owner-topbar-tools">
            <Link to="/owner/notifications" className="owner-notify-pill">
              <OwnerIcon name="bell" className="owner-menu-icon" />
              {unreadNotificationsCount > 0 && <span className="owner-notify-badge">{unreadNotificationsCount}</span>}
            </Link>
            <div className="owner-role-pill">Tài khoản vận hành</div>
            <div className="owner-avatar" title={syncNote}>
              <div className="owner-avatar-mark">{ownerDisplayName.slice(0, 1).toUpperCase()}</div>
              <div>
                <strong>{ownerDisplayName}</strong>
                <span>{syncNote}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="owner-content">
          <Outlet context={{ auth, ownerData, stats, actions, isSyncing }} />
        </main>
      </div>
    </div>
  );
}
