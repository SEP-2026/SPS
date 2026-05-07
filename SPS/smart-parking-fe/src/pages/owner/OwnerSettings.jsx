import { useEffect, useState } from "react";
import { SectionCard } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { isStrongPassword, PASSWORD_POLICY_TEXT } from "../../services/passwordPolicy";
import API from "../../services/api";

function buildParkingSettingsRows(settings) {
  return Array.isArray(settings?.parkingLots)
    ? settings.parkingLots.map((lot) => ({
      id: lot.id,
      parkingName: lot.name || "",
      pricePerHour: lot.pricePerHour || "0",
      pricePerDay: lot.pricePerDay || "0",
      pricePerMonth: lot.pricePerMonth || "0",
      slotCapacity: lot.slotCapacity || 0,
      address: lot.address || "",
      district: lot.district || "",
    }))
    : [];
}

export default function OwnerSettings() {
  const { auth, ownerData, actions } = useOwnerContext();
  const [settingsData, setSettingsData] = useState(ownerData.settings);
  const [ownerForm, setOwnerForm] = useState({
    contactPhone: ownerData.settings.contactPhone || "",
    contactEmail: ownerData.settings.contactEmail || "",
  });
  const [parkingRows, setParkingRows] = useState(() => buildParkingSettingsRows(ownerData.settings));
  const [accountForm, setAccountForm] = useState({
    email: auth?.user?.email || "",
    password: "",
    confirmPassword: "",
  });
  const [ownerSaved, setOwnerSaved] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);
  const [savedParkingId, setSavedParkingId] = useState(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await API.get("/owner/settings");
        const nextSettings = res.data?.settings || ownerData.settings;
        setSettingsData(nextSettings);
        setOwnerForm({
          contactPhone: nextSettings.contactPhone || "",
          contactEmail: nextSettings.contactEmail || "",
        });
        setParkingRows(buildParkingSettingsRows(nextSettings));
      } catch {
        setSettingsData(ownerData.settings);
        setOwnerForm({
          contactPhone: ownerData.settings.contactPhone || "",
          contactEmail: ownerData.settings.contactEmail || "",
        });
        setParkingRows(buildParkingSettingsRows(ownerData.settings));
      }
    };
    fetchSettings();
  }, [ownerData.settings]);

  useEffect(() => {
    setAccountForm((prev) => ({
      ...prev,
      email: auth?.user?.email || "",
    }));
  }, [auth?.user?.email]);

  const handleParkingChange = (parkingId, key, value) => {
    setSavedParkingId(null);
    setParkingRows((prev) => prev.map((row) => (row.id === parkingId ? { ...row, [key]: value } : row)));
  };

  return (
    <div className="owner-page-grid">
      <SectionCard title="Tài khoản Owner" subtitle="Tài khoản này do admin cấp. Owner có thể thay đổi email và mật khẩu sau khi đăng nhập.">
        <form
          className="owner-settings-form owner-settings-form--employee"
          onSubmit={async (event) => {
            event.preventDefault();
            if (accountForm.password || accountForm.confirmPassword) {
              if (!isStrongPassword(accountForm.password)) {
                window.alert(PASSWORD_POLICY_TEXT);
                return;
              }
            }
            const ok = await actions.updateAccount(accountForm);
            if (ok) {
              setAccountSaved(true);
              setAccountForm((prev) => ({ ...prev, password: "", confirmPassword: "" }));
            }
          }}
        >
          <label>
            Email đăng nhập
            <input className="owner-input" value={accountForm.email} onChange={(event) => {
              setAccountSaved(false);
              setAccountForm((prev) => ({ ...prev, email: event.target.value }));
            }} />
          </label>
          <label>
            Mật khẩu mới
            <input className="owner-input" type="password" minLength={8} value={accountForm.password} onChange={(event) => {
              setAccountSaved(false);
              setAccountForm((prev) => ({ ...prev, password: event.target.value }));
            }} />
          </label>
          <label>
            Nhập lại mật khẩu
            <input className="owner-input" type="password" minLength={8} value={accountForm.confirmPassword} onChange={(event) => {
              setAccountSaved(false);
              setAccountForm((prev) => ({ ...prev, confirmPassword: event.target.value }));
            }} />
          </label>
          <p className="owner-save-note owner-form-span">{PASSWORD_POLICY_TEXT}</p>
          <div className="owner-settings-actions owner-form-span">
            {accountSaved ? <p className="owner-save-note">Đã lưu thông tin tài khoản.</p> : <span />}
            <button type="submit" className="btn-primary owner-btn">Cập nhật tài khoản</button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Thông tin owner" subtitle="Thông tin liên hệ và khu vực owner đang được phân công trong hệ thống.">
        <form className="owner-settings-form" onSubmit={async (event) => {
          event.preventDefault();
          const ok = await actions.updateSettings(ownerForm);
          if (ok) {
            setOwnerSaved(true);
            const res = await API.get("/owner/settings");
            const nextSettings = res.data?.settings || settingsData;
            setSettingsData(nextSettings);
          }
        }}>
          <label>
            Họ tên owner
            <input className="owner-input" value={settingsData.contactName || ""} disabled />
          </label>
          <label>
            Quận phụ trách
            <input className="owner-input" value={settingsData.districtName || "Chưa gán"} disabled />
          </label>
          <label>
            Số bãi đang quản lý
            <input className="owner-input" value={settingsData.managedParkingCount || "0"} disabled />
          </label>
          <label>
            Tổng sức chứa toàn bộ bãi
            <input className="owner-input" value={settingsData.totalSlotCapacity || "0"} disabled />
          </label>
          <label>
            Số điện thoại liên hệ
            <input className="owner-input" value={ownerForm.contactPhone} onChange={(event) => {
              setOwnerSaved(false);
              setOwnerForm((prev) => ({ ...prev, contactPhone: event.target.value }));
            }} />
          </label>
          <label>
            Email liên hệ
            <input className="owner-input" value={ownerForm.contactEmail} onChange={(event) => {
              setOwnerSaved(false);
              setOwnerForm((prev) => ({ ...prev, contactEmail: event.target.value }));
            }} />
          </label>
          <div className="owner-settings-actions owner-form-span">
            {ownerSaved ? <p className="owner-save-note">Đã cập nhật thông tin owner.</p> : <span />}
            <button type="submit" className="btn-primary owner-btn">Lưu thông tin owner</button>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Giá và cấu hình theo bãi" subtitle="Mỗi bãi owner quản lý dùng dữ liệu thật từ CSDL, không còn cấu hình giả toàn hệ thống.">
        <div className="owner-settings-stack">
          {parkingRows.map((row) => (
            <form
              key={row.id}
              className="owner-settings-form owner-settings-form--card"
              onSubmit={async (event) => {
                event.preventDefault();
                const ok = await actions.updateParkingLotSettings(row.id, {
                  parkingName: row.parkingName,
                  pricePerHour: row.pricePerHour,
                  pricePerDay: row.pricePerDay,
                  pricePerMonth: row.pricePerMonth,
                });
                if (ok) {
                  setSavedParkingId(row.id);
                  const res = await API.get("/owner/settings");
                  const nextSettings = res.data?.settings || settingsData;
                  setSettingsData(nextSettings);
                  setParkingRows(buildParkingSettingsRows(nextSettings));
                }
              }}
            >
              <label className="owner-form-span">
                Tên bãi đỗ
                <input className="owner-input" value={row.parkingName} onChange={(event) => handleParkingChange(row.id, "parkingName", event.target.value)} />
              </label>
              <label className="owner-form-span">
                Địa chỉ
                <input className="owner-input" value={[row.address, row.district].filter(Boolean).join(" • ")} disabled />
              </label>
              <label>
                Số chỗ đỗ
                <input className="owner-input" value={row.slotCapacity} disabled />
              </label>
              <label>
                Giá theo giờ (VND)
                <input className="owner-input" value={row.pricePerHour} onChange={(event) => handleParkingChange(row.id, "pricePerHour", event.target.value)} />
              </label>
              <label>
                Giá theo ngày (VND)
                <input className="owner-input" value={row.pricePerDay} onChange={(event) => handleParkingChange(row.id, "pricePerDay", event.target.value)} />
              </label>
              <label>
                Giá theo tháng (VND)
                <input className="owner-input" value={row.pricePerMonth} onChange={(event) => handleParkingChange(row.id, "pricePerMonth", event.target.value)} />
              </label>
              <div className="owner-settings-actions owner-form-span">
                {savedParkingId === row.id ? <p className="owner-save-note">Đã cập nhật cấu hình bãi.</p> : <span />}
                <button type="submit" className="btn-primary owner-btn">Lưu cấu hình bãi</button>
              </div>
            </form>
          ))}
          {parkingRows.length === 0 ? <p className="owner-empty-cell">Owner hiện chưa được gán bãi đỗ nào.</p> : null}
        </div>
      </SectionCard>
    </div>
  );
}
