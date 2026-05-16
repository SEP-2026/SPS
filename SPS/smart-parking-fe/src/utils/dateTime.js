const VN_TIMEZONE = "Asia/Ho_Chi_Minh";

export function parseVietnamDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const normalized =
      !/[zZ]|[+-]\d{2}:\d{2}$/.test(value) && value.includes("T")
        ? `${value}+07:00`
        : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateTimeVN(value, fallback = "Chưa có") {
  const date = parseVietnamDate(value);
  if (!date) {
    return fallback;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatTimeVN(value, fallback = "--") {
  const date = parseVietnamDate(value);
  if (!date) {
    return fallback;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateOnlyVN(value, fallback = "") {
  const date = parseVietnamDate(value);
  if (!date) {
    return fallback;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: VN_TIMEZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function toDatetimeLocalValue(value) {
  const date = parseVietnamDate(value);
  if (!date) {
    return "";
  }
  const vnDate = new Date(date.toLocaleString("en-US", { timeZone: VN_TIMEZONE }));
  const year = vnDate.getFullYear();
  const month = String(vnDate.getMonth() + 1).padStart(2, "0");
  const day = String(vnDate.getDate()).padStart(2, "0");
  const hour = String(vnDate.getHours()).padStart(2, "0");
  const minute = String(vnDate.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function toDateInputValue(value) {
  const date = parseVietnamDate(value);
  if (!date) {
    return "";
  }
  const vnDate = new Date(date.toLocaleString("en-US", { timeZone: VN_TIMEZONE }));
  const year = vnDate.getFullYear();
  const month = String(vnDate.getMonth() + 1).padStart(2, "0");
  const day = String(vnDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toVietnamIsoString(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return `${value}:00`;
  }
  const localValue = toDatetimeLocalValue(value);
  return localValue ? `${localValue}:00` : null;
}
