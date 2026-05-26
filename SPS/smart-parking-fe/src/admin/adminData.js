export const ADMIN_NAV_ITEMS = [
  { to: "/admin", label: "Bảng điều khiển", icon: "dashboard" },
  { to: "/admin/users", label: "Người dùng", icon: "users" },
  { to: "/admin/owners", label: "Khu vực", icon: "owners" },
  { to: "/admin/parking-lots", label: "Bãi đỗ", icon: "parking" },
  { to: "/admin/bookings", label: "Đặt chỗ", icon: "booking" },
  { to: "/admin/revenue", label: "Doanh thu", icon: "revenue" },
  { to: "/admin/analytics", label: "Phân tích", icon: "analytics" },
  { to: "/admin/settings", label: "Cài đặt", icon: "settings" },
];

export const ADMIN_ROUTE_META = {
  "/admin": {
    title: "Bảng điều khiển hệ thống",
    description: "Theo dõi tổng quan người dùng, chủ khu vực, bãi đỗ, đặt chỗ và doanh thu toàn hệ thống.",
  },
  "/admin/users": {
    title: "Quản lý người dùng",
    description: "Quản lý người dùng cuối, trạng thái tài khoản và hoạt động đặt chỗ.",
  },
  "/admin/owners": {
    title: "Quản lý khu vực",
    description: "Quản trị tài khoản chủ khu vực, khu vực đang phụ trách và hiệu suất vận hành.",
  },
  "/admin/parking-lots": {
    title: "Quản lý bãi đỗ",
    description: "Quản lý toàn bộ bãi đỗ trong hệ thống, duyệt bãi mới và khóa bãi vi phạm.",
  },
  "/admin/bookings": {
    title: "Quản lý đặt chỗ",
    description: "Theo dõi booking toàn hệ thống, phát hiện bất thường và can thiệp khi cần.",
  },
  "/admin/revenue": {
    title: "Doanh thu & Hoa hồng",
    description: "Theo dõi doanh thu hệ thống và phần commission admin theo từng chu kỳ.",
  },
  "/admin/analytics": {
    title: "Phân tích",
    description: "Phân tích tăng trưởng user, hiệu suất bãi đỗ và tỷ lệ lấp đầy toàn hệ thống.",
  },
  "/admin/settings": {
    title: "Nhật ký & Bảo mật",
    description: "Theo dõi log hệ thống, lịch sử đăng nhập và cấu hình bảo mật quản trị.",
  },
  "/admin/notifications": {
    title: "Thông báo hệ thống",
    description: "Theo dõi cảnh báo bảo mật, lỗi và sự kiện quan trọng trên toàn hệ thống.",
  },
};

