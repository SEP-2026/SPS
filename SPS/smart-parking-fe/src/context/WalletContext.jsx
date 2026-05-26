import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import API from "../services/api";

const WALLET_UPDATED_EVENT = "smart-parking:wallet-updated";

const WalletContext = createContext({
  wallet: null,
  loading: false,
  error: "",
  refreshWallet: async () => null,
});

export function notifyWalletUpdated(detail = {}) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(WALLET_UPDATED_EVENT, { detail }));
}

export function WalletProvider({ authToken, enabled = true, children }) {
  const shouldLoadWallet = Boolean(authToken) && enabled;
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(shouldLoadWallet);
  const [error, setError] = useState("");

  const refreshWallet = useCallback(async () => {
    if (!shouldLoadWallet) {
      setWallet(null);
      setError("");
      setLoading(false);
      return null;
    }

    setLoading(true);
    try {
      const response = await API.get("/wallet/me");
      const nextWallet = response.data?.wallet || null;
      setWallet(nextWallet);
      setError("");
      return nextWallet;
    } catch (err) {
      setWallet(null);
      setError(err?.response?.data?.detail || "Không tải được số dư");
      return null;
    } finally {
      setLoading(false);
    }
  }, [shouldLoadWallet]);

  useEffect(() => {
    if (!shouldLoadWallet) {
      setWallet(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    refreshWallet();
  }, [refreshWallet, shouldLoadWallet]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleWalletUpdated = () => {
      if (shouldLoadWallet) {
        refreshWallet();
      }
    };

    window.addEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    return () => {
      window.removeEventListener(WALLET_UPDATED_EVENT, handleWalletUpdated);
    };
  }, [refreshWallet, shouldLoadWallet]);

  const value = useMemo(
    () => ({
      wallet,
      loading,
      error,
      refreshWallet,
    }),
    [wallet, loading, error, refreshWallet],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  return useContext(WalletContext);
}
