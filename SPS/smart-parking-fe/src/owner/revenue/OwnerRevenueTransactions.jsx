import { useMemo, useState } from "react";
import { CreditCard, MoreVertical, Percent, ReceiptText, WalletCards } from "lucide-react";
import { formatCurrency, formatDateTime, StatusBadge } from "../OwnerUI";
import { formatNumber } from "../ownerUtils";
import { useOwnerRevenueContext } from "./OwnerRevenueLayout";
import {
  buildCategoryDistribution,
  buildOverviewMetrics,
  buildRevenueByParking,
  filterTransactions,
  formatPercentOfTotal,
  getMethodLabel,
  isPaidTransaction,
  sumPaidAmount,
} from "./revenueUtils";
import {
  ExportReportButton,
  RevenueDonutPanel,
  RevenueFilterBar,
  RevenuePageActions,
  RevenuePagination,
  RevenueSideList,
  RevenueStatGrid,
  RevenueTableTabs,
  TransactionDetailModal,
  TransactionTypeBadge,
} from "./OwnerRevenueShared";

const TABLE_TABS = [
  { value: "all", label: "Tất cả" },
  { value: "online", label: "Thanh toán qua ví" },
  { value: "refund", label: "Hoàn tiền" },
];

const STATUS_OPTIONS = [
  { value: "paid", label: "Thành công" },
  { value: "pending", label: "Đang chờ" },
  { value: "refunded", label: "Hoàn tiền" },
  { value: "failed", label: "Thất bại" },
];

