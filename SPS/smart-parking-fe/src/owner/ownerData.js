export const OWNER_NAV_ITEMS = [
  { to: "/owner", label: "Tổng quan", icon: "dashboard" },
  { to: "/owner/parking", label: "Quản lý bãi đỗ", icon: "parking" },
  { to: "/owner/bookings", label: "Quản lý đặt chỗ", icon: "booking" },
  { to: "/owner/booking-owner", label: "Đặt chỗ giúp khách", icon: "booking" },
  { to: "/owner/customers", label: "Quản lý khách hàng", icon: "customer" },
  { to: "/owner/revenue", label: "Doanh thu", icon: "revenue" },
  { to: "/owner/reviews", label: "Đánh giá tổng quan", icon: "reviews" },
  { to: "/owner/review-replies", label: "Phản hồi đánh giá", icon: "reviews" },
  { to: "/owner/settings", label: "Cài đặt & nhân viên", icon: "settings" },
];

export const OWNER_ROUTE_META = {
  "/owner": {
    title: "Tình trạng bãi đỗ",
    description: "Theo dõi nhanh tình trạng vận hành của bãi và xử lý các tác vụ trong ngày.",
  },
  "/owner/parking": {
    title: "Quản lý bãi đỗ",
    description: "Quản trị trạng thái từng chỗ đỗ, khu vực và năng lực vận hành.",
  },
  "/owner/booking-owner": {
    title: "Đặt chỗ giúp khách hàng",
    description: "Tạo booking cho khách hàng với xác nhận từ họ.",
  },
  "/owner/customers": {
    title: "Quản lý khách hàng",
    description: "Xem thông tin khách, lịch sử booking, thanh toán và hỗ trợ khi cần thiết.",
  },
  "/owner/revenue": {
    title: "Doanh thu",
    description: "Theo dõi doanh thu của bãi theo ngày hoặc tuần và kiểm tra giao dịch gần đây.",
  },
  "/owner/settings": {
    title: "Cài đặt & nhân viên",
    description: "Quản lý thông tin owner, cấu hình bãi đỗ và tạo tài khoản nhân viên.",
  },
  "/owner/reviews": {
    title: "Đánh giá tổng quan",
    description: "Xem tổng quan đánh giá, điểm số và phân loại đánh giá của khách hàng.",
  },
  "/owner/review-replies": {
    title: "Phản hồi đánh giá",
    description: "Trả lời trực tiếp các đánh giá của khách hàng cho bãi đỗ của bạn.",
  },
  "/owner/notifications": {
    title: "Thông báo & Cảnh báo",
    description: "Theo dõi tất cả các sự kiện, booking, đánh giá và cảnh báo hệ thống.",
  },
};
