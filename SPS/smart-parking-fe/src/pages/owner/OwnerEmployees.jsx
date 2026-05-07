import { useEffect, useState } from "react";
import { SectionCard } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import API from "../../services/api";

function buildParkingSettingsRows(settings) {
  return Array.isArray(settings?.parkingLots)
    ? settings.parkingLots.map((lot) => ({
      id: lot.id,
      parkingName: lot.name || "",
    }))
    : [];
}

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5c5.2 0 9.6 3.2 11 7-1.4 3.8-5.8 7-11 7S2.4 15.8 1 12C2.4 8.2 6.8 5 12 5Zm0 2C8 7 4.5 9.3 3.1 12 4.5 14.7 8 17 12 17s7.5-2.3 8.9-5C19.5 9.3 16 7 12 7Zm0 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3.3 2 18.7 18.7-1.4 1.4-3-3a13.5 13.5 0 0 1-5.6 1.2c-5.2 0-9.6-3.2-11-7a12.7 12.7 0 0 1 4.2-5.2l-3.3-3.3L3.3 2Zm3.4 7.7A10.7 10.7 0 0 0 3.1 12c1.4 2.7 4.9 5 8.9 5a10.7 10.7 0 0 0 3.8-.7l-2.1-2.1a3.5 3.5 0 0 1-4.9-4.9L6.7 9.7Zm10.7 2.1-4.3-4.3A3.5 3.5 0 0 0 9 8.3L7.2 6.5A13.2 13.2 0 0 1 12 5c5.2 0 9.6 3.2 11 7a12.7 12.7 0 0 1-3.8 5l-1.8-1.8a10.6 10.6 0 0 0 3.5-3.2c-.7-1.2-1.9-2.4-3.5-3.2Z" />
    </svg>
  );
}

const EMPTY_EDIT_FORM = {
  full_name: "",
  email: "",
  phone: "",
  parking_id: "",
  password: "",
  confirmPassword: "",
};

const EMPTY_REQUIRED_ERRORS = {
  full_name: "",
  email: "",
  phone: "",
};

function validateRequiredEmployeeFields(form) {
  const errors = { ...EMPTY_REQUIRED_ERRORS };
  if (!form.full_name?.trim()) {
    errors.full_name = "Vui lòng nhập tên tài khoản.";
  }
  if (!form.email?.trim()) {
    errors.email = "Vui lòng nhập email đăng nhập.";
  }
  if (!form.phone?.trim()) {
    errors.phone = "Vui lòng nhập số điện thoại.";
  }
  return errors;
}

function hasRequiredErrors(errors) {
  return Boolean(errors.full_name || errors.email || errors.phone);
}

