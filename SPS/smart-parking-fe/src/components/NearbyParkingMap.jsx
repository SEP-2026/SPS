import { memo, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./NearbyParkingMap.css";
import buildGoogleMapsLinks from "../utils/maps";
import { isValidCoordinate, normalizeParkingSearchLot } from "../services/parkingSearch";

function getAvailabilityTone(percent) {
  if (percent <= 20) {
    return "danger";
  }
  if (percent <= 50) {
    return "warning";
  }
  return "success";
}

function createBadgeIcon(percent, selected = false) {
  const tone = getAvailabilityTone(percent);

  return L.divIcon({
    className: `parking-map-marker parking-map-marker--${tone}${selected ? " parking-map-marker--selected" : ""}`,
    html: `<div class="parking-map-marker-badge parking-map-marker-badge--${tone}${selected ? " parking-map-marker-badge--selected" : ""}">${percent}%</div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
  });
}

const BADGE_ICON_CACHE = new Map();

function getBadgeIcon(percent, selected = false) {
  const tone = getAvailabilityTone(percent);
  const cacheKey = `${percent}:${tone}:${selected ? "selected" : "default"}`;

  if (!BADGE_ICON_CACHE.has(cacheKey)) {
    BADGE_ICON_CACHE.set(cacheKey, createBadgeIcon(percent, selected));
  }

  return BADGE_ICON_CACHE.get(cacheKey);
}

const MAP_PANE_Z_INDEX = {
  tiles: 200,
  marker: 420,
  search: 500,
  popup: 620,
};

function MapPaneManager() {
  const map = useMap();

  useEffect(() => {
    Object.entries(MAP_PANE_Z_INDEX).forEach(([name, zIndex]) => {
      const paneName = `parking-${name}`;
      let pane = map.getPane(paneName);

      if (!pane) {
        pane = map.createPane(paneName);
      }

      pane.style.zIndex = String(zIndex);
    });
  }, [map]);

  return null;
}

function FitBoundsController({ center, lots, selectedLot }) {
  const map = useMap();

  useEffect(() => {
    if (!center) {
      return;
    }

    const bounds = L.latLngBounds([center.lat, center.lng], [center.lat, center.lng]);
    lots.forEach((lot) => {
      bounds.extend([lot.latitude, lot.longitude]);
    });

    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }, [map, center, lots]);

  useEffect(() => {
    if (!selectedLot) {
      return;
    }

    map.flyTo([selectedLot.latitude, selectedLot.longitude], Math.max(map.getZoom(), 15), {
      duration: 0.6,
    });
  }, [map, selectedLot]);

  return null;
}

function NearbyParkingMap({ searchMeta, nearbyLots, onSelectLot, selectedLotId }) {
  const [mapLoading, setMapLoading] = useState(true);

  const center = useMemo(() => {
    if (!searchMeta) {
      return null;
    }

    if (!isValidCoordinate(searchMeta.lat, searchMeta.lng)) {
      return null;
    }

    return {
      lat: Number(searchMeta.lat),
      lng: Number(searchMeta.lng),
    };
  }, [searchMeta]);

  const validLots = useMemo(
    () =>
      (nearbyLots || [])
        .map((lot) => normalizeParkingSearchLot(lot))
        .filter((lot) => isValidCoordinate(lot.latitude, lot.longitude)),
    [nearbyLots],
  );

  const selectedLot = useMemo(
    () => validLots.find((lot) => Number(lot.id) === Number(selectedLotId)) || validLots[0] || null,
    [selectedLotId, validLots],
  );

  if (!searchMeta || !nearbyLots || nearbyLots.length === 0) {
    return null;
  }

  if (!center) {
    return <p className="booking-error">Không có tọa độ hợp lệ để hiển thị bản đồ.</p>;
  }

  return (
    <div className="nearby-map" role="region" aria-label="Bản đồ bãi xe gần bạn">
      {mapLoading && <div className="nearby-map-overlay">Đang tải bản đồ...</div>}
      <MapContainer
        className="nearby-map-canvas"
        center={[center.lat, center.lng]}
        zoom={14}
        scrollWheelZoom
        whenReady={() => setMapLoading(false)}
      >
        <MapPaneManager />
        <TileLayer
          pane="parking-tiles"
          attribution="&copy; OpenStreetMap &copy; CARTO"
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />

        <CircleMarker pane="parking-search" center={[center.lat, center.lng]} radius={9} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#1976d2", fillOpacity: 1 }}>
          <Popup>Vị trí tìm kiếm hiện tại</Popup>
        </CircleMarker>

        {validLots.map((lot) => {
          const availablePercent = Math.max(
            0,
            Math.round((Number(lot.available_slots || 0) / Math.max(1, Number(lot.total_slots || 1))) * 100),
          );

          const { directionsUrl } = buildGoogleMapsLinks(lot);

          return (
            <Marker
              key={lot.id}
              pane="parking-marker"
              position={[lot.latitude, lot.longitude]}
              icon={getBadgeIcon(availablePercent, Number(selectedLotId) === Number(lot.id))}
              zIndexOffset={Number(selectedLotId) === Number(lot.id) ? 1000 : 0}
              eventHandlers={{
                click: () => onSelectLot?.(lot),
              }}
            >
              <Popup pane="parking-popup">
                <div className="nearby-map-popup">
                  <strong>{lot.name}</strong>
                  <p>{lot.address}</p>
                  <p>Khoảng cách: {lot.distance} km</p>
                  <p>Giá: {Number(lot.price_per_hour).toLocaleString("vi-VN")}đ/giờ</p>
                  <div className="nearby-map-popup-actions">
                    <button
                      type="button"
                      className="btn-primary nearby-map-popup-btn"
                      onClick={() => onSelectLot?.(lot)}
                    >
                      Chọn bãi này
                    </button>
                    <a
                      className="nearby-map-popup-directions"
                      href={directionsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Chỉ đường
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        <FitBoundsController center={center} lots={validLots} selectedLot={selectedLot} />
      </MapContainer>
    </div>
  );
}

export default memo(NearbyParkingMap);
