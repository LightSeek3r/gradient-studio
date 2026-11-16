import { useEffect, useId, useRef, useState } from "react";
import { buildGradientCSS } from "@opal42/gradient";
import { useT } from "../i18n/context";
import { renderRich } from "../i18n/rich";
import { Button } from "./ui/Button";
import { parseLinearGradient, type ImportedGradient } from "../import/adapter";

/**
 * "Import CSS" dialog: a textarea with a live parse result (preview strip,
 * stop count/angle, warnings or the error). Native <dialog> gives focus
 * containment, Escape-to-close and focus return.
 */
export function ImportDialog({
  open,
  initialText,
  intro,
  onImport,
  onClose,
}: {
  open: boolean;
  initialText: string;
  /** Optional lead line, e.g. "This looks like a full gradient - import it?" */
  intro?: string;
  onImport: (gradient: ImportedGradient, warnings: string[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState(initialText);
  const titleId = useId();
  const statusId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const result = text.trim() ? parseLinearGradient(text, t) : null;

  return (
    <dialog
      ref={ref}
      className="import-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (result?.ok) onImport(result.gradient, result.warnings);
        }}
      >
        <h2 id={titleId} className="import-title">
          {t("import.title")}
        </h2>
        {intro && <p className="import-intro">{intro}</p>}
        <label className="import-label" htmlFor={`${titleId}-text`}>
          {renderRich(t("import.label"), { code: (c) => <code>{c}</code> })}
        </label>
        <textarea
          id={`${titleId}-text`}
          className="field-input import-text"
          rows={4}
          value={text}
          spellCheck={false}
          // The dialog opens on request (button or paste), so moving focus into its one field is the expected behaviour, not a page-load focus grab.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          aria-describedby={statusId}
          placeholder="linear-gradient(135deg, #ff6b6b 0%, #4ecdc4 50%, #1a535c 100%)"
          onChange={(e) => setText(e.target.value)}
        />
        <div id={statusId} className="import-status" aria-live="polite">
          {result?.ok && (
            <>
              <div
                className="import-preview"
                style={{
                  background: buildGradientCSS(
                    result.gradient.stops.map((s, i) => ({ id: i, ...s })),
                    result.gradient.angle,
                  ),
                }}
              />
              <p className="import-ok">
                {t("import.summary", { count: result.gradient.stops.length, angle: result.gradient.angle })}
              </p>
            </>
          )}
          {result && !result.ok && <p className="import-error">{result.error}</p>}
          {result && result.warnings.length > 0 && (
            <ul className="import-warnings">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="btn-row import-actions">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon="import" disabled={!result?.ok}>
            {t("import.submit")}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
