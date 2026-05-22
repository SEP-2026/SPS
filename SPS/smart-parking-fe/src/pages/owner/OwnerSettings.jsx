import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export default function OwnerSettings() {
  const { auth, ownerData, actions } = useOwnerContext();
  const [searchParams] = useSearchParams();
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
  const [lotSearch, setLotSearch] = useState("");
  const [selectedParkingId, setSelectedParkingId] = useState(null);

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
    const parkingId = searchParams.get("parkingId");
    if (parkingId) {
      setSelectedParkingId(Number(parkingId));
    }
  }, [searchParams]);

  const filteredParkingRows = useMemo(() => {
    const query = normalizeSearchText(lotSearch);
    if (!query) {
      return parkingRows;
    }
    return parkingRows.filter((row) => (
      normalizeSearchText(`${row.parkingName} ${row.address} ${row.district}`).includes(query)
    ));
  }, [lotSearch, parkingRows]);

  const effectiveSelectedParkingId = useMemo(() => {
    if (parkingRows.some((row) => row.id === selectedParkingId)) {
      return selectedParkingId;
    }
    return parkingRows[0]?.id || null;
  }, [parkingRows, selectedParkingId]);

  const selectedParking = useMemo(
    () => parkingRows.find((row) => row.id === effectiveSelectedParkingId) || null,
    [effectiveSelectedParkingId, parkingRows],
  );

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

      <SectionCard title="Giá và cấu hình theo bãi" subtitle="Tìm và chọn một bãi đang quản lý, sau đó chỉnh giá tương ứng cho đúng bãi đó.">
        <div className="owner-parking-config-shell">
          <aside className="owner-parking-picker">
            <label className="owner-parking-search">
              Tên bãi đỗ
              <input
                className="owner-input"
                value={lotSearch}
                onChange={(event) => setLotSearch(event.target.value)}
                placeholder="Nhập tên bãi để tìm..."
              />
            </label>
            <div className="owner-parking-result-list">
              {filteredParkingRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`owner-parking-result${row.id === effectiveSelectedParkingId ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedParkingId(row.id);
                    setSavedParkingId(null);
                  }}
                >
                  <strong>{row.parkingName || "Chưa có tên bãi"}</strong>
                  <span>{[row.address, row.district].filter(Boolean).join(" • ") || "Chưa có địa chỉ"}</span>
                </button>
              ))}
              {filteredParkingRows.length === 0 ? (
                <p className="owner-empty">Không tìm thấy bãi đỗ phù hợp.</p>
              ) : null}
            </div>
          </aside>

          <div className="owner-parking-config-detail">
            {selectedParking ? (
            <form
              className="owner-settings-form owner-settings-form--card"
              onSubmit={async (event) => {
                event.preventDefault();
                const ok = await actions.updateParkingLotSettings(selectedParking.id, {
                  parkingName: selectedParking.parkingName,
                  pricePerHour: selectedParking.pricePerHour,
                  pricePerDay: selectedParking.pricePerDay,
                  pricePerMonth: selectedParking.pricePerMonth,
                });
                if (ok) {
                  setSavedParkingId(selectedParking.id);
                  const res = await API.get("/owner/settings");
                  const nextSettings = res.data?.settings || settingsData;
                  setSettingsData(nextSettings);
                  setParkingRows(buildParkingSettingsRows(nextSettings));
                }
              }}
            >
              <div className="owner-selected-parking-head owner-form-span">
                <div>
                  <span>Bãi đang cấu hình</span>
                  <strong>{selectedParking.parkingName || "Chưa có tên bãi"}</strong>
                </div>
                <span>{selectedParking.slotCapacity} chỗ</span>
              </div>
              <label className="owner-form-span">
                Địa chỉ
                <input className="owner-input" value={[selectedParking.address, selectedParking.district].filter(Boolean).join(" • ")} disabled />
              </label>
              <label>
                Số chỗ đỗ
                <input className="owner-input" value={selectedParking.slotCapacity} disabled />
              </label>
              <label>
                Giá theo giờ (VND)
                <input className="owner-input" inputMode="numeric" value={selectedParking.pricePerHour} onChange={(event) => handleParkingChange(selectedParking.id, "pricePerHour", event.target.value)} />
              </label>
              <label>
                Giá theo ngày (VND)
                <input className="owner-input" inputMode="numeric" value={selectedParking.pricePerDay} onChange={(event) => handleParkingChange(selectedParking.id, "pricePerDay", event.target.value)} />
              </label>
              <label>
                Giá theo tháng (VND)
                <input className="owner-input" inputMode="numeric" value={selectedParking.pricePerMonth} onChange={(event) => handleParkingChange(selectedParking.id, "pricePerMonth", event.target.value)} />
              </label>
              <div className="owner-settings-actions owner-form-span">
                {savedParkingId === selectedParking.id ? <p className="owner-save-note">Đã cập nhật cấu hình bãi.</p> : <span />}
                <button type="submit" className="btn-primary owner-btn">Lưu cấu hình bãi</button>
              </div>
            </form>
            ) : (
              <div className="owner-parking-config-empty">
                {parkingRows.length === 0 ? "Owner hiện chưa được gán bãi đỗ nào." : "Chọn một bãi đỗ để xem cấu hình."}
              </div>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
