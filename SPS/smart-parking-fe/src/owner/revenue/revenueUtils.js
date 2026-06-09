import { buildRevenueSeries } from "../ownerAnalytics";
import { toDateInputValue } from "../../utils/dateTime";

export const REVENUE_SECTION_TABS = [
  { to: "/owner/revenue", label: "Tổng quan", end: true },
  { to: "/owner/revenue/transactions", label: "Giao dịch" },
  { to: "/owner/revenue/withdrawals", label: "Rút tiền" },
  { to: "/owner/revenue/commission", label: "Hoa hồng nền tảng" },
];

export const WITHDRAWAL_FEE = 8000;

const ONLINE_METHODS = new Set(["VNPAY", "WALLET", "QR", "BANK_TRANSFER", "MOMO", "ZALOPAY"]);

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function parseDateInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) {
    return startOfDay(new Date());
  }
  return new Date(year, month - 1, day);
}

export function getDefaultDateRange() {
  const today = startOfDay(new Date());
  return {
    dateFrom: toDateInputValue(addDays(today, -6)),
    dateTo: toDateInputValue(today),
  };
}

export function getDateBounds(dateFrom, dateTo) {
  const from = parseDateInput(dateFrom);
  const to = endOfDay(parseDateInput(dateTo));
  return from <= to ? { from, to } : { from: parseDateInput(dateTo), to: endOfDay(parseDateInput(dateFrom)) };
}

export function isInDateBounds(time, bounds) {
  const date = new Date(time);
  return !Number.isNaN(date.getTime()) && date >= bounds.from && date <= bounds.to;
}

export function normalizeMethod(method) {
  return String(method || "N/A").trim().toUpperCase();
}

export function getPaymentCategory(method) {
  const normalized = normalizeMethod(method);
  if (normalized === "CASH") {
    return "cash";
  }
  if (normalized === "N/A" || !normalized) {
    return "other";
  }
  if (ONLINE_METHODS.has(normalized)) {
    return "online";
  }
  return "online";
}

export function getMethodLabel(method) {
  const normalized = normalizeMethod(method);
  const labels = {
    CASH: "Tiền mặt",
    VNPAY: "Ví / VNPay",
    WALLET: "Ví khách (Smart Parking)",
    QR: "QR",
    BANK_TRANSFER: "Chuyển khoản",
    "N/A": "Chưa xác định",
  };
  return labels[normalized] || normalized;
}

export function getTransactionType(transaction) {
  if (transaction.status === "refunded") {
    return { key: "refund", label: "Hoàn tiền", tone: "danger" };
  }
  return { key: "payment", label: "Thanh toán", tone: "success" };
}

export function isPaidTransaction(transaction) {
  return transaction.status === "paid";
}

export function enrichTransactions(transactions, bookings = []) {
  const bookingByCode = new Map();
  bookings.forEach((booking) => {
    if (booking.code) {
      bookingByCode.set(booking.code, booking);
    }
  });

  return transactions.map((transaction) => {
    const booking = bookingByCode.get(transaction.bookingCode);
    return {
      ...transaction,
      licensePlate: booking?.plate || "",
      paymentCategory: getPaymentCategory(transaction.method),
      typeMeta: getTransactionType(transaction),
    };
  });
}

