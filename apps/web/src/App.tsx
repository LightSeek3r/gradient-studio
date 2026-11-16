import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  scoreGradient,
  proposeFixes,
  buildMultiGradientStyle,
  buildGradientCSS,
  CSS_COLOR_NAMES,
  CSS_NAMED_COLORS,
  MAX_DIRECTIONS,
} from "@opal42/gradient";
import { COLOR_NAME_LIST_ID, StopCard, type Notation } from "./components/StopCard";
import { StopChip } from "./components/StopChip";
import { ledgerToggleId, stopCardId } from "./components/dom-ids";
import { DirectionsPanel } from "./components/DirectionsPanel";
import { FlashButton } from "./components/fields";
import { StopBar } from "./components/StopBar";
import { IssueLane } from "./components/IssueLane";
import { MobileTabBar } from "./components/MobileTabBar";
import {
  DeltaBadge,
  ScoreLedger,
  ScoreStrip,
  type FixOffer,
  type FixPreviewState,
} from "./components/ScorePanel";
import { Curves } from "./components/Curves";
import { Examples } from "./components/Examples";
import { Toast } from "./components/Toast";
import { ImportDialog } from "./components/ImportDialog";
import { CompareToggle, SuggestionPanel, type CompareView } from "./components/SuggestionCompare";
import { StatusRegion } from "./components/StatusRegion";
import { Button } from "./components/ui/Button";
import { Icon } from "./components/ui/Icon";
import { Surface } from "./components/ui/Surface";
import { writeClipboardText } from "./clipboard";
import { announce } from "./announce";
import { formatDelta, scoreBand } from "./score-band";
import { buildLedger } from "./explain/ledger";
import { ruleText } from "./explain/explain";
import { exampleDocument, findExample } from "./examples";
import { issueHash } from "./persist/issue-link";
import { useScoreDelta } from "./hooks/useScoreDelta";
import { ExportPanel } from "./components/ExportPanel";
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
} from "./import/adapter";
import { importedToDocument, importSummary } from "./import/to-document";
import { wantsImportDialog, withoutLaunchAction } from "./import/launch";
import { registerServiceWorker } from "./sw/register";
import { candidateTicks, computeSuggestion, declineReason, type Suggestion } from "./suggest/compare";
import { useI18n } from "./i18n/context";
import { LanguageSwitcher } from "./i18n/LanguageSwitcher";
import { renderRich } from "./i18n/rich";
import { fixLabel } from "./explain/fix-label";
import { V1_MODEL } from "@opal42/gradient";
import "./App.css";

const GITHUB_URL = "https://github.com/LightSeek3r/gradient-studio";
const GITHUB_LABEL = "GitHub";
const version = `v${__APP_VERSION__}`;
/** Emphasised words inside the footer sentences (`<accent>…</accent>` in the catalogue). */
const accent = { accent: (c: string) => <span className="accent">{c}</span> };

/** A suggestion, the document it was computed for, and the compare UI state. */
interface CompareState {
  doc: GradientDocument;
  suggestion: Suggestion;
  selected: ReadonlySet<number>;
  view: CompareView;
}

/** A fix preview is only live for the document it was requested on. */
interface FixPreview extends FixPreviewState {
  doc: GradientDocument;
}

