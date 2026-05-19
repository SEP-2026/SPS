import { useEffect, useState } from "react";
import {
  KPISection,
  OccupancyChart,
  ParkingOverviewCard,
  RecentActivities,
  RevenueByParking,
  RevenueSystemChart,
} from "../../owner/OwnerDashboardComponents";
import { buildRevenueSeries } from "../../owner/ownerAnalytics";
import { formatCurrency } from "../../owner/OwnerUI";
import { useOwnerContext } from "../../owner/useOwnerContext";
import API from "../../services/api";
import { formatDateTimeVN, parseVietnamDate, toDateInputValue } from "../../utils/dateTime";

const REVENUE_RANGE_OPTIONS = [
  { value: "today", label: "Hôm nay" },
  { value: "yesterday", label: "Hôm qua" },
  { value: "last3", label: "3 ngày qua" },
  { value: "last7", label: "7 ngày qua" },
  { value: "thisMonth", label: "Tháng này" },
  { value: "lastMonth", label: "Tháng trước" },
  { value: "custom", label: "Khác" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value || 0));
}

function isSameDay(value, targetDate = new Date()) {
  if (!value) {
    return false;
  }
  const date = parseVietnamDate(value);
  const target = parseVietnamDate(targetDate);
  if (!date || !target) {
    return false;
  }
  return date.getFullYear() === target.getFullYear()
    && date.getMonth() === target.getMonth()
    && date.getDate() === target.getDate();
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function parseDateInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) {
    return new Date();
  }
  return new Date(year, month - 1, day);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getInclusiveDayCount(dateFrom, dateTo) {
  const from = parseDateInput(dateFrom);
  const to = parseDateInput(dateTo);
  const diff = Math.round((to - from) / 86400000);
  return Math.max(1, diff + 1);
}

function normalizeDateBounds(dateFrom, dateTo) {
  const from = parseDateInput(dateFrom);
  const to = parseDateInput(dateTo);

  if (from <= to) {
    return { dateFrom: toDateInputValue(from), dateTo: toDateInputValue(to) };
  }

  return { dateFrom: toDateInputValue(to), dateTo: toDateInputValue(from) };
}

function getRevenueRangeConfig(range, customDateFrom, customDateTo) {
  const today = new Date();
  const yesterday = getDateDaysAgo(1);

  if (range === "today") {
    const value = toDateInputValue(today);
    return {
      dateFrom: value,
      dateTo: value,
      chartRange: "day",
      subtitle: "Thống kê doanh thu hôm nay",
    };
  }

  if (range === "yesterday") {
    const value = toDateInputValue(yesterday);
    return {
      dateFrom: value,
      dateTo: value,
      chartRange: "day",
      subtitle: "Thống kê doanh thu hôm qua",
    };
  }

  if (range === "last3") {
    return {
      dateFrom: toDateInputValue(getDateDaysAgo(2)),
      dateTo: toDateInputValue(today),
      chartRange: "custom",
      subtitle: "Thống kê doanh thu trong 3 ngày qua",
    };
  }

  if (range === "thisMonth") {
    return {
      dateFrom: toDateInputValue(startOfMonth(today)),
      dateTo: toDateInputValue(today),
      chartRange: "custom",
      subtitle: "Thống kê doanh thu trong tháng này",
    };
  }

  if (range === "lastMonth") {
    const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return {
      dateFrom: toDateInputValue(startOfMonth(previousMonth)),
      dateTo: toDateInputValue(endOfMonth(previousMonth)),
      chartRange: "custom",
      subtitle: "Thống kê doanh thu trong tháng trước",
    };
  }

  if (range === "custom") {
    return {
      ...normalizeDateBounds(customDateFrom, customDateTo),
      chartRange: "custom",
      subtitle: "Thống kê doanh thu theo khoảng ngày đã chọn",
    };
  }

  return {
    dateFrom: toDateInputValue(getDateDaysAgo(6)),
    dateTo: toDateInputValue(today),
    chartRange: "custom",
    subtitle: "Thống kê doanh thu trong 7 ngày qua",
  };
}

