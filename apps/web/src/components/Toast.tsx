import type { ToastData } from "../hooks/useToast";

/**
 * Visual toast. Screen readers hear it through the shared status region
 * (useToast announces), so this element is not itself a live region.
 */
export function Toast({
  toast,
  onUndo,
  onDismiss,
  onPause,
}: {
  toast: ToastData | null;
  onUndo: () => void;
  onDismiss: () => void;
  onPause: (paused: boolean) => void;
}) {
  if (!toast) return null;
  return (
    <div
      className={`toast${toast.tone === "error" ? " is-error" : ""}`}
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={() => onPause(false)}
      data-testid="toast"
    >
      <div className="toast-body">
        <p className="toast-message">{toast.message}</p>
        {toast.details && toast.details.length > 0 && (
          <ul className="toast-details">
            {toast.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
      {toast.undo && (
        <button
          type="button"
          className="btn btn-text toast-undo"
          onClick={() => {
            onUndo();
            onDismiss();
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="btn btn-remove toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
