import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_DIRECTIONS,
  spreadDirectionAngles,
  type GradientBlendMode,
  type GradientDirection,
} from "../gradient-engine";

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
 * Shows every active direction as a spoke and lets each be dragged. Reading
 * seven angles as numbers is hard; reading them as a fan is immediate.
 */
function Compass({
  directions,
  onAngle,
}: {
  directions: GradientDirection[];
  onAngle: (id: number, angle: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  const angleFrom = useCallback((clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    if (dx === 0 && dy === 0) return null;
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    return Math.round(((deg % 360) + 360) % 360);
  }, []);

  useEffect(() => {
    if (dragId === null) return;

    const move = (e: PointerEvent) => {
      const angle = angleFrom(e.clientX, e.clientY);
      if (angle !== null) onAngle(dragId, angle);
    };
    const up = () => setDragId(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragId, angleFrom, onAngle]);

  return (
    <svg
      ref={svgRef}
      className="compass"
      viewBox="-90 -90 180 180"
      role="img"
      aria-label="Gradient direction compass"
    >
      <circle className="compass-ring" cx={0} cy={0} r={COMPASS_RADIUS} />
      <circle className="compass-ring compass-ring-inner" cx={0} cy={0} r={COMPASS_RADIUS / 2} />
      <line className="compass-axis" x1={-COMPASS_RADIUS} y1={0} x2={COMPASS_RADIUS} y2={0} />
      <line className="compass-axis" x1={0} y1={-COMPASS_RADIUS} x2={0} y2={COMPASS_RADIUS} />
      <text className="compass-cardinal" x={0} y={-COMPASS_RADIUS - 10} textAnchor="middle">
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
              onPointerDown={(e) => {
                e.preventDefault();
                setDragId(d.id);
              }}
            />
            <text x={x * reach} y={y * reach + 3} textAnchor="middle" className="compass-handle-label">
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

export function DirectionsPanel({
  directions,
  blend,
  onDirections,
  onBlend,
}: {
  directions: GradientDirection[];
  blend: GradientBlendMode;
  onDirections: (next: GradientDirection[]) => void;
  onBlend: (next: GradientBlendMode) => void;
}) {
  const enabledCount = directions.filter((d) => d.enabled).length;

  const patch = useCallback(
    (id: number, changes: Partial<GradientDirection>) => {
      onDirections(directions.map((d) => (d.id === id ? { ...d, ...changes } : d)));
    },
    [directions, onDirections],
  );

  const setAngle = useCallback(
    (id: number, angle: number) => patch(id, { angle }),
    [patch],
  );

  const add = () => {
    if (directions.length >= MAX_DIRECTIONS) return;
    const nextId = directions.reduce((max, d) => Math.max(max, d.id), 0) + 1;
    // Drop the new spoke in the widest angular gap so it reads as distinct.
    const angles = [...directions.map((d) => d.angle)].sort((a, b) => a - b);
    let angle = (angles[0] ?? 135) + 45;
    let widest = -1;
    for (let i = 0; i < angles.length; i++) {
      const next = i === angles.length - 1 ? angles[0] + 360 : angles[i + 1];
      const gap = next - angles[i];
      if (gap > widest) {
        widest = gap;
        angle = Math.round((angles[i] + gap / 2) % 360);
      }
    }
    onDirections([...directions, { id: nextId, angle, weight: 60, enabled: true }]);
  };

  const remove = (id: number) => {
    if (directions.length <= 1) return;
    onDirections(directions.filter((d) => d.id !== id));
  };

  const spread = () => {
    const angles = spreadDirectionAngles(directions.length, directions[0]?.angle ?? 135);
    onDirections(directions.map((d, i) => ({ ...d, angle: angles[i] })));
  };

  const setCount = (count: number) => {
    const angles = spreadDirectionAngles(count);
    const nextId = directions.reduce((max, d) => Math.max(max, d.id), 0);
    onDirections(
      angles.map((angle, i) => ({
        id: directions[i]?.id ?? nextId + i + 1,
        angle,
        weight: directions[i]?.weight ?? 100,
        enabled: true,
      })),
    );
  };

  return (
    <section className="directions">
      <div className="section-label">
        Directions — {directions.length}/{MAX_DIRECTIONS}, drag the compass to aim
      </div>

      <div className="directions-body">
        <Compass directions={directions} onAngle={setAngle} />

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
                  onClick={() => patch(d.id, { enabled: !d.enabled })}
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
                      if (Number.isFinite(n)) {
                        patch(d.id, { angle: ((Math.round(n) % 360) + 360) % 360 });
                      }
                    }}
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
                  onChange={(e) => patch(d.id, { angle: +e.target.value })}
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
                    onChange={(e) => patch(d.id, { weight: +e.target.value })}
                  />
                  <span className="dir-weight-value">{d.weight}</span>
                </label>

                {directions.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-remove"
                    title="Remove this direction"
                    aria-label={`Remove direction ${i + 1}`}
                    onClick={() => remove(d.id)}
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
              onClick={add}
              disabled={directions.length >= MAX_DIRECTIONS}
            >
              + Direction
            </button>
            <button type="button" className="btn btn-ghost" onClick={spread}>
              ⟳ Spread evenly
            </button>
            <div className="dir-presets">
              {Array.from({ length: MAX_DIRECTIONS }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`btn dir-preset${directions.length === n ? " active" : ""}`}
                  title={`${n} evenly-spaced direction${n > 1 ? "s" : ""}`}
                  onClick={() => setCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

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
        </div>
      </div>
    </section>
  );
}
