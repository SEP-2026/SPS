import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CalendarClock,
  Download,
  Eye,
  Filter,
  Info,
  KeyRound,
  Lock,
  MapPin,
  Monitor,
  MoreVertical,
  Plus,
  Search,
  ShieldCheck,
  UserCog,
  Users,
  Wifi,
} from "lucide-react";
import API from "../../services/api";
import { formatDateTime, StatusBadge } from "../../owner/OwnerUI";
import { downloadCsv, formatNumber, getInitials } from "../../owner/ownerUtils";
import { useOwnerContext } from "../../owner/useOwnerContext";

const EMPTY_FORM = {
  id: null,
  full_name: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  parking_id: "",
  status: "active",
};

const STATUS_META = {
  active: { label: "Hoạt động", badge: "active" },
  suspended: { label: "Tạm khóa", badge: "suspended" },
  inactive: { label: "Không hoạt động", badge: "cancelled" },
};

function normalizeEmployee(employee) {
  return {
    ...employee,
    full_name: employee.full_name || employee.username || "Tài khoản bãi",
    email: employee.email || employee.username || "",
    phone: employee.phone || "",
    status: employee.status || "active",
    activity_count: Number(employee.activity_count || 0),
    parking_district: employee.parking_district || "",
    parking_code: employee.parking_code || (employee.parking_id ? `BX${String(employee.parking_id).padStart(3, "0")}` : ""),
    last_login_at: employee.last_login_at || null,
    login_ip: employee.login_ip || "",
    login_device: employee.login_device || "",
    status_detail: employee.status_detail || "",
  };
}

function passwordValid(form, editing) {
  if (editing && !form.password && !form.confirmPassword) {
    return true;
  }
  return form.password.length >= 6 && form.password === form.confirmPassword;
}

