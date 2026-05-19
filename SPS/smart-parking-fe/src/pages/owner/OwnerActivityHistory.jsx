import { useMemo } from "react";
import { Activity, AlertTriangle, CalendarCheck, CreditCard } from "lucide-react";
import { EmptyState } from "../../owner/OwnerDashboardComponents";
import { SectionCard, formatCurrency, formatDateTime, StatusBadge } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";

function normalizeActivities(ownerData) {
  const activities = [];

  (ownerData.activities || []).forEach((item) => {
    activities.push({
      id: item.id,
      type: item.type || "system",
      title: item.title,
      detail: item.message || "Sự kiện hệ thống",
      time: item.time,
      icon: item.type === "warning" ? AlertTriangle : Activity,
      status: item.type === "warning" ? "warning" : "success",
    });
  });

  (ownerData.transactions || []).forEach((transaction) => {
    activities.push({
      id: `tx-${transaction.id}`,
      type: "payment",
      title: `${transaction.bookingCode || transaction.id} thanh toán ${formatCurrency(transaction.amount)}`,
      detail: `${transaction.parkingLotName || "Bãi xe"} · ${transaction.method || "N/A"}`,
      time: transaction.time,
      icon: CreditCard,
      status: transaction.status,
    });
  });

  (ownerData.bookings || []).forEach((booking) => {
    activities.push({
      id: `booking-${booking.id}`,
      type: "booking",
      title: `${booking.code} · ${booking.plate}`,
      detail: `${booking.parkingLotName || "Bãi xe"} · ${booking.slotCode || "Chưa có slot"}`,
      time: booking.bookingStartTime || booking.startTime,
      icon: CalendarCheck,
      status: booking.status,
    });
  });

  return activities
    .filter((item) => item.time)
    .sort((left, right) => new Date(right.time) - new Date(left.time));
}

export default function OwnerActivityHistory() {
  const { ownerData, isSyncing } = useOwnerContext();
  const activities = useMemo(() => normalizeActivities(ownerData), [ownerData]);

  return (
    <div className="owner-page-grid">
      <SectionCard
        title="Lịch sử hoạt động"
        subtitle="Các sự kiện booking, payment, slot và cảnh báo lấy từ dữ liệu owner hiện tại."
      >
        {isSyncing ? <p className="owner-empty">Đang đồng bộ lịch sử hoạt động...</p> : null}
        {!isSyncing && activities.length === 0 ? (
          <EmptyState title="Chưa có dữ liệu" subtitle="Dữ liệu sẽ hiển thị khi hệ thống ghi nhận hoạt động" />
        ) : null}

        <div className="owner-history-list">
          {activities.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.id} className="owner-history-item">
                <div className={`owner-history-icon owner-history-icon--${item.status === "warning" ? "warning" : "info"}`}>
                  <Icon size={18} />
                </div>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <time>{formatDateTime(item.time)}</time>
                <StatusBadge status={item.status} />
              </article>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
