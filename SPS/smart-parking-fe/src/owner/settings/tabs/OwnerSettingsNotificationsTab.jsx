import { useMemo } from "react";
import { Link } from "react-router-dom";
import { SettingsPanel } from "../OwnerSettingsShared";
import { useOwnerContext } from "../../useOwnerContext";
import { formatDateTime, StatusBadge } from "../../OwnerUI";

function buildRecentNotifications(ownerData) {
  const rows = [];
  (ownerData.bookings || []).slice(0, 10).forEach((booking) => {
    rows.push({
      id: `booking-${booking.id}`,
      time: booking.bookingStartTime || booking.startTime,
      type: "Đặt chỗ",
      content: `Đặt chỗ ${booking.code} tại ${booking.parkingLotName || "bãi"}`,
      status: booking.status === "pending" ? "pending" : "success",
    });
  });
  (ownerData.activities || []).slice(0, 8).forEach((activity) => {
    rows.push({
      id: activity.id,
      time: activity.time,
      type: activity.type === "warning" ? "Cảnh báo" : "Hệ thống",
      content: activity.message || activity.title,
      status: activity.type === "warning" ? "warning" : "success",
    });
  });
  return rows.filter((r) => r.time).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);
}

export default function OwnerSettingsNotificationsTab() {
  const { ownerData } = useOwnerContext();
  const recent = useMemo(() => buildRecentNotifications(ownerData), [ownerData]);

  return (
    <SettingsPanel
      title="Lịch sử thông báo gần đây"
      subtitle="Dữ liệu từ booking và hoạt động trên CSDL. Cấu hình gửi thông báo nằm tại tab Cấu hình đặt chỗ & ra/vào."
      actions={(
        <Link to="/owner/notifications" className="owner-management-secondary" style={{ textDecoration: "none", padding: "8px 14px" }}>
          Xem tất cả
        </Link>
      )}
    >
      <div className="owner-table-shell">
        <table className="owner-table owner-designed-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Loại</th>
              <th>Nội dung</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((row) => (
              <tr key={row.id}>
                <td>{formatDateTime(row.time)}</td>
                <td>{row.type}</td>
                <td>{row.content}</td>
                <td><StatusBadge status={row.status} /></td>
              </tr>
            ))}
            {recent.length === 0 ? (
              <tr><td colSpan={4} className="owner-empty-cell">Chưa có thông báo gần đây.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SettingsPanel>
  );
}
