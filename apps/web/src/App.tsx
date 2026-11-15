import { useCallback, useEffect, useMemo, useState } from "react";
import {
  scoreGradient,
  buildMultiGradientStyle,
  CSS_COLOR_NAMES,
  CSS_NAMED_COLORS,
  MAX_DIRECTIONS,
} from "@opal42/gradient";
import { COLOR_NAME_LIST_ID, StopCard } from "./components/StopCard";
import { stopHexFieldId } from "./components/dom-ids";
import { DirectionsPanel } from "./components/DirectionsPanel";
import { CopyButton, FlashButton } from "./components/fields";
import { StopBar } from "./components/StopBar";
import { Toast } from "./components/Toast";
import { ImportDialog } from "./components/ImportDialog";
import { CompareToggle, SuggestionPanel, type CompareView } from "./components/SuggestionCompare";
import { StatusRegion } from "./components/StatusRegion";
import { writeClipboardText } from "./clipboard";
import { announce } from "./announce";
import { scoreBand } from "./score-band";
import { buildExportLines } from "./export/css-export";
import { MAX_STOPS, MIN_STOPS, nextId, sortTicks, type GradientDocument } from "./state/document";
import { useGradientDocument } from "./state/useGradientDocument";
import { loadInitialDocument, documentLink } from "./persist/storage";
import { usePersistence } from "./hooks/usePersistence";
import { useToast } from "./hooks/useToast";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { looksLikeGradient, parseLinearGradient, type ImportedGradient } from "./import/parse-linear-gradient";
import { importedToDocument, importSummary } from "./import/to-document";
import { candidateTicks, computeSuggestion, type Suggestion } from "./suggest/compare";
import "./App.css";

