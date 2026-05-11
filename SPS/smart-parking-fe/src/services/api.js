import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8000",
});

const AUTH_KEY = "smart_parking_auth";

const AUTH_USER_FIELDS = [
  "id",
  "email",
  "username",
  "role",
  "owner_id",
  "parking_id",
  "status",
  "name",
  "full_name",
  "phone",
  "vehicle_plate",
  "vehicle_color",
  "managed_district_id",
  "managed_district",
];

const normalizeUser = (user) => {
  if (!user || typeof user !== "object") {
    return null;
  }

  return AUTH_USER_FIELDS.reduce((result, key) => {
    if (Object.prototype.hasOwnProperty.call(user, key)) {
      result[key] = user[key];
    }
    return result;
  }, {});
};

const normalizeAuthPayload = (payload) => {
  if (!payload || typeof payload !== "object" || !payload.token) {
    return null;
  }

  return {
    token: String(payload.token),
    token_type: payload.token_type || "bearer",
    expires_in: payload.expires_in,
    user: normalizeUser(payload.user),
  };
};

export const saveAuth = (payload) => {
  const normalized = normalizeAuthPayload(payload);
  if (!normalized) {
    clearAuth();
    return null;
  }

  localStorage.setItem(AUTH_KEY, JSON.stringify(normalized));
  return normalized;
};

export const clearAuth = () => {
  localStorage.removeItem(AUTH_KEY);
};

export const getAuth = () => {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) {
    return null;
  }

  try {
    const normalized = normalizeAuthPayload(JSON.parse(raw));
    if (!normalized) {
      clearAuth();
      return null;
    }

    const normalizedRaw = JSON.stringify(normalized);
    if (normalizedRaw !== raw) {
      localStorage.setItem(AUTH_KEY, normalizedRaw);
    }
    return normalized;
  } catch {
    clearAuth();
    return null;
  }
};

API.interceptors.request.use((config) => {
  const auth = getAuth();
  if (auth?.token) {
    config.headers.Authorization = `Bearer ${auth.token}`;
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearAuth();
      if (typeof window !== "undefined") {
        const onDefaultLogin = window.location.pathname.startsWith("/login");
        if (!onDefaultLogin) {
          window.location.href = "/login?sessionExpired=1";
        }
      }
    }
    return Promise.reject(error);
  },
);

export default API;
