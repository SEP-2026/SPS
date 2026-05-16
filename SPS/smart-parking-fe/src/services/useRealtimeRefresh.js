import { useEffect, useRef } from "react";

const DEFAULT_MIN_REFRESH_INTERVAL_MS = 1500;

export default function useRealtimeRefresh(callback, options = {}) {
  const {
    enabled = true,
    minRefreshIntervalMs = DEFAULT_MIN_REFRESH_INTERVAL_MS,
    refreshImmediately = true,
  } = options;
  const callbackRef = useRef(callback);
  const lastRefreshRef = useRef(0);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let reconnectTimer = null;

    const triggerRefresh = () => {
      const now = Date.now();
      if (now - lastRefreshRef.current < minRefreshIntervalMs) {
        return;
      }
      lastRefreshRef.current = now;
      Promise.resolve(callbackRef.current?.()).catch(() => null);
    };

    if (refreshImmediately) {
      triggerRefresh();
    }
    reconnectTimer = window.setInterval(triggerRefresh, minRefreshIntervalMs);

    return () => {
      if (reconnectTimer) {
        window.clearInterval(reconnectTimer);
      }
    };
  }, [enabled, minRefreshIntervalMs, refreshImmediately]);
}