const GITHUB_URL = "https://github.com/LightSeek3r/gradient-studio";
const GRADIENT_PASTE_PROMPT = "This looks like a full gradient - import it?";

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const color = scoreBand(pct).color;
  return (
    <div className="score-bar">
      <div className="score-bar-header">
        <span>{label}</span>
        <span style={{ color }}>
          {value}/{max}
        </span>
      </div>
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** A suggestion, the document it was computed for, and the compare UI state. */
interface CompareState {
  doc: GradientDocument;
  suggestion: Suggestion;
  selected: ReadonlySet<number>;
  view: CompareView;
}

interface ImportDialogState {
  text: string;
  intro?: string;
  key: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function App() {
  const store = useGradientDocument(() => loadInitialDocument().document);
  const { doc, dispatch, commit, canUndo, canRedo } = store;
  const { toast, show: showToast, dismiss: dismissToast, setPaused: pauseToast } = useToast();

  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [compareState, setCompareState] = useState<CompareState | null>(null);
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null);

  // Any edit to the document makes a suggestion stale: it is only "live" while
  // the document is exactly the one it was computed from.
  const compare = compareState && compareState.doc === doc ? compareState : null;
  const suggestion = compare?.suggestion ?? null;
  const showingSuggested = compare !== null && compare.suggestion.useful && compare.view === "suggested";
  const candidate = useMemo(
    () => (compare && compare.suggestion.useful ? candidateTicks(compare.suggestion, compare.selected) : null),
    [compare],
  );

  const sortedTicks = sortTicks(doc.ticks);
  const selectedId = doc.ticks.some((t) => t.id === selectedStopId) ? selectedStopId : null;

  const { score, issues, details } = scoreGradient(doc.ticks);
  // Preview and export always show the same thing: the candidate while the
  // suggested view is active, the document otherwise.
  const previewTicks = showingSuggested && candidate ? candidate : doc.ticks;
  const gradientStyle = buildMultiGradientStyle(previewTicks, doc.directions, doc.blend);
  const exportLines = buildExportLines(gradientStyle);
  const exportText = exportLines.join("\n");
  const selectedScore = candidate ? scoreGradient(candidate).score : null;

  const band = scoreBand(score);
  const atStopCap = doc.ticks.length >= MAX_STOPS;
  const canRemoveStop = doc.ticks.length > MIN_STOPS;

  // Screen-reader summary of the live score, debounced so dragging a handle
  // doesn't produce a flood of announcements.
  const scoreSummary = `Score ${score}, ${band.label}, ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`;
  const [announcedScore, setAnnouncedScore] = useState(scoreSummary);
  useEffect(() => {
    const t = setTimeout(() => setAnnouncedScore(scoreSummary), 700);
    return () => clearTimeout(t);
  }, [scoreSummary]);

  // ── History ──
  const undo = useCallback(() => {
    if (!store.canUndo) return;
    store.undo();
    dismissToast(); // its Undo would now refer to a different step
    announce("Undone");
  }, [store, dismissToast]);
  const redo = useCallback(() => {
    if (!store.canRedo) return;
    store.redo();
    dismissToast();
    announce("Redone");
  }, [store, dismissToast]);

  /** Apply a destructive edit and offer Undo for it. */
  const destructive = (action: Parameters<typeof dispatch>[0], message: string, details?: string[]) => {
    dispatch(action);
    showToast({ message, details, undo: true });
  };

  // ── Import ──
  const importGradient = (gradient: ImportedGradient, warnings: string[]) => {
    destructive({ type: "import", document: importedToDocument(gradient) }, importSummary(gradient), warnings);
    setImportDialog(null);
    setSelectedStopId(null);
  };

  const openImport = (text = "", intro?: string) =>
    setImportDialog((prev) => ({ text, intro, key: (prev?.key ?? 0) + 1 }));

  const importText = (text: string) => {
    const result = parseLinearGradient(text);
    if (result.ok) importGradient(result.gradient, result.warnings);
    else showToast({ message: `Not imported: ${result.error}`, details: result.warnings, tone: "error" });
  };

  useGlobalShortcuts({
    undo,
    redo,
    enabled: importDialog === null,
    onPaste: (text) => {
      if (looksLikeGradient(text)) importText(text);
      else showToast({ message: "The clipboard doesn't hold a CSS gradient - paste a linear-gradient(…) to import it", tone: "error" });
    },
  });

  usePersistence(doc, (linked) => {
    destructive({ type: "import", document: linked }, "Loaded the gradient from the link");
  });

  // ── Stops ──
  const stopNumber = (id: number) => sortedTicks.findIndex((t) => t.id === id) + 1;

  const addStopAt = (position?: number): number | null => {
    if (atStopCap) return null;
    const id = nextId(doc.ticks);
    dispatch({ type: "addStop", position });
    return id;
  };

  const removeStop = (id: number) => {
    if (!canRemoveStop) return;
    destructive({ type: "removeStop", id }, `Removed stop ${stopNumber(id)}`);
  };

  const focusStopEditor = (id: number) => {
    setSelectedStopId(id);
    requestAnimationFrame(() => document.getElementById(stopHexFieldId(id))?.focus());
  };

  // ── Suggestion ──
  const suggest = () => {
    const s = computeSuggestion(doc.ticks);
    setCompareState({
      doc,
      suggestion: s,
      selected: new Set(s.diffs.filter((d) => d.changed).map((d) => d.id)),
      view: s.useful ? "suggested" : "original",
    });
    announce(
      s.useful ? `Suggestion ready: score ${s.result.before} to ${s.result.after}. Showing the suggested gradient.` : (s.reason ?? ""),
    );
  };

  const applySuggestion = (all: boolean) => {
    if (!compare) return;
    const ticks = all ? compare.suggestion.result.stops : candidateTicks(compare.suggestion, compare.selected);
    setCompareState(null);
    const after = scoreGradient(ticks).score;
    destructive({ type: "applySuggestion", ticks }, `Applied the suggestion (score ${score} → ${after})`);
  };

  const toggleSelected = (id: number) => {
    if (!compare) return;
    const selected = new Set(compare.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    setCompareState({ ...compare, selected });
  };

  const scoreColor = band.color;
  const scoreLabel = band.label;

  return (
    <div className="studio">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <StatusRegion />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcedScore}
      </div>

      {/* Shared CSS color-name autocomplete for every stop's Name field */}
      <datalist id={COLOR_NAME_LIST_ID}>
        {CSS_COLOR_NAMES.map((name) => (
          <option key={name} value={name}>
            {CSS_NAMED_COLORS[name]}
          </option>
        ))}
      </datalist>

      <div className="studio-inner">
        {/* Header */}
        <header className="studio-header">
          <div className="studio-heading">
            <h1 className="studio-title">Gradient Studio</h1>
            <p className="studio-subtitle">Perceptual quality analysis &amp; one-click refinement</p>
          </div>
          <div className="studio-header-actions">
            <div className="btn-row header-actions" role="toolbar" aria-label="Document">
              <button
                type="button"
                className="btn btn-text"
                onClick={undo}
                disabled={!canUndo}
                title="Undo (Ctrl/Cmd+Z)"
                aria-keyshortcuts="Control+Z Meta+Z"
              >
                Undo
              </button>
              <button
                type="button"
                className="btn btn-text"
                onClick={redo}
                disabled={!canRedo}
                title="Redo (Shift+Ctrl/Cmd+Z or Ctrl+Y)"
                aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
              >
                Redo
              </button>
              <button
                type="button"
                className="btn btn-text"
                onClick={() => openImport()}
                aria-haspopup="dialog"
                title="Import a CSS linear-gradient (or paste one anywhere)"
              >
                Import CSS
              </button>
              <FlashButton
                text
                glyph="Copy link"
                title="Copy a link that reopens this gradient"
                okGlyph="Link copied ✓"
                errGlyph="Copy failed"
                okMessage="Link copied to clipboard"
                errMessage="Copy failed"
                onRun={() => writeClipboardText(documentLink(doc))}
              />
              <button
                type="button"
                className="btn btn-text"
                onClick={() => destructive({ type: "reset" }, "Reset to the starting gradient")}
                title="Start over from the default gradient"
              >
                Reset
              </button>
            </div>
            <div className="studio-score-chip" style={{ borderColor: scoreColor }} title="Live quality score">
              <span className="studio-score-chip-value" style={{ color: scoreColor }}>
                {score}
              </span>
              <span className="studio-score-chip-label" style={{ color: scoreColor }}>
                {scoreLabel}
              </span>
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1}>
          {compare && compare.suggestion.useful && (
            <CompareToggle view={compare.view} onView={(view) => setCompareState({ ...compare, view })} />
          )}

          {/* Preview */}
          <div
            className={`gradient-preview${showingSuggested ? " is-suggested" : ""}`}
            style={gradientStyle}
            data-view={showingSuggested ? "suggested" : "original"}
          />

          {/* Controls surface — connects directly to preview */}
          <div className="controls-surface">
            {/* Tick bar */}
            <section className="tick-bar-section">
              <div className="section-label">Color Stops — drag to reposition, click the bar to add</div>
              <StopBar
                ticks={doc.ticks}
                selectedId={selectedId}
                ghosts={showingSuggested ? candidate : null}
                canAdd={!atStopCap}
                canRemove={canRemoveStop}
                onSelect={setSelectedStopId}
                onMoveTo={(id, position) => dispatch({ type: "setStopPosition", id, position }, `move:${id}`)}
                onMoveBy={(id, delta) => dispatch({ type: "moveStop", id, delta }, `move:${id}`)}
                onCommit={commit}
                onAddAt={addStopAt}
                onRemove={removeStop}
                onOpen={focusStopEditor}
              />
            </section>

            {/* Stop editors — every notation, always visible */}
            <div className="stop-list">
              {sortedTicks.map((tick, i) => (
                <StopCard
                  key={tick.id}
                  tick={tick}
                  index={i}
                  canRemove={canRemoveStop}
                  selected={tick.id === selectedId}
                  onSelect={() => setSelectedStopId(tick.id)}
                  onColor={(color) => dispatch({ type: "setStopColor", id: tick.id, color }, `color:${tick.id}`)}
                  onPosition={(position) => dispatch({ type: "setStopPosition", id: tick.id, position })}
                  onRemove={() => removeStop(tick.id)}
                  onComplement={(color) =>
                    destructive({ type: "setStopColor", id: tick.id, color }, `Stop ${i + 1} replaced with its complement`)
                  }
                  onGradientText={(text) => openImport(text, GRADIENT_PASTE_PROMPT)}
                  onDone={commit}
                />
              ))}
              <button
                className="btn btn-add btn-add-stop"
                onClick={() => {
                  const id = addStopAt();
                  if (id !== null) setSelectedStopId(id);
                }}
                disabled={atStopCap}
                title={atStopCap ? `Maximum of ${MAX_STOPS} stops reached` : "Add a stop in the widest gap"}
              >
                + Add stop{atStopCap ? ` (max ${MAX_STOPS})` : ""}
              </button>
            </div>

            {/* Directions */}
            <DirectionsPanel
              directions={doc.directions}
              blend={doc.blend}
              onAngle={(id, angle) => dispatch({ type: "setAngle", id, angle }, `angle:${id}`)}
              onWeight={(id, weight) => dispatch({ type: "setWeight", id, weight }, `weight:${id}`)}
              onEnabled={(id, enabled) => dispatch({ type: "setEnabled", id, enabled })}
              onAdd={() => dispatch({ type: "addDirection" })}
              onRemove={(id) => dispatch({ type: "removeDirection", id })}
              onSpread={() => dispatch({ type: "spreadDirections" })}
              onCount={(count) => {
                if (count === doc.directions.length) return;
                destructive(
                  { type: "setDirectionCount", count },
                  `${count} direction${count > 1 ? "s" : ""}${count < doc.directions.length ? " (removed from the end)" : ""}`,
                );
              }}
              onBlend={(blend) => dispatch({ type: "setBlend", blend })}
              onCommit={commit}
            />
          </div>
          {/* end controls-surface */}

          {/* Export */}
          <div className="panel export-panel">
            <div className="export-head">
              <div className="section-label" style={{ marginBottom: 0 }}>
                {showingSuggested ? "Suggested CSS" : "Export CSS"}
              </div>
              <div className="export-actions">
                <CopyButton value={exportText} label={showingSuggested ? "suggested CSS" : "CSS"} />
                <FlashButton
                  text
                  glyph="Copy CSS"
                  title="Copy the CSS to the clipboard"
                  className="btn-copy-css"
                  okGlyph="Copied ✓"
                  errGlyph="Copy failed"
                  okMessage="CSS copied to clipboard"
                  errMessage="Copy failed"
                  onRun={() => writeClipboardText(exportText)}
                />
              </div>
            </div>
            <pre className="export-code" tabIndex={0} aria-label={showingSuggested ? "Suggested CSS" : "Export CSS"}>
              {exportLines.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </pre>
            <p className="export-note">
              Standard CSS: browsers interpolate between stops in sRGB, not OKLAB.
              {showingSuggested && " This is the suggested gradient shown in the preview, not yet applied to your stops."}
            </p>
          </div>

          {/* Score + Suggestion panels */}
          <div className="panels">
            {/* Quality score */}
            <div className="panel">
              <div className="section-label">Quality Analysis</div>
              <div className="score-header">
                <span className="score-number" style={{ color: scoreColor }}>
                  {score}
                </span>
                <span className="score-max">/100</span>
                <span
                  className="score-badge"
                  style={{ background: `color-mix(in srgb, ${scoreColor} 14%, transparent)`, color: scoreColor }}
                >
                  {scoreLabel}
                </span>
              </div>
              <p className="scope-note">
                Scores your color stops only — directions and blend are not scored.
              </p>
              <ScoreBar label="Lightness flow" value={details.lightness} max={30} />
              <ScoreBar label="Hue arc" value={details.hue} max={30} />
              <ScoreBar label="Chroma balance" value={details.chroma} max={20} />
              <ScoreBar label="Stop rhythm" value={details.spacing} max={20} />
              {issues.length > 0 && (
                <div className="issues">
                  {issues.map((issue, i) => (
                    <div key={i} className="issue">
                      <span className={`issue-icon${band.tone === "good" ? " is-neutral" : ""}`} aria-hidden="true">
                        {band.tone === "good" ? "•" : "⚠"}
                      </span>
                      {issue}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Suggestion */}
            <div className="panel">
              <div className="section-label">Perceptual Refinement</div>
              <p className="panel-description">
                Analyses your colors in <span className="accent">OKLAB space</span>, smooths lightness flow, balances
                chroma, and redistributes stops rhythmically. Exported CSS stays standard sRGB.
              </p>
              <SuggestionPanel
                suggestion={suggestion}
                selected={compare?.selected ?? new Set()}
                selectedScore={selectedScore}
                onSuggest={suggest}
                onToggle={toggleSelected}
                onApplySelected={() => applySuggestion(false)}
                onApplyAll={() => applySuggestion(true)}
              />
            </div>
          </div>
        </main>

        {/* Theory note + footer */}
        <footer className="studio-footer">
          <details className="theory-note">
            <summary className="disclosure-summary theory-summary">How does this work?</summary>
            <p>
              <span className="accent-strong">Scoring: </span>
              Lightness flow (30pts) penalizes reversals, H-K brightness wobble &amp; uneven perceptual speed. Hue arc
              (30pts) rewards arcs &lt;120° and consistent hue direction. Chroma balance (20pts) penalizes saturation
              spikes, midpoint desaturation &amp; banding risk. Stop rhythm (20pts) penalizes uneven clustering.
              Suggestion nudges colors toward perceptual harmony via <span className="accent">OKLAB→LCH</span>{" "}
              smoothing.
            </p>
            <p>
              <span className="accent-strong">Multi-angle: </span>
              up to {MAX_DIRECTIONS} directions project the same stops as stacked layers. In{" "}
              <span className="accent">average</span> mode each layer&rsquo;s alpha is set to{" "}
              <span className="accent">wₖ / (w₁+…+wₖ)</span>, so the result is the exact weighted mean of every
              direction; other modes hand the layers to <span className="accent">background-blend-mode</span> with
              alpha scaled against the heaviest direction.
            </p>
            <p>
              <span className="accent-strong">Complements: </span>
              the opposite <span className="accent">OKLCH</span> hue at matched lightness and chroma, gamut-mapped by
              reducing chroma so the hue never drifts.
            </p>
            <p>
              <span className="accent-strong">Your work: </span>
              the gradient is kept in the page address (share it with Copy link) and autosaved in this browser.
              Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z or Ctrl+Y redoes (text fields keep their own undo). Paste a CSS
              linear-gradient anywhere outside a text field to import it.
            </p>
          </details>
          <p className="footer-line">
            Runs entirely in your browser. Nothing is uploaded.
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            v{__APP_VERSION__}
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
        </footer>
      </div>

      <Toast toast={toast} onUndo={undo} onDismiss={dismissToast} onPause={pauseToast} />

      {importDialog && (
        <ImportDialog
          key={importDialog.key}
          open
          initialText={importDialog.text}
          intro={importDialog.intro}
          onImport={importGradient}
          onClose={() => setImportDialog(null)}
        />
      )}
    </div>
  );
}
