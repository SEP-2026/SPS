import { useMemo, useState } from "react";
import { CircleDollarSign, MoreVertical, Percent, ReceiptText, Scale, WalletCards } from "lucide-react";
import { formatCurrency, formatDateTime } from "../OwnerUI";
import { formatNumber } from "../ownerUtils";
import { useOwnerRevenueContext } from "./OwnerRevenueLayout";
import {
  buildCommissionRows,
  buildOverviewMetrics,
  filterTransactions,
  formatPercentOfTotal,
  isPaidTransaction,
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
} from "./OwnerRevenueShared";

const TABLE_TABS = [
  { value: "all", label: "Tất cả" },
  { value: "paid", label: "Đã thu hồi" },
  { value: "pending", label: "Đang chờ thu hồi" },
];

export default function OwnerRevenueCommission() {
  const revenue = useOwnerRevenueContext();
  const {
    transactions,
    bounds,
    commissionRate,
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState(null);

  const commissionRows = useMemo(
    () => buildCommissionRows(transactions, bounds),
    [transactions, bounds],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return commissionRows.filter((row) => {
      if (parkingFilter !== "all" && row.parkingLotName !== parkingFilter) {
        return false;
      }
      if (methodFilter !== "all" && row.method !== methodFilter) {
        return false;
      }
      if (activeTab === "paid" && row.status !== "paid") {
        return false;
      }
      if (activeTab === "pending" && row.status === "paid") {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [row.id, row.parkingLotName, row.bookingCode].join(" ").toLowerCase().includes(keyword);
    });
  }, [commissionRows, parkingFilter, methodFilter, activeTab, search]);

  const metrics = useMemo(() => buildOverviewMetrics(transactions, bounds, commissionRate), [transactions, bounds, commissionRate]);
  const recovered = metrics.commission;
  const pending = filterTransactions(transactions, { bounds })
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + Number(item.commission || 0), 0);

  const donutData = [
    { name: "Đã thu hồi", value: recovered },
    { name: "Đang chờ", value: pending },
  ].filter((item) => item.value > 0);

  const statItems = [
    { title: "Tổng doanh thu (gross)", value: formatCurrency(metrics.grossRevenue), growth: metrics.growth.netRevenue, icon: <CircleDollarSign size={23} />, tone: "blue" },
    { title: `Hoa hồng (${commissionRate}%)`, value: formatCurrency(metrics.commission), growth: metrics.growth.commission, icon: <Percent size={23} />, tone: "green" },
    { title: "Đã thu hồi", value: formatCurrency(recovered), subtitle: formatPercentOfTotal(recovered, metrics.commission || 1) + " hoa hồng kỳ", icon: <ReceiptText size={23} />, tone: "sky" },
    { title: "Đang chờ thu hồi", value: formatCurrency(pending), subtitle: "Từ giao dịch pending", icon: <Scale size={23} />, tone: "orange" },
    { title: "Owner nhận", value: formatCurrency(metrics.netRevenue), subtitle: "Sau hoa hồng", icon: <WalletCards size={23} />, tone: "pink" },
  ];

  const visibleRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const exportRows = filtered.map((row) => ({
    ngay: formatDateTime(row.time),
    ma_giao_dich: row.id,
    bai_xe: row.parkingLotName,
    doanh_thu: row.gross,
    ty_le: `${commissionRate}%`,
    hoa_hong: row.commission,
    trang_thai: row.recoveryLabel,
  }));

  const recoveryHistory = filtered
    .filter((row) => row.status === "paid")
    .slice(0, 4)
    .map((row) => ({
      key: row.id,
      title: `Kỳ ${row.periodLabel}`,
      subtitle: row.parkingLotName,
      value: formatCurrency(row.commission),
    }));

  return (
    <>
      <RevenuePageActions>
        <ExportReportButton rows={exportRows} filename="hoa-hong-nen-tang-owner.csv" />
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
            parkingOptions={parkingOptions}
            methodOptions={methodOptions}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onDateFromChange={setDateFrom}
            onDateToChange={setDateTo}
            searchPlaceholder="Tìm kiếm mã giao dịch, bãi xe..."
            onApply={() => setPage(1)}
          />

          <div className="owner-table-shell">
            <table className="owner-table owner-designed-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Mã giao dịch</th>
                  <th>Bãi xe</th>
                  <th>Doanh thu</th>
                  <th>Tỷ lệ</th>
                  <th>Hoa hồng</th>
                  <th>Trạng thái</th>
                  <th>Kỳ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={9} className="owner-empty-cell">Đang tải...</td></tr> : null}
                {!loading && visibleRows.length === 0 ? <tr><td colSpan={9} className="owner-empty-cell">Không có dữ liệu hoa hồng trong kỳ.</td></tr> : null}
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.time)}</td>
                    <td><button type="button" className="owner-revenue-link" onClick={() => setSelected(row)}>{row.id}</button></td>
                    <td>{row.parkingLotName}</td>
                    <td>{formatCurrency(row.gross)}</td>
                    <td>{commissionRate}%</td>
                    <td>{formatCurrency(row.commission)}</td>
                    <td><span className={`owner-revenue-type-badge owner-revenue-type-badge--${row.status === "paid" ? "success" : "info"}`}>{row.recoveryLabel}</span></td>
                    <td>Kỳ {row.periodLabel}</td>
                    <td>
                      <button type="button" className="owner-icon-mini" onClick={() => setSelected(row)} aria-label="Chi tiết">
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
            label="giao dịch"
          />
        </section>

        <aside className="owner-revenue-side-stack">
          <RevenueDonutPanel
            title="Tổng quan hoa hồng"
            data={donutData}
            centerValue={formatCurrency(metrics.commission)}
            centerLabel="Hoa hồng kỳ"
          />
          <RevenueSideList
            title="Lịch sử thu hồi gần đây"
            items={recoveryHistory}
            footerLink={{ to: "/owner/revenue/transactions", label: "Xem tất cả" }}
          />
          <section className="owner-revenue-side-card">
            <h3>Thông tin hoa hồng</h3>
            <ul className="owner-revenue-notes">
              <li>Tỷ lệ: {commissionRate}% doanh thu (từ cài đặt hệ thống).</li>
              <li>Tính trên giao dịch thanh toán thành công.</li>
              <li>Trạng thái thu hồi suy từ trạng thái thanh toán CSDL.</li>
              <li>Áp dụng cho tất cả bãi owner quản lý.</li>
            </ul>
          </section>
        </aside>
      </div>

      <TransactionDetailModal transaction={selected} onClose={() => setSelected(null)} />
    </>
  );
}
