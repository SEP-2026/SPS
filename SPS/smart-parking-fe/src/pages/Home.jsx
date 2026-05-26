import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../services/api";
import { formatDateTimeVN, toDatetimeLocalValue } from "../utils/dateTime";
import "./Home.css";
import NearbyParkingMap from "../components/NearbyParkingMap";
import QuickBookingBar from "../components/home/QuickBookingBar";
import { formatCurrency } from "../features/gate/gateFormatters";
import { useWallet } from "../context/WalletContext";
import { mergeParkingSearchWithOverview, searchNearbyByCurrentLocation } from "../services/parkingSearch";

const OWNER_VISIBLE_BOOKING_STATUSES = new Set(["pending", "confirmed", "in_progress"]);

function formatStatusLabel(status) {
  const mapping = {
    available: "Trống",
    reserved: "Giữ chỗ",
    occupied: "Đã có xe",
    maintenance: "Bảo trì",
    pending: "Chờ xác nhận",
    confirmed: "Đã xác nhận",
    in_progress: "Đang trong bãi",
    completed: "Hoàn tất",
    cancelled: "Đã hủy",
  };

  return mapping[status] || status || "Không rõ";
}

function formatDateTime(value) {
  return formatDateTimeVN(value, "Chưa có");
}

function getDesktopColumns() {
  if (typeof window === "undefined") {
    return 5;
  }
  if (window.innerWidth <= 640) {
    return 2;
  }
  if (window.innerWidth <= 992) {
    return 3;
  }
  return 5;
}

function getPopoverPosition(anchorRect, compact = false, slotIndex = 0) {
  if (!anchorRect || typeof window === "undefined") {
    return { top: 0, left: 0, placement: "right", arrowOffset: 48, maxHeight: null, width: compact ? 420 : 520, overflowBelow: 0 };
  }

  if (window.innerWidth <= 640) {
    return { top: 0, left: 0, placement: "sheet", arrowOffset: 0, maxHeight: Math.round(window.innerHeight * 0.62), width: 0, overflowBelow: 0 };
  }

  const width = Math.min(compact ? 420 : 520, window.innerWidth - 24);
  const gap = 2;
  const margin = 12;
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  const viewportLeft = scrollX;
  const viewportRight = scrollX + window.innerWidth;
  const anchorCenterX = anchorRect.left + (anchorRect.width / 2);
  const anchorLeft = anchorRect.left;
  const anchorRight = anchorRect.right;
  const anchorTop = anchorRect.top;
  const anchorBottom = anchorRect.bottom;
  const anchorCenterY = anchorTop + (anchorRect.height / 2);
  const columns = getDesktopColumns();
  const columnIndex = slotIndex % columns;
  const openBottom = columns >= 5 && columnIndex === 2;
  const openRight = columnIndex < Math.floor(columns / 2);

  let placement = openBottom ? "bottom" : (openRight ? "right" : "left");
  let left = scrollX;

  if (placement === "bottom") {
    left = Math.max(
      viewportLeft + margin,
      Math.min(scrollX + anchorCenterX - (width / 2), viewportRight - width - margin),
    );
  } else {
    left = scrollX + (placement === "right" ? anchorRight + gap : anchorLeft - width - gap);

    if (placement === "right" && left + width > viewportRight - margin) {
      placement = "left";
      left = scrollX + anchorLeft - width - gap;
    } else if (placement === "left" && left < viewportLeft + margin) {
      placement = "right";
      left = scrollX + anchorRight + gap;
    }

    if (placement === "right" && left + width > viewportRight - margin) {
      left = viewportRight - width - margin;
    }
    if (placement === "left" && left < viewportLeft + margin) {
      left = viewportLeft + margin;
    }
  }

  const top = scrollY + (placement === "bottom" ? anchorBottom + gap : anchorTop + 6);
  const popoverHeight = compact ? 320 : 560;
  const viewportBottom = scrollY + window.innerHeight;
  const overflowBelow = Math.max(0, top + popoverHeight + margin - viewportBottom);
  const arrowOffset = placement === "bottom"
    ? Math.max(30, Math.min(width - 30, scrollX + anchorCenterX - left))
    : Math.max(26, Math.min(popoverHeight - 26, anchorCenterY - anchorTop + 6));

  return { top, left, placement, arrowOffset, maxHeight: null, width, overflowBelow };
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "available") {
    return "success";
  }
  if (normalized === "reserved" || normalized === "pending" || normalized === "confirmed") {
    return "warning";
  }
  if (normalized === "occupied" || normalized === "in_progress") {
    return "danger";
  }
  if (normalized === "maintenance" || normalized === "cancelled") {
    return "muted";
  }
  return "info";
}

