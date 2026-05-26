import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { formatCurrency } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";
import API from "../../services/api";
import "./AdminOwners.css";
import "./AdminParking.css";

const STATUS_LABELS = {
  active: "Hoạt động",
  locked: "Ngừng hoạt động",
  pending: "Tạm ngưng",
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

function formatPrice(value) {
  const amount = Number(value || 0);
  if (!amount) return "—";
  return `${amount.toLocaleString("vi-VN")}đ`;
}

const EMPTY_LOT = {
  name: "",
  address: "",
  owner: "",
  phone: "",
  districtId: "",
  slotCount: 0,
  status: "pending",
};

export default function ParkingLotManagement() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { actions } = useAdminContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_LOT);
  const [editingLot, setEditingLot] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", address: "", owner: "", phone: "", districtId: "", status: "active" });

  const loadLots = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.append("search", search.trim());
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (districtFilter !== "all") params.append("districtId", districtFilter);
      if (ownerFilter !== "all") params.append("ownerId", ownerFilter);
      const response = await API.get(`/admin/parking-lots/management?${params.toString()}`);
      setData(response.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, statusFilter, districtFilter, ownerFilter]);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  useEffect(() => {
    const districtId = searchParams.get("districtId");
    if (districtId) {
      setDistrictFilter(districtId);
      setPage(1);
    }
  }, [searchParams]);

  const loadDetail = useCallback(async (lotId) => {
    if (!lotId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await API.get(`/admin/parking-lots/${lotId}/detail`);
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

  const handleSelectLot = (lot) => {
    setSelectedId(lot.id);
    setEditForm({
      name: lot.name || "",
      address: lot.address || "",
      owner: lot.ownerName && lot.ownerName !== "Chưa gán" ? lot.ownerName : "",
      phone: lot.phone || "",
      districtId: lot.districtId ? String(lot.districtId) : "",
      status: lot.status || "active",
    });
  };

  const handleStatusToggle = async () => {
    if (!selectedId || !detail || !actions) return;
    const nextStatus = detail.status === "locked" ? "active" : "locked";
    const ok = await actions.updateParkingLot(selectedId, { status: nextStatus });
    if (ok !== false) {
      await loadLots();
      await loadDetail(selectedId);
    }
  };

  const summary = data?.summary || {};
  const trends = summary.trends || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải danh sách bãi xe...</div>;
  }

  return (
    <div className="admin-parking-page admin-owners-page">
      <p className="admin-users-breadcrumb">Bãi đỗ xe &gt; Danh sách bãi xe</p>

      <div className="admin-owners-kpis admin-parking-kpis">
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">P</div>
          <div>
            <span>Tổng số bãi xe</span>
            <strong>{summary.totalLots || 0}</strong>
            <small className={trendClass(trends.totalLotsChangePercent)}>
              {formatTrend(trends.totalLotsChangePercent)} so với tháng trước
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">●</div>
          <div>
            <span>Đang hoạt động</span>
            <strong>{summary.activeLots || 0}</strong>
            <small className={trendClass(trends.activeChangePercent)}>{formatTrend(trends.activeChangePercent)}</small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">⏸</div>
          <div>
            <span>Tạm ngưng</span>
            <strong>{summary.pausedLots || 0}</strong>
            <small className={trendClass(trends.pausedChangePercent)}>{formatTrend(trends.pausedChangePercent)}</small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--red">✕</div>
          <div>
            <span>Ngừng hoạt động</span>
            <strong>{summary.inactiveLots || 0}</strong>
            <small className={trendClass(trends.inactiveChangePercent)}>{formatTrend(trends.inactiveChangePercent)}</small>
          </div>
        </article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input
            type="search"
            placeholder="Tìm kiếm bãi xe, địa chỉ, chủ bãi..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadLots();
              }
            }}
          />
          <select value={districtFilter} onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}>
            <option value="all">Khu vực: Tất cả</option>
            {(data?.districts || []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Trạng thái: Tất cả</option>
            <option value="active">Hoạt động</option>
            <option value="pending">Tạm ngưng</option>
            <option value="locked">Ngừng hoạt động</option>
          </select>
          <select value={ownerFilter} onChange={(e) => { setOwnerFilter(e.target.value); setPage(1); }}>
            <option value="all">Chủ bãi: Tất cả</option>
            {(data?.owners || []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div className="admin-owners-toolbar-actions">
          <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadLots(); }}>
            Áp dụng
          </button>
          <button type="button" className="admin-owners-btn admin-owners-btn--primary" onClick={() => setIsCreateModalOpen(true)}>
            + Thêm bãi xe
          </button>
        </div>
      </div>

      <div className={`admin-owners-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table admin-parking-table">
              <thead>
                <tr>
                  <th>Bãi xe</th>
                  <th>Khu vực</th>
                  <th>Chủ bãi</th>
                  <th>Sức chứa</th>
                  <th>Giá giữ xe</th>
                  <th>Trạng thái</th>
                  <th>Doanh thu (tháng)</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((lot) => (
                  <tr
                    key={lot.id}
                    className={selectedId === lot.id ? "is-selected" : ""}
                    onClick={() => handleSelectLot(lot)}
                  >
                    <td>
                      <div className="admin-parking-lot-cell">
                        <div className="admin-parking-thumb">{lot.name?.slice(0, 1)}</div>
                        <div>
                          <strong>{lot.name}</strong>
                          <small>#{lot.code}</small>
                        </div>
                      </div>
                    </td>
                    <td>{lot.district || "—"}</td>
                    <td>
                      <div>{lot.ownerName}</div>
                      {lot.ownerRole ? <small className="admin-parking-role-tag">{lot.ownerRole}</small> : null}
                    </td>
                    <td>{lot.slotCount} chỗ</td>
                    <td>
                      <div>{formatPrice(lot.pricePerHour)}/giờ</div>
                      <small>{formatPrice(lot.pricePerDay)}/ngày</small>
                    </td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${lot.status}`}>
                        {STATUS_LABELS[lot.status] || lot.statusLabel}
                      </span>
                    </td>
                    <td>
                      <div>{formatCurrency(lot.monthlyRevenue)}</div>
                      <small className={trendClass(lot.monthlyRevenueChangePercent)}>
                        {formatTrend(lot.monthlyRevenueChangePercent)}
                      </small>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admin-owners-row-actions">
                        <button type="button" className="admin-owners-icon-btn" title="Xem" onClick={() => handleSelectLot(lot)}>👁</button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Sửa"
                          onClick={() => {
                            handleSelectLot(lot);
                            setEditingLot(lot);
                          }}
                        >
                          ✏️
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8}>Không có bãi xe phù hợp bộ lọc.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-owners-pagination">
            <span>
              Hiển thị {(pagination.page - 1) * pagination.pageSize + 1} đến{" "}
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} của {pagination.total} bãi xe
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
                    <strong>{detail.name}</strong>
                    <small>#{detail.code}</small>
                    <div style={{ marginTop: 8 }}>
                      <span className={`admin-owners-status admin-owners-status--${detail.status}`}>
                        {STATUS_LABELS[detail.status] || detail.statusLabel}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="admin-parking-detail-revenue">
                  <span>Doanh thu tháng</span>
                  <strong>{formatCurrency(detail.monthlyRevenue)}</strong>
                  <small className={trendClass(detail.monthlyRevenueChangePercent)}>
                    {formatTrend(detail.monthlyRevenueChangePercent)}
                  </small>
                </div>

                <div className="admin-parking-detail-tabs">
                  <button type="button" className="is-active">Thông tin</button>
                </div>

                <div className="admin-owners-detail-meta">
                  <div><strong>Chủ bãi:</strong> {detail.ownerName}</div>
                  <div><strong>Khu vực:</strong> {detail.district || "—"}</div>
                  <div><strong>Địa chỉ:</strong> {detail.address}</div>
                  <div><strong>Sức chứa:</strong> {detail.slotCount} chỗ ({detail.occupancy}% lấp đầy)</div>
                  <div><strong>Giá giữ xe:</strong> {formatPrice(detail.pricePerHour)}/giờ · {formatPrice(detail.pricePerDay)}/ngày</div>
                  <div><strong>Thiết bị / chỗ:</strong> {detail.deviceCount ?? detail.slotCount} mục</div>
                </div>

                <div className="admin-owners-detail-actions">
                  <button type="button" className="admin-owners-btn" onClick={() => setEditingLot(detail)}>Chỉnh sửa</button>
                  <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleStatusToggle}>
                    {detail.status === "locked" ? "Kích hoạt lại" : "Ngừng hoạt động"}
                  </button>
                  {detail.districtId ? (
                    <button
                      type="button"
                      className="admin-owners-btn"
                      onClick={() => navigate(`/admin/parking-lots/areas/${detail.districtId}`)}
                    >
                      Xem khu vực
                    </button>
                  ) : null}
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
              <div><h2>Thêm bãi xe</h2><p>Tạo bãi đỗ mới trong hệ thống.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setIsCreateModalOpen(false)}>×</button>
            </div>
            <form
              className="owner-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!actions) return;
                await actions.addParkingLot({
                  ...createForm,
                  slotCount: Number(createForm.slotCount) || 0,
                  districtId: createForm.districtId ? Number(createForm.districtId) : undefined,
                });
                setIsCreateModalOpen(false);
                setCreateForm(EMPTY_LOT);
                await loadLots();
              }}
            >
              <label>Tên bãi<input className="owner-input" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} required /></label>
              <label>Chủ khu vực<input className="owner-input" value={createForm.owner} onChange={(e) => setCreateForm((p) => ({ ...p, owner: e.target.value }))} /></label>
              <label>Khu vực
                <select className="owner-input owner-select" value={createForm.districtId} onChange={(e) => setCreateForm((p) => ({ ...p, districtId: e.target.value }))}>
                  <option value="">— Chọn khu vực —</option>
                  {(data?.districts || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label>Số chỗ<input className="owner-input" value={createForm.slotCount} onChange={(e) => setCreateForm((p) => ({ ...p, slotCount: e.target.value }))} /></label>
              <label className="owner-form-span">Địa chỉ<input className="owner-input" value={createForm.address} onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))} required /></label>
              <label>Số điện thoại<input className="owner-input" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={createForm.status} onChange={(e) => setCreateForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="pending">Tạm ngưng</option>
                  <option value="active">Hoạt động</option>
                  <option value="locked">Ngừng hoạt động</option>
                </select>
              </label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setIsCreateModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu bãi xe</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingLot ? (
        <div className="owner-modal-backdrop" onClick={() => setEditingLot(null)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Sửa bãi xe</h2><p>Cập nhật thông tin bãi đỗ.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setEditingLot(null)}>×</button>
            </div>
            <form
              className="owner-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!actions) return;
                await actions.updateParkingLot(editingLot.id, {
                  ...editForm,
                  districtId: editForm.districtId ? Number(editForm.districtId) : undefined,
                });
                setEditingLot(null);
                await loadLots();
                if (selectedId === editingLot.id) await loadDetail(selectedId);
              }}
            >
              <label>Tên bãi<input className="owner-input" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Chủ khu vực<input className="owner-input" value={editForm.owner} onChange={(e) => setEditForm((p) => ({ ...p, owner: e.target.value }))} /></label>
              <label>Khu vực
                <select className="owner-input owner-select" value={editForm.districtId} onChange={(e) => setEditForm((p) => ({ ...p, districtId: e.target.value }))}>
                  <option value="">—</option>
                  {(data?.districts || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="owner-form-span">Địa chỉ<input className="owner-input" value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="locked">Ngừng hoạt động</option>
                  <option value="pending">Tạm ngưng</option>
                </select>
              </label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setEditingLot(null)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
