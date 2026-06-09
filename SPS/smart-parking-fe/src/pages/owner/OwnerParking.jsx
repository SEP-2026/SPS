import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Building2,
  Car,
  CircleParking,
  Grid3X3,
  List,
  Map as MapIcon,
  MoreVertical,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { formatCurrency, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import { formatTimeVN, parseVietnamDate } from "../../utils/dateTime";

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

function isToday(value) {
  const date = parseVietnamDate(value);
  const now = parseVietnamDate(new Date());
  if (!date || !now) {
    return false;
  }
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function getOccupancyTone(value) {
  if (value >= 80) {
    return "danger";
  }
  if (value >= 70) {
    return "warning";
  }
  return "success";
}

export default function OwnerParking() {
  const { ownerData, actions, isSyncing } = useOwnerContext();
  const navigate = useNavigate();
  const [zoneFilter, setZoneFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name_asc");
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

    const search = normalizeUniqueText(searchQuery);
    const items = Array.from(lotMap.values())
      .filter((lot) => lot.slots.length > 0 || !zoneFilter || statusFilter === "all")
      .filter((lot) => {
        if (!search) {
          return true;
        }
        return normalizeUniqueText(`${lot.name} ${lot.address} ${lot.district} ${lot.id}`).includes(search);
      });

    return items.sort((left, right) => {
      if (sortBy === "occupancy_desc") {
        const leftSummary = buildLotSummary(left.slots);
        const rightSummary = buildLotSummary(right.slots);
        const leftOccupancy = leftSummary.occupied / Math.max(leftSummary.total, 1);
        const rightOccupancy = rightSummary.occupied / Math.max(rightSummary.total, 1);
        return rightOccupancy - leftOccupancy;
      }
      if (sortBy === "slots_desc") {
        return right.slots.length - left.slots.length;
      }
      return left.name.localeCompare(right.name, "vi");
    });
  }, [filteredSlots, ownerData.parkingLots, searchQuery, sortBy, statusFilter, zoneFilter]);

  const slotGroupTotal = useMemo(
    () => lotForm.slotGroups.reduce((sum, group) => sum + Math.max(0, Number(group.slotCount) || 0), 0),
    [lotForm.slotGroups],
  );

  const pageStats = useMemo(() => {
    const totalLots = ownerData.parkingLots?.length || lots.length;
    const totalSlots = ownerData.slots.length;
    const availableSlots = ownerData.slots.filter((slot) => slot.status === "available").length;
    const activeSlots = ownerData.slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length;
    const todayRevenue = ownerData.transactions
      .filter((item) => item.status === "paid")
      .filter((item) => isToday(item.time))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return {
      totalLots,
      totalSlots,
      activeSlots,
      availableSlots,
      todayRevenue,
      occupancyPercent: Math.round((activeSlots / Math.max(totalSlots, 1)) * 100),
    };
  }, [lots.length, ownerData.parkingLots, ownerData.slots, ownerData.transactions]);

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

  const openManageLot = (lot) => {
    if (lot.id) {
      navigate(`/owner/parking/${lot.id}`);
      return;
    }
    toggleLot(lot.name);
  };

  const openParkingMap = (lot) => {
    const query = lot.id ? `?parkingId=${lot.id}` : "";
    navigate(`/owner/parking-map${query}`);
  };

  const openLotSettings = (lot) => {
    if (!lot.id) {
      return;
    }
    navigate(`/owner/settings?tab=parking&parkingId=${lot.id}`);
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
    <div className="owner-management-page owner-parking-page">
      <div className="owner-management-topline">
        <label className="owner-management-search">
          <Search size={18} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Tìm bãi đỗ, mã bãi, địa chỉ..."
          />
        </label>
        <select className="owner-management-select" value={zoneFilter} onChange={(event) => setZoneFilter(event.target.value)}>
          <option value="all">Tất cả khu vực</option>
          {zones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
        </select>
        <select className="owner-management-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          <option value="available">Trống</option>
          <option value="in_use">Đang sử dụng</option>
          <option value="maintenance">Bảo trì</option>
        </select>
        <button type="button" className="owner-management-primary" onClick={openCreateLot}>
          <Plus size={18} />
          Thêm bãi đỗ
        </button>
      </div>

      <div className="owner-management-stats">
        <article className="owner-management-stat owner-management-stat--blue">
          <span><CircleParking size={24} /></span>
          <div><p>Tổng số bãi đỗ</p><strong>{pageStats.totalLots}</strong><small>Đang quản lý</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--sky">
          <span><Building2 size={24} /></span>
          <div><p>Tổng chỗ đỗ</p><strong>{pageStats.totalSlots}</strong><small>{pageStats.occupancyPercent}% công suất</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--green">
          <span><Car size={24} /></span>
          <div><p>Đang hoạt động</p><strong>{pageStats.activeSlots}</strong><small>{pageStats.occupancyPercent}% tổng chỗ đỗ</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--orange">
          <span><CircleParking size={24} /></span>
          <div><p>Chỗ trống</p><strong>{pageStats.availableSlots}</strong><small>{Math.round((pageStats.availableSlots / Math.max(pageStats.totalSlots, 1)) * 100)}% tổng chỗ đỗ</small></div>
        </article>
        <article className="owner-management-stat owner-management-stat--pink">
          <span><WalletCards size={24} /></span>
          <div><p>Doanh thu hôm nay</p><strong>{formatCurrency(pageStats.todayRevenue)}</strong><small>Từ giao dịch đã thanh toán</small></div>
        </article>
      </div>

      <section className="owner-management-panel owner-parking-panel">
        <div className="owner-management-panel-head">
          <div>
            <h2>Danh sách bãi đỗ</h2>
            <p>Quản lý thông tin và trạng thái hoạt động của các bãi đỗ.</p>
          </div>
          <div className="owner-management-viewtools">
            <button type="button" className="owner-management-icon-button is-active" aria-label="Dạng lưới"><Grid3X3 size={17} /></button>
            <button type="button" className="owner-management-icon-button" aria-label="Dạng danh sách"><List size={17} /></button>
            <select className="owner-management-select owner-management-select--small" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
              <option value="name_asc">Sắp xếp: Tên A-Z</option>
              <option value="occupancy_desc">Lấp đầy cao nhất</option>
              <option value="slots_desc">Nhiều chỗ nhất</option>
            </select>
            <button type="button" className="owner-management-icon-button" aria-label="Bộ lọc"><SlidersHorizontal size={17} /></button>
          </div>
        </div>

        {isSyncing ? <p className="owner-empty">Đang đồng bộ chỗ đỗ từ CSDL...</p> : null}
        {!isSyncing && lots.length === 0 ? <p className="owner-empty">Không có bãi nào khớp bộ lọc hiện tại.</p> : null}

        <div className="owner-parking-v2-list">
          {lots.map((lot, index) => {
            const isExpanded = Boolean(expandedLots[lot.id ?? lot.name]);
            const summary = buildLotSummary(lot.slots);
            const occupancyPercent = Math.round((summary.occupied / Math.max(summary.total, 1)) * 100);
            const occupancyTone = getOccupancyTone(occupancyPercent);
            const lotCode = `${normalizeUniqueText(lot.name).slice(0, 3).toUpperCase() || "LOT"}-${String(lot.id || index + 1).padStart(3, "0")}`;

            return (
              <article key={lot.id ?? lot.name} className="owner-parking-row-card">
                <div className="owner-parking-photo" data-index={index % 6}>
                  <span className={summary.maintenance > 0 ? "is-warning" : "is-active"}>
                    {summary.maintenance > 0 ? "Bảo trì" : "Đang hoạt động"}
                  </span>
                  <b>P</b>
                </div>
                <div className="owner-parking-info">
                  <div className="owner-parking-title-line">
                    <h3>{lot.name}</h3>
                    <span>{lotCode}</span>
                  </div>
                  <p>{lot.address || "Chưa có địa chỉ"}{lot.district ? ` • ${lot.district}` : ""}</p>
                  <div className="owner-parking-metrics">
                    <span><Building2 size={14} /> Tổng chỗ <strong>{summary.total}</strong></span>
                    <span className="is-success">Trống <strong>{summary.available}</strong></span>
                    <span className="is-warning">Đang đỗ <strong>{summary.occupied}</strong></span>
                    <span className="is-info">Bảo trì <strong>{summary.maintenance}</strong></span>
                  </div>
                </div>
                <div className="owner-parking-occupancy">
                  <small>Tỷ lệ lấp đầy</small>
                  <strong>{occupancyPercent}%</strong>
                  <div className={`owner-parking-occupancy-bar is-${occupancyTone}`}>
                    <span style={{ width: `${occupancyPercent}%` }} />
                  </div>
                  <p>{summary.occupied} / {summary.total} chỗ</p>
                </div>
                <div className="owner-parking-actions-v2">
                  <small>Hành động</small>
                  <div>
                    {lot.id ? (
                      <button type="button" onClick={() => openManageLot(lot)} title="Quản lý">
                        <Building2 size={17} />
                        <span>Quản lý</span>
                      </button>
                    ) : null}
                    <button type="button" onClick={() => openParkingMap(lot)} title="Sơ đồ">
                      <MapIcon size={17} />
                      <span>Sơ đồ</span>
                    </button>
                    <button type="button" onClick={() => openLotSettings(lot)} title="Cài đặt">
                      <Settings size={17} />
                      <span>Cài đặt</span>
                    </button>
                    <button type="button" className="owner-parking-more" onClick={() => toggleLot(lot.id ?? lot.name)} aria-label="Mở rộng">
                      <MoreVertical size={17} />
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="owner-parking-row-detail">
                    <div className="owner-parking-detail-head">
                      <strong>Danh sách chỗ đỗ trong bãi</strong>
                      {lot.id ? (
                        <button type="button" className="owner-management-primary" onClick={() => openCreate(lot)}>
                          <Plus size={16} />
                          Thêm chỗ đỗ
                        </button>
                      ) : null}
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
        <div className="owner-management-footnote">
          Hiển thị 1 - {lots.length} trong tổng số {pageStats.totalLots} bãi đỗ
        </div>
      </section>

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
