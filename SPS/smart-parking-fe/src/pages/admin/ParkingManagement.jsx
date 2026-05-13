import { useState } from "react";
import { SectionCard, StatusBadge } from "../../owner/OwnerUI";
import { useAdminContext } from "../../admin/useAdminContext";

const EMPTY_LOT = { name: "", address: "", owner: "", phone: "", slotCount: 0, status: "pending" };

export default function ParkingManagement() {
  const { adminData, actions } = useAdminContext();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_LOT);
  const [editingLot, setEditingLot] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", address: "", owner: "", phone: "", status: "pending" });

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Danh sách bãi đỗ"
        subtitle="Thêm, sửa, duyệt hoặc khóa bãi trong toàn hệ thống."
      >
        <div className="owner-table-shell">
          <table className="owner-table">
            <thead>
              <tr>
                <th>Tên bãi</th>
                <th>Địa chỉ</th>
                <th>Số điện thoại</th>
                <th>Chủ khu vực</th>
                <th>Số chỗ</th>
                <th>Trạng thái</th>
                <th>Công suất</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {(adminData.parkingLots || []).map((lot) => (
                <tr key={lot.id}>
                  <td>{lot.name}</td>
                  <td>{lot.address}</td>
                  <td>{lot.phone || "--"}</td>
                  <td>{lot.owner}</td>
                  <td>{lot.slotCount}</td>
                  <td><StatusBadge status={lot.status} /></td>
                  <td>{lot.occupancy}%</td>
                  <td>
                    <div className="owner-row-actions">
                      <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => {
                        setEditingLot(lot);
                        setEditForm({
                          name: lot.name || "",
                          address: lot.address || "",
                          owner: lot.owner && lot.owner !== "Chưa gán trong CSDL" && lot.owner !== "Chua gan trong CSDL" ? lot.owner : "",
                          phone: lot.phone || "",
                          status: lot.status || "pending",
                        });
                      }}>Sửa</button>
                      {lot.status === "pending" ? (
                        <button type="button" className="btn-secondary owner-btn owner-btn--small" onClick={() => actions.updateParkingLot(lot.id, { status: "active" })}>Duyệt</button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-secondary owner-btn owner-btn--small"
                        onClick={() => actions.updateParkingLot(lot.id, { status: lot.status === "locked" ? "active" : "locked" })}
                      >
                        {lot.status === "locked" ? "Mở bãi" : "Khóa bãi"}
                      </button>
                      <button type="button" className="btn-secondary owner-btn owner-btn--small owner-btn--danger" onClick={() => actions.deleteParkingLot(lot.id)}>Xóa</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {isCreateModalOpen ? (
        <div className="owner-modal-backdrop" onClick={() => setIsCreateModalOpen(false)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Thêm bãi đỗ</h2><p>Tạo bản ghi bãi mới trong toàn hệ thống.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setIsCreateModalOpen(false)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              await actions.addParkingLot({ ...createForm, slotCount: Number(createForm.slotCount) || 0 });
              setIsCreateModalOpen(false);
              setCreateForm(EMPTY_LOT);
            }}>
              <label>Tên bãi<input className="owner-input" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Chủ khu vực<input className="owner-input" value={createForm.owner} onChange={(e) => setCreateForm((p) => ({ ...p, owner: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label>Số chỗ<input className="owner-input" value={createForm.slotCount} onChange={(e) => setCreateForm((p) => ({ ...p, slotCount: e.target.value }))} /></label>
              <label className="owner-form-span">Địa chỉ<input className="owner-input" value={createForm.address} onChange={(e) => setCreateForm((p) => ({ ...p, address: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={createForm.status} onChange={(e) => setCreateForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="pending">Chờ duyệt</option>
                  <option value="active">Hoạt động</option>
                  <option value="locked">Khóa</option>
                </select>
              </label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setIsCreateModalOpen(false)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu bãi đỗ</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {editingLot ? (
        <div className="owner-modal-backdrop" onClick={() => setEditingLot(null)}>
          <div className="owner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="owner-modal-head">
              <div><h2>Sửa thông tin bãi</h2><p>Cập nhật tên bãi, địa chỉ, chủ khu vực và trạng thái.</p></div>
              <button type="button" className="owner-modal-close" onClick={() => setEditingLot(null)}>×</button>
            </div>
            <form className="owner-form-grid" onSubmit={async (e) => {
              e.preventDefault();
              await actions.updateParkingLot(editingLot.id, editForm);
              setEditingLot(null);
            }}>
              <label>Tên bãi<input className="owner-input" value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></label>
              <label>Chủ khu vực<input className="owner-input" value={editForm.owner} onChange={(e) => setEditForm((p) => ({ ...p, owner: e.target.value }))} /></label>
              <label>Số điện thoại<input className="owner-input" value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} /></label>
              <label className="owner-form-span">Địa chỉ<input className="owner-input" value={editForm.address} onChange={(e) => setEditForm((p) => ({ ...p, address: e.target.value }))} /></label>
              <label>Trạng thái
                <select className="owner-input owner-select" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  <option value="pending">Chờ duyệt</option>
                  <option value="active">Hoạt động</option>
                  <option value="locked">Khóa</option>
                </select>
              </label>
              <div className="owner-modal-actions">
                <button type="button" className="btn-secondary owner-btn" onClick={() => setEditingLot(null)}>Hủy</button>
                <button type="submit" className="btn-primary owner-btn">Lưu thay đổi</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
