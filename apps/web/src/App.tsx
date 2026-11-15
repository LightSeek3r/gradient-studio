import { useState, useCallback, useRef, useEffect } from "react";
import {
  scoreGradient,
  suggestGradient,
  buildGradientCSS,
  buildMultiGradientStyle,
  colorAtPosition,
  rgbToHex,
  CSS_COLOR_NAMES,
  CSS_NAMED_COLORS,
  MAX_DIRECTIONS,
  type GradientBlendMode,
  type GradientDirection,
  type GradientTick,
} from "@opal42/gradient";
import { COLOR_NAME_LIST_ID, StopCard } from "./components/StopCard";
import { DirectionsPanel } from "./components/DirectionsPanel";
import { CopyButton, FlashButton } from "./components/fields";
import { writeClipboardText } from "./clipboard";
import { StatusRegion } from "./components/StatusRegion";
import { scoreBand } from "./score-band";
import "./App.css";

/** Hard ceiling on colour stops. */
const MAX_STOPS = 10;
const GITHUB_URL = "https://github.com/LightSeek3r/gradient-studio";

// ── CSS export ────────────────────────────────────────────────────────────────

/** Blend-mode lists that are all "normal" are the CSS default — skip the line. */
function isDefaultBlend(mode: string): boolean {
  return mode.split(", ").every((m) => m === "normal");
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/** `rgba(r, g, b, 1)` is just a verbose `#rrggbb` - emit the short form. */
function opaqueRgbaToHex(css: string): string {
  return css.replace(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*1\s*\)/g, (_m, r, g, b) =>
    rgbToHex({ r: +r, g: +g, b: +b }),
  );
}

/**
 * Copy-paste-ready CSS declarations for the current gradient, one colour stop
 * per line so long multi-layer values stay readable (and wrap) on any width.
 */
