import { useRef, useState } from "react";
import {
  MAX_DIRECTIONS,
  type GradientBlendMode,
  type GradientDirection,
} from "@opal42/gradient";

/** Per-direction identity colors for the compass and row markers. */
const DIRECTION_COLORS = [
  "#7c85ff",
  "#3dd68c",
  "#e8c84a",
  "#f06060",
  "#e879f9",
  "#38bdf8",
  "#fb923c",
];

const BLEND_MODES: { value: GradientBlendMode; label: string }[] = [
  { value: "normal", label: "Average (weighted)" },
  { value: "screen", label: "Screen — additive glow" },
  { value: "multiply", label: "Multiply — deepen" },
  { value: "overlay", label: "Overlay — contrast" },
  { value: "soft-light", label: "Soft light — subtle" },
  { value: "hard-light", label: "Hard light — punchy" },
  { value: "lighten", label: "Lighten — max" },
  { value: "darken", label: "Darken — min" },
  { value: "difference", label: "Difference — invert" },
];

const COMPASS_RADIUS = 62;

/** CSS angle (0 = to top, clockwise) → unit vector in screen coordinates. */
function angleToVector(angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

// ── Compass ───────────────────────────────────────────────────────────────────

/**
 * Shows every active direction as a spoke and lets each be dragged (pointer
 * events with capture: mouse, pen and touch) or turned with the keyboard
 * (each handle is an ARIA slider). Reading seven angles as numbers is hard;
 * reading them as a fan is immediate.
 */
function Compass({
  directions,
  onAngle,
  onCommit,
}: {
  directions: GradientDirection[];
  onAngle: (id: number, angle: number) => void;
  onCommit: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const angleFrom = (clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    if (dx === 0 && dy === 0) return null;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
  };

  const onKeyDown = (e: React.KeyboardEvent, d: GradientDirection) => {
    const step = e.shiftKey ? 15 : 1;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = d.angle + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = d.angle - step;
        break;
      case "PageUp":
        next = d.angle + 15;
        break;
      case "PageDown":
        next = d.angle - 15;
        break;
      case "Home":
        next = 0;
        break;
      default:
        return;
    }
    e.preventDefault();
    onAngle(d.id, ((next % 360) + 360) % 360);
  };

  return (
    <svg
      ref={svgRef}
      className="compass"
      viewBox="-90 -90 180 180"
      role="group"
      aria-label="Gradient direction compass"
    >
      <circle className="compass-ring" cx={0} cy={0} r={COMPASS_RADIUS} />
      <circle className="compass-ring compass-ring-inner" cx={0} cy={0} r={COMPASS_RADIUS / 2} />
      <line className="compass-axis" x1={-COMPASS_RADIUS} y1={0} x2={COMPASS_RADIUS} y2={0} />
      <line className="compass-axis" x1={0} y1={-COMPASS_RADIUS} x2={0} y2={COMPASS_RADIUS} />
      <text className="compass-cardinal" x={0} y={-COMPASS_RADIUS - 10} textAnchor="middle" aria-hidden="true">
        0°
      </text>

      {directions.map((d, i) => {
        const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
        const { x, y } = angleToVector(d.angle);
        const reach = COMPASS_RADIUS * (0.45 + 0.55 * (d.weight / 100));
        const dim = !d.enabled;
        return (
          <g
            key={d.id}
            className={`compass-spoke${dim ? " is-off" : ""}${dragId === d.id ? " is-dragging" : ""}`}
          >
            <line
              x1={0}
              y1={0}
              x2={x * reach}
              y2={y * reach}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <circle
              cx={x * reach}
              cy={y * reach}
              r={8}
              fill={color}
              className="compass-handle"
              role="slider"
              tabIndex={0}
              aria-label={`Direction ${i + 1} angle`}
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={d.angle}
              aria-valuetext={`${d.angle} degrees`}
              data-direction-id={d.id}
              onKeyDown={(e) => onKeyDown(e, d)}
              onBlur={onCommit}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  // Synthetic or already-released pointer: drag still works while over the element.
                }
                (e.currentTarget as SVGCircleElement).focus();
                setDragId(d.id);
              }}
              onPointerMove={(e) => {
                if (dragId !== d.id) return;
                const angle = angleFrom(e.clientX, e.clientY);
                if (angle !== null) onAngle(d.id, angle);
              }}
              onPointerUp={(e) => {
                if (dragId !== d.id) return;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                setDragId(null);
                onCommit();
              }}
              onPointerCancel={() => {
                setDragId(null);
                onCommit();
              }}
            />
            <text
              x={x * reach}
              y={y * reach + 3}
              textAnchor="middle"
              className="compass-handle-label"
              aria-hidden="true"
            >
              {i + 1}
            </text>
          </g>
        );
      })}

      <circle className="compass-hub" cx={0} cy={0} r={3} />
    </svg>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export interface DirectionsPanelProps {
  directions: GradientDirection[];
  blend: GradientBlendMode;
  onAngle: (id: number, angle: number) => void;
  onWeight: (id: number, weight: number) => void;
  onEnabled: (id: number, enabled: boolean) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onSpread: () => void;
  /** "Spread: N" preset - changes the count, keeping existing layers. */
  onCount: (count: number) => void;
  onBlend: (next: GradientBlendMode) => void;
  /** A continuous edit (drag, slider, typing) ended. */
  onCommit: () => void;
}

