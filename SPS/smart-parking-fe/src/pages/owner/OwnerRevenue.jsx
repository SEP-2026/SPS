import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { buildRevenueSeries, filterTransactionsByRange, getRangeSummaryLabel } from "../../owner/ownerAnalytics";
import { formatCurrency, formatDateTime, LineChart, SectionCard, StatCard, StatusBadge } from "../../owner/OwnerUI";
import API from "../../services/api";
import { toDateInputValue } from "../../utils/dateTime";

const CHART_RANGE_OPTIONS = [
  { value: "day", label: "Theo ngày" },
  { value: "week", label: "Theo tuần" },
  { value: "month", label: "Theo tháng" },
  { value: "quarter", label: "3 tháng gần nhất" },
  { value: "custom", label: "Khác" },
];

export default function OwnerRevenue() {
  const [range, setRange] = useState("day");
  const [transactions, setTransactions] = useState([]);
  const [parkingLots, setParkingLots] = useState([]);
  const [commissionRate, setCommissionRate] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedParkingLot, setSelectedParkingLot] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return toDateInputValue(date);
  });
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));
  const activeRange = range === "custom" ? "day" : range;

  useEffect(() => {
    const fetchRevenue = async () => {
      try {
        setError("");
        setLoading(true);
        const res = await API.get("/owner/revenue");
        setTransactions(res.data?.transactions || []);
        setParkingLots(res.data?.parkingLots || []);
        setCommissionRate(Number(res.data?.commissionRate ?? 10));
      } catch (err) {
        setError(err?.response?.data?.detail || "Không tải được dữ liệu doanh thu");
        setTransactions([]);
        setParkingLots([]);
      } finally {
        setLoading(false);
      }
    };
    fetchRevenue();

    const intervalId = window.setInterval(fetchRevenue, 10000);
    const handleFocus = () => fetchRevenue();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchRevenue();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const filteredTransactions = useMemo(
    () => filterTransactionsByRange(transactions, dateFrom, dateTo, range),
    [transactions, dateFrom, dateTo, range],
  );
  const paidTransactions = filteredTransactions.filter((item) => item.status === "paid");
  const totalPaid = paidTransactions.reduce((sum, item) => sum + item.amount, 0);
  const currentSeries = useMemo(
    () => buildRevenueSeries(transactions, dateFrom, dateTo, activeRange),
    [transactions, dateFrom, dateTo, activeRange],
  );
  const currentRevenue = currentSeries.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingAmount = filteredTransactions
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + item.amount, 0);
  const paidCount = paidTransactions.length;
  const pendingCount = filteredTransactions.filter((item) => item.status === "pending").length;
  const districtLabel = useMemo(() => {
    const districts = Array.from(new Set(parkingLots.map((item) => item.district).filter(Boolean)));
    return districts.length === 1 ? districts[0] : "khu vực owner quản lý";
  }, [parkingLots]);
  const revenueByParkingLot = useMemo(() => {
    const summaryMap = new Map();

    parkingLots.forEach((lot) => {
      summaryMap.set(lot.name, {
        parkingLotName: lot.name,
        district: lot.district || "",
        totalRevenue: 0,
        grossRevenue: 0,
        commissionAmount: 0,
        paidRevenue: 0,
        pendingRevenue: 0,
        paidCount: 0,
        pendingCount: 0,
      });
    });

    filteredTransactions.forEach((transaction) => {
      const key = transaction.parkingLotName || "Chưa xác định";
      const current = summaryMap.get(key) || {
        parkingLotName: key,
        district: "",
        totalRevenue: 0,
        grossRevenue: 0,
        commissionAmount: 0,
        paidRevenue: 0,
        pendingRevenue: 0,
        paidCount: 0,
        pendingCount: 0,
      };
      const ownerAmount = Number(transaction.ownerPayout ?? transaction.amount ?? 0);
      current.totalRevenue += ownerAmount;
      current.grossRevenue += Number(transaction.gross ?? transaction.amount ?? 0);
      current.commissionAmount += Number(transaction.commission ?? 0);
      if (transaction.status === "paid") {
        current.paidRevenue += ownerAmount;
        current.paidCount += 1;
      }
      if (transaction.status === "pending") {
        current.pendingRevenue += ownerAmount;
        current.pendingCount += 1;
      }
      summaryMap.set(key, current);
    });

    return Array.from(summaryMap.values()).sort((left, right) => right.paidRevenue - left.paidRevenue);
  }, [filteredTransactions, parkingLots]);
  const selectedParkingLotSummary = selectedParkingLot
    ? revenueByParkingLot.find((item) => item.parkingLotName === selectedParkingLot)
    : null;
  const selectedParkingLotTransactions = useMemo(() => {
    if (!selectedParkingLot) {
      return [];
    }
    return filteredTransactions.filter((item) => item.parkingLotName === selectedParkingLot);
  }, [filteredTransactions, selectedParkingLot]);
  const revenueTitle = activeRange === "day"
    ? "Doanh thu hôm nay"
    : activeRange === "week"
      ? "Doanh thu tuần này"
      : activeRange === "month"
        ? "Doanh thu tháng này"
        : activeRange === "quarter"
          ? "Doanh thu 3 tháng gần nhất"
          : "Doanh thu kỳ chọn";

  return (
    <div className="owner-page-grid">
      <div className="owner-stats-grid">
        <StatCard title={revenueTitle} value={formatCurrency(currentRevenue)} note={`Owner nhận sau commission ${commissionRate}%`} trend={CHART_RANGE_OPTIONS.find((item) => item.value === range)?.label || "Theo ngày"} icon="revenue" />
        <StatCard title="Owner đã nhận" value={formatCurrency(totalPaid)} note="Payout từ giao dịch hoàn tất" trend={`${paidCount} giao dịch`} icon="dashboard" />
        <StatCard title="Owner chờ nhận" value={formatCurrency(pendingAmount)} note="Payout từ giao dịch pending" trend={`${pendingCount} giao dịch`} icon="booking" />
      </div>

      <SectionCard
        title="Báo cáo doanh thu theo bãi"
        subtitle={`Owner nhận tại ${districtLabel}: ${formatCurrency(totalPaid)} đã thu và ${formatCurrency(pendingAmount)} đang chờ sau commission ${commissionRate}% trong kỳ ${getRangeSummaryLabel(activeRange, dateFrom, dateTo)}.`}
      >
        {error ? <p className="owner-empty-cell">{error}</p> : null}
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Bãi đỗ</th>
                <th>Khu vực</th>
                <th>Gross</th>
                <th>Hoa hồng</th>
                <th>Owner đã nhận</th>
                <th>Owner chờ nhận</th>
                <th>Số giao dịch đã thu</th>
                <th>Số giao dịch chờ</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="owner-empty-cell">Đang tổng hợp doanh thu theo bãi...</td>
                </tr>
              ) : revenueByParkingLot.length === 0 ? (
                <tr>
                  <td colSpan={9} className="owner-empty-cell">Chưa có doanh thu nào trong kỳ đang chọn.</td>
                </tr>
              ) : (
                revenueByParkingLot.map((row) => (
                  <tr key={row.parkingLotName}>
                    <td>{row.parkingLotName}</td>
                    <td>{row.district || "Chưa có khu vực"}</td>
                    <td>{formatCurrency(row.grossRevenue)}</td>
                    <td>{formatCurrency(row.commissionAmount)}</td>
                    <td className="table-cell-green">{formatCurrency(row.paidRevenue)}</td>
                    <td className="table-cell-orange">{formatCurrency(row.pendingRevenue)}</td>
                    <td>{row.paidCount}</td>
                    <td>{row.pendingCount}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary owner-btn owner-btn--small"
                        onClick={() => setSelectedParkingLot(row.parkingLotName)}
                      >
                        Xem chi tiết
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selectedParkingLotSummary ? createPortal(
        <div className="owner-modal-backdrop" onClick={() => setSelectedParkingLot(null)}>
          <div className="owner-modal owner-modal--detail owner-modal--large" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{selectedParkingLotSummary.parkingLotName}</h2>
                <p>Chi tiết doanh thu và giao dịch trong kỳ {getRangeSummaryLabel(activeRange, dateFrom, dateTo)}.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelectedParkingLot(null)}>×</button>
            </div>

            <div className="owner-detail-grid">
              <div><span>Khu vực</span><strong>{selectedParkingLotSummary.district || "Chưa có khu vực"}</strong></div>
              <div><span>Gross trong kỳ</span><strong>{formatCurrency(selectedParkingLotSummary.grossRevenue)}</strong></div>
              <div><span>Hoa hồng admin</span><strong>{formatCurrency(selectedParkingLotSummary.commissionAmount)}</strong></div>
              <div><span>Owner đã nhận</span><strong className="text-green">{formatCurrency(selectedParkingLotSummary.paidRevenue)}</strong></div>
              <div><span>Owner chờ nhận</span><strong className="text-orange">{formatCurrency(selectedParkingLotSummary.pendingRevenue)}</strong></div>
              <div><span>Tổng giao dịch đã thu</span><strong>{selectedParkingLotSummary.paidCount}</strong></div>
              <div><span>Tổng giao dịch chờ</span><strong>{selectedParkingLotSummary.pendingCount}</strong></div>
              <div><span>Owner nhận trong kỳ</span><strong>{formatCurrency(selectedParkingLotSummary.totalRevenue)}</strong></div>
            </div>

            <div className="owner-section">
              <h3>Danh sách giao dịch của bãi</h3>
              <div className="owner-table-shell">
                <table className="owner-table">
                  <thead>
                    <tr>
                      <th>Mã giao dịch</th>
                      <th>Mã đơn</th>
                      <th>Khách hàng</th>
                      <th>Thời gian</th>
                      <th>Phương thức</th>
                      <th>Gross</th>
                      <th>Hoa hồng</th>
                      <th>Owner nhận</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedParkingLotTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="owner-empty-cell">Không có giao dịch nào của bãi này trong kỳ đang chọn.</td>
                      </tr>
                    ) : (
                      selectedParkingLotTransactions.map((transaction) => (
                        <tr key={transaction.id}>
                          <td>{transaction.id}</td>
                          <td>{transaction.bookingCode}</td>
                          <td>{transaction.payer}</td>
                          <td>{formatDateTime(transaction.time)}</td>
                          <td>{transaction.method}</td>
                          <td>{formatCurrency(transaction.gross ?? transaction.amount)}</td>
                          <td>{formatCurrency(transaction.commission)}</td>
                          <td>{formatCurrency(transaction.ownerPayout ?? transaction.amount)}</td>
                          <td><StatusBadge status={transaction.status} /></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <div className="owner-page-grid">
        <SectionCard
          title="Biểu đồ doanh thu"
          subtitle={`Chọn kỳ xem và khoảng thời gian cần theo dõi: ${getRangeSummaryLabel(activeRange, dateFrom, dateTo)}.`}
          actions={
            <div className="owner-range-controls">
              <select className="owner-input owner-select owner-control" value={range} onChange={(event) => setRange(event.target.value)}>
                {CHART_RANGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {range === "custom" ? (
                <div className="owner-date-range">
                  <label className="owner-date-field">
                    <span>Từ</span>
                    <input className="owner-input owner-control owner-control--date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
                  </label>
                  <label className="owner-date-field">
                    <span>Đến</span>
                    <input className="owner-input owner-control owner-control--date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
                  </label>
                </div>
              ) : null}
            </div>
          }
        >
          {error ? <p className="owner-empty-cell">{error}</p> : null}
          <LineChart data={currentSeries.length > 0 ? currentSeries : [{ label: "Không có dữ liệu", amount: 0 }]} />
        </SectionCard>
      </div>

      <SectionCard title="Giao dịch gần đây" subtitle="Gross, hoa hồng admin và số tiền owner nhận sau commission.">
        {error ? <p className="owner-empty-cell">{error}</p> : null}
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Mã giao dịch</th>
                <th>Mã đơn</th>
                <th>Khách hàng</th>
                <th>Thời gian</th>
                <th>Phương thức</th>
                <th>Gross</th>
                <th>Hoa hồng</th>
                <th>Owner nhận</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="owner-empty-cell">Đang tải giao dịch...</td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="owner-empty-cell">Không có giao dịch nào trong kỳ đang chọn.</td>
                </tr>
              ) : (
                filteredTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{transaction.id}</td>
                    <td>{transaction.bookingCode}</td>
                    <td>{transaction.payer}</td>
                    <td>{formatDateTime(transaction.time)}</td>
                    <td>{transaction.method}</td>
                    <td>{formatCurrency(transaction.gross ?? transaction.amount)}</td>
                    <td>{formatCurrency(transaction.commission)}</td>
                    <td>{formatCurrency(transaction.ownerPayout ?? transaction.amount)}</td>
                    <td><StatusBadge status={transaction.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