function buildExportLines(style: { background: string; backgroundBlendMode: string }): string[] {
  const layers = splitTopLevel(opaqueRgbaToHex(style.background));
  const lines: string[] = [];

  if (!layers.every((l) => /^linear-gradient\(/.test(l))) {
    lines.push(`background: ${layers.join(", ")};`);
  } else if (layers.length === 1) {
    const [angle, ...stops] = splitTopLevel(layers[0].slice("linear-gradient(".length, -1));
    lines.push(`background: linear-gradient(${angle},`);
    stops.forEach((stop, i) => lines.push(`  ${stop}${i === stops.length - 1 ? ");" : ","}`));
  } else {
    lines.push("background:");
    layers.forEach((layer, li) => {
      const [angle, ...stops] = splitTopLevel(layer.slice("linear-gradient(".length, -1));
      const lastLayer = li === layers.length - 1;
      lines.push(`  linear-gradient(${angle},`);
      stops.forEach((stop, i) => {
        const end = i === stops.length - 1 ? (lastLayer ? ");" : "),") : ",";
        lines.push(`    ${stop}${end}`);
      });
    });
  }

  if (!isDefaultBlend(style.backgroundBlendMode)) {
    lines.push(`background-blend-mode: ${style.backgroundBlendMode};`);
  }
  return lines;
}

/** Same stops, same colours, same order. */
function sameStops(a: GradientTick[], b: GradientTick[]): boolean {
  return a.length === b.length && a.every((t, i) => t.color === b[i].color && t.position === b[i].position);
}

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

// ── Factories ─────────────────────────────────────────────────────────────────

let idCounter = 0;
function mkTick(color: string, position: number): GradientTick {
  return { id: ++idCounter, color, position };
}

let dirCounter = 0;
function mkDirection(angle: number, weight = 100): GradientDirection {
  return { id: ++dirCounter, angle, weight, enabled: true };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function App() {
  const [ticks, setTicks] = useState<GradientTick[]>([
    mkTick("#101b45", 0), // space navy
    mkTick("#3f1d63", 50), // royal purple
    mkTick("#9333ea", 100), // nebula violet
  ]);
  const [directions, setDirections] = useState<GradientDirection[]>([mkDirection(135)]);
  const [blend, setBlend] = useState<GradientBlendMode>("normal");
  const [dragging, setDragging] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<GradientTick[] | null>(null);
  const [showSuggested, setShowSuggested] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const activeTicks = showSuggested && suggested ? suggested : ticks;
  const { score, issues, details } = scoreGradient(activeTicks);
  const gradientStyle = buildMultiGradientStyle(activeTicks, directions, blend);
  // The stop bar is a stop editor, not a preview — always read left-to-right.
  const barCSS = buildGradientCSS(ticks, 90);

  const sortedTicks = [...ticks].sort((a, b) => a.position - b.position);

  const band = scoreBand(score);
  const atStopCap = ticks.length >= MAX_STOPS;
  const showingSuggested = showSuggested && suggested !== null;
  // Suggest is deterministic: if re-running it would reproduce the current
  // suggestion, say so rather than offering a button that does nothing.
  const suggestionIsCurrent = suggested !== null && sameStops(suggested, suggestGradient(ticks));
  const exportLines = buildExportLines(gradientStyle);
  const exportText = exportLines.join("\n");

  // Screen-reader summary of the live score, debounced so dragging a handle
  // doesn't produce a flood of announcements.
  const scoreSummary = `Score ${score}, ${band.label}, ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`;
  const [announcedScore, setAnnouncedScore] = useState(scoreSummary);
  useEffect(() => {
    const t = setTimeout(() => setAnnouncedScore(scoreSummary), 700);
    return () => clearTimeout(t);
  }, [scoreSummary]);

  const generate = () => {
    const s = suggestGradient(ticks);
    setSuggested(s);
    setShowSuggested(true);
  };

  const addTick = useCallback(() => {
    if (ticks.length >= MAX_STOPS) return;
    const sorted = [...ticks.map((t) => t.position)].sort((a, b) => a - b);
    let bestPos = 50;
    let bestGap = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > bestGap) {
        bestGap = gap;
        bestPos = Math.round((sorted[i] + sorted[i + 1]) / 2);
      }
    }
    // Sample the gradient where the stop lands so adding one doesn't change the look.
    setTicks((prev) => [...prev, mkTick(colorAtPosition(ticks, bestPos), bestPos)]);
    setShowSuggested(false);
    setSuggested(null);
  }, [ticks]);

  const removeTick = (id: number) => {
    if (ticks.length <= 2) return;
    setTicks((prev) => prev.filter((t) => t.id !== id));
    setShowSuggested(false);
    setSuggested(null);
  };

  const updateColor = (id: number, color: string) => {
    setTicks((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
    setShowSuggested(false);
    setSuggested(null);
  };

  const updatePosition = (id: number, position: number) => {
    setTicks((prev) => prev.map((t) => (t.id === id ? { ...t, position } : t)));
    setShowSuggested(false);
    setSuggested(null);
  };

  const handleBarMouseDown = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    setDragging(id);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging || !barRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const pos = Math.round(x * 100);
      setTicks((prev) => prev.map((t) => (t.id === dragging ? { ...t, position: pos } : t)));
      setShowSuggested(false);
      setSuggested(null);
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

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
          <div className="studio-score-chip" style={{ borderColor: scoreColor }} title="Live quality score">
            <span className="studio-score-chip-value" style={{ color: scoreColor }}>
              {score}
            </span>
            <span className="studio-score-chip-label" style={{ color: scoreColor }}>
              {scoreLabel}
            </span>
          </div>
        </header>

        <main id="main" tabIndex={-1}>
        {/* Preview */}
        <div className="gradient-preview" style={gradientStyle} />

        {/* Controls surface — connects directly to preview */}
        <div className="controls-surface">
          {/* Tick bar */}
          <section className="tick-bar-section">
            <div className="section-label">Color Stops — drag to reposition</div>
            <div ref={barRef} className="tick-bar" style={{ background: barCSS }}>
              {sortedTicks.map((tick) => (
                <div
                  key={tick.id}
                  className="tick-handle"
                  onMouseDown={(e) => handleBarMouseDown(e, tick.id)}
                  style={{
                    left: `${tick.position}%`,
                    background: tick.color,
                  }}
                />
              ))}
            </div>
          </section>

          {/* Stop editors — every notation, always visible */}
          <div className="stop-list">
            {sortedTicks.map((tick, i) => (
              <StopCard
                key={tick.id}
                tick={tick}
                index={i}
                canRemove={ticks.length > 2}
                onColor={(hex) => updateColor(tick.id, hex)}
                onPosition={(pos) => updatePosition(tick.id, pos)}
                onRemove={() => removeTick(tick.id)}
              />
            ))}
            <button
              className="btn btn-add btn-add-stop"
              onClick={addTick}
              disabled={atStopCap}
              title={atStopCap ? `Maximum of ${MAX_STOPS} stops reached` : "Add a stop in the widest gap"}
            >
              + Add stop{atStopCap ? ` (max ${MAX_STOPS})` : ""}
            </button>
          </div>

          {/* Directions */}
          <DirectionsPanel
            directions={directions}
            blend={blend}
            onDirections={setDirections}
            onBlend={setBlend}
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
            {showingSuggested && " This is the suggested gradient, not the stops shown above."}
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
              Scores the color stops only — directions and blend are not scored.
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

            {suggested && (
              <div
                className="suggestion-preview"
                style={buildMultiGradientStyle(suggested, directions, blend)}
              />
            )}

            <div className="btn-row">
              {suggestionIsCurrent ? (
                <p className="suggest-note" title="Suggest is deterministic: running it again on these stops gives the same result">
                  Suggestion is up to date for these stops
                </p>
              ) : (
                <button className="btn btn-primary" onClick={generate}>
                  {suggested ? "↻ Re-suggest" : "✦ Suggest"}
                </button>
              )}
              {suggested && (
                <button
                  className="btn btn-apply"
                  onClick={() => {
                    setTicks(suggested.map((t) => ({ ...t, id: ++idCounter })));
                    setSuggested(null);
                    setShowSuggested(false);
                  }}
                >
                  Apply →
                </button>
              )}
            </div>

            {suggested && (
              <div className="btn-row toggle-row">
                <button
                  className={`btn btn-toggle ${!showSuggested ? "active" : ""}`}
                  aria-pressed={!showSuggested}
                  onClick={() => setShowSuggested(false)}
                >
                  Original
                </button>
                <button
                  className={`btn btn-toggle ${showSuggested ? "active" : ""}`}
                  aria-pressed={showSuggested}
                  onClick={() => setShowSuggested(true)}
                >
                  Suggested
                </button>
              </div>
            )}
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
    </div>
  );
}