function getPreviousDateBounds(dateFrom, dateTo) {
  const days = getInclusiveDayCount(dateFrom, dateTo);
  const currentStart = parseDateInput(dateFrom);
  const previousTo = addDays(currentStart, -1);
  const previousFrom = addDays(previousTo, -(days - 1));

  return {
    dateFrom: toDateInputValue(previousFrom),
    dateTo: toDateInputValue(previousTo),
  };
}

function isInDateRange(value, dateFrom, dateTo) {
  const date = parseVietnamDate(value);
  if (!date) {
    return false;
  }

  const from = parseDateInput(dateFrom);
  const to = parseDateInput(dateTo);
  to.setHours(23, 59, 59, 999);
  return date >= from && date <= to;
}

function toPercent(part, total) {
  if (!total) {
    return 0;
  }
  return Math.round((Number(part || 0) / Number(total || 1)) * 100);
}

function isValidCoordinate(lat, lng) {
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  return Number.isFinite(parsedLat)
    && Number.isFinite(parsedLng)
    && Math.abs(parsedLat) <= 90
    && Math.abs(parsedLng) <= 180;
}

function readCoordinates(lot) {
  const latitude = lot?.latitude ?? lot?.lat;
  const longitude = lot?.longitude ?? lot?.lng;

  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  return {
    latitude: Number(latitude),
    longitude: Number(longitude),
  };
}

function getRevenueDeltaLabel(todayRevenue, yesterdayRevenue) {
  if (!todayRevenue && !yesterdayRevenue) {
    return "0% so với hôm qua";
  }
  if (!yesterdayRevenue) {
    return "+100% so với hôm qua";
  }
  const delta = ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100;
  const prefix = delta >= 0 ? "+" : "";
  return `${prefix}${delta.toFixed(1)}% so với hôm qua`;
}

function getRangeRevenueDeltaLabel(currentRevenue, previousRevenue) {
  if (!currentRevenue && !previousRevenue) {
    return "0% so với kỳ trước";
  }
  if (!previousRevenue) {
    return "+100% so với kỳ trước";
  }
  const delta = ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  const prefix = delta >= 0 ? "+" : "";
  return `${prefix}${delta.toFixed(1)}% so với kỳ trước`;
}