interface ImportDialogState {
  text: string;
  intro?: string;
  key: number;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function App() {
  const i18n = useI18n();
  const { t, linkLang } = i18n;
  const [initial] = useState(loadInitialDocument);
  const store = useGradientDocument(() => initial.document);
  const { doc, dispatch, commit, canUndo, canRedo } = store;
  const { toast, show: showToast, dismiss: dismissToast, setPaused: pauseToast } = useToast();

  // Offline support: when a new version is waiting, offer it without interrupting.
  // Registered once; the toast is worded with the language that is active when the update arrives.
  const latest = useRef({ showToast, t });
  useEffect(() => {
    latest.current = { showToast, t };
  });
  useEffect(() => {
    registerServiceWorker((update) =>
      latest.current.showToast({
        message: latest.current.t("toast.updateAvailable"),
        action: { label: latest.current.t("toast.reload"), run: update.reload },
        sticky: true,
      }),
    );
  }, []);

  const tabbed = useMediaQuery(MOBILE_QUERY);
  const [tab, setTab] = useState<TabId>(DEFAULT_TAB);
  const [notation, setNotation] = useState<Notation>("hex");
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null);
  const [compareState, setCompareState] = useState<CompareState | null>(null);
  // The installed app's "Import CSS" shortcut launches with ?action=import.
  const [importDialog, setImportDialog] = useState<ImportDialogState | null>(() =>
    wantsImportDialog(window.location.search) ? { text: "", key: 1 } : null,
  );
  useEffect(() => {
    if (wantsImportDialog(window.location.search)) window.history.replaceState(null, "", withoutLaunchAction(window.location.href));
  }, []);
  // Explainability UI state: which ledger rows the user opened or closed, the
  // issue highlighted in both the lane and the ledger, and the fix on preview.
  const [ledgerOpen, setLedgerOpen] = useState<Record<string, boolean>>(() =>
    initial.issue ? { [initial.issue]: true } : {},
  );
  // The worst row opens by itself, except when a rule was asked for by link.
  const [autoOpenWorst, setAutoOpenWorst] = useState(!initial.issue);
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const [fixPreviewState, setFixPreviewState] = useState<FixPreview | null>(null);
  const [curvesOpen, setCurvesOpen] = useState(true);

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

  const scored = useMemo(() => scoreGradient(doc.ticks), [doc.ticks]);
  const { score, issues } = scored;
  const ledger = useMemo(() => buildLedger(scored.findings, scored.score, t), [scored, t]);
  // Targeted fixes, one per finding at most (core `proposeFixes`).
  const fixes = useMemo(() => proposeFixes(doc.ticks), [doc.ticks]);
  const fixOffers = useMemo(
    () => new Map<string, FixOffer>(fixes.map((f) => [f.code, { gain: f.gain, label: fixLabel(f, doc.ticks, i18n) }])),
    [fixes, doc.ticks, i18n],
  );
  const fixPreview = fixPreviewState && fixPreviewState.doc === doc ? fixPreviewState : null;
  const previewFix = fixPreview ? (fixes.find((f) => f.code === fixPreview.code) ?? null) : null;
  const scoreDelta = useScoreDelta(score);
  // Preview and export always show the same thing: the candidate while the
  // suggested view is active, the document otherwise.
  const previewTicks = showingSuggested && candidate ? candidate : doc.ticks;
  const gradientStyle = buildMultiGradientStyle(previewTicks, doc.directions, doc.blend);
  const selectedScore = candidate ? scoreGradient(candidate).score : null;

  const band = scoreBand(score, t);
  const atStopCap = doc.ticks.length >= MAX_STOPS;
  const canRemoveStop = doc.ticks.length > MIN_STOPS;

