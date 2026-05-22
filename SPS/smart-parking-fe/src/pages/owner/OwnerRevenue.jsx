import { useEffect, useMemo, useState } from "react";
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
  BarChart3,
  CalendarDays,
  CreditCard,
  Download,
  Filter,
  ReceiptText,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { buildRevenueSeries } from "../../owner/ownerAnalytics";
import { formatCurrency, StatusBadge } from "../../owner/OwnerUI";
import { downloadCsv, formatNumber } from "../../owner/ownerUtils";
import API from "../../services/api";
import { toDateInputValue } from "../../utils/dateTime";

const PRESETS = [
  { value: "today", label: "Hôm nay" },
  { value: "yesterday", label: "Hôm qua" },
  { value: "last7", label: "7 ngày qua" },
  { value: "last30", label: "30 ngày qua" },
  { value: "month", label: "Tháng này" },
  { value: "custom", label: "Tùy chọn" },
];

const PAYMENT_COLORS = ["#2563eb", "#6d28d9", "#ec4899", "#f59e0b", "#14b8a6", "#64748b"];

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function parseDateInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) {
    return startOfDay(new Date());
  }
  return new Date(year, month - 1, day);
}

function getPresetBounds(preset, dateFrom, dateTo) {
  const today = startOfDay(new Date());
  if (preset === "today") {
    return { from: today, to: endOfDay(today), chartRange: "day" };
  }
  if (preset === "yesterday") {
    const yesterday = addDays(today, -1);
    return { from: yesterday, to: endOfDay(yesterday), chartRange: "day" };
  }
  if (preset === "last30") {
    return { from: addDays(today, -29), to: endOfDay(today), chartRange: "custom" };
  }
  if (preset === "month") {
    return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: endOfDay(today), chartRange: "custom" };
  }
  if (preset === "custom") {
    const from = parseDateInput(dateFrom);
    const to = endOfDay(parseDateInput(dateTo));
    return from <= to ? { from, to, chartRange: "custom" } : { from: parseDateInput(dateTo), to: endOfDay(parseDateInput(dateFrom)), chartRange: "custom" };
  }
  return { from: addDays(today, -6), to: endOfDay(today), chartRange: "custom" };
}

function isInRange(transaction, bounds) {
  const date = new Date(transaction.time);
  return !Number.isNaN(date.getTime()) && date >= bounds.from && date <= bounds.to;
}

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

