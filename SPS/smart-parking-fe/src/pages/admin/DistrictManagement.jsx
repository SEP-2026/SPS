import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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

export default function DistrictManagement() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadAreas = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.append("search", search.trim());
      if (statusFilter !== "all") params.append("status", statusFilter);
      const response = await API.get(`/admin/districts/management?${params.toString()}`);
      setData(response.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter]);

  useEffect(() => {
    loadAreas();
  }, [loadAreas]);

  const loadDetail = useCallback(async (districtId) => {
    if (!districtId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await API.get(`/admin/districts/${districtId}/detail`);
      setDetail(response.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleSuspend = async () => {
    if (!selectedId || !detail) return;
    const nextStatus = detail.status === "active" ? "locked" : "active";
    try {
      await API.patch(`/admin/districts/${selectedId}/status`, { status: nextStatus });
      await loadAreas();
      await loadDetail(selectedId);
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể cập nhật trạng thái khu vực");
    }
  };

  const summary = data?.summary || {};
  const trends = summary.trends || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải danh sách khu vực...</div>;
  }

  return (
    <div className="admin-parking-page admin-owners-page">
      <p className="admin-users-breadcrumb">Bãi đỗ xe &gt; Khu vực (Quận/Huyện)</p>

      <div className="admin-owners-kpis admin-parking-kpis admin-parking-kpis--4">
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">🗺️</div>
          <div>
            <span>Tổng khu vực</span>
            <strong>{summary.totalAreas || 0}</strong>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">P</div>
          <div>
            <span>Tổng bãi xe</span>
            <strong>{summary.totalParkingLots || 0}</strong>
            <small className={trendClass(trends.parkingLotsChangePercent)}>
              {formatTrend(trends.parkingLotsChangePercent)}
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">🅿️</div>
          <div>
            <span>Tổng chỗ đỗ</span>
            <strong>{(summary.totalSlots || 0).toLocaleString("vi-VN")}</strong>
            <small className={trendClass(trends.totalSlotsChangePercent)}>
              {formatTrend(trends.totalSlotsChangePercent)}
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple">₫</div>
          <div>
            <span>Doanh thu (tháng)</span>
            <strong>{formatCurrency(summary.monthlyRevenue)}</strong>
            <small className={trendClass(trends.revenueChangePercent)}>
              {formatTrend(trends.revenueChangePercent)}
            </small>
          </div>
        </article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input
            type="search"
            placeholder="Tìm kiếm theo tên khu vực..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadAreas();
              }
            }}
          />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Trạng thái: Tất cả</option>
            <option value="active">Hoạt động</option>
            <option value="paused">Tạm ngưng</option>
            <option value="locked">Ngừng hoạt động</option>
          </select>
        </div>
        <div className="admin-owners-toolbar-actions">
          <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadAreas(); }}>
            Áp dụng
          </button>
        </div>
      </div>

      <div className={`admin-owners-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table admin-parking-table">
              <thead>
                <tr>
                  <th>Khu vực</th>
                  <th>Quản lý khu vực</th>
                  <th>Số bãi xe</th>
                  <th>Tổng chỗ đỗ</th>
                  <th>Doanh thu (tháng)</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((area) => (
                  <tr
                    key={area.id}
                    className={selectedId === area.id ? "is-selected" : ""}
                    onClick={() => setSelectedId(area.id)}
                  >
                    <td>
                      <div className="admin-parking-lot-cell">
                        <div className="admin-parking-thumb">{area.name?.slice(0, 1)}</div>
                        <div>
                          <strong>{area.label || area.name}</strong>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div>{area.managerName}</div>
                      <small style={{ color: "#64748b" }}>{area.managerEmail || "—"}</small>
                    </td>
                    <td>{area.parkingLotCount}</td>
                    <td>{area.totalSlots?.toLocaleString("vi-VN")}</td>
                    <td>
                      <div>{formatCurrency(area.monthlyRevenue)}</div>
                      <small className={trendClass(area.monthlyRevenueChangePercent)}>
                        {formatTrend(area.monthlyRevenueChangePercent)}
                      </small>
                    </td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${area.status}`}>
                        {STATUS_LABELS[area.status] || area.statusLabel}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admin-owners-row-actions">
                        <button type="button" className="admin-owners-icon-btn" title="Xem" onClick={() => setSelectedId(area.id)}>👁</button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Chi tiết"
                          onClick={() => navigate(`/admin/parking-lots/areas/${area.id}`)}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7}>Không có khu vực phù hợp bộ lọc.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-owners-pagination">
            <span>
              Hiển thị {(pagination.page - 1) * pagination.pageSize + 1} đến{" "}
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} của {pagination.total} khu vực
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
              </select>
              <button type="button" className="admin-owners-btn" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
                Trước
              </button>
              <span>Trang {pagination.page}/{pagination.totalPages}</span>
              <button
                type="button"
                className="admin-owners-btn"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Sau
              </button>
            </div>
          </div>
        </div>

        {selectedId ? (
          <aside className="admin-owners-detail admin-parking-detail">
            <button type="button" className="admin-owners-detail-close" onClick={() => { setSelectedId(null); setDetail(null); }} aria-label="Đóng">
              ✕
            </button>
            {detailLoading || !detail ? (
              <p>Đang tải chi tiết...</p>
            ) : (
              <>
                <div className="admin-parking-detail-hero">
                  <div className="admin-parking-thumb admin-parking-thumb--lg">{detail.name?.slice(0, 1)}</div>
                  <div>
                    <strong>{detail.label || detail.name}</strong>
                    <div style={{ marginTop: 8 }}>
                      <span className={`admin-owners-status admin-owners-status--${detail.status}`}>
                        {STATUS_LABELS[detail.status] || detail.statusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="admin-owners-detail-meta">
                  <div><strong>Quản lý:</strong> {detail.manager?.name}</div>
                  <div>✉️ {detail.manager?.email || "—"}</div>
                  <div>📞 {detail.manager?.phone || "—"}</div>
                  <div><strong>Số bãi xe:</strong> {detail.stats?.parkingLotCount}</div>
                  <div><strong>Tổng chỗ đỗ:</strong> {detail.stats?.totalSlots?.toLocaleString("vi-VN")}</div>
                  <div><strong>Doanh thu tháng:</strong> {formatCurrency(detail.stats?.monthlyRevenue)}</div>
                  <div><strong>Lấp đầy TB:</strong> {detail.stats?.avgOccupancy}%</div>
                </div>

                <div className="admin-owners-detail-actions">
                  <button type="button" className="admin-owners-btn" onClick={() => navigate(`/admin/parking-lots/areas/${detail.id}`)}>
                    Xem chi tiết khu vực
                  </button>
                  <button
                    type="button"
                    className="admin-owners-btn"
                    onClick={() => navigate(`/admin/parking-lots?districtId=${detail.id}&page=1`)}
                  >
                    Xem danh sách bãi xe
                  </button>
                  <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleSuspend}>
                    {detail.status === "active" ? "Tạm ngưng khu vực" : "Kích hoạt khu vực"}
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
