import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarDays,
  Car,
  ChevronDown,
  CircleDollarSign,
  CircleParking,
  Clock,
  CreditCard,
  FileBarChart,
  Gauge,
  History,
  LayoutDashboard,
  LogOut,
  Map,
  MapPin,
  ParkingSquare,
  Plus,
  RefreshCw,
  ScanLine,
  Settings,
  Star,
  UserRound,
  WalletCards,
  Wrench,
} from "lucide-react";
import SidebarPromoCard from "../components/SidebarPromoCard";

const NAV_ICON_MAP = {
  dashboard: LayoutDashboard,
  parking: ParkingSquare,
  booking: CalendarCheck,
  map: Map,
  history: History,
  revenue: WalletCards,
  reviews: Star,
  settings: Settings,
  account: Building2,
  customers: UserRound,
};

const KPI_ICON_MAP = {
  lots: Building2,
  slots: CircleParking,
  available: ParkingSquare,
  occupied: Car,
  revenue: CircleDollarSign,
};

const REVENUE_CHART_COLORS = ["#2563EB", "#06B6D4", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6"];

const ACTIVITY_ICON_MAP = {
  checkin: Car,
  checkout: ScanLine,
  booking: CalendarCheck,
  payment: CreditCard,
  slot: Wrench,
  error: AlertTriangle,
  success: BadgeCheck,
};

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (amount >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(1)}B`;
  }
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `${Math.round(amount / 1_000)}K`;
  }
  return String(Math.round(amount));
}

function ownerInitial(name) {
  return (name || "Owner One").trim().slice(0, 1).toUpperCase();
}

function formatHeaderDateLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}

function formatHeaderTimeLabel(value) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(value);
}

function formatDateInputLabel(value) {
  if (!value) {
    return "--/--";
  }
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year}`;
}

function ChartTooltip({ active, payload, label, formatter = formatCurrency, suffix = "" }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="owner-chart-tooltip">
      <strong>{label}</strong>
      <span>{formatter(payload[0].value)}{suffix}</span>
    </div>
  );
}

function RevenueChartDot({ cx, cy, index = 0 }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    return null;
  }

  const color = REVENUE_CHART_COLORS[index % REVENUE_CHART_COLORS.length];
  return <circle cx={cx} cy={cy} r="4" className="owner-revenue-chart-dot" fill="#ffffff" stroke={color} />;
}

function RevenueChartActiveDot({ cx, cy, index = 0 }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    return null;
  }

  const color = REVENUE_CHART_COLORS[index % REVENUE_CHART_COLORS.length];
  return (
    <g>
      <circle cx={cx} cy={cy} r="10" className="owner-revenue-chart-pulse" fill={color} />
      <circle cx={cx} cy={cy} r="6" className="owner-revenue-chart-dot" fill="#ffffff" stroke={color} />
    </g>
  );
}

function isValidMapCoordinate(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  return Number.isFinite(parsedLat)
    && Number.isFinite(parsedLng)
    && Math.abs(parsedLat) <= 90
    && Math.abs(parsedLng) <= 180;
}

function getMarkerTone(lot) {
  if (lot.statusTone === "danger" || lot.occupancy >= 85) {
    return "danger";
  }
  if (lot.statusTone === "warning" || lot.occupancy >= 65) {
    return "warning";
  }
  return "success";
}