function getTimeLabel(value) {
  const date = parseVietnamDate(value);
  if (!date) {
    return "--:--";
  }
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getActivityTone(status) {
  if (["paid", "completed", "confirmed", "in_progress", "success"].includes(status)) {
    return "success";
  }
  if (["cancelled", "maintenance", "warning", "error"].includes(status)) {
    return "warning";
  }
  return "info";
}

function buildParkingLots(ownerData) {
  const slotsByLot = new Map();
  (ownerData.slots || []).forEach((slot) => {
    const key = slot.parkingLotId || `unknown-${slot.parkingLotName}`;
    if (!slotsByLot.has(key)) {
      slotsByLot.set(key, []);
    }
    slotsByLot.get(key).push(slot);
  });

  const sourceLots = Array.isArray(ownerData.parkingLots) ? ownerData.parkingLots : [];
  const mappedLots = sourceLots.map((lot) => {
    const slots = slotsByLot.get(lot.id) || [];
    const occupied = slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length;
    const maintenance = slots.filter((slot) => slot.status === "maintenance").length;
    const available = slots.filter((slot) => slot.status === "available").length;
    const total = slots.length;
    const occupancy = toPercent(occupied, total);
    const statusTone = lot.status === "locked" ? "danger" : occupancy >= 85 ? "danger" : occupancy >= 65 ? "warning" : "success";

    return {
      id: lot.id,
      name: lot.name,
      address: lot.address,
      district: lot.district,
      latitude: lot.latitude ?? lot.lat,
      longitude: lot.longitude ?? lot.lng,
      total,
      occupied,
      available,
      maintenance,
      occupancy,
      statusTone,
      statusLabel: lot.status === "locked" ? "Đã khóa" : "Realtime",
    };
  });

  const lotIds = new Set(sourceLots.map((lot) => lot.id));
  slotsByLot.forEach((slots, key) => {
    if (lotIds.has(key)) {
      return;
    }
    const occupied = slots.filter((slot) => slot.status === "reserved" || slot.status === "in_use").length;
    const total = slots.length;
    mappedLots.push({
      id: key,
      name: slots[0]?.parkingLotName || "Chưa có bãi",
      address: "",
      district: "",
      latitude: slots[0]?.latitude ?? slots[0]?.lat,
      longitude: slots[0]?.longitude ?? slots[0]?.lng,
      total,
      occupied,
      available: slots.filter((slot) => slot.status === "available").length,
      maintenance: slots.filter((slot) => slot.status === "maintenance").length,
      occupancy: toPercent(occupied, total),
      statusTone: "success",
      statusLabel: "Realtime",
    });
  });

  return mappedLots.sort((left, right) => right.occupancy - left.occupancy);
}

function buildHourlyOccupancy(bookings, totalSlots) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    count: 0,
    occupancy: 0,
  }));

  (bookings || []).forEach((booking) => {
    const rawTime = booking.startTime || booking.bookingStartTime;
    const date = parseVietnamDate(rawTime);
    if (!date) {
      return;
    }
    const status = booking.status || "";
    if (!["confirmed", "in_progress", "completed", "pending"].includes(status)) {
      return;
    }
    buckets[date.getHours()].count += 1;
  });

  const data = buckets.map((bucket) => ({
    hour: bucket.hour,
    occupancy: Math.min(100, toPercent(bucket.count, Math.max(totalSlots, 1))),
  }));

  const peak = data.reduce((max, item) => (item.occupancy > max.occupancy ? item : max), data[0]);
  const low = data.reduce((min, item) => (item.occupancy < min.occupancy ? item : min), data[0]);
  const isEmpty = data.every((item) => item.occupancy === 0);

  return {
    data,
    peakHour: { hour: peak.hour, value: peak.occupancy },
    lowHour: { hour: low.hour, value: low.occupancy },
    isEmpty,
  };
}

function buildRevenueByParking(transactions) {
  const revenueMap = new Map();
  (transactions || [])
    .filter((transaction) => transaction.status === "paid")
    .forEach((transaction) => {
      const name = transaction.parkingLotName || "Chưa có bãi";
      revenueMap.set(name, (revenueMap.get(name) || 0) + Number(transaction.amount || 0));
    });

  return Array.from(revenueMap.entries())
    .map(([name, revenue]) => ({ name, revenue }))
    .filter((item) => item.revenue > 0)
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 6);
}

