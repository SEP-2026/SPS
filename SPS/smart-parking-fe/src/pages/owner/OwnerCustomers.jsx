import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Download,
  Eye,
  Filter,
  Heart,
  Mail,
  MoreVertical,
  Plus,
  Search,
  Tag,
  TrendingUp,
  Upload,
  UserCheck,
  Users,
  WalletCards,
} from "lucide-react";
import API from "../../services/api";
import { formatCurrency, formatDateTime, StatusBadge } from "../../owner/OwnerUI";
import { downloadCsv, formatNumber, getInitials } from "../../owner/ownerUtils";

const EMPTY_FORM = {
  id: null,
  name: "",
  email: "",
  phone: "",
  vehicle_plate: "",
  status: "active",
};

const GROUP_TABS = [
  { value: "all", label: "Tất cả khách hàng" },
  { value: "loyal", label: "Khách hàng thân thiết" },
  { value: "new", label: "Khách hàng mới" },
  { value: "grouped", label: "Theo phân nhóm" },
];

const GROUP_LABELS = {
  loyal: "Thân thiết",
  regular: "Thường",
  new: "Mới",
};

const STATUS_LABELS = {
  active: "Hoạt động",
  suspended: "Tạm khóa",
  blocked: "Bị chặn",
  inactive: "Không hoạt động",
};

function normalizeCustomer(customer) {
  const bookings = Array.isArray(customer.bookings) ? customer.bookings : [];
  const paidAmount = Number(customer.paid_amount ?? customer.paidAmount ?? 0);
  const totalSpent = Number(customer.total_spent ?? customer.totalSpent ?? paidAmount);
  return {
    ...customer,
    bookings,
    transactions: Array.isArray(customer.transactions) ? customer.transactions : [],
    vehicles: Array.isArray(customer.vehicles) ? customer.vehicles : [],
    email: customer.email || "",
    status: customer.status || "active",
    group: customer.group || "new",
    paid_amount: paidAmount,
    total_spent: totalSpent,
    pending_amount: Number(customer.pending_amount ?? customer.pendingAmount ?? 0),
    avg_visits_per_month: Number(customer.avg_visits_per_month || 0),
    last_visit: customer.last_visit || bookings[0]?.start_time || null,
  };
}

function customerGroupTone(group) {
  if (group === "loyal") {
    return "success";
  }
  if (group === "regular") {
    return "info";
  }
  return "neutral";
}

function parseCsvLine(line) {
  const result = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  result.push(value.trim());
  return result;
}

