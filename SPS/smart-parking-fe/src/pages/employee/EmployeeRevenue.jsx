import { ArrowDownToLine, ArrowUpToLine, CreditCard, TrendingUp, WalletCards } from "lucide-react";

import { useEmployeeContext } from "../../employee/useEmployeeContext";

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function RevenueMetric({ label, value, helper, tone = "blue" }) {
  return (
    <article className={`employee-revenue-metric is-${tone}`}>
      <span>
        <TrendingUp size={21} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{formatMoney(value)}</strong>
        <p>{helper}</p>
      </div>
    </article>
  );
}

function RevenueBars({ points }) {
  const data = Array.isArray(points) ? points : [];
  const maxValue = Math.max(...data.map((item) => Number(item.amount || 0)), 1);

  if (!data.length) {
    return <p className="employee-note">Chưa có dữ liệu doanh thu để hiển thị.</p>;
  }

  return (
    <div className="employee-revenue-bars employee-revenue-bars--modern">
      {data.map((item) => {
        const percent = (Number(item.amount || 0) / maxValue) * 100;
        return (
          <div key={item.label} className="employee-revenue-col">
            <div className="employee-revenue-track">
              <div className="employee-revenue-fill" style={{ height: `${Math.max(percent, 4)}%` }} />
            </div>
            <span className="employee-revenue-label">{item.label}</span>
            <strong className="employee-revenue-value">{formatMoney(item.amount || 0)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function TrafficSummary({ points, occupancyRatio, totalPaidBookings }) {
  const data = Array.isArray(points) ? points : [];
  const totalIn = data.reduce((sum, item) => sum + Number(item.check_ins || 0), 0);
  const totalOut = data.reduce((sum, item) => sum + Number(item.check_outs || 0), 0);
  const busiest = data.reduce(
    (best, item) => {
      const load = Number(item.check_ins || 0) + Number(item.check_outs || 0);
      if (load > best.load) {
        return { label: item.label, load };
      }
      return best;
    },
    { label: "--", load: -1 },
  );
  const ratio = Number(occupancyRatio || 0);

  return (
    <div className="employee-revenue-summary">
      <div className="employee-revenue-summary-grid">
        <div>
          <span><ArrowDownToLine size={18} /></span>
          <small>Tổng check-in</small>
          <strong>{totalIn}</strong>
        </div>
        <div>
          <span><ArrowUpToLine size={18} /></span>
          <small>Tổng check-out</small>
          <strong>{totalOut}</strong>
        </div>
        <div>
          <span><TrendingUp size={18} /></span>
          <small>Giờ cao điểm</small>
          <strong>{busiest.label}</strong>
        </div>
        <div>
          <span><CreditCard size={18} /></span>
          <small>Tổng vé đã thanh toán</small>
          <strong>{Number(totalPaidBookings || 0)}</strong>
        </div>
      </div>

      <div className="employee-occupancy-progress">
        <div>
          <span>Tỷ lệ lấp đầy hiện tại</span>
          <strong>{ratio.toLocaleString("vi-VN")}%</strong>
        </div>
        <div className="employee-occupancy-track">
          <span style={{ width: `${Math.max(0, Math.min(ratio, 100))}%` }} />
        </div>
      </div>
    </div>
  );
}

function PaymentMethods({ totalPaidBookings }) {
  const total = Number(totalPaidBookings || 0);
  return (
    <section className="employee-modern-card employee-payment-card">
      <div className="employee-modern-card-heading">
        <div>
          <h2>Phương thức thanh toán</h2>
          <p>Tổng hợp theo các giao dịch đã ghi nhận</p>
        </div>
      </div>
      <div className="employee-payment-donut" style={{ "--paid-percent": total > 0 ? "100%" : "0%" }}>
        <div>
          <WalletCards size={26} />
          <strong>{total}</strong>
          <span>vé đã thanh toán</span>
        </div>
      </div>
      <div className="employee-payment-list">
        <p><span>Đã thanh toán</span><strong>{total}</strong></p>
        <p><span>Chờ dữ liệu phương thức</span><strong>{total > 0 ? "--" : 0}</strong></p>
      </div>
    </section>
  );
}

function RecentTransactions({ points }) {
  const data = Array.isArray(points) ? [...points].reverse().slice(0, 5) : [];
  return (
    <section className="employee-modern-card">
      <div className="employee-modern-card-heading">
        <div>
          <h2>Chi tiết giao dịch gần đây</h2>
          <p>Doanh thu theo ngày từ dữ liệu thanh toán</p>
        </div>
      </div>
      <div className="employee-transaction-list">
        {data.length ? data.map((item) => (
          <article key={item.label}>
            <span><CreditCard size={18} /></span>
            <div>
              <strong>{item.label}</strong>
              <small>Doanh thu đã thanh toán</small>
            </div>
            <b>{formatMoney(item.amount || 0)}</b>
          </article>
        )) : <p className="employee-note">Chưa có dữ liệu giao dịch gần đây.</p>}
      </div>
    </section>
  );
}

export default function EmployeeRevenue() {
  const context = useEmployeeContext() || {};
  const { revenue = {} } = context;

  return (
    <section className="employee-workspace-page employee-revenue-page">
      <section className="employee-revenue-metric-grid">
        <RevenueMetric label="Doanh thu hôm nay" value={revenue?.revenueToday || 0} helper="Cập nhật theo giao dịch đã thanh toán trong ngày." tone="blue" />
        <RevenueMetric label="Doanh thu tháng" value={revenue?.revenueMonth || 0} helper="Tổng doanh thu đã ghi nhận từ ngày đầu tháng." tone="purple" />
      </section>

      <section className="employee-revenue-layout">
        <article className="employee-modern-card employee-revenue-chart-card">
          <div className="employee-modern-card-heading">
            <div>
              <h2>Biểu đồ doanh thu 7 ngày</h2>
              <p>Đơn vị: VND</p>
            </div>
          </div>
          <RevenueBars points={revenue?.revenueByDay} />
        </article>

        <article className="employee-modern-card">
          <div className="employee-modern-card-heading">
            <div>
              <h2>Tóm tắt lưu lượng hôm nay</h2>
              <p>Theo dữ liệu check-in/check-out tại cổng</p>
            </div>
          </div>
          <TrafficSummary
            points={revenue?.trafficByHour}
            occupancyRatio={revenue?.occupancyRatio}
            totalPaidBookings={revenue?.totalPaidBookings}
          />
        </article>
      </section>

      <section className="employee-revenue-side-grid">
        <PaymentMethods totalPaidBookings={revenue?.totalPaidBookings} />
        <RecentTransactions points={revenue?.revenueByDay} />
      </section>
    </section>
  );
}
