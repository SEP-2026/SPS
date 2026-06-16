import { createContext, useCallback, useMemo, useRef, useState } from "react";
import ConfirmModal from "../components/ui/ConfirmModal";
import ToastStack from "../components/ui/ToastStack";
import "../components/ui/uiFeedback.css";

export const UiFeedbackContext = createContext(null);

const DEFAULT_TOAST_DURATION = 4200;

function createToastId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function UiFeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const confirmResolverRef = useRef(null);
  const toastTimersRef = useRef(new Map());

  const dismissToast = useCallback((toastId) => {
    const timer = toastTimersRef.current.get(toastId);
    if (timer) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(toastId);
    }
    setToasts((current) => current.filter((item) => item.id !== toastId));
  }, []);

  const showToast = useCallback((type, message, options = {}) => {
    const toastId = createToastId();
    const nextToast = {
      id: toastId,
      type,
      title: options.title || "",
      message,
    };

    setToasts((current) => [...current, nextToast].slice(-5));

    const duration = options.duration ?? DEFAULT_TOAST_DURATION;
    if (duration > 0) {
      const timer = window.setTimeout(() => dismissToast(toastId), duration);
      toastTimersRef.current.set(toastId, timer);
    }

    return toastId;
  }, [dismissToast]);

  const toast = useMemo(() => ({
    success: (message, options) => showToast("success", message, options),
    error: (message, options) => showToast("error", message, options),
    info: (message, options) => showToast("info", message, options),
  }), [showToast]);

  const closeConfirm = useCallback((result) => {
    confirmResolverRef.current?.(result);
    confirmResolverRef.current = null;
    setConfirmState(null);
  }, []);

  const confirm = useCallback((options = {}) => new Promise((resolve) => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = resolve;
    setConfirmState({
      title: options.title || "Xác nhận",
      message: options.message || "",
      confirmLabel: options.confirmLabel || "Xác nhận",
      cancelLabel: options.cancelLabel || "Hủy",
      variant: options.variant || "primary",
    });
  }), []);

  const handleConfirm = () => {
    closeConfirm(true);
  };

  const handleCancel = () => {
    closeConfirm(false);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <UiFeedbackContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ConfirmModal
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        variant={confirmState?.variant}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </UiFeedbackContext.Provider>
  );
}
