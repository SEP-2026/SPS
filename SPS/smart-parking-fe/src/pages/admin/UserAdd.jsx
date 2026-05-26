import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../../services/api";
import "./AdminOwners.css";
import "./AdminUsers.css";

const EMPTY_FORM = {
  name: "",
  email: "",
  phone: "",
  password: "",
  role: "end_user",
  status: "active",
  managedDistrictId: "",
  ownerId: "",
  parkingId: "",
  vehiclePlate: "",
  vehicleColor: "",
};

export default function UserAdd() {
  const navigate = useNavigate();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadOptions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await API.get("/admin/users/form-options");
      setOptions(response.data);
    } catch {
      setOptions(null);
      setError("Không tải được dữ liệu form. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const availableParkingLots = useMemo(() => {
    const lots = options?.parkingLots || [];
    if (form.role === "area_manager") {
      return lots.filter((lot) => !lot.hasOwner);
    }
    if (form.role === "parking_account") {
      if (!form.ownerId) return [];
      const owner = (options?.owners || []).find((item) => String(item.id) === String(form.ownerId));
      const allowedIds = new Set(owner?.parkingIds || []);
      return lots.filter((lot) => !lot.hasEmployee && allowedIds.has(lot.id));
    }
    return lots;
  }, [form.role, form.ownerId, options]);

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "role") {
        next.managedDistrictId = "";
        next.ownerId = "";
        next.parkingId = "";
      }
      if (field === "ownerId") {
        next.parkingId = "";
      }
      return next;
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.name.trim() || !form.email.trim()) {
      setError("Vui lòng nhập họ tên và email.");
      return;
    }
    if (form.role === "parking_account" && !form.phone.trim()) {
      setError("Tài khoản bãi cần số điện thoại.");
      return;
    }
    if (form.role === "parking_account" && (!form.ownerId || !form.parkingId)) {
      setError("Vui lòng chọn quản lý khu vực và bãi xe.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        role: form.role,
        status: form.status,
        vehiclePlate: form.vehiclePlate.trim() || null,
        vehicleColor: form.vehicleColor.trim() || null,
      };
      if (form.password.trim()) {
        payload.password = form.password.trim();
      }
      if (form.role === "area_manager" && form.managedDistrictId) {
        payload.managedDistrictId = Number(form.managedDistrictId);
      }
      if (form.role === "area_manager" && form.parkingId) {
        payload.parkingId = Number(form.parkingId);
      }
      if (form.role === "parking_account") {
        payload.ownerId = Number(form.ownerId);
        payload.parkingId = Number(form.parkingId);
      }

      const response = await API.post("/admin/users", payload);
      const created = response.data?.user;
      const tempPassword = response.data?.temporary_password;
      window.alert(
        `Đã tạo tài khoản thành công.\nMật khẩu đăng nhập: ${tempPassword}`,
      );
      navigate(created?.id ? `/admin/users/${created.id}` : "/admin/users");
    } catch (err) {
      setError(err?.response?.data?.detail || "Không thể tạo người dùng. Vui lòng kiểm tra lại thông tin.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="admin-owners-loading">Đang tải form thêm người dùng...</div>;
  }

  return (
    <div className="admin-users-page">
      <p className="admin-users-breadcrumb">
        <Link to="/admin/users">Người dùng</Link>
        {" > "}
        <span>Thêm người dùng</span>
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>Thêm người dùng</h2>
          <p style={{ margin: "6px 0 0", color: "#64748b" }}>Tạo tài khoản mới trên hệ thống (người dùng, quản lý khu vực, tài khoản bãi).</p>
        </div>
        <button type="button" className="admin-owners-btn" onClick={() => navigate("/admin/users")}>
          ← Quay lại danh sách
        </button>
      </div>

      <div className="admin-owners-table-card" style={{ padding: 20, maxWidth: 880 }}>
        {error ? (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontSize: 14 }}>
            {error}
          </div>
        ) : null}

        <form className="owner-form-grid" onSubmit={handleSubmit}>
          <label>
            Họ và tên *
            <input
              className="owner-input"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Nguyễn Văn Tâm"
              required
            />
          </label>

          <label>
            Email đăng nhập *
            <input
              className="owner-input"
              type="email"
              value={form.email}
              onChange={(e) => handleChange("email", e.target.value)}
              placeholder="tam.nguyen@gmail.com"
              required
            />
          </label>

          <label>
            Số điện thoại
            <input
              className="owner-input"
              value={form.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
              placeholder="0987 654 321"
            />
          </label>

          <label>
            Vai trò *
            <select className="owner-input owner-select" value={form.role} onChange={(e) => handleChange("role", e.target.value)}>
              {(options?.roles || []).map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </label>

          <label>
            Mật khẩu
            <input
              className="owner-input"
              type="password"
              value={form.password}
              onChange={(e) => handleChange("password", e.target.value)}
              placeholder="Để trống = hệ thống tự tạo"
            />
          </label>

          <label>
            Trạng thái
            <select className="owner-input owner-select" value={form.status} onChange={(e) => handleChange("status", e.target.value)}>
              <option value="active">Hoạt động</option>
              <option value="suspended">Tạm khóa</option>
            </select>
          </label>

          {form.role === "area_manager" ? (
            <>
              <label>
                Khu vực quản lý
                <select
                  className="owner-input owner-select"
                  value={form.managedDistrictId}
                  onChange={(e) => handleChange("managedDistrictId", e.target.value)}
                >
                  <option value="">— Chọn khu vực —</option>
                  {(options?.districts || []).map((district) => (
                    <option key={district.id} value={district.id}>{district.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Bãi xe gán (tùy chọn)
                <select
                  className="owner-input owner-select"
                  value={form.parkingId}
                  onChange={(e) => handleChange("parkingId", e.target.value)}
                >
                  <option value="">— Chưa gán —</option>
                  {availableParkingLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>{lot.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {form.role === "parking_account" ? (
            <>
              <label>
                Quản lý khu vực (chủ bãi) *
                <select
                  className="owner-input owner-select"
                  value={form.ownerId}
                  onChange={(e) => handleChange("ownerId", e.target.value)}
                  required
                >
                  <option value="">— Chọn quản lý —</option>
                  {(options?.owners || []).map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.name} ({owner.email})</option>
                  ))}
                </select>
              </label>
              <label>
                Bãi xe *
                <select
                  className="owner-input owner-select"
                  value={form.parkingId}
                  onChange={(e) => handleChange("parkingId", e.target.value)}
                  required
                  disabled={!form.ownerId}
                >
                  <option value="">— Chọn bãi xe —</option>
                  {availableParkingLots.map((lot) => (
                    <option key={lot.id} value={lot.id}>{lot.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          {form.role === "end_user" ? (
            <>
              <label>
                Biển số xe
                <input
                  className="owner-input"
                  value={form.vehiclePlate}
                  onChange={(e) => handleChange("vehiclePlate", e.target.value)}
                  placeholder="51K-123.45"
                />
              </label>
              <label>
                Màu xe
                <input
                  className="owner-input"
                  value={form.vehicleColor}
                  onChange={(e) => handleChange("vehicleColor", e.target.value)}
                  placeholder="Đen"
                />
              </label>
            </>
          ) : null}

          <div className="owner-modal-actions owner-form-span">
            <button type="button" className="btn-secondary owner-btn" onClick={() => navigate("/admin/users")} disabled={submitting}>
              Hủy
            </button>
            <button type="submit" className="btn-primary owner-btn admin-users-btn-edit" disabled={submitting}>
              {submitting ? "Đang tạo..." : "Tạo tài khoản"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
