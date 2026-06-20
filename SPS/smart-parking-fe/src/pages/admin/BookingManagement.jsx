import { useMemo, useState } from "react";
import { SectionCard, StatusBadge, formatCurrency, formatDateTime } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";

export default function BookingManagement() {
  const { adminData, actions } = useAdminContext();
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredBookings = useMemo(() => {
    return adminData.bookings.filter((booking) => {
      const matchesStatus = statusFilter === "all" ? true : booking.status === statusFilter;
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || 
        booking.user?.toLowerCase().includes(searchLower) ||
        booking.plate?.toLowerCase().includes(searchLower) ||
        booking.parkingLot?.toLowerCase().includes(searchLower) ||
        booking.id?.toLowerCase().includes(searchLower);
      return matchesStatus && matchesSearch;
    });
  }, [adminData.bookings, statusFilter, searchQuery]);
  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Toàn bộ đặt chỗ"
        subtitle="Theo dõi đặt chỗ toàn hệ thống, xem chi tiết và hủy khi cần."
        actions={
          <div className="owner-section-actions" style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              className="owner-input"
              placeholder="Tìm kiếm (user, biển số, bãi, ID)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ minWidth: "200px" }}
            />
            <select className="owner-input owner-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ xác nhận</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="in_progress">Đang hoạt động</option>
              <option value="completed">Hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </div>
        }
      >
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Người dùng</th><th>Biển số</th><th>Bãi đỗ</th><th>Giờ vào</th><th>Giờ ra</th><th>Trạng thái</th><th>Giá</th><th>Bất thường</th><th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="owner-empty-cell">Không tìm thấy booking nào khớp bộ lọc hiện tại.</td>
                </tr>
              ) : null}
              {filteredBookings.map((booking) => (
                <tr key={booking.id}>
                  <td>{booking.user}</td>
                  <td>{booking.plate}</td>
                  <td>{booking.parkingLot}</td>
                  <td>{formatDateTime(booking.checkIn)}</td>
                  <td>{formatDateTime(booking.checkOut)}</td>
                  <td><StatusBadge status={booking.status} /></td>
                  <td>{formatCurrency(booking.amount)}</td>
                  <td>{booking.anomaly ? <StatusBadge status="warning" /> : <StatusBadge status="success" />}</td>
                  <td>
                    <div className="owner-row-actions">
                      <button type="button" className="owner-btn owner-btn--outline owner-btn--small" onClick={() => setSelectedBooking(booking)}>Chi tiết</button>
                      <button type="button" className="owner-btn owner-btn--danger owner-btn--small" onClick={() => actions.updateBookingStatus(booking.id, "cancelled")}>Hủy</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
      {selectedBooking ? (
        <div className="owner-modal-backdrop" onClick={() => setSelectedBooking(null)}>
          <div className="owner-modal owner-modal--detail" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head"><div><h2>{selectedBooking.id}</h2><p>Chi tiết booking cấp hệ thống.</p></div><button type="button" className="owner-modal-close" onClick={() => setSelectedBooking(null)}>×</button></div>
            <div className="owner-detail-grid">
              <div><span>User</span><strong>{selectedBooking.user}</strong></div>
              <div><span>Biển số</span><strong>{selectedBooking.plate}</strong></div>
              <div><span>Bãi đỗ</span><strong>{selectedBooking.parkingLot}</strong></div>
              <div><span>Trạng thái</span><strong><StatusBadge status={selectedBooking.status} /></strong></div>
              <div><span>Check-in</span><strong>{formatDateTime(selectedBooking.checkIn)}</strong></div>
              <div><span>Check-out</span><strong>{formatDateTime(selectedBooking.checkOut)}</strong></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
