import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CircleParking, Map, Settings, WalletCards } from "lucide-react";
import { formatCurrency, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { formatTimeVN } from "../../utils/dateTime";
import buildGoogleMapsLinks from "../../utils/maps";

function buildSummary(slots) {
  const total = slots.length;
  const occupied = slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length;
  const available = slots.filter((slot) => slot.status === "available").length;
  const maintenance = slots.filter((slot) => slot.status === "maintenance").length;
  return {
    total,
    occupied,
    available,
    maintenance,
    occupancy: Math.round((occupied / Math.max(total, 1)) * 100),
  };
}

function ParkingDetailStat({ icon: Icon, title, value, note, tone }) {
  return (
    <article className={`owner-management-stat owner-management-stat--${tone}`}>
      <span><Icon size={22} /></span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  );
}

export default function OwnerParkingDetail() {
  const { parkingId } = useParams();
  const navigate = useNavigate();
  const { ownerData, isSyncing } = useOwnerContext();

  const lot = useMemo(() => (
    ownerData.parkingLots.find((item) => String(item.id) === String(parkingId)) || null
  ), [ownerData.parkingLots, parkingId]);

  const slots = useMemo(() => (
    ownerData.slots.filter((slot) => String(slot.parkingLotId) === String(parkingId))
  ), [ownerData.slots, parkingId]);

  const summary = useMemo(() => buildSummary(slots), [slots]);

  const revenue = useMemo(() => (
    ownerData.transactions
      .filter((item) => item.status === "paid" && item.parkingLotName === lot?.name)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0)
  ), [lot?.name, ownerData.transactions]);

  if (isSyncing) {
    return <p className="owner-empty">Đang tải chi tiết bãi đỗ...</p>;
  }

  if (!lot) {
    return (
      <div className="owner-management-page owner-parking-detail-page">
        <section className="owner-management-panel owner-parking-detail-empty">
          <h2>Không tìm thấy bãi đỗ</h2>
          <p>Bãi này không thuộc danh sách owner đang quản lý hoặc đã bị khóa.</p>
          <button type="button" className="owner-management-primary" onClick={() => navigate("/owner/parking")}>
            Quay lại danh sách
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="owner-management-page owner-parking-detail-page">
      <div className="owner-parking-detail-toolbar">
        <button type="button" className="owner-management-secondary" onClick={() => navigate("/owner/parking")}>
          <ArrowLeft size={17} />
          Danh sách bãi
        </button>
        <div>
          <button type="button" className="owner-management-secondary" onClick={() => navigate(`/owner/parking-map?parkingId=${lot.id}`)}>
            <Map size={17} />
            Sơ đồ
          </button>
          <button type="button" className="owner-management-primary" onClick={() => navigate(`/owner/settings?tab=parking&parkingId=${lot.id}`)}>
            <Settings size={17} />
            Cài đặt
          </button>
        </div>
      </div>

      <section className="owner-management-panel owner-parking-detail-hero">
        <div>
          <span>Bãi đỗ #{lot.id}</span>
          <h2>{lot.name}</h2>
          <p>{[lot.address, lot.district].filter(Boolean).join(" • ") || "Chưa có địa chỉ"}</p>
          {(() => {
            const { directionsUrl } = buildGoogleMapsLinks(lot);
            if (!directionsUrl) return null;
            return (
              <a
                className="owner-parking-directions"
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Chỉ đường
              </a>
            );
          })()}
        </div>
        <strong>{summary.occupancy}% lấp đầy</strong>
      </section>

      <div className="owner-management-stats owner-parking-detail-stats">
        <ParkingDetailStat icon={CircleParking} title="Tổng chỗ" value={summary.total} note="Số slot trong bãi" tone="blue" />
        <ParkingDetailStat icon={CircleParking} title="Còn trống" value={summary.available} note="Có thể sử dụng" tone="green" />
        <ParkingDetailStat icon={CircleParking} title="Đang giữ/đỗ" value={summary.occupied} note={`${summary.occupancy}% công suất`} tone="sky" />
        <ParkingDetailStat icon={CircleParking} title="Bảo trì" value={summary.maintenance} note="Slot tạm ngưng" tone="orange" />
        <ParkingDetailStat icon={WalletCards} title="Doanh thu nhanh" value={formatCurrency(revenue)} note="Giao dịch đã thanh toán" tone="pink" />
      </div>

      <section className="owner-management-panel owner-parking-detail-grid">
        <div className="owner-management-panel-head">
          <div>
            <h2>Slot trong bãi</h2>
            <p>Trạng thái hiện tại theo dữ liệu đồng bộ từ CSDL.</p>
          </div>
        </div>
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Mã chỗ</th>
                <th>Khu vực</th>
                <th>Tầng</th>
                <th>Trạng thái</th>
                <th>Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((slot) => (
                <tr key={slot.id}>
                  <td>{slot.code}</td>
                  <td>{slot.zone}</td>
                  <td>{slot.level}</td>
                  <td><StatusBadge status={slot.status} /></td>
                  <td>{formatTimeVN(slot.updatedAt)}</td>
                </tr>
              ))}
              {slots.length === 0 ? (
                <tr>
                  <td colSpan={5} className="owner-empty-cell">Bãi này chưa có slot.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
