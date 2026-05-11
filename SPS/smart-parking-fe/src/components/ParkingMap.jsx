import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API from "../services/api";
import "./ParkingMap.css";

export default function ParkingMap({ lotId, lotName, onSelectSlot }) {
  const navigate = useNavigate();
  const [slots, setSlots] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadSlots = async () => {
      if (!lotId) {
        setSlots([]);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const res = await API.get("/slots", {
          params: { parking_id: lotId },
        });
        setSlots(res.data || []);
      } catch (err) {
        setError("Không tải được sơ đồ bãi xe");
        setSlots([]);
      } finally {
        setLoading(false);
      }
    };

    loadSlots();
  }, [lotId]);

  const handleSlotClick = (slot) => {
    if (slot.status !== "available") {
      return;
    }
    setSelectedSlot(slot);
    if (onSelectSlot) {
      onSelectSlot(slot);
    }
  };

  const handleBookNow = () => {
    if (!selectedSlot) {
      return;
    }
    // Navigate to booking page with pre-filled slot information
    navigate(`/booking?lotId=${lotId}&slotId=${selectedSlot.id}&slotName=${selectedSlot.code || selectedSlot.slot_number}`);
  };

  const getSlotStatusClass = (slot) => {
    if (selectedSlot && selectedSlot.id === slot.id) {
      return "slot-selected";
    }
    if (slot.status === "available") {
      return "slot-available";
    }
    if (slot.status === "occupied" || slot.status === "in_use") {
      return "slot-occupied";
    }
    if (slot.status === "maintenance") {
      return "slot-maintenance";
    }
    return "slot-occupied";
  };

  if (loading) {
    return <div className="parking-map-loading">Đang tải sơ đồ bãi xe...</div>;
  }

  if (error) {
    return <div className="parking-map-error">{error}</div>;
  }

  if (slots.length === 0) {
    return <div className="parking-map-empty">Chưa có thông tin slot cho bãi xe này</div>;
  }

  return (
    <div className="parking-map-container">
      <div className="parking-map-header">
        <h3>Sơ đồ bãi xe - {lotName}</h3>
      </div>
      
      <div className="parking-map-legend">
        <div className="legend-item">
          <div className="legend-color slot-available"></div>
          <span>Trống</span>
        </div>
        <div className="legend-item">
          <div className="legend-color slot-occupied"></div>
          <span>Đã đặt</span>
        </div>
        <div className="legend-item">
          <div className="legend-color slot-selected"></div>
          <span>Đang chọn</span>
        </div>
        <div className="legend-item">
          <div className="legend-color slot-maintenance"></div>
          <span>Bảo trì</span>
        </div>
      </div>

      <div className="parking-map-grid">
        {slots.map((slot) => (
          <div
            key={slot.id}
            className={`parking-slot ${getSlotStatusClass(slot)}`}
            onClick={() => handleSlotClick(slot)}
            title={`Slot: ${slot.code || slot.slot_number} - Trạng thái: ${slot.status}`}
          >
            <div className="slot-code">{slot.code || slot.slot_number}</div>
            {slot.zone && <div className="slot-zone">{slot.zone}</div>}
          </div>
        ))}
      </div>

      {selectedSlot && (
        <div className="parking-map-actions">
          <div className="selected-slot-info">
            <strong>Vị trí đã chọn:</strong> {selectedSlot.code || selectedSlot.slot_number}
            {selectedSlot.zone && ` - Khu vực: ${selectedSlot.zone}`}
          </div>
          <div className="parking-map-action-buttons">
            <button
              type="button"
              className="btn-primary btn-primary-wide"
              onClick={handleBookNow}
            >
              Đặt chỗ ngay
            </button>

            <button
              type="button"
              className="svg-book-btn"
              onClick={handleBookNow}
              aria-label="Đặt chỗ bằng icon"
            >
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="slot-icon" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
