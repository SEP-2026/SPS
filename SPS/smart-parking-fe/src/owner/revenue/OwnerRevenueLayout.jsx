import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useOutletContext } from "react-router-dom";
import API from "../../services/api";
import { useOwnerContext } from "../useOwnerContext";
import {
  enrichTransactions,
  getDateBounds,
  getDefaultDateRange,
} from "./revenueUtils";
import { RevenueSectionTabs } from "./OwnerRevenueShared";

export function useOwnerRevenueContext() {
  const context = useOutletContext();
  return context?.revenue || null;
}

export default function OwnerRevenueLayout() {
  const ownerContext = useOwnerContext();
  const { ownerData, actions } = ownerContext;
  const location = useLocation();
  const defaults = getDefaultDateRange();
  const [transactions, setTransactions] = useState([]);
  const [parkingLots, setParkingLots] = useState([]);
  const [commissionRate, setCommissionRate] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);

  const loadRevenue = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
      const res = await API.get("/owner/revenue");
      setTransactions(res.data?.transactions || []);
      setParkingLots(res.data?.parkingLots || ownerData.parkingLots || []);
      setCommissionRate(Number(res.data?.commissionRate ?? 10));
    } catch (err) {
      setError(err?.response?.data?.detail || "Không tải được dữ liệu doanh thu");
      setTransactions(ownerData.transactions || []);
      setParkingLots(ownerData.parkingLots || []);
    } finally {
      setLoading(false);
    }
  }, [ownerData.parkingLots, ownerData.transactions]);

  useEffect(() => {
    loadRevenue();
  }, [loadRevenue]);

  const enrichedTransactions = useMemo(
    () => enrichTransactions(transactions, ownerData.bookings || []),
    [ownerData.bookings, transactions],
  );

  const bounds = useMemo(() => getDateBounds(dateFrom, dateTo), [dateFrom, dateTo]);

  const parkingOptions = useMemo(() => {
    const names = new Set();
    parkingLots.forEach((lot) => {
      if (lot.name) {
        names.add(lot.name);
      }
    });
    enrichedTransactions.forEach((transaction) => {
      if (transaction.parkingLotName) {
        names.add(transaction.parkingLotName);
      }
    });
    return Array.from(names).sort((left, right) => left.localeCompare(right, "vi"));
  }, [enrichedTransactions, parkingLots]);

  const methodOptions = useMemo(() => (
    Array.from(new Set(enrichedTransactions.map((item) => item.method).filter((method) => method && method !== "N/A"))).sort()
  ), [enrichedTransactions]);

  const refreshRevenue = async () => {
    await Promise.all([
      loadRevenue(),
      actions?.refreshOwnerData?.({ silent: true }),
    ]);
  };

  const revenueContext = {
    transactions: enrichedTransactions,
    parkingLots,
    commissionRate,
    loading,
    error,
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    bounds,
    parkingOptions,
    methodOptions,
    refreshRevenue,
    hasWithdrawalApi: true,
  };

  return (
    <div className="owner-designed-page owner-revenue-payment-page">
      <RevenueSectionTabs key={location.pathname} />
      <Outlet context={{ ...ownerContext, revenue: revenueContext }} />
    </div>
  );
}
