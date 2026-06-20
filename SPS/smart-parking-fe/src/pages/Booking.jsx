import { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { X, MapPin, Loader2, User, Car, Save, Calendar, Info, CheckCircle, AlertTriangle } from "lucide-react";
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
  const [expandedLotId, setExpandedLotId] = useState(null);
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
    <section className="page-wrap">
      <div className="page-card booking-shell">
        <div className="booking-header">
          <h1 className="page-title">Tìm bãi xe gần bạn</h1>
          <p className="page-subtitle">Smart Parking Platform</p>
        </div>

        <section className="booking-search-section">
          <h2 className="booking-subtitle">Tìm bãi xe gần bạn</h2>
          <div className="booking-tools booking-tools--search">
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
                  <X size={16} />
                </button>
              )}
            </div>

            <button type="button" className="btn-primary btn-primary--search" onClick={handleSearchNearby} disabled={searching}>
              {searching ? (
                <span className="btn-loading"><Loader2 size={16} className="spin" /> Đang tìm...</span>
              ) : (
                "Tìm bãi xe gần bạn"
              )}
            </button>

            <button type="button" className="btn-secondary" onClick={handleUseCurrentLocation} disabled={searching}>
              <MapPin size={16} /> Dùng vị trí hiện tại
            </button>
          </div>

          <div className="filter-row">
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

          {searchMeta && (
            <p className="search-meta">
              Tọa độ tìm kiếm: {searchMeta.lat}, {searchMeta.lng}
            </p>
          )}

          {nearby.length > 0 && (
            <>
              <NearbyParkingMap
                searchMeta={searchMeta}
                nearbyLots={nearby}
                onSelectLot={handleSelectLot}
              />

              <div className="nearby-list">
                {nearby.map((lot) => (
                  <article className="nearby-item" key={lot.id}>
                    <h3>{lot.name}</h3>
                    <p><MapPin size={14} /> {lot.address}</p>
                    <p><MapPin size={14} /> {lot.distance} km</p>
                    {expandedLotId === lot.id ? (
                      <div className="lot-detail-box">
                        <p><strong>ID bãi:</strong> {lot.id}</p>
                        <p><strong>Địa chỉ:</strong> {lot.address || "Chưa có địa chỉ"}</p>
                        <p><strong>Có mái che:</strong> {lot.has_roof ? "Có" : "Không"}</p>
                        <p><strong>Giá theo giờ:</strong> {Number(lot.price_per_hour || 0).toLocaleString("vi-VN")}đ</p>
                        <p><strong>Giá theo ngày:</strong> {Number(lot.price_per_day || 0).toLocaleString("vi-VN")}đ</p>
                        <p><strong>Giá theo tháng:</strong> {Number(lot.price_per_month || 0).toLocaleString("vi-VN")}đ</p>
                      </div>
                    ) : null}
                    <div className="lot-actions">
                      <button type="button" className="btn-secondary" onClick={() => handleToggleLotDetail(lot.id)}>
                        {expandedLotId === lot.id ? "Ẩn chi tiết" : "Xem chi tiết"}
                      </button>
                      <button type="button" className="btn-primary" onClick={() => handleSelectLot(lot)}>
                        Đặt ngay
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        {selectedLot && (
          <section className="booking-search-section booking-form-section" ref={bookingSectionRef}>
            {/* Progress Stepper */}
            <div className="booking-stepper">
              <div className="stepper-step stepper-step--completed">
                <div className="stepper-number"><CheckCircle size={18} /></div>
                <div className="stepper-label">Chọn bãi xe</div>
              </div>
              <div className="stepper-line"></div>
              <div className="stepper-step stepper-step--active">
                <div className="stepper-number">2</div>
                <div className="stepper-label">Chi tiết đặt chỗ</div>
              </div>
              <div className="stepper-line"></div>
              <div className="stepper-step stepper-step--pending">
                <div className="stepper-number">3</div>
                <div className="stepper-label">Xác nhận & Thanh toán</div>
              </div>
            </div>

            <div className="booking-form-headline">
              <h2>ĐẶT BÃI XE ĐÃ CHỌN</h2>
            </div>

            <div className="selected-lot-card selected-lot-card--modern">
              <h3>Thông tin bãi đỗ xe</h3>
              <p><strong>Bãi xe:</strong> {selectedLot.name}</p>
              <p><strong>Địa chỉ:</strong> {selectedLot.address}</p>
              <p><strong>Có mái che:</strong> {selectedLot.has_roof ? "Có" : "Không"}</p>
              <p><strong>Giá theo giờ:</strong> {Number(selectedLot.price_per_hour || 0).toLocaleString("vi-VN")}đ</p>
              <p><strong>Giá theo ngày:</strong> {Number(selectedLot.price_per_day || 0).toLocaleString("vi-VN")}đ</p>
              <p><strong>Giá theo tháng:</strong> {Number(selectedLot.price_per_month || 0).toLocaleString("vi-VN")}đ</p>
              <div className="selected-lot-meta">
                <span><MapPin size={14} /> Khoảng cách: {selectedLot.distance} km</span>
                <span><CheckCircle size={14} /> Slot trống: {availableSlots.length}</span>
              </div>
            </div>

            <ParkingMap
              lotId={selectedLot.id}
              lotName={selectedLot.name}
              onSelectSlot={handleSlotSelectFromMap}
            />

            <div className="booking-form-sheet">
              {/* Section 1: Thông tin người đặt */}
              <div className="form-section">
                <div className="form-section-header">
                  <span className="section-icon"><User size={18} /></span>
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

              {/* Section 2: Thông tin xe */}
              <div className="form-section">
                <div className="form-section-header">
                  <span className="section-icon"><Car size={18} /></span>
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
                      {savingVehicle ? "Đang lưu..." : <><Save size={16} /> Lưu thông tin xe</>}
                    </button>
                    {vehicleNotice && <span className="vehicle-notice">{vehicleNotice}</span>}
                  </div>
                </div>
              </div>

              {/* Section 3: Chi tiết đặt chỗ */}
              <div className="form-section">
                <div className="form-section-header">
                  <span className="section-icon"><Calendar size={18} /></span>
                  <h3>Chi tiết đặt chỗ</h3>
                </div>
                <div className="form-section-content">

                  <div className="booking-form-grid booking-form-grid--single">
                    <div className="field-wrap">
                      <label>
                        Vị trí mong muốn
                        <span className="label-hint" title="Chọn vị trí từ sơ đồ bãi xe hoặc từ danh sách slot trống"><Info size={14} /></span>
                      </label>
                      {prefilledSlotName ? (
                        <div className="prefilled-slot-display">
                          <input
                            className="booking-input"
                            value={prefilledSlotName}
                            readOnly
                            disabled
                          />
                          <small className="slot-hint">Vị trí đã chọn từ sơ đồ bãi xe</small>
                        </div>
                      ) : (
                        <select
                          className="booking-input booking-slot-select"
                          value={selectedSlotId}
                          onChange={(e) => setSelectedSlotId(e.target.value)}
                        >
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
                          ? `${Number(price || 0).toLocaleString("vi-VN")}đ/tháng`
                          : `${Number(price || 0).toLocaleString("vi-VN")}đ/${modeOption.value === "hourly" ? "giờ" : "ngày"}`;
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

                  <div className="booking-estimate-box">
                    {!bookingWindow.ok && <p className="booking-error">{bookingWindow.error}</p>}
                    {bookingWindow.ok && (
                      <>
                        <p className="estimate-range">
                          Từ {bookingRangePreview.start} đến {bookingRangePreview.end}
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

            {/* Sticky Summary Bar (Mobile) / Summary Card (Desktop) */}
            <div className="booking-summary-bar">
              <div className="summary-info">
                <div className="summary-item">
                  <span className="summary-label">Bãi xe:</span>
                  <span className="summary-value">{selectedLot.name}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Thời gian:</span>
                  <span className="summary-value">
                    {bookingWindow.ok ? `${estimatedCharge.billedUnits} ${estimatedCharge.billedUnit}` : "--"}
                  </span>
                </div>
                <div className="summary-item summary-item--total">
                  <span className="summary-label">Tổng:</span>
                  <span className="summary-value summary-value--price">
                    {estimatedCharge.amount.toLocaleString("vi-VN")} ₫
                  </span>
                </div>
              </div>
              <button 
                type="button" 
                className="btn-primary btn-primary--summary" 
                onClick={handleCreateBooking} 
                disabled={bookingLoading}
              >
                {bookingLoading ? (
                  <span className="btn-loading">⏳ Đang xử lý...</span>
                ) : (
                  <span>Xác nhận đặt chỗ</span>
                )}
              </button>
            </div>

            {(bookingError || error) && <p className="booking-error">{bookingError || error}</p>}

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
          </section>
        )}
      </div>
    </section>
  );
}