export default function OwnerEmployees() {
  const EMPLOYEE_PASSWORD_MIN_LENGTH = 6;
  const EMPLOYEE_PASSWORD_NOTE = `Mật khẩu tài khoản bãi tối thiểu ${EMPLOYEE_PASSWORD_MIN_LENGTH} ký tự.`;

  const { ownerData, actions } = useOwnerContext();

  const [parkingRows, setParkingRows] = useState(() => buildParkingSettingsRows(ownerData.settings));
  const [employees, setEmployees] = useState([]);
  const [employeeCreated, setEmployeeCreated] = useState(false);
  const [employeeForm, setEmployeeForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    parking_id: "",
  });
  const [employeeRequiredErrors, setEmployeeRequiredErrors] = useState(EMPTY_REQUIRED_ERRORS);
  const [showEmployeePassword, setShowEmployeePassword] = useState(false);
  const [showEmployeeConfirmPassword, setShowEmployeeConfirmPassword] = useState(false);

  const [editingEmployeeId, setEditingEmployeeId] = useState(null);
  const [editEmployeeForm, setEditEmployeeForm] = useState(EMPTY_EDIT_FORM);
  const [editRequiredErrors, setEditRequiredErrors] = useState(EMPTY_REQUIRED_ERRORS);
  const [showEditEmployeePassword, setShowEditEmployeePassword] = useState(false);
  const [showEditEmployeeConfirmPassword, setShowEditEmployeeConfirmPassword] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await API.get("/owner/settings");
        const nextSettings = res.data?.settings || ownerData.settings;
        setParkingRows(buildParkingSettingsRows(nextSettings));
      } catch {
        setParkingRows(buildParkingSettingsRows(ownerData.settings));
      }
    };
    fetchSettings();
  }, [ownerData.settings]);

  useEffect(() => {
    setEmployeeForm((prev) => ({
      ...prev,
      parking_id: prev.parking_id || String(parkingRows[0]?.id || ""),
    }));
  }, [parkingRows]);

  useEffect(() => {
    const fetchEmployees = async () => {
      const nextEmployees = await actions.listEmployees();
      setEmployees(nextEmployees);
    };
    fetchEmployees();
  }, [actions]);

  const startEditEmployee = (employee) => {
    setEditingEmployeeId(employee.id);
    setEditEmployeeForm({
      full_name: employee.full_name || "",
      email: employee.email || "",
      phone: employee.phone || "",
      parking_id: String(employee.parking_id || ""),
      password: "",
      confirmPassword: "",
    });
    setEditRequiredErrors(EMPTY_REQUIRED_ERRORS);
    setShowEditEmployeePassword(false);
    setShowEditEmployeeConfirmPassword(false);
  };

  const cancelEditEmployee = () => {
    setEditingEmployeeId(null);
    setEditEmployeeForm(EMPTY_EDIT_FORM);
    setEditRequiredErrors(EMPTY_REQUIRED_ERRORS);
    setShowEditEmployeePassword(false);
    setShowEditEmployeeConfirmPassword(false);
  };

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Quản lý tài khoản bãi"
        subtitle="Trang riêng để tạo, sửa và xóa tài khoản đăng nhập khu vực /employee."
      >
        <form
          className="owner-settings-form"
          onSubmit={async (event) => {
            event.preventDefault();

            const requiredErrors = validateRequiredEmployeeFields(employeeForm);
            setEmployeeRequiredErrors(requiredErrors);
            if (hasRequiredErrors(requiredErrors)) {
              return;
            }

            if (!employeeForm.parking_id) {
              window.alert("Vui lòng chọn bãi phụ trách cho tài khoản bãi");
              return;
            }
            const parkingId = Number(employeeForm.parking_id);
            const allowedParking = parkingRows.some((row) => Number(row.id) === parkingId);
            if (!allowedParking) {
              window.alert("Bạn chỉ có thể tạo tài khoản cho bãi xe thuộc owner hiện tại.");
              return;
            }
            if ((employeeForm.password || "").length < EMPLOYEE_PASSWORD_MIN_LENGTH) {
              window.alert(EMPLOYEE_PASSWORD_NOTE);
              return;
            }
            if (employeeForm.password !== employeeForm.confirmPassword) {
              window.alert("Mật khẩu xác nhận không khớp");
              return;
            }

            const created = await actions.createEmployee({
              full_name: employeeForm.full_name.trim(),
              email: employeeForm.email.trim().toLowerCase(),
              phone: employeeForm.phone.trim(),
              password: employeeForm.password,
              parking_id: parkingId,
            });
            if (!created) {
              return;
            }

            setEmployeeCreated(true);
            setEmployeeForm((prev) => ({
              ...prev,
              full_name: "",
              email: "",
              phone: "",
              password: "",
              confirmPassword: "",
            }));
            setEmployeeRequiredErrors(EMPTY_REQUIRED_ERRORS);
            setShowEmployeePassword(false);
            setShowEmployeeConfirmPassword(false);

            const nextEmployees = await actions.listEmployees();
            setEmployees(nextEmployees);
          }}
        >
          <label>
            Tên tài khoản
            <input className="owner-input" value={employeeForm.full_name} onChange={(event) => {
              setEmployeeCreated(false);
              setEmployeeForm((prev) => ({ ...prev, full_name: event.target.value }));
              if (employeeRequiredErrors.full_name) {
                setEmployeeRequiredErrors((prev) => ({ ...prev, full_name: "" }));
              }
            }} />
            <span className="owner-input-error-slot">{employeeRequiredErrors.full_name || ""}</span>
          </label>
          <label>
            Email đăng nhập
            <input className="owner-input" type="email" value={employeeForm.email} onChange={(event) => {
              setEmployeeCreated(false);
              setEmployeeForm((prev) => ({ ...prev, email: event.target.value }));
              if (employeeRequiredErrors.email) {
                setEmployeeRequiredErrors((prev) => ({ ...prev, email: "" }));
              }
            }} />
            <span className="owner-input-error-slot">{employeeRequiredErrors.email || ""}</span>
          </label>
          <label>
            Số điện thoại
            <input className="owner-input" value={employeeForm.phone} onChange={(event) => {
              setEmployeeCreated(false);
              setEmployeeForm((prev) => ({ ...prev, phone: event.target.value }));
              if (employeeRequiredErrors.phone) {
                setEmployeeRequiredErrors((prev) => ({ ...prev, phone: "" }));
              }
            }} />
            <span className="owner-input-error-slot">{employeeRequiredErrors.phone || ""}</span>
          </label>
          <label>
            Bãi phụ trách
            <select className="owner-input owner-select" value={employeeForm.parking_id} onChange={(event) => {
              setEmployeeCreated(false);
              setEmployeeForm((prev) => ({ ...prev, parking_id: event.target.value }));
            }}>
              {parkingRows.map((row) => (
                <option key={row.id} value={row.id}>{row.parkingName}</option>
              ))}
            </select>
            <span className="owner-input-error-slot">{""}</span>
          </label>
          <label>
            Mật khẩu
            <div className="owner-input-wrap owner-input-wrap--password">
              <input className="owner-input owner-input--with-icon" type={showEmployeePassword ? "text" : "password"} minLength={EMPLOYEE_PASSWORD_MIN_LENGTH} value={employeeForm.password} onChange={(event) => {
                setEmployeeCreated(false);
                setEmployeeForm((prev) => ({ ...prev, password: event.target.value }));
              }} />
              <button
                type="button"
                className="owner-password-icon owner-password-icon--inside"
                aria-label={showEmployeePassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                onClick={() => setShowEmployeePassword((prev) => !prev)}
              >
                <EyeIcon open={showEmployeePassword} />
              </button>
            </div>
            <span className="owner-input-error-slot">{""}</span>
          </label>
          <label>
            Nhập lại mật khẩu
            <div className="owner-input-wrap owner-input-wrap--password">
              <input className="owner-input owner-input--with-icon" type={showEmployeeConfirmPassword ? "text" : "password"} minLength={EMPLOYEE_PASSWORD_MIN_LENGTH} value={employeeForm.confirmPassword} onChange={(event) => {
                setEmployeeCreated(false);
                setEmployeeForm((prev) => ({ ...prev, confirmPassword: event.target.value }));
              }} />
              <button
                type="button"
                className="owner-password-icon owner-password-icon--inside"
                aria-label={showEmployeeConfirmPassword ? "Ẩn xác nhận mật khẩu" : "Hiện xác nhận mật khẩu"}
                onClick={() => setShowEmployeeConfirmPassword((prev) => !prev)}
              >
                <EyeIcon open={showEmployeeConfirmPassword} />
              </button>
            </div>
            <span className="owner-input-error-slot">{""}</span>
          </label>
          <p className="owner-save-note owner-form-span">{EMPLOYEE_PASSWORD_NOTE}</p>
          <div className="owner-settings-actions owner-form-span">
            {employeeCreated ? <p className="owner-save-note">Đã tạo tài khoản bãi thành công.</p> : <span />}
            <button type="submit" className="btn-primary owner-btn">Tạo tài khoản bãi</button>
          </div>
        </form>

        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Tên tài khoản</th>
                <th>Email</th>
                <th>SĐT</th>
                <th>Bãi phụ trách</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={6} className="owner-empty-cell">Chưa có tài khoản bãi nào.</td>
                </tr>
              ) : employees.map((employee) => (
                <tr key={employee.id}>
                  <td>{employee.full_name || employee.username}</td>
                  <td>{employee.email || "-"}</td>
                  <td>{employee.phone || "-"}</td>
                  <td>{employee.parking_name || `Bãi #${employee.parking_id}`}</td>
                  <td>
                    <span className={`owner-badge ${employee.status === "active" ? "owner-badge--success" : "owner-badge--warning"}`}>
                      {employee.status}
                    </span>
                  </td>
                  <td>
                    <div className="owner-row-actions">
                      <button
                        type="button"
                        className="btn-secondary owner-btn owner-btn--small"
                        onClick={() => startEditEmployee(employee)}
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        className="btn-secondary owner-btn owner-btn--small owner-btn--danger"
                        onClick={async () => {
                          const ok = window.confirm("Xóa tài khoản bãi này vĩnh viễn?");
                          if (!ok) {
                            return;
                          }
                          const deleted = await actions.deleteEmployee(employee.id);
                          if (!deleted) {
                            return;
                          }
                          if (editingEmployeeId === employee.id) {
                            cancelEditEmployee();
                          }
                          const nextEmployees = await actions.listEmployees();
                          setEmployees(nextEmployees);
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingEmployeeId ? (
          <form
            className="owner-settings-form owner-settings-form--employee"
            onSubmit={async (event) => {
              event.preventDefault();

              const requiredErrors = validateRequiredEmployeeFields(editEmployeeForm);
              setEditRequiredErrors(requiredErrors);
              if (hasRequiredErrors(requiredErrors)) {
                return;
              }

              const parkingId = Number(editEmployeeForm.parking_id);
              const allowedParking = parkingRows.some((row) => Number(row.id) === parkingId);
              if (!allowedParking) {
                window.alert("Bạn chỉ có thể gán tài khoản bãi vào bãi thuộc owner hiện tại.");
                return;
              }
              if (editEmployeeForm.password && editEmployeeForm.password.length < EMPLOYEE_PASSWORD_MIN_LENGTH) {
                window.alert(EMPLOYEE_PASSWORD_NOTE);
                return;
              }
              if (editEmployeeForm.password !== editEmployeeForm.confirmPassword) {
                window.alert("Mật khẩu xác nhận không khớp");
                return;
              }

              const payload = {
                full_name: editEmployeeForm.full_name.trim(),
                email: editEmployeeForm.email.trim().toLowerCase(),
                phone: editEmployeeForm.phone.trim(),
                parking_id: parkingId,
              };
              if (editEmployeeForm.password) {
                payload.password = editEmployeeForm.password;
              }

              const updated = await actions.updateEmployee(editingEmployeeId, payload);
              if (!updated) {
                return;
              }

              const nextEmployees = await actions.listEmployees();
              setEmployees(nextEmployees);
              cancelEditEmployee();
            }}
          >
            <label className="owner-form-span">Chỉnh sửa tài khoản bãi</label>
            <label>
              Tên tài khoản
              <input
                className="owner-input"
                value={editEmployeeForm.full_name}
                onChange={(event) => {
                  setEditEmployeeForm((prev) => ({ ...prev, full_name: event.target.value }));
                  if (editRequiredErrors.full_name) {
                    setEditRequiredErrors((prev) => ({ ...prev, full_name: "" }));
                  }
                }}
              />
              <span className="owner-input-error-slot">{editRequiredErrors.full_name || ""}</span>
            </label>
            <label>
              Email đăng nhập
              <input
                className="owner-input"
                type="email"
                value={editEmployeeForm.email}
                onChange={(event) => {
                  setEditEmployeeForm((prev) => ({ ...prev, email: event.target.value }));
                  if (editRequiredErrors.email) {
                    setEditRequiredErrors((prev) => ({ ...prev, email: "" }));
                  }
                }}
              />
              <span className="owner-input-error-slot">{editRequiredErrors.email || ""}</span>
            </label>
            <label>
              Số điện thoại
              <input
                className="owner-input"
                value={editEmployeeForm.phone}
                onChange={(event) => {
                  setEditEmployeeForm((prev) => ({ ...prev, phone: event.target.value }));
                  if (editRequiredErrors.phone) {
                    setEditRequiredErrors((prev) => ({ ...prev, phone: "" }));
                  }
                }}
              />
              <span className="owner-input-error-slot">{editRequiredErrors.phone || ""}</span>
            </label>
            <label>
              Bãi phụ trách
              <select
                className="owner-input owner-select"
                value={editEmployeeForm.parking_id}
                onChange={(event) => setEditEmployeeForm((prev) => ({ ...prev, parking_id: event.target.value }))}
              >
                {parkingRows.map((row) => (
                  <option key={row.id} value={row.id}>{row.parkingName}</option>
                ))}
              </select>
              <span className="owner-input-error-slot">{""}</span>
            </label>
            <label>
              Mật khẩu mới (tùy chọn)
              <div className="owner-input-wrap owner-input-wrap--password">
                <input
                  className="owner-input owner-input--with-icon"
                  type={showEditEmployeePassword ? "text" : "password"}
                  minLength={EMPLOYEE_PASSWORD_MIN_LENGTH}
                  value={editEmployeeForm.password}
                  onChange={(event) => setEditEmployeeForm((prev) => ({ ...prev, password: event.target.value }))}
                />
                <button
                  type="button"
                  className="owner-password-icon owner-password-icon--inside"
                  aria-label={showEditEmployeePassword ? "Ẩn mật khẩu mới" : "Hiện mật khẩu mới"}
                  onClick={() => setShowEditEmployeePassword((prev) => !prev)}
                >
                  <EyeIcon open={showEditEmployeePassword} />
                </button>
              </div>
              <span className="owner-input-error-slot">{""}</span>
            </label>
            <label>
              Nhập lại mật khẩu mới
              <div className="owner-input-wrap owner-input-wrap--password">
                <input
                  className="owner-input owner-input--with-icon"
                  type={showEditEmployeeConfirmPassword ? "text" : "password"}
                  minLength={EMPLOYEE_PASSWORD_MIN_LENGTH}
                  value={editEmployeeForm.confirmPassword}
                  onChange={(event) => setEditEmployeeForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                />
                <button
                  type="button"
                  className="owner-password-icon owner-password-icon--inside"
                  aria-label={showEditEmployeeConfirmPassword ? "Ẩn xác nhận mật khẩu mới" : "Hiện xác nhận mật khẩu mới"}
                  onClick={() => setShowEditEmployeeConfirmPassword((prev) => !prev)}
                >
                  <EyeIcon open={showEditEmployeeConfirmPassword} />
                </button>
              </div>
              <span className="owner-input-error-slot">{""}</span>
            </label>
            <p className="owner-save-note owner-form-span">{EMPLOYEE_PASSWORD_NOTE}</p>
            <div className="owner-settings-actions owner-form-span">
              <button type="button" className="btn-secondary owner-btn" onClick={cancelEditEmployee}>Hủy</button>
              <button type="submit" className="btn-primary owner-btn">Lưu chỉnh sửa</button>
            </div>
          </form>
        ) : null}
      </SectionCard>
    </div>
  );
}