export default function OwnerRevenue() {
  const [preset, setPreset] = useState("today");
  const [transactions, setTransactions] = useState([]);
  const [parkingLots, setParkingLots] = useState([]);
  const [commissionRate, setCommissionRate] = useState(10);
  const [parkingFilter, setParkingFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedParking, setSelectedParking] = useState(null);
  const [dateFrom, setDateFrom] = useState(() => toDateInputValue(addDays(new Date(), -6)));
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));

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
  }, []);

  const bounds = useMemo(() => getPresetBounds(preset, dateFrom, dateTo), [dateFrom, dateTo, preset]);
  const methods = useMemo(() => Array.from(new Set(transactions.map((item) => item.method).filter(Boolean))).sort(), [transactions]);

  const filteredTransactions = useMemo(() => transactions.filter((transaction) => {
    if (!isInRange(transaction, bounds)) {
      return false;
    }
    if (parkingFilter !== "all" && transaction.parkingLotName !== parkingFilter) {
      return false;
    }
    if (methodFilter !== "all" && transaction.method !== methodFilter) {
      return false;
    }
    return true;
  }), [bounds, methodFilter, parkingFilter, transactions]);

  const paidTransactions = filteredTransactions.filter((item) => item.status === "paid");
  const paidRevenue = paidTransactions.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const grossRevenue = paidTransactions.reduce((sum, item) => sum + Number(item.gross ?? item.amount ?? 0), 0);
  const commission = paidTransactions.reduce((sum, item) => sum + Number(item.commission || 0), 0);
  const averageTicket = paidTransactions.length ? paidRevenue / paidTransactions.length : 0;

  const series = useMemo(() => {
    const range = bounds.chartRange === "day" ? "day" : "custom";
    const revenueSeries = buildRevenueSeries(
      filteredTransactions,
      toDateInputValue(bounds.from),
      toDateInputValue(bounds.to),
      range,
    );
    return revenueSeries.map((point) => ({
      ...point,
      count: filteredTransactions.filter((transaction) => transaction.status === "paid").filter((transaction) => {
        const label = range === "day"
          ? new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(transaction.time)).slice(0, 2)
          : new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(transaction.time));
        return range === "day" ? point.label.startsWith(label) : point.label === label;
      }).length,
    }));
  }, [bounds, filteredTransactions]);

  const revenueByParking = useMemo(() => {
    const map = new Map();
    parkingLots.forEach((lot) => {
      map.set(lot.name, {
        parkingLotName: lot.name,
        district: lot.district || "",
        revenue: 0,
        gross: 0,
        count: 0,
      });
    });
    paidTransactions.forEach((transaction) => {
      const key = transaction.parkingLotName || "Chưa xác định";
      const current = map.get(key) || { parkingLotName: key, district: "", revenue: 0, gross: 0, count: 0 };
      current.revenue += Number(transaction.amount || 0);
      current.gross += Number(transaction.gross ?? transaction.amount ?? 0);
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((left, right) => right.revenue - left.revenue);
  }, [paidTransactions, parkingLots]);

  const revenueByMethod = useMemo(() => {
    const map = new Map();
    paidTransactions.forEach((transaction) => {
      const key = transaction.method || "Khác";
      const current = map.get(key) || { name: key, value: 0, count: 0 };
      current.value += Number(transaction.amount || 0);
      current.count += 1;
      map.set(key, current);
    });
    return Array.from(map.values()).sort((left, right) => right.value - left.value);
  }, [paidTransactions]);

  const hourlyTop = useMemo(() => {
    const map = new Map();
    paidTransactions.forEach((transaction) => {
      const date = new Date(transaction.time);
      const hour = date.getHours();
      const label = `${String(hour).padStart(2, "0")}:00 - ${String(hour + 1).padStart(2, "0")}:00`;
      map.set(label, (map.get(label) || 0) + Number(transaction.amount || 0));
    });
    return Array.from(map.entries()).map(([label, amount]) => ({ label, amount })).sort((left, right) => right.amount - left.amount).slice(0, 5);
  }, [paidTransactions]);

  const selectedParkingSummary = selectedParking ? revenueByParking.find((item) => item.parkingLotName === selectedParking) : null;
  const exportRevenue = () => {
    downloadCsv("bao-cao-doanh-thu-owner.csv", filteredTransactions.map((transaction) => ({
      ma_giao_dich: transaction.id,
      ma_don: transaction.bookingCode,
      bai_xe: transaction.parkingLotName,
      khach_hang: transaction.payer,
      phuong_thuc: transaction.method,
      gross: transaction.gross,
      hoa_hong: transaction.commission,
      owner_nhan: transaction.amount,
      trang_thai: transaction.status,
      thoi_gian: transaction.time,
    })));
  };

  return (
    <div className="owner-designed-page owner-revenue-page">
      <div className="owner-page-actions">
        <button type="button" className="owner-management-secondary" onClick={exportRevenue}>
          <Download size={17} />
          Xuất báo cáo
        </button>
      </div>

      <div className="owner-revenue-tabs">
        {PRESETS.map((option) => (
          <button key={option.value} type="button" className={preset === option.value ? "is-active" : ""} onClick={() => setPreset(option.value)}>
            {option.label}
          </button>
        ))}
        {preset === "custom" ? (
          <>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </>
        ) : null}
        <select value={parkingFilter} onChange={(event) => setParkingFilter(event.target.value)}>
          <option value="all">Tất cả bãi xe</option>
          {parkingLots.map((lot) => <option key={lot.id || lot.name} value={lot.name}>{lot.name}</option>)}
        </select>
        <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
          <option value="all">Tất cả phương thức</option>
          {methods.map((method) => <option key={method} value={method}>{method}</option>)}
        </select>
        <button type="button" onClick={() => setPreset((value) => value)}>
          <Filter size={17} />
          Bộ lọc
        </button>
      </div>

      <div className="owner-management-stats owner-designed-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><WalletCards size={23} /></span>
          <div><p>Doanh thu owner</p><strong>{formatCurrency(paidRevenue)}</strong><small>Sau commission {commissionRate}%</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--sky">
          <span><BarChart3 size={23} /></span>
          <div><p>Gross doanh thu</p><strong>{formatCurrency(grossRevenue)}</strong><small>Trước chia doanh thu</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><Sparkles size={23} /></span>
          <div><p>Hoa hồng hệ thống</p><strong>{formatCurrency(commission)}</strong><small>Tự động theo cài đặt</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><CalendarDays size={23} /></span>
          <div><p>Giao dịch đã thu</p><strong>{formatNumber(paidTransactions.length)}</strong><small>{formatNumber(filteredTransactions.length)} tổng giao dịch</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><ReceiptText size={23} /></span>
          <div><p>Trung bình / giao dịch</p><strong>{formatCurrency(averageTicket)}</strong><small>Owner nhận thực tế</small></div>
        </article>
      </div>

      {error ? <p className="owner-empty-cell">{error}</p> : null}
      <div className="owner-revenue-grid">
        <section className="owner-management-panel owner-revenue-chart-panel">
          <div className="owner-panel-heading">
            <div><h3>Biểu đồ doanh thu</h3><p>Theo khoảng thời gian đang chọn</p></div>
          </div>
          <div className="owner-chart-box owner-chart-box--large">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 12, right: 18, left: -10, bottom: 4 }}>
                <defs>
                  <linearGradient id="ownerRevenueArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor="#6d28d9" stopOpacity={0.26} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={(value) => `${Math.round(value / 1000000)}M`} />
                <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area yAxisId="left" type="monotone" dataKey="amount" name="Doanh thu" stroke="#6d28d9" strokeWidth={3} fill="url(#ownerRevenueArea)" />
                <Line yAxisId="right" type="monotone" dataKey="count" name="Giao dịch" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 4, fill: "#ffffff" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="owner-management-panel owner-payment-chart-panel">
          <div className="owner-panel-heading">
            <div><h3>Doanh thu theo phương thức thanh toán</h3><p>Tỷ trọng giao dịch đã thanh toán</p></div>
          </div>
          <div className="owner-payment-chart">
            <ResponsiveContainer width="44%" height={230}>
              <PieChart>
                <Pie data={revenueByMethod} dataKey="value" nameKey="name" innerRadius={62} outerRadius={96} paddingAngle={2}>
                  {revenueByMethod.map((entry, index) => <Cell key={entry.name} fill={PAYMENT_COLORS[index % PAYMENT_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="owner-payment-legend">
              {revenueByMethod.length === 0 ? <p>Chưa có giao dịch đã thanh toán.</p> : revenueByMethod.map((item, index) => (
                <span key={item.name}>
                  <i style={{ background: PAYMENT_COLORS[index % PAYMENT_COLORS.length] }} />
                  {item.name}
                  <strong>{formatCurrency(item.value)}</strong>
                  <em>{paidRevenue ? Math.round((item.value / paidRevenue) * 100) : 0}%</em>
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="owner-revenue-bottom-grid">
        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Doanh thu theo bãi xe</h3><p>Xếp hạng theo doanh thu owner nhận</p></div>
          </div>
          <div className="owner-revenue-lot-list">
            {loading ? <p className="owner-empty-cell">Đang tải doanh thu...</p> : null}
            {!loading && revenueByParking.length === 0 ? <p className="owner-empty-cell">Chưa có dữ liệu doanh thu.</p> : null}
            {revenueByParking.map((lot) => (
              <button key={lot.parkingLotName} type="button" onClick={() => setSelectedParking(lot.parkingLotName)}>
                <span>P</span>
                <strong>{lot.parkingLotName}<small>{lot.district || "Chưa có khu vực"}</small></strong>
                <b>{formatCurrency(lot.revenue)}</b>
                <i><em style={{ width: `${paidRevenue ? Math.max(4, (lot.revenue / paidRevenue) * 100) : 0}%` }} /></i>
                <small>{formatNumber(lot.count)} giao dịch</small>
              </button>
            ))}
          </div>
        </section>

        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Top khung giờ doanh thu cao</h3><p>Tổng hợp theo giờ thanh toán</p></div>
          </div>
          <div className="owner-hour-rank">
            {hourlyTop.length === 0 ? <p className="owner-empty-cell">Chưa có dữ liệu khung giờ.</p> : hourlyTop.map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <i><em style={{ width: `${hourlyTop[0]?.amount ? Math.max(8, (item.amount / hourlyTop[0].amount) * 100) : 0}%` }} /></i>
                <strong>{formatCurrency(item.amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="owner-management-panel">
        <div className="owner-panel-heading">
          <div><h3>Giao dịch gần đây</h3><p>Gross, hoa hồng và số tiền owner nhận</p></div>
        </div>
        <div className="owner-table-shell">
          <table className="owner-table owner-designed-table">
            <thead>
              <tr>
                <th>Mã giao dịch</th>
                <th>Mã đơn</th>
                <th>Bãi xe</th>
                <th>Khách hàng</th>
                <th>Phương thức</th>
                <th>Owner nhận</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.slice(0, 12).map((transaction) => (
                <tr key={transaction.id}>
                  <td>{transaction.id}</td>
                  <td>{transaction.bookingCode}</td>
                  <td>{transaction.parkingLotName}</td>
                  <td>{transaction.payer}</td>
                  <td><CreditCard size={15} /> {transaction.method}</td>
                  <td>{formatCurrency(transaction.amount)}</td>
                  <td><StatusBadge status={transaction.status} /></td>
                </tr>
              ))}
              {!loading && filteredTransactions.length === 0 ? <tr><td colSpan={7} className="owner-empty-cell">Không có giao dịch trong bộ lọc hiện tại.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedParkingSummary ? (
        <div className="owner-modal-backdrop" onClick={() => setSelectedParking(null)}>
          <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{selectedParkingSummary.parkingLotName}</h2>
                <p>Chi tiết doanh thu trong kỳ đang chọn.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelectedParking(null)}>×</button>
            </div>
            <div className="owner-detail-grid">
              <div><span>Khu vực</span><strong>{selectedParkingSummary.district || "Chưa có"}</strong></div>
              <div><span>Gross</span><strong>{formatCurrency(selectedParkingSummary.gross)}</strong></div>
              <div><span>Owner nhận</span><strong>{formatCurrency(selectedParkingSummary.revenue)}</strong></div>
              <div><span>Số giao dịch</span><strong>{formatNumber(selectedParkingSummary.count)}</strong></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
