import { useLocation } from "react-router-dom";
import { NavLink } from "react-router-dom";
import { ChevronDown, LayoutDashboard, LogOut, UserCircle } from "lucide-react";
import SidebarPromoCard from "../components/SidebarPromoCard";

const NAV_ICON_MAP = {
  dashboard: LayoutDashboard,
  users: UserCircle,
  parking: LayoutDashboard,
  owners: LayoutDashboard,
};

function adminInitial(name) {
  return (name || "Admin").trim().slice(0, 1).toUpperCase();
}

export function AdminProfileCard({ adminName, adminEmail, onLogout }) {
  return (
    <div className="owner-profile-card">
      <button type="button" className="owner-profile-main">
        <span className="owner-profile-avatar">{adminInitial(adminName)}</span>
        <span className="owner-profile-text">
          <strong>{adminName || "Admin"}</strong>
          <small>{adminEmail || "admin@smartparking.vn"}</small>
        </span>
        <ChevronDown size={18} />
      </button>
      <button type="button" className="owner-profile-logout" onClick={onLogout}>
        <LogOut size={17} />
        <span>Đăng xuất</span>
      </button>
    </div>
  );
}

export function AdminSidebar({
  navItems,
  adminName,
  adminEmail,
  onLogout,
  isOpen,
  onNavigate,
}) {
  const location = useLocation();

  const usersSectionOpen = location.pathname.startsWith("/admin/users");
  const partnerSectionOpen = location.pathname.startsWith("/admin/owners");
  const parkingSectionOpen = location.pathname.startsWith("/admin/parking-lots");

  function isGroupOpen(item) {
    if (!item.children?.length) return false;
    if (item.id === "users") return usersSectionOpen;
    if (item.id === "partners") return partnerSectionOpen;
    if (item.id === "parking") return parkingSectionOpen;
    return location.pathname.startsWith(item.to);
  }

  return (
    <aside className={`owner-sidebar w-[240px] shrink-0${isOpen ? " is-open" : ""}`}>
      <div className="owner-sidebar-scroll">
        <div className="owner-brand">
          <div className="owner-brand-mark">AD</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Trung tâm điều hành</span>
          </div>
        </div>

        <nav className="owner-menu" aria-label="Admin navigation">
          {navItems.map((item) => {
            const groupOpen = isGroupOpen(item);
            const groupId = item.id || item.to;

            if (item.children?.length) {
              return (
                <div key={groupId} className={`owner-menu-group${groupOpen ? " is-expanded" : ""}`}>
                  <NavLink
                    to={item.children[0]?.to || item.to}
                    end
                    className={({ isActive }) => {
                      const base = "owner-menu-link owner-menu-link--parent";
                      if (groupOpen) return `${base} is-open`;
                      return base;
                    }}
                    onClick={onNavigate}
                  >
                    <LayoutDashboard size={19} />
                    <span>{item.label}</span>
                    <ChevronDown size={16} className="owner-menu-caret" />
                  </NavLink>
                  {groupOpen && (
                    <div className="owner-menu-sub">
                      {item.children.map((child) => (
                        child.disabled ? (
                          <span key={child.label} className="owner-menu-sublink is-disabled" title="Sắp ra mắt">
                            <span className="owner-menu-sublink-dot" />
                            <span>{child.label}</span>
                          </span>
                        ) : (
                          <NavLink
                            key={child.to}
                            to={child.to}
                            end={child.end}
                            className={({ isActive }) => `owner-menu-sublink${isActive ? " active" : ""}`}
                            onClick={onNavigate}
                          >
                            <span className="owner-menu-sublink-dot" />
                            <span>{child.label}</span>
                          </NavLink>
                        )
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/admin"}
                className={({ isActive }) => `owner-menu-link${isActive ? " active" : ""}`}
                onClick={onNavigate}
              >
                <LayoutDashboard size={19} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <SidebarPromoCard variant="admin" />
      </div>

      <AdminProfileCard adminName={adminName} adminEmail={adminEmail} onLogout={onLogout} />
    </aside>
  );
}
