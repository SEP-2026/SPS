export const OWNER_NAV_ITEMS = [
  { to: "/owner", label: "Tổng quan", icon: "dashboard" },
  { to: "/owner/parking", label: "Quản lý bãi đỗ", icon: "parking" },
  { to: "/owner/bookings", label: "Quản lý đặt chỗ", icon: "booking" },
  { to: "/owner/customers", label: "Quản lý khách hàng", icon: "customers" },
  { to: "/owner/parking-map", label: "Sơ đồ bãi xe", icon: "map" },
  { to: "/owner/activity", label: "Lịch sử hoạt động", icon: "history" },
  {
    to: "/owner/revenue",
    label: "Doanh thu & Thanh toán",
    icon: "revenue",
    children: [
      { to: "/owner/revenue", label: "Tổng quan", end: true },
      { to: "/owner/revenue/transactions", label: "Giao dịch" },
      { to: "/owner/revenue/withdrawals", label: "Rút tiền" },
      { to: "/owner/revenue/commission", label: "Hoa hồng nền tảng" },
    ],
  },
  { to: "/owner/reviews", label: "Đánh giá & phản hồi", icon: "reviews" },
  { to: "/owner/settings", label: "Cài đặt", icon: "settings" },
];

export const OWNER_ROUTE_META = {
  "/owner": {
    title: "Tổng quan hệ thống",
    description: "Theo dõi và quản lý toàn bộ hệ thống bãi đỗ ô tô của bạn",
  },
  "/owner/parking": {
    title: "Quản lý bãi đỗ",
    description: "Quản trị trạng thái từng chỗ đỗ, khu vực và năng lực vận hành.",
  },
  "/owner/bookings": {
    title: "Quản lý đặt chỗ",
    description: "Theo dõi và quản lý toàn bộ đặt chỗ tại các bãi đỗ ô tô.",
  },
  "/owner/customers": {
    title: "Quản lý khách hàng",
    description: "Xem thông tin khách, lịch sử booking, thanh toán và hỗ trợ khi cần thiết.",
  },
  "/owner/parking-map": {
    title: "Sơ đồ bãi xe",
    description: "Quan sát bố cục slot theo từng bãi và trạng thái vận hành hiện tại.",
  },
  "/owner/activity": {
    title: "Lịch sử hoạt động",
    description: "Theo dõi các sự kiện booking, thanh toán, slot và cảnh báo gần đây.",
  },
  "/owner/revenue": {
    title: "Doanh thu & Thanh toán",
    description: "Theo dõi doanh thu, giao dịch ví khách, rút tiền và hoa hồng nền tảng.",
  },
  "/owner/revenue/transactions": {
    title: "Giao dịch",
    description: "Theo dõi tất cả giao dịch thanh toán qua ví của bãi xe",
  },
  "/owner/revenue/withdrawals": {
    title: "Rút tiền",
    description: "Quản lý số dư và yêu cầu rút tiền về tài khoản ngân hàng",
  },
  "/owner/revenue/commission": {
    title: "Hoa hồng nền tảng",
    description: "Theo dõi chi tiết hoa hồng nền tảng được trừ từ doanh thu",
  },
  "/owner/settings": {
    title: "Cài đặt",
    description: "Quản lý và cấu hình hệ thống Smart Parking.",
  },
  "/owner/reviews": {
    title: "Đánh giá & phản hồi",
    description: "Xem tổng quan đánh giá và phản hồi trực tiếp các nhận xét của khách hàng.",
  },
  "/owner/review-replies": {
    title: "Đánh giá & phản hồi",
    description: "Xem tổng quan đánh giá và phản hồi trực tiếp các nhận xét của khách hàng.",
  },
  "/owner/notifications": {
    title: "Thông báo & Cảnh báo",
    description: "Theo dõi tất cả các sự kiện, booking, đánh giá và cảnh báo hệ thống.",
  },
  "/owner/employees": {
    title: "Tài khoản bãi xe",
    description: "Tạo và quản lý tài khoản nhân viên vận hành từng bãi đỗ.",
  },
  "/owner/parking-accounts": {
    title: "Tài khoản bãi xe",
    description: "Tạo và quản lý tài khoản nhân viên vận hành từng bãi đỗ.",
  },
};
