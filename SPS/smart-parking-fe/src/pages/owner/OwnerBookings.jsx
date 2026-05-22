import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  MoreVertical,
  ParkingSquare,
  Search,
  WalletCards,
  XCircle,
} from "lucide-react";
import { formatCurrency, formatDateTime, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { parseVietnamDate } from "../../utils/dateTime";

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function getInitials(name) {
  const parts = String(name || "KH")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return "KH";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getCustomerAvatarTone(booking) {
  const key = normalizeSearch([
    booking.userId,
    booking.customerId,
    booking.phone,
    booking.user,
  ].filter(Boolean).join("|"));
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 5;
}

function getDurationLabel(booking) {
  const start = parseVietnamDate(booking.bookingStartTime || booking.startTime);
  const end = parseVietnamDate(booking.bookingEndTime || booking.endTime);
  if (!start || !end) {
    return "--";
  }
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (minutes < 60) {
    return `${minutes} phút`;
  }
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes ? `${hours} giờ ${remainMinutes} phút` : `${hours} giờ`;
}

function getDateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function isDateInRange(value, from, to) {
  const date = parseVietnamDate(value);
  if (!date) {
    return false;
  }
  const timestamp = date.getTime();
  if (from) {
    const fromDate = parseVietnamDate(`${from}T00:00:00`);
    if (fromDate && timestamp < fromDate.getTime()) {
      return false;
    }
  }
  if (to) {
    const toDate = parseVietnamDate(`${to}T23:59:59`);
    if (toDate && timestamp > toDate.getTime()) {
      return false;
    }
  }
  return true;
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function BookingStatCard({ icon: Icon, title, value, note, tone }) {
  return (
    <article className={`owner-management-stat owner-management-stat--${tone}`}>
      <span><Icon size={24} /></span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

export default function OwnerBookings() {
  const { ownerData, actions, isSyncing } = useOwnerContext();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("all");
  const [parkingFilter, setParkingFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const parkingOptions = useMemo(() => {
    const options = new Set();
    ownerData.parkingLots.forEach((lot) => {
      if (lot.name) {
        options.add(lot.name);
      }
    });
    ownerData.bookings.forEach((booking) => {
      if (booking.parkingLotName) {
        options.add(booking.parkingLotName);
      }
    });
    return Array.from(options).sort((left, right) => left.localeCompare(right, "vi"));
  }, [ownerData.bookings, ownerData.parkingLots]);

  const bookingStats = useMemo(() => {
    const total = ownerData.bookings.length;
    const active = ownerData.bookings.filter((booking) => (
      booking.status === "confirmed" || booking.status === "in_progress" || booking.status === "pending"
    )).length;
    const completed = ownerData.bookings.filter((booking) => booking.status === "completed").length;
    const cancelled = ownerData.bookings.filter((booking) => booking.status === "cancelled").length;
    const revenue = ownerData.bookings
      .filter((booking) => booking.status !== "cancelled")
      .reduce((sum, booking) => sum + Number(booking.price || 0), 0);

    return {
      total,
      active,
      completed,
      cancelled,
      revenue,
      activePercent: Math.round((active / Math.max(total, 1)) * 100),
      completedPercent: Math.round((completed / Math.max(total, 1)) * 100),
      cancelledPercent: Math.round((cancelled / Math.max(total, 1)) * 100),
    };
  }, [ownerData.bookings]);

  const filteredBookings = useMemo(() => {
    const search = normalizeSearch(searchQuery);

    return ownerData.bookings.filter((booking) => {
      if (statusFilter !== "all" && booking.status !== statusFilter) {
        return false;
      }
      if (parkingFilter !== "all" && booking.parkingLotName !== parkingFilter) {
        return false;
      }
      if ((dateFrom || dateTo) && !isDateInRange(booking.bookingStartTime || booking.startTime, dateFrom, dateTo)) {
        return false;
      }
      if (!search) {
        return true;
      }
      return normalizeSearch([
        booking.code,
        booking.user,
        booking.phone,
        booking.parkingLotName,
        booking.plate,
        booking.slotCode,
        booking.zone,
      ].join(" ")).includes(search);
    });
  }, [dateFrom, dateTo, ownerData.bookings, parkingFilter, searchQuery, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateFrom, dateTo, parkingFilter, searchQuery, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / itemsPerPage));
  const paginatedBookings = useMemo(() => {
    const safePage = Math.min(currentPage, totalPages);
    const startIndex = (safePage - 1) * itemsPerPage;
    return filteredBookings.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredBookings, currentPage, itemsPerPage, totalPages]);

  const handlePageChange = (page) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(Number(value));
    setCurrentPage(1);
  };

  const handleExportReport = () => {
    const headers = ["Mã đặt chỗ", "Khách hàng", "SĐT", "Bãi đỗ", "Biển số", "Bắt đầu", "Kết thúc", "Giá tiền", "Trạng thái"];
    const rows = filteredBookings.map((booking) => [
      booking.code,
      booking.user,
      booking.phone,
      booking.parkingLotName,
      booking.plate,
      formatDateTime(booking.bookingStartTime || booking.startTime),
      formatDateTime(booking.bookingEndTime || booking.endTime),
      Number(booking.price || 0),
      booking.status,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `owner-bookings-${getDateInputValue()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setSearchQuery("");
    setParkingFilter("all");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    const parkingLotId = searchParams.get("parkingId") || searchParams.get("parkingLotId");
    if (parkingLotId) {
      const lot = ownerData.parkingLots.find((item) => String(item.id) === String(parkingLotId));
      if (lot?.name) {
        setParkingFilter(lot.name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerData.parkingLots, searchParams]);

  return (
    <div className="owner-management-page owner-bookings-page">
      <div className="owner-booking-actionbar">
        <button type="button" className="owner-management-secondary" onClick={handleExportReport}>
          <Download size={18} />
          Xuất báo cáo
        </button>
      </div>

      <div className="owner-management-stats">
        <BookingStatCard icon={CalendarCheck} title="Tổng đặt chỗ" value={bookingStats.total} note="Theo dữ liệu hiện tại" tone="blue" />
        <BookingStatCard icon={Clock} title="Đang sử dụng" value={bookingStats.active} note={`${bookingStats.activePercent}% tổng số`} tone="sky" />
        <BookingStatCard icon={CheckCircle2} title="Đã hoàn thành" value={bookingStats.completed} note={`${bookingStats.completedPercent}% tổng số`} tone="green" />
        <BookingStatCard icon={XCircle} title="Đã hủy" value={bookingStats.cancelled} note={`${bookingStats.cancelledPercent}% tổng số`} tone="orange" />
        <BookingStatCard icon={WalletCards} title="Doanh thu từ đặt chỗ" value={formatCurrency(bookingStats.revenue)} note="Không tính đơn đã hủy" tone="pink" />
      </div>

      <section className="owner-management-panel owner-booking-panel">
        <div className="owner-booking-filterbar">
          <label className="owner-management-search owner-booking-search">
            <Search size={18} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Tìm theo mã, biển số, khách hàng..."
            />
          </label>
          <select className="owner-management-select" value={parkingFilter} onChange={(event) => setParkingFilter(event.target.value)}>
            <option value="all">Tất cả bãi đỗ</option>
            {parkingOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select className="owner-management-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Chờ xác nhận</option>
            <option value="confirmed">Đã xác nhận</option>
            <option value="in_progress">Đang sử dụng</option>
            <option value="completed">Đã hoàn thành</option>
            <option value="cancelled">Đã hủy</option>
          </select>
          <label className="owner-booking-date-range">
            <CalendarDays size={17} />
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Từ ngày" />
            <span>-</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Đến ngày" />
          </label>
          <button type="button" className="owner-management-secondary owner-booking-filter" onClick={resetFilters}>
            Xóa lọc
            <Filter size={17} />
          </button>
        </div>

        {isSyncing ? <p className="owner-empty">Đang đồng bộ booking từ CSDL...</p> : null}

        <div className="owner-booking-table-shell">
          <table className="owner-booking-table">
            <thead>
              <tr>
                <th>Mã đặt chỗ</th>
                <th>Khách hàng</th>
                <th>Bãi đỗ</th>
                <th>Biển số xe</th>
                <th>Thời gian</th>
                <th>Giá tiền</th>
                <th>Trạng thái</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {!isSyncing && filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="owner-empty-cell">Chưa có booking nào khớp bộ lọc hiện tại.</td>
                </tr>
              ) : null}
              {paginatedBookings.map((booking) => (
                <tr key={booking.id}>
                  <td>
                    <div className="owner-booking-code">
                      <strong>{booking.code}</strong>
                      <span>{formatDateTime(booking.bookingStartTime || booking.startTime)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="owner-booking-customer">
                      <span className={`owner-booking-avatar owner-booking-avatar--${getCustomerAvatarTone(booking)}`}>{getInitials(booking.user)}</span>
                      <div>
                        <strong>{booking.user || "Khách hàng"}</strong>
                        <small>{booking.phone || "Chưa có SĐT"}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="owner-booking-lot">
                      <span><ParkingSquare size={15} /></span>
                      <div>
                        <strong>{booking.parkingLotName || "Chưa có bãi"}</strong>
                        <small>{booking.zone || booking.slotCode || "Chưa có vị trí"}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="owner-booking-plate">
                      <strong>{booking.plate}</strong>
                      <span>{booking.vehicleModel || "Ô tô"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="owner-booking-time">
                      <span>{formatDateTime(booking.bookingStartTime || booking.startTime)}</span>
                      <i />
                      <span>{formatDateTime(booking.bookingEndTime || booking.endTime)}</span>
                      <small>{getDurationLabel(booking)}</small>
                    </div>
                  </td>
                  <td className="owner-booking-price">{formatCurrency(booking.price)}</td>
                  <td><StatusBadge status={booking.status} /></td>
                  <td>
                    <div className="owner-booking-row-actions">
                      {booking.status === "pending" ? (
                        <button type="button" onClick={() => actions.updateBookingStatus(booking.id, "confirmed")}>Xác nhận</button>
                      ) : null}
                      {booking.status !== "cancelled" && booking.status !== "completed" ? (
                        <button type="button" className="is-danger" onClick={() => actions.updateBookingStatus(booking.id, "cancelled")}>Hủy</button>
                      ) : null}
                      <button type="button" onClick={() => setSelectedBooking(booking)}>Chi tiết</button>
                      <button type="button" className="owner-booking-more" onClick={() => setSelectedBooking({ ...booking, supportMode: true })} aria-label="Hỗ trợ nhanh">
                        <MoreVertical size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredBookings.length > 0 ? (
          <div className="owner-management-pagination">
            <span>Hiển thị 1 - {paginatedBookings.length} trong tổng số {filteredBookings.length} đặt chỗ</span>
            <div>
              <select className="owner-management-select owner-management-select--small" value={itemsPerPage} onChange={(event) => handleItemsPerPageChange(event.target.value)}>
                <option value={5}>5 / trang</option>
                <option value={10}>10 / trang</option>
                <option value={25}>25 / trang</option>
              </select>
              <button type="button" className="owner-management-icon-button" disabled={currentPage === 1} onClick={() => handlePageChange(currentPage - 1)}>‹</button>
              <button type="button" className="owner-management-page-button is-active">{currentPage}</button>
              <button type="button" className="owner-management-icon-button" disabled={currentPage === totalPages} onClick={() => handlePageChange(currentPage + 1)}>›</button>
            </div>
          </div>
        ) : null}

      </section>

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
