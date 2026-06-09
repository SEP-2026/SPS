import { useEffect, useMemo, useState } from "react";
import { ACCOUNT_SECTIONS } from "../ownerSettingsConstants";
import {
  SettingsField,
  SettingsFormGrid,
  SettingsMetaRow,
  SettingsPanel,
  SettingsSaveButton,
  SettingsSplitLayout,
  SettingsSubNav,
} from "../OwnerSettingsShared";
import { useOwnerContext } from "../../useOwnerContext";
import { isStrongPassword, PASSWORD_POLICY_TEXT } from "../../../services/passwordPolicy";
import { getInitials } from "../../ownerUtils";

export default function OwnerSettingsAccountTab({ settingsData, onRefresh }) {
  const { auth, actions } = useOwnerContext();
  const [section, setSection] = useState("profile");
  const [contactForm, setContactForm] = useState({
    contactPhone: settingsData.contactPhone || "",
    contactEmail: settingsData.contactEmail || "",
  });
  const [accountForm, setAccountForm] = useState({
    email: auth?.user?.email || "",
    password: "",
    confirmPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [savedProfile, setSavedProfile] = useState(false);
  const [savedPassword, setSavedPassword] = useState(false);

  useEffect(() => {
    setContactForm({
      contactPhone: settingsData.contactPhone || "",
      contactEmail: settingsData.contactEmail || "",
    });
  }, [settingsData.contactEmail, settingsData.contactPhone]);

  const metaItems = useMemo(() => ([
    { label: "Ngày tạo tài khoản", value: "Chưa ghi nhận trên API" },
    { label: "Đăng nhập cuối", value: "Chưa ghi nhận trên API" },
    { label: "IP đăng nhập cuối", value: "Chưa ghi nhận trên API" },
    { label: "Trình duyệt", value: typeof navigator !== "undefined" ? navigator.userAgent.split(" ").slice(0, 3).join(" ") : "--" },
  ]), []);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSavedProfile(false);
    const ok = await actions.updateSettings(contactForm);
    if (ok) {
      setSavedProfile(true);
      await onRefresh();
    }
    setSaving(false);
  };

  const savePassword = async (event) => {
    event.preventDefault();
    if (accountForm.password || accountForm.confirmPassword) {
      if (!isStrongPassword(accountForm.password)) {
        window.alert(PASSWORD_POLICY_TEXT);
        return;
      }
    }
    setSaving(true);
    setSavedPassword(false);
    const ok = await actions.updateAccount(accountForm);
    if (ok) {
      setSavedPassword(true);
      setAccountForm((prev) => ({ ...prev, password: "", confirmPassword: "" }));
    }
    setSaving(false);
  };

  const renderContent = () => {
    if (section === "password") {
      return (
        <SettingsPanel
          title="Đổi mật khẩu"
          subtitle="Cập nhật email đăng nhập và mật khẩu tài khoản Owner."
          actions={<SettingsSaveButton saving={saving} saved={savedPassword} onClick={savePassword} type="button" />}
        >
          <form className="owner-settings-form-grid" onSubmit={savePassword}>
            <SettingsField label="Email đăng nhập">
              <input className="owner-input" value={accountForm.email} onChange={(e) => {
                setSavedPassword(false);
                setAccountForm((p) => ({ ...p, email: e.target.value }));
              }} />
            </SettingsField>
            <SettingsField label="Mật khẩu mới">
              <input className="owner-input" type="password" value={accountForm.password} onChange={(e) => {
                setSavedPassword(false);
                setAccountForm((p) => ({ ...p, password: e.target.value }));
              }} />
            </SettingsField>
            <SettingsField label="Nhập lại mật khẩu">
              <input className="owner-input" type="password" value={accountForm.confirmPassword} onChange={(e) => {
                setSavedPassword(false);
                setAccountForm((p) => ({ ...p, confirmPassword: e.target.value }));
              }} />
            </SettingsField>
            <p className="owner-settings-field owner-settings-field--span" style={{ margin: 0 }}>
              <small>{PASSWORD_POLICY_TEXT}</small>
            </p>
          </form>
        </SettingsPanel>
      );
    }

    return (
      <SettingsPanel
        title="Thông tin tài khoản"
        subtitle="Thông tin owner và khu vực quản lý từ CSDL."
        actions={<SettingsSaveButton saving={saving} saved={savedProfile} onClick={saveProfile} type="button" />}
      >
        <form onSubmit={saveProfile}>
          <SettingsFormGrid>
            <SettingsField label="Họ và tên">
              <input className="owner-input" value={settingsData.contactName || ""} disabled />
            </SettingsField>
            <SettingsField label="Email">
              <input className="owner-input" value={contactForm.contactEmail} onChange={(e) => {
                setSavedProfile(false);
                setContactForm((p) => ({ ...p, contactEmail: e.target.value }));
              }} />
            </SettingsField>
            <SettingsField label="Số điện thoại">
              <input className="owner-input" value={contactForm.contactPhone} onChange={(e) => {
                setSavedProfile(false);
                setContactForm((p) => ({ ...p, contactPhone: e.target.value }));
              }} />
            </SettingsField>
            <SettingsField label="Vai trò">
              <input className="owner-input" value="Owner" disabled />
            </SettingsField>
            <SettingsField label="Khu vực quản lý">
              <input className="owner-input" value={settingsData.districtName || "Chưa gán"} disabled />
            </SettingsField>
            <div className="owner-settings-profile-side">
              <div className="owner-settings-avatar">{getInitials(settingsData.contactName)}</div>
            </div>
          </SettingsFormGrid>
          <SettingsMetaRow items={metaItems} />
        </form>
      </SettingsPanel>
    );
  };

  return (
    <SettingsSplitLayout
      subnav={<SettingsSubNav items={ACCOUNT_SECTIONS} activeId={section} onChange={setSection} />}
      children={renderContent()}
    />
  );
}
