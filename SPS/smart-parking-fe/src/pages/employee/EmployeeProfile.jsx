import { useEffect, useState } from "react";

import { updateEmployeeParkingStatus } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";

const STATUS_LABEL = {
  open: "Mở bãi",
  closed: "Đóng bãi",
  full: "Đầy chỗ",
  locked: "Bãi bị khóa",
};

export default function EmployeeProfile() {
  const context = useEmployeeContext() || {};
  const { profile, slotsOverview, refreshEmployee } = context;
  const [statusValue, setStatusValue] = useState(profile?.parking_lot?.status || "open");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatusValue(profile?.parking_lot?.status || "open");
  }, [profile?.parking_lot?.status]);

  const handleUpdateStatus = async () => {
    setSaving(true);
    try {
      await updateEmployeeParkingStatus({ status: statusValue });
      await refreshEmployee();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="employee-workspace-page employee-profile-page">
      <div className="employee-profile-layout">
        <article className="employee-modern-card employee-section-shell">
          <div className="employee-section-headline">
            <h2>Hồ sơ tài khoản nhân viên</h2>
            <span className="employee-chip">Quyền hạn: vận hành bãi</span>
          </div>

          <div className="employee-profile-grid">
            <p><strong>Tên đăng nhập:</strong> {profile?.employee?.username || "--"}</p>
            <p><strong>Mã owner quản lý:</strong> {profile?.employee?.owner_id || "--"}</p>
            <p><strong>Mã bãi được gán:</strong> {profile?.employee?.parking_id || "--"}</p>
            <p><strong>Trạng thái tài khoản:</strong> {profile?.employee?.status || "--"}</p>
          </div>
        </article>

        <article className="employee-modern-card employee-section-shell">
          <div className="employee-section-headline">
            <h2>Thông tin bãi phụ trách</h2>
            <span className="employee-chip">{STATUS_LABEL[profile?.parking_lot?.status] || "Mở bãi"}</span>
          </div>

          <div className="employee-profile-grid">
            <p><strong>Tên bãi:</strong> {profile?.parking_lot?.parking_name || "--"}</p>
            <p><strong>Địa chỉ:</strong> {profile?.parking_lot?.address || "--"}</p>
            <p><strong>Tổng chỗ:</strong> {slotsOverview?.total_slots || profile?.parking_lot?.totalSlots || 0}</p>
            <p><strong>Đang sử dụng:</strong> {(slotsOverview?.in_use_slots || 0) + (slotsOverview?.reserved_slots || 0)}</p>
            <p><strong>Chỗ trống:</strong> {slotsOverview?.available_slots || profile?.parking_lot?.emptySlots || 0}</p>
          </div>

          <div className="employee-action-row employee-status-control">
            <select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
              <option value="open">{STATUS_LABEL.open}</option>
              <option value="closed">{STATUS_LABEL.closed}</option>
              <option value="full">{STATUS_LABEL.full}</option>
            </select>
            <button
              type="button"
              className="employee-btn"
              onClick={handleUpdateStatus}
              disabled={saving || profile?.parking_lot?.status === "locked"}
            >
              {saving ? "Đang lưu..." : "Cập nhật trạng thái bãi"}
            </button>
          </div>
          {profile?.parking_lot?.status === "locked" ? (
            <p className="employee-note">Bãi đang bị admin khóa. Chỉ admin mới có thể mở lại bãi.</p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
