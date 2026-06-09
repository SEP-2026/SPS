import { useCallback, useEffect, useState } from "react";
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
import { useAdminContext } from "../../admin/useAdminContext";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminOwners.css";

const EMPTY_OWNER = { name: "", email: "", phone: "", parkingLot: "", status: "active" };

const STATUS_LABELS = {
  active: "Hoạt động",
  pending: "Chờ duyệt",
  locked: "Bị khóa",
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

export default function OwnerManagement() {
  const { actions } = useAdminContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [createdSort, setCreatedSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_OWNER);
  const [editingOwner, setEditingOwner] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", status: "active", parkingLot: "" });

  const loadOwners = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        createdSort,
      });
      if (search.trim()) params.append("search", search.trim());
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (districtFilter !== "all") params.append("districtId", districtFilter);

      const response = await API.get(`/admin/owners/management?${params.toString()}`);
      setData(response.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, districtFilter, createdSort]);

  useEffect(() => {
    loadOwners();
  }, [loadOwners]);

  const loadDetail = useCallback(async (ownerId) => {
    if (!ownerId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await API.get(`/admin/owners/${ownerId}/detail`);
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

  const handleSelectOwner = (owner) => {
    setSelectedId(owner.id);
    setEditForm({
      name: owner.name || "",
      email: owner.email || "",
      phone: owner.phone || "",
      status: owner.accountStatus === "active" ? "active" : "suspended",
      parkingLot: owner.parkingLots?.[0]?.name || "",
    });
  };

  const closeDetailPanel = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const handleLockToggle = async () => {
    if (!selectedId || !detail) return;
    const nextStatus = detail.status === "locked" ? "active" : "suspended";
    const ok = await actions.toggleOwnerStatus(selectedId, nextStatus === "active" ? "active" : "suspended");
    if (ok) {
      await loadOwners();
      await loadDetail(selectedId);
    }
  };

  const summary = data?.summary || {};
  const trends = summary.trends || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải danh sách chủ bãi / đối tác...</div>;
  }

  if (!actions) {
    return <div className="admin-owners-loading">Đang tải quyền thao tác admin...</div>;
  }

  return (
    <div className="admin-owners-page">
      <div className="admin-owners-kpis">
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">👤</div>
          <div>
            <span>Tổng chủ bãi</span>
            <strong>{summary.totalOwners || 0}</strong>
            <small className={trendClass(trends.totalOwnersChangePercent)}>
              {formatTrend(trends.totalOwnersChangePercent)} tuần trước
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">🚗</div>
          <div>
            <span>Đang hoạt động</span>
            <strong>{summary.activeOwners || 0}</strong>
            <small className={trendClass(trends.activeChangePercent)}>{formatTrend(trends.activeChangePercent)}</small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">⏳</div>
          <div>
            <span>Chờ duyệt</span>
            <strong>{summary.pendingOwners || 0}</strong>
            <small className={trendClass(trends.pendingChangePercent)}>{formatTrend(trends.pendingChangePercent)}</small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--red">🔒</div>
          <div>
            <span>Bị khóa</span>
            <strong>{summary.lockedOwners || 0}</strong>
            <small className={trendClass(trends.lockedChangePercent)}>{formatTrend(trends.lockedChangePercent)}</small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple">💰</div>
          <div>
            <span>Tổng doanh thu (7 ngày)</span>
            <strong>{formatCurrency(summary.totalRevenue7d)}</strong>
            <small className={trendClass(trends.revenueChangePercent)}>{formatTrend(trends.revenueChangePercent)}</small>
          </div>
        </article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input
            type="search"
            placeholder="Tìm kiếm chủ bãi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadOwners();
              }
            }}
          />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="pending">Chờ duyệt</option>
            <option value="locked">Bị khóa</option>
          </select>
          <select value={districtFilter} onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả quận/huyện</option>
            {(data?.districts || []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={createdSort} onChange={(e) => { setCreatedSort(e.target.value); setPage(1); }}>
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>
        </div>
        <div className="admin-owners-toolbar-actions">
          <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadOwners(); }}>
            Áp dụng
          </button>
          <button type="button" className="admin-owners-btn admin-owners-btn--primary" onClick={() => setIsCreateModalOpen(true)}>
            + Thêm chủ bãi
          </button>
        </div>
      </div>

      <div className={`admin-owners-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table">
              <thead>
                <tr>
                  <th>Chủ bãi / Đối tác</th>
                  <th>Quản lý khu vực</th>
                  <th>Số bãi xe</th>
                  <th>Doanh thu (7 ngày)</th>
                  <th>Hoa hồng nền tảng</th>
                  <th className="admin-owners-status-head">Trạng thái</th>
                  <th>Ngày tạo</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((owner) => (
                  <tr
                    key={owner.id}
                    className={selectedId === owner.id ? "is-selected" : ""}
                    onClick={() => handleSelectOwner(owner)}
                  >
                    <td className="admin-owners-partner">
                      <strong>
                        {owner.name}
                        {owner.isVerified ? <span className="admin-owners-verified">Verified</span> : null}
                      </strong>
                      <small>{owner.email}</small>
                      <small>{owner.phone || "—"}</small>
                    </td>
                    <td>
                      <div className="admin-owners-areas">
                        {(owner.managedAreas || [owner.district]).filter(Boolean).map((area) => (
                          <span key={area} className="admin-owners-area-tag">{area}</span>
                        ))}
                      </div>
                    </td>
                    <td>{owner.parkingLotCount} bãi xe</td>
                    <td>
                      <div>{formatCurrency(owner.revenue7d)}</div>
                      <div className={`admin-owners-revenue-change ${trendClass(owner.revenue7dChangePercent)}`}>
                        {formatTrend(owner.revenue7dChangePercent)}
                      </div>
                    </td>
                    <td>
                      <div className="admin-owners-commission">
                        <strong>{formatCurrency(owner.commission7d)}</strong>
                        <span>({owner.commissionRate}%)</span>
                      </div>
                    </td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${owner.status}`}>
                        {STATUS_LABELS[owner.status] || owner.status}
                      </span>
                    </td>
                    <td>{formatDateTimeVN(owner.createdAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admin-owners-row-actions">
                        <button type="button" className="admin-owners-icon-btn" title="Xem" onClick={() => handleSelectOwner(owner)}>👁</button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Sửa"
                          onClick={() => {
                            handleSelectOwner(owner);
                            setEditingOwner(owner);
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Reset mật khẩu"
                          onClick={() => actions.resetOwnerPassword(owner.id)}
                        >
                          🔑
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8}>Không có chủ bãi phù hợp bộ lọc.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-owners-pagination">
            <span>
              Hiển thị {(pagination.page - 1) * pagination.pageSize + 1} đến{" "}
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} của {pagination.total} chủ bãi
            </span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
              <button type="button" className="admin-owners-btn" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>
                Trước
              </button>
              <span>Trang {pagination.page}/{pagination.totalPages}</span>
              <button type="button" className="admin-owners-btn" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                Sau
              </button>
            </div>
          </div>
        </div>

        {selectedId ? (
          <aside className="admin-owners-detail">
            <button
              type="button"
              className="admin-owners-detail-close"
              onClick={closeDetailPanel}
              aria-label="Đóng chi tiết chủ bãi"
              title="Đóng"
            >
              ✕
            </button>
            {detailLoading || !detail ? (
              <p>Đang tải chi tiết...</p>
            ) : (
              <>
                <div className="admin-owners-detail-head">
                  <div className="admin-owners-avatar">{detail.name?.slice(0, 1)?.toUpperCase()}</div>
                  <div>
                    <strong>{detail.name}</strong>
                    {detail.isVerified ? <span className="admin-owners-verified">Verified</span> : null}
                    <div>
                      <span className={`admin-owners-status admin-owners-status--${detail.status}`}>
                        {STATUS_LABELS[detail.status]}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="admin-owners-detail-meta">
                  <div>📞 {detail.phone || "—"}</div>
                  <div>✉️ {detail.email}</div>
                  <div>📍 {detail.address}</div>
                </div>

                <div className="admin-owners-detail-stats">
                  <div className="admin-owners-detail-stat">
                    <strong>{detail.stats?.parkingLotCount || 0}</strong>
                    <span>Tổng bãi</span>
                  </div>
                  <div className="admin-owners-detail-stat">
                    <strong>{detail.stats?.slotCount || 0}</strong>
                    <span>Tổng slot</span>
                  </div>
                  <div className="admin-owners-detail-stat">
                    <strong>{detail.stats?.employeeCount || 0}</strong>
                    <span>Nhân viên</span>
                  </div>
                </div>

                <div className="admin-owners-detail-section">
                  <h4>Tài chính (7 ngày)</h4>
                  <div className="admin-owners-detail-meta">
                    <div>Doanh thu: <strong>{formatCurrency(detail.stats?.revenue7d)}</strong></div>
                    <div>Hoa hồng: <strong>{formatCurrency(detail.stats?.commission7d)}</strong></div>
                    <div>Tỷ lệ giữ chân: <strong>{detail.stats?.retentionRate}%</strong></div>
                  </div>
                  <div className="admin-owners-detail-chart" style={{ minHeight: 160 }}>
                    <ResponsiveContainer width="100%" height={160} minWidth={0}>
                      <LineChart data={detail.revenueChart || []}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={40} />
                        <Tooltip formatter={(v) => formatCurrency(v)} />
                        <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="admin-owners-detail-section">
                  <h4>Thông tin khác</h4>
                  <div className="admin-owners-detail-meta">
                    <div>Ngày tham gia: {formatDateTimeVN(detail.createdAt)}</div>
                    <div>Thanh toán: {detail.paymentMethod}</div>
                    <div>Tỷ lệ hoa hồng: {detail.commissionRate}%</div>
                    <div>Hợp đồng: {detail.contractStatus}</div>
                  </div>
                </div>

                <div className="admin-owners-detail-actions">
                  <button type="button" className="admin-owners-btn" onClick={() => setEditingOwner({ id: detail.id, ...detail })}>
                    Chỉnh sửa
                  </button>
                  <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleLockToggle}>
                    {detail.status === "locked" ? "Mở khóa tài khoản" : "Khóa tài khoản"}
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>

      {isCreateModalOpen ? (
        <div className="owner-modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Thêm chủ bãi</h2><p>Tạo tài khoản chủ bãi / đối tác mới.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setIsCreateModalOpen(false)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              if (!createForm.name.trim() || !createForm.email.trim()) {
                window.alert("Vui lòng nhập tên và email.");
                return;
              }
              await actions.addOwner(createForm);
              setIsCreateModalOpen(false);
              setCreateForm(EMPTY_OWNER);
              loadOwners();
            }}>
              <label>Tên chủ bãi<input className="owner-input" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Email<input className="owner-input" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={createForm.status} onChange={(e) => setCreateForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="suspended">Tạm khóa</option>
                </select>
              </label>
              <label className="owner-form-span">Bãi xe gán (tùy chọn)<input className="owner-input" value={createForm.parkingLot} onChange={(e) => setCreateForm((p) => ({ ...p, parkingLot: e.target.value }))} /></label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setIsCreateModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Tạo tài khoản</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingOwner ? (
        <div className="owner-modal-backdrop" onClick={() => setEditingOwner(null)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Sửa chủ bãi / đối tác</h2><p>Cập nhật thông tin tài khoản.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setEditingOwner(null)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              const ok = await actions.updateOwner(editingOwner.id, editForm);
              if (ok) {
                setEditingOwner(null);
                loadOwners();
                if (selectedId === editingOwner.id) loadDetail(editingOwner.id);
              }
            }}>
              <label>Tên<input className="owner-input" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Email<input className="owner-input" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="suspended">Tạm khóa</option>
                </select>
              </label>
              <label className="owner-form-span">Bãi xe gán<input className="owner-input" value={editForm.parkingLot} onChange={(e) => setEditForm((p) => ({ ...p, parkingLot: e.target.value }))} /></label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setEditingOwner(null)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
