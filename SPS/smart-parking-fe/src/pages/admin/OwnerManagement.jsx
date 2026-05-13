import { useMemo, useState } from "react";
import { SectionCard, StatusBadge } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";

const EMPTY_OWNER = { name: "", email: "", phone: "", parkingLot: "", status: "active" };

export default function OwnerManagement() {
  const { adminData, actions } = useAdminContext();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_OWNER);
  const [search, setSearch] = useState("");
  const [editingOwner, setEditingOwner] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "", status: "active", parkingLot: "" });

  const flattenedOwners = useMemo(
    () => (adminData.owners || []).flatMap((owner) => {
      if (owner.parkingLots && owner.parkingLots.length > 0) {
        return owner.parkingLots.map((p) => ({ ...owner, parkingLot: p.name, parkingId: p.id }));
      }
      return [{ ...owner, parkingLot: owner.parkingLot || "Chưa gán trong CSDL", parkingId: null }];
    }),
    [adminData.owners],
  );

  const lotStatusById = useMemo(() => {
    const map = new Map();
    (adminData.parkingLots || []).forEach((lot) => {
      map.set(lot.id, lot.status);
    });
    return map;
  }, [adminData.parkingLots]);

  const filteredOwners = useMemo(
    () => flattenedOwners.filter((o) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return `${o.name || ""} ${o.email || ""} ${o.parkingLot || ""}`.toLowerCase().includes(q);
    }),
    [flattenedOwners, search],
  );

  const openEditModal = (owner) => {
    setEditingOwner(owner);
    setEditForm({
      name: owner.name || "",
      email: owner.email || "",
      phone: owner.phone || "",
      status: owner.status || "active",
      parkingLot: owner.parkingLot && owner.parkingLot !== "Chưa gán trong CSDL" ? owner.parkingLot : "",
    });
  };

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Quản lý khu vực"
        subtitle="Quản lý tài khoản chủ khu vực, thông tin liên hệ và khu vực."
        actions={<button type="button" className="btn-primary owner-btn" onClick={() => setIsCreateModalOpen(true)}>Tạo khu vực quản lý mới</button>}
      >
        <div className="owner-table-actions" style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <input
            className="owner-search-input"
            placeholder="Tìm theo tên, email hoặc khu vực..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 8, width: "min(520px, 100%)", borderRadius: 6, border: "1px solid #dcdcdc" }}
          />
        </div>

        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Chủ khu vực</th>
                <th>Email</th>
                <th>Điện thoại</th>
                <th>Khu vực</th>
                <th>Trạng thái</th>
                <th>Hiệu suất</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {filteredOwners.map((owner) => {
                const lotStatus = owner.parkingId ? (lotStatusById.get(owner.parkingId) || "pending") : owner.status;
                const canToggleLot = owner.parkingId != null;
                return (
                  <tr key={`${owner.id}-${owner.parkingId ?? "none"}`}>
                    <td>{owner.name}</td>
                    <td>{owner.email}</td>
                    <td>{owner.phone || "--"}</td>
                    <td>{owner.parkingLot}</td>
                    <td><StatusBadge status={lotStatus} /></td>
                    <td>{owner.performance}</td>
                    <td>
                      <div className="owner-row-actions">
                        <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => openEditModal(owner)}>Sửa</button>
                        <button
                          type="button"
                          className="btn-secondary owner-btn owner-btn--small"
                          disabled={!canToggleLot}
                          onClick={() => {
                            if (!canToggleLot) return;
                            actions.updateParkingLot(owner.parkingId, { status: lotStatus === "locked" ? "active" : "locked" });
                          }}
                        >
                          {lotStatus === "locked" ? "Mở khóa" : "Khóa bãi"}
                        </button>
                        <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => actions.resetOwnerPassword(owner.id)}>Đặt lại mật khẩu</button>
                        <button type="button" className="btn-secondary owner-btn owner-btn--small owner-btn--danger" onClick={() => actions.deleteOwner(owner.id)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {isCreateModalOpen ? (
        <div className="owner-modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Tạo khu vực quản lý mới</h2><p>Cấp tài khoản mới cho chủ khu vực.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setIsCreateModalOpen(false)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              if (!createForm.name.trim() || !createForm.email.trim()) {
                window.alert("Vui lòng nhập tên và email.");
                return;
              }
              await actions.addOwner(createForm);
              setIsCreateModalOpen(false);
              setCreateForm(EMPTY_OWNER);
            }}>
              <label>Tên chủ khu vực<input className="owner-input" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Email<input className="owner-input" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={createForm.status} onChange={(e) => setCreateForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="suspended">Tạm khóa</option>
                </select>
              </label>
              <label className="owner-form-span">Khu vực<input className="owner-input" value={createForm.parkingLot} onChange={(e) => setCreateForm((p) => ({ ...p, parkingLot: e.target.value }))} /></label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setIsCreateModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Tạo tài khoản</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingOwner ? (
        <div className="owner-modal-backdrop" onClick={() => setEditingOwner(null)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Sửa thông tin chủ khu vực</h2><p>Cập nhật dữ liệu chủ khu vực và khu vực.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setEditingOwner(null)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              const ok = await actions.updateOwner(editingOwner.id, editForm);
              if (ok) {
                setEditingOwner(null);
              }
            }}>
              <label>Tên chủ khu vực<input className="owner-input" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Email<input className="owner-input" value={editForm.email} onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="active">Hoạt động</option>
                  <option value="suspended">Tạm khóa</option>
                </select>
              </label>
              <label className="owner-form-span">Khu vực (để trống để bỏ gán)<input className="owner-input" value={editForm.parkingLot} onChange={(e) => setEditForm((p) => ({ ...p, parkingLot: e.target.value }))} /></label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setEditingOwner(null)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
