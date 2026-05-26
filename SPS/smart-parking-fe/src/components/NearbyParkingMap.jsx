import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";

const parkingMarkerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const isValidCoordinate = (lat, lng) => {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return false;
  }
  return Math.abs(parsedLat) <= 90 && Math.abs(parsedLng) <= 180;
};

function FitBoundsController({ center, lots }) {
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

  return null;
}

export default function NearbyParkingMap({ searchMeta, nearbyLots, onSelectLot }) {
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
        .filter((lot) => isValidCoordinate(lot.latitude, lot.longitude))
        .map((lot) => ({
          ...lot,
          latitude: Number(lot.latitude),
          longitude: Number(lot.longitude),
        })),
    [nearbyLots],
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <CircleMarker center={[center.lat, center.lng]} radius={9} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#1976d2", fillOpacity: 1 }}>
          <Popup>Vị trí tìm kiếm hiện tại</Popup>
        </CircleMarker>

        {validLots.map((lot) => (
          <Marker
            key={lot.id}
            position={[lot.latitude, lot.longitude]}
            icon={parkingMarkerIcon}
          >
            <Popup>
              <div className="nearby-map-popup">
                <strong>{lot.name}</strong>
                <p>{lot.address}</p>
                <p>Khoảng cách: {lot.distance} km</p>
                <p>Giá: {Number(lot.price_per_hour).toLocaleString("vi-VN")}đ/giờ</p>
                <button
                  type="button"
                  className="btn-primary nearby-map-popup-btn"
                  onClick={() => onSelectLot?.(lot)}
                >
                  Chọn bãi này
                </button>
              </div>
            </Popup>
          </Marker>
        ))}

        <FitBoundsController center={center} lots={validLots} />
      </MapContainer>
    </div>
  );
}
