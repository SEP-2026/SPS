import { useCallback, useEffect, useState } from "react";
import API from "../../services/api";

export function buildParkingSettingsRows(settings) {
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
      status: lot.status || "active",
    }))
    : [];
}

export function useOwnerSettingsData(initialSettings) {
  const [settingsData, setSettingsData] = useState(initialSettings);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await API.get("/owner/settings");
      const nextSettings = res.data?.settings || initialSettings;
      setSettingsData(nextSettings);
      return nextSettings;
    } catch {
      setSettingsData(initialSettings);
      return initialSettings;
    } finally {
      setLoading(false);
    }
  }, [initialSettings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    settingsData,
    setSettingsData,
    parkingRows: buildParkingSettingsRows(settingsData),
    loading,
    refresh,
  };
}
