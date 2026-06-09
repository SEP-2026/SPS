import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import API, { getAuth, saveAuth } from "../services/api";
import { formatDateOnlyVN, toDateInputValue, toDatetimeLocalValue, toVietnamIsoString } from "../utils/dateTime";
import ParkingMap from "../components/ParkingMap";
import NearbyParkingMap from "../components/NearbyParkingMap";
import "./Booking.css";

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

const buildBookingWindow = (form) => {
  const bookingMode = form.bookingMode || "hourly";

  if (bookingMode === "hourly") {
    const checkinDate = new Date(form.checkinTime);
    const checkoutDate = new Date(form.checkoutTime);
    if (Number.isNaN(checkinDate.getTime()) || Number.isNaN(checkoutDate.getTime())) {
      return { ok: false, error: "Thời gian booking không hợp lệ" };
    }
    if (checkoutDate <= checkinDate) {
      return { ok: false, error: "Thời gian ra phải sau thời gian vào" };
    }
    return {
      ok: true,
      bookingMode,
      checkinDate,
      checkoutDate,
      monthCount: null,
    };
  }

  if (bookingMode === "daily") {
    const startDate = parseDateValue(form.startDate);
    const endDate = parseDateValue(form.endDate);
    if (!startDate || !endDate) {
      return { ok: false, error: "Vui lòng chọn đầy đủ ngày bắt đầu và ngày kết thúc" };
    }
    if (endDate < startDate) {
      return { ok: false, error: "Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu" };
    }
    const checkoutDate = new Date(endDate);
    checkoutDate.setDate(checkoutDate.getDate() + 1);
    return {
      ok: true,
      bookingMode,
      checkinDate: startDate,
      checkoutDate,
      monthCount: null,
    };
  }

  if (bookingMode === "monthly") {
    const startDate = parseDateValue(form.startDate);
    const monthCount = Number(form.monthCount);
    if (!startDate) {
      return { ok: false, error: "Vui lòng chọn ngày bắt đầu cho gói tháng" };
    }
    if (!Number.isInteger(monthCount) || monthCount < 1) {
      return { ok: false, error: "Số tháng phải là số nguyên lớn hơn hoặc bằng 1" };
    }
    return {
      ok: true,
      bookingMode,
      checkinDate: startDate,
      checkoutDate: addMonths(startDate, monthCount),
      monthCount,
    };
  }

  return { ok: false, error: "Kiểu đặt chỗ không hợp lệ" };
};

const computeEstimatedCharge = (lot, window) => {
  if (!lot || !window.ok) {
    return {
      amount: 0,
      resolvedMode: "hourly",
      billedUnits: 0,
      billedUnit: "hour",
      autoConvertedToDaily: false,
    };
  }

  const pricePerHour = Number(lot.price_per_hour || 0);
  const pricePerDay = Number(lot.price_per_day || 0);
  const pricePerMonth = Number(lot.price_per_month || 0);
  const durationHours = (window.checkoutDate.getTime() - window.checkinDate.getTime()) / (1000 * 60 * 60);

  if (window.bookingMode === "monthly") {
    const billedUnits = Number(window.monthCount || 1);
    return {
      amount: Math.round(billedUnits * pricePerMonth),
      resolvedMode: "monthly",
      billedUnits,
      billedUnit: "tháng",
      autoConvertedToDaily: false,
    };
  }

  if (window.bookingMode === "daily") {
    const billedUnits = Math.max(1, Math.ceil(durationHours / 24));
    return {
      amount: Math.round(billedUnits * pricePerDay),
      resolvedMode: "daily",
      billedUnits,
      billedUnit: "ngày",
      autoConvertedToDaily: false,
    };
  }

  if (durationHours > 12) {
    const billedUnits = Math.max(1, Math.ceil(durationHours / 24));
    return {
      amount: Math.round(billedUnits * pricePerDay),
      resolvedMode: "daily",
      billedUnits,
      billedUnit: "ngày",
      autoConvertedToDaily: true,
    };
  }

  const billedUnits = Math.max(1, Math.ceil(durationHours));
  return {
    amount: Math.round(billedUnits * pricePerHour),
    resolvedMode: "hourly",
    billedUnits,
    billedUnit: "giờ",
    autoConvertedToDaily: false,
  };
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
  if (!lot || !lot.id) {
    return null;
  }

  return {
    ...lot,
    id: Number(lot.id),
    name: lot.name || lot.parking_name || "",
    address: lot.address || lot.parking_address || "",
    has_roof: Boolean(lot.has_roof),
    distance: lot.distance ?? "",
    price_per_hour: Number(lot.price_per_hour || 0),
    price_per_day: Number(lot.price_per_day || 0),
    price_per_month: Number(lot.price_per_month || 0),
    priceLoaded: Boolean(lot.priceLoaded),
  };
};

const formatMoney = (value) => Number(value || 0).toLocaleString("vi-VN");

const formatDateTimeCompact = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const getParkingCapacitySummary = (lot, slots = []) => {
  const availableSlots = Number(lot?.available_slots || slots.length || 0);
  const totalSlots = Math.max(Number(lot?.total_slots || 0), availableSlots, slots.length, 1);
  const occupiedSlots = Math.max(0, totalSlots - availableSlots);
  const occupancyPercent = Math.min(100, Math.max(0, Math.round((occupiedSlots / totalSlots) * 100)));

  return {
    availableSlots,
    totalSlots,
    occupiedSlots,
    occupancyPercent,
  };
};

