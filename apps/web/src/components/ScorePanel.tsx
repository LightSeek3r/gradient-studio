import { useRef } from "react";
import { ledgerEquation, ledgerSentence, locationText, type Ledger, type LedgerRow } from "../explain/ledger";
import { issueLink } from "../persist/issue-link";
import { formatDelta, type ScoreBand } from "../score-band";
import { writeClipboardText } from "../clipboard";
import { FlashButton } from "./fields";
import { ledgerToggleId } from "./dom-ids";
import { SeverityGlyph } from "./SeverityGlyph";
import { SEVERITY_LABEL } from "../explain/explain";
import { Button } from "./ui/Button";
import { Icon } from "./ui/Icon";

/** "+3" / "−7" next to the score while a stop is being edited. */
export function DeltaBadge({ delta, className = "" }: { delta: number | null; className?: string }) {
  if (delta === null) return null;
  const dir = delta > 0 ? "up" : delta < 0 ? "down" : "same";
  return (
    <span className={`delta-badge mono is-${dir} ${className}`} aria-hidden="true" data-testid="delta-badge">
      {formatDelta(delta)}
    </span>
  );
}

/** The rail's header strip: the live score and its band, always in view on desktop. */
export function ScoreStrip({ score, band, delta }: { score: number; band: ScoreBand; delta: number | null }) {
  return (
    <div className="score-strip" style={{ "--band": band.color } as React.CSSProperties}>
      <span className="score-number mono">{score}</span>
      <span className="score-max">/100</span>
      <DeltaBadge delta={delta} />
      <span className="score-badge">{band.label}</span>
    </div>
  );
}

export interface FixOffer {
  gain: number;
  label: string;
}

/** The fix being previewed. `sticky`: it was pinned by a tap and stays until applied or cancelled. */
export interface FixPreviewState {
  code: string;
  sticky: boolean;
}

export interface ScoreLedgerProps {
  ledger: Ledger;
  fixes: ReadonlyMap<string, FixOffer>;
  isOpen: (code: string) => boolean;
  onToggle: (code: string, open: boolean) => void;
  /** The issue highlighted from elsewhere (issue lane hovered or focused). */
  active: string | null;
  onActive: (code: string | null) => void;
  preview: FixPreviewState | null;
  onPreview: (preview: FixPreviewState | null) => void;
  onApplyFix: (code: string) => void;
  /**
   * CSS backgrounds of the gradient now and with the previewed fix. Shown in
   * the row while a preview is pinned, for layouts where the stage preview can
   * be scrolled out of view.
   */
  previewStrip?: { now: string; fixed: string } | null;
}

function FixButton({
  row,
  offer,
  preview,
  onPreview,
  onApplyFix,
}: {
  row: LedgerRow;
  offer: FixOffer;
  preview: FixPreviewState | null;
  onPreview: (preview: FixPreviewState | null) => void;
  onApplyFix: (code: string) => void;
}) {
  const lastPointer = useRef<string>("mouse");
  const mine = preview?.code === row.code;
  const pinned = mine && preview.sticky;
  const release = () => {
    if (mine && !pinned) onPreview(null);
  };
  return (
    <span className="fix-actions">
      <Button
        variant={pinned ? "primary" : "secondary"}
        size="sm"
        className={`fix-button${mine ? " is-previewing" : ""}`}
        aria-label={`${pinned ? "Apply" : "Fix this"} (+${offer.gain}): ${offer.label}`}
        title={`${offer.label} (score +${offer.gain}). Hover or focus to preview.`}
        data-code={row.code}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType || "mouse";
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch" && !preview?.sticky) onPreview({ code: row.code, sticky: false });
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch") release();
        }}
        onFocus={() => {
          if (!preview?.sticky) onPreview({ code: row.code, sticky: false });
        }}
        onBlur={release}
        onClick={() => {
          // Touch has no hover: the first tap pins the preview, the second applies.
          if (lastPointer.current === "touch" && !pinned) {
            onPreview({ code: row.code, sticky: true });
            return;
          }
          onApplyFix(row.code);
        }}
      >
        {pinned ? "Apply" : "Fix this"} <span className="mono fix-gain">(+{offer.gain})</span>
      </Button>
      {pinned && (
        <Button variant="icon" size="sm" icon="x" aria-label="Cancel the fix preview" title="Cancel preview" onClick={() => onPreview(null)} />
      )}
    </span>
  );
}

/**
 * The points ledger: where every point went. One row per finding (largest
 * deduction first), an explicit "floor 0" row whenever a dimension's penalties
 * exceed its budget, and the total. Rows expand to say what the rule measures.
 */