export default function OwnerEmployees({ embedded = false }) {
  const { ownerData, actions } = useOwnerContext();
  const [employees, setEmployees] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("all");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [modalMode, setModalMode] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    const nextEmployees = await actions.listEmployees();
    setEmployees(nextEmployees.map(normalizeEmployee));
    setLoading(false);
  }, [actions]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await API.get("/owner/activity");
        setActivities((res.data?.activities || []).filter((item) => item.type === "employee"));
      } catch {
        setActivities([]);
      }
    };
    fetchActivities();
  }, []);

  const parkingRows = useMemo(() => (
    (ownerData.settings?.parkingLots || ownerData.parkingLots || []).map((lot) => ({
      id: Number(lot.id),
      name: lot.name,
      district: lot.district || "",
    }))
  ), [ownerData.parkingLots, ownerData.settings?.parkingLots]);

  const unassignedParkingRows = useMemo(() => {
    const assigned = new Set(employees.map((employee) => Number(employee.parking_id)));
    return parkingRows.filter((lot) => !assigned.has(Number(lot.id)));
  }, [employees, parkingRows]);

  const stats = useMemo(() => {
    const active = employees.filter((employee) => employee.status === "active").length;
    const suspended = employees.filter((employee) => employee.status === "suspended").length;
    const inactive = employees.filter((employee) => employee.status === "inactive").length;
    return {
      total: employees.length,
      active,
      suspended,
      inactive,
      createdPercent: parkingRows.length ? Math.round((employees.length / parkingRows.length) * 100) : 0,
      activePercent: employees.length ? Math.round((active / employees.length) * 100) : 0,
    };
  }, [employees, parkingRows.length]);

  const cityOptions = useMemo(() => (
    Array.from(new Set(parkingRows.map((lot) => lot.district).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi"))
  ), [parkingRows]);

  const filteredEmployees = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return employees.filter((employee) => {
      const parking = parkingRows.find((lot) => Number(lot.id) === Number(employee.parking_id));
      if (statusFilter !== "all" && employee.status !== statusFilter) {
        return false;
      }
      if (cityFilter !== "all" && parking?.district !== cityFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return [
        employee.full_name,
        employee.email,
        employee.phone,
        employee.parking_name,
        parking?.district,
      ].join(" ").toLowerCase().includes(keyword);
    });
  }, [cityFilter, employees, parkingRows, search, statusFilter]);

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filteredEmployees.length / pageSize));
  const visibleRows = filteredEmployees.slice((page - 1) * pageSize, page * pageSize);

  const openCreate = () => {
    if (unassignedParkingRows.length === 0) {
      window.alert("Tất cả bãi xe đã có tài khoản vận hành. Mỗi bãi chỉ có 01 tài khoản.");
      return;
    }
    setForm({ ...EMPTY_FORM, parking_id: String(unassignedParkingRows[0].id) });
    setModalMode("create");
  };

  const openEdit = (employee) => {
    setSelectedEmployee(null);
    setForm({
      id: employee.id,
      full_name: employee.full_name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      password: "",
      confirmPassword: "",
      parking_id: String(employee.parking_id || ""),
      status: employee.status || "active",
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

  const saveEmployee = async (event) => {
    event.preventDefault();
    if (!form.full_name.trim() || !form.email.trim() || !form.phone.trim() || !form.parking_id) {
      window.alert("Vui lòng nhập đầy đủ tên, email, số điện thoại và bãi phụ trách.");
      return;
    }
    if (!passwordValid(form, modalMode === "edit")) {
      window.alert("Mật khẩu tối thiểu 6 ký tự và xác nhận phải khớp.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        parking_id: Number(form.parking_id),
      };
      if (form.password) {
        payload.password = form.password;
      }
      if (modalMode === "edit") {
        payload.status = form.status;
        await actions.updateEmployee(form.id, payload);
      } else {
        payload.password = form.password;
        await actions.createEmployee(payload);
      }
      await loadEmployees();
      setModalMode("");
      setForm(EMPTY_FORM);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (employee, status) => {
    const updated = await actions.updateEmployee(employee.id, {
      full_name: employee.full_name,
      email: employee.email,
      phone: employee.phone,
      parking_id: Number(employee.parking_id),
      status,
    });
    if (updated) {
      await loadEmployees();
      setSelectedEmployee((current) => (current?.id === employee.id ? { ...current, status } : current));
    }
  };

  const deleteEmployee = async (employee) => {
    const ok = window.confirm(`Xóa tài khoản ${employee.email}?`);
    if (!ok) {
      return;
    }
    const deleted = await actions.deleteEmployee(employee.id);
    if (deleted) {
      await loadEmployees();
      setSelectedEmployee(null);
    }
  };

  const exportEmployees = () => {
    downloadCsv("tai-khoan-bai-xe-owner.csv", filteredEmployees.map((employee) => ({
      ten_tai_khoan: employee.full_name,
      email: employee.email,
      so_dien_thoai: employee.phone,
      bai_phu_trach: employee.parking_name,
      trang_thai: STATUS_META[employee.status]?.label || employee.status,
      lan_hoat_dong: employee.activity_count,
      tao_luc: formatDateTime(employee.created_at),
    })));
  };

  const selectedParking = selectedEmployee
    ? parkingRows.find((lot) => Number(lot.id) === Number(selectedEmployee.parking_id))
    : null;
  const selectedActivities = selectedEmployee
    ? activities.filter((item) => (
      item.actor === selectedEmployee.full_name
      || item.actor === selectedEmployee.email
      || item.object?.includes(selectedEmployee.email)
      || item.detail?.includes(selectedEmployee.email)
      || item.parkingLotName === selectedEmployee.parking_name
    ))
    : [];
  const activeActivityDetail = selectedActivity || selectedActivities[0] || null;

  useEffect(() => {
    setSelectedActivity(null);
  }, [selectedEmployee?.id]);

  return (
    <div className={embedded ? "owner-settings-embedded-accounts" : "owner-designed-page owner-accounts-page"}>
      <div className="owner-page-actions">
        <button type="button" className="owner-management-secondary" onClick={exportEmployees}>
          <Download size={17} />
          Xuất dữ liệu
        </button>
        <button type="button" className="owner-management-primary" onClick={openCreate}>
          <Plus size={18} />
          Tạo tài khoản mới
        </button>
      </div>

      <div className="owner-management-stats owner-designed-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><Users size={23} /></span>
          <div><p>Tổng tài khoản bãi xe</p><strong>{formatNumber(stats.total)}</strong><small>{stats.createdPercent}% tài khoản đã tạo</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><ShieldCheck size={23} /></span>
          <div><p>Đang hoạt động</p><strong>{formatNumber(stats.active)}</strong><small>{stats.activePercent}% tài khoản hoạt động</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><Lock size={23} /></span>
          <div><p>Tạm khóa</p><strong>{formatNumber(stats.suspended)}</strong><small>Tạm ngưng đăng nhập</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><UserCog size={23} /></span>
          <div><p>Không hoạt động</p><strong>{formatNumber(stats.inactive)}</strong><small>Đã ngưng vận hành</small></div>
        </article>
      </div>

      <div className="owner-accounts-layout">
        <section className="owner-management-panel">
          <div className="owner-panel-heading">
            <div><h3>Danh sách tài khoản bãi xe</h3><p>Mỗi bãi xe chỉ có 01 tài khoản vận hành.</p></div>
          </div>
          <div className="owner-filterbar owner-account-filterbar">
            <label className="owner-management-search">
              <Search size={18} />
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Tìm theo bãi xe, email, tỉnh/thành phố..." />
            </label>
            <select className="owner-management-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}>
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Hoạt động</option>
              <option value="suspended">Tạm khóa</option>
              <option value="inactive">Không hoạt động</option>
            </select>
            <select className="owner-management-select" value={cityFilter} onChange={(event) => { setCityFilter(event.target.value); setPage(1); }}>
              <option value="all">Tất cả tỉnh/thành phố</option>
              {cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
            <button type="button" className="owner-management-secondary" onClick={() => setPage(1)}>
              <Filter size={17} />
              Bộ lọc
            </button>
          </div>

          <div className="owner-table-shell">
            <table className="owner-table owner-designed-table">
              <thead>
                <tr>
                  <th>Bãi xe</th>
                  <th>Tài khoản</th>
                  <th>Tỉnh / Thành phố</th>
                  <th>Trạng thái</th>
                  <th>Hoạt động cuối</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="owner-empty-cell">Đang tải tài khoản bãi xe...</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr><td colSpan={6} className="owner-empty-cell">Không có tài khoản nào khớp bộ lọc.</td></tr>
                ) : visibleRows.map((employee) => {
                  const parking = parkingRows.find((lot) => Number(lot.id) === Number(employee.parking_id));
                  return (
                    <tr key={employee.id}>
                      <td>
                        <div className="owner-row-title">
                          <span className="owner-customer-avatar">{getInitials(employee.parking_name)}</span>
                          <div><strong>{employee.parking_name || `Bãi #${employee.parking_id}`}</strong><small>Mã: BX{String(employee.parking_id).padStart(3, "0")}</small></div>
                        </div>
                      </td>
                      <td><strong>{employee.email}</strong><small>{employee.full_name} · {employee.phone || "-"}</small></td>
                      <td>{parking?.district || "Chưa cập nhật"}</td>
                      <td><StatusBadge status={STATUS_META[employee.status]?.badge || "system"} /> <small>{STATUS_META[employee.status]?.label || employee.status}</small></td>
                      <td>{employee.last_activity_at ? formatDateTime(employee.last_activity_at) : formatDateTime(employee.created_at)}</td>
                      <td>
                        <div className="owner-row-actions">
                          <button type="button" className="owner-icon-mini" onClick={() => setSelectedEmployee(employee)} aria-label="Xem chi tiết"><Eye size={16} /></button>
                          <button type="button" className="owner-icon-mini" onClick={() => changeStatus(employee, employee.status === "active" ? "suspended" : "active")} aria-label="Khóa hoặc mở khóa"><Lock size={16} /></button>
                          <button type="button" className="owner-icon-mini" onClick={() => openEdit(employee)} aria-label="Sửa"><MoreVertical size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="owner-management-pagination">
            <span>Hiển thị {filteredEmployees.length ? (page - 1) * pageSize + 1 : 0} - {Math.min(page * pageSize, filteredEmployees.length)} trong tổng số {formatNumber(filteredEmployees.length)} tài khoản</span>
            <div>
              <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>‹</button>
              <button type="button" className={page === 1 ? "is-active" : ""} onClick={() => setPage(1)}>1</button>
              {totalPages > 1 ? <button type="button" className={page === totalPages ? "is-active" : ""} onClick={() => setPage(totalPages)}>{totalPages}</button> : null}
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>›</button>
            </div>
          </div>

          <section className="owner-account-log-panel">
            <div className="owner-panel-heading">
              <div><h3>Nhật ký hoạt động</h3><p>Hoạt động từ tài khoản bãi trong các bãi owner quản lý</p></div>
            </div>
            <div className="owner-table-shell">
              <table className="owner-table owner-designed-table">
                <thead><tr><th>Thời gian</th><th>Tài khoản</th><th>Hoạt động</th><th>Chi tiết</th><th>Bãi xe</th></tr></thead>
                <tbody>
                  {activities.slice(0, 6).map((activity) => (
                    <tr key={activity.id}>
                      <td>{formatDateTime(activity.time)}</td>
                      <td>{activity.actor}</td>
                      <td>{activity.action}</td>
                      <td>{activity.detail || "-"}</td>
                      <td>{activity.parkingLotName}</td>
                    </tr>
                  ))}
                  {activities.length === 0 ? <tr><td colSpan={5} className="owner-empty-cell">Chưa có nhật ký hoạt động.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <aside className="owner-side-stack">
          <section className="owner-management-panel owner-side-panel">
            <h3>Chi tiết tài khoản</h3>
            {selectedEmployee ? (
              <>
                <div className="owner-account-detail-card owner-account-detail-card--full">
                  <div className="owner-account-detail-top">
                    <span className="owner-customer-avatar owner-customer-avatar--large">{getInitials(selectedEmployee.parking_name)}</span>
                    <StatusBadge status={STATUS_META[selectedEmployee.status]?.badge || "system"} />
                  </div>
                  <strong>{selectedEmployee.parking_name || `Bãi #${selectedEmployee.parking_id}`}</strong>
                  <p>{selectedEmployee.email}</p>
                  <small>{selectedEmployee.parking_code || `BX${String(selectedEmployee.parking_id).padStart(3, "0")}`}</small>
                </div>
                <div className="owner-detail-list owner-detail-list--icons">
                  <span><MapPin size={15} /><small>Tỉnh / Thành phố</small><strong>{selectedEmployee.parking_district || selectedParking?.district || "Chưa cập nhật"}</strong></span>
                  <span><CalendarClock size={15} /><small>Ngày tạo</small><strong>{formatDateTime(selectedEmployee.created_at)}</strong></span>
                  <span><Wifi size={15} /><small>IP đăng nhập</small><strong>{selectedEmployee.login_ip || "Chưa ghi nhận"}</strong></span>
                  <span><Monitor size={15} /><small>Thiết bị đăng nhập</small><strong>{selectedEmployee.login_device || "Chưa ghi nhận"}</strong></span>
                  <span><Activity size={15} /><small>Đăng nhập cuối</small><strong>{selectedEmployee.last_login_at ? formatDateTime(selectedEmployee.last_login_at) : "Chưa ghi nhận"}</strong></span>
                  <span><Info size={15} /><small>Trạng thái</small><strong>{selectedEmployee.status_detail || STATUS_META[selectedEmployee.status]?.label || selectedEmployee.status}</strong></span>
                </div>
                <div className="owner-quick-actions owner-quick-actions--stack">
                  <button type="button" onClick={() => openEdit(selectedEmployee)}><KeyRound size={18} />Đổi mật khẩu</button>
                  <button type="button" onClick={() => changeStatus(selectedEmployee, selectedEmployee.status === "active" ? "suspended" : "active")}><Lock size={18} />{selectedEmployee.status === "active" ? "Tạm khóa" : "Mở khóa"}</button>
                  <button type="button" onClick={() => setSelectedActivity(selectedActivities[0] || null)}><Eye size={18} />Nhật ký hoạt động</button>
                  <button type="button" onClick={() => deleteEmployee(selectedEmployee)}><MoreVertical size={18} />Xóa tài khoản</button>
                </div>
                <p className="owner-account-security-note"><Info size={15} />Mật khẩu đã được mã hóa. Hệ thống không lưu mật khẩu gốc.</p>
              </>
            ) : (
              <p className="owner-empty-cell">Chọn một tài khoản để xem chi tiết.</p>
            )}
          </section>

          <section className="owner-management-panel owner-side-panel">
            <h3>Chi tiết hoạt động</h3>
            {!selectedEmployee ? <p className="owner-empty-cell">Chọn một tài khoản để xem hoạt động.</p> : null}
            {selectedEmployee && !activeActivityDetail ? <p className="owner-empty-cell">Chưa có hoạt động chi tiết cho tài khoản đang chọn.</p> : null}
            {activeActivityDetail ? (
              <div className="owner-activity-detail-card">
                <span><small>Thời gian</small><strong>{formatDateTime(activeActivityDetail.time)}</strong></span>
                <span><small>Tài khoản</small><strong>{activeActivityDetail.actor || selectedEmployee.email}</strong></span>
                <span><small>Hoạt động</small><strong>{activeActivityDetail.action}</strong></span>
                <span><small>Kết quả</small><StatusBadge status={activeActivityDetail.status || activeActivityDetail.result || "success"} /></span>
                <p>{activeActivityDetail.detail || activeActivityDetail.parkingLotName || "Không có chi tiết bổ sung."}</p>
                {activeActivityDetail.vehicle ? (
                  <div className="owner-activity-vehicle-box">
                    <strong>Thông tin xe</strong>
                    <span><small>Biển số</small><b>{activeActivityDetail.vehicle.license_plate}</b></span>
                    <span><small>Loại xe</small><b>{activeActivityDetail.vehicle.vehicle_type}</b></span>
                    <span><small>Vé</small><b>{activeActivityDetail.vehicle.booking_mode}</b></span>
                  </div>
                ) : null}
                <span><small>Thiết bị</small><strong>{activeActivityDetail.device || "Employee console"}</strong></span>
                <span><small>IP</small><strong>{activeActivityDetail.ip || "Chưa ghi nhận"}</strong></span>
              </div>
            ) : null}
            {selectedActivities.length > 1 ? (
              <div className="owner-activity-mini-list">
                {selectedActivities.slice(0, 4).map((activity) => (
                  <button key={activity.id} type="button" onClick={() => setSelectedActivity(activity)} className={activeActivityDetail?.id === activity.id ? "is-active" : ""}>
                    <strong>{activity.action}</strong>
                    <span>{formatDateTime(activity.time)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {modalMode ? (
        <div className="owner-modal-backdrop" onClick={closeModal}>
          <div className="owner-modal" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{modalMode === "edit" ? "Cập nhật tài khoản bãi" : "Tạo tài khoản bãi"}</h2>
                <p>Mật khẩu được mã hóa ở backend, hệ thống không lưu mật khẩu gốc.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={closeModal}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={saveEmployee}>
              <label>Tên tài khoản<input className="owner-input" value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} required /></label>
              <label>Email đăng nhập<input className="owner-input" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required /></label>
              <label>Số điện thoại<input className="owner-input" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required /></label>
              <label>Bãi phụ trách
                <select className="owner-input owner-select" value={form.parking_id} onChange={(event) => setForm((current) => ({ ...current, parking_id: event.target.value }))} disabled={modalMode === "edit"}>
                  {(modalMode === "edit" ? parkingRows : unassignedParkingRows).map((lot) => (
                    <option key={lot.id} value={lot.id}>{lot.name}</option>
                  ))}
                </select>
              </label>
              <label>{modalMode === "edit" ? "Mật khẩu mới (tùy chọn)" : "Mật khẩu"}
                <input className="owner-input" type="password" minLength={6} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required={modalMode !== "edit"} />
              </label>
              <label>Nhập lại mật khẩu
                <input className="owner-input" type="password" minLength={6} value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} required={modalMode !== "edit" || Boolean(form.password)} />
              </label>
              {modalMode === "edit" ? (
                <label className="owner-form-span">Trạng thái
                  <select className="owner-input owner-select" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                    <option value="active">Hoạt động</option>
                    <option value="suspended">Tạm khóa</option>
                    <option value="inactive">Không hoạt động</option>
                  </select>
                </label>
              ) : null}
              <p className="owner-save-note owner-form-span">Mật khẩu tài khoản bãi tối thiểu 6 ký tự.</p>
              <div className="owner-modal-actions owner-form-span">
                <button type="button" className="btn-secondary owner-btn" onClick={closeModal} disabled={saving}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn" disabled={saving}>{saving ? "Đang lưu..." : "Lưu tài khoản"}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
