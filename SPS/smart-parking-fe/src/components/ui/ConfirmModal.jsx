import { createPortal } from "react-dom";

export default function ConfirmModal({
  open,
  title = "Xác nhận",
  message,
  confirmLabel = "Xác nhận",
  cancelLabel = "Hủy",
  variant = "primary",
  loading = false,
  onConfirm,
  onCancel,
}) {
  if (!open) {
    return null;
  }

  const confirmClass = variant === "danger"
    ? "ui-confirm-btn ui-confirm-btn--danger"
    : "ui-confirm-btn ui-confirm-btn--primary";

  return createPortal(
    <div
      className="ui-confirm-backdrop"
      role="presentation"
      onClick={loading ? undefined : onCancel}
    >
      <div
        className="ui-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ui-confirm-title"
        aria-describedby="ui-confirm-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="ui-confirm-title" className="ui-confirm-modal__title">{title}</h2>
        {message ? <p id="ui-confirm-message" className="ui-confirm-modal__message">{message}</p> : null}
        <div className="ui-confirm-modal__actions">
          <button type="button" className="ui-confirm-btn" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button type="button" className={confirmClass} onClick={onConfirm} disabled={loading}>
            {loading ? "Đang xử lý..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
