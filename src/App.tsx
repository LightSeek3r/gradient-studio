import { useState, useCallback, useRef, useEffect } from "react";
import {
  scoreGradient,
  suggestGradient,
  buildGradientCSS,
  type GradientTick,
} from "./gradient-engine";
import "./App.css";

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = (value / max) * 100;
  const color = pct >= 75 ? "#4ade80" : pct >= 45 ? "#facc15" : "#f87171";
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

// ── Tick factory ──────────────────────────────────────────────────────────────

let idCounter = 0;
function mkTick(color: string, position: number): GradientTick {
  return { id: ++idCounter, color, position };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function App() {
  const [ticks, setTicks] = useState<GradientTick[]>([
    mkTick("#4f46e5", 0),
    mkTick("#a855f7", 50),
    mkTick("#e879f9", 100),
  ]);
  const [angle, setAngle] = useState(135);
  const [dragging, setDragging] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<GradientTick[] | null>(null);
  const [showSuggested, setShowSuggested] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const activeTicks = showSuggested && suggested ? suggested : ticks;
  const { score, issues, details } = scoreGradient(activeTicks);
  const gradientCSS = buildGradientCSS(activeTicks, angle);

  const generate = () => {
    const s = suggestGradient(ticks);
    setSuggested(s);
    setShowSuggested(true);
  };

  const addTick = useCallback(() => {
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
    setTicks((prev) => [...prev, mkTick("#a78bfa", bestPos)]);
    setShowSuggested(false);
  }, [ticks]);

  const removeTick = (id: number) => {
    if (ticks.length <= 2) return;
    setTicks((prev) => prev.filter((t) => t.id !== id));
    setShowSuggested(false);
  };

  const updateColor = (id: number, color: string) => {
    setTicks((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
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

  const scoreColor = score >= 75 ? "#4ade80" : score >= 50 ? "#facc15" : "#f87171";
  const scoreLabel = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Poor";

  return (
    <div className="studio">
      <div className="studio-inner">
        {/* Header */}
        <header className="studio-header">
          <h1
            className="studio-title"
          >
            Gradient Studio
          </h1>
          <p className="studio-subtitle">Perceptual quality analysis &amp; one-click refinement</p>
        </header>

        {/* Preview */}
        <div className="gradient-preview" style={{ background: gradientCSS }} />

        {/* Controls surface — connects directly to preview */}
        <div className="controls-surface">
          {/* Tick bar */}
          <section className="tick-bar-section">
          <div className="section-label">Color Stops — drag to reposition</div>
          <div ref={barRef} className="tick-bar" style={{ background: gradientCSS }}>
            {[...ticks]
              .sort((a, b) => a.position - b.position)
              .map((tick) => (
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

        {/* Tick list */}
        <div className="tick-list">
          {[...ticks]
            .sort((a, b) => a.position - b.position)
            .map((tick) => (
              <div key={tick.id} className="pill">
                <input type="color" value={tick.color} onChange={(e) => updateColor(tick.id, e.target.value)} />
                <span className="pill-position">{tick.position}%</span>
                {ticks.length > 2 && (
                  <button className="btn btn-remove" onClick={() => removeTick(tick.id)}>
                    ×
                  </button>
                )}
              </div>
            ))}
          <button className="btn btn-add" onClick={addTick}>
            + Add stop
          </button>
        </div>

        {/* Angle */}
        <div className="angle-row">
          <span className="section-label">Angle</span>
          <input type="range" min={0} max={360} value={angle} onChange={(e) => setAngle(+e.target.value)} />
          <span className="angle-value">{angle}°</span>
        </div>
        </div>{/* end controls-surface */}

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
              <span className="score-badge" style={{ background: `${scoreColor}22`, color: scoreColor }}>
                {scoreLabel}
              </span>
            </div>
            <ScoreBar label="Lightness flow" value={details.lightness} max={30} />
            <ScoreBar label="Hue arc" value={details.hue} max={30} />
            <ScoreBar label="Chroma balance" value={details.chroma} max={20} />
            <ScoreBar label="Stop rhythm" value={details.spacing} max={20} />
            {issues.length > 0 && (
              <div className="issues">
                {issues.map((issue, i) => (
                  <div key={i} className="issue">
                    <span className="issue-icon">⚠</span>
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
              Interpolates your colors through <span className="accent">OKLAB space</span>, smooths lightness flow,
              balances chroma, and redistributes stops rhythmically.
            </p>

            {suggested && (
              <div
                className="suggestion-preview"
                style={{ background: buildGradientCSS(suggested, angle) }}
              />
            )}

            <div className="btn-row">
              <button className="btn btn-primary" onClick={generate}>
                {suggested ? "↻ Re-suggest" : "✦ Suggest"}
              </button>
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
                  onClick={() => setShowSuggested(false)}
                >
                  Original
                </button>
                <button
                  className={`btn btn-toggle ${showSuggested ? "active" : ""}`}
                  onClick={() => setShowSuggested(true)}
                >
                  Suggested
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Theory note */}
        <footer className="theory-note">
          <span className="accent-strong">How scoring works: </span>
          Lightness flow (30pts) penalizes reversals, H-K brightness wobble &amp; uneven perceptual speed. Hue arc
          (30pts) rewards arcs &lt;120° and consistent hue direction. Chroma balance (20pts) penalizes saturation
          spikes, midpoint desaturation &amp; banding risk. Stop rhythm (20pts) penalizes uneven clustering. Suggestion
          nudges colors toward perceptual harmony via <span className="accent">OKLAB→LCH</span> smoothing.
        </footer>
      </div>
    </div>
  );
}
