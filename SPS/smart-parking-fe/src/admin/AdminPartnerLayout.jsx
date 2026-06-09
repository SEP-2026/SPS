import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { ADMIN_PARTNER_NAV } from "./adminData";
import "./AdminPartners.css";

export default function AdminPartnerLayout() {
  const outletContext = useOutletContext();

  return (
    <div className="admin-partner-hub">
      <nav className="admin-partner-subnav" aria-label="Quản lý chủ bãi / đối tác">
        {ADMIN_PARTNER_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin-partner-subnav-link${isActive ? " active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="admin-partner-hub-content">
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