function buildActivityFeed(ownerData, transactions) {
  const items = [];

  (ownerData.bookings || []).forEach((booking) => {
    if (booking.status === "in_progress") {
      items.push({
        id: `checkin-${booking.id}`,
        icon: "checkin",
        tone: "success",
        title: `Xe ${booking.plate} vừa check-in`,
        detail: `${booking.parkingLotName || "Bãi xe"} · ${booking.slotCode || "Chưa có slot"}`,
        time: booking.startTime || booking.bookingStartTime,
        timeLabel: getTimeLabel(booking.startTime || booking.bookingStartTime),
        badge: "Check-in",
      });
    }
    if (booking.status === "completed") {
      items.push({
        id: `checkout-${booking.id}`,
        icon: "checkout",
        tone: "success",
        title: `Xe ${booking.plate} đã check-out`,
        detail: `${booking.parkingLotName || "Bãi xe"} · ${booking.code}`,
        time: booking.endTime || booking.bookingEndTime,
        timeLabel: getTimeLabel(booking.endTime || booking.bookingEndTime),
        badge: "Check-out",
      });
    }
    if (booking.status === "pending" || booking.status === "confirmed") {
      items.push({
        id: `booking-${booking.id}`,
        icon: "booking",
        tone: "info",
        title: `${booking.code} được ghi nhận`,
        detail: `${booking.plate} · ${booking.parkingLotName || "Bãi xe"}`,
        time: booking.bookingStartTime || booking.startTime,
        timeLabel: getTimeLabel(booking.bookingStartTime || booking.startTime),
        badge: "Booking",
      });
    }
  });

  (transactions || []).forEach((transaction) => {
    items.push({
      id: `payment-${transaction.id}`,
      icon: "payment",
      tone: getActivityTone(transaction.status),
      title: `${transaction.bookingCode || transaction.id} thanh toán ${formatCurrency(transaction.amount)}`,
      detail: `${transaction.parkingLotName || "Bãi xe"} · ${transaction.method || "N/A"}`,
      time: transaction.time,
      timeLabel: getTimeLabel(transaction.time),
      badge: transaction.status === "paid" ? "Payment" : "Cảnh báo",
    });
  });

  (ownerData.slots || []).slice(0, 8).forEach((slot) => {
    if (!slot.updatedAt) {
      return;
    }
    items.push({
      id: `slot-${slot.id}`,
      icon: "slot",
      tone: getActivityTone(slot.status),
      title: `Slot ${slot.code} cập nhật trạng thái`,
      detail: `${slot.parkingLotName || "Bãi xe"} · ${slot.zone || "Chưa phân khu"}`,
      time: slot.updatedAt,
      timeLabel: getTimeLabel(slot.updatedAt),
      badge: "Slot update",
    });
  });

  (ownerData.activities || []).forEach((activity) => {
    if (activity.type !== "warning") {
      return;
    }
    items.push({
      id: `error-${activity.id}`,
      icon: "error",
      tone: "warning",
      title: activity.title,
      detail: activity.message || "Hệ thống ghi nhận cảnh báo",
      time: activity.time,
      timeLabel: getTimeLabel(activity.time),
      badge: "Error logs",
    });
  });

  return items
    .filter((item) => item.time)
    .sort((left, right) => new Date(right.time) - new Date(left.time))
    .slice(0, 6);
}

