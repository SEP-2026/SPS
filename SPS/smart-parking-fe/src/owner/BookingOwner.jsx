import { useCallback, useEffect, useState } from "react";
import API from "../services/api";
import { OwnerIcon } from "./OwnerIcons";
import "./owner.css";

const EMPTY_BOOKING_DATA = {
  customers: [],
  parkingLots: [],
  slots: [],
  selectedParkingLot: null,
  selectedCustomer: null,
  selectedSlot: null,
  startTime: "",
  expireTime: "",
  bookingMode: "hourly",
  totalAmount: 0
};

export default function BookingOwner() {
  const [bookingData, setBookingData] = useState(EMPTY_BOOKING_DATA);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadCustomers();
    loadAvailableSlots();
  }, []);

  const loadCustomers = async () => {
    try {
      const response = await API.get("/owner/customers-list");
      setBookingData(prev => ({ ...prev, customers: response.data }));
    } catch (error) {
      console.error("Error loading customers:", error);
    }
  };

  const loadAvailableSlots = async () => {
    try {
      const parkingResponse = await API.get("/owner/parking-lots/slots-overview");
      const parkingLots = parkingResponse.data.map((parkingData) => ({
        id: parkingData.parking_id,
        name: parkingData.parking_name || `Bãi ${parkingData.parking_id}`,
        slots: Array.isArray(parkingData.slots)
          ? parkingData.slots
              .filter((slot) => slot.status === "available")
              .map((slot) => ({ ...slot }))
          : [],
      }));

      setBookingData((prev) => ({
        ...prev,
        parkingLots,
        slots: [],
        selectedParkingLot: null,
        selectedSlot: null,
      }));
    } catch (error) {
      console.error("Error loading slots:", error);
    }
  };

  const handleCustomerSelect = (customerId) => {
    const customer = bookingData.customers.find(c => c.id === parseInt(customerId));
    setBookingData(prev => ({ ...prev, selectedCustomer: customer }));
  };

  const handleLotSelect = (parkingLotId) => {
    const selectedParkingLot = bookingData.parkingLots.find(
      (lot) => String(lot.id) === String(parkingLotId)
    ) || null;

    setBookingData((prev) => ({
      ...prev,
      selectedParkingLot,
      slots: selectedParkingLot ? selectedParkingLot.slots : [],
      selectedSlot: null,
    }));
  };

  const handleSlotSelect = (slotId) => {
    const slot = bookingData.slots.find((s) => String(s.id) === String(slotId));
    setBookingData((prev) => ({ ...prev, selectedSlot: slot }));
  };

  const calculateAmount = useCallback(() => {
    if (!bookingData.startTime || !bookingData.expireTime || !bookingData.selectedSlot) {
      return 0;
    }
    
    const start = new Date(bookingData.startTime);
    const end = new Date(bookingData.expireTime);
    const hours = (end - start) / (1000 * 60 * 60);
    
    // Simple calculation - in real app, get from parking prices
    const hourlyRate = 5000; // VND per hour
    return Math.max(0, hours * hourlyRate);
  }, [bookingData.startTime, bookingData.expireTime, bookingData.selectedSlot]);

  useEffect(() => {
    const amount = calculateAmount();
    setBookingData(prev => ({ ...prev, totalAmount: amount }));
  }, [calculateAmount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!bookingData.selectedCustomer || !bookingData.selectedSlot || 
        !bookingData.startTime || !bookingData.expireTime) {
      setMessage("Vui lòng điền đầy đủ thông tin");
      return;
    }

    setLoading(true);
    try {
      const requestData = {
        user_id: bookingData.selectedCustomer.id,
        slot_id: bookingData.selectedSlot.id,
        start_time: new Date(bookingData.startTime).toISOString(),
        expire_time: new Date(bookingData.expireTime).toISOString(),
        booking_mode: bookingData.bookingMode,
        total_amount: bookingData.totalAmount
      };

      await API.post("/owner/booking-owner", requestData);
      setMessage("Đã tạo booking thành công! Khách hàng sẽ nhận được thông báo xác nhận.");
      
      // Reset form
      setBookingData(EMPTY_BOOKING_DATA);
      loadCustomers();
      loadAvailableSlots();
    } catch (error) {
      setMessage(error.response?.data?.detail || "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="owner-booking-owner owner-content">
      <section className="owner-section-card">
        <header className="owner-section-head">
          <div>
            <h2>Đặt chỗ giúp khách hàng</h2>
            <p>Tạo booking giúp khách, yêu cầu xác nhận và tự hủy nếu khách không phản hồi trong 10 phút.</p>
          </div>
        </header>

        {message && (
          <div className={`owner-message ${message.includes("thành công") ? "success" : "error"}`}>
            {message}
          </div>
        )}

        <div className="owner-two-col">
          <form onSubmit={handleSubmit} className="owner-form-grid">
            <label className="owner-form-span">
              <span>Chọn khách hàng</span>
              <select
                className="owner-input owner-select"
                value={bookingData.selectedCustomer?.id || ""}
                onChange={(e) => handleCustomerSelect(e.target.value)}
                required
              >
                <option value="">-- Chọn khách hàng --</option>
                {bookingData.customers.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} - {customer.phone}
                  </option>
                ))}
              </select>
            </label>

            <label className="owner-form-span">
              <span>Chọn bãi đỗ</span>
              <select
                className="owner-input owner-select"
                value={bookingData.selectedParkingLot?.id || ""}
                onChange={(e) => handleLotSelect(e.target.value)}
                required
              >
                <option value="">-- Chọn bãi đỗ --</option>
                {bookingData.parkingLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.name} ({lot.slots.length} chỗ trống)
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Chọn chỗ đỗ</span>
              <select
                className="owner-input owner-select"
                value={bookingData.selectedSlot?.id || ""}
                onChange={(e) => handleSlotSelect(e.target.value)}
                required
                disabled={!bookingData.selectedParkingLot}
              >
                <option value="">-- Chọn chỗ đỗ --</option>
                {bookingData.slots.map((slot) => (
                  <option key={slot.id} value={slot.id}>
                    {slot.code}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Thời gian bắt đầu</span>
              <input
                className="owner-input"
                type="datetime-local"
                value={bookingData.startTime}
                onChange={(e) => setBookingData(prev => ({ ...prev, startTime: e.target.value }))}
                required
              />
            </label>

            <label>
              <span>Thời gian kết thúc</span>
              <input
                className="owner-input"
                type="datetime-local"
                value={bookingData.expireTime}
                onChange={(e) => setBookingData(prev => ({ ...prev, expireTime: e.target.value }))}
                required
              />
            </label>

            <label>
              <span>Loại đặt chỗ</span>
              <select
                className="owner-input owner-select"
                value={bookingData.bookingMode}
                onChange={(e) => setBookingData(prev => ({ ...prev, bookingMode: e.target.value }))}
              >
                <option value="hourly">Theo giờ</option>
                <option value="daily">Theo ngày</option>
                <option value="monthly">Theo tháng</option>
              </select>
            </label>

            <div className="owner-form-span owner-detail-grid">
              <div>
                <p className="owner-kicker">Thông tin khách</p>
                {bookingData.selectedCustomer ? (
                  <>
                    <p><strong>Tên:</strong> {bookingData.selectedCustomer.name}</p>
                    <p><strong>Email:</strong> {bookingData.selectedCustomer.email}</p>
                    <p><strong>SĐT:</strong> {bookingData.selectedCustomer.phone}</p>
                    {bookingData.selectedCustomer.vehicle_plate && <p><strong>Biển số:</strong> {bookingData.selectedCustomer.vehicle_plate}</p>}
                    {bookingData.selectedCustomer.vehicle_brand && (
                      <p><strong>Xe:</strong> {bookingData.selectedCustomer.vehicle_brand} {bookingData.selectedCustomer.vehicle_model || ""}</p>
                    )}
                    {bookingData.selectedCustomer.vehicle_color && <p><strong>Màu:</strong> {bookingData.selectedCustomer.vehicle_color}</p>}
                  </>
                ) : (
                  <p>Chọn khách hàng để xem thông tin chi tiết.</p>
                )}
              </div>

              <div>
                <p className="owner-kicker">Tóm tắt đặt chỗ</p>
                <p><strong>Bãi đỗ:</strong> {bookingData.selectedParkingLot ? bookingData.selectedParkingLot.name : "Chưa chọn"}</p>
                <p><strong>Slot:</strong> {bookingData.selectedSlot ? bookingData.selectedSlot.code : "Chưa chọn"}</p>
                <p><strong>Bắt đầu:</strong> {bookingData.startTime || "Chưa chọn"}</p>
                <p><strong>Kết thúc:</strong> {bookingData.expireTime || "Chưa chọn"}</p>
                <p><strong>Hình thức:</strong> {bookingData.bookingMode === "hourly" ? "Theo giờ" : bookingData.bookingMode === "daily" ? "Theo ngày" : "Theo tháng"}</p>
                <p><strong>Tổng tiền:</strong> {bookingData.totalAmount.toLocaleString()} VND</p>
              </div>
            </div>

            <button
              type="submit"
              className="owner-submit-btn owner-form-span"
              disabled={loading}
            >
              {loading ? "Đang xử lý..." : "Tạo booking"}
            </button>
          </form>

          <div className="owner-support-box">
            <h3>Hướng dẫn nhanh</h3>
            <p>Chọn khách hàng và chỗ đỗ phù hợp. Khách sẽ nhận được thông báo và phải xác nhận trong 10 phút.</p>
            <p>Nếu khách không phản hồi, đặt chỗ sẽ tự động hủy để giữ slot cho người khác.</p>
          </div>
        </div>
      </section>
    </div>
  );
}