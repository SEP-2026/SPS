import { useMemo } from "react";
import { BarChart, LineChart, SectionCard, StatCard, StatusBadge, formatCurrency, formatDateTime } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";

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
  const { adminData, stats } = useAdminContext();

  const revenueSeries = useMemo(() => {
    const normalized = normalizeSeries(adminData?.systemRevenue?.revenue);
    const hasValue = normalized.some((item) => item.amount > 0);
    if (normalized.length && hasValue) return normalized;

    const tx = Array.isArray(adminData?.transactions) ? adminData.transactions : [];
    const byDay = new Map();
    tx.filter((item) => item?.status === "paid").forEach((item) => {
      const d = item?.time ? new Date(item.time) : null;
      if (!d || Number.isNaN(d.getTime())) return;
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      byDay.set(key, (byDay.get(key) || 0) + Number(item.gross || 0));
    });
    return Array.from(byDay.entries()).map(([label, amount]) => ({ label, amount }));
  }, [adminData]);

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

  return (
    <div className="owner-page-grid">
      <div className="owner-stats-grid owner-stats-grid--wide">
        <StatCard title="Tổng người dùng" value={stats.totalUsers} note="Người dùng toàn hệ thống" trend={`${adminData.users.filter((u) => u.status === "active").length} đang hoạt động`} icon="users" />
        <StatCard title="Tổng chủ khu vực" value={stats.totalOwners} note="Tài khoản đối tác" trend={`${adminData.owners.filter((o) => o.status === "active").length} hoạt động`} icon="owners" />
        <StatCard title="Tổng bãi đỗ" value={stats.totalParkingLots} note="Bãi đang được quản lý" trend={`${adminData.parkingLots.filter((p) => p.status === "pending").length} chờ duyệt`} icon="parking" />
        <StatCard title="Tổng đặt chỗ" value={stats.totalBookings} note="Đặt chỗ toàn hệ thống" trend={`${adminData.bookings.filter((b) => b.status === "in_progress").length} đang diễn ra`} icon="booking" />
        <StatCard title="Doanh thu hệ thống" value={formatCurrency(stats.totalRevenue)} note="Doanh thu gộp" trend={formatCurrency(stats.totalCommission)} icon="revenue" />
      </div>

      <div className="owner-two-col">
        <SectionCard title="Doanh thu hệ thống" subtitle="Biến động doanh thu theo thời gian.">
          <LineChart data={revenueSeries.length ? revenueSeries : [{ label: "Không có dữ liệu", amount: 0 }]} />
        </SectionCard>
        <SectionCard title="Số lượng đặt chỗ" subtitle="Khối lượng giao dịch theo ngày.">
          <BarChart data={bookingSeries.length ? bookingSeries : [{ label: "--", amount: 0 }]} formatValue={(value) => `${value}`} />
        </SectionCard>
      </div>

      <div className="owner-two-col owner-two-col--secondary">
        <SectionCard title="Hoa hồng của admin" subtitle="Phần hoa hồng admin thu từ mỗi giao dịch.">
          <LineChart data={normalizeSeries(adminData.systemRevenue.commission)} />
        </SectionCard>
        <SectionCard title="Nhật ký hoạt động gần đây" subtitle="Các hành động hệ thống và vận hành mới nhất.">
          <div className="owner-activity-list">
            {adminData.logs.map((log) => (
              <article key={log.id} className="owner-activity-item">
                <div>
                  <StatusBadge status={log.type} />
                  <h3>{log.action}</h3>
                </div>
                <span>{formatDateTime(log.time)}</span>
              </article>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