export function ScoreLedger({ ledger, fixes, isOpen, onToggle, active, onActive, preview, onPreview, onApplyFix, previewStrip }: ScoreLedgerProps) {
  return (
    <div id="score-ledger" className="score-ledger" tabIndex={-1}>
      <p className="ledger-equation mono" aria-hidden="true" data-testid="ledger-equation">
        {ledgerEquation(ledger)}
      </p>
      <p className="sr-only">{ledgerSentence(ledger)}</p>

      <ul className="ledger" aria-label="Where the points went">
        <li className="ledger-row ledger-start">
          <span className="ledger-static">
            <span className="ledger-name">Every gradient starts at</span>
            <span className="ledger-points mono">{ledger.start}</span>
          </span>
        </li>
        {ledger.rows.map((row) => {
          const open = isOpen(row.code);
          const offer = fixes.get(row.code);
          const where = locationText(row);
          const toggleId = ledgerToggleId(row.code);
          return (
            <li
              key={row.code}
              className={`ledger-row sev-${row.severity}${open ? " is-open" : ""}${active === row.code ? " is-active" : ""}`}
              data-code={row.code}
              onPointerEnter={() => onActive(row.code)}
              onPointerLeave={() => onActive(null)}
              onFocus={() => onActive(row.code)}
              onBlur={() => onActive(null)}
            >
              <div className="ledger-line">
                <button
                  type="button"
                  id={toggleId}
                  className="ledger-toggle"
                  aria-expanded={open}
                  aria-controls={`${toggleId}-body`}
                  onClick={() => onToggle(row.code, !open)}
                >
                  <Icon name="chevron" size={14} className="disclosure-chevron" />
                  <SeverityGlyph severity={row.severity} />
                  <span className="ledger-name">
                    {row.name}
                    <span className="sr-only">, {SEVERITY_LABEL[row.severity]}</span>
                  </span>
                  <span className="ledger-points mono">
                    <span className="sr-only">minus </span>
                    <span aria-hidden="true">−</span>
                    {row.pointsLost}
                  </span>
                </button>
                {offer && <FixButton row={row} offer={offer} preview={preview} onPreview={onPreview} onApplyFix={onApplyFix} />}
              </div>
              {offer && previewStrip && preview?.sticky && preview.code === row.code && (
                <div className="fix-strip" data-testid="fix-strip">
                  <span className="fix-strip-label">Now</span>
                  <span className="fix-strip-bar" aria-hidden="true" style={{ background: previewStrip.now }} />
                  <span className="fix-strip-label">With fix</span>
                  <span className="fix-strip-bar" aria-hidden="true" style={{ background: previewStrip.fixed }} />
                  <span className="fix-strip-note">{offer.label}. Tap Apply to keep it.</span>
                </div>
              )}
              <div className="ledger-body" id={`${toggleId}-body`} hidden={!open}>
                <p className="ledger-message">{row.message}</p>
                <p className="ledger-measures">
                  <span className="ledger-key">What it measures </span>
                  {row.measures}
                </p>
                <p className="ledger-meta">
                  {where && (
                    <>
                      <span className="ledger-key">Where </span>
                      {where}
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  <span className="mono">{row.code}</span>
                </p>
                {offer && (
                  <p className="ledger-meta">
                    <span className="ledger-key">Fix </span>
                    {offer.label} (score +{offer.gain})
                  </p>
                )}
                <FlashButton
                  icon="link"
                  label="Copy link to this rule"
                  variant="ghost"
                  size="sm"
                  className="ledger-link"
                  title={`Copy a link that opens an example of “${row.name}”`}
                  okLabel="Link copied"
                  errLabel="Copy failed"
                  okMessage="Rule link copied to clipboard"
                  errMessage="Copy failed"
                  onRun={() => writeClipboardText(issueLink(row.code))}
                />
              </div>
            </li>
          );
        })}
        {ledger.floors.map((f) => (
          <li key={f.dimension} className="ledger-row ledger-floor" data-testid="ledger-floor">
            <span className="ledger-static">
              <span className="ledger-name">
                {f.label}: floor 0
                <span className="ledger-floor-note">
                  {f.nominal} deducted from a budget of {f.weight}; a dimension cannot go below 0
                </span>
              </span>
              <span className="ledger-points mono">
                <span className="sr-only">plus </span>
                <span aria-hidden="true">+</span>
                {f.absorbed}
              </span>
            </span>
          </li>
        ))}
        <li className="ledger-row ledger-total">
          <span className="ledger-static">
            <span className="ledger-name">Smoothness score</span>
            <span className="ledger-points mono">
              <span aria-hidden="true">= </span>
              {ledger.total}
            </span>
          </span>
        </li>
      </ul>
      {ledger.rows.length === 0 && <p className="ledger-empty">No deductions: none of the rules below found anything.</p>}

      <div className="dims" role="group" aria-label="Points kept per dimension">
        {ledger.dimensions.map((d) => (
          <div
            key={d.dimension}
            className="dim"
            title={`${d.label}: ${d.kept} of ${d.weight} points kept. This dimension is ${d.weight}% of the score.`}
          >
            <span className="dim-label">{d.label}</span>
            <span className="dim-value mono">
              {d.kept}
              <span className="dim-max">/{d.weight}</span>
            </span>
            <span className="dim-track" aria-hidden="true">
              <span className="dim-fill" style={{ width: `${(d.kept / d.weight) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
