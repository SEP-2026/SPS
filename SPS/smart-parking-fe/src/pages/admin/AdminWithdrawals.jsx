import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminCommissions.css";

const STATUS_LABELS = {
  processing: "Chờ duyệt",
  completed: "Đã hoàn thành",
  cancelled: "Đã từ chối",
};

export default function AdminWithdrawals() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("processing");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        pageSize: "10",
      });
      if (search.trim()) {
        params.append("search", search.trim());
      }
      const response = await API.get(`/admin/withdrawals?${params.toString()}`);
      setData(response.data);
    } catch (requestError) {
      const message = requestError?.response?.data?.detail || "Không tải được danh sách yêu cầu rút tiền";
      setError(typeof message === "string" ? message : "Không tải được danh sách yêu cầu rút tiền");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (withdrawalId) => {
    if (!window.confirm("Xác nhận duyệt yêu cầu rút tiền này?")) {
      return;
    }
    setProcessing(true);
    try {
      await API.post(`/admin/withdrawals/${withdrawalId}/approve`);
      window.alert("Đã duyệt yêu cầu rút tiền.");
      await loadData();
    } catch (requestError) {
      window.alert(requestError?.response?.data?.detail || "Không thể duyệt yêu cầu");
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (withdrawalId) => {
    const note = window.prompt("Lý do từ chối (tùy chọn):", "");
    if (note === null) {
      return;
    }
    setProcessing(true);
    try {
      await API.post(`/admin/withdrawals/${withdrawalId}/reject`, { note: note || null });
      window.alert("Đã từ chối yêu cầu rút tiền.");
      await loadData();
    } catch (requestError) {
      window.alert(requestError?.response?.data?.detail || "Không thể từ chối yêu cầu");
    } finally {
      setProcessing(false);
    }
  };

  const summary = data?.summary || {};
  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;

  return (
    <div className="admin-commissions-page">
      <div className="admin-commissions-kpis">
        <article className="admin-commissions-kpi">
          <span>Chờ duyệt</span>
          <strong>{summary.processingCount || 0}</strong>
          <small>{formatCurrency(summary.processingAmount || 0)} đang chờ xử lý</small>
        </article>
        <article className="admin-commissions-kpi">
          <span>Tổng yêu cầu (bộ lọc)</span>
          <strong>{summary.total || 0}</strong>
          <small>Theo trạng thái đang chọn</small>
        </article>
      </div>

      <div className="admin-commissions-toolbar">
        <div className="admin-commissions-filters">
          <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
            <option value="processing">Chờ duyệt</option>
            <option value="completed">Đã hoàn thành</option>
            <option value="cancelled">Đã từ chối</option>
            <option value="all">Tất cả</option>
          </select>
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Tìm mã, đối tác, tài khoản..."
          />
        </div>
        <div className="admin-commissions-actions">
          <button type="button" className="admin-commissions-btn" onClick={loadData} disabled={loading}>
            Làm mới
          </button>
        </div>
      </div>

      {error ? <p className="admin-commissions-error">{error}</p> : null}

      <section className="admin-commissions-card">
        <h3>Yêu cầu rút tiền đối tác</h3>
        <p>Duyệt hoặc từ chối các yêu cầu rút tiền do chủ bãi gửi từ trang Rút tiền.</p>
        <div className="admin-commissions-table-wrap">
          <table className="admin-commissions-table">
            <thead>
              <tr>
                <th>Mã yêu cầu</th>
                <th>Đối tác</th>
                <th>Ngày tạo</th>
                <th>Số tiền rút</th>
                <th>Phí</th>
                <th>Số nhận</th>
                <th>Tài khoản nhận</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}>Đang tải...</td></tr>
              ) : null}
              {!loading && items.length === 0 ? (
                <tr><td colSpan={9}>Không có yêu cầu phù hợp bộ lọc.</td></tr>
              ) : null}
              {!loading && items.map((item) => (
                <tr key={item.id}>
                  <td>{item.requestCode}</td>
                  <td className="admin-commissions-partner">
                    <strong>{item.ownerName}</strong>
                    <small>{item.ownerEmail}</small>
                  </td>
                  <td>{formatDateTimeVN(item.createdAt)}</td>
                  <td>{formatCurrency(item.amount)}</td>
                  <td>{formatCurrency(item.fee)}</td>
                  <td>{formatCurrency(item.netAmount)}</td>
                  <td>
                    <div>{item.bankName || "—"}</div>
                    <small>{item.bankCode} · {item.accountNumber || "—"} · {item.accountHolderName || "—"}</small>
                  </td>
                  <td className="admin-commissions-status-cell">
                    <span className={`admin-commissions-status admin-commissions-status--${item.status === "completed" ? "paid" : item.status === "cancelled" ? "unpaid" : "partial"}`}>
                      {STATUS_LABELS[item.status] || item.status}
                    </span>
                  </td>
                  <td>
                    {item.status === "processing" ? (
                      <div className="admin-commissions-actions">
                        <button
                          type="button"
                          className="admin-commissions-btn admin-commissions-btn--primary"
                          disabled={processing}
                          onClick={() => handleApprove(item.id)}
                        >
                          Duyệt
                        </button>
                        <button
                          type="button"
                          className="admin-commissions-btn"
                          disabled={processing}
                          onClick={() => handleReject(item.id)}
                        >
                          Từ chối
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-commissions-pagination">
          <span>Trang {page}/{totalPages}</span>
          <div className="admin-commissions-actions">
            <button type="button" className="admin-commissions-btn" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Trước
            </button>
            <button type="button" className="admin-commissions-btn" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>
              Sau
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
