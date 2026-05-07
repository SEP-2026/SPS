import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { formatCurrency, formatDateTime, SectionCard, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";

export default function OwnerBookings() {
  const { ownerData, actions, isSyncing } = useOwnerContext();
  const [statusFilter, setStatusFilter] = useState("all");
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [viewMode, setViewMode] = useState("row");
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const rowLimitOptions = [5, 10, 25];
  const viewOptions = [
    { value: "row", label: "Hiện ngang" },
    { value: "card", label: "Từng ô" },
  ];

  const filteredBookings = useMemo(() => ownerData.bookings.filter((booking) => (
    statusFilter === "all" ? true : booking.status === statusFilter
  )), [ownerData.bookings, statusFilter]);

  const totalPages = Math.ceil(filteredBookings.length / itemsPerPage);
  const paginatedBookings = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredBookings.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredBookings, currentPage, itemsPerPage]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(Number(value));
    setCurrentPage(1);
  };

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Danh sách đơn đặt chỗ"
        subtitle="Theo dõi booking của bãi và hỗ trợ khách khi phát sinh sự cố như quên điện thoại."
        actions={
          <div className="owner-actions-row">
            <select className="owner-input owner-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="pending">Chờ xác nhận</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="in_progress">Đang hoạt động</option>
              <option value="completed">Hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
            </select>
            <select className="owner-input owner-select" value={itemsPerPage} onChange={(event) => handleItemsPerPageChange(event.target.value)}>
              <option value={5}>5 / trang</option>
              <option value={10}>10 / trang</option>
              <option value={25}>25 / trang</option>
            </select>
          </div>
        }
      >
        {isSyncing ? <p className="owner-empty">Đang đồng bộ booking từ CSDL...</p> : null}
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Bãi đỗ</th>
                <th>Người dùng</th>
                <th>Biển số</th>
                <th>Thời gian vào</th>
                <th>Thời gian ra</th>
                <th>Giờ booking</th>
                <th>Giá tiền</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {!isSyncing && filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={10} className="owner-empty-cell">Chưa có booking nào khớp bộ lọc hiện tại.</td>
                </tr>
              ) : null}
              {paginatedBookings.map((booking) => (
                <tr key={booking.id}>
                  <td>{booking.code}</td>
                  <td>{booking.parkingLotName || "Chưa có bãi"}</td>
                  <td>{booking.user}</td>
                  <td>{booking.plate}</td>
                  <td>{formatDateTime(booking.startTime)}</td>
                  <td>{formatDateTime(booking.endTime)}</td>
                  <td>
                    {formatDateTime(booking.bookingStartTime)}
                    <br />
                    {formatDateTime(booking.bookingEndTime)}
                  </td>
                  <td>{formatCurrency(booking.price)}</td>
                  <td><StatusBadge status={booking.status} /></td>
                  <td>
                    <div className="owner-row-actions">
                      {booking.status === "pending" ? (
                        <button type="button" className="btn-primary owner-btn owner-btn--small" onClick={() => actions.updateBookingStatus(booking.id, "confirmed")}>Xác nhận</button>
                      ) : null}
                      {booking.status !== "cancelled" && booking.status !== "completed" ? (
                        <button type="button" className="btn-secondary owner-btn owner-btn--small owner-btn--danger" onClick={() => actions.updateBookingStatus(booking.id, "cancelled")}>Hủy</button>
                      ) : null}
                      <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => setSelectedBooking({ ...booking, supportMode: true })}>Hỗ trợ khách</button>
                      <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => setSelectedBooking(booking)}>Chi tiết</button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredBookings.length > 0 && (
          <div className="owner-pagination">
            <button
              type="button"
              className="btn-secondary owner-btn owner-btn--small"
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
            >
              ← Trang trước
            </button>
            <div className="owner-pagination-info">
              Trang {currentPage} / {totalPages} ({filteredBookings.length} kết quả)
            </div>
            <button
              type="button"
              className="btn-secondary owner-btn owner-btn--small"
              disabled={currentPage === totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
            >
              Trang sau →
            </button>
          </div>
        )}
      </SectionCard>

      {selectedBooking ? createPortal(
        <div className="owner-modal-backdrop" onClick={() => setSelectedBooking(null)}>
          <div className="owner-modal owner-modal--detail" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{selectedBooking.code}</h2>
                <p>Thông tin chi tiết booking dành cho vận hành bãi đỗ.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={() => setSelectedBooking(null)}>×</button>
            </div>
            <div className="owner-detail-grid">
              <div><span>Bãi đỗ</span><strong>{selectedBooking.parkingLotName || "Chưa có bãi"}</strong></div>
              <div><span>Khách hàng</span><strong>{selectedBooking.user}</strong></div>
              <div><span>Số điện thoại</span><strong>{selectedBooking.phone}</strong></div>
              <div><span>Biển số</span><strong>{selectedBooking.plate}</strong></div>
              <div><span>Chỗ đỗ</span><strong>{selectedBooking.slotCode} • {selectedBooking.zone}</strong></div>
              <div><span>Giờ vào thực tế</span><strong>{formatDateTime(selectedBooking.startTime)}</strong></div>
              <div><span>Giờ ra thực tế</span><strong>{formatDateTime(selectedBooking.endTime)}</strong></div>
              <div><span>Giờ booking</span><strong>{formatDateTime(selectedBooking.bookingStartTime)}</strong></div>
              <div><span>Giờ kết thúc booking</span><strong>{formatDateTime(selectedBooking.bookingEndTime)}</strong></div>
              <div><span>Giá tiền</span><strong>{formatCurrency(selectedBooking.price)}</strong></div>
              <div><span>Trạng thái</span><strong><StatusBadge status={selectedBooking.status} /></strong></div>
            </div>
            {selectedBooking.supportMode ? (
              <div className="owner-support-box">
                <strong>Hướng hỗ trợ nhanh</strong>
                <p>Xác minh biển số, số điện thoại và mã booking trước khi hỗ trợ khách vào hoặc ra bãi thay cho điện thoại.</p>
              </div>
            ) : null}
          </div>
        </div>
      , document.body) : null}
    </div>
  );
}