export default function OwnerCustomers() {
  const fileInputRef = useRef(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modalMode, setModalMode] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCustomers = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await API.get("/owner/customers");
      const nextCustomers = Array.isArray(res.data?.customers) ? res.data.customers.map(normalizeCustomer) : [];
      setCustomers(nextCustomers);
    } catch (err) {
      setError(err?.response?.data?.detail || "Không tải được dữ liệu khách hàng");
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const stats = useMemo(() => {
    const total = customers.length;
    const loyal = customers.filter((item) => item.group === "loyal").length;
    const newCustomers = customers.filter((item) => item.group === "new").length;
    const active = customers.filter((item) => item.status === "active").length;
    const revenue = customers.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
    const visitCount = customers.reduce((sum, item) => sum + item.bookings.length, 0);
    return {
      total,
      loyal,
      newCustomers,
      active,
      revenue,
      avgFrequency: total ? (visitCount / total).toFixed(1) : "0.0",
    };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const resolvedGroup = activeTab === "grouped" ? groupFilter : activeTab;
      if (resolvedGroup !== "all" && customer.group !== resolvedGroup) {
        return false;
      }
      if (statusFilter !== "all" && customer.status !== statusFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [
        customer.name,
        customer.email,
        customer.phone,
        customer.vehicles.map((vehicle) => vehicle.plate).join(" "),
      ].join(" ").toLowerCase().includes(keyword);
    });
  }, [activeTab, customers, groupFilter, search, statusFilter]);

  const topCustomers = useMemo(
    () => [...customers].sort((left, right) => Number(right.paid_amount || 0) - Number(left.paid_amount || 0)).slice(0, 5),
    [customers],
  );
  const behaviorAnalysis = useMemo(() => {
    const hourCounts = new Map();
    const dayCounts = new Map();
    let totalBookings = 0;
    let repeatCustomers = 0;
    let inactiveCustomers = 0;
    const now = new Date();

    customers.forEach((customer) => {
      if (customer.bookings.length >= 2) {
        repeatCustomers += 1;
      }
      const lastVisit = customer.last_visit ? new Date(customer.last_visit) : null;
      if (!lastVisit || Number.isNaN(lastVisit.getTime()) || now - lastVisit > 30 * 24 * 60 * 60 * 1000) {
        inactiveCustomers += 1;
      }
      customer.bookings.forEach((booking) => {
        const date = new Date(booking.start_time);
        if (Number.isNaN(date.getTime())) {
          return;
        }
        totalBookings += 1;
        const hour = `${String(date.getHours()).padStart(2, "0")}:00`;
        const day = date.toLocaleDateString("vi-VN", { weekday: "long" });
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
      });
    });

    const topEntry = (map, fallback) => {
      const rows = Array.from(map.entries()).sort((left, right) => right[1] - left[1]);
      return rows[0]?.[0] || fallback;
    };

    return {
      peakHour: topEntry(hourCounts, "--"),
      peakDay: topEntry(dayCounts, "--"),
      repeatRate: customers.length ? Math.round((repeatCustomers / customers.length) * 100) : 0,
      inactiveCustomers,
      totalBookings,
    };
  }, [customers]);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / pageSize));
  const visibleRows = filteredCustomers.slice((page - 1) * pageSize, page * pageSize);
  const groupDistribution = [
    { key: "loyal", label: "Thân thiết", value: customers.filter((item) => item.group === "loyal").length },
    { key: "regular", label: "Thường", value: customers.filter((item) => item.group === "regular").length },
    { key: "new", label: "Mới", value: customers.filter((item) => item.group === "new").length },
    { key: "inactive", label: "Không hoạt động", value: customers.filter((item) => item.status !== "active").length },
  ];

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModalMode("create");
  };

  const openEdit = (customer) => {
    setSelectedCustomer(null);
    setForm({
      id: customer.id,
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      vehicle_plate: customer.vehicles[0]?.plate || "",
      status: customer.status || "active",
    });
    setModalMode("edit");
  };

  const closeModal = () => {
    if (saving) {
      return;
    }
    setModalMode("");
    setForm(EMPTY_FORM);
  };

  const saveCustomer = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim() || saving) {
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        vehicle_plate: form.vehicle_plate.trim().toUpperCase(),
        status: form.status,
      };
      if (modalMode === "edit" && form.id) {
        await API.patch(`/owner/customers/${form.id}`, payload);
      } else {
        await API.post("/owner/customers", payload);
      }
      await loadCustomers();
      setModalMode("");
      setForm(EMPTY_FORM);
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Không thể lưu khách hàng");
    } finally {
      setSaving(false);
    }
  };

  const toggleCustomerStatus = async (customer) => {
    const nextStatus = customer.status === "active" ? "suspended" : "active";
    try {
      await API.patch(`/owner/customers/${customer.id}`, { status: nextStatus });
      await loadCustomers();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Không thể đổi trạng thái khách hàng");
    }
  };

  const exportCustomers = () => {
    downloadCsv("danh-sach-khach-hang-owner.csv", filteredCustomers.map((customer) => ({
      ten_khach_hang: customer.name,
      email: customer.email,
      so_dien_thoai: customer.phone,
      bien_so: customer.vehicles.map((vehicle) => vehicle.plate).join("; "),
      nhom: GROUP_LABELS[customer.group] || customer.group,
      tong_luot_do: customer.bookings.length,
      chi_tieu: customer.paid_amount,
      trang_thai: STATUS_LABELS[customer.status] || customer.status,
    })));
  };

  const importCustomers = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) {
      window.alert("File CSV chưa có dữ liệu.");
      return;
    }
    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    const nameIndex = headers.findIndex((header) => ["name", "ten", "ten_khach_hang"].includes(header));
    const emailIndex = headers.findIndex((header) => header === "email");
    const phoneIndex = headers.findIndex((header) => ["phone", "sdt", "so_dien_thoai"].includes(header));
    const plateIndex = headers.findIndex((header) => ["vehicle_plate", "bien_so", "plate"].includes(header));
    if (nameIndex < 0 || emailIndex < 0) {
      window.alert("CSV cần có cột name và email.");
      return;
    }
    let createdCount = 0;
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line);
      if (!cells[nameIndex] || !cells[emailIndex]) {
        continue;
      }
      try {
        await API.post("/owner/customers", {
          name: cells[nameIndex],
          email: cells[emailIndex],
          phone: phoneIndex >= 0 ? cells[phoneIndex] : "",
          vehicle_plate: plateIndex >= 0 ? cells[plateIndex] : "",
          status: "active",
        });
        createdCount += 1;
      } catch {
        // Skip invalid or duplicated rows and continue importing the rest.
      }
    }
    await loadCustomers();
    window.alert(`Đã nhập ${createdCount} khách hàng từ CSV.`);
  };

  return (
    <div className="owner-designed-page owner-customers-page">
      <div className="owner-page-actions">
        <button type="button" className="owner-management-secondary" onClick={exportCustomers}>
          <Download size={17} />
          Xuất dữ liệu
        </button>
        <button type="button" className="owner-management-secondary" onClick={() => fileInputRef.current?.click()}>
          <Upload size={17} />
          Nhập dữ liệu
        </button>
        <button type="button" className="owner-management-primary" onClick={openCreate}>
          <Plus size={18} />
          Thêm khách hàng
        </button>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="owner-hidden-file" onChange={importCustomers} />
      </div>

      <div className="owner-management-stats owner-designed-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><Users size={23} /></span>
          <div><p>Tổng khách hàng</p><strong>{formatNumber(stats.total)}</strong><small>{stats.active} đang hoạt động</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><UserCheck size={23} /></span>
          <div><p>Khách hàng mới</p><strong>{formatNumber(stats.newCustomers)}</strong><small>Nhóm mới từ CSDL</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><Heart size={23} /></span>
          <div><p>Khách hàng thân thiết</p><strong>{formatNumber(stats.loyal)}</strong><small>Chi tiêu hoặc lượt đỗ cao</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--sky">
          <span><ActivityIcon /></span>
          <div><p>Tần suất trung bình</p><strong>{stats.avgFrequency} lượt</strong><small>Trên mỗi khách hàng</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><WalletCards size={23} /></span>
          <div><p>Doanh thu từ KH</p><strong>{formatCurrency(stats.revenue)}</strong><small>Từ giao dịch đã thanh toán</small></div>
        </article>
      </div>

      <div className="owner-customer-tabs">
        {GROUP_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={activeTab === tab.value ? "is-active" : ""}
            onClick={() => { setActiveTab(tab.value); setPage(1); }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="owner-customer-layout">
        <section className="owner-management-panel">
          <div className="owner-filterbar owner-customer-filterbar">
            <label className="owner-management-search">
              <Search size={18} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm theo tên, SĐT, email, biển số..." />
            </label>
            <select className="owner-management-select" value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); setPage(1); }}>
              <option value="all">Tất cả nhóm</option>
              <option value="loyal">Thân thiết</option>
              <option value="regular">Thường</option>
              <option value="new">Mới</option>
            </select>
            <select className="owner-management-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="suspended">Tạm khóa</option>
              <option value="blocked">Bị chặn</option>
              <option value="inactive">Không hoạt động</option>
            </select>
            <button type="button" className="owner-management-secondary" onClick={() => setPage(1)}>
              <Filter size={17} />
              Bộ lọc
            </button>
          </div>

          {error ? <p className="owner-empty-cell">{error}</p> : null}
          <div className="owner-table-shell">
            <table className="owner-table owner-designed-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Liên hệ</th>
                  <th>Nhóm khách</th>
                  <th>Tổng lượt đỗ</th>
                  <th>Chi tiêu</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="owner-empty-cell">Đang tải dữ liệu khách hàng...</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr><td colSpan={7} className="owner-empty-cell">Không tìm thấy khách hàng phù hợp.</td></tr>
                ) : visibleRows.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <div className="owner-row-title">
                        <span className="owner-customer-avatar">{getInitials(customer.name)}</span>
                        <div><strong>{customer.name}</strong><small>{customer.vehicles[0]?.plate || "Chưa có biển số"}</small></div>
                      </div>
                    </td>
                    <td><strong>{customer.phone || "-"}</strong><small>{customer.email || "-"}</small></td>
                    <td><StatusBadge status={customerGroupTone(customer.group)} /> <small>{GROUP_LABELS[customer.group] || customer.group}</small></td>
                    <td>{formatNumber(customer.bookings.length)} lượt</td>
                    <td>{formatCurrency(customer.paid_amount)}</td>
                    <td><StatusBadge status={customer.status === "active" ? "active" : "suspended"} /> <small>{STATUS_LABELS[customer.status] || customer.status}</small></td>
                    <td>
                      <div className="owner-row-actions">
                        <button type="button" className="owner-icon-mini" onClick={() => setSelectedCustomer(customer)} aria-label="Xem chi tiết"><Eye size={16} /></button>
                        <button type="button" className="owner-icon-mini" onClick={() => openEdit(customer)} aria-label="Sửa khách hàng"><MoreVertical size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="owner-management-pagination">
            <span>Hiển thị {filteredCustomers.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filteredCustomers.length)} trong tổng số {formatNumber(filteredCustomers.length)} khách hàng</span>
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

        <aside className="owner-side-stack">
          <section className="owner-management-panel owner-side-panel">
            <h3>Phân nhóm khách hàng</h3>
            <div className="owner-donut-card">
              <div className="owner-css-donut" style={{ "--a": `${(groupDistribution[0].value / Math.max(stats.total, 1)) * 100}%`, "--b": `${((groupDistribution[0].value + groupDistribution[1].value) / Math.max(stats.total, 1)) * 100}%`, "--c": `${((groupDistribution[0].value + groupDistribution[1].value + groupDistribution[2].value) / Math.max(stats.total, 1)) * 100}%` }}>
                <strong>{formatNumber(stats.total)}</strong>
                <span>Tổng khách hàng</span>
              </div>
              <div className="owner-donut-legend">
                {groupDistribution.map((item) => (
                  <span key={item.key}><i className={`is-${item.key}`} />{item.label}<strong>{formatNumber(item.value)}</strong></span>
                ))}
              </div>
            </div>
          </section>

          <section className="owner-management-panel owner-side-panel owner-customer-behavior-panel">
            <h3>Phân tích hành vi khách hàng</h3>
            <div className="owner-behavior-grid">
              <span><Clock3 size={16} /><small>Giờ cao điểm</small><strong>{behaviorAnalysis.peakHour}</strong></span>
              <span><CalendarDays size={16} /><small>Ngày hay đặt</small><strong>{behaviorAnalysis.peakDay}</strong></span>
              <span><TrendingUp size={16} /><small>Tỷ lệ quay lại</small><strong>{behaviorAnalysis.repeatRate}%</strong></span>
              <span><AlertTriangle size={16} /><small>KH cần chăm sóc</small><strong>{formatNumber(behaviorAnalysis.inactiveCustomers)}</strong></span>
            </div>
            <p className="owner-behavior-note">Dựa trên {formatNumber(behaviorAnalysis.totalBookings)} lượt đặt trong các bãi owner quản lý.</p>
          </section>

          <section className="owner-management-panel owner-side-panel">
            <h3>Top khách hàng chi tiêu nhiều nhất</h3>
            <div className="owner-ranked-list">
              {topCustomers.map((customer, index) => (
                <button key={customer.id} type="button" onClick={() => setSelectedCustomer(customer)}>
                  <span>{index + 1}</span>
                  <b>{getInitials(customer.name)}</b>
                  <strong>{customer.name}<small>{customer.bookings.length} lượt đỗ</small></strong>
                  <em>{formatCurrency(customer.paid_amount)}</em>
                </button>
              ))}
            </div>
          </section>

          <section className="owner-management-panel owner-side-panel">
            <h3>Hành động nhanh</h3>
            <div className="owner-quick-actions">
              <button type="button" onClick={() => window.alert("Chức năng gửi thông báo đã sẵn sàng để kết nối kênh email/SMS.")}><Mail size={18} />Gửi thông báo</button>
              <button type="button" onClick={() => window.alert("Tạo ưu đãi sẽ dùng danh sách khách hàng đang lọc.")}><Tag size={18} />Tạo ưu đãi</button>
              <button type="button" onClick={exportCustomers}><Download size={18} />Xuất báo cáo</button>
              <button type="button" onClick={() => window.alert("Đã đánh dấu nhóm khách hàng cần chăm sóc.")}><Heart size={18} />Chăm sóc KH</button>
            </div>
          </section>
        </aside>
      </div>

      {selectedCustomer ? (
        <div className="owner-modal-backdrop" onClick={() => setSelectedCustomer(null)}>
          <div className="owner-modal owner-modal--detail owner-modal--large" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{selectedCustomer.name}</h2>
                <p>{selectedCustomer.email || selectedCustomer.phone || "Chi tiết khách hàng"}</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelectedCustomer(null)}>×</button>
            </div>
            <div className="owner-detail-grid">
              <div><span>Số điện thoại</span><strong>{selectedCustomer.phone || "-"}</strong></div>
              <div><span>Nhóm khách</span><strong>{GROUP_LABELS[selectedCustomer.group] || selectedCustomer.group}</strong></div>
              <div><span>Tổng lượt đỗ</span><strong>{formatNumber(selectedCustomer.bookings.length)}</strong></div>
              <div><span>Đã thanh toán</span><strong className="text-green">{formatCurrency(selectedCustomer.paid_amount)}</strong></div>
              <div><span>Chưa thanh toán</span><strong className="text-orange">{formatCurrency(selectedCustomer.pending_amount)}</strong></div>
              <div><span>Lần gần nhất</span><strong>{selectedCustomer.last_visit ? formatDateTime(selectedCustomer.last_visit) : "-"}</strong></div>
            </div>
            <div className="owner-modal-actions">
              <button type="button" className="btn-secondary owner-btn" onClick={() => openEdit(selectedCustomer)}>Sửa thông tin</button>
              <button type="button" className="btn-secondary owner-btn" onClick={() => toggleCustomerStatus(selectedCustomer)}>
                {selectedCustomer.status === "active" ? "Tạm khóa" : "Mở khóa"}
              </button>
            </div>
            <div className="owner-table-shell">
              <table className="owner-table">
                <thead><tr><th>Mã đơn</th><th>Biển số</th><th>Bãi xe</th><th>Thời gian</th><th>Số tiền</th><th>Trạng thái</th></tr></thead>
                <tbody>
                  {selectedCustomer.bookings.length === 0 ? (
                    <tr><td colSpan={6} className="owner-empty-cell">Khách hàng chưa có lịch sử đặt chỗ.</td></tr>
                  ) : selectedCustomer.bookings.slice(0, 8).map((booking) => (
                    <tr key={booking.id}>
                      <td>{booking.code}</td>
                      <td>{booking.plate}</td>
                      <td>{booking.parking_lot_name}</td>
                      <td>{formatDateTime(booking.start_time)}</td>
                      <td>{formatCurrency(booking.price)}</td>
                      <td><StatusBadge status={booking.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {modalMode ? (
        <div className="owner-modal-backdrop" onClick={closeModal}>
          <div className="owner-modal" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{modalMode === "edit" ? "Cập nhật khách hàng" : "Thêm khách hàng"}</h2>
                <p>Dữ liệu được lưu trực tiếp vào bảng users và hồ sơ xe.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={closeModal}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={saveCustomer}>
              <label>Tên khách hàng<input className="owner-input" value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required /></label>
              <label>Email<input className="owner-input" type="email" value={form.email} onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))} required /></label>
              <label>Số điện thoại<input className="owner-input" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} /></label>
              <label>Biển số xe<input className="owner-input" value={form.vehicle_plate} onChange={(event) => setForm((prev) => ({ ...prev, vehicle_plate: event.target.value }))} /></label>
              <label className="owner-form-span">Trạng thái
                <select className="owner-input owner-select" value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="suspended">Tạm khóa</option>
                  <option value="blocked">Bị chặn</option>
                  <option value="inactive">Không hoạt động</option>
                </select>
              </label>
              <div className="owner-modal-actions owner-form-span">
                <button type="button" className="btn-secondary owner-btn" onClick={closeModal} disabled={saving}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn" disabled={saving}>{saving ? "Đang lưu..." : "Lưu khách hàng"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityIcon() {
  return <UserCheck size={23} />;
}
