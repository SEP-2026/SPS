import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Phone, Mail, MapPin } from "lucide-react";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminOwners.css";
import "./AdminUsers.css";

const TABS = [
  { id: "general", label: "Thông tin chung" },
  { id: "areas", label: "Khu vực quản lý" },
  { id: "parking", label: "Bãi xe quản lý" },
  { id: "stats", label: "Thống kê hoạt động" },
  { id: "log", label: "Nhật ký hệ thống" },
];

export default function UserDetail() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("general");
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get(`/admin/users/${userId}/detail`);
      setDetail(response.data);
      setEditForm({
        name: response.data.name || "",
        email: response.data.email || "",
        phone: response.data.phone || "",
      });
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleLockToggle = async () => {
    if (!detail) return;
    const nextStatus = detail.status === "locked" ? "active" : "banned";
    try {
      await API.patch(`/admin/users/${detail.id}/status`, { status: nextStatus });
      await loadDetail();
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể cập nhật trạng thái");
    }
  };

  const handleResetPassword = async () => {
    try {
      const res = await API.post(`/admin/users/${userId}/reset-password`);
      window.alert(`Mật khẩu tạm: ${res.data.temporary_password}`);
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể đặt lại mật khẩu");
    }
  };

  const handleSave = async () => {
    if (!editForm) return;
    setSaving(true);
    try {
      await API.patch(`/admin/users/${userId}`, editForm);
      await loadDetail();
      window.alert("Đã lưu thay đổi");
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể lưu");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="admin-owners-loading">Đang tải chi tiết người dùng...</div>;
  }

  if (!detail) {
    return (
      <div className="admin-owners-loading">
        <p>Không tìm thấy người dùng.</p>
        <Link to="/admin/users">Quay lại danh sách</Link>
      </div>
    );
  }

  const visibleTabs = TABS.filter((tab) => {
    if (tab.id === "areas") return (detail.managedAreas || []).length > 0;
    if (tab.id === "parking") return (detail.managedParkingLots || []).length > 0;
    if (tab.id === "stats") return detail.role === "user";
    return true;
  });

  return (
    <div className="admin-users-page">
      <p className="admin-users-breadcrumb">
        <Link to="/admin/users">Người dùng</Link>
        {" > "}
        <Link to="/admin/users">Danh sách người dùng</Link>
        {" > "}
        <span>Chi tiết</span>
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <button type="button" className="admin-owners-btn" onClick={() => navigate("/admin/users")}>
          ← Quay lại danh sách
        </button>
        <div className="admin-users-detail-actions-bar">
          <button type="button" className="admin-owners-btn admin-users-btn-edit" onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : "Chỉnh sửa"}
          </button>
          <button type="button" className="admin-owners-btn admin-users-btn-password" onClick={handleResetPassword}>
            Đổi mật khẩu
          </button>
          <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleLockToggle}>
            {detail.status === "locked" ? "Mở khóa tài khoản" : "Khóa tài khoản"}
          </button>
        </div>
      </div>

      <div className="admin-users-detail-hero">
        <div className="admin-users-detail-hero-left">
          <div className="admin-users-detail-avatar">{detail.initials}</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22 }}>{detail.name}</h2>
            <p style={{ margin: "4px 0 0", color: "#64748b" }}>{detail.username}</p>
            <div className="admin-users-detail-tags">
              <span className={`admin-users-role-tag admin-users-role-tag--${detail.roleKey}`}>
                {detail.roleLabel}
              </span>
              <span className={`admin-owners-status admin-owners-status--${detail.status === "active" ? "active" : "locked"}`}>
                {detail.statusLabel}
              </span>
            </div>
            <div className="admin-users-detail-meta-grid" style={{ marginTop: 12 }}>
              <div><Phone size={14} /> {detail.phone || "—"}</div>
              <div><Mail size={14} /> {detail.email}</div>
              <div><MapPin size={14} /> {detail.location || "—"}</div>
            </div>
          </div>
        </div>
        <div className="admin-users-detail-meta-grid">
          <div><span style={{ color: "#94a3b8" }}>Ngày tạo</span><br /><strong>{formatDateTimeVN(detail.createdAt)}</strong></div>
          <div><span style={{ color: "#94a3b8" }}>Cập nhật cuối</span><br /><strong>{formatDateTimeVN(detail.updatedAt)}</strong></div>
          <div><span style={{ color: "#94a3b8" }}>Tạo bởi</span><br /><strong>{detail.createdBy}</strong></div>
          <div><span style={{ color: "#94a3b8" }}>Trạng thái</span><br /><strong style={{ color: detail.status === "active" ? "#059669" : "#dc2626" }}>{detail.statusLabel}</strong></div>
        </div>
      </div>

      <div className="admin-users-detail-layout">
        <div className="admin-owners-table-card" style={{ padding: 16 }}>
          <div className="admin-users-tabs">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`admin-users-tab${activeTab === tab.id ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "general" && editForm ? (
            <>
              <div className="admin-users-info-section">
                <h4>Thông tin cá nhân</h4>
                <div className="admin-users-field-grid">
                  <label className="admin-users-field">
                    Họ và tên
                    <input
                      className="owner-input"
                      value={editForm.name}
                      onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                    />
                  </label>
                  <label className="admin-users-field">
                    Số điện thoại
                    <input
                      className="owner-input"
                      value={editForm.phone}
                      onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                    />
                  </label>
                  <label className="admin-users-field">
                    Email
                    <input
                      className="owner-input"
                      value={editForm.email}
                      onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))}
                    />
                  </label>
                  <div className="admin-users-field">
                    <label>Vai trò</label>
                    <strong>{detail.roleLabel}</strong>
                  </div>
                  <div className="admin-users-field">
                    <label>Trạng thái</label>
                    <strong>{detail.statusLabel}</strong>
                  </div>
                  {detail.vehiclePlate ? (
                    <div className="admin-users-field">
                      <label>Biển số xe</label>
                      <strong>{detail.vehiclePlate}</strong>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="admin-users-info-section">
                <h4>Thông tin tài khoản</h4>
                <div className="admin-users-field-grid">
                  <div className="admin-users-field">
                    <label>Tên đăng nhập</label>
                    <strong>{detail.username}</strong>
                  </div>
                  <div className="admin-users-field">
                    <label>Phương thức đăng nhập</label>
                    <strong>{detail.loginMethod}</strong>
                  </div>
                  <div className="admin-users-field">
                    <label>Đăng nhập gần nhất</label>
                    <strong>{formatDateTimeVN(detail.lastLoginAt)}</strong>
                  </div>
                  <div className="admin-users-field">
                    <label>Đăng nhập thất bại gần đây</label>
                    <strong>{detail.failedLoginRecent}</strong>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {activeTab === "areas" ? (
            <div className="admin-users-info-section">
              <h4>Khu vực quản lý</h4>
              {(detail.managedAreas || []).length ? (
                <div className="admin-owners-areas">
                  {detail.managedAreas.map((area) => (
                    <span key={area.id || area.name} className="admin-owners-area-tag">{area.name}</span>
                  ))}
                </div>
              ) : (
                <p>Chưa gán khu vực.</p>
              )}
            </div>
          ) : null}

          {activeTab === "parking" ? (
            <div className="admin-users-info-section">
              <h4>Bãi xe quản lý</h4>
              <div className="admin-owners-table-wrap">
                <table className="admin-owners-table">
                  <thead>
                    <tr>
                      <th>Tên bãi</th>
                      <th>Địa chỉ</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.managedParkingLots || []).map((lot) => (
                      <tr key={lot.id}>
                        <td>{lot.name}</td>
                        <td>{lot.address}</td>
                        <td>{lot.status === "active" ? "Hoạt động" : "Tạm khóa"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "stats" ? (
            <div className="admin-users-info-section">
              <h4>Thống kê hoạt động đặt chỗ</h4>
              <div className="admin-owners-detail-stats" style={{ marginBottom: 16 }}>
                <div className="admin-owners-detail-stat">
                  <strong>{detail.quickStats?.bookingCount ?? 0}</strong>
                  <span>Tổng đặt chỗ</span>
                </div>
                <div className="admin-owners-detail-stat">
                  <strong>{detail.spam?.bookings14d ?? detail.spam?.totalRecent ?? 0}</strong>
                  <span>14 ngày</span>
                </div>
                <div className="admin-owners-detail-stat">
                  <strong>{detail.spam?.score ?? 0}</strong>
                  <span>Điểm spam</span>
                </div>
                <div className="admin-owners-detail-stat">
                  <strong>{formatCurrency(detail.quickStats?.walletBalance)}</strong>
                  <span>Số dư ví</span>
                </div>
              </div>
              <div className="admin-owners-table-wrap">
                <table className="admin-owners-table">
                  <thead>
                    <tr>
                      <th>Mã</th>
                      <th>Bãi xe</th>
                      <th>Trạng thái</th>
                      <th>Số tiền</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.bookings || []).map((booking) => (
                      <tr key={booking.id}>
                        <td>#{booking.id}</td>
                        <td>{booking.parkingLot || "—"}</td>
                        <td>{booking.status}</td>
                        <td>{formatCurrency(booking.amount)}</td>
                        <td>{formatDateTimeVN(booking.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {activeTab === "log" ? (
            <div className="admin-users-info-section">
              <h4>Nhật ký hệ thống</h4>
              <div className="admin-users-timeline">
                {(detail.activity || []).map((item) => (
                  <div key={item.id} className="admin-users-timeline-item">
                    <strong>{item.action}</strong>
                    <span>{item.actor} · {formatDateTimeVN(item.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="admin-users-activity-panel">
          <h4>
            Lịch sử hoạt động
            <Link to="#" style={{ fontSize: 12, fontWeight: 500 }} onClick={(e) => { e.preventDefault(); setActiveTab("log"); }}>
              Xem tất cả
            </Link>
          </h4>
          <div className="admin-users-timeline">
            {(detail.activity || []).slice(0, 6).map((item) => (
              <div key={item.id} className="admin-users-timeline-item">
                <strong>{item.action}</strong>
                <span>{item.actor} · {formatDateTimeVN(item.time)}</span>
              </div>
            ))}
          </div>
          <div className="admin-users-quick-actions">
            <button type="button" onClick={() => window.location.href = `mailto:${detail.email}`}>
              Gửi email
            </button>
            {(detail.managedAreas || []).length > 0 ? (
              <button type="button" onClick={() => setActiveTab("areas")}>
                Xem khu vực quản lý
              </button>
            ) : null}
            {(detail.managedParkingLots || []).length > 0 ? (
              <button type="button" onClick={() => setActiveTab("parking")}>
                Xem bãi xe quản lý
              </button>
            ) : null}
            <button type="button" className="is-danger" onClick={handleLockToggle}>
              {detail.status === "locked" ? "Mở khóa tài khoản" : "Khóa tài khoản"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