function mapOverviewLotToBookingLot(lot) {
  return {
    id: lot.parking_id,
    name: lot.parking_name || "",
    address: lot.parking_address || "",
    district: lot.district || "",
    has_roof: Boolean(lot.has_roof),
    distance: lot.distance ?? "",
    price_per_hour: Number(lot.price_per_hour || 0),
    price_per_day: Number(lot.price_per_day || 0),
    price_per_month: Number(lot.price_per_month || 0),
  };
}

function formatDistance(distance) {
  const parsed = Number(distance);
  if (!Number.isFinite(parsed)) {
    return "--";
  }
  if (parsed < 1) {
    return parsed.toFixed(2);
  }
  return parsed.toFixed(1);
}

const PARKING_IMAGE_PALETTE = [
  ["#0ea5e9", "#082f49"],
  ["#14b8a6", "#123f3d"],
  ["#f59e0b", "#7c2d12"],
  ["#ef4444", "#57151a"],
  ["#8b5cf6", "#2e1065"],
  ["#22c55e", "#14532d"],
];

function escapeSvgText(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function hashString(value = "") {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function getParkingImageSrc(lot = {}) {
  const coverImage = String(lot.cover_image || "").trim();

  if (coverImage) {
    return coverImage;
  }

  const parkingId = Number(lot.parking_id ?? lot.id ?? 0);
  const seed = `${lot.parking_id ?? lot.id ?? ""}-${lot.parking_name ?? lot.name ?? ""}`;
  const hash = hashString(seed || "parking");
  const [startColor, endColor] = PARKING_IMAGE_PALETTE[hash % PARKING_IMAGE_PALETTE.length];
  const title = escapeSvgText((lot.parking_name || lot.name || "Bãi xe").trim());
  const subtitle = escapeSvgText((lot.parking_address || lot.address || "Smart Parking").trim());
  const label = parkingId > 0 ? `#${parkingId}` : `P${String((hash % 89) + 10)}`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 640" role="img" aria-label="${title}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${startColor}" />
          <stop offset="100%" stop-color="${endColor}" />
        </linearGradient>
        <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="960" height="640" rx="48" fill="#08111f" />
      <rect x="28" y="28" width="904" height="584" rx="40" fill="url(#bg)" />
      <circle cx="790" cy="140" r="140" fill="#ffffff" fill-opacity="0.10" />
      <circle cx="200" cy="510" r="110" fill="#ffffff" fill-opacity="0.08" />
      <path d="M96 494c92-106 194-156 318-156 94 0 176 27 250 81 66 49 126 73 180 73" fill="none" stroke="url(#shine)" stroke-width="22" stroke-linecap="round" />
      <rect x="84" y="84" width="124" height="54" rx="20" fill="#ffffff" fill-opacity="0.16" />
      <text x="146" y="123" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#ffffff">P</text>
      <rect x="84" y="494" width="180" height="62" rx="18" fill="#000000" fill-opacity="0.18" />
      <text x="110" y="535" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${label}</text>
      <text x="84" y="322" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="#ffffff">${title}</text>
      <text x="84" y="372" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#e5f3ff" fill-opacity="0.92">${subtitle}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export default function Home({ role = "" }) {
  const navigate = useNavigate();
  const { wallet, loading: walletLoading, error: walletError } = useWallet();
  const [quickCheckinTime, setQuickCheckinTime] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)));
  const [parkingLots, setParkingLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapLoading, setMapLoading] = useState(true);
  const [mapError, setMapError] = useState("");
  const [mapSearchMeta, setMapSearchMeta] = useState(null);
  const [mapNearbyLots, setMapNearbyLots] = useState([]);
  const [selectedMapLotId, setSelectedMapLotId] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [expandedLots, setExpandedLots] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [walletPulse, setWalletPulse] = useState(false);
  const popoverRef = useRef(null);

  const isOwner = role === "owner";

  const filteredLots = useMemo(() => {
    return parkingLots.filter((lot) => {
      const matchesSearch = 
        searchQuery === "" ||
        lot.parking_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lot.parking_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lot.district && lot.district.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesFilter = 
        filterStatus === "all" ||
        (filterStatus === "available" && lot.available_slots > 0) ||
        (filterStatus === "full" && lot.available_slots === 0);
      
      return matchesSearch && matchesFilter;
    });
  }, [parkingLots, searchQuery, filterStatus]);

  const enrichedMapLots = useMemo(
    () => mergeParkingSearchWithOverview(mapNearbyLots, filteredLots),
    [filteredLots, mapNearbyLots],
  );

  const mapPreviewLot = useMemo(
    () => enrichedMapLots.find((lot) => Number(lot.id) === Number(selectedMapLotId)) || enrichedMapLots[0] || null,
    [enrichedMapLots, selectedMapLotId],
  );

  const mapStats = useMemo(() => {
    const totalLots = enrichedMapLots.length;
    const highAvailabilityLots = enrichedMapLots.filter((lot) => {
      const availablePercent = Math.round((Number(lot.available_slots || 0) / Math.max(1, Number(lot.total_slots || 1))) * 100);
      return availablePercent > 50;
    }).length;

    return {
      totalLots,
      highAvailabilityLots,
    };
  }, [enrichedMapLots]);

  const quickLocationValue = useMemo(() => {
    if (mapLoading) {
      return "Đang xác định vị trí";
    }

    if (mapError) {
      return "Chưa xác định vị trí";
    }

    if (mapPreviewLot?.district) {
      return mapPreviewLot.district;
    }

    const address = String(mapPreviewLot?.parking_address || mapPreviewLot?.address || "").trim();
    if (address) {
      const segments = address
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (segments.length >= 2) {
        return `${segments[segments.length - 2]}, ${segments[segments.length - 1]}`;
      }
      return segments[0];
    }

    if (mapSearchMeta?.lat && mapSearchMeta?.lng) {
      return `${Number(mapSearchMeta.lat).toFixed(4)}, ${Number(mapSearchMeta.lng).toFixed(4)}`;
    }

    return "Chưa xác định vị trí";
  }, [mapError, mapLoading, mapPreviewLot?.address, mapPreviewLot?.district, mapPreviewLot?.parking_address, mapSearchMeta?.lat, mapSearchMeta?.lng]);

  const handleQuickSearchToBooking = useCallback(() => {
    navigate("/booking", {
      state: {
        quickSearch: {
          checkinTime: quickCheckinTime,
          coordinates:
            mapSearchMeta && Number.isFinite(Number(mapSearchMeta.lat)) && Number.isFinite(Number(mapSearchMeta.lng))
              ? {
                  lat: Number(mapSearchMeta.lat),
                  lng: Number(mapSearchMeta.lng),
                }
              : null,
          locationLabel: quickLocationValue,
          source: "home-quick-bar",
        },
      },
    });
  }, [mapSearchMeta, navigate, quickCheckinTime, quickLocationValue]);

  useEffect(() => {
    if (!wallet || !Number.isFinite(Number(wallet.balance))) {
      return undefined;
    }

    setWalletPulse(true);
    const pulseTimer = window.setTimeout(() => setWalletPulse(false), 240);
    return () => window.clearTimeout(pulseTimer);
  }, [wallet?.balance]);

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setLoading(true);

      try {
        const overviewRes = await API.get(isOwner ? "/owner/parking-lots/slots-overview" : "/parking-lots/slots-overview");
        if (!active) {
          return;
        }

        const normalizedLots = (overviewRes.data || []).map((lot) => ({
          ...lot,
          slots: [...(lot.slots || [])].sort((a, b) =>
            String(a.code).localeCompare(String(b.code), undefined, { numeric: true }),
          ),
        }));

        setParkingLots(normalizedLots);
        setExpandedLots((prev) => {
          const next = {};
          for (const lot of normalizedLots) {
            next[lot.parking_id] = prev[lot.parking_id] ?? false;
          }
          return next;
        });
      } catch {
        if (!active) {
          return;
        }
        setParkingLots([]);
        setExpandedLots({});
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, [isOwner]);

  const refreshNearbyMap = useCallback(async () => {
    setMapLoading(true);
    setMapError("");

    try {
      const payload = await searchNearbyByCurrentLocation({ limit: 10 });
      setMapSearchMeta(payload.center);
      setMapNearbyLots(payload.nearby);
      setSelectedMapLotId(payload.nearby[0]?.id ?? null);
    } catch (error) {
      setMapSearchMeta(null);
      setMapNearbyLots([]);
      setSelectedMapLotId(null);
      setMapError(error?.message || "Không thể tải bản đồ gần bạn");
    } finally {
      setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshNearbyMap();
  }, [refreshNearbyMap]);

  useEffect(() => {
    if (!selectedSlot) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (popoverRef.current?.contains(event.target)) {
        return;
      }

      const anchor = document.elementFromPoint(selectedSlot.anchorCenterX, selectedSlot.anchorCenterY);
      if (anchor?.closest?.(`[data-slot-anchor="${selectedSlot.slot.id}"]`)) {
        return;
      }

      setSelectedSlot(null);
    };

    const handleViewportChange = () => {
      setSelectedSlot((prev) => {
        if (!prev) {
          return prev;
        }

        const anchor = document.querySelector(`[data-slot-anchor="${prev.slot.id}"]`);
        if (!anchor) {
          return null;
        }

        const rect = anchor.getBoundingClientRect();
        return {
          ...prev,
          anchorRect: rect,
          anchorCenterX: rect.left + rect.width / 2,
          anchorCenterY: rect.top + rect.height / 2,
        };
      });
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [selectedSlot]);

  useEffect(() => {
    if (!selectedSlot?.slot?.id || !isOwner) {
      return undefined;
    }

    let active = true;

    const loadSlotDetail = async () => {
      try {
        const response = await API.get(`/owner/slots/${selectedSlot.slot.id}/detail`);
        if (!active) {
          return;
        }
        setSelectedSlot((prev) => {
          if (!prev || prev.slot.id !== selectedSlot.slot.id) {
            return prev;
          }
          return {
            ...prev,
            detail: response.data,
            detailLoading: false,
            detailError: "",
          };
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setSelectedSlot((prev) => {
          if (!prev || prev.slot.id !== selectedSlot.slot.id) {
            return prev;
          }
          return {
            ...prev,
            detail: null,
            detailLoading: false,
            detailError: error?.response?.data?.detail || "Không tải được chi tiết chỗ đỗ.",
          };
        });
      }
    };

    loadSlotDetail();

    return () => {
      active = false;
    };
  }, [selectedSlot?.slot?.id, isOwner]);

  const handleSlotClick = (lot, slot, slotIndex, event) => {
    // If user (not owner) clicks a slot, navigate to booking with prefilled lot and slot
    if (!isOwner) {
      // prevent any parent handlers
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      navigate(
        `/booking?lotId=${lot.parking_id}&slotId=${slot.id}&slotName=${encodeURIComponent(slot.code || slot.slot_number || "")}`,
        {
          state: {
            selectedLot: mapOverviewLotToBookingLot(lot),
          },
        },
      );
      return;
    }

    const anchorRect = event.currentTarget.getBoundingClientRect();

    setSelectedSlot({
      lot,
      slot,
      slotIndex,
      anchorRect,
      anchorCenterX: anchorRect.left + anchorRect.width / 2,
      anchorCenterY: anchorRect.top + anchorRect.height / 2,
      detail: null,
      detailLoading: true,
      detailError: "",
    });
  };

  const slotDetail = selectedSlot?.detail || null;
  const detailedSlot = slotDetail?.slot || null;
  const detailParking = slotDetail?.parking || null;
  const detailBooking = slotDetail?.booking || null;
  const hasOwnerDetail = Boolean(slotDetail?.access?.has_owner_detail);
  const isCompactPopover = Boolean(selectedSlot) && !selectedSlot?.detailLoading && !hasOwnerDetail && !detailBooking;
  const popoverPosition = useMemo(
    () => getPopoverPosition(selectedSlot?.anchorRect, isCompactPopover, selectedSlot?.slotIndex || 0),
    [selectedSlot?.anchorRect, isCompactPopover, selectedSlot?.slotIndex],
  );
  const pageSpacerHeight = selectedSlot ? Math.max(0, (popoverPosition.overflowBelow || 0) + 24) : 0;

  const toggleLot = (parkingId) => {
    setExpandedLots((prev) => ({
      ...prev,
      [parkingId]: !prev[parkingId],
    }));
  };

  return (
    <section className="parking-home">
      <div className="home-grid">

        {/* SIDEBAR */}
        <aside className="home-sidebar">

          <div className="sidebar-logo">
            <img src="/assets/images/logo.png" alt="logo" />
            <div>
              <h2>Smart Parking</h2>
              <span>Tìm chỗ đỗ xe dễ dàng</span>
            </div>
          </div>

          <div className="sidebar-menu">

            <div className="sidebar-item active">🏠 Trang chủ</div>
            <div className="sidebar-item">🔍 Tìm bãi xe</div>
            <div className="sidebar-item">📅 Đặt chỗ của tôi</div>
            <div className="sidebar-item">🕘 Lịch sử đặt chỗ</div>
            <div className="sidebar-item">💳 Ví của tôi</div>
            <div className="sidebar-item">🚗 Phương tiện</div>
            <div className="sidebar-item">🔔 Thông báo</div>
            <div className="sidebar-item">⚙️ Cài đặt</div>

          </div>

          {/* WALLET SIDEBAR */}
          <div className="sidebar-wallet">

            <div className="sidebar-wallet-top">
              <span>Số dư ví</span>

              <button className="sidebar-wallet-add">
                +
              </button>
            </div>

            {walletLoading ? (
              <div className="sidebar-wallet-skeleton" aria-label="Đang tải số dư" />
            ) : walletError ? (
              <p className="sidebar-wallet-error">Không tải được số dư</p>
            ) : (
              <h2 className={`sidebar-wallet-value${walletPulse ? " is-updated" : ""}`}>
                {formatCurrency(wallet?.balance || 0)}
              </h2>
            )}

          </div>

          {/* SUPPORT */}
          <div className="sidebar-support">

            <h3>Hỗ trợ 24/7</h3>

            <p>
              Chúng tôi luôn sẵn sàng hỗ trợ bạn
            </p>

            <button>
              Liên hệ ngay
            </button>

          </div>

          {/* PROFILE */}
          <div className="sidebar-profile">

            <img
              src="/assets/images/avatar.jpg"
              alt="avatar"
            />

            <div>
              <strong>Nguyễn Văn An</strong>
              <span>0901234567</span>
            </div>

          </div>

        </aside>

        {/* MAIN */}
        <main className="home-main">

          {/* TOPBAR */}
          <div className="topbar">

            <div className="topbar-left">

              <div className="location-box">
                📍 TP. Hồ Chí Minh
              </div>

              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input
                  className="search-input"
                  placeholder="Tìm bãi xe, địa điểm..."
                />
              </div>

            </div>

            <div className="topbar-right">

              <div className="notification-btn">
                🔔
                <span className="notification-dot"></span>
              </div>

              <div className="user-box">
                <img src="/assets/images/avatar.jpg" alt="" />
              </div>

            </div>

          </div>

          {/* HERO */}
          <div className="hero-card">

            <div className="hero-left">

              <h1>Tìm bãi xe phù hợp</h1>

              <p className="hero-sub">
                Nhanh chóng – Tiện lợi – An toàn
              </p>

              <div className="hero-controls">
                <QuickBookingBar
                  locationValue={quickLocationValue}
                  isLocationLoading={mapLoading}
                  dateTimeValue={quickCheckinTime}
                  onDateTimeChange={setQuickCheckinTime}
                  onRefreshLocation={refreshNearbyMap}
                  onSearch={handleQuickSearchToBooking}
                  disabled={mapLoading}
                />

              </div>

            </div>

            <div className="hero-right">
              <img src="/assets/images/hero-car.png" alt="" />
            </div>

          </div>

          {/* QUICK ACTION */}
          <div className="quick-actions">

            <button className="qa-btn">🔍<br />Tìm bãi xe</button>
            <button className="qa-btn">📅<br />Đặt chỗ nhanh</button>
            <button className="qa-btn">📷<br />Quét QR</button>
            <button className="qa-btn">💳<br />Nạp tiền</button>
            <button className="qa-btn">🎁<br />Ưu đãi</button>
            <button className="qa-btn">🎧<br />Hỗ trợ</button>

          </div>

          {/* PARKING */}
          <div className="page-card">

            <h2 className="parking-title">Bãi xe gần bạn</h2>

            <div className="featured-parking">

              {filteredLots.slice(0, 4).map((lot) => (
                <div
                  key={lot.parking_id}
                  className="featured-card"
                >

                  <img
                    src={getParkingImageSrc(lot)}
                    alt={lot.parking_name}
                  />

                  <div className="featured-meta">

                    <h3>{lot.parking_name}</h3>

                    <p className="featured-sub">
                      {lot.parking_address}
                    </p>

                    <div className="featured-row">

                      <span className="badge">
                        Còn trống {Math.round((lot.available_slots / lot.total_slots) * 100)}%
                      </span>

                      <strong className="price">
                        {lot.price_per_hour}.000đ
                      </strong>

                    </div>

                    <button
                      className="action-btn"
                      onClick={() =>
                        navigate(`/booking?lotId=${lot.parking_id}`)
                      }
                    >
                      Đặt chỗ
                    </button>

                  </div>

                </div>
              ))}

            </div>

          </div>

          {/* MAP */}
          <div className="map-card">

            <div className="map-header">

              <h3>Bản đồ bãi xe</h3>

              <div className="map-header-actions">
                <div className="map-stats">
                  <span className="map-stat-pill">Gần bạn: {mapStats.totalLots}</span>
                  <span className="map-stat-pill map-stat-pill--good">Còn trống tốt: {mapStats.highAvailabilityLots}</span>
                </div>

                <button
                  type="button"
                  className="map-refresh-btn"
                  onClick={refreshNearbyMap}
                  disabled={mapLoading}
                >
                  {mapLoading ? "Đang tải..." : "Lấy vị trí hiện tại"}
                </button>

                <div className="map-legend">
                  <span className="legend available">Còn trống</span>
                  <span className="legend warning">Sắp đầy</span>
                  <span className="legend full">Đầy</span>
                </div>
              </div>

            </div>

            <div className="map-wrapper">

              {mapLoading ? (
                <div className="map-empty-state map-empty-state--loading">
                  <div className="map-empty-title">Đang định vị khu vực gần bạn</div>
                  <p>Home đang dùng cùng nguồn dữ liệu bản đồ với Booking để lấy các bãi xe thật từ vị trí hiện tại.</p>
                </div>
              ) : mapError ? (
                <div className="map-empty-state">
                  <div className="map-empty-title">Không thể tải bản đồ gần bạn</div>
                  <p>{mapError}</p>
                  <button type="button" className="map-empty-btn" onClick={refreshNearbyMap}>
                    Thử lại
                  </button>
                </div>
              ) : (
                <div className="map-shell">
                  <div className="map-stage">
                    <NearbyParkingMap
                      searchMeta={mapSearchMeta}
                      nearbyLots={enrichedMapLots}
                      selectedLotId={selectedMapLotId}
                      onSelectLot={(lot) => setSelectedMapLotId(lot.id)}
                    />
                  </div>

                  <div className="map-overlay-layer">
                    {mapPreviewLot ? (
                      <div className="map-preview-card is-selected">

                        <img
                          src={getParkingImageSrc(mapPreviewLot)}
                          alt=""
                        />

                        <div className="map-preview-content">

                          <h4>{mapPreviewLot.parking_name || mapPreviewLot.name}</h4>

                          <p>{mapPreviewLot.parking_address || mapPreviewLot.address}</p>

                          <div className="map-preview-row">
                            Khoảng cách: {formatDistance(mapPreviewLot.distance)} km
                          </div>

                          <div className="map-preview-row">
                            🟢 Còn trống: {Math.round((Number(mapPreviewLot.available_slots || 0) / Math.max(1, Number(mapPreviewLot.total_slots || 1))) * 100)}%
                          </div>

                          <div className="map-preview-price">
                            {mapPreviewLot.price_per_hour}.000đ/giờ
                          </div>

                          <button
                            type="button"
                            onClick={() => navigate(`/booking?lotId=${mapPreviewLot.parking_id}`)}
                          >
                            Xem chi tiết
                          </button>

                        </div>

                      </div>
                    ) : null}
                  </div>

                  {enrichedMapLots.length > 0 ? (
                    <div className="map-nearby-list" role="list" aria-label="Danh sách bãi xe gần bạn">
                      {enrichedMapLots.slice(0, 6).map((lot) => {
                        const availablePercent = Math.round((Number(lot.available_slots || 0) / Math.max(1, Number(lot.total_slots || 1))) * 100);
                        const isSelected = Number(lot.id) === Number(selectedMapLotId);

                        return (
                          <button
                            key={lot.id}
                            type="button"
                            role="listitem"
                            className={`map-nearby-item${isSelected ? " is-selected" : ""}`}
                            onClick={() => setSelectedMapLotId(lot.id)}
                          >
                            <strong>{lot.parking_name || lot.name}</strong>
                            <span>{formatDistance(lot.distance)} km</span>
                            <span className="map-nearby-item-meta">{availablePercent}% chỗ trống</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}

            </div>

          </div>

        </main>

      </div>
    </section>
  );
}
