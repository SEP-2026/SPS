import { useEffect, useMemo, useRef, useState } from "react";

import ActionButtons from "../../features/gate/ActionButtons";
import BookingInfoPanel from "../../features/gate/BookingInfoPanel";
import PaymentPanel from "../../features/gate/PaymentPanel";
import ScanZone from "../../features/gate/ScanZone";
import StatusBanner from "../../features/gate/StatusBanner";
import { inferQrPreview, parseBookingIdFromQR, parseManualBookingId } from "../../features/gate/scanParser";
import { getBannerTone } from "../../features/gate/statusLabel";
import { employeeCheckIn, employeeCheckOut, getEmployeeGateBooking } from "../../employee/employeeService";
import { useEmployeeContext } from "../../employee/useEmployeeContext";
import "../Scan.css";
import "./EmployeeQrScanner.css";

function normalizeViText(value) {
  if (!value || typeof value !== "string") return "";

  let text = value.trim();

  if (/[ÃÂ]/.test(text)) {
    try {
      text = decodeURIComponent(escape(text));
    } catch {
      // keep original text when decoding fails
    }
  }

  const replacements = [
    [/không tìm th\?y booking/gi, "Không tìm thấy booking"],
    [/kh\?ng tìm th\?y booking/gi, "Không tìm thấy booking"],
    [/kh\?ng th\? th\?ng tin booking/gi, "Không thể thông tin booking"],
    [/kh\?ng th\? kết nối/gi, "Không thể kết nối"],
  ];

  replacements.forEach(([pattern, nextValue]) => {
    text = text.replace(pattern, nextValue);
  });

  return text;
}

function buildBannerFromError(error, fallbackTitle) {
  const detailRaw = error?.response?.data?.detail || "";
  const detailNormalized = normalizeViText(detailRaw);
  return {
    title: fallbackTitle,
    message: detailNormalized || "Không thể kết nối tới hệ thống cổng.",
  };
}

