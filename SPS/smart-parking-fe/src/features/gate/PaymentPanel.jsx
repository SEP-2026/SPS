import { formatCurrency } from "./gateFormatters";
import { getPaymentStatusLabel } from "./statusLabel";

export default function PaymentPanel({ booking, paymentMethod, setPaymentMethod }) {
  void paymentMethod;
  void setPaymentMethod;
  const pricing = booking?.pricing_preview;
  const payment = booking?.payment;
  const remainingDue = Number(pricing?.remaining_due || payment?.remaining_amount || 0);

  return (
    <div className="scan-payment-panel">
      <h3>Thanh toán</h3>
      <div className="scan-summary-list">
        <div>
          <span>Tổng tiền</span>
          <strong>{formatCurrency(pricing?.total_charge)}</strong>
        </div>
        <div>
          <span>Đã cọc / đã thu</span>
          <strong>{formatCurrency(pricing?.prepaid_amount || payment?.amount)}</strong>
        </div>
        <div>
          <span>Phát sinh thêm</span>
          <strong>{formatCurrency(pricing?.extra_fee || payment?.overtime_fee)}</strong>
        </div>
        <div>
          <span>Còn phải trả</span>
          <strong>{formatCurrency(pricing?.remaining_due || payment?.remaining_amount)}</strong>
        </div>
        <div>
          <span>Trạng thái thanh toán</span>
          <strong>{getPaymentStatusLabel(payment?.payment_status || pricing?.payment_status)}</strong>
        </div>
      </div>

      <div className="scan-hint">
        Checkout sẽ tự khấu trừ từ ví nội bộ. Nhân viên chỉ cần quét QR booking để xác nhận vào/ra.
      </div>

      {remainingDue > 0 ? (
        <div className="scan-summary-list" style={{ marginTop: 12 }}>
          <div>
            <span>Số tiền còn phải trừ khi checkout</span>
            <strong>{formatCurrency(remainingDue)}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
}
