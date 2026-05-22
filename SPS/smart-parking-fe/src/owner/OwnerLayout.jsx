import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import API from "../services/api";
import useRealtimeRefresh from "../services/useRealtimeRefresh";
import { DashboardHeader, OwnerSidebar } from "./OwnerDashboardComponents";
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

function getApiErrorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join("\n");
  }
  return error?.message || fallback;
}

export default function OwnerLayout({ auth, onLogout }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [ownerData, setOwnerData] = useState(EMPTY_OWNER_DATA);
  const [syncNote, setSyncNote] = useState("Đang tải dữ liệu bãi");
  const [isSyncing, setIsSyncing] = useState(true);

  const refreshOwnerData = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) {
        setIsSyncing(true);
      }
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
          isLocked: Boolean(res.data.isLocked),
          lockMessage: res.data.lockMessage || "",
        }));
        if (!silent) {
          setSyncNote(`Quản lý ${managedParkingCount} bãi đỗ`);
        }
        return;
      }
      if (!silent) {
        setOwnerData({
          ...EMPTY_OWNER_DATA,
          settings: {
            ...EMPTY_OWNER_DATA.settings,
            parkingName: "Chưa được gán bãi",
            slotCapacity: "0",
          },
        });
        setSyncNote("Owner chưa được gán bãi trong CSDL");
      }
    } catch {
      if (!silent) {
        setOwnerData((prev) => (prev?.parkingLot ? prev : EMPTY_OWNER_DATA));
        setSyncNote("Không tải được dữ liệu owner từ CSDL");
      }
    } finally {
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }, []);

  useRealtimeRefresh(
    () => refreshOwnerData({ silent: true }),
    { enabled: Boolean(auth?.token), minRefreshIntervalMs: 10000, refreshImmediately: false },
  );

  useEffect(() => {
    refreshOwnerData({ silent: false });
  }, [refreshOwnerData]);

  useEffect(() => {
    const handleFocus = () => {
      refreshOwnerData({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshOwnerData({ silent: true });
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshOwnerData]);

  // Re-render when localStorage changes (from OwnerNotifications page or other tabs)
  const [, setStorageVersion] = useState(0);
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

  const meta = OWNER_ROUTE_META[location.pathname]
    || (location.pathname.startsWith("/owner/parking/") ? {
      title: "Chi tiết bãi đỗ",
      description: "Theo dõi tổng quan, slot, trạng thái và doanh thu nhanh của từng bãi.",
    } : null)
    || OWNER_ROUTE_META["/owner"];
  
  // Calculate unread notification count from stored read state
  const unreadNotificationsCount = (() => {
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
  })();
  
  const ownerDisplayName = auth?.user?.full_name || auth?.user?.name || "Owner One";
  const ownerEmail = auth?.user?.email || ownerData?.settings?.contactEmail || "owner@smartparking.vn";
  const isOwnerLocked = Boolean(ownerData?.isLocked);
  const ownerLockMessage = ownerData?.lockMessage || "Bãi xe của bạn đã bị khóa, vui lòng liên hệ admin.";

  const actions = useMemo(() => ({
    async refreshOwnerData(options = {}) {
      await refreshOwnerData({ silent: Boolean(options.silent) });
      return true;
    },
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
    async createParkingLot(payload) {
      try {
        const res = await API.post("/owner/parking-lots", payload);
        if (res.data?.employee?.email && res.data?.employee?.default_password) {
          window.alert(`Đã tạo bãi đỗ và tài khoản bãi:\nEmail: ${res.data.employee.email}\nMật khẩu: ${res.data.employee.default_password}`);
        }
        await refreshOwnerData();
        return true;
      } catch (error) {
        window.alert(getApiErrorMessage(error, "Không thể tạo bãi đỗ"));
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
          window.alert(`Tài khoản bãi đã tạo:\nEmail: ${res.data.employee.email}\nMật khẩu: ${res.data.employee.default_password}`);
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
  }), [refreshOwnerData]);

  return (
    <div className={`owner-shell min-h-screen w-full bg-[#F8FAFC] flex${sidebarOpen ? " sidebar-open" : ""}${isOwnerLocked ? " is-locked" : ""}`}>
      <OwnerSidebar
        navItems={OWNER_NAV_ITEMS}
        ownerName={ownerDisplayName}
        ownerEmail={ownerEmail}
        onLogout={onLogout}
        isOpen={sidebarOpen}
        onNavigate={() => setSidebarOpen(false)}
      />
      <button
        type="button"
        className="owner-sidebar-backdrop"
        aria-label="Đóng menu owner"
        onClick={() => setSidebarOpen(false)}
      />

      <div className="owner-main flex-1 min-w-0 w-full overflow-x-hidden">
        <DashboardHeader
          ownerName={ownerDisplayName}
          ownerEmail={ownerEmail}
          meta={meta}
          unreadNotificationsCount={unreadNotificationsCount}
          syncNote={syncNote}
          onMenuToggle={() => setSidebarOpen((value) => !value)}
        />

        <main className="owner-content">
          {isOwnerLocked ? (
            <div className="owner-locked-card" role="alert" aria-live="polite">
              <strong>Tài khoản đang bị khóa</strong>
              <span>{ownerLockMessage || "Bãi xe của bạn đã bị khóa, vui lòng liên hệ admin."}</span>
            </div>
          ) : null}
          <div className="owner-content-layer w-full max-w-none px-7 py-6 space-y-6">
            <Outlet context={{ auth, ownerData, stats, actions, isSyncing }} />
          </div>
        </main>
      </div>
    </div>
  );
}
