export const OWNER_SETTINGS_TABS = [
  { id: "account", label: "Tài khoản Owner", icon: "account" },
  { id: "parking", label: "Cấu hình bãi đỗ & giá", icon: "parking" },
  { id: "booking-lifecycle", label: "Cấu hình đặt chỗ & ra/vào", icon: "booking" },
  { id: "parking-accounts", label: "Tài khoản bãi xe (Vận hành)", icon: "employees" },
  { id: "notifications", label: "Thông báo", icon: "notifications" },
];

export const ACCOUNT_SECTIONS = [
  { id: "profile", label: "Thông tin tài khoản", icon: "user" },
  { id: "password", label: "Đổi mật khẩu", icon: "key" },
];

export const BOOKING_LIFECYCLE_SECTIONS = [
  { id: "booking-rules", label: "Quy tắc đặt chỗ", icon: "booking" },
  { id: "cancel-change", label: "Huỷ / đổi đặt chỗ", icon: "payment" },
  { id: "checkin", label: "Cấu hình check-in", icon: "clock" },
  { id: "checkout", label: "Cấu hình check-out", icon: "clock" },
  { id: "qr-rules", label: "Quy tắc QR ra/vào", icon: "qr" },
  { id: "entry-exit", label: "Số lần ra/vào", icon: "entries" },
  { id: "booking-notify", label: "Thông báo đặt chỗ", icon: "bell" },
  { id: "templates", label: "Mẫu nội dung", icon: "mail" },
];

export const DEFAULT_TAB = "account";

const TAB_ALIASES = {
  booking: "booking-lifecycle",
  checkin: "booking-lifecycle",
  pricing: "parking",
  security: "account",
  "system-log": "account",
};

export function resolveSettingsTab(value) {
  const normalized = String(value || "").trim();
  const resolved = TAB_ALIASES[normalized] || normalized;
  return OWNER_SETTINGS_TABS.some((tab) => tab.id === resolved) ? resolved : DEFAULT_TAB;
}
