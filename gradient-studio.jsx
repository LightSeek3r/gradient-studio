import { useState, useCallback, useRef, useEffect } from "react";
import { scoreGradient, suggestGradient, buildGradientCSS } from "./src/gradient-engine";

// ── Score bar component ───────────────────────────────────────────────────────
function ScoreBar({ label, value, max = 30 }) {
  const pct = (value / max) * 100;
  const color = pct >= 75 ? "#4ade80" : pct >= 45 ? "#facc15" : "#f87171";
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, color: "#94a3b8" }}>
        <span>{label}</span><span style={{ color }}>{value}/{max}</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "#1e293b" }}>
        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 2, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
let idCounter = 0;
function mkTick(color, position) { return { id: ++idCounter, color, position }; }

export default function GradientStudio() {
  const [ticks, setTicks] = useState([
    mkTick("#e63946", 0),
    mkTick("#2a9d8f", 50),
    mkTick("#264653", 100),
  ]);
  const [angle, setAngle] = useState(135);
  const [dragging, setDragging] = useState(null);
  const [suggested, setSuggested] = useState(null);
  const [showSuggested, setShowSuggested] = useState(false);
  const barRef = useRef(null);

  const { score, issues, details } = scoreGradient(showSuggested && suggested ? suggested : ticks);
  const gradientCSS = buildGradientCSS(showSuggested && suggested ? suggested : ticks, angle);

  const generate = () => {
    const s = suggestGradient(ticks);
    setSuggested(s);
    setShowSuggested(true);
  };

  const addTick = useCallback(() => {
    const positions = ticks.map(t => t.position);
    // find largest gap
    const sorted = [...positions].sort((a, b) => a - b);
    let bestPos = 50, bestGap = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1] - sorted[i];
      if (gap > bestGap) { bestGap = gap; bestPos = Math.round((sorted[i] + sorted[i + 1]) / 2); }
    }
    setTicks(prev => [...prev, mkTick("#a78bfa", bestPos)]);
    setShowSuggested(false);
  }, [ticks]);

  const removeTick = (id) => {
    if (ticks.length <= 2) return;
    setTicks(prev => prev.filter(t => t.id !== id));
    setShowSuggested(false);
  };

  const updateColor = (id, color) => {
    setTicks(prev => prev.map(t => t.id === id ? { ...t, color } : t));
    setShowSuggested(false);
    setSuggested(null);
  };

  const handleBarMouseDown = (e, id) => {
    e.preventDefault();
    setDragging(id);
  };

  const handleMouseMove = useCallback((e) => {
    if (!dragging || !barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const pos = Math.round(x * 100);
    setTicks(prev => prev.map(t => t.id === dragging ? { ...t, position: pos } : t));
    setShowSuggested(false);
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(null), []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => { window.removeEventListener("mousemove", handleMouseMove); window.removeEventListener("mouseup", handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  const scoreColor = score >= 75 ? "#4ade80" : score >= 50 ? "#facc15" : "#f87171";
  const scoreLabel = score >= 80 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Fair" : "Poor";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1a", color: "#e2e8f0", fontFamily: "'DM Mono', 'Fira Mono', monospace", padding: "32px 24px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700;800&display=swap');
        * { box-sizing: border-box; }
        input[type=color] { -webkit-appearance: none; border: none; width: 36px; height: 28px; border-radius: 4px; cursor: pointer; padding: 0; background: none; }
        input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
        input[type=color]::-webkit-color-swatch { border: none; border-radius: 4px; }
        input[type=range] { -webkit-appearance: none; height: 4px; border-radius: 2px; background: #1e293b; cursor: pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #6366f1; border: 2px solid #0a0f1a; }
        .tick-handle { cursor: ew-resize; transition: transform 0.1s; }
        .tick-handle:hover { transform: scale(1.3); }
        .btn { cursor: pointer; border: none; border-radius: 6px; font-family: inherit; font-size: 12px; font-weight: 500; transition: all 0.2s; }
        .btn:hover { filter: brightness(1.15); }
        .pill { display: inline-flex; align-items: center; gap: 6px; background: #131b2e; border: 1px solid #1e293b; border-radius: 8px; padding: 8px 12px; margin: 4px; }
      `}</style>

      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 4 }}>
            Gradient Studio
          </div>
          <div style={{ color: "#64748b", fontSize: 13 }}>Perceptual quality analysis & one-click refinement</div>
        </div>

        {/* Preview */}
        <div style={{ height: 200, borderRadius: 12, background: gradientCSS, marginBottom: 24, boxShadow: "0 0 60px rgba(0,0,0,0.5)", transition: "background 0.4s ease", border: "1px solid rgba(255,255,255,0.05)" }} />

        {/* Tick bar */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>Color Stops — drag to reposition</div>
          <div ref={barRef} style={{ position: "relative", height: 48, borderRadius: 8, background: gradientCSS, border: "1px solid rgba(255,255,255,0.08)", cursor: "crosshair", userSelect: "none" }}>
            {[...ticks].sort((a, b) => a.position - b.position).map(tick => (
              <div
                key={tick.id}
                className="tick-handle"
                onMouseDown={e => handleBarMouseDown(e, tick.id)}
                style={{
                  position: "absolute", left: `${tick.position}%`, top: "50%", transform: "translate(-50%, -50%)",
                  width: 18, height: 18, borderRadius: "50%", background: tick.color,
                  border: "2.5px solid white", boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                  zIndex: 10,
                }}
              />
            ))}
          </div>
        </div>

        {/* Tick list */}
        <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 20 }}>
          {[...ticks].sort((a, b) => a.position - b.position).map(tick => (
            <div key={tick.id} className="pill">
              <input type="color" value={tick.color} onChange={e => updateColor(tick.id, e.target.value)} />
              <span style={{ fontSize: 12, color: "#64748b", minWidth: 32 }}>{tick.position}%</span>
              {ticks.length > 2 && (
                <button className="btn" onClick={() => removeTick(tick.id)} style={{ background: "none", color: "#475569", fontSize: 14, padding: "0 2px", lineHeight: 1 }}>×</button>
              )}
            </div>
          ))}
          <button className="btn" onClick={addTick} style={{ background: "#131b2e", border: "1px dashed #2d3d5a", color: "#6366f1", padding: "8px 14px", margin: 4, borderRadius: 8 }}>+ Add stop</button>
        </div>

        {/* Angle */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
          <span style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 48 }}>Angle</span>
          <input type="range" min={0} max={360} value={angle} onChange={e => setAngle(+e.target.value)} style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#6366f1", minWidth: 36 }}>{angle}°</span>
        </div>

        {/* Score + Suggestion panel */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Quality score */}
          <div style={{ background: "#0d1424", border: "1px solid #1e293b", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Quality Analysis</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
              <span style={{ fontFamily: "Syne, sans-serif", fontSize: 48, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{score}</span>
              <span style={{ color: "#475569", fontSize: 13 }}>/100</span>
              <span style={{ marginLeft: "auto", background: `${scoreColor}22`, color: scoreColor, fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em" }}>{scoreLabel}</span>
            </div>
            <ScoreBar label="Lightness flow" value={details.lightness ?? 0} max={25} />
            <ScoreBar label="Hue arc" value={details.hue ?? 0} max={25} />
            <ScoreBar label="Chroma balance" value={details.chroma ?? 0} max={15} />
            <ScoreBar label="Midpoint clarity" value={details.midpoint ?? 0} max={20} />
            <ScoreBar label="Stop rhythm" value={details.spacing ?? 0} max={15} />
            {issues.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {issues.map((issue, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                    <span style={{ color: "#f87171", flexShrink: 0 }}>⚠</span>{issue}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Suggestion */}
          <div style={{ background: "#0d1424", border: "1px solid #1e293b", borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Perceptual Refinement</div>
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.6, marginBottom: 16 }}>
              Interpolates your colors through <span style={{ color: "#a5b4fc" }}>OKLAB space</span>, smooths lightness flow, balances chroma, and redistributes stops rhythmically.
            </div>

            {suggested && (
              <div style={{ height: 48, borderRadius: 8, background: buildGradientCSS(suggested, angle), marginBottom: 14, border: "1px solid rgba(255,255,255,0.08)" }} />
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={generate} style={{ flex: 1, background: "#6366f1", color: "white", padding: "10px 0" }}>
                {suggested ? "↻ Re-suggest" : "✦ Suggest"}
              </button>
              {suggested && (
                <button className="btn" onClick={() => { setTicks(suggested.map((t, i) => ({ ...t, id: ++idCounter }))); setSuggested(null); setShowSuggested(false); }}
                  style={{ flex: 1, background: "#0f172a", border: "1px solid #4ade80", color: "#4ade80", padding: "10px 0" }}>
                  Apply →
                </button>
              )}
            </div>

            {suggested && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => setShowSuggested(false)} style={{ flex: 1, background: "none", border: `1px solid ${!showSuggested ? "#6366f1" : "#1e293b"}`, color: !showSuggested ? "#6366f1" : "#475569", padding: "7px 0", fontSize: 11 }}>
                  Original
                </button>
                <button className="btn" onClick={() => setShowSuggested(true)} style={{ flex: 1, background: "none", border: `1px solid ${showSuggested ? "#6366f1" : "#1e293b"}`, color: showSuggested ? "#6366f1" : "#475569", padding: "7px 0", fontSize: 11 }}>
                  Suggested
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Theory note */}
        <div style={{ marginTop: 20, padding: 16, background: "#0d1424", border: "1px solid #1e293b", borderRadius: 10, fontSize: 11, color: "#475569", lineHeight: 1.7 }}>
          <span style={{ color: "#6366f1" }}>How scoring works: </span>
          Lightness flow (30pts) penalizes reversals. Hue arc (30pts) rewards arcs &lt;120°. Chroma balance (20pts) penalizes saturation spikes. Stop rhythm (20pts) penalizes uneven clustering. Suggestion nudges colors toward perceptual harmony via <span style={{ color: "#a5b4fc" }}>OKLAB→LCH</span> smoothing.
        </div>
      </div>
    </div>
  );
}
