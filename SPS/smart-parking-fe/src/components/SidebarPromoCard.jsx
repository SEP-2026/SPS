import { Link } from "react-router-dom";
import "../styles/sidebar-promo.css";

const PROMO_VARIANTS = {
  owner: {
    title: "Quản lý bãi xe thông minh",
    subtitle: "Theo dõi, quản lý và tối ưu doanh thu một cách hiệu quả",
    cta: null,
  },
  admin: {
    title: "Trung tâm điều hành",
    subtitle: "Quản lý hệ thống, phân tích dữ liệu và giám sát toàn bộ bãi xe",
    cta: { to: "/admin/analytics", label: "Xem phân tích" },
  },
  employee: {
    title: "Vận hành realtime",
    subtitle: "Quét QR, check-in/check-out và cập nhật trạng thái bãi tức thì",
    cta: { to: "/employee/scanner", label: "Mở quét QR" },
  },
};

export default function SidebarPromoCard({ variant = "owner" }) {
  const content = PROMO_VARIANTS[variant] || PROMO_VARIANTS.owner;

  return (
    <div className="owner-promo-card">
      <div className="owner-promo-visual" aria-hidden="true">
        <img className="owner-promo-car" src="/owner-promo-car.png" alt="" />
      </div>
      <div className="owner-promo-copy">
        <strong>{content.title}</strong>
        <span>{content.subtitle}</span>
        {content.cta ? (
          <Link className="owner-promo-button" to={content.cta.to}>
            {content.cta.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
