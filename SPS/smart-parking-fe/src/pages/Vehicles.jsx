import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API, { getAuth, saveAuth } from "../services/api";
import "./Vehicles.css";

const normalizeError = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === "string") return first;
    if (first?.msg) return first.msg;
  }
  return fallback;
};

export default function Vehicles() {
  const auth = getAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [vehicleLoading, setVehicleLoading] = useState(false);
  const [vehicleNotice, setVehicleNotice] = useState("");
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [vehicles, setVehicles] = useState([]);

  const [vehicleForm, setVehicleForm] = useState({
    licensePlate: "",
    brand: "",
    vehicleModel: "",
    seatCount: "",
    vehicleColor: "",
    imageUrl: "",
  });
  const [initialVehicleForm, setInitialVehicleForm] = useState(vehicleForm);
  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    try {
      setLoading(true);
      const [meRes, vehicleRes] = await Promise.all([API.get("/auth/me"), API.get("/vehicle/my")]);
      console.log("/vehicle/my response:", vehicleRes?.data);
      const me = meRes.data || {};
      const data = vehicleRes?.data || null;

      // Normalize to array of vehicles if possible
      let list = [];
      if (Array.isArray(data)) {
        list = data;
      } else if (Array.isArray(data?.vehicles)) {
        list = data.vehicles;
      } else if (data?.vehicle) {
        list = [data.vehicle];
      } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        // If API returns single vehicle directly
        list = [data];
      }

      setVehicles(list);

      // If at least one vehicle, prefill form with first
      const vehicle = list[0] || {};
      const nextVehicleForm = {
        licensePlate: vehicle.license_plate || me.vehicle_plate || "",
        brand: vehicle.brand || "",
        vehicleModel: vehicle.vehicle_model || "",
        seatCount: vehicle.seat_count ? String(vehicle.seat_count) : "",
        vehicleColor: vehicle.vehicle_color || me.vehicle_color || "",
        imageUrl: vehicle.image_url || vehicle.image || "",
      };

      setVehicleForm(nextVehicleForm);
      setInitialVehicleForm(nextVehicleForm);

      if (auth?.token) {
        const nextAuth = { ...auth, user: { ...auth.user, ...me } };
        saveAuth(nextAuth);
      }
    } catch (err) {
      setVehicleNotice(normalizeError(err, "Không tải được thông tin phương tiện"));
    } finally {
      setLoading(false);
    }
  };

  const isVehicleDirty = () => {
    const keys = ["licensePlate", "brand", "vehicleModel", "seatCount", "vehicleColor"];
    return keys.some((k) => String((vehicleForm[k] || "").trim()) !== String((initialVehicleForm[k] || "").trim()));
  };

  const handleSaveVehicle = async (ev) => {
    ev?.preventDefault();
    setVehicleNotice("");

    if (!vehicleForm.licensePlate.trim()) {
      setVehicleNotice("Biển số xe không được để trống");
      return;
    }

    const seatCountNumber = vehicleForm.seatCount ? Number(vehicleForm.seatCount) : null;
    if (seatCountNumber !== null && (!Number.isInteger(seatCountNumber) || seatCountNumber <= 0)) {
      setVehicleNotice("Số chỗ phải là số nguyên dương");
      return;
    }

    try {
      setVehicleLoading(true);
      const saveRes = await API.post("/vehicle/my/save", {
        license_plate: vehicleForm.licensePlate.trim(),
        brand: vehicleForm.brand.trim() || null,
        vehicle_model: vehicleForm.vehicleModel.trim() || null,
        seat_count: seatCountNumber,
        vehicle_color: vehicleForm.vehicleColor.trim() || null,
      });

      const vehicle = saveRes.data?.vehicle || {};
      const nextVehicleForm = {
        licensePlate: vehicle.license_plate || "",
        brand: vehicle.brand || "",
        vehicleModel: vehicle.vehicle_model || "",
        seatCount: vehicle.seat_count ? String(vehicle.seat_count) : "",
        vehicleColor: vehicle.vehicle_color || "",
        imageUrl: vehicle.image_url || vehicle.image || vehicleForm.imageUrl || "",
      };

      setVehicleForm(nextVehicleForm);
      setInitialVehicleForm(nextVehicleForm);

      const currentAuth = getAuth();
      if (currentAuth?.token) {
        const nextAuth = {
          ...currentAuth,
          user: {
            ...currentAuth.user,
            vehicle_plate: vehicle.license_plate || currentAuth.user?.vehicle_plate || null,
            vehicle_color: vehicle.vehicle_color || currentAuth.user?.vehicle_color || null,
          },
        };
        saveAuth(nextAuth);
      }

      setVehicleNotice("Cập nhật thông tin xe thành công");
      setShowVehicleForm(false);
      // reload vehicles list after save
      await loadVehicles();
    } catch (err) {
      setVehicleNotice(normalizeError(err, "Cập nhật thông tin xe thất bại"));
    } finally {
      setVehicleLoading(false);
    }
  };

  // images removed from vehicle cards per design

  if (loading) return (
    <section className="page-wrap vehicles-wrap">
      <div className="page-card vehicles-frame">Đang tải phương tiện...</div>
    </section>
  );

  return (
    <section className="page-wrap vehicles-wrap">
      <div className="page-card vehicles-frame">
        <header className="vehicles-header">
          <div className="vehicles-breadcrumb">Trang chủ &gt; Phương tiện</div>
          <div className="vehicles-title-row">
            <h1 className="vehicles-title">Phương tiện</h1>
            <p className="vehicles-subtitle">Quản lý các phương tiện của bạn</p>
          </div>
        </header>

        <div className="vehicles-section">
          <div className="vehicles-section-head">
            <h2 className="vehicles-section-title">Danh sách phương tiện</h2>
            <div>
              <button className="vehicle-add-btn" type="button" onClick={() => { setVehicleForm({ licensePlate: "", brand: "", vehicleModel: "", seatCount: "", vehicleColor: "", imageUrl: "" }); setShowVehicleForm(true); }}>
                ⊕ Thêm phương tiện
              </button>
            </div>
          </div>

          <div className="vehicles-list">
            {vehicles && vehicles.length > 0 ? (
              vehicles.map((v) => {
                const plate = v.license_plate || v.licensePlate || v.plate || "";
                const image = v.image_url || v.image || "";
                return (
                  <article className="vehicle-card" key={plate || JSON.stringify(v)}>
                    <div className="vehicle-card-body">
                      <div className="vehicle-card-row">
                        <div>
                          <div className="vehicle-plate">{plate}</div>
                          {auth?.user?.vehicle_plate && auth.user.vehicle_plate === plate ? <span className="vehicle-badge">Mặc định</span> : null}
                        </div>
                        <div>
                          <button className="vehicle-menu" onClick={() => { setVehicleForm({
                            licensePlate: plate,
                            brand: v.brand || "",
                            vehicleModel: v.vehicle_model || v.model || "",
                            seatCount: v.seat_count ? String(v.seat_count) : "",
                            vehicleColor: v.vehicle_color || "",
                            imageUrl: image || "",
                          }); setShowVehicleForm(true); }}>⋮</button>
                        </div>
                      </div>

                      <div className="vehicle-info-grid">
                        <div className="vehicle-info-item">
                          <div className="vehicle-info-label">Loại phương tiện</div>
                          <div className="vehicle-info-value">Ô tô</div>
                        </div>
                        <div className="vehicle-info-item">
                          <div className="vehicle-info-label">Hãng xe</div>
                          <div className="vehicle-info-value">{v.brand || "-"}</div>
                        </div>
                        <div className="vehicle-info-item">
                          <div className="vehicle-info-label">Màu sắc</div>
                          <div className="vehicle-info-value">{v.vehicle_color || v.color || "-"}</div>
                        </div>
                        <div className="vehicle-info-item">
                          <div className="vehicle-info-label">Ngày thêm</div>
                          <div className="vehicle-info-value">{v.created_at || v.added_at || "-"}</div>
                        </div>
                        <div className="vehicle-info-item">
                          <div className="vehicle-info-label">Cập nhật lần cuối</div>
                          <div className="vehicle-info-value">{v.updated_at || v.updatedAt || "-"}</div>
                        </div>
                      </div>
                  </div>
                </article>
                );
              })
            ) : (
              <div className="vehicle-empty">Chưa có phương tiện. Bấm Thêm phương tiện để thêm phương tiện mới.</div>
            )}
          </div>

          {showVehicleForm && (
            <form className="profile-card vehicle-edit-form" onSubmit={handleSaveVehicle}>
              <label>Biển số xe</label>
              <div className="profile-input-shell">
                <input className="booking-input profile-input" placeholder="Ví dụ: 30A-123.45" value={vehicleForm.licensePlate} onChange={(e) => setVehicleForm((p) => ({ ...p, licensePlate: e.target.value }))} />
              </div>
              <label>Thương hiệu</label>
              <div className="profile-input-shell">
                <input className="booking-input profile-input" placeholder="Toyota, Honda..." value={vehicleForm.brand} onChange={(e) => setVehicleForm((p) => ({ ...p, brand: e.target.value }))} />
              </div>
              <label>Dòng xe</label>
              <div className="profile-input-shell">
                <input className="booking-input profile-input" placeholder="Vios, City..." value={vehicleForm.vehicleModel} onChange={(e) => setVehicleForm((p) => ({ ...p, vehicleModel: e.target.value }))} />
              </div>
              <label>Số chỗ</label>
              <div className="profile-input-shell">
                <input className="booking-input profile-input" type="number" min={1} placeholder="4" value={vehicleForm.seatCount} onChange={(e) => setVehicleForm((p) => ({ ...p, seatCount: e.target.value }))} />
              </div>
              <label>Màu xe</label>
              <div className="profile-input-shell">
                <input className="booking-input profile-input" placeholder="Đen, trắng..." value={vehicleForm.vehicleColor} onChange={(e) => setVehicleForm((p) => ({ ...p, vehicleColor: e.target.value }))} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="profile-action-btn" type="submit" disabled={vehicleLoading || !isVehicleDirty()}>{vehicleLoading ? 'Đang lưu...' : '→ Lưu thông tin xe'}</button>
                <button type="button" className="profile-action-cancel" onClick={() => { setShowVehicleForm(false); setVehicleForm(initialVehicleForm); }}>Hủy</button>
              </div>

              {vehicleNotice ? <p className={`profile-notice`}>{vehicleNotice}</p> : null}
            </form>
          )}

          {/* Notes section removed per design */}
        </div>
      </div>
    </section>
  );
}
