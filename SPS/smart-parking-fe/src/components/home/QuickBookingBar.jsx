import { memo, useId, useMemo } from "react";
import { ArrowLeftRight, CalendarClock, MapPin, Search } from "lucide-react";

function formatQuickTimeLabel(value) {
  if (!value) {
    return "Chọn thời gian";
  }

  const selectedDate = new Date(value);
  if (Number.isNaN(selectedDate.getTime())) {
    return "Chọn thời gian";
  }

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfSelected = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
  );

  const timeLabel = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(selectedDate);

  if (startOfSelected.getTime() === startOfToday.getTime()) {
    return `Hôm nay, ${timeLabel}`;
  }

  if (startOfSelected.getTime() === startOfTomorrow.getTime()) {
    return `Ngày mai, ${timeLabel}`;
  }

  const dateLabel = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(selectedDate);

  return `${dateLabel}, ${timeLabel}`;
}

const LocationDisplay = memo(function LocationDisplay({ value, isLoading }) {
  return (
    <div className="quick-booking-segment" role="group" aria-label="Vị trí hiện tại">
      <MapPin className="quick-booking-icon" size={20} aria-hidden="true" />
      <div className="quick-booking-text">
        <span className="quick-booking-label">Vị trí của bạn</span>
        <strong>{isLoading ? "Đang xác định vị trí" : value}</strong>
      </div>
    </div>
  );
});

const DateTimeDisplay = memo(function DateTimeDisplay({ value, onChange, disabled }) {
  const inputId = useId();

  return (
    <label className="quick-booking-segment quick-booking-segment--datetime" htmlFor={inputId}>
      <CalendarClock className="quick-booking-icon" size={20} aria-hidden="true" />
      <div className="quick-booking-text">
        <span className="quick-booking-label">Thời gian</span>
        <strong>{formatQuickTimeLabel(value)}</strong>
      </div>
      <input
        id={inputId}
        type="datetime-local"
        className="quick-booking-hidden-input"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        disabled={disabled}
        aria-label="Chọn thời gian đặt chỗ"
      />
    </label>
  );
});

const BookingSearchButton = memo(function BookingSearchButton({ onClick, disabled }) {
  return (
    <button
      type="button"
      className="quick-booking-search-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label="Tìm bãi xe với thời gian đã chọn"
    >
      <Search size={18} aria-hidden="true" />
      <span>Tìm bãi xe</span>
    </button>
  );
});

function QuickBookingBar({
  locationValue,
  isLocationLoading,
  dateTimeValue,
  onDateTimeChange,
  onRefreshLocation,
  onSearch,
  disabled,
}) {
  const safeLocationValue = useMemo(
    () => (locationValue && locationValue.trim() ? locationValue : "Chưa xác định vị trí"),
    [locationValue],
  );

  return (
    <div className="quick-booking-bar" role="search" aria-label="Tìm nhanh bãi xe">
      <LocationDisplay value={safeLocationValue} isLoading={isLocationLoading} />

      <button
        type="button"
        className="quick-booking-swap"
        onClick={onRefreshLocation}
        disabled={disabled}
        aria-label="Lấy lại vị trí hiện tại"
      >
        <ArrowLeftRight size={18} aria-hidden="true" />
      </button>

      <DateTimeDisplay value={dateTimeValue} onChange={onDateTimeChange} disabled={disabled} />
      <BookingSearchButton onClick={onSearch} disabled={disabled} />
    </div>
  );
}

export default memo(QuickBookingBar);
