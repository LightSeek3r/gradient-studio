import type { ToastData } from "../hooks/useToast";
import { useT } from "../i18n/context";
import { Button } from "./ui/Button";

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
  const t = useT();
  if (!toast) return null;
  return (
    <div
      role="region"
      aria-label={t("toast.region")}
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
        <Button
          variant="secondary"
          size="sm"
          icon="undo"
          className="toast-undo"
          onClick={() => {
            onUndo();
            onDismiss();
          }}
        >
          {t("toast.undo")}
        </Button>
      )}
      {toast.action && (
        <Button
          variant="primary"
          size="sm"
          className="toast-action"
          onClick={() => {
            toast.action?.run();
            onDismiss();
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <Button
        variant="icon"
        size="sm"
        icon="x"
        className="toast-close"
        aria-label={t("toast.dismiss")}
        onClick={onDismiss}
      />
    </div>
  );
}
