import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { buildRevenueSeries, getRangeSummaryLabel } from "../../owner/ownerAnalytics";
import { formatCurrency, formatDateTime, LineChart, SectionCard, StatCard, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import API from "../../services/api";
import { parseVietnamDate, toDateInputValue } from "../../utils/dateTime";

const CHART_RANGE_OPTIONS = [
  { value: "day", label: "Theo ngày" },
  { value: "week", label: "Theo tuần" },
  { value: "month", label: "Theo tháng" },
  { value: "quarter", label: "3 tháng gần nhất" },
  { value: "custom", label: "Khác" },
];

function isTodayIso(value) {
  if (!value) {
    return false;
  }
  const date = parseVietnamDate(value);
  if (!date) {
    return false;
  }
  const now = parseVietnamDate(new Date());
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export default function OwnerOverview() {
  const { ownerData, stats, isSyncing } = useOwnerContext();
  const [range, setRange] = useState("day");
  const [overviewError, setOverviewError] = useState("");
  const [overviewData, setOverviewData] = useState({
    stats,
    vehiclesInLot: ownerData.bookings.filter((booking) => booking.status === "in_progress" || booking.status === "confirmed"),
    todayBookings: ownerData.bookings.filter((booking) => isTodayIso(booking.startTime)),
    transactions: ownerData.transactions,
  });
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return toDateInputValue(date);
  });
  const [dateTo, setDateTo] = useState(() => toDateInputValue(new Date()));

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setOverviewError("");
        const res = await API.get("/owner/overview");
        setOverviewData({
          stats: res.data?.stats || stats,
          vehiclesInLot: res.data?.vehiclesInLot || [],
          todayBookings: res.data?.todayBookings || [],
          transactions: res.data?.transactions || [],
        });
      } catch (err) {
        setOverviewError(err?.response?.data?.detail || "Không tải được dữ liệu tổng quan");
        setOverviewData({
          stats,
          vehiclesInLot: ownerData.bookings.filter((booking) => booking.status === "in_progress" || booking.status === "confirmed"),
          todayBookings: ownerData.bookings.filter((booking) => isTodayIso(booking.startTime)),
          transactions: ownerData.transactions,
        });
      }
    };
    fetchOverview();

    const intervalId = window.setInterval(fetchOverview, 10000);
    const handleFocus = () => fetchOverview();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchOverview();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [ownerData.bookings, ownerData.transactions, stats]);

  const activeRange = range === "custom" ? "day" : range;
  const effectiveStats = overviewData.stats || stats;
  const vehiclesInLot = overviewData.vehiclesInLot || [];
  const todayBookings = overviewData.todayBookings || [];
  const chartData = useMemo(() => {
    const series = buildRevenueSeries(overviewData.transactions || [], dateFrom, dateTo, activeRange);
    return series.length > 0 ? series : [{ label: "Không có dữ liệu", amount: 0 }];
  }, [overviewData.transactions, dateFrom, dateTo, activeRange]);
  const reviewSummary = useMemo(() => {
    const allReviews = ownerData.reviews || [];
    const total = allReviews.length;
    const avg = total ? (allReviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / total) : 0;
    const unreplied = allReviews.filter((item) => !item.ownerReply).length;
    return { avg, unreplied };
  }, [ownerData.reviews]);

  return (
    <div className="owner-page-grid">
      <div className="owner-stats-grid owner-stats-grid--wide">
        <StatCard title="Tổng số chỗ đỗ" value={effectiveStats.totalSlots} note="Sức chứa toàn bộ bãi owner quản lý" trend={`${effectiveStats.managedParkingCount} bãi đang quản lý`} icon="parking" />
        <StatCard title="Đang sử dụng" value={effectiveStats.usedSlots} note="Vị trí đang có booking hoạt động" trend={`${vehiclesInLot.length} xe trong bãi`} icon="booking" />
        <StatCard title="Chỗ còn trống" value={effectiveStats.availableSlots} note="Sẵn sàng nhận xe" trend={`${Math.round((effectiveStats.availableSlots / Math.max(effectiveStats.totalSlots, 1)) * 100)}% trống`} icon="dashboard" />
        <StatCard title="Doanh thu hôm nay" value={formatCurrency(effectiveStats.todayRevenue)} note="Giao dịch đã thanh toán trong ngày" trend={`${(overviewData.transactions || []).filter((item) => item.status === "paid" && isTodayIso(item.time)).length} giao dịch`} icon="revenue" />
        <StatCard title="Lượt xe hôm nay" value={effectiveStats.todayBookings} note="Xe vào bãi trong ngày" trend={`${todayBookings.length} booking`} icon="booking" />
      </div>

      <div className="owner-two-col">
        <SectionCard
          title="Doanh thu bãi đỗ"
          subtitle={`Theo dõi nhanh doanh thu theo kỳ và khoảng thời gian: ${getRangeSummaryLabel(activeRange, dateFrom, dateTo)}.`}
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
          {overviewError ? <p className="owner-empty-cell">{overviewError}</p> : null}
          <LineChart data={chartData} />
        </SectionCard>

        <SectionCard title="Quản lý nhanh" subtitle="Các thao tác owner dùng thường xuyên trong ngày.">
          <div className="owner-quick-actions">
            <Link to="/owner/parking" className="owner-quick-action">
              <strong>Quản lý chỗ đỗ</strong>
              <span>Thêm hoặc sửa vị trí đỗ xe.</span>
            </Link>
            <Link to="/owner/bookings" className="owner-quick-action">
              <strong>Xem booking</strong>
              <span>Kiểm tra booking hôm nay.</span>
            </Link>
            <Link to="/owner/employees" className="owner-quick-action">
              <strong>Tài khoản bãi</strong>
              <span>Tạo tài khoản cho nhân viên quét QR tại cổng.</span>
            </Link>
            <Link to="/owner/reviews" className="owner-quick-action">
              <strong>⭐ Đánh giá gần đây</strong>
              <span>Rating TB: {reviewSummary.avg.toFixed(1)}/5 · {reviewSummary.unreplied} đánh giá chưa phản hồi.</span>
            </Link>
          </div>
        </SectionCard>
      </div>

      <div className="owner-two-col owner-two-col--secondary">
        <SectionCard title="Xe đang trong bãi" subtitle="Danh sách xe cần theo dõi thời điểm hiện tại.">
          <div className="owner-table-shell">
            <table className="owner-table">
              <thead>
                <tr>
                  <th>Biển số</th>
                  <th>Khách hàng</th>
                  <th>Chỗ đỗ</th>
                  <th>Giờ vào</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {!isSyncing && vehiclesInLot.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="owner-empty-cell">Hiện chưa có xe nào đang hoạt động trong bãi.</td>
                  </tr>
                ) : null}
                {vehiclesInLot.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.plate}</td>
                    <td>
                      <strong>{booking.user}</strong>
                      <span>{booking.code}</span>
                    </td>
                    <td>{booking.slotCode}</td>
                    <td>{formatDateTime(booking.startTime)}</td>
                    <td><StatusBadge status={booking.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title="Booking hôm nay" subtitle="Các booking phát sinh trong ngày tại toàn bộ bãi owner quản lý.">
          <div className="owner-table-shell">
            <table className="owner-table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Biển số</th>
                  <th>Giờ vào</th>
                  <th>Giờ ra</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {!isSyncing && todayBookings.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="owner-empty-cell">Hôm nay chưa có booking nào phát sinh.</td>
                  </tr>
                ) : null}
                {todayBookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.code}</td>
                    <td>{booking.plate}</td>
                    <td>{formatDateTime(booking.startTime)}</td>
                    <td>{formatDateTime(booking.endTime)}</td>
                    <td><StatusBadge status={booking.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