export default function OwnerRevenueTransactions() {
  const revenue = useOwnerRevenueContext();
  const {
    transactions,
    bounds,
    parkingOptions,
    methodOptions,
    loading,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
  } = revenue;

  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [parkingFilter, setParkingFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState(null);

  const filtered = useMemo(() => filterTransactions(transactions, {
    bounds,
    parkingFilter,
    methodFilter,
    statusFilter,
    search,
    tab: activeTab,
  }), [transactions, bounds, parkingFilter, methodFilter, statusFilter, search, activeTab]);

  const metrics = useMemo(() => buildOverviewMetrics(transactions, bounds), [transactions, bounds]);
  const paidFiltered = filtered.filter(isPaidTransaction);
  const categoryDistribution = useMemo(() => buildCategoryDistribution(filtered), [filtered]);
  const revenueByType = useMemo(() => {
    const payment = sumPaidAmount(paidFiltered.filter((item) => item.typeMeta?.key === "payment"));
    const refund = sumPaidAmount(paidFiltered.filter((item) => item.typeMeta?.key === "refund"));
    return [
      { key: "payment", title: "Thanh toán", value: formatCurrency(payment) },
      { key: "refund", title: "Hoàn tiền", value: formatCurrency(refund) },
      { key: "total", title: "Tổng doanh thu", value: formatCurrency(metrics.netRevenue) },
    ];
  }, [paidFiltered, metrics.netRevenue]);

  const parkingSide = useMemo(() => {
    const lots = buildRevenueByParking(paidFiltered).slice(0, 4);
    const max = lots[0]?.revenue || 0;
    return lots.map((lot) => ({
      key: lot.name,
      title: lot.name,
      subtitle: `${formatNumber(lot.count)} giao dịch`,
      value: formatCurrency(lot.revenue),
      barPercent: max ? (lot.revenue / max) * 100 : 0,
    }));
  }, [paidFiltered]);

  const visibleRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const exportRows = filtered.map((transaction) => ({
    thoi_gian: formatDateTime(transaction.time),
    ma_giao_dich: transaction.id,
    ma_booking: transaction.bookingCode,
    bien_so: transaction.licensePlate,
    bai_xe: transaction.parkingLotName,
    phuong_thuc: getMethodLabel(transaction.method),
    loai: transaction.typeMeta?.label,
    so_tien: transaction.amount,
    trang_thai: transaction.status,
  }));

  const statItems = [
    { title: "Tổng giao dịch", value: formatNumber(metrics.successCount), growth: metrics.growth.transactions, icon: <WalletCards size={23} />, tone: "blue" },
    { title: "Thanh toán qua ví", value: formatNumber(metrics.onlineCount), subtitle: formatPercentOfTotal(metrics.onlineCount, metrics.successCount) + " tổng giao dịch", icon: <CreditCard size={23} />, tone: "green" },
    { title: "Hoa hồng kỳ", value: formatCurrency(metrics.commission), subtitle: "Từ CSDL thanh toán", icon: <Percent size={23} />, tone: "orange" },
    { title: "Tổng doanh thu", value: formatCurrency(metrics.netRevenue), growth: metrics.growth.netRevenue, icon: <ReceiptText size={23} />, tone: "pink" },
  ];

  return (
    <>
      <RevenuePageActions>
        <ExportReportButton rows={exportRows} filename="giao-dich-owner.csv" />
      </RevenuePageActions>

      <RevenueStatGrid items={statItems} />

      <div className="owner-revenue-payment-layout">
        <section className="owner-management-panel owner-revenue-main-panel">
          <RevenueTableTabs tabs={TABLE_TABS} activeTab={activeTab} onChange={(value) => { setActiveTab(value); setPage(1); }} />
          <RevenueFilterBar
            search={search}
            onSearchChange={(value) => { setSearch(value); setPage(1); }}
            parkingFilter={parkingFilter}
            onParkingFilterChange={(value) => { setParkingFilter(value); setPage(1); }}
            methodFilter={methodFilter}
            onMethodFilterChange={(value) => { setMethodFilter(value); setPage(1); }}
            statusFilter={statusFilter}
            onStatusFilterChange={(value) => { setStatusFilter(value); setPage(1); }}
            parkingOptions={parkingOptions}
            methodOptions={methodOptions}
            statusOptions={STATUS_OPTIONS}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            onApply={() => setPage(1)}
          />

          <div className="owner-table-shell">
            <table className="owner-table owner-designed-table owner-revenue-transactions-table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Mã giao dịch</th>
                  <th>Booking ID</th>
                  <th>Biển số xe</th>
                  <th>Bãi xe</th>
                  <th>Phương thức</th>
                  <th>Loại giao dịch</th>
                  <th>Số tiền</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={10} className="owner-empty-cell">Đang tải giao dịch...</td></tr> : null}
                {!loading && visibleRows.length === 0 ? <tr><td colSpan={10} className="owner-empty-cell">Không có giao dịch khớp bộ lọc.</td></tr> : null}
                {visibleRows.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{formatDateTime(transaction.time)}</td>
                    <td><button type="button" className="owner-revenue-link" onClick={() => setSelected(transaction)}>{transaction.id}</button></td>
                    <td>{transaction.bookingCode}</td>
                    <td>{transaction.licensePlate || "—"}</td>
                    <td>{transaction.parkingLotName}</td>
                    <td>{getMethodLabel(transaction.method)}</td>
                    <td><TransactionTypeBadge typeMeta={transaction.typeMeta} /></td>
                    <td>{formatCurrency(transaction.amount)}</td>
                    <td><StatusBadge status={transaction.status} /></td>
                    <td>
                      <button type="button" className="owner-icon-mini" onClick={() => setSelected(transaction)} aria-label="Chi tiết">
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <RevenuePagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
          />
        </section>

        <aside className="owner-revenue-side-stack">
          <RevenueDonutPanel
            title="Phân bổ giao dịch theo phương thức"
            data={categoryDistribution}
            centerValue={formatNumber(metrics.successCount)}
            centerLabel="Tổng giao dịch"
          />
          <RevenueSideList title="Doanh thu theo loại giao dịch" items={revenueByType} />
          <RevenueSideList
            title="Giao dịch theo bãi xe"
            items={parkingSide}
            footerLink={{ to: "/owner/parking", label: "Xem tất cả" }}
          />
        </aside>
      </div>

      <TransactionDetailModal transaction={selected} onClose={() => setSelected(null)} />
    </>
  );
}