export const createAdminSeedData = () => ({
  commissionRate: 10,
  users: [
    { id: "u-1", name: "Nguyen Minh Thu", email: "thu@gmail.com", status: "active", bookingCount: 12, lastActive: "2026-04-15T08:40:00", phone: "0901 222 888" },
    { id: "u-2", name: "Tran Quoc Bao", email: "bao@gmail.com", status: "banned", bookingCount: 3, lastActive: "2026-04-14T19:22:00", phone: "0917 111 222" },
    { id: "u-3", name: "Le Hai Yen", email: "yen@gmail.com", status: "active", bookingCount: 9, lastActive: "2026-04-15T10:05:00", phone: "0933 000 444" },
    { id: "u-4", name: "Pham Gia Han", email: "han@gmail.com", status: "active", bookingCount: 21, lastActive: "2026-04-15T11:10:00", phone: "0989 200 123" },
    { id: "u-5", name: "Vo Thanh Nam", email: "nam@gmail.com", status: "active", bookingCount: 5, lastActive: "2026-04-13T21:00:00", phone: "0978 450 777" },
    { id: "u-6", name: "Do Bao Anh", email: "anh@gmail.com", status: "active", bookingCount: 17, lastActive: "2026-04-15T12:18:00", phone: "0945 880 220" },
  ],
  owners: [
    { id: "o-1", name: "Tran Minh Khang", email: "owner.khang@smartparking.vn", parkingLot: "Smart Parking Tân Phú", status: "active", performance: "88% lấp đầy", passwordHint: "Reset lần cuối 03/04" },
    { id: "o-2", name: "Nguyen Quoc Vinh", email: "owner.vinh@smartparking.vn", parkingLot: "Smart Parking Bình Tân", status: "active", performance: "81% lấp đầy", passwordHint: "Reset lần cuối 09/04" },
    { id: "o-3", name: "Le Tuan Duy", email: "owner.duy@smartparking.vn", parkingLot: "Smart Parking Quận 7", status: "suspended", performance: "72% lấp đầy", passwordHint: "Chưa reset 30 ngày" },
  ],
  parkingLots: [
    { id: "p-1", name: "Smart Parking Tân Phú", address: "12 Tân Kỳ Tân Quý, Tân Phú", owner: "Tran Minh Khang", slotCount: 120, status: "active", occupancy: 86 },
    { id: "p-2", name: "Smart Parking Bình Tân", address: "288 Kinh Dương Vương, Bình Tân", owner: "Nguyen Quoc Vinh", slotCount: 96, status: "active", occupancy: 79 },
    { id: "p-3", name: "Smart Parking Quận 7", address: "102 Nguyễn Thị Thập, Quận 7", owner: "Le Tuan Duy", slotCount: 140, status: "pending", occupancy: 66 },
    { id: "p-4", name: "Smart Parking Gò Vấp", address: "88 Phan Văn Trị, Gò Vấp", owner: "Chưa gán", slotCount: 80, status: "locked", occupancy: 0 },
  ],
  bookings: [
    { id: "BK-31001", user: "Nguyen Minh Thu", plate: "51K-339.82", parkingLot: "Smart Parking Tân Phú", checkIn: "2026-04-15T08:30:00", checkOut: "2026-04-15T11:30:00", status: "confirmed", amount: 75000, anomaly: false },
    { id: "BK-31002", user: "Le Hai Yen", plate: "30G-812.66", parkingLot: "Smart Parking Bình Tân", checkIn: "2026-04-15T09:10:00", checkOut: "2026-04-15T13:40:00", status: "in_progress", amount: 130000, anomaly: false },
    { id: "BK-31003", user: "Pham Gia Han", plate: "59A-198.31", parkingLot: "Smart Parking Quận 7", checkIn: "2026-04-15T07:50:00", checkOut: "2026-04-15T18:20:00", status: "completed", amount: 205000, anomaly: true },
    { id: "BK-31004", user: "Vo Thanh Nam", plate: "52X-112.08", parkingLot: "Smart Parking Tân Phú", checkIn: "2026-04-15T12:20:00", checkOut: "2026-04-15T15:20:00", status: "pending", amount: 85000, anomaly: false },
    { id: "BK-31005", user: "Do Bao Anh", plate: "61A-223.99", parkingLot: "Smart Parking Gò Vấp", checkIn: "2026-04-15T10:15:00", checkOut: "2026-04-15T14:30:00", status: "cancelled", amount: 0, anomaly: true },
  ],
  transactions: [
    { id: "TX-8801", bookingId: "BK-31001", user: "Nguyen Minh Thu", parkingLot: "Smart Parking Tân Phú", time: "2026-04-15T08:50:00", gross: 75000, commission: 7500, ownerPayout: 67500, status: "paid" },
    { id: "TX-8802", bookingId: "BK-31002", user: "Le Hai Yen", parkingLot: "Smart Parking Bình Tân", time: "2026-04-15T09:25:00", gross: 130000, commission: 13000, ownerPayout: 117000, status: "paid" },
    { id: "TX-8803", bookingId: "BK-31003", user: "Pham Gia Han", parkingLot: "Smart Parking Quận 7", time: "2026-04-15T10:10:00", gross: 205000, commission: 20500, ownerPayout: 184500, status: "paid" },
    { id: "TX-8804", bookingId: "BK-31004", user: "Vo Thanh Nam", parkingLot: "Smart Parking Tân Phú", time: "2026-04-15T12:32:00", gross: 85000, commission: 8500, ownerPayout: 76500, status: "pending" },
    { id: "TX-8805", bookingId: "BK-31005", user: "Do Bao Anh", parkingLot: "Smart Parking Gò Vấp", time: "2026-04-15T10:30:00", gross: 0, commission: 0, ownerPayout: 0, status: "refunded" },
  ],
  systemRevenue: {
    revenue: [
      { label: "09/04", amount: 5200000 },
      { label: "10/04", amount: 5480000 },
      { label: "11/04", amount: 5750000 },
      { label: "12/04", amount: 5980000 },
      { label: "13/04", amount: 6210000 },
      { label: "14/04", amount: 6420000 },
      { label: "15/04", amount: 6890000 },
    ],
    commission: [
      { label: "09/04", amount: 520000 },
      { label: "10/04", amount: 548000 },
      { label: "11/04", amount: 575000 },
      { label: "12/04", amount: 598000 },
      { label: "13/04", amount: 621000 },
      { label: "14/04", amount: 642000 },
      { label: "15/04", amount: 689000 },
    ],
    bookings: [
      { label: "09/04", amount: 118 },
      { label: "10/04", amount: 124 },
      { label: "11/04", amount: 131 },
      { label: "12/04", amount: 136 },
      { label: "13/04", amount: 142 },
      { label: "14/04", amount: 147 },
      { label: "15/04", amount: 153 },
    ],
    userGrowth: [
      { label: "T1", amount: 1200 },
      { label: "T2", amount: 1450 },
      { label: "T3", amount: 1710 },
      { label: "T4", amount: 1980 },
    ],
    occupancy: [
      { label: "Tân Phú", amount: 86 },
      { label: "Bình Tân", amount: 79 },
      { label: "Quận 7", amount: 66 },
      { label: "Gò Vấp", amount: 0 },
    ],
  },
  logs: [
    { id: "LG-1", actor: "admin@smartparking.vn", action: "Khóa bãi Smart Parking Gò Vấp", time: "2026-04-15T09:02:00", type: "security" },
    { id: "LG-2", actor: "admin@smartparking.vn", action: "Reset mật khẩu owner Quận 7", time: "2026-04-15T09:35:00", type: "system" },
    { id: "LG-3", actor: "system", action: "Phát hiện booking bất thường BK-31003", time: "2026-04-15T10:15:00", type: "warning" },
    { id: "LG-4", actor: "admin@smartparking.vn", action: "Mở khóa user Nguyen Minh Thu", time: "2026-04-15T11:48:00", type: "system" },
  ],
  loginHistory: [
    { id: "LI-1", email: "admin@smartparking.vn", ip: "113.161.22.100", device: "Chrome / macOS", time: "2026-04-15T08:05:00", status: "success" },
    { id: "LI-2", email: "admin@smartparking.vn", ip: "113.161.22.100", device: "Chrome / macOS", time: "2026-04-14T08:02:00", status: "success" },
    { id: "LI-3", email: "admin@smartparking.vn", ip: "103.21.244.8", device: "Unknown", time: "2026-04-13T23:50:00", status: "blocked" },
  ],
  settings: {
    commissionRate: "10",
    supportEmail: "admin@smartparking.vn",
    maintenanceWindow: "Chủ nhật 23:00 - 01:00",
    alertThreshold: "85",
  },
});
