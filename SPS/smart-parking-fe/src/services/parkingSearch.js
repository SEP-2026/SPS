import API from "./api";

export function isValidCoordinate(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);

  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return false;
  }

  return Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180;
}

export function normalizeParkingSearchLot(lot = {}) {
  const latitude = Number(lot.latitude ?? lot.lat ?? 0);
  const longitude = Number(lot.longitude ?? lot.lng ?? 0);
  const id = Number(lot.id ?? lot.parking_id ?? 0);

  return {
    ...lot,
    id,
    parking_id: Number.isFinite(Number(lot.parking_id)) ? Number(lot.parking_id) : id,
    name: lot.name || lot.parking_name || "",
    parking_name: lot.parking_name || lot.name || "",
    address: lot.address || lot.parking_address || "",
    parking_address: lot.parking_address || lot.address || "",
    latitude,
    longitude,
    has_roof: Boolean(lot.has_roof),
    price_per_hour: Number(lot.price_per_hour || 0),
    price_per_day: Number(lot.price_per_day || 0),
    price_per_month: Number(lot.price_per_month || 0),
    distance: lot.distance === null || lot.distance === undefined ? "" : Number(lot.distance),
  };
}

export function normalizeParkingSearchPayload(payload = {}) {
  const center = payload.center && isValidCoordinate(payload.center.lat, payload.center.lng)
    ? {
        lat: Number(payload.center.lat),
        lng: Number(payload.center.lng),
      }
    : null;

  const nearby = Array.isArray(payload.nearest)
    ? payload.nearest
        .map((lot) => normalizeParkingSearchLot(lot))
        .filter((lot) => isValidCoordinate(lot.latitude, lot.longitude))
    : [];

  return {
    query: payload.query || "",
    center,
    nearby,
  };
}

export function mergeParkingSearchWithOverview(nearbyLots = [], overviewLots = []) {
  const overviewById = new Map(
    overviewLots
      .filter((lot) => Number.isFinite(Number(lot.parking_id ?? lot.id)))
      .map((lot) => [Number(lot.parking_id ?? lot.id), lot]),
  );

  return nearbyLots.map((lot) => {
    const overview = overviewById.get(Number(lot.id)) || {};
    const availableSlots = Number(overview.available_slots ?? lot.available_slots ?? 0);
    const totalSlots = Math.max(Number(overview.total_slots ?? lot.total_slots ?? 0), availableSlots, 1);

    return {
      ...overview,
      ...lot,
      id: Number(lot.id),
      parking_id: Number(overview.parking_id ?? lot.parking_id ?? lot.id),
      parking_name: overview.parking_name || lot.parking_name || lot.name || "",
      parking_address: overview.parking_address || lot.parking_address || lot.address || "",
      available_slots: availableSlots,
      total_slots: totalSlots,
      cover_image: overview.cover_image || lot.cover_image || "",
      district: overview.district || lot.district || "",
    };
  });
}

export async function searchParkingByAddress({
  address,
  limit = 5,
  sortBy = "nearest",
  coveredOnly = false,
} = {}) {
  const response = await API.get("/search-parking", {
    params: {
      address,
      limit,
      sort_by: sortBy,
      covered_only: coveredOnly,
    },
  });

  return normalizeParkingSearchPayload(response.data);
}

export async function searchParkingByCoords({
  lat,
  lng,
  limit = 5,
  sortBy = "nearest",
  coveredOnly = false,
} = {}) {
  const response = await API.get("/search-parking-by-coords", {
    params: {
      lat,
      lng,
      limit,
      sort_by: sortBy,
      covered_only: coveredOnly,
    },
  });

  return normalizeParkingSearchPayload(response.data);
}

export function searchNearbyByCurrentLocation(options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Trình duyệt không hỗ trợ định vị"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const payload = await searchParkingByCoords({
            ...options,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
          resolve(payload);
        } catch (error) {
          reject(error);
        }
      },
      (error) => {
        if (error?.code === 1) {
          reject(new Error("Bạn chưa cho phép truy cập vị trí hiện tại"));
          return;
        }

        reject(new Error("Không thể lấy vị trí hiện tại"));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  });
}