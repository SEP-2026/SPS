import API from "./api";
import { BOOKING_LIFECYCLE_DEFAULTS } from "../owner/settings/bookingLifecycleDefaults";

export async function fetchOwnerBookingConfig() {
  const res = await API.get("/owner/booking-config");
  return {
    ...(BOOKING_LIFECYCLE_DEFAULTS || {}),
    ...(res.data?.config || {}),
    templates: {
      ...BOOKING_LIFECYCLE_DEFAULTS.templates,
      ...(res.data?.config?.templates || {}),
    },
  };
}

export async function saveOwnerBookingConfig(config) {
  const res = await API.patch("/owner/booking-config", { config });
  return res.data?.config || config;
}