const getParkingSecurityLabel = (lot) => {
  const securityFlags = [lot?.has_security, lot?.security, lot?.cctv, lot?.camera_security];

  if (securityFlags.some((flag) => flag === true)) {
    return "Có";
  }

  if (securityFlags.some((flag) => flag === false)) {
    return "Không";
  }

  return "Đang cập nhật";
};

const getParkingRating = (lot) => {
  const rating = Number(lot?.rating ?? lot?.average_rating ?? lot?.review_score ?? 0);

  return Number.isFinite(rating) && rating > 0 ? rating : null;
};

const BOOKING_FLOW_STEPS = [
  {
    id: 1,
    title: "Khám phá",
    description: "Tìm và chọn bãi xe phù hợp",
  },
  {
    id: 2,
    title: "Cấu hình",
    description: "Chọn slot, thời gian và loại booking",
  },
  {
    id: 3,
    title: "Thanh toán",
    description: "Xem tóm tắt cọc và tổng tiền",
  },
  {
    id: 4,
    title: "Hoàn tất",
    description: "Nhận QR và xác nhận booking",
  },
];

const getBookingStage = ({ bookingResult, selectedLot, bookingWindow, selectedSlotId }) => {
  if (bookingResult) {
    return 4;
  }

  if (!selectedLot) {
    return 1;
  }

  if (bookingWindow.ok && selectedSlotId) {
    return 3;
  }

  return 2;
};


