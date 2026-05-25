import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  CircleDollarSign,
  CreditCard,
  Percent,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { formatCurrency, formatDateTime, StatusBadge } from "../OwnerUI";
import { downloadCsv, formatNumber } from "../ownerUtils";
import { useOwnerRevenueContext } from "./OwnerRevenueLayout";
import {
  buildCategoryDistribution,
  buildOverviewMetrics,
  buildRevenueByParking,
  buildRevenueChartData,
  filterTransactions,
  getMethodLabel,
  isPaidTransaction,
} from "./revenueUtils";
import {
  CHART_COLORS,
  ExportReportButton,
  RevenuePageActions,
  RevenueStatGrid,
} from "./OwnerRevenueShared";

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }
  return (
    <div className="owner-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <span key={item.dataKey}>{item.name}: {item.dataKey === "count" ? `${item.value} lượt` : formatCurrency(item.value)}</span>
      ))}
    </div>
  );
}

export default function OwnerRevenueOverview() {
  const revenue = useOwnerRevenueContext();
  const {
    transactions,
    parkingLots,
    commissionRate,
    bounds,
    loading,
    error,
  } = revenue;

  const metrics = useMemo(
    () => buildOverviewMetrics(transactions, bounds, commissionRate),
    [transactions, bounds, commissionRate],
  );

  const chartData = useMemo(() => buildRevenueChartData(transactions, bounds), [transactions, bounds]);
  const parkingRanking = useMemo(() => buildRevenueByParking(
    filterTransactions(transactions, { bounds }).filter(isPaidTransaction),
    parkingLots,
  ).slice(0, 5), [transactions, bounds, parkingLots]);

  const categoryDistribution = useMemo(
    () => buildCategoryDistribution(filterTransactions(transactions, { bounds })),
    [transactions, bounds],
  );

  const recentTransactions = useMemo(() => (
    filterTransactions(transactions, { bounds })
      .sort((left, right) => new Date(right.time) - new Date(left.time))
      .slice(0, 5)
  ), [transactions, bounds]);

  const exportRows = filterTransactions(transactions, { bounds }).map((transaction) => ({
    ma_giao_dich: transaction.id,
    ma_don: transaction.bookingCode,
    bai_xe: transaction.parkingLotName,
    phuong_thuc: getMethodLabel(transaction.method),
    gross: transaction.gross,
    hoa_hong: transaction.commission,
    owner_nhan: transaction.amount,
    trang_thai: transaction.status,
    thoi_gian: transaction.time,
  }));

  const statItems = [
    {
      title: "Doanh thu thuần",
      value: formatCurrency(metrics.netRevenue),
      growth: metrics.growth.netRevenue,
      icon: <CircleDollarSign size={23} />,
      tone: "blue",
    },
    {
      title: "Thanh toán qua ví",
      value: formatCurrency(metrics.onlineRevenue),
      growth: metrics.growth.online,
      icon: <CreditCard size={23} />,
      tone: "green",
    },
    {
      title: "Giao dịch thành công",
      value: formatNumber(metrics.successCount),
      growth: metrics.growth.transactions,
      icon: <ReceiptText size={23} />,
      tone: "sky",
    },
    {
      title: `Hoa hồng nền tảng (${commissionRate}%)`,
      value: formatCurrency(metrics.commission),
      growth: metrics.growth.commission,
      icon: <Percent size={23} />,
      tone: "orange",
    },
    {
      title: "Số dư khả dụng",
      value: formatCurrency(metrics.availableBalance),
      subtitle: "Ước tính từ giao dịch đã thanh toán trong kỳ",
      icon: <WalletCards size={23} />,
      tone: "pink",
      action: <Link to="/owner/revenue/withdrawals">Rút tiền ngay <ArrowRight size={14} /></Link>,
    },
  ];

  const donutTotal = categoryDistribution.reduce((sum, item) => sum + item.value, 0);

  return (
    <>
      <RevenuePageActions>
        <ExportReportButton rows={exportRows} filename="tong-quan-doanh-thu-owner.csv" />
      </RevenuePageActions>

      <RevenueStatGrid items={statItems} />
      {error ? <p className="owner-empty-cell">{error}</p> : null}

      <div className="owner-revenue-overview-grid">
        <section className="owner-management-panel owner-revenue-chart-panel">
          <div className="owner-panel-heading">
            <div>
              <h3>Doanh thu</h3>
              <p>So với kỳ trước: {formatCurrency(metrics.previousNetRevenue)}</p>
            </div>
            <strong className="owner-revenue-panel-total">{formatCurrency(metrics.netRevenue)}</strong>
          </div>
          <div className="owner-chart-box owner-chart-box--large">
            {loading ? <p className="owner-empty-cell">Đang tải biểu đồ...</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 12, right: 18, left: -10, bottom: 4 }}>
                  <defs>
                    <linearGradient id="ownerRevenueOverviewArea" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.24} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e5e7eb" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value / 1000000)}M`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area yAxisId="left" type="monotone" dataKey="amount" name="Doanh thu" stroke="#3b82f6" strokeWidth={3} fill="url(#ownerRevenueOverviewArea)" />
                  <Line yAxisId="left" type="monotone" dataKey="amount" name="Xu hướng" stroke="#10b981" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="owner-revenue-footer">
            <div><span>Thanh toán qua ví</span><strong>{formatCurrency(metrics.onlineRevenue)}</strong><small>{metrics.netRevenue ? `${Math.round((metrics.onlineRevenue / metrics.netRevenue) * 100)}%` : "0%"}</small></div>
            <div><span>Giao dịch thành công</span><strong>{formatNumber(metrics.successCount)}</strong><small>{metrics.growth.transactions !== null ? `${metrics.growth.transactions >= 0 ? "+" : ""}${metrics.growth.transactions?.toFixed(1)}%` : ""}</small></div>
            <div><span>Giao dịch chưa hoàn tất</span><strong>{formatNumber(metrics.failedCount)}</strong><small>Trong kỳ đang chọn</small></div>
          </div>
        </section>

        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Doanh thu theo bãi xe</h3></div>
            <Link to="/owner/revenue/transactions">Xem báo cáo</Link>
          </div>
          <div className="owner-revenue-ranking-wrap">
            <div className="owner-revenue-ranking">
              {parkingRanking.map((lot, index) => (
                <div key={lot.name} className="owner-revenue-rank-row">
                  <span>{index + 1}</span>
                  <div>
                    <strong>{lot.name}</strong>
                    <small>{lot.district || "Chưa có địa chỉ"}</small>
                  </div>
                  <b>{formatCurrency(lot.revenue)}</b>
                  <em>{metrics.netRevenue ? `${Math.round((lot.revenue / metrics.netRevenue) * 100)}%` : "0%"}</em>
                </div>
              ))}
            </div>
            <div className="owner-revenue-ranking-chart">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={parkingRanking} dataKey="revenue" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {parkingRanking.map((entry, index) => <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="owner-revenue-donut-center is-compact">
                <strong>{formatCurrency(metrics.netRevenue)}</strong>
              </div>
            </div>
          </div>
          <Link className="owner-revenue-inline-link" to="/owner/parking">Xem tất cả bãi xe →</Link>
        </section>
      </div>

      <div className="owner-revenue-overview-bottom">
        <section className="owner-management-panel">
          <h3>Tình hình thanh toán</h3>
          <div className="owner-revenue-mini-cards owner-revenue-mini-cards--single">
            <article>
              <span>Thanh toán qua ví khách</span>
              <strong>{formatNumber(metrics.onlineCount)} giao dịch</strong>
              <b>{formatCurrency(metrics.onlineRevenue)}</b>
            </article>
          </div>
          <p className="owner-revenue-balance-note">Hệ thống chỉ ghi nhận thanh toán trừ trực tiếp từ ví Smart Parking.</p>
        </section>

        <section className="owner-management-panel">
          <h3>Số dư & Hoa hồng</h3>
          <div className="owner-revenue-balance-list">
            <div><span>Tổng doanh thu</span><strong>{formatCurrency(metrics.grossRevenue)}</strong></div>
            <div className="is-negative"><span>Hoa hồng nền tảng ({commissionRate}%)</span><strong>- {formatCurrency(metrics.commission)}</strong></div>
            <div className="is-total"><span>Số dư khả dụng (ước tính)</span><strong>{formatCurrency(metrics.availableBalance)}</strong></div>
          </div>
          <p className="owner-revenue-balance-note">Số dư được tính từ giao dịch đã thanh toán trong kỳ lọc. Rút tiền thực tế cần API rút tiền riêng.</p>
          <Link to="/owner/revenue/withdrawals" className="owner-management-primary owner-revenue-withdraw-cta">Rút tiền ngay</Link>
        </section>

        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Giao dịch mới nhất</h3></div>
            <Link to="/owner/revenue/transactions">Xem tất cả</Link>
          </div>
          <div className="owner-revenue-recent-list">
            {recentTransactions.map((transaction) => (
              <div key={transaction.id} className={`owner-revenue-recent-item owner-revenue-recent-item--${transaction.paymentCategory}`}>
                <span />
                <div>
                  <strong>{getMethodLabel(transaction.method)} {transaction.bookingCode}</strong>
                  <small>{formatDateTime(transaction.time)}</small>
                </div>
                <b>{formatCurrency(transaction.amount)}</b>
                <StatusBadge status={transaction.status} />
              </div>
            ))}
            {!loading && recentTransactions.length === 0 ? <p className="owner-empty-cell">Chưa có giao dịch trong kỳ.</p> : null}
          </div>
        </section>
      </div>
    </>
  );
}