export default function OwnerOverview() {
  const { ownerData, stats } = useOwnerContext();
  const [parkingCoordinates, setParkingCoordinates] = useState({});
  const [revenueRange, setRevenueRange] = useState("last7");
  const [customDateFrom, setCustomDateFrom] = useState(() => toDateInputValue(getDateDaysAgo(6)));
  const [customDateTo, setCustomDateTo] = useState(() => toDateInputValue(new Date()));
  const [overviewData, setOverviewData] = useState({
    stats,
    vehiclesInLot: ownerData.bookings.filter((booking) => booking.status === "in_progress" || booking.status === "confirmed"),
    todayBookings: ownerData.bookings.filter((booking) => isSameDay(booking.startTime || booking.bookingStartTime)),
    transactions: ownerData.transactions,
  });

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        const res = await API.get("/owner/overview");
        setOverviewData({
          stats: res.data?.stats || stats,
          vehiclesInLot: res.data?.vehiclesInLot || [],
          todayBookings: res.data?.todayBookings || [],
          transactions: res.data?.transactions || [],
        });
      } catch {
        setOverviewData({
          stats,
          vehiclesInLot: ownerData.bookings.filter((booking) => booking.status === "in_progress" || booking.status === "confirmed"),
          todayBookings: ownerData.bookings.filter((booking) => isSameDay(booking.startTime || booking.bookingStartTime)),
          transactions: ownerData.transactions,
        });
      }
    };

    fetchOverview();
    const intervalId = window.setInterval(fetchOverview, 10000);
    const handleFocus = () => fetchOverview();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchOverview();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [ownerData.bookings, ownerData.transactions, stats]);

  const ownerParkingIds = (ownerData.parkingLots || [])
    .map((lot) => lot.id)
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right))
    .join(",");

  useEffect(() => {
    const parkingIds = ownerParkingIds.split(",").filter(Boolean);

    if (!parkingIds.length) {
      return undefined;
    }

    let active = true;
    const idSet = new Set(parkingIds.map(String));

    const saveCoordinates = (target, lot) => {
      const id = lot?.id ?? lot?.parking_id;
      if (!idSet.has(String(id))) {
        return;
      }

      const coordinates = readCoordinates(lot);
      if (!coordinates) {
        return;
      }

      target[String(id)] = coordinates;
    };

    const fetchCoordinates = async () => {
      const nextCoordinates = {};

      try {
        const res = await API.get("/owner/parking-lots");
        (Array.isArray(res.data) ? res.data : []).forEach((lot) => {
          saveCoordinates(nextCoordinates, lot);
        });
      } catch {
        // Coordinates are optional; the map will show an empty state if no API can provide them.
      }

      const missingIds = parkingIds.filter((id) => !nextCoordinates[id]);
      if (missingIds.length) {
        const details = await Promise.allSettled(
          missingIds.map((id) => API.get(`/parking-lots/${id}`)),
        );

        details.forEach((result) => {
          if (result.status === "fulfilled") {
            saveCoordinates(nextCoordinates, result.value.data);
          }
        });
      }

      if (active) {
        setParkingCoordinates(nextCoordinates);
      }
    };

    fetchCoordinates();

    return () => {
      active = false;
    };
  }, [ownerParkingIds]);

  const effectiveStats = overviewData.stats || stats;
  const transactions = Array.isArray(overviewData.transactions) ? overviewData.transactions : [];
  const parkingLots = buildParkingLots(ownerData).map((lot) => {
    const coordinates = parkingCoordinates[String(lot.id)];
    return coordinates ? { ...lot, ...coordinates } : lot;
  });
  const paidTransactions = transactions.filter((transaction) => transaction.status === "paid");
  const todayRevenue = paidTransactions
    .filter((transaction) => isSameDay(transaction.time))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const yesterdayRevenue = paidTransactions
    .filter((transaction) => isSameDay(transaction.time, getDateDaysAgo(1)))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

  const revenueRangeConfig = getRevenueRangeConfig(revenueRange, customDateFrom, customDateTo);
  const previousRevenueRange = getPreviousDateBounds(revenueRangeConfig.dateFrom, revenueRangeConfig.dateTo);
  const rangeTransactions = transactions.filter((transaction) =>
    isInDateRange(transaction.time, revenueRangeConfig.dateFrom, revenueRangeConfig.dateTo),
  );
  const rangePaidTransactions = rangeTransactions.filter((transaction) => transaction.status === "paid");
  const previousRangeRevenue = paidTransactions
    .filter((transaction) => isInDateRange(transaction.time, previousRevenueRange.dateFrom, previousRevenueRange.dateTo))
    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
  const revenueChartData = buildRevenueSeries(
    transactions,
    revenueRangeConfig.dateFrom,
    revenueRangeConfig.dateTo,
    revenueRangeConfig.chartRange,
  ).map((item) => ({
    label: item.label,
    revenue: Number(item.amount || 0),
  }));

  const selectedRangeRevenue = revenueChartData.reduce((sum, item) => sum + item.revenue, 0);
  const successfulTransactions = rangePaidTransactions.length;
  const successRate = rangeTransactions.length ? toPercent(successfulTransactions, rangeTransactions.length) : 0;
  const failedTransactions = rangeTransactions.filter((transaction) => transaction.status === "failed").length;
  const failedRate = rangeTransactions.length ? toPercent(failedTransactions, rangeTransactions.length) : 0;
  const totalSlots = Number(effectiveStats.totalSlots || 0);
  const availableSlots = Number(effectiveStats.availableSlots || 0);
  const usedSlots = Number(effectiveStats.usedSlots || 0);
  const availableRate = toPercent(availableSlots, totalSlots);
  const occupancyRate = toPercent(usedSlots, totalSlots);
  const occupancyChart = buildHourlyOccupancy(ownerData.bookings, totalSlots);
  const revenueRanking = buildRevenueByParking(transactions);
  const activities = buildActivityFeed(ownerData, transactions);

  const kpiItems = [
    {
      title: "Tổng số bãi xe",
      value: formatNumber(effectiveStats.managedParkingCount || parkingLots.length),
      subtitle: "Bãi đỗ ô tô đang quản lý",
      trend: `${parkingLots.length ? "100" : "0"}% đồng bộ CSDL`,
      icon: "lots",
      tone: "violet",
      trendTone: "up",
    },
    {
      title: "Tổng số chỗ đỗ",
      value: formatNumber(totalSlots),
      subtitle: "Sức chứa toàn hệ thống",
      trend: "100% slot ô tô",
      icon: "slots",
      tone: "blue",
      trendTone: "up",
    },
    {
      title: "Chỗ còn trống",
      value: formatNumber(availableSlots),
      subtitle: "Sẵn sàng nhận xe",
      trend: `${availableRate}% tỷ lệ trống`,
      icon: "available",
      tone: "green",
      trendTone: "up",
    },
    {
      title: "Đang đỗ",
      value: formatNumber(usedSlots),
      subtitle: "Đang đặt hoặc có xe",
      trend: `${occupancyRate}% tỷ lệ lấp đầy`,
      icon: "occupied",
      tone: "orange",
      trendTone: "up",
    },
    {
      title: "Doanh thu hôm nay",
      value: formatCurrency(todayRevenue),
      subtitle: "Giao dịch đã thanh toán",
      trend: getRevenueDeltaLabel(todayRevenue, yesterdayRevenue),
      icon: "revenue",
      tone: "pink",
      trendTone: todayRevenue >= yesterdayRevenue ? "up" : "down",
    },
  ];

  const revenueSummary = [
    {
      label: "Doanh thu trung bình/ngày",
      value: formatCurrency(selectedRangeRevenue / getInclusiveDayCount(revenueRangeConfig.dateFrom, revenueRangeConfig.dateTo)),
    },
    {
      label: "Giao dịch thành công",
      value: formatNumber(successfulTransactions),
    },
    {
      label: "Tỷ lệ thành công",
      value: `${successRate}%`,
    },
    {
      label: "Giao dịch thất bại",
      value: formatNumber(failedTransactions),
      note: `(${failedRate}%)`,
    },
  ];

  return (
    <div className="owner-dashboard">
      <KPISection items={kpiItems} />

      <div className="owner-dashboard-row owner-dashboard-row--analytics">
        <RevenueSystemChart
          data={revenueChartData}
          totalRevenue={selectedRangeRevenue}
          growthLabel={getRangeRevenueDeltaLabel(selectedRangeRevenue, previousRangeRevenue)}
          summary={revenueSummary}
          isEmpty={revenueChartData.every((item) => item.revenue === 0)}
          subtitle={revenueRangeConfig.subtitle}
          rangeOptions={REVENUE_RANGE_OPTIONS}
          selectedRange={revenueRange}
          onRangeChange={setRevenueRange}
          dateFrom={customDateFrom}
          dateTo={customDateTo}
          onDateFromChange={setCustomDateFrom}
          onDateToChange={setCustomDateTo}
        />
        <ParkingOverviewCard parkingLots={parkingLots} />
      </div>

      <div className="owner-dashboard-row owner-dashboard-row--triple">
        <RecentActivities activities={activities} />
        <OccupancyChart
          data={occupancyChart.data}
          peakHour={occupancyChart.peakHour}
          lowHour={occupancyChart.lowHour}
          isEmpty={occupancyChart.isEmpty}
        />
        <RevenueByParking items={revenueRanking} />
      </div>

      <div className="owner-dashboard-sync-note">
        <span>Dữ liệu lấy từ API owner hiện tại</span>
        <strong>{formatDateTimeVN(new Date(), "Đang đồng bộ realtime")}</strong>
      </div>
    </div>
  );
}
