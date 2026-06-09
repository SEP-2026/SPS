import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
  
  // Initialize default date range (today - 6 days to today)
  const getDefaultDateFrom = () => {
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    return sevenDaysAgo.toISOString().split('T')[0];
  };
  
  const getDefaultDateTo = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };
  
  const [dateFrom, setDateFrom] = useState(getDefaultDateFrom());
  const [dateTo, setDateTo] = useState(getDefaultDateTo());

  // Load dashboard stats from backend
  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        const params = new URLSearchParams();
        params.append("range", selectedRange);
        if (selectedRange === "custom" && dateFrom) params.append("dateFrom", dateFrom);
        if (selectedRange === "custom" && dateTo) params.append("dateTo", dateTo);
        
        const response = await API.get(`/admin/dashboard-stats?${params.toString()}`);
        setDashboardStats(response.data);
      } catch (error) {
        console.error("Failed to load dashboard stats:", error);
      } finally {
        setStatsLoading(false);
      }
    };

    fetchDashboardStats();
  }, [selectedRange, dateFrom, dateTo]);

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
  }, [dashboardStats, adminData, selectedRange]);

  const revenueSeries = useMemo(() => {
    // Use backend daily revenue series if available
    if (dashboardStats?.dailyRevenueSeries && dashboardStats.dailyRevenueSeries.length > 0) {
      return dashboardStats.dailyRevenueSeries;
    }
    return [];
  }, [dashboardStats, selectedRange]);

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
  }, [dashboardStats, selectedRange]);

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
  }, [dashboardStats, stats, selectedRange]);

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

      {/* SECTION 1: KPI Cards Row - 6 Cards */}
      <div className="admin-section-1">
        <div className="admin-stat-card-compact">
          <div className="admin-stat-card-icon">📊</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Doanh thu</p>
            <div className="admin-stat-card-value">{formatCurrency(stats.totalRevenue)}</div>
            <span className="admin-stat-card-meta">{trends.revenueChange}</span>
          </div>
        </div>

        <Link to="/admin/owners/commissions" className="admin-stat-card-compact admin-stat-card-compact--link">
          <div className="admin-stat-card-icon">💰</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Hoa hồng</p>
            <div className="admin-stat-card-value">{formatCurrency(stats.totalCommission)}</div>
            <span className="admin-stat-card-meta">{trends.commissionChange} • Xem chi tiết</span>
          </div>
        </Link>

        <Link to="/admin/owners" className="admin-stat-card-compact admin-stat-card-compact--link">
          <div className="admin-stat-card-icon">👥</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Chủ bãi</p>
            <div className="admin-stat-card-value">{stats.totalOwners}</div>
            <span className="admin-stat-card-meta">{adminData?.owners?.filter((o) => o.status === "active").length || 0} hoạt động • Quản lý</span>
          </div>
        </Link>

        <div className="admin-stat-card-compact">
          <div className="admin-stat-card-icon">🅿️</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Tổng bãi</p>
            <div className="admin-stat-card-value">{stats.totalParkingLots}</div>
            <span className="admin-stat-card-meta">{adminData?.parkingLots?.filter((p) => p.status === "pending").length || 0} chờ duyệt</span>
          </div>
        </div>

        <div className="admin-stat-card-compact">
          <div className="admin-stat-card-icon">⏰</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Chế độ</p>
            <div className="admin-stat-card-value">{stats.totalBookings}</div>
            <span className="admin-stat-card-meta">{trends.bookingChange}</span>
          </div>
        </div>

        <div className="admin-stat-card-compact">
          <div className="admin-stat-card-icon">✅</div>
          <div className="admin-stat-card-content">
            <p className="admin-stat-card-label">Booking</p>
            <div className="admin-stat-card-value">{stats.totalBookings}</div>
            <span className="admin-stat-card-meta">{adminData?.bookings?.filter((b) => b.status === "completed").length || 0} hoàn tất</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: 70/30 Layout - Chart + Activities */}
      <div className="admin-section-2">
        {/* 70% - Revenue Chart */}
        <div className="admin-section-2-left">
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
        </div>

        {/* 30% - Recent Activities */}
        <div className="admin-section-2-right">
          <RecentActivities activities={activities} />
        </div>
      </div>

      {/* SECTION 3: 50/50 Layout - Top Owners + Online Users */}
      <div className="admin-section-3">
        {/* 50% - Top Owners */}
        <div className="admin-section-3-left">
          {topOwners.length > 0 && (() => {
            const maxRevenue = Math.max(...topOwners.map((item) => item.gross), 1);
            return (
              <section className="admin-top-owners-card">
                <div className="admin-section-header">
                  <h2>Top chủ bãi theo doanh thu</h2>
                  <p>5 chủ bãi có doanh thu cao nhất</p>
                </div>

                <div className="admin-top-owners-list">
                  {topOwners.map((owner, index) => {
                    const percentage = Math.round((owner.gross / maxRevenue) * 100);
                    // Bar color changes based on percentage: high% = dark cyan, low% = light cyan
                    let barColor = "#0ea5e9"; // default
                    if (percentage >= 75) {
                      barColor = "#06b6d4"; // bright cyan for high revenue
                    } else if (percentage >= 50) {
                      barColor = "#22d3ee"; // lighter cyan
                    } else if (percentage >= 25) {
                      barColor = "#67e8f9"; // even lighter
                    } else {
                      barColor = "#a5f3fc"; // very light cyan for low revenue
                    }
                    return (
                      <article key={owner.name} className="admin-top-owner-row">
                        <span className="admin-top-owner-rank">{index + 1}</span>
                        <div className="admin-top-owner-info">
                          <strong>{owner.name}</strong>
                          <div className="admin-top-owner-bar">
                            <span style={{ width: `${percentage}%`, background: barColor }} />
                          </div>
                        </div>
                        <span className="admin-top-owner-revenue">
                          {formatCurrency(owner.gross)}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })()}
        </div>

        {/* 50% - Online Users Stats */}
        <div className="admin-section-3-right">
          <section className="admin-online-users-card">
            <div className="admin-section-header">
              <h2>Người dùng online</h2>
              <p>Thống kê người dùng hoạt động</p>
            </div>

            <div className="admin-online-users-grid">
              <div className="admin-online-user-stat">
                <div className="admin-online-user-icon">👤</div>
                <div className="admin-online-user-content">
                  <p className="admin-online-user-label">Người dùng</p>
                  <div className="admin-online-user-value">{usersOnlineStats.users}</div>
                </div>
              </div>

              <div className="admin-online-user-stat">
                <div className="admin-online-user-icon">🏢</div>
                <div className="admin-online-user-content">
                  <p className="admin-online-user-label">Chủ bãi</p>
                  <div className="admin-online-user-value">{usersOnlineStats.owners}</div>
                </div>
              </div>

              <div className="admin-online-user-stat">
                <div className="admin-online-user-icon">👨‍💼</div>
                <div className="admin-online-user-content">
                  <p className="admin-online-user-label">Nhân viên</p>
                  <div className="admin-online-user-value">{usersOnlineStats.employees}</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

    </div>
  );
}
