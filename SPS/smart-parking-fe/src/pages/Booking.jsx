import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import API, { getAuth, saveAuth } from "../services/api";
import { formatDateOnlyVN, toDateInputValue, toDatetimeLocalValue, toVietnamIsoString } from "../utils/dateTime";
import ParkingMap from "../components/ParkingMap";
import NearbyParkingMap from "../components/NearbyParkingMap";
import "./Booking.css";
import { isValidCoordinate, normalizeParkingSearchLot, searchNearbyByCurrentLocation, searchParkingByAddress, searchParkingByCoords } from "../services/parkingSearch";

const formatDisplayDate = (date) => {
  return formatDateOnlyVN(date, "");
};

const parseDateValue = (value) => {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const addMonths = (date, months) => {
  const result = new Date(date);
  const currentDay = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const maxDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(currentDay, maxDay));
  return result;
};
const BOOKING_MODE_OPTIONS = [
  {
    value: "hourly",
    label: "Theo giờ",
    description: "Chọn giờ vào và giờ ra",
  },
  {
    value: "daily",
    label: "Theo ngày",
    description: "Chọn ngày bắt đầu và ngày kết thúc",
  },
  {
    value: "monthly",
    label: "Theo tháng",
    description: "Chọn ngày bắt đầu và số tháng",
  },
];

const getEarliestStartDate = () => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const hoursPassedToday = (now.getTime() - today.getTime()) / (1000 * 60 * 60);
  // Allow today if less than 12 hours have passed since 00:00, otherwise use tomorrow
  return hoursPassedToday < 12 ? today : new Date(today.getTime() + 24 * 60 * 60 * 1000);
};

const buildDefaultBookingForm = (profile = {}) => {
  const now = new Date();
  const startDateDaily = getEarliestStartDate();
  const endDateDaily = new Date(startDateDaily.getTime() + 24 * 60 * 60 * 1000);
  const afterTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return {
    ownerName: profile?.name || "",
    licensePlate: profile?.vehicle_plate || profile?.licensePlate || "",
    contactPhone: profile?.phone || profile?.phone_number || "",
    vehicleColor: profile?.vehicle_color || profile?.vehicleColor || "",
    vehicleType: "",
    seats: "",
    brand: "",
    bookingMode: "hourly",
    checkinTime: toDatetimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000)),
    checkoutTime: toDatetimeLocalValue(afterTwoHours),
    startDate: toDateInputValue(startDateDaily),
    endDate: toDateInputValue(endDateDaily),
    monthCount: 1,
  };
};

const parseSeatCount = (value) => {
  if (!value) {
    return null;
  }
  const match = String(value).match(/\d+/);
  if (!match) {
    return null;
  }
  const seatCount = Number(match[0]);
  if (!Number.isInteger(seatCount) || seatCount <= 0) {
    return null;
  }
  return seatCount;
};

const formatSeats = (seatCount) => {
  if (!seatCount) {
    return "";
  }
  return `${seatCount} chỗ`;
};

const normalizeSelectedLot = (lot) => {
  const normalized = normalizeParkingSearchLot(lot);

  if (!normalized || !normalized.id) {
    return null;
  }

  return {
    ...normalized,
    priceLoaded: Boolean(lot.priceLoaded),
  };
};


