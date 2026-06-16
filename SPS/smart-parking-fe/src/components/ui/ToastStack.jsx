import { CheckCircle2, Info, X, XCircle } from "lucide-react";

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="ui-toast-stack" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type] || Info;
        return (
          <div key={toast.id} className={`ui-toast ui-toast--${toast.type}`}>
            <Icon className="ui-toast__icon" aria-hidden="true" />
            <div className="ui-toast__body">
              {toast.title ? <p className="ui-toast__title">{toast.title}</p> : null}
              <p className="ui-toast__message">{toast.message}</p>
            </div>
            <button
              type="button"
              className="ui-toast__close"
              aria-label="Đóng thông báo"
              onClick={() => onDismiss(toast.id)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
