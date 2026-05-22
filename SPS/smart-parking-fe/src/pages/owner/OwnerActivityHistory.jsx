import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  Download,
  Eye,
  Filter,
  MoreVertical,
  RefreshCw,
  Search,
  ShieldCheck,
  UserCog,
} from "lucide-react";
import API from "../../services/api";
import { formatCurrency, formatDateTime, StatusBadge } from "../../owner/OwnerUI";
import { downloadCsv, formatNumber } from "../../owner/ownerUtils";
import { useOwnerContext } from "../../owner/useOwnerContext";

const ACTIVITY_TYPES = [
  { value: "all", label: "Tất cả loại hoạt động" },
  { value: "booking", label: "Đặt chỗ" },
  { value: "payment", label: "Thanh toán" },
  { value: "review", label: "Đánh giá" },
  { value: "employee", label: "Tài khoản bãi" },
];

const TYPE_META = {
  booking: { label: "Đặt chỗ", icon: CalendarCheck, tone: "blue" },
  payment: { label: "Thanh toán", icon: CreditCard, tone: "green" },
  review: { label: "Đánh giá", icon: ClipboardList, tone: "orange" },
  employee: { label: "Tài khoản bãi", icon: UserCog, tone: "violet" },
  system: { label: "Hệ thống", icon: Activity, tone: "pink" },
};