export default function EmployeeQrScanner() {
  const { refreshEmployee } = useEmployeeContext();
  const scanInputRef = useRef(null);
  const successTimeoutRef = useRef(null);
  const [gateId, setGateId] = useState("GATE-A1");
  const [scanValue, setScanValue] = useState("");
  const [manualBookingId, setManualBookingId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [scanMode, setScanMode] = useState("manual");
  const [cameraActive, setCameraActive] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanSuccess, setScanSuccess] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [uiState, setUiState] = useState("idle");
  const [banner, setBanner] = useState({
    title: "Sẵn sàng xử lý",
    message: "Quét QR để tự động xử lý hoặc nhập mã booking để xem thông tin rồi thao tác thủ công.",
  });
  const [booking, setBooking] = useState(null);

  const qrPreview = useMemo(() => inferQrPreview(scanValue), [scanValue]);
  const manualPreview = useMemo(() => parseManualBookingId(manualBookingId), [manualBookingId]);

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    },
    [],
  );

  const applyBookingPayload = (payload, nextBanner, nextUiState = "booking_loaded") => {
    setBooking(payload || null);
    setBanner(nextBanner);
    setUiState(nextUiState);
  };

  const handleResolveManual = async () => {
    if (!gateId.trim()) {
      setUiState("error");
      setBanner({ title: "Thiếu mã cổng", message: "Vui lòng nhập mã cổng trước khi xem thông tin booking." });
      return;
    }
    if (!manualPreview.bookingId) {
      setUiState("error");
      setBanner({ title: "Mã booking không hợp lệ", message: manualPreview.error || "Vui lòng nhập mã booking hợp lệ." });
      return;
    }

    setBanner({ title: "Đang tải dữ liệu...", message: "Hệ thống đang lấy thông tin booking từ máy chủ." });
    setUiState("processing");

    try {
      const response = await getEmployeeGateBooking(manualPreview.bookingId);
      applyBookingPayload(
        response,
        {
          title: "Đã tải thông tin booking",
          message: "Bạn có thể kiểm tra thông tin và chọn thao tác cho xe vào hoặc ra bãi.",
        },
      );
    } catch (error) {
      setBooking(null);
      setUiState("error");
      setBanner(buildBannerFromError(error, "Không tìm thấy booking"));
    }
  };

  const handleSubmitQr = async (incomingText) => {
    const rawScanText = typeof incomingText === "string" ? incomingText : scanValue;
    if (!gateId.trim()) {
      setUiState("error");
      setScanError("Vui lòng nhập mã cổng trước khi quét.");
      setBanner({ title: "Thiếu mã cổng", message: "Vui lòng nhập mã cổng trước khi quét." });
      return;
    }
    if (!rawScanText.trim()) {
      setUiState("error");
      setScanError("Hãy quét QR hoặc nhập payload QR trước khi xử lý.");
      setBanner({ title: "Chưa có dữ liệu quét", message: "Hãy quét QR hoặc nhập payload QR trước khi xử lý." });
      return;
    }

    setScanError("");
    setBanner({ title: "Đang quét...", message: "Đã nhận dữ liệu từ scanner, đang lấy thông tin booking." });
    setUiState("scanning");

    try {
      const bookingId = parseBookingIdFromQR(rawScanText);
      if (!bookingId) {
        setBooking(null);
        setUiState("error");
        setScanError("Không tìm thấy thông tin booking trong mã QR này.");
        setBanner({
          title: "QR không hợp lệ",
          message: "Không tìm thấy booking_id khả dụng trong dữ liệu QR.",
        });
        return;
      }

      setUiState("processing");
      const response = await getEmployeeGateBooking(bookingId);
      applyBookingPayload(
        response,
        {
          title: "Đã đọc QR",
          message: "Thông tin booking đã hiển thị ở panel bên phải. Bạn có thể chọn thao tác vào/ra bãi.",
        },
      );
    } catch (error) {
      setBooking(null);
      setUiState("error");
      setScanError(error?.response?.data?.detail || "Không đọc được QR.");
      setBanner(buildBannerFromError(error, "Không đọc được QR"));
    }
  };

  const handleQRResult = async (rawText) => {
    const normalized = `${rawText ?? ""}`.trim();
    setScanValue(normalized);
    setScanError("");
    setScanSuccess("");

    const bookingId = parseBookingIdFromQR(normalized);
    if (!bookingId) {
      setUiState("error");
      setScanError("Không tìm thấy thông tin booking trong mã QR này.");
      setBanner({
        title: "QR không hợp lệ",
        message: "Không tìm thấy booking_id khả dụng trong dữ liệu QR.",
      });
      return;
    }

    setManualBookingId(String(bookingId));
    setScanMode("manual");
    setScanSuccess("✓ Đọc QR thành công!");
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = setTimeout(() => setScanSuccess(""), 1000);
    await handleSubmitQr(normalized);
  };

  const handleCheckIn = async () => {
    if (!booking?.booking_id) {
      setUiState("error");
      setBanner({ title: "Chưa có booking", message: "Hãy xem thông tin booking trước khi thao tác cho xe vào bãi." });
      return;
    }

    setUiState("action_submitting");
    setBanner({ title: "Đang xử lý...", message: "Đang thực hiện check-in tại cổng." });

    try {
      const response = await employeeCheckIn({
        qr_data: String(booking.booking_id),
        payment_method: paymentMethod,
      });
      applyBookingPayload(
        response.booking,
        {
          title: "Đã check-in",
          message: "Xe đã được cho vào bãi và trạng thái booking đã được cập nhật ngay.",
        },
        "success",
      );
      await refreshEmployee();
    } catch (error) {
      setUiState("error");
      setBanner(buildBannerFromError(error, "Không thể cho xe vào bãi"));
    }
  };

  const handleCheckOut = async () => {
    if (!booking?.booking_id) {
      setUiState("error");
      setBanner({ title: "Chưa có booking", message: "Hãy xem thông tin booking trước khi thao tác cho xe ra bãi." });
      return;
    }

    setUiState("action_submitting");
    setBanner({ title: "Đang xử lý...", message: "Đang thực hiện check-out và thanh toán." });

    try {
      const response = await employeeCheckOut({
        qr_data: String(booking.booking_id),
        payment_method: paymentMethod,
      });
      applyBookingPayload(
        response.booking,
        {
          title: "Đã check-out",
          message: "Xe đã ra khỏi bãi và trạng thái booking đã được cập nhật.",
        },
        "success",
      );
      await refreshEmployee();
    } catch (error) {
      setUiState("error");
      setBanner(buildBannerFromError(error, "Không thể cho xe ra bãi"));
    }
  };

  return (
    <section className="page-wrap employee-scan-page">
      <div className="page-card scan-page">
        <div className="scan-hero">
          <div>
            <p className="scan-eyebrow">SCAN GATE</p>
            <h1 className="page-title scan-title">Cổng quét QR vào / ra bãi</h1>
            <p className="scan-subtitle">
              Quét QR để nhận diện booking, sau đó nhân viên chủ động chọn thao tác cho xe vào hoặc ra bãi.
            </p>
          </div>

          <div className="scan-hero-badge">
            <strong>Trạng thái cổng</strong>
            <span>{uiState === "idle" ? "Sẵn sàng" : uiState}</span>
            <span>{booking?.cooldown?.active ? "Đang chờ cooldown" : "Có thể quét tiếp"}</span>
          </div>
        </div>

        <div className="scan-grid">
          <ScanZone
            scanValue={scanValue}
            setScanValue={setScanValue}
            onSubmitQr={handleSubmitQr}
            onQrDecoded={handleQRResult}
            manualBookingId={manualBookingId}
            setManualBookingId={setManualBookingId}
            onResolveManual={handleResolveManual}
            gateId={gateId}
            setGateId={setGateId}
            uiState={uiState}
            qrPreviewError={qrPreview.error}
            inputRef={scanInputRef}
            scanMode={scanMode}
            setScanMode={setScanMode}
            cameraActive={cameraActive}
            setCameraActive={setCameraActive}
            scanning={scanning}
            setScanning={setScanning}
            scanError={scanError}
            setScanError={setScanError}
            scanSuccess={scanSuccess}
            setScanSuccess={setScanSuccess}
            imagePreview={imagePreview}
            setImagePreview={setImagePreview}
          />

          <section className="scan-panel">
            <BookingInfoPanel booking={booking || { input_type: qrPreview.payload ? "qr_json" : null }} />
            <ActionButtons booking={booking} uiState={uiState} onCheckIn={handleCheckIn} onCheckOut={handleCheckOut} />
            <PaymentPanel booking={booking} paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod} />
            <StatusBanner
              tone={getBannerTone(uiState, booking)}
              title={banner.title}
              message={banner.message}
              extra={booking?.cooldown?.active ? booking.cooldown.message : booking?.cancel_reason}
            />
          </section>
        </div>
      </div>
    </section>
  );
}
