import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Bell,
  CalendarClock,
  Car,
  Settings,
  User,
  Users,
} from "lucide-react";
import "./ownerSettings.css";
import { DEFAULT_TAB, OWNER_SETTINGS_TABS, resolveSettingsTab } from "./ownerSettingsConstants";
import { useOwnerSettingsData } from "./useOwnerSettingsData";
import { useOwnerContext } from "../useOwnerContext";
import OwnerSettingsAccountTab from "./tabs/OwnerSettingsAccountTab";
import OwnerSettingsParkingTab from "./tabs/OwnerSettingsParkingTab";
import OwnerSettingsBookingLifecycleTab from "./tabs/OwnerSettingsBookingLifecycleTab";
import OwnerSettingsParkingAccountsTab from "./tabs/OwnerSettingsParkingAccountsTab";
import OwnerSettingsNotificationsTab from "./tabs/OwnerSettingsNotificationsTab";

const TAB_ICONS = {
  account: User,
  parking: Car,
  booking: CalendarClock,
  employees: Users,
  notifications: Bell,
};

export default function OwnerSettingsPage() {
  const { ownerData } = useOwnerContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveSettingsTab(searchParams.get("tab") || DEFAULT_TAB);
  const { settingsData, parkingRows, refresh, loading } = useOwnerSettingsData(ownerData.settings);

  useEffect(() => {
    if (!searchParams.get("tab")) {
      const next = new URLSearchParams(searchParams);
      next.set("tab", DEFAULT_TAB);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const setTab = (tabId) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tabId);
    if (tabId !== "parking") {
      next.delete("parkingId");
    }
    setSearchParams(next);
  };

  const tabContent = useMemo(() => {
    if (loading && !settingsData.contactName && activeTab !== "booking-lifecycle") {
      return <p className="owner-empty">Đang tải cấu hình...</p>;
    }
    switch (activeTab) {
      case "account":
        return <OwnerSettingsAccountTab settingsData={settingsData} onRefresh={refresh} />;
      case "parking":
        return <OwnerSettingsParkingTab parkingRows={parkingRows} onRefresh={refresh} />;
      case "booking-lifecycle":
        return <OwnerSettingsBookingLifecycleTab />;
      case "parking-accounts":
        return <OwnerSettingsParkingAccountsTab />;
      case "notifications":
        return <OwnerSettingsNotificationsTab />;
      default:
        return <OwnerSettingsAccountTab settingsData={settingsData} onRefresh={refresh} />;
    }
  }, [activeTab, loading, parkingRows, refresh, settingsData]);

  return (
    <div className="owner-settings-page">
      <nav className="owner-settings-tabs" aria-label="Cài đặt">
        {OWNER_SETTINGS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab.icon] || Settings;
          return (
            <button
              key={tab.id}
              type="button"
              className={`owner-settings-tab${activeTab === tab.id ? " is-active" : ""}`}
              onClick={() => setTab(tab.id)}
            >
              <Icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div className="owner-settings-body">{tabContent}</div>
    </div>
  );
}