function toDateInput(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function normalizeBootstrapActivities(ownerData) {
  const rows = [];
  (ownerData.activities || []).forEach((item) => {
    rows.push({
      id: item.id,
      type: item.type || "system",
      action: item.title || "Hoạt động hệ thống",
      object: item.message || item.title || "",
      parkingLotName: item.parkingLotName || "Hệ thống",
      actor: "Owner console",
      device: "Web",
      ip: "",
      detail: item.message || item.title || "",
      time: item.time,
      status: item.type === "warning" ? "warning" : "success",
      result: item.type === "warning" ? "warning" : "success",
    });
  });

  (ownerData.transactions || []).forEach((transaction) => {
    rows.push({
      id: `tx-${transaction.id}`,
      type: "payment",
      action: "Thanh toán",
      object: transaction.bookingCode || transaction.id,
      parkingLotName: transaction.parkingLotName || "Chưa có bãi",
      actor: transaction.payer || "Khách hàng",
      device: transaction.method || "N/A",
      ip: "",
      detail: `${formatCurrency(transaction.gross ?? transaction.amount)} · owner nhận ${formatCurrency(transaction.ownerPayout ?? transaction.amount)}`,
      time: transaction.time,
      status: transaction.status,
      result: transaction.status === "paid" ? "success" : "warning",
    });
  });

  (ownerData.bookings || []).forEach((booking) => {
    rows.push({
      id: `booking-${booking.id}`,
      type: "booking",
      action: "Tạo đặt chỗ",
      object: `${booking.code} · ${booking.plate}`,
      parkingLotName: booking.parkingLotName || "Chưa có bãi",
      actor: booking.user || "Khách hàng",
      device: "Web / Mobile",
      ip: "",
      detail: `${booking.slotCode || "Chưa có chỗ"} · ${formatCurrency(booking.price)}`,
      time: booking.bookingStartTime || booking.startTime,
      status: booking.status,
      result: booking.status === "cancelled" ? "warning" : "success",
    });
  });

  return rows.filter((item) => item.time).sort((left, right) => new Date(right.time) - new Date(left.time));
}

function matchesDateRange(item, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) {
    return true;
  }
  const time = new Date(item.time);
  if (Number.isNaN(time.getTime())) {
    return false;
  }
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);
    if (time < from) {
      return false;
    }
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59`);
    if (time > to) {
      return false;
    }
  }
  return true;
}

export default function OwnerActivityHistory() {
  const { ownerData, isSyncing, actions } = useOwnerContext();
  const [activities, setActivities] = useState(() => normalizeBootstrapActivities(ownerData));
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parkingFilter, setParkingFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        setLoading(true);
        const res = await API.get("/owner/activity");
        setActivities(Array.isArray(res.data?.activities) ? res.data.activities : normalizeBootstrapActivities(ownerData));
        setSummary(res.data?.summary || null);
      } catch {
        setActivities(normalizeBootstrapActivities(ownerData));
      } finally {
        setLoading(false);
      }
    };
    fetchActivities();
  }, [ownerData]);

  const parkingOptions = useMemo(() => {
    const names = new Set();
    activities.forEach((item) => {
      if (item.parkingLotName) {
        names.add(item.parkingLotName);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, "vi"));
  }, [activities]);

  const filteredActivities = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return activities.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      if (parkingFilter !== "all" && item.parkingLotName !== parkingFilter) {
        return false;
      }
      if (!matchesDateRange(item, dateFrom, dateTo)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [
        item.action,
        item.object,
        item.parkingLotName,
        item.actor,
        item.device,
        item.detail,
        item.status,
      ].join(" ").toLowerCase().includes(keyword);
    });
  }, [activities, dateFrom, dateTo, parkingFilter, search, typeFilter]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredActivities.length / pageSize));
  const visibleRows = filteredActivities.slice((page - 1) * pageSize, page * pageSize);
  const today = toDateInput(new Date());
  const todayCount = activities.filter((item) => toDateInput(item.time) === today).length;
  const warningCount = summary?.warning ?? activities.filter((item) => item.result === "warning" || item.status === "warning").length;
  const paymentCount = summary?.payment ?? activities.filter((item) => item.type === "payment").length;
  const employeeCount = summary?.employee ?? activities.filter((item) => item.type === "employee").length;

  const exportRows = () => {
    downloadCsv("lich-su-hoat-dong-owner.csv", filteredActivities.map((item) => ({
      thoi_gian: formatDateTime(item.time),
      loai: TYPE_META[item.type]?.label || item.type,
      hanh_dong: item.action,
      doi_tuong: item.object,
      bai_xe: item.parkingLotName,
      nguoi_thao_tac: item.actor,
      thiet_bi: item.device,
      chi_tiet: item.detail,
      trang_thai: item.status,
    })));
  };

  const refreshData = async () => {
    await actions.refreshOwnerData({ silent: true });
    setPage(1);
  };

  return (
    <div className="owner-designed-page owner-activity-page">
      <div className="owner-page-actions">
        <button type="button" className="owner-management-secondary" onClick={refreshData}>
          <RefreshCw size={17} />
          Làm mới
        </button>
        <button type="button" className="owner-management-secondary" onClick={exportRows}>
          <Download size={17} />
          Xuất báo cáo
        </button>
      </div>

      <div className="owner-management-stats owner-designed-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><Activity size={23} /></span>
          <div><p>Tổng hoạt động</p><strong>{formatNumber(summary?.total ?? activities.length)}</strong><small>{todayCount} hoạt động hôm nay</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><ShieldCheck size={23} /></span>
          <div><p>Thao tác thành công</p><strong>{formatNumber(Math.max(0, (summary?.total ?? activities.length) - warningCount))}</strong><small>Ghi nhận từ CSDL</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--sky">
          <span><CreditCard size={23} /></span>
          <div><p>Thanh toán</p><strong>{formatNumber(paymentCount)}</strong><small>Giao dịch trong hệ thống</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><UserCog size={23} /></span>
          <div><p>Tài khoản bãi</p><strong>{formatNumber(employeeCount)}</strong><small>Nhật ký vận hành</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><AlertTriangle size={23} /></span>
          <div><p>Cần chú ý</p><strong>{formatNumber(warningCount)}</strong><small>Lỗi, pending hoặc chưa xử lý</small></div>
        </article>
      </div>

      <section className="owner-management-panel">
        <div className="owner-filterbar owner-activity-filterbar">
          <label className="owner-management-search">
            <Search size={18} />
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm kiếm theo hành động, đối tượng, thiết bị..." />
          </label>
          <select className="owner-management-select" value={parkingFilter} onChange={(event) => { setParkingFilter(event.target.value); setPage(1); }}>
            <option value="all">Tất cả bãi xe</option>
            {parkingOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="owner-management-select" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}>
            {ACTIVITY_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <input className="owner-management-select" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1); }} />
          <input className="owner-management-select" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1); }} />
          <button type="button" className="owner-management-secondary" onClick={() => setPage(1)}>
            <Filter size={17} />
            Bộ lọc
          </button>
        </div>

        <div className="owner-table-shell">
          <table className="owner-table owner-designed-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Hành động</th>
                <th>Đối tượng / Nội dung</th>
                <th>Bãi xe</th>
                <th>Thiết bị</th>
                <th>Chi tiết</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading || isSyncing ? (
                <tr><td colSpan={7} className="owner-empty-cell">Đang tải lịch sử hoạt động...</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={7} className="owner-empty-cell">Không có hoạt động nào khớp bộ lọc.</td></tr>
              ) : visibleRows.map((item) => {
                const meta = TYPE_META[item.type] || TYPE_META.system;
                const Icon = meta.icon;
                return (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.time)}</td>
                    <td>
                      <div className="owner-row-title">
                        <span className={`owner-designed-icon owner-designed-icon--${meta.tone}`}><Icon size={16} /></span>
                        <strong>{item.action}</strong>
                      </div>
                    </td>
                    <td>{item.object || "-"}</td>
                    <td><strong>{item.parkingLotName || "Hệ thống"}</strong></td>
                    <td><span>{item.device || "Web"}</span><small>{item.ip || ""}</small></td>
                    <td>
                      <div className="owner-row-detail">
                        <span>{item.detail || "-"}</span>
                        <StatusBadge status={item.status || item.result || "success"} />
                      </div>
                    </td>
                    <td>
                      <div className="owner-row-actions">
                        <button type="button" className="owner-icon-mini" onClick={() => setSelected(item)} aria-label="Xem chi tiết">
                          <Eye size={16} />
                        </button>
                        <button type="button" className="owner-icon-mini" onClick={() => setSelected(item)} aria-label="Mở thêm">
                          <MoreVertical size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="owner-management-pagination">
          <span>Hiển thị {filteredActivities.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filteredActivities.length)} trong tổng số {formatNumber(filteredActivities.length)} hoạt động</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
            {Array.from({ length: Math.min(3, totalPages) }, (_, index) => index + 1).map((item) => (
              <button key={item} type="button" className={page === item ? "is-active" : ""} onClick={() => setPage(item)}>{item}</button>
            ))}
            {totalPages > 3 ? <span>...</span> : null}
            {totalPages > 3 ? <button type="button" className={page === totalPages ? "is-active" : ""} onClick={() => setPage(totalPages)}>{totalPages}</button> : null}
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button>
          </div>
        </div>
      </section>

      {selected ? createPortal(
        <div className="owner-modal-backdrop" onClick={() => setSelected(null)}>
          <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{selected.action}</h2>
                <p>{formatDateTime(selected.time)}</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="owner-detail-grid">
              <div><span>Đối tượng</span><strong>{selected.object || "-"}</strong></div>
              <div><span>Bãi xe</span><strong>{selected.parkingLotName || "-"}</strong></div>
              <div><span>Người thao tác</span><strong>{selected.actor || "-"}</strong></div>
              <div><span>Thiết bị</span><strong>{selected.device || "-"}</strong></div>
              <div><span>IP</span><strong>{selected.ip || "Không ghi nhận"}</strong></div>
              <div><span>Trạng thái</span><strong>{selected.status || selected.result || "-"}</strong></div>
            </div>
            {selected.vehicle ? (
              <div className="owner-activity-vehicle-box owner-activity-vehicle-box--modal">
                <strong>Thông tin xe</strong>
                <span><small>Biển số</small><b>{selected.vehicle.license_plate}</b></span>
                <span><small>Loại xe</small><b>{selected.vehicle.vehicle_type}</b></span>
                <span><small>Vé</small><b>{selected.vehicle.booking_mode}</b></span>
                <span><small>Vị trí</small><b>{selected.vehicle.slot_code || "-"}</b></span>
              </div>
            ) : null}
            <p className="owner-modal-note">{selected.detail || "Không có chi tiết bổ sung."}</p>
          </div>
        </div>
      , document.body) : null}
    </div>
  );
}
