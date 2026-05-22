import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { EmptyState } from "../../owner/OwnerDashboardComponents";
import { SectionCard, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";

const STATUS_OPTIONS = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "available", label: "Trống" },
  { value: "reserved", label: "Đã đặt" },
  { value: "in_use", label: "Đang đỗ" },
  { value: "maintenance", label: "Bảo trì" },
];

function groupSlotsByParking(slots, parkingLots) {
  const lotMap = new Map();
  parkingLots.forEach((lot) => {
    lotMap.set(lot.id, {
      id: lot.id,
      name: lot.name,
      address: lot.address,
      district: lot.district,
      slots: [],
    });
  });

  slots.forEach((slot) => {
    const key = slot.parkingLotId || `unknown-${slot.parkingLotName}`;
    if (!lotMap.has(key)) {
      lotMap.set(key, {
        id: key,
        name: slot.parkingLotName || "Chưa có bãi",
        address: "",
        district: "",
        slots: [],
      });
    }
    lotMap.get(key).slots.push(slot);
  });

  return Array.from(lotMap.values()).filter((lot) => lot.slots.length > 0);
}

export default function OwnerParkingMap() {
  const { ownerData, isSyncing } = useOwnerContext();
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("all");
  const selectedParkingLotId = searchParams.get("parkingId") || searchParams.get("parkingLotId");

  const lots = useMemo(() => {
    const filteredSlots = (ownerData.slots || []).filter((slot) => (
      (statusFilter === "all" ? true : slot.status === statusFilter)
      && (selectedParkingLotId ? String(slot.parkingLotId) === String(selectedParkingLotId) : true)
    ));
    const parkingLots = selectedParkingLotId
      ? (ownerData.parkingLots || []).filter((lot) => String(lot.id) === String(selectedParkingLotId))
      : ownerData.parkingLots || [];
    return groupSlotsByParking(filteredSlots, parkingLots);
  }, [ownerData.parkingLots, ownerData.slots, selectedParkingLotId, statusFilter]);

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Sơ đồ bãi xe"
        subtitle="Hiển thị slot ô tô theo từng bãi bằng dữ liệu thật đang đồng bộ từ CSDL."
        actions={
          <select className="owner-input owner-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        }
      >
        {isSyncing ? <p className="owner-empty">Đang đồng bộ sơ đồ bãi xe...</p> : null}
        {!isSyncing && lots.length === 0 ? (
          <EmptyState title="Chưa có sơ đồ bãi xe" subtitle="Slot sẽ hiển thị khi owner được gán bãi hoặc khi bãi có chỗ đỗ." />
        ) : null}

        <div className="owner-parking-map-page">
          {lots.map((lot) => {
            const total = lot.slots.length;
            const occupied = lot.slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length;
            const occupancy = total ? Math.round((occupied / total) * 100) : 0;

            return (
              <article key={lot.id} className="owner-slot-map-card">
                <header>
                  <div>
                    <h3>{lot.name}</h3>
                    <p>{lot.address || lot.district || "Chưa có địa chỉ"}</p>
                  </div>
                  <strong>{occupancy}% lấp đầy</strong>
                </header>
                <div className="owner-slot-map-grid">
                  {lot.slots.map((slot) => (
                    <div key={slot.id} className={`owner-slot-tile owner-slot-tile--${slot.status}`}>
                      <strong>{slot.code}</strong>
                      <span>{slot.zone}</span>
                      <StatusBadge status={slot.status} />
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
