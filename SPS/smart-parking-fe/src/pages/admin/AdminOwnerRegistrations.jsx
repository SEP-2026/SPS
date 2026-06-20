import { useCallback, useEffect, useState } from "react";
import { Check, X, Phone, Mail, MapPin, FileText, Clock, CheckCircle, AlertCircle, RefreshCw, Percent } from "lucide-react";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminOwners.css";
import "../../admin/AdminPartners.css";

const STATUS_LABELS = {
  pending: "Chờ duyệt",
  approved: "Đã duyệt",
  rejected: "Từ chối",
};

export default function AdminOwnerRegistrations() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [adminNotes, setAdminNotes] = useState("");
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "10", status: statusFilter });
      if (search.trim()) params.append("search", search.trim());
      if (districtFilter !== "all") params.append("districtId", districtFilter);
      const res = await API.get(`/admin/registrations/management?${params}`);
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, districtFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const res = await API.get(`/admin/registrations/${id}`);
      setDetail(res.data);
      setAdminNotes(res.data.adminNotes || "");
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleApproveById = async (id) => {
    setSelectedId(id);
    setProcessing(true);
    try {
      await API.post(`/admin/registrations/${id}/approve`, { adminNotes });
      await loadData();
      await loadDetail(id);
      window.alert("Đã phê duyệt đăng ký đối tác.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể phê duyệt");
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectById = async (id) => {
    const reason = window.prompt("Lý do từ chối:", "Hồ sơ chưa đủ điều kiện");
    if (reason === null) return;
    setSelectedId(id);
    setProcessing(true);
    try {
      await API.post(`/admin/registrations/${id}/reject`, { reason, adminNotes });
      await loadData();
      await loadDetail(id);
      window.alert("Đã từ chối đăng ký.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể từ chối");
    } finally {
      setProcessing(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedId) return;
    setProcessing(true);
    try {
      await API.post(`/admin/registrations/${selectedId}/approve`, { adminNotes });
      await loadData();
      await loadDetail(selectedId);
      window.alert("Đã phê duyệt đăng ký đối tác.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể phê duyệt");
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!selectedId) return;
    const reason = window.prompt("Lý do từ chối:", "Hồ sơ chưa đủ điều kiện");
    if (reason === null) return;
    setProcessing(true);
    try {
      await API.post(`/admin/registrations/${selectedId}/reject`, { reason, adminNotes });
      await loadData();
      await loadDetail(selectedId);
      window.alert("Đã từ chối đăng ký.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể từ chối");
    } finally {
      setProcessing(false);
    }
  };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải danh sách đăng ký...</div>;
  }

  const summary = data?.summary || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0, pageSize: 10 };

  return (
    <div className="admin-owners-page">
      <div className="admin-owners-kpis">
        <article className="admin-owners-kpi"><div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue"><FileText size={24} /></div><div><span>Tất cả yêu cầu</span><strong>{summary.total || 0}</strong></div></article>
        <article className="admin-owners-kpi"><div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber"><Clock size={24} /></div><div><span>Chờ duyệt</span><strong>{summary.pending || 0}</strong></div></article>
        <article className="admin-owners-kpi"><div className="admin-owners-kpi-icon admin-owners-kpi-icon--green"><CheckCircle size={24} /></div><div><span>Đã duyệt</span><strong>{summary.approved || 0}</strong></div></article>
        <article className="admin-owners-kpi"><div className="admin-owners-kpi-icon admin-owners-kpi-icon--red"><X size={24} /></div><div><span>Từ chối</span><strong>{summary.rejected || 0}</strong></div></article>
        <article className="admin-owners-kpi"><div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple"><Percent size={24} /></div><div><span>Tỷ lệ duyệt</span><strong>{summary.approvalRate || 0}%</strong></div></article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input type="search" placeholder="Tìm kiếm đăng ký..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), loadData())} />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Chờ duyệt</option>
            <option value="approved">Đã duyệt</option>
            <option value="rejected">Từ chối</option>
          </select>
          <select value={districtFilter} onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả quận/huyện</option>
            {(data?.districts || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadData(); }}>Áp dụng lọc</button>
      </div>

      <div className={`admin-reg-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table">
              <thead>
                <tr>
                  <th>Chủ bãi / Doanh nghiệp</th>
                  <th>Liên hệ</th>
                  <th>Quận/Huyện</th>
                  <th>Số bãi xe</th>
                  <th>Ngày đăng ký</th>
                  <th className="admin-owners-status-head">Trạng thái</th>
                  <th>Hồ sơ</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className={selectedId === row.id ? "is-selected" : ""} onClick={() => setSelectedId(row.id)}>
                    <td className="admin-owners-partner">
                      <strong>{row.businessName}</strong>
                      <small>{row.registrationCode}</small>
                    </td>
                    <td><div>{row.contactName}</div><small>{row.phone}</small></td>
                    <td>{row.district}</td>
                    <td>{row.parkingLotCount} bãi</td>
                    <td>{formatDateTimeVN(row.createdAt)}</td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${row.status === "approved" ? "active" : row.status === "rejected" ? "locked" : "pending"}`}>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>{row.documentCount} tài liệu</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {row.status === "pending" ? (
                        <div className="admin-owners-row-actions">
                          <button type="button" className="admin-owners-icon-btn" title="Duyệt" onClick={() => handleApproveById(row.id)}><Check size={18} /></button>
                          <button type="button" className="admin-owners-icon-btn" title="Từ chối" onClick={() => handleRejectById(row.id)}><X size={18} /></button>
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-owners-pagination">
            <span>Hiển thị {(pagination.page - 1) * pagination.pageSize + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} / {pagination.total}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="admin-owners-btn" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)}>Trước</button>
              <span>{pagination.page}/{pagination.totalPages}</span>
              <button type="button" className="admin-owners-btn" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)}>Sau</button>
            </div>
          </div>
        </div>

        {selectedId && detail ? (
          <aside className="admin-reg-detail">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0 }}>Chi tiết đăng ký</h3>
              <button type="button" className="admin-owners-icon-btn" onClick={() => setSelectedId(null)} aria-label="Đóng"><X size={18} /></button>
            </div>
            <p><strong>{detail.businessName}</strong> — {STATUS_LABELS[detail.status]}</p>
            <p><small>{detail.registrationCode}</small></p>
            <div className="admin-owners-detail-meta" style={{ marginTop: 12 }}>
              <div><Phone size={14} /> {detail.phone}</div>
              <div><Mail size={14} /> {detail.email}</div>
              <div><MapPin size={14} /> {detail.address}</div>
            </div>
            <div className="admin-owners-detail-section">
              <h4>Thông tin bãi xe</h4>
              <div className="admin-owners-detail-meta">
                <div>Tổng bãi: {detail.parkingLotCount}</div>
                <div>Tổng slot: {detail.slotCount}</div>
                <div>Loại: {detail.lotTypes}</div>
                <div>Diện tích: {detail.totalAreaSqm} m²</div>
                <div>Giờ hoạt động: {detail.operatingHours}</div>
                <div>Dịch vụ: {(detail.services || []).join(", ")}</div>
              </div>
            </div>
            <div className="admin-owners-detail-section">
              <h4>Hồ sơ đăng ký ({detail.documentCount})</h4>
              <ul className="admin-reg-doc-list">
                {(detail.documents || []).map((doc) => (
                  <li key={doc.name} className="admin-reg-doc-item">
                    <span>{doc.name}</span>
                    <small>{doc.sizeKb} KB</small>
                  </li>
                ))}
              </ul>
            </div>
            <label style={{ display: "block", marginTop: 12 }}>
              Ghi chú admin
              <textarea className="owner-input" rows={3} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
            </label>
            {detail.status === "pending" ? (
              <div className="admin-reg-actions-footer">
                <button type="button" className="admin-owners-btn admin-owners-btn--danger" disabled={processing} onClick={handleReject}>Từ chối</button>
                <button type="button" className="admin-owners-btn admin-owners-btn--primary" disabled={processing} onClick={handleApprove}>Phê duyệt</button>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
