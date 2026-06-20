import { useCallback, useEffect, useState } from "react";
import { Eye, CheckCircle, Check, MessageSquare, Clock, User, Phone, Mail, MapPin, Pencil, X, Lock, KeyRound, Car, Users, Map, UserRound, MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatCurrency } from "../../owner/OwnerUI";
import API from "../../services/api";
import { formatDateTimeVN } from "../../utils/dateTime";
import "./AdminOwners.css";
import "./AdminUsers.css";

const STATUS_LABELS = {
  active: "Hoạt động",
  locked: "Tạm khóa",
};

function trendClass(value) {
  return Number(value) >= 0 ? "is-up" : "is-down";
}

function formatTrend(value) {
  const num = Number(value || 0);
  if (num > 0) return `+${num} người mới`;
  if (num < 0) return `${num} người`;
  return "0 thay đổi";
}

export default function UserManagement() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [createdSort, setCreatedSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        createdSort,
      });
      if (search.trim()) params.append("search", search.trim());
      if (roleFilter !== "all") params.append("role", roleFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (districtFilter !== "all") params.append("districtId", districtFilter);

      const response = await API.get(`/admin/users/management?${params.toString()}`);
      setData(response.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, roleFilter, statusFilter, districtFilter, createdSort]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const loadDetail = useCallback(async (userId) => {
    if (!userId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const response = await API.get(`/admin/users/${userId}/detail`);
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

  const handleSelectUser = (user) => {
    setSelectedId(user.id);
  };

  const closeDetailPanel = () => {
    setSelectedId(null);
    setDetail(null);
  };

  const handleLockToggle = async () => {
    if (!selectedId || !detail) return;
    const nextStatus = detail.status === "locked" ? "active" : "banned";
    try {
      await API.patch(`/admin/users/${selectedId}/status`, { status: nextStatus });
      await loadUsers();
      await loadDetail(selectedId);
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể cập nhật trạng thái");
    }
  };

  const handleResetPassword = async () => {
    if (!selectedId) return;
    try {
      const res = await API.post(`/admin/users/${selectedId}/reset-password`);
      window.alert(`Mật khẩu tạm: ${res.data.temporary_password}`);
    } catch (error) {
      window.alert(error?.response?.data?.detail || "Không thể đặt lại mật khẩu");
    }
  };

  const summary = data?.summary || {};
  const trends = summary.trends || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };

  if (loading && !data) {
    return <div className="admin-owners-loading">Đang tải danh sách người dùng...</div>;
  }

  return (
    <div className="admin-users-page admin-owners-page">
      <p className="admin-users-breadcrumb">Người dùng &gt; Danh sách người dùng</p>

      <div className="admin-owners-kpis">
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--blue">
            <Users size={24} />
          </div>
          <div>
            <span>Tổng người dùng</span>
            <strong>{summary.totalUsers || 0}</strong>
            <small className={trendClass(trends.totalUsersChange)}>
              {formatTrend(trends.totalUsersChange)} tháng trước
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--green">
            <Map size={24} />
          </div>
          <div>
            <span>Quản lý khu vực</span>
            <strong>{summary.areaManagers || 0}</strong>
            <small className={trendClass(trends.areaManagersChange)}>
              {formatTrend(trends.areaManagersChange)}
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--amber">
            <Car size={24} />
          </div>
          <div>
            <span>Tài khoản bãi</span>
            <strong>{summary.parkingAccounts || 0}</strong>
            <small className={trendClass(trends.parkingAccountsChange)}>
              {formatTrend(trends.parkingAccountsChange)}
            </small>
          </div>
        </article>
        <article className="admin-owners-kpi">
          <div className="admin-owners-kpi-icon admin-owners-kpi-icon--purple">
            <UserRound size={24} />
          </div>
          <div>
            <span>Người dùng</span>
            <strong>{summary.endUsers || 0}</strong>
            <small className={trendClass(trends.endUsersChange)}>
              {formatTrend(trends.endUsersChange)}
            </small>
          </div>
        </article>
      </div>

      <div className="admin-owners-toolbar">
        <div className="admin-owners-filters">
          <input
            type="search"
            placeholder="Tìm kiếm theo tên, email, SĐT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                loadUsers();
              }
            }}
          />
          <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
            <option value="all">Vai trò</option>
            <option value="area_manager">Quản lý khu vực</option>
            <option value="parking_account">Tài khoản bãi</option>
            <option value="end_user">Người dùng</option>
          </select>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="all">Trạng thái</option>
            <option value="active">Hoạt động</option>
            <option value="locked">Tạm khóa</option>
          </select>
          <select value={districtFilter} onChange={(e) => { setDistrictFilter(e.target.value); setPage(1); }}>
            <option value="all">Khu vực</option>
            {(data?.districts || []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select value={createdSort} onChange={(e) => { setCreatedSort(e.target.value); setPage(1); }}>
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
          </select>
        </div>
        <div className="admin-owners-toolbar-actions">
          <button type="button" className="admin-owners-btn" onClick={() => { setPage(1); loadUsers(); }}>
            Áp dụng
          </button>
          <button type="button" className="admin-owners-btn admin-owners-btn--primary" onClick={() => navigate("/admin/users/new")}>
            + Thêm người dùng
          </button>
        </div>
      </div>

      <div className={`admin-owners-layout${selectedId ? " has-detail" : ""}`}>
        <div className="admin-owners-table-card">
          <div className="admin-owners-table-wrap">
            <table className="admin-owners-table">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Vai trò</th>
                  <th>Khu vực / Bãi xe</th>
                  <th>Email / SĐT</th>
                  <th className="admin-owners-status-head">Trạng thái</th>
                  <th>Ngày tạo</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.map((user) => (
                  <tr
                    key={user.id}
                    className={selectedId === user.id ? "is-selected" : ""}
                    onClick={() => handleSelectUser(user)}
                  >
                    <td>
                      <div className="admin-users-user-cell">
                        <div className="admin-users-mini-avatar">{user.initials}</div>
                        <div>
                          <strong>{user.name}</strong>
                          <small>{user.username}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`admin-users-role-tag admin-users-role-tag--${user.roleKey}`}>
                        {user.roleLabel}
                      </span>
                    </td>
                    <td>
                      <div>{user.areaLabel}</div>
                      <small style={{ color: "#64748b" }}>{user.parkingLabel}</small>
                    </td>
                    <td>
                      <div>{user.email}</div>
                      <small style={{ color: "#64748b" }}>{user.phone || "—"}</small>
                    </td>
                    <td className="admin-owners-status-cell">
                      <span className={`admin-owners-status admin-owners-status--${user.status === "active" ? "active" : "locked"}`}>
                        {STATUS_LABELS[user.status] || user.statusLabel}
                      </span>
                    </td>
                    <td>{formatDateTimeVN(user.createdAt)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="admin-owners-row-actions">
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Xem"
                          onClick={() => handleSelectUser(user)}
                        >
                          <Eye size={18} />
                        </button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Chi tiết"
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                        >
                          <Pencil size={18} />
                        </button>
                        <button
                          type="button"
                          className="admin-owners-icon-btn"
                          title="Mở trang chi tiết"
                          onClick={() => navigate(`/admin/users/${user.id}`)}
                        >
                          <MoreHorizontal size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7}>Không có người dùng phù hợp bộ lọc.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-owners-pagination">
            <span>
              Hiển thị {(pagination.page - 1) * pagination.pageSize + 1} đến{" "}
              {Math.min(pagination.page * pagination.pageSize, pagination.total)} của {pagination.total} người dùng
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
          <aside className="admin-owners-detail">
            <button
              type="button"
              className="admin-owners-detail-close"
              onClick={closeDetailPanel}
              aria-label="Đóng chi tiết"
            >
              <X size={18} />
            </button>
            {detailLoading || !detail ? (
              <p>Đang tải chi tiết...</p>
            ) : (
              <>
                <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Chi tiết người dùng</h3>
                <div className="admin-owners-detail-head">
                  <div className="admin-users-detail-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
                    {detail.initials}
                  </div>
                  <div>
                    <strong>{detail.name}</strong>
                    <div style={{ marginTop: 6 }}>
                      <span className={`admin-owners-status admin-owners-status--${detail.status === "active" ? "active" : "locked"}`}>
                        {detail.statusLabel}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="admin-owners-detail-meta">
                  <div><strong>Vai trò:</strong> {detail.roleLabel}</div>
                  <div><strong>Khu vực:</strong> {detail.location || "—"}</div>
                  <div><Mail size={14} /> {detail.email}</div>
                  <div><Phone size={14} /> {detail.phone || "—"}</div>
                  <div><strong>Ngày tạo:</strong> {formatDateTimeVN(detail.createdAt)}</div>
                  <div><strong>Cập nhật:</strong> {formatDateTimeVN(detail.updatedAt)}</div>
                </div>

                <div className="admin-owners-detail-section">
                  <h4>Thống kê nhanh</h4>
                  <div className="admin-owners-detail-stats">
                    <div className="admin-owners-detail-stat">
                      <strong>{detail.quickStats?.managedParkingLots ?? 0}</strong>
                      <span>Bãi quản lý</span>
                    </div>
                    <div className="admin-owners-detail-stat">
                      <strong>{detail.quickStats?.parkingAccounts ?? 0}</strong>
                      <span>Tài khoản bãi</span>
                    </div>
                    <div className="admin-owners-detail-stat">
                      <strong>{formatCurrency(detail.quickStats?.monthlyRevenue)}</strong>
                      <span>Doanh thu tháng</span>
                    </div>
                  </div>
                </div>

                <div className="admin-owners-detail-section">
                  <h4>Quyền truy cập</h4>
                  <div className="admin-users-permissions">
                    {(detail.permissions || []).map((perm) => (
                      <div key={perm.key} className="admin-users-permission-row">
                        <span>{perm.label}</span>
                        <span className={perm.allowed ? "ok" : "no"}>
                          {perm.allowed ? <CheckCircle size={16} /> : <X size={16} />}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="admin-owners-detail-actions">
                  <button type="button" className="admin-owners-btn" onClick={() => navigate(`/admin/users/${detail.id}`)}>
                    Chỉnh sửa
                  </button>
                  <button type="button" className="admin-owners-btn admin-users-btn-password" onClick={handleResetPassword}>
                    Đổi mật khẩu
                  </button>
                  <button type="button" className="admin-owners-btn admin-owners-btn--danger" onClick={handleLockToggle}>
                    {detail.status === "locked" ? "Mở khóa tài khoản" : "Tạm khóa tài khoản"}
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
