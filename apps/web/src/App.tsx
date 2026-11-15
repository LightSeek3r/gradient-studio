import { useCallback, useEffect, useMemo, useState } from "react";
import {
  scoreGradient,
  buildMultiGradientStyle,
  CSS_COLOR_NAMES,
  CSS_NAMED_COLORS,
  MAX_DIRECTIONS,
} from "@opal42/gradient";
import { COLOR_NAME_LIST_ID, StopCard, type Notation } from "./components/StopCard";
import { StopChip } from "./components/StopChip";
import { stopCardId } from "./components/dom-ids";
import { DirectionsPanel } from "./components/DirectionsPanel";
import { FlashButton } from "./components/fields";
import { StopBar } from "./components/StopBar";
import { IssueLane } from "./components/IssueLane";
import { MobileTabBar } from "./components/MobileTabBar";
import { ScoreDetails, ScoreStrip } from "./components/ScorePanel";
import { Toast } from "./components/Toast";
import { ImportDialog } from "./components/ImportDialog";
import { CompareToggle, SuggestionPanel, type CompareView } from "./components/SuggestionCompare";
import { StatusRegion } from "./components/StatusRegion";
import { Button } from "./components/ui/Button";
import { Icon } from "./components/ui/Icon";
import { Surface } from "./components/ui/Surface";
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
import { MOBILE_QUERY, useMediaQuery } from "./hooks/useMediaQuery";
import { DEFAULT_TAB, panelId, tabId, type TabId } from "./layout/tabs";
import {
  looksLikeGradient,
  parseLinearGradient,
  type ImportedGradient,
} from "./import/parse-linear-gradient";
import { importedToDocument, importSummary } from "./import/to-document";
import { candidateTicks, computeSuggestion, type Suggestion } from "./suggest/compare";
import "./App.css";

