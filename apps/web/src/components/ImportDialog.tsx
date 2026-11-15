import { useEffect, useId, useRef, useState } from "react";
import { buildGradientCSS } from "@opal42/gradient";
import { parseLinearGradient, type ImportedGradient } from "../import/parse-linear-gradient";

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

  const result = text.trim() ? parseLinearGradient(text) : null;

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
          Import CSS
        </h2>
        {intro && <p className="import-intro">{intro}</p>}
        <label className="import-label" htmlFor={`${titleId}-text`}>
          Paste a <code>linear-gradient(…)</code> or a <code>background:</code> declaration
        </label>
        <textarea
          id={`${titleId}-text`}
          className="field-input import-text"
          rows={4}
          value={text}
          spellCheck={false}
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
                {result.gradient.stops.length} stops, {result.gradient.angle}°
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
          <button type="button" className="btn btn-toggle" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!result?.ok}>
            Import
          </button>
        </div>
      </form>
    </dialog>
  );
}