export function DirectionsPanel({
  directions,
  blend,
  onAngle,
  onWeight,
  onEnabled,
  onAdd,
  onRemove,
  onSpread,
  onCount,
  onBlend,
  onCommit,
}: DirectionsPanelProps) {
  const enabledCount = directions.filter((d) => d.enabled).length;

  return (
    <section className="directions">
      <div className="section-label">
        Directions — {directions.length}/{MAX_DIRECTIONS}, drag the compass to aim
      </div>

      <div className="directions-body">
        <Compass directions={directions} onAngle={onAngle} onCommit={onCommit} />

        <div className="directions-rows">
          {directions.map((d, i) => {
            const color = DIRECTION_COLORS[i % DIRECTION_COLORS.length];
            // Never let the last active direction be switched off — there would
            // be nothing left to render.
            const lockEnabled = d.enabled && enabledCount === 1;
            return (
              <div key={d.id} className={`dir-row${d.enabled ? "" : " is-off"}`}>
                <button
                  type="button"
                  className="dir-toggle"
                  style={{ background: d.enabled ? color : "transparent", borderColor: color }}
                  title={
                    lockEnabled
                      ? "At least one direction must stay active"
                      : d.enabled
                        ? "Mute this direction"
                        : "Activate this direction"
                  }
                  aria-pressed={d.enabled}
                  disabled={lockEnabled}
                  onClick={() => onEnabled(d.id, !d.enabled)}
                >
                  {i + 1}
                </button>

                <label className="dir-angle">
                  <input
                    type="number"
                    className="field-input field-num"
                    min={0}
                    max={360}
                    value={d.angle}
                    aria-label={`Direction ${i + 1} angle`}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (e.target.value.trim() !== "" && Number.isFinite(n)) onAngle(d.id, n);
                    }}
                    onBlur={onCommit}
                  />
                  <span className="triple-suffix">°</span>
                </label>

                <input
                  type="range"
                  className="dir-slider"
                  min={0}
                  max={359}
                  value={d.angle}
                  aria-label={`Direction ${i + 1} angle slider`}
                  onChange={(e) => onAngle(d.id, +e.target.value)}
                  onPointerUp={onCommit}
                  onBlur={onCommit}
                />

                <label className="dir-weight">
                  <span className="triple-label">W</span>
                  <input
                    type="range"
                    className="dir-slider dir-slider-weight"
                    min={1}
                    max={100}
                    value={d.weight}
                    aria-label={`Direction ${i + 1} weight`}
                    onChange={(e) => onWeight(d.id, +e.target.value)}
                    onPointerUp={onCommit}
                    onBlur={onCommit}
                  />
                  <span className="dir-weight-value">{d.weight}</span>
                </label>

                {directions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-remove"
                    title="Remove this direction"
                    aria-label={`Remove direction ${i + 1}`}
                    onClick={() => onRemove(d.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          <div className="dir-actions">
            <button
              type="button"
              className="btn btn-add"
              onClick={onAdd}
              disabled={directions.length >= MAX_DIRECTIONS}
            >
              + Direction
            </button>
            <button type="button" className="btn btn-ghost" onClick={onSpread}>
              ⟳ Spread evenly
            </button>
            <div className="dir-presets" role="group" aria-label="Spread: number of evenly-spaced directions">
              <span className="dir-presets-label" aria-hidden="true">
                Spread:
              </span>
              {Array.from({ length: MAX_DIRECTIONS }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn dir-preset${directions.length === n ? " active" : ""}`}
                  title={`Spread: ${n} evenly-spaced direction${n > 1 ? "s" : ""}`}
                  aria-label={`Spread: ${n} direction${n > 1 ? "s" : ""}`}
                  aria-pressed={directions.length === n}
                  onClick={() => onCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Blend only matters once there are layers to blend. */}
          {directions.length > 1 && (
            <label className="dir-blend">
              <span className="triple-label">Blend</span>
              <select
                className="field-input field-select"
                value={blend}
                aria-label="Direction blend mode"
                onChange={(e) => onBlend(e.target.value as GradientBlendMode)}
              >
                {BLEND_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </section>
  );
}