function createOwnerMapIcon(lot) {
  const tone = getMarkerTone(lot);
  const occupancy = Math.max(0, Math.min(100, Math.round(Number(lot.occupancy || 0))));

  return L.divIcon({
    className: `owner-map-div-marker owner-map-div-marker--${tone}`,
    html: `<span>${occupancy}%</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -18],
  });
}

function OwnerMapBounds({ lots }) {
  const map = useMap();

  useEffect(() => {
    if (!lots.length) {
      return;
    }

    if (lots.length === 1) {
      map.setView([lots[0].latitude, lots[0].longitude], 15);
      return;
    }

    const bounds = L.latLngBounds(lots.map((lot) => [lot.latitude, lot.longitude]));
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  }, [lots, map]);

  return null;
}

export function EmptyState({
  title = "Chưa có dữ liệu",
  subtitle = "Dữ liệu sẽ hiển thị khi hệ thống ghi nhận hoạt động",
  icon = Activity,
  compact = false,
}) {
  return (
    <div className={`owner-empty-state${compact ? " owner-empty-state--compact" : ""}`}>
      <div className="owner-empty-icon">
        {createElement(icon, { size: 22 })}
      </div>
      <strong>{title}</strong>
      <span>{subtitle}</span>
    </div>
  );
}

export function PromoCard() {
  return <SidebarPromoCard variant="owner" />;
}

export function OwnerProfileCard({ ownerName, ownerEmail, onLogout }) {
  return (
    <div className="owner-profile-card">
      <button type="button" className="owner-profile-main">
        <span className="owner-profile-avatar">{ownerInitial(ownerName)}</span>
        <span className="owner-profile-text">
          <strong>{ownerName || "Owner One"}</strong>
          <small>{ownerEmail || "owner@smartparking.vn"}</small>
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

export function OwnerSidebar({
  navItems,
  ownerName,
  ownerEmail,
  onLogout,
  isOpen,
  onNavigate,
}) {
  const location = useLocation();

  return (
    <aside className={`owner-sidebar w-[240px] shrink-0${isOpen ? " is-open" : ""}`}>
      <div className="owner-sidebar-scroll">
        <div className="owner-brand">
          <div className="owner-brand-mark">SP</div>
          <div>
            <strong>Smart Parking</strong>
            <span>Owner Console</span>
          </div>
        </div>

        <nav className="owner-menu" aria-label="Owner navigation">
          {navItems.map((item) => {
            const Icon = NAV_ICON_MAP[item.icon] || LayoutDashboard;
            const isGroupActive = item.children?.length
              ? location.pathname.startsWith(item.to)
              : false;

            if (item.children?.length) {
              return (
                <div key={item.to} className={`owner-menu-group${isGroupActive ? " is-expanded" : ""}`}>
                  <NavLink
                    to={item.to}
                    end={item.to === "/owner"}
                    className={({ isActive }) => `owner-menu-link owner-menu-link--parent${isActive || isGroupActive ? " active" : ""}`}
                    onClick={onNavigate}
                  >
                    <Icon size={19} />
                    <span>{item.label}</span>
                    <ChevronDown size={16} className="owner-menu-caret" />
                  </NavLink>
                  <div className="owner-menu-sub">
                    {item.children.map((child) => (
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
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/owner"}
                className={({ isActive }) => `owner-menu-link${isActive ? " active" : ""}`}
                onClick={onNavigate}
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <PromoCard />
      </div>

      <OwnerProfileCard ownerName={ownerName} ownerEmail={ownerEmail} onLogout={onLogout} />
    </aside>
  );
}

export function DashboardHeader({
  ownerName,
  ownerEmail,
  meta,
  unreadNotificationsCount,
  syncNote,
  onMenuToggle,
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="owner-dashboard-header">
      <div className="owner-dashboard-title">
        <button type="button" className="owner-mobile-menu" onClick={onMenuToggle} aria-label="Mở menu owner">
          <LayoutDashboard size={20} />
        </button>
        <div>
          <p>Xin chào, {ownerName || "Owner One"} 👋</p>
          <h1>{meta?.title || "Tổng quan hệ thống"}</h1>
          <span>{meta?.description || "Theo dõi và quản lý toàn bộ hệ thống bãi đỗ ô tô của bạn"}</span>
        </div>
      </div>

      <div className="owner-dashboard-tools">
        <div className="owner-date-picker owner-date-picker--readonly" aria-label="Ngày giờ hiện tại">
          <CalendarDays size={18} />
          <span className="owner-date-picker-text">
            <strong>{formatHeaderDateLabel(now)}</strong>
            <small><Clock size={13} /> {formatHeaderTimeLabel(now)}</small>
          </span>
        </div>

        <Link to="/owner/notifications" className="owner-icon-button" aria-label="Thông báo">
          <Bell size={20} />
          {unreadNotificationsCount > 0 ? <span>{unreadNotificationsCount}</span> : null}
        </Link>

        <div className="owner-header-avatar">
          <span>{ownerInitial(ownerName)}</span>
          <div>
            <strong>{ownerName || "Owner One"}</strong>
            <small>{ownerEmail || syncNote || "Chủ sở hữu"}</small>
          </div>
          <ChevronDown size={16} />
        </div>

        <Link to="/owner/parking" className="owner-header-button owner-header-button--light">
          <Plus size={18} />
          <span>Thêm bãi xe</span>
        </Link>

        <Link to="/owner/revenue" className="owner-header-button owner-header-button--primary">
          <FileBarChart size={18} />
          <span>Báo cáo tổng hợp</span>
        </Link>
      </div>
    </header>
  );
}

export function KPISection({ items }) {
  return (
    <section className="owner-kpi-grid" aria-label="KPI owner">
      {items.map((item) => {
        const Icon = KPI_ICON_MAP[item.icon] || Gauge;
        return (
          <article key={item.title} className="owner-kpi-card">
            <div className={`owner-kpi-icon owner-kpi-icon--${item.tone || "blue"}`}>
              <Icon size={24} />
            </div>
            <div className="owner-kpi-body">
              <p>{item.title}</p>
              <strong>{item.value}</strong>
              <span>{item.subtitle}</span>
              <small className={`owner-kpi-trend owner-kpi-trend--${item.trendTone || "up"}`}>
                {item.trendIcon === "down" ? <RefreshCw size={13} /> : <BarChart3 size={13} />}
                {item.trend}
              </small>
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function RevenueSystemChart({
  data,
  totalRevenue,
  growthLabel,
  summary,
  isEmpty,
  subtitle = "Thống kê doanh thu theo ngày",
  rangeOptions = [],
  selectedRange,
  onRangeChange,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
}) {
  const dateFromInputRef = useRef(null);
  const dateToInputRef = useRef(null);
  const [rangePickerTarget, setRangePickerTarget] = useState("from");
  const customRangeLabel = `${formatDateInputLabel(dateFrom)} - ${formatDateInputLabel(dateTo)}`;

  const openNativeDatePicker = (target = rangePickerTarget) => {
    const input = target === "to" ? dateToInputRef.current : dateFromInputRef.current;
    setRangePickerTarget(target);
    input?.focus();
    try {
      input?.showPicker?.();
    } catch {
      input?.click();
    }
  };

  const handleRangeChange = (event) => {
    const nextRange = event.target.value;
    onRangeChange?.(nextRange);
    if (nextRange === "custom") {
      openNativeDatePicker("from");
    }
  };

  return (
    <section className="owner-dashboard-card owner-revenue-card">
      <div className="owner-card-header">
        <div>
          <h2>Doanh thu hệ thống</h2>
          <p>{subtitle}</p>
        </div>
        <div className="owner-revenue-filters">
          <label className="owner-filter-select-wrap">
            <select
              className="owner-filter-select"
              value={selectedRange}
              onChange={handleRangeChange}
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronDown size={15} />
          </label>
          {selectedRange === "custom" ? (
            <div className="owner-custom-range">
              <button
                type="button"
                className="owner-custom-range-button"
                onClick={() => openNativeDatePicker(rangePickerTarget)}
                aria-label="Chọn khoảng ngày doanh thu"
              >
                {customRangeLabel}
                <CalendarDays size={14} />
              </button>
            </div>
          ) : null}
          <div className="owner-native-range-inputs">
            <input
              ref={dateFromInputRef}
              type="date"
              tabIndex={-1}
              value={dateFrom}
              onChange={(event) => {
                onDateFromChange?.(event.target.value);
                setRangePickerTarget("to");
                window.setTimeout(() => openNativeDatePicker("to"), 0);
              }}
            />
            <input
              ref={dateToInputRef}
              type="date"
              tabIndex={-1}
              value={dateTo}
              onChange={(event) => {
                onDateToChange?.(event.target.value);
                setRangePickerTarget("from");
              }}
            />
          </div>
        </div>
      </div>

      <div className="owner-revenue-total">
        <strong>{formatCurrency(totalRevenue)}</strong>
        <span>{growthLabel}</span>
      </div>

      <div className="owner-chart-wrap owner-chart-wrap--revenue">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 16, right: 14, left: -4, bottom: 22 }}>
            <defs>
              <linearGradient id="ownerRevenueStroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#2563EB" />
                <stop offset="26%" stopColor="#06B6D4" />
                <stop offset="54%" stopColor="#10B981" />
                <stop offset="76%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#EC4899" />
              </linearGradient>
              <linearGradient id="ownerRevenueGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.3} />
                <stop offset="32%" stopColor="#0EA5E9" stopOpacity={0.22} />
                <stop offset="68%" stopColor="#10B981" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#DCE4F2" strokeDasharray="4 8" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#52627A", fontSize: 12, fontWeight: 700 }}
              tickMargin={12}
              minTickGap={18}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#52627A", fontSize: 12, fontWeight: 700 }}
              tickFormatter={formatCompactCurrency}
              tickMargin={8}
              width={44}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="url(#ownerRevenueStroke)"
              strokeWidth={3.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="url(#ownerRevenueGradient)"
              dot={<RevenueChartDot />}
              activeDot={<RevenueChartActiveDot />}
            />
          </AreaChart>
        </ResponsiveContainer>
        {isEmpty ? (
          <div className="owner-chart-empty-overlay">
            <EmptyState compact />
          </div>
        ) : null}
      </div>

      <div className="owner-revenue-footer">
        {summary.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note ? <small>{item.note}</small> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export function MiniMapCard({ parkingLots }) {
  const mapLots = useMemo(
    () =>
      parkingLots
        .filter((lot) => isValidMapCoordinate(lot.latitude, lot.longitude))
        .map((lot) => ({
          ...lot,
          latitude: Number(lot.latitude),
          longitude: Number(lot.longitude),
        })),
    [parkingLots],
  );

  if (!parkingLots.length) {
    return (
      <div className="owner-mini-map owner-mini-map--empty">
        <EmptyState compact icon={MapPin} />
      </div>
    );
  }

  if (!mapLots.length) {
    return (
      <div className="owner-mini-map owner-mini-map--empty">
        <EmptyState
          compact
          icon={MapPin}
          title="Chưa có tọa độ bản đồ"
          subtitle="Bản đồ sẽ hiển thị khi API trả về latitude/longitude cho bãi xe"
        />
      </div>
    );
  }

  const center = [mapLots[0].latitude, mapLots[0].longitude];

  return (
    <div className="owner-mini-map owner-mini-map--leaflet">
      <MapContainer
        className="owner-mini-map-canvas"
        center={center}
        zoom={14}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {mapLots.map((lot) => (
          <Marker
            key={lot.id || lot.name}
            icon={createOwnerMapIcon(lot)}
            position={[lot.latitude, lot.longitude]}
          >
            <Popup>
              <div className="owner-map-popup">
                <strong>{lot.name}</strong>
                <span>{lot.address || lot.district || "Chưa có địa chỉ"}</span>
                <small>{formatNumber(lot.occupied)}/{formatNumber(lot.total)} chỗ · {lot.occupancy}% lấp đầy</small>
              </div>
            </Popup>
          </Marker>
        ))}
        <OwnerMapBounds lots={mapLots} />
      </MapContainer>
      <div className="owner-map-live-badge" aria-hidden="true">Realtime map</div>
    </div>
  );
}

export function ParkingOverviewCard({ parkingLots }) {
  const hasData = parkingLots.length > 0;

  return (
    <section className="owner-dashboard-card owner-parking-overview-card">
      <div className="owner-card-header">
        <div>
          <h2>Tổng quan các bãi xe</h2>
          <p>Occupancy realtime theo slot và booking hiện tại</p>
        </div>
        <Link to="/owner/parking" className="owner-card-link">Xem tất cả</Link>
      </div>

      <div className="owner-parking-overview-grid">
        <div className="owner-parking-list">
          {!hasData ? <EmptyState compact icon={ParkingSquare} /> : null}
          {parkingLots.map((lot) => (
            <article key={lot.id || lot.name} className="owner-parking-row">
              <div>
                <strong>{lot.name}</strong>
                <span>{lot.district || lot.address || "Chưa có địa chỉ"}</span>
                <small>{formatNumber(lot.occupied)}/{formatNumber(lot.total)} chỗ</small>
              </div>
              <div className="owner-parking-progress-block">
                <span className={`owner-status-pill owner-status-pill--${lot.statusTone}`}>{lot.statusLabel}</span>
                <strong>{lot.occupancy}%</strong>
                <div className="owner-parking-progress">
                  <span style={{ width: `${lot.occupancy}%` }} />
                </div>
              </div>
            </article>
          ))}
        </div>
        <MiniMapCard parkingLots={parkingLots} />
      </div>
    </section>
  );
}

export function RecentActivities({ activities }) {
  return (
    <section className="owner-dashboard-card owner-activity-card">
      <div className="owner-card-header">
        <div>
          <h2>Hoạt động gần đây</h2>
          <p>Realtime activity feed từ booking, payment và slot</p>
        </div>
        <Link to="/owner/activity" className="owner-card-link">Xem tất cả</Link>
      </div>

      <div className="owner-activity-feed">
        {!activities.length ? <EmptyState compact icon={Activity} /> : null}
        {activities.map((item) => {
          const Icon = ACTIVITY_ICON_MAP[item.icon] || Activity;
          return (
            <article key={item.id} className="owner-activity-item">
              <div className={`owner-activity-icon owner-activity-icon--${item.tone}`}>
                <Icon size={18} />
              </div>
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
              <time>{item.timeLabel}</time>
              <small className={`owner-activity-badge owner-activity-badge--${item.tone}`}>{item.badge}</small>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function OccupancyChart({ data, peakHour, lowHour, isEmpty }) {
  return (
    <section className="owner-dashboard-card owner-occupancy-card">
      <div className="owner-card-header">
        <div>
          <h2>Tỷ lệ lấp đầy theo giờ</h2>
          <p>Phân tích giờ cao điểm theo booking thực tế</p>
        </div>
        <Link to="/owner/parking-map" className="owner-card-link">Xem tất cả</Link>
      </div>

      <div className="owner-chart-wrap owner-chart-wrap--compact">
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={data} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="ownerOccupancyLine" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="#0EA5E9" />
                <stop offset="48%" stopColor="#06B6D4" />
                <stop offset="100%" stopColor="#14B8A6" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#E5E7EB" strokeDasharray="4 8" vertical={false} />
            <XAxis dataKey="hour" axisLine={false} tickLine={false} interval={5} tick={{ fill: "#64748B", fontSize: 11 }} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748B", fontSize: 11 }}
              tickFormatter={(value) => `${value}%`}
              domain={[0, 100]}
              width={38}
            />
            <Tooltip content={<ChartTooltip formatter={(value) => Number(value).toFixed(0)} suffix="%" />} />
            <Line
              type="monotone"
              dataKey="occupancy"
              stroke="url(#ownerOccupancyLine)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2.5, fill: "#FFFFFF", stroke: "#0EA5E9" }}
            />
          </LineChart>
        </ResponsiveContainer>
        {isEmpty ? (
          <div className="owner-chart-empty-overlay owner-chart-empty-overlay--small">
            <EmptyState compact icon={Clock} />
          </div>
        ) : null}
      </div>

      <div className="owner-hour-summary">
        <div>
          <span>Giờ thấp nhất</span>
          <strong>{lowHour.hour}</strong>
          <small>{lowHour.value}%</small>
        </div>
        <div>
          <span>Giờ cao nhất</span>
          <strong>{peakHour.hour}</strong>
          <small>{peakHour.value}%</small>
        </div>
      </div>
    </section>
  );
}

export function RevenueByParking({ items }) {
  const maxRevenue = useMemo(() => Math.max(...items.map((item) => item.revenue), 1), [items]);

  return (
    <section className="owner-dashboard-card owner-ranking-card">
      <div className="owner-card-header">
        <div>
          <h2>Doanh thu theo bãi xe</h2>
          <p>Xếp hạng doanh thu theo giao dịch đã thanh toán</p>
        </div>
        <Link to="/owner/revenue" className="owner-card-link">Xem báo cáo</Link>
      </div>

      <div className="owner-revenue-ranking">
        {!items.length ? <EmptyState compact icon={WalletCards} /> : null}
        {items.map((item, index) => (
          <article key={item.name} className="owner-ranking-row">
            <span>{index + 1}</span>
            <div>
              <div className="owner-ranking-label">
                <strong>{item.name}</strong>
                <small>{formatCurrency(item.revenue)}</small>
              </div>
              <div className="owner-ranking-progress">
                <span style={{ width: `${Math.round((item.revenue / maxRevenue) * 100)}%` }} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
