import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SectionCard, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { formatTimeVN } from "../../utils/dateTime";

const EMPTY_FORM = { parkingId: null, code: "", zone: "", level: "", status: "available" };

function createSlotGroup(index = 0) {
  return {
    zone: `Khu ${String.fromCharCode(65 + Math.min(index, 25))}`,
    level: "Tầng 1",
    slotCount: "10",
  };
}

function createEmptyLotForm(overrides = {}) {
  return {
    name: "",
    address: "",
    phone: "",
    district: "",
    slotGroups: [createSlotGroup(0)],
    ...overrides,
  };
}

function normalizeUniqueText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildLotSummary(slots) {
  return {
    total: slots.length,
    available: slots.filter((slot) => slot.status === "available").length,
    occupied: slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length,
    maintenance: slots.filter((slot) => slot.status === "maintenance").length,
  };
}

export default function OwnerParking() {
  const { ownerData, actions, isSyncing } = useOwnerContext();
  const [zoneFilter, setZoneFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedLots, setExpandedLots] = useState({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [isLotModalOpen, setIsLotModalOpen] = useState(false);
  const [lotForm, setLotForm] = useState(() => createEmptyLotForm());
  const [isLotSubmitting, setIsLotSubmitting] = useState(false);

  const zones = useMemo(() => [...new Set(ownerData.slots.map((slot) => slot.zone))], [ownerData.slots]);
  const filteredSlots = useMemo(() => ownerData.slots.filter((slot) => {
    if (zoneFilter !== "all" && slot.zone !== zoneFilter) {
      return false;
    }
    if (statusFilter !== "all" && slot.status !== statusFilter) {
      return false;
    }
    return true;
  }), [ownerData.slots, statusFilter, zoneFilter]);

  const lots = useMemo(() => {
    const lotMap = new Map();

    ownerData.parkingLots?.forEach((lot) => {
      lotMap.set(lot.id, {
        id: lot.id,
        name: lot.name,
        address: lot.address,
        district: lot.district,
        slots: [],
      });
    });

    filteredSlots.forEach((slot) => {
      const key = slot.parkingLotId || `unknown-${slot.parkingLotName}`;
      if (!lotMap.has(key)) {
        lotMap.set(key, {
          id: slot.parkingLotId || null,
          name: slot.parkingLotName || "Chưa có bãi",
          address: "",
          district: "",
          slots: [],
        });
      }
      lotMap.get(key).slots.push(slot);
    });

    return Array.from(lotMap.values())
      .filter((lot) => lot.slots.length > 0 || !zoneFilter || statusFilter === "all")
      .sort((left, right) => left.name.localeCompare(right.name, "vi"));
  }, [filteredSlots, ownerData.parkingLots, statusFilter, zoneFilter]);

  const slotGroupTotal = useMemo(
    () => lotForm.slotGroups.reduce((sum, group) => sum + Math.max(0, Number(group.slotCount) || 0), 0),
    [lotForm.slotGroups],
  );

  const openCreate = (lot) => {
    setEditingSlot(null);
    setForm({
      parkingId: lot.id,
      code: "",
      zone: "",
      level: "",
      status: "available",
    });
    setIsModalOpen(true);
  };

  const openEdit = (slot) => {
    setEditingSlot(slot);
    setForm({
      parkingId: slot.parkingLotId || null,
      code: slot.code,
      zone: slot.zone || "",
      level: slot.level || "",
      status: slot.status,
    });
    setIsModalOpen(true);
  };

  const openCreateLot = () => {
    setLotForm(createEmptyLotForm({
      district: ownerData.settings?.districtName || "",
      phone: ownerData.settings?.contactPhone || "",
    }));
    setIsLotModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingSlot(null);
    setForm(EMPTY_FORM);
  };

  const closeLotModal = () => {
    if (isLotSubmitting) {
      return;
    }
    setIsLotModalOpen(false);
    setLotForm(createEmptyLotForm());
  };

  const updateSlotGroup = (index, key, value) => {
    setLotForm((prev) => ({
      ...prev,
      slotGroups: prev.slotGroups.map((group, groupIndex) => (
        groupIndex === index ? { ...group, [key]: value } : group
      )),
    }));
  };

  const addSlotGroup = () => {
    setLotForm((prev) => ({
      ...prev,
      slotGroups: [...prev.slotGroups, createSlotGroup(prev.slotGroups.length)],
    }));
  };

  const removeSlotGroup = (index) => {
    setLotForm((prev) => {
      if (prev.slotGroups.length <= 1) {
        return prev;
      }
      return {
        ...prev,
        slotGroups: prev.slotGroups.filter((_, groupIndex) => groupIndex !== index),
      };
    });
  };

  const toggleLot = (lotId) => {
    setExpandedLots((prev) => ({
      ...prev,
      [lotId]: !prev[lotId],
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.code.trim() || !form.zone.trim() || !form.level.trim()) {
      return;
    }
    if (editingSlot) {
      actions.updateSlot(editingSlot.id, {
        code: form.code.trim(),
        zone: form.zone.trim(),
        level: form.level.trim(),
        status: form.status,
      });
    } else if (form.parkingId) {
      actions.addSlot({
        parkingId: form.parkingId,
        code: form.code.trim(),
        zone: form.zone.trim(),
        level: form.level.trim(),
        status: form.status,
      });
    }
    closeModal();
  };

  const handleCreateLotSubmit = async (event) => {
    event.preventDefault();
    if (!lotForm.name.trim() || !lotForm.address.trim() || isLotSubmitting) {
      return;
    }
    const requestedNameKey = normalizeUniqueText(lotForm.name);
    const duplicateLot = ownerData.parkingLots?.some((lot) => normalizeUniqueText(lot.name) === requestedNameKey);
    if (duplicateLot) {
      window.alert("Tên bãi đỗ đã tồn tại trong danh sách owner đang quản lý. Vui lòng chọn tên khác.");
      return;
    }

    const slotGroups = lotForm.slotGroups.map((group) => ({
      zone: group.zone.trim(),
      level: group.level.trim(),
      slotCount: Math.max(0, Number(group.slotCount) || 0),
    }));
    const invalidGroup = slotGroups.some((group) => group.slotCount > 0 && (!group.zone || !group.level));
    if (invalidGroup) {
      window.alert("Vui lòng nhập đầy đủ khu vực và tầng cho các nhóm có số chỗ lớn hơn 0.");
      return;
    }
    const activeSlotGroups = slotGroups.filter((group) => group.slotCount > 0);

    setIsLotSubmitting(true);
    const success = await actions.createParkingLot({
      name: lotForm.name.trim(),
      address: lotForm.address.trim(),
      phone: lotForm.phone.trim(),
      district: lotForm.district.trim(),
      slotCount: activeSlotGroups.reduce((sum, group) => sum + group.slotCount, 0),
      slotGroups: activeSlotGroups,
    });
    setIsLotSubmitting(false);

    if (success) {
      closeLotModal();
    }
  };

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Danh sách chỗ đỗ"
        subtitle="Quản lý trạng thái từng chỗ theo từng bãi bằng dữ liệu thật từ CSDL cho toàn bộ bãi owner đang phụ trách."
        actions={
          <div className="owner-toolbar">
            <button type="button" className="btn-primary owner-btn" onClick={openCreateLot}>Tạo thêm bãi đỗ</button>
            <select className="owner-input owner-select" value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
              <option value="all">Tất cả khu vực</option>
              {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
            <select className="owner-input owner-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="available">Trống</option>
              <option value="reserved">Đã đặt</option>
              <option value="in_use">Đang sử dụng</option>
              <option value="maintenance">Bảo trì</option>
            </select>
          </div>
        }
      >
        {isSyncing ? <p className="owner-empty">Đang đồng bộ chỗ đỗ từ CSDL...</p> : null}
        {!isSyncing && lots.length === 0 ? <p className="owner-empty">Không có bãi nào khớp bộ lọc hiện tại.</p> : null}

        <div className="owner-lot-list">
          {lots.map((lot) => {
            const isExpanded = Boolean(expandedLots[lot.id ?? lot.name]);
            const summary = buildLotSummary(lot.slots);
            const occupancyPercent = Math.round((summary.occupied / Math.max(summary.total, 1)) * 100);

            return (
              <article key={lot.id ?? lot.name} className="owner-lot-card">
                <div className="owner-lot-summary">
                  <div className="owner-lot-summary-main">
                    <div>
                      <h3>{lot.name}</h3>
                      <p>{lot.address || "Chưa có địa chỉ"}{lot.district ? ` • ${lot.district}` : ""}</p>
                    </div>
                    <div className="owner-lot-summary-badges">
                      <span className="owner-summary-pill owner-summary-pill--success">Trống: {summary.available}</span>
                      <span className="owner-summary-pill owner-summary-pill--danger">Giữ/Đã có xe: {summary.occupied}</span>
                      <span className="owner-summary-pill owner-summary-pill--neutral">Tổng: {summary.total}</span>
                      {summary.maintenance > 0 ? <span className="owner-summary-pill owner-summary-pill--warning">Bảo trì: {summary.maintenance}</span> : null}
                    </div>
                    <div className="owner-lot-meter-row">
                      <div className="owner-lot-meter" aria-label={`Công suất ${occupancyPercent}%`}>
                        <span style={{ width: `${occupancyPercent}%` }} />
                      </div>
                      <strong>{occupancyPercent}% lấp đầy</strong>
                    </div>
                  </div>
                  <div className="owner-lot-summary-actions">
                    {lot.id ? <button type="button" className="btn-primary owner-btn owner-btn--small" onClick={() => openCreate(lot)}>Thêm chỗ đỗ</button> : null}
                    <button type="button" className={`owner-lot-toggle${isExpanded ? " is-open" : ""}`} onClick={() => toggleLot(lot.id ?? lot.name)}>+</button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="owner-lot-detail">
                    <div className="owner-table-shell">
                      <table className="owner-table">
                        <thead>
                          <tr>
                            <th>Mã chỗ</th>
                            <th>Khu vực</th>
                            <th>Tầng</th>
                            <th>Trạng thái</th>
                            <th>Cập nhật</th>
                            <th>Hành động</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lot.slots.map((slot) => (
                            <tr key={slot.id}>
                              <td>{slot.code}</td>
                              <td>{slot.zone}</td>
                              <td>{slot.level}</td>
                              <td><StatusBadge status={slot.status} /></td>
                              <td>{formatTimeVN(slot.updatedAt)}</td>
                              <td>
                                <div className="owner-row-actions">
                                  <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => openEdit(slot)}>Sửa</button>
                                  <button type="button" className="btn-secondary owner-btn owner-btn--small owner-btn--danger" onClick={() => actions.deleteSlot(slot.id)}>Xóa</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </SectionCard>

      {isLotModalOpen ? createPortal(
        <div className="owner-modal-backdrop" onClick={closeLotModal}>
          <div className="owner-modal owner-modal--large" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>Tạo thêm bãi đỗ</h2>
                <p>Thêm bãi mới vào danh sách bãi do owner đang quản lý.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={closeLotModal}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={handleCreateLotSubmit}>
              <label>
                Tên bãi đỗ
                <input className="owner-input" value={lotForm.name} onChange={(event) => setLotForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="VD: Bãi xe Tân Phú 2" />
              </label>
              <label>
                Số điện thoại
                <input className="owner-input" value={lotForm.phone} onChange={(event) => setLotForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="VD: 0901234567" />
              </label>
              <label className="owner-form-span">
                Địa chỉ
                <input className="owner-input" value={lotForm.address} onChange={(event) => setLotForm((prev) => ({ ...prev, address: event.target.value }))} placeholder="VD: 123 Lũy Bán Bích, Tân Phú, TP.HCM" />
              </label>
              <label>
                Quận/khu vực
                <input className="owner-input" value={lotForm.district} onChange={(event) => setLotForm((prev) => ({ ...prev, district: event.target.value }))} placeholder="VD: Quận Tân Phú" />
              </label>
              <div className="owner-form-span owner-slot-groups">
                <div className="owner-slot-groups-head">
                  <div className="owner-slot-groups-title">
                    <strong>Cấu hình khu/tầng ban đầu</strong>
                    <span>Mỗi dòng tạo một nhóm chỗ theo đúng khu vực và tầng.</span>
                  </div>
                  <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={addSlotGroup}>Thêm khu/tầng</button>
                </div>
                {lotForm.slotGroups.map((group, index) => (
                  <div className="owner-slot-group-row" key={`slot-group-${index}`}>
                    <label>
                      Khu vực
                      <input className="owner-input" value={group.zone} onChange={(event) => updateSlotGroup(index, "zone", event.target.value)} placeholder="VD: Khu A" />
                    </label>
                    <label>
                      Tầng
                      <input className="owner-input" value={group.level} onChange={(event) => updateSlotGroup(index, "level", event.target.value)} placeholder="VD: Tầng 1" />
                    </label>
                    <label>
                      Số chỗ
                      <input className="owner-input" type="number" min="0" value={group.slotCount} onChange={(event) => updateSlotGroup(index, "slotCount", event.target.value)} />
                    </label>
                    <button
                      type="button"
                      className="btn-secondary owner-btn owner-btn--small owner-btn--danger owner-slot-group-remove"
                      onClick={() => removeSlotGroup(index)}
                      disabled={lotForm.slotGroups.length <= 1}
                    >
                      Xóa
                    </button>
                  </div>
                ))}
                <p className="owner-form-note">Tổng số chỗ ban đầu: {slotGroupTotal}</p>
              </div>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={closeLotModal} disabled={isLotSubmitting}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn" disabled={isLotSubmitting}>{isLotSubmitting ? "Đang tạo..." : "Tạo bãi đỗ"}</button>
              </div>
            </form>
          </div>
        </div>
      , document.body) : null}

      {isModalOpen ? createPortal(
        <div className="owner-modal-backdrop" onClick={closeModal}>
          <div className="owner-modal" onClick={(event) => event.stopPropagation()}>
            <div className="owner-modal-head">
              <div>
                <h2>{editingSlot ? "Cập nhật chỗ đỗ" : "Thêm chỗ đỗ mới"}</h2>
                <p>Quản lý trực tiếp mã chỗ và trạng thái vận hành từ CSDL.</p>
              </div>
              <button type="button" className="owner-modal-close" onClick={closeModal}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={handleSubmit}>
              <label>
                Mã chỗ đỗ
                <input className="owner-input" value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} placeholder="VD: A11" />
              </label>
              <label>
                Khu vực
                <input className="owner-input" value={form.zone} onChange={(event) => setForm((prev) => ({ ...prev, zone: event.target.value }))} placeholder="VD: Khu A" />
              </label>
              <label>
                Tầng
                <input className="owner-input" value={form.level} onChange={(event) => setForm((prev) => ({ ...prev, level: event.target.value }))} placeholder="VD: Tầng 1" />
              </label>
              <label>
                Trạng thái
                <select className="owner-input owner-select" value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="available">Trống</option>
                  <option value="reserved">Đã đặt</option>
                  <option value="in_use">Đang sử dụng</option>
                  <option value="maintenance">Bảo trì</option>
                </select>
              </label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={closeModal}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">{editingSlot ? "Lưu thay đổi" : "Tạo chỗ đỗ"}</button>
              </div>
            </form>
          </div>
        </div>
      , document.body) : null}
    </div>
  );
}
