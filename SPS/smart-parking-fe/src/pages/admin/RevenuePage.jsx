import { useMemo, useState } from "react";
import { BarChart, LineChart, SectionCard, StatCard, StatusBadge, formatCurrency, formatDateTime } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";

export default function RevenuePage() {
  const { adminData, stats } = useAdminContext();
  const [series, setSeries] = useState("revenue");
  const [period, setPeriod] = useState("day");
  const [query, setQuery] = useState("");

  const lineSeriesMap = useMemo(
    () => ({
      day: {
        revenue: adminData.systemRevenue.revenue,
        commission: adminData.systemRevenue.commission,
        ownerPayout: adminData.systemRevenue.ownerPayout || [],
        bookings: adminData.systemRevenue.bookings,
      },
      month: {
        revenue: adminData.systemRevenue.revenueMonthly || [],
        commission: adminData.systemRevenue.commissionMonthly || [],
        ownerPayout: adminData.systemRevenue.ownerPayoutMonthly || [],
        bookings: adminData.systemRevenue.bookingsMonthly || [],
      },
    }),
    [adminData.systemRevenue],
  );

  const filteredTransactions = useMemo(
    () => adminData.transactions.filter((tx) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      const haystack = `${tx.id} ${tx.bookingId} ${tx.parkingLot} ${tx.user}`.toLowerCase();
      return haystack.includes(q);
    }),
    [adminData.transactions, query],
  );

  return (
    <div className="owner-page-grid">
      <div className="owner-stats-grid">
        <StatCard title="Doanh thu hệ thống" value={formatCurrency(stats.totalRevenue)} note="Doanh thu gộp" trend="Toàn hệ thống" icon="revenue" />
        <StatCard title="Hoa hồng admin" value={formatCurrency(stats.totalCommission)} note={`${adminData.commissionRate}% mỗi giao dịch`} trend="Lợi nhuận admin" icon="dashboard" />
        <StatCard title="Payout cho owner" value={formatCurrency(adminData.transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.ownerPayout, 0))} note="Doanh thu chia cho owner" trend="Sau commission" icon="owners" />
      </div>

      <div className="owner-two-col">
        <SectionCard
          title="Biểu đồ doanh thu"
          subtitle="Xem lợi nhuận theo ngày hoặc theo tháng."
          actions={(
            <div className="owner-toolbar">
              <select className="owner-input owner-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="day">Theo ngày</option>
                <option value="month">Theo tháng</option>
              </select>
              <select className="owner-input owner-select" value={series} onChange={(e) => setSeries(e.target.value)}>
                <option value="revenue">Doanh thu</option>
                <option value="commission">Hoa hồng</option>
                <option value="ownerPayout">Chi trả cho owner</option>
              </select>
            </div>
          )}
        >
          <LineChart data={lineSeriesMap[period]?.[series] || []} />
        </SectionCard>

        <SectionCard title="Khối lượng đặt chỗ" subtitle="Khối lượng đơn theo kỳ đã chọn.">
          <BarChart data={lineSeriesMap[period]?.bookings || []} formatValue={(value) => `${value}`} />
        </SectionCard>
      </div>

      <div className="owner-two-col">
        <SectionCard title="Tóm tắt theo kỳ" subtitle="So sánh doanh thu các khoảng thời gian khác nhau.">
          <div className="owner-stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            {adminData.revenueSummary && Object.entries(adminData.revenueSummary).map(([key, data]) => {
              const labels = {
                threeDays: "3 ngày qua",
                thisWeek: "Tuần này",
                lastWeek: "Tuần trước",
                thisMonth: "Tháng này",
                lastMonth: "Tháng trước",
              };
              return (
                <div key={key} style={{ padding: "12px", border: "1px solid #e0e0e0", borderRadius: "8px", backgroundColor: "#f9f9f9" }}>
                  <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>{labels[key]}</div>
                  <div style={{ fontSize: "14px", fontWeight: "600", color: "#333", marginBottom: "4px" }}>
                    Doanh thu: {formatCurrency(data.gross || 0)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#999", marginBottom: "4px" }}>
                    Hoa hồng: {formatCurrency(data.commission || 0)}
                  </div>
                  <div style={{ fontSize: "12px", color: "#0099cc", fontWeight: "600" }}>
                    Chi trả: {formatCurrency(data.ownerPayout || 0)}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Doanh thu theo chủ bãi" subtitle="Chi tiết doanh thu của từng owner.">
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            <table className="owner-table" style={{ fontSize: "13px" }}>
              <thead>
                <tr>
                  <th>Chủ bãi</th>
                  <th>Bãi đỗ</th>
                  <th>Doanh thu</th>
                  <th>Hoa hồng</th>
                  <th>Chi trả</th>
                </tr>
              </thead>
              <tbody>
                {adminData.ownerRevenueBreakdown && adminData.ownerRevenueBreakdown.length > 0 ? (
                  adminData.ownerRevenueBreakdown.map((owner) => (
                    <tr key={owner.id}>
                      <td>
                        <div style={{ fontWeight: "600" }}>{owner.name}</div>
                        <div style={{ fontSize: "11px", color: "#999" }}>{owner.email}</div>
                      </td>
                      <td style={{ fontSize: "12px" }}>{owner.parkingLots.join(", ") || "Chưa gán"}</td>
                      <td>{formatCurrency(owner.gross || 0)}</td>
                      <td>{formatCurrency(owner.commission || 0)}</td>
                      <td style={{ fontWeight: "600", color: "#0099cc" }}>{formatCurrency(owner.ownerPayout || 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: "center", color: "#999", padding: "20px" }}>
                      Chưa có dữ liệu doanh thu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Lịch sử giao dịch"
        subtitle="Theo dõi gross, commission và payout theo từng đơn."
        actions={<input className="owner-input" placeholder="Tìm theo mã đơn, bãi hoặc user..." value={query} onChange={(e) => setQuery(e.target.value)} />}
      >
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Mã GD</th>
                <th>Mã đặt chỗ</th>
                <th>Bãi đỗ</th>
                <th>Thời gian</th>
                <th>Tổng</th>
                <th>Hoa hồng</th>
                <th>Chi trả</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.id}</td>
                  <td>{tx.bookingId}</td>
                  <td>{tx.parkingLot}</td>
                  <td>{formatDateTime(tx.time)}</td>
                  <td>{formatCurrency(tx.gross)}</td>
                  <td>{formatCurrency(tx.commission)}</td>
                  <td>{formatCurrency(tx.ownerPayout)}</td>
                  <td><StatusBadge status={tx.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
