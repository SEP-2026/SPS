import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Car } from "lucide-react";
import {
  SettingsField,
  SettingsFormGrid,
  SettingsPanel,
  SettingsSaveButton,
} from "../OwnerSettingsShared";
import { useOwnerContext } from "../../useOwnerContext";
import { formatCurrency, StatusBadge } from "../../OwnerUI";
import { formatNumber } from "../../ownerUtils";

export default function OwnerSettingsParkingTab({ parkingRows, onRefresh }) {
  const { actions } = useOwnerContext();
  const [searchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(parkingRows[0]?.id || null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const parkingId = searchParams.get("parkingId");
    if (parkingId) setSelectedId(Number(parkingId));
  }, [searchParams]);

  const selected = useMemo(
    () => parkingRows.find((row) => row.id === selectedId) || parkingRows[0] || null,
    [parkingRows, selectedId],
  );

  useEffect(() => {
    if (selected) {
      setForm({ ...selected });
      setSelectedId(selected.id);
    }
  }, [selected?.id]);

  const saveLot = async (event) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaved(false);
    const ok = await actions.updateParkingLotSettings(form.id, {
      parkingName: form.parkingName,
      pricePerHour: form.pricePerHour,
      pricePerDay: form.pricePerDay,
      pricePerMonth: form.pricePerMonth,
    });
    if (ok) {
      setSaved(true);
      await onRefresh();
    }
    setSaving(false);
  };

  if (!parkingRows.length) {
    return (
      <SettingsPanel title="Cấu hình bãi đỗ & giá">
        <p className="owner-empty">Owner chưa được gán bãi đỗ nào.</p>
      </SettingsPanel>
    );
  }

  return (
    <div className="owner-settings-parking-merged">
      <SettingsPanel
        title="Cấu hình bãi đỗ & giá (Ô tô)"
        subtitle="Thông tin bãi và bảng giá lưu trên CSDL — mỗi bãi một bộ giá."
        actions={form ? <SettingsSaveButton saving={saving} saved={saved} onClick={saveLot} type="button" /> : null}
      >
        <div className="owner-settings-lot-picker">
          <SettingsField label="Chọn bãi đỗ">
            <select
              className="owner-input owner-select"
              value={selectedId || ""}
              onChange={(event) => {
                setSaved(false);
                setSelectedId(Number(event.target.value));
              }}
            >
              {parkingRows.map((row) => (
                <option key={row.id} value={row.id}>{row.parkingName || `Bãi #${row.id}`}</option>
              ))}
            </select>
          </SettingsField>
        </div>

        {form ? (
          <form onSubmit={saveLot}>
            <h4 className="owner-settings-section-label">Thông tin bãi</h4>
            <SettingsFormGrid>
              <SettingsField label="Tên bãi đỗ" span>
                <input
                  className="owner-input"
                  value={form.parkingName}
                  onChange={(e) => {
                    setSaved(false);
                    setForm((p) => ({ ...p, parkingName: e.target.value }));
                  }}
                />
              </SettingsField>
              <SettingsField label="Loại xe">
                <input className="owner-input" value="Ô tô" disabled />
              </SettingsField>
              <SettingsField label="Địa chỉ" span>
                <input className="owner-input" value={[form.address, form.district].filter(Boolean).join(" • ")} disabled />
              </SettingsField>
              <SettingsField label="Số chỗ đỗ">
                <input className="owner-input" value={form.slotCapacity} disabled />
              </SettingsField>
              <SettingsField label="Trạng thái">
                <StatusBadge status={form.status === "active" ? "active" : "locked"} />
              </SettingsField>
            </SettingsFormGrid>

            <h4 className="owner-settings-section-label">Giá dịch vụ</h4>
            <div className="owner-settings-pricing-grid">
              <article className="owner-settings-pricing-card">
                <h4>Giá theo giờ</h4>
                <SettingsField label="VND / giờ">
                  <input className="owner-input" inputMode="numeric" value={form.pricePerHour} onChange={(e) => {
                    setSaved(false);
                    setForm((p) => ({ ...p, pricePerHour: e.target.value }));
                  }} />
                </SettingsField>
                <div className="owner-settings-info-box owner-settings-info-box--green">
                  Ví dụ 2 giờ ≈ {formatCurrency(Number(form.pricePerHour || 0) * 2)}
                </div>
              </article>
              <article className="owner-settings-pricing-card">
                <h4>Giá theo ngày</h4>
                <SettingsField label="VND / ngày (24h)">
                  <input className="owner-input" inputMode="numeric" value={form.pricePerDay} onChange={(e) => {
                    setSaved(false);
                    setForm((p) => ({ ...p, pricePerDay: e.target.value }));
                  }} />
                </SettingsField>
              </article>
              <article className="owner-settings-pricing-card">
                <h4>Giá theo tháng</h4>
                <SettingsField label="VND / tháng">
                  <input className="owner-input" inputMode="numeric" value={form.pricePerMonth} onChange={(e) => {
                    setSaved(false);
                    setForm((p) => ({ ...p, pricePerMonth: e.target.value }));
                  }} />
                </SettingsField>
              </article>
            </div>
          </form>
        ) : null}

        <h4 className="owner-settings-table-title">Tổng hợp giá ô tô theo bãi</h4>
        <div className="owner-table-shell">
          <table className="owner-table owner-designed-table">
            <thead>
              <tr>
                <th>Bãi đỗ</th>
                <th>Theo giờ</th>
                <th>Theo ngày</th>
                <th>Theo tháng</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {parkingRows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className="owner-row-title" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Car size={16} />
                      <strong>{row.parkingName}</strong>
                    </span>
                  </td>
                  <td>{formatNumber(row.pricePerHour)}</td>
                  <td>{formatNumber(row.pricePerDay)}</td>
                  <td>{formatNumber(row.pricePerMonth)}</td>
                  <td><StatusBadge status="active" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsPanel>
    </div>
  );
}