  // Screen-reader summary of the live score, debounced so dragging a handle
  // doesn't produce a flood of announcements.
  const scoreSummary = t("announce.scoreSummary", { score, band: band.label, issues: issues.length });
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
    announce(t("toast.undone"));
  }, [store, dismissToast, t]);
  const redo = useCallback(() => {
    if (!store.canRedo) return;
    store.redo();
    dismissToast();
    announce(t("toast.redone"));
  }, [store, dismissToast, t]);

  /** Apply a destructive edit and offer Undo for it. */
  const destructive = (action: Parameters<typeof dispatch>[0], message: string, details?: string[]) => {
    dispatch(action);
    showToast({ message, details, undo: true });
  };

  // ── Import ──
  const importGradient = (gradient: ImportedGradient, warnings: string[]) => {
    destructive(
      { type: "import", document: importedToDocument(gradient) },
      importSummary(gradient, t),
      warnings,
    );
    setImportDialog(null);
    setSelectedStopId(null);
  };

  const openImport = (text = "", intro?: string) =>
    setImportDialog((prev) => ({ text, intro, key: (prev?.key ?? 0) + 1 }));

  const importText = (text: string) => {
    const result = parseLinearGradient(text, t);
    if (result.ok) importGradient(result.gradient, result.warnings);
    else showToast({ message: t("toast.notImported", { error: result.error }), details: result.warnings, tone: "error" });
  };

  useGlobalShortcuts({
    undo,
    redo,
    enabled: importDialog === null,
    onPaste: (text) => {
      if (looksLikeGradient(text)) importText(text);
      else
        showToast({
          message: t("toast.clipboardNotGradient"),
          tone: "error",
        });
    },
  });

  // ── Issues: lane <-> ledger, examples, fixes ──
  const isLedgerOpen = (code: string) => ledgerOpen[code] ?? (autoOpenWorst && code === ledger.rows[0]?.code);
  const highlighted = activeIssue ?? fixPreview?.code ?? null;
  const highlightedRow = highlighted ? ledger.rows.find((r) => r.code === highlighted) : undefined;
  const flaggedStops = useMemo(() => {
    const ids = new Set<number>();
    if (!highlightedRow) return ids;
    const sorted = sortTicks(doc.ticks);
    for (const i of highlightedRow.stops ?? []) if (sorted[i]) ids.add(sorted[i].id);
    const seg = highlightedRow.segment;
    if (seg) for (const t of sorted) if (t.position >= seg[0] && t.position <= seg[1]) ids.add(t.id);
    return ids;
  }, [highlightedRow, doc.ticks]);

  const focusLedgerRow = (code: string) => {
    // Two frames: the tab panel (mobile) and the row body must be rendered first.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(ledgerToggleId(code));
        el?.scrollIntoView({ block: "nearest" });
        el?.focus({ preventScroll: true });
      }),
    );
  };

  /** Lane marker activated: open that issue's ledger row and go to it. */
  const openIssue = (code: string) => {
    setLedgerOpen((prev) => ({ ...prev, [code]: true }));
    if (tabbed) setTab("score");
    focusLedgerRow(code);
  };

  /** An issue permalink or an Examples entry: load the rule's example and open its row. */
  const loadExample = (code: string, opts: { setHash?: boolean } = {}) => {
    const example = findExample(code);
    if (!example) return;
    destructive(
      { type: "import", document: exampleDocument(example) },
      t("toast.exampleLoaded", { name: ruleText(code, t).name }),
    );
    setSelectedStopId(null);
    setLedgerOpen({ [code]: true });
    setAutoOpenWorst(false);
    if (opts.setHash) {
      try {
        window.history.replaceState(window.history.state, "", issueHash(code, linkLang));
      } catch {
        // Sandboxed frames can refuse replaceState; the example still loads.
      }
    }
    if (tabbed) setTab("score");
    focusLedgerRow(code);
  };

  const applyFix = (code: string) => {
    const fix = fixes.find((f) => f.code === code);
    if (!fix || fix.after.status !== "ok") return;
    setFixPreviewState(null);
    setActiveIssue(null);
    destructive(
      { type: "applySuggestion", ticks: fix.document },
      t("toast.fixApplied", { label: fixLabel(fix, doc.ticks, i18n), before: score, after: fix.after.score }),
    );
    // The fixed row is gone; keep keyboard focus in the ledger.
    requestAnimationFrame(() => document.getElementById("score-ledger")?.focus({ preventScroll: true }));
  };

  usePersistence(
    doc,
    (linked) => {
      destructive({ type: "import", document: linked }, t("toast.linkLoaded"));
    },
    (code) => loadExample(code),
    linkLang,
  );

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
    destructive({ type: "removeStop", id }, t("toast.stopRemoved", { n: stopNumber(id) }));
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
        ? t("announce.suggestionReady", { before: s.result.before, after: s.result.after })
        : declineReason(s.result, t),
    );
  };

  const applySuggestion = (all: boolean) => {
    if (!compare) return;
    const ticks = all
      ? compare.suggestion.result.stops
      : candidateTicks(compare.suggestion, compare.selected);
    setCompareState(null);
    const after = scoreGradient(ticks).score;
    destructive({ type: "applySuggestion", ticks }, t("toast.suggestionApplied", { before: score, after }));
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
        {t("app.skipToMain")}
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
            <h1 className="studio-title">{t("app.name")}</h1>
            <p className="studio-subtitle">{t("app.subtitle")}</p>
          </div>
          <LanguageSwitcher />
          <div className="header-actions" role="toolbar" aria-label={t("header.toolbar")}>
            <Button
              icon="undo"
              collapse
              onClick={undo}
              disabled={!canUndo}
              title={t("header.undoTitle")}
              aria-keyshortcuts="Control+Z Meta+Z"
            >
              {t("header.undo")}
            </Button>
            <Button
              icon="redo"
              collapse
              onClick={redo}
              disabled={!canRedo}
              title={t("header.redoTitle")}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
            >
              {t("header.redo")}
            </Button>
            <Button
              icon="import"
              collapse
              onClick={() => openImport()}
              aria-haspopup="dialog"
              title={t("header.importTitle")}
            >
              {t("header.import")}
            </Button>
            <FlashButton
              icon="link"
              label={t("header.copyLink")}
              collapse
              title={t("header.copyLinkTitle")}
              okLabel={t("header.linkCopied")}
              errLabel={t("common.copyFailed")}
              okMessage={t("header.linkCopiedSr")}
              errMessage={t("common.copyFailed")}
              onRun={() => writeClipboardText(documentLink(doc, linkLang))}
            />
            <Button
              icon="rotate"
              collapse
              onClick={() => destructive({ type: "reset" }, t("toast.reset"))}
              title={t("header.resetTitle")}
            >
              {t("header.reset")}
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
                  {previewFix && (
                    <>
                      {/* Split preview: the lower half shows the gradient with the fix applied. */}
                      <div
                        className="gradient-preview fix-preview-layer"
                        style={buildMultiGradientStyle(previewFix.document, doc.directions, doc.blend)}
                        data-testid="fix-preview"
                        aria-hidden="true"
                      />
                      <span className="split-divider" aria-hidden="true" />
                      <span className="split-label split-label--now" aria-hidden="true">
                        {t("stage.now")}
                      </span>
                      <span className="split-label split-label--fix" aria-hidden="true">
                        {t("stage.withFix")} <span className="mono">+{previewFix.gain}</span>
                      </span>
                    </>
                  )}
                  {showingSuggested && !previewFix && (
                    <span className="preview-badge" aria-hidden="true">
                      {t("stage.suggestedPreview")}
                    </span>
                  )}
                  {!(tabbed && tab === "score") && (
                    <button
                      type="button"
                      className="score-chip"
                      style={{ "--band": band.color } as React.CSSProperties}
                      title={t("stage.scoreChipTitle")}
                      onClick={jumpToScore}
                    >
                      <span className="sr-only">{t("stage.scoreWord")} </span>
                      <span className="score-chip-value mono">{score}</span>
                      <DeltaBadge delta={scoreDelta.delta} />
                      <span className="score-chip-label">{band.label}</span>
                    </button>
                  )}
                </div>
                <div className="stage-bar" role="group" aria-label={t("stage.stopsGroup")}>
                  <StopBar
                    ticks={doc.ticks}
                    selectedId={selectedId}
                    ghosts={
                      previewFix
                        ? previewFix.changedStops.map((i) => previewFix.document[i])
                        : showingSuggested
                          ? candidate
                          : null
                    }
                    ghostKind={previewFix ? "fix" : "suggestion"}
                    flagged={flaggedStops}
                    badge={
                      scoreDelta.delta !== null && scoreDelta.stopId !== null
                        ? {
                            id: scoreDelta.stopId,
                            text: formatDelta(scoreDelta.delta),
                            dir: scoreDelta.delta > 0 ? "up" : scoreDelta.delta < 0 ? "down" : "same",
                          }
                        : null
                    }
                    canAdd={!atStopCap}
                    canRemove={canRemoveStop}
                    onSelect={setSelectedStopId}
                    onMoveTo={(id, position) => {
                      scoreDelta.begin(id);
                      dispatch({ type: "setStopPosition", id, position }, `move:${id}`);
                    }}
                    onMoveBy={(id, delta) => {
                      scoreDelta.begin(id);
                      dispatch({ type: "moveStop", id, delta }, `move:${id}`);
                    }}
                    onCommit={() => {
                      commit();
                      scoreDelta.end();
                    }}
                    onAddAt={addStopAt}
                    onRemove={(id) => removeStop(id)}
                    onOpen={focusStopEditor}
                  />
                  <IssueLane
                    rows={ledger.rows}
                    positions={sortedTicks.map((t) => t.position)}
                    active={highlighted}
                    onActive={setActiveIssue}
                    onOpen={openIssue}
                    interactive={!tabbed}
                  />
                </div>
              </div>
            </div>

            {/* Curves share the stop bar's x-axis (desktop); on mobile they live in the Score tab. */}
            {!tabbed && (
              <Curves
                ticks={doc.ticks}
                rows={ledger.rows}
                active={highlighted}
                open={curvesOpen}
                onToggle={setCurvesOpen}
                placement="stage"
              />
            )}

            {/* Stops: the selected one in full, the rest as chips */}
            <div {...panelProps("stops")} className="tab-panel">
              <Surface as="section" aria-labelledby="stops-h" className="stops-panel">
                <div className="panel-head">
                  <h2 className="panel-title" id="stops-h">
                    {t("stops.title")}
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
                    title={atStopCap ? t("stops.maxTitle", { max: MAX_STOPS }) : t("stops.addTitle")}
                  >
                    {atStopCap ? t("stops.addAtMax", { max: MAX_STOPS }) : t("stops.add")}
                  </Button>
                </div>
                <p className="panel-hint">{t("stops.hint")}</p>
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
                        onColor={(color) => {
                          scoreDelta.begin(tick.id);
                          dispatch({ type: "setStopColor", id: tick.id, color }, `color:${tick.id}`);
                        }}
                        onPosition={(position) =>
                          dispatch({ type: "setStopPosition", id: tick.id, position })
                        }
                        onRemove={() => removeStop(tick.id, { focusCard: true })}
                        onComplement={(color) =>
                          destructive(
                            { type: "setStopColor", id: tick.id, color },
                            t("toast.complementApplied", { n: i + 1 }),
                          )
                        }
                        onGradientText={(text) => openImport(text, t("import.intro"))}
                        onDone={() => {
                          commit();
                          scoreDelta.end();
                        }}
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
                    t("toast.directionCount", { count, removed: count < doc.directions.length ? "yes" : "no" }),
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
              <ScoreStrip score={score} band={band} delta={scoreDelta.delta} />
              <Surface as="section" id="score-details" aria-labelledby="score-h">
                <h2 className="panel-title" id="score-h">
                  {t("score.heading")}
                </h2>
                <p className="scope-note">{t("score.scope")}</p>
                <ScoreLedger
                  ledger={ledger}
                  fixes={fixOffers}
                  isOpen={isLedgerOpen}
                  onToggle={(code, open) => setLedgerOpen((prev) => ({ ...prev, [code]: open }))}
                  active={highlighted}
                  onActive={setActiveIssue}
                  preview={fixPreview}
                  onPreview={(next) => setFixPreviewState(next ? { ...next, doc } : null)}
                  onApplyFix={applyFix}
                  previewStrip={
                    previewFix
                      ? { now: buildGradientCSS(doc.ticks, 90), fixed: buildGradientCSS(previewFix.document, 90) }
                      : null
                  }
                />
                <Examples onOpen={(code) => loadExample(code, { setHash: true })} />
              </Surface>

              {tabbed && (
                <Surface as="section" aria-label={t("curves.title")}>
                  <Curves
                    ticks={doc.ticks}
                    rows={ledger.rows}
                    active={highlighted}
                    open={curvesOpen}
                    onToggle={setCurvesOpen}
                    placement="panel"
                  />
                </Surface>
              )}

              <Surface as="section" aria-labelledby="refine-h">
                <h2 className="panel-title" id="refine-h">
                  {t("score.refineHeading")}
                </h2>
                <p className="panel-description">{t("score.refineDescription")}</p>
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
              <ExportPanel
                ticks={previewTicks}
                directions={doc.directions}
                blend={doc.blend}
                style={gradientStyle}
                showingSuggested={showingSuggested}
              />
            </div>
          </div>
        </main>

        {/* Theory note + footer */}
        <footer className="studio-footer">
          <details className="theory-note">
            <summary className="disclosure-summary theory-summary">
              <Icon name="chevron" size={14} className="disclosure-chevron" />
              {t("footer.theory")}
            </summary>
            <p>
              <span className="accent-strong">{t("footer.scoringLabel")}</span>
              {renderRich(t("footer.scoring", V1_MODEL.weights), accent)}
            </p>
            <p>
              <span className="accent-strong">{t("footer.multiLabel")}</span>
              {renderRich(t("footer.multi", { max: MAX_DIRECTIONS }), accent)}
            </p>
            <p>
              <span className="accent-strong">{t("footer.complementsLabel")}</span>
              {renderRich(t("footer.complements"), accent)}
            </p>
            <p>
              <span className="accent-strong">{t("footer.workLabel")}</span>
              {t("footer.work")}
            </p>
          </details>
          <p className="footer-line">
            {t("footer.local")}
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            {version}
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              {GITHUB_LABEL}
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
