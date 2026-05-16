export const bookingStatusLabelMap = {
  pending: "Chờ xác nhận",
  booked: "Đã đặt chỗ",
  checked_in: "Đang trong bãi",
  checked_out: "Đã ra bãi",
  completed: "Hoàn tất",
  cancelled: "Đã hủy",
};

export function getBookingStatusLabel(status) {
  return bookingStatusLabelMap[status] || status || "--";
}

export function getPaymentStatusLabel(status) {
  const mapping = {
    pending: "Chờ thanh toán",
    paid: "Đã thanh toán",
    failed: "Thanh toán thất bại",
  };
  return mapping[status] || status || "--";
}

export function getBannerTone(uiState, booking) {
  if (uiState === "error") return "error";
  if (uiState === "success") return "success";
  if (uiState === "processing" || uiState === "action_submitting" || uiState === "scanning") return "neutral";
  if (booking?.booking_status === "cancelled") return "error";
  return "neutral";
}
