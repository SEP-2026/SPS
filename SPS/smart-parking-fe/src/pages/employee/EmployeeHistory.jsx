import { useCallback, useEffect, useState } from "react";
import { CarFront, History, LogIn, QrCode, RefreshCw, SquarePen } from "lucide-react";

import { getEmployeeHistory } from "../../employee/employeeService";

const ACTION_LABEL = {
  employee_created: "Tạo tài khoản nhân viên",
  employee_login: "Đăng nhập",
  parking_status_updated: "Cập nhật trạng thái bãi",
  check_in: "Check-in xe",
  check_out: "Check-out xe",
  resolve_booking: "Xem thông tin booking",
};

const MONEY_RELATED_ACTIONS = new Set(["check_out"]);

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function resolveCheckoutAmount(item) {
  const numericCandidates = [
    item?.amount,
    item?.total_actual_fee,
    item?.total_amount,
    item?.fee_amount,
    item?.payment_amount,
    item?.paid_amount,
    item?.remaining_due,
  ];

  for (const candidate of numericCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const detail = `${item?.detail || ""}`;
  const match = detail.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*(?:đ|vnd)/i);
  if (match?.[1]) {
    const parsed = Number(match[1].replace(/[.,\s]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return 0;
}

function decodeMojibake(value) {
  if (!value || typeof value !== "string") {
    return value || "";
  }
  if (!/[ÃÂ]/.test(value)) {
    return value;
  }
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function ActionBadge({ action }) {
  const normalized = String(action || "").toLowerCase();
  const config = {
    employee_login: { icon: LogIn, tone: "blue" },
    check_in: { icon: QrCode, tone: "green" },
    resolve_booking: { icon: QrCode, tone: "purple" },
    parking_status_updated: { icon: SquarePen, tone: "orange" },
    check_out: { icon: CarFront, tone: "cyan" },
  }[normalized] || { icon: History, tone: "slate" };
  const Icon = config.icon;

  return (
    <span className={`employee-action-badge is-${config.tone}`}>
      <Icon size={15} />
      {ACTION_LABEL[action] || action || "Hoạt động"}
    </span>
  );
}

export default function EmployeeHistory() {
  const [data, setData] = useState({ history: [], total_count: 0 });
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);

  const refreshHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getEmployeeHistory({
        limit,
        action: actionFilter || undefined,
      });
      setData(res);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, limit]);

  useEffect(() => {
    refreshHistory().catch(() => setData({ history: [], total_count: 0 }));
    const timerId = window.setInterval(() => {
      refreshHistory().catch(() => null);
    }, 15000);
    return () => window.clearInterval(timerId);
  }, [refreshHistory]);

  const historyRows = Array.isArray(data?.history) ? data.history : [];
  const totalCount = Number(data?.total_count ?? 0);

  return (
    <section className="employee-workspace-page employee-history-page">
      <div className="employee-page-toolbar employee-filter-bar employee-history-filter">
        <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)}>
          <option value="">Tất cả hành động</option>
          <option value="check_in">Check-in</option>
          <option value="check_out">Check-out</option>
          <option value="resolve_booking">Xem booking</option>
          <option value="parking_status_updated">Cập nhật trạng thái bãi</option>
        </select>
        <select value={limit} onChange={(event) => setLimit(Number(event.target.value) || 100)}>
          <option value={50}>50 bản ghi</option>
          <option value={100}>100 bản ghi</option>
          <option value={200}>200 bản ghi</option>
        </select>
        <span className="employee-filter-count">Tổng bản ghi: {totalCount}</span>
        <button type="button" className="employee-modern-secondary-action" onClick={refreshHistory} disabled={loading}>
          <RefreshCw size={17} />
          {loading ? "Đang tải" : "Refresh"}
        </button>
      </div>

      <div className="employee-page-body">
      <section className="employee-modern-card employee-modern-table-card">
        <div className="employee-modern-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Hành động</th>
                <th>Nội dung</th>
                <th>IP Address</th>
                <th>Thanh toán</th>
              </tr>
            </thead>
            <tbody>
              {loading && historyRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="employee-table-empty">Đang tải dữ liệu...</td>
                </tr>
              ) : null}

              {!loading && historyRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="employee-table-empty">Chưa có hoạt động nào được ghi nhận.</td>
                </tr>
              ) : null}

              {historyRows.map((item) => {
                const showAmount = MONEY_RELATED_ACTIONS.has(item.action);
                const checkoutAmount = resolveCheckoutAmount(item);
                return (
                  <tr key={item.id}>
                    <td>{new Date(item.created_at).toLocaleString("vi-VN")}</td>
                    <td><ActionBadge action={item.action} /></td>
                    <td className="employee-table-detail">{decodeMojibake(item.detail) || "Không có mô tả"}</td>
                    <td>{item.ip_address || "--"}</td>
                    <td>{showAmount ? <span className="employee-status-pill">{formatCurrency(checkoutAmount)}</span> : "--"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="employee-table-pagination">
          <button type="button" disabled>Trước</button>
          <span>Trang 1</span>
          <button type="button" disabled>Sau</button>
        </div>
      </section>
      </div>
    </section>
  );
}
