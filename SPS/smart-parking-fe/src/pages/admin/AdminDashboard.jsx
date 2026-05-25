import { useMemo, useState, useEffect } from "react";
import { BarChart, LineChart, SectionCard, StatCard, StatusBadge, formatCurrency, formatDateTime } from "../../owner/OwnerUI";
import { PieChart } from "../../owner/PieChart";
import { RevenueSystemChart, RecentActivities } from "../../owner/OwnerDashboardComponents";
import { useAdminContext } from "../../admin/useAdminContext";
import API from "../../services/api";

function normalizeSeries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      label: item?.label || item?.date || "--",
      amount: Number(item?.amount ?? item?.value ?? item?.total ?? 0),
    }))
    .filter((item) => item.label);
}

export default function AdminDashboard() {
  const { adminData } = useAdminContext();
  const [dashboardStats, setDashboardStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [selectedRange, setSelectedRange] = useState("7days");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Load dashboard stats from backend
  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        const response = await API.get("/admin/dashboard-stats");
        setDashboardStats(response.data);
      } catch (error) {
        console.error("Failed to load dashboard stats:", error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchDashboardStats();
  }, []);

  // Use data from dashboard-stats API, fallback to computed values
  const stats = useMemo(() => {
    if (dashboardStats) {
      return {
        totalRevenue: dashboardStats.revenue.totalRevenue,
        totalCommission: dashboardStats.revenue.totalCommission,
        totalOwnerPayout: dashboardStats.revenue.totalOwnerPayout,
        totalUsers: dashboardStats.users.totalUsers,
        activeUsers: dashboardStats.users.activeUsers,
        totalOwners: dashboardStats.users.totalOwners,
        activeOwners: dashboardStats.users.activeOwners,
        totalEmployees: dashboardStats.users.totalEmployees,
        totalParkingLots: dashboardStats.parking.totalParkingLots,
        activeParkingLots: dashboardStats.parking.activeParkingLots,
        averageOccupancy: dashboardStats.parking.averageOccupancy,
        totalBookings: dashboardStats.bookings.totalBookings,
        completedBookings: dashboardStats.bookings.completedBookings,
        pendingBookings: dashboardStats.bookings.pendingBookings,
        cancelledBookings: dashboardStats.bookings.cancelledBookings,
      };
    }
    // Fallback to computing from adminData if stats not loaded yet
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
  }, [dashboardStats, adminData]);

  const revenueSeries = useMemo(() => {
    // Use backend daily revenue series if available
    if (dashboardStats?.dailyRevenueSeries && dashboardStats.dailyRevenueSeries.length > 0) {
      return dashboardStats.dailyRevenueSeries;
    }
    return [];
  }, [dashboardStats]);

  const bookingSeries = useMemo(() => {
    const normalized = normalizeSeries(adminData?.systemRevenue?.bookings);
    const hasValue = normalized.some((item) => item.amount > 0);
    if (normalized.length && hasValue) return normalized;

    const rows = Array.isArray(adminData?.bookings) ? adminData.bookings : [];
    const byDay = new Map();
    rows.forEach((item) => {
      const ts = item?.time || item?.checkIn || item?.created_at || item?.createdAt;
      const d = ts ? new Date(ts) : null;
      if (!d || Number.isNaN(d.getTime())) return;
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) || 0) + 1);
    });
    return Array.from(byDay.entries()).map(([label, amount]) => ({ label, amount }));
  }, [adminData]);

  const parkingStatusSeries = useMemo(() => {
    if (!adminData?.parkingLots) return [];
    const grouped = { active: 0, pending: 0, locked: 0 };
    adminData.parkingLots.forEach((lot) => {
      const status = lot.status || "locked";
      grouped[status] = (grouped[status] || 0) + 1;
    });
    const statusLabels = { active: "Hoạt động", pending: "Chờ duyệt", locked: "Đã khóa" };
    return Object.entries(grouped)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({ label: statusLabels[status] || status, amount: count, status }));
  }, [adminData]);

  const topOwners = useMemo(() => {
    if (!adminData?.owners || !adminData?.transactions) return [];
    const ownerRevenue = {};
    
    const lotRevenue = {};
    adminData.transactions.forEach((tx) => {
      if (!tx.parkingLot) return;
      lotRevenue[tx.parkingLot] = (lotRevenue[tx.parkingLot] || 0) + Number(tx.gross || 0);
    });
    
    adminData.parkingLots.forEach((lot) => {
      if (!lot.owner || lot.owner === "Chưa gán trong CSDL") return;
      ownerRevenue[lot.owner] = (ownerRevenue[lot.owner] || 0) + (lotRevenue[lot.name] || 0);
    });
    
    return Object.entries(ownerRevenue)
      .map(([name, gross]) => ({ name, gross }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 5);
  }, [adminData]);

  const usersOnlineStats = useMemo(() => {
    if (!adminData) return { users: 0, owners: 0, employees: 0 };
    
    const users = adminData.users?.filter(u => u.status === "active").length || 0;
    const owners = adminData.owners?.filter(o => o.status === "active").length || 0;
    const employees = adminData.employees?.length || 0;
    
    return { users, owners, employees };
  }, [adminData]);

  const revenueStats = useMemo(() => {
    if (!adminData?.transactions) return { gross: 0, commission: 0, ownerPayout: 0 };
    
    const paid = adminData.transactions.filter(tx => tx.status === "paid");
    const gross = paid.reduce((sum, tx) => sum + Number(tx.gross || 0), 0);
    const commission = paid.reduce((sum, tx) => sum + Number(tx.commission || 0), 0);
    const ownerPayout = paid.reduce((sum, tx) => sum + Number(tx.ownerPayout || 0), 0);
    
    return { gross, commission, ownerPayout };
  }, [adminData]);

  const systemStatus = useMemo(() => {
    if (dashboardStats?.systemStatus) {
      return dashboardStats.systemStatus;
    }
    // Fallback to defaults
    return {
      uptime: "99.98%",
      cpu: "23%",
      ram: "56%",
      database: "98%",
      apiResponse: "120ms",
      backupTime: new Date().toLocaleString('vi-VN'),
    };
  }, [dashboardStats]);

  const trends = useMemo(() => {
    if (dashboardStats?.trends) {
      return {
        revenueChange: dashboardStats.trends.revenueChange,
        commissionChange: dashboardStats.trends.commissionChange,
        bookingChange: dashboardStats.trends.bookingChange,
        // For additional context (show as tooltip or compare)
        revenueChangePercent: dashboardStats.trends.revenueChangePercent,
        commissionChangePercent: dashboardStats.trends.commissionChangePercent,
        bookingChangePercent: dashboardStats.trends.bookingChangePercent,
      };
    }
    return {
      revenueChange: "0%",
      commissionChange: "0%",
      bookingChange: "0%",
      revenueChangePercent: 0,
      commissionChangePercent: 0,
      bookingChangePercent: 0,
    };
  }, [dashboardStats]);

  const rangeOptions = useMemo(() => [
    { value: "7days", label: "7 ngày" },
    { value: "30days", label: "30 ngày" },
    { value: "90days", label: "90 ngày" },
    { value: "custom", label: "Tùy chỉnh" },
  ], []);

  const revenueSummary = useMemo(() => {
    if (!dashboardStats?.revenue) {
      return [
        { label: "Doanh thu tuần này", value: formatCurrency(0), note: "" },
        { label: "Hoa hồng tuần này", value: formatCurrency(0), note: "" },
        { label: "Giao dịch đã thanh toán", value: "0", note: "" },
      ];
    }
    return [
      { label: "Doanh thu tuần này", value: formatCurrency(dashboardStats.revenue.thisWeekRevenue), note: "" },
      { label: "Hoa hồng tuần này", value: formatCurrency(dashboardStats.revenue.thisWeekCommission), note: "" },
      { label: "Giao dịch đã thanh toán", value: formatCurrency(stats.totalRevenue), note: "" },
    ];
  }, [dashboardStats, stats]);

  const activities = useMemo(() => {
    if (!adminData?.logs) return [];
    
    return adminData.logs.slice(0, 6).map((log) => {
      const typeMap = {
        "checkin": "success",
        "checkout": "success",
        "booking": "info",
        "payment": "success",
        "slot": "warning",
        "error": "error",
        "system": "info",
      };
      
      const iconMap = {
        "checkin": "checkin",
        "checkout": "checkout",
        "booking": "booking",
        "payment": "payment",
        "slot": "slot",
        "error": "error",
        "system": "success",
      };

      return {
        id: log.id || `log-${Math.random()}`,
        icon: iconMap[log.type] || "success",
        title: log.action || "Hoạt động hệ thống",
        detail: log.description || log.message || "Cập nhật từ hệ thống",
        timeLabel: log.time ? (() => {
          const d = new Date(log.time);
          const now = new Date();
          const diff = Math.floor((now - d) / 1000);
          if (diff < 60) return `${diff}s trước`;
          if (diff < 3600) return `${Math.floor(diff / 60)}m trước`;
          if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
          return d.toLocaleDateString("vi-VN");
        })() : "Vừa xong",
        tone: typeMap[log.type] || "info",
        badge: log.status || "Hoàn tất",
      };
    });
  }, [adminData?.logs]);

  return (
    <div className="admin-dashboard">

      {/* Row 1: 2 Big Cards */}
      <div className="admin-big-cards">
        <div className="admin-big-card admin-big-card--blue">
          <div className="admin-card-header">
            <span className="admin-card-icon">📊</span>
            <h2>DOANH THU NỀN TẢNG</h2>
          </div>
          <div className="admin-card-amount">{formatCurrency(stats.totalRevenue)}</div>
          <p className="admin-card-label">Doanh thu tổng</p>
          <div 
            className="admin-card-trend" 
            title={`Tuần này: ${formatCurrency(dashboardStats?.revenue?.thisWeekRevenue || 0)} vs Tuần trước: ${formatCurrency(dashboardStats?.revenue?.lastWeekRevenue || 0)}`}
            style={{ cursor: "help" }}
          >
            📈 {trends.revenueChange} so với tuần trước
          </div>
          <div className="admin-card-chart">
            <LineChart data={revenueSeries.length ? revenueSeries : [{ label: "--", amount: 0 }]} />
          </div>
        </div>

        <div className="admin-big-card admin-big-card--green">
          <div className="admin-card-header">
            <span className="admin-card-icon">💰</span>
            <h2>HOA HỒNG HỢP ĐƯỢC</h2>
          </div>
          <div className="admin-card-amount">{formatCurrency(stats.totalCommission)}</div>
          <p className="admin-card-label">Hoa hồng admin</p>
          <div 
            className="admin-card-trend" 
            title={`Tuần này: ${formatCurrency(dashboardStats?.revenue?.thisWeekCommission || 0)} vs Tuần trước: ${formatCurrency(dashboardStats?.revenue?.lastWeekCommission || 0)}`}
            style={{ cursor: "help" }}
          >
            📈 {trends.commissionChange} so với tuần trước
          </div>
          <div className="admin-card-chart-icon">💵💵💵</div>
        </div>
      </div>

      {/* Row 2: 4 KPI Cards */}
      <div className="admin-kpi-grid">
        <div className="admin-kpi-card admin-kpi-card--purple">
          <div className="admin-kpi-icon">👥</div>
          <h3>TỔNG QUẢN LÝ QUẬN</h3>
          <div className="admin-kpi-value">{stats.totalOwners}</div>
          <p className="admin-kpi-sub">Tài khoản managers</p>
          <div className="admin-kpi-badge">{adminData?.owners?.filter((o) => o.status === "active").length || 0} hoạt động</div>
        </div>

        <div className="admin-kpi-card admin-kpi-card--blue">
          <div className="admin-kpi-icon">🅿️</div>
          <h3>TỔNG BÃI ĐỖ</h3>
          <div className="admin-kpi-value">{stats.totalParkingLots}</div>
          <p className="admin-kpi-sub">Bãi đang được quản lý</p>
          <div className="admin-kpi-badge">{adminData?.parkingLots?.filter((p) => p.status === "pending").length || 0} chờ duyệt</div>
        </div>

        <div className="admin-kpi-card admin-kpi-card--teal">
          <div className="admin-kpi-icon">⏰</div>
          <h3>TỔNG CHẾ ĐỘ</h3>
          <div className="admin-kpi-value">{stats.totalBookings}</div>
          <p className="admin-kpi-sub">Đặt chỗ toàn hệ thống</p>
          <div 
            className="admin-kpi-badge"
            title={`Tuần này: ${dashboardStats?.bookings?.thisWeekBookings || 0} vs Tuần trước: ${dashboardStats?.bookings?.lastWeekBookings || 0}`}
            style={{ cursor: "help" }}
          >
            {trends.bookingChange} {adminData?.bookings?.filter((b) => b.status === "in_progress").length || 0} đang diễn ra
          </div>
        </div>

        <div className="admin-kpi-card admin-kpi-card--gold">
          <div className="admin-kpi-icon">✅</div>
          <h3>TỔNG BOOKING</h3>
          <div className="admin-kpi-value">{stats.totalBookings}</div>
          <p className="admin-kpi-sub">Booking thành công</p>
          <div className="admin-kpi-badge">{adminData?.bookings?.filter((b) => b.status === "completed").length || 0} hoàn tất</div>
        </div>
      </div>

      {/* Row 3: Doanh thu theo ngày + Người dùng online */}
      <div className="owner-two-col">
        <RevenueSystemChart
          data={revenueSeries.length ? revenueSeries.map(item => ({
            label: item.date || item.label,
            revenue: item.revenue || item.amount || 0,
            commission: item.commission || 0
          })) : []}
          totalRevenue={stats.totalRevenue}
          growthLabel={trends.revenueChange}
          summary={revenueSummary}
          isEmpty={!revenueSeries.length}
          subtitle="Thống kê doanh thu theo ngày"
          rangeOptions={rangeOptions}
          selectedRange={selectedRange}
          onRangeChange={setSelectedRange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
        <SectionCard title="Người dùng online" subtitle="Các loại người dùng đang hoạt động">
          <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px"}}>
            <div style={{textAlign: "center", padding: "16px", borderRadius: "12px", background: "rgba(59, 130, 246, 0.08)"}}>
              <div style={{fontSize: "24px", fontWeight: "800", color: "#0f172a"}}>{usersOnlineStats.users}</div>
              <p style={{margin: "8px 0 0", fontSize: "13px", color: "#64748b", fontWeight: "600"}}>Người dùng</p>
            </div>
            <div style={{textAlign: "center", padding: "16px", borderRadius: "12px", background: "rgba(34, 197, 94, 0.08)"}}>
              <div style={{fontSize: "24px", fontWeight: "800", color: "#0f172a"}}>{usersOnlineStats.owners}</div>
              <p style={{margin: "8px 0 0", fontSize: "13px", color: "#64748b", fontWeight: "600"}}>Chủ bãi</p>
            </div>
            <div style={{textAlign: "center", padding: "16px", borderRadius: "12px", background: "rgba(249, 115, 22, 0.08)"}}>
              <div style={{fontSize: "24px", fontWeight: "800", color: "#0f172a"}}>{usersOnlineStats.employees}</div>
              <p style={{margin: "8px 0 0", fontSize: "13px", color: "#64748b", fontWeight: "600"}}>Nhân viên</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Row 4: Hoạt động hệ thống */}
      <RecentActivities activities={activities} />

      {/* Row 5: Top chủ bãi */}
      {topOwners.length > 0 && (
        <SectionCard title="Top chủ bãi theo doanh thu" subtitle="5 chủ bãi có doanh thu cao nhất">
          <div className="owner-activity-list">
            {topOwners.map((owner, idx) => (
              <article key={idx} className="owner-activity-item">
                <div>
                  <span className="owner-badge owner-badge--success">{idx + 1}</span>
                  <h3>{owner.name}</h3>
                </div>
                <strong>{formatCurrency(owner.gross)}</strong>
              </article>
            ))}
          </div>
        </SectionCard>
      )}

    </div>
  );
}
