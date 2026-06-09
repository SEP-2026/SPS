import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import API, { getAuth, saveAuth } from "../services/api";
import { buildDynamicVietQrUrl } from "../features/gate/gateFormatters";
import { formatCurrency } from "../features/gate/gateFormatters";
import { isStrongPassword, PASSWORD_POLICY_TEXT } from "../services/passwordPolicy";
import { useWallet } from "../context/WalletContext";
import "./Profile.css";

const normalizeError = (err, fallback) => {
  const detail = err?.response?.data?.detail;
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
  return fallback;
};

const normalizeText = (value) => String(value || "").trim();

const formatCurrencyString = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return Number(digits).toLocaleString("vi-VN");
};

const parseCurrencyString = (value) => String(value || "").replace(/\D/g, "");

const isEqualByKeys = (current, initial, keys) => keys.every((key) => normalizeText(current[key]) === normalizeText(initial[key]));

const getNoticeTone = (notice) => {
  const normalizedNotice = normalizeText(notice).toLowerCase();
  if (!normalizedNotice) {
    return "";
  }
  if (normalizedNotice.includes("thành công") || normalizedNotice.includes("đồng bộ")) {
    return "success";
  }
  return "error";
};

export default function Profile({ onAuthUpdated }) {
  const auth = getAuth();
  const location = useLocation();
  const role = auth?.user?.role || "user";
  const isVehicleProfileAvailable = role === "user";
  const isWalletAvailable = role === "user";
  const isOwner = role === "owner";
  const isAdmin = role === "admin";
  const { wallet, loading: walletQueryLoading, error: walletQueryError, refreshWallet } = useWallet();
  const [activeSection, setActiveSection] = useState("personal");

  const [loading, setLoading] = useState(true);
  const [personalLoading, setPersonalLoading] = useState(false);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [managerLoading, setManagerLoading] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);

  const [personalNotice, setPersonalNotice] = useState("");
  const [vehicleNotice, setVehicleNotice] = useState("");
  const [walletNotice, setWalletNotice] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [managerNotice, setManagerNotice] = useState("");

  const [personalForm, setPersonalForm] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [initialPersonalForm, setInitialPersonalForm] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [vehicleForm, setVehicleForm] = useState({
    licensePlate: "",
    brand: "",
    vehicleModel: "",
    seatCount: "",
    vehicleColor: "",
  });
  const [initialVehicleForm, setInitialVehicleForm] = useState({
    licensePlate: "",
    brand: "",
    vehicleModel: "",
    seatCount: "",
    vehicleColor: "",
  });
  const [showVehicleForm, setShowVehicleForm] = useState(false);

  const [passwordForm, setPasswordForm] = useState({
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordVisibility, setPasswordVisibility] = useState({
    oldPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [managerInfo, setManagerInfo] = useState({
    managedDistrict: "",
    managedLotsCount: 0,
    totalSlots: 0,
    occupiedSlots: 0,
  });
  const [walletTopUpAmount, setWalletTopUpAmount] = useState("");
  const [walletPendingAmount, setWalletPendingAmount] = useState(null);
  const [walletTopUpQrUrl, setWalletTopUpQrUrl] = useState("");

  const greetingName = useMemo(() => personalForm.name || auth?.user?.name || "User", [personalForm.name, auth?.user?.name]);
  const sectionTitle = useMemo(() => {
    if (activeSection === "manager") {
      return isAdmin ? "Thông tin quản trị" : "Thông tin quản lý";
    }
    if (activeSection === "wallet") {
      return "Ví điện tử";
    }
    if (activeSection === "vehicle") {
      return "Thông tin xe";
    }
    if (activeSection === "password") {
      return "Đổi mật khẩu";
    }
    return "Thông tin cá nhân";
  }, [activeSection]);

  const isPersonalDirty = useMemo(
    () => !isEqualByKeys(personalForm, initialPersonalForm, ["name", "email", "phone"]),
    [personalForm, initialPersonalForm],
  );

  const isVehicleDirty = useMemo(
    () => !isEqualByKeys(vehicleForm, initialVehicleForm, ["licensePlate", "brand", "vehicleModel", "seatCount", "vehicleColor"]),
    [vehicleForm, initialVehicleForm],
  );

  const passwordChecklist = useMemo(() => {
    const password = passwordForm.newPassword || "";
    return {
      minLength: password.length >= 8,
      hasUpperLower: /[A-Z]/.test(password) && /[a-z]/.test(password),
      hasDigit: /\d/.test(password),
      hasSpecial: /[^A-Za-z0-9]/.test(password),
    };
  }, [passwordForm.newPassword]);

  const isPasswordReady = useMemo(
    () => Object.values(passwordChecklist).every(Boolean) && passwordForm.newPassword === passwordForm.confirmPassword,
    [passwordChecklist, passwordForm.newPassword, passwordForm.confirmPassword],
  );

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");

    if (!hash) {
      setActiveSection((current) => (current === "wallet" || current === "vehicle" || current === "password" || current === "manager" ? "personal" : current));
      return;
    }

    if (hash === "wallet" && isWalletAvailable) {
      setActiveSection("wallet");
      return;
    }

    if (hash === "vehicles" && isVehicleProfileAvailable) {
      setActiveSection("vehicle");
      return;
    }

    if (hash === "settings") {
      setActiveSection("personal");
      return;
    }

    if (hash === "support" || hash === "notifications") {
      setActiveSection("personal");
    }
  }, [isVehicleProfileAvailable, isWalletAvailable, location.hash]);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        const requests = [API.get("/auth/me")];
        if (isVehicleProfileAvailable) {
          requests.push(API.get("/vehicle/my"));
        }
        if (isOwner) {
          requests.push(API.get("/owner/parking-lots/slots-overview"));
        }

        const responses = await Promise.all(requests);
        const meRes = responses[0];
        const vehicleRes = isVehicleProfileAvailable ? responses[1] : null;
        const ownerOverviewRes = isOwner ? responses[responses.length - 1] : null;

        const me = meRes.data || {};
        const vehicle = vehicleRes?.data?.vehicle || {};
        const ownerLots = Array.isArray(ownerOverviewRes?.data) ? ownerOverviewRes.data : [];

        setPersonalForm({
          name: me.name || "",
          email: me.email || "",
          phone: me.phone || "",
        });
        setInitialPersonalForm({
          name: me.name || "",
          email: me.email || "",
          phone: me.phone || "",
        });

        const nextVehicleForm = {
          licensePlate: vehicle.license_plate || me.vehicle_plate || "",
          brand: vehicle.brand || "",
          vehicleModel: vehicle.vehicle_model || "",
          seatCount: vehicle.seat_count ? String(vehicle.seat_count) : "",
          vehicleColor: vehicle.vehicle_color || me.vehicle_color || "",
        };

        setVehicleForm(nextVehicleForm);
        setInitialVehicleForm(nextVehicleForm);

        if (isOwner) {
          const totalSlots = ownerLots.reduce((sum, lot) => sum + Number(lot.total_slots || 0), 0);
          const occupiedSlots = ownerLots.reduce((sum, lot) => sum + Number(lot.occupied_or_reserved_slots || 0), 0);
          setManagerInfo({
            managedDistrict: me.managed_district || "",
            managedLotsCount: ownerLots.length,
            totalSlots,
            occupiedSlots,
          });
        } else if (isAdmin) {
          setManagerInfo({
            managedDistrict: "",
            managedLotsCount: 0,
            totalSlots: 0,
            occupiedSlots: 0,
          });
        }

        if (auth?.token) {
          const nextAuth = {
            ...auth,
            user: {
              ...auth.user,
              ...me,
            },
          };
          const savedAuth = saveAuth(nextAuth) || nextAuth;
          if (onAuthUpdated) {
            onAuthUpdated(savedAuth);
          }
        }
      } catch (err) {
        setPersonalNotice(normalizeError(err, "Không tải được hồ sơ người dùng"));
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [isAdmin, isOwner, isVehicleProfileAvailable]);

  const handleSavePersonal = async (event) => {
    event.preventDefault();
    setPersonalNotice("");

    if (!personalForm.name.trim()) {
      setPersonalNotice("Tên không được để trống");
      return;
    }

    if (!personalForm.email.trim()) {
      setPersonalNotice("Email không được để trống");
      return;
    }

    try {
      setPersonalLoading(true);
      const res = await API.put("/auth/me", {
        name: personalForm.name.trim(),
        email: personalForm.email.trim().toLowerCase(),
        phone: personalForm.phone.trim() || null,
      });

      const updatedUser = res.data?.user || {};
      const currentAuth = getAuth();
      if (currentAuth?.token) {
        const nextAuth = {
          ...currentAuth,
          user: {
            ...currentAuth.user,
            ...updatedUser,
          },
        };
        const savedAuth = saveAuth(nextAuth) || nextAuth;
        if (onAuthUpdated) {
          onAuthUpdated(savedAuth);
        }
      }

      setPersonalForm((prev) => ({
        ...prev,
        name: updatedUser.name || prev.name,
        email: updatedUser.email || prev.email,
        phone: updatedUser.phone || "",
      }));
      setInitialPersonalForm((prev) => ({
        ...prev,
        name: updatedUser.name || prev.name,
        email: updatedUser.email || prev.email,
        phone: updatedUser.phone || "",
      }));
      setPersonalNotice("Cập nhật hồ sơ thành công");
    } catch (err) {
      setPersonalNotice(normalizeError(err, "Cập nhật hồ sơ thất bại"));
    } finally {
      setPersonalLoading(false);
    }
  };

  const handleSaveVehicle = async (event) => {
    event.preventDefault();
    setVehicleNotice("");

    if (!vehicleForm.licensePlate.trim()) {
      setVehicleNotice("Biển số xe không được để trống");
      return;
    }

    const seatCountNumber = vehicleForm.seatCount ? Number(vehicleForm.seatCount) : null;
    if (seatCountNumber !== null && (!Number.isInteger(seatCountNumber) || seatCountNumber <= 0)) {
      setVehicleNotice("Số chỗ phải là số nguyên dương");
      return;
    }

    try {
      setVehicleLoading(true);
      const saveRes = await API.post("/vehicle/my/save", {
        license_plate: vehicleForm.licensePlate.trim(),
        brand: vehicleForm.brand.trim() || null,
        vehicle_model: vehicleForm.vehicleModel.trim() || null,
        seat_count: seatCountNumber,
        vehicle_color: vehicleForm.vehicleColor.trim() || null,
      });

      const vehicle = saveRes.data?.vehicle || {};
      const nextVehicleForm = {
        licensePlate: vehicle.license_plate || "",
        brand: vehicle.brand || "",
        vehicleModel: vehicle.vehicle_model || "",
        seatCount: vehicle.seat_count ? String(vehicle.seat_count) : "",
        vehicleColor: vehicle.vehicle_color || "",
      };
      setVehicleForm(nextVehicleForm);
      setInitialVehicleForm(nextVehicleForm);

      const currentAuth = getAuth();
      if (currentAuth?.token) {
        const nextAuth = {
          ...currentAuth,
          user: {
            ...currentAuth.user,
            vehicle_plate: vehicle.license_plate || currentAuth.user?.vehicle_plate || null,
            vehicle_color: vehicle.vehicle_color || currentAuth.user?.vehicle_color || null,
          },
        };
        const savedAuth = saveAuth(nextAuth) || nextAuth;
        if (onAuthUpdated) {
          onAuthUpdated(savedAuth);
        }
      }

      setVehicleNotice("Cập nhật thông tin xe thành công");
    } catch (err) {
      setVehicleNotice(normalizeError(err, "Cập nhật thông tin xe thất bại"));
    } finally {
      setVehicleLoading(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setPasswordNotice("");

    if (!passwordForm.oldPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordNotice("Vui lòng nhập đủ thông tin mật khẩu");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordNotice("Mật khẩu mới và xác nhận mật khẩu không khớp");
      return;
    }

    if (!isStrongPassword(passwordForm.newPassword)) {
      setPasswordNotice(PASSWORD_POLICY_TEXT);
      return;
    }

    try {
      setPasswordLoading(true);
      await API.post("/auth/change-password", {
        old_password: passwordForm.oldPassword,
        new_password: passwordForm.newPassword,
      });

      setPasswordForm({
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordVisibility({
        oldPassword: false,
        newPassword: false,
        confirmPassword: false,
      });
      setPasswordNotice("Đổi mật khẩu thành công");
    } catch (err) {
      setPasswordNotice(normalizeError(err, "Đổi mật khẩu thất bại"));
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSaveManager = async (event) => {
    event.preventDefault();
    setManagerNotice("");

    if (!managerInfo.managedDistrict.trim()) {
      setManagerNotice(isAdmin ? "Thông tin quản trị đang trống" : "Owner chưa được gán quận quản lý");
      return;
    }

    try {
      setManagerLoading(true);
      setManagerNotice(isAdmin ? "Thông tin quản trị đang được đồng bộ." : "Thông tin quản lý đã được đồng bộ từ hệ thống.");
    } finally {
      setManagerLoading(false);
    }
  };

  const handleTopUpWallet = async (event) => {
    event.preventDefault();
    setWalletNotice("");

    const amount = Number(walletTopUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      return;
    }

    setWalletPendingAmount(amount);
    setWalletTopUpQrUrl("");
  };

  const confirmTopUpWallet = async () => {
    if (!Number.isFinite(walletPendingAmount) || walletPendingAmount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      return;
    }

    const qrUrl = buildDynamicVietQrUrl(walletPendingAmount, `WALLET-${auth?.user?.id || "USER"}`);
    if (!qrUrl) {
      setWalletNotice("Không thể tạo QR chuyển khoản");
      return;
    }

    setWalletTopUpQrUrl(qrUrl);
    setWalletNotice("Quét QR và chuyển đúng số tiền, sau đó bấm xác nhận để cộng vào ví");
  };

  const completeTopUpWallet = async () => {
    if (!Number.isFinite(walletPendingAmount) || walletPendingAmount <= 0) {
      setWalletNotice("Số tiền nạp phải lớn hơn 0");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      return;
    }

    try {
      setWalletLoading(true);
      await API.post("/wallet/topup", {
        amount: walletPendingAmount,
        note: "Nạp ví qua QR chuyển khoản",
      });
      await refreshWallet();
      setWalletTopUpAmount("");
      setWalletPendingAmount(null);
      setWalletTopUpQrUrl("");
      setWalletNotice("Nạp tiền thành công");
    } catch (err) {
      setWalletNotice(normalizeError(err, "Nạp tiền thất bại"));
    } finally {
      setWalletLoading(false);
    }
  };

  const cancelTopUpWallet = () => {
    setWalletPendingAmount(null);
    setWalletTopUpQrUrl("");
  };

  if (loading) {
    return (
      <section className="page-wrap">
        <div className="page-card profile-shell profile-frame">
          <p>Đang tải hồ sơ...</p>
        </div>
      </section>
    );
  }

  const hash = location.hash.replace(/^#/, "");
  const isSettingsPage = hash === "settings";

  return (
    <section className="page-wrap">
      <div className={`page-card profile-shell ${isSettingsPage ? 'settings-frame' : 'profile-frame'}`}>
        {isSettingsPage ? (
          <header className="settings-header">
            <div className="settings-breadcrumb">Trang chủ &gt; Cài đặt</div>
            <div className="settings-title-row">
              <h1 className="settings-title">Cài đặt</h1>
              <p className="settings-subtitle">Quản lý thông tin tài khoản và bảo mật</p>
            </div>
          </header>
        ) : (
          <header className="profile-header">
            <span className="profile-spark profile-spark-left" aria-hidden="true">✦</span>
            <span className="profile-spark profile-spark-right" aria-hidden="true">✦</span>
            <h1 className="page-title">Hồ sơ tài khoản</h1>
            <p className="page-subtitle profile-subtitle">👤 Xin chào, <strong>{greetingName}</strong></p>
            <div className="profile-divider" aria-hidden="true">────◆────</div>
            <div className="profile-summary" role="list" aria-label="Tóm tắt tài khoản">
              <span className="profile-summary-chip" role="listitem">Vai trò: {role}</span>
              <span className="profile-summary-chip" role="listitem">Email: {personalForm.email || "Chưa cập nhật"}</span>
              <span className="profile-summary-chip" role="listitem">SĐT: {personalForm.phone || "Chưa cập nhật"}</span>
            </div>
          </header>
        )}

        <div className={`profile-layout ${isSettingsPage ? 'settings-layout' : ''}`}>
          <aside className="profile-menu">
            <button
              type="button"
              className={`profile-menu-item ${activeSection === "personal" ? "is-active" : ""}`}
              onClick={() => setActiveSection("personal")}
            >
              <span aria-hidden="true">🪪</span>
              Thông tin cá nhân
              {isPersonalDirty ? <span className="profile-pill">Chưa lưu</span> : null}
            </button>
            <button
              type="button"
              className={`profile-menu-item ${activeSection === "password" ? "is-active" : ""}`}
              onClick={() => setActiveSection("password")}
            >
              <span aria-hidden="true">🛡</span>
              Đổi mật khẩu
            </button>
          </aside>

          <section className="profile-content">
            <h2 className="profile-content-title">{sectionTitle}</h2>

            {activeSection === "personal" && (
              <form className="profile-card" onSubmit={handleSavePersonal}>
                <label>Họ và tên</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">👤</span>
                  <input
                    className="booking-input profile-input"
                    autoComplete="name"
                    placeholder="Nhập họ tên đầy đủ"
                    value={personalForm.name}
                    onChange={(e) => setPersonalForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <label>Email</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">✉</span>
                  <input
                    className="booking-input profile-input"
                    type="email"
                    autoComplete="email"
                    placeholder="example@email.com"
                    value={personalForm.email}
                    onChange={(e) => setPersonalForm((prev) => ({ ...prev, email: e.target.value }))}
                  />
                </div>

                <label>Số điện thoại</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">📞</span>
                  <input
                    className="booking-input profile-input"
                    autoComplete="tel"
                    placeholder="Ví dụ: 0901 234 567"
                    value={personalForm.phone}
                    onChange={(e) => setPersonalForm((prev) => ({ ...prev, phone: e.target.value }))}
                  />
                </div>

                <button className="profile-action-btn" type="submit" disabled={personalLoading || !isPersonalDirty}>
                  {personalLoading ? "Đang lưu..." : "→ Lưu hồ sơ"}
                </button>
                <p className="profile-hint">{isPersonalDirty ? "Bạn có thay đổi chưa lưu." : "Thông tin đã được đồng bộ."}</p>
                {personalNotice ? <p className={`profile-notice ${getNoticeTone(personalNotice)}`} aria-live="polite">{personalNotice}</p> : null}
              </form>
            )}

            {activeSection === "manager" && (
              <form className="profile-card" onSubmit={handleSaveManager}>
                <div className="profile-manager-grid">
                  <article className="profile-manager-stat">
                    <span className="profile-manager-label">Vai trò</span>
                    <strong>{isAdmin ? "Quản trị hệ thống" : "Owner quản lý bãi xe"}</strong>
                  </article>
                  <article className="profile-manager-stat">
                    <span className="profile-manager-label">{isAdmin ? "Phạm vi" : "Quận phụ trách"}</span>
                    <strong>{managerInfo.managedDistrict || (isAdmin ? "Toàn hệ thống" : "Chưa được gán")}</strong>
                  </article>
                  <article className="profile-manager-stat">
                    <span className="profile-manager-label">Số bãi đang quản lý</span>
                    <strong>{managerInfo.managedLotsCount}</strong>
                  </article>
                  <article className="profile-manager-stat">
                    <span className="profile-manager-label">Tổng số chỗ đỗ</span>
                    <strong>{managerInfo.totalSlots}</strong>
                  </article>
                </div>

                <label>Quận phụ trách</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">📍</span>
                  <input
                    className="booking-input profile-input"
                    value={managerInfo.managedDistrict}
                    readOnly
                  />
                </div>

                <label>Tình trạng vận hành hiện tại</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">📊</span>
                  <input
                    className="booking-input profile-input"
                    value={`Đang sử dụng ${managerInfo.occupiedSlots}/${managerInfo.totalSlots} chỗ đỗ`}
                    readOnly
                  />
                </div>

                <label>Email liên hệ</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">✉</span>
                  <input
                    className="booking-input profile-input"
                    value={personalForm.email}
                    readOnly
                  />
                </div>

                <button className="profile-action-btn" type="submit" disabled={managerLoading}>
                  {managerLoading ? "Đang đồng bộ..." : "→ Đồng bộ thông tin quản lý"}
                </button>
                {managerNotice ? <p className={`profile-notice ${getNoticeTone(managerNotice)}`} aria-live="polite">{managerNotice}</p> : null}
              </form>
            )}

            {activeSection === "wallet" && isWalletAvailable && (
              <div className="profile-card">
                <p>Truy cập trang <a href="/wallet">Ví của tôi</a> để quản lý số dư và xem lịch sử giao dịch.</p>
              </div>
            )}

            {activeSection === "vehicle" && isVehicleProfileAvailable && (
              <div className="profile-card">
                <p>Quản lý phương tiện đã tách ra thành trang riêng.</p>
                <p><a href="/vehicles">Mở trang Phương tiện</a></p>
              </div>
            )}

            {activeSection === "password" && (
              <form className="profile-card" onSubmit={handleChangePassword}>
                <label>Mật khẩu cũ</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">🔒</span>
                  <input
                    className="booking-input profile-input"
                    type={passwordVisibility.oldPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={passwordForm.oldPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, oldPassword: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setPasswordVisibility((prev) => ({ ...prev, oldPassword: !prev.oldPassword }))}
                  >
                    {passwordVisibility.oldPassword ? "Ẩn" : "Hiện"}
                  </button>
                </div>

                <label>Mật khẩu mới</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">🔒</span>
                  <input
                    className="booking-input profile-input"
                    type={passwordVisibility.newPassword ? "text" : "password"}
                    minLength={8}
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setPasswordVisibility((prev) => ({ ...prev, newPassword: !prev.newPassword }))}
                  >
                    {passwordVisibility.newPassword ? "Ẩn" : "Hiện"}
                  </button>
                </div>

                <label>Xác nhận mật khẩu mới</label>
                <div className="profile-input-shell">
                  <span className="profile-input-icon" aria-hidden="true">🔒</span>
                  <input
                    className="booking-input profile-input"
                    type={passwordVisibility.confirmPassword ? "text" : "password"}
                    minLength={8}
                    autoComplete="new-password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="profile-password-toggle"
                    onClick={() => setPasswordVisibility((prev) => ({ ...prev, confirmPassword: !prev.confirmPassword }))}
                  >
                    {passwordVisibility.confirmPassword ? "Ẩn" : "Hiện"}
                  </button>
                </div>

                <ul className="profile-password-checklist" aria-label="Kiểm tra mật khẩu">
                  <li className={passwordChecklist.minLength ? "is-pass" : ""}>Tối thiểu 8 ký tự</li>
                  <li className={passwordChecklist.hasUpperLower ? "is-pass" : ""}>Có chữ hoa và chữ thường</li>
                  <li className={passwordChecklist.hasDigit ? "is-pass" : ""}>Có ít nhất 1 chữ số</li>
                  <li className={passwordChecklist.hasSpecial ? "is-pass" : ""}>Có ít nhất 1 ký tự đặc biệt</li>
                </ul>

                <p className="profile-notice info">{PASSWORD_POLICY_TEXT}</p>

                <button className="profile-action-btn" type="submit" disabled={passwordLoading || !isPasswordReady}>
                  {passwordLoading ? "Đang đổi mật khẩu..." : "→ Cập nhật mật khẩu"}
                </button>
                {passwordNotice ? <p className={`profile-notice ${getNoticeTone(passwordNotice)}`} aria-live="polite">{passwordNotice}</p> : null}
              </form>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