export default function Booking() {
  const location = useLocation();
  const isBookingRoute = location.pathname === "/booking";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = getAuth();
  const [address, setAddress] = useState("");
  const [sortBy, setSortBy] = useState("nearest");
  const [coveredOnly, setCoveredOnly] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [searchMeta, setSearchMeta] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [selectedLot, setSelectedLot] = useState(() => normalizeSelectedLot(location.state?.selectedLot));
  const [availableSlots, setAvailableSlots] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [bookingForm, setBookingForm] = useState(() => buildDefaultBookingForm(auth?.user || {}));
  const [bookingLoading, setBookingLoading] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [vehicleNotice, setVehicleNotice] = useState("");
  const [bookingResult, setBookingResult] = useState(null);
  const [profile, setProfile] = useState(() => auth?.user || null);
  const [step, setStep] = useState(1);
  const [expandedLotId, setExpandedLotId] = useState(null);
  const [prefilledSlotName, setPrefilledSlotName] = useState("");
  const quickSearchAppliedRef = useRef("");
  const bookingSectionRef = useRef(null);
  const bookingSubmitLockRef = useRef(false);
  const bookingWindow = useMemo(() => buildBookingWindow(bookingForm), [bookingForm]);
  const estimatedCharge = useMemo(
    () => computeEstimatedCharge(selectedLot, bookingWindow),
    [selectedLot, bookingWindow],
  );
  const bookingRangePreview = useMemo(() => {
    if (!bookingWindow.ok) {
      return null;
    }

    return {
      start: formatDisplayDate(bookingWindow.checkinDate),
      end: formatDisplayDate(bookingWindow.checkoutDate),
    };
  }, [bookingWindow]);

  const normalizeError = (err) => {
    const detail = err?.response?.data?.detail;
    if (detail && typeof detail === "object") {
      if (typeof detail.message === "string") {
        return detail.message;
      }
      if (typeof detail.detail === "string") {
        return detail.detail;
      }
    }
    if (typeof detail === "string") {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      if (typeof first === "string") {
        return first;
      }
      if (first?.msg) {
        return first.msg;
      }
    }
    return err?.response?.data?.error || "Đặt chỗ thất bại";
  };

  const applySearchResult = (payload) => {
    setNearby(payload.nearest || []);
    setSearchMeta(payload.center || null);
  };

  useEffect(() => {
    setSelectedLot(normalizeSelectedLot(location.state?.selectedLot));
  }, [location.state]);

  useEffect(() => {
    const loadLotPricing = async () => {
      if (!selectedLot?.id || selectedLot.priceLoaded) {
        return;
      }

      try {
        const res = await API.get(`/parking-lots/${selectedLot.id}`);
        setSelectedLot((prev) => {
          if (!prev || Number(prev.id) !== Number(selectedLot.id)) {
            return prev;
          }
          return normalizeSelectedLot({
            ...prev,
            ...res.data,
            priceLoaded: true,
          });
        });
      } catch {
        setSelectedLot((prev) => {
          if (!prev || Number(prev.id) !== Number(selectedLot.id)) {
            return prev;
          }
          return {
            ...prev,
            priceLoaded: true,
          };
        });
      }
    };

    loadLotPricing();
  }, [selectedLot?.id, selectedLot?.priceLoaded]);

  useEffect(() => {
    if (location.state?.paymentNotice) {
      setError("");
      setBookingResult({ message: location.state.paymentNotice });
    }
  }, [location.state]);

  useEffect(() => {
    const quickSearch = location.state?.quickSearch;
    if (!quickSearch) {
      return;
    }

    if (quickSearchAppliedRef.current === location.key) {
      return;
    }

    quickSearchAppliedRef.current = location.key;

    const nextCheckinTime = String(quickSearch.checkinTime || "").trim();
    if (nextCheckinTime) {
      const checkinDate = new Date(nextCheckinTime);
      const checkoutDate = Number.isNaN(checkinDate.getTime())
        ? null
        : new Date(checkinDate.getTime() + 2 * 60 * 60 * 1000);

      setBookingForm((prev) => ({
        ...prev,
        bookingMode: "hourly",
        checkinTime: nextCheckinTime,
        checkoutTime: checkoutDate ? toDatetimeLocalValue(checkoutDate) : prev.checkoutTime,
      }));
    }

    const runQuickSearch = async () => {
      try {
        setError("");
        setSearching(true);

        let payload = null;
        const quickCoordinates = quickSearch.coordinates;

        if (isValidCoordinate(quickCoordinates?.lat, quickCoordinates?.lng)) {
          payload = await searchParkingByCoords({
            lat: Number(quickCoordinates.lat),
            lng: Number(quickCoordinates.lng),
            limit: 5,
            sortBy,
            coveredOnly,
          });
        } else if (quickSearch.address && String(quickSearch.address).trim()) {
          const normalizedAddress = String(quickSearch.address).trim();
          setAddress(normalizedAddress);
          payload = await searchParkingByAddress({
            address: normalizedAddress,
            limit: 5,
            sortBy,
            coveredOnly,
          });
        }

        if (!payload) {
          return;
        }

        applySearchResult({
          query: payload.query,
          center: payload.center,
          nearest: payload.nearby,
        });
      } catch (err) {
        setNearby([]);
        setSearchMeta(null);
        setError(normalizeError(err));
      } finally {
        setSearching(false);
      }
    };

    runQuickSearch();
  }, [coveredOnly, location.key, location.state, sortBy]);

  useEffect(() => {
    const lotIdParam = searchParams.get("lotId");
    const slotIdParam = searchParams.get("slotId");
    const slotNameParam = searchParams.get("slotName");

    if (lotIdParam && slotIdParam) {
      const lotId = Number(lotIdParam);
      const slotId = Number(slotIdParam);

      if (lotId && slotId) {
        setSelectedLot((prev) => {
          if (prev?.id === lotId) {
            return prev;
          }

          const stateLot = normalizeSelectedLot(location.state?.selectedLot);
          if (stateLot?.id === lotId) {
            return stateLot;
          }

          return {
            id: lotId,
            name: `Bãi #${lotId}`,
            address: "",
            has_roof: false,
            distance: "",
            price_per_hour: 0,
            price_per_day: 0,
            price_per_month: 0,
            priceLoaded: false,
          };
        });
        setSelectedSlotId(String(slotId));
        setPrefilledSlotName(slotNameParam || "");
      }
    }
  }, [location.state, searchParams]);

  useEffect(() => {
    const loadSlots = async () => {
      if (!selectedLot?.id) {
        setAvailableSlots([]);
        setSelectedSlotId("");
        setBookingResult(null);
        return;
      }

      try {
        setError("");
        setSelectedSlotId("");
        const res = await API.get("/slots", {
          params: { parking_id: selectedLot.id },
        });
        const filteredSlots = (res.data || []).filter((slot) => slot.status === "available");
        setAvailableSlots(filteredSlots);
        setSelectedSlotId(String(filteredSlots[0]?.id || ""));
        setBookingResult(null);
      } catch (err) {
        setAvailableSlots([]);
        setSelectedSlotId("");
        setError(normalizeError(err));
      }
    };

    loadSlots();
  }, [selectedLot]);

  useEffect(() => {
    if (selectedLot?.id) {
      bookingSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedLot]);

  useEffect(() => {
    if (!selectedLot) {
      setBookingResult(null);
      setBookingForm((prev) => {
        const defaults = buildDefaultBookingForm(profile || auth?.user || {});
        return {
          ...defaults,
          ownerName: prev.ownerName.trim() ? prev.ownerName : defaults.ownerName,
          licensePlate: prev.licensePlate.trim() ? prev.licensePlate : defaults.licensePlate,
          contactPhone: prev.contactPhone.trim() ? prev.contactPhone : defaults.contactPhone,
          vehicleColor: prev.vehicleColor.trim() ? prev.vehicleColor : defaults.vehicleColor,
          brand: prev.brand.trim() ? prev.brand : defaults.brand,
          vehicleType: prev.vehicleType.trim() ? prev.vehicleType : defaults.vehicleType,
          seats: prev.seats.trim() ? prev.seats : defaults.seats,
        };
      });
    }
  }, [auth?.user, profile, selectedLot]);

  useEffect(() => {
    const refreshProfile = async () => {
      if (!auth?.token) {
        setProfile(null);
        return;
      }

      try {
        const res = await API.get("/auth/me");
        const nextProfile = {
          ...auth.user,
          ...res.data,
        };
        setProfile(nextProfile);
        saveAuth({ ...auth, user: nextProfile });
      } catch {
        setProfile(auth?.user || null);
      }
    };

    refreshProfile();
  }, [auth?.token]);

  useEffect(() => {
    const loadVehicleProfile = async () => {
      if (!auth?.token) {
        return;
      }

      try {
        const res = await API.get("/vehicle/my");
        const vehicle = res.data?.vehicle || {};
        setBookingForm((prev) => ({
          ...prev,
          licensePlate: prev.licensePlate.trim() ? prev.licensePlate : (vehicle.license_plate || ""),
          brand: prev.brand.trim() ? prev.brand : (vehicle.brand || ""),
          vehicleType: prev.vehicleType.trim() ? prev.vehicleType : (vehicle.vehicle_model || ""),
          seats: prev.seats.trim() ? prev.seats : formatSeats(vehicle.seat_count),
          vehicleColor: prev.vehicleColor.trim() ? prev.vehicleColor : (vehicle.vehicle_color || ""),
        }));
      } catch {
        // Ignore when the user has not saved any vehicle profile yet.
      }
    };

    loadVehicleProfile();
  }, [auth?.token]);

  useEffect(() => {
    if (!profile) {
      return;
    }

    setBookingForm((prev) => ({
      ...prev,
      ownerName: prev.ownerName.trim() ? prev.ownerName : (profile.name || ""),
      licensePlate: prev.licensePlate.trim() ? prev.licensePlate : (profile.vehicle_plate || ""),
      contactPhone: prev.contactPhone.trim() ? prev.contactPhone : (profile.phone || ""),
      vehicleColor: prev.vehicleColor.trim() ? prev.vehicleColor : (profile.vehicle_color || ""),
    }));
  }, [profile]);

  const handleSearchNearby = async () => {
    if (!address.trim()) {
      setError("Vui lòng nhập địa điểm cần tìm bãi xe");
      return;
    }

    try {
      setError("");
      setSearching(true);
      const payload = await searchParkingByAddress({
        address: address.trim(),
        limit: 5,
        sortBy,
        coveredOnly,
      });
      applySearchResult({
        query: payload.query,
        center: payload.center,
        nearest: payload.nearby,
      });
    } catch (err) {
      setNearby([]);
      setSearchMeta(null);
      setError(normalizeError(err));
    } finally {
      setSearching(false);
    }
  };

  const handleUseCurrentLocation = () => {
    const loadNearby = async () => {
      try {
        setError("");
        setSearching(true);
        const payload = await searchNearbyByCurrentLocation({
          limit: 5,
          sortBy,
          coveredOnly,
        });
        applySearchResult({
          query: payload.query,
          center: payload.center,
          nearest: payload.nearby,
        });
      } catch (err) {
        setNearby([]);
        setSearchMeta(null);
        setError(normalizeError(err));
      } finally {
        setSearching(false);
      }
    };

    loadNearby();
  };

  const handleSelectLot = (lot) => {
    setSelectedLot(normalizeSelectedLot(lot));
    setBookingResult(null);
    setError("");
    setBookingError("");
    setPrefilledSlotName("");
  };

  const handleSlotSelectFromMap = (slot) => {
    setSelectedSlotId(String(slot.id));
    setPrefilledSlotName(slot.code || slot.slot_number || "");
    setError("");
    setBookingError("");
  };

  const handleToggleLotDetail = (lotId) => {
    setExpandedLotId((prev) => (prev === lotId ? null : lotId));
  };

  const handleBookingModeChange = (mode) => {
    const now = new Date();
    const startDateDaily = getEarliestStartDate();
    const endDateDaily = new Date(startDateDaily.getTime() + 24 * 60 * 60 * 1000);
    const afterTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    setBookingForm((prev) => {
      const checkinDate = new Date(prev.checkinTime);
      const checkoutDate = new Date(prev.checkoutTime);
      const safeCheckinTime = Number.isNaN(checkinDate.getTime())
        ? toDatetimeLocalValue(new Date(now.getTime() + 60 * 60 * 1000))
        : prev.checkinTime;
      const safeCheckoutTime = Number.isNaN(checkoutDate.getTime()) || checkoutDate <= checkinDate
        ? toDatetimeLocalValue(afterTwoHours)
        : prev.checkoutTime;

      const startDate = prev.startDate || toDateInputValue(startDateDaily);
      const endDate = prev.endDate || toDateInputValue(endDateDaily);

      return {
        ...prev,
        bookingMode: mode,
        checkinTime: safeCheckinTime,
        checkoutTime: safeCheckoutTime,
        startDate,
        endDate,
        monthCount: Number(prev.monthCount) > 0 ? prev.monthCount : 1,
      };
    });
  };

  const handleCreateBooking = async () => {
    if (bookingLoading || bookingSubmitLockRef.current) {
      return;
    }

    bookingSubmitLockRef.current = true;
    setBookingError("");

    if (!selectedLot) {
      const message = "Vui lòng chọn bãi xe trước";
      setError(message);
      setBookingError(message);
      bookingSubmitLockRef.current = false;
      return;
    }

    if (!selectedSlotId) {
      const message = "Vui lòng chọn slot trống";
      setError(message);
      setBookingError(message);
      bookingSubmitLockRef.current = false;
      return;
    }

    if (!bookingForm.ownerName.trim() || !bookingForm.licensePlate.trim()) {
      const message = "Vui lòng nhập tên chủ xe và biển số xe";
      setError(message);
      setBookingError(message);
      bookingSubmitLockRef.current = false;
      return;
    }

    if (!bookingWindow.ok) {
      const message = bookingWindow.error || "Thời gian booking không hợp lệ";
      setError(message);
      setBookingError(message);
      bookingSubmitLockRef.current = false;
      return;
    }

    try {
      setError("");
      setBookingLoading(true);
      const pendingCreatePayload = {
        parking_id: selectedLot.id,
        slot_id: Number(selectedSlotId),
        license_plate: bookingForm.licensePlate.trim(),
        owner_name: bookingForm.ownerName.trim(),
        vehicle_type: `${bookingForm.vehicleType.trim()} - ${bookingForm.seats.trim()}`.trim() || null,
        vehicle_model: bookingForm.vehicleType.trim() || null,
        seat_count: parseSeatCount(bookingForm.seats),
        brand: bookingForm.brand.trim() || null,
        vehicle_color: bookingForm.vehicleColor.trim() || null,
        booking_mode: bookingWindow.bookingMode,
        month_count: bookingWindow.bookingMode === "monthly" ? bookingWindow.monthCount : null,
        checkin_time: toVietnamIsoString(bookingWindow.checkinDate),
        checkout_time: toVietnamIsoString(bookingWindow.checkoutDate),
      };
      const res = await API.post("/booking/create", pendingCreatePayload);
      navigate(`/payment/success/${res.data.booking_id}`, {
        state: {
          booking: res.data,
        },
      });
    } catch (err) {
      const message = normalizeError(err);
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.reason === "overlap_booking") {
        navigate("/booking-history", {
          state: {
            conflictContext: {
              ...detail,
              pending_create_payload: {
                parking_id: selectedLot?.id,
                slot_id: Number(selectedSlotId),
                license_plate: bookingForm.licensePlate.trim(),
                owner_name: bookingForm.ownerName.trim(),
                vehicle_type: `${bookingForm.vehicleType.trim()} - ${bookingForm.seats.trim()}`.trim() || null,
                vehicle_model: bookingForm.vehicleType.trim() || null,
                seat_count: parseSeatCount(bookingForm.seats),
                brand: bookingForm.brand.trim() || null,
                vehicle_color: bookingForm.vehicleColor.trim() || null,
                booking_mode: bookingWindow.bookingMode,
                month_count: bookingWindow.bookingMode === "monthly" ? bookingWindow.monthCount : null,
                checkin_time: toVietnamIsoString(bookingWindow.checkinDate),
                checkout_time: toVietnamIsoString(bookingWindow.checkoutDate),
              },
              requested_booking_view: {
                parking_name: selectedLot?.name,
                slot_code: availableSlots.find((slot) => String(slot.id) === String(selectedSlotId))?.code || null,
                checkin_time: toVietnamIsoString(bookingWindow.checkinDate),
                checkout_time: toVietnamIsoString(bookingWindow.checkoutDate),
                estimated_total_amount: estimatedCharge.amount,
              },
            },
          },
        });
        return;
      }
      setBookingResult(null);
      setError(message);
      setBookingError(message);
    } finally {
      bookingSubmitLockRef.current = false;
      setBookingLoading(false);
    }
  };

  const handleSaveVehicleProfile = async () => {
    if (!bookingForm.licensePlate.trim()) {
      setVehicleNotice("Vui lòng nhập biển số trước khi lưu thông tin xe");
      return;
    }

    try {
      setSavingVehicle(true);
      setVehicleNotice("");
      await API.post("/vehicle/my/save", {
        license_plate: bookingForm.licensePlate.trim(),
        brand: bookingForm.brand.trim() || null,
        vehicle_model: bookingForm.vehicleType.trim() || null,
        seat_count: parseSeatCount(bookingForm.seats),
        vehicle_color: bookingForm.vehicleColor.trim() || null,
      });

      const verifyRes = await API.get("/vehicle/my");
      const savedVehicle = verifyRes.data?.vehicle || {};
      const expectedPlate = bookingForm.licensePlate.trim().toUpperCase();
      if ((savedVehicle.license_plate || "") !== expectedPlate) {
        throw new Error("Dữ liệu xe chưa được lưu đúng vào CSDL");
      }

      setBookingForm((prev) => ({
        ...prev,
        licensePlate: savedVehicle.license_plate || prev.licensePlate,
        brand: savedVehicle.brand || prev.brand,
        vehicleType: savedVehicle.vehicle_model || prev.vehicleType,
        seats: savedVehicle.seat_count ? `${savedVehicle.seat_count} chỗ` : prev.seats,
        vehicleColor: savedVehicle.vehicle_color || prev.vehicleColor,
      }));
      setVehicleNotice("Đã lưu thông tin xe cho tài khoản của bạn");
    } catch (err) {
      setVehicleNotice(normalizeError(err));
    } finally {
      setSavingVehicle(false);
    }
  };

  if (!isBookingRoute) {
    return null;
  }
  return (
    <div className="booking-dashboard page-wrap">
      <div className="page-card booking-shell dashboard-card">
        <header className="dashboard-topbar">
          <div className="topbar-left">
            <h1 className="page-title">Đặt chỗ - Smart Parking</h1>
            <p className="page-subtitle">Nhanh • An toàn • Thuận tiện</p>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <input
                className="global-search-input"
                placeholder="Tìm địa chỉ, bãi xe, mã..."
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <button className="btn-ghost" onClick={handleSearchNearby} disabled={searching}>🔎</button>
            </div>
            <div className="top-controls">
              <button className="icon-btn">🔔</button>
              <button className="avatar-btn">👤</button>
            </div>
          </div>
        </header>

        <div className="dashboard-grid">
          <aside className="dashboard-left">
            <div className="panel panel--glass">
              <div className="panel-head">
                <strong>Tìm bãi xe</strong>
                <div className="panel-actions">
                  <button className="btn-ghost" onClick={() => { setStep(1); }}>Step 1</button>
                  <button className="btn-ghost" onClick={() => { setStep(2); }}>Step 2</button>
                </div>
              </div>

              <div className="panel-body">
                <div className="booking-tools booking-tools--search compact">
                  <div className="input-with-clear">
                    <input
                      className="booking-input"
                      aria-label="Địa chỉ tìm kiếm"
                      placeholder="Ví dụ: Nguyễn Văn Săng, Tân Phú"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                    {address && (
                      <button
                        type="button"
                        className="input-clear-btn"
                        aria-label="Xóa địa chỉ"
                        onClick={() => setAddress("")}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="tools-row">
                    <button type="button" className="btn-primary btn-primary--search" onClick={handleSearchNearby} disabled={searching}>
                      {searching ? "Đang tìm..." : "Tìm"}
                    </button>
                    <button type="button" className="btn-secondary" onClick={handleUseCurrentLocation} disabled={searching}>
                      📍 Vị trí hiện tại
                    </button>
                  </div>

                  <div className="filter-row compact">
                    <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <option value="nearest">Gần nhất</option>
                      <option value="cheapest">Giá rẻ nhất</option>
                    </select>
                    <label className="filter-checkbox">
                      <input
                        type="checkbox"
                        checked={coveredOnly}
                        onChange={(e) => setCoveredOnly(e.target.checked)}
                      />
                      Có mái che
                    </label>
                  </div>
                </div>

                <div className="parking-cards">
                  {nearby.length === 0 && <div className="empty-note">Không có kết quả. Hãy thử tìm lại.</div>}
                  {nearby.map((lot) => (
                    <div
                      key={lot.id}
                      className={`parking-card ${selectedLot?.id === lot.id ? "is-selected" : ""}`}
                      onClick={() => { handleSelectLot(lot); setStep(2); }}
                    >
                      <div className="card-media" style={{backgroundImage: `linear-gradient(135deg, rgba(20,120,255,0.12), rgba(60,180,255,0.06))`}}>
                        <img alt={lot.name} src={lot.image || `/assets/parking-placeholder.jpg`} />
                      </div>
                      <div className="card-body">
                        <h4 className="card-title">{lot.name}</h4>
                        <p className="card-sub">{lot.address}</p>
                        <div className="card-meta">
                          <span>{lot.distance} km</span>
                          <span>{lot.has_roof ? "Indoor" : "Outdoor"}</span>
                          <span>⭐ {lot.rating || "—"}</span>
                        </div>
                        <div className="card-foot">
                          <div className="occupancy">{Math.round((lot.occupied || 0) * 100) || 0}%</div>
                          <div className="price">{Number(lot.price_per_hour || 0).toLocaleString("vi-VN")}₫/h</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <main className="dashboard-center">
            <div className="map-hero panel panel--glass">
              <NearbyParkingMap
                searchMeta={searchMeta}
                nearbyLots={nearby}
                onSelectLot={(lot) => { handleSelectLot(lot); setStep(2); }}
              />
            </div>

            {/* Mobile: quick step hint */}
            <div className="mobile-steps">
              <div className="step-pill">Bước {step} / 4</div>
            </div>
          </main>

          <aside className="dashboard-right">
            <div className="panel panel--sticky">
              <div className="panel-head">
                <strong>Booking Summary</strong>
                <div className="stepper-compact">Bước {step} / 4</div>
              </div>

              <div className="panel-body summary-body">
                <div className="summary-row">
                  <div className="summary-label">Bãi xe</div>
                  <div className="summary-value">{selectedLot?.name || "Chưa chọn"}</div>
                </div>
                <div className="summary-row">
                  <div className="summary-label">Thời gian</div>
                  <div className="summary-value">{bookingWindow.ok ? `${estimatedCharge.billedUnits} ${estimatedCharge.billedUnit}` : "--"}</div>
                </div>
                <div className="summary-row">
                  <div className="summary-label">Slot</div>
                  <div className="summary-value">{prefilledSlotName || (availableSlots.find((s) => String(s.id) === String(selectedSlotId))?.code) || "--"}</div>
                </div>
                <div className="divider" />
                <div className="summary-row">
                  <div className="summary-label">Subtotal</div>
                  <div className="summary-value">{estimatedCharge.amount.toLocaleString("vi-VN")} ₫</div>
                </div>
                <div className="summary-row small">
                  <div className="summary-label">Deposit (10%)</div>
                  <div className="summary-value">{Math.round(estimatedCharge.amount * 0.1).toLocaleString("vi-VN")} ₫</div>
                </div>
                <div className="summary-row small">
                  <div className="summary-label">Service</div>
                  <div className="summary-value">{Math.round(estimatedCharge.amount * 0.02).toLocaleString("vi-VN")} ₫</div>
                </div>
                <div className="divider" />
                <div className="summary-total">
                  <div className="summary-label">Tổng</div>
                  <div className="summary-value total">{(estimatedCharge.amount + Math.round(estimatedCharge.amount * 0.02)).toLocaleString("vi-VN")} ₫</div>
                </div>

                <div className="summary-actions">
                  <button className="btn-outline" onClick={() => setStep(Math.max(1, step - 1))}>Quay lại</button>
                  <button className="btn-primary" onClick={() => {
                    if (step < 3) { setStep(step + 1); } else { handleCreateBooking(); }
                  }} disabled={bookingLoading}>
                    {step < 3 ? "Tiếp tục" : (bookingLoading ? "Đang xử lý..." : "Xác nhận & Thanh toán")}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Error / result notices and modal remain intact */}
        {(bookingError || error) && <p className="booking-error global-error">{bookingError || error}</p>}

        {bookingResult && ReactDOM.createPortal(
          <div className="qr-modal-overlay" onClick={() => setBookingResult(null)}>
            <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
              <button className="qr-modal-close" onClick={() => setBookingResult(null)}>×</button>
              <h2>Mã QR - Booking #{bookingResult.booking_id}</h2>
              <div className="qr-modal-image">
                <img src={`http://localhost:8000/${bookingResult.qr_code}`} alt="Mã QR đặt chỗ" />
              </div>
              <p className="booking-result-message">{bookingResult.message}</p>
              <div style={{ marginTop: 12 }}>
                <button className="qr-modal-download" onClick={() => {
                  const url = `http://localhost:8000/${bookingResult.qr_code}`;
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `booking-${bookingResult.booking_id}-qr.png`;
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                }}>Tải QR</button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
