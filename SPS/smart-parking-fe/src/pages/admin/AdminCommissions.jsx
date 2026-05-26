import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "../../owner/OwnerUI";
import { PieChart } from "../../owner/PieChart";
import API from "../../services/api";
import { formatDateTimeVN, toDateInputValue } from "../../utils/dateTime";
import "./AdminCommissions.css";

const DONUT_COLORS = ["#2563eb", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#94a3b8"];

const STATUS_LABELS = {
  paid: "Đã thanh toán",
  partial: "Còn phải trả",
  unpaid: "Chưa thanh toán",
};

function defaultDateRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 15);
  return {
    dateFrom: toDateInputValue(start),
    dateTo: toDateInputValue(end),
  };
}

function trendClass(value) {
  return value >= 0 ? "is-up" : "is-down";
}

function formatTrend(value) {
  const rounded = Number(value || 0);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

export default function AdminCommissions() {
  const initialRange = useMemo(() => defaultDateRange(), []);
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom);
  const [dateTo, setDateTo] = useState(initialRange.dateTo);
  const [districtId, setDistrictId] = useState("all");
  const [paymentStatus, setPaymentStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);

  const loadCommissions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        dateFrom,
        dateTo,
        page: String(page),
        pageSize: "10",
      });
      if (districtId !== "all") params.append("districtId", districtId);
      if (paymentStatus !== "all") params.append("paymentStatus", paymentStatus);
      if (search.trim()) params.append("search", search.trim());

      const response = await API.get(`/admin/commissions?${params.toString()}`);
      setData(response.data);
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || "Không tải được dữ liệu hoa hồng từ máy chủ";
      setError(typeof message === "string" ? message : "Không tải được dữ liệu hoa hồng");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, districtId, paymentStatus, search, page]);

  useEffect(() => {
    loadCommissions();
  }, [loadCommissions]);

  const donutData = useMemo(() => {
    const items = data?.charts?.districtDistribution || [];
    return items.map((item, index) => ({
      label: item.label,
      amount: item.amount,
      color: DONUT_COLORS[index % DONUT_COLORS.length],
    }));
  }, [data]);

  const handlePayout = async () => {
    if (!window.confirm("Xác nhận thanh toán cho các đối tác đủ điều kiện?")) {
      return;
    }
    setPaying(true);
    try {
      const response = await API.post("/admin/commissions/payout", {});
      const processed = response.data?.processed?.length || 0;
      const skipped = response.data?.skipped?.length || 0;
      window.alert(`${response.data?.message || "Hoàn tất"}\nThành công: ${processed}\nBỏ qua: ${skipped}`);
      await loadCommissions();
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || "Không thể xử lý thanh toán";
      window.alert(typeof message === "string" ? message : "Không thể xử lý thanh toán");
    } finally {
      setPaying(false);
    }
  };

  if (loading && !data) {
    return <div className="admin-commissions-loading">Đang tải dữ liệu hoa hồng & thanh toán...</div>;
  }

  if (error && !data) {
    return (
      <div className="admin-commissions-error">
        <p>{error}</p>
        <button type="button" className="admin-commissions-btn admin-commissions-btn--primary" onClick={loadCommissions}>
          Thử lại
        </button>
      </div>
    );
  }

  const summary = data?.summary || {};
  const trends = summary.trends || {};
  const partners = data?.partners || { items: [], total: 0, page: 1, totalPages: 1 };

  return (
    <div className="admin-commissions-page">
      <div className="admin-commissions-kpis">
        <article className="admin-commissions-kpi">
          <span>Tổng doanh thu</span>
          <strong>{formatCurrency(summary.totalRevenue)}</strong>
          <small className={trendClass(trends.revenueChangePercent)}>{formatTrend(trends.revenueChangePercent)} so với kỳ trước</small>
        </article>
        <article className="admin-commissions-kpi">
          <span>Tổng hoa hồng</span>
          <strong>{formatCurrency(summary.totalCommission)}</strong>
          <small className={trendClass(trends.commissionChangePercent)}>{formatTrend(trends.commissionChangePercent)} so với kỳ trước</small>
        </article>
        <article className="admin-commissions-kpi">
          <span>Đã thanh toán</span>
          <strong>{formatCurrency(summary.paidToPartners)}</strong>
          <small className={trendClass(trends.paidChangePercent)}>{formatTrend(trends.paidChangePercent)}</small>
        </article>
        <article className="admin-commissions-kpi">
          <span>Còn phải trả</span>
          <strong>{formatCurrency(summary.remainingToPay)}</strong>
          <small className={trendClass(-Number(trends.remainingChangePercent || 0))}>{formatTrend(trends.remainingChangePercent)}</small>
        </article>
        <article className="admin-commissions-kpi">
          <span>Đối tác hoạt động</span>
          <strong>{summary.activePartners || 0}</strong>
          <small className="is-up">+{trends.activePartnersDelta || 0} mới trong kỳ</small>
        </article>
      </div>

      <div className="admin-commissions-toolbar">
        <div className="admin-commissions-filters">
          <input type="date" value={dateFrom} onChange={(e) => { setPage(1); setDateFrom(e.target.value); }} />
          <input type="date" value={dateTo} onChange={(e) => { setPage(1); setDateTo(e.target.value); }} />
          <select value={districtId} onChange={(e) => { setPage(1); setDistrictId(e.target.value); }}>
            <option value="all">Tất cả quận/huyện</option>
            {(data?.districts || []).map((district) => (
              <option key={district.id} value={district.id}>{district.name}</option>
            ))}
          </select>
          <select value={paymentStatus} onChange={(e) => { setPage(1); setPaymentStatus(e.target.value); }}>
            <option value="all">Tất cả trạng thái thanh toán</option>
            <option value="paid">Đã thanh toán</option>
            <option value="partial">Còn phải trả</option>
            <option value="unpaid">Chưa thanh toán</option>
          </select>
          <input
            type="search"
            placeholder="Tìm đối tác..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadCommissions();
              }
            }}
          />
        </div>
        <div className="admin-commissions-actions">
          <button type="button" className="admin-commissions-btn" onClick={() => { setPage(1); loadCommissions(); }}>
            Áp dụng lọc
          </button>
          <Link to="/admin/revenue" className="admin-commissions-btn">Xem doanh thu chi tiết</Link>
        </div>
      </div>

      <div className="admin-commissions-main">
        <div className="admin-commissions-left">
          <div className="admin-commissions-charts">
            <section className="admin-commissions-card">
              <h3>Doanh thu & hoa hồng</h3>
              <p>{data?.range?.label || "Theo khoảng thời gian đã chọn"}</p>
              <div className="admin-commissions-line-chart" style={{ width: "100%", minHeight: 280, height: 280 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart data={data?.charts?.revenueCommission || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => formatCurrency(value)} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name="Doanh thu" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="commission" name="Hoa hồng" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="admin-commissions-card">
              <h3>Tỷ lệ hoa hồng theo quận</h3>
              <p>Tổng hoa hồng {formatCurrency(summary.totalCommission)}</p>
              <div className="admin-commissions-donut-wrap">
                <PieChart
                  data={donutData}
                  hideLegend
                  className="admin-commissions-pie"
                  formatValue={(value) => formatCurrency(value)}
                />
                <ul className="admin-commissions-legend">
                  {(data?.charts?.districtDistribution || []).map((item, index) => (
                    <li key={`${item.label}-${index}`} className="admin-commissions-legend-item">
                      <span
                        className="admin-commissions-dot"
                        style={{ background: DONUT_COLORS[index % DONUT_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <div className="admin-commissions-legend-body">
                        <span className="admin-commissions-legend-name">{item.label}</span>
                        <div className="admin-commissions-legend-meta">
                          <span className="admin-commissions-legend-percent">{item.percent}%</span>
                          <strong className="admin-commissions-legend-value">{formatCurrency(item.amount)}</strong>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          <section className="admin-commissions-card">
            <h3>Đối tác</h3>
            <p>Hiển thị {partners.items.length} / {partners.total} đối tác • Cập nhật {formatDateTimeVN(data?.generatedAt)}</p>
            <div className="admin-commissions-table-wrap">
              <table className="admin-commissions-table">
                <thead>
                  <tr>
                    <th>Đối tác</th>
                    <th>Khu vực</th>
                    <th>Doanh thu</th>
                    <th>Tỷ lệ HH</th>
                    <th>Tiền hoa hồng</th>
                    <th>Đã thanh toán</th>
                    <th>Còn lại</th>
                    <th className="admin-commissions-status-head">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.items.length ? partners.items.map((partner) => (
                    <tr key={partner.id}>
                      <td className="admin-commissions-partner">
                        <strong>{partner.name}</strong>
                        <small>{partner.subtitle}</small>
                      </td>
                      <td className="admin-commissions-district-cell">{partner.district}</td>
                      <td>
                        <div>{formatCurrency(partner.revenue)}</div>
                        <div className={`admin-commissions-change ${trendClass(partner.revenueChangePercent)}`}>
                          {formatTrend(partner.revenueChangePercent)}
                        </div>
                      </td>
                      <td className="admin-commissions-rate-cell">{partner.commissionRate}%</td>
                      <td>{formatCurrency(partner.commissionAmount)}</td>
                      <td>{formatCurrency(partner.paidAmount)}</td>
                      <td>{formatCurrency(partner.remainingAmount)}</td>
                      <td className="admin-commissions-status-cell">
                        <span className={`admin-commissions-status admin-commissions-status--${partner.paymentStatus}`}>
                          {STATUS_LABELS[partner.paymentStatus] || partner.paymentStatus}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8}>Không có đối tác phù hợp bộ lọc.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="admin-commissions-pagination">
              <span>
                Hiển thị {(partners.page - 1) * (partners.pageSize || 10) + 1} đến{" "}
                {Math.min(partners.page * (partners.pageSize || 10), partners.total)} của {partners.total} đối tác
              </span>
              <div className="admin-commissions-actions">
                <button type="button" className="admin-commissions-btn" disabled={partners.page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Trước
                </button>
                <span>Trang {partners.page}/{partners.totalPages}</span>
                <button type="button" className="admin-commissions-btn" disabled={partners.page >= partners.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Sau
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="admin-commissions-sidebar">
          <section className="admin-commissions-card admin-commissions-pay-card">
            <h3>Tổng quan thanh toán</h3>
            <span>Số tiền còn phải trả</span>
            <strong className="amount">{formatCurrency(data?.paymentOverview?.remainingToPay)}</strong>
            <ul>
              <li>Chu kỳ: {data?.paymentOverview?.paymentCycle}</li>
              <li>Dự kiến thanh toán: {data?.paymentOverview?.expectedPaymentDate}</li>
              <li>Phương thức: {data?.paymentOverview?.paymentMethod}</li>
            </ul>
            <button type="button" className="admin-commissions-btn admin-commissions-btn--primary" disabled={paying} onClick={handlePayout}>
              {paying ? "Đang xử lý..." : "Thanh toán ngay"}
            </button>
          </section>

          <section className="admin-commissions-card">
            <h3>Lịch sử thanh toán gần đây</h3>
            <div className="admin-commissions-history">
              {(data?.recentPayments || []).length ? data.recentPayments.map((item) => (
                <div key={item.id} className="admin-commissions-history-item">
                  <div>
                    <strong>{formatCurrency(item.amount)}</strong>
                    <div>{item.ownerName}</div>
                    <small>{item.code} • {formatDateTimeVN(item.time)}</small>
                  </div>
                  <span className="admin-commissions-status admin-commissions-status--paid">Đã thanh toán</span>
                </div>
              )) : (
                <p>Chưa có lịch sử thanh toán.</p>
              )}
            </div>
          </section>

          <section className="admin-commissions-card">
            <h3>Hỗ trợ kế toán</h3>
            <p>Liên hệ {data?.paymentOverview?.supportEmail} nếu cần đối soát giao dịch đối tác.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
