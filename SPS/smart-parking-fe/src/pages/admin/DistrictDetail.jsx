import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import "./AdminOwners.css";
import "./AdminParking.css";

const STATUS_LABELS = {
  active: "Hoạt động",
  paused: "Tạm ngưng",
  locked: "Ngừng hoạt động",
  pending: "Chờ thiết lập",
};

function trendClass(value) {
  return Number(value) >= 0 ? "is-up" : "is-down";
}

function formatTrend(value) {
  const rounded = Number(value || 0);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "0%";
}

export default function DistrictDetail() {
  const { districtId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get(`/admin/districts/${districtId}/detail`);
      setDetail(response.data);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [districtId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const districtFilter = searchParams.get("tab");
    if (districtFilter === "lots") setActiveTab("lots");
  }, [searchParams]);

  const handleSuspend = async () => {
    if (!detail) return;
    const nextStatus = detail.status === "active" ? "locked" : "active";
    try {
      await API.patch(`/admin/districts/${districtId}/status`, { status: nextStatus });
      await loadDetail();
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể cập nhật trạng thái");
    }
  };

  if (loading) {
    return <div className="admin-owners-loading">Đang tải chi tiết khu vực...</div>;
  }

  if (!detail) {
    return (
      <div className="admin-owners-loading">
        <p>Không tìm thấy khu vực.</p>
        <Link to="/admin/parking-lots/areas">Quay lại danh sách</Link>
      </div>
    );
  }

  const stats = detail.stats || {};
  const breakdown = detail.statusBreakdown || {};

  return (
    <div className="admin-parking-page admin-parking-detail-page">
      <p className="admin-users-breadcrumb">
        <Link to="/admin/parking-lots/areas">Quản lý khu vực</Link> &gt; Danh sách khu vực &gt; Chi tiết khu vực
      </p>

      <div className="admin-parking-detail-toolbar">
        <button type="button" className="admin-owners-btn" onClick={() => navigate("/admin/parking-lots/areas")}>
          ← Quay lại danh sách
        </button>
        <div className="admin-parking-detail-toolbar-actions">
          <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleSuspend}>
            {detail.status === "active" ? "Tạm ngưng" : "Kích hoạt"}
          </button>
        </div>
      </div>

      <section className="admin-parking-summary-card">
        <div className="admin-parking-thumb admin-parking-thumb--xl">{detail.name?.slice(0, 1)}</div>
        <div className="admin-parking-summary-body">
          <h2>{detail.label || detail.name}</h2>
          <span className={`admin-owners-status admin-owners-status--${detail.status}`}>
            {STATUS_LABELS[detail.status] || detail.statusLabel}
          </span>
          <div className="admin-parking-summary-grid">
            <div><span>Quản lý</span><strong>{detail.manager?.name}</strong></div>
            <div><span>Email</span><strong>{detail.manager?.email || "—"}</strong></div>
            <div><span>Điện thoại</span><strong>{detail.manager?.phone || "—"}</strong></div>
            <div><span>Số bãi xe</span><strong>{stats.parkingLotCount}</strong></div>
            <div><span>Tổng chỗ đỗ</span><strong>{stats.totalSlots?.toLocaleString("vi-VN")}</strong></div>
            <div><span>Doanh thu tháng</span><strong>{formatCurrency(stats.monthlyRevenue)}</strong></div>
          </div>
        </div>
      </section>

      <div className="admin-parking-tabs">
        <button type="button" className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>
          Tổng quan
        </button>
        <button type="button" className={activeTab === "lots" ? "is-active" : ""} onClick={() => setActiveTab("lots")}>
          Bãi đỗ xe ({stats.parkingLotCount})
        </button>
      </div>

      {activeTab === "overview" ? (
        <>
          <div className="admin-owners-kpis admin-parking-kpis admin-parking-kpis--4">
            <article className="admin-owners-kpi">
              <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">P</div>
              <div>
                <span>Tổng số bãi xe</span>
                <strong>{stats.parkingLotCount}</strong>
              </div>
            </article>
            <article className="admin-owners-kpi">
              <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">🅿️</div>
              <div>
                <span>Tổng số chỗ đỗ</span>
                <strong>{stats.totalSlots?.toLocaleString("vi-VN")}</strong>
              </div>
            </article>
            <article className="admin-owners-kpi">
              <div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple">₫</div>
              <div>
                <span>Doanh thu (tháng)</span>
                <strong>{formatCurrency(stats.monthlyRevenue)}</strong>
                <small className={trendClass(stats.monthlyRevenueChangePercent)}>
                  {formatTrend(stats.monthlyRevenueChangePercent)}
                </small>
              </div>
            </article>
            <article className="admin-owners-kpi">
              <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">%</div>
              <div>
                <span>Tỷ lệ lấp đầy TB</span>
                <strong>{stats.avgOccupancy}%</strong>
              </div>
            </article>
          </div>

          <div className="admin-parking-charts-grid">
            <section className="admin-parking-chart-card">
              <h3>Doanh thu 7 ngày qua</h3>
              <div className="admin-parking-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={detail.charts?.revenue7d || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="admin-parking-chart-card">
              <h3>Tỷ lệ lấp đầy 7 ngày qua</h3>
              <div className="admin-parking-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={detail.charts?.occupancy7d || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Line type="monotone" dataKey="occupancy" stroke="#059669" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="admin-parking-detail-columns">
            <section className="admin-owners-table-card">
              <h3>Top bãi xe theo doanh thu</h3>
              <div className="admin-owners-table-wrap">
                <table className="admin-owners-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Tên bãi xe</th>
                      <th>Số chỗ</th>
                      <th>Lấp đầy</th>
                      <th>Doanh thu (tháng)</th>
                      <th>Xu hướng</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.topParkingLots || []).map((lot, index) => (
                      <tr key={lot.id}>
                        <td>{index + 1}</td>
                        <td>{lot.name}</td>
                        <td>{lot.slotCount}</td>
                        <td>{lot.occupancy}%</td>
                        <td>{formatCurrency(lot.monthlyRevenue)}</td>
                        <td className={trendClass(lot.revenueChangePercent)}>{formatTrend(lot.revenueChangePercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" className="admin-parking-link-btn" onClick={() => setActiveTab("lots")}>
                Xem tất cả bãi xe
              </button>
            </section>

            <aside className="admin-parking-side-widgets">
              <section className="admin-parking-widget">
                <h4>Tình trạng hoạt động</h4>
                <ul>
                  <li><span>Hoạt động</span><strong>{breakdown.active || 0}</strong></li>
                  <li><span>Tạm ngưng</span><strong>{breakdown.paused || 0}</strong></li>
                  <li><span>Ngừng hoạt động</span><strong>{breakdown.locked || 0}</strong></li>
                </ul>
              </section>
            </aside>
          </div>
        </>
      ) : (
        <section className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table">
              <thead>
                <tr>
                  <th>Tên bãi xe</th>
                  <th>Số chỗ</th>
                  <th>Lấp đầy</th>
                  <th>Doanh thu (tháng)</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {(detail.parkingLots || []).map((lot) => (
                  <tr key={lot.id}>
                    <td>{lot.name}</td>
                    <td>{lot.slotCount}</td>
                    <td>{lot.occupancy}%</td>
                    <td>{formatCurrency(lot.monthlyRevenue)}</td>
                    <td>
                      <span className={`admin-owners-status admin-owners-status--${lot.status}`}>
                        {lot.status === "active" ? "Hoạt động" : "Ngừng"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