export function filterTransactions(transactions, {
  bounds,
  parkingFilter = "all",
  methodFilter = "all",
  statusFilter = "all",
  categoryFilter = "all",
  search = "",
  tab = "all",
}) {
  const keyword = search.trim().toLowerCase();
  return transactions.filter((transaction) => {
    if (bounds && !isInDateBounds(transaction.time, bounds)) {
      return false;
    }
    if (parkingFilter !== "all" && transaction.parkingLotName !== parkingFilter) {
      return false;
    }
    if (methodFilter !== "all" && normalizeMethod(transaction.method) !== normalizeMethod(methodFilter)) {
      return false;
    }
    if (statusFilter !== "all" && transaction.status !== statusFilter) {
      return false;
    }
    if (categoryFilter === "online" && transaction.paymentCategory !== "online") {
      return false;
    }
    if (categoryFilter === "cash" && transaction.paymentCategory !== "cash") {
      return false;
    }
    if (categoryFilter === "refund" && transaction.typeMeta?.key !== "refund") {
      return false;
    }
    if (tab === "online" && transaction.paymentCategory !== "online") {
      return false;
    }
    if (tab === "cash" && transaction.paymentCategory !== "cash") {
      return false;
    }
    if (tab === "refund" && transaction.typeMeta?.key !== "refund") {
      return false;
    }
    if (tab === "paid" && !isPaidTransaction(transaction)) {
      return false;
    }
    if (tab === "processing" && transaction.status !== "pending") {
      return false;
    }
    if (tab === "completed" && transaction.status !== "paid") {
      return false;
    }
    if (tab === "cancelled" && transaction.status !== "cancelled" && transaction.status !== "failed") {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return [
      transaction.id,
      transaction.bookingCode,
      transaction.parkingLotName,
      transaction.payer,
      transaction.licensePlate,
      transaction.method,
    ].join(" ").toLowerCase().includes(keyword);
  });
}

export function sumPaidAmount(transactions, picker = (item) => Number(item.amount || 0)) {
  return transactions
    .filter(isPaidTransaction)
    .reduce((sum, item) => sum + picker(item), 0);
}

export function sumGross(transactions) {
  return sumPaidAmount(transactions, (item) => Number(item.gross ?? item.amount ?? 0));
}

export function sumCommission(transactions) {
  return sumPaidAmount(transactions, (item) => Number(item.commission || 0));
}

export function computeGrowthPercent(current, previous) {
  if (!current && !previous) {
    return null;
  }
  if (!previous) {
    return current > 0 ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

export function getPreviousBounds(bounds) {
  const durationMs = bounds.to.getTime() - bounds.from.getTime() + 1;
  const previousTo = new Date(bounds.from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - durationMs + 1);
  return { from: previousFrom, to: previousTo };
}

export function buildOverviewMetrics(transactions, bounds, commissionRate) {
  const current = filterTransactions(transactions, { bounds });
  const previousBounds = getPreviousBounds(bounds);
  const previous = filterTransactions(transactions, { bounds: previousBounds });

  const paidCurrent = current.filter(isPaidTransaction);
  const paidPrevious = previous.filter(isPaidTransaction);

  const netRevenue = sumPaidAmount(paidCurrent);
  const prevNetRevenue = sumPaidAmount(paidPrevious);
  const grossRevenue = sumGross(paidCurrent);
  const commission = sumCommission(paidCurrent);
  const cashRevenue = sumPaidAmount(paidCurrent.filter((item) => item.paymentCategory === "cash"));
  const onlineRevenue = sumPaidAmount(paidCurrent.filter((item) => item.paymentCategory === "online"));
  const availableBalance = Math.max(0, netRevenue - commission);
  const successCount = paidCurrent.length;
  const failedCount = current.filter((item) => item.status !== "paid").length;

  const onlineCount = paidCurrent.filter((item) => item.paymentCategory === "online").length;
  const cashCount = paidCurrent.filter((item) => item.paymentCategory === "cash").length;

  return {
    netRevenue,
    grossRevenue,
    commission,
    cashRevenue,
    onlineRevenue,
    availableBalance,
    successCount,
    failedCount,
    totalCount: current.length,
    onlineCount,
    cashCount,
    commissionRate,
    growth: {
      netRevenue: computeGrowthPercent(netRevenue, prevNetRevenue),
      cash: computeGrowthPercent(
        cashRevenue,
        sumPaidAmount(paidPrevious.filter((item) => item.paymentCategory === "cash")),
      ),
      online: computeGrowthPercent(
        onlineRevenue,
        sumPaidAmount(paidPrevious.filter((item) => item.paymentCategory === "online")),
      ),
      commission: computeGrowthPercent(
        commission,
        sumCommission(paidPrevious),
      ),
      transactions: computeGrowthPercent(successCount, paidPrevious.length),
    },
    previousNetRevenue: prevNetRevenue,
  };
}

export function buildRevenueChartData(transactions, bounds) {
  return buildRevenueSeries(
    transactions,
    toDateInputValue(bounds.from),
    toDateInputValue(bounds.to),
    "custom",
  );
}

export function buildRevenueByParking(transactions, parkingLots = []) {
  const map = new Map();
  parkingLots.forEach((lot) => {
    map.set(lot.name, {
      name: lot.name,
      district: lot.district || lot.address || "",
      revenue: 0,
      gross: 0,
      count: 0,
    });
  });

  transactions.filter(isPaidTransaction).forEach((transaction) => {
    const key = transaction.parkingLotName || "Chưa xác định";
    const current = map.get(key) || { name: key, district: "", revenue: 0, gross: 0, count: 0 };
    current.revenue += Number(transaction.amount || 0);
    current.gross += Number(transaction.gross ?? transaction.amount ?? 0);
    current.count += 1;
    map.set(key, current);
  });

  return Array.from(map.values()).sort((left, right) => right.revenue - left.revenue);
}

export function buildMethodDistribution(transactions) {
  const map = new Map();
  const paid = transactions.filter(isPaidTransaction);
  paid.forEach((transaction) => {
    const label = getMethodLabel(transaction.method);
    const current = map.get(label) || { name: label, value: 0, count: 0, category: transaction.paymentCategory };
    current.value += Number(transaction.amount || 0);
    current.count += 1;
    map.set(label, current);
  });
  return Array.from(map.values()).sort((left, right) => right.value - left.value);
}

export function buildCategoryDistribution(transactions) {
  const paid = transactions.filter(isPaidTransaction);
  const wallet = sumPaidAmount(paid.filter((item) => item.paymentCategory === "online"));
  const other = sumPaidAmount(paid.filter((item) => item.paymentCategory !== "online"));
  return [
    { name: "Thanh toán qua ví", value: wallet, key: "online" },
    { name: "Khác", value: other, key: "other" },
  ].filter((item) => item.value > 0);
}

export function buildCommissionRows(transactions, bounds) {
  return filterTransactions(transactions, { bounds })
    .filter(isPaidTransaction)
    .map((transaction) => ({
      ...transaction,
      recoveryStatus: transaction.status === "paid" ? "recovered" : "pending",
      recoveryLabel: transaction.status === "paid" ? "Đã thu hồi" : "Đang chờ thu hồi",
      periodLabel: new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(new Date(transaction.time)),
    }));
}

export function formatGrowthLabel(value) {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  const rounded = Math.abs(value).toFixed(1);
  const sign = value >= 0 ? "↑" : "↓";
  return `${sign} ${rounded}% so với kỳ trước`;
}

export function formatPercentOfTotal(value, total) {
  if (!total) {
    return "0%";
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}