const GITHUB_URL = "https://github.com/LightSeek3r/gradient-studio";
const GRADIENT_PASTE_PROMPT = "This looks like a full gradient - import it?";

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

  const tabbed = useMediaQuery(MOBILE_QUERY);
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);
  const [notation, setNotation] = useState<Notation>("hex");
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [compareState, setCompareState] = useState<CompareState | null>(null);
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(null);

  // Any edit to the document makes a suggestion stale: it is only "live" while
  // the document is exactly the one it was computed from.
  const compare = compareState && compareState.doc === doc ? compareState : null;
  const suggestion = compare?.suggestion ?? null;
  const showingSuggested = compare !== null && compare.suggestion.useful && compare.view === "suggested";
  const candidate = useMemo(
    () =>
      compare && compare.suggestion.useful ? candidateTicks(compare.suggestion, compare.selected) : null,
    [compare],
  );

  const sortedTicks = sortTicks(doc.ticks);
  // There is always a selected stop (the inspector always shows one): the
  // chosen stop while it exists, otherwise the first.
  const selectedId =
    selectedStopId !== null && doc.ticks.some((t) => t.id === selectedStopId)
      ? selectedStopId
      : (sortedTicks[0]?.id ?? null);

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
    destructive(
      { type: "import", document: importedToDocument(gradient) },
      importSummary(gradient),
      warnings,
    );
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
      else
        showToast({
          message: "The clipboard doesn't hold a CSS gradient - paste a linear-gradient(…) to import it",
          tone: "error",
        });
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

  const focusCard = (id: number | null) => {
    if (id === null) return;
    requestAnimationFrame(() => document.getElementById(stopCardId(id))?.focus({ preventScroll: true }));
  };

  const removeStop = (id: number, opts: { focusCard?: boolean } = {}) => {
    if (!canRemoveStop) return;
    let nextSelected = selectedId;
    if (id === selectedId) {
      const i = sortedTicks.findIndex((t) => t.id === id);
      nextSelected = (sortedTicks[i + 1] ?? sortedTicks[i - 1])?.id ?? null;
      setSelectedStopId(nextSelected);
    }
    destructive({ type: "removeStop", id }, `Removed stop ${stopNumber(id)}`);
    if (opts.focusCard) focusCard(nextSelected);
  };

  /** Enter on a bar handle: move focus into that stop's editor field. */
  const focusStopEditor = (id: number) => {
    setSelectedStopId(id);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`#${stopCardId(id)} .stop-notation input`)?.focus(),
    );
  };

  /** Chip activated: expand that stop and move focus into its card. */
  const selectFromChip = (id: number) => {
    setSelectedStopId(id);
    focusCard(id);
  };

  // ── Tabs / score jump ──
  const changeTab = (next: TabId) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };
  const jumpToScore = () => {
    if (tabbed) changeTab("score");
    else document.getElementById("score-details")?.scrollIntoView({ block: "start" });
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
      s.useful
        ? `Suggestion ready: score ${s.result.before} to ${s.result.after}. Showing the suggested gradient.`
        : (s.reason ?? ""),
    );
  };

  const applySuggestion = (all: boolean) => {
    if (!compare) return;
    const ticks = all
      ? compare.suggestion.result.stops
      : candidateTicks(compare.suggestion, compare.selected);
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

  const panelProps = (id: TabId) => ({
    id: panelId(id),
    role: tabbed ? ("tabpanel" as const) : undefined,
    "aria-labelledby": tabbed ? tabId(id) : undefined,
    hidden: tabbed && tab !== id,
  });

  return (
    <div className={`studio${tabbed ? " is-tabbed" : ""}`}>
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
          <div className="header-actions" role="toolbar" aria-label="Document">
            <Button
              icon="undo"
              collapse
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl/Cmd+Z)"
              aria-keyshortcuts="Control+Z Meta+Z"
            >
              Undo
            </Button>
            <Button
              icon="redo"
              collapse
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Shift+Ctrl/Cmd+Z or Ctrl+Y)"
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
            >
              Redo
            </Button>
            <Button
              icon="import"
              collapse
              onClick={() => openImport()}
              aria-haspopup="dialog"
              title="Import a CSS linear-gradient (or paste one anywhere)"
            >
              Import CSS
            </Button>
            <FlashButton
              icon="link"
              label="Copy link"
              collapse
              title="Copy a link that reopens this gradient"
              okLabel="Link copied"
              errLabel="Copy failed"
              okMessage="Link copied to clipboard"
              errMessage="Copy failed"
              onRun={() => writeClipboardText(documentLink(doc))}
            />
            <Button
              icon="rotate"
              collapse
              onClick={() => destructive({ type: "reset" }, "Reset to the starting gradient")}
              title="Start over from the default gradient"
            >
              Reset
            </Button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="workspace">
          {/* ── Left column: stage, stops, directions ── */}
          <div className="col-main">
            {/* Sticky stage: preview, then the stop bar fused to its bottom edge */}
            <div className="stage">
              <div className="stage-card">
                <div className="stage-preview">
                  <div
                    className={`gradient-preview${showingSuggested ? " is-suggested" : ""}`}
                    style={gradientStyle}
                    data-view={showingSuggested ? "suggested" : "original"}
                  />
                  {showingSuggested && (
                    <span className="preview-badge" aria-hidden="true">
                      Suggested preview
                    </span>
                  )}
                  {!(tabbed && tab === "score") && (
                    <button
                      type="button"
                      className="score-chip"
                      style={{ "--band": band.color } as React.CSSProperties}
                      title="Show score details"
                      onClick={jumpToScore}
                    >
                      <span className="sr-only">Score </span>
                      <span className="score-chip-value mono">{score}</span>
                      <span className="score-chip-label">{band.label}</span>
                    </button>
                  )}
                </div>
                <div className="stage-bar" role="group" aria-label="Color stops">
                  <StopBar
                    ticks={doc.ticks}
                    selectedId={selectedId}
                    ghosts={showingSuggested ? candidate : null}
                    canAdd={!atStopCap}
                    canRemove={canRemoveStop}
                    onSelect={setSelectedStopId}
                    onMoveTo={(id, position) =>
                      dispatch({ type: "setStopPosition", id, position }, `move:${id}`)
                    }
                    onMoveBy={(id, delta) => dispatch({ type: "moveStop", id, delta }, `move:${id}`)}
                    onCommit={commit}
                    onAddAt={addStopAt}
                    onRemove={(id) => removeStop(id)}
                    onOpen={focusStopEditor}
                  />
                  <IssueLane />
                </div>
              </div>
            </div>

            {/* Stops: the selected one in full, the rest as chips */}
            <div {...panelProps("stops")} className="tab-panel">
              <Surface as="section" aria-labelledby="stops-h" className="stops-panel">
                <div className="panel-head">
                  <h2 className="panel-title" id="stops-h">
                    Stops
                    <span className="panel-count mono">
                      {doc.ticks.length}/{MAX_STOPS}
                    </span>
                  </h2>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="plus"
                    onClick={() => {
                      const id = addStopAt();
                      if (id !== null) setSelectedStopId(id);
                    }}
                    disabled={atStopCap}
                    title={
                      atStopCap ? `Maximum of ${MAX_STOPS} stops reached` : "Add a stop in the widest gap"
                    }
                  >
                    Add stop{atStopCap ? ` (max ${MAX_STOPS})` : ""}
                  </Button>
                </div>
                <p className="panel-hint">Drag a handle to move it. Click or tap the bar to add a stop.</p>
                <div className="stop-list">
                  {sortedTicks.map((tick, i) =>
                    tick.id === selectedId ? (
                      <StopCard
                        key={tick.id}
                        tick={tick}
                        index={i}
                        canRemove={canRemoveStop}
                        notation={notation}
                        onNotation={setNotation}
                        onSelect={() => setSelectedStopId(tick.id)}
                        onColor={(color) =>
                          dispatch({ type: "setStopColor", id: tick.id, color }, `color:${tick.id}`)
                        }
                        onPosition={(position) =>
                          dispatch({ type: "setStopPosition", id: tick.id, position })
                        }
                        onRemove={() => removeStop(tick.id, { focusCard: true })}
                        onComplement={(color) =>
                          destructive(
                            { type: "setStopColor", id: tick.id, color },
                            `Stop ${i + 1} replaced with its complement`,
                          )
                        }
                        onGradientText={(text) => openImport(text, GRADIENT_PASTE_PROMPT)}
                        onDone={commit}
                      />
                    ) : (
                      <StopChip
                        key={tick.id}
                        tick={tick}
                        n={i + 1}
                        canRemove={canRemoveStop}
                        onSelect={() => selectFromChip(tick.id)}
                        onRemove={() => removeStop(tick.id, { focusCard: true })}
                      />
                    ),
                  )}
                </div>
              </Surface>
            </div>

            {/* Directions */}
            <div {...panelProps("directions")} className="tab-panel">
              <DirectionsPanel
                directions={doc.directions}
                blend={doc.blend}
                tabbed={tabbed}
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
          </div>

          {/* ── Right rail: score, refine, export ── */}
          <div className="rail">
            <div {...panelProps("score")} className="tab-panel">
              <ScoreStrip score={score} band={band} />
              <Surface as="section" id="score-details" aria-labelledby="score-h">
                <h2 className="panel-title" id="score-h">
                  Score details
                </h2>
                <p className="scope-note">
                  Scores your color stops only. Directions and blend are not scored.
                </p>
                <ScoreDetails details={details} issues={issues} band={band} />
              </Surface>

              <Surface as="section" aria-labelledby="refine-h">
                <h2 className="panel-title" id="refine-h">
                  Perceptual refinement
                </h2>
                <p className="panel-description">
                  Smooths lightness flow, balances chroma and spaces stops evenly in OKLAB. Exported CSS stays
                  standard sRGB.
                </p>
                {compare && compare.suggestion.useful && (
                  <CompareToggle
                    view={compare.view}
                    onView={(view) => setCompareState({ ...compare, view })}
                  />
                )}
                <SuggestionPanel
                  suggestion={suggestion}
                  selected={compare?.selected ?? new Set()}
                  selectedScore={selectedScore}
                  onSuggest={suggest}
                  onToggle={toggleSelected}
                  onApplySelected={() => applySuggestion(false)}
                  onApplyAll={() => applySuggestion(true)}
                />
              </Surface>
            </div>

            <div {...panelProps("export")} className="tab-panel">
              <Surface as="section" aria-labelledby="export-h" className="export-panel">
                <div className="panel-head">
                  <h2 className="panel-title" id="export-h">
                    {showingSuggested ? "Suggested CSS" : "Export CSS"}
                  </h2>
                  <FlashButton
                    icon="copy"
                    label="Copy CSS"
                    variant="primary"
                    size="sm"
                    title="Copy the CSS to the clipboard"
                    okLabel="Copied"
                    errLabel="Copy failed"
                    okMessage="CSS copied to clipboard"
                    errMessage="Copy failed"
                    onRun={() => writeClipboardText(exportText)}
                  />
                </div>
                <pre
                  className="export-code"
                  tabIndex={0}
                  aria-label={showingSuggested ? "Suggested CSS" : "Export CSS"}
                >
                  {exportLines.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </pre>
                <p className="export-note">
                  Standard CSS: browsers interpolate between stops in sRGB, not OKLAB.
                  {showingSuggested &&
                    " This is the suggested gradient shown in the preview, not yet applied to your stops."}
                </p>
              </Surface>
            </div>
          </div>
        </main>

        {/* Theory note + footer */}
        <footer className="studio-footer">
          <details className="theory-note">
            <summary className="disclosure-summary theory-summary">
              <Icon name="chevron" size={14} className="disclosure-chevron" />
              How does this work?
            </summary>
            <p>
              <span className="accent-strong">Scoring: </span>
              Lightness flow (30pts) penalizes reversals, H-K brightness wobble &amp; uneven perceptual speed.
              Hue arc (30pts) rewards arcs &lt;120° and consistent hue direction. Chroma balance (20pts)
              penalizes saturation spikes, midpoint desaturation &amp; banding risk. Stop rhythm (20pts)
              penalizes uneven clustering. Suggestion nudges colors toward perceptual harmony via{" "}
              <span className="accent">OKLAB→LCH</span> smoothing.
            </p>
            <p>
              <span className="accent-strong">Multi-angle: </span>
              up to {MAX_DIRECTIONS} directions project the same stops as stacked layers. In{" "}
              <span className="accent">average</span> mode each layer&rsquo;s alpha is set to{" "}
              <span className="accent">wₖ / (w₁+…+wₖ)</span>, so the result is the exact weighted mean of
              every direction; other modes hand the layers to{" "}
              <span className="accent">background-blend-mode</span> with alpha scaled against the heaviest
              direction.
            </p>
            <p>
              <span className="accent-strong">Complements: </span>
              the opposite <span className="accent">OKLCH</span> hue at matched lightness and chroma,
              gamut-mapped by reducing chroma so the hue never drifts.
            </p>
            <p>
              <span className="accent-strong">Your work: </span>
              the gradient is kept in the page address (share it with Copy link) and autosaved in this
              browser. Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z or Ctrl+Y redoes (text fields keep their own undo).
              Paste a CSS linear-gradient anywhere outside a text field to import it.
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

      {tabbed && (
        <MobileTabBar active={tab} onChange={changeTab} issueCount={issues.length} badgeColor={band.color} />
      )}

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
