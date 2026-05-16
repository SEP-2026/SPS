import { useCallback, useEffect, useRef } from "react";
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";
import jsQR from "jsqr";

function GateModeIcon({ name }) {
  const icons = {
    camera: (
      <>
        <path d="M8 7h.01" />
        <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.2-1.6A1 1 0 0 1 10 4h4a1 1 0 0 1 .8.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
        <path d="M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M5 20h14" />
      </>
    ),
    keyboard: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h.01M11 14h6" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="scan-tab-icon">
      {icons[name] || icons.keyboard}
    </svg>
  );
}

export default function ScanZone({
  scanValue,
  setScanValue,
  onSubmitQr,
  onQrDecoded,
  manualBookingId,
  setManualBookingId,
  onResolveManual,
  gateId,
  setGateId,
  uiState,
  qrPreviewError,
  inputRef,
  scanMode,
  setScanMode,
  cameraActive,
  setCameraActive,
  scanning,
  setScanning,
  scanError,
  setScanError,
  scanSuccess,
  setScanSuccess,
  imagePreview,
  setImagePreview,
}) {
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanIntervalRef = useRef(null);
  const frameBusyRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, [setCameraActive]);

  const decodeWithZxing = (imageData) => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    const reader = new QRCodeReader();
    const luminance = new RGBLuminanceSource(imageData.data, imageData.width, imageData.height);
    const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminance));
    const result = reader.decode(binaryBitmap, hints);
    return result.getText();
  };

  const decodeImageData = (imageData) => {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "dontInvert",
    });
    if (code?.data) return code.data;

    const codeInvert = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "onlyInvert",
    });
    if (codeInvert?.data) return codeInvert.data;

    return decodeWithZxing(imageData);
  };

  const startCamera = async () => {
    setScanError("");
    setScanSuccess("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
    } catch {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
        });
        streamRef.current = stream;
      } catch {
        setScanError("Không thể truy cập camera. Kiểm tra quyền truy cập.");
        return;
      }
    }

    if (!videoRef.current || !streamRef.current) return;

    videoRef.current.srcObject = streamRef.current;
    await videoRef.current.play();
    setCameraActive(true);

    scanIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || frameBusyRef.current) return;
      if (videoRef.current.readyState !== 4) return;

      frameBusyRef.current = true;
      try {
        const canvas = canvasRef.current;
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const decodedText = decodeImageData(imageData);
        if (decodedText) {
          stopCamera();
          await onQrDecoded(decodedText);
        }
      } catch {
        // Keep scanning when a frame cannot be decoded.
      } finally {
        frameBusyRef.current = false;
      }
    }, 500);
  };

  const onSelectMode = (mode) => {
    setScanMode(mode);
    setScanError("");
    setScanSuccess("");
    if (mode !== "upload") {
      setImagePreview(null);
    }
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    setScanError("");
    setScanSuccess("");
    setScanning(true);

    const previewUrl = URL.createObjectURL(file);
    setImagePreview((previousPreview) => {
      if (previousPreview) {
        URL.revokeObjectURL(previousPreview);
      }
      return previewUrl;
    });

    try {
      const imageBitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = imageBitmap.width;
      canvas.height = imageBitmap.height;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("NO_CONTEXT");
      }
      context.drawImage(imageBitmap, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const decodedText = decodeImageData(imageData);
      if (!decodedText) {
        throw new Error("NO_QR");
      }
      await onQrDecoded(decodedText);
    } catch {
      setScanError("Không đọc được QR từ ảnh. Vui lòng thử ảnh khác.");
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (scanMode !== "camera") {
      stopCamera();
    }
  }, [scanMode, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  useEffect(
    () => () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    },
    [imagePreview],
  );

  const isSuccessFeedback = Boolean(scanSuccess) || uiState === "success";

  return (
    <section className={`scan-panel scan-panel--primary${isSuccessFeedback ? " scan-panel--success-flash" : ""}`}>
      <div className={`scan-frame scan-frame--${uiState}${isSuccessFeedback ? " scan-frame--success-flash" : ""}`}>
        <div className="scan-frame-corners" />
        <div className="scan-line" />
        <div className="scan-frame-content">
          <strong>Vùng quét QR</strong>
          <div className="scan-mode-tabs">
            <button
              type="button"
              className={`scan-tab-btn ${scanMode === "camera" ? "active" : ""}`}
              onClick={() => onSelectMode("camera")}
            >
              <GateModeIcon name="camera" />
              <span>Camera thiết bị</span>
            </button>
            <button
              type="button"
              className={`scan-tab-btn ${scanMode === "upload" ? "active" : ""}`}
              onClick={() => onSelectMode("upload")}
            >
              <GateModeIcon name="upload" />
              <span>Upload ảnh QR</span>
            </button>
            <button
              type="button"
              className={`scan-tab-btn ${scanMode === "manual" ? "active" : ""}`}
              onClick={() => onSelectMode("manual")}
            >
              <GateModeIcon name="keyboard" />
              <span>Nhập thủ công</span>
            </button>
          </div>
        </div>
      </div>

      <div className="scan-form-grid">
        <label className="scan-field">
          <span>Mã cổng / gate_id</span>
          <input
            className="scan-input"
            value={gateId}
            onChange={(event) => setGateId(event.target.value)}
            placeholder="Ví dụ: GATE-A1"
          />
        </label>

        <label className="scan-field">
          <span>Booking ID thủ công</span>
          <div className="scan-inline">
            <input
              className="scan-input"
              value={manualBookingId}
              onChange={(event) => setManualBookingId(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onResolveManual();
                }
              }}
              placeholder="Nhập mã booking"
            />
            <button type="button" className="scan-secondary-btn" onClick={onResolveManual} disabled={!manualBookingId.trim()}>
              Xem booking
            </button>
          </div>
        </label>
      </div>

      {scanMode === "camera" ? (
        <div className={`camera-container${isSuccessFeedback ? " camera-container--success" : ""}`}>
          <video ref={videoRef} className="camera-video" playsInline muted />
          <canvas ref={canvasRef} className="camera-canvas-hidden" />
          <div className="camera-overlay">
            <div className={`qr-frame${isSuccessFeedback ? " qr-frame--success" : ""}`}>
              <div className="scan-laser-line" />
            </div>
          </div>
          <div className="scan-actions scan-actions--single">
            {cameraActive ? (
              <button type="button" className="scan-secondary-btn" onClick={stopCamera}>
                Tắt camera
              </button>
            ) : (
              <button type="button" className="scan-primary-btn" onClick={startCamera}>
                Bật camera
              </button>
            )}
          </div>
          {cameraActive ? <p className="scan-hint">Đang quét...</p> : null}
        </div>
      ) : null}

      {scanMode === "upload" ? (
        <div
          className="upload-dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files?.[0];
            if (file) handleImageUpload(file);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="scan-file-input"
            onChange={(event) => handleImageUpload(event.target.files?.[0])}
          />
          <p>Chọn ảnh hoặc kéo thả ảnh QR vào đây</p>
          {scanning ? <p className="scan-hint">Đang đọc QR...</p> : null}
          {imagePreview ? <img className="scan-image-preview" src={imagePreview} alt="QR preview" /> : null}
        </div>
      ) : null}

      {scanMode === "manual" ? (
        <label className="scan-field">
          <span>Nội dung QR / máy scan</span>
          <textarea
            ref={inputRef}
            className="scan-input scan-textarea"
            rows={5}
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmitQr();
              }
            }}
            placeholder='Ví dụ: {"booking_id":12} hoặc payload QR đầy đủ'
          />
        </label>
      ) : (
        <label className="scan-field">
          <span>Nội dung QR sau khi quét</span>
          <textarea
            ref={inputRef}
            className="scan-input scan-textarea"
            rows={5}
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            placeholder="Kết quả quét sẽ hiển thị tại đây"
          />
        </label>
      )}

      <div className="scan-actions scan-actions--single">
        <button type="button" className="scan-primary-btn" onClick={onSubmitQr} disabled={!scanValue.trim()}>
          Quét QR và lấy thông tin
        </button>
      </div>

      <p className="scan-hint">
        Sau khi quét/xem booking, nhân viên chủ động bấm nút cho xe vào bãi hoặc ra bãi.
      </p>

      {scanSuccess ? <p className="scan-inline-success">{scanSuccess}</p> : null}
      {scanError ? <p className="scan-inline-error">{scanError}</p> : null}
      {qrPreviewError && !scanError ? <p className="scan-inline-error">{qrPreviewError}</p> : null}
    </section>
  );
}
