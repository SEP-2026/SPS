import { useEffect, useState } from "react";

import { getEmployeeHistory } from "../../employee/employeeService";

const ACTION_LABEL = {
  employee_created: "Tạo tài khoản nhân viên",
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

export default function EmployeeHistory() {
  const [data, setData] = useState({ history: [], total_count: 0 });
  const [actionFilter, setActionFilter] = useState("");
  const [limit, setLimit] = useState(100);

  const refreshHistory = async () => {
    const res = await getEmployeeHistory({
      limit,
      action: actionFilter || undefined,
    });
    setData(res);
  };

  useEffect(() => {
    refreshHistory().catch(() => setData({ history: [], total_count: 0 }));
    const timerId = window.setInterval(() => {
      refreshHistory().catch(() => null);
    }, 15000);
    return () => window.clearInterval(timerId);
  }, [actionFilter, limit]);

  return (
    <section className="employee-card employee-section-shell">
      <div className="employee-section-headline">
        <h2>Lịch sử hoạt động</h2>
        <div className="employee-action-row">
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
          <span className="employee-chip">Tổng bản ghi: {data.total_count}</span>
        </div>
      </div>

      <div className="employee-history-list">
        {data.history.length === 0 ? <p className="employee-note">Chưa có hoạt động nào được ghi nhận.</p> : null}

        {data.history.map((item) => {
          const showAmount = MONEY_RELATED_ACTIONS.has(item.action);
          const checkoutAmount = resolveCheckoutAmount(item);
          return (
            <article key={item.id} className="employee-history-item employee-history-item--timeline">
              <div>
                <strong>{ACTION_LABEL[item.action] || item.action}</strong>
                <p>{decodeMojibake(item.detail) || "Không có mô tả"}</p>
              </div>
              <div className="employee-history-meta">
                <p>{new Date(item.created_at).toLocaleString("vi-VN")}</p>
                {showAmount ? <span className="employee-status-pill">{formatCurrency(checkoutAmount)}</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
