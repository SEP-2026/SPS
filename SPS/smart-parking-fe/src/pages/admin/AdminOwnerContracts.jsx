import { useCallback, useEffect, useState } from "react";
import { Eye, Pencil, X, Phone, Mail, MapPin, FileText, Check, Clock, AlertCircle, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminOwners.css";
import "../../admin/AdminPartners.css";

const STATUS_LABELS = {
  active: "Đang hiệu lực",
  expiring: "Sắp hết hạn",
  expired: "Đã hết hạn",
  renewal_pending: "Chờ gia hạn",
  terminated: "Đã kết thúc",
};

const STATUS_CLASS = {
  active: "active",
  expiring: "pending",
  expired: "locked",
  renewal_pending: "pending",
  terminated: "locked",
};

export default function AdminOwnerContracts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      if (search.trim()) params.append("search", search.trim());
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (districtFilter !== "all") params.append("districtId", districtFilter);
      const res = await API.get(`/admin/contracts/management?${params}`);
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
      const res = await API.get(`/admin/contracts/${id}`);
      setDetail(res.data);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const handleRenew = async () => {
    if (!selectedId) return;
    if (!window.confirm("Gia hạn hợp đồng thêm 12 tháng?")) return;
    setProcessing(true);
    try {
      const res = await API.post(`/admin/contracts/${selectedId}/renew`);
      setDetail(res.data);
      await loadData();
      window.alert("Đã gia hạn hợp đồng.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể gia hạn");
    } finally {
      setProcessing(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedId || !detail) return;
    const rateRaw = window.prompt("Tỷ lệ hoa hồng (%)", String(detail.commissionRate ?? 10));
    if (rateRaw === null) return;
    const rate = Number(rateRaw);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      window.alert("Tỷ lệ hoa hồng không hợp lệ");
      return;
    }
    setProcessing(true);
    try {
      const res = await API.patch(`/admin/contracts/${selectedId}`, { commissionRate: rate });
      setDetail(res.data);
      await loadData();
      window.alert("Đã cập nhật hợp đồng.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể cập nhật hợp đồng");
    } finally {
      setProcessing(false);
    }
  };

  const handleTerminate = async () => {
    if (!selectedId) return;
    if (!window.confirm("Kết thúc hợp đồng này?")) return;
    setProcessing(true);
    try {
      const res = await API.post(`/admin/contracts/${selectedId}/terminate`);
      setDetail(res.data);
      await loadData();
      window.alert("Đã kết thúc hợp đồng.");
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Không thể kết thúc hợp đồng");
    } finally {
      setProcessing(false);
    }
  };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải hợp đồng đối tác...</div>;
  }

  const summary = data?.summary || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, totalPages: 1, total: 0, pageSize: 10 };

  return (
    <div className="admin-owners-page">
      <div className="admin-owners-kpis">
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">
            <FileText size={24} />
          </div>
          <div>
            <span>Tổng hợp đồng</span>
            <strong>{summary.total || 0}</strong>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">
            <Check size={24} />
          </div>
          <div>
            <span>Đang hiệu lực</span>
            <strong>{summary.active || 0}</strong>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">
            <Clock size={24} />
          </div>
          <div>
            <span>Sắp hết hạn</span>
            <strong>{summary.expiring || 0}</strong>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--red">
            <AlertCircle size={24} />
          </div>
          <div>
            <span>Đã hết hạn</span>
            <strong>{summary.expired || 0}</strong>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple">
            <RefreshCw size={24} />
          </div>
          <div>
            <span>Chờ gia hạn</span>
            <strong>{summary.renewalPending || 0}</strong>
          </div>
        </article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input type="search" placeholder="Tìm kiếm hợp đồng..." value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), loadData())} />
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả trạng thái</option>
            <option value="active">Đang hiệu lực</option>
            <option value="expiring">Sắp hết hạn</option>
            <option value="expired">Đã hết hạn</option>
            <option value="renewal_pending">Chờ gia hạn</option>
          </select>
          <select value={districtFilter} onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}>
            <option value="all">Tất cả khu vực</option>
            {(data?.districts || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadData(); }}>Áp dụng lọc</button>
      </div>

      <div className={`admin-contract-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table">
              <thead>
                <tr>
                  <th>Mã hợp đồng</th>
                  <th>Đối tác</th>
                  <th>Khu vực</th>
                  <th>Ngày ký</th>
                  <th>Ngày hết hạn</th>
                  <th>Giá trị HĐ</th>
                  <th className="admin-owners-status-head">Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className={selectedId === row.id ? "is-selected" : ""} onClick={() => setSelectedId(row.id)}>
                    <td><strong>{row.contractCode}</strong></td>
                    <td className="admin-owners-partner">
                      <strong>{row.partnerName}</strong>
                      <small>{row.businessName}</small>
                    </td>
                    <td>{row.district}</td>
                    <td>{formatDateTimeVN(row.signedAt)}</td>
                    <td>{formatDateTimeVN(row.expiresAt)}</td>
                    <td>{formatCurrency(row.contractValue)}</td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${STATUS_CLASS[row.status] || "pending"}`}>
                        {STATUS_LABELS[row.status] || row.status}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Eye size={18} />
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
          <aside className="admin-contract-detail">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0 }}>Chi tiết hợp đồng</h3>
              <button type="button" className="admin-owners-icon-btn" onClick={() => setSelectedId(null)} aria-label="Đóng">
                <X size={18} />
              </button>
            </div>
            <p><strong>{detail.contractCode}</strong></p>
            <span className={`admin-owners-status admin-owners-status--${STATUS_CLASS[detail.status] || "active"}`}>
              {STATUS_LABELS[detail.status]}
            </span>

            <div className="admin-owners-detail-section">
              <h4>Đối tác</h4>
              <div className="admin-owners-detail-meta">
                <div>{detail.partnerName} — {detail.companyType}</div>
                <div>MST: {detail.taxId}</div>
                <div>Đại diện: {detail.representative}</div>
                <div><Phone size={14} /> {detail.phone} • <Mail size={14} /> {detail.email}</div>
                <div><MapPin size={14} /> {detail.address}</div>
                <div>Bãi liên kết: {(detail.parkingLots || []).join(", ") || "—"}</div>
              </div>
            </div>

            <div className="admin-owners-detail-section">
              <h4>Điều khoản hợp đồng</h4>
              <div className="admin-owners-detail-meta">
                <div>Ngày ký: {formatDateTimeVN(detail.signedAt)}</div>
                <div>Hết hạn: {formatDateTimeVN(detail.expiresAt)}</div>
                <div>Giá trị: {formatCurrency(detail.contractValue)}</div>
                <div>Hoa hồng: {detail.commissionRate}%</div>
                <div>Thanh toán: {detail.paymentMethod}</div>
                <div>Chu kỳ: {detail.paymentCycle}</div>
              </div>
              <ul style={{ margin: "10px 0 0", paddingLeft: 18 }}>
                {(detail.terms || []).map((term) => <li key={term}>{term}</li>)}
              </ul>
            </div>

            <div className="admin-owners-detail-section">
              <h4>Tệp đính kèm</h4>
              <ul className="admin-contract-attach-list">
                {(detail.attachments || []).map((file) => (
                  <li key={file.name} className="admin-contract-attach-item">
                    <span>{file.name}</span>
                    <small>{file.sizeKb} KB</small>
                  </li>
                ))}
              </ul>
            </div>

            {detail.status !== "terminated" ? (
              <div className="admin-contract-actions-footer" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                <button type="button" className="admin-owners-btn admin-owners-btn--primary" disabled={processing} onClick={handleRenew}>Gia hạn HĐ</button>
                <button type="button" className="admin-owners-btn" disabled={processing} onClick={handleEdit}>Chỉnh sửa</button>
                <button type="button" className="admin-owners-btn admin-owners-btn--danger" disabled={processing} onClick={handleTerminate}>Kết thúc HĐ</button>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
