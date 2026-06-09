import { useEffect, useState } from "react";
import API, { saveAuth } from "../services/api";
import { isStrongPassword, getPasswordStrength, PASSWORD_POLICY_TEXT } from "../services/passwordPolicy";
import "./Login.css";

export default function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [showForgotForm, setShowForgotForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [registerPlate, setRegisterPlate] = useState("");
  const [registerColor, setRegisterColor] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [forgotForm, setForgotForm] = useState({
    identity: "",
    phone: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("sessionExpired") === "1") {
      setError("Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.");
    }
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await API.post("/auth/login", {
        email: email.trim().toLowerCase(),
        password,
      });
      const authPayload = {
        token: res.data.token,
        user: res.data.user,
      };
      onLogin(saveAuth(authPayload));
    } catch (err) {
      setError(err?.response?.data?.detail || "Đăng nhập thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setFormErrors({});

    const errors = {};
    if (!registerName.trim()) {
      errors.name = "Vui lòng nhập họ tên";
    }
    if (!registerEmail.trim()) {
      errors.email = "Vui lòng nhập email";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerEmail)) {
      errors.email = "Email không hợp lệ";
    }
    if (!registerPassword) {
      errors.password = "Vui lòng nhập mật khẩu";
    } else if (!isStrongPassword(registerPassword)) {
      errors.password = PASSWORD_POLICY_TEXT;
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setLoading(true);
    try {
      await API.post("/auth/register", {
        name: registerName.trim(),
        email: registerEmail.trim().toLowerCase(),
        password: registerPassword,
        phone: registerPhone.trim() || null,
        vehicle_plate: registerPlate.trim() || null,
        vehicle_color: registerColor.trim() || null,
      });

      setSuccess("Tạo tài khoản user thành công. Bạn có thể đăng nhập ngay.");
      setMode("login");
      setEmail(registerEmail.trim().toLowerCase());
      setPassword("");
      setRegisterPassword("");
      setRegisterColor("");
    } catch (err) {
      setError(err?.response?.data?.detail || "Đăng ký thất bại");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError("");
    setSuccess("");

    const identity = forgotForm.identity.trim().toLowerCase();
    const phone = forgotForm.phone.trim();
    const newPassword = forgotForm.newPassword;
    const confirmPassword = forgotForm.confirmPassword;

    if (!identity) {
      setError("Vui lòng nhập email hoặc username employee");
      return;
    }
    if (!phone) {
      setError("Vui lòng nhập số điện thoại đã đăng ký");
      return;
    }
    if (!newPassword) {
      setError("Vui lòng nhập mật khẩu mới");
      return;
    }
    if (!isStrongPassword(newPassword)) {
      setError(PASSWORD_POLICY_TEXT);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }

    setForgotLoading(true);
    try {
      const requestRes = await API.post("/auth/forgot-password/request", {
        identity,
        phone,
      });
      await API.post("/auth/forgot-password/reset", {
        reset_token: requestRes.data.reset_token,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess("Đã đặt lại mật khẩu thành công. Bạn có thể đăng nhập ngay.");
      setShowForgotForm(false);
      setEmail(identity);
      setPassword("");
      setForgotForm({ identity: "", phone: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setError(err?.response?.data?.detail || "Đặt lại mật khẩu thất bại");
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <section className="page-wrap login-wrap">
      <div className="login-bg-shape" />
      <div className="login-map-overlay" />
      <div className="page-card login-card fancy-panel">
        <div className="parking-mark" aria-hidden="true">
          <img src="/owner-promo-car.png" alt="" className="parking-mark-car" />
        </div>
        <p className="login-kicker">Smart Parking Platform</p>
        <h1 className="page-title login-title">Bãi đỗ xe thông minh</h1>

        <div className="segment-wrap" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={`segment-btn ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
              setSuccess("");
            }}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            className={`segment-btn ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register");
              setError("");
              setSuccess("");
            }}
          >
            Tạo tài khoản
          </button>
        </div>

        {mode === "login" ? (
          <form className="login-form" onSubmit={handleLogin}>
            <label className="login-label" htmlFor="email">Email đăng nhập</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">✉</span>
              <input
                id="email"
                className="login-input"
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="email@domain.com"
                required
              />
            </div>

            <label className="login-label" htmlFor="password">Mật khẩu</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">🔒</span>
              <input
                id="password"
                className="login-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Nhập mật khẩu"
                required
              />
              <button
                type="button"
                className="input-icon right toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showPassword ? "🙈" : "👁"}
              </button>
            </div>

            <button
              type="button"
              className="forgot-link"
              onClick={() => {
                setShowForgotForm((prev) => !prev);
                setError("");
                setSuccess("");
              }}
            >
              {showForgotForm ? "An quen mat khau" : "Quen mat khau?"}
            </button>

            {showForgotForm ? (
              <div className="login-forgot-box">
                <p className="register-note">Xác minh bằng email và số điện thoại đã đăng ký.</p>
                <div className="login-form">
                  <label className="login-label" htmlFor="forgot-identity">Email đăng nhập</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">@</span>
                    <input
                      id="forgot-identity"
                      className="login-input"
                      type="text"
                      value={forgotForm.identity}
                      onChange={(event) => setForgotForm((prev) => ({ ...prev, identity: event.target.value }))}
                      placeholder="email@domain.com"
                      required
                    />
                  </div>

                  <label className="login-label" htmlFor="forgot-phone">So dien thoai da dang ky</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">#</span>
                    <input
                      id="forgot-phone"
                      className="login-input"
                      type="text"
                      value={forgotForm.phone}
                      onChange={(event) => setForgotForm((prev) => ({ ...prev, phone: event.target.value }))}
                      placeholder="09xxxxxxxx"
                      required
                    />
                  </div>

                  <label className="login-label" htmlFor="forgot-new-password">Mat khau moi</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">*</span>
                    <input
                      id="forgot-new-password"
                      className="login-input"
                      type="password"
                      minLength={8}
                      value={forgotForm.newPassword}
                      onChange={(event) => setForgotForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                      placeholder="Nhap mat khau moi"
                      required
                    />
                  </div>

                  <label className="login-label" htmlFor="forgot-confirm-password">Nhap lai mat khau moi</label>
                  <div className="input-shell">
                    <span className="input-icon" aria-hidden="true">*</span>
                    <input
                      id="forgot-confirm-password"
                      className="login-input"
                      type="password"
                      minLength={8}
                      value={forgotForm.confirmPassword}
                      onChange={(event) => setForgotForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                      placeholder="Nhap lai mat khau moi"
                      required
                    />
                  </div>

                  <p className="register-note">{PASSWORD_POLICY_TEXT}</p>
                  <button className="login-btn" type="button" disabled={forgotLoading} onClick={handleForgotPassword}>
                    {forgotLoading ? "Dang dat lai mat khau..." : "Dat lai mat khau"}
                  </button>
                </div>
              </div>
            ) : null}


            {error ? <p className="login-error">{error}</p> : null}
            {success ? <p className="login-success">{success}</p> : null}

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Đang đăng nhập...
                </>
              ) : (
                "Đăng nhập"
              )}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleRegister}>
            <p className="register-heading">Đăng ký tài khoản user</p>
            <label className="login-label" htmlFor="register-name">Họ và tên</label>
            <div className={`input-shell ${formErrors.name ? "input-error" : ""}`}>
              <span className="input-icon" aria-hidden="true">👤</span>
              <input
                id="register-name"
                className="login-input"
                value={registerName}
                onChange={(event) => {
                  setRegisterName(event.target.value);
                  if (formErrors.name) {
                    setFormErrors(prev => ({ ...prev, name: "" }));
                  }
                }}
                placeholder="Nguyen Van A"
                required
              />
            </div>
            {formErrors.name && <p className="field-error">{formErrors.name}</p>}

            <label className="login-label" htmlFor="register-email">Email</label>
            <div className={`input-shell ${formErrors.email ? "input-error" : ""}`}>
              <span className="input-icon" aria-hidden="true">✉</span>
              <input
                id="register-email"
                className="login-input"
                type="email"
                value={registerEmail}
                onChange={(event) => {
                  setRegisterEmail(event.target.value);
                  if (formErrors.email) {
                    setFormErrors(prev => ({ ...prev, email: "" }));
                  }
                }}
                placeholder="email@domain.com"
                required
              />
            </div>
            {formErrors.email && <p className="field-error">{formErrors.email}</p>}

            <label className="login-label" htmlFor="register-password">Mật khẩu</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">🔒</span>
              <input
                id="register-password"
                className={`login-input ${formErrors.password ? "input-error" : ""}`}
                type={showRegisterPassword ? "text" : "password"}
                minLength={8}
                value={registerPassword}
                onChange={(event) => {
                  setRegisterPassword(event.target.value);
                  if (formErrors.password) {
                    setFormErrors(prev => ({ ...prev, password: "" }));
                  }
                }}
                placeholder="Ví dụ: Longtu26@"
                required
              />
              <button
                type="button"
                className="input-icon right toggle-password"
                onClick={() => setShowRegisterPassword(!showRegisterPassword)}
                aria-label={showRegisterPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              >
                {showRegisterPassword ? "🙈" : "👁"}
              </button>
            </div>
            {formErrors.password ? (
              <p className="field-error">{formErrors.password}</p>
            ) : (
              <>
                <p className="register-note">{PASSWORD_POLICY_TEXT}</p>
                {registerPassword && (
                  <div className="password-strength">
                    <div className="strength-bar">
                      <div 
                        className="strength-fill" 
                        style={{ width: `${(getPasswordStrength(registerPassword).score / 5) * 100}%`, backgroundColor: getPasswordStrength(registerPassword).color }}
                      />
                    </div>
                    <span className="strength-label" style={{ color: getPasswordStrength(registerPassword).color }}>
                      {getPasswordStrength(registerPassword).label}
                    </span>
                  </div>
                )}
              </>
            )}

            <label className="login-label" htmlFor="register-phone">Số điện thoại (tùy chọn)</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">☎</span>
              <input
                id="register-phone"
                className="login-input"
                value={registerPhone}
                onChange={(event) => setRegisterPhone(event.target.value)}
                placeholder="09xxxxxxxx"
              />
            </div>

            <label className="login-label" htmlFor="register-plate">Biển số xe (tùy chọn)</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">🚙</span>
              <input
                id="register-plate"
                className="login-input"
                value={registerPlate}
                onChange={(event) => setRegisterPlate(event.target.value)}
                placeholder="30A-12345"
              />
            </div>

            <label className="login-label" htmlFor="register-color">Màu xe (tùy chọn)</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">🎨</span>
              <input
                id="register-color"
                className="login-input"
                value={registerColor}
                onChange={(event) => setRegisterColor(event.target.value)}
                placeholder="Đen, trắng, đỏ..."
              />
            </div>

            {error ? <p className="login-error">{error}</p> : null}
            {success ? <p className="login-success">{success}</p> : null}

            <button className="login-btn" type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" />
                  Đang tạo tài khoản...
                </>
              ) : (
                "Tạo tài khoản user"
              )}
            </button>

            <p className="register-note">Hệ thống chỉ cho phép tự đăng ký role user tại màn hình này.</p>
          </form>
        )}
      </div>
    </section>
  );
}