export default function Booking() {
  const location = useLocation();
  const isBookingRoute = location.pathname === "/booking";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = getAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("bookingSidebarCollapsed");
      if (raw !== null) {
        setSidebarCollapsed(raw === "true");
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("bookingSidebarCollapsed", sidebarCollapsed ? "true" : "false");
    } catch (e) {
      // ignore
    }
  }, [sidebarCollapsed]);
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
  const [prefilledSlotName, setPrefilledSlotName] = useState("");
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

  const currentStage = useMemo(
    () => getBookingStage({ bookingResult, selectedLot, bookingWindow, selectedSlotId }),
    [bookingResult, selectedLot, bookingWindow, selectedSlotId],
  );

  const selectedLotCapacity = useMemo(
    () => getParkingCapacitySummary(selectedLot, availableSlots),
    [selectedLot, availableSlots],
  );

  const selectedLotRating = useMemo(() => getParkingRating(selectedLot), [selectedLot]);

  const selectedSlotLabel = useMemo(() => {
    if (prefilledSlotName) {
      return prefilledSlotName;
    }

    return availableSlots.find((slot) => String(slot.id) === String(selectedSlotId))?.code || "Chưa chọn";
  }, [availableSlots, prefilledSlotName, selectedSlotId]);

  const bookingModeLabel = useMemo(
    () => BOOKING_MODE_OPTIONS.find((item) => item.value === bookingForm.bookingMode)?.label || "Theo giờ",
    [bookingForm.bookingMode],
  );

  const bookingPricing = useMemo(() => {
    const depositAmount = Math.round(Number(estimatedCharge.amount || 0) * 0.3);
    const serviceFeeAmount = 0;
    const totalAmount = Number(estimatedCharge.amount || 0);
    const remainingAmount = Math.max(0, totalAmount - depositAmount - serviceFeeAmount);

    return {
      depositAmount,
      serviceFeeAmount,
      totalAmount,
      remainingAmount,
    };
  }, [estimatedCharge.amount]);

  const selectedLotPriceByMode = useMemo(() => {
    if (!selectedLot) {
      return 0;
    }

    if (bookingForm.bookingMode === "daily") {
      return Number(selectedLot.price_per_day || 0);
    }

    if (bookingForm.bookingMode === "monthly") {
      return Number(selectedLot.price_per_month || 0);
    }

    return Number(selectedLot.price_per_hour || 0);
  }, [bookingForm.bookingMode, selectedLot]);

  const searchResultCount = nearby.length;

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

  // Prefill booking form when coming from "Đặt lại" (rebook)
  useEffect(() => {
    const rebook = location.state?.rebook;
    if (!rebook) return;

    const lot = normalizeSelectedLot(rebook.parking || rebook.parking_lot || {});
    if (lot && lot.id) setSelectedLot(lot);

    setBookingForm((prev) => {
      const next = { ...prev };
      try {
        if (rebook.checkin_time) next.checkinTime = toDatetimeLocalValue(new Date(rebook.checkin_time));
        if (rebook.checkout_time) next.checkoutTime = toDatetimeLocalValue(new Date(rebook.checkout_time));
      } catch (e) {
        // ignore
      }
      if (rebook.vehicle?.license_plate || rebook.vehicle?.plate) {
        next.licensePlate = rebook.vehicle.license_plate || rebook.vehicle?.plate;
      }
      return next;
    });

    if (rebook.slot?.id || rebook.slot_id) {
      setSelectedSlotId(String(rebook.slot?.id || rebook.slot_id));
      setPrefilledSlotName(rebook.slot?.code || rebook.slot_code || "");
    }

    // remove rebook state so it doesn't reapply
    try { navigate(location.pathname, { replace: true, state: {} }); } catch (e) {}
  }, [location.state]);

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
      const res = await API.get("/search-parking", {
        params: {
          address: address.trim(),
          limit: 5,
          sort_by: sortBy,
          covered_only: coveredOnly,
        },
      });
      applySearchResult(res.data);
    } catch (err) {
      setNearby([]);
      setSearchMeta(null);
      setError(normalizeError(err));
    } finally {
      setSearching(false);
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError("Trình duyệt không hỗ trợ lấy vị trí hiện tại");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          setError("");
          setSearching(true);
          const res = await API.get("/search-parking-by-coords", {
            params: {
              lat: coords.latitude,
              lng: coords.longitude,
              limit: 5,
              sort_by: sortBy,
              covered_only: coveredOnly,
            },
          });
          applySearchResult(res.data);
        } catch (err) {
          setNearby([]);
          setSearchMeta(null);
          setError(normalizeError(err));
        } finally {
          setSearching(false);
        }
      },
      () => {
        setError("Không thể lấy vị trí hiện tại. Vui lòng cấp quyền vị trí.");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleQuickFilter = async (addressQuery) => {
    try {
      setError("");
      setSearching(true);
      setAddress(addressQuery);
      const payload = await searchParkingByAddress({ address: addressQuery, limit: 5, sortBy, coveredOnly });
      applySearchResult({ query: payload.query, center: payload.center, nearest: payload.nearby });
    } catch (err) {
      setNearby([]);
      setSearchMeta(null);
      setError(normalizeError(err));
    } finally {
      setSearching(false);
    }
  };

  const handleLogout = () => {
    try {
      saveAuth(null);
    } catch (e) {
      // ignore
    }
    navigate("/login");
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

  const [drawerOpen, setDrawerOpen] = useState(false);

  const summaryReady = Boolean(selectedLot && selectedSlotId && bookingWindow.ok);

  return (
    <section className="page-wrap booking-page">
      <div className={`booking-dashboard ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
          <aside
            className={`booking-sidebar ${sidebarCollapsed ? "is-collapsed" : ""} ${sidebarHover ? "is-hovered" : ""}`}
            onMouseEnter={() => setSidebarHover(true)}
            onMouseLeave={() => setSidebarHover(false)}
          >
          <div className="booking-brand-card">
            <div className="booking-brand-mark">SP</div>
            <div className="booking-brand-copy">
              <p className="booking-brand-eyebrow">Smart Parking Platform</p>
              <h1>Booking Studio</h1>
            </div>
            <button
              type="button"
              className="booking-sidebar-toggle"
              aria-label={sidebarCollapsed ? "Mở rộng sidebar" : "Thu gọn sidebar"}
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((prev) => !prev)}
            >
              <span aria-hidden="true">{sidebarCollapsed ? "›" : "‹"}</span>
            </button>
          </div>

          <nav className="booking-sidebar-nav" role="navigation" aria-label="Main navigation">
            <button type="button" className="nav-item" title="Trang chủ" aria-label="Trang chủ" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5z" />
                </svg>
              </span>
              <span className="nav-label">Trang chủ</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/profile' ? 'is-active' : ''}`} title="Hồ sơ" aria-label="Hồ sơ" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/profile')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 20a8 8 0 0 1 16 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="nav-label">Hồ sơ</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/booking' ? 'is-active' : ''}`} title="Tìm bãi xe" aria-label="Tìm bãi xe" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/booking')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </span>
              <span className="nav-label">Tìm bãi xe</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/my-bookings' ? 'is-active' : ''}`} title="Đặt chỗ của tôi" aria-label="Đặt chỗ của tôi" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/my-bookings')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M21 15v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
              <span className="nav-label">Đặt chỗ của tôi</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/booking-history' ? 'is-active' : ''}`} title="Lịch sử đặt chỗ" aria-label="Lịch sử đặt chỗ" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/booking-history')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M8 6v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
              <span className="nav-label">Lịch sử</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/payment-history' ? 'is-active' : ''}`} title="Lịch sử thanh toán" aria-label="Lịch sử thanh toán" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/payment-history')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M16 11a2 2 0 1 1-4 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
              <span className="nav-label">Lịch sử thanh toán</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/wallet' ? 'is-active' : ''}`} title="Ví của tôi" aria-label="Ví của tôi" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/wallet')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M2 7h20v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <circle cx="18" cy="12" r="1.2" fill="currentColor" />
                </svg>
              </span>
              <span className="nav-label">Ví</span>
            </button>
            <button type="button" className={`nav-item ${location.pathname === '/vehicles' ? 'is-active' : ''}`} title="Phương tiện" aria-label="Phương tiện" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/vehicles')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 13l1.5-4.5A2 2 0 0 1 6.4 7h11.2a2 2 0 0 1 1.9 1.5L21 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <circle cx="7.5" cy="17" r="1.5" fill="currentColor" />
                  <circle cx="17.5" cy="17" r="1.5" fill="currentColor" />
                </svg>
              </span>
              <span className="nav-label">Phương tiện</span>
            </button>
            <button type="button" className="nav-item" title="Thông báo" aria-label="Thông báo" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/notifications')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M15 17h5l-1.4-2.8A2 2 0 0 0 16.8 13H7.2a2 2 0 0 0-1.8 1.2L4 17h11z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M9 13V9a3 3 0 1 1 6 0v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
              <span className="nav-label">Thông báo</span>
            </button>
            <button type="button" className="nav-item" title="Cài đặt" aria-label="Cài đặt" onFocus={() => setSidebarHover(true)} onBlur={() => setSidebarHover(false)} onClick={() => navigate('/settings')}>
              <span className="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.25a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06A2 2 0 1 1 2.3 17.88l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.25c.63 0 1.2-.37 1.51-1a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 6.88 2.3l.06.06c.45.45 1.06.65 1.66.52.55-.11 1.08-.17 1.6-.17H12c.52 0 1.05.06 1.6.17.6.13 1.21-.07 1.66-.52l.06-.06A2 2 0 1 1 19.4 4.6l-.06.06c-.45.45-.65 1.06-.52 1.66.11.55.17 1.08.17 1.6V12c0 .52-.06 1.05-.17 1.6-.13.6.07 1.21.52 1.66z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </span>
              <span className="nav-label">Cài đặt</span>
            </button>
          </nav>

          <div className="booking-sidebar-section">
            <p className="booking-sidebar-label">Luồng booking</p>
            <div className="booking-sidebar-steps">
              {BOOKING_FLOW_STEPS.map((step) => (
                <div
                  key={step.id}
                  className={`booking-sidebar-step ${step.id < currentStage ? "is-complete" : step.id === currentStage ? "is-active" : "is-pending"}`}
                >
                  <div className="booking-sidebar-step-index">{step.id}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.description}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

            <div className="booking-sidebar-section booking-sidebar-card">
            <div className="booking-sidebar-card-head">
              <span>Parking snapshot</span>
              <strong>{selectedLot ? `${selectedLotCapacity.availableSlots}/${selectedLotCapacity.totalSlots}` : "--"}</strong>
            </div>
            {selectedLot ? (
              <>
                <div className="booking-sidebar-lot-name">{selectedLot.name}</div>
                <p className="booking-sidebar-lot-address">{selectedLot.address || "Chưa có địa chỉ"}</p>
                <div className="booking-sidebar-metrics">
                  <div>
                    <span>Lấp đầy</span>
                    <strong>{selectedLotCapacity.occupancyPercent}%</strong>
                  </div>
                  <div>
                    <span>Slot trống</span>
                    <strong>{selectedLotCapacity.availableSlots}</strong>
                  </div>
                  <div>
                    <span>Giá hiện tại</span>
                    <strong>{formatMoney(selectedLotPriceByMode)}đ</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="booking-sidebar-empty">Chọn một bãi xe để mở khóa chi tiết booking và tóm tắt thanh toán.</p>
            )}
          </div>

          <div className="booking-sidebar-section booking-sidebar-card booking-sidebar-card--soft">
            <span className="booking-sidebar-label">Tín hiệu realtime</span>
            <p>{searching ? "Đang đồng bộ dữ liệu tìm kiếm..." : "Sẵn sàng hiển thị slot và trạng thái bãi xe theo thời gian thực."}</p>
            <div className="booking-sidebar-chip-row">
              <span className="booking-chip">{bookingModeLabel}</span>
              <span className="booking-chip booking-chip--ghost">{profile ? "Tài khoản đã đăng nhập" : "Khách vãng lai"}</span>
            </div>
          </div>
        </aside>

        <div className="booking-workspace">
          <div className="booking-hero">
            <div className="booking-hero-left">
              <h1 className="booking-hero-title">Khám phá bãi xe nhanh chóng</h1>
              <p className="booking-hero-sub">Tìm bãi gần bạn, chọn slot trống và nhận mã QR trong vài bước.</p>
            </div>
            <div className="booking-hero-right">
              <div className="hero-illustration" aria-hidden="true" />
            </div>
          </div>

          <header className="booking-topbar">
            <div className="booking-topbar-left">
              <select className="booking-city-select">
                <option value="hn">Hà Nội</option>
                <option value="hcm">TP. HCM</option>
                <option value="dn">Đà Nẵng</option>
              </select>
            </div>

            <div className="booking-topbar-title">
              <span className="booking-topbar-kicker">Realtime booking</span>
              <h2>Chọn bãi, chọn slot, xác nhận và nhận QR trong một flow liền mạch</h2>
            </div>

            <div className="booking-topbar-search">
              <div className="input-with-clear booking-topbar-search-field">
                <input
                  className="booking-input booking-search-input booking-search-input--large"
                  aria-label="Địa chỉ tìm kiếm"
                  placeholder="Tìm địa điểm, quận, đường..."
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

              <button type="button" className="btn-primary btn-primary--search" onClick={handleSearchNearby} disabled={searching}>
                {searching ? <span className="btn-loading">⏳ Đang tìm...</span> : "Tìm bãi xe"}
              </button>

              <button type="button" className="btn-secondary" onClick={handleUseCurrentLocation} disabled={searching}>
                📍 Vị trí hiện tại
              </button>
            </div>

            <div className="booking-quick-filters">
              <button type="button" className="booking-chip" onClick={() => handleQuickFilter("Quận Hoàn Kiếm, Hà Nội")}>Hoàn Kiếm</button>
              <button type="button" className="booking-chip" onClick={() => handleQuickFilter("Quận Đống Đa, Hà Nội")}>Đống Đa</button>
              <button type="button" className="booking-chip" onClick={() => handleQuickFilter("Trung tâm thương mại, Hà Nội")}>Trung tâm</button>
            </div>

            <div className="booking-topbar-actions">
              <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="nearest">Gần nhất</option>
                <option value="cheapest">Giá rẻ nhất</option>
              </select>

              <label className="filter-checkbox booking-filter-toggle">
                <input
                  type="checkbox"
                  checked={coveredOnly}
                  onChange={(e) => setCoveredOnly(e.target.checked)}
                />
                Có mái che
              </label>

              <button type="button" className="booking-icon-btn" aria-label="Thông báo">
                <span>🔔</span>
              </button>

              <div className="booking-user-chip">
                <div className="booking-user-avatar">{(profile?.name || auth?.user?.name || "SP").slice(0, 1).toUpperCase()}</div>
                <div>
                  <strong>{profile?.name || auth?.user?.name || "Smart Parking"}</strong>
                  <span>{profile?.phone || auth?.user?.phone || "Dashboard booking"}</span>
                </div>
              </div>
              <button type="button" className="booking-icon-btn topbar-sidebar-toggle" onClick={() => setDrawerOpen(true)} aria-label="Mở menu">
                ☰
              </button>
            </div>
          </header>

          <div className="booking-layout-grid">
            <main className="booking-main-column">
              <section className="booking-panel booking-stepper-panel">
                <div className="booking-panel-head booking-panel-head--compact">
                  <div>
                    <span className="booking-section-eyebrow">Step {currentStage}</span>
                    <h3>{BOOKING_FLOW_STEPS[currentStage - 1]?.title || "Khám phá"}</h3>
                  </div>
                  <div className="booking-panel-meta">
                    <span className="booking-pill">{searchResultCount} bãi</span>
                    <span className="booking-pill booking-pill--ghost">{selectedLot ? selectedLot.name : "Chưa chọn bãi"}</span>
                  </div>
                </div>

                <div className="booking-stepper booking-stepper--dashboard" role="list" aria-label="Tiến trình đặt chỗ">
                  {BOOKING_FLOW_STEPS.map((step) => {
                    const state = step.id < currentStage ? "is-complete" : step.id === currentStage ? "is-active" : "is-pending";

                    return (
                      <div key={step.id} className={`booking-stepper-item ${state}`} role="listitem">
                        <div className="booking-stepper-index">{step.id < currentStage ? "✓" : step.id}</div>
                        <div className="booking-stepper-copy">
                          <strong>{step.title}</strong>
                          <span>{step.description}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="booking-panel booking-map-panel">
                <div className="booking-panel-head">
                  <div>
                    <span className="booking-section-eyebrow">Step 1</span>
                    <h3>Khám phá bãi xe gần bạn</h3>
                  </div>
                  <div className="booking-panel-meta">
                    <span className="booking-pill">{searchResultCount} kết quả</span>
                    <span className="booking-pill booking-pill--ghost">{coveredOnly ? "Chỉ bãi có mái che" : "Tất cả bãi xe"}</span>
                  </div>
                </div>

                <div className="booking-map-hero">
                  <div>
                    <h4>Bản đồ tìm kiếm realtime</h4>
                    <p>Ưu tiên các bãi gần nhất, giá tốt nhất và phản hồi trực quan ngay khi bạn đổi bộ lọc.</p>
                  </div>
                  {searchMeta ? (
                    <div className="booking-map-hero-chip">
                      <span>Tọa độ</span>
                      <strong>{searchMeta.lat}, {searchMeta.lng}</strong>
                    </div>
                  ) : (
                    <div className="booking-map-hero-chip booking-map-hero-chip--muted">
                      <span>Trạng thái</span>
                      <strong>Chưa có vị trí tìm kiếm</strong>
                    </div>
                  )}
                </div>

                {searchMeta && <p className="search-meta search-meta--inline">Tọa độ tìm kiếm: {searchMeta.lat}, {searchMeta.lng}</p>}

                {nearby.length > 0 ? (
                  <>
                    <NearbyParkingMap
                      searchMeta={searchMeta}
                      nearbyLots={nearby}
                      selectedLotId={selectedLot?.id}
                      onSelectLot={handleSelectLot}
                    />

                    <div className="booking-map-hint">
                      <p>Nhấn vào một marker trên bản đồ để xem chi tiết bãi xe. Danh sách rút gọn đã được ẩn để tránh làm trang quá dài.</p>
                    </div>
                  </>
                ) : (
                  <div className="booking-empty-state">
                    <h4>Chưa có kết quả gần bạn</h4>
                    <p>Nhập địa chỉ hoặc bật vị trí hiện tại để hiển thị danh sách bãi xe, bản đồ và availability realtime.</p>
                  </div>
                )}
              </section>

              {selectedLot && (
                <section className="booking-panel booking-detail-panel" ref={bookingSectionRef}>
                  <div className="booking-panel-head">
                    <div>
                      <span className="booking-section-eyebrow">Step 2</span>
                      <h3>Hoàn thiện booking</h3>
                    </div>
                    <div className="booking-panel-meta">
                      <span className="booking-pill booking-pill--accent">Slot: {selectedSlotLabel}</span>
                      <span className="booking-pill">{selectedLotCapacity.availableSlots} slot trống</span>
                    </div>
                  </div>

                  <div className="booking-detail-grid">
                    <div className="selected-lot-card selected-lot-card--modern booking-selected-card">
                      <div className="selected-lot-card__visual" style={selectedLot.cover_image ? { backgroundImage: `linear-gradient(180deg, rgba(10, 22, 44, 0.08), rgba(10, 22, 44, 0.46)), url(${selectedLot.cover_image})` } : undefined}>
                        <div className="selected-lot-card__pill">{selectedLot.has_roof ? "Indoor" : "Outdoor"}</div>
                      </div>

                      <div className="selected-lot-card__body">
                        <div className="selected-lot-card__header">
                          <div>
                            <h4>{selectedLot.name}</h4>
                            <p>{selectedLot.address || "Chưa có địa chỉ"}</p>
                          </div>
                          <div className="selected-lot-card__distance">{selectedLot.distance || "--"} km</div>
                        </div>

                        <div className="selected-lot-meta selected-lot-meta--dashboard">
                          <span>📍 Khoảng cách: {selectedLot.distance || "--"} km</span>
                          <span>✅ Slot trống: {selectedLotCapacity.availableSlots}</span>
                          <span>⭐ {selectedLotRating ? selectedLotRating.toFixed(1) : "Mới"}</span>
                        </div>

                        <div className="booking-price-badges">
                          <span>Giá giờ: {formatMoney(selectedLot.price_per_hour || 0)}đ</span>
                          <span>Giá ngày: {formatMoney(selectedLot.price_per_day || 0)}đ</span>
                          <span>Giá tháng: {formatMoney(selectedLot.price_per_month || 0)}đ</span>
                        </div>
                      </div>
                    </div>

                    <div className="booking-map-column">
                      <ParkingMap
                        lotId={selectedLot.id}
                        lotName={selectedLot.name}
                        onSelectSlot={handleSlotSelectFromMap}
                      />
                    </div>

                    <div className="booking-form-stack">
                      <div className="form-section">
                        <div className="form-section-header">
                          <span className="section-icon">👤</span>
                          <h3>Thông tin người đặt</h3>
                          {profile && <span className="badge badge--account">Từ tài khoản</span>}
                        </div>
                        <div className="form-section-content">
                          <div className="booking-form-grid booking-form-grid--two">
                            <div className="field-wrap">
                              <label>Họ tên</label>
                              <input
                                className="booking-input"
                                placeholder="Nhập tên người đặt"
                                value={bookingForm.ownerName}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, ownerName: e.target.value }))}
                              />
                            </div>
                            <div className="field-wrap">
                              <label>Số điện thoại</label>
                              <input
                                className="booking-input"
                                placeholder="Tự động lấy từ tài khoản"
                                value={bookingForm.contactPhone}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, contactPhone: e.target.value }))}
                              />
                            </div>
                          </div>
                          {profile && (
                            <div className="profile-badge">
                              <span className="profile-text">
                                {profile.name} • {profile.phone} {profile.vehicle_plate ? `• ${profile.vehicle_plate}` : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="form-section">
                        <div className="form-section-header">
                          <span className="section-icon">🚗</span>
                          <h3>Thông tin xe</h3>
                        </div>
                        <div className="form-section-content">
                          <div className="booking-form-grid booking-form-grid--two">
                            <div className="field-wrap">
                              <label>Biển số xe</label>
                              <input
                                className="booking-input"
                                placeholder="Nhập biển số xe"
                                value={bookingForm.licensePlate}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, licensePlate: e.target.value }))}
                              />
                            </div>
                            <div className="field-wrap">
                              <label>Thương hiệu</label>
                              <input
                                className="booking-input"
                                placeholder="Ví dụ: Vinfast"
                                value={bookingForm.brand}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, brand: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="booking-form-grid booking-form-grid--three">
                            <div className="field-wrap">
                              <label>Dòng xe</label>
                              <input
                                className="booking-input"
                                placeholder="Ví dụ: vf4"
                                value={bookingForm.vehicleType}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, vehicleType: e.target.value }))}
                              />
                            </div>
                            <div className="field-wrap">
                              <label>Số chỗ ngồi</label>
                              <input
                                className="booking-input"
                                placeholder="Ví dụ: 4 chỗ"
                                value={bookingForm.seats}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, seats: e.target.value }))}
                              />
                            </div>
                            <div className="field-wrap">
                              <label>Màu xe</label>
                              <input
                                className="booking-input"
                                placeholder="Ví dụ: Đen"
                                value={bookingForm.vehicleColor}
                                onChange={(e) => setBookingForm((prev) => ({ ...prev, vehicleColor: e.target.value }))}
                              />
                            </div>
                          </div>
                          <div className="vehicle-save-action">
                            <button
                              type="button"
                              className="btn-outline"
                              onClick={handleSaveVehicleProfile}
                              disabled={savingVehicle}
                            >
                              {savingVehicle ? "Đang lưu..." : "💾 Lưu thông tin xe"}
                            </button>
                            {vehicleNotice && <span className="vehicle-notice">{vehicleNotice}</span>}
                          </div>
                        </div>
                      </div>

                      <div className="form-section">
                        <div className="form-section-header">
                          <span className="section-icon">📅</span>
                          <h3>Chi tiết đặt chỗ</h3>
                        </div>
                        <div className="form-section-content">
                          <div className="booking-form-grid booking-form-grid--single">
                            <div className="field-wrap">
                              <label>
                                Vị trí mong muốn
                                <span className="label-hint" title="Chọn vị trí từ sơ đồ bãi xe hoặc từ danh sách slot trống">ℹ️</span>
                              </label>
                              {prefilledSlotName ? (
                                <div className="prefilled-slot-display">
                                  <input className="booking-input" value={prefilledSlotName} readOnly disabled />
                                  <small className="slot-hint">Vị trí đã chọn từ sơ đồ bãi xe</small>
                                </div>
                              ) : (
                                <select className="booking-input booking-slot-select" value={selectedSlotId} onChange={(e) => setSelectedSlotId(e.target.value)}>
                                  <option value="">Chọn slot trống</option>
                                  {availableSlots.map((slot) => (
                                    <option key={slot.id} value={slot.id}>
                                      {slot.code} {slot.slot_number ? `- ${slot.slot_number}` : ""}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>

                          <div className="booking-mode-section">
                            <label>Hình thức đặt chỗ</label>
                            <div className="booking-mode-cards" role="radiogroup" aria-label="Chọn hình thức đặt chỗ">
                              {BOOKING_MODE_OPTIONS.map((modeOption) => {
                                const price = modeOption.value === "hourly"
                                  ? selectedLot.price_per_hour
                                  : modeOption.value === "daily"
                                    ? selectedLot.price_per_day
                                    : selectedLot.price_per_month;
                                const priceText = modeOption.value === "monthly"
                                  ? `${formatMoney(price || 0)}đ/tháng`
                                  : `${formatMoney(price || 0)}đ/${modeOption.value === "hourly" ? "giờ" : "ngày"}`;

                                return (
                                  <button
                                    key={modeOption.value}
                                    type="button"
                                    className={`booking-mode-card ${bookingForm.bookingMode === modeOption.value ? "is-active" : ""}`}
                                    role="radio"
                                    aria-checked={bookingForm.bookingMode === modeOption.value}
                                    onClick={() => handleBookingModeChange(modeOption.value)}
                                  >
                                    <div className="mode-card-header">
                                      <span className="mode-title">{modeOption.label}</span>
                                      <span className="mode-price">{priceText}</span>
                                    </div>
                                    <div className="mode-card-desc">{modeOption.description}</div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="time-picker-section">
                            {bookingForm.bookingMode === "hourly" && (
                              <div className="booking-form-grid booking-form-grid--two">
                                <div className="field-wrap">
                                  <label>Thời gian vào</label>
                                  <input
                                    className="booking-input"
                                    type="datetime-local"
                                    value={bookingForm.checkinTime}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, checkinTime: e.target.value }))}
                                  />
                                </div>
                                <div className="field-wrap">
                                  <label>Thời gian ra</label>
                                  <input
                                    className="booking-input"
                                    type="datetime-local"
                                    value={bookingForm.checkoutTime}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, checkoutTime: e.target.value }))}
                                  />
                                </div>
                              </div>
                            )}

                            {bookingForm.bookingMode === "daily" && (
                              <div className="booking-form-grid booking-form-grid--two">
                                <div className="field-wrap">
                                  <label>Đặt từ ngày</label>
                                  <input
                                    className="booking-input"
                                    type="date"
                                    min={toDateInputValue(getEarliestStartDate())}
                                    value={bookingForm.startDate}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, startDate: e.target.value }))}
                                  />
                                </div>
                                <div className="field-wrap">
                                  <label>Đặt đến ngày</label>
                                  <input
                                    className="booking-input"
                                    type="date"
                                    min={bookingForm.startDate || toDateInputValue(getEarliestStartDate())}
                                    value={bookingForm.endDate}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, endDate: e.target.value }))}
                                  />
                                </div>
                              </div>
                            )}

                            {bookingForm.bookingMode === "monthly" && (
                              <div className="booking-form-grid booking-form-grid--two">
                                <div className="field-wrap">
                                  <label>Bắt đầu từ ngày</label>
                                  <input
                                    className="booking-input"
                                    type="date"
                                    min={toDateInputValue(getEarliestStartDate())}
                                    value={bookingForm.startDate}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, startDate: e.target.value }))}
                                  />
                                </div>
                                <div className="field-wrap">
                                  <label>Số tháng đặt chỗ</label>
                                  <input
                                    className="booking-input"
                                    type="number"
                                    min={1}
                                    max={24}
                                    value={bookingForm.monthCount}
                                    onChange={(e) => setBookingForm((prev) => ({ ...prev, monthCount: e.target.value }))}
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="booking-estimate-box booking-estimate-box--dashboard">
                            {!bookingWindow.ok && <p className="booking-error">{bookingWindow.error}</p>}
                            {bookingWindow.ok && bookingRangePreview && (
                              <>
                                <p className="estimate-range">
                                  {bookingRangePreview.start} - {bookingRangePreview.end}
                                </p>
                                <p className="estimate-cost">
                                  Dự kiến tính phí: {estimatedCharge.billedUnits} {estimatedCharge.billedUnit} ({estimatedCharge.resolvedMode})
                                </p>
                                {estimatedCharge.autoConvertedToDaily && (
                                  <p className="booking-estimate-note">
                                    Booking theo giờ nhưng lớn hơn 12 giờ nên hệ thống tự động tính theo ngày.
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </main>

            <aside className="booking-summary-rail">
              <div className="booking-summary-card">
                <div className="booking-panel-head booking-summary-head">
                  <div>
                    <span className="booking-section-eyebrow">Step 3</span>
                    <h3>Tóm tắt thanh toán</h3>
                  </div>
                  <span className={`booking-status-pill ${summaryReady ? "is-ready" : "is-idle"}`}>
                    {summaryReady ? "Sẵn sàng" : "Đang chờ"}
                  </span>
                </div>

                <div className="booking-summary-hero">
                  <div>
                    <p className="booking-summary-label">Tổng tạm tính</p>
                    <strong className="booking-summary-total">{formatMoney(bookingPricing.totalAmount)}đ</strong>
                    <span className="booking-summary-subline">
                      {bookingWindow.ok ? `${estimatedCharge.billedUnits} ${estimatedCharge.billedUnit}` : "Chọn thời gian để tính tiền"}
                    </span>
                  </div>
                  <div className="booking-summary-badge">
                    <span>Cọc giữ chỗ</span>
                    <strong>{formatMoney(bookingPricing.depositAmount)}đ</strong>
                  </div>
                </div>

                <div className="booking-summary-list">
                  <div>
                    <span>Bãi xe</span>
                    <strong>{selectedLot?.name || "Chưa chọn"}</strong>
                  </div>
                  <div>
                    <span>Slot</span>
                    <strong>{selectedSlotLabel}</strong>
                  </div>
                  <div>
                    <span>Hình thức</span>
                    <strong>{bookingModeLabel}</strong>
                  </div>
                  <div>
                    <span>Giữ trước 30%</span>
                    <strong>{formatMoney(bookingPricing.depositAmount)}đ</strong>
                  </div>
                  <div>
                    <span>Phí dịch vụ</span>
                    <strong>{bookingPricing.serviceFeeAmount > 0 ? `${formatMoney(bookingPricing.serviceFeeAmount)}đ` : "Miễn phí"}</strong>
                  </div>
                  <div className="booking-summary-total-row">
                    <span>Còn lại khi checkout</span>
                    <strong>{formatMoney(bookingPricing.remainingAmount)}đ</strong>
                  </div>
                </div>

                {bookingWindow.ok && bookingRangePreview ? (
                  <div className="booking-summary-note">
                    <p>
                      {bookingRangePreview.start} - {bookingRangePreview.end}
                    </p>
                    <p>
                      {formatDateTimeCompact(bookingWindow.checkinDate)} → {formatDateTimeCompact(bookingWindow.checkoutDate)}
                    </p>
                    <p>
                      {estimatedCharge.autoConvertedToDaily
                        ? "Booking dài hơn 12 giờ sẽ tự chuyển sang mức tính theo ngày để giữ giá tối ưu."
                        : "Tổng hiển thị là tạm tính theo cấu hình hiện tại, thanh toán theo flow của hệ thống."}
                    </p>
                  </div>
                ) : (
                  <div className="booking-summary-note booking-summary-note--empty">
                    <p>Chọn bãi xe và cấu hình thời gian để mở khóa tóm tắt thanh toán.</p>
                  </div>
                )}

                <button
                  type="button"
                  className="btn-primary booking-summary-cta"
                  onClick={handleCreateBooking}
                  disabled={bookingLoading}
                >
                  {bookingLoading ? <span className="btn-loading">⏳ Đang xử lý...</span> : <span>Xác nhận &amp; thanh toán</span>}
                </button>

                {(bookingError || error) && <p className="booking-error booking-error--card">{bookingError || error}</p>}
              </div>
            </aside>
            {/* Support card and user footer removed per design request */}
          </div>
        </div>
      </div>

      {drawerOpen && ReactDOM.createPortal(
        <div className="booking-drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <aside className="booking-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="booking-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Đóng menu">×</button>
            <nav className="booking-drawer-nav">
              <button type="button" className={`nav-item ${location.pathname === '/' ? 'is-active' : ''}`} title="Trang chủ" aria-label="Trang chủ" onClick={() => { setDrawerOpen(false); navigate('/'); }}>
                <span className="nav-icon" aria-hidden="true">🏠</span>
                <span className="nav-label">Trang chủ</span>
              </button>
              <button type="button" className={`nav-item ${location.pathname === '/booking' ? 'is-active' : ''}`} title="Tìm bãi xe" aria-label="Tìm bãi xe" onClick={() => { setDrawerOpen(false); navigate('/booking'); }}>
                <span className="nav-icon" aria-hidden="true">🔍</span>
                <span className="nav-label">Tìm bãi xe</span>
              </button>
              <button type="button" className={`nav-item ${location.pathname === '/my-bookings' ? 'is-active' : ''}`} title="Đặt chỗ của tôi" aria-label="Đặt chỗ của tôi" onClick={() => { setDrawerOpen(false); navigate('/my-bookings'); }}>
                <span className="nav-icon" aria-hidden="true">📌</span>
                <span className="nav-label">Đặt chỗ của tôi</span>
              </button>
              <button type="button" className={`nav-item ${location.pathname === '/booking-history' ? 'is-active' : ''}`} title="Lịch sử đặt chỗ" aria-label="Lịch sử đặt chỗ" onClick={() => { setDrawerOpen(false); navigate('/booking-history'); }}>
                <span className="nav-icon" aria-hidden="true">🕘</span>
                <span className="nav-label">Lịch sử đặt chỗ</span>
              </button>
            </nav>
          </aside>
        </div>, document.body
      )}

      {bookingResult && ReactDOM.createPortal(
        <div className="qr-modal-overlay" onClick={() => setBookingResult(null)}>
          <div className="qr-modal" onClick={(e) => e.stopPropagation()}>
            <button className="qr-modal-close" onClick={() => setBookingResult(null)}>×</button>
            <div className="qr-modal-topline">
              <span>Step 4</span>
              <h2>Mã QR - Booking #{bookingResult.booking_id}</h2>
            </div>
            <div className="qr-modal-image">
              <img src={`http://localhost:8000/${bookingResult.qr_code}`} alt="Mã QR đặt chỗ" />
            </div>
            <p className="booking-result-message">{bookingResult.message}</p>
            <div className="qr-modal-actions">
              <button
                className="qr-modal-download"
                onClick={() => {
                  const url = `http://localhost:8000/${bookingResult.qr_code}`;
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `booking-${bookingResult.booking_id}-qr.png`;
                  document.body.appendChild(link);
                  link.click();
                  link.remove();
                }}
              >
                Tải QR
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
